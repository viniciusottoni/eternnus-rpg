using System.Security.Claims;
namespace Eternnus.Web;

/// <summary>Preparação unificada (ADR-081): explorador, pastas por categoria, mover, copiar e renomear. Só o mestre.</summary>
public static class PrepEndpoints
{
    public static void MapPrepEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns/{campaignId:guid}/prep").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal user) => PlatformAccess.UserId(user);
        api.MapGet("/explorer", (Guid campaignId, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.ExplorerAsync(campaignId, Id(u), ct));
        api.MapPost("/folders", (Guid campaignId, PrepFolderInput x, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.CreateFolderAsync(campaignId, Id(u), x, ct));
        api.MapPut("/folders/{id:guid}", (Guid campaignId, Guid id, CampaignFolderNameInput x, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.RenameFolderAsync(campaignId, id, Id(u), x, ct));
        api.MapDelete("/folders/{id:guid}", async (Guid campaignId, Guid id, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteFolderAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/move", (Guid campaignId, PrepItemsInput x, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.MoveAsync(campaignId, Id(u), x, ct));
        api.MapPost("/copy", (Guid campaignId, PrepItemsInput x, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.CopyAsync(campaignId, Id(u), x, ct));
        // Prévia somente leitura (ADR-088): POST porque leva a preparação não salva do editor; não grava nada.
        api.MapPost("/preview-view", (Guid campaignId, PrepPreviewInput x, PreparationService s, ClaimsPrincipal u, CancellationToken ct) => s.PreviewViewAsync(campaignId, x, Id(u), ct));
        api.MapPut("/rename", (Guid campaignId, PrepRenameInput x, PrepWorkspaceService s, ClaimsPrincipal u, CancellationToken ct) => s.RenameAsync(campaignId, Id(u), x, ct));
    }
}
