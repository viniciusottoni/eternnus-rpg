using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace Eternnus.Tests;

public sealed partial class CampaignAssetsTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    CampaignAssetsService service = null!;
    readonly Campaign campaign = new() { OwnerId = "master", Name = "Campanha" };
    public async Task InitializeAsync()
    {
        await connection.OpenAsync(); db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { "master", "player", "stranger" }) db.Users.Add(new AppUser { Id = id, NormalizedEmail = id.ToUpperInvariant(), DisplayName = id });
        db.Campaigns.Add(campaign); db.Members.Add(new() { CampaignId = campaign.Id, UserId = "player" });
        await db.SaveChangesAsync(); service = new(db);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }
    [Fact]
    public async Task Legacy_texts_convert_into_pages_once_and_only_by_the_master()
    {
        var draft = new CampaignLibraryEntry { CampaignId = campaign.Id, Title = "NPC", Text = "Segredo" };
        var shown = new CampaignLibraryEntry { CampaignId = campaign.Id, Title = "Carta", Text = "Leia em voz alta", Published = true, Kind = "clue" };
        db.AddRange(draft, shown); await db.SaveChangesAsync();
        var hidden = JsonSerializer.SerializeToElement(await service.LibraryAsync(campaign.Id, "player", 1, default));
        Assert.Equal(1, hidden.GetProperty("total").GetInt32());
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.LibraryAsync(campaign.Id, "stranger", 1, default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.ConvertTextAsync(campaign.Id, shown.Id, "player", new(shown.Revision), default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.ConvertTextAsync(campaign.Id, shown.Id, "master", new(shown.Revision + 5), default))).Status);
        await service.ConvertTextAsync(campaign.Id, shown.Id, "master", new(shown.Revision), default);
        await service.ConvertTextAsync(campaign.Id, draft.Id, "master", new(draft.Revision), default);
        db.ChangeTracker.Clear();
        var pages = await db.Set<WorkspacePage>().Where(p => p.CampaignId == campaign.Id).OrderBy(p => p.Title).ToListAsync();
        Assert.Equal([("Carta", "clue", "table", "master"), ("NPC", "text", "self", "master")], pages.Select(p => (p.Title, p.Kind, p.Visibility, p.OwnerId)));
        Assert.Equal(2, await db.Set<CampaignLibraryEntry>().CountAsync(e => e.ConvertedPageId != null));
        var master = JsonSerializer.SerializeToElement(await service.LibraryAsync(campaign.Id, "master", 1, default));
        Assert.Equal(0, master.GetProperty("total").GetInt32());
        var again = await db.Set<CampaignLibraryEntry>().SingleAsync(e => e.Id == shown.Id);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.ConvertTextAsync(campaign.Id, shown.Id, "master", new(again.Revision), default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.DeleteTextAsync(campaign.Id, shown.Id, "master", default))).Status);
    }
    [Fact]
    public async Task Folders_enforce_depth_ownership_and_nonempty_deletion()
    {
        CampaignMapFolder? parent = null;
        for (var i = 0; i < 8; i++) parent = await service.CreateFolderAsync(campaign.Id, "master", new($"Nível {i}", parent?.Id), default);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.CreateFolderAsync(campaign.Id, "master", new("Excesso", parent!.Id), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.CreateFolderAsync(campaign.Id, "player", new("Negada", null), default))).Status);
        var root = await db.Set<CampaignMapFolder>().SingleAsync(f => f.CampaignId == campaign.Id && f.ParentId == null);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.DeleteFolderAsync(campaign.Id, root.Id, "master", default))).Status);
    }
    [Fact]
    public async Task Folder_rename_keeps_place_and_requires_master()
    {
        var root = await service.CreateFolderAsync(campaign.Id, "master", new("Raiz", null), default);
        var child = await service.CreateFolderAsync(campaign.Id, "master", new("Filha", root.Id), default);
        var renamed = await service.RenameFolderAsync(campaign.Id, child.Id, "master", new("  Cidade baixa  "), default);
        Assert.Equal(("Cidade baixa", root.Id), (renamed.Name, renamed.ParentId));
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.RenameFolderAsync(campaign.Id, child.Id, "master", new(" "), default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.RenameFolderAsync(campaign.Id, child.Id, "master", new(new string('a', 101)), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.RenameFolderAsync(campaign.Id, child.Id, "player", new("Negada"), default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.RenameFolderAsync(campaign.Id, Guid.NewGuid(), "master", new("Sumida"), default))).Status);
        Assert.Equal("Cidade baixa", (await db.Set<CampaignMapFolder>().SingleAsync(f => f.Id == child.Id)).Name);
    }
    [Fact]
    public async Task Private_images_only_reach_players_while_selected_in_an_active_session()
    {
        var map = new CampaignMap { CampaignId = campaign.Id, Name = "Oculto", Content = [1, 2, 3], Width = 100, Height = 100 };
        db.Add(map); await db.SaveChangesAsync();
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.ImageAsync(campaign.Id, map.Id, "player", default))).Status);
        var session = new GameSession { CampaignId = campaign.Id, MapKey = "asset:" + map.Id, MapKind = MapKinds.Cartographic, Number = 1 };
        db.Sessions.Add(session); await db.SaveChangesAsync();
        Assert.Equal(map.Content, await service.ImageAsync(campaign.Id, map.Id, "player", default));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.DeleteMapAsync(campaign.Id, map.Id, "master", default))).Status);
        session.EndedAt = DateTime.UtcNow; await db.SaveChangesAsync();
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.ImageAsync(campaign.Id, map.Id, "player", default))).Status);
    }
    [Fact]
    public async Task Image_processing_rejects_bogus_and_oversize_inputs()
    {
        Assert.Equal(413, (await Assert.ThrowsAsync<RuleException>(() => CampaignAssetsService.Normalize(new(new byte[CampaignAssetsService.MaxImageBytes + 1], DocumentKinds.Png, "a.png", ""), default))).Status);
        Assert.Equal(415, (await Assert.ThrowsAsync<RuleException>(() => CampaignAssetsService.Normalize(new([1], DocumentKinds.Pdf, "a.pdf", ""), default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => CampaignAssetsService.Normalize(new([1, 2, 3], DocumentKinds.Png, "a.png", ""), default))).Status);
    }
    [Fact]
    public async Task Deleting_a_campaign_cascades_folder_tree_and_its_bytes()
    {
        var root = await service.CreateFolderAsync(campaign.Id, "master", new("Raiz", null), default);
        var child = await service.CreateFolderAsync(campaign.Id, "master", new("Filha", root.Id), default);
        db.Add(new CampaignMap { CampaignId = campaign.Id, FolderId = child.Id, Name = "Mapa", Content = [1] });
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        await db.Campaigns.Where(c => c.Id == campaign.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.Set<CampaignMap>().ToListAsync()); Assert.Empty(await db.Set<CampaignMapFolder>().ToListAsync());
    }
    [Fact]
    public void Uploaded_grid_is_bounded_passable_and_uses_the_selected_scale()
    {
        var rows = CampaignMapView.Grid(128, 96, 32);
        Assert.Equal(new[] { "SSSS", "....", "...." }, rows);
        Assert.Equal(400, Assert.Throws<RuleException>(() => CampaignMapView.Grid(4096, 4096, 8)).Status);
        Assert.Equal(400, Assert.Throws<RuleException>(() => CampaignMapView.Grid(4096, 4096, 40)).Status);
        Assert.Equal(1, TableRules.MovementSquares(3, 2));
        Assert.Equal(3, TableRules.MovementSquares(9, 3));
    }
}
