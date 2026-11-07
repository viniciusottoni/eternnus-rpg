using ImageMagick;
using System.Buffers.Binary;
namespace Eternnus.Web;

public static class AvatarProcessor
{
    public const int MaxBytes = 2 * 1024 * 1024;
    public const int MaxRequestBytes = MaxBytes + 16384;
    static AvatarProcessor()
    {
        var configuration = ImageMagick.Configuration.ConfigurationFiles.Default;
        configuration.Policy.Data = """
            <policymap>
              <policy domain="delegate" rights="none" pattern="*" />
              <policy domain="filter" rights="none" pattern="*" />
              <policy domain="path" rights="none" pattern="*" />
              <policy domain="coder" rights="none" pattern="*" />
              <policy domain="coder" rights="read|write" pattern="{JPEG,PNG}" />
              <policy domain="resource" name="memory" value="128MiB" />
              <policy domain="resource" name="map" value="0" />
              <policy domain="resource" name="disk" value="0" />
              <policy domain="resource" name="width" value="4096" />
              <policy domain="resource" name="height" value="4096" />
              <policy domain="resource" name="list-length" value="16" />
              <policy domain="resource" name="thread" value="1" />
              <policy domain="resource" name="time" value="10" />
            </policymap>
            """;
        MagickNET.Initialize(configuration);
    }
    public static MagickFormat Validate(byte[] data, string filename, string contentType)
    {
        if (data.Length is < 16 or > MaxBytes) throw new RuleException(400, "Envie uma imagem JPEG ou PNG de até 2 MB.");
        var extension = Path.GetExtension(filename).ToLowerInvariant();
        if (data.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) && extension == ".png" && contentType == "image/png")
        {
            for (var offset = 8; offset + 12 <= data.Length;)
            {
                var size = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(offset, 4));
                if (size > data.Length - offset - 12) throw new RuleException(400, "Imagem PNG danificada.");
                var chunk = System.Text.Encoding.ASCII.GetString(data, offset + 4, 4);
                if (chunk is "acTL" or "fcTL" or "fdAT") throw new RuleException(400, "Use uma imagem estática, sem animação.");
                offset += checked((int)size + 12);
            }
            return MagickFormat.Png;
        }
        if (data[0] == 255 && data[1] == 216 && data[2] == 255 && extension is ".jpg" or ".jpeg" && contentType == "image/jpeg") return MagickFormat.Jpeg;
        throw new RuleException(400, "Formato inválido. Escolha um arquivo JPEG ou PNG verdadeiro.");
    }
    public static byte[] Normalize(byte[] data, MagickFormat format, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try
        {
            var settings = new MagickReadSettings { Format = format };
            using var image = new MagickImage();
            image.Ping(data, settings);
            if (image.Width < 64 || image.Height < 64 || image.Width > 4096 || image.Height > 4096 || (long)image.Width * image.Height > 8000000)
                throw new RuleException(400, "A imagem deve ter entre 64 e 4.096 pixels por lado e até 8 milhões de pixels.");
            image.Read(data, settings);
            image.AutoOrient();
            // Keep the complete image for moderation; crop only via object-fit in the UI.
            image.Resize(new MagickGeometry(512, 512) { Greater = true });
            image.Extent(512, 512, Gravity.Center, MagickColors.White);
            image.Strip();
            image.BackgroundColor = MagickColors.White;
            image.Alpha(AlphaAction.Remove);
            image.Quality = 85;
            ct.ThrowIfCancellationRequested();
            var output = image.ToByteArray(MagickFormat.Jpeg);
            if (output.Length > MaxBytes) throw new RuleException(400, "Não foi possível preparar essa imagem.");
            return output;
        }
        catch (MagickException) { throw new RuleException(400, "Imagem inválida, danificada, animada ou acima dos limites permitidos."); }
    }
}

