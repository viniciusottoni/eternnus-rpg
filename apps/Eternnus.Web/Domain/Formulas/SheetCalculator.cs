using System.Globalization;
namespace Eternnus.Web;

// Cálculo e validação dos campos de uma ficha-modelo. Espelhado em wwwroot/js/formula.js (computeSheet/validateFields).
// Nunca lança por dado do jogador: valores inválidos viram texto vazio.

public static partial class SheetCalculator
{
    internal const int MaxFields = 300, DefaultTextLength = 200, MaxTextLength = 2000, MaxTextAreaLength = 10000;
    private const double GeometryTolerance = 1e-6, MinSize = 0.005;
    private static readonly string[] NumericRoles = [SheetFieldRoles.Level, SheetFieldRoles.Hp, SheetFieldRoles.MaxHp, SheetFieldRoles.Movement, SheetFieldRoles.Armor];
    private static readonly string[] TruthyValues = ["true", "1", "on", "sim"];

    private static bool IsNumericType(string? type) => type is SheetFieldTypes.Number or SheetFieldTypes.Computed or SheetFieldTypes.Checkbox;

    /// <summary>Remove espaços comuns (espaço, tab, quebras e espaço não separável) das pontas. Igual ao cliente.</summary>
    internal static string TrimValue(string value)
    {
        static bool Blank(char c) => c is ' ' or '\t' or '\r' or '\n' or ' ';
        var start = 0;
        var end = value.Length;
        while (start < end && Blank(value[start])) start++;
        while (end > start && Blank(value[end - 1])) end--;
        return value[start..end];
    }

    /// <summary>Número em cultura invariante; aceita vírgula decimal pt-BR ("2,5"). Sem expoente, sem milhar. |x| ≤ 1e12.</summary>
    internal static double? ParseNumber(string? raw)
    {
        if (raw is null) return null;
        var s = TrimValue(raw);
        if (s.Length is 0 or > 40) return null;
        if (s.Contains(','))
        {
            if (s.Contains('.')) return null;
            s = s.Replace(',', '.');
        }
        var i = 0;
        if (s[0] is '+' or '-') i++;
        var digitsStart = i;
        while (i < s.Length && FormulaText.IsDigit(s[i])) i++;
        if (i == digitsStart) return null;
        if (i < s.Length)
        {
            if (s[i] != '.') return null;
            var fractionStart = ++i;
            while (i < s.Length && FormulaText.IsDigit(s[i])) i++;
            if (i == fractionStart || i != s.Length) return null;
        }
        var value = double.Parse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        return Math.Abs(value) > Formula.MaxValue ? null : value + 0.0;
    }

    private static bool IsTruthy(string? raw)
    {
        if (raw is null) return false;
        var value = FormulaText.AsciiLower(TrimValue(raw));
        return Array.IndexOf(TruthyValues, value) >= 0;
    }

    private static int TextLimit(SheetField field)
    {
        var textArea = field.Type == SheetFieldTypes.TextArea;
        var cap = textArea ? MaxTextAreaLength : MaxTextLength;
        if (field.MaxLength is int limit && limit >= 1) return Math.Min(limit, cap);
        return textArea ? MaxTextAreaLength : DefaultTextLength;
    }

    private static string Cut(string value, int max)
    {
        if (value.Length > max)
        {
            var end = max;
            if (end > 0 && char.IsHighSurrogate(value[end - 1])) end--;
            value = value[..end];
        }
        return value.Contains('\0') ? value.Replace("\0", "") : value;
    }

    private static string Normalize(SheetField field, string raw)
    {
        switch (field.Type)
        {
            case SheetFieldTypes.Number:
            {
                var parsed = ParseNumber(raw);
                if (parsed is not double value) return "";
                if (field.Min is double min && double.IsFinite(min) && value < min) value = min;
                if (field.Max is double max && double.IsFinite(max) && value > max) value = max;
                return Formula.Format(value);
            }
            case SheetFieldTypes.Checkbox:
                return IsTruthy(raw) ? "true" : "false";
            case SheetFieldTypes.Select:
            {
                var wanted = TrimValue(raw);
                if (wanted.Length == 0) return "";
                foreach (var option in field.Options ?? [])
                {
                    if (option is not null && TrimValue(option) == wanted) return wanted;
                }
                return "";
            }
            default:
                return Cut(raw, TextLimit(field));
        }
    }

    /// <summary>Campos utilizáveis: nome válido, primeira ocorrência, no máximo 300.</summary>
    private static List<SheetField> Usable(IReadOnlyList<SheetField>? fields)
    {
        var list = new List<SheetField>();
        if (fields is null) return list;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            if (list.Count >= MaxFields) break;
            if (field is null || !FormulaText.IsValidName(field.Name) || !seen.Add(field.Name)) continue;
            list.Add(field);
        }
        return list;
    }

    private static IReadOnlyDictionary<string, string> ComputeCore(IReadOnlyList<SheetField>? fields, IReadOnlyDictionary<string, string>? values)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var scope = new Dictionary<string, double>(StringComparer.Ordinal);
        var computed = new List<SheetField>();
        foreach (var field in Usable(fields))
        {
            if (field.Type == SheetFieldTypes.Computed)
            {
                computed.Add(field);
                result[field.Name] = "";
                continue;
            }
            string? raw = null;
            if (values is not null && values.TryGetValue(field.Name, out var provided)) raw = provided;
            var text = Normalize(field, raw ?? field.Default ?? "");
            result[field.Name] = text;
            if (field.Type == SheetFieldTypes.Number) scope[field.Name] = ParseNumber(text) ?? 0;
            else if (field.Type == SheetFieldTypes.Checkbox) scope[field.Name] = text == "true" ? 1 : 0;
        }

        // Ordem topológica (Kahn) entre calculados; inválidos não têm dependências e ficam vazios.
        var parsed = new Dictionary<string, ParsedFormula?>(StringComparer.Ordinal);
        var dependencies = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var field in computed) dependencies[field.Name] = [];
        var dependents = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var pending = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var field in computed)
        {
            ParsedFormula? formula = null;
            try
            {
                formula = FormulaParser.Parse(field.Formula, FormulaMode.Deterministic);
            }
            catch (FormulaException)
            {
            }
            parsed[field.Name] = formula;
            var count = 0;
            if (formula is not null)
            {
                foreach (var reference in formula.References)
                {
                    if (!dependencies.ContainsKey(reference.Name)) continue;
                    count++;
                    if (!dependents.TryGetValue(reference.Name, out var list)) dependents[reference.Name] = list = [];
                    list.Add(field.Name);
                }
            }
            pending[field.Name] = count;
        }
        var queue = new Queue<string>(computed.Where(f => pending[f.Name] == 0).Select(f => f.Name));
        while (queue.Count > 0)
        {
            var name = queue.Dequeue();
            var text = "";
            if (parsed[name] is ParsedFormula formula)
            {
                try
                {
                    text = Formula.Format(new FormulaEvaluator(scope, null, null).Run(formula.Root));
                }
                catch (FormulaException)
                {
                    text = "";
                }
            }
            result[name] = text;
            scope[name] = ParseNumber(text) ?? 0;
            if (!dependents.TryGetValue(name, out var next)) continue;
            foreach (var dependent in next)
            {
                if (--pending[dependent] == 0) queue.Enqueue(dependent);
            }
        }
        return result;
    }

    private static IReadOnlyDictionary<string, double> ScopeCore(IReadOnlyList<SheetField>? fields, IReadOnlyDictionary<string, string>? computedValues)
    {
        var scope = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var field in Usable(fields))
        {
            if (!IsNumericType(field.Type)) continue;
            string? raw = null;
            computedValues?.TryGetValue(field.Name, out raw);
            scope[field.Name] = field.Type == SheetFieldTypes.Checkbox ? (IsTruthy(raw) ? 1 : 0) : ParseNumber(raw) ?? 0;
        }
        return scope;
    }

    private static bool InRange(double value, double min, double max) => double.IsFinite(value) && value >= min && value <= max;

    private static IReadOnlyList<string> ValidateFieldsCore(IReadOnlyList<SheetField>? fields)
    {
        if (fields is null) return ["Lista de campos ausente."];
        if (fields.Count > MaxFields) return ["No máximo 300 campos por modelo."];
        var errors = new List<string>();
        var types = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var field in fields)
        {
            if (field is not null && FormulaText.IsValidName(field.Name)) types.TryAdd(field.Name, field.Type ?? "");
        }
        var seenNames = new HashSet<string>(StringComparer.Ordinal);
        var roles = new Dictionary<string, string>(StringComparer.Ordinal);
        var graph = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var graphOrder = new List<string>();

        for (var i = 0; i < fields.Count; i++)
        {
            var field = fields[i];
            var position = "Campo " + (i + 1).ToString(CultureInfo.InvariantCulture);
            if (field is null)
            {
                errors.Add(position + ": inválido.");
                continue;
            }
            var validName = FormulaText.IsValidName(field.Name);
            var p = validName ? field.Name : position;
            var unique = validName && seenNames.Add(field.Name);
            if (!validName) errors.Add(p + ": nome inválido (letras minúsculas, números e _, começando por letra, até 40).");
            else if (!unique) errors.Add(p + ": nome repetido.");

            var label = field.Label ?? "";
            if (label.Length > 80 || TrimValue(label).Length == 0) errors.Add(p + ": rótulo deve ter de 1 a 80 caracteres.");

            var type = field.Type ?? "";
            var validType = Array.IndexOf(SheetFieldTypes.All, type) >= 0;
            if (!validType) errors.Add(p + ": tipo inválido.");

            if (!string.IsNullOrEmpty(field.Role))
            {
                var role = field.Role;
                if (Array.IndexOf(SheetFieldRoles.All, role) < 0) errors.Add(p + ": papel inválido.");
                else if (roles.TryGetValue(role, out var owner)) errors.Add($"{p}: o papel {role} já é usado por {owner}.");
                else
                {
                    roles[role] = p;
                    if (validType && Array.IndexOf(NumericRoles, role) >= 0 && type is not (SheetFieldTypes.Number or SheetFieldTypes.Computed))
                        errors.Add($"{p}: o papel {role} exige campo de número ou calculado.");
                    if (validType && role == SheetFieldRoles.Name && type != SheetFieldTypes.Text)
                        errors.Add($"{p}: o papel name exige campo de texto.");
                }
            }

            if (field.Page < 0) errors.Add(p + ": página inválida.");
            if (!(InRange(field.X, -GeometryTolerance, 1) && InRange(field.Y, -GeometryTolerance, 1)
                && double.IsFinite(field.W) && double.IsFinite(field.H) && field.W > MinSize && field.H > MinSize
                && field.X + field.W <= 1 + GeometryTolerance && field.Y + field.H <= 1 + GeometryTolerance))
                errors.Add(p + ": posição ou tamanho fora da página.");

            if (type == SheetFieldTypes.Computed)
            {
                var formulaError = CheckComputedFormula(field.Formula, types, out var references);
                if (formulaError is not null) errors.Add(p + ": " + formulaError);
                else if (unique)
                {
                    graph[field.Name] = references.Where(r => types[r] == SheetFieldTypes.Computed).ToList();
                    graphOrder.Add(field.Name);
                }
            }

            if (type == SheetFieldTypes.Select)
            {
                var options = field.Options ?? [];
                if (options.Count is < 1 or > 50) errors.Add(p + ": a lista precisa ter de 1 a 50 opções.");
                else if (options.Any(o => o is null || o.Length > 60 || TrimValue(o).Length == 0)) errors.Add(p + ": cada opção deve ter de 1 a 60 caracteres.");
                else if (options.Select(TrimValue).Distinct(StringComparer.Ordinal).Count() != options.Count) errors.Add(p + ": opções repetidas.");
            }

            if (field.MaxLength is int maxLength)
            {
                var cap = type == SheetFieldTypes.TextArea ? MaxTextAreaLength : MaxTextLength;
                if (maxLength < 1 || maxLength > cap) errors.Add($"{p}: limite de caracteres deve ser de 1 a {cap}.");
            }

            if ((field.Min is double min && !double.IsFinite(min)) || (field.Max is double max && !double.IsFinite(max))) errors.Add(p + ": mínimo ou máximo inválido.");
            else if (field.Min is double low && field.Max is double high && low > high) errors.Add(p + ": mínimo maior que o máximo.");

            if (!InRange(field.FontSize, 6, 32)) errors.Add(p + ": tamanho da fonte deve ser de 6 a 32.");
            if (field.Align is not ("left" or "center" or "right")) errors.Add(p + ": alinhamento inválido.");

            if (validType && !string.IsNullOrEmpty(field.Default))
            {
                var error = CheckDefault(field, type, field.Default);
                if (error is not null) errors.Add(p + ": " + error);
            }
        }
        errors.AddRange(FindCycles(graph, graphOrder));
        return errors;
    }

    private static string? CheckComputedFormula(string? formula, Dictionary<string, string> types, out IReadOnlyList<string> references)
    {
        references = [];
        if (formula is null || formula.All(FormulaText.IsSpace)) return "informe a fórmula.";
        var check = Formula.Validate(formula, FormulaMode.Deterministic);
        if (!check.Ok) return check.Error;
        foreach (var name in check.References)
        {
            if (!types.TryGetValue(name, out var referencedType)) return "Campo desconhecido: @" + name;
            if (!IsNumericType(referencedType)) return $"@{name} não é numérico (use número, calculado ou caixa de seleção).";
        }
        references = check.References;
        return null;
    }

    private static string? CheckDefault(SheetField field, string type, string value)
    {
        switch (type)
        {
            case SheetFieldTypes.Computed:
                return "campo calculado não tem valor padrão.";
            case SheetFieldTypes.Number:
                return ParseNumber(value) is null ? "valor padrão incompatível com o tipo." : null;
            case SheetFieldTypes.Checkbox:
                return value is "true" or "false" ? null : "valor padrão incompatível com o tipo.";
            case SheetFieldTypes.Select:
                return (field.Options ?? []).Any(o => o is not null && TrimValue(o) == TrimValue(value)) ? null : "valor padrão incompatível com o tipo.";
            default:
                return value.Length > Math.Min(TextLimit(field), DefaultTextLength) ? "valor padrão incompatível com o tipo." : null;
        }
    }

    /// <summary>Busca em profundidade iterativa (sem recursão). Relata até 5 ciclos, na ordem dos campos.</summary>
    private static List<string> FindCycles(Dictionary<string, List<string>> graph, List<string> order)
    {
        var messages = new List<string>();
        var color = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var start in order)
        {
            if (color.GetValueOrDefault(start) != 0) continue;
            var stack = new List<(string Node, int Edge)> { (start, 0) };
            var path = new List<string> { start };
            color[start] = 1;
            while (stack.Count > 0)
            {
                var (node, edge) = stack[^1];
                var edges = graph[node];
                if (edge < edges.Count)
                {
                    stack[^1] = (node, edge + 1);
                    var next = edges[edge];
                    if (!graph.ContainsKey(next)) continue;
                    var state = color.GetValueOrDefault(next);
                    if (state == 1)
                    {
                        var cycle = path.Skip(path.IndexOf(next)).Append(next);
                        messages.Add("Ciclo entre campos calculados: " + string.Join(" → ", cycle) + ".");
                        if (messages.Count >= 5) return messages;
                    }
                    else if (state == 0)
                    {
                        color[next] = 1;
                        stack.Add((next, 0));
                        path.Add(next);
                    }
                }
                else
                {
                    color[node] = 2;
                    stack.RemoveAt(stack.Count - 1);
                    path.RemoveAt(path.Count - 1);
                }
            }
        }
        return messages;
    }
}
