using System.Security.Claims;
namespace Eternnus.Web;

/// <summary>Versões persistentes dos documentos de preparação (ADR-083). Só o mestre; escritas pela proteção antiforgery comum.</summary>
public static class VersionEndpoints
{
    public static void MapVersionEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns/{campaignId:guid}/versions").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal user) => PlatformAccess.UserId(user);
        api.MapGet("", (Guid campaignId, string? kind, Guid document, DocumentVersionService s, ClaimsPrincipal u, CancellationToken ct) => s.ListAsync(campaignId, kind, document, Id(u), ct));
        api.MapGet("/{id:guid}", (Guid campaignId, Guid id, DocumentVersionService s, ClaimsPrincipal u, CancellationToken ct) => s.GetAsync(campaignId, id, Id(u), ct));
        api.MapPost("", (Guid campaignId, DocumentVersionInput x, DocumentVersionService s, ClaimsPrincipal u, CancellationToken ct) => s.CreateAsync(campaignId, Id(u), x, ct));
        api.MapPut("/{id:guid}", (Guid campaignId, Guid id, DocumentVersionLabelInput x, DocumentVersionService s, ClaimsPrincipal u, CancellationToken ct) => s.RenameAsync(campaignId, id, Id(u), x, ct));
        api.MapDelete("/{id:guid}", async (Guid campaignId, Guid id, DocumentVersionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
    }
}
