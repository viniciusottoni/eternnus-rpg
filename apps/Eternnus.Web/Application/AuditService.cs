using System.Text.Json;
namespace Eternnus.Web;

/// <summary>Grava a trilha de auditoria no mesmo <see cref="GameDb"/> (e portanto na mesma transação/SaveChanges) da alteração auditada.
/// Não chama SaveChanges: quem altera os dados grava tudo de uma vez.</summary>
public class AuditService(GameDb db)
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxData = 20000;

    /// <param name="action">Ex.: user.role, system.update, library.upload, template.publish, guild.post.delete.</param>
    /// <param name="data">Objeto serializável (antes/depois). Nunca incluir segredo, token, senha ou e-mail de terceiros.</param>
    public AuditEntry Record(string actorId, string action, string targetType, string targetId, string summary, object? data = null)
    {
        var json = data is null ? "" : JsonSerializer.Serialize(data, Json);
        if (json.Length > MaxData) json = JsonSerializer.Serialize(new { truncated = true, length = json.Length }, Json);
        var entry = new AuditEntry
        {
            ActorId = actorId,
            Action = Clip(action, 60),
            TargetType = Clip(targetType, 40),
            TargetId = Clip(targetId, 80),
            Summary = Clip(summary, 300),
            Data = json,
        };
        db.Audit.Add(entry);
        return entry;
    }
    static string Clip(string value, int max) => value.Length <= max ? value : value[..max];
}
