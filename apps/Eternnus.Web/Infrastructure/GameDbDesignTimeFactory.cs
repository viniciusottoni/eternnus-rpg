using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Eternnus.Web;

/// <summary>
/// Creates the PostgreSQL DbContext for EF tooling without starting the web application,
/// SMTP worker, admin bootstrap or other production services.
/// </summary>
public sealed class GameDbDesignTimeFactory : IDesignTimeDbContextFactory<GameDb>
{
    public GameDb CreateDbContext(string[] args)
    {
        var config = new ConfigurationBuilder()
            .AddJsonFile("appsettings.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connection = config.GetConnectionString("Eternnus");
        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
            ?? "Development";

        if (string.IsNullOrWhiteSpace(connection))
        {
            if (!string.Equals(environment, "Development", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "EF Core production migrations require ConnectionStrings__Eternnus.");
            }

            // Same local development connection configured by ServiceRegistration.
            // Never use this fallback for a production migration.
            connection = "Host=localhost;Port=54329;Database=eternnus;Username=eternnus;Password=local-development-only";
        }

        var options = new DbContextOptionsBuilder<GameDb>()
            .UseNpgsql(connection, postgres => postgres.CommandTimeout(30))
            .Options;

        return new GameDb(options);
    }
}
