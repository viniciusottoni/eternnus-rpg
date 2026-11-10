import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
// Capítulos/atos/arcos das sessões e premissa com parágrafos (PostgreSQL real + interface desktop/móvel).
const env = await startEnvironment({ port: 5263 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/campaign-chapters';
try {
  const master = await env.verifiedClient('chapters.master@example.test', 'Aurora'), player = await env.verifiedClient('chapters.player@example.test', 'Lira');
  const premise = 'No princípio havia três entidades eternas.\n\nArton é chamado "mundo" porque é todo o mundo conhecido. ' + 'O Reinado é uma confederação de reinos. '.repeat(12) + '\n\nHá mil anos Arton foi atacado pela Tormenta.';
  const c = await master('/api/campaigns', 'POST', { name: 'O Livro de Eternnus', description: premise, rpgSystemId: '00000000-0000-4000-8000-000000000001' });
  const path = `/api/campaigns/${c.id}`;
  check((await master(path)).description, premise);
  await player('/api/campaigns/join', 'POST', { code: (await master(path)).inviteCode });
  await player(path + '/chapters', 'GET', undefined, 403);
  await player(path + '/chapters', 'POST', { title: 'Ato do jogador' }, 403);
  await master(path + '/chapters', 'POST', { title: 'x', kind: 'livro' }, 400);

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client, mobile = false) { const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }); await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; })); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return page; }
  async function go(page, route, text) { await page.goto(env.origin + '/#' + route); await page.getByText(text, { exact: true }).first().waitFor(); await page.waitForFunction(() => !document.querySelector('#app').inert); }

  // Premissa: trecho no topo com "mais"; popup e Visão geral preservam os parágrafos.
  const page = await ui(master);
  await go(page, `campaign/${c.id}`, 'Premissa');
  const hero = page.locator('.campaign-hero .hero-premise');
  check(await hero.evaluate(e => getComputedStyle(e).whiteSpace), 'pre-line');
  ok((await hero.innerText()).length < 400, 'Trecho curto no topo');
  check(await page.locator('.overview-story .workspace-prose').last().evaluate(e => getComputedStyle(e).whiteSpace), 'pre-wrap');
  await page.screenshot({ path: `${out}/overview-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Ler a premissa completa', exact: true }).click();
  const full = page.locator('#modal .premise-full'); await full.waitFor();
  check(await full.evaluate(e => e.textContent), premise);
  ok((await full.innerText()).includes('eternas.\n\nArton'), 'Parágrafos visíveis no popup');
  await page.screenshot({ path: `${out}/premise-modal.png`, animations: 'disabled' });
  await page.getByRole('button', { name: 'Fechar', exact: true }).first().click();

  // Diário: sem capítulos, a abertura sugere criar o primeiro, mas aceita sessão avulsa.
  await go(page, `campaign/${c.id}/journal`, 'Sessões no Eternnus');
  await page.getByText('Nenhum capítulo criado.', { exact: false }).waitFor();
  await page.getByRole('button', { name: '+ Novo capítulo', exact: true }).click();
  await page.locator('#ch-title').fill('A Chegada a Valkaria'); await page.locator('#ch-kind').selectOption('act');
  await page.locator('#ch-summary').fill('Os heróis chegam à capital.\nPrimeiros ganchos.');
  await page.getByRole('button', { name: 'Criar capítulo', exact: true }).click();
  await page.getByRole('heading', { name: 'A Chegada a Valkaria', exact: true }).waitFor();
  await page.getByRole('button', { name: '✦ Iniciar nova sessão', exact: true }).first().click();
  await page.locator('#f-chapter-select').waitFor();
  const chapters = await master(path + '/chapters');
  check(await page.locator('#f-chapter-select').inputValue(), chapters.items[0].id);
  await page.locator('#f-chapter-select').selectOption('__new');
  ok(await page.locator('#f-chapter-new-title').isVisible(), 'Campos do novo capítulo visíveis');
  await page.locator('#f-chapter-new-title').fill('Arco da Tormenta'); await page.locator('#f-chapter-new-kind').selectOption('arc');
  await page.screenshot({ path: `${out}/start-session.png`, animations: 'disabled' });
  await page.locator('#f-title').fill('O portão');
  await page.getByRole('button', { name: '▶ Iniciar sessão', exact: true }).click();
  await page.waitForURL(/#table\//);

  const sessions = await master(path + '/sessions');
  check(sessions.items[0].chapterTitle, 'Arco da Tormenta');
  const arc = (await master(path + '/chapters')).items.find(x => x.title === 'Arco da Tormenta');
  check(arc.kind, 'arc'); check(arc.sessionCount, 1);
  const act = (await master(path + '/chapters')).items.find(x => x.title === 'A Chegada a Valkaria');
  await player(`/api/sessions/${sessions.items[0].id}/chapter`, 'POST', { chapterId: act.id }, 403);
  await master(`/api/sessions/${sessions.items[0].id}/chapter`, 'POST', { chapterId: act.id }, 204);
  check((await master(path + '/sessions')).items[0].chapterTitle, 'A Chegada a Valkaria');
  await master(`/api/sessions/${sessions.items[0].id}/end`, 'POST', undefined, 204);
  await master(path + '/workspace/past-sessions', 'POST', { number: 0 + 7, title: 'Antes', summary: 'x', chapterId: arc.id }, null);

  // Ordem e exclusão sob PostgreSQL: sessões continuam e ficam avulsas.
  await master(`${path}/chapters/${arc.id}/move`, 'POST', { direction: -1, revision: arc.revision }, 204);
  check((await master(path + '/chapters')).items[0].title, 'Arco da Tormenta');
  const moved = (await master(path + '/chapters')).items[0];
  await master(`${path}/chapters/${moved.id}?revision=${moved.revision}`, 'DELETE', undefined, 204);
  check((await master(path + '/workspace/past-sessions')).items[0].chapterId, null);

  await go(page, `campaign/${c.id}/journal`, 'Sessões no Eternnus');
  await page.getByRole('heading', { name: 'A Chegada a Valkaria', exact: true }).waitFor();
  await page.screenshot({ path: `${out}/journal-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /^Mudar o capítulo de/ }).first().click();
  await page.locator('#sc-select').selectOption('');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.session-row .session-chapter .status-chip.quiet').first().waitFor();
  check((await master(path + '/sessions')).items[0].chapterTitle, null);

  const mobile = await ui(master, true);
  await go(mobile, `campaign/${c.id}/journal`, 'Sessões no Eternnus');
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sem overflow móvel');
  await mobile.screenshot({ path: `${out}/journal-mobile.png`, fullPage: true, animations: 'disabled' });
  await go(mobile, `campaign/${c.id}`, 'Premissa');
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sem overflow móvel na visão geral');
  await mobile.screenshot({ path: `${out}/overview-mobile.png`, animations: 'disabled' });

  check(errors, []);
  await writeFile(`${out}/result.json`, JSON.stringify({ errors, passed: true }, null, 2));
  console.log('Capítulos e premissa: permissões, vínculos, exclusão no PostgreSQL e interface desktop/móvel aprovados.');
} finally { await browser?.close(); await env.stop(); }
