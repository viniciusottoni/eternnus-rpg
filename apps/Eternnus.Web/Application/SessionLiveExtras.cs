using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Blocos do estado ao vivo ligados à condução independente do sistema. Somente leitura.</summary>
public partial class SessionService
{
    /// <summary>Recursos resumidos (até três) e condições das fichas visíveis ao usuário. Fichas privadas alheias não entram.</summary>
    async Task<Dictionary<Guid, object>> PartySummariesAsync(IReadOnlyCollection<Guid> characterIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, object>();
        if (characterIds.Count == 0) return result;
        var characters = await db.Characters.AsNoTracking().Where(c => characterIds.Contains(c.Id)).ToListAsync(ct);
        var versionIds = characters.Select(c => c.TemplateVersionId ?? SheetTemplateVersion.FreeTemplateV1Id).Distinct().ToList();
        var versions = await db.SheetTemplateVersions.AsNoTracking().Where(v => versionIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, ct);
        foreach (var c in characters)
        {
            if (!versions.TryGetValue(c.TemplateVersionId ?? SheetTemplateVersion.FreeTemplateV1Id, out var v)) continue;
            var raw = c.TemplateVersionId == null ? CharacterSheets.LegacyValues(c) : CharacterSheets.ParseValues(c.Values);
            var (stored, _) = CharacterSheets.Complete(v.Fields, raw);
            var all = CharacterSheets.All(v.Fields, stored);
            var (resources, stats) = SheetSummary.Build(v.Fields, all);
            // armor: CA/Armadura para a bolha do marcador no mapa (nulo quando o modelo não define o papel).
            result[c.Id] = new { resources = resources.Take(3), stats = stats.Take(3), conditions = c.Conditions, armor = SheetSummary.Armor(v.Fields, all) };
        }
        return result;
    }

    /// <summary>Forma de jogo, pausa, ordem de turnos (sem nomes de criaturas ocultas para jogadores), cena e prazo de recuperação.</summary>
    async Task<object> PlayStateAsync(Access a, string user, Guid? myCharacter, CancellationToken ct)
    {
        var s = a.Session;
        var order = TurnOrders.Parse(s.TurnOrder);
        var hidden = a.IsMaster ? [] : (await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == s.Id && t.Hidden).Select(t => t.Id).ToListAsync(ct)).ToHashSet();
        var entries = order.Select(e => new
        {
            e.Key,
            label = TurnOrders.TokenOf(e.Key) is { } t && hidden.Contains(t) ? "Mestre" : e.Label,
            initiative = a.IsMaster || TurnOrders.TokenOf(e.Key) == null ? e.Initiative : null,
            members = e.Members,
        }).ToList();
        object? scene = null;
        if (s.SceneId is { } sceneId && await db.Scenes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == sceneId, ct) is { } sc)
        {
            // Jogadores recebem o que foi apresentado (ou aplicado); sessões anteriores à separação seguem a cena.
            var name = s.SceneName ?? sc.Name;
            var text = s.SceneText ?? sc.SharedText;
            if (a.IsMaster)
            {
                var layerKey = ScenePrep.SessionLayer(s);
                var layerPending = sc.Kind == SceneKinds.Map && await db.Set<CampaignMapLayer>().AsNoTracking().AnyAsync(l => l.CampaignId == s.CampaignId && l.MapKey == layerKey && l.Prepared != null, ct);
                var visionPending = false;
                if (sc.Kind == SceneKinds.Map && sc.VisionMode != null && await Fog.SceneAsync(s, a.Campaign, false, ct) is { } fog) visionPending = !ScenePrep.VisionApplied(fog.State, sc.VisionMode);
                scene = new
                {
                    sc.Id, name, sc.Kind, sharedText = text, sc.Description, sc.PrivateNotes, sc.VisionMode, sc.LayerMode, sc.Revision,
                    prepared = new { sc.Name, sc.SharedText },
                    pending = new
                    {
                        text = name != sc.Name || text != sc.SharedText,
                        vision = visionPending,
                        layer = layerPending,
                        map = sc.Kind != SceneKinds.Text && sc.MapKey != s.MapKey,
                    },
                };
            }
            else scene = new { sc.Id, name, sc.Kind, sharedText = text, Description = "", PrivateNotes = "", VisionMode = (string?)null };
        }
        var masterOnline = await db.SessionParticipants.AsNoTracking().Where(p => p.SessionId == s.Id && p.IsMaster).Select(p => p.LastSeenAt).FirstOrDefaultAsync(ct);
        var away = !TableRules.IsOnline(masterOnline, Now);
        var settings = await Fog.SettingsAsync(a.Campaign, s, ct);
        List<object> npcs = [];
        if (a.IsMaster)
        {
            var rows = await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == s.Id && t.MasterCharacterId != null)
                .Join(db.MasterCharacters, t => t.MasterCharacterId, m => m.Id, (t, m) => new { tokenId = t.Id, m.Id, m.Name, m.Summary, m.Resources, m.SourceId, m.Kind, m.ImageUrl, m.TemplateVersionId, m.Values, m.Revision }).ToListAsync(ct);
            // Resumo da ficha (recursos e destaques do modelo) para acompanhar cada NPC/criatura; versões numa só consulta.
            var versionIds = rows.Where(r => r.TemplateVersionId != null).Select(r => r.TemplateVersionId!.Value).Distinct().ToList();
            var versions = await db.SheetTemplateVersions.AsNoTracking().Where(v => versionIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, ct);
            foreach (var r in rows)
            {
                object? sheet = null;
                if (r.TemplateVersionId is { } vid && versions.TryGetValue(vid, out var version))
                {
                    var all = CharacterSheets.All(version.Fields, CharacterSheets.Complete(version.Fields, CharacterSheets.ParseValues(r.Values)).Stored);
                    var (resources, stats) = SheetSummary.Build(version.Fields, all);
                    sheet = new { resources, stats, armor = SheetSummary.Armor(version.Fields, all) };
                }
                // Com ficha, os recursos simples ficam guardados mas não aparecem nem são ajustados na mesa (ADR-065).
                npcs.Add(new { r.tokenId, r.Id, r.Name, r.Summary, resources = sheet == null ? r.Resources : [], r.SourceId, r.Kind, r.Revision, image = PortraitUrl(s.Id, r.tokenId, r.ImageUrl), hasSheet = sheet != null, sheet });
            }
        }
        return new
        {
            mode = PlayModes.Effective(s.PlayMode),
            modeLabel = PlayModes.Label(s.PlayMode),
            paused = s.PausedAt != null,
            // Jogadores veem quem recebe as próprias rolagens (definido pelo mestre na configuração da mesa).
            playerRollVisibility = settings.PlayerRollVisibility,
            // Movimento do jogador: exige liberação do mestre no turno atual (configuração da mesa).
            moveNeedsGrant = settings.MoveNeedsGrant,
            moveGranted = s.MoveGrantTurn == s.TurnNumber,
            turnOrder = entries,
            activeTurnKey = s.ActiveTurnKey,
            myTurn = IsTurnOf(s, myCharacter),
            scene,
            masterAway = away,
            recoverUntil = a.Campaign.IsOneShot && away ? OneShotLifecycleService.RecoverUntil(a.Campaign) : null,
            recoveryMinutes = (int)OneShotLifecycleService.MasterAbsence.TotalMinutes,
            rollRequests = await RollRequestsViewAsync(s, user, a.IsMaster, myCharacter, ct),
            npcs,
            recap = a.IsMaster ? s.Recap : null,
            recapPublished = s.RecapPublishedAt != null,
        };
    }
}
