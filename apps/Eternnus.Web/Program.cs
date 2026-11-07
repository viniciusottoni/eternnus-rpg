using Eternnus.Web;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.AddEternnusServices();
var app = builder.Build();
app.ValidateEternnusConfiguration();
app.UseEternnusPipeline();
app.MapAuthEndpoints();
app.MapProfileEndpoints();
app.MapCampaignEndpoints();
app.MapGameApi();
app.MapCharacterSheetEndpoints();
app.MapSessionEndpoints();
app.MapTemporaryImageEndpoints();
app.MapCampaignAssetsEndpoints();
app.MapAdminEndpoints();
app.MapSupportEndpoints();
app.MapLibraryEndpoints();
app.MapSheetTemplateEndpoints();
app.MapGuildEndpoints();
app.MapProgressEndpoints();
app.MapGet("/health", async (GameDb db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ok" }) : Results.StatusCode(503));
app.MapFallbackToFile("index.html");
await app.InitializeEternnusDatabaseAsync();
app.Run();
public partial class Program;
