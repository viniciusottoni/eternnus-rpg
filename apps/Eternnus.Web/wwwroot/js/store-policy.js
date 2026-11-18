// Loja do Aventureiro (ADR-104): regras puras de apresentação. O servidor valida links, preços e permissões;
// estas funções só evitam exibir algo inseguro ou enganoso. Testadas em tests/store-policy.test.mjs.

export const MARKETPLACES = Object.freeze({ amazon: "Amazon", shopee: "Shopee", mercadolivre: "Mercado Livre" });
const LINK_HOSTS = Object.freeze({
  amazon: ["amazon.com.br", "amazon.com", "amzn.to", "amzn.com", "a.co"],
  shopee: ["shopee.com.br", "shp.ee"],
  mercadolivre: ["mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com", "meli.la"],
});
const IMAGE_HOSTS = Object.freeze(["media-amazon.com", "ssl-images-amazon.com", "images-amazon.com", "susercontent.com", "shopee.com.br", "mlstatic.com"]);
const under = (host, domain) => host === domain || host.endsWith("." + domain);

export const marketplaceName = (key) => MARKETPLACES[key] || "Loja";
/** "na Amazon", "na Shopee", "no Mercado Livre" (concordância nas frases de oferta). */
export const atMarketplace = (key) => (key === "mercadolivre" ? "no " : "na ") + marketplaceName(key);
/** Texto do botão de saída para a loja: "Comprar na Amazon", "Comprar no Mercado Livre". */
export const buyLabel = (key) => "Comprar " + atMarketplace(key);

function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2000 || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** Link de oferta seguro para `href`: https, sem credenciais/porta, host de uma loja aceita. Senão, null (sem link). */
export function safeOfferUrl(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return Object.values(LINK_HOSTS).some((list) => list.some((d) => under(host, d))) ? url.href : null;
}

/** Imagem segura para `src`: https em CDN de loja aceita. Senão, null (mostra o selo da loja). */
export function safeImageUrl(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return IMAGE_HOSTS.some((d) => under(host, d)) ? url.href : null;
}

/** Centavos → moeda pt-BR. Valores inválidos viram texto vazio. */
export function formatPrice(cents, currency = "BRL") {
  if (!Number.isInteger(cents) || cents < 0) return "";
  const code = currency === "USD" ? "USD" : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(cents / 100);
}

export const PRICE_UNKNOWN = "Consultar preço na loja";
/** Texto do preço do cartão: valor só quando o servidor marcou como conferido e vigente. */
export function priceLabel(card) {
  return card?.priceStatus === "current" && Number.isInteger(card.priceCents) ? formatPrice(card.priceCents, card.currency) : PRICE_UNKNOWN;
}
/** Preço anterior riscado + selo de desconto só com dois preços conferidos e anterior maior. */
export function offerBadge(card) {
  return !!card && card.onSale === true && card.priceStatus === "current" && Number.isInteger(card.priceCents) &&
    Number.isInteger(card.previousPriceCents) && card.previousPriceCents > card.priceCents;
}

/** Percentual de desconto calculado dos dois preços conferidos (arredondado para baixo, nunca exagera); null sem oferta válida ou abaixo de 1%. */
export function discountPercent(card) {
  if (!offerBadge(card)) return null;
  const pct = Math.floor(((card.previousPriceCents - card.priceCents) * 100) / card.previousPriceCents);
  return pct >= 1 ? pct : null;
}

export function truncate(text, max = 80) {
  const value = String(text ?? "").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "") + "…";
}

// ---------- Vitrine ----------
export const SHOWCASE_PAGES = Object.freeze(["home", "campaigns", "campaign", "guild", "characters", "library", "progress"]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPAIGN_TABS = new Set(["", "overview", "journal", "players"]);

/**
 * Página da vitrine para a rota (#hash) ou null quando a tela não pode exibir conteúdo comercial
 * (mesa, sessão, ficha, preparação/editores, admin, conta, suporte, one-shot, a própria loja, login…).
 * Itens de rota além da aba (ex.: uma sessão aberta no diário) também ficam fora.
 */
export function showcasePage(hash) {
  const [root = "", id = "", tab = "", item = ""] = String(hash ?? "").replace(/^#/, "").split("/");
  if (root === "" || root === "overview") return id ? null : "home";
  if (root === "campaign") return GUID.test(id) && CAMPAIGN_TABS.has(tab) && !item ? "campaign" : null;
  if (["campaigns", "guild", "characters", "library", "progress"].includes(root)) return root === "guild" || !id ? root : null;
  return null;
}
/** Campanha de contexto da vitrine (só na página da campanha). */
export function showcaseCampaign(hash) {
  const [root, id] = String(hash ?? "").replace(/^#/, "").split("/");
  return root === "campaign" && GUID.test(id || "") ? id.toLowerCase() : "";
}
/** Limites por faixa de largura do contêiner: largo (≥ 860 px) 1–3, médio (≥ 520 px) 1–2, estreito 1. */
export function showcaseLayout(layout) {
  const clamp = (value, max, fallback) => Math.min(max, Math.max(1, Number.isInteger(value) ? value : fallback));
  return { wide: clamp(layout?.wide, 3, 3), medium: clamp(layout?.medium, 2, 2), narrow: 1 };
}
/** Colunas efetivas para uma largura de contêiner (espelha as container queries de store.css). */
export function showcaseColumns(width, layout) {
  const l = showcaseLayout(layout);
  if (width >= 860) return l.wide;
  if (width >= 520) return Math.min(l.medium, l.wide);
  return l.narrow;
}

// ---------- Exibição confirmada (ADR-108) ----------
/** Um cartão conta como exibido com ao menos metade visível por cerca de um segundo, com a aba visível. */
export const EXPOSURE_RATIO = 0.5;
export const EXPOSURE_MS = 1000;

/** Navegação real: a rota mudou desde a última sincronização da vitrine (renderizar de novo a mesma rota não conta). */
export const isNewNavigation = (previousRoute, hash) => previousRoute !== String(hash ?? "");

/** Entrada do IntersectionObserver suficiente para começar a contar a exibição. */
export const exposureVisible = (entry, documentVisible = true) =>
  !!entry && entry.isIntersecting === true && Number(entry.intersectionRatio) >= EXPOSURE_RATIO && documentVisible === true;

/**
 * Cartões já confirmados por exibição (token da exibição → produtos). Cada produto conta uma vez por exibição, mesmo
 * que o cartão saia e volte à tela ou a largura mude. Guarda só as últimas exibições; nada vai ao armazenamento.
 */
export function createExposureLedger(maxViews = 20) {
  const views = new Map();
  return {
    add(view, id) {
      if (!view || !id) return false;
      let seen = views.get(view);
      if (!seen) {
        seen = new Set();
        views.set(view, seen);
        if (views.size > maxViews) views.delete(views.keys().next().value);
      }
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    has: (view, id) => !!views.get(view)?.has(id),
    clear: () => views.clear(),
  };
}

// ---------- Catálogo ----------
export const SORTS = Object.freeze([
  ["relevance", "Relevância"],
  ["price_asc", "Menor preço"],
  ["price_desc", "Maior preço"],
  ["newest", "Mais recentes"],
  ["popular", "Popularidade"],
]);
export const emptyFilters = () => ({ q: "", systems: [], categories: [], marketplaces: [], minPrice: "", maxPrice: "", available: false, onSale: false, sort: "relevance", page: 1 });

/** "12,50" ou "12.5" → 12.5; vazio/inválido → null. */
export function parseReais(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}
/** Reais → centavos inteiros (null se inválido). */
export function toCents(value) {
  const reais = parseReais(value);
  return reais === null ? null : Math.round(reais * 100);
}
export const centsToInput = (cents) => (Number.isInteger(cents) ? (cents / 100).toFixed(2).replace(".", ",") : "");

/** Há escolha explícita do usuário (busca ou filtro) que prevalece sobre a ordem personalizada. */
export const hasExplicitFilters = (f) =>
  !!(f.q || f.systems.length || f.categories.length || f.marketplaces.length || parseReais(f.minPrice) !== null || parseReais(f.maxPrice) !== null || f.available || f.onSale);

/** Query string do catálogo (somente valores válidos). `seed` fixa a ordem dos empates durante a sessão de catálogo. */
export function catalogQuery(f, campaignId = "", seed = 0) {
  const q = new URLSearchParams();
  const term = String(f.q || "").trim().slice(0, 100);
  if (term.length >= 2) q.set("q", term);
  for (const s of f.systems) if (s === "generic" || GUID.test(s)) q.append("system", s);
  for (const c of f.categories) if (GUID.test(c)) q.append("category", c);
  for (const m of f.marketplaces) if (MARKETPLACES[m]) q.append("marketplace", m);
  const min = parseReais(f.minPrice), max = parseReais(f.maxPrice);
  if (min !== null) q.set("minPrice", String(min));
  if (max !== null) q.set("maxPrice", String(max));
  if (f.available) q.set("available", "true");
  if (f.onSale) q.set("onSale", "true");
  if (SORTS.some(([key]) => key === f.sort) && f.sort !== "relevance") q.set("sort", f.sort);
  if (Number.isInteger(f.page) && f.page > 1) q.set("page", String(Math.min(f.page, 500)));
  if (GUID.test(campaignId)) q.set("campaignId", campaignId);
  if (Number.isInteger(seed) && seed > 0 && seed <= 2147483647) q.set("seed", String(seed));
  return q.toString();
}

export const AVAILABILITY = Object.freeze({ unknown: "Não informada", in_stock: "Disponível", out_of_stock: "Indisponível" });
export const STATUSES = Object.freeze({ draft: "Rascunho", active: "Ativo", paused: "Pausado", archived: "Arquivado" });
/** Etiquetas de tag a partir do texto do formulário ("a, b , a" → ["a", "b"]). */
export function parseTags(text) {
  return [...new Set(String(text ?? "").split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
}
