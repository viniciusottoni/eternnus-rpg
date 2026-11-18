using Eternnus.Web;
using ImageMagick;

namespace Eternnus.Tests;

/// <summary>Miniatura da capa da Biblioteca (ADR-095): cabe em 720×480 sem distorcer.</summary>
public sealed class LibraryThumbnailTests
{
    static (uint Width, uint Height) Size(byte[] jpeg)
    {
        using var image = new MagickImage(jpeg, new MagickReadSettings { Format = MagickFormat.Jpeg });
        return (image.Width, image.Height);
    }

    [Theory]
    [InlineData(4000, 1000, 720, 180)]   // larga: limitada pela largura
    [InlineData(1000, 4000, 120, 480)]   // alta: limitada pela altura
    [InlineData(300, 200, 300, 200)]     // pequena: não amplia
    public void Png_fits_box_and_keeps_proportion(int w, int h, int ew, int eh)
    {
        var (width, height) = Size(LibraryThumbnails.Render(TestPng.Solid(w, h, 40, 90, 60), DocumentKinds.Png));
        Assert.Equal((uint)ew, width);
        Assert.Equal((uint)eh, height);
    }

    [Fact]
    public void Large_jpeg_is_decoded_reduced_and_keeps_proportion()
    {
        // JPEG grande: o decodificador já lê reduzido (jpeg:size). Arquivo acima de 4.096 px não pode ser montado aqui,
        // porque a política restritiva também vale para o teste; esse caso foi conferido à parte com um JPEG de 9000×6000.
        byte[] jpeg;
        using (var source = new MagickImage(TestPng.Solid(4000, 3000, 200, 120, 40), new MagickReadSettings { Format = MagickFormat.Png }))
            jpeg = source.ToByteArray(MagickFormat.Jpeg);
        var (width, height) = Size(LibraryThumbnails.Render(jpeg, DocumentKinds.Jpeg));
        Assert.Equal(640u, width);
        Assert.Equal(480u, height);
    }

    [Fact]
    public void Png_with_transparency_becomes_opaque_jpeg()
    {
        var bytes = LibraryThumbnails.Render(TestPng.Solid(100, 50, 10, 20, 30, 0), DocumentKinds.Png);
        Assert.Equal(0xFF, bytes[0]); Assert.Equal(0xD8, bytes[1]);
    }
}
