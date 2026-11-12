using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record PauseInput(bool Paused);
public record TurnOrderInput(List<TurnEntry>? Entries, bool SortByInitiative = false);
public record SheetResourceInput(string Field, int Delta, string? Reason);
public record ConditionsInput(string? Conditions);
public record UndoInput(long EventId);
public record RollRequestInput(string Label, string? Formula, DiceSpec? Spec, string? Visibility, int? Target, string? Rule, List<Guid>? CharacterIds);

/// <summary>
/// Condução da mesa independente do sistema: forma de jogo, pausa, ordem de turnos, rolagens com visibilidade,
/// pedidos de teste, recursos, condições e desfazer. Toda escrita segue bloqueio → evento → revisão → sinal.
/// </summary>
public partial class SessionService
{
    public const int MaxOpenRequests = 5, MaxRequestTargets = 20;

    // ---------- Turno ----------
    static TurnEntry? ActiveEntry(GameSession s) => s.ActiveTurnKey == null ? null : TurnOrders.Parse(s.TurnOrder).FirstOrDefault(e => e.Key == s.ActiveTurnKey);
    static bool IsTurnOf(GameSession s, Guid? character) => character != null && (s.ActiveCharacterId == character || TurnOrders.Includes(ActiveEntry(s), character));

    void Activate(GameSession s, TurnEntry entry)
    {
        s.ActiveTurnKey = entry.Key;
        s.ActiveCharacterId = TurnOrders.CharacterOf(entry.Key);
        if (s.ActiveCharacterId != null) s.LastActiveCharacterId = s.ActiveCharacterId;
        s.TurnNumber++;
    }

    /// <summary>Próxima entrada disponível: personagem presente, marcador no mapa ou grupo com alguém presente.</summary>
    async Task<TurnEntry?> NextEntryAsync(GameSession s, List<TurnEntry> order, CancellationToken ct)
    {
        var since = Now - TableRules.OnlineWindow;
        var online = (await db.SessionParticipants.Where(p => p.SessionId == s.Id && !p.IsMaster && p.CharacterId != null && p.LastSeenAt >= since)
            .Select(p => p.CharacterId!.Value).ToListAsync(ct)).ToHashSet();
        var tokens = (await db.SessionTokens.Where(t => t.SessionId == s.Id).Select(t => t.Id).ToListAsync(ct)).ToHashSet();
        var current = s.ActiveTurnKey ?? (s.LastActiveCharacterId is { } last ? "c:" + last : null);
        return TurnOrders.Next(order, current, e =>
            TurnOrders.CharacterOf(e.Key) is { } c ? online.Contains(c) :
            TurnOrders.TokenOf(e.Key) is { } t ? tokens.Contains(t) :
            e.Members.Any(online.Contains));
    }

    static void RequireNotPaused(Access a)
    {
        if (a.Session.PausedAt != null && !a.IsMaster) throw new RuleException(409, "A partida está pausada. Aguarde o mestre retomar.");
    }

    public async Task SetTurnOrderAsync(Guid sessionId, TurnOrderInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var characters = await db.SessionParticipants.Where(p => p.SessionId == sessionId && !p.IsMaster && p.CharacterId != null)
            .Join(db.Characters, p => p.CharacterId, c => c.Id, (p, c) => new { c.Id, c.Name }).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var tokens = await db.SessionTokens.Where(t => t.SessionId == sessionId && t.CharacterId == null).ToDictionaryAsync(t => t.Id, t => t.Label, ct);
        var entries = TurnOrders.Validate(x.Entries, characters, tokens, x.SortByInitiative);
        a.Session.TurnOrder = TurnOrders.Serialize(entries);
        if (a.Session.ActiveTurnKey != null && !entries.Any(e => e.Key == a.Session.ActiveTurnKey)) { a.Session.ActiveTurnKey = null; a.Session.ActiveCharacterId = null; }
        // Criaturas ocultas não revelam o nome pela ordem pública.
        var hidden = (await db.SessionTokens.Where(t => t.SessionId == sessionId && t.Hidden).Select(t => t.Id).ToListAsync(ct)).ToHashSet();
        var visible = entries.Select(e => TurnOrders.TokenOf(e.Key) is { } t && hidden.Contains(t) ? "Mestre" : e.Label);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Turn, entries.Count == 0 ? "Mestre voltou à ordem de entrada na mesa" : $"Ordem de turnos: {string.Join(", ", visible)}", new { order = true });
        await CommitAsync(tx, a.Session, ct);
    }

    // ---------- Pausa ----------
    public async Task PauseAsync(Guid sessionId, PauseInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        if ((a.Session.PausedAt != null) == x.Paused) { await tx.RollbackAsync(ct); return; }
        a.Session.PausedAt = x.Paused ? Now : null;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Pause, x.Paused ? "O mestre pausou a partida" : "A partida foi retomada", new { paused = x.Paused });
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>
    /// Pausa as sessões ativas sem ninguém presente há <see cref="TableRules.EmptyTableGrace"/> (chamado pelo <see cref="EmptyTableWorker"/>).
    /// Mesma escrita da pausa manual: bloqueio da sessão, reconferência no banco, evento e revisão. A sessão continua a única ativa;
    /// o mestre retoma ao voltar. Não altera o prazo de recuperação nem o limite das one-shots.
    /// </summary>
    public async Task<int> PauseEmptyAsync(CancellationToken ct)
    {
        var cutoff = Now - TableRules.EmptyTableGrace;
        var ids = await db.Sessions.AsNoTracking()
            .Where(s => s.EndedAt == null && s.PausedAt == null && s.StartedAt <= cutoff && !db.SessionParticipants.Any(p => p.SessionId == s.Id && p.LastSeenAt >= cutoff))
            .OrderBy(s => s.StartedAt).Select(s => s.Id).Take(100).ToListAsync(ct);
        var paused = 0;
        foreach (var id in ids)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var query = db.Database.IsNpgsql()
                ? db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"Id\" = {id} FOR UPDATE")
                : db.Sessions.Where(x => x.Id == id);
            var s = await query.SingleOrDefaultAsync(ct);
            cutoff = Now - TableRules.EmptyTableGrace;
            // Alguém pode ter entrado, pausado ou encerrado entre a consulta e o bloqueio.
            if (s == null || s.EndedAt != null || s.PausedAt != null || await db.SessionParticipants.AnyAsync(p => p.SessionId == id && p.LastSeenAt >= cutoff, ct))
            {
                await tx.RollbackAsync(ct); db.ChangeTracker.Clear(); continue;
            }
            // O evento precisa de um autor real: fica em nome do dono da campanha, assinado como "Mesa".
            var owner = await db.Campaigns.Where(c => c.Id == s.CampaignId).Select(c => c.OwnerId).SingleAsync(ct);
            s.PausedAt = Now;
            Event(s, owner, "Mesa", EventKinds.Pause, "Partida pausada automaticamente: não há ninguém na mesa", new { paused = true, automatic = true });
            await CommitAsync(tx, s, ct);
            db.ChangeTracker.Clear();
            paused++;
        }
        return paused;
    }

    // ---------- Rolagens ----------
    /// <summary>
    /// Rolagem livre: construtor visual (<see cref="DiceSpec"/>) ou fórmula avançada. Só o mestre escolhe quem vê
    /// (mesa, só ele ou ele e jogadores escolhidos); a rolagem de jogador segue a configuração da mesa e ignora o que o cliente enviar.
    /// </summary>
    public async Task<object> RollAsync(Guid sessionId, SessionRollInput x, string user, CancellationToken ct)
    {
        var label = Trim(x.Label, 60, "A descrição da rolagem aceita até 60 caracteres.", false);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); var me = await RequireJoinedAsync(a, user, ct);
        RequireNotPaused(a);
        string visibility;
        List<string> recipients = [];
        if (a.IsMaster)
        {
            visibility = RollVisibility.Normalize(x.Visibility);
            // "Jogador e mestre" numa rolagem do próprio mestre equivale a só ele.
            if (visibility == RollVisibility.Master) visibility = RollVisibility.Blind;
            if (visibility == RollVisibility.Group) recipients = await RecipientsAsync(a.Session.Id, x.Recipients, ct);
        }
        else visibility = (await Fog.SettingsAsync(a.Campaign, a.Session, ct)).PlayerRollVisibility;
        var who = await ActorAsync(me, user, ct);
        var (roll, notation, total) = await RollAnyAsync(me.IsMaster ? null : me.CharacterId, x.Spec, x.Formula, ct);
        RecordRoll(a.Session, user, await NameAsync(user, ct), who, label, roll, notation, total, visibility, a.IsMaster, null, recipients);
        await CommitAsync(tx, a.Session, ct);
        // Rolagem "somente mestre": quem rolou não recebe o resultado nem na resposta.
        return visibility == RollVisibility.Blind && !a.IsMaster ? new { hidden = true, visibility } : new { hidden = false, visibility, roll, total };
    }

    async Task<(object Roll, string Notation, double Total)> RollAnyAsync(Guid? characterId, DiceSpec? spec, string? formula, CancellationToken ct)
    {
        if (spec != null)
        {
            var r = DiceRoller.Roll(spec);
            return (new { formula = r.Notation, values = r.Values, kept = r.Kept, modifier = r.Modifier, total = r.Total, successes = r.Successes, outcome = r.Outcome, capped = r.Capped }, r.Notation, r.Total);
        }
        var text = Trim(formula, TableRules.MaxActionFormula, "Monte a rolagem ou escreva uma fórmula com até 300 caracteres.");
        if (TableRules.IsLegacyFormula(text)) { var d = Dice.Roll(text); return (d, d.Formula, d.Total); }
        IReadOnlyDictionary<string, double> scope = new Dictionary<string, double>();
        if (characterId is { } id && await db.Characters.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct) is { } character)
        {
            var sheet = await CharacterSheets.LoadAsync(db, character, ct);
            scope = SheetCalculator.Scope(sheet.Version.Fields, CharacterSheets.All(sheet.Version.Fields, sheet.Stored));
        }
        var rolled = CharacterSheets.Roll(text, scope);
        return rolled switch
        {
            DiceResult d => (d, d.Formula, d.Total),
            ActionRoll ar => (ar, ar.Formula, ar.Total),
            _ => throw new RuleException(400, "Fórmula inválida."),
        };
    }

    /// <summary>Destinatários de uma rolagem em grupo: personagens desta sessão (fora o mestre), de 1 a <see cref="RollVisibility.MaxRecipients"/>.</summary>
    async Task<List<string>> RecipientsAsync(Guid sessionId, List<Guid>? characterIds, CancellationToken ct)
    {
        var ids = (characterIds ?? []).Distinct().ToList();
        if (ids.Count is < 1 or > RollVisibility.MaxRecipients) throw new RuleException(400, $"Escolha de 1 a {RollVisibility.MaxRecipients} jogadores para ver a rolagem.");
        var users = await db.SessionParticipants.Where(p => p.SessionId == sessionId && !p.IsMaster && p.CharacterId != null && ids.Contains(p.CharacterId!.Value))
            .Select(p => p.UserId).Distinct().ToListAsync(ct);
        if (users.Count == 0 || await db.SessionParticipants.CountAsync(p => p.SessionId == sessionId && !p.IsMaster && p.CharacterId != null && ids.Contains(p.CharacterId!.Value), ct) != ids.Count)
            throw new RuleException(400, "Escolha jogadores que estão nesta sessão.");
        return users;
    }

    void RecordRoll(GameSession s, string user, string author, string actor, string label, object roll, string notation, double total, string visibility, bool master, object? request, List<string>? recipients = null)
    {
        var text = $"{actor} rolou {(label.Length > 0 ? label + ": " : "")}{notation} = {Formula.Format(total)}";
        var data = new { roll, label, actor, visibility, request };
        if (visibility == RollVisibility.Table) { Event(s, user, author, EventKinds.Roll, text, data); return; }
        if (visibility == RollVisibility.Group)
        {
            // Original só para o mestre; cada destinatário recebe uma cópia privada (o mestre não vê as cópias).
            Event(s, user, author, EventKinds.Roll, text, data, masterOnly: true);
            foreach (var to in recipients ?? []) Event(s, user, author, EventKinds.Roll, text, data, masterOnly: true, visibleTo: to, recipientCopy: true);
            return;
        }
        if (visibility == RollVisibility.Master) { Event(s, user, author, EventKinds.Roll, text, data, masterOnly: true, visibleTo: master ? null : user); return; }
        Event(s, user, author, EventKinds.Roll, text, data, masterOnly: true);
        // Aviso sem resultado para quem rolou às cegas.
        if (!master) Event(s, user, author, EventKinds.Roll, $"{actor} enviou uma rolagem secreta ao mestre{(label.Length > 0 ? ": " + label : "")}", new { label, actor, visibility, secret = true, request }, masterOnly: true, visibleTo: user);
    }

    // ---------- Pedidos de teste ----------
    public async Task<object> CreateRollRequestAsync(Guid sessionId, RollRequestInput x, string user, CancellationToken ct)
    {
        var label = Trim(x.Label, 80, "Dê um nome de até 80 caracteres ao teste.");
        var visibility = RollVisibility.Normalize(x.Visibility);
        if (!RollVisibility.IsPlayerChoice(visibility)) throw new RuleException(400, "Pedidos de teste: escolha mesa inteira, quem rolou e o mestre, ou somente o mestre.");
        var criterion = DiceRoller.ValidateCriterion(x.Target, x.Rule);
        string formula = ""; string? spec = null;
        if (x.Spec != null) spec = RollRequest.SerializeSpec(DiceRoller.Validate(x.Spec));
        else
        {
            formula = Trim(x.Formula, TableRules.MaxActionFormula, "Escolha os dados ou escreva a fórmula do teste.");
            var check = Formula.Validate(formula, FormulaMode.Roll);
            if (!check.Ok && !TableRules.IsLegacyFormula(formula)) throw new RuleException(400, check.Error ?? "Fórmula inválida.");
        }
        var ids = (x.CharacterIds ?? []).Distinct().ToList();
        if (ids.Count is < 1 or > MaxRequestTargets) throw new RuleException(400, $"Escolha de 1 a {MaxRequestTargets} personagens.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        if (await db.RollRequests.CountAsync(r => r.SessionId == sessionId && r.CancelledAt == null && r.ClosedAt == null, ct) >= MaxOpenRequests)
            throw new RuleException(409, $"Há {MaxOpenRequests} pedidos abertos. Aguarde respostas ou cancele um pedido.");
        var targets = await db.SessionParticipants.Where(p => p.SessionId == sessionId && !p.IsMaster && p.CharacterId != null && ids.Contains(p.CharacterId!.Value))
            .Join(db.Characters, p => p.CharacterId, c => c.Id, (p, c) => new RollRequestTarget { CharacterId = c.Id, UserId = p.UserId, Name = c.Name }).ToListAsync(ct);
        if (targets.Count != ids.Count) throw new RuleException(400, "Escolha personagens que estão nesta sessão.");
        var request = new RollRequest { SessionId = sessionId, Label = label, Formula = formula, Spec = spec, Visibility = visibility, Target = criterion?.Target, Rule = criterion?.Rule, Targets = targets, CreatedAt = Now };
        db.RollRequests.Add(request);
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Request, $"Mestre pediu um teste: {label} — {string.Join(", ", targets.Select(t => t.Name))}",
            new { requestId = request.Id, label, characters = targets.Select(t => t.CharacterId), visibility });
        await CommitAsync(tx, a.Session, ct);
        return new { request.Id };
    }

    public async Task<object> RespondRollRequestAsync(Guid sessionId, Guid requestId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        if (a.IsMaster) throw new RuleException(409, "Os personagens convidados respondem ao pedido.");
        var me = await RequireJoinedAsync(a, user, ct);
        RequireNotPaused(a);
        var request = await db.RollRequests.SingleOrDefaultAsync(r => r.Id == requestId && r.SessionId == sessionId, ct) ?? throw new RuleException(404, "Pedido de teste não encontrado.");
        if (request.CancelledAt != null) throw new RuleException(409, "O mestre cancelou este pedido.");
        var target = request.Targets.FirstOrDefault(t => t.CharacterId == me.CharacterId && t.UserId == user) ?? throw new RuleException(404, "Pedido de teste não encontrado.");
        if (target.RespondedAt != null) throw new RuleException(409, "Você já respondeu a este pedido.");
        var (roll, notation, total) = await RollAnyAsync(me.CharacterId, request.ParsedSpec(), request.Spec == null ? request.Formula : null, ct);
        var criterion = request.Target is { } t2 && request.Rule != null ? new RollCriterion(t2, request.Rule) : null;
        target.RespondedAt = Now; target.Total = total; target.Detail = notation.Length > 300 ? notation[..300] : notation;
        target.Outcome = criterion == null ? null : DiceRoller.Judge(total, criterion);
        if (request.Targets.All(t => t.RespondedAt != null)) request.ClosedAt = Now;
        db.Entry(request).State = EntityState.Modified;
        RecordRoll(a.Session, user, await NameAsync(user, ct), target.Name, request.Label, roll, notation, total, request.Visibility, false,
            new { id = request.Id, outcome = request.Visibility == RollVisibility.Table ? target.Outcome : null });
        await CommitAsync(tx, a.Session, ct);
        return request.Visibility == RollVisibility.Blind ? new { hidden = true } : new { hidden = false, total, outcome = target.Outcome, roll };
    }

    public async Task CancelRollRequestAsync(Guid sessionId, Guid requestId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var request = await db.RollRequests.SingleOrDefaultAsync(r => r.Id == requestId && r.SessionId == sessionId, ct) ?? throw new RuleException(404, "Pedido de teste não encontrado.");
        if (request.CancelledAt != null || request.ClosedAt != null) { await tx.RollbackAsync(ct); return; }
        request.CancelledAt = Now;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Request, $"Mestre cancelou o teste: {request.Label}", new { requestId, cancelled = true });
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Mestre: pedidos recentes com respostas. Jogador: só os abertos que o envolvem, sem resultados às cegas.</summary>
    async Task<object> RollRequestsViewAsync(GameSession s, string user, bool master, Guid? myCharacter, CancellationToken ct)
    {
        var recent = Now.AddMinutes(-15);
        var rows = await db.RollRequests.AsNoTracking().Where(r => r.SessionId == s.Id && r.CancelledAt == null && (r.ClosedAt == null || r.ClosedAt > recent))
            .OrderByDescending(r => r.CreatedAt).Take(10).ToListAsync(ct);
        string Notation(RollRequest r) => r.ParsedSpec() is { } sp ? DiceRoller.Notation(sp) : r.Formula;
        if (master)
            return rows.Select(r => new
            {
                r.Id, r.Label, notation = Notation(r), r.Visibility, r.Target, r.Rule, r.CreatedAt, closed = r.ClosedAt != null,
                targets = r.Targets.Select(t => new { t.CharacterId, t.Name, responded = t.RespondedAt != null, t.Total, t.Outcome, t.Detail })
            }).ToList();
        return rows.Where(r => r.ClosedAt == null && r.Targets.Any(t => t.UserId == user && t.CharacterId == myCharacter)).Select(r =>
        {
            var t = r.Targets.First(t => t.UserId == user && t.CharacterId == myCharacter);
            var shown = r.Visibility != RollVisibility.Blind && t.RespondedAt != null;
            return (object)new { r.Id, r.Label, notation = Notation(r), r.Visibility, responded = t.RespondedAt != null, total = shown ? t.Total : null, outcome = shown ? t.Outcome : null };
        }).ToList();
    }

    // ---------- Recursos e condições ----------
    public async Task<object> AdjustResourceAsync(Guid sessionId, Guid characterId, SheetResourceInput x, string user, CancellationToken ct)
    {
        var reason = Trim(x.Reason, 120, "O motivo aceita até 120 caracteres.", false);
        if (x.Delta is 0 or < -100000 or > 100000) throw new RuleException(400, "Informe um ajuste diferente de zero.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var (character, sheet) = await EditableInSessionAsync(a, characterId, user, ct);
        var field = SheetSummary.ResourceField(sheet.Version.Fields, x.Field) ?? throw new RuleException(404, "Esse recurso não existe na ficha.");
        var result = await SetResourceAsync(a, character, sheet, field, current => current + x.Delta, user, reason, null, ct);
        if (result == null) { await tx.RollbackAsync(ct); return await ResourceStateAsync(character, ct); }
        await CommitAsync(tx, a.Session, ct);
        return await ResourceStateAsync(character, ct);
    }

    async Task<object> ResourceStateAsync(Character c, CancellationToken ct)
    {
        var sheet = await CharacterSheets.LoadAsync(db, c, ct);
        var (resources, _) = SheetSummary.Build(sheet.Version.Fields, CharacterSheets.All(sheet.Version.Fields, sheet.Stored));
        return new { c.Hp, c.MaxHp, resources };
    }

    async Task<(Character Character, SheetContext Sheet)> EditableInSessionAsync(Access a, Guid characterId, string user, CancellationToken ct)
    {
        if (!await db.SessionParticipants.AnyAsync(p => p.SessionId == a.Session.Id && p.CharacterId == characterId, ct)) throw new RuleException(404, "Ficha não encontrada.");
        var character = await db.Characters.SingleAsync(c => c.Id == characterId, ct);
        if (!a.IsMaster && character.OwnerId != user) throw new RuleException(403, "Somente o mestre e o dono podem alterar a ficha.");
        return (character, await CharacterSheets.LoadAsync(db, character, ct));
    }

    /// <summary>Grava um recurso dentro dos limites (mínimo e teto do modelo), com histórico por campo e evento desfazível. Nulo = sem mudança.</summary>
    async Task<(double Before, double After)?> SetResourceAsync(Access a, Character character, SheetContext sheet, SheetField field, Func<double, double> change, string user, string reason, long? undoOf, CancellationToken ct)
    {
        var all = CharacterSheets.All(sheet.Version.Fields, sheet.Stored);
        static double Num(IReadOnlyDictionary<string, string> v, string? k) => k != null && v.TryGetValue(k, out var s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
        var before = Num(all, field.Name);
        var maxField = field.MaxField ?? (field.Role == SheetFieldRoles.Hp ? sheet.Version.Fields.FirstOrDefault(f => f.Role == SheetFieldRoles.MaxHp)?.Name : null);
        double? max = maxField != null && all.ContainsKey(maxField) ? Num(all, maxField) : field.Max;
        var after = Math.Max(field.Min ?? 0, change(before));
        if (max is { } m) after = Math.Min(m, after);
        after = Math.Round(after);
        if (after == before) return null;
        var values = new Dictionary<string, string>(sheet.Stored, StringComparer.Ordinal) { [field.Name] = Formula.Format(after) };
        CharacterSheets.Commit(db, character, sheet, values, user, a.IsMaster ? FieldChangeSources.Master : FieldChangeSources.Table, a.Session.Id, Now);
        character.Revision++; character.UpdatedAt = Now;
        db.Versions.Add(new() { CharacterId = character.Id, Revision = character.Revision, Snapshot = JsonSerializer.Serialize(character), ChangedById = user, SessionId = a.Session.Id, CreatedAt = Now });
        var label = string.IsNullOrWhiteSpace(field.Label) ? field.Name : field.Label;
        // Vida mantém a redação de sempre no histórico; demais recursos mostram antes → depois.
        var text = undoOf != null ? $"{character.Name}: {label} voltou a {Formula.Format(after)} (desfeito)"
            : field.Role == SheetFieldRoles.Hp ? (after < before ? $"{character.Name} sofreu {Formula.Format(before - after)} pontos de dano" : $"{character.Name} recuperou {Formula.Format(after - before)} pontos de vida")
            : $"{character.Name}: {label} {Formula.Format(before)} → {Formula.Format(after)}";
        // Vida mantém o formato anterior em "changes" (campo "hp", rótulo "Vida") para histórico e clientes existentes.
        var changes = new[] { field.Role == SheetFieldRoles.Hp
            ? new SheetChange("hp", "Vida", Formula.Format(before), Formula.Format(after))
            : new SheetChange(field.Name, label, Formula.Format(before), Formula.Format(after)) };
        if (undoOf is { } id) Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet, text, new { undoOf = id, characterId = character.Id, field = field.Name, before, after, changes, reason }, masterOnly: true, visibleTo: character.OwnerId);
        else Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet, text, new { characterId = character.Id, field = field.Name, before, after, changes, reason, undoable = true }, masterOnly: true, visibleTo: character.OwnerId);
        return (before, after);
    }

    public async Task SetConditionsAsync(Guid sessionId, Guid characterId, ConditionsInput x, string user, CancellationToken ct)
    {
        var text = Trim(x.Conditions, 300, "Condições e nota curta aceitam até 300 caracteres.", false);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var (character, _) = await EditableInSessionAsync(a, characterId, user, ct);
        if (character.Conditions == text) { await tx.RollbackAsync(ct); return; }
        character.Conditions = text; character.UpdatedAt = Now;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet, text.Length == 0 ? $"{character.Name} está sem condições" : $"{character.Name}: {text}",
            new { characterId, conditions = text }, masterOnly: true, visibleTo: character.OwnerId);
        await CommitAsync(tx, a.Session, ct);
    }

    // ---------- Desfazer ----------
    /// <summary>
    /// Desfaz movimento ou ajuste de recurso: revalida permissão e estado atual, nunca apaga o evento original e
    /// recusa quando houve mudança concorrente. Rolagens não são desfeitas.
    /// </summary>
    public async Task UndoAsync(Guid sessionId, UndoInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var me = await RequireJoinedAsync(a, user, ct);
        var e = await db.Events.AsNoTracking().SingleOrDefaultAsync(v => v.Id == x.EventId && v.SessionId == sessionId, ct) ?? throw new RuleException(404, "Registro não encontrado.");
        if (e.Kind is EventKinds.Roll or EventKinds.Action) throw new RuleException(400, "Rolagens não podem ser desfeitas: o resultado fica registrado.");
        if (!a.IsMaster && e.UserId != user) throw new RuleException(403, "Você só desfaz as próprias alterações.");
        if (!a.IsMaster) RequireNotPaused(a);
        using var doc = JsonDocument.Parse(string.IsNullOrEmpty(e.Data) ? "{}" : e.Data);
        var d = doc.RootElement;
        if (!d.TryGetProperty("undoable", out var flag) || flag.ValueKind != JsonValueKind.True) throw new RuleException(400, "Esta alteração não pode ser desfeita.");
        var marker = $"\"undoOf\":{e.Id},";
        if (await db.Events.AnyAsync(v => v.SessionId == sessionId && v.Data.Contains(marker), ct)) throw new RuleException(409, "Essa alteração já foi desfeita.");
        var author = await NameAsync(user, ct);
        if (e.Kind == EventKinds.Move)
        {
            var tokenId = d.GetProperty("tokenId").GetGuid();
            int fx = d.GetProperty("from").GetProperty("x").GetInt32(), fy = d.GetProperty("from").GetProperty("y").GetInt32();
            int tx2 = d.GetProperty("to").GetProperty("x").GetInt32(), ty = d.GetProperty("to").GetProperty("y").GetInt32();
            var scene = await RequireSceneAsync(a, ct);
            var token = scene.Raw.GetValueOrDefault(tokenId) ?? throw new RuleException(409, "O marcador não está mais no mapa.");
            if (!a.IsMaster && token.CharacterId != me.CharacterId) throw new RuleException(403, "Você só desfaz o movimento do próprio personagem.");
            // Movimentação livre: a posição fina também precisa coincidir e volta junto; marcadores podem dividir a casa.
            var free = scene.Map.Free;
            int? Fine(string point, string axis) => free && d.GetProperty(point).TryGetProperty(axis, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;
            var (fromFx, fromFy, toFx, toFy) = (Fine("from", "fx"), Fine("from", "fy"), Fine("to", "fx"), Fine("to", "fy"));
            if (token.X != tx2 || token.Y != ty || (free && (token.Fx != toFx || token.Fy != toFy)))
                throw new RuleException(409, "O marcador já mudou de lugar; desfazer não sobrescreve a mudança mais recente.");
            if (!scene.Grid.Inside(fx, fy) || scene.Grid.BlocksMove(fx, fy) || (!free && scene.Raw.Values.Any(t => t.Id != tokenId && t.X == fx && t.Y == fy)))
                throw new RuleException(409, "A posição anterior está ocupada ou bloqueada agora.");
            token.X = fx; token.Y = fy; token.Fx = fromFx; token.Fy = fromFy;
            if (d.TryGetProperty("movedTurn", out var mt) && mt.ValueKind == JsonValueKind.Number && PlayModes.LimitsMovement(a.Session.PlayMode)) token.LastMovedTurn = mt.GetInt32();
            Event(a.Session, user, author, EventKinds.Move, $"{token.Label} voltou à posição anterior (desfeito)", new { undoOf = e.Id, tokenId, from = new { x = tx2, y = ty, fx = toFx, fy = toFy }, to = new { x = fx, y = fy, fx = fromFx, fy = fromFy } }, masterOnly: e.MasterOnly);
            await RefreshFogAsync(a, user, ct);
        }
        else if (e.Kind == EventKinds.Sheet)
        {
            var characterId = d.GetProperty("characterId").GetGuid();
            var fieldName = d.GetProperty("field").GetString() ?? "";
            var expected = d.GetProperty("after").GetDouble(); var restore = d.GetProperty("before").GetDouble();
            var (character, sheet) = await EditableInSessionAsync(a, characterId, user, ct);
            var field = SheetSummary.ResourceField(sheet.Version.Fields, fieldName) ?? throw new RuleException(409, "Esse recurso não existe mais na ficha.");
            var all = CharacterSheets.All(sheet.Version.Fields, sheet.Stored);
            var current = all.TryGetValue(field.Name, out var v) && double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : 0;
            if (current != expected) throw new RuleException(409, "O valor mudou depois; desfazer não sobrescreve a alteração mais recente.");
            if (await SetResourceAsync(a, character, sheet, field, _ => restore, user, "", e.Id, ct) == null) throw new RuleException(409, "Nada a desfazer: o valor já é o anterior.");
        }
        else throw new RuleException(400, "Esta alteração não pode ser desfeita.");
        await CommitAsync(tx, a.Session, ct);
    }
}
