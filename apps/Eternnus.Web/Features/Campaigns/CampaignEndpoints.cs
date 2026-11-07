using System.Security.Claims;
namespace Eternnus.Web;

public static class CampaignEndpoints
{
    public static void MapCampaignEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier)!;
        api.MapGet("", (string? search, string? sort, int? page, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => service.ListAsync(Id(u), search, sort, page ?? 1, ct));
        api.MapPost("", async (CampaignInput x, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(new { id = await service.CreateAsync(x, Id(u), ct) }));
        api.MapPut("/{id:guid}", async (Guid id, CampaignInput x, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => { await service.UpdateAsync(id, x, Id(u), ct); return Results.NoContent(); });
        api.MapPut("/{id:guid}/sheet-template", (Guid id, CampaignSheetTemplateInput input, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => service.SetSheetTemplateAsync(id, input, Id(u), ct));
        api.MapDelete("/{id:guid}", async (Guid id, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => { await service.DeleteAsync(id, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/join", async (JoinInput x, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(new { id = await service.JoinAsync(x.Code, Id(u), ct) }));
        api.MapPost("/{id:guid}/leave", async (Guid id, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => { await service.LeaveAsync(id, Id(u), ct); return Results.NoContent(); });
        api.MapDelete("/{id:guid}/members/{member}", async (Guid id, string member, CampaignService service, ClaimsPrincipal u, CancellationToken ct) => { await service.RemoveAsync(id, member, Id(u), ct); return Results.NoContent(); });
    }
}
