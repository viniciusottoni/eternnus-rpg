using Microsoft.EntityFrameworkCore;
using ImageMagick;
using System.Runtime.CompilerServices;
using System.Buffers.Binary;
namespace Eternnus.Web;

public record CampaignTextConvertInput(int Revision);
public record CampaignFolderInput(string Name, Guid? ParentId);
public record CampaignFolderNameInput(string Name);
public record CampaignMapInput(string Name, Guid? FolderId, int GridPixels, decimal ScaleMeters, int Revision = 0, bool HasGrid = true, int GridOffsetX = 0, int GridOffsetY = 0);
/// <summary>Mapa importado de um link https: o servidor baixa uma vez e trata como upload (ver RemoteImageFetcher).</summary>
public record CampaignMapImportInput(string Url, string Name, Guid? FolderId, int GridPixels, decimal ScaleMeters, bool HasGrid = true, int GridOffsetX = 0, int GridOffsetY = 0);
/// <summary>Preparação de névoa/luz de um mapa: estado completo editado no editor e a revisão lida.</summary>
public record MapLayerInput(bool? Fog, string[] Cells, List<FogLight>? Lights, string? Revealed, List<FogMarkInput>? Marks, int Revision, bool ResetExploration = false, string? PrepVersion = null);
public record CampaignMapView(Guid Id, string Name, Guid? FolderId, int GridPixels, decimal ScaleMeters, int PixelWidth, int PixelHeight, int Revision, string ImageUrl, bool HasGrid = true, int GridOffsetX = 0, int GridOffsetY = 0)
{
    public string Key => "asset:" + Id;
    /// <summary>Com grade: mapa tático (marcadores, névoa, movimento). Sem grade: imagem para cenas sem grade.</summary>
    public string Kind => HasGrid ? MapKinds.Tileset : MapKinds.Cartographic;
    public string Description => HasGrid ? $"Grade de {GridPixels} px · {ScaleMeters} m por quadrado" : "Imagem da campanha, sem grade";
    public int Width => HasGrid ? (PixelWidth - GridOffsetX) / GridPixels : 0;
    public int Height => HasGrid ? (PixelHeight - GridOffsetY) / GridPixels : 0;
    public string[] Rows => HasGrid ? Grid(PixelWidth, PixelHeight, GridPixels, GridOffsetX, GridOffsetY) : [];
    /// <summary>Mapa com grade para névoa e movimento; nulo para imagem sem grade.</summary>
    public BattleMap? Battle() => HasGrid ? new(Key, Name, Kind, Description, ImageUrl, Rows) { ScaleMeters = ScaleMeters } : null;
    /// <summary>
    /// Grade autoritativa: casas inteiras a partir do deslocamento (faixas parciais nas bordas ficam fora).
    /// Mesma conta em <c>scene-policy.js</c> (<c>gridFor</c>).
    /// </summary>
    public static string[] Grid(int pixelsWide, int pixelsHigh, int square, int offsetX = 0, int offsetY = 0)
    {
        var width = square <= 0 ? 0 : (pixelsWide - offsetX) / square; var height = square <= 0 ? 0 : (pixelsHigh - offsetY) / square;
        if (width < 1 || height < 1 || width > 100 || height > 100 || width * height > 4096) throw new RuleException(400, "A grade deve ter até 100 quadrados por lado e 4.096 casas. Aumente o tamanho do quadrado.");
        return Enumerable.Range(0, height).Select(y => new string(y == 0 ? 'S' : '.', width)).ToArray();
    }
}

/// <summary>Gestão prévia/durante sessão. Bytes privados pertencem à campanha e somem com ela.</summary>
public sealed class CampaignAssetsService(GameDb db, SessionSignals? signals = null)
{
    public const int MaxImageBytes = 10 * 1024 * 1024;
    public const int MaxImageRequestBytes = MaxImageBytes + 64 * 1024;
    const long MaxStorage = 250L * 1024 * 1024;
    public const int PageSize = 20;
    static readonly SemaphoreSlim Images = new(2);
    IQueryable<CampaignLibraryEntry> Texts => db.Set<CampaignLibraryEntry>();
    IQueryable<CampaignMap> Maps => db.Set<CampaignMap>();
    IQueryable<CampaignMapFolder> Folders => db.Set<CampaignMapFolder>();

    async Task<Campaign> Access(Guid campaign, string user, bool write, CancellationToken ct)
    {
        var c = await db.Campaigns.SingleOrDefaultAsync(x => x.Id == campaign, ct) ?? throw Missing();
        if (c.OwnerId != user && !await db.Members.AnyAsync(m => m.CampaignId == campaign && m.UserId == user, ct)) throw Missing();
        OneShotLifecycleService.EnsureOpen(c, DateTime.UtcNow);
        if (write && c.OwnerId != user) throw new RuleException(403, "Somente o mestre pode organizar a campanha.");
        return c;
    }
    async Task Lock(Guid campaign, string user, CancellationToken ct)
    {
        var resourceCampaign = await Access(campaign, user, true, ct);
        // One-shot encerra com sessão -> campanha. Preservar a ordem também na preparação de recursos.
        var active = db.Database.IsNpgsql()
            ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {campaign} AND \"EndedAt\" IS NULL FOR UPDATE").ToListAsync(ct)
            : await db.Sessions.Where(s => s.CampaignId == campaign && s.EndedAt == null).ToListAsync(ct);
        if (db.Database.IsNpgsql()) await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaign} FOR UPDATE").LoadAsync(ct);
        await db.Entry(resourceCampaign).ReloadAsync(ct);
        var current = await db.Sessions.Where(s => s.CampaignId == campaign && s.EndedAt == null).Select(s => s.Id).ToArrayAsync(ct);
        if (!current.Order().SequenceEqual(active.Select(s => s.Id).Order())) throw new RuleException(409, "A sessão mudou durante a preparação. Atualize e tente novamente.");
        await Access(campaign, user, true, ct);
    }
    public async Task EnsureMasterAsync(Guid campaign, string user, CancellationToken ct) => await Access(campaign, user, true, ct);
    async Task EnsureMapIdleAsync(Guid campaign, Guid mapId, CancellationToken ct)
    {
        var key = "asset:" + mapId;
        if (await db.Sessions.AnyAsync(s => s.CampaignId == campaign && s.EndedAt == null && s.MapKey == key, ct)) throw new RuleException(409, "Oculte ou troque o mapa da sessão antes de editar ou excluir.");
    }
    public async Task<object> LibraryAsync(Guid campaign, string user, int page, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        page = Math.Clamp(page, 1, 100000);
        var query = Texts.AsNoTracking().Where(x => x.CampaignId == campaign && x.ConvertedPageId == null && (c.OwnerId == user || x.Published));
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.UpdatedAt).ThenBy(x => x.Id).Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(ct);
        return new { items, total, page, pageSize = PageSize, systemId = c.RpgSystemId };
    }
    /// <summary>Copia um texto antigo para uma página do Mundo (mesmo título/texto; publicado vira "Toda a mesa", rascunho vira "Só eu").
    /// O texto é preservado e marcado com a página criada, saindo da lista do acervo antigo.</summary>
    public async Task<object> ConvertTextAsync(Guid campaign, Guid id, string user, CampaignTextConvertInput x, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        if (await db.Campaigns.AnyAsync(c => c.Id == campaign && c.ArchivedAt != null, ct)) throw new RuleException(409, "Restaure a campanha antes de editar.");
        var item = await Texts.SingleOrDefaultAsync(e => e.Id == id && e.CampaignId == campaign, ct) ?? throw Missing();
        if (item.ConvertedPageId != null) throw new RuleException(409, "Este texto já virou página. Procure-o em Mundo e acervo › Páginas.");
        if (item.Revision != x.Revision) throw Stale();
        if (await db.Set<WorkspacePage>().CountAsync(p => p.CampaignId == campaign, ct) >= 1000) throw new RuleException(409, "Limite de 1.000 páginas por campanha, incluindo lixeira.");
        var page = new WorkspacePage
        {
            CampaignId = campaign, OwnerId = user, Kind = item.Kind is "objective" or "clue" ? item.Kind : "text",
            Title = item.Title, Content = item.Text, Visibility = item.Published ? "table" : "self", UpdatedAt = DateTime.UtcNow,
        };
        db.Add(page); item.ConvertedPageId = page.Id; item.Revision++;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new { pageId = page.Id };
    }
    public async Task DeleteTextAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var item = await Texts.SingleOrDefaultAsync(x => x.CampaignId == campaign && x.Id == id && x.ConvertedPageId == null, ct) ?? throw Missing();
        db.Remove(item); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    static CampaignMapView View(CampaignMap m) => new(m.Id, m.Name, m.FolderId, m.GridPixels, m.ScaleMeters, m.Width, m.Height, m.Revision, $"/api/campaigns/{m.CampaignId}/assets/maps/{m.Id}/image", m.HasGrid, m.GridOffsetX, m.GridOffsetY);
    static IQueryable<CampaignMapView> Views(IQueryable<CampaignMap> query, Guid campaign) =>
        query.Select(m => new CampaignMapView(m.Id, m.Name, m.FolderId, m.GridPixels, m.ScaleMeters, m.Width, m.Height, m.Revision, $"/api/campaigns/{campaign}/assets/maps/{m.Id}/image", m.HasGrid, m.GridOffsetX, m.GridOffsetY));
    public async Task<object> MapTreeAsync(Guid campaign, string user, Guid? folderId, int page, CancellationToken ct)
    {
        await Access(campaign, user, true, ct); page = Math.Clamp(page, 1, 100000);
        await CheckFolder(campaign, folderId, ct);
        var folders = await Folders.AsNoTracking().Where(x => x.CampaignId == campaign).OrderBy(x => x.Name).Take(100).ToListAsync(ct);
        var query = Maps.AsNoTracking().Where(x => x.CampaignId == campaign && x.FolderId == folderId);
        var total = await query.CountAsync(ct);
        var items = await Views(query.OrderBy(x => x.Name).ThenBy(x => x.Id).Skip((page - 1) * PageSize).Take(PageSize), campaign).ToListAsync(ct);
        return new { folders, items, total, page, pageSize = PageSize, maxBytes = MaxImageBytes };
    }
    public async Task<List<CampaignMapView>> MapChoicesAsync(Guid campaign, CancellationToken ct) =>
        await Views(Maps.AsNoTracking().Where(m => m.CampaignId == campaign).OrderBy(m => m.Name).Take(50), campaign).ToListAsync(ct);
    public async Task<CampaignMapView?> ResolveMapAsync(Guid campaign, string key, CancellationToken ct)
    {
        if (!key.StartsWith("asset:") || !Guid.TryParse(key[6..], out var id)) return null;
        return await Views(Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id), campaign).SingleOrDefaultAsync(ct);
    }
    public async Task<CampaignMapFolder> CreateFolderAsync(Guid campaign, string user, CampaignFolderInput x, CancellationToken ct)
    {
        var name = Name(x.Name, 100);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        if (await Folders.CountAsync(f => f.CampaignId == campaign, ct) >= 100) throw new RuleException(409, "Limite de 100 pastas por campanha.");
        var parent = x.ParentId; var depth = 1;
        while (parent != null) { if (++depth > 8) throw new RuleException(400, "Use até oito níveis de pastas."); parent = (await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == parent, ct) ?? throw Missing()).ParentId; }
        var folder = new CampaignMapFolder { CampaignId = campaign, ParentId = x.ParentId, Name = name };
        db.Add(folder); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return folder;
    }
    /// <summary>Renomeia a pasta sob o mesmo bloqueio da campanha; o lugar na árvore e o conteúdo não mudam.</summary>
    public async Task<CampaignMapFolder> RenameFolderAsync(Guid campaign, Guid id, string user, CampaignFolderNameInput x, CancellationToken ct)
    {
        var name = Name(x.Name, 100);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var folder = await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == id, ct) ?? throw Missing();
        folder.Name = name; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return folder;
    }
    public async Task DeleteFolderAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var folder = await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == id, ct) ?? throw Missing();
        if (await Folders.AnyAsync(f => f.ParentId == id, ct) || await Maps.AnyAsync(m => m.FolderId == id, ct)) throw new RuleException(409, "Esvazie a pasta antes de excluir.");
        db.Remove(folder); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<CampaignMapView> SaveMapAsync(Guid campaign, Guid? id, string user, CampaignMapInput x, UploadedDocument? image, CancellationToken ct)
    {
        await Access(campaign, user, true, ct); var name = Name(x.Name, 120);
        if (x.GridPixels is < 8 or > 1024 || x.ScaleMeters is < 0.01m or > 1000m || decimal.Round(x.ScaleMeters, 2) != x.ScaleMeters) throw new RuleException(400, "Grade: 8–1.024 pixels. Escala: 0,01–1.000 metros, até duas casas decimais.");
        if (x.GridOffsetX < 0 || x.GridOffsetY < 0 || x.GridOffsetX >= x.GridPixels || x.GridOffsetY >= x.GridPixels) throw new RuleException(400, "O deslocamento da grade vai de 0 até o tamanho do quadrado menos 1 pixel.");
        (byte[] Bytes, int Width, int Height)? normalized = image == null ? null : await Normalize(image, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct); await CheckFolder(campaign, x.FolderId, ct);
        var map = id is { } key ? await Maps.SingleOrDefaultAsync(m => m.Id == key && m.CampaignId == campaign, ct) ?? throw Missing() : new CampaignMap { CampaignId = campaign };
        if (id != null && map.Revision != x.Revision) throw Stale();
        if (id != null) await EnsureMapIdleAsync(campaign, map.Id, ct);
        if (id == null && (normalized == null || await Maps.CountAsync(m => m.CampaignId == campaign, ct) >= 50)) throw new RuleException(409, "Selecione a imagem; limite de 50 mapas por campanha.");
        if (normalized is { } n)
        {
            var stored = await Maps.Where(m => m.CampaignId == campaign).SumAsync(m => (long)m.Content.Length, ct);
            if (stored - map.Content.Length + n.Bytes.Length > MaxStorage) throw new RuleException(409, "Os mapas desta campanha excedem 250 MB.");
            map.Content = n.Bytes; map.Width = n.Width; map.Height = n.Height;
        }
        if (x.HasGrid)
        {
            if (x.GridPixels > Math.Min(map.Width, map.Height)) throw new RuleException(400, "O quadrado deve caber na imagem.");
            _ = CampaignMapView.Grid(map.Width, map.Height, x.GridPixels, x.GridOffsetX, x.GridOffsetY);
        }
        else if (id != null && map.HasGrid)
        {
            // Cenas com grade continuariam apontando para um mapa sem casas: o mestre troca o cenário delas antes.
            var assetKey = "asset:" + map.Id;
            var scenes = await db.Scenes.CountAsync(s => s.CampaignId == campaign && s.MapKey == assetKey && s.Kind == SceneKinds.Map, ct);
            if (scenes > 0) throw new RuleException(409, $"{scenes} cena(s) usam este mapa com grade. Troque o cenário delas antes de deixar só a imagem.");
        }
        map.Name = name; map.FolderId = x.FolderId; map.GridPixels = x.GridPixels; map.ScaleMeters = x.ScaleMeters;
        map.HasGrid = x.HasGrid; map.GridOffsetX = x.HasGrid ? x.GridOffsetX : 0; map.GridOffsetY = x.HasGrid ? x.GridOffsetY : 0;
        if (id == null) db.Add(map); else map.Revision++;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return View(map);
    }
    public async Task DeleteMapAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var map = await Maps.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == id, ct) ?? throw Missing();
        await EnsureMapIdleAsync(campaign, id, ct);
        var key = "asset:" + id;
        // Camada compartilhada e camadas próprias de cenas ({chave}@{cena}).
        await db.Set<CampaignMapLayer>().Where(l => l.CampaignId == campaign && (l.MapKey == key || l.MapKey.StartsWith(key + "@"))).ExecuteDeleteAsync(ct);
        db.Remove(map); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    /// <summary>
    /// Bytes do mapa. Mestre recebe a imagem completa (ou, com <paramref name="asUser"/>, a versão de um jogador);
    /// jogador só durante a sessão ativa e, com névoa ativa, apenas os pixels das casas que já explorou.
    /// </summary>
    public async Task<byte[]> ImageAsync(Guid campaign, Guid id, string user, CancellationToken ct, string? asUser = null)
    {
        var c = await Access(campaign, user, false, ct);
        var key = "asset:" + id;
        var session = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.CampaignId == campaign && s.EndedAt == null && s.MapKey == key, ct);
        var master = c.OwnerId == user;
        if (!master && session == null) throw Missing();
        var map = await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id)
            .Select(m => new { m.Content, m.GridPixels, m.Revision, m.HasGrid, m.GridOffsetX, m.GridOffsetY }).SingleOrDefaultAsync(ct) ?? throw Missing();
        var viewer = master ? asUser : user;
        // Imagem sem grade (ou apresentada como cena sem grade) não tem névoa: só chega a jogadores enquanto está na mesa.
        if (viewer == null || session == null || !map.HasGrid) return map.Content;
        if (master && !await db.SessionParticipants.AnyAsync(p => p.SessionId == session.Id && p.UserId == viewer && !p.IsMaster, ct)) throw Missing();
        var scene = await new TableFogService(db).SceneAsync(session, c, false, ct);
        if (scene == null || !scene.Active) return map.Content;
        var view = scene.View(viewer);
        var known = scene.Settings.RememberExplored ? view.Explored : view.Visible;
        return await TableFogService.MaskAsync(id, map.Revision, map.Content, map.GridPixels, scene.Map.Width, scene.Map.Height, known, ct, map.GridOffsetX, map.GridOffsetY);
    }

    // ---------- Preparação de névoa e luz ----------
    async Task<BattleMap> LayerMapAsync(Guid campaign, string key, CancellationToken ct) =>
        await new TableFogService(db).MapAsync(campaign, key ?? "", ct) ?? throw new RuleException(404, "Mapa com grade não encontrado.");

    /// <summary>Mapa + camada preparada: a do mapa (compartilhada) ou, com <paramref name="sceneId"/> em modo próprio, a da cena.</summary>
    async Task<(BattleMap Map, string LayerKey, Scene? Scene)> LayerTargetAsync(Guid campaign, string key, Guid? sceneId, CancellationToken ct)
    {
        var map = await LayerMapAsync(campaign, key, ct);
        if (sceneId is not { } id) return (map, map.Key, null);
        var scene = await db.Scenes.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id && s.CampaignId == campaign, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        // O editor pode estar trocando o cenário da cena (ainda não salvo): a camada segue o mapa escolhido.
        return (map, scene.LayerMode == SceneLayerModes.Scene ? ScenePrep.LayerKey(map.Key, scene.Id) : map.Key, scene);
    }

    IQueryable<GameSession> LiveOn(Guid campaign, string mapKey, string layerKey) =>
        db.Sessions.Where(s => s.CampaignId == campaign && s.EndedAt == null && s.MapKey == mapKey && (s.LayerKey ?? s.MapKey) == layerKey);

    public async Task<object> LayerAsync(Guid campaign, string key, string user, CancellationToken ct, Guid? sceneId = null)
    {
        var c = await Access(campaign, user, true, ct);
        var fog = new TableFogService(db);
        var (map, layerKey, scene) = await LayerTargetAsync(campaign, key, sceneId, ct);
        var settings = await fog.CampaignSettingsAsync(c, ct);
        var (row, state) = await fog.LayerAsync(campaign, map, settings, false, ct, layerKey);
        var prep = TableFogService.PreparedOf(row, state, map, settings);
        var explored = new bool[map.Width * map.Height];
        foreach (var e in state.Explored.Values) explored = Bits.Or(explored, Bits.Decode(e, explored.Length));
        var asset = await ResolveMapAsync(campaign, map.Key, ct);
        var shared = layerKey == map.Key
            ? await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaign && s.MapKey == map.Key && s.LayerMode == SceneLayerModes.Map && s.Kind == SceneKinds.Map).OrderBy(s => s.Name).Select(s => new { s.Id, s.Name }).Take(20).ToListAsync(ct)
            : [];
        return new
        {
            key = map.Key, layerKey, mode = layerKey == map.Key ? SceneLayerModes.Map : SceneLayerModes.Scene, name = map.Name, kind = map.Kind, width = map.Width, height = map.Height, rows = map.Rows, imageUrl = map.ImageUrl, scaleMeters = map.ScaleMeters,
            gridPixels = asset?.GridPixels, gridOffsetX = asset?.GridOffsetX, gridOffsetY = asset?.GridOffsetY, pixelWidth = asset?.PixelWidth, pixelHeight = asset?.PixelHeight,
            fog = prep.Fog, manual = prep.Manual, cells = prep.Cells, lights = prep.Lights, revealed = prep.Revealed, marks = prep.Marks, explored = Bits.Encode(explored),
            revision = row?.Revision ?? 0, prepVersion = TableFogService.PrepVersion(prep), settings,
            inUse = await LiveOn(campaign, map.Key, layerKey).AnyAsync(ct),
            pending = row?.Prepared != null,
            sharedWith = shared.Where(s => s.Id != scene?.Id),
        };
    }

    /// <summary>
    /// Salva a preparação do mapa. Fora da mesa, vale para as próximas apresentações (explorações e percepções continuam).
    /// Com a camada na mesa, guarda a preparação sem alterar o estado ao vivo: aplicar é uma ação separada da mesa.
    /// </summary>
    public async Task<object> SaveLayerAsync(Guid campaign, string key, string user, MapLayerInput x, CancellationToken ct, Guid? sceneId = null)
    {
        var (map, layerKey, _) = await LayerTargetAsync(campaign, key, sceneId, ct);
        if (x.Cells == null || x.Cells.Length != map.Height || x.Cells.Any(r => r == null || r.Length != map.Width || !r.All(TableFog.IsValidCell)))
            throw new RuleException(400, "As marcas do mapa não correspondem à grade. Recarregue o editor.");
        var lights = x.Lights ?? [];
        if (lights.Count > TableFog.MaxLights) throw new RuleException(409, $"Limite de {TableFog.MaxLights} focos de luz por mapa.");
        var marks = x.Marks ?? [];
        if (marks.Count > TableFog.MaxMarks) throw new RuleException(409, $"Limite de {TableFog.MaxMarks} marcas ocultas por mapa.");
        var draft = new MapFogState { Fog = x.Fog, Cells = x.Cells };
        foreach (var l in lights) FogEdits.UpsertLight(draft, map.Width, map.Height, new FogLightInput(null, l.X, l.Y, l.Radius));
        draft.Revealed = Bits.Resize(x.Revealed, map.Width * map.Height);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var fog = new TableFogService(db);
        var owner = await db.Campaigns.SingleAsync(x2 => x2.Id == campaign, ct);
        var settings = await fog.CampaignSettingsAsync(owner, ct);
        var (row, current) = await fog.LayerAsync(campaign, map, settings, true, ct, layerKey);
        var basePrep = TableFogService.PreparedOf(row, current, map, settings);
        // Versão da preparação lida (não muda com explorações ao vivo); sem ela, a revisão da linha.
        if (x.PrepVersion != null ? x.PrepVersion != TableFogService.PrepVersion(basePrep) : (row?.Revision ?? 0) != x.Revision) throw Stale();
        draft.Manual = basePrep.Manual;
        // Explorações e quem já percebeu cada marca continuam com o servidor.
        foreach (var m in marks)
        {
            var valid = FogEdits.ValidMark(map.Width, map.Height, m);
            var old = m.Id == null ? null : current.Marks.FirstOrDefault(o => o.Id == m.Id);
            if (old != null) { valid.Id = old.Id; if (!x.ResetExploration) { valid.RevealedAll = old.RevealedAll; valid.RevealedTo = old.RevealedTo; } }
            draft.Marks.Add(valid);
        }
        var active = await LiveOn(campaign, map.Key, layerKey).SingleOrDefaultAsync(ct);
        CampaignMapLayer saved;
        var pending = false;
        if (active == null)
        {
            draft.Explored = x.ResetExploration ? [] : current.Explored;
            saved = fog.SaveState(campaign, layerKey, row, draft);
            saved.Prepared = null;
        }
        else
        {
            if (x.ResetExploration) throw new RuleException(409, "Este mapa está na mesa. Para recomeçar a exploração, use “Reiniciar cena” ou “Recomeçar exploração” na mesa.");
            var prep = ScenePrep.PrepOf(draft);
            var size = map.Width * map.Height;
            var live = Bits.Decode(current.Revealed, size);
            var nothingNew = ScenePrep.SameStructure(prep, current) && Bits.Or(live, Bits.Decode(prep.Revealed, size)).SequenceEqual(live);
            saved = row ?? fog.SaveState(campaign, layerKey, null, current);
            if (row != null) saved.Revision++;
            saved.Prepared = nothingNew ? null : prep.Serialize();
            saved.UpdatedAt = DateTime.UtcNow;
            pending = saved.Prepared != null;
            active.Revision++;
            var author = await db.Users.Where(u => u.Id == user).Select(u => u.DisplayName).SingleOrDefaultAsync(ct) ?? "Mestre";
            db.Events.Add(new TableEvent { CampaignId = campaign, SessionId = active.Id, UserId = user, Author = author, Kind = EventKinds.Map, Content = pending ? "Mestre salvou a preparação do mapa (ainda não aplicada à mesa)" : "Mestre salvou a preparação do mapa", MasterOnly = true, Data = "", CreatedAt = DateTime.UtcNow });
        }
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateException) { throw Stale(); }
        if (active != null) signals?.Pulse(active.Id);
        var after = pending ? ScenePrep.PrepOf(draft) : TableFogService.PreparedOf(saved, MapFogState.Parse(saved.State) ?? draft, map, settings);
        return new { revision = saved.Revision, prepVersion = TableFogService.PrepVersion(after), pendingLive = pending, inUse = active != null };
    }
    async Task CheckFolder(Guid campaign, Guid? folder, CancellationToken ct) { if (folder != null && !await Folders.AnyAsync(f => f.CampaignId == campaign && f.Id == folder, ct)) throw Missing(); }
    static string Name(string? value, int max) { var s = LibraryService.Clean(value ?? "", false); return s.Length is 0 || s.Length > max ? throw new RuleException(400, $"Informe um nome de até {max} caracteres.") : s; }
    static RuleException Missing() => new(404, "Recurso da campanha não encontrado.");
    static RuleException Stale() => new(409, "O recurso mudou. Atualize antes de editar novamente.");
    public static async Task<(byte[] Bytes, int Width, int Height)> Normalize(UploadedDocument image, CancellationToken ct)
    {
        if (image.Content.Length is 0 or > MaxImageBytes) throw new RuleException(413, "Envie uma imagem de até 10 MB.");
        if (image.ContentType is not (DocumentKinds.Jpeg or DocumentKinds.Png)) throw new RuleException(415, "Use uma imagem PNG ou JPEG.");
        if (image.ContentType == DocumentKinds.Png)
            for (var offset = 8; offset + 12 <= image.Content.Length;)
            {
                var length = BinaryPrimitives.ReadUInt32BigEndian(image.Content.AsSpan(offset, 4));
                if (length > image.Content.Length - offset - 12) throw new RuleException(400, "Imagem PNG danificada.");
                var chunk = System.Text.Encoding.ASCII.GetString(image.Content, offset + 4, 4);
                if (chunk is "acTL" or "fcTL" or "fdAT") throw new RuleException(400, "Use uma imagem estática, sem animação.");
                offset += checked((int)length + 12);
            }
        if (!await Images.WaitAsync(0, ct)) throw new RuleException(429, "Há imagens sendo preparadas. Tente novamente em instantes.");
        try
        {
            // Reaproveita a política global restritiva de coders/delegates/recursos dos avatares.
            RuntimeHelpers.RunClassConstructor(typeof(AvatarProcessor).TypeHandle);
            using var decoded = new MagickImage();
            var settings = new MagickReadSettings { Format = image.ContentType == DocumentKinds.Png ? MagickFormat.Png : MagickFormat.Jpeg };
            decoded.Ping(image.Content, settings);
            if (decoded.Width < 64 || decoded.Height < 64 || decoded.Width > 4096 || decoded.Height > 4096 || (long)decoded.Width * decoded.Height > 8000000) throw new RuleException(400, "Use imagem estática de 64–4.096 pixels por lado e até 8 milhões de pixels.");
            decoded.Read(image.Content, settings); ct.ThrowIfCancellationRequested(); decoded.AutoOrient(); decoded.Strip(); decoded.BackgroundColor = MagickColors.White; decoded.Alpha(AlphaAction.Remove); decoded.Quality = 88;
            var bytes = decoded.ToByteArray(MagickFormat.Jpeg);
            if (bytes.Length > MaxImageBytes) throw new RuleException(413, "A imagem preparada excede 10 MB.");
            return (bytes, (int)decoded.Width, (int)decoded.Height);
        }
        catch (MagickException) { throw new RuleException(400, "Imagem inválida, danificada ou acima dos limites permitidos."); }
        finally { Images.Release(); }
    }
}
