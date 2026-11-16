using System.Security.Claims;
using System.Globalization;
using Microsoft.AspNetCore.Http.Features;
namespace Eternnus.Web;

public static class CampaignAssetsEndpoints
{
    static int Offset(string text) => text.Length == 0 ? 0 : int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : throw new RuleException(400, "Deslocamento da grade inválido.");

    /// <summary>Formulário multipart com uma imagem (até 10 MB) e campos curtos; <paramref name="valueLimit"/> é o maior campo aceito.</summary>
    static async Task<IFormCollection> ReadImageFormAsync(HttpRequest request, int valueLimit, CancellationToken ct)
    {
        if (!request.HasFormContentType) throw new RuleException(400, "Envie a imagem pelo formulário.");
        IFormCollection form;
        try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = CampaignAssetsService.MaxImageBytes, ValueLengthLimit = valueLimit, ValueCountLimit = 16, KeyLengthLimit = 32, MultipartHeadersLengthLimit = 4096, MultipartHeadersCountLimit = 8 }, ct); }
        catch (InvalidDataException) { throw new RuleException(413, "Formulário inválido ou imagem acima de 10 MB."); }
        if (form.Files.Count == 1 && form.Files[0].Length > CampaignAssetsService.MaxImageBytes) throw new RuleException(413, "Envie imagem de até 10 MB.");
        return form;
    }

    public static void MapCampaignAssetsEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/campaigns/{campaignId:guid}/assets").RequireAuthorization("Verified");
        static string Id(ClaimsPrincipal user) => PlatformAccess.UserId(user);
        api.MapGet("/library", (Guid campaignId, int? page, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.LibraryAsync(campaignId, Id(u), page ?? 1, ct));
        // Textos antigos: não há mais criação/edição; o mestre converte cada um em página do Mundo (ADR-063).
        api.MapPost("/library/{id:guid}/convert", (Guid campaignId, Guid id, CampaignTextConvertInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.ConvertTextAsync(campaignId, id, Id(u), x, ct));
        api.MapDelete("/library/{id:guid}", async (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteTextAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
        api.MapGet("/maps", (Guid campaignId, Guid? folderId, int? page, string? purpose, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.MapTreeAsync(campaignId, Id(u), folderId, page ?? 1, ct, purpose));
        api.MapGet("/tile-catalog", (Guid campaignId, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.TileCatalogAsync(campaignId, Id(u), ct));
        api.MapGet("/tile-maps/{id:guid}", (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.TileMapAsync(campaignId, id, Id(u), ct));
        api.MapPost("/tile-maps", (Guid campaignId, TileMapInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveTileMapAsync(campaignId, null, Id(u), x, ct));
        api.MapPut("/tile-maps/{id:guid}", (Guid campaignId, Guid id, TileMapInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveTileMapAsync(campaignId, id, Id(u), x, ct));
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
            try { form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = CampaignAssetsService.MaxImageBytes, ValueLengthLimit = 512, ValueCountLimit = 16, KeyLengthLimit = 32, MultipartHeadersLengthLimit = 4096, MultipartHeadersCountLimit = 8 }, ct); }
            catch (InvalidDataException) { throw new RuleException(413, "Formulário inválido ou imagem acima de 10 MB."); }
            string[] fields = ["name", "folderId", "gridPixels", "scaleMeters", "hasGrid", "gridOffsetX", "gridOffsetY", "purpose", "freeMovement", "summary", "sourceKey"];
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Any(k => !fields.Contains(k))) throw new RuleException(400, "Envie uma imagem e os campos do mapa.");
            if (form.Files[0].Length > CampaignAssetsService.MaxImageBytes) throw new RuleException(413, "Envie imagem de até 10 MB.");
            Guid? folder = null;
            if (form["folderId"].ToString() is { Length: > 0 } folderText) folder = Guid.TryParse(folderText, out var f) ? f : throw new RuleException(400, "Pasta inválida.");
            if (!int.TryParse(form["gridPixels"], out var grid) || !decimal.TryParse(form["scaleMeters"], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var scale)) throw new RuleException(400, "Grade ou escala inválida.");
            // "Apenas imagem" (hasGrid=false) ou "Usar grade" com deslocamento opcional; ausentes = grade sem deslocamento (contrato anterior).
            var hasGrid = form["hasGrid"].ToString() is not ("false" or "0");
            // "Movimentação livre": marcadores em qualquer ponto; ausente = movimento por casas.
            var freeMovement = form["freeMovement"].ToString() is "true" or "1";
            var document = await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            string? Optional(string key) => form.ContainsKey(key) ? form[key].ToString() : null;
            return Results.Ok(await s.SaveMapAsync(campaignId, null, Id(u), new(form["name"].ToString(), folder, grid, scale, 0, hasGrid, Offset(form["gridOffsetX"].ToString()), Offset(form["gridOffsetY"].ToString()), CampaignAssetPurposes.Normalize(form["purpose"].ToString()), freeMovement, Optional("summary"), Optional("sourceKey")), document, ct));
        }).RequireRateLimiting("upload");
        api.MapPost("/maps/import", async (Guid campaignId, CampaignMapImportInput x, RemoteImageFetcher remote, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct); // autoriza antes de qualquer acesso à rede
            var (bytes, fileName) = await remote.FetchAsync(x.Url, CampaignAssetsService.MaxImageBytes, ct);
            var document = await files.CheckAsync(bytes, fileName, new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.SaveMapAsync(campaignId, null, Id(u), new(x.Name, x.FolderId, x.GridPixels, x.ScaleMeters, 0, x.HasGrid, x.GridOffsetX, x.GridOffsetY, null, x.FreeMovement, x.Summary, x.SourceKey), document, ct));
        }).RequireRateLimiting("upload");
        // Mapa de imagem editável (ADR-081 §4): composição + imagem achatada no navegador, numa única escrita.
        api.MapGet("/maps/{id:guid}/composition", (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.CompositionAsync(campaignId, id, Id(u), ct));
        api.MapPut("/maps/{id:guid}/composition", async (Guid campaignId, Guid id, HttpRequest request, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct);
            var form = await ReadImageFormAsync(request, MapComposition.MaxLength, ct);
            string[] fields = ["composition", "revision", "name", "summary", "gridPixels", "scaleMeters", "hasGrid", "gridOffsetX", "gridOffsetY", "freeMovement"];
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Any(k => !fields.Contains(k))) throw new RuleException(400, "Envie a imagem achatada e os campos do mapa.");
            if (!int.TryParse(form["revision"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var revision)
                || !int.TryParse(form["gridPixels"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var grid)
                || !decimal.TryParse(form["scaleMeters"], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var scale)) throw new RuleException(400, "Revisão, grade ou escala inválida.");
            var document = await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            var input = new MapCompositionInput(form["composition"].ToString(), revision, form["name"].ToString(), form.ContainsKey("summary") ? form["summary"].ToString() : null, grid, scale,
                form["hasGrid"].ToString() is not ("false" or "0"), Offset(form["gridOffsetX"].ToString()), Offset(form["gridOffsetY"].ToString()), form["freeMovement"].ToString() is "true" or "1");
            return Results.Ok(await s.SaveCompositionAsync(campaignId, id, Id(u), input, document, ct));
        }).RequireRateLimiting("upload");
        // Imagens-fonte do mapa: só o mestre lê os bytes (rota /maps/{id}/image); não contam no limite de mapas.
        api.MapPost("/maps/{id:guid}/sources", async (Guid campaignId, Guid id, HttpRequest request, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct);
            var form = await ReadImageFormAsync(request, 512, ct);
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Any(k => k != "name")) throw new RuleException(400, "Envie uma imagem e, se quiser, o nome.");
            var document = await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.AddSourceAsync(campaignId, id, Id(u), form["name"].ToString(), document, ct));
        }).RequireRateLimiting("upload");
        api.MapPost("/maps/{id:guid}/sources/import", async (Guid campaignId, Guid id, MapSourceImportInput x, RemoteImageFetcher remote, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct); // autoriza antes de qualquer acesso à rede
            var (bytes, fileName) = await remote.FetchAsync(x.Url, CampaignAssetsService.MaxImageBytes, ct);
            var document = await files.CheckAsync(bytes, fileName, new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.AddSourceAsync(campaignId, id, Id(u), x.Name, document, ct));
        }).RequireRateLimiting("upload");
        api.MapPost("/maps/{id:guid}/sources/copy", (Guid campaignId, Guid id, MapSourceCopyInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.CopySourceAsync(campaignId, id, Id(u), x, ct));
        api.MapPut("/maps/{id:guid}", (Guid campaignId, Guid id, CampaignMapInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveMapAsync(campaignId, id, Id(u), x, null, ct));
        api.MapDelete("/maps/{id:guid}", async (Guid campaignId, Guid id, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteMapAsync(campaignId, id, Id(u), ct); return Results.NoContent(); });
        // Preparação de névoa/luz: key = chave oficial (ex.: crypt) ou asset:{guid}.
        // scene (opcional): camada própria da cena quando ela usa preparação própria; senão, a do mapa.
        api.MapGet("/layers", (Guid campaignId, string key, Guid? scene, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.LayerAsync(campaignId, key, Id(u), ct, scene));
        api.MapPut("/layers", (Guid campaignId, string key, Guid? scene, MapLayerInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveLayerAsync(campaignId, key, Id(u), x, ct, scene));
        // Pontos de entrada do mapa da campanha (key = asset:{guid}); mapas oficiais respondem 404.
        api.MapPut("/entries", (Guid campaignId, string key, MapEntriesInput x, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveEntriesAsync(campaignId, key, Id(u), x, ct));
        // overlay (opcional): camada da composição da cena na mesa; só vale quando é a da sessão ativa neste mapa.
        api.MapGet("/maps/{id:guid}/image", async (Guid campaignId, Guid id, string? @as, Guid? overlay, HttpContext http, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var bytes = await s.ImageAsync(campaignId, id, Id(u), ct, string.IsNullOrEmpty(@as) ? null : @as, overlay);
            http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(bytes, CampaignAssetsService.ImageType(bytes), enableRangeProcessing: false);
        });

        // Composição visual própria da cena (mestre): imagens-fonte da cena e composição + camada achatada para os jogadores.
        var scenes = app.MapGroup("/api/campaigns/{campaignId:guid}/scenes/{sceneId:guid}").RequireAuthorization("Verified");
        scenes.MapPost("/sources", async (Guid campaignId, Guid sceneId, HttpRequest request, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct);
            var form = await ReadImageFormAsync(request, 512, ct);
            if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Keys.Any(k => k != "name")) throw new RuleException(400, "Envie uma imagem e, se quiser, o nome.");
            var document = await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct);
            return Results.Ok(await s.AddSceneSourceAsync(campaignId, sceneId, Id(u), form["name"].ToString(), document, ct));
        }).RequireRateLimiting("upload");
        scenes.MapPut("/composition", async (Guid campaignId, Guid sceneId, HttpRequest request, DocumentFiles files, CampaignAssetsService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.EnsureMasterAsync(campaignId, Id(u), ct);
            var form = await ReadImageFormAsync(request, MapComposition.MaxLength, ct);
            // Sem arquivo = nada da composição para os jogadores; composição vazia remove a composição da cena.
            if (form.Files.Count > 1 || (form.Files.Count == 1 && form.Files[0].Name != "file") || form.Keys.Any(k => k is not ("composition" or "revision")))
                throw new RuleException(400, "Envie a composição, a revisão da cena e, se houver, a camada achatada.");
            if (!int.TryParse(form["revision"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var revision)) throw new RuleException(400, "Revisão inválida.");
            var document = form.Files.Count == 1 ? await files.ReadAsync(form.Files[0], new[] { DocumentKinds.Png, DocumentKinds.Jpeg }, ct) : null;
            return Results.Ok(await s.SaveSceneCompositionAsync(campaignId, sceneId, Id(u), form["composition"].ToString(), revision, document, ct));
        }).RequireRateLimiting("upload");
    }
}
