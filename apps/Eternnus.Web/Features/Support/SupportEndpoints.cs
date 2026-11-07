using System.Security.Claims;
namespace Eternnus.Web;

/// <summary>Suporte: /api/support/** para o autor (Verified) e /api/admin/tickets/** para a equipe (Admin).
/// Endpoints finos; regras, acesso ao recurso e auditoria ficam em <see cref="SupportService"/>.</summary>
public static class SupportEndpoints
{
    public static void MapSupportEndpoints(this WebApplication app)
    {
        static string Id(ClaimsPrincipal u) => PlatformAccess.UserId(u);

        var user = app.MapGroup("/api/support/tickets").RequireAuthorization("Verified");
        user.MapGet("", (string? status, int? page, SupportService s, ClaimsPrincipal u, CancellationToken ct) => s.MyTicketsAsync(Id(u), status, page ?? 1, ct));
        user.MapPost("", async (TicketCreateInput x, SupportService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.CreateAsync(Id(u), x, ct)))
            .RequireRateLimiting("social");
        user.MapGet("/{id:guid}", (Guid id, SupportService s, ClaimsPrincipal u, CancellationToken ct) => s.MyTicketAsync(Id(u), id, ct));
        user.MapPost("/{id:guid}/messages", async (Guid id, TicketReplyInput x, SupportService s, ClaimsPrincipal u, CancellationToken ct) => { await s.ReplyAsync(Id(u), id, x, ct); return Results.NoContent(); })
            .RequireRateLimiting("social");
        user.MapPost("/{id:guid}/close", async (Guid id, SupportService s, ClaimsPrincipal u, CancellationToken ct) => { await s.CloseAsync(Id(u), id, ct); return Results.NoContent(); });
        user.MapPost("/{id:guid}/reopen", async (Guid id, SupportService s, ClaimsPrincipal u, CancellationToken ct) => { await s.ReopenAsync(Id(u), id, ct); return Results.NoContent(); });

        var staff = app.MapGroup("/api/admin/tickets").RequireAuthorization("Verified", PlatformAccess.AdminPolicy);
        staff.MapGet("", (string? status, string? priority, string? category, string? assigned, string? q, int? page, SupportService s, ClaimsPrincipal u, CancellationToken ct) =>
            s.QueueAsync(Id(u), new(status, priority, category, assigned, q, page ?? 1), ct));
        staff.MapGet("/assignees", (SupportService s, ClaimsPrincipal u, CancellationToken ct) => s.AssigneesAsync(Id(u), ct));
        staff.MapGet("/{id:guid}", (Guid id, SupportService s, ClaimsPrincipal u, CancellationToken ct) => s.AdminTicketAsync(Id(u), id, ct));
        staff.MapPost("/{id:guid}/messages", async (Guid id, StaffTicketMessageInput x, SupportService s, ClaimsPrincipal u, CancellationToken ct) => { await s.StaffMessageAsync(Id(u), id, x, ct); return Results.NoContent(); });
        staff.MapPut("/{id:guid}", (Guid id, TicketUpdateInput x, SupportService s, ClaimsPrincipal u, CancellationToken ct) => s.UpdateAsync(Id(u), id, x, ct));
    }
}
