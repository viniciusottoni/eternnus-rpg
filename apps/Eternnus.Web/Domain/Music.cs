using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Faixa do catálogo de músicas do servidor, mantido pelos administradores e igual para todas as campanhas.
/// Metadados ficam no PostgreSQL; os bytes ficam no armazenamento privado de áudio (<see cref="MusicStorage"/>),
/// fora de wwwroot, nomeado por <see cref="StorageKey"/>. Mestres só buscam e reproduzem.
/// </summary>
public class MusicTrack
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(120)] public string Title { get; set; } = "";
    /// <summary>Tipo real identificado pelo conteúdo (<see cref="AudioFormats"/>), nunca pelo nome/MIME do cliente.</summary>
    [MaxLength(40)] public string ContentType { get; set; } = AudioFormats.Mpeg;
    public long SizeBytes { get; set; }
    /// <summary>Duração calculada no servidor a partir do arquivo; nula quando o formato não a informa.</summary>
    public int? DurationMs { get; set; }
    [MaxLength(64)] public string Sha256 { get; set; } = "";
    /// <summary>Nome opaco do arquivo no armazenamento privado (GUID em hexadecimal). Nunca exposto ao navegador.</summary>
    [MaxLength(40)] public string StorageKey { get; set; } = "";
    [MaxLength(450)] public string UploadedById { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int Revision { get; set; } = 1;
}

public static class MusicModel
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<MusicTrack>().HasIndex(x => x.Title);
        b.Entity<MusicTrack>().HasIndex(x => x.Sha256);
        b.Entity<MusicTrack>().HasIndex(x => x.StorageKey).IsUnique();
        b.Entity<MusicTrack>().Property(x => x.Revision).IsConcurrencyToken();
        // Rede de segurança: a exclusão normal exige a faixa fora de uso em sessões ativas; sessões encerradas perdem a referência.
        b.Entity<GameSession>().HasOne<MusicTrack>().WithMany().HasForeignKey(x => x.MusicTrackId).OnDelete(DeleteBehavior.SetNull);
    }
}

/// <summary>Limites do catálogo de músicas, dimensionados para a hospedagem compartilhada atual (IIS + disco do site).</summary>
public static class MusicLimits
{
    public const long MaxFileBytes = 20L * 1024 * 1024;
    public const long MaxRequestBytes = MaxFileBytes + 64 * 1024;
    public const int MaxTracks = 200;
    public const long MaxCatalogBytes = 2L * 1024 * 1024 * 1024;
    public const int PageSize = 20;
    public const int MaxTitle = 120;
}

/// <summary>
/// Estado autoritativo da trilha da sessão e cálculo da posição esperada. Puro: recebe o instante do servidor.
/// A posição é guardada como referência (<c>PositionMs</c> no instante <c>ReferenceAt</c>); tocando, avança com o relógio.
/// </summary>
public readonly record struct SoundtrackState(Guid? TrackId, bool Playing, long PositionMs, DateTime? ReferenceAt, bool Loop, int? DurationMs)
{
    public static SoundtrackState Of(GameSession s, int? durationMs) =>
        new(s.MusicTrackId, s.MusicPlaying, s.MusicPositionMs, s.MusicReferenceAt, s.MusicLoop, durationMs);

    /// <summary>Posição esperada no instante <paramref name="now"/> e se a faixa (sem repetição) já terminou.</summary>
    public (long PositionMs, bool Ended) At(DateTime now)
    {
        if (TrackId == null) return (0, false);
        var position = Math.Max(0, PositionMs);
        if (Playing && ReferenceAt is { } reference) position += Math.Max(0, (long)(now - reference).TotalMilliseconds);
        // Sem duração conhecida, o navegador descobre o fim pelo próprio arquivo.
        if (DurationMs is not { } d || d <= 0) return (position, false);
        if (Loop) return (position % d, false);
        return position >= d ? (d, true) : (position, false);
    }
}

public static class SoundtrackActions
{
    public const string Select = "select", Play = "play", Pause = "pause", Stop = "stop", Seek = "seek", Loop = "loop";
    public static readonly string[] All = [Select, Play, Pause, Stop, Seek, Loop];
}
