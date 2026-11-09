using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Eternnus.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Eternnus.Tests;

/// <summary>HTTP real, cookies/CSRF/Identity reais e relógio controlado; nenhum endpoint de bypass.</summary>
public sealed class LoginSessionTests
{
    sealed class Clock : TimeProvider
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan duration) => now += duration;
    }

    sealed class Fixture : IAsyncDisposable
    {
        readonly string directory = Path.Combine(Path.GetTempPath(), "eternnus-login-" + Guid.NewGuid());
        public WebApplication App { get; private set; } = null!;
        public Clock Clock { get; } = new();
        public string Origin { get; private set; } = "";
        public CookieAuthenticationOptions Cookies => App.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme);
        public async Task StartAsync()
        {
            Directory.CreateDirectory(directory);
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
            builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:Provider"] = "SqliteTest", ["Database:SqlitePath"] = Path.Combine(directory, "test.db"),
                ["DataProtection:Directory"] = Path.Combine(directory, "keys"), ["Mail:Mode"] = "Pickup",
                ["Mail:PickupDirectory"] = Path.Combine(directory, "mail"),
                ["Authentication:Google:ClientId"] = "test-id", ["Authentication:Google:ClientSecret"] = "test-secret",
                ["Authentication:Discord:ClientId"] = "test-id", ["Authentication:Discord:ClientSecret"] = "test-secret"
            });
            builder.AddEternnusServices();
            // Workers externos não fazem parte do fluxo de autenticação exercitado aqui.
            foreach (var item in builder.Services.Where(d => d.ImplementationType == typeof(MailWorker) || d.ImplementationType == typeof(OneShotWorker)).ToArray())
                builder.Services.Remove(item);
            builder.Services.AddSingleton<TimeProvider>(Clock);
            builder.Services.ConfigureAll<CookieAuthenticationOptions>(o => o.TimeProvider = Clock);
            builder.Services.Configure<SecurityStampValidatorOptions>(o => o.TimeProvider = Clock);
            App = builder.Build();
            await using (var scope = App.Services.CreateAsyncScope())
                await scope.ServiceProvider.GetRequiredService<GameDb>().Database.EnsureCreatedAsync();
            App.UseEternnusPipeline();
            App.MapAuthEndpoints();
            App.Urls.Add("http://127.0.0.1:0");
            await App.StartAsync();
            Origin = App.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        }
        public async Task<(AppUser User, string? Recovery)> UserAsync(string email = "hero@example.test", bool admin = false, bool mfa = false)
        {
            await using var scope = App.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = new AppUser { UserName = email, Email = email, EmailConfirmed = true, Role = admin ? PlatformRoles.Admin : PlatformRoles.Common };
            Assert.True((await users.CreateAsync(user, "Session-test!42")).Succeeded);
            string? recovery = null;
            if (admin || mfa)
            {
                Assert.True((await users.SetTwoFactorEnabledAsync(user, true)).Succeeded);
                recovery = (await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 3))!.First();
            }
            return (user, recovery);
        }
        public string Protect(AppUser user, AuthenticationProperties properties, string? scheme = null, bool mfa = false)
        {
            scheme ??= IdentityConstants.ApplicationScheme;
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.Id), new("AspNet.Identity.SecurityStamp", user.SecurityStamp!) };
            if (mfa) claims.Add(new("amr", "mfa"));
            var options = App.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(scheme);
            return options.TicketDataFormat.Protect(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, scheme)), properties, scheme));
        }
        public async ValueTask DisposeAsync()
        {
            if (App != null) { await App.StopAsync(); await App.DisposeAsync(); }
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    sealed class Client : IDisposable
    {
        readonly Fixture fixture;
        readonly HttpClient http;
        public Dictionary<string, string> Jar { get; } = [];
        string? csrf;
        public Client(Fixture fixture)
        {
            this.fixture = fixture;
            http = new(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false }) { BaseAddress = new Uri(fixture.Origin) };
        }
        public AuthenticationTicket Ticket => fixture.Cookies.TicketDataFormat.Unprotect(Jar["Eternnus.Session"])!;
        public async Task<HttpResponseMessage> CallAsync(string path, HttpMethod? method = null, object? body = null, bool antiforgery = true)
        {
            method ??= HttpMethod.Get;
            if (method != HttpMethod.Get && csrf == null && antiforgery) await RenewAsync();
            using var request = new HttpRequestMessage(method, path);
            if (Jar.Count > 0) request.Headers.Add("Cookie", string.Join("; ", Jar.Select(x => x.Key + "=" + x.Value)));
            request.Headers.Add("X-Eternnus", "1");
            if (antiforgery && csrf != null) request.Headers.Add("X-CSRF-TOKEN", csrf);
            if (body != null) request.Content = JsonContent.Create(body);
            var response = await http.SendAsync(request);
            if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
                foreach (var cookie in cookies)
                {
                    var pair = cookie.Split(';')[0].Split('=', 2);
                    if (pair[1] == "") Jar.Remove(pair[0]); else Jar[pair[0]] = pair[1];
                }
            return response;
        }
        public async Task RenewAsync()
        {
            using var response = await CallAsync("/api/auth/csrf");
            csrf = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        }
        public async Task<HttpResponseMessage> LoginAsync(bool remember = false, string email = "hero@example.test") =>
            await CallAsync("/api/auth/login", HttpMethod.Post, new { email, password = "Session-test!42", rememberMe = remember });
        public void Dispose() => http.Dispose();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Password_cookie_has_expected_persistence_and_cannot_outlive_absolute_deadline(bool remember)
    {
        await using var f = new Fixture(); await f.StartAsync(); await f.UserAsync(); using var c = new Client(f);
        using var login = await c.LoginAsync(remember);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var header = login.Headers.GetValues("Set-Cookie").Single(s => s.StartsWith("Eternnus.Session="));
        Assert.Contains("httponly", header, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", header, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(remember, header.Contains("expires=", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(remember, c.Ticket.Properties.IsPersistent);
        var started = f.Clock.GetUtcNow();
        var duration = remember ? TimeSpan.FromDays(14) : TimeSpan.FromDays(1);
        for (var elapsed = TimeSpan.Zero; elapsed < duration - TimeSpan.FromHours(7); elapsed += TimeSpan.FromHours(7))
        {
            f.Clock.Advance(TimeSpan.FromHours(7));
            using var me = await c.CallAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            Assert.True(c.Ticket.Properties.ExpiresUtc <= started + duration);
        }
        f.Clock.Advance(started + duration - f.Clock.GetUtcNow());
        using var expired = await c.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
    }

    [Fact]
    public async Task Ordinary_cookie_expires_after_eight_hours_without_requests_and_legacy_cookie_is_rejected()
    {
        await using var f = new Fixture(); await f.StartAsync(); var (user, _) = await f.UserAsync(); using var c = new Client(f);
        using var login = await c.LoginAsync();
        f.Clock.Advance(TimeSpan.FromHours(8));
        using var expired = await c.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
        c.Jar["Eternnus.Session"] = f.Protect(user, new AuthenticationProperties { ExpiresUtc = f.Clock.GetUtcNow().AddDays(30) });
        using var legacy = await c.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, legacy.StatusCode);
        Assert.False(c.Jar.ContainsKey("Eternnus.Session"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Persistence_survives_MFA_but_admin_never_gets_a_long_cookie(bool admin)
    {
        await using var f = new Fixture(); await f.StartAsync(); var (_, recovery) = await f.UserAsync(admin: admin, mfa: true); using var c = new Client(f);
        using var login = await c.LoginAsync(true);
        Assert.True((await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("requiresTwoFactor").GetBoolean());
        Assert.False(c.Jar.ContainsKey("Eternnus.Session"));
        using var pending = await c.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, pending.StatusCode);
        using var verify = await c.CallAsync("/api/auth/two-factor/verify", HttpMethod.Post, new { recoveryCode = recovery });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        Assert.Equal(!admin, c.Ticket.Properties.IsPersistent);
        Assert.True(c.Ticket.Principal.HasClaim("amr", "mfa"));
        var deadline = c.Ticket.Properties.ExpiresUtc;
        f.Clock.Advance(TimeSpan.FromHours(7));
        using var me = await c.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal(deadline, c.Ticket.Properties.ExpiresUtc);
        Assert.True(c.Ticket.Principal.HasClaim("amr", "mfa"));
        if (admin)
        {
            f.Clock.Advance(TimeSpan.FromHours(1));
            using var expired = await c.CallAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
        }
    }

    [Fact]
    public async Task Logout_all_requires_CSRF_and_revokes_other_devices()
    {
        await using var f = new Fixture(); await f.StartAsync(); await f.UserAsync(); using var a = new Client(f); using var b = new Client(f);
        using var first = await a.LoginAsync(true); using var second = await b.LoginAsync(true);
        await a.RenewAsync();
        using var denied = await a.CallAsync("/api/auth/logout-all", HttpMethod.Post, antiforgery: false);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        using var unaffected = await b.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, unaffected.StatusCode);
        using var logout = await a.CallAsync("/api/auth/logout-all", HttpMethod.Post);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.False(a.Jar.ContainsKey("Eternnus.Session"));
        using var revoked = await b.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
    }

    [Fact]
    public async Task Logout_all_revokes_pending_MFA_challenges()
    {
        await using var f = new Fixture(); await f.StartAsync(); var (_, recovery) = await f.UserAsync(mfa: true);
        using var a = new Client(f); using var pending = new Client(f);
        using var login = await a.LoginAsync(true);
        using var verify = await a.CallAsync("/api/auth/two-factor/verify", HttpMethod.Post, new { recoveryCode = recovery });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        await a.RenewAsync();
        using var challenge = await pending.LoginAsync(true);
        Assert.True((await challenge.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("requiresTwoFactor").GetBoolean());
        using var logout = await a.CallAsync("/api/auth/logout-all", HttpMethod.Post);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        using var invalidChallenge = await pending.CallAsync("/api/auth/two-factor/setup");
        Assert.Equal(HttpStatusCode.Unauthorized, invalidChallenge.StatusCode);
    }

    [Fact]
    public async Task MFA_challenge_expires_and_verification_body_cannot_change_the_persistence_choice()
    {
        await using var f = new Fixture(); await f.StartAsync(); var (_, recovery) = await f.UserAsync(mfa: true); using var c = new Client(f);
        using var login = await c.LoginAsync();
        using var verify = await c.CallAsync("/api/auth/two-factor/verify", HttpMethod.Post, new { recoveryCode = recovery, rememberMe = true });
        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        Assert.False(c.Ticket.Properties.IsPersistent);
        using var again = new Client(f); using var next = await again.LoginAsync(true);
        f.Clock.Advance(TimeSpan.FromMinutes(6));
        using var expired = await again.CallAsync("/api/auth/two-factor/setup");
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
        Assert.False(again.Jar.ContainsKey("Eternnus.Session"));
    }

    [Fact]
    public async Task Ordinary_logout_preserves_other_devices_but_password_reset_revokes_them()
    {
        await using var f = new Fixture(); await f.StartAsync(); await f.UserAsync(); using var a = new Client(f); using var b = new Client(f);
        using var first = await a.LoginAsync(true); using var second = await b.LoginAsync(true);
        await a.RenewAsync();
        using var logout = await a.CallAsync("/api/auth/logout", HttpMethod.Post);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        using var other = await b.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, other.StatusCode);
        await using (var scope = f.App.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = (await users.FindByEmailAsync("hero@example.test"))!;
            var token = await users.GeneratePasswordResetTokenAsync(user);
            Assert.True((await users.ResetPasswordAsync(user, token, "Changed-password!42")).Succeeded);
        }
        using var revoked = await b.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
    }

    [Fact]
    public async Task Email_confirmation_refresh_preserves_the_original_persistent_deadline()
    {
        await using var f = new Fixture(); await f.StartAsync(); var (created, _) = await f.UserAsync();
        string token;
        await using (var scope = f.App.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = (await users.FindByIdAsync(created.Id))!;
            user.EmailConfirmed = false;
            Assert.True((await users.UpdateAsync(user)).Succeeded);
            token = await users.GenerateEmailConfirmationTokenAsync(user);
        }
        using var c = new Client(f); using var login = await c.LoginAsync(true);
        var deadline = c.Ticket.Properties.ExpiresUtc;
        f.Clock.Advance(TimeSpan.FromDays(7));
        await c.RenewAsync();
        using var confirmation = await c.CallAsync("/api/auth/confirm", HttpMethod.Post, new
        {
            userId = created.Id,
            code = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(token))
        });
        Assert.Equal(HttpStatusCode.OK, confirmation.StatusCode);
        Assert.True(c.Ticket.Properties.IsPersistent);
        Assert.Equal(deadline, c.Ticket.Properties.ExpiresUtc);
        f.Clock.Advance(TimeSpan.FromDays(7));
        using var expired = await c.CallAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
    }

    [Theory]
    [InlineData("Google", true)]
    [InlineData("Discord", true)]
    [InlineData("Google", false)]
    [InlineData("Discord", false)]
    public async Task External_choice_uses_protected_state_and_callback_ignores_query_tampering(string provider, bool remember)
    {
        await using var f = new Fixture(); await f.StartAsync(); using var c = new Client(f);
        using var redirect = await c.CallAsync("/api/auth/external/" + provider.ToLowerInvariant() + "?rememberMe=" + remember.ToString().ToLowerInvariant());
        Assert.Equal(HttpStatusCode.Redirect, redirect.StatusCode);
        var state = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(redirect.Headers.Location!.Query)["state"].ToString();
        var options = f.App.Services.GetRequiredService<IOptionsMonitor<Microsoft.AspNetCore.Authentication.OAuth.OAuthOptions>>();
        // Google usa o mesmo formato OAuth, mas suas opções têm um monitor especializado.
        var properties = provider == "Google"
            ? f.App.Services.GetRequiredService<IOptionsMonitor<Microsoft.AspNetCore.Authentication.Google.GoogleOptions>>().Get(provider).StateDataFormat.Unprotect(state)
            : options.Get(provider).StateDataFormat.Unprotect(state);
        Assert.Equal(remember, LoginSession.Remembers(properties));
        var external = f.App.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ExternalScheme);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, "external-key"), new Claim(ClaimTypes.Email, "external@example.test"), new Claim("email_verified", "true") };
        properties!.Items["LoginProvider"] = provider;
        properties.IssuedUtc = f.Clock.GetUtcNow(); properties.ExpiresUtc = f.Clock.GetUtcNow().AddMinutes(5);
        c.Jar[external.Cookie.Name!] = external.TicketDataFormat.Protect(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, provider)), properties, IdentityConstants.ExternalScheme));
        using var callback = await c.CallAsync("/api/auth/external-callback?rememberMe=" + (!remember).ToString().ToLowerInvariant());
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal(remember, c.Ticket.Properties.IsPersistent);
    }
}

