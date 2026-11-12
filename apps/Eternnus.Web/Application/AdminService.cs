using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record RoleInput(string Role, string Reason);
public record SuspendInput(DateTime? Until, string Reason);
public record ReasonInput(string? Reason);

/// <summary>Painel administrativo: métricas, usuários (papel, suspensão), todas as campanhas e trilha de auditoria.
/// Os endpoints exigem a política Admin; as regras de negócio (último admin, auto-rebaixamento, alvo admin) ficam aqui.</summary>
public class AdminService(GameDb db, AuditService audit, UserManager<AppUser> users)
{
    internal GameDb Db => db;
    internal AuditService Audit => audit;
    public const int PageSize = 20;
    public const string SystemActor = "system";
    /// <summary>Suspensão sem data de término (exibida como "por tempo indeterminado").</summary>
    public static readonly DateTimeOffset Indefinite = new(9999, 1, 1, 0, 0, 0, TimeSpan.Zero);
    static readonly string[] OpenTicketStatuses = [TicketStatuses.Open, TicketStatuses.InProgress, TicketStatuses.WaitingUser];

    static int Page(int page) => Math.Clamp(page, 1, 100000);
    static string? Term(string? value, int max = 100)
    {
        if (value?.Length > max) throw new RuleException(400, "Filtro muito longo.");
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
    }
    static string Reason(string? reason)
    {
        var value = (reason ?? "").Trim();
        if (value.Length is < 3 or > 300) throw new RuleException(400, "Informe o motivo (3 a 300 caracteres).");
        return value;
    }

    // ---------- Primeiro admin ----------

    /// <summary>Promove a admin os usuários com e-mail CONFIRMADO listados em <c>Platform:BootstrapAdmins</c>
    /// (lista de e-mails ou texto separado por vírgula/ponto e vírgula). Não altera quem já é admin. Auditado com ator "system".
    /// Deve ser chamado na inicialização, depois das migrações.</summary>
    public static async Task<int> EnsureBootstrapAdminsAsync(IServiceProvider services, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var provider = scope.ServiceProvider;
        var config = provider.GetRequiredService<IConfiguration>();
        var section = config.GetSection("Platform:BootstrapAdmins");
        var raw = section.GetChildren().Select(c => c.Value).Append(section.Value)
            .SelectMany(v => (v ?? "").Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        var normalizer = provider.GetService<ILookupNormalizer>();
        var emails = raw.Where(e => e.Length is > 0 and <= 256)
            .Select(e => normalizer?.NormalizeEmail(e) ?? e.ToUpperInvariant()).Distinct().ToList();
        if (emails.Count == 0) return 0;
        var db = provider.GetRequiredService<GameDb>();
        var audit = new AuditService(db);
        var promoted = await db.Users.Where(u => u.EmailConfirmed && u.NormalizedEmail != null && emails.Contains(u.NormalizedEmail) && u.Role != PlatformRoles.Admin).ToListAsync(ct);
        foreach (var user in promoted)
        {
            audit.Record(SystemActor, "user.role", "user", user.Id, $"Promovido a admin pela configuração Platform:BootstrapAdmins",
                new { before = new { role = user.Role }, after = new { role = PlatformRoles.Admin }, reason = "bootstrap" });
            user.Role = PlatformRoles.Admin;
        }
        if (promoted.Count > 0) await db.SaveChangesAsync(ct);
        provider.GetService<ILoggerFactory>()?.CreateLogger("Eternnus.Admin").LogInformation("Bootstrap de administradores: {Count} conta(s) promovida(s).", promoted.Count);
        return promoted.Count;
    }

    // ---------- Painel ----------

    public async Task<object> OverviewAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow; var week = now.AddDays(-7); var previous = now.AddDays(-14);
        var nowOffset = DateTimeOffset.UtcNow;
        // Consultas separadas e simples (CountAsync). O DbContext não aceita consultas paralelas.
        var users = new
        {
            total = await db.Users.CountAsync(ct),
            new7d = await db.Users.CountAsync(u => u.CreatedAt >= week, ct),
            newPrevious7d = await db.Users.CountAsync(u => u.CreatedAt >= previous && u.CreatedAt < week, ct),
            active7d = await db.Users.CountAsync(u => u.LastSeenAt >= week, ct),
            suspended = await db.Users.CountAsync(u => u.LockoutEnd != null && u.LockoutEnd > nowOffset, ct),
            pending = await db.Users.CountAsync(u => !u.EmailConfirmed, ct),
            staff = await db.Users.CountAsync(u => u.Role == PlatformRoles.Admin || u.Role == PlatformRoles.Ambassador, ct),
        };
        var campaigns = new
        {
            total = await db.Campaigns.CountAsync(ct),
            new7d = await db.Campaigns.CountAsync(c => c.CreatedAt >= week, ct),
            online = await db.Sessions.CountAsync(s => s.EndedAt == null && s.PausedAt == null, ct),
            sessions7d = await db.Sessions.CountAsync(s => s.StartedAt >= week, ct),
            sessionsPrevious7d = await db.Sessions.CountAsync(s => s.StartedAt >= previous && s.StartedAt < week, ct),
        };
        var community = new
        {
            openTickets = await db.Tickets.CountAsync(t => OpenTicketStatuses.Contains(t.Status), ct),
            pendingReports = await db.GuildReports.CountAsync(r => r.ResolvedAt == null, ct),
            libraryItems = await db.Library.CountAsync(l => l.DeletedAt == null, ct),
            publishedTemplates = await db.SheetTemplates.CountAsync(t => t.CurrentVersionId != null && t.ArchivedAt == null, ct),
            guildPosts7d = await db.GuildPosts.CountAsync(p => p.CreatedAt >= week && p.DeletedAt == null, ct),
            guildPostsPrevious7d = await db.GuildPosts.CountAsync(p => p.CreatedAt >= previous && p.CreatedAt < week && p.DeletedAt == null, ct),
        };
        var recentAudit = await AuditQuery(db.Audit.AsNoTracking()).Take(10).ToListAsync(ct);
        var recentUsers = await db.Users.AsNoTracking().OrderByDescending(u => u.CreatedAt).ThenBy(u => u.Id).Take(5)
            .Select(u => new { u.Id, name = u.DisplayName, u.AvatarUrl, u.Role, verified = u.EmailConfirmed, u.CreatedAt }).ToListAsync(ct);
        return new { generatedAt = now, users, campaigns, community, recentAudit, recentUsers };
    }

    // ---------- Usuários ----------

    public async Task<object> UsersAsync(string? q, string? role, string? status, int page, CancellationToken ct)
    {
        var term = Term(q); page = Page(page);
        if (role != null && role != "" && !PlatformRoles.IsValid(role)) throw new RuleException(400, "Papel inválido.");
        var now = DateTimeOffset.UtcNow;
        var query = db.Users.AsNoTracking();
        if (term != null) query = query.Where(TextSearch.AnyField<AppUser>(db, TextSearch.Pattern(term), u => u.DisplayName, u => u.Email!));
        if (!string.IsNullOrEmpty(role)) query = query.Where(u => u.Role == role);
        query = status switch
        {
            null or "" => query,
            "active" => query.Where(u => u.EmailConfirmed && (u.LockoutEnd == null || u.LockoutEnd <= now)),
            "suspended" => query.Where(u => u.LockoutEnd != null && u.LockoutEnd > now),
            "pending" => query.Where(u => !u.EmailConfirmed),
            _ => throw new RuleException(400, "Situação inválida."),
        };
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(u => u.CreatedAt).ThenBy(u => u.Id).Skip((page - 1) * PageSize).Take(PageSize)
            .Select(u => new
            {
                u.Id,
                name = u.DisplayName,
                u.Email,
                u.AvatarUrl,
                u.Role,
                u.Level,
                u.Xp,
                verified = u.EmailConfirmed,
                u.CreatedAt,
                u.LastSeenAt,
                suspendedUntil = u.LockoutEnd != null && u.LockoutEnd > now ? u.LockoutEnd : null,
            }).ToListAsync(ct);
        return new { items, total, page, pageSize = PageSize };
    }

    public async Task<object> UserAsync(string id, string actor, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var user = await db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => new
        {
            u.Id,
            name = u.DisplayName,
            u.Email,
            u.AvatarUrl,
            u.Role,
            u.Level,
            u.Xp,
            verified = u.EmailConfirmed,
            u.CreatedAt,
            u.LastSeenAt,
            lockoutEnd = u.LockoutEnd,
        }).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Usuário não encontrado.");
        var stats = new
        {
            campaignsAsMaster = await db.Campaigns.CountAsync(c => c.OwnerId == id, ct),
            campaignsAsMember = await db.Members.CountAsync(m => m.UserId == id, ct),
            characters = await db.Characters.CountAsync(c => c.OwnerId == id, ct),
        };
        var auditEntries = await AuditQuery(db.Audit.AsNoTracking().Where(a => a.TargetType == "user" && a.TargetId == id)).Take(20).ToListAsync(ct);
        return new
        {
            user.Id,
            user.name,
            user.Email,
            user.AvatarUrl,
            user.Role,
            user.Level,
            user.Xp,
            user.verified,
            user.CreatedAt,
            user.LastSeenAt,
            suspendedUntil = user.lockoutEnd > now ? user.lockoutEnd : null,
            isSelf = id == actor,
            stats,
            audit = auditEntries,
        };
    }

    /// <summary>Bloqueia (PostgreSQL) as linhas de todos os admins e do alvo: alterações concorrentes de papel são serializadas,
    /// e a contagem de admins restantes é feita sobre dados confirmados.</summary>
    async Task<AppUser> LockForRoleChangeAsync(string id, CancellationToken ct)
    {
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"AspNetUsers\" WHERE \"Role\" = {PlatformRoles.Admin} OR \"Id\" = {id} ORDER BY \"Id\" FOR UPDATE", ct);
        return await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct) ?? throw new RuleException(404, "Usuário não encontrado.");
    }

    public async Task SetRoleAsync(string id, RoleInput x, string actor, CancellationToken ct)
    {
        var role = x.Role?.Trim();
        if (!PlatformRoles.IsValid(role)) throw new RuleException(400, "Papel inválido. Use comum, embaixador ou admin.");
        var reason = Reason(x.Reason);
        if (id == actor && role != PlatformRoles.Admin) throw new RuleException(409, "Você não pode rebaixar a si mesmo. Peça a outro admin.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockForRoleChangeAsync(id, ct);
        if (user.Role == role) { await tx.CommitAsync(ct); return; }
        if (PlatformRoles.IsStaff(role) && !user.EmailConfirmed) throw new RuleException(409, "A conta precisa ter o e-mail confirmado para receber papel de equipe.");
        if (role == PlatformRoles.Admin && user.LockoutEnd > DateTimeOffset.UtcNow) throw new RuleException(409, "Reative a conta antes de torná-la admin.");
        if (user.Role == PlatformRoles.Admin && !await db.Users.AnyAsync(u => u.Id != id && u.Role == PlatformRoles.Admin && u.EmailConfirmed, ct))
            throw new RuleException(409, "A plataforma precisa de pelo menos um admin. Promova outra pessoa antes.");
        var before = user.Role;
        user.Role = role!;
        audit.Record(actor, "user.role", "user", id, $"Papel de {user.DisplayName}: {RoleLabel(before)} → {RoleLabel(role!)}. Motivo: {reason}",
            new { reason, before = new { role = before }, after = new { role } });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new RuleException(409, "A conta mudou em outra sessão. Atualize e tente novamente."); }
        await tx.CommitAsync(ct);
    }

    public async Task SuspendAsync(string id, SuspendInput x, string actor, CancellationToken ct)
    {
        var reason = Reason(x.Reason);
        if (id == actor) throw new RuleException(409, "Você não pode suspender a si mesmo.");
        DateTimeOffset until = Indefinite;
        if (x.Until is { } requested)
        {
            var value = new DateTimeOffset(DateTime.SpecifyKind(requested, requested.Kind == DateTimeKind.Unspecified ? DateTimeKind.Utc : requested.Kind)).ToUniversalTime();
            if (value <= DateTimeOffset.UtcNow.AddMinutes(1) || value > DateTimeOffset.UtcNow.AddYears(10)) throw new RuleException(400, "Escolha uma data futura (até 10 anos) para o fim da suspensão.");
            until = value;
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockForRoleChangeAsync(id, ct);
        if (user.Role == PlatformRoles.Admin) throw new RuleException(409, "Não é possível suspender um admin. Rebaixe o papel primeiro.");
        var before = user.LockoutEnd > DateTimeOffset.UtcNow ? user.LockoutEnd : null;
        audit.Record(actor, "user.suspend", "user", id, $"Suspendeu {user.DisplayName} {(until == Indefinite ? "por tempo indeterminado" : "até " + until.ToString("yyyy-MM-dd HH:mm") + " UTC")}. Motivo: {reason}",
            new { reason, before = new { suspendedUntil = before }, after = new { suspendedUntil = until == Indefinite ? (DateTimeOffset?)null : until, indefinite = until == Indefinite } });
        // Identity grava cada passo no mesmo GameDb (e nesta transação); o novo security stamp derruba as sessões abertas.
        Ensure(await users.SetLockoutEnabledAsync(user, true));
        Ensure(await users.SetLockoutEndDateAsync(user, until));
        Ensure(await users.UpdateSecurityStampAsync(user));
        await tx.CommitAsync(ct);
    }

    public async Task UnsuspendAsync(string id, string? reasonText, string actor, CancellationToken ct)
    {
        var reason = string.IsNullOrWhiteSpace(reasonText) ? "" : Reason(reasonText);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await LockForRoleChangeAsync(id, ct);
        if (!(user.LockoutEnd > DateTimeOffset.UtcNow)) throw new RuleException(409, "Esta conta não está suspensa.");
        audit.Record(actor, "user.unsuspend", "user", id, $"Reativou {user.DisplayName}{(reason == "" ? "" : ". Motivo: " + reason)}",
            new { reason, before = new { suspendedUntil = user.LockoutEnd }, after = new { suspendedUntil = (DateTimeOffset?)null } });
        Ensure(await users.SetLockoutEndDateAsync(user, null));
        Ensure(await users.ResetAccessFailedCountAsync(user));
        await tx.CommitAsync(ct);
    }

    static void Ensure(IdentityResult result)
    {
        if (!result.Succeeded) throw new RuleException(409, "A conta mudou em outra sessão. Atualize e tente novamente.");
    }
    public static string RoleLabel(string role) => role switch { PlatformRoles.Admin => "admin", PlatformRoles.Ambassador => "embaixador", _ => "comum" };

    // ---------- Campanhas ----------

    public async Task<object> CampaignsAsync(string? q, Guid? systemId, bool? online, int page, CancellationToken ct)
    {
        var term = Term(q); page = Page(page);
        var query = db.Campaigns.AsNoTracking();
        // Busca geral: nome da campanha ou do mestre (colunas da tabela).
        if (term != null)
        {
            var pattern = TextSearch.Pattern(term);
            var owners = db.Users.Where(TextSearch.AnyField<AppUser>(db, pattern, u => u.DisplayName)).Select(u => u.Id);
            query = query.Where(TextSearch.Or(TextSearch.AnyField<Campaign>(db, pattern, c => c.Name), c => owners.Contains(c.OwnerId)));
        }
        if (systemId is { } system) query = query.Where(c => c.RpgSystemId == system);
        if (online is { } live) query = query.Where(c => db.Sessions.Any(s => s.CampaignId == c.Id && s.EndedAt == null && s.PausedAt == null) == live);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(c => c.LastActivityAt).ThenBy(c => c.Id).Skip((page - 1) * PageSize).Take(PageSize)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.System,
                c.RpgSystemId,
                masterId = c.OwnerId,
                masterName = db.Users.Where(u => u.Id == c.OwnerId).Select(u => u.DisplayName).FirstOrDefault(),
                memberCount = db.Members.Count(m => m.CampaignId == c.Id),
                online = db.Sessions.Any(s => s.CampaignId == c.Id && s.EndedAt == null && s.PausedAt == null),
                c.CreatedAt,
                c.LastActivityAt,
            }).ToListAsync(ct);
        return new { items, total, page, pageSize = PageSize };
    }

    public async Task<object> CampaignAsync(Guid id, CancellationToken ct)
    {
        var campaign = await db.Campaigns.AsNoTracking().Where(c => c.Id == id).Select(c => new
        {
            c.Id,
            c.Name,
            c.Description,
            c.System,
            c.RpgSystemId,
            c.CreatedAt,
            c.LastActivityAt,
            master = db.Users.Where(u => u.Id == c.OwnerId).Select(u => new { u.Id, name = u.DisplayName, u.AvatarUrl }).FirstOrDefault(),
        }).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Campanha não encontrada.");
        var members = await db.Members.AsNoTracking().Where(m => m.CampaignId == id)
            .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { u.Id, name = u.DisplayName, u.AvatarUrl })
            .OrderBy(u => u.name).ThenBy(u => u.Id).Take(200).ToListAsync(ct);
        var sessions = await db.Sessions.AsNoTracking().Where(s => s.CampaignId == id).OrderByDescending(s => s.Number).Take(10)
            .Select(s => new { s.Id, s.Number, s.Title, s.StartedAt, s.EndedAt, paused = s.PausedAt != null }).ToListAsync(ct);
        var sessionCount = await db.Sessions.CountAsync(s => s.CampaignId == id, ct);
        var characterCount = await db.CampaignCharacters.CountAsync(x => x.CampaignId == id, ct);
        return new
        {
            campaign.Id,
            campaign.Name,
            campaign.Description,
            campaign.System,
            campaign.RpgSystemId,
            campaign.CreatedAt,
            campaign.LastActivityAt,
            campaign.master,
            members,
            online = sessions.Any(s => s.EndedAt == null && !s.paused),
            sessionCount,
            characterCount,
            sessions,
        };
    }

    // ---------- Auditoria ----------

    IQueryable<AuditView> AuditQuery(IQueryable<AuditEntry> source) =>
        source.OrderByDescending(a => a.Id).Select(a => new AuditView(
            a.Id, a.ActorId,
            a.ActorId == SystemActor ? "Sistema" : db.Users.Where(u => u.Id == a.ActorId).Select(u => u.DisplayName).FirstOrDefault(),
            a.Action, a.TargetType, a.TargetId, a.Summary, a.Data, a.CreatedAt));

    public async Task<object> AuditAsync(string? action, string? actor, string? targetType, string? targetId, DateTime? from, DateTime? to, int page, CancellationToken ct)
    {
        page = Page(page);
        if (action?.Length > 60 || actor?.Length > 450 || targetType?.Length > 40 || targetId?.Length > 80) throw new RuleException(400, "Filtro muito longo.");
        var query = db.Audit.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(action)) { var a = action.Trim(); query = query.Where(x => x.Action.StartsWith(a)); }
        if (!string.IsNullOrWhiteSpace(actor))
        {
            var exact = actor.Trim();
            var actors = db.Users.Where(TextSearch.AnyField<AppUser>(db, TextSearch.Pattern(exact), u => u.DisplayName)).Select(u => u.Id);
            query = query.Where(x => x.ActorId == exact || actors.Contains(x.ActorId));
        }
        if (!string.IsNullOrWhiteSpace(targetType)) { var t = targetType.Trim(); query = query.Where(x => x.TargetType == t); }
        if (!string.IsNullOrWhiteSpace(targetId)) { var t = targetId.Trim(); query = query.Where(x => x.TargetId == t); }
        if (from is { } start) { var s = DateTime.SpecifyKind(start, DateTimeKind.Utc); query = query.Where(x => x.CreatedAt >= s); }
        if (to is { } end)
        {
            // Data sem horário inclui o dia inteiro.
            var e = DateTime.SpecifyKind(end.TimeOfDay == TimeSpan.Zero ? end.AddDays(1) : end, DateTimeKind.Utc);
            query = query.Where(x => x.CreatedAt < e);
        }
        var total = await query.CountAsync(ct);
        var items = await AuditQuery(query).Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(ct);
        return new { items, total, page, pageSize = PageSize };
    }
}

public record AuditView(long Id, string ActorId, string? ActorName, string Action, string TargetType, string TargetId, string Summary, string Data, DateTime CreatedAt);
