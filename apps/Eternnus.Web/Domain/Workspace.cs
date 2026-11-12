using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public class WorkspacePage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? CampaignId { get; set; }
    [MaxLength(450)] public string OwnerId { get; set; } = "";
    [MaxLength(20)] public string Kind { get; set; } = "text";
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(10000)] public string Content { get; set; } = "";
    [MaxLength(4000)] public string Secrets { get; set; } = "";
    [MaxLength(20)] public string Visibility { get; set; } = "self";
    [MaxLength(120)] public string Collection { get; set; } = "";
    [MaxLength(300)] public string Tags { get; set; } = "";
    [MaxLength(20)] public string Status { get; set; } = "open";
    [MaxLength(1000)] public string RelatedReferences { get; set; } = "";
    public bool Pinned { get; set; }
    public Guid? ParentId { get; set; }
    public Guid? NpcId { get; set; }
    public Guid? MapId { get; set; }
    public int Order { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
}
public class WorkspaceReader
{
    public Guid PageId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
}
public class WorkspaceVersion
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PageId { get; set; }
    public int Number { get; set; }
    [MaxLength(100000)] public string Snapshot { get; set; } = "";
    public DateTime At { get; set; } = DateTime.UtcNow;
}
public class PastSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public int Number { get; set; }
    /// <summary>Capítulo/ato/arco da campanha; nulo = sessão avulsa.</summary>
    public Guid? ChapterId { get; set; }
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(10000)] public string Summary { get; set; } = "";
    public DateOnly? Date { get; set; }
    public bool Published { get; set; }
    public int Revision { get; set; } = 1;
    /// <summary>Cenas registradas uma a uma (opcional), na ordem em que aconteceram. Mesma visibilidade do registro.</summary>
    public List<PastSessionScene> Scenes { get; set; } = [];
}
/// <summary>Cena de uma sessão anterior: título curto e o texto do que aconteceu.</summary>
public class PastSessionScene
{
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(10000)] public string Text { get; set; } = "";
}
public class AtlasPublication
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public Guid SourceMapId { get; set; }
    [MaxLength(120)] public string Name { get; set; } = "";
    public byte[] Content { get; set; } = [];
}
public class WorkspaceAttachment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PageId { get; set; }
    [MaxLength(200)] public string Name { get; set; } = "";
    [MaxLength(40)] public string ContentType { get; set; } = "";
    public byte[] Content { get; set; } = [];
    public long Size { get; set; }
}
public static class WorkspaceModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<AtlasPublication>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AtlasPublication>().HasIndex(x => new { x.CampaignId, x.SourceMapId }).IsUnique();
        b.Entity<WorkspaceAttachment>().HasOne<WorkspacePage>().WithMany().HasForeignKey(x => x.PageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WorkspaceAttachment>().HasIndex(x => x.PageId);
        b.Entity<WorkspacePage>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<WorkspacePage>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WorkspacePage>().HasIndex(x => new { x.CampaignId, x.Kind, x.UpdatedAt });
        b.Entity<WorkspacePage>().HasIndex(x => new { x.OwnerId, x.Kind });
        b.Entity<WorkspacePage>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<WorkspaceReader>().HasKey(x => new { x.PageId, x.UserId });
        b.Entity<WorkspaceReader>().HasOne<WorkspacePage>().WithMany().HasForeignKey(x => x.PageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WorkspaceVersion>().HasOne<WorkspacePage>().WithMany().HasForeignKey(x => x.PageId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WorkspaceVersion>().HasIndex(x => new { x.PageId, x.Number }).IsUnique();
        b.Entity<PastSession>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<PastSession>().HasIndex(x => new { x.CampaignId, x.Number }).IsUnique();
        b.Entity<PastSession>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<PastSession>().OwnsMany(x => x.Scenes, o => o.ToJson());
        TimelineModel.Configure(b);
    }
}
