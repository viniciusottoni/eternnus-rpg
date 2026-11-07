using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Transporte de sinalização WebRTC, sem armazenar imagens nem estado autoritativo da mesa.</summary>
public sealed class TemporaryImageRelay(IServiceScopeFactory scopes)
{
    sealed record Peer(Guid Id, Guid Session, string User, string? Stamp, bool Mfa, WebSocket Socket)
    {
        public SemaphoreSlim SendLock { get; } = new(1);
    }
    readonly ConcurrentDictionary<Guid, Peer> peers = new();
    readonly object quotaLock = new();
    readonly Dictionary<string, int> reservedByUser = new(StringComparer.Ordinal);

    bool Reserve(string user)
    {
        lock (quotaLock)
        {
            var count = reservedByUser.GetValueOrDefault(user);
            if (count >= 2) return false;
            reservedByUser[user] = count + 1;
            return true;
        }
    }
    void Release(string user)
    {
        lock (quotaLock)
        {
            var remaining = reservedByUser.GetValueOrDefault(user) - 1;
            if (remaining <= 0) reservedByUser.Remove(user);
            else reservedByUser[user] = remaining;
        }
    }

    async Task<(string Owner, Guid? Image, string? Stamp)?> AccessAsync(Guid session, string user, bool mfa, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<GameDb>();
        var account = await db.Users.AsNoTracking().Where(u => u.Id == user && u.EmailConfirmed && (u.LockoutEnd == null || u.LockoutEnd < DateTimeOffset.UtcNow))
            .Select(u => new { u.SecurityStamp, u.Role, u.TwoFactorEnabled }).SingleOrDefaultAsync(ct);
        if (account == null || account.Role == PlatformRoles.Admin && (!mfa || !account.TwoFactorEnabled)) return null;
        var row = await db.Sessions.AsNoTracking().Where(s => s.Id == session && s.EndedAt == null)
            .Join(db.Campaigns, s => s.CampaignId, c => c.Id, (s, c) => new { c.OwnerId, c.Id, c.IsOneShot, c.ExpiresAt, c.MasterLastSeenAt, s.TemporaryImageId }).SingleOrDefaultAsync(ct);
        if (row == null || (row.OwnerId != user && !await db.Members.AnyAsync(m => m.CampaignId == row.Id && m.UserId == user, ct))) return null;
        var now = DateTime.UtcNow;
        if (row.IsOneShot && (row.ExpiresAt <= now || row.MasterLastSeenAt <= now - OneShotLifecycleService.MasterAbsence)) return null;
        if (!await db.SessionParticipants.AnyAsync(p => p.SessionId == session && p.UserId == user && p.LastSeenAt != null, ct)) return null;
        return (row.OwnerId, row.TemporaryImageId, account.SecurityStamp);
    }

    static async Task SendAsync(Peer peer, byte[] data, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            await peer.SendLock.WaitAsync(timeout.Token);
            try { if (peer.Socket.State == WebSocketState.Open) await peer.Socket.SendAsync(data, WebSocketMessageType.Text, true, timeout.Token); }
            finally { peer.SendLock.Release(); }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException) { peer.Socket.Abort(); }
    }

    public async Task ConnectAsync(HttpContext context, Guid session, string user)
    {
        var ct = context.RequestAborted;
        // Cookie autenticado + origem exata evitam abertura cross-site; nenhum token via URL.
        var expectedOrigin = $"{context.Request.Scheme}://{context.Request.Host}";
        if (!context.WebSockets.IsWebSocketRequest || context.Request.Headers.Origin != expectedOrigin)
        { context.Response.StatusCode = 400; return; }
        var mfa = context.User.HasClaim("amr", "mfa");
        var initial = await AccessAsync(session, user, mfa, ct);
        if (initial == null) { context.Response.StatusCode = 404; return; }
        // Reserva antes do await do handshake; aberturas paralelas contam mesmo sem socket aceito.
        if (!Reserve(user)) { context.Response.StatusCode = 429; return; }
        var id = Guid.NewGuid(); WebSocket? socket = null;
        try
        {
            socket = await context.WebSockets.AcceptWebSocketAsync();
            var peer = new Peer(id, session, user, initial.Value.Stamp, mfa, socket); peers[id] = peer;
            var buffer = new byte[32768]; var minute = DateTime.UtcNow; var messages = 0;
            while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var offset = 0; WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, offset, buffer.Length - offset), ct);
                    offset += result.Count;
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    if (result.MessageType != WebSocketMessageType.Text || offset >= buffer.Length) return;
                } while (!result.EndOfMessage);
                if (DateTime.UtcNow - minute > TimeSpan.FromMinutes(1)) { messages = 0; minute = DateTime.UtcNow; }
                if (++messages > 120) return;
                var access = await AccessAsync(session, user, peer.Mfa, ct);
                if (access == null || access.Value.Stamp != peer.Stamp) return;
                using var json = JsonDocument.Parse(buffer.AsMemory(0, offset));
                var root = json.RootElement;
                var kind = root.GetProperty("kind").GetString();
                if (kind is not ("ready" or "offer" or "answer" or "ice")) return;
                var isMaster = user == access.Value.Owner;
                if (kind == "offer" && !isMaster || kind is "ready" or "answer" && isMaster) return;
                Peer? exactTarget = null;
                if (root.TryGetProperty("toPeer", out var toPeer) && toPeer.ValueKind != JsonValueKind.Null)
                {
                    if (toPeer.ValueKind != JsonValueKind.String || !Guid.TryParse(toPeer.GetString(), out var targetId)
                        || !peers.TryGetValue(targetId, out exactTarget) || exactTarget.Session != session) continue;
                }
                var target = root.TryGetProperty("to", out var to) ? to.GetString() : exactTarget?.User ?? access.Value.Owner;
                if (string.IsNullOrEmpty(target) || target.Length > 450) return;
                if (exactTarget != null && exactTarget.User != target) return;
                if (!isMaster && target != access.Value.Owner) return;
                if (kind != "ready" && (!root.TryGetProperty("imageId", out var image) || !Guid.TryParse(image.GetString(), out var imageId) || imageId != access.Value.Image)) continue;
                // Envelope reconstruído: o cliente não pode falsificar o remetente.
                var data = JsonSerializer.SerializeToUtf8Bytes(new { kind, from = user, peerId = id, imageId = access.Value.Image, payload = root.TryGetProperty("payload", out var payload) ? payload : default(JsonElement?) });
                var targets = exactTarget == null ? peers.Values.Where(p => p.Session == session && p.User == target) : [exactTarget];
                foreach (var other in targets)
                {
                    var receiving = await AccessAsync(session, other.User, other.Mfa, ct);
                    if (receiving != null && receiving.Value.Stamp == other.Stamp) await SendAsync(other, data, ct);
                    else other.Socket.Abort();
                }
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException) { }
        finally { peers.TryRemove(id, out _); socket?.Abort(); socket?.Dispose(); Release(user); }
    }
}
