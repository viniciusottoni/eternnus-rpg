using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Ponto da linha do tempo. <c>After</c>/<c>First</c> só valem na criação de acontecimentos (posição de inserção).</summary>
public record TimelineInput(string Title, string? When = null, string? Summary = null, string? Details = null, string Kind = TimelineKinds.Event, bool Published = false, int Revision = 0, Guid? After = null, bool First = false);
public record TimelineMove(int To, int Revision);

/// <summary>Linha do tempo da história da campanha. O mestre escreve; membros leem só os pontos publicados (ADR-061/062).</summary>
public sealed partial class WorkspaceService
{
    public const int MaxTimelineEvents = 300;
    IQueryable<TimelineEvent> Timeline(Guid campaign, Campaign c, string user) =>
        db.Set<TimelineEvent>().Where(e => e.CampaignId == campaign && (c.OwnerId == user || e.Published));

    /// <summary>Linha inteira (limitada a 300 acontecimentos + 2 marcos), sem a descrição longa.</summary>
    public async Task<object> TimelineList(Guid campaign, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var items = await Timeline(campaign, c, user)
            .OrderBy(e => e.Kind == TimelineKinds.Start ? 0 : e.Kind == TimelineKinds.Event ? 1 : 2).ThenBy(e => e.Position).ThenBy(e => e.Id)
            .Take(MaxTimelineEvents + 2)
            .Select(e => new { e.Id, e.Kind, e.Position, e.Title, e.When, e.Summary, hasDetails = e.Details != "", e.Published, e.Revision })
            .ToListAsync(ct);
        return new { items, canEdit = c.OwnerId == user && c.ArchivedAt == null, limit = MaxTimelineEvents };
    }

    public async Task<object> TimelineRead(Guid campaign, Guid id, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        return await Timeline(campaign, c, user).Where(e => e.Id == id)
            .Select(e => new { e.Id, e.Kind, e.Position, e.Title, e.When, e.Summary, e.Details, e.Published, e.Revision })
            .SingleOrDefaultAsync(ct) ?? throw Missing();
    }

    static void ValidateTimeline(TimelineInput x)
    {
        if (string.IsNullOrWhiteSpace(x.Title) || x.Title.Trim().Length > 120 || (x.When?.Trim().Length ?? 0) > 60 || (x.Summary?.Trim().Length ?? 0) > 280 || (x.Details?.Length ?? 0) > 10000 || !TimelineKinds.All.Contains(x.Kind))
            throw new RuleException(400, "Confira título (até 120), data (até 60), descrição curta (até 280) e descrição longa (até 10.000 caracteres).");
    }

    public async Task<object> TimelineSave(Guid campaign, Guid? id, string user, TimelineInput x, CancellationToken ct)
    {
        ValidateTimeline(x);
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre edita a linha do tempo.");
        var set = db.Set<TimelineEvent>();
        TimelineEvent e;
        if (id == null)
        {
            if (x.Kind != TimelineKinds.Event)
            {
                if (await set.AnyAsync(o => o.CampaignId == campaign && o.Kind == x.Kind, ct)) throw new RuleException(409, x.Kind == TimelineKinds.Start ? "A linha já tem um ponto de início." : "A linha já tem um ponto de fim.");
                e = new TimelineEvent { CampaignId = campaign, Kind = x.Kind };
            }
            else
            {
                var events = await set.Where(o => o.CampaignId == campaign && o.Kind == TimelineKinds.Event).OrderBy(o => o.Position).ThenBy(o => o.Id).ToListAsync(ct);
                if (events.Count >= MaxTimelineEvents) throw new RuleException(409, $"Limite de {MaxTimelineEvents} acontecimentos por campanha.");
                var at = x.First ? 0 : events.Count;
                if (!x.First && x.After != null) at = events.FindIndex(o => o.Id == x.After) is var i and >= 0 ? i + 1 : throw Missing();
                e = new TimelineEvent { CampaignId = campaign };
                events.Insert(at, e);
                for (var i = 0; i < events.Count; i++) events[i].Position = i;
            }
            set.Add(e);
        }
        else
        {
            e = await set.SingleOrDefaultAsync(o => o.CampaignId == campaign && o.Id == id, ct) ?? throw Missing();
            if (e.Revision != x.Revision) throw new RuleException(409, "O ponto mudou. Reabra antes de salvar.");
            if (e.Kind != x.Kind) throw new RuleException(400, "O tipo do ponto não pode ser trocado.");
            e.Revision++;
        }
        var wasPublished = id != null && e.Published;
        e.Title = x.Title.Trim(); e.When = x.When?.Trim() ?? ""; e.Summary = x.Summary?.Trim() ?? ""; e.Details = x.Details ?? "";
        e.Published = x.Published; e.UpdatedAt = DateTime.UtcNow;
        if (e.Published && !wasPublished) await NoticeService.NotifyAsync(db, campaign, user, NoticeAreas.Timeline, e.Id.ToString(), NoticeAudience.Players, ct);
        if (!e.Published && wasPublished) await NoticeService.ForgetAsync(db, campaign, e.Id.ToString(), ct, NoticeAreas.Timeline);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new { e.Id, e.Kind, e.Position, e.Revision, e.Published };
    }

    /// <summary>Move um acontecimento para a posição <paramref name="x"/>.To (0 = primeiro) e renumera a sequência.</summary>
    public async Task TimelineMoveTo(Guid campaign, Guid id, string user, TimelineMove x, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre edita a linha do tempo.");
        var events = await db.Set<TimelineEvent>().Where(o => o.CampaignId == campaign && o.Kind == TimelineKinds.Event).OrderBy(o => o.Position).ThenBy(o => o.Id).ToListAsync(ct);
        var e = events.SingleOrDefault(o => o.Id == id) ?? throw Missing();
        if (e.Revision != x.Revision) throw new RuleException(409, "O ponto mudou. Atualize a linha antes de mover.");
        events.Remove(e); events.Insert(Math.Clamp(x.To, 0, events.Count), e);
        for (var i = 0; i < events.Count; i++) events[i].Position = i;
        e.Revision++;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }

    public async Task TimelineDelete(Guid campaign, Guid id, string user, int revision, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct); var c = await Lock(campaign, user, ct);
        if (c.OwnerId != user) throw new RuleException(403, "Somente o mestre edita a linha do tempo.");
        var e = await db.Set<TimelineEvent>().SingleOrDefaultAsync(o => o.CampaignId == campaign && o.Id == id, ct) ?? throw Missing();
        if (e.Revision != revision) throw new RuleException(409, "O ponto mudou. Reabra antes de excluir.");
        db.Remove(e);
        if (e.Kind == TimelineKinds.Event)
        {
            var rest = await db.Set<TimelineEvent>().Where(o => o.CampaignId == campaign && o.Kind == TimelineKinds.Event && o.Id != id).OrderBy(o => o.Position).ThenBy(o => o.Id).ToListAsync(ct);
            for (var i = 0; i < rest.Count; i++) rest[i].Position = i;
        }
        await NoticeService.ForgetAsync(db, campaign, e.Id.ToString(), ct, NoticeAreas.Timeline);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
