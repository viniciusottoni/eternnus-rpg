using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Mapa de tiles. <c>Layers</c> (opcional): camadas do editor, fundidas na grade efetiva; ausente = <c>Rows</c> vira a Base.
/// <c>Summary</c> nulo mantém a descrição; <c>SourceKey</c> (cenário oficial) só na criação; <c>KeepFolder</c> mantém a pasta na edição.
/// </summary>
public record TileMapInput(string Name, Guid? FolderId, decimal ScaleMeters, string[]? Rows, int Revision = 0, bool ResetPreparation = false,
    string? Summary = null, string? SourceKey = null, List<TileLayerInput?>? Layers = null, bool KeepFolder = false);

public sealed partial class CampaignAssetsService
{
    static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    public async Task<object> TileCatalogAsync(Guid campaign, string user, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        return new { items = MapTiles.All, minSide = 8, maxSide = 64, minSpawns = 6, maxMaps = MaxMaps, maxLayers = EditorLayers.Max };
    }

    /// <summary>Mapa de tiles para o editor: campos do mapa + camadas (sintetizadas em mapas antigos), descrição e modelo de origem.</summary>
    public async Task<JsonObject> TileMapAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var row = await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id && m.TileData != null && m.Purpose == CampaignAssetPurposes.Map)
            .Select(m => new { m.Summary, m.SourceKey }).SingleOrDefaultAsync(ct) ?? throw Missing();
        var view = await Views(Maps.AsNoTracking().Where(m => m.Id == id), campaign).SingleAsync(ct);
        var node = JsonSerializer.SerializeToNode(view, WebJson)!.AsObject();
        node["layers"] = JsonSerializer.SerializeToNode(TileLayers.Parse(view.Composition, view.TileData!), WebJson);
        node["summary"] = row.Summary; node["sourceKey"] = row.SourceKey;
        return node;
    }

    public async Task<CampaignMapView> SaveTileMapAsync(Guid campaign, Guid? id, string user, TileMapInput x, CancellationToken ct)
    {
        var name = Name(x.Name, 120);
        var (layers, rows) = TileLayers.Merge(x.Layers ?? (IReadOnlyList<TileLayerInput?>)TileLayers.FromRows(MapTiles.Validate(x.Rows)));
        if (x.ScaleMeters is < .01m or > 1000m || decimal.Round(x.ScaleMeters, 2) != x.ScaleMeters)
            throw new RuleException(400, "Informe a escala entre 0,01 e 1.000 metros, com até duas casas decimais.");
        var summary = x.Summary == null ? null : Summary(x.Summary);
        var sourceKey = id == null ? SourceKey(x.SourceKey) : null;
        var data = string.Join('\n', rows);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        if (await db.Campaigns.AnyAsync(c => c.Id == campaign && c.ArchivedAt != null, ct))
            throw new RuleException(409, "Restaure a campanha antes de editar mapas.");
        if (id == null || !x.KeepFolder) await CheckFolder(campaign, x.FolderId, ct);
        var map = id is { } mapId
            ? await Maps.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == mapId && m.TileData != null && m.Purpose == CampaignAssetPurposes.Map, ct) ?? throw Missing()
            : new CampaignMap { CampaignId = campaign, TileData = data, SourceKey = sourceKey };
        if (id != null)
        {
            if (map.Revision != x.Revision) throw Stale();
            await EnsureMapIdleAsync(campaign, map.Id, ct);
            // Só a grade efetiva conta: mudar apenas camadas (sem mudar o resultado) não mexe na preparação.
            if (map.TileData != data)
            {
                var key = "asset:" + map.Id;
                var fogLayers = db.Set<CampaignMapLayer>().Where(l => l.CampaignId == campaign && (l.MapKey == key || l.MapKey.StartsWith(key + "@")));
                var scenes = await db.Scenes.Where(s => s.CampaignId == campaign && s.MapKey == key).Take(PreparationService.MaxScenes).ToListAsync(ct);
                if ((await fogLayers.AnyAsync(ct) || scenes.Count > 0) && !x.ResetPreparation)
                    throw new RuleException(409, "O terreno tem preparação ou cenas. Confirme recriar a névoa e remover posições preparadas, ou salve uma cópia.");
                await fogLayers.ExecuteDeleteAsync(ct);
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
        map.Name = name; map.ScaleMeters = x.ScaleMeters; map.TileData = data;
        map.Entries = MapEntries.Fit(map.Entries, rows[0].Length, rows.Length);
        if (id == null || !x.KeepFolder) map.FolderId = x.FolderId;
        map.Composition = TileLayers.Serialize(layers);
        if (summary != null) map.Summary = summary;
        map.Width = rows[0].Length * 64; map.Height = rows.Length * 64;
        map.GridPixels = 64; map.GridOffsetX = 0; map.GridOffsetY = 0; map.HasGrid = true; map.FreeMovement = false;
        map.UpdatedAt = DateTime.UtcNow;
        // Versão automática do documento salvo (ADR-083), na mesma transação.
        await DocumentVersionModel.RecordAsync(db, campaign, DocumentVersionKinds.TileMap, map.Id, map.Revision, DocumentVersionModel.TilePayload(map), null, map.UpdatedAt, ct);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return View(map);
    }
}
