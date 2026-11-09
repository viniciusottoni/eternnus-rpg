using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record MusicTrackInput(string Title, int Revision);

/// <summary>Áudio lido, validado pela estrutura real e verificado pelo antivírus, pronto para virar faixa.</summary>
public sealed record AudioUpload(byte[] Content, string ContentType, int? DurationMs, string SuggestedTitle, string Sha256);

/// <summary>Leitura segura do envio de áudio: tamanho real, estrutura MP3/M4A/OGG (<see cref="AudioProbe"/>) e ClamAV
/// (mesmo <see cref="IDocumentScanner"/> dos documentos). Áudio não passa pelos decodificadores de imagem.</summary>
public static class AudioUploads
{
    public static async Task<AudioUpload> ReadAsync(IFormFile? file, IDocumentScanner scanner, CancellationToken ct)
    {
        if (file is null || file.Length <= 0) throw new RuleException(400, "Escolha um arquivo de áudio.");
        if (file.Length > MusicLimits.MaxFileBytes) throw new RuleException(413, "Envie um arquivo de até 20 MB.");
        var content = new byte[file.Length];
        await using (var stream = file.OpenReadStream())
        {
            var read = 0;
            while (read < content.Length)
            {
                var n = await stream.ReadAsync(content.AsMemory(read), ct);
                if (n == 0) break;
                read += n;
            }
            if (read != content.Length || stream.ReadByte() != -1) throw new RuleException(400, "O envio do arquivo foi interrompido. Tente novamente.");
        }
        var probe = AudioProbe.Inspect(content) ?? throw new RuleException(415, "Formato não aceito. Envie um arquivo MP3, M4A (AAC) ou OGG válido.");
        await scanner.ScanAsync(content, ct);
        var name = (file.FileName ?? "").Replace('\\', '/').Split('/')[^1];
        return new AudioUpload(content, probe.ContentType, probe.DurationMs, MusicCatalogService.CleanTitle(Path.GetFileNameWithoutExtension(name).Replace('_', ' ')), Convert.ToHexStringLower(SHA256.HashData(content)));
    }
}

/// <summary>
/// Catálogo de músicas do servidor. Administradores enviam, renomeiam e excluem (com auditoria); contas verificadas
/// buscam por nome para que o mestre escolha a trilha da mesa. Excluir uma faixa tocando em sessão ativa é recusado.
/// </summary>
public sealed class MusicCatalogService(GameDb db, MusicStorage storage, AuditService audit)
{
    IQueryable<MusicTrack> Tracks => db.MusicTracks;

    static RuleException Missing() => new(404, "Faixa não encontrada.");

    public static string CleanTitle(string? value)
    {
        var sb = new StringBuilder();
        foreach (var ch in (value ?? "").Normalize(NormalizationForm.FormC))
        {
            if (char.IsControl(ch) || char.GetUnicodeCategory(ch) == System.Globalization.UnicodeCategory.Format) continue;
            sb.Append(char.IsWhiteSpace(ch) ? ' ' : ch);
        }
        var clean = string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return clean.Length > MusicLimits.MaxTitle ? clean[..MusicLimits.MaxTitle].TrimEnd() : clean;
    }

    static string Term(string? search)
    {
        var term = (search ?? "").Trim();
        return term.Length > 100 ? throw new RuleException(400, "Busque com até 100 caracteres.") : term;
    }

    IQueryable<MusicTrack> Search(string term) =>
        term.Length == 0 ? Tracks.AsNoTracking() : Tracks.AsNoTracking().Where(t => t.Title.ToLower().Contains(term.ToLower()));

    /// <summary>Busca por nome para o mestre escolher a trilha. Só metadados de apresentação; nenhum byte ou detalhe interno.</summary>
    public async Task<object> SearchAsync(string? search, int page, CancellationToken ct)
    {
        var term = Term(search);
        page = Math.Clamp(page, 1, 100000);
        var query = Search(term);
        var total = await query.CountAsync(ct);
        var items = await query.OrderBy(t => t.Title).ThenBy(t => t.Id).Skip((page - 1) * MusicLimits.PageSize).Take(MusicLimits.PageSize)
            .Select(t => new { t.Id, t.Title, t.ContentType, t.DurationMs }).ToListAsync(ct);
        return new { items = items.Select(t => new { t.Id, t.Title, format = AudioFormats.Label(t.ContentType), t.DurationMs }), total, page, pageSize = MusicLimits.PageSize };
    }

    static object AdminView(MusicTrack t, bool inUse = false) => new
    {
        t.Id, t.Title, t.ContentType, format = AudioFormats.Label(t.ContentType), t.SizeBytes, t.DurationMs, t.CreatedAt, t.Revision, inUse,
        audioUrl = $"/api/admin/music/{t.Id}/audio",
    };

    /// <summary>Gestão (Admin): lista paginada com uso do catálogo e faixas tocando em sessões ativas.</summary>
    public async Task<object> AdminListAsync(string? search, int page, CancellationToken ct)
    {
        var term = Term(search);
        page = Math.Clamp(page, 1, 100000);
        var usage = await Tracks.AsNoTracking().GroupBy(_ => 1).Select(g => new { tracks = g.Count(), bytes = g.Sum(t => t.SizeBytes) }).SingleOrDefaultAsync(ct);
        var query = Search(term);
        var total = await query.CountAsync(ct);
        var items = await query.OrderBy(t => t.Title).ThenBy(t => t.Id).Skip((page - 1) * MusicLimits.PageSize).Take(MusicLimits.PageSize).ToListAsync(ct);
        var ids = items.Select(t => t.Id).ToList();
        var inUse = (await db.Sessions.AsNoTracking().Where(s => s.EndedAt == null && s.MusicTrackId != null && ids.Contains(s.MusicTrackId.Value))
            .Select(s => s.MusicTrackId!.Value).ToListAsync(ct)).ToHashSet();
        return new
        {
            items = items.Select(t => AdminView(t, inUse.Contains(t.Id))), total, page, pageSize = MusicLimits.PageSize,
            usage = new { tracks = usage?.tracks ?? 0, bytes = usage?.bytes ?? 0L },
            limits = new { maxFileBytes = MusicLimits.MaxFileBytes, maxTracks = MusicLimits.MaxTracks, maxCatalogBytes = MusicLimits.MaxCatalogBytes, formats = AudioFormats.All.Select(AudioFormats.Label) },
        };
    }

    /// <summary>Serializa as alterações do catálogo (quotas globais) dentro da transação.</summary>
    async Task LockCatalogAsync(CancellationToken ct)
    {
        if (db.Database.IsNpgsql()) await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(470149)", ct);
    }

    /// <summary>Grava o arquivo antes do commit (nome opaco); se a transação falhar, o arquivo é apagado. Quotas reconferidas sob bloqueio.</summary>
    public async Task<object> AddAsync(string admin, string? title, AudioUpload upload, CancellationToken ct)
    {
        var name = CleanTitle(string.IsNullOrWhiteSpace(title) ? upload.SuggestedTitle : title);
        if (name.Length == 0) name = "Faixa sem título";
        var track = new MusicTrack
        {
            Title = name, ContentType = upload.ContentType, SizeBytes = upload.Content.LongLength, DurationMs = upload.DurationMs,
            Sha256 = upload.Sha256, StorageKey = MusicStorage.NewKey(), UploadedById = admin, CreatedAt = DateTime.UtcNow,
        };
        await storage.WriteAsync(track.StorageKey, upload.Content, ct);
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await LockCatalogAsync(ct);
            if (await Tracks.CountAsync(ct) >= MusicLimits.MaxTracks) throw new RuleException(409, $"O catálogo atingiu {MusicLimits.MaxTracks} faixas. Exclua uma faixa antes de enviar outra.");
            var used = await Tracks.SumAsync(t => (long?)t.SizeBytes, ct) ?? 0;
            if (used + track.SizeBytes > MusicLimits.MaxCatalogBytes) throw new RuleException(409, "O catálogo atingiu 2 GB. Exclua faixas antes de enviar outra.");
            if (await Tracks.AnyAsync(t => t.Sha256 == track.Sha256, ct)) throw new RuleException(409, "Este arquivo já está no catálogo.");
            db.MusicTracks.Add(track);
            audit.Record(admin, "music.upload", "music", track.Id.ToString(), $"Faixa enviada: {name}", new { title = name, format = AudioFormats.Label(track.ContentType), track.SizeBytes, track.DurationMs });
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        }
        catch
        {
            storage.Delete(track.StorageKey);
            throw;
        }
        return AdminView(track);
    }

    public async Task<object> RenameAsync(string admin, Guid id, MusicTrackInput x, CancellationToken ct)
    {
        var name = CleanTitle(x.Title);
        if (name.Length == 0) throw new RuleException(400, "Informe um título de até 120 caracteres.");
        var track = await Tracks.SingleOrDefaultAsync(t => t.Id == id, ct) ?? throw Missing();
        if (track.Revision != x.Revision) throw new RuleException(409, "Esta faixa mudou em outra janela. Atualize a lista e tente novamente.");
        audit.Record(admin, "music.rename", "music", id.ToString(), $"Faixa renomeada: {name}", new { before = track.Title, after = name });
        track.Title = name; track.Revision++;
        await db.SaveChangesAsync(ct);
        return AdminView(track);
    }

    /// <summary>
    /// Bloqueia a faixa (FOR UPDATE) antes de conferir o uso. A seleção na mesa bloqueia a sessão e depois a faixa (FOR SHARE):
    /// uma das duas espera a outra, sem ciclo de bloqueios; a perdedora recebe 404 ou 409.
    /// </summary>
    public async Task DeleteAsync(string admin, Guid id, CancellationToken ct)
    {
        string key;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var track = (db.Database.IsNpgsql()
                ? await db.MusicTracks.FromSqlInterpolated($"SELECT * FROM \"MusicTracks\" WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct)
                : await Tracks.SingleOrDefaultAsync(t => t.Id == id, ct)) ?? throw Missing();
            var sessions = await db.Sessions.CountAsync(s => s.EndedAt == null && s.MusicTrackId == id, ct);
            if (sessions > 0) throw new RuleException(409, $"Esta faixa está tocando em {sessions} sessão(ões) ativa(s). Aguarde o mestre parar ou trocar a música.");
            key = track.StorageKey;
            audit.Record(admin, "music.delete", "music", id.ToString(), $"Faixa excluída: {track.Title}", new { track.Title, track.SizeBytes });
            db.MusicTracks.Remove(track);
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        }
        storage.Delete(key);
    }

    /// <summary>Arquivo para o administrador conferir uma faixa (prévia no painel).</summary>
    public async Task<MusicTrack> AdminFileAsync(Guid id, CancellationToken ct) =>
        await Tracks.AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct) ?? throw Missing();
}
