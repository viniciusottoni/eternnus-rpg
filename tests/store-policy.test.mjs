// Loja do Aventureiro (ADR-104): regras puras de apresentação, PWA e integração com navegação/painel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../apps/Eternnus.Web/wwwroot/", import.meta.url);
const load = async (path) => import("data:text/javascript;base64," + Buffer.from(await readFile(new URL(path, root), "utf8")).toString("base64"));
const policy = await load("js/store-policy.js");
const { STATIC_PATHS } = await load("js/pwa-policy.js");

test("offer links open only https pages of the three marketplaces, keeping affiliate parameters", () => {
  const amazon = "https://www.amazon.com.br/dp/B000TEST01?tag=eternnus-20";
  assert.equal(policy.safeOfferUrl(amazon), amazon);
  for (const ok of ["https://amzn.to/3abc", "https://s.shopee.com.br/x?af=1", "https://produto.mercadolivre.com.br/MLB-123-x?matt_tool=1", "https://meli.la/x"])
    assert.ok(policy.safeOfferUrl(ok), ok);
  for (const bad of ["http://www.amazon.com.br/dp/x", "javascript:alert(1)", "https://evilamazon.com.br/dp/x", "https://amazon.com.br.evil.example/x",
    "https://user:pw@amazon.com.br/x", "https://amazon.com.br:8443/x", "https://example.com/x", "", null, "https://amazon.com.br/x y"])
    assert.equal(policy.safeOfferUrl(bad), null, String(bad));
});

test("images come only from marketplace CDNs over https", () => {
  assert.ok(policy.safeImageUrl("https://m.media-amazon.com/images/I/a.jpg"));
  assert.ok(policy.safeImageUrl("https://http2.mlstatic.com/D_1.jpg"));
  assert.ok(policy.safeImageUrl("https://down-br.img.susercontent.com/file/x"));
  for (const bad of ["https://evil.example/a.jpg", "http://m.media-amazon.com/a.jpg", "data:image/png;base64,AAAA", "//m.media-amazon.com/a.jpg"])
    assert.equal(policy.safeImageUrl(bad), null, bad);
});

test("prices show only when verified and current; offers never estimate discounts", () => {
  const norm = (s) => s.replace(/\s/g, " ");
  assert.equal(norm(policy.formatPrice(19990)), "R$ 199,90");
  assert.equal(policy.formatPrice(-1), "");
  assert.equal(policy.formatPrice(1.5), "");
  assert.equal(norm(policy.priceLabel({ priceStatus: "current", priceCents: 4990, currency: "BRL" })), "R$ 49,90");
  assert.equal(policy.priceLabel({ priceStatus: "stale", priceCents: null }), "Consultar preço na loja");
  assert.equal(policy.priceLabel({ priceStatus: "none" }), "Consultar preço na loja");
  assert.equal(policy.offerBadge({ onSale: true, priceStatus: "current", priceCents: 100, previousPriceCents: 150 }), true);
  assert.equal(policy.offerBadge({ onSale: true, priceStatus: "stale", priceCents: 100, previousPriceCents: 150 }), false);
  assert.equal(policy.offerBadge({ onSale: true, priceStatus: "current", priceCents: 150, previousPriceCents: 100 }), false);
  assert.equal(policy.offerBadge({ onSale: false, priceStatus: "current", priceCents: 100, previousPriceCents: 150 }), false);
});

test("discount percent comes only from two verified prices and never rounds up", () => {
  assert.equal(policy.discountPercent({ onSale: true, priceStatus: "current", priceCents: 31590, previousPriceCents: 41990 }), 24);
  assert.equal(policy.discountPercent({ onSale: true, priceStatus: "current", priceCents: 45171, previousPriceCents: 79990 }), 43);
  assert.equal(policy.discountPercent({ onSale: true, priceStatus: "current", priceCents: 9950, previousPriceCents: 10000 }), null);
  assert.equal(policy.discountPercent({ onSale: true, priceStatus: "stale", priceCents: 100, previousPriceCents: 150 }), null);
  assert.equal(policy.discountPercent({ onSale: false, priceStatus: "current", priceCents: 100, previousPriceCents: 150 }), null);
});

test("buy button names the store with the right preposition", () => {
  assert.equal(policy.buyLabel("amazon"), "Comprar na Amazon");
  assert.equal(policy.buyLabel("shopee"), "Comprar na Shopee");
  assert.equal(policy.buyLabel("mercadolivre"), "Comprar no Mercado Livre");
});

test("reais parse to integer cents and back", () => {
  assert.equal(policy.toCents("49,90"), 4990);
  assert.equal(policy.toCents("1.299,90"), 129990);
  assert.equal(policy.toCents("12.5"), 1250);
  assert.equal(policy.toCents(""), null);
  assert.equal(policy.toCents("abc"), null);
  assert.equal(policy.toCents("-3"), null);
  assert.equal(policy.centsToInput(129990), "1299,90");
  assert.equal(policy.centsToInput(null), "");
  assert.deepEqual(policy.parseTags(" Dragão, d20 , dragão,, Dados  Metálicos "), ["dragão", "d20", "dados metálicos"]);
});

test("titles are truncated on word boundaries", () => {
  assert.equal(policy.truncate("Curto"), "Curto");
  const long = policy.truncate("Tormenta20 Livro Básico Edição Jogo do Ano com capa dura e marcador de páginas exclusivo", 40);
  assert.ok(long.length <= 40 && long.endsWith("…"), long);
});

test("the showcase appears only on general pages, never on the table, editors, sheets, admin or account flows", () => {
  const guid = "11111111-2222-4333-8444-555555555555";
  const allowed = { "": "home", "#overview": "home", "#campaigns": "campaigns", [`#campaign/${guid}`]: "campaign", [`#campaign/${guid}/journal`]: "campaign",
    [`#campaign/${guid}/players`]: "campaign", "#guild": "guild", "#guild/topic/abc": "guild", "#characters": "characters", "#library": "library", "#progress": "progress" };
  for (const [hash, page] of Object.entries(allowed)) assert.equal(policy.showcasePage(hash), page, hash);
  for (const hash of [`#table/${guid}`, `#session/${guid}/x`, `#character/${guid}`, `#campaign/${guid}/prep`, `#campaign/${guid}/prep/scenes`,
    `#campaign/${guid}/world`, `#campaign/${guid}/notes`, `#campaign/${guid}/settings`, `#campaign/${guid}/journal/live-${guid}`, "#campaign/not-a-guid",
    "#admin", "#admin/store", "#settings", "#support", "#one-shot", "#store", "#notebook", "#templates", "#invite/abc", "#login", "#register", "#library/x"])
    assert.equal(policy.showcasePage(hash), null, hash);
  assert.equal(policy.showcaseCampaign(`#campaign/${guid.toUpperCase()}/overview`), guid);
  assert.equal(policy.showcaseCampaign("#guild"), "");
});

test("showcase columns follow the container width and the configured limits", () => {
  const layout = { wide: 3, medium: 2, narrow: 1 };
  assert.equal(policy.showcaseColumns(1200, layout), 3);
  assert.equal(policy.showcaseColumns(700, layout), 2);
  assert.equal(policy.showcaseColumns(390, layout), 1);
  assert.equal(policy.showcaseColumns(1200, { wide: 2, medium: 1 }), 2);
  assert.equal(policy.showcaseColumns(700, { wide: 1, medium: 2 }), 1);
  assert.deepEqual(policy.showcaseLayout({ wide: 9, medium: 7, narrow: 4 }), { wide: 3, medium: 2, narrow: 1 });
});

test("catalog queries carry only valid filters and explicit choices are detected", () => {
  const f = policy.emptyFilters();
  assert.equal(policy.catalogQuery(f), "");
  assert.equal(policy.hasExplicitFilters(f), false);
  const guid = "11111111-2222-4333-8444-555555555555";
  Object.assign(f, { q: " dragão ", systems: [guid, "generic", "<x>"], categories: [guid, "bad"], marketplaces: ["amazon", "ebay"], minPrice: "10,50", maxPrice: "x",
    available: true, onSale: true, sort: "price_asc", page: 3 });
  const q = new URLSearchParams(policy.catalogQuery(f, guid));
  assert.equal(q.get("q"), "dragão");
  assert.deepEqual(q.getAll("system"), [guid, "generic"]);
  assert.deepEqual(q.getAll("category"), [guid]);
  assert.deepEqual(q.getAll("marketplace"), ["amazon"]);
  assert.equal(q.get("minPrice"), "10.5");
  assert.equal(q.get("maxPrice"), null);
  assert.equal(q.get("available"), "true");
  assert.equal(q.get("onSale"), "true");
  assert.equal(q.get("sort"), "price_asc");
  assert.equal(q.get("page"), "3");
  assert.equal(q.get("campaignId"), guid);
  assert.equal(policy.hasExplicitFilters(f), true);
  assert.equal(new URLSearchParams(policy.catalogQuery({ ...policy.emptyFilters(), q: "a", sort: "evil" })).toString(), "");
});

test("store files are part of the public shell; APIs and recommendations are never cacheable", async () => {
  for (const path of ["/store.css", "/js/store.js", "/js/store-api.js", "/js/store-policy.js", "/js/store-recommendations.js", "/js/admin-store.js", "/js/help/loja.js"])
    assert.ok(STATIC_PATHS.includes(path), path);
  assert.ok(!STATIC_PATHS.some((p) => p.startsWith("/api")));
  const index = await readFile(new URL("index.html", root), "utf8");
  assert.match(index, /href="\/store\.css"/);
});

test("Loja is a secondary navigation item (sidebar and mobile 'Mais'), a platform route and an admin tab", async () => {
  const layout = await readFile(new URL("js/layout.js", root), "utf8");
  assert.match(layout, /\["store", "[^"]+", "Loja", false\]/);
  assert.match(layout, /<aside id="store-strip" class="store-strip" hidden/);
  assert.doesNotMatch(layout, /import \{[^}]*\} from "\.\/store-recommendations\.js"/); // carregada sob demanda
  const routes = await readFile(new URL("js/policy.js", root), "utf8");
  assert.match(routes, /store: \["\.\/store\.js", "renderStore"\]/);
  const admin = await readFile(new URL("js/admin.js", root), "utf8");
  assert.match(admin, /\["store", "Loja"\]/);
  assert.match(admin, /import\("\.\/admin-store\.js"\)/);
});

// ---------- Rotação inteligente e exibição confirmada (ADR-108) ----------
test("a card counts as seen only at half visibility with the tab visible", () => {
  assert.equal(policy.EXPOSURE_RATIO, 0.5);
  assert.equal(policy.EXPOSURE_MS, 1000);
  assert.equal(policy.exposureVisible({ isIntersecting: true, intersectionRatio: 0.5 }, true), true);
  assert.equal(policy.exposureVisible({ isIntersecting: true, intersectionRatio: 0.49 }, true), false);
  assert.equal(policy.exposureVisible({ isIntersecting: false, intersectionRatio: 1 }, true), false);
  assert.equal(policy.exposureVisible({ isIntersecting: true, intersectionRatio: 1 }, false), false); // aba oculta
  assert.equal(policy.exposureVisible(null, true), false);
});

test("only a real route change is a new navigation; re-rendering the same route is not", () => {
  assert.equal(policy.isNewNavigation(null, "#campaigns"), true);
  assert.equal(policy.isNewNavigation("#campaigns", "#campaigns"), false);
  assert.equal(policy.isNewNavigation("#campaigns", "#guild"), true);
  assert.equal(policy.isNewNavigation("#guild", "#campaigns"), true); // voltar à mesma página é nova navegação
});

test("the exposure ledger counts each product once per view, across resizes and re-observation", () => {
  const ledger = policy.createExposureLedger(2);
  assert.equal(ledger.add("view-1", "a"), true);
  assert.equal(ledger.add("view-1", "a"), false); // saiu e voltou à tela / girou o celular
  assert.equal(ledger.add("view-1", "b"), true);
  assert.equal(ledger.add("view-2", "a"), true);   // outra exibição (outra navegação) conta de novo
  assert.equal(ledger.has("view-1", "b"), true);
  ledger.add("view-3", "z");                        // guarda só as últimas exibições
  assert.equal(ledger.has("view-1", "a"), false);
  assert.equal(ledger.add("", "a"), false);
  assert.equal(ledger.add("view-3", ""), false);
  ledger.clear();
  assert.equal(ledger.has("view-3", "z"), false);
});

test("catalog sessions send a stable seed so pagination neither repeats nor hides products", () => {
  const f = { ...policy.emptyFilters(), page: 2 };
  assert.equal(new URLSearchParams(policy.catalogQuery(f, "", 12345)).get("seed"), "12345");
  for (const bad of [0, -1, 1.5, 2147483648, "7", null]) assert.equal(new URLSearchParams(policy.catalogQuery(f, "", bad)).has("seed"), false, String(bad));
});

test("the showcase renews per navigation without polling, persists nothing sensitive and confirms exposures by POST", async () => {
  const source = await readFile(new URL("js/store-recommendations.js", root), "utf8");
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /recordStoreImpressions/);
  assert.doesNotMatch(source, /setInterval|localStorage|CACHE_MS/);
  assert.match(source, /data-store-item=/);
  const api = await readFile(new URL("js/store-api.js", root), "utf8");
  assert.match(api, /"\/store\/impressions", "POST"/);
  assert.match(api, /learnFromClicks: prefs\.learnFromClicks !== false/);
});
