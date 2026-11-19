using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>"Mostrar esta região" e exibição externa (ADR-115): enquadramento só do mestre, sem evento, e tela projetada sem dados do mestre.</summary>
public sealed class CameraTests : IAsyncLifetime
{
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player", Outsider = "outsider";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, Email = id + "@exemplo.com", DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran", TableSettings = (TableSettings.Default with { PlayMode = PlayModes.Free, FogEnabled = false }).Serialize() };
        hero = new Character { OwnerId = Player, Name = "Tharion" };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        service = new SessionService(db, new SessionSignals(), TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    async Task<Guid> StartAsync(string kind = MapKinds.Tileset, string map = "crypt")
    {
        var r = await service.StartAsync(campaign.Id, new("Sessão", "Objetivo secreto", kind, map), Master, default);
        var id = (Guid)r.GetType().GetProperty("Id")!.GetValue(r)!;
        await service.JoinAsync(id, hero.Id, Player, default);
        db.ChangeTracker.Clear();
        return id;
    }
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, Web);
    static async Task<int> Status(Func<Task> action) => (await Assert.ThrowsAsync<RuleException>(action)).Status;
    async Task<int> RevisionAsync(Guid id) => await db.Sessions.Where(s => s.Id == id).Select(s => s.Revision).SingleAsync();

    [Fact]
    public async Task Master_frames_a_region_for_everyone_without_writing_history()
    {
        var id = await StartAsync();
        Assert.Equal(JsonValueKind.Null, Json(await service.StateAsync(id, Player, default)).GetProperty("camera").ValueKind);
        var events = await db.Events.CountAsync();
        var revision = await RevisionAsync(id);
        await service.SetCameraAsync(id, new(2, 3, 10.123, 6), Master, default);
        var camera = Json(await service.StateAsync(id, Player, default)).GetProperty("camera");
        Assert.Equal((2d, 3d, 10.12, 6d, 1), (camera.GetProperty("x").GetDouble(), camera.GetProperty("y").GetDouble(), camera.GetProperty("w").GetDouble(), camera.GetProperty("h").GetDouble(), camera.GetProperty("seq").GetInt32()));
        Assert.True(await RevisionAsync(id) > revision);
        await service.SetCameraAsync(id, new(0, 0, 5, 5), Master, default);
        Assert.Equal(2, Json(await service.StateAsync(id, Master, default)).GetProperty("camera").GetProperty("seq").GetInt32());
        Assert.Equal(events, await db.Events.CountAsync());
    }

    [Fact]
    public async Task Only_the_master_frames_and_regions_must_touch_the_map()
    {
        var id = await StartAsync();
        Assert.Equal(403, await Status(() => service.SetCameraAsync(id, new(0, 0, 5, 5), Player, default)));
        Assert.Equal(404, await Status(() => service.SetCameraAsync(id, new(0, 0, 5, 5), Outsider, default)));
        Assert.Equal(400, await Status(() => service.SetCameraAsync(id, new(0, 0, 0, 5), Master, default)));
        Assert.Equal(400, await Status(() => service.SetCameraAsync(id, new(0, 0, 401, 5), Master, default)));
        Assert.Equal(400, await Status(() => service.SetCameraAsync(id, new(24, 0, 5, 5), Master, default))); // a cripta tem 24 casas de largura
        Assert.Equal(400, await Status(() => service.SetCameraAsync(id, new(-6, 0, 5, 5), Master, default)));
        Assert.Equal(400, await Status(() => service.SetCameraAsync(id, new(double.NaN, 0, 5, 5), Master, default)));
        await service.SetCameraAsync(id, new(-2, -2, 5, 5), Master, default); // pode passar da borda se tocar o mapa
        Assert.Null(await db.Sessions.Where(s => s.Id == id && s.Camera == null).Select(s => (Guid?)s.Id).SingleOrDefaultAsync());
    }

    [Fact]
    public async Task Cartographic_maps_use_the_generic_bound()
    {
        var id = await StartAsync(MapKinds.Cartographic, BattleMaps.All.First(m => m.Kind == MapKinds.Cartographic).Key);
        await service.SetCameraAsync(id, new(300, 300, 50, 50), Master, default);
        Assert.Equal(400, await Status(() => service.SetCameraAsync(id, new(400, 0, 5, 5), Master, default)));
    }

    [Fact]
    public async Task External_display_is_master_only_and_shows_the_spectator_view()
    {
        var id = await StartAsync();
        await service.NoteAsync(id, new("Segredo do mestre", false), Master, default);
        await service.AddTokenAsync(id, new("Cultista escondido", "enemy", 3, 8, Hidden: true), Master, default);
        await service.AddTokenAsync(id, new("Guarda", "ally", 2, 2), Master, default);
        await service.SetCameraAsync(id, new(1, 1, 8, 6), Master, default);
        Assert.Equal(403, await Status(() => service.DisplayStateAsync(id, Player, default)));
        Assert.Equal(404, await Status(() => service.DisplayStateAsync(id, Outsider, default)));
        var state = Json(await service.DisplayStateAsync(id, Master, default));
        var json = state.GetRawText();
        foreach (var secret in new[] { "Segredo do mestre", "Objetivo secreto", "Cultista escondido", "@exemplo.com", "revealedTo", "masterCharacterId" })
            Assert.DoesNotContain(secret, json);
        Assert.Contains("Guarda", json);
        Assert.True(state.GetProperty("me").GetProperty("display").GetBoolean());
        Assert.False(state.GetProperty("me").GetProperty("isMaster").GetBoolean());
        Assert.Equal(1, state.GetProperty("camera").GetProperty("seq").GetInt32());
        // Long-poll somente leitura: com revisão atual e sem mudança, devolve o mesmo estado sem escrever.
        var revision = await RevisionAsync(id);
        var live = Json(await service.DisplayLiveAsync(id, 0, Master, default));
        Assert.Equal(revision, live.GetProperty("revision").GetInt32());
        Assert.Equal(revision, await RevisionAsync(id));
        // A mesa do jogador continua igual (com câmera e sem lista de convidados).
        var player = Json(await service.StateAsync(id, Player, default));
        Assert.True(player.GetProperty("me").GetProperty("joined").GetBoolean());
        Assert.Equal(JsonValueKind.Null, player.GetProperty("guests").ValueKind);
        Assert.Equal(1, player.GetProperty("camera").GetProperty("seq").GetInt32());
    }
}
