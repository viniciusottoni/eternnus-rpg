using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Imagem do personagem (ADR-097): no máximo uma por ficha, guardada fora do PDF e da ficha-modelo. Pertence à ficha
/// (não a uma campanha) e segue a mesma leitura da ficha. Bytes já reprocessados, sem metadados, até <see cref="CharacterPortraitModel.MaxSide"/> px.
/// </summary>
public class CharacterPortrait
{
    public Guid CharacterId { get; set; }
    public byte[] Content { get; set; } = [];
    [MaxLength(20)] public string ContentType { get; set; } = DocumentKinds.Jpeg;
    public int Width { get; set; }
    public int Height { get; set; }
    public long Size { get; set; }
    /// <summary>SHA-256 do conteúdo reprocessado, em hexadecimal minúsculo.</summary>
    [MaxLength(64)] public string Sha256 { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class CharacterPortraitModel
{
    /// <summary>Maior lado guardado, em pixels. A imagem enviada pode ter até 4.096 px e 10 MB.</summary>
    public const int MaxSide = 1024;

    public static void Configure(ModelBuilder b)
    {
        b.Entity<CharacterPortrait>().ToTable("CharacterPortraits").HasKey(x => x.CharacterId);
        b.Entity<CharacterPortrait>().HasOne<Character>().WithOne().HasForeignKey<CharacterPortrait>(x => x.CharacterId).OnDelete(DeleteBehavior.Cascade);
    }
}
