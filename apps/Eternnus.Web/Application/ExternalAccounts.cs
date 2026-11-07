using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
namespace Eternnus.Web;

public class ExternalAccounts(UserManager<AppUser> users)
{
    public async Task<AppUser?> ResolveAsync(ExternalLoginInfo info)
    {
        if (info.LoginProvider is not ("Google" or "Discord")) return null;
        var email = info.Principal.FindFirstValue(ClaimTypes.Email);
        if (info.Principal.FindFirstValue("email_verified") != "true" || email == null || email.Length > 200) return null;
        var existing = await users.FindByLoginAsync(info.LoginProvider, info.ProviderKey);
        if (existing != null) return existing;
        // Never merge by email: an existing local account must not be taken over via SSO.
        if (await users.FindByEmailAsync(email) != null) return null;
        var name = info.Principal.FindFirstValue(ClaimTypes.Name) ?? "Aventureiro";
        var avatar = info.Principal.FindFirstValue("avatar");
        var user = new AppUser { UserName = email, Email = email, EmailConfirmed = true, DisplayName = name[..Math.Min(80, name.Length)], AvatarUrl = SafeAvatar(avatar) };
        if (!(await users.CreateAsync(user)).Succeeded) return null;
        if (!(await users.AddLoginAsync(user, info)).Succeeded) { await users.DeleteAsync(user); return null; }
        return user;
    }
    public static string SafeAvatar(string? value)
    {
        if (value?.Length <= 600 && Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https" &&
            (uri.Host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase) || uri.Host == "cdn.discordapp.com")) return value;
        return "/assets/avatar.svg";
    }
}
