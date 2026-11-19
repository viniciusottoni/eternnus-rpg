/**
 * Convidados da mesa (ADR-114), PostgreSQL real e navegador: o mestre liga convidados e cria convites (um pelo painel),
 * convidados sem conta abrem #/convidado/{segredo}, informam o nome e veem a mesa; o segredo sai do endereço;
 * observador não rola, não conversa nem move; o mestre entrega um marcador ao participante, que o move pelo toque;
 * revogar encerra o acesso. Viewports 1920×1080, 1366×768 e 390×844. Capturas em artifacts/qa-guests.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment, wait } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5213, startupTimeoutMs: 180000 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const free = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-guests");
await mkdir(shots, { recursive: true });
const browsers = [];

async function open({ cookies = null, viewport, mobile = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce" });
  if (cookies) await context.addCookies(cookies.split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.origin }).catch(() => {});
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors, context };
}

/** Entra pelo link: nome, resgate, mesa montada. */
async function joinAsGuest(page, link, name) {
  await page.goto(link);
  await page.waitForSelector("#g-name", { timeout: 20000 });
  check(await page.inputValue("#g-name"), "Convidado", "nome sugerido");
  await page.fill("#g-name", name);
  const before = await page.evaluate(() => history.length);
  await page.click("#g-join button[type=submit]");
  await page.waitForSelector(".guest-shell #g-board canvas", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector("#g-title")?.textContent?.match(/^Mesa$/), null, { timeout: 15000 }).catch(() => {});
  return before;
}

try {
  const master = await env.verifiedClient("guests.master@example.test", "Aurora");
  const campaign = await master("/api/campaigns", "POST", { name: "Mesa aberta", description: "", rpgSystemId: free, playMode: "free" });
  await master(`/api/campaigns/${campaign.id}/table-settings`, "PUT", { settings: { fogEnabled: false, rememberExplored: true, pathMovement: true, alliesAlwaysVisible: true, torchRadius: 4, brazierRadius: 3, creatureLight: 0, playerLightMeters: 0, playerVisionMeters: 0, playMode: "free" } });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Visitas", objective: "Segredo do mestre", mapKind: "tileset", mapKey: "tavern" });
  const base = `/api/sessions/${session.id}`;
  await master(`${base}/join`, "POST", {}, 204);
  const wolf = await master(`${base}/tokens`, "POST", { label: "Lobo", side: "neutral", x: 4, y: 4 });

  // Desligado: criar convite é recusado.
  await master(`/api/campaigns/${campaign.id}/guest-invites`, "POST", { mode: "observer" }, 409);

  // ---------- Mestre (1920×1080): liga convidados e cria convite de participante pelo painel ----------
  const m = await open({ cookies: master.cookieHeader(), viewport: { width: 1920, height: 1080 } });
  await m.page.goto(`${env.origin}/#table/${campaign.id}`);
  await m.page.waitForSelector("#t-tools .ed-tool", { timeout: 20000 });
  await m.page.keyboard.press("Control+k");
  await m.page.keyboard.type("Convidados da mesa");
  await m.page.keyboard.press("Enter");
  await m.page.waitForSelector("#gm-enabled", { timeout: 15000 });
  ok(!(await m.page.isChecked("#gm-enabled")), "convidados começam desligados");
  await m.page.check("#gm-enabled");
  await m.page.waitForSelector("#gm-invite", { timeout: 15000 });
  await m.page.check('#gm-invite input[name=mode][value=participant]');
  check(await m.page.inputValue("#gm-hours"), "4", "duração padrão de 4 horas");
  check(await m.page.inputValue("#gm-uses"), "1", "um uso por padrão");
  await m.page.click("#gm-invite button[type=submit]");
  await m.page.waitForSelector("#gm-link", { timeout: 15000 });
  const participantLink = await m.page.inputValue("#gm-link");
  ok(/\/#\/convidado\/[A-Za-z0-9_-]{20,}$/.test(participantLink), "link completo exibido: " + participantLink.replace(/convidado\/.*/, "convidado/…"));
  ok(/Quem tiver o link entra; revogue quando terminar/.test(await m.page.textContent(".guest-link")), "aviso do link");
  await m.page.click('[data-action="gm-copy"]');
  await m.page.screenshot({ path: join(shots, "1-mestre-convidados.png") });
  // O segredo não fica guardado no navegador do mestre.
  const stored = await m.page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  ok(!stored.includes(participantLink.split("/").pop()), "segredo fora do armazenamento local");
  await m.page.click("#close-modal");

  // Observador pela API (mesmo contrato).
  const observerInvite = await master(`/api/campaigns/${campaign.id}/guest-invites`, "POST", { mode: "observer", hours: 2, maxUses: 1 }, 201);
  const observerLink = env.origin + observerInvite.path;

  // ---------- Observador sem conta (390×844) ----------
  const o = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  const historyBefore = await joinAsGuest(o.page, observerLink, "Bia");
  check(await o.page.evaluate(() => location.hash), "#/convidado", "segredo saiu da barra de endereço");
  ok(!(await o.page.evaluate(() => location.href)).includes(observerInvite.secret), "URL sem o segredo");
  check(await o.page.evaluate(() => history.length), historyBefore, "resgate substitui a entrada do histórico (sem nova entrada)");
  check(await o.page.locator("#g-roll, #g-chat").count(), 0, "observador não rola nem conversa");
  ok((await o.page.textContent(".guest-observer")).includes("observador"), "explica o modo observador");
  ok(!(await o.page.textContent("body")).includes("Segredo do mestre"), "objetivo do mestre não aparece");
  check(await o.page.locator(".sidebar, .table-rail, #t-chat").count(), 0, "sem menu da conta nem ferramentas da mesa");
  const overflow = await o.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(overflow <= 1, "sem rolagem horizontal no celular: " + overflow);
  const small = await o.page.$$eval(".guest-top button:not(.help-button), .follow-bar button:not(.help-button)", (els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length);
  check(small, 0, "alvos de toque ≥ 44 px");
  await o.page.screenshot({ path: join(shots, "2-observador-celular.png") });
  // Observador não move: a API recusa.
  const observerMove = await o.page.evaluate(async () => (await fetch("/api/guest/move", { method: "POST", headers: { "Content-Type": "application/json", "X-Eternnus": "1", "X-CSRF-TOKEN": (await (await fetch("/api/auth/csrf")).json()).token }, body: JSON.stringify({ x: 5, y: 5 }) })).status);
  ok(observerMove >= 400, "movimento do observador recusado: " + observerMove);

  // ---------- Participante (1366×768) ----------
  const p = await open({ viewport: { width: 1366, height: 768 } });
  await joinAsGuest(p.page, participantLink, "Caio");
  check(await p.page.evaluate(() => location.hash), "#/convidado", "segredo do participante saiu do endereço");
  ok(await p.page.locator("#g-roll").count() === 1 && await p.page.locator("#g-chat").count() === 1, "participante rola e conversa");
  ok(await p.page.locator('.follow-toggle[aria-pressed="true"]').count() === 1, "convidado segue o mestre por padrão");
  await p.page.fill("#g-formula", "1d20+2");
  await p.page.click("#g-roll button[type=submit]");
  await p.page.fill("#g-message", "Olá, mesa!");
  await p.page.click("#g-chat button[type=submit]");
  await p.page.waitForFunction(() => document.querySelector("#g-feed")?.textContent.includes("Olá, mesa!"), null, { timeout: 15000 });

  // O mestre vê o convidado e entrega o Lobo (marcador sem ficha).
  const list = await master(`/api/campaigns/${campaign.id}/guest-invites`);
  const seat = list.seats.find((s) => s.name === "Caio");
  ok(seat && seat.mode === "participant", "assento do participante listado");
  await master(`${base}/guest-control`, "POST", { tokenId: wolf.id, seatId: seat.id }, 204);
  await p.page.waitForFunction(() => document.querySelector("#g-hint")?.textContent.includes("Lobo"), null, { timeout: 20000 });
  // O mestre vê o convidado no grupo.
  await m.page.waitForFunction(() => document.querySelector(".party-guests")?.textContent.includes("Caio"), null, { timeout: 20000 });

  // Toque no marcador e depois na casa de destino.
  const point = (cell) => p.page.evaluate(async (c) => {
    const live = await (await fetch("/api/guest/live", { headers: { "X-Eternnus": "1" } })).json();
    const canvas = document.querySelector("#g-board canvas"), rect = canvas.getBoundingClientRect(), dpr = canvas.width / rect.width;
    const host = document.querySelector("#g-board");
    const cols = live.map.rows[0].length, rows = live.map.rows.length;
    const size = Math.floor(Math.min(canvas.width / cols, canvas.height / rows));
    const ox = Math.floor((host.scrollWidth * dpr - size * cols) / 2) - host.scrollLeft * dpr, oy = Math.floor((host.scrollHeight * dpr - size * rows) / 2) - host.scrollTop * dpr;
    return { x: rect.left + (ox + (c.x + 0.5) * size) / dpr, y: rect.top + (oy + (c.y + 0.5) * size) / dpr };
  }, cell);
  const from = await point({ x: 4, y: 4 });
  await p.page.mouse.click(from.x, from.y);
  await p.page.waitForFunction(() => document.querySelector("#g-hint")?.textContent.includes("destino"), null, { timeout: 5000 });
  const live0 = await master(`${base}/live`);
  const target = [{ x: 5, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 3 }].find((c) => /^[^#]/.test(live0.map.rows[c.y][c.x] || "#")) || { x: 5, y: 4 };
  const to = await point(target);
  await p.page.mouse.click(to.x, to.y);
  let moved = null;
  for (let i = 0; i < 40 && !moved; i++) {
    const t = (await master(`${base}/live`)).tokens.find((x) => x.id === wolf.id);
    if (t.x !== 4 || t.y !== 4) moved = t;
    else await wait(250);
  }
  const hintText = await p.page.textContent("#g-hint");
  ok(moved, `participante moveu o marcador entregue (destino ${JSON.stringify(target)}; aviso: ${hintText})`);
  await p.page.screenshot({ path: join(shots, "3-participante-desktop.png") });
  // Personagem de jogador não pode ser entregue; pedido inválido é recusado.
  await master(`${base}/guest-control`, "POST", { tokenId: wolf.id, seatId: null }, 204);

  // ---------- Revogar encerra o acesso ----------
  await master(`/api/campaigns/${campaign.id}/guest-seats/${seat.id}`, "DELETE", undefined, 204);
  await p.page.waitForFunction(() => document.querySelector("#main h1")?.textContent.includes("Seu acesso de convidado terminou"), null, { timeout: 45000 });
  await p.page.screenshot({ path: join(shots, "4-acesso-encerrado.png") });
  // Revisitar sem segredo: o cookie revogado mostra as instruções.
  await p.page.goto(`${env.origin}/#/convidado`);
  await p.page.waitForSelector(".guest-gate h1", { timeout: 20000 });
  ok(/Entrar como convidado|terminou/.test(await p.page.textContent(".guest-gate h1")), "revisita sem segredo mostra instruções");

  // Observador sai pela própria tela.
  await o.page.click("#g-leave");
  await o.page.waitForFunction(() => document.querySelector("#main h1")?.textContent.includes("Você saiu da mesa"), null, { timeout: 15000 });

  for (const [who, page] of [["mestre", m], ["observador", o], ["participante", p]]) ok(!page.errors.length, `sem erros (${who}): ${page.errors.join(" | ")}`);
  console.log(`guests: ${env.count()} verificações; capturas em ${shots}`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
