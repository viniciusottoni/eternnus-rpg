using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public class RuleException(int status, string message) : Exception(message) { public int Status { get; } = status; }
/// <summary><see cref="RpgSystemId"/> é a escolha preferida; <see cref="System"/> (texto) é aceito por compatibilidade e casado pelo nome.</summary>
public record CampaignInput(string Name, string Description, string? System = null, int Revision = 0, Guid? RpgSystemId = null, bool IsOneShot = false, string? PlayMode = null, string? Origin = null, string? Continuity = null, string? CurrentArc = null, int? FirstSessionNumber = null, DateOnly? OriginalStartDate = null);
public record JoinInput(string Code);

public class CampaignService(GameDb db, ProgressionService progression, AuditService audit)
{
    /// <summary>Limite comum somando campanhas como mestre e participante; níveis não ampliam a quota.</summary>
    public const int FreeCampaignsPerMaster = 3;
    static void Validate(CampaignInput x)
    {
        if (x.Origin is not (null or "new" or "ongoing") || x.Continuity?.Length > 10000 || x.CurrentArc?.Length > 120 || x.FirstSessionNumber is < 1 or > 1000000) throw new RuleException(400, "Confira origem, resumo e número da próxima sessão.");
        if (string.IsNullOrWhiteSpace(x.Name) || x.Name.Length > 100 || x.System?.Length > 80 || x.Description == null || x.Description.Length > 10000)
            throw new RuleException(400, "Confira nome, sistema e descrição da campanha.");
    }
    async Task<Campaign> LockAsync(Guid id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql() ? db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {id} FOR UPDATE") : db.Campaigns.Where(x => x.Id == id);
        return await query.SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Campanha não encontrada.");
    }
    static void Owner(Campaign c, string user) { if (c.OwnerId != user) throw new RuleException(404, "Campanha não encontrada."); }
    /// <param name="oneShot">Filtro opcional: falso lista campanhas persistentes, verdadeiro lista one-shots, nulo lista ambas.</param>
    public async Task<object> ListAsync(string user, string? search, string? sort, int page, CancellationToken ct, bool? oneShot = null)
    {
        if (search?.Length > 100) throw new RuleException(400, "Busca muito longa.");
        page = Math.Max(1, Math.Min(100000, page));
        var query = db.Campaigns.AsNoTracking().Where(c => c.OwnerId == user || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == user));
        if (oneShot is { } kind) query = query.Where(c => c.IsOneShot == kind);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(TextSearch.AnyField<Campaign>(db, TextSearch.Pattern(search.Trim()), x => x.Name));
        var total = await query.CountAsync(ct);
        var ordered = sort == "name" ? query.OrderBy(x => x.Name).ThenBy(x => x.Id) : query.OrderByDescending(x => x.LastActivityAt).ThenBy(x => x.Id);
        var items = await ordered.Skip((page - 1) * 20).Take(20).Select(c => new
        {
            c.Id,
            c.Name,
            c.System,
            c.RpgSystemId,
            c.Description, c.Origin, c.Continuity, c.CurrentArc, c.FirstSessionNumber, c.OriginalStartDate,
            c.Revision,
            c.LastActivityAt,
            c.IsOneShot,
            c.ExpiresAt,
            c.ArchivedAt,
            c.NextSessionAt,
            isMaster = c.OwnerId == user,
            playerCount = db.Members.Count(m => m.CampaignId == c.Id),
            canDelete = c.OwnerId == user && !db.Members.Any(m => m.CampaignId == c.Id),
            activeSessionId = db.Sessions.Where(s => s.CampaignId == c.Id && s.EndedAt == null).Select(s => (Guid?)s.Id).FirstOrDefault(),
            activeSessionPaused = db.Sessions.Any(s => s.CampaignId == c.Id && s.EndedAt == null && s.PausedAt != null)
        }).ToListAsync(ct);
        var account = await db.Users.AsNoTracking().SingleAsync(u => u.Id == user, ct);
        return new { items, total, page, pageSize = 20, limits = await AccountLimits.SummaryAsync(db, account, ct) };
    }
    static void ApplyContinuity(Campaign c, CampaignInput x)
    {
        c.Origin = x.Origin ?? c.Origin; c.Continuity = x.Continuity?.Trim() ?? c.Continuity;
        c.CurrentArc = x.CurrentArc?.Trim() ?? c.CurrentArc; c.FirstSessionNumber = x.FirstSessionNumber ?? c.FirstSessionNumber;
        if (x.Origin != null) c.OriginalStartDate = x.OriginalStartDate;
    }
    public async Task<Guid> CreateAsync(CampaignInput x, string user, CancellationToken ct)
    {
        Validate(x);
        // One-shots nascem pela página One-shot (POST /api/one-shots), já com a sessão única aberta.
        if (x.IsOneShot) throw new RuleException(400, "One-shots são criadas pela página One-shot, já com a mesa aberta.");
        var system = await RpgSystemService.ResolveForCampaignAsync(db, x.RpgSystemId, x.System, null, ct);
        if (x.PlayMode != null && !PlayModes.IsValid(x.PlayMode)) throw new RuleException(400, "Escolha a forma de jogar: livre, por turnos ou tática.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var account = await AccountLimits.LockUserAsync(db, user, ct);
        var c = new Campaign { OwnerId = user, Name = x.Name.Trim(), Description = x.Description.Trim(), RpgSystemId = system.Id, System = system.Name };
        // A forma escolhida que difere da sugestão do sistema vira ajuste da campanha; igual à sugestão, a campanha continua herdando.
        var suggested = TableSettings.Parse(await db.RpgSystems.Where(s => s.Id == system.Id).Select(s => s.TableSettings).SingleOrDefaultAsync(ct));
        if (x.PlayMode != null && x.PlayMode != suggested.PlayMode) c.TableSettings = (suggested with { PlayMode = x.PlayMode }).Serialize();
        await AccountLimits.ReserveAsync(db, account, c, ct);
        ApplyContinuity(c, x);
        db.Campaigns.Add(c);
        await progression.AwardAsync(user, XpReasons.CampaignCreated, $"campaign_created:{c.Id}", ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return c.Id;
    }
    public async Task UpdateAsync(Guid id, CampaignInput x, string user, CancellationToken ct)
    {
        Validate(x); await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct); Owner(c, user);
        if (c.ArchivedAt != null) throw new RuleException(409, "Restaure a campanha antes de editá-la.");
        if (c.Revision != x.Revision) throw new RuleException(409, "A campanha mudou em outra sessão. Atualize a lista antes de editar.");
        // Um sistema que ficou inativo pode ser mantido pela campanha que já o usa.
        var system = await RpgSystemService.ResolveForCampaignAsync(db, x.RpgSystemId, x.System, c.RpgSystemId, ct);
        if (c.RpgSystemId != system.Id) c.SheetTemplateId = null;
        if (x.FirstSessionNumber != null && x.FirstSessionNumber != c.FirstSessionNumber && await db.Sessions.AnyAsync(s => s.CampaignId == id && s.EndedAt == null, ct)) throw new RuleException(409, "Encerre a sessão antes de ajustar a numeração.");
        ApplyContinuity(c, x);
        c.Name = x.Name.Trim(); c.RpgSystemId = system.Id; c.System = system.Name; c.Description = x.Description.Trim(); c.Revision++; c.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<object> SetSheetTemplateAsync(Guid id, CampaignSheetTemplateInput input, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var campaign = await LockAsync(id, ct);
        Owner(campaign, user);
        if (campaign.Revision != input.Revision) throw new RuleException(409, "A campanha mudou. Recarregue antes de escolher o modelo.");
        if (campaign.ArchivedAt != null) throw new RuleException(409, "Restaure a campanha antes de escolher o modelo.");
        if (input.TemplateId is { } templateId && !await db.SheetTemplates.AnyAsync(t => t.Id == templateId && t.RpgSystemId == campaign.RpgSystemId && t.ArchivedAt == null && t.CurrentVersionId != null
            && (t.CampaignId == null || t.CampaignId == id)
            && db.SheetTemplateVersions.Any(v => v.Id == t.CurrentVersionId && v.PublishedAt != null), ct))
            throw new RuleException(400, "Escolha um modelo publicado e ativo do sistema da campanha.");
        campaign.SheetTemplateId = input.TemplateId;
        campaign.Revision++;
        campaign.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { campaign.Id, campaign.SheetTemplateId, campaign.Revision };
    }
    public async Task DeleteAsync(Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct); Owner(c, user);
        if (await db.Sessions.AnyAsync(s => s.CampaignId == id && s.EndedAt == null, ct))
            throw new RuleException(409, "Encerre a sessão em andamento antes de excluir a campanha.");
        if (await db.Members.AnyAsync(x => x.CampaignId == id, ct)) throw new RuleException(409, "Não é possível excluir uma campanha com jogadores vinculados.");
        await db.Set<WorkspacePage>().Where(p => p.CampaignId == id && p.Kind != "note").ExecuteDeleteAsync(ct);
        db.Campaigns.Remove(c); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    /// <summary>Exclusão administrativa (moderação): ignora jogadores vinculados, mas nunca derruba uma sessão em andamento.
    /// Usa o mesmo bloqueio da exclusão comum e grava a auditoria na mesma transação.</summary>
    public async Task AdminDeleteAsync(Guid id, string actor, string reason, CancellationToken ct)
    {
        reason = (reason ?? "").Trim();
        if (reason.Length is < 3 or > 300) throw new RuleException(400, "Informe o motivo (3 a 300 caracteres).");
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct);
        if (await db.Sessions.AnyAsync(s => s.CampaignId == id && s.EndedAt == null, ct))
            throw new RuleException(409, "A campanha tem uma sessão em andamento. Aguarde o mestre encerrar antes de excluir.");
        var members = await db.Members.CountAsync(m => m.CampaignId == id, ct);
        var sessions = await db.Sessions.CountAsync(s => s.CampaignId == id, ct);
        audit.Record(actor, "campaign.delete", "campaign", id.ToString(), $"Excluiu a campanha {c.Name}: {reason}",
            new { reason, before = new { c.Name, c.OwnerId, c.System, c.RpgSystemId, c.CreatedAt, c.LastActivityAt, members, sessions } });
        await db.Set<WorkspacePage>().Where(p => p.CampaignId == id && p.Kind != "note").ExecuteDeleteAsync(ct);
        db.Campaigns.Remove(c); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<Guid> JoinAsync(string code, string user, CancellationToken ct)
    {
        if (code?.Length != 32) throw new RuleException(400, "Código de convite inválido.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var id = await db.Campaigns.Where(x => x.InviteCode == code).Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Convite não encontrado.");
        var c = await LockAsync(id, ct);
        OneShotLifecycleService.EnsureOpen(c, DateTime.UtcNow);
        if (c.ArchivedAt != null) throw new RuleException(409, "Esta campanha está arquivada e não recebe novos jogadores.");
        if (c.OwnerId != user && !await db.Members.AnyAsync(x => x.CampaignId == id && x.UserId == user, ct))
        {
            var account = await AccountLimits.LockUserAsync(db, user, ct);
            await AccountLimits.ReserveAsync(db, account, c, ct);
            db.Members.Add(new() { CampaignId = id, UserId = user }); c.LastActivityAt = DateTime.UtcNow; c.Revision++;
            await NoticeService.NotifyAsync(db, id, user, NoticeAreas.Players, user, NoticeAudience.Everyone, ct);
            await progression.AwardAsync(user, XpReasons.CampaignJoined, $"campaign_joined:{id}:{user}", ct);
            await db.SaveChangesAsync(ct);
        }
        // O convite guardado durante a verificação deixa de ser necessário.
        await db.Users.Where(u => u.Id == user && u.PendingInvite == code).ExecuteUpdateAsync(u => u.SetProperty(x => x.PendingInvite, (string?)null), ct);
        await tx.CommitAsync(ct); return id;
    }
    public async Task LeaveAsync(Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct);
        if (c.OwnerId == user) throw new RuleException(409, "O criador não pode sair da própria campanha.");
        await RemoveMembershipAsync(id, user, ct); c.Revision++; c.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task RemoveAsync(Guid id, string member, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct); Owner(c, user);
        await RemoveMembershipAsync(id, member, ct); c.Revision++; c.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    /// <summary>
    /// Arquiva: preserva conteúdo e histórico, bloqueia novas operações de jogo. Exige que não haja sessão ativa
    /// (o bloqueio da campanha impede abertura concorrente). Arquivadas continuam contando na quota.
    /// </summary>
    public async Task ArchiveAsync(Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct); Owner(c, user);
        if (c.IsOneShot) throw new RuleException(409, "One-shots não são arquivadas: converta em campanha ou encerre a mesa.");
        if (c.ArchivedAt != null) { await tx.RollbackAsync(ct); return; }
        if (await db.Sessions.AnyAsync(s => s.CampaignId == id && s.EndedAt == null, ct)) throw new RuleException(409, "Encerre a sessão em andamento antes de arquivar a campanha.");
        c.ArchivedAt = DateTime.UtcNow; c.Revision++; c.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    /// <summary>Restaura uma campanha arquivada. Como a arquivada já ocupa a vaga, restaurar não ultrapassa o limite.</summary>
    public async Task RestoreAsync(Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct); Owner(c, user);
        if (c.ArchivedAt == null) { await tx.RollbackAsync(ct); return; }
        c.ArchivedAt = null; c.Revision++; c.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    async Task RemoveMembershipAsync(Guid id, string user, CancellationToken ct)
    {
        if (await db.Members.Where(x => x.CampaignId == id && x.UserId == user).ExecuteDeleteAsync(ct) == 0) throw new RuleException(404, "Participação não encontrada.");
        await db.CampaignCharacters.Where(x => x.CampaignId == id && db.Characters.Any(c => c.Id == x.CharacterId && c.OwnerId == user)).ExecuteDeleteAsync(ct);
    }
}

public record CampaignSheetTemplateInput(Guid? TemplateId, int Revision);
