using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Controle temporário de um marcador por um convidado participante; <c>SeatId</c> nulo devolve o marcador ao mestre.</summary>
public record GuestControlInput(Guid TokenId, Guid? SeatId);
public record GuestRollInput(string? Formula, string? Label);

/// <summary>
/// Estado de espectador (ADR-114/115): exibição externa do mestre e convidados sem conta. É montado como um visitante
/// que não é membro da mesa: sem objetivo, notas privadas, eventos restritos, fichas privadas, marcadores ocultos nem e-mails.
/// O mapa e a névoa saem da mesma projeção de jogador (<see cref="Board"/>), nunca da do mestre.
/// Escritas de convidados seguem o fluxo comum da mesa: bloqueio da sessão → conferência no banco → evento → revisão → sinal.
/// </summary>
public partial class SessionService
{
    /// <summary>Chave de visão da exibição externa: não é usuário e não tem marcadores próprios.</summary>
    public const string DisplayViewer = "display";
    public static string GuestViewer(Guid seatId) => "guest:" + seatId.ToString("N");
    static RuleException GuestEnded() => new(401, "Acesso de convidado encerrado.");
    static RuleException ImageMissing() => new(404, "Imagem não encontrada.");

    // ---------- Espera comum ----------
    /// <summary>Espera somente leitura até a revisão superar <paramref name="after"/> ou até o prazo (25 s).</summary>
    async Task WaitRevisionAsync(Guid sessionId, int after, CancellationToken ct)
    {
        var deadline = Now + TimeSpan.FromSeconds(25); var waited = false;
        while (after > 0)
        {
            var revision = await db.Sessions.Where(s => s.Id == sessionId).Select(s => (int?)s.Revision).SingleOrDefaultAsync(ct) ?? throw NotFound();
            var remaining = deadline - Now;
            if (revision > after || remaining <= TimeSpan.Zero) break;
            // Reconfere o banco a cada 5 s para mudanças publicadas por outro processo.
            await signals.WaitAsync(sessionId, remaining < TimeSpan.FromSeconds(5) ? remaining : TimeSpan.FromSeconds(5), ct);
            ct.ThrowIfCancellationRequested(); waited = true;
        }
        // Agrupa escritas em rajada (ação + movimento, por exemplo) em uma única resposta.
        if (waited) await Task.Delay(120, ct);
    }

    // ---------- Exibição externa (mestre) ----------
    async Task<Access> DisplayAccessAsync(Guid sessionId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct);
        if (!a.IsMaster) throw new RuleException(403, "Somente o mestre abre a exibição externa.");
        // A tela projetada nunca recebe a visão do mestre.
        return a with { IsMaster = false };
    }

    public async Task<object> DisplayStateAsync(Guid sessionId, string user, CancellationToken ct) =>
        await SpectatorStateAsync(await DisplayAccessAsync(sessionId, user, ct), DisplayViewer, null, $"/api/sessions/{sessionId}/display", ct);

    public async Task<object> DisplayLiveAsync(Guid sessionId, int after, string user, CancellationToken ct)
    {
        await DisplayAccessAsync(sessionId, user, ct);
        await WaitRevisionAsync(sessionId, after, ct);
        return await DisplayStateAsync(sessionId, user, ct);
    }

    public async Task<(byte[] Bytes, string Type)> DisplayMapImageAsync(Guid sessionId, string user, CancellationToken ct) =>
        await SpectatorMapImageAsync(await DisplayAccessAsync(sessionId, user, ct), DisplayViewer, null, ct);

    public async Task<(byte[] Bytes, string Type)> DisplayPortraitAsync(Guid sessionId, Guid tokenId, string user, CancellationToken ct) =>
        await SpectatorPortraitAsync(await DisplayAccessAsync(sessionId, user, ct), DisplayViewer, null, tokenId, ct);

    // ---------- Convidados: acesso ----------
    /// <summary>
    /// Confere o lugar do convidado no banco: lugar e convite ativos, convite no prazo, campanha com convidados habilitados,
    /// não arquivada nem expirada e a sessão do lugar ainda aberta. Com <paramref name="write"/>, bloqueia a sessão antes
    /// de reler o lugar (mesma ordem das revogações: sessão → lugares).
    /// </summary>
    async Task<(Access Access, GuestSeat Seat)> GuestAccessAsync(Guid seatId, bool write, CancellationToken ct)
    {
        var sessionId = await db.GuestSeats.Where(g => g.Id == seatId).Select(g => (Guid?)g.SessionId).SingleOrDefaultAsync(ct) ?? throw GuestEnded();
        var s = !write ? await db.Sessions.AsNoTracking().SingleOrDefaultAsync(x => x.Id == sessionId, ct)
            : db.Database.IsNpgsql() ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"Id\" = {sessionId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Sessions.SingleOrDefaultAsync(x => x.Id == sessionId, ct);
        if (s == null || s.EndedAt != null) throw GuestEnded();
        var seat = await (write ? db.GuestSeats : db.GuestSeats.AsNoTracking()).SingleOrDefaultAsync(g => g.Id == seatId, ct);
        if (seat == null || seat.RevokedAt != null || seat.SessionId != s.Id || seat.CampaignId != s.CampaignId) throw GuestEnded();
        var now = Now;
        if (!await db.GuestInvites.AnyAsync(i => i.Id == seat.InviteId && i.CampaignId == s.CampaignId && i.RevokedAt == null && i.ExpiresAt > now, ct)) throw GuestEnded();
        var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == s.CampaignId, ct);
        if (c == null || !c.GuestsEnabled || c.ArchivedAt != null || OneShotLifecycleService.Expired(c, now)) throw GuestEnded();
        return (new Access(s, c, false), seat);
    }

    static void RequireParticipant(GuestSeat seat)
    {
        if (seat.Mode != GuestModes.Participant) throw new RuleException(403, "Convidados observadores apenas assistem à mesa.");
    }

    static string GuestAuthor(GuestSeat seat) => $"{seat.Name} (convidado)";

    async Task<Guid?> ControlledTokenAsync(Guid sessionId, Guid seatId, CancellationToken ct) =>
        await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == sessionId && t.GuestSeatId == seatId).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);

    public async Task<object> GuestLiveAsync(Guid seatId, int after, CancellationToken ct)
    {
        var (first, _) = await GuestAccessAsync(seatId, false, ct);
        await WaitRevisionAsync(first.Session.Id, after, ct);
        // Reconfere depois da espera: revogação ou encerramento durante a espera devolvem 401.
        var (a, seat) = await GuestAccessAsync(seatId, false, ct);
        return await SpectatorStateAsync(a, GuestViewer(seat.Id), seat, "/api/guest", ct);
    }

    public async Task<(byte[] Bytes, string Type)> GuestMapImageAsync(Guid seatId, CancellationToken ct)
    {
        var (a, seat) = await GuestAccessAsync(seatId, false, ct);
        return await SpectatorMapImageAsync(a, GuestViewer(seat.Id), seat, ct);
    }

    public async Task<(byte[] Bytes, string Type)> GuestPortraitAsync(Guid seatId, Guid tokenId, CancellationToken ct)
    {
        var (a, seat) = await GuestAccessAsync(seatId, false, ct);
        return await SpectatorPortraitAsync(a, GuestViewer(seat.Id), seat, tokenId, ct);
    }

    // ---------- Projeção de espectador ----------
    /// <summary>
    /// Cena vista por um espectador. O marcador controlado por um convidado passa a ser "dele" (dono = chave do convidado),
    /// para ele enxergar pela luz/visão desse marcador. Ninguém mais muda: a luz compartilhada não depende do dono.
    /// </summary>
    async Task<FogScene?> SpectatorSceneAsync(Access a, string viewer, Guid? controlled, CancellationToken ct, bool track = false)
    {
        var scene = await Fog.SceneAsync(a.Session, a.Campaign, track, ct);
        if (scene != null && controlled is { } id) OwnToken(scene, id, viewer);
        return scene;
    }

    static void OwnToken(FogScene scene, Guid tokenId, string viewer)
    {
        var swapped = scene.Tokens.Select(t => t.Id == tokenId ? t with { OwnerUserId = viewer } : t).ToList();
        scene.Tokens.Clear(); scene.Tokens.AddRange(swapped);
    }

    /// <summary>Endereços de imagem do espectador: rotas próprias (exibição ou convidado), nunca as rotas de membro.</summary>
    static Dictionary<Guid, string> SpectatorPortraits(Dictionary<Guid, string> source, string routes) =>
        source.ToDictionary(p => p.Key, p => p.Value.StartsWith("/api/", StringComparison.Ordinal) ? $"{routes}/tokens/{p.Key}/portrait?v={ImageVersion(p.Value)}" : p.Value);

    /// <summary>Imagem do mapa do acervo passa pela rota do espectador, que aplica a mesma máscara de névoa desta projeção.</summary>
    static JsonObject SpectatorMap(object map, string routes)
    {
        var node = map as JsonObject ?? JsonSerializer.SerializeToNode(map, Json)!.AsObject();
        if (node["key"] is JsonValue key && key.TryGetValue<string>(out var k) && k.StartsWith("asset:", StringComparison.Ordinal)
            && node["imageUrl"] is JsonValue image && image.TryGetValue<string>(out var url))
            node["imageUrl"] = $"{routes}/map-image?v={ImageVersion(url)}";
        return node;
    }

    /// <summary>
    /// Estado ao vivo de quem não é membro (mesma forma do estado de membro). <paramref name="viewer"/> é a chave da visão
    /// ("display" ou "guest:{id}"); <paramref name="routes"/> é o prefixo das rotas de imagem desse espectador.
    /// </summary>
    async Task<object> SpectatorStateAsync(Access a, string viewer, GuestSeat? seat, string routes, CancellationToken ct)
    {
        var s = a.Session; var now = Now;
        var people = await db.SessionParticipants.AsNoTracking().Where(p => p.SessionId == s.Id)
            .Join(db.Users, p => p.UserId, u => u.Id, (p, u) => new { p, u.DisplayName, u.AvatarUrl })
            .GroupJoin(db.Characters, x => x.p.CharacterId, c => c.Id, (x, cs) => new { x, cs })
            .SelectMany(g => g.cs.DefaultIfEmpty(), (g, c) => new
            {
                g.x.p.UserId, g.x.p.IsMaster, g.x.p.CharacterId, g.x.p.JoinedAt, g.x.p.LastSeenAt, g.x.DisplayName, g.x.AvatarUrl,
                characterName = c == null ? null : c.Name,
                // Espectador não é dono nem mestre: fichas privadas mostram só o nome do personagem.
                archetype = c == null || c.Private ? null : c.Archetype,
                level = c == null || c.Private ? (int?)null : c.Level,
                hp = c == null || c.Private ? (int?)null : c.Hp,
                maxHp = c == null || c.Private ? (int?)null : c.MaxHp,
                canView = c != null && !c.Private,
            }).OrderBy(x => x.JoinedAt).ToListAsync(ct);
        var summaries = await PartySummariesAsync(people.Where(p => p.canView && p.CharacterId != null).Select(p => p.CharacterId!.Value).ToList(), ct);
        var participants = people.Select(p => new
        {
            // Espectador não recebe identificador de conta nem avatar dos participantes (ADR-114): só nome e personagem.
            userId = (string?)null, name = p.DisplayName, avatarUrl = (string?)null, isMaster = p.IsMaster, characterId = p.CharacterId,
            p.characterName, p.archetype, p.level, p.hp, p.maxHp, p.canView, online = TableRules.IsOnline(p.LastSeenAt, now), isMe = false,
            summary = p.CharacterId is { } pc && summaries.TryGetValue(pc, out var sum) ? sum : null,
        }).ToList();
        // Só eventos públicos: nada do mestre, de fichas, endereçado a alguém ou cópia de destinatário.
        var events = await db.Events.AsNoTracking()
            .Where(e => e.SessionId == s.Id && !e.MasterOnly && e.Kind != EventKinds.Sheet && e.VisibleToUserId == null && !e.IsRecipientCopy)
            .OrderByDescending(e => e.Id).Take(LiveEvents)
            .Select(e => new { e.Id, e.Kind, e.Author, e.Content, e.Data, e.CreatedAt, e.MasterOnly, mine = false }).ToListAsync(ct);
        events.Reverse();
        var controlled = seat == null ? null : await ControlledTokenAsync(s.Id, seat.Id, ct);
        object map = await LiveMapAsync(s, ct);
        object tokens = Array.Empty<object>(); object? fog = null;
        if (s.MapKind == MapKinds.Tileset)
        {
            var portraits = SpectatorPortraits(await PortraitsAsync(s.Id, viewer, false, ct), routes);
            var scene = await SpectatorSceneAsync(a, viewer, controlled, ct);
            if (scene == null)
                tokens = await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == s.Id && (t.CharacterId != null || !t.Hidden)).OrderBy(t => t.Label)
                    .Select(t => new { t.Id, t.CharacterId, t.Label, t.Side, t.X, t.Y, t.Fx, t.Fy, t.LastMovedTurn, appearance = t.Appearance, size = t.Size, width = t.Width, height = t.Height }).ToListAsync(ct);
            else if (!scene.Active)
            {
                // Sem névoa, criaturas ocultas continuam fora: o espectador nunca as recebe.
                var effective = scene.Tokens.ToDictionary(t => t.Id);
                tokens = scene.Raw.Values.Where(t => t.CharacterId != null || !t.Hidden)
                    .Select(t => PlayerToken(t, effective[t.Id], false, portraits.GetValueOrDefault(t.Id))).ToList();
                fog = new { active = false };
            }
            else (map, tokens, fog) = Board(scene, viewer, false, map, [], portraits: portraits);
        }
        var activeEntry = ActiveEntry(s);
        var hiddenActive = TurnOrders.TokenOf(activeEntry?.Key) is { } activeToken && await db.SessionTokens.AnyAsync(t => t.Id == activeToken && t.Hidden, ct);
        var active = participants.FirstOrDefault(p => p.characterId != null && p.characterId == s.ActiveCharacterId);
        var play = await PlayStateAsync(a with { IsMaster = false }, viewer, null, ct);
        var masterName = participants.FirstOrDefault(p => p.isMaster)?.name ?? await NameAsync(a.Campaign.OwnerId, ct);
        var music = await MusicStateAsync(s, ct);
        object me = seat == null
            ? new { userId = (string?)null, isMaster = false, display = true, guest = false, joined = false, characterId = (Guid?)null, character = (object?)null }
            : new { userId = (string?)null, isMaster = false, display = false, guest = true, joined = true, characterId = (Guid?)null, character = (object?)null, mode = seat.Mode, name = seat.Name, seatId = seat.Id, tokenId = controlled };
        return new
        {
            s.Revision,
            serverTime = Now,
            session = new
            {
                s.Id, s.Number, s.Title, objective = (string?)null, s.StartedAt, s.EndedAt, s.TurnNumber, s.TemporaryImageId, s.TemporaryImageTitle,
                activeCharacterId = s.ActiveCharacterId, activeName = active?.characterName ?? (hiddenActive ? "Mestre" : activeEntry?.Label),
            },
            play,
            campaign = new { a.Campaign.Id, a.Campaign.Name, a.Campaign.IsOneShot, a.Campaign.ExpiresAt, master = masterName },
            me, participants, map = SpectatorMap(map, routes), tokens, fog, events, music, camera = CameraOf(s), guests = (object?)null,
        };
    }

    /// <summary>
    /// Imagem do mapa do acervo para o espectador: camada da cena aplicada e, com névoa ativa, só as casas que esta visão
    /// conhece (sem memória própria de exploração: luz compartilhada e casas reveladas). Mesma regra de <see cref="CampaignAssetsService.ImageAsync"/>.
    /// </summary>
    async Task<(byte[] Bytes, string Type)> SpectatorMapImageAsync(Access a, string viewer, GuestSeat? seat, CancellationToken ct)
    {
        var s = a.Session;
        if (!s.MapKey.StartsWith("asset:", StringComparison.Ordinal) || !Guid.TryParse(s.MapKey[6..], out var id)) throw ImageMissing();
        var map = await db.Set<CampaignMap>().AsNoTracking().Where(m => m.CampaignId == s.CampaignId && m.Id == id && m.TileData == null)
            .Select(m => new { m.Content, m.GridPixels, m.Revision, m.HasGrid, m.GridOffsetX, m.GridOffsetY, m.Width, m.Height, m.Purpose }).SingleOrDefaultAsync(ct) ?? throw ImageMissing();
        var content = map.Content;
        string? variant = null;
        if (s.OverlayId is { } layerId && map.Purpose == CampaignAssetPurposes.Map)
        {
            var layer = await db.Set<CampaignMap>().AsNoTracking().Where(m => m.CampaignId == s.CampaignId && m.Id == layerId && m.Purpose == CampaignAssetPurposes.Layer && m.OwnerSceneId != null)
                .Select(m => new { m.Content, m.Width, m.Height }).SingleOrDefaultAsync(ct);
            if (layer != null && layer.Width == map.Width && layer.Height == map.Height)
            {
                content = await TableFogService.CompositeAsync(id, map.Revision, layerId, map.Content, layer.Content, ct);
                variant = layerId.ToString("N");
            }
        }
        if (!map.HasGrid) return (content, CampaignAssetsService.ImageType(content));
        var controlled = seat == null ? null : await ControlledTokenAsync(s.Id, seat.Id, ct);
        var scene = await SpectatorSceneAsync(a, viewer, controlled, ct);
        if (scene == null || !scene.Active) return (content, CampaignAssetsService.ImageType(content));
        var view = scene.View(viewer);
        var known = scene.Settings.RememberExplored ? view.Explored : view.Visible;
        var masked = await TableFogService.MaskAsync(id, map.Revision, content, map.GridPixels, scene.Map.Width, scene.Map.Height, known, ct, map.GridOffsetX, map.GridOffsetY, variant);
        return (masked, CampaignAssetsService.ImageType(masked));
    }

    /// <summary>Imagem de um marcador para o espectador: só se ele o vê de fato (não apenas percebido) e, para fichas de jogador, só fichas compartilhadas.</summary>
    async Task<(byte[] Bytes, string Type)> SpectatorPortraitAsync(Access a, string viewer, GuestSeat? seat, Guid tokenId, CancellationToken ct)
    {
        var s = a.Session;
        var token = await db.SessionTokens.AsNoTracking().SingleOrDefaultAsync(t => t.Id == tokenId && t.SessionId == s.Id, ct) ?? throw ImageMissing();
        if (token.CharacterId == null && token.Hidden) throw ImageMissing();
        var controlled = seat == null ? null : await ControlledTokenAsync(s.Id, seat.Id, ct);
        if (await SpectatorSceneAsync(a, viewer, controlled, ct) is { Active: true } scene)
        {
            var view = scene.View(viewer);
            if (!view.Tokens.Contains(tokenId) || view.PerceivedTokens.Contains(tokenId)) throw ImageMissing();
        }
        var image = token.ImageUrl ?? (token.MasterCharacterId == null ? null
            : await db.MasterCharacters.AsNoTracking().Where(m => m.Id == token.MasterCharacterId && m.CampaignId == a.Campaign.Id).Select(m => m.ImageUrl).SingleOrDefaultAsync(ct));
        NpcImages.Normalize(image, out var asset);
        if (asset is { } assetId)
        {
            var bytes = await db.Set<CampaignMap>().AsNoTracking().Where(m => m.Id == assetId && m.CampaignId == a.Campaign.Id && m.Purpose != CampaignAssetPurposes.Layer)
                .Select(m => m.Content).SingleOrDefaultAsync(ct) ?? throw ImageMissing();
            return (bytes, CampaignAssetsService.ImageType(bytes));
        }
        if (image == null && token.CharacterId is { } characterId)
        {
            var portrait = await db.Characters.AsNoTracking().Where(c => c.Id == characterId && !c.Private && c.PortraitVersion > 0)
                .Join(db.Set<CharacterPortrait>().AsNoTracking(), c => c.Id, p => p.CharacterId, (c, p) => new { p.Content, p.ContentType }).SingleOrDefaultAsync(ct);
            if (portrait != null) return (portrait.Content, portrait.ContentType);
        }
        throw ImageMissing();
    }

    /// <summary>Convidados ativos da sessão para o mestre (sem segredos): nome, modo, presença e marcador controlado.</summary>
    async Task<object> GuestsViewAsync(Guid sessionId, DateTime now, CancellationToken ct)
    {
        var rows = await db.GuestSeats.AsNoTracking()
            .Where(g => g.SessionId == sessionId && g.RevokedAt == null && db.GuestInvites.Any(i => i.Id == g.InviteId && i.RevokedAt == null && i.ExpiresAt > now))
            .OrderBy(g => g.CreatedAt).Take(50)
            .Select(g => new { g.Id, g.Name, g.Mode, g.LastSeenAt, tokenId = db.SessionTokens.Where(t => t.SessionId == sessionId && t.GuestSeatId == g.Id).Select(t => (Guid?)t.Id).FirstOrDefault() })
            .ToListAsync(ct);
        return rows.Select(g => new { seatId = g.Id, name = g.Name, mode = g.Mode, online = TableRules.IsOnline(g.LastSeenAt, now), g.tokenId }).ToList();
    }

    // ---------- Mestre: controle temporário ----------
    public async Task SetGuestControlAsync(Guid sessionId, GuestControlInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var token = await db.SessionTokens.SingleOrDefaultAsync(t => t.Id == x.TokenId && t.SessionId == sessionId, ct) ?? throw new RuleException(404, "Marcador não encontrado.");
        var author = await NameAsync(user, ct);
        if (x.SeatId is not { } seatId)
        {
            if (token.GuestSeatId == null) { await tx.RollbackAsync(ct); return; }
            token.GuestSeatId = null;
            Event(a.Session, user, author, EventKinds.Token, $"Mestre retomou {token.Label}", new { tokenId = token.Id }, masterOnly: true);
            await CommitAsync(tx, a.Session, ct);
            return;
        }
        var now = Now;
        var seat = await db.GuestSeats.SingleOrDefaultAsync(g => g.Id == seatId && g.CampaignId == a.Campaign.Id, ct) ?? throw new RuleException(404, "Convidado não encontrado.");
        if (seat.RevokedAt != null || seat.SessionId != sessionId || !a.Campaign.GuestsEnabled
            || !await db.GuestInvites.AnyAsync(i => i.Id == seat.InviteId && i.RevokedAt == null && i.ExpiresAt > now, ct))
            throw new RuleException(409, "Este convidado não está mais nesta sessão.");
        if (seat.Mode != GuestModes.Participant) throw new RuleException(409, "Convidados observadores não controlam marcadores.");
        // Convidado nunca controla personagem de jogador (ficha real) nem criatura oculta.
        if (token.CharacterId != null) throw new RuleException(409, "Convidados controlam só marcadores do mestre, não personagens de jogadores.");
        if (token.Hidden) throw new RuleException(409, "Revele o marcador antes de entregá-lo a um convidado.");
        if (token.GuestSeatId == seat.Id) { await tx.RollbackAsync(ct); return; }
        // Um lugar controla no máximo um marcador: o anterior volta ao mestre.
        foreach (var previous in await db.SessionTokens.Where(t => t.SessionId == sessionId && t.GuestSeatId == seat.Id && t.Id != token.Id).ToListAsync(ct)) previous.GuestSeatId = null;
        token.GuestSeatId = seat.Id;
        Event(a.Session, user, author, EventKinds.Token, $"Mestre entregou {token.Label} a {GuestAuthor(seat)}", new { tokenId = token.Id, seatId = seat.Id }, masterOnly: true);
        await CommitAsync(tx, a.Session, ct);
    }

    // ---------- Convidados: escritas ----------
    /// <summary>
    /// Move o marcador entregue ao convidado. Mesmas regras de casa conhecida, bloqueio, ocupação, área e caminho do jogador;
    /// com ordem de turnos, só na vez do marcador. Eventos usam a conta do mestre como autor técnico e o nome do convidado.
    /// </summary>
    public async Task GuestMoveAsync(Guid seatId, MoveInput x, CancellationToken ct)
    {
        const string Unavailable = "Esse ponto não está disponível.";
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (a, seat) = await GuestAccessAsync(seatId, true, ct);
        RequireParticipant(seat); RequireNotPaused(a);
        var scene = await RequireSceneAsync(a, ct);
        var token = scene.Raw.Values.FirstOrDefault(t => t.GuestSeatId == seat.Id) ?? throw new RuleException(409, "O mestre ainda não entregou um marcador a você.");
        if (token.CharacterId != null || token.Hidden) throw new RuleException(409, "Este marcador não está disponível para convidados.");
        var viewer = GuestViewer(seat.Id);
        OwnToken(scene, token.Id, viewer);
        var grid = scene.Grid;
        var free = scene.Map.Free;
        var (fx, fy) = FinePositions.Clean(free, x.Fx, x.Fy);
        var span = free ? TokenSpan.One : token.SpanOf();
        var cells = span.Cells(x.X, x.Y).ToList();
        var occupant = free ? null : scene.Raw.Values.FirstOrDefault(t => t.Id != token.Id && t.SpanOf().Cells(t.X, t.Y).Any(cells.Contains));
        bool Blocked() => cells.Any(c => !grid.Inside(c.X, c.Y) || grid.BlocksMove(c.X, c.Y));
        var key = "t:" + token.Id;
        var tactical = PlayModes.LimitsMovement(a.Session.PlayMode);
        // Marcador na ordem de turnos (fora da forma livre): só se move na própria vez, com a liberação do mestre quando exigida.
        var inOrder = PlayModes.RequiresTurn(a.Session.PlayMode) && TurnOrders.Parse(a.Session.TurnOrder).Any(e => e.Key == key);
        if (inOrder)
        {
            if (a.Session.ActiveTurnKey != key) throw new RuleException(409, "Aguarde a vez deste marcador.");
            if (scene.Settings.MoveNeedsGrant && a.Session.MoveGrantTurn != a.Session.TurnNumber) throw new RuleException(409, "Aguarde o mestre liberar o seu movimento.");
            if (tactical && token.LastMovedTurn == a.Session.TurnNumber) throw new RuleException(409, "Você já se moveu neste turno.");
        }
        if (scene.Active)
        {
            // Com névoa: só casas conhecidas pelo convidado, por caminho livre; recusas não revelam terreno nem ocupante invisível.
            var view = scene.View(viewer);
            bool Known(int cx, int cy) => grid.Inside(cx, cy) && view.Explored[grid.Index(cx, cy)];
            if (!cells.All(c => Known(c.X, c.Y))) throw new RuleException(400, Unavailable);
            if (Blocked()) throw new RuleException(400, "Esse ponto do mapa está bloqueado.");
            if (occupant != null) throw view.Tokens.Contains(occupant.Id) ? new RuleException(409, "Já existe alguém nesse ponto.") : new RuleException(400, Unavailable);
            if (tactical && scene.Settings.PathMovement)
            {
                var occupied = free ? new HashSet<(int, int)>() : TokenSpans.Taken(scene.Raw.Values, token.Id);
                bool Passable(int cx, int cy) => span.Cells(cx, cy).All(c => Known(c.X, c.Y) && !grid.BlocksMove(c.X, c.Y) && !occupied.Contains(c));
                if (FogRules.PathLength(grid, token.X, token.Y, x.X, x.Y, grid.Width * grid.Height + 1, Passable) == null) throw new RuleException(400, Unavailable);
            }
        }
        else
        {
            if (Blocked()) throw new RuleException(400, "Esse ponto do mapa está bloqueado.");
            if (occupant != null) throw new RuleException(409, "Já existe alguém nesse ponto.");
        }
        if (inOrder && tactical) token.LastMovedTurn = a.Session.TurnNumber;
        var from = new { x = token.X, y = token.Y, fx = free ? token.Fx : null, fy = free ? token.Fy : null };
        token.X = x.X; token.Y = x.Y; token.Fx = fx; token.Fy = fy;
        var author = GuestAuthor(seat);
        Event(a.Session, a.Campaign.OwnerId, author, EventKinds.Move, $"{author} moveu {token.Label}",
            new { tokenId = token.Id, from, to = new { x = x.X, y = x.Y, fx, fy }, guest = true, seatId = seat.Id }, masterOnly: Secret(scene, token));
        await RefreshFogAsync(a, a.Campaign.OwnerId, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Rolagem pública do convidado participante (fórmula validada pelo mesmo rolador da mesa; sem ficha).</summary>
    public async Task<object> GuestRollAsync(Guid seatId, GuestRollInput x, CancellationToken ct)
    {
        var label = Trim(x.Label, 60, "A descrição da rolagem aceita até 60 caracteres.", false);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (a, seat) = await GuestAccessAsync(seatId, true, ct);
        RequireParticipant(seat); RequireNotPaused(a);
        var (roll, notation, total) = await RollAnyAsync(null, null, x.Formula, ct);
        var author = GuestAuthor(seat);
        RecordRoll(a.Session, a.Campaign.OwnerId, author, author, label, roll, notation, total, RollVisibility.Table, false, null);
        await CommitAsync(tx, a.Session, ct);
        return new { hidden = false, visibility = RollVisibility.Table, roll, total };
    }

    public async Task GuestMessageAsync(Guid seatId, SessionTextInput x, CancellationToken ct)
    {
        var content = Trim(x.Content, 2000, "Escreva de 1 a 2000 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (a, seat) = await GuestAccessAsync(seatId, true, ct);
        RequireParticipant(seat);
        Event(a.Session, a.Campaign.OwnerId, GuestAuthor(seat), EventKinds.Message, content, new { master = false, guest = true, seatId = seat.Id });
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Presença do convidado. Só muda a revisão quando ele volta a ficar online (a lista do mestre muda).</summary>
    public async Task GuestHeartbeatAsync(Guid seatId, CancellationToken ct)
    {
        var (_, seat) = await GuestAccessAsync(seatId, false, ct);
        var now = Now;
        if (TableRules.IsOnline(seat.LastSeenAt, now))
        {
            await db.GuestSeats.Where(g => g.Id == seatId).ExecuteUpdateAsync(g => g.SetProperty(v => v.LastSeenAt, (DateTime?)now), ct);
            return;
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (a, tracked) = await GuestAccessAsync(seatId, true, ct);
        tracked.LastSeenAt = now;
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>O convidado sai: o lugar é revogado e o marcador controlado volta ao mestre.</summary>
    public async Task GuestLeaveAsync(Guid seatId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (a, seat) = await GuestAccessAsync(seatId, true, ct);
        seat.RevokedAt = Now;
        foreach (var t in await db.SessionTokens.Where(t => t.SessionId == a.Session.Id && t.GuestSeatId == seat.Id).ToListAsync(ct)) t.GuestSeatId = null;
        Event(a.Session, a.Campaign.OwnerId, GuestAuthor(seat), EventKinds.Leave, $"{GuestAuthor(seat)} saiu da mesa", new { guest = true, seatId = seat.Id });
        await CommitAsync(tx, a.Session, ct);
    }
}
