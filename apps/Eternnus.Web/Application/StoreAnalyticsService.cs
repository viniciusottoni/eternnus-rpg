using Microsoft.EntityFrameworkCore;
namespace Eternnus.Web;

public record StoreInteractionInput(Guid ProductId, string? Surface);
public record StoreCountDto(string Key, string Name, int Clicks);

/// <summary>Cliques e indicadores agregados (ADR-104). Nunca guarda texto de conversa; o painel só vê números agregados.
/// Impressões não são registradas, por isso não há CTR; receita e comissão não são conhecidas.</summary>
public class StoreAnalyticsService(GameDb db, TimeProvider clock)
{
    /// <summary>O mesmo usuário, produto e superfície contam uma vez nesta janela.</summary>
    public static readonly TimeSpan Dedupe = TimeSpan.FromMinutes(30);

    public async Task RecordAsync(string userId, StoreInteractionInput x, CancellationToken ct)
    {
        var surface = StoreSurfaces.All.Contains(x.Surface) ? x.Surface! : throw new RuleException(400, "Origem do clique inválida.");
        if (!await StoreQueries.Public(db).AnyAsync(p => p.Id == x.ProductId, ct)) throw new RuleException(404, "Produto não encontrado.");
        var now = clock.GetUtcNow().UtcDateTime;
        var since = now - Dedupe;
        if (await db.StoreInteractions.AnyAsync(i => i.UserId == userId && i.ProductId == x.ProductId && i.Surface == surface && i.CreatedAt >= since, ct)) return;
        db.StoreInteractions.Add(new StoreInteraction { ProductId = x.ProductId, UserId = userId, Surface = surface, CreatedAt = now });
        await db.SaveChangesAsync(ct);
        // Contador atômico: não disputa a revisão do produto com a edição administrativa.
        await db.StoreProducts.Where(p => p.Id == x.ProductId).ExecuteUpdateAsync(s => s.SetProperty(p => p.Clicks, p => p.Clicks + 1), ct);
    }

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
            byMarketplace = StoreMarketplaces.All.Select(m => new StoreCountDto(m, StoreMarketplaces.Name(m), byMarket.GetValueOrDefault(m))),
            byCategory = byCategory.OrderByDescending(c => c.Count).Select(c => new { id = c.Id, name = c.Name, clicks = c.Count }),
            bySystem = bySystem.OrderByDescending(s => s.Count).Select(s => new { id = s.Id, name = s.Name, clicks = s.Count }),
            impressionsTracked = false,
        };
    }
}
