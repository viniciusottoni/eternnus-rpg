namespace Eternnus.Web;

public partial class SessionService
{
    async Task CloseOneShotAsync(Access access, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CancellationToken ct)
    {
        // A campanha veio de consulta no-tracking: anexar para aplicar cascade no mesmo commit da sessão.
        db.Campaigns.Remove(db.Campaigns.Local.FirstOrDefault(c => c.Id == access.Campaign.Id) ?? access.Campaign);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        signals.Pulse(access.Session.Id);
    }
}
