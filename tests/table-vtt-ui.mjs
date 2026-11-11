/**
 * Mesa no navegador (PostgreSQL real): bandeja de dados com destaque do resultado, bolhas de vida/armadura nos
 * marcadores com ajuste pelo clique, imagem solta na mesa com ajuste de grade ao vivo e arquivo UVTT
 * (imagem, grade, paredes, portas e luzes). Capturas em artifacts/qa-vtt.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment, wait } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5197 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const free = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-vtt");
await mkdir(shots, { recursive: true });
const browsers = [];

try {
  const master = await env.verifiedClient("ui.master.vtt@example.test", "Aurora");
  const player = await env.verifiedClient("ui.player.vtt@example.test", "Lira");
  const campaign = await master("/api/campaigns", "POST", { name: "Mesa solta", description: "", rpgSystemId: free, playMode: "free" });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  const hero = await player("/api/characters", "POST", { campaignId: campaign.id, name: "Lira" });
  await master(`/api/campaigns/${campaign.id}/table-settings`, "PUT", { settings: { fogEnabled: false, rememberExplored: true, pathMovement: true, alliesAlwaysVisible: true, torchRadius: 4, brazierRadius: 3, creatureLight: 0, playerLightMeters: 0, playerVisionMeters: 0, playMode: "free" } });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Noite na taverna", objective: "", mapKind: "tileset", mapKey: "tavern" });
  const base = `/api/sessions/${session.id}`;
  await master(`${base}/join`, "POST", {}, 204);
  await player(`${base}/join`, "POST", { characterId: hero.id }, 204);
  const templates = await master(`/api/campaigns/${campaign.id}/npc-templates`);
  const goblin = await master(`${base}/tokens`, "POST", { label: "Goblin", side: "enemy", x: 6, y: 4, templateId: templates.items[0].id });
  ok(goblin.masterCharacterId, "criatura com ficha no mapa");

  async function pageFor(client, { mobile = false } = {}) {
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    browsers.push(browser);
    const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: mobile ? "reduce" : "no-preference" });
    await context.addCookies(client.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${env.origin}/#table/${campaign.id}`);
    await page.waitForSelector("#t-dice .die", { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector("#t-sub")?.textContent?.includes("Sessão") || document.querySelector("#t-sub")?.textContent?.includes("Noite"), null, { timeout: 20000 });
    return { page, errors };
  }

  /** Centro (em px CSS da página) da barra de vida do marcador, com a mesma conta de table-map.js. */
  async function bubblePoint(page, tokenId) {
    return page.evaluate(async ({ base, tokenId }) => {
      const live = await (await fetch(`${base}/live`, { headers: { "X-Eternnus": "1" } })).json();
      const t = live.tokens.find((x) => x.id === tokenId);
      const canvas = document.querySelector(".board-canvas");
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      const cols = live.map.rows[0].length, rows = live.map.rows.length;
      const cell = Math.max(1, Math.min(canvas.width / cols, canvas.height / rows));
      const ox = Math.floor((canvas.width - cell * cols) / 2), oy = Math.floor((canvas.height - cell * rows) / 2);
      const h = cell >= 20 ? Math.max(10, cell * 0.18) : Math.max(5, cell * 0.17);
      const y = Math.max(1, (t.y + 0.5) * cell - cell * 0.4 - h - cell * 0.04) + oy + h / 2;
      const x = ox + (t.x + 0.5) * cell;
      return { x: rect.left + x / dpr, y: rect.top + y / dpr, cell: cell / dpr };
    }, { base, tokenId });
  }

  // ---------- Mestre (desktop) ----------
  const m = await pageFor(master);
  await m.page.screenshot({ path: join(shots, "1-mestre-mesa.png") });
  check(await m.page.locator("#t-dice .die[data-action=t-quick-roll]").count(), 6, "bandeja com d4–d20");

  // Bandeja: um clique rola e o destaque aparece sobre o mapa.
  await m.page.click('#t-dice [data-id="20"]');
  await m.page.waitForSelector("#t-spot:not([hidden])", { timeout: 15000 });
  const spot = await m.page.textContent("#t-spot");
  ok(/1d20/.test(spot) && /Aurora|Mestre/.test(spot), "destaque mostra quem rolou e a fórmula: " + spot);
  await m.page.screenshot({ path: join(shots, "2-mestre-destaque.png") });
  const masterRolls = (await master(`${base}/live`)).events.filter((e) => e.kind === "roll");
  check(masterRolls.length, 1, "rolagem rápida gravada no servidor");

  // Jogador vê o destaque da rolagem do mestre (visível à mesa) e rola pela própria bandeja.
  const p = await pageFor(player);
  await m.page.click('#t-dice [data-id="6"]');
  await p.page.waitForSelector("#t-spot:not([hidden])", { timeout: 15000 });
  ok(/1d6/.test(await p.page.textContent("#t-spot")), "jogador recebe o destaque da rolagem da mesa");
  // Mestre em "Só eu": jogador não recebe nada.
  await m.page.click("#t-dice [data-action=t-quick-hidden]");
  check(await m.page.getAttribute("#t-dice [data-action=t-quick-hidden]", "aria-pressed"), "true", "alternância de visibilidade");
  await wait(3800);
  await m.page.click('#t-dice [data-id="8"]');
  await wait(2500);
  ok(!(await p.page.isVisible("#t-spot")) || !/1d8/.test(await p.page.textContent("#t-spot")), "rolagem só do mestre não aparece ao jogador");
  const playerEvents = (await player(`${base}/live`)).events.filter((e) => e.kind === "roll").map((e) => e.content).join(" ");
  ok(!/1d8/.test(playerEvents), "servidor não entrega a rolagem oculta ao jogador");

  // ---------- Bolhas ----------
  await wait(500);
  const npcPoint = await bubblePoint(m.page, goblin.id);
  ok(npcPoint.cell >= 18, "casa grande o bastante para as bolhas: " + npcPoint.cell);
  await m.page.mouse.click(npcPoint.x, npcPoint.y);
  await m.page.waitForSelector("#bubble-form", { timeout: 5000 });
  ok(/Goblin/.test(await m.page.textContent("#modal-title")), "modal da bolha do NPC");
  ok(/10 de 10/.test(await m.page.textContent(".bubble-now")) && /Armadura 10/.test(await m.page.textContent(".bubble-now")), "vida e armadura da ficha do NPC");
  await m.page.screenshot({ path: join(shots, "3-mestre-bolha.png") });
  await m.page.fill("#f-bubble", "4");
  await m.page.click('#bubble-form button[value="down"]');
  await m.page.waitForSelector("#modal:not([open])", { state: "attached", timeout: 5000 });
  await wait(800);
  const npcState = (await master(`${base}/live`)).play.npcs.find((n) => n.tokenId === goblin.id);
  check(npcState.sheet.resources[0].value, 6, "dano pela bolha gravado na ficha do NPC");
  await m.page.screenshot({ path: join(shots, "4-mestre-bolha-ajustada.png") });

  // Jogador: bolha do próprio personagem ajusta; a do NPC não existe para ele.
  const heroToken = (await player(`${base}/live`)).tokens.find((t) => t.characterId === hero.id);
  const heroPoint = await bubblePoint(p.page, heroToken.id);
  await p.page.mouse.click(heroPoint.x, heroPoint.y);
  await p.page.waitForSelector("#bubble-form", { timeout: 5000 });
  await p.page.fill("#f-bubble", "3");
  await p.page.click('#bubble-form button[value="down"]');
  await wait(1200);
  const heroSummary = (await player(`${base}/live`)).participants.find((x) => x.characterId === hero.id).summary;
  check(heroSummary.resources[0].value, 7, "jogador ajusta a própria vida pela bolha");
  ok(heroSummary.armor?.value === "10", "armadura no resumo do personagem");
  ok(!(await player(`${base}/live`)).play.npcs.length, "jogador não recebe ficha de NPC");
  await p.page.screenshot({ path: join(shots, "5-jogador-bolhas.png") });

  // ---------- Imagem solta na mesa ----------
  /** Solta um arquivo gerado na página sobre o palco, como o navegador faz ao arrastar. */
  async function dropFile(page, kind) {
    await page.evaluate(async (kind) => {
      const canvas = document.createElement("canvas");
      const [w, h] = kind === "image" ? [1400, 1050] : [800, 600];
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext("2d");
      g.fillStyle = "#6b5a3a"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#222"; const s = kind === "image" ? 70 : 100;
      for (let x = 0; x <= w; x += s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += s) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      let file;
      if (kind === "image") {
        file = new File([await new Promise((r) => canvas.toBlob(r, "image/webp", 0.9))], "porão_da_taverna.webp", { type: "image/webp" });
      } else {
        const room = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
        const json = { format: 0.3, resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 8, y: 6 }, pixels_per_grid: 100 }, line_of_sight: [room(1, 1, 7, 5)], portals: [{ position: { x: 3.5, y: 1 }, bounds: [{ x: 3.1, y: 1 }, { x: 3.9, y: 1 }], rotation: 0, closed: true, freestanding: false }], lights: [{ position: { x: 3.5, y: 3.5 }, range: 4, intensity: 1, color: "ffffccaa", shadows: true }], image: canvas.toDataURL("image/png").split(",")[1] };
        file = new File([JSON.stringify(json)], "cripta.dd2vtt", { type: "" });
      }
      const data = new DataTransfer();
      data.items.add(file);
      const stage = document.querySelector(".stage");
      stage.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true, cancelable: true }));
      stage.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
      stage.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    }, kind);
  }

  // Jogador soltando arquivo: nada acontece (nem navega para o arquivo).
  await dropFile(p.page, "image");
  await wait(600);
  ok(!(await p.page.isVisible("#md-form")), "jogador não troca o mapa soltando arquivo");

  await m.page.keyboard.press("Escape");
  await dropFile(m.page, "image");
  await m.page.waitForSelector("#md-form", { timeout: 5000 });
  check(await m.page.inputValue("#md-name"), "porão da taverna", "nome a partir do arquivo");
  await m.page.screenshot({ path: join(shots, "6-mestre-soltar-imagem.png") });
  await m.page.click('#md-form button[value="present"]');
  await m.page.waitForSelector("#mg-form", { timeout: 20000 });
  let state = await master(`${base}/live`);
  ok(state.map.key.startsWith("asset:"), "mapa solto foi para a mesa");
  check(state.map.gridPixels, 70, "grade sugerida pela imagem (WebP convertida)");
  check([state.map.width, state.map.height], [20, 15], "casas da grade sugerida");
  await m.page.waitForFunction(() => /Resultado/.test(document.querySelector("[data-grid-summary]")?.textContent || ""), null, { timeout: 10000 });
  await m.page.screenshot({ path: join(shots, "7-mestre-ajustar-grade.png") });
  // Ajusta para quadrados de 140 px (10 × 7 casas) com o mapa na mesa.
  await m.page.$eval('#mg-form input[type=range][name="gridPixels"]', (el) => { el.value = "140"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await m.page.click("#mg-form button[type=submit]");
  await m.page.waitForSelector("#mg-form", { state: "hidden", timeout: 10000 });
  await wait(800);
  state = await master(`${base}/live`);
  check([state.map.gridPixels, state.map.width, state.map.height], [140, 10, 7], "grade ajustada com o mapa na mesa");
  ok(state.tokens.every((t) => t.x < 10 && t.y < 7), "marcadores dentro da nova grade");
  ok((await player(`${base}/live`)).map.gridPixels === 140, "jogador recebe a grade nova");
  await m.page.screenshot({ path: join(shots, "8-mestre-grade-aplicada.png") });

  // ---------- UVTT ----------
  await dropFile(m.page, "uvtt");
  await m.page.waitForSelector("#md-form", { timeout: 5000 });
  ok(/UVTT/.test(await m.page.textContent("#modal-title")), "modal de UVTT");
  await m.page.click('#md-form button[value="present"]');
  await m.page.waitForSelector("#md-form", { state: "hidden", timeout: 20000 });
  await wait(800);
  state = await master(`${base}/live`);
  check([state.map.gridPixels, state.map.width, state.map.height], [100, 8, 6], "grade e tamanho vindos do UVTT");
  const layer = await master(`/api/campaigns/${campaign.id}/assets/layers?key=${encodeURIComponent(state.map.key)}`);
  check(layer.cells[0][3], "d", "porta do UVTT na casa certa");
  check(layer.cells[2][0], "#", "parede esquerda do lado de fora da sala");
  check(layer.cells[2][3], ".", "interior da sala livre");
  check(layer.lights.map((l) => [l.x, l.y, l.radius]), [[3, 3, 4]], "luz do UVTT");
  await m.page.screenshot({ path: join(shots, "9-mestre-uvtt.png") });
  ok(!m.errors.length && !p.errors.length, "sem erros de script: " + [...m.errors, ...p.errors].join(" | "));

  // ---------- Celular (horizontal) ----------
  const mobile = await pageFor(player, { mobile: true });
  const sizes = await mobile.page.$$eval("#t-dice .die", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  ok(sizes.every(([w, h]) => w >= 44 && h >= 44), "alvos da bandeja com 44 px no celular: " + JSON.stringify(sizes));
  const trayBox = await mobile.page.locator("#t-dice").boundingBox();
  const stageBox = await mobile.page.locator(".stage").boundingBox();
  ok(trayBox.y + trayBox.height <= stageBox.y + stageBox.height + 1, "bandeja dentro do palco, acima da navegação inferior");
  await mobile.page.screenshot({ path: join(shots, "10-jogador-celular.png") });
  ok(!mobile.errors.length, "sem erros no celular: " + mobile.errors.join(" | "));
  console.log(`table-vtt-ui: ${env.count()} verificações; capturas em ${shots}`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
