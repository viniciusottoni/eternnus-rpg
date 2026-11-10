using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Busca geral da campanha (Visão geral): sessões, capítulos, páginas e notas, diário, NPCs, cenas e premissa.
/// Cada fonte aplica a mesma regra de visibilidade da sua tela; o resultado traz só título, trecho e a rota da tela de origem.
/// </summary>
public sealed partial class WorkspaceService
{
    public const int SearchPerKind = 8;

    public sealed record SearchHit(string Kind, string Title, string? Excerpt, string Route);

    public async Task<object> Search(Guid campaign, string user, string? q, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var term = TextSearch.Term(q) ?? throw new RuleException(400, $"Digite ao menos {TextSearch.MinLength} caracteres para buscar.");
        var master = c.OwnerId == user;
        var pattern = TextSearch.Pattern(term);
        var root = $"campaign/{campaign:D}";
        var hits = new List<SearchHit>();

        // Premissa e "onde paramos": membros já leem ambos na página da campanha.
        if (TextSearch.Excerpt(c.Description, term) is { } premise) hits.Add(new("premise", "Premissa", premise, $"{root}/overview/premise"));
        if (TextSearch.Excerpt(c.Continuity, term) is { } continuity) hits.Add(new("premise", "Onde paramos", continuity, $"{root}/overview"));

        // Sessões: mesma consulta e visibilidade da tabela de sessões.
        var (live, past) = LogQueries(campaign, master, term, null, false, null);
        var liveRows = await live.OrderByDescending(s => s.Number).Take(SearchPerKind).Select(s => new { s.Id, s.Number, s.Title, s.Recap, Objective = master ? s.Objective : "" }).ToListAsync(ct);
        var pastRows = await past.OrderByDescending(s => s.Number).Take(SearchPerKind).ToListAsync(ct);
        hits.AddRange(liveRows.Select(s => new SearchHit("session", $"Sessão {s.Number:00} — {s.Title}", TextSearch.Excerpt(s.Recap, term) ?? TextSearch.Excerpt(s.Objective, term), $"{root}/sessions/{SessionLogSources.Key(SessionLogSources.Eternnus, s.Id)}")));
        hits.AddRange(pastRows.Select(s => new SearchHit("session", $"Sessão {s.Number:00} — {s.Title}", TextSearch.Excerpt(s.Summary, term) ?? s.Scenes.Select(x => TextSearch.Excerpt(x.Title + ": " + x.Text, term)).FirstOrDefault(x => x != null), $"{root}/sessions/{SessionLogSources.Key(SessionLogSources.Past, s.Id)}")));

        if (master)
        {
            var chapters = await Chapters.AsNoTracking().Where(x => x.CampaignId == campaign).Where(TextSearch.AnyField<StoryChapter>(db, pattern, x => x.Title, x => x.Summary))
                .OrderBy(x => x.Order).Take(SearchPerKind).Select(x => new { x.Id, x.Title, x.Summary }).ToListAsync(ct);
            hits.AddRange(chapters.Select(x => new SearchHit("chapter", x.Title, TextSearch.Excerpt(x.Summary, term), $"{root}/sessions/chapter-{x.Id:D}")));
            var scenes = await db.Scenes.AsNoTracking().Where(x => x.CampaignId == campaign).Where(TextSearch.AnyField<Scene>(db, pattern, x => x.Name, x => x.Description, x => x.SharedText, x => x.PrivateNotes))
                .OrderBy(x => x.Order).Take(SearchPerKind).Select(x => new { x.Name, x.Description, x.SharedText, x.PrivateNotes }).ToListAsync(ct);
            hits.AddRange(scenes.Select(x => new SearchHit("scene", x.Name, TextSearch.Excerpt(x.SharedText, term) ?? TextSearch.Excerpt(x.Description, term) ?? TextSearch.Excerpt(x.PrivateNotes, term), $"{root}/prep")));
        }

        // Páginas do mundo e notas: mesma regra de leitura do acervo; segredos nunca entram na busca.
        var pages = await Visible(campaign, user, c.OwnerId).Where(p => p.DeletedAt == null).Where(TextSearch.AnyField<WorkspacePage>(db, pattern, p => p.Title, p => p.Content, p => p.Tags, p => p.Collection))
            .OrderByDescending(p => p.UpdatedAt).Take(SearchPerKind).Select(p => new { p.Id, p.Title, p.Content, p.Kind }).ToListAsync(ct);
        hits.AddRange(pages.Select(p => new SearchHit(p.Kind == "note" ? "note" : "page", p.Title, TextSearch.Excerpt(p.Content, term), $"{root}/{(p.Kind == "note" ? "notes" : "world")}/{p.Id:D}")));

        // Diário (objetivos/pistas) e textos da biblioteca: jogador só os publicados.
        var entries = await db.Set<CampaignLibraryEntry>().AsNoTracking().Where(e => e.CampaignId == campaign && (master || e.Published)).Where(TextSearch.AnyField<CampaignLibraryEntry>(db, pattern, e => e.Title, e => e.Text))
            .OrderByDescending(e => e.UpdatedAt).Take(SearchPerKind).Select(e => new { e.Title, e.Text, e.Kind }).ToListAsync(ct);
        hits.AddRange(entries.Select(e => new SearchHit(e.Kind is "objective" or "clue" ? e.Kind : "library", e.Title, TextSearch.Excerpt(e.Text, term), e.Kind is "objective" or "clue" ? $"{root}/journal" : $"{root}/resources")));

        // NPCs: mestre busca nos seus (inclusive notas); jogador só nome e resumo dos compartilhados.
        var npcs = db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaign && (master || m.SharedWithPlayers));
        npcs = npcs.Where(master ? TextSearch.AnyField<MasterCharacter>(db, pattern, m => m.Name, m => m.Summary, m => m.Notes) : TextSearch.AnyField<MasterCharacter>(db, pattern, m => m.Name, m => m.Summary));
        var npcRows = await npcs.OrderBy(m => m.Name).Take(SearchPerKind).Select(m => new { m.Id, m.Name, m.Summary, Notes = master ? m.Notes : "", m.SharedWithPlayers }).ToListAsync(ct);
        hits.AddRange(npcRows.Select(m => new SearchHit("npc", m.Name, TextSearch.Excerpt(m.Summary, term) ?? TextSearch.Excerpt(m.Notes, term), m.SharedWithPlayers ? $"{root}/npcs/{m.Id:D}" : $"{root}/prep")));

        return new { q = term, items = hits.Select(h => new { kind = h.Kind, title = h.Title, excerpt = h.Excerpt, route = h.Route }), perKind = SearchPerKind };
    }
}
