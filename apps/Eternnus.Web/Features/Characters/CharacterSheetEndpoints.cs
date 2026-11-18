using Microsoft.AspNetCore.Http.Features;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Endpoints finos das fichas de jogador. Regras, autorização por dono e histórico ficam em <see cref="CharacterSheetService"/>.</summary>
public static class CharacterSheetEndpoints
{
    public static void MapCharacterSheetEndpoints(this WebApplication app)
    {
        static string Me(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var api = app.MapGroup("/api").RequireAuthorization("Verified");

        // Formato clássico (mantido para o frontend atual) + criação por modelo.
        api.MapGet("/characters", (CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.ListAsync(Me(u), ct));
        api.MapPost("/characters", async (CharacterInput x, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.CreateAsync(x, Me(u), ct)));
        api.MapPut("/characters/{id:guid}", async (Guid id, CharacterInput x, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.UpdateClassicAsync(id, x, Me(u), ct)));
        api.MapGet("/characters/{id:guid}/history", async (Guid id, int? page, GameDb db, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var user = Me(u);
            if (!await CharacterSheets.Editable(db, user).AnyAsync(c => c.Id == id, ct)) return Results.NotFound();
            var owner = await db.Characters.Where(c => c.Id == id).Select(c => c.OwnerId).SingleAsync(ct);
            var p = Math.Clamp(page ?? 1, 1, 100000);
            return Results.Ok(await db.Versions.AsNoTracking().Where(x => x.CharacterId == id && (owner == user || db.Sessions.Any(s => s.Id == x.SessionId && db.Campaigns.Any(c => c.Id == s.CampaignId && c.OwnerId == user)))).OrderByDescending(x => x.Revision).Skip((p - 1) * 50).Take(50).ToListAsync(ct));
        });

        // Ficha baseada em ficha-modelo.
        api.MapGet("/characters/{id:guid}/sheet", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.SheetAsync(id, Me(u), ct));
        api.MapPut("/characters/{id:guid}/sheet", (Guid id, CharacterSheetInput x, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.UpdateSheetAsync(id, x, Me(u), ct));
        api.MapGet("/characters/{id:guid}/field-history", (Guid id, string? field, int? page, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.FieldHistoryAsync(id, field, page ?? 1, Me(u), ct));
        api.MapGet("/characters/{id:guid}/migration", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.MigrationPreviewAsync(id, Me(u), ct));
        api.MapPost("/characters/{id:guid}/migration", (Guid id, CharacterMigrationInput x, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.MigrateAsync(id, x, Me(u), ct));
        // Imagem do personagem (ADR-097): fora do PDF; leitura como a ficha, escrita só do dono.
        api.MapGet("/characters/{id:guid}/portrait", async (Guid id, HttpContext http, CharacterPortraitService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var portrait = await s.GetAsync(id, Me(u), ct);
            http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(portrait.Content, portrait.ContentType, enableRangeProcessing: false);
        });
        api.MapPost("/characters/{id:guid}/portrait", async (Guid id, HttpRequest request, DocumentFiles files, GameDb db, CharacterPortraitService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) throw new RuleException(400, "Envie a imagem pelo formulário.");
            // Limite do plano de quem envia (ADR-102).
            var maxBytes = await AccountLimits.MaxFileBytesAsync(db, Me(u), ct);
            IFormCollection form;
            try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = maxBytes, ValueCountLimit = 4, KeyLengthLimit = 16, MultipartHeadersLengthLimit = 4096, MultipartHeadersCountLimit = 8 }, ct); }
            catch (InvalidDataException) { throw new RuleException(413, $"Formulário inválido ou imagem acima de {AccountPlans.Size(maxBytes)}, o limite do seu plano."); }
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Count > 0) throw new RuleException(400, "Envie uma única imagem.");
            if (form.Files[0].Length > maxBytes) throw AccountLimits.FileTooLarge(maxBytes);
            var image = await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.SaveAsync(id, Me(u), image, ct));
        }).RequireRateLimiting("upload");
        api.MapDelete("/characters/{id:guid}/portrait", async (Guid id, CharacterPortraitService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.DeleteAsync(id, Me(u), ct)));
        // Ferramentas da ficha (ADR-099): duplicar (dono), pontos de restauração (dono) e visão do grupo (mestre).
        api.MapPost("/characters/{id:guid}/copy", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.CopyAsync(id, Me(u), ct));
        api.MapGet("/characters/{id:guid}/restore-points", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.RestorePointsAsync(id, Me(u), ct));
        api.MapGet("/characters/{id:guid}/restore-points/{sessionId:guid}", (Guid id, Guid sessionId, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.RestorePointAsync(id, sessionId, Me(u), ct));
        api.MapGet("/campaigns/{id:guid}/party", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.PartyAsync(id, Me(u), ct));
        api.MapGet("/campaigns/{id:guid}/sheet-template", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.CampaignSheetTemplateAsync(id, Me(u), ct));
    }
}
