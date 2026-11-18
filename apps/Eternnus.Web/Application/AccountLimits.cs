using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public static class AccountLimits
{
    public const int Campaigns = 3, OneShots = 10;
    public static async Task<AppUser> LockUserAsync(GameDb db, string id, CancellationToken ct)
    {
        var query = db.Database.IsNpgsql()
            ? db.Users.FromSqlInterpolated($"SELECT * FROM \"AspNetUsers\" WHERE \"Id\" = {id} FOR UPDATE")
            : db.Users.Where(u => u.Id == id);
        var user = await query.SingleOrDefaultAsync(ct) ?? throw new RuleException(401, "Entre novamente na sua conta.");
        // Pode haver uma entidade rastreada desde a autorização da requisição.
        await db.Entry(user).ReloadAsync(ct);
        return user;
    }
    public static Task<int> CampaignCountAsync(GameDb db, string id, CancellationToken ct) =>
        db.Campaigns.CountAsync(c => !c.IsOneShot && (c.OwnerId == id || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == id)), ct);

    public static async Task ReserveAsync(GameDb db, AppUser user, Campaign campaign, CancellationToken ct)
    {
        var unlimited = PlatformRoles.IsStaff(user.Role);
        if (!campaign.IsOneShot)
        {
            if (!unlimited && await CampaignCountAsync(db, user.Id, ct) >= Campaigns)
                throw new RuleException(409, "Sua conta permite até 3 campanhas ativas, somando as que você mestra e participa. Saia de uma campanha antes de criar ou entrar em outra.");
            return;
        }
        if (await db.OneShotParticipations.AnyAsync(p => p.CampaignId == campaign.Id && p.UserId == user.Id, ct)) return;
        if (!unlimited && user.OneShotParticipations >= OneShots)
            throw new RuleException(409, "Sua conta já utilizou as 10 participações em one-shots. Embaixadores não têm esse limite.");
        user.OneShotParticipations++;
        db.OneShotParticipations.Add(new() { UserId = user.Id, CampaignId = campaign.Id });
    }
    public static async Task<object> SummaryAsync(GameDb db, AppUser user, CancellationToken ct) => new
    {
        unlimited = PlatformRoles.IsStaff(user.Role),
        activeCampaigns = await CampaignCountAsync(db, user.Id, ct),
        campaignLimit = PlatformRoles.IsStaff(user.Role) ? (int?)null : Campaigns,
        oneShotParticipations = user.OneShotParticipations,
        oneShotLimit = PlatformRoles.IsStaff(user.Role) ? (int?)null : OneShots
    };

    /// <summary>Resumo da conta com o armazenamento (somente leitura, ADR-096). Usado só em <c>GET /auth/limits</c>,
    /// para não somar bytes a cada listagem de campanhas.</summary>
    public static async Task<object> AccountAsync(GameDb db, AppUser user, CancellationToken ct) => new
    {
        unlimited = PlatformRoles.IsStaff(user.Role),
        activeCampaigns = await CampaignCountAsync(db, user.Id, ct),
        campaignLimit = PlatformRoles.IsStaff(user.Role) ? (int?)null : Campaigns,
        oneShotParticipations = user.OneShotParticipations,
        oneShotLimit = PlatformRoles.IsStaff(user.Role) ? (int?)null : OneShots,
        storage = await StorageAsync(db, user.Id, ct)
    };

    /// <summary>
    /// Uso de armazenamento das campanhas e one-shots que a pessoa mestra, por tipo, mais os retratos das próprias fichas. Não cria cota de conta: a única regra
    /// aplicada continua sendo <see cref="CampaignAssetsService.MaxStorage"/> de imagens por campanha; <c>capacity</c> é a soma
    /// dessas cotas. Textos contam caracteres (estimativa, sem codificação). Agregados no banco, sem carregar conteúdo.
    /// </summary>
    public static async Task<StorageUsage> StorageAsync(GameDb db, string id, CancellationToken ct)
    {
        var owned = db.Campaigns.Where(c => c.OwnerId == id).Select(c => c.Id);
        var campaigns = await owned.CountAsync(ct);
        var images = await db.Set<CampaignMap>().Where(m => owned.Contains(m.CampaignId)).SumAsync(m => (long)m.Content.Length, ct);
        var pages = db.Set<WorkspacePage>().Where(p => p.CampaignId != null && owned.Contains(p.CampaignId.Value));
        var attachments = await db.Set<WorkspaceAttachment>().Where(a => pages.Any(p => p.Id == a.PageId)).SumAsync(a => a.Size, ct)
            + await db.Set<AtlasPublication>().Where(a => owned.Contains(a.CampaignId)).SumAsync(a => (long)a.Content.Length, ct);
        var versions = await db.Set<DocumentVersion>().Where(v => owned.Contains(v.CampaignId)).SumAsync(v => (long)v.Size, ct)
            + await db.Set<WorkspaceVersion>().Where(v => pages.Any(p => p.Id == v.PageId)).SumAsync(v => (long)v.Snapshot.Length, ct);
        var texts = await pages.SumAsync(p => (long)p.Title.Length + p.Content.Length + p.Secrets.Length, ct)
            + await db.Set<MasterResource>().Where(r => owned.Contains(r.CampaignId)).SumAsync(r => (long)r.Name.Length + r.Content.Length, ct)
            + await db.Set<CampaignLibraryEntry>().Where(e => owned.Contains(e.CampaignId)).SumAsync(e => (long)e.Title.Length + e.Text.Length, ct)
            + await db.Set<PastSession>().Where(s => owned.Contains(s.CampaignId)).SumAsync(s => (long)s.Title.Length + s.Summary.Length, ct);
        // Retratos pertencem às fichas da pessoa (não a uma campanha), ADR-097.
        var portraits = await db.Set<CharacterPortrait>().Where(p => db.Characters.Any(c => c.Id == p.CharacterId && c.OwnerId == id)).SumAsync(p => p.Size, ct);
        return new(campaigns, campaigns * CampaignAssetsService.MaxStorage, CampaignAssetsService.MaxStorage, images, attachments, versions, texts, portraits);
    }
}

/// <summary>Bytes por tipo nas campanhas mestradas. <see cref="Images"/> é o único tipo limitado (por campanha).</summary>
public sealed record StorageUsage(int Campaigns, long Capacity, long PerCampaign, long Images, long Attachments, long Versions, long Texts, long Portraits)
{
    public long Used => Images + Attachments + Versions + Texts + Portraits;
}
