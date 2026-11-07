using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public static class DatabaseInitialization
{
    public static async Task InitializeEternnusDatabaseAsync(this WebApplication app)
    {
        if (app.Configuration.GetValue<bool>("Database:Migrate"))
        {
            using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<GameDb>();
            if (db.Database.IsNpgsql()) await db.Database.MigrateAsync();
            else await db.Database.EnsureCreatedAsync();
        }
        // Dados mínimos da plataforma: idempotentes, executados também quando as migrações são aplicadas por script.
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GameDb>();
            await SheetTemplateService.EnsureFreeTemplateAsync(db, CancellationToken.None);
        }
        await AdminBootstrap.EnsureAsync(app.Services, CancellationToken.None);
        await AdminService.EnsureBootstrapAdminsAsync(app.Services, CancellationToken.None);
    }
}
