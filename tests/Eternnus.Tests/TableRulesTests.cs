using Eternnus.Web;
namespace Eternnus.Tests;

public sealed class TableRulesTests
{
    [Theory]
    [InlineData(10, 0)] [InlineData(11, 0)] [InlineData(16, 3)] [InlineData(13, 1)] [InlineData(9, -1)] [InlineData(1, -5)] [InlineData(0, -5)]
    public void Modifier_follows_the_classic_attribute_table(int attribute, int expected) => Assert.Equal(expected, TableRules.Modifier(attribute));

    [Theory]
    [InlineData(9, 6)] [InlineData(6, 4)] [InlineData(1, 1)] [InlineData(0, 1)] [InlineData(-5, 1)] [InlineData(300, 200)]
    public void Movement_in_meters_becomes_at_least_one_square(int meters, int squares) => Assert.Equal(squares, TableRules.MovementSquares(meters));

    [Fact]
    public void Diagonal_distance_costs_one_square() => Assert.Equal(3, TableRules.Distance(0, 0, 3, 2));

    [Fact]
    public void Turn_order_cycles_and_recovers_from_a_missing_holder()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid();
        var order = new[] { a, b, c };
        Assert.Null(TableRules.NextTurn([], null));
        Assert.Equal(a, TableRules.NextTurn(order, null));
        Assert.Equal(b, TableRules.NextTurn(order, a));
        Assert.Equal(a, TableRules.NextTurn(order, c));
        Assert.Equal(a, TableRules.NextTurn(order, Guid.NewGuid())); // Quem saiu da mesa não trava a rotação.
    }

    [Fact]
    public void Presence_expires_after_the_online_window()
    {
        var now = DateTime.UtcNow;
        Assert.True(TableRules.IsOnline(now.AddSeconds(-44), now));
        Assert.False(TableRules.IsOnline(now.AddSeconds(-46), now));
        Assert.False(TableRules.IsOnline(null, now));
    }

    [Fact]
    public void Actions_are_normalized_and_bounded()
    {
        var actions = new List<CharacterAction> { new() { Id = "<x>", Name = "  Golpe  ", Kind = "ataque", Formula = " 1d20 + 3 " }, new() { Id = "dup", Name = "A", Kind = "magia" }, new() { Id = "dup", Name = "B", Kind = "item" } };
        Assert.Null(TableRules.ValidateActions(actions));
        Assert.Equal("Golpe", actions[0].Name);
        Assert.Equal("1d20+3", actions[0].Formula);
        Assert.Matches("^[a-f0-9]{32}$", actions[0].Id);
        Assert.Equal(3, actions.Select(a => a.Id).Distinct().Count());
    }

    [Theory]
    [InlineData("", "ataque", "")]
    [InlineData("Golpe", "veneno", "")]
    [InlineData("Golpe", "ataque", "eval(1)")]
    [InlineData("Golpe", "ataque", "1d1")]
    public void Invalid_actions_are_rejected(string name, string kind, string formula) =>
        Assert.NotNull(TableRules.ValidateActions([new() { Name = name, Kind = kind, Formula = formula }]));

    [Fact]
    public void Too_many_actions_are_rejected() =>
        Assert.NotNull(TableRules.ValidateActions(Enumerable.Range(0, TableRules.MaxActions + 1).Select(i => new CharacterAction { Name = "A" + i, Kind = "item" }).ToList()));

    [Fact]
    public void Sheet_diff_lists_only_changed_fields_with_before_and_after()
    {
        var c = new Character { Name = "Tharion", Level = 6, Hp = 48, MaxHp = 48 };
        var before = CharacterSnapshot.Of(c);
        c.Level = 7; c.Hp = 40;
        var diff = TableRules.Diff(before, CharacterSnapshot.Of(c));
        Assert.Equal([new SheetChange("level", "Nível", "6", "7"), new SheetChange("hp", "Vida", "48", "40")], diff);
        Assert.Empty(TableRules.Diff(before, before));
    }

    [Fact]
    public void Official_tilesets_are_rectangular_with_free_entry_points()
    {
        foreach (var map in BattleMaps.All.Where(m => m.Kind == MapKinds.Tileset))
        {
            Assert.All(map.Rows, row => Assert.Equal(map.Width, row.Length));
            Assert.All(map.Rows, row => Assert.Matches(@"^[#ToAbt~.,+=rS]+$", row));
            Assert.True(map.Spawns().Count() >= 6, map.Key + " needs entry points for a full party");
            Assert.All(map.Spawns(), p => Assert.True(map.CanStand(p.X, p.Y)));
            Assert.False(map.CanStand(-1, 0)); Assert.False(map.CanStand(map.Width, 0));
        }
        Assert.Null(BattleMaps.Find("unknown"));
        Assert.Equal(MapKinds.Cartographic, BattleMaps.Find("valley")!.Kind);
    }
}
