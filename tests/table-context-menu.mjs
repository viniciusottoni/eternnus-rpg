/**
 * Mesa no navegador (PostgreSQL real), desktop 1440 × 900: trilho e bandeja de dados soltos dos painéis laterais,
 * ⓘ nunca sozinho numa linha, menu de contexto (botão direito) nos marcadores e no mapa e atalhos de teclado
 * (Delete, Esc, Ctrl+Z) no padrão do editor de cena. Capturas em artifacts/qa-context.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment, wait } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5203, startupTimeoutMs: 90000 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const free = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-context");
await mkdir(shots, { recursive: true });
let browser;

try {
  const master = await env.verifiedClient("ctx.master@example.test", "Aurora");
  const player = await env.verifiedClient("ctx.player@example.test", "Lira");
  await master("/api/auth/preferences", "PUT", { interfaceMode: "complete" }, 204);
  const campaign = await master("/api/campaigns", "POST", { name: "Mesa com menus", description: "", rpgSystemId: free, playMode: "free" });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  const hero = await player("/api/characters", "POST", { campaignId: campaign.id, name: "Lira" });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Noite na taverna", objective: "", mapKind: "tileset", mapKey: "tavern" });
  const base = `/api/sessions/${session.id}`;
  await master(`${base}/join`, "POST", {}, 204);
  await player(`${base}/join`, "POST", { characterId: hero.id }, 204);
  const goblin = await master(`${base}/tokens`, "POST", { label: "Goblin", side: "enemy", x: 6, y: 4 });
  const rat = await master(`${base}/tokens`, "POST", { label: "Rato", side: "enemy", x: 8, y: 4 });

  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${env.origin}/#table/${campaign.id}`);
  await page.waitForSelector("#t-dice .die", { timeout: 30000 });
  await page.waitForSelector("#t-tools .ed-tool", { timeout: 30000 });

  /** Centro do marcador em px CSS, com a mesma conta de table-map.js. */
  const tokenPoint = (tokenId) => page.evaluate(async ({ base, tokenId }) => {
    const live = await (await fetch(`${base}/live`, { headers: { "X-Eternnus": "1" } })).json();
    const t = live.tokens.find((x) => x.id === tokenId);
    const canvas = document.querySelector(".board-canvas");
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const cols = live.map.rows[0].length, rows = live.map.rows.length;
    const cell = Math.max(1, Math.min(canvas.width / cols, canvas.height / rows));
    const ox = Math.floor((canvas.width - cell * cols) / 2), oy = Math.floor((canvas.height - cell * rows) / 2);
    return { x: rect.left + (ox + (t.x + 0.5) * cell) / dpr, y: rect.top + (oy + (t.y + 0.5) * cell) / dpr, cell: cell / dpr };
  }, { base, tokenId });

  // ---------- Trilho e dados separados dos painéis ----------
  const box = (sel) => page.locator(sel).first().boundingBox();
  const [party, rail, side, dice] = await Promise.all([box(".party"), box("#t-tools"), box(".side-panel"), box("#t-dice")]);
  ok(rail.x - (party.x + party.width) >= 8, `trilho afastado do painel de aventureiros (${Math.round(rail.x - party.x - party.width)} px)`);
  ok(side.x - (dice.x + dice.width) >= 8, `bandeja de dados afastada do chat (${Math.round(side.x - dice.x - dice.width)} px)`);
  const railBorder = await page.$eval("#t-tools", (el) => getComputedStyle(el).borderTopLeftRadius);
  ok(parseFloat(railBorder) >= 8, "trilho com cantos arredondados de cartão");
  await page.screenshot({ path: join(shots, "1-trilho-e-dados.png") });

  // ---------- ⓘ colado ao texto ----------
  // Rótulo estreito: o ⓘ desce junto com a última palavra, nunca sozinho.
  const glue = await page.evaluate(() => {
    const host = document.createElement("p");
    host.style.cssText = "width:150px;font-size:14px";
    host.innerHTML = 'Apresentar imagem temporária<button type="button" class="help-button" data-help="mesa.imagens.temporarias" aria-label="Ajuda: teste"><span aria-hidden="true">i</span></button>';
    document.querySelector(".party").append(host);
    return new Promise((resolve) => requestAnimationFrame(() => {
      const button = host.querySelector(".help-button");
      const glued = button.parentElement.classList.contains("help-glue");
      const range = document.createRange();
      const text = button.previousSibling;
      range.selectNodeContents(text);
      const last = [...range.getClientRects()].at(-1), b = button.getBoundingClientRect();
      host.remove();
      resolve({ glued, sameLine: Math.abs((last.top + last.bottom) / 2 - (b.top + b.bottom) / 2) < 10 });
    }));
  });
  ok(glue.glued && glue.sameLine, "ⓘ na mesma linha da última palavra: " + JSON.stringify(glue));
  const temporary = await page.evaluate(() => {
    const summary = document.querySelector(".temporary-controls > summary");
    const b = summary?.querySelector(".help-button");
    return b ? b.parentElement.classList.contains("help-glue") : null;
  });
  ok(temporary !== false, "ⓘ de “Apresentar imagem temporária” colado ao texto");

  // ---------- Menu de contexto no marcador ----------
  const g = await tokenPoint(goblin.id);
  await page.mouse.click(g.x, g.y, { button: "right" });
  await page.waitForSelector(".ed-menu[role=menu]", { timeout: 5000 });
  const labels = await page.$$eval(".ed-menu .ed-menu-label", (els) => els.map((e) => e.textContent));
  ok(labels.some((l) => /Editar marcador/.test(l)) && labels.some((l) => /Remover marcador/.test(l)), "menu do marcador: " + labels.join(" | "));
  ok(await page.locator('#t-tools [role=group][aria-label*="Goblin"]').count() === 1, "botão direito seleciona o marcador");
  await page.screenshot({ path: join(shots, "2-menu-marcador.png") });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ed-menu", { state: "detached", timeout: 3000 });

  // Remover pelo menu.
  const r = await tokenPoint(rat.id);
  await page.mouse.click(r.x, r.y, { button: "right" });
  await page.waitForSelector(".ed-menu[role=menu]", { timeout: 5000 });
  await page.click(".ed-menu .ed-menu-item.danger");
  await wait(1200);
  ok(!(await master(`${base}/live`)).tokens.some((t) => t.id === rat.id), "Remover marcador pelo menu de contexto");

  // Ctrl+Z desfaz a remoção.
  await page.locator("#main").focus();
  await page.keyboard.press("Control+z");
  await wait(1500);
  ok((await master(`${base}/live`)).tokens.some((t) => t.label === "Rato"), "Ctrl+Z desfaz a remoção");

  // Delete remove o selecionado.
  const g2 = await tokenPoint(goblin.id);
  await page.mouse.click(g2.x, g2.y);
  await page.waitForSelector('#t-tools [role=group][aria-label*="Goblin"]', { timeout: 5000 });
  await page.locator("#main").focus();
  await page.keyboard.press("Delete");
  await wait(1200);
  ok(!(await master(`${base}/live`)).tokens.some((t) => t.id === goblin.id), "Delete remove o marcador selecionado");

  // Personagem de jogador: Delete não remove.
  const heroToken = (await master(`${base}/live`)).tokens.find((t) => t.characterId === hero.id);
  if (heroToken) {
    const h = await tokenPoint(heroToken.id);
    await page.mouse.click(h.x, h.y);
    await wait(300);
    await page.locator("#main").focus();
    await page.keyboard.press("Delete");
    await wait(800);
    ok((await master(`${base}/live`)).tokens.some((t) => t.id === heroToken.id), "Delete não remove personagem de jogador");
    await page.keyboard.press("Escape");
  }

  // ---------- Menu de contexto numa casa vazia ----------
  const cellPoint = await tokenPoint((await master(`${base}/live`)).tokens[0].id);
  await page.mouse.click(cellPoint.x + cellPoint.cell * 2, cellPoint.y + cellPoint.cell * 2, { button: "right" });
  await page.waitForSelector(".ed-menu[role=menu]", { timeout: 5000 });
  const cellLabels = await page.$$eval(".ed-menu .ed-menu-label", (els) => els.map((e) => e.textContent));
  ok(cellLabels.some((l) => /Adicionar personagem aqui/.test(l)) && cellLabels.some((l) => /Desfazer/.test(l)), "menu da casa: " + cellLabels.join(" | "));
  await page.screenshot({ path: join(shots, "3-menu-casa.png") });
  await page.keyboard.press("Escape");

  ok(!errors.length, "sem erros de script: " + errors.join(" | "));
  console.log(`table-context-menu: ${env.count()} verificações; capturas em ${shots}`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await env.stop();
}
