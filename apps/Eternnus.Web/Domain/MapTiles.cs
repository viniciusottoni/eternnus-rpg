namespace Eternnus.Web;

/// <summary>Catálogo público de peças. A grade persistida usa somente estes símbolos, nunca HTML ou URLs.</summary>
public sealed record MapTile(string Code, string Name, string Group, string Surface)
{
    public bool Walkable => BattleMap.Walkable.Contains(Code, StringComparison.Ordinal);
    public bool BlocksSight => MapTiles.SightBlocks.Contains(Code, StringComparison.Ordinal);
}
public static class MapTiles
{
    public const string SightBlocks = "#ToRHiN";
    public static readonly IReadOnlyList<MapTile> All =
    [
        new(".", "Laje de pedra", "Terrenos", "."), new(",", "Grama", "Terrenos", ","),
        new("d", "Tábuas / ponte", "Terrenos", "d"), new(":", "Areia", "Terrenos", ":"),
        new("n", "Neve", "Terrenos", "n"), new("s", "Capim seco", "Terrenos", "s"),
        new("e", "Terra batida", "Terrenos", "e"), new("v", "Basalto", "Terrenos", "v"),
        new("u", "Fundo submerso", "Terrenos", "u"), new("f", "Mata rasteira", "Terrenos", "f"),
        new("c", "Calçamento", "Terrenos", "c"), new("~", "Água profunda", "Terrenos", "~"),
        new("L", "Lava", "Terrenos", "L"),
        new("t", "Árvore frondosa", "Natureza", ","), new("p", "Pinheiro", "Natureza", "n"),
        new("a", "Acácia", "Natureza", "s"), new("C", "Cacto", "Natureza", ":"),
        new("P", "Palmeira", "Natureza", ":"), new("R", "Rocha alta", "Natureza", "e"),
        new("r", "Escombros baixos", "Natureza", "."), new("i", "Estalagmite", "Natureza", "v"),
        new("X", "Cristais", "Natureza", "v"), new("j", "Coral", "Natureza", "u"),
        new("w", "Algas baixas", "Natureza", "u"),
        new("#", "Parede de pedra", "Construções", "."), new("+", "Porta aberta", "Construções", "."),
        new("=", "Escadaria", "Construções", "."), new("H", "Casa / telhado", "Construções", "c"),
        new("F", "Cerca", "Construções", ","), new("q", "Poço", "Construções", "c"),
        new("E", "Tenda", "Construções", "s"), new("M", "Banca de feira", "Construções", "c"),
        new("o", "Pilar", "Objetos", "."), new("A", "Altar", "Objetos", "."),
        new("b", "Braseiro", "Objetos", "."), new("T", "Tocha na parede", "Objetos", "."),
        new("h", "Mesa / caixote", "Objetos", "d"), new("B", "Barril", "Objetos", "d"),
        new("k", "Baú", "Objetos", "."), new("g", "Lápide", "Objetos", ","),
        new("O", "Sarcófago", "Objetos", "."), new("N", "Estátua", "Objetos", "."),
        new("Y", "Trono", "Objetos", "."), new("S", "Entrada do grupo", "Jogo", "."),
    ];
    static readonly HashSet<char> Codes = All.Select(t => t.Code[0]).ToHashSet();
    public static bool IsValid(char c) => Codes.Contains(c);
    public static string[] Validate(string[]? rows)
    {
        if (rows == null || rows.Length is < 8 or > 64 || rows.Any(r => r == null || r.Length is < 8 or > 64)
            || rows.Any(r => r.Length != rows[0].Length || r.Any(c => !IsValid(c))))
            throw new RuleException(400, "Use uma grade retangular de 8 a 64 casas por lado, somente com tiles do catálogo.");
        if (rows.Sum(r => r.Count(c => c == 'S')) < 6)
            throw new RuleException(400, "Marque pelo menos seis entradas livres para o grupo.");
        return rows;
    }
}
