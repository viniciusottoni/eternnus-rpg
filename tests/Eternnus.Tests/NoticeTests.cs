using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Indicadores de novidade (ADR-069): público de cada aviso, leitura sem escrita, "visto" só do próprio usuário.</summary>
public sealed class NoticeTests : IAsyncLifetime
{
    sealed class NoXp(GameDb db, AuditService audit) : ProgressionService(db, audit)
    {
        public override Task AwardAsync(string userId, string reason, string sourceKey, CancellationToken ct = default) => Task.CompletedTask;
        public override Task RequireLevelAsync(string userId, string feature, CancellationToken ct = default) => Task.CompletedTask;
    }
    static readonly Guid Taverna = Guid.Parse("00000000-0000-4000-8000-000000000202");
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    NoticeService notices = null!;
    WorkspaceService workspace = null!;
    GuildService guild = null!;
    readonly Campaign campaign = new() { OwnerId = "master", Name = "Novidades" };

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var created = DateTime.UtcNow.AddMinutes(-5);
        foreach (var (id, role) in new[] { ("master", PlatformRoles.Common), ("player", PlatformRoles.Common), ("other", PlatformRoles.Common), ("outsider", PlatformRoles.Common), ("staff", PlatformRoles.Ambassador) })
            db.Users.Add(new AppUser { Id = id, UserName = id, NormalizedEmail = id.ToUpperInvariant(), EmailConfirmed = true, DisplayName = id, Role = role, Level = 3, CreatedAt = created });
        db.AddRange(campaign, new Member { CampaignId = campaign.Id, UserId = "player" }, new Member { CampaignId = campaign.Id, UserId = "other" });
        await db.SaveChangesAsync();
        notices = new NoticeService(db, TimeProvider.System);
        workspace = new WorkspaceService(db);
        var audit = new AuditService(db);
        guild = new GuildService(db, audit, new NoXp(db, audit));
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    async Task<JsonElement> SummaryAsync(string user) => Json(await notices.SummaryAsync(user, default));
    async Task<JsonElement> CampaignAsync(string user) => Json(await notices.CampaignAsync(campaign.Id, user, default));
    static int Area(JsonElement news, string area) => news.GetProperty("areas").TryGetProperty(area, out var n) ? n.GetInt32() : 0;

    [Fact]
    public async Task Table_notice_reaches_players_but_not_the_master_and_area_view_clears_it()
    {
        await NoticeService.NotifyAsync(db, campaign.Id, "master", NoticeAreas.Table, Guid.NewGuid().ToString(), NoticeAudience.Players, default);
        await db.SaveChangesAsync();
        var player = await SummaryAsync("player");
        Assert.Equal(1, player.GetProperty("home").GetInt32());
        Assert.Equal(1, player.GetProperty("campaigns").GetInt32());
        Assert.Equal(1, player.GetProperty("byCampaign").GetProperty(campaign.Id.ToString()).GetInt32());
        Assert.Equal(0, (await SummaryAsync("master")).GetProperty("campaigns").GetInt32());
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => notices.CampaignAsync(campaign.Id, "outsider", default))).Status);

        // Ver a seção apaga só o que já tinha sido mostrado (asOf), nunca o publicado depois.
        var asOf = (await CampaignAsync("player")).GetProperty("asOf").GetDateTime();
        db.Add(new Notice { UserId = "player", CampaignId = campaign.Id, Area = NoticeAreas.Table, ItemKey = Guid.NewGuid().ToString(), CreatedAt = asOf.AddTicks(10) });
        await db.SaveChangesAsync();
        await notices.SeenAsync(new("campaign", CampaignId: campaign.Id, Areas: [NoticeAreas.Table], AsOf: asOf), "player", default);
        Assert.Equal(1, Area(await CampaignAsync("player"), NoticeAreas.Table));
        await Task.Delay(5);
        await notices.SeenAsync(new("home"), "player", default);
        Assert.Equal(0, (await SummaryAsync("player")).GetProperty("home").GetInt32());
    }

    [Fact]
    public async Task Shared_pages_notify_only_their_readers_and_unsharing_forgets_the_notice()
    {
        var page = await workspace.Save(campaign.Id, null, "master", new("Mapa do porto", "x", "place", "selected", Recipients: ["player"]), default);
        Assert.Equal(1, Area(await CampaignAsync("player"), NoticeAreas.Pages));
        Assert.Equal(0, Area(await CampaignAsync("other"), NoticeAreas.Pages));
        page = await workspace.Save(campaign.Id, page.Id, "master", new("Mapa do porto", "x", "place", "table", Revision: page.Revision), default);
        Assert.Equal(1, Area(await CampaignAsync("other"), NoticeAreas.Pages));
        Assert.Equal(1, Area(await CampaignAsync("player"), NoticeAreas.Pages)); // sem duplicar o mesmo item
        Assert.Equal(0, Area(await CampaignAsync("master"), NoticeAreas.Pages));
        await workspace.Save(campaign.Id, page.Id, "master", new("Mapa do porto", "x", "place", "self", Revision: page.Revision), default);
        Assert.Equal(0, Area(await CampaignAsync("player"), NoticeAreas.Pages));

        // Pista compartilhada vai para o Diário; ver o item apaga só ele.
        var clue = await workspace.Save(campaign.Id, null, "master", new("Pegada", "x", "clue", "table"), default);
        Assert.Equal(1, Area(await CampaignAsync("player"), NoticeAreas.Journal));
        await notices.SeenAsync(new("campaign", CampaignId: campaign.Id, Item: clue.Id.ToString()), "player", default);
        Assert.Equal(0, Area(await CampaignAsync("player"), NoticeAreas.Journal));
        Assert.Equal(1, Area(await CampaignAsync("other"), NoticeAreas.Journal));
    }

    [Fact]
    public async Task Published_past_sessions_and_chapters_notify_players_once()
    {
        var past = await workspace.SavePast(campaign.Id, null, "master", new(1, "Prólogo", "Resumo", Published: false), default);
        Assert.Equal(0, Area(await CampaignAsync("player"), NoticeAreas.Journal));
        past = await workspace.SavePast(campaign.Id, past.Id, "master", new(1, "Prólogo", "Resumo", Published: true, Revision: past.Revision), default);
        await workspace.SaveChapter(campaign.Id, null, "master", new("Ato I", Published: true), default);
        var news = await CampaignAsync("player");
        Assert.Equal(2, Area(news, NoticeAreas.Journal));
        Assert.Contains(news.GetProperty("items").EnumerateArray(), i => i.GetProperty("key").GetString() == $"past-{past.Id}");
        await workspace.SavePast(campaign.Id, past.Id, "master", new(1, "Prólogo", "Resumo", Published: false, Revision: past.Revision), default);
        Assert.Equal(1, Area(await CampaignAsync("player"), NoticeAreas.Journal));
    }

    [Fact]
    public async Task Guild_topics_are_unread_for_others_until_opened_and_own_replies_stay_read()
    {
        var topic = (Guid)Json(await guild.CreateTopicAsync(new(Taverna, "Procuro mesa de terror", "Alguém joga?"), "other", default)).GetProperty("id").Deserialize<Guid>();
        var player = await SummaryAsync("player");
        Assert.Equal(1, player.GetProperty("guild").GetInt32());
        Assert.Equal(1, player.GetProperty("guildCategories").GetProperty("taverna").GetInt32());
        Assert.Equal(0, (await SummaryAsync("other")).GetProperty("guild").GetInt32());

        await guild.ReplyAsync(topic, new("Eu jogo!"), "player", default);
        Assert.Equal(0, (await SummaryAsync("player")).GetProperty("guild").GetInt32());
        Assert.Equal(1, (await SummaryAsync("other")).GetProperty("guild").GetInt32());

        var lastPostAt = await db.GuildTopics.Where(t => t.Id == topic).Select(t => t.LastPostAt).SingleAsync();
        var read = Json(await notices.GuildTopicAsync(topic, "other", default)).GetProperty("lastReadAt").GetDateTime();
        Assert.True(read < lastPostAt); // a resposta nova fica destacada para "other"
        await notices.SeenAsync(new(ReadScopes.GuildTopic, Id: topic, AsOf: lastPostAt), "other", default);
        Assert.Equal(0, (await SummaryAsync("other")).GetProperty("guild").GetInt32());

        await guild.ReplyAsync(topic, new("Eu também"), "staff", default);
        Assert.Equal(1, (await SummaryAsync("other")).GetProperty("guild").GetInt32());
        await notices.SeenAsync(new(ReadScopes.Guild), "other", default);
        Assert.Equal(0, (await SummaryAsync("other")).GetProperty("guild").GetInt32());
    }

    [Fact]
    public async Task Seen_rejects_unknown_scopes_and_staff_only_marks()
    {
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => notices.SeenAsync(new("everything"), "player", default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => notices.SeenAsync(new("campaign", CampaignId: campaign.Id, Areas: ["secret"]), "player", default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => notices.SeenAsync(new(ReadScopes.Moderation), "player", default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<RuleException>(() => notices.SeenAsync(new(ReadScopes.SupportQueue), "staff", default))).Status);
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => notices.SeenAsync(new(ReadScopes.GuildTopic, Id: Guid.NewGuid()), "player", default))).Status);
        await notices.SeenAsync(new(ReadScopes.Moderation), "staff", default);
        await notices.SeenAsync(new(ReadScopes.Moderation), "staff", default); // repetir só avança a marca
        Assert.Single(await db.Set<ReadMark>().Where(m => m.UserId == "staff" && m.Scope == ReadScopes.Moderation).ToListAsync());
    }

    [Fact]
    public async Task Achievements_unlocked_after_the_last_visit_are_new()
    {
        db.Achievements.Add(new UserAchievement { UserId = "player", Key = "first_campaign", UnlockedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var summary = await SummaryAsync("player");
        Assert.Equal(1, summary.GetProperty("progress").GetInt32());
        Assert.Equal("first_campaign", summary.GetProperty("achievements")[0].GetString());
        await notices.SeenAsync(new(ReadScopes.Progress), "player", default);
        Assert.Equal(0, (await SummaryAsync("player")).GetProperty("progress").GetInt32());
    }
}
