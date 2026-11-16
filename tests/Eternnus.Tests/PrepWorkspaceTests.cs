using System.Text.Json;
using Eternnus.Web;
using ImageMagick;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Preparação unificada (ADR-081): explorador, pastas por categoria, mover/copiar/renomear, camadas e composição (SQLite).</summary>
public sealed class PrepWorkspaceTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    PrepWorkspaceService prep = null!;
    PreparationService scenes = null!;
    CampaignAssetsService assets = null!;
    SessionService sessions = null!;
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player", Stranger = "stranger";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Stranger }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Movement = 9 };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        prep = new PrepWorkspaceService(db);
        scenes = new PreparationService(db, TimeProvider.System);
        assets = new CampaignAssetsService(db);
        sessions = new SessionService(db, new SessionSignals(), TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;
    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, Web);
    static Guid IdOf(object o) => J(o).GetProperty("id").GetGuid();
    static PrepItemsInput Items(string category, Guid? folder, params (string Type, Guid Id)[] items) => new(category, folder, items.Select(i => (PrepItemRef?)new PrepItemRef(i.Type, i.Id)).ToList());

    static string[] Rows(char fill = ',') => ["SSS" + new string(fill, 5), "SSS" + new string(fill, 5), .. Enumerable.Range(0, 6).Select(_ => new string(fill, 8))];
    static string[] Empty() => Enumerable.Range(0, 8).Select(_ => new string('_', 8)).ToArray();
    static TileLayerInput Layer(string id, string kind, string[] rows, bool visible = true) => new(id, id, kind, visible, false, 100, rows);
    static TileMapInput Tiles(List<TileLayerInput?>? layers, int revision = 0) => new("Bosque", null, 1.5m, Rows(), revision, Layers: layers);

    static byte[] Png(int width, int height, bool alpha = false)
    {
        using var image = new MagickImage(alpha ? MagickColors.Transparent : MagickColors.SteelBlue, (uint)width, (uint)height);
        return image.ToByteArray(MagickFormat.Png);
    }
    static UploadedDocument Upload(byte[] bytes) => new(bytes, DocumentKinds.Png, "a.png", "");

    async Task<CampaignMapView> ImageMapAsync(string name = "Salão", int size = 128) =>
        await assets.SaveMapAsync(campaign.Id, null, Master, new(name, null, 32, 1.5m), Upload(Png(size, size)), default);

    static string Doc(int width, int height, params string[] sources) => JsonSerializer.Serialize(new
    {
        v = 1, artboard = new { width, height, background = "#000000" },
        layers = new object[] { new { id = "base", name = "Base", kind = "base", visible = true, locked = false, opacity = 100 }, new { id = "elements", name = "Elementos", kind = "elements", visible = true, locked = false, opacity = 100 } },
        elements = sources.Select((s, i) => new { id = "e" + i, layer = "base", type = "image", src = s, x = -10, y = -10, width = width + 20, height = height + 20, rotation = 0, opacity = 100, visible = true, locked = false, flipX = false, flipY = false }),
    }, Web);
    static MapCompositionInput Save(string doc, int revision) => new(doc, revision, "Salão", "Resumo", 32, 1.5m);

    [Fact]
    public async Task Explorer_lists_the_three_categories_without_portraits_sources_or_official_maps()
    {
        var sceneFolder = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("Ato I", null, PrepCategories.Scenes), default));
        var npcFolder = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("Vilões", null, PrepCategories.Characters), default));
        await prep.CreateFolderAsync(campaign.Id, Master, new("Masmorras", null, PrepCategories.Maps), default);
        var tiles = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(null) with { SourceKey = "crypt", Summary = "Mata" }, default);
        var scene = IdOf(await scenes.SaveSceneAsync(campaign.Id, null, new("Emboscada", null, SceneKinds.Map, null, tiles.Key, null, null, null, FolderId: sceneFolder), Master, default));
        var npc = IdOf(await scenes.SaveNpcAsync(campaign.Id, null, new("Corvo", null, null, "enemy", null, FolderId: npcFolder), Master, default));
        db.AddRange(new CampaignMap { CampaignId = campaign.Id, Name = "Retrato", Purpose = CampaignAssetPurposes.Portrait, Content = [1] },
            new CampaignMap { CampaignId = campaign.Id, Name = "Fonte", Purpose = CampaignAssetPurposes.Layer, OwnerMapId = tiles.Id, Content = [1] });
        await db.SaveChangesAsync();

        var e = J(await prep.ExplorerAsync(campaign.Id, Master, default));
        Assert.Equal(3, e.GetProperty("folders").GetArrayLength());
        var map = Assert.Single(e.GetProperty("maps").EnumerateArray());
        Assert.Equal(("tiles", "crypt", "Mata", 1, false), (map.GetProperty("origin").GetString(), map.GetProperty("sourceKey").GetString(), map.GetProperty("summary").GetString(), map.GetProperty("scenes").GetInt32(), map.GetProperty("inUse").GetBoolean()));
        Assert.True(map.TryGetProperty("rows", out _));
        var s = Assert.Single(e.GetProperty("scenes").EnumerateArray());
        Assert.Equal((scene, sceneFolder, "Bosque"), (s.GetProperty("id").GetGuid(), s.GetProperty("folderId").GetGuid(), s.GetProperty("mapName").GetString()));
        var c = Assert.Single(e.GetProperty("characters").EnumerateArray());
        Assert.Equal((npc, npcFolder), (c.GetProperty("id").GetGuid(), c.GetProperty("folderId").GetGuid()));
        Assert.Equal(100, e.GetProperty("limits").GetProperty("foldersPerCategory").GetInt32());
        Assert.False(e.GetProperty("archived").GetBoolean());
        Assert.DoesNotContain("Ruínas da Cripta", e.ToString()); Assert.DoesNotContain("Retrato", e.ToString()); Assert.DoesNotContain("Fonte", e.ToString());
        // Acervo antigo continua só com pastas de mapas; categoria de imagem "layer" nunca é aceita do cliente.
        Assert.Single(J(await assets.MapTreeAsync(campaign.Id, Master, null, 1, default)).GetProperty("folders").EnumerateArray());
        Assert.Equal(400, await Status(() => assets.MapTreeAsync(campaign.Id, Master, null, 1, default, CampaignAssetPurposes.Layer)));
        // Pasta de outra categoria é recusada na criação.
        Assert.Equal(400, await Status(() => scenes.SaveNpcAsync(campaign.Id, null, new("X", null, null, "enemy", null, FolderId: sceneFolder), Master, default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(null) with { FolderId = sceneFolder }, default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(null) with { SourceKey = "inexistente" }, default)));
    }

    [Fact]
    public async Task Prep_routes_are_master_only_and_archived_campaigns_reject_writes()
    {
        Assert.Equal(403, await Status(() => prep.ExplorerAsync(campaign.Id, Player, default)));
        Assert.Equal(404, await Status(() => prep.ExplorerAsync(campaign.Id, Stranger, default)));
        Assert.Equal(403, await Status(() => prep.CreateFolderAsync(campaign.Id, Player, new("X", null, PrepCategories.Scenes), default)));
        Assert.Equal(404, await Status(() => prep.MoveAsync(campaign.Id, Stranger, Items(PrepCategories.Scenes, null, ("scene", Guid.NewGuid())), default)));
        Assert.Equal(400, await Status(() => prep.CreateFolderAsync(campaign.Id, Master, new("X", null, "outros"), default)));
        campaign.ArchivedAt = DateTime.UtcNow; await db.SaveChangesAsync();
        Assert.True(J(await prep.ExplorerAsync(campaign.Id, Master, default)).GetProperty("archived").GetBoolean());
        Assert.Equal(409, await Status(() => prep.CreateFolderAsync(campaign.Id, Master, new("X", null, PrepCategories.Scenes), default)));
    }

    [Fact]
    public async Task Folders_have_limits_per_category_depth_and_only_empty_ones_are_deleted()
    {
        for (var i = 0; i < CampaignAssetsService.MaxFolders; i++) db.Add(new CampaignMapFolder { CampaignId = campaign.Id, Name = "C" + i, Category = PrepCategories.Scenes });
        await db.SaveChangesAsync();
        Assert.Equal(409, await Status(() => prep.CreateFolderAsync(campaign.Id, Master, new("Excesso", null, PrepCategories.Scenes), default)));
        await assets.CreateFolderAsync(campaign.Id, Master, new("Mapas ainda cabem", null), default);
        Guid? parent = null;
        for (var i = 0; i < 8; i++) parent = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new($"N{i}", parent, PrepCategories.Characters), default));
        Assert.Equal(400, await Status(() => prep.CreateFolderAsync(campaign.Id, Master, new("Fundo", parent, PrepCategories.Characters), default)));
        Assert.Equal(400, await Status(() => prep.CreateFolderAsync(campaign.Id, Master, new("Mista", parent, PrepCategories.Maps), default)));
        var npc = IdOf(await scenes.SaveNpcAsync(campaign.Id, null, new("Corvo", null, null, "enemy", null, FolderId: parent), Master, default));
        Assert.Equal(409, await Status(() => prep.DeleteFolderAsync(campaign.Id, parent!.Value, Master, default)));
        await scenes.DeleteNpcAsync(campaign.Id, npc, Master, default);
        db.ChangeTracker.Clear();
        await prep.DeleteFolderAsync(campaign.Id, parent!.Value, Master, default);
        // Rota antiga do acervo só enxerga pastas de mapas.
        var sceneFolder = await db.Set<CampaignMapFolder>().FirstAsync(f => f.Category == PrepCategories.Scenes);
        Assert.Equal(404, await Status(() => assets.DeleteFolderAsync(campaign.Id, sceneFolder.Id, Master, default)));
    }

    [Fact]
    public async Task Rename_checks_lengths_and_revisions()
    {
        var scene = IdOf(await scenes.SaveSceneAsync(campaign.Id, null, new("Prólogo", null, SceneKinds.Text, null, null, null, null, null), Master, default));
        var renamed = J(await prep.RenameAsync(campaign.Id, Master, new("scene", scene, "  Abertura  ", 1), default));
        Assert.Equal(2, renamed.GetProperty("revision").GetInt32());
        Assert.Equal(409, await Status(() => prep.RenameAsync(campaign.Id, Master, new("scene", scene, "Velha", 1), default)));
        Assert.Equal(400, await Status(() => prep.RenameAsync(campaign.Id, Master, new("scene", scene, new string('a', 81), 2), default)));
        var map = await ImageMapAsync();
        Assert.Equal(400, await Status(() => prep.RenameAsync(campaign.Id, Master, new("map", map.Id, new string('a', 121), map.Revision), default)));
        Assert.Equal(map.Revision + 1, J(await prep.RenameAsync(campaign.Id, Master, new("map", map.Id, "Salão nobre", map.Revision), default)).GetProperty("revision").GetInt32());
        Assert.Equal(409, await Status(() => prep.RenameAsync(campaign.Id, Master, new("map", map.Id, "Outro", map.Revision), default)));
        var npc = IdOf(await scenes.SaveNpcAsync(campaign.Id, null, new("Corvo", null, null, "enemy", null), Master, default));
        Assert.Equal(400, await Status(() => prep.RenameAsync(campaign.Id, Master, new("character", npc, new string('a', 41), 1), default)));
        var folder = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("A", null, PrepCategories.Maps), default));
        Assert.Equal(JsonValueKind.Null, J(await prep.RenameAsync(campaign.Id, Master, new("folder", folder, "B", 99), default)).GetProperty("revision").ValueKind);
        db.ChangeTracker.Clear();
        Assert.Equal(("Abertura", "Salão nobre", "B"), ((await db.Scenes.SingleAsync()).Name, (await db.Set<CampaignMap>().SingleAsync(m => m.Id == map.Id)).Name, (await db.Set<CampaignMapFolder>().SingleAsync()).Name));
    }

    [Fact]
    public async Task Move_requires_compatible_categories_rejects_cycles_and_keeps_revisions()
    {
        var mapsFolder = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("Mapas", null, PrepCategories.Maps), default));
        var a = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("A", null, PrepCategories.Scenes), default));
        var b = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("B", a, PrepCategories.Scenes), default));
        var scene = IdOf(await scenes.SaveSceneAsync(campaign.Id, null, new("Prólogo", null, SceneKinds.Text, null, null, null, null, null), Master, default));
        var ex = await Assert.ThrowsAsync<RuleException>(() => prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Maps, mapsFolder, ("scene", scene)), default));
        Assert.Equal((400, "Cenas só ficam em pastas de Cenas."), (ex.Status, ex.Message));
        Assert.Equal(400, await Status(() => prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Scenes, mapsFolder, ("scene", scene)), default)));
        Assert.Equal(400, await Status(() => prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Scenes, b, ("folder", a)), default)));
        Assert.Equal(400, await Status(() => prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Scenes, a, ("folder", a)), default)));
        // Tudo ou nada: um item inexistente desfaz o lote.
        Assert.Equal(404, await Status(() => prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Scenes, b, ("scene", scene), ("scene", Guid.NewGuid())), default)));
        db.ChangeTracker.Clear();
        Assert.Null((await db.Scenes.SingleAsync()).FolderId);
        await prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Scenes, b, ("scene", scene)), default);
        await prep.MoveAsync(campaign.Id, Master, Items(PrepCategories.Scenes, null, ("folder", b)), default);
        db.ChangeTracker.Clear();
        var moved = await db.Scenes.SingleAsync();
        Assert.Equal((b, 1), (moved.FolderId, moved.Revision));
        Assert.Null((await db.Set<CampaignMapFolder>().SingleAsync(f => f.Id == b)).ParentId);
    }

    [Fact]
    public async Task Copy_duplicates_scenes_characters_and_folders_recursively_all_or_nothing()
    {
        var root = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("Ato", null, PrepCategories.Scenes), default));
        var child = IdOf(await prep.CreateFolderAsync(campaign.Id, Master, new("Cena 1", root, PrepCategories.Scenes), default));
        List<EditorLayer?> layers = [new("base", "Base", "base"), new("elements", "Elementos", "elements"), new("npcs", "Inimigos", "custom", Opacity: 60)];
        var scene = IdOf(await scenes.SaveSceneAsync(campaign.Id, null, new("Cripta", null, SceneKinds.Map, null, "crypt", null, null, null, LayerMode: SceneLayerModes.Scene, FolderId: child, Layers: layers,
            Prepared: [new(null, null, "Sentinela", "enemy", 3, 8, Layer: "npcs", Size: 150)]), Master, default));
        db.Add(new CampaignMapLayer { CampaignId = campaign.Id, MapKey = ScenePrep.LayerKey("crypt", scene), State = new MapFogState { Fog = true, Cells = [], Explored = new() { ["x"] = "AA" } }.Serialize() });
        var npc = IdOf(await scenes.SaveNpcAsync(campaign.Id, null, new("Corvo", "Resumo", "Notas", "enemy", [new() { Label = "Vida", Value = 3, Max = 10 }], SharedWithPlayers: true), Master, default));
        await db.SaveChangesAsync();

        var created = J(await prep.CopyAsync(campaign.Id, Master, Items(PrepCategories.Scenes, null, ("folder", root)), default)).GetProperty("created");
        Assert.Equal("folder", Assert.Single(created.EnumerateArray()).GetProperty("type").GetString());
        db.ChangeTracker.Clear();
        Assert.Equal(4, await db.Set<CampaignMapFolder>().CountAsync());
        var copy = await db.Scenes.SingleAsync(s => s.Id != scene);
        Assert.NotEqual(child, copy.FolderId);
        Assert.Equal(("Cripta", "npcs", 150, 3), (copy.Name, copy.Prepared.Single().Layer, copy.Prepared.Single().Size, EditorLayers.Parse(copy.Layers).Count));
        var ownCopy = await db.Set<CampaignMapLayer>().SingleAsync(l => l.MapKey == ScenePrep.LayerKey("crypt", copy.Id));
        Assert.Empty(MapFogState.Parse(ownCopy.State)!.Explored);

        var npcCopy = IdOf(Assert.Single(J(await prep.CopyAsync(campaign.Id, Master, Items(PrepCategories.Characters, null, ("character", npc)), default)).GetProperty("created").EnumerateArray()));
        var c = await db.MasterCharacters.AsNoTracking().SingleAsync(m => m.Id == npcCopy);
        Assert.Equal(("Corvo (cópia)", (Guid?)null, false, "Notas", 3), (c.Name, c.SourceId, c.SharedWithPlayers, c.Notes, c.Resources.Single().Value));

        for (var i = await db.Scenes.CountAsync(); i < PreparationService.MaxScenes; i++) db.Add(new Scene { CampaignId = campaign.Id, Name = "S" + i, Kind = SceneKinds.Text });
        await db.SaveChangesAsync();
        var before = await db.Set<CampaignMapFolder>().CountAsync();
        Assert.Equal(409, await Status(() => prep.CopyAsync(campaign.Id, Master, Items(PrepCategories.Scenes, null, ("folder", root)), default)));
        db.ChangeTracker.Clear();
        Assert.Equal((PreparationService.MaxScenes, before), (await db.Scenes.CountAsync(), await db.Set<CampaignMapFolder>().CountAsync()));
    }

    [Fact]
    public async Task Map_copy_duplicates_sources_rewrites_composition_and_copies_fog_without_explorations()
    {
        var map = await ImageMapAsync();
        var source = J(await assets.AddSourceAsync(campaign.Id, map.Id, Master, "Árvore", Upload(Png(64, 64, alpha: true)), default));
        var key = source.GetProperty("key").GetString()!;
        var saved = J(await assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, key), map.Revision), Upload(Png(128, 128)), default));
        db.Add(new CampaignMapLayer { CampaignId = campaign.Id, MapKey = map.Key, State = new MapFogState { Fog = true, Cells = [], Explored = new() { ["p"] = "AA" } }.Serialize() });
        await db.SaveChangesAsync();
        var copyId = IdOf(Assert.Single(J(await prep.CopyAsync(campaign.Id, Master, Items(PrepCategories.Maps, null, ("map", map.Id)), default)).GetProperty("created").EnumerateArray()));
        db.ChangeTracker.Clear();
        var copy = await db.Set<CampaignMap>().SingleAsync(m => m.Id == copyId);
        var copySource = await db.Set<CampaignMap>().SingleAsync(m => m.OwnerMapId == copyId);
        Assert.Equal(("Salão (cópia)", "Resumo", CampaignAssetPurposes.Layer), (copy.Name, copy.Summary, copySource.Purpose));
        Assert.Contains("asset:" + copySource.Id, copy.Composition); Assert.DoesNotContain(key, copy.Composition);
        Assert.Empty(MapFogState.Parse((await db.Set<CampaignMapLayer>().SingleAsync(l => l.MapKey == "asset:" + copyId)).State)!.Explored);
        Assert.Equal(2, J(await prep.ExplorerAsync(campaign.Id, Master, default)).GetProperty("maps").GetArrayLength());
        // Excluir o mapa remove as imagens-fonte dele.
        await assets.DeleteMapAsync(campaign.Id, copyId, Master, default);
        Assert.False(await db.Set<CampaignMap>().AnyAsync(m => m.OwnerMapId == copyId));
        Assert.Equal(map.Revision + 1, saved.GetProperty("map").GetProperty("revision").GetInt32());
    }

    [Fact]
    public async Task Tile_layers_merge_into_effective_rows_and_expose_terrain()
    {
        var elements = Empty(); elements[4] = "___t____";
        var hidden = Empty(); hidden[5] = "____R___";
        var saved = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", Rows()), Layer("elements", "elements", elements), Layer("rocks", "custom", hidden, visible: false)]), default);
        Assert.Equal('t', saved.Rows[4][3]); Assert.Equal(',', saved.Rows[5][4]);
        Assert.Equal(',', saved.Terrain![4][3]);
        Assert.Equal(saved.Terrain, saved.Battle()!.Terrain);
        var read = await assets.TileMapAsync(campaign.Id, saved.Id, Master, default);
        Assert.Equal(3, read["layers"]!.AsArray().Count); Assert.Equal("___t____", read["layers"]![1]!["rows"]![4]!.GetValue<string>());
        // Mudar só camadas sem mudar a grade efetiva não exige reiniciar a preparação.
        db.Add(new Scene { CampaignId = campaign.Id, Name = "Usa", MapKey = saved.Key, Prepared = [new() { Label = "X", X = 1, Y = 6 }] }); await db.SaveChangesAsync();
        hidden[6] = "R_______";
        var same = await assets.SaveTileMapAsync(campaign.Id, saved.Id, Master, Tiles([Layer("base", "base", Rows()), Layer("elements", "elements", elements), Layer("rocks", "custom", hidden, visible: false)], saved.Revision), default);
        Assert.Single((await db.Scenes.SingleAsync()).Prepared);
        Assert.Equal(409, await Status(() => assets.SaveTileMapAsync(campaign.Id, saved.Id, Master, Tiles([Layer("base", "base", Rows()), Layer("elements", "elements", elements), Layer("rocks", "custom", hidden)], same.Revision), default)));
        // Mapa antigo sem camadas: Base sintetizada; sem objetos, sem terreno separado.
        var legacy = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(null), default);
        Assert.Null(legacy.Terrain);
        Assert.Equal(2, (await assets.TileMapAsync(campaign.Id, legacy.Id, Master, default))["layers"]!.AsArray().Count);
    }

    [Fact]
    public async Task Invalid_tile_layers_are_rejected()
    {
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", Rows())]), default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("elements", "elements", Empty()), Layer("base", "base", Rows())]), default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", Rows()), Layer("elements", "elements", Empty()), Layer("Bad Id", "custom", Empty())]), default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", Rows()), Layer("elements", "elements", Empty()[..7])]), default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", Empty()), Layer("elements", "elements", Empty())]), default)));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", Rows()), Layer("elements", "elements", Empty()) with { Opacity = 101 }]), default)));
        var many = new List<TileLayerInput?> { Layer("base", "base", Rows()), Layer("elements", "elements", Empty()) };
        for (var i = 0; i < 7; i++) many.Add(Layer("x" + i, "custom", Empty()));
        Assert.Equal(400, await Status(() => assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(many), default)));
    }

    [Fact]
    public async Task Players_never_receive_unmasked_terrain_on_the_live_board()
    {
        var walled = Rows(); walled[3] = "########";
        var elements = Empty(); elements[1] = "_____t__"; elements[6] = "__h_____";
        var map = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles([Layer("base", "base", walled), Layer("elements", "elements", elements)]), default);
        var session = IdOf(await sessions.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, map.Key), Master, default));
        await sessions.JoinAsync(session, null, Player, default);
        db.ChangeTracker.Clear();
        var player = J(await sessions.StateAsync(session, Player, default)).GetProperty("map");
        var rows = player.GetProperty("rows").EnumerateArray().Select(r => r.GetString()!).ToArray();
        var terrain = player.GetProperty("terrain").EnumerateArray().Select(r => r.GetString()!).ToArray();
        Assert.Contains('?', rows[6]); Assert.Contains('?', terrain[6]);
        for (var y = 0; y < rows.Length; y++) for (var x = 0; x < rows[y].Length; x++) Assert.Equal(rows[y][x] == '?', terrain[y][x] == '?');
        Assert.DoesNotContain(',', terrain[6]);
        var master = J(await sessions.StateAsync(session, Master, default)).GetProperty("map");
        Assert.Equal(",,,,,,,,", master.GetProperty("terrain")[6].GetString());
    }

    [Fact]
    public async Task Composition_validates_sources_dimensions_and_collects_unused_sources()
    {
        var map = await ImageMapAsync();
        var legacy = J(await assets.CompositionAsync(campaign.Id, map.Id, Master, default)).GetProperty("composition");
        Assert.Equal("self", legacy.GetProperty("elements")[0].GetProperty("src").GetString());
        Assert.Equal(128, legacy.GetProperty("artboard").GetProperty("width").GetInt32());
        var other = await ImageMapAsync("Outro");
        var foreign = J(await assets.AddSourceAsync(campaign.Id, other.Id, Master, null, Upload(Png(64, 64)), default)).GetProperty("key").GetString()!;
        var flat = Upload(Png(128, 128));
        Assert.Equal(400, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, "https://example.com/a.png"), map.Revision), flat, default)));
        Assert.Equal(400, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, foreign), map.Revision), flat, default)));
        Assert.Equal(400, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(256, 128, "self"), map.Revision), flat, default)));
        Assert.Equal(400, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, "self").Replace("\"v\":1", "\"v\":1,\"script\":1"), map.Revision), flat, default)));
        Assert.Equal(400, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, "self").Replace("\"image\"", "\"video\""), map.Revision), flat, default)));
        Assert.Equal(409, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, "self"), map.Revision + 3), flat, default)));
        Assert.Equal(403, await Status(() => assets.SaveCompositionAsync(campaign.Id, map.Id, Player, Save(Doc(128, 128, "self"), map.Revision), flat, default)));

        // "self" vira imagem-fonte do mapa; salvar sem ela a remove.
        var saved = J(await assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128, "self"), map.Revision), flat, default));
        var snapshot = await db.Set<CampaignMap>().AsNoTracking().SingleAsync(m => m.OwnerMapId == map.Id);
        Assert.Equal("asset:" + snapshot.Id, saved.GetProperty("composition").GetProperty("elements")[0].GetProperty("src").GetString());
        var revision = saved.GetProperty("map").GetProperty("revision").GetInt32();
        await assets.SaveCompositionAsync(campaign.Id, map.Id, Master, Save(Doc(128, 128), revision), flat, default);
        Assert.False(await db.Set<CampaignMap>().AnyAsync(m => m.Id == snapshot.Id));
        // Mapa de tiles usa o próprio editor.
        var tiles = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(null), default);
        Assert.Equal(409, await Status(() => assets.CompositionAsync(campaign.Id, tiles.Id, Master, default)));
    }

    [Fact]
    public async Task Map_sources_are_master_only_bounded_and_never_listed_or_used_as_npc_images()
    {
        var map = await ImageMapAsync();
        Assert.Equal(403, await Status(() => assets.AddSourceAsync(campaign.Id, map.Id, Player, null, Upload(Png(64, 64)), default)));
        var source = J(await assets.AddSourceAsync(campaign.Id, map.Id, Master, "Árvore", Upload(Png(64, 64, alpha: true)), default));
        var id = source.GetProperty("id").GetGuid();
        Assert.Equal(($"/api/campaigns/{campaign.Id}/assets/maps/{id}/image", 64), (source.GetProperty("imageUrl").GetString(), source.GetProperty("width").GetInt32()));
        Assert.Equal(DocumentKinds.Png, CampaignAssetsService.ImageType(await assets.ImageAsync(campaign.Id, id, Master, default)));
        Assert.Equal(404, await Status(() => assets.ImageAsync(campaign.Id, id, Player, default)));
        Assert.Equal(400, await Status(() => scenes.SaveNpcAsync(campaign.Id, null, new("Corvo", null, null, "enemy", null, ImageUrl: "asset:" + id), Master, default)));
        Assert.Equal(404, await Status(() => assets.DeleteMapAsync(campaign.Id, id, Master, default)));
        // Cópia de imagem da campanha: mapas e retratos, nunca mapas de tiles.
        var tiles = await assets.SaveTileMapAsync(campaign.Id, null, Master, Tiles(null), default);
        Assert.Equal(404, await Status(() => assets.CopySourceAsync(campaign.Id, map.Id, Master, new("asset:" + tiles.Id), default)));
        Assert.Equal(400, await Status(() => assets.CopySourceAsync(campaign.Id, map.Id, Master, new("https://example.com"), default)));
        Assert.Equal(map.Name, J(await assets.CopySourceAsync(campaign.Id, map.Id, Master, new(map.Key), default)).GetProperty("name").GetString());
        for (var i = 2; i < MapComposition.MaxSources; i++) db.Add(new CampaignMap { CampaignId = campaign.Id, OwnerMapId = map.Id, Purpose = CampaignAssetPurposes.Layer, Content = [1] });
        await db.SaveChangesAsync();
        Assert.Equal(409, await Status(() => assets.CopySourceAsync(campaign.Id, map.Id, Master, new(map.Key), default)));
        Assert.Equal(1, J(await prep.ExplorerAsync(campaign.Id, Master, default)).GetProperty("maps").EnumerateArray().Count(m => m.GetProperty("origin").GetString() == "image"));
    }

    [Fact]
    public async Task Scene_layers_and_token_layers_round_trip_and_survive_duplicate()
    {
        List<EditorLayer?> layers = [new("base", "Base", "base"), new("elements", "Elementos", "elements"), new("npcs", "Inimigos", "custom", Locked: true)];
        var id = IdOf(await scenes.SaveSceneAsync(campaign.Id, null, new("Cripta", null, SceneKinds.Map, null, "crypt", null, null, null, Layers: layers,
            Prepared: [new(null, null, "A", "enemy", 3, 8, Layer: "npcs"), new(null, null, "B", "enemy", 4, 8, Layer: "base"), new(null, null, "C", "enemy", 5, 8, Layer: "ghost")]), Master, default));
        var read = J(await scenes.SceneAsync(campaign.Id, id, Master, default));
        Assert.Equal(3, read.GetProperty("layers").GetArrayLength());
        Assert.True(read.GetProperty("layers")[2].GetProperty("locked").GetBoolean());
        Assert.Equal(["npcs", "elements", "elements"], read.GetProperty("prepared").EnumerateArray().Select(t => t.GetProperty("layer").GetString()));
        Assert.Equal(400, await Status(() => scenes.SaveSceneAsync(campaign.Id, id, new("Cripta", null, SceneKinds.Map, null, "crypt", null, null, null, Revision: 1, Layers: [new("elements", "E", "elements")]), Master, default)));
        // Remover a camada devolve os marcadores dela para Elementos.
        await scenes.SaveSceneAsync(campaign.Id, id, new("Cripta", null, SceneKinds.Map, null, "crypt", null, null, null, Revision: 1, Layers: layers[..2]), Master, default);
        db.ChangeTracker.Clear();
        Assert.All((await db.Scenes.SingleAsync()).Prepared, t => Assert.Equal("elements", t.Layer));
        var copy = IdOf(await scenes.DuplicateSceneAsync(campaign.Id, id, Master, default));
        var dup = J(await scenes.SceneAsync(campaign.Id, copy, Master, default));
        Assert.Equal(2, dup.GetProperty("layers").GetArrayLength());
        Assert.Equal(3, dup.GetProperty("prepared").GetArrayLength());
        var text = IdOf(await scenes.SaveSceneAsync(campaign.Id, null, new("Texto", null, SceneKinds.Text, null, null, null, null, null), Master, default));
        Assert.Equal(["base", "elements"], J(await scenes.SceneAsync(campaign.Id, text, Master, default)).GetProperty("layers").EnumerateArray().Select(l => l.GetProperty("id").GetString()));
    }
}
