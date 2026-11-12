using System.Security.Claims;
using System.Globalization;
using Microsoft.AspNetCore.Http.Features;
namespace Eternnus.Web;

public static class CampaignAssetsEndpoints
{
    public static void MapCampaignAssetsEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns/{campaignId:guid}/assets").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal user) => PlatformAccess.UserId(user);
        api.MapGet("/library", (Guid campaignId, int? page, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.LibraryAsync(campaignId, Id(u), page ?? 1, ct));
        // Textos antigos: não há mais criação/edição; o mestre converte cada um em página do Mundo (ADR-063).
        api.MapPost("/library/{id:guid}/convert", (Guid campaignId, Guid id, CampaignTextConvertInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.ConvertTextAsync(campaignId, id, Id(u), x, ct));
        api.MapDelete("/library/{id:guid}", async (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteTextAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
        api.MapGet("/maps", (Guid campaignId, Guid? folderId, int? page, string? purpose, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.MapTreeAsync(campaignId, Id(u), folderId, page ?? 1, ct, purpose));
        // Retratos de NPC: categoria isolada dos mapas, para o seletor de imagem do personagem.
        api.MapGet("/portraits", (Guid campaignId, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.PortraitChoicesAsync(campaignId, Id(u), ct));
        api.MapPost("/folders", (Guid campaignId, CampaignFolderInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.CreateFolderAsync(campaignId, Id(u), x, ct));
        api.MapPut("/folders/{id:guid}", (Guid campaignId, Guid id, CampaignFolderNameInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.RenameFolderAsync(campaignId, id, Id(u), x, ct));
        api.MapDelete("/folders/{id:guid}", async (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteFolderAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
        api.MapPost("/maps", async (Guid campaignId, HttpRequest request, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct);
            if (!request.HasFormContentType) throw new RuleException(400, "Envie a imagem pelo formulário.");
            IFormCollection form;
            try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = CampaignAssetsService.MaxImageBytes, ValueLengthLimit = 512, ValueCountLimit = 10, KeyLengthLimit = 32, MultipartHeadersLengthLimit = 4096, MultipartHeadersCountLimit = 8 }, ct); }
            catch (InvalidDataException) { throw new RuleException(413, "Formulário inválido ou imagem acima de 10 MB."); }
            string[] fields = ["name", "folderId", "gridPixels", "scaleMeters", "hasGrid", "gridOffsetX", "gridOffsetY", "purpose", "freeMovement"];
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Any(k => !fields.Contains(k))) throw new RuleException(400, "Envie uma imagem e os campos do mapa.");
            if (form.Files[0].Length > CampaignAssetsService.MaxImageBytes) throw new RuleException(413, "Envie imagem de até 10 MB.");
            Guid? folder = null;
            if (form["folderId"].ToString() is { Length: > 0 } folderText) folder = Guid.TryParse(folderText, out var f) ? f : throw new RuleException(400, "Pasta inválida.");
            if (!int.TryParse(form["gridPixels"], out var grid) || !decimal.TryParse(form["scaleMeters"], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var scale)) throw new RuleException(400, "Grade ou escala inválida.");
            // "Apenas imagem" (hasGrid=false) ou "Usar grade" com deslocamento opcional; ausentes = grade sem deslocamento (contrato anterior).
            var hasGrid = form["hasGrid"].ToString() is not ("false" or "0");
            // "Movimentação livre": marcadores em qualquer ponto; ausente = movimento por casas.
            var freeMovement = form["freeMovement"].ToString() is "true" or "1";
            static int Offset(string text) => text.Length == 0 ? 0 : int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : throw new RuleException(400, "Deslocamento da grade inválido.");
            var document = await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.SaveMapAsync(campaignId, null, Id(u), new(form["name"].ToString(), folder, grid, scale, 0, hasGrid, Offset(form["gridOffsetX"].ToString()), Offset(form["gridOffsetY"].ToString()), CampaignAssetPurposes.Normalize(form["purpose"].ToString()), freeMovement), document, ct));
        }).RequireRateLimiting("upload");
        api.MapPost("/maps/import", async (Guid campaignId, CampaignMapImportInput x, RemoteImageFetcher remote, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct); // autoriza antes de qualquer acesso à rede
            var (bytes, fileName) = await remote.FetchAsync(x.Url, CampaignAssetsService.MaxImageBytes, ct);
            var document = await files.CheckAsync(bytes, fileName, new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.SaveMapAsync(campaignId, null, Id(u), new(x.Name, x.FolderId, x.GridPixels, x.ScaleMeters, 0, x.HasGrid, x.GridOffsetX, x.GridOffsetY, null, x.FreeMovement), document, ct));
        }).RequireRateLimiting("upload");
        api.MapPut("/maps/{id:guid}", (Guid campaignId, Guid id, CampaignMapInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveMapAsync(campaignId, id, Id(u), x, null, ct));
        api.MapDelete("/maps/{id:guid}", async (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteMapAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
        // Preparação de névoa/luz: key = chave oficial (ex.: crypt) ou asset:{guid}.
        // scene (opcional): camada própria da cena quando ela usa preparação própria; senão, a do mapa.
        api.MapGet("/layers", (Guid campaignId, string key, Guid? scene, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.LayerAsync(campaignId, key, Id(u), ct, scene));
        api.MapPut("/layers", (Guid campaignId, string key, Guid? scene, MapLayerInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveLayerAsync(campaignId, key, Id(u), x, ct, scene));
        api.MapGet("/maps/{id:guid}/image", async (Guid campaignId, Guid id, string? @as, HttpContext http, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var bytes = await s.ImageAsync(campaignId, id, Id(u), ct, string.IsNullOrEmpty(@as) ? null : @as);
            http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(bytes, DocumentKinds.Jpeg, enableRangeProcessing: false);
        });
    }
}
