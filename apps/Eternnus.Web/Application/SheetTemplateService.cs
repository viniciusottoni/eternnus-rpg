using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record SheetTemplateCreateInput(Guid SystemId, string? Name, string? Description);
public record SheetTemplateUpdateInput(string? Name, string? Description, bool IsDefault, bool Archived, int Revision);
public record SheetVersionCreateInput(Guid? FromVersionId);
public record SheetVersionUpdateInput(List<SheetPage>? Pages, List<SheetField>? Fields, List<SheetActionDefinition>? Actions, string? Notes, int Revision);
public record SheetVersionRevisionInput(int Revision);

/// <summary>Problema de validação de uma versão. <see cref="Field"/>/<see cref="Action"/> apontam o item (para a interface selecionar).</summary>
public sealed record SheetIssue(string? Field, string? Action, string Message);

/// <summary>Validação de versão recusada: vira 400 <c>{ message, errors: [{ field, action, message }] }</c>.</summary>
public sealed class SheetValidationException(IReadOnlyList<SheetIssue> errors, string message) : RuleException(400, message)
{
    public IReadOnlyList<SheetIssue> Errors { get; } = errors;
}

public sealed record SheetFieldDiff(string Name, IReadOnlyList<string> Changes);
/// <summary>Diferenças entre duas versões, casando campos por NOME (a migração das fichas usa a mesma regra) e ações por chave.</summary>
public sealed record SheetVersionDiff(
    int? FromNumber,
    IReadOnlyList<string> Added,
    IReadOnlyList<string> Removed,
    IReadOnlyList<SheetFieldDiff> Changed,
    IReadOnlyList<string> Moved,
    IReadOnlyList<string> ActionsAdded,
    IReadOnlyList<string> ActionsRemoved,
    IReadOnlyList<string> ActionsChanged,
    bool PdfChanged,
    int PagesBefore,
    int PagesAfter);

public static class SheetTemplateLimits
{
    public const int MaxPages = 50, MaxFields = 300, MaxActions = 100, MaxOptions = 50, MaxOptionLength = 80, MaxNotes = 1000;
    public const int MaxTemplateName = 100, MaxTemplateDescription = 2000, MaxTextLength = 10000;
    public const double MinPageSize = 50, MaxPageSize = 5000, MinFontSize = 4, MaxFontSize = 72;
    /// <summary>Menor lado de um campo, em fração da página (≈ 2,4 pt numa A4).</summary>
    public const double MinFieldSize = 0.004;
    public const double A4Width = 595.28, A4Height = 841.89;
    public static readonly string[] Aligns = ["left", "center", "right"];
}

/// <summary>Fichas-modelo: modelos por sistema, versões (rascunho/publicada), PDF de fundo e campos.
/// Escritas exigem equipe (política Staff no endpoint) e são auditadas na mesma gravação. Uma versão publicada é imutável;
/// cada modelo tem no máximo um rascunho e cada sistema no máximo um modelo padrão.</summary>
public class SheetTemplateService(GameDb db, AuditService audit)
{
    internal static readonly Regex NamePattern = new("^[a-z][a-z0-9_]{0,39}$", RegexOptions.CultureInvariant);
    const int PageSize = 20;

    /// <summary>Validação completa usada ao publicar. Substituível em testes unitários que não dependem da linguagem de fórmulas.</summary>
    public Func<SheetTemplateVersion, IReadOnlyList<SheetIssue>> PublishValidator { get; set; } = ValidateForPublish;

    // ---------------- Leitura ----------------

    /// <summary>Modelos utilizáveis (com versão publicada e não arquivados), opcionalmente de um sistema.</summary>
    public async Task<object> ListPublishedAsync(Guid? systemId, CancellationToken ct)
    {
        var query = db.SheetTemplates.AsNoTracking().Where(t => t.ArchivedAt == null && t.CurrentVersionId != null);
        if (systemId is { } sid) query = query.Where(t => t.RpgSystemId == sid);
        return await query
            .OrderByDescending(t => t.RpgSystemId == RpgSystem.FreeSystemId).ThenByDescending(t => t.IsDefault).ThenBy(t => t.Name).ThenBy(t => t.Id)
            .Take(100)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Description,
                systemId = t.RpgSystemId,
                system = db.RpgSystems.Where(s => s.Id == t.RpgSystemId).Select(s => s.Name).FirstOrDefault(),
                t.IsDefault,
                currentVersion = db.SheetTemplateVersions.Where(v => v.Id == t.CurrentVersionId).Select(v => new { v.Id, v.Number, v.PublishedAt }).FirstOrDefault(),
            }).ToListAsync(ct);
    }

    /// <summary>Detalhe do modelo. Comum: só modelos com versão publicada. Equipe: inclui rascunho, arquivados e versões com contagem de fichas.</summary>
    public async Task<object> GetAsync(Guid id, string user, CancellationToken ct)
    {
        var staff = await IsStaffAsync(user, ct);
        var t = await db.SheetTemplates.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        if (t is null || (!staff && t.CurrentVersionId is null)) throw NotFound();
        var system = await db.RpgSystems.AsNoTracking().Where(s => s.Id == t.RpgSystemId).Select(s => s.Name).SingleAsync(ct);
        var current = t.CurrentVersionId is null ? null : await db.SheetTemplateVersions.AsNoTracking().Where(v => v.Id == t.CurrentVersionId)
            .Select(v => new { v.Id, v.Number, v.PublishedAt }).SingleOrDefaultAsync(ct);
        if (!staff)
            return new { t.Id, t.Name, t.Description, systemId = t.RpgSystemId, system, t.IsDefault, archived = t.ArchivedAt != null, currentVersion = current };
        var versions = await db.SheetTemplateVersions.AsNoTracking().Where(v => v.TemplateId == id)
            .OrderByDescending(v => v.PublishedAt == null).ThenByDescending(v => v.Number).Take(200)
            .Select(v => new
            {
                v.Id,
                v.Number,
                v.CreatedAt,
                v.PublishedAt,
                publishedBy = db.Users.Where(u => u.Id == v.PublishedById).Select(u => u.DisplayName).FirstOrDefault(),
                isDraft = v.PublishedAt == null,
                isCurrent = v.Id == t.CurrentVersionId,
                hasPdf = v.PdfFileId != null,
                v.Notes,
                characters = db.Characters.Count(c => c.TemplateVersionId == v.Id),
            }).ToListAsync(ct);
        return new
        {
            t.Id,
            t.Name,
            t.Description,
            systemId = t.RpgSystemId,
            system,
            t.IsDefault,
            archived = t.ArchivedAt != null,
            isFree = t.Id == SheetTemplate.FreeTemplateId,
            t.Revision,
            t.UpdatedAt,
            currentVersion = current,
            draftId = versions.Where(v => v.isDraft).Select(v => (Guid?)v.Id).FirstOrDefault(),
            versions,
        };
    }

    /// <summary>Versão com páginas, campos e ações. Rascunho só para a equipe (senão 404).</summary>
    public async Task<object> GetVersionAsync(Guid id, Guid versionId, string user, CancellationToken ct)
    {
        var v = await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == versionId && x.TemplateId == id, ct) ?? throw NotFound();
        if (v.PublishedAt is null && !await IsStaffAsync(user, ct)) throw NotFound();
        return VersionView(v);
    }

    public async Task<StoredFile> GetPdfAsync(Guid id, Guid versionId, string user, CancellationToken ct)
    {
        var v = await db.SheetTemplateVersions.AsNoTracking().Where(x => x.Id == versionId && x.TemplateId == id)
            .Select(x => new { x.PdfFileId, x.PublishedAt }).SingleOrDefaultAsync(ct) ?? throw NotFound();
        if (v.PublishedAt is null && !await IsStaffAsync(user, ct)) throw NotFound();
        if (v.PdfFileId is null) throw new RuleException(404, "Esta versão não tem PDF de fundo.");
        return await db.Files.AsNoTracking().SingleOrDefaultAsync(f => f.Id == v.PdfFileId, ct) ?? throw NotFound();
    }

    static object VersionView(SheetTemplateVersion v) => new
    {
        v.Id,
        v.TemplateId,
        v.Number,
        v.CreatedAt,
        v.PublishedAt,
        isDraft = v.PublishedAt == null,
        hasPdf = v.PdfFileId != null,
        v.Pages,
        v.Fields,
        v.Actions,
        v.Notes,
        v.Revision,
    };

    // ---------------- Equipe ----------------

    /// <summary>Lista de gestão (equipe): inclui rascunhos e arquivados, com contagem de fichas por versão (últimas 10 versões por modelo).</summary>
    public async Task<object> ManageAsync(Guid? systemId, bool archived, int page, CancellationToken ct)
    {
        page = Math.Clamp(page, 1, 100000);
        var query = db.SheetTemplates.AsNoTracking().Where(t => archived ? t.ArchivedAt != null : t.ArchivedAt == null);
        if (systemId is { } sid) query = query.Where(t => t.RpgSystemId == sid);
        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(t => t.RpgSystemId == RpgSystem.FreeSystemId).ThenBy(t => t.RpgSystemId).ThenByDescending(t => t.IsDefault).ThenBy(t => t.Name).ThenBy(t => t.Id)
            .Skip((page - 1) * PageSize).Take(PageSize)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Description,
                systemId = t.RpgSystemId,
                system = db.RpgSystems.Where(s => s.Id == t.RpgSystemId).Select(s => s.Name).FirstOrDefault(),
                t.IsDefault,
                archived = t.ArchivedAt != null,
                isFree = t.Id == SheetTemplate.FreeTemplateId,
                t.Revision,
                t.UpdatedAt,
                t.CurrentVersionId,
            }).ToListAsync(ct);
        var ids = items.Select(i => i.Id).ToList();
        var versions = await db.SheetTemplateVersions.AsNoTracking().Where(v => ids.Contains(v.TemplateId))
            .Select(v => new { v.Id, v.TemplateId, v.Number, v.PublishedAt, hasPdf = v.PdfFileId != null, characters = db.Characters.Count(c => c.TemplateVersionId == v.Id) })
            .ToListAsync(ct);
        return new
        {
            items = items.Select(t =>
            {
                var mine = versions.Where(v => v.TemplateId == t.Id).OrderByDescending(v => v.PublishedAt == null).ThenByDescending(v => v.Number).ToList();
                var current = mine.FirstOrDefault(v => v.Id == t.CurrentVersionId);
                var draft = mine.FirstOrDefault(v => v.PublishedAt == null);
                return new
                {
                    t.Id,
                    t.Name,
                    t.Description,
                    t.systemId,
                    t.system,
                    t.IsDefault,
                    t.archived,
                    t.isFree,
                    t.Revision,
                    t.UpdatedAt,
                    currentVersion = current is null ? null : new { current.Id, current.Number, current.PublishedAt },
                    draft = draft is null ? null : new { draft.Id, draft.Number },
                    versionCount = mine.Count,
                    characterCount = mine.Sum(v => v.characters),
                    versions = mine.Take(10).Select(v => new { v.Id, v.Number, v.PublishedAt, isDraft = v.PublishedAt == null, v.hasPdf, v.characters }),
                };
            }),
            total,
            page,
            pageSize = PageSize,
        };
    }

    public async Task<object> CreateAsync(SheetTemplateCreateInput x, string user, CancellationToken ct)
    {
        var (name, description) = ValidateTemplateText(x.Name, x.Description);
        if (!await db.RpgSystems.AnyAsync(s => s.Id == x.SystemId && s.Active, ct)) throw new RuleException(400, "Escolha um sistema de RPG ativo.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockSystemAsync(x.SystemId, ct);
        if (await db.SheetTemplates.AnyAsync(t => t.RpgSystemId == x.SystemId && t.Name == name, ct)) throw DuplicateName();
        var t = new SheetTemplate { RpgSystemId = x.SystemId, Name = name, Description = description, CreatedById = user };
        var v = new SheetTemplateVersion { TemplateId = t.Id, Number = 1, Pages = [new SheetPage { Index = 0, Width = SheetTemplateLimits.A4Width, Height = SheetTemplateLimits.A4Height }] };
        db.SheetTemplates.Add(t);
        db.SheetTemplateVersions.Add(v);
        audit.Record(user, "template.create", "sheet-template", t.Id.ToString(), $"Criou a ficha-modelo \"{name}\".", new { after = new { name, description, systemId = x.SystemId }, draftVersionId = v.Id });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { t.Id, draftId = v.Id, t.Revision };
    }

    public async Task<object> UpdateAsync(Guid id, SheetTemplateUpdateInput x, string user, CancellationToken ct)
    {
        var (name, description) = ValidateTemplateText(x.Name, x.Description);
        if (x.IsDefault && x.Archived) throw new RuleException(400, "Um modelo arquivado não pode ser o padrão do sistema.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var systemId = await db.SheetTemplates.Where(t => t.Id == id).Select(t => (Guid?)t.RpgSystemId).SingleOrDefaultAsync(ct) ?? throw NotFound();
        // Bloquear o sistema serializa a troca de padrão entre modelos do mesmo sistema.
        await LockSystemAsync(systemId, ct);
        var t = await LockTemplateAsync(id, ct);
        if (t.Revision != x.Revision) throw Stale();
        var before = new { t.Name, t.Description, t.IsDefault, archived = t.ArchivedAt != null };
        if (x.Archived && t.Id == SheetTemplate.FreeTemplateId) throw new RuleException(409, "O modelo do Sistema livre não pode ser arquivado.");
        if (x.Archived && t.IsDefault) throw new RuleException(409, "Este é o modelo padrão do sistema. Defina outro modelo como padrão antes de arquivá-lo.");
        if (!x.IsDefault && t.IsDefault) throw new RuleException(409, "Para trocar o modelo padrão, marque outro modelo deste sistema como padrão.");
        if (x.IsDefault && !t.IsDefault && t.CurrentVersionId is null) throw new RuleException(409, "Publique uma versão antes de tornar este modelo o padrão do sistema.");
        if (name != t.Name && await db.SheetTemplates.AnyAsync(o => o.RpgSystemId == t.RpgSystemId && o.Name == name && o.Id != t.Id, ct)) throw DuplicateName();
        if (x.IsDefault && !t.IsDefault)
        {
            var others = await db.SheetTemplates.Where(o => o.RpgSystemId == t.RpgSystemId && o.IsDefault && o.Id != t.Id).ToListAsync(ct);
            foreach (var o in others) { o.IsDefault = false; o.Revision++; o.UpdatedAt = DateTime.UtcNow; }
        }
        t.Name = name;
        t.Description = description;
        t.IsDefault = x.IsDefault;
        t.ArchivedAt = x.Archived ? t.ArchivedAt ?? DateTime.UtcNow : null;
        t.Revision++;
        t.UpdatedAt = DateTime.UtcNow;
        audit.Record(user, "template.update", "sheet-template", t.Id.ToString(), $"Atualizou a ficha-modelo \"{name}\".",
            new { before, after = new { t.Name, t.Description, t.IsDefault, archived = t.ArchivedAt != null } });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { t.Id, t.Revision, t.IsDefault, archived = t.ArchivedAt != null };
    }

    /// <summary>Cria o rascunho (no máximo um por modelo) clonando a versão indicada ou a atual publicada.</summary>
    public async Task<object> CreateVersionAsync(Guid id, SheetVersionCreateInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        if (await db.SheetTemplateVersions.AnyAsync(v => v.TemplateId == id && v.PublishedAt == null, ct))
            throw new RuleException(409, "Este modelo já tem um rascunho. Edite-o ou descarte-o antes de criar outro.");
        var sourceId = x?.FromVersionId ?? t.CurrentVersionId;
        SheetTemplateVersion? source = null;
        if (sourceId is { } sid)
            source = await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(v => v.Id == sid && v.TemplateId == id, ct) ?? throw new RuleException(404, "Versão de origem não encontrada.");
        var number = (await db.SheetTemplateVersions.Where(v => v.TemplateId == id).MaxAsync(v => (int?)v.Number, ct) ?? 0) + 1;
        var draft = new SheetTemplateVersion
        {
            TemplateId = id,
            Number = number,
            PdfFileId = source?.PdfFileId,
            Pages = source is null ? [new SheetPage { Index = 0, Width = SheetTemplateLimits.A4Width, Height = SheetTemplateLimits.A4Height }] : source.Pages.Select(ClonePage).ToList(),
            Fields = source?.Fields.Select(CloneField).ToList() ?? [],
            Actions = source?.Actions.Select(CloneAction).ToList() ?? [],
        };
        db.SheetTemplateVersions.Add(draft);
        t.UpdatedAt = DateTime.UtcNow;
        audit.Record(user, "template.version.create", "sheet-template", id.ToString(), $"Criou o rascunho v{number} da ficha-modelo \"{t.Name}\".",
            new { versionId = draft.Id, number, fromVersion = source?.Number, fields = draft.Fields.Count, actions = draft.Actions.Count });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return VersionView(draft);
    }

    /// <summary>Salva páginas, campos e ações do rascunho. Valida limites estruturais; fórmulas são validadas ao publicar.</summary>
    public async Task<object> UpdateVersionAsync(Guid id, Guid versionId, SheetVersionUpdateInput x, string user, CancellationToken ct)
    {
        var pages = (x.Pages ?? []).Select(ClonePage).ToList();
        var fields = (x.Fields ?? []).Select(NormalizeField).ToList();
        var actions = (x.Actions ?? []).Select(NormalizeAction).ToList();
        var notes = (x.Notes ?? "").Trim();
        var issues = StructureIssues(pages, fields, actions, notes);
        if (issues.Count > 0) throw new SheetValidationException(issues, Summary(issues, "Corrija a estrutura da ficha antes de salvar"));
        for (var i = 0; i < pages.Count; i++) pages[i].Index = i;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        var v = await DraftAsync(id, versionId, ct);
        if (v.Revision != x.Revision) throw Stale();
        var before = new { fields = v.Fields.Count, actions = v.Actions.Count, pages = v.Pages.Count };
        v.Pages = pages;
        v.Fields = fields;
        v.Actions = actions;
        v.Notes = notes;
        v.Revision++;
        t.UpdatedAt = DateTime.UtcNow;
        audit.Record(user, "template.version.update", "sheet-template", id.ToString(),
            $"Editou o rascunho v{v.Number} de \"{t.Name}\": campos {before.fields} → {fields.Count}, ações {before.actions} → {actions.Count}.",
            new { versionId, number = v.Number, before, after = new { fields = fields.Count, actions = actions.Count, pages = pages.Count } });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { v.Id, v.Revision };
    }

    /// <summary>Troca o PDF de fundo do rascunho. <paramref name="pages"/> vem do cliente (pdf.js) e passa por conferência básica.</summary>
    public async Task<object> UploadPdfAsync(Guid id, Guid versionId, UploadedDocument document, string? pagesJson, int revision, string user, CancellationToken ct)
    {
        var pages = ParsePages(pagesJson);
        if (!LooksComplete(document.Content)) throw new RuleException(400, "O PDF parece incompleto ou corrompido. Exporte-o novamente.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        var v = await DraftAsync(id, versionId, ct);
        if (v.Revision != revision) throw Stale();
        var previous = v.PdfFileId;
        var file = document.ToStoredFile(user);
        db.Files.Add(file);
        v.PdfFileId = file.Id;
        var beforePages = v.Pages.Count;
        v.Pages = pages;
        v.Revision++;
        t.UpdatedAt = DateTime.UtcNow;
        audit.Record(user, "template.pdf.upload", "sheet-template", id.ToString(), $"Enviou o PDF de fundo do rascunho v{v.Number} de \"{t.Name}\" ({pages.Count} pág.).",
            new { versionId, number = v.Number, size = file.Size, sha256 = file.Sha256, fileName = document.FileName, pagesBefore = beforePages, pagesAfter = pages.Count, replaced = previous != null });
        await db.SaveChangesAsync(ct);
        await RemoveOrphanFileAsync(previous, ct);
        await tx.CommitAsync(ct);
        return new { v.Id, v.Revision, v.Pages, hasPdf = true };
    }

    public async Task<object> DeletePdfAsync(Guid id, Guid versionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        var v = await DraftAsync(id, versionId, ct);
        var previous = v.PdfFileId;
        if (previous is null) throw new RuleException(404, "Este rascunho não tem PDF de fundo.");
        v.PdfFileId = null;
        v.Revision++;
        t.UpdatedAt = DateTime.UtcNow;
        audit.Record(user, "template.pdf.delete", "sheet-template", id.ToString(), $"Removeu o PDF de fundo do rascunho v{v.Number} de \"{t.Name}\".", new { versionId, number = v.Number });
        await db.SaveChangesAsync(ct);
        await RemoveOrphanFileAsync(previous, ct);
        await tx.CommitAsync(ct);
        return new { v.Id, v.Revision, v.Pages, hasPdf = false };
    }

    /// <summary>Publica o rascunho: validação completa (estrutura + fórmulas), número sequencial, versão atual do modelo e diferenças.</summary>
    public async Task<object> PublishAsync(Guid id, Guid versionId, int revision, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        var v = await DraftAsync(id, versionId, ct);
        if (v.Revision != revision) throw Stale();
        var issues = PublishValidator(v);
        if (issues.Count > 0) throw new SheetValidationException(issues, Summary(issues, "A ficha ainda tem problemas"));
        var previous = t.CurrentVersionId is { } cid ? await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == cid, ct) : null;
        var number = (await db.SheetTemplateVersions.Where(x => x.TemplateId == id && x.PublishedAt != null).MaxAsync(x => (int?)x.Number, ct) ?? 0) + 1;
        v.Number = number;
        v.PublishedAt = DateTime.UtcNow;
        v.PublishedById = user;
        v.Revision++;
        t.CurrentVersionId = v.Id;
        t.UpdatedAt = DateTime.UtcNow;
        t.Revision++;
        var diff = Diff(previous, v);
        audit.Record(user, "template.publish", "sheet-template", id.ToString(), $"Publicou a v{number} da ficha-modelo \"{t.Name}\".",
            new { versionId = v.Id, number, fromNumber = previous?.Number, diff = AuditDiff(diff) });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { v.Id, v.Number, v.PublishedAt, templateRevision = t.Revision, diff };
    }

    public async Task DeleteVersionAsync(Guid id, Guid versionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        var v = await DraftAsync(id, versionId, ct);
        var pdf = v.PdfFileId;
        db.SheetTemplateVersions.Remove(v);
        t.UpdatedAt = DateTime.UtcNow;
        audit.Record(user, "template.version.delete", "sheet-template", id.ToString(), $"Descartou o rascunho v{v.Number} de \"{t.Name}\".",
            new { versionId, number = v.Number, fields = v.Fields.Count, actions = v.Actions.Count });
        await db.SaveChangesAsync(ct);
        await RemoveOrphanFileAsync(pdf, ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Admin: "reverter" criando uma nova versão publicada idêntica a uma versão publicada antiga.</summary>
    public async Task<object> RepublishAsync(Guid id, Guid versionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await LockTemplateAsync(id, ct);
        var source = await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == versionId && x.TemplateId == id, ct) ?? throw NotFound();
        if (source.PublishedAt is null) throw new RuleException(409, "Somente versões publicadas podem ser republicadas.");
        var previous = t.CurrentVersionId is { } cid ? await db.SheetTemplateVersions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == cid, ct) : null;
        var number = (await db.SheetTemplateVersions.Where(x => x.TemplateId == id && x.PublishedAt != null).MaxAsync(x => (int?)x.Number, ct) ?? 0) + 1;
        // O rascunho guarda um número provisório; se colidir, ele passa para o próximo (gravado antes para respeitar o índice único).
        var draft = await db.SheetTemplateVersions.SingleOrDefaultAsync(x => x.TemplateId == id && x.PublishedAt == null, ct);
        if (draft is not null && draft.Number <= number)
        {
            draft.Number = number + 1;
            await db.SaveChangesAsync(ct);
        }
        var copy = new SheetTemplateVersion
        {
            TemplateId = id,
            Number = number,
            PdfFileId = source.PdfFileId,
            Pages = source.Pages.Select(ClonePage).ToList(),
            Fields = source.Fields.Select(CloneField).ToList(),
            Actions = source.Actions.Select(CloneAction).ToList(),
            Notes = Clip($"Republicação da v{source.Number}. {source.Notes}".Trim(), SheetTemplateLimits.MaxNotes),
            PublishedAt = DateTime.UtcNow,
            PublishedById = user,
        };
        db.SheetTemplateVersions.Add(copy);
        t.CurrentVersionId = copy.Id;
        t.Revision++;
        t.UpdatedAt = DateTime.UtcNow;
        var diff = Diff(previous, copy);
        audit.Record(user, "template.republish", "sheet-template", id.ToString(), $"Republicou a v{source.Number} de \"{t.Name}\" como v{number}.",
            new { sourceVersionId = source.Id, sourceNumber = source.Number, versionId = copy.Id, number, fromNumber = previous?.Number, diff = AuditDiff(diff) });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { copy.Id, copy.Number, copy.PublishedAt, templateRevision = t.Revision, diff };
    }

    // ---------------- Modelo embutido do Sistema livre ----------------

    /// <summary>Cria (uma única vez) o modelo padrão do Sistema livre e sua v1 publicada, sem PDF. Idempotente: não altera um modelo existente.
    /// Os NOMES dos campos são contrato: a ficha do jogador mapeia as colunas clássicas de <see cref="Character"/> para eles.</summary>
    public static async Task EnsureFreeTemplateAsync(GameDb db, CancellationToken ct)
    {
        if (await db.SheetTemplates.AnyAsync(t => t.Id == SheetTemplate.FreeTemplateId, ct)) return;
        var now = DateTime.UtcNow;
        var hasDefault = await db.SheetTemplates.AnyAsync(t => t.RpgSystemId == RpgSystem.FreeSystemId && t.IsDefault, ct);
        db.SheetTemplates.Add(new SheetTemplate
        {
            Id = SheetTemplate.FreeTemplateId,
            RpgSystemId = RpgSystem.FreeSystemId,
            Name = "Ficha clássica",
            Description = "Ficha de atributos do Sistema livre: nome, arquétipo, nível, vida, quatro atributos com modificadores, armadura, deslocamento e notas.",
            CurrentVersionId = SheetTemplateVersion.FreeTemplateV1Id,
            IsDefault = !hasDefault,
            CreatedAt = now,
            UpdatedAt = now,
        });
        db.SheetTemplateVersions.Add(new SheetTemplateVersion
        {
            Id = SheetTemplateVersion.FreeTemplateV1Id,
            TemplateId = SheetTemplate.FreeTemplateId,
            Number = 1,
            Pages = [new SheetPage { Index = 0, Width = SheetTemplateLimits.A4Width, Height = SheetTemplateLimits.A4Height }],
            Fields = FreeTemplateFields(),
            Actions = [],
            Notes = "Modelo embutido da plataforma.",
            CreatedAt = now,
            PublishedAt = now,
        });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException)
        {
            // Outra instância pode ter criado ao mesmo tempo: se o modelo já existe, o resultado desejado foi alcançado.
            db.ChangeTracker.Clear();
            if (!await db.SheetTemplates.AnyAsync(t => t.Id == SheetTemplate.FreeTemplateId, ct)) throw;
        }
    }

    /// <summary>Campos da ficha clássica (layout A4 em duas colunas). Nomes exatos são contrato com a ficha do jogador.</summary>
    public static List<SheetField> FreeTemplateFields()
    {
        static SheetField F(string name, string label, string type, double x, double y, double w, double h, double font = 11, string align = "left") =>
            new() { Name = name, Label = label, Type = type, Page = 0, X = x, Y = y, W = w, H = h, FontSize = font, Align = align };
        var attrs = new[] { ("forca", "Força"), ("agilidade", "Agilidade"), ("intelecto", "Intelecto"), ("constituicao", "Constituição") };
        var fields = new List<SheetField>
        {
            F("nome", "Nome do personagem", SheetFieldTypes.Text, 0.08, 0.075, 0.56, 0.042, 14),
            F("nivel", "Nível", SheetFieldTypes.Number, 0.70, 0.075, 0.22, 0.042, 14, "center"),
            F("arquetipo", "Arquétipo", SheetFieldTypes.Text, 0.08, 0.165, 0.56, 0.038, 12),
            F("deslocamento", "Deslocamento (m)", SheetFieldTypes.Number, 0.70, 0.165, 0.22, 0.038, 12, "center"),
            F("vida", "Vida atual", SheetFieldTypes.Number, 0.08, 0.255, 0.26, 0.05, 18, "center"),
            F("vida_max", "Vida máxima", SheetFieldTypes.Number, 0.38, 0.255, 0.26, 0.05, 18, "center"),
            F("armadura", "Armadura", SheetFieldTypes.Number, 0.70, 0.255, 0.22, 0.05, 18, "center"),
        };
        fields[0].Role = SheetFieldRoles.Name; fields[0].MaxLength = 100;
        fields[1].Role = SheetFieldRoles.Level; fields[1].Min = 1; fields[1].Max = 1000; fields[1].Default = "1";
        fields[2].MaxLength = 80;
        fields[3].Role = SheetFieldRoles.Movement; fields[3].Min = 0; fields[3].Max = 300; fields[3].Default = "9";
        fields[4].Role = SheetFieldRoles.Hp; fields[4].Min = 0; fields[4].Default = "10";
        fields[5].Role = SheetFieldRoles.MaxHp; fields[5].Min = 1; fields[5].Default = "10";
        fields[6].Role = SheetFieldRoles.Armor; fields[6].Min = 0; fields[6].Max = 1000; fields[6].Default = "10";
        for (var i = 0; i < attrs.Length; i++)
        {
            var x = 0.08 + i * 0.215;
            var (name, label) = attrs[i];
            var attr = F(name, label, SheetFieldTypes.Number, x, 0.375, 0.195, 0.06, 20, "center");
            attr.Min = 0; attr.Max = 1000; attr.Default = "10";
            fields.Add(attr);
            var mod = F(name + "_mod", "Mod. " + label, SheetFieldTypes.Computed, x + 0.04, 0.47, 0.115, 0.036, 13, "center");
            mod.Formula = $"mod(@{name})";
            fields.Add(mod);
        }
        var notes = F("notas", "Notas, equipamentos e história", SheetFieldTypes.TextArea, 0.08, 0.57, 0.84, 0.36, 11);
        notes.MaxLength = 10000;
        fields.Add(notes);
        return fields;
    }

    // ---------------- Validação ----------------

    /// <summary>Ponto ÚNICO de chamada à linguagem de fórmulas (WP3) ao publicar: estrutura + regras semânticas + SheetCalculator.ValidateFields
    /// + Formula.Validate(modo Roll, nomes numéricos) para cada ação. Enquanto a linguagem não estiver disponível, responde 503.</summary>
    public static IReadOnlyList<SheetIssue> ValidateForPublish(SheetTemplateVersion v)
    {
        var issues = StructureIssues(v.Pages, v.Fields, v.Actions, v.Notes);
        issues.AddRange(SemanticIssues(v.Pages, v.Fields));
        try
        {
            foreach (var error in SheetCalculator.ValidateFields(v.Fields)) issues.Add(new SheetIssue(FieldMentioned(error, v.Fields), null, error));
            var numeric = NumericNames(v.Fields);
            foreach (var a in v.Actions.Where(a => !string.IsNullOrWhiteSpace(a.Formula)))
            {
                var check = Formula.Validate(a.Formula, FormulaMode.Roll, numeric);
                if (!check.Ok) issues.Add(new SheetIssue(null, a.Key, $"Ação \"{a.Name}\": {check.Error ?? "fórmula inválida."}"));
            }
        }
        catch (NotImplementedException)
        {
            throw new RuleException(503, "A validação de fórmulas ainda não está disponível neste servidor. Salve o rascunho e publique mais tarde.");
        }
        return issues.DistinctBy(i => (i.Field, i.Action, i.Message)).ToList();
    }

    /// <summary>Nomes que viram números no escopo das fórmulas (@nome).</summary>
    public static IReadOnlySet<string> NumericNames(IEnumerable<SheetField> fields) =>
        fields.Where(f => f.Type is SheetFieldTypes.Number or SheetFieldTypes.Computed).Select(f => f.Name).ToHashSet(StringComparer.Ordinal);

    /// <summary>Limites estruturais (aplicados ao salvar rascunho e ao publicar).</summary>
    public static List<SheetIssue> StructureIssues(IReadOnlyList<SheetPage> pages, IReadOnlyList<SheetField> fields, IReadOnlyList<SheetActionDefinition> actions, string? notes)
    {
        var issues = new List<SheetIssue>();
        if (pages.Count is < 1 or > SheetTemplateLimits.MaxPages) issues.Add(new(null, null, $"A ficha precisa ter de 1 a {SheetTemplateLimits.MaxPages} páginas."));
        if (pages.Any(p => !ValidSize(p.Width) || !ValidSize(p.Height)))
            issues.Add(new(null, null, $"Cada página deve medir entre {SheetTemplateLimits.MinPageSize} e {SheetTemplateLimits.MaxPageSize} pontos."));
        if (fields.Count > SheetTemplateLimits.MaxFields) issues.Add(new(null, null, $"Use no máximo {SheetTemplateLimits.MaxFields} campos."));
        if (actions.Count > SheetTemplateLimits.MaxActions) issues.Add(new(null, null, $"Use no máximo {SheetTemplateLimits.MaxActions} golpes e magias."));
        if ((notes ?? "").Length > SheetTemplateLimits.MaxNotes) issues.Add(new(null, null, $"As notas da versão têm limite de {SheetTemplateLimits.MaxNotes} caracteres."));
        var names = new HashSet<string>(StringComparer.Ordinal);
        var roles = new HashSet<string>(StringComparer.Ordinal);
        foreach (var f in fields.Take(SheetTemplateLimits.MaxFields + 1))
        {
            var label = string.IsNullOrEmpty(f.Name) ? "(sem nome)" : Clip(f.Name, 40);
            string? who = NamePattern.IsMatch(f.Name ?? "") ? f.Name : null;
            void Add(string message) => issues.Add(new(who, null, $"Campo {label}: {message}"));
            if (who is null) Add("o nome deve começar com letra minúscula e usar só a-z, 0-9 e _ (até 40).");
            else if (!names.Add(f.Name!)) Add("nome repetido; cada campo precisa de um nome único.");
            if ((f.Label ?? "").Length > 80) Add("rótulo com mais de 80 caracteres.");
            if (!SheetFieldTypes.All.Contains(f.Type)) Add("tipo desconhecido.");
            if (f.Role is not null)
            {
                if (!SheetFieldRoles.All.Contains(f.Role)) Add("papel desconhecido.");
                else if (!roles.Add(f.Role)) Add($"o papel \"{f.Role}\" já está em outro campo.");
            }
            if (f.Page < 0 || f.Page >= SheetTemplateLimits.MaxPages) Add("página inválida.");
            if (!Finite(f.X, f.Y, f.W, f.H) || f.X < 0 || f.Y < 0 || f.W < SheetTemplateLimits.MinFieldSize || f.H < SheetTemplateLimits.MinFieldSize || f.X + f.W > 1.0001 || f.Y + f.H > 1.0001)
                Add("posição ou tamanho fora da página.");
            if ((f.Formula ?? "").Length > 300) Add("fórmula com mais de 300 caracteres.");
            if ((f.Default ?? "").Length > 200) Add("valor padrão com mais de 200 caracteres.");
            if ((f.Min is { } mn && !double.IsFinite(mn)) || (f.Max is { } mx && !double.IsFinite(mx)) || (f.Min > f.Max)) Add("mínimo e máximo inválidos.");
            if (f.MaxLength is < 1 or > SheetTemplateLimits.MaxTextLength) Add($"limite de caracteres deve ficar entre 1 e {SheetTemplateLimits.MaxTextLength}.");
            if ((f.Options?.Count ?? 0) > SheetTemplateLimits.MaxOptions || (f.Options ?? []).Any(o => string.IsNullOrWhiteSpace(o) || o.Length > SheetTemplateLimits.MaxOptionLength))
                Add($"até {SheetTemplateLimits.MaxOptions} opções, cada uma com 1 a {SheetTemplateLimits.MaxOptionLength} caracteres.");
            else if ((f.Options ?? []).Distinct(StringComparer.Ordinal).Count() != (f.Options?.Count ?? 0)) Add("opções repetidas.");
            if (!double.IsFinite(f.FontSize) || f.FontSize < SheetTemplateLimits.MinFontSize || f.FontSize > SheetTemplateLimits.MaxFontSize)
                Add($"tamanho de fonte entre {SheetTemplateLimits.MinFontSize} e {SheetTemplateLimits.MaxFontSize}.");
            if (!SheetTemplateLimits.Aligns.Contains(f.Align)) Add("alinhamento inválido.");
        }
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var a in actions.Take(SheetTemplateLimits.MaxActions + 1))
        {
            var label = string.IsNullOrWhiteSpace(a.Name) ? (string.IsNullOrEmpty(a.Key) ? "(sem nome)" : Clip(a.Key, 40)) : Clip(a.Name, 60);
            string? who = NamePattern.IsMatch(a.Key ?? "") ? a.Key : null;
            void Add(string message) => issues.Add(new(null, who, $"Ação {label}: {message}"));
            if (who is null) Add("a chave deve começar com letra minúscula e usar só a-z, 0-9 e _ (até 40).");
            else if (!keys.Add(a.Key!)) Add("chave repetida.");
            if (string.IsNullOrWhiteSpace(a.Name) || a.Name.Length > 60) Add("nome obrigatório, até 60 caracteres.");
            if (!ActionKinds.All.Contains(a.Kind)) Add("tipo deve ser ataque, habilidade, magia ou item.");
            if ((a.Formula ?? "").Length > 300) Add("fórmula com mais de 300 caracteres.");
            if ((a.Description ?? "").Length > 300) Add("descrição com mais de 300 caracteres.");
        }
        return issues;
    }

    /// <summary>Regras exigidas somente ao publicar (o rascunho pode estar incompleto).</summary>
    public static List<SheetIssue> SemanticIssues(IReadOnlyList<SheetPage> pages, IReadOnlyList<SheetField> fields)
    {
        var issues = new List<SheetIssue>();
        if (fields.Count == 0) issues.Add(new(null, null, "Desenhe ao menos um campo antes de publicar."));
        foreach (var f in fields)
        {
            void Add(string message) => issues.Add(new(f.Name, null, $"Campo {f.Name}: {message}"));
            if (f.Page >= pages.Count) Add($"está na página {f.Page + 1}, mas a ficha tem {pages.Count}.");
            if (f.Role == SheetFieldRoles.Name && f.Type != SheetFieldTypes.Text) Add("o papel Nome exige um campo de texto.");
            if (f.Role is not null and not SheetFieldRoles.Name && f.Type is not (SheetFieldTypes.Number or SheetFieldTypes.Computed)) Add("este papel exige um campo numérico ou calculado.");
            if (f.Type == SheetFieldTypes.Computed && string.IsNullOrWhiteSpace(f.Formula)) Add("campo calculado precisa de fórmula.");
            if (f.Type == SheetFieldTypes.Select && f.Options.Count == 0) Add("lista de opções vazia.");
            if (!string.IsNullOrEmpty(f.Default))
            {
                if (f.Type == SheetFieldTypes.Number && !double.TryParse(f.Default, NumberStyles.Float, CultureInfo.InvariantCulture, out _)) Add("valor padrão precisa ser um número (use ponto como separador decimal).");
                if (f.Type == SheetFieldTypes.Checkbox && f.Default is not ("true" or "false")) Add("valor padrão da caixa deve ser marcado ou desmarcado.");
                if (f.Type == SheetFieldTypes.Select && !f.Options.Contains(f.Default)) Add("valor padrão precisa ser uma das opções.");
                if (f.Type == SheetFieldTypes.Number && double.TryParse(f.Default, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && (d < f.Min || d > f.Max)) Add("valor padrão fora do mínimo/máximo.");
            }
        }
        return issues;
    }

    /// <summary>Diferenças por NOME de campo e chave de ação. "changed" = significado (tipo, papel, fórmula, padrão, limites, opções, rótulo);
    /// "moved" = só posição/aparência.</summary>
    public static SheetVersionDiff Diff(SheetTemplateVersion? before, SheetTemplateVersion after)
    {
        var old = (before?.Fields ?? []).GroupBy(f => f.Name).ToDictionary(g => g.Key, g => g.First());
        var now = after.Fields.GroupBy(f => f.Name).ToDictionary(g => g.Key, g => g.First());
        var changed = new List<SheetFieldDiff>();
        var moved = new List<string>();
        foreach (var f in after.Fields)
        {
            if (!old.TryGetValue(f.Name, out var o)) continue;
            var changes = new List<string>();
            if (o.Label != f.Label) changes.Add("label");
            if (o.Type != f.Type) changes.Add("type");
            if (o.Role != f.Role) changes.Add("role");
            if ((o.Formula ?? "") != (f.Formula ?? "")) changes.Add("formula");
            if ((o.Default ?? "") != (f.Default ?? "")) changes.Add("default");
            if (o.Min != f.Min) changes.Add("min");
            if (o.Max != f.Max) changes.Add("max");
            if (o.MaxLength != f.MaxLength) changes.Add("maxLength");
            if (!o.Options.SequenceEqual(f.Options)) changes.Add("options");
            if (changes.Count > 0) changed.Add(new SheetFieldDiff(f.Name, changes));
            else if (o.Page != f.Page || !Same(o.X, f.X) || !Same(o.Y, f.Y) || !Same(o.W, f.W) || !Same(o.H, f.H) || !Same(o.FontSize, f.FontSize) || o.Align != f.Align) moved.Add(f.Name);
        }
        var oldActions = (before?.Actions ?? []).GroupBy(a => a.Key).ToDictionary(g => g.Key, g => g.First());
        var newKeys = after.Actions.Select(a => a.Key).ToHashSet();
        return new SheetVersionDiff(
            before?.Number,
            after.Fields.Where(f => !old.ContainsKey(f.Name)).Select(f => f.Name).ToList(),
            (before?.Fields ?? []).Where(f => !now.ContainsKey(f.Name)).Select(f => f.Name).ToList(),
            changed,
            moved,
            after.Actions.Where(a => !oldActions.ContainsKey(a.Key)).Select(a => a.Key).ToList(),
            (before?.Actions ?? []).Where(a => !newKeys.Contains(a.Key)).Select(a => a.Key).ToList(),
            after.Actions.Where(a => oldActions.TryGetValue(a.Key, out var o) && (o.Name != a.Name || o.Kind != a.Kind || o.Formula != a.Formula || o.Description != a.Description)).Select(a => a.Key).ToList(),
            before is not null && before.PdfFileId != after.PdfFileId,
            before?.Pages.Count ?? 0,
            after.Pages.Count);
    }

    // ---------------- Auxiliares ----------------

    static object AuditDiff(SheetVersionDiff d) => new
    {
        d.FromNumber,
        added = d.Added.Take(60),
        removed = d.Removed.Take(60),
        changed = d.Changed.Take(60).Select(c => c.Name),
        moved = d.Moved.Count,
        actionsAdded = d.ActionsAdded.Take(30),
        actionsRemoved = d.ActionsRemoved.Take(30),
        actionsChanged = d.ActionsChanged.Take(30),
        d.PdfChanged,
        d.PagesBefore,
        d.PagesAfter,
    };

    static string Summary(IReadOnlyList<SheetIssue> issues, string intro) =>
        Clip($"{intro}: {issues[0].Message}{(issues.Count > 1 ? $" (e mais {issues.Count - 1})" : "")}", 500);

    /// <summary>Tenta descobrir qual campo uma mensagem de erro (texto livre de SheetCalculator) menciona, para a interface selecioná-lo.</summary>
    public static string? FieldMentioned(string message, IReadOnlyList<SheetField> fields) =>
        fields.Select(f => f.Name).Where(n => !string.IsNullOrEmpty(n) && Regex.IsMatch(message, $@"(?<![a-z0-9_@]){Regex.Escape(n)}(?![a-z0-9_])"))
            .OrderByDescending(n => n.Length).FirstOrDefault();

    static (string Name, string Description) ValidateTemplateText(string? name, string? description)
    {
        var n = (name ?? "").Trim();
        var d = (description ?? "").Trim();
        if (n.Length is 0 or > SheetTemplateLimits.MaxTemplateName || n.Any(char.IsControl)) throw new RuleException(400, "Informe um nome de 1 a 100 caracteres.");
        if (d.Length > SheetTemplateLimits.MaxTemplateDescription) throw new RuleException(400, "A descrição tem limite de 2.000 caracteres.");
        return (n, d);
    }

    static List<SheetPage> ParsePages(string? json)
    {
        List<SheetPage>? pages = null;
        if (!string.IsNullOrWhiteSpace(json) && json.Length <= 20000)
        {
            try { pages = JsonSerializer.Deserialize<List<SheetPage>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
            catch (JsonException) { pages = null; }
        }
        if (pages is null || pages.Count is < 1 or > SheetTemplateLimits.MaxPages)
            throw new RuleException(400, $"Não foi possível ler as páginas do PDF. Use um PDF de 1 a {SheetTemplateLimits.MaxPages} páginas.");
        if (pages.Any(p => p is null || !ValidSize(p.Width) || !ValidSize(p.Height)))
            throw new RuleException(400, $"Cada página do PDF deve medir entre {SheetTemplateLimits.MinPageSize} e {SheetTemplateLimits.MaxPageSize} pontos.");
        return pages.Select((p, i) => new SheetPage { Index = i, Width = Math.Round(p.Width, 2), Height = Math.Round(p.Height, 2) }).ToList();
    }

    /// <summary>Conferência barata de integridade: o PDF precisa terminar com o marcador %%EOF (tolerando bytes finais).</summary>
    static bool LooksComplete(byte[] content)
    {
        var tail = content.AsSpan(Math.Max(0, content.Length - 2048));
        return tail.IndexOf("%%EOF"u8) >= 0;
    }

    async Task RemoveOrphanFileAsync(Guid? fileId, CancellationToken ct)
    {
        if (fileId is not { } fid) return;
        if (await db.SheetTemplateVersions.AnyAsync(v => v.PdfFileId == fid, ct) || await db.Library.AnyAsync(l => l.FileId == fid, ct)) return;
        await db.Files.Where(f => f.Id == fid).ExecuteDeleteAsync(ct);
    }

    /// <summary>Mesma regra de <see cref="PlatformAccess.RoleAsync"/> (conta verificada, sem bloqueio, papel de equipe), avaliando a data
    /// de bloqueio em memória para funcionar também no SQLite dos testes. A rota de equipe já passou pela política Staff.</summary>
    async Task<bool> IsStaffAsync(string user, CancellationToken ct)
    {
        var u = await db.Users.AsNoTracking().Where(x => x.Id == user).Select(x => new { x.Role, x.EmailConfirmed, x.LockoutEnd }).SingleOrDefaultAsync(ct);
        return u is not null && u.EmailConfirmed && (u.LockoutEnd == null || u.LockoutEnd < DateTimeOffset.UtcNow) && PlatformRoles.IsStaff(u.Role);
    }

    async Task<SheetTemplate> LockTemplateAsync(Guid id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql()
            ? db.SheetTemplates.FromSqlInterpolated($"SELECT * FROM \"SheetTemplates\" WHERE \"Id\" = {id} FOR UPDATE")
            : db.SheetTemplates.Where(x => x.Id == id);
        return await query.SingleOrDefaultAsync(ct) ?? throw NotFound();
    }

    async Task LockSystemAsync(Guid systemId, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"RpgSystems\" WHERE \"Id\" = {systemId} FOR UPDATE", ct);
    }

    async Task<SheetTemplateVersion> DraftAsync(Guid id, Guid versionId, CancellationToken ct)
    {
        var v = await db.SheetTemplateVersions.SingleOrDefaultAsync(x => x.Id == versionId && x.TemplateId == id, ct) ?? throw new RuleException(404, "Versão não encontrada.");
        if (v.PublishedAt is not null) throw new RuleException(409, "Versões publicadas não podem ser alteradas. Crie um novo rascunho a partir dela.");
        return v;
    }

    static SheetField NormalizeField(SheetField f)
    {
        var type = (f.Type ?? "").Trim();
        var textual = type is SheetFieldTypes.Text or SheetFieldTypes.TextArea;
        var name = (f.Name ?? "").Trim();
        var label = (f.Label ?? "").Trim();
        return new SheetField
        {
            Name = name,
            Label = label.Length == 0 ? name : label,
            Type = type,
            Role = string.IsNullOrWhiteSpace(f.Role) ? null : f.Role.Trim(),
            Page = f.Page,
            X = Round(f.X), Y = Round(f.Y), W = Round(f.W), H = Round(f.H),
            Formula = type == SheetFieldTypes.Computed ? EmptyToNull(f.Formula?.Trim()) : null,
            Default = type == SheetFieldTypes.Computed ? null : EmptyToNull(f.Default),
            Min = type is SheetFieldTypes.Number or SheetFieldTypes.Computed ? f.Min : null,
            Max = type is SheetFieldTypes.Number or SheetFieldTypes.Computed ? f.Max : null,
            MaxLength = textual ? f.MaxLength : null,
            Options = type == SheetFieldTypes.Select ? (f.Options ?? []).Select(o => (o ?? "").Trim()).ToList() : [],
            FontSize = f.FontSize,
            Align = string.IsNullOrWhiteSpace(f.Align) ? "left" : f.Align.Trim(),
        };
    }

    static SheetActionDefinition NormalizeAction(SheetActionDefinition a) => new()
    {
        Key = (a.Key ?? "").Trim(),
        Name = (a.Name ?? "").Trim(),
        Kind = (a.Kind ?? "").Trim(),
        Formula = (a.Formula ?? "").Trim(),
        Description = (a.Description ?? "").Trim(),
    };

    static SheetPage ClonePage(SheetPage p) => new() { Index = p.Index, Width = p.Width, Height = p.Height };
    static SheetField CloneField(SheetField f) => new()
    {
        Name = f.Name, Label = f.Label, Type = f.Type, Role = f.Role, Page = f.Page, X = f.X, Y = f.Y, W = f.W, H = f.H, Formula = f.Formula, Default = f.Default,
        Min = f.Min, Max = f.Max, MaxLength = f.MaxLength, Options = [.. f.Options], FontSize = f.FontSize, Align = f.Align,
    };
    static SheetActionDefinition CloneAction(SheetActionDefinition a) => new() { Key = a.Key, Name = a.Name, Kind = a.Kind, Formula = a.Formula, Description = a.Description };

    static bool ValidSize(double v) => double.IsFinite(v) && v >= SheetTemplateLimits.MinPageSize && v <= SheetTemplateLimits.MaxPageSize;
    static bool Finite(params double[] values) => values.All(double.IsFinite);
    static bool Same(double a, double b) => Math.Abs(a - b) < 1e-6;
    static double Round(double v) => double.IsFinite(v) ? Math.Round(v, 6) : v;
    static string? EmptyToNull(string? v) => string.IsNullOrEmpty(v) ? null : v;
    static string Clip(string v, int max) => v.Length <= max ? v : v[..max];
    static RuleException NotFound() => new(404, "Ficha-modelo não encontrada.");
    static RuleException Stale() => new(409, "A ficha-modelo mudou em outra sessão. Recarregue antes de salvar.");
    static RuleException DuplicateName() => new(409, "Já existe uma ficha-modelo com esse nome neste sistema.");
}
