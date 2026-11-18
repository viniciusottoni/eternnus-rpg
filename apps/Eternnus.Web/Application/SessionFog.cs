using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record FogCellInput(int X, int Y);
public record FogPaintInput(string Tool, List<FogCellInput>? Cells);
public record FogDoorInput(int X, int Y);
public record FogLightInput(string? Id, int X, int Y, int Radius, int? Dim = null, string? Color = null, int? Intensity = null, string? Animation = null);
/// <summary>Todas as paredes vetoriais da camada (substitui a lista). Estado aberto das portas vem junto.</summary>
public record FogWallsInput(List<FogWall>? Walls);
public record FogWallDoorInput(string Id);
public record FogMarkInput(string? Id, int X, int Y, string Kind, string Label, int? Dc, string? Sense, int? MaxDistance);
public record FogRevealInput(bool All, List<string>? UserIds);
public record FogEnabledInput(bool? Enabled);
/// <summary>
/// Estado completo desejado do marcador (nulo = valor da ficha/configuração). Nome, lado e ficha valem só para criaturas:
/// <c>Label</c>/<c>Side</c> nulos mantêm o atual; <c>TemplateId</c> vincula uma ficha a um marcador que ainda não tem.
/// </summary>
public record TokenSettingsInput(int? Light, int? Vision, int? Perception, string? Senses, bool Hidden, int? Dc, string? DetectSense, int? DetectRange,
    string? Label = null, string? Side = null, Guid? TemplateId = null, bool UnlinkSheet = false);
/// <summary>Configuração da mesa: <c>scope</c> "session" (só esta sessão) ou "campaign" (campanha toda). Settings nulo volta ao nível de cima.</summary>
public record TableSettingsInput(TableSettings? Settings, string Scope);
/// <summary>Configuração da campanha; nulo volta ao padrão do sistema.</summary>
public record CampaignTableSettingsInput(TableSettings? Settings);

/// <summary>Névoa, iluminação, visão e configuração da mesa. Escritas seguem o fluxo comum: bloqueio → evento → revisão → sinal.</summary>
public partial class SessionService
{
    TableFogService Fog => new(db);

    async Task<FogScene> RequireSceneAsync(Access a, CancellationToken ct) =>
        await Fog.SceneAsync(a.Session, a.Campaign, true, ct) ?? throw new RuleException(409, "Marcadores, névoa e luz existem somente em mapas com grade.");

    /// <summary>Depois de mudar marcadores/mapa: grava pendências, atualiza explorações e aplica a detecção automática.</summary>
    async Task RefreshFogAsync(Access a, string user, CancellationToken ct)
    {
        await db.SaveChangesAsync(ct);
        var scene = await Fog.SceneAsync(a.Session, a.Campaign, true, ct);
        if (scene != null) await DetectAsync(a, scene, user, ct);
    }

    async Task DetectAsync(Access a, FogScene scene, string user, CancellationToken ct)
    {
        var found = Fog.Refresh(a.Campaign.Id, scene);
        if (found.Count == 0) return;
        var author = await NameAsync(user, ct);
        foreach (var (target, who, label) in found)
        {
            var viewer = scene.Tokens.FirstOrDefault(t => t.OwnerUserId == who);
            var name = viewer != null && scene.Raw.TryGetValue(viewer.Id, out var raw) ? raw.Label : "Um aventureiro";
            // Visível só ao mestre e a quem percebeu.
            Event(a.Session, user, author, EventKinds.Token, $"{name} percebeu: {label}", new { target, perceivedBy = who }, masterOnly: true, visibleTo: who);
        }
    }

    async Task FogWriteAsync(Guid sessionId, string user, string text, Action<FogScene> change, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var scene = await RequireSceneAsync(a, ct);
        change(scene);
        Fog.Save(a.Campaign.Id, scene);
        scene.Invalidate();
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, text, null, masterOnly: true);
        await DetectAsync(a, scene, user, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task PaintFogAsync(Guid sessionId, FogPaintInput x, string user, CancellationToken ct)
    {
        var cells = FogEdits.Cells(x.Cells);
        FogEdits.RequireTool(x.Tool);
        if (x.Tool is not ("reveal" or "conceal"))
        {
            await FogWriteAsync(sessionId, user, FogEdits.Describe(x.Tool), s => FogEdits.Paint(s.State, s.Map.Width, s.Map.Height, x.Tool, cells), ct);
            return;
        }
        // Revelar/cobrir pode ser desfeito (ADR-100): o evento guarda só as casas que mudaram, em faixas compactas.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var scene = await RequireSceneAsync(a, ct);
        var size = scene.Map.Width * scene.Map.Height;
        var before = Bits.Decode(scene.State.Revealed, size);
        FogEdits.Paint(scene.State, scene.Map.Width, scene.Map.Height, x.Tool, cells);
        var after = Bits.Decode(scene.State.Revealed, size);
        var changed = Enumerable.Range(0, size).Where(i => before[i] != after[i]).ToList();
        if (changed.Count == 0) { await tx.RollbackAsync(ct); return; }
        Fog.Save(a.Campaign.Id, scene);
        scene.Invalidate();
        var ranges = FogEdits.Ranges(changed);
        object data = ranges.Length <= FogEdits.MaxUndoRanges
            ? new { tool = x.Tool, cells = ranges, mapKey = a.Session.MapKey, layerKey = a.Session.LayerKey, undoable = true }
            : new { tool = x.Tool, count = changed.Count };
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, FogEdits.Describe(x.Tool), data, masterOnly: true);
        await DetectAsync(a, scene, user, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Desfaz revelar/cobrir: só se o mapa for o mesmo e as casas ainda estiverem como a pintura deixou.</summary>
    async Task UndoFogPaintAsync(Access a, TableEvent e, JsonElement d, string user, string author, CancellationToken ct)
    {
        var tool = d.GetProperty("tool").GetString();
        if (d.GetProperty("mapKey").GetString() != a.Session.MapKey || (d.TryGetProperty("layerKey", out var lk) && lk.ValueKind == JsonValueKind.String ? lk.GetString() : null) != a.Session.LayerKey)
            throw new RuleException(409, "O mapa mudou desde essa alteração; desfazer não se aplica a outro mapa.");
        var scene = await RequireSceneAsync(a, ct);
        var size = scene.Map.Width * scene.Map.Height;
        var cells = FogEdits.ParseRanges(d.GetProperty("cells").GetString(), size);
        var revealed = Bits.Decode(scene.State.Revealed, size);
        var painted = tool == "reveal";
        if (cells.Any(i => revealed[i] != painted)) throw new RuleException(409, "Essas casas mudaram depois; desfazer não sobrescreve a alteração mais recente.");
        foreach (var i in cells) revealed[i] = !painted;
        scene.State.Revealed = Bits.Encode(revealed);
        Fog.Save(a.Campaign.Id, scene);
        scene.Invalidate();
        Event(a.Session, user, author, EventKinds.Map, $"{FogEdits.Describe(tool!)} (desfeito)", new { undoOf = e.Id, tool }, masterOnly: true);
        await DetectAsync(a, scene, user, ct);
    }

    public Task ToggleDoorAsync(Guid sessionId, FogDoorInput x, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre abriu ou fechou uma porta", s => FogEdits.ToggleDoor(s.State, s.Map.Width, s.Map.Height, x.X, x.Y), ct);

    public Task SaveWallsAsync(Guid sessionId, FogWallsInput x, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre ajustou paredes e portas", s => s.State.Walls = TableFog.ValidWalls(x.Walls, s.Map.Width, s.Map.Height), ct);

    public Task ToggleWallDoorAsync(Guid sessionId, FogWallDoorInput x, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre abriu ou fechou uma porta", s => FogEdits.ToggleWallDoor(s.State, x.Id), ct);

    public Task SaveLightAsync(Guid sessionId, FogLightInput x, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre ajustou um foco de luz", s => FogEdits.UpsertLight(s.State, s.Map.Width, s.Map.Height, x), ct);

    public Task RemoveLightAsync(Guid sessionId, string lightId, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre apagou um foco de luz", s => FogEdits.RemoveLight(s.State, lightId), ct);

    public Task SaveMarkAsync(Guid sessionId, FogMarkInput x, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre ajustou uma marca oculta", s => FogEdits.UpsertMark(s.State, s.Map.Width, s.Map.Height, x), ct);

    public Task RemoveMarkAsync(Guid sessionId, string markId, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre removeu uma marca oculta", s => FogEdits.RemoveMark(s.State, markId), ct);

    public async Task RevealMarkAsync(Guid sessionId, string markId, FogRevealInput x, string user, CancellationToken ct)
    {
        var players = await PlayersAsync(sessionId, ct);
        var chosen = ChosenPlayers(x, players);
        await FogWriteAsync(sessionId, user, "Mestre mudou quem vê uma marca oculta", s =>
        {
            var mark = s.State.Marks.FirstOrDefault(m => m.Id == markId) ?? throw new RuleException(404, "Marca não encontrada.");
            mark.RevealedAll = x.All; mark.RevealedTo = x.All ? [] : chosen;
        }, ct);
    }

    public Task SetFogEnabledAsync(Guid sessionId, FogEnabledInput x, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, x.Enabled switch { true => "Mestre ativou a névoa", false => "Mestre desativou a névoa", _ => "Névoa segue a configuração da mesa" },
            s => s.State.Fog = x.Enabled, ct);

    public Task ResetExplorationAsync(Guid sessionId, string user, CancellationToken ct) =>
        FogWriteAsync(sessionId, user, "Mestre recomeçou a exploração do mapa", s => FogEdits.ResetExploration(s.State), ct);

    async Task<List<string>> PlayersAsync(Guid sessionId, CancellationToken ct) =>
        await db.SessionParticipants.Where(p => p.SessionId == sessionId && !p.IsMaster && p.CharacterId != null).Select(p => p.UserId).ToListAsync(ct);

    static List<string> ChosenPlayers(FogRevealInput x, List<string> players)
    {
        var ids = (x.UserIds ?? []).Distinct().ToList();
        if (ids.Count > 50 || ids.Any(id => !players.Contains(id))) throw new RuleException(400, "Escolha jogadores presentes na sessão.");
        return ids;
    }

    // ---------- Marcadores ----------
    public async Task TokenSettingsAsync(Guid sessionId, Guid tokenId, TokenSettingsInput x, string user, CancellationToken ct)
    {
        if (x.Light is < 0 or > TableFog.MaxRadius || x.Vision is < 0 or > TableFog.MaxRadius || x.DetectRange is < 0 or > TableFog.MaxRadius)
            throw new RuleException(400, $"Luz, visão e distância vão de 0 a {TableFog.MaxRadius} casas.");
        if (x.Perception is < -100 or > 1000 || x.Dc is < -100 or > 1000) throw new RuleException(400, "Percepção e dificuldade vão de -100 a 1.000.");
        var senses = string.IsNullOrWhiteSpace(x.Senses) ? null : x.Senses.Trim();
        if (senses?.Length > 400) throw new RuleException(400, "Os sentidos aceitam até 400 caracteres.");
        var sense = string.IsNullOrWhiteSpace(x.DetectSense) ? null : x.DetectSense.Trim();
        if (sense?.Length > TableFog.MaxSenseName) throw new RuleException(400, $"O sentido exigido aceita até {TableFog.MaxSenseName} caracteres.");
        var label = x.Label == null ? null : Trim(x.Label, 40, "Dê um nome de até 40 caracteres ao marcador.");
        if (x.Side != null && !Sides.Contains(x.Side)) throw new RuleException(400, "Lado do marcador inválido.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var scene = await RequireSceneAsync(a, ct);
        var token = scene.Raw.GetValueOrDefault(tokenId) ?? throw new RuleException(404, "Marcador não encontrado.");
        var creature = token.CharacterId == null;
        if (!creature && ((label != null && label != token.Label) || (x.Side != null && x.Side != token.Side) || x.TemplateId != null || x.UnlinkSheet))
            throw new RuleException(409, "Nome, lado e ficha de personagem de jogador vêm da ficha do jogador.");
        if (x.TemplateId != null && token.MasterCharacterId != null && !x.UnlinkSheet)
            throw new RuleException(409, "Este marcador já tem ficha. Marque “Trocar ou remover a ficha” para escolher outra.");
        var before = token.Label;
        // Trocar ou remover a ficha (ADR-100): o marcador deixa de apontar para ela; a ficha continua em Preparação › Personagens.
        var unlinked = creature && x.UnlinkSheet && token.MasterCharacterId != null;
        if (unlinked) token.MasterCharacterId = null;
        token.Light = x.Light; token.Vision = x.Vision; token.Perception = x.Perception; token.Senses = senses;
        if (creature)
        {
            if (token.Hidden && !x.Hidden) token.RevealedTo = [];
            token.Hidden = x.Hidden; token.Dc = x.Dc; token.DetectSense = sense; token.DetectRange = x.DetectRange;
            if (label != null) token.Label = label;
            if (x.Side != null) token.Side = x.Side;
            // Vincular ficha: a criatura nasce com o nome e o lado atuais do marcador.
            if (x.TemplateId != null) token.MasterCharacterId = await CreatureAsync(a, token.Label, token.Side, x.TemplateId, null, ct);
            // A ordem de turnos guarda uma cópia do nome: acompanha a troca.
            if (token.Label != before)
            {
                var order = TurnOrders.Parse(a.Session.TurnOrder);
                if (TurnOrders.Relabel(order, "t:" + token.Id, token.Label)) a.Session.TurnOrder = TurnOrders.Serialize(order);
            }
        }
        var text = token.Label != before ? $"Mestre renomeou {before} para {token.Label}"
            : x.TemplateId != null ? (unlinked ? $"Mestre trocou a ficha de {token.Label}" : $"Mestre vinculou uma ficha a {token.Label}")
            : unlinked ? $"Mestre desvinculou a ficha de {token.Label}" : $"Mestre ajustou {token.Label}";
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Token, text, x.TemplateId != null || unlinked ? new { tokenId, masterCharacterId = token.MasterCharacterId, unlinked } : null, masterOnly: true);
        await RefreshFogAsync(a, user, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task RevealTokenAsync(Guid sessionId, Guid tokenId, FogRevealInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var token = await db.SessionTokens.SingleOrDefaultAsync(t => t.Id == tokenId && t.SessionId == sessionId, ct) ?? throw new RuleException(404, "Marcador não encontrado.");
        if (token.CharacterId != null) throw new RuleException(409, "Personagens dos jogadores ficam sempre visíveis ao grupo.");
        var chosen = ChosenPlayers(x, await PlayersAsync(sessionId, ct));
        if (x.All) { token.Hidden = false; token.RevealedTo = []; }
        else { token.Hidden = true; token.RevealedTo = chosen; }
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Token, $"Mestre mudou quem vê {token.Label}", null, masterOnly: true);
        await RefreshFogAsync(a, user, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    // ---------- Configuração da mesa ----------
    public async Task<object> TableSettingsAsync(Guid sessionId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct); RequireMaster(a);
        var campaign = await Fog.CampaignSettingsAsync(a.Campaign, ct);
        var system = await Fog.SystemSettingsAsync(a.Campaign.RpgSystemId, ct);
        var effective = a.Session.TableSettings != null ? TableSettings.Parse(a.Session.TableSettings) : campaign;
        return new { settings = effective, scope = a.Session.TableSettings != null ? "session" : "campaign", campaign, campaignInherited = a.Campaign.TableSettings == null, system };
    }

    public async Task UpdateTableSettingsAsync(Guid sessionId, TableSettingsInput x, string user, CancellationToken ct)
    {
        if (x.Scope is not ("session" or "campaign")) throw new RuleException(400, "Escolha aplicar só nesta sessão ou na campanha toda.");
        var json = x.Settings?.Validate().Serialize();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        string text;
        // Mudança explícita do mestre na mesa: a forma de jogar desta sessão passa a ser a escolhida.
        var modeChanged = x.Settings != null && PlayModes.Effective(a.Session.PlayMode) != x.Settings.PlayMode;
        if (x.Settings != null) a.Session.PlayMode = x.Settings.PlayMode;
        if (x.Scope == "session") { a.Session.TableSettings = json; text = json == null ? "Mesa voltou à configuração da campanha" : "Mestre ajustou a configuração desta sessão"; }
        else
        {
            // Mesma ordem de bloqueio da preparação: sessão → campanha.
            var campaign = db.Database.IsNpgsql()
                ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {a.Campaign.Id} FOR UPDATE").SingleAsync(ct)
                : await db.Campaigns.SingleAsync(c => c.Id == a.Campaign.Id, ct);
            campaign.TableSettings = json; a.Campaign.TableSettings = json; a.Session.TableSettings = null;
            text = json == null ? "Campanha voltou ao padrão do sistema" : "Mestre ajustou a configuração da campanha";
        }
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, text, null, masterOnly: true);
        if (modeChanged) Event(a.Session, user, await NameAsync(user, ct), EventKinds.Turn, $"Forma de jogar: {PlayModes.Label(a.Session.PlayMode)}", new { playMode = a.Session.PlayMode });
        await RefreshFogAsync(a, user, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Aba de configuração da campanha (fora da mesa): ajustes valem para todas as sessões seguintes.</summary>
    public async Task<object> CampaignTableSettingsAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var (c, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre configura a mesa.");
        return new { settings = await Fog.CampaignSettingsAsync(c, ct), inherited = c.TableSettings == null, system = await Fog.SystemSettingsAsync(c.RpgSystemId, ct) };
    }

    public async Task<object> UpdateCampaignTableSettingsAsync(Guid campaignId, TableSettings? settings, string user, CancellationToken ct)
    {
        var json = settings?.Validate().Serialize();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Ordem comum: sessão ativa → campanha.
        var active = db.Database.IsNpgsql()
            ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {campaignId} AND \"EndedAt\" IS NULL FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Sessions.SingleOrDefaultAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct);
        var campaign = db.Database.IsNpgsql()
            ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Campaigns.SingleOrDefaultAsync(c => c.Id == campaignId, ct);
        if (campaign == null) throw NotFound();
        var (_, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre configura a mesa.");
        campaign.TableSettings = json;
        if (active != null)
        {
            Event(active, user, await NameAsync(user, ct), EventKinds.Map, json == null ? "Campanha voltou ao padrão do sistema" : "Mestre ajustou a configuração da campanha", null, masterOnly: true);
            await RefreshFogAsync(new Access(active, campaign, true), user, ct);
            await CommitAsync(tx, active, ct);
        }
        else { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        return new { settings = await Fog.CampaignSettingsAsync(campaign, ct), inherited = json == null };
    }

    // ---------- Projeção ----------
    static object MasterToken(SessionToken t, FogToken f, string? image = null) => new
    {
        t.Id, t.CharacterId, t.Label, t.Side, t.X, t.Y, t.Fx, t.Fy, t.LastMovedTurn, light = f.Light, vision = f.Vision, perception = f.Perception, image, masterCharacterId = t.MasterCharacterId,
        appearance = t.Appearance, size = t.Size, imageUrl = t.ImageUrl, width = t.Width, height = t.Height,
        overrides = new { light = t.Light, vision = t.Vision, perception = t.Perception, senses = t.Senses },
        hidden = t.CharacterId == null && t.Hidden, revealedTo = t.RevealedTo, dc = t.Dc, detectSense = t.DetectSense, detectRange = t.DetectRange,
    };

    // Imagem só para marcador visível de fato: percebido ("?") não revela nome nem imagem.
    static object PlayerToken(SessionToken t, FogToken f, bool perceived, string? image = null) => new
    {
        t.Id, t.CharacterId, label = perceived ? "?" : t.Label, t.Side, t.X, t.Y, t.Fx, t.Fy, t.LastMovedTurn, light = f.Light, perceived, image = perceived ? null : image,
        // Percebido não revela forma nem porte: marcador redondo padrão.
        appearance = perceived ? TokenLooks.Round : t.Appearance, size = perceived ? TokenLooks.DefaultSize : t.Size,
        width = perceived ? null : t.Width, height = perceived ? null : t.Height,
    };

    /// <summary>Mapa, marcadores e névoa que <paramref name="viewer"/> pode receber. O mestre recebe tudo; jogadores, só o que enxergam.</summary>
    (object Map, object Tokens, object Fog) Board(FogScene scene, string viewer, bool master, object map, IEnumerable<object> players, bool viewAs = false, IReadOnlyDictionary<Guid, string>? portraits = null)
    {
        var effective = scene.Tokens.ToDictionary(t => t.Id);
        string? Image(Guid id) => portraits != null && portraits.TryGetValue(id, out var url) ? url : null;
        if (master)
            return (map, scene.Raw.Values.Select(t => MasterToken(t, effective[t.Id], Image(t.Id))).ToList(), Fog.MasterFog(scene, players));
        if (!scene.Active)
            return (map, scene.Raw.Values.Select(t => PlayerToken(t, effective[t.Id], false, t.Hidden ? null : Image(t.Id))).ToList(), new { active = false });
        var view = scene.View(viewer);
        var known = scene.Settings.RememberExplored ? view.Explored : view.Visible;
        var width = scene.Map.Width;
        var node = JsonSerializer.SerializeToNode(map, Json)!.AsObject();
        node["rows"] = JsonSerializer.SerializeToNode(TableFogService.MaskRows(scene.Map.Rows, known, width));
        // Terreno sob os objetos (mapa de tiles com camadas): mesma máscara das casas desconhecidas; sem ele, nada de terreno.
        node.Remove("terrain");
        if (scene.Map.Terrain is { } terrain && terrain.Length == scene.Map.Rows.Length)
            node["terrain"] = JsonSerializer.SerializeToNode(TableFogService.MaskRows(terrain, known, width));
        var version = TableFogService.ImageVersion(known);
        if (scene.Map.Key.StartsWith("asset:") && node["imageUrl"]?.GetValue<string>() is { } url)
            node["imageUrl"] = url + (url.Contains('?') ? "&v=" : "?v=") + version + (viewAs ? "&as=" + Uri.EscapeDataString(viewer) : "");
        var tokens = scene.Raw.Values.Where(t => view.Tokens.Contains(t.Id)).Select(t => PlayerToken(t, effective[t.Id], view.PerceivedTokens.Contains(t.Id), Image(t.Id))).ToList();
        var fog = new
        {
            active = true, remember = scene.Settings.RememberExplored,
            cells = TableFogService.MaskRows(scene.State.Cells, known, width), visible = Bits.Encode(view.Visible), explored = Bits.Encode(known),
            lights = scene.State.Lights.Where(l => known[scene.Grid.Index(l.X, l.Y)]).Select(l => new { l.X, l.Y, l.Radius, l.Dim, l.Color, l.Intensity, l.Animation }),
            walls = TableFogService.PlayerWalls(scene.State.Walls, known, scene.Map.Width, scene.Map.Height),
            marks = scene.State.Marks.Where(m => view.Marks.Contains(m.Id)).Select(m => new { m.Id, m.X, m.Y, m.Kind, m.Label }),
            imageVersion = version,
        };
        return (node, tokens, fog);
    }

    /// <summary>"Ver como": o mestre recebe exatamente o mapa/marcadores/névoa de um jogador da sessão.</summary>
    public async Task<object> ViewAsAsync(Guid sessionId, string asUser, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct); RequireMaster(a);
        if (!await db.SessionParticipants.AnyAsync(p => p.SessionId == sessionId && p.UserId == asUser && !p.IsMaster && p.CharacterId != null, ct))
            throw new RuleException(404, "Jogador não encontrado nesta sessão.");
        var scene = await Fog.SceneAsync(a.Session, a.Campaign, false, ct) ?? throw new RuleException(409, "Névoa existe somente em mapas com grade.");
        var map = await LiveMapAsync(a.Session, ct);
        var (boardMap, tokens, fog) = Board(scene, asUser, false, map, [], viewAs: true, portraits: await PortraitsAsync(sessionId, asUser, false, ct));
        return new { a.Session.Revision, asUser, map = boardMap, tokens, fog };
    }
}

/// <summary>Edições puras da camada de névoa (validadas). Compartilhadas pela mesa e pela preparação.</summary>
public static class FogEdits
{
    static readonly string[] Tools = ["reveal", "conceal", "wall", "blockMove", "blockLight", "door", "erase"];
    public static void RequireTool(string? tool) { if (!Tools.Contains(tool)) throw new RuleException(400, "Ferramenta de pintura inválida."); }
    public static string Describe(string tool) => tool switch
    {
        "reveal" => "Mestre clareou casas", "conceal" => "Mestre escureceu casas", "door" => "Mestre posicionou portas",
        "erase" => "Mestre liberou casas", _ => "Mestre ajustou paredes e obstáculos",
    };
    public static List<FogCellInput> Cells(List<FogCellInput>? cells)
    {
        if (cells == null || cells.Count is 0 or > 4096) throw new RuleException(400, "Escolha de 1 a 4.096 casas.");
        return cells;
    }
    static void Inside(int width, int height, int x, int y) { if (x < 0 || y < 0 || x >= width || y >= height) throw new RuleException(400, "Casa fora do mapa."); }

    /// <summary>Máximo de caracteres das faixas guardadas para desfazer (o evento inteiro cabe em 4.000).</summary>
    public const int MaxUndoRanges = 3200;

    /// <summary>Índices ordenados em faixas "a-b,c,d-e" (pinceladas contínuas ficam curtas).</summary>
    public static string Ranges(IReadOnlyList<int> sorted)
    {
        var parts = new List<string>();
        for (var i = 0; i < sorted.Count;)
        {
            var j = i;
            while (j + 1 < sorted.Count && sorted[j + 1] == sorted[j] + 1) j++;
            parts.Add(i == j ? sorted[i].ToString(CultureInfo.InvariantCulture) : $"{sorted[i].ToString(CultureInfo.InvariantCulture)}-{sorted[j].ToString(CultureInfo.InvariantCulture)}");
            i = j + 1;
        }
        return string.Join(',', parts);
    }

    /// <summary>Lê as faixas de <see cref="Ranges"/>; índices fora de 0..size-1 ou texto inválido são recusados.</summary>
    public static List<int> ParseRanges(string? text, int size)
    {
        var result = new List<int>();
        foreach (var part in (text ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var bounds = part.Split('-');
            if (bounds.Length is < 1 or > 2 || !int.TryParse(bounds[0], NumberStyles.None, CultureInfo.InvariantCulture, out var from)) throw new RuleException(400, "Registro inválido.");
            var to = from;
            if (bounds.Length == 2 && !int.TryParse(bounds[1], NumberStyles.None, CultureInfo.InvariantCulture, out to)) throw new RuleException(400, "Registro inválido.");
            if (from > to || to >= size) throw new RuleException(409, "O mapa mudou de tamanho; desfazer não se aplica.");
            for (var i = from; i <= to; i++) result.Add(i);
        }
        return result;
    }

    public static void Paint(MapFogState state, int width, int height, string tool, IEnumerable<FogCellInput> cells)
    {
        var revealed = Bits.Decode(state.Revealed, width * height);
        var rows = state.Cells.Select(r => r.ToCharArray()).ToArray();
        foreach (var c in cells)
        {
            Inside(width, height, c.X, c.Y);
            switch (tool)
            {
                case "reveal": revealed[c.Y * width + c.X] = true; break;
                case "conceal": revealed[c.Y * width + c.X] = false; break;
                case "wall": rows[c.Y][c.X] = TableFog.Wall; break;
                case "blockMove": rows[c.Y][c.X] = TableFog.BlockMove; break;
                case "blockLight": rows[c.Y][c.X] = TableFog.BlockLight; break;
                case "door": rows[c.Y][c.X] = TableFog.DoorClosed; break;
                case "erase": rows[c.Y][c.X] = TableFog.Free; break;
            }
        }
        state.Revealed = Bits.Encode(revealed);
        state.Cells = rows.Select(r => new string(r)).ToArray();
    }

    public static void ToggleDoor(MapFogState state, int width, int height, int x, int y)
    {
        Inside(width, height, x, y);
        var row = state.Cells[y].ToCharArray();
        row[x] = row[x] switch
        {
            TableFog.DoorClosed => TableFog.DoorOpen,
            TableFog.DoorOpen => TableFog.DoorClosed,
            _ => throw new RuleException(409, "Não há porta nessa casa."),
        };
        state.Cells[y] = new string(row);
    }

    public static void ToggleWallDoor(MapFogState state, string id)
    {
        var door = state.Walls.FirstOrDefault(w => w.Id == id) ?? throw new RuleException(404, "Porta não encontrada.");
        if (door.Kind != FogWallKinds.Door) throw new RuleException(409, "Esse segmento não é uma porta.");
        door.Open = !door.Open;
    }

    public static void UpsertLight(MapFogState state, int width, int height, FogLightInput x)
    {
        Inside(width, height, x.X, x.Y);
        if (x.Radius is < 1 or > TableFog.MaxRadius) throw new RuleException(400, $"O raio vai de 1 a {TableFog.MaxRadius} casas.");
        if (x.Dim is { } dim && (dim < x.Radius || dim > TableFog.MaxRadius)) throw new RuleException(400, $"A penumbra vai do raio da luz até {TableFog.MaxRadius} casas.");
        if (x.Color != null && !System.Text.RegularExpressions.Regex.IsMatch(x.Color, "^#[0-9a-fA-F]{6}$")) throw new RuleException(400, "Cor da luz inválida. Use #rrggbb.");
        if (x.Intensity is < 10 or > 100) throw new RuleException(400, "A intensidade vai de 10 a 100.");
        if (!FogLightAnimations.IsValid(x.Animation)) throw new RuleException(400, "Animação de luz inválida.");
        var light = x.Id == null ? null : state.Lights.FirstOrDefault(l => l.Id == x.Id);
        if (x.Id != null && light == null) throw new RuleException(404, "Foco de luz não encontrado.");
        if (light == null)
        {
            if (state.Lights.Count >= TableFog.MaxLights) throw new RuleException(409, $"Limite de {TableFog.MaxLights} focos de luz por mapa.");
            state.Lights.Add(light = new FogLight());
        }
        light.X = x.X; light.Y = x.Y; light.Radius = x.Radius; light.Dim = x.Dim == x.Radius ? null : x.Dim;
        light.Color = x.Color?.ToLowerInvariant(); light.Intensity = x.Intensity == 100 ? null : x.Intensity; light.Animation = x.Animation;
    }

    public static void RemoveLight(MapFogState state, string id)
    {
        if (state.Lights.RemoveAll(l => l.Id == id) == 0) throw new RuleException(404, "Foco de luz não encontrado.");
    }

    public static FogMark ValidMark(int width, int height, FogMarkInput x)
    {
        Inside(width, height, x.X, x.Y);
        if (!FogMarkKinds.All.Contains(x.Kind)) throw new RuleException(400, "Tipo de marca inválido.");
        var label = LibraryService.Clean(x.Label ?? "", false).Trim();
        if (label.Length is 0 or > TableFog.MaxLabel) throw new RuleException(400, $"Dê um nome de até {TableFog.MaxLabel} caracteres à marca.");
        if (x.Dc is < -100 or > 1000) throw new RuleException(400, "A dificuldade vai de -100 a 1.000.");
        if (x.MaxDistance is < 0 or > TableFog.MaxRadius) throw new RuleException(400, $"A distância máxima vai de 0 a {TableFog.MaxRadius} casas.");
        var sense = string.IsNullOrWhiteSpace(x.Sense) ? null : x.Sense.Trim();
        if (sense?.Length > TableFog.MaxSenseName) throw new RuleException(400, $"O sentido exigido aceita até {TableFog.MaxSenseName} caracteres.");
        return new FogMark { X = x.X, Y = x.Y, Kind = x.Kind, Label = label, Dc = x.Dc, Sense = sense, MaxDistance = x.MaxDistance };
    }

    public static void UpsertMark(MapFogState state, int width, int height, FogMarkInput x)
    {
        var valid = ValidMark(width, height, x);
        var mark = x.Id == null ? null : state.Marks.FirstOrDefault(m => m.Id == x.Id);
        if (x.Id != null && mark == null) throw new RuleException(404, "Marca não encontrada.");
        if (mark == null)
        {
            if (state.Marks.Count >= TableFog.MaxMarks) throw new RuleException(409, $"Limite de {TableFog.MaxMarks} marcas ocultas por mapa.");
            state.Marks.Add(mark = valid);
            return;
        }
        mark.X = valid.X; mark.Y = valid.Y; mark.Kind = valid.Kind; mark.Label = valid.Label; mark.Dc = valid.Dc; mark.Sense = valid.Sense; mark.MaxDistance = valid.MaxDistance;
    }

    public static void RemoveMark(MapFogState state, string id)
    {
        if (state.Marks.RemoveAll(m => m.Id == id) == 0) throw new RuleException(404, "Marca não encontrada.");
    }

    public static void ResetExploration(MapFogState state)
    {
        state.Revealed = ""; state.Explored = [];
        foreach (var m in state.Marks) { m.RevealedAll = false; m.RevealedTo = []; }
    }
}
