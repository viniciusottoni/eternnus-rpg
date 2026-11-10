using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Criação da one-shot pela página One-shot. A mesa nasce com sua sessão única aberta; não há "iniciar sessão" depois.</summary>
public record OneShotInput(string Name, string Description, Guid? RpgSystemId = null, string? System = null);

public partial class SessionService
{
    /// <summary>
    /// Cria campanha temporária, reserva a quota vitalícia e abre a sessão única na mesma transação.
    /// O mestre entra presente: a ausência de heartbeat por 45 s fecha a mesa, como em qualquer one-shot aberta.
    /// </summary>
    public async Task<object> CreateOneShotAsync(OneShotInput x, string user, CancellationToken ct)
    {
        var name = Trim(x.Name, 100, "Informe o nome da one-shot com até 100 caracteres.");
        var description = Trim(x.Description, 5000, "A premissa aceita até 5.000 caracteres.", false);
        if (x.System?.Length > 80) throw new RuleException(400, "Confira o sistema da one-shot.");
        var system = await RpgSystemService.ResolveForCampaignAsync(db, x.RpgSystemId, x.System, null, ct);
        var map = BattleMaps.All.First(m => m.Kind == MapKinds.Tileset);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var account = await AccountLimits.LockUserAsync(db, user, ct);
        var campaign = new Campaign
        {
            OwnerId = user, Name = name, Description = description, RpgSystemId = system.Id, System = system.Name,
            IsOneShot = true, ExpiresAt = Now.AddHours(72), MasterLastSeenAt = Now, LastActivityAt = Now
        };
        await AccountLimits.ReserveAsync(db, account, campaign, ct);
        db.Campaigns.Add(campaign);
        var session = new GameSession { CampaignId = campaign.Id, Number = 1, Title = name, Objective = "", StartedAt = Now, MapKind = map.Kind, MapKey = map.Key };
        db.Sessions.Add(session);
        db.SessionParticipants.Add(new() { SessionId = session.Id, UserId = user, IsMaster = true, JoinedAt = Now, LastSeenAt = Now });
        Event(session, user, await NameAsync(user, ct), EventKinds.Start, $"One-shot aberta — {name}", new { map = map.Name, mapKind = map.Kind });
        await Progression.AwardAsync(user, XpReasons.CampaignCreated, $"campaign_created:{campaign.Id}", ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { campaignId = campaign.Id, sessionId = session.Id };
    }

    /// <summary>
    /// Converte uma one-shot válida em campanha persistente, preservando sessão, fichas, mapas e histórico.
    /// Ordem de bloqueio comum: sessão ativa → campanha → contas (ordenadas). O mestre precisa de vaga na quota;
    /// jogadores sem vaga não são levados (as fichas continuam deles) e podem voltar pelo convite.
    /// </summary>
    public async Task<object> ConvertOneShotAsync(Guid campaignId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var session = db.Database.IsNpgsql()
            ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {campaignId} AND \"EndedAt\" IS NULL FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Sessions.SingleOrDefaultAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct);
        var campaign = db.Database.IsNpgsql()
            ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Campaigns.SingleOrDefaultAsync(c => c.Id == campaignId, ct);
        if (campaign == null || campaign.OwnerId != user)
        {
            if (campaign != null && await db.Members.AnyAsync(m => m.CampaignId == campaignId && m.UserId == user, ct)) throw new RuleException(403, "Somente o mestre converte a one-shot.");
            throw new RuleException(404, "Campanha não encontrada.");
        }
        if (!campaign.IsOneShot) throw new RuleException(409, "Esta mesa já é uma campanha persistente.");
        OneShotLifecycleService.EnsureOpen(campaign, Now);
        var owner = await AccountLimits.LockUserAsync(db, user, ct);
        if (!PlatformRoles.IsStaff(owner.Role) && await AccountLimits.CampaignCountAsync(db, user, ct) >= AccountLimits.Campaigns)
            throw new RuleException(409, $"Sua conta já usa as {AccountLimits.Campaigns} campanhas permitidas. Saia de uma campanha antes de converter esta one-shot.");
        var members = await db.Members.Where(m => m.CampaignId == campaignId).OrderBy(m => m.UserId).Select(m => m.UserId).ToListAsync(ct);
        var kept = 0; var removed = new List<string>();
        foreach (var member in members)
        {
            var account = await AccountLimits.LockUserAsync(db, member, ct);
            if (PlatformRoles.IsStaff(account.Role) || await AccountLimits.CampaignCountAsync(db, member, ct) < AccountLimits.Campaigns) { kept++; continue; }
            removed.Add(member);
        }
        foreach (var member in removed)
        {
            await db.Members.Where(m => m.CampaignId == campaignId && m.UserId == member).ExecuteDeleteAsync(ct);
            await db.CampaignCharacters.Where(l => l.CampaignId == campaignId && db.Characters.Any(c => c.Id == l.CharacterId && c.OwnerId == member)).ExecuteDeleteAsync(ct);
            if (session != null)
            {
                await db.SessionTokens.Where(t => t.SessionId == session.Id && db.Characters.Any(c => c.Id == t.CharacterId && c.OwnerId == member)).ExecuteDeleteAsync(ct);
                await db.SessionParticipants.Where(p => p.SessionId == session.Id && p.UserId == member).ExecuteUpdateAsync(p => p.SetProperty(x => x.LastSeenAt, (DateTime?)null), ct);
            }
        }
        campaign.IsOneShot = false; campaign.ExpiresAt = null; campaign.MasterLastSeenAt = null;
        campaign.Revision++; campaign.LastActivityAt = Now;
        if (session != null)
        {
            if (removed.Count > 0 && session.ActiveCharacterId != null && !await db.SessionParticipants.AnyAsync(p => p.SessionId == session.Id && p.CharacterId == session.ActiveCharacterId && p.LastSeenAt != null, ct))
            { session.ActiveCharacterId = null; session.ActiveTurnKey = null; }
            Event(session, user, await NameAsync(user, ct), EventKinds.Start, "A one-shot virou uma campanha persistente", new { converted = true, kept, removed = removed.Count });
            session.Revision++;
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        if (session != null) signals.Pulse(session.Id);
        return new { campaignId, kept, removed = removed.Count };
    }

    async Task CloseOneShotAsync(Access access, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CancellationToken ct)
    {
        // O lançamento de XP não pertence ao cascade da campanha e preserva o reconhecimento da one-shot.
        access.Session.EndedAt = Now;
        await AwardSessionXpAsync(access, ct);
        // A campanha veio de consulta no-tracking: anexar para aplicar cascade no mesmo commit da sessão.
        await db.Set<WorkspacePage>().Where(p => p.CampaignId == access.Campaign.Id && p.Kind != "note").ExecuteDeleteAsync(ct);
        db.Campaigns.Remove(db.Campaigns.Local.FirstOrDefault(c => c.Id == access.Campaign.Id) ?? access.Campaign);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        signals.Pulse(access.Session.Id);
    }
}
