namespace Eternnus.Web;

/// <summary>Únicas rotas autorizadas a ultrapassar o limite comum de 64 KiB por requisição.
/// O endpoint ainda valida tipo, tamanho real, assinatura e antivírus; este limite só evita ler corpos maiores.</summary>
public static class UploadLimits
{
    /// <summary>Arquivo da biblioteca ou PDF de ficha-modelo (25 MiB) + margem para multipart.</summary>
    public const long DocumentBytes = 25L * 1024 * 1024;
    public const long DocumentRequestBytes = DocumentBytes + 256 * 1024;

    public static long? For(HttpRequest request)
    {
        var path = request.Path.Value ?? "";
        if (HttpMethods.IsPost(request.Method) && path == "/api/auth/avatar") return AvatarProcessor.MaxRequestBytes;
        if (HttpMethods.IsPost(request.Method) && path == "/api/library") return DocumentRequestBytes;
        var mapParts = path.Split('/');
        if (HttpMethods.IsPost(request.Method) && mapParts.Length == 6 && mapParts[1] == "api" && mapParts[2] == "campaigns"
            && Guid.TryParse(mapParts[3], out _) && mapParts[4] == "assets" && mapParts[5] == "maps") return CampaignAssetsService.MaxImageRequestBytes;
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
