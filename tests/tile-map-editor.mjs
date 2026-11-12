// Integração PostgreSQL e Chromium: criação, edição, privacidade e concorrência dos mapas de tiles.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
const dir='artifacts/qa/tile-editor';await mkdir(dir,{recursive:true});
const env=await startEnvironment({port:5281,startupTimeoutMs:120000});
const checks=[],errors=[];
const check=(v,name)=>{assert.ok(v,name);checks.push(name);};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const master=await env.verifiedClient('tile.editor@example.test','Aurora');
  const player=await env.verifiedClient('tile.player@example.test','Lira');
  const stranger=await env.verifiedClient('tile.stranger@example.test','Estranho');
  const campaign=await master('/api/campaigns','POST',{name:'Atlas dos Vinte Reinos',description:'',rpgSystemId:'00000000-0000-4000-8000-000000000001'});
  const path=`/api/campaigns/${campaign.id}`,base=path+'/assets';
  await player('/api/campaigns/join','POST',{code:(await master(path)).inviteCode});
  const catalog=await master(base+'/tile-catalog');
  check(catalog.items.length===44,'44 tiles com regras de passagem');
  const maps=(await master(path+'/maps')).items;
  check(maps.length===20,'20 cenários oficiais');
  check(maps.filter(m=>m.kind==='tileset').length===19,'19 mapas táticos e uma cartografia');
  await player(base+'/tile-catalog','GET',undefined,403);
  await stranger(base+'/tile-catalog','GET',undefined,404);
  const blank=['SSS.....','SSS.....',...Array(6).fill('........')];
  const payload={name:'Mapa da expedição',rows:blank,scaleMeters:1.5,folderId:null};
  await master(base+'/tile-maps','POST',payload,400,{csrf:false});
  await player(base+'/tile-maps','POST',payload,403);
  await master(base+'/tile-maps','POST',{...payload,rows:['???']},400);
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.addCookies(master.cookieHeader().split('; ').filter(Boolean).map(s=>{const i=s.indexOf('=');return {name:s.slice(0,i),value:s.slice(i+1),url:env.origin};}));
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/violates.*directive|Refused to (apply|execute|load)/i.test(m.text()))errors.push(m.text());});
  await page.goto(`${env.origin}/#campaign/${campaign.id}/maps`);
  await page.getByRole('button',{name:'+ Criar com tiles',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#app').inert);
  check(await page.locator('[data-official-map]').count()===20,'Atlas exibe os 20 cenários');
  await page.getByRole('button',{name:'+ Criar com tiles',exact:true}).click();
  await page.locator('#tm-form').waitFor();
  await page.locator('#tm-form [name=name]').fill('Mapa da expedição');
  await page.locator('[data-tile]').filter({has:page.getByText('Cristais',{exact:true})}).click();
  const canvas=page.locator('.tm-board canvas');
  await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  check(await page.locator('[data-tm=undo]').isEnabled(),'Pintura por teclado gera histórico');
  await page.locator('[data-tm=undo]').click();
  check(await page.locator('[data-tm=redo]').isEnabled(),'Desfazer permite refazer');await page.locator('[data-tm=redo]').click();
  await page.locator('#modal-body').evaluate(e=>e.scrollTop=0);
  check(await page.locator('#modal').evaluate(e=>e.getBoundingClientRect().width>1000),'Editor usa área ampla no desktop');
  await page.screenshot({path:`${dir}/editor-desktop.png`});
  await page.locator('#tm-form button[type=submit]').click();
  await page.locator('#tm-form').waitFor({state:'hidden'});
  let custom=(await master(base+'/maps')).items.find(m=>m.name==='Mapa da expedição');
  check(custom?.isTileMap&&custom.imageUrl===null&&custom.rows.some(r=>r.includes('X')),'Mapa pintado salvo sem imagem');
  await player(`${base}/tile-maps/${custom.id}`,'GET',undefined,403);
  await stranger(`${base}/tile-maps/${custom.id}`,'GET',undefined,404);
  await master(`${base}/maps/${custom.id}/image`,'GET',undefined,404);
  await page.locator(`[data-action=ca-map-edit][data-id="${custom.id}"]`).click();
  check(await page.locator('#tm-status').textContent().then(t=>t.includes('28 × 20')),'Edição reabre dimensões e dados salvos');
  await page.locator('#tm-form [name=group]').selectOption('Natureza');
  check(await page.locator('[data-tile]:visible').count()===11,'Filtro mostra tiles de natureza');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#modal-body').evaluate(e=>e.scrollTop=0);
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,{},{timeout:5000}).catch(async e=>{
    await page.screenshot({path:`${dir}/mobile-overflow.png`});
    console.log(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,over:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().width]).slice(0,25)})));
    throw e;
  });
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Editor móvel sem overflow da página');
  check(await page.locator('[data-tile]:visible').first().evaluate(e=>e.getBoundingClientRect().height>=44),'Tiles têm alvo de toque de 44 px');
  await page.screenshot({path:`${dir}/editor-mobile.png`});
  await page.locator('.tm-board').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${dir}/editor-mobile-board.png`});
  await page.locator('[data-tm=close]').click();
  await page.setViewportSize({width:1440,height:1050});
  await page.locator('[data-action=ca-tile-copy][data-id=mountain]').click();
  await page.locator('#tm-form [name=name]').fill('Minha montanha');
  await page.locator('#tm-form button[type=submit]').click();
  await page.locator('#tm-form').waitFor({state:'hidden'});
  const copied=(await master(base+'/maps')).items.find(m=>m.name==='Minha montanha');
  check(copied?.rows.join('\n')===maps.find(m=>m.key==='mountain').rows.join('\n'),'Cópia de cenário oficial vira mapa próprio independente');
  const row=await master(`${base}/tile-maps/${custom.id}`);
  const edit={name:row.name,rows:row.rows,scaleMeters:row.scaleMeters,folderId:null,revision:row.revision};
  const races=await Promise.all([
    master(`${base}/tile-maps/${custom.id}`,'PUT',{...edit,name:'Nome A'},null,{raw:true}),
    master(`${base}/tile-maps/${custom.id}`,'PUT',{...edit,name:'Nome B'},null,{raw:true}),
  ]);
  check(races.map(r=>r.status).sort().join(',')==='200,409','Revisão impede sobrescrita simultânea');
  const scene=await master(path+'/scenes','POST',{name:'Travessia',kind:'map',mapKey:custom.key,sharedText:'O caminho está aberto.',privateNotes:'Segredo',prepared:[{label:'Sentinela',side:'neutral',x:4,y:4}]});
  await master(path+'/scenes','POST',{name:'Inválida',kind:'image',mapKey:custom.key},400);
  const layer=await master(`${base}/layers?key=${custom.key}`);
  await master(`${base}/layers?key=${custom.key}`,'PUT',{cells:layer.cells,lights:[],marks:[],revealed:'',fog:true,revision:layer.revision});
  custom=await master(`${base}/tile-maps/${custom.id}`);
  const terrain={...edit,revision:custom.revision,rows:[...custom.rows]};terrain.rows[4]='RRRRRR'+terrain.rows[4].slice(6);
  await master(`${base}/tile-maps/${custom.id}`,'PUT',terrain,409);
  await master(`${base}/tile-maps/${custom.id}`,'PUT',{...terrain,resetPreparation:true});
  const reset=await master(`${path}/scenes/${scene.id}`);
  check(reset.prepared.length===0&&reset.sharedText==='O caminho está aberto.','Redesenho confirmado remove posições e conserva textos');
  const session=await master(path+'/sessions','POST',{title:'A travessia',objective:'',mapKind:'tileset',mapKey:custom.key});
  const s=`/api/sessions/${session.id}`;
  await master(`${base}/tile-maps/${custom.id}`,'PUT',{...terrain,revision:custom.revision+1,resetPreparation:true},409);
  const hero=await player('/api/characters','POST',{name:'Lira',archetype:'Batedora',level:1,hp:10,maxHp:10,strength:10,agility:10,intellect:10,notes:'',movement:9});
  await player(s+'/join','POST',{characterId:hero.id},204);
  const live=await player(s+'/live');
  check(live.map.isTileMap&&live.map.gridPixels===0&&live.map.imageUrl===null,'Mesa recebe mapa de tiles com contrato de canvas');
  check(!JSON.stringify(live).includes('tileData')&&live.map.rows.some(r=>r.includes('?')),'Jogador recebe somente linhas mascaradas, sem cópia integral');
  await master(s+'/tokens','POST',{label:'Bloqueado',side:'neutral',x:0,y:4},400);
  await page.goto(`${env.origin}/#table/${campaign.id}`);
  await page.waitForFunction(()=>document.querySelector('#t-chip')?.textContent?.includes('Mapa da expedição')&&!document.querySelector('#app').inert);
  await page.screenshot({path:`${dir}/custom-map-live.png`});
  check(await page.locator('#t-board .board-canvas').isVisible(),'Mapa criado utilizável na mesa');
  const art=await page.evaluate(async codes=>{
    const {drawTile}=await import('/js/tile-art.js'),c=document.createElement('canvas');c.width=c.height=150;
    const g=c.getContext('2d',{willReadFrequently:true});
    return codes.map(code=>{
      const rows=['???',`?${code}?`,'???'];g.clearRect(0,0,150,150);drawTile(g,rows,1,1,50,false,false);
      const first=c.toDataURL(),pixels=g.getImageData(0,0,150,150).data;
      let contained=true;for(let y=0;y<150;y++)for(let x=0;x<150;x++)if((x<50||x>=100||y<50||y>=100)&&pixels[(y*150+x)*4+3])contained=false;
      g.clearRect(0,0,150,150);drawTile(g,rows,1,1,50,false,false);
      return {code,ok:contained&&first===c.toDataURL()&&g.getTransform().isIdentity};
    });
  },catalog.items.map(t=>t.code).concat('?'));
  check(art.every(r=>r.ok),'44 tiles e névoa: arte determinística, recorte por casa e contexto restaurado');
  // Desenha todos os cenários e o catálogo, com os mesmos renderizadores usados pelo produto.
  await page.route('**/tile-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Atlas do Eternnus</title><body></body></html>'}));
  await page.goto(`${env.origin}/tile-review`);
  await page.evaluate(async ({maps,catalog})=>{
    const {mapThumbnail}=await import('/js/table-map.js');const {drawTile}=await import('/js/tile-art.js');
    document.body.style.cssText='margin:0;color:#e5d2a8;background:#131e1b;font:16px Georgia';
    const section=document.createElement('main');section.style.cssText='padding:32px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px';document.body.append(section);
    for(const map of maps){const card=document.createElement('section'),h=document.createElement('h2'),preview=document.createElement('div');h.textContent=map.name;h.style.fontSize='18px';card.append(h,preview);section.append(card);mapThumbnail(preview,map);preview.firstChild.style.width='100%';}
    for(const tile of catalog.items){const card=document.createElement('section'),h=document.createElement('p'),c=document.createElement('canvas');h.textContent=tile.name;c.width=100;c.height=100;drawTile(c.getContext('2d'),[tile.code],0,0,100,false,false);card.append(c,h);section.append(card);}
  },{maps,catalog});
  await page.screenshot({path:`${dir}/twenty-scenes.png`,fullPage:true});
  check(errors.length===0,`Sem erros de script/CSP: ${errors.join('; ')}`);
  await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors,apiAssertions:env.count()},null,2));
  console.log(`${checks.length} verificações de fluxo/visual; ${env.count()} verificações HTTP. Capturas: ${dir}`);
} finally {await browser.close();await env.stop();}
