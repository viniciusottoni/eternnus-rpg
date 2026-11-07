using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record TemporaryImageInput(string Title);
public partial class SessionService
{
    public async Task EntryForTemporaryImageAsync(Guid sessionId, string user, CancellationToken ct) =>
        _ = await SessionAccessAsync(sessionId, user, ct);
    // Apenas metadados são persistidos. Os bytes trafegam entre navegadores por WebRTC.
    public async Task<object> ShowTemporaryImageAsync(Guid sessionId, TemporaryImageInput input, string user, CancellationToken ct)
    {
        var title = Trim(input.Title, 120, "Informe um título com até 120 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        await RequireJoinedAsync(a, user, ct);
        a.Session.TemporaryImageId = Guid.NewGuid(); a.Session.TemporaryImageTitle = title;
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, $"O mestre apresentou: {title}");
        await CommitAsync(tx, a.Session, ct);
        return new { id = a.Session.TemporaryImageId, title };
    }

    public async Task HideTemporaryImageAsync(Guid sessionId, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        a.Session.TemporaryImageId = null; a.Session.TemporaryImageTitle = "";
        Event(a.Session, user, await NameAsync(user, ct), EventKinds.Map, "O mestre retirou a imagem temporária.");
        await CommitAsync(tx, a.Session, ct);
    }
}
