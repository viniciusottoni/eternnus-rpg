using System.Text.Json;
using Eternnus.Web;
using ImageMagick;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Regras puras de luz, visão, caminho e detecção.</summary>
public sealed class FogRulesTests
{
    static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }

    static byte[] WhitePng(int width, int height)
    {
        static void Chunk(Stream s, string type, byte[] data)
        {
            var len = new byte[4]; System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(len, data.Length); s.Write(len);
            var body = System.Text.Encoding.ASCII.GetBytes(type).Concat(data).ToArray(); s.Write(body);
            var crc = new byte[4]; System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(crc, Crc32(body)); s.Write(crc);
        }
        var header = new byte[13];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(header, width);
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8; header[9] = 2; // 8 bits, RGB
        using var raw = new MemoryStream();
        using (var z = new System.IO.Compression.ZLibStream(raw, System.IO.Compression.CompressionLevel.Fastest, true))
            for (var y = 0; y < height; y++) { z.WriteByte(0); z.Write(Enumerable.Repeat((byte)255, width * 3).ToArray()); }
        using var png = new MemoryStream();
        png.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        Chunk(png, "IHDR", header); Chunk(png, "IDAT", raw.ToArray()); Chunk(png, "IEND", []);
        return png.ToArray();
    }

    static FogGrid Grid(params string[] rows) => new(rows[0].Length, rows.Length, rows);

    [Fact]
    public void Light_is_circular_and_stops_at_walls_symmetrically()
    {
        var grid = Grid(
            "..........",
            "....#.....",
            "..........",
            "..........");
        var lit = new bool[grid.Width * grid.Height];
        grid.Reach(2, 1, 3, lit);
        Assert.True(lit[grid.Index(4, 1)]);   // a face da parede é iluminada
        Assert.False(lit[grid.Index(5, 1)]);  // atrás da parede fica escuro
        Assert.False(lit[grid.Index(5, 3)]);  // fora do círculo (√13 > 3)
        Assert.True(lit[grid.Index(4, 3)]);   // dentro do círculo (√8 ≤ 3)
        for (var y = 0; y < grid.Height; y++) for (var x = 0; x < grid.Width; x++)
            Assert.Equal(grid.LineClear(2, 1, x, y), grid.LineClear(x, y, 2, 1));
    }

    [Fact]
    public void Diagonal_gap_between_two_touching_blocks_is_closed()
    {
        var grid = Grid(
            "...",
            ".#.",
            "#..");
        // Entre (1,1) e (0,2) os blocos se tocam pelo canto: a linha (0,1)->(1,2) passa pelo canto e é barrada.
        Assert.False(grid.LineClear(0, 1, 1, 2));
        Assert.True(grid.LineClear(0, 0, 2, 0));
    }

    [Fact]
    public void Official_legend_becomes_walls_doors_and_default_lights()
    {
        var state = TableFog.Initial(BattleMaps.Crypt, new TableSettings { TorchRadius = 5, BrazierRadius = 2 });
        Assert.Equal(TableFog.Wall, state.Cells[0][0]);
        Assert.Equal(TableFog.Wall, state.Cells[1][1]);          // T: tocha de parede
        Assert.Equal(TableFog.DoorOpen, state.Cells[2][17]);     // +: porta aberta
        Assert.Equal(TableFog.BlockMove, state.Cells[5][11]);    // b: braseiro não bloqueia luz
        Assert.Contains(state.Lights, l => l.X == 1 && l.Y == 1 && l.Radius == 5);
        Assert.Contains(state.Lights, l => l.X == 11 && l.Y == 5 && l.Radius == 2);
    }

    [Fact]
    public void Senses_are_normalized_and_converted()
    {
        var senses = TableFog.ParseSenses("Sentir Mágia: 9\nvisão verdadeira");
        Assert.Equal(("sentir magia", (int?)9), senses[0]);
        Assert.Equal(("visao verdadeira", (int?)null), senses[1]);
        Assert.Equal(6, TableFog.MetersToCells(9, 1.5m));
        Assert.Equal(0, TableFog.MetersToCells(1, 1.5m));
    }

    [Fact]
    public void Path_goes_around_walls_and_never_cuts_corners()
    {
        var grid = Grid(
            "....",
            ".#..",
            "#...",
            "....");
        Assert.Equal(3, FogRules.PathLength(grid, 0, 1, 1, 2, 5, (_, _) => true)); // não corta o canto entre dois bloqueios (seria 1)
        Assert.Equal(3, FogRules.PathLength(grid, 0, 0, 2, 2, 5, (_, _) => true));
        Assert.Null(FogRules.PathLength(grid, 0, 0, 2, 2, 2, (_, _) => true)); // além do deslocamento
        Assert.Null(FogRules.PathLength(grid, 0, 0, 3, 0, 5, (x, _) => x < 2)); // casas desconhecidas
    }

    [Fact]
    public void Detection_uses_perception_in_sight_or_sense_in_range()
    {
        var grid = Grid(".......", ".......");
        var state = new MapFogState { Cells = ["......."], Revealed = Bits.Encode(Enumerable.Repeat(true, 14).ToArray()) };
        state.Marks.Add(new FogMark { Id = "trap", X = 6, Y = 0, Dc = 15, Label = "Fosso", MaxDistance = 3 });
        var hero = new FogToken(Guid.NewGuid(), Guid.NewGuid(), "p1", "ally", 0, 0, 0, 0, 20, [], false, [], null, null, null);
        var hidden = new FogToken(Guid.NewGuid(), null, null, "enemy", 2, 1, 0, 0, 0, [], true, [], null, "sentir magia", null);
        var shared = FogRules.Shared(grid, state, [hero, hidden]);
        var found = FogRules.Detect(grid, state, [hero, hidden], shared);
        Assert.DoesNotContain(found, f => f.Target == "mark:trap");              // a 6 casas, além da distância máxima
        Assert.DoesNotContain(found, f => f.Target == hidden.Id.ToString());     // sem o sentido exigido
        var mystic = hero with { X = 4, Senses = [("sentir magia", 3)] };
        found = FogRules.Detect(grid, state, [mystic, hidden], shared);
        Assert.Contains(found, f => f.Target == "mark:trap" && f.User == "p1");
        Assert.Contains(found, f => f.Target == hidden.Id.ToString() && f.User == "p1");
    }

    [Fact]
    public async Task Masked_image_never_contains_pixels_of_unknown_cells()
    {
        // PNG branco montado à mão: a política restritiva dos avatares só libera PNG/JPEG (não o gerador "xc:").
        using var source = new MagickImage(WhitePng(140, 64), new MagickReadSettings { Format = MagickFormat.Png });
        var bytes = source.ToByteArray(MagickFormat.Jpeg);
        var known = new bool[8]; known[0] = true; // grade 4×2 de 32 px; faixa de 12 px à direita fora da grade
        var masked = await TableFogService.MaskAsync(Guid.NewGuid(), 1, bytes, 32, 4, 2, known, default);
        using var image = new MagickImage(masked);
        using var pixels = image.GetPixels();
        Assert.True(pixels.GetPixel(10, 10).ToColor()!.R > 200);   // casa conhecida
        Assert.True(pixels.GetPixel(50, 10).ToColor()!.R < 40);    // casa desconhecida
        Assert.True(pixels.GetPixel(10, 50).ToColor()!.R < 40);
        Assert.True(pixels.GetPixel(135, 10).ToColor()!.R < 40);   // fora da grade
    }
}

/// <summary>Névoa na mesa ao vivo: o servidor filtra o que cada jogador recebe.</summary>
public sealed class TableFogSessionTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    readonly ManualClock clock = new(new DateTimeOffset(2026, 11, 8, 21, 0, 0, TimeSpan.Zero));
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Cripta" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Movement = 9 };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        service = new SessionService(db, new SessionSignals(), clock);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => start;
    }

    async Task<Guid> StartAsync()
    {
        var result = await service.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)result.GetType().GetProperty("Id")!.GetValue(result)!;
        await service.JoinAsync(id, null, Player, default);
        return id;
    }
    async Task<string> StateJson(Guid id, string user) => JsonSerializer.Serialize(await service.StateAsync(id, user, default));
    async Task<SessionToken> HeroToken(Guid id) => await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.CharacterId == hero.Id);

    [Fact]
    public async Task Creatures_in_the_dark_never_reach_the_player_payload_or_events()
    {
        var id = await StartAsync();
        await service.AddTokenAsync(id, new("Espectro", "enemy", 3, 8), Master, default);
        await service.MoveTokenAsync(id, (await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Label == "Espectro")).Id, new(3, 7), Master, default);
        var player = await StateJson(id, Player);
        Assert.DoesNotContain("Espectro", player);
        Assert.Contains("\"active\":true", player);
        Assert.Contains("?", JsonDocument.Parse(player).RootElement.GetProperty("map").GetProperty("rows")[0].GetString());
        var master = await StateJson(id, Master);
        Assert.Contains("Espectro", master);
        Assert.DoesNotContain("?", JsonDocument.Parse(master).RootElement.GetProperty("map").GetProperty("rows")[0].GetString());
    }

    [Fact]
    public async Task Player_moves_only_through_known_cells_and_errors_do_not_reveal_terrain()
    {
        var id = await StartAsync();
        await service.NextTurnAsync(id, Master, default);
        await service.MoveGrantAsync(id, new(true), Master, default); // liberação do mestre (MoveNeedsGrant)
        var token = await HeroToken(id);
        var unknown = await Assert.ThrowsAsync<RuleException>(() => service.MoveTokenAsync(id, token.Id, new(token.X + 3, token.Y), Player, default));
        Assert.Equal("Esse ponto não está disponível.", unknown.Message);
        await service.PaintFogAsync(id, new("reveal", Enumerable.Range(token.X, 5).Select(x => new FogCellInput(x, token.Y)).ToList()), Master, default);
        await service.MoveTokenAsync(id, token.Id, new(token.X + 4, token.Y), Player, default);
        // O mestre nunca coloca alguém numa parede.
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.MoveTokenAsync(id, token.Id, new(0, 0), Master, default))).Status);
    }

    [Fact]
    public async Task Sheet_light_illuminates_for_everyone_and_master_override_wins()
    {
        hero.LightMeters = 6; await db.SaveChangesAsync(); // 4 casas na escala de 1,5 m
        var id = await StartAsync();
        await service.AddTokenAsync(id, new("Lobo", "enemy", 3, 8), Master, default);
        Assert.Contains("Lobo", await StateJson(id, Player));
        var token = await HeroToken(id);
        await service.TokenSettingsAsync(id, token.Id, new(0, null, null, null, false, null, null, null), Master, default);
        Assert.DoesNotContain("Lobo", await StateJson(id, Player));
    }

    [Fact]
    public async Task Hidden_elements_are_detected_by_perception_or_sense_and_told_only_to_the_finder()
    {
        hero.Perception = 15; hero.Senses = "Sentir magia: 9"; await db.SaveChangesAsync();
        var id = await StartAsync();
        // Iluminado pelo braseiro (12,5): a percepção revela.
        await service.AddTokenAsync(id, new("Cultista", "enemy", 12, 7, Hidden: true), Master, default);
        var cultist = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Label == "Cultista");
        await service.TokenSettingsAsync(id, cultist.Id, new(null, null, null, null, true, 12, null, null), Master, default);
        var json = await StateJson(id, Player);
        Assert.Contains("Cultista", json);
        Assert.Contains("percebeu: Cultista", json);
        // No escuro, a 3 casas: o sentido detecta, mas o jogador só recebe uma silhueta.
        await service.AddTokenAsync(id, new("Runa viva", "enemy", 3, 8, Hidden: true), Master, default);
        var rune = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Label == "Runa viva");
        await service.TokenSettingsAsync(id, rune.Id, new(null, null, null, null, true, null, "sentir mágia", null), Master, default);
        var root = JsonDocument.Parse(await StateJson(id, Player)).RootElement;
        var perceived = root.GetProperty("tokens").EnumerateArray().Single(t => t.GetProperty("Id").GetGuid() == rune.Id);
        Assert.True(perceived.GetProperty("perceived").GetBoolean());
        Assert.Equal("?", perceived.GetProperty("label").GetString());
    }

    [Fact]
    public async Task Settings_apply_to_the_session_or_to_the_whole_campaign()
    {
        var id = await StartAsync();
        await service.UpdateTableSettingsAsync(id, new(new TableSettings { FogEnabled = false }, "session"), Master, default);
        Assert.Null((await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == campaign.Id)).TableSettings);
        Assert.Contains("\"active\":false", await StateJson(id, Player));
        await service.UpdateTableSettingsAsync(id, new(new TableSettings { TorchRadius = 2 }, "campaign"), Master, default);
        Assert.Null((await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == id)).TableSettings);
        await service.EndAsync(id, Master, default);
        var next = await StartAsync();
        var settings = JsonSerializer.Serialize(await service.TableSettingsAsync(next, Master, default));
        Assert.Contains("\"TorchRadius\":2", settings);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.UpdateTableSettingsAsync(next, new(null, "session"), Player, default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.ViewAsAsync(next, Player, Player, default))).Status);
        Assert.Contains("\"active\":true", JsonSerializer.Serialize(await service.ViewAsAsync(next, Player, Master, default)));
    }

    [Fact]
    public async Task Turn_reach_comes_from_template_roles_and_the_master_decides_without_them()
    {
        hero.ReachMeters = 3; await db.SaveChangesAsync();
        var id = await StartAsync();
        var me = JsonDocument.Parse(await StateJson(id, Player)).RootElement.GetProperty("me").GetProperty("character");
        Assert.True(me.GetProperty("movementRole").GetBoolean()); // modelo livre define Deslocamento
        Assert.Equal(3, me.GetProperty("reach").GetInt32());
        await service.EndAsync(id, Master, default);

        // Modelo sem o papel Deslocamento: a mesa não desenha alcance e o servidor não limita a distância.
        var system = new RpgSystem { Name = "Narrativo", Slug = "narrativo" };
        var template = new SheetTemplate { RpgSystemId = system.Id, Name = "Ficha narrativa", IsDefault = true };
        var version = new SheetTemplateVersion
        {
            TemplateId = template.Id, Number = 1, PublishedAt = DateTime.UtcNow, Pages = [new SheetPage()],
            Fields = [new SheetField { Name = "nome", Label = "Nome", Type = SheetFieldTypes.Text, Role = SheetFieldRoles.Name, X = 0.1, Y = 0.1, W = 0.3, H = 0.05 }],
        };
        template.CurrentVersionId = version.Id;
        db.AddRange(system, template, version);
        campaign.RpgSystemId = system.Id; campaign.System = system.Name; campaign.TableSettings = new TableSettings { FogEnabled = false }.Serialize();
        hero.TemplateVersionId = version.Id; hero.ReachMeters = null;
        await db.SaveChangesAsync();
        var next = await StartAsync();
        me = JsonDocument.Parse(await StateJson(next, Player)).RootElement.GetProperty("me").GetProperty("character");
        Assert.False(me.GetProperty("movementRole").GetBoolean());
        Assert.Equal(JsonValueKind.Null, me.GetProperty("reach").ValueKind);
        await service.NextTurnAsync(next, Master, default);
        await service.MoveGrantAsync(next, new(true), Master, default); // liberação do mestre (MoveNeedsGrant)
        var token = await HeroToken(next);
        await service.MoveTokenAsync(next, token.Id, new(token.X + 10, token.Y), Player, default); // além de 9 m: o mestre decide
    }

    [Fact]
    public async Task Exploration_continues_in_the_next_session_until_the_master_resets_it()
    {
        var id = await StartAsync();
        await service.PaintFogAsync(id, new("reveal", [new(2, 2)]), Master, default);
        await service.EndAsync(id, Master, default);
        var next = await StartAsync();
        var state = JsonDocument.Parse(await StateJson(next, Master)).RootElement.GetProperty("fog");
        Assert.NotEqual("", state.GetProperty("revealed").GetString());
        await service.ResetExplorationAsync(next, Master, default);
        state = JsonDocument.Parse(await StateJson(next, Master)).RootElement.GetProperty("fog");
        Assert.Equal("", state.GetProperty("revealed").GetString());
    }
}
