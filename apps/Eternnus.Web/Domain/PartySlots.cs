using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Personagem reservado (ADR-110): token persistente da campanha que representa um futuro personagem de jogador.
/// Separa a identidade visual (nome, imagem, forma e porte) do personagem (ficha) e do jogador (conta).
/// Pode aparecer em várias cenas (<see cref="SceneToken.SlotId"/>) e receber um personagem real depois
/// (<see cref="CharacterId"/>), preservando posições e aparência preparadas. Nunca cria ficha nem conta.
/// </summary>
public class PartySlot
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(40)] public string Name { get; set; } = "";
    /// <summary>Arquétipo visual genérico (<see cref="PartySlotArchetypes"/>) usado quando não há imagem; nulo = marcador simples.</summary>
    [MaxLength(16)] public string? Archetype { get; set; }
    /// <summary>Imagem própria: asset:{id} do acervo da campanha ou https (<see cref="NpcImages"/>); nula = arquétipo/redondo.</summary>
    [MaxLength(500)] public string? ImageUrl { get; set; }
    /// <summary>Forma e porte padrão dos tokens novos deste reservado (<see cref="TokenLooks"/>); nulos = redondo, 100%.</summary>
    [MaxLength(8)] public string? Appearance { get; set; }
    public int? Size { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    /// <summary>Personagem real vinculado; nulo = ainda reservado. Índice único por campanha impede dois vínculos ao mesmo personagem.</summary>
    public Guid? CharacterId { get; set; }
    public int Order { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Arquétipos visuais genéricos dos reservados: só aparência (ícone próprio do Eternnus), nenhuma regra de sistema.</summary>
public static class PartySlotArchetypes
{
    public const string Warrior = "warrior", Mage = "mage", Archer = "archer", Cleric = "cleric", Rogue = "rogue";
    public static readonly string[] All = [Warrior, Mage, Archer, Cleric, Rogue];
    public static string? Normalize(string? v) => string.IsNullOrEmpty(v) ? null : All.Contains(v) ? v : throw new RuleException(400, "Escolha um arquétipo visual válido.");
}

/// <summary>Convite de convidado (ADR-114): capacidade limitada a uma campanha, guardada só como hash SHA-256.</summary>
public class GuestInvite
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    /// <summary>Observador (só assiste) ou participante (pode receber controle temporário de um token).</summary>
    [MaxLength(12)] public string Mode { get; set; } = GuestModes.Observer;
    [MaxLength(40)] public string Label { get; set; } = "";
    /// <summary>SHA-256 (hex) do segredo do convite. O segredo em claro só existe na resposta de criação.</summary>
    [MaxLength(64)] public string TokenHash { get; set; } = "";
    [MaxLength(450)] public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public int MaxUses { get; set; } = 1;
    public int Uses { get; set; }
}

/// <summary>
/// Lugar de um convidado numa sessão (identidade temporária). A credencial é um segredo aleatório num cookie HttpOnly;
/// o banco guarda só o hash. Revogar o convite ou o lugar, encerrar a sessão ou desabilitar convidados corta o acesso.
/// </summary>
public class GuestSeat
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InviteId { get; set; }
    public Guid CampaignId { get; set; }
    public Guid SessionId { get; set; }
    [MaxLength(40)] public string Name { get; set; } = "";
    [MaxLength(12)] public string Mode { get; set; } = GuestModes.Observer;
    [MaxLength(64)] public string SecretHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public static class GuestModes
{
    public const string Observer = "observer", Participant = "participant";
    public static bool IsValid(string? v) => v is Observer or Participant;
}

public static class VttModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<PartySlot>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PartySlot>().HasOne<Character>().WithMany().HasForeignKey(x => x.CharacterId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<PartySlot>().HasIndex(x => new { x.CampaignId, x.Order });
        // Um personagem real recebe no máximo um reservado por campanha (também contra vínculos concorrentes).
        b.Entity<PartySlot>().HasIndex(x => new { x.CampaignId, x.CharacterId }).IsUnique().HasFilter("\"CharacterId\" IS NOT NULL").HasDatabaseName("IX_PartySlots_OneCharacter");
        b.Entity<PartySlot>().Property(x => x.Revision).IsConcurrencyToken();

        b.Entity<GuestInvite>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuestInvite>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<GuestInvite>().HasIndex(x => new { x.CampaignId, x.CreatedAt });
        b.Entity<GuestSeat>().HasOne<GuestInvite>().WithMany().HasForeignKey(x => x.InviteId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuestSeat>().HasOne<GameSession>().WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<GuestSeat>().HasIndex(x => x.SecretHash).IsUnique();
        b.Entity<GuestSeat>().HasIndex(x => x.SessionId);
        // Controle temporário: um token aponta para no máximo um lugar de convidado (FK anula ao remover o lugar).
        b.Entity<SessionToken>().HasOne<GuestSeat>().WithMany().HasForeignKey(x => x.GuestSeatId).OnDelete(DeleteBehavior.SetNull);
    }
}
