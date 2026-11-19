/**
 * Navegador (PostgreSQL real): mapas da campanha inseridos numa cena (ADR-113), envio de imagem com bandeja de andamento
 * e o assistente de grade com prévia do impacto (P1.2/P1.4). Capturas em artifacts/qa-map-instances.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5389 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const systemId = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-map-instances");
await mkdir(shots, { recursive: true });
let browser;
const errors = [];
try {
  const master = await env.verifiedClient("mestre.instancias@example.test", "Mestre");
  const campaign = await master("/api/campaigns", "POST", { name: "Masmorras unidas", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(env.origin + "/");
  await page.waitForFunction(() => !!document.querySelector("#app, main"));

  // Mapas enviados pelo próprio navegador (PNG gerado no canvas): fundo 640 × 640 (10 × 10 casas de 64 px) e dois
  // mapas menores com casa de 32 px (escala 2× ao inserir).
  const ids = await page.evaluate(async (cid) => {
    const { api } = await import("/js/api.js");
    async function png(w, h, color) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#000"; for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, h); g.stroke(); }
      return new Promise((r) => c.toBlob((b) => r(new File([b], "m.png", { type: "image/png" })), "image/png"));
    }
    async function map(name, w, h, grid, color) {
      const fd = new FormData();
      fd.append("file", await png(w, h, color)); fd.append("name", name); fd.append("gridPixels", String(grid)); fd.append("scaleMeters", "1.5"); fd.append("hasGrid", "true");
      return api(`/campaigns/${cid}/assets/maps`, "POST", fd);
    }
    const base = await map("Salão", 640, 640, 64, "#3a5a3a");
    const crypt = await map("Cripta", 160, 96, 32, "#5a3a3a");
    const tower = await map("Torre", 96, 96, 32, "#3a3a5a");
    return { base, crypt, tower };
  }, campaign.id);
  ok(ids.base.id && ids.crypt.id && ids.tower.id, "três mapas com grade enviados");
  // Uma parede no mapa Cripta para trazer depois.
  const cryptLayer = await master(`${path}/assets/layers?key=${encodeURIComponent(ids.crypt.key)}`);
  await master(`${path}/assets/layers?key=${encodeURIComponent(ids.crypt.key)}`, "PUT", { fog: true, cells: cryptLayer.cells, lights: [{ id: "l1", x: 1, y: 1, radius: 2 }], revealed: "", marks: [], revision: cryptLayer.revision, walls: [{ id: "w1", x1: 0, y1: 0, x2: 500, y2: 0, kind: "wall" }] });
  const scene = await master(`${path}/scenes`, "POST", { name: "Complexo", kind: "map", mapKey: ids.base.key, sharedText: "", privateNotes: "", order: 0, layerMode: "scene" });

  async function openEditor() {
    await page.evaluate(({ cid, sid }) => { import("/js/scene-editor.js").then(({ openSceneEditor }) => { void openSceneEditor({ campaign: { id: cid, name: "Masmorras unidas" }, sceneId: sid }); }); }, { cid: campaign.id, sid: scene.id });
    await page.locator(".scene-editor").waitFor();
    // Acervo rápido (painel de categorias): a categoria Mapas lista os mapas da campanha.
    await page.waitForFunction(() => !!document.querySelector('[data-action="se-quick-cat"][data-id="maps"]'), null, { timeout: 15000 });
    await page.evaluate(() => document.querySelector('[data-action="se-quick-cat"][data-id="maps"]').click());
    await page.waitForFunction(() => !!document.querySelector("[data-ed-asset-add]"), null, { timeout: 15000 });
  }
  const addFromAcervo = (name) => page.evaluate((n) => { const li = [...document.querySelectorAll("[data-ed-asset]")].find((x) => x.textContent.includes(n)); li.querySelector("[data-ed-asset-add]").click(); }, name);
  await openEditor();
  // Acervo: mapa com grade entra como mapa inserido, encaixado; dois lado a lado.
  await addFromAcervo("Cripta");
  await page.waitForFunction(() => /inserido na grade/.test(document.querySelector(".scene-editor")?.textContent || ""), null, { timeout: 10000 });
  await page.locator("#se-compose canvas").first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft"); // anda de casa em casa
  await addFromAcervo("Torre");
  await page.locator("#se-compose canvas").first().focus();
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: join(shots, "01-dois-mapas.png") });

  // Envio por soltura: arquivo PNG solto no palco aparece com a bandeja de andamento e fica selecionado.
  const stage = await page.evaluate(() => { const r = document.querySelector("#se-compose").getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3 }; });
  await page.evaluate(async (p) => {
    const c = document.createElement("canvas"); c.width = 96; c.height = 96;
    const g = c.getContext("2d"); g.fillStyle = "rgba(200,40,40,.5)"; g.fillRect(0, 0, 96, 96);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "tocha.png", { type: "image/png" }));
    const host = document.querySelector("#se-compose").closest(".ed-stage") || document.querySelector("#se-compose").parentElement;
    const at = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, dataTransfer: dt };
    host.dispatchEvent(new DragEvent("dragover", at));
    window.__dropHighlight = !document.querySelector(".ed-drop")?.hidden;
    host.dispatchEvent(new DragEvent("drop", at));
  }, stage);
  check(await page.evaluate(() => window.__dropHighlight), true);
  await page.locator(".ed-uploads .ed-upload").first().waitFor();
  await page.locator(".ed-upload.done, .ed-upload.error").first().waitFor({ timeout: 15000 });
  check(await page.locator(".ed-upload").first().getAttribute("class"), "ed-upload done", await page.locator(".ed-uploads").textContent());
  await page.screenshot({ path: join(shots, "02-envio.png") });

  // Trazer paredes e luzes do mapa Cripta (camada própria da cena): seleciona a instância e usa a ação.
  // Menu Cena › Selecionar próximo mapa inserido (a imagem solta estava selecionada).
  await page.locator("[data-ed-menubar] [data-ed-menu]", { hasText: "Cena" }).click();
  await page.getByRole("menuitem", { name: "Selecionar próximo mapa inserido" }).click();
  await page.waitForFunction(() => /Original: Cripta/.test(document.querySelector(".se-instance")?.textContent || ""), null, { timeout: 10000 });
  await page.evaluate(() => document.querySelector(".se-instance [data-action='se-comp'][data-id='importRules']").click());
  await page.waitForFunction(() => /Trazido de “Cripta”/.test(document.querySelector(".scene-editor")?.textContent || ""), null, { timeout: 10000 });
  await page.screenshot({ path: join(shots, "02b-regras.png") });

  // Salvar e conferir no servidor: instâncias com mapKey, encaixadas na grade (64 px) e com escala 2×.
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => /salv/i.test(document.querySelector(".scene-editor")?.textContent || ""), null, { timeout: 15000 });
  let stored = null;
  for (let i = 0; i < 30 && !stored?.composition?.elements?.some((e) => e.mapKey); i++) { await new Promise((r) => setTimeout(r, 300)); stored = await master(`${path}/scenes/${scene.id}`); }
  const inst = stored.composition.elements.filter((e) => e.mapKey);
  check(inst.length, 2);
  check(inst.map((e) => e.mapKey).sort(), [ids.crypt.key, ids.tower.key].sort());
  const crypt = inst.find((e) => e.mapKey === ids.crypt.key), tower = inst.find((e) => e.mapKey === ids.tower.key);
  check([crypt.width, crypt.height, tower.width, tower.height], [320, 192, 192, 192]);
  ok(inst.every((e) => e.x % 64 === 0 && e.y % 64 === 0 && e.rotation === 0), `instâncias nas linhas da grade: ${JSON.stringify(inst.map((e) => [e.x, e.y]))}`);
  ok(stored.composition.elements.some((e) => !e.mapKey && e.type === "image"), "imagem solta guardada como imagem comum");
  ok(stored.overlayId, "camada achatada enviada para a mesa");
  // Regras trazidas: parede (5 casas do original = 10 casas da cena, cortada na borda se preciso) e luz, só na camada da cena.
  const own = await master(`${path}/assets/layers?key=${encodeURIComponent(ids.base.key)}&scene=${scene.id}`);
  const ox = crypt.x / 64, oy = crypt.y / 64;
  ok(own.walls.some((w) => w.y1 === oy * 100 && w.y2 === oy * 100 && Math.min(w.x1, w.x2) === ox * 100), `parede convertida: ${JSON.stringify(own.walls)} origem ${ox},${oy}`);
  ok(own.lights.some((l) => l.x === ox + 1 && l.y === oy + 1), `luz convertida: ${JSON.stringify(own.lights)}`);
  const shared = await master(`${path}/assets/layers?key=${encodeURIComponent(ids.base.key)}`);
  check(shared.walls.length, 0, "a preparação compartilhada do fundo não muda");
  const original = await master(`${path}/assets/layers?key=${encodeURIComponent(ids.crypt.key)}`);
  check(original.walls.length, 1, "o mapa original não muda");

  // Reabrir: mesma transformação (salvar de novo sem mudanças não altera nada).
  await page.locator('[data-ed="close"]').click();
  await page.locator(".scene-editor").waitFor({ state: "detached" }).catch(() => {});
  await openEditor();
  const again = await master(`${path}/scenes/${scene.id}`);
  check(JSON.stringify(again.composition.elements.filter((e) => e.mapKey)), JSON.stringify(inst));
  await page.locator('[data-ed="close"]').click();

  // Mesa ao vivo: apresentar a cena leva a camada achatada (com os mapas inseridos) junto da imagem do mapa.
  const session = await master(`${path}/sessions`, "POST", { title: "Exploração", objective: "", mapKind: "tileset", mapKey: "crypt" });
  await master(`/api/sessions/${session.id}/scene`, "POST", { sceneId: scene.id, restart: false }, 204);
  const live = await master(`/api/sessions/${session.id}/live`);
  ok(String(live.map.imageUrl).includes(`overlay=`), `mesa usa a camada da composição: ${live.map.imageUrl}`);
  await master(`/api/sessions/${session.id}/end`, "POST", {}).catch(() => {});

  // Assistente de grade: prévia do impacto ao mudar o quadrado, e voltar ao anterior sem gravar.
  const before = await master(`${path}/assets/maps?page=1`);
  await page.evaluate((src) => import("/js/ui.js").then(async ({ modal }) => {
    const { gridAdjustHtml, mountGridAdjust } = await import("/js/grid-adjust.js");
    modal("Ajustar grade", `<form id="qa-grid">${gridAdjustHtml("qa", { gridPixels: 64 }, { complete: true })}</form>`);
    window.__grid = mountGridAdjust(document.querySelector("#qa-grid"), src);
  }), ids.base.imageUrl);
  await page.waitForFunction(() => /Resultado/.test(document.querySelector("[data-grid-summary]")?.textContent || ""));
  await page.locator('[data-grid-number="gridPixels"]').fill("128");
  await page.locator('[data-grid-number="gridPixels"]').dispatchEvent("input");
  await page.waitForFunction(() => /5 × 5 casas/.test(document.querySelector("[data-grid-impact-body]")?.textContent || ""), null, { timeout: 10000 });
  ok(/cena/.test(await page.locator("[data-grid-impact-body]").textContent()), "prévia cita as cenas que usam o mapa");
  await page.screenshot({ path: join(shots, "03-impacto.png") });
  await page.locator('[data-grid-restore="original"]').click();
  check(await page.locator('input[type=range][name="gridPixels"]').inputValue(), "64");
  check(await page.locator("[data-grid-impact]").isHidden(), true);
  const after = await master(`${path}/assets/maps?page=1`);
  check(JSON.stringify(after.items.map((m) => [m.id, m.revision, m.gridPixels])), JSON.stringify(before.items.map((m) => [m.id, m.revision, m.gridPixels])));
  check(errors.length === 0, true);
  if (errors.length) console.error(errors);
  console.log("Mapas inseridos, envio e impacto da grade: ok");
} catch (error) {
  console.error(error); console.error("Erros de navegador:", errors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await env.stop();
}
