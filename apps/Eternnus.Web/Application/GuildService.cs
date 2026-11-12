using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record GuildTopicInput(Guid CategoryId, string? Title, string? Body, Guid? SystemId = null);
/// <param name="Revision">Revisão lida (campo <c>revision</c> do post). Informada → edição concorrente devolve 409; ausente → última gravação vence.</param>
public record GuildPostInput(string? Body, long? Revision = null);
public record GuildReportInput(string? Reason);
public record GuildResolveInput(string? Resolution, string? Note);
public record GuildReasonInput(string? Reason);
public record GuildTopicModerationInput(bool? Locked, bool? Pinned, Guid? CategoryId, bool? Deleted, string? Reason, int Revision);
public record GuildCategoryInput(string? Name, string? Slug, string? Description, int Order, int MinLevelToPost, bool StaffOnly, bool Archived = false);

/// <summary>Guilda: categorias, tópicos, posts, marcação útil, denúncias e moderação.
/// Texto é sempre puro (o cliente escapa). Moderação é auditada na mesma gravação da alteração.
/// XP é concedido pelo <see cref="ProgressionService"/> antes do SaveChanges final de cada caso de uso.</summary>
public partial class GuildService(GameDb db, AuditService audit, ProgressionService progression)
{
    public const int PageSize = 20;
    const string DefaultAvatar = "/assets/avatar.svg";
    const string OwnAvatarPrefix = "/api/auth/avatar/";

    /// <summary>Usuário atual lido do banco. Papel só vale com e-mail confirmado e conta não bloqueada (como em <see cref="PlatformAccess"/>).</summary>
    sealed record Viewer(string Id, string Role, int Level, bool Active)
    {
        public bool Staff => Active && PlatformRoles.IsStaff(Role);
        public bool Admin => Active && Role == PlatformRoles.Admin;
    }
    sealed record AuthorRow(string Id, string Name, string AvatarUrl, int Level, string Role);
    public sealed record GuildAuthor(string Id, string Name, string AvatarUrl, int Level, string Role);

    async Task<Viewer> ViewerAsync(string userId, CancellationToken ct)
    {
        // Bloqueio avaliado em memória: comparação de DateTimeOffset não é traduzível em todos os provedores (SQLite de teste).
        var row = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.Role, u.Level, u.EmailConfirmed, u.LockoutEnd }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(401, "Entre novamente para continuar.");
        return new Viewer(userId, row.Role, row.Level, row.EmailConfirmed && (row.LockoutEnd == null || row.LockoutEnd < DateTimeOffset.UtcNow));
    }

    /// <summary>Avatares enviados só são servidos ao próprio dono; para os demais usa o avatar padrão.</summary>
    static GuildAuthor Author(AuthorRow a, string viewer) => new(a.Id, a.Name,
        a.AvatarUrl.StartsWith(OwnAvatarPrefix, StringComparison.Ordinal) && a.Id != viewer ? DefaultAvatar : a.AvatarUrl,
        a.Level, PlatformRoles.IsValid(a.Role) ? a.Role : PlatformRoles.Common);

    // ---------- Validação de texto ----------
    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")] private static partial Regex SlugPattern();
    [GeneratedRegex("\\s+")] private static partial Regex Spaces();

    /// <summary>Texto de várias linhas: normaliza quebras, remove caracteres de controle (exceto quebra e tab) e apara.</summary>
    public static string CleanBody(string? value)
    {
        if (value is null) return "";
        var text = value.Replace("\r\n", "\n").Replace('\r', '\n');
        var sb = new StringBuilder(text.Length);
        foreach (var c in text) if (c == '\n' || c == '\t' || !char.IsControl(c)) sb.Append(c);
        return sb.ToString().Trim();
    }
    /// <summary>Texto de uma linha: sem controle, espaços colapsados.</summary>
    public static string CleanLine(string? value) => Spaces().Replace(CleanBody(value), " ");

    static string Body(string? value)
    {
        var body = CleanBody(value);
        if (body.Length is < 2 or > 10000) throw new RuleException(400, "A mensagem deve ter de 2 a 10.000 caracteres.");
        return body;
    }
    static string Reason(string? value, int min = 3, int max = 300, string what = "o motivo")
    {
        var reason = CleanLine(value);
        if (reason.Length < min || reason.Length > max) throw new RuleException(400, $"Informe {what} ({min} a {max} caracteres).");
        return reason;
    }
    /// <summary>Revisão de um post (não há coluna própria): microssegundos Unix de <see cref="GuildPost.EditedAt"/>, 0 se nunca editado.
    /// Fica abaixo de 2^53 (número exato no JavaScript). <see cref="EditAsync"/> grava EditedAt já truncado em microssegundos
    /// (precisão do PostgreSQL) para a revisão sobreviver à ida ao banco.</summary>
    public static long PostRevision(DateTime? editedAt) => editedAt is { } at ? (at.Ticks - DateTime.UnixEpoch.Ticks) / 10 : 0;
    static DateTime UtcNowMicroseconds()
    {
        var now = DateTime.UtcNow;
        return new DateTime(now.Ticks - now.Ticks % 10, DateTimeKind.Utc);
    }
    static string Excerpt(string body, int max = 280) => body.Length <= max ? body : body[..max] + "…";

    async Task<GuildTopic?> LockTopicAsync(Guid id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql()
            ? db.GuildTopics.FromSqlInterpolated($"SELECT * FROM \"GuildTopics\" WHERE \"Id\" = {id} FOR UPDATE")
            : db.GuildTopics.Where(t => t.Id == id);
        return await query.SingleOrDefaultAsync(ct);
    }

    /// <summary>Motivo pelo qual o usuário não pode abrir tópico na categoria; nulo se pode.</summary>
    async Task<(int Status, string Message, int? RequiredLevel)?> TopicBlockAsync(GuildCategory category, Viewer viewer, CancellationToken ct)
    {
        if (category.ArchivedAt != null) return (409, "Esta categoria foi arquivada e não recebe novos tópicos.", null);
        if (viewer.Staff) return null; // equipe modera e publica avisos em qualquer categoria
        if (category.StaffOnly) return (403, $"Somente a equipe da Guilda abre tópicos em {category.Name}.", null);
        if (viewer.Level < category.MinLevelToPost)
            return (403, $"Abrir tópicos em {category.Name} exige nível {category.MinLevelToPost}. Seu nível atual é {viewer.Level}.", category.MinLevelToPost);
        try { await progression.RequireLevelAsync(viewer.Id, LevelFeatures.GuildTopic, ct); }
        catch (RuleException e) { return (e.Status, e.Message, null); }
        return null;
    }

    // ---------- Leitura ----------
    public async Task<object> CategoriesAsync(string userId, CancellationToken ct)
    {
        var viewer = await ViewerAsync(userId, ct);
        var items = await db.GuildCategories.AsNoTracking().Where(c => c.ArchivedAt == null)
            .OrderBy(c => c.Order).ThenBy(c => c.Name).ThenBy(c => c.Id)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Slug,
                c.Description,
                c.Order,
                c.MinLevelToPost,
                c.StaffOnly,
                topicCount = db.GuildTopics.Count(t => t.CategoryId == c.Id && t.DeletedAt == null && t.HeldAt == null),
                postCount = db.GuildTopics.Where(t => t.CategoryId == c.Id && t.DeletedAt == null && t.HeldAt == null).Sum(t => (int?)t.PostCount) ?? 0,
                lastTopic = db.GuildTopics.Where(t => t.CategoryId == c.Id && t.DeletedAt == null && t.HeldAt == null)
                    .OrderByDescending(t => t.LastPostAt).ThenByDescending(t => t.Id)
                    .Select(t => new { t.Id, t.Title, t.LastPostAt, author = db.Users.Where(u => u.Id == t.AuthorId).Select(u => u.DisplayName).FirstOrDefault() })
                    .FirstOrDefault(),
            }).ToListAsync(ct);
        // Nível geral para abrir tópicos (ProgressionService). Categorias acrescentam o próprio mínimo.
        string? topicBlockedReason = null;
        if (!viewer.Staff)
        {
            try { await progression.RequireLevelAsync(userId, LevelFeatures.GuildTopic, ct); }
            catch (RuleException e) { topicBlockedReason = e.Message; }
        }
        return new { items, viewer = new { level = viewer.Level, staff = viewer.Staff, role = viewer.Role, topicBlockedReason } };
    }

    public async Task<object> TopicsAsync(string userId, string? category, string? q, Guid? systemId, int page, bool deleted, CancellationToken ct)
    {
        var viewer = await ViewerAsync(userId, ct);
        if (deleted && !viewer.Staff) throw new RuleException(403, "Somente a equipe vê tópicos removidos.");
        if (q?.Length > 100) throw new RuleException(400, "Busca muito longa (máximo 100 caracteres).");
        if (category?.Length > 60) throw new RuleException(404, "Categoria não encontrada.");
        page = Math.Clamp(page, 1, 100000);
        var query = db.GuildTopics.AsNoTracking().Where(t => deleted ? t.DeletedAt != null : t.DeletedAt == null);
        // Tópico em análise (ADR-068) sai das listas; a equipe continua vendo, com o selo.
        if (!viewer.Staff) query = query.Where(t => t.HeldAt == null);
        object? categoryInfo = null;
        if (!string.IsNullOrWhiteSpace(category))
        {
            var c = await db.GuildCategories.AsNoTracking().SingleOrDefaultAsync(x => x.Slug == category, ct)
                ?? throw new RuleException(404, "Categoria não encontrada.");
            if (c.ArchivedAt != null && !viewer.Staff) throw new RuleException(404, "Categoria não encontrada.");
            var block = await TopicBlockAsync(c, viewer, ct);
            categoryInfo = new
            {
                c.Id, c.Name, c.Slug, c.Description, c.MinLevelToPost, c.StaffOnly, archived = c.ArchivedAt != null,
                canCreateTopic = block is null, blockedReason = block?.Message, requiredLevel = block?.RequiredLevel,
            };
            query = query.Where(t => t.CategoryId == c.Id);
        }
        else query = query.Where(t => db.GuildCategories.Any(c => c.Id == t.CategoryId && c.ArchivedAt == null));
        if (systemId is { } system) query = query.Where(t => t.RpgSystemId == system);
        if (!string.IsNullOrWhiteSpace(q))
        {
            query = query.Where(TextSearch.AnyField<GuildTopic>(db, TextSearch.Pattern(q.Trim()), t => t.Title));
        }
        var total = await query.CountAsync(ct);
        var joined = from t in query join u in db.Users on t.AuthorId equals u.Id select new { t, u };
        var ordered = deleted
            ? joined.OrderByDescending(x => x.t.DeletedAt).ThenBy(x => x.t.Id)
            : joined.OrderByDescending(x => x.t.Pinned).ThenByDescending(x => x.t.LastPostAt).ThenBy(x => x.t.Id);
        var rows = await ordered.Skip((page - 1) * PageSize).Take(PageSize)
            .Select(x => new
            {
                x.t.Id,
                x.t.Title,
                x.t.CreatedAt,
                x.t.LastPostAt,
                x.t.PostCount,
                x.t.Pinned,
                x.t.Locked,
                x.t.DeletedAt,
                x.t.HeldAt,
                x.t.Revision,
                category = db.GuildCategories.Where(c => c.Id == x.t.CategoryId).Select(c => new { c.Slug, c.Name }).FirstOrDefault(),
                system = db.RpgSystems.Where(s => s.Id == x.t.RpgSystemId).Select(s => new { s.Id, s.Name }).FirstOrDefault(),
                author = new AuthorRow(x.u.Id, x.u.DisplayName, x.u.AvatarUrl, x.u.Level, x.u.Role),
            }).ToListAsync(ct);
        var items = rows.Select(t => new
        {
            t.Id, t.Title, t.CreatedAt, t.LastPostAt, t.PostCount, replyCount = Math.Max(0, t.PostCount - 1), t.Pinned, t.Locked,
            deleted = t.DeletedAt != null, t.DeletedAt, held = t.HeldAt != null, t.Revision, t.category, t.system, author = Author(t.author, userId),
        }).ToList();
        return new { items, total, page, pageSize = PageSize, category = categoryInfo };
    }

    public async Task<object> RecentAsync(string userId, int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 20);
        var rows = await (from t in db.GuildTopics.AsNoTracking()
                          join u in db.Users on t.AuthorId equals u.Id
                          where t.DeletedAt == null && t.HeldAt == null && db.GuildCategories.Any(c => c.Id == t.CategoryId && c.ArchivedAt == null)
                          orderby t.LastPostAt descending, t.Id
                          select new
                          {
                              t.Id,
                              t.Title,
                              t.LastPostAt,
                              t.PostCount,
                              t.Pinned,
                              t.Locked,
                              category = db.GuildCategories.Where(c => c.Id == t.CategoryId).Select(c => new { c.Slug, c.Name }).FirstOrDefault(),
                              author = new AuthorRow(u.Id, u.DisplayName, u.AvatarUrl, u.Level, u.Role),
                          }).Take(limit).ToListAsync(ct);
        return rows.Select(t => new { t.Id, t.Title, t.LastPostAt, t.PostCount, replyCount = Math.Max(0, t.PostCount - 1), t.Pinned, t.Locked, t.category, author = Author(t.author, userId) }).ToList();
    }

    public async Task<object> TopicAsync(Guid id, string userId, int page, CancellationToken ct)
    {
        var viewer = await ViewerAsync(userId, ct);
        var topic = await db.GuildTopics.AsNoTracking().Where(t => t.Id == id)
            .Join(db.Users, t => t.AuthorId, u => u.Id, (t, u) => new
            {
                t.Id,
                t.Title,
                t.CreatedAt,
                t.LastPostAt,
                t.PostCount,
                t.Pinned,
                t.Locked,
                t.DeletedAt,
                t.HeldAt,
                t.Revision,
                category = db.GuildCategories.Where(c => c.Id == t.CategoryId).Select(c => new { c.Id, c.Slug, c.Name, c.StaffOnly, archived = c.ArchivedAt != null }).FirstOrDefault(),
                system = db.RpgSystems.Where(s => s.Id == t.RpgSystemId).Select(s => new { s.Id, s.Name }).FirstOrDefault(),
                author = new AuthorRow(u.Id, u.DisplayName, u.AvatarUrl, u.Level, u.Role),
            }).SingleOrDefaultAsync(ct);
        if (topic is null || (topic.DeletedAt != null && !viewer.Staff)) throw new RuleException(404, "Tópico não encontrado.");
        // Tópico em análise: só a equipe e o autor (que vê o aviso) abrem.
        var topicHeld = topic.HeldAt != null;
        if (topicHeld && !viewer.Staff && topic.author.Id != userId) throw new RuleException(404, "Tópico não encontrado.");
        var total = await db.GuildPosts.CountAsync(p => p.TopicId == id, ct);
        var pageCount = Math.Max(1, (total + PageSize - 1) / PageSize);
        page = Math.Clamp(page, 1, pageCount);
        var firstPostId = await db.GuildPosts.Where(p => p.TopicId == id).OrderBy(p => p.Id).Select(p => (long?)p.Id).FirstOrDefaultAsync(ct);
        var staff = viewer.Staff;
        var rows = await (from p in db.GuildPosts.AsNoTracking()
                          join u in db.Users on p.AuthorId equals u.Id
                          where p.TopicId == id
                          orderby p.Id
                          select new
                          {
                              p.Id,
                              p.Body,
                              p.CreatedAt,
                              p.EditedAt,
                              p.DeletedAt,
                              p.DeletedById,
                              p.HeldAt,
                              p.UsefulCount,
                              author = new AuthorRow(u.Id, u.DisplayName, u.AvatarUrl, u.Level, u.Role),
                              markedUseful = db.GuildReactions.Any(r => r.PostId == p.Id && r.UserId == userId),
                              reported = db.GuildReports.Any(r => r.PostId == p.Id && r.ReporterId == userId),
                              openReports = staff ? db.GuildReports.Count(r => r.PostId == p.Id && r.ResolvedAt == null) : 0,
                          }).Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(ct);
        var topicDeleted = topic.DeletedAt != null;
        var posts = rows.Select(p =>
        {
            var deleted = p.DeletedAt != null;
            var mine = p.author.Id == userId;
            // Em análise (ADR-068): texto só para equipe e autor; sem edição, útil ou nova denúncia até a decisão.
            var held = !deleted && (p.HeldAt != null || (topicHeld && p.Id == firstPostId));
            return new
            {
                p.Id,
                author = Author(p.author, userId),
                p.CreatedAt,
                p.EditedAt,
                revision = PostRevision(p.EditedAt),
                p.UsefulCount,
                p.markedUseful,
                isFirst = p.Id == firstPostId,
                removed = !deleted ? null : p.DeletedById == p.author.Id ? "author" : "moderation",
                held,
                body = (deleted || held) && !staff && !(held && mine) ? null : p.Body,
                canEdit = !deleted && !held && mine && !topicDeleted && (!topic.Locked || staff),
                canDelete = !deleted && mine && !topicDeleted,
                canMarkUseful = !deleted && !held && !mine && !topicDeleted && !topicHeld,
                canReport = !deleted && !held && !mine && !topicDeleted && !topicHeld && !p.reported,
                p.reported,
                openReports = staff ? p.openReports : (int?)null,
            };
        }).ToList();
        return new
        {
            topic = new
            {
                topic.Id, topic.Title, topic.CreatedAt, topic.LastPostAt, topic.PostCount, topic.Pinned, topic.Locked,
                deleted = topicDeleted, held = topicHeld, topic.Revision, topic.category, topic.system, author = Author(topic.author, userId),
            },
            posts,
            page,
            pageSize = PageSize,
            total,
            pageCount,
            canReply = !topicDeleted && ((!topic.Locked && !topicHeld) || staff),
            staff,
        };
    }

    // ---------- Escrita ----------
    public async Task<object> CreateTopicAsync(GuildTopicInput input, string userId, CancellationToken ct)
    {
        var title = CleanLine(input.Title);
        if (title.Length is < 4 or > 140) throw new RuleException(400, "O título deve ter de 4 a 140 caracteres.");
        var body = Body(input.Body);
        var viewer = await ViewerAsync(userId, ct);
        var category = await db.GuildCategories.AsNoTracking().SingleOrDefaultAsync(c => c.Id == input.CategoryId, ct)
            ?? throw new RuleException(404, "Categoria não encontrada.");
        if (await TopicBlockAsync(category, viewer, ct) is { } block) throw new RuleException(block.Status, block.Message);
        if (input.SystemId is { } system && !await db.RpgSystems.AnyAsync(s => s.Id == system && s.Active, ct))
            throw new RuleException(400, "Sistema de RPG inválido.");
        var now = DateTime.UtcNow;
        var topic = new GuildTopic { CategoryId = category.Id, RpgSystemId = input.SystemId, AuthorId = userId, Title = title, CreatedAt = now, LastPostAt = now, PostCount = 1 };
        db.GuildTopics.Add(topic);
        db.GuildPosts.Add(new GuildPost { TopicId = topic.Id, AuthorId = userId, Body = body, CreatedAt = now });
        // Tópico e primeiro post na mesma gravação; o XP entra antes do SaveChanges.
        await progression.AwardAsync(userId, XpReasons.GuildTopic, $"guild_topic:{topic.Id}", ct);
        // A própria mensagem não acende o indicador de novidade (ADR-069).
        await NoticeService.MarkAsync(db, userId, ReadScopes.GuildTopic, topic.Id, now, ct);
        await db.SaveChangesAsync(ct);
        return new { id = topic.Id };
    }

    public async Task<object> ReplyAsync(Guid topicId, GuildPostInput input, string userId, CancellationToken ct)
    {
        var body = Body(input.Body);
        var viewer = await ViewerAsync(userId, ct);
        var staff = viewer.Staff;
        var now = DateTime.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Atualização condicional e atômica: trava a linha do tópico até o commit e confere exclusão/tranca no próprio UPDATE.
        var updated = await db.GuildTopics.Where(t => t.Id == topicId && t.DeletedAt == null && ((!t.Locked && t.HeldAt == null) || staff))
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.PostCount, t => t.PostCount + 1).SetProperty(t => t.LastPostAt, now), ct);
        if (updated == 0)
        {
            var state = await db.GuildTopics.Where(t => t.Id == topicId).Select(t => new { t.DeletedAt, t.Locked, t.HeldAt, t.AuthorId }).SingleOrDefaultAsync(ct);
            if (state is null || state.DeletedAt != null || (state.HeldAt != null && state.AuthorId != userId)) throw new RuleException(404, "Tópico não encontrado.");
            if (state.HeldAt != null) throw new RuleException(409, "Este tópico está em análise pela moderação e não recebe respostas por enquanto.");
            throw new RuleException(409, "Este tópico foi trancado pela moderação e não recebe respostas.");
        }
        var post = new GuildPost { TopicId = topicId, AuthorId = userId, Body = body, CreatedAt = now };
        db.GuildPosts.Add(post);
        await db.SaveChangesAsync(ct); // gera o Id do post para a chave de XP
        await progression.AwardAsync(userId, XpReasons.GuildPost, $"guild_post:{post.Id}", ct);
        await NoticeService.MarkAsync(db, userId, ReadScopes.GuildTopic, topicId, now, ct);
        await db.SaveChangesAsync(ct);
        var position = await db.GuildPosts.CountAsync(p => p.TopicId == topicId && p.Id <= post.Id, ct);
        await tx.CommitAsync(ct);
        return new { id = post.Id, page = Math.Max(1, (position + PageSize - 1) / PageSize) };
    }

    public async Task<object> EditAsync(long postId, GuildPostInput input, string userId, CancellationToken ct)
    {
        var body = Body(input.Body);
        var viewer = await ViewerAsync(userId, ct);
        var post = await db.GuildPosts.AsNoTracking().Where(p => p.Id == postId).Select(p => new { p.AuthorId, p.TopicId, p.DeletedAt, p.EditedAt, p.HeldAt }).SingleOrDefaultAsync(ct);
        if (post is null || post.AuthorId != userId) throw new RuleException(404, "Mensagem não encontrada.");
        if (post.DeletedAt != null) throw new RuleException(409, "Esta mensagem foi removida e não pode ser editada.");
        // O texto denunciado fica como está até a decisão: a moderação julga o que foi denunciado.
        if (post.HeldAt != null) throw new RuleException(409, HeldEditMessage);
        var topic = await db.GuildTopics.AsNoTracking().Where(t => t.Id == post.TopicId).Select(t => new { t.DeletedAt, t.Locked }).SingleAsync(ct);
        if (topic.DeletedAt != null) throw new RuleException(404, "Tópico não encontrado.");
        if (topic.Locked && !viewer.Staff) throw new RuleException(409, "Este tópico foi trancado pela moderação.");
        var seen = post.EditedAt;
        if (input.Revision is { } expected && expected != PostRevision(seen))
            throw new RuleException(409, "Esta mensagem foi alterada desde que você a abriu. Recarregue o tópico e tente de novo.");
        // UPDATE condicional: duas edições simultâneas com a mesma revisão não se sobrescrevem em silêncio.
        var now = UtcNowMicroseconds();
        var changed = await db.GuildPosts.Where(p => p.Id == postId && p.DeletedAt == null && p.HeldAt == null && p.EditedAt == seen)
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.Body, body).SetProperty(p => p.EditedAt, now), ct);
        if (changed == 0)
        {
            if (await db.GuildPosts.AnyAsync(p => p.Id == postId && p.HeldAt != null, ct)) throw new RuleException(409, HeldEditMessage);
            throw new RuleException(409, "Esta mensagem foi alterada desde que você a abriu. Recarregue o tópico e tente de novo.");
        }
        return new { id = postId, body, editedAt = now, revision = PostRevision(now) };
    }

    /// <summary>Exclusão lógica pelo autor. Se for o primeiro post e não houver respostas, o tópico também sai da lista.</summary>
    public async Task<object> DeleteOwnAsync(long postId, string userId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var topicId = await db.GuildPosts.Where(p => p.Id == postId && p.AuthorId == userId).Select(p => (Guid?)p.TopicId).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Mensagem não encontrada.");
        var topic = await LockTopicAsync(topicId, ct);
        if (topic is null || topic.DeletedAt != null) throw new RuleException(404, "Tópico não encontrado.");
        var post = await db.GuildPosts.SingleAsync(p => p.Id == postId, ct);
        if (post.DeletedAt != null) throw new RuleException(409, "Esta mensagem já foi removida.");
        var now = DateTime.UtcNow;
        post.DeletedAt = now;
        post.DeletedById = userId;
        var isFirst = !await db.GuildPosts.AnyAsync(p => p.TopicId == topicId && p.Id < postId, ct);
        var hasReplies = await db.GuildPosts.AnyAsync(p => p.TopicId == topicId && p.Id != postId, ct);
        var topicDeleted = isFirst && !hasReplies;
        if (topicDeleted) { topic.DeletedAt = now; topic.Revision++; }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { topicDeleted };
    }

    async Task<(string AuthorId, Guid TopicId)> VisiblePostAsync(long postId, CancellationToken ct)
    {
        var post = await db.GuildPosts.AsNoTracking().Where(p => p.Id == postId && p.DeletedAt == null && p.HeldAt == null && db.GuildTopics.Any(t => t.Id == p.TopicId && t.DeletedAt == null && t.HeldAt == null))
            .Select(p => new { p.AuthorId, p.TopicId }).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Mensagem não encontrada.");
        return (post.AuthorId, post.TopicId);
    }
    async Task<object> UsefulStateAsync(long postId, string userId, CancellationToken ct) => new
    {
        usefulCount = await db.GuildPosts.Where(p => p.Id == postId).Select(p => p.UsefulCount).SingleAsync(ct),
        markedUseful = await db.GuildReactions.AnyAsync(r => r.PostId == postId && r.UserId == userId, ct),
    };

    public async Task<object> MarkUsefulAsync(long postId, string userId, CancellationToken ct)
    {
        var (authorId, _) = await VisiblePostAsync(postId, ct);
        if (authorId == userId) throw new RuleException(403, "Você não pode marcar a própria mensagem como útil.");
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            if (!await db.GuildReactions.AnyAsync(r => r.PostId == postId && r.UserId == userId, ct))
            {
                var reaction = db.GuildReactions.Add(new GuildReaction { PostId = postId, UserId = userId });
                try { await db.SaveChangesAsync(ct); reaction.State = EntityState.Detached; }
                catch (DbUpdateException)
                {
                    // Marcação simultânea do mesmo usuário: a chave (PostId, UserId) garante unicidade; resultado idempotente.
                    await tx.RollbackAsync(ct);
                    db.ChangeTracker.Clear();
                    return await UsefulStateAsync(postId, userId, ct);
                }
                await db.GuildPosts.Where(p => p.Id == postId).ExecuteUpdateAsync(s => s.SetProperty(p => p.UsefulCount, p => p.UsefulCount + 1), ct);
                await progression.AwardAsync(authorId, XpReasons.GuildUsefulReceived, $"guild_useful:{postId}:{userId}", ct);
                await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct);
        }
        return await UsefulStateAsync(postId, userId, ct);
    }

    public async Task<object> UnmarkUsefulAsync(long postId, string userId, CancellationToken ct)
    {
        if (!await db.GuildPosts.AnyAsync(p => p.Id == postId, ct)) throw new RuleException(404, "Mensagem não encontrada.");
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            if (await db.GuildReactions.Where(r => r.PostId == postId && r.UserId == userId).ExecuteDeleteAsync(ct) == 1)
                await db.GuildPosts.Where(p => p.Id == postId && p.UsefulCount > 0).ExecuteUpdateAsync(s => s.SetProperty(p => p.UsefulCount, p => p.UsefulCount - 1), ct);
            await tx.CommitAsync(ct);
        }
        // O XP já concedido permanece (chave idempotente impede ganho repetido ao alternar).
        return await UsefulStateAsync(postId, userId, ct);
    }

    const string HeldEditMessage = "Esta mensagem está em análise pela moderação e não pode ser editada agora.";
    const string DuplicateReportMessage = "Você já denunciou esta mensagem. A moderação vai analisar.";

    async Task<GuildPost?> LockPostAsync(long id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql()
            ? db.GuildPosts.FromSqlInterpolated($"SELECT * FROM \"GuildPosts\" WHERE \"Id\" = {id} FOR UPDATE")
            : db.GuildPosts.Where(p => p.Id == id);
        return await query.SingleOrDefaultAsync(ct);
    }

    /// <summary>Trava tópico e post, sempre nessa ordem (a mesma de <see cref="DeleteOwnAsync"/>), para denúncia e decisão não se cruzarem.</summary>
    async Task<(GuildTopic Topic, GuildPost Post)> LockPostWithTopicAsync(long postId, CancellationToken ct)
    {
        var topicId = await db.GuildPosts.AsNoTracking().Where(p => p.Id == postId).Select(p => (Guid?)p.TopicId).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Mensagem não encontrada.");
        // Entidade já rastreada não é sobrescrita pela consulta, e ExecuteUpdate não a atualiza: recarrega para decidir com o estado gravado.
        var stale = db.ChangeTracker.Entries<GuildTopic>().Any(e => e.Entity.Id == topicId) || db.ChangeTracker.Entries<GuildPost>().Any(e => e.Entity.Id == postId);
        var topic = await LockTopicAsync(topicId, ct) ?? throw new RuleException(404, "Mensagem não encontrada.");
        var post = await LockPostAsync(postId, ct) ?? throw new RuleException(404, "Mensagem não encontrada.");
        if (stale) { await db.Entry(topic).ReloadAsync(ct); await db.Entry(post).ReloadAsync(ct); }
        return (topic, post);
    }

    async Task<bool> IsOpeningAsync(GuildPost post, CancellationToken ct)
    {
        var (topicId, postId) = (post.TopicId, post.Id);
        return !await db.GuildPosts.AnyAsync(p => p.TopicId == topicId && p.Id < postId, ct);
    }

    /// <summary>Denúncia (ADR-068): a primeira já oculta a mensagem até a decisão da moderação; se for a abertura, o tópico inteiro sai das listas.
    /// Não oculta mensagem da equipe nem mensagem que a moderação já manteve (denúncia arquivada depois da última edição): nesses casos só entra na fila.</summary>
    public async Task<object> ReportAsync(long postId, GuildReportInput input, string userId, CancellationToken ct)
    {
        var reason = Reason(input.Reason, 5, 500, "o motivo da denúncia");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (topic, post) = await LockPostWithTopicAsync(postId, ct);
        if (post.DeletedAt != null || topic.DeletedAt != null) throw new RuleException(404, "Mensagem não encontrada.");
        if (post.AuthorId == userId) throw new RuleException(403, "Você não pode denunciar a própria mensagem.");
        if (await db.GuildReports.AnyAsync(r => r.PostId == postId && r.ReporterId == userId, ct))
            throw new RuleException(409, DuplicateReportMessage);
        var report = new GuildReport { PostId = postId, ReporterId = userId, Reason = reason };
        db.GuildReports.Add(report);
        var opening = await IsOpeningAsync(post, ct);
        var authorRole = await db.Users.Where(u => u.Id == post.AuthorId).Select(u => u.Role).SingleOrDefaultAsync(ct) ?? "";
        var keptSince = post.EditedAt ?? post.CreatedAt;
        var keptByModeration = await db.GuildReports.AnyAsync(r => r.PostId == postId && r.Resolution == "dismissed" && r.ResolvedAt > keptSince, ct);
        if (!PlatformRoles.IsStaff(authorRole) && !keptByModeration)
        {
            var now = DateTime.UtcNow;
            post.HeldAt ??= now;
            if (opening && topic.HeldAt is null) { topic.HeldAt = now; topic.Revision++; }
        }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, DuplicateReportMessage); }
        await tx.CommitAsync(ct);
        return new { id = report.Id, hidden = post.HeldAt != null, topicHidden = opening && topic.HeldAt != null };
    }

    /// <summary>Sem denúncia aberta, a mensagem volta a aparecer; se for a abertura, o tópico também. Chamar com tópico e post travados.</summary>
    async Task ReleaseIfSettledAsync(GuildTopic topic, GuildPost post, CancellationToken ct)
    {
        if (post.HeldAt is null && topic.HeldAt is null) return;
        if (await db.GuildReports.AnyAsync(r => r.PostId == post.Id && r.ResolvedAt == null, ct)) return;
        post.HeldAt = null;
        if (topic.HeldAt != null && await IsOpeningAsync(post, ct)) { topic.HeldAt = null; topic.Revision++; }
    }

    // ---------- Moderação (admin + embaixadores) ----------
    async Task RequireStaffAsync(string userId, CancellationToken ct)
    {
        if (!(await ViewerAsync(userId, ct)).Staff) throw new RuleException(403, "Somente a moderação da Guilda pode fazer isso.");
    }

    /// <summary>Denúncias por página (tabela de 20, igual às demais listas); os tópicos seguem com <see cref="PageSize"/>.</summary>
    public const int ReportPageSize = 20;

    /// <summary>Fila da moderação. <paramref name="q"/> busca no motivo, na mensagem e no título do tópico;
    /// <paramref name="resolution"/> (só nas resolvidas) separa arquivadas de removidas.</summary>
    public async Task<object> ReportsAsync(string userId, string? status, int page, CancellationToken ct, string? q = null, string? resolution = null)
    {
        await RequireStaffAsync(userId, ct);
        var open = status is null or "" or "open";
        if (!open && status != "resolved") throw new RuleException(400, "Filtro de denúncias inválido.");
        var query = db.GuildReports.AsNoTracking().Where(r => open ? r.ResolvedAt == null : r.ResolvedAt != null);
        if (TextSearch.Term(q) is { } term)
        {
            var pattern = TextSearch.Pattern(term);
            var posts = db.GuildPosts.Where(TextSearch.AnyField<GuildPost>(db, pattern, p => p.Body)).Select(p => p.Id);
            var topics = db.GuildTopics.Where(TextSearch.AnyField<GuildTopic>(db, pattern, t => t.Title)).Select(t => t.Id);
            var topicPosts = db.GuildPosts.Where(p => topics.Contains(p.TopicId)).Select(p => p.Id);
            query = query.Where(TextSearch.Or(TextSearch.AnyField<GuildReport>(db, pattern, r => r.Reason), r => posts.Contains(r.PostId) || topicPosts.Contains(r.PostId)));
        }
        if (!string.IsNullOrWhiteSpace(resolution))
        {
            if (open || resolution is not ("dismissed" or "removed")) throw new RuleException(400, "Filtro de resultado inválido.");
            query = query.Where(r => r.Resolution == resolution);
        }
        var total = await query.CountAsync(ct);
        page = Math.Clamp(page, 1, Math.Max(1, (total + ReportPageSize - 1) / ReportPageSize));
        var joined = from r in query
                     join p in db.GuildPosts on r.PostId equals p.Id
                     join t in db.GuildTopics on p.TopicId equals t.Id
                     select new { r, p, t };
        var ordered = open ? joined.OrderBy(x => x.r.CreatedAt).ThenBy(x => x.r.Id) : joined.OrderByDescending(x => x.r.ResolvedAt).ThenByDescending(x => x.r.Id);
        var items = await ordered.Skip((page - 1) * ReportPageSize).Take(ReportPageSize)
            .Select(x => new
            {
                x.r.Id,
                x.r.Reason,
                x.r.CreatedAt,
                x.r.ResolvedAt,
                x.r.Resolution,
                resolvedBy = db.Users.Where(u => u.Id == x.r.ResolvedById).Select(u => u.DisplayName).FirstOrDefault(),
                reporter = db.Users.Where(u => u.Id == x.r.ReporterId).Select(u => new { u.Id, name = u.DisplayName }).FirstOrDefault(),
                post = new
                {
                    x.p.Id,
                    excerpt = x.p.Body.Length > 280 ? x.p.Body.Substring(0, 280) : x.p.Body,
                    x.p.CreatedAt,
                    deleted = x.p.DeletedAt != null,
                    held = x.p.HeldAt != null,
                    author = db.Users.Where(u => u.Id == x.p.AuthorId).Select(u => new { u.Id, name = u.DisplayName, role = u.Role, level = u.Level }).FirstOrDefault(),
                    topic = new { x.t.Id, x.t.Title, deleted = x.t.DeletedAt != null, held = x.t.HeldAt != null, x.t.Locked },
                },
                postReports = db.GuildReports.Count(o => o.PostId == x.r.PostId),
                openPostReports = db.GuildReports.Count(o => o.PostId == x.r.PostId && o.ResolvedAt == null),
            }).ToListAsync(ct);
        return new { items, total, page, pageSize = ReportPageSize, status = open ? "open" : "resolved" };
    }

    public async Task<object> ResolveAsync(long reportId, GuildResolveInput input, string userId, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        if (input.Resolution is not ("dismissed" or "removed")) throw new RuleException(400, "Escolha arquivar a denúncia ou remover a mensagem.");
        var note = Reason(input.Note, 3, 500, "a justificativa da decisão");
        var now = DateTime.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var report = await db.GuildReports.AsNoTracking().Where(r => r.Id == reportId).Select(r => new { r.PostId, r.ResolvedAt }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Denúncia não encontrada.");
        var (topic, post) = await LockPostWithTopicAsync(report.PostId, ct);
        // UPDATE condicional: dois moderadores não resolvem a mesma denúncia.
        var resolved = await db.GuildReports.Where(r => r.Id == reportId && r.ResolvedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ResolvedAt, now).SetProperty(r => r.ResolvedById, userId).SetProperty(r => r.Resolution, input.Resolution), ct);
        if (resolved == 0) throw new RuleException(409, "Esta denúncia já foi resolvida por outra pessoa da moderação.");
        var others = 0;
        if (input.Resolution == "removed")
        {
            if (post.DeletedAt is null) { post.DeletedAt = now; post.DeletedById = userId; }
            others = await ResolveOpenReportsAsync(post.Id, userId, now, ct);
            audit.Record(userId, "guild.report.remove", "guild_post", post.Id.ToString(), $"Denúncia #{reportId} procedente: mensagem removida. {note}",
                new { reportId, postId = post.Id, post.TopicId, authorId = post.AuthorId, note, alsoResolved = others, excerpt = Excerpt(post.Body) });
        }
        else
        {
            audit.Record(userId, "guild.report.dismiss", "guild_report", reportId.ToString(), $"Denúncia #{reportId} arquivada. {note}",
                new { reportId, postId = post.Id, post.TopicId, note });
        }
        // Decidida a última denúncia aberta, a ocultação termina: removida fica como "removida pela moderação"; arquivada volta a aparecer.
        await ReleaseIfSettledAsync(topic, post, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { resolution = input.Resolution, alsoResolved = others };
    }

    Task<int> ResolveOpenReportsAsync(long postId, string userId, DateTime now, CancellationToken ct) =>
        db.GuildReports.Where(r => r.PostId == postId && r.ResolvedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ResolvedAt, now).SetProperty(r => r.ResolvedById, userId).SetProperty(r => r.Resolution, "removed"), ct);

    public async Task ModerateDeletePostAsync(long postId, GuildReasonInput input, string userId, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        var reason = Reason(input.Reason);
        var now = DateTime.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (topic, post) = await LockPostWithTopicAsync(postId, ct);
        if (post.DeletedAt != null) throw new RuleException(409, "Esta mensagem já foi removida.");
        post.DeletedAt = now;
        post.DeletedById = userId;
        var resolved = await ResolveOpenReportsAsync(postId, userId, now, ct);
        await ReleaseIfSettledAsync(topic, post, ct);
        audit.Record(userId, "guild.post.delete", "guild_post", postId.ToString(), $"Mensagem removida pela moderação: {reason}",
            new { postId, post.TopicId, authorId = post.AuthorId, reason, resolvedReports = resolved, excerpt = Excerpt(post.Body) });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task ModerateRestorePostAsync(long postId, GuildReasonInput input, string userId, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        var reason = Reason(input.Reason);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var post = await db.GuildPosts.AsNoTracking().Where(p => p.Id == postId).Select(p => new { p.TopicId, p.AuthorId, p.DeletedAt, p.DeletedById }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Mensagem não encontrada.");
        if (post.DeletedAt != null && post.DeletedById == post.AuthorId) throw new RuleException(409, "Mensagens removidas pelo próprio autor não podem ser restauradas.");
        var changed = await db.GuildPosts.Where(p => p.Id == postId && p.DeletedAt != null && p.DeletedById != p.AuthorId)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.DeletedAt, (DateTime?)null).SetProperty(p => p.DeletedById, (string?)null), ct);
        if (changed == 0) throw new RuleException(409, "Esta mensagem não está removida.");
        audit.Record(userId, "guild.post.restore", "guild_post", postId.ToString(), $"Mensagem restaurada pela moderação: {reason}",
            new { postId, post.TopicId, authorId = post.AuthorId, reason, previouslyDeletedById = post.DeletedById });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task<object> ModerateTopicAsync(Guid topicId, GuildTopicModerationInput input, string userId, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        var reason = Reason(input.Reason);
        if (input.Locked is null && input.Pinned is null && input.CategoryId is null && input.Deleted is null)
            throw new RuleException(400, "Nenhuma alteração informada.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var topic = await LockTopicAsync(topicId, ct) ?? throw new RuleException(404, "Tópico não encontrado.");
        if (topic.Revision != input.Revision) throw new RuleException(409, "O tópico mudou desde que você o abriu. Atualize a página e tente de novo.");
        var before = new { topic.Locked, topic.Pinned, topic.CategoryId, deleted = topic.DeletedAt != null };
        var changes = new List<string>();
        if (input.Locked is { } locked && locked != topic.Locked) { topic.Locked = locked; changes.Add(locked ? "trancado" : "destrancado"); }
        if (input.Pinned is { } pinned && pinned != topic.Pinned) { topic.Pinned = pinned; changes.Add(pinned ? "fixado" : "desafixado"); }
        if (input.CategoryId is { } categoryId && categoryId != topic.CategoryId)
        {
            var target = await db.GuildCategories.AsNoTracking().Where(c => c.Id == categoryId && c.ArchivedAt == null).Select(c => c.Name).SingleOrDefaultAsync(ct)
                ?? throw new RuleException(400, "Categoria de destino inválida ou arquivada.");
            topic.CategoryId = categoryId;
            changes.Add($"movido para {target}");
        }
        string action = "guild.topic.update";
        if (input.Deleted is { } deleted && deleted != (topic.DeletedAt != null))
        {
            topic.DeletedAt = deleted ? DateTime.UtcNow : null;
            changes.Add(deleted ? "removido" : "restaurado");
            action = deleted ? "guild.topic.delete" : "guild.topic.restore";
        }
        if (changes.Count == 0) return new { topic.Revision, changed = false };
        topic.Revision++;
        audit.Record(userId, action, "guild_topic", topic.Id.ToString(), $"Tópico \"{topic.Title}\" {string.Join(", ", changes)}: {reason}",
            new { before, after = new { topic.Locked, topic.Pinned, topic.CategoryId, deleted = topic.DeletedAt != null }, reason });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { topic.Revision, changed = true };
    }

    // ---------- Categorias (admin) ----------
    async Task RequireAdminAsync(string userId, CancellationToken ct)
    {
        if (!(await ViewerAsync(userId, ct)).Admin) throw new RuleException(403, "Somente administradores gerenciam categorias.");
    }

    public async Task<object> AdminCategoriesAsync(string userId, CancellationToken ct)
    {
        await RequireAdminAsync(userId, ct);
        return await db.GuildCategories.AsNoTracking().OrderBy(c => c.ArchivedAt != null).ThenBy(c => c.Order).ThenBy(c => c.Name).ThenBy(c => c.Id)
            .Select(c => new
            {
                c.Id, c.Name, c.Slug, c.Description, c.Order, c.MinLevelToPost, c.StaffOnly, archived = c.ArchivedAt != null, c.ArchivedAt,
                topicCount = db.GuildTopics.Count(t => t.CategoryId == c.Id),
            }).ToListAsync(ct);
    }

    static (string Name, string Slug, string Description) ValidateCategory(GuildCategoryInput input)
    {
        var name = CleanLine(input.Name);
        var slug = (input.Slug ?? "").Trim();
        var description = CleanLine(input.Description);
        if (name.Length is < 2 or > 60) throw new RuleException(400, "O nome da categoria deve ter de 2 a 60 caracteres.");
        if (slug.Length is < 2 or > 60 || !SlugPattern().IsMatch(slug)) throw new RuleException(400, "O identificador deve ter de 2 a 60 caracteres: letras minúsculas, números e hífens.");
        if (description.Length > 300) throw new RuleException(400, "A descrição deve ter até 300 caracteres.");
        if (input.Order is < 0 or > 1000) throw new RuleException(400, "A ordem deve estar entre 0 e 1000.");
        if (input.MinLevelToPost is < 1 or > 100) throw new RuleException(400, "O nível mínimo deve estar entre 1 e 100.");
        return (name, slug, description);
    }

    public async Task<object> CreateCategoryAsync(GuildCategoryInput input, string userId, CancellationToken ct)
    {
        await RequireAdminAsync(userId, ct);
        var (name, slug, description) = ValidateCategory(input);
        if (await db.GuildCategories.AnyAsync(c => c.Slug == slug, ct)) throw new RuleException(409, "Já existe uma categoria com esse identificador.");
        var category = new GuildCategory { Name = name, Slug = slug, Description = description, Order = input.Order, MinLevelToPost = input.MinLevelToPost, StaffOnly = input.StaffOnly, ArchivedAt = input.Archived ? DateTime.UtcNow : null };
        db.GuildCategories.Add(category);
        audit.Record(userId, "guild.category.create", "guild_category", category.Id.ToString(), $"Categoria \"{name}\" criada.",
            new { after = new { name, slug, description, input.Order, input.MinLevelToPost, input.StaffOnly, input.Archived } });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "Já existe uma categoria com esse identificador."); }
        return new { id = category.Id };
    }

    public async Task UpdateCategoryAsync(Guid id, GuildCategoryInput input, string userId, CancellationToken ct)
    {
        await RequireAdminAsync(userId, ct);
        var (name, slug, description) = ValidateCategory(input);
        var category = await db.GuildCategories.SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw new RuleException(404, "Categoria não encontrada.");
        if (slug != category.Slug && await db.GuildCategories.AnyAsync(c => c.Slug == slug && c.Id != id, ct)) throw new RuleException(409, "Já existe uma categoria com esse identificador.");
        var before = new { category.Name, category.Slug, category.Description, category.Order, category.MinLevelToPost, category.StaffOnly, archived = category.ArchivedAt != null };
        category.Name = name; category.Slug = slug; category.Description = description; category.Order = input.Order;
        category.MinLevelToPost = input.MinLevelToPost; category.StaffOnly = input.StaffOnly;
        if (input.Archived != (category.ArchivedAt != null)) category.ArchivedAt = input.Archived ? DateTime.UtcNow : null;
        audit.Record(userId, input.Archived && !before.archived ? "guild.category.archive" : "guild.category.update", "guild_category", id.ToString(), $"Categoria \"{name}\" atualizada.",
            new { before, after = new { name, slug, description, input.Order, input.MinLevelToPost, input.StaffOnly, archived = input.Archived } });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "Já existe uma categoria com esse identificador."); }
    }

    public async Task DeleteCategoryAsync(Guid id, string userId, CancellationToken ct)
    {
        await RequireAdminAsync(userId, ct);
        var category = await db.GuildCategories.SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw new RuleException(404, "Categoria não encontrada.");
        if (await db.GuildTopics.AnyAsync(t => t.CategoryId == id, ct)) throw new RuleException(409, "Esta categoria tem tópicos. Arquive-a em vez de excluir.");
        db.GuildCategories.Remove(category);
        audit.Record(userId, "guild.category.delete", "guild_category", id.ToString(), $"Categoria \"{category.Name}\" excluída.",
            new { before = new { category.Name, category.Slug, category.Description, category.Order, category.MinLevelToPost, category.StaffOnly } });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "Esta categoria tem tópicos. Arquive-a em vez de excluir."); }
    }
}
