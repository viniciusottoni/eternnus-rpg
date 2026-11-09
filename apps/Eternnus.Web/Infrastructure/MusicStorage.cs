using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Armazenamento privado dos arquivos de áudio do acervo de músicas. Diretório configurável em <c>Music:Directory</c>
/// (padrão <c>App_Data/music</c>), obrigatoriamente fora de wwwroot e preservado entre publicações como as chaves.
/// Arquivos são nomeados por uma chave opaca (GUID); nomes enviados pelo usuário nunca formam caminhos.
/// Os metadados ficam no PostgreSQL; um arquivo sem registro correspondente é removido pela limpeza periódica.
/// </summary>
public sealed class MusicStorage
{
    const string Extension = ".audio", Temporary = ".partial";

    public MusicStorage(string root, string? webRootPath)
    {
        Root = Path.GetFullPath(root);
        if (!string.IsNullOrEmpty(webRootPath))
        {
            var web = Path.GetFullPath(webRootPath).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if ((Root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar).StartsWith(web, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Configure Music:Directory outside wwwroot.");
        }
        Directory.CreateDirectory(Root);
    }

    public static MusicStorage FromConfiguration(IConfiguration config, IWebHostEnvironment env) =>
        new(config["Music:Directory"] is { Length: > 0 } configured ? configured : Path.Combine(env.ContentRootPath, "App_Data", "music"), env.WebRootPath);

    public string Root { get; }

    public static string NewKey() => Guid.NewGuid().ToString("N");

    public static bool IsKey(string? key) => key is { Length: 32 } && key.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    public string PathOf(string key) => IsKey(key) ? Path.Combine(Root, key + Extension) : throw new ArgumentException("Invalid storage key.", nameof(key));

    /// <summary>Grava em arquivo temporário e move para o nome final (sem sobrescrever): leitores nunca veem arquivo parcial.</summary>
    public async Task WriteAsync(string key, byte[] content, CancellationToken ct)
    {
        var final = PathOf(key);
        var temporary = Path.Combine(Root, key + Temporary);
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous))
                await stream.WriteAsync(content, ct);
            File.Move(temporary, final, overwrite: false);
        }
        catch
        {
            TryDelete(temporary);
            throw;
        }
    }

    /// <summary>Remoção após o commit. Falhas ficam para a limpeza periódica; a exclusão do registro já encerrou o acesso.</summary>
    public void Delete(string key)
    {
        if (IsKey(key)) TryDelete(PathOf(key));
    }

    static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    /// <summary>Remove arquivos sem registro no banco (campanha excluída, one-shot descartada, falha entre gravação e commit).
    /// Somente arquivos mais antigos que <paramref name="minimumAge"/>, para não disputar com um envio em andamento.</summary>
    public async Task<int> SweepAsync(GameDb db, TimeSpan minimumAge, DateTime nowUtc, CancellationToken ct)
    {
        var removed = 0;
        var candidates = new List<(string Key, string Path)>();
        foreach (var path in Directory.EnumerateFiles(Root))
        {
            var name = Path.GetFileName(path);
            var key = name.EndsWith(Extension, StringComparison.Ordinal) ? name[..^Extension.Length]
                : name.EndsWith(Temporary, StringComparison.Ordinal) ? name[..^Temporary.Length] : null;
            if (!IsKey(key) || nowUtc - File.GetLastWriteTimeUtc(path) < minimumAge) continue;
            if (name.EndsWith(Temporary, StringComparison.Ordinal)) { TryDelete(path); removed++; continue; }
            candidates.Add((key!, path));
        }
        foreach (var chunk in candidates.Chunk(500))
        {
            var keys = chunk.Select(x => x.Key).ToList();
            var known = (await db.MusicTracks.AsNoTracking().Where(t => keys.Contains(t.StorageKey)).Select(t => t.StorageKey).ToListAsync(ct)).ToHashSet();
            foreach (var (key, path) in chunk.Where(x => !known.Contains(x.Key))) { TryDelete(path); removed++; }
        }
        return removed;
    }
}

/// <summary>Limpeza periódica do armazenamento de áudio: dois minutos após iniciar e depois a cada seis horas.</summary>
public sealed class MusicStorageSweeper(IServiceScopeFactory scopes, MusicStorage storage, TimeProvider clock, ILogger<MusicStorageSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); }
        catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var removed = await storage.SweepAsync(scope.ServiceProvider.GetRequiredService<GameDb>(), TimeSpan.FromHours(1), clock.GetUtcNow().UtcDateTime, stoppingToken);
                if (removed > 0) logger.LogInformation("Removed {Count} orphan audio files.", removed);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha na limpeza do armazenamento de áudio."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}
