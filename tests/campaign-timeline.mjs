// Linha do tempo da campanha (ADR-072): permissões e visibilidade com PostgreSQL real e interface desktop/celular.
import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const env = await startEnvironment({ port: 5274 }); let browser;
const { check, ok } = env;
const out = 'artifacts/qa/campaign-timeline';
try {
  const master = await env.verifiedClient('timeline.master@example.test', 'Aurora'), player = await env.verifiedClient('timeline.player@example.test', 'Lira'), outsider = await env.verifiedClient('timeline.outsider@example.test', 'Outro');
  const c = await master('/api/campaigns', 'POST', { name: 'Crônicas do Fogo', description: 'Uma era em chamas', rpgSystemId: '00000000-0000-4000-8000-000000000001' });
  const detail = await master(`/api/campaigns/${c.id}`); await player('/api/campaigns/join', 'POST', { code: detail.inviteCode });
  const base = `/api/campaigns/${c.id}/workspace/timeline`;
  await master(base, 'POST', { title: 'O Despertar', when: 'Ano 1042 da Era do Fogo', summary: 'A chama antiga acorda sob a montanha.', kind: 'start', published: true });
  const titles = ['A fundação de Valdaran', 'O pacto dos clãs', 'A queda da Torre Rubra', 'Três luas após a queda', 'O exílio da rainha', 'A travessia do deserto', 'O retorno à capital', 'O cerco de inverno'];
  const ids = [];
  for (const [i, title] of titles.entries()) ids.push((await master(base, 'POST', { title, when: `Ano ${1043 + i * 3}`, summary: 'Um acontecimento que mudou o rumo do reino e de todos que nele viviam.', details: `Relato completo de ${title}.\n\nCom vários parágrafos.`, kind: 'event', published: true })).id);
  const secret = await master(base, 'POST', { title: 'Traição oculta', summary: 'Só o mestre sabe.', details: 'SEGREDO DO MESTRE', kind: 'event', published: false, after: ids[1] });
  await master(base, 'POST', { title: 'A última batalha', when: 'Fim da Era do Fogo', summary: 'Ainda por vir.', kind: 'end', published: true });
  const asPlayer = await player(base);
  check(asPlayer.items.length, titles.length + 2); ok(!JSON.stringify(asPlayer).includes('SEGREDO'), 'Rascunho e relato longo fora da lista do jogador');
  check(asPlayer.canEdit, false);
  await player(`${base}/${secret.id}`, 'GET', undefined, 404); await outsider(base, 'GET', undefined, 404);
  await player(base, 'POST', { title: 'Minha versão', kind: 'event' }, 403);
  check((await master(base)).items.find((x) => x.id === secret.id).position, 2);
  check((await player(`${base}/${ids[0]}`)).details, `Relato completo de ${titles[0]}.\n\nCom vários parágrafos.`);
  // Duas escritas com a mesma revisão: só uma vence.
  const writes = await Promise.all([1, 2].map((n) => master(`${base}/${ids[2]}`, 'PUT', { title: `Versão ${n}`, kind: 'event', published: true, revision: 1 }, null, { raw: true })));
  check(writes.map((w) => w.status).sort(), [200, 409]);

  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = []; await mkdir(out, { recursive: true });
  async function ui(client, mobile = false) { const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }); await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map((s) => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; })); const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message)); return page; }
  async function go(page, route, text) { await page.goto(env.origin + '/#' + route); await page.getByText(text, { exact: true }).first().waitFor(); await page.waitForFunction(() => !document.querySelector('#app').inert); }
  const page = await ui(master); await go(page, `campaign/${c.id}/timeline`, 'O Despertar');
  await page.waitForFunction(() => document.querySelectorAll('.tl-path path').length >= 2);
  ok(await page.locator('.tl-node.tl-draft').count() === 1, 'Rascunho marcado para o mestre');
  // Fileira 2 volta da direita para a esquerda (serpente).
  const cols = Number(await page.locator('.tl-serpent').evaluate((el) => el.style.getPropertyValue('--tl-cols')));
  ok(cols >= 2, 'Várias colunas no desktop');
  const xs = await page.locator('.tl-node .tl-dot').evaluateAll((dots) => dots.map((d) => d.getBoundingClientRect().x));
  ok(xs[cols] > xs[cols + 1], 'Segunda fileira segue no sentido contrário');
  await page.waitForTimeout(3600); await page.screenshot({ path: `${out}/master-desktop.png`, fullPage: true });
  await page.locator('.tl-spot', { hasText: titles[0] }).click();
  await page.locator('#modal .workspace-prose').waitFor(); ok((await page.locator('#modal .workspace-prose').textContent()).includes('Com vários parágrafos.'), 'Relato completo no modal');
  await page.waitForTimeout(400); await page.screenshot({ path: `${out}/read-modal.png` });
  await page.getByRole('button', { name: '+ Inserir depois', exact: true }).click();
  await page.locator('#tl-title').fill('A ponte de cristal'); await page.locator('#tl-when').fill('Pouco depois da fundação'); await page.locator('#tl-summary').fill('Inserida pelo modal.');
  await page.locator('[name=published]').check(); await page.getByRole('button', { name: 'Salvar ponto', exact: true }).click();
  await page.locator('.tl-spot', { hasText: 'A ponte de cristal' }).waitFor();
  const order = (await master(base)).items.filter((x) => x.kind === 'event').map((x) => x.title);
  check(order.indexOf('A ponte de cristal'), order.indexOf(titles[0]) + 1);
  const view = await ui(player); await go(view, `campaign/${c.id}/timeline`, 'O Despertar');
  ok(await view.getByText('Traição oculta').count() === 0, 'Jogador não vê rascunho'); ok(await view.getByRole('button', { name: '+ Acontecimento' }).count() === 0, 'Jogador sem botão de criação');
  await view.waitForTimeout(3600); await view.screenshot({ path: `${out}/player-desktop.png`, fullPage: true });
  const mobile = await ui(player, true); await go(mobile, `campaign/${c.id}/timeline`, 'O Despertar');
  check(await mobile.locator('.tl-serpent').evaluate((el) => el.classList.contains('tl-single')), true);
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Sem overflow móvel');
  const sizes = await mobile.locator('.tl-spot').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  ok(sizes.every((h) => h >= 44), 'Alvos de toque de 44 px');
  await mobile.screenshot({ path: `${out}/player-mobile.png`, fullPage: true });
  const reduced = await ui(master); await reduced.emulateMedia({ reducedMotion: 'reduce' }); await go(reduced, `campaign/${c.id}/timeline`, 'O Despertar');
  check(await reduced.locator('.tl-line.tl-draw').count(), 0);
  check(errors, []); await writeFile(`${out}/result.json`, JSON.stringify({ errors, passed: true }, null, 2));
  console.log('Linha do tempo: permissões, visibilidade, corrida de revisão e interface desktop/celular aprovadas.');
} finally { await browser?.close(); await env.stop(); }
