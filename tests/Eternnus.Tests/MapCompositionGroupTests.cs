using Eternnus.Web;
namespace Eternnus.Tests;

/// <summary>ADR-086: grupo opcional nos elementos de mapas de imagem (organização do editor; composições antigas continuam válidas).</summary>
public sealed class MapCompositionGroupTests
{
    const string Layers = """[{"id":"base","name":"Base","kind":"base","visible":true,"locked":false,"opacity":100},{"id":"elements","name":"Elementos","kind":"elements","visible":true,"locked":false,"opacity":100}]""";
    static string Doc(string elements) => $$"""{"v":1,"artboard":{"width":256,"height":256,"background":"#000000"},"layers":{{Layers}},"elements":[{{elements}}]}""";
    const string Rect = """{"id":"r1","layer":"elements","type":"rect","x":0,"y":0,"width":10,"height":10,"fill":"#ffffff"}""";

    [Fact]
    public void Group_is_optional_and_old_documents_still_parse()
    {
        var (doc, _, _) = MapComposition.Parse(Doc(Rect));
        Assert.Null(doc.Elements![0]!.Group);
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
        Assert.DoesNotContain("group", System.Text.Json.JsonSerializer.Serialize(doc, options));
    }

    [Fact]
    public void Valid_group_is_kept()
    {
        var (doc, _, _) = MapComposition.Parse(Doc(Rect.Replace("\"fill\"", "\"group\":\"grupo-1\",\"fill\"")));
        Assert.Equal("grupo-1", doc.Elements![0]!.Group);
    }

    [Theory]
    [InlineData("Grupo 1")]
    [InlineData("<script>")]
    [InlineData("")]
    [InlineData("grupo-com-nome-longo-demais-aqui")]
    public void Invalid_group_is_rejected(string group)
    {
        var json = Doc(Rect.Replace("\"fill\"", $"\"group\":{System.Text.Json.JsonSerializer.Serialize(group)},\"fill\""));
        var error = Assert.Throws<RuleException>(() => MapComposition.Parse(json));
        Assert.Equal(400, error.Status);
    }
}
