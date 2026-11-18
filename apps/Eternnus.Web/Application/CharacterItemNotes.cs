using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace Eternnus.Web;

/// <summary>
/// Descrições por item da ficha (ADR-098): magias, poderes, habilidades, itens… Um item é uma linha não vazia de um campo de texto
/// (texto ou texto longo). A chave é o texto do item normalizado (<see cref="Key"/>), então a descrição acompanha o item quando ele
/// muda de linha ou de campo e some quando o item deixa de existir. Quais campos mostram o botão é decisão da interface
/// (<c>item-notes-policy.js</c>); o servidor só aceita chaves de itens que existem na ficha.
/// </summary>
public static partial class CharacterItemNotes
{
    public const int MaxText = 500, MaxNotes = 200, MaxKey = 200;
    /// <summary>Campo sintético do histórico: não colide com campos de modelo (que começam por letra).</summary>
    public const string HistoryField = "@descricao";

    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();

    /// <summary>Mesma regra de <c>noteKey</c> no cliente: NFC, espaços colapsados, minúsculas invariantes, até 200 caracteres.</summary>
    public static string Key(string? text)
    {
        var key = Spaces().Replace((text ?? "").Normalize(NormalizationForm.FormC), " ").Trim().ToLowerInvariant();
        return key.Length > MaxKey ? key[..MaxKey] : key;
    }

    /// <summary>Itens atuais (chave → texto original da primeira ocorrência) dos campos de texto da ficha.</summary>
    public static Dictionary<string, string> Items(IEnumerable<SheetField> fields, IReadOnlyDictionary<string, string> values)
    {
        var items = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var f in fields)
        {
            if (f.Type is not (SheetFieldTypes.Text or SheetFieldTypes.TextArea) || !values.TryGetValue(f.Name, out var value)) continue;
            foreach (var line in value.Split('\n'))
            {
                var label = line.Trim();
                var key = Key(label);
                if (key.Length > 0) items.TryAdd(key, label);
            }
        }
        return items;
    }

    public static Dictionary<string, string> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new(StringComparer.Ordinal);
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(json) is { } d ? new(d, StringComparer.Ordinal) : new(StringComparer.Ordinal); }
        catch (JsonException) { return new(StringComparer.Ordinal); }
    }

    /// <summary>Somente as descrições de itens que ainda existem (as demais ficam ocultas e somem no próximo salvamento).</summary>
    public static Dictionary<string, string> Visible(string? json, IReadOnlyDictionary<string, string> items) =>
        Parse(json).Where(n => items.ContainsKey(n.Key)).ToDictionary(n => n.Key, n => n.Value, StringComparer.Ordinal);

    /// <summary>
    /// Valida o conjunto enviado (substitui o anterior). Chaves são renormalizadas; itens que não existem mais são descartados
    /// em silêncio (a ficha pode ter mudado no mesmo envio); texto vazio remove. Texto acima de 500 ou mais de 200 itens → 400.
    /// </summary>
    public static Dictionary<string, string> Normalize(IReadOnlyDictionary<string, string?> input, IReadOnlyDictionary<string, string> items)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (rawKey, rawText) in input)
        {
            var key = Key(rawKey);
            var text = (rawText ?? "").Replace("\r\n", "\n").Trim();
            if (text.Length > MaxText) throw new RuleException(400, $"Cada descrição aceita até {MaxText} caracteres.");
            if (key.Length == 0 || text.Length == 0 || !items.ContainsKey(key)) continue;
            result[key] = text;
        }
        if (result.Count > MaxNotes) throw new RuleException(400, $"A ficha aceita até {MaxNotes} descrições de itens.");
        return result;
    }

    /// <summary>Mudanças por item (histórico e linha do tempo privada da sessão), com o texto do item como rótulo.</summary>
    public static List<SheetChange> Diff(IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after, IReadOnlyDictionary<string, string> items) =>
        before.Keys.Union(after.Keys).Distinct().OrderBy(k => k, StringComparer.Ordinal)
            .Select(k => (k, a: before.GetValueOrDefault(k) ?? "", b: after.GetValueOrDefault(k) ?? ""))
            .Where(x => x.a != x.b)
            .Select(x => new SheetChange(HistoryField, "Descrição: " + (items.GetValueOrDefault(x.k) ?? x.k), x.a, x.b))
            .ToList();
}
