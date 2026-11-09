using System.Security.Claims;
namespace Eternnus.Web;

/// <summary>Endpoints finos da sessão de jogo. Regras e autorização por recurso ficam em <see cref="SessionService"/>.</summary>
public static class SessionEndpoints
{
    public static void MapSessionEndpoints(this WebApplication app)
    {
        static string Id(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier)!;
        // One-shot: cria a mesa temporária com sua sessão única já aberta.
        app.MapPost("/api/one-shots", async (OneShotInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.CreateOneShotAsync(x, Id(u), ct))).RequireAuthorization("Verified");
        var campaigns = app.MapGroup("/api/campaigns/{campaignId:guid}").RequireAuthorization("Verified");
        campaigns.MapGet("/sessions", (Guid campaignId, int? page, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.ListAsync(campaignId, Id(u), page ?? 1, ct));
        campaigns.MapPost("/sessions", async (Guid campaignId, StartSessionInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.StartAsync(campaignId, x, Id(u), ct)));
        campaigns.MapGet("/table", (Guid campaignId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.EntryAsync(campaignId, Id(u), ct));
        campaigns.MapGet("/maps", (Guid campaignId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.MapsAsync(campaignId, Id(u), ct));
        campaigns.MapGet("/table-settings", (Guid campaignId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.CampaignTableSettingsAsync(campaignId, Id(u), ct));
        campaigns.MapPut("/table-settings", (Guid campaignId, CampaignTableSettingsInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.UpdateCampaignTableSettingsAsync(campaignId, x.Settings, Id(u), ct));

        var api = app.MapGroup("/api/sessions/{sessionId:guid}").RequireAuthorization("Verified");
        api.MapGet("/live", (Guid sessionId, int? after, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.LiveAsync(sessionId, Math.Max(0, after ?? 0), Id(u), ct)).RequireRateLimiting("live");
        api.MapGet("/history", (Guid sessionId, string? kind, string? search, int? page, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.HistoryAsync(sessionId, Id(u), kind, search, page ?? 1, ct));
        api.MapGet("/characters/{characterId:guid}", (Guid sessionId, Guid characterId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.SheetAsync(sessionId, characterId, Id(u), ct));
        api.MapPost("/join", async (Guid sessionId, JoinSessionInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.JoinAsync(sessionId, x.CharacterId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/heartbeat", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.HeartbeatAsync(sessionId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/leave", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.LeaveAsync(sessionId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/end", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.EndAsync(sessionId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/messages", async (Guid sessionId, SessionTextInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.MessageAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/rolls", async (Guid sessionId, SessionRollInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.RollAsync(sessionId, x, Id(u), ct)));
        api.MapPost("/notes", async (Guid sessionId, SessionNoteInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.NoteAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/turn", async (Guid sessionId, TurnInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetTurnAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/turn/next", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.NextTurnAsync(sessionId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/turn/end", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.EndTurnAsync(sessionId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/actions", async (Guid sessionId, ActionInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.UseActionAsync(sessionId, x, Id(u), ct)));
        api.MapPost("/map", async (Guid sessionId, MapInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetMapAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/tokens", async (Guid sessionId, MapTokenInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.AddTokenAsync(sessionId, x, Id(u), ct)));
        api.MapPost("/tokens/{tokenId:guid}/move", async (Guid sessionId, Guid tokenId, MoveInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.MoveTokenAsync(sessionId, tokenId, x, Id(u), ct); return Results.NoContent(); });
        api.MapDelete("/tokens/{tokenId:guid}", async (Guid sessionId, Guid tokenId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RemoveTokenAsync(sessionId, tokenId, Id(u), ct); return Results.NoContent(); });
        // Névoa, luz, visão e configuração (mestre; "ver como" é leitura).
        api.MapGet("/view", (Guid sessionId, string @as, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.ViewAsAsync(sessionId, @as, Id(u), ct));
        api.MapGet("/table-settings", (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.TableSettingsAsync(sessionId, Id(u), ct));
        api.MapPut("/table-settings", async (Guid sessionId, TableSettingsInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.UpdateTableSettingsAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/paint", async (Guid sessionId, FogPaintInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.PaintFogAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/door", async (Guid sessionId, FogDoorInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.ToggleDoorAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/enabled", async (Guid sessionId, FogEnabledInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetFogEnabledAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/reset", async (Guid sessionId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.ResetExplorationAsync(sessionId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/lights", async (Guid sessionId, FogLightInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SaveLightAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapDelete("/fog/lights/{lightId}", async (Guid sessionId, string lightId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RemoveLightAsync(sessionId, lightId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/marks", async (Guid sessionId, FogMarkInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SaveMarkAsync(sessionId, x, Id(u), ct); return Results.NoContent(); });
        api.MapDelete("/fog/marks/{markId}", async (Guid sessionId, string markId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RemoveMarkAsync(sessionId, markId, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/fog/marks/{markId}/reveal", async (Guid sessionId, string markId, FogRevealInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RevealMarkAsync(sessionId, markId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/tokens/{tokenId:guid}/settings", async (Guid sessionId, Guid tokenId, TokenSettingsInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.TokenSettingsAsync(sessionId, tokenId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/tokens/{tokenId:guid}/reveal", async (Guid sessionId, Guid tokenId, FogRevealInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RevealTokenAsync(sessionId, tokenId, x, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/characters/{characterId:guid}/hp", async (Guid sessionId, Guid characterId, HpInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.AdjustHpAsync(sessionId, characterId, x, Id(u), ct)));
    }
}
