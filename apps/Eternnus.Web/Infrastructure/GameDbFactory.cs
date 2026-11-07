using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
namespace Eternnus.Web;

public class GameDbFactory : IDesignTimeDbContextFactory<GameDb>
{
    public GameDb CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<GameDb>()
        .UseNpgsql(Environment.GetEnvironmentVariable("ConnectionStrings__Eternnus") ?? "Host=localhost;Port=54329;Database=eternnus;Username=eternnus;Password=local-development-only").Options);
}
