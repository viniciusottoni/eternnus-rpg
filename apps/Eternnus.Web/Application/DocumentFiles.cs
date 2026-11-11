using System.Security.Cryptography;
using System.Text;
namespace Eternnus.Web;

/// <summary>Tipos de documento aceitos. O tipo é decidido pela assinatura dos bytes, nunca pelo Content-Type/extensão do cliente.</summary>
public static class DocumentKinds
{
    public const string Pdf = "application/pdf", Png = "image/png", Jpeg = "image/jpeg", WebP = "image/webp";
    public static readonly string[] Library = [Pdf, Png, Jpeg, WebP];
    public static readonly string[] SheetPdf = [Pdf];
    public static string Extension(string contentType) => contentType switch { Pdf => ".pdf", Png => ".png", Jpeg => ".jpg", WebP => ".webp", _ => "" };
}

/// <summary>Documento lido, verificado e pronto para virar <see cref="StoredFile"/>.</summary>
public sealed record UploadedDocument(byte[] Content, string ContentType, string FileName, string Sha256)
{
    public StoredFile ToStoredFile(string uploadedById) => new()
    {
        Content = Content, ContentType = ContentType, Size = Content.LongLength, Sha256 = Sha256, UploadedById = uploadedById,
    };
}

/// <summary>Leitura segura de uploads de documentos (biblioteca e PDFs de fichas-modelo): limite real de bytes,
/// assinatura, nome saneado, SHA-256 e antivírus. Conteúdo ativo de PDF (scripts) nunca é executado pela plataforma:
/// o visualizador usa pdf.js sem scripting e downloads saem como anexo com CSP sandbox.</summary>
public sealed class DocumentFiles(IDocumentScanner scanner)
{
    public async Task<UploadedDocument> ReadAsync(IFormFile? file, IReadOnlyCollection<string> allowed, CancellationToken ct)
    {
        if (file is null || file.Length <= 0) throw new RuleException(400, "Escolha um arquivo.");
        if (file.Length > UploadLimits.DocumentBytes) throw new RuleException(413, "O arquivo excede o limite de 25 MB.");
        var content = new byte[file.Length];
        await using (var stream = file.OpenReadStream())
        {
            var read = 0;
            while (read < content.Length)
            {
                var n = await stream.ReadAsync(content.AsMemory(read), ct);
                if (n == 0) break;
                read += n;
            }
            if (read != content.Length || stream.ReadByte() != -1) throw new RuleException(400, "O envio do arquivo foi interrompido. Tente novamente.");
        }
        return await CheckAsync(content, file.FileName, allowed, ct);
    }

    /// <summary>Mesma verificação do upload (assinatura, antivírus, nome saneado) para bytes obtidos de outra forma, como a importação por link.</summary>
    public async Task<UploadedDocument> CheckAsync(byte[] content, string? fileName, IReadOnlyCollection<string> allowed, CancellationToken ct)
    {
        if (content.Length == 0) throw new RuleException(400, "Escolha um arquivo.");
        var type = Sniff(content);
        if (type is null || !allowed.Contains(type))
            throw new RuleException(415, allowed.Count == 1 && allowed.Contains(DocumentKinds.Pdf) ? "Envie um arquivo PDF válido." : "Formato não aceito. Envie PDF, PNG, JPEG ou WebP.");
        await scanner.ScanAsync(content, ct);
        return new UploadedDocument(content, type, SafeFileName(fileName, type), Convert.ToHexStringLower(SHA256.HashData(content)));
    }

    /// <summary>Identifica o tipo pelos primeiros bytes. Nulo se não reconhecido.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b)
    {
        if (b.Length >= 5 && b[..5].SequenceEqual("%PDF-"u8)) return DocumentKinds.Pdf;
        if (b.Length >= 8 && b[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return DocumentKinds.Png;
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return DocumentKinds.Jpeg;
        if (b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8)) return DocumentKinds.WebP;
        return null;
    }

    /// <summary>Nome de exibição/download: sem caminho, sem controle/reservados, até 160 caracteres, extensão coerente com o tipo real.</summary>
    public static string SafeFileName(string? original, string contentType)
    {
        var name = Path.GetFileNameWithoutExtension((original ?? "").Replace('\\', '/').Split('/').Last());
        var sb = new StringBuilder();
        foreach (var ch in name.Normalize(NormalizationForm.FormC))
        {
            if (char.IsControl(ch) || "<>:\"/\\|?*;%".Contains(ch)) continue;
            sb.Append(char.IsWhiteSpace(ch) ? ' ' : ch);
        }
        var clean = string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries)).Trim('.', ' ');
        if (clean.Length == 0) clean = "arquivo";
        var ext = DocumentKinds.Extension(contentType);
        if (clean.Length + ext.Length > 160) clean = clean[..(160 - ext.Length)];
        return clean + ext;
    }

    /// <summary>Cabeçalhos para servir um arquivo enviado por usuário: anexo (ou inline só para visualizador same-origin), sem sniffing e sandbox.</summary>
    public static IResult Serve(HttpContext http, StoredFile file, string fileName, bool inline)
    {
        http.Response.Headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
        http.Response.Headers.CacheControl = "private, no-store";
        return Results.File(file.Content, file.ContentType, inline ? null : fileName, enableRangeProcessing: false);
    }
}

public interface IDocumentScanner
{
    Task ScanAsync(byte[] content, CancellationToken ct);
}

/// <summary>Antivírus de documentos via ClamAV (Uploads:ClamAv:Host/Port, com fallback para Avatar:ClamAv:*), em modo
/// "melhor esforço" (ADR-058): sempre tenta verificar; arquivo detectado é recusado (422), mas scanner ausente,
/// inacessível ou com resposta inesperada não bloqueia o envio — o documento é aceito e um aviso vai para o log.</summary>
public sealed class ClamAvDocumentScanner(IConfiguration config, ILogger<ClamAvDocumentScanner> logger) : IDocumentScanner
{
    sealed class ScannerUnavailable() : RuleException(503, "A verificação de segurança de arquivos está indisponível.");
    public async Task ScanAsync(byte[] content, CancellationToken ct)
    {
        var host = config["Uploads:ClamAv:Host"] ?? config["Avatar:ClamAv:Host"];
        var port = config.GetValue<int?>("Uploads:ClamAv:Port") ?? config.GetValue("Avatar:ClamAv:Port", 3310);
        if (string.IsNullOrWhiteSpace(host))
        {
            logger.LogWarning("Document accepted without antivirus scan: ClamAV not configured.");
            return;
        }
        try
        {
            await ClamAvClient.ScanAsync(host, port, content, "O arquivo foi recusado pela verificação de segurança.", () => new ScannerUnavailable(), ct);
        }
        catch (ScannerUnavailable)
        {
            logger.LogWarning("Document accepted without antivirus scan: ClamAV unavailable or returned an unexpected reply.");
        }
    }
}
