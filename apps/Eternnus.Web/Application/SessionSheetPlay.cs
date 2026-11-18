using System.Globalization;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record EffectsInput(List<CharacterEffect?>? Effects);
/// <summary>Usar um item da ficha (ADR-099): rótulo do item, fórmula opcional e custo opcional num recurso da ficha.</summary>
public record UseItemInput(string? Item, string? Formula, string? Field, int? Cost, string? Visibility = null);

/// <summary>
/// Ficha em jogo (ADR-099): condições com duração, rolagem a partir de um campo e uso de magia/poder/item.
/// Mesmo caminho das demais escritas da mesa: bloqueio da sessão → conferência no banco → evento → revisão → sinal.
/// </summary>
public partial class SessionService
{
    public async Task SetEffectsAsync(Guid sessionId, Guid characterId, EffectsInput x, string user, CancellationToken ct)
    {
        var effects = CharacterEffects.Validate(x.Effects);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var (character, _) = await EditableInSessionAsync(a, characterId, user, ct);
        var json = CharacterEffects.Serialize(effects);
        if (character.Effects == json) { await tx.RollbackAsync(ct); return; }
        character.Effects = json; character.UpdatedAt = Now;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Sheet,
            effects.Count == 0 ? $"{character.Name} está sem condições com duração" : $"{character.Name}: {CharacterEffects.Describe(effects)}",
            new { characterId, effects }, masterOnly: true, visibleTo: character.OwnerId);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>
    /// O turno chegou a estes personagens: cada condição com prazo perde uma rodada; as que chegam a zero saem
    /// e ficam no registro (mestre e dono). Chamado dentro da transação do turno, antes do commit.
    /// </summary>
    async Task TickEffectsAsync(GameSession s, IEnumerable<Guid?> characterIds, string user, CancellationToken ct)
    {
        var ids = characterIds.Where(i => i != null).Select(i => i!.Value).Distinct().ToList();
        if (ids.Count == 0) return;
        var characters = await db.Characters.Where(c => ids.Contains(c.Id) && c.Effects != "[]" && c.Effects != "").ToListAsync(ct);
        foreach (var c in characters)
        {
            var (remaining, expired) = CharacterEffects.Tick(CharacterEffects.Parse(c.Effects));
            var json = CharacterEffects.Serialize(remaining);
            if (json == c.Effects) continue;
            c.Effects = json; c.UpdatedAt = Now;
            if (expired.Count > 0)
                Event(s, user, await NameAsync(user, ct), EventKinds.Sheet, $"{c.Name}: terminou {string.Join(", ", expired.Select(e => e.Name))}",
                    new { characterId = c.Id, effects = remaining, expired = expired.Select(e => e.Name) }, masterOnly: true, visibleTo: c.OwnerId);
        }
    }

    /// <summary>Personagens que agem na entrada ativa: o personagem da vez e os membros de um grupo.</summary>
    static IEnumerable<Guid?> ActiveCharacters(GameSession s) =>
        new[] { s.ActiveCharacterId }.Concat((ActiveEntry(s)?.Members ?? []).Select(m => (Guid?)m));

    /// <summary>
    /// Ficha usada como escopo de @campos numa rolagem: o personagem do jogador ou, para o mestre, qualquer ficha da sessão.
    /// O mestre sem ficha escolhida rola sem escopo (como antes).
    /// </summary>
    async Task<Guid?> RollScopeAsync(Access a, SessionParticipant me, Guid? requested, string user, CancellationToken ct)
    {
        if (requested is not { } id) return me.IsMaster ? null : me.CharacterId;
        if (!await db.SessionParticipants.AnyAsync(p => p.SessionId == a.Session.Id && p.CharacterId == id, ct)) throw new RuleException(404, "Ficha não encontrada.");
        if (a.IsMaster) return id;
        if (me.CharacterId != id || !await db.Characters.AnyAsync(c => c.Id == id && c.OwnerId == user, ct))
            throw new RuleException(403, "Você só rola com a própria ficha.");
        return id;
    }

    /// <summary>
    /// Usa um item da ficha: confere o recurso (sem saldo → 409), desconta o custo e rola a fórmula com a ficha como escopo,
    /// tudo numa transação e num registro só. Visibilidade da rolagem segue a regra de <see cref="RollAsync"/>.
    /// </summary>
    public async Task<object> UseItemAsync(Guid sessionId, Guid characterId, UseItemInput x, string user, CancellationToken ct)
    {
        var item = string.Join(' ', (x.Item ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (item.Length is < 1 or > CharacterItemNotes.MaxKey) throw new RuleException(400, "Informe o item usado (até 200 caracteres).");
        var label = item.Length > 60 ? item[..59] + "…" : item;
        var formula = string.IsNullOrWhiteSpace(x.Formula) ? null : x.Formula.Trim();
        var field = string.IsNullOrWhiteSpace(x.Field) ? null : x.Field.Trim();
        if (field == null && x.Cost != null) throw new RuleException(400, "Escolha o recurso que paga o custo.");
        if (field != null && x.Cost is not (>= 1 and <= 1000)) throw new RuleException(400, "O custo vai de 1 a 1.000.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct);
        var me = await RequireJoinedAsync(a, user, ct);
        RequireNotPaused(a);
        var (character, sheet) = await EditableInSessionAsync(a, characterId, user, ct);
        var who = character.Name;
        string spent = "";
        if (field != null)
        {
            // Recurso marcado no modelo ou qualquer campo numérico editável (PM, mana…): dono e mestre já o editam pela ficha.
            var resource = SheetSummary.ResourceField(sheet.Version.Fields, field)
                ?? sheet.Version.Fields.FirstOrDefault(f => f.Name == field && f.Type == SheetFieldTypes.Number)
                ?? throw new RuleException(404, "Esse recurso não existe na ficha.");
            var all = CharacterSheets.All(sheet.Version.Fields, sheet.Stored);
            var current = all.TryGetValue(resource.Name, out var raw) && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
            var cost = x.Cost!.Value;
            var name = string.IsNullOrWhiteSpace(resource.Label) ? resource.Name : resource.Label;
            if (current - cost < (resource.Min ?? 0)) throw new RuleException(409, $"{name} insuficiente: {Formula.Format(current)} disponível, custo {cost}.");
            await SetResourceAsync(a, character, sheet, resource, v => v - cost, user, $"Usou {label}", null, ct);
            spent = $" (−{cost} {name})";
        }
        object? roll = null; double? total = null; var visibility = RollVisibility.Table; var hidden = false;
        if (formula != null)
        {
            if (a.IsMaster)
            {
                visibility = RollVisibility.Normalize(x.Visibility);
                if (visibility is RollVisibility.Master or RollVisibility.Group) visibility = visibility == RollVisibility.Master ? RollVisibility.Blind : RollVisibility.Table;
            }
            else visibility = (await Fog.SettingsAsync(a.Campaign, a.Session, ct)).PlayerRollVisibility;
            var (r, notation, t) = await RollAnyAsync(character.Id, null, formula, ct);
            RecordRoll(a.Session, user, await NameAsync(user, ct), who, label + spent, r, notation, t, visibility, a.IsMaster, null);
            hidden = visibility == RollVisibility.Blind && !a.IsMaster;
            if (!hidden) { roll = r; total = t; }
        }
        else Event(a.Session, user, await NameAsync(user, ct), EventKinds.Action, $"{who} usou {label}{spent}", new { characterId, item = label, actor = who });
        await CommitAsync(tx, a.Session, ct);
        return new { hidden, visibility, roll, total, resources = (await ResourceStateAsync(character, ct)) };
    }
}
