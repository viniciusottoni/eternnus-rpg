using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

// ---------- Loja do Aventureiro: afiliados e recomendações (ADR-104, docs/LOJA_AFILIADOS.md) ----------

/// <summary>Lojas de origem aceitas. Hosts de link e de imagem são listas fechadas; subdomínios dos hosts listados valem.</summary>
public static class StoreMarketplaces
{
    public const string Amazon = "amazon", Shopee = "shopee", MercadoLivre = "mercadolivre";
    public static readonly string[] All = [Amazon, Shopee, MercadoLivre];
    public static string Name(string? key) => key switch { Amazon => "Amazon", Shopee => "Shopee", MercadoLivre => "Mercado Livre", _ => "Loja" };

    static readonly Dictionary<string, string[]> LinkHosts = new()
    {
        [Amazon] = ["amazon.com.br", "amazon.com", "amzn.to", "amzn.com", "a.co"],
        [Shopee] = ["shopee.com.br", "shp.ee"],
        [MercadoLivre] = ["mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com", "meli.la"],
    };
    static readonly Dictionary<string, string[]> ImageHosts = new()
    {
        [Amazon] = ["media-amazon.com", "ssl-images-amazon.com", "images-amazon.com"],
        [Shopee] = ["susercontent.com", "shopee.com.br"],
        [MercadoLivre] = ["mlstatic.com"],
    };

    static bool Under(string host, string domain) => host == domain || host.EndsWith("." + domain, StringComparison.Ordinal);
    static string Host(Uri uri) => uri.IdnHost.TrimEnd('.').ToLowerInvariant();

    /// <summary>Loja do link (pelo host) ou nulo.</summary>
    public static string? FromLink(Uri uri) => LinkHosts.FirstOrDefault(p => p.Value.Any(d => Under(Host(uri), d))).Key;
    /// <summary>Imagem servida por um CDN de qualquer loja aceita.</summary>
    public static bool IsImageHost(Uri uri) => ImageHosts.Values.Any(list => list.Any(d => Under(Host(uri), d)));
}

public static class StoreProductStatuses
{
    public const string Draft = "draft", Active = "active", Paused = "paused", Archived = "archived";
    public static readonly string[] All = [Draft, Active, Paused, Archived];
}

public static class StoreAvailability
{
    public const string Unknown = "unknown", InStock = "in_stock", OutOfStock = "out_of_stock";
    public static readonly string[] All = [Unknown, InStock, OutOfStock];
}

public static class StoreSurfaces
{
    public const string Showcase = "showcase", Store = "store", Detail = "detail";
    public static readonly string[] All = [Showcase, Store, Detail];
}

/// <summary>Filas do Round Robin inteligente da vitrine (ADR-108). A ordem dos índices é a dos vetores de proporção e de
/// exibições servidas. <see cref="Ranked"/> marca exibições do ranking clássico (rotação inteligente desligada).</summary>
public static class StoreStrategies
{
    public const string Popular = "popular", New = "new", Related = "related", Explore = "explore", Ranked = "ranked";
    public const int PopularIndex = 0, NewIndex = 1, RelatedIndex = 2, ExploreIndex = 3, Count = 4;
    public static readonly string[] Rotating = [Popular, New, Related, Explore];
    public static readonly string[] All = [Popular, New, Related, Explore, Ranked];
    public static string Key(int index) => Rotating[index];
    public static int Index(string key) => Array.IndexOf(Rotating, key);
}

/// <summary>Páginas onde a vitrine pode aparecer (o administrador escolhe um subconjunto). Mesa, editores, sessão, ficha,
/// admin, conta, login e cadastro nunca constam desta lista.</summary>
public static class StorePages
{
    public static readonly (string Key, string Label)[] Options =
    [
        ("home", "Início"), ("campaigns", "Minhas campanhas"), ("campaign", "Campanha (visão geral, diário e grupo)"),
        ("guild", "Guilda"), ("characters", "Personagens"), ("library", "Biblioteca"), ("progress", "Conquistas"),
    ];
    public static readonly string[] Defaults = ["home", "campaigns", "campaign", "guild", "characters", "library"];
    public static bool IsValid(string? key) => Options.Any(o => o.Key == key);
}

public class StoreProduct
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(20)] public string Marketplace { get; set; } = "";
    /// <summary>Link de afiliado como o administrador informou (preservado, com parâmetros de indicação).</summary>
    [MaxLength(2000)] public string AffiliateUrl { get; set; } = "";
    /// <summary>Destino aberto pelo usuário: o mesmo link, validado (https, host da loja) e normalizado sem perder parâmetros.</summary>
    [MaxLength(2000)] public string TargetUrl { get; set; } = "";
    [MaxLength(2000)] public string? CanonicalUrl { get; set; }
    [MaxLength(100)] public string? ExternalId { get; set; }
    [MaxLength(200)] public string Title { get; set; } = "";
    [MaxLength(4000)] public string Description { get; set; } = "";
    /// <summary>Imagem https em CDN de uma das lojas aceitas.</summary>
    [MaxLength(1000)] public string? ImageUrl { get; set; }
    [MaxLength(120)] public string Brand { get; set; } = "";
    public Guid? CategoryId { get; set; }
    /// <summary>Preço em centavos; nulo = desconhecido.</summary>
    public int? PriceCents { get; set; }
    public int? PreviousPriceCents { get; set; }
    [MaxLength(3)] public string Currency { get; set; } = "BRL";
    /// <summary>Quando o preço foi conferido (confirmação explícita do administrador ou integração autorizada).</summary>
    public DateTime? PriceCheckedAt { get; set; }
    [MaxLength(20)] public string Availability { get; set; } = StoreAvailability.Unknown;
    [MaxLength(20)] public string Status { get; set; } = StoreProductStatuses.Draft;
    /// <summary>Prioridade administrativa secundária (0–100): só desempata dentro do mesmo grupo de relevância.</summary>
    public int Priority { get; set; }
    /// <summary>Cliques aceitos (deduplicados); popularidade interna.</summary>
    public int Clicks { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Primeira ativação (ADR-108): base da novidade. Edições e pausas não a reiniciam.</summary>
    public DateTime? PublishedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public int Revision { get; set; } = 1;
    public List<StoreProductSystem> Systems { get; set; } = [];
    public List<StoreProductTag> Tags { get; set; } = [];
}

/// <summary>Produto ↔ sistema de RPG. Produto sem vínculos é genérico.</summary>
public class StoreProductSystem
{
    public Guid ProductId { get; set; }
    public Guid RpgSystemId { get; set; }
}

public class StoreProductTag
{
    public Guid ProductId { get; set; }
    /// <summary>Minúsculas, até 40 caracteres.</summary>
    [MaxLength(40)] public string Value { get; set; } = "";
}

public class StoreCategory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(60)] public string Slug { get; set; } = "";
    /// <summary>Palavras-chave separadas por vírgula (vocabulário de interesses e busca).</summary>
    [MaxLength(500)] public string Keywords { get; set; } = "";
    public int Order { get; set; }
    public DateTime? ArchivedAt { get; set; }
}

/// <summary>Configuração global (linha única, <see cref="SingletonId"/>).</summary>
public class StoreSettings
{
    public const int SingletonId = 1;
    public int Id { get; set; } = SingletonId;
    public bool Enabled { get; set; } = true;
    public int ShowcaseWide { get; set; } = 3;
    public int ShowcaseMedium { get; set; } = 2;
    public int ShowcaseNarrow { get; set; } = 1;
    /// <summary>Chaves de <see cref="StorePages"/> separadas por vírgula.</summary>
    [MaxLength(300)] public string Pages { get; set; } = string.Join(',', StorePages.Defaults);
    public int MaxPerMarketplace { get; set; } = 2;
    public bool CategoryDiversity { get; set; } = true;
    public int RotationHours { get; set; } = 6;
    /// <summary>Validade do preço conferido; depois dela o público vê "Consultar preço na loja".</summary>
    public int PriceStaleHours { get; set; } = 24;
    /// <summary>Intervalo para atualizar metadados quando houver integração autorizada.</summary>
    public int MetadataRefreshHours { get; set; } = 24;
    /// <summary>A vitrine só mostra produtos com imagem.</summary>
    public bool RequireImage { get; set; } = true;
    /// <summary>Um grupo de sinônimos por linha, termos separados por vírgula.</summary>
    [MaxLength(8000)] public string Synonyms { get; set; } = "dado, dados, d20, poliedrico\nminiatura, miniaturas, mini, figura\nescudo do mestre, escudo do narrador";

    // ---------- Round Robin inteligente (ADR-108) ----------
    /// <summary>Vitrine por filas (populares, novidades, descoberta, exploração). Desligado: ranking clássico com rotação por janela.</summary>
    public bool SmartRotation { get; set; } = true;
    /// <summary>Cada exibição confirmada avança o ciclo. Desligado: o ciclo só avança uma vez por <see cref="RotationHours"/>.</summary>
    public bool RotateOnNavigation { get; set; } = true;
    /// <summary>Um produto exibido não volta nas próximas N navegações exibidas, se houver alternativa.</summary>
    public int RepeatWindow { get; set; } = 10;
    /// <summary>Metas cumulativas por fila (somam 100; exploração nunca é zero).</summary>
    public int SharePopular { get; set; } = 40;
    public int ShareNew { get; set; } = 30;
    public int ShareRelated { get; set; } = 20;
    public int ShareExplore { get; set; } = 10;
    /// <summary>Exibições sem clique a partir das quais o resfriamento do produto dobra para o usuário (0 = desligado).</summary>
    public int FatigueImpressions { get; set; } = 6;
    /// <summary>Cliques do próprio usuário ensinam sistemas e categorias (o usuário também pode desligar).</summary>
    public bool LearnFromClicks { get; set; } = true;
    /// <summary>Descoberta e exploração percorrem o catálogo do menos exibido para o mais exibido.</summary>
    public bool CatalogCoverage { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int Revision { get; set; } = 1;

    public int[] Shares() => [SharePopular, ShareNew, ShareRelated, ShareExplore];
}

/// <summary>Clique registrado por POST explícito. Nunca guarda texto de conversa.</summary>
public class StoreInteraction
{
    public long Id { get; set; }
    public Guid ProductId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    [MaxLength(20)] public string Surface { get; set; } = StoreSurfaces.Store;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class StoreUserPreferences
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    public bool ShowShowcase { get; set; } = true;
    public bool UseCampaignSystems { get; set; } = true;
    /// <summary>Consentimento específico para analisar as próprias mensagens (opt-in).</summary>
    public bool AnalyzeMessages { get; set; }
    public DateTime? MessagesConsentAt { get; set; }
    public Guid? InterestSystemId { get; set; }
    /// <summary>Último pedido de exclusão: conteúdo anterior nunca volta a ser analisado.</summary>
    public DateTime? InterestsResetAt { get; set; }
    public DateTime? InterestsComputedAt { get; set; }
    /// <summary>Usar os próprios cliques para aprender sistemas e categorias (ADR-108). Desligar não apaga os cliques (métricas).</summary>
    public bool LearnFromClicks { get; set; } = true;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Exibição confirmada de um produto na vitrine (cartão ≥ 50% visível por ~1 s). Uma linha por usuário, ciclo e
/// produto: repetições do mesmo evento (outra aba, nova tentativa) não contam de novo. <see cref="ClickedAt"/> atribui o
/// clique da vitrine à exibição (CTR).</summary>
public class StoreExposure
{
    public long Id { get; set; }
    public Guid ProductId { get; set; }
    [MaxLength(450)] public string UserId { get; set; } = "";
    public long Cycle { get; set; }
    [MaxLength(12)] public string Strategy { get; set; } = StoreStrategies.Popular;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClickedAt { get; set; }
}

/// <summary>Resumo por usuário e produto para a seleção sem varrer exposições: quantas vezes, em que ciclo e quando foi visto.</summary>
public class StoreUserProductStat
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    public Guid ProductId { get; set; }
    public int Exposures { get; set; }
    public long LastCycle { get; set; }
    public DateTime FirstExposedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastExposedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Progresso do ciclo da vitrine por usuário (persistido: sobrevive a reinícios e vale entre instâncias). O ciclo
/// só avança por exibição confirmada; as contagens servidas por fila guiam as metas cumulativas.</summary>
public class StoreRotationState
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    public long Cycle { get; set; }
    public long ServedPopular { get; set; }
    public long ServedNew { get; set; }
    public long ServedRelated { get; set; }
    public long ServedExplore { get; set; }
    public DateTime AdvancedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public long[] Served() => [ServedPopular, ServedNew, ServedRelated, ServedExplore];
    public void Count(int strategy)
    {
        switch (strategy)
        {
            case StoreStrategies.PopularIndex: ServedPopular++; break;
            case StoreStrategies.NewIndex: ServedNew++; break;
            case StoreStrategies.RelatedIndex: ServedRelated++; break;
            case StoreStrategies.ExploreIndex: ServedExplore++; break;
        }
    }
}

/// <summary>Interesse inferido (termo do vocabulário do catálogo e peso 0–1). Só existe com consentimento.</summary>
public class StoreUserInterest
{
    [MaxLength(450)] public string UserId { get; set; } = "";
    [MaxLength(60)] public string Term { get; set; } = "";
    public double Weight { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class StoreModel
{
    public const int MaxTags = 20, MaxSystems = 20, MaxInterests = 40;

    /// <summary>Taxonomia inicial (administrável). Nenhum produto é semeado.</summary>
    public static readonly StoreCategory[] SeedCategories =
    [
        Seed(1, "Livros básicos de RPG", "livros-basicos", "livro basico, livro do jogador, regras, manual", 1),
        Seed(2, "Suplementos e expansões", "suplementos", "suplemento, expansao, bestiario, guia", 2),
        Seed(3, "Aventuras e campanhas prontas", "aventuras", "aventura, campanha pronta, modulo, cenario", 3),
        Seed(4, "Dados e acessórios", "dados", "dado, dados, d20, dados metalicos, rolagem", 4),
        Seed(5, "Miniaturas", "miniaturas", "miniatura, miniaturas, figura, pintura", 5),
        Seed(6, "Escudos do mestre", "escudos", "escudo do mestre, escudo do narrador", 6),
        Seed(7, "Mapas e cenários físicos", "mapas", "mapa, grid, battlemap, cenario fisico, terreno", 7),
        Seed(8, "Organizadores e acessórios de mesa", "organizadores", "organizador, bandeja de dados, torre de dados, caixa", 8),
        Seed(9, "Cartas e baralhos", "cartas", "carta, cartas, baralho, deck", 9),
        Seed(10, "Materiais para mestres", "mestres", "mestre, narrador, gerador, tabelas", 10),
        Seed(11, "Produtos colecionáveis", "colecionaveis", "colecionavel, edicao especial, estatueta", 11),
        Seed(12, "Outros", "outros", "", 99),
    ];
    static StoreCategory Seed(int n, string name, string slug, string keywords, int order) =>
        new() { Id = Guid.Parse($"00000000-0000-4000-8000-0000000003{n:00}"), Name = name, Slug = slug, Keywords = keywords, Order = order };

    public static void Configure(ModelBuilder b)
    {
        b.Entity<StoreProduct>().ToTable("StoreProducts");
        b.Entity<StoreProduct>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<StoreProduct>().HasIndex(x => new { x.Status, x.DeletedAt, x.UpdatedAt });
        b.Entity<StoreProduct>().HasIndex(x => new { x.Marketplace, x.Status });
        b.Entity<StoreProduct>().HasIndex(x => x.CategoryId);
        b.Entity<StoreProduct>().HasIndex(x => x.PriceCents);
        b.Entity<StoreProduct>().HasIndex(x => new { x.Marketplace, x.ExternalId });
        b.Entity<StoreProduct>().HasOne<StoreCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<StoreProduct>().HasMany(x => x.Systems).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StoreProduct>().HasMany(x => x.Tags).WithOne().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<StoreProductSystem>().ToTable("StoreProductSystems");
        b.Entity<StoreProductSystem>().HasKey(x => new { x.ProductId, x.RpgSystemId });
        b.Entity<StoreProductSystem>().HasIndex(x => x.RpgSystemId);
        b.Entity<StoreProductSystem>().HasOne<RpgSystem>().WithMany().HasForeignKey(x => x.RpgSystemId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<StoreProductTag>().ToTable("StoreProductTags");
        b.Entity<StoreProductTag>().HasKey(x => new { x.ProductId, x.Value });
        b.Entity<StoreProductTag>().HasIndex(x => x.Value);

        b.Entity<StoreCategory>().ToTable("StoreCategories");
        b.Entity<StoreCategory>().HasIndex(x => x.Slug).IsUnique();
        b.Entity<StoreCategory>().HasIndex(x => x.Name).IsUnique();
        b.Entity<StoreCategory>().HasData(SeedCategories);

        b.Entity<StoreSettings>().ToTable("StoreSettings");
        b.Entity<StoreSettings>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<StoreSettings>().Property(x => x.Revision).IsConcurrencyToken();

        b.Entity<StoreInteraction>().ToTable("StoreInteractions");
        b.Entity<StoreInteraction>().HasIndex(x => x.CreatedAt);
        b.Entity<StoreInteraction>().HasIndex(x => new { x.UserId, x.ProductId, x.CreatedAt });
        b.Entity<StoreInteraction>().HasIndex(x => new { x.ProductId, x.CreatedAt });
        b.Entity<StoreInteraction>().HasOne<StoreProduct>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StoreInteraction>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<StoreUserPreferences>().ToTable("StoreUserPreferences");
        b.Entity<StoreUserPreferences>().HasKey(x => x.UserId);
        b.Entity<StoreUserPreferences>().HasIndex(x => new { x.AnalyzeMessages, x.InterestsComputedAt });
        b.Entity<StoreUserPreferences>().HasOne<AppUser>().WithOne().HasForeignKey<StoreUserPreferences>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StoreUserPreferences>().HasOne<RpgSystem>().WithMany().HasForeignKey(x => x.InterestSystemId).OnDelete(DeleteBehavior.SetNull);

        b.Entity<StoreUserInterest>().ToTable("StoreUserInterests");
        b.Entity<StoreUserInterest>().HasKey(x => new { x.UserId, x.Term });
        b.Entity<StoreUserInterest>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<StoreExposure>().ToTable("StoreExposures");
        b.Entity<StoreExposure>().HasIndex(x => new { x.UserId, x.Cycle, x.ProductId }).IsUnique();
        b.Entity<StoreExposure>().HasIndex(x => new { x.UserId, x.ProductId, x.CreatedAt });
        b.Entity<StoreExposure>().HasIndex(x => new { x.ProductId, x.CreatedAt });
        b.Entity<StoreExposure>().HasIndex(x => x.CreatedAt);
        b.Entity<StoreExposure>().HasOne<StoreProduct>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StoreExposure>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<StoreUserProductStat>().ToTable("StoreUserProductStats");
        b.Entity<StoreUserProductStat>().HasKey(x => new { x.UserId, x.ProductId });
        b.Entity<StoreUserProductStat>().HasIndex(x => x.LastExposedAt);
        b.Entity<StoreUserProductStat>().HasOne<StoreProduct>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<StoreUserProductStat>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<StoreRotationState>().ToTable("StoreRotationStates");
        b.Entity<StoreRotationState>().HasKey(x => x.UserId);
        b.Entity<StoreRotationState>().HasOne<AppUser>().WithOne().HasForeignKey<StoreRotationState>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
