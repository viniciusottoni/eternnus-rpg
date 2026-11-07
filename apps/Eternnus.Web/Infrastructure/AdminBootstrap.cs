using Microsoft.AspNetCore.Identity;
namespace Eternnus.Web;

public static class AdminBootstrap
{
    public const string PasswordKey = "Platform:InitialAdmin:Password";
    public static async Task EnsureAsync(IServiceProvider services, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var provider = scope.ServiceProvider;
        var config = provider.GetRequiredService<IConfiguration>();
        var password = config[PasswordKey];
        if (string.IsNullOrEmpty(password)) return;
        var email = config["Platform:InitialAdmin:Email"] ?? "admin@eternnus.com";
        var users = provider.GetRequiredService<UserManager<AppUser>>();
        // Nunca redefinir senha nem promover uma conta anterior pelo simples conhecimento do e-mail.
        if (await users.FindByEmailAsync(email) != null) return;
        ct.ThrowIfCancellationRequested();
        var user = new AppUser { UserName = email, Email = email, EmailConfirmed = true, DisplayName = "Administrador", Role = PlatformRoles.Admin };
        var result = await users.CreateAsync(user, password);
        if (!result.Succeeded) throw new InvalidOperationException("Não foi possível criar o administrador inicial. Confira a configuração privada e os requisitos de senha.");
        var audit = provider.GetRequiredService<AuditService>();
        audit.Record(AdminService.SystemActor, "admin.bootstrap", "user", user.Id, "Administrador inicial criado; autenticador obrigatório no primeiro acesso.");
        await provider.GetRequiredService<GameDb>().SaveChangesAsync(ct);
    }
}
