namespace Eternnus.Web;

/// <summary>Únicas rotas autorizadas a ultrapassar o limite comum de 64 KiB por requisição.
/// O endpoint ainda valida tipo, tamanho real, assinatura e antivírus; este limite só evita ler corpos maiores.</summary>
public static class UploadLimits
{
    /// <summary>Arquivo da biblioteca ou PDF de ficha-modelo (25 MiB) + margem para multipart.</summary>
    public const long DocumentBytes = 25L * 1024 * 1024;
    public const long DocumentRequestBytes = DocumentBytes + 256 * 1024;

    /// <summary>Imagem importada por link para anexo de página: o corpo da requisição é JSON pequeno; o limite vale para o download.</summary>
    public const int LinkedImageBytes = 10 * 1024 * 1024;

    /// <summary>Importação em lote de sessões: CSV até 1 MiB + margem para multipart.</summary>
    public const long SessionImportRequestBytes = SessionImportFormat.MaxBytes + 64 * 1024;

    /// <summary>Camada de névoa do mapa (editor de cena, importação UVTT) e paredes da mesa: JSON com até
    /// <see cref="TableFog.MaxWalls"/> paredes com id (~115 bytes cada), grade de casas de um mapa de 4.096 px, 100 luzes e 100 marcas.
    /// Com 64 KiB só cabiam ~530 paredes, abaixo do limite do domínio (medido em tests/simplicity.mjs, ADR-100).</summary>
    public const long LayerRequestBytes = 512 * 1024;

    public static long? For(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        var layerParts = path.Split('/');
        if (layerParts.Length == 6 && layerParts[1] == "api" && Guid.TryParse(layerParts[3], out _)
            && (HttpMethods.IsPut(request.Method) && layerParts[2] == "campaigns" && layerParts[4] == "assets" && layerParts[5] == "layers"
                || HttpMethods.IsPost(request.Method) && layerParts[2] == "sessions" && layerParts[4] == "fog" && layerParts[5] == "walls"))
            return LayerRequestBytes;
        if (HttpMethods.IsPost(request.Method) && path == "/api/auth/avatar") return AvatarProcessor.MaxRequestBytes;
        if (HttpMethods.IsPost(request.Method) && path == "/api/library") return DocumentRequestBytes;
        var mapParts = path.Split('/');
        if (HttpMethods.IsPost(request.Method) && mapParts.Length == 6 && mapParts[1] == "api" && mapParts[2] == "campaigns"
            && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "assets" && mapParts[5] == "maps") return CampaignAssetsService.MaxImageRequestBytes;
        if (HttpMethods.IsPost(request.Method) && mapParts.Length == 8 && mapParts[1] == "api" && mapParts[2] == "campaigns" && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "workspace" && mapParts[5] == "pages" && Guid.TryParse(mapParts[6], out _) && mapParts[7] == "attachments") return DocumentRequestBytes;
        if (HttpMethods.IsPost(request.Method) && path == "/api/admin/music") return MusicLimits.MaxRequestBytes;
        if (HttpMethods.IsPost(request.Method) && mapParts.Length == 5 && mapParts[1] == "api" && mapParts[2] == "characters" && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "portrait") return CampaignAssetsService.MaxImageRequestBytes;
        if (HttpMethods.IsPost(request.Method) && mapParts.Length == 5 && mapParts[1] == "api" && mapParts[2] == "campaigns" && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "session-import") return SessionImportRequestBytes;
        // Editor de mapa de imagem: imagem-fonte (POST …/maps/{id}/sources) e composição + imagem achatada (PUT …/maps/{id}/composition).
        if (mapParts.Length == 8 && mapParts[1] == "api" && mapParts[2] == "campaigns" && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "assets" && mapParts[5] == "maps" && Guid.TryParse(mapParts[6], out _))
        {
            if (HttpMethods.IsPost(request.Method) && mapParts[7] == "sources") return CampaignAssetsService.MaxImageRequestBytes;
            if (HttpMethods.IsPut(request.Method) && mapParts[7] == "composition") return CampaignAssetsService.MaxCompositionRequestBytes;
        }
        // Composição visual da cena: imagem-fonte (POST …/scenes/{id}/sources) e composição + camada achatada (PUT …/scenes/{id}/composition).
        if (mapParts.Length == 7 && mapParts[1] == "api" && mapParts[2] == "campaigns" && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "scenes" && Guid.TryParse(mapParts[5], out _))
        {
            if (HttpMethods.IsPost(request.Method) && mapParts[6] == "sources") return CampaignAssetsService.MaxImageRequestBytes;
            if (HttpMethods.IsPut(request.Method) && mapParts[6] == "composition") return CampaignAssetsService.MaxCompositionRequestBytes;
        }
        if (!HttpMethods.IsPut(request.Method)) return null;
        var parts = path.Split('/');
        if (parts.Length == 5 && parts[1] == "api" && parts[2] == "library" && Guid.TryParse(parts[3], out _) && parts[4] == "file")
            return DocumentRequestBytes;
        if (parts.Length == 7 && parts[1] == "api" && parts[2] == "sheet-templates" && Guid.TryParse(parts[3], out _)
            && parts[4] == "versions" && Guid.TryParse(parts[5], out _) && parts[6] == "pdf")
            return DocumentRequestBytes;
        return null;
    }
}
