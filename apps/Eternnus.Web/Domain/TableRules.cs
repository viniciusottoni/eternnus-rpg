namespace Eternnus.Web;

/// <summary>Regras puras da mesa, independentes de HTTP e banco.</summary>
public static class TableRules
{
    public const double MetersPerSquare = 1.5;
    public const int MaxActions = 16;
    public static readonly TimeSpan OnlineWindow = TimeSpan.FromSeconds(45);

    public static int Modifier(int attribute) => (int)Math.Floor((attribute - 10) / 2.0);
    public static int MovementSquares(int meters, decimal scaleMeters = 1.5m) => Math.Max(1, (int)decimal.Floor(Math.Max(0, meters) / scaleMeters));
    /// <summary>Distância em quadrados com diagonal de custo 1 (Chebyshev), como na maioria dos tabuleiros.</summary>
    public static int Distance(int x1, int y1, int x2, int y2) => Math.Max(Math.Abs(x1 - x2), Math.Abs(y1 - y2));
    public static bool IsOnline(DateTime? lastSeen, DateTime now) => lastSeen is { } seen && now - seen <= OnlineWindow;

    /// <summary>Próximo personagem na ordem de entrada, a partir do turno atual; reinicia no primeiro.</summary>
    public static Guid? NextTurn(IReadOnlyList<Guid> order, Guid? current)
    {
        if (order.Count == 0) return null;
        if (current is not { } active) return order[0];
        var index = -1;
        for (var i = 0; i < order.Count; i++) if (order[i] == active) { index = i; break; }
        return order[(index + 1) % order.Count];
    }

    /// <summary>Teto da fórmula de uma ação do jogador (igual ao <c>MaxLength</c> de <see cref="CharacterAction.Formula"/>).</summary>
    public const int MaxActionFormula = 300;
    /// <summary>Prefixo do identificador das ações que vêm da ficha-modelo (o jogador nunca usa ':' nos seus).</summary>
    public const string TemplateActionPrefix = "t:";

    /// <summary>Fórmula antiga "XdY±Z" (1 a 100 dados, 2 a 1000 faces), rolada pelo <see cref="Dice"/> clássico para manter o resultado e o formato de sempre.</summary>
    public static bool IsLegacyFormula(string? formula)
    {
        if (string.IsNullOrWhiteSpace(formula)) return false;
        try { Dice.Validate(formula); return true; } catch (ArgumentException) { return false; }
    }

    /// <summary>Valida e normaliza ações criadas pelo jogador. Retorna mensagem de erro ou null.
    /// Fórmulas usam a linguagem de fórmulas (modo Roll) com @campos numéricos da ficha (<paramref name="numericNames"/>; nulo = não conferir nomes).
    /// Fórmulas antigas como "1d20 + 3" continuam aceitas (espaços removidos, como antes).</summary>
    public static string? ValidateActions(List<CharacterAction>? actions, IReadOnlySet<string>? numericNames = null)
    {
        if (actions == null) return null;
        if (actions.Count > MaxActions) return $"Cada ficha pode ter até {MaxActions} ações.";
        var ids = new HashSet<string>();
        foreach (var a in actions)
        {
            if (a == null) return "Ação inválida.";
            a.Name = (a.Name ?? "").Trim(); a.Description = (a.Description ?? "").Trim();
            a.Formula = NormalizeFormula(a.Formula);
            if (string.IsNullOrWhiteSpace(a.Id) || a.Id.Length > 36 || !a.Id.All(c => char.IsAsciiLetterOrDigit(c) || c == '-')) a.Id = Guid.NewGuid().ToString("N");
            if (!ids.Add(a.Id)) a.Id = Guid.NewGuid().ToString("N");
            if (a.Name.Length is < 1 or > 60) return "Toda ação precisa de um nome com até 60 caracteres.";
            if (!ActionKinds.All.Contains(a.Kind)) return "Tipo de ação inválido.";
            if (a.Description.Length > 300) return "A descrição de uma ação aceita até 300 caracteres.";
            if (a.Formula.Length > 0)
            {
                if (a.Formula.Length > MaxActionFormula) return $"{a.Name}: a fórmula aceita até {MaxActionFormula} caracteres.";
                var compact = a.Formula.Replace(" ", "");
                if (System.Text.RegularExpressions.Regex.IsMatch(compact, @"^\d{1,3}[dD]\d{1,4}([+-]\d{1,4})?$"))
                {
                    // Formato antigo: mesmas regras e mensagens de antes (d3, d1000…), gravado sem espaços.
                    try { Dice.Validate(compact); } catch (ArgumentException e) { return $"{a.Name}: {e.Message}"; }
                    a.Formula = compact;
                    continue;
                }
                var check = Formula.Validate(a.Formula, FormulaMode.Roll, numericNames);
                if (!check.Ok) return $"{a.Name}: {check.Error ?? "fórmula inválida."}";
            }
        }
        return null;
    }

    /// <summary>Remove espaços das pontas e junta espaços repetidos (a linguagem nova precisa de espaço em "if … then … else").</summary>
    static string NormalizeFormula(string? formula)
    {
        var text = (formula ?? "").Trim();
        if (text.Length == 0) return "";
        var sb = new System.Text.StringBuilder(text.Length);
        var space = false;
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch)) { space = true; continue; }
            if (space) sb.Append(' ');
            space = false;
            sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>Mudanças dos campos editáveis de uma ficha-modelo, com rótulo, para a linha do tempo da sessão.
    /// Textos longos são resumidos (o histórico completo fica em <see cref="CharacterFieldChange"/>).</summary>
    public static List<SheetChange> DiffValues(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after)
    {
        static string Short(string value) => value.Length > 60 ? value[..57] + "…" : value.ReplaceLineEndings(" ");
        var changes = new List<SheetChange>();
        var labels = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var f in fields) labels.TryAdd(f.Name, string.IsNullOrWhiteSpace(f.Label) ? f.Name : f.Label);
        foreach (var name in fields.Select(f => f.Name).Where(n => before.ContainsKey(n) || after.ContainsKey(n)).Concat(before.Keys).Concat(after.Keys).Distinct())
        {
            var a = before.GetValueOrDefault(name) ?? ""; var b = after.GetValueOrDefault(name) ?? "";
            if (a == b) continue;
            changes.Add(new(name, labels.GetValueOrDefault(name) ?? name, Short(a), Short(b)));
        }
        return changes;
    }

    /// <summary>Lista as mudanças visíveis de uma ficha para o histórico da sessão.</summary>
    public static List<SheetChange> Diff(CharacterSnapshot before, CharacterSnapshot after)
    {
        var changes = new List<SheetChange>();
        void Add(string field, string label, object a, object b) { if (!Equals(a, b)) changes.Add(new(field, label, a.ToString() ?? "", b.ToString() ?? "")); }
        Add("name", "Nome", before.Name, after.Name); Add("archetype", "Arquétipo", before.Archetype, after.Archetype);
        Add("level", "Nível", before.Level, after.Level); Add("hp", "Vida", before.Hp, after.Hp); Add("maxHp", "Vida máxima", before.MaxHp, after.MaxHp);
        Add("strength", "Força", before.Strength, after.Strength); Add("agility", "Destreza", before.Agility, after.Agility);
        Add("constitution", "Constituição", before.Constitution, after.Constitution); Add("intellect", "Intelecto", before.Intellect, after.Intellect);
        Add("armor", "Armadura", before.Armor, after.Armor); Add("movement", "Movimento", before.Movement, after.Movement);
        Add("actions", "Ações", before.ActionCount, after.ActionCount);
        return changes;
    }
}

public sealed record SheetChange(string Field, string Label, string Before, string After);
public sealed record CharacterSnapshot(string Name, string Archetype, int Level, int Hp, int MaxHp, int Strength, int Agility, int Constitution, int Intellect, int Armor, int Movement, int ActionCount)
{
    public static CharacterSnapshot Of(Character c) => new(c.Name, c.Archetype, c.Level, c.Hp, c.MaxHp, c.Strength, c.Agility, c.Constitution, c.Intellect, c.Armor, c.Movement, c.Actions?.Count ?? 0);
}
