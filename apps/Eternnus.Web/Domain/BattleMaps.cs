namespace Eternnus.Web;

/// <summary>
/// Mapas oficiais disponíveis para o mestre. Tilesets são grades de caracteres compartilhadas com o cliente,
/// que as desenha em canvas; o servidor usa a mesma grade para validar movimento.
/// Legenda: # parede · T tocha · o pilar · A altar · b braseiro · t árvore · ~ água · h mesa/caixote (bloqueiam);
/// . piso · , grama · + porta · = escada · r escombros · d madeira · : areia · S ponto de entrada (livres).
/// </summary>
public sealed record BattleMap(string Key, string Name, string Kind, string Description, string? ImageUrl, string[] Rows)
{
    public decimal ScaleMeters { get; init; } = 1.5m;
    /// <summary>Movimentação livre: marcadores em qualquer ponto (posição fina dentro da casa), sem casa exclusiva.</summary>
    public bool Free { get; init; }
    public const char Spawn = 'S';
    const string Walkable = ".,+=rSd:";
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
        "Acampamento na mata com trilha e travessia de madeira. Use para encontros, descanso ou perseguições.", null,
    [
        ",,,tt,,,,,,,,,,,,tt,,,,,",
        ",t,,,,,,tt,,,,,,,,,,t,,,",
        ",,,,,,,,,,,,,,,~~~,,,,,t",
        ",,tt,,,,,,,,,,,~~~~,,,,,",
        ",,,,,,,r,,,,,,,,~~~,,tt,",
        "t,,,,,,,,,,b,,,,,~~,,,,,",
        ",,,,,SSS,........ddd...,",
        ",,t,,SSS,.........dd...,",
        ",,,,,,,,,,,,tt,,,,~~~,,,",
        ",,,,,tt,,,,,,,,,,,,~~,,t",
        "t,,,,,,,,,r,,,,,,,,~~,,,",
        ",,,,,,,,,,,,,,,t,,,,~~,,",
        ",,tt,,,,,,,,,,,,,,,,,~~,",
        ",,,,,,,,t,,,,,,tt,,,,,~~",
        ",t,,,,,,,,,,,,,,,,,,,,,~",
        ",,,,,tt,,,,,,,t,,,,,,,,,",
    ]);

    public static readonly BattleMap Tavern = new("tavern", "Salão da Estalagem", MapKinds.Tileset,
        "Salão, balcão e duas salas reservadas. Encontros sociais, negociações ou um confronto entre mesas.", null,
    [
        "############################",
        "#dddddddddddd#ddddddddddddd#",
        "#ddhdhddddddd#dddhdhdddhddd#",
        "#dddddddddddd#ddddddddddddd#",
        "#dddddddddddd#ddddddddddddd#",
        "#######+############+#######",
        "#dTddddddddddddddddddddddTd#",
        "#ddddddddddddddddddddddhhdd#",
        "#dddddddhhhddddddhhhdddhhdd#",
        "#dddddddhhhddddddhhhdddhhdd#",
        "#ddddddddddddddddddddddhhdd#",
        "#ddddddddddddddddddddddhhdd#",
        "#dddddddhhhddddddhhhdddhhdd#",
        "#ddSSSddhhhddddddhhhdddhhdd#",
        "#ddSSSddddddddddddddddddddd#",
        "#dTddddddddddddddddddddddTd#",
        "#dddddddddddddddddddddddddd#",
        "############################",
    ]);

    public static readonly BattleMap Bridge = new("bridge", "Ponte da Travessia", MapKinds.Tileset,
        "Duas margens ligadas por uma ponte larga. Escoltas, pedágios e encontros na estrada, sem facção definida.", null,
    [
        ",,,,,,,,,,,~~~~~~,,,,,,,,,,,",
        ",,,,,,,,,,,~~~~~~,,,,,,,,,,,",
        ",,,tt,,,,,,~~~~~~,,,,tt,,,,,",
        ",,,tt,tt,,,~~~~~~,,,,tt,,,,,",
        ",,,,,,tt,,,~~~~~~,,,,,,,tt,,",
        ",,,,,,r,,,,~~~~~~,,,,,,,tt,,",
        ",,,,,,,,,o,~~~~~~,o,,,,,,,,,",
        "...........dddddd...........",
        "...SSS.....dddddd...........",
        "...SSS.....dddddd...........",
        "...........dddddd...........",
        ",,,,,,,,,o,~~~~~~,o,,,,,,,,,",
        ",,,,,,,,,,,~~~~~~,,,,,r,,,,,",
        ",,,,,,,,,,,~~~~~~,,,,,,,,,,,",
        ",,,tt,,,,,,~~~~~~,,,,tt,,,,,",
        ",,,tt,,tt,,~~~~~~,,,,tt,tt,,",
        ",,,,,,,tt,,~~~~~~,,,,,,,tt,,",
        ",,,,,,,,,,,~~~~~~,,,,,,,,,,,",
    ]);

    public static readonly BattleMap Courtyard = new("courtyard", "Pátio da Fortaleza", MapKinds.Tileset,
        "Fonte central, jardins e quatro caminhos ao redor. Serve como praça, posto de guarda ou pátio de qualquer domínio.", null,
    [
        "#############++#############",
        "#,,,,,,,,,,,....,,,,,,,,,,,#",
        "#,T,,,,,,,,,....,,,,,,,,,T,#",
        "#,,,tt,,,,,,....,,,,,tt,,,,#",
        "#,,,tt,,,,,,....,,,,,tt,,,,#",
        "#,,,,,,,o,........,o,,,,,,,#",
        "#,,,,,,,,,........,,,,,,,,,#",
        "#...........~~~~...........#",
        "#..SSS......~~~~...........#",
        "#..SSS......~~~~...........#",
        "#...........~~~~...........#",
        "#,,,,,,,,,........,,,,,,,,,#",
        "#,,,,,,,o,........,o,,,,,,,#",
        "#,,,tt,,,,,,....,,,,,tt,,,,#",
        "#,,,tt,,,,,,....,,,,,tt,,,,#",
        "#,T,,,,,,,,,....,,,,,,,,,T,#",
        "#,,,,,,,,,,,....,,,,,,,,,,,#",
        "#############++#############",
    ]);

    public static readonly BattleMap Harbor = new("harbor", "Cais das Marés", MapKinds.Tileset,
        "Armazém, carga e três ancoradouros. Uma margem de rio ou um porto costeiro para embarques e investigações.", null,
    [
        "::::::::::::::::::::::::::::",
        "::#########:::::::::::::::::",
        "::#.hh....#::::::hhhh:::::::",
        "::#.hh....#::::::hhhh:::::::",
        "::#.......#::::::hhhh:::hh::",
        "::#.......#:::::::::::::hh::",
        "::####+####:SSS:::::::::::::",
        "::::::::::::SSS:::::::::::::",
        "dbdddddddddbddddddddddddddbd",
        "dddddddddddddddddddddddddddd",
        "dddddddddddddddddddddddddddd",
        "~~~~ddd~~~~~~ddd~~~~~~ddd~~~",
        "~~~~ddd~~~~~~ddd~~~~~~ddd~~~",
        "~~~~ddd~~~~~~ddd~~~~~~ddd~~~",
        "~~~~ddd~~~~~~ddd~~~~~~ddd~~~",
        "~~~~ddd~~~~~~ddd~~~~~~ddd~~~",
        "~~~~odd~~~~~~odd~~~~~~odd~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    ]);

    public static readonly BattleMap Sanctuary = new("sanctuary", "Santuário de Pedra", MapKinds.Tileset,
        "Nave aberta, colunatas e um altar elevado. Templo ativo, ruína esquecida ou salão cerimonial, sem divindade imposta.", null,
    [
        "############################",
        "###########......###########",
        "###########.AAAA.###########",
        "###########......###########",
        "#...r....b........b....r...#",
        "#.....o....======....o.....#",
        "#..~~......======......~~..#",
        "#..~~..................~~..#",
        "#..~~.o..............o.~~..#",
        "#..~~..................~~..#",
        "#.......r..................#",
        "#.....o..............o.....#",
        "#..................r.......#",
        "#...........SSS............#",
        "#.b...o.....SSS......o...b.#",
        "#..........................#",
        "#..........................#",
        "############################",
    ]);

    public static readonly IReadOnlyList<BattleMap> All = [Valley, Crypt, Forest, Tavern, Bridge, Courtyard, Harbor, Sanctuary];
    public static BattleMap? Find(string? key) => All.FirstOrDefault(x => x.Key == key);
}
