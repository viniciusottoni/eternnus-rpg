using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Campos do formulário de "Salvar" do editor de mapa de imagem (a imagem achatada vai à parte).</summary>
public record MapCompositionInput(string? Composition, int Revision, string Name, string? Summary, int GridPixels, decimal ScaleMeters,
    bool HasGrid = true, int GridOffsetX = 0, int GridOffsetY = 0, bool FreeMovement = false);
public record MapSourceImportInput(string Url, string? Name);
public record MapSourceCopyInput(string From);
/// <summary>Grade proposta no assistente de alinhamento (somente leitura: nada é gravado).</summary>
public record MapGridImpactInput(int GridPixels, int GridOffsetX = 0, int GridOffsetY = 0);

/// <summary>
/// Mapas de imagem editáveis (ADR-081 §4): composição (artboard, camadas, elementos) + imagem achatada pelo navegador,
/// e imagens-fonte do mapa (<see cref="CampaignAssetPurposes.Layer"/>), lidas só pelo mestre.
/// </summary>
public sealed partial class CampaignAssetsService
{
    /// <summary>Imagem achatada (10 MiB) + composição (até 400 mil caracteres em UTF-8) + campos e margem do multipart.</summary>
    public const long MaxCompositionRequestBytes = MaxImageBytes + 2L * 1024 * 1024;

    static object SourceView(CampaignMap m) => new { m.Id, key = "asset:" + m.Id, m.Name, m.Width, m.Height, imageUrl = $"/api/campaigns/{m.CampaignId}/assets/maps/{m.Id}/image" };
    internal static JsonElement CompositionJson(CompositionDocument doc) => JsonSerializer.SerializeToElement(doc, EditorLayers.Json);

    async Task EnsureNotArchivedAsync(Guid campaign, CancellationToken ct)
    {
        if (await db.Campaigns.AnyAsync(c => c.Id == campaign && c.ArchivedAt != null, ct)) throw new RuleException(409, "Restaure a campanha antes de editar mapas.");
    }

    /// <summary>Documento do editor. Mapas antigos, sem composição, abrem com a imagem atual inteira na Base.</summary>
    public async Task<object> CompositionAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var row = await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map)
            .Select(m => new { Tiles = m.TileData != null, m.Composition, m.Width, m.Height, m.Summary }).SingleOrDefaultAsync(ct) ?? throw Missing();
        if (row.Tiles) throw new RuleException(409, "Edite este mapa no editor de tiles.");
        var view = await Views(Maps.AsNoTracking().Where(m => m.Id == id), campaign).SingleAsync(ct);
        var doc = MapComposition.Stored(row.Composition) ?? MapComposition.Synthesize(row.Width, row.Height);
        return new { map = view, summary = row.Summary, composition = CompositionJson(doc) };
    }

    /// <summary>
    /// Salva o documento e a imagem achatada numa única escrita. <c>self</c> vira uma imagem-fonte (sem recompressão sucessiva);
    /// imagens-fonte não referenciadas são removidas. A grade vem do artboard; marcadores preparados fora da nova grade saem das cenas.
    /// </summary>
    public async Task<object> SaveCompositionAsync(Guid campaign, Guid id, string user, MapCompositionInput x, UploadedDocument image, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var name = Name(x.Name, 120);
        var summary = x.Summary == null ? null : Summary(x.Summary);
        if (x.GridPixels is < 8 or > 1024 || x.ScaleMeters is < 0.01m or > 1000m || decimal.Round(x.ScaleMeters, 2) != x.ScaleMeters) throw new RuleException(400, "Grade: 8–1.024 pixels. Escala: 0,01–1.000 metros, até duas casas decimais.");
        if (x.GridOffsetX < 0 || x.GridOffsetY < 0 || x.GridOffsetX >= x.GridPixels || x.GridOffsetY >= x.GridPixels) throw new RuleException(400, "O deslocamento da grade vai de 0 até o tamanho do quadrado menos 1 pixel.");
        var (doc, sources, usesSelf) = MapComposition.Parse(x.Composition);
        // Camada secreta é recurso da composição de cenas: no mapa, a marca não tem efeito e sai.
        doc = MapComposition.WithoutMapKeys(MapComposition.WithoutSecrets(doc));
        var flat = await Normalize(image, ct);
        if (flat.Width != doc.Artboard!.Width || flat.Height != doc.Artboard.Height) throw new RuleException(400, "A imagem achatada não tem o tamanho da área visível. Salve novamente.");
        var hasGrid = x.HasGrid; var free = hasGrid && x.FreeMovement;
        string[]? grid = null;
        if (hasGrid)
        {
            if (x.GridPixels > Math.Min(flat.Width, flat.Height)) throw new RuleException(400, "O quadrado deve caber na imagem.");
            grid = CampaignMapView.Grid(flat.Width, flat.Height, x.GridPixels, x.GridOffsetX, x.GridOffsetY);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        await EnsureNotArchivedAsync(campaign, ct);
        var map = await Maps.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map, ct) ?? throw Missing();
        if (map.TileData != null) throw new RuleException(409, "Edite este mapa no editor de tiles.");
        if (map.Revision != x.Revision) throw Stale();
        await EnsureMapIdleAsync(campaign, map.Id, ct);
        var owned = await Maps.Where(m => m.CampaignId == campaign && m.OwnerMapId == map.Id && m.Purpose == CampaignAssetPurposes.Layer)
            .Select(m => new { m.Id, Size = m.Content.Length }).ToListAsync(ct);
        if (sources.Any(s => owned.All(o => o.Id != s))) throw new RuleException(400, "Composição inválida: há imagem que não pertence a este mapa.");
        CampaignMap? snapshot = null;
        if (usesSelf)
        {
            snapshot = new CampaignMap
            {
                CampaignId = campaign, OwnerMapId = map.Id, Purpose = CampaignAssetPurposes.Layer, Name = "Imagem original", HasGrid = false,
                Content = map.Content, Width = map.Width, Height = map.Height,
            };
            var key = "asset:" + snapshot.Id;
            doc = MapComposition.WithSources(doc, s => s == MapComposition.Self ? key : s);
        }
        if (sources.Count + (snapshot == null ? 0 : 1) > MapComposition.MaxSources) throw new RuleException(409, $"Limite de {MapComposition.MaxSources} imagens-fonte por mapa.");
        // Fontes que versões persistentes ainda usam (ADR-083) ficam guardadas; as demais sem uso saem.
        var versionRefs = (await db.Set<DocumentVersion>().AsNoTracking().Where(v => v.CampaignId == campaign && v.Kind == DocumentVersionKinds.ImageMap && v.DocumentId == map.Id)
            .Select(v => v.Refs).ToListAsync(ct)).SelectMany(DocumentVersionModel.ParseRefs).ToHashSet();
        var removed = owned.Where(o => !sources.Contains(o.Id) && !versionRefs.Contains(o.Id)).ToList();
        await AccountLimits.EnsureCampaignStorageAsync(db, campaign, flat.Bytes.Length - map.Content.Length + (snapshot?.Content.Length ?? 0) - removed.Sum(o => (long)o.Size), ct);
        if (!hasGrid && map.HasGrid)
        {
            var assetKey = "asset:" + map.Id;
            var count = await db.Scenes.CountAsync(s => s.CampaignId == campaign && s.MapKey == assetKey && s.Kind == SceneKinds.Map, ct);
            if (count > 0) throw new RuleException(409, $"{count} cena(s) usam este mapa com grade. Troque o cenário delas antes de deixar só a imagem.");
        }
        if (grid != null)
        {
            await PruneSceneTokensAsync(campaign, map.Id, grid[0].Length, grid.Length, ct);
            map.Entries = MapEntries.Fit(map.Entries, grid[0].Length, grid.Length);
        }
        if (removed.Count > 0)
        {
            var ids = removed.Select(o => o.Id).ToList();
            await Maps.Where(m => m.CampaignId == campaign && m.OwnerMapId == map.Id && ids.Contains(m.Id)).ExecuteDeleteAsync(ct);
        }
        if (snapshot != null) db.Add(snapshot);
        map.Content = flat.Bytes; map.Width = flat.Width; map.Height = flat.Height;
        map.Name = name; if (summary != null) map.Summary = summary;
        if (map.HasGrid && hasGrid) await RegridWallsAsync(campaign, map.Id, map.GridPixels, map.GridOffsetX, map.GridOffsetY, x.GridPixels, x.GridOffsetX, x.GridOffsetY, ct);
        map.HasGrid = hasGrid; map.GridPixels = x.GridPixels; map.ScaleMeters = x.ScaleMeters; map.FreeMovement = free;
        map.GridOffsetX = hasGrid ? x.GridOffsetX : 0; map.GridOffsetY = hasGrid ? x.GridOffsetY : 0;
        map.Composition = MapComposition.Serialize(doc);
        map.Revision++; map.UpdatedAt = DateTime.UtcNow;
        // Versão automática (ADR-083). Fontes liberadas por versões que saíram da retenção também são removidas.
        HashSet<Guid> current = snapshot == null ? sources : [.. sources, snapshot.Id];
        var kept = await DocumentVersionModel.RecordAsync(db, campaign, DocumentVersionKinds.ImageMap, map.Id, map.Revision, DocumentVersionModel.ImagePayload(map, doc), current, map.UpdatedAt, ct);
        var released = owned.Where(o => versionRefs.Contains(o.Id) && !current.Contains(o.Id) && !kept.Contains(o.Id)).Select(o => o.Id).ToList();
        if (released.Count > 0) await Maps.Where(m => m.CampaignId == campaign && m.OwnerMapId == map.Id && released.Contains(m.Id)).ExecuteDeleteAsync(ct);
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { throw Stale(); }
        await tx.CommitAsync(ct);
        return new { map = View(map), summary = map.Summary, composition = CompositionJson(doc) };
    }

    /// <summary>Mesma regra do ajuste de grade: marcadores preparados fora da nova grade saem das cenas que usam o mapa.</summary>
    async Task PruneSceneTokensAsync(Guid campaign, Guid mapId, int width, int height, CancellationToken ct)
    {
        var key = "asset:" + mapId;
        var scenes = await db.Scenes.Where(s => s.CampaignId == campaign && s.MapKey == key).Take(PreparationService.MaxScenes).ToListAsync(ct);
        foreach (var scene in scenes)
        {
            static bool Inside(SceneToken t, int w, int h) => t.X >= 0 && t.Y >= 0 && t.X < w && t.Y < h;
            if (scene.Prepared.All(t => Inside(t, width, height)) && scene.Saved.All(t => Inside(t, width, height))) continue;
            scene.Prepared = scene.Prepared.Where(t => Inside(t, width, height)).ToList();
            scene.Saved = scene.Saved.Where(t => Inside(t, width, height)).ToList();
            scene.Revision++; scene.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>
    /// Prévia do impacto de uma nova grade (P1.2), sem gravar nada: cenas que usam o mapa, marcadores preparados que ficariam fora,
    /// paredes (convertidas como em <see cref="RegridWallsAsync"/>), casas bloqueadas, luzes, marcas e pontos de entrada que sairiam,
    /// cenas com o mapa inserido na composição (ADR-113) e se o mapa está na mesa agora. Mesmas contas das escritas reais.
    /// </summary>
    public async Task<object> GridImpactAsync(Guid campaign, Guid id, string user, MapGridImpactInput x, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var map = await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map && m.TileData == null)
            .Select(m => new { m.Width, m.Height, m.HasGrid, m.GridPixels, m.GridOffsetX, m.GridOffsetY, m.Entries }).SingleOrDefaultAsync(ct) ?? throw Missing();
        if (x.GridPixels is < 8 or > 1024) throw new RuleException(400, "Grade: 8–1.024 pixels.");
        if (x.GridOffsetX < 0 || x.GridOffsetY < 0 || x.GridOffsetX >= x.GridPixels || x.GridOffsetY >= x.GridPixels) throw new RuleException(400, "O deslocamento da grade vai de 0 até o tamanho do quadrado menos 1 pixel.");
        if (x.GridPixels > Math.Min(map.Width, map.Height)) throw new RuleException(400, "O quadrado deve caber na imagem.");
        var rows = CampaignMapView.Grid(map.Width, map.Height, x.GridPixels, x.GridOffsetX, x.GridOffsetY);
        int w = rows[0].Length, h = rows.Length;
        int oldW = 0, oldH = 0;
        if (map.HasGrid && map.GridPixels > 0) { oldW = (map.Width - map.GridOffsetX) / map.GridPixels; oldH = (map.Height - map.GridOffsetY) / map.GridPixels; }
        var key = "asset:" + id;
        bool In(int cx, int cy) => cx >= 0 && cy >= 0 && cx < w && cy < h;
        var scenes = await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaign && s.MapKey == key).OrderBy(s => s.Name).ThenBy(s => s.Id)
            .Take(PreparationService.MaxScenes).ToListAsync(ct);
        var affected = new List<object>();
        var tokens = 0;
        foreach (var s in scenes)
        {
            // Mesma regra de PruneSceneTokensAsync: posição preparada (e a salva) fora da grade sai.
            var outside = s.Prepared.Count(t => !In(t.X, t.Y)) + s.Saved.Count(t => !In(t.X, t.Y));
            tokens += outside;
            if (outside > 0 && affected.Count < 20) affected.Add(new { s.Id, s.Name, tokensOutside = outside });
        }
        int walls = 0, cells = 0, lights = 0, marks = 0;
        var changed = map.HasGrid && (map.GridPixels != x.GridPixels || map.GridOffsetX != x.GridOffsetX || map.GridOffsetY != x.GridOffsetY);
        var layers = await db.Set<CampaignMapLayer>().AsNoTracking().Where(l => l.CampaignId == campaign && (l.MapKey == key || l.MapKey.StartsWith(key + "@")))
            .Select(l => l.Prepared ?? l.State).ToListAsync(ct);
        int ww = w * TableFog.WallUnit, wh = h * TableFog.WallUnit;
        foreach (var json in layers)
        {
            if (MapFogState.Parse(json) is not { } state) continue;
            var list = state.Walls ?? [];
            if (changed && map.GridPixels > 0) list = TableFog.Regrid(list, map.GridPixels, map.GridOffsetX, map.GridOffsetY, x.GridPixels, x.GridOffsetX, x.GridOffsetY);
            walls += list.Count(s => s.X1 < 0 || s.Y1 < 0 || s.X2 < 0 || s.Y2 < 0 || s.X1 > ww || s.X2 > ww || s.Y1 > wh || s.Y2 > wh);
            for (var cy = 0; cy < state.Cells.Length; cy++)
                for (var cx = 0; cx < state.Cells[cy].Length; cx++)
                    if (state.Cells[cy][cx] != TableFog.Free && !In(cx, cy)) cells++;
            lights += state.Lights.Count(l => !In(l.X, l.Y));
            marks += state.Marks.Count(m => !In(m.X, m.Y));
        }
        var entriesOutside = MapEntries.Parse(map.Entries).Count - MapEntries.Parse(MapEntries.Fit(map.Entries, w, h)).Count;
        var pattern = "\"mapKey\":\"" + key + "\"";
        var instances = await db.Scenes.CountAsync(s => s.CampaignId == campaign && s.Composition != null && s.Composition.Contains(pattern), ct);
        var inSession = await db.Sessions.AnyAsync(s => s.CampaignId == campaign && s.EndedAt == null && s.MapKey == key, ct);
        return new
        {
            width = w, height = h, oldWidth = oldW, oldHeight = oldH, scenes = scenes.Count, affected, tokensOutside = tokens,
            wallsOutside = walls, cellsOutside = cells, lightsOutside = lights, marksOutside = marks, entriesOutside, instances, inSession,
        };
    }

    /// <summary>Imagem-fonte enviada (PNG com transparência preservada).</summary>
    public async Task<object> AddSourceAsync(Guid campaign, Guid mapId, string user, string? name, UploadedDocument image, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var label = Name(string.IsNullOrWhiteSpace(name) ? "Imagem" : name, 120);
        var n = await Normalize(image, ct, keepAlpha: true);
        return await StoreSourceAsync(campaign, mapId, user, label, n.Bytes, n.Width, n.Height, ct);
    }

    /// <summary>Copia uma imagem da campanha (mapa de imagem ou retrato) como imagem-fonte do mapa.</summary>
    public async Task<object> CopySourceAsync(Guid campaign, Guid mapId, string user, MapSourceCopyInput x, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var from = x.From ?? "";
        if (!from.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal) || !Guid.TryParse(from[NpcImages.AssetPrefix.Length..], out var sourceId))
            throw new RuleException(400, "Escolha uma imagem desta campanha.");
        var source = await Maps.AsNoTracking()
            .Where(m => m.CampaignId == campaign && m.Id == sourceId && m.TileData == null && (m.Purpose == CampaignAssetPurposes.Map || m.Purpose == CampaignAssetPurposes.Portrait))
            .Select(m => new { m.Name, m.Content, m.Width, m.Height }).SingleOrDefaultAsync(ct) ?? throw Missing();
        return await StoreSourceAsync(campaign, mapId, user, source.Name, source.Content, source.Width, source.Height, ct);
    }

    internal async Task<object> StoreSourceAsync(Guid campaign, Guid mapId, string user, string name, byte[] content, int width, int height, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        await EnsureNotArchivedAsync(campaign, ct);
        if (!await Maps.AnyAsync(m => m.CampaignId == campaign && m.Id == mapId && m.Purpose == CampaignAssetPurposes.Map && m.TileData == null, ct)) throw Missing();
        if (await Maps.CountAsync(m => m.CampaignId == campaign && m.OwnerMapId == mapId && m.Purpose == CampaignAssetPurposes.Layer, ct) >= MapComposition.MaxSources)
            throw new RuleException(409, $"Limite de {MapComposition.MaxSources} imagens-fonte por mapa.");
        await AccountLimits.EnsureCampaignStorageAsync(db, campaign, content.Length, ct);
        var source = new CampaignMap
        {
            CampaignId = campaign, OwnerMapId = mapId, Purpose = CampaignAssetPurposes.Layer, Name = name, HasGrid = false,
            Content = content, Width = width, Height = height,
        };
        db.Add(source); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return SourceView(source);
    }
}
