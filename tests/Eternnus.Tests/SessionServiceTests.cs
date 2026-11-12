using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Regras do caso de uso em SQLite. Bloqueios e corridas reais são cobertos por tests/sessions.mjs em PostgreSQL.</summary>
public sealed class SessionServiceTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    readonly ManualClock clock = new(new DateTimeOffset(2026, 11, 6, 21, 0, 0, TimeSpan.Zero));
    readonly SessionSignals signals = new();
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player", Outsider = "outsider";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id == Master ? "Vinícius" : id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Strength = 16, Movement = 9, Actions = [new() { Id = "golpe", Name = "Golpe", Kind = "ataque", Formula = "1d20+5" }] };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        service = new SessionService(db, signals, clock);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    async Task<Guid> StartAsync(string map = "crypt", string kind = MapKinds.Tileset)
    {
        var result = await service.StartAsync(campaign.Id, new("Sessão", "Objetivo secreto", kind, map), Master, default);
        return (Guid)result.GetType().GetProperty("Id")!.GetValue(result)!;
    }
    /// <summary>Cria a one-shot pelo caso de uso real (sessão única aberta) e vincula o jogador e sua ficha.</summary>
    async Task<Guid> OneShotAsync()
    {
        var result = await service.CreateOneShotAsync(new("Mesa livre", "", RpgSystem.FreeSystemId), Master, default);
        var id = Prop<Guid>(result, "campaignId");
        campaign = await db.Campaigns.SingleAsync(c => c.Id == id);
        db.AddRange(new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        return Prop<Guid>(result, "sessionId");
    }
    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;

    [Fact]
    public async Task Only_the_master_starts_and_only_one_session_is_active()
    {
        var player = await Assert.ThrowsAsync<RuleException>(() => service.StartAsync(campaign.Id, new("X", "", MapKinds.Tileset, "crypt"), Player, default));
        Assert.Equal(403, player.Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.StartAsync(campaign.Id, new("X", "", MapKinds.Tileset, "crypt"), Outsider, default))).Status);
        await StartAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => StartAsync())).Status);
        // Mesmo contornando o serviço, o índice filtrado rejeita uma segunda sessão ativa.
        db.Sessions.Add(new GameSession { CampaignId = campaign.Id, Number = 99, Title = "Forçada" });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Players_never_receive_private_notes_or_other_sheets()
    {
        var id = await StartAsync();
        await service.JoinAsync(id, null, Player, default);
        await service.NoteAsync(id, new("Segredo", false), Master, default);
        await service.NoteAsync(id, new("Narrativa publica", true), Master, default);
        var state = await service.StateAsync(id, Player, default);
        var json = System.Text.Json.JsonSerializer.Serialize(state);
        Assert.DoesNotContain("Segredo", json); Assert.DoesNotContain("Objetivo secreto", json); Assert.Contains("Narrativa publica", json);
        Assert.Contains("Segredo", System.Text.Json.JsonSerializer.Serialize(await service.StateAsync(id, Master, default)));
        await Assert.ThrowsAsync<RuleException>(() => service.StateAsync(id, Outsider, default));
        await Assert.ThrowsAsync<RuleException>(() => service.HistoryAsync(id, Player, null, null, 1, default));
    }

    [Fact]
    public async Task Actions_require_the_players_turn_and_are_recorded_with_server_rolls()
    {
        var id = await StartAsync();
        await service.JoinAsync(id, null, Player, default);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.UseActionAsync(id, new("ataque", "golpe", null), Player, default))).Status);
        await service.NextTurnAsync(id, Master, default);
        var used = await service.UseActionAsync(id, new("ataque", "golpe", "Esqueleto"), Player, default);
        var roll = Prop<DiceResult>(used, "roll");
        Assert.Equal(roll.Values[0] + 5, roll.Total);
        Assert.Contains("Tharion usou Golpe em Esqueleto", Prop<string>(used, "message"));
        await service.EndTurnAsync(id, Player, default);
        await Assert.ThrowsAsync<RuleException>(() => service.UseActionAsync(id, new("ataque", null, null), Player, default));
        var session = await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id);
        Assert.Null(session.ActiveCharacterId); Assert.Equal(hero.Id, session.LastActiveCharacterId);
    }

    [Fact]
    public async Task Movement_respects_walls_reach_and_one_move_per_turn()
    {
        // Regras clássicas (névoa desligada); a névoa tem testes próprios em TableFogTests.
        campaign.TableSettings = new TableSettings { FogEnabled = false }.Serialize(); await db.SaveChangesAsync();
        var id = await StartAsync();
        await service.JoinAsync(id, null, Player, default);
        await service.NextTurnAsync(id, Master, default);
        await service.MoveGrantAsync(id, new(true), Master, default); // liberação do mestre (MoveNeedsGrant)
        var token = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id);
        Assert.Equal('S', BattleMaps.Crypt.Rows[token.Y][token.X]);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.MoveTokenAsync(id, token.Id, new(0, 0), Player, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.MoveTokenAsync(id, token.Id, new(token.X + 7, token.Y), Player, default))).Status);
        await service.MoveTokenAsync(id, token.Id, new(token.X + 6, token.Y), Player, default);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.MoveTokenAsync(id, token.Id, new(token.X + 5, token.Y), Player, default))).Status);
        await service.MoveTokenAsync(id, token.Id, new(2, 1), Master, default); // O mestre posiciona livremente.
    }

    [Fact]
    public async Task Presence_expires_and_turn_order_skips_absent_players()
    {
        var id = await StartAsync();
        await service.JoinAsync(id, null, Player, default);
        clock.Advance(TimeSpan.FromSeconds(50));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.NextTurnAsync(id, Master, default))).Status);
        var revision = (await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id)).Revision;
        await service.HeartbeatAsync(id, Player, default);
        Assert.True((await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id)).Revision > revision, "returning from absence publishes a revision");
        await service.NextTurnAsync(id, Master, default);
    }

    [Fact]
    public async Task Hp_changes_are_clamped_versioned_and_recorded()
    {
        var id = await StartAsync();
        await service.JoinAsync(id, null, Player, default);
        hero = await db.Characters.AsNoTracking().SingleAsync(c => c.Id == hero.Id);
        await service.AdjustHpAsync(id, hero.Id, new(-50, "Queda"), Master, default);
        var after = await db.Characters.AsNoTracking().SingleAsync(c => c.Id == hero.Id);
        Assert.Equal(0, after.Hp); Assert.Equal(hero.Revision + 1, after.Revision);
        Assert.True(await db.Versions.AnyAsync(v => v.CharacterId == hero.Id && v.Revision == after.Revision));
        var history = await service.HistoryAsync(id, Master, EventKinds.Sheet, null, 1, default);
        Assert.Equal(1, Prop<int>(history, "total"));
        await service.AdjustHpAsync(id, hero.Id, new(5, null), Player, default);
        Assert.Equal(5, (await db.Characters.AsNoTracking().SingleAsync(c => c.Id == hero.Id)).Hp);
        Assert.True(await db.Versions.AnyAsync(v => v.ChangedById == Player && v.SessionId == id));
    }

    [Fact]
    public async Task Ended_session_is_read_only_for_play_but_keeps_its_history()
    {
        var id = await StartAsync();
        await service.JoinAsync(id, null, Player, default);
        clock.Advance(TimeSpan.FromMinutes(134));
        await service.EndAsync(id, Master, default);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.MessageAsync(id, new("oi"), Player, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.JoinAsync(id, null, Player, default))).Status);
        await service.NoteAsync(id, new("Revisão", false), Master, default);
        var history = await service.HistoryAsync(id, Master, null, null, 1, default);
        var session = Prop<object>(history, "session");
        Assert.Equal(134, Prop<int>(session, "durationMinutes"));
        Assert.False(Prop<bool>(session, "active"));
        Assert.Equal(2, Prop<int>(await service.StartAsync(campaign.Id, new("Próxima", "", MapKinds.Cartographic, "valley"), Master, default), "Number"));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task One_shot_survives_leaving_the_screen_and_is_deleted_only_when_ended(bool leave)
    {
        var sid = await OneShotAsync();
        await service.JoinAsync(sid, hero.Id, Player, default);
        if (leave)
        {
            // Sair da tela não apaga: a mesa fica em espera recuperável até o mestre voltar.
            await service.LeaveAsync(sid, Master, default);
            db.ChangeTracker.Clear();
            Assert.True(await db.Campaigns.AnyAsync(c => c.Id == campaign.Id));
            await service.JoinAsync(sid, null, Master, default);
        }
        await service.EndAsync(sid, Master, default);
        db.ChangeTracker.Clear();
        Assert.False(await db.Campaigns.AnyAsync(c => c.Id == campaign.Id));
        Assert.False(await db.Sessions.AnyAsync(s => s.Id == sid));
        Assert.False(await db.Events.AnyAsync(e => e.SessionId == sid));
        Assert.True(await db.Characters.AnyAsync(c => c.Id == hero.Id));
    }

    [Fact]
    public async Task One_shot_master_presence_is_persisted_and_expired_sessions_cannot_be_read()
    {
        var sid = await OneShotAsync();
        clock.Advance(TimeSpan.FromSeconds(20));
        await service.HeartbeatAsync(sid, Master, default);
        var seen = await db.Campaigns.AsNoTracking().Where(c => c.Id == campaign.Id).Select(c => c.MasterLastSeenAt).SingleAsync();
        Assert.Equal(clock.GetUtcNow().UtcDateTime, seen);
        // Ausência breve: a mesa continua legível e indica a espera com prazo.
        clock.Advance(TimeSpan.FromSeconds(46));
        var waiting = System.Text.Json.JsonSerializer.SerializeToElement(await service.StateAsync(sid, Player, default), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        Assert.True(waiting.GetProperty("play").GetProperty("masterAway").GetBoolean());
        Assert.Equal(seen!.Value + OneShotLifecycleService.MasterAbsence, waiting.GetProperty("play").GetProperty("recoverUntil").GetDateTime());
        clock.Advance(OneShotLifecycleService.MasterAbsence);
        Assert.Equal(410, (await Assert.ThrowsAsync<RuleException>(() => service.StateAsync(sid, Player, default))).Status);
    }

    [Fact]
    public async Task One_shot_opens_its_single_session_on_creation_and_never_starts_another()
    {
        var sid = await OneShotAsync();
        Assert.True(campaign.IsOneShot);
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddHours(72), campaign.ExpiresAt);
        Assert.Equal(clock.GetUtcNow().UtcDateTime, campaign.MasterLastSeenAt);
        var session = await db.Sessions.SingleAsync(s => s.CampaignId == campaign.Id);
        Assert.Equal(sid, session.Id);
        Assert.Null(session.EndedAt);
        Assert.True(await db.SessionParticipants.AnyAsync(p => p.SessionId == sid && p.UserId == Master && p.IsMaster && p.LastSeenAt != null));
        Assert.Equal(1, (await db.Users.SingleAsync(u => u.Id == Master)).OneShotParticipations);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.StartAsync(campaign.Id, new("Outra", "", MapKinds.Tileset, "crypt"), Master, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.CreateOneShotAsync(new(" ", "", RpgSystem.FreeSystemId), Master, default))).Status);
    }

    [Fact]
    public async Task Live_poll_returns_immediately_for_new_revisions_and_wakes_on_writes()
    {
        var id = await StartAsync();
        var first = await service.LiveAsync(id, 0, Master, default);
        var revision = Prop<int>(first, "Revision");
        // O sinal pode ocorrer entre a leitura da revisão e a inscrição na espera;
        // a reconferência garantida acontece após até 5 s. O prazo do teste precisa cobrir essa fronteira.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var waiting = Task.Run(async () =>
        {
            await using var other = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
            return await new SessionService(other, signals, TimeProvider.System).LiveAsync(id, revision, Master, cts.Token);
        });
        await Task.Delay(200);
        Assert.False(waiting.IsCompleted);
        await service.NoteAsync(id, new("Acorda", false), Master, default);
        Assert.True(Prop<int>(await waiting, "Revision") > revision);
    }

    sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }

    [Fact]
    public async Task Sessions_can_start_in_a_chapter_move_between_chapters_or_stay_loose()
    {
        var workspace = new WorkspaceService(db);
        var arc = await workspace.SaveChapter(campaign.Id, null, Master, new("A Tormenta", "arc"), default);
        var other = new Campaign { OwnerId = Master, Name = "Outra" }; db.Add(other); await db.SaveChangesAsync();
        var foreign = await workspace.SaveChapter(other.Id, null, Master, new("Alheio"), default);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.StartAsync(campaign.Id, new("X", "", MapKinds.Tileset, "crypt", foreign.Id), Master, default))).Status);
        var started = await service.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, "crypt", arc.Id), Master, default);
        var id = Prop<Guid>(started, "Id");
        Assert.Equal(arc.Id, (await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id)).ChapterId);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.ChapterAsync(id, new(null), Player, default))).Status);
        var revision = (await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id)).Revision;
        await service.ChapterAsync(id, new(null), Master, default);
        var loose = await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id);
        Assert.Null(loose.ChapterId); Assert.Equal(revision + 1, loose.Revision);
        await service.ChapterAsync(id, new(arc.Id), Master, default);
        await workspace.DeleteChapter(campaign.Id, arc.Id, Master, arc.Revision, default);
        Assert.Null((await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id)).ChapterId);
    }
}
