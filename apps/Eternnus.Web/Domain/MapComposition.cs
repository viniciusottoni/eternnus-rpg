using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
namespace Eternnus.Web;

/// <summary>Camada visual de um documento do editor (cena, mapa de tiles ou mapa de imagem). Opacidade 0–100.
/// <c>Secret</c>: só o mestre vê (fica fora da imagem dos jogadores); vale para a composição de cenas, nula nos demais.</summary>
public sealed record EditorLayer(string Id, string Name, string Kind, bool Visible = true, bool Locked = false, int Opacity = 100, bool? Secret = null);

/// <summary>
/// Regras puras das camadas (ADR-081): Base (<c>base</c>) e Elementos (<c>elements</c>) obrigatórias, nessa ordem de baixo para cima,
/// e até seis extras (<c>custom</c>) com identificador curto e único.
/// </summary>
public static partial class EditorLayers
{
    public const int Max = 8;
    public const string Base = "base", Elements = "elements", Custom = "custom";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
    [GeneratedRegex("^[a-z0-9-]{1,24}$")] private static partial Regex IdPattern();

    public static List<EditorLayer> Defaults() => [new(Base, "Base", Base), new(Elements, "Elementos", Elements)];

    public static List<EditorLayer> Validate(IReadOnlyList<EditorLayer?>? input)
    {
        if (input == null || input.Count is < 2 or > Max) throw new RuleException(400, $"Use de 2 a {Max} camadas, começando por Base e Elementos.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<EditorLayer>(input.Count);
        for (var i = 0; i < input.Count; i++)
        {
            var l = input[i] ?? throw new RuleException(400, "Camada inválida.");
            var fixedId = i switch { 0 => Base, 1 => Elements, _ => null };
            var valid = fixedId != null
                ? l.Id == fixedId && l.Kind == fixedId
                : l.Kind == Custom && l.Id != null && IdPattern().IsMatch(l.Id) && l.Id is not (Base or Elements);
            if (!valid) throw new RuleException(400, "Camadas inválidas: Base e Elementos vêm primeiro; as extras usam um identificador curto (a-z, 0-9 e hífen).");
            if (!ids.Add(l.Id!)) throw new RuleException(400, "Há camadas com o mesmo identificador.");
            var name = LibraryService.Clean(l.Name ?? "", false).Trim();
            if (name.Length is 0 or > 40) throw new RuleException(400, "Dê um nome de até 40 caracteres a cada camada.");
            if (l.Opacity is < 0 or > 100) throw new RuleException(400, "A opacidade da camada vai de 0 a 100.");
            result.Add(l with { Name = name, Secret = l.Secret == true ? true : null });
        }
        return result;
    }

    public static string Serialize(IReadOnlyList<EditorLayer> layers) => JsonSerializer.Serialize(layers, Json);

    /// <summary>Camadas guardadas; ausentes ou ilegíveis = Base e Elementos.</summary>
    public static List<EditorLayer> Parse(string? json)
    {
        if (string.IsNullOrEmpty(json)) return Defaults();
        try { return JsonSerializer.Deserialize<List<EditorLayer>>(json, Json) is { Count: >= 2 } list ? list : Defaults(); }
        catch (JsonException) { return Defaults(); }
    }
}

/// <summary>Camada de um mapa de tiles: <c>Rows</c> com códigos do catálogo; fora da Base, <c>_</c> é casa vazia.</summary>
public sealed record TileLayerInput(string Id, string Name, string Kind, bool Visible = true, bool Locked = false, int Opacity = 100, string[]? Rows = null);

/// <summary>
/// Camadas de mapa de tiles. A grade efetiva (<see cref="CampaignMap.TileData"/>) é a fusão: em cada casa vale o tile da camada visível
/// mais alta (fora a Base) que não esteja vazia; senão, o da Base (sempre incluída, mesmo oculta no editor).
/// </summary>
public static class TileLayers
{
    public const char Empty = '_';
    sealed record Document(int V, string Kind, List<TileLayerInput> Layers);

    public static (List<TileLayerInput> Layers, string[] Effective) Merge(IReadOnlyList<TileLayerInput?>? input)
    {
        var meta = EditorLayers.Validate(input?.Select(l => l == null ? null : new EditorLayer(l.Id, l.Name, l.Kind, l.Visible, l.Locked, l.Opacity)).ToList());
        var baseRows = input![0]!.Rows;
        if (baseRows == null || baseRows.Length is < 8 or > 64 || baseRows.Any(r => r == null || r.Length is < 8 or > 64 || r.Length != baseRows[0].Length || r.Any(c => !MapTiles.IsValid(c))))
            throw new RuleException(400, "A camada Base precisa preencher todas as casas (8 a 64 por lado) com tiles do catálogo.");
        int height = baseRows.Length, width = baseRows[0].Length;
        var cells = baseRows.Select(r => r.ToCharArray()).ToArray();
        var layers = new List<TileLayerInput>(meta.Count);
        for (var i = 0; i < meta.Count; i++)
        {
            var rows = input[i]!.Rows;
            if (i > 0)
            {
                if (rows == null || rows.Length != height || rows.Any(r => r == null || r.Length != width || r.Any(c => c != Empty && !MapTiles.IsValid(c))))
                    throw new RuleException(400, $"A camada {meta[i].Name} precisa ter o tamanho da Base, com tiles do catálogo ou “_” nas casas vazias.");
                // Da camada mais baixa para a mais alta: a visível mais alta prevalece.
                if (meta[i].Visible)
                    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) if (rows[y][x] != Empty) cells[y][x] = rows[y][x];
            }
            var m = meta[i];
            layers.Add(new TileLayerInput(m.Id, m.Name, m.Kind, m.Visible, m.Locked, m.Opacity, [.. rows!]));
        }
        return (layers, MapTiles.Validate(cells.Select(c => new string(c)).ToArray()));
    }

    /// <summary>Mapa antigo ou salvo sem camadas: a grade vira a Base e Elementos fica vazio.</summary>
    public static List<TileLayerInput> FromRows(string[] rows) =>
    [
        new(EditorLayers.Base, "Base", EditorLayers.Base, Rows: [.. rows]),
        new(EditorLayers.Elements, "Elementos", EditorLayers.Elements, Rows: rows.Select(r => new string(Empty, r.Length)).ToArray()),
    ];

    public static string Serialize(IReadOnlyList<TileLayerInput> layers) => JsonSerializer.Serialize(new Document(1, "tiles", [.. layers]), EditorLayers.Json);

    /// <summary>Camadas guardadas do mapa; ausentes, ilegíveis ou de outro tamanho = sintetizadas a partir da grade efetiva.</summary>
    public static List<TileLayerInput> Parse(string? composition, string tileData)
    {
        var rows = tileData.Split('\n');
        if (string.IsNullOrEmpty(composition)) return FromRows(rows);
        try
        {
            var doc = JsonSerializer.Deserialize<Document>(composition, EditorLayers.Json);
            if (doc is { V: 1, Kind: "tiles", Layers: { Count: >= 2 } layers } && layers.All(l => l.Rows is { } r && r.Length == rows.Length && r.All(x => x.Length == rows[0].Length)))
                return layers;
        }
        catch (JsonException) { }
        return FromRows(rows);
    }

    /// <summary>Terreno (Base) quando há objetos por cima; nulo quando a grade efetiva já é o terreno.</summary>
    public static string[]? Terrain(string? composition, string tileData)
    {
        if (string.IsNullOrEmpty(composition)) return null;
        var terrain = Parse(composition, tileData)[0].Rows!;
        return terrain.SequenceEqual(tileData.Split('\n')) ? null : terrain;
    }
}

public sealed record CompositionArtboard(int Width, int Height, string? Background = null);
/// <summary>Elemento livre de um mapa de imagem. Coordenadas em pixels do documento; fora do artboard é área externa.
/// <c>MapKey</c> (ADR-113, só na composição de cenas): a imagem é uma instância de um mapa com grade da campanha (<c>asset:{guid}</c>,
/// igual a <c>Src</c>); o mapa original nunca é copiado nem alterado. Opcional: documentos antigos não têm o campo.</summary>
public sealed record CompositionElement(
    string? Id, string? Layer, string? Type, string? Name = null, string? Src = null,
    double X = 0, double Y = 0, double Width = 0, double Height = 0, double Rotation = 0, double Opacity = 100,
    bool Visible = true, bool Locked = false, bool FlipX = false, bool FlipY = false,
    string? Text = null, double? FontSize = null, string? FontFamily = null, string? Color = null,
    string? Fill = null, string? Stroke = null, double? StrokeWidth = null, string? Align = null, bool? Bold = null, bool? Italic = null,
    string? Group = null, bool? Secret = null, string? MapKey = null);
public sealed record CompositionDocument(int V, CompositionArtboard? Artboard, List<EditorLayer?>? Layers, List<CompositionElement?>? Elements);

/// <summary>
/// Composição de um mapa de imagem (ADR-081 §4): artboard (área visível), camadas e elementos. Validação pura; o servidor guarda o JSON
/// normalizado e a imagem achatada. <c>src</c> aceita <c>self</c> (a imagem atual do mapa) ou <c>asset:{guid}</c> (imagem-fonte).
/// </summary>
public static partial class MapComposition
{
    public const int MaxElements = 200, MaxSources = 40, MaxLength = 400000;
    public const string Self = "self";
    static readonly string[] Types = ["image", "text", "rect", "ellipse"];
    static readonly string[] Fonts = ["serif", "sans", "display"];
    static readonly string[] Aligns = ["left", "center", "right"];
    static readonly JsonSerializerOptions Strict = new(EditorLayers.Json) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    [GeneratedRegex("^#[0-9a-fA-F]{6}$")] private static partial Regex Hex();
    [GeneratedRegex("^[A-Za-z0-9_-]{1,40}$")] private static partial Regex ElementId();
    [GeneratedRegex("^[a-z0-9-]{1,24}$")] private static partial Regex GroupId();

    static RuleException Invalid(string detail) => new(400, "Composição inválida: " + detail);

    /// <summary>Lê e valida o JSON enviado pelo editor. Devolve o documento normalizado e as imagens-fonte referenciadas.</summary>
    public static (CompositionDocument Document, HashSet<Guid> Sources, bool UsesSelf) Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Length > MaxLength) throw Invalid("envie o documento do editor (até 400 mil caracteres).");
        CompositionDocument? doc;
        try { doc = JsonSerializer.Deserialize<CompositionDocument>(json, Strict); }
        catch (JsonException) { throw Invalid("formato não reconhecido."); }
        catch (NotSupportedException) { throw Invalid("formato não reconhecido."); }
        if (doc is not { V: 1 }) throw Invalid("versão desconhecida.");
        return Validate(doc);
    }

    public static (CompositionDocument Document, HashSet<Guid> Sources, bool UsesSelf) Validate(CompositionDocument doc)
    {
        var a = doc.Artboard ?? throw Invalid("informe a área visível.");
        if (a.Width is < 64 or > 4096 || a.Height is < 64 or > 4096 || (long)a.Width * a.Height > 8000000)
            throw Invalid("a área visível vai de 64 a 4.096 pixels por lado, até 8 milhões de pixels.");
        var background = Color(a.Background ?? "#000000", "fundo")!;
        var layers = EditorLayers.Validate(doc.Layers);
        var layerIds = layers.Select(l => l.Id).ToHashSet(StringComparer.Ordinal);
        var input = doc.Elements ?? [];
        if (input.Count > MaxElements) throw Invalid($"use até {MaxElements} elementos.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var sources = new HashSet<Guid>();
        var usesSelf = false;
        var elements = new List<CompositionElement?>(input.Count);
        foreach (var e in input)
        {
            if (e?.Id == null || !ElementId().IsMatch(e.Id) || !ids.Add(e.Id)) throw Invalid("cada elemento precisa de um identificador único.");
            if (e.Layer == null || !layerIds.Contains(e.Layer)) throw Invalid("há elemento em uma camada inexistente.");
            if (e.Type == null || !Types.Contains(e.Type)) throw Invalid("tipo de elemento desconhecido.");
            static bool In(double v, double min, double max) => double.IsFinite(v) && v >= min && v <= max;
            if (!In(e.X, -16384, 20480) || !In(e.Y, -16384, 20480)) throw Invalid("posição fora da área de trabalho.");
            if (!In(e.Width, 1, 16384) || !In(e.Height, 1, 16384)) throw Invalid("largura e altura vão de 1 a 16.384 pixels.");
            if (!In(e.Rotation, -360, 360)) throw Invalid("a rotação vai de −360 a 360 graus.");
            if (!In(e.Opacity, 0, 100)) throw Invalid("a opacidade vai de 0 a 100.");
            var name = e.Name == null ? null : LibraryService.Clean(e.Name, false).Trim();
            if (name?.Length > 80) throw Invalid("o nome do elemento aceita até 80 caracteres.");
            if (e.Text?.Length > 500) throw Invalid("o texto aceita até 500 caracteres.");
            if (e.FontSize is { } fs && !In(fs, 6, 400)) throw Invalid("o tamanho da fonte vai de 6 a 400.");
            if (e.FontFamily != null && !Fonts.Contains(e.FontFamily)) throw Invalid("fonte desconhecida.");
            if (e.StrokeWidth is { } sw && !In(sw, 0, 100)) throw Invalid("o contorno vai de 0 a 100.");
            if (e.Align != null && !Aligns.Contains(e.Align)) throw Invalid("alinhamento desconhecido.");
            // Grupo (ADR-086): só organização no editor; não muda o achatamento nem o que a mesa recebe.
            if (e.Group != null && !GroupId().IsMatch(e.Group)) throw Invalid("grupo inválido.");
            string? src = null;
            if (e.Type == "image")
            {
                if (e.Src == Self) { src = Self; usesSelf = true; }
                else if (e.Src != null && e.Src.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal) && Guid.TryParse(e.Src[NpcImages.AssetPrefix.Length..], out var id))
                { src = NpcImages.AssetPrefix + id.ToString("D"); sources.Add(id); }
                else throw Invalid("imagem sem origem válida.");
            }
            else if (e.Src != null) throw Invalid("só elementos de imagem têm origem.");
            // Instância de mapa (ADR-113): mostra a própria imagem do mapa referenciado, então a chave tem de ser a mesma origem.
            string? mapKey = null;
            if (e.MapKey != null)
            {
                if (e.Type != "image" || src == null || src == Self || !e.MapKey.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal)
                    || !Guid.TryParse(e.MapKey[NpcImages.AssetPrefix.Length..], out var mapId) || NpcImages.AssetPrefix + mapId.ToString("D") != src)
                    throw Invalid("mapa inserido sem referência válida (asset:{id} igual à imagem).");
                mapKey = src;
            }
            elements.Add(e with
            {
                Name = name, Src = src, MapKey = mapKey, Text = e.Type == "text" ? e.Text ?? "" : e.Text, Secret = e.Secret == true ? true : null,
                Color = Color(e.Color, "cor"), Fill = Color(e.Fill, "preenchimento"), Stroke = Color(e.Stroke, "contorno"),
            });
        }
        if (sources.Count > MaxSources) throw Invalid($"use até {MaxSources} imagens-fonte por mapa.");
        return (new CompositionDocument(1, a with { Background = background }, [.. layers], elements), sources, usesSelf);
    }

    static string? Color(string? value, string what) =>
        value == null ? null : Hex().IsMatch(value) ? value.ToLowerInvariant() : throw Invalid($"use cor no formato #rrggbb ({what}).");

    /// <summary>Mapas não têm camada secreta (só a composição de cenas): a marca é removida.</summary>
    public static CompositionDocument WithoutSecrets(CompositionDocument doc) => doc with
    {
        Layers = doc.Layers?.Select(l => l == null ? null : l with { Secret = null }).ToList(),
        Elements = doc.Elements?.Select(e => e == null ? null : e with { Secret = null }).ToList(),
    };

    /// <summary>Mapas referenciados como instâncias (ADR-113) na composição de uma cena.</summary>
    public static HashSet<Guid> MapInstances(CompositionDocument doc) =>
        (doc.Elements ?? []).Select(e => e?.MapKey).Where(k => k != null && k.StartsWith(NpcImages.AssetPrefix, StringComparison.Ordinal))
            .Select(k => Guid.TryParse(k![NpcImages.AssetPrefix.Length..], out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToHashSet();

    /// <summary>Instâncias de mapa são recurso da composição de cenas: num mapa, a marca sai e a imagem continua como imagem-fonte.</summary>
    public static CompositionDocument WithoutMapKeys(CompositionDocument doc) => doc with
    {
        Elements = doc.Elements?.Select(e => e?.MapKey == null ? e : e with { MapKey = null }).ToList(),
    };

    /// <summary>Troca as origens das imagens (ex.: <c>self</c> pela imagem-fonte criada, ou fontes de uma cópia).</summary>
    public static CompositionDocument WithSources(CompositionDocument doc, Func<string, string> map) =>
        doc with { Elements = doc.Elements?.Select(e => e?.Src == null ? e : e with { Src = map(e.Src) }).ToList() };

    public static string Serialize(CompositionDocument doc)
    {
        var json = JsonSerializer.Serialize(doc, EditorLayers.Json);
        return json.Length > MaxLength ? throw Invalid("documento grande demais.") : json;
    }

    /// <summary>Composição guardada (já validada ao salvar); nula se ausente ou ilegível.</summary>
    public static CompositionDocument? Stored(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<CompositionDocument>(json, EditorLayers.Json) is { V: 1, Artboard: not null } doc ? doc : null; }
        catch (JsonException) { return null; }
    }

    /// <summary>Mapa antigo, sem composição: Base = imagem atual inteira (<c>self</c>) e Elementos vazio.</summary>
    public static CompositionDocument Synthesize(int width, int height) => new(1, new(width, height, "#000000"), [.. EditorLayers.Defaults()],
        [new CompositionElement("base-image", EditorLayers.Base, "image", "Imagem do mapa", Self, 0, 0, width, height)]);
}
