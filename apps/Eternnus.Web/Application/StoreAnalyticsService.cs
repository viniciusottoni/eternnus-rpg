using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StoreInteractionInput(Guid ProductId, string? Surface);
/// <summary>Confirmação de exibição (ADR-108): o token da exibição e os produtos que ficaram visíveis.</summary>
public record StoreImpressionInput(string? View, Guid[]? ProductIds);

/// <summary>Cliques, exibições e indicadores agregados (ADR-104/107). Nunca guarda texto de conversa; o painel só vê números
/// agregados. Receita e comissão não são conhecidas; cliques não são vendas.</summary>
public class StoreAnalyticsService(GameDb db, TimeProvider clock, StoreViewTokens tokens)
{
    /// <summary>O mesmo usuário, produto e superfície contam uma vez nesta janela.</summary>
    public static readonly TimeSpan Dedupe = TimeSpan.FromMinutes(30);
    /// <summary>Um clique da vitrine é atribuído à exibição mais recente do produto nesta janela.</summary>
    public static readonly TimeSpan Attribution = TimeSpan.FromHours(24);
    /// <summary>CTR suavizado: soma esta quantidade de impressões "à taxa geral" (amostras pequenas não viram destaque).</summary>
    public const int CtrPrior = 50;
    /// <summary>Impressões mínimas para um CTR ser considerado confiável no painel.</summary>
    public const int MinSample = 30;

    public async Task RecordAsync(string userId, StoreInteractionInput x, CancellationToken ct)
    {
        var surface = StoreSurfaces.All.Contains(x.Surface) ? x.Surface! : throw new RuleException(400, "Origem do clique inválida.");
        if (!await StoreQueries.Public(db).AnyAsync(p => p.Id == x.ProductId, ct)) throw new RuleException(404, "Produto não encontrado.");
        var now = clock.GetUtcNow().UtcDateTime;
        var since = now - Dedupe;
        if (await db.StoreInteractions.AnyAsync(i => i.UserId == userId && i.ProductId == x.ProductId && i.Surface == surface && i.CreatedAt >= since, ct)) return;
        db.StoreInteractions.Add(new StoreInteraction { ProductId = x.ProductId, UserId = userId, Surface = surface, CreatedAt = now });
        if (surface == StoreSurfaces.Showcase)
        {
            // Atribuição: no máximo um clique por exibição; clique repetido não infla o CTR.
            var from = now - Attribution;
            var exposure = await db.StoreExposures.Where(e => e.UserId == userId && e.ProductId == x.ProductId && e.CreatedAt >= from && e.ClickedAt == null)
                .OrderByDescending(e => e.Id).FirstOrDefaultAsync(ct);
            if (exposure != null) exposure.ClickedAt = now;
        }
        await db.SaveChangesAsync(ct);
        // Contador atômico: não disputa a revisão do produto com a edição administrativa.
        await db.StoreProducts.Where(p => p.Id == x.ProductId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Clicks, p => p.Clicks + 1), ct);
    }

    /// <summary>
    /// Registra os cartões que ficaram visíveis de uma exibição emitida pelo servidor. Idempotente por (usuário, ciclo,
    /// produto): outra aba, nova tentativa ou reenvio não contam de novo. Avança o ciclo de rotação uma única vez por ciclo
    /// (comparação com o ciclo do token), sob bloqueio da linha de estado do usuário. Vitrine desligada ou oculta: nada é gravado.
    /// </summary>
    public async Task RecordImpressionsAsync(string userId, StoreImpressionInput x, CancellationToken ct)
    {
        var ids = (x.ProductIds ?? []).Distinct().ToList();
        if (ids.Count is 0 or > 3) throw new RuleException(400, "Informe de 1 a 3 produtos exibidos.");
        var view = tokens.Read(x.View);
        if (view == null || view.UserId != userId || ids.Any(id => !view.Products.Contains(id)))
            throw new RuleException(400, "Exibição inválida ou expirada.");
        var settings = await StoreQueries.SettingsAsync(db, ct);
        if (!settings.Enabled || !(await StoreQueries.PreferencesAsync(db, userId, ct)).ShowShowcase) return;
        ids = await StoreQueries.Public(db).Where(p => ids.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (ids.Count == 0) return;
        var now = clock.GetUtcNow().UtcDateTime;

        await EnsureStateAsync(userId, now, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Bloqueia a linha de estado até o commit (PostgreSQL: o UPDATE segura a linha; concorrentes esperam e depois
        // enxergam as exibições já gravadas). Sem estado autoritativo em memória.
        await db.StoreRotationStates.Where(s => s.UserId == userId).ExecuteUpdateAsync(s => s.SetProperty(r => r.UpdatedAt, now), ct);
        var state = await db.StoreRotationStates.SingleAsync(s => s.UserId == userId, ct);
        var known = await db.StoreExposures.Where(e => e.UserId == userId && e.Cycle == view.Cycle && ids.Contains(e.ProductId)).Select(e => e.ProductId).ToListAsync(ct);
        var fresh = ids.Except(known).ToList();
        var stats = await db.StoreUserProductStats.Where(s => s.UserId == userId && fresh.Contains(s.ProductId)).ToDictionaryAsync(s => s.ProductId, ct);
        foreach (var id in fresh)
        {
            var strategy = view.Strategies[Array.IndexOf(view.Products, id)];
            db.StoreExposures.Add(new StoreExposure { UserId = userId, ProductId = id, Cycle = view.Cycle, Strategy = strategy, CreatedAt = now });
            if (!stats.TryGetValue(id, out var stat)) db.StoreUserProductStats.Add(stat = new StoreUserProductStat { UserId = userId, ProductId = id, FirstExposedAt = now });
            stat.Exposures++;
            stat.LastCycle = Math.Max(stat.LastCycle, view.Cycle);
            stat.LastExposedAt = now;
            state.Count(StoreStrategies.Index(strategy));
        }
        // O ciclo avança uma vez por exibição confirmada; com "renovar em mudança de tela" desligado, uma vez por janela.
        var due = settings.RotateOnNavigation || now - state.AdvancedAt >= TimeSpan.FromHours(Math.Max(1, settings.RotationHours));
        if (fresh.Count > 0 && state.Cycle == view.Cycle && due)
        {
            state.Cycle = view.Cycle + 1;
            state.AdvancedAt = now;
        }
        state.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Cria a linha de estado do usuário se faltar (fora da transação: a corrida entre abas termina em violação de
    /// chave, tratada como "já existe").</summary>
    async Task EnsureStateAsync(string userId, DateTime now, CancellationToken ct)
    {
        if (await db.StoreRotationStates.AnyAsync(s => s.UserId == userId, ct)) return;
        var state = new StoreRotationState { UserId = userId, AdvancedAt = now, UpdatedAt = now };
        db.StoreRotationStates.Add(state);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (SupportService.IsUniqueViolation(e)) { db.Entry(state).State = EntityState.Detached; }
    }

    static double? Ctr(int clicks, int impressions) => impressions == 0 ? null : Math.Round(100.0 * clicks / impressions, 2);
    static double? Smoothed(int clicks, int impressions, double rate) => impressions == 0 ? null : Math.Round(100.0 * (clicks + CtrPrior * rate) / (impressions + CtrPrior), 2);

    public async Task<object> MetricsAsync(int? days, CancellationToken ct)
    {
        var window = Math.Clamp(days ?? 30, 7, 365);
        var since = clock.GetUtcNow().UtcDateTime.AddDays(-window);
        var products = db.StoreProducts.AsNoTracking().Where(p => p.DeletedAt == null);
        var status = await products.GroupBy(p => p.Status).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var clicks = db.StoreInteractions.AsNoTracking().Where(i => i.CreatedAt >= since);
        var bySurface = await clicks.GroupBy(i => i.Surface).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var byProduct = await clicks.GroupBy(i => i.ProductId).Select(g => new { g.Key, Count = g.Count() }).OrderByDescending(g => g.Count).Take(10)
            .Join(db.StoreProducts, g => g.Key, p => p.Id, (g, p) => new { p.Id, p.Title, g.Count }).ToListAsync(ct);
        var byMarket = await clicks.Join(db.StoreProducts, i => i.ProductId, p => p.Id, (i, p) => p.Marketplace)
            .GroupBy(m => m).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var byCategory = await clicks.Join(db.StoreProducts, i => i.ProductId, p => p.Id, (i, p) => p.CategoryId).Where(c => c != null)
            .GroupBy(c => c!.Value).Select(g => new { g.Key, Count = g.Count() }).OrderByDescending(g => g.Count).Take(12)
            .Join(db.StoreCategories, g => g.Key, c => c.Id, (g, c) => new { c.Id, c.Name, g.Count }).ToListAsync(ct);
        var bySystem = await clicks.Join(db.StoreProductSystems, i => i.ProductId, s => s.ProductId, (i, s) => s.RpgSystemId)
            .GroupBy(s => s).Select(g => new { g.Key, Count = g.Count() }).OrderByDescending(g => g.Count).Take(12)
            .Join(db.RpgSystems, g => g.Key, s => s.Id, (g, s) => new { s.Id, s.Name, g.Count }).ToListAsync(ct);

        // ---------- Exibições (ADR-108) ----------
        var exposures = db.StoreExposures.AsNoTracking().Where(e => e.CreatedAt >= since);
        var byStrategy = await exposures.GroupBy(e => e.Strategy)
            .Select(g => new { g.Key, Impressions = g.Count(), Clicks = g.Count(e => e.ClickedAt != null) }).ToListAsync(ct);
        var impressions = byStrategy.Sum(s => s.Impressions);
        var attributed = byStrategy.Sum(s => s.Clicks);
        var rate = impressions == 0 ? 0 : (double)attributed / impressions;
        var mostShown = await exposures.GroupBy(e => e.ProductId)
            .Select(g => new { g.Key, Impressions = g.Count(), Clicks = g.Count(e => e.ClickedAt != null) }).OrderByDescending(g => g.Impressions).ThenBy(g => g.Key).Take(10)
            .Join(db.StoreProducts, g => g.Key, p => p.Id, (g, p) => new { p.Id, p.Title, g.Impressions, g.Clicks }).ToListAsync(ct);
        var active = StoreQueries.Public(db);
        var leastShown = await active.Select(p => new { p.Id, p.Title, Impressions = db.StoreExposures.Count(e => e.ProductId == p.Id && e.CreatedAt >= since) })
            .OrderBy(p => p.Impressions).ThenBy(p => p.Title).ThenBy(p => p.Id).Take(10).ToListAsync(ct);
        var activeCount = await active.CountAsync(ct);
        var shownActive = await active.CountAsync(p => db.StoreExposures.Any(e => e.ProductId == p.Id && e.CreatedAt >= since), ct);
        var neverShown = await active.CountAsync(p => !db.StoreExposures.Any(e => e.ProductId == p.Id), ct);
        var marketShown = await exposures.Join(db.StoreProducts, e => e.ProductId, p => p.Id, (e, p) => p.Marketplace)
            .GroupBy(m => m).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var categoryShown = await exposures.Join(db.StoreProducts, e => e.ProductId, p => p.Id, (e, p) => p.CategoryId).Where(c => c != null)
            .GroupBy(c => c!.Value).Select(g => new { g.Key, Count = g.Count() }).OrderByDescending(g => g.Count).Take(12)
            .Join(db.StoreCategories, g => g.Key, c => c.Id, (g, c) => new { c.Id, c.Name, g.Count }).ToListAsync(ct);
        var systemShown = await exposures.Join(db.StoreProductSystems, e => e.ProductId, s => s.ProductId, (e, s) => s.RpgSystemId)
            .GroupBy(s => s).Select(g => new { g.Key, Count = g.Count() }).OrderByDescending(g => g.Count).Take(12)
            .Join(db.RpgSystems, g => g.Key, s => s.Id, (g, s) => new { s.Id, s.Name, g.Count }).ToListAsync(ct);

        object Rate(int c, int i) => new { impressions = i, clicks = c, ctr = Ctr(c, i), smoothedCtr = Smoothed(c, i, rate), reliable = i >= MinSample };
        return new
        {
            days = window,
            products = new
            {
                total = status.Values.Sum(),
                active = status.GetValueOrDefault(StoreProductStatuses.Active),
                draft = status.GetValueOrDefault(StoreProductStatuses.Draft),
                paused = status.GetValueOrDefault(StoreProductStatuses.Paused),
                archived = status.GetValueOrDefault(StoreProductStatuses.Archived),
            },
            clicks = new
            {
                total = bySurface.Values.Sum(),
                showcase = bySurface.GetValueOrDefault(StoreSurfaces.Showcase),
                store = bySurface.GetValueOrDefault(StoreSurfaces.Store),
                detail = bySurface.GetValueOrDefault(StoreSurfaces.Detail),
            },
            byProduct = byProduct.OrderByDescending(p => p.Count).Select(p => new { id = p.Id, name = p.Title, clicks = p.Count }),
            byMarketplace = StoreMarketplaces.All.Select(m => new { key = m, name = StoreMarketplaces.Name(m), clicks = byMarket.GetValueOrDefault(m), impressions = marketShown.GetValueOrDefault(m) }),
            byCategory = byCategory.OrderByDescending(c => c.Count).Select(c => new { id = c.Id, name = c.Name, clicks = c.Count }),
            bySystem = bySystem.OrderByDescending(s => s.Count).Select(s => new { id = s.Id, name = s.Name, clicks = s.Count }),
            impressionsTracked = true,
            impressions = new { total = impressions, attributedClicks = attributed, ctr = Ctr(attributed, impressions), minSample = MinSample },
            byStrategy = StoreStrategies.All.Select(k => byStrategy.FirstOrDefault(s => s.Key == k) is { } s ? new { key = k, rate = Rate(s.Clicks, s.Impressions) } : new { key = k, rate = Rate(0, 0) })
                .Where(s => s.key != StoreStrategies.Ranked || byStrategy.Any(b => b.Key == StoreStrategies.Ranked)),
            coverage = new
            {
                active = activeCount,
                shown = shownActive,
                neverShown,
                percent = activeCount == 0 ? 0 : Math.Round(100.0 * shownActive / activeCount, 1),
            },
            mostShown = mostShown.Select(p => new { id = p.Id, name = p.Title, rate = Rate(p.Clicks, p.Impressions) }),
            leastShown = leastShown.Select(p => new { id = p.Id, name = p.Title, impressions = p.Impressions }),
            impressionsByCategory = categoryShown.Select(c => new { id = c.Id, name = c.Name, impressions = c.Count }),
            impressionsBySystem = systemShown.Select(s => new { id = s.Id, name = s.Name, impressions = s.Count }),
        };
    }
}
