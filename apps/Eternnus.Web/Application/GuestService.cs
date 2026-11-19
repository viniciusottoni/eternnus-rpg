using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record GuestsEnabledInput(bool Enabled);
/// <summary>Novo convite: modo, rótulo opcional, validade em horas (1–72, padrão 4) e usos (1–20, padrão 1).</summary>
public record GuestInviteInput(string? Mode, string? Label = null, int? Hours = null, int? MaxUses = null);
public record GuestRedeemInput(string? Secret, string? Name);
/// <summary>Resultado do resgate. <see cref="Cookie"/> vai só para o cookie HttpOnly, nunca para o corpo da resposta.</summary>
public sealed record GuestRedeemed(Guid SessionId, string Mode, string Name, string Cookie, DateTime ExpiresAt);

/// <summary>
/// Convites e lugares de convidados (ADR-114). Autenticação própria por cookie HttpOnly; nunca contorna "Verified".
/// Convites e lugares guardam só o SHA-256 dos segredos. Revogar convite/lugar, desabilitar convidados, encerrar a sessão
/// ou o fim do prazo cortam o acesso; o controle de marcadores volta ao mestre na mesma transação.
/// Ordem de bloqueio comum: sessão ativa → campanha.
/// </summary>
public sealed class GuestService(GameDb db, SessionSignals signals, TimeProvider clock)
{
    public const string CookieName = "eternnus_guest";
    public const int MaxActiveInvites = 20, ListLimit = 50;
    DateTime Now => clock.GetUtcNow().UtcDateTime;

    static RuleException Invalid() => new(404, "Convite inválido ou expirado.");
    static RuleException Ended() => new(401, "Acesso de convidado encerrado.");

    /// <summary>32 bytes aleatórios em base64url sem preenchimento.</summary>
    public static string NewSecret() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
    public static string Hash(string secret) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    // ---------- Mestre ----------
    async Task<Campaign> OwnedAsync(Guid campaignId, string user, bool lockRow, CancellationToken ct)
    {
        var c = !lockRow ? await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(x => x.Id == campaignId, ct)
            : db.Database.IsNpgsql() ? await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaignId} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Campaigns.SingleOrDefaultAsync(x => x.Id == campaignId, ct);
        if (c == null || c.OwnerId != user)
        {
            if (c != null && await db.Members.AnyAsync(m => m.CampaignId == campaignId && m.UserId == user, ct)) throw new RuleException(403, "Somente o mestre gerencia convidados.");
            throw new RuleException(404, "Campanha não encontrada.");
        }
        OneShotLifecycleService.EnsureOpen(c, Now);
        return c;
    }

    static void Writable(Campaign c)
    {
        if (c.ArchivedAt != null) throw new RuleException(409, "Esta campanha está arquivada. Restaure-a para voltar a jogar.");
    }

    async Task<GameSession?> LockActiveSessionAsync(Guid campaignId, CancellationToken ct) => db.Database.IsNpgsql()
        ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {campaignId} AND \"EndedAt\" IS NULL FOR UPDATE").SingleOrDefaultAsync(ct)
        : await db.Sessions.SingleOrDefaultAsync(s => s.CampaignId == campaignId && s.EndedAt == null, ct);

    /// <summary>Revoga lugares ainda ativos e devolve ao mestre os marcadores que eles controlavam.</summary>
    async Task<int> RevokeSeatsAsync(IQueryable<GuestSeat> seats, DateTime now, CancellationToken ct)
    {
        var ids = await seats.Where(g => g.RevokedAt == null).Select(g => g.Id).ToListAsync(ct);
        if (ids.Count == 0) return 0;
        await db.SessionTokens.Where(t => t.GuestSeatId != null && ids.Contains(t.GuestSeatId.Value)).ExecuteUpdateAsync(t => t.SetProperty(v => v.GuestSeatId, (Guid?)null), ct);
        await db.GuestSeats.Where(g => ids.Contains(g.Id)).ExecuteUpdateAsync(g => g.SetProperty(v => v.RevokedAt, (DateTime?)now), ct);
        return ids.Count;
    }

    /// <summary>Grava e, havendo sessão ativa, avisa a mesa (revisão + sinal depois do commit).</summary>
    async Task CommitAsync(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, GameSession? active, CancellationToken ct)
    {
        if (active != null) active.Revision++;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        if (active != null) signals.Pulse(active.Id);
    }

    public async Task<object> SetEnabledAsync(Guid campaignId, bool enabled, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var active = await LockActiveSessionAsync(campaignId, ct);
        var c = await OwnedAsync(campaignId, user, true, ct);
        if (c.GuestsEnabled == enabled) { await tx.RollbackAsync(ct); return new { enabled }; }
        // Desabilitar vale até em campanha arquivada (só corta acessos); habilitar exige campanha em uso.
        if (enabled) Writable(c);
        c.GuestsEnabled = enabled;
        if (!enabled)
        {
            var now = Now;
            await db.GuestInvites.Where(i => i.CampaignId == campaignId && i.RevokedAt == null).ExecuteUpdateAsync(i => i.SetProperty(v => v.RevokedAt, (DateTime?)now), ct);
            await RevokeSeatsAsync(db.GuestSeats.Where(g => g.CampaignId == campaignId), now, ct);
        }
        await CommitAsync(tx, active, ct);
        return new { enabled };
    }

    public async Task<object> ListAsync(Guid campaignId, string user, CancellationToken ct)
    {
        var c = await OwnedAsync(campaignId, user, false, ct);
        var now = Now;
        var invites = await db.GuestInvites.AsNoTracking().Where(i => i.CampaignId == campaignId).OrderByDescending(i => i.CreatedAt).Take(ListLimit)
            .Select(i => new { i.Id, i.Mode, i.Label, i.CreatedAt, i.ExpiresAt, i.RevokedAt, i.MaxUses, i.Uses }).ToListAsync(ct);
        var seats = await db.GuestSeats.AsNoTracking().Where(g => g.CampaignId == campaignId).OrderByDescending(g => g.CreatedAt).Take(ListLimit)
            .Select(g => new
            {
                g.Id, g.Name, g.Mode, g.SessionId, g.CreatedAt, g.LastSeenAt, g.RevokedAt,
                token = db.SessionTokens.Where(t => t.GuestSeatId == g.Id).Select(t => new { t.Id, t.Label }).FirstOrDefault(),
            }).ToListAsync(ct);
        return new
        {
            enabled = c.GuestsEnabled,
            invites = invites.Select(i => new
            {
                id = i.Id, mode = i.Mode, label = i.Label, createdAt = i.CreatedAt, expiresAt = i.ExpiresAt, revokedAt = i.RevokedAt, maxUses = i.MaxUses, uses = i.Uses,
                active = i.RevokedAt == null && i.ExpiresAt > now && i.Uses < i.MaxUses,
            }),
            seats = seats.Select(g => new
            {
                id = g.Id, name = g.Name, mode = g.Mode, sessionId = g.SessionId, createdAt = g.CreatedAt, lastSeenAt = g.LastSeenAt,
                online = g.RevokedAt == null && TableRules.IsOnline(g.LastSeenAt, now), revokedAt = g.RevokedAt, tokenId = g.token?.Id, tokenLabel = g.token?.Label,
            }),
        };
    }

    /// <summary>Cria o convite. O segredo em claro sai só nesta resposta; o banco guarda o SHA-256.</summary>
    public async Task<object> CreateInviteAsync(Guid campaignId, GuestInviteInput x, string user, CancellationToken ct)
    {
        if (!GuestModes.IsValid(x.Mode)) throw new RuleException(400, "Escolha convidado observador ou participante.");
        var label = LibraryService.Clean(x.Label ?? "", false).Trim();
        if (label.Length > 40) throw new RuleException(400, "O rótulo do convite aceita até 40 caracteres.");
        var hours = x.Hours ?? 4;
        if (hours is < 1 or > 72) throw new RuleException(400, "O convite vale de 1 a 72 horas.");
        var maxUses = x.MaxUses ?? 1;
        if (maxUses is < 1 or > 20) throw new RuleException(400, "O convite aceita de 1 a 20 usos.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var c = await OwnedAsync(campaignId, user, true, ct);
        Writable(c);
        if (!c.GuestsEnabled) throw new RuleException(409, "Habilite convidados nesta campanha antes de convidar.");
        var now = Now;
        if (await db.GuestInvites.CountAsync(i => i.CampaignId == campaignId && i.RevokedAt == null && i.ExpiresAt > now && i.Uses < i.MaxUses, ct) >= MaxActiveInvites)
            throw new RuleException(409, $"Limite de {MaxActiveInvites} convites ativos por campanha. Revogue um convite antes de criar outro.");
        var secret = NewSecret();
        var invite = new GuestInvite
        {
            CampaignId = campaignId, Mode = x.Mode!, Label = label, TokenHash = Hash(secret), CreatedBy = user, CreatedAt = now, ExpiresAt = now.AddHours(hours), MaxUses = maxUses,
        };
        db.GuestInvites.Add(invite);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new { id = invite.Id, mode = invite.Mode, label = invite.Label, expiresAt = invite.ExpiresAt, maxUses = invite.MaxUses, uses = invite.Uses, secret, path = "/#/convidado/" + secret };
    }

    public async Task RevokeInviteAsync(Guid campaignId, Guid inviteId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var active = await LockActiveSessionAsync(campaignId, ct);
        await OwnedAsync(campaignId, user, true, ct);
        var invite = await db.GuestInvites.SingleOrDefaultAsync(i => i.Id == inviteId && i.CampaignId == campaignId, ct) ?? throw new RuleException(404, "Convite não encontrado.");
        var now = Now;
        invite.RevokedAt ??= now;
        await RevokeSeatsAsync(db.GuestSeats.Where(g => g.InviteId == inviteId), now, ct);
        await CommitAsync(tx, active, ct);
    }

    public async Task RevokeSeatAsync(Guid campaignId, Guid seatId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var active = await LockActiveSessionAsync(campaignId, ct);
        await OwnedAsync(campaignId, user, true, ct);
        if (!await db.GuestSeats.AnyAsync(g => g.Id == seatId && g.CampaignId == campaignId, ct)) throw new RuleException(404, "Convidado não encontrado.");
        await RevokeSeatsAsync(db.GuestSeats.Where(g => g.Id == seatId), Now, ct);
        await CommitAsync(tx, active, ct);
    }

    // ---------- Convidado ----------
    /// <summary>
    /// Troca o segredo do convite por um lugar na sessão ativa. Qualquer motivo de recusa do convite responde o mesmo 404
    /// (sem oráculo). O uso é consumido por atualização condicional: resgates simultâneos não passam de <c>MaxUses</c>.
    /// </summary>
    public async Task<GuestRedeemed> RedeemAsync(GuestRedeemInput x, CancellationToken ct)
    {
        var secret = (x.Secret ?? "").Trim();
        if (secret.Length is < 20 or > 100) throw Invalid();
        var name = LibraryService.Clean(x.Name ?? "", false).Trim();
        if (name.Length == 0) name = "Convidado";
        if (name.Length > 40) throw new RuleException(400, "O nome aceita até 40 caracteres.");
        var hash = Hash(secret);
        var now = Now;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var invite = await db.GuestInvites.AsNoTracking().SingleOrDefaultAsync(i => i.TokenHash == hash, ct);
        if (invite == null || invite.RevokedAt != null || invite.ExpiresAt <= now || invite.Uses >= invite.MaxUses) throw Invalid();
        var campaign = await db.Campaigns.AsNoTracking().SingleOrDefaultAsync(c => c.Id == invite.CampaignId, ct);
        if (campaign == null || !campaign.GuestsEnabled || campaign.ArchivedAt != null || OneShotLifecycleService.Expired(campaign, now)) throw Invalid();
        var session = await LockActiveSessionAsync(campaign.Id, ct) ?? throw new RuleException(409, "A mesa ainda não começou. Tente de novo quando o mestre abrir a sessão.");
        // Depois do bloqueio da sessão (mesma ordem de quem desabilita/revoga): consome um uso só se o convite ainda vale.
        var claimed = await db.GuestInvites.Where(i => i.Id == invite.Id && i.RevokedAt == null && i.ExpiresAt > now && i.Uses < i.MaxUses)
            .ExecuteUpdateAsync(i => i.SetProperty(v => v.Uses, v => v.Uses + 1), ct);
        if (claimed == 0 || !await db.Campaigns.AnyAsync(c => c.Id == campaign.Id && c.GuestsEnabled && c.ArchivedAt == null, ct)) throw Invalid();
        var seatSecret = NewSecret();
        var seat = new GuestSeat
        {
            InviteId = invite.Id, CampaignId = campaign.Id, SessionId = session.Id, Name = name, Mode = invite.Mode, SecretHash = Hash(seatSecret), CreatedAt = now, LastSeenAt = now,
        };
        db.GuestSeats.Add(seat);
        await CommitAsync(tx, session, ct);
        return new GuestRedeemed(session.Id, seat.Mode, seat.Name, $"{seat.Id:N}.{seatSecret}", invite.ExpiresAt);
    }

    /// <summary>
    /// Lê o cookie <c>{lugar:N}.{segredo}</c> e confere o hash em tempo constante. Só identifica o lugar: o estado do convite,
    /// da campanha e da sessão é conferido por <see cref="SessionService"/> a cada operação.
    /// </summary>
    public async Task<Guid> SeatAsync(string? cookie, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(cookie) || cookie.Length > 200) throw Ended();
        var dot = cookie.IndexOf('.');
        if (dot != 32 || !Guid.TryParseExact(cookie[..dot], "N", out var seatId)) throw Ended();
        var stored = await db.GuestSeats.AsNoTracking().Where(g => g.Id == seatId).Select(g => g.SecretHash).SingleOrDefaultAsync(ct);
        if (stored == null || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(cookie[(dot + 1)..])), Encoding.ASCII.GetBytes(stored))) throw Ended();
        return seatId;
    }
}
