/**
 * Dicas do editor (ADR-124) no navegador, com PostgreSQL real: a barra de propriedades vazia mostra dicas do contexto,
 * da interface e do nível; anterior/próxima; Experimentar ativa a ferramenta; troca periódica com pausa no ponteiro;
 * seleção esconde e desmarcar traz de volta; Busca de ações; sinais só no localStorage; celular 390×844.
 * Capturas em artifacts/qa-tips.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5398, startupTimeoutMs: 180000 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const systemId = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-tips");
await mkdir(shots, { recursive: true });
const browsers = [];
const errors = [];

async function newPage(master, viewport, { mobile = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce" });
  await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page = await context.newPage();
  await page.clock.install();
  page.on("pageerror", (e) => errors.push(`${viewport.width}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${viewport.width}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  await page.goto(env.origin + "/");
  await page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy") && !!document.querySelector("#app h1, #app h2"), null, { timeout: 20000 });
  return page;
}
const tipId = (page) => page.evaluate(() => document.querySelector("[data-ed-tips]")?.dataset.edTipId || "");
const tipText = (page) => page.evaluate(() => document.querySelector("[data-ed-tip-text]")?.textContent || "");
const waitTip = (page) => page.waitForFunction(() => !!document.querySelector("[data-ed-tips]")?.dataset.edTipId, null, { timeout: 15000 });
const catalog = (page, file) => page.evaluate(async (f) => {
  const [a, b] = await Promise.all([import("/js/editor-tips/comum.js"), import(`/js/editor-tips/${f}.js`)]);
  return Object.fromEntries([...a.TIPS, ...b.TIPS].map((t) => [t.id, { ctx: t.ctx, ui: t.ui || "", tool: t.tool || "", act: t.act !== false, level: t.level }]));
}, file);
const next = (page) => page.locator('[data-ed-tip="next"]').click();

try {
  const master = await env.verifiedClient("mestre.dicas@example.test", "Mestre");
  const campaign = await master("/api/campaigns", "POST", { name: "Dicas do editor", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  let page = await newPage(master, { width: 1440, height: 900 });
  const ids = await page.evaluate(async (cid) => {
    const { api } = await import("/js/api.js");
    const c = document.createElement("canvas"); c.width = 640; c.height = 512;
    const g = c.getContext("2d"); g.fillStyle = "#3a5a3a"; g.fillRect(0, 0, 640, 512);
    const file = await new Promise((r) => c.toBlob((b) => r(new File([b], "m.png", { type: "image/png" })), "image/png"));
    const fd = new FormData();
    fd.append("file", file); fd.append("name", "Salão"); fd.append("gridPixels", "64"); fd.append("scaleMeters", "1.5"); fd.append("hasGrid", "true");
    return { salao: await api(`/campaigns/${cid}/assets/maps`, "POST", fd) };
  }, campaign.id);
  ok(ids.salao.id, "mapa enviado");
  const scene = await master(`${path}/scenes`, "POST", { name: "Salão do trono", kind: "map", mapKey: ids.salao.key, sharedText: "", privateNotes: "", order: 0, layerMode: "scene" });
  const scenes = await catalog(page, "cena");

  const openScene = async (p) => {
    await p.evaluate(({ cid, sid }) => { import("/js/scene-editor.js").then(({ openSceneEditor }) => { void openSceneEditor({ campaign: { id: cid, name: "Dicas do editor" }, sceneId: sid }); }); }, { cid: campaign.id, sid: scene.id });
    await p.locator(".scene-editor").waitFor({ timeout: 20000 });
    await waitTip(p);
  };
  const setInterface = (p, mode) => p.evaluate(async (m) => { const { setInterfaceMode } = await import("/js/interface-mode.js"); setInterfaceMode(m); }, mode);
  const setContext = async (p, id) => {
    await p.evaluate((c) => document.querySelector(`.scene-editor [data-ed-context="${c}"]`)?.click(), id);
    await p.waitForFunction((c) => document.querySelector(".ed-shell")?.dataset.context === c, id);
  };

  // ---------- Primeiro contato: Básica, nível 1 ----------
  await setInterface(page, "basic");
  await openScene(page);
  const first = await tipId(page);
  ok(scenes[first], `dica do catálogo na faixa vazia: ${first}`);
  check(scenes[first].level, 1, "primeiro contato recebe dica de nível 1");
  ok(/Dica/.test(await page.locator(".ed-tip-label").textContent()), "rótulo Dica visível");
  check(await page.evaluate(async () => (await import("/js/help-policy.js")).HELP_KEYS["campanhas.editor.dicas"]), "master", "ajuda das dicas registrada para o mestre");
  ok(await page.locator(".ed-tip .help-button").count() === await page.locator(".ed-tip-label .help-button").count(), "ⓘ das dicas, quando visível, fica junto ao rótulo");
  ok(await page.locator('[data-ed-tip="prev"]').isDisabled(), "anterior indisponível na primeira dica");
  check(await page.locator(".ed-tip .help-disabled-reason").count(), 0, "sem texto de motivo sobrando na faixa");
  await page.screenshot({ path: join(shots, "cena-1440-basica.png") });

  // Básica nunca mostra dica só da Completa; contexto sempre o atual ou geral.
  const seenBasic = [first];
  for (let i = 0; i < 40; i++) { await next(page); seenBasic.push(await tipId(page)); }
  const ctx = await page.evaluate(() => document.querySelector(".ed-shell").dataset.context);
  ok(seenBasic.every((id) => scenes[id] && scenes[id].ui !== "complete"), `Básica sem dicas da Completa: ${seenBasic.filter((id) => scenes[id]?.ui === "complete")}`);
  ok(seenBasic.every((id) => scenes[id].ctx === "*" || scenes[id].ctx === ctx), "dicas do contexto atual ou gerais");
  ok(seenBasic.every((id) => scenes[id].level === 1), "nível 1 enquanto o mestre está começando");
  ok(new Set(seenBasic.slice(0, 20)).size >= 18, "as 20 primeiras quase não se repetem");

  // Anterior e próxima percorrem o caminho.
  const last = await tipId(page);
  await page.locator('[data-ed-tip="prev"]').click();
  check(await tipId(page), seenBasic[seenBasic.length - 2], "anterior volta à dica anterior");
  await next(page);
  check(await tipId(page), last, "próxima volta à dica seguinte já vista");

  // ---------- Completa e contexto Paredes ----------
  await setInterface(page, "complete");
  await setContext(page, "walls");
  await waitTip(page);
  const wallTips = [await tipId(page)];
  for (let i = 0; i < 15; i++) { await next(page); wallTips.push(await tipId(page)); }
  ok(wallTips.every((id) => ["walls", "*"].includes(scenes[id].ctx)), `Paredes: só dicas de paredes ou gerais (${wallTips.join(",")})`);
  ok(wallTips.some((id) => scenes[id].ctx === "walls"), "Paredes: dicas próprias do contexto aparecem");

  // Experimentar ativa a ferramenta citada.
  let tried = "";
  for (let i = 0; i < 40 && !tried; i++) {
    if (await page.locator('[data-ed-tip="try"]').count()) {
      const id = await tipId(page);
      await page.locator('[data-ed-tip="try"]').click();
      tried = scenes[id].tool;
    } else await next(page);
  }
  ok(tried, "alguma dica de Paredes oferece Experimentar");
  if (!["wall", "blockMove", "blockLight", "door", "toggleDoor", "erase", "vwall", "vedit"].includes(tried)) ok(true, `ferramenta de ação: ${tried}`);
  else await page.waitForFunction((t) => document.querySelector(`.ed-tool[data-ed-tool="${t}"]`)?.getAttribute("aria-pressed") === "true" || document.querySelector(".scene-editor")?.dataset.tool === t, tried, { timeout: 5000 });
  ok(true, `Experimentar ativou ${tried}`);

  // ---------- Troca periódica e pausa ----------
  await setContext(page, "light");
  await waitTip(page);
  await page.mouse.move(700, 600);
  const before = await tipId(page);
  await page.clock.fastForward(31000);
  await page.waitForFunction((b) => document.querySelector("[data-ed-tips]")?.dataset.edTipId !== b, before, { timeout: 5000 });
  ok(true, "a dica troca sozinha depois de 30 s");
  await page.locator("[data-ed-tip-text]").hover();
  const held = await tipId(page);
  await page.clock.fastForward(65000);
  check(await tipId(page), held, "com o ponteiro na barra, a dica não troca");
  await page.mouse.move(700, 600);
  await page.clock.fastForward(31000);
  await page.waitForFunction((b) => document.querySelector("[data-ed-tips]")?.dataset.edTipId !== b, held, { timeout: 5000 });
  ok(true, "ao sair da barra, a troca recomeça");

  // ---------- Busca de ações ----------
  const viaPalette = await tipId(page);
  await page.locator("[data-ed-tip-text]").click();
  await page.keyboard.press("Control+k");
  await page.locator(".command-palette input").fill("dica");
  await page.waitForFunction(() => [...document.querySelectorAll(".command-palette [role=option]")].some((o) => /Próxima dica/.test(o.textContent)));
  await page.keyboard.press("Enter");
  await page.waitForFunction((b) => document.querySelector("[data-ed-tips]")?.dataset.edTipId !== b, viaPalette, { timeout: 5000 });
  ok(true, "Busca de ações: Próxima dica do editor");

  // ---------- Sinais locais ----------
  const stored = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("eternnus.editor.tips.")); return k ? JSON.parse(localStorage.getItem(k)) : null; });
  ok(stored?.opens?.scene >= 1, "abertura do editor registrada no navegador");
  ok(Object.keys(stored.seen).length >= 40, "dicas vistas registradas");
  ok(stored.contexts.walls >= 1 && stored.contexts.light >= 1, "contextos visitados registrados");
  ok(tried ? stored.tools[tried] >= 1 : true, "ferramenta experimentada registrada");
  await page.screenshot({ path: join(shots, "cena-1440-completa.png") });
  await page.evaluate(() => document.querySelector('.ed-shell [data-ed="close"]').click());

  // ---------- Mapa de imagem: seleção esconde, desmarcar traz de volta ----------
  const images = await catalog(page, "imagem");
  await page.evaluate(({ cid, item }) => { import("/js/image-map-editor.js").then(({ openImageMapEditor }) => openImageMapEditor({ id: cid, name: "Dicas do editor" }, { item })); }, { cid: campaign.id, item: ids.salao });
  await page.locator(".im-editor").waitFor({ timeout: 20000 });
  await waitTip(page);
  ok(images[await tipId(page)], "mapa de imagem: dica do catálogo de imagem ou geral");
  ok(!(await tipId(page)).startsWith("c-"), "mapa de imagem não recebe dica de cena");
  await page.keyboard.press("Control+a");
  await page.waitForFunction(() => document.querySelector("[data-ed-contextbar]").dataset.empty === "false", null, { timeout: 5000 });
  check(await page.locator("[data-ed-tips]").count(), 0, "com seleção, a barra mostra propriedades, não dicas");
  await page.keyboard.press("Control+d");
  await waitTip(page);
  ok(true, "desmarcar traz a dica de volta");
  await page.evaluate(() => document.querySelector('.ed-shell [data-ed="close"]').click());

  // ---------- Celular ----------
  const phone = await newPage(master, { width: 390, height: 844 }, { mobile: true });
  await openScene(phone);
  check(await phone.locator(".ed-tip .help-disabled-reason").count(), 0, "celular: sem texto de motivo sobrando na faixa");
  const sizes = await phone.evaluate(() => [...document.querySelectorAll("[data-ed-tip='next'], [data-ed-tip='prev'], [data-ed-tip='try']")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  ok(sizes.length >= 2 && sizes.every(([w, h]) => w >= 44 && h >= 44), `alvos de toque das dicas com 44 px: ${JSON.stringify(sizes)}`);
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "sem rolagem horizontal da página");
  ok((await tipText(phone)).length > 10, "texto da dica legível no celular");
  await phone.screenshot({ path: join(shots, "cena-390.png") });

  check(errors, [], "sem erros no console");
  console.log(`editor-tips-ui: ${env.count()} verificações`);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
