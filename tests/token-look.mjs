/**
 * Forma e tamanho dos marcadores e liberação do movimento (ADR-079) com PostgreSQL real:
 * retrato PNG com transparência servido como PNG, imagem livre e tamanho pelo mestre, recusa ao jogador,
 * movimento só com liberação, alça de redimensionar e marcador solto sem voltar à origem.
 */
import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, readFile } from 'node:fs/promises';
const env = await startEnvironment({ port: 5347 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/token-look';
try {
  const master = await env.verifiedClient('forma.master@example.test', 'Aurora'), player = await env.verifiedClient('forma.player@example.test', 'Lira');
  const c = await master('/api/campaigns', 'POST', { name: 'Covil do Dragão', description: 'Forma dos marcadores.', rpgSystemId: '00000000-0000-4000-8000-000000000001', playMode: 'turns' });
  const path = `/api/campaigns/${c.id}`;
  await player('/api/campaigns/join', 'POST', { code: (await master(path)).inviteCode });

  // Retrato PNG com fundo transparente continua PNG (imagem livre); servido com o tipo real.
  const png = await readFile('apps/Eternnus.Web/wwwroot/assets/eternnus-logo.png');
  const form = new FormData();
  for (const [k, v] of [['name', 'Dragão recortado'], ['folderId', ''], ['gridPixels', '64'], ['scaleMeters', '1.5'], ['hasGrid', 'false'], ['gridOffsetX', '0'], ['gridOffsetY', '0'], ['purpose', 'portrait']]) form.append(k, v);
  form.append('file', new Blob([png], { type: 'image/png' }), 'dragao.png');
  const portrait = await master(path + '/assets/maps', 'POST', form);
  const image = await master(`${path}/assets/maps/${portrait.id}/image`, 'GET', undefined, 200, { raw: true });
  check(image.headers.get('content-type'), 'image/png', 'retrato transparente servido como PNG');
  check(String(image.data).slice(1, 4), 'PNG', 'assinatura PNG preservada');

  const session = await master(path + '/sessions', 'POST', { title: 'Covil', objective: '', mapKind: 'tileset', mapKey: 'crypt' });
  const hero = await player('/api/characters', 'POST', { campaignId: c.id, name: 'Íris', values: {} });
  await player(`/api/sessions/${session.id}/join`, 'POST', { characterId: hero.id }, 204);
  await master(`/api/sessions/${session.id}/join`, 'POST', {}, 204);
  const base = `/api/sessions/${session.id}`;
  await master(base + '/fog/enabled', 'POST', { enabled: false }, 204);
  let live = await master(base + '/live');
  const mine = live.tokens.find((t) => t.characterId === hero.id);
  check([mine.appearance, mine.size], ['round', 100], 'marcador existente continua redondo, uma casa');

  // Criatura nasce como imagem livre de 300%; o jogador não muda forma nem tamanho.
  const dragon = await master(base + '/tokens', 'POST', { label: 'Dragão', side: 'enemy', x: mine.x + 4, y: mine.y + 2, hidden: false, imageUrl: 'asset:' + portrait.id, appearance: 'image', size: 300 });
  await master(`${base}/tokens/${mine.id}/appearance`, 'POST', { appearance: 'image', size: 150, imageUrl: 'asset:' + portrait.id }, 204);
  await player(`${base}/tokens/${mine.id}/appearance`, 'POST', { appearance: 'round', size: 100 }, 403);
  await master(`${base}/tokens/${mine.id}/appearance`, 'POST', { appearance: 'image', size: 900 }, 400);
  live = await player(base + '/live');
  const at = (id) => live.tokens.find((t) => t.id === id);
  check([at(dragon.id).appearance, at(dragon.id).size], ['image', 300], 'criatura com imagem livre 300%');
  check([at(mine.id).appearance, at(mine.id).size], ['image', 150], 'personagem do jogador com imagem escolhida pelo mestre');
  ok(at(mine.id).image?.includes(`/tokens/${mine.id}/portrait`), 'jogador recebe a imagem do próprio marcador');
  const served = await player(at(mine.id).image, 'GET', undefined, 200, { raw: true });
  check(served.headers.get('content-type'), 'image/png', 'imagem do marcador servida como PNG');

  // Movimento: só com liberação do mestre, na vez do personagem.
  await master(base + '/turn', 'POST', { characterId: hero.id }, 204);
  live = await player(base + '/live');
  check([live.play.moveNeedsGrant, live.play.moveGranted], [true, false], 'movimento aguardando liberação');
  await player(`${base}/tokens/${mine.id}/move`, 'POST', { x: mine.x + 1, y: mine.y }, 409);
  await player(base + '/move-grant', 'POST', { allowed: true }, 403);

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client, mobile = false) { const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' }); await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; })); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return page; }
  const ready = (page) => page.waitForFunction(() => !document.querySelector('#app').inert && document.querySelector('.board-canvas')?.width > 0, null, { timeout: 20000 });

  // Jogador: aviso de espera e "Mover" desabilitado com motivo.
  const p = await ui(player);
  await p.goto(env.origin + `/#table/${c.id}`);
  await ready(p);
  await p.getByText('Movimento aguardando o mestre').first().waitFor({ timeout: 15000 });
  const moveButton = p.locator('[data-action=t-move]').filter({ visible: true }).first();
  check(await moveButton.getAttribute('aria-disabled'), 'true', 'Mover desabilitado sem liberação');
  ok(/liberar o seu movimento/.test(await moveButton.getAttribute('data-tip')), 'motivo explicado');
  await p.screenshot({ path: `${out}/player-waiting.png`, animations: 'disabled' });

  // Mestre: libera pela barra de turno; o jogador passa a mover.
  const m = await ui(master);
  await m.goto(env.origin + `/#table/${c.id}`);
  await ready(m);
  await m.locator('[data-action=t-move-grant]').filter({ visible: true }).first().click();
  for (let i = 0; i < 30 && !(await player(base + '/live')).play.moveGranted; i++) await new Promise(r => setTimeout(r, 200));
  check((await player(base + '/live')).play.moveGranted, true, 'mestre liberou pelo botão');
  await m.locator('[data-action=t-move-grant]').filter({ visible: true, hasText: 'Bloquear movimento' }).first().waitFor({ timeout: 15000 });
  await m.screenshot({ path: `${out}/master-table.png`, animations: 'disabled' });

  // Coordenadas de tela de uma casa (mapa oficial "crypt": colunas × linhas centradas no canvas).
  const map = (await master(base + '/live')).map;
  const cols = map.rows[0].length, rows = map.rows.length;
  const toScreen = (page, cx, cy) => page.evaluate(([cx, cy, cols, rows]) => {
    const el = document.querySelector('.board-canvas'), r = el.getBoundingClientRect();
    const cell = Math.min(r.width / cols, r.height / rows), ox = (r.width - cell * cols) / 2, oy = (r.height - cell * rows) / 2;
    return { x: r.left + ox + cx * cell, y: r.top + oy + cy * cell, cell };
  }, [cx, cy, cols, rows]);

  // Alça: o mestre seleciona o dragão e arrasta o canto; o tamanho muda no servidor.
  const dragonCenter = await toScreen(m, at(dragon.id).x + 0.5, at(dragon.id).y + 0.5);
  await m.mouse.click(dragonCenter.x, dragonCenter.y);
  await m.locator('[data-action=t-token-look]').filter({ visible: true }).first().waitFor();
  // Imagem livre 300%: meia largura de 1,5 casa; a alça fica no canto da figura (logo 1672 × 941).
  const half = 1.5 * dragonCenter.cell, halfY = half * 941 / 1672;
  await m.mouse.move(dragonCenter.x + half, dragonCenter.y + halfY); await m.mouse.down();
  await m.mouse.move(dragonCenter.x + half * 0.7, dragonCenter.y + halfY * 0.7, { steps: 6 }); await m.mouse.up();
  let resized = null;
  for (let i = 0; i < 30 && !resized; i++) { const t = (await master(base + '/live')).tokens.find((x) => x.id === dragon.id); if (t.size !== 300) resized = t; else await new Promise(r => setTimeout(r, 200)); }
  ok(resized && resized.size >= 180 && resized.size <= 240, `alça reduziu o dragão (${resized?.size}%)`);
  await m.locator('.board-canvas').screenshot({ path: `${out}/master-resized.png`, animations: 'disabled' });

  // Modal "Forma e tamanho": campos com ajuda, valores atuais.
  await m.locator('[data-action=t-token-look]').filter({ visible: true }).first().click();
  await m.locator('#token-look-form input[name=appearance][value=image]').waitFor();
  ok(await m.locator('#token-look-form input[name=appearance][value=image]').isChecked(), 'modal mostra a forma atual');
  check(await m.locator('#f-tlook-size').inputValue(), String(resized.size), 'modal mostra o tamanho atual');
  await m.screenshot({ path: `${out}/master-look-modal.png`, animations: 'disabled' });
  await m.keyboard.press('Escape');

  // Jogador arrasta o próprio personagem; com a resposta do servidor atrasada, o marcador fica no destino (sem voltar).
  await p.waitForFunction(() => document.querySelector('[data-action=t-move]')?.getAttribute('aria-disabled') !== 'true', null, { timeout: 15000 });
  live = await player(base + '/live');
  const start = at(mine.id);
  const target = { x: start.x + 1, y: start.y };
  const pixel = (cx, cy) => p.evaluate(([cx, cy, cols, rows]) => {
    const el = document.querySelector('.board-canvas'), r = el.getBoundingClientRect(), scale = el.width / r.width;
    const cell = Math.min(r.width / cols, r.height / rows), ox = (r.width - cell * cols) / 2, oy = (r.height - cell * rows) / 2;
    return [...el.getContext('2d').getImageData(Math.round((ox + cx * cell) * scale), Math.round((oy + cy * cell) * scale), 1, 1).data];
  }, [cx, cy, cols, rows]);
  const beforeTarget = await pixel(target.x + 0.5, target.y + 0.5);
  await p.route('**/tokens/*/move', async (route) => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
  const from = await toScreen(p, start.x + 0.5, start.y + 0.5), to = await toScreen(p, target.x + 0.5, target.y + 0.5);
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  await p.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 }); await p.mouse.move(to.x, to.y, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(300);
  const duringTarget = await pixel(target.x + 0.5, target.y + 0.5);
  ok(duringTarget.join() !== beforeTarget.join(), 'marcador desenhado no destino antes da resposta do servidor');
  await p.locator('.board-canvas').screenshot({ path: `${out}/player-drop-pending.png`, animations: 'disabled' });
  let moved = null;
  for (let i = 0; i < 30 && !moved; i++) { const t = (await player(base + '/live')).tokens.find((x) => x.id === mine.id); if (t.x === target.x && t.y === target.y) moved = t; else await new Promise(r => setTimeout(r, 200)); }
  ok(moved, 'movimento liberado aceito');
  await p.unroute('**/tokens/*/move');

  // Trocar a vez revoga a liberação.
  await master(base + '/turn', 'POST', { characterId: null }, 204);
  await master(base + '/turn', 'POST', { characterId: hero.id }, 204);
  check((await player(base + '/live')).play.moveGranted, false, 'nova vez começa bloqueada');

  // Celular deitado: mesma mesa, sem erros.
  const mobile = await ui(player, true);
  await mobile.goto(env.origin + `/#table/${c.id}`);
  await ready(mobile);
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: `${out}/player-mobile.png`, animations: 'disabled' });
  check(errors, [], 'sem erros no navegador');
  console.log('token-look: ok');
} finally {
  await browser?.close();
  await env.stop();
}
