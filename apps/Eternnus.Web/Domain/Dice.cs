using System.Security.Cryptography;
using System.Text.RegularExpressions;
namespace Eternnus.Web;

public static partial class Dice
{
    [GeneratedRegex(@"^(\d{1,3})d(\d{1,4})([+-]\d{1,4})?$", RegexOptions.IgnoreCase)]
    private static partial Regex Formula();
    /// <summary>Confere a fórmula sem rolar; lança <see cref="ArgumentException"/> com mensagem para o usuário.</summary>
    public static (int Count, int Sides, int Modifier, string Normalized) Validate(string formula)
    {
        var normalized = (formula ?? "").Replace(" ", "");
        var match = Formula().Match(normalized);
        if (!match.Success) throw new ArgumentException("Use uma fórmula como 1d20+3 ou 2d6-1.");
        var count = int.Parse(match.Groups[1].Value); var sides = int.Parse(match.Groups[2].Value);
        if (count is < 1 or > 100 || sides is < 2 or > 1000) throw new ArgumentException("Use de 1 a 100 dados, com 2 a 1000 faces.");
        var modifier = match.Groups[3].Success ? int.Parse(match.Groups[3].Value) : 0;
        return (count, sides, modifier, normalized);
    }
    public static DiceResult Roll(string formula)
    {
        var (count, sides, modifier, normalized) = Validate(formula);
        var values = Enumerable.Range(0, count).Select(_ => RandomNumberGenerator.GetInt32(1, sides + 1)).ToArray();
        return new(normalized, values, modifier, values.Sum() + modifier);
    }
}
public record DiceResult(string Formula, int[] Values, int Modifier, int Total);
