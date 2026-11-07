using Eternnus.Web;
namespace Eternnus.Tests;
public sealed class DiceTests {
    [Theory]
    [InlineData("0d6")]
    [InlineData("101d6")]
    [InlineData("1d1")]
    [InlineData("1d1001")]
    [InlineData("eval(42)")]
    [InlineData("1d6;DROP TABLE")]
    public void Invalid_formulas_are_rejected_without_execution(string formula) => Assert.Throws<ArgumentException>(()=>Dice.Roll(formula));

    [Theory]
    [InlineData("1d20+3",1,20,3)]
    [InlineData("100d1000-2",100,1000,-2)]
    [InlineData(" 2d6 + 1 ",2,6,1)]
    public void Roll_obeys_count_bounds_and_modifier(string formula,int count,int sides,int modifier) {
        var result=Dice.Roll(formula);
        Assert.Equal(count,result.Values.Length); Assert.All(result.Values,value=>Assert.InRange(value,1,sides));
        Assert.Equal(result.Values.Sum()+modifier,result.Total); Assert.Equal(modifier,result.Modifier);
    }
}
