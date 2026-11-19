using System.Text.Json;
namespace Eternnus.Web;

/// <summary>
/// Região "Mostrar esta região" (ADR-115), em casas do mapa: canto (X, Y), largura W e altura H. <c>Seq</c> cresce a cada envio
/// para quem segue a câmera do mestre reconhecer um enquadramento novo. Só enquadramento: não muda coordenadas do mapa,
/// não revela nada (a névoa continua sendo aplicada por quem recebe) e não gera evento permanente.
/// </summary>
public sealed record CameraFrame(double X, double Y, double W, double H, int Seq);

public record CameraInput(double X, double Y, double W, double H);

public static class CameraFrames
{
    public const double MinSide = 1, MaxSide = 400;
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Valida a região contra o tamanho do mapa (casas) e devolve o enquadramento com a próxima sequência.</summary>
    public static CameraFrame Validate(CameraInput x, int mapWidth, int mapHeight, CameraFrame? previous)
    {
        static bool Finite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);
        if (!Finite(x.X) || !Finite(x.Y) || !Finite(x.W) || !Finite(x.H)) throw new RuleException(400, "Região inválida.");
        if (x.W < MinSide || x.H < MinSide || x.W > MaxSide || x.H > MaxSide) throw new RuleException(400, $"A região vai de {MinSide} a {MaxSide} casas por lado.");
        var maxW = Math.Max(mapWidth, 1); var maxH = Math.Max(mapHeight, 1);
        // A região pode passar da borda (enquadrar um canto), mas precisa tocar o mapa.
        if (x.X + x.W <= 0 || x.Y + x.H <= 0 || x.X >= maxW || x.Y >= maxH) throw new RuleException(400, "Escolha uma região sobre o mapa.");
        static double R(double v) => Math.Round(v, 2);
        return new CameraFrame(R(x.X), R(x.Y), R(x.W), R(x.H), (previous?.Seq ?? 0) + 1);
    }

    public static CameraFrame? Parse(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<CameraFrame>(json, Json); }
        catch (JsonException) { return null; }
    }

    public static string Serialize(CameraFrame f) => JsonSerializer.Serialize(f, Json);
}
