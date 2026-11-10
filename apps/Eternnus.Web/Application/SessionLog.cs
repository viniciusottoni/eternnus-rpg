using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>Linha comum às sessões jogadas no Eternnus e às registradas antes da plataforma (projeção para UNION ALL).</summary>
public sealed class SessionLogRow
{
    public string Source { get; set; } = "";
    public Guid Id { get; set; }
    public int Number { get; set; }
    public string Title { get; set; } = "";
    public DateTime? StartedAt { get; set; }
    public DateOnly? Date { get; set; }
    public bool Active { get; set; }
    public Guid? ChapterId { get; set; }
    public bool Published { get; set; }
    public bool HasText { get; set; }
}

public static class SessionLogSources
{
    public const string Eternnus = "eternnus", Past = "past";
    public static string Key(string source, Guid id) => (source == Eternnus ? "live-" : "past-") + id.ToString("D");
    /// <summary>Chave "live-{guid}" ou "past-{guid}"; qualquer outra forma é 404.</summary>
    public static (string Source, Guid Id) Parse(string? key)
    {
        if (key is { Length: 41 } && (key.StartsWith("live-") || key.StartsWith("past-")) && Guid.TryParseExact(key[5..], "D", out var id))
            return (key[0] == 'l' ? Eternnus : Past, id);
        throw new RuleException(404, "Sessão não encontrada.");
    }
}

/// <summary>
/// Tabela única de sessões (Eternnus + anteriores) para mestre e jogadores, com busca e filtros.
/// Jogador só vê sessões com resumo publicado e registros anteriores publicados; nunca objetivo, notas ou rascunhos.
/// </summary>
public sealed partial class WorkspaceService
{
    public const int LogPageSize = 20;

    static Expression<Func<PastSession, bool>> ScenesMatch(GameDb db, string pattern)
    {
        var s = Expression.Parameter(typeof(PastSession), "s");
        var c = Expression.Parameter(typeof(PastSessionScene), "c");
        var inner = Expression.Lambda<Func<PastSessionScene, bool>>(Expression.OrElse(
            TextSearch.Matches(db, Expression.Property(c, nameof(PastSessionScene.Title)), pattern),
            TextSearch.Matches(db, Expression.Property(c, nameof(PastSessionScene.Text)), pattern)), c);
        var any = Expression.Call(typeof(Enumerable), nameof(Enumerable.Any), [typeof(PastSessionScene)], Expression.Property(s, nameof(PastSession.Scenes)), inner);
        return Expression.Lambda<Func<PastSession, bool>>(any, s);
    }

    /// <summary>Consultas filtradas das duas origens, com a mesma regra de visibilidade da tabela e da busca geral.</summary>
    (IQueryable<GameSession> Live, IQueryable<PastSession> Past) LogQueries(Guid campaign, bool master, string? term, Guid? chapter, bool loose, string? source)
    {
        var live = db.Sessions.AsNoTracking().Where(s => s.CampaignId == campaign && (master || s.RecapPublishedAt != null));
        var past = db.Set<PastSession>().AsNoTracking().Where(s => s.CampaignId == campaign && (master || s.Published));
        if (source == SessionLogSources.Eternnus) past = past.Where(_ => false);
        if (source == SessionLogSources.Past) live = live.Where(_ => false);
        // Para o jogador, capítulo oculto não existe: filtrar por ele não traz nada e suas sessões contam como avulsas.
        var shown = ShownChapters(campaign);
        if (chapter is { } id) { live = live.Where(s => s.ChapterId == id && (master || shown.Contains(id))); past = past.Where(s => s.ChapterId == id && (master || shown.Contains(id))); }
        if (loose)
        {
            live = live.Where(s => s.ChapterId == null || !master && !shown.Contains(s.ChapterId.Value));
            past = past.Where(s => s.ChapterId == null || !master && !shown.Contains(s.ChapterId.Value));
        }
        if (term != null)
        {
            var pattern = TextSearch.Pattern(term);
            // Jogador busca no título e no resumo publicado; o objetivo inicial é privado do mestre.
            live = live.Where(master
                ? TextSearch.AnyField<GameSession>(db, pattern, s => s.Title, s => s.Recap, s => s.Objective)
                : TextSearch.AnyField<GameSession>(db, pattern, s => s.Title, s => s.Recap));
            past = past.Where(TextSearch.Or(TextSearch.AnyField<PastSession>(db, pattern, s => s.Title, s => s.Summary), ScenesMatch(db, pattern)));
        }
        return (live, past);
    }

    public async Task<object> Log(Guid campaign, string user, string? search, string? chapter, string? source, int page, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var master = c.OwnerId == user;
        var term = TextSearch.Term(search);
        page = Math.Clamp(page, 1, 100000);
        if (source is not (null or "" or SessionLogSources.Eternnus or SessionLogSources.Past)) throw new RuleException(400, "Origem inválida.");
        Guid? chapterId = null; var loose = chapter == "none";
        if (!loose && !string.IsNullOrEmpty(chapter)) chapterId = Guid.TryParse(chapter, out var parsed) ? parsed : throw new RuleException(400, "Capítulo inválido.");
        var (live, past) = LogQueries(campaign, master, term, chapterId, loose, source);
        var union = live.Select(s => new SessionLogRow { Source = SessionLogSources.Eternnus, Id = s.Id, Number = s.Number, Title = s.Title, StartedAt = s.StartedAt, Date = null, Active = s.EndedAt == null, ChapterId = s.ChapterId, Published = s.RecapPublishedAt != null, HasText = s.Recap != "" })
            .Concat(past.Select(s => new SessionLogRow { Source = SessionLogSources.Past, Id = s.Id, Number = s.Number, Title = s.Title, StartedAt = null, Date = s.Date, Active = false, ChapterId = s.ChapterId, Published = s.Published, HasText = s.Summary != "" }));
        var total = await live.CountAsync(ct) + await past.CountAsync(ct);
        var rows = await union.OrderByDescending(r => r.Number).ThenBy(r => r.Source).Skip((page - 1) * LogPageSize).Take(LogPageSize).ToListAsync(ct);
        var chapterIds = rows.Where(r => r.ChapterId != null).Select(r => r.ChapterId!.Value).Distinct().ToList();
        // Jogador só recebe nome e id de capítulos visíveis; nos demais a linha vai sem capítulo.
        var names = await Chapters.AsNoTracking().Where(x => chapterIds.Contains(x.Id) && (master || x.Published)).ToDictionaryAsync(x => x.Id, x => new { x.Title, x.Kind }, ct);
        var excerpts = term == null ? [] : await LogExcerpts(rows, term, master, ct);
        var chapters = await Chapters.AsNoTracking().Where(x => x.CampaignId == campaign && (master || x.Published))
            .OrderBy(x => x.Order).ThenBy(x => x.CreatedAt).Take(ChapterModel.MaxPerCampaign).Select(x => new { x.Id, x.Title, x.Kind }).ToListAsync(ct);
        return new
        {
            items = rows.Select(r => new
            {
                key = SessionLogSources.Key(r.Source, r.Id), source = r.Source, id = r.Id, number = r.Number, title = r.Title,
                startedAt = r.StartedAt is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : (DateTime?)null, date = r.Date, active = r.Active,
                chapterId = r.ChapterId is { } cid && names.ContainsKey(cid) ? cid : (Guid?)null,
                chapterTitle = r.ChapterId is { } id && names.TryGetValue(id, out var n) ? n.Title : null,
                chapterKind = r.ChapterId is { } kid && names.TryGetValue(kid, out var k) ? k.Kind : null,
                published = r.Published, hasText = r.HasText,
                excerpt = excerpts.TryGetValue(SessionLogSources.Key(r.Source, r.Id), out var e) ? e : null,
            }),
            total, page, pageSize = LogPageSize, search = term, chapters, isMaster = master,
        };
    }

    /// <summary>Trecho do texto que casou com a busca, lido só para as linhas da página.</summary>
    async Task<Dictionary<string, string>> LogExcerpts(List<SessionLogRow> rows, string term, bool master, CancellationToken ct)
    {
        var liveIds = rows.Where(r => r.Source == SessionLogSources.Eternnus).Select(r => r.Id).ToList();
        var pastIds = rows.Where(r => r.Source == SessionLogSources.Past).Select(r => r.Id).ToList();
        var result = new Dictionary<string, string>();
        foreach (var s in await db.Sessions.AsNoTracking().Where(s => liveIds.Contains(s.Id)).Select(s => new { s.Id, s.Recap, s.Objective }).ToListAsync(ct))
            if ((TextSearch.Excerpt(s.Recap, term) ?? (master ? TextSearch.Excerpt(s.Objective, term) : null)) is { } text) result[SessionLogSources.Key(SessionLogSources.Eternnus, s.Id)] = text;
        foreach (var s in await db.Set<PastSession>().AsNoTracking().Where(s => pastIds.Contains(s.Id)).ToListAsync(ct))
            if ((TextSearch.Excerpt(s.Summary, term) ?? s.Scenes.Select(c => TextSearch.Excerpt(c.Title + ": " + c.Text, term)).FirstOrDefault(x => x != null)) is { } text) result[SessionLogSources.Key(SessionLogSources.Past, s.Id)] = text;
        return result;
    }

    /// <summary>Leitura completa de uma linha. Jogador só lê o que está publicado; objetivo inicial só para o mestre.</summary>
    public async Task<object> LogEntry(Guid campaign, string key, string user, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var master = c.OwnerId == user;
        var (source, id) = SessionLogSources.Parse(key);
        // Capítulo oculto: o jogador recebe a sessão sem capítulo (id e título nulos).
        async Task<(Guid? Id, string? Title)> ChapterOfEntry(Guid? chapterId)
        {
            var found = await Chapters.AsNoTracking().Where(x => chapterId != null && x.Id == chapterId && (master || x.Published)).Select(x => new { x.Id, x.Title }).FirstOrDefaultAsync(ct);
            return found == null ? (null, null) : (found.Id, found.Title);
        }
        if (source == SessionLogSources.Eternnus)
        {
            var s = await db.Sessions.AsNoTracking().Where(s => s.Id == id && s.CampaignId == campaign && (master || s.RecapPublishedAt != null))
                .Select(s => new { s.Id, s.Number, s.Title, s.Recap, s.Objective, s.StartedAt, s.EndedAt, s.ChapterId, s.RecapPublishedAt }).SingleOrDefaultAsync(ct) ?? throw new RuleException(404, "Sessão não encontrada.");
            var liveChapter = await ChapterOfEntry(s.ChapterId);
            return new
            {
                key, source, s.Id, s.Number, s.Title, text = s.Recap, objective = master ? s.Objective : null,
                startedAt = DateTime.SpecifyKind(s.StartedAt, DateTimeKind.Utc), endedAt = s.EndedAt is { } e ? DateTime.SpecifyKind(e, DateTimeKind.Utc) : (DateTime?)null,
                active = s.EndedAt == null, published = s.RecapPublishedAt != null, chapterId = liveChapter.Id, chapterTitle = liveChapter.Title, scenes = Array.Empty<object>(), date = (DateOnly?)null, revision = 0,
            };
        }
        var p = await db.Set<PastSession>().AsNoTracking().SingleOrDefaultAsync(s => s.Id == id && s.CampaignId == campaign && (master || s.Published), ct) ?? throw new RuleException(404, "Sessão não encontrada.");
        var pastChapter = await ChapterOfEntry(p.ChapterId);
        return new
        {
            key, source, p.Id, p.Number, p.Title, text = p.Summary, objective = (string?)null, startedAt = (DateTime?)null, endedAt = (DateTime?)null,
            active = false, published = p.Published, chapterId = pastChapter.Id, chapterTitle = pastChapter.Title, scenes = p.Scenes.Select(x => new { x.Title, x.Text }), p.Date, p.Revision,
        };
    }
}
