using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Npgsql;
namespace Eternnus.Web;

public record TicketCreateInput(string? Subject, string? Category, string? Body);
public record TicketReplyInput(string? Body);
public record StaffTicketMessageInput(string? Body, bool Internal);
public record TicketUpdateInput(string? Status, string? Priority, string? AssignedToId, int Revision);
public record TicketQueueQuery(string? Status, string? Priority, string? Category, string? Assigned, string? Q, int Page);

/// <summary>Regras puras de suporte (espelhadas para UX em <c>wwwroot/js/support-policy.js</c>).</summary>
public static class SupportRules
{
    public const int PageSize = 15, MaxOpenPerUser = 5, ReopenDays = 30, MaxMessages = 300, NumberAttempts = 5;
    /// <summary>Filtro de lista que reúne os estados ainda não concluídos.</summary>
    public const string ActiveFilter = "active";

    public static bool IsDone(string status) => status is TicketStatuses.Resolved or TicketStatuses.Closed;

    /// <summary>Resposta do autor: "aguardando você" e "resolvido" voltam para "aberto". Fechado não aceita resposta.</summary>
    public static string AfterUserReply(string status) =>
        status is TicketStatuses.WaitingUser or TicketStatuses.Resolved ? TicketStatuses.Open : status;

    /// <summary>Resposta pública da equipe: aberto/em andamento passam a aguardar o usuário; demais estados ficam como estão.</summary>
    public static string AfterStaffReply(string status) =>
        status is TicketStatuses.Open or TicketStatuses.InProgress ? TicketStatuses.WaitingUser : status;

    /// <summary>Reabrir: somente resolvido/fechado e há menos de <see cref="ReopenDays"/> dias.</summary>
    public static bool CanReopen(string status, DateTime? closedAt, DateTime now) =>
        IsDone(status) && closedAt is { } at && now - at < TimeSpan.FromDays(ReopenDays);

    /// <summary><c>ClosedAt</c> existe somente em resolvido/fechado e marca a última entrada em um desses estados.</summary>
    public static DateTime? ClosedAtFor(string from, string to, DateTime? current, DateTime now) =>
        !IsDone(to) ? null : from == to && current is not null ? current : now;

    public static string StatusLabel(string status) => status switch
    {
        TicketStatuses.Open => "Aberto",
        TicketStatuses.InProgress => "Em andamento",
        TicketStatuses.WaitingUser => "Aguardando usuário",
        TicketStatuses.Resolved => "Resolvido",
        TicketStatuses.Closed => "Fechado",
        _ => status,
    };

    public static string PriorityLabel(string priority) => priority switch
    {
        TicketPriorities.Low => "Baixa",
        TicketPriorities.Normal => "Normal",
        TicketPriorities.High => "Alta",
        TicketPriorities.Urgent => "Urgente",
        _ => priority,
    };

    /// <summary>Normaliza quebras de linha, apara e valida tamanho e caracteres de controle.</summary>
    public static string Text(string? value, int min, int max, bool multiline, string message)
    {
        var text = (value ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        if (text.Length < min || text.Length > max || text.Any(c => char.IsControl(c) && !(multiline && c is '\n' or '\t')))
            throw new RuleException(400, message);
        return text;
    }
}

/// <summary>Tickets de suporte: abertura e conversa pelo usuário, fila e atendimento pela equipe (admin).
/// Escritas bloqueiam a linha do ticket (PostgreSQL), incrementam <see cref="SupportTicket.Revision"/> e gravam
/// mensagens automáticas/auditoria na mesma transação. Tickets não concedem XP.</summary>
public class SupportService(GameDb db, AuditService audit, TimeProvider clock)
{
    DateTime Now => clock.GetUtcNow().UtcDateTime;
    static RuleException NotFound() => new(404, "Chamado não encontrado.");

    async Task<SupportTicket> LockAsync(Guid id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql()
            ? db.Tickets.FromSqlInterpolated($"SELECT * FROM \"Tickets\" WHERE \"Id\" = {id} FOR UPDATE")
            : db.Tickets.Where(x => x.Id == id);
        return await query.SingleOrDefaultAsync(ct) ?? throw NotFound();
    }

    /// <summary>Serializa as escritas que dependem da contagem de chamados abertos de um usuário.</summary>
    async Task LockUserAsync(string user, CancellationToken ct)
    {
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"AspNetUsers\" WHERE \"Id\" = {user} FOR UPDATE", ct);
    }

    async Task EnsureOpenSlotAsync(string user, CancellationToken ct)
    {
        var open = await db.Tickets.CountAsync(t => t.AuthorId == user && t.Status != TicketStatuses.Resolved && t.Status != TicketStatuses.Closed, ct);
        if (open >= SupportRules.MaxOpenPerUser)
            throw new RuleException(400, $"Você já tem {SupportRules.MaxOpenPerUser} chamados em aberto. Feche um deles ou aguarde a resolução antes de abrir outro.");
    }

    async Task EnsureRoomAsync(Guid ticket, CancellationToken ct)
    {
        if (await db.TicketMessages.CountAsync(m => m.TicketId == ticket, ct) >= SupportRules.MaxMessages)
            throw new RuleException(409, "Este chamado atingiu o limite de mensagens. Abra um novo chamado para continuar.");
    }

    void Touch(SupportTicket t)
    {
        t.UpdatedAt = Now;
        t.Revision++;
    }

    void SetStatus(SupportTicket t, string to)
    {
        t.ClosedAt = SupportRules.ClosedAtFor(t.Status, to, t.ClosedAt, Now);
        t.Status = to;
    }

    void Note(SupportTicket t, string author, string body) =>
        db.TicketMessages.Add(new TicketMessage { TicketId = t.Id, AuthorId = author, Body = body, Internal = true, CreatedAt = Now });

    static string StatusChange(string from, string to, string reason) =>
        $"Status: {SupportRules.StatusLabel(from)} → {SupportRules.StatusLabel(to)} ({reason})";

    internal static bool IsUniqueViolation(DbUpdateException e) => e.InnerException switch
    {
        PostgresException p => p.SqlState == PostgresErrorCodes.UniqueViolation,
        SqliteException s => s.SqliteErrorCode == 19 && s.SqliteExtendedErrorCode == 2067,
        _ => false,
    };

    static IQueryable<SupportTicket> FilterStatus(IQueryable<SupportTicket> query, string? status) => status switch
    {
        null or "" => query,
        SupportRules.ActiveFilter => query.Where(t => t.Status != TicketStatuses.Resolved && t.Status != TicketStatuses.Closed),
        _ when TicketStatuses.All.Contains(status) => query.Where(t => t.Status == status),
        _ => throw new RuleException(400, "Filtro de status inválido."),
    };

    static int Page(int page) => Math.Clamp(page, 1, 100000);

    // ---------- Usuário ----------

    public async Task<object> CreateAsync(string user, TicketCreateInput x, CancellationToken ct)
    {
        var subject = SupportRules.Text(x.Subject, 3, 120, false, "O assunto deve ter de 3 a 120 caracteres.");
        var body = SupportRules.Text(x.Body, 10, 10000, true, "A descrição deve ter de 10 a 10.000 caracteres.");
        var category = x.Category is { } c && TicketCategories.All.Contains(c) ? c : throw new RuleException(400, "Escolha uma categoria válida.");
        for (var attempt = 1; ; attempt++)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await LockUserAsync(user, ct);
            await EnsureOpenSlotAsync(user, ct);
            // PostgreSQL: serializa a numeração (bloqueio consultivo da transação) para que rajadas não esgotem as tentativas.
            if (db.Database.IsNpgsql()) await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(7202611)", ct);
            // Número legível sequencial; o índice único resolve corridas entre usuários diferentes (nova tentativa abaixo).
            var number = (await db.Tickets.MaxAsync(t => (int?)t.Number, ct) ?? 0) + 1;
            var now = Now;
            var ticket = new SupportTicket { AuthorId = user, Number = number, Subject = subject, Category = category, CreatedAt = now, UpdatedAt = now };
            var message = new TicketMessage { TicketId = ticket.Id, AuthorId = user, Body = body, CreatedAt = now };
            db.Tickets.Add(ticket);
            db.TicketMessages.Add(message);
            try
            {
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return new { ticket.Id, ticket.Number };
            }
            catch (DbUpdateException e) when (IsUniqueViolation(e))
            {
                db.Entry(message).State = EntityState.Detached;
                db.Entry(ticket).State = EntityState.Detached;
                await tx.RollbackAsync(ct);
                if (attempt >= SupportRules.NumberAttempts)
                    throw new RuleException(409, "Muitos chamados foram abertos ao mesmo tempo. Tente novamente em instantes.");
            }
        }
    }

    public async Task<object> MyTicketsAsync(string user, string? status, int page, CancellationToken ct)
    {
        page = Page(page);
        var query = FilterStatus(db.Tickets.AsNoTracking().Where(t => t.AuthorId == user), status);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(t => t.UpdatedAt).ThenBy(t => t.Id)
            .Skip((page - 1) * SupportRules.PageSize).Take(SupportRules.PageSize)
            .Select(t => new
            {
                t.Id,
                t.Number,
                t.Subject,
                t.Category,
                t.Status,
                t.CreatedAt,
                t.UpdatedAt,
                t.ClosedAt,
                messageCount = db.TicketMessages.Count(m => m.TicketId == t.Id && !m.Internal),
                lastFromStaff = db.TicketMessages.Where(m => m.TicketId == t.Id && !m.Internal).OrderByDescending(m => m.Id).Select(m => m.AuthorId != t.AuthorId).FirstOrDefault(),
            }).ToListAsync(ct);
        var openCount = await db.Tickets.CountAsync(t => t.AuthorId == user && t.Status != TicketStatuses.Resolved && t.Status != TicketStatuses.Closed, ct);
        return new { items, total, page, pageSize = SupportRules.PageSize, openCount, maxOpen = SupportRules.MaxOpenPerUser };
    }

    public async Task<object> MyTicketAsync(string user, Guid id, CancellationToken ct)
    {
        var t = await db.Tickets.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.AuthorId == user, ct) ?? throw NotFound();
        var author = t.AuthorId;
        // Notas internas nunca saem daqui; e-mail de ninguém é projetado.
        var messages = await (from m in db.TicketMessages.AsNoTracking()
                              join u in db.Users on m.AuthorId equals u.Id
                              where m.TicketId == id && !m.Internal
                              orderby m.Id
                              select new
                              {
                                  m.Id,
                                  m.Body,
                                  m.CreatedAt,
                                  fromStaff = m.AuthorId != author,
                                  mine = m.AuthorId == user,
                                  author = new { name = u.DisplayName, avatarUrl = u.AvatarUrl },
                              }).ToListAsync(ct);
        return new
        {
            t.Id,
            t.Number,
            t.Subject,
            t.Category,
            t.Status,
            t.CreatedAt,
            t.UpdatedAt,
            t.ClosedAt,
            t.Revision,
            canReply = t.Status != TicketStatuses.Closed,
            canClose = t.Status != TicketStatuses.Closed,
            canReopen = SupportRules.CanReopen(t.Status, t.ClosedAt, Now),
            messages,
        };
    }

    async Task<SupportTicket> LockOwnAsync(string user, Guid id, CancellationToken ct)
    {
        var t = await LockAsync(id, ct);
        if (t.AuthorId != user) throw NotFound();
        return t;
    }

    public async Task ReplyAsync(string user, Guid id, TicketReplyInput x, CancellationToken ct)
    {
        var body = SupportRules.Text(x.Body, 1, 10000, true, "A mensagem deve ter de 1 a 10.000 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockOwnAsync(user, id, ct);
        if (t.Status == TicketStatuses.Closed) throw new RuleException(409, "Este chamado está fechado. Reabra-o para responder.");
        await EnsureRoomAsync(t.Id, ct);
        db.TicketMessages.Add(new TicketMessage { TicketId = t.Id, AuthorId = user, Body = body, CreatedAt = Now });
        var from = t.Status;
        var to = SupportRules.AfterUserReply(from);
        if (to != from)
        {
            SetStatus(t, to);
            Note(t, user, StatusChange(from, to, "resposta do usuário"));
        }
        Touch(t);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task CloseAsync(string user, Guid id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockOwnAsync(user, id, ct);
        if (t.Status == TicketStatuses.Closed) throw new RuleException(409, "Este chamado já está fechado.");
        var from = t.Status;
        SetStatus(t, TicketStatuses.Closed);
        Note(t, user, StatusChange(from, TicketStatuses.Closed, "fechado pelo usuário"));
        Touch(t);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task ReopenAsync(string user, Guid id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockUserAsync(user, ct);
        var t = await LockOwnAsync(user, id, ct);
        if (!SupportRules.IsDone(t.Status)) throw new RuleException(409, "Este chamado já está aberto.");
        if (!SupportRules.CanReopen(t.Status, t.ClosedAt, Now))
            throw new RuleException(409, $"Chamados concluídos há mais de {SupportRules.ReopenDays} dias não podem ser reabertos. Abra um novo chamado.");
        await EnsureOpenSlotAsync(user, ct);
        var from = t.Status;
        SetStatus(t, TicketStatuses.Open);
        Note(t, user, StatusChange(from, TicketStatuses.Open, "reaberto pelo usuário"));
        Touch(t);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ---------- Equipe (admin) ----------

    /// <summary>Mesma regra de <see cref="PlatformAccess.IsAdminAsync"/> (papel lido do banco, e-mail confirmado, sem bloqueio),
    /// com o bloqueio avaliado após a leitura para também funcionar no SQLite dos testes.</summary>
    async Task RequireAdminAsync(string user, CancellationToken ct)
    {
        var u = await db.Users.AsNoTracking().Where(x => x.Id == user)
            .Select(x => new { x.Role, x.EmailConfirmed, x.LockoutEnd }).SingleOrDefaultAsync(ct);
        if (u is not { Role: PlatformRoles.Admin, EmailConfirmed: true } || u.LockoutEnd > clock.GetUtcNow())
            throw new RuleException(403, "Acesso restrito à administração.");
    }

    public async Task<object> QueueAsync(string admin, TicketQueueQuery x, CancellationToken ct)
    {
        await RequireAdminAsync(admin, ct);
        var page = Page(x.Page);
        var query = FilterStatus(db.Tickets.AsNoTracking(), x.Status);
        if (!string.IsNullOrEmpty(x.Priority))
        {
            if (!TicketPriorities.All.Contains(x.Priority)) throw new RuleException(400, "Filtro de prioridade inválido.");
            query = query.Where(t => t.Priority == x.Priority);
        }
        if (!string.IsNullOrEmpty(x.Category))
        {
            if (!TicketCategories.All.Contains(x.Category)) throw new RuleException(400, "Filtro de categoria inválido.");
            query = query.Where(t => t.Category == x.Category);
        }
        query = x.Assigned switch
        {
            null or "" or "any" => query,
            "me" => query.Where(t => t.AssignedToId == admin),
            "none" => query.Where(t => t.AssignedToId == null),
            _ => throw new RuleException(400, "Filtro de responsável inválido."),
        };
        var term = (x.Q ?? "").Trim();
        if (term.Length > 100) throw new RuleException(400, "Busca muito longa.");
        if (term.Length > 0)
        {
            var digits = term.TrimStart('#');
            var lower = term.ToLowerInvariant();
            query = digits.Length is > 0 and <= 9 && digits.All(char.IsAsciiDigit) && int.TryParse(digits, out var number)
                ? query.Where(t => t.Number == number || t.Subject.ToLower().Contains(lower))
                : query.Where(t => t.Subject.ToLower().Contains(lower));
        }
        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(t => t.Priority == TicketPriorities.Urgent ? 0 : t.Priority == TicketPriorities.High ? 1 : t.Priority == TicketPriorities.Normal ? 2 : 3)
            .ThenByDescending(t => t.UpdatedAt).ThenBy(t => t.Id)
            .Skip((page - 1) * SupportRules.PageSize).Take(SupportRules.PageSize)
            .Select(t => new
            {
                t.Id,
                t.Number,
                t.Subject,
                t.Category,
                t.Priority,
                t.Status,
                t.CreatedAt,
                t.UpdatedAt,
                author = new { id = t.AuthorId, name = db.Users.Where(u => u.Id == t.AuthorId).Select(u => u.DisplayName).FirstOrDefault() },
                assignee = t.AssignedToId == null ? null : new { id = t.AssignedToId, name = db.Users.Where(u => u.Id == t.AssignedToId).Select(u => u.DisplayName).FirstOrDefault() },
                messageCount = db.TicketMessages.Count(m => m.TicketId == t.Id && !m.Internal),
            }).ToListAsync(ct);
        var byStatus = await db.Tickets.AsNoTracking().GroupBy(t => t.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var mine = await db.Tickets.CountAsync(t => t.AssignedToId == admin && t.Status != TicketStatuses.Resolved && t.Status != TicketStatuses.Closed, ct);
        var counts = TicketStatuses.All.ToDictionary(s => s, s => byStatus.FirstOrDefault(b => b.Key == s)?.Count ?? 0);
        return new { items, total, page, pageSize = SupportRules.PageSize, counts, mine };
    }

    public async Task<object> AdminTicketAsync(string admin, Guid id, CancellationToken ct)
    {
        await RequireAdminAsync(admin, ct);
        var t = await db.Tickets.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw NotFound();
        var authorId = t.AuthorId;
        // Somente admin chega aqui: e-mail do solicitante é exibido para atendimento.
        var author = await db.Users.AsNoTracking().Where(u => u.Id == authorId)
            .Select(u => new { id = u.Id, name = u.DisplayName, email = u.Email, avatarUrl = u.AvatarUrl, role = u.Role }).SingleAsync(ct);
        var assignee = t.AssignedToId == null ? null : await db.Users.AsNoTracking().Where(u => u.Id == t.AssignedToId)
            .Select(u => new { id = u.Id, name = u.DisplayName, role = u.Role }).SingleOrDefaultAsync(ct);
        var messages = await (from m in db.TicketMessages.AsNoTracking()
                              join u in db.Users on m.AuthorId equals u.Id
                              where m.TicketId == id
                              orderby m.Id
                              select new
                              {
                                  m.Id,
                                  m.Body,
                                  m.Internal,
                                  m.CreatedAt,
                                  fromStaff = m.AuthorId != authorId,
                                  author = new { id = u.Id, name = u.DisplayName, avatarUrl = u.AvatarUrl },
                              }).ToListAsync(ct);
        var otherOpen = await db.Tickets.CountAsync(x => x.AuthorId == authorId && x.Id != id && x.Status != TicketStatuses.Resolved && x.Status != TicketStatuses.Closed, ct);
        return new
        {
            t.Id,
            t.Number,
            t.Subject,
            t.Category,
            t.Priority,
            t.Status,
            t.CreatedAt,
            t.UpdatedAt,
            t.ClosedAt,
            t.Revision,
            author,
            assignee,
            authorOtherOpen = otherOpen,
            messages,
        };
    }

    public async Task<object> AssigneesAsync(string admin, CancellationToken ct)
    {
        await RequireAdminAsync(admin, ct);
        return await db.Users.AsNoTracking()
            .Where(u => (u.Role == PlatformRoles.Admin || u.Role == PlatformRoles.Ambassador) && u.EmailConfirmed)
            .OrderBy(u => u.DisplayName).ThenBy(u => u.Id).Take(200)
            .Select(u => new { id = u.Id, name = u.DisplayName, role = u.Role }).ToListAsync(ct);
    }

    public async Task StaffMessageAsync(string admin, Guid id, StaffTicketMessageInput x, CancellationToken ct)
    {
        await RequireAdminAsync(admin, ct);
        var body = SupportRules.Text(x.Body, 1, 10000, true, "A mensagem deve ter de 1 a 10.000 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockAsync(id, ct);
        await EnsureRoomAsync(t.Id, ct);
        db.TicketMessages.Add(new TicketMessage { TicketId = t.Id, AuthorId = admin, Body = body, Internal = x.Internal, CreatedAt = Now });
        var from = t.Status;
        var to = x.Internal ? from : SupportRules.AfterStaffReply(from);
        if (to != from)
        {
            SetStatus(t, to);
            Note(t, admin, StatusChange(from, to, "resposta da equipe"));
        }
        audit.Record(admin, x.Internal ? "ticket.note" : "ticket.reply", "ticket", t.Id.ToString(),
            $"Chamado #{t.Number}: {(x.Internal ? "nota interna" : "resposta ao usuário")}{(to != from ? $"; status {from} → {to}" : "")}",
            new { number = t.Number, @internal = x.Internal, status = to != from ? new { from, to } : null });
        Touch(t);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task<object> UpdateAsync(string admin, Guid id, TicketUpdateInput x, CancellationToken ct)
    {
        await RequireAdminAsync(admin, ct);
        var status = x.Status is { } s && TicketStatuses.All.Contains(s) ? s : throw new RuleException(400, "Status inválido.");
        var priority = x.Priority is { } p && TicketPriorities.All.Contains(p) ? p : throw new RuleException(400, "Prioridade inválida.");
        var assigneeId = string.IsNullOrWhiteSpace(x.AssignedToId) ? null : x.AssignedToId.Trim();
        string? assigneeName = null;
        if (assigneeId != null)
        {
            if (assigneeId.Length > 450) throw new RuleException(400, "Responsável inválido.");
            assigneeName = await db.Users.AsNoTracking()
                .Where(u => u.Id == assigneeId && u.EmailConfirmed && (u.Role == PlatformRoles.Admin || u.Role == PlatformRoles.Ambassador))
                .Select(u => u.DisplayName).SingleOrDefaultAsync(ct)
                ?? throw new RuleException(400, "Atribua o chamado somente a administradores ou embaixadores.");
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockAsync(id, ct);
        if (t.Revision != x.Revision) throw new RuleException(409, "O chamado mudou enquanto você editava. Recarregue e confira antes de salvar.");
        var before = new { status = t.Status, priority = t.Priority, assignedToId = t.AssignedToId };
        var changes = new List<string>();
        if (status != t.Status)
        {
            changes.Add($"Status: {SupportRules.StatusLabel(t.Status)} → {SupportRules.StatusLabel(status)}");
            SetStatus(t, status);
        }
        if (priority != t.Priority)
        {
            changes.Add($"Prioridade: {SupportRules.PriorityLabel(t.Priority)} → {SupportRules.PriorityLabel(priority)}");
            t.Priority = priority;
        }
        if (assigneeId != t.AssignedToId)
        {
            var previous = t.AssignedToId == null ? null
                : await db.Users.AsNoTracking().Where(u => u.Id == t.AssignedToId).Select(u => u.DisplayName).SingleOrDefaultAsync(ct);
            changes.Add($"Atribuição: {previous ?? "ninguém"} → {assigneeName ?? "ninguém"}");
            t.AssignedToId = assigneeId;
        }
        if (changes.Count > 0)
        {
            foreach (var change in changes) Note(t, admin, change);
            audit.Record(admin, "ticket.update", "ticket", t.Id.ToString(), $"Chamado #{t.Number}: {string.Join("; ", changes)}",
                new { number = t.Number, before, after = new { status = t.Status, priority = t.Priority, assignedToId = t.AssignedToId } });
            Touch(t);
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        return await AdminTicketAsync(admin, id, ct);
    }
}
