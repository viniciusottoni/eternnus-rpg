using System.Text.Json;
using Eternnus.Web;
using Microsoft.EntityFrameworkCore;

namespace Eternnus.Tests;

/// <summary>
/// Round Robin inteligente da vitrine (ADR-108): rotação por navegação exibida, filas e metas cumulativas, histórico de
/// exposição, cobertura do catálogo, aprendizado por cliques, CTR e privacidade. Mesmo fixture SQLite de <see cref="StoreTests"/>.
/// </summary>
public sealed partial class StoreTests
{
    static readonly string[] Pages = ["home", "campaigns", "guild", "characters", "library"];

    /// <summary>Navegação exibida: GET da vitrine + confirmação dos <paramref name="visible"/> primeiros cartões (3 no desktop, 1 no celular).</summary>
    async Task<StoreRecommendationsDto> SeeAsync(string user, string page = "home", int visible = 3, Guid? campaign = null, string? asUser = null)
    {
        var dto = await ShowcaseAsync(user, page, campaign);
        if (dto.Show && visible > 0)
            await analytics.RecordImpressionsAsync(asUser ?? user, new(dto.View!.Token, dto.Items.Take(visible).Select(i => i.Id).ToArray()), default);
        db.ChangeTracker.Clear();
        return dto;
    }

    /// <summary>Produtos ativos inseridos direto no banco (catálogos grandes sem o custo do cadastro administrativo).</summary>
    async Task<List<Guid>> BulkAsync(int count, string prefix, Guid? system = null, Guid? category = null, DateTime? published = null, string market = "amazon")
    {
        var ids = new List<Guid>();
        for (var i = 0; i < count; i++)
        {
            var created = published ?? DateTime.UtcNow.AddDays(-200);
            var p = new StoreProduct
            {
                Marketplace = market, AffiliateUrl = $"https://www.amazon.com.br/dp/B0{prefix}{i}", TargetUrl = $"https://www.amazon.com.br/dp/B0{prefix}{i}",
                Title = $"{prefix} {i}", Description = "Descrição", ImageUrl = Image($"{prefix}{i}"), CategoryId = category, Status = StoreProductStatuses.Active,
                CreatedAt = created, PublishedAt = created, UpdatedAt = created,
            };
            if (system is { } s) p.Systems.Add(new StoreProductSystem { ProductId = p.Id, RpgSystemId = s });
            db.StoreProducts.Add(p);
            ids.Add(p.Id);
        }
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return ids;
    }

    async Task<StoreRotationState?> StateAsync(string user) => await db.StoreRotationStates.AsNoTracking().SingleOrDefaultAsync(s => s.UserId == user);
    async Task ClickAsync(string user, Guid product, DateTime? at = null)
    {
        if (at == null) { await analytics.RecordAsync(user, new(product, StoreSurfaces.Showcase), default); return; }
        db.StoreInteractions.Add(new StoreInteraction { UserId = user, ProductId = product, Surface = StoreSurfaces.Store, CreatedAt = at.Value });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
    }

    // ---------- Navegação e rotação ----------
    [Fact]
    public async Task Each_displayed_navigation_renews_the_showcase_even_when_returning_to_a_page()
    {
        await BulkAsync(24, "T20", t20, published: DateTime.UtcNow.AddDays(-5));
        var seen = new List<Guid>();
        // Campanhas → Guilda → Personagens → Biblioteca → Início → Campanhas de novo.
        foreach (var page in Pages.Append("campaigns"))
        {
            var dto = await SeeAsync(Ana, page);
            Assert.Equal(3, dto.Items.Count);
            Assert.DoesNotContain(dto.Items, i => seen.Contains(i.Id));   // nada se repete dentro do histórico de 10 navegações
            seen.AddRange(dto.Items.Select(i => i.Id));
        }
        Assert.Equal(6, (await StateAsync(Ana))!.Cycle);
        Assert.Equal(18, await db.StoreExposures.CountAsync(e => e.UserId == Ana));
    }

    [Fact]
    public async Task Rerenders_and_repeated_confirmations_do_not_advance_the_cycle()
    {
        await BulkAsync(12, "T20", t20);
        var first = await ShowcaseAsync(Ana);
        var again = await ShowcaseAsync(Ana);                                  // nova renderização sem exibição confirmada
        Assert.Equal(first.Items.Select(i => i.Id), again.Items.Select(i => i.Id));
        Assert.Equal(0, again.View!.Cycle);
        Assert.Null(await StateAsync(Ana));                                    // GET nunca grava

        var ids = first.Items.Select(i => i.Id).ToArray();
        await analytics.RecordImpressionsAsync(Ana, new(first.View!.Token, ids), default);
        await analytics.RecordImpressionsAsync(Ana, new(first.View!.Token, ids), default);   // reenvio
        await analytics.RecordImpressionsAsync(Ana, new(again.View!.Token, ids), default);   // a mesma exibição pelo outro render
        db.ChangeTracker.Clear();
        var state = (await StateAsync(Ana))!;
        Assert.Equal(1, state.Cycle);
        Assert.Equal(3, state.Served().Sum());
        Assert.Equal(3, await db.StoreExposures.CountAsync());
    }

    [Fact]
    public async Task Canceled_or_forged_views_record_nothing()
    {
        await BulkAsync(6, "T20", t20);
        var canceled = await ShowcaseAsync(Ana);                               // requisição cancelada: nada exibido, nada enviado
        var next = await ShowcaseAsync(Ana, "guild");
        Assert.Equal(canceled.Items.Select(i => i.Id), next.Items.Select(i => i.Id));   // a oportunidade não foi consumida
        Assert.Empty(await db.StoreExposures.ToListAsync());

        var shownIds = next.Items.Select(i => i.Id).ToList();
        var stranger = (await db.StoreProducts.FirstAsync(p => !shownIds.Contains(p.Id))).Id;
        async Task<int> Status(string user, string? token, params Guid[] ids) =>
            (await Assert.ThrowsAsync<RuleException>(() => analytics.RecordImpressionsAsync(user, new(token, ids), default))).Status;
        Assert.Equal(400, await Status(Ana, next.View!.Token, stranger));                    // produto fora da exibição
        Assert.Equal(400, await Status(Ana, next.View!.Token[..^4] + "AAAA", next.Items[0].Id)); // token adulterado
        Assert.Equal(400, await Status(Bia, next.View!.Token, next.Items[0].Id));            // token de outra pessoa
        Assert.Equal(400, await Status(Ana, null, next.Items[0].Id));
        Assert.Equal(400, await Status(Ana, next.View!.Token));                               // nenhum produto
        Assert.Empty(await db.StoreExposures.ToListAsync());
        Assert.Null(await StateAsync(Bia));
    }

    [Fact]
    public async Task Rotation_state_survives_a_server_restart()
    {
        await BulkAsync(15, "T20", t20);
        var before = new List<Guid>();
        for (var i = 0; i < 2; i++) before.AddRange((await SeeAsync(Ana, Pages[i])).Items.Select(x => x.Id));
        // Reinício: novos serviços e novo contexto sobre o mesmo banco (as chaves de proteção são persistidas pela aplicação).
        await using var fresh = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        var restarted = await new StoreRecommendationService(fresh, TimeProvider.System, tokens).RecommendAsync(Ana, "home", null, default);
        Assert.Equal(2, restarted.View!.Cycle);
        Assert.DoesNotContain(restarted.Items, i => before.Contains(i.Id));
    }

    [Fact]
    public async Task Two_tabs_showing_the_same_cycle_count_each_product_once()
    {
        await BulkAsync(9, "T20", t20);
        var tabA = await ShowcaseAsync(Ana);
        var tabB = await ShowcaseAsync(Ana, "guild");
        Assert.Equal(tabA.View!.Cycle, tabB.View!.Cycle);
        await analytics.RecordImpressionsAsync(Ana, new(tabA.View.Token, tabA.Items.Select(i => i.Id).ToArray()), default);
        await analytics.RecordImpressionsAsync(Ana, new(tabB.View.Token, tabB.Items.Select(i => i.Id).ToArray()), default);
        db.ChangeTracker.Clear();
        Assert.Equal(3, await db.StoreExposures.CountAsync());
        Assert.Equal(1, (await StateAsync(Ana))!.Cycle);
        Assert.All(await db.StoreUserProductStats.ToListAsync(), s => Assert.Equal(1, s.Exposures));
    }

    // ---------- Filas e ranking ----------
    [Fact]
    public async Task Relevant_products_predominate_and_exploration_gets_a_controlled_share()
    {
        // Cenário 1 (docs/LOJA_AFILIADOS.md §4.6): muitas ofertas de Tormenta20 e um catálogo de outros sistemas.
        var tormenta = await BulkAsync(40, "T20", t20, published: DateTime.UtcNow.AddDays(-10));
        var others = await BulkAsync(30, "COC", coc);
        var shown = new List<(Guid Id, string Strategy)>();
        for (var i = 0; i < 20; i++)
        {
            var dto = await SeeAsync(Ana, Pages[i % Pages.Length]);
            shown.AddRange(dto.Items.Select((item, k) => (item.Id, dto.View!.Strategies[k])));
            var explore = dto.View!.Strategies.Count(s => s == StoreStrategies.Explore);
            Assert.True(explore <= 1, "no máximo um cartão de exploração por exibição");
        }
        var outside = shown.Count(s => others.Contains(s.Id));
        Assert.True(outside > 0, "produtos fora do perfil aparecem nas oportunidades de exploração");
        Assert.True(outside <= shown.Count * 0.2, $"exploração controlada ({outside} de {shown.Count})");
        Assert.All(shown.Where(s => others.Contains(s.Id)), s => Assert.Equal(StoreStrategies.Explore, s.Strategy));
        Assert.All(shown.Where(s => s.Strategy != StoreStrategies.Explore), s => Assert.Contains(s.Id, tormenta));
        // Metas cumulativas sobre o que foi visto: 40/30/20/10 com tolerância de um cartão por fila.
        var state = (await StateAsync(Ana))!;
        var served = state.Served();
        var total = served.Sum();
        Assert.Equal(60, total);
        foreach (var (share, count) in new[] { 40, 30, 20, 10 }.Zip(served)) Assert.InRange(count, share * total / 100.0 - 1.5, share * total / 100.0 + 1.5);
        // Nenhum produto voltou dentro de 10 navegações exibidas (há alternativas).
        var cycles = await db.StoreExposures.Where(e => e.UserId == Ana).GroupBy(e => e.ProductId).Select(g => g.Select(e => e.Cycle).ToList()).ToListAsync();
        Assert.All(cycles, c => Assert.All(c.Order().Zip(c.Order().Skip(1)), p => Assert.True(p.Second - p.First >= 10)));
    }

    [Fact]
    public async Task Mobile_first_card_alternates_popular_new_discovery_and_exploration()
    {
        await BulkAsync(12, "T20", t20, published: DateTime.UtcNow.AddDays(-3));
        await BulkAsync(6, "COC", coc);
        var leads = new List<string>();
        for (var i = 0; i < 10; i++) leads.Add((await SeeAsync(Ana, Pages[i % Pages.Length], visible: 1)).View!.Strategies[0]);
        // Round robin ponderado suave de 40/30/20/10: o celular recebe as quatro estratégias ao longo das navegações.
        Assert.Equal(["popular", "new", "related", "popular", "new", "explore", "popular", "related", "new", "popular"], leads);
        var state = (await StateAsync(Ana))!;
        Assert.Equal(10, state.Cycle);
        Assert.Equal(10, await db.StoreExposures.CountAsync());               // só o cartão visível conta
        Assert.Equal([4L, 3, 2, 1], state.Served());
    }

    [Fact]
    public void Never_seen_items_win_ties_and_tired_items_cool_down_longer()
    {
        var now = DateTime.UtcNow;
        StorePoolItem Item(StoreSeen? seen, double score = 0.5) =>
            new(new(Guid.NewGuid(), "amazon", null, [], new HashSet<string>(), true, true, false, 0, now, 0), 0, score, seen);
        var repeated = Item(new StoreSeen(5, 2, false));
        var never = Item(null);
        var older = Item(new StoreSeen(1, 1, false));
        Assert.Equal([never, older, repeated], StoreRotation.OrderPopular([repeated, older, never], 0));
        var rules = new StoreRotationRules(Cycle: 14, RepeatWindow: 10, FatigueImpressions: 4, MaxPerMarketplace: 3, CategoryDiversity: false);
        Assert.False(StoreRotation.Fresh(repeated.Seen, rules));            // 5 exibições sem clique: resfriamento de 20
        Assert.True(StoreRotation.Fresh(new StoreSeen(5, 2, true), rules));  // clicou: resfriamento normal
        Assert.True(StoreRotation.Fresh(repeated.Seen, rules with { Cycle = 22 }));   // volta depois do resfriamento
        var picks = StoreRotation.Select([0, 0], [[repeated, older, never]], [100, 0, 0, 0], rules);
        Assert.Equal([older.Id, never.Id], picks.Select(p => p.Item.Id));       // o cansado fica de fora havendo alternativa
        Assert.DoesNotContain(picks, p => p.Item == repeated);
    }

    [Fact]
    public async Task A_small_catalog_repeats_instead_of_hiding_the_showcase()
    {
        var only = await BulkAsync(2, "T20", t20);
        var first = await SeeAsync(Ana);
        var second = await SeeAsync(Ana, "guild");
        Assert.True(second.Show);
        Assert.Equal(only.Order(), first.Items.Select(i => i.Id).Order());
        Assert.Equal(only.Order(), second.Items.Select(i => i.Id).Order());
    }

    [Fact]
    public async Task Clicks_on_a_new_system_raise_its_relevance_gradually()
    {
        var cthulhu = await BulkAsync(4, "COC", coc);
        await BulkAsync(4, "T20", t20);
        async Task<StoreContextInfo> Context() => await recommendations.ContextAsync(Ana, null, await StoreQueries.PreferencesAsync(db, Ana, default), await StoreQueries.SettingsAsync(db, default), default);

        await ClickAsync(Ana, cthulhu[0]);
        var one = await Context();
        Assert.InRange(one.LearnedSystems[coc], 0.3, 0.45);                    // um clique isolado: interesse fraco
        Assert.False(one.Rank.Secondary.ContainsKey(coc));
        await ClickAsync(Ana, cthulhu[0], DateTime.UtcNow.AddMinutes(-40));    // repetir o mesmo produto não soma
        Assert.Equal(one.LearnedSystems[coc], (await Context()).LearnedSystems[coc]);

        await ClickAsync(Ana, cthulhu[1]);                                     // segundo produto distinto: sinal mais forte
        var two = await Context();
        Assert.True(two.LearnedSystems[coc] > 0.6);
        Assert.True(two.Rank.Secondary.ContainsKey(coc));
        Assert.Equal(t20, two.Rank.Primary);                                   // a campanha continua o contexto principal
        Assert.Equal(["Chamado de Cthulhu"], (await recommendations.PreferencesAsync(Ana, default)).LearnedSystems!);
        // O primeiro cartão continua do sistema da campanha.
        var showcase = await ShowcaseAsync(Ana);
        Assert.Contains(t20, (await db.StoreProductSystems.Where(s => s.ProductId == showcase.Items[0].Id).Select(s => s.RpgSystemId).ToListAsync()));
        Assert.Empty(await db.StoreInterests.ToListAsync());                   // cliques nunca viram termos de mensagens

        // Cliques antigos pesam menos; desligar o aprendizado tira o sinal (sem apagar as métricas).
        await recommendations.SavePreferencesAsync(Ana, new StorePreferencesInput(LearnFromClicks: false), default);
        Assert.Empty((await Context()).LearnedSystems);
        Assert.False((await Context()).Rank.Secondary.ContainsKey(coc));
        Assert.Empty((await recommendations.PreferencesAsync(Ana, default)).LearnedSystems!);
        Assert.Equal(3, await db.StoreInteractions.CountAsync());
        var aged = StoreRotation.LearnSystems([(Guid.NewGuid(), DateTime.UtcNow.AddDays(-90), [coc]), (Guid.NewGuid(), DateTime.UtcNow.AddDays(-90), [coc])], DateTime.UtcNow);
        Assert.True(aged[coc] < StoreRotation.LearnThreshold);
    }

    [Fact]
    public async Task Exploration_stays_active_after_many_clicks_in_the_same_system()
    {
        var tormenta = await BulkAsync(30, "T20", t20);
        var others = await BulkAsync(10, "COC", coc);
        foreach (var id in tormenta.Take(12)) await ClickAsync(Ana, id);
        var outside = 0;
        for (var i = 0; i < 15; i++) outside += (await SeeAsync(Ana, Pages[i % Pages.Length])).Items.Count(item => others.Contains(item.Id));
        Assert.True(outside >= 2, $"exploração continua mesmo com muitos cliques em Tormenta20 ({outside})");
        var settings = await catalog.SettingsAsync(default);
        var zero = Assert.ThrowsAsync<RuleException>(() => catalog.SaveSettingsAsync(new StoreSettingsInput(Pages: settings.Pages, Revision: settings.Revision, SharePopular: 50, ShareExplore: 0), Admin, default));
        Assert.Equal(400, (await zero).Status);
    }

    // ---------- Cobertura ----------
    [Fact]
    public async Task Every_active_product_is_eventually_shown_to_a_profiled_user()
    {
        var all = (await BulkAsync(6, "T20", t20)).Concat(await BulkAsync(3, "GEN", null, Dice)).Concat(await BulkAsync(24, "COC", coc)).ToHashSet();
        var navigations = 0;
        while (navigations < 150 && !all.All(id => db.StoreUserProductStats.Any(s => s.UserId == Ana && s.ProductId == id)))
            await SeeAsync(Ana, Pages[navigations++ % Pages.Length]);
        Assert.True(navigations < 150, "todos os produtos ativos recebem exibição real");
    }

    [Fact]
    public async Task Coverage_reaches_products_beyond_the_old_192_candidate_window()
    {
        // Cenário 3: usuário sem histórico, catálogo grande. Sem perfil, o catálogo inteiro é relevante e a cobertura percorre tudo.
        var all = await BulkAsync(231, "CAT", coc);
        var context = await recommendations.ContextAsync(Outsider, null, new StoreUserPreferences { UserId = Outsider }, new StoreSettings(), default);
        var window = await StoreQueries.GroupOrdered(StoreQueries.Public(db), context.Rank).Take(StoreRecommendationService.Window).Select(p => p.Id).ToListAsync();
        var outsideWindow = all.Except(window).ToList();
        Assert.NotEmpty(outsideWindow);
        for (var i = 0; i < 77; i++) await SeeAsync(Outsider, Pages[i % Pages.Length]);
        var seen = await db.StoreUserProductStats.Where(s => s.UserId == Outsider).Select(s => s.ProductId).ToListAsync();
        Assert.Equal(231, seen.Count);                                         // 77 × 3 cartões, nenhum repetido
        Assert.All(outsideWindow, id => Assert.Contains(id, seen));
        Assert.All(await db.StoreUserProductStats.ToListAsync(), s => Assert.Equal(1, s.Exposures));
    }

    [Fact]
    public async Task New_products_join_the_cycle_and_disabled_ones_leave_immediately()
    {
        await BulkAsync(12, "OLD", t20);
        for (var i = 0; i < 2; i++) await SeeAsync(Ana, Pages[i]);
        var fresh = await ProductAsync("Tormenta20 — Ameaças de Arton", [t20], category: Books);
        var next = await SeeAsync(Ana, "guild");
        Assert.Contains(fresh.Id, next.Items.Select(i => i.Id));               // entra sem reiniciar a fila
        var stats = await db.StoreUserProductStats.Where(s => s.UserId == Ana).ToListAsync();
        Assert.Equal(9, stats.Count);                                          // o histórico anterior foi preservado
        Assert.All(stats, x => Assert.Equal(1, x.Exposures));

        var pending = await ShowcaseAsync(Ana);
        var revision = (await catalog.AdminProductAsync(fresh.Id, default)).Revision;
        await catalog.SetStatusAsync(fresh.Id, new StoreStatusInput(StoreProductStatuses.Paused, revision), Admin, default);
        db.ChangeTracker.Clear();
        if (pending.Items.Any(i => i.Id == fresh.Id))                           // exibição emitida antes da pausa não conta mais
        {
            await analytics.RecordImpressionsAsync(Ana, new(pending.View!.Token, [fresh.Id]), default);
            Assert.Equal(1, await db.StoreExposures.CountAsync(e => e.ProductId == fresh.Id));
        }
        for (var i = 0; i < 12; i++) Assert.DoesNotContain(fresh.Id, (await SeeAsync(Ana, Pages[i % Pages.Length])).Items.Select(x => x.Id));
        // Edição e reativação não reiniciam a novidade.
        var published = (await db.StoreProducts.AsNoTracking().SingleAsync(p => p.Id == fresh.Id)).PublishedAt;
        revision = (await catalog.AdminProductAsync(fresh.Id, default)).Revision;
        await catalog.SetStatusAsync(fresh.Id, new StoreStatusInput(StoreProductStatuses.Active, revision), Admin, default);
        Assert.Equal(published, (await db.StoreProducts.AsNoTracking().SingleAsync(p => p.Id == fresh.Id)).PublishedAt);
    }

    [Fact]
    public async Task Coverage_restarts_with_the_least_recently_seen_after_a_full_round()
    {
        var all = await BulkAsync(6, "GEN", null, Dice);
        var first = (await SeeAsync(Outsider)).Items.Select(i => i.Id).ToList();
        var second = (await SeeAsync(Outsider, "guild")).Items.Select(i => i.Id).ToList();
        Assert.Equal(all.Order(), first.Concat(second).Order());               // rodada completa
        var third = (await SeeAsync(Outsider, "library")).Items.Select(i => i.Id).ToList();
        Assert.Equal(first.Order(), third.Order());                            // reinicia pelos vistos há mais tempo
    }

    // ---------- Responsividade (lado do servidor) ----------
    [Fact]
    public async Task Only_cards_actually_visible_count_and_resizing_does_not_duplicate()
    {
        await BulkAsync(9, "T20", t20);
        var dto = await ShowcaseAsync(Ana);
        await analytics.RecordImpressionsAsync(Ana, new(dto.View!.Token, [dto.Items[0].Id]), default);          // celular: 1 cartão
        db.ChangeTracker.Clear();
        Assert.Equal(1, await db.StoreExposures.CountAsync());
        Assert.False(await db.StoreUserProductStats.AnyAsync(s => s.ProductId == dto.Items[2].Id));            // não visto continua inédito
        await analytics.RecordImpressionsAsync(Ana, new(dto.View.Token, dto.Items.Select(i => i.Id).ToArray()), default); // girou para paisagem
        db.ChangeTracker.Clear();
        Assert.Equal(3, await db.StoreExposures.CountAsync());
        Assert.Equal(1, (await StateAsync(Ana))!.Cycle);                       // a mesma exibição não avança duas vezes
    }

    [Fact]
    public async Task Users_who_hid_the_showcase_neither_receive_nor_record_exposures()
    {
        await BulkAsync(6, "T20", t20);
        var dto = await ShowcaseAsync(Ana);
        await recommendations.SavePreferencesAsync(Ana, new StorePreferencesInput(ShowShowcase: false), default);
        Assert.False((await ShowcaseAsync(Ana)).Show);
        await analytics.RecordImpressionsAsync(Ana, new(dto.View!.Token, dto.Items.Select(i => i.Id).ToArray()), default);
        Assert.Empty(await db.StoreExposures.ToListAsync());
        Assert.Null(await StateAsync(Ana));
    }

    // ---------- Privacidade, deduplicação e CTR ----------
    [Fact]
    public async Task Duplicate_events_do_not_inflate_impressions_or_ctr_and_metrics_stay_aggregated()
    {
        await BulkAsync(6, "T20", t20, Dice, DateTime.UtcNow.AddDays(-1));
        var dto = await ShowcaseAsync(Ana);
        var ids = dto.Items.Select(i => i.Id).ToArray();
        await analytics.RecordImpressionsAsync(Ana, new(dto.View!.Token, ids), default);
        await analytics.RecordImpressionsAsync(Ana, new(dto.View!.Token, ids), default);
        await ClickAsync(Ana, ids[0]);
        await ClickAsync(Ana, ids[0]);                                         // duplicado na janela de 30 min
        await ClickAsync(Bia, ids[1]);                                         // sem exibição para Bia: não é atribuído
        db.ChangeTracker.Clear();
        var m = Json(await analytics.MetricsAsync(30, default));
        Assert.Equal(3, m.GetProperty("impressions").GetProperty("total").GetInt32());
        Assert.Equal(1, m.GetProperty("impressions").GetProperty("attributedClicks").GetInt32());
        Assert.Equal(33.33, m.GetProperty("impressions").GetProperty("ctr").GetDouble());
        var strategies = m.GetProperty("byStrategy").EnumerateArray().ToDictionary(s => s.GetProperty("key").GetString()!, s => s.GetProperty("rate"));
        Assert.Equal(1, strategies["popular"].GetProperty("impressions").GetInt32());
        Assert.Equal(100, strategies["popular"].GetProperty("ctr").GetDouble());
        Assert.True(strategies["popular"].GetProperty("smoothedCtr").GetDouble() < 50);   // amostra pequena não vira destaque
        Assert.False(strategies["popular"].GetProperty("reliable").GetBoolean());
        var coverage = m.GetProperty("coverage");
        Assert.Equal((6, 3, 3, 50.0), (coverage.GetProperty("active").GetInt32(), coverage.GetProperty("shown").GetInt32(), coverage.GetProperty("neverShown").GetInt32(), coverage.GetProperty("percent").GetDouble()));
        Assert.Equal(0, m.GetProperty("leastShown")[0].GetProperty("impressions").GetInt32());
        Assert.Equal(3, m.GetProperty("impressionsBySystem")[0].GetProperty("impressions").GetInt32());
        Assert.DoesNotContain(Ana, m.GetRawText());
        Assert.DoesNotContain(Bia, m.GetRawText());
    }

    [Fact]
    public async Task One_users_history_never_shapes_or_leaks_into_anothers_showcase()
    {
        await BulkAsync(9, "GEN", null, Dice);
        for (var i = 0; i < 2; i++) await SeeAsync(Bia, Pages[i]);
        var ana = await ShowcaseAsync(Outsider);
        Assert.Equal(0, ana.View!.Cycle);                                     // outra pessoa começa do zero
        Assert.Null(await StateAsync(Outsider));
        await Assert.ThrowsAsync<RuleException>(() => analytics.RecordImpressionsAsync(Bia, new(ana.View.Token, [ana.Items[0].Id]), default));
        Assert.DoesNotContain(Bia, JsonSerializer.Serialize(ana.Items));
    }

    // ---------- Cenários reproduzíveis e configuração ----------
    [Fact]
    public async Task Several_campaign_systems_all_get_turns_while_the_open_campaign_leads()
    {
        // Cenário 2: Tormenta20 (mestra), D&D 5e (jogadora) e Chamado de Cthulhu (campanha recente) + produtos de outro sistema.
        db.Add(new Campaign { OwnerId = Ana, Name = "Arkham", RpgSystemId = coc, LastActivityAt = DateTime.UtcNow.AddDays(-2) });
        await db.SaveChangesAsync();
        var pf2 = Guid.NewGuid();
        db.RpgSystems.Add(new RpgSystem { Id = pf2, Name = "Pathfinder 2e", Slug = "pf2e" });
        await db.SaveChangesAsync();
        var tormenta = await BulkAsync(10, "T20", t20);
        var dndIds = await BulkAsync(10, "DND", dnd);
        var cocIds = await BulkAsync(10, "COC", coc);
        var pathfinder = await BulkAsync(10, "PF2", pf2);
        var inReinos = await ShowcaseAsync(Ana, "campaign", reinos.Id);         // dentro da campanha de D&D, ela lidera
        Assert.Contains(inReinos.Items[0].Id, dndIds);
        var shown = new List<Guid>();
        for (var i = 0; i < 12; i++) shown.AddRange((await SeeAsync(Ana, Pages[i % Pages.Length])).Items.Select(x => x.Id));
        Assert.Contains(shown, tormenta.Contains);
        Assert.Contains(shown, dndIds.Contains);
        Assert.Contains(shown, cocIds.Contains);
        Assert.Contains(shown, pathfinder.Contains);                           // exploração fora do perfil
        Assert.True(shown.Count(tormenta.Contains) >= shown.Count(dndIds.Contains));
    }

    [Fact]
    public async Task Rotation_settings_are_validated_and_classic_ranking_still_works()
    {
        var s = await catalog.SettingsAsync(default);
        Assert.Equal((true, true, 10, 40, 30, 20, 10, 6, true, true), (s.SmartRotation, s.RotateOnNavigation, s.RepeatWindow, s.SharePopular, s.ShareNew, s.ShareRelated, s.ShareExplore, s.FatigueImpressions, s.LearnFromClicks, s.CatalogCoverage));
        async Task<int> Fail(StoreSettingsInput x) => (await Assert.ThrowsAsync<RuleException>(() => catalog.SaveSettingsAsync(x with { Pages = s.Pages, Revision = s.Revision }, Admin, default))).Status;
        Assert.Equal(400, await Fail(new(SharePopular: 50)));                  // soma 110
        Assert.Equal(400, await Fail(new(SharePopular: 45, ShareExplore: 5, RepeatWindow: 0)));
        Assert.Equal(400, await Fail(new(SharePopular: 37, ShareExplore: 3, ShareRelated: 30)));
        var saved = await catalog.SaveSettingsAsync(new StoreSettingsInput(Pages: s.Pages, Revision: s.Revision, SmartRotation: false, SharePopular: 50, ShareNew: 25, ShareRelated: 15, ShareExplore: 10, RepeatWindow: 5), Admin, default);
        Assert.Equal((false, 50, 5), (saved.SmartRotation, saved.SharePopular, saved.RepeatWindow));

        await ProductAsync("Tormenta20 — Livro Básico", [t20], category: Books);
        var classic = await SeeAsync(Ana);
        Assert.All(classic.View!.Strategies, k => Assert.Equal(StoreStrategies.Ranked, k));
        Assert.Equal(1, await db.StoreExposures.CountAsync(e => e.Strategy == StoreStrategies.Ranked));
    }

    [Fact]
    public async Task Store_pagination_is_stable_within_a_catalog_session()
    {
        await BulkAsync(30, "T20", t20);
        var page1 = await catalog.ProductsAsync(new(Seed: 7), Ana, default);
        var page2 = await catalog.ProductsAsync(new(Page: 2, Seed: 7), Ana, default);
        var ids = page1.Items.Concat(page2.Items).Select(i => i.Id).ToList();
        Assert.Equal(30, ids.Distinct().Count());
        Assert.Equal(page1.Items.Select(i => i.Id), (await catalog.ProductsAsync(new(Seed: 7), Ana, default)).Items.Select(i => i.Id));
    }

    [Fact]
    public async Task Retention_prunes_old_exposures_and_lets_products_count_as_unseen_again()
    {
        await BulkAsync(3, "T20", t20);
        await SeeAsync(Ana);
        await db.StoreExposures.ExecuteUpdateAsync(s => s.SetProperty(e => e.CreatedAt, DateTime.UtcNow.AddDays(-200)));
        await db.StoreUserProductStats.ExecuteUpdateAsync(s => s.SetProperty(e => e.LastExposedAt, DateTime.UtcNow.AddDays(-200)));
        await StoreMaintenanceWorker.PruneAsync(db, DateTime.UtcNow, default);
        Assert.Empty(await db.StoreExposures.ToListAsync());
        Assert.Empty(await db.StoreUserProductStats.ToListAsync());
        Assert.NotNull(await StateAsync(Ana));                                 // o ciclo continua
    }
}
