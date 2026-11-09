using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Catálogo e trilha em SQLite. Bloqueios reais, HTTP Range e corridas são cobertos por tests/soundtrack.mjs em PostgreSQL.</summary>
public sealed class MusicCatalogTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    readonly string root = Path.Combine(Path.GetTempPath(), "eternnus-music-" + Guid.NewGuid().ToString("N"));
    readonly ManualClock clock = new(new DateTimeOffset(2026, 11, 8, 20, 0, 0, TimeSpan.Zero));
    GameDb db = null!;
    MusicStorage storage = null!;
    MusicCatalogService catalog = null!;
    SessionService sessions = null!;
    Campaign campaign = null!;
    Character hero = null!;
    int frames = 100;
    const string Admin = "admin", Master = "master", Player = "player", Outsider = "outsider";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Admin, Master, Player, Outsider }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion" };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        storage = new MusicStorage(root, Path.Combine(root, "..", "wwwroot-" + Guid.NewGuid().ToString("N")));
        catalog = new MusicCatalogService(db, storage, new AuditService(db));
        sessions = new SessionService(db, new SessionSignals(), clock);
    }

    public async Task DisposeAsync()
    {
        await db.DisposeAsync(); await connection.DisposeAsync();
        try { Directory.Delete(root, true); } catch (IOException) { }
    }

    static AudioUpload Upload(byte[] content, string title)
    {
        var probe = AudioProbe.Inspect(content)!;
        return new AudioUpload(content, probe.ContentType, probe.DurationMs, title, Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(content)));
    }

    static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value, Web);

    /// <summary>Cada faixa usa um arquivo diferente: o catálogo recusa conteúdo repetido.</summary>
    async Task<Guid> AddAsync(string title = "Taverna") => Json(await catalog.AddAsync(Admin, title, Upload(AudioSamples.Mp3(++frames), title), default)).GetProperty("id").GetGuid();

    async Task<Guid> StartAsync() => Json(await sessions.StartAsync(campaign.Id, new("Sessão", "", MapKinds.Tileset, "crypt"), Master, default)).GetProperty("id").GetGuid();

    async Task<JsonElement> CommandAsync(Guid session, string action, int version, Guid? track = null, long? position = null, bool? loop = null, string user = Master) =>
        Json(await sessions.SoundtrackAsync(session, new SoundtrackInput(action, version, track, position, loop), user, default)).GetProperty("music");

    async Task<JsonElement> LiveMusicAsync(Guid session, string user) => Json(await sessions.StateAsync(session, user, default)).GetProperty("music");

    [Fact]
    public void Storage_must_live_outside_the_public_web_root()
    {
        var web = Path.Combine(root, "wwwroot");
        Assert.Throws<InvalidOperationException>(() => new MusicStorage(Path.Combine(web, "music"), web));
        Assert.Throws<ArgumentException>(() => storage.PathOf("../../appsettings"));
    }

    [Fact]
    public async Task Catalog_search_is_paginated_and_exposes_only_presentation_fields()
    {
        for (var i = 0; i < 22; i++) await AddAsync($"Faixa {i:00}");
        var first = Json(await catalog.SearchAsync(null, 1, default));
        Assert.Equal(22, first.GetProperty("total").GetInt32());
        Assert.Equal(MusicLimits.PageSize, first.GetProperty("items").GetArrayLength());
        Assert.Equal(2, Json(await catalog.SearchAsync(null, 2, default)).GetProperty("items").GetArrayLength());
        Assert.Equal(1, Json(await catalog.SearchAsync("faixa 07", 1, default)).GetProperty("total").GetInt32());
        Assert.Equal(0, Json(await catalog.SearchAsync(null, int.MaxValue, default)).GetProperty("items").GetArrayLength());
        Assert.Equal(["id", "title", "format", "durationMs"], first.GetProperty("items")[0].EnumerateObject().Select(p => p.Name).ToArray());
        var admin = Json(await catalog.AdminListAsync(null, 1, default));
        Assert.Equal(22, admin.GetProperty("usage").GetProperty("tracks").GetInt32());
        // Nem a gestão expõe caminho físico ou chave de armazenamento.
        Assert.DoesNotContain("storageKey", admin.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(root.Replace("\\", "\\\\"), admin.GetRawText());
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.SearchAsync(new string('x', 101), 1, default))).Status);
    }

    [Fact]
    public async Task Quotas_and_duplicate_files_are_refused_and_uploads_are_audited()
    {
        await AddAsync("Primeira");
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.AddAsync(Admin, "Cópia", Upload(AudioSamples.Mp3(frames), "Cópia"), default))).Status);
        Assert.Single(Directory.GetFiles(root));
        Assert.Equal(1, await db.Audit.CountAsync(a => a.Action == "music.upload" && a.ActorId == Admin));
        for (var i = 1; i < MusicLimits.MaxTracks; i++)
            db.MusicTracks.Add(new MusicTrack { Title = $"Semeada {i}", SizeBytes = 10, StorageKey = MusicStorage.NewKey(), Sha256 = $"seed{i}" });
        await db.SaveChangesAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => AddAsync("Excesso"))).Status);
        await db.MusicTracks.Where(t => t.Title.StartsWith("Semeada")).ExecuteDeleteAsync();
        db.MusicTracks.Add(new MusicTrack { Title = "Grande", SizeBytes = MusicLimits.MaxCatalogBytes - 1000, StorageKey = MusicStorage.NewKey(), Sha256 = "grande" });
        await db.SaveChangesAsync();
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => AddAsync("Sem espaço"))).Status);
        Assert.Single(Directory.GetFiles(root));
    }

    [Fact]
    public async Task Rename_uses_revision_and_delete_removes_the_file_with_audit()
    {
        var id = await AddAsync();
        var track = await db.MusicTracks.AsNoTracking().SingleAsync(t => t.Id == id);
        Assert.True(File.Exists(storage.PathOf(track.StorageKey)));
        await catalog.RenameAsync(Admin, id, new("Batalha final", 1), default);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.RenameAsync(Admin, id, new("Velho", 1), default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.RenameAsync(Admin, id, new("  \u0007 ", 2), default))).Status);
        await catalog.DeleteAsync(Admin, id, default);
        Assert.False(File.Exists(storage.PathOf(track.StorageKey)));
        Assert.Equal(["music.delete", "music.rename", "music.upload"], await db.Audit.Where(a => a.TargetId == id.ToString()).Select(a => a.Action).OrderBy(a => a).ToListAsync());
    }

    [Fact]
    public async Task Sweeper_removes_only_old_orphan_files()
    {
        var id = await AddAsync();
        var kept = (await db.MusicTracks.SingleAsync(t => t.Id == id)).StorageKey;
        var orphan = MusicStorage.NewKey();
        await storage.WriteAsync(orphan, AudioSamples.Mp3(), default);
        Assert.Equal(0, await storage.SweepAsync(db, TimeSpan.FromHours(1), DateTime.UtcNow, default));
        Assert.Equal(1, await storage.SweepAsync(db, TimeSpan.FromHours(1), DateTime.UtcNow.AddHours(2), default));
        Assert.True(File.Exists(storage.PathOf(kept)));
        Assert.False(File.Exists(storage.PathOf(orphan)));
    }

    [Fact]
    public async Task Master_controls_shared_state_and_players_follow_the_reference_clock()
    {
        var track = await AddAsync();
        var session = await StartAsync();
        await sessions.JoinAsync(session, hero.Id, Player, default);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => CommandAsync(session, "select", 0, track, user: Player))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => CommandAsync(session, "select", 0, track, user: Outsider))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => CommandAsync(session, "play", 0))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => CommandAsync(session, "select", 0, Guid.NewGuid()))).Status);

        var selected = await CommandAsync(session, "select", 0, track);
        Assert.True(selected.GetProperty("playing").GetBoolean());
        Assert.Equal(1, selected.GetProperty("version").GetInt32());
        // Comando baseado em versão anterior (outra janela) é recusado sem alterar o estado.
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => CommandAsync(session, "pause", 0))).Status);

        clock.Advance(TimeSpan.FromSeconds(1.5));
        var paused = await CommandAsync(session, "pause", 1);
        Assert.Equal(1500, paused.GetProperty("positionMs").GetInt64());
        Assert.False(paused.GetProperty("playing").GetBoolean());

        var duration = (await db.MusicTracks.SingleAsync(t => t.Id == track)).DurationMs!.Value;
        Assert.Equal(duration, (await CommandAsync(session, "seek", 2, position: 999_999)).GetProperty("positionMs").GetInt64());
        await CommandAsync(session, "seek", 3, position: 500);
        await CommandAsync(session, "play", 4);
        clock.Advance(TimeSpan.FromSeconds(1));

        // Jogador que chega agora recebe a mesma referência e calcula a mesma posição esperada.
        var live = await LiveMusicAsync(session, Player);
        Assert.Equal(track, live.GetProperty("trackId").GetGuid());
        var state = new SoundtrackState(track, live.GetProperty("playing").GetBoolean(), live.GetProperty("positionMs").GetInt64(), live.GetProperty("referenceAt").GetDateTime(), live.GetProperty("loop").GetBoolean(), live.GetProperty("durationMs").GetInt32());
        Assert.Equal((1500L, false), state.At(clock.GetUtcNow().UtcDateTime));
        Assert.Equal($"/api/sessions/{session}/music/{track}/audio", live.GetProperty("audioUrl").GetString());

        // Fim da faixa sem repetição; ativar a repetição recomeça o ciclo sem salto inesperado.
        clock.Advance(TimeSpan.FromSeconds(10));
        Assert.True(state.At(clock.GetUtcNow().UtcDateTime).Ended);
        var looped = await CommandAsync(session, "loop", 5, loop: true);
        Assert.True(looped.GetProperty("loop").GetBoolean());
        Assert.Equal(duration, looped.GetProperty("positionMs").GetInt64());
        var events = await db.Events.AsNoTracking().Where(e => e.SessionId == session && e.Kind == EventKinds.Music).ToListAsync();
        Assert.Equal(6, events.Count);
        Assert.All(events, e => Assert.True(e.MasterOnly));
    }

    [Fact]
    public async Task Audio_bytes_reach_only_joined_participants_for_the_selected_track()
    {
        var track = await AddAsync();
        var other = await AddAsync("Outra");
        var session = await StartAsync();
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => sessions.SessionAudioAsync(session, track, Master, default))).Status);
        await CommandAsync(session, "select", 0, track);
        Assert.Equal(track, (await sessions.SessionAudioAsync(session, track, Master, default)).Id);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => sessions.SessionAudioAsync(session, track, Player, default))).Status);
        await sessions.JoinAsync(session, hero.Id, Player, default);
        Assert.Equal(track, (await sessions.SessionAudioAsync(session, track, Player, default)).Id);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => sessions.SessionAudioAsync(session, other, Player, default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => sessions.SessionAudioAsync(session, track, Outsider, default))).Status);
        await sessions.LeaveAsync(session, Player, default);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => sessions.SessionAudioAsync(session, track, Player, default))).Status);
    }

    [Fact]
    public async Task Track_in_use_cannot_be_deleted_until_stopped_and_session_end_clears_it()
    {
        var track = await AddAsync();
        var session = await StartAsync();
        await CommandAsync(session, "select", 0, track);
        await CommandAsync(session, "pause", 1);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.DeleteAsync(Admin, track, default))).Status);
        Assert.True(Json(await catalog.AdminListAsync(null, 1, default)).GetProperty("items")[0].GetProperty("inUse").GetBoolean());
        var stopped = await CommandAsync(session, "stop", 2);
        Assert.Equal(JsonValueKind.Null, stopped.GetProperty("trackId").ValueKind);
        await catalog.DeleteAsync(Admin, track, default);

        var next = await AddAsync("Fim");
        await CommandAsync(session, "select", 3, next);
        var before = (await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == session)).Revision;
        await sessions.EndAsync(session, Master, default);
        var ended = await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == session);
        Assert.Null(ended.MusicTrackId);
        Assert.False(ended.MusicPlaying);
        Assert.True(ended.Revision > before);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => CommandAsync(session, "select", ended.MusicVersion, next))).Status);
        await catalog.DeleteAsync(Admin, next, default);
    }

    sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
}
