using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Formatos de áudio sintéticos para validar a estrutura sem depender de arquivos de terceiros.</summary>
static class AudioSamples
{
    /// <summary>MPEG-1 Layer III, 128 kbps, 44,1 kHz: quadros de 417 bytes com 1.152 amostras.</summary>
    public static byte[] Mp3(int frames = 100, bool id3 = true)
    {
        var data = new List<byte>();
        if (id3) data.AddRange([.. "ID3"u8, 4, 0, 0, 0, 0, 0, 10, .. new byte[10]]);
        for (var i = 0; i < frames; i++)
        {
            var frame = new byte[417];
            frame[0] = 0xFF; frame[1] = 0xFB; frame[2] = 0x90; frame[3] = 0x64;
            data.AddRange(frame);
        }
        return [.. data];
    }

    static byte[] OggPage(byte flags, long granule, uint serial, uint sequence, byte[] payload)
    {
        var page = new List<byte>();
        page.AddRange("OggS"u8.ToArray()); page.Add(0); page.Add(flags);
        var buffer = new byte[8]; BinaryPrimitives.WriteInt64LittleEndian(buffer, granule); page.AddRange(buffer);
        buffer = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(buffer, serial); page.AddRange(buffer);
        buffer = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(buffer, sequence); page.AddRange(buffer);
        page.AddRange(new byte[4]);
        page.Add(1); page.Add((byte)payload.Length); page.AddRange(payload);
        return [.. page];
    }

    /// <summary>OGG Vorbis com um único fluxo; a última página informa três segundos a 44,1 kHz.</summary>
    public static byte[] Ogg(bool secondStream = false)
    {
        var id = new byte[30]; id[0] = 1; "vorbis"u8.CopyTo(id.AsSpan(1)); id[11] = 2;
        BinaryPrimitives.WriteUInt32LittleEndian(id.AsSpan(12), 44100);
        var pages = new List<byte>();
        pages.AddRange(OggPage(2, 0, 7, 0, id));
        if (secondStream) pages.AddRange(OggPage(2, 0, 9, 0, id));
        pages.AddRange(OggPage(0, -1, 7, 1, new byte[200]));
        pages.AddRange(OggPage(4, 44100 * 3, 7, 2, new byte[200]));
        return [.. pages];
    }

    static byte[] Box(string type, params byte[][] content)
    {
        var body = content.SelectMany(x => x).ToArray();
        var box = new byte[8 + body.Length];
        BinaryPrimitives.WriteUInt32BigEndian(box, (uint)box.Length);
        Encoding.ASCII.GetBytes(type).CopyTo(box, 4);
        body.CopyTo(box, 8);
        return box;
    }

    static byte[] Trak(string handler, string entry) => Box("trak", Box("mdia",
        Box("hdlr", new byte[8], Encoding.ASCII.GetBytes(handler), new byte[13]),
        Box("minf", Box("stbl", Box("stsd", [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 16, .. Encoding.ASCII.GetBytes(entry), .. new byte[8]])))));

    /// <summary>M4A (AAC) com cinco segundos no mvhd; <paramref name="video"/> acrescenta uma faixa de vídeo.</summary>
    public static byte[] M4a(bool video = false)
    {
        var mvhd = new byte[100];
        BinaryPrimitives.WriteUInt32BigEndian(mvhd.AsSpan(12), 1000);
        BinaryPrimitives.WriteUInt32BigEndian(mvhd.AsSpan(16), 5000);
        var tracks = new List<byte[]> { Box("mvhd", mvhd), Trak("soun", "mp4a") };
        if (video) tracks.Add(Trak("vide", "avc1"));
        return [.. Box("ftyp", "M4A "u8.ToArray(), new byte[4], "isom"u8.ToArray()), .. Box("moov", [.. tracks]), .. Box("mdat", new byte[512])];
    }
}

public sealed class AudioProbeTests
{
    [Fact]
    public void Mp3_frames_are_recognized_with_duration()
    {
        var result = AudioProbe.Inspect(AudioSamples.Mp3());
        Assert.Equal(AudioFormats.Mpeg, result?.ContentType);
        Assert.Equal(2612, result?.DurationMs);
    }

    [Fact]
    public void Official_soundtrack_is_a_valid_mp3_with_plausible_duration()
    {
        var bytes = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "../../../../../apps/Eternnus.Web/wwwroot/assets/audio/the-blade-and-the-serpent.v1.mp3"));
        var result = AudioProbe.Inspect(bytes);
        Assert.Equal(AudioFormats.Mpeg, result?.ContentType);
        Assert.InRange(result!.DurationMs!.Value, 60_000, 30 * 60_000);
    }

    [Fact]
    public void Ogg_vorbis_single_stream_is_accepted_and_multiplexed_streams_are_refused()
    {
        var result = AudioProbe.Inspect(AudioSamples.Ogg());
        Assert.Equal(AudioFormats.Ogg, result?.ContentType);
        Assert.Equal(3000, result?.DurationMs);
        Assert.Null(AudioProbe.Inspect(AudioSamples.Ogg(secondStream: true)));
    }

    [Fact]
    public void M4a_requires_an_aac_sound_track_and_no_video()
    {
        var result = AudioProbe.Inspect(AudioSamples.M4a());
        Assert.Equal(AudioFormats.Mp4, result?.ContentType);
        Assert.Equal(5000, result?.DurationMs);
        Assert.Null(AudioProbe.Inspect(AudioSamples.M4a(video: true)));
    }

    [Fact]
    public void Images_executables_renamed_files_and_appended_payloads_are_refused()
    {
        Assert.Null(AudioProbe.Inspect(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "../../../../fixtures/avatar.png"))));
        Assert.Null(AudioProbe.Inspect("MZ\x90\0this is not audio"u8.ToArray()));
        Assert.Null(AudioProbe.Inspect("ID3"u8.ToArray()));
        Assert.Null(AudioProbe.Inspect(AudioSamples.Mp3(frames: 3)));
        // Quadros válidos seguidos de muitos bytes arbitrários (arquivo poliglota) não passam.
        Assert.Null(AudioProbe.Inspect([.. AudioSamples.Mp3(), .. new byte[200_000].Select((_, i) => (byte)(i * 7))]));
        // Truncar o arquivo no meio de uma página OGG invalida a estrutura.
        var ogg = AudioSamples.Ogg();
        Assert.Null(AudioProbe.Inspect(ogg.AsSpan(0, ogg.Length - 10)));
    }
}

public sealed class SoundtrackStateTests
{
    static readonly DateTime Reference = new(2026, 11, 8, 20, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Playing_advances_from_the_reference_and_paused_stays_put()
    {
        var id = Guid.NewGuid();
        Assert.Equal((65_000L, false), new SoundtrackState(id, true, 5_000, Reference, false, 600_000).At(Reference.AddSeconds(60)));
        Assert.Equal((5_000L, false), new SoundtrackState(id, false, 5_000, Reference, false, 600_000).At(Reference.AddSeconds(60)));
    }

    [Fact]
    public void Track_end_and_loop_are_computed_from_duration()
    {
        var id = Guid.NewGuid();
        Assert.Equal((10_000L, true), new SoundtrackState(id, true, 9_000, Reference, false, 10_000).At(Reference.AddSeconds(5)));
        Assert.Equal((4_000L, false), new SoundtrackState(id, true, 9_000, Reference, true, 10_000).At(Reference.AddSeconds(5)));
        Assert.Equal((14_000L, false), new SoundtrackState(id, true, 9_000, Reference, false, null).At(Reference.AddSeconds(5)));
        Assert.Equal((0L, false), new SoundtrackState(null, true, 9_000, Reference, false, 10_000).At(Reference.AddSeconds(5)));
        // Relógio anterior à referência (ajuste de horário) não produz posição negativa.
        Assert.Equal((9_000L, false), new SoundtrackState(id, true, 9_000, Reference, false, 10_000).At(Reference.AddSeconds(-3)));
    }
}
