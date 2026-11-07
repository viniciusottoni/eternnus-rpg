using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
namespace Eternnus.Web;

/// <summary>Antes do TOTP só existe cookie temporário de desafio, que não autentica APIs de conta/jogo.</summary>
public static class AuthenticatorEndpoints
{
    static async Task<AppUser?> PendingAsync(SignInManager<AppUser> signIn)
    {
        var ticket = await signIn.Context.AuthenticateAsync(IdentityConstants.TwoFactorUserIdScheme);
        var user = await signIn.GetTwoFactorAuthenticationUserAsync();
        if (!ticket.Succeeded || user == null || await signIn.UserManager.IsLockedOutAsync(user)) return null;
        var stamp = await signIn.UserManager.GetSecurityStampAsync(user);
        return ticket.Principal?.FindFirstValue("challenge_stamp") == stamp ? user : null;
    }
    public static async Task<IResult> BeginAsync(AppUser user, SignInManager<AppUser> signIn, string? provider = null)
    {
        var users = signIn.UserManager;
        var setup = !await users.GetTwoFactorEnabledAsync(user);
        if (setup && string.IsNullOrEmpty(await users.GetAuthenticatorKeyAsync(user)))
        {
            var reset = await users.ResetAuthenticatorKeyAsync(user);
            if (!reset.Succeeded) throw new RuleException(409, "Não foi possível preparar o autenticador. Tente novamente.");
        }
        await signIn.Context.SignOutAsync(IdentityConstants.ApplicationScheme);
        var claims = new List<Claim> { new(ClaimTypes.Name, user.Id), new(ClaimTypes.AuthenticationMethod, provider ?? "pwd"), new("challenge_stamp", await users.GetSecurityStampAsync(user)) };
        await signIn.Context.SignInAsync(IdentityConstants.TwoFactorUserIdScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, IdentityConstants.TwoFactorUserIdScheme)),
            new AuthenticationProperties { IsPersistent = false, ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(5) });
        return Results.Ok(new { requiresTwoFactor = true, setupRequired = setup });
    }
    public static void MapAuthenticatorEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/auth/two-factor").RequireRateLimiting("auth");
        api.MapGet("/setup", async (SignInManager<AppUser> signIn) =>
        {
            var user = await PendingAsync(signIn);
            if (user == null) return Results.Unauthorized();
            if (await signIn.UserManager.GetTwoFactorEnabledAsync(user)) return Results.Ok(new { setupRequired = false });
            var key = await signIn.UserManager.GetAuthenticatorKeyAsync(user);
            if (string.IsNullOrEmpty(key)) return Results.Unauthorized();
            return Results.Ok(new { setupRequired = true, sharedKey = key, issuer = "Eternnus RPG", account = user.Email });
        });
        api.MapPost("/verify", async (AuthenticatorInput input, SignInManager<AppUser> signIn) =>
        {
            var user = await PendingAsync(signIn);
            var users = signIn.UserManager;
            if (user == null) return Results.Unauthorized();
            var setup = !await users.GetTwoFactorEnabledAsync(user);
            var valid = false;
            if (!setup && input.RecoveryCode is { Length: > 0 and <= 100 } recovery)
                valid = (await users.RedeemTwoFactorRecoveryCodeAsync(user, recovery.Trim())).Succeeded;
            else if (input.Code is { Length: > 0 and <= 20 } code)
                valid = await users.VerifyTwoFactorTokenAsync(user, users.Options.Tokens.AuthenticatorTokenProvider, code.Replace(" ", "").Replace("-", ""));
            if (!valid)
            {
                await users.AccessFailedAsync(user);
                return Results.Json(new { message = "Código inválido, expirado ou acesso temporariamente bloqueado." }, statusCode: 401);
            }
            string[]? recoveryCodes = null;
            if (setup)
            {
                if (!(await users.SetTwoFactorEnabledAsync(user, true)).Succeeded) throw new RuleException(409, "Não foi possível ativar o autenticador.");
                recoveryCodes = (await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10))?.ToArray();
            }
            await users.ResetAccessFailedCountAsync(user);
            await signIn.Context.SignOutAsync(IdentityConstants.TwoFactorUserIdScheme);
            await signIn.SignInWithClaimsAsync(user, false, [new Claim("amr", "mfa")]);
            return Results.Ok(new { recoveryCodes });
        });
    }
}
public record AuthenticatorInput(string? Code, string? RecoveryCode);
