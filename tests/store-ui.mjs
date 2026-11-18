/**
 * Loja do Aventureiro (ADR-104) contra PostgreSQL isolado (porta 5311) e Chrome headless.
 * API: acesso (401/403/CSRF), cadastro por link afiliado com parâmetros preservados, prévia da Amazon sem rede, catálogo,
 * recomendação priorizando o sistema da campanha, cliques e métricas. Interface: menu Loja no desktop e no "Mais" do
 * celular, vitrine com 3/2/1 colunas pela largura, ausência em telas imersivas, ocultação persistida, página com filtros,
 * detalhe, teclado, painel admin (produtos, categorias, vitrine, indicadores) e nenhum erro de JavaScript/CSP.
 * Imagens e páginas das lojas são interceptadas: nada sai para a internet.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { startEnvironment } from "./support/harness.mjs";
import { mkdir } from "node:fs/promises";

const dir = "artifacts/qa/loja";
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5311 });
const { check, ok, sql } = env;
const errors = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let browser;
try {
  // ---------- API ----------
  const admin = await env.verifiedClient("loja.admin@example.test", "Admin da Loja");
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='loja.admin@example.test'`);
  await env.authenticateMfa(admin, "loja.admin@example.test");
  const ana = await env.verifiedClient("loja.ana@example.test", "Ana de Arton");

  await env.client()("/api/store/products", "GET", undefined, 401);
  await ana("/api/admin/store/products", "GET", undefined, 403);
  await ana("/api/admin/store/products", "POST", { affiliateUrl: "https://www.amazon.com.br/dp/B000TEST01", title: "x" }, 403);
  await ana("/api/store/interactions", "POST", { productId: "00000000-0000-4000-8000-000000000000", surface: "store" }, 400, { csrf: false });

  const t20 = await admin("/api/admin/rpg-systems", "POST", { name: "Tormenta20", slug: "tormenta20", description: "Fantasia em Arton." });
  const dnd = await admin("/api/admin/rpg-systems", "POST", { name: "D&D 5e", slug: "dnd-5e", description: "Fantasia clássica." });
  const campaign = await ana("/api/campaigns", "POST", { name: "Crônicas de Arton", description: "Campanha de teste.", rpgSystemId: t20.id, playMode: "tactical" });

  const categories = await admin("/api/admin/store/categories");
  check(categories.length >= 12, true, "taxonomia inicial semeada");
  const cat = (slug) => categories.find((c) => c.slug === slug).id;
  const image = (n) => `https://m.media-amazon.com/images/I/eternnus-${n}.jpg`;
  const make = (body) => admin("/api/admin/store/products", "POST", { status: "active", currency: "BRL", ...body }, 201);
  const core = await make({ affiliateUrl: "https://www.amazon.com.br/dp/B000TEST01?tag=eternnus-20", title: "Tormenta20 — Livro Básico", description: "Regras completas de Arton.", imageUrl: image(1), categoryId: cat("livros-basicos"), systemIds: [t20.id], tags: ["tormenta", "arton"], priceCents: 19990, confirmPrice: true });
  const minis = await make({ affiliateUrl: "https://shopee.com.br/miniatura-dragao-i.123.456?af_id=eternnus", title: "Miniatura de dragão vermelho para Tormenta20", imageUrl: "https://down-br.img.susercontent.com/file/eternnus-2", categoryId: cat("miniaturas"), systemIds: [t20.id], tags: ["miniatura", "dragão"] });
  const dice = await make({ affiliateUrl: "https://produto.mercadolivre.com.br/MLB-123456789-dados-metalicos?matt_tool=eternnus", title: "Conjunto de dados metálicos", imageUrl: "https://http2.mlstatic.com/D_eternnus-3.jpg", categoryId: cat("dados"), tags: ["dados metálicos", "d20"], priceCents: 8990, previousPriceCents: 11990, confirmPrice: true });
  const dndBook = await make({ affiliateUrl: "https://www.amazon.com.br/dp/B000TEST04?tag=eternnus-20", title: "Livro do Jogador 5e", imageUrl: image(4), categoryId: cat("livros-basicos"), systemIds: [dnd.id], priority: 100 });
  await make({ affiliateUrl: "https://www.amazon.com.br/dp/B000TEST05?tag=eternnus-20", title: "Rascunho escondido", status: "draft" });
  check(core.targetUrl.includes("tag=eternnus-20"), true, "parâmetro de afiliado preservado");
  check([core.marketplace, minis.marketplace, dice.marketplace], ["amazon", "shopee", "mercadolivre"], "lojas identificadas");
  check(dice.externalId, "MLB123456789", "identificador do Mercado Livre");
  await admin("/api/admin/store/products", "POST", { affiliateUrl: "https://evil.example/dp/B000TEST09", title: "Falso" }, 400);
  const preview = await admin("/api/admin/store/preview-link", "POST", { url: "https://www.amazon.com.br/Tormenta/dp/8583650826?tag=eternnus-20" });
  check([preview.marketplace, preview.externalId, preview.fetched], ["amazon", "8583650826", false], "prévia da Amazon sem leitura de página");
  ok(preview.notes.length > 0, "prévia explica o preenchimento manual");
  const audit = sql(`SELECT count(*) FROM "Audit" WHERE "Action" LIKE 'store.%' AND "Data" LIKE '%eternnus-20%'`);
  check(audit, "0", "auditoria sem link afiliado");

  const list = await ana("/api/store/products");
  check(list.total, 4, "rascunho fora do catálogo público");
  check(list.personalized, true, "ordem personalizada sem filtros");
  check(list.context.systemName, "Tormenta20", "contexto pelo sistema da campanha");
  check(new Set(list.items.slice(0, 2).map((i) => i.id)), new Set([core.id, minis.id]), "Tormenta20 primeiro na loja");
  const filtered = await ana(`/api/store/products?system=${dnd.id}`);
  check(filtered.items.map((i) => i.id), [dndBook.id], "filtro explícito prevalece");
  const recommendations = await ana("/api/store/recommendations?page=home");
  check(recommendations.show, true, "vitrine com produtos");
  check(new Set(recommendations.items.slice(0, 2).map((i) => i.id)), new Set([core.id, minis.id]), "vitrine prioriza Tormenta20");
  check((await ana("/api/store/recommendations?page=table")).show, false, "vitrine nunca na mesa");
  await ana("/api/store/interactions", "POST", { productId: core.id, surface: "showcase" }, 204);

  // ---------- Interface ----------
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  async function pageFor(client, { mobile = false, width = 1440 } = {}) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block", hasTouch: mobile, isMobile: mobile });
    await context.addCookies(client.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    // Nada sai para as lojas: imagens viram um PNG local e a página de oferta, uma resposta simples.
    await context.route(/^https:\/\/([a-z0-9-]+\.)*(media-amazon\.com|susercontent\.com|mlstatic\.com)\//, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await context.route(/^https:\/\/([a-z0-9-]+\.)*(amazon\.com\.br|shopee\.com\.br|mercadolivre\.com\.br)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Loja</title>" }));
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" || /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
    return page;
  }
  const ready = (page) => page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy"), { timeout: 20000 });
  async function go(page, route, selector) {
    if (page.url() === "about:blank") await page.goto(`${env.origin}/#${route}`);
    else await page.evaluate((r) => { location.hash = r; }, route);
    await page.locator(selector).first().waitFor({ timeout: 20000 });
    await ready(page);
  }
  const visibleItems = (page) => page.locator(".store-strip-item").evaluateAll((items) => items.filter((i) => getComputedStyle(i).display !== "none").length);
  async function keyboardReach(page, selector) {
    const target = page.locator(selector).first();
    await page.locator("#main").focus();
    for (let i = 0; i < 200; i++) {
      await page.keyboard.press("Tab");
      if (await target.evaluate((el) => document.activeElement === el)) return true;
    }
    return false;
  }

  // Desktop: menu, vitrine acima do título e três colunas.
  const desk = await pageFor(ana);
  await go(desk, "overview", '#store-strip[data-state="ready"] .store-strip-item');
  ok(await desk.locator('.sidebar nav[aria-label="Menu principal"] a.nav-item[href="#store"]').isVisible(), "Loja no menu lateral");
  check(await visibleItems(desk), 3, "três produtos no desktop largo");
  const geometry = await desk.evaluate(() => {
    const strip = document.querySelector("#store-strip").getBoundingClientRect();
    const heading = document.querySelector("#main .page-heading").getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    return { height: strip.height, belowTopbar: strip.top >= topbar.bottom - 1, aboveHeading: strip.bottom <= heading.top + 1 };
  });
  ok(geometry.height <= 110 && geometry.height >= 72, `altura da vitrine ${geometry.height}px`);
  ok(geometry.belowTopbar && geometry.aboveHeading, "vitrine entre a barra superior e o título");
  check((await desk.locator(".store-strip-name").first().textContent()).trim().startsWith("Tormenta20") || (await desk.locator(".store-strip-name").first().textContent()).includes("Tormenta20"), true, "primeiro produto do sistema da campanha");
  const offer = desk.locator(".store-strip-offer").first();
  check([await offer.getAttribute("target"), await offer.getAttribute("rel")], ["_blank", "sponsored noopener noreferrer"], "oferta externa identificada");
  ok((await offer.getAttribute("href")).startsWith("https://"), "link https da loja");
  ok(await keyboardReach(desk, ".store-strip-offer"), "oferta alcançável pelo teclado");
  await desk.screenshot({ path: `${dir}/inicio-desktop.png` });

  // Largura do contêiner decide as colunas.
  await desk.setViewportSize({ width: 960, height: 900 });
  await desk.waitForTimeout(150);
  check(await visibleItems(desk), 2, "duas colunas com contêiner médio");
  await desk.setViewportSize({ width: 1440, height: 900 });

  // Telas imersivas e administrativas não mostram a vitrine.
  for (const route of [`campaign/${campaign.id}/prep`, "settings", "store"]) {
    await go(desk, route, "#main *");
    ok(!(await desk.locator("#store-strip").isVisible()), `sem vitrine em #${route}`);
  }
  await go(desk, `campaign/${campaign.id}`, '#store-strip[data-state="ready"] .store-strip-item');
  ok(await desk.locator("#store-strip").isVisible(), "vitrine na visão geral da campanha");
  await desk.evaluate((id) => { location.hash = `table/${id}`; }, campaign.id);
  await desk.waitForTimeout(1500);
  ok(!(await desk.locator("#store-strip").isVisible()), "sem vitrine na mesa");

  // Página da loja: filtros, ordenação, detalhe e clique registrado.
  await go(desk, "store", ".store-card");
  check((await desk.locator("#main h1").textContent()).trim(), "Loja do Aventureiro", "título da loja");
  check(await desk.locator(".store-card").count(), 4, "quatro produtos ativos");
  ok((await desk.locator("#store-context").textContent()).includes("Tormenta20"), "ordem explicada ao usuário");
  await desk.locator(`#store-filters input[name="system"][value="${dnd.id}"]`).check();
  await desk.waitForFunction(() => document.querySelectorAll(".store-card").length === 1, null, { timeout: 10000 });
  ok((await desk.locator(".store-card-title").textContent()).includes("Livro do Jogador"), "filtro por sistema na interface");
  await desk.locator('[data-action="store-clear"]').first().click();
  await desk.waitForFunction(() => document.querySelectorAll(".store-card").length === 4, null, { timeout: 10000 });
  await desk.locator("#store-q").fill("metálicos");
  await desk.locator("#store-search button[type=submit]").click();
  await desk.waitForFunction(() => document.querySelectorAll(".store-card").length === 1, null, { timeout: 10000 });
  ok(await desk.locator(".store-sale").first().isVisible(), "selo de oferta com preços conferidos");
  ok(await keyboardReach(desk, ".store-card-title"), "título do cartão alcançável pelo teclado");
  await desk.keyboard.press("Enter");
  await desk.locator("#modal .store-detail").waitFor({ timeout: 10000 });
  ok((await desk.locator("#modal").textContent()).includes("Preço conferido em"), "detalhe informa a conferência do preço");
  const [tab] = await Promise.all([desk.context().waitForEvent("page"), desk.locator('#modal a[data-surface="detail"]').click()]);
  await tab.close();
  await desk.keyboard.press("Escape");
  await desk.screenshot({ path: `${dir}/loja-desktop.png` });

  // Ocultar a vitrine persiste no servidor.
  await go(desk, "guild", '#store-strip[data-state="ready"]');
  await desk.locator('[data-action="store-strip-hide"]').click();
  ok(await desk.locator("#store-strip").isHidden(), "vitrine some ao ocultar");
  await desk.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Personalização"), null, { timeout: 10000 });
  check((await ana("/api/store/preferences")).showShowcase, false, "preferência de ocultar gravada");
  await go(desk, "characters", "#main *");
  ok(await desk.locator("#store-strip").isHidden(), "vitrine continua oculta em outra página");
  await ana("/api/store/preferences", "PUT", { showShowcase: true, useCampaignSystems: true, analyzeMessages: false, interestSystemId: null });

  // Celular: Loja no "Mais", barra inferior inalterada, vitrine com um produto e alvos de toque.
  const phone = await pageFor(ana, { mobile: true });
  await go(phone, "overview", '#store-strip[data-state="ready"] .store-strip-item');
  check(await visibleItems(phone), 1, "um produto no celular");
  check(await phone.locator(".sidebar nav .nav-primary").count(), 4, "barra inferior com os mesmos destinos principais");
  await phone.locator('[data-action="nav-more"]').click();
  ok(await phone.locator('#nav-more-panel a[href="#store"]').isVisible(), "Loja no menu Mais");
  const target = await phone.locator(".store-strip-offer").first().boundingBox();
  ok(target.height >= 44, "alvo de toque da oferta com 44 px");
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "sem transbordo no celular");
  await phone.locator('#nav-more-panel a[href="#store"]').click();
  await phone.locator(".store-card").first().waitFor();
  ok(!(await phone.locator("#store-filters-panel").evaluate((d) => d.open)), "filtros recolhidos no celular");
  await phone.locator("#store-filters-panel summary").click();
  ok(await phone.locator('#store-filters input[name="marketplace"]').first().isVisible(), "filtros abrem no celular");
  await phone.screenshot({ path: `${dir}/loja-celular.png` });

  // Painel admin › Loja.
  const board = await pageFor(admin);
  await go(board, "admin/store", ".sa-table tbody tr");
  check(await board.locator(".sa-table tbody tr").count(), 5, "produtos no painel (inclui rascunho)");
  await board.locator('[data-action="sa-new"]').first().click();
  await board.locator("#sa-url").fill("https://www.amazon.com.br/dp/B000TEST06?tag=eternnus-20");
  await board.locator('[data-action="sa-preview"]').click();
  await board.locator("#sa-preview-result .notice-box").waitFor();
  ok((await board.locator("#sa-preview-result").textContent()).includes("Amazon"), "prévia mostra a loja detectada");
  await board.locator("#sa-title").fill("Escudo do Mestre Tormenta20");
  await board.locator(`input[name="systemIds"][value="${t20.id}"]`).check();
  await board.locator("#sa-status-f").selectOption("active");
  await board.locator('#sa-product button[type="submit"]').click();
  await board.waitForFunction(() => [...document.querySelectorAll(".sa-table th")].some((th) => th.textContent.includes("Escudo do Mestre")), null, { timeout: 10000 });
  await go(board, "admin/store/categories", "#sa-body table");
  await go(board, "admin/store/settings", "#sa-settings");
  await board.locator('#sa-settings button[type="submit"]').click();
  await board.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Configurações da loja salvas"), null, { timeout: 10000 });
  await go(board, "admin/store/metrics", ".stat-grid");
  ok((await board.locator("#sa-body").textContent()).includes("CTR não é calculado"), "métricas sem CTR inventado");
  await board.screenshot({ path: `${dir}/admin-loja.png` });
  const metrics = await admin("/api/admin/store/metrics?days=30");
  ok(metrics.clicks.showcase >= 1 && metrics.clicks.detail >= 1, "cliques por superfície");
  check(metrics.impressionsTracked, false, "impressões não registradas");

  check(errors, [], "nenhum erro de JavaScript ou CSP");
  console.log(`ok: ${env.assertions?.() ?? "store-ui"} verificações`);
} finally {
  await browser?.close();
  await env.stop();
}
