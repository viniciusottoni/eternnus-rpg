using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Ficha em jogo (ADR-099), em SQLite: rolar com a ficha, usar item com custo, condições com duração, imagem no marcador,
/// duplicar, restaurar pelo histórico e visão do grupo. Bloqueios reais de PostgreSQL ficam nos testes de mesa HTTP.
/// </summary>
public sealed class SheetPlayTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService sessions = null!;
    CharacterSheetService sheets = null!;
    readonly Clock clock = new(new DateTimeOffset(2026, 11, 17, 20, 0, 0, TimeSpan.Zero));
    const string Master = "master", Player = "player", Other = "other", Outsider = "outsider";
    readonly Guid systemId = Guid.NewGuid(), templateId = Guid.NewGuid(), v1 = Guid.NewGuid();
    Campaign campaign = null!;
    Character hero = null!, rogue = null!;
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    static SheetField F(string name, string type, string? role = null) => new() { Name = name, Label = "Rótulo " + name, Type = type, Role = role, X = 0.1, Y = 0.1, W = 0.2, H = 0.03 };
    static List<SheetField> Fields()
    {
        var pv = F("pv", SheetFieldTypes.Number, SheetFieldRoles.Hp); pv.Min = 0; pv.Default = "10";
        var pvMax = F("pv_max", SheetFieldTypes.Number, SheetFieldRoles.MaxHp); pvMax.Min = 1; pvMax.Default = "10";
        var forca = F("forca", SheetFieldTypes.Number); forca.Default = "14";
        var mod = F("forca_mod", SheetFieldTypes.Computed); mod.Formula = "floor((@forca - 10) / 2)";
        var magias = F("magias", SheetFieldTypes.TextArea); magias.MaxLength = 500;
        return [F("nome", SheetFieldTypes.Text, SheetFieldRoles.Name), pv, pvMax, forca, mod, magias];
    }

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Other, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = "Nome " + id });
        await db.SaveChangesAsync();
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        db.RpgSystems.Add(new RpgSystem { Id = systemId, Name = "Tormenta", Slug = "tormenta" });
        db.SheetTemplates.Add(new SheetTemplate { Id = templateId, RpgSystemId = systemId, Name = "Ficha T20", IsDefault = true, CurrentVersionId = v1 });
        db.SheetTemplateVersions.Add(new SheetTemplateVersion { Id = v1, TemplateId = templateId, Number = 1, PublishedAt = clock.GetUtcNow().UtcDateTime, Pages = [new SheetPage()], Fields = Fields(), Actions = [] });
        campaign = new Campaign { OwnerId = Master, Name = "Arton", RpgSystemId = systemId, System = "Tormenta", TableSettings = (TableSettings.Default with { PlayMode = PlayModes.Free, FogEnabled = false }).Serialize() };
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = Player }, new Member { CampaignId = campaign.Id, UserId = Other });
        await db.SaveChangesAsync();
        sessions = new SessionService(db, new SessionSignals(), clock);
        sheets = new CharacterSheetService(db, sessions, new ProgressionService(db, new AuditService(db), clock), clock);
        hero = await sheets.CreateAsync(Modern(("nome", "Lysara"), ("forca", "16"), ("magias", "Bola de Fogo\nLuz")), Player, default);
        rogue = await sheets.CreateAsync(Modern(("nome", "Kael")), Other, default);
        db.ChangeTracker.Clear();
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    CharacterInput Modern(params (string Key, string Value)[] values) =>
        new("", null!, 0, 0, 0, 0, 0, 0, null!, 0, CampaignId: campaign.Id, Values: values.ToDictionary(v => v.Key, v => JsonSerializer.SerializeToElement(v.Value)));
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, Web);
    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;
    async Task<Character> Load(Guid id) { db.ChangeTracker.Clear(); return await db.Characters.AsNoTracking().SingleAsync(c => c.Id == id); }
    async Task<Guid> StartAsync()
    {
        var r = await sessions.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)r.GetType().GetProperty("Id")!.GetValue(r)!;
        await sessions.JoinAsync(id, hero.Id, Player, default);
        await sessions.JoinAsync(id, rogue.Id, Other, default);
        db.ChangeTracker.Clear();
        return id;
    }
    static string Value(Character c, string field) => CharacterSheets.ParseValues(c.Values).GetValueOrDefault(field) ?? "";

    [Fact]
    public async Task Roll_with_a_sheet_uses_that_sheet_and_only_the_owner_or_master()
    {
        var id = await StartAsync();
        // 1d4 + @forca_mod da Lysara (forca 16 → +3): de 4 a 7, rolado pelo dono e pelo mestre com a ficha dela.
        Assert.InRange(Json(await sessions.RollAsync(id, new("1d4 + @forca_mod", "Força", CharacterId: hero.Id), Player, default)).GetProperty("total").GetDouble(), 4, 7);
        Assert.InRange(Json(await sessions.RollAsync(id, new("1d4 + @forca_mod", "Força", Visibility: RollVisibility.Table, CharacterId: hero.Id), Master, default)).GetProperty("total").GetDouble(), 4, 7);
        Assert.Equal(403, await Status(() => sessions.RollAsync(id, new("1d4 + @forca_mod", "Força", CharacterId: hero.Id), Other, default)));
        Assert.Equal(404, await Status(() => sessions.RollAsync(id, new("1d20", "x", CharacterId: Guid.NewGuid()), Master, default)));
        var log = string.Join("\n", await db.Events.AsNoTracking().Where(e => e.SessionId == id && e.Kind == EventKinds.Roll).Select(e => e.Content).ToListAsync());
        Assert.Contains("Lysara rolou Força", log);
    }

    [Fact]
    public async Task Use_item_spends_the_cost_and_rolls_in_one_record_or_refuses_without_balance()
    {
        var id = await StartAsync();
        var result = Json(await sessions.UseItemAsync(id, hero.Id, new("Bola de Fogo", "1d4 + 5", "pv", 3), Player, default));
        Assert.InRange(result.GetProperty("total").GetDouble(), 6, 9);
        Assert.Equal("7", Value(await Load(hero.Id), "pv"));
        var roll = await db.Events.AsNoTracking().Where(e => e.SessionId == id && e.Kind == EventKinds.Roll).OrderBy(e => e.Id).Select(e => e.Content).LastAsync();
        Assert.Contains("Bola de Fogo (−3 Rótulo pv)", roll);
        // Sem saldo: nada é gasto nem rolado.
        var rolls = await db.Events.CountAsync(e => e.SessionId == id && e.Kind == EventKinds.Roll);
        Assert.Equal(409, await Status(() => sessions.UseItemAsync(id, hero.Id, new("Bola de Fogo", "1d6", "pv", 8), Player, default)));
        Assert.Equal("7", Value(await Load(hero.Id), "pv"));
        Assert.Equal(rolls, await db.Events.CountAsync(e => e.SessionId == id && e.Kind == EventKinds.Roll));
        // Outro jogador não usa a ficha alheia; custo sem recurso e recurso que não existe são recusados.
        Assert.Equal(403, await Status(() => sessions.UseItemAsync(id, hero.Id, new("Luz", null, null, null), Other, default)));
        Assert.Equal(400, await Status(() => sessions.UseItemAsync(id, hero.Id, new("Luz", null, null, 2), Player, default)));
        Assert.Equal(404, await Status(() => sessions.UseItemAsync(id, hero.Id, new("Luz", null, "forca_mod", 2), Player, default)));
        Assert.Equal(404, await Status(() => sessions.UseItemAsync(id, hero.Id, new("Luz", null, "nome", 2), Player, default)));
        // Campo numérico sem marcação de recurso (ex.: PM do modelo) também paga custo.
        await sessions.UseItemAsync(id, hero.Id, new("Luz", null, "forca", 2), Player, default);
        Assert.Equal("14", Value(await Load(hero.Id), "forca"));
        Assert.Equal(400, await Status(() => sessions.UseItemAsync(id, hero.Id, new("  ", null, null, null), Player, default)));
        // Sem rolagem nem custo: só o registro de uso. O mestre usa pela ficha do jogador.
        await sessions.UseItemAsync(id, hero.Id, new("Luz", null, null, null), Master, default);
        Assert.True(await db.Events.AnyAsync(e => e.SessionId == id && e.Kind == EventKinds.Action && e.Content == "Lysara usou Luz"));
    }

    [Fact]
    public async Task Effects_lose_a_round_on_the_characters_turn_and_expire_with_a_record()
    {
        var id = await StartAsync();
        await sessions.SetEffectsAsync(id, hero.Id, new([new("  Abalado ", 2), new("Caído", null)]), Player, default);
        Assert.Equal(403, await Status(() => sessions.SetEffectsAsync(id, hero.Id, new([new("x", 1)]), Other, default)));
        Assert.Equal(400, await Status(() => sessions.SetEffectsAsync(id, hero.Id, new([new("x", 0)]), Player, default)));
        Assert.Equal(400, await Status(() => sessions.SetEffectsAsync(id, hero.Id, new([new("x", 1), new("X", 2)]), Player, default)));
        Assert.Equal(400, await Status(() => sessions.SetEffectsAsync(id, hero.Id, new(Enumerable.Range(0, 13).Select(i => (CharacterEffect?)new($"c{i}", null)).ToList()), Player, default)));
        Assert.Equal(400, await Status(() => sessions.SetEffectsAsync(id, hero.Id, new([new(new string('a', 41), null)]), Player, default)));

        await sessions.SetTurnAsync(id, new(hero.Id), Master, default);
        Assert.Equal([new CharacterEffect("Abalado", 1), new CharacterEffect("Caído", null)], CharacterEffects.Parse((await Load(hero.Id)).Effects));
        await sessions.SetTurnAsync(id, new(rogue.Id), Master, default);
        Assert.Equal(1, CharacterEffects.Parse((await Load(hero.Id)).Effects)[0].Rounds);
        await sessions.SetTurnAsync(id, new(hero.Id), Master, default);
        Assert.Equal([new CharacterEffect("Caído", null)], CharacterEffects.Parse((await Load(hero.Id)).Effects));
        Assert.True(await db.Events.AnyAsync(e => e.SessionId == id && e.Content == "Lysara: terminou Abalado"));

        // Estado ao vivo: o grupo e a ficha resumida mostram as condições restantes.
        db.ChangeTracker.Clear();
        var state = JsonSerializer.Serialize(await sessions.StateAsync(id, Player, default), Web);
        Assert.Contains("\"effects\":[{\"name\":\"Caído\",\"rounds\":null}]", state);
        await sessions.SetEffectsAsync(id, hero.Id, new([]), Master, default);
        Assert.Equal("[]", (await Load(hero.Id)).Effects);
    }

    [Fact]
    public void Effect_rules_are_pure_and_bounded()
    {
        var (remaining, expired) = CharacterEffects.Tick([new("A", 1), new("B", 3), new("C", null)]);
        Assert.Equal([new CharacterEffect("B", 2), new CharacterEffect("C", null)], remaining);
        Assert.Equal("A", Assert.Single(expired).Name);
        Assert.Empty(CharacterEffects.Parse("{quebrado"));
        Assert.Equal("Abalado (1 rodada), Caído", CharacterEffects.Describe([new("Abalado", 1), new("Caído", null)]));
        Assert.Equal([new CharacterEffect("Em chamas", 3)], CharacterEffects.Validate([new(" Em   chamas ", 3), new("   ", 1), null]));
    }

    [Fact]
    public async Task Token_shows_the_sheet_portrait_only_to_who_can_read_the_sheet()
    {
        var id = await StartAsync();
        await db.Characters.Where(c => c.Id == hero.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.PortraitVersion, 2));
        var url = $"/api/characters/{hero.Id}/portrait?v=2";
        db.ChangeTracker.Clear();
        Assert.Contains(url, JsonSerializer.Serialize(await sessions.StateAsync(id, Other, default), Web));
        await db.Characters.Where(c => c.Id == hero.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Private, true));
        db.ChangeTracker.Clear();
        Assert.DoesNotContain(url, JsonSerializer.Serialize(await sessions.StateAsync(id, Other, default), Web));
        db.ChangeTracker.Clear();
        Assert.Contains(url, JsonSerializer.Serialize(await sessions.StateAsync(id, Master, default), Web));
        db.ChangeTracker.Clear();
        Assert.Contains(url, JsonSerializer.Serialize(await sessions.StateAsync(id, Player, default), Web));
    }

    [Fact]
    public async Task Copy_is_owner_only_independent_and_keeps_sheet_notes_and_portrait()
    {
        await db.Characters.Where(c => c.Id == hero.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.ItemNotes, "{\"luz\":\"Ilumina.\"}").SetProperty(c => c.Effects, "[{\"name\":\"Caído\",\"rounds\":null}]"));
        db.Set<CharacterPortrait>().Add(new CharacterPortrait { CharacterId = hero.Id, Content = [1, 2, 3], ContentType = "image/png", Width = 1, Height = 1, Size = 3, Sha256 = "x", UpdatedAt = clock.GetUtcNow().UtcDateTime });
        await db.Characters.Where(c => c.Id == hero.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.PortraitVersion, 4));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal(404, await Status(() => sheets.CopyAsync(hero.Id, Master, default)));
        var copyId = Json(await sheets.CopyAsync(hero.Id, Player, default)).GetProperty("id").GetGuid();
        var copy = await Load(copyId);
        Assert.Equal("Lysara (cópia)", copy.Name);
        Assert.Equal("Lysara (cópia)", Value(copy, "nome"));
        Assert.Equal("16", Value(copy, "forca"));
        Assert.Equal("{\"luz\":\"Ilumina.\"}", copy.ItemNotes);
        Assert.Equal("[]", copy.Effects);
        Assert.Equal(1, copy.PortraitVersion);
        Assert.True(await db.Set<CharacterPortrait>().AnyAsync(p => p.CharacterId == copyId));
        Assert.False(await db.CampaignCharacters.AnyAsync(l => l.CharacterId == copyId));
        Assert.Equal(Player, copy.OwnerId);
        Assert.Equal("Nome muito longo (cópia)", CharacterSheetService.CopyName("Nome muito longo demais", 24));
    }

    [Fact]
    public async Task Restore_point_returns_values_from_the_start_of_the_session_for_the_owner()
    {
        var start = clock.GetUtcNow().UtcDateTime.AddHours(1);
        var session = new GameSession { CampaignId = campaign.Id, Number = 3, Title = "Ponte", StartedAt = start };
        db.Sessions.Add(session);
        void Change(string field, string old, string now, DateTime at, Guid? sessionId) => db.FieldChanges.Add(new CharacterFieldChange
        { CharacterId = hero.Id, Field = field, OldValue = old, NewValue = now, ChangedById = Player, SessionId = sessionId, TemplateVersionId = v1, Source = FieldChangeSources.Edit, CreatedAt = at });
        Change("forca", "12", "16", start.AddHours(-2), null);              // antes da sessão: fica
        Change("forca", "16", "18", start.AddMinutes(10), session.Id);
        Change("forca", "18", "20", start.AddHours(5), null);               // depois: também é desfeita
        var current = await db.Characters.SingleAsync(c => c.Id == hero.Id);
        var values = CharacterSheets.ParseValues(current.Values); values["forca"] = "20"; current.Values = JsonSerializer.Serialize(values);
        Change("forca_mod", "3", "5", start.AddMinutes(10), session.Id);    // calculado: fora
        Change(CharacterItemNotes.HistoryField, "", "Luz: x", start.AddMinutes(11), session.Id);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var points = Json(await sheets.RestorePointsAsync(hero.Id, Player, default)).GetProperty("items");
        Assert.Equal(session.Id, Assert.Single(points.EnumerateArray()).GetProperty("id").GetGuid());
        var point = Json(await sheets.RestorePointAsync(hero.Id, session.Id, Player, default));
        Assert.Equal("16", point.GetProperty("values").GetProperty("forca").GetString());
        Assert.Single(point.GetProperty("values").EnumerateObject());
        Assert.Equal(404, await Status(() => sheets.RestorePointsAsync(hero.Id, Master, default)));
        Assert.Equal(404, await Status(() => sheets.RestorePointAsync(hero.Id, Guid.NewGuid(), Player, default)));
    }

    [Fact]
    public async Task Party_view_is_for_the_campaign_master_and_lists_every_linked_sheet()
    {
        await db.Characters.Where(c => c.Id == rogue.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Private, true).SetProperty(c => c.Conditions, "Envenenado"));
        db.ChangeTracker.Clear();
        var party = JsonSerializer.Serialize(await sheets.PartyAsync(campaign.Id, Master, default), Web);
        Assert.Contains("Lysara", party);
        Assert.Contains("Kael", party);
        Assert.Contains("Envenenado", party);
        Assert.Contains("Nome player", party);
        Assert.DoesNotContain("@", party);
        Assert.Equal(404, await Status(() => sheets.PartyAsync(campaign.Id, Player, default)));
        Assert.Equal(404, await Status(() => sheets.PartyAsync(Guid.NewGuid(), Master, default)));
    }

    sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }
}
