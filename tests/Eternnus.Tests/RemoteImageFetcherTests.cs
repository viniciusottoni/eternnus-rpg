using System.Net;
using Eternnus.Web;
namespace Eternnus.Tests;

public sealed class RemoteImageFetcherTests
{
    static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

    [Theory]
    [InlineData("127.0.0.1")] [InlineData("10.1.2.3")] [InlineData("172.20.0.5")] [InlineData("192.168.0.10")]
    [InlineData("169.254.169.254")] [InlineData("100.64.0.1")] [InlineData("0.0.0.0")] [InlineData("224.0.0.1")]
    [InlineData("::1")] [InlineData("fe80::1")] [InlineData("fd00::1")] [InlineData("::ffff:127.0.0.1")]
    [InlineData("2002:a00:1::")] [InlineData("64:ff9b::a00:1")] [InlineData("2001:db8::1")]
    public void Internal_addresses_are_not_public(string address) => Assert.False(RemoteImageFetcher.IsPublic(IPAddress.Parse(address)));

    [Theory]
    [InlineData("8.8.8.8")] [InlineData("151.101.1.69")] [InlineData("2606:4700:4700::1111")]
    public void Public_addresses_are_allowed(string address) => Assert.True(RemoteImageFetcher.IsPublic(IPAddress.Parse(address)));

    [Theory]
    [InlineData("http://example.com/a.png")] [InlineData("https://user:pw@example.com/a.png")] [InlineData("https://example.com:8443/a.png")]
    [InlineData("https://localhost/a.png")] [InlineData("https://127.0.0.1/a.png")] [InlineData("https://[::1]/a.png")]
    [InlineData("https://intranet/a.png")] [InlineData("https://nas.local/a.png")] [InlineData("ftp://example.com/a.png")] [InlineData("")]
    public void Unsafe_links_are_rejected_before_any_request(string url) =>
        Assert.Equal(400, Assert.Throws<RuleException>(() => RemoteImageFetcher.Validate(url)).Status);

    [Fact]
    public async Task Redirects_are_revalidated_and_size_is_capped()
    {
        var calls = new List<Uri>();
        var fetcher = new RemoteImageFetcher(null, new Stub(request =>
        {
            calls.Add(request.RequestUri!);
            return request.RequestUri!.AbsolutePath switch
            {
                "/internal" => Redirect("https://127.0.0.1/secret"),
                "/moved" => Redirect("/map.png"),
                "/big" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[64]) },
                _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Png) },
            };
        }));
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => fetcher.FetchAsync("https://example.com/internal", 1024, default))).Status);
        Assert.DoesNotContain(calls, u => u.Host == "127.0.0.1");
        var (content, name) = await fetcher.FetchAsync("https://example.com/moved", 1024, default);
        Assert.Equal(Png, content);
        Assert.Equal("map.png", name);
        Assert.Equal(413, (await Assert.ThrowsAsync<RuleException>(() => fetcher.FetchAsync("https://example.com/big", 32, default))).Status);
    }

    [Fact]
    public async Task Names_resolving_to_internal_addresses_never_connect()
    {
        var fetcher = new RemoteImageFetcher((_, _) => Task.FromResult(new[] { IPAddress.Parse("8.8.8.8"), IPAddress.Parse("10.0.0.5") }));
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => fetcher.FetchAsync("https://images.example.com/a.png", 1024, default))).Status);
    }

    static HttpResponseMessage Redirect(string location) => new(HttpStatusCode.Found) { Headers = { Location = new Uri(location, UriKind.RelativeOrAbsolute) } };
    sealed class Stub(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(reply(request));
    }
}
