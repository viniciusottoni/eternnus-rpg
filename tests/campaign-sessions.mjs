import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
// Tabela única de sessões, busca geral, NPCs conhecidos e importação em lote (ADR-061) sob PostgreSQL real.
const env = await startEnvironment({ port: 5264 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/campaign-sessions';
try {
  const master = await env.verifiedClient('log.master@example.test', 'Aurora'), player = await env.verifiedClient('log.player@example.test', 'Lira'), outsider = await env.verifiedClient('log.outsider@example.test', 'Outro');
  const c = await master('/api/campaigns', 'POST', { name: 'O Livro de Eternnus', description: 'No princípio havia três entidades eternas.', rpgSystemId: '00000000-0000-4000-8000-000000000001' });
  const path = `/api/campaigns/${c.id}`, ws = path + '/workspace';
  await player('/api/campaigns/join', 'POST', { code: (await master(path)).inviteCode });
  const act = await master(path + '/chapters', 'POST', { title: 'Trevas', kind: 'act', published: true });
  await master(ws + '/past-sessions', 'POST', { number: 1, title: 'Blackstones', summary: 'Chegada à vila.', published: true, chapterId: act.id, scenes: [{ title: 'Batalha na Floresta', text: 'Encontram 2 goblins arqueiros e uma lasca de pedra negra.' }] });
  await master(ws + '/past-sessions', 'POST', { number: 2, title: 'Rosered', summary: 'Segredo: o rei trai.', published: false });
  const live = await master(path + '/sessions', 'POST', { title: 'O portão', objective: 'Objetivo secreto do mestre', mapKind: 'tileset', mapKey: 'crypt', chapterId: act.id });
  await master(`/api/sessions/${live.id}/recap`, 'POST', { text: 'O grupo derrotou o Hobgoblin no portão.', publish: true }, 204);
  await master(`/api/sessions/${live.id}/end`, 'POST', undefined, 204);

  // Tabela: UNION das duas origens, visibilidade por papel, ILIKE e busca dentro das cenas (JSON) no PostgreSQL.
  check((await master(path + '/session-log')).total, 3);
  const mine = await player(path + '/session-log');
  check(mine.items.map(i => [i.number, i.source]), [[3, 'eternnus'], [1, 'past']]);
  check(mine.items[0].chapterTitle, 'Trevas');
  check((await player(path + '/session-log?search=GOBLIN')).total, 2);
  ok((await player(path + '/session-log?search=pedra%20negra')).items[0].excerpt.includes('pedra negra'), 'Trecho da cena');
  check((await player(path + '/session-log?search=rei%20trai')).total, 0);
  check((await player(path + '/session-log?search=Objetivo%20secreto')).total, 0);
  check((await master(path + '/session-log?search=Objetivo%20secreto')).total, 1);
  check((await player(path + '/session-log?search=100%25')).total, 0);
  check((await master(`${path}/session-log?chapter=${act.id}&source=past`)).total, 1);
  check((await master(path + '/session-log?chapter=none')).total, 1);
  const entry = await player(`${path}/session-log/live-${live.id}`);
  check(entry.objective, null);
  const hidden = (await master(ws + '/past-sessions')).items.find(p => p.number === 2);
  await player(`${path}/session-log/past-${hidden.id}`, 'GET', undefined, 404);
  await outsider(path + '/session-log', 'GET', undefined, 404);

  // NPCs: só os compartilhados, sem notas; busca geral respeita cada fonte.
  const grak = await master(path + '/npcs', 'POST', { name: 'Grak', summary: 'Chefe goblin da floresta', notes: 'Traidor', side: 'enemy', resources: [], sharedWithPlayers: true });
  await master(path + '/npcs', 'POST', { name: 'Vulto', summary: 'Espião goblin', notes: '', side: 'enemy', resources: [] });
  const known = await player(path + '/known-npcs');
  check(known.items.map(n => n.name), ['Grak']); ok(!('notes' in known.items[0]), 'Notas fora da lista');
  await master(ws + '/pages', 'POST', { title: 'Tribo goblin', content: 'Vivem na floresta.', kind: 'faction', visibility: 'table' });
  await master(ws + '/pages', 'POST', { title: 'Plano goblin secreto', content: 'x', kind: 'faction', visibility: 'self' });
  const found = (await player(path + '/search?q=goblin')).items.map(i => i.title);
  ok(found.includes('Grak') && found.includes('Tribo goblin') && found.includes('Sessão 01 — Blackstones'), 'Busca do jogador');
  ok(!found.includes('Vulto') && !found.includes('Plano goblin secreto'), 'Busca não vaza conteúdo privado');
  await player(path + '/search?q=a', 'GET', undefined, 400);

  // Importação: modelo, recusas e gravação atômica.
  const template = await master('/api/session-import/template', 'GET', undefined, 200, { raw: true });
  const templateText = template.data;
  ok(template.headers.get('content-disposition').includes('modelo-sessoes-eternnus.csv'), 'Modelo para download');
  const upload = (text, name = 'sessoes.csv') => { const f = new FormData(); f.append('file', new Blob([text], { type: 'text/csv' }), name); return f; };
  const templatePreview = await master(path + '/session-import', 'POST', upload(templateText));
  check(templatePreview.ready, false); check(templatePreview.errors.length, 3);
  await master(path + '/session-import', 'POST', upload('numero;titulo\n9;x', 'sessoes.xlsx'), 400);
  await player(path + '/session-import', 'POST', upload('numero;titulo\n9;x'), 403);
  await master(path + '/session-import', 'POST', upload('x'.repeat(1024 * 1024 + 10)), 413);
  const csv = templateText.replaceAll('(exemplo) ', '').replace(';1;Blackstones;', ';10;Blackstones II;').replace(';2;Rosered;', ';11;Rosered II;');
  const preview = await master(path + '/session-import', 'POST', upload(csv));
  check(preview.ready, true); check(preview.sessions.length, 2); check(preview.newChapters, 1);
  check((await master(path + '/session-log')).total, 3);
  await master(path + '/session-import?confirm=true', 'POST', upload(csv));
  check((await master(path + '/session-log')).total, 5);
  check((await master(path + '/chapters')).items.map(x => x.title), ['Trevas', 'Fogo']);
  await master(path + '/session-import?confirm=true', 'POST', upload(csv), 400);

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client, mobile = false) { const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }); await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; })); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return page; }
  async function go(page, route, text) { await page.goto(env.origin + '/#' + route); await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor(); await page.waitForFunction(() => !document.querySelector('#app').inert); }

  // Jogador: tabela, busca e leitura.
  const p = await ui(player);
  await go(p, `campaign/${c.id}/journal`, 'Buscar nas sessões');
  await p.locator('#lg-q').fill('pedra negra'); await p.locator('#lg-controls button[type=submit]').click();
  await p.waitForFunction(() => document.querySelectorAll('.log-table tbody tr').length === 1);
  await p.screenshot({ path: `${out}/log-search-player.png`, fullPage: true, animations: 'disabled' });
  await p.getByRole('button', { name: 'Blackstones', exact: true }).click();
  await p.getByRole('heading', { name: 'Batalha na Floresta', exact: true }).waitFor();
  await p.screenshot({ path: `${out}/entry-player.png`, animations: 'disabled' });
  await p.keyboard.press('Escape');
  // Busca geral leva à tela de origem.
  await go(p, `campaign/${c.id}`, 'Premissa');
  const [qBox, qButton] = [await p.locator('#cs-q').boundingBox(), await p.locator('#cs-form button[type=submit]').boundingBox()];
  ok(Math.abs(qBox.y - qButton.y) <= 2 && Math.abs(qBox.height - qButton.height) <= 2, 'Botão Buscar alinhado ao campo');
  await p.locator('#cs-q').fill('goblin'); await p.locator('#cs-form button[type=submit]').click();
  await p.locator('.search-table tr', { hasText: 'Grak' }).getByRole('link', { name: 'Abrir' }).waitFor();
  await p.screenshot({ path: `${out}/global-search.png`, fullPage: true, animations: 'disabled' });
  await p.locator('.search-table tr', { hasText: 'Grak' }).getByRole('link', { name: 'Abrir' }).click();
  await p.locator(`#npc-${grak.id}.is-target`).waitFor();
  await go(p, `campaign/${c.id}`, 'Premissa');
  await p.locator('#cs-q').fill('pedra negra'); await p.locator('#cs-form button[type=submit]').click();
  await p.locator('.search-table tr', { hasText: 'Blackstones' }).getByRole('link', { name: 'Abrir' }).click();
  await p.getByRole('heading', { name: 'Batalha na Floresta', exact: true }).waitFor();
  await p.keyboard.press('Escape');

  // Mestre: capítulos e tabela; importação pela interface.
  const m = await ui(master);
  await go(m, `campaign/${c.id}/journal`, 'Buscar nas sessões');
  await m.getByRole('link', { name: 'Fogo', exact: true }).waitFor();
  await m.screenshot({ path: `${out}/journal-master.png`, fullPage: true, animations: 'disabled' });
  await m.getByRole('button', { name: '⇪ Importar em lote', exact: true }).click();
  await m.locator('#import-file').setInputFiles({ name: 'novas.csv', mimeType: 'text/csv', buffer: Buffer.from('numero;titulo;capitulo;publicado\n20;A torre;Fogo;sim\n21;<img src=x onerror=alert(1)>;;não\n', 'utf8') });
  await m.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
  await m.getByText('Prévia: 2 sessões e 0 capítulos novos', { exact: true }).waitFor();
  check(await m.locator('#import-preview img').count(), 0);
  await m.screenshot({ path: `${out}/import-preview.png`, animations: 'disabled' });
  await m.getByRole('button', { name: 'Importar 2 sessões e 0 capítulos novos', exact: true }).click();
  await m.locator('#modal').waitFor({ state: 'hidden' });
  await m.getByRole('button', { name: '<img src=x onerror=alert(1)>', exact: true }).waitFor();
  check((await master(path + '/session-log')).total, 7);
  await go(m, `campaign/${c.id}/sessions/chapter-${act.id}`, 'Buscar nas sessões');
  check(await m.locator('#lg-f-chapter').inputValue(), act.id);
  // Exclusão de registro anterior pela leitura da sessão; sessões do Eternnus não oferecem a ação.
  await go(m, `campaign/${c.id}/journal`, 'Buscar nas sessões');
  await m.getByRole('button', { name: 'O portão', exact: true }).click();
  await m.getByRole('button', { name: '❖ Capítulo', exact: true }).waitFor();
  check(await m.getByRole('button', { name: 'Excluir registro', exact: true }).count(), 0);
  await m.keyboard.press('Escape'); await m.locator('#modal').waitFor({ state: 'hidden' });
  await m.getByRole('button', { name: 'Rosered II', exact: true }).click();
  await m.getByRole('button', { name: 'Excluir registro', exact: true }).click();
  await m.getByRole('button', { name: 'Excluir sessão', exact: true }).click();
  await m.locator('#modal').waitFor({ state: 'hidden' });
  await m.getByRole('button', { name: 'Rosered II', exact: true }).waitFor({ state: 'detached' });
  check((await master(path + '/session-log')).total, 6);

  const mobile = await ui(player, true);
  await go(mobile, `campaign/${c.id}/journal`, 'Buscar nas sessões');
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sem overflow móvel na tabela');
  await mobile.screenshot({ path: `${out}/log-mobile.png`, fullPage: true, animations: 'disabled' });
  await go(mobile, `campaign/${c.id}/npcs`, 'NPCs conhecidos');
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sem overflow móvel nos NPCs');
  await mobile.screenshot({ path: `${out}/npcs-mobile.png`, fullPage: true, animations: 'disabled' });

  check(errors, []);
  await writeFile(`${out}/result.json`, JSON.stringify({ errors, passed: true }, null, 2));
  console.log('Sessões: tabela única, buscas, NPCs conhecidos e importação em lote aprovados no PostgreSQL e na interface.');
} finally { await browser?.close(); await env.stop(); }
