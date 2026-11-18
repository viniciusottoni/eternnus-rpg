using Eternnus.Web;
using ImageMagick;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Tests;

/// <summary>Imagem do personagem (ADR-097): leitura como a ficha, escrita só do dono, sem mexer na revisão da ficha.</summary>
public sealed class CharacterPortraitTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    CharacterPortraitService service = null!;
    readonly Campaign campaign = new() { OwnerId = "master", Name = "Campanha" };
    readonly Character hero = new() { OwnerId = "owner", Name = "Lira" };
    public async Task InitializeAsync()
    {
        await connection.OpenAsync(); db = new(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { "master", "owner", "member", "stranger" }) db.Users.Add(new AppUser { Id = id, NormalizedEmail = id.ToUpperInvariant(), DisplayName = id });
        db.Campaigns.Add(campaign);
        db.Members.AddRange(new Member { CampaignId = campaign.Id, UserId = "owner" }, new Member { CampaignId = campaign.Id, UserId = "member" });
        db.Characters.Add(hero);
        db.CampaignCharacters.Add(new() { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        service = new(db, TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static UploadedDocument Png(int width, int height)
    {
        var bytes = TestPng.Solid(width, height, 120, 40, 200);
        return new(bytes, DocumentKinds.Png, "retrato.png", "");
    }
    async Task<int> Version() { db.ChangeTracker.Clear(); return await db.Characters.Where(c => c.Id == hero.Id).Select(c => c.PortraitVersion).SingleAsync(); }

    [Fact]
    public async Task Owner_upload_is_reduced_versioned_and_keeps_sheet_revision()
    {
        var revision = hero.Revision;
        await service.SaveAsync(hero.Id, "owner", Png(3000, 1500), default);
        Assert.Equal(1, await Version());
        var stored = await service.GetAsync(hero.Id, "owner", default);
        using (var image = new MagickImage(stored.Content))
        {
            Assert.Equal(1024u, image.Width);
            Assert.Equal(512u, image.Height);
        }
        Assert.Equal(stored.Content.LongLength, stored.Size);
        await service.SaveAsync(hero.Id, "owner", Png(200, 300), default);
        Assert.Equal(2, await Version());
        Assert.Equal(revision, (await db.Characters.SingleAsync(c => c.Id == hero.Id)).Revision);
        Assert.Equal(1, await db.Set<CharacterPortrait>().CountAsync());
        var current = await db.Set<CharacterPortrait>().SingleAsync();
        Assert.Equal(current.Size, (await AccountLimits.StorageAsync(db, "owner", default)).Portraits);
        Assert.Equal(0, (await AccountLimits.StorageAsync(db, "member", default)).Portraits);
    }

    [Fact]
    public async Task Reading_follows_sheet_visibility_and_writing_is_owner_only()
    {
        await service.SaveAsync(hero.Id, "owner", Png(100, 100), default);
        Assert.NotNull(await service.GetAsync(hero.Id, "member", default));
        Assert.NotNull(await service.GetAsync(hero.Id, "master", default));
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetAsync(hero.Id, "stranger", default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.SaveAsync(hero.Id, "master", Png(100, 100), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => service.DeleteAsync(hero.Id, "member", default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.SaveAsync(hero.Id, "stranger", Png(100, 100), default))).Status);

        await db.Characters.Where(c => c.Id == hero.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Private, true));
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetAsync(hero.Id, "member", default))).Status);
        Assert.NotNull(await service.GetAsync(hero.Id, "master", default));
    }

    [Fact]
    public async Task Removing_clears_version_and_deleting_the_sheet_cascades()
    {
        await service.SaveAsync(hero.Id, "owner", Png(100, 100), default);
        await service.DeleteAsync(hero.Id, "owner", default);
        Assert.Equal(0, await Version());
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => service.GetAsync(hero.Id, "owner", default))).Status);
        await service.SaveAsync(hero.Id, "owner", Png(100, 100), default);
        db.ChangeTracker.Clear();
        await db.CampaignCharacters.Where(l => l.CharacterId == hero.Id).ExecuteDeleteAsync();
        await db.Characters.Where(c => c.Id == hero.Id).ExecuteDeleteAsync();
        Assert.False(await db.Set<CharacterPortrait>().AnyAsync());
    }

    [Fact]
    public async Task Tiny_or_wrong_images_are_rejected_without_changing_the_version()
    {
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => service.SaveAsync(hero.Id, "owner", Png(20, 20), default))).Status);
        Assert.Equal(415, (await Assert.ThrowsAsync<RuleException>(() => service.SaveAsync(hero.Id, "owner", new UploadedDocument([1, 2, 3], DocumentKinds.Pdf, "x.pdf", ""), default))).Status);
        Assert.Equal(0, await Version());
    }
}
