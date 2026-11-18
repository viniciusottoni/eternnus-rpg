using System.Net;
using System.Net.Sockets;
using System.Text;
namespace Eternnus.Web;

/// <summary>
/// Lê a página pública de um produto para pré-visualizar metadados (Open Graph/JSON-LD), como faz qualquer prévia de link.
/// Mesmas defesas contra SSRF de <see cref="RemoteImageFetcher"/>: só https na porta padrão, DNS resolvido aqui e conexão
/// apenas a endereços públicos, sem proxy, cookies ou redirecionamento automático. Cada redirecionamento (até três) precisa
/// continuar num host da mesma lista de lojas permitidas. Sem JavaScript, sem credenciais e sem contornar bloqueios:
/// qualquer resposta diferente de 200 HTML encerra a leitura e o cadastro segue manual.
/// </summary>
public class StoreLinkReader
{
    public const int MaxRedirects = 3, MaxBytes = 786432;
    static readonly TimeSpan Total = TimeSpan.FromSeconds(10);
    readonly HttpClient http;

    public StoreLinkReader() : this(null) { }
    public StoreLinkReader(Func<string, CancellationToken, Task<IPAddress[]>>? resolve, HttpMessageHandler? handler = null)
    {
        var dns = resolve ?? ((host, ct) => Dns.GetHostAddressesAsync(host, ct));
        handler ??= new SocketsHttpHandler
        {
            AllowAutoRedirect = false, UseCookies = false, UseProxy = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
            ConnectTimeout = TimeSpan.FromSeconds(5), PooledConnectionLifetime = TimeSpan.FromMinutes(1),
            ConnectCallback = async (context, ct) =>
            {
                var addresses = await dns(context.DnsEndPoint.Host, ct);
                if (addresses.Length == 0 || !addresses.All(RemoteImageFetcher.IsPublic)) throw new StoreLinkException("blocked-address");
                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try { await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct); return new NetworkStream(socket, ownsSocket: true); }
                catch { socket.Dispose(); throw; }
            },
        };
        http = new HttpClient(handler) { Timeout = Total };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("EternnusLinkPreview/1.0 (+https://rpg.eternnus.com)");
        http.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml;q=0.9");
        http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("pt-BR,pt;q=0.9");
    }

    /// <summary>Página final (depois de redirecionamentos permitidos) e o HTML até <see cref="MaxBytes"/>.
    /// Falhas viram <see cref="StoreLinkException"/> com um motivo curto, sem a URL (o motivo pode ir ao log).</summary>
    public virtual async Task<(Uri Final, string Html)> ReadAsync(Uri start, string marketplace, CancellationToken ct)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(Total);
        var uri = start;
        try
        {
            for (var hop = 0; ; hop++)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, limit.Token);
                if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } next)
                {
                    if (hop >= MaxRedirects) throw new StoreLinkException("too-many-redirects");
                    uri = StoreAffiliateLinks.ValidateHop(new Uri(uri, next), marketplace);
                    continue;
                }
                if (response.StatusCode != HttpStatusCode.OK) throw new StoreLinkException("status-" + (int)response.StatusCode);
                var type = response.Content.Headers.ContentType?.MediaType ?? "";
                if (!type.Contains("html", StringComparison.OrdinalIgnoreCase)) throw new StoreLinkException("not-html");
                if (response.Content.Headers.ContentLength > MaxBytes * 4) throw new StoreLinkException("too-large");
                await using var stream = await response.Content.ReadAsStreamAsync(limit.Token);
                using var buffer = new MemoryStream();
                var chunk = new byte[32768];
                int read;
                // Metadados ficam no início do documento: corta no limite em vez de recusar.
                while (buffer.Length < MaxBytes && (read = await stream.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, MaxBytes - buffer.Length)), limit.Token)) > 0)
                    buffer.Write(chunk, 0, read);
                return (uri, Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length));
            }
        }
        catch (StoreLinkException) { throw; }
        catch (RuleException) { throw new StoreLinkException("redirect-not-allowed"); }
        catch (Exception e) when (Inner<StoreLinkException>(e) is { } inner) { throw inner; }
        catch (HttpRequestException) { throw new StoreLinkException("network"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new StoreLinkException("timeout"); }
    }
    static T? Inner<T>(Exception? e) where T : Exception { for (; e != null; e = e.InnerException) if (e is T found) return found; return null; }
}

/// <summary>Falha esperada da leitura de página: o motivo é curto e não contém a URL.</summary>
public sealed class StoreLinkException(string reason) : Exception(reason) { public string Reason { get; } = reason; }
