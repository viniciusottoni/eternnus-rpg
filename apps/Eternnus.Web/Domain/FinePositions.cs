namespace Eternnus.Web;

/// <summary>
/// Posição de marcadores em mapas de movimentação livre (ADR-074). A casa (X, Y) continua sendo a unidade de paredes, névoa,
/// luz e visão; <c>Fx</c>/<c>Fy</c> dizem onde, dentro dela, o marcador está (milésimos da casa, nulo = centro).
/// Mesma conta em <c>js/free-move-policy.js</c>.
/// </summary>
public static class FinePositions
{
    public const int Scale = 1000, Center = 500;

    /// <summary>Posição fina validada: nula fora de mapas livres (o marcador fica no centro da casa).</summary>
    public static (int? Fx, int? Fy) Clean(bool free, int? fx, int? fy)
    {
        if (!free) return (null, null);
        if (fx is < 0 or >= Scale || fy is < 0 or >= Scale) throw new RuleException(400, "A posição dentro da casa vai de 0 a 999.");
        return (fx, fy);
    }

    /// <summary>Centro do marcador em casas (ex.: 3,5 = meio da quarta coluna).</summary>
    public static double Coordinate(int cell, int? fine) => cell + (fine ?? Center) / (double)Scale;

    /// <summary>Distância em linha reta, em casas, entre dois pontos finos.</summary>
    public static double Distance(int x1, int? fx1, int y1, int? fy1, int x2, int? fx2, int y2, int? fy2)
    {
        var dx = Coordinate(x1, fx1) - Coordinate(x2, fx2);
        var dy = Coordinate(y1, fy1) - Coordinate(y2, fy2);
        return Math.Sqrt(dx * dx + dy * dy);
    }

    /// <summary>Alcance com tolerância de arredondamento: o limite em casas vale até a borda.</summary>
    public static bool Within(double distance, int limit) => distance <= limit + 1e-9;
}
