using System.Linq.Expressions;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StoreCatalogQuery(string? Q = null, string[]? System = null, Guid[]? Category = null, string[]? Marketplace = null, decimal? MinPrice = null,
    decimal? MaxPrice = null, bool? Available = null, bool? OnSale = null, string? Sort = null, int Page = 1, Guid? CampaignId = null);
public record StorePageDto(List<StoreCardDto> Items, int Total, int Page, int PageSize, string Sort, bool Personalized, StoreContextDto Context);
public record StoreSuggestionDto(Guid Id, string Title);
public record StoreFacetDto(Guid Id, string Name, string Slug, int Count);
public record StoreSystemFacetDto(Guid Id, string Name, int Count);
public record StoreMarketplaceFacetDto(string Key, string Name, int Count);
public record StoreFiltersDto(List<StoreFacetDto> Categories, List<StoreSystemFacetDto> Systems, List<StoreMarketplaceFacetDto> Marketplaces, int GenericCount, bool Popularity, int PriceStaleHours);

public record StoreProductInput(string? AffiliateUrl, string? Title, string? Description = null, string? ImageUrl = null, string? Brand = null, Guid? CategoryId = null,
    Guid[]? SystemIds = null, string[]? Tags = null, int? PriceCents = null, int? PreviousPriceCents = null, string? Currency = "BRL", bool ConfirmPrice = false,
    string? Availability = null, string? Status = null, int Priority = 0, string? ExternalId = null, string? CanonicalUrl = null, int Revision = 0);
public record StoreAdminProductDto(Guid Id, string Marketplace, string MarketplaceName, string AffiliateUrl, string TargetUrl, string? CanonicalUrl, string? ExternalId,
    string Title, string Description, string? ImageUrl, string Brand, Guid? CategoryId, Guid[] SystemIds, string[] Tags, int? PriceCents, int? PreviousPriceCents,
    string Currency, DateTime? PriceCheckedAt, string Availability, string Status, int Priority, DateTime CreatedAt, DateTime UpdatedAt, int Clicks, int Revision);
public record StoreAdminRowDto(Guid Id, string Title, string? ImageUrl, string Marketplace, string MarketplaceName, StoreRef[] Systems, StoreRef? Category,
    int? PriceCents, string Currency, DateTime? PriceCheckedAt, string Status, DateTime UpdatedAt, int Clicks);
public record StoreAdminListDto(List<StoreAdminRowDto> Items, int Total, int Page, int PageSize, Dictionary<string, int> Counts);
public record StoreStatusInput(string? Status, int Revision);
public record StoreCategoryInput(string? Name, string? Keywords = null, int Order = 0, bool Archived = false);
public record StoreCategoryDto(Guid Id, string Name, string Slug, string Keywords, int Order, bool Archived, int Products);
public record StorePageOptionDto(string Key, string Label);
public record StoreSettingsInput(bool Enabled = true, int ShowcaseWide = 3, int ShowcaseMedium = 2, int ShowcaseNarrow = 1, string[]? Pages = null, int MaxPerMarketplace = 2,
    bool CategoryDiversity = true, int RotationHours = 6, int PriceStaleHours = 24, int MetadataRefreshHours = 24, bool RequireImage = true, string? Synonyms = null, int Revision = 0);
public record StoreSettingsDto(bool Enabled, int ShowcaseWide, int ShowcaseMedium, int ShowcaseNarrow, string[] Pages, int MaxPerMarketplace, bool CategoryDiversity,
    int RotationHours, int PriceStaleHours, int MetadataRefreshHours, bool RequireImage, string Synonyms, int Revision, StorePageOptionDto[] PageOptions, string[] PageReader);

/// <summary>Catálogo público (filtros e paginação no servidor) e manutenção administrativa da loja (ADR-104).</summary>
public partial class StoreCatalogService(GameDb db, AuditService audit, StoreRecommendationService recommendations, StoreAffiliateService affiliates, TimeProvider clock)
{
    public const int PageSize = 24, AdminPageSize = 25, MaxPage = 500;
    public const int PopularityThreshold = 20;
    public static readonly string[] Sorts = ["relevance", "price_asc", "price_desc", "newest", "popular"];
    static readonly string[] Currencies = ["BRL", "USD"];

    DateTime Now => clock.GetUtcNow().UtcDateTime;

    // ---------- Público ----------
    public async Task<StorePageDto> ProductsAsync(StoreCatalogQuery x, string userId, CancellationToken ct)
    {
        var settings = await StoreQueries.SettingsAsync(db, ct);
        var cut = Now.AddHours(-settings.PriceStaleHours);
        var term = TextSearch.Term(x.Q);
        var page = Math.Clamp(x.Page, 1, MaxPage);
        var sort = Sorts.Contains(x.Sort) ? x.Sort! : "relevance";
        var query = Filter(StoreQueries.Public(db), x, cut);
        Expression<Func<StoreProduct, bool>>? titleMatch = null;
        if (term != null)
        {
            var variants = StoreKeywords.SearchVariants(term, settings.Synonyms);
            query = query.Where(await SearchAsync(variants, ct));
            titleMatch = variants.Select(v => TextSearch.AnyField<StoreProduct>(db, TextSearch.Pattern(v), p => p.Title)).Aggregate(TextSearch.Or);
        }
        var total = await query.CountAsync(ct);
        var personalized = sort == "relevance" && term == null;
        string? systemName = null;
        List<Guid> ids;
        if (personalized)
        {
            var prefs = await StoreQueries.PreferencesAsync(db, userId, ct);
            var context = await recommendations.ContextAsync(userId, x.CampaignId, prefs, settings, ct);
            systemName = context.SystemName;
            var skip = (page - 1) * PageSize;
            ids = skip < StoreRecommendationService.Window
                ? (await StoreQueries.RankAsync(db, query, context.Rank, settings, cut, StoreRecommendationService.Window, ct)).Skip(skip).Take(PageSize).Select(r => r.Candidate.Id).ToList()
                : await StoreQueries.GroupOrdered(query, context.Rank).Skip(skip).Take(PageSize).Select(p => p.Id).ToListAsync(ct);
        }
        else
        {
            IOrderedQueryable<StoreProduct> ordered = sort switch
            {
                "price_asc" => query.OrderBy(p => p.PriceCents == null || p.PriceCheckedAt == null || p.PriceCheckedAt < cut ? 1 : 0).ThenBy(p => p.PriceCents),
                "price_desc" => query.OrderBy(p => p.PriceCents == null || p.PriceCheckedAt == null || p.PriceCheckedAt < cut ? 1 : 0).ThenByDescending(p => p.PriceCents),
                "newest" => query.OrderByDescending(p => p.CreatedAt),
                "popular" => query.OrderByDescending(p => p.Clicks),
                _ => query.OrderByDescending(Rank(titleMatch!)),
            };
            ids = await ordered.ThenByDescending(p => p.Priority).ThenByDescending(p => p.UpdatedAt).ThenBy(p => p.Id)
                .Skip((page - 1) * PageSize).Take(PageSize).Select(p => p.Id).ToListAsync(ct);
        }
        var items = await StoreQueries.CardsAsync(db, ids, cut, false, ct);
        return new(items, total, page, PageSize, sort, personalized, new(systemName));
    }

    /// <summary>1 quando o título contém algum termo, senão 0 (título pesa mais que descrição, tags, categoria e sistema).</summary>
    static Expression<Func<StoreProduct, int>> Rank(Expression<Func<StoreProduct, bool>> match) =>
        Expression.Lambda<Func<StoreProduct, int>>(Expression.Condition(match.Body, Expression.Constant(1), Expression.Constant(0)), match.Parameters);

    IQueryable<StoreProduct> Filter(IQueryable<StoreProduct> query, StoreCatalogQuery x, DateTime cut)
    {
        var systems = (x.System ?? []).Take(20).ToList();
        if (systems.Count > 0)
        {
            var generic = systems.Contains("generic");
            var ids = systems.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
            if (!generic && ids.Count == 0) throw new RuleException(400, "Filtro de sistema inválido.");
            query = query.Where(p => p.Systems.Any(s => ids.Contains(s.RpgSystemId)) || (generic && !p.Systems.Any()));
        }
        var categories = (x.Category ?? []).Take(20).ToList();
        if (categories.Count > 0) query = query.Where(p => p.CategoryId != null && categories.Contains(p.CategoryId.Value));
        var markets = (x.Marketplace ?? []).Take(3).ToList();
        if (markets.Count > 0)
        {
            if (markets.Any(m => !StoreMarketplaces.All.Contains(m))) throw new RuleException(400, "Loja de origem inválida.");
            query = query.Where(p => markets.Contains(p.Marketplace));
        }
        static int? Cents(decimal? value)
        {
            if (value is null) return null;
            if (value < 0 || value > 1_000_000) throw new RuleException(400, "Faixa de preço inválida.");
            return (int)Math.Round(value.Value * 100, MidpointRounding.AwayFromZero);
        }
        var min = Cents(x.MinPrice);
        var max = Cents(x.MaxPrice);
        if (min != null && max != null && min > max) throw new RuleException(400, "O preço mínimo é maior que o máximo.");
        if (min != null || max != null || x.OnSale == true)
            query = query.Where(p => p.PriceCents != null && p.PriceCheckedAt != null && p.PriceCheckedAt >= cut);
        if (min != null) query = query.Where(p => p.PriceCents >= min);
        if (max != null) query = query.Where(p => p.PriceCents <= max);
        if (x.OnSale == true) query = query.Where(p => p.PreviousPriceCents != null && p.PreviousPriceCents > p.PriceCents);
        if (x.Available == true) query = query.Where(p => p.Availability == StoreAvailability.InStock && p.PriceCheckedAt != null && p.PriceCheckedAt >= cut);
        return query;
    }

    /// <summary>Busca sem caixa/acento por nome, descrição, marca, tags, categoria (nome e palavras-chave) e sistema, com
    /// singular/plural simples e sinônimos cadastrados.</summary>
    async Task<Expression<Func<StoreProduct, bool>>> SearchAsync(List<string> variants, CancellationToken ct)
    {
        var text = variants.Select(v => TextSearch.AnyField<StoreProduct>(db, TextSearch.Pattern(v), p => p.Title, p => p.Description, p => p.Brand)).Aggregate(TextSearch.Or);
        var tagMatch = variants.Select(v => TextSearch.AnyField<StoreProductTag>(db, TextSearch.Pattern(v), t => t.Value)).Aggregate(TextSearch.Or);
        var tagged = db.StoreProductTags.Where(tagMatch).Select(t => t.ProductId);
        var categories = (await db.StoreCategories.AsNoTracking().Select(c => new { c.Id, c.Name, c.Keywords }).ToListAsync(ct))
            .Where(c => variants.Any(v => TextSearch.Fold(c.Name).Contains(v) || c.Keywords.Split(',').Any(k => TextSearch.Fold(k).Contains(v)))).Select(c => c.Id).ToList();
        var systems = (await db.RpgSystems.AsNoTracking().Select(s => new { s.Id, s.Name }).ToListAsync(ct))
            .Where(s => variants.Any(v => TextSearch.Fold(s.Name).Contains(v))).Select(s => s.Id).ToList();
        Expression<Func<StoreProduct, bool>> related = p => tagged.Contains(p.Id)
            || (p.CategoryId != null && categories.Contains(p.CategoryId.Value))
            || p.Systems.Any(s => systems.Contains(s.RpgSystemId));
        return TextSearch.Or(text, related);
    }

    public async Task<StoreCardDto> ProductAsync(Guid id, CancellationToken ct)
    {
        var settings = await StoreQueries.SettingsAsync(db, ct);
        return (await StoreQueries.CardsAsync(db, [id], Now.AddHours(-settings.PriceStaleHours), true, ct)).SingleOrDefault()
            ?? throw new RuleException(404, "Produto não encontrado.");
    }

    public async Task<object> SuggestionsAsync(string? q, CancellationToken ct)
    {
        var term = TextSearch.Term(q);
        if (term == null) return new { items = Array.Empty<StoreSuggestionDto>() };
        var match = TextSearch.AnyField<StoreProduct>(db, TextSearch.Pattern(term), p => p.Title, p => p.Brand);
        var items = await StoreQueries.Public(db).Where(match).OrderByDescending(p => p.Clicks).ThenBy(p => p.Title).Take(8)
            .Select(p => new StoreSuggestionDto(p.Id, p.Title)).ToListAsync(ct);
        return new { items };
    }

    public async Task<StoreFiltersDto> FiltersAsync(CancellationToken ct)
    {
        var settings = await StoreQueries.SettingsAsync(db, ct);
        var active = StoreQueries.Public(db);
        var byCategory = await active.Where(p => p.CategoryId != null).GroupBy(p => p.CategoryId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var categories = (await db.StoreCategories.AsNoTracking().Where(c => c.ArchivedAt == null).OrderBy(c => c.Order).ThenBy(c => c.Name).ToListAsync(ct))
            .Select(c => new StoreFacetDto(c.Id, c.Name, c.Slug, byCategory.GetValueOrDefault(c.Id))).ToList();
        var bySystem = await db.StoreProductSystems.AsNoTracking().Where(s => active.Any(p => p.Id == s.ProductId))
            .GroupBy(s => s.RpgSystemId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var linked = bySystem.Keys.ToList();
        var systems = (await db.RpgSystems.AsNoTracking().Where(s => s.Active || linked.Contains(s.Id)).OrderBy(s => s.Name).Select(s => new { s.Id, s.Name }).ToListAsync(ct))
            .Select(s => new StoreSystemFacetDto(s.Id, s.Name, bySystem.GetValueOrDefault(s.Id))).ToList();
        var byMarket = await active.GroupBy(p => p.Marketplace).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var generic = await active.CountAsync(p => !p.Systems.Any(), ct);
        var clicks = await active.SumAsync(p => p.Clicks, ct);
        return new(categories, systems, StoreMarketplaces.All.Select(m => new StoreMarketplaceFacetDto(m, StoreMarketplaces.Name(m), byMarket.GetValueOrDefault(m))).ToList(),
            generic, clicks >= PopularityThreshold, settings.PriceStaleHours);
    }

    // ---------- Administração: produtos ----------
    public async Task<StoreAdminListDto> AdminListAsync(string? q, string? status, string? marketplace, Guid? category, Guid? system, int page, CancellationToken ct)
    {
        var query = db.StoreProducts.AsNoTracking().Where(p => p.DeletedAt == null);
        var counts = await query.GroupBy(p => p.Status).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        if (TextSearch.Term(q) is { } term) query = query.Where(TextSearch.AnyField<StoreProduct>(db, TextSearch.Pattern(term), p => p.Title, p => p.Brand, p => p.Description));
        if (!string.IsNullOrEmpty(status)) query = StoreProductStatuses.All.Contains(status) ? query.Where(p => p.Status == status) : throw new RuleException(400, "Status inválido.");
        if (!string.IsNullOrEmpty(marketplace)) query = StoreMarketplaces.All.Contains(marketplace) ? query.Where(p => p.Marketplace == marketplace) : throw new RuleException(400, "Loja de origem inválida.");
        if (category is { } c) query = query.Where(p => p.CategoryId == c);
        if (system is { } s) query = query.Where(p => p.Systems.Any(x => x.RpgSystemId == s));
        page = Math.Clamp(page, 1, MaxPage);
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(p => p.UpdatedAt).ThenBy(p => p.Id).Skip((page - 1) * AdminPageSize).Take(AdminPageSize)
            .Select(p => new { p.Id, p.Title, p.ImageUrl, p.Marketplace, p.CategoryId, p.PriceCents, p.Currency, p.PriceCheckedAt, p.Status, p.UpdatedAt, p.Clicks, Systems = p.Systems.Select(x => x.RpgSystemId).ToList() })
            .ToListAsync(ct);
        var (systems, categories) = await NamesAsync(ct);
        var items = rows.Select(r => new StoreAdminRowDto(r.Id, r.Title, r.ImageUrl, r.Marketplace, StoreMarketplaces.Name(r.Marketplace),
            r.Systems.Where(systems.ContainsKey).Select(id => new StoreRef(id, systems[id])).ToArray(),
            r.CategoryId is { } cid && categories.TryGetValue(cid, out var cn) ? new StoreRef(cid, cn) : null,
            r.PriceCents, r.Currency, r.PriceCheckedAt, r.Status, r.UpdatedAt, r.Clicks)).ToList();
        return new(items, total, page, AdminPageSize, StoreProductStatuses.All.ToDictionary(k => k, k => counts.GetValueOrDefault(k)));
    }

    async Task<(Dictionary<Guid, string> Systems, Dictionary<Guid, string> Categories)> NamesAsync(CancellationToken ct) =>
        (await db.RpgSystems.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.Name, ct), await db.StoreCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, ct));

    async Task<StoreProduct> LoadAsync(Guid id, CancellationToken ct) =>
        await db.StoreProducts.Include(p => p.Systems).Include(p => p.Tags).SingleOrDefaultAsync(p => p.Id == id && p.DeletedAt == null, ct)
        ?? throw new RuleException(404, "Produto não encontrado.");

    public async Task<StoreAdminProductDto> AdminProductAsync(Guid id, CancellationToken ct) => Dto(await LoadAsync(id, ct));

    static StoreAdminProductDto Dto(StoreProduct p) => new(p.Id, p.Marketplace, StoreMarketplaces.Name(p.Marketplace), p.AffiliateUrl, p.TargetUrl, p.CanonicalUrl,
        p.ExternalId, p.Title, p.Description, p.ImageUrl, p.Brand, p.CategoryId, p.Systems.Select(s => s.RpgSystemId).OrderBy(s => s).ToArray(),
        p.Tags.Select(t => t.Value).OrderBy(t => t).ToArray(), p.PriceCents, p.PreviousPriceCents, p.Currency, p.PriceCheckedAt, p.Availability, p.Status,
        p.Priority, p.CreatedAt, p.UpdatedAt, p.Clicks, p.Revision);

    public async Task<StoreAdminProductDto> CreateAsync(StoreProductInput x, string actor, CancellationToken ct)
    {
        var product = new StoreProduct { CreatedAt = Now };
        await ApplyAsync(product, x, isNew: true, ct);
        db.StoreProducts.Add(product);
        audit.Record(actor, "store.product.create", "store", product.Id.ToString(), $"Cadastrou o produto {product.Title}", Snapshot(product));
        await db.SaveChangesAsync(ct);
        return Dto(product);
    }

    public async Task<StoreAdminProductDto> UpdateAsync(Guid id, StoreProductInput x, string actor, CancellationToken ct)
    {
        var product = await LoadAsync(id, ct);
        if (x.Revision != product.Revision) throw new RuleException(409, "O produto mudou em outra sessão. Atualize e tente novamente.");
        var before = Snapshot(product);
        await ApplyAsync(product, x, isNew: false, ct);
        product.Revision++;
        audit.Record(actor, "store.product.update", "store", product.Id.ToString(), $"Editou o produto {product.Title}", new { before, after = Snapshot(product) });
        await db.SaveChangesAsync(ct);
        return Dto(product);
    }

    public async Task<StoreAdminProductDto> SetStatusAsync(Guid id, StoreStatusInput x, string actor, CancellationToken ct)
    {
        var product = await LoadAsync(id, ct);
        if (x.Revision != product.Revision) throw new RuleException(409, "O produto mudou em outra sessão. Atualize e tente novamente.");
        var status = StoreProductStatuses.All.Contains(x.Status) ? x.Status! : throw new RuleException(400, "Status inválido.");
        var before = product.Status;
        product.Status = status;
        product.UpdatedAt = Now;
        product.Revision++;
        audit.Record(actor, "store.product.status", "store", product.Id.ToString(), $"Mudou o produto {product.Title} de {before} para {status}", new { before, after = status });
        await db.SaveChangesAsync(ct);
        return Dto(product);
    }

    /// <summary>Exclusão lógica: sai do catálogo e da administração; cliques registrados permanecem até a retenção.</summary>
    public async Task DeleteAsync(Guid id, string actor, CancellationToken ct)
    {
        var product = await LoadAsync(id, ct);
        product.DeletedAt = Now;
        product.Status = StoreProductStatuses.Archived;
        product.UpdatedAt = Now;
        product.Revision++;
        audit.Record(actor, "store.product.delete", "store", product.Id.ToString(), $"Excluiu o produto {product.Title}", Snapshot(product));
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Resumo auditável sem o link afiliado (que carrega o identificador da conta de afiliado).</summary>
    static object Snapshot(StoreProduct p) => new
    {
        p.Title, p.Marketplace, p.ExternalId, p.Status, p.CategoryId, systems = p.Systems.Select(s => s.RpgSystemId).ToArray(),
        p.PriceCents, p.PreviousPriceCents, p.Currency, p.Availability, p.Priority,
    };

    async Task ApplyAsync(StoreProduct p, StoreProductInput x, bool isNew, CancellationToken ct)
    {
        var (uri, marketplace) = StoreAffiliateLinks.Validate(x.AffiliateUrl);
        var title = Text(x.Title, 200, "Informe o título do produto (até 200 caracteres).", required: true);
        var description = Text(x.Description, 4000, "A descrição aceita até 4.000 caracteres.");
        var brand = Text(x.Brand, 120, "Marca ou editora aceita até 120 caracteres.");
        var image = StoreAffiliateLinks.ValidateImage(x.ImageUrl);
        var status = x.Status is null or "" ? (isNew ? StoreProductStatuses.Draft : p.Status) : StoreProductStatuses.All.Contains(x.Status) ? x.Status : throw new RuleException(400, "Status inválido.");
        var availability = x.Availability is null or "" ? StoreAvailability.Unknown : StoreAvailability.All.Contains(x.Availability) ? x.Availability : throw new RuleException(400, "Disponibilidade inválida.");
        var currency = Currencies.Contains(x.Currency ?? "BRL") ? x.Currency ?? "BRL" : throw new RuleException(400, "Moeda inválida.");
        if (x.Priority is < 0 or > 100) throw new RuleException(400, "A prioridade vai de 0 a 100.");
        var externalId = Text(x.ExternalId, 100, "Identificador externo inválido.");
        if (externalId.Length > 0 && !ExternalIdPattern().IsMatch(externalId)) throw new RuleException(400, "Identificador externo inválido.");
        var canonical = string.IsNullOrWhiteSpace(x.CanonicalUrl) ? null : StoreAffiliateLinks.Validate(x.CanonicalUrl).Uri.AbsoluteUri;

        if (x.PriceCents is < 0 or > 100_000_000 || x.PreviousPriceCents is < 0 or > 100_000_000) throw new RuleException(400, "Preço inválido.");
        if (x.PreviousPriceCents != null && (x.PriceCents == null || x.PreviousPriceCents <= x.PriceCents))
            throw new RuleException(400, "O preço anterior só vale quando é maior que o preço atual conferido.");
        var offerKnown = x.PriceCents != null || availability != StoreAvailability.Unknown;
        var offerChanged = isNew ? offerKnown
            : x.PriceCents != p.PriceCents || x.PreviousPriceCents != p.PreviousPriceCents || currency != p.Currency || availability != p.Availability;
        if (offerChanged && offerKnown && !x.ConfirmPrice)
            throw new RuleException(400, "Confirme que conferiu agora na loja o preço e a disponibilidade informados.");

        var category = x.CategoryId;
        if (category is { } cid && !await db.StoreCategories.AnyAsync(c => c.Id == cid && (c.ArchivedAt == null || c.Id == p.CategoryId), ct))
            throw new RuleException(400, "Escolha uma categoria ativa.");
        var systemIds = (x.SystemIds ?? []).Distinct().ToList();
        if (systemIds.Count > StoreModel.MaxSystems) throw new RuleException(400, $"Associe até {StoreModel.MaxSystems} sistemas.");
        var current = p.Systems.Select(s => s.RpgSystemId).ToHashSet();
        var valid = await db.RpgSystems.Where(s => systemIds.Contains(s.Id) && (s.Active || current.Contains(s.Id))).Select(s => s.Id).ToListAsync(ct);
        if (valid.Count != systemIds.Count) throw new RuleException(400, "Escolha sistemas de RPG ativos cadastrados na plataforma.");
        var tags = NormalizeTags(x.Tags);
        if (status == StoreProductStatuses.Active && title.Length == 0) throw new RuleException(400, "Produto ativo precisa de título.");

        p.Marketplace = marketplace;
        p.AffiliateUrl = (x.AffiliateUrl ?? "").Trim();
        p.TargetUrl = uri.AbsoluteUri;
        p.CanonicalUrl = canonical;
        p.ExternalId = externalId.Length == 0 ? StoreAffiliateLinks.ExternalId(uri, marketplace) : externalId;
        p.Title = title;
        p.Description = description;
        p.Brand = brand;
        p.ImageUrl = image;
        p.CategoryId = category;
        p.Currency = currency;
        p.PriceCents = x.PriceCents;
        p.PreviousPriceCents = x.PreviousPriceCents;
        p.Availability = availability;
        if (!offerKnown) p.PriceCheckedAt = null;
        else if (x.ConfirmPrice) p.PriceCheckedAt = Now;
        p.Status = status;
        p.Priority = x.Priority;
        p.UpdatedAt = Now;
        p.Systems.RemoveAll(s => !systemIds.Contains(s.RpgSystemId));
        foreach (var id in systemIds.Where(id => !current.Contains(id))) p.Systems.Add(new StoreProductSystem { ProductId = p.Id, RpgSystemId = id });
        p.Tags.RemoveAll(t => !tags.Contains(t.Value));
        foreach (var tag in tags.Where(t => p.Tags.All(x => x.Value != t))) p.Tags.Add(new StoreProductTag { ProductId = p.Id, Value = tag });
    }

    public static List<string> NormalizeTags(IEnumerable<string>? input)
    {
        var tags = new List<string>();
        foreach (var raw in input ?? [])
        {
            var tag = string.Join(' ', (raw ?? "").Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
            if (tag.Length == 0) continue;
            if (tag.Length > 40 || tag.Any(char.IsControl) || tag.Contains(',')) throw new RuleException(400, "Cada tag aceita até 40 caracteres, sem vírgula.");
            if (!tags.Contains(tag)) tags.Add(tag);
        }
        return tags.Count <= StoreModel.MaxTags ? tags : throw new RuleException(400, $"Use até {StoreModel.MaxTags} tags.");
    }

    static string Text(string? value, int max, string message, bool required = false)
    {
        var text = (value ?? "").Trim();
        if ((required && text.Length == 0) || text.Length > max || text.Any(ch => char.IsControl(ch) && ch is not '\n' and not '\r' and not '\t')) throw new RuleException(400, message);
        return text;
    }

    [GeneratedRegex("^[A-Za-z0-9._-]{1,100}$")] private static partial Regex ExternalIdPattern();

    // ---------- Administração: categorias ----------
    public async Task<List<StoreCategoryDto>> CategoriesAsync(CancellationToken ct)
    {
        var counts = await db.StoreProducts.AsNoTracking().Where(p => p.DeletedAt == null && p.CategoryId != null)
            .GroupBy(p => p.CategoryId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        return (await db.StoreCategories.AsNoTracking().OrderBy(c => c.Order).ThenBy(c => c.Name).ToListAsync(ct))
            .Select(c => new StoreCategoryDto(c.Id, c.Name, c.Slug, c.Keywords, c.Order, c.ArchivedAt != null, counts.GetValueOrDefault(c.Id))).ToList();
    }

    public async Task<StoreCategoryDto> SaveCategoryAsync(Guid? id, StoreCategoryInput x, string actor, CancellationToken ct)
    {
        var name = Text(x.Name, 60, "Informe o nome da categoria (até 60 caracteres).", required: true);
        var keywords = string.Join(", ", NormalizeTags((x.Keywords ?? "").Split(',')));
        if (keywords.Length > 500) throw new RuleException(400, "Palavras-chave aceitam até 500 caracteres.");
        if (x.Order is < 0 or > 999) throw new RuleException(400, "A ordem vai de 0 a 999.");
        var slug = RpgSystemService.Slugify(name);
        if (slug.Length == 0) throw new RuleException(400, "Use letras ou números no nome da categoria.");
        var category = id is { } existing ? await db.StoreCategories.SingleOrDefaultAsync(c => c.Id == existing, ct) ?? throw new RuleException(404, "Categoria não encontrada.") : new StoreCategory();
        var folded = TextSearch.Fold(name);
        var others = await db.StoreCategories.AsNoTracking().Where(c => c.Id != category.Id).Select(c => new { c.Name, c.Slug }).ToListAsync(ct);
        if (others.Any(c => c.Slug == slug || TextSearch.Fold(c.Name) == folded)) throw new RuleException(409, "Já existe uma categoria com este nome.");
        var before = new { category.Name, category.Keywords, category.Order, archived = category.ArchivedAt != null };
        category.Name = name;
        category.Slug = slug;
        category.Keywords = keywords;
        category.Order = x.Order;
        category.ArchivedAt = x.Archived ? category.ArchivedAt ?? Now : null;
        if (id == null) db.StoreCategories.Add(category);
        audit.Record(actor, id == null ? "store.category.create" : "store.category.update", "store", category.Id.ToString(), $"{(id == null ? "Criou" : "Editou")} a categoria {name}",
            new { before, after = new { name, keywords, x.Order, archived = x.Archived } });
        await db.SaveChangesAsync(ct);
        var count = await db.StoreProducts.CountAsync(p => p.DeletedAt == null && p.CategoryId == category.Id, ct);
        return new(category.Id, category.Name, category.Slug, category.Keywords, category.Order, category.ArchivedAt != null, count);
    }

    /// <summary>Só exclui categoria sem produtos (inclusive excluídos logicamente, que ainda a referenciam); senão, arquivar.</summary>
    public async Task DeleteCategoryAsync(Guid id, string actor, CancellationToken ct)
    {
        var category = await db.StoreCategories.SingleOrDefaultAsync(c => c.Id == id, ct) ?? throw new RuleException(404, "Categoria não encontrada.");
        if (await db.StoreProducts.AnyAsync(p => p.CategoryId == id, ct)) throw new RuleException(409, "Há produtos nesta categoria. Mova-os ou arquive a categoria em vez de excluir.");
        db.StoreCategories.Remove(category);
        audit.Record(actor, "store.category.delete", "store", id.ToString(), $"Excluiu a categoria {category.Name}", new { category.Name, category.Keywords });
        await db.SaveChangesAsync(ct);
    }

    // ---------- Administração: configurações ----------
    public async Task<StoreSettingsDto> SettingsAsync(CancellationToken ct) => SettingsDto(await StoreQueries.SettingsAsync(db, ct));

    StoreSettingsDto SettingsDto(StoreSettings s) => new(s.Enabled, s.ShowcaseWide, s.ShowcaseMedium, s.ShowcaseNarrow,
        s.Pages.Split(',', StringSplitOptions.RemoveEmptyEntries), s.MaxPerMarketplace, s.CategoryDiversity, s.RotationHours, s.PriceStaleHours,
        s.MetadataRefreshHours, s.RequireImage, s.Synonyms, s.Revision, StorePages.Options.Select(o => new StorePageOptionDto(o.Key, o.Label)).ToArray(),
        affiliates.PageReaderMarketplaces());

    public async Task<StoreSettingsDto> SaveSettingsAsync(StoreSettingsInput x, string actor, CancellationToken ct)
    {
        static void Range(int value, int min, int max, string label) { if (value < min || value > max) throw new RuleException(400, $"{label}: use um valor de {min} a {max}."); }
        Range(x.ShowcaseWide, 1, 3, "Produtos em telas largas");
        Range(x.ShowcaseMedium, 1, 2, "Produtos em telas médias");
        Range(x.ShowcaseNarrow, 1, 1, "Produtos no celular");
        Range(x.MaxPerMarketplace, 1, 3, "Máximo por loja");
        Range(x.RotationHours, 1, 168, "Janela de rotação (horas)");
        Range(x.PriceStaleHours, 1, 720, "Validade do preço (horas)");
        Range(x.MetadataRefreshHours, 6, 720, "Atualização de metadados (horas)");
        var pages = (x.Pages ?? []).Distinct().ToArray();
        if (pages.Any(p => !StorePages.IsValid(p))) throw new RuleException(400, "Página inválida para a vitrine.");
        var synonyms = string.Join('\n', (x.Synonyms ?? "").Replace("\r", "").Split('\n').Select(l => string.Join(", ", l.Split(',').Select(t => t.Trim().ToLowerInvariant()).Where(t => t.Length > 0))).Where(l => l.Length > 0));
        if (synonyms.Length > 8000 || synonyms.Split('\n').Length > 200 || synonyms.Any(ch => char.IsControl(ch) && ch != '\n'))
            throw new RuleException(400, "Sinônimos: até 200 linhas e 8.000 caracteres.");
        if (synonyms.Split('\n').Any(l => l.Split(", ").Length > 12 || l.Split(", ").Any(t => t.Length > 40)))
            throw new RuleException(400, "Cada linha de sinônimos aceita até 12 termos de até 40 caracteres.");
        var settings = await db.StoreSettings.SingleOrDefaultAsync(s => s.Id == StoreSettings.SingletonId, ct);
        var isNew = settings == null;
        settings ??= new StoreSettings();
        if (x.Revision != settings.Revision) throw new RuleException(409, "As configurações mudaram em outra sessão. Atualize e tente novamente.");
        var before = SettingsDto(settings);
        settings.Enabled = x.Enabled;
        settings.ShowcaseWide = x.ShowcaseWide;
        settings.ShowcaseMedium = x.ShowcaseMedium;
        settings.ShowcaseNarrow = x.ShowcaseNarrow;
        settings.Pages = string.Join(',', pages);
        settings.MaxPerMarketplace = x.MaxPerMarketplace;
        settings.CategoryDiversity = x.CategoryDiversity;
        settings.RotationHours = x.RotationHours;
        settings.PriceStaleHours = x.PriceStaleHours;
        settings.MetadataRefreshHours = x.MetadataRefreshHours;
        settings.RequireImage = x.RequireImage;
        settings.Synonyms = synonyms;
        settings.UpdatedAt = Now;
        // Os padrões do código valem como revisão 1; toda gravação (inclusive a primeira) avança a revisão.
        settings.Revision++;
        if (isNew) db.StoreSettings.Add(settings);
        audit.Record(actor, "store.settings.update", "store", "settings", "Alterou as configurações da loja", new { before = before with { PageOptions = [], PageReader = [] }, after = SettingsDto(settings) with { PageOptions = [], PageReader = [] } });
        await db.SaveChangesAsync(ct);
        return SettingsDto(settings);
    }
}
