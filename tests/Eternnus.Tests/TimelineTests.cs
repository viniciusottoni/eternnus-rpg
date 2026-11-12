using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace Eternnus.Tests;
public sealed class TimelineTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    WorkspaceService service = null!;
    readonly Campaign campaign = new() { OwnerId = "master", Name = "Crônicas" };
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o);
    static string[] Titles(JsonElement list) => list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("Title").GetString()!).ToArray();
    public async Task InitializeAsync()
    {
        await connection.OpenAsync(); db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options); await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { "master", "player", "outsider" }) db.Users.Add(new AppUser { Id = id, NormalizedEmail = id.ToUpperInvariant() });
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = "player" }); await db.SaveChangesAsync(); service = new(db);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }
    async Task<Guid> Add(string title, bool published = true, string kind = TimelineKinds.Event, Guid? after = null, bool first = false, string details = "") =>
        Json(await service.TimelineSave(campaign.Id, null, "master", new(title, Summary: "curta", Details: details, Kind: kind, Published: published, After: after, First: first), default)).GetProperty("Id").GetGuid();

    [Fact]
    public async Task Players_see_only_published_points_and_never_the_long_text_in_the_list()
    {
        await Add("Fundação", details: "Texto longo");
        var hidden = await Add("Traição secreta", published: false, details: "SEGREDO");
        var player = Json(await service.TimelineList(campaign.Id, "player", default));
        Assert.Equal(["Fundação"], Titles(player));
        Assert.False(player.GetProperty("canEdit").GetBoolean());
        Assert.DoesNotContain("Texto longo", player.GetRawText());
        Assert.True(player.GetProperty("items")[0].GetProperty("hasDetails").GetBoolean());
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineRead(campaign.Id, hidden, "player", default))).Status);
        Assert.Equal("SEGREDO", Json(await service.TimelineRead(campaign.Id, hidden, "master", default)).GetProperty("Details").GetString());
        Assert.Equal(2, Titles(Json(await service.TimelineList(campaign.Id, "master", default))).Length);
    }

    [Fact]
    public async Task Only_the_master_writes_and_outsiders_cannot_read()
    {
        var id = await Add("Fundação");
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineSave(campaign.Id, null, "player", new("Minha versão"), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineMoveTo(campaign.Id, id, "player", new(0, 1), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineDelete(campaign.Id, id, "player", 1, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineList(campaign.Id, "outsider", default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineRead(campaign.Id, id, "outsider", default))).Status);
    }

    [Fact]
    public async Task Insertion_moves_markers_and_revisions_keep_the_story_in_order()
    {
        var a = await Add("A"); var c = await Add("C");
        await Add("B", after: a); await Add("Zero", first: true);
        await Add("Fim", kind: TimelineKinds.End); await Add("Início", kind: TimelineKinds.Start);
        Assert.Equal(["Início", "Zero", "A", "B", "C", "Fim"], Titles(Json(await service.TimelineList(campaign.Id, "player", default))));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => Add("Outro início", kind: TimelineKinds.Start))).Status);
        await service.TimelineMoveTo(campaign.Id, c, "master", new(0, 1), default);
        Assert.Equal(["Início", "C", "Zero", "A", "B", "Fim"], Titles(Json(await service.TimelineList(campaign.Id, "master", default))));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineMoveTo(campaign.Id, c, "master", new(3, 1), default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineSave(campaign.Id, a, "master", new("A2", Revision: 5), default))).Status);
        await service.TimelineDelete(campaign.Id, c, "master", 2, default);
        Assert.Equal(new[] { 0, 1, 2 }, await db.Set<TimelineEvent>().Where(e => e.Kind == TimelineKinds.Event).OrderBy(e => e.Position).Select(e => e.Position).ToArrayAsync());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.TimelineSave(campaign.Id, null, "master", new("x", Summary: new string('a', 281)), default))).Status);
    }

    [Fact]
    public async Task Archived_campaign_is_read_only()
    {
        await Add("Fundação");
        campaign.ArchivedAt = DateTime.UtcNow; await db.SaveChangesAsync();
        Assert.False(Json(await service.TimelineList(campaign.Id, "master", default)).GetProperty("canEdit").GetBoolean());
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => Add("Depois"))).Status);
    }
}
