using System.ComponentModel.DataAnnotations;
namespace Eternnus.Web;

public class CampaignCharacter
{
    public Guid CampaignId { get; set; }
    public Guid CharacterId { get; set; }
}
public class Character
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(450)] public string OwnerId { get; set; } = "";
    [MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(80)] public string Archetype { get; set; } = "";
    public int Level { get; set; } = 1;
    public int Hp { get; set; } = 10;
    public int MaxHp { get; set; } = 10;
    public int Strength { get; set; } = 10;
    public int Agility { get; set; } = 10;
    public int Intellect { get; set; } = 10;
    public int Constitution { get; set; } = 10;
    public int Armor { get; set; } = 10;
    /// <summary>Deslocamento por turno em metros; cada quadrado do tileset representa 1,5 m.</summary>
    public int Movement { get; set; } = 9;
    [MaxLength(10000)] public string Notes { get; set; } = "";
    /// <summary>Ações criadas pelo jogador e usadas durante o próprio turno. Persistidas como JSON e versionadas com a ficha.</summary>
    public List<CharacterAction> Actions { get; set; } = [];
    /// <summary>Versão da ficha-modelo em que a ficha nasceu (presa até o jogador migrar).</summary>
    public Guid? TemplateVersionId { get; set; }
    /// <summary>JSON objeto { nomeDoCampo: valor-texto } com os valores dos campos editáveis do modelo.
    /// Campos com papel (hp, maxHp, movement, armor, level, name) também são espelhados nas colunas clássicas acima, usadas pela mesa.</summary>
    [MaxLength(100000)] public string Values { get; set; } = "{}";
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Restringe a ficha ao dono e aos mestres das campanhas vinculadas.</summary>
    public bool Private { get; set; }
}
public class CharacterVersion
{
    public long Id { get; set; }
    public Guid CharacterId { get; set; }
    public int Revision { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Snapshot { get; set; } = "";
    [MaxLength(450)] public string? ChangedById { get; set; }
    public Guid? SessionId { get; set; }
}
public class Campaign
{
    public bool IsOneShot { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? MasterLastSeenAt { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime LastActivityAt { get; set; } = DateTime.UtcNow;
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(450)] public string OwnerId { get; set; } = "";
    [MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(5000)] public string Description { get; set; } = "";
    /// <summary>Nome do sistema (cópia legível de <see cref="RpgSystemId"/>, mantida pelo serviço).</summary>
    [MaxLength(80)] public string System { get; set; } = "Sistema livre";
    public Guid RpgSystemId { get; set; } = RpgSystem.FreeSystemId;
    /// <summary>Ficha-modelo escolhida pelo mestre; nula = modelo padrão do sistema.</summary>
    public Guid? SheetTemplateId { get; set; }
    [MaxLength(32)] public string InviteCode { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class Member
{
    public Guid CampaignId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
}
/// <summary>Recibo mínimo vitalício de uso de one-shot; não preserva conteúdo da mesa encerrada.</summary>
public class OneShotParticipation
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    public Guid CampaignId { get; set; }
}
/// <summary>
/// Uma sessão de jogo da campanha. Sem <see cref="EndedAt"/>, a sessão está em andamento e a campanha fica online.
/// O índice único filtrado garante no máximo uma sessão ativa por campanha.
/// </summary>
public class GameSession
{
    public Guid? TemporaryImageId { get; set; }
    [MaxLength(120)] public string TemporaryImageTitle { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public int Number { get; set; }
    [MaxLength(120)] public string Title { get; set; } = "";
    /// <summary>Objetivo/nota inicial do mestre. A coluna preserva até 10.000 caracteres das sessões agendadas anteriores; novas entradas aceitam 2.000.</summary>
    [MaxLength(10000)] public string Objective { get; set; } = "";
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndedAt { get; set; }
    [MaxLength(20)] public string MapKind { get; set; } = MapKinds.Tileset;
    [MaxLength(80)] public string MapKey { get; set; } = "";
    public Guid? ActiveCharacterId { get; set; }
    /// <summary>Último personagem que recebeu o turno; mantém a rotação quando o jogador encerra a própria vez.</summary>
    public Guid? LastActiveCharacterId { get; set; }
    public int TurnNumber { get; set; }
    /// <summary>Incrementa em toda alteração visível da mesa; o cliente ao vivo aguarda uma revisão maior que a conhecida.</summary>
    public int Revision { get; set; } = 1;
}
public class MasterResource
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(20)] public string Kind { get; set; } = "npc";
    [MaxLength(120)] public string Name { get; set; } = "";
    [MaxLength(10000)] public string Content { get; set; } = "";
    public bool Shared { get; set; }
}
public class TableEvent
{
    public long Id { get; set; }
    public Guid? CampaignId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    [MaxLength(256)] public string Author { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = "message";
    [MaxLength(2000)] public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? SessionId { get; set; }
    /// <summary>Somente o mestre vê eventos privados, como anotações não compartilhadas.</summary>
    public bool MasterOnly { get; set; }
    /// <summary>Destinatário adicional de um evento privado de ficha, além do mestre.</summary>
    [MaxLength(450)] public string? VisibleToUserId { get; set; }
    /// <summary>Detalhes estruturados em JSON (antes/depois, rolagem, origem/destino).</summary>
    [MaxLength(4000)] public string Data { get; set; } = "";
}
