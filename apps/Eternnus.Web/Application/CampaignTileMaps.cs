using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record TileMapInput(string Name, Guid? FolderId, decimal ScaleMeters, string[] Rows, int Revision = 0, bool ResetPreparation = false);

public sealed partial class CampaignAssetsService
{
    public async Task<object> TileCatalogAsync(Guid campaign, string user, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        return new { items = MapTiles.All, minSide = 8, maxSide = 64, minSpawns = 6, maxMaps = MaxMaps };
    }
    public async Task<CampaignMapView> TileMapAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        return await Views(Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id && m.TileData != null), campaign)
            .SingleOrDefaultAsync(ct) ?? throw Missing();
    }
    public async Task<CampaignMapView> SaveTileMapAsync(Guid campaign, Guid? id, string user, TileMapInput x, CancellationToken ct)
    {
        var name = Name(x.Name, 120);
        var rows = MapTiles.Validate(x.Rows);
        if (x.ScaleMeters is < .01m or > 1000m || decimal.Round(x.ScaleMeters, 2) != x.ScaleMeters)
            throw new RuleException(400, "Informe a escala entre 0,01 e 1.000 metros, com até duas casas decimais.");
        var data = string.Join('\n', rows);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        if (await db.Campaigns.AnyAsync(c => c.Id == campaign && c.ArchivedAt != null, ct))
            throw new RuleException(409, "Restaure a campanha antes de editar mapas.");
        await CheckFolder(campaign, x.FolderId, ct);
        var map = id is { } mapId
            ? await Maps.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == mapId && m.TileData != null, ct) ?? throw Missing()
            : new CampaignMap { CampaignId = campaign, TileData = data };
        if (id != null)
        {
            if (map.Revision != x.Revision) throw Stale();
            await EnsureMapIdleAsync(campaign, map.Id, ct);
            if (map.TileData != data)
            {
                var key = "asset:" + map.Id;
                var layers = db.Set<CampaignMapLayer>().Where(l => l.CampaignId == campaign && (l.MapKey == key || l.MapKey.StartsWith(key + "@")));
                var scenes = await db.Scenes.Where(s => s.CampaignId == campaign && s.MapKey == key).Take(PreparationService.MaxScenes).ToListAsync(ct);
                if ((await layers.AnyAsync(ct) || scenes.Count > 0) && !x.ResetPreparation)
                    throw new RuleException(409, "O terreno tem preparação ou cenas. Confirme recriar a névoa e remover posições preparadas, ou salve uma cópia.");
                await layers.ExecuteDeleteAsync(ct);
                foreach (var scene in scenes)
                {
                    scene.Prepared = []; scene.Saved = []; scene.HasSaved = false;
                    scene.Revision++; scene.UpdatedAt = DateTime.UtcNow;
                }
            }
            map.Revision++;
        }
        else
        {
            if (await Maps.CountAsync(m => m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map, ct) >= MaxMaps)
                throw new RuleException(409, $"Limite de {MaxMaps} mapas por campanha.");
            db.Add(map);
        }
        map.Name = name; map.FolderId = x.FolderId; map.ScaleMeters = x.ScaleMeters; map.TileData = data;
        map.Width = rows[0].Length * 64; map.Height = rows.Length * 64;
        map.GridPixels = 64; map.GridOffsetX = 0; map.GridOffsetY = 0; map.HasGrid = true; map.FreeMovement = false;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return View(map);
    }
}
