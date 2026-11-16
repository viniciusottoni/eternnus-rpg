using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record PrepFolderInput(string Name, Guid? ParentId, string Category);
/// <summary>Item da Preparação: <c>scene</c>, <c>map</c>, <c>character</c> ou <c>folder</c>.</summary>
public record PrepItemRef(string Type, Guid Id);
public record PrepItemsInput(string Category, Guid? FolderId, List<PrepItemRef?>? Items);
/// <summary>Renomear item; pastas ignoram <c>Revision</c>.</summary>
public record PrepRenameInput(string Type, Guid Id, string Name, int Revision = 0);

/// <summary>
/// Preparação unificada (ADR-081): explorador com três raízes fixas (Cenas, Mapas, Personagens), pastas por categoria,
/// mover, copiar e renomear. Só o mestre; escritas sob o bloqueio da campanha (<see cref="CampaignAssetsService.Lock"/>).
/// Mover não muda ids, referências nem revisões.
/// </summary>
public sealed class PrepWorkspaceService(GameDb db)
{
    public const int MaxItems = 200;
    const string SceneType = "scene", MapType = "map", CharacterType = "character", FolderType = "folder";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    readonly CampaignAssetsService assets = new(db);
    IQueryable<CampaignMapFolder> Folders => db.Set<CampaignMapFolder>();
    IQueryable<CampaignMap> Maps => db.Set<CampaignMap>();
    static DateTime Now => DateTime.UtcNow;

    static string? CategoryOf(string? type) => type switch
    {
        SceneType => PrepCategories.Scenes, MapType => PrepCategories.Maps, CharacterType => PrepCategories.Characters, _ => null,
    };

    async Task BeginWriteAsync(Guid campaign, string user, CancellationToken ct)
    {
        await assets.Lock(campaign, user, ct);
        if (await db.Campaigns.AnyAsync(c => c.Id == campaign && c.ArchivedAt != null, ct))
            throw new RuleException(409, "Esta campanha está arquivada. Restaure-a para voltar a prepará-la.");
    }

    // ---------- Explorador ----------
    public async Task<object> ExplorerAsync(Guid campaign, string user, CancellationToken ct)
    {
        await assets.EnsureMasterAsync(campaign, user, ct);
        var archived = await db.Campaigns.AsNoTracking().Where(c => c.Id == campaign).Select(c => c.ArchivedAt != null).SingleAsync(ct);
        var active = await db.Sessions.AsNoTracking().Where(s => s.CampaignId == campaign && s.EndedAt == null).Select(s => new { s.Id, s.SceneId, s.MapKey }).FirstOrDefaultAsync(ct);
        var folders = await Folders.AsNoTracking().Where(f => f.CampaignId == campaign).OrderBy(f => f.Category).ThenBy(f => f.Name).ThenBy(f => f.Id)
            .Take(CampaignAssetsService.MaxFolders * PrepCategories.All.Length).Select(f => new { f.Id, f.Name, f.ParentId, f.Category }).ToListAsync(ct);

        // Mapas: só os da categoria Mapas (retratos e imagens-fonte nunca aparecem). Campos da vista + metadados, em duas consultas limitadas.
        var mapQuery = Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map).OrderBy(m => m.Name).ThenBy(m => m.Id).Take(CampaignAssetsService.MaxMaps);
        var views = await assets.MapViewsAsync(mapQuery, campaign, ct);
        var extras = await mapQuery.Select(m => new { m.Id, m.Summary, m.SourceKey, m.CreatedAt, m.UpdatedAt }).ToDictionaryAsync(m => m.Id, ct);
        var usage = await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaign && s.MapKey.StartsWith("asset:"))
            .GroupBy(s => s.MapKey).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var maps = views.Select(v =>
        {
            var node = JsonSerializer.SerializeToNode(v, Web)!.AsObject();
            var extra = extras[v.Id];
            node["summary"] = extra.Summary; node["sourceKey"] = extra.SourceKey; node["origin"] = v.IsTileMap ? "tiles" : "image";
            node["createdAt"] = extra.CreatedAt; node["updatedAt"] = extra.UpdatedAt;
            node["scenes"] = usage.GetValueOrDefault(v.Key); node["inUse"] = active?.MapKey == v.Key;
            return node;
        }).ToList();

        var scenes = await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaign).OrderBy(s => s.Order).ThenBy(s => s.Name).ThenBy(s => s.Id).Take(PreparationService.MaxScenes).ToListAsync(ct);
        var mapNames = views.ToDictionary(v => v.Key, v => v.Name);
        var resourceIds = scenes.Where(s => s.MapKey.StartsWith("resource:")).Select(s => Guid.TryParse(s.MapKey[9..], out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().ToList();
        if (resourceIds.Count > 0)
            foreach (var r in await db.Resources.AsNoTracking().Where(r => r.CampaignId == campaign && resourceIds.Contains(r.Id)).Select(r => new { r.Id, r.Name }).ToListAsync(ct))
                mapNames["resource:" + r.Id] = r.Name;
        string? MapName(string key) => key.Length == 0 ? null : mapNames.GetValueOrDefault(key) ?? BattleMaps.Find(key)?.Name;

        var npcs = await db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaign).OrderBy(m => m.Name).ThenBy(m => m.Id).Take(PreparationService.MaxNpcs)
            .Select(m => new { m.Id, m.Name, m.Summary, m.Kind, m.Side, m.SourceId, m.SharedWithPlayers, m.ImageUrl, m.TemplateVersionId, m.FolderId, m.Revision, m.CreatedAt, m.UpdatedAt }).ToListAsync(ct);
        var versionIds = npcs.Where(m => m.TemplateVersionId != null).Select(m => m.TemplateVersionId!.Value).Distinct().ToList();
        var templates = versionIds.Count == 0 ? [] : await db.SheetTemplateVersions.AsNoTracking().Where(v => versionIds.Contains(v.Id))
            .Join(db.SheetTemplates, v => v.TemplateId, t => t.Id, (v, t) => new { v.Id, t.Name }).ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        return new
        {
            folders,
            scenes = scenes.Select(s => new
            {
                s.Id, s.Name, s.Description, s.Kind, s.MapKey, mapName = MapName(s.MapKey), s.LayerMode, s.VisionMode, prepared = s.Prepared.Count, s.HasSaved,
                current = active?.SceneId == s.Id, s.Order, s.Revision, s.FolderId, s.CreatedAt, s.UpdatedAt,
            }),
            maps,
            characters = npcs.Select(m => new
            {
                m.Id, m.Name, m.Summary, m.Kind, m.Side, copy = m.SourceId != null, m.SharedWithPlayers,
                imagePreview = SessionService.PreviewUrl(new MasterCharacter { CampaignId = campaign, ImageUrl = m.ImageUrl }),
                templateName = m.TemplateVersionId is { } v && templates.TryGetValue(v, out var name) ? name : null,
                m.FolderId, m.Revision, m.CreatedAt, m.UpdatedAt,
            }),
            activeSessionId = active?.Id,
            archived,
            limits = new
            {
                foldersPerCategory = CampaignAssetsService.MaxFolders, depth = CampaignAssetsService.MaxFolderDepth,
                scenes = PreparationService.MaxScenes, maps = CampaignAssetsService.MaxMaps, characters = PreparationService.MaxNpcs,
            },
        };
    }

    // ---------- Pastas ----------
    static object FolderView(CampaignMapFolder f) => new { f.Id, f.Name, f.ParentId, f.Category };

    public async Task<object> CreateFolderAsync(Guid campaign, string user, PrepFolderInput x, CancellationToken ct)
    {
        var category = PrepCategories.Require(x.Category);
        var name = CampaignAssetsService.Name(x.Name, 100);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaign, user, ct);
        await assets.CheckFolderLimitsAsync(campaign, category, x.ParentId, 1, ct);
        var folder = new CampaignMapFolder { CampaignId = campaign, ParentId = x.ParentId, Name = name, Category = category };
        db.Add(folder); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return FolderView(folder);
    }

    public async Task<object> RenameFolderAsync(Guid campaign, Guid id, string user, CampaignFolderNameInput x, CancellationToken ct)
    {
        var name = CampaignAssetsService.Name(x.Name, 100);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaign, user, ct);
        var folder = await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == id, ct) ?? throw CampaignAssetsService.Missing();
        folder.Name = name; await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return FolderView(folder);
    }

    public async Task DeleteFolderAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaign, user, ct);
        var folder = await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == id, ct) ?? throw CampaignAssetsService.Missing();
        await assets.EnsureFolderEmptyAsync(folder, ct);
        db.Remove(folder); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    // ---------- Mover e copiar ----------
    /// <summary>Árvore de pastas de uma categoria (até 100) e o destino validado, com a cadeia destino → raiz.</summary>
    sealed record Tree(Dictionary<Guid, CampaignMapFolder> ById, ILookup<Guid?, CampaignMapFolder> Children, CampaignMapFolder? Target, HashSet<Guid> TargetChain)
    {
        public int Height(CampaignMapFolder f) => 1 + Children[f.Id].Select(Height).DefaultIfEmpty(0).Max();
        public IEnumerable<CampaignMapFolder> Subtree(CampaignMapFolder f) => Children[f.Id].SelectMany(Subtree).Prepend(f);
    }

    static (string Category, List<PrepItemRef> Items) Validate(PrepItemsInput? x)
    {
        var category = PrepCategories.Require(x?.Category);
        var items = x!.Items ?? [];
        if (items.Count is 0 or > MaxItems) throw new RuleException(400, $"Selecione de 1 a {MaxItems} itens.");
        if (items.Any(i => i == null || (i.Type != FolderType && CategoryOf(i.Type) == null))) throw new RuleException(400, "Tipo de item inválido.");
        if (items.Select(i => CategoryOf(i!.Type)).FirstOrDefault(c => c != null && c != category) is { } other)
            throw new RuleException(400, CampaignAssetsService.PrepCategoryMessage(other));
        return (category, items.Select(i => i!).DistinctBy(i => (i.Type, i.Id)).ToList());
    }

    async Task<Tree> TreeAsync(Guid campaign, string category, Guid? targetId, bool track, CancellationToken ct)
    {
        var query = Folders.Where(f => f.CampaignId == campaign && f.Category == category);
        var list = await (track ? query : query.AsNoTracking()).Take(CampaignAssetsService.MaxFolders * 2).ToListAsync(ct);
        var byId = list.ToDictionary(f => f.Id);
        CampaignMapFolder? target = null;
        if (targetId is { } id)
            target = byId.GetValueOrDefault(id) ?? (await Folders.AnyAsync(f => f.CampaignId == campaign && f.Id == id, ct)
                ? throw new RuleException(400, CampaignAssetsService.PrepCategoryMessage(category)) : throw CampaignAssetsService.Missing());
        var chain = new HashSet<Guid>();
        for (var f = target; f != null && chain.Add(f.Id); f = f.ParentId is { } p ? byId.GetValueOrDefault(p) : null) { }
        return new Tree(byId, list.ToLookup(f => f.ParentId), target, chain);
    }

    async Task<List<CampaignMapFolder>> FolderItemsAsync(Guid campaign, Tree tree, IEnumerable<PrepItemRef> items, CancellationToken ct)
    {
        var result = new List<CampaignMapFolder>();
        foreach (var item in items.Where(i => i.Type == FolderType))
        {
            if (!tree.ById.TryGetValue(item.Id, out var folder))
                throw await Folders.AnyAsync(f => f.CampaignId == campaign && f.Id == item.Id, ct)
                    ? new RuleException(400, "Pastas só ficam dentro de pastas da mesma categoria.") : CampaignAssetsService.Missing();
            if (tree.TargetChain.Contains(folder.Id)) throw new RuleException(400, "Uma pasta não pode ir para dentro dela mesma ou de uma subpasta.");
            if (tree.Height(folder) + tree.TargetChain.Count > CampaignAssetsService.MaxFolderDepth) throw new RuleException(400, "Use até oito níveis de pastas.");
            result.Add(folder);
        }
        return result;
    }

    static List<Guid> IdsOf(IEnumerable<PrepItemRef> items, string type) => items.Where(i => i.Type == type).Select(i => i.Id).ToList();
    static void RequireAll(int found, int expected) { if (found != expected) throw CampaignAssetsService.Missing(); }

    /// <summary>Move itens e pastas para a pasta de destino (nula = raiz). Tudo ou nada; ids, referências e revisões não mudam.</summary>
    public async Task<object> MoveAsync(Guid campaign, string user, PrepItemsInput x, CancellationToken ct)
    {
        var (category, items) = Validate(x);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaign, user, ct);
        var tree = await TreeAsync(campaign, category, x.FolderId, true, ct);
        var target = tree.Target?.Id;
        foreach (var folder in await FolderItemsAsync(campaign, tree, items, ct)) folder.ParentId = target;
        var sceneIds = IdsOf(items, SceneType);
        if (sceneIds.Count > 0)
        {
            var rows = await db.Scenes.Where(s => s.CampaignId == campaign && sceneIds.Contains(s.Id)).ToListAsync(ct);
            RequireAll(rows.Count, sceneIds.Count); rows.ForEach(s => s.FolderId = target);
        }
        var mapIds = IdsOf(items, MapType);
        if (mapIds.Count > 0)
        {
            var rows = await Maps.Where(m => m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map && mapIds.Contains(m.Id))
                .Select(m => new { m.Id }).ToListAsync(ct);
            RequireAll(rows.Count, mapIds.Count);
            // Sem carregar os bytes: só a pasta muda.
            await Maps.Where(m => m.CampaignId == campaign && mapIds.Contains(m.Id)).ExecuteUpdateAsync(u => u.SetProperty(m => m.FolderId, target), ct);
        }
        var npcIds = IdsOf(items, CharacterType);
        if (npcIds.Count > 0)
        {
            var rows = await db.MasterCharacters.Where(m => m.CampaignId == campaign && npcIds.Contains(m.Id)).ToListAsync(ct);
            RequireAll(rows.Count, npcIds.Count); rows.ForEach(m => m.FolderId = target);
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new { moved = items.Count };
    }

    /// <summary>
    /// Duplica itens e pastas (recursivamente, com o conteúdo da mesma categoria) na pasta de destino. Tudo ou nada; 409 nos limites.
    /// Cenas levam a preparação própria sem explorações; mapas levam bytes, tiles, composição, imagens-fonte e a preparação de névoa
    /// sem explorações; personagens viram cópias independentes (não "cópias de encontro").
    /// </summary>
    public async Task<object> CopyAsync(Guid campaign, string user, PrepItemsInput x, CancellationToken ct)
    {
        var (category, items) = Validate(x);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaign, user, ct);
        var tree = await TreeAsync(campaign, category, x.FolderId, false, ct);
        var now = Now;
        var created = new List<object>();
        var folderMap = new Dictionary<Guid, Guid>();
        var topFolders = await FolderItemsAsync(campaign, tree, items, ct);
        var copiedFolders = topFolders.SelectMany(tree.Subtree).DistinctBy(f => f.Id).ToList();
        if (copiedFolders.Count > 0 && tree.ById.Count + copiedFolders.Count > CampaignAssetsService.MaxFolders)
            throw new RuleException(409, $"Limite de {CampaignAssetsService.MaxFolders} pastas por categoria.");
        // Pais antes dos filhos: a ordem da subárvore já começa pela raiz copiada.
        foreach (var f in copiedFolders)
        {
            var top = topFolders.Contains(f);
            var copy = new CampaignMapFolder
            {
                CampaignId = campaign, Category = category, Name = top ? PreparationService.Cut(f.Name, 92) + " (cópia)" : f.Name,
                ParentId = top ? tree.Target?.Id : folderMap.GetValueOrDefault(f.ParentId!.Value),
            };
            folderMap[f.Id] = copy.Id; db.Add(copy);
            if (top) created.Add(new { type = FolderType, copy.Id });
        }
        var inFolders = folderMap.Keys.ToList();
        // Itens escolhidos (vão para o destino) + conteúdo das pastas copiadas (vão para a pasta correspondente).
        Guid? FolderFor(Guid? original, bool top) => top ? tree.Target?.Id : folderMap[original!.Value];
        var topIds = items.Where(i => i.Type != FolderType).Select(i => i.Id).ToHashSet();
        string Named(string name, bool top, int max) => top ? PreparationService.Cut(name, max - 8) + " (cópia)" : name;

        if (category == PrepCategories.Scenes)
        {
            var ids = IdsOf(items, SceneType);
            var sources = await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaign && (ids.Contains(s.Id) || (s.FolderId != null && inFolders.Contains(s.FolderId.Value)))).ToListAsync(ct);
            RequireAll(sources.Count(s => ids.Contains(s.Id)), ids.Count);
            if (await db.Scenes.CountAsync(s => s.CampaignId == campaign, ct) + sources.Count > PreparationService.MaxScenes)
                throw new RuleException(409, $"A campanha aceita até {PreparationService.MaxScenes} cenas.");
            var ownKeys = sources.Where(s => s.LayerMode == SceneLayerModes.Scene && s.MapKey.Length > 0).Select(ScenePrep.LayerKey).ToList();
            var own = ownKeys.Count == 0 ? [] : await db.Set<CampaignMapLayer>().AsNoTracking().Where(l => l.CampaignId == campaign && ownKeys.Contains(l.MapKey))
                .Select(l => new { l.MapKey, l.State, l.Prepared }).ToDictionaryAsync(l => l.MapKey, ct);
            foreach (var s in sources)
            {
                var top = topIds.Contains(s.Id);
                var copy = new Scene
                {
                    CampaignId = campaign, FolderId = FolderFor(s.FolderId, top), Name = Named(s.Name, top, 80), Description = s.Description, Kind = s.Kind, MapKind = s.MapKind,
                    MapKey = s.MapKey, SharedText = s.SharedText, PrivateNotes = s.PrivateNotes, VisionMode = s.VisionMode, LayerMode = s.LayerMode, Order = s.Order,
                    Layers = s.Layers, Prepared = s.Prepared.Select(ScenePrep.Clone).ToList(), CreatedAt = now, UpdatedAt = now,
                };
                db.Scenes.Add(copy);
                if (own.TryGetValue(ScenePrep.LayerKey(s), out var layer) && (MapFogState.Parse(layer.Prepared) ?? MapFogState.Parse(layer.State)) is { } state)
                    db.Add(new CampaignMapLayer { CampaignId = campaign, MapKey = ScenePrep.LayerKey(s.MapKey, copy.Id), State = ScenePrep.PrepOf(state).Serialize(), UpdatedAt = now });
                if (top) created.Add(new { type = SceneType, copy.Id });
            }
        }
        else if (category == PrepCategories.Maps)
        {
            var ids = IdsOf(items, MapType);
            var selected = Maps.Where(m => m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map && (ids.Contains(m.Id) || (m.FolderId != null && inFolders.Contains(m.FolderId.Value))));
            var mapIds = await selected.Select(m => m.Id).ToListAsync(ct);
            RequireAll(mapIds.Count(ids.Contains), ids.Count);
            if (await Maps.CountAsync(m => m.CampaignId == campaign && m.Purpose == CampaignAssetPurposes.Map, ct) + mapIds.Count > CampaignAssetsService.MaxMaps)
                throw new RuleException(409, $"Limite de {CampaignAssetsService.MaxMaps} mapas por campanha.");
            var family = Maps.Where(m => m.CampaignId == campaign && (mapIds.Contains(m.Id) || (m.OwnerMapId != null && mapIds.Contains(m.OwnerMapId.Value) && m.Purpose == CampaignAssetPurposes.Layer)));
            var adding = await family.SumAsync(m => (long)m.Content.Length, ct);
            if (await Maps.Where(m => m.CampaignId == campaign).SumAsync(m => (long)m.Content.Length, ct) + adding > CampaignAssetsService.MaxStorage)
                throw new RuleException(409, "Os mapas desta campanha excedem 250 MB.");
            var rows = await family.AsNoTracking().ToListAsync(ct);
            var keys = mapIds.Select(id => "asset:" + id).ToList();
            var fog = await db.Set<CampaignMapLayer>().AsNoTracking().Where(l => l.CampaignId == campaign && keys.Contains(l.MapKey))
                .Select(l => new { l.MapKey, l.State, l.Prepared }).ToDictionaryAsync(l => l.MapKey, ct);
            foreach (var m in rows.Where(r => r.Purpose == CampaignAssetPurposes.Map))
            {
                var top = topIds.Contains(m.Id);
                var copy = new CampaignMap
                {
                    CampaignId = campaign, FolderId = FolderFor(m.FolderId, top), Name = Named(m.Name, top, 120), GridPixels = m.GridPixels, ScaleMeters = m.ScaleMeters,
                    HasGrid = m.HasGrid, FreeMovement = m.FreeMovement, GridOffsetX = m.GridOffsetX, GridOffsetY = m.GridOffsetY, Width = m.Width, Height = m.Height,
                    Content = m.Content, TileData = m.TileData, Purpose = CampaignAssetPurposes.Map, Summary = m.Summary, SourceKey = m.SourceKey,
                    Composition = m.Composition, CreatedAt = now, UpdatedAt = now,
                };
                var renamed = new Dictionary<string, string>();
                foreach (var source in rows.Where(r => r.OwnerMapId == m.Id && r.Purpose == CampaignAssetPurposes.Layer))
                {
                    var dup = new CampaignMap
                    {
                        CampaignId = campaign, OwnerMapId = copy.Id, Purpose = CampaignAssetPurposes.Layer, Name = source.Name, HasGrid = false,
                        Content = source.Content, Width = source.Width, Height = source.Height, CreatedAt = now, UpdatedAt = now,
                    };
                    renamed["asset:" + source.Id] = "asset:" + dup.Id; db.Add(dup);
                }
                if (m.TileData == null && MapComposition.Stored(m.Composition) is { } doc)
                    copy.Composition = MapComposition.Serialize(MapComposition.WithSources(doc, s => renamed.GetValueOrDefault(s, s)));
                db.Add(copy);
                if (fog.TryGetValue("asset:" + m.Id, out var layer) && (MapFogState.Parse(layer.Prepared) ?? MapFogState.Parse(layer.State)) is { } state)
                    db.Add(new CampaignMapLayer { CampaignId = campaign, MapKey = "asset:" + copy.Id, State = ScenePrep.PrepOf(state).Serialize(), UpdatedAt = now });
                if (top) created.Add(new { type = MapType, copy.Id });
            }
        }
        else
        {
            var ids = IdsOf(items, CharacterType);
            var sources = await db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaign && (ids.Contains(m.Id) || (m.FolderId != null && inFolders.Contains(m.FolderId.Value)))).ToListAsync(ct);
            RequireAll(sources.Count(m => ids.Contains(m.Id)), ids.Count);
            if (await db.MasterCharacters.CountAsync(m => m.CampaignId == campaign, ct) + sources.Count > PreparationService.MaxNpcs)
                throw new RuleException(409, $"A campanha aceita até {PreparationService.MaxNpcs} personagens do mestre.");
            foreach (var m in sources)
            {
                var top = topIds.Contains(m.Id);
                var copy = new MasterCharacter
                {
                    CampaignId = campaign, FolderId = FolderFor(m.FolderId, top), Name = Named(m.Name, top, 40), Summary = m.Summary, Notes = m.Notes, Side = m.Side,
                    Kind = m.Kind, TemplateVersionId = m.TemplateVersionId, Values = m.Values, ImageUrl = m.ImageUrl, SharedWithPlayers = false, SourceId = null,
                    Resources = m.Resources.Select(r => new NpcResource { Label = r.Label, Value = r.Value, Max = r.Max }).ToList(), CreatedAt = now, UpdatedAt = now,
                };
                db.MasterCharacters.Add(copy);
                if (top) created.Add(new { type = CharacterType, copy.Id });
            }
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new { created };
    }

    // ---------- Renomear ----------
    public async Task<object> RenameAsync(Guid campaign, string user, PrepRenameInput x, CancellationToken ct)
    {
        var max = x.Type switch { SceneType => 80, MapType => 120, CharacterType => 40, FolderType => 100, _ => throw new RuleException(400, "Tipo de item inválido.") };
        var name = CampaignAssetsService.Name(x.Name, max);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await BeginWriteAsync(campaign, user, ct);
        int? revision = null;
        switch (x.Type)
        {
            case SceneType:
                var scene = await db.Scenes.SingleOrDefaultAsync(s => s.CampaignId == campaign && s.Id == x.Id, ct) ?? throw CampaignAssetsService.Missing();
                if (scene.Revision != x.Revision) throw CampaignAssetsService.Stale();
                scene.Name = name; scene.UpdatedAt = Now; revision = ++scene.Revision;
                break;
            case MapType:
                var map = await Maps.Where(m => m.CampaignId == campaign && m.Id == x.Id && m.Purpose == CampaignAssetPurposes.Map).Select(m => new { m.Revision }).SingleOrDefaultAsync(ct)
                    ?? throw CampaignAssetsService.Missing();
                if (map.Revision != x.Revision) throw CampaignAssetsService.Stale();
                // Sem carregar os bytes do mapa; a revisão confere de novo na própria atualização.
                var now = Now;
                if (await Maps.Where(m => m.Id == x.Id && m.Revision == x.Revision).ExecuteUpdateAsync(u => u.SetProperty(m => m.Name, name).SetProperty(m => m.Revision, m => m.Revision + 1).SetProperty(m => m.UpdatedAt, now), ct) == 0)
                    throw CampaignAssetsService.Stale();
                revision = x.Revision + 1;
                break;
            case CharacterType:
                var npc = await db.MasterCharacters.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == x.Id, ct) ?? throw CampaignAssetsService.Missing();
                if (npc.Revision != x.Revision) throw CampaignAssetsService.Stale();
                npc.Name = name; npc.UpdatedAt = Now; revision = ++npc.Revision;
                break;
            default:
                var folder = await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == x.Id, ct) ?? throw CampaignAssetsService.Missing();
                folder.Name = name;
                break;
        }
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { throw CampaignAssetsService.Stale(); }
        await tx.CommitAsync(ct);
        return new { x.Id, revision };
    }
}
