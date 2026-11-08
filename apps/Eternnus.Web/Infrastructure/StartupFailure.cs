using System.Net.Sockets;
using System.Text;
using Npgsql;
namespace Eternnus.Web;

/// <summary>
/// Registra por que o processo não conseguiu iniciar (IIS mostra apenas HTTP 502.5).
/// O texto é sanitizado: tipos, códigos e local da falha, sem mensagens de exceção, connection string,
/// SQL ou caminhos. A única mensagem preservada é a das validações de configuração do próprio app,
/// que não contêm valores. O arquivo fica em App_Data, fora de wwwroot e nunca servido.
/// </summary>
public static class StartupFailure
{
    public const string FileName = "startup-failure.txt";
    public static string Directory(string root) => Path.Combine(root, "App_Data", "logs");

    public static string Describe(Exception error, DateTimeOffset now)
    {
        var text = new StringBuilder();
        text.AppendLine($"Eternnus startup failure at {now.UtcDateTime:yyyy-MM-dd HH:mm:ss} UTC");
        var seen = 0;
        for (var current = error; current != null && seen < 8; current = current.InnerException, seen++)
        {
            text.Append("- ").Append(current.GetType().FullName);
            if (current is PostgresException postgres) text.Append($" SqlState={postgres.SqlState}");
            if (current is SocketException socket) text.Append($" SocketError={socket.SocketErrorCode}");
            if (current is NpgsqlException npgsql) text.Append($" Transient={npgsql.IsTransient}");
            text.Append($" HResult=0x{current.HResult:X8}");
            if (current.TargetSite is { } site) text.Append($" at {site.DeclaringType?.FullName}.{site.Name}");
            text.AppendLine();
            if (current is InvalidOperationException && current.Message.StartsWith("Configure ", StringComparison.Ordinal))
                text.Append("  ").AppendLine(current.Message);
            if (current is AggregateException aggregate && aggregate.InnerExceptions.Count > 1)
                text.AppendLine($"  ({aggregate.InnerExceptions.Count} inner exceptions; showing the first)");
        }
        return text.ToString();
    }

    public static void Record(Exception error, string root)
    {
        var text = Describe(error, DateTimeOffset.UtcNow);
        try { Console.Error.WriteLine(text); } catch { /* sem console disponível */ }
        try
        {
            var directory = Directory(root);
            System.IO.Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, FileName), text);
        }
        catch { /* sem permissão de escrita: resta o stdout do ANCM */ }
    }

    /// <summary>Remove o registro antigo depois de uma inicialização bem-sucedida.</summary>
    public static void Clear(string root)
    {
        try { File.Delete(Path.Combine(Directory(root), FileName)); } catch { /* opcional */ }
    }
}
