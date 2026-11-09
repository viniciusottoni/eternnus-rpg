using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;

namespace Eternnus.Web;

/// <summary>Metadados protegidos pelo ticket do Identity; renovação nunca reinicia o prazo absoluto.</summary>
public static class LoginSession
{
    const string Started = "eternnus.login-started";
    public const string Remember = "eternnus.remember-login";
    public static readonly TimeSpan Window = TimeSpan.FromHours(8);
    public static bool Remembers(AuthenticationProperties? properties) =>
        properties?.Items.TryGetValue(Remember, out var value) == true && value == "true";

    public static AuthenticationProperties Properties(AppUser user, bool remember, DateTimeOffset now)
    {
        var persistent = remember && user.Role != PlatformRoles.Admin;
        var properties = new AuthenticationProperties
        {
            IsPersistent = persistent,
            AllowRefresh = !persistent && user.Role != PlatformRoles.Admin,
            IssuedUtc = now,
            ExpiresUtc = now.Add(persistent ? TimeSpan.FromDays(14) : Window)
        };
        properties.Items[Started] = now.ToString("O", CultureInfo.InvariantCulture);
        return properties;
    }

    public static Task SignInAsync(SignInManager<AppUser> signIn, AppUser user, bool remember = false,
        string? provider = null, bool mfa = false)
    {
        var now = signIn.Context.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow();
        var claims = new List<Claim>();
        if (provider != null) claims.Add(new Claim(ClaimTypes.AuthenticationMethod, provider));
        if (mfa) claims.Add(new Claim("amr", "mfa"));
        return signIn.SignInWithClaimsAsync(user, Properties(user, remember, now), claims);
    }

    public static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var now = (context.Options.TimeProvider ?? TimeProvider.System).GetUtcNow();
        // Tickets antigos não têm a origem imutável do prazo: exigir novo login uma vez no rollout.
        if (context.Properties.ExpiresUtc == null || context.Properties.ExpiresUtc <= now ||
            !context.Properties.Items.TryGetValue(Started, out var value) ||
            !DateTimeOffset.TryParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.None, out var started) || started > now)
        {
            await RejectAsync(context);
            return;
        }
        var absolute = started.Add(context.Properties.IsPersistent ? TimeSpan.FromDays(14) : TimeSpan.FromHours(24));
        if (now >= absolute) { await RejectAsync(context); return; }

        await SecurityStampValidator.ValidatePrincipalAsync(context);
        if (context.Principal == null) return;
        var user = await context.HttpContext.RequestServices.GetRequiredService<UserManager<AppUser>>().GetUserAsync(context.Principal);
        if (user == null) { await RejectAsync(context); return; }
        if (user.Role == PlatformRoles.Admin)
        {
            absolute = started.Add(Window);
            if (!user.TwoFactorEnabled || !context.Principal.HasClaim("amr", "mfa") || now >= absolute)
            { await RejectAsync(context); return; }
            context.Properties.IsPersistent = false;
        }
        var fixedDeadline = context.Properties.IsPersistent || user.Role == PlatformRoles.Admin;
        context.Properties.AllowRefresh = !fixedDeadline;
        // O stamp renova o principal em toda requisição. Ajustar também IssuedUtc impede que
        // CookieAuthenticationHandler estenda ExpiresUtc ao renovar o ticket reconstruído.
        context.Properties.IssuedUtc = now;
        context.Properties.ExpiresUtc = fixedDeadline || now.Add(Window) > absolute ? absolute : now.Add(Window);
    }

    static async Task RejectAsync(CookieValidatePrincipalContext context)
    {
        context.RejectPrincipal();
        context.ShouldRenew = false;
        await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
    }
}
