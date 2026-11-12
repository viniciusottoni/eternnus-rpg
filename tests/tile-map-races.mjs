// PostgreSQL real: redesenho serializado com preparação de cenas/camadas e abertura da mesa.
import assert from 'node:assert/strict';
import {startEnvironment} from './support/harness.mjs';
const env=await startEnvironment({port:5282,startupTimeoutMs:120000});
let checks=0;
try {
  const master=await env.verifiedClient('tiles.races@example.test','Mestre');
  const campaign=await master('/api/campaigns','POST',{name:'Concorrência de terrenos',description:'',rpgSystemId:'00000000-0000-4000-8000-000000000001'});
  const path=`/api/campaigns/${campaign.id}`,base=path+'/assets';
  const rows=['SSS.....','SSS.....',...Array(6).fill('........')];
  for(let i=0;i<3;i++) {
    const map=await master(base+'/tile-maps','POST',{name:'Mapa '+i,rows,scaleMeters:1.5});
    const sceneInput={name:'Cena '+i,kind:'map',mapKey:map.key,sharedText:'Texto preservado',prepared:[{label:'Sentinela',side:'neutral',x:4,y:4}]};
    const scene=await master(path+'/scenes','POST',sceneInput);
    const layer=await master(`${base}/layers?key=${map.key}`);
    const next=[...rows];next[4]='....R...';
    const actions=[
      ()=>master(`${base}/tile-maps/${map.id}`,'PUT',{name:map.name,rows:next,scaleMeters:1.5,revision:map.revision,resetPreparation:true},null,{raw:true}),
      ()=>master(`${path}/scenes/${scene.id}`,'PUT',{...sceneInput,revision:scene.revision},null,{raw:true}),
      ()=>master(`${base}/layers?key=${map.key}`,'PUT',{cells:layer.cells,lights:[],marks:[],revealed:'',revision:layer.revision,prepVersion:layer.prepVersion},null,{raw:true}),
    ];
    const order=i%2?[1,2,0]:[0,1,2];
    const results=await Promise.all(order.map(n=>actions[n]()));
    for(let n=0;n<results.length;n++)assert.ok(order[n]===0?results[n].status===200:[200,409].includes(results[n].status),JSON.stringify(results[n]));
    const saved=await master(`${path}/scenes/${scene.id}`),fog=await master(`${base}/layers?key=${map.key}`);
    assert.equal(saved.prepared.length,0);assert.equal(saved.sharedText,'Texto preservado');
    assert.notEqual(fog.cells[4][4],layer.cells[4][4],'Preparação antiga não substitui bloqueio do terreno novo');checks++;
  }
  const map=await master(base+'/tile-maps','POST',{name:'Abertura concorrente',rows,scaleMeters:1.5});
  const next=[...rows];next[4]='....R...';
  const [edited,opened]=await Promise.all([
    master(`${base}/tile-maps/${map.id}`,'PUT',{name:map.name,rows:next,scaleMeters:1.5,revision:map.revision},null,{raw:true}),
    master(path+'/sessions','POST',{title:'Mesa concorrente',objective:'',mapKind:'tileset',mapKey:map.key},null,{raw:true}),
  ]);
  assert.ok([200,409].includes(edited.status));assert.equal(opened.status,200);
  const current=await master(`${base}/tile-maps/${map.id}`),live=await master(`/api/sessions/${opened.data.id}/live`);
  assert.deepEqual(live.map.rows,current.rows,'Mesa e terreno salvo usam a mesma revisão');checks++;
  console.log(`${checks} corridas de múltiplos recursos verificadas; ${env.count()} verificações HTTP.`);
} finally {await env.stop();}
