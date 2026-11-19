using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record PresentSceneInput(Guid SceneId, bool Restart);
public record CaptureSceneInput(Guid SceneId);
/// <summary>"Aplicar à cena atual": partes escolhidas pelo mestre; revisão da cena e versão da preparação do mapa que ele revisou.</summary>
/// <summary>Partes da preparação a aplicar. <c>Tokens</c> recoloca os marcadores no arranjo preparado (opcional, desmarcado por padrão).
/// <c>Composition</c>: passa a mostrar na mesa a camada atual da composição visual da cena.</summary>
public record ApplySceneInput(Guid SceneId, bool Text, bool Vision, bool Layer, int SceneRevision, string? PrepVersion = null, bool Tokens = false, bool Composition = false);
/// <summary>Casa da grade.</summary>
public record GridPoint(int X, int Y);
/// <summary>Mudança prevista por "reposicionar marcadores": <c>From</c> nulo = entra na mesa; <c>To</c> nulo = sai.</summary>
public record RepositionMove(string Label, Guid? CharacterId, Guid? TokenId, GridPoint? From, GridPoint? To);
public record SaveSceneAsInput(string Name, string? SharedText = null);
public record NpcTokenInput(Guid MasterCharacterId, int X, int Y, bool Hidden = false, bool Copy = false, int? Fx = null, int? Fy = null, string? Appearance = null, int? Size = null);
/// <summary><c>Index</c>: recurso simples (NPC sem modelo). <c>Field</c>: recurso da ficha-modelo do NPC (bolhas do mapa).</summary>
public record NpcResourceInput(int Index, int Delta, string? Field = null);
public record RecapInput(string? Text, bool Publish);

/// <summary>Cenas, personagens do mestre e resumo durante a sessão. Escritas pelo fluxo comum da mesa.</summary>
public partial class SessionService
{
    /// <summary>
    /// Apresenta uma cena. Guarda o estado da cena atual (marcadores e posições) para retomar depois.
    /// <paramref name="x"/>.Restart = volta à preparação (arranjo, paredes, luzes, marcas e névoa) e recomeça a exploração; senão retoma o estado salvo.
    /// Nome e texto mostrados aos jogadores são os desta apresentação: editar a preparação depois não os altera.
    /// </summary>
    public async Task PresentSceneAsync(Guid sessionId, PresentSceneInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var scene = await db.Scenes.SingleOrDefaultAsync(s => s.Id == x.SceneId && s.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        if (a.Session.SceneId == scene.Id && !x.Restart) { await tx.RollbackAsync(ct); return; }
        await ShowSceneAsync(a, scene, x.Restart, user, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>
    /// Apresenta <paramref name="scene"/> na sessão bloqueada, dentro da transação do chamador (apresentar cena e iniciar sessão
    /// pela cena — ADR-100). Não confirma a transação.
    /// </summary>
    async Task ShowSceneAsync(Access a, Scene scene, bool restart, string user, CancellationToken ct)
    {
        var x = new PresentSceneInput(scene.Id, restart);
        if (a.Session.SceneId is { } currentId && await db.Scenes.SingleOrDefaultAsync(s => s.Id == currentId && s.CampaignId == a.Campaign.Id, ct) is { } current)
            await SaveSceneStateAsync(a.Session, current, ct);
        if (scene.Kind != SceneKinds.Text && scene.MapKey.Length > 0)
        {
            var map = await ResolveMapAsync(a.Campaign.Id, scene.Kind == SceneKinds.Map ? MapKinds.Tileset : MapKinds.Cartographic, scene.MapKey, ct);
            a.Session.MapKind = map.Kind; a.Session.MapKey = map.Key;
            a.Session.LayerKey = scene.Kind == SceneKinds.Map && scene.LayerMode == SceneLayerModes.Scene ? ScenePrep.LayerKey(scene) : null;
        }
        a.Session.SceneName = scene.Name; a.Session.SceneText = scene.SharedText;
        // Composição visual: a mesa guarda a camada desta apresentação; salvar a composição depois não muda a mesa.
        var previousOverlay = a.Session.OverlayId;
        a.Session.OverlayId = scene.Kind != SceneKinds.Text && scene.MapKey.Length > 0 && a.Session.MapKey == scene.MapKey ? scene.OverlayId : null;
        await CampaignAssetsService.ReleaseOverlayAsync(db, a.Campaign.Id, previousOverlay, a.Session.OverlayId, a.Session.Id, ct);
        var tactical = scene.Kind == SceneKinds.Map && a.Session.MapKind == MapKinds.Tileset;
        if (tactical) await PlaceSceneTokensAsync(a, scene, x.Restart || !scene.HasSaved ? scene.Prepared : scene.Saved, ct);
        a.Session.SceneId = scene.Id;
        await db.SaveChangesAsync(ct);
        if (tactical && await Fog.SceneAsync(a.Session, a.Campaign, true, ct) is { } fog)
        {
            // Reiniciar volta à preparação do mapa (inclusive a pendente) e recomeça a exploração; retomar preserva tudo.
            if (x.Restart)
            {
                ScenePrep.Restart(fog.State, TableFogService.PreparedOf(fog.Row, fog.State, fog.Map, fog.Settings));
                if (fog.Row != null) fog.Row.Prepared = null;
            }
            ScenePrep.ApplyVision(fog.State, scene.VisionMode);
            Fog.Save(a.Campaign.Id, fog);
            fog.Invalidate();
        }
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Scene, x.Restart ? $"Cena reiniciada: {scene.Name}" : $"Cena: {scene.Name}",
            new { sceneId = scene.Id, name = scene.Name, kind = scene.Kind, sharedText = scene.SharedText, restart = x.Restart });
        await RefreshFogAsync(a, user, ct);
    }

    /// <summary>
    /// Aplica à cena em apresentação somente as partes escolhidas da preparação salva. Nunca apaga explorações e nunca
    /// cobre áreas já reveladas. Marcadores só mudam quando o mestre marca <c>Tokens</c> (arranjo preparado, como em
    /// "Reiniciar cena", mas preservando exploração, portas e revelações). Cenário diferente exige "Reiniciar cena".
    /// </summary>
    public async Task<object> ApplyScenePreparationAsync(Guid sessionId, ApplySceneInput x, string user, CancellationToken ct)
    {
        if (!x.Text && !x.Vision && !x.Layer && !x.Tokens && !x.Composition) throw new RuleException(400, "Escolha o que aplicar à cena atual.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        if (a.Session.SceneId != x.SceneId) throw new RuleException(409, "Esta cena não está em apresentação. Apresente-a para usar a preparação.");
        var scene = await db.Scenes.AsNoTracking().SingleOrDefaultAsync(s => s.Id == x.SceneId && s.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        if (scene.Revision != x.SceneRevision) throw new RuleException(409, "A preparação da cena mudou depois que você a revisou. Confira de novo antes de aplicar.");
        var applied = new List<string>();
        if (x.Text && (a.Session.SceneName != scene.Name || a.Session.SceneText != scene.SharedText))
        {
            a.Session.SceneName = scene.Name; a.Session.SceneText = scene.SharedText; applied.Add("nome e texto");
        }
        if (x.Composition)
        {
            if (scene.Kind == SceneKinds.Text || a.Session.MapKey != scene.MapKey)
                throw new RuleException(409, "O cenário desta cena mudou na preparação. Use “Reiniciar cena” para apresentar o novo cenário.");
            if (a.Session.OverlayId != scene.OverlayId)
            {
                var previous = a.Session.OverlayId;
                a.Session.OverlayId = scene.OverlayId;
                await CampaignAssetsService.ReleaseOverlayAsync(db, a.Campaign.Id, previous, scene.OverlayId, a.Session.Id, ct);
                applied.Add("composição visual");
            }
        }
        if (x.Vision || x.Layer || x.Tokens)
        {
            if (scene.Kind != SceneKinds.Map || a.Session.MapKind != MapKinds.Tileset || a.Session.MapKey != scene.MapKey)
                throw new RuleException(409, "O cenário desta cena mudou na preparação. Use “Reiniciar cena” para apresentar o novo cenário.");
            if (x.Tokens)
            {
                await PlaceSceneTokensAsync(a, scene, scene.Prepared, ct);
                await db.SaveChangesAsync(ct);
                applied.Add("posições dos marcadores");
            }
            var fog = await RequireSceneAsync(a, ct);
            var changed = false;
            if (x.Layer && fog.Row?.Prepared != null)
            {
                var prep = TableFogService.PreparedOf(fog.Row, fog.State, fog.Map, fog.Settings);
                if (x.PrepVersion != null && TableFogService.PrepVersion(prep) != x.PrepVersion) throw new RuleException(409, "A preparação do mapa mudou depois que você a revisou. Confira de novo antes de aplicar.");
                ScenePrep.ApplyStructure(fog.State, prep);
                fog.Row.Prepared = null; changed = true; applied.Add("paredes, portas, luzes e marcas");
            }
            if (x.Vision && !ScenePrep.VisionApplied(fog.State, scene.VisionMode))
            {
                ScenePrep.ApplyVision(fog.State, scene.VisionMode); changed = true; applied.Add("visibilidade");
            }
            if (changed) { Fog.Save(a.Campaign.Id, fog); fog.Invalidate(); }
        }
        if (applied.Count == 0) { await tx.RollbackAsync(ct); return new { applied }; }
        var author = await NameAsync(user, ct);
        if (applied.Contains("nome e texto"))
            Event(a.Session, user, author, EventKinds.Scene, $"Cena atualizada: {scene.Name}", new { sceneId = scene.Id, name = scene.Name, kind = scene.Kind, sharedText = scene.SharedText, updated = true });
        Event(a.Session, user, author, EventKinds.Scene, $"Mestre aplicou à cena atual: {string.Join(", ", applied)}", new { sceneId = scene.Id, applied }, masterOnly: true);
        await RefreshFogAsync(a, user, ct);
        await CommitAsync(tx, a.Session, ct);
        return new { applied };
    }

    /// <summary>Salva o cenário improvisado (mapa e posições atuais) como uma nova cena, que passa a ser a apresentada.</summary>
    public async Task<object> SaveSceneAsAsync(Guid sessionId, SaveSceneAsInput x, string user, CancellationToken ct)
    {
        var name = Trim(x.Name, 80, "Dê um nome de até 80 caracteres à cena.");
        var text = Trim(x.SharedText, 2000, "O texto para os jogadores aceita até 2.000 caracteres.", false);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        if (a.Session.SceneId != null) throw new RuleException(409, "Esta cena já está salva. Para outra versão, duplique-a na preparação.");
        if (await db.Scenes.CountAsync(s => s.CampaignId == a.Campaign.Id, ct) >= PreparationService.MaxScenes) throw new RuleException(409, $"A campanha aceita até {PreparationService.MaxScenes} cenas.");
        var tactical = a.Session.MapKind == MapKinds.Tileset;
        var raw = tactical ? await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == sessionId).ToListAsync(ct) : [];
        var tokens = raw.Select(ToSceneToken).ToList();
        var order = (await db.Scenes.Where(s => s.CampaignId == a.Campaign.Id).MaxAsync(s => (int?)s.Order, ct) ?? 0) + 1;
        var scene = new Scene
        {
            CampaignId = a.Campaign.Id, Name = name, Kind = tactical ? SceneKinds.Map : SceneKinds.Image, MapKind = a.Session.MapKind, MapKey = a.Session.MapKey,
            SharedText = text, Prepared = tokens, Saved = raw.Select(ToSceneToken).ToList(),
            HasSaved = true, Order = Math.Min(order, 10000), UpdatedAt = Now,
        };
        db.Scenes.Add(scene);
        a.Session.SceneId = scene.Id; a.Session.SceneName = name; a.Session.SceneText = text; a.Session.LayerKey = null;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Scene, $"Mestre salvou o cenário atual como a cena {name}", new { sceneId = scene.Id, saved = true }, masterOnly: true);
        await CommitAsync(tx, a.Session, ct);
        return new { scene.Id, scene.Revision };
    }

    async Task SaveSceneStateAsync(GameSession s, Scene scene, CancellationToken ct)
    {
        // Estado de uma cena só faz sentido no mapa dela: uma cena de texto ou imagem não captura marcadores de outro mapa.
        if (scene.Kind != SceneKinds.Map || s.MapKind != MapKinds.Tileset || s.MapKey != scene.MapKey) { scene.UpdatedAt = Now; return; }
        var tokens = await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == s.Id).ToListAsync(ct);
        scene.Saved = tokens.Select(ToSceneToken).ToList();
        scene.HasSaved = true; scene.UpdatedAt = Now;
    }

    static SceneToken ToSceneToken(SessionToken t) => new()
    {
        CharacterId = t.CharacterId, MasterCharacterId = t.MasterCharacterId, Label = t.Label, Side = t.Side, X = t.X, Y = t.Y, Fx = t.Fx, Fy = t.Fy, Hidden = t.Hidden, Light = t.Light,
        Appearance = t.Appearance, Size = t.Size, ImageUrl = t.ImageUrl, Width = t.Width, Height = t.Height,
    };

    /// <summary>
    /// Recoloca marcadores da cena (<see cref="ScenePlacement"/>). Posições inválidas ou ocupadas são descartadas (criaturas) ou
    /// trocadas pela entrada da cena, pela "Entrada do grupo" do mapa ou pelos pontos de entrada da grade (personagens).
    /// </summary>
    async Task PlaceSceneTokensAsync(Access a, Scene? scene, IReadOnlyList<SceneToken> source, CancellationToken ct)
    {
        var s = a.Session;
        await db.SessionTokens.Where(t => t.SessionId == s.Id).ExecuteDeleteAsync(ct);
        if (await PlanSceneTokensAsync(s, scene, source, ct) is not { } plan) return;
        // Movimentação livre: várias criaturas por casa e posição fina preservada; com grade, uma por casa, no centro.
        int? Fine(int? value) => plan.Map.Free && value is >= 0 and < FinePositions.Scale ? value : null;
        static (int? W, int? H) Span(SceneToken t) => TokenLooks.CleanSpan(t.Width, t.Height);
        var npcs = (await db.MasterCharacters.Where(m => m.CampaignId == s.CampaignId).Select(m => m.Id).ToListAsync(ct)).ToHashSet();
        foreach (var p in plan.Placements)
        {
            var t = p.Source;
            if (p.CharacterId is { } cid)
            {
                var name = plan.Present[cid].Name;
                var label = name.Length > 40 ? name[..40] : name;
                db.SessionTokens.Add(t == null
                    ? new() { SessionId = s.Id, CharacterId = cid, Label = label, Side = "ally", X = p.X, Y = p.Y }
                    : new() { SessionId = s.Id, CharacterId = cid, Label = label, Side = "ally", X = p.X, Y = p.Y, Fx = Fine(t.Fx), Fy = Fine(t.Fy),
                        Appearance = TokenLooks.Clean(t.Appearance), Size = TokenLooks.CleanSize(t.Size ?? TokenLooks.DefaultSize), ImageUrl = t.ImageUrl, Width = Span(t).W, Height = Span(t).H });
                continue;
            }
            db.SessionTokens.Add(new()
            {
                SessionId = s.Id, Label = t!.Label, Side = Sides.Contains(t.Side) ? t.Side : "enemy", X = p.X, Y = p.Y, Fx = Fine(t.Fx), Fy = Fine(t.Fy), Hidden = t.Hidden,
                Light = t.Light is >= 0 and <= TableFog.MaxRadius ? t.Light : null, MasterCharacterId = t.MasterCharacterId is { } m && npcs.Contains(m) ? m : null,
                Appearance = TokenLooks.Clean(t.Appearance), Size = TokenLooks.CleanSize(t.Size ?? TokenLooks.DefaultSize), ImageUrl = t.ImageUrl, Width = Span(t).W, Height = Span(t).H,
            });
        }
    }

    sealed record ScenePlan(BattleMap Map, Dictionary<Guid, Character> Present, List<ScenePlacement.Placement> Placements);

    /// <summary>Plano dos marcadores da cena no mapa da sessão, sem gravar: personagens presentes (ordem de entrada) e arranjo.</summary>
    async Task<ScenePlan?> PlanSceneTokensAsync(GameSession s, Scene? scene, IReadOnlyList<SceneToken> source, CancellationToken ct)
    {
        var map = BattleMaps.Find(s.MapKey) ?? (await new CampaignAssetsService(db).ResolveMapAsync(s.CampaignId, s.MapKey, ct))?.Battle();
        if (map == null) return null;
        var (_, layer) = await Fog.LayerAsync(s.CampaignId, map, TableSettings.Default, false, ct, ScenePrep.SessionLayer(s));
        var grid = FogGrid.Of(map, layer);
        var present = (await db.SessionParticipants.Where(p => p.SessionId == s.Id && p.CharacterId != null).OrderBy(p => p.JoinedAt)
            .Join(db.Characters, p => p.CharacterId, c => c.Id, (p, c) => c).ToListAsync(ct)).DistinctBy(c => c.Id).ToList();
        var own = scene != null && scene.Kind == SceneKinds.Map && scene.MapKey == s.MapKey ? scene.Entry : null;
        var entries = await EntryRectsAsync(s, own, ct);
        return new(map, present.ToDictionary(c => c.Id), ScenePlacement.Plan(map, grid, source, present.Select(c => c.Id).ToList(), entries));
    }

    /// <summary>Áreas de entrada na ordem: a da cena (quando informada) e a "Entrada do grupo" do mapa da sessão.</summary>
    async Task<List<EntryRect>> EntryRectsAsync(GameSession s, string? sceneEntry, CancellationToken ct) =>
        ScenePlacement.Entries(SceneEntries.Parse(sceneEntry), await new CampaignAssetsService(db).EntriesAsync(s.CampaignId, s.MapKey, ct));

    /// <summary>
    /// Prévia de "reposicionar marcadores" (somente leitura): o que <c>POST …/scene/apply</c> com <c>tokens</c> faria com a mesa,
    /// pela mesma regra. Lista quem muda de casa, entra ou sai; os demais contam em <c>unchanged</c>.
    /// </summary>
    public async Task<object> RepositionPreviewAsync(Guid sessionId, Guid sceneId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct); RequireMaster(a);
        var s = a.Session;
        if (s.EndedAt != null) throw new RuleException(409, "Esta sessão foi encerrada pelo mestre.");
        if (s.SceneId != sceneId) throw new RuleException(409, "Esta cena não está em apresentação. Apresente-a para usar a preparação.");
        var scene = await db.Scenes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == sceneId && x.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        if (scene.Kind != SceneKinds.Map || s.MapKind != MapKinds.Tileset || s.MapKey != scene.MapKey)
            throw new RuleException(409, "O cenário desta cena mudou na preparação. Use “Reiniciar cena” para apresentar o novo cenário.");
        var plan = await PlanSceneTokensAsync(s, scene, scene.Prepared, ct) ?? throw new RuleException(409, "Mapa com grade não encontrado.");
        var current = await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == sessionId).OrderBy(t => t.Label).ThenBy(t => t.Id).ToListAsync(ct);
        var moves = new List<RepositionMove>();
        var unchanged = 0;
        static GridPoint At(int x, int y) => new(x, y);
        void Compare(string label, Guid? character, SessionToken? from, ScenePlacement.Placement to)
        {
            if (from != null && from.X == to.X && from.Y == to.Y) { unchanged++; return; }
            moves.Add(new(label, character, from?.Id, from == null ? null : At(from.X, from.Y), At(to.X, to.Y)));
        }
        var pool = current.ToList();
        foreach (var p in plan.Placements)
        {
            if (p.CharacterId is { } cid)
            {
                var token = pool.FirstOrDefault(t => t.CharacterId == cid);
                if (token != null) pool.Remove(token);
                var name = plan.Present[cid].Name;
                Compare(name.Length > 40 ? name[..40] : name, cid, token, p);
                continue;
            }
            // Marcadores do mestre: o mesmo personagem do mestre e nome, de preferência já na casa planejada.
            var src = p.Source!;
            var same = pool.Where(t => t.CharacterId == null && t.MasterCharacterId == src.MasterCharacterId && t.Label == src.Label).ToList();
            var match = same.FirstOrDefault(t => t.X == p.X && t.Y == p.Y) ?? same.FirstOrDefault();
            if (match != null) pool.Remove(match);
            Compare(src.Label, null, match, p);
        }
        foreach (var t in pool) moves.Add(new(t.Label, t.CharacterId, t.Id, At(t.X, t.Y), null));
        return new { moves, unchanged };
    }

    /// <summary>Salva o arranjo atual da mesa como preparo da cena (posições iniciais de "reiniciar"). Atalho da mesa; a preparação privada fica no editor.</summary>
    public async Task CaptureSceneAsync(Guid sessionId, CaptureSceneInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var scene = await db.Scenes.SingleOrDefaultAsync(s => s.Id == x.SceneId && s.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Cena não encontrada.");
        var tokens = await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == sessionId).ToListAsync(ct);
        // Reservados (ADR-110) não vão à mesa: o arranjo capturado os mantém (no mesmo mapa, se ainda couberem) e conserva o vínculo dos personagens.
        var previous = scene.Prepared.Select(ScenePrep.Clone).ToList();
        BattleMap? slotMap = null; FogGrid? slotGrid = null;
        if (scene.Kind == SceneKinds.Map && a.Session.MapKind == MapKinds.Tileset && scene.MapKey == a.Session.MapKey && previous.Any(t => t.SlotId != null && t.CharacterId == null))
        {
            slotMap = BattleMaps.Find(a.Session.MapKey) ?? (await new CampaignAssetsService(db).ResolveMapAsync(a.Campaign.Id, a.Session.MapKey, ct))?.Battle();
            if (slotMap != null) slotGrid = FogGrid.Of(slotMap, (await Fog.LayerAsync(a.Campaign.Id, slotMap, TableSettings.Default, false, ct, ScenePrep.SessionLayer(a.Session))).Item2);
        }
        scene.Prepared = ScenePlacement.KeepSlots(slotMap, slotGrid, tokens.Select(ToSceneToken).ToList(), previous);
        // Outro cenário: composição visual e entrada da cena eram do mapa anterior.
        if (a.Session.MapKey.Length > 0 && scene.Kind != SceneKinds.Text && scene.MapKey != a.Session.MapKey)
        {
            scene.Composition = null; scene.OverlayId = null; scene.Entry = null;
            await CampaignAssetsService.DeleteSceneAssetsAsync(db, a.Campaign.Id, scene.Id, ct);
        }
        if (a.Session.MapKey.Length > 0 && scene.Kind != SceneKinds.Text) { scene.MapKind = a.Session.MapKind; scene.MapKey = a.Session.MapKey; scene.Kind = a.Session.MapKind == MapKinds.Tileset ? SceneKinds.Map : SceneKinds.Image; }
        scene.Revision++; scene.UpdatedAt = Now;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Scene, $"Mestre guardou o arranjo da cena {scene.Name}", new { sceneId = scene.Id, captured = true }, masterOnly: true);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Coloca um personagem do mestre no mapa; <c>Copy</c> cria uma cópia de encontro sem alterar o original.</summary>
    public async Task<object> AddNpcTokenAsync(Guid sessionId, NpcTokenInput x, string user, CancellationToken ct)
    {
        var appearance = x.Appearance == null ? TokenLooks.Round : TokenLooks.Require(x.Appearance);
        var size = x.Size is { } chosen ? TokenLooks.RequireSize(chosen) : TokenLooks.DefaultSize;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var npc = await db.MasterCharacters.SingleOrDefaultAsync(m => m.Id == x.MasterCharacterId && m.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Personagem do mestre não encontrado.");
        var scene = await RequireSceneAsync(a, ct);
        var (fx, fy) = FinePositions.Clean(scene.Map.Free, x.Fx, x.Fy);
        if (!scene.Grid.Inside(x.X, x.Y) || scene.Grid.BlocksMove(x.X, x.Y)) throw new RuleException(400, "Esse ponto do mapa está bloqueado.");
        if (!scene.Map.Free && TokenSpans.Taken(scene.Raw.Values).Contains((x.X, x.Y))) throw new RuleException(409, "Já existe alguém nesse ponto.");
        if (scene.Raw.Count >= 60) throw new RuleException(409, "Limite de 60 marcadores no mapa.");
        if (x.Copy)
        {
            if (await db.MasterCharacters.CountAsync(m => m.CampaignId == a.Campaign.Id, ct) >= PreparationService.MaxNpcs) throw new RuleException(409, $"A campanha aceita até {PreparationService.MaxNpcs} personagens do mestre.");
            npc = PreparationService.CopyOf(npc, Now);
            db.MasterCharacters.Add(npc);
        }
        var token = new SessionToken { SessionId = sessionId, Label = npc.Name, Side = npc.Side, X = x.X, Y = x.Y, Fx = fx, Fy = fy, Hidden = x.Hidden, MasterCharacterId = npc.Id, Appearance = appearance, Size = size };
        db.SessionTokens.Add(token);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Token, $"{npc.Name} surgiu no mapa", new { tokenId = token.Id, side = npc.Side, x = x.X, y = x.Y }, masterOnly: Secret(scene, token));
        await RefreshFogAsync(a, user, ct);
        await CommitAsync(tx, a.Session, ct);
        return new { token.Id, masterCharacterId = npc.Id };
    }

    public async Task AdjustNpcResourceAsync(Guid sessionId, Guid npcId, NpcResourceInput x, string user, CancellationToken ct)
    {
        if (x.Delta is 0 or < -100000 or > 100000) throw new RuleException(400, "Informe um ajuste diferente de zero.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var npc = await db.MasterCharacters.SingleOrDefaultAsync(m => m.Id == npcId && m.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Personagem do mestre não encontrado.");
        if (npc.TemplateVersionId is { } versionId)
        {
            // Ficha-modelo: só campos marcados como recurso (ou o papel Vida), nos limites do modelo, como na ficha dos jogadores.
            if (string.IsNullOrEmpty(x.Field)) throw new RuleException(409, "Este personagem usa modelo de ficha: ajuste os valores pela ficha.");
            var version = await db.SheetTemplateVersions.AsNoTracking().SingleAsync(v => v.Id == versionId, ct);
            var field = SheetSummary.ResourceField(version.Fields, x.Field) ?? throw new RuleException(404, "Esse recurso não existe na ficha.");
            var stored = CharacterSheets.Complete(version.Fields, CharacterSheets.ParseValues(npc.Values)).Stored;
            var all = CharacterSheets.All(version.Fields, stored);
            static double Num(IReadOnlyDictionary<string, string> v, string? k) => k != null && v.TryGetValue(k, out var s) && double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;
            var maxField = field.MaxField ?? (field.Role == SheetFieldRoles.Hp ? version.Fields.FirstOrDefault(f => f.Role == SheetFieldRoles.MaxHp)?.Name : null);
            double? top = maxField != null && all.ContainsKey(maxField) ? Num(all, maxField) : field.Max;
            var old = Num(all, field.Name);
            var next = Math.Round(Math.Max(field.Min ?? 0, old + x.Delta));
            if (top is { } t) next = Math.Min(t, next);
            if (next == old) { await tx.RollbackAsync(ct); return; }
            var values = new Dictionary<string, string>(stored, StringComparer.Ordinal) { [field.Name] = Formula.Format(next) };
            npc.Values = System.Text.Json.JsonSerializer.Serialize(CharacterSheets.Complete(version.Fields, values).Stored);
            npc.Revision++; npc.UpdatedAt = Now;
            db.Entry(npc).State = EntityState.Modified;
            var label = string.IsNullOrWhiteSpace(field.Label) ? field.Name : field.Label;
            Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet, $"{npc.Name}: {label} {Formula.Format(old)} → {Formula.Format(next)}", new { npcId, field = field.Name, before = old, after = next }, masterOnly: true);
            await CommitAsync(tx, a.Session, ct);
            return;
        }
        if (x.Index < 0 || x.Index >= npc.Resources.Count) throw new RuleException(404, "Recurso não encontrado.");
        var r = npc.Resources[x.Index];
        var before = r.Value;
        var after = Math.Max(0, before + x.Delta);
        if (r.Max is { } max) after = Math.Min(max, after);
        if (after == before) { await tx.RollbackAsync(ct); return; }
        r.Value = after; npc.Revision++; npc.UpdatedAt = Now;
        db.Entry(npc).State = EntityState.Modified;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet, $"{npc.Name}: {r.Label} {before} → {after}", new { npcId, index = x.Index, before, after }, masterOnly: true);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Resumo da sessão (também depois de encerrada). Publicar torna visível aos jogadores no diário da campanha.</summary>
    public async Task RecapAsync(Guid sessionId, RecapInput x, string user, CancellationToken ct)
    {
        var text = Trim(x.Text, 10000, "O resumo aceita até 10.000 caracteres.", false);
        if (x.Publish && text.Length == 0) throw new RuleException(400, "Escreva o resumo antes de publicar.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct, requireActive: false); RequireMaster(a);
        var wasPublished = a.Session.RecapPublishedAt != null;
        a.Session.Recap = text;
        a.Session.RecapPublishedAt = x.Publish ? (a.Session.RecapPublishedAt ?? Now) : null;
        if (x.Publish && !wasPublished) Event(a.Session, user, await NameAsync(user, ct), EventKinds.Note, "Resumo da sessão publicado no diário da campanha", new { recap = true, shared = true });
        if (x.Publish && !wasPublished) await NoticeService.NotifyAsync(db, a.Session.CampaignId, user, NoticeAreas.Journal, $"live-{sessionId}", NoticeAudience.Players, ct);
        else if (!x.Publish) await NoticeService.ForgetAsync(db, a.Session.CampaignId, $"live-{sessionId}", ct);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Move a sessão (também encerrada) para um capítulo da campanha, ou a deixa avulsa. Organização do mestre; não gera evento.</summary>
    public async Task ChapterAsync(Guid sessionId, SessionChapterInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct, requireActive: false); RequireMaster(a);
        var chapterId = await WorkspaceService.ChapterOf(db, a.Session.CampaignId, x.ChapterId, ct);
        if (a.Session.ChapterId == chapterId) { await tx.RollbackAsync(ct); return; }
        a.Session.ChapterId = chapterId;
        await CommitAsync(tx, a.Session, ct);
    }
}
