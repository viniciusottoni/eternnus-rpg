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
        Action = "action", Turn = "turn", Map = "map", Move = "move", Token = "token", Sheet = "sheet", Note = "note";
    public static readonly string[] Filterable = [Message, Roll, Action, Turn, Map, Move, Token, Sheet, Note, Join, Leave, Start, End];
}

public class CharacterAction
{
    [MaxLength(36)] public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = ActionKinds.Attack;
    /// <summary>Fórmula de dados opcional (ex.: 1d20+3). Vazia para ações narrativas.</summary>
    [MaxLength(300)] public string Formula { get; set; } = "";
    [MaxLength(300)] public string Description { get; set; } = "";
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
    /// <summary>Número do turno em que o jogador moveu o marcador; limita um deslocamento por turno.</summary>
    public int LastMovedTurn { get; set; }
}
