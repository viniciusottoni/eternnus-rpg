using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
namespace Eternnus.Web;

// CONTRATO da linguagem de fórmulas (pacote WP3 implementa; assinaturas são estáveis para os outros pacotes).
// Linguagem própria, sintaxe em inglês, interpretada por parser próprio (sem eval, sem reflexão, sem SQL).
// O espelho do cliente fica em wwwroot/js/formula.js e passa pelos mesmos casos de tests/fixtures/formula-cases.json.

public enum FormulaMode
{
    /// <summary>Campos calculados: sem dados, resultado numérico determinístico.</summary>
    Deterministic,
    /// <summary>Golpes/magias/habilidades: permite dados.</summary>
    Roll,
}

/// <summary>Resultado da validação. <see cref="Error"/> é uma mensagem em pt-BR segura para exibir (nunca ecoa entrada crua longa).
/// <see cref="ErrorPosition"/> é o índice (base 0) do caractere onde o problema começa; a mensagem usa base 1.</summary>
public sealed record FormulaCheck(bool Ok, string? Error, IReadOnlyList<string> References, int? ErrorPosition = null);

/// <summary>Um grupo de dados rolado: "4d6kh3" → Count 4, Sides 6, Values (todos, na ordem rolada), Kept (índices mantidos, crescentes).</summary>
public sealed record DiceGroup(string Notation, int Count, int Sides, int[] Values, int[] Kept, int Subtotal);

/// <summary>Resultado de uma rolagem: total final, grupos de dados e um detalhamento legível ("4d6kh3[6, 5, 3, ~1~] + 2 = 16").</summary>
public sealed record FormulaRoll(string Formula, double Total, IReadOnlyList<DiceGroup> Dice, string Breakdown);

public static partial class Formula
{
    internal const int MaxLength = 300, MaxTokens = 200, MaxDepth = 32, MaxDice = 200, MaxDicePerGroup = 100, MaxArguments = 10;
    internal const double MaxLiteral = 1e9, MaxValue = 1e12;
    private static readonly IReadOnlyDictionary<string, double> EmptyScope = new Dictionary<string, double>();

    /// <summary>Valida sintaxe, limites e referências. <paramref name="knownNames"/> nulo = não conferir nomes.</summary>
    public static FormulaCheck Validate(string? expression, FormulaMode mode, IReadOnlySet<string>? knownNames = null)
    {
        try
        {
            var parsed = FormulaParser.Parse(expression, mode);
            if (knownNames is not null)
            {
                foreach (var reference in parsed.References)
                {
                    if (!knownNames.Contains(reference.Name)) return new(false, "Campo desconhecido: @" + reference.Name, [], reference.Position);
                }
            }
            return new(true, null, parsed.References.Select(r => r.Name).ToArray());
        }
        catch (FormulaException error)
        {
            return new(false, error.Message, [], error.Position);
        }
    }

    /// <summary>Avalia uma fórmula determinística. Nome ausente no escopo vale 0. Lança <see cref="FormulaException"/> se inválida.</summary>
    public static double Evaluate(string expression, IReadOnlyDictionary<string, double> scope)
    {
        var parsed = FormulaParser.Parse(expression, FormulaMode.Deterministic);
        return new FormulaEvaluator(scope ?? EmptyScope, null, null).Run(parsed.Root);
    }

    /// <summary>Rola uma fórmula (modo Roll) com o gerador informado (padrão: RandomNumberGenerator). <paramref name="die"/> recebe o número de faces e devolve 1..faces.</summary>
    public static FormulaRoll Roll(string expression, IReadOnlyDictionary<string, double> scope, Func<int, int>? die = null)
    {
        var parsed = FormulaParser.Parse(expression, FormulaMode.Roll);
        var text = new StringBuilder();
        var evaluator = new FormulaEvaluator(scope ?? EmptyScope, die ?? DefaultDie, text);
        var total = evaluator.Run(parsed.Root);
        text.Append(" = ").Append(Format(total));
        return new(expression.Trim(), total, evaluator.Groups, text.ToString());
    }

    /// <summary>Formata para exibição: até 2 casas (meio para longe de zero sobre o valor exato do double), sem zeros à direita, ponto decimal, sem notação científica.
    /// Valores não finitos ou acima do limite da linguagem (1e12) viram texto vazio.</summary>
    public static string Format(double value)
    {
        if (!double.IsFinite(value) || Math.Abs(value) > MaxValue) return "";
        var cents = Cents(Math.Abs(value));
        if (cents == 0) return "0";
        var whole = cents / 100;
        var fraction = (int)(cents % 100);
        var result = new StringBuilder();
        if (value < 0) result.Append('-');
        result.Append(whole.ToString(CultureInfo.InvariantCulture));
        if (fraction != 0)
        {
            result.Append('.').Append(fraction < 10 ? "0" : "").Append(fraction % 10 == 0 ? (fraction / 10).ToString(CultureInfo.InvariantCulture) : fraction.ToString(CultureInfo.InvariantCulture));
        }
        return result.ToString();
    }

    /// <summary>Centavos de um valor não negativo, arredondados meio para longe de zero sobre o valor binário EXATO do double
    /// (aritmética inteira). Evita o duplo arredondamento de <c>value * 100</c>: 2.675 é 2.67499999… e vira 2.67, não 2.68;
    /// empates exatos (0.125, 0.625) sobem. O cliente faz a mesma conta com BigInt.</summary>
    internal static long Cents(double magnitude)
    {
        if (magnitude == 0) return 0;
        var bits = BitConverter.DoubleToInt64Bits(magnitude);
        var exponent = (int)((bits >> 52) & 0x7FF);
        var mantissa = bits & 0xFFFFFFFFFFFFFL;
        if (exponent == 0) exponent = 1;
        else mantissa |= 1L << 52;
        exponent -= 1075; // magnitude = mantissa × 2^exponent
        var scaled = new BigInteger(mantissa) * 100;
        if (exponent >= 0) return (long)(scaled << exponent);
        var divisor = BigInteger.One << -exponent;
        var quotient = BigInteger.DivRem(scaled, divisor, out var remainder);
        if (remainder * 2 >= divisor) quotient += 1;
        return (long)quotient;
    }

    /// <summary>Arredonda ao inteiro mais próximo; meio para longe de zero (2.5 → 3, -2.5 → -3). Mesmo algoritmo do cliente.</summary>
    internal static double RoundHalfAwayFromZero(double value)
    {
        var magnitude = Math.Abs(value);
        var floor = Math.Floor(magnitude);
        if (magnitude - floor >= 0.5) floor += 1;
        return value < 0 ? -floor : floor;
    }

    private static int DefaultDie(int sides) => RandomNumberGenerator.GetInt32(1, sides + 1);
}

public sealed class FormulaException(string message, int? position = null) : Exception(message)
{
    public int? Position { get; } = position;
}

/// <summary>Cálculo da ficha: aplica padrões, converte números e avalia campos calculados em ordem de dependência.</summary>
public static partial class SheetCalculator
{
    /// <summary>Valida a lista de campos de um modelo: nomes, tipos, papéis únicos, geometria, fórmulas e ciclos. Devolve erros em pt-BR (vazio = válido).</summary>
    public static IReadOnlyList<string> ValidateFields(IReadOnlyList<SheetField> fields) => ValidateFieldsCore(fields);

    /// <summary>Devolve os valores finais (texto) de todos os campos, incluindo calculados. Valores de campos inexistentes são ignorados.</summary>
    public static IReadOnlyDictionary<string, string> Compute(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> values) => ComputeCore(fields, values);

    /// <summary>Escopo numérico (@nome → número) usado para rolar ações da ficha.</summary>
    public static IReadOnlyDictionary<string, double> Scope(IReadOnlyList<SheetField> fields, IReadOnlyDictionary<string, string> computedValues) => ScopeCore(fields, computedValues);
}
