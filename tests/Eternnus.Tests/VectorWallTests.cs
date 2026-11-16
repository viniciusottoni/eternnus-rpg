using System.Runtime.CompilerServices;
using System.Text.Json;
using Eternnus.Web;

namespace Eternnus.Tests;

/// <summary>
/// Paredes vetoriais (ADR-087): regras de visão/movimento contra o fixture compartilhado com o cliente
/// (tests/fixtures/vector-walls.json, também usado por tests/wall-policy.test.mjs), validação, ajuste de grade,
/// aplicação da preparação e o que o jogador recebe.
/// </summary>
public sealed class VectorWallTests
{
    sealed record Fixture(int Width, int Height, List<FogWall> Walls, List<SightCase> Sight, List<StepCase> Steps, List<PathCase> Paths, LightCase Light);
    sealed record SightCase(int[] From, int[] To, bool Clear, string? Why);
    sealed record StepCase(int[] From, int[] To, bool Blocked);
    sealed record PathCase(int[] From, int[] To, int Limit, int? Length);
    sealed record LightCase(int X, int Y, int Radius, int[][] Lit, int[][] Dark);

    static Fixture Load([CallerFilePath] string source = "")
    {
        var path = Path.Combine(Path.GetDirectoryName(source)!, "..", "fixtures", "vector-walls.json");
        return JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    static string[] Free(int w, int h) => Enumerable.Repeat(new string('.', w), h).ToArray();
    static FogGrid Grid(Fixture f, IEnumerable<FogWall>? walls = null) => new(f.Width, f.Height, Free(f.Width, f.Height), walls ?? f.Walls);

    [Fact]
    public void Sight_matches_shared_fixture_and_is_symmetric()
    {
        var f = Load();
        var grid = Grid(f);
        foreach (var c in f.Sight)
        {
            Assert.True(grid.LineClear(c.From[0], c.From[1], c.To[0], c.To[1]) == c.Clear, $"{string.Join(",", c.From)}→{string.Join(",", c.To)}: {c.Why}");
            Assert.True(grid.LineClear(c.To[0], c.To[1], c.From[0], c.From[1]) == c.Clear, "simétrico");
        }
    }

    [Fact]
    public void Steps_and_paths_match_shared_fixture()
    {
        var f = Load();
        var grid = Grid(f);
        foreach (var c in f.Steps) Assert.True(grid.StepBlocked(c.From[0], c.From[1], c.To[0], c.To[1]) == c.Blocked, $"{string.Join(",", c.From)}→{string.Join(",", c.To)}");
        foreach (var c in f.Paths) Assert.Equal(c.Length, FogRules.PathLength(grid, c.From[0], c.From[1], c.To[0], c.To[1], c.Limit, (_, _) => true));
    }

    [Fact]
    public void Light_stops_at_walls_and_dim_counts_as_reach()
    {
        var f = Load();
        var state = new MapFogState { Cells = Free(f.Width, f.Height), Walls = f.Walls, Lights = [new FogLight { X = f.Light.X, Y = f.Light.Y, Radius = f.Light.Radius }] };
        var lit = FogRules.Shared(Grid(f), state, []);
        foreach (var c in f.Light.Lit) Assert.True(lit[c[1] * f.Width + c[0]], $"iluminada {c[0]},{c[1]}");
        foreach (var c in f.Light.Dark) Assert.False(lit[c[1] * f.Width + c[0]], $"escura {c[0]},{c[1]}");
        Assert.Equal(5, new FogLight { Radius = 2, Dim = 5 }.Reach);
        Assert.Equal(4, new FogLight { Radius = 4 }.Reach);
    }

    [Fact]
    public void Open_door_lets_sight_and_movement_through()
    {
        var f = Load();
        var open = f.Walls.Select(w => { var c = w.Clone(); if (c.Id == "d") c.Open = true; return c; }).ToList();
        var grid = Grid(f, open);
        Assert.True(grid.LineClear(1, 3, 1, 5));
        Assert.False(grid.StepBlocked(1, 3, 1, 4));
        Assert.False(Grid(f).LineClear(1, 3, 1, 5));
    }

    [Fact]
    public void Cell_walls_still_apply_together_with_vector_walls()
    {
        var cells = new[] { "...", ".#.", "..." };
        var grid = new FogGrid(3, 3, cells, [new FogWall { X1 = 0, Y1 = 100, X2 = 100, Y2 = 100 }]);
        Assert.False(grid.LineClear(0, 1, 2, 1), "casa # continua bloqueando");
        Assert.True(grid.StepBlocked(0, 0, 0, 1), "parede vetorial entre linhas 0 e 1");
        Assert.False(new FogGrid(3, 3, cells).HasWalls);
    }

    [Fact]
    public void ValidWalls_rejects_invalid_input_and_normalizes_ids()
    {
        Assert.Equal(400, Assert.Throws<RuleException>(() => TableFog.ValidWalls([new FogWall { X1 = 0, Y1 = 0, X2 = 0, Y2 = 0 }], 3, 3)).Status);
        Assert.Equal(400, Assert.Throws<RuleException>(() => TableFog.ValidWalls([new FogWall { X1 = 0, Y1 = 0, X2 = 301, Y2 = 0 }], 3, 3)).Status);
        Assert.Equal(400, Assert.Throws<RuleException>(() => TableFog.ValidWalls([new FogWall { X1 = 0, Y1 = 0, X2 = 100, Y2 = 0, Kind = "lava" }], 3, 3)).Status);
        Assert.Equal(409, Assert.Throws<RuleException>(() => TableFog.ValidWalls(Enumerable.Range(0, TableFog.MaxWalls + 1).Select(_ => new FogWall { X2 = 100 }), 3, 3)).Status);
        var ok = TableFog.ValidWalls([new FogWall { Id = "<x>", X2 = 100, Kind = "wall", Open = true }, new FogWall { Id = "dup", X2 = 100 }, new FogWall { Id = "dup", Y2 = 100 }], 3, 3);
        Assert.All(ok, w => Assert.Matches("^[A-Za-z0-9]+$", w.Id));
        Assert.False(ok[0].Open, "só porta fica aberta");
        Assert.NotEqual(ok[1].Id, ok[2].Id);
    }

    [Fact]
    public void Regrid_keeps_walls_on_the_same_image_point_and_fit_clamps()
    {
        // 50 px por casa com deslocamento 10 → 100 px por casa sem deslocamento: casa 2 (pixel 110) vira 1,1.
        var moved = TableFog.Regrid([new FogWall { X1 = 200, Y1 = 0, X2 = 200, Y2 = 400 }], 50, 10, 0, 100, 0, 0);
        Assert.Equal(110, moved[0].X1);
        Assert.Equal(200, moved[0].Y2);
        var back = TableFog.Regrid(moved, 100, 0, 0, 50, 10, 0);
        Assert.Equal(200, back[0].X1);
        var fitted = TableFog.FitWalls([new FogWall { X1 = 0, Y1 = 0, X2 = 900, Y2 = 0 }, new FogWall { X1 = 500, Y1 = 0, X2 = 900, Y2 = 0 }], 3, 3);
        Assert.Single(fitted);
        Assert.Equal(300, fitted[0].X2);
    }

    [Fact]
    public void Apply_preparation_keeps_live_door_state_and_same_structure_ignores_it()
    {
        var live = new MapFogState { Cells = ["..."], Walls = [new FogWall { Id = "d", X2 = 100, Kind = FogWallKinds.Door, Open = true }] };
        var prep = new MapFogState { Cells = ["..."], Walls = [new FogWall { Id = "d", X2 = 100, Kind = FogWallKinds.Door }, new FogWall { Id = "n", Y1 = 100, X2 = 100, Y2 = 100 }] };
        Assert.False(ScenePrep.SameStructure(live, prep));
        ScenePrep.ApplyStructure(live, prep);
        Assert.Equal(2, live.Walls.Count);
        Assert.True(live.Walls.Single(w => w.Id == "d").Open, "porta aberta na partida continua aberta");
        Assert.True(ScenePrep.SameStructure(live, prep));
        var copy = ScenePrep.PrepOf(live);
        copy.Walls[0].X2 = 50;
        Assert.Equal(100, live.Walls[0].X2);
        ScenePrep.Restart(live, prep);
        Assert.False(live.Walls.Single(w => w.Id == "d").Open, "reiniciar volta ao estado preparado");
    }

    [Fact]
    public void Players_receive_only_known_movement_walls_without_secrets()
    {
        var walls = new List<FogWall>
        {
            new() { Id = "known", X1 = 0, Y1 = 100, X2 = 100, Y2 = 100 },
            new() { Id = "far", X1 = 400, Y1 = 400, X2 = 500, Y2 = 400 },
            new() { Id = "secret", X1 = 100, Y1 = 0, X2 = 100, Y2 = 100, Kind = FogWallKinds.Door, Hidden = true },
            new() { Id = "door", X1 = 0, Y1 = 0, X2 = 0, Y2 = 100, Kind = FogWallKinds.Door, Open = true },
            new() { Id = "curtain", X1 = 0, Y1 = 50, X2 = 100, Y2 = 50, Kind = FogWallKinds.Sight },
        };
        var known = new bool[25]; known[0] = true; // só a casa (0,0) de uma grade 5×5
        var sent = JsonSerializer.Serialize(TableFogService.PlayerWalls(walls, known, 5, 5), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var doc = JsonDocument.Parse(sent);
        var items = doc.RootElement.EnumerateArray().ToList();
        Assert.Equal(3, items.Count); // known, secret (como parede comum) e door aberta
        Assert.DoesNotContain("secret", sent);
        Assert.DoesNotContain("hidden", sent);
        Assert.DoesNotContain("kind", sent);
        Assert.Equal(1, items.Count(i => i.GetProperty("door").ValueKind == JsonValueKind.String));
        Assert.Contains(items, i => i.GetProperty("door").GetString() == "open");
    }

    [Fact]
    public void Light_input_validates_visual_fields()
    {
        var s = new MapFogState { Cells = ["..."] };
        FogEdits.UpsertLight(s, 3, 1, new FogLightInput(null, 1, 0, 2, 4, "#FFAA00", 60, "flicker"));
        Assert.Equal(("#ffaa00", 4, 60, "flicker"), (s.Lights[0].Color, s.Lights[0].Dim, s.Lights[0].Intensity, s.Lights[0].Animation));
        Assert.Throws<RuleException>(() => FogEdits.UpsertLight(s, 3, 1, new FogLightInput(null, 1, 0, 4, 2)));
        Assert.Throws<RuleException>(() => FogEdits.UpsertLight(s, 3, 1, new FogLightInput(null, 1, 0, 2, Color: "red")));
        Assert.Throws<RuleException>(() => FogEdits.UpsertLight(s, 3, 1, new FogLightInput(null, 1, 0, 2, Animation: "strobe")));
        FogEdits.ToggleWallDoor(new MapFogState { Walls = [new FogWall { Id = "d", Kind = FogWallKinds.Door, X2 = 100 }] }, "d");
        Assert.Equal(409, Assert.Throws<RuleException>(() => FogEdits.ToggleWallDoor(new MapFogState { Walls = [new FogWall { Id = "w", X2 = 100 }] }, "w")).Status);
    }

    [Fact]
    public void Old_layer_json_without_walls_parses_with_empty_list()
    {
        var state = MapFogState.Parse("{\"cells\":[\"..\"],\"lights\":[{\"id\":\"a\",\"x\":0,\"y\":0,\"radius\":2}]}")!;
        Assert.Empty(state.Walls);
        Assert.Equal(2, state.Lights[0].Reach);
        Assert.Null(state.Lights[0].Dim);
    }
}
