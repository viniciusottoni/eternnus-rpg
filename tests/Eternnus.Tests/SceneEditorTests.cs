using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Editor de cenas: preparação privada sem apresentar, separação preparação × apresentação, aplicação explícita,
/// reinício, reutilização do mesmo mapa entre cenas, imagens sem grade, grade com deslocamento e improviso (SQLite).
/// </summary>
public sealed class SceneEditorTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    PreparationService prep = null!;
    CampaignAssetsService assets = null!;
    readonly Clock clock = new(new DateTimeOffset(2026, 11, 8, 21, 0, 0, TimeSpan.Zero));
    Campaign campaign = null!;
    Character hero = null!, outsiderHero = null!;
    const string Master = "master", Player = "player", Outsider = "outsider";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web) { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    static readonly BattleMap Crypt = BattleMaps.Find("crypt")!;

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran", TableSettings = (TableSettings.Default with { PlayMode = PlayModes.Free }).Serialize() };
        hero = new Character { OwnerId = Player, Name = "Tharion", Hp = 10, MaxHp = 10 };
        outsiderHero = new Character { OwnerId = Outsider, Name = "Estranho" };
        db.AddRange(campaign, hero, outsiderHero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
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

    /// <summary>Casas livres do mapa oficial, longe dos pontos de entrada.</summary>
    static List<(int X, int Y)> FreeCells()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var spawns = Crypt.Spawns().ToHashSet();
        var list = new List<(int, int)>();
        for (var y = 0; y < Crypt.Height; y++) for (var x = 0; x < Crypt.Width; x++)
                if (cells[y][x] == TableFog.Free && Crypt.CanStand(x, y) && !spawns.Contains((x, y)) && spawns.All(s => Math.Abs(s.X - x) + Math.Abs(s.Y - y) > 3)) list.Add((x, y));
        return list;
    }
    static (int X, int Y) Blocked()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        for (var y = 0; y < Crypt.Height; y++) for (var x = 0; x < Crypt.Width; x++) if (TableFog.BlocksMove(cells[y][x])) return (x, y);
        throw new InvalidOperationException("Mapa sem obstáculos.");
    }

    async Task<Guid> StartAsync(string mapKind = MapKinds.Cartographic, string mapKey = "valley")
    {
        var id = IdOf(await service.StartAsync(campaign.Id, new("Sessão", "", mapKind, mapKey), Master, default));
        await service.JoinAsync(id, hero.Id, Player, default);
        db.ChangeTracker.Clear();
        return id;
    }
    async Task<JsonElement> State(Guid id, string user) { db.ChangeTracker.Clear(); return J(await service.StateAsync(id, user, default)); }
    async Task<Guid> SceneAsync(string name, string kind = SceneKinds.Map, string? key = "crypt", string text = "", string notes = "", string? vision = null, List<SceneTokenInput>? tokens = null, string? mode = null)
    {
        db.ChangeTracker.Clear();
        return IdOf(await prep.SaveSceneAsync(campaign.Id, null, new(name, "", kind, null, key, text, notes, vision, 0, 0, tokens, mode), Master, default));
    }
    async Task<JsonElement> Scene(Guid id) { db.ChangeTracker.Clear(); return J(await prep.SceneAsync(campaign.Id, id, Master, default)); }
    async Task<JsonElement> Layer(string key, Guid? scene = null) { db.ChangeTracker.Clear(); return J(await assets.LayerAsync(campaign.Id, key, Master, default, scene)); }
    async Task<JsonElement> SaveLayer(string key, Guid? scene, Func<string[], string[]> cells, string? revealed = null)
    {
        var l = await Layer(key, scene);
        var rows = l.GetProperty("cells").EnumerateArray().Select(r => r.GetString()!).ToArray();
        var lights = l.GetProperty("lights").Deserialize<List<FogLight>>(Web)!;
        db.ChangeTracker.Clear();
        return J(await assets.SaveLayerAsync(campaign.Id, key, Master, new(l.GetProperty("fog").ValueKind == JsonValueKind.Null ? null : l.GetProperty("fog").GetBoolean(), cells(rows), lights,
            revealed ?? l.GetProperty("revealed").GetString(), [], l.GetProperty("revision").GetInt32(), false, l.GetProperty("prepVersion").GetString()), default, scene));
    }
    static string[] WallAt(string[] rows, int x, int y) { var copy = rows.ToArray(); var r = copy[y].ToCharArray(); r[x] = TableFog.Wall; copy[y] = new string(r); return copy; }
    async Task<MapFogState> LiveLayer(string key) { db.ChangeTracker.Clear(); return MapFogState.Parse((await db.Set<CampaignMapLayer>().SingleAsync(l => l.CampaignId == campaign.Id && l.MapKey == key)).State)!; }
    async Task<List<SessionToken>> Tokens(Guid session) { db.ChangeTracker.Clear(); return await db.SessionTokens.Where(t => t.SessionId == session).ToListAsync(); }

    [Fact]
    public async Task Prepares_arrangement_privately_without_presenting()
    {
        var session = await StartAsync();
        var free = FreeCells();
        var tokens = new List<SceneTokenInput> { new(null, null, "Guardião", "enemy", free[0].X, free[0].Y, Hidden: true), new(hero.Id, null, null, null, free[1].X, free[1].Y) };
        var id = await SceneAsync("Cripta", tokens: tokens, notes: "Armadilha no altar");
        var scene = await Scene(id);
        Assert.Equal(2, scene.GetProperty("prepared").GetArrayLength());
        Assert.Equal("Tharion", scene.GetProperty("prepared")[1].GetProperty("label").GetString());
        Assert.False(scene.GetProperty("live").GetProperty("current").GetBoolean());
        // A mesa ao vivo não muda: nenhum marcador, mapa e cena continuam os da sessão.
        Assert.Empty(await Tokens(session));
        var live = await State(session, Player);
        Assert.Equal("valley", live.GetProperty("map").GetProperty("key").GetString());
        Assert.Equal(JsonValueKind.Null, live.GetProperty("play").GetProperty("scene").ValueKind);
        // Validação da grade e da campanha.
        var blocked = Blocked();
        Assert.Equal(400, await Status(() => SceneAsync("X", tokens: [new(null, null, "A", "enemy", blocked.X, blocked.Y)])));
        Assert.Equal(400, await Status(() => SceneAsync("X", tokens: [new(null, null, "A", "enemy", free[0].X, free[0].Y), new(null, null, "B", "enemy", free[0].X, free[0].Y)])));
        Assert.Equal(400, await Status(() => SceneAsync("X", tokens: [new(outsiderHero.Id, null, null, null, free[0].X, free[0].Y)])));
        Assert.Equal(400, await Status(() => SceneAsync("X", tokens: [new(null, null, "A", "enemy", 500, 500)])));
        Assert.Equal(403, await Status(() => prep.SceneAsync(campaign.Id, id, Player, default)));
        // Apresentar usa o arranjo preparado.
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        var placed = await Tokens(session);
        Assert.Contains(placed, t => t.Label == "Guardião" && t.X == free[0].X && t.Y == free[0].Y && t.Hidden);
        Assert.Contains(placed, t => t.CharacterId == hero.Id && t.X == free[1].X && t.Y == free[1].Y);
    }

    [Fact]
    public async Task Saving_preparation_never_changes_live_text_until_applied()
    {
        var session = await StartAsync();
        var id = await SceneAsync("Cripta", text: "Ar frio.", notes: "Segredo: passagem atrás do altar");
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        var hero0 = (await Tokens(session)).Single(t => t.CharacterId == hero.Id);
        var before = await Scene(id);
        db.ChangeTracker.Clear();
        await prep.SaveSceneAsync(campaign.Id, id, new("Cripta profunda", "", SceneKinds.Map, null, "crypt", "Cheiro de enxofre.", "Segredo: passagem atrás do altar", null, 0, before.GetProperty("revision").GetInt32()), Master, default);
        var player = await State(session, Player);
        var scene = player.GetProperty("play").GetProperty("scene");
        Assert.Equal("Cripta", scene.GetProperty("name").GetString());
        Assert.Equal("Ar frio.", scene.GetProperty("sharedText").GetString());
        Assert.DoesNotContain("Segredo", player.GetRawText());
        Assert.DoesNotContain("enxofre", player.GetRawText());
        var master = await State(session, Master);
        Assert.True(master.GetProperty("play").GetProperty("scene").GetProperty("pending").GetProperty("text").GetBoolean());
        // Revisão obsoleta não aplica; a aplicação explícita só troca o texto.
        Assert.Equal(409, await Status(() => service.ApplyScenePreparationAsync(session, new(id, true, false, false, 1), Master, default)));
        var rev = (await Scene(id)).GetProperty("revision").GetInt32();
        Assert.Equal(403, await Status(() => service.ApplyScenePreparationAsync(session, new(id, true, false, false, rev), Player, default)));
        await service.ApplyScenePreparationAsync(session, new(id, true, false, false, rev), Master, default);
        player = await State(session, Player);
        Assert.Equal("Cheiro de enxofre.", player.GetProperty("play").GetProperty("scene").GetProperty("sharedText").GetString());
        Assert.Equal("Cripta profunda", player.GetProperty("play").GetProperty("scene").GetProperty("name").GetString());
        var hero1 = (await Tokens(session)).Single(t => t.CharacterId == hero.Id);
        Assert.Equal((hero0.X, hero0.Y), (hero1.X, hero1.Y));
        Assert.False((await State(session, Master)).GetProperty("play").GetProperty("scene").GetProperty("pending").GetProperty("text").GetBoolean());
    }

    [Fact]
    public async Task Layer_preparation_saved_while_live_waits_for_explicit_apply_and_preserves_exploration()
    {
        var session = await StartAsync();
        var id = await SceneAsync("Cripta");
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        var free = FreeCells();
        // Estado ao vivo: exploração do jogador e uma porta aberta na partida.
        db.ChangeTracker.Clear();
        var row = await db.Set<CampaignMapLayer>().SingleAsync(l => l.CampaignId == campaign.Id && l.MapKey == "crypt");
        var live = MapFogState.Parse(row.State)!;
        var all = Bits.Encode(Enumerable.Repeat(true, Crypt.Width * Crypt.Height).ToArray());
        live.Explored[Player] = all;
        var doorRow = live.Cells[free[2].Y].ToCharArray(); doorRow[free[2].X] = TableFog.DoorOpen; live.Cells[free[2].Y] = new string(doorRow);
        row.State = live.Serialize(); row.Revision++;
        await db.SaveChangesAsync();

        var saved = await SaveLayer("crypt", id, rows =>
        {
            var r = WallAt(rows, free[0].X, free[0].Y);
            var d = r[free[2].Y].ToCharArray(); d[free[2].X] = TableFog.DoorClosed; r[free[2].Y] = new string(d);
            return r;
        });
        Assert.True(saved.GetProperty("pendingLive").GetBoolean());
        var now = await LiveLayer("crypt");
        Assert.Equal(TableFog.Free, now.Cells[free[0].Y][free[0].X]);
        var master = await State(session, Master);
        Assert.True(master.GetProperty("play").GetProperty("scene").GetProperty("pending").GetProperty("layer").GetBoolean());
        // Recomeçar exploração pelo editor não acontece em silêncio com o mapa na mesa.
        var l = await Layer("crypt", id);
        Assert.Equal(TableFog.Wall, l.GetProperty("cells")[free[0].Y].GetString()![free[0].X]);
        Assert.True(l.GetProperty("pending").GetBoolean());
        // Versão desatualizada da preparação: 409.
        var rev = (await Scene(id)).GetProperty("revision").GetInt32();
        Assert.Equal(409, await Status(() => service.ApplyScenePreparationAsync(session, new(id, false, false, true, rev, "0000000000000000"), Master, default)));
        await service.ApplyScenePreparationAsync(session, new(id, false, false, true, rev, l.GetProperty("prepVersion").GetString()), Master, default);
        now = await LiveLayer("crypt");
        Assert.Equal(TableFog.Wall, now.Cells[free[0].Y][free[0].X]);
        Assert.Equal(TableFog.DoorOpen, now.Cells[free[2].Y][free[2].X]); // a porta aberta na partida continua aberta
        Assert.Equal(all, now.Explored[Player]);
        Assert.False((await Layer("crypt", id)).GetProperty("pending").GetBoolean());
    }

    [Fact]
    public async Task Two_scenes_on_the_same_map_keep_independent_preparation_and_exploration()
    {
        var session = await StartAsync();
        var a = await SceneAsync("Cripta — ida", mode: SceneLayerModes.Scene);
        var b = await SceneAsync("Cripta — volta", mode: SceneLayerModes.Scene);
        var shared = await SceneAsync("Cripta compartilhada");
        var free = FreeCells();
        var resultA = await SaveLayer("crypt", a, rows => WallAt(rows, free[0].X, free[0].Y));
        Assert.False(resultA.GetProperty("pendingLive").GetBoolean());
        Assert.Equal(TableFog.Wall, (await Layer("crypt", a)).GetProperty("cells")[free[0].Y].GetString()![free[0].X]);
        Assert.Equal(TableFog.Free, (await Layer("crypt", b)).GetProperty("cells")[free[0].Y].GetString()![free[0].X]);
        Assert.Equal(TableFog.Free, (await Layer("crypt")).GetProperty("cells")[free[0].Y].GetString()![free[0].X]);
        Assert.Equal(TableFog.Free, (await Layer("crypt", shared)).GetProperty("cells")[free[0].Y].GetString()![free[0].X]);
        Assert.Equal("scene", (await Layer("crypt", a)).GetProperty("mode").GetString());
        // A camada compartilhada informa quais cenas a usam.
        Assert.Contains("Cripta compartilhada", (await Layer("crypt")).GetProperty("sharedWith").GetRawText());

        await service.PresentSceneAsync(session, new(a, false), Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal(ScenePrep.LayerKey("crypt", a), (await db.Sessions.SingleAsync(s => s.Id == session)).LayerKey);
        var rowA = await db.Set<CampaignMapLayer>().SingleAsync(l => l.MapKey == ScenePrep.LayerKey("crypt", a));
        var stateA = MapFogState.Parse(rowA.State)!;
        stateA.Explored[Player] = Bits.Encode(Enumerable.Repeat(true, Crypt.Width * Crypt.Height).ToArray());
        rowA.State = stateA.Serialize(); await db.SaveChangesAsync();
        // Trocar para B: exploração de A não aparece em B; voltar a A retoma.
        await service.PresentSceneAsync(session, new(b, false), Master, default);
        db.ChangeTracker.Clear();
        var bRow = await db.Set<CampaignMapLayer>().SingleOrDefaultAsync(l => l.MapKey == ScenePrep.LayerKey("crypt", b));
        Assert.True(bRow == null || !MapFogState.Parse(bRow.State)!.Explored.ContainsKey(Player) || MapFogState.Parse(bRow.State)!.Explored[Player] != stateA.Explored[Player]);
        await service.PresentSceneAsync(session, new(a, false), Master, default);
        Assert.Equal(stateA.Explored[Player], (await LiveLayer(ScenePrep.LayerKey("crypt", a))).Explored[Player]);
        // Trocar o alcance de uma cena em apresentação é recusado.
        var rev = (await Scene(a)).GetProperty("revision").GetInt32();
        Assert.Equal(409, await Status(() => prep.SaveSceneAsync(campaign.Id, a, new("Cripta — ida", "", SceneKinds.Map, null, "crypt", "", "", null, 0, rev, null, SceneLayerModes.Map), Master, default)));
        // Excluir a cena em apresentação é recusado; excluir outra remove só a camada própria dela.
        Assert.Equal(409, await Status(() => prep.DeleteSceneAsync(campaign.Id, a, Master, default)));
        await prep.DeleteSceneAsync(campaign.Id, b, Master, default);
        db.ChangeTracker.Clear();
        Assert.False(await db.Set<CampaignMapLayer>().AnyAsync(l => l.MapKey == ScenePrep.LayerKey("crypt", b)));
        Assert.True(await db.Set<CampaignMapLayer>().AnyAsync(l => l.MapKey == ScenePrep.LayerKey("crypt", a)));
    }

    [Fact]
    public async Task Restart_returns_to_preparation_and_resume_keeps_state()
    {
        var session = await StartAsync();
        var free = FreeCells();
        var id = await SceneAsync("Cripta", tokens: [new(null, null, "Esqueleto", "enemy", free[0].X, free[0].Y)]);
        var other = await SceneAsync("Conversa", SceneKinds.Text, null, "A capitã chega.");
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        var skeleton = (await Tokens(session)).Single(t => t.Label == "Esqueleto");
        await service.MoveTokenAsync(session, skeleton.Id, new(free[3].X, free[3].Y), Master, default);
        var saved = await SaveLayer("crypt", id, rows => WallAt(rows, free[4].X, free[4].Y));
        Assert.True(saved.GetProperty("pendingLive").GetBoolean());
        // Retomar (via outra cena e volta) mantém a posição e não aplica a preparação pendente.
        await service.PresentSceneAsync(session, new(other, false), Master, default);
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        Assert.Contains(await Tokens(session), t => t.Label == "Esqueleto" && t.X == free[3].X && t.Y == free[3].Y);
        Assert.Equal(TableFog.Free, (await LiveLayer("crypt")).Cells[free[4].Y][free[4].X]);
        // Reiniciar volta ao arranjo e à preparação, e recomeça a exploração.
        await service.PresentSceneAsync(session, new(id, true), Master, default);
        Assert.Contains(await Tokens(session), t => t.Label == "Esqueleto" && t.X == free[0].X && t.Y == free[0].Y);
        var layer = await LiveLayer("crypt");
        Assert.Equal(TableFog.Wall, layer.Cells[free[4].Y][free[4].X]);
        Assert.False((await Layer("crypt", id)).GetProperty("pending").GetBoolean());
    }

    [Fact]
    public async Task Apply_can_reposition_tokens_to_the_arrangement_without_restarting_exploration()
    {
        var session = await StartAsync();
        var free = FreeCells();
        var id = await SceneAsync("Cripta", tokens: [new(null, null, "Esqueleto", "enemy", free[0].X, free[0].Y)]);
        var text = await SceneAsync("Conversa", SceneKinds.Text, null, "A capitã chega.");
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        var skeleton = (await Tokens(session)).Single(t => t.Label == "Esqueleto");
        await service.MoveTokenAsync(session, skeleton.Id, new(free[3].X, free[3].Y), Master, default);
        var before = await LiveLayer("crypt");
        var explored = Bits.Decode(before.Explored.GetValueOrDefault(Player), Crypt.Width * Crypt.Height);
        Assert.Contains(true, explored);
        var revision = (await Scene(id)).GetProperty("revision").GetInt32();
        db.ChangeTracker.Clear();
        var stateBefore = (await db.Sessions.SingleAsync(x => x.Id == session)).Revision;

        db.ChangeTracker.Clear();
        var result = J(await service.ApplyScenePreparationAsync(session, new(id, false, false, false, revision, null, Tokens: true), Master, default));
        Assert.Contains("posições dos marcadores", result.GetProperty("applied").EnumerateArray().Select(x => x.GetString()));
        Assert.Contains(await Tokens(session), t => t.Label == "Esqueleto" && t.X == free[0].X && t.Y == free[0].Y);
        Assert.Contains(await Tokens(session), t => t.CharacterId == hero.Id);
        var after = await LiveLayer("crypt");
        var exploredAfter = Bits.Decode(after.Explored.GetValueOrDefault(Player), Crypt.Width * Crypt.Height);
        Assert.All(Enumerable.Range(0, explored.Length).Where(i => explored[i]), i => Assert.True(exploredAfter[i]));
        db.ChangeTracker.Clear();
        Assert.True((await db.Sessions.SingleAsync(x => x.Id == session)).Revision > stateBefore);

        // Sem nenhuma parte marcada: 400. Cena de texto não tem marcadores para recolocar: 409.
        db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => service.ApplyScenePreparationAsync(session, new(id, false, false, false, revision), Master, default)));
        await service.PresentSceneAsync(session, new(text, false), Master, default);
        var textRevision = (await Scene(text)).GetProperty("revision").GetInt32();
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => service.ApplyScenePreparationAsync(session, new(text, false, false, false, textRevision, null, Tokens: true), Master, default)));
    }

    [Fact]
    public async Task Images_without_grid_become_scene_images_and_never_tactical_maps()
    {
        var map = new CampaignMap { CampaignId = campaign.Id, Name = "Retrato da rainha", HasGrid = false, Width = 800, Height = 600, Content = [1, 2, 3] };
        var gridded = new CampaignMap { CampaignId = campaign.Id, Name = "Salão", Width = 640, Height = 640, GridPixels = 64, GridOffsetX = 10, GridOffsetY = 20, Content = [4] };
        db.AddRange(map, gridded); await db.SaveChangesAsync();
        var session = await StartAsync();
        Assert.Equal(400, await Status(() => SceneAsync("Mapa inválido", SceneKinds.Map, "asset:" + map.Id)));
        var image = await SceneAsync("Audiência", SceneKinds.Image, "asset:" + map.Id, "A rainha observa.");
        await service.PresentSceneAsync(session, new(image, false), Master, default);
        var player = await State(session, Player);
        Assert.Equal(MapKinds.Cartographic, player.GetProperty("map").GetProperty("kind").GetString());
        Assert.Equal(0, player.GetProperty("map").GetProperty("rows").GetArrayLength());
        Assert.Equal(new byte[] { 1, 2, 3 }, await assets.ImageAsync(campaign.Id, map.Id, Player, default));
        // A mesma imagem com grade serve como cena sem grade, sem copiar bytes.
        var asImage = await SceneAsync("Salão visto de cima", SceneKinds.Image, "asset:" + gridded.Id);
        await service.PresentSceneAsync(session, new(asImage, false), Master, default);
        player = await State(session, Player);
        Assert.Equal(MapKinds.Cartographic, player.GetProperty("map").GetProperty("kind").GetString());
        Assert.Equal(1, await db.Set<CampaignMap>().CountAsync(m => m.Name == "Salão"));
        // Com grade: deslocamento reduz as casas inteiras, como no cliente.
        var tactical = await SceneAsync("Salão tático", SceneKinds.Map, "asset:" + gridded.Id);
        await service.PresentSceneAsync(session, new(tactical, false), Master, default);
        var m = (await State(session, Master)).GetProperty("map");
        Assert.Equal(9, m.GetProperty("width").GetInt32());
        Assert.Equal(9, m.GetProperty("height").GetInt32());
        Assert.Equal(10, m.GetProperty("gridOffsetX").GetInt32());
        // Remover a grade de um mapa usado por cena tática é recusado.
        db.ChangeTracker.Clear();
        Assert.Equal(409, await Status(() => assets.SaveMapAsync(campaign.Id, gridded.Id, Master, new("Salão", null, 64, 1.5m, 1, false), null, default)));
    }

    [Fact]
    public void Grid_with_offset_matches_whole_cells()
    {
        Assert.Equal(10, CampaignMapView.Grid(640, 640, 64)[0].Length);
        Assert.Equal(9, CampaignMapView.Grid(640, 640, 64, 10, 0)[0].Length);
        Assert.Equal(9, CampaignMapView.Grid(640, 640, 64, 0, 63).Length);
        Assert.Equal(400, Assert.Throws<RuleException>(() => CampaignMapView.Grid(64, 64, 64, 1, 0)).Status);
        var view = new CampaignMapView(Guid.NewGuid(), "x", null, 50, 1.5m, 1000, 700, 1, "/img", true, 25, 0);
        Assert.Equal(19, view.Width); Assert.Equal(14, view.Height);
        Assert.Null(new CampaignMapView(Guid.NewGuid(), "x", null, 50, 1.5m, 1000, 700, 1, "/img", false).Battle());
    }

    [Fact]
    public async Task Rejects_offsets_outside_the_square()
    {
        var map = new CampaignMap { CampaignId = campaign.Id, Name = "Salão", Width = 640, Height = 640, GridPixels = 64, Content = [4] };
        db.Add(map); await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        Assert.Equal(400, await Status(() => assets.SaveMapAsync(campaign.Id, map.Id, Master, new("Salão", null, 64, 1.5m, 1, true, 64, 0), null, default)));
        Assert.Equal(400, await Status(() => assets.SaveMapAsync(campaign.Id, map.Id, Master, new("Salão", null, 64, 1.5m, 1, true, -1, 0), null, default)));
        var saved = await assets.SaveMapAsync(campaign.Id, map.Id, Master, new("Salão", null, 64, 1.5m, 1, true, 32, 16), null, default);
        Assert.Equal(9, saved.Width);
        Assert.Equal(9, saved.Height);
    }

    [Fact]
    public async Task Improvised_scenery_saves_previous_scene_and_can_become_a_scene()
    {
        var session = await StartAsync();
        var free = FreeCells();
        var id = await SceneAsync("Cripta", tokens: [new(null, null, "Esqueleto", "enemy", free[0].X, free[0].Y)]);
        await service.PresentSceneAsync(session, new(id, false), Master, default);
        await service.SetMapAsync(session, new(MapKinds.Tileset, "crypt"), Master, default); // mesmo mapa e tipo: nada muda
        await service.SetMapAsync(session, new(MapKinds.Cartographic, "valley"), Master, default);
        var s = await State(session, Master);
        Assert.Equal(JsonValueKind.Null, s.GetProperty("play").GetProperty("scene").ValueKind);
        Assert.True((await Scene(id)).GetProperty("hasSaved").GetBoolean());
        var created = IdOf(await service.SaveSceneAsAsync(session, new("Vale improvisado", "Vento forte."), Master, default));
        Assert.Equal("Vale improvisado", (await State(session, Player)).GetProperty("play").GetProperty("scene").GetProperty("name").GetString());
        Assert.Equal(SceneKinds.Image, (await Scene(created)).GetProperty("kind").GetString());
        Assert.Equal(409, await Status(() => service.SaveSceneAsAsync(session, new("Outra"), Master, default)));
        Assert.Equal(403, await Status(() => service.SaveSceneAsAsync(session, new("Outra"), Player, default)));
    }

    [Fact]
    public async Task Legacy_sessions_without_snapshot_keep_showing_the_scene()
    {
        var session = await StartAsync();
        var id = await SceneAsync("Antiga", SceneKinds.Text, null, "Texto antigo.");
        db.ChangeTracker.Clear();
        var s = await db.Sessions.SingleAsync(x => x.Id == session);
        s.SceneId = id; s.SceneName = null; s.SceneText = null;
        await db.SaveChangesAsync();
        var scene = (await State(session, Player)).GetProperty("play").GetProperty("scene");
        Assert.Equal("Antiga", scene.GetProperty("name").GetString());
        Assert.Equal("Texto antigo.", scene.GetProperty("sharedText").GetString());
    }

    [Fact]
    public void Prep_rules_preserve_live_state()
    {
        var live = new MapFogState
        {
            Cells = ["o..", "...", "d.."], Revealed = Bits.Encode([true, false, false, false, false, false, false, false, false]),
            Explored = new() { ["p"] = "AQ==" },
            Marks = [new FogMark { Id = "m1", X = 1, Y = 1, Label = "Fosso", RevealedTo = ["p"] }],
        };
        var prepared = new MapFogState
        {
            Fog = true, Manual = true, Cells = ["d.#", "...", "..."], Revealed = Bits.Encode([false, true, false, false, false, false, false, false, false]),
            Lights = [new FogLight { X = 2, Y = 2, Radius = 3 }], Marks = [new FogMark { Id = "m1", X = 0, Y = 1, Label = "Fosso" }, new FogMark { Id = "m2", X = 2, Y = 1, Label = "Pista" }],
        };
        Assert.True(ScenePrep.SameStructure(new MapFogState { Cells = ["o"] }, new MapFogState { Cells = ["d"] }));
        Assert.False(ScenePrep.SameStructure(live, prepared));
        ScenePrep.ApplyStructure(live, prepared);
        Assert.Equal("o.#", live.Cells[0]); // porta aberta na partida continua aberta
        Assert.Equal('.', live.Cells[2][0]); // porta removida na preparação some
        Assert.Equal(["p"], live.Marks.Single(m => m.Id == "m1").RevealedTo);
        Assert.Equal(0, live.Marks.Single(m => m.Id == "m1").X);
        Assert.Equal("AQ==", live.Explored["p"]);
        var revealed = Bits.Decode(live.Revealed, 9);
        Assert.True(revealed[0] && revealed[1]); // revelações somam; nada é coberto
        Assert.True(ScenePrep.VisionApplied(live, VisionModes.Manual));
        ScenePrep.Restart(live, prepared);
        Assert.Empty(live.Explored);
        Assert.Equal("d.#", live.Cells[0]);
        Assert.Empty(live.Marks.Single(m => m.Id == "m1").RevealedTo);
    }

    [Fact]
    public async Task Interface_preference_is_validated_and_does_not_touch_rules()
    {
        Assert.True(InterfaceModes.IsValid("basic"));
        Assert.True(InterfaceModes.IsValid("complete"));
        Assert.False(InterfaceModes.IsValid("advanced"));
        Assert.False(InterfaceModes.IsValid(null));
        db.ChangeTracker.Clear();
        Assert.Null((await db.Users.SingleAsync(u => u.Id == Master)).InterfaceMode);
    }

    sealed class Clock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }
}
