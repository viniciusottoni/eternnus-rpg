using System.Text.Json;
using System.Text.Json.Nodes;
using Eternnus.Web;
namespace Eternnus.Tests;

/// <summary>Linguagem de fórmulas (C#) contra os casos compartilhados com o cliente (tests/fixtures/formula-cases.json,
/// também executados por tests/formula.test.mjs). Mais limites, determinismo de rolagem e o cálculo da ficha.</summary>
public sealed class FormulaTests
{
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    static readonly Lazy<JsonObject> Fixture = new(() => (JsonObject)JsonNode.Parse(File.ReadAllText(FixturePath()))!);

    /// <summary>Procura tests/fixtures/formula-cases.json subindo a partir da saída dos testes (independe do diretório atual).</summary>
    static string FixturePath()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "tests", "fixtures", "formula-cases.json");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("tests/fixtures/formula-cases.json não encontrado acima de " + AppContext.BaseDirectory);
    }

    static JsonArray Section(string name) => Fixture.Value[name] as JsonArray ?? throw new InvalidOperationException("Seção ausente: " + name);
    static JsonObject Case(string section, int index) => (JsonObject)Section(section)[index]!;

    public static TheoryData<int, string> Indexes(string section)
    {
        var data = new TheoryData<int, string>();
        var items = Section(section);
        for (var i = 0; i < items.Count; i++)
        {
            var label = items[i] is JsonObject o ? (string?)o["name"] ?? ExpressionOf(o) : items[i]!.ToJsonString();
            data.Add(i, label.Length > 60 ? label[..60] + "…" : label);
        }
        return data;
    }

    /// <summary>"expr" literal ou "build" = [[trecho, repetições], ...] concatenados.</summary>
    static string ExpressionOf(JsonObject c)
    {
        if (c["build"] is JsonArray build)
            return string.Concat(build.Select(part => string.Concat(Enumerable.Repeat((string)part![0]!, (int)part[1]!))));
        return (string?)c["expr"] ?? "";
    }

    static Dictionary<string, double> ScopeOf(JsonObject c) =>
        c["scope"] is JsonObject scope ? scope.ToDictionary(p => p.Key, p => (double)p.Value!) : [];

    static int? PositionOf(JsonObject c) => c["position"] is JsonValue v ? (int)v : null;

    /// <summary>Gerador determinístico com a sequência do caso; falha se a engine pedir dados a mais.</summary>
    static (Func<int, int> Die, Func<int> Remaining) Scripted(JsonObject c)
    {
        var queue = new Queue<int>((c["dice"] as JsonArray ?? []).Select(v => (int)v!));
        return (sides =>
        {
            Assert.True(sides > 0, "faces inválidas pedidas ao gerador");
            Assert.True(queue.Count > 0, "a engine pediu mais dados do que o caso fornece");
            return queue.Dequeue();
        }, () => queue.Count);
    }

    static List<SheetField> FieldsOf(JsonObject c)
    {
        if (c["generate"] is JsonObject generate)
        {
            var count = (int)generate["count"]!;
            return Enumerable.Range(1, count).Select(i => new SheetField { Name = $"f{i}", Label = $"F{i}", Type = SheetFieldTypes.Number, Page = 0, X = 0.1, Y = 0.02, W = 0.3, H = 0.02 }).ToList();
        }
        return c["fields"]!.Deserialize<List<SheetField>>(Web)!;
    }

    // ---------- Casos compartilhados ----------

    [Fact]
    public void Fixture_has_every_section()
    {
        foreach (var key in new[] { "evaluate", "evaluateErrors", "validate", "rolls", "rollErrors", "format", "validateFields", "compute" })
            Assert.NotEmpty(Section(key));
    }

    [Theory, MemberData(nameof(Indexes), "evaluate")]
    public void Evaluate_matches_fixture(int index, string label)
    {
        var c = Case("evaluate", index);
        Assert.True((double)c["result"]! == Formula.Evaluate(ExpressionOf(c), ScopeOf(c)), label);
    }

    [Theory, MemberData(nameof(Indexes), "evaluateErrors")]
    public void Evaluate_errors_match_fixture(int index, string label)
    {
        var c = Case("evaluateErrors", index);
        var error = Assert.Throws<FormulaException>(() => Formula.Evaluate(ExpressionOf(c), ScopeOf(c)));
        Assert.Equal((string)c["error"]!, error.Message);
        Assert.True(PositionOf(c) == error.Position, $"{label}: posição {error.Position}");
    }

    [Theory, MemberData(nameof(Indexes), "validate")]
    public void Validate_matches_fixture(int index, string label)
    {
        var c = Case("validate", index);
        var mode = (string)c["mode"]! == "roll" ? FormulaMode.Roll : FormulaMode.Deterministic;
        var known = c["known"] is JsonArray names ? names.Select(n => (string)n!).ToHashSet() : null;
        var result = Formula.Validate(ExpressionOf(c), mode, known);
        Assert.True((bool)c["ok"]! == result.Ok, $"{label}: {result.Error}");
        if (result.Ok)
        {
            Assert.Null(result.Error);
            Assert.Equal(c["references"]!.AsArray().Select(r => (string)r!), result.References);
        }
        else
        {
            Assert.Equal((string)c["error"]!, result.Error);
            Assert.True(PositionOf(c) == result.ErrorPosition, $"{label}: posição {result.ErrorPosition}");
            Assert.Empty(result.References);
        }
    }

    [Theory, MemberData(nameof(Indexes), "rolls")]
    public void Rolls_match_fixture(int index, string label)
    {
        var c = Case("rolls", index);
        var (die, remaining) = Scripted(c);
        var roll = Formula.Roll(ExpressionOf(c), ScopeOf(c), die);
        Assert.True((double)c["total"]! == roll.Total, $"{label}: {roll.Total}");
        Assert.Equal((string)c["breakdown"]!, roll.Breakdown);
        Assert.Equal(0, remaining());
        if (c["groups"] is JsonArray groups)
        {
            Assert.Equal(groups.Count, roll.Dice.Count);
            for (var i = 0; i < groups.Count; i++)
            {
                var expected = groups[i]!.AsObject();
                var actual = roll.Dice[i];
                Assert.Equal((string)expected["notation"]!, actual.Notation);
                Assert.Equal((int)expected["count"]!, actual.Count);
                Assert.Equal((int)expected["sides"]!, actual.Sides);
                Assert.Equal(expected["values"]!.AsArray().Select(v => (int)v!), actual.Values);
                Assert.Equal(expected["kept"]!.AsArray().Select(v => (int)v!), actual.Kept);
                Assert.Equal((int)expected["subtotal"]!, actual.Subtotal);
            }
        }
    }

    [Theory, MemberData(nameof(Indexes), "rollErrors")]
    public void Roll_errors_match_fixture(int index, string label)
    {
        var c = Case("rollErrors", index);
        var (die, _) = Scripted(c);
        var error = Assert.Throws<FormulaException>(() => Formula.Roll(ExpressionOf(c), ScopeOf(c), die));
        Assert.True((string)c["error"]! == error.Message, $"{label}: {error.Message}");
    }

    [Theory, MemberData(nameof(Indexes), "format")]
    public void Format_matches_fixture(int index, string label)
    {
        var pair = Section("format")[index]!.AsArray();
        Assert.True((string)pair[1]! == Formula.Format((double)pair[0]!), $"{label}: {Formula.Format((double)pair[0]!)}");
    }

    [Theory, MemberData(nameof(Indexes), "validateFields")]
    public void Validate_fields_matches_fixture(int index, string label)
    {
        var c = Case("validateFields", index);
        var errors = SheetCalculator.ValidateFields(FieldsOf(c));
        Assert.True(c["errors"]!.AsArray().Select(e => (string)e!).SequenceEqual(errors), $"{label}: {string.Join(" | ", errors)}");
    }

    [Theory, MemberData(nameof(Indexes), "compute")]
    public void Compute_matches_fixture(int index, string label)
    {
        var c = Case("compute", index);
        var fields = FieldsOf(c);
        var values = c["values"] is JsonObject v ? v.ToDictionary(p => p.Key, p => (string?)p.Value) : [];
        var computed = SheetCalculator.Compute(fields, values!);
        var expected = c["expected"]!.AsObject().ToDictionary(p => p.Key, p => (string)p.Value!);
        Assert.True(expected.Count == computed.Count && expected.All(p => computed.TryGetValue(p.Key, out var x) && x == p.Value),
            $"{label}: {JsonSerializer.Serialize(computed)}");
        if (c["scope"] is JsonObject scope)
        {
            var actual = SheetCalculator.Scope(fields, computed);
            Assert.True(scope.Count == actual.Count && scope.All(p => actual.TryGetValue(p.Key, out var x) && x == (double)p.Value!),
                $"{label}: escopo {JsonSerializer.Serialize(actual)}");
        }
    }

    // ---------- Limites ----------

    [Fact]
    public void Long_expressions_are_rejected_before_parsing()
    {
        Assert.True(Formula.Validate(string.Join(" + ", Enumerable.Repeat("1", 75)), FormulaMode.Deterministic).Ok);
        var huge = Formula.Validate(new string('(', 1_000_000), FormulaMode.Deterministic);
        Assert.Equal("Fórmula longa demais (máx. 300 caracteres).", huge.Error);
        Assert.Null(huge.ErrorPosition);
        Assert.Throws<FormulaException>(() => Formula.Evaluate(new string('1', 301), new Dictionary<string, double>()));
    }

    [Fact]
    public void Token_limit_is_200_elements()
    {
        Assert.True(Formula.Validate(string.Concat(Enumerable.Repeat("1+", 99)) + "1", FormulaMode.Deterministic).Ok);
        var result = Formula.Validate(string.Concat(Enumerable.Repeat("1+", 100)) + "1", FormulaMode.Deterministic);
        Assert.Equal("Fórmula longa demais (máx. 200 elementos).", result.Error);
    }

    [Theory]
    [InlineData("(", ")")]
    [InlineData("abs(", ")")]
    [InlineData("-", "")]
    [InlineData("not ", "")]
    public void Nesting_is_limited_to_32_levels(string open, string close)
    {
        string Nest(int n) => string.Concat(Enumerable.Repeat(open, n)) + "1" + string.Concat(Enumerable.Repeat(close, n));
        Assert.True(Formula.Validate(Nest(32), FormulaMode.Deterministic).Ok);
        Assert.Equal("Aninhamento profundo demais (máx. 32 níveis).", Formula.Validate(Nest(33), FormulaMode.Deterministic).Error);
    }

    [Fact]
    public void Dice_are_limited_per_group_and_per_formula()
    {
        Assert.True(Formula.Validate("100d6 + 100d6", FormulaMode.Roll).Ok);
        Assert.Equal("Dados demais (máx. 200 por fórmula).", Formula.Validate("100d6 + 100d6 + 1d4", FormulaMode.Roll).Error);
        Assert.Equal("Quantidade de dados deve ser de 1 a 100 (posição 1).", Formula.Validate("101d6", FormulaMode.Roll).Error);
        // Dados dentro de um if não escolhido também contam: o limite vale para o texto, não para o ramo sorteado.
        Assert.False(Formula.Validate("if 1 then 100d6 else 100d6 + 1d6", FormulaMode.Roll).Ok);
        var rolled = 0;
        var roll = Formula.Roll("100d100 + 100d100", new Dictionary<string, double>(), sides => { rolled++; return sides; });
        Assert.Equal(200, rolled);
        Assert.Equal(20000, roll.Total);
    }

    [Fact]
    public void Division_by_zero_and_overflow_are_errors_not_infinity()
    {
        var scope = new Dictionary<string, double> { ["zero"] = 0 };
        Assert.Equal("Divisão por zero.", Assert.Throws<FormulaException>(() => Formula.Evaluate("1 / @zero", scope)).Message);
        Assert.Equal("Divisão por zero.", Assert.Throws<FormulaException>(() => Formula.Evaluate("0 / 0", scope)).Message);
        Assert.Equal("Resultado fora do limite.", Assert.Throws<FormulaException>(() => Formula.Evaluate("1000000000 * 1000000000", scope)).Message);
        // Curto-circuito: o ramo não escolhido não é avaliado.
        Assert.Equal(1, Formula.Evaluate("if 1 then 1 else 1 / 0", scope));
        Assert.Equal(0, Formula.Evaluate("0 and 1 / 0", scope));
    }

    [Fact]
    public void Negative_zero_is_normalized()
    {
        var scope = new Dictionary<string, double> { ["a"] = 0 };
        Assert.False(double.IsNegative(Formula.Evaluate("-0", scope)));
        Assert.False(double.IsNegative(Formula.Evaluate("-@a * 5", scope)));
        Assert.False(double.IsNegative(Formula.Roll("-(1d4 >= 5)", scope, _ => 1).Total));
        Assert.Equal("0", JsonSerializer.Serialize(Formula.Evaluate("-0", scope)));
    }

    [Fact]
    public void Unknown_names_and_functions_never_execute()
    {
        Assert.Equal("Nome desconhecido: system. Campos usam @nome.", Formula.Validate("System", FormulaMode.Deterministic).Error);
        Assert.Equal("Função desconhecida: gettype.", Formula.Validate("GetType(1)", FormulaMode.Deterministic).Error);
        Assert.Equal("Campo desconhecido: @b", Formula.Validate("@a + @b", FormulaMode.Deterministic, new HashSet<string> { "a" }).Error);
        Assert.Equal("Informe uma fórmula.", Formula.Validate(null, FormulaMode.Deterministic).Error);
        // Nome ausente no escopo vale 0 na avaliação (a validação com knownNames é que barra no editor).
        Assert.Equal(1, Formula.Evaluate("@ausente + 1", new Dictionary<string, double>()));
    }

    [Fact]
    public void Deterministic_mode_rejects_dice_everywhere()
    {
        foreach (var expr in new[] { "1d6", "d%", "if 1 then 1 else 1d6", "max(1, 2d4)" })
            Assert.Equal("Campos calculados não podem rolar dados.", Assert.Throws<FormulaException>(() => Formula.Evaluate(expr, new Dictionary<string, double>())).Message);
    }

    // ---------- Determinismo da rolagem ----------

    [Fact]
    public void Seeded_generator_gives_reproducible_rolls()
    {
        const string expr = "4d6kh3 + 2d20kl1 + 1d8 + @forca_mod";
        var scope = new Dictionary<string, double> { ["forca_mod"] = 3 };
        FormulaRoll Run(int seed)
        {
            var random = new Random(seed);
            return Formula.Roll(expr, scope, sides => random.Next(1, sides + 1));
        }
        var a = Run(42);
        var b = Run(42);
        Assert.Equal(a.Total, b.Total);
        Assert.Equal(a.Breakdown, b.Breakdown);
        Assert.Equal(a.Dice.SelectMany(d => d.Values), b.Dice.SelectMany(d => d.Values));
        Assert.Equal(3, a.Dice.Count);
        Assert.Equal(a.Dice.Sum(d => d.Subtotal) + 3, a.Total);
        Assert.Equal(expr, a.Formula);
    }

    [Fact]
    public void Default_generator_stays_within_faces()
    {
        for (var i = 0; i < 200; i++)
        {
            var roll = Formula.Roll("4d6kh3 + 1d20", new Dictionary<string, double>());
            Assert.All(roll.Dice[0].Values, v => Assert.InRange(v, 1, 6));
            Assert.All(roll.Dice[1].Values, v => Assert.InRange(v, 1, 20));
            Assert.InRange(roll.Total, 4, 38);
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(7)]
    [InlineData(-1)]
    public void Invalid_generator_values_are_rejected(int value) =>
        Assert.Equal("Gerador de dados inválido.", Assert.Throws<FormulaException>(() => Formula.Roll("1d6", new Dictionary<string, double>(), _ => value)).Message);

    // ---------- Ficha ----------

    static SheetField Number(string name, string? @default = null) => new() { Name = name, Label = name, Type = SheetFieldTypes.Number, X = 0.1, Y = 0.1, W = 0.2, H = 0.05, Default = @default };
    static SheetField Computed(string name, string formula) => new() { Name = name, Label = name, Type = SheetFieldTypes.Computed, X = 0.1, Y = 0.1, W = 0.2, H = 0.05, Formula = formula };

    [Fact]
    public void Circular_references_are_reported_and_computed_as_empty()
    {
        var fields = new List<SheetField> { Number("base", "2"), Computed("a", "@b + @base"), Computed("b", "@a + 1"), Computed("c", "@base * 3") };
        Assert.Contains("Ciclo entre campos calculados: a → b → a.", SheetCalculator.ValidateFields(fields));
        var values = SheetCalculator.Compute(fields, new Dictionary<string, string>());
        Assert.Equal(("", "", "6"), (values["a"], values["b"], values["c"]));
    }

    [Fact]
    public void Long_dependency_chain_is_computed_in_order()
    {
        var fields = new List<SheetField> { Number("x0", "1") };
        for (var i = 1; i <= 250; i++) fields.Add(Computed($"x{i}", $"@x{i - 1} + 1"));
        fields.Reverse();
        Assert.Empty(SheetCalculator.ValidateFields(fields));
        Assert.Equal("251", SheetCalculator.Compute(fields, new Dictionary<string, string>())["x250"]);
    }

    [Fact]
    public void Computed_values_ignore_client_input_and_unknown_fields()
    {
        var fields = new List<SheetField> { Number("forca", "10"), Computed("mod", "mod(@forca)") };
        var values = SheetCalculator.Compute(fields, new Dictionary<string, string> { ["forca"] = "18", ["mod"] = "99", ["invasor"] = "1" });
        Assert.Equal(new Dictionary<string, string> { ["forca"] = "18", ["mod"] = "4" }, values);
        Assert.Equal(new Dictionary<string, double> { ["forca"] = 18, ["mod"] = 4 }, SheetCalculator.Scope(fields, values));
    }
}
