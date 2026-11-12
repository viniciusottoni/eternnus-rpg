/**
 * Editar marcador (ADR-080) com PostgreSQL real: renomear e trocar o lado de uma criatura,
 * vincular ficha a um marcador criado "Sem ficha", recusa ao jogador e ao personagem de jogador,
 * dica de seleção sem ficha e modal "Editar marcador" no navegador.
 */
import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
const env = await startEnvironment({ port: 5348 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/token-edit';
try {
  const master = await env.verifiedClient('editar.master@example.test', 'Aurora'), player = await env.verifiedClient('editar.player@example.test', 'Lira');
  const c = await master('/api/campaigns', 'POST', { name: 'Cripta Antiga', description: 'Editar marcador.', rpgSystemId: '00000000-0000-4000-8000-000000000001', playMode: 'turns' });
  const path = `/api/campaigns/${c.id}`;
  await player('/api/campaigns/join', 'POST', { code: (await master(path)).inviteCode });
  const session = await master(path + '/sessions', 'POST', { title: 'Cripta', objective: '', mapKind: 'tileset', mapKey: 'crypt' });
  const hero = await player('/api/characters', 'POST', { campaignId: c.id, name: 'Íris', values: {} });
  await player(`/api/sessions/${session.id}/join`, 'POST', { characterId: hero.id }, 204);
  await master(`/api/sessions/${session.id}/join`, 'POST', {}, 204);
  const base = `/api/sessions/${session.id}`;
  await master(base + '/fog/enabled', 'POST', { enabled: false }, 204);
  let live = await master(base + '/live');
  const mine = live.tokens.find((t) => t.characterId === hero.id);
  const settings = (extra = {}) => ({ light: null, vision: null, perception: null, senses: null, hidden: false, dc: null, detectSense: null, detectRange: null, ...extra });

  // Criatura sem ficha: renomear e trocar o lado pela API; cliente anterior (sem os campos novos) não muda nada.
  const skeleton = await master(base + '/tokens', 'POST', { label: 'Esqueleto', side: 'enemy', x: mine.x + 3, y: mine.y + 1, hidden: false });
  check(skeleton.masterCharacterId, null, 'criatura criada sem ficha');
  await master(`${base}/tokens/${skeleton.id}/settings`, 'POST', settings(), 204);
  await master(`${base}/tokens/${skeleton.id}/settings`, 'POST', settings({ label: 'Esqueleto arqueiro', side: 'neutral' }), 204);
  await player(`${base}/tokens/${skeleton.id}/settings`, 'POST', settings({ label: 'Intruso' }), 403);
  await master(`${base}/tokens/${skeleton.id}/settings`, 'POST', settings({ label: '' }), 400);
  await master(`${base}/tokens/${mine.id}/settings`, 'POST', settings({ label: 'Outra' }), 409);
  live = await player(base + '/live');
  const seen = live.tokens.find((t) => t.id === skeleton.id);
  check([seen.label, seen.side], ['Esqueleto arqueiro', 'neutral'], 'jogador vê o nome e o lado novos');
  ok(JSON.stringify((await master(base + '/live')).events).includes('renomeou Esqueleto para Esqueleto arqueiro'), 'mestre recebe o evento de renomear');
  ok(!JSON.stringify(live.events || []).includes('renomeou'), 'evento de renomear fica só com o mestre');

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client) { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' }); await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; })); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return page; }
  const ready = (page) => page.waitForFunction(() => !document.querySelector('#app').inert && document.querySelector('.board-canvas')?.width > 0, null, { timeout: 20000 });

  const m = await ui(master);
  await m.goto(env.origin + `/#table/${c.id}`);
  await ready(m);
  const map = (await master(base + '/live')).map;
  const cols = map.rows[0].length, rows = map.rows.length;
  const toScreen = (cx, cy) => m.evaluate(([cx, cy, cols, rows]) => {
    const el = document.querySelector('.board-canvas'), r = el.getBoundingClientRect();
    const cell = Math.min(r.width / cols, r.height / rows), ox = (r.width - cell * cols) / 2, oy = (r.height - cell * rows) / 2;
    return { x: r.left + ox + cx * cell, y: r.top + oy + cy * cell };
  }, [cx, cy, cols, rows]);

  // Seleção: dica avisa que não há ficha; "Editar marcador" aparece só para criatura.
  // O painel lateral termina de montar depois do primeiro desenho: espera o tamanho do mapa estabilizar.
  await m.waitForFunction(() => new Promise((done) => { const el = document.querySelector('.board-canvas'); const w = el.width; setTimeout(() => done(el.width === w), 400); }), null, { timeout: 15000 });
  await m.waitForTimeout(600);
  const at = await toScreen(seen.x + 0.5, seen.y + 0.5);
  await m.mouse.click(at.x, at.y);
  const edit = m.locator('[data-action=t-token-edit]').filter({ visible: true }).first();
  await edit.waitFor({ timeout: 15000 });
  ok(/Sem ficha/.test(await m.locator('#t-hint').textContent()), 'dica de seleção avisa que a criatura não tem ficha');
  check(await m.locator('[data-action=t-token-sheet]').filter({ visible: true }).count(), 0, 'sem ficha, sem “Ficha do elemento”');

  // Modal: nome e lado atuais, luz/visão recolhidas, ficha para vincular.
  await edit.click();
  await m.locator('#token-settings-form').waitFor();
  check(await m.locator('#f-tlabel').inputValue(), 'Esqueleto arqueiro', 'modal mostra o nome atual');
  check(await m.locator('#f-tside').inputValue(), 'neutral', 'modal mostra o lado atual');
  check(await m.locator('details.token-advanced').getAttribute('open'), null, 'luz, visão e ocultação recolhidas na Básica');
  check(await m.evaluate(() => document.activeElement?.id), 'f-tlabel', 'foco no nome');
  const template = await m.locator('#f-template option:not([value=""])').first().getAttribute('value');
  ok(template, 'há modelo de ficha para vincular');
  await m.screenshot({ path: `${out}/master-edit-modal.png`, animations: 'disabled' });
  await m.fill('#f-tlabel', 'Esqueleto guardião');
  await m.selectOption('#f-tside', 'enemy');
  await m.selectOption('#f-template', template);
  await m.locator('#token-settings-form button[type=submit]').click();
  let linked = null;
  for (let i = 0; i < 30 && !linked; i++) { const t = (await master(base + '/live')).tokens.find((x) => x.id === skeleton.id); if (t.masterCharacterId) linked = t; else await new Promise(r => setTimeout(r, 200)); }
  ok(linked, 'ficha vinculada pelo modal');
  check([linked?.label, linked?.side], ['Esqueleto guardião', 'enemy'], 'nome e lado salvos pelo modal');
  await m.locator('[data-action=t-token-sheet]').filter({ visible: true }).first().waitFor({ timeout: 15000 });
  ok(!/Sem ficha/.test(await m.locator('#t-hint').textContent()), 'dica deixa de avisar depois do vínculo');
  await m.screenshot({ path: `${out}/master-linked.png`, animations: 'disabled' });

  // Segundo vínculo é recusado; o modal passa a orientar para "Ficha do elemento".
  await master(`${base}/tokens/${skeleton.id}/settings`, 'POST', settings({ templateId: template }), 409);
  await edit.click();
  await m.locator('#token-settings-form').waitFor();
  check(await m.locator('#f-template').count(), 0, 'marcador vinculado não oferece outro vínculo');
  await m.keyboard.press('Escape');
  check(errors, [], 'sem erros no navegador');
  console.log('token-edit: ok');
} finally {
  await browser?.close();
  await env.stop();
}
