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
    /// <summary>Raio de luz carregada, em metros (papel "light"). Nulo = o modelo não tem o papel; vale a configuração da mesa.</summary>
    public int? LightMeters { get; set; }
    /// <summary>Visão própria (ex.: no escuro), em metros (papel "vision"). Nulo = configuração da mesa.</summary>
    public int? VisionMeters { get; set; }
    /// <summary>Percepção passiva (papel "perception") usada na detecção automática.</summary>
    public int? Perception { get; set; }
    /// <summary>Sentidos especiais (papel "senses"): um por linha, "nome" ou "nome: metros".</summary>
    [MaxLength(400)] public string? Senses { get; set; }
    /// <summary>Alcance de ataque em metros (papel "reach"; pode vir de um campo calculado pela arma). Nulo = o mestre informa.</summary>
    public int? ReachMeters { get; set; }
    [MaxLength(10000)] public string Notes { get; set; } = "";
    /// <summary>Condições e nota curta mostradas na ficha resumida (ex.: "Envenenado; sem munição").</summary>
    [MaxLength(300)] public string Conditions { get; set; } = "";
    /// <summary>Atalhos pessoais (<see cref="CharacterShortcuts"/>, JSON). Preferência: não versiona a ficha nem altera regras.</summary>
    [MaxLength(4000)] public string Shortcuts { get; set; } = "";
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
    [MaxLength(12)] public string Origin { get; set; } = "new";
    [MaxLength(5000)] public string Continuity { get; set; } = "";
    [MaxLength(120)] public string CurrentArc { get; set; } = "";
    public int FirstSessionNumber { get; set; } = 1;
    public DateOnly? OriginalStartDate { get; set; }
    public bool IsOneShot { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? MasterLastSeenAt { get; set; }
    /// <summary>Arquivada: conteúdo e histórico preservados, sem novas operações de jogo. Continua contando na quota.</summary>
    public DateTime? ArchivedAt { get; set; }
    /// <summary>Próxima partida (UTC); a interface apresenta no fuso do navegador.</summary>
    public DateTime? NextSessionAt { get; set; }
    [MaxLength(200)] public string NextSessionNote { get; set; } = "";
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
    /// <summary>Ajustes do mestre na configuração da mesa (<see cref="Eternnus.Web.TableSettings"/>); nula = padrão do sistema. Valem para as próximas sessões.</summary>
    [MaxLength(4000)] public string? TableSettings { get; set; }
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
    /// <summary>Ajuste da configuração da mesa só para esta sessão (<see cref="Eternnus.Web.TableSettings"/>); nulo = configuração da campanha.</summary>
    [MaxLength(4000)] public string? TableSettings { get; set; }
    /// <summary>Forma de condução fixada ao abrir a sessão (<see cref="PlayModes"/>). Nula = tática (sessões anteriores).</summary>
    [MaxLength(20)] public string? PlayMode { get; set; }
    /// <summary>Pausada pelo mestre: continua sendo a sessão ativa da campanha; jogadores aguardam a retomada.</summary>
    public DateTime? PausedAt { get; set; }
    /// <summary>Ordem de turnos configurada (<see cref="TurnEntry"/>, JSON). Nula = rotação pela entrada.</summary>
    [MaxLength(8000)] public string? TurnOrder { get; set; }
    /// <summary>Entrada da ordem que está agindo (personagem, marcador do mestre ou grupo).</summary>
    [MaxLength(80)] public string? ActiveTurnKey { get; set; }
    public Guid? SceneId { get; set; }
    /// <summary>Camada de névoa em uso: nula = a do mapa (compartilhada); {chave}@{cena} = preparação própria da cena apresentada.</summary>
    [MaxLength(80)] public string? LayerKey { get; set; }
    /// <summary>Nome e texto da cena como foram apresentados ou aplicados. Editar a preparação não muda isto; nulos = sessões anteriores.</summary>
    [MaxLength(80)] public string? SceneName { get; set; }
    [MaxLength(2000)] public string? SceneText { get; set; }
    /// <summary>Resumo do mestre; jogadores leem somente depois de publicado.</summary>
    [MaxLength(5000)] public string Recap { get; set; } = "";
    public DateTime? RecapPublishedAt { get; set; }
    /// <summary>Incrementa em toda alteração visível da mesa; o cliente ao vivo aguarda uma revisão maior que a conhecida.</summary>
    public int Revision { get; set; } = 1;
    /// <summary>Trilha sonora da sessão (estado autoritativo, ver <see cref="SoundtrackState"/>): faixa selecionada; nula = sem trilha.</summary>
    public Guid? MusicTrackId { get; set; }
    public bool MusicPlaying { get; set; }
    /// <summary>Posição de referência em milissegundos, válida no instante <see cref="MusicReferenceAt"/> (relógio do servidor, UTC).</summary>
    public long MusicPositionMs { get; set; }
    public DateTime? MusicReferenceAt { get; set; }
    public bool MusicLoop { get; set; }
    /// <summary>Incrementa a cada comando da trilha; o cliente descarta respostas e comandos baseados em versão anterior.</summary>
    public int MusicVersion { get; set; }
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
    /// <summary>Cópia privada entregue a um destinatário escolhido pelo mestre (rolagem em grupo). O mestre vê só o original.</summary>
    public bool IsRecipientCopy { get; set; }
    /// <summary>Detalhes estruturados em JSON (antes/depois, rolagem, origem/destino).</summary>
    [MaxLength(4000)] public string Data { get; set; } = "";
}
