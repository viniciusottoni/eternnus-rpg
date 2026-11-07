using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
namespace Eternnus.Web;

public static class AdminEndpoints
{
    /// <summary>/api/rpg-systems (Verified) e /api/admin/** (Admin, exceto tickets, mapeados pelo suporte).
    /// A política Admin relê o papel no banco a cada requisição; as regras de recurso ficam nos serviços.</summary>
    public static void MapAdminEndpoints(this WebApplication app)
    {
        static string Me(ClaimsPrincipal u) => PlatformAccess.UserId(u);
        static string UserId(string id) => id.Length is > 0 and <= 450 ? id : throw new RuleException(404, "Usuário não encontrado.");

        app.MapGroup("/api/rpg-systems").RequireAuthorization("Verified")
            .MapGet("", (RpgSystemService systems, CancellationToken ct) => systems.ListActiveAsync(ct));

        var admin = app.MapGroup("/api/admin").RequireAuthorization("Verified").RequireAuthorization(PlatformAccess.AdminPolicy);
        admin.MapGet("/overview", (AdminService service, CancellationToken ct) => service.OverviewAsync(ct));

        admin.MapGet("/users", (string? q, string? role, string? status, int? page, AdminService service, CancellationToken ct) => service.UsersAsync(q, role, status, page ?? 1, ct));
        admin.MapGet("/users/{id}", (string id, AdminService service, ClaimsPrincipal u, CancellationToken ct) => service.UserAsync(UserId(id), Me(u), ct));
        admin.MapPut("/users/{id}/role", async (string id, RoleInput x, AdminService service, ClaimsPrincipal u, CancellationToken ct) => { await service.SetRoleAsync(UserId(id), x, Me(u), ct); return Results.NoContent(); });
        admin.MapPost("/users/{id}/suspend", async (string id, SuspendInput x, AdminService service, ClaimsPrincipal u, CancellationToken ct) => { await service.SuspendAsync(UserId(id), x, Me(u), ct); return Results.NoContent(); });
        admin.MapPost("/users/{id}/unsuspend", async (string id, [FromBody] ReasonInput? x, AdminService service, ClaimsPrincipal u, CancellationToken ct) => { await service.UnsuspendAsync(UserId(id), x?.Reason, Me(u), ct); return Results.NoContent(); });

        admin.MapGet("/campaigns", (string? q, Guid? systemId, bool? online, int? page, AdminService service, CancellationToken ct) => service.CampaignsAsync(q, systemId, online, page ?? 1, ct));
        admin.MapGet("/campaigns/{id:guid}", (Guid id, AdminService service, CancellationToken ct) => service.CampaignAsync(id, ct));
        admin.MapDelete("/campaigns/{id:guid}", async (Guid id, [FromBody] ReasonInput x, CampaignService campaigns, ClaimsPrincipal u, CancellationToken ct) => { await campaigns.AdminDeleteAsync(id, Me(u), x.Reason ?? "", ct); return Results.NoContent(); });

        admin.MapGet("/audit", (string? action, string? actor, string? targetType, string? targetId, DateTime? from, DateTime? to, int? page, AdminService service, CancellationToken ct) =>
            service.AuditAsync(action, actor, targetType, targetId, from, to, page ?? 1, ct));

        admin.MapGet("/rpg-systems", (RpgSystemService systems, CancellationToken ct) => systems.ListAllAsync(ct));
        admin.MapPost("/rpg-systems", (RpgSystemInput x, RpgSystemService systems, ClaimsPrincipal u, CancellationToken ct) => systems.CreateAsync(x, Me(u), ct));
        admin.MapPut("/rpg-systems/{id:guid}", (Guid id, RpgSystemUpdate x, RpgSystemService systems, ClaimsPrincipal u, CancellationToken ct) => systems.UpdateAsync(id, x, Me(u), ct));
        admin.MapDelete("/rpg-systems/{id:guid}", async (Guid id, RpgSystemService systems, ClaimsPrincipal u, CancellationToken ct) => { await systems.DeleteAsync(id, Me(u), ct); return Results.NoContent(); });
    }
}
