using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Eternnus.Web;

/// <summary>
/// Single design-time factory used by dotnet-ef and migration bundles.
/// Does not start the ASP.NET Core host or execute production bootstrap/workers.
/// </summary>
public sealed class GameDbFactory : IDesignTimeDbContextFactory<GameDb>
{
    public GameDb CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Eternnus");
        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
            ?? "Development";

        if (string.IsNullOrWhiteSpace(connection))
        {
            if (!string.Equals(environment, "Development", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    "EF Core production migrations require ConnectionStrings__Eternnus.");

            // Local development only, never silently used by the GitHub production runner.
            connection = "Host=localhost;Port=54329;Database=eternnus;Username=eternnus;Password=local-development-only";
        }

        var options = new DbContextOptionsBuilder<GameDb>()
            .UseNpgsql(connection, pg => pg.CommandTimeout(30))
            .Options;

        return new GameDb(options);
    }
}
