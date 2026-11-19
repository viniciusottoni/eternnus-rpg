using System.ComponentModel.DataAnnotations;
namespace Eternnus.Web;

public static class MapKinds
{
    public const string Cartographic = "cartographic";
    public const string Tileset = "tileset";
}

public static class ActionKinds
{
    public const string Attack = "ataque", Skill = "habilidade", Spell = "magia", Item = "item";
    public static readonly string[] All = [Attack, Skill, Spell, Item];
}

/// <summary>Tipos de evento da linha do tempo de uma sessão.</summary>
public static class EventKinds
{
    public const string Start = "start", End = "end", Join = "join", Leave = "leave", Message = "message", Roll = "roll",
        Action = "action", Turn = "turn", Map = "map", Move = "move", Token = "token", Sheet = "sheet", Note = "note",
        Request = "request", Pause = "pause", Scene = "scene", Music = "music";
    public static readonly string[] Filterable = [Message, Roll, Action, Turn, Map, Move, Token, Sheet, Note, Join, Leave, Start, End, Request, Pause, Scene, Music];
}

public class CharacterAction
{
    [MaxLength(36)] public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = ActionKinds.Attack;
    /// <summary>Fórmula de dados opcional (ex.: 1d20+3). Vazia para ações narrativas.</summary>
    [MaxLength(300)] public string Formula { get; set; } = "";
    [MaxLength(300)] public string Description { get; set; } = "";
    /// <summary>Nome do agrupamento no sistema (ex.: "Perícias", "Truques"); vazio = nome do tipo.</summary>
    [MaxLength(30)] public string? Group { get; set; }
}

/// <summary>Quem entrou na sessão. Presença é derivada de <see cref="LastSeenAt"/>, renovada por heartbeat.</summary>
public class SessionParticipant
{
    public Guid SessionId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    public Guid? CharacterId { get; set; }
    public bool IsMaster { get; set; }
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Marcador no tileset: personagem de jogador (CharacterId) ou criatura do mestre.</summary>
public class SessionToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SessionId { get; set; }
    public Guid? CharacterId { get; set; }
    [MaxLength(40)] public string Label { get; set; } = "";
    [MaxLength(10)] public string Side { get; set; } = "ally";
    public int X { get; set; }
    public int Y { get; set; }
    /// <summary>Posição dentro da casa em milésimos (0–999) nos mapas de movimentação livre; nulo = centro. Ver <see cref="FinePositions"/>.</summary>
    public int? Fx { get; set; }
    public int? Fy { get; set; }
    /// <summary>Número do turno em que o jogador moveu o marcador; limita um deslocamento por turno.</summary>
    public int LastMovedTurn { get; set; }
    /// <summary>Sobrescritas do mestre (nulo = valor da ficha/configuração). Raios em casas.</summary>
    public int? Light { get; set; }
    public int? Vision { get; set; }
    public int? Perception { get; set; }
    [MaxLength(400)] public string? Senses { get; set; }
    /// <summary>Oculto: só o mestre e os jogadores em <see cref="RevealedTo"/> o recebem.</summary>
    public bool Hidden { get; set; }
    /// <summary>Usuários para quem o marcador oculto foi revelado (JSON).</summary>
    public List<string> RevealedTo { get; set; } = [];
    /// <summary>Detecção automática: dificuldade de percepção, sentido exigido e distância máxima (casas).</summary>
    public int? Dc { get; set; }
    [MaxLength(40)] public string? DetectSense { get; set; }
    public int? DetectRange { get; set; }
    /// <summary>Personagem do mestre representado (cópia de encontro ou original).</summary>
    public Guid? MasterCharacterId { get; set; }
    /// <summary>Aparência escolhida pelo mestre (<see cref="TokenLooks"/>): marcador redondo ou imagem livre (PNG com transparência).</summary>
    [MaxLength(8)] public string Appearance { get; set; } = TokenLooks.Round;
    /// <summary>Tamanho em porcentagem da casa (<see cref="TokenLooks.MinSize"/>–<see cref="TokenLooks.MaxSize"/>). Só o mestre altera.</summary>
    public int Size { get; set; } = TokenLooks.DefaultSize;
    /// <summary>Imagem própria do marcador (asset:{id} do acervo da campanha ou https); nula = imagem do personagem do mestre, se houver.</summary>
    [MaxLength(500)] public string? ImageUrl { get; set; }
    /// <summary>
    /// Largura e altura da imagem livre em porcentagem da casa (<see cref="TokenLooks.MinSize"/>–<see cref="TokenLooks.MaxSize"/>), ADR-092.
    /// Ambas nulas = imagem encaixada no quadrado de <see cref="Size"/> (comportamento anterior). No mapa tático a imagem ocupa as casas (<see cref="TokenSpan"/>).
    /// </summary>
    public int? Width { get; set; }
    public int? Height { get; set; }
    /// <summary>Lugar de convidado com controle temporário deste marcador (ADR-114); nulo = sem convidado.</summary>
    public Guid? GuestSeatId { get; set; }
}

/// <summary>Aparência dos marcadores no mapa. O servidor só guarda; o desenho é do cliente (<c>table-map.js</c>).</summary>
public static class TokenLooks
{
    public const string Round = "round", Image = "image";
    public const int MinSize = 50, MaxSize = 800, DefaultSize = 100;
    public static string Require(string? appearance) =>
        appearance is Round or Image ? appearance : throw new RuleException(400, "Escolha marcador redondo ou imagem livre.");
    public static int RequireSize(int size) =>
        size is >= MinSize and <= MaxSize ? size : throw new RuleException(400, $"O tamanho vai de {MinSize}% a {MaxSize}% da casa.");
    /// <summary>Valores guardados em cenas antigas ou editados à mão voltam ao padrão em vez de recusar a cena.</summary>
    public static string Clean(string? appearance) => appearance is Image ? Image : Round;
    public static int CleanSize(int size) => size is >= MinSize and <= MaxSize ? size : DefaultSize;

    /// <summary>Largura e altura da imagem livre: as duas juntas (ou nenhuma), cada uma de <see cref="MinSize"/>% a <see cref="MaxSize"/>% da casa.</summary>
    public static (int? Width, int? Height) RequireSpan(int? width, int? height)
    {
        if (width == null && height == null) return (null, null);
        if (width is not { } w || height is not { } h) throw new RuleException(400, "Informe a largura e a altura da imagem.");
        if (w is < MinSize or > MaxSize || h is < MinSize or > MaxSize) throw new RuleException(400, $"A largura e a altura vão de {MinSize}% a {MaxSize}% da casa.");
        return (w, h);
    }
    /// <summary>Versão tolerante para cenas guardadas: par inválido volta ao encaixe no quadrado.</summary>
    public static (int? Width, int? Height) CleanSpan(int? width, int? height) =>
        width is >= MinSize and <= MaxSize && height is >= MinSize and <= MaxSize ? (width, height) : (null, null);
}

/// <summary>
/// Casas ocupadas por um marcador no mapa tático (ADR-092): a imagem livre com largura e altura ocupa
/// round(largura/100) × round(altura/100) casas a partir de (X, Y), canto superior esquerdo; os demais, só a própria casa.
/// Em mapas de movimentação livre não há ocupação (as casas podem ser divididas). Mesma conta de <c>token-look.js</c>.
/// </summary>
public readonly record struct TokenSpan(int W, int H)
{
    public static readonly TokenSpan One = new(1, 1);

    public static TokenSpan Of(string? appearance, int? width, int? height) =>
        appearance == TokenLooks.Image && width is { } w && height is { } h ? new(ToCells(w), ToCells(h)) : One;

    /// <summary>Porcentagem da casa → casas inteiras (mínimo uma). Ex.: 150% → 2.</summary>
    public static int ToCells(int percent) => Math.Max(1, (int)Math.Round(percent / 100.0, MidpointRounding.AwayFromZero));

    public IEnumerable<(int X, int Y)> Cells(int x, int y)
    {
        for (var dy = 0; dy < H; dy++)
            for (var dx = 0; dx < W; dx++) yield return (x + dx, y + dy);
    }

    /// <summary>Problema de pôr o marcador com o canto em (x, y): alguma casa fora da grade ou que bloqueia movimento. Nulo = cabe.</summary>
    public string? Problem(FogGrid grid, int x, int y)
    {
        foreach (var (cx, cy) in Cells(x, y))
        {
            if (!grid.Inside(cx, cy)) return W * H > 1 ? "A criatura não cabe no mapa nessa posição." : "Esse ponto do mapa está bloqueado.";
            if (grid.BlocksMove(cx, cy)) return W * H > 1 ? $"A casa {cx + 1}, {cy + 1}, sob a criatura, bloqueia movimento." : "Esse ponto do mapa está bloqueado.";
        }
        return null;
    }

    /// <summary>Alguma casa deste marcador em (x, y) já está ocupada?</summary>
    public bool Hits(int x, int y, IReadOnlySet<(int, int)> taken) => Cells(x, y).Any(taken.Contains);
}

public static class TokenSpans
{
    public static TokenSpan SpanOf(this SessionToken t) => TokenSpan.Of(t.Appearance, t.Width, t.Height);
    public static TokenSpan SpanOf(this SceneToken t) => TokenSpan.Of(t.Appearance, t.Width, t.Height);

    /// <summary>Todas as casas ocupadas pelos marcadores (menos <paramref name="except"/>), no mapa tático.</summary>
    public static HashSet<(int, int)> Taken(IEnumerable<SessionToken> tokens, Guid? except = null)
    {
        var set = new HashSet<(int, int)>();
        foreach (var t in tokens) if (t.Id != except) set.UnionWith(t.SpanOf().Cells(t.X, t.Y));
        return set;
    }
}
