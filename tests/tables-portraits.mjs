import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, readFile } from 'node:fs/promises';
// Tabelas com a barra padrão de busca (15 por página) e retratos de NPC isolados dos mapas, sob PostgreSQL real.
const env = await startEnvironment({ port: 5272 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/tables';
try {
  const master = await env.verifiedClient('tables.master@example.test', 'Aurora'), player = await env.verifiedClient('tables.player@example.test', 'Lira');
  const c = await master('/api/campaigns', 'POST', { name: 'Casa Rosered', description: 'Revisão das tabelas.', rpgSystemId: '00000000-0000-4000-8000-000000000001' });
  const path = `/api/campaigns/${c.id}`;
  await player('/api/campaigns/join', 'POST', { code: (await master(path)).inviteCode });
  for (let i = 1; i <= 20; i++) {
    await master(path + '/npcs', 'POST', { name: `Rosered ${String(i).padStart(2, '0')}`, summary: i === 7 ? 'Mordomo da família' : 'Membro da casa', notes: '', side: i % 3 === 0 ? 'ally' : 'enemy', kind: i <= 3 ? 'creature' : 'npc', sharedWithPlayers: i % 2 === 0 });
  }

  // Retrato x mapa: categorias isoladas no acervo, nas escolhas de mapa e no atlas.
  const png = await readFile('apps/Eternnus.Web/wwwroot/assets/eternnus-logo.png');
  const upload = (name, purpose) => {
    const f = new FormData();
    for (const [k, v] of [['name', name], ['folderId', ''], ['gridPixels', '64'], ['scaleMeters', '1.5'], ['hasGrid', 'false'], ['gridOffsetX', '0'], ['gridOffsetY', '0']]) f.append(k, v);
    if (purpose) f.append('purpose', purpose);
    f.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
    return master(path + '/assets/maps', 'POST', f);
  };
  const portrait = await upload('Imagem — Rosered 02', 'portrait');
  const map = await upload('Vale do Norte');
  const keys = (await master(path + '/maps')).items.map((m) => m.key);
  ok(keys.includes('asset:' + map.id) && !keys.includes('asset:' + portrait.id), 'retrato fora das escolhas de mapa');
  check((await master(path + '/assets/portraits')).items.map((i) => i.id), [portrait.id], 'seletor de retratos');
  check((await master(path + '/assets/maps?purpose=portrait')).items.map((i) => i.id), [portrait.id], 'acervo de retratos');
  check((await master(path + '/assets/maps')).items.map((i) => i.id), [map.id], 'acervo de mapas');
  check((await master(path + '/workspace/atlas')).candidates.map((i) => i.id), [map.id], 'atlas sem retratos');
  await master(`${path}/workspace/atlas/${portrait.id}`, 'POST', undefined, 404);
  await player(path + '/assets/portraits', 'GET', undefined, 403);

  // Migração NpcPortraitAssets: a retroclassificação acerta a imagem antiga de NPC e preserva a usada no atlas.
  const legacy = await upload('Imagem — Antigo'), published = await upload('Imagem — Mapa do atlas');
  const npcs = (await master(path + '/npcs')).items;
  const n2 = npcs.find((n) => n.name === 'Rosered 02');
  await master(`${path}/npcs/${n2.id}`, 'PUT', { name: n2.name, summary: n2.summary, notes: '', side: n2.side, kind: n2.kind, imageUrl: 'asset:' + legacy.id, sharedWithPlayers: true, revision: n2.revision });
  await master(`${path}/workspace/atlas/${published.id}`, 'POST', undefined, 204);
  const migration = await readFile('apps/Eternnus.Web/Infrastructure/Migrations/20261111192541_NpcPortraitAssets.cs', 'utf8');
  env.sql(migration.slice(migration.indexOf('"""') + 3, migration.lastIndexOf('"""')).trim());
  check(env.sql(`SELECT "Purpose" FROM "CampaignMap" WHERE "Id" = '${legacy.id}'`), 'portrait', 'imagem antiga do NPC vira retrato');
  check(env.sql(`SELECT "Purpose" FROM "CampaignMap" WHERE "Id" = '${published.id}'`), 'map', 'imagem publicada no atlas continua mapa');
  check(env.sql(`SELECT "Purpose" FROM "CampaignMap" WHERE "Id" = '${map.id}'`), 'map', 'mapa comum continua mapa');

  // APIs das tabelas: 15 por página, filtros antes da paginação.
  const search = await master(path + '/search?q=rosered');
  check([search.total, search.items.length, search.pageSize], [20, 15, 15], 'busca sem limite por tipo');
  check((await master(path + '/search?q=rosered&kind=npc&page=2')).items.length, 5, 'segunda página de NPCs');
  const known = await player(path + '/known-npcs?q=mordomo');
  check(known.total, 0, 'NPC 07 não é visível ao grupo');
  check((await player(path + '/known-npcs')).total, 10, 'só os compartilhados');
  const focus = npcs.find((n) => n.name === 'Rosered 20');
  check((await player(`${path}/known-npcs?focus=${focus.id}`)).page, 1, 'foco: 10 NPCs cabem na página 1');

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client, mobile = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map((s) => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return page;
  }
  async function go(page, route, selector) { await page.goto(env.origin + '/#' + route); await page.locator(selector).first().waitFor(); await page.waitForFunction(() => !document.querySelector('#app').inert); }
  const rows = (page, selector) => page.locator(`${selector} tbody tr`).count();

  // Mestre: personagens do mestre em tabela, busca ao digitar, filtro por coluna e paginação sem recarregar.
  const m = await ui(master);
  await go(m, `campaign/${c.id}/prep`, '.npc-table');
  check(await rows(m, '.npc-table'), 15, 'personagens: 15 por página');
  await m.screenshot({ path: `${out}/prep-npcs.png`, fullPage: true, animations: 'disabled' });
  await m.locator('#npc-q').fill('mordomo');
  await m.waitForFunction(() => document.querySelectorAll('.npc-table tbody tr').length === 1);
  check(await m.evaluate(() => document.activeElement?.id), 'npc-q', 'foco continua na busca ao digitar');
  // Barra padrão: "Buscar" presente, sem "Limpar" e sem texto entre a busca e a tabela.
  check(await m.locator('#npc-controls button[type=submit]').textContent(), 'Buscar', 'botão Buscar na barra');
  check(await m.getByRole('button', { name: /^Limpar/ }).count(), 0, 'sem botão Limpar');
  ok(await m.evaluate(() => document.querySelector('#npc-results').firstElementChild?.classList.contains('data-table-wrap')), 'tabela logo abaixo da busca');
  await m.locator('#npc-q').fill('');
  await m.waitForFunction(() => document.querySelectorAll('.npc-table tbody tr').length === 15);
  await m.locator('#npc-f-side').selectOption('ally');
  await m.waitForFunction(() => document.querySelectorAll('.npc-table tbody tr').length === 6);
  await m.locator('#npc-f-side').selectOption('');
  await m.waitForFunction(() => document.querySelectorAll('.npc-table tbody tr').length === 15);
  await m.getByRole('button', { name: 'Próxima →' }).first().click();
  check(await rows(m, '.npc-table'), 5, 'personagens: página 2');
  const portraitBox = await m.locator('.npc-table img.npc-thumb').first().boundingBox().catch(() => null);
  ok(!portraitBox || portraitBox.width <= 48, 'miniatura com tamanho de tabela');

  // Busca geral em tabela.
  await go(m, `campaign/${c.id}`, '#cs-q');
  await m.locator('#cs-q').fill('rosered'); await m.getByRole('button', { name: 'Buscar', exact: true }).click();
  await m.locator('.search-table').waitFor();
  check(await rows(m, '.search-table'), 15, 'busca: 15 por página');
  await m.screenshot({ path: `${out}/search.png`, fullPage: true, animations: 'disabled' });
  await m.locator('#cs-kind').selectOption('npc');
  await m.getByText('Página 1 de 2 · 20 resultados para “rosered”').first().waitFor();

  // Mapas e cenários: retratos de NPC não aparecem (ficam na ficha do personagem); o atlas lista só cenários oficiais.
  await go(m, `campaign/${c.id}/maps`, '.fx-section');
  check(await m.locator('.portrait-section, .portrait-table').count(), 0, 'mapas sem seção de retratos');
  const atlasCards = await m.locator('.official-atlas .atlas-card h3').allTextContents();
  ok(!atlasCards.some((t) => /Imagem —|Vale do Norte/.test(t)), 'atlas oficial sem imagens da campanha');
  await m.screenshot({ path: `${out}/acervo.png`, fullPage: true, animations: 'disabled' });

  // Jogador: NPCs conhecidos em tabela, com busca no servidor.
  const p = await ui(player);
  await go(p, `campaign/${c.id}/npcs`, '.known-npc-table');
  check(await rows(p, '.known-npc-table'), 10, 'NPCs conhecidos em tabela');
  const img = await p.locator('.known-npc-table img').first().boundingBox().catch(() => null);
  ok(!img || img.width <= 48, 'retrato com tamanho de tabela');
  await p.screenshot({ path: `${out}/known-npcs.png`, fullPage: true, animations: 'disabled' });

  // Celular: controles empilhados e tabela legível.
  const mobile = await ui(master, true);
  await go(mobile, `campaign/${c.id}/prep`, '.npc-table');
  await mobile.screenshot({ path: `${out}/prep-npcs-mobile.png`, fullPage: true, animations: 'disabled' });
  await mobile.locator('.npc-table tbody tr').first().scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${out}/prep-npcs-mobile-table.png`, animations: 'disabled' });
  const overflow = await mobile.evaluate(() => { const w = document.querySelector('.npc-table').closest('.data-table-wrap'); return w.scrollWidth - w.clientWidth; });
  ok(overflow <= 1, `tabela cabe na largura do celular (${overflow}px a mais)`);

  check(errors, [], 'sem erros no console');
  console.log('tables-portraits: ok');
} finally { await browser?.close(); await env.stop(); }
