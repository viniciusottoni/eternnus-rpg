// Chamadas HTTP da Loja do Aventureiro e da aba Loja do painel. Tudo passa por api.js (CSRF, credenciais e erros comuns).
import { api } from "./api.js";

const id = (value) => encodeURIComponent(value);

// ---------- Público (Verified) ----------
export const storeProducts = (query, { signal } = {}) => api(`/store/products${query ? "?" + query : ""}`, "GET", undefined, { background: true, signal });
export const storeProduct = (productId) => api(`/store/products/${id(productId)}`);
export const storeSuggestions = (q, { signal } = {}) => api(`/store/suggestions?${new URLSearchParams({ q })}`, "GET", undefined, { background: true, signal });
export const storeFilters = ({ signal } = {}) => api("/store/categories", "GET", undefined, { background: true, signal });
/** Vitrine: sempre em segundo plano, nunca bloqueia a tela. */
export function storeRecommendations(page, campaignId, { signal } = {}) {
  const q = new URLSearchParams({ page });
  if (campaignId) q.set("campaignId", campaignId);
  return api(`/store/recommendations?${q}`, "GET", undefined, { background: true, signal });
}
export const storePreferences = ({ background = false } = {}) => api("/store/preferences", "GET", undefined, { background });
export const saveStorePreferences = (prefs, { background = false } = {}) =>
  api("/store/preferences", "PUT", {
    showShowcase: !!prefs.showShowcase,
    useCampaignSystems: !!prefs.useCampaignSystems,
    analyzeMessages: !!prefs.analyzeMessages,
    interestSystemId: prefs.interestSystemId || null,
  }, { background });
export const clearStoreInterests = () => api("/store/interests", "DELETE");
/** Clique na oferta: escrita explícita em segundo plano; falha não impede a navegação. */
export const recordStoreClick = (productId, surface) =>
  api("/store/interactions", "POST", { productId, surface }, { background: true }).catch(() => {});

// ---------- Administração (Admin) ----------
export function adminStoreProducts(filters = {}) {
  const q = new URLSearchParams();
  for (const key of ["q", "status", "marketplace", "category", "system"]) if (filters[key]) q.set(key, filters[key]);
  if (filters.page > 1) q.set("page", String(filters.page));
  const text = q.toString();
  return api(`/admin/store/products${text ? "?" + text : ""}`, "GET", undefined, { background: true });
}
export const adminStoreProduct = (productId) => api(`/admin/store/products/${id(productId)}`);
export const adminCreateStoreProduct = (input) => api("/admin/store/products", "POST", input);
export const adminUpdateStoreProduct = (productId, input) => api(`/admin/store/products/${id(productId)}`, "PUT", input);
export const adminStoreProductStatus = (productId, status, revision) => api(`/admin/store/products/${id(productId)}/status`, "POST", { status, revision });
export const adminDeleteStoreProduct = (productId) => api(`/admin/store/products/${id(productId)}`, "DELETE");
export const adminPreviewLink = (url) => api("/admin/store/preview-link", "POST", { url });
export const adminStoreCategories = () => api("/admin/store/categories", "GET", undefined, { background: true });
export const adminSaveStoreCategory = (categoryId, input) =>
  categoryId ? api(`/admin/store/categories/${id(categoryId)}`, "PUT", input) : api("/admin/store/categories", "POST", input);
export const adminDeleteStoreCategory = (categoryId) => api(`/admin/store/categories/${id(categoryId)}`, "DELETE");
export const adminStoreSettings = () => api("/admin/store/settings", "GET", undefined, { background: true });
export const adminSaveStoreSettings = (input) => api("/admin/store/settings", "PUT", input);
export const adminStoreMetrics = (days) => api(`/admin/store/metrics?days=${Number(days) || 30}`, "GET", undefined, { background: true });
export const activeRpgSystems = () => api("/rpg-systems", "GET", undefined, { background: true });
