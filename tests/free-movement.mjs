/**
 * Mapas com movimentação livre (ADR-074) com PostgreSQL real: envio com a opção, posição fina pela API,
 * casas compartilhadas, arraste no navegador soltando no ponto exato e grade oculta por padrão.
 */
import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, readFile } from 'node:fs/promises';
const env = await startEnvironment({ port: 5341 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/free-movement';
try {
  const master = await env.verifiedClient('livre.master@example.test', 'Aurora'), player = await env.verifiedClient('livre.player@example.test', 'Lira');
  const c = await master('/api/campaigns', 'POST', { name: 'Clareira Livre', description: 'Movimentação livre.', rpgSystemId: '00000000-0000-4000-8000-000000000001', playMode: 'free' });
  const path = `/api/campaigns/${c.id}`;
  await player('/api/campaigns/join', 'POST', { code: (await master(path)).inviteCode });

  // Envio com "Movimentação livre": 1672×941 com referência de 94 px → 17 × 10 casas.
  const png = await readFile('apps/Eternnus.Web/wwwroot/assets/valley.png');
  const form = new FormData();
  for (const [k, v] of [['name', 'Vale livre'], ['folderId', ''], ['gridPixels', '94'], ['scaleMeters', '1.5'], ['hasGrid', 'true'], ['gridOffsetX', '0'], ['gridOffsetY', '0'], ['freeMovement', 'true']]) form.append(k, v);
  form.append('file', new Blob([png], { type: 'image/png' }), 'vale.png');
  const map = await master(path + '/assets/maps', 'POST', form);
  check(map.freeMovement, true, 'mapa salvo com movimentação livre');
  ok(/Movimentação livre/.test((await master(path + '/maps')).items.find((m) => m.key === 'asset:' + map.id).description), 'descrição do mapa livre');
  // Sem grade, a opção é ignorada.
  const plain = new FormData();
  for (const [k, v] of [['name', 'Só imagem'], ['folderId', ''], ['gridPixels', '64'], ['scaleMeters', '1.5'], ['hasGrid', 'false'], ['freeMovement', 'true']]) plain.append(k, v);
  plain.append('file', new Blob([png], { type: 'image/png' }), 'so.png');
  check((await master(path + '/assets/maps', 'POST', plain)).freeMovement, false, 'apenas imagem não vira movimentação livre');

  const session = await master(path + '/sessions', 'POST', { title: 'Clareira', objective: '', mapKind: 'tileset', mapKey: 'asset:' + map.id });
  const hero = await player('/api/characters', 'POST', { campaignId: c.id, name: 'Íris', values: {} });
  await player(`/api/sessions/${session.id}/join`, 'POST', { characterId: hero.id }, 204);
  await master(`/api/sessions/${session.id}/join`, 'POST', {}, 204);
  const base = `/api/sessions/${session.id}`;
  // Com névoa, casas não exploradas recusam o movimento (como na grade); aqui o mapa todo fica visível.
  await master(base + '/fog/enabled', 'POST', { enabled: false }, 204);
  let live = await player(base + '/live');
  check(live.map.freeMovement, true, 'mesa recebe o modo livre');
  const mine = live.tokens.find((t) => t.characterId === hero.id);
  await player(`${base}/tokens/${mine.id}/move`, 'POST', { x: 3, y: 4, fx: 120, fy: 880 }, 204);
  await player(`${base}/tokens/${mine.id}/move`, 'POST', { x: 3, y: 4, fx: 1000, fy: 0 }, 400);
  // Criatura na mesma casa, em outro ponto (com grade seria 409).
  const wolf = await master(base + '/tokens', 'POST', { label: 'Lobo', side: 'enemy', x: 3, y: 4, fx: 700, fy: 300, hidden: false });
  live = await player(base + '/live');
  const at = (id) => live.tokens.find((t) => t.id === id);
  check([at(mine.id).x, at(mine.id).y, at(mine.id).fx, at(mine.id).fy], [3, 4, 120, 880], 'posição fina do personagem');
  check([at(wolf.id).x, at(wolf.id).y, at(wolf.id).fx, at(wolf.id).fy], [3, 4, 700, 300], 'casa compartilhada');

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client, mobile = false) { const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' }); await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; })); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return page; }

  // Formulário do acervo: três formas de usar a imagem, com ajuda.
  const m = await ui(master);
  await m.goto(env.origin + `/#campaign/${c.id}/maps`);
  await m.locator('[data-action=ca-upload]').first().click();
  await m.locator('input[name=useGrid][value=free]').waitFor();
  check(await m.locator('input[name=useGrid]').count(), 3, 'três opções de uso');
  await m.locator('input[name=useGrid][value=free]').check();
  ok(await m.locator('[data-grid-host]').isVisible(), 'livre mostra o ajuste da grade de referência');
  await m.screenshot({ path: `${out}/upload-free.png`, animations: 'disabled' });
  await m.keyboard.press('Escape');

  // Mesa do mestre: grade oculta por padrão; marcadores dividindo a casa.
  await m.goto(env.origin + `/#table/${c.id}`);
  await m.locator('.board-canvas').waitFor();
  await m.waitForFunction(() => !document.querySelector('#app').inert);
  await m.waitForFunction(() => /movimentação livre/.test(document.querySelector('.board-canvas')?.getAttribute('aria-label') || ''), null, { timeout: 15000 });
  await m.locator('.board-canvas').screenshot({ path: `${out}/table-master.png`, animations: 'disabled' });

  // Jogador arrasta o próprio personagem e solta num ponto fora do centro da casa.
  const p = await ui(player);
  await p.goto(env.origin + `/#table/${c.id}`);
  const canvas = p.locator('.board-canvas'); await canvas.waitFor();
  await p.waitForFunction(() => !document.querySelector('#app').inert && /movimentação livre/.test(document.querySelector('.board-canvas')?.getAttribute('aria-label') || ''), null, { timeout: 15000 });
  const gridTool = p.locator('[data-action=t-tool-grid]').filter({ visible: true }).first();
  check(await gridTool.getAttribute('aria-pressed'), 'false', 'grade oculta por padrão no mapa livre');
  await gridTool.click();
  check(await p.locator('[data-action=t-tool-grid]').filter({ visible: true }).first().getAttribute('aria-pressed'), 'true', 'Mostrar grade continua disponível');
  await p.locator('.board-canvas').screenshot({ path: `${out}/table-player-grid.png`, animations: 'disabled' });
  await p.locator('[data-action=t-tool-grid]').filter({ visible: true }).first().click();
  // Converte casa fracionária em pixels de tela a partir do tamanho desenhado do mapa (17 × 10 casas centradas).
  const toScreen = async (cx, cy) => p.evaluate(([cx, cy]) => {
    const el = document.querySelector('.board-canvas'), r = el.getBoundingClientRect();
    const cell = Math.min(r.width / 17, r.height / 10), ox = (r.width - cell * 17) / 2, oy = (r.height - cell * 10) / 2;
    return { x: r.left + ox + cx * cell, y: r.top + oy + cy * cell };
  }, [cx, cy]);
  const from = await toScreen(3.12, 4.88), to = await toScreen(8.3, 2.7);
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  await p.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 }); await p.mouse.move(to.x, to.y, { steps: 5 }); await p.mouse.up();
  let dropped = null;
  for (let i = 0; i < 30 && !dropped; i++) { const t = (await player(base + '/live')).tokens.find((x) => x.id === mine.id); if (t.x === 8 && t.y === 2) dropped = t; else await new Promise(r => setTimeout(r, 200)); }
  ok(dropped, 'arraste moveu para a casa (8, 2)');
  ok(Math.abs(dropped.fx - 300) <= 40 && Math.abs(dropped.fy - 700) <= 40, `soltou no ponto fino (${dropped.fx}, ${dropped.fy})`);
  // A posição desenhada vem da consulta ao vivo (long-poll): espera a próxima resposta antes da captura.
  await p.waitForResponse((r) => r.url().includes(`/api/sessions/${session.id}/live`), { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(400);
  await canvas.screenshot({ path: `${out}/table-player-after-drag.png`, animations: 'disabled' });

  // Celular deitado (a mesa pede paisagem): mesma mesa, sem erros.
  const mobile = await ui(player, true);
  await mobile.goto(env.origin + `/#table/${c.id}`);
  await mobile.waitForFunction(() => /movimentação livre/.test(document.querySelector('.board-canvas')?.getAttribute('aria-label') || ''), null, { timeout: 15000 });
  await mobile.waitForLoadState('networkidle').catch(() => {}); await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: `${out}/table-player-mobile.png`, animations: 'disabled' });
  check(errors, [], 'sem erros no navegador');
  console.log('free-movement: ok');
} finally {
  await browser?.close();
  await env.stop();
}
