using Microsoft.EntityFrameworkCore;
using ImageMagick;
using System.Runtime.CompilerServices;
using System.Buffers.Binary;
namespace Eternnus.Web;

public record CampaignTextInput(string Title, string Text, bool Published, int Revision = 0);
public record CampaignFolderInput(string Name, Guid? ParentId);
public record CampaignMapInput(string Name, Guid? FolderId, int GridPixels, decimal ScaleMeters, int Revision = 0);
public record CampaignMapView(Guid Id, string Name, Guid? FolderId, int GridPixels, decimal ScaleMeters, int PixelWidth, int PixelHeight, int Revision, string ImageUrl)
{
    public string Key => "asset:" + Id;
    public string Kind => MapKinds.Tileset;
    public string Description => $"Grade de {GridPixels} px · {ScaleMeters} m por quadrado";
    public int Width => PixelWidth / GridPixels;
    public int Height => PixelHeight / GridPixels;
    public string[] Rows => Grid(PixelWidth, PixelHeight, GridPixels);
    public BattleMap AsBattleMap() => new(Key, Name, Kind, Description, ImageUrl, Rows) { ScaleMeters = ScaleMeters };
    public static string[] Grid(int pixelsWide, int pixelsHigh, int square)
    {
        var width = square <= 0 ? 0 : pixelsWide / square; var height = square <= 0 ? 0 : pixelsHigh / square;
        if (width < 1 || height < 1 || width > 100 || height > 100 || width * height > 4096) throw new RuleException(400, "A grade deve ter até 100 quadrados por lado e 4.096 casas. Aumente o tamanho do quadrado.");
        return Enumerable.Range(0, height).Select(y => new string(y == 0 ? 'S' : '.', width)).ToArray();
    }
}

/// <summary>Gestão prévia/durante sessão. Bytes privados pertencem à campanha e somem com ela.</summary>
public sealed class CampaignAssetsService(GameDb db)
{
    public const int MaxImageBytes = 10 * 1024 * 1024;
    public const int MaxImageRequestBytes = MaxImageBytes + 64 * 1024;
    const long MaxStorage = 250L * 1024 * 1024;
    public const int PageSize = 20;
    static readonly SemaphoreSlim Images = new(2);
    IQueryable<CampaignLibraryEntry> Texts => db.Set<CampaignLibraryEntry>();
    IQueryable<CampaignMap> Maps => db.Set<CampaignMap>();
    IQueryable<CampaignMapFolder> Folders => db.Set<CampaignMapFolder>();

    async Task<Campaign> Access(Guid campaign, string user, bool write, CancellationToken ct)
    {
        var c = await db.Campaigns.SingleOrDefaultAsync(x => x.Id == campaign, ct) ?? throw Missing();
        if (c.OwnerId != user && !await db.Members.AnyAsync(m => m.CampaignId == campaign && m.UserId == user, ct)) throw Missing();
        OneShotLifecycleService.EnsureOpen(c, DateTime.UtcNow);
        if (write && c.OwnerId != user) throw new RuleException(403, "Somente o mestre pode organizar a campanha.");
        return c;
    }
    async Task Lock(Guid campaign, string user, CancellationToken ct)
    {
        var resourceCampaign = await Access(campaign, user, true, ct);
        // One-shot encerra com sessão -> campanha. Preservar a ordem também na preparação de recursos.
        var active = db.Database.IsNpgsql()
            ? await db.Sessions.FromSqlInterpolated($"SELECT * FROM \"Sessions\" WHERE \"CampaignId\" = {campaign} AND \"EndedAt\" IS NULL FOR UPDATE").ToListAsync(ct)
            : await db.Sessions.Where(s => s.CampaignId == campaign && s.EndedAt == null).ToListAsync(ct);
        if (db.Database.IsNpgsql()) await db.Campaigns.FromSqlInterpolated($"SELECT * FROM \"Campaigns\" WHERE \"Id\" = {campaign} FOR UPDATE").LoadAsync(ct);
        await db.Entry(resourceCampaign).ReloadAsync(ct);
        var current = await db.Sessions.Where(s => s.CampaignId == campaign && s.EndedAt == null).Select(s => s.Id).ToArrayAsync(ct);
        if (!current.Order().SequenceEqual(active.Select(s => s.Id).Order())) throw new RuleException(409, "A sessão mudou durante a preparação. Atualize e tente novamente.");
        await Access(campaign, user, true, ct);
    }
    public async Task EnsureMasterAsync(Guid campaign, string user, CancellationToken ct) => await Access(campaign, user, true, ct);
    async Task EnsureMapIdleAsync(Guid campaign, Guid mapId, CancellationToken ct)
    {
        var key = "asset:" + mapId;
        if (await db.Sessions.AnyAsync(s => s.CampaignId == campaign && s.EndedAt == null && s.MapKey == key, ct)) throw new RuleException(409, "Oculte ou troque o mapa da sessão antes de editar ou excluir.");
    }
    public async Task<object> LibraryAsync(Guid campaign, string user, int page, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        page = Math.Clamp(page, 1, 100000);
        var query = Texts.AsNoTracking().Where(x => x.CampaignId == campaign && (c.OwnerId == user || x.Published));
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.UpdatedAt).ThenBy(x => x.Id).Skip((page - 1) * PageSize).Take(PageSize).ToListAsync(ct);
        return new { items, total, page, pageSize = PageSize, systemId = c.RpgSystemId };
    }
    public async Task<CampaignLibraryEntry> SaveTextAsync(Guid campaign, Guid? id, string user, CampaignTextInput x, CancellationToken ct)
    {
        var title = Name(x.Title, 120); var text = LibraryService.Clean(x.Text ?? "", true);
        if (text.Length is 0 or > 10000) throw new RuleException(400, "O texto de apoio deve ter entre 1 e 10.000 caracteres.");
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var item = id is { } key ? await Texts.SingleOrDefaultAsync(e => e.Id == key && e.CampaignId == campaign, ct) ?? throw Missing() : new CampaignLibraryEntry { CampaignId = campaign };
        if (id != null && item.Revision != x.Revision) throw Stale();
        if (id == null && await Texts.CountAsync(e => e.CampaignId == campaign, ct) >= 500) throw new RuleException(409, "Limite de 500 textos por campanha.");
        item.Title = title; item.Text = text; item.Published = x.Published; item.UpdatedAt = DateTime.UtcNow;
        if (id == null) db.Add(item); else item.Revision++;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return item;
    }
    public async Task DeleteTextAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var item = await Texts.SingleOrDefaultAsync(x => x.CampaignId == campaign && x.Id == id, ct) ?? throw Missing();
        db.Remove(item); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    static CampaignMapView View(CampaignMap m) => new(m.Id, m.Name, m.FolderId, m.GridPixels, m.ScaleMeters, m.Width, m.Height, m.Revision, $"/api/campaigns/{m.CampaignId}/assets/maps/{m.Id}/image");
    public async Task<object> MapTreeAsync(Guid campaign, string user, Guid? folderId, int page, CancellationToken ct)
    {
        await Access(campaign, user, true, ct); page = Math.Clamp(page, 1, 100000);
        await CheckFolder(campaign, folderId, ct);
        var folders = await Folders.AsNoTracking().Where(x => x.CampaignId == campaign).OrderBy(x => x.Name).Take(100).ToListAsync(ct);
        var query = Maps.AsNoTracking().Where(x => x.CampaignId == campaign && x.FolderId == folderId);
        var total = await query.CountAsync(ct);
        var items = await query.OrderBy(x => x.Name).ThenBy(x => x.Id).Skip((page - 1) * PageSize).Take(PageSize)
            .Select(m => new CampaignMapView(m.Id, m.Name, m.FolderId, m.GridPixels, m.ScaleMeters, m.Width, m.Height, m.Revision, $"/api/campaigns/{campaign}/assets/maps/{m.Id}/image")).ToListAsync(ct);
        return new { folders, items, total, page, pageSize = PageSize, maxBytes = MaxImageBytes };
    }
    public async Task<List<CampaignMapView>> MapChoicesAsync(Guid campaign, CancellationToken ct) => await Maps.AsNoTracking().Where(m => m.CampaignId == campaign).OrderBy(m => m.Name).Take(50)
        .Select(m => new CampaignMapView(m.Id, m.Name, m.FolderId, m.GridPixels, m.ScaleMeters, m.Width, m.Height, m.Revision, $"/api/campaigns/{campaign}/assets/maps/{m.Id}/image")).ToListAsync(ct);
    public async Task<CampaignMapView?> ResolveMapAsync(Guid campaign, string key, CancellationToken ct)
    {
        if (!key.StartsWith("asset:") || !Guid.TryParse(key[6..], out var id)) return null;
        var m = await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id)
            .Select(m => new CampaignMapView(m.Id, m.Name, m.FolderId, m.GridPixels, m.ScaleMeters, m.Width, m.Height, m.Revision, $"/api/campaigns/{campaign}/assets/maps/{m.Id}/image")).SingleOrDefaultAsync(ct);
        return m;
    }
    public async Task<CampaignMapFolder> CreateFolderAsync(Guid campaign, string user, CampaignFolderInput x, CancellationToken ct)
    {
        var name = Name(x.Name, 100);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        if (await Folders.CountAsync(f => f.CampaignId == campaign, ct) >= 100) throw new RuleException(409, "Limite de 100 pastas por campanha.");
        var parent = x.ParentId; var depth = 1;
        while (parent != null) { if (++depth > 8) throw new RuleException(400, "Use até oito níveis de pastas."); parent = (await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == parent, ct) ?? throw Missing()).ParentId; }
        var folder = new CampaignMapFolder { CampaignId = campaign, ParentId = x.ParentId, Name = name };
        db.Add(folder); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return folder;
    }
    public async Task DeleteFolderAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var folder = await Folders.SingleOrDefaultAsync(f => f.CampaignId == campaign && f.Id == id, ct) ?? throw Missing();
        if (await Folders.AnyAsync(f => f.ParentId == id, ct) || await Maps.AnyAsync(m => m.FolderId == id, ct)) throw new RuleException(409, "Esvazie a pasta antes de excluir.");
        db.Remove(folder); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<CampaignMapView> SaveMapAsync(Guid campaign, Guid? id, string user, CampaignMapInput x, UploadedDocument? image, CancellationToken ct)
    {
        await Access(campaign, user, true, ct); var name = Name(x.Name, 120);
        if (x.GridPixels is < 8 or > 1024 || x.ScaleMeters is < 0.01m or > 1000m || decimal.Round(x.ScaleMeters, 2) != x.ScaleMeters) throw new RuleException(400, "Grade: 8–1.024 pixels. Escala: 0,01–1.000 metros, até duas casas decimais.");
        (byte[] Bytes, int Width, int Height)? normalized = image == null ? null : await Normalize(image, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct); await CheckFolder(campaign, x.FolderId, ct);
        var map = id is { } key ? await Maps.SingleOrDefaultAsync(m => m.Id == key && m.CampaignId == campaign, ct) ?? throw Missing() : new CampaignMap { CampaignId = campaign };
        if (id != null && map.Revision != x.Revision) throw Stale();
        if (id != null) await EnsureMapIdleAsync(campaign, map.Id, ct);
        if (id == null && (normalized == null || await Maps.CountAsync(m => m.CampaignId == campaign, ct) >= 50)) throw new RuleException(409, "Selecione a imagem; limite de 50 mapas por campanha.");
        if (normalized is { } n)
        {
            var stored = await Maps.Where(m => m.CampaignId == campaign).SumAsync(m => (long)m.Content.Length, ct);
            if (stored - map.Content.Length + n.Bytes.Length > MaxStorage) throw new RuleException(409, "Os mapas desta campanha excedem 250 MB.");
            map.Content = n.Bytes; map.Width = n.Width; map.Height = n.Height;
        }
        if (x.GridPixels > Math.Min(map.Width, map.Height)) throw new RuleException(400, "O quadrado deve caber na imagem.");
        _ = CampaignMapView.Grid(map.Width, map.Height, x.GridPixels);
        map.Name = name; map.FolderId = x.FolderId; map.GridPixels = x.GridPixels; map.ScaleMeters = x.ScaleMeters;
        if (id == null) db.Add(map); else map.Revision++;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return View(map);
    }
    public async Task DeleteMapAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct);
        var map = await Maps.SingleOrDefaultAsync(m => m.CampaignId == campaign && m.Id == id, ct) ?? throw Missing();
        await EnsureMapIdleAsync(campaign, id, ct);
        db.Remove(map); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<byte[]> ImageAsync(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var key = "asset:" + id;
        if (c.OwnerId != user && !await db.Sessions.AnyAsync(s => s.CampaignId == campaign && s.EndedAt == null && s.MapKey == key, ct)) throw Missing();
        return await Maps.AsNoTracking().Where(m => m.CampaignId == campaign && m.Id == id).Select(m => m.Content).SingleOrDefaultAsync(ct) ?? throw Missing();
    }
    async Task CheckFolder(Guid campaign, Guid? folder, CancellationToken ct) { if (folder != null && !await Folders.AnyAsync(f => f.CampaignId == campaign && f.Id == folder, ct)) throw Missing(); }
    static string Name(string? value, int max) { var s = LibraryService.Clean(value ?? "", false); return s.Length is 0 || s.Length > max ? throw new RuleException(400, $"Informe um nome de até {max} caracteres.") : s; }
    static RuleException Missing() => new(404, "Recurso da campanha não encontrado.");
    static RuleException Stale() => new(409, "O recurso mudou. Atualize antes de editar novamente.");
    public static async Task<(byte[] Bytes, int Width, int Height)> Normalize(UploadedDocument image, CancellationToken ct)
    {
        if (image.Content.Length is 0 or > MaxImageBytes) throw new RuleException(413, "Envie uma imagem de até 10 MB.");
        if (image.ContentType is not (DocumentKinds.Jpeg or DocumentKinds.Png)) throw new RuleException(415, "Use uma imagem PNG ou JPEG.");
        if (image.ContentType == DocumentKinds.Png)
            for (var offset = 8; offset + 12 <= image.Content.Length;)
            {
                var length = BinaryPrimitives.ReadUInt32BigEndian(image.Content.AsSpan(offset, 4));
                if (length > image.Content.Length - offset - 12) throw new RuleException(400, "Imagem PNG danificada.");
                var chunk = System.Text.Encoding.ASCII.GetString(image.Content, offset + 4, 4);
                if (chunk is "acTL" or "fcTL" or "fdAT") throw new RuleException(400, "Use uma imagem estática, sem animação.");
                offset += checked((int)length + 12);
            }
        if (!await Images.WaitAsync(0, ct)) throw new RuleException(429, "Há imagens sendo preparadas. Tente novamente em instantes.");
        try
        {
            // Reaproveita a política global restritiva de coders/delegates/recursos dos avatares.
            RuntimeHelpers.RunClassConstructor(typeof(AvatarProcessor).TypeHandle);
            using var decoded = new MagickImage();
            var settings = new MagickReadSettings { Format = image.ContentType == DocumentKinds.Png ? MagickFormat.Png : MagickFormat.Jpeg };
            decoded.Ping(image.Content, settings);
            if (decoded.Width < 64 || decoded.Height < 64 || decoded.Width > 4096 || decoded.Height > 4096 || (long)decoded.Width * decoded.Height > 8000000) throw new RuleException(400, "Use imagem estática de 64–4.096 pixels por lado e até 8 milhões de pixels.");
            decoded.Read(image.Content, settings); ct.ThrowIfCancellationRequested(); decoded.AutoOrient(); decoded.Strip(); decoded.BackgroundColor = MagickColors.White; decoded.Alpha(AlphaAction.Remove); decoded.Quality = 88;
            var bytes = decoded.ToByteArray(MagickFormat.Jpeg);
            if (bytes.Length > MaxImageBytes) throw new RuleException(413, "A imagem preparada excede 10 MB.");
            return (bytes, (int)decoded.Width, (int)decoded.Height);
        }
        catch (MagickException) { throw new RuleException(400, "Imagem inválida, danificada ou acima dos limites permitidos."); }
        finally { Images.Release(); }
    }
}
