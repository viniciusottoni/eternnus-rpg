using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;
public sealed partial class WorkspaceService
{
    public async Task EnsureEditor(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, true, ct);
        if (!await Pages.AnyAsync(p => p.Id == id && p.CampaignId == campaign && p.DeletedAt == null && (p.OwnerId == user || p.Kind != "note" && c.OwnerId == user), ct)) throw Missing();
    }
    public async Task<object> Attachments(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        await Read(campaign, id, user, ct);
        return await db.Set<WorkspaceAttachment>().Where(f => f.PageId == id).Select(f => new { f.Id, f.Name, f.Size, f.ContentType }).Take(10).ToListAsync(ct);
    }
    public async Task<object> Attach(Guid campaign, Guid id, string user, UploadedDocument file, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct); await EnsureEditor(campaign, id, user, ct);
        if (await db.Set<WorkspaceAttachment>().CountAsync(f => f.PageId == id, ct) >= 10 || (await db.Set<WorkspaceAttachment>().Where(f => Pages.Any(p => p.Id == f.PageId && p.CampaignId == campaign)).SumAsync(f => (long?)f.Size, ct) ?? 0) + file.Content.Length > 250L * 1024 * 1024) throw new RuleException(409, "Limite de dez anexos por página ou 250 MB por campanha.");
        var f = new WorkspaceAttachment { PageId = id, Name = file.FileName, ContentType = file.ContentType, Content = file.Content, Size = file.Content.LongLength };
        db.Add(f); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new { f.Id, f.Name, f.Size, f.ContentType };
    }
    public async Task<WorkspaceAttachment> Attachment(Guid campaign, Guid id, Guid file, string user, CancellationToken ct)
    {
        await Read(campaign, id, user, ct);
        return await db.Set<WorkspaceAttachment>().AsNoTracking().SingleOrDefaultAsync(f => f.PageId == id && f.Id == file, ct) ?? throw Missing();
    }
    public async Task RemoveAttachment(Guid campaign, Guid id, Guid file, string user, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(campaign, user, ct); await EnsureEditor(campaign, id, user, ct);
        var f = await db.Set<WorkspaceAttachment>().SingleOrDefaultAsync(f => f.PageId == id && f.Id == file, ct) ?? throw Missing(); db.Remove(f); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
    public async Task<object> Notebook(string user, int page, CancellationToken ct)
    {
        page = Math.Clamp(page, 1, 100000);
        var q = Pages.AsNoTracking().Where(p => p.OwnerId == user && p.Kind == "note" && p.DeletedAt == null);
        return new { items = await q.OrderByDescending(p => p.UpdatedAt).Skip((page - 1) * 20).Take(20).Select(p => new { p.Id, p.Title, p.UpdatedAt }).ToListAsync(ct), total = await q.CountAsync(ct), page, pageSize = 20 };
    }
    public async Task<object> OwnNote(Guid id, string user, CancellationToken ct) => await Pages.AsNoTracking().Where(p => p.Id == id && p.OwnerId == user && p.Kind == "note" && p.DeletedAt == null).Select(p => new { p.Id, p.Title, p.Content, p.Secrets }).SingleOrDefaultAsync(ct) ?? throw Missing();
}
