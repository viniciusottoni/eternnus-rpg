using System.Globalization;
using System.Text;
namespace Eternnus.Web;

// Analisador léxico, sintático e avaliador da linguagem de fórmulas.
// Segurança: alfabeto fechado (ASCII + × ÷ − como sinônimos de * / -), sem regex, recursão limitada por profundidade (32) e por número de
// elementos (200), funções resolvidas por switch (nunca por reflexão) e nenhuma execução de código do usuário.
// Qualquer mudança aqui exige a mesma mudança em wwwroot/js/formula.js e um caso em tests/fixtures/formula-cases.json.

internal enum FormulaTokenKind
{
    Number,
    Ref,
    Dice,
    Ident,
    Op,
    LParen,
    RParen,
    Comma,
    End,
}

internal sealed class FormulaToken
{
    public FormulaTokenKind Kind { get; init; }
    public int Position { get; init; }
    public string Text { get; init; } = "";
    public double Value { get; init; }
    public int Count { get; init; }
    public int Sides { get; init; }
    public string Mode { get; init; } = "";
    public int Keep { get; init; }
}

internal static class FormulaText
{
    public static bool IsDigit(char c) => c is >= '0' and <= '9';
    public static bool IsLower(char c) => c is >= 'a' and <= 'z';
    public static bool IsLetter(char c) => IsLower(c) || c is >= 'A' and <= 'Z';
    public static bool IsNameChar(char c) => IsLetter(c) || IsDigit(c) || c == '_';
    public static bool IsSpace(char c) => c is ' ' or '\t' or '\r' or '\n';
    public static string At(int position) => (position + 1).ToString(CultureInfo.InvariantCulture);

    /// <summary>Nome de campo: ^[a-z][a-z0-9_]{0,39}$ (verificado sem regex).</summary>
    public static bool IsValidName(string? name)
    {
        if (name is null || name.Length is < 1 or > 40 || !IsLower(name[0])) return false;
        foreach (var c in name)
        {
            if (!(IsLower(c) || IsDigit(c) || c == '_')) return false;
        }
        return true;
    }

    public static string AsciiLower(string value)
    {
        var chars = value.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is >= 'A' and <= 'Z') chars[i] = (char)(chars[i] + 32);
        }
        return new string(chars);
    }

    public static string Short(string name) => name.Length > 20 ? name[..20] + "…" : name;
}

internal static class FormulaLexer
{
    private static readonly int[] AllowedSides = [4, 6, 8, 10, 12, 20, 100];

    private static bool IsRunChar(char c) => FormulaText.IsNameChar(c) || c == '.' || c == '%';

    public static List<FormulaToken> Tokenize(string source)
    {
        var tokens = new List<FormulaToken>();
        var i = 0;
        while (i < source.Length)
        {
            var c = source[i];
            if (FormulaText.IsSpace(c))
            {
                i++;
                continue;
            }
            if (tokens.Count >= Formula.MaxTokens) throw new FormulaException("Fórmula longa demais (máx. 200 elementos).", i);
            var start = i;
            if (c == '@')
            {
                i++;
                while (i < source.Length && FormulaText.IsNameChar(source[i])) i++;
                var name = source.Substring(start + 1, i - start - 1);
                if (!FormulaText.IsValidName(name)) throw new FormulaException($"Nome de campo inválido na posição {FormulaText.At(start)}.", start);
                tokens.Add(new() { Kind = FormulaTokenKind.Ref, Position = start, Text = name });
                continue;
            }
            if (IsRunChar(c))
            {
                while (i < source.Length && IsRunChar(source[i])) i++;
                tokens.Add(Classify(source.Substring(start, i - start), start));
                continue;
            }
            i++;
            switch (c)
            {
                case '(':
                    tokens.Add(new() { Kind = FormulaTokenKind.LParen, Position = start, Text = "(" });
                    break;
                case ')':
                    tokens.Add(new() { Kind = FormulaTokenKind.RParen, Position = start, Text = ")" });
                    break;
                case ',':
                    tokens.Add(new() { Kind = FormulaTokenKind.Comma, Position = start, Text = "," });
                    break;
                case '+' or '-' or '*' or '/':
                    tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = c.ToString() });
                    break;
                // Sinais tipográficos (copiados de livros e PDFs) são sinônimos exatos; o detalhamento sempre usa a forma ASCII.
                case '\u00D7':
                    tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = "*" });
                    break;
                case '\u00F7':
                    tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = "/" });
                    break;
                case '\u2212':
                    tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = "-" });
                    break;
                case '<' or '>':
                    if (i < source.Length && source[i] == '=')
                    {
                        i++;
                        tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = c + "=" });
                    }
                    else
                    {
                        tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = c.ToString() });
                    }
                    break;
                case '=':
                    if (i < source.Length && source[i] == '=')
                    {
                        i++;
                        tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = "==" });
                        break;
                    }
                    throw new FormulaException($"Use == para comparar (posição {FormulaText.At(start)}).", start);
                case '!':
                    if (i < source.Length && source[i] == '=')
                    {
                        i++;
                        tokens.Add(new() { Kind = FormulaTokenKind.Op, Position = start, Text = "!=" });
                        break;
                    }
                    throw new FormulaException($"Use != ou not (posição {FormulaText.At(start)}).", start);
                default:
                    throw new FormulaException($"Caractere não permitido na posição {FormulaText.At(start)}.", start);
            }
        }
        tokens.Add(new() { Kind = FormulaTokenKind.End, Position = source.Length });
        return tokens;
    }

    private static bool IsNumberText(string w)
    {
        var i = 0;
        while (i < w.Length && FormulaText.IsDigit(w[i])) i++;
        if (i == 0) return false;
        if (i == w.Length) return true;
        if (w[i] != '.') return false;
        var fractionStart = ++i;
        while (i < w.Length && FormulaText.IsDigit(w[i])) i++;
        return i > fractionStart && i == w.Length;
    }

    private static bool LooksLikeDice(string w)
    {
        var j = 0;
        while (j < w.Length && FormulaText.IsDigit(w[j])) j++;
        return j + 1 < w.Length && w[j] == 'd' && (FormulaText.IsDigit(w[j + 1]) || w[j + 1] == '%');
    }

    private static FormulaToken Classify(string raw, int start)
    {
        var w = FormulaText.AsciiLower(raw);
        if (FormulaText.IsDigit(w[0]) && IsNumberText(w))
        {
            var value = double.Parse(w, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
            if (value > Formula.MaxLiteral) throw new FormulaException($"Número grande demais na posição {FormulaText.At(start)}.", start);
            return new() { Kind = FormulaTokenKind.Number, Position = start, Text = w, Value = value };
        }
        var dice = TryDice(w, start);
        if (dice is not null) return dice;
        if (LooksLikeDice(w)) throw new FormulaException($"Dado inválido na posição {FormulaText.At(start)}. Use NdS, como 1d20 ou 4d6kh3.", start);
        if (FormulaText.IsLetter(w[0]) || w[0] == '_')
        {
            var ok = true;
            foreach (var c in w) ok &= FormulaText.IsNameChar(c);
            if (ok) return new() { Kind = FormulaTokenKind.Ident, Position = start, Text = w };
        }
        if (FormulaText.IsDigit(w[0]) || w[0] == '.') throw new FormulaException($"Número inválido na posição {FormulaText.At(start)}.", start);
        throw new FormulaException($"Expressão inválida na posição {FormulaText.At(start)}.", start);
    }

    private static int SmallInt(string digits) => digits.Length is 0 or > 3 ? -1 : int.Parse(digits, NumberStyles.None, CultureInfo.InvariantCulture);

    private static FormulaToken? TryDice(string w, int start)
    {
        var j = 0;
        while (j < w.Length && FormulaText.IsDigit(w[j])) j++;
        var countText = w[..j];
        if (j >= w.Length || w[j] != 'd') return null;
        j++;
        string sidesText;
        if (j < w.Length && w[j] == '%')
        {
            sidesText = "100";
            j++;
        }
        else
        {
            var sidesStart = j;
            while (j < w.Length && FormulaText.IsDigit(w[j])) j++;
            if (j == sidesStart) return null;
            sidesText = w[sidesStart..j];
        }
        var mode = "";
        var keepText = "";
        if (j < w.Length)
        {
            if (j + 2 > w.Length) return null;
            mode = w.Substring(j, 2);
            if (mode is not ("kh" or "kl" or "dh" or "dl")) return null;
            j += 2;
            var keepStart = j;
            while (j < w.Length && FormulaText.IsDigit(w[j])) j++;
            if (j != w.Length) return null;
            keepText = w[keepStart..j];
        }
        var count = countText.Length == 0 ? 1 : SmallInt(countText);
        if (count is < 1 or > Formula.MaxDicePerGroup) throw new FormulaException($"Quantidade de dados deve ser de 1 a 100 (posição {FormulaText.At(start)}).", start);
        var sides = SmallInt(sidesText);
        if (Array.IndexOf(AllowedSides, sides) < 0) throw new FormulaException($"Dado deve ter 4, 6, 8, 10, 12, 20 ou 100 faces (posição {FormulaText.At(start)}).", start);
        var keep = 0;
        if (mode.Length > 0)
        {
            keep = keepText.Length == 0 ? 1 : SmallInt(keepText);
            if (keep < 1 || keep > count) throw new FormulaException($"Manter ou descartar deve ser de 1 a {count} dados (posição {FormulaText.At(start)}).", start);
        }
        var notation = count.ToString(CultureInfo.InvariantCulture) + "d" + sides.ToString(CultureInfo.InvariantCulture) + (mode.Length > 0 ? mode + keep.ToString(CultureInfo.InvariantCulture) : "");
        return new() { Kind = FormulaTokenKind.Dice, Position = start, Text = notation, Count = count, Sides = sides, Mode = mode, Keep = keep };
    }
}

internal abstract class FormulaNode;
internal sealed class NumberNode(double value, string text) : FormulaNode
{
    public double Value { get; } = value;
    public string Text { get; } = text;
}
internal sealed class RefNode(string name) : FormulaNode
{
    public string Name { get; } = name;
}
internal sealed class DiceNode(FormulaToken token) : FormulaNode
{
    public string Notation { get; } = token.Text;
    public int Count { get; } = token.Count;
    public int Sides { get; } = token.Sides;
    public string Mode { get; } = token.Mode;
    public int Keep { get; } = token.Keep;
}
internal sealed class UnaryNode(string op, FormulaNode operand) : FormulaNode
{
    public string Op { get; } = op;
    public FormulaNode Operand { get; } = operand;
}
internal sealed class BinaryNode(string op, FormulaNode left, FormulaNode right) : FormulaNode
{
    public string Op { get; } = op;
    public FormulaNode Left { get; } = left;
    public FormulaNode Right { get; } = right;
}
internal sealed class CallNode(string name, FormulaNode[] args) : FormulaNode
{
    public string Name { get; } = name;
    public FormulaNode[] Args { get; } = args;
}
internal sealed class IfNode(FormulaNode condition, FormulaNode then, FormulaNode otherwise) : FormulaNode
{
    public FormulaNode Condition { get; } = condition;
    public FormulaNode Then { get; } = then;
    public FormulaNode Else { get; } = otherwise;
}
internal sealed class GroupNode(FormulaNode inner) : FormulaNode
{
    public FormulaNode Inner { get; } = inner;
}

internal sealed record FormulaReference(string Name, int Position);
internal sealed record ParsedFormula(FormulaNode Root, IReadOnlyList<FormulaReference> References);

internal sealed class FormulaParser
{
    private readonly List<FormulaToken> _tokens;
    private readonly FormulaMode _mode;
    private readonly List<FormulaReference> _references = [];
    private readonly HashSet<string> _seen = new(StringComparer.Ordinal);
    private int _index;
    private int _dice;

    private FormulaParser(List<FormulaToken> tokens, FormulaMode mode)
    {
        _tokens = tokens;
        _mode = mode;
    }

    public static ParsedFormula Parse(string? expression, FormulaMode mode)
    {
        if (expression is null || expression.All(FormulaText.IsSpace)) throw new FormulaException("Informe uma fórmula.");
        if (expression.Length > Formula.MaxLength) throw new FormulaException("Fórmula longa demais (máx. 300 caracteres).");
        var parser = new FormulaParser(FormulaLexer.Tokenize(expression), mode);
        var root = parser.ParseExpression(0);
        var rest = parser.Peek;
        if (rest.Kind == FormulaTokenKind.RParen) throw new FormulaException($"Parêntese sem abertura na posição {FormulaText.At(rest.Position)}.", rest.Position);
        if (rest.Kind != FormulaTokenKind.End) throw new FormulaException($"Operador esperado na posição {FormulaText.At(rest.Position)}.", rest.Position);
        return new(root, parser._references);
    }

    private FormulaToken Peek => _tokens[_index];
    private FormulaToken Next() => _tokens[_index++];
    private bool PeekIdent(string word) => Peek.Kind == FormulaTokenKind.Ident && Peek.Text == word;
    private bool PeekOp(string op) => Peek.Kind == FormulaTokenKind.Op && Peek.Text == op;

    private void Enter(int depth)
    {
        if (depth > Formula.MaxDepth) throw new FormulaException("Aninhamento profundo demais (máx. 32 níveis).", Peek.Position);
    }

    private FormulaNode ParseExpression(int depth)
    {
        Enter(depth);
        var left = ParseAnd(depth);
        while (PeekIdent("or"))
        {
            Next();
            left = new BinaryNode("or", left, ParseAnd(depth));
        }
        return left;
    }

    private FormulaNode ParseAnd(int depth)
    {
        var left = ParseNot(depth);
        while (PeekIdent("and"))
        {
            Next();
            left = new BinaryNode("and", left, ParseNot(depth));
        }
        return left;
    }

    private FormulaNode ParseNot(int depth)
    {
        if (!PeekIdent("not")) return ParseComparison(depth);
        Next();
        Enter(depth + 1);
        return new UnaryNode("not", ParseNot(depth + 1));
    }

    private static bool IsComparison(FormulaToken token) => token.Kind == FormulaTokenKind.Op && token.Text is "<" or "<=" or ">" or ">=" or "==" or "!=";

    private FormulaNode ParseComparison(int depth)
    {
        var left = ParseAdditive(depth);
        if (!IsComparison(Peek)) return left;
        var op = Next().Text;
        left = new BinaryNode(op, left, ParseAdditive(depth));
        if (IsComparison(Peek)) throw new FormulaException($"Comparações encadeadas não são permitidas (posição {FormulaText.At(Peek.Position)}).", Peek.Position);
        return left;
    }

    private FormulaNode ParseAdditive(int depth)
    {
        var left = ParseMultiplicative(depth);
        while (PeekOp("+") || PeekOp("-"))
        {
            var op = Next().Text;
            left = new BinaryNode(op, left, ParseMultiplicative(depth));
        }
        return left;
    }

    private FormulaNode ParseMultiplicative(int depth)
    {
        var left = ParseUnary(depth);
        while (PeekOp("*") || PeekOp("/"))
        {
            var op = Next().Text;
            left = new BinaryNode(op, left, ParseUnary(depth));
        }
        return left;
    }

    private FormulaNode ParseUnary(int depth)
    {
        if (!PeekOp("-") && !PeekOp("+")) return ParsePrimary(depth);
        var op = Next().Text;
        Enter(depth + 1);
        return new UnaryNode(op, ParseUnary(depth + 1));
    }

    private FormulaNode ParsePrimary(int depth)
    {
        var token = Next();
        switch (token.Kind)
        {
            case FormulaTokenKind.Number:
                return new NumberNode(token.Value, token.Text);
            case FormulaTokenKind.Ref:
                if (_seen.Add(token.Text)) _references.Add(new(token.Text, token.Position));
                return new RefNode(token.Text);
            case FormulaTokenKind.Dice:
                if (_mode == FormulaMode.Deterministic) throw new FormulaException("Campos calculados não podem rolar dados.", token.Position);
                _dice += token.Count;
                if (_dice > Formula.MaxDice) throw new FormulaException("Dados demais (máx. 200 por fórmula).", token.Position);
                return new DiceNode(token);
            case FormulaTokenKind.LParen:
            {
                var inner = ParseExpression(depth + 1);
                ExpectClose();
                return new GroupNode(inner);
            }
            case FormulaTokenKind.Ident:
                return ParseWord(token, depth);
            case FormulaTokenKind.End:
                throw new FormulaException("Fórmula incompleta.", token.Position);
            default:
                throw new FormulaException($"Valor esperado na posição {FormulaText.At(token.Position)}.", token.Position);
        }
    }

    private void ExpectClose()
    {
        if (Peek.Kind == FormulaTokenKind.RParen)
        {
            Next();
            return;
        }
        throw new FormulaException($"Falta fechar parêntese (posição {FormulaText.At(Peek.Position)}).", Peek.Position);
    }

    private void ExpectWord(string word)
    {
        if (PeekIdent(word))
        {
            Next();
            return;
        }
        throw new FormulaException($"Esperado {word} na posição {FormulaText.At(Peek.Position)}.", Peek.Position);
    }

    private static (int Min, int Max)? Arity(string name) => name switch
    {
        "floor" or "ceil" or "round" or "abs" or "mod" => (1, 1),
        "min" or "max" => (2, Formula.MaxArguments),
        "clamp" => (3, 3),
        _ => null,
    };

    private FormulaNode ParseWord(FormulaToken token, int depth)
    {
        var name = token.Text;
        if (name == "if")
        {
            var condition = ParseExpression(depth + 1);
            ExpectWord("then");
            var then = ParseExpression(depth + 1);
            ExpectWord("else");
            var otherwise = ParseExpression(depth + 1);
            return new IfNode(condition, then, otherwise);
        }
        if (name is "then" or "else" or "and" or "or" or "not") throw new FormulaException($"Valor esperado na posição {FormulaText.At(token.Position)}.", token.Position);
        var arity = Arity(name);
        if (arity is null)
        {
            if (Peek.Kind == FormulaTokenKind.LParen) throw new FormulaException($"Função desconhecida: {FormulaText.Short(name)}.", token.Position);
            throw new FormulaException($"Nome desconhecido: {FormulaText.Short(name)}. Campos usam @nome.", token.Position);
        }
        if (Peek.Kind != FormulaTokenKind.LParen) throw new FormulaException($"Esperado ( após {name} (posição {FormulaText.At(Peek.Position)}).", Peek.Position);
        Next();
        var args = new List<FormulaNode>();
        if (Peek.Kind == FormulaTokenKind.RParen)
        {
            Next();
        }
        else
        {
            while (true)
            {
                args.Add(ParseExpression(depth + 1));
                if (args.Count > arity.Value.Max) break;
                if (Peek.Kind == FormulaTokenKind.Comma)
                {
                    Next();
                    continue;
                }
                ExpectClose();
                break;
            }
        }
        if (args.Count < arity.Value.Min || args.Count > arity.Value.Max)
        {
            var expected = arity.Value.Min == arity.Value.Max
                ? arity.Value.Min == 1 ? "1 argumento" : $"{arity.Value.Min} argumentos"
                : $"de {arity.Value.Min} a {arity.Value.Max} argumentos";
            throw new FormulaException($"{name} espera {expected}.", token.Position);
        }
        return new CallNode(name, [.. args]);
    }
}

internal sealed class FormulaEvaluator(IReadOnlyDictionary<string, double> scope, Func<int, int>? die, StringBuilder? text)
{
    public List<DiceGroup> Groups { get; } = [];

    /// <summary>Resultado final; -0 vira 0 (o JSON escreveria "-0"; o cliente faz o mesmo).</summary>
    public double Run(FormulaNode root) => Eval(root) + 0.0;

    private static double Check(double value)
    {
        if (!double.IsFinite(value) || Math.Abs(value) > Formula.MaxValue) throw new FormulaException("Resultado fora do limite.");
        return value;
    }

    private void Write(string value) => text?.Append(value);

    private double Eval(FormulaNode node) => Check(EvalCore(node));

    private double EvalCore(FormulaNode node)
    {
        switch (node)
        {
            case NumberNode number:
                Write(number.Text);
                return number.Value;
            case RefNode reference:
            {
                var value = scope.TryGetValue(reference.Name, out var found) && double.IsFinite(found) ? found : 0;
                value = Check(value);
                Write("@" + reference.Name + "[" + Formula.Format(value) + "]");
                return value;
            }
            case DiceNode dice:
                return RollDice(dice);
            case GroupNode group:
            {
                Write("(");
                var value = Eval(group.Inner);
                Write(")");
                return value;
            }
            case UnaryNode unary:
            {
                Write(unary.Op == "not" ? "not " : unary.Op);
                var value = Eval(unary.Operand);
                return unary.Op switch
                {
                    "-" => -value,
                    "not" => value == 0 ? 1 : 0,
                    _ => value,
                };
            }
            case BinaryNode binary:
                return EvalBinary(binary);
            case CallNode call:
                return EvalCall(call);
            case IfNode conditional:
            {
                Write("if ");
                var condition = Eval(conditional.Condition);
                Write(" then ");
                if (condition != 0)
                {
                    var value = Eval(conditional.Then);
                    Write(" else ");
                    Render(conditional.Else);
                    return value;
                }
                Render(conditional.Then);
                Write(" else ");
                return Eval(conditional.Else);
            }
            default:
                throw new FormulaException("Fórmula inválida.");
        }
    }

    private double EvalBinary(BinaryNode binary)
    {
        var left = Eval(binary.Left);
        Write(" " + binary.Op + " ");
        if (binary.Op == "and" && left == 0)
        {
            Render(binary.Right);
            return 0;
        }
        if (binary.Op == "or" && left != 0)
        {
            Render(binary.Right);
            return 1;
        }
        var right = Eval(binary.Right);
        switch (binary.Op)
        {
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/":
                if (right == 0) throw new FormulaException("Divisão por zero.");
                return left / right;
            case "<": return left < right ? 1 : 0;
            case "<=": return left <= right ? 1 : 0;
            case ">": return left > right ? 1 : 0;
            case ">=": return left >= right ? 1 : 0;
            case "==": return left == right ? 1 : 0;
            case "!=": return left != right ? 1 : 0;
            case "and":
            case "or":
                return right != 0 ? 1 : 0;
            default:
                throw new FormulaException("Fórmula inválida.");
        }
    }

    private double EvalCall(CallNode call)
    {
        Write(call.Name + "(");
        var args = new double[call.Args.Length];
        for (var i = 0; i < args.Length; i++)
        {
            if (i > 0) Write(", ");
            args[i] = Eval(call.Args[i]);
        }
        Write(")");
        switch (call.Name)
        {
            case "floor": return Math.Floor(args[0]);
            case "ceil": return Math.Ceiling(args[0]);
            case "round": return Formula.RoundHalfAwayFromZero(args[0]);
            case "abs": return Math.Abs(args[0]);
            case "mod": return Math.Floor((args[0] - 10) / 2);
            case "clamp": return Math.Min(Math.Max(args[0], args[1]), args[2]);
            case "min":
            {
                var result = args[0];
                for (var i = 1; i < args.Length; i++) result = Math.Min(result, args[i]);
                return result;
            }
            case "max":
            {
                var result = args[0];
                for (var i = 1; i < args.Length; i++) result = Math.Max(result, args[i]);
                return result;
            }
            default:
                throw new FormulaException("Função desconhecida.");
        }
    }

    private double RollDice(DiceNode dice)
    {
        if (die is null) throw new FormulaException("Campos calculados não podem rolar dados.");
        var values = new int[dice.Count];
        for (var i = 0; i < values.Length; i++)
        {
            var value = die(dice.Sides);
            if (value < 1 || value > dice.Sides) throw new FormulaException("Gerador de dados inválido.");
            values[i] = value;
        }
        var kept = KeptIndexes(values, dice.Mode, dice.Keep);
        var subtotal = 0;
        foreach (var index in kept) subtotal += values[index];
        Groups.Add(new(dice.Notation, dice.Count, dice.Sides, values, kept, subtotal));
        if (text is not null)
        {
            var keptSet = new HashSet<int>(kept);
            text.Append(dice.Notation).Append('[');
            for (var i = 0; i < values.Length; i++)
            {
                if (i > 0) text.Append(", ");
                var shown = values[i].ToString(CultureInfo.InvariantCulture);
                text.Append(keptSet.Contains(i) ? shown : "~" + shown + "~");
            }
            text.Append(']');
        }
        return subtotal;
    }

    /// <summary>Índices mantidos em ordem crescente. Empates: o dado rolado antes tem prioridade.</summary>
    internal static int[] KeptIndexes(int[] values, string mode, int keep)
    {
        var n = values.Length;
        var (highest, take) = mode switch
        {
            "kh" => (true, keep),
            "kl" => (false, keep),
            "dh" => (false, n - keep),
            "dl" => (true, n - keep),
            _ => (true, n),
        };
        var order = Enumerable.Range(0, n).ToArray();
        Array.Sort(order, (a, b) =>
        {
            var byValue = highest ? values[b].CompareTo(values[a]) : values[a].CompareTo(values[b]);
            return byValue != 0 ? byValue : a.CompareTo(b);
        });
        var kept = order.Take(take).ToArray();
        Array.Sort(kept);
        return kept;
    }

    /// <summary>Texto de um ramo não avaliado (sem rolar dados).</summary>
    private void Render(FormulaNode node)
    {
        if (text is null) return;
        switch (node)
        {
            case NumberNode number: Write(number.Text); break;
            case RefNode reference: Write("@" + reference.Name); break;
            case DiceNode dice: Write(dice.Notation); break;
            case GroupNode group:
                Write("(");
                Render(group.Inner);
                Write(")");
                break;
            case UnaryNode unary:
                Write(unary.Op == "not" ? "not " : unary.Op);
                Render(unary.Operand);
                break;
            case BinaryNode binary:
                Render(binary.Left);
                Write(" " + binary.Op + " ");
                Render(binary.Right);
                break;
            case CallNode call:
                Write(call.Name + "(");
                for (var i = 0; i < call.Args.Length; i++)
                {
                    if (i > 0) Write(", ");
                    Render(call.Args[i]);
                }
                Write(")");
                break;
            case IfNode conditional:
                Write("if ");
                Render(conditional.Condition);
                Write(" then ");
                Render(conditional.Then);
                Write(" else ");
                Render(conditional.Else);
                break;
        }
    }
}
