using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StartSessionInput(string Title, string Objective, string MapKind, string MapKey);
public record JoinSessionInput(Guid? CharacterId);
public record SessionTextInput(string Content);
public record SessionNoteInput(string Content, bool Shared);
public record SessionRollInput(string Formula, string? Label);
public record TurnInput(Guid? CharacterId);
public record ActionInput(string Kind, string? ActionId, string? Target);
public record MapInput(string MapKind, string MapKey);
public record MoveInput(int X, int Y);
public record MapTokenInput(string Label, string Side, int X, int Y);
public record HpInput(int Delta, string? Reason);

/// <summary>
/// Casos de uso da sessão de jogo: abertura/encerramento, presença, turnos, ações, mapa, fichas e histórico.
/// Toda escrita bloqueia a linha da sessão (PostgreSQL), incrementa a revisão e grava eventos na mesma transação.
/// </summary>
public partial class SessionService(GameDb db, SessionSignals signals, TimeProvider clock, ProgressionService? progression = null)
{
    public const int PageSize = 20, LiveEvents = 60;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    static readonly string[] Sides = ["ally", "enemy", "neutral"];
    DateTime Now => clock.GetUtcNow().UtcDateTime;
    ProgressionService Progression => progression ??= new ProgressionService(db, new AuditService(db), clock);

    // ---------- Acesso ----------
    record Access(GameSession Session, Campaign Campaign, bool IsMaster);

    async Task<(Campaign Campaign, bool IsMaster)> CampaignAccessAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var c = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == campaignId, ct) ?? throw NotFound();
        OneShotLifecycleService.EnsureOpen(c, Now);
        if (c.OwnerId == user) return (c, true);
        if (!await db.Members.AnyAsync(m => m.CampaignId == campaignId && m.UserId == user, ct)) throw NotFound();
        return (c, false);
    }

    async Task<Access> SessionAccessAsync(Guid sessionId, string user, CancellationToken ct, bool track = false)
    {
        var s = await (track ? db.Sessions : db.Sessions.AsNoTracking()).SingleOrDefaultAsync(x => x.Id == sessionId, ct) ?? throw NotFound();
        var (c, master) = await CampaignAccessAsync(s.CampaignId, user, ct);
        return new(s, c, master);
    }

    /// <summary>Bloqueia a sessão para escrita e reconfere o acesso dentro da transação.</summary>
    async Task<Access> LockAsync(Guid sessionId, string user, CancellationToken ct, bool requireActive = true)
    {
        var query = db.Database.IsNpgsql()
            ? db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"Id\" = {sessionId} FOR UPDATE")
            : db.Sessions.Where(x => x.Id == sessionId);
        var s = await query.SingleOrDefaultAsync(ct) ?? throw NotFound();
        var (c, master) = await CampaignAccessAsync(s.CampaignId, user, ct);
        if (requireActive && s.EndedAt != null) throw new RuleException(409, "Esta sessão foi encerrada pelo mestre.");
        return new(s, c, master);
    }

    static RuleException NotFound() => new(404, "Sessão não encontrada.");
    static void RequireMaster(Access a) { if (!a.IsMaster) throw new RuleException(403, "Somente o mestre pode realizar esta ação."); }
    static string Trim(string? value, int max, string message, bool required = true)
    {
        var text = (value ?? "").Trim();
        if ((required && text.Length == 0) || text.Length > max) throw new RuleException(400, message);
        return text;
    }

    async Task<string> NameAsync(string user, CancellationToken ct) =>
        await db.Users.Where(x => x.Id == user).Select(x => x.DisplayName).SingleOrDefaultAsync(ct) ?? "Aventureiro";

    void Event(GameSession s, string user, string author, string kind, string content, object? data = null, bool masterOnly = false)
    {
        db.Events.Add(new TableEvent
        {
            CampaignId = s.CampaignId, SessionId = s.Id, UserId = user, Author = author, Kind = kind,
            Content = content.Length > 2000 ? content[..2000] : content, MasterOnly = masterOnly,
            Data = data == null ? "" : JsonSerializer.Serialize(data, Json), CreatedAt = Now
        });
    }

    async Task CommitAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, GameSession s, CancellationToken ct)
    {
        s.Revision++;
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new RuleException(409, "Os dados mudaram durante a operação. Recarregue a mesa antes de tentar novamente."); }
        signals.Pulse(s.Id);
    }

    async Task<SessionParticipant?> MeAsync(Guid session, string user, CancellationToken ct) =>
        await db.SessionParticipants.SingleOrDefaultAsync(x => x.SessionId == session && x.UserId == user, ct);

    async Task<SessionParticipant> RequireJoinedAsync(Access a, string user, CancellationToken ct)
    {
        var me = await MeAsync(a.Session.Id, user, ct);
        if (me == null || me.LastSeenAt == null) throw new RuleException(409, "Entre na mesa antes de agir.");
        me.LastSeenAt = Now;
        return me;
    }

    static BattleMap ResolveBuiltIn(string kind, string key)
    {
        var map = BattleMaps.Find(key);
        if (map == null || map.Kind != kind) throw new RuleException(400, "Escolha um mapa disponível.");
        return map;
    }

    /// <summary>Valida um mapa escolhido pelo mestre: oficial ou recurso de mapa HTTPS da própria campanha.</summary>
    async Task<(string Kind, string Key, string Name)> ResolveMapAsync(Guid campaign, string? kind, string? key, CancellationToken ct)
    {
        if (kind != MapKinds.Cartographic && kind != MapKinds.Tileset) throw new RuleException(400, "Escolha mapa cartográfico ou tileset tático.");
        if (key?.StartsWith("resource:") == true && kind == MapKinds.Cartographic && Guid.TryParse(key[9..], out var resourceId))
        {
            var name = await db.Resources.Where(r => r.Id == resourceId && r.CampaignId == campaign && r.Kind == "mapa").Select(r => r.Name).SingleOrDefaultAsync(ct);
            return name == null ? throw new RuleException(400, "Mapa da campanha não encontrado.") : (kind, key, name);
        }
        if (key?.StartsWith("asset:") == true)
        {
            var asset = await new CampaignAssetsService(db).ResolveMapAsync(campaign, key, ct) ?? throw new RuleException(400, "Mapa da campanha não encontrado.");
            return (asset.Kind, asset.Key, asset.Name);
        }
        var map = ResolveBuiltIn(kind, key ?? "");
        return (map.Kind, map.Key, map.Name);
    }

    // ---------- Campanha ----------
    public async Task<object> MapsAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var (_, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre escolhe mapas.");
        var resources = await db.Resources.AsNoTracking().Where(r => r.CampaignId == campaignId && r.Kind == "mapa").OrderBy(r => r.Name).Take(50)
            .Select(r => new { key = "resource:" + r.Id, kind = MapKinds.Cartographic, name = r.Name, description = "Mapa da campanha", imageUrl = (string?)r.Content, rows = Array.Empty<string>() }).ToListAsync(ct);
        var builtIn = BattleMaps.All.Select(m => new { key = m.Key, kind = m.Kind, name = m.Name, description = m.Description, imageUrl = m.ImageUrl, rows = m.Rows });
        var assets = await new CampaignAssetsService(db).MapChoicesAsync(campaignId, ct);
        return new { items = builtIn.Concat(resources).Cast<object>().Concat(assets) };
    }

    public async Task<object> ListAsync(Guid campaignId, string user, int page, CancellationToken ct)
    {
        var (c, master) = await CampaignAccessAsync(campaignId, user, ct);
        if (!master) throw new RuleException(403, "Somente o mestre consulta o histórico de sessões.");
        page = Math.Clamp(page, 1, 100000);
        var query = db.Sessions.AsNoTracking().Where(s => s.CampaignId == campaignId);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(s => s.Number).Skip((page - 1) * PageSize).Take(PageSize).Select(s => new
        {
            s.Id, s.Number, s.Title, s.Objective, s.StartedAt, s.EndedAt, s.MapKind, s.MapKey,
            active = s.EndedAt == null,
            eventCount = db.Events.Count(e => e.SessionId == s.Id),
            noteCount = db.Events.Count(e => e.SessionId == s.Id && e.Kind == EventKinds.Note),
            participantCount = db.SessionParticipants.Count(p => p.SessionId == s.Id && !p.IsMaster)
        }).ToListAsync(ct);
        var lastActivity = await db.Events.Where(e => e.CampaignId == campaignId).MaxAsync(e => (DateTime?)e.CreatedAt, ct);
        return new { campaign = new { c.Id, c.Name }, items, total, page, pageSize = PageSize, lastActivityAt = lastActivity };
    }

    public async Task<object> StartAsync(Guid campaignId, StartSessionInput x, string user, CancellationToken ct)
    {
        var title = Trim(x.Title, 120, "Informe o nome da sessão com até 120 caracteres.");
        var objective = Trim(x.Objective, 2000, "O objetivo aceita até 2.000 caracteres.", false);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var campaign = db.Database.IsNpgsql()
            ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Campaigns.SingleOrDefaultAsync(c => c.Id == campaignId, ct);
        if (campaign == null || campaign.OwnerId != user)
        {
            if (campaign != null && await db.Members.AnyAsync(m => m.CampaignId == campaignId && m.UserId == user, ct)) throw new RuleException(403, "Somente o mestre pode iniciar uma sessão.");
            throw new RuleException(404, "Campanha não encontrada.");
        }
        if (await db.Sessions.AnyAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct)) throw new RuleException(409, "Já existe uma sessão em andamento nesta campanha.");
        OneShotLifecycleService.EnsureOpen(campaign, Now);
        if (campaign.IsOneShot) campaign.MasterLastSeenAt = Now;
        var map = await ResolveMapAsync(campaignId, x.MapKind, x.MapKey, ct);
        var number = (await db.Sessions.Where(s => s.CampaignId == campaignId).MaxAsync(s => (int?)s.Number, ct) ?? 0) + 1;
        var session = new GameSession { CampaignId = campaignId, Number = number, Title = title, Objective = objective, StartedAt = Now, MapKind = map.Kind, MapKey = map.Key };
        db.Sessions.Add(session);
        db.SessionParticipants.Add(new() { SessionId = session.Id, UserId = user, IsMaster = true, JoinedAt = Now, LastSeenAt = Now });
        var author = await NameAsync(user, ct);
        Event(session, user, author, EventKinds.Start, $"Sessão {number:00} iniciada — {title}", new { map = map.Name, mapKind = map.Kind });
        if (objective.Length > 0) Event(session, user, author, EventKinds.Note, objective, new { title = "Objetivo inicial" }, masterOnly: true);
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateException) { throw new RuleException(409, "Já existe uma sessão em andamento nesta campanha."); }
        return new { session.Id, session.Number };
    }

    /// <summary>Ponto de entrada da mesa: indica a sessão ativa e as fichas que o jogador pode levar.</summary>
    public async Task<object> EntryAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var (c, master) = await CampaignAccessAsync(campaignId, user, ct);
        var session = await db.Sessions.AsNoTracking().Where(s => s.CampaignId == campaignId && s.EndedAt == null).Select(s => new { s.Id, s.Number, s.Title }).SingleOrDefaultAsync(ct);
        var freeFallback = c.SheetTemplateId == null && !await db.SheetTemplates.AnyAsync(t => t.RpgSystemId == c.RpgSystemId && t.IsDefault && t.ArchivedAt == null && t.CurrentVersionId != null, ct);
        var eligible = db.Characters.Where(ch => ch.OwnerId == user &&
            ((ch.TemplateVersionId == null && (c.RpgSystemId == RpgSystem.FreeSystemId || freeFallback)) ||
             db.SheetTemplateVersions.Any(v => v.Id == ch.TemplateVersionId && db.SheetTemplates.Any(t => t.Id == v.TemplateId &&
                (t.RpgSystemId == c.RpgSystemId || (freeFallback && t.Id == SheetTemplate.FreeTemplateId))))));
        var linked = master ? [] : await db.CampaignCharacters.Where(l => l.CampaignId == campaignId)
            .Join(eligible, l => l.CharacterId, ch => ch.Id, (l, ch) => new { ch.Id, ch.Name, ch.Archetype, ch.Level, ch.Hp, ch.MaxHp, linked = true }).ToListAsync(ct);
        var others = master ? [] : await eligible.Where(ch => !db.CampaignCharacters.Any(l => l.CampaignId == campaignId && l.CharacterId == ch.Id))
            .OrderByDescending(ch => ch.UpdatedAt).Take(50).Select(ch => new { ch.Id, ch.Name, ch.Archetype, ch.Level, ch.Hp, ch.MaxHp, linked = false }).ToListAsync(ct);
        var joined = session == null ? null : await db.SessionParticipants.Where(p => p.SessionId == session.Id && p.UserId == user).Select(p => new { p.CharacterId }).SingleOrDefaultAsync(ct);
        return new { campaign = new { c.Id, c.Name, c.IsOneShot, c.ExpiresAt }, isMaster = master, online = session != null, session, joinedCharacterId = joined?.CharacterId, characters = linked.Concat(others) };
    }

    // ---------- Presença ----------
    public async Task JoinAsync(Guid sessionId, Guid? characterId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var me = await MeAsync(sessionId, user, ct);
        var author = await NameAsync(user, ct);
        if (a.IsMaster)
        {
            if (a.Campaign.IsOneShot) await db.Campaigns.Where(c => c.Id == a.Campaign.Id).ExecuteUpdateAsync(c => c.SetProperty(x => x.MasterLastSeenAt, Now), ct);
            if (me == null) db.SessionParticipants.Add(new() { SessionId = sessionId, UserId = user, IsMaster = true, JoinedAt = Now, LastSeenAt = Now });
            else me.LastSeenAt = Now;
            await CommitAsync(tx, a.Session, ct); return;
        }
        Character character;
        if (characterId is { } chosen)
        {
            character = await db.Characters.SingleOrDefaultAsync(ch => ch.Id == chosen && ch.OwnerId == user, ct) ?? throw new RuleException(404, "Ficha não encontrada.");
            if (!await db.CampaignCharacters.AnyAsync(l => l.CampaignId == a.Campaign.Id && l.CharacterId == chosen, ct))
                db.CampaignCharacters.Add(new() { CampaignId = a.Campaign.Id, CharacterId = chosen });
        }
        else
        {
            var current = me?.CharacterId;
            var options = await db.CampaignCharacters.Where(l => l.CampaignId == a.Campaign.Id)
                .Join(db.Characters.Where(ch => ch.OwnerId == user), l => l.CharacterId, ch => ch.Id, (l, ch) => ch).ToListAsync(ct);
            character = options.FirstOrDefault(ch => ch.Id == current) ?? (options.Count == 1 ? options[0] : throw new RuleException(409, "Escolha a ficha que você levará para a mesa."));
        }
        await CharacterSheets.RequireCampaignSystemAsync(db, character, a.Campaign, ct);
        var arrived = me == null || me.LastSeenAt == null || me.CharacterId != character.Id;
        if (me == null) db.SessionParticipants.Add(me = new() { SessionId = sessionId, UserId = user, CharacterId = character.Id, JoinedAt = Now, LastSeenAt = Now });
        else
        {
            if (me.CharacterId is { } previous && previous != character.Id)
            {
                // Trocar de ficha retira o personagem anterior do mapa e da vez.
                if (a.Session.ActiveCharacterId == previous) a.Session.ActiveCharacterId = null;
                await db.SessionTokens.Where(t => t.SessionId == sessionId && t.CharacterId == previous).ExecuteDeleteAsync(ct);
            }
            me.CharacterId = character.Id; me.LastSeenAt = Now;
        }
        await EnsureTokenAsync(a.Session, character, ct);
        if (arrived) Event(a.Session, user, author, EventKinds.Join, $"{character.Name} entrou na mesa", new { characterId = character.Id, player = author });
        await CommitAsync(tx, a.Session, ct);
    }

    async Task EnsureTokenAsync(GameSession s, Character character, CancellationToken ct)
    {
        if (s.MapKind != MapKinds.Tileset || await db.SessionTokens.AnyAsync(t => t.SessionId == s.Id && t.CharacterId == character.Id, ct)) return;
        var map = BattleMaps.Find(s.MapKey) ?? (await new CampaignAssetsService(db).ResolveMapAsync(s.CampaignId, s.MapKey, ct))?.AsBattleMap();
        if (map == null) return;
        var taken = (await db.SessionTokens.Where(t => t.SessionId == s.Id).Select(t => new { t.X, t.Y }).ToListAsync(ct)).Select(t => (t.X, t.Y)).ToHashSet();
        taken.UnionWith(db.SessionTokens.Local.Where(t => t.SessionId == s.Id).Select(t => (t.X, t.Y)));
        var spot = FreeSpot(map, taken);
        if (spot is { } p) db.SessionTokens.Add(new() { SessionId = s.Id, CharacterId = character.Id, Label = character.Name.Length > 40 ? character.Name[..40] : character.Name, Side = "ally", X = p.X, Y = p.Y });
    }

    static (int X, int Y)? FreeSpot(BattleMap map, HashSet<(int, int)> taken)
    {
        foreach (var spawn in map.Spawns()) if (!taken.Contains(spawn)) return spawn;
        // Ao esgotar os pontos de entrada, procura a célula livre mais próxima do primeiro ponto.
        var origin = map.Spawns().FirstOrDefault();
        for (var radius = 1; radius < Math.Max(map.Width, map.Height); radius++)
            for (var y = origin.Y - radius; y <= origin.Y + radius; y++)
                for (var x = origin.X - radius; x <= origin.X + radius; x++)
                    if (map.CanStand(x, y) && !taken.Contains((x, y))) return (x, y);
        return null;
    }

    public async Task HeartbeatAsync(Guid sessionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var me = await MeAsync(sessionId, user, ct) ?? throw new RuleException(409, "Entre na mesa antes de agir.");
        if (me.LastSeenAt == null) throw new RuleException(409, "Entre na mesa antes de agir.");
        if (a.IsMaster && a.Campaign.IsOneShot) await db.Campaigns.Where(c => c.Id == a.Campaign.Id).ExecuteUpdateAsync(c => c.SetProperty(x => x.MasterLastSeenAt, Now), ct);
        me.LastSeenAt = Now;
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task LeaveAsync(Guid sessionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var me = await MeAsync(sessionId, user, ct);
        if (a.IsMaster && a.Campaign.IsOneShot)
        {
            await CloseOneShotAsync(a, tx, ct); return;
        }
        if (me == null || me.LastSeenAt == null) return;
        me.LastSeenAt = null;
        if (!me.IsMaster)
        {
            if (a.Session.ActiveCharacterId == me.CharacterId) a.Session.ActiveCharacterId = null;
            var name = await db.Characters.Where(c => c.Id == me.CharacterId).Select(c => c.Name).SingleOrDefaultAsync(ct) ?? "Um aventureiro";
            Event(a.Session, user, await NameAsync(user, ct), EventKinds.Leave, $"{name} saiu da mesa", new { characterId = me.CharacterId });
        }
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task EndAsync(Guid sessionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        if (a.Campaign.IsOneShot) { await CloseOneShotAsync(a, tx, ct); return; }
        a.Session.EndedAt = Now; a.Session.ActiveCharacterId = null;
        await db.SessionParticipants.Where(p => p.SessionId == sessionId).ExecuteUpdateAsync(p => p.SetProperty(x => x.LastSeenAt, (DateTime?)null), ct);
        var minutes = (int)Math.Round((a.Session.EndedAt.Value - a.Session.StartedAt).TotalMinutes);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.End, $"Sessão encerrada após {Duration(minutes)}", new { minutes });
        await AwardSessionXpAsync(a, ct);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>XP do encerramento (mesma transação): jogadores que entraram com ficha e o mestre. Sessões curtas não concedem.</summary>
    async Task AwardSessionXpAsync(Access a, CancellationToken ct)
    {
        var s = a.Session;
        if (s.EndedAt is not { } ended || ended - s.StartedAt < TimeSpan.FromMinutes(Eternnus.Web.Progression.MinSessionMinutes)) return;
        var players = await db.SessionParticipants.Where(p => p.SessionId == s.Id && !p.IsMaster && p.CharacterId != null && p.UserId != a.Campaign.OwnerId)
            .Select(p => p.UserId).OrderBy(p => p).ToListAsync(ct);
        foreach (var player in players) await Progression.AwardAsync(player, XpReasons.SessionPlayed, $"{XpReasons.SessionPlayed}:{s.Id}:{player}", ct);
        await Progression.AwardAsync(a.Campaign.OwnerId, XpReasons.SessionMastered, $"{XpReasons.SessionMastered}:{s.Id}", ct);
    }

    static string Duration(int minutes) => minutes < 60 ? $"{minutes} min" : $"{minutes / 60}h{minutes % 60:00}min";

    // ---------- Comunicação ----------
    public async Task MessageAsync(Guid sessionId, SessionTextInput x, string user, CancellationToken ct)
    {
        var content = Trim(x.Content, 2000, "Escreva de 1 a 2000 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); await RequireJoinedAsync(a, user, ct);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Message, content, new { master = a.IsMaster });
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task<DiceResult> RollAsync(Guid sessionId, SessionRollInput x, string user, CancellationToken ct)
    {
        var label = Trim(x.Label, 60, "A descrição da rolagem aceita até 60 caracteres.", false);
        DiceResult roll; try { roll = Dice.Roll(Trim(x.Formula, 40, "Fórmula inválida.")); } catch (ArgumentException e) { throw new RuleException(400, e.Message); }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); var me = await RequireJoinedAsync(a, user, ct);
        var who = await ActorAsync(me, user, ct);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Roll, $"{who} rolou {(label.Length > 0 ? label + ": " : "")}{roll.Formula} = {roll.Total}", new { roll, label, actor = who });
        await CommitAsync(tx, a.Session, ct);
        return roll;
    }

    async Task<string> ActorAsync(SessionParticipant me, string user, CancellationToken ct) => me.IsMaster ? "Mestre" :
        await db.Characters.Where(c => c.Id == me.CharacterId).Select(c => c.Name).SingleOrDefaultAsync(ct) ?? await NameAsync(user, ct);

    public async Task NoteAsync(Guid sessionId, SessionNoteInput x, string user, CancellationToken ct)
    {
        var content = Trim(x.Content, 2000, "A anotação deve ter de 1 a 2000 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct, requireActive: false); RequireMaster(a);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Note, content, new { shared = x.Shared, afterEnd = a.Session.EndedAt != null }, masterOnly: !x.Shared);
        await CommitAsync(tx, a.Session, ct);
    }

    // ---------- Turnos ----------
    async Task<List<(Guid Character, string Name)>> TurnOrderAsync(Guid sessionId, CancellationToken ct)
    {
        var since = Now - TableRules.OnlineWindow;
        var rows = await db.SessionParticipants.Where(p => p.SessionId == sessionId && !p.IsMaster && p.CharacterId != null && p.LastSeenAt >= since)
            .OrderBy(p => p.JoinedAt).ThenBy(p => p.UserId)
            .Join(db.Characters, p => p.CharacterId, c => c.Id, (p, c) => new { c.Id, c.Name }).ToListAsync(ct);
        return rows.Select(r => (r.Id, r.Name)).ToList();
    }

    public async Task SetTurnAsync(Guid sessionId, TurnInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        string text;
        if (x.CharacterId is { } target)
        {
            var order = await TurnOrderAsync(sessionId, ct);
            var chosen = order.FirstOrDefault(o => o.Character == target);
            if (chosen == default) throw new RuleException(409, "Esse personagem não está presente na mesa.");
            a.Session.ActiveCharacterId = a.Session.LastActiveCharacterId = target; a.Session.TurnNumber++; text = $"Turno de {chosen.Name}";
        }
        else { a.Session.ActiveCharacterId = null; text = "O mestre retomou a narrativa"; }
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Turn, text, new { characterId = x.CharacterId, turn = a.Session.TurnNumber });
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task NextTurnAsync(Guid sessionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var order = await TurnOrderAsync(sessionId, ct);
        var next = TableRules.NextTurn(order.Select(o => o.Character).ToList(), a.Session.ActiveCharacterId ?? a.Session.LastActiveCharacterId) ?? throw new RuleException(409, "Nenhum aventureiro presente para receber o turno.");
        a.Session.ActiveCharacterId = a.Session.LastActiveCharacterId = next; a.Session.TurnNumber++;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Turn, $"Turno de {order.First(o => o.Character == next).Name}", new { characterId = next, turn = a.Session.TurnNumber });
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task EndTurnAsync(Guid sessionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var me = await RequireJoinedAsync(a, user, ct);
        if (!a.IsMaster && (a.Session.ActiveCharacterId == null || a.Session.ActiveCharacterId != me.CharacterId)) throw new RuleException(409, "Não é o seu turno.");
        var name = await db.Characters.Where(c => c.Id == a.Session.ActiveCharacterId).Select(c => c.Name).SingleOrDefaultAsync(ct) ?? "O aventureiro";
        a.Session.ActiveCharacterId = null;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Turn, $"{name} encerrou o turno", new { ended = true, turn = a.Session.TurnNumber });
        await CommitAsync(tx, a.Session, ct);
    }

    async Task<(Access Access, SessionParticipant Me, Character Character)> RequireTurnAsync(Guid sessionId, string user, CancellationToken ct)
    {
        var a = await LockAsync(sessionId, user, ct);
        if (a.IsMaster) throw new RuleException(409, "Ações de ficha pertencem aos jogadores. Conceda o turno ao personagem.");
        var me = await RequireJoinedAsync(a, user, ct);
        if (a.Session.ActiveCharacterId == null || a.Session.ActiveCharacterId != me.CharacterId) throw new RuleException(409, "Aguarde o mestre conceder o seu turno.");
        var character = await db.Characters.SingleAsync(c => c.Id == me.CharacterId, ct);
        return (a, me, character);
    }

    /// <summary>Usa uma ação da ficha no turno do jogador. A rolagem acontece no servidor.</summary>
    public async Task<object> UseActionAsync(Guid sessionId, ActionInput x, string user, CancellationToken ct)
    {
        var target = Trim(x.Target, 60, "O alvo aceita até 60 caracteres.", false);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var (a, _, character) = await RequireTurnAsync(sessionId, user, ct);
        var author = await NameAsync(user, ct);
        string text; object data; object? roll = null;
        if (x.Kind == "defender")
        {
            text = $"{character.Name} assumiu postura defensiva (Armadura {character.Armor} + 2 até o próximo turno)";
            data = new { kind = "defender", armor = character.Armor };
        }
        else
        {
            if (!ActionKinds.All.Contains(x.Kind)) throw new RuleException(400, "Ação inválida.");
            // Ações da ficha: as da versão do modelo ("t:chave") e as criadas pelo jogador; fórmulas usam os @campos da ficha.
            var sheet = await CharacterSheets.LoadAsync(db, character, ct);
            CharacterAction action;
            if (string.IsNullOrEmpty(x.ActionId) && x.Kind == ActionKinds.Attack)
            {
                var mod = TableRules.Modifier(character.Strength);
                action = new() { Id = "basic", Name = "Ataque básico", Kind = ActionKinds.Attack, Formula = "1d20" + (mod >= 0 ? "+" : "") + mod };
            }
            else if (x.ActionId != null && x.ActionId.StartsWith(TableRules.TemplateActionPrefix, StringComparison.Ordinal))
            {
                var key = x.ActionId[TableRules.TemplateActionPrefix.Length..];
                var defined = sheet.Version.Actions.FirstOrDefault(d => d.Key == key && d.Kind == x.Kind) ?? throw new RuleException(404, "Essa ação não existe na sua ficha.");
                action = new() { Id = x.ActionId, Name = defined.Name, Kind = defined.Kind, Formula = defined.Formula, Description = defined.Description };
            }
            else action = (character.Actions ?? []).FirstOrDefault(c => c.Id == x.ActionId && c.Kind == x.Kind) ?? throw new RuleException(404, "Essa ação não existe na sua ficha.");
            if (action.Formula.Length > 0)
            {
                var scope = SheetCalculator.Scope(sheet.Version.Fields, CharacterSheets.All(sheet.Version.Fields, sheet.Stored));
                roll = CharacterSheets.Roll(action.Formula, scope);
            }
            text = $"{character.Name} usou {action.Name}{(target.Length > 0 ? " em " + target : "")}{(roll == null ? "" : ": " + CharacterSheets.RollTotal(roll))}";
            data = new { kind = action.Kind, action = action.Name, actionId = action.Id, description = action.Description, target, roll };
        }
        Event(a.Session, user, author, EventKinds.Action, text, data);
        await CommitAsync(tx, a.Session, ct);
        return new { message = text, roll };
    }

    // ---------- Mapa e marcadores ----------
    public async Task SetMapAsync(Guid sessionId, MapInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var map = await ResolveMapAsync(a.Campaign.Id, x.MapKind, x.MapKey, ct);
        if (map.Key == a.Session.MapKey) { await tx.RollbackAsync(ct); return; }
        var previous = await MapNameAsync(a.Session, ct);
        a.Session.MapKind = map.Kind; a.Session.MapKey = map.Key;
        if (map.Kind == MapKinds.Tileset)
        {
            // Novo tileset: criaturas do cenário anterior saem e os aventureiros voltam aos pontos de entrada.
            await db.SessionTokens.Where(t => t.SessionId == sessionId).ExecuteDeleteAsync(ct);
            var characters = await db.SessionParticipants.Where(p => p.SessionId == sessionId && p.CharacterId != null)
                .OrderBy(p => p.JoinedAt).Join(db.Characters, p => p.CharacterId, c => c.Id, (p, c) => c).ToListAsync(ct);
            foreach (var c in characters) await EnsureTokenAsync(a.Session, c, ct);
        }
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, $"Mestre revelou o mapa {map.Name}", new { from = previous, to = map.Name, kind = map.Kind });
        await CommitAsync(tx, a.Session, ct);
    }

    async Task<string> MapNameAsync(GameSession s, CancellationToken ct)
    {
        if (s.MapKey.StartsWith("resource:") && Guid.TryParse(s.MapKey[9..], out var id))
            return await db.Resources.Where(r => r.Id == id).Select(r => r.Name).SingleOrDefaultAsync(ct) ?? "Mapa removido";
        if (s.MapKey.StartsWith("asset:")) return (await new CampaignAssetsService(db).ResolveMapAsync(s.CampaignId, s.MapKey, ct))?.Name ?? "Mapa removido";
        return BattleMaps.Find(s.MapKey)?.Name ?? "Mapa";
    }

    async Task<BattleMap> RequireTilesetAsync(GameSession s, CancellationToken ct)
    {
        if (s.MapKind == MapKinds.Tileset)
        {
            var map = BattleMaps.Find(s.MapKey) ?? (await new CampaignAssetsService(db).ResolveMapAsync(s.CampaignId, s.MapKey, ct))?.AsBattleMap();
            if (map != null) return map;
        }
        throw new RuleException(409, "Marcadores existem somente no tileset tático.");
    }

    public async Task MoveTokenAsync(Guid sessionId, Guid tokenId, MoveInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var map = await RequireTilesetAsync(a.Session, ct);
        var token = await db.SessionTokens.SingleOrDefaultAsync(t => t.Id == tokenId && t.SessionId == sessionId, ct) ?? throw new RuleException(404, "Marcador não encontrado.");
        if (!map.CanStand(x.X, x.Y)) throw new RuleException(400, "Esse ponto do mapa está bloqueado.");
        if (await db.SessionTokens.AnyAsync(t => t.SessionId == sessionId && t.Id != tokenId && t.X == x.X && t.Y == x.Y, ct)) throw new RuleException(409, "Já existe alguém nesse ponto.");
        var author = await NameAsync(user, ct);
        if (!a.IsMaster)
        {
            var (_, _, character) = await RequireTurnAsync(sessionId, user, ct);
            if (token.CharacterId != character.Id) throw new RuleException(403, "Você só move o próprio personagem.");
            var limit = TableRules.MovementSquares(character.Movement, map.ScaleMeters);
            if (TableRules.Distance(token.X, token.Y, x.X, x.Y) > limit) throw new RuleException(400, $"Seu deslocamento alcança {limit} quadrados por turno.");
            if (token.LastMovedTurn == a.Session.TurnNumber) throw new RuleException(409, "Você já se moveu neste turno.");
            token.LastMovedTurn = a.Session.TurnNumber;
        }
        var from = new { x = token.X, y = token.Y };
        token.X = x.X; token.Y = x.Y;
        Event(a.Session, user, author, EventKinds.Move, $"{token.Label} se moveu", new { tokenId, from, to = new { x = x.X, y = x.Y } });
        await CommitAsync(tx, a.Session, ct);
    }

    public async Task<object> AddTokenAsync(Guid sessionId, MapTokenInput x, string user, CancellationToken ct)
    {
        var label = Trim(x.Label, 40, "Dê um nome de até 40 caracteres ao marcador.");
        if (!Sides.Contains(x.Side)) throw new RuleException(400, "Lado do marcador inválido.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var map = await RequireTilesetAsync(a.Session, ct);
        if (!map.CanStand(x.X, x.Y)) throw new RuleException(400, "Esse ponto do mapa está bloqueado.");
        if (await db.SessionTokens.AnyAsync(t => t.SessionId == sessionId && t.X == x.X && t.Y == x.Y, ct)) throw new RuleException(409, "Já existe alguém nesse ponto.");
        if (await db.SessionTokens.CountAsync(t => t.SessionId == sessionId, ct) >= 60) throw new RuleException(409, "Limite de 60 marcadores no mapa.");
        var token = new SessionToken { SessionId = sessionId, Label = label, Side = x.Side, X = x.X, Y = x.Y };
        db.SessionTokens.Add(token);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Token, $"{label} surgiu no mapa", new { tokenId = token.Id, side = x.Side, x = x.X, y = x.Y });
        await CommitAsync(tx, a.Session, ct);
        return new { token.Id };
    }

    public async Task RemoveTokenAsync(Guid sessionId, Guid tokenId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var token = await db.SessionTokens.SingleOrDefaultAsync(t => t.Id == tokenId && t.SessionId == sessionId, ct) ?? throw new RuleException(404, "Marcador não encontrado.");
        if (token.CharacterId != null) throw new RuleException(409, "Personagens de jogadores não são removidos do mapa.");
        db.SessionTokens.Remove(token);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Token, $"{token.Label} deixou o mapa", new { tokenId, removed = true });
        await CommitAsync(tx, a.Session, ct);
    }

    // ---------- Fichas ----------
    /// <summary>Ficha de um participante (mestre) ou a própria: colunas clássicas + <c>sheet</c> com modelo, valores e calculados.</summary>
    public async Task<object> SheetAsync(Guid sessionId, Guid characterId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct);
        var c = await db.Characters.AsNoTracking().SingleOrDefaultAsync(c => c.Id == characterId, ct) ?? throw new RuleException(404, "Ficha não encontrada.");
        var inSession = await db.SessionParticipants.AnyAsync(p => p.SessionId == sessionId && p.CharacterId == characterId, ct);
        if (!inSession || (c.OwnerId != user && !a.IsMaster && c.Private)) throw new RuleException(404, "Ficha não encontrada.");
        var sheet = await CharacterSheets.ViewAsync(db, c, await CharacterSheets.LoadAsync(db, c, ct), ct, user);
        return new
        {
            c.Id, c.OwnerId, c.Name, c.Archetype, c.Level, c.Hp, c.MaxHp, c.Strength, c.Agility, c.Intellect, c.Constitution, c.Armor, c.Movement,
            c.Notes, c.Actions, c.TemplateVersionId, c.Values, c.Revision, c.UpdatedAt, c.Private, canEdit = a.IsMaster || c.OwnerId == user, sheet,
        };
    }

    public async Task<object> AdjustHpAsync(Guid sessionId, Guid characterId, HpInput x, string user, CancellationToken ct)
    {
        var reason = Trim(x.Reason, 120, "O motivo aceita até 120 caracteres.", false);
        if (x.Delta is 0 or < -100000 or > 100000) throw new RuleException(400, "Informe um ajuste de vida diferente de zero.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        if (!await db.SessionParticipants.AnyAsync(p => p.SessionId == sessionId && p.CharacterId == characterId, ct)) throw new RuleException(404, "Ficha não encontrada.");
        var character = await db.Characters.SingleAsync(c => c.Id == characterId, ct);
        if (!a.IsMaster && character.OwnerId != user) throw new RuleException(403, "Somente o mestre e o dono podem alterar a ficha.");
        var sheet = await CharacterSheets.LoadAsync(db, character, ct);
        var before = character.Hp;
        character.Hp = Math.Clamp(character.Hp + x.Delta, 0, character.MaxHp);
        if (character.Hp == before) { await tx.RollbackAsync(ct); return new { character.Hp, character.MaxHp }; }
        // O campo com papel "hp" acompanha a coluna; o histórico por campo registra o ajuste como "master".
        var values = CharacterSheets.FromColumns(character, sheet);
        CharacterSheets.Commit(db, character, sheet, values, user, a.IsMaster ? FieldChangeSources.Master : FieldChangeSources.Table, a.Session.Id, Now);
        character.Revision++; character.UpdatedAt = Now;
        db.Versions.Add(new() { CharacterId = character.Id, Revision = character.Revision, Snapshot = JsonSerializer.Serialize(character), ChangedById = user, SessionId = sessionId, CreatedAt = Now });
        var verb = character.Hp < before ? $"sofreu {before - character.Hp} pontos de dano" : $"recuperou {character.Hp - before} pontos de vida";
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet, $"{character.Name} {verb}",
            new { characterId, changes = new[] { new SheetChange("hp", "Vida", before.ToString(), character.Hp.ToString()) }, reason }, masterOnly: true);
        db.ChangeTracker.Entries<TableEvent>().Last(e => e.State == EntityState.Added).Entity.VisibleToUserId = character.OwnerId;
        await CommitAsync(tx, a.Session, ct);
        return new { character.Hp, character.MaxHp };
    }

    // ---------- Leitura ao vivo ----------
    /// <summary>Long-poll somente leitura: aguarda até a revisão superar <paramref name="after"/> ou até o prazo.</summary>
    public async Task<object> LiveAsync(Guid sessionId, int after, string user, CancellationToken ct)
    {
        await SessionAccessAsync(sessionId, user, ct);
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
        return await StateAsync(sessionId, user, ct);
    }

    public async Task<object> StateAsync(Guid sessionId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct);
        var s = a.Session; var now = Now;
        var people = await db.SessionParticipants.AsNoTracking().Where(p => p.SessionId == sessionId)
            .Join(db.Users, p => p.UserId, u => u.Id, (p, u) => new { p, u.DisplayName, u.AvatarUrl })
            .GroupJoin(db.Characters, x => x.p.CharacterId, c => c.Id, (x, cs) => new { x, cs })
            .SelectMany(g => g.cs.DefaultIfEmpty(), (g, c) => new
            {
                g.x.p.UserId, g.x.p.IsMaster, g.x.p.CharacterId, g.x.p.JoinedAt, g.x.p.LastSeenAt, g.x.DisplayName, g.x.AvatarUrl,
                characterName = c == null ? null : c.Name, archetype = c == null || (c.Private && !a.IsMaster && c.OwnerId != user) ? null : c.Archetype,
                level = c == null || (c.Private && !a.IsMaster && c.OwnerId != user) ? (int?)null : c.Level,
                hp = c == null || (c.Private && !a.IsMaster && c.OwnerId != user) ? (int?)null : c.Hp,
                maxHp = c == null || (c.Private && !a.IsMaster && c.OwnerId != user) ? (int?)null : c.MaxHp,
                canView = c != null && (!c.Private || a.IsMaster || c.OwnerId == user)
            }).OrderBy(x => x.JoinedAt).ToListAsync(ct);
        var participants = people.Select(p => new
        {
            userId = p.UserId, name = p.DisplayName, avatarUrl = p.AvatarUrl, isMaster = p.IsMaster, characterId = p.CharacterId,
            p.characterName, p.archetype, p.level, p.hp, p.maxHp, p.canView, online = TableRules.IsOnline(p.LastSeenAt, now), isMe = p.UserId == user
        }).ToList();
        var me = people.FirstOrDefault(p => p.UserId == user);
        var events = await db.Events.AsNoTracking().Where(e => e.SessionId == sessionId && (a.IsMaster || (!e.MasterOnly && e.Kind != EventKinds.Sheet) || e.VisibleToUserId == user))
            .OrderByDescending(e => e.Id).Take(LiveEvents)
            .Select(e => new { e.Id, e.Kind, e.Author, e.Content, e.Data, e.CreatedAt, e.MasterOnly, mine = e.UserId == user }).ToListAsync(ct);
        events.Reverse();
        var tokens = s.MapKind == MapKinds.Tileset
            ? await db.SessionTokens.AsNoTracking().Where(t => t.SessionId == sessionId).OrderBy(t => t.Label)
                .Select(t => new { t.Id, t.CharacterId, t.Label, t.Side, t.X, t.Y, t.LastMovedTurn }).ToListAsync(ct)
            : [];
        object map;
        var builtIn = BattleMaps.Find(s.MapKey);
        if (builtIn != null) map = new { kind = builtIn.Kind, key = builtIn.Key, name = builtIn.Name, imageUrl = builtIn.ImageUrl, rows = builtIn.Rows, width = builtIn.Width, height = builtIn.Height };
        else if (s.MapKey.StartsWith("asset:") && await new CampaignAssetsService(db).ResolveMapAsync(s.CampaignId, s.MapKey, ct) is { } asset) map = asset;
        else
        {
            var resource = s.MapKey.StartsWith("resource:") && Guid.TryParse(s.MapKey[9..], out var rid)
                ? await db.Resources.AsNoTracking().Where(r => r.Id == rid && r.CampaignId == s.CampaignId).Select(r => new { r.Name, r.Content }).SingleOrDefaultAsync(ct) : null;
            map = new { kind = MapKinds.Cartographic, key = s.MapKey, name = resource?.Name ?? "Mapa indisponível", imageUrl = resource?.Content, rows = Array.Empty<string>(), width = 0, height = 0 };
        }
        Character? sheet = null;
        if (!a.IsMaster && me?.CharacterId is { } mine) sheet = await db.Characters.AsNoTracking().SingleOrDefaultAsync(c => c.Id == mine, ct);
        object? liveCharacter = null;
        if (sheet != null)
        {
            var context = await CharacterSheets.LoadAsync(db, sheet, ct);
            liveCharacter = new
            {
                sheet.Id, sheet.Name, sheet.Archetype, sheet.Level, sheet.Hp, sheet.MaxHp, sheet.Strength, sheet.Agility, sheet.Intellect,
                sheet.Constitution, sheet.Armor, sheet.Movement, sheet.Notes, sheet.Revision, sheet.UpdatedAt,
                templateId = context.Template.Id, templateName = context.Template.Name,
                actions = CharacterSheets.CombinedActions(context.Version, sheet.Actions),
            };
        }
        var active = participants.FirstOrDefault(p => p.characterId != null && p.characterId == s.ActiveCharacterId);
        return new
        {
            s.Revision, serverTime = now,
            session = new { s.Id, s.Number, s.Title, objective = a.IsMaster ? s.Objective : null, s.StartedAt, s.EndedAt, s.TurnNumber, s.TemporaryImageId, s.TemporaryImageTitle, activeCharacterId = s.ActiveCharacterId, activeName = active?.characterName },
            campaign = new { a.Campaign.Id, a.Campaign.Name, a.Campaign.IsOneShot, a.Campaign.ExpiresAt, master = participants.FirstOrDefault(p => p.isMaster)?.name ?? await NameAsync(a.Campaign.OwnerId, ct) },
            me = new { userId = user, isMaster = a.IsMaster, joined = me?.LastSeenAt != null, characterId = me?.CharacterId, character = liveCharacter },
            participants, map, tokens, events
        };
    }

    // ---------- Histórico ----------
    public async Task<object> HistoryAsync(Guid sessionId, string user, string? kind, string? search, int page, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct);
        if (!a.IsMaster) throw new RuleException(403, "Somente o mestre consulta o histórico de sessões.");
        if (search?.Length > 100) throw new RuleException(400, "Busca muito longa.");
        page = Math.Clamp(page, 1, 100000);
        var s = a.Session;
        var all = db.Events.AsNoTracking().Where(e => e.SessionId == sessionId);
        var query = all;
        if (kind == "rolls") query = query.Where(e => e.Kind == EventKinds.Roll || e.Kind == EventKinds.Action);
        else if (!string.IsNullOrEmpty(kind))
        {
            if (!EventKinds.Filterable.Contains(kind)) throw new RuleException(400, "Filtro inválido.");
            query = query.Where(e => e.Kind == kind);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(e => e.Content.ToLower().Contains(term) || e.Author.ToLower().Contains(term));
        }
        var total = await query.CountAsync(ct);
        var events = await query.OrderBy(e => e.Id).Skip((page - 1) * 50).Take(50)
            .Select(e => new { e.Id, e.Kind, e.Author, e.Content, e.Data, e.CreatedAt, e.MasterOnly }).ToListAsync(ct);
        var counts = await all.GroupBy(e => e.Kind).Select(g => new { kind = g.Key, count = g.Count() }).ToListAsync(ct);
        var people = await db.SessionParticipants.AsNoTracking().Where(p => p.SessionId == sessionId && !p.IsMaster)
            .Join(db.Users, p => p.UserId, u => u.Id, (p, u) => new { p.CharacterId, p.JoinedAt, player = u.DisplayName, u.AvatarUrl })
            .GroupJoin(db.Characters, x => x.CharacterId, c => c.Id, (x, cs) => new { x, cs })
            .SelectMany(g => g.cs.DefaultIfEmpty(), (g, c) => new { g.x.CharacterId, g.x.JoinedAt, g.x.player, g.x.AvatarUrl, name = c == null ? "Ficha removida" : c.Name, level = c == null ? 0 : c.Level, hp = c == null ? 0 : c.Hp, maxHp = c == null ? 0 : c.MaxHp })
            .OrderBy(x => x.JoinedAt).ToListAsync(ct);
        var end = s.EndedAt ?? Now;
        return new
        {
            session = new { s.Id, s.Number, s.Title, s.Objective, s.StartedAt, s.EndedAt, active = s.EndedAt == null, durationMinutes = (int)Math.Round((end - s.StartedAt).TotalMinutes), map = await MapNameAsync(s, ct) },
            campaign = new { a.Campaign.Id, a.Campaign.Name },
            counts, participants = people, events, total, page, pageSize = 50
        };
    }
}
