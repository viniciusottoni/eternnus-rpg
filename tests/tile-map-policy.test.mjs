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
