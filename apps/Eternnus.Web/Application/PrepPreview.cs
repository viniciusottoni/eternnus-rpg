using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Pedido de prévia do jogador no editor (ADR-088). <c>Layer</c> é a preparação ainda não salva (nula = a salva);
/// <c>Tokens</c> é o arranjo do editor. Quem vê: um personagem (<c>ViewerCharacterId</c>), um jogador (<c>ViewerUserId</c>,
/// todos os personagens dele) ou o grupo inteiro (<c>Party</c>).
/// </summary>
public record PrepPreviewInput(string MapKey, Guid? SceneId, MapLayerInput? Layer, List<SceneTokenInput>? Tokens, string? VisionMode,
    Guid? ViewerCharacterId = null, string? ViewerUserId = null, bool Party = false);

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
        var placed = ScenePrep.ValidateTokens(x.Tokens, grid, characters.Select(c => c.Id).ToHashSet(), characters.ToDictionary(c => c.Id, c => c.Name), npcs, map.Free);
        var byId = characters.ToDictionary(c => c.Id);
        string? OwnerOf(Guid? id) => id is { } cid && byId.TryGetValue(cid, out var c) && c.OwnerId != campaign.OwnerId ? c.OwnerId : null;

        var manual = prep.Manual ?? settings.ManualReveal;
        var scale = map.ScaleMeters;
        // Mesmos valores efetivos de TableFogService.SceneAsync (ficha → ajuste do marcador → configuração da mesa).
        var ids = placed.Select((_, i) => Guid.NewGuid()).ToList();
        var tokens = placed.Select((t, i) =>
        {
            var ch = t.CharacterId is { } cid ? byId.GetValueOrDefault(cid) : null;
            var light = t.Light ?? (t.CharacterId == null ? settings.CreatureLight : TableFog.MetersToCells(ch?.LightMeters ?? settings.PlayerLightMeters, scale));
            var vision = t.CharacterId == null ? 0 : TableFog.MetersToCells(ch?.VisionMeters ?? settings.PlayerVisionMeters, scale);
            var senses = TableFog.ParseSenses(ch?.Senses).Select(s => (s.Name, s.Meters is { } m ? (int?)TableFog.MetersToCells(m, scale) : null)).ToList();
            return new FogToken(ids[i], t.CharacterId, OwnerOf(t.CharacterId), t.Side, t.X, t.Y,
                manual ? 0 : Math.Clamp(light, 0, TableFog.MaxRadius), manual ? 0 : Math.Clamp(vision, 0, TableFog.MaxRadius), ch?.Perception ?? 0, senses,
                t.CharacterId == null && t.Hidden, [], null, null, null, map.Free ? 1 : t.SpanOf().W, map.Free ? 1 : t.SpanOf().H);
        }).ToList();

        // Quem vê.
        List<string> viewers;
        string label;
        if (x.Party) { viewers = tokens.Where(t => t.OwnerUserId != null).Select(t => t.OwnerUserId!).Distinct().ToList(); label = "Grupo"; }
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
