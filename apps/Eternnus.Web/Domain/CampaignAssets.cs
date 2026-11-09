using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public class CampaignLibraryEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(10000)] public string Text { get; set; } = "";
    /// <summary>text | objective | clue. Objetivos e pistas publicados formam o diário dos jogadores.</summary>
    [MaxLength(20)] public string Kind { get; set; } = "text";
    public bool Published { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class CampaignMapFolder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public Guid? ParentId { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
}
public class CampaignMap
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public Guid? FolderId { get; set; }
    [MaxLength(120)] public string Name { get; set; } = "";
    public int GridPixels { get; set; } = 64;
    public decimal ScaleMeters { get; set; } = 1.5m;
    /// <summary>Falso = "apenas imagem": usada só em cenas sem grade (sem marcadores, névoa ou movimento).</summary>
    public bool HasGrid { get; set; } = true;
    /// <summary>Deslocamento da grade em pixels (0 até <see cref="GridPixels"/> − 1), para alinhar a grade ao desenho.</summary>
    public int GridOffsetX { get; set; }
    public int GridOffsetY { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public byte[] Content { get; set; } = [];
    public int Revision { get; set; } = 1;
}
/// <summary>Névoa, paredes, portas, luzes e explorações de um mapa da campanha (oficial ou enviado), contínuos entre sessões.</summary>
public class CampaignMapLayer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    /// <summary>Chave da camada: a do mapa (oficial, ex.: crypt, ou asset:{guid}), compartilhada; ou {chave}@{cena}, própria de uma cena.</summary>
    [MaxLength(80)] public string MapKey { get; set; } = "";
    /// <summary>JSON de <see cref="MapFogState"/>.</summary>
    [MaxLength(400000)] public string State { get; set; } = "{}";
    /// <summary>
    /// Preparação salva enquanto a camada estava na mesa e ainda não aplicada (JSON de <see cref="MapFogState"/> sem explorações).
    /// Nula = nada pendente: a estrutura atual de <see cref="State"/> é a preparação.
    /// </summary>
    [MaxLength(400000)] public string? Prepared { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public static class CampaignAssetsModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<CampaignLibraryEntry>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignLibraryEntry>().HasIndex(x => new { x.CampaignId, x.Published, x.UpdatedAt });
        b.Entity<CampaignLibraryEntry>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<CampaignMapFolder>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignMapFolder>().HasIndex(x => new { x.CampaignId, x.ParentId });
        b.Entity<CampaignMapFolder>().HasOne<CampaignMapFolder>().WithMany().HasForeignKey(x => x.ParentId).OnDelete(DeleteBehavior.NoAction);
        b.Entity<CampaignMap>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignMap>().HasOne<CampaignMapFolder>().WithMany().HasForeignKey(x => x.FolderId).OnDelete(DeleteBehavior.NoAction);
        b.Entity<CampaignMap>().HasIndex(x => new { x.CampaignId, x.FolderId });
        b.Entity<CampaignMap>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<CampaignMap>().Property(x => x.ScaleMeters).HasPrecision(8, 2);
        b.Entity<CampaignMapLayer>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<CampaignMapLayer>().HasIndex(x => new { x.CampaignId, x.MapKey }).IsUnique();
        b.Entity<CampaignMapLayer>().Property(x => x.Revision).IsConcurrencyToken();
    }
}
