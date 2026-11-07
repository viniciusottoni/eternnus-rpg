using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Leitura do papel global sempre a partir do banco (nunca de claim ou do cliente).</summary>
public static class PlatformAccess
{
    public const string StaffPolicy = "Staff";
    public const string AdminPolicy = "Admin";
    public static string UserId(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.NameIdentifier)!;

    /// <summary>Papel atual do usuário verificado e não bloqueado; nulo se não puder agir.</summary>
    public static async Task<string?> RoleAsync(GameDb db, string userId, CancellationToken ct = default) =>
        await db.Users.AsNoTracking()
            .Where(u => u.Id == userId && u.EmailConfirmed && (u.LockoutEnd == null || u.LockoutEnd < DateTimeOffset.UtcNow))
            .Select(u => u.Role).SingleOrDefaultAsync(ct);

    public static async Task<bool> IsStaffAsync(GameDb db, string userId, CancellationToken ct = default) => PlatformRoles.IsStaff(await RoleAsync(db, userId, ct));
    public static async Task<bool> IsAdminAsync(GameDb db, string userId, CancellationToken ct = default) => await RoleAsync(db, userId, ct) == PlatformRoles.Admin;
}
