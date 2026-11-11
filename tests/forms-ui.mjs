// QA de alinhamento dos formulários das páginas (filtros, configurações, fichas, admin), contra PostgreSQL isolado.
// Desktop 1440×900 e celular 390×844. Os modais são cobertos por tests/modals-ui.mjs com a mesma verificação.
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
import { formAlignmentIssues, focusClipIssues, choiceControlIssues } from './support/form-alignment.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const dir = 'artifacts/qa/formularios';
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5267 });
const free = '00000000-0000-4000-8000-000000000001', freeTemplate = '00000000-0000-4000-8000-000000000101';
const results = [], errors = [];
let browser;
try {
  const master = await env.verifiedClient('forms.master@example.test', 'Aurora do Vale');
  const player = await env.verifiedClient('forms.player@example.test', 'Lira das Marés');
  const admin = await env.verifiedClient('forms.admin@example.test', 'Admin');
  env.sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='forms.admin@example.test'`);
  await env.authenticateMfa(admin, 'forms.admin@example.test');
  const campaign = await master('/api/campaigns', 'POST', { name: 'Crônicas dos formulários', description: 'Campanha de revisão.', rpgSystemId: free, playMode: 'tactical' });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  await player('/api/campaigns/join', 'POST', { code: detail.inviteCode });
  const hero = await player('/api/characters', 'POST', { campaignId: campaign.id, name: 'Lira' });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, 'POST', { title: 'Travessia', objective: '', mapKind: 'tileset', mapKey: 'bridge' });
  await master(`/api/sessions/${session.id}/join`, 'POST', {}, 204);
  await player(`/api/sessions/${session.id}/join`, 'POST', { characterId: hero.id }, 204);
  const topic = await player('/api/guild/topics', 'POST', { categoryId: '00000000-0000-4000-8000-000000000202', title: 'Boas histórias', body: 'Como preparar uma aventura em grupo?' });
  await player('/api/support/tickets', 'POST', { subject: 'Dúvida sobre fichas', category: 'account', body: 'Como compartilho minha ficha com o mestre?' }).catch(() => {});
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const clients = { m: master, p: player, ad: admin };
  const C = campaign.id;
  const routes = [
    ['m', 'campaigns'], ['m', `campaign/${C}`], ['m', `campaign/${C}/journal`], ['m', `campaign/${C}/sessions`], ['m', `campaign/${C}/prep`],
    ['m', `campaign/${C}/players`], ['m', `campaign/${C}/resources`], ['m', `campaign/${C}/maps`], ['m', `campaign/${C}/table`], ['m', `campaign/${C}/settings`],
    ['m', 'one-shot'], ['m', 'settings'], ['m', 'progress'], ['m', `table/${C}`], ['m', `campaign/${C}/history/${session.id}`],
    ['p', 'characters'], ['p', `character/${hero.id}`], ['p', 'library'], ['p', 'guild'], ['p', `guild/t/${topic.id}`], ['p', 'support'], ['p', `table/${C}`],
    ['ad', 'admin'], ['ad', 'admin/users'], ['ad', 'admin/campaigns'], ['ad', 'admin/systems'], ['ad', 'admin/templates'], ['ad', 'admin/music'],
    ['ad', 'admin/tickets'], ['ad', 'admin/audit'], ['ad', `templates/${freeTemplate}`], ['ad', 'library'],
  ];
  for (const mobile of [false, true]) {
    const vp = mobile ? 'mobile' : 'desktop';
    const pages = {};
    for (const [who, route] of routes) {
      if (!pages[who]) {
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
        await context.addCookies(clients[who].cookieHeader().split('; ').filter(Boolean).map((s) => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
        pages[who] = await context.newPage();
        pages[who].on('pageerror', (e) => errors.push(e.message));
      }
      const page = pages[who];
      const name = `${route.replace(/[^a-z0-9]+/gi, '-').replace(/-[0-9a-f]{8}-[0-9a-f-]{27}/g, '')}-${vp}`;
      try {
        if (page.url() === 'about:blank') await page.goto(`${env.origin}/#${route}`); else await page.evaluate((r) => { location.hash = r; }, route);
        await page.waitForFunction(() => !document.querySelector('#app').inert && !document.querySelector('#app').hasAttribute('aria-busy') && !document.querySelector('.loading-line'), { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(700);
        await page.keyboard.press('Shift');
        const issues = [...await page.evaluate(formAlignmentIssues, 'body'), ...await page.evaluate(choiceControlIssues, 'body'), ...await page.evaluate(focusClipIssues, '#main')];
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || innerWidth > (visualViewport?.width || innerWidth) + 1);
        const problems = [...issues, ...(overflow ? ['página mais larga que a tela'] : [])];
        await page.screenshot({ path: `${dir}/${name}.png` });
        results.push({ name, problems });
        console.log(`${problems.length ? '✗' : '✓'} ${name}${problems.length ? '\n    ' + problems.join('\n    ') : ''}`);
      } catch (error) {
        results.push({ name, problems: ['falhou: ' + error.message.split('\n')[0]] });
        console.log(`? ${name} ${error.message.split('\n')[0]}`);
      }
    }
    for (const p of Object.values(pages)) await p.context().close();
  }
  const failed = results.filter((r) => r.problems.length);
  console.log(JSON.stringify({ total: results.length, failed: failed.length, errors }, null, 2));
  if (failed.length || errors.length) process.exitCode = 1;
} catch (error) {
  console.error(error); console.error(env.logs().slice(-2000)); process.exitCode = 1;
} finally {
  await writeFile(`${dir}/report.json`, JSON.stringify({ results, errors }, null, 2));
  await browser?.close(); await env.stop();
}
