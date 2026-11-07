using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Curva de nível (pura) e regras do <see cref="ProgressionService"/> em SQLite. Os mesmos números estão em tests/progress-policy.test.mjs.</summary>
public sealed class ProgressionTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    ProgressionService service = null!;
    readonly ManualClock clock = new(new DateTimeOffset(2026, 11, 7, 22, 30, 0, TimeSpan.Zero));
    const string Hero = "hero", Master = "master", Second = "second";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = NewDb();
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Hero, Master, Second }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id, EmailConfirmed = true });
        await db.SaveChangesAsync();
        service = new ProgressionService(db, new AuditService(db), clock);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }
    GameDb NewDb() => new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
    async Task<AppUser> UserAsync(string id) => await db.Users.AsNoTracking().SingleAsync(u => u.Id == id);

    // ---------- Curva (Domain/Progression) ----------

    [Theory]
    [InlineData(1, 0)]
    [InlineData(2, 100)]
    [InlineData(3, 300)]
    [InlineData(5, 1000)]
    [InlineData(10, 4500)]
    [InlineData(100, 495000)]
    public void Xp_for_level_follows_the_curve(int level, int xp) => Assert.Equal(xp, Progression.XpForLevel(level));

    [Theory]
    [InlineData(-5, 1)]
    [InlineData(0, 1)]
    [InlineData(99, 1)]
    [InlineData(100, 2)]
    [InlineData(299, 2)]
    [InlineData(300, 3)]
    [InlineData(999, 4)]
    [InlineData(1000, 5)]
    [InlineData(4499, 9)]
    [InlineData(4500, 10)]
    [InlineData(494999, 99)]
    [InlineData(495000, 100)]
    [InlineData(10_000_000, 100)]
    public void Level_for_xp_is_the_highest_reached(int xp, int level) => Assert.Equal(level, Progression.LevelForXp(xp));

    [Fact]
    public void Every_level_boundary_is_exact_and_progress_is_monotonic()
    {
        for (var n = 2; n <= Progression.MaxLevel; n++)
        {
            Assert.Equal(n, Progression.LevelForXp(Progression.XpForLevel(n)));
            Assert.Equal(n - 1, Progression.LevelForXp(Progression.XpForLevel(n) - 1));
        }
        Assert.Equal(new LevelProgress(150, 2, 100, 300, 25), Progression.Progress(150));
        Assert.Equal(new LevelProgress(0, 1, 0, 100, 0), Progression.Progress(-20));
        Assert.Equal(new LevelProgress(4499, 9, 3600, 4500, 99), Progression.Progress(4499));
        Assert.Equal(new LevelProgress(500000, 100, 495000, null, 100), Progression.Progress(500000));
    }

    [Fact]
    public void Catalog_is_consistent()
    {
        Assert.True(Progression.Achievements.Count >= 12);
        Assert.Equal(Progression.Achievements.Count, Progression.Achievements.Select(a => a.Key).Distinct().Count());
        Assert.All(Progression.Achievements, a => Assert.True(a.Key.Length <= 40 && a.Title.Length > 0 && a.Icon.Length > 0 && a.Threshold > 0));
        foreach (var reason in typeof(XpReasons).GetFields().Select(f => (string)f.GetValue(null)!)) Assert.NotNull(Progression.Rule(reason));
        Assert.Null(Progression.Rule(XpReasons.StaffBonus)!.Amount);
        Assert.Equal(1, Progression.RequiredLevel(LevelFeatures.GuildTopic));
        Assert.Equal(3, Progression.RequiredLevel(LevelFeatures.ExtraCampaigns));
        Assert.Equal(-100, Progression.EffectiveBonus(100, -500));
        Assert.Equal(40, Progression.EffectiveBonus(0, 40));
    }

    // ---------- Serviço ----------

    [Fact]
    public async Task Award_is_idempotent_by_source_key_before_and_after_saving()
    {
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:a");
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:a"); // ainda no ChangeTracker
        await db.SaveChangesAsync();
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:a"); // já no banco
        await db.SaveChangesAsync();
        Assert.Equal(1, await db.XpEntries.CountAsync());
        var hero = await UserAsync(Hero);
        Assert.Equal(10, hero.Xp); Assert.Equal(1, hero.Level);
    }

    [Fact]
    public async Task Concurrent_awards_with_the_same_key_collide_on_the_unique_index()
    {
        await using var other = NewDb();
        var parallel = new ProgressionService(other, new AuditService(other), clock);
        await service.AwardAsync(Hero, XpReasons.SessionPlayed, "session_played:x:hero");
        await parallel.AwardAsync(Hero, XpReasons.SessionPlayed, "session_played:x:hero");
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateException>(() => other.SaveChangesAsync());
        Assert.Equal(1, await db.XpEntries.CountAsync());
    }

    [Fact]
    public async Task Daily_limit_silently_stops_awards_until_the_next_utc_day()
    {
        for (var i = 0; i < 5; i++) await service.AwardAsync(Hero, XpReasons.CharacterCreated, $"character_created:{i}");
        await db.SaveChangesAsync();
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:late");
        await db.SaveChangesAsync();
        Assert.Equal(3, await db.XpEntries.CountAsync(e => e.Reason == XpReasons.CharacterCreated));
        Assert.Equal(30, (await UserAsync(Hero)).Xp);
        // Outro motivo não é afetado pelo limite deste.
        await service.AwardAsync(Hero, XpReasons.CampaignJoined, "campaign_joined:c1:hero");
        clock.Advance(TimeSpan.FromHours(2)); // 00:30 UTC do dia seguinte
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:late");
        await db.SaveChangesAsync();
        Assert.Equal(55, (await UserAsync(Hero)).Xp);
    }

    [Fact]
    public async Task Achievements_unlock_once_and_count_entries_not_yet_saved()
    {
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:1");
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:2");
        await db.SaveChangesAsync();
        await service.AwardAsync(Hero, XpReasons.CharacterCreated, "character_created:3");
        await db.SaveChangesAsync();
        Assert.Equal(["first_character"], await db.Achievements.Where(a => a.UserId == Hero).Select(a => a.Key).ToListAsync());
        // Dez respostas no mesmo SaveChanges: a décima já vê as nove pendentes.
        for (var i = 0; i < 10; i++) await service.AwardAsync(Second, XpReasons.GuildPost, $"guild_post:{i}");
        Assert.Contains(db.Achievements.Local, a => a.UserId == Second && a.Key == "posts_10");
        await db.SaveChangesAsync();
        Assert.Equal(1, await db.Achievements.CountAsync(a => a.UserId == Second && a.Key == "posts_10"));
    }

    [Fact]
    public async Task Unknown_or_variable_reasons_are_ignored_by_award()
    {
        await service.AwardAsync(Hero, XpReasons.StaffBonus, "staff_bonus:manual");
        await service.AwardAsync(Hero, "made_up", "made_up:1");
        await service.AwardAsync("missing-user", XpReasons.GuildPost, "guild_post:404");
        await db.SaveChangesAsync();
        Assert.Equal(0, await db.XpEntries.CountAsync());
    }

    [Fact]
    public async Task Require_level_blocks_with_a_portuguese_403_until_the_level_is_reached()
    {
        await service.RequireLevelAsync(Hero, LevelFeatures.GuildTopic);
        var blocked = await Assert.ThrowsAsync<RuleException>(() => service.RequireLevelAsync(Hero, LevelFeatures.ExtraCampaigns));
        Assert.Equal(403, blocked.Status);
        Assert.Equal("Disponível a partir do nível 3. Participe de sessões e da Guilda para evoluir.", blocked.Message);
        await service.PrepareBonusAsync(Hero, 300, default);
        await service.RequireLevelAsync(Hero, LevelFeatures.ExtraCampaigns); // usuário rastreado já atualizado
        await db.SaveChangesAsync();
        await using var fresh = NewDb();
        await new ProgressionService(fresh, new AuditService(fresh), clock).RequireLevelAsync(Hero, LevelFeatures.ExtraCampaigns);
    }

    [Fact]
    public async Task Staff_bonus_never_leaves_xp_below_zero_and_validates_range()
    {
        await service.AwardAsync(Hero, XpReasons.SessionPlayed, "session_played:s:hero");
        var removal = await service.PrepareBonusAsync(Hero, -500, default);
        await db.SaveChangesAsync();
        Assert.Equal(-30, removal.Amount);
        Assert.StartsWith("staff_bonus:", removal.SourceKey);
        Assert.Equal(0, (await UserAsync(Hero)).Xp);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.PrepareBonusAsync(Hero, -10, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.PrepareBonusAsync(Hero, 0, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.PrepareBonusAsync(Hero, 501, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.PrepareBonusAsync("missing", 10, default))).Status);
        // Bônus positivo alcança o nível 5 e libera a conquista de nível; sem limite diário.
        await service.PrepareBonusAsync(Hero, 500, default);
        await service.PrepareBonusAsync(Hero, 500, default);
        await db.SaveChangesAsync();
        var hero = await UserAsync(Hero);
        Assert.Equal(1000, hero.Xp); Assert.Equal(5, hero.Level);
        Assert.True(await db.Achievements.AnyAsync(a => a.UserId == Hero && a.Key == "level_5"));
        Assert.Equal(0, await db.XpEntries.Where(e => e.UserId == Hero).SumAsync(e => e.Amount) - 1000);
    }

    [Fact]
    public async Task Recalculate_rebuilds_xp_level_and_missing_achievements_from_entries()
    {
        db.XpEntries.AddRange(
            new XpEntry { UserId = Master, Reason = XpReasons.SessionMastered, Amount = 50, SourceKey = "session_mastered:1" },
            new XpEntry { UserId = Master, Reason = XpReasons.SessionMastered, Amount = 50, SourceKey = "session_mastered:2" },
            new XpEntry { UserId = Master, Reason = XpReasons.StaffBonus, Amount = 250, SourceKey = "staff_bonus:x" });
        var master = await db.Users.SingleAsync(u => u.Id == Master);
        master.Xp = 9999; master.Level = 14;
        await db.SaveChangesAsync();
        Assert.Equal(350, await service.RecalculateAsync(Master, default));
        var after = await UserAsync(Master);
        Assert.Equal(350, after.Xp); Assert.Equal(3, after.Level);
        Assert.True(await db.Achievements.AnyAsync(a => a.UserId == Master && a.Key == "first_master"));
        Assert.Equal(350, await service.RecalculateAsync(Master, default)); // idempotente, sem conquista duplicada
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.RecalculateAsync("missing", default))).Status);
    }

    // ---------- Gancho do encerramento de sessão ----------

    async Task<(SessionService Sessions, Guid SessionId)> PlayedSessionAsync()
    {
        var campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        var hero = new Character { OwnerId = Hero, Name = "Tharion", Movement = 9 };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Hero }, new Member { CampaignId = campaign.Id, UserId = Second },
            new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        var sessions = new SessionService(db, new SessionSignals(), clock, service);
        var started = await sessions.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)started.GetType().GetProperty("Id")!.GetValue(started)!;
        await sessions.JoinAsync(id, null, Master, default);
        await sessions.JoinAsync(id, null, Hero, default);
        // Participante sem ficha (ex.: ficha excluída depois de entrar) não recebe XP de jogador.
        db.SessionParticipants.Add(new SessionParticipant { SessionId = id, UserId = Second, JoinedAt = clock.GetUtcNow().UtcDateTime });
        await db.SaveChangesAsync();
        return (sessions, id);
    }

    [Fact]
    public async Task Ending_a_session_shorter_than_ten_minutes_grants_nothing()
    {
        var (sessions, id) = await PlayedSessionAsync();
        clock.Advance(TimeSpan.FromMinutes(9));
        await sessions.EndAsync(id, Master, default);
        Assert.Equal(0, await db.XpEntries.CountAsync());
    }

    [Fact]
    public async Task Ending_a_session_grants_players_with_sheets_and_the_master_once()
    {
        var (sessions, id) = await PlayedSessionAsync();
        clock.Advance(TimeSpan.FromMinutes(10));
        await sessions.EndAsync(id, Master, default);
        var entries = await db.XpEntries.AsNoTracking().OrderBy(e => e.SourceKey).Select(e => new { e.UserId, e.Reason, e.Amount, e.SourceKey }).ToListAsync();
        Assert.Equal(2, entries.Count);
        Assert.Contains(entries, e => e.UserId == Master && e.Reason == XpReasons.SessionMastered && e.Amount == 50 && e.SourceKey == $"session_mastered:{id}");
        Assert.Contains(entries, e => e.UserId == Hero && e.Reason == XpReasons.SessionPlayed && e.Amount == 30 && e.SourceKey == $"session_played:{id}:{Hero}");
        Assert.Equal(30, (await UserAsync(Hero)).Xp);
        Assert.Equal(50, (await UserAsync(Master)).Xp);
        Assert.Equal(0, (await UserAsync(Second)).Xp);
        Assert.True(await db.Achievements.AnyAsync(a => a.UserId == Hero && a.Key == "first_session"));
        Assert.True(await db.Achievements.AnyAsync(a => a.UserId == Master && a.Key == "first_master"));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => sessions.EndAsync(id, Master, default))).Status);
    }

    sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
}
