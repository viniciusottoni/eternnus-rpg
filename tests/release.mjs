/** Verify the actual publish directory, using a disposable database and private key/mail folders. */
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readdir,rm,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const publish=resolve(root,process.env.ETERNNUS_PUBLISH_DIR || 'artifacts/postgres-pwa-publish');
await access(join(publish,'Eternnus.Web.dll'));
const temp=await mkdtemp(join(tmpdir(),'eternnus-release-'));
const origin='http://127.0.0.1:5192';
const server=spawn('dotnet',[join(publish,'Eternnus.Web.dll'),'--urls',origin],{cwd:publish,windowsHide:true,env:{...process.env,DOTNET_ENVIRONMENT:'Development',ASPNETCORE_ENVIRONMENT:'Development',AllowedHosts:'localhost;127.0.0.1',PublicUrl:origin,Database__Provider:'SqliteTest',Database__SqlitePath:join(temp,'release.db'),Database__Migrate:'true',Mail__Mode:'Pickup',Mail__PickupDirectory:join(temp,'mail'),DataProtection__Directory:join(temp,'keys')},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
try {
 let ready=false;for(let n=0;n<100;n++){try{ready=(await fetch(origin+'/health')).ok;}catch{}if(ready||server.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'Published app did not start: '+logs);
 const files=await readdir(publish,{recursive:true});
 assert.ok(!files.some(x=>/(^|[\\/])App_Data([\\/]|$)/i.test(x)),'Never publish private runtime data.');
 assert.ok(!files.some(x=>/\.eml$/i.test(x)),'Never publish account emails.');
 assert.ok(!files.includes('appsettings.Development.json'),'Never publish development configuration.');
 const result=spawnSync(process.execPath,[join(root,'tests/pwa-http.mjs')],{env:{...process.env,ETERNNUS_PREVIEW_URL:origin},encoding:'utf8',windowsHide:true});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,'Published PWA checks failed.');
 console.log('PASS: release health and publish isolation. This verifies the release assembly/static package, not production SMTP/OAuth/IIS.');
} finally {
 server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));
 await rm(temp,{recursive:true,force:true});
}
