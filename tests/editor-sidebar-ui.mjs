/**
 * Barra lateral dos editores (ADR-118) no navegador, com PostgreSQL real: mapa de imagem, cena e mapa de tiles.
 * Cobre cabeçalho, inspetor contextual, Organizar / Adicionar / Configurar, Histórico, árvore unificada (seleção
 * sincronizada, Ctrl/Shift, recolher, olho/cadeado, arrastar entre camadas e destino recusado, localizar), acervo com
 * busca preservada, personagens em três vistas (reservado criado, posicionado e vinculável), composição com
 * visibilidade para jogadores, salvar/reabrir, desfazer/refazer, Básica ↔ Completa, preferências persistentes e
 * layouts em 1440×900, 1366×768, tablet 820×1180 e celular 390×844. Capturas em artifacts/qa-sidebar.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5397 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const systemId = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-sidebar");
await mkdir(shots, { recursive: true });
const browsers = [];
const errors = [];

async function newPage(master, viewport, { mobile = false, coarse = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: mobile || coarse, isMobile: mobile, reducedMotion: "reduce" });
  await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${viewport.width}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${viewport.width}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  await page.goto(env.origin + "/");
  await page.waitForFunction(() => !!document.querySelector("#app, main"));
  await page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy") && !!document.querySelector("#app h1, #app h2"), null, { timeout: 20000 });
  return page;
}
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.checkVisibility(); }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, " ").trim() || "", sel);
const area = (page) => page.evaluate(() => document.querySelector(".ed-shell")?.dataset.area || "");
const tab = async (page, id) => {
  try { await page.locator(`.ed-shell [data-ed-area-tab="${id}"]`).click({ timeout: 4000 }); }
  catch (e) { await page.screenshot({ path: join(shots, `fail-${id}.png`) }); console.log("ERRS", errors.join(" || ")); console.log("DEBUG", await page.evaluate((id) => { const el = document.querySelector(`[data-ed-area-tab="${id}"]`); const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, el.checkVisibility(), document.querySelector(".ed-shell").dataset.panels, document.querySelector(".ed-shell").dataset.maximized, document.querySelectorAll(".ed-shell").length, el.closest("dialog")?.open].join(","); }, id)); throw e; }
};

try {
  const master = await env.verifiedClient("mestre.lateral@example.test", "Mestre");
  const campaign = await master("/api/campaigns", "POST", { name: "Lateral organizada", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  let page = await newPage(master, { width: 1440, height: 900 });

  // Mapas e imagens da campanha (PNG gerado no navegador).
  const ids = await page.evaluate(async (cid) => {
    const { api } = await import("/js/api.js");
    async function png(w, h, color) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h);
      return new Promise((r) => c.toBlob((b) => r(new File([b], "m.png", { type: "image/png" })), "image/png"));
    }
    async function map(name, w, h, color, grid = true) {
      const fd = new FormData();
      fd.append("file", await png(w, h, color)); fd.append("name", name); fd.append("gridPixels", "64"); fd.append("scaleMeters", "1.5"); fd.append("hasGrid", String(grid));
      return api(`/campaigns/${cid}/assets/maps`, "POST", fd);
    }
    return { salao: await map("Salão", 640, 512, "#3a5a3a"), estatua: await map("Estátua", 128, 96, "#8a7a5a", false) };
  }, campaign.id);
  ok(ids.salao.id && ids.estatua.id, "mapa e imagem enviados");

  // ---------- Mapa de imagem ----------
  const openImage = async (p = page) => {
    await p.evaluate(({ cid, item }) => { import("/js/image-map-editor.js").then(({ openImageMapEditor }) => openImageMapEditor({ id: cid, name: "Lateral organizada" }, { item })); }, { cid: campaign.id, item: ids.salao });
    await p.locator(".im-editor").waitFor({ timeout: 20000 });
    await p.waitForFunction(() => document.querySelector(".im-editor [data-ed-side-name]")?.textContent.length > 0, null, { timeout: 15000 });
  };
  await openImage();
  check(await text(page, "[data-ed-side-name]"), "Salão", "cabeçalho: nome do mapa");
  ok(/Mapa de imagem/.test(await text(page, "[data-ed-side-kind]")), "cabeçalho: tipo do documento");
  ok(await visible(page, '.ed-inspect [data-panel="quick"]'), "inspetor fixo no alto");
  ok(/Nada selecionado/.test(await text(page, '[data-panel-body="quick"]')), "inspetor sem seleção: resumo do documento");
  check(await page.locator(".ed-side-tabs [role=tab]").count(), 3, "três áreas principais");
  ok(await visible(page, '[data-ed-area-tab="history"]'), "Histórico como ação secundária");
  check(await area(page), "organize", "área inicial: Organizar");
  // Fixas sem a palavra "obrigatória"; alfinete discreto.
  ok(!/obrigatória/i.test(await text(page, '[data-panel-body="structure"]')), "camadas fixas sem rótulo repetido");
  check(await page.locator('[data-panel-body="structure"] .o-flag').count(), 2, "Base e Elementos marcadas como fixas");

  // Adicionar: busca e inserção; a busca sobrevive à troca de área.
  await tab(page, "add");
  check(await area(page), "add", "Adicionar ativo");
  await page.waitForFunction(() => !!document.querySelector('[data-panel-body="assets"] [data-asset-cat="maps"]'), null, { timeout: 15000 });
  ok(await visible(page, '[data-im-add="upload"]'), "enviar imagem visível sem rolagem");
  await page.locator("#im-asset-q").fill("Est");
  await tab(page, "organize"); await tab(page, "add");
  check(await page.locator("#im-asset-q").inputValue(), "Est", "busca preservada ao alternar área");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-ed-asset]")].some((li) => li.textContent.includes("Estátua")), null, { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll("[data-ed-asset]")].find((li) => li.textContent.includes("Estátua")).querySelector("[data-ed-asset-add]").click());
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-body="structure"] .o-item').length === 2, null, { timeout: 15000 });
  const inspText = await text(page, '[data-panel-body="quick"]');
  ok(/Imagem/.test(inspText) && /Largura/.test(inspText), `inspetor mostra a imagem inserida: ${inspText.slice(0, 80)}`);
  ok(await page.locator('[data-panel-body="quick"] input[name="ratio"]').isChecked(), "imagem: proporção preservada por padrão");
  // Manter proporção: largura dobra, altura acompanha.
  const w0 = Number(await page.locator('[data-panel-body="quick"] input[name="width"]').inputValue());
  const h0 = Number(await page.locator('[data-panel-body="quick"] input[name="height"]').inputValue());
  await page.locator('[data-panel-body="quick"] input[name="width"]').fill(String(w0 * 2));
  await page.locator('[data-panel-body="quick"] input[name="width"]').press("Enter");
  await page.locator('[data-panel-body="quick"] input[name="width"]').blur();
  await page.waitForFunction((h) => Number(document.querySelector('[data-panel-body="quick"] input[name="height"]').value) === h * 2, h0, { timeout: 5000 });
  ok(true, "altura acompanhou a largura (proporção)");

  // Duplicar → dois itens; árvore e canvas sincronizados.
  await page.keyboard.press("Control+j");
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-body="structure"] .o-item').length === 3, null, { timeout: 5000 });
  await tab(page, "organize");
  const items = page.locator('[data-panel-body="structure"] .o-item');
  await items.nth(1).click();
  check(await page.locator('[data-panel-body="structure"] .o-item.selected').count(), 1, "clique na árvore seleciona um");
  await items.nth(0).click({ modifiers: ["Control"] });
  check(await page.locator('[data-panel-body="structure"] .o-item.selected').count(), 2, "Ctrl+clique soma à seleção");
  ok(/2 elementos/.test(await text(page, '[data-panel-body="quick"]')), "inspetor de seleção múltipla");
  ok(await page.locator('[data-panel-body="quick"] input[name="width"]').count() === 0, "seleção múltipla sem campos incompatíveis");
  await items.nth(0).click();
  await items.nth(1).click({ modifiers: ["Shift"] });
  check(await page.locator('[data-panel-body="structure"] .o-item.selected').count(), 2, "Shift+clique seleciona intervalo");
  // Canvas → árvore: Ctrl+D desmarca, Ctrl+A no palco seleciona tudo e a árvore acompanha.
  await page.locator(".im-editor canvas").first().focus();
  await page.keyboard.press("Control+d");
  check(await page.locator('[data-panel-body="structure"] .o-item.selected').count(), 0, "desmarcar no palco limpa a árvore");
  await page.keyboard.press("Control+a");
  check(await page.locator('[data-panel-body="structure"] .o-item.selected').count(), 3, "selecionar no palco destaca na árvore");
  // Seleção não move a câmera; Localizar enquadra.
  const zoomBefore = await text(page, "[data-ed-zoom-label]");
  await items.nth(0).click();
  check(await text(page, "[data-ed-zoom-label]"), zoomBefore, "selecionar não muda o zoom");
  await items.nth(0).hover();
  await items.nth(0).locator('[data-o-item-act="locate"]').click();
  await page.waitForFunction((z) => document.querySelector("[data-ed-zoom-label]").textContent !== z, zoomBefore, { timeout: 5000 });
  ok(true, "Localizar no mapa enquadra o item");

  // Camada: olho (só editor), desfazer e refazer.
  const elementsRow = page.locator('[data-panel-body="structure"] [data-o-layer-id="elements"][data-o-row="layer"]');
  await elementsRow.locator('[data-o-layer="visible"]').click();
  check(await elementsRow.locator('[data-o-layer="visible"]').getAttribute("aria-pressed"), "true", "olho oculta a camada");
  ok(await page.locator('[data-panel-body="structure"] .o-item.is-hidden').count() === 2, "itens marcados como ocultos no editor");
  await page.locator(".im-editor canvas").first().focus();
  await page.keyboard.press("Control+z");
  check(await elementsRow.locator('[data-o-layer="visible"]').getAttribute("aria-pressed"), "false", "Ctrl+Z desfaz a visibilidade");
  await page.keyboard.press("Control+Shift+z");
  check(await elementsRow.locator('[data-o-layer="visible"]').getAttribute("aria-pressed"), "true", "Ctrl+Shift+Z refaz");
  await page.keyboard.press("Control+z");
  // Recolher e expandir a camada (preferência).
  await elementsRow.locator("[data-o-toggle]").click();
  check(await page.locator('[data-panel-body="structure"] .o-item[data-o-layer-id="elements"]').count(), 0, "camada recolhida esconde os itens");
  await elementsRow.locator("[data-o-toggle]").click();
  check(await page.locator('[data-panel-body="structure"] .o-item').count(), 3, "camada expandida mostra os itens");

  // Nova camada; arrastar um item para ela; destino bloqueado recusa.
  await page.locator('[data-panel-body="structure"] [data-o-action="add-layer"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-body="structure"] [data-o-row="layer"]').length === 3, null, { timeout: 5000 });
  const extra = await page.evaluate(() => document.querySelector('[data-panel-body="structure"] [data-o-row="layer"]').dataset.oLayerId);
  ok(extra && extra !== "elements", "nova camada no topo");
  ok(/Camada criada/.test(await text(page, "[data-ed-message]")), "feedback: camada criada");
  check(await page.locator('[data-panel-body="structure"] .o-layer-row.active').getAttribute("data-o-layer-id"), extra, "nova camada é a ativa");
  await page.locator(`[data-panel-body="structure"] [data-o-row="layer"][data-o-layer-id="${extra}"] .o-layer-name`).click();
  ok(/Camada extra/.test(await text(page, '[data-panel-body="quick"]')), "clicar na camada mostra o inspetor de camada");
  await items.nth(0).click();
  await page.locator('[data-panel-body="structure"] .o-item').nth(0).dragTo(page.locator(`[data-panel-body="structure"] [data-o-row="layer"][data-o-layer-id="${extra}"]`));
  await page.waitForFunction((id) => document.querySelectorAll(`[data-panel-body="structure"] .o-item[data-o-layer-id="${id}"]`).length === 1, extra, { timeout: 5000 });
  ok(true, "arrastar move o item para outra camada");
  await page.locator(`[data-panel-body="structure"] [data-o-row="layer"][data-o-layer-id="${extra}"] [data-o-layer="lock"]`).click();
  await page.locator('[data-panel-body="structure"] .o-item[data-o-layer-id="elements"]').first().click();
  await page.locator('[data-panel-body="structure"] .o-item[data-o-layer-id="elements"]').first().dragTo(page.locator(`[data-panel-body="structure"] [data-o-row="layer"][data-o-layer-id="${extra}"]`));
  check(await page.locator(`[data-panel-body="structure"] .o-item[data-o-layer-id="${extra}"]`).count(), 1, "camada bloqueada recusa o destino");

  // Configurar: documento.
  await tab(page, "configure");
  ok(/Área visível/.test(await text(page, '[data-panel-body="document"]')) && /Grade e escala/.test(await text(page, '[data-panel-body="document"]')), "Configurar mostra documento, grade e fundo");
  // Histórico secundário e volta.
  await tab(page, "history");
  check(await area(page), "history", "Histórico abre");
  ok(await page.locator('[data-panel-body="history"] [data-history]').count() > 3, "histórico lista as etapas");
  await tab(page, "history");
  check(await area(page), "configure", "Histórico fecha voltando à área anterior");

  // Básica ↔ Completa: seleção, área e alterações preservadas.
  await tab(page, "organize");
  await items.nth(0).click();
  const selBefore = await page.locator('[data-panel-body="structure"] .o-item.selected').count();
  await page.evaluate(() => import("/js/interface-mode.js").then((m) => m.setInterfaceMode("complete")));
  await page.waitForFunction(() => document.querySelector(".ed-shell").dataset.interface === "complete");
  check(await page.locator('[data-panel-body="structure"] .o-item.selected').count(), selBefore, "Completa mantém a seleção");
  ok(await page.locator('[data-panel-body="structure"] .o-opacity input').count() >= 3, "Completa mostra opacidade numérica");
  await page.evaluate(() => import("/js/interface-mode.js").then((m) => m.setInterfaceMode("basic")));
  await page.waitForFunction(() => document.querySelector(".ed-shell").dataset.interface === "basic");
  check(await area(page), "organize", "trocar de modo não muda a área");
  check(await page.locator('[data-panel-body="structure"] .o-item').count(), 3, "trocar de modo não descarta elementos");

  // Largura e altura do inspetor persistem; reabrir restaura a área.
  await page.locator("[data-ed-resizer]").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  const widthSet = Number(await page.locator("[data-ed-resizer]").getAttribute("aria-valuenow"));
  await page.locator("[data-ed-split]").focus();
  await page.keyboard.press("ArrowDown");
  const splitSet = await page.locator("[data-ed-split]").getAttribute("aria-valuenow");
  await tab(page, "add");
  await page.screenshot({ path: join(shots, "01-imagem-1440.png") });
  // Salvar e reabrir: elementos e camadas preservados.
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => /Salvo/.test(document.querySelector("[data-ed-side-chips]")?.textContent || ""), null, { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.ed-shell [data-ed="close"]').click());
  await page.waitForFunction(() => !document.querySelector("dialog.editor-modal[open]"));
  await openImage();
  check(await area(page), "add", "área ativa restaurada ao reabrir");
  check(Number(await page.locator("[data-ed-resizer]").getAttribute("aria-valuenow") || widthSet), widthSet, "largura da lateral restaurada");
  check(await page.locator("[data-ed-split]").getAttribute("aria-valuenow"), splitSet, "altura do inspetor restaurada");
  await tab(page, "organize");
  check(await page.locator('[data-panel-body="structure"] .o-item').count(), 3, "reabrir mantém os elementos salvos");
  check(await page.locator('[data-panel-body="structure"] [data-o-row="layer"]').count(), 3, "reabrir mantém a camada extra");
  await page.evaluate(() => document.querySelector('.ed-shell [data-ed="close"]').click());

  // ---------- Cena ----------
  const scene = await master(`${path}/scenes`, "POST", { name: "Salão do trono", kind: "map", mapKey: ids.salao.key, sharedText: "", privateNotes: "", order: 0, layerMode: "scene" });
  const mapBefore = await master(`${path}/assets/maps/${ids.salao.id}/composition`);
  const openScene = async (p = page) => {
    await p.evaluate(({ cid, sid }) => { import("/js/scene-editor.js").then(({ openSceneEditor }) => { void openSceneEditor({ campaign: { id: cid, name: "Lateral organizada" }, sceneId: sid }); }); }, { cid: campaign.id, sid: scene.id });
    await p.locator(".scene-editor").waitFor({ timeout: 20000 });
    await p.waitForFunction(() => document.querySelector("#se-board canvas")?.width > 0 || document.querySelector("#se-compose canvas"), null, { timeout: 20000 });
  };
  await openScene();
  await page.evaluate(() => document.querySelector('.scene-editor [data-ed-context="elements"]')?.click());
  await page.waitForFunction(() => document.querySelector(".scene-editor")?.dataset.context === "elements");
  check(await text(page, "[data-ed-side-name]"), "Salão do trono", "cena: nome no cabeçalho");
  ok(/Mapa: Salão/.test(await text(page, "[data-ed-side-origin]")), "cena: referência ao mapa original");
  await tab(page, "add");
  ok(await visible(page, '[data-panel="characters"] [data-action="se-slot-new"]'), "+ Personagem reservado à vista");
  ok(!(await visible(page, '.se-slot-archetypes .se-chip')), "arquétipos recolhidos por padrão");
  check(await page.locator('.se-char-views [data-action="se-char-view"]').count(), 3, "três vistas de personagens");
  check(await page.locator('.se-char-views [aria-pressed="true"]').getAttribute("data-id"), "reserved", "campanha sem jogadores abre em Reservados");
  await page.locator('.se-char-views [data-id="available"]').click();
  ok(/Nenhum jogador entrou/.test(await text(page, '[data-panel-body="characters"]')), "estado vazio: campanha sem jogadores");
  await page.locator('.se-char-views [data-id="scene"]').click();
  await page.locator('[data-panel="characters"] [data-action="se-slot-new"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-panel="characters"] .se-slot').length === 1, null, { timeout: 15000 });
  check(await page.locator('.se-char-views [aria-pressed="true"]').getAttribute("data-id"), "reserved", "criar leva à vista Reservados");
  await page.keyboard.press("Escape");
  await page.locator('[data-panel="characters"] .se-slot [data-action="se-place-cursor"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-panel="characters"] .se-slot.placed').length === 1, null, { timeout: 10000 });
  ok(true, "reservado posicionado na cena");
  await page.locator('.se-char-views [data-id="scene"]').click();
  check(await page.locator('[data-panel-body="characters"] [data-se-char-token]').count(), 1, "Em cena lista o posicionado");
  ok(/Remover posição/.test(await text(page, '[data-panel-body="characters"]')), "remover posição distinto de excluir personagem");
  // Organizar: o marcador aparece na camada; seleção sincronizada com o inspetor.
  await tab(page, "organize");
  const token = page.locator('[data-panel-body="structure"] [data-o-section="tokens"].o-item').first();
  await token.click();
  ok(/Oculto para os jogadores/.test(await text(page, '[data-panel-body="props"]')), "inspetor do marcador separa visibilidade para jogadores");
  ok(/Localizar no mapa/.test(await text(page, '[data-panel-body="props"]')), "inspetor oferece Localizar no mapa");
  ok(await visible(page, '[data-panel-body="structure"] [data-o-section="origin"] .o-ro-action'), "mapa de origem somente leitura com Abrir original");
  // Composição: imagem por cima, camada só do mestre (visibilidade para jogadores ≠ editor).
  await page.evaluate(() => document.querySelector('.scene-editor [data-ed-context="compose"]')?.click());
  await page.waitForFunction(() => document.querySelector(".scene-editor")?.dataset.context === "compose");
  await tab(page, "add");
  await page.waitForFunction(() => !!document.querySelector('[data-action="se-quick-cat"][data-id="images"]'), null, { timeout: 15000 });
  ok(!(await page.locator('[data-action="se-quick-cat"][data-id="party"]').count()), "acervo sem lista concorrente de personagens");
  await page.evaluate(() => document.querySelector('[data-action="se-quick-cat"][data-id="images"]').click());
  await page.waitForFunction(() => [...document.querySelectorAll("[data-ed-asset]")].some((li) => li.textContent.includes("Estátua")), null, { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll("[data-ed-asset]")].find((li) => li.textContent.includes("Estátua")).querySelector("[data-ed-asset-add]").click());
  await tab(page, "organize");
  await page.waitForFunction(() => document.querySelectorAll('[data-panel-body="structure"] .o-item[data-o-section="comp"]').length === 1, null, { timeout: 15000 });
  const compElements = page.locator('[data-panel-body="structure"] [data-o-row="layer"][data-o-section="comp"][data-o-layer-id="elements"]');
  await compElements.locator('[data-o-layer="players"]').click();
  check(await compElements.locator('[data-o-layer="players"]').getAttribute("aria-pressed"), "true", "camada da composição só para o mestre");
  ok(/Mestre/.test(await text(page, '[data-panel-body="structure"] .o-item[data-o-section="comp"]')), "item herda o selo de só o mestre");
  check(await compElements.locator('[data-o-layer="visible"]').getAttribute("aria-pressed"), "false", "visível no editor continua independente");
  await page.screenshot({ path: join(shots, "02-cena-1440.png") });
  // Configurar: mapa original, composição e preparação separados.
  await tab(page, "configure");
  const cfg = await text(page, '[data-panel-body="config"]');
  ok(/Mapa de origem/.test(cfg) && /Composição desta cena/.test(cfg) && /Preparação do mapa/.test(cfg), "Configurar separa original, composição e preparação");
  ok(/Área de entrada/.test(cfg), "área de entrada em Configurar");
  // Salvar a cena não altera o mapa original; alterações privadas não vão à mesa.
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => /Salvo/.test(document.querySelector("[data-ed-side-chips]")?.textContent || ""), null, { timeout: 20000 });
  const mapAfter = await master(`${path}/assets/maps/${ids.salao.id}/composition`);
  check(JSON.stringify(mapAfter.composition), JSON.stringify(mapBefore.composition), "mapa original intacto ao editar a cena");
  const savedScene = await master(`${path}/scenes/${scene.id}`);
  check((savedScene.prepared || savedScene.scene?.prepared || []).length, 1, "posição do reservado salva");
  ok(!(await master(`${path}/sessions/active`).catch(() => null))?.id, "nenhuma sessão aberta pela preparação");
  // Ensaiar e sair sem erro.
  await page.evaluate(() => document.querySelector('.scene-editor [data-ed-context="elements"]')?.click());
  await page.locator('[data-action="se-preview"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="se-preview"]').getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
  ok(/Ensaio/.test(await text(page, "[data-ed-side-chips]")), "ensaio sinalizado no cabeçalho");
  await page.locator('[data-action="se-preview"]').click();
  await page.evaluate(() => document.querySelector('.ed-shell [data-ed="close"]').click());
  await page.waitForFunction(() => !document.querySelector("dialog.editor-modal[open]"));

  // ---------- Mapa de tiles ----------
  await page.evaluate(({ cid }) => { import("/js/tile-map-editor.js").then(({ openTileMapEditor }) => openTileMapEditor({ id: cid, name: "Lateral organizada" }, {})); }, { cid: campaign.id });
  await page.locator(".ed-shell[data-kind=tiles]").waitFor({ timeout: 20000 });
  check(await page.locator(".ed-side-tabs [role=tab]").count(), 3, "tiles: três áreas");
  check(await page.locator('[data-panel-body="layers"] [data-o-row="layer"]').count(), 2, "tiles: Base e Elementos na árvore");
  ok(!(await page.locator(".ed-inspect").count()), "tiles sem inspetor (sem objetos selecionáveis)");
  const baseRow = page.locator('[data-panel-body="layers"] [data-o-layer-id="base"]');
  await tab(page, "organize");
  await baseRow.locator('[data-o-layer="visible"]').click();
  check(await baseRow.locator('[data-o-layer="visible"]').getAttribute("aria-pressed"), "true", "tiles: ocultar a Base no editor");
  await page.screenshot({ path: join(shots, "03-tiles-1440.png") });
  await page.evaluate(() => document.querySelector('.ed-shell [data-ed="close"]').click());

  // ---------- Mesa ao vivo: mesmas abas da lateral dos editores ----------
  const session = await master(`${path}/sessions`, "POST", { title: "Noite no salão", objective: "", mapKind: "tileset", mapKey: "tavern" });
  await master(`/api/sessions/${session.id}/join`, "POST", {}, 204);
  await page.goto(`${env.origin}/#table/${campaign.id}`);
  await page.locator("#tab-chat").waitFor({ timeout: 20000 });
  ok(await page.evaluate(() => !!document.querySelector(".side-panel > .ed-side-nav > .panel-tabs.ed-side-tabs") && document.querySelectorAll("#t-tabs .ed-side-tab").length >= 3), "mesa: abas no padrão da lateral");
  const look = await page.evaluate(() => { const a = getComputedStyle(document.querySelector('#t-tabs [aria-selected="true"]')), b = getComputedStyle(document.querySelector('#t-tabs [aria-selected="false"]')); return [a.boxShadow.includes("inset"), a.color !== b.color]; });
  ok(look[0] && look[1], "mesa: aba ativa com a mesma linha dourada");
  await page.locator("#tab-rolls").click();
  check(await page.locator("#tab-rolls").getAttribute("aria-selected"), "true", "mesa: trocar de aba");
  await page.locator("#tab-rolls").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement.id !== "tab-rolls", null, { timeout: 5000 });
  ok(true, "mesa: setas trocam a aba e mantêm o foco");
  await page.screenshot({ path: join(shots, "05-mesa-1440.png") });

  // ---------- Notebook, tablet e celular ----------
  for (const [label, viewport, opts] of [["1366", { width: 1366, height: 768 }, {}], ["tablet", { width: 820, height: 1180 }, { coarse: true }], ["mobile", { width: 390, height: 844 }, { mobile: true }]]) {
    const p = await newPage(master, viewport, opts);
    await openScene(p);
    const narrow = viewport.width <= 900;
    if (narrow) {
      check(await p.evaluate(() => document.querySelector(".ed-shell").dataset.panels), "closed", `${label}: lateral fechada ao abrir`);
      await p.locator('.ed-top [data-ed="panels"]').click();
      ok(await visible(p, ".ed-side-close"), `${label}: botão fechar a lateral`);
      const box = await p.locator(".ed-side-tab").first().boundingBox();
      ok(box.height >= 44, `${label}: abas com alvo de toque ≥ 44 px (${box.height})`);
    }
    const side = await p.locator(".ed-panels").boundingBox();
    ok(side.width <= viewport.width, `${label}: lateral cabe na largura`);
    const overflow = await p.evaluate(() => [...document.querySelectorAll(".ed-panels *")].some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "auto"));
    ok(!overflow, `${label}: sem rolagem horizontal na lateral`);
    await tab(p, "organize");
    ok(await p.locator('[data-panel-body="structure"] .o-item').count() >= 1, `${label}: árvore com o marcador salvo`);
    await p.screenshot({ path: join(shots, `04-cena-${label}.png`) });
    if (narrow) { await p.locator(".ed-side-close").click(); check(await p.evaluate(() => document.querySelector(".ed-shell").dataset.panels), "closed", `${label}: fechar devolve o mapa`); }
  }
  check(errors, [], "sem erros de página");
  console.log(`editor-sidebar-ui: ${env.count()} verificações passaram.`);
} catch (error) {
  console.error(error);
  console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
