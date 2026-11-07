using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public class RuleException(int status, string message) : Exception(message) { public int Status { get; } = status; }
/// <summary><see cref="RpgSystemId"/> é a escolha preferida; <see cref="System"/> (texto) é aceito por compatibilidade e casado pelo nome.</summary>
public record CampaignInput(string Name, string Description, string? System = null, int Revision = 0, Guid? RpgSystemId = null, bool IsOneShot = false);
public record JoinInput(string Code);

public class CampaignService(GameDb db, ProgressionService progression, AuditService audit)
{
    /// <summary>Limite comum somando campanhas como mestre e participante; níveis não ampliam a quota.</summary>
    public const int FreeCampaignsPerMaster = 3;
    static void Validate(CampaignInput x)
    {
        if (string.IsNullOrWhiteSpace(x.Name) || x.Name.Length > 100 || x.System?.Length > 80 || x.Description == null || x.Description.Length > 5000)
            throw new RuleException(400, "Confira nome, sistema e descrição da campanha.");
    }
    async Task<Campaign> LockAsync(Guid id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql() ? db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {id} FOR UPDATE") : db.Campaigns.Where(x => x.Id == id);
        return await query.SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Campanha não encontrada.");
    }
    static void Owner(Campaign c, string user) { if (c.OwnerId != user) throw new RuleException(404, "Campanha não encontrada."); }
    public async Task<object> ListAsync(string user, string? search, string? sort, int page, CancellationToken ct)
    {
        if (search?.Length > 100) throw new RuleException(400, "Busca muito longa.");
        page = Math.Max(1, Math.Min(100000, page));
        var query = db.Campaigns.AsNoTracking().Where(c => c.OwnerId == user || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == user));
        if (!string.IsNullOrWhiteSpace(search)) { var term = search.Trim().ToLowerInvariant(); query = query.Where(x => x.Name.ToLower().Contains(term)); }
        var total = await query.CountAsync(ct);
        var ordered = sort == "name" ? query.OrderBy(x => x.Name).ThenBy(x => x.Id) : query.OrderByDescending(x => x.LastActivityAt).ThenBy(x => x.Id);
        var items = await ordered.Skip((page - 1) * 20).Take(20).Select(c => new
        {
            c.Id,
            c.Name,
            c.System,
            c.RpgSystemId,
            c.Description,
            c.Revision,
            c.LastActivityAt,
            c.IsOneShot,
            c.ExpiresAt,
            isMaster = c.OwnerId == user,
            playerCount = db.Members.Count(m => m.CampaignId == c.Id),
            canDelete = c.OwnerId == user && !db.Members.Any(m => m.CampaignId == c.Id),
            activeSessionId = db.Sessions.Where(s => s.CampaignId == c.Id && s.EndedAt == null).Select(s => (Guid?)s.Id).FirstOrDefault()
        }).ToListAsync(ct);
        var account = await db.Users.AsNoTracking().SingleAsync(u => u.Id == user, ct);
        return new { items, total, page, pageSize = 20, limits = await AccountLimits.SummaryAsync(db, account, ct) };
    }
    public async Task<Guid> CreateAsync(CampaignInput x, string user, CancellationToken ct)
    {
        Validate(x);
        var system = await RpgSystemService.ResolveForCampaignAsync(db, x.RpgSystemId, x.System, null, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var account = await AccountLimits.LockUserAsync(db, user, ct);
        var c = new Campaign { OwnerId = user, Name = x.Name.Trim(), Description = x.Description.Trim(), RpgSystemId = system.Id, System = system.Name,
            IsOneShot = x.IsOneShot, ExpiresAt = x.IsOneShot ? DateTime.UtcNow.AddHours(72) : null };
        await AccountLimits.ReserveAsync(db, account, c, ct);
        db.Campaigns.Add(c);
        await progression.AwardAsync(user, XpReasons.CampaignCreated, $"campaign_created:{c.Id}", ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return c.Id;
    }
    public async Task UpdateAsync(Guid id, CampaignInput x, string user, CancellationToken ct)
    {
        Validate(x); await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await LockAsync(id, ct); Owner(c, user);
        if (c.Revision != x.Revision) throw new RuleException(409, "A campanha mudou em outra sessão. Atualize a lista antes de editar.");
        // Um sistema que ficou inativo pode ser mantido pela campanha que já o usa.
        var system = await RpgSystemService.ResolveForCampaignAsync(db, x.RpgSystemId, x.System, c.RpgSystemId, ct);
        if (c.RpgSystemId != system.Id) c.SheetTemplateId = null;
        c.Name = x.Name.Trim(); c.RpgSystemId = system.Id; c.System = system.Name; c.Description = x.Description.Trim(); c.Revision++; c.LastActivityAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<object> SetSheetTemplateAsync(Guid id, CampaignSheetTemplateInput input, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var campaign = await LockAsync(id, ct);
        Owner(campaign, user);
        if (campaign.Revision != input.Revision) throw new RuleException(409, "A campanha mudou. Recarregue antes de escolher o modelo.");
        if (input.TemplateId is { } templateId && !await db.SheetTemplates.AnyAsync(t => t.Id == templateId && t.RpgSystemId == campaign.RpgSystemId && t.ArchivedAt == null && t.CurrentVersionId != null
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
        db.Campaigns.Remove(c); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<Guid> JoinAsync(string code, string user, CancellationToken ct)
    {
        if (code?.Length != 32) throw new RuleException(400, "Código de convite inválido.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var id = await db.Campaigns.Where(x => x.InviteCode == code).Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Convite não encontrado.");
        var c = await LockAsync(id, ct);
        OneShotLifecycleService.EnsureOpen(c, DateTime.UtcNow);
        if (c.OwnerId != user && !await db.Members.AnyAsync(x => x.CampaignId == id && x.UserId == user, ct))
        {
            var account = await AccountLimits.LockUserAsync(db, user, ct);
            await AccountLimits.ReserveAsync(db, account, c, ct);
            db.Members.Add(new() { CampaignId = id, UserId = user }); c.LastActivityAt = DateTime.UtcNow; c.Revision++;
            await progression.AwardAsync(user, XpReasons.CampaignJoined, $"campaign_joined:{id}:{user}", ct);
            await db.SaveChangesAsync(ct);
        }
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
    async Task RemoveMembershipAsync(Guid id, string user, CancellationToken ct)
    {
        if (await db.Members.Where(x => x.CampaignId == id && x.UserId == user).ExecuteDeleteAsync(ct) == 0) throw new RuleException(404, "Participação não encontrada.");
        await db.CampaignCharacters.Where(x => x.CampaignId == id && db.Characters.Any(c => c.Id == x.CharacterId && c.OwnerId == user)).ExecuteDeleteAsync(ct);
    }
}

public record CampaignSheetTemplateInput(Guid? TemplateId, int Revision);
