using System.Security.Claims;
namespace Eternnus.Web;

public static class NoticeEndpoints
{
    /// <summary>Rotas /api/notices (Verified). GETs só leem; marcar como visto é POST com CSRF comum e afeta apenas o próprio usuário.</summary>
    public static void MapNoticeEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/notices").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal u) => PlatformAccess.UserId(u);
        api.MapGet("", (NoticeService s, ClaimsPrincipal u, CancellationToken ct) => s.SummaryAsync(Id(u), ct));
        api.MapGet("/campaigns/{id:guid}", (Guid id, NoticeService s, ClaimsPrincipal u, CancellationToken ct) => s.CampaignAsync(id, Id(u), ct));
        api.MapGet("/guild/topics/{id:guid}", (Guid id, NoticeService s, ClaimsPrincipal u, CancellationToken ct) => s.GuildTopicAsync(id, Id(u), ct));
        api.MapPost("/seen", async (NoticeSeenInput x, NoticeService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SeenAsync(x, Id(u), ct); return Results.NoContent(); });
    }
}
