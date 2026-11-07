using System.Security.Claims;
using Eternnus.Web;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Eternnus.Tests;

public sealed class ExternalAccountsTests {
    sealed class Fixture : IAsyncDisposable {
        readonly SqliteConnection connection = new("Data Source=:memory:");
        readonly ServiceProvider provider;
        readonly IServiceScope scope;
        public UserManager<AppUser> Users { get; }
        public ExternalAccounts Accounts { get; }
        public GameDb Db { get; }
        public Fixture() {
            connection.Open();
            var services = new ServiceCollection();
            services.AddLogging(); services.AddDataProtection();
            services.AddDbContext<GameDb>(options => options.UseSqlite(connection));
            services.AddIdentityCore<AppUser>(o => o.User.RequireUniqueEmail = true).AddEntityFrameworkStores<GameDb>().AddDefaultTokenProviders();
            provider = services.BuildServiceProvider(); scope = provider.CreateScope();
            Db = scope.ServiceProvider.GetRequiredService<GameDb>(); Db.Database.EnsureCreated();
            Users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>(); Accounts = new(Users);
        }
        public async ValueTask DisposeAsync() { scope.Dispose(); await provider.DisposeAsync(); await connection.DisposeAsync(); }
    }
    static ExternalLoginInfo Info(string email = "hero@example.test", string verified = "true", string provider = "Google", string key = "external-key", string avatar = "https://lh3.googleusercontent.com/avatar", string name = "Aventureira") {
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier,key), new(ClaimTypes.Name,name), new("email_verified",verified), new("avatar",avatar) };
        if (email.Length > 0) claims.Add(new(ClaimTypes.Email,email));
        return new(new ClaimsPrincipal(new ClaimsIdentity(claims,provider)),provider,key,provider);
    }

    [Theory]
    [InlineData("false", "hero@example.test")]
    [InlineData("", "hero@example.test")]
    [InlineData("true", "")]
    public async Task Unverified_or_missing_email_does_not_create_a_local_account(string verified,string email) {
        await using var fixture = new Fixture();
        Assert.Null(await fixture.Accounts.ResolveAsync(Info(email,verified)));
        Assert.Empty(await fixture.Db.Users.ToListAsync());
    }

    [Theory]
    [InlineData("Unconfigured")]
    [InlineData("Local")]
    [InlineData("")]
    public async Task Unsupported_provider_never_creates_an_account(string provider) {
        await using var fixture = new Fixture();
        Assert.Null(await fixture.Accounts.ResolveAsync(Info(provider:provider)));
        Assert.Empty(await fixture.Db.Users.ToListAsync());
    }

    [Theory]
    [InlineData("Google", "https://lh3.googleusercontent.com/avatar")]
    [InlineData("Discord", "https://cdn.discordapp.com/avatars/123/abc.png")]
    public async Task Verified_provider_imports_profile_and_stable_external_identity(string provider,string avatar) {
        await using var fixture = new Fixture();
        var user = await fixture.Accounts.ResolveAsync(Info(provider:provider,avatar:avatar));
        Assert.NotNull(user); Assert.True(user.EmailConfirmed); Assert.Equal("Aventureira",user.DisplayName); Assert.Equal(avatar,user.AvatarUrl);
        Assert.False(await fixture.Users.HasPasswordAsync(user));
        var again = await fixture.Accounts.ResolveAsync(Info(provider:provider,avatar:avatar,name:"Changed provider name"));
        Assert.Equal(user.Id,again?.Id); Assert.Single(await fixture.Db.Users.ToListAsync());
        Assert.Equal(user.Id,(await fixture.Users.FindByLoginAsync(provider,"external-key"))?.Id);
    }

    [Fact]
    public async Task External_email_collision_never_takes_over_a_local_account() {
        await using var fixture = new Fixture();
        var local = new AppUser { UserName="hero@example.test",Email="hero@example.test",EmailConfirmed=false,DisplayName="Original" };
        Assert.True((await fixture.Users.CreateAsync(local,"Existing-password!42")).Succeeded);
        Assert.Null(await fixture.Accounts.ResolveAsync(Info()));
        Assert.Empty(await fixture.Users.GetLoginsAsync(local));
        Assert.False((await fixture.Users.FindByIdAsync(local.Id))!.EmailConfirmed);
        Assert.True(await fixture.Users.CheckPasswordAsync(local,"Existing-password!42"));
    }

    [Fact]
    public async Task Same_email_from_second_provider_is_not_silently_linked() {
        await using var fixture = new Fixture();
        Assert.NotNull(await fixture.Accounts.ResolveAsync(Info()));
        Assert.Null(await fixture.Accounts.ResolveAsync(Info(provider:"Discord",key:"another-key")));
        Assert.Single(await fixture.Db.Users.ToListAsync());
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("http://cdn.discordapp.com/avatar.png")]
    [InlineData("https://cdn.discordapp.com.evil.example/avatar.png")]
    [InlineData("https://lh3.googleusercontent.com.evil.example/avatar.png")]
    [InlineData("https://example.test/private.png")]
    [InlineData("")]
    public void Unsafe_or_unapproved_avatar_uses_the_local_default(string avatar) => Assert.Equal("/assets/avatar.svg",ExternalAccounts.SafeAvatar(avatar));

    [Fact]
    public async Task Provider_names_are_bounded_and_untrusted_avatar_is_replaced() {
        await using var fixture = new Fixture();
        var user=await fixture.Accounts.ResolveAsync(Info(name:new string('x',300),avatar:"https://attacker.test/avatar.svg"));
        Assert.NotNull(user); Assert.Equal(80,user.DisplayName.Length); Assert.Equal("/assets/avatar.svg",user.AvatarUrl);
    }

    [Fact]
    public async Task Reset_token_can_only_be_used_once_and_changes_the_security_stamp() {
        await using var fixture = new Fixture();
        var user=new AppUser { UserName="reset@example.test",Email="reset@example.test" };
        Assert.True((await fixture.Users.CreateAsync(user,"Original-password!42")).Succeeded);
        var oldStamp=await fixture.Users.GetSecurityStampAsync(user);
        var token=await fixture.Users.GeneratePasswordResetTokenAsync(user);
        Assert.True((await fixture.Users.ResetPasswordAsync(user,token,"Replacement-password!52")).Succeeded);
        Assert.NotEqual(oldStamp,await fixture.Users.GetSecurityStampAsync(user));
        Assert.False((await fixture.Users.ResetPasswordAsync(user,token,"Another-password!62")).Succeeded);
        Assert.False(await fixture.Users.CheckPasswordAsync(user,"Original-password!42"));
        Assert.True(await fixture.Users.CheckPasswordAsync(user,"Replacement-password!52"));
    }
}
