// QA da ajuda contra PostgreSQL isolado. Playwright local: artifacts/qa-runtime (não é dependência do produto).
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir = 'artifacts/qa/ajuda-contextual';
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5258 });
const checks = [], errors = [], screenshots = [], snapshots = {};
let browser;
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
const free = '00000000-0000-4000-8000-000000000001', freeTemplate = '00000000-0000-4000-8000-000000000101';
try {
  const master = await env.verifiedClient('help.master@example.test', 'Aurora');
  const player = await env.verifiedClient('help.player@example.test', 'Lira');
  const ambassador = await env.verifiedClient('help.staff@example.test', 'Embaixadora');
  const admin = await env.verifiedClient('help.admin@example.test', 'Admin');
  env.sql(`UPDATE "AspNetUsers" SET "Role"='ambassador' WHERE "Email"='help.staff@example.test'`);
  env.sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='help.admin@example.test'`);
  await env.authenticateMfa(admin, 'help.admin@example.test');
  const campaign = await master('/api/campaigns', 'POST', { name: 'Crônicas da ajuda', description: '', rpgSystemId: free, playMode: 'tactical' });
  const detail = await master(`/api/campaigns/${campaign.id}`);
  const fresh = await master('/api/campaigns', 'POST', { name: 'Próxima aventura', description: '', rpgSystemId: free });
  await player('/api/campaigns/join', 'POST', { code: detail.inviteCode });
  const hero = await player('/api/characters', 'POST', { campaignId: campaign.id, name: 'Lira' });
  const scene = await master(`/api/campaigns/${campaign.id}/scenes`, 'POST', { name: 'Travessia', kind: 'map', mapKind: 'tileset', mapKey: 'bridge', sharedText: 'A ponte espera.', privateNotes: 'Preparo reservado', visionMode: 'manual' });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, 'POST', { title: 'Travessia', objective: '', mapKind: 'tileset', mapKey: 'bridge' });
  await master(`/api/sessions/${session.id}/join`, 'POST', {}, 204);
  await player(`/api/sessions/${session.id}/join`, 'POST', { characterId: hero.id }, 204);
  const topic = await player('/api/guild/topics', 'POST', { categoryId: '00000000-0000-4000-8000-000000000202', title: 'Boas histórias', body: 'Como preparar uma aventura em grupo?' });
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  async function pageFor(client, mobile = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: mobile ? 'reduce' : 'no-preference', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
    if (client) await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map((s) => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i+1), url: env.origin }; }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (/Content Security Policy|violates.*directive|Refused to (apply|execute|load)/i.test(m.text())) errors.push(m.text()); });
    return page;
  }
  async function ready(page) { await page.waitForFunction(() => !document.querySelector('#app').inert && !document.querySelector('#app').hasAttribute('aria-busy'), { timeout: 20000 }); }
  async function go(page, route, selector) {
    console.log('Visitando', route);
    if (page.url() === 'about:blank') await page.goto(`${env.origin}/#${route}`);
    else await page.evaluate((r) => { location.hash = r; }, route);
    await page.locator(selector).first().waitFor({ timeout: 20000 }); await ready(page);
  }
  async function shot(page, name) {
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name+' sem overflow horizontal');
    await page.screenshot({ path: `${dir}/${name}.png` }); screenshots.push(name+'.png');
    snapshots[name] = await page.locator('body').ariaSnapshot();
  }
  async function keyboardReach(page, selector) {
    const target = page.locator(selector).first(); await target.scrollIntoViewIfNeeded();
    await page.locator('#main').focus();
    for (let i=0; i<180; i++) {
      await page.keyboard.press('Tab');
      if (await target.evaluate((el) => document.activeElement === el)) return;
    }
    throw new Error('Teclado não alcançou '+selector);
  }
  // ⓘ discreto e colado ao texto a que se refere (mesma linha, poucos pixels depois do texto anterior).
  async function aligned(page, name) {
    const items = await page.evaluate(() => [...document.querySelectorAll('.help-button')].filter((b) => b.checkVisibility()).map((b) => {
      const r = b.getBoundingClientRect(), range = document.createRange();
      range.setStart(b.parentElement, 0); range.setEndBefore(b);
      // Ao lado de um controle (ex.: Instalar app), mede a partir da borda do controle, não do texto dentro dele.
      const prev = b.previousElementSibling, control = prev && prev.matches('button, a, input, select') && prev.nextSibling === b ? prev.getBoundingClientRect() : null;
      const last = control || [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0).at(-1);
      return { key: b.dataset.help, size: Math.round(r.width), gap: last ? Math.round(r.left - last.right) : null, dy: last ? Math.round(r.top + r.height / 2 - (last.top + last.height / 2)) : null };
    }));
    check(items.length > 0, name+' tem ⓘ');
    for (const i of items) {
      check(i.size <= 20, `${name} ${i.key} discreto (${i.size}px)`);
      if (i.gap !== null) check(i.gap >= 0 && i.gap <= 16 && Math.abs(i.dy) <= 10, `${name} ${i.key} ao lado do texto (gap ${i.gap}, dy ${i.dy})`);
    }
  }
  async function help(page, key, name, keyboard = false) {
    console.log('Verificando', name, key);
    const selector = `[data-help="${key}"]`, button = page.locator(selector).first();
    await button.waitFor(); await button.scrollIntoViewIfNeeded();
    check((await button.getAttribute('aria-label')).startsWith('Ajuda: '), name+' nome acessível');
    if (keyboard) { await keyboardReach(page, selector); await page.keyboard.press('Enter'); } else await button.click();
    await page.locator('#help-popup:popover-open').waitFor();
    await page.waitForFunction(() => document.querySelector('#help-content')?.textContent && !/Carregando/.test(document.querySelector('#help-content').textContent));
    check(await page.locator('#help-popup').evaluate((el) => document.activeElement === el), name+' foco no popup');
    check(await button.getAttribute('aria-expanded') === 'true', name+' expanded sincronizado');
    check(await page.locator('#help-popup').getAttribute('role') === 'dialog', name+' semântica de diálogo não modal');
    // Padrão único: popup centralizado, fundo escurecido e só o X para fechar.
    const rect = await page.locator('#help-popup').boundingBox(), viewport = page.viewportSize();
    check(Math.abs(rect.x + rect.width / 2 - viewport.width / 2) <= 2 && Math.abs(rect.y + rect.height / 2 - viewport.height / 2) <= 2, name+' centralizado');
    check(await page.locator('#help-popup').evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor !== 'rgba(0, 0, 0, 0)'), name+' fundo escurecido');
    check(await page.locator('#help-popup [data-help-close]').evaluate((el) => el.textContent.trim() === '×' && el.getAttribute('aria-label') === 'Fechar ajuda' && !el.dataset.tip), name+' fecha só pelo X');
    if (name.includes('mobile')) check(await page.locator('#help-popup').evaluate((el) => getComputedStyle(el).animationName === 'none'), name+' movimento reduzido');
    await shot(page,name);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#help-popup').matches(':popover-open'));
    check(await button.evaluate((el) => document.activeElement === el), name+' retorna foco');
    check(await button.getAttribute('aria-expanded') === 'false', name+' expanded fechado');
  }
  for (const mobile of [false,true]) {
    const suffix = mobile ? 'mobile' : 'desktop';
    const m = await pageFor(master,mobile), p = await pageFor(player,mobile), a = await pageFor(ambassador,mobile), ad = await pageFor(admin,mobile);
    await go(m,'overview','#home-next .resume-card');
    const resume = await m.locator('#home-next .resume-card').first().evaluate((card) => ({ card: card.getBoundingClientRect().width, button: card.querySelector('.button').getBoundingClientRect().width }));
    check(resume.button < resume.card * 0.6, suffix+' Continuar sem ocupar o cartão inteiro');
    await shot(m,`inicio-${suffix}`);
    await go(m,'settings','#avatar-form');
    await aligned(m,`conta-${suffix}`);
    await help(m,'conta.perfil.avatar',`conta-${suffix}`,true);
    await go(m,'campaigns','[data-action=campaign-create]');
    await aligned(m,`campanhas-${suffix}`);
    await help(m,'campanhas.lista.papeis',`campanhas-${suffix}`,true);
    const tip = m.locator('.level-chip');
    if (mobile) await m.locator('[data-action=nav-more]').click();
    await tip.focus();
    await m.keyboard.press('Tab'); await m.keyboard.press('Shift+Tab');
    await m.locator('#help-tooltip:popover-open').waitFor();
    check(await tip.getAttribute('aria-describedby') === 'help-tooltip',suffix+' tooltip por foco');
    await m.keyboard.press('Escape'); check(await m.locator('#help-tooltip').evaluate((e) => !e.matches(':popover-open')),suffix+' Esc dispensa tooltip');
    check(await tip.evaluate((e) => document.activeElement===e), suffix+' Esc mantém foco tooltip');
    if (!mobile) {
      await m.locator('#main').focus(); await tip.hover();
      await m.locator('#help-tooltip:popover-open').waitFor();
      const tooltip = m.locator('#help-tooltip'); await tooltip.hover();
      check(await tooltip.evaluate((e) => e.matches(':popover-open')), 'tooltip permanece no hover próprio');
      await shot(m,'tooltip-desktop'); await m.keyboard.press('Escape');
    } else {
      await m.locator('#main').focus(); await tip.tap();
      check(await m.locator('#help-tooltip').evaluate((e) => !e.matches(':popover-open')), 'toque não abre tooltip');
      await go(m,'campaigns','[data-action=campaign-create]');
    }
    await m.locator('[data-action=campaign-create]').click();
    await help(m,'campanhas.config.forma-de-jogar',`modal-campanha-${suffix}`);
    check(await m.locator('#modal').evaluate((e) => e.open),'Esc da ajuda preserva modal');
    await m.locator('#close-modal').click();
    await go(m,`campaign/${fresh.id}/sessions`,'[data-action=cp-start]');
    await m.locator('[data-action=cp-start]').first().click();
    await help(m,'sessoes.abertura.unica',`sessoes-${suffix}`,true);
    await m.locator('#close-modal').click();
    await go(m,`campaign/${campaign.id}/prep`,'[data-action=pp-scene]');
    await aligned(m,`preparo-${suffix}`);
    await shot(m,`preparo-${suffix}`);
    await m.locator('[data-action=pp-scene][data-id="'+scene.id+'"]').click();
    await m.locator('.scene-editor').waitFor();
    check(await m.locator('[data-action=se-close]').count() === 0, suffix+' editor sem botão Fechar duplicado');
    check(await m.locator('#close-modal').evaluate((el) => !el.dataset.tip), suffix+' X do diálogo sem tooltip');
    if (!mobile) check(await m.locator('#modal').evaluate((el) => el.scrollHeight <= el.clientHeight + 1), 'editor sem rolagem externa');
    await m.locator('[data-action=se-tool][data-id=scenery]').first().click();
    await m.locator('.se-scenery .map-choice').first().waitFor();
    check(await m.locator('.se-kind .se-option').first().evaluate((l) => l.querySelector('small').getBoundingClientRect().top > l.querySelector('strong').getBoundingClientRect().bottom - 1), suffix+' tipo de cena com título e descrição em linhas separadas');
    await aligned(m,`editor-${suffix}`);
    await shot(m,`editor-cenario-${suffix}`);
    await help(m,'mesa.interface.apresentacao',`editor-basico-${suffix}`);
    await m.locator('[data-interface-toggle] input[name=se-interface][value=complete]').check();
    if (mobile) await m.locator('[data-se-category]').selectOption('scene');
    await m.locator('[data-action=se-tool][data-id=sceneSettings]').click();
    await help(m,'campanhas.cenas.alcance',`editor-completo-${suffix}`);
    await m.locator('#close-modal').click();
    await m.waitForFunction(() => !document.querySelector('#modal').open);
    await go(m,`table/${campaign.id}`,'#t-turn .turn-actions');
    await help(m,'mesa.interface.apresentacao',`mesa-interface-${suffix}`,true);
    await m.locator('[data-interface-toggle] input[name=t-interface][value=complete]').check();
    await m.locator('[data-action=t-table-settings]').click();
    await help(m,'mesa.config.nevoa',`mesa-config-${suffix}`);
    await m.locator('#close-modal').click();
    await m.locator('[data-action=t-roll-builder]').first().click();
    await help(m,'mesa.rolagem.visibilidade',`mesa-dados-${suffix}`);
    await m.locator('#close-modal').click();
    await go(p,`character/${hero.id}`,'#cs-form');
    await help(p,'fichas.visibilidade.privacidade',`fichas-${suffix}`,true);
    await go(a,`templates/${freeTemplate}`,'[data-help="modelos.versao.publicacao"]');
    await help(a,'modelos.versao.publicacao',`modelos-${suffix}`,true);
    await go(p,'library','[data-help="biblioteca.arquivos.verificacao"]');
    await help(p,'biblioteca.arquivos.verificacao',`biblioteca-${suffix}`,true);
    await go(p,`guild/t/${topic.id}`,'[data-help="guilda.posts.util"]');
    await help(p,'guilda.posts.util',`guilda-${suffix}`,true);
    await go(p,'progress','[data-help="progresso.jornada.niveis"]');
    await help(p,'progresso.jornada.niveis',`progresso-${suffix}`,true);
    await go(p,'support','[data-help="suporte.chamados.categorias"]');
    await help(p,'suporte.chamados.categorias',`suporte-${suffix}`,true);
    await go(ad,'admin/systems','[data-action=admin-system-edit]');
    await ad.locator('[data-action=admin-system-edit]').first().click();
    await help(ad,'admin.sistemas.identificador',`admin-${suffix}`,true);
    await Promise.all([m.context().close(),p.context().close(),a.context().close(),ad.context().close()]);
  }
  const errorPage = await pageFor(null);
  await errorPage.route('**/js/help/conta.js', (route) => route.abort());
  await go(errorPage,'login','[data-help="conta.acesso.persistencia"]');
  await errorPage.locator('[data-help="conta.acesso.persistencia"]').click();
  await errorPage.getByText('Não foi possível carregar esta ajuda.').waitFor();
  check(await errorPage.locator('#toast').textContent()==='', 'falha de catálogo fica no popup sem toast');
  await shot(errorPage,'falha-catalogo');
  await errorPage.locator('[data-help-close]').click();
  check(await errorPage.locator('[data-help="conta.acesso.persistencia"]').evaluate((e) => document.activeElement===e), 'Fechar devolve foco');
  check(errors.length===0,'nenhum erro de página ou CSP');
  console.log(JSON.stringify({ checks:checks.length, screenshots:screenshots.length, errors },null,2));
} catch (error) {
  errors.push(error.stack); console.error(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({path:`${dir}/failure-${browser.contexts().indexOf(context)}.png`,fullPage:true}).catch(()=>{});
    console.error('PAGE',page.url(), (await page.locator('body').innerText()).slice(-1200));
  }
  process.exitCode = 1;
} finally {
  await writeFile(`${dir}/report.json`,JSON.stringify({checks,screenshots,errors},null,2));
  await writeFile(`${dir}/accessibility.json`,JSON.stringify(snapshots,null,2));
  await browser?.close(); await env.stop();
}
