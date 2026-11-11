using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text.Json;
namespace Eternnus.Web;

/// <summary>
/// Formas de condução da mesa. O sistema sugere, a campanha ajusta e a sessão fixa a forma ao começar
/// (<see cref="GameSession.PlayMode"/>); sessões antigas sem valor seguem a forma tática de sempre.
/// </summary>
public static class PlayModes
{
    public const string Free = "free", Turns = "turns", Tactical = "tactical";
    public static readonly string[] All = [Free, Turns, Tactical];
    public static bool IsValid(string? mode) => mode is Free or Turns or Tactical;
    /// <summary>Valor ausente ou desconhecido = tática (compatibilidade com campanhas anteriores).</summary>
    public static string Effective(string? mode) => IsValid(mode) ? mode! : Tactical;
    /// <summary>Livre: ações e movimento sem concessão de turno (ainda exigem ficha própria e permissões).</summary>
    public static bool RequiresTurn(string? mode) => Effective(mode) != Free;
    /// <summary>Somente a tática limita distância, um deslocamento por turno e caminho por casas conhecidas.</summary>
    public static bool LimitsMovement(string? mode) => Effective(mode) == Tactical;
    public static string Label(string? mode) => Effective(mode) switch { Free => "Livre", Turns => "Por turnos", _ => "Tática" };
}

/// <summary>Entrada da ordem de turnos: personagem ("c:{guid}"), marcador do mestre ("t:{guid}") ou grupo ("g:{n}").</summary>
public sealed class TurnEntry
{
    [MaxLength(80)] public string Key { get; set; } = "";
    [MaxLength(40)] public string Label { get; set; } = "";
    public int? Initiative { get; set; }
    /// <summary>Personagens de um grupo: todos agem na vez do grupo.</summary>
    public List<Guid> Members { get; set; } = [];
}

/// <summary>Regras puras da ordem de turnos configurável. Ordem vazia = rotação pela entrada na mesa (comportamento anterior).</summary>
public static class TurnOrders
{
    public const int MaxEntries = 40, MaxGroupMembers = 20;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static List<TurnEntry> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<TurnEntry>>(json, Json) ?? []; } catch (JsonException) { return []; }
    }
    public static string? Serialize(List<TurnEntry> entries) => entries.Count == 0 ? null : JsonSerializer.Serialize(entries, Json);

    public static Guid? CharacterOf(string? key) => key != null && key.StartsWith("c:", StringComparison.Ordinal) && Guid.TryParse(key[2..], out var id) ? id : null;
    public static Guid? TokenOf(string? key) => key != null && key.StartsWith("t:", StringComparison.Ordinal) && Guid.TryParse(key[2..], out var id) ? id : null;

    /// <summary>Normaliza a ordem enviada pelo mestre. Personagens e marcadores precisam existir na sessão; lança 400 com motivo.</summary>
    public static List<TurnEntry> Validate(IReadOnlyList<TurnEntry>? input, IReadOnlyDictionary<Guid, string> characters, IReadOnlyDictionary<Guid, string> tokens, bool sortByInitiative)
    {
        var entries = (input ?? []).ToList();
        if (entries.Count > MaxEntries) throw new RuleException(400, $"A ordem aceita até {MaxEntries} entradas.");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<TurnEntry>();
        var group = 0;
        foreach (var e in entries)
        {
            if (e == null) throw new RuleException(400, "Entrada de turno inválida.");
            if (e.Initiative is < -1000 or > 1000) throw new RuleException(400, "A iniciativa vai de -1.000 a 1.000.");
            var label = (e.Label ?? "").Trim();
            TurnEntry normalized;
            if (CharacterOf(e.Key) is { } c)
            {
                if (!characters.TryGetValue(c, out var name)) throw new RuleException(400, "Um personagem da ordem não está nesta sessão.");
                normalized = new() { Key = "c:" + c, Label = Cut(name), Initiative = e.Initiative };
            }
            else if (TokenOf(e.Key) is { } t)
            {
                if (!tokens.TryGetValue(t, out var name)) throw new RuleException(400, "Um marcador da ordem não está no mapa.");
                normalized = new() { Key = "t:" + t, Label = Cut(label.Length > 0 ? label : name), Initiative = e.Initiative };
            }
            else if (e.Key?.StartsWith("g:", StringComparison.Ordinal) == true)
            {
                if (label.Length is < 1 or > 40) throw new RuleException(400, "Dê um nome de até 40 caracteres ao grupo.");
                var members = (e.Members ?? []).Distinct().ToList();
                if (members.Count > MaxGroupMembers || members.Any(m => !characters.ContainsKey(m))) throw new RuleException(400, "Os integrantes do grupo precisam estar nesta sessão.");
                normalized = new() { Key = "g:" + (++group), Label = label, Initiative = e.Initiative, Members = members };
            }
            else throw new RuleException(400, "Entrada de turno inválida.");
            if (!keys.Add(normalized.Key)) throw new RuleException(400, "Cada personagem ou marcador aparece uma vez na ordem.");
            result.Add(normalized);
        }
        return sortByInitiative ? SortByInitiative(result) : result;
    }

    static string Cut(string s) => s.Length > 40 ? s[..40] : s;

    /// <summary>Maior iniciativa primeiro; sem iniciativa vai ao fim; empate mantém a ordem informada (estável).</summary>
    public static List<TurnEntry> SortByInitiative(IReadOnlyList<TurnEntry> entries) =>
        entries.Select((e, i) => (e, i)).OrderBy(x => x.e.Initiative == null).ThenByDescending(x => x.e.Initiative ?? 0).ThenBy(x => x.i).Select(x => x.e).ToList();

    /// <summary>Próxima entrada disponível depois da atual (reinicia no começo). Nula se nenhuma estiver disponível.</summary>
    public static TurnEntry? Next(IReadOnlyList<TurnEntry> entries, string? currentKey, Func<TurnEntry, bool> available)
    {
        if (entries.Count == 0) return null;
        var start = -1;
        for (var i = 0; i < entries.Count; i++) if (entries[i].Key == currentKey) { start = i; break; }
        for (var step = 1; step <= entries.Count; step++)
        {
            var e = entries[(start + step + entries.Count) % entries.Count];
            if (available(e)) return e;
        }
        return null;
    }

    /// <summary>O personagem age nesta entrada (ele próprio ou integrante do grupo)?</summary>
    public static bool Includes(TurnEntry? entry, Guid? character) =>
        entry != null && character is { } c && (CharacterOf(entry.Key) == c || entry.Members.Contains(c));
}

/// <summary>
/// Quem recebe uma rolagem: mesa inteira, quem rolou e o mestre, somente o mestre (quem rolou não vê o resultado)
/// ou o mestre e jogadores escolhidos por ele. Só o mestre escolhe; rolagens de jogador seguem
/// <see cref="TableSettings.PlayerRollVisibility"/>.
/// </summary>
public static class RollVisibility
{
    public const string Table = "table", Master = "master", Blind = "blind", Group = "group";
    public const int MaxRecipients = 20;
    /// <summary>Valores aceitos na configuração das rolagens de jogador e nos pedidos de teste.</summary>
    public static bool IsPlayerChoice(string? v) => v is Table or Master or Blind;
    public static string Normalize(string? v) => v switch { null or "" => Table, Table or Master or Blind or Group => v, _ => throw new RuleException(400, "Escolha quem vê a rolagem.") };
    public static string Label(string v) => v switch { Master => "jogador e mestre", Blind => "somente o mestre", Group => "mestre e jogadores escolhidos", _ => "mesa inteira" };
}

/// <summary>
/// Rolagem do construtor visual. Mecanismos implementados: soma com modificador, manter/descartar (kh/kl/dh/dl),
/// dados explosivos com teto, contagem de sucessos e teste percentual com comparação explícita.
/// Outras mecânicas ficam com a resolução manual do mestre.
/// </summary>
public sealed record DiceSpec(int Count, int Sides, int Modifier = 0, string? Keep = null, int KeepCount = 0, bool Explode = false,
    int? SuccessAt = null, int? PercentTarget = null, string? PercentRule = null);

/// <summary>Critério opcional de um pedido de teste: total comparado a um alvo. Sem critério, ninguém declara sucesso ou falha.</summary>
public sealed record RollCriterion(int Target, string Rule);

public sealed record DiceSpecResult(string Notation, int[] Values, int[] Kept, int Modifier, int Total, int? Successes, string? Outcome, bool Capped);

public static class DiceRoller
{
    public const int MaxCount = 100, MaxSides = 1000, MaxModifier = 1000, MaxExplosions = 100;
    public static readonly string[] KeepModes = ["kh", "kl", "dh", "dl"];
    public static readonly string[] Rules = ["gte", "lte"];

    /// <summary>Confere a rolagem; lança 400 com mensagem compreensível.</summary>
    public static DiceSpec Validate(DiceSpec? spec)
    {
        if (spec == null) throw new RuleException(400, "Monte a rolagem escolhendo dados.");
        if (spec.Count is < 1 or > MaxCount) throw new RuleException(400, $"Use de 1 a {MaxCount} dados.");
        if (spec.Sides is < 2 or > MaxSides) throw new RuleException(400, $"Os dados têm de 2 a {MaxSides} faces.");
        if (spec.Modifier is < -MaxModifier or > MaxModifier) throw new RuleException(400, $"O modificador vai de -{MaxModifier} a {MaxModifier}.");
        if (spec.Keep != null)
        {
            if (!KeepModes.Contains(spec.Keep)) throw new RuleException(400, "Escolha manter ou descartar os maiores ou menores.");
            if (spec.KeepCount < 1 || spec.KeepCount > spec.Count) throw new RuleException(400, $"Manter ou descartar vai de 1 a {spec.Count} dados.");
            if (spec.Explode || spec.SuccessAt != null) throw new RuleException(400, "Manter/descartar não se combina com explosão ou contagem de sucessos.");
        }
        if (spec.Explode && spec.Sides < 3) throw new RuleException(400, "Dados explosivos precisam de pelo menos 3 faces.");
        if (spec.SuccessAt is { } s && (s < 1 || s > spec.Sides)) throw new RuleException(400, $"O sucesso vai de 1 a {spec.Sides}.");
        if (spec.PercentTarget != null || spec.PercentRule != null)
        {
            if (spec.Count != 1 || spec.Sides != 100) throw new RuleException(400, "O teste percentual usa um único d100.");
            if (spec.PercentTarget is not (>= 1 and <= 100)) throw new RuleException(400, "O alvo percentual vai de 1 a 100.");
            if (!Rules.Contains(spec.PercentRule)) throw new RuleException(400, "Escolha se o sucesso é igual ou menor, ou igual ou maior que o alvo.");
            if (spec.Explode || spec.SuccessAt != null) throw new RuleException(400, "O teste percentual não usa explosão nem contagem de sucessos.");
        }
        return spec;
    }

    public static RollCriterion? ValidateCriterion(int? target, string? rule)
    {
        if (target == null && string.IsNullOrEmpty(rule)) return null;
        if (target is not { } t || t is < -100000 or > 100000) throw new RuleException(400, "Informe o alvo do teste entre -100.000 e 100.000.");
        if (!Rules.Contains(rule)) throw new RuleException(400, "Escolha se o sucesso é igual ou maior, ou igual ou menor que o alvo.");
        return new(t, rule!);
    }

    public static string Notation(DiceSpec s)
    {
        var text = $"{s.Count}d{s.Sides}";
        if (s.Keep != null) text += s.Keep + s.KeepCount;
        if (s.Explode) text += "!";
        if (s.SuccessAt is { } at) text += "≥" + at;
        if (s.Modifier != 0) text += (s.Modifier > 0 ? "+" : "") + s.Modifier;
        if (s.PercentTarget is { } p) text += (s.PercentRule == "lte" ? " ≤ " : " ≥ ") + p;
        return text;
    }

    /// <summary>Rola no servidor. <paramref name="die"/> substitui o gerador nos testes (recebe as faces, devolve 1..faces).</summary>
    public static DiceSpecResult Roll(DiceSpec spec, Func<int, int>? die = null)
    {
        Validate(spec);
        die ??= sides => RandomNumberGenerator.GetInt32(1, sides + 1);
        var values = new List<int>();
        var extra = 0; var capped = false;
        for (var i = 0; i < spec.Count; i++)
        {
            var v = Face(die, spec.Sides);
            values.Add(v);
            // Explosão: cada face máxima acrescenta um dado, até o teto por rolagem.
            while (spec.Explode && v == spec.Sides)
            {
                if (extra >= MaxExplosions) { capped = true; break; }
                v = Face(die, spec.Sides); values.Add(v); extra++;
            }
        }
        var kept = KeptIndices(values, spec);
        int total; int? successes = null; string? outcome = null;
        if (spec.SuccessAt is { } at)
        {
            successes = kept.Count(i => values[i] >= at);
            total = successes.Value + spec.Modifier;
        }
        else total = kept.Sum(i => values[i]) + spec.Modifier;
        if (spec.PercentTarget is { } target) outcome = Judge(total, new(target, spec.PercentRule!));
        return new(Notation(spec), values.ToArray(), kept, spec.Modifier, total, successes, outcome, capped);
    }

    static int Face(Func<int, int> die, int sides)
    {
        var v = die(sides);
        return v < 1 || v > sides ? throw new InvalidOperationException("Gerador fora das faces.") : v;
    }

    static int[] KeptIndices(List<int> values, DiceSpec s)
    {
        var all = Enumerable.Range(0, values.Count);
        if (s.Keep == null) return all.ToArray();
        var asc = all.OrderBy(i => values[i]).ThenBy(i => i).ToList();
        var chosen = s.Keep switch
        {
            "kh" => asc.Skip(values.Count - s.KeepCount),
            "kl" => asc.Take(s.KeepCount),
            "dh" => asc.Take(values.Count - s.KeepCount),
            _ => asc.Skip(s.KeepCount),
        };
        return chosen.OrderBy(i => i).ToArray();
    }

    /// <summary>"sucesso"/"falha" somente com critério definido.</summary>
    public static string Judge(double total, RollCriterion c) => (c.Rule == "lte" ? total <= c.Target : total >= c.Target) ? "sucesso" : "falha";
}

/// <summary>Recursos e destaques da ficha resumida, derivados do modelo. Nenhum recurso é presumido: só aparecem os definidos.</summary>
public static class SheetSummary
{
    public const string Resource = "resource", Highlight = "summary";
    public static readonly string[] Tracks = [Resource, Highlight];

    public sealed record ResourceView(string Field, string Label, double Value, double? Max, double Min);
    public sealed record StatView(string Field, string Label, string Value);

    /// <summary>
    /// Campos marcados como recurso (número com teto fixo ou de outro campo) e destaques. O papel Vida da ficha clássica
    /// vira recurso com teto em Vida máxima; papéis Nível/Armadura/Deslocamento viram destaques só quando o modelo não marca nenhum.
    /// </summary>
    public static (List<ResourceView> Resources, List<StatView> Stats) Build(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> values)
    {
        double? Num(string? name) => name != null && values.TryGetValue(name, out var v) && double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : null;
        var byRole = fields.Where(f => f.Role != null).GroupBy(f => f.Role!).ToDictionary(g => g.Key, g => g.First());
        var resources = new List<ResourceView>();
        foreach (var f in fields)
        {
            var isResource = f.Track == Resource || (f.Track == null && f.Role == SheetFieldRoles.Hp);
            if (!isResource || f.Type is not (SheetFieldTypes.Number or SheetFieldTypes.Computed)) continue;
            var maxField = f.MaxField ?? (f.Role == SheetFieldRoles.Hp && byRole.TryGetValue(SheetFieldRoles.MaxHp, out var mh) ? mh.Name : null);
            var max = Num(maxField) ?? f.Max;
            resources.Add(new(f.Name, Label(f), Num(f.Name) ?? 0, max, f.Min ?? 0));
        }
        var marked = fields.Where(f => f.Track == Highlight).ToList();
        if (marked.Count == 0)
            marked = new[] { SheetFieldRoles.Level, SheetFieldRoles.Armor, SheetFieldRoles.Movement }.Where(byRole.ContainsKey).Select(r => byRole[r]).ToList();
        var stats = marked.Where(f => values.ContainsKey(f.Name)).Select(f => new StatView(f.Name, Label(f), Short(values[f.Name]))).ToList();
        return (resources, stats);
    }

    /// <summary>Armadura/CA para a bolha do marcador: o campo com o papel Armadura, se o modelo o define e tem valor.</summary>
    public static StatView? Armor(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> values)
    {
        var f = fields.FirstOrDefault(x => x.Role == SheetFieldRoles.Armor);
        return f != null && values.TryGetValue(f.Name, out var v) && v.Length > 0 ? new(f.Name, Label(f), Short(v)) : null;
    }

    static string Label(SheetField f) => string.IsNullOrWhiteSpace(f.Label) ? f.Name : f.Label;
    static string Short(string v) => v.Length > 40 ? v[..37] + "…" : v;

    /// <summary>Campo ajustável como recurso na mesa (inclui o papel Vida). Devolve nulo se não for recurso.</summary>
    public static SheetField? ResourceField(IReadOnlyList<SheetField> fields, string field) =>
        fields.FirstOrDefault(f => f.Name == field && f.Type == SheetFieldTypes.Number && (f.Track == Resource || (f.Track == null && f.Role == SheetFieldRoles.Hp)));
}

/// <summary>Atalhos pessoais do jogador para a ficha resumida. Preferência de apresentação: não altera regras, valores nem permissões.</summary>
public sealed record CharacterShortcuts(List<string>? Actions, List<RollShortcut>? Rolls);
public sealed record RollShortcut(string Label, DiceSpec? Spec, string? Formula);

public static class Shortcuts
{
    public const int MaxActions = 8, MaxRolls = 8;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static CharacterShortcuts Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new([], []);
        try { var s = JsonSerializer.Deserialize<CharacterShortcuts>(json, Json); return new(s?.Actions ?? [], s?.Rolls ?? []); }
        catch (JsonException) { return new([], []); }
    }
    public static string Serialize(CharacterShortcuts s) => JsonSerializer.Serialize(s, Json);

    public static CharacterShortcuts Validate(CharacterShortcuts? input)
    {
        var actions = (input?.Actions ?? []).Where(a => !string.IsNullOrWhiteSpace(a)).Distinct().ToList();
        var rolls = input?.Rolls ?? [];
        if (actions.Count > MaxActions) throw new RuleException(400, $"Escolha até {MaxActions} ações favoritas.");
        if (rolls.Count > MaxRolls) throw new RuleException(400, $"Guarde até {MaxRolls} rolagens favoritas.");
        if (actions.Any(a => a.Length > 40)) throw new RuleException(400, "Ação favorita inválida.");
        var clean = new List<RollShortcut>();
        foreach (var r in rolls)
        {
            var label = (r?.Label ?? "").Trim();
            if (label.Length is < 1 or > 40) throw new RuleException(400, "Dê um nome de até 40 caracteres a cada rolagem favorita.");
            if (r!.Spec != null) clean.Add(new(label, DiceRoller.Validate(r.Spec), null));
            else
            {
                var formula = (r.Formula ?? "").Trim();
                if (formula.Length is < 1 or > TableRules.MaxActionFormula) throw new RuleException(400, "A rolagem favorita precisa de dados ou fórmula.");
                var check = Formula.Validate(formula, FormulaMode.Roll);
                if (!check.Ok && !TableRules.IsLegacyFormula(formula)) throw new RuleException(400, $"{label}: {check.Error ?? "fórmula inválida."}");
                clean.Add(new(label, null, formula));
            }
        }
        return new(actions, clean);
    }
}
