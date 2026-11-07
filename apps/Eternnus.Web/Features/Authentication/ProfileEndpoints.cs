using System.Security.Claims;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/auth").RequireAuthorization();
        api.MapPut("/profile", async (ProfileInput input, ClaimsPrincipal principal, ProfileService profiles, CancellationToken ct) =>
            Results.Ok(AuthEndpoints.Profile(await profiles.UpdateNameAsync(principal.FindFirstValue(ClaimTypes.NameIdentifier)!, input.Name, ct))))
            .RequireRateLimiting("auth");
        api.MapGet("/avatar-policy", (IAvatarSafety safety) => Results.Ok(new { available = safety.Available, maxBytes = AvatarProcessor.MaxBytes }));
        api.MapPost("/avatar", async (HttpRequest request, ClaimsPrincipal principal, ProfileService profiles, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) throw new RuleException(400, "Envie uma imagem JPEG ou PNG.");
            IFormCollection form;
            try
            {
                form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = AvatarProcessor.MaxBytes, ValueCountLimit = 1, MultipartHeadersCountLimit = 8, MultipartHeadersLengthLimit = 2048 }, ct);
            }
            catch (InvalidDataException) { throw new RuleException(400, "Envie apenas uma imagem JPEG ou PNG de até 2 MB."); }
            if (form.Count != 0 || form.Files.Count != 1 || form.Files[0].Name != "avatar") throw new RuleException(400, "Selecione uma única imagem para o avatar.");
            var file = form.Files[0];
            if (file.Length is < 16 or > AvatarProcessor.MaxBytes) throw new RuleException(400, "A imagem deve ter até 2 MB.");
            await using var input = file.OpenReadStream();
            using var data = new MemoryStream();
            await input.CopyToAsync(data, ct);
            var user = await profiles.UploadAsync(principal.FindFirstValue(ClaimTypes.NameIdentifier)!, data.ToArray(), file.FileName, file.ContentType, ct);
            return Results.Ok(AuthEndpoints.Profile(user));
        }).RequireAuthorization("Verified").RequireRateLimiting("avatar");
        api.MapGet("/avatar/{version:guid}", async (Guid version, ClaimsPrincipal principal, GameDb db, CancellationToken ct) =>
        {
            var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var content = await db.Avatars.Where(a => a.UserId == id && a.Version == version).Select(a => a.Content).SingleOrDefaultAsync(ct);
            return content == null ? Results.NotFound() : Results.File(content, "image/jpeg");
        });
    }
}
public record ProfileInput(string? Name);
