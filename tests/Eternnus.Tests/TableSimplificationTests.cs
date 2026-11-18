using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>ADR-100 na mesa: colocar o grupo, desfazer marcadores e névoa, trocar/remover a ficha do NPC.</summary>
public sealed class TableSimplificationTests : IAsyncLifetime
{
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService service = null!;
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player";
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    sealed class ManualClock(DateTimeOffset start) : TimeProvider { public override DateTimeOffset GetUtcNow() => start; }

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player }) db.Users.Add(new AppUser { Id = id, UserName = id, DisplayName = id });
        campaign = new Campaign { OwnerId = Master, Name = "Cripta" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Movement = 9 };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        service = new SessionService(db, new SessionSignals(), new ManualClock(new DateTimeOffset(2026, 11, 18, 21, 0, 0, TimeSpan.Zero)));
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    async Task<Guid> StartAsync()
    {
        var result = await service.StartAsync(campaign.Id, new("", "", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)result.GetType().GetProperty("Id")!.GetValue(result)!;
        await service.JoinAsync(id, null, Player, default);
        return id;
    }
    async Task<TableEvent> LastEvent(Guid id, string kind) => await db.Events.AsNoTracking().Where(e => e.SessionId == id && e.Kind == kind).OrderByDescending(e => e.Id).FirstAsync();
    async Task<Guid> AddAsync(Guid id, string label, int x, int y) =>
        JsonSerializer.SerializeToElement(await service.AddTokenAsync(id, new(label, "enemy", x, y), Master, default), Web).GetProperty("id").GetGuid();

    [Fact]
    public async Task Gather_party_moves_characters_to_the_entry_and_each_move_can_be_undone()
    {
        var id = await StartAsync();
        var token = await db.SessionTokens.SingleAsync(t => t.SessionId == id && t.CharacterId == hero.Id);
        var (entryX, entryY) = (token.X, token.Y);
        await service.MoveTokenAsync(id, token.Id, new(3, 8), Master, default);
        var result = JsonSerializer.SerializeToElement(await service.GatherPartyAsync(id, Master, default), Web);
        Assert.Equal(1, result.GetProperty("moved").GetInt32());
        db.ChangeTracker.Clear();
        token = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Id == token.Id);
        Assert.Equal((entryX, entryY), (token.X, token.Y));
        var move = await LastEvent(id, EventKinds.Move);
        await service.UndoAsync(id, new(move.Id), Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal((3, 8), await db.SessionTokens.AsNoTracking().Where(t => t.Id == token.Id).Select(t => new ValueTuple<int, int>(t.X, t.Y)).SingleAsync());
        await Assert.ThrowsAsync<RuleException>(() => service.GatherPartyAsync(id, Player, default));
    }

    [Fact]
    public async Task Gather_party_without_players_is_a_clear_conflict()
    {
        var result = await service.StartAsync(campaign.Id, new("", "", MapKinds.Tileset, "crypt"), Master, default);
        var id = (Guid)result.GetType().GetProperty("Id")!.GetValue(result)!;
        var error = await Assert.ThrowsAsync<RuleException>(() => service.GatherPartyAsync(id, Master, default));
        Assert.Equal(409, error.Status);
    }

    [Fact]
    public async Task Added_marker_can_be_undone_only_while_it_stays_in_place()
    {
        var id = await StartAsync();
        var ogre = await AddAsync(id, "Ogro", 3, 8);
        var added = await LastEvent(id, EventKinds.Token);
        await Assert.ThrowsAsync<RuleException>(() => service.UndoAsync(id, new(added.Id), Player, default));
        await service.MoveTokenAsync(id, ogre, new(4, 8), Master, default);
        await Assert.ThrowsAsync<RuleException>(() => service.UndoAsync(id, new(added.Id), Master, default));
        var wolf = await AddAsync(id, "Lobo", 5, 8);
        var wolfAdded = await LastEvent(id, EventKinds.Token);
        await service.UndoAsync(id, new(wolfAdded.Id), Master, default);
        db.ChangeTracker.Clear();
        Assert.False(await db.SessionTokens.AnyAsync(t => t.Id == wolf));
        Assert.True(await db.SessionTokens.AnyAsync(t => t.Id == ogre));
    }

    [Fact]
    public async Task Removed_marker_comes_back_with_its_settings_and_players_never_get_the_snapshot()
    {
        var id = await StartAsync();
        var ogre = await AddAsync(id, "Ogro", 3, 8);
        await service.TokenSettingsAsync(id, ogre, new(2, 3, null, null, false, 15, "faro", 4), Master, default);
        await service.RemoveTokenAsync(id, ogre, Master, default);
        var removed = await db.Events.AsNoTracking().Where(e => e.SessionId == id && e.Kind == EventKinds.Token && e.MasterOnly && e.Data.Contains("snapshot")).SingleAsync();
        // Marcador visível ao grupo? Jogadores recebem uma cópia sem o retrato; segredo (DC/sentido) nunca sai do evento privado.
        Assert.DoesNotContain(await db.Events.AsNoTracking().Where(e => e.SessionId == id && !e.MasterOnly).Select(e => e.Data).ToListAsync(), d => d.Contains("snapshot"));
        await service.UndoAsync(id, new(removed.Id), Master, default);
        db.ChangeTracker.Clear();
        var back = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Id == ogre);
        Assert.Equal(("Ogro", 3, 8, 2, 3, 15, "faro"), (back.Label, back.X, back.Y, back.Light, back.Vision, back.Dc, back.DetectSense));
        await Assert.ThrowsAsync<RuleException>(() => service.UndoAsync(id, new(removed.Id), Master, default));
    }

    [Fact]
    public async Task Fog_reveal_is_undone_cell_by_cell_and_refuses_after_a_later_change()
    {
        var id = await StartAsync();
        await service.ResetExplorationAsync(id, Master, default);
        await service.PaintFogAsync(id, new("reveal", [new(2, 2), new(3, 2), new(5, 5)]), Master, default);
        var paint = await LastEvent(id, EventKinds.Map);
        Assert.True(paint.MasterOnly);
        Assert.Contains("\"undoable\":true", paint.Data);
        await service.PaintFogAsync(id, new("conceal", [new(5, 5)]), Master, default);
        await Assert.ThrowsAsync<RuleException>(() => service.UndoAsync(id, new(paint.Id), Master, default));
        await service.UndoAsync(id, new((await LastEvent(id, EventKinds.Map)).Id), Master, default);
        await service.UndoAsync(id, new(paint.Id), Master, default);
        var fog = JsonDocument.Parse(JsonSerializer.Serialize(await service.StateAsync(id, Master, default))).RootElement.GetProperty("fog");
        Assert.Equal("", fog.GetProperty("revealed").GetString());
    }

    [Fact]
    public async Task Npc_sheet_can_be_unlinked_and_stays_in_preparation()
    {
        var id = await StartAsync();
        var npc = new MasterCharacter { CampaignId = campaign.Id, Name = "Ogro" };
        db.Add(npc); await db.SaveChangesAsync();
        var ogre = await AddAsync(id, "Ogro", 3, 8);
        var tracked = await db.SessionTokens.SingleAsync(t => t.Id == ogre);
        tracked.MasterCharacterId = npc.Id; await db.SaveChangesAsync();
        await service.TokenSettingsAsync(id, ogre, new(null, null, null, null, false, null, null, null, UnlinkSheet: true), Master, default);
        db.ChangeTracker.Clear();
        Assert.Null((await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Id == ogre)).MasterCharacterId);
        Assert.True(await db.MasterCharacters.AnyAsync(m => m.Id == npc.Id));
        Assert.Contains("desvinculou", (await LastEvent(id, EventKinds.Token)).Content);
        // Personagem de jogador não tem ficha "desvinculável" pela mesa.
        var heroToken = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.CharacterId == hero.Id);
        await Assert.ThrowsAsync<RuleException>(() => service.TokenSettingsAsync(id, heroToken.Id, new(null, null, null, null, false, null, null, null, UnlinkSheet: true), Master, default));
    }

    [Fact]
    public void Ranges_round_trip_and_reject_out_of_map_indices()
    {
        Assert.Equal("1-3,7,9-10", FogEdits.Ranges([1, 2, 3, 7, 9, 10]));
        Assert.Equal([1, 2, 3, 7, 9, 10], FogEdits.ParseRanges("1-3,7,9-10", 11));
        Assert.Throws<RuleException>(() => FogEdits.ParseRanges("9-11", 11));
        Assert.Throws<RuleException>(() => FogEdits.ParseRanges("-1", 11));
        Assert.Throws<RuleException>(() => FogEdits.ParseRanges("3-1", 11));
    }
}
