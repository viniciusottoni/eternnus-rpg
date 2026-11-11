using Eternnus.Web;

namespace Eternnus.Tests;

public class PasswordPolicyTests
{
    [Theory]
    [InlineData("abcdefg1", true)]      // minúscula + número, 8 caracteres
    [InlineData("ABCDEFGh", true)]      // maiúscula + minúscula
    [InlineData("12345678!", true)]     // número + símbolo
    [InlineData("abcdefgh", false)]     // um tipo só
    [InlineData("12345678", false)]     // um tipo só
    [InlineData("abcdef1", false)]      // 7 caracteres
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Validates_length_and_two_categories(string? password, bool expected) =>
        Assert.Equal(expected, PasswordPolicy.IsValid(password));

    [Fact]
    public void Rejects_more_than_128_characters()
    {
        Assert.True(PasswordPolicy.IsValid(new string('a', 127) + "1"));
        Assert.False(PasswordPolicy.IsValid(new string('a', 128) + "1"));
    }

    [Fact]
    public void Counts_each_category_once() => Assert.Equal(4, PasswordPolicy.Categories("aA1!bB2@"));
}
