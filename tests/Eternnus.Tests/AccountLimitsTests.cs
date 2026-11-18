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
    public async Task Storage_sums_only_mastered_campaigns_by_kind()
    {
        var mine = await Create();
        var other = await Create("master");
        // A campanha recém-criada já ocupa texto (nome etc.); o teste mede o que é acrescentado.
        var baseline = (await AccountLimits.StorageAsync(db, "common", default)).Texts;
        var page = new WorkspacePage { CampaignId = mine, OwnerId = "common", Title = "abc", Content = "12345" };
        db.AddRange(
            new CampaignMap { CampaignId = mine, Name = "Mapa", Content = new byte[1000] },
            new CampaignMap { CampaignId = other, Name = "Alheio", Content = new byte[5000] },
            page,
            new WorkspaceAttachment { PageId = page.Id, Name = "a.png", Content = new byte[300], Size = 300 },
            new MasterResource { CampaignId = mine, Name = "NPC", Content = "xy" });
        await db.SaveChangesAsync();
        var usage = await AccountLimits.StorageAsync(db, "common", default);
        Assert.Equal(1, usage.Campaigns);
        Assert.Equal(0, usage.Capacity);
        Assert.Equal(500L * 1024 * 1024, (await AccountLimits.StorageAsync(db, "common", default, AccountPlans.BasicLimits.Storage)).Capacity);
        Assert.Equal(1000, usage.Images);
        Assert.Equal(300, usage.Attachments);
        Assert.Equal(baseline + 3 + 5 + 3 + 2, usage.Texts);
        Assert.Equal(1000 + 300 + baseline + 13, usage.Used);
        var none = await AccountLimits.StorageAsync(db, "nobody", default);
        Assert.Equal(0, none.Capacity);
        Assert.Equal(0, none.Used);
    }
    [Fact]
    public async Task Storage_counts_campaign_scene_map_story_and_table_content_of_the_master()
    {
        var mine = await Create();
        var other = await Create("master");
        var before = await AccountLimits.StorageAsync(db, "common", default);
        await db.Campaigns.Where(c => c.Id == mine).ExecuteUpdateAsync(c => c.SetProperty(x => x.Description, "descr").SetProperty(x => x.TableSettings, "{}"));
        var scene = new Scene { CampaignId = mine, Name = "Ab", Description = "cde", SharedText = "f", PrivateNotes = "gh", Composition = "1234567", Layers = "[]", Entry = "e" };
        db.AddRange(
            scene,
            new Scene { CampaignId = other, Name = "Alheia", Composition = new string('x', 900) },
            new CampaignMap { CampaignId = mine, Name = "Tiles", TileData = "abcd", Composition = "xyz", Summary = "s", Entries = "[]" },
            new CampaignMapLayer { CampaignId = mine, MapKey = "crypt", State = "{\"a\":1}", Prepared = "{}" },
            new CampaignMapLayer { CampaignId = other, MapKey = "crypt", State = new string('x', 900) },
            new MasterCharacter { CampaignId = mine, Name = "Orc", Summary = "s", Notes = "nn" },
            new StoryChapter { CampaignId = mine, Title = "Cap", Summary = "res" },
            new TimelineEvent { CampaignId = mine, Title = "T", When = "w", Summary = "s", Details = "dd" },
            new PastSession { CampaignId = mine, Number = 1, Title = "S1", Summary = "x", Scenes = [new() { Title = "a", Text = "bc" }] },
            new TableEvent { CampaignId = mine, UserId = "common", Content = "olá", Data = "{}" },
            new TableEvent { CampaignId = other, UserId = "master", Content = new string('x', 900) },
            new TableEvent { CampaignId = null, UserId = "common", Content = new string('x', 900) });
        await db.SaveChangesAsync();
        var after = await AccountLimits.StorageAsync(db, "common", default);
        // Imagens e mapas: dados de composição, tiles e camadas (cena 7+2+1, mapa 4+3+1+2, camada 7+2).
        Assert.Equal(10 + 10 + 9, after.Images - before.Images);
        // Textos: campanha 5+2, cena 2+3+1+2, personagem 3+1+2, capítulo 3+3, linha do tempo 1+1+1+2, sessão 2+1, mesa 3+2;
        // as cenas do registro contam pelo JSON gravado (texto "a"/"bc" mais a estrutura).
        var scenes = after.Texts - before.Texts - (7 + 8 + 6 + 6 + 5 + 3 + 5);
        Assert.Equal("[{\"Text\":\"bc\",\"Title\":\"a\"}]".Length, scenes);
    }
    [Theory]
    [InlineData(AccountPlans.Basic, 3, 10, 5, 8, 5, 500L, 20L)]
    [InlineData(AccountPlans.Plus, 5, 15, 8, 8, 10, 2048L, 30L)]
    [InlineData(AccountPlans.Pro, 10, 30, 15, 15, 20, 4096L, 60L)]
    public void Plan_table_matches_the_offer(string key, int campaignsLimit, int oneShots, int campaignPlayers, int oneShotPlayers, int characters, long storageMiB, long fileMiB)
    {
        var plan = AccountPlans.For(key, PlatformRoles.Common);
        Assert.Equal(key, plan.Key);
        Assert.Equal(campaignsLimit, plan.Campaigns);
        Assert.Equal(oneShots, plan.OneShots);
        Assert.Equal(campaignPlayers, plan.PlayersFor(false));
        Assert.Equal(oneShotPlayers, plan.PlayersFor(true));
        Assert.Equal(characters, plan.Characters);
        Assert.Equal(storageMiB * 1024 * 1024, plan.Storage);
        Assert.Equal(fileMiB * 1024 * 1024, plan.MaxFileBytes);
    }
    [Fact]
    public void Max_plan_and_staff_are_unlimited_except_storage_and_file_size()
    {
        foreach (var plan in new[] { AccountPlans.For(AccountPlans.Max, PlatformRoles.Common), AccountPlans.For(AccountPlans.Basic, PlatformRoles.Ambassador), AccountPlans.For(null, PlatformRoles.Admin) })
        {
            Assert.Equal(AccountPlans.Max, plan.Key);
            Assert.Null(plan.Campaigns); Assert.Null(plan.OneShots); Assert.Null(plan.Characters);
            Assert.Null(plan.PlayersFor(false)); Assert.Null(plan.PlayersFor(true));
            Assert.Equal(20L * 1024 * 1024 * 1024, plan.Storage);
            Assert.Equal(100L * 1024 * 1024, plan.MaxFileBytes);
        }
        // Valor desconhecido nunca concede mais que o Basic.
        Assert.Equal(AccountPlans.Basic, AccountPlans.For("gold", PlatformRoles.Common).Key);
    }
    async Task<string> Player(string id, string plan = AccountPlans.Basic)
    {
        db.Users.Add(new AppUser { Id = id, Plan = plan });
        await db.SaveChangesAsync();
        return id;
    }
    async Task<string> Code(Guid campaign) => (await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == campaign)).InviteCode;
    [Fact]
    public async Task Plus_plan_raises_campaign_quota_and_downgrade_keeps_existing_campaigns()
    {
        await db.Users.Where(u => u.Id == "common").ExecuteUpdateAsync(u => u.SetProperty(x => x.Plan, AccountPlans.Plus));
        for (var i = 0; i < 5; i++) await Create();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => Create())).Status);
        db.ChangeTracker.Clear();
        await db.Users.Where(u => u.Id == "common").ExecuteUpdateAsync(u => u.SetProperty(x => x.Plan, AccountPlans.Basic));
        // Reduzir o plano não apaga nada; só impede criar além do novo limite.
        Assert.Equal(5, await AccountLimits.CampaignCountAsync(db, "common", default));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => Create())).Status);
    }
    [Fact]
    public async Task Player_limit_follows_the_master_plan_for_campaigns_and_one_shots()
    {
        var campaign = await Create();
        var code = await Code(campaign);
        for (var i = 0; i < 5; i++) await campaigns.JoinAsync(code, await Player($"p{i}"), default);
        var p5 = await Player("p5");
        var sixth = await Assert.ThrowsAsync<RuleException>(() => campaigns.JoinAsync(code, p5, default));
        Assert.Equal(409, sixth.Status);
        Assert.Contains("5 jogadores", sixth.Message);
        // Quem já está na mesa entra de novo sem ocupar outra vaga.
        await campaigns.JoinAsync(code, "p0", default);
        Assert.Equal(5, await db.Members.CountAsync(m => m.CampaignId == campaign));

        var (shot, _) = await OneShot();
        var shotCode = await Code(shot);
        for (var i = 0; i < 8; i++) await campaigns.JoinAsync(shotCode, await Player($"s{i}"), default);
        var s8 = await Player("s8");
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => campaigns.JoinAsync(shotCode, s8, default))).Status);
        Assert.Equal(8, await db.Members.CountAsync(m => m.CampaignId == shot));

        // Mestre Pro: 15 jogadores.
        await db.Users.Where(u => u.Id == "common").ExecuteUpdateAsync(u => u.SetProperty(x => x.Plan, AccountPlans.Pro));
        db.ChangeTracker.Clear();
        await campaigns.JoinAsync(code, "p5", default);
        Assert.Equal(6, await db.Members.CountAsync(m => m.CampaignId == campaign));
    }
    [Fact]
    public async Task Converting_a_one_shot_requires_room_for_its_players_in_a_campaign()
    {
        var (shot, _) = await OneShot();
        var code = await Code(shot);
        for (var i = 0; i < 6; i++) await campaigns.JoinAsync(code, await Player($"c{i}"), default);
        db.ChangeTracker.Clear();
        var error = await Assert.ThrowsAsync<RuleException>(() => sessions.ConvertOneShotAsync(shot, "common", default));
        Assert.Equal(409, error.Status);
        Assert.Contains("até 5 jogadores", error.Message);
        db.ChangeTracker.Clear();
        Assert.True((await db.Campaigns.SingleAsync(c => c.Id == shot)).IsOneShot);
        Assert.Equal(6, await db.Members.CountAsync(m => m.CampaignId == shot));
    }
    [Fact]
    public async Task Character_limit_counts_every_sheet_of_the_owner()
    {
        await SheetTemplateService.EnsureFreeTemplateAsync(db, default);
        var sheets = new CharacterSheetService(db, sessions, new ProgressionService(db, new AuditService(db)), TimeProvider.System);
        CharacterInput Classic(string name) => new(name, "", 1, 10, 10, 10, 10, 10, "", 0);
        for (var i = 0; i < 5; i++) await sheets.CreateAsync(Classic($"Herói {i}"), "common", default);
        var error = await Assert.ThrowsAsync<RuleException>(() => sheets.CreateAsync(Classic("Sexto"), "common", default));
        Assert.Equal(409, error.Status);
        Assert.Contains("5 fichas", error.Message);
        db.ChangeTracker.Clear();
        var first = await db.Characters.Where(c => c.OwnerId == "common").Select(c => c.Id).FirstAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => sheets.CopyAsync(first, "common", default))).Status);
        Assert.Equal(5, await AccountLimits.CharacterCountAsync(db, "common", default));
        // Equipe não tem limite de fichas.
        for (var i = 0; i < 6; i++) await sheets.CreateAsync(Classic($"NPC {i}"), "master", default);
    }
    [Fact]
    public async Task Storage_quota_is_the_plan_total_and_counts_only_the_net_change()
    {
        var mine = await Create();
        db.Add(new CampaignMap { CampaignId = mine, Name = "Mapa", Content = new byte[1000] });
        await db.SaveChangesAsync();
        var basic = AccountPlans.BasicLimits.Storage;
        // Uso atual: o mapa mais os textos da própria campanha (nome etc.).
        var used = (await AccountLimits.StorageAsync(db, "common", default)).Used;
        Assert.True(used >= 1000);
        await AccountLimits.EnsureCampaignStorageAsync(db, mine, basic - used, default);
        var full = await Assert.ThrowsAsync<RuleException>(() => AccountLimits.EnsureCampaignStorageAsync(db, mine, basic - used + 1, default));
        Assert.Equal(409, full.Status);
        Assert.Contains("Basic", full.Message);
        // Trocar por arquivo menor ou igual sempre passa, mesmo acima do limite (plano reduzido).
        await AccountLimits.EnsureCampaignStorageAsync(db, mine, 0, default);
        await AccountLimits.EnsureCampaignStorageAsync(db, mine, -500, default);
        await db.Users.Where(u => u.Id == "common").ExecuteUpdateAsync(u => u.SetProperty(x => x.Plan, AccountPlans.Plus));
        await AccountLimits.EnsureCampaignStorageAsync(db, mine, basic, default);
    }
    [Fact]
    public async Task File_size_follows_the_uploader_plan()
    {
        Assert.Equal(20L * 1024 * 1024, await AccountLimits.MaxFileBytesAsync(db, "common", default));
        Assert.Equal(100L * 1024 * 1024, await AccountLimits.MaxFileBytesAsync(db, "master", default));
        Assert.Equal(413, AccountLimits.FileTooLarge(20L * 1024 * 1024).Status);
        Assert.Contains("20 MB", AccountLimits.FileTooLarge(20L * 1024 * 1024).Message);
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
