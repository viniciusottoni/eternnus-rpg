using System.Buffers.Binary;
using System.IO.Compression;

namespace Eternnus.Tests;

/// <summary>
/// PNG sólido escrito à mão. Evita o gerador <c>xc:</c> do ImageMagick
/// (<c>new MagickImage(cor, w, h)</c>): a política restritiva aplicada pela aplicação só libera
/// PNG/JPEG, e o resultado dependeria da ordem em que os testes carregam essa política.
/// </summary>
static class TestPng
{
    static uint Crc32(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }

    static void Chunk(Stream s, string type, byte[] data)
    {
        var len = new byte[4]; BinaryPrimitives.WriteInt32BigEndian(len, data.Length); s.Write(len);
        var body = System.Text.Encoding.ASCII.GetBytes(type).Concat(data).ToArray(); s.Write(body);
        var crc = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(crc, Crc32(body)); s.Write(crc);
    }

    /// <summary>Imagem RGB (ou RGBA quando <paramref name="a"/> é informado) de uma só cor.</summary>
    public static byte[] Solid(int width, int height, byte r, byte g, byte b, byte? a = null)
    {
        var pixel = a is { } alpha ? new[] { r, g, b, alpha } : new[] { r, g, b };
        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8; header[9] = (byte)(a is null ? 2 : 6); // 8 bits, RGB ou RGBA
        var row = new byte[1 + width * pixel.Length]; // filtro 0 + pixels
        for (var x = 0; x < width; x++) pixel.CopyTo(row, 1 + x * pixel.Length);
        using var raw = new MemoryStream();
        using (var z = new ZLibStream(raw, CompressionLevel.Fastest, true))
            for (var y = 0; y < height; y++) z.Write(row);
        using var png = new MemoryStream();
        png.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        Chunk(png, "IHDR", header); Chunk(png, "IDAT", raw.ToArray()); Chunk(png, "IEND", []);
        return png.ToArray();
    }
}
