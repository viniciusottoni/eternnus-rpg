using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Comando da trilha: <c>Version</c> é a versão conhecida pelo cliente; diferente da atual, o comando é recusado (409).</summary>
public record SoundtrackInput(string Action, int Version, Guid? TrackId = null, long? PositionMs = null, bool? Loop = null, bool? Autoplay = null);

/// <summary>
/// Trilha sonora compartilhada da sessão. O estado autoritativo fica em <see cref="GameSession"/> (faixa, tocando/pausada,
/// posição e instante de referência, repetição); toda escrita segue bloqueio → mestre → evento → Revision++ → Pulse.
/// </summary>
public partial class SessionService
{
    public async Task<object> SoundtrackAsync(Guid sessionId, SoundtrackInput x, string user, CancellationToken ct)
    {
        var action = (x.Action ?? "").Trim().ToLowerInvariant();
        if (!SoundtrackActions.All.Contains(action)) throw new RuleException(400, "Comando de trilha desconhecido.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        var s = a.Session;
        if (x.Version != s.MusicVersion) throw new RuleException(409, "A trilha mudou em outra janela. O estado atual foi carregado; repita o comando se ainda quiser.");
        var now = Now;
        var current = s.MusicTrackId is { } playingId
            ? await db.MusicTracks.AsNoTracking().Where(t => t.Id == playingId).Select(t => new { t.Title, t.DurationMs }).SingleOrDefaultAsync(ct)
            : null;
        var (position, ended) = SoundtrackState.Of(s, current?.DurationMs).At(now);
        string content;
        switch (action)
        {
            case SoundtrackActions.Select:
                var id = x.TrackId ?? throw new RuleException(400, "Escolha uma faixa do acervo.");
                // Bloqueio compartilhado da faixa: uma exclusão concorrente no catálogo espera este commit (ou vence antes, e aqui dá 404).
                var chosen = (db.Database.IsNpgsql()
                    ? await db.MusicTracks.FromSqlInterpolated($"SELECT * FROM \"MusicTracks\" WHERE \"Id\" = {id} FOR SHARE").AsNoTracking().Select(t => new { t.Title }).SingleOrDefaultAsync(ct)
                    : await db.MusicTracks.AsNoTracking().Where(t => t.Id == id).Select(t => new { t.Title }).SingleOrDefaultAsync(ct))
                    ?? throw new RuleException(404, "Faixa não encontrada no catálogo.");
                s.MusicTrackId = id; s.MusicPositionMs = 0; s.MusicReferenceAt = now; s.MusicPlaying = x.Autoplay ?? true;
                content = $"Trilha: {chosen.Title}";
                break;
            case SoundtrackActions.Play:
                RequireTrack(s, current != null);
                s.MusicPositionMs = ended ? 0 : position; s.MusicReferenceAt = now; s.MusicPlaying = true;
                content = $"Trilha tocando: {current!.Title}";
                break;
            case SoundtrackActions.Pause:
                RequireTrack(s, current != null);
                s.MusicPositionMs = position; s.MusicReferenceAt = now; s.MusicPlaying = false;
                content = $"Trilha pausada: {current!.Title}";
                break;
            case SoundtrackActions.Stop:
                s.MusicTrackId = null; s.MusicPlaying = false; s.MusicPositionMs = 0; s.MusicReferenceAt = null;
                content = current == null ? "Trilha parada" : $"Trilha parada: {current.Title}";
                break;
            case SoundtrackActions.Seek:
                RequireTrack(s, current != null);
                var target = x.PositionMs ?? throw new RuleException(400, "Informe a posição da faixa.");
                if (target < 0) throw new RuleException(400, "A posição precisa ser positiva.");
                if (current!.DurationMs is { } duration && target > duration) target = duration;
                s.MusicPositionMs = target; s.MusicReferenceAt = now;
                content = $"Trilha movida para {target / 60000}:{target / 1000 % 60:00}";
                break;
            default:
                var loop = x.Loop ?? throw new RuleException(400, "Informe se a faixa deve repetir.");
                // Recalcula a referência com a regra anterior antes de trocar: a posição audível não salta.
                s.MusicPositionMs = position; s.MusicReferenceAt = now; s.MusicLoop = loop;
                content = loop ? "Repetição da trilha ativada" : "Repetição da trilha desativada";
                break;
        }
        s.MusicVersion++;
        Event(s, user, "Mestre", EventKinds.Music, content, new { action, trackId = s.MusicTrackId }, masterOnly: true);
        await CommitAsync(tx, s, ct);
        var music = await MusicStateAsync(s, ct);
        return new { serverTime = Now, revision = s.Revision, music };
    }

    static void RequireTrack(GameSession s, bool exists)
    {
        if (s.MusicTrackId == null || !exists) throw new RuleException(409, "Selecione uma faixa antes de controlar a trilha.");
    }

    /// <summary>Bloco <c>music</c> do estado ao vivo, igual para mestre e jogadores. A URL dos bytes é autorizada a cada requisição.</summary>
    async Task<object> MusicStateAsync(GameSession s, CancellationToken ct)
    {
        var track = s.MusicTrackId is { } id
            ? await db.MusicTracks.AsNoTracking().Where(t => t.Id == id).Select(t => new { t.Id, t.Title, t.DurationMs, t.ContentType }).SingleOrDefaultAsync(ct)
            : null;
        if (track == null) return new { trackId = (Guid?)null, title = (string?)null, durationMs = (int?)null, contentType = (string?)null, playing = false, positionMs = 0L, referenceAt = (DateTime?)null, loop = s.MusicLoop, version = s.MusicVersion, audioUrl = (string?)null };
        return new
        {
            trackId = (Guid?)track.Id, title = (string?)track.Title, track.DurationMs, contentType = (string?)track.ContentType,
            playing = s.MusicPlaying && s.EndedAt == null, positionMs = s.MusicPositionMs, referenceAt = s.MusicReferenceAt, loop = s.MusicLoop, version = s.MusicVersion,
            audioUrl = (string?)$"/api/sessions/{s.Id}/music/{track.Id}/audio",
        };
    }

    /// <summary>
    /// Faixa cujos bytes o usuário pode receber pela sessão: somente a selecionada, com a sessão em andamento,
    /// para o mestre ou para quem está na mesa. Fora disso, 404 sem revelar se a faixa existe.
    /// </summary>
    public async Task<MusicTrack> SessionAudioAsync(Guid sessionId, Guid trackId, string user, CancellationToken ct)
    {
        var a = await SessionAccessAsync(sessionId, user, ct);
        var unavailable = new RuleException(404, "Faixa indisponível.");
        if (a.Session.EndedAt != null || a.Session.MusicTrackId != trackId) throw unavailable;
        if (!a.IsMaster && !await db.SessionParticipants.AnyAsync(p => p.SessionId == sessionId && p.UserId == user && p.LastSeenAt != null, ct)) throw unavailable;
        return await db.MusicTracks.AsNoTracking().SingleOrDefaultAsync(t => t.Id == trackId, ct) ?? throw unavailable;
    }
}
