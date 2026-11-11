using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record WorkspaceInput(string Title, string Content, string Kind = "text", string Visibility = "self", string Secrets = "", string Collection = "", string Tags = "", string Status = "open", Guid? ParentId = null, Guid? NpcId = null, Guid? MapId = null, int Order = 0, int Revision = 0, string[]? Recipients = null, Guid[]? Related = null, bool Pinned = false);
public record PastSessionInput(int Number, string Title, string Summary, DateOnly? Date = null, bool Published = false, int Revision = 0, List<PastSceneInput>? Scenes = null, Guid? ChapterId = null);
/// <summary>Cena opcional do registro anterior. Título vazio vira "Cena N".</summary>
public record PastSceneInput(string? Title, string? Text);
public sealed partial class WorkspaceService(GameDb db)
{
    /// <summary>"npc" só é aceito em páginas antigas desse tipo (ADR-064).</summary>
    const string LegacyNpcKind = "npc";
    static readonly string[] Kinds = ["text", "note", "place", "faction", "book", "chapter", "item", "event", LegacyNpcKind, "objective", "clue"];
    IQueryable<WorkspacePage> Pages => db.Set<WorkspacePage>();
    static RuleException Missing() => new(404, "Conteúdo não encontrado.");
    public async Task<Campaign> Access(Guid id, string user, bool write, CancellationToken ct)
    {
        var c = await db.Campaigns.SingleOrDefaultAsync(c => c.Id == id && (c.OwnerId == user || db.Members.Any(m => m.CampaignId == id && m.UserId == user)), ct) ?? throw Missing();
        if (write && c.ArchivedAt != null) throw new RuleException(409, "Restaure a campanha antes de editar.");
        return c;
    }
    async Task<Campaign> Lock(Guid id, string user, CancellationToken ct)
    {
        var c = await (db.Database.IsNpgsql() ? db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {id} FOR UPDATE") : db.Campaigns.Where(c => c.Id == id)).SingleOrDefaultAsync(ct) ?? throw Missing();
        await Access(id, user, true, ct); return c;
    }
    IQueryable<WorkspacePage> Visible(Guid campaign, string user, string master) => Readable(db, campaign, user, master);
    /// <summary>Regra única de leitura das páginas (inclui lixeira; filtre <c>DeletedAt</c> conforme o uso). Reaproveitada por "NPCs conhecidos".</summary>
    public static IQueryable<WorkspacePage> Readable(GameDb db, Guid campaign, string user, string master) => db.Set<WorkspacePage>().Where(p => p.CampaignId == campaign &&
        (p.OwnerId == user || p.Visibility == "table" || p.Visibility == "master" && master == user || p.Visibility == "selected" && db.Set<WorkspaceReader>().Any(r => r.PageId == p.Id && r.UserId == user)));
    public async Task<object> List(Guid campaign, string user, string? search, string? kind, int page, bool trash, CancellationToken ct, bool mine = false)
    {
        var c = await Access(campaign, user, false, ct);
        if (search?.Length > 100) throw new RuleException(400, "Busca aceita até 100 caracteres.");
        page = Math.Clamp(page, 1, 100000);
        var q = Visible(campaign, user, c.OwnerId).AsNoTracking().Where(p => trash ? p.DeletedAt != null && (p.OwnerId == user || p.Kind != "note" && c.OwnerId == user) : p.DeletedAt == null);
        if (mine) q = q.Where(p => p.OwnerId == user);
        if (!string.IsNullOrWhiteSpace(kind)) q = q.Where(p => p.Kind == kind);
        if (!string.IsNullOrWhiteSpace(search)) q = q.Where(p => p.Title.Contains(search) || p.Content.Contains(search) || p.Collection.Contains(search) || p.Tags.Contains(search));
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(p => p.Pinned).ThenBy(p => p.Collection).ThenBy(p => p.Order).ThenBy(p => p.Title).ThenBy(p => p.Id).Skip((page - 1) * 20).Take(20)
            .Select(p => new { p.Id, p.Title, p.Kind, p.Collection, p.Tags, p.Visibility, p.Status, p.ParentId, p.Order, p.Pinned, p.Revision, p.UpdatedAt, canEdit = p.OwnerId == user || p.Kind != "note" && c.OwnerId == user,
                // Selo "NPC: nome" só para o mestre; o vínculo com a Preparação não aparece na lista dos jogadores.
                npc = c.OwnerId == user && p.NpcId != null ? db.MasterCharacters.Where(m => m.Id == p.NpcId).Select(m => m.Name).FirstOrDefault() : null }).ToListAsync(ct);
        return new { items, total, page, pageSize = 20 };
    }
    public async Task<object> Read(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var p = await Visible(campaign, user, c.OwnerId).AsNoTracking().SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct) ?? throw Missing();
        var edit = p.OwnerId == user || p.Kind != "note" && c.OwnerId == user;
        var parent = await Visible(campaign, user, c.OwnerId).Where(x => x.Id == p.ParentId && x.DeletedAt == null).Select(x => new { x.Id, x.Title }).SingleOrDefaultAsync(ct);
        var children = await Visible(campaign, user, c.OwnerId).Where(x => x.ParentId == id && x.DeletedAt == null).OrderBy(x => x.Order).Take(100).Select(x => new { x.Id, x.Title }).ToListAsync(ct);
        var relatedIds = p.RelatedReferences.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse).ToArray();
        var related = await Visible(campaign, user, c.OwnerId).Where(x => relatedIds.Contains(x.Id) && x.DeletedAt == null).Select(x => new { x.Id, x.Title }).Take(20).ToListAsync(ct);
        var reference = p.Id.ToString();
        var backlinks = await Visible(campaign, user, c.OwnerId).Where(x => x.RelatedReferences.Contains(reference) && x.DeletedAt == null).Select(x => new { x.Id, x.Title }).Take(100).ToListAsync(ct);
        return new { related, backlinks, p.Pinned, p.Id, p.Title, p.Content, p.Kind, p.Visibility, p.Collection, p.Tags, p.Status, parent, children, p.ParentId, p.Order, p.Revision, p.UpdatedAt,
            secrets = edit ? p.Secrets : "", npcId = edit ? p.NpcId : null, mapId = edit ? p.MapId : null, canEdit = edit,
            recipients = edit ? await db.Set<WorkspaceReader>().Where(r => r.PageId == id).Select(r => r.UserId).ToListAsync(ct) : [] };
    }
    static void Validate(WorkspaceInput x)
    {
        if (string.IsNullOrWhiteSpace(x.Title) || x.Title.Length > 120 || x.Content == null || x.Content.Length > 10000 || x.Secrets == null || x.Secrets.Length > 4000 || x.Collection == null || x.Collection.Length > 120 || x.Tags == null || x.Tags.Length > 300 || !Kinds.Contains(x.Kind) || x.Visibility is not ("self" or "master" or "selected" or "table") || x.Status is not ("open" or "resolved" or "abandoned") || x.Order is < 0 or > 10000 || x.Recipients?.Length > 20 || x.Related?.Length > 20)
            throw new RuleException(400, "Confira título, texto, tipo e compartilhamento.");
    }
    public async Task<WorkspacePage> Save(Guid campaign, Guid? id, string user, WorkspaceInput x, CancellationToken ct)
    {
        Validate(x); await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        var p = id == null ? new WorkspacePage { CampaignId = campaign, OwnerId = user } : await Pages.SingleOrDefaultAsync(p => p.Id == id && p.CampaignId == campaign && p.DeletedAt == null, ct) ?? throw Missing();
        if (id != null && !(p.OwnerId == user || p.Kind != "note" && c.OwnerId == user)) throw Missing();
        if (x.Kind != "note" && c.OwnerId != user || id != null && (p.Kind == "note") != (x.Kind == "note")) throw new RuleException(403, "Somente o mestre organiza o acervo. Use seu caderno pessoal.");
        if (id != null && x.Revision != p.Revision) throw new RuleException(409, "O conteúdo mudou. Reabra antes de salvar.");
        // ADR-064: NPCs nascem na Preparação; a página só descreve um NPC pelo vínculo NpcId. O tipo antigo continua editável.
        if (x.Kind == LegacyNpcKind && (id == null || p.Kind != LegacyNpcKind)) throw new RuleException(400, "Crie NPCs em Preparação. Para escrever a história de um NPC, escolha outro tipo e associe a página ao personagem.");
        if (id == null && await Pages.CountAsync(p => p.CampaignId == campaign, ct) >= 1000) throw new RuleException(409, "Limite de 1.000 páginas por campanha, incluindo lixeira.");
        var recipients = (x.Recipients ?? []).Distinct().ToArray();
        if (x.Visibility == "selected" && (recipients.Length == 0 || await db.Users.CountAsync(u => recipients.Contains(u.Id) && (u.Id == c.OwnerId || db.Members.Any(m => m.CampaignId == campaign && m.UserId == u.Id)), ct) != recipients.Length)) throw new RuleException(400, "Escolha participantes desta campanha.");
        var relatedIds = (x.Related ?? []).Distinct().ToArray();
        if (relatedIds.Contains(p.Id) || await Visible(campaign, user, c.OwnerId).CountAsync(p => relatedIds.Contains(p.Id) && p.DeletedAt == null, ct) != relatedIds.Length) throw new RuleException(400, "Escolha páginas acessíveis desta campanha para relacionar.");
        if (x.ParentId != null)
        {
            var parent = await Visible(campaign, user, c.OwnerId).SingleOrDefaultAsync(p => p.Id == x.ParentId && p.DeletedAt == null, ct) ?? throw Missing();
            if (parent.Id == p.Id || parent.ParentId != null || await Pages.AnyAsync(child => child.ParentId == p.Id, ct)) throw new RuleException(400, "Organize capítulos dentro de um livro ou páginas dentro de uma coleção, sem ciclos.");
        }
        if (c.OwnerId != user && (x.NpcId != null || x.MapId != null)) throw new RuleException(403, "Referências de preparação são exclusivas do mestre.");
        if (x.NpcId != null && !await db.MasterCharacters.AnyAsync(n => n.Id == x.NpcId && n.CampaignId == campaign, ct) || x.MapId != null && !await db.Set<CampaignMap>().AnyAsync(m => m.Id == x.MapId && m.CampaignId == campaign, ct)) throw Missing();
        if (id != null)
        {
            db.Add(new WorkspaceVersion { PageId = p.Id, Number = p.Revision, Snapshot = JsonSerializer.Serialize(new WorkspaceInput(p.Title, p.Content, p.Kind, p.Visibility, p.Secrets, p.Collection, p.Tags, p.Status, p.ParentId, p.NpcId, p.MapId, p.Order, p.Revision, Related:p.RelatedReferences.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse).ToArray(), Pinned:p.Pinned)) });
            // Histórico limitado por página; conteúdo antigo nunca é oferecido aos leitores compartilhados.
            var expired = await db.Set<WorkspaceVersion>().Where(v => v.PageId == p.Id).OrderByDescending(v => v.Number).Skip(49).ToListAsync(ct); db.RemoveRange(expired);
            var readers = await db.Set<WorkspaceReader>().Where(r => r.PageId == p.Id).ToListAsync(ct); db.RemoveRange(readers);
            await db.SaveChangesAsync(ct);
            p.Revision++;
        }
        p.RelatedReferences = string.Join(',', relatedIds); p.Pinned = x.Pinned;
        p.Title = x.Title.Trim(); p.Content = x.Content; p.Kind = x.Kind; p.Visibility = x.Visibility; p.Secrets = x.Secrets; p.Collection = x.Collection.Trim(); p.Tags = x.Tags.Trim(); p.Status = x.Status; p.ParentId = x.ParentId; p.NpcId = x.NpcId; p.MapId = x.MapId; p.Order = x.Order; p.UpdatedAt = DateTime.UtcNow;
        if (id == null) db.Add(p);
        if (x.Visibility == "selected") foreach (var reader in recipients) db.Add(new WorkspaceReader { PageId = p.Id, UserId = reader });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return p;
    }
    public async Task Delete(Guid campaign, Guid id, string user, int revision, bool restore, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        var p = await Pages.SingleOrDefaultAsync(p => p.Id == id && p.CampaignId == campaign, ct) ?? throw Missing();
        if (!(p.OwnerId == user || p.Kind != "note" && c.OwnerId == user)) throw Missing();
        if (p.Revision != revision) throw new RuleException(409, "Reabra a página antes de continuar.");
        p.DeletedAt = restore ? null : DateTime.UtcNow; p.Revision++; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<object> Versions(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        if (!await Pages.AnyAsync(p => p.Id == id && p.CampaignId == campaign && (p.OwnerId == user || p.Kind != "note" && c.OwnerId == user), ct)) throw Missing();
        return await db.Set<WorkspaceVersion>().Where(v => v.PageId == id).OrderByDescending(v => v.Number).Take(50).Select(v => new { v.Number, v.At, v.Snapshot }).ToListAsync(ct);
    }
    public async Task<object> Past(Guid campaign, string user, int page, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct); page = Math.Clamp(page, 1, 100000);
        var q = db.Set<PastSession>().Where(s => s.CampaignId == campaign && (c.OwnerId == user || s.Published));
        return new { items = await q.OrderByDescending(s => s.Number).Skip((page - 1) * 20).Take(20).ToListAsync(ct), total = await q.CountAsync(ct), page, pageSize = 20 };
    }
    public const int MaxPastScenes = 30, MaxPastSceneText = 10000, MaxPastScenesTotal = 60000;
    /// <summary>Cenas opcionais: ignora linhas totalmente vazias; cada cena precisa de texto. Limites protegem a listagem paginada.</summary>
    public static List<PastSessionScene> PastScenes(List<PastSceneInput>? input)
    {
        var list = (input ?? []).Select(s => (Title: (s?.Title ?? "").Trim(), Text: (s?.Text ?? "").Trim())).Where(s => s.Title.Length > 0 || s.Text.Length > 0).ToList();
        if (list.Count > MaxPastScenes) throw new RuleException(400, $"Registre até {MaxPastScenes} cenas por sessão.");
        if (list.Any(s => s.Title.Length > 120 || s.Text.Length > MaxPastSceneText)) throw new RuleException(400, "Cada cena aceita título de até 120 e texto de até 10.000 caracteres.");
        if (list.Any(s => s.Text.Length == 0)) throw new RuleException(400, "Escreva o que aconteceu em cada cena ou remova a cena vazia.");
        if (list.Sum(s => s.Text.Length) > MaxPastScenesTotal) throw new RuleException(400, "As cenas de uma sessão somam até 60.000 caracteres.");
        return list.Select((s, i) => new PastSessionScene { Title = s.Title.Length > 0 ? s.Title : $"Cena {i + 1}", Text = s.Text }).ToList();
    }
    public async Task<PastSession> SavePast(Guid campaign, Guid? id, string user, PastSessionInput x, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre registra sessões anteriores.");
        if (x.Number is < 1 or > 1000000 || string.IsNullOrWhiteSpace(x.Title) || x.Title.Length > 120 || x.Summary == null || x.Summary.Length > 10000 || x.Date > DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1))) throw new RuleException(400, "Confira número, título, data e resumo.");
        if (await db.Sessions.AnyAsync(s => s.CampaignId == campaign && s.Number == x.Number, ct) || await db.Set<PastSession>().AnyAsync(s => s.CampaignId == campaign && s.Number == x.Number && s.Id != id, ct)) throw new RuleException(409, "Já existe uma sessão com este número.");
        var p = id == null ? new PastSession { CampaignId = campaign } : await db.Set<PastSession>().SingleOrDefaultAsync(p => p.CampaignId == campaign && p.Id == id, ct) ?? throw Missing();
        if (id != null && p.Revision != x.Revision) throw new RuleException(409, "O resumo mudou. Reabra antes de salvar.");
        if (id == null && await db.Set<PastSession>().CountAsync(p => p.CampaignId == campaign, ct) >= 1000) throw new RuleException(409, "Limite de 1.000 sessões anteriores.");
        var scenes = PastScenes(x.Scenes);
        p.ChapterId = await ChapterOf(db, campaign, x.ChapterId, ct);
        p.Number = x.Number; p.Title = x.Title.Trim(); p.Summary = x.Summary; p.Date = x.Date; p.Published = x.Published; p.Scenes = scenes;
        if (id == null) db.Add(p); else p.Revision++;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return p;
    }
    /// <summary>Exclui um registro anterior ao Eternnus (resumo e cenas). Sessões jogadas na plataforma não passam por aqui.</summary>
    public async Task DeletePast(Guid campaign, Guid id, string user, int revision, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre exclui sessões anteriores.");
        var p = await db.Set<PastSession>().SingleOrDefaultAsync(p => p.CampaignId == campaign && p.Id == id, ct) ?? throw Missing();
        if (p.Revision != revision) throw new RuleException(409, "O registro mudou. Reabra antes de excluir.");
        db.Remove(p); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
