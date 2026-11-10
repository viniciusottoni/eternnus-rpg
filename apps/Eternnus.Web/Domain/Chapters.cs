using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Capítulo, ato ou arco da campanha: agrupa sessões jogadas no Eternnus e sessões anteriores, na ordem definida pelo mestre.
/// Somente o mestre lê e administra. Sessões podem ficar sem capítulo (avulsas); excluir o capítulo as deixa avulsas.
/// </summary>
public class StoryChapter
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    /// <summary>Rótulo escolhido pelo mestre (<see cref="ChapterKinds"/>); não cria hierarquia.</summary>
    [MaxLength(20)] public string Kind { get; set; } = ChapterKinds.Chapter;
    [MaxLength(120)] public string Title { get; set; } = "";
    [MaxLength(2000)] public string Summary { get; set; } = "";
    public int Order { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class ChapterKinds
{
    public const string Chapter = "chapter", Act = "act", Arc = "arc";
    public static readonly string[] All = [Chapter, Act, Arc];
}

public static class ChapterModel
{
    public const int MaxPerCampaign = 200;
    public static void Configure(ModelBuilder b)
    {
        b.Entity<StoryChapter>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StoryChapter>().HasIndex(x => new { x.CampaignId, x.Order });
        b.Entity<StoryChapter>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<GameSession>().HasOne<StoryChapter>().WithMany().HasForeignKey(x => x.ChapterId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<GameSession>().HasIndex(x => x.ChapterId);
        b.Entity<PastSession>().HasOne<StoryChapter>().WithMany().HasForeignKey(x => x.ChapterId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<PastSession>().HasIndex(x => x.ChapterId);
    }
}
