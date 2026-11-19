using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Prévia do jogador no editor (ADR-088): regras autoritativas do servidor sobre a preparação não salva, sem gravar nada,
/// só para o mestre, com paredes vetoriais, visão da ficha e o grupo inteiro.
/// </summary>
public sealed class PrepPreviewTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    PreparationService prep = null!;
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player";
    static readonly BattleMap Crypt = BattleMaps.Find("crypt")!;
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Hp = 10, MaxHp = 10, VisionMeters = 30 };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        prep = new PreparationService(db, TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    /// <summary>Duas casas livres na mesma linha, com linha de visão livre e pelo menos duas casas entre elas.</summary>
    static ((int X, int Y) A, (int X, int Y) B) Pair(string[] cells)
    {
        var grid = new FogGrid(Crypt.Width, Crypt.Height, cells);
        for (var y = 1; y < Crypt.Height - 1; y++)
            for (var x = 0; x < Crypt.Width - 4; x++)
                if (cells[y][x] == TableFog.Free && cells[y][x + 4] == TableFog.Free && Crypt.CanStand(x, y) && Crypt.CanStand(x + 4, y) && grid.LineClear(x, y, x + 4, y))
                    return ((x, y), (x + 4, y));
        throw new InvalidOperationException("Sem par de casas livres no mapa de teste.");
    }

    PrepPreviewInput Input(string[] cells, List<FogWall> walls, (int X, int Y) a, (int X, int Y) b, Guid? viewer = null, bool party = false) => new(
        "crypt", null, new MapLayerInput(true, cells, [], "", [], 0, Walls: walls),
        [new SceneTokenInput(hero.Id, null, null, null, a.X, a.Y), new SceneTokenInput(null, null, "Espreitador", "enemy", b.X, b.Y)],
        VisionModes.Character, viewer ?? hero.Id, null, party);

    static int[] Shown(object result) => JsonSerializer.SerializeToElement(result, Web).GetProperty("shown").EnumerateArray().Select(e => e.GetInt32()).ToArray();

    [Fact]
    public async Task Vector_wall_hides_creature_in_server_preview_without_writing_anything()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var (a, b) = Pair(cells);
        var x = (a.X + 2) * TableFog.WallUnit;
        var wall = new FogWall { X1 = x, Y1 = (a.Y - 1) * TableFog.WallUnit, X2 = x, Y2 = (a.Y + 2) * TableFog.WallUnit, Kind = FogWallKinds.Wall };

        var open = await prep.PreviewViewAsync(campaign.Id, Input(cells, [], a, b), Master, default);
        Assert.Equal(new[] { 0, 1 }, Shown(open));
        var blocked = await prep.PreviewViewAsync(campaign.Id, Input(cells, [wall], a, b), Master, default);
        Assert.Equal(new[] { 0 }, Shown(blocked));
        // Janela deixa ver; porta aberta também.
        Assert.Equal(new[] { 0, 1 }, Shown(await prep.PreviewViewAsync(campaign.Id, Input(cells, [new FogWall { X1 = wall.X1, Y1 = wall.Y1, X2 = wall.X2, Y2 = wall.Y2, Kind = FogWallKinds.Window }], a, b), Master, default)));
        Assert.Equal(new[] { 0, 1 }, Shown(await prep.PreviewViewAsync(campaign.Id, Input(cells, [new FogWall { X1 = wall.X1, Y1 = wall.Y1, X2 = wall.X2, Y2 = wall.Y2, Kind = FogWallKinds.Door, Open = true }], a, b), Master, default)));
        // O grupo inteiro dá o mesmo resultado com um único jogador.
        Assert.Equal(new[] { 0 }, Shown(await prep.PreviewViewAsync(campaign.Id, Input(cells, [wall], a, b, party: true), Master, default)));

        // Somente leitura: nenhuma camada nem sessão foi criada.
        Assert.Equal(0, await db.Set<CampaignMapLayer>().CountAsync());
        Assert.Equal(0, await db.Sessions.CountAsync());
        var json = JsonSerializer.Serialize(blocked, Web);
        Assert.DoesNotContain("\"kind\"", json); // paredes no formato do jogador, sem tipo nem id
    }

    [Fact]
    public async Task Only_master_previews_and_input_is_validated()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var (a, b) = Pair(cells);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(campaign.Id, Input(cells, [], a, b), Player, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(campaign.Id, Input(cells, [], a, b), "estranho", default))).Status);
        var bad = Input(cells, [new FogWall { X1 = 0, Y1 = 0, X2 = 0, Y2 = 0 }], a, b);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(campaign.Id, bad, Master, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(campaign.Id, Input(cells, [], a, b, viewer: Guid.NewGuid()), Master, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(campaign.Id, Input(cells.Take(2).ToArray(), [], a, b), Master, default))).Status);
    }

    [Fact]
    public async Task Fog_off_shows_everything_except_hidden_creatures()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var (a, b) = Pair(cells);
        var input = Input(cells, [], a, b) with { VisionMode = VisionModes.All, Tokens = [new SceneTokenInput(hero.Id, null, null, null, a.X, a.Y), new SceneTokenInput(null, null, "Oculto", "enemy", b.X, b.Y, Hidden: true)] };
        var result = JsonSerializer.SerializeToElement(await prep.PreviewViewAsync(campaign.Id, input, Master, default), Web);
        Assert.False(result.GetProperty("active").GetBoolean());
        Assert.Equal(new[] { 0 }, result.GetProperty("shown").EnumerateArray().Select(e => e.GetInt32()).ToArray());
    }

    // ---------- Ensaio (ADR-111) ----------
    static int VisibleCount(object result) => Bits.Decode(JsonSerializer.SerializeToElement(result, Web).GetProperty("visible").GetString(), Crypt.Width * Crypt.Height).Count(v => v);

    async Task<(int Slots, int Scenes, int Layers, int Sessions, int Revisions)> Snapshot()
    {
        db.ChangeTracker.Clear();
        return (await db.PartySlots.CountAsync(), await db.Scenes.CountAsync(), await db.Set<CampaignMapLayer>().CountAsync(), await db.Sessions.CountAsync(),
            await db.PartySlots.SumAsync(s => s.Revision));
    }

    [Fact]
    public async Task Rehearsal_token_sees_in_a_campaign_without_players_and_a_wall_hides_the_creature()
    {
        // Campanha só do mestre: sem jogadores nem personagens; visão padrão da mesa de 30 m.
        var solo = new Campaign { OwnerId = Master, Name = "Ensaio", TableSettings = (TableSettings.Default with { PlayerVisionMeters = 30 }).Serialize() };
        db.Add(solo); await db.SaveChangesAsync();
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var (a, b) = Pair(cells);
        var x = (a.X + 2) * TableFog.WallUnit;
        var wall = new FogWall { X1 = x, Y1 = (a.Y - 1) * TableFog.WallUnit, X2 = x, Y2 = (a.Y + 2) * TableFog.WallUnit, Kind = FogWallKinds.Wall };
        PrepPreviewInput Rehearse(List<FogWall> walls) => new("crypt", null, new MapLayerInput(true, cells, [], "", [], 0, Walls: walls),
            [new SceneTokenInput(null, null, "Batedor", null, a.X, a.Y, Rehearsal: true), new SceneTokenInput(null, null, "Espreitador", "enemy", b.X, b.Y)],
            VisionModes.Character, ViewerToken: 0);
        var before = await Snapshot();

        var open = await prep.PreviewViewAsync(solo.Id, Rehearse([]), Master, default);
        Assert.Equal("Batedor", JsonSerializer.SerializeToElement(open, Web).GetProperty("viewer").GetString());
        Assert.True(VisibleCount(open) > 0);
        Assert.Equal(new[] { 0, 1 }, Shown(open));
        Assert.Equal(new[] { 0 }, Shown(await prep.PreviewViewAsync(solo.Id, Rehearse([wall]), Master, default)));
        // O inimigo não enxerga na prévia: escolher ele como visão é recusado; índice fora da cena também.
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(solo.Id, Rehearse([]) with { ViewerToken = 1 }, Master, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => prep.PreviewViewAsync(solo.Id, Rehearse([]) with { ViewerToken = 5 }, Master, default))).Status);
        Assert.Equal(before, await Snapshot());
    }

    [Fact]
    public async Task Rehearsal_profile_light_changes_what_is_seen_and_is_validated()
    {
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var (a, _) = Pair(cells);
        PrepPreviewInput Lit(int meters) => new("crypt", null, new MapLayerInput(true, cells, [], "", [], 0, Walls: []),
            [new SceneTokenInput(null, null, "Tocha", null, a.X, a.Y, Rehearsal: true)], VisionModes.Character,
            ViewerToken: 0, Profiles: [new RehearsalProfileInput(0, 0, meters, null, null)]);
        var dark = VisibleCount(await prep.PreviewViewAsync(campaign.Id, Lit(0), Master, default));
        var lit = VisibleCount(await prep.PreviewViewAsync(campaign.Id, Lit(18), Master, default));
        Assert.True(lit > dark, $"{lit} > {dark}");

        Task<int> Bad(RehearsalProfileInput p) => Status(() => prep.PreviewViewAsync(campaign.Id, Lit(0) with { Profiles = [p] }, Master, default));
        Assert.Equal(400, await Bad(new(3, null, null, null, null)));
        Assert.Equal(400, await Bad(new(0, 301, null, null, null)));
        Assert.Equal(400, await Bad(new(0, null, null, 101, null)));
        Assert.Equal(400, await Bad(new(0, null, null, null, new string('a', 401))));
        Assert.Equal(400, await Status(() => prep.PreviewViewAsync(campaign.Id, Lit(0) with { Profiles = [new(0, 1, 1, 1, null), new(0, 2, 2, 2, null)] }, Master, default)));
    }
    static async Task<int> Status(Func<Task> act) => (await Assert.ThrowsAsync<RuleException>(act)).Status;

    [Fact]
    public async Task Party_includes_synthetic_observers_from_reserved_slots_without_writing()
    {
        var slot = new PartySlot { CampaignId = campaign.Id, Name = "Reserva" };
        db.Add(slot); await db.SaveChangesAsync();
        var cells = TableFog.Initial(Crypt, TableSettings.Default).Cells;
        var (a, b) = Pair(cells);
        var grid = new FogGrid(Crypt.Width, Crypt.Height, cells);
        var scout = new[] { (a.X + 3, a.Y), (a.X + 2, a.Y) }.First(p => Crypt.CanStand(p.Item1, p.Item2) && !grid.BlocksMove(p.Item1, p.Item2));
        var x = (a.X + 2) * TableFog.WallUnit;
        var wall = new FogWall { X1 = x, Y1 = (a.Y - 1) * TableFog.WallUnit, X2 = x, Y2 = (a.Y + 2) * TableFog.WallUnit, Kind = FogWallKinds.Wall };
        // Tharion (jogador) atrás da parede; o reservado, do outro lado, sem luz e com visão de 30 m.
        PrepPreviewInput Scene(bool party) => new("crypt", null, new MapLayerInput(true, cells, [], "", [], 0, Walls: [wall]),
            [new SceneTokenInput(hero.Id, null, null, null, a.X, a.Y), new SceneTokenInput(null, null, "Espreitador", "enemy", b.X, b.Y), new SceneTokenInput(null, null, null, null, scout.Item1, scout.Item2, SlotId: slot.Id)],
            VisionModes.Character, party ? null : hero.Id, null, party, [new RehearsalProfileInput(2, 30, 0, null, null)]);
        var before = await Snapshot();

        Assert.DoesNotContain(1, Shown(await prep.PreviewViewAsync(campaign.Id, Scene(false), Master, default)));
        Assert.Contains(1, Shown(await prep.PreviewViewAsync(campaign.Id, Scene(true), Master, default)));
        // Visto só pelo reservado (índice do marcador).
        Assert.Contains(1, Shown(await prep.PreviewViewAsync(campaign.Id, Scene(false) with { ViewerCharacterId = null, ViewerToken = 2 }, Master, default)));
        Assert.Equal(before, await Snapshot());
    }
}
