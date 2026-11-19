using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Composição visual própria das cenas, pontos de entrada dos mapas, prioridade de posicionamento e entrega da camada à mesa (SQLite).
/// </summary>
public sealed class SceneCompositionTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    PreparationService prep = null!;
    CampaignAssetsService assets = null!;
    readonly Clock clock = new(new DateTimeOffset(2026, 11, 16, 21, 0, 0, TimeSpan.Zero));
    Campaign campaign = null!;
    Character hero = null!, ally = null!;
    const string Master = "master", Player = "player", Second = "second";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Second }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran", TableSettings = (TableSettings.Default with { PlayMode = PlayModes.Free }).Serialize() };
        hero = new Character { OwnerId = Player, Name = "Tharion", Hp = 10, MaxHp = 10 };
        ally = new Character { OwnerId = Second, Name = "Lyra", Hp = 10, MaxHp = 10 };
        db.AddRange(campaign, hero, ally, new Member { CampaignId = campaign.Id, UserId = Player }, new Member { CampaignId = campaign.Id, UserId = Second },
            new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = ally.Id });
        await db.SaveChangesAsync();
        var signals = new SessionSignals();
        service = new SessionService(db, signals, clock);
        prep = new PreparationService(db, clock);
        assets = new CampaignAssetsService(db, signals);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;
    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o, Web);
    static Guid IdOf(object o) => J(o).GetProperty("id").GetGuid();
    static UploadedDocument Upload(byte[] bytes) => new(bytes, DocumentKinds.Png, "a.png", "");

    /// <summary>Mapa de imagem 256 × 256 com grade de 32 px (8 × 8 casas; a primeira linha é de pontos de entrada).</summary>
    async Task<CampaignMapView> MapAsync(string name = "Salão", bool grid = true)
    {
        db.ChangeTracker.Clear();
        var map = await assets.SaveMapAsync(campaign.Id, null, Master, new(name, null, 32, 1.5m, 0, grid), Upload(TestPng.Solid(256, 256, 70, 130, 180)), default);
        db.ChangeTracker.Clear();
        return map;
    }
    async Task<Guid> SceneAsync(string name, string key, string kind = SceneKinds.Map, List<SceneTokenInput>? tokens = null, string? entry = null)
    {
        db.ChangeTracker.Clear();
        return IdOf(await prep.SaveSceneAsync(campaign.Id, null, new(name, "", kind, null, key, "", "", null, 0, 0, tokens, Entry: entry), Master, default));
    }
    async Task<JsonElement> Scene(Guid id) { db.ChangeTracker.Clear(); return J(await prep.SceneAsync(campaign.Id, id, Master, default)); }
    async Task<int> Revision(Guid scene) => (await Scene(scene)).GetProperty("revision").GetInt32();
    async Task<Guid> SessionAsync(string kind = MapKinds.Cartographic, string key = "valley")
    {
        var id = IdOf(await service.StartAsync(campaign.Id, new("Sessão", "", kind, key), Master, default));
        await service.JoinAsync(id, hero.Id, Player, default);
        db.ChangeTracker.Clear();
        return id;
    }
    async Task<List<SessionToken>> Tokens(Guid session) { db.ChangeTracker.Clear(); return await db.SessionTokens.Where(t => t.SessionId == session).ToListAsync(); }
    async Task<GameSession> Live(Guid session) { db.ChangeTracker.Clear(); return await db.Sessions.SingleAsync(s => s.Id == session); }

    static string Doc(int size, bool secret = false, params string[] sources) => JsonSerializer.Serialize(new
    {
        v = 1, artboard = new { width = size, height = size, background = "#000000" },
        layers = new object[]
        {
            new { id = "base", name = "Base", kind = "base", visible = true, locked = false, opacity = 100 },
            new { id = "elements", name = "Elementos", kind = "elements", visible = true, locked = false, opacity = 100 },
            new { id = "segredo", name = "Segredo", kind = "custom", visible = true, locked = false, opacity = 100, secret },
        },
        elements = sources.Select((s, i) => new { id = "e" + i, layer = "elements", type = "image", src = s, x = 0, y = 0, width = 64, height = 64 }),
    }, Web);
    static UploadedDocument Overlay(int size = 256) => Upload(TestPng.Solid(size, size, 255, 0, 0, 128));

    async Task<JsonElement> SaveComposition(Guid scene, string? composition, UploadedDocument? overlay, int? revision = null)
    {
        var rev = revision ?? await Revision(scene);
        db.ChangeTracker.Clear();
        var result = J(await assets.SaveSceneCompositionAsync(campaign.Id, scene, Master, composition, rev, overlay, default));
        db.ChangeTracker.Clear();
        return result;
    }
    async Task<Guid> SourceAsync(Guid scene)
    {
        db.ChangeTracker.Clear();
        var id = IdOf(await assets.AddSceneSourceAsync(campaign.Id, scene, Master, "Árvore", Upload(TestPng.Solid(64, 64, 0, 120, 0, 200)), default));
        db.ChangeTracker.Clear();
        return id;
    }
    async Task<int> SceneAssets(Guid scene) { db.ChangeTracker.Clear(); return await db.Set<CampaignMap>().CountAsync(m => m.OwnerSceneId == scene); }

    // ---------- Pontos de entrada ----------
    [Fact]
    public async Task Map_entries_are_validated_and_protected_by_revision()
    {
        var map = await MapAsync();
        var layer = J(await assets.LayerAsync(campaign.Id, map.Key, Master, default));
        Assert.True(layer.GetProperty("entriesEditable").GetBoolean());
        Assert.Equal(0, layer.GetProperty("entries").GetArrayLength());
        var revision = layer.GetProperty("mapRevision").GetInt32();
        db.ChangeTracker.Clear();
        var saved = J(await assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([new MapEntry("grupo", "Entrada do grupo", MapEntryKinds.Party, 5, 5, 2, 1)], revision), default));
        Assert.Equal(revision + 1, saved.GetProperty("revision").GetInt32());
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([], revision), default)));
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([new MapEntry("fora", "Fora", MapEntryKinds.Other, 7, 7, 2, 1)], revision + 1), default)));
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([new MapEntry("a", "A", MapEntryKinds.Party, 0, 0), new MapEntry("a", "B", MapEntryKinds.Enemies, 1, 1)], revision + 1), default)));
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([new MapEntry("a", "A", "boss", 0, 0)], revision + 1), default)));
        db.ChangeTracker.Clear();
        Assert.Equal(403, await Status(() => assets.SaveEntriesAsync(campaign.Id, map.Key, Player, new([], revision + 1), default)));
        db.ChangeTracker.Clear();
        Assert.Equal(404, await Status(() => assets.SaveEntriesAsync(campaign.Id, "crypt", Master, new([], 1), default)));
        Assert.False(J(await assets.LayerAsync(campaign.Id, "crypt", Master, default)).GetProperty("entriesEditable").GetBoolean());
        var entries = J(await assets.LayerAsync(campaign.Id, map.Key, Master, default)).GetProperty("entries");
        Assert.Equal("grupo", entries[0].GetProperty("id").GetString());
        // Imagem sem grade não tem pontos de entrada.
        var image = await MapAsync("Retrato do salão", grid: false);
        Assert.Equal(409, await Status(() => assets.SaveEntriesAsync(campaign.Id, image.Key, Master, new([], image.Revision), default)));
        // Grade menor: o ponto que não cabe sai do mapa.
        db.ChangeTracker.Clear();
        await assets.SaveMapAsync(campaign.Id, map.Id, Master, new("Salão", null, 64, 1.5m, revision + 1), null, default);
        db.ChangeTracker.Clear();
        Assert.Null((await db.Set<CampaignMap>().SingleAsync(m => m.Id == map.Id)).Entries);
    }

    [Fact]
    public void Placement_follows_prepared_then_scene_entry_then_map_party_then_spawns()
    {
        var map = new BattleMap("t", "Teste", MapKinds.Tileset, "", null, ["SS......", "........", "........", "........", "........", ".#......", "........", "........"]);
        var grid = FogGrid.Of(map, TableFog.Initial(map, TableSettings.Default));
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid(), d = Guid.NewGuid();
        var source = new List<SceneToken>
        {
            new() { CharacterId = a, X = 4, Y = 4 },
            new() { Label = "Lobo", X = 0, Y = 5 },
            new() { CharacterId = c, X = 1, Y = 5 }, // casa bloqueada: c usa a entrada
        };
        var entries = ScenePlacement.Entries(new SceneEntry(null, 0, 5, 3, 1), [new MapEntry("g", "Grupo", MapEntryKinds.Party, 6, 6, 1, 1)]);
        var plan = ScenePlacement.Plan(map, grid, source, [a, b, c, d], entries);
        (int, int) At(Guid id) => plan.Single(p => p.CharacterId == id) is var p ? (p.X, p.Y) : default;
        Assert.Equal((4, 4), At(a));                // preparado
        Assert.Equal((2, 5), At(b));                // entrada da cena, sem sobrepor o lobo nem a parede
        Assert.Equal((6, 6), At(c));                // área da cena cheia: entrada do grupo do mapa
        Assert.Equal((0, 0), At(d));                // depois, pontos S
        Assert.Contains(plan, p => p.CharacterId == null && p.X == 0 && p.Y == 5);
        Assert.Equal(plan.Count, plan.Select(p => (p.X, p.Y)).Distinct().Count());
        // Entrada que referencia um ponto inexistente é ignorada.
        Assert.Single(ScenePlacement.Entries(new SceneEntry("sumiu"), [new MapEntry("g", "Grupo", MapEntryKinds.Party, 6, 6, 1, 1)]));
    }

    [Fact]
    public async Task Table_uses_scene_entry_then_map_party_entry_also_for_late_joiners()
    {
        var map = await MapAsync();
        db.ChangeTracker.Clear();
        await assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([new MapEntry("grupo", "Entrada do grupo", MapEntryKinds.Party, 5, 5, 2, 1)], map.Revision), default);
        var withEntry = await SceneAsync("Portão", map.Key, entry: """{"x":1,"y":3,"w":2,"h":1}""");
        var byMap = await SceneAsync("Pátio", map.Key);
        Assert.Equal(400, await Status(() => SceneAsync("Ruim", map.Key, entry: """{"ref":"sumiu"}""")));
        Assert.Equal(400, await Status(() => SceneAsync("Ruim", map.Key, entry: """{"x":7,"y":7,"w":2,"h":1}""")));
        Assert.Equal(1, (await Scene(withEntry)).GetProperty("entry").GetProperty("x").GetInt32());
        var session = await SessionAsync();
        await service.PresentSceneAsync(session, new(withEntry, false), Master, default);
        Assert.Equal((1, 3), (await Tokens(session)).Single(t => t.CharacterId == hero.Id) is var h ? (h.X, h.Y) : default);
        // Quem chega no meio da cena entra pela mesma área.
        await service.JoinAsync(session, ally.Id, Second, default);
        Assert.Equal((2, 3), (await Tokens(session)).Single(t => t.CharacterId == ally.Id) is var l ? (l.X, l.Y) : default);
        db.ChangeTracker.Clear();
        await service.PresentSceneAsync(session, new(byMap, false), Master, default);
        var tokens = await Tokens(session);
        Assert.Equal((5, 5), tokens.Single(t => t.CharacterId == hero.Id) is var h2 ? (h2.X, h2.Y) : default);
        Assert.Equal((6, 5), tokens.Single(t => t.CharacterId == ally.Id) is var l2 ? (l2.X, l2.Y) : default);
        // Referência a um ponto do mapa; trocar o mapa da cena remove a entrada.
        db.ChangeTracker.Clear();
        await prep.SaveSceneAsync(campaign.Id, byMap, new("Pátio", "", SceneKinds.Map, null, map.Key, "", "", null, 0, await Revision(byMap), Entry: """{"ref":"grupo"}"""), Master, default);
        Assert.Equal("grupo", (await Scene(byMap)).GetProperty("entry").GetProperty("ref").GetString());
        db.ChangeTracker.Clear();
        await prep.SaveSceneAsync(campaign.Id, withEntry, new("Portão", "", SceneKinds.Map, null, "crypt", "", "", null, 0, await Revision(withEntry)), Master, default);
        Assert.Equal(JsonValueKind.Null, (await Scene(withEntry)).GetProperty("entry").ValueKind);
        Assert.Equal(2, J(await prep.ScenesAsync(campaign.Id, Master, default)).GetProperty("items").GetArrayLength());
    }

    // ---------- Composição visual ----------
    [Fact]
    public async Task Scene_composition_validates_sources_size_and_revision()
    {
        var map = await MapAsync();
        var portrait = await assets.SaveMapAsync(campaign.Id, null, Master, new("Jarvis", null, 64, 1.5m, Purpose: CampaignAssetPurposes.Portrait), Upload(TestPng.Solid(64, 64, 9, 9, 9)), default);
        var a = await SceneAsync("Mercado", map.Key);
        var b = await SceneAsync("Mercado à noite", map.Key);
        var src = await SourceAsync(a);
        var other = await SourceAsync(b);
        var saved = await SaveComposition(a, Doc(256, true, "asset:" + src, "asset:" + portrait.Id), Overlay());
        var overlay = saved.GetProperty("overlayId").GetGuid();
        var scene = await Scene(a);
        Assert.Equal(overlay, scene.GetProperty("overlayId").GetGuid());
        Assert.True(scene.GetProperty("composition").GetProperty("layers")[2].GetProperty("secret").GetBoolean());
        // A outra cena do mesmo mapa continua sem composição.
        Assert.Equal(JsonValueKind.Null, (await Scene(b)).GetProperty("composition").ValueKind);
        Assert.Equal(400, await Status(() => SaveComposition(a, Doc(128, false), null)));
        Assert.Equal(400, await Status(() => SaveComposition(a, Doc(256, false), Overlay(128))));
        Assert.Equal(400, await Status(() => SaveComposition(a, Doc(256, false, "asset:" + other), null)));
        Assert.Equal(400, await Status(() => SaveComposition(a, Doc(256, false, "asset:" + Guid.NewGuid()), null)));
        Assert.Equal(400, await Status(() => SaveComposition(a, Doc(256, false, "self"), null)));
        Assert.Equal(409, await Status(() => SaveComposition(a, Doc(256, false), null, revision: 1)));
        Assert.Equal(403, await Status(() => assets.SaveSceneCompositionAsync(campaign.Id, a, Player, Doc(256), 0, null, default)));
        var tactical = await SceneAsync("Cripta", "crypt");
        Assert.Equal(409, await Status(() => SaveComposition(tactical, Doc(256, false), null)));
        // Composições independentes: salvar B não toca A.
        await SaveComposition(b, Doc(256, false, "asset:" + other), null);
        Assert.Equal(overlay, (await Scene(a)).GetProperty("overlayId").GetGuid());
        Assert.Equal(JsonValueKind.Null, (await Scene(b)).GetProperty("overlayId").ValueKind);
        // Salvar de novo troca a camada (id novo) e remove a anterior e as fontes sem uso.
        var again = await SaveComposition(a, Doc(256, false, "asset:" + portrait.Id), Overlay());
        Assert.NotEqual(overlay, again.GetProperty("overlayId").GetGuid());
        Assert.Equal(1, await SceneAssets(a));
        // Composição vazia remove tudo.
        await SaveComposition(a, "", null);
        Assert.Equal(0, await SceneAssets(a));
        Assert.Equal(JsonValueKind.Null, (await Scene(a)).GetProperty("composition").ValueKind);
    }

    [Fact]
    public async Task Scene_assets_follow_duplicate_delete_and_map_change()
    {
        var map = await MapAsync();
        var a = await SceneAsync("Mercado", map.Key, entry: """{"x":0,"y":2,"w":2,"h":1}""");
        var src = await SourceAsync(a);
        var saved = await SaveComposition(a, Doc(256, false, "asset:" + src), Overlay());
        db.ChangeTracker.Clear();
        var copy = IdOf(await prep.DuplicateSceneAsync(campaign.Id, a, Master, default));
        var dup = await Scene(copy);
        Assert.NotEqual(saved.GetProperty("overlayId").GetGuid(), dup.GetProperty("overlayId").GetGuid());
        var copiedSrc = dup.GetProperty("composition").GetProperty("elements")[0].GetProperty("src").GetString();
        Assert.NotEqual("asset:" + src, copiedSrc);
        Assert.Equal(0, dup.GetProperty("entry").GetProperty("y").GetInt32() - 2);
        Assert.Equal(2, await SceneAssets(copy));
        // Excluir a original não afeta a cópia.
        db.ChangeTracker.Clear();
        await prep.DeleteSceneAsync(campaign.Id, a, Master, default);
        Assert.Equal(0, await SceneAssets(a));
        Assert.Equal(2, await SceneAssets(copy));
        // Trocar o mapa da cópia remove composição e imagens dela.
        db.ChangeTracker.Clear();
        await prep.SaveSceneAsync(campaign.Id, copy, new("Mercado", "", SceneKinds.Map, null, "crypt", "", "", null, 0, await Revision(copy)), Master, default);
        Assert.Equal(0, await SceneAssets(copy));
        Assert.Equal(JsonValueKind.Null, (await Scene(copy)).GetProperty("composition").ValueKind);
        // Cópia pela Preparação também leva imagens próprias.
        var b = await SceneAsync("Praça", map.Key);
        await SaveComposition(b, Doc(256, false, "asset:" + await SourceAsync(b)), Overlay());
        db.ChangeTracker.Clear();
        await new PrepWorkspaceService(db).CopyAsync(campaign.Id, Master, new(PrepCategories.Scenes, null, [new("scene", b)]), default);
        db.ChangeTracker.Clear();
        var copies = await db.Scenes.Where(s => s.Name.StartsWith("Praça") && s.Id != b).Select(s => s.Id).ToListAsync();
        Assert.Equal(2, await SceneAssets(Assert.Single(copies)));
    }

    [Fact]
    public async Task Table_shows_the_presented_composition_snapshot_and_hides_scene_images_from_players()
    {
        var map = await MapAsync();
        var scene = await SceneAsync("Mercado", map.Key, SceneKinds.Image);
        var src = await SourceAsync(scene);
        var overlay = (await SaveComposition(scene, Doc(256, false, "asset:" + src), Overlay())).GetProperty("overlayId").GetGuid();
        var session = await SessionAsync();
        await service.PresentSceneAsync(session, new(scene, false), Master, default);
        Assert.Equal(overlay, (await Live(session)).OverlayId);
        db.ChangeTracker.Clear();
        var url = J(await service.StateAsync(session, Player, default)).GetProperty("map").GetProperty("imageUrl").GetString();
        Assert.Contains("overlay=" + overlay.ToString("N"), url);
        // Jogador nunca lê imagens da cena pelo id; recebe a composição só pela imagem do mapa, com a camada da sessão.
        Assert.Equal(404, await Status(() => assets.ImageAsync(campaign.Id, overlay, Player, default)));
        Assert.Equal(404, await Status(() => assets.ImageAsync(campaign.Id, src, Player, default)));
        var plain = await assets.ImageAsync(campaign.Id, map.Id, Player, default);
        var stored = await db.Set<CampaignMap>().Where(m => m.Id == map.Id).Select(m => m.Content).SingleAsync();
        Assert.Equal(stored, plain);
        Assert.Equal(stored, await assets.ImageAsync(campaign.Id, map.Id, Player, default, overlay: Guid.NewGuid()));
        var composed = await assets.ImageAsync(campaign.Id, map.Id, Player, default, overlay: overlay);
        Assert.NotEqual(stored, composed);
        // Salvar a composição com a cena na mesa não muda a mesa; a camada antiga fica guardada até aplicar.
        var next = (await SaveComposition(scene, Doc(256, false, "asset:" + src), Overlay())).GetProperty("overlayId").GetGuid();
        Assert.Equal(overlay, (await Live(session)).OverlayId);
        Assert.True((await Scene(scene)).GetProperty("live").GetProperty("compositionPending").GetBoolean());
        Assert.NotEqual(stored, await assets.ImageAsync(campaign.Id, map.Id, Player, default, overlay: overlay));
        db.ChangeTracker.Clear();
        var applied = J(await service.ApplyScenePreparationAsync(session, new(scene, false, false, false, await Revision(scene), Composition: true), Master, default));
        Assert.Contains("composição visual", applied.GetProperty("applied").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(next, (await Live(session)).OverlayId);
        Assert.False(await db.Set<CampaignMap>().AnyAsync(m => m.Id == overlay));
        Assert.False((await Scene(scene)).GetProperty("live").GetProperty("compositionPending").GetBoolean());
        Assert.Equal(stored, await assets.ImageAsync(campaign.Id, map.Id, Player, default, overlay: overlay));
    }

    [Fact]
    public async Task Fogged_tactical_map_masks_the_composite()
    {
        var map = await MapAsync();
        var scene = await SceneAsync("Masmorra", map.Key);
        var overlay = (await SaveComposition(scene, Doc(256, false), Overlay())).GetProperty("overlayId").GetGuid();
        var session = await SessionAsync();
        await service.PresentSceneAsync(session, new(scene, false), Master, default);
        db.ChangeTracker.Clear();
        var url = J(await service.StateAsync(session, Player, default)).GetProperty("map").GetProperty("imageUrl").GetString()!;
        Assert.Contains("?overlay=" + overlay.ToString("N") + "&v=", url);
        var bytes = await assets.ImageAsync(campaign.Id, map.Id, Player, default, overlay: overlay);
        Assert.NotEmpty(bytes);
    }

    [Fact]
    public async Task Reposition_preview_lists_moves_without_writing()
    {
        var crypt = BattleMaps.Find("crypt")!;
        var cells = TableFog.Initial(crypt, TableSettings.Default).Cells;
        var free = new List<(int X, int Y)>();
        for (var y = 0; y < crypt.Height; y++) for (var x = 0; x < crypt.Width; x++) if (cells[y][x] == TableFog.Free && crypt.CanStand(x, y) && crypt.Rows[y][x] != 'S') free.Add((x, y));
        var tokens = new List<SceneTokenInput> { new(hero.Id, null, null, null, free[10].X, free[10].Y), new(null, null, "Lobo", "enemy", free[20].X, free[20].Y) };
        var scene = await SceneAsync("Cripta", "crypt", tokens: tokens);
        var session = await SessionAsync(MapKinds.Tileset, "crypt");
        await service.PresentSceneAsync(session, new(scene, false), Master, default);
        db.ChangeTracker.Clear();
        var heroToken = await db.SessionTokens.SingleAsync(t => t.SessionId == session && t.CharacterId == hero.Id);
        heroToken.X = free[30].X; heroToken.Y = free[30].Y;
        db.SessionTokens.Add(new SessionToken { SessionId = session, Label = "Rato", Side = "enemy", X = free[40].X, Y = free[40].Y });
        await db.SaveChangesAsync();
        var before = (await Tokens(session)).Select(t => (t.Id, t.X, t.Y)).OrderBy(t => t.Id).ToList();
        var preview = J(await service.RepositionPreviewAsync(session, scene, Master, default));
        Assert.Equal(1, preview.GetProperty("unchanged").GetInt32());
        var moves = preview.GetProperty("moves").EnumerateArray().ToList();
        var heroMove = moves.Single(m => m.GetProperty("characterId").ValueKind == JsonValueKind.String);
        Assert.Equal(free[30].X, heroMove.GetProperty("from").GetProperty("x").GetInt32());
        Assert.Equal(free[10].X, heroMove.GetProperty("to").GetProperty("x").GetInt32());
        var rat = moves.Single(m => m.GetProperty("label").GetString() == "Rato");
        Assert.Equal(JsonValueKind.Null, rat.GetProperty("to").ValueKind);
        Assert.Equal(before, (await Tokens(session)).Select(t => (t.Id, t.X, t.Y)).OrderBy(t => t.Id).ToList());
        Assert.Equal(403, await Status(() => service.RepositionPreviewAsync(session, scene, Player, default)));
        Assert.Equal(409, await Status(() => service.RepositionPreviewAsync(session, Guid.NewGuid(), Master, default)));
    }

    [Fact]
    public async Task Deleting_an_image_used_by_a_scene_composition_is_refused()
    {
        var map = await MapAsync();
        var portrait = await assets.SaveMapAsync(campaign.Id, null, Master, new("Jarvis", null, 64, 1.5m, Purpose: CampaignAssetPurposes.Portrait), Upload(TestPng.Solid(64, 64, 9, 9, 9)), default);
        var scene = await SceneAsync("Mercado", map.Key);
        await SaveComposition(scene, Doc(256, false, "asset:" + portrait.Id), null);
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => assets.DeleteMapAsync(campaign.Id, portrait.Id, Master, default)));
        await SaveComposition(scene, "", null);
        db.ChangeTracker.Clear();
        await assets.DeleteMapAsync(campaign.Id, portrait.Id, Master, default);
    }

    [Fact]
    public void Map_compositions_drop_the_secret_flag()
    {
        var (doc, _, _) = MapComposition.Parse(Doc(256, true));
        Assert.True(doc.Layers![2]!.Secret);
        var clean = MapComposition.WithoutSecrets(doc);
        Assert.Null(clean.Layers![2]!.Secret);
        Assert.DoesNotContain("secret", MapComposition.Serialize(clean));
    }

    // ---------- Mapas inseridos na cena (ADR-113) ----------
    static string InstanceDoc(int size, string src, string? mapKey) => JsonSerializer.Serialize(new
    {
        v = 1, artboard = new { width = size, height = size, background = "#000000" },
        layers = new object[]
        {
            new { id = "base", name = "Base", kind = "base", visible = true, locked = false, opacity = 100 },
            new { id = "elements", name = "Elementos", kind = "elements", visible = true, locked = false, opacity = 100 },
        },
        elements = new object[] { new { id = "m1", layer = "base", type = "image", src, mapKey, x = 32, y = 0, width = 128, height = 128 } },
    }, Web);

    [Fact]
    public async Task Scene_composition_accepts_map_instances_only_of_campaign_maps_with_grid()
    {
        var map = await MapAsync();
        var hall = await MapAsync("Corredor");
        var picture = await MapAsync("Retrato", grid: false);
        var scene = await SceneAsync("Masmorra", map.Key);
        var saved = await SaveComposition(scene, InstanceDoc(256, hall.Key, hall.Key), null);
        Assert.Equal(hall.Key, saved.GetProperty("composition").GetProperty("elements")[0].GetProperty("mapKey").GetString());
        Assert.Equal(hall.Key, (await Scene(scene)).GetProperty("composition").GetProperty("elements")[0].GetProperty("mapKey").GetString());
        // Chave diferente da imagem, mapa sem grade, id desconhecido e formato inválido: 400.
        Assert.Equal(400, await Status(() => SaveComposition(scene, InstanceDoc(256, hall.Key, map.Key), null)));
        Assert.Equal(400, await Status(() => SaveComposition(scene, InstanceDoc(256, picture.Key, picture.Key), null)));
        var ghost = "asset:" + Guid.NewGuid();
        Assert.Equal(400, await Status(() => SaveComposition(scene, InstanceDoc(256, ghost, ghost), null)));
        Assert.Equal(400, await Status(() => SaveComposition(scene, InstanceDoc(256, hall.Key, "crypt"), null)));
        // Mapa com grade de outra campanha: recusado.
        db.ChangeTracker.Clear();
        var other = new Campaign { OwnerId = Master, Name = "Outra" };
        db.Add(other); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        var foreign = await assets.SaveMapAsync(other.Id, null, Master, new("Alheio", null, 32, 1.5m), Upload(TestPng.Solid(256, 256, 1, 2, 3)), default);
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => SaveComposition(scene, InstanceDoc(256, foreign.Key, foreign.Key), null)));
        // Documento antigo, sem o campo, continua válido; o original nunca é apagado enquanto inserido.
        await SaveComposition(scene, InstanceDoc(256, hall.Key, null), null);
        Assert.False((await Scene(scene)).GetProperty("composition").GetProperty("elements")[0].TryGetProperty("mapKey", out _));
        await SaveComposition(scene, InstanceDoc(256, hall.Key, hall.Key), null);
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => assets.DeleteMapAsync(campaign.Id, hall.Id, Master, default)));
        Assert.True(await db.Set<CampaignMap>().AnyAsync(m => m.Id == hall.Id));
    }

    [Fact]
    public void Map_compositions_drop_map_instance_keys()
    {
        var key = "asset:" + Guid.NewGuid();
        var (doc, sources, _) = MapComposition.Parse(InstanceDoc(256, key, key));
        Assert.Single(sources);
        Assert.Equal([Guid.Parse(key[6..])], MapComposition.MapInstances(doc));
        var clean = MapComposition.WithoutMapKeys(doc);
        Assert.Empty(MapComposition.MapInstances(clean));
        Assert.DoesNotContain("mapKey", MapComposition.Serialize(clean));
    }

    [Fact]
    public async Task Grid_impact_previews_what_a_new_grid_drops_without_writing()
    {
        var map = await MapAsync();
        var tokens = new List<SceneTokenInput> { new(hero.Id, null, null, null, 1, 1), new(null, null, "Lobo", "enemy", 7, 7) };
        var scene = await SceneAsync("Covil", map.Key, tokens: tokens);
        var layer = J(await assets.LayerAsync(campaign.Id, map.Key, Master, default));
        var cells = Enumerable.Range(0, 8).Select(y => y == 6 ? "......#." : "........").ToArray();
        db.ChangeTracker.Clear();
        await assets.SaveLayerAsync(campaign.Id, map.Key, Master, new(true, cells, [new FogLight { Id = "a", X = 7, Y = 7, Radius = 3 }, new FogLight { Id = "b", X = 1, Y = 1, Radius = 3 }], null, null,
            layer.GetProperty("revision").GetInt32(), Walls: [new FogWall { Id = "w1", X1 = 0, Y1 = 0, X2 = 800, Y2 = 0, Kind = FogWallKinds.Wall }, new FogWall { Id = "w2", X1 = 0, Y1 = 100, X2 = 100, Y2 = 100, Kind = FogWallKinds.Wall }]), default);
        var revision = (await db.Set<CampaignMap>().AsNoTracking().SingleAsync(m => m.Id == map.Id)).Revision;
        db.ChangeTracker.Clear();
        await assets.SaveEntriesAsync(campaign.Id, map.Key, Master, new([new MapEntry("porta", "Porta", MapEntryKinds.Party, 6, 6, 2, 1)], revision), default);
        var before = await Revision(scene);
        db.ChangeTracker.Clear();
        // 64 px: 4 × 4 casas. Sai o lobo (7,7), a luz (7,7), a casa bloqueada (6,6), o ponto de entrada; a parede de 8 casas passa da borda.
        var impact = J(await assets.GridImpactAsync(campaign.Id, map.Id, Master, new(64), default));
        Assert.Equal(4, impact.GetProperty("width").GetInt32());
        Assert.Equal(8, impact.GetProperty("oldWidth").GetInt32());
        Assert.Equal(1, impact.GetProperty("scenes").GetInt32());
        Assert.True(impact.GetProperty("tokensOutside").GetInt32() >= 1);
        Assert.Equal(1, impact.GetProperty("lightsOutside").GetInt32());
        Assert.Equal(1, impact.GetProperty("cellsOutside").GetInt32());
        Assert.Equal(1, impact.GetProperty("entriesOutside").GetInt32());
        Assert.Equal(0, impact.GetProperty("wallsOutside").GetInt32()); // convertidas para o mesmo ponto da imagem: 800 × 32 / 64 = 400 cabe
        Assert.False(impact.GetProperty("inSession").GetBoolean());
        Assert.Equal("Covil", impact.GetProperty("affected")[0].GetProperty("name").GetString());
        // Nada foi gravado.
        Assert.Equal(before, await Revision(scene));
        db.ChangeTracker.Clear();
        Assert.Equal(revision + 1, (await db.Set<CampaignMap>().AsNoTracking().SingleAsync(m => m.Id == map.Id)).Revision);
        // Mesma grade: nada sai. Grade inválida e jogador: recusados.
        Assert.Equal(0, J(await assets.GridImpactAsync(campaign.Id, map.Id, Master, new(32), default)).GetProperty("tokensOutside").GetInt32());
        Assert.Equal(400, await Status(() => assets.GridImpactAsync(campaign.Id, map.Id, Master, new(64, 64), default)));
        Assert.Equal(400, await Status(() => assets.GridImpactAsync(campaign.Id, map.Id, Master, new(4), default)));
        Assert.Equal(403, await Status(() => assets.GridImpactAsync(campaign.Id, map.Id, Player, new(64), default)));
        // Aplicar a grade pelo acervo segue a prévia: o marcador fora sai da preparação.
        db.ChangeTracker.Clear();
        await assets.SaveMapAsync(campaign.Id, map.Id, Master, new("Salão", null, 64, 1.5m, revision + 1), null, default);
        var prepared = (await Scene(scene)).GetProperty("prepared");
        Assert.Equal(1, prepared.GetArrayLength());
    }

    sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }
}
