using System.Security.Claims;
namespace Eternnus.Web;

public static class GuildEndpoints
{
    /// <summary>Rotas /api/guild/** (Verified). Escritas sociais com limite "social"; moderação exige Staff; categorias exigem Admin.
    /// O serviço reaplica papel, autoria e estado do recurso em cada caso de uso.</summary>
    public static void MapGuildEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/guild").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal u) => PlatformAccess.UserId(u);

        api.MapGet("/categories", (GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.CategoriesAsync(Id(u), ct));
        api.MapGet("/topics", (string? category, string? q, Guid? systemId, int? page, bool? deleted, GuildService guild, ClaimsPrincipal u, CancellationToken ct) =>
            guild.TopicsAsync(Id(u), category, q, systemId, page ?? 1, deleted ?? false, ct));
        api.MapGet("/recent", (int? limit, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.RecentAsync(Id(u), limit ?? 5, ct));
        api.MapGet("/topics/{id:guid}", (Guid id, int? page, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.TopicAsync(id, Id(u), page ?? 1, ct));

        api.MapPost("/topics", (GuildTopicInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.CreateTopicAsync(x, Id(u), ct)).RequireRateLimiting("social");
        api.MapPost("/topics/{id:guid}/posts", (Guid id, GuildPostInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.ReplyAsync(id, x, Id(u), ct)).RequireRateLimiting("social");
        api.MapPut("/posts/{id:long}", (long id, GuildPostInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.EditAsync(id, x, Id(u), ct)).RequireRateLimiting("social");
        api.MapDelete("/posts/{id:long}", (long id, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.DeleteOwnAsync(id, Id(u), ct)).RequireRateLimiting("social");
        api.MapPost("/posts/{id:long}/useful", (long id, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.MarkUsefulAsync(id, Id(u), ct)).RequireRateLimiting("social");
        api.MapDelete("/posts/{id:long}/useful", (long id, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.UnmarkUsefulAsync(id, Id(u), ct)).RequireRateLimiting("social");
        api.MapPost("/posts/{id:long}/report", (long id, GuildReportInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.ReportAsync(id, x, Id(u), ct)).RequireRateLimiting("social");

        var mod = api.MapGroup("/moderation").RequireAuthorization(PlatformAccess.StaffPolicy);
        mod.MapGet("/reports", (string? status, int? page, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.ReportsAsync(Id(u), status, page ?? 1, ct));
        mod.MapPost("/reports/{id:long}/resolve", (long id, GuildResolveInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.ResolveAsync(id, x, Id(u), ct));
        mod.MapPost("/posts/{id:long}/delete", async (long id, GuildReasonInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => { await guild.ModerateDeletePostAsync(id, x, Id(u), ct); return Results.NoContent(); });
        mod.MapPost("/posts/{id:long}/restore", async (long id, GuildReasonInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => { await guild.ModerateRestorePostAsync(id, x, Id(u), ct); return Results.NoContent(); });
        mod.MapPost("/topics/{id:guid}", (Guid id, GuildTopicModerationInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.ModerateTopicAsync(id, x, Id(u), ct));

        var admin = api.MapGroup("/admin/categories").RequireAuthorization(PlatformAccess.AdminPolicy);
        admin.MapGet("", (GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.AdminCategoriesAsync(Id(u), ct));
        admin.MapPost("", (GuildCategoryInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => guild.CreateCategoryAsync(x, Id(u), ct));
        admin.MapPut("/{id:guid}", async (Guid id, GuildCategoryInput x, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => { await guild.UpdateCategoryAsync(id, x, Id(u), ct); return Results.NoContent(); });
        admin.MapDelete("/{id:guid}", async (Guid id, GuildService guild, ClaimsPrincipal u, CancellationToken ct) => { await guild.DeleteCategoryAsync(id, Id(u), ct); return Results.NoContent(); });
    }
}
