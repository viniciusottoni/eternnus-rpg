using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Metadados editáveis de um material. <see cref="SystemId"/> nulo = material geral (qualquer sistema).</summary>
public record LibraryMetadata(string? Title, string? Description, string? Category, Guid? SystemId);
public record LibraryUpdateInput(string? Title, string? Description, string? Category, Guid? SystemId, int Revision);
public record LibraryDeleteInput(string? Reason, int? Revision);
public record LibraryRevertInput(long AuditId);

/// <summary>Filtros da listagem. <see cref="SystemId"/> aceita um GUID ou "none" (somente materiais gerais).</summary>
public record LibraryQuery(string? Q, string? SystemId, string? Category, string? Type, int Page = 1, int PageSize = LibraryService.PageSize, bool Deleted = false);

/// <summary>Projeção pública de um material (lista e detalhe). Nunca contém e-mail nem o conteúdo binário.</summary>
public sealed class LibraryItemView
{
    public Guid Id { get; init; }
    public string Title { get; init; } = "";
    public string Description { get; init; } = "";
    public string Category { get; init; } = "";
    public string FileName { get; init; } = "";
    public string ContentType { get; init; } = "";
    public long Size { get; init; }
    public Guid? SystemId { get; init; }
    public string? System { get; init; }
    public string? CreatedBy { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public DateTime? DeletedAt { get; init; }
    public int Revision { get; init; }
    public int Downloads { get; init; }
}

/// <summary>Biblioteca geral: arquivos publicados por admin/embaixador, leitura por usuários verificados.
/// Toda escrita grava a auditoria no mesmo SaveChanges. O admin restaura exclusões e reverte arquivo/metadados
/// ao estado "antes" de uma entrada <c>library.file.replace</c> ou <c>library.update</c> do próprio item.</summary>
public class LibraryService(GameDb db, AuditService audit)
{
    public const int PageSize = 20, MaxPageSize = PageSize, MaxTitle = 120, MaxDescription = 2000, MaxReason = 300, MaxSearch = 100;
    public const string TargetType = "library";
    public const string ActionUpload = "library.upload", ActionUpdate = "library.update", ActionReplace = "library.file.replace",
        ActionDelete = "library.delete", ActionRestore = "library.restore", ActionRevert = "library.revert";
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ---------- Leitura ----------

    public async Task<object> ListAsync(string userId, LibraryQuery query, CancellationToken ct)
    {
        if (query.Deleted && !PlatformRoles.IsStaff(await RoleAsync(userId, ct))) throw new RuleException(403, "Somente a equipe vê materiais excluídos.");
        var page = Math.Clamp(query.Page, 1, 100000);
        var size = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var items = db.Library.AsNoTracking().Where(i => query.Deleted ? i.DeletedAt != null : i.DeletedAt == null);
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = query.Q.Trim();
            if (term.Length > MaxSearch) throw new RuleException(400, "Busca muito longa.");
            items = items.Where(TextSearch.AnyField<LibraryItem>(db, TextSearch.Pattern(term), i => i.Title, i => i.Description));
        }
        if (!string.IsNullOrWhiteSpace(query.SystemId))
        {
            if (query.SystemId == "none") items = items.Where(i => i.RpgSystemId == null);
            else if (Guid.TryParse(query.SystemId, out var systemId)) items = items.Where(i => i.RpgSystemId == systemId);
            else throw new RuleException(400, "Sistema inválido.");
        }
        if (!string.IsNullOrWhiteSpace(query.Category))
        {
            if (!LibraryCategories.All.Contains(query.Category)) throw new RuleException(400, "Categoria inválida.");
            items = items.Where(i => i.Category == query.Category);
        }
        var view = Project(items);
        if (!string.IsNullOrWhiteSpace(query.Type))
        {
            view = query.Type switch
            {
                "pdf" => view.Where(v => v.ContentType == DocumentKinds.Pdf),
                "image" => view.Where(v => v.ContentType == DocumentKinds.Png || v.ContentType == DocumentKinds.Jpeg || v.ContentType == DocumentKinds.WebP),
                _ => throw new RuleException(400, "Tipo inválido."),
            };
        }
        var total = await view.CountAsync(ct);
        var list = await view.OrderByDescending(v => v.UpdatedAt).ThenBy(v => v.Id).Skip((page - 1) * size).Take(size).ToListAsync(ct);
        return new { items = list, total, page, pageSize = size };
    }

    public async Task<LibraryItemView> GetAsync(Guid id, string userId, CancellationToken ct)
    {
        var item = await Project(db.Library.AsNoTracking().Where(i => i.Id == id)).SingleOrDefaultAsync(ct) ?? throw NotFound();
        if (item.DeletedAt != null && !PlatformRoles.IsStaff(await RoleAsync(userId, ct))) throw NotFound();
        return item;
    }

    /// <summary>Arquivo atual do item. Excluídos só para a equipe (revisão antes de restaurar).</summary>
    public async Task<(StoredFile File, string FileName)> FileAsync(Guid id, string userId, CancellationToken ct)
    {
        var row = await db.Library.AsNoTracking().Where(i => i.Id == id).Select(i => new { i.FileId, i.FileName, i.DeletedAt }).SingleOrDefaultAsync(ct) ?? throw NotFound();
        if (row.DeletedAt != null && !PlatformRoles.IsStaff(await RoleAsync(userId, ct))) throw NotFound();
        var file = await db.Files.AsNoTracking().SingleOrDefaultAsync(f => f.Id == row.FileId, ct) ?? throw NotFound();
        return (file, row.FileName);
    }

    /// <summary>Contador de downloads: incremento atômico, sem alterar a revisão (não gera conflito com edições).</summary>
    public async Task MarkDownloadedAsync(Guid id, CancellationToken ct)
    {
        var changed = await db.Library.Where(i => i.Id == id && i.DeletedAt == null).ExecuteUpdateAsync(s => s.SetProperty(i => i.Downloads, i => i.Downloads + 1), ct);
        if (changed == 0) throw NotFound();
    }

    public async Task<object> HistoryAsync(Guid id, string userId, int page, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        if (!await db.Library.AnyAsync(i => i.Id == id, ct)) throw NotFound();
        page = Math.Clamp(page, 1, 100000);
        var target = id.ToString();
        var entries = db.Audit.AsNoTracking().Where(a => a.TargetType == TargetType && a.TargetId == target);
        var total = await entries.CountAsync(ct);
        var items = await (from a in entries
                           join u in db.Users on a.ActorId equals u.Id into uj
                           from u in uj.DefaultIfEmpty()
                           orderby a.Id descending
                           select new
                           {
                               a.Id,
                               a.Action,
                               actor = u == null ? "Conta removida" : u.DisplayName,
                               a.CreatedAt,
                               a.Summary,
                               revertible = a.Action == ActionReplace || a.Action == ActionUpdate,
                           }).Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(ct);
        return new { items, total, page, pageSize = PageSize };
    }

    // ---------- Escrita da equipe (publica direto, sempre auditado) ----------

    public async Task<LibraryItemView> CreateAsync(string userId, LibraryMetadata input, UploadedDocument document, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        var meta = await ValidateAsync(input, null, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (file, reused) = await StoreAsync(document, userId, ct);
        var now = DateTime.UtcNow;
        var item = new LibraryItem
        {
            Title = meta.Title, Description = meta.Description, Category = meta.Category, RpgSystemId = meta.SystemId,
            FileName = document.FileName, FileId = file.Id, CreatedById = userId, UpdatedById = userId, CreatedAt = now, UpdatedAt = now,
        };
        db.Library.Add(item);
        audit.Record(userId, ActionUpload, TargetType, item.Id.ToString(), $"Publicou \"{meta.Title}\" ({document.FileName}).",
            new { title = meta.Title, category = meta.Category, systemId = meta.SystemId, fileId = file.Id, fileName = document.FileName, file.Size, file.ContentType, deduplicated = reused });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(item.Id, userId, ct);
    }

    public async Task<LibraryItemView> UpdateAsync(Guid id, string userId, LibraryUpdateInput input, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var item = await LockAsync(id, ct);
        if (item.DeletedAt != null) throw new RuleException(409, "Este material foi excluído. Restaure-o antes de editar.");
        if (item.Revision != input.Revision) throw Stale();
        var meta = await ValidateAsync(new LibraryMetadata(input.Title, input.Description, input.Category, input.SystemId), item.RpgSystemId, ct);
        var before = Snapshot(item);
        item.Title = meta.Title; item.Description = meta.Description; item.Category = meta.Category; item.RpgSystemId = meta.SystemId;
        Touch(item, userId);
        audit.Record(userId, ActionUpdate, TargetType, id.ToString(), $"Editou os dados de \"{meta.Title}\".", new { before, after = Snapshot(item) });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(id, userId, ct);
    }

    /// <summary>Substitui o arquivo. O <see cref="StoredFile"/> anterior é mantido para o histórico e para a reversão.</summary>
    public async Task<LibraryItemView> ReplaceFileAsync(Guid id, string userId, int? revision, UploadedDocument document, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var item = await LockAsync(id, ct);
        if (item.DeletedAt != null) throw new RuleException(409, "Este material foi excluído. Restaure-o antes de substituir o arquivo.");
        if (revision is { } r && item.Revision != r) throw Stale();
        var (file, reused) = await StoreAsync(document, userId, ct);
        var previousFileId = item.FileId;
        var previousFileName = item.FileName;
        item.FileId = file.Id; item.FileName = document.FileName;
        Touch(item, userId);
        audit.Record(userId, ActionReplace, TargetType, id.ToString(), $"Substituiu o arquivo de \"{item.Title}\": {previousFileName} → {document.FileName}.",
            new { previousFileId, previousFileName, newFileId = file.Id, newFileName = document.FileName, file.Size, file.ContentType, deduplicated = reused });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(id, userId, ct);
    }

    public async Task DeleteAsync(Guid id, string userId, LibraryDeleteInput? input, CancellationToken ct)
    {
        await RequireStaffAsync(userId, ct);
        var reason = Clean(input?.Reason ?? "", multiline: false);
        if (reason.Length > MaxReason) throw new RuleException(400, $"O motivo deve ter até {MaxReason} caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var item = await LockAsync(id, ct);
        if (item.DeletedAt != null) throw new RuleException(409, "Este material já foi excluído.");
        if (input?.Revision is { } r && item.Revision != r) throw Stale();
        item.DeletedAt = DateTime.UtcNow;
        Touch(item, userId);
        audit.Record(userId, ActionDelete, TargetType, id.ToString(), $"Excluiu \"{item.Title}\"" + (reason.Length > 0 ? $": {reason}" : "."), new { reason, title = item.Title });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ---------- Admin: restaurar e reverter ----------

    public async Task<LibraryItemView> RestoreAsync(Guid id, string userId, CancellationToken ct)
    {
        await RequireAdminAsync(userId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var item = await LockAsync(id, ct);
        if (item.DeletedAt == null) throw new RuleException(409, "Este material não está excluído.");
        var deletedAt = item.DeletedAt;
        item.DeletedAt = null;
        Touch(item, userId);
        audit.Record(userId, ActionRestore, TargetType, id.ToString(), $"Restaurou \"{item.Title}\".", new { deletedAt });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(id, userId, ct);
    }

    /// <summary>Volta o item ao "antes" de uma entrada de auditoria do PRÓPRIO item (substituição de arquivo ou edição de dados).</summary>
    public async Task<LibraryItemView> RevertAsync(Guid id, string userId, long auditId, CancellationToken ct)
    {
        await RequireAdminAsync(userId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var item = await LockAsync(id, ct);
        var target = id.ToString();
        var entry = await db.Audit.AsNoTracking().SingleOrDefaultAsync(a => a.Id == auditId && a.TargetType == TargetType && a.TargetId == target, ct)
            ?? throw new RuleException(404, "Registro de histórico não encontrado para este material.");
        if (entry.Action is not (ActionReplace or ActionUpdate)) throw new RuleException(400, "Somente substituições de arquivo e edições de dados podem ser revertidas.");
        if (item.DeletedAt != null) throw new RuleException(409, "Restaure o material antes de reverter.");
        using var data = ParseData(entry.Data);
        var root = data.RootElement;
        object change;
        if (entry.Action == ActionReplace)
        {
            if (!root.TryGetProperty("previousFileId", out var fileProp) || !fileProp.TryGetGuid(out var previousFileId)
                || !root.TryGetProperty("previousFileName", out var nameProp) || nameProp.GetString() is not { Length: > 0 and <= 160 } previousFileName)
                throw Corrupt();
            if (!await db.Files.AnyAsync(f => f.Id == previousFileId, ct)) throw new RuleException(409, "O arquivo anterior não está mais disponível.");
            change = new { kind = "file", before = new { fileId = item.FileId, fileName = item.FileName }, after = new { fileId = previousFileId, fileName = previousFileName } };
            item.FileId = previousFileId; item.FileName = previousFileName;
        }
        else
        {
            if (!root.TryGetProperty("before", out var before) || before.ValueKind != JsonValueKind.Object) throw Corrupt();
            LibrarySnapshot snapshot;
            try { snapshot = before.Deserialize<LibrarySnapshot>(Json) ?? throw Corrupt(); }
            catch (JsonException) { throw Corrupt(); }
            var meta = await ValidateAsync(new LibraryMetadata(snapshot.Title, snapshot.Description, snapshot.Category, snapshot.SystemId), item.RpgSystemId, ct);
            var current = Snapshot(item);
            item.Title = meta.Title; item.Description = meta.Description; item.Category = meta.Category; item.RpgSystemId = meta.SystemId;
            change = new { kind = "metadata", before = current, after = Snapshot(item) };
        }
        Touch(item, userId);
        audit.Record(userId, ActionRevert, TargetType, target, $"Reverteu \"{item.Title}\" ao estado anterior ao registro #{entry.Id} ({(entry.Action == ActionReplace ? "arquivo" : "dados")}).",
            new { auditId = entry.Id, revertedAction = entry.Action, change });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await GetAsync(id, userId, ct);
    }

    // ---------- Regras puras e apoio ----------

    public sealed record LibrarySnapshot(string Title, string Description, string Category, Guid? SystemId);
    public sealed record ValidMetadata(string Title, string Description, string Category, Guid? SystemId);

    /// <summary>Validação pura dos metadados (sem consultar o banco). Lança 400 com mensagem pt-BR.</summary>
    public static ValidMetadata ValidateFields(LibraryMetadata input)
    {
        var title = Clean(input.Title ?? "", multiline: false);
        var description = Clean(input.Description ?? "", multiline: true);
        if (title.Length is 0 or > MaxTitle) throw new RuleException(400, $"O título é obrigatório e deve ter até {MaxTitle} caracteres.");
        if (description.Length > MaxDescription) throw new RuleException(400, $"A descrição deve ter até {MaxDescription} caracteres.");
        if (input.Category is null || !LibraryCategories.All.Contains(input.Category)) throw new RuleException(400, "Escolha uma categoria válida.");
        return new ValidMetadata(title, description, input.Category, input.SystemId);
    }

    /// <summary>Remove caracteres de controle (preservando quebras de linha na descrição) e espaços nas pontas.</summary>
    public static string Clean(string value, bool multiline)
    {
        var chars = value.Replace("\r\n", "\n").Where(c => !char.IsControl(c) || (multiline && (c == '\n' || c == '\t'))).ToArray();
        return new string(chars).Trim();
    }

    async Task<ValidMetadata> ValidateAsync(LibraryMetadata input, Guid? currentSystemId, CancellationToken ct)
    {
        var meta = ValidateFields(input);
        // O sistema precisa existir; um item pode manter um sistema que foi desativado depois.
        if (meta.SystemId is { } systemId && systemId != currentSystemId && !await db.RpgSystems.AnyAsync(s => s.Id == systemId, ct))
            throw new RuleException(400, "Sistema de RPG não encontrado.");
        return meta;
    }

    /// <summary>Deduplicação: se já existe um arquivo com o mesmo SHA-256, tamanho e tipo, o registro é reaproveitado
    /// (arquivos são imutáveis; nenhum fluxo altera ou apaga um <see cref="StoredFile"/>).</summary>
    async Task<(StoredFile File, bool Reused)> StoreAsync(UploadedDocument document, string userId, CancellationToken ct)
    {
        var size = document.Content.LongLength;
        var existing = await db.Files.AsNoTracking().Where(f => f.Sha256 == document.Sha256 && f.Size == size && f.ContentType == document.ContentType)
            .Select(f => new StoredFile { Id = f.Id, Size = f.Size, ContentType = f.ContentType, Sha256 = f.Sha256 }).FirstOrDefaultAsync(ct);
        if (existing != null) return (existing, true);
        var file = document.ToStoredFile(userId);
        db.Files.Add(file);
        return (file, false);
    }

    async Task<LibraryItem> LockAsync(Guid id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql() ? db.Library.FromSqlInterpolated($"SELECT * FROM \"Library\" WHERE \"Id\" = {id} FOR UPDATE") : db.Library.Where(i => i.Id == id);
        return await query.SingleOrDefaultAsync(ct) ?? throw NotFound();
    }

    IQueryable<LibraryItemView> Project(IQueryable<LibraryItem> items) =>
        from i in items
        join f in db.Files on i.FileId equals f.Id
        join s in db.RpgSystems on i.RpgSystemId equals s.Id into sj
        from s in sj.DefaultIfEmpty()
        join u in db.Users on i.CreatedById equals u.Id into uj
        from u in uj.DefaultIfEmpty()
        select new LibraryItemView
        {
            Id = i.Id, Title = i.Title, Description = i.Description, Category = i.Category, FileName = i.FileName,
            ContentType = f.ContentType, Size = f.Size, SystemId = i.RpgSystemId, System = s == null ? null : s.Name,
            CreatedBy = u == null ? null : u.DisplayName, CreatedAt = i.CreatedAt, UpdatedAt = i.UpdatedAt, DeletedAt = i.DeletedAt,
            Revision = i.Revision, Downloads = i.Downloads,
        };

    static LibrarySnapshot Snapshot(LibraryItem item) => new(item.Title, item.Description, item.Category, item.RpgSystemId);
    static void Touch(LibraryItem item, string userId) { item.UpdatedAt = DateTime.UtcNow; item.UpdatedById = userId; item.Revision++; }
    static JsonDocument ParseData(string data)
    {
        try { return JsonDocument.Parse(string.IsNullOrEmpty(data) ? "{}" : data); }
        catch (JsonException) { throw Corrupt(); }
    }
    /// <summary>Mesma regra de <see cref="PlatformAccess.RoleAsync"/> (verificado e não bloqueado), avaliando o bloqueio
    /// em memória para também funcionar no SQLite dos testes (que não compara DateTimeOffset em SQL).</summary>
    async Task<string?> RoleAsync(string userId, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.Role, u.EmailConfirmed, u.LockoutEnd }).SingleOrDefaultAsync(ct);
        return user is { EmailConfirmed: true } && (user.LockoutEnd == null || user.LockoutEnd < DateTimeOffset.UtcNow) ? user.Role : null;
    }
    async Task RequireStaffAsync(string userId, CancellationToken ct)
    {
        if (!PlatformRoles.IsStaff(await RoleAsync(userId, ct))) throw new RuleException(403, "Somente administradores e embaixadores alteram a biblioteca.");
    }
    async Task RequireAdminAsync(string userId, CancellationToken ct)
    {
        if (await RoleAsync(userId, ct) != PlatformRoles.Admin) throw new RuleException(403, "Somente administradores restauram ou revertem materiais.");
    }
    static RuleException NotFound() => new(404, "Material não encontrado.");
    static RuleException Stale() => new(409, "O material mudou em outra sessão. Atualize e tente novamente.");
    static RuleException Corrupt() => new(409, "Este registro de histórico não tem dados suficientes para reverter.");
}
