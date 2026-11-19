/**
 * Câmera compartilhada e exibição externa (ADR-115), PostgreSQL real e navegador: a exibição (1920×1080) não tem
 * ferramentas do mestre, notas, conversa nem fichas; "Mostrar esta região" pela Busca de ações grava um enquadramento;
 * a exibição e o jogador que segue recebem a nova sequência sem recarregar; quem não segue não tem a câmera movida.
 * Jogador 1366×768 e celular 390×844 (mesa pede a horizontal; a exibição se adapta). Capturas em artifacts/qa-display.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment, wait } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5214, startupTimeoutMs: 180000 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const free = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-display");
await mkdir(shots, { recursive: true });
const browsers = [];

async function open(client, viewport, { reducedMotion = "no-preference", mobile = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport, serviceWorkers: "block", reducedMotion, hasTouch: mobile, isMobile: mobile });
  await context.addCookies(client.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors, context };
}
const zoomOf = (page, selector) => page.evaluate((s) => Number(document.querySelector(s)?.dataset.zoom || 0), selector);
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await wait(200); }
}

try {
  const master = await env.verifiedClient("display.master@example.test", "Aurora");
  const player = await env.verifiedClient("display.player@example.test", "Lira");
  const campaign = await master("/api/campaigns", "POST", { name: "Mesa na TV", description: "", rpgSystemId: free, playMode: "free" });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  const hero = await player("/api/characters", "POST", { campaignId: campaign.id, name: "Lira" });
  await master(`/api/campaigns/${campaign.id}/table-settings`, "PUT", { settings: { fogEnabled: false, rememberExplored: true, pathMovement: true, alliesAlwaysVisible: true, torchRadius: 4, brazierRadius: 3, creatureLight: 0, playerLightMeters: 0, playerVisionMeters: 0, playMode: "free" } });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Projeção", objective: "Objetivo secreto", mapKind: "tileset", mapKey: "tavern" });
  const base = `/api/sessions/${session.id}`;
  await master(`${base}/join`, "POST", {}, 204);
  await player(`${base}/join`, "POST", { characterId: hero.id }, 204);
  await master(`${base}/notes`, "POST", { content: "Nota privada do mestre", shared: false }, null);

  // Só o mestre abre a exibição.
  await player(`${base}/display`, "GET", undefined, 403);
  const state = await master(`${base}/display`);
  ok(state.me.display === true && state.me.isMaster === false && !state.objective, "estado de espectador sem objetivo");

  // ---------- Exibição externa (1920×1080) ----------
  const d = await open(master, { width: 1920, height: 1080 });
  await d.page.goto(`${env.origin}/#/mesa/${session.id}/exibicao`);
  await d.page.waitForSelector("#d-board canvas", { timeout: 25000 });
  await d.page.waitForFunction(() => document.querySelector("#d-scene")?.textContent.includes("Mesa na TV"), null, { timeout: 15000 });
  check(await d.page.locator(".sidebar, .table-rail, #t-chat, #t-tools, .side-panel, .party, .mobile-nav, nav").count(), 0, "sem ferramentas do mestre, conversa, fichas nem navegação");
  const text = await d.page.textContent("body");
  ok(!text.includes("Nota privada do mestre") && !text.includes("Objetivo secreto"), "sem notas nem objetivo");
  ok(await d.page.locator('.follow-toggle[aria-pressed="true"]').count() === 1, "exibição segue o mestre por padrão");
  ok(await d.page.locator("#d-full").count() === 1, "botão de tela cheia");
  const z0 = await zoomOf(d.page, "#d-board");
  await d.page.screenshot({ path: join(shots, "1-exibicao-1920.png") });

  // ---------- Jogador (1366×768): começa com câmera livre ----------
  const p = await open(player, { width: 1366, height: 768 });
  await p.page.goto(`${env.origin}/#table/${campaign.id}`);
  await p.page.waitForSelector('#t-tools [data-action="t-follow"]', { timeout: 25000 });
  check(await p.page.getAttribute('#t-tools [data-action="t-follow"]', "aria-pressed"), "false", "jogador começa com câmera livre");
  const pz0 = await zoomOf(p.page, "#t-board");

  // ---------- Mestre: "Mostrar esta região" pela Busca de ações ----------
  const m = await open(master, { width: 1366, height: 768 });
  await m.page.goto(`${env.origin}/#table/${campaign.id}`);
  await m.page.waitForSelector("#t-tools .ed-tool", { timeout: 25000 });
  // Aproxima a vista do mestre para mostrar uma região menor que o mapa.
  for (let i = 0; i < 4; i++) await m.page.click('[data-camera="in"]');
  await m.page.keyboard.press("Control+k");
  await m.page.keyboard.type("Mostrar esta região");
  await m.page.keyboard.press("Enter");
  const first = await until(async () => (await master(`${base}/live`)).camera);
  ok(first && first.seq === 1 && first.w > 0 && first.h > 0, "enquadramento gravado: " + JSON.stringify(first));
  // Exibição recebe sem recarregar e muda o zoom.
  const z1 = await until(async () => { const z = await zoomOf(d.page, "#d-board"); return Math.abs(z - z0) > 0.01 ? z : 0; });
  ok(z1 > z0, `exibição enquadrou a região (zoom ${z0} → ${z1})`);
  await d.page.screenshot({ path: join(shots, "2-exibicao-regiao.png") });
  // Quem não segue não tem a câmera movida.
  await wait(1500);
  check(await zoomOf(p.page, "#t-board"), pz0, "câmera livre do jogador não se moveu");

  // Jogador liga "Seguir o mestre": recebe o enquadramento atual; depois uma nova sequência.
  await p.page.click('#t-tools [data-action="t-follow"]');
  const pz1 = await until(async () => { const z = await zoomOf(p.page, "#t-board"); return Math.abs(z - pz0) > 0.01 ? z : 0; });
  ok(pz1 > pz0, `jogador que segue recebeu a região (zoom ${pz0} → ${pz1})`);
  check(await p.page.evaluate((id) => sessionStorage.getItem(`eternnus.follow.${id}`), session.id), "1", "escolha lembrada na aba");
  await master(`${base}/camera`, "POST", { x: 0, y: 0, w: 4, h: 3 }, 204);
  const pz2 = await until(async () => { const z = await zoomOf(p.page, "#t-board"); return Math.abs(z - pz1) > 0.01 ? z : 0; });
  ok(pz2 > 0, `nova sequência aplicada sem recarregar (zoom ${pz1} → ${pz2})`);
  // Gesto manual pausa e oferece "Voltar a seguir".
  await p.page.click('[data-camera="out"]');
  await p.page.waitForSelector('#t-follow-chip [data-action="t-follow-resume"]', { timeout: 5000 });
  const paused = await zoomOf(p.page, "#t-board");
  await master(`${base}/camera`, "POST", { x: 2, y: 2, w: 3, h: 2 }, 204);
  await wait(2500);
  check(await zoomOf(p.page, "#t-board"), paused, "pausado não recebe a nova região");
  await p.page.click('#t-follow-chip [data-action="t-follow-resume"]');
  await until(async () => Math.abs(await zoomOf(p.page, "#t-board") - paused) > 0.01);
  ok(Math.abs(await zoomOf(p.page, "#t-board") - paused) > 0.01, "voltar a seguir aplica a região atual");
  await p.page.screenshot({ path: join(shots, "3-jogador-seguindo.png") });

  // Região inválida é recusada pelo servidor; jogador não envia câmera.
  await master(`${base}/camera`, "POST", { x: 999, y: 999, w: 2, h: 2 }, 400);
  await player(`${base}/camera`, "POST", { x: 0, y: 0, w: 2, h: 2 }, 403);

  // ---------- Exibição no celular deitado/retrato (390×844): adapta-se sem rolagem horizontal ----------
  const small = await open(master, { width: 390, height: 844 }, { reducedMotion: "reduce", mobile: true });
  await small.page.goto(`${env.origin}/#/mesa/${session.id}/exibicao`);
  await small.page.waitForSelector("#d-board canvas", { timeout: 25000 });
  const overflow = await small.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(overflow <= 1, "sem rolagem horizontal: " + overflow);
  const tiny = await small.page.$$eval(".display-bar button:not(.help-button)", (els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
  check(tiny, 0, "alvos de toque ≥ 44 px na exibição");
  await small.page.screenshot({ path: join(shots, "4-exibicao-390.png") });

  for (const [who, page] of [["exibição", d], ["jogador", p], ["mestre", m], ["celular", small]]) ok(!page.errors.length, `sem erros (${who}): ${page.errors.join(" | ")}`);
  console.log(`table-display: ${env.count()} verificações; capturas em ${shots}`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
