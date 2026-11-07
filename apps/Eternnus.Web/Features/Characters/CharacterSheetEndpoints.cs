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
        api.MapGet("/campaigns/{id:guid}/sheet-template", (Guid id, CharacterSheetService s, ClaimsPrincipal u, CancellationToken ct) => s.CampaignSheetTemplateAsync(id, Me(u), ct));
    }
}
