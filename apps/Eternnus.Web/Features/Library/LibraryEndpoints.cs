using System.Security.Claims;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
namespace Eternnus.Web;

public static class LibraryEndpoints
{
    static readonly string[] CreateFields = ["title", "description", "category", "systemId"];
    static readonly string[] ReplaceFields = ["revision"];

    // Rotas: /api/library/** (Verified leitura, Staff escrita, Admin restaurar/reverter). Regras no LibraryService.
    public static void MapLibraryEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/library").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal u) => PlatformAccess.UserId(u);

        api.MapGet("", (string? q, string? systemId, string? category, string? type, int? page, int? pageSize, string? deleted, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
            library.ListAsync(Id(u), new LibraryQuery(q, systemId, category, type, page ?? 1, pageSize ?? LibraryService.PageSize, deleted is "1" or "true"), ct));
        api.MapGet("/{id:guid}", (Guid id, LibraryService library, ClaimsPrincipal u, CancellationToken ct) => library.GetAsync(id, Id(u), ct));
        api.MapGet("/{id:guid}/file", async (Guid id, string? inline, HttpContext http, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var (file, fileName) = await library.FileAsync(id, Id(u), ct);
            return DocumentFiles.Serve(http, file, fileName, Inline(http.Request, file.ContentType, inline is "1" or "true"));
        });
        // GET nunca altera estado: o cliente registra o download por POST.
        api.MapPost("/{id:guid}/downloaded", async (Guid id, LibraryService library, CancellationToken ct) => { await library.MarkDownloadedAsync(id, ct); return Results.NoContent(); });

        api.MapPost("", async (HttpRequest request, DocumentFiles files, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var (file, form) = await ReadUploadAsync(request, CreateFields, ct);
            Guid? systemId = null;
            var rawSystem = form["systemId"].ToString().Trim();
            if (rawSystem.Length > 0)
            {
                if (!Guid.TryParse(rawSystem, out var parsed)) throw new RuleException(400, "Sistema de RPG inválido.");
                systemId = parsed;
            }
            var meta = new LibraryMetadata(form["title"].ToString(), form["description"].ToString(), form["category"].ToString(), systemId);
            LibraryService.ValidateFields(meta); // erros de metadados antes de ler/verificar o arquivo
            var document = await files.ReadAsync(file, DocumentKinds.Library, ct);
            return Results.Ok(await library.CreateAsync(Id(u), meta, document, ct));
        }).RequireAuthorization(PlatformAccess.StaffPolicy).RequireRateLimiting("upload");

        api.MapPut("/{id:guid}", async (Guid id, LibraryUpdateInput input, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
            Results.Ok(await library.UpdateAsync(id, Id(u), input, ct))).RequireAuthorization(PlatformAccess.StaffPolicy);

        api.MapPut("/{id:guid}/file", async (Guid id, HttpRequest request, DocumentFiles files, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var (file, form) = await ReadUploadAsync(request, ReplaceFields, ct);
            int? revision = null;
            var rawRevision = form["revision"].ToString().Trim();
            if (rawRevision.Length > 0)
            {
                if (!int.TryParse(rawRevision, out var parsed)) throw new RuleException(400, "Revisão inválida.");
                revision = parsed;
            }
            var document = await files.ReadAsync(file, DocumentKinds.Library, ct);
            return Results.Ok(await library.ReplaceFileAsync(id, Id(u), revision, document, ct));
        }).RequireAuthorization(PlatformAccess.StaffPolicy).RequireRateLimiting("upload");

        api.MapDelete("/{id:guid}", async (Guid id, [FromBody] LibraryDeleteInput? input, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await library.DeleteAsync(id, Id(u), input, ct);
            return Results.NoContent();
        }).RequireAuthorization(PlatformAccess.StaffPolicy);

        api.MapGet("/{id:guid}/history", (Guid id, int? page, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
            library.HistoryAsync(id, Id(u), page ?? 1, ct)).RequireAuthorization(PlatformAccess.StaffPolicy);
        api.MapPost("/{id:guid}/restore", async (Guid id, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
            Results.Ok(await library.RestoreAsync(id, Id(u), ct))).RequireAuthorization(PlatformAccess.AdminPolicy);
        api.MapPost("/{id:guid}/revert", async (Guid id, LibraryRevertInput input, LibraryService library, ClaimsPrincipal u, CancellationToken ct) =>
            Results.Ok(await library.RevertAsync(id, Id(u), input.AuditId, ct))).RequireAuthorization(PlatformAccess.AdminPolicy);
    }

    /// <summary>Inline apenas para imagens e para o visualizador pdf.js (fetch same-origin, Sec-Fetch-Dest: empty).
    /// Abrir um PDF diretamente como documento/iframe/embed sempre sai como anexo.</summary>
    public static bool Inline(HttpRequest request, string contentType, bool requested)
    {
        if (!requested) return false;
        if (contentType is DocumentKinds.Png or DocumentKinds.Jpeg or DocumentKinds.WebP) return true;
        if (contentType != DocumentKinds.Pdf) return false;
        var dest = request.Headers["Sec-Fetch-Dest"].ToString();
        return dest.Length == 0 || dest == "empty";
    }

    /// <summary>Lê um multipart com exatamente um arquivo no campo "file" e somente os campos de texto permitidos.
    /// O limite real de bytes do corpo vem de <see cref="UploadLimits"/>; o tipo/assinatura/antivírus ficam em <see cref="DocumentFiles"/>.</summary>
    static async Task<(IFormFile File, IFormCollection Form)> ReadUploadAsync(HttpRequest request, string[] allowedFields, CancellationToken ct)
    {
        if (!request.HasFormContentType) throw new RuleException(400, "Envie o arquivo pelo formulário de envio.");
        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(new FormOptions
            {
                MultipartBodyLengthLimit = UploadLimits.DocumentBytes,
                BufferBodyLengthLimit = UploadLimits.DocumentRequestBytes,
                ValueCountLimit = allowedFields.Length + 1,
                ValueLengthLimit = 8192,
                KeyLengthLimit = 32,
                MultipartHeadersCountLimit = 8,
                MultipartHeadersLengthLimit = 4096,
            }, ct);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge) { throw TooLarge(); }
        catch (InvalidDataException) when ((request.ContentLength ?? 0) > UploadLimits.DocumentBytes) { throw TooLarge(); }
        catch (InvalidDataException) { throw new RuleException(400, "Formulário de envio inválido. Envie um único arquivo e os campos do material."); }
        if (form.Files.Count != 1 || form.Files[0].Name != "file") throw new RuleException(400, "Selecione um único arquivo.");
        if (form.Keys.Any(k => !allowedFields.Contains(k))) throw new RuleException(400, "O formulário contém campos desconhecidos.");
        return (form.Files[0], form);
    }

    static RuleException TooLarge() => new(413, "O arquivo excede o limite de 25 MB.");
}
