using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Pontos de entrada do mapa e a revisão do mapa lida pelo editor.</summary>
public record MapEntriesInput(List<MapEntry?>? Entries, int Revision);

/// <summary>
/// Pontos de entrada dos mapas da campanha e composição visual própria de cada cena: elementos desenhados sobre a imagem do mapa,
/// imagens-fonte da cena (<see cref="CampaignMap.OwnerSceneId"/>) e a camada achatada que a mesa aplica sobre o mapa.
/// Imagens da cena são do mestre: jogadores só recebem o resultado aplicado à imagem do mapa na sessão.
/// </summary>
public sealed partial class CampaignAssetsService
{
    const string SceneStale = "A cena mudou em outra tela. Recarregue antes de salvar.";

    /// <summary>Pontos de entrada de um mapa da campanha (<c>asset:{id}</c>); mapas oficiais não têm.</summary>
    internal async Task<List<MapEntry>> EntriesAsync(Guid campaign, string key, CancellationToken ct)
    {
        if (!key.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal) || !Guid.TryParse(key[NpcImages.AssetPrefix.Length..], out var id)) return [];
        return MapEntries.Parse(await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map).Select(m => m.Entries).SingleOrDefaultAsync(ct));
    }

    /// <summary>Salva os pontos de entrada de um mapa da campanha com grade. Não muda a mesa nem as cenas.</summary>
    public async Task<object> SaveEntriesAsync(Guid campaign, string key, string user, MapEntriesInput x, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        if (key == null || !key.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal) || !Guid.TryParse(key[NpcImages.AssetPrefix.Length..], out var id)) throw Missing();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        await EnsureNotArchivedAsync(campaign, ct);
        var map = await Maps.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map, ct) ?? throw Missing();
        if (!map.HasGrid) throw new RuleException(409, "Pontos de entrada valem para mapas com grade.");
        if (map.Revision != x.Revision) throw new RuleException(409, "O mapa mudou em outra tela. Recarregue antes de salvar.");
        var view = View(map);
        var entries = MapEntries.Validate(x.Entries, view.Width, view.Height);
        map.Entries = MapEntries.Serialize(entries);
        map.Revision++; map.UpdatedAt = DateTime.UtcNow;
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { throw new RuleException(409, "O mapa mudou em outra tela. Recarregue antes de salvar."); }
        await tx.CommitAsync(ct);
        return new { entries, revision = map.Revision };
    }

    /// <summary>Mapa de imagem da campanha usado pela cena (a composição desenha sobre ele); outros cenários respondem 409.</summary>
    async Task<(Guid Id, int Width, int Height)> SceneImageMapAsync(Guid campaign, string kind, string mapKey, CancellationToken ct)
    {
        static RuleException NotImage() => new(409, "A composição da cena usa imagens da campanha. Escolha um mapa de imagem.");
        if (kind == SceneKinds.Text || !mapKey.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal) || !Guid.TryParse(mapKey[NpcImages.AssetPrefix.Length..], out var id)) throw NotImage();
        var map = await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id && m.Purpose == CampaignAssetPurposes.Map && m.TileData == null)
            .Select(m => new { m.Width, m.Height }).SingleOrDefaultAsync(ct) ?? throw NotImage();
        return (id, map.Width, map.Height);
    }

    /// <summary>Camadas achatadas em uso por sessões ativas da campanha (não podem sumir enquanto estão na mesa).</summary>
    static async Task<HashSet<Guid>> LiveOverlaysAsync(GameDb db, Guid campaign, CancellationToken ct) =>
        (await db.Sessions.Where(s => s.CampaignId == campaign && s.EndedAt == null && s.OverlayId != null).Select(s => s.OverlayId!.Value).ToListAsync(ct)).ToHashSet();

    /// <summary>Imagem-fonte enviada para a composição da cena (PNG com transparência preservada). Até 40 por cena.</summary>
    public async Task<object> AddSceneSourceAsync(Guid campaign, Guid sceneId, string user, string? name, UploadedDocument image, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        var label = Name(string.IsNullOrWhiteSpace(name) ? "Imagem" : name, 120);
        var n = await Normalize(image, ct, keepAlpha: true);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        await EnsureNotArchivedAsync(campaign, ct);
        var scene = await db.Scenes.AsNoTracking().Where(s => s.Id == sceneId && s.CampaignId == campaign).Select(s => new { s.Kind, s.MapKey, s.OverlayId }).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Cena não encontrada.");
        await SceneImageMapAsync(campaign, scene.Kind, scene.MapKey, ct);
        var live = await LiveOverlaysAsync(db, campaign, ct);
        var owned = await Maps.Where(m => m.CampaignId == campaign && m.OwnerSceneId == sceneId && m.Purpose == CampaignAssetPurposes.Layer).Select(m => m.Id).ToListAsync(ct);
        if (owned.Count(o => o != scene.OverlayId && !live.Contains(o)) >= MapComposition.MaxSources)
            throw new RuleException(409, $"Limite de {MapComposition.MaxSources} imagens-fonte por cena.");
        await AccountLimits.EnsureCampaignStorageAsync(db, campaign, n.Bytes.Length, ct);
        var source = new CampaignMap
        {
            CampaignId = campaign, OwnerSceneId = sceneId, Purpose = CampaignAssetPurposes.Layer, Name = label, HasGrid = false,
            Content = n.Bytes, Width = n.Width, Height = n.Height,
        };
        db.Add(source); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return SourceView(source);
    }

    /// <summary>
    /// Salva a composição visual da cena e a camada achatada para os jogadores numa única escrita.
    /// <paramref name="composition"/> vazia remove a composição; <paramref name="overlay"/> ausente = nada sobre o mapa para os jogadores.
    /// A mesa não muda: a camada só chega à sessão ao apresentar, reiniciar ou aplicar a composição.
    /// </summary>
    public async Task<object> SaveSceneCompositionAsync(Guid campaign, Guid sceneId, string user, string? composition, int revision, UploadedDocument? overlay, CancellationToken ct)
    {
        await Access(campaign, user, true, ct);
        CompositionDocument? doc = null;
        HashSet<Guid> sources = [];
        if (!string.IsNullOrEmpty(composition))
        {
            (doc, sources, var usesSelf) = MapComposition.Parse(composition);
            if (usesSelf) throw new RuleException(400, "Composição inválida: a imagem do mapa já fica sob a composição da cena.");
        }
        if (overlay != null && doc == null) throw new RuleException(400, "Envie a composição junto com a camada da cena.");
        (byte[] Bytes, int Width, int Height)? flat = overlay == null ? null : await Normalize(overlay, ct, keepAlpha: true);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(campaign, user, ct);
        await EnsureNotArchivedAsync(campaign, ct);
        var scene = await db.Scenes.SingleOrDefaultAsync(s => s.Id == sceneId && s.CampaignId == campaign, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        if (scene.Revision != revision) throw new RuleException(409, SceneStale);
        var map = await SceneImageMapAsync(campaign, scene.Kind, scene.MapKey, ct);
        if (doc != null && (doc.Artboard!.Width != map.Width || doc.Artboard.Height != map.Height)) throw new RuleException(400, "A composição não tem o tamanho do mapa. Recarregue o editor.");
        if (flat is { } f && (f.Width != map.Width || f.Height != map.Height)) throw new RuleException(400, "A camada da cena não tem o tamanho do mapa. Salve novamente.");
        var live = await LiveOverlaysAsync(db, campaign, ct);
        var owned = await Maps.Where(m => m.CampaignId == campaign && m.OwnerSceneId == scene.Id && m.Purpose == CampaignAssetPurposes.Layer)
            .Select(m => new { m.Id, Size = m.Content.Length }).ToListAsync(ct);
        // Fontes válidas: imagens desta cena (não as camadas achatadas) ou imagens da campanha reaproveitadas sem copiar bytes.
        var ownSources = owned.Where(o => o.Id != scene.OverlayId && !live.Contains(o.Id)).Select(o => o.Id).ToHashSet();
        var reused = sources.Where(s => !ownSources.Contains(s)).ToList();
        if (reused.Count > 0 && await Maps.CountAsync(m => m.CampaignId == campaign && reused.Contains(m.Id) && m.TileData == null
                && (m.Purpose == CampaignAssetPurposes.Map || m.Purpose == CampaignAssetPurposes.Portrait), ct) != reused.Count)
            throw new RuleException(400, "Composição inválida: há imagem que não pertence a esta cena nem ao acervo da campanha.");
        // Saem as fontes sem uso e a camada anterior, exceto a camada que uma sessão ativa ainda mostra (sai quando a mesa trocar).
        var removed = owned.Where(o => !sources.Contains(o.Id) && !live.Contains(o.Id)).ToList();
        await AccountLimits.EnsureCampaignStorageAsync(db, campaign, (flat?.Bytes.Length ?? 0) - removed.Sum(o => (long)o.Size), ct);
        if (removed.Count > 0)
        {
            var ids = removed.Select(o => o.Id).ToList();
            await Maps.Where(m => m.CampaignId == campaign && m.OwnerSceneId == scene.Id && ids.Contains(m.Id)).ExecuteDeleteAsync(ct);
        }
        CampaignMap? layer = null;
        if (flat is { } image)
        {
            layer = new CampaignMap
            {
                CampaignId = campaign, OwnerSceneId = scene.Id, Purpose = CampaignAssetPurposes.Layer, Name = "Camada da cena", HasGrid = false,
                Content = image.Bytes, Width = image.Width, Height = image.Height,
            };
            db.Add(layer);
        }
        scene.Composition = doc == null ? null : MapComposition.Serialize(doc);
        scene.OverlayId = layer?.Id;
        scene.Revision++; scene.UpdatedAt = DateTime.UtcNow;
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { throw new RuleException(409, SceneStale); }
        await tx.CommitAsync(ct);
        return new { revision = scene.Revision, composition = doc == null ? (System.Text.Json.JsonElement?)null : CompositionJson(doc), overlayId = scene.OverlayId };
    }

    /// <summary>Remove as imagens da cena (fontes e camadas), exceto a camada que uma sessão ativa ainda mostra. Na transação do chamador.</summary>
    internal static async Task DeleteSceneAssetsAsync(GameDb db, Guid campaign, Guid sceneId, CancellationToken ct)
    {
        var live = (await LiveOverlaysAsync(db, campaign, ct)).ToList();
        await db.Set<CampaignMap>().Where(m => m.CampaignId == campaign && m.OwnerSceneId == sceneId && m.Purpose == CampaignAssetPurposes.Layer && !live.Contains(m.Id))
            .ExecuteDeleteAsync(ct);
    }

    /// <summary>
    /// Cópia de cena: fontes usadas e camada achatada viram imagens da cópia (ids novos), e a composição aponta para elas.
    /// Imagens da campanha reaproveitadas continuam compartilhadas. Devolve os bytes acrescentados (o chamador confere o limite).
    /// </summary>
    internal static async Task<long> CopySceneAssetsAsync(GameDb db, Scene source, Scene copy, DateTime now, CancellationToken ct)
    {
        copy.Entry = source.Entry;
        var doc = MapComposition.Stored(source.Composition);
        if (doc == null) { copy.Composition = null; copy.OverlayId = null; return 0; }
        var used = (doc.Elements ?? []).Select(e => e?.Src).Where(s => s != null && s.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal))
            .Select(s => Guid.TryParse(s![NpcImages.AssetPrefix.Length..], out var g) ? g : Guid.Empty).ToHashSet();
        var rows = await db.Set<CampaignMap>().AsNoTracking()
            .Where(m => m.CampaignId == source.CampaignId && m.OwnerSceneId == source.Id && m.Purpose == CampaignAssetPurposes.Layer && (used.Contains(m.Id) || m.Id == source.OverlayId))
            .ToListAsync(ct);
        var renamed = new Dictionary<string, string>();
        long added = 0;
        copy.OverlayId = null;
        foreach (var r in rows)
        {
            var dup = new CampaignMap
            {
                CampaignId = r.CampaignId, OwnerSceneId = copy.Id, Purpose = CampaignAssetPurposes.Layer, Name = r.Name, HasGrid = false,
                Content = r.Content, Width = r.Width, Height = r.Height, CreatedAt = now, UpdatedAt = now,
            };
            db.Add(dup); added += r.Content.Length;
            if (r.Id == source.OverlayId) copy.OverlayId = dup.Id;
            else renamed[NpcImages.AssetPrefix + r.Id.ToString("D")] = NpcImages.AssetPrefix + dup.Id.ToString("D");
        }
        copy.Composition = MapComposition.Serialize(MapComposition.WithSources(doc, s => renamed.GetValueOrDefault(s, s)));
        return added;
    }

    /// <summary>
    /// A mesa deixou de mostrar <paramref name="old"/>: a camada guardada só para a sessão sai se não for a atual de nenhuma cena
    /// nem estiver em outra sessão ativa. Na transação do chamador.
    /// </summary>
    internal static async Task ReleaseOverlayAsync(GameDb db, Guid campaign, Guid? old, Guid? current, Guid sessionId, CancellationToken ct)
    {
        if (old is not { } id || id == current) return;
        if (await db.Scenes.AnyAsync(s => s.CampaignId == campaign && s.OverlayId == id, ct)) return;
        if (await db.Sessions.AnyAsync(s => s.CampaignId == campaign && s.EndedAt == null && s.Id != sessionId && s.OverlayId == id, ct)) return;
        await db.Set<CampaignMap>().Where(m => m.CampaignId == campaign && m.Id == id && m.OwnerSceneId != null && m.Purpose == CampaignAssetPurposes.Layer).ExecuteDeleteAsync(ct);
    }
}
