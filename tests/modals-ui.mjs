// QA visual de todos os modais alcançáveis, contra PostgreSQL isolado. Playwright local: artifacts/qa-runtime.
// Abre cada modal em desktop (1440×900) e celular (390×844), mede problemas de layout e gera capturas + folha de contato.
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
import { formAlignmentIssues, focusClipIssues, choiceControlIssues } from './support/form-alignment.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const dir = 'artifacts/qa/modais';
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5263 });
const free = '00000000-0000-4000-8000-000000000001', freeTemplate = '00000000-0000-4000-8000-000000000101';
const results = [], errors = [];
let browser;
try {
  const master = await env.verifiedClient('modal.master@example.test', 'Aurora do Vale');
  const player = await env.verifiedClient('modal.player@example.test', 'Lira das Marés');
  const admin = await env.verifiedClient('modal.admin@example.test', 'Admin');
  env.sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='modal.admin@example.test'`);
  await env.authenticateMfa(admin, 'modal.admin@example.test');
  const campaign = await master('/api/campaigns', 'POST', { name: 'Crônicas dos modais', description: 'Uma campanha para revisar janelas.', rpgSystemId: free, playMode: 'tactical' });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  const offline = await master('/api/campaigns', 'POST', { name: 'Campanha sem sessão', description: '', rpgSystemId: free });
  await player('/api/campaigns/join', 'POST', { code: detail.inviteCode });
  const hero = await player('/api/characters', 'POST', { campaignId: campaign.id, name: 'Lira' });
  await master(`/api/campaigns/${campaign.id}/npcs`, 'POST', { name: 'Capitã Vela', summary: 'Guarda do porto', notes: '', side: 'neutral', resources: [{ label: 'Moral', value: 3, max: 5 }] });
  await master(`/api/campaigns/${campaign.id}/assets/folders`, 'POST', { name: 'Reino do Norte', parentId: null });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, 'POST', { title: 'Travessia', objective: '', mapKind: 'tileset', mapKey: 'bridge' });
  await master(`/api/sessions/${session.id}/join`, 'POST', {}, 204);
  await player(`/api/sessions/${session.id}/join`, 'POST', { characterId: hero.id }, 204);
  const topic = await player('/api/guild/topics', 'POST', { categoryId: '00000000-0000-4000-8000-000000000202', title: 'Boas histórias', body: 'Como preparar uma aventura em grupo?' });
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const clients = { m: master, p: player, ad: admin };
  const playerId = (await admin('/api/admin/users?q=modal.player')).items[0].id;
  async function pageFor(client, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
    await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map((s) => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (/Content Security Policy|violates.*directive/i.test(m.text())) errors.push(m.text()); });
    return page;
  }
  const ready = (page) => page.waitForFunction(() => !document.querySelector('#app').inert && !document.querySelector('#app').hasAttribute('aria-busy'), { timeout: 20000 });
  // [cliente, rota, seletor de prontidão, cliques até o modal, nome]
  const C = campaign.id;
  const steps = [
    ['m', 'campaigns', '[data-action=campaign-create]', ['[data-action=campaign-create]'], 'campanha-nova'],
    ['m', 'campaigns', '[data-action=campaign-join]', ['[data-action=campaign-join]'], 'campanha-convite'],
    ['m', `campaign/${offline.id}/settings`, '[data-action=cp-edit]', ['[data-action=cp-edit]'], 'campanha-editar'],
    ['m', `campaign/${offline.id}/sessions`, '[data-action=cp-start]', ['[data-action=cp-start]'], 'sessao-iniciar'],
    ['m', `campaign/${C}/journal`, '[data-action=jr-schedule]', ['[data-action=jr-schedule]'], 'diario-data'],
    ['m', `campaign/${C}/journal`, '[data-action=jr-new]', ['[data-action=jr-new]'], 'diario-pista'],
    ['m', `campaign/${C}/prep`, '[data-action=pp-npc]', ['[data-action=pp-npc]'], 'npc-novo'],
    ['m', `campaign/${C}/prep`, '[data-action=pp-scene]', ['[data-action=pp-scene]'], 'editor-cena'],
    ['m', `campaign/${C}/players`, '.page-tabs', ['[data-action=cp-remove]'], 'jogador-remover'],
    ['m', `campaign/${C}/maps`, '[data-action=ca-folder]', ['[data-action=ca-folder]'], 'pasta-nova'],
    ['m', `campaign/${C}/maps`, '.fx-folder-tile', ['.fx-folder-tile', '[data-action=ca-folder-rename]'], 'pasta-renomear'],
    ['m', `campaign/${C}/maps`, '[data-action=ca-upload]', ['[data-action=ca-upload]'], 'mapa-enviar'],
    ['m', `campaign/${C}/settings`, '.page-tabs', ['[data-action=cp-template-new]'], 'modelo-simples'],
    ['m', `campaign/${offline.id}/settings`, '[data-action=cp-delete]', ['[data-action=cp-delete]'], 'campanha-excluir'],
    ['m', 'one-shot', '[data-action=os-create]', ['[data-action=os-create]'], 'oneshot-nova'],
    ['m', 'one-shot', '[data-action=os-join]', ['[data-action=os-join]'], 'oneshot-convite'],
    ['m', 'settings', '#avatar-form', ['[data-action=auth-signout-all]'], 'conta-sair-todos'],
    ['m', `table/${C}`, '#t-turn .turn-actions', ['[data-action=t-roll-builder]'], 'mesa-rolagem'],
    ['m', `table/${C}`, '#t-turn .turn-actions', ['[data-action=t-order]'], 'mesa-ordem'],
    ['m', `table/${C}`, '#t-turn .turn-actions', ['[data-action=t-note]'], 'mesa-nota'],
    ['m', `table/${C}`, '#t-turn .turn-actions', ['[data-interface-toggle] input[value=complete]', '[data-action=t-table-settings]'], 'mesa-configuracao', 'desktop'],
    ['p', `table/${C}`, '#t-turn .turn-actions', ['[data-action=t-roll-builder]'], 'jogador-rolagem'],
    ['m', `guild/t/${topic.id}`, '[data-action=guild-report]', ['[data-action=guild-report]'], 'guilda-denunciar'],
    ['p', 'guild', '[data-action=guild-new]', ['[data-action=guild-new]'], 'guilda-topico'],
    ['p', 'support', '[data-action=sup-new]', ['[data-action=sup-new]'], 'suporte-chamado'],
    ['ad', 'library', '[data-action=lib-add]', ['[data-action=lib-add]'], 'biblioteca-material'],
    ['ad', 'admin/systems', '[data-action=admin-system-new]', ['[data-action=admin-system-new]'], 'admin-sistema'],
    ['ad', 'admin/systems', '[data-action=admin-system-table]', ['[data-action=admin-system-table]'], 'admin-mesa-padrao'],
    ['ad', 'admin/music', '[data-action=am-upload]', ['[data-action=am-upload]'], 'admin-musica'],
    ['ad', 'templates', '.page-heading', ['[data-action=tpl-new]'], 'modelo-novo'],
    ['ad', `admin/users/${playerId}`, '[data-action=admin-role]', ['[data-action=admin-role]'], 'admin-papel'],
    ['ad', `admin/users/${playerId}`, '[data-action=admin-suspend]', ['[data-action=admin-suspend]'], 'admin-suspender'],
  ];
  for (const mobile of [false, true]) {
    const vp = mobile ? 'mobile' : 'desktop';
    const pages = {};
    for (const [who, route, sel, opens, name, only] of steps) {
      if (only && only !== vp) continue;
      pages[who] ||= await pageFor(clients[who], mobile);
      const page = pages[who];
      try {
        if (page.url() === 'about:blank') await page.goto(`${env.origin}/#${route}`); else await page.evaluate((r) => { location.hash = r; }, route);
        await page.locator(sel).first().waitFor({ timeout: 15000 }); await ready(page);
        for (const o of opens) {
          const target = page.locator(o).first();
          if (mobile && !(await target.isVisible().catch(() => false)) && await page.locator('[data-action=nav-more]').isVisible().catch(() => false)) {} // ações ficam na página
          if (o.includes('input[')) await target.check(); else await target.click();
          await page.waitForTimeout(150);
        }
        await page.locator('#modal[open]').waitFor({ timeout: 8000 });
        await page.waitForTimeout(350);
        const metrics = await page.evaluate(() => {
          const d = document.querySelector('#modal'), body = document.querySelector('#modal-body'), dr = d.getBoundingClientRect();
          const visible = (e) => e.checkVisibility() && e.getBoundingClientRect().width > 0;
          const scrolled = (e) => { for (let x = e.parentElement; x && x !== body; x = x.parentElement) if (getComputedStyle(x).overflowX !== 'visible') return true; return false; };
          const outside = [...body.querySelectorAll('*')].filter(visible).filter((e) => !scrolled(e)).filter((e) => { const r = e.getBoundingClientRect(); return r.right > dr.right - 2 || r.left < dr.left + 2; }).slice(0, 4).map((e) => `${e.tagName}.${e.className}`.slice(0, 60));
          const defaultFieldsets = [...body.querySelectorAll('fieldset')].filter(visible).filter((f) => getComputedStyle(f).borderTopStyle === 'groove').length;
          const helpSizes = [...body.querySelectorAll('.help-button')].filter(visible).map((b) => Math.round(b.getBoundingClientRect().width));
          return {
            dialogScroll: d.scrollHeight > d.clientHeight + 1,
            bodyHorizontal: body.scrollWidth > body.clientWidth + 1,
            fitsViewport: dr.top >= -1 && dr.bottom <= innerHeight + 1 && dr.left >= -1 && dr.right <= innerWidth + 1,
            outside, defaultFieldsets, bigHelp: helpSizes.filter((s) => s > 20).length,
            closeTip: !!document.querySelector('#close-modal').dataset.tip,
            fechar: [...body.querySelectorAll('button')].filter((b) => visible(b) && b.textContent.trim() === 'Fechar').length,
          };
        });
        await page.keyboard.press('Shift');
        const alignment = [...await page.evaluate(formAlignmentIssues, '#modal-body'), ...await page.evaluate(choiceControlIssues, '#modal-body'), ...await page.evaluate(focusClipIssues, '#modal')];
        const problems = [...alignment, ...Object.entries({ 'rolagem no diálogo': metrics.dialogScroll, 'transbordo horizontal': metrics.bodyHorizontal, 'fora da tela': !metrics.fitsViewport, 'fieldset padrão do navegador': metrics.defaultFieldsets > 0, 'ⓘ grande': metrics.bigHelp > 0, 'tooltip no X': metrics.closeTip, 'botão Fechar duplicado': metrics.fechar > 0, [`elemento fora da borda (${metrics.outside.join(', ')})`]: metrics.outside.length > 0 }).filter(([, v]) => v).map(([k]) => k)];
        await page.locator('#modal').screenshot({ path: `${dir}/${name}-${vp}.png` });
        results.push({ name, vp, problems });
        console.log(`${problems.length ? '✗' : '✓'} ${name}-${vp}${problems.length ? ' · ' + problems.join('; ') : ''}`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#modal').open, { timeout: 3000 }).catch(async () => { await page.evaluate(() => document.querySelector('#modal').close()); });
      } catch (error) {
        results.push({ name, vp, problems: ['não abriu: ' + error.message.split('\n')[0]] });
        console.log(`? ${name}-${vp} não abriu: ${error.message.split('\n')[0]}`);
        await page.evaluate(() => document.querySelector('#modal')?.open && document.querySelector('#modal').close()).catch(() => {});
      }
    }
    for (const p of Object.values(pages)) await p.context().close();
  }
  // Folha de contato para revisão humana rápida.
  const sheet = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  for (const vp of ['desktop', 'mobile']) {
    const items = results.filter((r) => r.vp === vp && !r.problems.some((p) => p.startsWith('não abriu')));
    const html = `<body style="margin:0;background:#222;font:12px sans-serif;color:#eee"><div style="display:grid;grid-template-columns:repeat(${vp === 'mobile' ? 6 : 4},1fr);gap:8px;padding:8px">${items.map((r) => `<figure style="margin:0"><figcaption>${r.name}${r.problems.length ? ' ⚠ ' + r.problems.join('; ') : ''}</figcaption><img style="width:100%;border:1px solid #555" src="${pathToFileURL(resolve(dir, `${r.name}-${vp}.png`)).href}"></figure>`).join('')}</div></body>`;
    await writeFile(`${dir}/contato-${vp}.html`, html);
    await sheet.goto(pathToFileURL(resolve(dir, `contato-${vp}.html`)).href);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: `${dir}/contato-${vp}.png`, fullPage: true });
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
