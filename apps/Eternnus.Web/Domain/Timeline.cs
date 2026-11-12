using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Ponto da linha do tempo da história da campanha (Mundo e acervo › Linha do tempo, ADR-072).
/// "event" é um acontecimento ordenado por <see cref="Position"/>; "start" e "end" são marcos opcionais, no máximo um de cada por campanha.</summary>
public class TimelineEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    [MaxLength(10)] public string Kind { get; set; } = TimelineKinds.Event;
    /// <summary>Ordem entre os acontecimentos (0..n-1). Marcos de início e fim ficam sempre nas pontas.</summary>
    public int Position { get; set; }
    [MaxLength(120)] public string Title { get; set; } = "";
    /// <summary>Data dentro do mundo, em texto livre ("Ano 1203, inverno"). Opcional.</summary>
    [MaxLength(60)] public string When { get; set; } = "";
    /// <summary>Descrição curta, mostrada na própria linha.</summary>
    [MaxLength(280)] public string Summary { get; set; } = "";
    /// <summary>Descrição longa, entregue só ao abrir o ponto.</summary>
    [MaxLength(10000)] public string Details { get; set; } = "";
    /// <summary>Visível ao grupo. Pontos não publicados nunca chegam aos jogadores.</summary>
    public bool Published { get; set; }
    public int Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public static class TimelineKinds
{
    public const string Event = "event", Start = "start", End = "end";
    public static readonly string[] All = [Event, Start, End];
}
public static class TimelineModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<TimelineEvent>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TimelineEvent>().HasIndex(x => new { x.CampaignId, x.Position });
        // Um marco de início e um de fim por campanha, no máximo.
        b.Entity<TimelineEvent>().HasIndex(x => new { x.CampaignId, x.Kind }).IsUnique().HasFilter("\"Kind\" <> 'event'");
        b.Entity<TimelineEvent>().Property(x => x.Revision).IsConcurrencyToken();
    }
}
