using System.Net;
using System.Text.Json;
using Eternnus.Web;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Eternnus.Tests;

/// <summary>Loja do Aventureiro (ADR-104): catálogo, links afiliados, recomendador contextual e privacidade, em SQLite.</summary>
public sealed class StoreTests : IAsyncLifetime
{
    /// <summary>Leitor de páginas falso: nunca acessa a rede e registra se foi chamado.</summary>
    sealed class FakeReader : StoreLinkReader
    {
        public int Calls;
        public Func<Uri, (Uri, string)>? Page;
        public override Task<(Uri Final, string Html)> ReadAsync(Uri start, string marketplace, CancellationToken ct)
        {
            Calls++;
            return Page is null ? throw new StoreLinkException("status-403") : Task.FromResult(Page(start));
        }
    }

    const string Admin = "admin", Ana = "ana", Bia = "bia", Outsider = "outsider";
    readonly SqliteConnection connection = new("Data Source=:memory:");
    GameDb db = null!;
    FakeReader reader = null!;
    StoreCatalogService catalog = null!;
    StoreRecommendationService recommendations = null!;
    StoreAnalyticsService analytics = null!;
    StoreAffiliateService affiliates = null!;
    readonly Guid t20 = Guid.NewGuid(), dnd = Guid.NewGuid(), coc = Guid.NewGuid();
    Campaign arton = null!, reinos = null!;
    static readonly Guid Books = Guid.Parse("00000000-0000-4000-8000-000000000301"), Dice = Guid.Parse("00000000-0000-4000-8000-000000000304"),
        Minis = Guid.Parse("00000000-0000-4000-8000-000000000305"), Adventures = Guid.Parse("00000000-0000-4000-8000-000000000303");
    static readonly Guid Taverna = Guid.Parse("00000000-0000-4000-8000-000000000202");

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        db = new GameDb(new DbContextOptionsBuilder<GameDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        foreach (var (id, role) in new[] { (Admin, PlatformRoles.Admin), (Ana, PlatformRoles.Common), (Bia, PlatformRoles.Common), (Outsider, PlatformRoles.Common) })
            db.Users.Add(new AppUser { Id = id, UserName = id, NormalizedEmail = id.ToUpperInvariant(), EmailConfirmed = true, DisplayName = id, Role = role, Level = 3 });
        db.RpgSystems.AddRange(
            new RpgSystem { Id = t20, Name = "Tormenta20", Slug = "tormenta20" },
            new RpgSystem { Id = dnd, Name = "D&D 5e", Slug = "dnd-5e" },
            new RpgSystem { Id = coc, Name = "Chamado de Cthulhu", Slug = "chamado-de-cthulhu" });
        // Ana: campanha ativa de Tormenta20 (mestre) e campanha secundária de D&D 5e (jogadora, atividade antiga).
        arton = new Campaign { OwnerId = Ana, Name = "Arton", RpgSystemId = t20, LastActivityAt = DateTime.UtcNow.AddHours(-1) };
        reinos = new Campaign { OwnerId = Bia, Name = "Reinos", RpgSystemId = dnd, LastActivityAt = DateTime.UtcNow.AddDays(-20) };
        db.AddRange(arton, reinos, new Member { CampaignId = reinos.Id, UserId = Ana });
        await db.SaveChangesAsync();
        reader = new FakeReader();
        var audit = new AuditService(db);
        recommendations = new StoreRecommendationService(db, TimeProvider.System);
        affiliates = new StoreAffiliateService(db, reader, new ConfigurationBuilder().Build(), NullLogger<StoreAffiliateService>.Instance);
        catalog = new StoreCatalogService(db, audit, recommendations, affiliates, TimeProvider.System);
        analytics = new StoreAnalyticsService(db, TimeProvider.System);
    }
    public async Task DisposeAsync() { await db.DisposeAsync(); await connection.DisposeAsync(); }

    static string Image(string name) => $"https://m.media-amazon.com/images/I/{name}.jpg";
    int sequence;
    async Task<StoreAdminProductDto> ProductAsync(string title, Guid[]? systems = null, string[]? tags = null, Guid? category = null, string status = StoreProductStatuses.Active,
        int priority = 0, int? price = null, string market = "amazon", bool image = true, int? previous = null)
    {
        var n = ++sequence;
        var url = market switch
        {
            "shopee" => $"https://shopee.com.br/produto-i.123.{n}?af_id=eternnus",
            "mercadolivre" => $"https://produto.mercadolivre.com.br/MLB-10000{n:000}-produto?matt_tool=eternnus",
            _ => $"https://www.amazon.com.br/dp/B0TEST{n:0000}?tag=eternnus-20",
        };
        return await catalog.CreateAsync(new StoreProductInput(url, title, "Descrição de " + title, image ? Image("p" + n) : null, "Editora", category, systems ?? [], tags ?? [],
            price, previous, "BRL", price != null, null, status, priority), Admin, default)
            .ContinueWith(t => { db.ChangeTracker.Clear(); return t.Result; });
    }
    static JsonElement Json(object o) => JsonSerializer.SerializeToElement(o, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    Task<StoreRecommendationsDto> ShowcaseAsync(string user, string page = "home", Guid? campaign = null) => recommendations.RecommendAsync(user, page, campaign, default);
    static List<string> Titles(IEnumerable<StoreCardDto> cards) => cards.Select(c => c.Title).ToList();
    async Task ConsentAsync(string user) => await recommendations.SavePreferencesAsync(user, new StorePreferencesInput(AnalyzeMessages: true), default);
    async Task PostAsync(string author, string body, DateTime? at = null, Action<GuildPost>? change = null, Action<GuildTopic>? topicChange = null)
    {
        var topic = new GuildTopic { CategoryId = Taverna, AuthorId = Bia, Title = "Conversa", CreatedAt = at ?? DateTime.UtcNow };
        topicChange?.Invoke(topic);
        var post = new GuildPost { TopicId = topic.Id, AuthorId = author, Body = body, CreatedAt = at ?? DateTime.UtcNow };
        change?.Invoke(post);
        db.AddRange(topic, post);
        await db.SaveChangesAsync();
    }

    // ---------- Catálogo e cadastro ----------
    [Fact]
    public async Task Admin_registers_links_from_each_marketplace_preserving_affiliate_parameters()
    {
        var amazon = await ProductAsync("Tormenta20 — Livro Básico", [t20], ["tormenta", "arton"], Books);
        var shopee = await ProductAsync("Dados metálicos", tags: ["dados metálicos"], category: Dice, market: "shopee");
        var meli = await ProductAsync("Escudo do Mestre", [t20], market: "mercadolivre");
        Assert.Equal(("amazon", "Amazon"), (amazon.Marketplace, amazon.MarketplaceName));
        Assert.StartsWith("B0TEST", amazon.ExternalId);
        Assert.Contains("tag=eternnus-20", amazon.TargetUrl);
        Assert.Equal(amazon.AffiliateUrl, amazon.TargetUrl);
        Assert.Equal(("shopee", "123.2"), (shopee.Marketplace, shopee.ExternalId));
        Assert.Equal("mercadolivre", meli.Marketplace);
        Assert.Equal("MLB10000003", meli.ExternalId);
        Assert.Contains("matt_tool=eternnus", meli.TargetUrl);

        var card = await catalog.ProductAsync(amazon.Id, default);
        Assert.Equal("Amazon", card.MarketplaceName);
        Assert.Equal(amazon.TargetUrl, card.Url);
        // Auditoria registra a ação sem o link afiliado.
        var entries = await db.Audit.Where(a => a.Action == "store.product.create").ToListAsync();
        Assert.Equal(3, entries.Count);
        Assert.All(entries, e => Assert.DoesNotContain("eternnus-20", e.Data + e.Summary));
    }

    [Theory]
    [InlineData("http://www.amazon.com.br/dp/B000000001")]
    [InlineData("https://www.amazon.com.br:8443/dp/B000000001")]
    [InlineData("https://user:pw@www.amazon.com.br/dp/B000000001")]
    [InlineData("https://www.amazon.com.br.evil.example/dp/B000000001")]
    [InlineData("https://evilamazon.com.br/dp/B000000001")]
    [InlineData("https://example.com/produto")]
    [InlineData("https://127.0.0.1/dp/B000000001")]
    [InlineData("javascript:alert(1)")]
    [InlineData("")]
    public async Task Invalid_or_foreign_links_are_rejected(string url)
    {
        var error = await Assert.ThrowsAsync<RuleException>(() => catalog.CreateAsync(new StoreProductInput(url, "Produto"), Admin, default));
        Assert.Equal(400, error.Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => affiliates.PreviewAsync(new(url), default))).Status);
    }

    [Fact]
    public async Task Images_prices_and_tags_are_validated()
    {
        const string url = "https://www.amazon.com.br/dp/B000000001?tag=x-20";
        async Task<int> Fails(StoreProductInput input) => (await Assert.ThrowsAsync<RuleException>(() => catalog.CreateAsync(input, Admin, default))).Status;
        Assert.Equal(400, await Fails(new(url, "A", ImageUrl: "https://evil.example/a.jpg")));
        Assert.Equal(400, await Fails(new(url, "A", ImageUrl: "http://m.media-amazon.com/a.jpg")));
        Assert.Equal(400, await Fails(new(url, "A", PriceCents: 1000)));                                   // preço sem conferência
        Assert.Equal(400, await Fails(new(url, "A", PriceCents: 1000, PreviousPriceCents: 900, ConfirmPrice: true))); // "anterior" menor
        Assert.Equal(400, await Fails(new(url, "A", Availability: StoreAvailability.InStock)));             // estoque sem conferência
        Assert.Equal(400, await Fails(new(url, "")));
        Assert.Equal(400, await Fails(new(url, "A", Tags: [new string('x', 41)])));
        Assert.Equal(400, await Fails(new(url, "A", SystemIds: [Guid.NewGuid()])));

        var ok = await catalog.CreateAsync(new(url, "  Dados  ", Tags: ["D20", "d20", " dados metálicos "], PriceCents: 9990, PreviousPriceCents: 12990, ConfirmPrice: true, Status: "active"), Admin, default);
        Assert.Equal(["d20", "dados metálicos"], ok.Tags);
        Assert.NotNull(ok.PriceCheckedAt);
        var card = await catalog.ProductAsync(ok.Id, default);
        Assert.Equal(("current", 9990, 12990, true), (card.PriceStatus, card.PriceCents, card.PreviousPriceCents, card.OnSale));

        // Edição do preço exige nova confirmação; sem ela, o anterior continua.
        var change = new StoreProductInput(url, "Dados", PriceCents: 8990, Revision: ok.Revision);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.UpdateAsync(ok.Id, change, Admin, default))).Status);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.UpdateAsync(ok.Id, change with { ConfirmPrice = true, Revision = 99 }, Admin, default))).Status);

        // Preço vencido some do público ("Consultar preço na loja"), sem inventar valor.
        await db.StoreProducts.Where(p => p.Id == ok.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.PriceCheckedAt, DateTime.UtcNow.AddDays(-3)));
        card = await catalog.ProductAsync(ok.Id, default);
        Assert.Equal(("stale", (int?)null, (int?)null, false), (card.PriceStatus, card.PriceCents, card.PreviousPriceCents, card.OnSale));
    }

    [Fact]
    public async Task Multi_system_and_generic_products_filter_and_page_on_the_server()
    {
        var core = await ProductAsync("Tormenta20 — Livro Básico", [t20], category: Books);
        var both = await ProductAsync("Bestiário Compatível", [t20, dnd], category: Books);
        var dice = await ProductAsync("Conjunto de dados poliédricos", category: Dice, market: "shopee", price: 4990);
        var dndBook = await ProductAsync("Livro do Jogador", [dnd], category: Books, market: "mercadolivre", price: 29990);
        for (var i = 0; i < 26; i++) await ProductAsync($"Miniatura {i:00}", [coc], category: Minis, price: 1000 + i);

        var t20Page = await catalog.ProductsAsync(new(System: [t20.ToString()], Sort: "newest"), Bia, default);
        Assert.Equal([both.Title, core.Title], Titles(t20Page.Items));
        Assert.True(t20Page.Items.Single(c => c.Id == both.Id).Systems.Length == 2);
        var generic = await catalog.ProductsAsync(new(System: ["generic"]), Bia, default);
        Assert.Equal([dice.Id], generic.Items.Select(c => c.Id));
        Assert.True(generic.Items[0].Generic);

        var all = await catalog.ProductsAsync(new(Sort: "price_asc"), Bia, default);
        Assert.Equal((30, 24, 24), (all.Total, all.PageSize, all.Items.Count));
        var second = await catalog.ProductsAsync(new(Sort: "price_asc", Page: 2), Bia, default);
        Assert.Equal(6, second.Items.Count);
        Assert.Empty(all.Items.Select(c => c.Id).Intersect(second.Items.Select(c => c.Id)));
        Assert.Equal("Miniatura 00", all.Items[0].Title);                    // menor preço conferido primeiro
        Assert.Contains(second.Items, c => c.PriceStatus == "none");          // sem preço vai para o fim

        var combined = await catalog.ProductsAsync(new(Marketplace: ["mercadolivre", "shopee"], Category: [Books, Dice], MinPrice: 40m, MaxPrice: 300m), Bia, default);
        Assert.Equal([dice.Id, dndBook.Id], combined.Items.Select(c => c.Id).OrderBy(id => id == dice.Id ? 0 : 1));
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.ProductsAsync(new(MinPrice: 10, MaxPrice: 5), Bia, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.ProductsAsync(new(Marketplace: ["aliexpress"]), Bia, default))).Status);

        var filters = await catalog.FiltersAsync(default);
        Assert.Equal(1, filters.GenericCount);
        Assert.Equal(2, filters.Systems.Single(s => s.Id == t20).Count);
        Assert.Equal(26, filters.Categories.Single(c => c.Id == Minis).Count);
    }

    [Fact]
    public async Task Inactive_and_deleted_products_stay_out_of_the_public_catalog()
    {
        var active = await ProductAsync("Escudo do Mestre ativo");
        var draft = await ProductAsync("Escudo rascunho", status: StoreProductStatuses.Draft);
        var paused = await ProductAsync("Escudo pausado", status: StoreProductStatuses.Paused);
        var archived = await ProductAsync("Escudo arquivado", status: StoreProductStatuses.Archived);
        var deleted = await ProductAsync("Escudo excluído");
        await catalog.DeleteAsync(deleted.Id, Admin, default);

        var page = await catalog.ProductsAsync(new(Q: "escudo"), Bia, default);
        Assert.Equal([active.Id], page.Items.Select(c => c.Id));
        foreach (var hidden in new[] { draft, paused, archived, deleted })
            Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => catalog.ProductAsync(hidden.Id, default))).Status);
        Assert.Single(Json(await catalog.SuggestionsAsync("escudo", default)).GetProperty("items").EnumerateArray());
        Assert.Equal(404, (await Assert.ThrowsAsync<RuleException>(() => analytics.RecordAsync(Bia, new(paused.Id, "store"), default))).Status);

        var admin = await catalog.AdminListAsync(null, null, null, null, null, 1, default);
        Assert.Equal(4, admin.Total);                                         // excluído some também da administração
        Assert.Equal((1, 1, 1, 1), (admin.Counts["active"], admin.Counts["draft"], admin.Counts["paused"], admin.Counts["archived"]));
        var activated = await catalog.SetStatusAsync(draft.Id, new("active", draft.Revision), Admin, default);
        Assert.Equal("active", activated.Status);
        Assert.Equal(2, (await catalog.ProductsAsync(new(Q: "escudo"), Bia, default)).Total);
    }

    [Fact]
    public async Task Search_ignores_case_accents_simple_plurals_tags_categories_and_synonyms()
    {
        var dragon = await ProductAsync("Dragões de Arton", [t20]);
        var mini = await ProductAsync("Figura pintada", tags: ["miniatura de dragão"], category: Minis);
        var dice = await ProductAsync("Conjunto poliédrico", category: Dice);
        var book = await ProductAsync("Manual", [coc]);
        Assert.Contains(dragon.Id, (await catalog.ProductsAsync(new(Q: "DRAGOES"), Bia, default)).Items.Select(c => c.Id));
        var singular = (await catalog.ProductsAsync(new(Q: "dragão"), Bia, default)).Items.Select(c => c.Id).ToList();
        Assert.Contains(dragon.Id, singular);                                 // "dragão" encontra "Dragões"
        Assert.Contains(mini.Id, singular);                                   // pela tag
        Assert.Equal(dragon.Id, singular[0]);                                 // título pesa mais
        Assert.Contains(dice.Id, (await catalog.ProductsAsync(new(Q: "d20"), Bia, default)).Items.Select(c => c.Id)); // sinônimo → categoria "Dados"
        Assert.Contains(book.Id, (await catalog.ProductsAsync(new(Q: "cthulhu"), Bia, default)).Items.Select(c => c.Id)); // nome do sistema
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.ProductsAsync(new(Q: "x"), Bia, default))).Status);
    }

    // ---------- Recomendação ----------
    [Fact]
    public async Task Campaign_system_has_absolute_priority_over_popularity_and_commercial_priority()
    {
        var t20Core = await ProductAsync("Tormenta20 — Livro Básico", [t20], category: Books);
        var t20Adventure = await ProductAsync("Aventura em Arton", [t20], category: Adventures);
        var dndHot = await ProductAsync("Livro do Jogador 5e", [dnd], category: Books, priority: 100);
        var generic = await ProductAsync("Dados metálicos", category: Dice, priority: 100);
        await db.StoreProducts.Where(p => p.Id == dndHot.Id || p.Id == generic.Id).ExecuteUpdateAsync(s => s.SetProperty(p => p.Clicks, 5000));

        var home = await ShowcaseAsync(Ana);
        Assert.True(home.Show);
        Assert.Equal("Tormenta20", home.Context.SystemName);
        Assert.Equal(new HashSet<Guid> { t20Core.Id, t20Adventure.Id }, home.Items.Take(2).Select(c => c.Id).ToHashSet());
        Assert.Equal(dndHot.Id, home.Items[2].Id);                          // secundário antes do genérico

        // Na página da campanha de D&D, o sistema dela vira o principal.
        var inReinos = await ShowcaseAsync(Ana, "campaign", reinos.Id);
        Assert.Equal(dndHot.Id, inReinos.Items[0].Id);
        Assert.Equal("D&D 5e", inReinos.Context.SystemName);
        // Campanha alheia como contexto é ignorada sem revelar nada.
        Assert.Null((await ShowcaseAsync(Outsider, "campaign", reinos.Id)).Context.SystemName);
        // A loja ordena pelo mesmo contexto quando não há busca nem ordenação explícita.
        var store = await catalog.ProductsAsync(new(), Ana, default);
        Assert.True(store.Personalized);
        Assert.Equal(new HashSet<Guid> { t20Core.Id, t20Adventure.Id }, store.Items.Take(2).Select(c => c.Id).ToHashSet());
        Assert.Equal([dndHot.Id, generic.Id], store.Items.Skip(2).Select(c => c.Id));
    }

    [Fact]
    public async Task Generic_products_fill_gaps_and_users_without_campaigns_still_get_a_safe_fallback()
    {
        var only = await ProductAsync("Tormenta20 — Livro Básico", [t20], category: Books);
        var dice = await ProductAsync("Dados metálicos", category: Dice);
        var cthulhu = await ProductAsync("Investigador", [coc], category: Books);
        var ana = await ShowcaseAsync(Ana);
        Assert.Equal([only.Id, dice.Id, cthulhu.Id], ana.Items.Select(c => c.Id));

        // Sem campanhas e sem mensagens: genéricos primeiro, depois os demais.
        var outsider = await ShowcaseAsync(Outsider);
        Assert.True(outsider.Show);
        Assert.Equal(dice.Id, outsider.Items[0].Id);
        Assert.Equal(3, outsider.Items.Count);
        Assert.Null(outsider.Context.SystemName);

        // Sem usar campanhas, vale só o sistema de interesse escolhido.
        await recommendations.SavePreferencesAsync(Ana, new StorePreferencesInput(UseCampaignSystems: false, InterestSystemId: coc), default);
        Assert.Equal(cthulhu.Id, (await ShowcaseAsync(Ana)).Items[0].Id);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => recommendations.SavePreferencesAsync(Ana, new StorePreferencesInput(InterestSystemId: Guid.NewGuid()), default))).Status);
    }

    [Fact]
    public async Task Archived_campaigns_weigh_less_than_active_secondary_campaigns()
    {
        var old = new Campaign { OwnerId = Ana, Name = "Antiga", RpgSystemId = coc, LastActivityAt = DateTime.UtcNow.AddDays(-2), ArchivedAt = DateTime.UtcNow.AddDays(-1) };
        db.Add(old);
        await db.SaveChangesAsync();
        var context = await recommendations.ContextAsync(Ana, null, new StoreUserPreferences { UserId = Ana }, new StoreSettings(), default);
        Assert.Equal(t20, context.Rank.Primary);
        Assert.True(context.Rank.Secondary[coc] < context.Rank.Secondary[dnd]);
        Assert.True(context.Rank.Secondary[coc] <= 0.3);
    }

    [Fact]
    public async Task Recurring_words_with_consent_reorder_only_inside_the_same_group()
    {
        var core = await ProductAsync("Tormenta20 — Livro Básico", [t20], ["livro basico"], Books, priority: 100);
        var dragonMini = await ProductAsync("Miniatura de dragão vermelho", [t20], ["miniatura", "dragão"], Minis);
        var dndDragon = await ProductAsync("Dragões de Faerûn", [dnd], ["dragão"], Books, priority: 100);
        Assert.Equal(core.Id, (await ShowcaseAsync(Ana)).Items[0].Id);

        await PostAsync(Ana, "Adoro dragões! Dragões dragões dragões nas minhas mesas.", DateTime.UtcNow.AddDays(-3));
        await PostAsync(Ana, "Pintei uma miniatura de dragão ontem.", DateTime.UtcNow.AddDays(-1));
        await ConsentAsync(Ana);
        var prefs = await recommendations.PreferencesAsync(Ana, default);
        Assert.Contains("dragao", prefs.Interests.Terms);
        Assert.Contains("miniatura", prefs.Interests.Terms);
        var showcase = await ShowcaseAsync(Ana);
        Assert.Equal([dragonMini.Id, core.Id, dndDragon.Id], showcase.Items.Select(c => c.Id));  // D&D continua atrás de Tormenta20
    }

    [Fact]
    public void Rotation_is_limited_stable_within_the_window_and_never_crosses_groups()
    {
        var now = new DateTime(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc);
        var primary = Guid.NewGuid();
        StoreRankCandidate Candidate(Guid? system) => new(Guid.NewGuid(), "amazon", null, system is { } s ? [s] : [], new HashSet<string>(), true, true, false, 50, now, 0);
        var tied = Enumerable.Range(0, 6).Select(_ => Candidate(primary)).ToList();
        var generic = Candidate(null);
        StoreRankContext At(DateTime when) => new(primary, new Dictionary<Guid, double>(), new Dictionary<string, double>(), new Dictionary<Guid, double>(), when, "ana", 6, 0);
        var first = StoreRanking.Rank(tied.Append(generic), At(now));
        Assert.Equal(first.Select(r => r.Candidate.Id), StoreRanking.Rank(tied.Append(generic), At(now.AddHours(1))).Select(r => r.Candidate.Id)); // mesma janela
        Assert.All(Enumerable.Range(1, 8).Select(i => StoreRanking.Rank(tied.Append(generic), At(now.AddHours(6 * i)))), r => Assert.Equal(generic.Id, r[^1].Candidate.Id));
        var orders = Enumerable.Range(0, 8).Select(i => string.Join(",", StoreRanking.Rank(tied, At(now.AddHours(6 * i))).Select(r => r.Candidate.Id))).Distinct().Count();
        Assert.True(orders > 1, "itens empatados devem alternar entre janelas");
        // Pontuações distantes não entram na mesma faixa de rotação.
        var strong = Candidate(primary) with { Priority = 100, Clicks = 0 };
        var weak = Candidate(primary) with { Priority = 0, HasImage = false, HasDescription = false };
        Assert.All(Enumerable.Range(0, 8), i => Assert.Equal(strong.Id, StoreRanking.Rank([weak, strong], At(now.AddHours(6 * i)))[0].Candidate.Id));
    }

    [Fact]
    public void Showcase_prefers_diversity_of_marketplace_and_category_without_crossing_groups()
    {
        var now = DateTime.UtcNow;
        var system = Guid.NewGuid();
        var catA = Guid.NewGuid();
        var catB = Guid.NewGuid();
        StoreRanked R(string market, Guid? category, double score, int group = 0) =>
            new(new(Guid.NewGuid(), market, category, [system], new HashSet<string>(), true, true, true, 0, now, 0), group, score);
        var a1 = R("amazon", catA, 0.60); var a2 = R("amazon", catA, 0.59); var a3 = R("amazon", catA, 0.58);
        var s1 = R("shopee", catB, 0.55); var g = R("shopee", catB, 0.99, group: 2);
        var picks = StoreRanking.Showcase([a1, a2, a3, s1, g], 3, 2, true);
        Assert.Equal(new[] { a1, s1, a2 }, picks);                                   // nova loja/categoria, sem trazer o grupo 2
        // Sem alternativa próxima no mesmo grupo, a ordem do grupo vence.
        var far = R("shopee", catB, 0.20);
        Assert.Equal(new[] { a1, a2, a3 }, StoreRanking.Showcase([a1, a2, a3, far], 3, 1, true));
        Assert.DoesNotContain(g, StoreRanking.Showcase([a1, a2, a3, far, g], 3, 1, true));
    }

    [Fact]
    public async Task Explicit_store_filters_and_sorting_prevail_over_personalization()
    {
        await ProductAsync("Tormenta20 — Livro Básico", [t20], price: 20000);
        var dndBook = await ProductAsync("Livro do Jogador", [dnd], price: 30000);
        var cheap = await ProductAsync("Dados", price: 1000);
        var filtered = await catalog.ProductsAsync(new(System: [dnd.ToString()]), Ana, default);
        Assert.Equal([dndBook.Id], filtered.Items.Select(c => c.Id));
        var byPrice = await catalog.ProductsAsync(new(Sort: "price_asc"), Ana, default);
        Assert.False(byPrice.Personalized);
        Assert.Equal(cheap.Id, byPrice.Items[0].Id);
        var searched = await catalog.ProductsAsync(new(Q: "livro do jogador"), Ana, default);
        Assert.False(searched.Personalized);
        Assert.Equal(dndBook.Id, searched.Items[0].Id);
    }

    [Fact]
    public async Task Showcase_is_hidden_when_disabled_ineligible_hidden_by_the_user_or_empty()
    {
        Assert.Equal("empty", (await ShowcaseAsync(Ana)).Reason);
        await ProductAsync("Sem imagem", [t20], image: false);
        Assert.Equal("empty", (await ShowcaseAsync(Ana)).Reason);            // a vitrine exige imagem
        await ProductAsync("Com imagem", [t20]);
        Assert.True((await ShowcaseAsync(Ana)).Show);
        foreach (var page in new[] { "table", "session", "admin", "login", "store", "", null })
            Assert.Equal("page", (await recommendations.RecommendAsync(Ana, page, null, default)).Reason);
        Assert.Equal("page", (await ShowcaseAsync(Ana, "progress")).Reason);  // fora das páginas padrão

        await recommendations.SavePreferencesAsync(Ana, new StorePreferencesInput(ShowShowcase: false), default);
        var hidden = await ShowcaseAsync(Ana);
        Assert.Equal(("hidden", false, 0), (hidden.Reason, hidden.Show, hidden.Items.Count));
        Assert.True((await ShowcaseAsync(Bia)).Show);

        var settings = await catalog.SettingsAsync(default);
        await catalog.SaveSettingsAsync(new StoreSettingsInput(Enabled: false, Pages: settings.Pages, Revision: settings.Revision), Admin, default);
        Assert.Equal("disabled", (await ShowcaseAsync(Bia)).Reason);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.SaveSettingsAsync(new StoreSettingsInput(Revision: settings.Revision), Admin, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.SaveSettingsAsync(new StoreSettingsInput(Pages: ["table"], Revision: 2), Admin, default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => catalog.SaveSettingsAsync(new StoreSettingsInput(ShowcaseWide: 9, Revision: 2), Admin, default))).Status);
    }

    // ---------- Privacidade ----------
    [Fact]
    public async Task Only_the_users_own_public_eligible_content_builds_interests()
    {
        await ProductAsync("Dados metálicos", tags: ["dados metálicos"]);
        await ProductAsync("Miniatura", tags: ["miniatura"]);
        await ProductAsync("Escudo", tags: ["escudo do mestre"]);
        await ProductAsync("Mapa", tags: ["mapa", "taverna"]);
        await ProductAsync("Grimório", tags: ["grimorio"]);
        await ProductAsync("Baralho", tags: ["baralho"]);
        await ProductAsync("Cartas", tags: ["cartas de tarot"]);

        await PostAsync(Ana, "Comprei dados metálicos lindos!");                                       // conta
        await PostAsync(Bia, "Miniatura incrível, miniatura!");                                        // outra pessoa
        await PostAsync(Ana, "Escudo do mestre novo", change: p => p.DeletedAt = DateTime.UtcNow);       // apagado
        await PostAsync(Ana, "Quero um mapa", change: p => p.HeldAt = DateTime.UtcNow);                  // retido pela moderação
        await PostAsync(Ana, "Taverna sombria", topicChange: t => t.DeletedAt = DateTime.UtcNow);        // tópico removido
        await PostAsync(Ana, "Velho grimorio", DateTime.UtcNow.AddDays(-200));                           // fora da janela
        TableEvent Event(string user, string kind, string content, Action<TableEvent>? change = null)
        {
            var e = new TableEvent { CampaignId = arton.Id, UserId = user, Author = user, Kind = kind, Content = content };
            change?.Invoke(e);
            return e;
        }
        db.Events.AddRange(
            Event(Ana, EventKinds.Message, "Trouxe meu baralho para a mesa"),                            // conta
            Event(Ana, EventKinds.Message, "segredo: cartas de tarot", e => e.MasterOnly = true),         // privado do mestre
            Event(Ana, EventKinds.Message, "cartas de tarot só pra você", e => e.VisibleToUserId = Bia), // direcionado
            Event(Ana, EventKinds.Message, "cartas de tarot", e => e.IsRecipientCopy = true),            // cópia privada
            Event(Ana, EventKinds.Roll, "1d20 miniatura"),                                               // rolagem
            Event(Ana, EventKinds.Sheet, "escudo do mestre"),                                            // alteração de ficha
            Event(Bia, EventKinds.Message, "Grimório e miniatura"));                                    // outra pessoa
        await db.SaveChangesAsync();

        await ConsentAsync(Ana);
        var terms = (await recommendations.PreferencesAsync(Ana, default)).Interests.Terms;
        Assert.Equal(new[] { "baralho", "dado metalico" }.OrderBy(t => t), terms.Where(t => t != "dado").OrderBy(t => t));
        Assert.DoesNotContain("miniatura", terms);
        Assert.DoesNotContain("escudo do mestre", terms);
        Assert.DoesNotContain("mapa", terms);
        Assert.DoesNotContain("taverna", terms);
        Assert.DoesNotContain("grimorio", terms);
        Assert.DoesNotContain("carta de tarot", terms);
        // Nada é derivado para quem não consentiu, e o administrador não tem rota para termos individuais.
        Assert.Empty(await db.StoreInterests.Where(i => i.UserId == Bia).ToListAsync());
        Assert.DoesNotContain("baralho", JsonSerializer.Serialize(await analytics.MetricsAsync(30, default)));
    }

    [Fact]
    public async Task Without_consent_nothing_is_analyzed_and_revoking_deletes_derived_interests()
    {
        await ProductAsync("Miniatura", tags: ["miniatura"]);
        await PostAsync(Ana, "miniatura miniatura", DateTime.UtcNow.AddDays(-2));
        await PostAsync(Ana, "outra miniatura", DateTime.UtcNow.AddDays(-1));
        Assert.Equal(0, await recommendations.RecomputeDueAsync(10, default));
        await recommendations.RecomputeInterestsAsync(Ana, default);
        Assert.Empty(await db.StoreInterests.ToListAsync());
        Assert.False((await recommendations.PreferencesAsync(Ana, default)).AnalyzeMessages);

        await ConsentAsync(Ana);
        var prefs = await recommendations.PreferencesAsync(Ana, default);
        Assert.True(prefs.AnalyzeMessages);
        Assert.NotNull(prefs.MessagesConsentAt);
        Assert.Equal(["miniatura"], prefs.Interests.Terms);

        await recommendations.SavePreferencesAsync(Ana, new StorePreferencesInput(AnalyzeMessages: false), default);
        Assert.Empty(await db.StoreInterests.ToListAsync());
        Assert.Equal(0, await recommendations.RecomputeDueAsync(10, default));
        await recommendations.RecomputeInterestsAsync(Ana, default);
        Assert.Empty(await db.StoreInterests.ToListAsync());
        Assert.Null((await recommendations.PreferencesAsync(Ana, default)).MessagesConsentAt);
    }

    [Fact]
    public async Task Clearing_interests_removes_derived_data_and_ignores_older_content()
    {
        await ProductAsync("Miniatura", tags: ["miniatura"]);
        await ProductAsync("Baralho", tags: ["baralho"]);
        await PostAsync(Ana, "miniatura nova", DateTime.UtcNow.AddMinutes(-10));
        await ConsentAsync(Ana);
        Assert.Single(await db.StoreInterests.ToListAsync());
        await recommendations.ClearInterestsAsync(Ana, default);
        Assert.Empty(await db.StoreInterests.ToListAsync());
        await recommendations.RecomputeInterestsAsync(Ana, default);
        Assert.Empty(await db.StoreInterests.ToListAsync());                 // o conteúdo anterior não volta
        await PostAsync(Ana, "comprei um baralho", DateTime.UtcNow.AddSeconds(1));
        await recommendations.RecomputeInterestsAsync(Ana, default);
        Assert.Equal(["baralho"], (await db.StoreInterests.ToListAsync()).Select(i => i.Term));
    }

    // ---------- Cliques, métricas e integridade ----------
    [Fact]
    public async Task Clicks_are_deduplicated_aggregated_and_never_carry_text()
    {
        var product = await ProductAsync("Dados", [t20], category: Dice);
        await analytics.RecordAsync(Ana, new(product.Id, "showcase"), default);
        await analytics.RecordAsync(Ana, new(product.Id, "showcase"), default);       // duplicado na janela
        await analytics.RecordAsync(Ana, new(product.Id, "store"), default);
        await analytics.RecordAsync(Bia, new(product.Id, "detail"), default);
        Assert.Equal(400, (await Assert.ThrowsAsync<RuleException>(() => analytics.RecordAsync(Ana, new(product.Id, "email"), default))).Status);
        Assert.Equal(3, (await catalog.AdminProductAsync(product.Id, default)).Clicks);
        var metrics = Json(await analytics.MetricsAsync(30, default));
        Assert.Equal(3, metrics.GetProperty("clicks").GetProperty("total").GetInt32());
        Assert.Equal(1, metrics.GetProperty("clicks").GetProperty("showcase").GetInt32());
        Assert.False(metrics.GetProperty("impressionsTracked").GetBoolean());
        Assert.Equal(3, metrics.GetProperty("bySystem")[0].GetProperty("clicks").GetInt32());
        Assert.Equal("Dados e acessórios", metrics.GetProperty("byCategory")[0].GetProperty("name").GetString());
        Assert.DoesNotContain(Ana, metrics.GetRawText());
    }

    [Fact]
    public async Task Categories_and_systems_in_use_cannot_be_orphaned()
    {
        var product = await ProductAsync("Dados", [coc], category: Dice);
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.DeleteCategoryAsync(Dice, Admin, default))).Status);
        var systems = new RpgSystemService(db, new AuditService(db));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => systems.DeleteAsync(coc, Admin, default))).Status);
        var created = await catalog.SaveCategoryAsync(null, new("Pôsteres", "poster, arte"), Admin, default);
        Assert.Equal(("posteres", "poster, arte"), (created.Slug, created.Keywords));
        Assert.Equal(409, (await Assert.ThrowsAsync<RuleException>(() => catalog.SaveCategoryAsync(null, new("posteres"), Admin, default))).Status);
        await catalog.DeleteCategoryAsync(created.Id, Admin, default);
        Assert.Equal(12, (await catalog.CategoriesAsync(default)).Count);     // taxonomia inicial semeada
        Assert.NotNull(product);
    }

    // ---------- Pré-visualização de links ----------
    [Fact]
    public async Task Amazon_preview_never_reads_the_page_and_keeps_the_form_manual()
    {
        var preview = await affiliates.PreviewAsync(new("https://www.amazon.com.br/Tormenta20/dp/8583650826?tag=eternnus-20&ref=x"), default);
        Assert.Equal(0, reader.Calls);
        Assert.Equal(("amazon", "8583650826", false), (preview.Marketplace, preview.ExternalId, preview.Fetched));
        Assert.Null(preview.Title);
        Assert.Null(preview.PriceCents);
        Assert.Contains("tag=eternnus-20", preview.TargetUrl);
        Assert.NotEmpty(preview.Notes);
    }

    [Fact]
    public async Task Mercado_livre_preview_reads_public_metadata_without_inventing_data()
    {
        reader.Page = start => (new Uri("https://produto.mercadolivre.com.br/MLB-123456789-tormenta20"), """
            <html><head><title>Ignorado</title>
            <meta property="og:title" content="OG título">
            <link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-123456789-tormenta20">
            <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tormenta20 &amp; Livro Básico",
              "description":"<b>Livro</b> de regras","image":["https://http2.mlstatic.com/D_NQ_1.jpg"],"brand":{"@type":"Brand","name":"Jambô"},
              "offers":{"@type":"Offer","price":"199.90","priceCurrency":"BRL","availability":"https://schema.org/InStock"}}</script>
            </head></html>
            """);
        var preview = await affiliates.PreviewAsync(new("https://meli.la/abc123"), default);
        Assert.Equal(1, reader.Calls);
        Assert.True(preview.Fetched);
        Assert.Equal(("mercadolivre", "MLB123456789"), (preview.Marketplace, preview.ExternalId));
        Assert.Equal("Tormenta20 & Livro Básico", preview.Title);
        Assert.Equal("Livro de regras", preview.Description);
        Assert.Equal("https://http2.mlstatic.com/D_NQ_1.jpg", preview.ImageUrl);
        Assert.Equal(("Jambô", 19990, "BRL", StoreAvailability.InStock), (preview.Brand, preview.PriceCents, preview.Currency, preview.Availability));
        Assert.Null(preview.PreviousPriceCents);
        Assert.Equal("https://meli.la/abc123", preview.TargetUrl);           // o link afiliado continua sendo o destino
        Assert.Equal("https://produto.mercadolivre.com.br/MLB-123456789-tormenta20", preview.CanonicalUrl);

        // Imagem fora do CDN da loja é descartada; página bloqueada mantém o formulário manual.
        reader.Page = start => (start, """<meta property="og:title" content="X"><meta property="og:image" content="https://evil.example/x.jpg">""");
        var foreign = await affiliates.PreviewAsync(new("https://produto.mercadolivre.com.br/MLB-1234567-x"), default);
        Assert.Null(foreign.ImageUrl);
        Assert.Contains(foreign.Notes, n => n.Contains("imagem", StringComparison.OrdinalIgnoreCase));
        reader.Page = null;
        var blocked = await affiliates.PreviewAsync(new("https://shopee.com.br/x-i.1.2"), default);
        Assert.False(blocked.Fetched);
        Assert.Equal("1.2", blocked.ExternalId);

        var existing = await ProductAsync("Já cadastrado", market: "mercadolivre");
        reader.Page = start => (start, "<html></html>");
        var duplicate = await affiliates.PreviewAsync(new(existing.AffiliateUrl), default);
        Assert.Equal(existing.Id, duplicate.DuplicateOf?.Id);
    }

    [Fact]
    public async Task Link_reader_follows_only_redirects_inside_the_same_marketplace()
    {
        var calls = new List<Uri>();
        var outside = new StoreLinkReader(null, new Stub(r =>
        {
            calls.Add(r.RequestUri!);
            var response = new HttpResponseMessage(HttpStatusCode.Found);
            response.Headers.Location = new Uri(r.RequestUri!.Host == "meli.la" ? "https://evil.example/phish" : "https://meli.la/x");
            return response;
        }));
        Assert.Equal("redirect-not-allowed", (await Assert.ThrowsAsync<StoreLinkException>(() => outside.ReadAsync(new Uri("https://meli.la/x"), "mercadolivre", default))).Reason);
        Assert.Single(calls);
        var inside = new StoreLinkReader(null, new Stub(r => r.RequestUri!.Host == "meli.la"
            ? new HttpResponseMessage(HttpStatusCode.MovedPermanently) { Headers = { Location = new Uri("https://produto.mercadolivre.com.br/MLB-1") } }
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<title>ok</title>", System.Text.Encoding.UTF8, "text/html") }));
        var (final, html) = await inside.ReadAsync(new Uri("https://meli.la/x"), "mercadolivre", default);
        Assert.Equal("produto.mercadolivre.com.br", final.Host);
        Assert.Contains("ok", html);
        var forbidden = new StoreLinkReader(null, new Stub(_ => new HttpResponseMessage(HttpStatusCode.Forbidden)));
        Assert.Equal("status-403", (await Assert.ThrowsAsync<StoreLinkException>(() => forbidden.ReadAsync(new Uri("https://meli.la/x"), "mercadolivre", default))).Reason);
    }
    sealed class Stub(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(respond(request));
    }

    // ---------- Palavras-chave ----------
    [Theory]
    [InlineData("dragoes", "dragao")] [InlineData("dragao", "dragao")] [InlineData("metalicos", "metalico")] [InlineData("miniaturas", "miniatura")]
    [InlineData("itens", "item")] [InlineData("flores", "flore")] [InlineData("flor", "flore")] [InlineData("jornais", "jornal")] [InlineData("d20", "d20")]
    public void Stem_reduces_simple_plurals(string word, string stem) => Assert.Equal(stem, StoreKeywords.Stem(word));

    [Fact]
    public void Vocabulary_keeps_useful_catalog_terms_and_drops_generic_or_sensitive_ones()
    {
        var vocabulary = StoreVocabulary.Build(["Dados metálicos", "escudo do mestre", "mesa", "personagem", "religião", "dragão", "do"], "d20, dado, dados");
        Assert.True(vocabulary.Contains("dado metalico"));
        Assert.True(vocabulary.Contains("escudo do mestre"));
        Assert.True(vocabulary.Contains("dragao"));
        Assert.True(vocabulary.Contains("d20"));
        Assert.False(vocabulary.Contains("mesa"));
        Assert.False(vocabulary.Contains("personagem"));
        Assert.False(vocabulary.Contains("religiao"));
        Assert.False(vocabulary.Contains("do"));
        Assert.Equal(new[] { "d20", "dado metalico", "dragao", "escudo do mestre" }, vocabulary.TermsIn("Meu ESCUDO DO MESTRE, os Dados Metálicos e os DRAGÕES! Também uns dados.").OrderBy(t => t));
    }

    [Fact]
    public void Repetition_inside_one_message_counts_once_and_recurrence_wins()
    {
        var vocabulary = StoreVocabulary.Build(["miniatura", "baralho"], null);
        var now = DateTime.UtcNow;
        var interests = vocabulary.Interests([
            ("baralho baralho baralho baralho baralho baralho", now),
            ("uma miniatura", now.AddDays(-1)),
            ("outra miniatura", now.AddDays(-2)),
        ], now).ToDictionary(i => i.Term, i => i.Weight);
        Assert.Equal(1, interests["miniatura"]);
        Assert.True(interests["baralho"] < 0.5);
    }

    [Fact]
    public void Metadata_parser_reads_open_graph_and_prices_without_guessing()
    {
        var og = StoreMetadataParser.Parse("""<meta content="Livro &quot;Raro&quot;" property="og:title"><meta name="description" content="Desc"><meta property="product:price:amount" content="1.299,90"><meta property="product:price:currency" content="BRL">""");
        Assert.Equal(("Livro \"Raro\"", "Desc", 129990, "BRL"), (og.Title, og.Description, og.PriceCents, og.Currency));
        var noCurrency = StoreMetadataParser.Parse("""<meta property="og:title" content="X"><meta property="product:price:amount" content="10">""");
        Assert.Null(noCurrency.PriceCents);                                  // sem moeda não há preço
        Assert.Null(StoreMetadataParser.Parse("<script type=\"application/ld+json\">{broken</script>").Title);
        Assert.Equal(1990, StoreMetadataParser.Cents("19.90"));
        Assert.Null(StoreMetadataParser.Cents("grátis"));
    }
}
