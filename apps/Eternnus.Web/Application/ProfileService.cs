using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public sealed class ProfileService(GameDb db, IAvatarSafety safety)
{
    // Bound expensive scanning/decoding concurrency for this single-process monolith.
    static readonly SemaphoreSlim UploadSlot = new(2, 2);
    public static string ValidateName(string? name)
    {
        var value = name?.Trim();
        if (string.IsNullOrEmpty(value) || value.Length > 80 || value.Any(char.IsControl))
            throw new RuleException(400, "Informe um nome de 1 a 80 caracteres, sem caracteres de controle.");
        return value;
    }
    public async Task<AppUser> UpdateNameAsync(string userId, string? name, CancellationToken ct)
    {
        var value = ValidateName(name);
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct) ?? throw new RuleException(401, "Entre novamente.");
        user.DisplayName = value;
        user.ConcurrencyStamp = Guid.NewGuid().ToString();
        await db.SaveChangesAsync(ct);
        return user;
    }
    public async Task<AppUser> UploadAsync(string userId, byte[] data, string filename, string type, CancellationToken ct)
    {
        var format = AvatarProcessor.Validate(data, filename, type);
        if (!safety.Available) throw AvatarSafety.Unavailable();
        if (!await UploadSlot.WaitAsync(0, ct)) throw new RuleException(429, "Há outras imagens em verificação. Tente novamente em instantes.");
        try
        {
            await safety.ScanAsync(data, ct);
            var normalized = AvatarProcessor.Normalize(data, format, ct);
            await safety.ModerateAsync(normalized, ct);
            var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct) ?? throw new RuleException(401, "Entre novamente.");
            if (!user.EmailConfirmed) throw new RuleException(403, "Confirme seu e-mail antes de enviar um avatar.");
            var avatar = await db.Avatars.SingleOrDefaultAsync(a => a.UserId == userId, ct);
            if (avatar == null) { avatar = new AvatarImage { UserId = userId }; db.Avatars.Add(avatar); }
            avatar.Content = normalized;
            avatar.Version = Guid.NewGuid();
            user.AvatarUrl = "/api/auth/avatar/" + avatar.Version;
            user.ConcurrencyStamp = Guid.NewGuid().ToString();
            await db.SaveChangesAsync(ct);
            return user;
        }
        finally { UploadSlot.Release(); }
    }
}
