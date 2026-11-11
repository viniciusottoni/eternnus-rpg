using Microsoft.AspNetCore.Identity;
namespace Eternnus.Web;

/// <summary>
/// Regra de senha local: 8 a 128 caracteres e ao menos dois tipos distintos entre
/// minúscula, maiúscula, número e símbolo. O hash e os tokens continuam com ASP.NET Identity.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 8, MaxLength = 128, MinCategories = 2;
    public const string Requirement = "Use de 8 a 128 caracteres, com ao menos dois tipos: maiúscula, minúscula, número ou símbolo.";

    /// <summary>Quantos tipos de caractere (minúscula, maiúscula, número, símbolo) aparecem na senha.</summary>
    public static int Categories(string password)
    {
        bool lower = false, upper = false, digit = false, symbol = false;
        foreach (var c in password)
        {
            if (char.IsLower(c)) lower = true;
            else if (char.IsUpper(c)) upper = true;
            else if (char.IsDigit(c)) digit = true;
            else if (!char.IsLetterOrDigit(c)) symbol = true;
        }
        return (lower ? 1 : 0) + (upper ? 1 : 0) + (digit ? 1 : 0) + (symbol ? 1 : 0);
    }

    public static bool IsValid([System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? password) =>
        password?.Length is >= MinLength and <= MaxLength && Categories(password) >= MinCategories;
}

/// <summary>Validador de Identity que aplica <see cref="PasswordPolicy"/> em cadastro, redefinição e troca de senha.</summary>
public sealed class PasswordPolicyValidator : IPasswordValidator<AppUser>
{
    public Task<IdentityResult> ValidateAsync(UserManager<AppUser> manager, AppUser user, string? password) =>
        Task.FromResult(PasswordPolicy.IsValid(password)
            ? IdentityResult.Success
            : IdentityResult.Failed(new IdentityError { Code = "PasswordPolicy", Description = PasswordPolicy.Requirement }));
}
