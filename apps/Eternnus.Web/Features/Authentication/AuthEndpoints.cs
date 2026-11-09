using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public static class AuthEndpoints
{
    static IResult Bad(string message) => Results.BadRequest(new { message });
    static bool Email(string? value) => value?.Length is > 0 and <= 200 && new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(value);
    static string? Decode(string? code) { try { return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(code ?? "")); } catch (FormatException) { return null; } }
    public static object Profile(AppUser u) => new { u.Id, u.Email, name = u.DisplayName, u.AvatarUrl, verified = u.EmailConfirmed, role = u.Role, staff = PlatformRoles.IsStaff(u.Role), level = u.Level, xp = u.Xp, twoFactorEnabled = u.TwoFactorEnabled, oneShotParticipations = u.OneShotParticipations, interfaceMode = u.InterfaceMode };
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/auth");
        app.MapAuthenticatorEndpoints();
        api.MapGet("/csrf", (IAntiforgery csrf, HttpContext context) => Results.Ok(new { token = csrf.GetAndStoreTokens(context).RequestToken }));
        api.MapGet("/providers", (IConfiguration config) => Results.Ok(new { google = !string.IsNullOrWhiteSpace(config["Authentication:Google:ClientId"]), discord = !string.IsNullOrWhiteSpace(config["Authentication:Discord:ClientId"]) }));
        api.MapGet("/me", async (ClaimsPrincipal principal, UserManager<AppUser> users, GameDb db, CancellationToken ct) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user == null) return Results.Unauthorized();
            return Results.Ok(Profile(user));
        });
        api.MapPost("/activity", async (ClaimsPrincipal principal, GameDb db, CancellationToken ct) =>
        {
            var now = DateTime.UtcNow;
            var cutoff = now.AddMinutes(-5);
            var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            await db.Users.Where(u => u.Id == id && (u.LastSeenAt == null || u.LastSeenAt < cutoff))
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.LastSeenAt, now), ct);
            return Results.NoContent();
        }).RequireAuthorization();
        // Preferência visual do mestre (Básica/Completa). Não muda regras, visibilidade nem a mesa dos jogadores.
        api.MapPut("/preferences", async (PreferencesInput x, ClaimsPrincipal principal, GameDb db, CancellationToken ct) =>
        {
            if (!InterfaceModes.IsValid(x.InterfaceMode)) return Bad("Escolha a interface Básica ou Completa.");
            var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            await db.Users.Where(u => u.Id == id).ExecuteUpdateAsync(u => u.SetProperty(p => p.InterfaceMode, x.InterfaceMode), ct);
            return Results.NoContent();
        }).RequireAuthorization();
        api.MapGet("/limits", async (ClaimsPrincipal principal, UserManager<AppUser> users, GameDb db, CancellationToken ct) =>
        {
            var user = await users.GetUserAsync(principal);
            return user == null ? Results.Unauthorized() : Results.Ok(await AccountLimits.SummaryAsync(db, user, ct));
        }).RequireAuthorization();
        api.MapPost("/register", async (RegisterInput x, UserManager<AppUser> users, SignInManager<AppUser> signIn, AccountMail mail, GameDb db) =>
        {
            if (!Email(x.Email) || string.IsNullOrWhiteSpace(x.Name) || x.Name.Trim().Length > 80 || x.Password?.Length is not (>= 10 and <= 128) || x.Password != x.ConfirmPassword)
                return Bad("Confira nome, e-mail e senhas. As senhas devem ser iguais e ter entre 10 e 128 caracteres.");
            var user = new AppUser { UserName = x.Email.Trim(), Email = x.Email.Trim(), DisplayName = x.Name.Trim(), LastEmailAt = DateTime.UtcNow };
            await using var tx = await db.Database.BeginTransactionAsync();
            var result = await users.CreateAsync(user, x.Password);
            if (!result.Succeeded) return Bad("Não foi possível cadastrar. Use um e-mail disponível e senha com maiúscula, minúscula, número e símbolo.");
            await mail.QueueAsync(user, false); await tx.CommitAsync(); await LoginSession.SignInAsync(signIn, user); return Results.Ok(Profile(user));
        }).RequireRateLimiting("auth");
        api.MapPost("/login", async (Credentials x, SignInManager<AppUser> signIn) =>
        {
            if (!Email(x.Email) || x.Password?.Length is not (> 0 and <= 128)) return Bad("Informe e-mail e senha válidos.");
            var user = await signIn.UserManager.FindByEmailAsync(x.Email.Trim());
            var result = user == null ? SignInResult.Failed : await signIn.CheckPasswordSignInAsync(user, x.Password, true);
            if (!result.Succeeded) return Results.Json(new { message = "E-mail ou senha inválidos, ou acesso temporariamente bloqueado." }, statusCode: 401);
            if (user!.Role == PlatformRoles.Admin || await signIn.UserManager.GetTwoFactorEnabledAsync(user))
                return await AuthenticatorEndpoints.BeginAsync(user, signIn, remember: x.RememberMe);
            await LoginSession.SignInAsync(signIn, user, x.RememberMe);
            return Results.Ok();
        }).RequireRateLimiting("auth");
        api.MapPost("/logout", async (SignInManager<AppUser> signIn) => { await signIn.SignOutAsync(); return Results.NoContent(); }).RequireAuthorization();
        api.MapPost("/logout-all", async (SignInManager<AppUser> signIn) =>
        {
            var user = await signIn.UserManager.GetUserAsync(signIn.Context.User);
            if (user == null) return Results.Unauthorized();
            if (!(await signIn.UserManager.UpdateSecurityStampAsync(user)).Succeeded)
                return Results.Json(new { message = "Não foi possível encerrar os acessos. Tente novamente." }, statusCode: 409);
            await signIn.SignOutAsync();
            return Results.NoContent();
        }).RequireAuthorization();
        api.MapPost("/resend", async (ClaimsPrincipal principal, UserManager<AppUser> users, AccountMail mail) =>
        {
            var user = (await users.GetUserAsync(principal))!;
            if (!user.EmailConfirmed && await mail.TryReserveAsync(user)) await mail.QueueAsync(user, false);
            return Results.Ok(new { message = "Se necessário, um novo link será enviado. Aguarde um minuto entre solicitações." });
        }).RequireAuthorization().RequireRateLimiting("mail");
        api.MapPost("/confirm", async (TokenInput x, UserManager<AppUser> users, SignInManager<AppUser> signIn, HttpContext context) =>
        {
            var user = await users.FindByIdAsync(x.UserId ?? ""); var token = Decode(x.Code);
            if (user == null || token == null || user.EmailConfirmed || !(await users.ConfirmEmailAsync(user, token)).Succeeded) return Bad("Link inválido, expirado ou já utilizado. Solicite um novo link.");
            if (context.User.FindFirstValue(ClaimTypes.NameIdentifier) == user.Id) await signIn.RefreshSignInAsync(user);
            return Results.Ok(new { message = "E-mail confirmado. Sua aventura está liberada." });
        }).RequireRateLimiting("auth");
        api.MapPost("/forgot-password", async (EmailInput x, UserManager<AppUser> users, AccountMail mail) =>
        {
            var user = Email(x.Email) ? await users.FindByEmailAsync(x.Email.Trim()) : null;
            if (user != null && await users.HasPasswordAsync(user) && await mail.TryReserveAsync(user)) await mail.QueueAsync(user, true);
            return Results.Ok(new { message = "Se houver uma conta elegível, enviaremos um link para redefinir a senha." });
        }).RequireRateLimiting("mail");
        api.MapPost("/reset-password", async (ResetInput x, UserManager<AppUser> users) =>
        {
            if (x.Password?.Length is not (>= 10 and <= 128) || x.Password != x.ConfirmPassword) return Bad("Confira a nova senha e sua confirmação.");
            var user = await users.FindByIdAsync(x.UserId ?? ""); var token = Decode(x.Code);
            if (user == null || token == null || !(await users.ResetPasswordAsync(user, token, x.Password)).Succeeded) return Bad("Link inválido, expirado ou já utilizado, ou senha fora dos requisitos.");
            return Results.Ok(new { message = "Senha alterada. Entre novamente com a nova senha." });
        }).RequireRateLimiting("auth");
        api.MapGet("/external/{provider}", (string provider, bool? rememberMe, IConfiguration config, SignInManager<AppUser> signIn) =>
        {
            var scheme = provider switch { "google" => "Google", "discord" => "Discord", _ => "" };
            if (scheme == "" || string.IsNullOrWhiteSpace(config[$"Authentication:{scheme}:ClientId"])) return Results.Redirect("/?authError=provider#login");
            var properties = signIn.ConfigureExternalAuthenticationProperties(scheme, "/api/auth/external-callback");
            properties.Items[LoginSession.Remember] = rememberMe == true ? "true" : "false";
            return Results.Challenge(properties, [scheme]);
        }).RequireRateLimiting("auth");
        api.MapGet("/external-callback", async (SignInManager<AppUser> signIn, ExternalAccounts accounts) =>
        {
            var info = await signIn.GetExternalLoginInfoAsync();
            if (info == null) return Results.Redirect("/?authError=external#login");
            var external = await signIn.Context.AuthenticateAsync(IdentityConstants.ExternalScheme);
            var remember = LoginSession.Remembers(external.Properties);
            var user = await accounts.ResolveAsync(info);
            await signIn.Context.SignOutAsync(IdentityConstants.ExternalScheme);
            if (user == null) return Results.Redirect("/?authError=verified#login");
            if (await signIn.UserManager.IsLockedOutAsync(user)) return Results.Redirect("/?authError=external#login");
            if (user.Role == PlatformRoles.Admin || await signIn.UserManager.GetTwoFactorEnabledAsync(user))
            {
                await AuthenticatorEndpoints.BeginAsync(user, signIn, info.LoginProvider, remember);
                return Results.Redirect("/?twoFactor=1#login");
            }
            await LoginSession.SignInAsync(signIn, user, remember, info.LoginProvider); return Results.Redirect("/#overview");
        }).RequireRateLimiting("auth");
    }
}
public record RegisterInput(string Name, string Email, string Password, string ConfirmPassword);
public record EmailInput(string Email);
public record TokenInput(string UserId, string Code);
public record ResetInput(string UserId, string Code, string Password, string ConfirmPassword);
