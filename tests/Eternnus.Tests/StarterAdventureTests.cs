using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Tests;

/// <summary>Aventura de exemplo (N1): semeada na criação de campanha e de one-shot, na mesma transação e dentro das quotas (SQLite).</summary>
public sealed class StarterAdventureTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    CampaignService campaigns = null!;
    SessionService sessions = null!;
    PreparationService prep = null!;
    WorkspaceService workspace = null!;
    const string Master = "master", Player = "player", Stranger = "stranger";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Stranger }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        await db.SaveChangesAsync();
        campaigns = new(db, new ProgressionService(db, new AuditService(db)), new AuditService(db));
        sessions = new(db, new SessionSignals(), TimeProvider.System);
        prep = new(db, TimeProvider.System);
        workspace = new(db);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    Task<CampaignCreated> Create(bool starter, string description = "", string user = Master) =>
        campaigns.CreateDetailedAsync(new("Vau das Pedras", description, RpgSystemId: RpgSystem.FreeSystemId, Starter: starter), user, default);
    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;
    async Task<(int Scenes, int Npcs, int Pages, int Versions)> Totals() => (await db.Scenes.CountAsync(), await db.MasterCharacters.CountAsync(),
        await db.Set<WorkspacePage>().CountAsync(), await db.Set<DocumentVersion>().CountAsync());

    [Fact]
    public async Task Without_starter_creates_only_the_campaign()
    {
        var created = await Create(false);
        Assert.Null(created.StarterSceneId);
        Assert.Equal((0, 0, 0, 0), await Totals());
        Assert.Equal("", (await db.Campaigns.SingleAsync(c => c.Id == created.Id)).Description);
    }

    [Fact]
    public async Task Starter_seeds_scene_two_npcs_and_private_pages_owned_by_the_campaign()
    {
        var created = await Create(true);
        var scene = await db.Scenes.SingleAsync();
        Assert.Equal(created.StarterSceneId, scene.Id);
        Assert.Equal(created.Id, scene.CampaignId);
        Assert.Equal((SceneKinds.Map, MapKinds.Tileset, StarterAdventure.Map.Key), (scene.Kind, scene.MapKind, scene.MapKey));
        Assert.NotNull(BattleMaps.Find(scene.MapKey));
        Assert.Null(scene.FolderId);
        Assert.NotEmpty(scene.SharedText); Assert.NotEmpty(scene.PrivateNotes);
        Assert.Equal(1, await db.Set<DocumentVersion>().CountAsync(v => v.CampaignId == created.Id && v.DocumentId == scene.Id));

        var npcs = await db.MasterCharacters.Where(m => m.CampaignId == created.Id).ToListAsync();
        Assert.Equal(2, npcs.Count);
        Assert.All(npcs, n => { Assert.NotEmpty(n.Summary); Assert.Null(n.TemplateVersionId); Assert.False(n.SharedWithPlayers); Assert.Null(n.FolderId); });

        var pages = await db.Set<WorkspacePage>().Where(p => p.CampaignId == created.Id).ToListAsync();
        Assert.Equal(["objective", "text"], pages.Select(p => p.Kind).Order().ToArray());
        Assert.All(pages, p => { Assert.Equal(Master, p.OwnerId); Assert.Equal("self", p.Visibility); });
        Assert.Equal(StarterAdventure.Premise, (await db.Campaigns.SingleAsync(c => c.Id == created.Id)).Description);

        // O mestre lê tudo pelos casos de uso normais da Preparação e do acervo.
        Assert.Equal(1, J(await prep.ScenesAsync(created.Id, Master, default)).GetProperty("items").GetArrayLength());
        Assert.Equal(2, J(await prep.NpcsAsync(created.Id, Master, default)).GetProperty("items").GetArrayLength());
        Assert.Equal(2, J(await workspace.List(created.Id, Master, null, null, 1, false, default)).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Starter_keeps_an_existing_premise()
    {
        var created = await Create(true, "Minha premissa");
        Assert.Equal("Minha premissa", (await db.Campaigns.SingleAsync(c => c.Id == created.Id)).Description);
    }

    [Fact]
    public async Task Starter_content_is_not_reachable_by_non_owners()
    {
        var created = await Create(true);
        var scene = created.StarterSceneId!.Value;
        var page = await db.Set<WorkspacePage>().Where(p => p.CampaignId == created.Id).Select(p => p.Id).FirstAsync();
        Assert.Equal(404, await Status(() => prep.SceneAsync(created.Id, scene, Stranger, default)));
        Assert.Equal(404, await Status(() => prep.NpcsAsync(created.Id, Stranger, default)));
        Assert.Equal(404, await Status(() => workspace.Read(created.Id, page, Stranger, default)));

        var code = (await db.Campaigns.SingleAsync(c => c.Id == created.Id)).InviteCode;
        await campaigns.JoinAsync(code, Player, default);
        Assert.Equal(403, await Status(() => prep.NpcsAsync(created.Id, Player, default)));
        Assert.Equal(0, J(await prep.KnownNpcsAsync(created.Id, Player, null, null, 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(0, J(await workspace.List(created.Id, Player, null, null, 1, false, default)).GetProperty("total").GetInt32());
        Assert.Equal(404, await Status(() => workspace.Read(created.Id, page, Player, default)));
    }

    [Fact]
    public async Task Campaign_quota_rejects_before_seeding_anything()
    {
        for (var i = 0; i < AccountPlans.BasicLimits.Campaigns!.Value; i++) await Create(false);
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => Create(true)));
        db.ChangeTracker.Clear();
        Assert.Equal((0, 0, 0, 0), await Totals());
        Assert.Equal(AccountPlans.BasicLimits.Campaigns!.Value, await db.Campaigns.CountAsync());
    }

    [Fact]
    public async Task One_shot_starter_opens_the_table_presenting_the_starter_scene()
    {
        var result = J(await sessions.CreateOneShotAsync(new("Noite na cripta", "", RpgSystem.FreeSystemId, Starter: true), Master, default));
        var campaign = result.GetProperty("campaignId").GetGuid();
        var scene = result.GetProperty("starterSceneId").GetGuid();
        Assert.Equal(campaign, (await db.Scenes.SingleAsync(s => s.Id == scene)).CampaignId);
        var session = await db.Sessions.SingleAsync(s => s.Id == result.GetProperty("sessionId").GetGuid());
        Assert.Equal((MapKinds.Tileset, StarterAdventure.Map.Key), (session.MapKind, session.MapKey));
        Assert.Equal(scene, session.SceneId);
        Assert.True(await db.Events.AnyAsync(e => e.SessionId == session.Id && e.Kind == EventKinds.Scene));
        Assert.Equal(2, await db.MasterCharacters.CountAsync(m => m.CampaignId == campaign));
        Assert.Equal(2, await db.Set<WorkspacePage>().CountAsync(p => p.CampaignId == campaign));

        var plain = J(await sessions.CreateOneShotAsync(new("Sem exemplo", "", RpgSystem.FreeSystemId), Master, default));
        Assert.False(plain.TryGetProperty("starterSceneId", out _));
        Assert.Equal(0, await db.Scenes.CountAsync(s => s.CampaignId == plain.GetProperty("campaignId").GetGuid()));
    }

    [Fact]
    public async Task One_shot_quota_rejects_before_seeding_anything()
    {
        var user = await db.Users.SingleAsync(u => u.Id == Master);
        user.OneShotParticipations = AccountPlans.BasicLimits.OneShots!.Value;
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => sessions.CreateOneShotAsync(new("Noite na cripta", "", RpgSystem.FreeSystemId, Starter: true), Master, default)));
        db.ChangeTracker.Clear();
        Assert.Equal((0, 0, 0, 0), await Totals());
        Assert.Equal(0, await db.Campaigns.CountAsync());
    }
}
