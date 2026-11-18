/**
 * ADR-100 (criar → jogar) com PostgreSQL real e navegador:
 * aventura de exemplo, contexto de início, sessão iniciada pela cena, "Colocar o grupo", desfazer marcador e névoa
 * (tamanho do evento no limite real de 4.000 caracteres e corridas sob FOR UPDATE), trocar/remover ficha do NPC,
 * one-shot de exemplo; no navegador: checklist, modal de início, Busca de ações, lista de NPCs arrastável,
 * predefinições de luz, celular do jogador e custo de desenho de uma cena pesada.
 */
import { startEnvironment } from "./support/harness.mjs";
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const env = await startEnvironment({ port: 5352 });
let browser;
const { check, ok, sql } = env;
const out = "artifacts/qa/simplicidade";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const master = await env.verifiedClient("simples.mestre@example.test", "Aurora");
  const player = await env.verifiedClient("simples.jogador@example.test", "Lira");
  const outsider = await env.verifiedClient("simples.fora@example.test", "Forasteiro");

  // N1 — aventura de exemplo: cena pronta, 2 NPCs, premissa e objetivo.
  const c = await master("/api/campaigns", "POST", { name: "Sino da Cripta", description: "", rpgSystemId: "00000000-0000-4000-8000-000000000001", playMode: "turns", starter: true });
  ok(c.starterSceneId, "campanha com aventura de exemplo devolve a cena pronta");
  const path = `/api/campaigns/${c.id}`;
  const detail = await master(path);
  check(detail.sceneCount, 1, "detalhe do mestre conta a cena pronta");
  ok(detail.description?.length > 0, "descrição vazia recebe a premissa");
  const npcs = (await master(path + "/npcs")).items;
  check(npcs.length, 2, "dois NPCs de exemplo");
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  check((await player(path)).sceneCount ?? null, null, "jogador não recebe a contagem de cenas");

  // J9 — contexto de início em uma chamada; só o mestre.
  const start = await master(path + "/sessions/start-context");
  check([start.context.nextNumber, start.context.hasSessions], [1, false], "primeira sessão é a 01");
  ok(start.context.scenes.some((s) => s.id === c.starterSceneId), "cena de exemplo aparece para iniciar");
  ok(Array.isArray(start.chapters.items), "capítulos na mesma resposta");
  await player(path + "/sessions/start-context", "GET", undefined, 403);
  await outsider(path + "/sessions/start-context", "GET", undefined, 404);

  // J1/J5 — sem nome, iniciada pela cena: cena apresentada na mesma transação.
  const hero = await player("/api/characters", "POST", { campaignId: c.id, name: "Íris", values: {} });
  await master(path + "/sessions", "POST", { title: "", objective: "", mapKind: null, mapKey: null, sceneId: "00000000-0000-0000-0000-000000000001" }, 404);
  const session = await master(path + "/sessions", "POST", { title: "", objective: "", mapKind: "tileset", mapKey: "crypt", sceneId: c.starterSceneId });
  check([session.number, session.sceneId], [1, c.starterSceneId], "sessão 01 aberta pela cena");
  const base = `/api/sessions/${session.id}`;
  await player(base + "/join", "POST", { characterId: hero.id }, 204);
  await master(base + "/join", "POST", {}, 204);
  let live = await master(base + "/live");
  ok(JSON.stringify(live.events).includes("Sessão 01 iniciada"), "evento de início usa “Sessão 01”");
  ok(JSON.stringify(live).includes("O sino da cripta"), "cena de exemplo já apresentada");
  check((await master(path + "/sessions/start-context")).context.nextNumber, 2, "próximo número avança");

  // Casas livres da cripta.
  const layer = await master(`${path}/assets/layers?key=crypt`);
  const occupied = new Set(live.tokens.map((t) => `${t.x},${t.y}`));
  const free = [];
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) if (layer.cells[y][x] === "." && layer.rows[y][x] === "." && !occupied.has(`${x},${y}`)) free.push({ x, y });
  ok(free.length > 20, "cripta tem casas livres");
  const pick = () => free.splice(Math.floor(free.length / 2), 1)[0];

  // N3 — Colocar o grupo: só o mestre; cada movimento pode ser desfeito.
  const mine = live.tokens.find((t) => t.characterId === hero.id);
  const away = pick();
  await master(`${base}/tokens/${mine.id}/move`, "POST", { x: away.x, y: away.y }, null);
  await player(base + "/party/gather", "POST", {}, 403);
  const gathered = await master(base + "/party/gather", "POST", {});
  check(gathered.moved + gathered.placed, 1, "um personagem colocado na entrada");
  live = await master(base + "/live");
  const moveEvent = [...live.events].reverse().find((e) => e.kind === "move" && (e.data || "").includes("undoable"));
  ok(moveEvent, "movimento do grupo é desfazível");

  // N5 — marcador adicionado: desfazer só pelo mestre.
  const spot = pick();
  const wolf = await master(base + "/tokens", "POST", { label: "Lobo", side: "enemy", x: spot.x, y: spot.y, hidden: false });
  live = await master(base + "/live");
  const added = [...live.events].reverse().find((e) => e.kind === "token" && (e.data || "").includes(wolf.id));
  ok(added && added.data.includes('"undoable":true'), "adição gera evento desfazível");
  await player(base + "/undo", "POST", { eventId: added.id }, 403);
  await master(base + "/undo", "POST", { eventId: added.id }, 204);
  ok(!(await master(base + "/live")).tokens.some((t) => t.id === wolf.id), "adição desfeita remove o marcador");

  // N5 — marcador removido volta com configurações; jogador nunca vê o retrato; corrida de dois desfazer.
  const spot2 = pick();
  const ogre = await master(base + "/tokens", "POST", { label: "Ogro", side: "enemy", x: spot2.x, y: spot2.y, hidden: false });
  await master(`${base}/tokens/${ogre.id}/settings`, "POST", { light: 2, vision: 3, perception: null, senses: null, hidden: false, dc: 15, detectSense: "faro", detectRange: 4 }, 204);
  await master(`${base}/tokens/${ogre.id}`, "DELETE", undefined, 204);
  live = await master(base + "/live");
  const removed = [...live.events].reverse().find((e) => e.kind === "token" && (e.data || "").includes("snapshot"));
  ok(removed?.masterOnly, "retrato da remoção é privado do mestre");
  const playerLive = await player(base + "/live");
  ok(!JSON.stringify(playerLive.events).includes("snapshot") && !JSON.stringify(playerLive.events).includes("faro"), "jogador não recebe retrato nem segredo");
  ok(!playerLive.events.some((e) => (e.content || "").includes("Ogro")), "com névoa ativa, inimigo removido não é anunciado ao jogador");
  const race = await Promise.all([1, 2].map(() => master(base + "/undo", "POST", { eventId: removed.id }, null, { raw: true })));
  check(race.map((r) => r.status).sort(), [204, 409], "dois desfazer simultâneos: um vence, outro 409");
  const back = (await master(base + "/live")).tokens.filter((t) => t.id === ogre.id);
  check(back.length, 1, "marcador volta uma única vez");
  check(Number(sql(`SELECT count(*) FROM "SessionTokens" WHERE "Id"='${ogre.id}'`)), 1, "sem duplicata no banco");
  check([back[0].label, back[0].x, back[0].y], ["Ogro", spot2.x, spot2.y], "volta no mesmo lugar");

  // N5 — névoa: padrão xadrez (muitas faixas) cabe nos 4.000 caracteres do PostgreSQL e é desfeito.
  await master(base + "/fog/enabled", "POST", { enabled: true }, 204);
  const cells = [];
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) if ((x + y) % 2 === 0) cells.push({ x, y });
  await master(base + "/fog/paint", "POST", { tool: "conceal", cells: cells.map(({ x, y }) => ({ x, y })) }, 204);
  await master(base + "/fog/paint", "POST", { tool: "reveal", cells }, 204);
  const longest = Number(sql(`SELECT coalesce(max(length("Data")),0) FROM "Events" WHERE "SessionId"='${session.id}'`));
  ok(longest <= 4000, `maior evento cabe no limite (${longest} caracteres)`);
  live = await master(base + "/live");
  const paint = [...live.events].reverse().find((e) => e.kind === "map" && (e.data || "").includes('"cells"'));
  ok(paint?.masterOnly && paint.data.includes('"undoable":true'), "pintura de névoa desfazível e privada");
  const before = JSON.stringify(live.fog);
  const fogRace = await Promise.all([1, 2].map(() => master(base + "/undo", "POST", { eventId: paint.id }, null, { raw: true })));
  check(fogRace.map((r) => r.status).sort(), [204, 409], "desfazer névoa concorrente: um vence");
  ok(JSON.stringify((await master(base + "/live")).fog) !== before, "névoa voltou ao estado anterior");
  ok(!JSON.stringify((await player(base + "/live")).events).includes('"cells"'), "jogador não recebe as casas pintadas");

  // J7 — trocar/remover a ficha do NPC na mesa; NPC continua em Preparação.
  const spot3 = pick();
  const guard = await master(base + "/npc-tokens", "POST", { masterCharacterId: npcs[0].id, x: spot3.x, y: spot3.y });
  const settings = (extra) => ({ light: null, vision: null, perception: null, senses: null, hidden: false, dc: null, detectSense: null, detectRange: null, ...extra });
  await player(`${base}/tokens/${guard.id}/settings`, "POST", settings({ unlinkSheet: true }), 403);
  await master(`${base}/tokens/${guard.id}/settings`, "POST", settings({ unlinkSheet: true }), 204);
  check((await master(base + "/live")).tokens.find((t) => t.id === guard.id).masterCharacterId ?? null, null, "ficha desvinculada");
  ok((await master(path + "/npcs")).items.some((n) => n.id === npcs[0].id), "NPC segue em Preparação");
  await master(`${base}/tokens/${mine.id}/settings`, "POST", settings({ unlinkSheet: true }), 409);

  // N1 — one-shot de exemplo abre com a cena apresentada.
  const one = await master("/api/one-shots", "POST", { name: "Noite rápida", description: "", rpgSystemId: "00000000-0000-4000-8000-000000000001", starter: true });
  ok(one.starterSceneId && one.sessionId, "one-shot devolve a cena de exemplo");
  ok(JSON.stringify(await master(`/api/sessions/${one.sessionId}/live`)).includes("O sino da cripta"), "one-shot abre na cena");

  // ---------------- Navegador ----------------
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [];
  await mkdir(out, { recursive: true });
  async function ui(client, viewport = { width: 1440, height: 1000 }, extra = {}) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", reducedMotion: "reduce", ...extra });
    await context.addCookies(client.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return page;
  }
  const settled = (page) => page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy"), null, { timeout: 20000 });
  const boardReady = (page) => page.waitForFunction(() => !document.querySelector("#app").inert && document.querySelector(".board-canvas")?.width > 0, null, { timeout: 20000 });

  // J2/J5 — campanha nova (sem sessão): checklist e modal de início pela cena.
  const fresh = await master("/api/campaigns", "POST", { name: "Ruínas Novas", description: "", rpgSystemId: "00000000-0000-4000-8000-000000000001", playMode: "turns", starter: true });
  const m = await ui(master);
  await m.goto(`${env.origin}/#campaign/${fresh.id}`);
  await m.locator(".readiness").waitFor({ timeout: 20000 });
  await settled(m);
  const items = await m.locator(".readiness li").allTextContents();
  check(items.length, 3, "checklist com três itens");
  ok(/1 cena/.test(items[2]), "checklist conta a cena pronta");
  await m.screenshot({ path: `${out}/checklist-desktop.png`, animations: "disabled" });
  await m.locator('.first-steps [data-action="cp-start"]').click();
  await m.locator("#start-session").waitFor({ timeout: 8000 });
  check(await m.locator('#start-session input[name="start"]:checked').getAttribute("value"), fresh.starterSceneId, "modal já escolhe a cena pronta");
  check(await m.locator("#start-session details.start-more").getAttribute("open"), null, "nome/objetivo/capítulo recolhidos");
  check(await m.locator("#start-session details.start-map").getAttribute("open"), null, "mapa recolhido quando a cena está escolhida");
  await m.screenshot({ path: `${out}/start-modal-desktop.png`, animations: "disabled" });
  await m.locator('#start-session button[type="submit"]').click();
  await m.waitForURL(/#table\//, { timeout: 20000 });
  await boardReady(m);
  ok((await m.locator(".board-canvas").count()) === 1, "mesa abre direto após iniciar");
  const freshSession = await master(`/api/campaigns/${fresh.id}`);
  ok(JSON.stringify(freshSession).length > 0, "campanha nova online");

  // Mesa principal (sessão com jogador): Busca de ações, NPC dock, predefinições.
  await m.goto(`${env.origin}/#table/${c.id}`);
  await boardReady(m);
  await m.waitForFunction(() => new Promise((done) => { const el = document.querySelector(".board-canvas"); const w = el.width; setTimeout(() => done(el.width === w), 400); }), null, { timeout: 15000 });
  await m.keyboard.press("Control+k");
  const palette = m.locator('.command-palette input[role="combobox"]');
  await palette.waitFor({ timeout: 5000 });
  await palette.fill("grupo");
  const firstOption = m.locator('.command-palette [role="option"]').first();
  ok(/grupo/i.test(await firstOption.textContent()), "Busca encontra “Colocar o grupo”");
  await m.screenshot({ path: `${out}/palette-table.png`, animations: "disabled" });
  await m.keyboard.press("Escape");
  ok(!(await m.locator(".command-palette").isVisible().catch(() => false)), "Esc fecha a Busca");
  await m.locator('[data-action="t-palette"]').filter({ visible: true }).first().click();
  await palette.waitFor({ timeout: 5000 });
  await m.keyboard.press("Escape");

  // N2 — lista de NPCs: abrir, "Colocar" por clique; arrastar para o mapa.
  const dock = m.locator("#t-npc-dock");
  await dock.locator("summary").click();
  await m.locator("#t-npc-dock-list [data-npc-drag]").first().waitFor({ timeout: 10000 });
  check(await m.locator("#t-npc-dock-list [data-npc-drag]").count(), 2, "lista mostra os 2 NPCs");
  const before2 = (await master(base + "/live")).tokens.length;
  const map = (await master(base + "/live")).map;
  const cols = map.rows[0].length, rows = map.rows.length;
  const toScreen = (cx, cy) => m.evaluate(([cx, cy, cols, rows]) => {
    const el = document.querySelector(".board-canvas"), r = el.getBoundingClientRect();
    const cell = Math.min(r.width / cols, r.height / rows), ox = (r.width - cell * cols) / 2, oy = (r.height - cell * rows) / 2;
    return { x: r.left + ox + cx * cell, y: r.top + oy + cy * cell };
  }, [cx, cy, cols, rows]);
  const target = pick();
  await m.locator('#t-npc-dock-list [data-action="t-npc-place"]').nth(1).click();
  const at = await toScreen(target.x + 0.5, target.y + 0.5);
  await m.mouse.click(at.x, at.y);
  let afterPlace = before2;
  for (let i = 0; i < 30 && afterPlace === before2; i++) { afterPlace = (await master(base + "/live")).tokens.length; if (afterPlace === before2) await pause(200); }
  check(afterPlace, before2 + 1, "“Colocar” + clique no mapa adiciona o NPC");
  const dropCell = pick();
  const dropAt = await toScreen(dropCell.x + 0.5, dropCell.y + 0.5);
  const box = await m.locator(".stage").boundingBox();
  await m.locator("#t-npc-dock-list [data-npc-drag]").first().dragTo(m.locator(".stage"), { targetPosition: { x: dropAt.x - box.x, y: dropAt.y - box.y } });
  let afterDrop = afterPlace;
  for (let i = 0; i < 30 && afterDrop === afterPlace; i++) { afterDrop = (await master(base + "/live")).tokens.length; if (afterDrop === afterPlace) await pause(200); }
  check(afterDrop, afterPlace + 1, "arrastar da lista para o mapa adiciona o NPC");
  const dropped = (await master(base + "/live")).tokens.find((t) => t.x === dropCell.x && t.y === dropCell.y);
  ok(dropped, "NPC solto na casa apontada");
  await m.screenshot({ path: `${out}/npc-dock.png`, animations: "disabled" });
  // NPC criado em outra aba: a lista aberta se atualiza quando a mesa volta a ficar visível.
  await master(path + "/npcs", "POST", { name: "Sacristão", summary: "", notes: "", side: "neutral", resources: [] });
  await m.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await m.waitForFunction(() => document.querySelectorAll("#t-npc-dock-list [data-npc-drag]").length === 3, null, { timeout: 10000 });
  ok(/Sacristão/.test(await m.locator("#t-npc-dock-list").textContent()), "lista de NPCs atualiza ao voltar para a mesa");

  // J6 — predefinição de luz no marcador preenche o número.
  const sel = await toScreen(dropped.x + 0.5, dropped.y + 0.5);
  await m.mouse.click(sel.x, sel.y);
  await m.locator('[data-action="t-token-settings"], [data-action="t-token-edit"]').filter({ visible: true }).first().click();
  await m.locator("#token-settings-form").waitFor();
  const advanced = m.locator("#token-settings-form details.token-advanced");
  if (await advanced.count()) await advanced.locator("summary").click();
  await m.selectOption("#f-light-preset", "torch");
  check(await m.inputValue("#f-light"), "4", "Tocha preenche luz 4");
  await m.selectOption("#f-vision-preset", "long");
  check(await m.inputValue("#f-vision"), "12", "visão longa preenche 12");
  ok(await m.locator("[data-unlink-sheet]").count(), "NPC com ficha oferece trocar/remover");
  await m.locator("[data-unlink-sheet]").check();
  ok(await m.locator("[data-replace-sheet]").isVisible(), "marcar revela a escolha de nova ficha");
  await m.screenshot({ path: `${out}/token-presets.png`, animations: "disabled" });
  await m.locator('#token-settings-form button[type="submit"]').click();
  let saved;
  for (let i = 0; i < 30 && !saved; i++) { const t = (await master(base + "/live")).tokens.find((x) => x.id === dropped.id); if (t.light === 4 && !t.masterCharacterId) saved = t; else await pause(200); }
  ok(saved && saved.vision === 12, "luz/visão salvas e ficha desvinculada pelo modal");

  // J8 + celular — jogador em 844×390 (a mesa pede o celular deitado): navegação inferior e Busca acessíveis; vez do jogador leva ao Mapa.
  const p = await ui(player, { width: 844, height: 390 }, { isMobile: true, hasTouch: true });
  await p.goto(`${env.origin}/#table/${c.id}`);
  await p.waitForFunction(() => !document.querySelector("#app").inert && document.querySelector(".board-canvas"), null, { timeout: 20000 });
  await p.screenshot({ path: `${out}/player-mobile-entrada.png`, animations: "disabled" });
  const chat = p.locator('[data-action="t-view"]:not([data-id="map"])').last();
  if (await chat.count()) await chat.click();
  await master(base + "/turn", "POST", { characterId: hero.id }, null);
  const onMap = await p.waitForFunction(() => document.querySelector(".table-shell")?.dataset.view === "map" || document.querySelector('[data-action="t-view"][data-id="map"][aria-pressed="true"], [data-action="t-view"][data-id="map"][aria-current]'), null, { timeout: 8000 }).then(() => true, () => false);
  ok(onMap, "na vez do jogador o celular volta ao Mapa");
  const small = await p.evaluate(() => [...document.querySelectorAll(".bottom-nav a, .bottom-nav button, .table-nav button, [data-action=t-view]")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim()));
  check(small, [], "alvos da navegação inferior ≥ 44 px");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(overflow, false, "sem rolagem horizontal no celular");
  await p.screenshot({ path: `${out}/player-mobile.png`, animations: "disabled" });

  // N6 + desempenho — cena pesada: 1.500 paredes, mede tarefas longas ao abrir a mesa e mover um marcador.
  const walls = [];
  // Meias-arestas da grade dentro do mapa (unidade 100 = uma casa): horizontais e verticais até 1.500 segmentos.
  for (let y = 0; y <= layer.height && walls.length < 1500; y++) for (let x = 0; x < layer.width * 2 && walls.length < 1500; x++) walls.push({ x1: x * 50, y1: y * 100, x2: x * 50 + 50, y2: y * 100 });
  for (let x = 0; x <= layer.width && walls.length < 1500; x++) for (let y = 0; y < layer.height * 2 && walls.length < 1500; y++) walls.push({ x1: x * 100, y1: y * 50, x2: x * 100, y2: y * 50 + 50 });
  const wallBody = JSON.stringify({ walls });
  const wallSave = await master(base + "/fog/walls", "POST", { walls }, null, { raw: true });
  const perf = { walls: walls.length, wallsBytes: wallBody.length, wallsStatus: wallSave.status, wallsError: wallSave.status === 204 ? null : wallSave.data };
  if (wallSave.status === 204) {
    const h = await ui(master);
    await h.addInitScript(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true }); });
    const t0 = Date.now();
    await h.goto(`${env.origin}/#table/${c.id}`);
    await boardReady(h);
    perf.openMs = Date.now() - t0;
    await pause(1500);
    perf.longTasksOpen = await h.evaluate(() => window.__long.splice(0));
    const mv = pick();
    await master(`${base}/tokens/${guard.id}/move`, "POST", { x: mv.x, y: mv.y }, null);
    await pause(2000);
    perf.longTasksMove = await h.evaluate(() => window.__long.splice(0));
    await h.screenshot({ path: `${out}/heavy-table.png`, animations: "disabled" });
    ok(perf.longTasksMove.every((d) => d < 1000), "redesenho após mover sem travar ≥ 1 s");
  }
  // Teto do domínio alcançável pelo editor: 2.000 paredes no formato que o editor reenvia (com id, tipo, porta, oculta).
  // Com o corpo comum de 64 KiB só cabiam ~530 (UploadLimits.LayerRequestBytes, ADR-100).
  const layerPath = `${path}/assets/layers?key=crypt`;
  const full = [];
  for (let y = 0; y <= layer.height && full.length < 2000; y++) for (let x = 0; x < layer.width * 4 && full.length < 2000; x++) full.push({ x1: x * 25, y1: y * 100, x2: x * 25 + 25, y2: y * 100 });
  for (let x = 0; x <= layer.width && full.length < 2000; x++) for (let y = 0; y < layer.height * 4 && full.length < 2000; y++) full.push({ x1: x * 100, y1: y * 25, x2: x * 100, y2: y * 25 + 25 });
  const current = await master(layerPath);
  const editorBody = { fog: current.fog, cells: current.cells, revealed: current.revealed, lights: current.lights || [], marks: [], revision: current.revision, prepVersion: current.prepVersion,
    walls: full.map((w, i) => ({ id: i.toString(16).padStart(32, "0"), ...w, kind: "wall", open: false, hidden: false })) };
  perf.editorLayerBytes = JSON.stringify(editorBody).length;
  await master(layerPath, "PUT", editorBody);
  check((await master(layerPath)).walls.length, 2000, "editor salva as 2.000 paredes do limite do domínio");
  editorBody.walls.push({ id: "f".repeat(32), x1: 0, y1: 0, x2: 0, y2: 100, kind: "wall", open: false, hidden: false });
  editorBody.revision = (await master(layerPath)).revision;
  await master(layerPath, "PUT", editorBody, 409);
  await writeFile(`${out}/performance.json`, JSON.stringify(perf, null, 2));
  console.log("desempenho:", JSON.stringify({ ...perf, longTasksOpen: perf.longTasksOpen?.map(Math.round), longTasksMove: perf.longTasksMove?.map(Math.round) }));

  check(errors, [], "sem erros no navegador");
  console.log(`simplicity: ok (${env.count()} verificações)`);
} catch (error) {
  console.error(env.logs().slice(-3000));
  throw error;
} finally {
  await browser?.close();
  await env.stop();
}
