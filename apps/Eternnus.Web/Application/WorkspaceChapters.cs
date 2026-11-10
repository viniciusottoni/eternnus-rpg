using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record ChapterInput(string Title, string? Kind = null, string? Summary = null, int Revision = 0);
public record ChapterMoveInput(int Direction, int Revision);

/// <summary>Capítulos/atos/arcos da campanha: organização privada do mestre para agrupar sessões. Escritas sob o bloqueio da campanha.</summary>
public sealed partial class WorkspaceService
{
    IQueryable<StoryChapter> Chapters => db.Set<StoryChapter>();

    async Task<Campaign> MasterLock(Guid campaign, string user, CancellationToken ct)
    {
        var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre organiza capítulos.");
        return c;
    }

    /// <summary>Sem <paramref name="page"/>: todos (até 200, para seletores). Com página: vinte por vez, para a tabela.</summary>
    public async Task<object> ChapterList(Guid campaign, string user, CancellationToken ct, int? page = null)
    {
        var c = await Access(campaign, user, false, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre organiza capítulos.");
        var ordered = Chapters.AsNoTracking().Where(x => x.CampaignId == campaign).OrderBy(x => x.Order).ThenBy(x => x.CreatedAt);
        var total = await ordered.CountAsync(ct);
        var current = Math.Clamp(page ?? 1, 1, 100000);
        var items = await (page == null ? ordered.Take(ChapterModel.MaxPerCampaign) : ordered.Skip((current - 1) * LogPageSize).Take(LogPageSize))
            .Select(x => new
            {
                x.Id, x.Kind, x.Title, x.Summary, x.Order, x.Revision,
                sessionCount = db.Sessions.Count(s => s.ChapterId == x.Id),
                pastCount = db.Set<PastSession>().Count(s => s.ChapterId == x.Id),
                firstNumber = db.Sessions.Where(s => s.ChapterId == x.Id).Select(s => (int?)s.Number).Concat(db.Set<PastSession>().Where(s => s.ChapterId == x.Id).Select(s => (int?)s.Number)).Min(),
                lastNumber = db.Sessions.Where(s => s.ChapterId == x.Id).Select(s => (int?)s.Number).Concat(db.Set<PastSession>().Where(s => s.ChapterId == x.Id).Select(s => (int?)s.Number)).Max(),
            }).ToListAsync(ct);
        var loose = await db.Sessions.CountAsync(s => s.CampaignId == campaign && s.ChapterId == null, ct) + await db.Set<PastSession>().CountAsync(s => s.CampaignId == campaign && s.ChapterId == null, ct);
        return new { items, looseSessions = loose, max = ChapterModel.MaxPerCampaign, total, page = current, pageSize = page == null ? ChapterModel.MaxPerCampaign : LogPageSize, offset = page == null ? 0 : (current - 1) * LogPageSize };
    }

    static (string Title, string Kind, string Summary) ChapterFields(ChapterInput x)
    {
        var title = (x.Title ?? "").Trim();
        var kind = string.IsNullOrWhiteSpace(x.Kind) ? ChapterKinds.Chapter : x.Kind.Trim();
        var summary = (x.Summary ?? "").Trim();
        if (title.Length is 0 or > 120) throw new RuleException(400, "Informe o título com até 120 caracteres.");
        if (!ChapterKinds.All.Contains(kind)) throw new RuleException(400, "Escolha capítulo, ato ou arco.");
        if (summary.Length > 2000) throw new RuleException(400, "O resumo do capítulo aceita até 2.000 caracteres.");
        return (title, kind, summary);
    }

    public async Task<StoryChapter> SaveChapter(Guid campaign, Guid? id, string user, ChapterInput x, CancellationToken ct)
    {
        var (title, kind, summary) = ChapterFields(x);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await MasterLock(campaign, user, ct);
        StoryChapter chapter;
        if (id == null)
        {
            if (await Chapters.CountAsync(c => c.CampaignId == campaign, ct) >= ChapterModel.MaxPerCampaign) throw new RuleException(409, $"Limite de {ChapterModel.MaxPerCampaign} capítulos por campanha.");
            var order = (await Chapters.Where(c => c.CampaignId == campaign).MaxAsync(c => (int?)c.Order, ct) ?? -1) + 1;
            chapter = new StoryChapter { CampaignId = campaign, Order = order, CreatedAt = DateTime.UtcNow };
            db.Add(chapter);
        }
        else
        {
            chapter = await Chapters.SingleOrDefaultAsync(c => c.CampaignId == campaign && c.Id == id, ct) ?? throw Missing();
            if (chapter.Revision != x.Revision) throw new RuleException(409, "O capítulo mudou. Reabra antes de salvar.");
            chapter.Revision++;
        }
        chapter.Title = title; chapter.Kind = kind; chapter.Summary = summary;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return chapter;
    }

    /// <summary>Troca a posição com o capítulo vizinho (-1 sobe, 1 desce). Renumera a ordem para manter sequência contínua.</summary>
    public async Task MoveChapter(Guid campaign, Guid id, string user, ChapterMoveInput x, CancellationToken ct)
    {
        if (x.Direction is not (-1 or 1)) throw new RuleException(400, "Direção inválida.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await MasterLock(campaign, user, ct);
        var list = await Chapters.Where(c => c.CampaignId == campaign).OrderBy(c => c.Order).ThenBy(c => c.CreatedAt).ToListAsync(ct);
        var i = list.FindIndex(c => c.Id == id);
        if (i < 0) throw Missing();
        if (list[i].Revision != x.Revision) throw new RuleException(409, "O capítulo mudou. Atualize a lista.");
        var j = i + x.Direction;
        if (j < 0 || j >= list.Count) return;
        (list[i], list[j]) = (list[j], list[i]);
        for (var k = 0; k < list.Count; k++) if (list[k].Order != k) { list[k].Order = k; list[k].Revision++; }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    /// <summary>Exclui só o capítulo: as sessões vinculadas continuam e ficam avulsas.</summary>
    public async Task DeleteChapter(Guid campaign, Guid id, string user, int revision, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await MasterLock(campaign, user, ct);
        var chapter = await Chapters.SingleOrDefaultAsync(c => c.CampaignId == campaign && c.Id == id, ct) ?? throw Missing();
        if (chapter.Revision != revision) throw new RuleException(409, "O capítulo mudou. Atualize a lista.");
        await db.Sessions.Where(s => s.ChapterId == id).ExecuteUpdateAsync(u => u.SetProperty(s => s.ChapterId, (Guid?)null), ct);
        await db.Set<PastSession>().Where(s => s.ChapterId == id).ExecuteUpdateAsync(u => u.SetProperty(s => s.ChapterId, (Guid?)null), ct);
        db.Remove(chapter);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    /// <summary>Confere que o capítulo pertence à campanha. Nulo = sessão avulsa.</summary>
    public static async Task<Guid?> ChapterOf(GameDb db, Guid campaign, Guid? chapterId, CancellationToken ct)
    {
        if (chapterId == null) return null;
        if (!await db.Set<StoryChapter>().AnyAsync(c => c.Id == chapterId && c.CampaignId == campaign, ct)) throw new RuleException(400, "Capítulo não encontrado nesta campanha.");
        return chapterId;
    }
}
