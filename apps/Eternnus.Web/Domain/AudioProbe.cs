using System.Buffers.Binary;
namespace Eternnus.Web;

/// <summary>Formatos de áudio aceitos no acervo. O tipo vem da estrutura real do arquivo, nunca da extensão ou do MIME do cliente.</summary>
public static class AudioFormats
{
    public const string Mpeg = "audio/mpeg", Mp4 = "audio/mp4", Ogg = "audio/ogg";
    public static readonly string[] All = [Mpeg, Mp4, Ogg];
    public static string Label(string contentType) => contentType switch { Mpeg => "MP3", Mp4 => "M4A (AAC)", Ogg => "OGG", _ => "Áudio" };
}

public sealed record AudioProbeResult(string ContentType, int? DurationMs);

/// <summary>
/// Validação estrutural de áudio: MP3 (MPEG Layer III), M4A/AAC (MP4 com uma faixa de som mp4a e nenhuma de vídeo)
/// e OGG (um único fluxo Vorbis ou Opus). Percorre o arquivo inteiro: quadros/páginas/caixas precisam cobrir os bytes,
/// o que recusa imagens, executáveis e arquivos com conteúdo arbitrário acrescentado. Não decodifica o áudio.
/// </summary>
public static class AudioProbe
{
    const long MaxDurationMs = 6L * 60 * 60 * 1000;

    public static AudioProbeResult? Inspect(ReadOnlySpan<byte> data) => Mp3(data) ?? Ogg(data) ?? Mp4(data);

    static int? Duration(double milliseconds) => milliseconds is > 0 and <= MaxDurationMs ? (int)Math.Round(milliseconds) : null;

    // ---------- MP3 ----------
    static readonly int[] Mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    static readonly int[] Mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    static readonly int[][] SampleRates = [[11025, 12000, 8000], [], [22050, 24000, 16000], [44100, 48000, 32000]];

    /// <summary>Cabeçalho de quadro MPEG Layer III: tamanho do quadro, taxa de amostragem e amostras por quadro.</summary>
    public static bool Mp3Frame(ReadOnlySpan<byte> h, out int length, out int sampleRate, out int samples)
    {
        length = sampleRate = samples = 0;
        if (h.Length < 4 || h[0] != 0xFF || (h[1] & 0xE0) != 0xE0) return false;
        var version = (h[1] >> 3) & 3; var layer = (h[1] >> 1) & 3;
        var bitrateIndex = h[2] >> 4; var rateIndex = (h[2] >> 2) & 3; var padding = (h[2] >> 1) & 1;
        if (version == 1 || layer != 1 || bitrateIndex is 0 or 15 || rateIndex == 3 || (h[3] & 3) == 2) return false;
        var bitrate = (version == 3 ? Mpeg1Bitrates : Mpeg2Bitrates)[bitrateIndex] * 1000;
        sampleRate = SampleRates[version][rateIndex];
        samples = version == 3 ? 1152 : 576;
        length = (version == 3 ? 144 : 72) * bitrate / sampleRate + padding;
        return length >= 24;
    }

    static AudioProbeResult? Mp3(ReadOnlySpan<byte> b)
    {
        var start = 0;
        while (b.Length - start >= 10 && b[start] == 'I' && b[start + 1] == 'D' && b[start + 2] == '3')
        {
            if (b[start + 3] == 0xFF || b[start + 4] == 0xFF || b[start + 6] >= 0x80 || b[start + 7] >= 0x80 || b[start + 8] >= 0x80 || b[start + 9] >= 0x80) return null;
            var size = (b[start + 6] << 21) | (b[start + 7] << 14) | (b[start + 8] << 7) | b[start + 9];
            start += 10 + size + ((b[start + 5] & 0x10) != 0 ? 10 : 0);
            if (start >= b.Length) return null;
        }
        var pos = start;
        while (pos < b.Length && b[pos] == 0 && pos - start < 65536) pos++;
        long covered = 0, junk = 0; var frames = 0; double milliseconds = 0;
        while (pos + 4 <= b.Length)
        {
            if (Mp3Frame(b.Slice(pos, 4), out var length, out var rate, out var samples) && pos + length <= b.Length)
            {
                milliseconds += samples * 1000.0 / rate; covered += length; frames++; pos += length;
                continue;
            }
            if (frames == 0) return null;
            // Ressincroniza após um trecho corrompido curto: o próximo quadro precisa ser seguido por outro quadro válido.
            var next = -1;
            for (var p = pos + 1; p + 4 <= b.Length && p - pos <= 4096; p++)
                if (Mp3Frame(b.Slice(p, 4), out var l, out _, out _) && (p + l == b.Length || (p + l + 4 <= b.Length && Mp3Frame(b.Slice(p + l, 4), out _, out _, out _)))) { next = p; break; }
            if (next < 0) break;
            junk += next - pos; pos = next;
        }
        long region = b.Length - start, trailer = b.Length - pos;
        if (frames < 8 || trailer > 128 * 1024 || covered < region * 0.9 || junk > region * 0.01 + 4096) return null;
        return new(AudioFormats.Mpeg, Duration(milliseconds));
    }

    // ---------- OGG ----------
    static AudioProbeResult? Ogg(ReadOnlySpan<byte> b)
    {
        if (!b.StartsWith("OggS"u8)) return null;
        int pos = 0, pages = 0, rate = 0, preSkip = 0; long lastGranule = -1; uint serial = 0;
        while (pos < b.Length)
        {
            if (b.Length - pos < 27 || !b.Slice(pos, 4).SequenceEqual("OggS"u8) || b[pos + 4] != 0) return null;
            var flags = b[pos + 5];
            var granule = BinaryPrimitives.ReadInt64LittleEndian(b.Slice(pos + 6, 8));
            var stream = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(pos + 14, 4));
            var segments = b[pos + 26];
            if (b.Length - pos < 27 + segments) return null;
            var body = 0;
            for (var i = 0; i < segments; i++) body += b[pos + 27 + i];
            var header = 27 + segments;
            if (b.Length - pos < header + body) return null;
            var payload = b.Slice(pos + header, body);
            if (pages == 0)
            {
                if ((flags & 2) == 0) return null;
                serial = stream;
                if (payload.Length >= 30 && payload[0] == 1 && payload.Slice(1, 6).SequenceEqual("vorbis"u8)) rate = (int)Math.Min(BinaryPrimitives.ReadUInt32LittleEndian(payload.Slice(12, 4)), 768000);
                else if (payload.Length >= 19 && payload[..8].SequenceEqual("OpusHead"u8)) { rate = 48000; preSkip = BinaryPrimitives.ReadUInt16LittleEndian(payload.Slice(10, 2)); }
                else return null;
            }
            // Um único fluxo lógico: recusa vídeo multiplexado e fluxos encadeados.
            else if (stream != serial || (flags & 2) != 0) return null;
            if (granule >= 0) lastGranule = granule;
            pages++; pos += header + body;
        }
        if (pages < 2 || rate <= 0) return null;
        return new(AudioFormats.Ogg, lastGranule > preSkip ? Duration((lastGranule - preSkip) * 1000.0 / rate) : null);
    }

    // ---------- M4A (MP4/AAC) ----------
    static readonly string[] Mp4Brands = ["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2", "iso5", "iso6", "dash"];

    static string Type(ReadOnlySpan<byte> b, int at) => System.Text.Encoding.ASCII.GetString(b.Slice(at, 4));

    /// <summary>Caixas filhas da região [start, end). Nulo se alguma caixa não couber exatamente na região.</summary>
    static List<(string Type, int Body, int End)>? Boxes(ReadOnlySpan<byte> b, int start, int end)
    {
        var list = new List<(string, int, int)>(); var pos = start;
        while (pos < end)
        {
            if (end - pos < 8) return null;
            long size = BinaryPrimitives.ReadUInt32BigEndian(b.Slice(pos, 4)); var header = 8;
            if (size == 1)
            {
                if (end - pos < 16) return null;
                size = (long)Math.Min(BinaryPrimitives.ReadUInt64BigEndian(b.Slice(pos + 8, 8)), long.MaxValue); header = 16;
            }
            else if (size == 0) size = end - pos;
            if (size < header || size > end - pos) return null;
            list.Add((Type(b, pos + 4), pos + header, pos + (int)size));
            pos += (int)size;
        }
        return list;
    }

    static (string Type, int Body, int End)? Child(ReadOnlySpan<byte> b, (string Type, int Body, int End) parent, string type) =>
        Boxes(b, parent.Body, parent.End)?.FirstOrDefault(x => x.Type == type) is { Type: not null } found ? found : null;

    static AudioProbeResult? Mp4(ReadOnlySpan<byte> b)
    {
        if (b.Length < 16 || !b.Slice(4, 4).SequenceEqual("ftyp"u8)) return null;
        var top = Boxes(b, 0, b.Length);
        if (top is null || top[0].Type != "ftyp" || top.Count(x => x.Type == "moov") != 1) return null;
        var ftyp = top[0]; var brands = new List<string>();
        if (ftyp.End - ftyp.Body < 8) return null;
        brands.Add(Type(b, ftyp.Body));
        for (var at = ftyp.Body + 8; at + 4 <= ftyp.End; at += 4) brands.Add(Type(b, at));
        if (!brands.Any(Mp4Brands.Contains)) return null;
        var moov = top.Single(x => x.Type == "moov");
        var children = Boxes(b, moov.Body, moov.End);
        if (children is null) return null;
        int sound = 0, video = 0;
        foreach (var trak in children.Where(x => x.Type == "trak"))
        {
            if (Child(b, trak, "mdia") is not { } mdia || Child(b, mdia, "hdlr") is not { } hdlr || hdlr.End - hdlr.Body < 12) return null;
            var handler = Type(b, hdlr.Body + 8);
            if (handler == "vide") video++;
            if (handler != "soun") continue;
            if (Child(b, mdia, "minf") is not { } minf || Child(b, minf, "stbl") is not { } stbl || Child(b, stbl, "stsd") is not { } stsd || stsd.End - stsd.Body < 16) return null;
            if (Type(b, stsd.Body + 12) == "mp4a") sound++;
        }
        if (sound == 0 || video > 0) return null;
        int? duration = null;
        if (children.FirstOrDefault(x => x.Type == "mvhd") is { Type: not null } mvhd && mvhd.End - mvhd.Body >= 20)
        {
            var v1 = b[mvhd.Body] == 1;
            if (!v1 || mvhd.End - mvhd.Body >= 32)
            {
                var scale = BinaryPrimitives.ReadUInt32BigEndian(b.Slice(mvhd.Body + (v1 ? 20 : 12), 4));
                var length = v1 ? BinaryPrimitives.ReadUInt64BigEndian(b.Slice(mvhd.Body + 24, 8)) : BinaryPrimitives.ReadUInt32BigEndian(b.Slice(mvhd.Body + 16, 4));
                if (scale > 0 && length < ulong.MaxValue / 1000) duration = Duration(length * 1000.0 / scale);
            }
        }
        return new(AudioFormats.Mp4, duration);
    }
}
