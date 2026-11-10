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
        api.MapDelete("/past-sessions/{id:guid}", async (Guid campaign, Guid id, int revision, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeletePast(campaign, id, User(u), revision, ct); return Results.NoContent(); });
        // Capítulos/atos/arcos: organização privada do mestre para agrupar sessões.
        var chapters = app.MapGroup("/api/campaigns/{campaign:guid}/chapters").RequireAuthorization("Verified");
        chapters.MapGet("", (Guid campaign, int? page, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.ChapterList(campaign, User(u), ct, page));
        // Tabela única de sessões (Eternnus + anteriores) e busca geral: mestre e jogadores, com filtragem por papel no serviço.
        var campaignApi = app.MapGroup("/api/campaigns/{campaign:guid}").RequireAuthorization("Verified");
        campaignApi.MapGet("/session-log", (Guid campaign, string? search, string? chapter, string? source, int? page, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Log(campaign, User(u), search, chapter, source, page ?? 1, ct));
        campaignApi.MapGet("/session-log/{key}", (Guid campaign, string key, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.LogEntry(campaign, key, User(u), ct));
        campaignApi.MapGet("/search", (Guid campaign, string? q, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.Search(campaign, User(u), q, ct));
        // Importação em lote: modelo estático e envio multipart (prévia sem gravar; confirm=true grava tudo ou nada).
        app.MapGet("/api/session-import/template", () => Results.File(SessionImportFormat.Template(), "text/csv; charset=utf-8", SessionImportFormat.FileName)).RequireAuthorization("Verified");
        campaignApi.MapPost("/session-import", async (Guid campaign, bool? confirm, HttpRequest request, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) throw new RuleException(400, "Envie o arquivo pelo formulário.");
            IFormCollection form;
            try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = SessionImportFormat.MaxBytes, ValueCountLimit = 1, ValueLengthLimit = 64 }, ct); }
            catch (InvalidDataException) { throw new RuleException(413, "Formulário inválido ou arquivo acima de 1 MB."); }
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Count != 0) throw new RuleException(400, "Envie um único arquivo.");
            var file = form.Files[0];
            var extension = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (extension is not (".csv" or ".txt")) throw new RuleException(400, "Envie o modelo salvo como .csv.");
            if (file.Length is <= 0 or > SessionImportFormat.MaxBytes) throw new RuleException(file.Length <= 0 ? 400 : 413, file.Length <= 0 ? "O arquivo está vazio." : "O arquivo aceita até 1 MB.");
            using var buffer = new MemoryStream((int)file.Length);
            await file.CopyToAsync(buffer, ct);
            return Results.Ok(await s.ImportSessions(campaign, User(u), buffer.ToArray(), confirm == true, ct));
        }).RequireRateLimiting("upload");
        chapters.MapPost("", (Guid campaign, ChapterInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveChapter(campaign, null, User(u), x, ct));
        chapters.MapPut("/{id:guid}", (Guid campaign, Guid id, ChapterInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveChapter(campaign, id, User(u), x, ct));
        chapters.MapPost("/{id:guid}/move", async (Guid campaign, Guid id, ChapterMoveInput x, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.MoveChapter(campaign, id, User(u), x, ct); return Results.NoContent(); });
        chapters.MapDelete("/{id:guid}", async (Guid campaign, Guid id, int revision, WorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteChapter(campaign, id, User(u), revision, ct); return Results.NoContent(); });
    }
    public record PageState(int Revision, bool Restore = false);
}
