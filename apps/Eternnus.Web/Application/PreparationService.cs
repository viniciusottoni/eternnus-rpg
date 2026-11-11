using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Preparação da cena. <c>Prepared</c> nulo mantém o arranjo; <c>LayerMode</c> nulo mantém o alcance da preparação do mapa.</summary>
public record SceneInput(string Name, string? Description, string Kind, string? MapKind, string? MapKey, string? SharedText, string? PrivateNotes, string? VisionMode, int Order = 0, int Revision = 0, List<SceneTokenInput>? Prepared = null, string? LayerMode = null);
public record NpcInput(string Name, string? Summary, string? Notes, string? Side, List<NpcResource>? Resources, int Revision = 0, string? Kind = null, string? ImageUrl = null, bool? SharedWithPlayers = null);
public record ScheduleInput(DateTimeOffset? At, string? Note);
public record AttendanceInput(string Status);
public record InviteCodeInput(string Code);
public record SimpleFieldInput(string Label, string Type, List<string>? Options, bool Resource, double? Max, string? MaxFrom, bool Summary, double? Min, string? Default);
public record SimpleSectionInput(string Title, List<SimpleFieldInput>? Fields);
public record SimpleActionInput(string Name, string? Formula, string? Description, string? Group, string? Kind);
public record SimpleTemplateInput(string Name, string? Description, List<SimpleSectionInput>? Sections, List<SimpleActionInput>? Actions, bool UseForCampaign = false);

/// <summary>
/// Preparação e continuidade da campanha fora da mesa: cenas, personagens do mestre, diário (resumos, objetivos,
/// pistas, próxima partida e presença), modelos privados simples, convites e início. Autoriza por campanha no banco.
/// </summary>
public sealed partial class PreparationService(GameDb db, TimeProvider clock)
{
    public const int MaxScenes = 100, MaxNpcs = 200, MaxNpcResources = 8, MaxPrivateTemplates = 10, MaxSimpleFields = 60;
    DateTime Now => clock.GetUtcNow().UtcDateTime;

    async Task<(Campaign Campaign, bool Master)> AccessAsync(Guid campaignId, string user, bool master, bool write, CancellationToken ct)
    {
        var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == campaignId, ct) ?? throw new RuleException(404, "Campanha não encontrada.");
        OneShotLifecycleService.EnsureOpen(c, Now);
        var isMaster = c.OwnerId == user;
        if (!isMaster && !await db.Members.AnyAsync(m => m.CampaignId == campaignId && m.UserId == user, ct)) throw new RuleException(404, "Campanha não encontrada.");
        if (master && !isMaster) throw new RuleException(403, "Somente o mestre prepara a campanha.");
        if (write && c.ArchivedAt != null) throw new RuleException(409, "Esta campanha está arquivada. Restaure-a para voltar a prepará-la.");
        return (c, isMaster);
    }

    static string Text(string? value, int max, string message, bool required = false)
    {
        var text = (value ?? "").Trim();
        if ((required && text.Length == 0) || text.Length > max) throw new RuleException(400, message);
        return text;
    }

    async Task ValidateMapAsync(Guid campaign, string kind, string key, CancellationToken ct)
    {
        if (kind is not (MapKinds.Tileset or MapKinds.Cartographic)) throw new RuleException(400, "Escolha um mapa disponível.");
        if (key.StartsWith("asset:"))
        {
            var asset = await new CampaignAssetsService(db).ResolveMapAsync(campaign, key, ct) ?? throw new RuleException(400, "Mapa da campanha não encontrado.");
            if (kind == MapKinds.Tileset && !asset.HasGrid) throw new RuleException(400, "Esta imagem não tem grade. Escolha “Imagem sem grade” ou configure a grade do mapa.");
            return;
        }
        if (key.StartsWith("resource:") && Guid.TryParse(key[9..], out var rid)) { if (kind != MapKinds.Cartographic || !await db.Resources.AnyAsync(r => r.Id == rid && r.CampaignId == campaign && r.Kind == "mapa", ct)) throw new RuleException(400, "Mapa da campanha não encontrado."); return; }
        if (BattleMaps.Find(key) is not { } map || map.Kind != kind) throw new RuleException(400, "Escolha um mapa disponível.");
    }

    // ---------- Cenas ----------
    public async Task<object> ScenesAsync(Guid campaignId, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, false, ct);
        var items = await db.Scenes.AsNoTracking().Where(s => s.CampaignId == campaignId).OrderBy(s => s.Order).ThenBy(s => s.Name).Take(MaxScenes).ToListAsync(ct);
        var active = await db.Sessions.AsNoTracking().Where(s => s.CampaignId == campaignId && s.EndedAt == null).Select(s => new { s.Id, s.SceneId }).SingleOrDefaultAsync(ct);
        return new
        {
            items = items.Select(s => new
            {
                s.Id, s.Name, s.Description, s.Kind, s.MapKind, s.MapKey, s.SharedText, s.PrivateNotes, s.VisionMode, s.LayerMode, s.Order, s.Revision, s.HasSaved,
                prepared = s.Prepared.Count, s.UpdatedAt, current = active?.SceneId == s.Id,
            }),
            activeSessionId = active?.Id,
            characters = await CampaignCharactersAsync(campaignId, ct),
        };
    }

    /// <summary>Cena completa para o editor de preparação: arranjo privado, personagens disponíveis e relação com a mesa ao vivo.</summary>
    public async Task<object> SceneAsync(Guid campaignId, Guid id, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, false, ct);
        var s = await db.Scenes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        var active = await db.Sessions.AsNoTracking().Where(x => x.CampaignId == campaignId && x.EndedAt == null)
            .Select(x => new { x.Id, x.SceneId, x.MapKey, x.SceneName, x.SceneText }).SingleOrDefaultAsync(ct);
        var current = active?.SceneId == s.Id;
        return new
        {
            s.Id, s.Name, s.Description, s.Kind, s.MapKind, s.MapKey, s.SharedText, s.PrivateNotes, s.VisionMode, s.LayerMode, s.Order, s.Revision, s.HasSaved,
            prepared = s.Prepared, s.UpdatedAt,
            live = active == null ? null : new
            {
                sessionId = active.Id, current,
                textPending = current && ((active.SceneName ?? s.Name) != s.Name || (active.SceneText ?? s.SharedText) != s.SharedText),
                mapPending = current && s.Kind != SceneKinds.Text && active.MapKey != s.MapKey,
            },
            characters = await CampaignCharactersAsync(campaignId, ct),
        };
    }

    async Task<List<CharacterChoice>> CampaignCharactersAsync(Guid campaignId, CancellationToken ct) =>
        (await db.CampaignCharacters.AsNoTracking().Where(cc => cc.CampaignId == campaignId).Join(db.Characters, cc => cc.CharacterId, c => c.Id, (cc, c) => new { c.Id, c.Name, c.LightMeters, c.VisionMeters })
            .OrderBy(c => c.Name).Take(100).ToListAsync(ct)).Select(c => new CharacterChoice(c.Id, c.Name, c.LightMeters, c.VisionMeters)).ToList();
    /// <summary>Personagem disponível para o arranjo; luz/visão da ficha alimentam a simulação do editor (mesma regra da mesa).</summary>
    record CharacterChoice(Guid Id, string Name, int? LightMeters, int? VisionMeters);

    public async Task<object> SaveSceneAsync(Guid campaignId, Guid? id, SceneInput x, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        var name = Text(x.Name, 80, "Dê um nome de até 80 caracteres à cena.", true);
        if (!SceneKinds.All.Contains(x.Kind)) throw new RuleException(400, "Escolha mapa, imagem ou apresentação textual.");
        if (!VisionModes.IsValid(x.VisionMode)) throw new RuleException(400, "Escolha a visão: tudo visível, revelação manual ou por personagem.");
        if (x.LayerMode != null && !SceneLayerModes.IsValid(x.LayerMode)) throw new RuleException(400, "Escolha preparação compartilhada com o mapa ou própria da cena.");
        var kind = x.Kind == SceneKinds.Text ? "" : x.Kind == SceneKinds.Map ? MapKinds.Tileset : MapKinds.Cartographic;
        var key = x.Kind == SceneKinds.Text ? "" : Text(x.MapKey, 80, "Escolha o mapa da cena.", true);
        // O tipo da cena decide como o mapa é usado: com grade (tático) ou só imagem; a mesma imagem serve aos dois.
        if (kind.Length > 0) await ValidateMapAsync(campaignId, kind, key, ct);
        Scene scene;
        if (id is { } sceneId)
        {
            scene = await db.Scenes.SingleOrDefaultAsync(s => s.Id == sceneId && s.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Cena não encontrada.");
            if (scene.Revision != x.Revision) throw new RuleException(409, "A cena mudou em outra tela. Recarregue antes de salvar.");
            var mode = x.LayerMode ?? scene.LayerMode;
            if (mode != scene.LayerMode && await db.Sessions.AnyAsync(s => s.CampaignId == campaignId && s.EndedAt == null && s.SceneId == scene.Id, ct))
                throw new RuleException(409, "Esta cena está em apresentação. Troque o alcance da preparação do mapa com outra cena na mesa.");
            // Posições pertencem à grade anterior: trocar o cenário recomeça o arranjo e o estado salvo.
            if (scene.MapKey != key || scene.Kind != x.Kind) { scene.Prepared = []; scene.Saved = []; scene.HasSaved = false; }
            scene.Revision++;
        }
        else
        {
            if (await db.Scenes.CountAsync(s => s.CampaignId == campaignId, ct) >= MaxScenes) throw new RuleException(409, $"A campanha aceita até {MaxScenes} cenas.");
            scene = new Scene { CampaignId = campaignId, Order = x.Order };
            db.Scenes.Add(scene);
        }
        scene.Name = name; scene.Description = Text(x.Description, 1000, "A descrição aceita até 1.000 caracteres.");
        scene.Kind = x.Kind; scene.MapKind = kind; scene.MapKey = key;
        scene.SharedText = Text(x.SharedText, 2000, "O texto para os jogadores aceita até 2.000 caracteres.");
        scene.PrivateNotes = Text(x.PrivateNotes, 4000, "As notas privadas aceitam até 4.000 caracteres.");
        scene.VisionMode = x.Kind == SceneKinds.Map ? x.VisionMode : null; scene.Order = Math.Clamp(x.Order, 0, 10000); scene.UpdatedAt = Now;
        scene.LayerMode = x.Kind == SceneKinds.Map ? x.LayerMode ?? scene.LayerMode : SceneLayerModes.Map;
        if (x.Prepared != null) scene.Prepared = x.Kind == SceneKinds.Map ? await ValidArrangementAsync(campaignId, scene, x.Prepared, ct) : [];
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { throw new RuleException(409, "A cena mudou em outra tela. Recarregue antes de salvar."); }
        return new { scene.Id, scene.Revision };
    }

    /// <summary>Arranjo privado validado contra a grade e a preparação do mapa da cena (paredes e obstáculos).</summary>
    async Task<List<SceneToken>> ValidArrangementAsync(Guid campaignId, Scene scene, List<SceneTokenInput> input, CancellationToken ct)
    {
        var fog = new TableFogService(db);
        var map = await fog.MapAsync(campaignId, scene.MapKey, ct) ?? throw new RuleException(400, "Escolha um mapa com grade para posicionar marcadores.");
        var campaign = await db.Campaigns.AsNoTracking().SingleAsync(c => c.Id == campaignId, ct);
        var settings = await fog.CampaignSettingsAsync(campaign, ct);
        var (row, state) = await fog.LayerAsync(campaignId, map, settings, false, ct, ScenePrep.LayerKey(scene));
        var prep = TableFogService.PreparedOf(row, state, map, settings);
        var characters = await CampaignCharactersAsync(campaignId, ct);
        var npcs = (await db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaignId).Select(m => m.Id).ToListAsync(ct)).ToHashSet();
        return ScenePrep.ValidateTokens(input, new FogGrid(map.Width, map.Height, prep.Cells), characters.Select(c => c.Id).ToHashSet(), characters.ToDictionary(c => c.Id, c => c.Name), npcs);
    }

    public async Task<object> DuplicateSceneAsync(Guid campaignId, Guid id, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        var s = await db.Scenes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        if (await db.Scenes.CountAsync(x => x.CampaignId == campaignId, ct) >= MaxScenes) throw new RuleException(409, $"A campanha aceita até {MaxScenes} cenas.");
        var copy = new Scene
        {
            CampaignId = campaignId, Name = Cut(s.Name, 72) + " (cópia)", Description = s.Description, Kind = s.Kind, MapKind = s.MapKind, MapKey = s.MapKey,
            SharedText = s.SharedText, PrivateNotes = s.PrivateNotes, VisionMode = s.VisionMode, LayerMode = s.LayerMode, Order = s.Order + 1, UpdatedAt = Now,
            Prepared = s.Prepared.Select(t => new SceneToken { CharacterId = t.CharacterId, MasterCharacterId = t.MasterCharacterId, Label = t.Label, Side = t.Side, X = t.X, Y = t.Y, Hidden = t.Hidden, Light = t.Light }).ToList(),
        };
        db.Scenes.Add(copy);
        // Preparação própria: a cópia recebe a preparação do mapa (sem explorações) e segue independente.
        if (s.LayerMode == SceneLayerModes.Scene && s.MapKey.Length > 0)
        {
            var sourceKey = ScenePrep.LayerKey(s);
            var source = await db.Set<CampaignMapLayer>().AsNoTracking().Where(l => l.CampaignId == campaignId && l.MapKey == sourceKey).Select(l => new { l.State, l.Prepared }).SingleOrDefaultAsync(ct);
            if ((MapFogState.Parse(source?.Prepared) ?? MapFogState.Parse(source?.State)) is { } layer)
                db.Add(new CampaignMapLayer { CampaignId = campaignId, MapKey = ScenePrep.LayerKey(s.MapKey, copy.Id), State = ScenePrep.PrepOf(layer).Serialize(), UpdatedAt = Now });
        }
        await db.SaveChangesAsync(ct);
        return new { copy.Id, copy.Revision };
    }

    public async Task DeleteSceneAsync(Guid campaignId, Guid id, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        if (await db.Sessions.AnyAsync(s => s.CampaignId == campaignId && s.EndedAt == null && s.SceneId == id, ct))
            throw new RuleException(409, "Esta cena está em apresentação. Apresente outra cena antes de excluí-la.");
        if (await db.Scenes.Where(s => s.Id == id && s.CampaignId == campaignId).ExecuteDeleteAsync(ct) == 0) throw new RuleException(404, "Cena não encontrada.");
        // Remove somente a preparação própria desta cena; a camada compartilhada do mapa continua.
        var suffix = "@" + id.ToString("N");
        await db.Set<CampaignMapLayer>().Where(l => l.CampaignId == campaignId && l.MapKey.EndsWith(suffix)).ExecuteDeleteAsync(ct);
    }
    // ---------- Personagens do mestre ----------
    public async Task<object> NpcsAsync(Guid campaignId, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, false, ct);
        var items = await db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaignId).OrderBy(m => m.SourceId != null).ThenBy(m => m.Name).Take(MaxNpcs).ToListAsync(ct);
        var versionIds = items.Where(m => m.TemplateVersionId != null).Select(m => m.TemplateVersionId!.Value).Distinct().ToList();
        var templates = await db.SheetTemplateVersions.AsNoTracking().Where(v => versionIds.Contains(v.Id))
            .Join(db.SheetTemplates, v => v.TemplateId, t => t.Id, (v, t) => new { v.Id, t.Name }).ToDictionaryAsync(x => x.Id, x => x.Name, ct);
        var lore = await LorePagesAsync(campaignId, items.Select(m => m.Id).ToList(), null, ct);
        return new
        {
            items = items.Select(m => new
            {
                m.Id, m.Name, m.Summary, m.Notes, m.Side, m.Resources, m.SourceId, m.Revision, copy = m.SourceId != null, m.Kind, m.ImageUrl, imagePreview = SessionService.PreviewUrl(m), m.SharedWithPlayers,
                templateName = m.TemplateVersionId is { } v && templates.TryGetValue(v, out var name) ? name : null,
                page = lore.GetValueOrDefault(m.Id),
            })
        };
    }

    public async Task<object> SaveNpcAsync(Guid campaignId, Guid? id, NpcInput x, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        var name = Text(x.Name, 40, "Dê um nome de até 40 caracteres ao personagem.", true);
        var side = x.Side ?? "enemy";
        if (side is not ("ally" or "enemy" or "neutral")) throw new RuleException(400, "Escolha aliado, inimigo ou neutro.");
        // Recursos simples são editados na ficha (ADR-065); omitidos na edição mantêm os atuais.
        var resources = x.Resources == null ? null : ValidateResources(x.Resources);
        MasterCharacter npc;
        if (id is { } npcId)
        {
            npc = await db.MasterCharacters.SingleOrDefaultAsync(m => m.Id == npcId && m.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Personagem do mestre não encontrado.");
            if (npc.Revision != x.Revision) throw new RuleException(409, "O personagem mudou em outra tela. Recarregue antes de salvar.");
            npc.Revision++;
        }
        else
        {
            if (await db.MasterCharacters.CountAsync(m => m.CampaignId == campaignId, ct) >= MaxNpcs) throw new RuleException(409, $"A campanha aceita até {MaxNpcs} personagens do mestre.");
            npc = new MasterCharacter { CampaignId = campaignId };
            db.MasterCharacters.Add(npc);
        }
        npc.Name = name; npc.Side = side; npc.UpdatedAt = Now;
        if (resources != null) npc.Resources = resources;
        npc.Kind = NpcKinds.Normalize(x.Kind ?? npc.Kind);
        npc.ImageUrl = await ValidImageAsync(campaignId, x.ImageUrl, db, ct);
        npc.Summary = Text(x.Summary, 500, "O resumo aceita até 500 caracteres.");
        npc.Notes = Text(x.Notes, 4000, "As notas aceitam até 4.000 caracteres.");
        if (x.SharedWithPlayers is { } shared) npc.SharedWithPlayers = shared;
        try { await db.SaveChangesAsync(ct); } catch (DbUpdateConcurrencyException) { throw new RuleException(409, "O personagem mudou em outra tela. Recarregue antes de salvar."); }
        return new { npc.Id, npc.Revision };
    }

    /// <summary>NPCs que o mestre compartilhou: nome, tipo, resumo, imagem e a página de lore quando quem lê pode abri-la; paginado em vinte.</summary>
    public async Task<object> KnownNpcsAsync(Guid campaignId, string user, int page, CancellationToken ct)
    {
        var (campaign, _) = await AccessAsync(campaignId, user, false, false, ct);
        page = Math.Clamp(page, 1, 100000);
        var query = db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaignId && m.SharedWithPlayers);
        var total = await query.CountAsync(ct);
        var rows = await query.OrderBy(m => m.Name).ThenBy(m => m.Id).Skip((page - 1) * 20).Take(20).Select(m => new { m.Id, m.Name, m.Kind, m.Summary, m.ImageUrl }).ToListAsync(ct);
        var lore = await LorePagesAsync(campaignId, rows.Select(m => m.Id).ToList(), (user, campaign.OwnerId), ct);
        return new
        {
            items = rows.Select(m => new { m.Id, m.Name, m.Kind, m.Summary, image = KnownPortraitUrl(campaignId, m.Id, m.ImageUrl), page = lore.GetValueOrDefault(m.Id) }),
            total, page, pageSize = 20,
        };
    }

    /// <summary>Página de lore de cada NPC (vínculo <c>WorkspacePage.NpcId</c>, ADR-064), fora da lixeira; fixada primeiro, depois por título.
    /// Com <paramref name="reader"/>, só páginas que essa pessoa pode ler; sem ele (mestre na Preparação), qualquer página do acervo. Uma consulta.</summary>
    async Task<Dictionary<Guid, LorePage>> LorePagesAsync(Guid campaignId, List<Guid> npcIds, (string User, string Master)? reader, CancellationToken ct)
    {
        if (npcIds.Count == 0) return [];
        var pages = reader is { } r ? WorkspaceService.Readable(db, campaignId, r.User, r.Master) : db.Set<WorkspacePage>().Where(p => p.CampaignId == campaignId);
        var rows = await pages.AsNoTracking().Where(p => p.DeletedAt == null && p.NpcId != null && npcIds.Contains(p.NpcId.Value))
            .OrderByDescending(p => p.Pinned).ThenBy(p => p.Title).ThenBy(p => p.Id).Take(MaxNpcs * 5).Select(p => new { NpcId = p.NpcId!.Value, p.Id, p.Title, p.Visibility }).ToListAsync(ct);
        return rows.GroupBy(p => p.NpcId).ToDictionary(g => g.Key, g => new LorePage(g.First().Id, g.First().Title, g.First().Visibility));
    }
    /// <summary>Visibilidade acompanha para o mestre conferir se o grupo também consegue abrir a página.</summary>
    record LorePage(Guid Id, string Title, string Visibility);

    /// <summary>Link https direto ou rota protegida da imagem do acervo, com versão derivada da imagem escolhida.</summary>
    public static string? KnownPortraitUrl(Guid campaignId, Guid npcId, string? image)
    {
        var url = NpcImages.Normalize(image, out var asset);
        if (url == null) return null;
        return asset is { } id ? $"/api/campaigns/{campaignId}/known-npcs/{npcId}/portrait?v={id.ToString("N")[..8]}" : url;
    }

    /// <summary>Imagem do acervo de um NPC compartilhado. NPC não compartilhado responde 404, como se não existisse.</summary>
    public async Task<byte[]> KnownPortraitAsync(Guid campaignId, Guid npcId, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, false, false, ct);
        var image = await db.MasterCharacters.AsNoTracking().Where(m => m.Id == npcId && m.CampaignId == campaignId && m.SharedWithPlayers).Select(m => m.ImageUrl).SingleOrDefaultAsync(ct);
        NpcImages.Normalize(image, out var asset);
        if (asset is not { } assetId) throw new RuleException(404, "Imagem não encontrada.");
        return await db.Set<CampaignMap>().AsNoTracking().Where(m => m.Id == assetId && m.CampaignId == campaignId).Select(m => m.Content).SingleOrDefaultAsync(ct)
            ?? throw new RuleException(404, "Imagem não encontrada.");
    }

    /// <summary>Imagem do NPC: link https ou imagem do acervo desta campanha.</summary>
    public static async Task<string?> ValidImageAsync(Guid campaignId, string? input, GameDb db, CancellationToken ct)
    {
        var url = NpcImages.Normalize(input, out var asset);
        if (asset is { } id && !await db.Set<CampaignMap>().AnyAsync(m => m.Id == id && m.CampaignId == campaignId, ct))
            throw new RuleException(400, "Escolha uma imagem do acervo desta campanha.");
        return url;
    }

    internal static List<NpcResource> ValidateResources(List<NpcResource>? input)
    {
        var list = input ?? [];
        if (list.Count > MaxNpcResources) throw new RuleException(400, $"Use até {MaxNpcResources} recursos.");
        return list.Select(r =>
        {
            var label = (r?.Label ?? "").Trim();
            if (label.Length is < 1 or > 40) throw new RuleException(400, "Cada recurso precisa de um nome com até 40 caracteres.");
            if (r!.Max is < 0 or > 100000 || r.Value is < 0 or > 100000 || (r.Max is { } m && r.Value > m)) throw new RuleException(400, $"{label}: valor entre 0 e o máximo (até 100.000).");
            return new NpcResource { Label = label, Value = r.Value, Max = r.Max };
        }).ToList();
    }

    public static MasterCharacter CopyOf(MasterCharacter m, DateTime now) => new()
    {
        CampaignId = m.CampaignId, Name = Cut(m.Name, 32) + " (cópia)", Summary = m.Summary, Notes = m.Notes, Side = m.Side, SourceId = m.SourceId ?? m.Id, UpdatedAt = now,
        Kind = m.Kind, TemplateVersionId = m.TemplateVersionId, Values = m.Values, ImageUrl = m.ImageUrl,
        Resources = m.Resources.Select(r => new NpcResource { Label = r.Label, Value = r.Max ?? r.Value, Max = r.Max }).ToList(),
    };

    public async Task<object> CopyNpcAsync(Guid campaignId, Guid id, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        var source = await db.MasterCharacters.AsNoTracking().SingleOrDefaultAsync(m => m.Id == id && m.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Personagem do mestre não encontrado.");
        if (await db.MasterCharacters.CountAsync(m => m.CampaignId == campaignId, ct) >= MaxNpcs) throw new RuleException(409, $"A campanha aceita até {MaxNpcs} personagens do mestre.");
        var copy = CopyOf(source, Now);
        db.MasterCharacters.Add(copy);
        await db.SaveChangesAsync(ct);
        return new { copy.Id, copy.Revision };
    }

    public async Task DeleteNpcAsync(Guid campaignId, Guid id, string user, CancellationToken ct)
    {
        await AccessAsync(campaignId, user, true, true, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.MasterCharacters.Where(m => m.Id == id && m.CampaignId == campaignId).ExecuteDeleteAsync(ct) == 0) throw new RuleException(404, "Personagem do mestre não encontrado.");
        // Páginas de lore continuam no acervo, só perdem o vínculo (sem chave estrangeira, o id órfão impediria salvá-las).
        await db.Set<WorkspacePage>().Where(p => p.CampaignId == campaignId && p.NpcId == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.NpcId, (Guid?)null), ct);
        await tx.CommitAsync(ct);
    }

    static string Cut(string s, int max) => s.Length > max ? s[..max] : s;
}
