namespace Eternnus.Web;

/// <summary>
/// Mapas oficiais disponíveis para o mestre. Tilesets são grades de caracteres compartilhadas com o cliente,
/// que as desenha em canvas; o servidor usa a mesma grade para validar movimento.
/// Legenda: # parede · T tocha · o pilar · A altar · b braseiro · t árvore · ~ água (bloqueiam);
/// . piso · , grama · + porta · = escada · r escombros · S ponto de entrada (livres).
/// </summary>
public sealed record BattleMap(string Key, string Name, string Kind, string Description, string? ImageUrl, string[] Rows)
{
    public decimal ScaleMeters { get; init; } = 1.5m;
    public const char Spawn = 'S';
    const string Walkable = ".,+=rS";
    public int Width => Rows.Length == 0 ? 0 : Rows[0].Length;
    public int Height => Rows.Length;
    public bool Inside(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;
    public bool CanStand(int x, int y) => Inside(x, y) && Walkable.Contains(Rows[y][x]);
    public IEnumerable<(int X, int Y)> Spawns()
    {
        for (var y = 0; y < Height; y++) for (var x = 0; x < Width; x++) if (Rows[y][x] == Spawn) yield return (x, y);
    }
}

public static class BattleMaps
{
    public static readonly BattleMap Valley = new("valley", "Vale Dourado", MapKinds.Cartographic,
        "Referência de regiões, rotas e lugares do reino.", "/assets/valley.webp", []);

    public static readonly BattleMap Crypt = new("crypt", "Ruínas da Cripta", MapKinds.Tileset,
        "Salões de pedra, braseiros e passagens estreitas.", null,
    [
        "########################",
        "#T....#.....T....#....T#",
        "#.....#..........+.....#",
        "#..o..+...o....o.#..A..#",
        "#.....#..........#.....#",
        "###+###....bb....###+###",
        "#......................#",
        "#..r.....o....o.......r#",
        "#.....SSS.......=......#",
        "#.....SSS.......=......#",
        "#..r.....o....o........#",
        "###+######..######+#####",
        "#......T#....#T........#",
        "#.~~~...+....+....b....#",
        "#.~~~...#....#.........#",
        "########################",
    ]);

    public static readonly BattleMap Forest = new("forest", "Clareira do Riacho", MapKinds.Tileset,
        "Mata aberta cortada por um riacho e uma fogueira de acampamento.", null,
    [
        ",,,tt,,,,,,,,,,,,tt,,,,,",
        ",t,,,,,,tt,,,,,,,,,,t,,,",
        ",,,,,,,,,,,,,,,~~~,,,,,t",
        ",,tt,,,,,,,,,,,~~~~,,,,,",
        ",,,,,,,r,,,,,,,,~~~,,tt,",
        "t,,,,,,,,,,b,,,,,~~,,,,,",
        ",,,,,SSS,,,,,,,,,~~~,,,,",
        ",,t,,SSS,,,,,,,,,,~~,,,,",
        ",,,,,,,,,,,,tt,,,,~~~,,,",
        ",,,,,tt,,,,,,,,,,,,~~,,t",
        "t,,,,,,,,,r,,,,,,,,~~,,,",
        ",,,,,,,,,,,,,,,t,,,,~~,,",
        ",,tt,,,,,,,,,,,,,,,,,~~,",
        ",,,,,,,,t,,,,,,tt,,,,,~~",
        ",t,,,,,,,,,,,,,,,,,,,,,~",
        ",,,,,tt,,,,,,,t,,,,,,,,,",
    ]);

    public static readonly IReadOnlyList<BattleMap> All = [Valley, Crypt, Forest];
    public static BattleMap? Find(string? key) => All.FirstOrDefault(x => x.Key == key);
}
