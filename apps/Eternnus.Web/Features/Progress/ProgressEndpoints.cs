using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record XpBonusInput(int Amount, string? Reason);

/// <summary>Rotas /api/progress/** (Verified). Ajustes manuais em /api/progress/admin/** (Admin, auditados).</summary>
public static class ProgressEndpoints
{
    public const int HistorySize = 20, LeaderboardSize = 20;

    public static void MapProgressEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/progress").RequireAuthorization("Verified");
        static string Me(ClaimsPrincipal u) => PlatformAccess.UserId(u);

        api.MapGet("/me", (GameDb db, TimeProvider clock, ClaimsPrincipal u, CancellationToken ct) => MeAsync(db, clock, Me(u), ct));
        api.MapGet("/users/{id}", async (string id, GameDb db, CancellationToken ct) =>
            await PublicProfileAsync(db, id, ct) is { } profile ? Results.Ok(profile) : Results.NotFound(new { message = "Aventureiro não encontrado." }));
        api.MapGet("/leaderboard", (string? period, GameDb db, TimeProvider clock, ClaimsPrincipal u, CancellationToken ct) => LeaderboardAsync(db, clock, period, Me(u), ct));

        var admin = api.MapGroup("/admin").RequireAuthorization(PlatformAccess.AdminPolicy);
        admin.MapPost("/{userId}/bonus", async (string userId, XpBonusInput x, GameDb db, ProgressionService progression, AuditService audit, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var reason = (x.Reason ?? "").Trim();
            if (reason.Length is < 5 or > 200 || reason.Any(char.IsControl)) throw new RuleException(400, "Explique o motivo do ajuste em 5 a 200 caracteres.");
            if (!ValidUserId(userId)) throw new RuleException(404, "Usuário não encontrado.");
            var entry = await progression.PrepareBonusAsync(userId, x.Amount, ct);
            var user = db.Users.Local.Single(v => v.Id == userId);
            audit.Record(Me(u), "progress.bonus", "user", userId, $"Ajuste de {entry.Amount:+#;-#} XP: {reason}",
                new { requested = x.Amount, applied = entry.Amount, reason, xp = user.Xp, level = user.Level, sourceKey = entry.SourceKey });
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { applied = entry.Amount, user.Xp, user.Level });
        });
        admin.MapPost("/{userId}/recalculate", async (string userId, GameDb db, ProgressionService progression, AuditService audit, ClaimsPrincipal u, CancellationToken ct) =>
        {
            if (!ValidUserId(userId)) throw new RuleException(404, "Usuário não encontrado.");
            var result = await progression.PrepareRecalculationAsync(userId, ct);
            audit.Record(Me(u), "progress.recalculate", "user", userId, $"XP recalculado: {result.Before} → {result.After}",
                new { before = result.Before, after = result.After, level = result.Level });
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { before = result.Before, xp = result.After, level = result.Level });
        });
    }

    static bool ValidUserId(string id) => id.Length is > 0 and <= 450;

    static async Task<object> MeAsync(GameDb db, TimeProvider clock, string userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(x => x.Id == userId).Select(x => new { x.Xp }).SingleAsync(ct);
        var progress = Progression.Progress(user.Xp);
        var unlocked = await db.Achievements.AsNoTracking().Where(a => a.UserId == userId).Select(a => new { a.Key, a.UnlockedAt }).ToListAsync(ct);
        var unlockedAt = unlocked.ToDictionary(a => a.Key, a => a.UnlockedAt);
        var history = await db.XpEntries.AsNoTracking().Where(e => e.UserId == userId)
            .OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id).Take(HistorySize)
            .Select(e => new { e.Reason, e.Amount, e.CreatedAt }).ToListAsync(ct);
        var dayStart = Progression.DayStart(clock.GetUtcNow().UtcDateTime);
        var today = await db.XpEntries.AsNoTracking().Where(e => e.UserId == userId && e.CreatedAt >= dayStart)
            .GroupBy(e => e.Reason).Select(g => new { Reason = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Reason, g => g.Count, ct);
        return new
        {
            xp = progress.Xp,
            level = progress.Level,
            maxLevel = Progression.MaxLevel,
            levelXp = progress.LevelXp,
            nextLevelXp = progress.NextLevelXp,
            percent = progress.Percent,
            achievements = Progression.Achievements
                .Select(a => new { a.Key, a.Title, a.Description, a.Icon, unlocked = unlockedAt.ContainsKey(a.Key), unlockedAt = unlockedAt.TryGetValue(a.Key, out var at) ? at : (DateTime?)null }),
            history = history.Select(e => new { e.Reason, label = Progression.Label(e.Reason), e.Amount, e.CreatedAt }),
            unlocks = await UnlocksAsync(db, progress.Level, ct),
            rules = Progression.Rules.Select(r => new { r.Reason, r.Label, r.Hint, r.Amount, r.DailyLimit, today = today.GetValueOrDefault(r.Reason) }),
        };
    }

    /// <summary>Desbloqueios por nível: recursos fixos + categorias da Guilda com nível mínimo (lidas do banco), em ordem de nível.</summary>
    static async Task<object> UnlocksAsync(GameDb db, int level, CancellationToken ct)
    {
        var categories = await db.GuildCategories.AsNoTracking()
            .Where(c => c.ArchivedAt == null && !c.StaffOnly && c.MinLevelToPost > 1)
            .OrderBy(c => c.MinLevelToPost).ThenBy(c => c.Order).ThenBy(c => c.Id)
            .Select(c => new { c.Slug, c.Name, c.MinLevelToPost }).ToListAsync(ct);
        return Progression.FeatureUnlocks
            .Select(f => new { level = f.Level, key = f.Key, title = f.Title, description = f.Description, kind = "feature" })
            .Concat(categories.Select(c => new
            {
                level = c.MinLevelToPost, key = "guild_category:" + c.Slug, title = $"Tópicos em “{c.Name}”",
                description = "Abra tópicos nesta categoria da Guilda (responder nunca exige nível).", kind = "guild_category",
            }))
            .OrderBy(x => x.level).ThenBy(x => x.key, StringComparer.Ordinal)
            .Select(x => new { x.level, x.key, x.title, x.description, x.kind, unlocked = x.level <= level })
            .ToList();
    }

    /// <summary>Contrato público (cartão do autor na Guilda): nunca inclui e-mail. Contas não verificadas não aparecem.</summary>
    public static async Task<object?> PublicProfileAsync(GameDb db, string id, CancellationToken ct)
    {
        if (!ValidUserId(id)) return null;
        var user = await db.Users.AsNoTracking().Where(x => x.Id == id && x.EmailConfirmed)
            .Select(x => new { x.Id, name = x.DisplayName, x.AvatarUrl, x.Level, x.Xp, role = x.Role }).SingleOrDefaultAsync(ct);
        if (user is null) return null;
        var keys = await db.Achievements.AsNoTracking().Where(a => a.UserId == id)
            .OrderByDescending(a => a.UnlockedAt).ThenBy(a => a.Key).Select(a => a.Key).ToListAsync(ct);
        var achievements = keys.Select(Progression.Achievement).OfType<AchievementDefinition>().Select(a => new { a.Key, a.Title, a.Icon });
        return new { user.Id, user.name, user.AvatarUrl, level = Progression.LevelForXp(user.Xp), user.Xp, user.role, achievements };
    }

    static async Task<object> LeaderboardAsync(GameDb db, TimeProvider clock, string? period, string me, CancellationToken ct)
    {
        period = period == "week" ? "week" : "all";
        var verified = db.Users.AsNoTracking().Where(x => x.EmailConfirmed);
        List<LeaderRow> rows;
        if (period == "all")
        {
            rows = await verified.Where(x => x.Xp > 0).OrderByDescending(x => x.Xp).ThenBy(x => x.Id).Take(LeaderboardSize)
                .Select(x => new LeaderRow(x.Id, x.DisplayName, x.AvatarUrl, x.Level, x.Xp)).ToListAsync(ct);
        }
        else
        {
            var since = clock.GetUtcNow().UtcDateTime.AddDays(-7);
            rows = await db.XpEntries.AsNoTracking().Where(e => e.CreatedAt >= since)
                .GroupBy(e => e.UserId).Select(g => new { UserId = g.Key, Xp = g.Sum(e => e.Amount) })
                .Where(g => g.Xp > 0)
                .Join(verified, g => g.UserId, x => x.Id, (g, x) => new { g.Xp, x.Id, x.DisplayName, x.AvatarUrl, x.Level })
                .OrderByDescending(x => x.Xp).ThenBy(x => x.Id).Take(LeaderboardSize)
                .Select(x => new LeaderRow(x.Id, x.DisplayName, x.AvatarUrl, x.Level, x.Xp)).ToListAsync(ct);
        }
        return new
        {
            period,
            items = rows.Select((r, i) => new { rank = i + 1, r.Id, name = r.Name, r.AvatarUrl, r.Level, r.Xp, isMe = r.Id == me }),
        };
    }

    sealed record LeaderRow(string Id, string Name, string AvatarUrl, int Level, int Xp);
}
