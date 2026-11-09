using Eternnus.Web;

namespace Eternnus.Tests;

/// <summary>Regras puras da condução independente do sistema: formas de jogo, ordem de turnos, rolagens e ficha resumida.</summary>
public sealed class TablePlayRulesTests
{
    static Func<int, int> Seq(params int[] values) { var i = 0; return _ => values[i++ % values.Length]; }

    [Fact]
    public void Missing_play_mode_keeps_the_previous_tactical_behavior()
    {
        Assert.Equal(PlayModes.Tactical, PlayModes.Effective(null));
        Assert.Equal(PlayModes.Tactical, PlayModes.Effective("qualquer"));
        Assert.False(PlayModes.RequiresTurn(PlayModes.Free));
        Assert.True(PlayModes.RequiresTurn(PlayModes.Turns));
        Assert.False(PlayModes.LimitsMovement(PlayModes.Turns));
        Assert.True(PlayModes.LimitsMovement(null));
        Assert.Equal(PlayModes.Tactical, TableSettings.Parse("{\"fogEnabled\":false}").PlayMode);
        Assert.Throws<RuleException>(() => (TableSettings.Default with { PlayMode = "x" }).Validate());
    }

    [Fact]
    public void Dice_spec_supports_keep_explosion_successes_and_percentile()
    {
        var keep = DiceRoller.Roll(new DiceSpec(4, 6, 2, "kh", 3), Seq(6, 1, 5, 3));
        Assert.Equal(new[] { 0, 2, 3 }, keep.Kept);
        Assert.Equal(16, keep.Total);
        Assert.Equal("4d6kh3+2", keep.Notation);

        var exploded = DiceRoller.Roll(new DiceSpec(2, 6, Explode: true), Seq(6, 6, 2, 3));
        Assert.Equal(new[] { 6, 6, 2, 3 }, exploded.Values);
        Assert.Equal(17, exploded.Total);
        Assert.False(exploded.Capped);

        // Teto de explosões: sequência infinita de faces máximas para no limite e avisa.
        var capped = DiceRoller.Roll(new DiceSpec(1, 6, Explode: true), _ => 6);
        Assert.True(capped.Capped);
        Assert.Equal(DiceRoller.MaxExplosions + 1, capped.Values.Length);

        var pool = DiceRoller.Roll(new DiceSpec(5, 10, SuccessAt: 8), Seq(8, 2, 10, 7, 9));
        Assert.Equal(3, pool.Successes);
        Assert.Equal(3, pool.Total);
        Assert.Null(pool.Outcome);

        Assert.Equal("sucesso", DiceRoller.Roll(new DiceSpec(1, 100, PercentTarget: 45, PercentRule: "lte"), _ => 45).Outcome);
        Assert.Equal("falha", DiceRoller.Roll(new DiceSpec(1, 100, PercentTarget: 45, PercentRule: "lte"), _ => 46).Outcome);
        Assert.Equal("sucesso", DiceRoller.Roll(new DiceSpec(1, 100, PercentTarget: 45, PercentRule: "gte"), _ => 46).Outcome);
    }

    [Theory]
    [InlineData(0, 6)]
    [InlineData(101, 6)]
    [InlineData(1, 1)]
    [InlineData(1, 1001)]
    public void Dice_spec_rejects_out_of_range_dice(int count, int sides) =>
        Assert.Equal(400, Assert.Throws<RuleException>(() => DiceRoller.Validate(new DiceSpec(count, sides))).Status);

    [Fact]
    public void Dice_spec_rejects_ambiguous_combinations()
    {
        Assert.Throws<RuleException>(() => DiceRoller.Validate(new DiceSpec(2, 6, Keep: "kh", KeepCount: 3)));
        Assert.Throws<RuleException>(() => DiceRoller.Validate(new DiceSpec(4, 6, Keep: "kh", KeepCount: 2, Explode: true)));
        Assert.Throws<RuleException>(() => DiceRoller.Validate(new DiceSpec(2, 100, PercentTarget: 50, PercentRule: "lte")));
        Assert.Throws<RuleException>(() => DiceRoller.Validate(new DiceSpec(1, 100, PercentTarget: 50)));
        Assert.Throws<RuleException>(() => DiceRoller.Validate(new DiceSpec(1, 2, Explode: true)));
        Assert.Null(DiceRoller.ValidateCriterion(null, null));
        Assert.Throws<RuleException>(() => DiceRoller.ValidateCriterion(10, "eq"));
        Assert.Equal("falha", DiceRoller.Judge(9, new RollCriterion(10, "gte")));
    }

    [Fact]
    public void Turn_order_validates_sorts_by_initiative_and_skips_unavailable_entries()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), npc = Guid.NewGuid();
        var characters = new Dictionary<Guid, string> { [a] = "Aria", [b] = "Bram" };
        var tokens = new Dictionary<Guid, string> { [npc] = "Ogro" };
        var order = TurnOrders.Validate([
            new() { Key = "c:" + a, Initiative = 12 },
            new() { Key = "t:" + npc, Initiative = 18 },
            new() { Key = "g:x", Label = "Batedores", Members = [b] },
        ], characters, tokens, sortByInitiative: true);
        Assert.Equal(new[] { "t:" + npc, "c:" + a, "g:1" }, order.Select(e => e.Key));
        Assert.Equal("Ogro", order[0].Label);
        Assert.True(TurnOrders.Includes(order[2], b));
        Assert.Equal("g:1", TurnOrders.Next(order, "t:" + npc, e => e.Key != "c:" + a)!.Key);
        Assert.Equal("t:" + npc, TurnOrders.Next(order, "g:1", _ => true)!.Key);
        Assert.Null(TurnOrders.Next(order, null, _ => false));
        Assert.Throws<RuleException>(() => TurnOrders.Validate([new() { Key = "c:" + Guid.NewGuid() }], characters, tokens, false));
        Assert.Throws<RuleException>(() => TurnOrders.Validate([new() { Key = "c:" + a }, new() { Key = "c:" + a }], characters, tokens, false));
    }

    [Fact]
    public void Summary_shows_only_resources_defined_by_the_template()
    {
        var stressOnly = new List<SheetField>
        {
            new() { Name = "estresse", Label = "Estresse", Type = SheetFieldTypes.Number, Track = SheetSummary.Resource, Max = 6 },
            new() { Name = "municao", Label = "Munição", Type = SheetFieldTypes.Number, Track = SheetSummary.Resource, MaxField = "municao_max" },
            new() { Name = "municao_max", Label = "Munição máx.", Type = SheetFieldTypes.Number },
            new() { Name = "clã", Label = "Clã", Type = SheetFieldTypes.Text, Track = SheetSummary.Highlight },
        };
        var (resources, stats) = SheetSummary.Build(stressOnly, new Dictionary<string, string> { ["estresse"] = "2", ["municao"] = "4", ["municao_max"] = "12", ["clã"] = "Corvo" });
        Assert.Equal(new[] { "Estresse", "Munição" }, resources.Select(r => r.Label));
        Assert.Equal(6, resources[0].Max);
        Assert.Equal(12, resources[1].Max);
        Assert.Single(stats);
        Assert.DoesNotContain(resources, r => r.Label == "Vida");

        // Ficha clássica: Vida com teto em Vida máxima, mesmo sem marcação explícita.
        var classic = SheetTemplateService.FreeTemplateFields();
        var values = CharacterSheets.All(classic, CharacterSheets.LegacyValues(new Character { Hp = 7, MaxHp = 12, Level = 3 }));
        var (classicResources, classicStats) = SheetSummary.Build(classic, values);
        Assert.Contains(classicResources, r => r.Value == 7 && r.Max == 12);
        Assert.NotEmpty(classicStats);
    }

    [Fact]
    public void Simple_private_template_builds_valid_fields_without_pdf()
    {
        var input = new SimpleTemplateInput("Investigador", "", [
            new("Mente", [
                new("Sanidade", SheetFieldTypes.Number, null, true, null, "Sanidade máxima", false, 0, "60"),
                new("Sanidade máxima", SheetFieldTypes.Number, null, false, null, null, false, null, "60"),
                new("Ocupação", SheetFieldTypes.Select, ["Médico", "Jornalista"], false, null, null, true, null, null),
                new("Ferido", SheetFieldTypes.Checkbox, null, false, null, null, false, null, null),
            ]),
        ], [new("Perícia", "1d100", "", "Perícias", null)]);
        var (pages, fields, actions) = PreparationService.BuildSimpleTemplate(input);
        var version = new SheetTemplateVersion { Pages = pages, Fields = fields, Actions = actions };
        Assert.Empty(SheetTemplateService.ValidateForPublish(version));
        Assert.Equal(SheetFieldRoles.Name, fields[0].Role);
        var sanity = fields.Single(f => f.Label == "Sanidade");
        Assert.Equal(SheetSummary.Resource, sanity.Track);
        Assert.Equal(fields.Single(f => f.Label == "Sanidade máxima").Name, sanity.MaxField);
        Assert.Equal("Perícias", actions[0].Group);
        Assert.DoesNotContain(fields, f => f.Role is SheetFieldRoles.Hp or SheetFieldRoles.Level);
        Assert.Throws<RuleException>(() => PreparationService.BuildSimpleTemplate(new("X", "", [new("S", [new("Vida", SheetFieldTypes.Text, null, true, null, null, false, null, null)])], null)));
    }

    [Fact]
    public void Shortcuts_validate_limits_and_formulas()
    {
        var ok = Shortcuts.Validate(new(["a", "a", "b"], [new("Iniciativa", new DiceSpec(1, 20, 2), null), new("Dano", null, "2d6 + 1")]));
        Assert.Equal(new[] { "a", "b" }, ok.Actions);
        Assert.Throws<RuleException>(() => Shortcuts.Validate(new(Enumerable.Range(0, 9).Select(i => "x" + i).ToList(), null)));
        Assert.Throws<RuleException>(() => Shortcuts.Validate(new(null, [new("Ruim", null, "1d20 +")])));
        Assert.Equal(new CharacterShortcuts([], []).Actions, Shortcuts.Parse("{inválido").Actions);
    }
}
