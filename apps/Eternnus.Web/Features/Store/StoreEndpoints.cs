using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
namespace Eternnus.Web;

public static class StoreEndpoints
{
    /// <summary>/api/store (Verified) e /api/admin/store (Admin). GETs só leem; cliques, preferências e exclusão de interesses
    /// são escritas com o antiforgery comum. A identidade vem sempre do principal autenticado.</summary>
    public static void MapStoreEndpoints(this WebApplication app)
    {
        static string Me(ClaimsPrincipal u) => PlatformAccess.UserId(u);
        var store = app.MapGroup("/api/store").RequireAuthorization("Verified");
        store.MapGet("/products", ([FromQuery] string? q, [FromQuery] string[]? system, [FromQuery] Guid[]? category, [FromQuery] string[]? marketplace,
            decimal? minPrice, decimal? maxPrice, bool? available, bool? onSale, string? sort, int? page, Guid? campaignId, int? seed,
            StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) =>
            s.ProductsAsync(new(q, system, category, marketplace, minPrice, maxPrice, available, onSale, sort, page ?? 1, campaignId, seed), Me(u), ct));
        store.MapGet("/products/{id:guid}", (Guid id, StoreCatalogService s, CancellationToken ct) => s.ProductAsync(id, ct));
        store.MapGet("/suggestions", (string? q, StoreCatalogService s, CancellationToken ct) => s.SuggestionsAsync(q, ct));
        store.MapGet("/categories", (StoreCatalogService s, CancellationToken ct) => s.FiltersAsync(ct));
        store.MapGet("/recommendations", (string? page, Guid? campaignId, StoreRecommendationService s, ClaimsPrincipal u, CancellationToken ct) => s.RecommendAsync(Me(u), page, campaignId, ct));
        store.MapGet("/preferences", (StoreRecommendationService s, ClaimsPrincipal u, CancellationToken ct) => s.PreferencesAsync(Me(u), ct));
        store.MapPut("/preferences", (StorePreferencesInput x, StoreRecommendationService s, ClaimsPrincipal u, CancellationToken ct) => s.SavePreferencesAsync(Me(u), x, ct));
        store.MapDelete("/interests", async (StoreRecommendationService s, ClaimsPrincipal u, CancellationToken ct) => { await s.ClearInterestsAsync(Me(u), ct); return Results.NoContent(); });
        store.MapPost("/interactions", async (StoreInteractionInput x, StoreAnalyticsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RecordAsync(Me(u), x, ct); return Results.NoContent(); })
            .RequireRateLimiting("store");
        // Exibições confirmadas da vitrine (ADR-108): token da exibição, idempotente; o GET de recomendações nunca grava.
        store.MapPost("/impressions", async (StoreImpressionInput x, StoreAnalyticsService s, ClaimsPrincipal u, CancellationToken ct) => { await s.RecordImpressionsAsync(Me(u), x, ct); return Results.NoContent(); })
            .RequireRateLimiting("store-impressions");

        var admin = app.MapGroup("/api/admin/store").RequireAuthorization("Verified").RequireAuthorization(PlatformAccess.AdminPolicy);
        admin.MapGet("/products", (string? q, string? status, string? marketplace, Guid? category, Guid? system, int? page, StoreCatalogService s, CancellationToken ct) =>
            s.AdminListAsync(q, status, marketplace, category, system, page ?? 1, ct));
        admin.MapGet("/products/{id:guid}", (Guid id, StoreCatalogService s, CancellationToken ct) => s.AdminProductAsync(id, ct));
        admin.MapPost("/products", async (StoreProductInput x, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) =>
        {
            var product = await s.CreateAsync(x, Me(u), ct);
            return Results.Created($"/api/admin/store/products/{product.Id}", product);
        });
        admin.MapPut("/products/{id:guid}", (Guid id, StoreProductInput x, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => s.UpdateAsync(id, x, Me(u), ct));
        admin.MapPost("/products/{id:guid}/status", (Guid id, StoreStatusInput x, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => s.SetStatusAsync(id, x, Me(u), ct));
        admin.MapDelete("/products/{id:guid}", async (Guid id, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteAsync(id, Me(u), ct); return Results.NoContent(); });
        admin.MapPost("/preview-link", (StorePreviewInput x, StoreAffiliateService s, CancellationToken ct) => s.PreviewAsync(x, ct)).RequireRateLimiting("store-preview");
        admin.MapGet("/categories", (StoreCatalogService s, CancellationToken ct) => s.CategoriesAsync(ct));
        admin.MapPost("/categories", (StoreCategoryInput x, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveCategoryAsync(null, x, Me(u), ct));
        admin.MapPut("/categories/{id:guid}", (Guid id, StoreCategoryInput x, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveCategoryAsync(id, x, Me(u), ct));
        admin.MapDelete("/categories/{id:guid}", async (Guid id, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => { await s.DeleteCategoryAsync(id, Me(u), ct); return Results.NoContent(); });
        admin.MapGet("/settings", (StoreCatalogService s, CancellationToken ct) => s.SettingsAsync(ct));
        admin.MapPut("/settings", (StoreSettingsInput x, StoreCatalogService s, ClaimsPrincipal u, CancellationToken ct) => s.SaveSettingsAsync(x, Me(u), ct));
        admin.MapGet("/metrics", (int? days, StoreAnalyticsService s, CancellationToken ct) => s.MetricsAsync(days, ct));
    }
}
