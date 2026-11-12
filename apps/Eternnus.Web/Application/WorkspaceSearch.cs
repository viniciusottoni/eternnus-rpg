using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

/// <summary>
/// Busca geral da campanha (Visão geral): sessões, capítulos, páginas e notas, diário, NPCs, cenas e premissa.
/// Cada fonte aplica a mesma regra de visibilidade da sua tela; o resultado traz só título, trecho e a rota da tela de origem.
/// Sem limite por tipo: todos os acertos, paginados em <see cref="SearchPageSize"/>, até o teto técnico <see cref="MaxSearchHits"/>.
/// </summary>
public sealed partial class WorkspaceService
{
    /// <summary>Resultados por página da busca geral (tabela de 20 itens).</summary>
    public const int SearchPageSize = 20;
    /// <summary>Teto de acertos por busca (por fonte e no total): limita memória por requisição.</summary>
    public const int MaxSearchHits = 500;

    /// <summary>Tipos aceitos no filtro <c>kind</c>; os mesmos valores devolvidos em cada resultado.</summary>
    public static readonly IReadOnlySet<string> SearchKinds = new HashSet<string> { "premise", "session", "chapter", "scene", "page", "note", "objective", "clue", "library", "npc" };

    public sealed record SearchHit(string Kind, string Title, string? Excerpt, string Route);

    public async Task<object> Search(Guid campaign, string user, string? q, string? kind, int page, CancellationToken ct)
    {
        var c = await Access(campaign, user, false, ct);
        var term = TextSearch.Term(q) ?? throw new RuleException(400, $"Digite ao menos {TextSearch.MinLength} caracteres para buscar.");
        var only = string.IsNullOrWhiteSpace(kind) ? null : kind.Trim();
        if (only != null && !SearchKinds.Contains(only)) throw new RuleException(400, "Tipo de resultado inválido.");
        // Com filtro de tipo, só a fonte correspondente é consultada.
        bool Want(params string[] kinds) => only == null || kinds.Contains(only);
        var master = c.OwnerId == user;
        var pattern = TextSearch.Pattern(term);
        var root = $"campaign/{campaign:D}";
        var hits = new List<SearchHit>();
        var capped = false;
        List<T> Cap<T>(List<T> rows) { capped |= rows.Count >= MaxSearchHits; return rows; }

        // Premissa e "onde paramos": membros já leem ambos na página da campanha.
        if (Want("premise"))
        {
            if (TextSearch.Excerpt(c.Description, term) is { } premise) hits.Add(new("premise", "Premissa", premise, $"{root}/overview/premise"));
            if (TextSearch.Excerpt(c.Continuity, term) is { } continuity) hits.Add(new("premise", "Onde paramos", continuity, $"{root}/overview"));
        }

        // Sessões: mesma consulta e visibilidade da tabela de sessões.
        if (Want("session"))
        {
            var (live, past) = LogQueries(campaign, master, term, null, false, null);
            var liveRows = Cap(await live.OrderByDescending(s => s.Number).Take(MaxSearchHits).Select(s => new { s.Id, s.Number, s.Title, s.Recap, Objective = master ? s.Objective : "" }).ToListAsync(ct));
            var pastRows = Cap(await past.OrderByDescending(s => s.Number).Take(MaxSearchHits).ToListAsync(ct));
            hits.AddRange(liveRows.Select(s => new SearchHit("session", $"Sessão {s.Number:00} — {s.Title}", TextSearch.Excerpt(s.Recap, term) ?? TextSearch.Excerpt(s.Objective, term), $"{root}/sessions/{SessionLogSources.Key(SessionLogSources.Eternnus, s.Id)}")));
            hits.AddRange(pastRows.Select(s => new SearchHit("session", $"Sessão {s.Number:00} — {s.Title}", TextSearch.Excerpt(s.Summary, term) ?? s.Scenes.Select(x => TextSearch.Excerpt(x.Title + ": " + x.Text, term)).FirstOrDefault(x => x != null), $"{root}/sessions/{SessionLogSources.Key(SessionLogSources.Past, s.Id)}")));
        }

        // Capítulos: jogador encontra só os visíveis.
        if (Want("chapter"))
        {
            var chapters = Cap(await Chapters.AsNoTracking().Where(x => x.CampaignId == campaign && (master || x.Published)).Where(TextSearch.AnyField<StoryChapter>(db, pattern, x => x.Title, x => x.Summary))
                .OrderBy(x => x.Order).Take(MaxSearchHits).Select(x => new { x.Id, x.Title, x.Summary }).ToListAsync(ct));
            hits.AddRange(chapters.Select(x => new SearchHit("chapter", x.Title, TextSearch.Excerpt(x.Summary, term), $"{root}/sessions/chapter-{x.Id:D}")));
        }
        if (master && Want("scene"))
        {
            var scenes = Cap(await db.Scenes.AsNoTracking().Where(x => x.CampaignId == campaign).Where(TextSearch.AnyField<Scene>(db, pattern, x => x.Name, x => x.Description, x => x.SharedText, x => x.PrivateNotes))
                .OrderBy(x => x.Order).Take(MaxSearchHits).Select(x => new { x.Name, x.Description, x.SharedText, x.PrivateNotes }).ToListAsync(ct));
            hits.AddRange(scenes.Select(x => new SearchHit("scene", x.Name, TextSearch.Excerpt(x.SharedText, term) ?? TextSearch.Excerpt(x.Description, term) ?? TextSearch.Excerpt(x.PrivateNotes, term), $"{root}/prep")));
        }

        // Páginas do mundo e notas: mesma regra de leitura do acervo; segredos nunca entram na busca.
        if (Want("page", "note", "objective", "clue"))
        {
            var pages = Cap(await Visible(campaign, user, c.OwnerId).Where(p => p.DeletedAt == null).Where(TextSearch.AnyField<WorkspacePage>(db, pattern, p => p.Title, p => p.Content, p => p.Tags, p => p.Collection))
                .OrderByDescending(p => p.UpdatedAt).Take(MaxSearchHits).Select(p => new { p.Id, p.Title, p.Content, p.Kind }).ToListAsync(ct));
            hits.AddRange(pages.Select(p => new SearchHit(p.Kind is "note" or "objective" or "clue" ? p.Kind : "page", p.Title, TextSearch.Excerpt(p.Content, term), $"{root}/{(p.Kind == "note" ? "notes" : "world")}/{p.Id:D}")));
        }

        // Textos antigos ainda não convertidos em página: jogador só os publicados.
        if (Want("library"))
        {
            var entries = Cap(await db.Set<CampaignLibraryEntry>().AsNoTracking().Where(e => e.CampaignId == campaign && e.ConvertedPageId == null && (master || e.Published)).Where(TextSearch.AnyField<CampaignLibraryEntry>(db, pattern, e => e.Title, e => e.Text))
                .OrderByDescending(e => e.UpdatedAt).Take(MaxSearchHits).Select(e => new { e.Title, e.Text }).ToListAsync(ct));
            hits.AddRange(entries.Select(e => new SearchHit("library", e.Title, TextSearch.Excerpt(e.Text, term), $"{root}/resources")));
        }

        // NPCs: mestre busca nos seus (inclusive notas); jogador só nome e resumo dos compartilhados.
        if (Want("npc"))
        {
            var npcs = db.MasterCharacters.AsNoTracking().Where(m => m.CampaignId == campaign && (master || m.SharedWithPlayers));
            npcs = npcs.Where(master ? TextSearch.AnyField<MasterCharacter>(db, pattern, m => m.Name, m => m.Summary, m => m.Notes) : TextSearch.AnyField<MasterCharacter>(db, pattern, m => m.Name, m => m.Summary));
            var npcRows = Cap(await npcs.OrderBy(m => m.Name).Take(MaxSearchHits).Select(m => new { m.Id, m.Name, m.Summary, Notes = master ? m.Notes : "", m.SharedWithPlayers }).ToListAsync(ct));
            hits.AddRange(npcRows.Select(m => new SearchHit("npc", m.Name, TextSearch.Excerpt(m.Summary, term) ?? TextSearch.Excerpt(m.Notes, term), m.SharedWithPlayers ? $"{root}/npcs/{m.Id:D}" : $"{root}/prep")));
        }

        // Páginas/notas/objetivos/pistas vêm da mesma fonte: o filtro final separa o tipo pedido.
        if (only != null) hits = hits.Where(h => h.Kind == only).ToList();
        var truncated = capped || hits.Count > MaxSearchHits;
        if (hits.Count > MaxSearchHits) hits = hits.Take(MaxSearchHits).ToList();
        // Página além da última volta para a última; ordem estável por fonte.
        var pageCount = Math.Max(1, (hits.Count + SearchPageSize - 1) / SearchPageSize);
        var current = Math.Clamp(page, 1, pageCount);
        var slice = hits.Skip((current - 1) * SearchPageSize).Take(SearchPageSize);
        return new { q = term, kind = only, items = slice.Select(h => new { kind = h.Kind, title = h.Title, excerpt = h.Excerpt, route = h.Route }), total = hits.Count, truncated, page = current, pageSize = SearchPageSize };
    }
}
