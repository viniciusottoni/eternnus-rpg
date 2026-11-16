using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Versões persistentes dos documentos de preparação (ADR-083): automáticas, nomeadas, retenção, fontes e acesso (SQLite).</summary>
public sealed class DocumentVersionTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    PreparationService scenes = null!;
    CampaignAssetsService assets = null!;
    DocumentVersionService versions = null!;
    Campaign campaign = null!;
    const string Master = "master", Player = "player", Stranger = "stranger";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Stranger }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = Player });
        await db.SaveChangesAsync();
        scenes = new PreparationService(db, TimeProvider.System);
        assets = new CampaignAssetsService(db);
        versions = new DocumentVersionService(db, TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;
    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, Web);
    static string[] Rows(char fill = ',') => ["SSS" + new string(fill, 5), "SSS" + new string(fill, 5), .. Enumerable.Range(0, 6).Select(_ => new string(fill, 8))];
    static TileMapInput Tiles(string name, int revision = 0, char fill = ',') => new(name, null, 1.5m, Rows(fill), revision);
    static UploadedDocument Upload(byte[] bytes) => new(bytes, DocumentKinds.Png, "a.png", "");
    static string Doc(params string[] sources) => JsonSerializer.Serialize(new
    {
        v = 1, artboard = new { width = 128, height = 128, background = "#000000" },
        layers = new object[] { new { id = "base", name = "Base", kind = "base", visible = true, locked = false, opacity = 100 }, new { id = "elements", name = "Elementos", kind = "elements", visible = true, locked = false, opacity = 100 } },
        elements = sources.Select((s, i) => new { id = "e" + i, layer = "base", type = "image", src = s, x = 0, y = 0, width = 128, height = 128, rotation = 0, opacity = 100, visible = true, locked = false, flipX = false, flipY = false }),
    }, Web);
    async Task<JsonElement[]> List(string kind, Guid doc) => [.. J(await versions.ListAsync(campaign.Id, kind, doc, Master, default)).GetProperty("items").EnumerateArray()];

    [Fact]
    public async Task Tile_map_saves_record_deduplicated_automatic_versions_with_the_editor_document()
    {
        var map = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles("Bosque"), default);
        // Mesmo conteúdo salvo de novo (só a revisão muda): nenhuma versão repetida.
        map = await assets.SaveTileMapAsync(campaign.Id, map.Id, Master, Tiles("Bosque", map.Revision) with { KeepFolder = true }, default);
        Assert.Single(await List(DocumentVersionKinds.TileMap, map.Id));
        map = await assets.SaveTileMapAsync(campaign.Id, map.Id, Master, Tiles("Bosque", map.Revision, '.') with { KeepFolder = true }, default);
        var items = await List(DocumentVersionKinds.TileMap, map.Id);
        Assert.Equal(2, items.Length);
        Assert.True(items[0].GetProperty("auto").GetBoolean());
        Assert.Equal(map.Revision, items[0].GetProperty("revision").GetInt32());

        var oldest = J(await versions.GetAsync(campaign.Id, items[1].GetProperty("id").GetGuid(), Master, default));
        var payload = oldest.GetProperty("payload");
        Assert.Equal(("Bosque", 1.5m), (payload.GetProperty("name").GetString(), payload.GetProperty("scaleMeters").GetDecimal()));
        Assert.Equal(Rows()[2], payload.GetProperty("rows")[2].GetString());
        Assert.Equal("base", payload.GetProperty("layers")[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task Retention_keeps_twenty_automatic_and_named_versions_survive()
    {
        var map = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles("Mapa 0"), default);
        var named = J(await versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.TileMap, map.Id, "  Antes da reforma  "), default));
        // A versão automática idêntica passa a ser nomeada (sem duplicar o conteúdo).
        Assert.Equal(("Antes da reforma", false), (named.GetProperty("label").GetString(), named.GetProperty("auto").GetBoolean()));
        Assert.Single(await List(DocumentVersionKinds.TileMap, map.Id));
        for (var i = 1; i <= 25; i++) map = await assets.SaveTileMapAsync(campaign.Id, map.Id, Master, Tiles($"Mapa {i}", map.Revision) with { KeepFolder = true }, default);
        var items = await List(DocumentVersionKinds.TileMap, map.Id);
        Assert.Equal(DocumentVersionModel.MaxAuto, items.Count(v => v.GetProperty("auto").GetBoolean()));
        Assert.Contains(items, v => v.GetProperty("label").GetString() == "Antes da reforma");
        var newest = J(await versions.GetAsync(campaign.Id, items[0].GetProperty("id").GetGuid(), Master, default));
        Assert.Equal("Mapa 25", newest.GetProperty("payload").GetProperty("name").GetString());

        Assert.Equal(400, await Status(() => versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.TileMap, map.Id, " "), default)));
        Assert.Equal(400, await Status(() => versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.TileMap, map.Id, new string('x', 81)), default)));
        Assert.Equal(400, await Status(() => versions.CreateAsync(campaign.Id, Master, new("sheet", map.Id, "x"), default)));
        Assert.Equal(400, await Status(() => versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.ImageMap, map.Id, "x"), default)));
        for (var i = 0; i < DocumentVersionModel.MaxNamed - 1; i++) await versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.TileMap, map.Id, $"Marco {i}"), default);
        Assert.Equal(409, await Status(() => versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.TileMap, map.Id, "Demais"), default)));
        var auto = (await List(DocumentVersionKinds.TileMap, map.Id)).First(v => v.GetProperty("auto").GetBoolean()).GetProperty("id").GetGuid();
        Assert.Equal(409, await Status(() => versions.RenameAsync(campaign.Id, auto, Master, new("Demais"), default)));
    }

    [Fact]
    public async Task Versions_are_master_only_and_leave_with_the_document()
    {
        var map = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles("Bosque"), default);
        var id = (await List(DocumentVersionKinds.TileMap, map.Id))[0].GetProperty("id").GetGuid();
        Assert.Equal(403, await Status(() => versions.ListAsync(campaign.Id, DocumentVersionKinds.TileMap, map.Id, Player, default)));
        Assert.Equal(403, await Status(() => versions.GetAsync(campaign.Id, id, Player, default)));
        Assert.Equal(404, await Status(() => versions.GetAsync(campaign.Id, id, Stranger, default)));
        Assert.Equal(403, await Status(() => versions.CreateAsync(campaign.Id, Player, new(DocumentVersionKinds.TileMap, map.Id, "x"), default)));
        Assert.Equal(404, await Status(() => versions.CreateAsync(campaign.Id, Stranger, new(DocumentVersionKinds.TileMap, map.Id, "x"), default)));
        Assert.Equal(403, await Status(() => versions.DeleteAsync(campaign.Id, id, Player, default)));
        Assert.Equal(404, await Status(() => versions.GetAsync(campaign.Id, Guid.NewGuid(), Master, default)));

        var renamed = J(await versions.RenameAsync(campaign.Id, id, Master, new("Primeira"), default));
        Assert.Equal(("Primeira", false), (renamed.GetProperty("label").GetString(), renamed.GetProperty("auto").GetBoolean()));
        campaign.ArchivedAt = DateTime.UtcNow; await db.SaveChangesAsync();
        Assert.Equal(409, await Status(() => versions.CreateAsync(campaign.Id, Master, new(DocumentVersionKinds.TileMap, map.Id, "x"), default)));
        Assert.Single(await List(DocumentVersionKinds.TileMap, map.Id));
        campaign.ArchivedAt = null; await db.SaveChangesAsync();

        await assets.DeleteMapAsync(campaign.Id, map.Id, Master, default);
        Assert.False(await db.Set<DocumentVersion>().AnyAsync(v => v.DocumentId == map.Id));
    }

    [Fact]
    public async Task Scene_versions_hold_the_preparation_and_are_deleted_with_the_scene()
    {
        var map = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles("Bosque"), default);
        var created = J(await scenes.SaveSceneAsync(campaign.Id, null, new("Emboscada", "Na trilha", SceneKinds.Map, null, map.Key, "Vocês ouvem passos.", "Os bandidos fogem", null), Master, default));
        var sceneId = created.GetProperty("id").GetGuid();
        await scenes.SaveSceneAsync(campaign.Id, sceneId, new("Emboscada II", "Na trilha", SceneKinds.Map, null, map.Key, "Vocês ouvem passos.", "Os bandidos fogem", null, Revision: created.GetProperty("revision").GetInt32()), Master, default);
        var items = await List(DocumentVersionKinds.Scene, sceneId);
        Assert.Equal(2, items.Length);
        var first = J(await versions.GetAsync(campaign.Id, items[1].GetProperty("id").GetGuid(), Master, default)).GetProperty("payload");
        Assert.Equal(("Emboscada", "Os bandidos fogem", map.Key), (first.GetProperty("name").GetString(), first.GetProperty("privateNotes").GetString(), first.GetProperty("mapKey").GetString()));
        Assert.Equal(JsonValueKind.Array, first.GetProperty("prepared").ValueKind);

        await scenes.DeleteSceneAsync(campaign.Id, sceneId, Master, default);
        Assert.False(await db.Set<DocumentVersion>().AnyAsync(v => v.DocumentId == sceneId));
    }

    [Fact]
    public async Task Image_sources_stay_while_a_retained_version_uses_them_and_leave_after_retention()
    {
        var map = await assets.SaveMapAsync(campaign.Id, null, Master, new("Salão", null, 32, 1.5m), Upload(TestPng.Solid(128, 128, 70, 130, 180)), default);
        var source = J(await assets.AddSourceAsync(campaign.Id, map.Id, Master, "Árvore", Upload(TestPng.Solid(64, 64, 0, 0, 0, 0)), default));
        var sourceId = source.GetProperty("id").GetGuid();
        var flat = Upload(TestPng.Solid(128, 128, 70, 130, 180));
        var saved = J(await assets.SaveCompositionAsync(campaign.Id, map.Id, Master, new(Doc("asset:" + sourceId), map.Revision, "Salão", "v0", 32, 1.5m), flat, default));
        var revision = saved.GetProperty("map").GetProperty("revision").GetInt32();
        var first = (await List(DocumentVersionKinds.ImageMap, map.Id))[0].GetProperty("id").GetGuid();
        var payload = J(await versions.GetAsync(campaign.Id, first, Master, default)).GetProperty("payload");
        Assert.Equal("asset:" + sourceId, payload.GetProperty("composition").GetProperty("elements")[0].GetProperty("src").GetString());
        Assert.Equal(32, payload.GetProperty("gridPixels").GetInt32());

        // A fonte deixa de ser usada pelo documento, mas a versão anterior ainda a referencia.
        for (var i = 1; i <= DocumentVersionModel.MaxAuto - 1; i++)
        {
            saved = J(await assets.SaveCompositionAsync(campaign.Id, map.Id, Master, new(Doc(), revision, "Salão", $"v{i}", 32, 1.5m), flat, default));
            revision = saved.GetProperty("map").GetProperty("revision").GetInt32();
        }
        Assert.True(await db.Set<CampaignMap>().AnyAsync(m => m.Id == sourceId));
        // A versão que usava a fonte sai da retenção: a fonte sai junto.
        await assets.SaveCompositionAsync(campaign.Id, map.Id, Master, new(Doc(), revision, "Salão", "final", 32, 1.5m), flat, default);
        Assert.False(await db.Set<CampaignMap>().AnyAsync(m => m.Id == sourceId));
        Assert.Equal(DocumentVersionModel.MaxAuto, (await List(DocumentVersionKinds.ImageMap, map.Id)).Length);
    }
}
