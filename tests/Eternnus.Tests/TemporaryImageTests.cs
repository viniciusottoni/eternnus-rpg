using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace Eternnus.Tests;

public sealed class TemporaryImageTests
{
    [Fact]
    public async Task Only_master_presents_and_metadata_is_shared_without_image_bytes()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.AddRange(new AppUser { Id = "master", DisplayName = "Mestre" }, new AppUser { Id = "player" }, new AppUser { Id = "outsider" });
        var campaign = new Campaign { OwnerId = "master", Name = "Teste" };
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = "player" }); await db.SaveChangesAsync();
        var service = new SessionService(db, new SessionSignals(), TimeProvider.System);
        await service.StartAsync(campaign.Id, new("Teste", "", MapKinds.Tileset, "crypt"), "master", default);
        var session = await db.Sessions.SingleAsync();
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.ShowTemporaryImageAsync(session.Id, new("NPC"), "player", default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.ShowTemporaryImageAsync(session.Id, new("NPC"), "outsider", default))).Status);
        await service.ShowTemporaryImageAsync(session.Id, new("NPC"), "master", default);
        Assert.NotNull(session.TemporaryImageId);
        var json = JsonSerializer.Serialize(await service.StateAsync(session.Id, "player", default));
        Assert.Contains("NPC", json);
        var version = session.Revision;
        await service.HideTemporaryImageAsync(session.Id, "master", default);
        Assert.Null(session.TemporaryImageId); Assert.True(session.Revision > version);
        Assert.DoesNotContain(db.Model.FindEntityType(typeof(GameSession))!.GetProperties(), p => p.ClrType == typeof(byte[]));
        await service.EndAsync(session.Id, "master", default);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => service.ShowTemporaryImageAsync(session.Id, new("NPC"), "master", default))).Status);
    }
}
