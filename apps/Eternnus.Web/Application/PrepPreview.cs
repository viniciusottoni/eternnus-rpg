using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Pedido de prévia do jogador no editor (ADR-088). <c>Layer</c> é a preparação ainda não salva (nula = a salva);
/// <c>Tokens</c> é o arranjo do editor. Quem vê: um personagem (<c>ViewerCharacterId</c>), um jogador (<c>ViewerUserId</c>,
/// todos os personagens dele), um marcador (<c>ViewerToken</c>, índice em <c>Tokens</c>) ou o grupo inteiro (<c>Party</c>).
/// Ensaio (ADR-111): <c>Tokens</c> aceita reservados e tokens de ensaio; <c>Profiles</c> dá visão, luz, percepção e sentidos
/// sintéticos a marcadores. Observadores sintéticos só existem nesta prévia.
/// </summary>
public record PrepPreviewInput(string MapKey, Guid? SceneId, MapLayerInput? Layer, List<SceneTokenInput>? Tokens, string? VisionMode,
    Guid? ViewerCharacterId = null, string? ViewerUserId = null, bool Party = false, List<RehearsalProfileInput>? Profiles = null, int? ViewerToken = null);

/// <summary>Perfil de ensaio de um marcador (<c>Token</c> = índice em <c>Tokens</c>). Nulos seguem a ficha ou a configuração da mesa.
/// Metros de 0 a 300, percepção de -50 a 100, sentidos no formato da ficha ("nome: metros", até 400 caracteres).</summary>
public record RehearsalProfileInput(int Token, int? VisionMeters, int? LightMeters, int? Perception, string? Senses);

/// <summary>
/// "Ver como jogador" do editor com as regras autoritativas da mesa (<see cref="FogRules"/>), sem simulação simplificada:
/// paredes vetoriais e por casa, luzes, penumbra, visão e sentidos da ficha, percepção e detecção de ocultos, revelações e
/// explorações já gravadas na camada. Somente leitura: nada é gravado, a sessão ao vivo não muda e o resultado só vai ao mestre.
/// </summary>
public sealed partial class PreparationService
{
    public async Task<object> PreviewViewAsync(Guid campaignId, PrepPreviewInput x, string user, CancellationToken ct)
    {
        var (campaign, _) = await AccessAsync(campaignId, user, true, false, ct);
        var fog = new TableFogService(db);
        var map = await fog.MapAsync(campaignId, x.MapKey ?? "", ct) ?? throw new RuleException(400, "Escolha um mapa com grade para ver como jogador.");
        var settings = await fog.CampaignSettingsAsync(campaign, ct);
        var layerKey = map.Key;
        if (x.SceneId is { } sid)
        {
            var mode = await db.Scenes.AsNoTracking().Where(s => s.Id == sid && s.CampaignId == campaignId).Select(s => s.LayerMode).SingleOrDefaultAsync(ct)
                ?? throw new RuleException(404, "Cena não encontrada.");
            if (mode == SceneLayerModes.Scene) layerKey = ScenePrep.LayerKey(map.Key, sid);
        }
        var (row, saved) = await fog.LayerAsync(campaignId, map, settings, false, ct, layerKey);
        var prep = x.Layer == null ? TableFogService.PreparedOf(row, saved, map, settings) : DraftLayer(map, x.Layer, saved);
        ScenePrep.ApplyVision(prep, x.VisionMode);
        // O que o grupo já explorou e quem já percebeu cada marca vêm da camada gravada (como ao apresentar).
        prep.Explored = saved.Explored;
        foreach (var m in prep.Marks)
            if (saved.Marks.FirstOrDefault(o => o.Id == m.Id) is { } old) { m.RevealedAll = old.RevealedAll; m.RevealedTo = [.. old.RevealedTo]; }

        var characters = await db.CampaignCharacters.AsNoTracking().Where(cc => cc.CampaignId == campaignId)
            .Join(db.Characters, cc => cc.CharacterId, c => c.Id, (cc, c) => new { c.Id, c.Name, c.OwnerId, c.LightMeters, c.VisionMeters, c.Perception, c.Senses })
            .Take(100).ToListAsync(ct);
        var npcs = (await db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaignId).Select(m => m.Id).ToListAsync(ct)).ToHashSet();
        var grid = FogGrid.Of(map, prep);
        var slots = await PartySlotService.LookupAsync(db, campaignId, ct);
        var placed = ScenePrep.ValidateTokens(x.Tokens, grid, characters.Select(c => c.Id).ToHashSet(), characters.ToDictionary(c => c.Id, c => c.Name), npcs, map.Free, null, slots, allowRehearsal: true);
        var profiles = ValidProfiles(x.Profiles, placed.Count);
        var byId = characters.ToDictionary(c => c.Id);
        string? OwnerOf(Guid? id) => id is { } cid && byId.TryGetValue(cid, out var c) && c.OwnerId != campaign.OwnerId ? c.OwnerId : null;
        // Observador sintético (ADR-111): reservado sem personagem, token de ensaio ou marcador com perfil que não é personagem de jogador.
        bool Synthetic(int i) => OwnerOf(placed[i].CharacterId) == null
            && (x.Tokens![i].Rehearsal || (placed[i].CharacterId == null && placed[i].SlotId != null) || profiles.ContainsKey(i));

        var manual = prep.Manual ?? settings.ManualReveal;
        var scale = map.ScaleMeters;
        // Mesmos valores efetivos de TableFogService.SceneAsync (ficha → ajuste do marcador → configuração da mesa).
        var ids = placed.Select((_, i) => Guid.NewGuid()).ToList();
        List<(string, int?)> Senses(string? text) => TableFog.ParseSenses(text).Select(s => (s.Name, s.Meters is { } m ? (int?)TableFog.MetersToCells(m, scale) : null)).ToList();
        var tokens = placed.Select((t, i) =>
        {
            var ch = t.CharacterId is { } cid ? byId.GetValueOrDefault(cid) : null;
            var p = profiles.GetValueOrDefault(i);
            var synthetic = Synthetic(i);
            var observer = synthetic || t.CharacterId != null;
            // Perfil > ficha > configuração da mesa (jogador sem valor na ficha). Sintético sem perfil de luz usa a luz do marcador, se houver.
            var light = p?.LightMeters is { } lm ? TableFog.MetersToCells(lm, scale)
                : synthetic ? t.Light ?? TableFog.MetersToCells(settings.PlayerLightMeters, scale)
                : t.Light ?? (t.CharacterId == null ? settings.CreatureLight : TableFog.MetersToCells(ch?.LightMeters ?? settings.PlayerLightMeters, scale));
            var vision = !observer ? 0 : TableFog.MetersToCells(p?.VisionMeters ?? ch?.VisionMeters ?? settings.PlayerVisionMeters, scale);
            var senses = Senses(p?.Senses ?? ch?.Senses);
            // O observador sintético age como personagem nas regras da mesa (vê, detecta e aparece sempre ao grupo), com dono "rehearsal:{índice}".
            return new FogToken(ids[i], synthetic ? Guid.NewGuid() : t.CharacterId, synthetic ? RehearsalKey(i) : OwnerOf(t.CharacterId), t.Side, t.X, t.Y,
                manual ? 0 : Math.Clamp(light, 0, TableFog.MaxRadius), manual ? 0 : Math.Clamp(vision, 0, TableFog.MaxRadius), p?.Perception ?? ch?.Perception ?? 0, senses,
                !synthetic && t.CharacterId == null && t.Hidden, [], null, null, null, map.Free ? 1 : t.SpanOf().W, map.Free ? 1 : t.SpanOf().H);
        }).ToList();

        // Quem vê.
        List<string> viewers;
        string label;
        if (x.Party) { viewers = tokens.Where(t => t.OwnerUserId != null).Select(t => t.OwnerUserId!).Distinct().ToList(); label = "Grupo"; }
        else if (x.ViewerToken is { } vt)
        {
            if (vt < 0 || vt >= tokens.Count) throw new RuleException(400, "Escolha um marcador da cena para ver como ele.");
            viewers = [tokens[vt].OwnerUserId ?? throw new RuleException(400, "Esse marcador não enxerga na prévia. Dê a ele um perfil de ensaio.")];
            label = placed[vt].Label;
        }
        else if (x.ViewerCharacterId is { } vc)
        {
            var owner = OwnerOf(vc) ?? throw new RuleException(400, "Escolha um personagem de jogador vinculado à campanha.");
            if (!placed.Any(t => t.CharacterId == vc)) throw new RuleException(400, "Posicione o personagem na cena para ver como ele.");
            viewers = [owner]; label = byId[vc].Name;
        }
        else if (!string.IsNullOrEmpty(x.ViewerUserId))
        {
            if (!tokens.Any(t => t.OwnerUserId == x.ViewerUserId)) throw new RuleException(400, "Esse jogador não tem personagem posicionado na cena.");
            viewers = [x.ViewerUserId]; label = "Jogador";
        }
        else { viewers = []; label = "Grupo — só luz comum e áreas reveladas"; }

        var active = prep.Fog ?? settings.FogEnabled;
        if (!active)
            return new { active = false, viewer = label, shown = placed.Select((t, i) => (t, i)).Where(p => !(p.t.CharacterId == null && p.t.Hidden)).Select(p => p.i), perceived = Array.Empty<int>(), marks = Array.Empty<string>() };

        var shared = manual ? Bits.Decode(prep.Revealed, grid.Width * grid.Height) : FogRules.Shared(grid, prep, tokens);
        // Detecção automática como na mesa (em memória): ocultos e marcas percebidos passam a contar na prévia.
        foreach (var (target, who, _) in FogRules.Detect(grid, prep, tokens, shared))
        {
            if (target.StartsWith("mark:")) prep.Marks.First(m => "mark:" + m.Id == target).RevealedTo.Add(who);
            else
            {
                var i = ids.FindIndex(id => id.ToString() == target);
                if (i >= 0) tokens[i] = tokens[i] with { RevealedTo = [.. tokens[i].RevealedTo, who] };
            }
        }
        var n = grid.Width * grid.Height;
        var visible = new bool[n]; var explored = new bool[n];
        var shownSet = new HashSet<Guid>(); var perceivedSet = new HashSet<Guid>(); var markSet = new HashSet<string>(); var plain = new HashSet<Guid>();
        if (viewers.Count == 0)
        {
            visible = (bool[])shared.Clone(); explored = (bool[])shared.Clone();
            foreach (var t in tokens) if (t.IsCharacter || (!t.Hidden && ((t.Side == "ally" && settings.AlliesAlwaysVisible) || t.AnyIn(grid, shared)))) shownSet.Add(t.Id);
        }
        foreach (var viewer in viewers)
        {
            var view = FogRules.View(grid, prep, tokens, shared, viewer, settings);
            visible = Bits.Or(visible, view.Visible); explored = Bits.Or(explored, view.Explored);
            shownSet.UnionWith(view.Tokens); perceivedSet.UnionWith(view.PerceivedTokens); markSet.UnionWith(view.Marks);
            plain.UnionWith(view.Tokens.Except(view.PerceivedTokens));
        }
        // No grupo, quem um jogador vê de fato não aparece como "?" só porque outro apenas o percebeu.
        perceivedSet.ExceptWith(plain);
        var known = settings.RememberExplored ? explored : visible;
        return new
        {
            active = true, viewer = label, remember = settings.RememberExplored,
            visible = Bits.Encode(visible), explored = Bits.Encode(known),
            cells = TableFogService.MaskRows(prep.Cells, known, grid.Width),
            lights = prep.Lights.Where(l => known[grid.Index(l.X, l.Y)]).Select(l => new { l.X, l.Y, l.Radius, l.Dim, l.Color, l.Intensity, l.Animation }),
            walls = TableFogService.PlayerWalls(prep.Walls, known, grid.Width, grid.Height),
            marks = prep.Marks.Where(m => markSet.Contains(m.Id)).Select(m => new { m.Id, m.X, m.Y, m.Kind, m.Label }),
            shown = ids.Select((id, i) => (id, i)).Where(p => shownSet.Contains(p.id)).Select(p => p.i),
            perceived = ids.Select((id, i) => (id, i)).Where(p => perceivedSet.Contains(p.id)).Select(p => p.i),
        };
    }

    public const int MaxProfiles = 60;
    static string RehearsalKey(int index) => $"rehearsal:{index}";

    /// <summary>Perfis de ensaio por índice do marcador: até 60, um por marcador, valores dentro dos limites da ficha.</summary>
    static Dictionary<int, RehearsalProfileInput> ValidProfiles(List<RehearsalProfileInput>? input, int tokens)
    {
        var list = input ?? [];
        if (list.Count > MaxProfiles) throw new RuleException(400, $"Use até {MaxProfiles} perfis de ensaio.");
        var result = new Dictionary<int, RehearsalProfileInput>();
        foreach (var p in list)
        {
            if (p == null || p.Token < 0 || p.Token >= tokens) throw new RuleException(400, "Perfil de ensaio de um marcador que não está na cena. Recarregue o editor.");
            if (p.VisionMeters is < 0 or > 300 || p.LightMeters is < 0 or > 300) throw new RuleException(400, "Visão e luz vão de 0 a 300 metros.");
            if (p.Perception is < -50 or > 100) throw new RuleException(400, "A percepção vai de -50 a 100.");
            if (p.Senses is { Length: > 400 }) throw new RuleException(400, "Os sentidos aceitam até 400 caracteres.");
            if (!result.TryAdd(p.Token, p)) throw new RuleException(400, "Cada marcador recebe um perfil de ensaio.");
        }
        return result;
    }

    /// <summary>Preparação não salva do editor, com as mesmas validações de <see cref="CampaignAssetsService.SaveLayerAsync"/>.</summary>
    static MapFogState DraftLayer(BattleMap map, MapLayerInput x, MapFogState saved)
    {
        if (x.Cells == null || x.Cells.Length != map.Height || x.Cells.Any(r => r == null || r.Length != map.Width || !r.All(TableFog.IsValidCell)))
            throw new RuleException(400, "As marcas do mapa não correspondem à grade. Recarregue o editor.");
        if ((x.Lights?.Count ?? 0) > TableFog.MaxLights) throw new RuleException(409, $"Limite de {TableFog.MaxLights} focos de luz por mapa.");
        if ((x.Marks?.Count ?? 0) > TableFog.MaxMarks) throw new RuleException(409, $"Limite de {TableFog.MaxMarks} marcas ocultas por mapa.");
        var draft = new MapFogState
        {
            Fog = x.Fog, Manual = saved.Manual, Cells = x.Cells, Revealed = Bits.Resize(x.Revealed, map.Width * map.Height),
            Walls = x.Walls == null ? saved.Walls.Select(w => w.Clone()).ToList() : TableFog.ValidWalls(x.Walls, map.Width, map.Height),
        };
        foreach (var l in x.Lights ?? []) FogEdits.UpsertLight(draft, map.Width, map.Height, new FogLightInput(null, l.X, l.Y, l.Radius, l.Dim, l.Color, l.Intensity, l.Animation));
        foreach (var m in x.Marks ?? [])
        {
            var valid = FogEdits.ValidMark(map.Width, map.Height, m);
            if (m.Id != null) valid.Id = m.Id;
            draft.Marks.Add(valid);
        }
        return draft;
    }
}
