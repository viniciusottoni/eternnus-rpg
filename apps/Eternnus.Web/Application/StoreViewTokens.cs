using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
namespace Eternnus.Web;

/// <summary>Exibição da vitrine emitida pelo servidor: quem, em que ciclo, quais produtos e por qual fila (ADR-108).</summary>
public sealed record StoreViewTicket(string UserId, long Cycle, Guid[] Products, string[] Strategies);

/// <summary>
/// Token protegido (Data Protection, com prazo) que liga a confirmação de exibição ao que o servidor realmente escolheu.
/// O GET continua só lendo; o POST de impressões não aceita produto, fila ou ciclo inventados pelo cliente.
/// </summary>
public sealed class StoreViewTokens(IDataProtectionProvider provider)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(2);
    public const int MaxLength = 4000;
    readonly ITimeLimitedDataProtector protector = provider.CreateProtector("Eternnus.Store.View.v1").ToTimeLimitedDataProtector();

    public string Issue(StoreViewTicket ticket) => protector.Protect(JsonSerializer.Serialize(ticket), Lifetime);

    /// <summary>Ticket válido e dentro do prazo, ou nulo (adulterado, expirado ou de outra chave).</summary>
    public StoreViewTicket? Read(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > MaxLength) return null;
        try
        {
            var ticket = JsonSerializer.Deserialize<StoreViewTicket>(protector.Unprotect(token));
            return ticket is { UserId.Length: > 0, Products: not null, Strategies: not null } && ticket.Products.Length == ticket.Strategies.Length ? ticket : null;
        }
        catch (Exception e) when (e is CryptographicException or JsonException or FormatException) { return null; }
    }
}
