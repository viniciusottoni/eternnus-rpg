using System.Security.Claims;
using Microsoft.AspNetCore.Http.Features;
namespace Eternnus.Web;

/// <summary>Rotas de fichas-modelo. Leitura de publicadas: Verified. Gestão: Staff (embaixador/admin), auditada. Republicar: Admin.</summary>
public static class SheetTemplateEndpoints
{
    public static void MapSheetTemplateEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/sheet-templates").RequireAuthorization("Verified");
        static string Me(ClaimsPrincipal u) => PlatformAccess.UserId(u);

        // Leitura (qualquer conta verificada; rascunhos só para a equipe, conferido no serviço).
        api.MapGet("", (Guid? systemId, SheetTemplateService s, CancellationToken ct) => s.ListPublishedAsync(systemId, ct));
        api.MapGet("/{id:guid}", (Guid id, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) => s.GetAsync(id, Me(u), ct));
        api.MapGet("/{id:guid}/versions/{versionId:guid}", (Guid id, Guid versionId, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) => s.GetVersionAsync(id, versionId, Me(u), ct));
        api.MapGet("/{id:guid}/versions/{versionId:guid}/pdf", async (Guid id, Guid versionId, SheetTemplateService s, ClaimsPrincipal u, HttpContext http, CancellationToken ct) =>
            DocumentFiles.Serve(http, await s.GetPdfAsync(id, versionId, Me(u), ct), "ficha.pdf", inline: true));

        // Equipe.
        var staff = api.MapGroup("").RequireAuthorization(PlatformAccess.StaffPolicy);
        staff.MapGet("/manage", (Guid? systemId, bool? archived, int? page, SheetTemplateService s, CancellationToken ct) => s.ManageAsync(systemId, archived ?? false, page ?? 1, ct));
        staff.MapPost("", (SheetTemplateCreateInput x, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) => s.CreateAsync(x, Me(u), ct));
        staff.MapPut("/{id:guid}", (Guid id, SheetTemplateUpdateInput x, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) => s.UpdateAsync(id, x, Me(u), ct));
        staff.MapPost("/{id:guid}/versions", (Guid id, SheetVersionCreateInput? x, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) =>
            s.CreateVersionAsync(id, x ?? new SheetVersionCreateInput(null), Me(u), ct));
        staff.MapPut("/{id:guid}/versions/{versionId:guid}", (Guid id, Guid versionId, SheetVersionUpdateInput x, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) =>
            Validated(() => s.UpdateVersionAsync(id, versionId, x, Me(u), ct)));
        staff.MapDelete("/{id:guid}/versions/{versionId:guid}", async (Guid id, Guid versionId, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.DeleteVersionAsync(id, versionId, Me(u), ct);
            return Results.NoContent();
        });
        staff.MapPost("/{id:guid}/versions/{versionId:guid}/publish", (Guid id, Guid versionId, SheetVersionRevisionInput x, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) =>
            Validated(() => s.PublishAsync(id, versionId, x.Revision, Me(u), ct)));
        // Rota de upload fixa em UploadLimits (até 25 MiB): um arquivo "pdf" + campos "pages" (JSON lido pelo pdf.js) e "revision".
        staff.MapPut("/{id:guid}/versions/{versionId:guid}/pdf", async (Guid id, Guid versionId, HttpRequest request, DocumentFiles files, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) throw new RuleException(400, "Envie um arquivo PDF.");
            IFormCollection form;
            try
            {
                form = await request.ReadFormAsync(new FormOptions
                {
                    MultipartBodyLengthLimit = UploadLimits.DocumentBytes,
                    // O ASP.NET conta o arquivo junto com os valores: "pages" + "revision" + "pdf".
                    ValueCountLimit = 3,
                    ValueLengthLimit = 20000,
                    MultipartHeadersCountLimit = 8,
                    MultipartHeadersLengthLimit = 4096,
                }, ct);
            }
            catch (InvalidDataException) { throw new RuleException(400, "Envie um único PDF de até 25 MB."); }
            if (form.Files.Count != 1 || form.Files[0].Name != "pdf" || form.Keys.Any(k => k is not ("pages" or "revision")))
                throw new RuleException(400, "Envie um único arquivo PDF.");
            if (!int.TryParse(form["revision"], out var revision)) throw new RuleException(400, "Revisão do rascunho ausente. Recarregue a página.");
            var document = await files.ReadAsync(form.Files[0], DocumentKinds.SheetPdf, ct);
            return Results.Ok(await s.UploadPdfAsync(id, versionId, document, form["pages"], revision, Me(u), ct));
        }).RequireRateLimiting("upload");
        staff.MapDelete("/{id:guid}/versions/{versionId:guid}/pdf", (Guid id, Guid versionId, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) => s.DeletePdfAsync(id, versionId, Me(u), ct));

        // Admin: "reverter" republicando uma versão antiga como nova versão.
        api.MapPost("/{id:guid}/versions/{versionId:guid}/republish", (Guid id, Guid versionId, SheetTemplateService s, ClaimsPrincipal u, CancellationToken ct) => s.RepublishAsync(id, versionId, Me(u), ct))
            .RequireAuthorization(PlatformAccess.AdminPolicy);
    }

    /// <summary>Validação de versão: 400 com a lista de problemas (campo/ação + mensagem), para a interface marcar e selecionar cada item.</summary>
    static async Task<IResult> Validated(Func<Task<object>> action)
    {
        try { return Results.Ok(await action()); }
        catch (SheetValidationException ex)
        {
            return Results.Json(new { message = ex.Message, errors = ex.Errors.Take(200).Select(e => new { field = e.Field, action = e.Action, message = e.Message }) }, statusCode: 400);
        }
    }
}
