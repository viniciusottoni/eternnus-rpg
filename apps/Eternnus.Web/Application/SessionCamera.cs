namespace Eternnus.Web;

/// <summary>
/// "Mostrar esta região" (ADR-115): enquadramento transitório que o mestre envia à mesa e à exibição externa.
/// Segue o fluxo de escrita da mesa (bloqueio → revisão → sinal), mas não grava evento: não é história da sessão.
/// Não revela nada: cada destinatário continua recebendo só o que a própria névoa permite.
/// </summary>
public partial class SessionService
{
    public async Task SetCameraAsync(Guid sessionId, CameraInput x, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var a = await LockAsync(sessionId, user, ct); RequireMaster(a);
        // Mapa com grade: limite do próprio mapa. Mapa sem grade (cartográfico): limite genérico de casas.
        var map = a.Session.MapKind == MapKinds.Tileset ? await Fog.MapAsync(a.Session.CampaignId, a.Session.MapKey, ct) : null;
        var (width, height) = map is { Width: > 0, Height: > 0 } ? (map.Width, map.Height) : ((int)CameraFrames.MaxSide, (int)CameraFrames.MaxSide);
        var frame = CameraFrames.Validate(x, width, height, CameraFrames.Parse(a.Session.Camera));
        a.Session.Camera = CameraFrames.Serialize(frame);
        await CommitAsync(tx, a.Session, ct);
    }

    /// <summary>Enquadramento atual para o estado ao vivo: <c>{ x, y, w, h, seq }</c> ou nulo.</summary>
    static CameraFrame? CameraOf(GameSession s) => CameraFrames.Parse(s.Camera);
}
