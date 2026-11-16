using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
namespace Eternnus.Web;

/// <summary>Tipos de ponto de entrada de um mapa da campanha.</summary>
public static class MapEntryKinds
{
    /// <summary>Entrada do grupo: usada pela mesa quando a cena não define a própria entrada.</summary>
    public const string Party = "party";
    public const string Enemies = "enemies", Reinforcements = "reinforcements", Other = "other";
    public static readonly string[] All = [Party, Enemies, Reinforcements, Other];
}

/// <summary>Ponto de entrada de um mapa com grade: retângulo de casas (X, Y, largura W, altura H).</summary>
public sealed record MapEntry(string? Id, string? Name, string? Kind, int X = 0, int Y = 0, int W = 1, int H = 1);

/// <summary>Retângulo de casas usado para posicionar personagens.</summary>
public readonly record struct EntryRect(int X, int Y, int W, int H);

/// <summary>
/// Pontos de entrada de um mapa da campanha (<see cref="CampaignMap.Entries"/>): até 12, identificador curto e único,
/// nome de até 40 caracteres e retângulo de 1 a 20 casas por lado dentro da grade.
/// </summary>
public static partial class MapEntries
{
    public const int Max = 12, MaxSide = 20;
    internal static readonly JsonSerializerOptions Json = new(EditorLayers.Json);
    static readonly JsonSerializerOptions Strict = new(EditorLayers.Json) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    [GeneratedRegex("^[a-z0-9-]{1,24}$")] internal static partial Regex IdPattern();

    static bool Inside(int x, int y, int w, int h, int gridW, int gridH) =>
        w is >= 1 and <= MaxSide && h is >= 1 and <= MaxSide && x >= 0 && y >= 0 && x + w <= gridW && y + h <= gridH;

    public static List<MapEntry> Validate(IReadOnlyList<MapEntry?>? input, int gridW, int gridH)
    {
        var list = input ?? [];
        if (list.Count > Max) throw new RuleException(400, $"Use até {Max} pontos de entrada por mapa.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<MapEntry>(list.Count);
        foreach (var e in list)
        {
            if (e?.Id == null || !IdPattern().IsMatch(e.Id)) throw new RuleException(400, "Cada ponto de entrada precisa de um identificador curto (a-z, 0-9 e hífen).");
            if (!ids.Add(e.Id)) throw new RuleException(400, "Há pontos de entrada com o mesmo identificador.");
            var name = LibraryService.Clean(e.Name ?? "", false).Trim();
            if (name.Length is 0 or > 40) throw new RuleException(400, "Dê um nome de até 40 caracteres a cada ponto de entrada.");
            if (e.Kind == null || !MapEntryKinds.All.Contains(e.Kind)) throw new RuleException(400, "Escolha o tipo do ponto de entrada: grupo, inimigos, reforços ou outro.");
            if (!Inside(e.X, e.Y, e.W, e.H, gridW, gridH)) throw new RuleException(400, $"O ponto de entrada {name} precisa ficar dentro da grade, com 1 a {MaxSide} casas por lado.");
            result.Add(e with { Name = name });
        }
        return result;
    }

    /// <summary>Pontos guardados; ausentes ou ilegíveis = nenhum.</summary>
    public static List<MapEntry> Parse(string? json)
    {
        if (string.IsNullOrEmpty(json)) return [];
        try { return JsonSerializer.Deserialize<List<MapEntry>>(json, Json) is { } list ? list.Where(e => e?.Id != null).ToList() : []; }
        catch (JsonException) { return []; }
    }

    /// <summary>Lista vazia guarda nulo.</summary>
    public static string? Serialize(IReadOnlyList<MapEntry> entries) => entries.Count == 0 ? null : JsonSerializer.Serialize(entries, Json);

    /// <summary>Grade nova (menor): saem os pontos que não cabem mais. Devolve o JSON guardado (nulo sem pontos).</summary>
    public static string? Fit(string? json, int gridW, int gridH)
    {
        if (string.IsNullOrEmpty(json)) return json;
        var list = Parse(json);
        var kept = list.Where(e => Inside(e.X, e.Y, e.W, e.H, gridW, gridH)).ToList();
        return kept.Count == list.Count ? json : Serialize(kept);
    }

    internal static bool TryStrict<T>(string json, out T? value)
    {
        try { value = JsonSerializer.Deserialize<T>(json, Strict); return true; }
        catch (JsonException) { value = default; return false; }
        catch (NotSupportedException) { value = default; return false; }
    }
}

/// <summary>Entrada própria da cena: referência a um ponto do mapa (<c>{"ref":"id"}</c>) ou retângulo de casas (<c>{"x","y","w","h"}</c>).</summary>
public sealed record SceneEntry(string? Ref = null, int? X = null, int? Y = null, int? W = null, int? H = null);

public static class SceneEntries
{
    public const int MaxLength = 400;

    /// <summary>Entrada guardada; ausente ou ilegível = nula.</summary>
    public static SceneEntry? Parse(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<SceneEntry>(json, MapEntries.Json); }
        catch (JsonException) { return null; }
    }

    public static JsonElement? View(string? json) => Parse(json) is { } e ? JsonSerializer.SerializeToElement(e, MapEntries.Json) : null;

    /// <summary>Valida a entrada enviada contra a grade e os pontos do mapa. Devolve o JSON normalizado.</summary>
    public static string Validate(string json, IReadOnlyList<MapEntry> mapEntries, int gridW, int gridH)
    {
        if (json.Length > MaxLength || !MapEntries.TryStrict<SceneEntry>(json, out var e) || e == null) throw new RuleException(400, "Entrada da cena inválida.");
        if (e.Ref != null)
        {
            if (e.X != null || e.Y != null || e.W != null || e.H != null) throw new RuleException(400, "Entrada da cena inválida: escolha um ponto do mapa ou uma área.");
            if (!mapEntries.Any(m => m.Id == e.Ref)) throw new RuleException(400, "Ponto de entrada do mapa não encontrado. Recarregue o editor.");
            return JsonSerializer.Serialize(new SceneEntry(e.Ref), MapEntries.Json);
        }
        if (e.X is not { } x || e.Y is not { } y || e.W is not { } w || e.H is not { } h) throw new RuleException(400, "Entrada da cena inválida: informe a área (x, y, largura e altura).");
        if (w is < 1 or > MapEntries.MaxSide || h is < 1 or > MapEntries.MaxSide || x < 0 || y < 0 || x + w > gridW || y + h > gridH)
            throw new RuleException(400, $"A entrada da cena precisa ficar dentro da grade, com 1 a {MapEntries.MaxSide} casas por lado.");
        return JsonSerializer.Serialize(new SceneEntry(null, x, y, w, h), MapEntries.Json);
    }

    /// <summary>Retângulo da entrada: a área própria ou a do ponto do mapa referenciado (nulo se o ponto saiu do mapa).</summary>
    public static EntryRect? Rect(SceneEntry? e, IReadOnlyList<MapEntry> mapEntries)
    {
        if (e == null) return null;
        if (e.Ref != null) return mapEntries.FirstOrDefault(m => m.Id == e.Ref) is { } m ? new EntryRect(m.X, m.Y, m.W, m.H) : null;
        return e is { X: { } x, Y: { } y, W: { } w, H: { } h } ? new EntryRect(x, y, w, h) : null;
    }
}

/// <summary>
/// Onde cada personagem entra na mesa (regra pura, também usada pela prévia de reposicionamento). Prioridade por personagem:
/// <list type="number">
/// <item>posição preparada na cena (válida e livre);</item>
/// <item>entrada da cena (área própria ou ponto do mapa), casas livres em ordem de leitura;</item>
/// <item>primeiro ponto "Entrada do grupo" do mapa;</item>
/// <item>pontos de entrada da grade (<c>S</c>) e, esgotados, a casa livre mais próxima do primeiro.</item>
/// </list>
/// Casas que bloqueiam movimento nunca recebem marcador; com grade, uma casa por marcador (movimentação livre permite dividir).
/// </summary>
public static class ScenePlacement
{
    /// <summary>Marcador planejado: personagem (com ou sem posição preparada) ou marcador do mestre preparado.</summary>
    public sealed record Placement(Guid? CharacterId, SceneToken? Source, int X, int Y);

    /// <summary>Áreas de entrada em ordem: a da cena e o primeiro ponto "Entrada do grupo" do mapa.</summary>
    public static List<EntryRect> Entries(SceneEntry? scene, IReadOnlyList<MapEntry> mapEntries)
    {
        var list = new List<EntryRect>(2);
        if (SceneEntries.Rect(scene, mapEntries) is { } own) list.Add(own);
        if (mapEntries.FirstOrDefault(m => m.Kind == MapEntryKinds.Party) is { } party && !list.Contains(new EntryRect(party.X, party.Y, party.W, party.H)))
            list.Add(new EntryRect(party.X, party.Y, party.W, party.H));
        return list;
    }

    /// <summary>
    /// Plano completo de uma cena: personagens presentes (ordem de entrada na mesa) e marcadores preparados.
    /// Marcadores do mestre em posição inválida ou ocupada são descartados; personagens sem posição usam as entradas.
    /// </summary>
    public static List<Placement> Plan(BattleMap map, FogGrid grid, IReadOnlyList<SceneToken> source, IReadOnlyList<Guid> characters, IReadOnlyList<EntryRect> entries)
    {
        var taken = new HashSet<(int, int)>();
        bool Free(int x, int y) => grid.Inside(x, y) && !grid.BlocksMove(x, y) && (map.Free || !taken.Contains((x, y)));
        var result = new List<Placement>();
        var placed = new HashSet<Guid>();
        foreach (var c in characters)
        {
            if (source.FirstOrDefault(t => t.CharacterId == c) is not { } saved || !Free(saved.X, saved.Y)) continue;
            taken.Add((saved.X, saved.Y)); placed.Add(c);
            result.Add(new(c, saved, saved.X, saved.Y));
        }
        foreach (var t in source.Where(t => t.CharacterId == null).Take(ScenePrep.MaxTokens))
        {
            if (!Free(t.X, t.Y)) continue;
            taken.Add((t.X, t.Y));
            result.Add(new(null, t, t.X, t.Y));
        }
        foreach (var c in characters.Where(c => !placed.Contains(c)))
        {
            if (Spot(map, grid, taken, entries) is not { } p) continue;
            taken.Add(p);
            result.Add(new(c, null, p.X, p.Y));
        }
        return result;
    }

    /// <summary>Casa de entrada de um personagem sem posição preparada (ver prioridade em <see cref="ScenePlacement"/>).</summary>
    public static (int X, int Y)? Spot(BattleMap map, FogGrid grid, IReadOnlySet<(int, int)> taken, IReadOnlyList<EntryRect> entries)
    {
        bool Stand(int x, int y) => grid.Inside(x, y) && !grid.BlocksMove(x, y);
        foreach (var r in entries)
        {
            (int, int)? shared = null;
            for (var y = r.Y; y < r.Y + r.H; y++)
                for (var x = r.X; x < r.X + r.W; x++)
                {
                    if (!Stand(x, y)) continue;
                    if (!taken.Contains((x, y))) return (x, y);
                    shared ??= (x, y);
                }
            // Movimentação livre: a área cheia ainda recebe o personagem (a casa pode ser dividida).
            if (map.Free && shared is { } s) return s;
        }
        foreach (var spawn in map.Spawns()) if (!taken.Contains(spawn) && Stand(spawn.X, spawn.Y)) return spawn;
        // Ao esgotar os pontos de entrada, procura a célula livre mais próxima do primeiro ponto.
        var origin = map.Spawns().FirstOrDefault();
        for (var radius = 1; radius < Math.Max(map.Width, map.Height); radius++)
            for (var y = origin.Y - radius; y <= origin.Y + radius; y++)
                for (var x = origin.X - radius; x <= origin.X + radius; x++)
                    if (Stand(x, y) && !taken.Contains((x, y))) return (x, y);
        return null;
    }
}
