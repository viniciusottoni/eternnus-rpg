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

/// <summary>
/// Foco de luz fixo do mapa. <see cref="Radius"/> é a luz plena; <see cref="Dim"/> (opcional, ≥ raio) estende a penumbra,
/// que também ilumina para as regras. Cor, intensidade e animação são só apresentação (o servidor não as usa para decidir nada).
/// </summary>
public sealed class FogLight
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int X { get; set; }
    public int Y { get; set; }
    public int Radius { get; set; }
    public int? Dim { get; set; }
    /// <summary>Cor no formato #rrggbb; nulo = luz quente padrão.</summary>
    public string? Color { get; set; }
    /// <summary>Intensidade visual de 10 a 100; nulo = 100.</summary>
    public int? Intensity { get; set; }
    /// <summary>Animação sutil opcional (<see cref="FogLightAnimations"/>); nula = fixa. A mesa respeita redução de movimento.</summary>
    public string? Animation { get; set; }
    /// <summary>Alcance que conta para as regras: luz plena ou penumbra, o maior.</summary>
    public int Reach => Math.Max(Radius, Dim ?? 0);
    public FogLight Clone() => new() { Id = Id, X = X, Y = Y, Radius = Radius, Dim = Dim, Color = Color, Intensity = Intensity, Animation = Animation };
}

public static class FogLightAnimations
{
    public const string Flicker = "flicker", Pulse = "pulse";
    public static bool IsValid(string? v) => v is null or Flicker or Pulse;
}

/// <summary>
/// Tipos de parede vetorial. A geometria vale para as regras; o desenho é decidido pelo cliente.
/// <list type="bullet">
/// <item><c>wall</c>: bloqueia movimento e visão.</item>
/// <item><c>door</c>: como parede quando fechada; livre quando aberta.</item>
/// <item><c>window</c>: bloqueia movimento, deixa a visão e a luz passarem.</item>
/// <item><c>sight</c>: bloqueia só visão e luz (cortina, ilusão); dá para atravessar.</item>
/// <item><c>move</c>: bloqueia só movimento (barreira invisível, beirada).</item>
/// </list>
/// </summary>
public static class FogWallKinds
{
    public const string Wall = "wall", Door = "door", Window = "window", Sight = "sight", Move = "move";
    public static readonly string[] All = [Wall, Door, Window, Sight, Move];
    public static bool BlocksMove(FogWall w) => w.Kind switch { Wall or Window or Move => true, Door => !w.Open, _ => false };
    public static bool BlocksSight(FogWall w) => w.Kind switch { Wall or Sight => true, Door => !w.Open, _ => false };
}

/// <summary>
/// Segmento de parede em coordenadas do documento, independentes da resolução da tela: centésimos de casa
/// (<see cref="TableFog.WallUnit"/> por casa; a casa (x, y) ocupa [100x, 100x+100] e o centro fica em 100x+50).
/// Inteiros garantem o mesmo resultado no servidor e no cliente.
/// </summary>
public sealed class FogWall
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int X1 { get; set; }
    public int Y1 { get; set; }
    public int X2 { get; set; }
    public int Y2 { get; set; }
    public string Kind { get; set; } = FogWallKinds.Wall;
    /// <summary>Porta aberta (estado da partida; na preparação é o estado inicial).</summary>
    public bool Open { get; set; }
    /// <summary>Não aparece para os jogadores como parede/porta (porta secreta, barreira invisível). Continua valendo nas regras.</summary>
    public bool Hidden { get; set; }
    public FogWall Clone() => new() { Id = Id, X1 = X1, Y1 = Y1, X2 = X2, Y2 = Y2, Kind = Kind, Open = Open, Hidden = Hidden };
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
    /// <summary>Paredes vetoriais (ADR-087). Somam-se às casas bloqueadas de <see cref="Cells"/>; mapas antigos não têm nenhuma.</summary>
    public List<FogWall> Walls { get; set; } = [];
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
    /// <summary>Subdivisões por casa das coordenadas de parede e limite de segmentos por mapa.</summary>
    public const int WallUnit = 100, MaxWalls = 2000;
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
        state.Walls ??= [];
        if (state.Cells.Length == map.Height && state.Cells.All(r => r.Length == map.Width && r.All(IsValidCell)) && WallsInside(state.Walls, map.Width, map.Height)) return state;
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
            Walls = FitWalls(state.Walls, map.Width, map.Height),
        };
    }

    static bool WallsInside(List<FogWall> walls, int width, int height)
    {
        int w = width * WallUnit, h = height * WallUnit;
        return walls.All(s => s.X1 >= 0 && s.Y1 >= 0 && s.X2 >= 0 && s.Y2 >= 0 && s.X1 <= w && s.X2 <= w && s.Y1 <= h && s.Y2 <= h && (s.X1 != s.X2 || s.Y1 != s.Y2));
    }

    /// <summary>Grade menor: pontas de parede fora do mapa vão para a borda; segmentos que somem (comprimento zero) saem.</summary>
    public static List<FogWall> FitWalls(IEnumerable<FogWall> walls, int width, int height)
    {
        int w = width * WallUnit, h = height * WallUnit;
        var result = new List<FogWall>();
        foreach (var s in walls)
        {
            var c = s.Clone();
            c.X1 = Math.Clamp(c.X1, 0, w); c.X2 = Math.Clamp(c.X2, 0, w); c.Y1 = Math.Clamp(c.Y1, 0, h); c.Y2 = Math.Clamp(c.Y2, 0, h);
            if (c.X1 != c.X2 || c.Y1 != c.Y2) result.Add(c);
        }
        return result;
    }

    /// <summary>
    /// Converte as paredes para uma nova grade do mesmo desenho (lado e deslocamento em pixels mudaram): a geometria continua
    /// sobre o mesmo ponto da imagem. Coordenadas em pixels: p = deslocamento + casas × lado.
    /// </summary>
    public static List<FogWall> Regrid(IEnumerable<FogWall> walls, int oldPixels, int oldOffsetX, int oldOffsetY, int newPixels, int newOffsetX, int newOffsetY)
    {
        int Map(int v, int oldOff, int newOff) => (int)Math.Round(((double)oldOff * WallUnit + (double)v * oldPixels - (double)newOff * WallUnit) / newPixels, MidpointRounding.AwayFromZero);
        return walls.Select(s => { var c = s.Clone(); c.X1 = Map(s.X1, oldOffsetX, newOffsetX); c.X2 = Map(s.X2, oldOffsetX, newOffsetX); c.Y1 = Map(s.Y1, oldOffsetY, newOffsetY); c.Y2 = Map(s.Y2, oldOffsetY, newOffsetY); return c; }).ToList();
    }

    /// <summary>Valida a lista de paredes vinda do editor ou da mesa. Lança 400/409 com mensagem em pt-BR.</summary>
    public static List<FogWall> ValidWalls(IEnumerable<FogWall>? input, int width, int height)
    {
        var list = input?.ToList() ?? [];
        if (list.Count > MaxWalls) throw new RuleException(409, $"Limite de {MaxWalls} segmentos de parede por mapa.");
        int w = width * WallUnit, h = height * WallUnit;
        var ids = new HashSet<string>();
        var result = new List<FogWall>(list.Count);
        foreach (var s in list)
        {
            if (s == null) throw new RuleException(400, "Parede inválida.");
            if (!FogWallKinds.All.Contains(s.Kind)) throw new RuleException(400, "Tipo de parede inválido.");
            if (s.X1 < 0 || s.Y1 < 0 || s.X2 < 0 || s.Y2 < 0 || s.X1 > w || s.X2 > w || s.Y1 > h || s.Y2 > h) throw new RuleException(400, "Há uma parede fora do mapa.");
            if (s.X1 == s.X2 && s.Y1 == s.Y2) throw new RuleException(400, "Uma parede precisa de dois pontos diferentes.");
            var id = string.IsNullOrWhiteSpace(s.Id) || s.Id.Length > 40 || !s.Id.All(char.IsAsciiLetterOrDigit) ? Guid.NewGuid().ToString("N") : s.Id;
            if (!ids.Add(id)) id = Guid.NewGuid().ToString("N");
            result.Add(new FogWall { Id = id, X1 = s.X1, Y1 = s.Y1, X2 = s.X2, Y2 = s.Y2, Kind = s.Kind, Open = s.Kind == FogWallKinds.Door && s.Open, Hidden = s.Hidden });
        }
        return result;
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
    /// <summary>Segmentos que bloqueiam visão/luz e os que bloqueiam movimento, já resolvidos (portas abertas não entram).</summary>
    readonly WallSeg[] sight, move;
    public bool HasWalls => sight.Length > 0 || move.Length > 0;

    public FogGrid(int width, int height, IReadOnlyList<string> rows, IEnumerable<FogWall>? walls = null)
    {
        Width = width; Height = height; cells = new char[width * height];
        for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
            cells[y * width + x] = y < rows.Count && x < rows[y].Length && TableFog.IsValidCell(rows[y][x]) ? rows[y][x] : TableFog.Free;
        var list = walls?.ToList() ?? [];
        sight = list.Where(FogWallKinds.BlocksSight).Select(WallSeg.Of).ToArray();
        move = list.Where(FogWallKinds.BlocksMove).Select(WallSeg.Of).ToArray();
    }

    /// <summary>Grade de regras de uma camada: casas + paredes vetoriais.</summary>
    public static FogGrid Of(BattleMap map, MapFogState state) => new(map.Width, map.Height, state.Cells, state.Walls);

    readonly record struct WallSeg(long X1, long Y1, long X2, long Y2)
    {
        public static WallSeg Of(FogWall w) => new(w.X1, w.Y1, w.X2, w.Y2);
        public bool Near(long minX, long minY, long maxX, long maxY) =>
            Math.Max(X1, X2) >= minX && Math.Min(X1, X2) <= maxX && Math.Max(Y1, Y2) >= minY && Math.Min(Y1, Y2) <= maxY;
    }

    static long Orient(long ax, long ay, long bx, long by, long cx, long cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    /// <summary>
    /// O segmento A→B (entre centros de casas) atravessa alguma parede? Cruzamento próprio bloqueia. Quando a reta passa exatamente
    /// por uma ponta de parede, bloqueia só se nessa ponta houver parede dos dois lados da reta (junção de uma parede contínua ou
    /// canto fechado); tangenciar uma ponta solta, passar ao longo da parede ou terminar sobre ela não bloqueia (a face fica visível).
    /// Inteiros: o cliente (<c>wallsBlock</c> em fog-policy.js) dá exatamente o mesmo resultado.
    /// </summary>
    static bool Crosses(ReadOnlySpan<WallSeg> segs, long ax, long ay, long bx, long by)
    {
        List<(long X, long Y, int Side)>? touches = null;
        long minX = Math.Min(ax, bx), maxX = Math.Max(ax, bx), minY = Math.Min(ay, by), maxY = Math.Max(ay, by);
        foreach (var s in segs)
        {
            if (!s.Near(minX, minY, maxX, maxY)) continue;
            var d1 = Math.Sign(Orient(ax, ay, bx, by, s.X1, s.Y1));
            var d2 = Math.Sign(Orient(ax, ay, bx, by, s.X2, s.Y2));
            if (d1 == d2) continue; // os dois do mesmo lado ou colineares
            var d3 = Math.Sign(Orient(s.X1, s.Y1, s.X2, s.Y2, ax, ay));
            var d4 = Math.Sign(Orient(s.X1, s.Y1, s.X2, s.Y2, bx, by));
            if (d3 == 0 || d4 == 0 || d3 == d4) continue; // termina sobre a parede ou não a alcança
            if (d1 != 0 && d2 != 0) return true;
            // Uma ponta da parede está sobre a reta, entre A e B: anota o lado da outra ponta.
            if (d1 == 0) (touches ??= []).Add((s.X1, s.Y1, d2)); else (touches ??= []).Add((s.X2, s.Y2, d1));
        }
        if (touches == null) return false;
        for (var i = 0; i < touches.Count; i++)
            for (var j = i + 1; j < touches.Count; j++)
                if (touches[i].X == touches[j].X && touches[i].Y == touches[j].Y && touches[i].Side != touches[j].Side) return true;
        return false;
    }

    static long Center(int c) => (long)c * TableFog.WallUnit + TableFog.WallUnit / 2;

    /// <summary>Uma parede que bloqueia movimento separa duas casas vizinhas?</summary>
    public bool StepBlocked(int x0, int y0, int x1, int y1) => move.Length > 0 && Crosses(move, Center(x0), Center(y0), Center(x1), Center(y1));

    /// <summary>Uma parede que bloqueia visão corta a linha entre os centros das duas casas?</summary>
    public bool WallBlocksSight(int x0, int y0, int x1, int y1) => sight.Length > 0 && Crosses(sight, Center(x0), Center(y0), Center(x1), Center(y1));
    public bool Inside(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;
    public char At(int x, int y) => cells[y * Width + x];
    public bool BlocksLight(int x, int y) => !Inside(x, y) || TableFog.BlocksLight(At(x, y));
    public bool BlocksMove(int x, int y) => !Inside(x, y) || TableFog.BlocksMove(At(x, y));
    public int Index(int x, int y) => y * Width + x;

    /// <summary>
    /// Linha entre os centros das casas: bloqueada se atravessar casa que bloqueia luz (sem contar origem e destino)
    /// ou se passar exatamente pelo canto entre duas casas bloqueadas. Simétrica: A→B e B→A dão o mesmo resultado.
    /// </summary>
    public bool LineClear(int x0, int y0, int x1, int y1) => CellLineClear(x0, y0, x1, y1) && !WallBlocksSight(x0, y0, x1, y1);

    bool CellLineClear(int x0, int y0, int x1, int y1)
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
        // Só as paredes perto do alcance entram na conta (mapas grandes com muitas paredes).
        long u = TableFog.WallUnit, cx = Center(sx), cy = Center(sy), span = radius * u + u;
        var near = sight.Length == 0 ? [] : Array.FindAll(sight, s => s.Near(cx - span, cy - span, cx + span, cy + span));
        for (var y = Math.Max(0, sy - radius); y <= Math.Min(Height - 1, sy + radius); y++)
            for (var x = Math.Max(0, sx - radius); x <= Math.Min(Width - 1, sx + radius); x++)
            {
                var i = y * Width + x;
                if (into[i] || (x - sx) * (x - sx) + (y - sy) * (y - sy) > r2) continue;
                if (CellLineClear(sx, sy, x, y) && (near.Length == 0 || !Crosses(near, cx, cy, Center(x), Center(y)))) into[i] = true;
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
    IReadOnlyList<(string Name, int? Cells)> Senses, bool Hidden, IReadOnlyCollection<string> RevealedTo, int? Dc, string? Sense, int? DetectRange, int W = 1, int H = 1)
{
    public bool IsCharacter => CharacterId != null;

    /// <summary>Alguma casa da área do marcador (criatura grande no mapa tático, ADR-092) está marcada em <paramref name="cells"/>?</summary>
    public bool AnyIn(FogGrid grid, bool[] cells) => new TokenSpan(W, H).Cells(X, Y).Any(c => grid.Inside(c.X, c.Y) && cells[grid.Index(c.X, c.Y)]);
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
        foreach (var l in state.Lights) grid.Reach(l.X, l.Y, l.Reach, lit);
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
            // Criatura grande: aparece quando qualquer parte dela está à vista.
            if (t.AnyIn(grid, visible)) { shown.Add(t.Id); continue; }
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
                if (grid.StepBlocked(x, y, nx, ny)) continue;
                dist[grid.Index(nx, ny)] = d + 1;
                if (nx == toX && ny == toY) return d + 1;
                queue.Enqueue((nx, ny));
            }
        }
        return null;
    }
}
