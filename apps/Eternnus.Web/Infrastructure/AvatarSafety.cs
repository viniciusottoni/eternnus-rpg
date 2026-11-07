using System.Buffers.Binary;
using System.Net.Sockets;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
namespace Eternnus.Web;

public interface IAvatarSafety
{
    bool Available { get; }
    Task ScanAsync(byte[] original, CancellationToken ct);
    Task ModerateAsync(byte[] image, CancellationToken ct);
}

public sealed class AvatarSafety(IConfiguration config, IHttpClientFactory clients) : IAvatarSafety
{
    static readonly string[] Categories = ["Hate", "SelfHarm", "Sexual", "Violence"];
    public bool Available => !string.IsNullOrWhiteSpace(config["Avatar:ClamAv:Host"])
        && Uri.TryCreate(config["Avatar:Moderation:Endpoint"], UriKind.Absolute, out var endpoint)
        && endpoint.Scheme == "https" && endpoint.AbsolutePath == "/" && string.IsNullOrEmpty(endpoint.Query)
        && string.IsNullOrEmpty(endpoint.UserInfo) && !string.IsNullOrWhiteSpace(config["Avatar:Moderation:Key"]);
    public static RuleException Unavailable() => new(503, "A verificação de segurança de imagens está indisponível. Tente novamente mais tarde.");
    public async Task ScanAsync(byte[] original, CancellationToken ct)
    {
        if (!Available) throw Unavailable();
        await ClamAvClient.ScanAsync(config["Avatar:ClamAv:Host"]!, config.GetValue("Avatar:ClamAv:Port", 3310), original,
            "O arquivo foi recusado pela verificação de segurança. Escolha outra imagem.", Unavailable, ct);
    }
    public async Task ModerateAsync(byte[] image, CancellationToken ct)
    {
        if (!Available) throw Unavailable();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            var endpoint = new Uri(new Uri(config["Avatar:Moderation:Endpoint"]!), "contentsafety/image:analyze?api-version=2024-09-01");
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Add("Ocp-Apim-Subscription-Key", config["Avatar:Moderation:Key"]!);
            request.Content = JsonContent.Create(new { image = new { content = Convert.ToBase64String(image) }, categories = Categories, outputType = "FourSeverityLevels" });
            using var http = clients.CreateClient("avatar-moderation");
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode) throw Unavailable();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            ValidateModeration(json.RootElement);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException || ex is OperationCanceledException && !ct.IsCancellationRequested) { throw Unavailable(); }
    }
    public static void ValidateModeration(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("categoriesAnalysis", out var results) || results.ValueKind != JsonValueKind.Array || results.GetArrayLength() != Categories.Length) throw Unavailable();
        var seen = new HashSet<string>();
        foreach (var item in results.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("category", out var category) || category.ValueKind != JsonValueKind.String || !Categories.Contains(category.GetString())
                || !seen.Add(category.GetString()!) || !item.TryGetProperty("severity", out var severity) || severity.ValueKind != JsonValueKind.Number || !severity.TryGetInt32(out var value) || value is not (0 or 2 or 4 or 6)) throw Unavailable();
            if (value >= 2) throw new RuleException(422, "A imagem não atende às regras de conteúdo para avatares. Escolha outra imagem.");
        }
    }
}

/// <summary>Cliente mínimo do protocolo INSTREAM do ClamAV (clamd). Compartilhado por avatares e documentos.</summary>
public static class ClamAvClient
{
    public static async Task ScanAsync(string host, int port, byte[] data, string rejectMessage, Func<RuleException> unavailable, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(host, port, timeout.Token);
            await using var stream = client.GetStream();
            await stream.WriteAsync("zINSTREAM\0"u8.ToArray(), timeout.Token);
            var header = new byte[4];
            for (var offset = 0; offset < data.Length; offset += 65536)
            {
                var size = Math.Min(65536, data.Length - offset);
                BinaryPrimitives.WriteInt32BigEndian(header, size);
                await stream.WriteAsync(header, timeout.Token);
                await stream.WriteAsync(data.AsMemory(offset, size), timeout.Token);
            }
            await stream.WriteAsync(new byte[4], timeout.Token);
            var reply = new byte[1024]; var length = 0;
            while (length < reply.Length)
            {
                var read = await stream.ReadAsync(reply.AsMemory(length), timeout.Token);
                if (read == 0) throw unavailable();
                length += read;
                var end = Array.IndexOf(reply, (byte)0, 0, length);
                if (end < 0) continue;
                var verdict = Encoding.ASCII.GetString(reply, 0, end);
                if (verdict == "stream: OK") return;
                if (verdict.StartsWith("stream: ", StringComparison.Ordinal) && verdict.EndsWith(" FOUND", StringComparison.Ordinal))
                    throw new RuleException(422, rejectMessage);
                throw unavailable();
            }
            throw unavailable();
        }
        catch (Exception ex) when (ex is SocketException or IOException || ex is OperationCanceledException && !ct.IsCancellationRequested) { throw unavailable(); }
    }
}
