using System.Security.Claims;
namespace Eternnus.Web;

/// <summary>Personagens reservados da campanha (ADR-110). Só o mestre; implementação em <see cref="PartySlotService"/>.</summary>
public static class PartySlotEndpoints
{
    public static void MapPartySlotEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns/{campaignId:guid}/party-slots").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal user) => PlatformAccess.UserId(user);
        api.MapGet("", (Guid campaignId, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.ListAsync(campaignId, Id(u), ct));
        api.MapPost("", (Guid campaignId, PartySlotInput x, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.CreateAsync(campaignId, x, Id(u), ct));
        api.MapPut("/{slotId:guid}", (Guid campaignId, Guid slotId, PartySlotInput x, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.UpdateAsync(campaignId, slotId, x, Id(u), ct));
        api.MapPost("/{slotId:guid}/duplicate", (Guid campaignId, Guid slotId, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.DuplicateAsync(campaignId, slotId, Id(u), ct));
        api.MapDelete("/{slotId:guid}", async (Guid campaignId, Guid slotId, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteAsync(campaignId, slotId, Id(u), ct); return Results.NoContent(); });
        // Prévia somente leitura do vínculo: POST porque leva o personagem escolhido; não grava nada.
        api.MapPost("/{slotId:guid}/bind-preview", (Guid campaignId, Guid slotId, PartyBindPreviewInput x, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.BindPreviewAsync(campaignId, slotId, x, Id(u), ct));
        api.MapPost("/{slotId:guid}/bind", (Guid campaignId, Guid slotId, PartyBindInput x, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.BindCharacterAsync(campaignId, slotId, x, Id(u), ct));
        api.MapPost("/{slotId:guid}/unbind", (Guid campaignId, Guid slotId, PartyUnbindInput x, PartySlotService s, ClaimsPrincipal u, CancellationToken ct) => s.UnbindAsync(campaignId, slotId, x, Id(u), ct));
    }
}
