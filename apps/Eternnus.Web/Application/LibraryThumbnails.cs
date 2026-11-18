using System.Runtime.CompilerServices;
using ImageMagick;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
namespace Eternnus.Web;

/// <summary>
/// Miniatura das imagens da Biblioteca para a capa do cartão (ADR-095). Gerada sob demanda a partir do arquivo guardado,
/// sem distorção (cabe em <see cref="MaxWidth"/>×<see cref="MaxHeight"/> mantendo a proporção) e guardada em memória
/// por arquivo (o conteúdo de um <see cref="StoredFile"/> nunca muda). Imagem que não pode ser reduzida dentro da política
/// restritiva do ImageMagick (PNG acima de 4.096 px, WebP) não tem miniatura: o cartão mantém o ícone.
/// </summary>
public sealed class LibraryThumbnails(IServiceScopeFactory scopes, ILogger<LibraryThumbnails> logger)
{
    public const int MaxWidth = 720, MaxHeight = 480;
    static readonly byte[] None = [];
    readonly MemoryCache cache = new(new MemoryCacheOptions { SizeLimit = 48L * 1024 * 1024 });
    readonly SemaphoreSlim gate = new(2, 2);

    /// <summary>Bytes JPEG da miniatura ou <c>null</c> quando o arquivo não é imagem ou não pôde ser reduzido.</summary>
    public async Task<byte[]?> GetAsync(Guid fileId, string contentType, CancellationToken ct)
    {
        if (contentType is not (DocumentKinds.Jpeg or DocumentKinds.Png)) return null;
        if (cache.TryGetValue(fileId, out byte[]? hit)) return hit!.Length == 0 ? null : hit;
        if (!await gate.WaitAsync(TimeSpan.FromSeconds(20), ct)) throw new RuleException(429, "Há miniaturas sendo preparadas. Tente novamente em instantes.");
        try
        {
            if (cache.TryGetValue(fileId, out hit)) return hit!.Length == 0 ? null : hit;
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<GameDb>();
            var content = await db.Files.AsNoTracking().Where(f => f.Id == fileId).Select(f => f.Content).SingleOrDefaultAsync(ct);
            if (content is null) return null;
            byte[] result;
            try { result = Render(content, contentType); }
            catch (MagickException)
            {
                logger.LogInformation("Library thumbnail unavailable for stored file {FileId}.", fileId);
                result = None;
            }
            cache.Set(fileId, result, new MemoryCacheEntryOptions { Size = Math.Max(1, result.Length), SlidingExpiration = TimeSpan.FromHours(6) });
            return result.Length == 0 ? null : result;
        }
        finally { gate.Release(); }
    }

    /// <summary>Reduz a imagem para caber em MaxWidth×MaxHeight sem distorcer. JPEG grande é decodificado já reduzido (jpeg:size).</summary>
    public static byte[] Render(byte[] content, string contentType)
    {
        // Reaproveita a política global restritiva de coders/delegates/recursos dos avatares.
        RuntimeHelpers.RunClassConstructor(typeof(AvatarProcessor).TypeHandle);
        var settings = new MagickReadSettings { Format = contentType == DocumentKinds.Png ? MagickFormat.Png : MagickFormat.Jpeg };
        if (contentType == DocumentKinds.Jpeg) settings.SetDefine(MagickFormat.Jpeg, "size", $"{MaxWidth * 2}x{MaxHeight * 2}");
        using var image = new MagickImage();
        image.Read(content, settings);
        image.AutoOrient();
        image.Strip();
        if (image.Width > MaxWidth || image.Height > MaxHeight) image.Thumbnail(new MagickGeometry(MaxWidth, MaxHeight)); // geometria sem "!" mantém a proporção
        if (image.HasAlpha) { image.BackgroundColor = new MagickColor("#141513"); image.Alpha(AlphaAction.Remove); }
        image.Quality = 80;
        return image.ToByteArray(MagickFormat.Jpeg);
    }
}
