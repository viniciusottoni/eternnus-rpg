using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;
namespace Eternnus.Web;

public static class GameApi
{
    static string UserId(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.NameIdentifier)!;
    static IResult Bad(string message) => Results.BadRequest(new { message });
    static bool Text(string? value, int max, bool required = false) => value != null && value.Length <= max && (!required || !string.IsNullOrWhiteSpace(value));
    static Task<bool> Access(GameDb db, Guid id, string user)
    {
        var now = DateTime.UtcNow; var absent = now - OneShotLifecycleService.MasterAbsence;
        return db.Campaigns.AnyAsync(x => x.Id == id && (!x.IsOneShot || ((x.ExpiresAt == null || x.ExpiresAt > now) && (x.MasterLastSeenAt == null || x.MasterLastSeenAt > absent))) &&
            (x.OwnerId == user || db.Members.Any(m => m.CampaignId == id && m.UserId == user)));
    }
    static async Task<bool> Master(GameDb db, Guid id, string user) => await Access(db, id, user) && await db.Campaigns.AnyAsync(x => x.Id == id && x.OwnerId == user);
    public static void MapGameApi(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAuthorization("Verified");
        api.MapGet("/campaigns/{id:guid}", async (Guid id, GameDb db, ClaimsPrincipal u) =>
        {
            var user = UserId(u); if (!await Access(db, id, user)) return Results.NotFound();
            var c = await db.Campaigns.SingleAsync(x => x.Id == id); var master = c.OwnerId == user;
            OneShotLifecycleService.EnsureOpen(c, DateTime.UtcNow);
            var members = await db.Members.Where(m => m.CampaignId == id).Join(db.Users, m => m.UserId, x => x.Id, (m, x) => new { x.Id, name = x.DisplayName, x.AvatarUrl }).ToListAsync();
            return Results.Ok(new
            {
                c.Id,
                c.Name,
                c.System,
                c.RpgSystemId,
                c.SheetTemplateId,
                c.Description, c.Origin, c.Continuity, c.CurrentArc, c.FirstSessionNumber, c.OriginalStartDate,
                c.Revision,
                c.IsOneShot,
                c.ExpiresAt,
                archived = c.ArchivedAt != null,
                c.NextSessionAt,
                recoveryMinutes = (int)OneShotLifecycleService.MasterAbsence.TotalMinutes,
                masterName = await db.Users.Where(x => x.Id == c.OwnerId).Select(x => x.DisplayName).SingleOrDefaultAsync(),
                isMaster = master,
                inviteCode = master ? c.InviteCode : null,
                members,
                sessionCount = master ? await db.Sessions.CountAsync(x => x.CampaignId == id) : (int?)null,
                activeSession = await db.Sessions.Where(x => x.CampaignId == id && x.EndedAt == null).Select(x => new { x.Id, x.Number, x.Title, x.StartedAt }).SingleOrDefaultAsync(),
                resources = await db.Resources.Where(x => x.CampaignId == id && (master || x.Shared)).ToListAsync(),
                characters = await db.CampaignCharacters.Where(x => x.CampaignId == id).Join(db.Characters.Where(ch => master || ch.OwnerId == user || !ch.Private), x => x.CharacterId, x => x.Id, (link, character) => new { character.Id, character.OwnerId, character.Name, character.Archetype, character.Level, character.Hp, character.MaxHp }).Take(200).ToListAsync()
            });
        });
        api.MapPost("/campaigns/{id:guid}/characters/{character:guid}", async (Guid id, Guid character, GameDb db, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var locked = db.Database.IsNpgsql()
                ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct)
                : await db.Campaigns.SingleOrDefaultAsync(c => c.Id == id, ct);
            if (locked == null) return Results.NotFound();
            if (!await Access(db, id, UserId(u))) return Results.NotFound();
            var owned = await db.Characters.AsNoTracking().SingleOrDefaultAsync(x => x.Id == character && x.OwnerId == UserId(u), ct);
            if (owned == null) return Results.NotFound();
            await CharacterSheets.RequireCampaignSystemAsync(db, owned, locked, ct);
            if (!await db.CampaignCharacters.AnyAsync(x => x.CampaignId == id && x.CharacterId == character))
            {
                db.CampaignCharacters.Add(new() { CampaignId = id, CharacterId = character }); await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok();
        });
        api.MapPost("/campaigns/{id:guid}/resources", async (Guid id, ResourceInput x, GameDb db, ClaimsPrincipal u) =>
        {
            if (!await Master(db, id, UserId(u))) return Results.NotFound();
            if (!Text(x.Name, 120, true) || !Text(x.Content, 10000) || !new[] { "npc", "encontro", "mapa", "nota" }.Contains(x.Kind)) return Bad("Recurso inválido.");
            if (x.Kind == "mapa" && (!Uri.TryCreate(x.Content, UriKind.Absolute, out var url) || url.Scheme != "https")) return Bad("Informe uma URL HTTPS de imagem para o mapa.");
            var resource = new MasterResource { CampaignId = id, Name = x.Name, Kind = x.Kind, Content = x.Content, Shared = x.Shared };
            db.Resources.Add(resource); await db.SaveChangesAsync(); return Results.Ok(resource);
        });
        api.MapDelete("/campaigns/{id:guid}/resources/{resource:guid}", async (Guid id, Guid resource, GameDb db, ClaimsPrincipal u) =>
        {
            if (!await Master(db, id, UserId(u))) return Results.NotFound();
            await db.Resources.Where(x => x.Id == resource && x.CampaignId == id).ExecuteDeleteAsync(); return Results.NoContent();
        });
        api.MapGet("/events", async (Guid? campaignId, GameDb db, ClaimsPrincipal u) =>
        {
            var user = UserId(u); if (campaignId != null && !await Access(db, campaignId.Value, user)) return Results.NotFound();
            return Results.Ok(await db.Events.Where(x => campaignId == null ? x.CampaignId == null && x.UserId == user : x.CampaignId == campaignId && x.SessionId == null).OrderByDescending(x => x.Id).Take(60).ToListAsync());
        });
        api.MapPost("/messages", async (MessageInput x, GameDb db, ClaimsPrincipal u) =>
        {
            if (!await Access(db, x.CampaignId, UserId(u))) return Results.NotFound();
            if (!Text(x.Content, 2000, true)) return Bad("Escreva de 1 a 2000 caracteres.");
            var message = new TableEvent { CampaignId = x.CampaignId, UserId = UserId(u), Author = u.Identity!.Name!, Content = x.Content.Trim() };
            db.Events.Add(message); await db.SaveChangesAsync(); return Results.Ok(message);
        });
        api.MapPost("/rolls", async (RollInput x, GameDb db, ClaimsPrincipal u) =>
        {
            if (x.CampaignId != null && !await Access(db, x.CampaignId.Value, UserId(u))) return Results.NotFound();
            if (!Text(x.Formula, 40, true)) return Bad("Fórmula inválida.");
            DiceResult roll; try { roll = Dice.Roll(x.Formula); } catch (ArgumentException e) { return Bad(e.Message); }
            db.Events.Add(new() { CampaignId = x.CampaignId, UserId = UserId(u), Author = u.Identity!.Name!, Kind = "roll", Content = JsonSerializer.Serialize(roll, new JsonSerializerOptions(JsonSerializerDefaults.Web)) });
            await db.SaveChangesAsync(); return Results.Ok(roll);
        });
    }
}
public record Credentials(string Email, string Password, bool RememberMe = false);
/// <summary>Ficha clássica (clientes antigos) e criação por modelo: com <see cref="TemplateId"/>, <see cref="CampaignId"/> ou <see cref="Values"/>
/// a ficha nasce da ficha-modelo e os campos clássicos são ignorados (exceto <see cref="Name"/>, usado se o campo de nome não vier).</summary>
public record CharacterInput(string Name, string Archetype, int Level, int Hp, int MaxHp, int Strength, int Agility, int Intellect, string Notes, int Revision, int Constitution = 10, int Armor = 10, int Movement = 9, List<CharacterAction>? Actions = null,
    Guid? TemplateId = null, Guid? CampaignId = null, Dictionary<string, JsonElement>? Values = null, bool? Private = null);


public record ResourceInput(string Name, string Kind, string Content, bool Shared);
public record MessageInput(Guid CampaignId, string Content);
public record RollInput(string Formula, Guid? CampaignId);
