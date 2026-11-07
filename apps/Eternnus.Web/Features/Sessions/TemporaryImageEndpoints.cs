using System.Security.Claims;
namespace Eternnus.Web;

public static class TemporaryImageEndpoints
{
    public static void MapTemporaryImageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/sessions/{sessionId:guid}/temporary-image").RequireAuthorization("Verified");
        group.MapPost("", (Guid sessionId, TemporaryImageInput input, SessionService service, ClaimsPrincipal user, CancellationToken ct) =>
            service.ShowTemporaryImageAsync(sessionId, input, PlatformAccess.UserId(user), ct));
        group.MapDelete("", async (Guid sessionId, SessionService service, ClaimsPrincipal user, CancellationToken ct) =>
        { await service.HideTemporaryImageAsync(sessionId, PlatformAccess.UserId(user), ct); return Results.NoContent(); });
        group.MapGet("/signal", (Guid sessionId, HttpContext context, TemporaryImageRelay relay) => relay.ConnectAsync(context, sessionId, PlatformAccess.UserId(context.User)));
        // Operação pode configurar STUN/TURN privados; configuração vazia permite conexões diretas.
        group.MapGet("/ice", async (Guid sessionId, SessionService service, ClaimsPrincipal user, IConfiguration configuration, CancellationToken ct) =>
        {
            await service.EntryForTemporaryImageAsync(sessionId, PlatformAccess.UserId(user), ct);
            return Results.Ok(new { iceServers = configuration.GetSection("WebRtc:IceServers").Get<IceServer[]>() ?? [] });
        });
    }
    public sealed record IceServer(string[] Urls, string? Username, string? Credential);
}
