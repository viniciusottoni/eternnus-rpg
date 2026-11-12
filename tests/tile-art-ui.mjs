// Arte oficial no Chromium: pixels de névoa/recorte, repetibilidade e mesa real.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
const dir = 'artifacts/qa/tile-art';
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5278, startupTimeoutMs: 120000 });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const checks = [], errors = [];
const check = (v, label) => { assert.ok(v, label); checks.push(label); };
try {
  const master = await env.verifiedClient('tiles.master@example.test', 'Aurora');
  const campaign = await master('/api/campaigns', 'POST', { name: 'Cenários do Reino', description: '', rpgSystemId: '00000000-0000-4000-8000-000000000001', playMode: 'tactical' });
  const session = await master(`/api/campaigns/${campaign.id}/sessions`, 'POST', { title: 'Expedição', mapKind: 'tileset', mapKey: 'forest', objective: '' });
  const { items: maps } = await master(`/api/campaigns/${campaign.id}/maps`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addCookies(master.cookieHeader().split('; ').filter(Boolean).map(s => { const i=s.indexOf('='); return {name:s.slice(0,i),value:s.slice(i+1),url:env.origin}; }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/violates.*directive|Refused to (apply|execute|load)/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${env.origin}/#table/${campaign.id}`);
  await page.waitForFunction(() => !document.querySelector('#app').inert && document.querySelector('.board-canvas')?.width > 0);
  await page.waitForFunction(() => document.querySelector('#t-chip')?.textContent?.includes('Clareira do Riacho'));
  await page.screenshot({ path: `${dir}/forest-desktop.png` });
  const canvas = page.locator('.board-canvas');
  await canvas.focus(); await page.keyboard.press('ArrowRight');
  check(await canvas.evaluate(e=>e===document.activeElement), 'Tabuleiro mantém foco e navegação por teclado');
  for (const key of ['crypt','tavern','bridge','courtyard','harbor','sanctuary']) {
    await master(`/api/sessions/${session.id}/map`, 'POST', { mapKind:'tileset', mapKey:key }, 204);
    await page.waitForFunction(name => document.querySelector('#t-chip')?.textContent?.includes(name), maps.find(m=>m.key===key).name);
    await page.screenshot({ path:`${dir}/${key}-desktop.png` });
    check(await canvas.isVisible(), `${key}: cenário renderizado na mesa`);
  }
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>Math.abs(document.querySelector('.table-shell').getBoundingClientRect().height-innerHeight)<1);
  await page.locator('[data-camera="in"]').click();
  await page.screenshot({path:`${dir}/sanctuary-mobile-zoom.png`});
  check(await canvas.isVisible(), 'Celular horizontal: mapa visível com zoom');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Celular sem overflow horizontal da página');
  const proof = await page.evaluate(async () => {
    const {drawTile}=await import('/js/tile-art.js');
    const c=document.createElement('canvas');c.width=300;c.height=300;
    const g=c.getContext('2d',{willReadFrequently:true}), report=[];
    for(const tile of '#ToAbt~h.,+=rd:S?') {
      g.clearRect(0,0,300,300);
      const rows=['???',`?${tile}?`,'???'];
      drawTile(g,rows,1,1,100,true,false);
      const pixels=g.getImageData(0,0,300,300).data;
      let outside=0;for(let y=0;y<300;y++)for(let x=0;x<300;x++)if(x<100||x>=200||y<100||y>=200)outside+=pixels[(y*300+x)*4+3];
      const first=c.toDataURL();g.clearRect(0,0,300,300);drawTile(g,rows,1,1,100,true,false);
      report.push({tile,contained:outside===0,stable:first===c.toDataURL(),transform:g.getTransform().isIdentity});
    }
    g.clearRect(0,0,300,300);drawTile(g,['???','???','???'],1,1,100,true,false);
    const p=g.getImageData(100,100,100,100).data;
    const hidden=p.every((n,i)=>n===[5,4,3,255][i%4]);
    return {report,hidden};
  });
  for(const r of proof.report)check(r.contained&&r.stable&&r.transform, `${r.tile}: arte determinística, recortada à casa e contexto restaurado`);
  check(proof.hidden,'Casa desconhecida permanece totalmente opaca e sem textura');
  // Prancha de inspeção usa as mesmas grades recebidas do servidor, sem cópia no teste.
  await page.route('**/tile-art-review', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Tiles oficiais</title><body></body></html>'}));
  await page.goto(`${env.origin}/tile-art-review`);
  await page.setViewportSize({width:1440,height:1100});
  await page.evaluate(async maps=>{
    const {drawTile}=await import('/js/tile-art.js');
    const {mapThumbnail}=await import('/js/table-map.js');
    document.body.style.cssText='margin:0;padding:32px;background:#101b1b;color:#e4d2a7;font:16px Georgia';
    const title=document.createElement('h1');title.textContent='ETERNNUS  /  Atlas de cenários';document.body.append(title);
    const grid=document.createElement('main');grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:28px';document.body.append(grid);
    for(const map of maps.filter(m=>m.kind==='tileset')) {
      const card=document.createElement('section'),h=document.createElement('h2'),c=document.createElement('canvas');
      h.textContent=map.name;card.append(h,c);grid.append(card);
      const s=24;c.width=map.rows[0].length*s;c.height=map.rows.length*s;c.style.width='100%';
      const g=c.getContext('2d'),outdoor=map.rows.some(r=>r.includes(',')),timber=!outdoor&&map.rows.some(r=>r.includes('d'))&&!map.rows.some(r=>r.includes('~'));
      for(let y=0;y<map.rows.length;y++)for(let x=0;x<map.rows[y].length;x++)drawTile(g,map.rows,x,y,s,outdoor,timber);
      const thumb=document.createElement('div');thumb.style.cssText='width:240px;margin-top:10px';card.append(thumb);mapThumbnail(thumb,map);thumb.firstChild.style.width='100%';
    }
  },maps);
  await page.screenshot({path:`${dir}/atlas.png`,fullPage:true});
  check(errors.length===0,`Sem erros JavaScript/CSP: ${errors.join('; ')}`);
  await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors},null,2));
  console.log(`${checks.length} verificações; capturas em ${dir}`);
} finally { await browser.close();await env.stop(); }
