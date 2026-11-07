using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public class CampaignLibraryEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(10000)] public string Text { get; set; } = "";
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
    public int Width { get; set; }
    public int Height { get; set; }
    public byte[] Content { get; set; } = [];
    public int Revision { get; set; } = 1;
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
    }
}
