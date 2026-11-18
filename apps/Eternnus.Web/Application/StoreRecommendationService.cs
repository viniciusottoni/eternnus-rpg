using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StoreLayoutDto(int Wide, int Medium, int Narrow);
public record StoreContextDto(string? SystemName);
/// <summary>Exibição emitida (ADR-108): token protegido para confirmar o que ficou visível, ciclo e fila de cada cartão.</summary>
public record StoreViewDto(string Token, long Cycle, string[] Strategies);
public record StoreRecommendationsDto(bool Show, string? Reason, StoreLayoutDto Layout, List<StoreCardDto> Items, StoreContextDto Context, StoreViewDto? View = null);
public record StorePreferencesInput(bool ShowShowcase = true, bool UseCampaignSystems = true, bool AnalyzeMessages = false, Guid? InterestSystemId = null, bool LearnFromClicks = true);
public record StoreInterestsDto(int Count, DateTime? ComputedAt, string[] Terms);
public record StorePreferencesDto(bool ShowShowcase, bool UseCampaignSystems, bool AnalyzeMessages, DateTime? MessagesConsentAt, Guid? InterestSystemId, StoreInterestsDto Interests,
    bool LearnFromClicks = true, string[]? LearnedSystems = null);
/// <summary>Contexto calculado: regras para o ranking, o nome do sistema principal (só para exibição), produtos que o
/// próprio usuário clicou e a afinidade aprendida por sistema (ADR-108; vazia sem aprendizado).</summary>
public sealed record StoreContextInfo(StoreRankContext Rank, string? SystemName, IReadOnlySet<Guid>? Clicked = null, IReadOnlyDictionary<Guid, double>? Learned = null)
{
    public IReadOnlySet<Guid> ClickedProducts => Clicked ?? new HashSet<Guid>();
    public IReadOnlyDictionary<Guid, double> LearnedSystems => Learned ?? new Dictionary<Guid, double>();
}
/// <summary>Histórico de cliques do próprio usuário: produtos clicados, afinidade por categoria e por sistema.</summary>
sealed record StoreClickHistory(HashSet<Guid> Clicked, Dictionary<Guid, double> Categories, Dictionary<Guid, double> Systems);

/// <summary>
/// Recomendações contextuais (ADR-104, docs/LOJA_AFILIADOS.md §4–6). Leituras nunca gravam: os interesses por palavras são
/// calculados ao ativar o consentimento e depois pelo <see cref="StoreMaintenanceWorker"/>.
/// </summary>
public class StoreRecommendationService(GameDb db, TimeProvider clock, StoreViewTokens tokens)
{
    /// <summary>Janela de candidatos ordenados pelo ranking completo (múltiplo do tamanho da página da loja).</summary>
    public const int Window = 192;
    /// <summary>Candidatos lidos por fila da vitrine (ordenados e limitados no banco).</summary>
    public const int PoolSize = 48;
    /// <summary>Produtos distintos clicados considerados no aprendizado (os mais recentes).</summary>
    public const int ClickLimit = 500;
    public const int SourceDays = 180, SourceLimit = 300, TopicLimit = 100;
    public static readonly TimeSpan RecomputeEvery = TimeSpan.FromHours(12);
    const double ArchivedWeight = 0.3, RecencyHalfLifeDays = 60, MinRecency = 0.1;

    DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>Sistema principal e secundários do usuário. Só lê campanhas de que ele é mestre ou integrante; um
    /// <paramref name="campaignId"/> alheio é ignorado sem revelar se existe.</summary>
    public async Task<StoreContextInfo> ContextAsync(string userId, Guid? campaignId, StoreUserPreferences prefs, StoreSettings settings, CancellationToken ct)
    {
        var now = Now;
        Guid? primary = null;
        var secondary = new Dictionary<Guid, double>();
        var interestSystem = prefs.InterestSystemId is { } chosen && await db.RpgSystems.AnyAsync(s => s.Id == chosen && s.Active, ct) ? chosen : (Guid?)null;
        if (prefs.UseCampaignSystems)
        {
            var campaigns = await db.Campaigns.AsNoTracking()
                .Where(c => c.OwnerId == userId || db.Members.Any(m => m.CampaignId == c.Id && m.UserId == userId))
                .OrderByDescending(c => c.LastActivityAt).ThenBy(c => c.Id).Take(50)
                .Select(c => new { c.Id, c.RpgSystemId, c.LastActivityAt, c.ArchivedAt, c.IsOneShot, c.ExpiresAt }).ToListAsync(ct);
            // Arquivadas e one-shots expiradas continuam como interesse secundário, com peso reduzido.
            var rows = campaigns.Select(c => (c.Id, c.RpgSystemId, c.LastActivityAt, Inactive: c.ArchivedAt != null || (c.IsOneShot && c.ExpiresAt != null && c.ExpiresAt < now))).ToList();
            var context = campaignId is { } id ? rows.Where(c => c.Id == id).Select(c => (Guid?)c.RpgSystemId).FirstOrDefault() : null;
            primary = context ?? interestSystem ?? rows.Where(c => !c.Inactive).Select(c => (Guid?)c.RpgSystemId).FirstOrDefault();
            foreach (var c in rows.Where(c => c.RpgSystemId != primary))
            {
                var recency = Math.Max(MinRecency, Math.Pow(0.5, Math.Max(0, (now - c.LastActivityAt).TotalDays) / RecencyHalfLifeDays));
                var weight = (c.Inactive ? ArchivedWeight : 1) * recency;
                secondary[c.RpgSystemId] = Math.Max(secondary.GetValueOrDefault(c.RpgSystemId), weight);
            }
        }
        else primary = interestSystem;
        if (interestSystem is { } own && own != primary) secondary[own] = 1;

        var interests = prefs.AnalyzeMessages
            ? await db.StoreInterests.AsNoTracking().Where(i => i.UserId == userId).ToDictionaryAsync(i => i.Term, i => i.Weight, ct)
            : new Dictionary<string, double>();
        // Interesse comportamental (ADR-108): só com o aprendizado ligado pelo Admin e pelo usuário. Sistemas clicados em
        // produtos distintos entram como secundários aos poucos; o sistema principal da campanha nunca é substituído.
        var history = await ClicksAsync(userId, settings.LearnFromClicks && prefs.LearnFromClicks, now, ct);
        foreach (var (system, weight) in history.Systems)
            if (weight >= StoreRotation.LearnThreshold && system != primary)
                secondary[system] = Math.Max(secondary.GetValueOrDefault(system), weight * StoreRotation.LearnedSecondaryWeight);
        var name = primary is { } p ? await db.RpgSystems.AsNoTracking().Where(s => s.Id == p).Select(s => s.Name).SingleOrDefaultAsync(ct) : null;
        return new(new StoreRankContext(primary, secondary, interests, history.Categories, now, userId, settings.RotationHours, 0), name, history.Clicked, history.Systems);
    }

    /// <summary>Cliques do próprio usuário nos últimos 180 dias (até 500 produtos distintos). Sem aprendizado, só a lista de
    /// clicados (para o resfriamento por exibições sem clique); com ele, afinidade por categoria e por sistema.</summary>
    async Task<StoreClickHistory> ClicksAsync(string userId, bool learn, DateTime now, CancellationToken ct)
    {
        var since = now.AddDays(-SourceDays);
        var clicks = await db.StoreInteractions.AsNoTracking().Where(i => i.UserId == userId && i.CreatedAt >= since)
            .GroupBy(i => i.ProductId).Select(g => new { ProductId = g.Key, At = g.Max(i => i.CreatedAt), Count = g.Count() })
            .OrderByDescending(g => g.At).Take(ClickLimit).ToListAsync(ct);
        var clicked = clicks.Select(c => c.ProductId).ToHashSet();
        if (!learn || clicks.Count == 0) return new(clicked, [], []);
        var ids = clicked.ToList();
        var products = await db.StoreProducts.AsNoTracking().Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.CategoryId, Systems = p.Systems.Select(s => s.RpgSystemId).ToList() }).ToDictionaryAsync(p => p.Id, ct);
        var known = clicks.Where(c => products.ContainsKey(c.ProductId)).ToList();
        var categories = known.Where(c => products[c.ProductId].CategoryId != null).GroupBy(c => products[c.ProductId].CategoryId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(c => c.Count));
        var top = categories.Count == 0 ? 1 : categories.Values.Max();
        var systems = StoreRotation.LearnSystems(known.Select(c => (c.ProductId, c.At, (IReadOnlyList<Guid>)products[c.ProductId].Systems)), now);
        return new(clicked, categories.ToDictionary(c => c.Key, c => (double)c.Value / top), systems);
    }

    public async Task<StoreRecommendationsDto> RecommendAsync(string userId, string? page, Guid? campaignId, CancellationToken ct)
    {
        var settings = await StoreQueries.SettingsAsync(db, ct);
        var layout = new StoreLayoutDto(settings.ShowcaseWide, settings.ShowcaseMedium, settings.ShowcaseNarrow);
        StoreRecommendationsDto Hidden(string reason) => new(false, reason, layout, [], new(null));
        if (!settings.Enabled) return Hidden("disabled");
        if (!StorePages.IsValid(page) || !settings.Pages.Split(',').Contains(page)) return Hidden("page");
        var prefs = await StoreQueries.PreferencesAsync(db, userId, ct);
        if (!prefs.ShowShowcase) return Hidden("hidden");
        // A campanha só vale como contexto na página da campanha.
        var context = await ContextAsync(userId, page == "campaign" ? campaignId : null, prefs, settings, ct);
        var cut = Now.AddHours(-settings.PriceStaleHours);
        var query = StoreQueries.Public(db).Where(p => p.Availability != StoreAvailability.OutOfStock || p.PriceCheckedAt == null || p.PriceCheckedAt < cut);
        if (settings.RequireImage) query = query.Where(p => p.ImageUrl != null);
        var count = Math.Max(settings.ShowcaseWide, Math.Max(settings.ShowcaseMedium, settings.ShowcaseNarrow));
        var state = await db.StoreRotationStates.AsNoTracking().SingleOrDefaultAsync(s => s.UserId == userId, ct) ?? new StoreRotationState { UserId = userId };
        var recent = await StoreQueries.RecentPopularityAsync(db, Now, ct);
        List<(Guid Id, string Strategy)> picks;
        if (settings.SmartRotation) picks = await RotateAsync(userId, query, context, settings, state, recent, cut, count, ct);
        else
        {
            // Ranking clássico (ADR-104): grupos imutáveis e rotação por janela de horas. As exibições continuam medidas.
            var ranked = await StoreQueries.RankAsync(db, query, context.Rank, settings, cut, Window, ct, recent);
            picks = StoreRanking.Showcase(ranked, count, settings.MaxPerMarketplace, settings.CategoryDiversity).Select(r => (r.Candidate.Id, StoreStrategies.Ranked)).ToList();
        }
        if (picks.Count == 0) return Hidden("empty");
        var items = await StoreQueries.CardsAsync(db, picks.Select(p => p.Id).ToList(), cut, false, ct);
        if (items.Count == 0) return Hidden("empty");
        var strategyOf = picks.ToDictionary(p => p.Id, p => p.Strategy);
        var strategies = items.Select(i => strategyOf[i.Id]).ToArray();
        var token = tokens.Issue(new StoreViewTicket(userId, state.Cycle, items.Select(i => i.Id).ToArray(), strategies));
        return new(true, null, layout, items, new(context.SystemName), new StoreViewDto(token, state.Cycle, strategies));
    }

    /// <summary>
    /// Round Robin inteligente (ADR-108): quatro filas lidas do banco já ordenadas e limitadas — A populares do perfil,
    /// B novidades do perfil, C descoberta no perfil e D exploração fora dele (com cobertura, do menos visto ao mais visto) —,
    /// combinadas pelo plano de metas cumulativas. O perfil é o sistema principal, os secundários (campanhas, sistema
    /// escolhido e sistemas aprendidos) e os genéricos; sem perfil, o catálogo inteiro é relevante e a fila D fica vazia.
    /// </summary>
    async Task<List<(Guid Id, string Strategy)>> RotateAsync(string userId, IQueryable<StoreProduct> query, StoreContextInfo context, StoreSettings settings,
        StoreRotationState state, IReadOnlyDictionary<Guid, double> recent, DateTime cut, int count, CancellationToken ct)
    {
        var x = context.Rank;
        var shares = settings.Shares();
        var rules = new StoreRotationRules(state.Cycle, settings.RepeatWindow, settings.FatigueImpressions, settings.MaxPerMarketplace, settings.CategoryDiversity);
        var plan = StoreRotation.Plan(state.Cycle, count, shares, state.Served());
        var primary = x.Primary;
        var secondary = x.Secondary.Keys.ToList();
        var profile = secondary.Concat(primary is { } main ? [main] : Array.Empty<Guid>()).Distinct().ToList();
        var inProfile = profile.Count == 0 ? query : query.Where(p => !p.Systems.Any() || p.Systems.Any(s => profile.Contains(s.RpgSystemId)));
        var outside = profile.Count == 0 ? null : query.Where(p => p.Systems.Any() && !p.Systems.Any(s => profile.Contains(s.RpgSystemId)));
        var stats = db.StoreUserProductStats.Where(s => s.UserId == userId);
        var recentCut = state.Cycle - Math.Max(1, settings.RepeatWindow);
        // Contexto primeiro; dentro do grupo, quem está fora do resfriamento.
        IOrderedQueryable<StoreProduct> ByGroup(IQueryable<StoreProduct> q) => q
            .OrderBy(p => primary != null && p.Systems.Any(s => s.RpgSystemId == primary) ? 0
                : p.Systems.Any(s => secondary.Contains(s.RpgSystemId)) ? 1
                : !p.Systems.Any() ? 2 : 3)
            .ThenBy(p => stats.Any(s => s.ProductId == p.Id && s.LastCycle > recentCut) ? 1 : 0);
        // Fila circular de cobertura: nunca visto, depois visto há mais ciclos.
        IOrderedQueryable<StoreProduct> Coverage(IQueryable<StoreProduct> q) => q
            .OrderBy(p => stats.Any(s => s.ProductId == p.Id) ? 1 : 0)
            .ThenBy(p => stats.Where(s => s.ProductId == p.Id).Select(s => (long?)s.LastCycle).FirstOrDefault() ?? -1);
        var popular = recent.Keys.ToList();
        var newCut = Now.AddDays(-StoreRotation.NoveltyDays);
        var coverage = settings.CatalogCoverage;
        var queries = new IQueryable<StoreProduct>?[]
        {
            shares[StoreStrategies.PopularIndex] > 0 ? ByGroup(inProfile).ThenByDescending(p => popular.Contains(p.Id)).ThenBy(p => stats.Any(s => s.ProductId == p.Id) ? 1 : 0)
                .ThenByDescending(p => p.Clicks).ThenByDescending(p => p.Priority).ThenBy(p => p.Id) : null,
            shares[StoreStrategies.NewIndex] > 0 ? ByGroup(inProfile.Where(p => (p.PublishedAt ?? p.CreatedAt) >= newCut)).ThenBy(p => stats.Any(s => s.ProductId == p.Id) ? 1 : 0)
                .ThenByDescending(p => p.PublishedAt ?? p.CreatedAt).ThenBy(p => p.Id) : null,
            shares[StoreStrategies.RelatedIndex] > 0 ? (coverage ? Coverage(inProfile) : ByGroup(inProfile).ThenByDescending(p => p.Priority)).ThenBy(p => p.Id) : null,
            shares[StoreStrategies.ExploreIndex] > 0 && outside != null ? (coverage ? Coverage(outside) : ByGroup(outside).ThenByDescending(p => p.Clicks)).ThenBy(p => p.Id) : null,
        };
        var pools = await StoreQueries.PoolsAsync(db, queries, userId, x, settings, cut, PoolSize, recent, context.ClickedProducts, ct);
        var maxClicks = pools.SelectMany(p => p).Select(i => i.Candidate.Clicks).DefaultIfEmpty(0).Max();
        var categorySeen = coverage && pools[StoreStrategies.RelatedIndex].Count > 0
            ? await stats.Join(db.StoreProducts, s => s.ProductId, p => p.Id, (s, p) => new { p.CategoryId, s.Exposures }).Where(r => r.CategoryId != null)
                .GroupBy(r => r.CategoryId!.Value).Select(g => new { g.Key, Sum = g.Sum(r => r.Exposures) }).ToDictionaryAsync(g => g.Key, g => g.Sum, ct)
            : [];
        var ordered = new IReadOnlyList<StorePoolItem>[]
        {
            StoreRotation.OrderPopular(pools[StoreStrategies.PopularIndex], maxClicks),
            StoreRotation.OrderNew(pools[StoreStrategies.NewIndex], Now),
            StoreRotation.OrderRelated(pools[StoreStrategies.RelatedIndex], categorySeen, coverage),
            StoreRotation.OrderExplore(pools[StoreStrategies.ExploreIndex], context.LearnedSystems, userId, coverage),
        };
        return StoreRotation.Select(plan, ordered, shares, rules).Select(p => (p.Item.Id, StoreStrategies.Key(p.Strategy))).ToList();
    }

    // ---------- Preferências e consentimento ----------
    public async Task<StorePreferencesDto> PreferencesAsync(string userId, CancellationToken ct)
    {
        var prefs = await StoreQueries.PreferencesAsync(db, userId, ct);
        var interests = await db.StoreInterests.AsNoTracking().Where(i => i.UserId == userId).OrderByDescending(i => i.Weight).ThenBy(i => i.Term).ToListAsync(ct);
        // Transparência (ADR-108): sistemas que os próprios cliques já colocaram no perfil.
        string[] learned = [];
        if (prefs.LearnFromClicks && (await StoreQueries.SettingsAsync(db, ct)).LearnFromClicks)
        {
            var systems = (await ClicksAsync(userId, true, Now, ct)).Systems.Where(s => s.Value >= StoreRotation.LearnThreshold).Select(s => s.Key).ToList();
            if (systems.Count > 0)
                learned = await db.RpgSystems.AsNoTracking().Where(s => systems.Contains(s.Id)).OrderBy(s => s.Name).Select(s => s.Name).ToArrayAsync(ct);
        }
        return Dto(prefs, interests, learned);
    }

    static StorePreferencesDto Dto(StoreUserPreferences p, List<StoreUserInterest> interests, string[] learned) =>
        new(p.ShowShowcase, p.UseCampaignSystems, p.AnalyzeMessages, p.MessagesConsentAt, p.InterestSystemId,
            new(interests.Count, p.InterestsComputedAt, interests.Take(10).Select(i => i.Term).ToArray()), p.LearnFromClicks, learned);

    public async Task<StorePreferencesDto> SavePreferencesAsync(string userId, StorePreferencesInput x, CancellationToken ct)
    {
        if (x.InterestSystemId is { } system && !await db.RpgSystems.AnyAsync(s => s.Id == system && s.Active, ct))
            throw new RuleException(400, "Escolha um sistema de RPG ativo.");
        var now = Now;
        var prefs = await db.StorePreferences.SingleOrDefaultAsync(p => p.UserId == userId, ct);
        if (prefs == null) db.StorePreferences.Add(prefs = new StoreUserPreferences { UserId = userId });
        var consenting = x.AnalyzeMessages && !prefs.AnalyzeMessages;
        prefs.ShowShowcase = x.ShowShowcase;
        prefs.UseCampaignSystems = x.UseCampaignSystems;
        prefs.InterestSystemId = x.InterestSystemId;
        prefs.LearnFromClicks = x.LearnFromClicks;
        prefs.UpdatedAt = now;
        if (!x.AnalyzeMessages)
        {
            // Revogar interrompe a análise e apaga o que foi derivado.
            prefs.AnalyzeMessages = false;
            prefs.MessagesConsentAt = null;
            prefs.InterestsComputedAt = null;
            await db.StoreInterests.Where(i => i.UserId == userId).ExecuteDeleteAsync(ct);
        }
        else if (consenting) { prefs.AnalyzeMessages = true; prefs.MessagesConsentAt = now; }
        await db.SaveChangesAsync(ct);
        if (consenting) await RecomputeInterestsAsync(userId, ct);
        return await PreferencesAsync(userId, ct);
    }

    /// <summary>Apaga os interesses inferidos; conteúdo anterior a este momento não volta a ser analisado.</summary>
    public async Task ClearInterestsAsync(string userId, CancellationToken ct)
    {
        var now = Now;
        var prefs = await db.StorePreferences.SingleOrDefaultAsync(p => p.UserId == userId, ct);
        if (prefs == null) db.StorePreferences.Add(prefs = new StoreUserPreferences { UserId = userId });
        prefs.InterestsResetAt = now;
        prefs.InterestsComputedAt = prefs.AnalyzeMessages ? now : null;
        prefs.UpdatedAt = now;
        await db.StoreInterests.Where(i => i.UserId == userId).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Textos elegíveis do próprio usuário (Guilda e mensagens públicas das mesas), nos últimos 180 dias e depois do
    /// último pedido de exclusão. Nunca lê conteúdo de outras pessoas, privado, apagado ou retido pela moderação.</summary>
    public async Task<List<(string Text, DateTime At)>> SourcesAsync(string userId, DateTime since, CancellationToken ct)
    {
        var posts = await db.GuildPosts.AsNoTracking()
            .Where(p => p.AuthorId == userId && p.DeletedAt == null && p.HeldAt == null && p.CreatedAt >= since)
            .Join(db.GuildTopics.Where(t => t.DeletedAt == null && t.HeldAt == null), p => p.TopicId, t => t.Id, (p, t) => new { p.Body, p.CreatedAt })
            .OrderByDescending(p => p.CreatedAt).Take(SourceLimit).ToListAsync(ct);
        var topics = await db.GuildTopics.AsNoTracking()
            .Where(t => t.AuthorId == userId && t.DeletedAt == null && t.HeldAt == null && t.CreatedAt >= since)
            .OrderByDescending(t => t.CreatedAt).Take(TopicLimit).Select(t => new { t.Title, t.CreatedAt }).ToListAsync(ct);
        var messages = await db.Events.AsNoTracking()
            .Where(e => e.UserId == userId && e.Kind == EventKinds.Message && !e.MasterOnly && e.VisibleToUserId == null && !e.IsRecipientCopy && e.CreatedAt >= since)
            .OrderByDescending(e => e.Id).Take(SourceLimit).Select(e => new { e.Content, e.CreatedAt }).ToListAsync(ct);
        return posts.Select(p => (p.Body, p.CreatedAt)).Concat(topics.Select(t => (t.Title, t.CreatedAt))).Concat(messages.Select(m => (m.Content, m.CreatedAt))).ToList();
    }

    /// <summary>Recalcula os interesses de quem consentiu. Sem consentimento, apenas garante que nada fique guardado.</summary>
    public async Task RecomputeInterestsAsync(string userId, CancellationToken ct)
    {
        var now = Now;
        var prefs = await db.StorePreferences.SingleOrDefaultAsync(p => p.UserId == userId, ct);
        if (prefs is not { AnalyzeMessages: true })
        {
            await db.StoreInterests.Where(i => i.UserId == userId).ExecuteDeleteAsync(ct);
            return;
        }
        var since = now.AddDays(-SourceDays);
        if (prefs.InterestsResetAt is { } reset && reset > since) since = reset;
        var settings = await StoreQueries.SettingsAsync(db, ct);
        var tags = await db.StoreProductTags.AsNoTracking()
            .Where(t => db.StoreProducts.Any(p => p.Id == t.ProductId && p.DeletedAt == null && p.Status == StoreProductStatuses.Active))
            .Select(t => t.Value).Distinct().Take(5000).ToListAsync(ct);
        var keywords = await db.StoreCategories.AsNoTracking().Where(c => c.ArchivedAt == null).Select(c => c.Keywords).ToListAsync(ct);
        var vocabulary = StoreVocabulary.Build(tags.Concat(keywords.SelectMany(k => k.Split(','))), settings.Synonyms);
        var interests = vocabulary.Interests(await SourcesAsync(userId, since, ct), now);
        await db.StoreInterests.Where(i => i.UserId == userId).ExecuteDeleteAsync(ct);
        db.StoreInterests.AddRange(interests.Select(i => new StoreUserInterest { UserId = userId, Term = i.Term, Weight = i.Weight, UpdatedAt = now }));
        prefs.InterestsComputedAt = now;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Lote do serviço em segundo plano: consentimentos com cálculo vencido.</summary>
    public async Task<int> RecomputeDueAsync(int batch, CancellationToken ct)
    {
        var due = Now - RecomputeEvery;
        var users = await db.StorePreferences.AsNoTracking()
            .Where(p => p.AnalyzeMessages && (p.InterestsComputedAt == null || p.InterestsComputedAt < due))
            .OrderBy(p => p.InterestsComputedAt).Take(batch).Select(p => p.UserId).ToListAsync(ct);
        foreach (var user in users) await RecomputeInterestsAsync(user, ct);
        return users.Count;
    }
}

/// <summary>Manutenção da loja: interesses vencidos (com consentimento) a cada 30 min; retenção diária de cliques (365 dias),
/// exibições e resumos por produto (180 dias — produtos não vistos nesse prazo voltam a contar como nunca vistos).</summary>
public sealed class StoreMaintenanceWorker(IServiceScopeFactory scopes, ILogger<StoreMaintenanceWorker> logger) : BackgroundService
{
    public static readonly TimeSpan Retention = TimeSpan.FromDays(365);
    public static readonly TimeSpan ExposureRetention = TimeSpan.FromDays(180);

    public static async Task PruneAsync(GameDb db, DateTime now, CancellationToken ct)
    {
        var clicks = now - Retention;
        var exposures = now - ExposureRetention;
        await db.StoreInteractions.Where(i => i.CreatedAt < clicks).ExecuteDeleteAsync(ct);
        await db.StoreExposures.Where(e => e.CreatedAt < exposures).ExecuteDeleteAsync(ct);
        await db.StoreUserProductStats.Where(s => s.LastExposedAt < exposures).ExecuteDeleteAsync(ct);
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        var lastPrune = DateTime.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<StoreRecommendationService>().RecomputeDueAsync(50, stoppingToken);
                if (DateTime.UtcNow - lastPrune > TimeSpan.FromDays(1))
                {
                    await PruneAsync(scope.ServiceProvider.GetRequiredService<GameDb>(), DateTime.UtcNow, stoppingToken);
                    lastPrune = DateTime.UtcNow;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha na manutenção da loja."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}
