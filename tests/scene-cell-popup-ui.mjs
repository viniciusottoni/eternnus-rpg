/**
 * Janela de ação no ponto (ADR-125) no editor de cenas, com PostgreSQL real: + (Adicionar), Foco de luz e o menu de
 * contexto abrem uma janela ao lado da casa clicada, nunca na barra lateral. Cobre criar marcador, Esc, clicar fora,
 * editar/remover luz, menu de contexto, desktop 1440×900 e celular 390×844 (folha inferior). Capturas em artifacts/qa-cell-popup.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5398, startupTimeoutMs: 120000 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const systemId = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-cell-popup");
await mkdir(shots, { recursive: true });
const browsers = [];
const errors = [];

async function newPage(master, viewport, { mobile = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce" });
  await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${viewport.width}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${viewport.width}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  await page.goto(env.origin + "/");
  await page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy") && !!document.querySelector("#app h1, #app h2"), null, { timeout: 20000 });
  return page;
}
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.checkVisibility(); }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() || "", sel);
const popOpen = (page) => page.evaluate(() => !!document.querySelector(".ed-pop"));
/** Ponto (coordenadas da janela) no centro da casa (cx, cy) do canvas do tabuleiro, 10 × 8 casas. */
async function cellPoint(page, fx, fy) {
  const box = await page.locator("#se-board").boundingBox();
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
const cellOf = async (page) => (await text(page, ".ed-pop .ed-props-head")).match(/coluna \d+, linha \d+/)?.[0] || "";
const inside = (b, p) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

try {
  const master = await env.verifiedClient("mestre.popup@example.test", "Mestre");
  const campaign = await master("/api/campaigns", "POST", { name: "Janela no ponto", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  let page = await newPage(master, { width: 1440, height: 900 });
  const map = await page.evaluate(async (cid) => {
    const { api } = await import("/js/api.js");
    const c = document.createElement("canvas"); c.width = 640; c.height = 512;
    const g = c.getContext("2d"); g.fillStyle = "#3a5a3a"; g.fillRect(0, 0, 640, 512);
    const file = await new Promise((r) => c.toBlob((b) => r(new File([b], "m.png", { type: "image/png" })), "image/png"));
    const fd = new FormData();
    fd.append("file", file); fd.append("name", "Ponte"); fd.append("gridPixels", "64"); fd.append("scaleMeters", "1.5"); fd.append("hasGrid", "true");
    return api(`/campaigns/${cid}/assets/maps`, "POST", fd);
  }, campaign.id);
  const scene = await master(`${path}/scenes`, "POST", { name: "Travessia", kind: "map", mapKey: map.key, sharedText: "", privateNotes: "", order: 0, layerMode: "scene" });
  const openScene = async (p) => {
    await p.evaluate(({ cid, sid }) => { import("/js/scene-editor.js").then(({ openSceneEditor }) => { void openSceneEditor({ campaign: { id: cid, name: "Janela no ponto" }, sceneId: sid }); }); }, { cid: campaign.id, sid: scene.id });
    await p.locator(".scene-editor").waitFor({ timeout: 20000 });
    await p.waitForFunction(() => document.querySelector("#se-board canvas")?.width > 0 || document.querySelector("#se-compose canvas"), null, { timeout: 20000 });
  };
  const toElements = async (p) => {
    await p.locator('.scene-editor [data-ed-context="elements"]').click();
    await p.waitForFunction(() => {
      const board = document.querySelector("#se-board");
      return document.querySelector(".scene-editor")?.dataset.context === "elements" && board?.checkVisibility() && /\d+ × \d+ casas/.test(document.querySelector(".ed-status")?.textContent || "");
    }, null, { timeout: 20000 }).catch(async (e) => {
      await p.screenshot({ path: join(shots, "fail-ctx.png") });
      console.log("DEBUG", await p.evaluate(() => { const img = document.querySelector("#se-board .board-image"); return JSON.stringify([document.querySelector(".scene-editor")?.dataset.context, !!img, img?.checkVisibility(), img?.complete, img?.naturalWidth, img?.src?.slice(0, 80), document.querySelector("#se-board")?.hidden]); }));
      throw e;
    });
  };

  await openScene(page);
  await toElements(page);
  await page.locator('.scene-editor .ed-tools [data-ed-tool="add"]').click();

  // + numa casa: janela ao lado da casa, nada de formulário na barra lateral.
  const p1 = await cellPoint(page, 0.38, 0.42);
  await page.mouse.click(p1.x, p1.y);
  await page.locator(".ed-pop").waitFor({ timeout: 5000 }).catch(async (e) => { console.log("DEBUG", JSON.stringify(p1), await page.evaluate(() => [document.querySelector(".scene-editor").dataset.tool, document.querySelector('[data-ed-tool="add"]').outerHTML.slice(0, 300), document.querySelector(".ed-status")?.textContent, document.querySelector("#toast")?.textContent].join(" || "))); await page.screenshot({ path: join(shots, "fail.png") }); throw e; });
  const c1 = await cellOf(page);
  ok(/^Adicionar aqui · coluna \d+, linha \d+/.test(await text(page, ".ed-pop .ed-props-head")), `título da janela com a casa (${c1})`);
  check(await page.locator(".ed-panels [data-add-marker]").count(), 0, "barra lateral sem formulário de adicionar");
  // O conteúdo termina de carregar depois de abrir; a janela se ajusta no quadro seguinte.
  await page.waitForFunction(() => { const r = document.querySelector(".ed-pop").getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.top >= 0 && r.left >= 0; }, null, { timeout: 3000 }).catch(() => {});
  const pop = await page.locator(".ed-pop").boundingBox();
  ok(!inside(pop, p1), `janela não cobre a casa clicada (${JSON.stringify(pop)} × ${JSON.stringify(p1)})`);
  ok(pop.x + pop.width <= 1440 && pop.y + pop.height <= 900 && pop.x >= 0 && pop.y >= 0, `janela dentro da tela ${JSON.stringify(pop)}`);
  ok(await page.waitForFunction(() => document.activeElement?.dataset.action === "se-add-new-slot", null, { timeout: 2000 }).then(() => true, () => false), "foco em + Novo personagem aqui");
  ok(await visible(page, ".ed-pop [data-add-marker]"), "marcador avulso também na janela");
  ok(await visible(page, ".ed-pop [data-pop-npcs]"), "personagens do mestre na janela");
  await page.screenshot({ path: join(shots, "01-adicionar-1440.png") });

  // Criar marcador pela janela.
  await page.locator("#se-a-label").fill("Guarda da ponte");
  await page.locator('.ed-pop [data-add-marker] button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector(".ed-pop"), null, { timeout: 5000 });
  ok(/Guarda da ponte/.test(await text(page, ".ed-panels")), "marcador criado e selecionado nas propriedades");

  // + Novo personagem aqui: cria o reservado e coloca na casa, sem passar pela lateral.
  const pn = await cellPoint(page, 0.5, 0.62);
  await page.mouse.click(pn.x, pn.y);
  await page.locator(".ed-pop").waitFor({ timeout: 5000 });
  await page.locator('.ed-pop [data-action="se-add-new-slot"]').click();
  await page.waitForFunction(() => !document.querySelector(".ed-pop"), null, { timeout: 15000 });
  const slots = await master(`${path}/party-slots`);
  check((slots.items || slots).length, 1, "reservado criado no servidor");
  ok(await page.evaluate(() => document.querySelectorAll('[data-panel="characters"] .se-slot.placed').length === 1), "reservado já colocado na cena");

  // Esc fecha; clicar fora fecha.
  const p2 = await cellPoint(page, 0.62, 0.25);
  await page.mouse.click(p2.x, p2.y);
  await page.locator(".ed-pop").waitFor({ timeout: 5000 });
  const c2 = await cellOf(page);
  await page.keyboard.press("Escape");
  ok(!(await popOpen(page)), "Esc fecha a janela");
  await page.mouse.click(p2.x, p2.y);
  await page.locator(".ed-pop").waitFor({ timeout: 5000 });
  await page.locator(".ed-panels [data-ed-side-name]").click();
  ok(!(await popOpen(page)), "clicar fora fecha a janela");
  // Clicar noutra casa com a janela aberta: reabre na nova casa (uma só janela).
  await page.mouse.click(p2.x, p2.y);
  await page.locator(".ed-pop").waitFor({ timeout: 5000 });
  const p3 = await cellPoint(page, 0.3, 0.75);
  await page.mouse.click(p3.x, p3.y);
  await page.waitForFunction((c) => { const t = document.querySelector(".ed-pop .ed-props-head")?.textContent || ""; return /coluna/.test(t) && !t.includes(c); }, c2, { timeout: 5000 });
  check(await page.locator(".ed-pop").count(), 1, "uma janela por vez");
  await page.keyboard.press("Escape");

  // Menu de contexto → Adicionar marcador aqui abre a janela.
  await page.locator('.scene-editor .ed-tools [data-ed-tool="select"]').click();
  await page.mouse.click(p2.x, p2.y, { button: "right" });
  await page.locator(".ed-menu").waitFor({ timeout: 5000 });
  await page.locator(".ed-menu .ed-menu-item", { hasText: "Adicionar marcador aqui" }).click();
  await page.locator(".ed-pop").waitFor({ timeout: 5000 });
  check(await cellOf(page), c2, "menu de contexto abre a janela na casa clicada");
  await page.keyboard.press("Escape");

  // Ferramentas básicas da esquerda (Texto, Visibilidade, Cenário) abrem em janela, ao lado do botão.
  await page.evaluate(() => document.querySelector('.scene-editor [data-ed-context="scene"]')?.click());
  await page.waitForFunction(() => document.querySelector(".scene-editor")?.dataset.context === "scene");
  await page.locator('.scene-editor .ed-tools [data-ed-tool="text"]').click();
  await page.locator(".ed-pop #se-shared").waitFor({ timeout: 5000 });
  check(await page.locator(".ed-panels #se-shared").count(), 0, "texto compartilhável fora da lateral");
  const tb = await page.locator('.scene-editor .ed-tools [data-ed-tool="text"]').boundingBox(), tp = await page.locator(".ed-pop").boundingBox();
  ok(tp.x >= tb.x + tb.width, "janela abre ao lado do botão da ferramenta");
  await page.locator(".ed-pop #se-shared").fill("Uma ponte velha range sob o vento.");
  await page.keyboard.press("Escape");
  ok(!(await popOpen(page)), "Esc fecha o texto");
  await page.locator('.scene-editor .ed-tools [data-ed-tool="text"]').click();
  await page.locator(".ed-pop #se-shared").waitFor({ timeout: 5000 });
  check(await page.locator(".ed-pop #se-shared").inputValue(), "Uma ponte velha range sob o vento.", "texto digitado continua no rascunho");
  // O título do painel vira o título da janela (sem repetir dentro do corpo); a ajuda ⓘ, quando há, vai junto.
  ok(/Texto compartilhável/.test(await text(page, ".ed-pop .ed-props-head h3")) && await page.locator(".ed-pop .ed-pop-body h3").count() === 0, "título do painel no cabeçalho da janela");
  await page.keyboard.press("Escape");
  await page.locator('.scene-editor .ed-tools [data-ed-tool="scenery"]').click();
  await page.locator(".ed-pop .se-scenery, .ed-pop #se-picker").first().waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelector(".ed-pop #se-picker")?.children.length > 0, null, { timeout: 10000 });
  ok(true, "escolher cenário em janela, com a lista de mapas");
  await page.screenshot({ path: join(shots, "02-cenario-1440.png") });
  await page.keyboard.press("Escape");
  ok(!(await popOpen(page)), "Esc fecha o cenário");

  // Foco de luz: criar, reabrir para editar e remover, tudo na janela.
  // Luz e marcas ficam na interface Completa.
  await page.locator('.scene-editor [data-interface-toggle] input[value="complete"]').check({ force: true });
  await page.waitForFunction(() => document.querySelector('.scene-editor [data-interface-toggle] input[value="complete"]')?.checked);
  await page.locator('.scene-editor [data-ed-context="light"]').click();
  await page.waitForFunction(() => document.querySelector(".scene-editor")?.dataset.context === "light");
  await page.locator('.scene-editor .ed-tools [data-ed-tool="light"]').click();
  const pl = await cellPoint(page, 0.7, 0.55);
  await page.mouse.click(pl.x, pl.y);
  await page.locator(".ed-pop [data-light-form]").waitFor({ timeout: 5000 }).catch(async (e) => { console.log("DEBUG", await page.evaluate(() => [document.querySelector(".scene-editor").dataset.tool, document.querySelector("#toast")?.textContent, document.querySelector(".ed-status")?.textContent.slice(0, 200), document.querySelector(".ed-pop")?.textContent.slice(0, 100)].join(" || "))); await page.screenshot({ path: join(shots, "fail-light.png") }); throw e; });
  ok(/Foco de luz · coluna \d+, linha \d+/.test(await text(page, ".ed-pop .ed-props-head")), "janela de luz com a casa");
  check(await page.locator(".ed-panels [data-light-form]").count(), 0, "barra lateral sem formulário de luz");
  await page.screenshot({ path: join(shots, "03-luz-1440.png") });
  await page.locator('.ed-pop [data-light-form] button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector(".ed-pop"), null, { timeout: 5000 });
  await page.mouse.click(pl.x, pl.y);
  await page.locator(".ed-pop [data-light-form]").waitFor({ timeout: 5000 });
  check(await text(page, '.ed-pop [data-light-form] button[type="submit"]'), "Atualizar", "reabrir mostra a luz existente");
  await page.locator('.ed-pop [data-action="se-light-remove"]').click();
  await page.waitForFunction(() => !document.querySelector(".ed-pop"), null, { timeout: 5000 });
  ok(true, "remover luz fecha a janela");

  // Celular: a janela vira folha inferior, dentro da tela, sem cobrir a casa tocada.
  const m = await newPage(master, { width: 390, height: 844 }, { mobile: true });
  await openScene(m);
  await toElements(m);
  await m.locator('.scene-editor .ed-tools [data-ed-tool="add"]').click();
  const tap = await cellPoint(m, 0.5, 0.2);
  await m.touchscreen.tap(tap.x, tap.y);
  await m.locator(".ed-pop").waitFor({ timeout: 5000 });
  const sheet = await m.locator(".ed-pop").boundingBox();
  ok(sheet.x >= 0 && sheet.x + sheet.width <= 390 && sheet.y + sheet.height <= 844, `celular: janela dentro da tela (${JSON.stringify(sheet)})`);
  ok(sheet.y > 844 / 3, "celular: folha na parte de baixo");
  const close = await m.locator('.ed-pop [data-pop="close"]').boundingBox();
  ok(close.width >= 24 && close.height >= 24, "celular: botão fechar visível");
  await m.screenshot({ path: join(shots, "04-adicionar-celular.png") });
  await m.locator('.ed-pop [data-pop="close"]').tap();
  ok(!(await popOpen(m)), "celular: fechar a janela");

  // Celular deitado: topo em duas linhas e ferramentas na coluna esquerda; o mapa fica com a altura.
  const l = await newPage(master, { width: 844, height: 390 }, { mobile: true });
  await openScene(l);
  const stage = await l.locator(".scene-editor .ed-stage").boundingBox();
  ok(stage.height >= 200, `deitado: mapa com ${Math.round(stage.height)} px de altura`);
  const closeBtn = await l.locator('.scene-editor [data-ed="close"]').boundingBox(), name = await l.locator("#se-name").boundingBox();
  ok(closeBtn.x + closeBtn.width <= 844 && closeBtn.y >= 0, "deitado: Fechar à vista");
  ok(name.x >= 0, "deitado: nome da cena alcançável");
  const tools = await l.locator(".scene-editor .ed-tools").boundingBox();
  ok(tools.height > tools.width, "deitado: ferramentas em coluna à esquerda");
  await l.screenshot({ path: join(shots, "05-deitado.png") });

  check(errors, [], "sem erros de página");
  console.log(`scene-cell-popup-ui: ${env.count()} verificações passaram.`);
} catch (error) {
  console.error(error);
  console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
