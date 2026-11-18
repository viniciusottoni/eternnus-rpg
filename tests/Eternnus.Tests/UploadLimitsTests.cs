using Eternnus.Web;
using Microsoft.AspNetCore.Http;
namespace Eternnus.Tests;
public sealed class UploadLimitsTests
{
    [Theory]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/assets/maps", true)]
    [InlineData("PUT", "/api/campaigns/00000000-0000-4000-8000-000000000001/assets/maps", false)]
    [InlineData("POST", "/api/campaigns/not-an-id/assets/maps", false)]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/assets/maps/extra", false)]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/maps", false)]
    public void Only_the_exact_map_upload_route_receives_the_map_body_cap(string method, string path, bool allowed)
    {
        var context = new DefaultHttpContext(); context.Request.Method = method; context.Request.Path = path;
        Assert.Equal(allowed ? CampaignAssetsService.MaxImageRequestBytes : (long?)null, UploadLimits.For(context.Request));
    }

    [Theory]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/scenes/00000000-0000-4000-8000-000000000002/sources", (long)CampaignAssetsService.MaxImageRequestBytes)]
    [InlineData("PUT", "/api/campaigns/00000000-0000-4000-8000-000000000001/scenes/00000000-0000-4000-8000-000000000002/composition", CampaignAssetsService.MaxCompositionRequestBytes)]
    [InlineData("PUT", "/api/campaigns/00000000-0000-4000-8000-000000000001/scenes/00000000-0000-4000-8000-000000000002/sources", null)]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/scenes/not-an-id/sources", null)]
    [InlineData("PUT", "/api/campaigns/00000000-0000-4000-8000-000000000001/scenes/00000000-0000-4000-8000-000000000002", null)]
    public void Scene_composition_routes_receive_the_editor_body_caps(string method, string path, long? expected)
    {
        var context = new DefaultHttpContext(); context.Request.Method = method; context.Request.Path = path;
        Assert.Equal(expected, UploadLimits.For(context.Request));
    }

    [Theory]
    [InlineData("PUT", "/api/campaigns/00000000-0000-4000-8000-000000000001/assets/layers", true)]
    [InlineData("POST", "/api/sessions/00000000-0000-4000-8000-000000000001/fog/walls", true)]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/assets/layers", false)]
    [InlineData("GET", "/api/campaigns/00000000-0000-4000-8000-000000000001/assets/layers", false)]
    [InlineData("PUT", "/api/campaigns/not-an-id/assets/layers", false)]
    [InlineData("PUT", "/api/sessions/00000000-0000-4000-8000-000000000001/fog/walls", false)]
    [InlineData("POST", "/api/sessions/00000000-0000-4000-8000-000000000001/fog/lights", false)]
    [InlineData("POST", "/api/campaigns/00000000-0000-4000-8000-000000000001/fog/walls", false)]
    public void Only_layer_and_wall_saves_receive_the_layer_body_cap(string method, string path, bool allowed)
    {
        var context = new DefaultHttpContext(); context.Request.Method = method; context.Request.Path = path;
        Assert.Equal(allowed ? UploadLimits.LayerRequestBytes : (long?)null, UploadLimits.For(context.Request));
    }

    [Theory]
    [InlineData("POST", "/api/library", true)]
    [InlineData("PUT", "/api/library/00000000-0000-4000-8000-000000000001/file", true)]
    [InlineData("PUT", "/api/sheet-templates/00000000-0000-4000-8000-000000000001/versions/00000000-0000-4000-8000-000000000002/pdf", true)]
    [InlineData("PUT", "/api/library/not-an-id/file", false)]
    [InlineData("PUT", "/api/library/extra/parts/file", false)]
    [InlineData("PUT", "/api/sheet-templates/invalid/versions/invalid/pdf", false)]
    [InlineData("PUT", "/api/sheet-templates/00000000-0000-4000-8000-000000000001/pdf", false)]
    [InlineData("POST", "/api/characters", false)]
    [InlineData("GET", "/api/library", false)]
    public void Only_exact_document_upload_routes_receive_the_larger_body_cap(string method, string path, bool allowed)
    {
        var context = new DefaultHttpContext(); context.Request.Method = method; context.Request.Path = path;
        Assert.Equal(allowed ? UploadLimits.DocumentRequestBytes : (long?)null, UploadLimits.For(context.Request));
    }
}
