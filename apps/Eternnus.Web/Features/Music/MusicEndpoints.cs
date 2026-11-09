using System.Security.Claims;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Net.Http.Headers;
namespace Eternnus.Web;

/// <summary>Catálogo de músicas do servidor (busca para mestres, gestão para Admin) e trilha sonora da sessão. Endpoints finos.</summary>
public static class MusicEndpoints
{
    static readonly string[] UploadFields = ["title"];

    public static void MapMusicEndpoints(this WebApplication app)
    {
        static string Id(ClaimsPrincipal user) => PlatformAccess.UserId(user);

        // Busca por nome: metadados de apresentação apenas; os bytes só saem pela sessão em que a faixa está tocando.
        app.MapGroup("/api/music").RequireAuthorization("Verified")
            .MapGet("", (string? search, int? page, MusicCatalogService s, CancellationToken ct) => s.SearchAsync(search, page ?? 1, ct));

        var admin = app.MapGroup("/api/admin/music").RequireAuthorization("Verified").RequireAuthorization(PlatformAccess.AdminPolicy);
        admin.MapGet("", (string? search, int? page, MusicCatalogService s, CancellationToken ct) => s.AdminListAsync(search, page ?? 1, ct));
        admin.MapPost("", async (HttpRequest request, IDocumentScanner scanner, MusicCatalogService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) throw new RuleException(400, "Envie o áudio pelo formulário.");
            IFormCollection form;
            try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = MusicLimits.MaxFileBytes, ValueLengthLimit = 512, ValueCountLimit = 4, KeyLengthLimit = 16, MultipartHeadersLengthLimit = 4096, MultipartHeadersCountLimit = 8 }, ct); }
            catch (InvalidDataException) { throw new RuleException(413, "Formulário inválido ou arquivo acima de 20 MB."); }
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Any(k => !UploadFields.Contains(k))) throw new RuleException(400, "Envie um arquivo de áudio e, se quiser, o título.");
            var upload = await AudioUploads.ReadAsync(form.Files[0], scanner, ct);
            return Results.Ok(await s.AddAsync(Id(u), form["title"].ToString(), upload, ct));
        }).RequireRateLimiting("catalog");
        admin.MapPut("/{trackId:guid}", (Guid trackId, MusicTrackInput x, MusicCatalogService s, ClaimsPrincipal u, CancellationToken ct) => s.RenameAsync(Id(u), trackId, x, ct));
        admin.MapDelete("/{trackId:guid}", async (Guid trackId, MusicCatalogService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteAsync(Id(u), trackId, ct); return Results.NoContent(); });
        admin.MapGet("/{trackId:guid}/audio", async (Guid trackId, HttpContext http, MusicCatalogService s, MusicStorage storage, CancellationToken ct) =>
            Serve(http, storage, await s.AdminFileAsync(trackId, ct)));

        var session = app.MapGroup("/api/sessions/{sessionId:guid}/music").RequireAuthorization("Verified");
        session.MapPost("", (Guid sessionId, SoundtrackInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.SoundtrackAsync(sessionId, x, Id(u), ct));
        session.MapGet("/{trackId:guid}/audio", async (Guid sessionId, Guid trackId, HttpContext http, SessionService s, MusicStorage storage, ClaimsPrincipal u, CancellationToken ct) =>
            Serve(http, storage, await s.SessionAudioAsync(sessionId, trackId, Id(u), ct)));
    }

    /// <summary>Bytes privados com HTTP Range, tipo validado no envio e sem cache. Nenhum caminho físico chega à resposta.</summary>
    static IResult Serve(HttpContext http, MusicStorage storage, MusicTrack track)
    {
        var path = storage.PathOf(track.StorageKey);
        if (!File.Exists(path)) throw new RuleException(404, "Arquivo de áudio indisponível.");
        http.Response.Headers.CacheControl = "private, no-store";
        http.Response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
        http.Response.Headers[HeaderNames.ContentSecurityPolicy] = "sandbox; default-src 'none'";
        http.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
        return Results.File(path, track.ContentType, fileDownloadName: null, lastModified: null,
            entityTag: new EntityTagHeaderValue($"\"{track.Sha256[..Math.Min(32, track.Sha256.Length)]}\""), enableRangeProcessing: true);
    }
}
