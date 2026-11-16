import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../apps/Eternnus.Web/wwwroot/js/tile-map-policy.js', import.meta.url), 'utf8');
const { blankTiles, resizeTiles, paintTiles, tileMapError } = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('pincel não altera a origem e ignora pontos fora da grade',()=>{
  const rows=blankTiles(8,8);const next=paintTiles(rows,[{x:4,y:4},{x:99,y:99}],'R');
  assert.equal(rows[4][4],',');assert.equal(next[4][4],'R');assert.equal(next.length,8);
});
test('preenchimento ligado respeita obstáculos e retângulo cobre os limites inclusivos',()=>{
  const rows=['...#...','...#...','...#...'];
  assert.deepEqual(paintTiles(rows,[{x:0,y:0}],':','fill'),[':::#...',':::#...',':::#...']);
  assert.deepEqual(paintTiles(rows,[{x:5,y:2},{x:4,y:0}],'R','rectangle'),['...#RR.','...#RR.','...#RR.']);
});
test('redimensionar preserva origem e validação exige entradas e legenda conhecida',()=>{
  const rows=blankTiles(8,8);const catalog=[{code:','},{code:'S'}];
  assert.equal(tileMapError(rows,catalog),'');
  assert.equal(tileMapError(resizeTiles(rows,8,9,','),catalog),'');
  assert.match(tileMapError(resizeTiles(rows,8,4,','),catalog),/8 a 64/);
  assert.match(tileMapError(rows.map(r=>r.replaceAll('S',',')),catalog),/seis entradas/);
  assert.match(tileMapError(paintTiles(rows,[{x:4,y:4}],'<'),catalog),/fora do catálogo/);
});
const P = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const catalog=[{code:',',group:'Terrenos',walkable:true},{code:'.',group:'Terrenos',walkable:true},{code:'~',group:'Terrenos',walkable:false},{code:'t',group:'Natureza',walkable:false,blocksSight:true},{code:'h',group:'Objetos',walkable:false},{code:'S',group:'Jogo',walkable:true}];
const layer=(id,rows,extra={})=>({id,name:id,kind:id==='base'||id==='elements'?id:'custom',visible:true,locked:false,opacity:100,rows,...extra});
test('fusão: camada visível mais alta prevalece; Base sempre entra nas regras; ocultas fora',()=>{
  const base=layer('base',[',,,',',,,']);
  const el=layer('elements',['t__','___']);
  const extra=layer('camada-1',['h_h','___']);
  assert.deepEqual(P.mergeLayers([base,el,extra]),['h,h',',,,']);
  assert.deepEqual(P.mergeLayers([base,el,{...extra,visible:false}]),['t,,',',,,']);
  assert.deepEqual(P.mergeLayers([{...base,visible:false},el]),['t,,',',,,'],'olho da Base não muda as regras');
  assert.deepEqual(P.mergeLayers([base,el],{hideBase:true}),['t??','???'],'exibição do editor com Base oculta');
});
test('roteamento automático: terrenos na Base, demais em Elementos; extra ativa ou automático desligado usam a ativa',()=>{
  const layers=[layer('base',[]),layer('elements',[]),layer('camada-1',[])];
  const grass=catalog[0], tree=catalog[3], spawn=catalog[5];
  assert.equal(P.layerForTile(grass,{auto:true,active:'elements',layers}),'base');
  assert.equal(P.layerForTile(tree,{auto:true,active:'base',layers}),'elements');
  assert.equal(P.layerForTile(spawn,{auto:true,active:'base',layers}),'elements');
  assert.equal(P.layerForTile(grass,{auto:true,active:'camada-1',layers}),'camada-1');
  assert.equal(P.layerForTile(tree,{auto:false,active:'base',layers}),'base');
});
test('pintura por camada: borracha grava "_" fora da Base e o piso na Base; preenchimento usa a região da própria camada',()=>{
  const el=['t__','t__','___'];
  assert.deepEqual(P.paintLayer(el,[{x:0,y:0}],'',"erase"),['___','t__','___']);
  assert.deepEqual(P.paintLayer(['~~,',',,,'],[{x:0,y:0}],'','erase',{base:true,ground:'.'}),['.~,',',,,']);
  assert.deepEqual(P.paintLayer(el,[{x:2,y:2}],'h','fill'),['thh','thh','hhh'],'preenche vazios ligados da camada');
  assert.deepEqual(P.paintLayer(el,[{x:0,y:0}],'','erase-fill'),['___','___','___']);
  assert.deepEqual(P.paintLayer(el,[{x:1,y:0},{x:2,y:1}],'h','rectangle'),['thh','thh','___']);
  assert.deepEqual(P.paintLayer([',,'],[{x:0,y:0}],'_','brush',{base:true}),[',,'],'Base nunca fica vazia');
});
test('borracha automática apaga a camada visível mais alta e respeita bloqueio',()=>{
  const layers=[layer('base',[',,']),layer('elements',['t_']),layer('camada-1',['h_'])];
  let r=P.eraseTopmost(layers,[{x:0,y:0},{x:1,y:0}],'.');
  assert.deepEqual(r.layers.map(l=>l.rows[0]),[',.','t_','__']);
  r=P.eraseTopmost([layers[0],layers[1],{...layers[2],locked:true}],[{x:0,y:0}],'.');
  assert.equal(r.skipped,1);
});
test('redimensionar com âncora aplica a todas as camadas e informa perdas',()=>{
  const base=P.blankTiles(8,8);const el=P.emptyRows(8,8).map((r,y)=>y===0?'t'+r.slice(1):r);
  const layers=[layer('base',base),layer('elements',el)];
  const grown=P.resizeLayers(layers,10,10,'br','.');
  assert.equal(grown[0].rows.length,10);assert.equal(grown[0].rows[0],'..........');
  assert.equal(grown[1].rows[2][2],'t','conteúdo deslocado para a âncora inferior direita');
  assert.equal(grown[1].rows[0],'__________');
  const centered=P.resizeLayers(layers,10,8,'c','.');
  assert.equal(centered[0].rows[0],'.,,,,,,,,.');
  const loss=P.resizeLoss(layers,8,8,'tl');assert.equal(loss.shrinks,false);
  const cut=P.resizeLoss(layers,8,7,'b');assert.equal(cut.shrinks,true);assert.equal(cut.cells,1);
  assert.equal(P.resizeLoss(layers,8,5,'tl').spawns,6,'entradas cortadas na base');
});
test('validação usa a grade fundida, inclusive entradas em Elementos',()=>{
  const base=P.blankTiles(8,8).map(r=>r.replaceAll('S',','));
  const el=P.emptyRows(8,8);el[7]='SSSSSS__';
  const layers=[layer('base',base),layer('elements',el)];
  assert.equal(P.tileMapError(P.mergeLayers(layers),catalog),'');
  assert.match(P.tileMapError(P.mergeLayers([layers[0],{...layers[1],visible:false}]),catalog),/seis entradas/);
  assert.equal(P.countSpawns(P.mergeLayers(layers)),6);
});
test('seleção: copiar, colar sem sobrescrever com vazio e pilha da casa',()=>{
  const rows=['ab_','cd_'];
  const clip=P.copyRegion(rows,P.rectBetween({x:1,y:1},{x:0,y:0}));
  assert.deepEqual(clip,['ab','cd']);
  assert.deepEqual(P.pasteRegion(['xxx','xxx'],['a_'],{x:2,y:1}),['xxx','xxa']);
  assert.equal(P.rectCells({x:-1,y:0,w:3,h:1},2,2).length,2);
  const stack=P.cellStack([layer('base',[',']),layer('elements',['t'])],0,0);
  assert.equal(stack[0].code,'t');assert.equal(stack[1].base,true);
  assert.equal(P.topLayerAt([layer('base',[',']),layer('elements',['_'])],0,0).id,'base');
  assert.equal(P.dominantGround(['..,',',,,'],catalog),',');
  assert.ok(P.validScale(1.5)&&!P.validScale(1.555)&&!P.validScale(0));
});
test('camadas recebidas fora do tamanho são ajustadas à Base',()=>{
  const fixed=P.fitLayerRows([layer('base',P.blankTiles(8,8)),layer('elements',['__'])],P.blankTiles());
  assert.equal(fixed[1].rows.length,8);assert.equal(fixed[1].rows[0],'________');
  const fallback=P.fitLayerRows([layer('base',null),layer('elements',null)],P.blankTiles(9,9));
  assert.equal(fallback[0].rows.length,9);
});
