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
}
