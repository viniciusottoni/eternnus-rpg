using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Atalhos pessoais da ficha resumida. Preferência do dono: não versiona a ficha nem altera regras ou permissões.</summary>
public sealed class PlayPreferences(GameDb db)
{
    public async Task<object> UpdateShortcutsAsync(Guid characterId, CharacterShortcuts? input, string user, CancellationToken ct)
    {
        var clean = Shortcuts.Validate(input);
        var json = Shortcuts.Serialize(clean);
        if (await db.Characters.Where(c => c.Id == characterId && c.OwnerId == user).ExecuteUpdateAsync(c => c.SetProperty(x => x.Shortcuts, json), ct) == 0)
            throw new RuleException(404, "Ficha não encontrada.");
        return clean;
    }
}

/// <summary>Endpoints finos da condução, preparação e continuidade. Regras e autorização ficam nos serviços.</summary>
public static class PlayEndpoints
{
    public static void MapPlayEndpoints(this WebApplication app)
    {
        static string Id(ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier)!;
        static IResult Ok() => Results.NoContent();

        // Convite guardado durante a verificação (conta autenticada, ainda sem Verified). Não concede acesso.
        var pending = app.MapGroup("/api/invites/pending").RequireAuthorization();
        pending.MapGet("", (PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.PendingInviteAsync(Id(u), ct));
        pending.MapPost("", async (InviteCodeInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => { await p.SetPendingInviteAsync(x.Code, Id(u), ct); return Ok(); });
        pending.MapDelete("", async (PreparationService p, ClaimsPrincipal u, CancellationToken ct) => { await p.SetPendingInviteAsync(null, Id(u), ct); return Ok(); });

        var verified = app.MapGroup("/api").RequireAuthorization("Verified");
        verified.MapGet("/invites/{code}", (string code, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.InviteAsync(code, Id(u), ct));
        verified.MapGet("/home", (PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.HomeAsync(Id(u), ct));
        verified.MapPut("/characters/{characterId:guid}/shortcuts", (Guid characterId, CharacterShortcuts x, PlayPreferences p, ClaimsPrincipal u, CancellationToken ct) => p.UpdateShortcutsAsync(characterId, x, Id(u), ct));

        var campaign = app.MapGroup("/api/campaigns/{campaignId:guid}").RequireAuthorization("Verified");
        campaign.MapPost("/archive", async (Guid campaignId, CampaignService s, ClaimsPrincipal u, CancellationToken ct) => { await s.ArchiveAsync(campaignId, Id(u), ct); return Ok(); });
        campaign.MapPost("/restore", async (Guid campaignId, CampaignService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RestoreAsync(campaignId, Id(u), ct); return Ok(); });
        campaign.MapPost("/convert", async (Guid campaignId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.ConvertOneShotAsync(campaignId, Id(u), ct)));
        campaign.MapGet("/scenes", (Guid campaignId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.ScenesAsync(campaignId, Id(u), ct));
        campaign.MapGet("/scenes/{sceneId:guid}", (Guid campaignId, Guid sceneId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SceneAsync(campaignId, sceneId, Id(u), ct));
        campaign.MapPost("/scenes", (Guid campaignId, SceneInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SaveSceneAsync(campaignId, null, x, Id(u), ct));
        campaign.MapPut("/scenes/{sceneId:guid}", (Guid campaignId, Guid sceneId, SceneInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SaveSceneAsync(campaignId, sceneId, x, Id(u), ct));
        campaign.MapPost("/scenes/{sceneId:guid}/duplicate", (Guid campaignId, Guid sceneId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.DuplicateSceneAsync(campaignId, sceneId, Id(u), ct));
        campaign.MapDelete("/scenes/{sceneId:guid}", async (Guid campaignId, Guid sceneId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => { await p.DeleteSceneAsync(campaignId, sceneId, Id(u), ct); return Ok(); });
        campaign.MapGet("/npcs", (Guid campaignId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.NpcsAsync(campaignId, Id(u), ct));
        campaign.MapPost("/npcs", (Guid campaignId, NpcInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SaveNpcAsync(campaignId, null, x, Id(u), ct));
        campaign.MapPut("/npcs/{npcId:guid}", (Guid campaignId, Guid npcId, NpcInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SaveNpcAsync(campaignId, npcId, x, Id(u), ct));
        campaign.MapGet("/npc-templates", (Guid campaignId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.NpcTemplatesAsync(campaignId, Id(u), ct));
        campaign.MapGet("/npcs/{npcId:guid}/sheet", (Guid campaignId, Guid npcId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.NpcSheetAsync(campaignId, npcId, Id(u), ct));
        campaign.MapPut("/npcs/{npcId:guid}/sheet", (Guid campaignId, Guid npcId, NpcSheetInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveNpcSheetAsync(campaignId, npcId, x, Id(u), ct));
        campaign.MapPost("/npcs/{npcId:guid}/copy", (Guid campaignId, Guid npcId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.CopyNpcAsync(campaignId, npcId, Id(u), ct));
        campaign.MapDelete("/npcs/{npcId:guid}", async (Guid campaignId, Guid npcId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => { await p.DeleteNpcAsync(campaignId, npcId, Id(u), ct); return Ok(); });
        campaign.MapGet("/journal", (Guid campaignId, int? page, string? search, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.JournalAsync(campaignId, Id(u), ct, page ?? 1, search));
        campaign.MapPut("/schedule", async (Guid campaignId, ScheduleInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => { await p.ScheduleAsync(campaignId, x, Id(u), ct); return Ok(); });
        campaign.MapPost("/attendance", async (Guid campaignId, AttendanceInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => { await p.AttendanceAsync(campaignId, x, Id(u), ct); return Ok(); });
        campaign.MapGet("/private-templates", (Guid campaignId, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.PrivateTemplatesAsync(campaignId, Id(u), ct));
        campaign.MapPost("/private-templates", (Guid campaignId, SimpleTemplateInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SavePrivateTemplateAsync(campaignId, null, x, Id(u), ct));
        campaign.MapPut("/private-templates/{templateId:guid}", (Guid campaignId, Guid templateId, SimpleTemplateInput x, PreparationService p, ClaimsPrincipal u, CancellationToken ct) => p.SavePrivateTemplateAsync(campaignId, templateId, x, Id(u), ct));

        var session = app.MapGroup("/api/sessions/{sessionId:guid}").RequireAuthorization("Verified");
        session.MapPost("/pause", async (Guid sessionId, PauseInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.PauseAsync(sessionId, x, Id(u), ct); return Ok(); });
        session.MapPut("/turn-order", async (Guid sessionId, TurnOrderInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetTurnOrderAsync(sessionId, x, Id(u), ct); return Ok(); });
        session.MapPost("/roll-requests", async (Guid sessionId, RollRequestInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.CreateRollRequestAsync(sessionId, x, Id(u), ct)));
        session.MapPost("/roll-requests/{requestId:guid}/respond", async (Guid sessionId, Guid requestId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.RespondRollRequestAsync(sessionId, requestId, Id(u), ct)));
        session.MapPost("/roll-requests/{requestId:guid}/cancel", async (Guid sessionId, Guid requestId, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.CancelRollRequestAsync(sessionId, requestId, Id(u), ct); return Ok(); });
        session.MapPost("/characters/{characterId:guid}/resource", async (Guid sessionId, Guid characterId, SheetResourceInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.AdjustResourceAsync(sessionId, characterId, x, Id(u), ct)));
        session.MapPost("/characters/{characterId:guid}/conditions", async (Guid sessionId, Guid characterId, ConditionsInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.SetConditionsAsync(sessionId, characterId, x, Id(u), ct); return Ok(); });
        session.MapPost("/undo", async (Guid sessionId, UndoInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.UndoAsync(sessionId, x, Id(u), ct); return Ok(); });
        session.MapPost("/scene", async (Guid sessionId, PresentSceneInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.PresentSceneAsync(sessionId, x, Id(u), ct); return Ok(); });
        session.MapPost("/scene/apply", async (Guid sessionId, ApplySceneInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.ApplyScenePreparationAsync(sessionId, x, Id(u), ct)));
        session.MapPost("/scene/save-as", async (Guid sessionId, SaveSceneAsInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.SaveSceneAsAsync(sessionId, x, Id(u), ct)));
        session.MapPost("/scene/capture", async (Guid sessionId, CaptureSceneInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.CaptureSceneAsync(sessionId, x, Id(u), ct); return Ok(); });
        session.MapPost("/npc-tokens", async (Guid sessionId, NpcTokenInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => Results.Ok(await s.AddNpcTokenAsync(sessionId, x, Id(u), ct)));
        session.MapGet("/tokens/{tokenId:guid}/portrait", async (Guid sessionId, Guid tokenId, HttpContext http, SessionService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var bytes = await s.PortraitAsync(sessionId, tokenId, Id(u), ct);
            http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(bytes, DocumentKinds.Jpeg, enableRangeProcessing: false);
        });
        session.MapPost("/npcs/{npcId:guid}/resource", async (Guid sessionId, Guid npcId, NpcResourceInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.AdjustNpcResourceAsync(sessionId, npcId, x, Id(u), ct); return Ok(); });
        session.MapPost("/recap", async (Guid sessionId, RecapInput x, SessionService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RecapAsync(sessionId, x, Id(u), ct); return Ok(); });
    }
}
