using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Condução independente do sistema, rolagens privadas, pedidos de teste, desfazer, cenas, conversão e arquivamento (SQLite).
/// Bloqueios e corridas reais ficam em tests/table-play.mjs (PostgreSQL).
/// </summary>
public sealed class TablePlayServiceTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    PreparationService prep = null!;
    CampaignService campaigns = null!;
    readonly Clock clock = new(new DateTimeOffset(2026, 11, 8, 21, 0, 0, TimeSpan.Zero));
    Campaign campaign = null!;
    Character hero = null!, rogue = null!;
    const string Master = "master", Player = "player", Other = "other", Outsider = "outsider";
    // Sem escapar acentos e "+", para que as buscas por texto nos payloads sejam significativas.
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Other, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Strength = 16, Movement = 9, Hp = 10, MaxHp = 10, Actions = [new() { Id = "golpe", Name = "Golpe", Kind = "ataque", Formula = "1d20+5" }] };
        rogue = new Character { OwnerId = Other, Name = "Lira", Hp = 8, MaxHp = 8 };
        db.AddRange(campaign, hero, rogue, new Member { CampaignId = campaign.Id, UserId = Player }, new Member { CampaignId = campaign.Id, UserId = Other },
            new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = rogue.Id });
        await db.SaveChangesAsync();
        service = new SessionService(db, new SessionSignals(), clock);
        prep = new PreparationService(db, clock);
        var audit = new AuditService(db);
        campaigns = new CampaignService(db, new ProgressionService(db, audit, clock), audit);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    async Task SetModeAsync(string mode)
    {
        campaign.TableSettings = (TableSettings.Default with { PlayMode = mode, FogEnabled = false }).Serialize();
        await db.SaveChangesAsync();
    }
    async Task<Guid> StartAsync(string? mode = PlayModes.Tactical)
    {
        if (mode != null) await SetModeAsync(mode);
        var r = await service.StartAsync(campaign.Id, new("Sessão", "Segredo do mestre", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)r.GetType().GetProperty("Id")!.GetValue(r)!;
        await service.JoinAsync(id, hero.Id, Player, default);
        await service.JoinAsync(id, rogue.Id, Other, default);
        db.ChangeTracker.Clear();
        return id;
    }
    async Task<JsonElement> State(Guid id, string user) { db.ChangeTracker.Clear(); return JsonSerializer.SerializeToElement(await service.StateAsync(id, user, default), Web); }
    async Task<string> StateText(Guid id, string user) { db.ChangeTracker.Clear(); return JsonSerializer.Serialize(await service.StateAsync(id, user, default), Web); }
    /// <summary>Casa livre e transitável a exatamente <paramref name="d"/> casas (Chebyshev) do marcador.</summary>
    async Task<MoveInput> FreeCell(Guid id, SessionToken from, int d)
    {
        var taken = (await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == id).Select(t => new { t.X, t.Y }).ToListAsync()).Select(t => (t.X, t.Y)).ToHashSet();
        foreach (var (dx, dy) in new[] { (d, 0), (-d, 0), (0, d), (0, -d), (d, d), (-d, -d), (d, -d), (-d, d) })
            if (BattleMaps.Crypt.CanStand(from.X + dx, from.Y + dy) && !taken.Contains((from.X + dx, from.Y + dy))) return new(from.X + dx, from.Y + dy);
        throw new InvalidOperationException("Sem casa livre para o teste.");
    }
    async Task<SessionToken> TokenOf(Guid id, Guid character) { db.ChangeTracker.Clear(); return await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.CharacterId == character); }
    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;

    [Fact]
    public async Task Free_mode_lets_players_act_and_move_without_turns_but_only_their_own_tokens()
    {
        var id = await StartAsync(PlayModes.Free);
        var result = JsonSerializer.SerializeToElement(await service.UseActionAsync(id, new("ataque", "golpe", null), Player, default), Web);
        Assert.Contains("Golpe", result.GetProperty("message").GetString());
        var token = await TokenOf(id, hero.Id);
        await service.MoveTokenAsync(id, token.Id, await FreeCell(id, token, 1), Player, default);
        // Sem limite de um deslocamento por turno no modo livre.
        var moved = await TokenOf(id, hero.Id);
        await service.MoveTokenAsync(id, token.Id, await FreeCell(id, moved, 1), Player, default);
        var other = await TokenOf(id, rogue.Id);
        Assert.Equal(403, await Status(() => service.MoveTokenAsync(id, other.Id, new(other.X, other.Y + 1), Player, default)));
        Assert.Equal("free", (await State(id, Player)).GetProperty("play").GetProperty("mode").GetString());
    }

    [Fact]
    public async Task Tactical_mode_and_legacy_sessions_keep_turn_and_movement_restrictions()
    {
        var id = await StartAsync(PlayModes.Tactical);
        Assert.Equal(409, await Status(() => service.UseActionAsync(id, new("ataque", "golpe", null), Player, default)));
        await service.SetTurnAsync(id, new(hero.Id), Master, default);
        var token = await TokenOf(id, hero.Id);
        var far = await FreeCell(id, token, 7);
        Assert.Equal(400, await Status(() => service.MoveTokenAsync(id, token.Id, far, Player, default)));
        await service.MoveTokenAsync(id, token.Id, await FreeCell(id, token, 1), Player, default);
        var moved = await TokenOf(id, hero.Id);
        var again = await FreeCell(id, moved, 1);
        Assert.Equal(409, await Status(() => service.MoveTokenAsync(id, token.Id, again, Player, default)));
        // Sessão anterior à mudança (sem forma gravada) continua tática.
        await db.Sessions.Where(s => s.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PlayMode, (string?)null));
        await service.EndTurnAsync(id, Player, default);
        Assert.Equal(409, await Status(() => service.UseActionAsync(id, new("ataque", "golpe", null), Player, default)));
    }

    [Fact]
    public async Task Session_keeps_its_play_mode_when_the_campaign_changes_mid_game()
    {
        var id = await StartAsync(PlayModes.Turns);
        await service.UpdateCampaignTableSettingsAsync(campaign.Id, TableSettings.Default with { PlayMode = PlayModes.Free, FogEnabled = false }, Master, default);
        Assert.Equal(409, await Status(() => service.UseActionAsync(id, new("ataque", "golpe", null), Player, default)));
        // Turnos: exige a vez, mas não limita a distância.
        await service.SetTurnAsync(id, new(hero.Id), Master, default);
        var token = await TokenOf(id, hero.Id);
        await service.MoveTokenAsync(id, token.Id, await FreeCell(id, token, 7), Player, default);
    }

    [Fact]
    public async Task Template_without_life_or_level_has_no_artificial_fields_or_universal_attack()
    {
        var created = JsonSerializer.SerializeToElement(await prep.SavePrivateTemplateAsync(campaign.Id, null, new("Coração", "", [
            new("Estado", [new("Estresse", SheetFieldTypes.Number, null, true, 6, null, false, 0, "0"), new("Pacto", SheetFieldTypes.Text, null, false, null, null, true, null, "")])
        ], [new("Resistir", "2d6", "", "Testes", null)], UseForCampaign: true), Master, default), Web);
        var version = created.GetProperty("versionId").GetGuid();
        var witch = new Character { OwnerId = Player, Name = "Mora", TemplateVersionId = version, Values = "{\"nome\":\"Mora\",\"estresse\":\"1\",\"pacto\":\"Corvo\"}" };
        db.Characters.Add(witch);
        db.CampaignCharacters.Add(new() { CampaignId = campaign.Id, CharacterId = witch.Id });
        await db.SaveChangesAsync();
        await SetModeAsync(PlayModes.Free);
        var r = await service.StartAsync(campaign.Id, new("S", "", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)r.GetType().GetProperty("Id")!.GetValue(r)!;
        await service.JoinAsync(id, witch.Id, Player, default);
        var me = (await State(id, Player)).GetProperty("me").GetProperty("character");
        Assert.Equal(new[] { "Estresse" }, me.GetProperty("resources").EnumerateArray().Select(x => x.GetProperty("label").GetString()));
        Assert.False(me.GetProperty("classic").GetBoolean());
        Assert.DoesNotContain("Ataque básico", me.ToString());
        Assert.Equal(404, await Status(() => service.UseActionAsync(id, new("ataque", null, null), Player, default)));
        Assert.Equal(404, await Status(() => service.UseActionAsync(id, new("defender", null, null), Player, default)));
        await service.UseActionAsync(id, new("habilidade", me.GetProperty("actions")[0].GetProperty("id").GetString(), null), Player, default);
        await service.AdjustResourceAsync(id, witch.Id, new("estresse", 10, null), Player, default);
        var after = (await State(id, Player)).GetProperty("me").GetProperty("character").GetProperty("resources")[0];
        Assert.Equal(6, after.GetProperty("value").GetDouble()); // teto do modelo
        Assert.Equal(409, await Status(() => service.AdjustHpAsync(id, witch.Id, new(-1, null), Master, default)));
        // Modelo privado fica fora do catálogo.
        var catalog = JsonSerializer.Serialize(await new SheetTemplateService(db, new AuditService(db)).ListPublishedAsync(null, default), Web);
        Assert.DoesNotContain("Coração", catalog);
    }

    [Fact]
    public async Task Player_roll_visibility_comes_from_the_table_settings_and_never_reaches_other_players()
    {
        var id = await StartAsync(PlayModes.Free);
        // Padrão: mesa inteira, mesmo que o jogador peça outra coisa.
        await service.RollAsync(id, new("1d20+1", "Atletismo", null, RollVisibility.Blind), Player, default);
        Assert.Contains("1d20+1", await StateText(id, Other));
        Assert.Equal("table", (await State(id, Player)).GetProperty("play").GetProperty("playerRollVisibility").GetString());

        await service.UpdateCampaignTableSettingsAsync(campaign.Id, TableSettings.Default with { PlayMode = PlayModes.Free, FogEnabled = false, PlayerRollVisibility = RollVisibility.Blind }, Master, default);
        db.ChangeTracker.Clear();
        var blind = JsonSerializer.SerializeToElement(await service.RollAsync(id, new(null, "Furtividade", new DiceSpec(1, 20, 7), RollVisibility.Table), Player, default), Web);
        Assert.True(blind.GetProperty("hidden").GetBoolean());
        Assert.False(blind.TryGetProperty("total", out _));
        var mine = await StateText(id, Player);
        Assert.Contains("rolagem secreta", mine);
        Assert.DoesNotContain("1d20+7", mine);

        await service.UpdateCampaignTableSettingsAsync(campaign.Id, TableSettings.Default with { PlayMode = PlayModes.Free, FogEnabled = false, PlayerRollVisibility = RollVisibility.Master }, Master, default);
        db.ChangeTracker.Clear();
        await service.RollAsync(id, new("1d20+3", "Intuição", null, "todos"), Player, default);
        Assert.Contains("1d20+3", await StateText(id, Player));
        var other = await StateText(id, Other);
        Assert.DoesNotContain("Furtividade", other);
        Assert.DoesNotContain("Intuição", other);
        var master = await StateText(id, Master);
        Assert.Contains("1d20+7", master);
        Assert.Contains("1d20+3", master);
        Assert.Equal(400, await Status(() => service.UpdateCampaignTableSettingsAsync(campaign.Id, TableSettings.Default with { PlayerRollVisibility = RollVisibility.Group }, Master, default)));
    }

    [Fact]
    public async Task Master_chooses_table_only_self_or_a_group_of_players_without_duplicates()
    {
        var id = await StartAsync(PlayModes.Free);
        await service.RollAsync(id, new("1d6+40", "Emboscada", null, RollVisibility.Blind), Master, default);
        Assert.DoesNotContain("1d6+40", await StateText(id, Player));
        await service.RollAsync(id, new("1d6+50", "Sussurro", null, RollVisibility.Group, [hero.Id]), Master, default);
        Assert.Contains("1d6+50", await StateText(id, Player));
        Assert.DoesNotContain("1d6+50", await StateText(id, Other));
        var master = await State(id, Master);
        Assert.Single(master.GetProperty("events").EnumerateArray(), e => e.GetProperty("content").GetString()!.Contains("1d6+50"));
        Assert.Equal(400, await Status(() => service.RollAsync(id, new("1d6", null, null, RollVisibility.Group, []), Master, default)));
        Assert.Equal(400, await Status(() => service.RollAsync(id, new("1d6", null, null, RollVisibility.Group, [Guid.NewGuid()]), Master, default)));
        Assert.Equal(400, await Status(() => service.CreateRollRequestAsync(id, new("Reflexos", "1d20", null, RollVisibility.Group, null, null, [hero.Id]), Master, default)));
    }

    [Fact]
    public async Task Roll_requests_accept_one_answer_per_character_and_can_be_cancelled()
    {
        var id = await StartAsync(PlayModes.Turns);
        Assert.Equal(403, await Status(() => service.CreateRollRequestAsync(id, new("Reflexos", "1d20", null, null, 12, "gte", [hero.Id]), Player, default)));
        var created = JsonSerializer.SerializeToElement(await service.CreateRollRequestAsync(id, new("Reflexos", null, new DiceSpec(1, 20), RollVisibility.Table, 12, "gte", [hero.Id]), Master, default), Web);
        var rid = created.GetProperty("id").GetGuid();
        Assert.Contains("Reflexos", (await State(id, Player)).GetProperty("play").GetProperty("rollRequests").ToString());
        Assert.DoesNotContain("Reflexos", (await State(id, Other)).GetProperty("play").GetProperty("rollRequests").ToString());
        Assert.Equal(404, await Status(() => service.RespondRollRequestAsync(id, rid, Other, default)));
        // Pedido de teste não depende da vez do jogador.
        var answer = JsonSerializer.SerializeToElement(await service.RespondRollRequestAsync(id, rid, Player, default), Web);
        Assert.Contains(answer.GetProperty("outcome").GetString(), new[] { "sucesso", "falha" });
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => service.RespondRollRequestAsync(id, rid, Player, default)));
        var blind = JsonSerializer.SerializeToElement(await service.CreateRollRequestAsync(id, new("Vontade", "1d20", null, RollVisibility.Blind, null, null, [hero.Id, rogue.Id]), Master, default), Web).GetProperty("id").GetGuid();
        Assert.True(JsonSerializer.SerializeToElement(await service.RespondRollRequestAsync(id, blind, Player, default), Web).GetProperty("hidden").GetBoolean());
        var player = (await State(id, Player)).GetProperty("play").GetProperty("rollRequests");
        Assert.True(player[0].GetProperty("responded").GetBoolean());
        Assert.Equal(JsonValueKind.Null, player[0].GetProperty("total").ValueKind);
        var master = (await State(id, Master)).GetProperty("play").GetProperty("rollRequests");
        Assert.Contains(master.EnumerateArray(), r => r.GetProperty("label").GetString() == "Vontade" && r.GetProperty("targets").EnumerateArray().Any(t => t.GetProperty("responded").GetBoolean()));
        await service.CancelRollRequestAsync(id, blind, Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => service.RespondRollRequestAsync(id, blind, Other, default)));
    }

    [Fact]
    public async Task Turn_order_supports_groups_npcs_and_advances_when_a_turn_ends()
    {
        var id = await StartAsync(PlayModes.Turns);
        var ogre = JsonSerializer.SerializeToElement(await service.AddTokenAsync(id, new("Ogro", "enemy", 2, 1, Hidden: true), Master, default), Web).GetProperty("id").GetGuid();
        await service.SetTurnOrderAsync(id, new([
            new() { Key = "t:" + ogre, Initiative = 20 },
            new() { Key = "g:1", Label = "Grupo", Members = [hero.Id, rogue.Id], Initiative = 10 },
        ], SortByInitiative: true), Master, default);
        Assert.DoesNotContain("Ogro", (await State(id, Player)).GetProperty("play").GetProperty("turnOrder").ToString());
        await service.NextTurnAsync(id, Master, default);
        Assert.Equal("t:" + ogre, (await State(id, Master)).GetProperty("play").GetProperty("activeTurnKey").GetString());
        Assert.Equal(409, await Status(() => service.UseActionAsync(id, new("ataque", "golpe", null), Player, default)));
        await service.NextTurnAsync(id, Master, default);
        Assert.True((await State(id, Other)).GetProperty("play").GetProperty("myTurn").GetBoolean());
        await service.UseActionAsync(id, new("ataque", "golpe", null), Player, default);
        await service.EndTurnAsync(id, Other, default);
        Assert.Equal("t:" + ogre, (await State(id, Master)).GetProperty("play").GetProperty("activeTurnKey").GetString());
    }

    [Fact]
    public async Task Pause_blocks_player_actions_but_keeps_chat_and_the_single_active_session()
    {
        var id = await StartAsync(PlayModes.Free);
        await service.PauseAsync(id, new(true), Master, default);
        Assert.Equal(409, await Status(() => service.UseActionAsync(id, new("ataque", "golpe", null), Player, default)));
        Assert.Equal(409, await Status(() => service.RollAsync(id, new("1d20", null), Player, default)));
        await service.MessageAsync(id, new("Volto já"), Player, default);
        Assert.Equal(409, await Status(() => service.StartAsync(campaign.Id, new("Outra", "", MapKinds.Tileset, "crypt"), Master, default)));
        await service.PauseAsync(id, new(false), Master, default);
        await service.UseActionAsync(id, new("ataque", "golpe", null), Player, default);
    }

    [Fact]
    public async Task Undo_restores_moves_and_resources_once_and_never_rerolls()
    {
        var id = await StartAsync(PlayModes.Free);
        var token = await TokenOf(id, hero.Id);
        await service.MoveTokenAsync(id, token.Id, await FreeCell(id, token, 1), Player, default);
        var move = await db.Events.Where(e => e.SessionId == id && e.Kind == EventKinds.Move).OrderBy(e => e.Id).LastAsync();
        Assert.Equal(403, await Status(() => service.UndoAsync(id, new(move.Id), Other, default)));
        await service.UndoAsync(id, new(move.Id), Player, default);
        Assert.Equal(token.X, (await TokenOf(id, hero.Id)).X);
        Assert.Equal(409, await Status(() => service.UndoAsync(id, new(move.Id), Player, default)));
        await service.AdjustHpAsync(id, hero.Id, new(-3, "golpe"), Master, default);
        var hit = await db.Events.Where(e => e.SessionId == id && e.Kind == EventKinds.Sheet).OrderBy(e => e.Id).LastAsync();
        await service.AdjustHpAsync(id, hero.Id, new(-1, "outro"), Master, default);
        // Mudança posterior: desfazer não sobrescreve.
        Assert.Equal(409, await Status(() => service.UndoAsync(id, new(hit.Id), Master, default)));
        var last = await db.Events.Where(e => e.SessionId == id && e.Kind == EventKinds.Sheet).OrderBy(e => e.Id).LastAsync();
        await service.UndoAsync(id, new(last.Id), Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal(7, (await db.Characters.AsNoTracking().SingleAsync(c => c.Id == hero.Id)).Hp);
        await service.RollAsync(id, new("1d20", null), Player, default);
        var roll = await db.Events.Where(e => e.SessionId == id && e.Kind == EventKinds.Roll).OrderBy(e => e.Id).LastAsync();
        Assert.Equal(400, await Status(() => service.UndoAsync(id, new(roll.Id), Player, default)));
        Assert.True(await db.Events.AnyAsync(e => e.Id == hit.Id)); // nada é apagado
    }

    [Fact]
    public async Task Switching_scenes_resumes_saved_state_and_restart_returns_to_preparation()
    {
        var id = await StartAsync(PlayModes.Free);
        var npc = JsonSerializer.SerializeToElement(await prep.SaveNpcAsync(campaign.Id, null, new("Capitã", "Guarda", "segredo da capitã", "neutral", [new() { Label = "Moral", Value = 3, Max = 5 }]), Master, default), Web).GetProperty("id").GetGuid();
        var crypt = JsonSerializer.SerializeToElement(await prep.SaveSceneAsync(campaign.Id, null, new("Cripta", "", SceneKinds.Map, MapKinds.Tileset, "crypt", "Ar frio.", "Armadilha no altar", VisionModes.All), Master, default), Web).GetProperty("id").GetGuid();
        var talk = JsonSerializer.SerializeToElement(await prep.SaveSceneAsync(campaign.Id, null, new("Conversa", "", SceneKinds.Text, null, null, "A capitã chega.", "", null), Master, default), Web).GetProperty("id").GetGuid();
        await service.PresentSceneAsync(id, new(crypt, false), Master, default);
        await service.AddNpcTokenAsync(id, new(npc, 2, 1, Copy: true), Master, default);
        await service.CaptureSceneAsync(id, new(crypt), Master, default);
        var npcToken = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.MasterCharacterId != null);
        await service.MoveTokenAsync(id, npcToken.Id, new(3, 1), Master, default);
        Assert.Contains("Ar frio.", await StateText(id, Player));
        Assert.DoesNotContain("Armadilha no altar", await StateText(id, Player));
        Assert.DoesNotContain("segredo da capitã", await StateText(id, Player));
        await service.PresentSceneAsync(id, new(talk, false), Master, default);
        await service.PresentSceneAsync(id, new(crypt, false), Master, default);
        var resumed = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.MasterCharacterId != null);
        Assert.Equal((3, 1), (resumed.X, resumed.Y));
        await service.PresentSceneAsync(id, new(crypt, true), Master, default);
        var restarted = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.MasterCharacterId != null);
        Assert.Equal((2, 1), (restarted.X, restarted.Y));
        // A cópia de encontro não altera o original.
        Assert.Equal(2, await db.MasterCharacters.CountAsync(m => m.CampaignId == campaign.Id));
        var copyId = restarted.MasterCharacterId!.Value;
        await service.AdjustNpcResourceAsync(id, copyId, new(0, -2), Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal(3, (await db.MasterCharacters.AsNoTracking().SingleAsync(m => m.Id == npc)).Resources[0].Value);
    }

    [Fact]
    public async Task Archived_campaign_preserves_history_blocks_play_and_still_counts_in_the_quota()
    {
        var id = await StartAsync(PlayModes.Free);
        Assert.Equal(409, await Status(() => campaigns.ArchiveAsync(campaign.Id, Master, default)));
        await service.EndAsync(id, Master, default);
        await service.RecapAsync(id, new("Os heróis venceram.", true), Master, default);
        await campaigns.ArchiveAsync(campaign.Id, Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => service.StartAsync(campaign.Id, new("Nova", "", MapKinds.Tileset, "crypt"), Master, default)));
        Assert.Equal(409, await Status(() => prep.SaveSceneAsync(campaign.Id, null, new("X", "", SceneKinds.Text, null, null, "", "", null), Master, default)));
        Assert.Contains("Os heróis venceram.", JsonSerializer.Serialize(await prep.JournalAsync(campaign.Id, Player, default), Web));
        Assert.Equal(1, await AccountLimits.CampaignCountAsync(db, Master, default));
        await campaigns.RestoreAsync(campaign.Id, Master, default);
        db.ChangeTracker.Clear();
        await service.StartAsync(campaign.Id, new("Nova", "", MapKinds.Tileset, "crypt"), Master, default);
    }

    [Fact]
    public async Task Converting_a_one_shot_respects_owner_and_member_quotas_and_keeps_its_data()
    {
        var created = JsonSerializer.SerializeToElement(await service.CreateOneShotAsync(new("Noite", "", RpgSystem.FreeSystemId), Master, default), Web);
        var oneShot = created.GetProperty("campaignId").GetGuid();
        db.AddRange(new Member { CampaignId = oneShot, UserId = Player }, new Member { CampaignId = oneShot, UserId = Other });
        // "Other" já está no limite de campanhas persistentes.
        for (var i = 0; i < AccountLimits.Campaigns - 1; i++)
        {
            var c = new Campaign { OwnerId = Outsider, Name = "Cheia " + i };
            db.AddRange(c, new Member { CampaignId = c.Id, UserId = Other });
        }
        await db.SaveChangesAsync();
        Assert.Equal(403, await Status(() => service.ConvertOneShotAsync(oneShot, Player, default)));
        var result = JsonSerializer.SerializeToElement(await service.ConvertOneShotAsync(oneShot, Master, default), Web);
        Assert.Equal(1, result.GetProperty("kept").GetInt32());
        Assert.Equal(1, result.GetProperty("removed").GetInt32());
        db.ChangeTracker.Clear();
        var converted = await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == oneShot);
        Assert.False(converted.IsOneShot);
        Assert.Null(converted.ExpiresAt);
        Assert.True(await db.Sessions.AnyAsync(s => s.CampaignId == oneShot && s.EndedAt == null));
        Assert.False(await db.Members.AnyAsync(m => m.CampaignId == oneShot && m.UserId == Other));
        Assert.Equal(409, await Status(() => service.ConvertOneShotAsync(oneShot, Master, default)));
        // O mestre agora ocupa a quota: com o limite cheio, uma nova conversão é recusada.
        var second = JsonSerializer.SerializeToElement(await service.CreateOneShotAsync(new("Outra", "", RpgSystem.FreeSystemId), Master, default), Web).GetProperty("campaignId").GetGuid();
        db.Add(new Campaign { OwnerId = Master, Name = "Extra" });
        await db.SaveChangesAsync();
        Assert.Equal(409, await Status(() => service.ConvertOneShotAsync(second, Master, default)));
    }

    [Fact]
    public async Task Pending_invite_is_kept_until_the_verified_join()
    {
        await prep.SetPendingInviteAsync(campaign.InviteCode, Outsider, default);
        Assert.Contains(campaign.InviteCode, JsonSerializer.Serialize(await prep.PendingInviteAsync(Outsider, default)));
        Assert.Equal(400, await Status(() => prep.SetPendingInviteAsync("../x", Outsider, default)));
        var preview = JsonSerializer.SerializeToElement(await prep.InviteAsync(campaign.InviteCode, Outsider, default), Web);
        Assert.False(preview.GetProperty("member").GetBoolean());
        Assert.False(preview.ToString().Contains('@'));
        await campaigns.JoinAsync(campaign.InviteCode, Outsider, default);
        db.ChangeTracker.Clear();
        Assert.Null((await db.Users.AsNoTracking().SingleAsync(u => u.Id == Outsider)).PendingInvite);
    }

    [Fact]
    public async Task Journal_shares_only_published_content_and_attendance_follows_the_date()
    {
        await new CampaignAssetsService(db).SaveTextAsync(campaign.Id, null, Master, new("Achar o cálice", "Está na cripta", true, 0, "objective"), default);
        await new CampaignAssetsService(db).SaveTextAsync(campaign.Id, null, Master, new("Traidor", "É a capitã", false, 0, "clue"), default);
        Assert.Equal(409, await Status(() => prep.AttendanceAsync(campaign.Id, new("yes"), Player, default)));
        var when = new DateTimeOffset(2026, 11, 14, 20, 0, 0, TimeSpan.FromHours(-3));
        await prep.ScheduleAsync(campaign.Id, new(when, "Online"), Master, default);
        await prep.AttendanceAsync(campaign.Id, new("yes"), Player, default);
        var journal = JsonSerializer.SerializeToElement(await prep.JournalAsync(campaign.Id, Player, default), Web);
        Assert.Equal(when.UtcDateTime, journal.GetProperty("nextSession").GetProperty("at").GetDateTime());
        Assert.Equal("yes", journal.GetProperty("myAttendance").GetString());
        Assert.Contains("Achar o cálice", journal.ToString());
        Assert.DoesNotContain("Traidor", journal.ToString());
        await prep.ScheduleAsync(campaign.Id, new(when.AddDays(7), null), Master, default);
        Assert.Equal(JsonValueKind.Null, JsonSerializer.SerializeToElement(await prep.JournalAsync(campaign.Id, Player, default), Web).GetProperty("myAttendance").ValueKind);
    }

    [Fact]
    public async Task Npc_and_creature_sheets_follow_campaign_templates_and_only_the_master_reads_them()
    {
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        var id = await StartAsync(PlayModes.Free);
        var templates = JsonSerializer.SerializeToElement(await service.NpcTemplatesAsync(campaign.Id, Master, default), Web).GetProperty("items");
        var free = templates.EnumerateArray().Single(t => t.GetProperty("id").GetGuid() == SheetTemplate.FreeTemplateId).GetProperty("id").GetGuid();
        Assert.Equal(403, await Status(() => service.NpcTemplatesAsync(campaign.Id, Player, default)));

        var npc = JsonSerializer.SerializeToElement(await prep.SaveNpcAsync(campaign.Id, null, new("Capitã Vela", "Guarda", "", "neutral", [], Kind: NpcKinds.Npc), Master, default), Web);
        var npcId = npc.GetProperty("id").GetGuid();
        db.ChangeTracker.Clear();
        var empty = JsonSerializer.SerializeToElement(await service.NpcSheetAsync(campaign.Id, npcId, Master, default), Web);
        Assert.Equal(JsonValueKind.Null, empty.GetProperty("template").ValueKind);
        var withSheet = JsonSerializer.SerializeToElement(await service.SaveNpcSheetAsync(campaign.Id, npcId, new(free, null, empty.GetProperty("revision").GetInt32()), Master, default), Web);
        var numeric = withSheet.GetProperty("fields").EnumerateArray().First(f => f.GetProperty("type").GetString() == SheetFieldTypes.Number).GetProperty("name").GetString()!;
        db.ChangeTracker.Clear();
        var saved = JsonSerializer.SerializeToElement(await service.SaveNpcSheetAsync(campaign.Id, npcId, new(free, new() { [numeric] = "7" }, withSheet.GetProperty("revision").GetInt32()), Master, default), Web);
        Assert.Equal("7", saved.GetProperty("values").GetProperty(numeric).GetString());
        // Revisão antiga, campo inexistente e leitura por jogador são recusados.
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => service.SaveNpcSheetAsync(campaign.Id, npcId, new(free, null, 1), Master, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => service.SaveNpcSheetAsync(campaign.Id, npcId, new(free, new() { ["inexistente"] = "1" }, saved.GetProperty("revision").GetInt32()), Master, default)));
        Assert.Equal(403, await Status(() => service.NpcSheetAsync(campaign.Id, npcId, Player, default)));
        // A gravação durante a sessão segue o fluxo da mesa (evento privado do mestre).
        Assert.DoesNotContain("atualizou a ficha de Capitã Vela", await StateText(id, Player));
        Assert.Contains("atualizou a ficha de Capitã Vela", await StateText(id, Master));
    }

    [Fact]
    public async Task Creature_images_reach_players_only_while_the_token_is_visible()
    {
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        var id = await StartAsync(PlayModes.Free);
        var free = SheetTemplate.FreeTemplateId;
        var asset = new CampaignMap { CampaignId = campaign.Id, Name = "Retrato", HasGrid = false, Content = [0xFF, 0xD8, 0xFF, 0xD9] };
        var elsewhere = new Campaign { OwnerId = Other, Name = "Outra mesa" };
        var foreign = new CampaignMap { CampaignId = elsewhere.Id, Name = "Alheio", HasGrid = false, Content = [0xFF, 0xD8, 0xFF, 0xD9] };
        db.AddRange(elsewhere, asset, foreign);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => service.AddTokenAsync(id, new("Lobo", "enemy", 2, 2, ImageUrl: "http://exemplo.com/lobo.png"), Master, default)));
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => service.AddTokenAsync(id, new("Lobo", "enemy", 2, 2, ImageUrl: "asset:" + foreign.Id), Master, default)));
        db.ChangeTracker.Clear();
        var wolf = JsonSerializer.SerializeToElement(await service.AddTokenAsync(id, new("Lobo", "enemy", 2, 2, TemplateId: free, ImageUrl: "https://exemplo.com/lobo.png"), Master, default), Web);
        Assert.Equal(JsonValueKind.String, wolf.GetProperty("masterCharacterId").ValueKind);
        db.ChangeTracker.Clear();
        var ghost = JsonSerializer.SerializeToElement(await service.AddTokenAsync(id, new("Espectro", "enemy", 3, 2, Hidden: true, ImageUrl: "asset:" + asset.Id), Master, default), Web);
        var ghostId = ghost.GetProperty("id").GetGuid();
        var player = await StateText(id, Player);
        Assert.Contains("https://exemplo.com/lobo.png", player);
        Assert.DoesNotContain(ghostId + "/portrait", player);
        Assert.Equal(404, await Status(() => service.PortraitAsync(id, ghostId, Player, default)));
        Assert.Equal(404, await Status(() => service.PortraitAsync(id, ghostId, Outsider, default)));
        Assert.Equal(4, (await service.PortraitAsync(id, ghostId, Master, default)).Length);
        // Revelado, a imagem do acervo chega ao jogador pela rota protegida.
        await db.SessionTokens.Where(t => t.Id == ghostId).ExecuteUpdateAsync(t => t.SetProperty(x => x.Hidden, false));
        Assert.Contains(ghostId + "/portrait", await StateText(id, Player));
        Assert.Equal(4, (await service.PortraitAsync(id, ghostId, Player, default)).Length);
        var master = (await State(id, Master)).GetProperty("play").GetProperty("npcs");
        Assert.Contains(master.EnumerateArray(), n => n.GetProperty("kind").GetString() == NpcKinds.Creature && n.GetProperty("hasSheet").GetBoolean());
    }

    sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }
}
