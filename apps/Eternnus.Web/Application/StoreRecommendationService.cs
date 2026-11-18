using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StoreLayoutDto(int Wide, int Medium, int Narrow);
public record StoreContextDto(string? SystemName);
public record StoreRecommendationsDto(bool Show, string? Reason, StoreLayoutDto Layout, List<StoreCardDto> Items, StoreContextDto Context);
public record StorePreferencesInput(bool ShowShowcase = true, bool UseCampaignSystems = true, bool AnalyzeMessages = false, Guid? InterestSystemId = null);
public record StoreInterestsDto(int Count, DateTime? ComputedAt, string[] Terms);
public record StorePreferencesDto(bool ShowShowcase, bool UseCampaignSystems, bool AnalyzeMessages, DateTime? MessagesConsentAt, Guid? InterestSystemId, StoreInterestsDto Interests);
/// <summary>Contexto calculado: regras para o ranking e o nome do sistema principal (só para exibição).</summary>
public sealed record StoreContextInfo(StoreRankContext Rank, string? SystemName);

/// <summary>
/// Recomendações contextuais (ADR-104, docs/LOJA_AFILIADOS.md §4–6). Leituras nunca gravam: os interesses por palavras são
/// calculados ao ativar o consentimento e depois pelo <see cref="StoreMaintenanceWorker"/>.
/// </summary>
public class StoreRecommendationService(GameDb db, TimeProvider clock)
{
    /// <summary>Janela de candidatos ordenados pelo ranking completo (múltiplo do tamanho da página da loja).</summary>
    public const int Window = 192;
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
        var since = now.AddDays(-SourceDays);
        var clicks = await db.StoreInteractions.AsNoTracking().Where(i => i.UserId == userId && i.CreatedAt >= since)
            .Join(db.StoreProducts, i => i.ProductId, p => p.Id, (i, p) => p.CategoryId)
            .Where(c => c != null).GroupBy(c => c!.Value).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        var top = clicks.Count == 0 ? 1 : clicks.Max(c => c.Count);
        var affinity = clicks.ToDictionary(c => c.Key, c => (double)c.Count / top);
        var name = primary is { } p ? await db.RpgSystems.AsNoTracking().Where(s => s.Id == p).Select(s => s.Name).SingleOrDefaultAsync(ct) : null;
        return new(new StoreRankContext(primary, secondary, interests, affinity, now, userId, settings.RotationHours, 0), name);
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
        var ranked = await StoreQueries.RankAsync(db, query, context.Rank, settings, cut, Window, ct);
        var count = Math.Max(settings.ShowcaseWide, Math.Max(settings.ShowcaseMedium, settings.ShowcaseNarrow));
        var picks = StoreRanking.Showcase(ranked, count, settings.MaxPerMarketplace, settings.CategoryDiversity);
        if (picks.Count == 0) return Hidden("empty");
        var items = await StoreQueries.CardsAsync(db, picks.Select(r => r.Candidate.Id).ToList(), cut, false, ct);
        return new(items.Count > 0, items.Count > 0 ? null : "empty", layout, items, new(context.SystemName));
    }

    // ---------- Preferências e consentimento ----------
    public async Task<StorePreferencesDto> PreferencesAsync(string userId, CancellationToken ct) =>
        Dto(await StoreQueries.PreferencesAsync(db, userId, ct), await db.StoreInterests.AsNoTracking().Where(i => i.UserId == userId).OrderByDescending(i => i.Weight).ThenBy(i => i.Term).ToListAsync(ct));

    static StorePreferencesDto Dto(StoreUserPreferences p, List<StoreUserInterest> interests) =>
        new(p.ShowShowcase, p.UseCampaignSystems, p.AnalyzeMessages, p.MessagesConsentAt, p.InterestSystemId,
            new(interests.Count, p.InterestsComputedAt, interests.Take(10).Select(i => i.Term).ToArray()));

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

/// <summary>Manutenção da loja: interesses vencidos (com consentimento) a cada 30 min e retenção de cliques (365 dias) diária.</summary>
public sealed class StoreMaintenanceWorker(IServiceScopeFactory scopes, ILogger<StoreMaintenanceWorker> logger) : BackgroundService
{
    public static readonly TimeSpan Retention = TimeSpan.FromDays(365);
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
                    var cut = DateTime.UtcNow - Retention;
                    await scope.ServiceProvider.GetRequiredService<GameDb>().StoreInteractions.Where(i => i.CreatedAt < cut).ExecuteDeleteAsync(stoppingToken);
                    lastPrune = DateTime.UtcNow;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha na manutenção da loja."); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}
