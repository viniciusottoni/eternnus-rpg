using System.Security.Claims;
using Microsoft.AspNetCore.Http.Features;
namespace Eternnus.Web;
public static class WorkspaceEndpoints
{
    public static void MapWorkspaceEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns/{campaign:guid}/workspace").RequireAuthorization("Verified");
        static string User(ClaimsPrincipal u) => PlatformAccess.UserId(u);
        api.MapGet("/atlas", (Guid campaign, int? page, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Atlas(campaign, User(u), page ?? 1, ct));
        api.MapPost("/atlas/{id:guid}", async (Guid campaign, Guid id, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.PublishMap(campaign, id, User(u), false, ct); return Results.NoContent(); });
        api.MapDelete("/atlas/{id:guid}", async (Guid campaign, Guid id, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.PublishMap(campaign, id, User(u), true, ct); return Results.NoContent(); });
        api.MapGet("/atlas/{id:guid}/image", async (Guid campaign, Guid id, HttpContext http, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { var content = await s.AtlasImage(campaign, id, User(u), ct); http.Response.Headers.CacheControl = "private, no-store"; http.Response.Headers["X-Content-Type-Options"] = "nosniff"; return Results.File(content, "image/jpeg"); });
        api.MapGet("/pages", (Guid campaign, string? search, string? kind, int? page, bool? trash, bool? mine, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.List(campaign, User(u), search, kind, page ?? 1, trash ?? false, ct, mine ?? false));
        api.MapGet("/pages/{id:guid}", (Guid campaign, Guid id, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Read(campaign, id, User(u), ct));
        api.MapPost("/pages", (Guid campaign, WorkspaceInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Save(campaign, null, User(u), x, ct));
        api.MapPut("/pages/{id:guid}", (Guid campaign, Guid id, WorkspaceInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Save(campaign, id, User(u), x, ct));
        api.MapGet("/pages/{id:guid}/attachments", (Guid campaign, Guid id, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Attachments(campaign, id, User(u), ct));
        api.MapPost("/pages/{id:guid}/attachments", async (Guid campaign, Guid id, HttpRequest request, DocumentFiles files, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureEditor(campaign, id, User(u), ct);
            if (!request.HasFormContentType) throw new RuleException(400, "Envie um arquivo pelo formulário.");
            IFormCollection form;
            try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = UploadLimits.DocumentBytes, ValueCountLimit = 1, ValueLengthLimit = 64 }, ct); }
            catch (InvalidDataException) { throw new RuleException(413, "Formulário inválido ou arquivo acima de 25 MB."); }
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Count() != 0) throw new RuleException(400, "Envie um único arquivo.");
            var file = await files.ReadAsync(form.Files[0], DocumentKinds.Library, ct);
            return Results.Ok(await s.Attach(campaign, id, User(u), file, ct));
        }).RequireRateLimiting("upload");
        api.MapGet("/pages/{id:guid}/attachments/{file:guid}", async (Guid campaign, Guid id, Guid file, HttpContext http, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var attachment = await s.Attachment(campaign, id, file, User(u), ct);
            http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            http.Response.Headers.ContentSecurityPolicy = "sandbox";
            return Results.File(attachment.Content, attachment.ContentType, attachment.Name);
        });
        api.MapDelete("/pages/{id:guid}/attachments/{file:guid}", async (Guid campaign, Guid id, Guid file, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RemoveAttachment(campaign, id, file, User(u), ct); return Results.NoContent(); });
        app.MapGet("/api/notebook", (int? page, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Notebook(User(u), page ?? 1, ct)).RequireAuthorization("Verified");
        app.MapGet("/api/notebook/{id:guid}", (Guid id, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.OwnNote(id, User(u), ct)).RequireAuthorization("Verified");
        api.MapGet("/pages/{id:guid}/versions", (Guid campaign, Guid id, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Versions(campaign, id, User(u), ct));
        api.MapPost("/pages/{id:guid}/trash", async (Guid campaign, Guid id, PageState x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.Delete(campaign, id, User(u), x.Revision, x.Restore, ct); return Results.NoContent(); });
        api.MapGet("/past-sessions", (Guid campaign, int? page, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Past(campaign, User(u), page ?? 1, ct));
        api.MapPost("/past-sessions", (Guid campaign, PastSessionInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.SavePast(campaign, null, User(u), x, ct));
        api.MapPut("/past-sessions/{id:guid}", (Guid campaign, Guid id, PastSessionInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.SavePast(campaign, id, User(u), x, ct));
    }
    public record PageState(int Revision, bool Restore = false);
}
