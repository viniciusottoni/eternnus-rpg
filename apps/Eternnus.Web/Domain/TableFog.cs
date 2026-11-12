using System.Globalization;
using System.Text;
using System.Text.Json;
namespace Eternnus.Web;

/// <summary>
/// Configurações da mesa ao vivo. O sistema de RPG define o padrão; a campanha guarda os ajustes do mestre,
/// que valem para todas as sessões seguintes. Raios em casas; valores da ficha em metros.
/// </summary>
public sealed record TableSettings
{
    public bool FogEnabled { get; init; } = true;
    public bool RememberExplored { get; init; } = true;
    public bool PathMovement { get; init; } = true;
    public bool AlliesAlwaysVisible { get; init; } = true;
    public int TorchRadius { get; init; } = 4;
    public int BrazierRadius { get; init; } = 3;
    public int CreatureLight { get; init; }
    public int PlayerLightMeters { get; init; }
    public int PlayerVisionMeters { get; init; }
    /// <summary>Forma de condução sugerida (<see cref="PlayModes"/>); a sessão fixa a sua ao começar.</summary>
    public string PlayMode { get; init; } = PlayModes.Tactical;
    /// <summary>Revelação manual: com névoa, só as casas reveladas pelo mestre aparecem (luz e visão não revelam).</summary>
    public bool ManualReveal { get; init; }
    /// <summary>Quem vê as rolagens dos jogadores (<see cref="RollVisibility"/>: table, master ou blind). Jogadores não escolhem.</summary>
    public string PlayerRollVisibility { get; init; } = RollVisibility.Table;
    /// <summary>Jogador só move o próprio personagem depois que o mestre libera o movimento do turno (ver <see cref="GameSession.MoveGrantTurn"/>).</summary>
    public bool MoveNeedsGrant { get; init; } = true;

    public static readonly TableSettings Default = new();
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static TableSettings Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Default;
        try { return JsonSerializer.Deserialize<TableSettings>(json, Json)?.Clamp() ?? Default; }
        catch (JsonException) { return Default; }
    }
    public string Serialize() => JsonSerializer.Serialize(this, Json);

    /// <summary>Valida a entrada do mestre/admin. Lança 400 com mensagem em pt-BR.</summary>
    public TableSettings Validate()
    {
        if (TorchRadius is < 0 or > TableFog.MaxRadius || BrazierRadius is < 0 or > TableFog.MaxRadius || CreatureLight is < 0 or > TableFog.MaxRadius)
            throw new RuleException(400, $"Raios em casas devem ficar entre 0 e {TableFog.MaxRadius}.");
        if (PlayerLightMeters is < 0 or > 300 || PlayerVisionMeters is < 0 or > 300)
            throw new RuleException(400, "Luz e visão padrão dos personagens ficam entre 0 e 300 metros.");
        if (!PlayModes.IsValid(PlayMode)) throw new RuleException(400, "Escolha a forma de jogar: livre, por turnos ou tática.");
        if (!RollVisibility.IsPlayerChoice(PlayerRollVisibility)) throw new RuleException(400, "Escolha quem vê as rolagens dos jogadores.");
        return this;
    }
    TableSettings Clamp() => this with
    {
        TorchRadius = Math.Clamp(TorchRadius, 0, TableFog.MaxRadius), BrazierRadius = Math.Clamp(BrazierRadius, 0, TableFog.MaxRadius),
        CreatureLight = Math.Clamp(CreatureLight, 0, TableFog.MaxRadius),
        PlayerLightMeters = Math.Clamp(PlayerLightMeters, 0, 300), PlayerVisionMeters = Math.Clamp(PlayerVisionMeters, 0, 300),
        PlayMode = PlayModes.Effective(PlayMode),
        PlayerRollVisibility = RollVisibility.IsPlayerChoice(PlayerRollVisibility) ? PlayerRollVisibility : RollVisibility.Table,
    };
}

/// <summary>Foco de luz fixo do mapa.</summary>
public sealed class FogLight
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int X { get; set; }
    public int Y { get; set; }
    public int Radius { get; set; }
}

public static class FogMarkKinds
{
    public const string Door = "door", Trap = "trap", Clue = "clue";
    public static readonly string[] All = [Door, Trap, Clue];
}

/// <summary>Marca oculta numa casa (porta secreta, armadilha, pista). Só o mestre e quem a revelou a veem.</summary>
public sealed class FogMark
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int X { get; set; }
    public int Y { get; set; }
    public string Kind { get; set; } = FogMarkKinds.Trap;
    public string Label { get; set; } = "";
    public int? Dc { get; set; }
    public string? Sense { get; set; }
    public int? MaxDistance { get; set; }
    public bool RevealedAll { get; set; }
    public List<string> RevealedTo { get; set; } = [];
    public bool IsRevealedTo(string user) => RevealedAll || RevealedTo.Contains(user);
}

/// <summary>
/// Estado persistente de névoa/iluminação de um mapa da campanha. Vale para todas as sessões: o que o mestre ajusta
/// numa sessão continua na seguinte. Legenda de <see cref="Cells"/>: <c>.</c> livre, <c>m</c> bloqueia movimento,
/// <c>l</c> bloqueia luz, <c>#</c> parede (os dois), <c>d</c> porta fechada, <c>o</c> porta aberta.
/// </summary>
public sealed class MapFogState
{
    public bool? Fog { get; set; }
    /// <summary>Revelação manual neste mapa (cena); nulo = configuração da mesa.</summary>
    public bool? Manual { get; set; }
    public string[] Cells { get; set; } = [];
    public List<FogLight> Lights { get; set; } = [];
    /// <summary>Casas clareadas à mão pelo mestre (bitset em base64).</summary>
    public string Revealed { get; set; } = "";
    public List<FogMark> Marks { get; set; } = [];
    /// <summary>Casas já vistas por jogador (usuário → bitset em base64).</summary>
    public Dictionary<string, string> Explored { get; set; } = [];

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static MapFogState? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<MapFogState>(json, Json); } catch (JsonException) { return null; }
    }
    public string Serialize() => JsonSerializer.Serialize(this, Json);
}

public static class TableFog
{
    public const int MaxRadius = 30, MaxLights = 100, MaxMarks = 100, MaxLabel = 40, MaxSenses = 10, MaxSenseName = 40;
    public const char Free = '.', BlockMove = 'm', BlockLight = 'l', Wall = '#', DoorClosed = 'd', DoorOpen = 'o', Unknown = '?';
    const string Legend = ".mld#o";

    public static bool IsValidCell(char c) => Legend.Contains(c);
    public static bool BlocksMove(char c) => c is BlockMove or Wall or DoorClosed;
    public static bool BlocksLight(char c) => c is BlockLight or Wall or DoorClosed;

    /// <summary>Marcas iniciais a partir da legenda do tileset oficial; mapas enviados começam livres.</summary>
    public static MapFogState Initial(BattleMap map, TableSettings settings)
    {
        var cells = new string[map.Height];
        var lights = new List<FogLight>();
        for (var y = 0; y < map.Height; y++)
        {
            var row = new char[map.Width];
            for (var x = 0; x < map.Width; x++)
            {
                var c = map.Rows[y][x];
                row[x] = c switch
                {
                    '+' => DoorOpen,
                    _ when MapTiles.SightBlocks.Contains(c) => Wall,
                    _ when !map.CanStand(x, y) => BlockMove,
                    _ => Free,
                };
                if (c == 'T' && settings.TorchRadius > 0) lights.Add(new() { Id = $"t{x}-{y}", X = x, Y = y, Radius = settings.TorchRadius });
                if (c == 'b' && settings.BrazierRadius > 0) lights.Add(new() { Id = $"b{x}-{y}", X = x, Y = y, Radius = settings.BrazierRadius });
            }
            cells[y] = new string(row);
        }
        return new MapFogState { Cells = cells, Lights = lights };
    }

    /// <summary>Garante dimensões compatíveis com o mapa (o mapa pode ter mudado de grade): o que não cabe é descartado.</summary>
    public static MapFogState Fit(MapFogState state, BattleMap map, TableSettings settings)
    {
        if (state.Cells.Length == map.Height && state.Cells.All(r => r.Length == map.Width && r.All(IsValidCell))) return state;
        var initial = Initial(map, settings);
        for (var y = 0; y < map.Height && y < state.Cells.Length; y++)
        {
            var row = initial.Cells[y].ToCharArray();
            for (var x = 0; x < map.Width && x < state.Cells[y].Length; x++) if (IsValidCell(state.Cells[y][x])) row[x] = state.Cells[y][x];
            initial.Cells[y] = new string(row);
        }
        bool In(int x, int y) => x >= 0 && y >= 0 && x < map.Width && y < map.Height;
        return new MapFogState
        {
            Fog = state.Fog, Manual = state.Manual, Cells = initial.Cells, Lights = state.Lights.Where(l => In(l.X, l.Y)).ToList(), Marks = state.Marks.Where(m => In(m.X, m.Y)).ToList(),
            Revealed = Bits.Resize(state.Revealed, map.Width * map.Height), Explored = state.Explored.ToDictionary(e => e.Key, e => Bits.Resize(e.Value, map.Width * map.Height)),
        };
    }

    /// <summary>Converte metros da ficha em casas pela escala do mapa.</summary>
    public static int MetersToCells(int meters, decimal scale) => meters <= 0 || scale <= 0 ? 0 : Math.Min(MaxRadius, (int)decimal.Floor(meters / scale));

    /// <summary>Lista de sentidos da ficha: uma linha por sentido, "nome" ou "nome: alcance em metros".</summary>
    public static List<(string Name, int? Meters)> ParseSenses(string? text)
    {
        var result = new List<(string, int?)>();
        foreach (var raw in (text ?? "").Split(['\n', ';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (result.Count >= MaxSenses) break;
            var parts = raw.Split(':', 2, StringSplitOptions.TrimEntries);
            var name = SenseKey(parts[0]);
            if (name.Length == 0 || name.Length > MaxSenseName) continue;
            int? meters = parts.Length == 2 && int.TryParse(parts[1].Replace("m", "", StringComparison.OrdinalIgnoreCase).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var m) ? Math.Clamp(m, 0, 300) : null;
            result.Add((name, meters));
        }
        return result;
    }

    /// <summary>Normaliza o nome de um sentido: minúsculas, sem acentos e espaços nas pontas.</summary>
    public static string SenseKey(string? name)
    {
        var text = (name ?? "").Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(text.Length);
        foreach (var ch in text) if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(ch);
        return System.Text.RegularExpressions.Regex.Replace(sb.ToString().Normalize(NormalizationForm.FormC), @"\s+", " ");
    }

    public static double Distance(int x1, int y1, int x2, int y2) => Math.Sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
}

/// <summary>Grade combinada (mapa + marcas) usada para luz, visão e movimento.</summary>
public sealed class FogGrid
{
    public int Width { get; }
    public int Height { get; }
    readonly char[] cells;
    public FogGrid(int width, int height, IReadOnlyList<string> rows)
    {
        Width = width; Height = height; cells = new char[width * height];
        for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
            cells[y * width + x] = y < rows.Count && x < rows[y].Length && TableFog.IsValidCell(rows[y][x]) ? rows[y][x] : TableFog.Free;
    }
    public bool Inside(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;
    public char At(int x, int y) => cells[y * Width + x];
    public bool BlocksLight(int x, int y) => !Inside(x, y) || TableFog.BlocksLight(At(x, y));
    public bool BlocksMove(int x, int y) => !Inside(x, y) || TableFog.BlocksMove(At(x, y));
    public int Index(int x, int y) => y * Width + x;

    /// <summary>
    /// Linha entre os centros das casas: bloqueada se atravessar casa que bloqueia luz (sem contar origem e destino)
    /// ou se passar exatamente pelo canto entre duas casas bloqueadas. Simétrica: A→B e B→A dão o mesmo resultado.
    /// </summary>
    public bool LineClear(int x0, int y0, int x1, int y1)
    {
        int dx = x1 - x0, dy = y1 - y0;
        int nx = Math.Abs(dx), ny = Math.Abs(dy);
        int sx = Math.Sign(dx), sy = Math.Sign(dy);
        int x = x0, y = y0;
        // Passo inteiro sobre a reta (Amanatides–Woo) comparando (0,5 + ix)/nx com (0,5 + iy)/ny sem ponto flutuante.
        for (int ix = 0, iy = 0; ix < nx || iy < ny;)
        {
            var cmp = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
            if (cmp == 0)
            {
                // Passa pelo canto: bloqueado só se as duas vizinhas laterais bloqueiam.
                if (BlocksLight(x + sx, y) && BlocksLight(x, y + sy)) return false;
                x += sx; y += sy; ix++; iy++;
            }
            else if (cmp < 0) { x += sx; ix++; }
            else { y += sy; iy++; }
            if ((x != x1 || y != y1) && BlocksLight(x, y)) return false;
        }
        return true;
    }

    /// <summary>Casas atingidas por uma fonte circular (distância euclidiana entre centros ≤ raio) e com linha livre.</summary>
    public void Reach(int sx, int sy, int radius, bool[] into)
    {
        if (radius <= 0 || !Inside(sx, sy)) return;
        var r2 = radius * radius;
        for (var y = Math.Max(0, sy - radius); y <= Math.Min(Height - 1, sy + radius); y++)
            for (var x = Math.Max(0, sx - radius); x <= Math.Min(Width - 1, sx + radius); x++)
            {
                var i = y * Width + x;
                if (into[i] || (x - sx) * (x - sx) + (y - sy) * (y - sy) > r2) continue;
                if (LineClear(sx, sy, x, y)) into[i] = true;
            }
    }
}

/// <summary>Conjunto de casas codificado em base64 (bit i = casa i).</summary>
public static class Bits
{
    public static bool[] Decode(string? value, int count)
    {
        var result = new bool[count];
        if (string.IsNullOrEmpty(value)) return result;
        byte[] bytes;
        try { bytes = Convert.FromBase64String(value); } catch (FormatException) { return result; }
        for (var i = 0; i < count && i / 8 < bytes.Length; i++) result[i] = (bytes[i / 8] & (1 << (i % 8))) != 0;
        return result;
    }
    public static string Encode(bool[] set)
    {
        if (!set.Any(b => b)) return "";
        var bytes = new byte[(set.Length + 7) / 8];
        for (var i = 0; i < set.Length; i++) if (set[i]) bytes[i / 8] |= (byte)(1 << (i % 8));
        return Convert.ToBase64String(bytes);
    }
    public static string Resize(string? value, int count) => Encode(Decode(value, count));
    public static bool[] Or(bool[] a, bool[] b) { var r = new bool[a.Length]; for (var i = 0; i < a.Length; i++) r[i] = a[i] || b[i]; return r; }
}

/// <summary>Marcador já resolvido com valores efetivos (ficha + sobrescrita do mestre + configuração).</summary>
public sealed record FogToken(Guid Id, Guid? CharacterId, string? OwnerUserId, string Side, int X, int Y, int Light, int Vision, int Perception,
    IReadOnlyList<(string Name, int? Cells)> Senses, bool Hidden, IReadOnlyCollection<string> RevealedTo, int? Dc, string? Sense, int? DetectRange)
{
    public bool IsCharacter => CharacterId != null;
}

/// <summary>O que um jogador enxerga num instante.</summary>
public sealed record FogView(bool[] Visible, bool[] Explored, HashSet<Guid> Tokens, HashSet<Guid> PerceivedTokens, HashSet<string> Marks);

/// <summary>Regras puras de visibilidade e detecção. O servidor decide; o cliente só desenha o resultado.</summary>
public static class FogRules
{
    /// <summary>Casas iluminadas para todos: focos do mapa, luz de marcadores não ocultos e casas reveladas pelo mestre.</summary>
    public static bool[] Shared(FogGrid grid, MapFogState state, IEnumerable<FogToken> tokens)
    {
        var lit = Bits.Decode(state.Revealed, grid.Width * grid.Height);
        foreach (var l in state.Lights) grid.Reach(l.X, l.Y, l.Radius, lit);
        foreach (var t in tokens) if (!t.Hidden) grid.Reach(t.X, t.Y, t.Light, lit);
        return lit;
    }

    /// <summary>Visão de um jogador: luz compartilhada + visão própria dos personagens dele.</summary>
    public static bool[] Visible(FogGrid grid, bool[] shared, IEnumerable<FogToken> tokens, string user)
    {
        var visible = (bool[])shared.Clone();
        foreach (var t in tokens) if (t.OwnerUserId == user) grid.Reach(t.X, t.Y, t.Vision, visible);
        return visible;
    }

    /// <summary>Uma criatura oculta é percebida por sentido: alcance do sentido sem bloqueio de luz no caminho; sem alcance, basta estar visível.</summary>
    static bool SensedBy(FogGrid grid, FogToken viewer, string? required, int x, int y, bool[] visible)
    {
        if (string.IsNullOrEmpty(required)) return false;
        var key = TableFog.SenseKey(required);
        foreach (var (name, cells) in viewer.Senses)
        {
            if (name != key) continue;
            if (cells is null) { if (visible[grid.Index(x, y)]) return true; continue; }
            if (TableFog.Distance(viewer.X, viewer.Y, x, y) <= cells.Value && grid.LineClear(viewer.X, viewer.Y, x, y)) return true;
        }
        return false;
    }

    static bool PerceivedBy(FogGrid grid, FogToken viewer, int? dc, int? maxDistance, int x, int y, bool[] visible) =>
        dc is { } d && viewer.Perception >= d && visible[grid.Index(x, y)] && (maxDistance is not { } m || TableFog.Distance(viewer.X, viewer.Y, x, y) <= m);

    /// <summary>Detecção automática: devolve (alvo, usuário) recém-percebidos. Marcas usam o prefixo "mark:".</summary>
    public static List<(string Target, string User, string Viewer)> Detect(FogGrid grid, MapFogState state, IReadOnlyList<FogToken> tokens, bool[] shared)
    {
        var found = new List<(string, string, string)>();
        foreach (var viewer in tokens.Where(t => t.IsCharacter && t.OwnerUserId != null))
        {
            var user = viewer.OwnerUserId!;
            var visible = Visible(grid, shared, tokens, user);
            foreach (var t in tokens.Where(t => t.Hidden && !t.IsCharacter && !t.RevealedTo.Contains(user)))
                if (PerceivedBy(grid, viewer, t.Dc, t.DetectRange, t.X, t.Y, visible) || SensedBy(grid, viewer, t.Sense, t.X, t.Y, visible))
                    if (!found.Any(f => f.Item1 == t.Id.ToString() && f.Item2 == user)) found.Add((t.Id.ToString(), user, viewer.Id.ToString()));
            foreach (var m in state.Marks.Where(m => !m.IsRevealedTo(user)))
                if (PerceivedBy(grid, viewer, m.Dc, m.MaxDistance, m.X, m.Y, visible) || SensedBy(grid, viewer, m.Sense, m.X, m.Y, visible))
                    if (!found.Any(f => f.Item1 == "mark:" + m.Id && f.Item2 == user)) found.Add(("mark:" + m.Id, user, viewer.Id.ToString()));
        }
        return found;
    }

    /// <summary>Visão completa de um jogador: casas visíveis/exploradas, marcadores e marcas que ele pode receber.</summary>
    public static FogView View(FogGrid grid, MapFogState state, IReadOnlyList<FogToken> tokens, bool[] shared, string user, TableSettings settings)
    {
        var visible = Visible(grid, shared, tokens, user);
        var stored = state.Explored.TryGetValue(user, out var e) ? Bits.Decode(e, visible.Length) : new bool[visible.Length];
        var explored = Bits.Or(stored, visible);
        var mine = tokens.Where(t => t.OwnerUserId == user).ToList();
        var shown = new HashSet<Guid>(); var perceived = new HashSet<Guid>();
        foreach (var t in tokens)
        {
            if (t.IsCharacter) { shown.Add(t.Id); continue; }
            var revealed = !t.Hidden || t.RevealedTo.Contains(user);
            if (!revealed) continue;
            if (!t.Hidden && t.Side == "ally" && settings.AlliesAlwaysVisible) { shown.Add(t.Id); continue; }
            if (visible[grid.Index(t.X, t.Y)]) { shown.Add(t.Id); continue; }
            if (t.Hidden && mine.Any(v => SensedBy(grid, v, t.Sense, t.X, t.Y, visible))) { shown.Add(t.Id); perceived.Add(t.Id); }
        }
        var marks = state.Marks.Where(m => m.IsRevealedTo(user)).Select(m => m.Id).ToHashSet();
        return new FogView(visible, explored, shown, perceived, marks);
    }

    /// <summary>
    /// Caminho mais curto (passos com diagonal 1, sem cortar canto entre dois bloqueios) por casas livres, desocupadas e
    /// conhecidas pelo jogador. Devolve o número de passos ou null.
    /// </summary>
    public static int? PathLength(FogGrid grid, int fromX, int fromY, int toX, int toY, int limit, Func<int, int, bool> passable)
    {
        if (fromX == toX && fromY == toY) return 0;
        var dist = new int[grid.Width * grid.Height];
        Array.Fill(dist, -1);
        var queue = new Queue<(int X, int Y)>();
        dist[grid.Index(fromX, fromY)] = 0; queue.Enqueue((fromX, fromY));
        while (queue.Count > 0)
        {
            var (x, y) = queue.Dequeue();
            var d = dist[grid.Index(x, y)];
            if (d >= limit) continue;
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++)
            {
                if (ox == 0 && oy == 0) continue;
                int nx = x + ox, ny = y + oy;
                if (!grid.Inside(nx, ny) || dist[grid.Index(nx, ny)] >= 0 || grid.BlocksMove(nx, ny) || !passable(nx, ny)) continue;
                if (ox != 0 && oy != 0 && grid.BlocksMove(x + ox, y) && grid.BlocksMove(x, y + oy)) continue;
                dist[grid.Index(nx, ny)] = d + 1;
                if (nx == toX && ny == toY) return d + 1;
                queue.Enqueue((nx, ny));
            }
        }
        return null;
    }
}
