using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Tests;

public sealed class AccountLimitsTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    CampaignService campaigns = null!;
    SessionService sessions = null!;
    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(new AppUser { Id = "common", Level = 100 }, new AppUser { Id = "master", Role = PlatformRoles.Ambassador });
        await db.SaveChangesAsync();
        campaigns = new(db, new ProgressionService(db, new AuditService(db)), new AuditService(db));
        sessions = new(db, new SessionSignals(), TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }
    Task<Guid> Create(string user = "common") => campaigns.CreateAsync(new("Teste", "", RpgSystemId: RpgSystem.FreeSystemId), user, default);
    /// <summary>One-shot pelo caso de uso real: campanha temporária e sessão única abertas na mesma transação.</summary>
    async Task<(Guid Campaign, Guid Session)> OneShot(string user = "common")
    {
        var result = await sessions.CreateOneShotAsync(new("Teste", "", RpgSystem.FreeSystemId), user, default);
        Guid Read(string name) => (Guid)result.GetType().GetProperty(name)!.GetValue(result)!;
        return (Read("campaignId"), Read("sessionId"));
    }
    [Fact]
    public async Task Three_campaigns_count_both_roles_even_at_high_level_and_membership_is_idempotent()
    {
        var mastered = await Create();
        var joined = await Create("master");
        var invited = await db.Campaigns.SingleAsync(c => c.Id == joined);
        await campaigns.JoinAsync(invited.InviteCode, "common", default);
        await campaigns.JoinAsync(invited.InviteCode, "common", default);
        await Create();
        Assert.Equal(3, await AccountLimits.CampaignCountAsync(db, "common", default));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => Create())).Status);
        var fourth = await Create("master");
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => campaigns.JoinAsync((db.Campaigns.Local.Single(c => c.Id == fourth)).InviteCode, "common", default))).Status);
        db.ChangeTracker.Clear();
        await campaigns.LeaveAsync(joined, "common", default);
        await Create();
        Assert.Equal(3, await AccountLimits.CampaignCountAsync(db, "common", default));
    }
    [Fact]
    public async Task One_shot_quota_is_lifetime_and_rejoining_same_table_does_not_consume_again()
    {
        var (joined, _) = await OneShot("master");
        var code = (await db.Campaigns.SingleAsync(c => c.Id == joined)).InviteCode;
        await campaigns.JoinAsync(code, "common", default);
        await campaigns.LeaveAsync(joined, "common", default);
        db.ChangeTracker.Clear();
        await campaigns.JoinAsync(code, "common", default);
        Assert.Equal(1, (await db.Users.SingleAsync(u => u.Id == "common")).OneShotParticipations);
        for (var i = 0; i < 9; i++)
        {
            var (_, session) = await OneShot();
            await sessions.EndAsync(session, "common", default);
        }
        Assert.Equal(10, (await db.Users.SingleAsync(u => u.Id == "common")).OneShotParticipations);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => OneShot())).Status);
        db.ChangeTracker.Clear();
        var (other, _) = await OneShot("master");
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => campaigns.JoinAsync(db.Campaigns.Local.Single(c => c.Id == other).InviteCode, "common", default))).Status);
        Assert.Equal(10, await db.OneShotParticipations.CountAsync(p => p.UserId == "common"));
    }
    [Fact]
    public async Task Ambassador_and_admin_are_not_limited()
    {
        for (var i = 0; i < 4; i++) await Create("master");
        for (var i = 0; i < 11; i++) await OneShot("master");
        db.ChangeTracker.Clear();
        await db.Users.Where(u => u.Id == "common").ExecuteUpdateAsync(u => u.SetProperty(x => x.Role, PlatformRoles.Admin));
        for (var i = 0; i < 4; i++) await Create();
    }
    [Fact]
    public async Task Cleanup_cascades_game_content_but_preserves_sheets_and_lifetime_receipts()
    {
        var (id, _) = await OneShot();
        var campaign = await db.Campaigns.SingleAsync(c => c.Id == id);
        campaign.MasterLastSeenAt = DateTime.UtcNow - OneShotLifecycleService.MasterAbsence - TimeSpan.FromSeconds(1);
        var sheet = new Character { OwnerId = "common", Name = "Preservada" };
        db.AddRange(sheet, new CampaignCharacter { CampaignId = id, CharacterId = sheet.Id }, new MasterResource { CampaignId = id, Name = "Segredo" });
        await db.SaveChangesAsync();
        Assert.Equal(1, await new OneShotLifecycleService(db, new SessionSignals(), TimeProvider.System).SweepAsync(default));
        Assert.False(await db.Campaigns.AnyAsync(c => c.Id == id));
        Assert.Empty(await db.Resources.ToListAsync());
        Assert.Empty(await db.Sessions.ToListAsync());
        Assert.Empty(await db.CampaignCharacters.ToListAsync());
        Assert.True(await db.Characters.AnyAsync(c => c.Id == sheet.Id));
        Assert.Single(await db.OneShotParticipations.ToListAsync());
    }
    [Fact]
    public async Task Deleting_a_campaign_with_an_active_session_requires_ending_it_first()
    {
        var id = await Create();
        var session = new GameSession { CampaignId = id, Number = 1 };
        db.Sessions.Add(session);
        await db.SaveChangesAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => campaigns.DeleteAsync(id, "common", default))).Status);
        Assert.True(await db.Campaigns.AnyAsync(c => c.Id == id));
        Assert.True(await db.Sessions.AnyAsync(s => s.Id == session.Id && s.EndedAt == null));
        session.EndedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await campaigns.DeleteAsync(id, "common", default);
        Assert.False(await db.Campaigns.AnyAsync(c => c.Id == id));
        Assert.False(await db.Sessions.AnyAsync(s => s.Id == session.Id));
    }
    [Fact]
    public async Task One_shot_is_only_created_with_its_session_and_expired_tables_reject_entry_until_collected()
    {
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => campaigns.CreateAsync(new("Antiga", "", RpgSystemId: RpgSystem.FreeSystemId, IsOneShot: true), "common", default))).Status);
        Assert.False(await db.Campaigns.AnyAsync(c => c.IsOneShot));
        var (id, _) = await OneShot();
        Assert.Equal(0, await new OneShotLifecycleService(db, new SessionSignals(), TimeProvider.System).SweepAsync(default));
        var c = await db.Campaigns.SingleAsync(c => c.Id == id);
        c.ExpiresAt = DateTime.UtcNow.AddSeconds(-1);
        await db.SaveChangesAsync();
        Assert.Equal(410, (await Assert.ThrowsAsync<RuleException>(() => campaigns.JoinAsync(c.InviteCode, "master", default))).Status);
        Assert.Equal(1, await new OneShotLifecycleService(db, new SessionSignals(), TimeProvider.System).SweepAsync(default));
    }
}
