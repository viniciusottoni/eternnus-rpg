// Validação da trilha sonora em dois navegadores independentes (mestre e jogador) contra PostgreSQL isolado.
// Playwright local: artifacts/qa-runtime (não é dependência do produto). Navegadores separados = cookies e
// políticas de reprodução automática separados. Cobre: biblioteca na campanha, seleção na mesa, bloqueio de
// autoplay e "Ativar áudio da sessão", pausa, busca na faixa, desvio local corrigido, reconexão (offline/online),
// recarga da página (entrada tardia), suspensão da trilha global, parada, celular e ausência de erros/CSP.
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startEnvironment, wait } from "./support/harness.mjs";

const dir = "artifacts/qa/trilha-sonora";
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5262 });
const checks = [], errors = [], shots = [], measures = [];
const browsers = [];
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
const free = "00000000-0000-4000-8000-000000000001";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";

function mp3(frames) {
  const out = Buffer.alloc(frames * 417);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x64], i * 417);
  return out;
}

try {
  const admin = await env.verifiedClient("ui.admin.music@example.test", "Conselho");
  env.sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='ui.admin.music@example.test'`);
  await env.authenticateMfa(admin, "ui.admin.music@example.test");
  const master = await env.verifiedClient("ui.master.music@example.test", "Aurora");
  const player = await env.verifiedClient("ui.player.music@example.test", "Lira");
  const campaign = await master("/api/campaigns", "POST", { name: "Crônicas sonoras", description: "", rpgSystemId: free, playMode: "tactical" });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  const hero = await player("/api/characters", "POST", { campaignId: campaign.id, name: "Lira" });
  const official = await import("node:fs/promises").then((fs) => fs.readFile("apps/Eternnus.Web/wwwroot/assets/audio/the-blade-and-the-serpent.v1.mp3"));
  for (const [bytes, name, title] of [[official, "tema.mp3", "Tema de Eternnus"], [mp3(3000), "taverna.mp3", "Taverna"]]) {
    const form = new FormData();
    form.append("title", title);
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), name);
    await admin("/api/admin/music", "POST", form);
  }
  const uploadFile = join(env.temp, "batalha_final.mp3");
  await writeFile(uploadFile, mp3(2000));
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Noite na taverna", objective: "", mapKind: "tileset", mapKey: "tavern" });
  await master(`/api/sessions/${session.id}/join`, "POST", {}, 204);
  await player(`/api/sessions/${session.id}/join`, "POST", { characterId: hero.id }, 204);

  // Mestre: autoplay liberado. Jogador: exige gesto, como um navegador comum na primeira visita.
  const masterBrowser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const playerBrowser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--autoplay-policy=document-user-activation-required"] });
  browsers.push(masterBrowser, playerBrowser);
  async function pageFor(browser, client, mobile = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: mobile ? "reduce" : "no-preference" });
    await context.addCookies(client.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    // O Chrome sob automação concede ativação nas avaliações do Playwright, então a política real de autoplay
    // não bloqueia. No navegador do jogador, a recusa é emulada: play() rejeita com NotAllowedError até um
    // clique/tecla confiável na página, como faz um navegador comum na primeira visita.
    if (browser === playerBrowser) await context.addInitScript(() => {
      let activated = false;
      const mark = (event) => { if (event.isTrusted) activated = true; };
      addEventListener("pointerdown", mark, true);
      addEventListener("keydown", mark, true);
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return activated ? original.call(this) : Promise.reject(new DOMException("Autoplay bloqueado (emulado)", "NotAllowedError"));
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${mobile ? "mobile" : "desktop"}: ${e.message}`));
    page.on("console", (m) => { if (/Content Security Policy|violates.*directive|Refused to (apply|execute|load)/i.test(m.text())) errors.push(m.text()); });
    return { context, page };
  }
  const ready = (page) => page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy"), { timeout: 20000 });
  async function shot(page, name) {
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: sem rolagem horizontal`);
    await page.screenshot({ path: `${dir}/${name}.png` });
    shots.push(`${name}.png`);
  }
  const audioState = (page) => page.evaluate(() => {
    const a = document.querySelector("audio[data-session-audio]");
    return a ? { time: a.currentTime * 1000, paused: a.paused, src: a.getAttribute("src") || "", rate: a.playbackRate } : null;
  });
  // Posição esperada pelo estado autoritativo, calculada no próprio navegador a partir de /live.
  const expectedNow = (page) => page.evaluate(async (sid) => {
    const r = await fetch(`/api/sessions/${sid}/live`, { headers: { "X-Eternnus": "1" } });
    const t0 = Date.now(); const live = await r.json();
    const m = live.music;
    if (!m.trackId) return null;
    const elapsed = m.playing ? Date.parse(live.serverTime) - Date.parse(m.referenceAt) + (Date.now() - t0) : 0;
    return { position: m.positionMs + Math.max(0, elapsed), playing: m.playing, version: m.version };
  }, session.id);
  async function aligned(page, label, tolerance = 700) {
    let last;
    for (let i = 0; i < 60; i++) {
      const [state, expected] = [await audioState(page), await expectedNow(page)];
      last = { state, expected };
      if (state && expected && Math.abs(state.time - expected.position) <= tolerance && state.paused === !expected.playing) {
        measures.push({ label, driftMs: Math.round(state.time - expected.position), paused: state.paused });
        return state;
      }
      await wait(250);
    }
    throw new Error(`${label}: fora de alinhamento ${JSON.stringify(last)}`);
  }

  // ---------- Catálogo no Painel admin ----------
  const { page: lib } = await pageFor(masterBrowser, admin);
  await lib.goto(`${env.origin}/#admin/music`);
  await lib.locator(".ml-row").first().waitFor({ timeout: 20000 });
  await ready(lib);
  check(await lib.locator(".ml-row").count() === 2, "catálogo lista as faixas enviadas");
  check(/2 de 200 faixas/.test(await lib.locator("#am-usage").textContent()), "uso da quota visível");
  check(await lib.locator('[data-help="admin.musicas.catalogo"]').count() === 1, "ajuda do catálogo registrada");
  await lib.locator("#am-search").fill("tema");
  await lib.waitForFunction(() => document.querySelectorAll(".ml-row").length === 1);
  check(true, "busca filtra o catálogo");
  await lib.locator("#am-search").fill("nada-assim");
  await lib.locator(".ml-list .feed-empty").waitFor();
  check(true, "busca sem resultado tem estado próprio");
  await lib.locator("#am-search").fill("");
  await lib.waitForFunction(() => document.querySelectorAll(".ml-row").length === 2);
  await lib.locator('.section-title [data-action="am-upload"]').click();
  await lib.locator("#am-file").setInputFiles(uploadFile);
  check((await lib.locator("#am-title").inputValue()) === "batalha final", "título sugerido pelo nome do arquivo");
  await lib.locator('#am-upload button[type="submit"]').click();
  await lib.waitForFunction(() => document.querySelectorAll(".ml-row").length === 3, null, { timeout: 20000 });
  check(true, "envio pela interface adiciona a faixa");
  await shot(lib, "01-catalogo-admin-desktop");

  // ---------- Mesa: mestre seleciona e toca ----------
  const { page: mp } = await pageFor(masterBrowser, master);
  await mp.goto(`${env.origin}/#table/${campaign.id}`);
  await mp.locator("#tab-soundtrack").waitFor({ timeout: 20000 });
  await ready(mp);
  const { context: playerContext, page: pp } = await pageFor(playerBrowser, player);
  await pp.goto(`${env.origin}/#table/${campaign.id}`);
  await pp.locator("#tab-soundtrack").waitFor({ timeout: 20000 });
  await ready(pp);
  check(await pp.locator("#t-audio").isHidden(), "sem faixa, o selo da trilha fica oculto");
  await mp.locator("#tab-soundtrack").click();
  await mp.locator(".st-track-row").first().waitFor();
  check(await mp.locator(".st-track-row").count() === 3, "painel da mesa lista o acervo");
  await mp.locator("#st-search").fill("tema");
  await mp.waitForFunction(() => document.querySelectorAll(".st-track-row").length === 1);
  await mp.locator('[data-action="st-select"]').first().click();
  await mp.locator('.st-now[data-status="playing"]').waitFor({ timeout: 15000 });
  check(await mp.locator(".music-control").isHidden(), "trilha global suspensa enquanto a sessão toca");
  await aligned(mp, "mestre após selecionar");

  // ---------- Jogador: autoplay bloqueado e ativação ----------
  try { await pp.locator('.session-audio[data-status="blocked"]').waitFor({ timeout: 15000 }); }
  catch (error) {
    console.error("estado do jogador:", await pp.evaluate(() => ({ status: document.querySelector(".session-audio")?.dataset.status, text: document.querySelector(".sa-status")?.textContent, hidden: document.querySelector("#t-audio")?.hidden })), await audioState(pp));
    throw error;
  }
  check(await pp.locator(".sa-unlock").isVisible(), "jogador vê “Ativar áudio da sessão” quando o navegador bloqueia");
  check(/bloqueado/i.test(await pp.locator(".sa-status").textContent()), "estado bloqueado anunciado no selo");
  await shot(pp, "02-jogador-bloqueado");
  await pp.locator(".sa-unlock").click();
  await pp.locator('.session-audio[data-status="playing"]').waitFor({ timeout: 15000 });
  const afterUnlock = await aligned(pp, "jogador após ativar");
  check(!afterUnlock.paused, "jogador ouve após o gesto");
  const [mNow, pNow] = [await audioState(mp), await audioState(pp)];
  measures.push({ label: "mestre × jogador tocando", diffMs: Math.round(Math.abs(mNow.time - pNow.time)) });
  check(Math.abs(mNow.time - pNow.time) < 1000, "mestre e jogador na mesma posição (±1 s)");
  check(await pp.locator(".music-control").isHidden(), "trilha global do jogador suspensa");

  // Controles pessoais: silenciar e volume não alteram o mestre.
  await pp.locator("#tab-soundtrack").click();
  await pp.locator(".soundtrack .st-personal").waitFor();
  check(await pp.locator(".st-controls").count() === 0, "jogador não recebe controles de reprodução");
  await pp.locator(".st-mute").click();
  check(await pp.evaluate(() => document.querySelector("audio[data-session-audio]").muted), "silenciar vale para o jogador");
  check(!(await mp.evaluate(() => document.querySelector("audio[data-session-audio]").muted)), "silêncio do jogador não afeta o mestre");
  await pp.locator(".st-mute").click();
  await pp.locator("#st-volume").fill("40");
  check(Math.abs(await pp.evaluate(() => document.querySelector("audio[data-session-audio]").volume) - 0.4) < 0.01, "volume pessoal aplicado");
  check(Math.abs(await mp.evaluate(() => document.querySelector("audio[data-session-audio]").volume) - 0.8) < 0.01, "volume do mestre preservado");
  await shot(pp, "03-jogador-painel");

  // ---------- Pausa ----------
  await mp.locator('[data-action="st-toggle"]').click();
  await mp.locator('.st-now[data-status="paused"]').waitFor();
  await pp.locator('.session-audio[data-status="paused"]').waitFor({ timeout: 8000 });
  const pm = await aligned(mp, "mestre pausado", 400), pj = await aligned(pp, "jogador pausado", 400);
  check(pm.paused && pj.paused, "pausa chega ao jogador");
  check(Math.abs(pm.time - pj.time) < 400, "pausados no mesmo ponto");

  // ---------- Busca na faixa e retomada ----------
  await mp.locator("#st-seek").fill("60");
  await wait(1200);
  await aligned(mp, "mestre após buscar 1:00", 500);
  const sought = await aligned(pp, "jogador após buscar 1:00", 500);
  check(Math.abs(sought.time - 60000) < 600, "busca levou o jogador a 1:00");
  await mp.locator('[data-action="st-toggle"]').click();
  await pp.locator('.session-audio[data-status="playing"]').waitFor({ timeout: 8000 });
  await aligned(pp, "jogador após retomar");
  await mp.locator('[data-action="st-loop"]').click();
  await mp.waitForFunction(() => document.querySelector(".st-loop-button")?.getAttribute("aria-pressed") === "true");
  check(true, "repetição alternada pelo mestre");

  // ---------- Desvio local corrigido sem intervenção ----------
  await pp.evaluate(() => { const a = document.querySelector("audio[data-session-audio]"); a.currentTime += 6; });
  await wait(3000);
  await aligned(pp, "jogador após desvio artificial de 6 s");
  check(true, "desvio grande corrigido pela conferência periódica");

  // ---------- Reconexão: jogador offline enquanto o mestre busca ----------
  await playerContext.setOffline(true);
  await wait(1000);
  await mp.locator('[data-action="st-forward"]').click();
  await wait(800);
  await mp.locator('[data-action="st-forward"]').click();
  await wait(1500);
  await playerContext.setOffline(false);
  await pp.locator("#connection-banner").waitFor({ state: "hidden", timeout: 30000 });
  await aligned(pp, "jogador após reconectar", 800);
  check(true, "reconexão alinha ao estado atual");

  // ---------- Recarga (entrada tardia) e bloqueio novamente ----------
  await pp.reload();
  await pp.locator("#t-audio:not([hidden])").waitFor({ timeout: 20000 });
  await pp.locator('.session-audio[data-status="blocked"]').waitFor({ timeout: 15000 });
  await pp.locator(".sa-unlock").click();
  await aligned(pp, "jogador após recarregar e ativar");
  check(true, "entrada tardia acompanha a posição atual");

  // ---------- Exclusão bloqueada da faixa em uso ----------
  await lib.reload();
  await lib.locator(".ml-row.is-current").waitFor({ timeout: 20000 });
  check(await lib.locator('.ml-row.is-current [data-action="am-delete-blocked"]').getAttribute("aria-disabled") === "true", "faixa em uso não pode ser excluída");
  check(await lib.locator("#am-in-use").isVisible(), "motivo do bloqueio visível");

  // ---------- Celular (jogador) ----------
  const { page: mobile } = await pageFor(playerBrowser, player, true);
  await mobile.goto(`${env.origin}/#table/${campaign.id}`);
  await mobile.locator("#t-audio:not([hidden])").waitFor({ timeout: 20000 });
  await ready(mobile);
  for (const selector of [".sa-open", ".sa-mute"]) {
    const box = await mobile.locator(selector).boundingBox();
    check(box.height >= 44 && box.width >= 44, `${selector} com alvo de toque ≥ 44 px`);
  }
  await shot(mobile, "04-jogador-celular-mapa");
  await mobile.locator(".sa-open").click();
  await mobile.locator(".soundtrack").waitFor();
  const turnTop = await mobile.evaluate(() => document.querySelector(".table-bottom")?.getBoundingClientRect().top ?? innerHeight);
  await mobile.locator(".st-personal").scrollIntoViewIfNeeded();
  const personal = await mobile.locator(".st-mute").boundingBox();
  check(personal.y + personal.height <= turnTop + 1, "controles pessoais não ficam sob a barra inferior");
  await shot(mobile, "05-jogador-celular-trilha");
  const { page: masterMobile } = await pageFor(masterBrowser, master, true);
  await masterMobile.goto(`${env.origin}/#table/${campaign.id}`);
  await masterMobile.locator("#t-audio:not([hidden])").waitFor({ timeout: 20000 });
  await masterMobile.locator(".sa-open").click();
  await masterMobile.locator(".st-controls").waitFor();
  for (const button of await masterMobile.locator(".st-controls button").all()) check((await button.boundingBox()).height >= 44, "controle do mestre com 44 px no celular");
  await shot(masterMobile, "06-mestre-celular-trilha");
  await masterMobile.context().close();
  await mobile.context().close();

  // ---------- Parar: selo some e a trilha global volta ----------
  await mp.locator('[data-action="st-stop"]').click();
  await pp.locator("#t-audio").waitFor({ state: "hidden", timeout: 8000 });
  check(!(await audioState(pp)).src, "jogador descarta a faixa ao parar");
  check(await pp.locator(".music-control").isVisible(), "trilha global volta após parar");
  await shot(mp, "07-mestre-parado");

  // Descarte ao sair da mesa: o elemento de áudio da sessão é removido.
  await pp.evaluate(() => { location.hash = "campaigns"; });
  await pp.waitForFunction(() => !document.querySelector("audio[data-session-audio]"), null, { timeout: 10000 });
  check(true, "sair da mesa descarta o áudio da sessão");

  check(errors.length === 0, `sem erros de página ou CSP: ${errors.join(" | ")}`);
  await writeFile(`${dir}/report.json`, JSON.stringify({ checks: checks.length, measures, screenshots: shots }, null, 2));
  console.log(`soundtrack-ui.mjs: ${checks.length} verificações; medidas: ${JSON.stringify(measures)}`);
} catch (error) {
  console.error(errors.join("\n"));
  console.error(env.logs().slice(-3000));
  throw error;
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  await env.stop();
}
