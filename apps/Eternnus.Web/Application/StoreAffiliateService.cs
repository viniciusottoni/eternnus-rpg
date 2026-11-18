using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StorePreviewInput(string? Url);
public record StorePreviewDto(string Marketplace, string MarketplaceName, string AffiliateUrl, string TargetUrl, string? ExternalId, string? CanonicalUrl,
    string? Title, string? Description, string? ImageUrl, string? Brand, int? PriceCents, int? PreviousPriceCents, string? Currency, string? Availability,
    bool Fetched, string[] Notes, StoreRef? DuplicateOf);

/// <summary>Validação de links de afiliado e de imagens, e identificação de loja/produto pelo endereço (regras puras).</summary>
public static partial class StoreAffiliateLinks
{
    public const int MaxUrl = 2000, MaxImageUrl = 1000;
    const string Invalid = "Informe um link https de afiliado da Amazon, Shopee ou Mercado Livre (sem usuário, senha ou porta).";

    /// <summary>Link aceito: https, porta padrão, sem credenciais nem caracteres de controle, host público de uma loja permitida.</summary>
    public static (Uri Uri, string Marketplace) Validate(string? input)
    {
        var text = (input ?? "").Trim();
        if (text.Length is 0 or > MaxUrl || text.Any(char.IsControl) || text.Contains(' ')) throw new RuleException(400, Invalid);
        Uri uri;
        try { uri = RemoteImageFetcher.Validate(text); } catch (RuleException) { throw new RuleException(400, Invalid); }
        var marketplace = StoreMarketplaces.FromLink(uri) ?? throw new RuleException(400, "Este link não é da Amazon, da Shopee nem do Mercado Livre. Use o link de afiliado gerado no programa da loja.");
        return (uri, marketplace);
    }

    /// <summary>Redirecionamento seguido na leitura: precisa continuar https, num host público da mesma loja.</summary>
    public static Uri ValidateHop(Uri next, string marketplace)
    {
        var (uri, found) = Validate(next.AbsoluteUri);
        return found == marketplace ? uri : throw new RuleException(400, "O link redireciona para fora da loja.");
    }

    /// <summary>Imagem aceita: https, porta padrão, sem credenciais, servida pelo CDN de uma das lojas.</summary>
    public static string? ValidateImage(string? input)
    {
        var text = (input ?? "").Trim();
        if (text.Length == 0) return null;
        const string message = "Use uma imagem https do próprio site da loja (Amazon, Shopee ou Mercado Livre).";
        if (text.Length > MaxImageUrl || text.Any(char.IsControl) || text.Contains(' ')) throw new RuleException(400, message);
        Uri uri;
        try { uri = RemoteImageFetcher.Validate(text); } catch (RuleException) { throw new RuleException(400, message); }
        if (!StoreMarketplaces.IsImageHost(uri)) throw new RuleException(400, message);
        return uri.AbsoluteUri;
    }

    /// <summary>Identificador do produto no endereço: ASIN (Amazon), MLB… (Mercado Livre) ou loja.item (Shopee).</summary>
    public static string? ExternalId(Uri uri, string marketplace)
    {
        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        return marketplace switch
        {
            StoreMarketplaces.Amazon => AmazonId().Match(path) is { Success: true } m ? m.Groups[1].Value.ToUpperInvariant() : null,
            StoreMarketplaces.MercadoLivre => MeliId().Match(path + " " + uri.Query) is { Success: true } m ? ("MLB" + m.Groups[1].Value) : null,
            StoreMarketplaces.Shopee => ShopeeId().Match(path) is { Success: true } m ? $"{m.Groups[1].Value}.{m.Groups[2].Value}"
                : ShopeeProduct().Match(path) is { Success: true } p ? $"{p.Groups[1].Value}.{p.Groups[2].Value}" : null,
            _ => null,
        };
    }

    [GeneratedRegex(@"/(?:dp|gp/product|gp/aw/d|exec/obidos/asin|o/asin)/([A-Z0-9]{10})(?:[/?]|$)", RegexOptions.IgnoreCase)] private static partial Regex AmazonId();
    [GeneratedRegex(@"MLB-?(\d{6,12})", RegexOptions.IgnoreCase)] private static partial Regex MeliId();
    [GeneratedRegex(@"-i\.(\d{1,15})\.(\d{1,15})")] private static partial Regex ShopeeId();
    [GeneratedRegex(@"/product/(\d{1,15})/(\d{1,15})")] private static partial Regex ShopeeProduct();
}

/// <summary>Metadados públicos de prévia (Open Graph e JSON-LD Product). Valores são texto puro; nada é inventado.</summary>
public static partial class StoreMetadataParser
{
    public sealed record Result(string? Title, string? Description, string? Image, string? Brand, string? Sku, int? PriceCents, string? Currency, string? Availability, string? Canonical);

    public static Result Parse(string html)
    {
        var meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match tag in MetaTag().Matches(html))
        {
            var attrs = Attributes(tag.Value);
            var key = attrs.GetValueOrDefault("property") ?? attrs.GetValueOrDefault("name") ?? attrs.GetValueOrDefault("itemprop");
            if (key != null && attrs.TryGetValue("content", out var content) && Clean(content) is { } value) meta.TryAdd(key.Trim(), value);
        }
        string? title = null, description = null, image = null, brand = null, sku = null, currency = null, availability = null;
        int? price = null;
        foreach (Match script in JsonLd().Matches(html))
        {
            try
            {
                using var doc = JsonDocument.Parse(script.Groups[1].Value, new JsonDocumentOptions { AllowTrailingCommas = true, MaxDepth = 32 });
                if (FindProduct(doc.RootElement) is not { } product) continue;
                title ??= Str(product, "name");
                description ??= Str(product, "description");
                image ??= ImageOf(product);
                brand ??= product.TryGetProperty("brand", out var b) ? (b.ValueKind == JsonValueKind.String ? Clean(b.GetString()) : Str(b, "name")) : null;
                sku ??= Str(product, "sku") ?? Str(product, "productID");
                if (product.TryGetProperty("offers", out var offers))
                {
                    var offer = offers.ValueKind == JsonValueKind.Array ? offers.EnumerateArray().FirstOrDefault() : offers;
                    if (offer.ValueKind == JsonValueKind.Object)
                    {
                        price ??= Cents(Str(offer, "price") ?? Str(offer, "lowPrice"));
                        currency ??= Str(offer, "priceCurrency");
                        availability ??= Availability(Str(offer, "availability"));
                    }
                }
            }
            catch (JsonException) { }
        }
        title ??= meta.GetValueOrDefault("og:title") ?? meta.GetValueOrDefault("twitter:title") ?? (TitleTag().Match(html) is { Success: true } t ? Clean(t.Groups[1].Value) : null);
        description ??= meta.GetValueOrDefault("og:description") ?? meta.GetValueOrDefault("description");
        image ??= meta.GetValueOrDefault("og:image") ?? meta.GetValueOrDefault("og:image:secure_url") ?? meta.GetValueOrDefault("twitter:image");
        price ??= Cents(meta.GetValueOrDefault("product:price:amount") ?? meta.GetValueOrDefault("og:price:amount") ?? meta.GetValueOrDefault("price"));
        currency ??= meta.GetValueOrDefault("product:price:currency") ?? meta.GetValueOrDefault("og:price:currency") ?? meta.GetValueOrDefault("priceCurrency");
        availability ??= Availability(meta.GetValueOrDefault("product:availability") ?? meta.GetValueOrDefault("og:availability"));
        var canonical = CanonicalTag().Match(html) is { Success: true } c ? Attributes(c.Value).GetValueOrDefault("href") : meta.GetValueOrDefault("og:url");
        currency = currency?.Trim().ToUpperInvariant() is "BRL" or "USD" ? currency.Trim().ToUpperInvariant() : null;
        if (currency == null) price = null;
        return new(Clip(title, 200), Clip(description, 4000), image?.Trim(), Clip(brand, 120), Clip(sku, 100), price, currency, availability, canonical?.Trim());
    }

    static JsonElement? FindProduct(JsonElement e, int depth = 0)
    {
        if (depth > 6) return null;
        if (e.ValueKind == JsonValueKind.Array) { foreach (var item in e.EnumerateArray()) if (FindProduct(item, depth + 1) is { } p) return p; return null; }
        if (e.ValueKind != JsonValueKind.Object) return null;
        if (e.TryGetProperty("@type", out var type) && (type.ValueKind == JsonValueKind.String ? type.GetString() == "Product" : type.ValueKind == JsonValueKind.Array && type.EnumerateArray().Any(t => t.ValueKind == JsonValueKind.String && t.GetString() == "Product"))) return e;
        if (e.TryGetProperty("@graph", out var graph)) return FindProduct(graph, depth + 1);
        return null;
    }
    static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
        ? v.ValueKind switch { JsonValueKind.String => Clean(v.GetString()), JsonValueKind.Number => v.GetRawText(), _ => null } : null;
    static string? ImageOf(JsonElement product)
    {
        if (!product.TryGetProperty("image", out var image)) return null;
        if (image.ValueKind == JsonValueKind.String) return image.GetString();
        if (image.ValueKind == JsonValueKind.Array) { var first = image.EnumerateArray().FirstOrDefault(); return first.ValueKind == JsonValueKind.String ? first.GetString() : Str(first, "url"); }
        return Str(image, "url");
    }
    static string? Availability(string? value)
    {
        var v = (value ?? "").ToLowerInvariant();
        if (v.Contains("outofstock") || v.Contains("out of stock") || v.Contains("soldout") || v == "oos") return StoreAvailability.OutOfStock;
        if (v.Contains("instock") || v.Contains("in stock") || v == "instock") return StoreAvailability.InStock;
        return null;
    }
    /// <summary>"129.90", "129,90", "1.299,90" ou número → centavos. Valores fora de 0–1.000.000 são descartados.</summary>
    public static int? Cents(string? value)
    {
        var text = (value ?? "").Trim();
        if (text.Length is 0 or > 20) return null;
        text = Regex.Replace(text, @"[^\d.,]", "");
        if (text.Contains(',') && text.Contains('.')) text = text.LastIndexOf(',') > text.LastIndexOf('.') ? text.Replace(".", "").Replace(',', '.') : text.Replace(",", "");
        else if (text.Contains(',')) text = text.Replace(',', '.');
        if (!decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount) || amount <= 0 || amount > 1_000_000) return null;
        return (int)Math.Round(amount * 100, MidpointRounding.AwayFromZero);
    }
    static string? Clean(string? value)
    {
        if (value == null) return null;
        var text = WebUtility.HtmlDecode(Tags().Replace(WebUtility.HtmlDecode(value), " "));
        text = Regex.Replace(text, @"\s+", " ").Trim();
        return text.Length == 0 ? null : new string(text.Where(ch => !char.IsControl(ch)).ToArray());
    }
    static string? Clip(string? value, int max) => value == null ? null : value.Length <= max ? value : value[..max].TrimEnd() + "…";
    static Dictionary<string, string> Attributes(string tag)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match a in Attribute().Matches(tag)) map.TryAdd(a.Groups[1].Value, a.Groups[3].Success ? a.Groups[3].Value : a.Groups[4].Value);
        return map;
    }

    [GeneratedRegex(@"<meta\b[^>]{1,2000}>", RegexOptions.IgnoreCase)] private static partial Regex MetaTag();
    [GeneratedRegex(@"<link\b[^>]{0,500}rel\s*=\s*[""']canonical[""'][^>]{0,1500}>", RegexOptions.IgnoreCase)] private static partial Regex CanonicalTag();
    [GeneratedRegex(@"<script\b[^>]*type\s*=\s*[""']application/ld\+json[""'][^>]*>([\s\S]{0,200000}?)</script>", RegexOptions.IgnoreCase)] private static partial Regex JsonLd();
    [GeneratedRegex(@"<title[^>]*>([\s\S]{0,500}?)</title>", RegexOptions.IgnoreCase)] private static partial Regex TitleTag();
    [GeneratedRegex(@"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(""([^""]*)""|'([^']*)')")] private static partial Regex Attribute();
    [GeneratedRegex(@"<[^>]{0,500}>")] private static partial Regex Tags();
}

/// <summary>Pré-visualização de link afiliado para o cadastro (Admin). Nunca publica nada e nunca inventa dados: o que não for
/// encontrado volta vazio, com aviso, para preenchimento manual.</summary>
public class StoreAffiliateService(GameDb db, StoreLinkReader reader, IConfiguration config, ILogger<StoreAffiliateService> logger)
{
    /// <summary>Lojas com leitura de metadados públicos ligada (<c>Store:PageReader:Marketplaces</c>). Amazon fica de fora por padrão:
    /// o programa de associados restringe preço obtido fora da API oficial.</summary>
    public string[] PageReaderMarketplaces()
    {
        var configured = config.GetSection("Store:PageReader:Marketplaces").Get<string[]>();
        return (configured ?? [StoreMarketplaces.Shopee, StoreMarketplaces.MercadoLivre]).Where(StoreMarketplaces.All.Contains).Distinct().ToArray();
    }

    public async Task<StorePreviewDto> PreviewAsync(StorePreviewInput x, CancellationToken ct)
    {
        var (uri, marketplace) = StoreAffiliateLinks.Validate(x.Url);
        var notes = new List<string>();
        var externalId = StoreAffiliateLinks.ExternalId(uri, marketplace);
        StoreMetadataParser.Result? meta = null;
        string? canonical = null;
        if (PageReaderMarketplaces().Contains(marketplace))
        {
            try
            {
                var (final, html) = await reader.ReadAsync(uri, marketplace, ct);
                externalId ??= StoreAffiliateLinks.ExternalId(final, marketplace);
                meta = StoreMetadataParser.Parse(html);
                canonical = SafeCanonical(meta.Canonical, final) ?? (final != uri ? SafeCanonical(final.GetLeftPart(UriPartial.Path), final) : null);
            }
            catch (StoreLinkException e)
            {
                logger.LogInformation("Store link preview unavailable for {Marketplace}: {Reason}", marketplace, e.Reason);
                notes.Add("Não foi possível ler os dados públicos da página (a loja pode bloquear leituras automáticas). Preencha os campos manualmente.");
            }
        }
        else notes.Add($"Leitura automática desligada para {StoreMarketplaces.Name(marketplace)}: nenhuma integração oficial está configurada. Preencha os dados manualmente; o preço só é exibido depois de conferido.");

        string? image = null;
        if (meta?.Image is { Length: > 0 } candidate)
        {
            try { image = StoreAffiliateLinks.ValidateImage(candidate); }
            catch (RuleException) { notes.Add("A imagem encontrada não está no site da loja; informe uma imagem do próprio anúncio."); }
        }
        var fetched = meta?.Title != null;
        if (meta != null && !fetched) notes.Add("A página não trouxe título reconhecível; confira os campos.");
        if (meta?.PriceCents != null) notes.Add("Preço lido da página: confira na loja antes de confirmar. Valores e disponibilidade mudam sem aviso.");
        else if (meta != null) notes.Add("Preço não encontrado na página. Deixe em branco para mostrar “Consultar preço na loja”.");
        if (externalId == null) notes.Add("Identificador do produto não reconhecido no link (comum em links encurtados).");

        var target = uri.AbsoluteUri;
        var duplicate = await db.StoreProducts.AsNoTracking()
            .Where(p => p.DeletedAt == null && (p.TargetUrl == target || (externalId != null && p.Marketplace == marketplace && p.ExternalId == externalId)))
            .Select(p => new StoreRef(p.Id, p.Title)).FirstOrDefaultAsync(ct);
        if (duplicate != null) notes.Add("Já existe um produto com este link ou identificador. Edite o existente para não duplicar.");

        return new(marketplace, StoreMarketplaces.Name(marketplace), (x.Url ?? "").Trim(), target, externalId, canonical,
            meta?.Title, meta?.Description, image, meta?.Brand, meta?.PriceCents, null, meta?.Currency, meta?.Availability, fetched, notes.ToArray(), duplicate);
    }

    /// <summary>URL canônica só se for https numa loja permitida; senão é descartada.</summary>
    static string? SafeCanonical(string? value, Uri page)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        try { return StoreAffiliateLinks.Validate(new Uri(page, value.Trim()).AbsoluteUri).Uri.AbsoluteUri; }
        catch (Exception e) when (e is RuleException or UriFormatException) { return null; }
    }
}
