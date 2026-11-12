using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Novidade pendente de um usuário em uma campanha (ADR-069). Gravada pelo caso de uso que publica o conteúdo, na mesma
/// transação, só para quem pode ler o item e nunca para quem agiu. Ver o item ou a seção apaga a linha.
/// </summary>
public class Notice
{
    public long Id { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    public Guid CampaignId { get; set; }
    /// <summary>Seção da campanha (<see cref="NoticeAreas"/>).</summary>
    [MaxLength(20)] public string Area { get; set; } = "";
    /// <summary>Identificador do item na rota da campanha (GUID, <c>live-…</c>, <c>past-…</c>, <c>chapter-…</c>).</summary>
    [MaxLength(80)] public string ItemKey { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Marca de leitura por instante: tudo publicado até <see cref="SeenAt"/> no escopo já foi visto.
/// Usada onde o conteúdo já tem data própria (Guilda, conquistas, chamados, denúncias) e não precisa de cópia por leitor.
/// </summary>
public class ReadMark
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    /// <summary><see cref="ReadScopes"/>.</summary>
    [MaxLength(20)] public string Scope { get; set; } = "";
    /// <summary>Recurso marcado; <see cref="Guid.Empty"/> = o escopo inteiro.</summary>
    public Guid Key { get; set; }
    public DateTime SeenAt { get; set; }
}

public static class NoticeAreas
{
    /// <summary>Mesa aberta (sessão iniciada).</summary>
    public const string Table = "table";
    /// <summary>Próxima partida marcada.</summary>
    public const string Schedule = "schedule";
    /// <summary>Resumos publicados, sessões anteriores publicadas, capítulos revelados, objetivos e pistas.</summary>
    public const string Journal = "journal";
    /// <summary>Novo integrante no grupo.</summary>
    public const string Players = "players";
    /// <summary>Páginas do acervo compartilhadas com o leitor.</summary>
    public const string Pages = "pages";
    /// <summary>NPCs revelados aos jogadores.</summary>
    public const string Npcs = "npcs";
    /// <summary>Mapas publicados no atlas.</summary>
    public const string Atlas = "atlas";
    /// <summary>Pontos publicados na linha do tempo da campanha.</summary>
    public const string Timeline = "timeline";
    public static readonly string[] All = [Table, Schedule, Journal, Players, Pages, Npcs, Atlas, Timeline];
    /// <summary>Novidades mostradas na tela inicial (e apagadas ao vê-la).</summary>
    public static readonly string[] Home = [Table, Schedule];
}

public static class ReadScopes
{
    /// <summary>Guilda inteira ("marcar tudo como lido" e linha de base de contas novas).</summary>
    public const string Guild = "guild";
    /// <summary>Um tópico da Guilda (<see cref="ReadMark.Key"/> = tópico).</summary>
    public const string GuildTopic = "guild-topic";
    /// <summary>Denúncias abertas da Guilda (equipe).</summary>
    public const string Moderation = "moderation";
    /// <summary>Conquistas desbloqueadas.</summary>
    public const string Progress = "progress";
    /// <summary>Respostas da equipe nos chamados do próprio usuário (Key = chamado ou vazio).</summary>
    public const string Support = "support";
    /// <summary>Mensagens de usuários na fila de chamados (Admin; Key = chamado ou vazio).</summary>
    public const string SupportQueue = "support-queue";
    public static readonly string[] All = [Guild, GuildTopic, Moderation, Progress, Support, SupportQueue];
}

public static class NoticeModel
{
    /// <summary>Janela das novidades por instante: conteúdo mais antigo não acende indicadores.</summary>
    public static readonly TimeSpan Window = TimeSpan.FromDays(60);
    /// <summary>Teto exibido por contador ("99+").</summary>
    public const int MaxCount = 99;
    public static void Configure(ModelBuilder b)
    {
        b.Entity<Notice>().ToTable("Notices");
        b.Entity<ReadMark>().ToTable("ReadMarks");
        b.Entity<Notice>().HasIndex(x => new { x.UserId, x.CampaignId, x.Area });
        b.Entity<Notice>().HasIndex(x => new { x.CampaignId, x.ItemKey });
        b.Entity<Notice>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Notice>().HasOne<Campaign>().WithMany().HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ReadMark>().HasKey(x => new { x.UserId, x.Scope, x.Key });
        b.Entity<ReadMark>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
