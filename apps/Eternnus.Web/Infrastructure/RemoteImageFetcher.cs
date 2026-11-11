using System.Net;
using System.Net.Sockets;
namespace Eternnus.Web;

/// <summary>Importa uma imagem de um link https para virar arquivo próprio da campanha (mapa ou anexo de página).
/// O servidor baixa uma única vez; depois a imagem segue a mesma assinatura, antivírus e normalização do upload,
/// e os jogadores nunca acessam o site de origem.
/// Defesas contra SSRF: só https na porta padrão e sem credenciais no link; o DNS é resolvido aqui e a conexão só
/// vai a endereços públicos (recusa loopback, redes privadas, link-local, CGNAT, multicast, ULA e prefixos que
/// embutem IPv4); sem proxy, cookies ou redirecionamento automático (até três, cada um revalidado); 15 s no total
/// e corte no limite de bytes antes de terminar a leitura.</summary>
public sealed class RemoteImageFetcher
{
    public const int MaxRedirects = 3;
    static readonly TimeSpan Total = TimeSpan.FromSeconds(15);
    const string Blocked = "Este link aponta para um endereço que o Eternnus não acessa. Use uma imagem publicada na internet.";
    readonly HttpClient http;

    public RemoteImageFetcher() : this(null) { }
    /// <param name="resolve">Resolução de nomes substituível nos testes; por padrão, o DNS do sistema.</param>
    public RemoteImageFetcher(Func<string, CancellationToken, Task<IPAddress[]>>? resolve, HttpMessageHandler? handler = null)
    {
        var dns = resolve ?? ((host, ct) => Dns.GetHostAddressesAsync(host, ct));
        handler ??= new SocketsHttpHandler
        {
            AllowAutoRedirect = false, UseCookies = false, UseProxy = false, AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(5), PooledConnectionLifetime = TimeSpan.FromMinutes(1),
            ConnectCallback = async (context, ct) =>
            {
                var addresses = await dns(context.DnsEndPoint.Host, ct);
                // Todos os endereços precisam ser públicos: um nome que mistura público e interno é recusado inteiro.
                if (addresses.Length == 0 || !addresses.All(IsPublic)) throw new RuleException(400, Blocked);
                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try { await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct); return new NetworkStream(socket, ownsSocket: true); }
                catch { socket.Dispose(); throw; }
            },
        };
        http = new HttpClient(handler) { Timeout = Total };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("EternnusImageImport/1.0");
        http.DefaultRequestHeaders.Accept.ParseAdd("image/png,image/jpeg,image/webp;q=0.9");
    }

    /// <summary>Baixa até <paramref name="maxBytes"/>. Devolve os bytes (ainda não verificados) e o nome do arquivo no link.</summary>
    public async Task<(byte[] Content, string FileName)> FetchAsync(string? input, int maxBytes, CancellationToken ct)
    {
        var uri = Validate(input);
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(Total);
        try
        {
            for (var hop = 0; ; hop++)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, limit.Token);
                if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } next)
                {
                    if (hop >= MaxRedirects) throw new RuleException(400, "O link redireciona vezes demais. Use o endereço direto da imagem.");
                    uri = Validate(new Uri(uri, next).AbsoluteUri);
                    continue;
                }
                if (!response.IsSuccessStatusCode) throw new RuleException(400, "O site do link não entregou a imagem. Confira se o endereço abre a imagem diretamente.");
                if (response.Content.Headers.ContentLength > maxBytes) throw TooLarge(maxBytes);
                await using var stream = await response.Content.ReadAsStreamAsync(limit.Token);
                using var buffer = new MemoryStream();
                var chunk = new byte[81920];
                int read;
                while ((read = await stream.ReadAsync(chunk, limit.Token)) > 0)
                {
                    if (buffer.Length + read > maxBytes) throw TooLarge(maxBytes);
                    buffer.Write(chunk, 0, read);
                }
                if (buffer.Length == 0) throw new RuleException(400, "O link não trouxe nenhuma imagem.");
                return (buffer.ToArray(), Uri.UnescapeDataString(Path.GetFileName(uri.AbsolutePath)));
            }
        }
        catch (Exception e) when (Inner<RuleException>(e) is { } rule && e is not RuleException) { throw rule; }
        catch (HttpRequestException) { throw new RuleException(502, "Não foi possível baixar a imagem do link. Confira o endereço ou envie o arquivo."); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new RuleException(504, "O site do link demorou demais para responder. Envie o arquivo."); }
    }

    static RuleException TooLarge(int maxBytes) => new(413, $"A imagem do link passa de {maxBytes / (1024 * 1024)} MB.");
    static T? Inner<T>(Exception? e) where T : Exception { for (; e != null; e = e.InnerException) if (e is T found) return found; return null; }

    /// <summary>Link aceito: https absoluto, porta padrão, sem usuário/senha, host que não seja nome local nem IP interno.</summary>
    public static Uri Validate(string? input)
    {
        var text = (input ?? "").Trim();
        if (text.Length is 0 or > 2000 || text.Any(char.IsControl) || !Uri.TryCreate(text, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 || !uri.IsDefaultPort || uri.IdnHost.Length == 0)
            throw new RuleException(400, "Use um link https:// direto para a imagem, sem usuário, senha ou porta.");
        var host = uri.IdnHost.Trim('[', ']').TrimEnd('.').ToLowerInvariant();
        if (IPAddress.TryParse(host, out var ip) ? !IsPublic(ip) : !host.Contains('.') || host is "localhost" || host.EndsWith(".localhost") || host.EndsWith(".local") || host.EndsWith(".internal") || host.EndsWith(".home.arpa"))
            throw new RuleException(400, Blocked);
        return uri;
    }

    /// <summary>Só unicast público: IPv4 fora das faixas reservadas e IPv6 global (2000::/3) sem prefixos que embutem IPv4.</summary>
    public static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        var b = ip.GetAddressBytes();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
            return !(b[0] is 0 or 10 or 127 || b[0] >= 224
                || b[0] == 100 && (b[1] & 0xC0) == 64          // 100.64.0.0/10 (CGNAT)
                || b[0] == 169 && b[1] == 254                   // link-local / metadados de nuvem
                || b[0] == 172 && (b[1] & 0xF0) == 16           // 172.16.0.0/12
                || b[0] == 192 && b[1] == 168
                || b[0] == 192 && b[1] == 0 && b[2] is 0 or 2   // 192.0.0.0/24, 192.0.2.0/24
                || b[0] == 192 && b[1] == 88 && b[2] == 99      // relay 6to4
                || b[0] == 198 && (b[1] & 0xFE) == 18           // 198.18.0.0/15
                || b[0] == 198 && b[1] == 51 && b[2] == 100
                || b[0] == 203 && b[1] == 0 && b[2] == 113);
        if (ip.AddressFamily != AddressFamily.InterNetworkV6) return false;
        if ((b[0] & 0xE0) != 0x20) return false;                                      // fora de 2000::/3
        if (b[0] == 0x20 && b[1] == 0x02) return false;                               // 6to4
        if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x00 && b[3] == 0x00) return false; // Teredo
        if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) return false; // documentação
        return true;
    }
}
