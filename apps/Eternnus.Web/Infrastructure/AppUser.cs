using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;
namespace Eternnus.Web;

public class AppUser : IdentityUser
{
    [MaxLength(80)] public string DisplayName { get; set; } = "Aventureiro";
    [MaxLength(600)] public string AvatarUrl { get; set; } = "/assets/avatar.svg";
    public DateTime? LastEmailAt { get; set; }
    /// <summary>Papel global (common | ambassador | admin). Nunca aceito do cliente; ver <see cref="PlatformRoles"/>.</summary>
    [MaxLength(20)] public string Role { get; set; } = PlatformRoles.Common;
    /// <summary>XP acumulado (soma de <see cref="XpEntry"/>) e nível derivado, mantidos por ProgressionService.</summary>
    public int Xp { get; set; }
    public int Level { get; set; } = 1;
    public int OneShotParticipations { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenAt { get; set; }
}

public class MailDelivery
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Payload { get; set; } = "";
    public DateTime AvailableAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
    public DateTime? LeaseUntil { get; set; }
    public int Attempts { get; set; }
}

public sealed class AvatarImage
{
    public string UserId { get; set; } = "";
    public Guid Version { get; set; }
    public byte[] Content { get; set; } = [];
}
