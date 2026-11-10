// Regressão da mesa horizontal com servidor/PostgreSQL isolados e navegador real.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
const dir = 'artifacts/qa/mesa-horizontal';
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5271 });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const checks = [], errors = [];
const check = (value, name) => { assert.ok(value, name); checks.push(name); };
try {
  const master = await env.verifiedClient('horizontal.master@example.test', 'Aurora');
  const player = await env.verifiedClient('horizontal.player@example.test', 'Lira');
  await master('/api/auth/preferences', 'PUT', { interfaceMode: 'complete' }, 204);
  const campaign = await master('/api/campaigns', 'POST', { name: 'A Sombra de Valdaran', description: '', rpgSystemId: '00000000-0000-4000-8000-000000000001', playMode: 'tactical' });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, 'POST', { title: 'Ruínas ao entardecer', mapKind: 'tileset', mapKey: 'crypt', objective: '' });
  async function pageFor(client, mobile, manualOnly = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s => { const i=s.indexOf('='); return { name:s.slice(0,i), value:s.slice(i+1), url:env.origin }; }));
    if (manualOnly) await context.addInitScript(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
      Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: undefined });
      HTMLMediaElement.prototype.play = async () => { throw new DOMException('Autoplay bloqueado (emulado)', 'NotAllowedError'); };
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/violates.*directive|Refused to (apply|execute|load)/i.test(m.text())) errors.push(m.text()); });
    await page.goto(`${env.origin}/#table/${campaign.id}`);
    await page.locator('#t-campaign').filter({ hasText: campaign.name }).waitFor({ state: 'attached' });
    await page.waitForFunction(() => !document.querySelector('#app').inert && document.querySelector('.table-shell')?.dataset.view);
    return page;
  }
  async function shot(page, name) { await page.screenshot({ path: `${dir}/${name}.png` }); }
  async function geometry(page, name) {
    // Chromium atualiza dvh/vw em um frame posterior a setViewportSize em emulação móvel.
    await page.waitForFunction(() => Math.abs(document.querySelector('.table-shell').getBoundingClientRect().height - innerHeight) < 1, null, {timeout:5000});
    const g = await page.evaluate(() => {
      const rect = s => { const r=document.querySelector(s).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
      return { stage:rect('#main'), board:rect('#t-board'), bottom:rect('.table-bottom'), nav:rect('#t-views'), width:innerWidth, height:innerHeight, scroll:document.documentElement.scrollWidth, shell:rect('.table-shell') };
    });
    check(await page.locator('.turn-actions button').first().isVisible(), `${name}: ações continuam disponíveis`);
    check(g.scroll <= g.width, `${name}: sem overflow da página`);
    check(g.stage.bottom <= g.bottom.y + 1, `${name}: ações não cobrem o mapa`);
    check(g.board.height >= Math.min(120, g.height * .3), `${name}: mapa tem altura utilizável`);
    check(g.nav.bottom <= g.height + 1, `${name}: navegação cabe na tela ${JSON.stringify(g)}`);
    check(g.shell.bottom <= g.height + 1, `${name}: shell cabe na tela`);
    return g;
  }
  const mp = await pageFor(master, true);
  check(await mp.locator('.table-rotate').isVisible(), 'retrato exige girar');
  check(await mp.locator('.table-shell').evaluate(e => e.inert), 'mesa fica inerte em retrato');
  check(await mp.locator('.table-rotate a').isVisible(), 'saída disponível em retrato');
  await shot(mp, '01-rotacao');
  if (await mp.locator('#rotate-enter').isVisible()) {
    await mp.locator('#rotate-enter').click();
    await mp.waitForFunction(() => !document.querySelector('#rotate-enter').disabled);
    check(await mp.locator('.table-rotate').isVisible(), 'lock não suportado conserva instrução manual');
    check(/rotação|manualmente/.test(await mp.locator('#rotate-status').textContent()), 'fallback de orientação explica o próximo passo');
    await mp.evaluate(async () => { if(document.fullscreenElement) await document.exitFullscreen(); });
  }
  for (const [width,height] of [[844,390],[740,360],[932,430],[640,320]]) {
    await mp.setViewportSize({ width,height });
    await mp.locator('#main').waitFor({ state:'visible' });
    await geometry(mp, `mestre ${width}x${height}`);
    check(await mp.locator('#t-master-why').count() === 1, 'requisito compartilhado do mestre');
    check(await mp.locator('#t-turn .help-disabled-reason').count() === 0, 'sem requisitos duplicados na barra');
    await shot(mp, `02-mestre-${width}`);
  }
  await mp.setViewportSize({ width:844,height:390 });
  await mp.locator('[data-action="t-fog-group"][data-id="reveal"]').click();
  await mp.locator('#t-fog').waitFor();
  for (const width of [844, 932]) {
    await mp.setViewportSize({width,height:390});
    await mp.waitForFunction(() => { const fog=document.querySelector('#t-fog').getBoundingClientRect(); const board=document.querySelector('#t-board').getBoundingClientRect(); return board.y >= fog.bottom && board.height > 30; });
    check(true, 'paleta reserva espaço após redimensionar');
  }
  await shot(mp,'08-nevoa');
  await mp.locator('#t-fog [data-action="t-tool-select"]').click();
  await mp.setViewportSize({width:844,height:390});
  const admin = await env.verifiedClient('horizontal.admin@example.test','Conselho');
  env.sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='horizontal.admin@example.test'`);
  await env.authenticateMfa(admin,'horizontal.admin@example.test');
  const bytes=Buffer.alloc(1000*417);
  for(let i=0;i<1000;i++) bytes.set([0xff,0xfb,0x90,0x64],i*417);
  const form=new FormData();
  form.append('title','Eternnus RPG - City 1 - The Beginning of a Journey');
  form.append('file',new Blob([bytes],{type:'audio/mpeg'}),'tema.mp3');
  const track=await admin('/api/admin/music','POST',form);
  const before=await master(`/api/sessions/${session.id}/live`);
  await master(`/api/sessions/${session.id}/music`,'POST',{action:'select',version:before.music.version,trackId:track.id,autoplay:false});
  await mp.locator('#t-audio').waitFor();
  await geometry(mp,'trilha selecionada');
  await shot(mp,'09-trilha');
  await mp.locator('[data-action="t-view"][data-id="chat"]').click();
  const stage = await geometry(mp, 'conversa lateral');
  check(await mp.locator('.side-panel').isVisible(), 'conversa abre ao lado do mapa');
  check((await mp.locator('.side-panel').boundingBox()).x >= stage.stage.right, 'painel não cobre o mapa');
  await mp.locator('#t-message').fill('Mensagem de teste na horizontal');
  await mp.locator('#t-chat button[type="submit"]').click();
  await mp.locator('#t-panel').getByText('Mensagem de teste na horizontal', { exact:true }).waitFor();
  checks.push('conversa envia mensagem');
  await shot(mp, '03-conversa');
  await mp.locator('[data-action="t-view"][data-id="party"]').click();
  check(await mp.locator('.party').isVisible() && await mp.locator('#main').isVisible(), 'grupo e mapa visíveis juntos');
  await mp.locator('[data-action="t-view"][data-id="map"]').click();
  await mp.locator('[data-action="t-roll-builder"]').click();
  await mp.locator('#modal[open]').waitFor();
  check((await mp.locator('#modal').boundingBox()).height <= 390, 'rolagem cabe na altura móvel');
  await shot(mp, '04-rolagem');
  await mp.locator('#close-modal').click();
  await mp.setViewportSize({width:390,height:844});
  check(await mp.locator('.table-rotate').isVisible(), 'voltar a retrato restaura orientação obrigatória');
  await mp.locator('.table-rotate a').click();
  await mp.locator('.campaign-hero').waitFor();
  check(await mp.locator('.table-rotate').count() === 0, 'saída descarta a orientação');
  await player('/api/campaigns/join', 'POST', { code:(await master(`/api/campaigns/${campaign.id}`)).inviteCode });
  const hero = await player('/api/characters','POST',{campaignId:campaign.id,name:'Lira'});
  await player(`/api/sessions/${session.id}/join`,'POST',{characterId:hero.id},204);
  const pp = await pageFor(player, true);
  await pp.setViewportSize({width:844,height:390});
  await pp.locator('#main').waitFor({state:'visible'});
  await geometry(pp,'jogador aguardando');
  await pp.setViewportSize({width:640,height:320});
  await geometry(pp,'jogador em tela pequena');
  await pp.setViewportSize({width:844,height:390});
  await shot(pp,'05-jogador');
  await pp.locator('[data-action="t-view"][data-id="sheet"]').click();
  check(await pp.locator('.sheet-summary').isVisible(), 'ficha lateral do jogador');
  await geometry(pp,'ficha do jogador');
  await shot(pp,'06-ficha');
  // Simula apenas o suporte da API, sem declarar rotação física como testada.
  await pp.evaluate(() => {
    globalThis.orientationCalls = [];
    Object.defineProperty(screen.orientation, 'lock', { configurable:true, value:async kind => { orientationCalls.push(kind); } });
    Object.defineProperty(screen.orientation, 'unlock', { configurable:true, value:() => { orientationCalls.push('unlock'); } });
    location.hash = 'campaign/' + document.querySelector('.table-brand').hash.split('/')[1];
  });
  await pp.locator('.campaign-hero').waitFor();
  await pp.evaluate(id => { location.hash='table/'+id; },campaign.id);
  await pp.locator('#t-campaign').filter({hasText:campaign.name}).waitFor();
  check((await pp.evaluate(() => orientationCalls)).includes('landscape'), 'suporte simulado tenta lock ao entrar');
  await pp.evaluate(id => { location.hash='campaign/'+id; },campaign.id);
  await pp.locator('.campaign-hero').waitFor();
  check((await pp.evaluate(() => orientationCalls)).includes('unlock'), 'saída libera bloqueio adquirido');
  const musicState = await master(`/api/sessions/${session.id}/live`);
  await master(`/api/sessions/${session.id}/music`,'POST',{action:'play',version:musicState.music.version});
  const manual = await pageFor(player, true, true);
  check(await manual.locator('.table-rotate').isVisible(), 'sem APIs exige rotação manual');
  check(!await manual.locator('#rotate-enter').isVisible(), 'sem suporte não oferece fullscreen indisponível');
  await manual.setViewportSize({width:844,height:390});
  await manual.locator('#main').waitFor({state:'visible'});
  await geometry(manual,'rotação manual sem APIs');
  await manual.locator('.sa-unlock').waitFor();
  await manual.locator('.sa-unlock').scrollIntoViewIfNeeded();
  const audioBox=await manual.locator('.sa-unlock').boundingBox();
  check(audioBox.x >= 0 && audioBox.x+audioBox.width <= 844 && audioBox.y+audioBox.height <= 54, 'ativação de áudio bloqueado cabe no topo');
  await manual.locator('[data-action="t-view"][data-id="chat"]').click();
  await manual.locator('#t-message').fill('Rascunho preservado');
  await manual.setViewportSize({width:844,height:240});
  await manual.waitForFunction(() => Math.abs(document.querySelector('.table-shell').getBoundingClientRect().height - 240) < 1);
  const messageBox = await manual.locator('#t-message').boundingBox();
  const navBox = await manual.locator('.table-bottom').boundingBox();
  check(messageBox.y + messageBox.height <= navBox.y, 'campo de conversa cabe acima do rodapé com altura reduzida');
  await manual.setViewportSize({width:844,height:390});
  check(await manual.locator('#t-message').inputValue() === 'Rascunho preservado', 'redimensionar preserva rascunho');
  await shot(manual,'10-manual');
  // Gestos reais via protocolo de toque do Chromium, sem simular PointerEvent no DOM.
  const cameraPage = await pageFor(master, true);
  await cameraPage.setViewportSize({width:844,height:390});
  await cameraPage.locator('#main').waitFor({state:'visible'});
  await geometry(cameraPage,'câmera ampliada');
  const cdp = await cameraPage.context().newCDPSession(cameraPage);
  async function pinch(selector, apart=true) {
    const r=await cameraPage.locator(selector).boundingBox();
    const cx=r.x+r.width/2, cy=r.y+r.height/2;
    const a=apart?12:80, b=apart?80:12;
    const points = d => [{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(a)});
    for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(a+(b-a)*i/8)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  async function circles(page, label) {
    const bad=await page.locator('.help-button').evaluateAll(es=>es.filter(e=>e.checkVisibility()).map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(r=>Math.abs(r.w-18)>.1 || Math.abs(r.h-18)>.1));
    check(bad.length===0,`${label}: ajuda circular 18×18`);
  }
  await circles(cameraPage,'mesa');
  const zoomBefore=await cameraPage.locator('#t-board').getAttribute('data-zoom');
  const writes=[];
  const trackWrites=req=> { if(req.method()!=='GET' && /\/api\/sessions\//.test(req.url()) && !/heartbeat/.test(req.url())) writes.push(req.url()); };
  cameraPage.on('request',trackWrites);
  await pinch('#t-board');
  check(Number(await cameraPage.locator('#t-board').getAttribute('data-zoom'))>Number(zoomBefore),'pinça aproxima mapa');
  const limit=await cameraPage.locator('#t-board').getAttribute('data-zoom');
  await pinch('#t-board');
  check(await cameraPage.locator('#t-board').getAttribute('data-zoom')===limit,'zoom máximo limitado');
  await pinch('#t-board',false); await pinch('#t-board',false);
  check(Number(await cameraPage.locator('#t-board').getAttribute('data-zoom'))===1,'pinça afasta até o mapa inteiro');
  check(await cameraPage.evaluate(()=>visualViewport.scale)===1,'pinça não amplia a página');
  check(writes.length===0,'pinça não escreve na sessão');
  cameraPage.off('request',trackWrites);
  await cameraPage.locator('[data-camera="size"]').click();
  await cameraPage.locator('.table-top-scroll').evaluate(e=>e.scrollLeft=0);
  await shot(cameraPage,'11-mapa-ampliado');
  check(await cameraPage.evaluate(()=>visualViewport.scale)===1,'página mantém escala antes da pintura');
  // Pinça no modo de pintura cancela o traço antes de enviar.
  await cameraPage.locator('[data-action="t-fog-group"][data-id="reveal"]').click();
  cameraPage.on('request',trackWrites);
  await pinch('#t-board');
  check(writes.length===0,'pinça cancela pintura sem gravar');
  cameraPage.off('request',trackWrites);
  await cameraPage.locator('#t-fog [data-action="t-tool-select"]').click();
  check(await cameraPage.evaluate(()=>visualViewport.scale)===1,'página mantém escala depois da pintura');
  const scene=await master(`/api/campaigns/${campaign.id}/scenes`,'POST',{name:'Preparação visual',kind:'map',mapKey:'crypt',sharedText:'',privateNotes:'',order:0});
  for(const [kind,id] of [['scene',scene.id],['layer','crypt']]) {
    await cameraPage.evaluate(async ({campaignId,kind,id})=>{
      const {openSceneEditor}=await import('/js/scene-editor.js');
      void openSceneEditor({campaign:{id:campaignId,name:'A Sombra de Valdaran'},...(kind==='layer'?{kind:'layer',mapKey:id}:{sceneId:id})});
    },{campaignId:campaign.id,kind,id});
    await cameraPage.locator('.scene-editor').waitFor();
    await cameraPage.waitForFunction(()=>Number(document.querySelector('#se-board').dataset.zoom)>1);
    await circles(cameraPage,kind);
    const before=await cameraPage.locator('#se-board').getAttribute('data-zoom');
    console.log('editor-before', await cameraPage.evaluate(()=>({scale:visualViewport.scale,width:innerWidth,height:innerHeight,board:document.querySelector('#se-board').getBoundingClientRect().toJSON(),touch:getComputedStyle(document.querySelector('#se-board')).touchAction,canvas:getComputedStyle(document.querySelector('#se-board canvas')).touchAction})));
    await pinch('#se-board');
    console.log('editor-after', await cameraPage.evaluate(()=>({scale:visualViewport.scale,width:innerWidth,height:innerHeight,close:document.querySelector('#close-modal').getBoundingClientRect().toJSON()})));
    check(await cameraPage.evaluate(()=>visualViewport.scale)===1,`${kind}: pinça não amplia o diálogo`);
    check(Number(await cameraPage.locator('#se-board').getAttribute('data-zoom'))>Number(before),`${kind}: pinça na preparação`);
    await cameraPage.locator('[data-action="se-properties"]').click();
    check(await cameraPage.locator('#se-side').isVisible(),`${kind}: propriedades acessíveis`);
    await cameraPage.locator('[data-action="se-properties"]').click();
    check(!await cameraPage.locator('#se-side').isVisible(),`${kind}: recolher amplia prévia`);
    await cameraPage.locator('.se-controls').evaluate(e=>e.scrollLeft=0);
    await shot(cameraPage,`12-editor-${kind}`);
    await cameraPage.locator('#close-modal').click();
  }
  // Prévia do ajuste de grade usa o mesmo gesto, preservando seus valores.
  await cameraPage.evaluate(async()=>{
    const {modal}=await import('/js/ui.js');
    const {gridAdjustHtml,mountGridAdjust}=await import('/js/grid-adjust.js');
    modal('Ajustar grade',gridAdjustHtml('qa',{}, {complete:true}));
    const ctl=mountGridAdjust(document.querySelector('#modal'),'/assets/valley.webp');
    document.querySelector('#modal').addEventListener('close',()=>ctl.dispose(),{once:true});
  });
  await cameraPage.waitForFunction(()=>document.querySelector('[data-grid-canvas]').width>1);
  const gridBefore=await cameraPage.locator('input[name="gridPixels"]').inputValue();
  await pinch('.grid-preview');
  check(Number(await cameraPage.locator('.grid-preview').getAttribute('data-zoom'))>1,'pinça na prévia de grade');
  check(await cameraPage.locator('input[name="gridPixels"]').inputValue()===gridBefore,'zoom não muda grade salva');
  await pinch('.grid-preview',false);await pinch('.grid-preview',false);
  check(Number(await cameraPage.locator('.grid-preview').getAttribute('data-zoom'))===1,'prévia respeita zoom mínimo');
  await circles(cameraPage,'ajuste de grade');
  await cameraPage.locator('#close-modal').click();
  const desktop = await pageFor(master, false);
  check(await desktop.locator('.party').isVisible() && await desktop.locator('.side-panel').isVisible(), 'desktop mantém três colunas');
  check(!await desktop.locator('.table-rotate').isVisible(), 'desktop sem bloqueio de orientação');
  await shot(desktop,'07-desktop');
  check(errors.length === 0, `sem erros JS/CSP: ${errors.join('; ')}`);
  await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors},null,2));
  console.log(`${checks.length} verificações aprovadas; capturas em ${dir}`);
} catch (error) { console.error(error); console.error('Erros de navegador:', errors); for (const context of browser.contexts()) for (const page of context.pages()) { console.error(await page.locator('#t-turn').innerHTML({timeout:1000}).catch(() => 'sem mesa')); await page.screenshot({path:dir+'/failure.png'}).catch(() => {}); } throw error; } finally { await browser.close(); await env.stop(); }

