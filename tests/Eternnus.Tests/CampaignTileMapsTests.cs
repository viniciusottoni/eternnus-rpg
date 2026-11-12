using Eternnus.Web;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace Eternnus.Tests;

public sealed partial class CampaignAssetsTests
{
    static string[] TileRows() => ["SSS.....", "SSS.....", "........", "........", "........", "........", "........", "........"];
    static TileMapInput TileInput(int revision = 0) => new("Meu cenário", null, 1.5m, TileRows(), revision);

    [Fact]
    public async Task Custom_tiles_round_trip_without_image_or_unmasked_duplicate_data()
    {
        var saved = await service.SaveTileMapAsync(campaign.Id, null, "master", TileInput(), default);
        Assert.True(saved.IsTileMap); Assert.Null(saved.ImageUrl); Assert.Equal(0, saved.GridPixels);
        Assert.Equal((8, 8), (saved.Width, saved.Height)); Assert.Equal(TileRows(), saved.Rows);
        var json = JsonSerializer.Serialize(saved, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("tileData", json); Assert.Contains("\"rows\"", json);
        Assert.True(saved.Battle()!.CanStand(0, 0));
        var read = await service.ResolveMapAsync(campaign.Id, saved.Key, default);
        Assert.Equal(saved.Rows, read!.Rows);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.ImageAsync(campaign.Id, saved.Id, "master", default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.SaveMapAsync(campaign.Id, saved.Id, "master", new("Image", null, 64, 1.5m, saved.Revision), null, default))).Status);
    }

    [Fact]
    public async Task Tile_maps_enforce_owner_campaign_folder_revision_and_archive()
    {
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, null, "player", TileInput(), default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, null, "stranger", TileInput(), default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, null, "master", TileInput() with { FolderId = Guid.NewGuid() }, default))).Status);
        var saved = await service.SaveTileMapAsync(campaign.Id, null, "master", TileInput(), default);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.TileMapAsync(campaign.Id, saved.Id, "player", default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, saved.Id, "master", TileInput(0), default))).Status);
        var updated = await service.SaveTileMapAsync(campaign.Id, saved.Id, "master", TileInput(saved.Revision) with { Name = "Renomeado" }, default);
        Assert.Equal(saved.Revision + 1, updated.Revision);
        campaign.ArchivedAt = DateTime.UtcNow; await db.SaveChangesAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, null, "master", TileInput(), default))).Status);
    }

    [Fact]
    public async Task Terrain_changes_reset_preparation_only_after_explicit_confirmation()
    {
        var saved = await service.SaveTileMapAsync(campaign.Id, null, "master", TileInput(), default);
        var layer = new CampaignMapLayer { CampaignId = campaign.Id, MapKey = saved.Key, State = "{}" };
        var scene = new Scene { CampaignId = campaign.Id, MapKey = saved.Key, Name = "Preservada", PrivateNotes = "Privado", SharedText = "Texto", Prepared = [new() { Label = "Sentinela", X = 4, Y = 4 }], HasSaved = true };
        db.AddRange(layer, scene); await db.SaveChangesAsync();
        var rows = TileRows(); rows[4] = "....R...";
        var edit = TileInput(saved.Revision) with { Rows = rows };
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, saved.Id, "master", edit, default))).Status);
        Assert.Single(await db.Set<CampaignMapLayer>().ToListAsync()); Assert.Single(scene.Prepared);
        var changed = await service.SaveTileMapAsync(campaign.Id, saved.Id, "master", edit with { ResetPreparation = true }, default);
        Assert.False(changed.Battle()!.CanStand(4, 4)); Assert.Empty(await db.Set<CampaignMapLayer>().ToListAsync());
        Assert.Empty(scene.Prepared); Assert.False(scene.HasSaved); Assert.Equal(2, scene.Revision);
        Assert.Equal(("Preservada", "Privado", "Texto"), (scene.Name, scene.PrivateNotes, scene.SharedText));
    }

    [Fact]
    public async Task Active_tile_map_cannot_be_edited_and_map_quota_is_shared()
    {
        var saved = await service.SaveTileMapAsync(campaign.Id, null, "master", TileInput(), default);
        var session = new GameSession { CampaignId = campaign.Id, MapKey = saved.Key, MapKind = MapKinds.Tileset, Number = 1 };
        db.Sessions.Add(session); await db.SaveChangesAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, saved.Id, "master", TileInput(saved.Revision), default))).Status);
        session.EndedAt = DateTime.UtcNow;
        for (var i = 1; i < CampaignAssetsService.MaxMaps; i++) db.Add(new CampaignMap { CampaignId = campaign.Id, Name = "Imagem", Width = 512, Height = 512 });
        await db.SaveChangesAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.SaveTileMapAsync(campaign.Id, null, "master", TileInput(), default))).Status);
    }

    [Fact]
    public void Tile_catalog_matches_collision_and_rejects_invalid_maps()
    {
        Assert.Equal(44, MapTiles.All.Count);
        foreach (var tile in MapTiles.All)
        {
            var map = new BattleMap("test", "test", MapKinds.Tileset, "", null, [tile.Code]);
            var cell = TableFog.Initial(map, TableSettings.Default).Cells[0][0];
            Assert.Equal(!tile.Walkable, TableFog.BlocksMove(cell));
            Assert.Equal(tile.BlocksSight, TableFog.BlocksLight(cell));
        }
        Assert.Throws<RuleException>(() => MapTiles.Validate(null));
        Assert.Throws<RuleException>(() => MapTiles.Validate(["SSS"]));
        Assert.Throws<RuleException>(() => MapTiles.Validate(Enumerable.Repeat(new string('.', 64), 65).ToArray()));
        var invalid = TileRows(); invalid[4] = ".......?";
        Assert.Throws<RuleException>(() => MapTiles.Validate(invalid));
        invalid[4] = ".......<";
        Assert.Throws<RuleException>(() => MapTiles.Validate(invalid));
        Assert.Throws<RuleException>(() => MapTiles.Validate(Enumerable.Repeat("........", 8).ToArray()));
        var max = Enumerable.Repeat(new string('.', 64), 64).ToArray(); max[0] = "SSSSSS" + new string('.', 58);
        Assert.Equal(64, MapTiles.Validate(max).Length);
    }
}
