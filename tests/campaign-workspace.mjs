import { startEnvironment } from './support/harness.mjs';
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const env=await startEnvironment({port:5262});let browser;
const {check,ok}=env;
try {
 const master=await env.verifiedClient('workspace.master@example.test','Aurora'), player=await env.verifiedClient('workspace.player@example.test','Lira'), outsider=await env.verifiedClient('workspace.outsider@example.test','Outro');
 const c=await master('/api/campaigns','POST',{name:'Crônicas de Valdaran',description:'Uma história que continua',rpgSystemId:'00000000-0000-4000-8000-000000000001',origin:'ongoing',continuity:'O grupo chegou à capital.',firstSessionNumber:28,currentArc:'O retorno'});
 const path=`/api/campaigns/${c.id}`,base=path+'/workspace';const detail=await master(path);check(detail.origin,'ongoing');check(detail.firstSessionNumber,28);await player('/api/campaigns/join','POST',{code:detail.inviteCode});
 const p=await player(base+'/pages','POST',{title:'Minha teoria',content:'Só Lira sabe',kind:'note'});
 check((await master(base+'/pages')).total,0);await master(`${base}/pages/${p.id}`,'GET',undefined,404);await outsider(base+'/pages','GET',undefined,404);
 await player(`${base}/pages/${p.id}`,'PUT',{title:'Minha teoria',content:'Compartilhada',secrets:'NUNCA VAZAR',kind:'note',visibility:'master',revision:1});
 check((await master(`${base}/pages/${p.id}`)).secrets,'');await master(`${base}/pages/${p.id}/versions`,'GET',undefined,404);
 await master(base+'/past-sessions','POST',{number:27,title:'A chegada',summary:'O grupo atravessou o portão.',published:true});
 check((await player(base+'/past-sessions')).items[0].number,27);
 const results=await Promise.all([master(base+'/past-sessions','POST',{number:28,title:'Passado',summary:'x'},null,{raw:true}),master(path+'/sessions','POST',{title:'Retorno',objective:'',mapKind:'tileset',mapKey:'crypt'})]);
 ok([200,409].includes(results[0].status));
 const session=results[1];ok([28,29].includes(session.number),'Numeração concorrente válida');const past=await master(base+'/past-sessions');ok(!past.items.some(p=>p.number===session.number),'Sem número duplicado entre passado e mesa');
 const book=await master(base+'/pages','POST',{title:'Crônicas do reino',content:'Conhecido pelo grupo.',kind:'book',visibility:'table',secrets:'SEGREDO DO MESTRE'});
 const chapter=await master(base+'/pages','POST',{title:'Primeiro capítulo',content:'A fundação.',kind:'chapter',parentId:book.id,visibility:'table'});
 check((await player(`${base}/pages/${book.id}`)).secrets,'');check((await player(`${base}/pages/${book.id}`)).children[0].id,chapter.id);
 // Corridas de revisão: somente uma escrita pode vencer.
 const writes=await Promise.all([master(`${base}/pages/${book.id}`,'PUT',{title:'Crônicas do reino',content:'A',kind:'book',visibility:'table',revision:1},null,{raw:true}),master(`${base}/pages/${book.id}`,'PUT',{title:'Crônicas do reino',content:'B',kind:'book',visibility:'table',revision:1},null,{raw:true})]);
 check(writes.map(w=>w.status).sort(),[200,409]);
 check((await master(`${base}/pages/${book.id}/versions`)).length,1);
 const document = new FormData(); document.append('file',new Blob([await readFile('tests/fixtures/library/manual.pdf')],{type:'application/pdf'}),'manual.pdf');
 const attached=await master(`${base}/pages/${book.id}/attachments`,'POST',document); const attachmentUrl=`${base}/pages/${book.id}/attachments/${attached.id}`;
 const bytes=await player(attachmentUrl,'GET',undefined,200,{raw:true});ok(bytes.headers.get('cache-control').includes('no-store'));
 await outsider(attachmentUrl,'GET',undefined,404);
 const hidden=await master(base+'/pages','POST',{title:'Segredo escondido',content:'x',kind:'place'});
 const link=await master(base+'/pages','POST',{title:'Página com relação',content:'x',kind:'place',visibility:'table',related:[hidden.id]});check((await player(`${base}/pages/${link.id}`)).related.length,0);
 const mapForm=new FormData();mapForm.append('file',new Blob([await readFile('tests/fixtures/avatar.png')],{type:'image/png'}),'mapa.png');for(const[k,v]of Object.entries({name:'Reino conhecido',gridPixels:'32',scaleMeters:'2'}))mapForm.append(k,v);
 const map=await master(path+'/assets/maps','POST',mapForm);await master(`${base}/atlas/${map.id}`,'POST',undefined,204);const atlas=await player(base+'/atlas');check(atlas.items[0].name,'Reino conhecido');await player(`${base}/atlas/${atlas.items[0].id}/image`);await master(`${base}/atlas/${map.id}`,'DELETE',undefined,204);await player(`${base}/atlas/${atlas.items[0].id}/image`,'GET',undefined,404);
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const errors=[];await mkdir('artifacts/qa/campaign-workspace',{recursive:true});
 async function ui(client,mobile=false){const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map(s=>{const i=s.indexOf('=');return{name:s.slice(0,i),value:s.slice(i+1),url:env.origin};}));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;}
 async function go(page,route,text){await page.goto(env.origin+'/#'+route);await page.getByText(text,{exact:true}).first().waitFor();await page.waitForFunction(()=>!document.querySelector('#app').inert);}
 const page=await ui(master);await go(page,`campaign/${c.id}/world`,'Crônicas do reino');await page.screenshot({path:'artifacts/qa/campaign-workspace/world-desktop.png',fullPage:true,animations:"disabled"});
 await page.getByRole('button',{name:'+ Página',exact:true}).click();await page.locator('#ws-title').fill('Porto do Luar');await page.locator('#ws-type').selectOption('place');await page.locator('#ws-content').fill('Um porto seguro.');await page.locator('#ws-vis').selectOption('table');await page.getByRole('button',{name:'Salvar página',exact:true}).click();await page.getByRole('heading',{name:'Porto do Luar',exact:true}).waitFor();
 await go(page,`campaign/${c.id}/notes`,'Minhas notas');await page.getByRole('button',{name:'+ Nota',exact:true}).click();await page.locator('#ws-title').fill('Rascunho automático');await page.locator('#ws-content').fill('Guardado sem sair do editor.');try{await page.getByText('Salvo no servidor.',{exact:true}).waitFor();}catch(error){console.log('Estado do editor:',await page.locator('#ws-save-state').textContent(),errors);throw error;}check((await master(base+'/pages?kind=note&mine=true')).total,1);await page.locator('#modal').evaluate(d=>d.close());
 await go(page,`campaign/${c.id}/settings`,'Identidade da campanha');await page.getByRole('button',{name:'Editar campanha',exact:true}).click();await page.locator('#campaign-origin').waitFor();check(await page.locator('#campaign-origin').inputValue(),'ongoing');await page.screenshot({path:'artifacts/qa/campaign-workspace/settings.png',fullPage:true,animations:"disabled"});await page.locator('#modal').evaluate(d=>d.close());
 const mobile=await ui(player,true);await go(mobile,`campaign/${c.id}/notes`,'Minha teoria');await mobile.screenshot({path:'artifacts/qa/campaign-workspace/notes-mobile.png',fullPage:true,animations:"disabled"});ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sem overflow móvel');
 await go(mobile,`campaign/${c.id}/past`,'Sessão 27 — A chegada');await mobile.screenshot({path:'artifacts/qa/campaign-workspace/past-mobile.png',fullPage:true,animations:"disabled"});
 await player(path+'/leave','POST',undefined,204);await player(`/api/notebook/${p.id}`);check((await player('/api/notebook')).total,1);await go(mobile,'campaigns','Meu caderno');await mobile.getByRole('link',{name:'Meu caderno',exact:true}).click();await mobile.getByRole('heading',{name:'Meu caderno',exact:true}).waitFor();await mobile.getByRole('heading',{name:'Minha teoria',exact:true}).waitFor();
 check(errors,[]);await writeFile('artifacts/qa/campaign-workspace/result.json',JSON.stringify({errors,session:session.number,passed:true},null,2));
 console.log('Campanhas: permissões, continuidade, corridas PostgreSQL e interface desktop/móvel aprovadas.');
} finally {await browser?.close();await env.stop();}

