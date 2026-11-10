using System.Text.Json;
using Eternnus.Web;
using ImageMagick;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System.Net;
using System.Net.Sockets;
using System.Buffers.Binary;

namespace Eternnus.Tests;

public sealed class ProfileTests
{
    sealed class Safety : IAvatarSafety
    {
        public bool Available { get; set; } = true;
        public int? ScanFailure { get; set; }
        public int? ModerationFailure { get; set; }
        public int Moderations { get; private set; }
        public Task ScanAsync(byte[] original, CancellationToken ct) { if (ScanFailure is int status) throw new RuleException(status, "blocked"); return Task.CompletedTask; }
        public Task ModerateAsync(byte[] image, CancellationToken ct) { Moderations++; if (ModerationFailure is int status) throw new RuleException(status, "blocked"); return Task.CompletedTask; }
    }
    sealed class Fixture : IAsyncDisposable
    {
        readonly SqliteConnection connection = new("Data Source=:memory:");
        public GameDb Db { get; }
        public Safety Safety { get; } = new();
        public ProfileService Profiles { get; }
        public Fixture()
        {
            connection.Open();
            Db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
            Db.Database.EnsureCreated();
            Db.Users.AddRange(new AppUser { Id = "owner", UserName = "owner", NormalizedEmail = "OWNER", EmailConfirmed = true, DisplayName = "Original" }, new AppUser { Id = "other", UserName = "other", NormalizedEmail = "OTHER" });
            Db.SaveChanges();
            Profiles = new(Db, Safety);
        }
        public async ValueTask DisposeAsync() { await Db.DisposeAsync(); await connection.DisposeAsync(); }
    }
    static byte[] Image()
    {
        // Initialize the real decoder policy before creating an in-memory test fixture.
        Assert.Throws<RuleException>(() => AvatarProcessor.Validate(new byte[16], "a.svg", "image/svg+xml"));
        using var image = new MagickImage(File.ReadAllBytes(Path.GetFullPath("../../../../fixtures/avatar.png", AppContext.BaseDirectory)));
        image.SetAttribute("comment", "private metadata");
        return image.ToByteArray(MagickFormat.Png);
    }
    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("name\ncontrol")]
    public void Invalid_names_are_rejected(string name) => Assert.Throws<RuleException>(() => ProfileService.ValidateName(name));
    [Fact]
    public async Task Name_update_preserves_identity_and_other_users()
    {
        await using var f = new Fixture();
        var u = await f.Profiles.UpdateNameAsync("owner", "  Nova Aventureira  ", default);
        Assert.Equal("Nova Aventureira", u.DisplayName);
        Assert.True(u.EmailConfirmed);
        Assert.Equal("owner", u.UserName);
        Assert.Equal("Aventureiro", (await f.Db.Users.SingleAsync(u => u.Id == "other")).DisplayName);
        await Assert.ThrowsAsync<RuleException>(() => f.Profiles.UpdateNameAsync("owner", new string('a', 81), default));
    }
    [Fact]
    public async Task Safe_avatar_is_reencoded_without_metadata_and_replaces_only_the_owners_image()
    {
        await using var f = new Fixture();
        var image = Image();
        var first = await f.Profiles.UploadAsync("owner", image, "image.png", "image/png", default);
        var oldUrl = first.AvatarUrl;
        var saved = await f.Db.Avatars.SingleAsync();
        using var decoded = new MagickImage(saved.Content);
        Assert.Equal(MagickFormat.Jpeg, decoded.Format);
        Assert.Equal(512u, decoded.Width);
        Assert.Equal(512u, decoded.Height);
        Assert.Null(decoded.GetAttribute("comment"));
        Assert.Empty(decoded.ProfileNames);
        await f.Profiles.UploadAsync("owner", image, "image.png", "image/png", default);
        Assert.NotEqual(oldUrl, first.AvatarUrl);
        Assert.Equal(1, await f.Db.Avatars.CountAsync());
        Assert.Equal("/assets/avatar.svg", (await f.Db.Users.SingleAsync(u => u.Id == "other")).AvatarUrl);
    }
    [Theory]
    [InlineData(422, null)]
    [InlineData(503, null)]
    [InlineData(null, 422)]
    [InlineData(null, 503)]
    public async Task Infected_disallowed_or_unavailable_checks_leave_the_previous_avatar_untouched(int? scan, int? moderation)
    {
        await using var f = new Fixture();
        var data = Image();
        await f.Profiles.UploadAsync("owner", data, "image.png", "image/png", default);
        var previous = (await f.Db.Avatars.SingleAsync()).Content.ToArray();
        var url = (await f.Db.Users.SingleAsync(u => u.Id == "owner")).AvatarUrl;
        f.Safety.ScanFailure = scan; f.Safety.ModerationFailure = moderation;
        await Assert.ThrowsAsync<RuleException>(() => f.Profiles.UploadAsync("owner", data, "image.png", "image/png", default));
        Assert.Equal(previous, (await f.Db.Avatars.SingleAsync()).Content);
        Assert.Equal(url, (await f.Db.Users.SingleAsync(u => u.Id == "owner")).AvatarUrl);
    }
    [Fact]
    public async Task No_configuration_never_publishes_an_avatar()
    {
        await using var f = new Fixture(); f.Safety.Available = false;
        Assert.Equal(503, (await Assert.ThrowsAsync<RuleException>(() => f.Profiles.UploadAsync("owner", Image(), "image.png", "image/png", default))).Status);
        Assert.Empty(await f.Db.Avatars.ToListAsync());
    }
    [Fact]
    public void Forged_types_excessive_dimensions_corruption_and_animation_are_rejected()
    {
        var valid = Image();
        Assert.Throws<RuleException>(() => AvatarProcessor.Validate(valid, "image.jpg", "image/jpeg"));
        Assert.Throws<RuleException>(() => AvatarProcessor.Validate(new byte[AvatarProcessor.MaxBytes + 1], "image.png", "image/png"));
        Assert.Throws<RuleException>(() => AvatarProcessor.Validate("<svg onload='alert(1)'/>"u8.ToArray(), "image.png", "image/png"));
        Assert.Throws<RuleException>(() => AvatarProcessor.Normalize([255,216,255,0,0,0], MagickFormat.Jpeg, default));
        var large = File.ReadAllBytes(Path.GetFullPath("../../../../fixtures/avatar-excessive-pixels.png", AppContext.BaseDirectory));
        Assert.Throws<RuleException>(() => AvatarProcessor.Normalize(large, MagickFormat.Png, default));
        var animated = valid[..8].Concat(new byte[] { 0,0,0,0,97,99,84,76,0,0,0,0 }).Concat(valid[8..]).ToArray();
        Assert.Throws<RuleException>(() => AvatarProcessor.Validate(animated, "animation.png", "image/png"));
    }
    [Theory]
    [InlineData("{}", 503)]
    [InlineData("{\"categoriesAnalysis\":[]}", 503)]
    [InlineData("{\"categoriesAnalysis\":[{\"category\":\"Hate\",\"severity\":2},{\"category\":\"SelfHarm\",\"severity\":0},{\"category\":\"Sexual\",\"severity\":0},{\"category\":\"Violence\",\"severity\":0}]}", 422)]
    public void Moderation_rejects_incomplete_or_disallowed_results(string data, int status)
    {
        using var json = JsonDocument.Parse(data);
        Assert.Equal(status, Assert.Throws<RuleException>(() => AvatarSafety.ValidateModeration(json.RootElement)).Status);
    }
    [Fact]
    public void All_categories_must_explicitly_pass()
    {
        using var json = JsonDocument.Parse("{\"categoriesAnalysis\":[{\"category\":\"Hate\",\"severity\":0},{\"category\":\"SelfHarm\",\"severity\":0},{\"category\":\"Sexual\",\"severity\":0},{\"category\":\"Violence\",\"severity\":0}]}");
        AvatarSafety.ValidateModeration(json.RootElement);
    }
    sealed class NoHttp : IHttpClientFactory { public HttpClient CreateClient(string name) => throw new InvalidOperationException(); }
    [Theory]
    [InlineData("stream: OK\0", 0)]
    [InlineData("stream: Test-Signature FOUND\0", 422)]
    [InlineData("stream: scanner ERROR\0", 503)]
    public async Task Antivirus_adapter_uses_streaming_protocol_and_requires_an_explicit_clean_result(string reply, int status)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var server = Task.Run(async () => {
            using var client = await listener.AcceptTcpClientAsync();
            await using var stream = client.GetStream();
            var command = new byte[10]; await stream.ReadExactlyAsync(command);
            Assert.Equal("zINSTREAM\0", System.Text.Encoding.ASCII.GetString(command));
            var size = new byte[4]; await stream.ReadExactlyAsync(size);
            var content = new byte[BinaryPrimitives.ReadInt32BigEndian(size)]; await stream.ReadExactlyAsync(content);
            Assert.Equal(new byte[] { 1,2,3 }, content);
            await stream.ReadExactlyAsync(size); Assert.Equal(0, BinaryPrimitives.ReadInt32BigEndian(size));
            await stream.WriteAsync(System.Text.Encoding.ASCII.GetBytes(reply));
        });
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> {
            ["Avatar:ClamAv:Host"] = "127.0.0.1", ["Avatar:ClamAv:Port"] = ((IPEndPoint)listener.LocalEndpoint).Port.ToString(),
            ["Avatar:Moderation:Endpoint"] = "https://test.invalid/", ["Avatar:Moderation:Key"] = "test-only"
        }).Build();
        var safety = new AvatarSafety(config, new NoHttp());
        if (status == 0) await safety.ScanAsync([1,2,3], default);
        else Assert.Equal(status, (await Assert.ThrowsAsync<RuleException>(() => safety.ScanAsync([1,2,3], default))).Status);
        await server;
    }
    static ClamAvDocumentScanner DocumentScanner(string? host, int port = 3310) =>
        new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Uploads:ClamAv:Host"] = host, ["Uploads:ClamAv:Port"] = port.ToString(),
        }).Build(), Microsoft.Extensions.Logging.Abstractions.NullLogger<ClamAvDocumentScanner>.Instance);
    [Theory]
    [InlineData("stream: OK\0", 0)]
    [InlineData("stream: Test-Signature FOUND\0", 422)]
    [InlineData("stream: scanner ERROR\0", 0)]
    public async Task Document_scanner_rejects_detections_and_accepts_when_the_scanner_fails(string reply, int status)
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var server = Task.Run(async () => {
            using var client = await listener.AcceptTcpClientAsync();
            await using var stream = client.GetStream();
            var command = new byte[10]; await stream.ReadExactlyAsync(command);
            var size = new byte[4]; await stream.ReadExactlyAsync(size);
            await stream.ReadExactlyAsync(new byte[BinaryPrimitives.ReadInt32BigEndian(size)]);
            await stream.ReadExactlyAsync(size);
            await stream.WriteAsync(System.Text.Encoding.ASCII.GetBytes(reply));
        });
        var scanner = DocumentScanner("127.0.0.1", ((IPEndPoint)listener.LocalEndpoint).Port);
        if (status == 0) await scanner.ScanAsync([1, 2, 3], default);
        else Assert.Equal(status, (await Assert.ThrowsAsync<RuleException>(() => scanner.ScanAsync([1, 2, 3], default))).Status);
        await server;
    }
    [Fact]
    public async Task Document_scanner_accepts_when_clamav_is_missing_or_unreachable()
    {
        await DocumentScanner(null).ScanAsync([1, 2, 3], default);
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var closedPort = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        await DocumentScanner("127.0.0.1", closedPort).ScanAsync([1, 2, 3], default);
    }
    sealed class ModerationHttp(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, false);
    }
    sealed class ModerationHandler(HttpStatusCode status, string payload) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Assert.Equal("https", request.RequestUri!.Scheme);
            Assert.Equal("/contentsafety/image:analyze", request.RequestUri.AbsolutePath);
            Assert.Equal("test-only", request.Headers.GetValues("Ocp-Apim-Subscription-Key").Single());
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            Assert.Equal(Convert.ToBase64String(new byte[] { 1, 2, 3 }), body.RootElement.GetProperty("image").GetProperty("content").GetString());
            Assert.Equal(4, body.RootElement.GetProperty("categories").GetArrayLength());
            return new HttpResponseMessage(status) { Content = new StringContent(payload) };
        }
    }
    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}")]
    [InlineData(HttpStatusCode.OK, "invalid json")]
    [InlineData(HttpStatusCode.OK, "{\"categoriesAnalysis\":[]}")]
    public async Task External_moderation_adapter_fails_closed_on_service_errors_and_incomplete_responses(HttpStatusCode status, string payload)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> {
            ["Avatar:ClamAv:Host"] = "127.0.0.1", ["Avatar:Moderation:Endpoint"] = "https://test.invalid/", ["Avatar:Moderation:Key"] = "test-only"
        }).Build();
        using var handler = new ModerationHandler(status, payload);
        var safety = new AvatarSafety(config, new ModerationHttp(handler));
        Assert.Equal(503, (await Assert.ThrowsAsync<RuleException>(() => safety.ModerateAsync([1,2,3], default))).Status);
    }

}
