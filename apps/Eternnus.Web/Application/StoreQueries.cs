using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StoreRef(Guid Id, string Name);
/// <summary>Produto para o público. Preço/disponibilidade só aparecem dentro da validade da última conferência.</summary>
public record StoreCardDto(Guid Id, string Marketplace, string MarketplaceName, string Title, string Description, string? ImageUrl, string Url,
    string Brand, StoreRef? Category, StoreRef[] Systems, bool Generic, int? PriceCents, int? PreviousPriceCents, string Currency,
    DateTime? PriceCheckedAt, string PriceStatus, bool OnSale, string Availability, string[] Tags);

/// <summary>Consultas e projeções da loja compartilhadas entre catálogo, recomendação e administração.</summary>
public static class StoreQueries
{
    public const int CardDescription = 300;

    /// <summary>Configuração vigente; sem linha gravada, os padrões do código (GET nunca grava).</summary>
    public static async Task<StoreSettings> SettingsAsync(GameDb db, CancellationToken ct) =>
        await db.StoreSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Id == StoreSettings.SingletonId, ct) ?? new StoreSettings();

    public static async Task<StoreUserPreferences> PreferencesAsync(GameDb db, string userId, CancellationToken ct) =>
        await db.StorePreferences.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == userId, ct) ?? new StoreUserPreferences { UserId = userId };

    /// <summary>Produtos visíveis ao público.</summary>
    public static IQueryable<StoreProduct> Public(GameDb db) =>
        db.StoreProducts.AsNoTracking().Where(p => p.DeletedAt == null && p.Status == StoreProductStatuses.Active);

    /// <summary>Ordem SQL pelos grupos 0–2 de <see cref="StoreRanking"/> (os grupos 3 e 4 dependem de termos e ficam juntos),
    /// depois prioridade, popularidade e atualização.</summary>
    public static IOrderedQueryable<StoreProduct> GroupOrdered(IQueryable<StoreProduct> query, StoreRankContext x)
    {
        var primary = x.Primary;
        var secondary = x.Secondary.Keys.ToList();
        return query
            .OrderBy(p => primary != null && p.Systems.Any(s => s.RpgSystemId == primary) ? 0
                : p.Systems.Any(s => secondary.Contains(s.RpgSystemId)) ? 1
                : !p.Systems.Any() ? 2 : 3)
            .ThenByDescending(p => p.Priority).ThenByDescending(p => p.Clicks).ThenByDescending(p => p.UpdatedAt).ThenBy(p => p.Id);
    }

    sealed class CandidateRow
    {
        public Guid Id { get; init; }
        public string Marketplace { get; init; } = "";
        public Guid? CategoryId { get; init; }
        public string Title { get; init; } = "";
        public bool HasImage { get; init; }
        public bool HasDescription { get; init; }
        public bool PriceCurrent { get; init; }
        public int Priority { get; init; }
        public DateTime CreatedAt { get; init; }
        public DateTime? PublishedAt { get; init; }
        public int Clicks { get; init; }
        public int? Exposures { get; init; }
        public long? LastCycle { get; init; }
        public List<Guid> Systems { get; init; } = [];
        public List<string> Tags { get; init; } = [];
    }

    /// <summary>Até <paramref name="window"/> candidatos (na ordem SQL dos grupos) ordenados pelo ranking completo.</summary>
    public static async Task<List<StoreRanked>> RankAsync(GameDb db, IQueryable<StoreProduct> query, StoreRankContext x, StoreSettings settings, DateTime cut, int window, CancellationToken ct,
        IReadOnlyDictionary<Guid, double>? recent = null)
    {
        var rows = await CandidatesAsync(db, GroupOrdered(query, x), null, cut, window, ct);
        var terms = await TermsAsync(db, settings, ct);
        var maxClicks = rows.Count == 0 ? 0 : rows.Max(r => r.Clicks);
        return StoreRanking.Rank(rows.Select(r => Candidate(r, terms, recent)), x with { MaxClicks = maxClicks });
    }

    /// <summary>Linhas de candidatos na ordem dada; com <paramref name="userId"/>, junta o resumo de exibições do usuário (ADR-108).</summary>
    static Task<List<CandidateRow>> CandidatesAsync(GameDb db, IQueryable<StoreProduct> ordered, string? userId, DateTime cut, int limit, CancellationToken ct)
    {
        var stats = db.StoreUserProductStats.Where(s => s.UserId == userId);
        return ordered.Take(limit).Select(p => new CandidateRow
        {
            Id = p.Id, Marketplace = p.Marketplace, CategoryId = p.CategoryId, Title = p.Title,
            HasImage = p.ImageUrl != null, HasDescription = p.Description != "",
            PriceCurrent = p.PriceCents != null && p.PriceCheckedAt != null && p.PriceCheckedAt >= cut,
            Priority = p.Priority, CreatedAt = p.CreatedAt, PublishedAt = p.PublishedAt, Clicks = p.Clicks,
            Exposures = userId == null ? null : stats.Where(s => s.ProductId == p.Id).Select(s => (int?)s.Exposures).FirstOrDefault(),
            LastCycle = userId == null ? null : stats.Where(s => s.ProductId == p.Id).Select(s => (long?)s.LastCycle).FirstOrDefault(),
            Systems = p.Systems.Select(s => s.RpgSystemId).ToList(), Tags = p.Tags.Select(t => t.Value).ToList(),
        }).ToListAsync(ct);
    }

    /// <summary>Termos de produto: vocabulário de sinônimos e palavras-chave das categorias.</summary>
    sealed record ProductTerms(StoreVocabulary Vocabulary, Dictionary<Guid, string> Keywords);
    static async Task<ProductTerms> TermsAsync(GameDb db, StoreSettings settings, CancellationToken ct) =>
        new(StoreVocabulary.Build([], settings.Synonyms), await db.StoreCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Keywords, ct));

    static StoreRankCandidate Candidate(CandidateRow r, ProductTerms terms, IReadOnlyDictionary<Guid, double>? recent) =>
        new(r.Id, r.Marketplace, r.CategoryId, r.Systems,
            terms.Vocabulary.ProductTerms(r.Title, r.Tags, r.CategoryId is { } c ? terms.Keywords.GetValueOrDefault(c) : null),
            r.HasImage, r.HasDescription, r.PriceCurrent, r.Priority, r.CreatedAt, r.Clicks, r.PublishedAt, recent?.GetValueOrDefault(r.Id) ?? 0);

    /// <summary>Filas da vitrine (ADR-108): até <paramref name="limit"/> candidatos por fila, já com grupo, pontuação e o que o
    /// usuário viu. Nunca carrega o catálogo inteiro: cada fila é ordenada e limitada no banco.</summary>
    public static async Task<List<List<StorePoolItem>>> PoolsAsync(GameDb db, IReadOnlyList<IQueryable<StoreProduct>?> ordered, string userId, StoreRankContext x,
        StoreSettings settings, DateTime cut, int limit, IReadOnlyDictionary<Guid, double> recent, IReadOnlySet<Guid> clicked, CancellationToken ct)
    {
        var rows = new List<List<CandidateRow>>();
        foreach (var query in ordered) rows.Add(query == null ? [] : await CandidatesAsync(db, query, userId, cut, limit, ct));
        if (rows.All(r => r.Count == 0)) return rows.Select(_ => new List<StorePoolItem>()).ToList();
        var terms = await TermsAsync(db, settings, ct);
        var maxClicks = rows.SelectMany(r => r).Select(r => r.Clicks).DefaultIfEmpty(0).Max();
        var context = x with { MaxClicks = maxClicks };
        return rows.Select(list => list.Select(r =>
        {
            var c = Candidate(r, terms, recent);
            var group = StoreRanking.Group(c, context);
            StoreSeen? seen = r.Exposures is { } n ? new StoreSeen(n, r.LastCycle ?? 0, clicked.Contains(r.Id)) : null;
            return new StorePoolItem(c, group, StoreRanking.Score(c, context, group), seen);
        }).ToList()).ToList();
    }

    /// <summary>Popularidade recente: pessoas distintas que clicaram em cada produto nos últimos <paramref name="days"/> dias
    /// (até 300 produtos), normalizada 0–1 em escala log. Repetir cliques não infla; cliques não são vendas.</summary>
    public static async Task<Dictionary<Guid, double>> RecentPopularityAsync(GameDb db, DateTime now, CancellationToken ct, int days = 30)
    {
        var since = now.AddDays(-days);
        var rows = await db.StoreInteractions.AsNoTracking().Where(i => i.CreatedAt >= since)
            .GroupBy(i => i.ProductId).Select(g => new { g.Key, Users = g.Select(i => i.UserId).Distinct().Count() })
            .OrderByDescending(g => g.Users).ThenBy(g => g.Key).Take(300).ToListAsync(ct);
        var top = rows.Count == 0 ? 0 : rows.Max(r => r.Users);
        return top == 0 ? [] : rows.ToDictionary(r => r.Key, r => Math.Log(1 + r.Users) / Math.Log(1 + top));
    }

    sealed class CardRow
    {
        public Guid Id { get; init; }
        public string Marketplace { get; init; } = "";
        public string Title { get; init; } = "";
        public string Description { get; init; } = "";
        public string? ImageUrl { get; init; }
        public string TargetUrl { get; init; } = "";
        public string Brand { get; init; } = "";
        public Guid? CategoryId { get; init; }
        public int? PriceCents { get; init; }
        public int? PreviousPriceCents { get; init; }
        public string Currency { get; init; } = "BRL";
        public DateTime? PriceCheckedAt { get; init; }
        public string Availability { get; init; } = "";
        public List<Guid> Systems { get; init; } = [];
        public List<string> Tags { get; init; } = [];
    }

    /// <summary>Cartões dos produtos públicos na ordem de <paramref name="ids"/> (ids ausentes ou inativos são ignorados).</summary>
    public static async Task<List<StoreCardDto>> CardsAsync(GameDb db, IReadOnlyList<Guid> ids, DateTime cut, bool full, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var list = ids.ToList();
        var rows = await Public(db).Where(p => list.Contains(p.Id)).Select(p => new CardRow
        {
            Id = p.Id, Marketplace = p.Marketplace, Title = p.Title, Description = p.Description, ImageUrl = p.ImageUrl, TargetUrl = p.TargetUrl,
            Brand = p.Brand, CategoryId = p.CategoryId, PriceCents = p.PriceCents, PreviousPriceCents = p.PreviousPriceCents, Currency = p.Currency,
            PriceCheckedAt = p.PriceCheckedAt, Availability = p.Availability,
            Systems = p.Systems.Select(s => s.RpgSystemId).ToList(), Tags = p.Tags.Select(t => t.Value).ToList(),
        }).ToListAsync(ct);
        var systemIds = rows.SelectMany(r => r.Systems).Distinct().ToList();
        var systems = await db.RpgSystems.AsNoTracking().Where(s => systemIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
        var categoryIds = rows.Where(r => r.CategoryId != null).Select(r => r.CategoryId!.Value).Distinct().ToList();
        var categories = await db.StoreCategories.AsNoTracking().Where(c => categoryIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var byId = rows.ToDictionary(r => r.Id);
        return list.Where(byId.ContainsKey).Select(id =>
        {
            var r = byId[id];
            var current = r.PriceCheckedAt is { } checkedAt && checkedAt >= cut;
            var price = current ? r.PriceCents : null;
            var previous = price != null && r.PreviousPriceCents > price ? r.PreviousPriceCents : null;
            var description = full || r.Description.Length <= CardDescription ? r.Description : r.Description[..CardDescription].TrimEnd() + "…";
            return new StoreCardDto(r.Id, r.Marketplace, StoreMarketplaces.Name(r.Marketplace), r.Title, description, r.ImageUrl, r.TargetUrl, r.Brand,
                r.CategoryId is { } c && categories.TryGetValue(c, out var cn) ? new StoreRef(c, cn) : null,
                r.Systems.Where(systems.ContainsKey).Select(s => new StoreRef(s, systems[s])).OrderBy(s => s.Name).ToArray(), r.Systems.Count == 0,
                price, previous, r.Currency, r.PriceCheckedAt, current && price != null ? "current" : r.PriceCents != null ? "stale" : "none",
                previous != null, current ? r.Availability : StoreAvailability.Unknown, r.Tags.OrderBy(t => t).ToArray());
        }).ToList();
    }
}
