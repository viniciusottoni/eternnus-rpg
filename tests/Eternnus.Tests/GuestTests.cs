using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>Convidados (ADR-114): convites só por hash, resgate limitado, estado de espectador sem dados privados e escritas restritas.</summary>
public sealed class GuestTests : IAsyncLifetime
{
    static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    SessionService sessions = null!;
    GuestService guests = null!;
    readonly ManualClock clock = new(new DateTimeOffset(2026, 11, 19, 21, 0, 0, TimeSpan.Zero));
    readonly SessionSignals signals = new();
    Campaign campaign = null!;
    Character hero = null!;
    const string Master = "master", Player = "player", Outsider = "outsider";

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var id in new[] { Master, Player, Outsider })
            db.Users.Add(new AppUser { Id = id, UserName = id, Email = id + "@exemplo.com", DisplayName = id == Master ? "Vinícius" : id });
        campaign = new Campaign { OwnerId = Master, Name = "Valdaran" };
        hero = new Character { OwnerId = Player, Name = "Tharion", Private = true, Notes = "Diário privado do herói" };
        db.AddRange(campaign, hero, new Member { CampaignId = campaign.Id, UserId = Player }, new CampaignCharacter { CampaignId = campaign.Id, CharacterId = hero.Id });
        await db.SaveChangesAsync();
        sessions = new SessionService(db, signals, clock);
        guests = new GuestService(db, signals, clock);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    async Task<Guid> StartAsync(bool fog = false)
    {
        campaign.TableSettings = (TableSettings.Default with { PlayMode = PlayModes.Free, FogEnabled = fog, MoveNeedsGrant = false }).Serialize();
        await db.SaveChangesAsync();
        var r = await sessions.StartAsync(campaign.Id, new("Sessão", "Objetivo secreto", MapKinds.Tileset, "crypt"), Master, default);
        var id = Prop<Guid>(r, "Id");
        await sessions.JoinAsync(id, hero.Id, Player, default);
        db.ChangeTracker.Clear();
        return id;
    }
    static T Prop<T>(object o, string name) => (T)o.GetType().GetProperty(name)!.GetValue(o)!;
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, Web);
    static async Task<int> Status(Func<Task> action) => (await Assert.ThrowsAsync<RuleException>(action)).Status;

    async Task<string> InviteAsync(string mode = GuestModes.Participant, int? maxUses = null, int? hours = null) =>
        Json(await guests.CreateInviteAsync(campaign.Id, new(mode, "Mesa de sábado", hours, maxUses), Master, default)).GetProperty("secret").GetString()!;

    async Task<Guid> SeatAsync(string secret, string? name = "Ana")
    {
        var r = await guests.RedeemAsync(new(secret, name), default);
        Assert.DoesNotContain(secret, r.Cookie);
        return await guests.SeatAsync(r.Cookie, default);
    }

    async Task<Guid> CreatureAsync(Guid session, string label, int x, int y, bool hidden = false, string side = "ally") =>
        Json(await sessions.AddTokenAsync(session, new(label, side, x, y, Hidden: hidden), Master, default)).GetProperty("id").GetGuid();

    [Fact]
    public async Task Invites_require_guests_enabled_by_the_master_and_store_only_a_hash()
    {
        Assert.Equal(409, await Status(() => guests.CreateInviteAsync(campaign.Id, new(GuestModes.Observer), Master, default)));
        Assert.Equal(403, await Status(() => guests.SetEnabledAsync(campaign.Id, true, Player, default)));
        Assert.Equal(404, await Status(() => guests.SetEnabledAsync(campaign.Id, true, Outsider, default)));
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        Assert.Equal(403, await Status(() => guests.CreateInviteAsync(campaign.Id, new(GuestModes.Observer), Player, default)));
        Assert.Equal(400, await Status(() => guests.CreateInviteAsync(campaign.Id, new("admin"), Master, default)));
        Assert.Equal(400, await Status(() => guests.CreateInviteAsync(campaign.Id, new(GuestModes.Observer, Hours: 73), Master, default)));
        Assert.Equal(400, await Status(() => guests.CreateInviteAsync(campaign.Id, new(GuestModes.Observer, MaxUses: 21), Master, default)));
        var created = Json(await guests.CreateInviteAsync(campaign.Id, new(GuestModes.Observer, "Primos"), Master, default));
        var secret = created.GetProperty("secret").GetString()!;
        Assert.Equal(43, secret.Length); // 32 bytes em base64url sem preenchimento
        Assert.Equal("/#/convidado/" + secret, created.GetProperty("path").GetString());
        Assert.Equal(clock.GetUtcNow().UtcDateTime.AddHours(4), created.GetProperty("expiresAt").GetDateTime());
        var invite = await db.GuestInvites.AsNoTracking().SingleAsync();
        Assert.Equal(GuestService.Hash(secret), invite.TokenHash);
        Assert.NotEqual(secret, invite.TokenHash);
        // A listagem nunca devolve segredo nem hash.
        var list = JsonSerializer.Serialize(await guests.ListAsync(campaign.Id, Master, default), Web);
        Assert.DoesNotContain(secret, list); Assert.DoesNotContain(invite.TokenHash, list);
        Assert.Contains("\"enabled\":true", list);
    }

    [Fact]
    public async Task Redeem_creates_a_seat_and_every_invalid_invite_gets_the_same_answer()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var secret = await InviteAsync(maxUses: 2);
        // Sem sessão ativa: o convite vale, mas a mesa não começou.
        Assert.Equal(409, await Status(() => guests.RedeemAsync(new(secret, "Ana"), default)));
        var id = await StartAsync();
        var seat = await SeatAsync(secret, "  ");
        var stored = await db.GuestSeats.AsNoTracking().SingleAsync(g => g.Id == seat);
        Assert.Equal("Convidado", stored.Name);
        Assert.Equal(id, stored.SessionId);
        Assert.Equal(GuestModes.Participant, stored.Mode);
        Assert.Equal(64, stored.SecretHash.Length);
        // Cookie adulterado não identifica o lugar.
        Assert.Equal(401, await Status(() => guests.SeatAsync($"{seat:N}.outro-segredo-qualquer", default)));
        Assert.Equal(401, await Status(() => guests.SeatAsync(null, default)));

        await SeatAsync(secret);
        var exhausted = await Assert.ThrowsAsync<RuleException>(() => guests.RedeemAsync(new(secret, "Bia"), default));
        Assert.Equal(404, exhausted.Status);
        Assert.Equal("Convite inválido ou expirado.", exhausted.Message);
        Assert.Equal(2, (await db.GuestInvites.AsNoTracking().SingleAsync()).Uses);
        var wrong = await Assert.ThrowsAsync<RuleException>(() => guests.RedeemAsync(new(GuestService.NewSecret(), "Bia"), default));
        Assert.Equal((404, exhausted.Message), (wrong.Status, wrong.Message));

        var revoked = await InviteAsync();
        await guests.RevokeInviteAsync(campaign.Id, (await db.GuestInvites.AsNoTracking().SingleAsync(i => i.TokenHash == GuestService.Hash(revoked))).Id, Master, default);
        Assert.Equal(404, await Status(() => guests.RedeemAsync(new(revoked, "Bia"), default)));

        var expiring = await InviteAsync(hours: 1);
        clock.Advance(TimeSpan.FromHours(2));
        Assert.Equal(404, await Status(() => guests.RedeemAsync(new(expiring, "Bia"), default)));

        var disabled = await InviteAsync();
        await guests.SetEnabledAsync(campaign.Id, false, Master, default);
        Assert.Equal(404, await Status(() => guests.RedeemAsync(new(disabled, "Bia"), default)));
    }

    [Fact]
    public async Task Guest_state_is_a_spectator_view_without_master_or_private_data()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var id = await StartAsync();
        await sessions.NoteAsync(id, new("Segredo do mestre", false), Master, default);
        await sessions.NoteAsync(id, new("Narrativa compartilhada", true), Master, default);
        await sessions.MessageAsync(id, new("Oi, mesa"), Player, default);
        await CreatureAsync(id, "Cultista escondido", 3, 8, hidden: true);
        await CreatureAsync(id, "Guarda", 2, 2);
        var seat = await SeatAsync(await InviteAsync(GuestModes.Observer), "Ana");
        var state = Json(await sessions.GuestLiveAsync(seat, 0, default));
        var json = state.GetRawText();
        foreach (var secret in new[] { "Segredo do mestre", "Objetivo secreto", "Cultista escondido", "Diário privado", "@exemplo.com", "formulaFields" })
            Assert.DoesNotContain(secret, json);
        Assert.Contains("Narrativa compartilhada", json); Assert.Contains("Oi, mesa", json); Assert.Contains("Guarda", json);
        Assert.True(state.GetProperty("me").GetProperty("guest").GetBoolean());
        Assert.Equal("observer", state.GetProperty("me").GetProperty("mode").GetString());
        Assert.Equal(JsonValueKind.Null, state.GetProperty("session").GetProperty("objective").ValueKind);
        Assert.Equal(JsonValueKind.Null, state.GetProperty("camera").ValueKind);
        // Ficha privada: o espectador vê o nome do personagem, mas não vida, nível ou resumo.
        var heroRow = state.GetProperty("participants").EnumerateArray().Single(p => p.GetProperty("characterId").ValueKind == JsonValueKind.String);
        Assert.False(heroRow.GetProperty("canView").GetBoolean());
        Assert.Equal(JsonValueKind.Null, heroRow.GetProperty("hp").ValueKind);
        // Convidados não viram participantes da sessão.
        Assert.Equal(2, await db.SessionParticipants.CountAsync(p => p.SessionId == id));
        // O mestre vê o convidado na lista; o jogador não recebe a lista.
        var master = Json(await sessions.StateAsync(id, Master, default));
        Assert.Equal("Ana", master.GetProperty("guests")[0].GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, Json(await sessions.StateAsync(id, Player, default)).GetProperty("guests").ValueKind);
    }

    [Fact]
    public async Task Fog_limits_the_guest_to_shared_light()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var id = await StartAsync(fog: true);
        await CreatureAsync(id, "Espectro", 3, 8, side: "enemy");
        await sessions.MoveTokenAsync(id, (await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Label == "Espectro")).Id, new(3, 7), Master, default);
        var seat = await SeatAsync(await InviteAsync(GuestModes.Observer));
        var state = Json(await sessions.GuestLiveAsync(seat, 0, default));
        Assert.DoesNotContain("Espectro", state.GetRawText());
        Assert.True(state.GetProperty("fog").GetProperty("active").GetBoolean());
        Assert.Contains("?", state.GetProperty("map").GetProperty("rows")[0].GetString());
    }

    [Fact]
    public async Task Observers_only_watch_and_participants_act_only_with_the_token_the_master_gave()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var id = await StartAsync();
        var observer = await SeatAsync(await InviteAsync(GuestModes.Observer));
        Assert.Equal(403, await Status(() => sessions.GuestMoveAsync(observer, new(4, 2), default)));
        Assert.Equal(403, await Status(() => sessions.GuestRollAsync(observer, new("1d20", null), default)));
        Assert.Equal(403, await Status(() => sessions.GuestMessageAsync(observer, new("oi"), default)));
        await sessions.GuestHeartbeatAsync(observer, default); // presença é permitida ao observador

        var guard = await CreatureAsync(id, "Guarda", 2, 2);
        var participant = await SeatAsync(await InviteAsync());
        // Sem marcador entregue, não há o que mover.
        Assert.Equal(409, await Status(() => sessions.GuestMoveAsync(participant, new(4, 2), default)));
        var heroToken = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.SessionId == id && t.CharacterId == hero.Id);
        // Personagem de jogador, observador ou jogador comum: nunca.
        Assert.Equal(409, await Status(() => sessions.SetGuestControlAsync(id, new(heroToken.Id, participant), Master, default)));
        Assert.Equal(409, await Status(() => sessions.SetGuestControlAsync(id, new(guard, observer), Master, default)));
        Assert.Equal(403, await Status(() => sessions.SetGuestControlAsync(id, new(guard, participant), Player, default)));

        await sessions.SetGuestControlAsync(id, new(guard, participant), Master, default);
        var state = Json(await sessions.GuestLiveAsync(participant, 0, default));
        Assert.Equal(guard, state.GetProperty("me").GetProperty("tokenId").GetGuid());
        Assert.Equal(guard, Json(await sessions.StateAsync(id, Master, default)).GetProperty("guests").EnumerateArray()
            .Single(g => g.GetProperty("seatId").GetGuid() == participant).GetProperty("tokenId").GetGuid());
        await sessions.GuestMoveAsync(participant, new(4, 2), default);
        var moved = await db.SessionTokens.AsNoTracking().SingleAsync(t => t.Id == guard);
        Assert.Equal((4, 2), (moved.X, moved.Y));
        Assert.Equal((heroToken.X, heroToken.Y), await db.SessionTokens.AsNoTracking().Where(t => t.Id == heroToken.Id).Select(t => ValueTuple.Create(t.X, t.Y)).SingleAsync());
        Assert.Equal(400, await Status(() => sessions.GuestMoveAsync(participant, new(6, 2), default))); // parede
        Assert.Equal(400, await Status(() => sessions.GuestMoveAsync(participant, new(500, 500), default))); // fora do mapa
        var roll = Json(await sessions.GuestRollAsync(participant, new("1d20+2", "Ataque"), default));
        Assert.InRange(roll.GetProperty("total").GetDouble(), 3, 22);
        Assert.Equal(400, await Status(() => sessions.GuestRollAsync(participant, new("", null), default)));
        await sessions.GuestMessageAsync(participant, new("Avante!"), default);
        Assert.Equal(400, await Status(() => sessions.GuestMessageAsync(participant, new(new string('a', 2001)), default)));
        var player = JsonSerializer.Serialize(await sessions.StateAsync(id, Player, default), Web);
        Assert.Contains("Ana (convidado) moveu Guarda", player);
        Assert.Contains("Ana (convidado) rolou Ataque", player);
        Assert.Contains("Avante!", player);

        // Pausa vale para o convidado como para o jogador.
        await db.Sessions.Where(s => s.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PausedAt, DateTime.UtcNow));
        db.ChangeTracker.Clear(); // cada requisição usa um contexto novo
        Assert.Equal(409, await Status(() => sessions.GuestMoveAsync(participant, new(5, 2), default)));
        await db.Sessions.Where(s => s.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PausedAt, (DateTime?)null));
        db.ChangeTracker.Clear();

        // Mestre retoma o marcador: o convidado deixa de movê-lo.
        await sessions.SetGuestControlAsync(id, new(guard, null), Master, default);
        Assert.Equal(409, await Status(() => sessions.GuestMoveAsync(participant, new(5, 2), default)));
    }

    [Fact]
    public async Task A_seat_controls_one_token_and_revocation_returns_it_to_the_master()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var id = await StartAsync();
        var a = await CreatureAsync(id, "Guarda", 2, 2);
        var b = await CreatureAsync(id, "Batedor", 3, 2);
        var seat = await SeatAsync(await InviteAsync());
        await sessions.SetGuestControlAsync(id, new(a, seat), Master, default);
        await sessions.SetGuestControlAsync(id, new(b, seat), Master, default);
        Assert.Equal([b], await db.SessionTokens.AsNoTracking().Where(t => t.GuestSeatId == seat).Select(t => t.Id).ToListAsync());
        var revision = await db.Sessions.Where(s => s.Id == id).Select(s => s.Revision).SingleAsync();
        await guests.RevokeSeatAsync(campaign.Id, seat, Master, default);
        db.ChangeTracker.Clear(); // cada requisição usa um contexto novo
        Assert.True(await db.Sessions.Where(s => s.Id == id).Select(s => s.Revision).SingleAsync() > revision);
        Assert.False(await db.SessionTokens.AnyAsync(t => t.GuestSeatId != null));
        Assert.Equal(401, await Status(() => sessions.GuestLiveAsync(seat, 0, default)));
        Assert.Equal(401, await Status(() => sessions.GuestMoveAsync(seat, new(5, 2), default)));
        Assert.Equal(404, await Status(() => guests.RevokeSeatAsync(campaign.Id, Guid.NewGuid(), Master, default)));
    }

    [Fact]
    public async Task Ending_the_session_disabling_guests_or_leaving_cuts_access()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var id = await StartAsync();
        var guard = await CreatureAsync(id, "Guarda", 2, 2);
        var leaving = await SeatAsync(await InviteAsync());
        await sessions.GuestLeaveAsync(leaving, default);
        Assert.Equal(401, await Status(() => sessions.GuestLiveAsync(leaving, 0, default)));

        var seat = await SeatAsync(await InviteAsync());
        await sessions.SetGuestControlAsync(id, new(guard, seat), Master, default);
        var pending = await InviteAsync();
        await guests.SetEnabledAsync(campaign.Id, false, Master, default);
        db.ChangeTracker.Clear();
        Assert.Equal(401, await Status(() => sessions.GuestLiveAsync(seat, 0, default)));
        Assert.False(await db.SessionTokens.AnyAsync(t => t.GuestSeatId != null));
        Assert.True(await db.GuestInvites.AllAsync(i => i.RevokedAt != null));
        Assert.True(await db.GuestSeats.AllAsync(g => g.RevokedAt != null));
        // Reabilitar não ressuscita convites nem lugares revogados.
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        Assert.Equal(404, await Status(() => guests.RedeemAsync(new(pending, "Bia"), default)));

        var last = await SeatAsync(await InviteAsync());
        await sessions.GuestLiveAsync(last, 0, default);
        await sessions.EndAsync(id, Master, default);
        Assert.Equal(401, await Status(() => sessions.GuestLiveAsync(last, 0, default)));
        Assert.Equal(401, await Status(() => sessions.GuestMessageAsync(last, new("ainda aqui?"), default)));
    }

    [Fact]
    public async Task A_seat_never_reaches_another_campaign()
    {
        await guests.SetEnabledAsync(campaign.Id, true, Master, default);
        var id = await StartAsync();
        var seat = await SeatAsync(await InviteAsync());
        var other = new Campaign { OwnerId = Outsider, Name = "Outra mesa", GuestsEnabled = true };
        db.Add(other); await db.SaveChangesAsync();
        var otherSession = Prop<Guid>(await sessions.StartAsync(other.Id, new("Outra", "", MapKinds.Tileset, "crypt"), Outsider, default), "Id");
        var otherToken = Json(await sessions.AddTokenAsync(otherSession, new("Lobo", "ally", 2, 2), Outsider, default)).GetProperty("id").GetGuid();
        // O mestre da outra campanha não entrega marcador a um lugar que não é dele.
        Assert.Equal(404, await Status(() => sessions.SetGuestControlAsync(otherSession, new(otherToken, seat), Outsider, default)));
        Assert.Equal(404, await Status(() => guests.RevokeSeatAsync(other.Id, seat, Outsider, default)));
        Assert.Equal(id, Json(await sessions.GuestLiveAsync(seat, 0, default)).GetProperty("session").GetProperty("id").GetGuid());
        // Nem o mestre desta campanha mexe no lugar pela outra.
        Assert.Equal(404, await Status(() => guests.ListAsync(other.Id, Master, default)));
    }

    sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
}
