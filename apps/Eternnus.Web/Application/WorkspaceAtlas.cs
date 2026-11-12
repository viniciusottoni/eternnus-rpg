using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;
public sealed partial class WorkspaceService
{
    public async Task<object> Atlas(Guid campaign, string user, int page, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct); page = Math.Clamp(page, 1, 100000);
        var q = db.Set<AtlasPublication>().Where(m => m.CampaignId == campaign);
        return new { items = await q.OrderBy(m => m.Name).ThenBy(m => m.Id).Skip((page - 1) * 20).Take(20).Select(m => new { m.Id, m.Name, m.SourceMapId }).ToListAsync(ct), total = await q.CountAsync(ct), page,
            candidates = c.OwnerId == user ? await db.Set<CampaignMap>().Where(m => m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map && m.TileData == null).OrderBy(m => m.Name).Take(50).Select(m => new { m.Id, m.Name }).ToListAsync(ct) : [] };
    }
    public async Task PublishMap(Guid campaign, Guid id, string user, bool remove, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre publica mapas.");
        var published = await db.Set<AtlasPublication>().SingleOrDefaultAsync(m => m.CampaignId == campaign && m.SourceMapId == id, ct);
        if (remove) { if (published != null) db.Remove(published); }
        else
        {
            // Retrato de NPC não é publicado como mapa.
            var m = await db.Set<CampaignMap>().SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map && m.TileData == null, ct) ?? throw Missing();
            if (published == null) { published = new AtlasPublication { CampaignId = campaign, SourceMapId = id }; db.Add(published); }
            published.Name = m.Name; published.Content = m.Content.ToArray();
            await NoticeService.NotifyAsync(db, campaign, user, NoticeAreas.Atlas, published.Id.ToString(), NoticeAudience.Players, ct);
        }
        if (remove && published != null) await NoticeService.ForgetAsync(db, campaign, published.Id.ToString(), ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<byte[]> AtlasImage(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await Access(campaign, user, false, ct);
        return await db.Set<AtlasPublication>().Where(m => m.CampaignId == campaign && m.Id == id).Select(m => m.Content).SingleOrDefaultAsync(ct) ?? throw Missing();
    }
}
