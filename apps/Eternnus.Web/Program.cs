using Eternnus.Web;
using Microsoft.EntityFrameworkCore;

try
{
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
    StartupFailure.Clear(AppContext.BaseDirectory);
    app.Run();
}
// HostAbortedException é o encerramento normal das ferramentas de design do EF Core (dotnet ef).
catch (Exception error) when (error is not HostAbortedException)
{
    // No IIS a falha de inicialização aparece só como HTTP 502.5; registrar a causa sanitizada.
    StartupFailure.Record(error, AppContext.BaseDirectory);
    throw;
}

public partial class Program;
