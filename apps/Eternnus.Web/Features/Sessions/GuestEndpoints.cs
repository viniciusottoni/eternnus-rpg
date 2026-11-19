using System.Security.Claims;
namespace Eternnus.Web;

/// <summary>Convidados da mesa (ADR-114) e exibição externa/câmera (ADR-115). Implementação em <see cref="GuestService"/> e <see cref="SessionService"/>.</summary>
public static class GuestEndpoints
{
    public static void MapGuestEndpoints(this WebApplication app)
    {
        static string Id(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier)!;

        // Mestre: habilitar convidados, convites e lugares (conta verificada + dono da campanha conferido no serviço).
        var campaigns = app.MapGroup("/api/campaigns/{campaignId:guid}").RequireAuthorization("Verified");
        campaigns.MapPut("/guests", (Guid campaignId, GuestsEnabledInput x, GuestService s, ClaimsPrincipal u, CancellationToken ct) => s.SetEnabledAsync(campaignId, x.Enabled, Id(u), ct));
        campaigns.MapGet("/guest-invites", (Guid campaignId, GuestService s, ClaimsPrincipal u, CancellationToken ct) => s.ListAsync(campaignId, Id(u), ct));
        campaigns.MapPost("/guest-invites", async (Guid campaignId, GuestInviteInput x, GuestService s, ClaimsPrincipal u, CancellationToken ct) =>
            Results.Json(await s.CreateInviteAsync(campaignId, x, Id(u), ct), statusCode: StatusCodes.Status201Created));
        campaigns.MapDelete("/guest-invites/{inviteId:guid}", async (Guid campaignId, Guid inviteId, GuestService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RevokeInviteAsync(campaignId, inviteId, Id(u), ct); return Results.NoContent(); });
        campaigns.MapDelete("/guest-seats/{seatId:guid}", async (Guid campaignId, Guid seatId, GuestService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RevokeSeatAsync(campaignId, seatId, Id(u), ct); return Results.NoContent(); });

        // Convidado: sem conta e sem "Verified". A credencial é o cookie HttpOnly do lugar, conferido em cada chamada;
        // escritas passam pela proteção antiforgery comum de /api e pelo limite "guest" por IP.
        var guest = app.MapGroup("/api/guest");
        guest.MapPost("/redeem", async (GuestRedeemInput x, HttpContext http, GuestService s, CancellationToken ct) =>
        {
            var r = await s.RedeemAsync(x, ct);
            http.Response.Cookies.Append(GuestService.CookieName, r.Cookie, CookieOptions(http, r.ExpiresAt));
            return Results.Ok(new { sessionId = r.SessionId, mode = r.Mode, name = r.Name });
        }).RequireRateLimiting("guest");
        // Espera longa somente leitura. "/live" usa o balde próprio das consultas ao vivo no limitador global; "/state" é o mesmo.
        guest.MapGet("/live", async (int? after, HttpContext http, GuestService g, SessionService s, CancellationToken ct) =>
            await s.GuestLiveAsync(await Seat(http, g, ct), Math.Max(0, after ?? 0), ct));
        guest.MapGet("/state", async (int? after, HttpContext http, GuestService g, SessionService s, CancellationToken ct) =>
            await s.GuestLiveAsync(await Seat(http, g, ct), Math.Max(0, after ?? 0), ct));
        guest.MapGet("/map-image", async (HttpContext http, GuestService g, SessionService s, CancellationToken ct) =>
        {
            var (bytes, type) = await s.GuestMapImageAsync(await Seat(http, g, ct), ct);
            return Results.File(bytes, type, enableRangeProcessing: false);
        });
        guest.MapGet("/tokens/{tokenId:guid}/portrait", async (Guid tokenId, HttpContext http, GuestService g, SessionService s, CancellationToken ct) =>
        {
            var (bytes, type) = await s.GuestPortraitAsync(await Seat(http, g, ct), tokenId, ct);
            return Results.File(bytes, type, enableRangeProcessing: false);
        });
        guest.MapPost("/heartbeat", async (HttpContext http, GuestService g, SessionService s, CancellationToken ct) => { await s.GuestHeartbeatAsync(await Seat(http, g, ct), ct); return Results.NoContent(); });
        guest.MapPost("/move", async (MoveInput x, HttpContext http, GuestService g, SessionService s, CancellationToken ct) => { await s.GuestMoveAsync(await Seat(http, g, ct), x, ct); return Results.NoContent(); }).RequireRateLimiting("guest");
        guest.MapPost("/roll", async (GuestRollInput x, HttpContext http, GuestService g, SessionService s, CancellationToken ct) => Results.Ok(await s.GuestRollAsync(await Seat(http, g, ct), x, ct))).RequireRateLimiting("guest");
        guest.MapPost("/message", async (SessionTextInput x, HttpContext http, GuestService g, SessionService s, CancellationToken ct) => { await s.GuestMessageAsync(await Seat(http, g, ct), x, ct); return Results.NoContent(); }).RequireRateLimiting("guest");
        guest.MapPost("/leave", async (HttpContext http, GuestService g, SessionService s, CancellationToken ct) =>
        {
            // Sair sempre apaga o cookie, mesmo quando o acesso já tinha sido encerrado.
            try { await s.GuestLeaveAsync(await g.SeatAsync(http.Request.Cookies[GuestService.CookieName], ct), ct); }
            catch (RuleException ex) when (ex.Status == StatusCodes.Status401Unauthorized) { }
            http.Response.Cookies.Delete(GuestService.CookieName, new CookieOptions { Path = "/api/guest", Secure = http.Request.IsHttps, HttpOnly = true, SameSite = SameSiteMode.Strict });
            return Results.NoContent();
        }).RequireRateLimiting("guest");

        // Exibição externa (ADR-115): só o mestre; estado de espectador (sem dados do mestre). Câmera e controle de convidados.
        var sessions = app.MapGroup("/api/sessions/{sessionId:guid}").RequireAuthorization("Verified");
        sessions.MapGet("/display", (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.DisplayStateAsync(sessionId, Id(u), ct));
        sessions.MapGet("/display/live", (Guid sessionId, int? after, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.DisplayLiveAsync(sessionId, Math.Max(0, after ?? 0), Id(u), ct)).RequireRateLimiting("live");
        sessions.MapGet("/display/map-image", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var (bytes, type) = await s.DisplayMapImageAsync(sessionId, Id(u), ct);
            return Results.File(bytes, type, enableRangeProcessing: false);
        });
        sessions.MapGet("/display/tokens/{tokenId:guid}/portrait", async (Guid sessionId, Guid tokenId, SessionService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var (bytes, type) = await s.DisplayPortraitAsync(sessionId, tokenId, Id(u), ct);
            return Results.File(bytes, type, enableRangeProcessing: false);
        });
        sessions.MapPost("/camera", async (Guid sessionId, CameraInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetCameraAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        sessions.MapPost("/guest-control", async (Guid sessionId, GuestControlInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetGuestControlAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
    }

    static Task<Guid> Seat(HttpContext http, GuestService g, CancellationToken ct) => g.SeatAsync(http.Request.Cookies[GuestService.CookieName], ct);

    /// <summary>Cookie do lugar: HttpOnly, SameSite=Strict, só sob /api/guest, Secure em HTTPS e com o prazo do convite.</summary>
    static CookieOptions CookieOptions(HttpContext http, DateTime expiresAt) => new()
    {
        HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = http.Request.IsHttps, Path = "/api/guest", Expires = new DateTimeOffset(DateTime.SpecifyKind(expiresAt, DateTimeKind.Utc)), IsEssential = true,
    };
}
