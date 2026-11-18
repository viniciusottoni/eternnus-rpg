using System.Text.Json;
namespace Eternnus.Web;

/// <summary>Condição temporária da ficha (ADR-099): nome curto e rodadas restantes. Sem rodadas = até alguém remover.</summary>
public sealed record CharacterEffect(string Name, int? Rounds);

/// <summary>
/// Condições com duração guardadas em <see cref="Character.Effects"/> (JSON). Validação e contagem puras:
/// a mesa desconta uma rodada quando o turno chega ao personagem e remove a condição ao chegar a zero.
/// </summary>
public static class CharacterEffects
{
    public const int MaxEffects = 12, MaxName = 40, MaxRounds = 99, MaxJson = 2000;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static List<CharacterEffect> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return (JsonSerializer.Deserialize<List<CharacterEffect>>(json, Json) ?? []).Where(e => !string.IsNullOrWhiteSpace(e?.Name)).ToList(); }
        catch (JsonException) { return []; }
    }

    public static string Serialize(IReadOnlyList<CharacterEffect> effects) => effects.Count == 0 ? "[]" : JsonSerializer.Serialize(effects, Json);

    /// <summary>Normaliza a lista enviada: nome sem espaços extras (1–40), rodadas 1–99 ou nula, até 12, sem nomes repetidos.</summary>
    public static List<CharacterEffect> Validate(IEnumerable<CharacterEffect?>? input)
    {
        var list = new List<CharacterEffect>();
        foreach (var e in input ?? [])
        {
            var name = string.Join(' ', (e?.Name ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            if (name.Length == 0) continue;
            if (name.Length > MaxName) throw new RuleException(400, $"O nome da condição aceita até {MaxName} caracteres.");
            if (e!.Rounds is { } r && (r < 1 || r > MaxRounds)) throw new RuleException(400, $"A duração vai de 1 a {MaxRounds} rodadas (vazio = sem prazo).");
            if (list.Any(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))) throw new RuleException(400, $"A condição “{name}” está repetida.");
            list.Add(new(name, e.Rounds));
        }
        if (list.Count > MaxEffects) throw new RuleException(400, $"Cada ficha acompanha até {MaxEffects} condições.");
        return list;
    }

    /// <summary>Uma rodada passa para o personagem: desconta as condições com prazo e separa as que terminaram.</summary>
    public static (List<CharacterEffect> Remaining, List<CharacterEffect> Expired) Tick(IReadOnlyList<CharacterEffect> effects)
    {
        var remaining = new List<CharacterEffect>(); var expired = new List<CharacterEffect>();
        foreach (var e in effects)
        {
            if (e.Rounds is not { } r) { remaining.Add(e); continue; }
            if (r <= 1) expired.Add(e); else remaining.Add(e with { Rounds = r - 1 });
        }
        return (remaining, expired);
    }

    /// <summary>Texto curto para o registro da mesa: "Abalado (2 rodadas), Caído".</summary>
    public static string Describe(IReadOnlyList<CharacterEffect> effects) =>
        string.Join(", ", effects.Select(e => e.Rounds is { } r ? $"{e.Name} ({r} {(r == 1 ? "rodada" : "rodadas")})" : e.Name));
}
