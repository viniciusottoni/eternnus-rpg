import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../apps/Eternnus.Web/wwwroot/js/tile-map-policy.js', import.meta.url), 'utf8');
const P = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const key = (cells) => cells.map((c) => `${c.x},${c.y}`).sort();

test('pincel quadrado de 1, 2, 3 e 5 casas', () => {
  const at = { x: 5, y: 5 };
  assert.deepEqual(key(P.brushFootprint(at, 1)), ['5,5']);
  assert.deepEqual(key(P.brushFootprint(at, 2)), ['5,5', '5,6', '6,5', '6,6']);
  assert.equal(P.brushFootprint(at, 3).length, 9);
  assert.equal(P.brushFootprint(at, 5).length, 25);
  assert.equal(P.brushFootprint(at, 4).length, 1, 'tamanho fora da lista volta a 1');
});

test('pincel redondo: 3 é uma cruz, 5 é um disco sem cantos', () => {
  const at = { x: 5, y: 5 };
  assert.deepEqual(key(P.brushFootprint(at, 3, 'round')), ['4,5', '5,4', '5,5', '5,6', '6,5']);
  const disk = P.brushFootprint(at, 5, 'round');
  assert.equal(disk.length, 21);
  assert.ok(!key(disk).includes('3,3') && key(disk).includes('3,4'));
});

test('pincel não sai da grade e o traço não repete casas', () => {
  assert.deepEqual(key(P.brushFootprint({ x: 0, y: 0 }, 3, 'square', 8, 8)), ['0,0', '0,1', '1,0', '1,1']);
  const stroke = P.strokeCells([{ x: 1, y: 1 }, { x: 2, y: 1 }], 3, 'square', 8, 8);
  assert.equal(stroke.length, 12);
  assert.equal(new Set(key(stroke)).size, stroke.length);
});

test('preenchimento contíguo usa 4 vizinhos e respeita o limite da seleção', () => {
  const rows = ['..#.', '..#.', '##..', '....'];
  assert.equal(P.floodCells(rows, { x: 0, y: 0 }).length, 4, 'diagonal não liga regiões');
  assert.equal(P.floodCells(rows, { x: 3, y: 0 }).length, 8);
  assert.deepEqual(key(P.floodCells(rows, { x: 3, y: 3 }, { x: 2, y: 2, w: 2, h: 2 })), ['2,2', '2,3', '3,2', '3,3']);
  assert.deepEqual(P.floodCells(rows, { x: 0, y: 0 }, { x: 2, y: 2, w: 2, h: 2 }), [], 'clique fora da seleção não preenche');
  assert.deepEqual(P.floodCells(rows, { x: 9, y: 0 }), []);
});

test('substituir terreno na camada inteira ou só na seleção', () => {
  const rows = [',,~~', ',,~~', ',,,,'];
  const all = P.replaceTiles(rows, ',', ':');
  assert.equal(all.count, 8);
  assert.deepEqual(all.rows, ['::~~', '::~~', '::::']);
  const part = P.replaceTiles(rows, ',', ':', { x: 0, y: 2, w: 4, h: 1 });
  assert.equal(part.count, 4);
  assert.deepEqual(part.rows, [',,~~', ',,~~', '::::']);
  assert.equal(P.replaceTiles(rows, ',', ',').rows, rows, 'mesmo tile não muda nada');
  assert.equal(P.replaceTiles(rows, ',', P.EMPTY, null, { base: true }).count, 0, 'a Base nunca fica vazia');
  assert.deepEqual(rows, [',,~~', ',,~~', ',,,,'], 'a origem não muda');
});

test('gravar casas devolve a mesma referência quando nada muda', () => {
  const rows = ['....', '....'];
  assert.equal(P.setCells(rows, [{ x: 0, y: 0 }], '.'), rows);
  assert.equal(P.setCells(rows, [{ x: 9, y: 9 }], '#'), rows);
  assert.deepEqual(P.setCells(rows, [{ x: 1, y: 1 }, { x: 2, y: 1 }], (x, y) => (x + y) % 2 ? '#' : '.'), ['....', '..#.']);
});

test('variação é determinística, distribui entre os tiles e muda com a semente', () => {
  const codes = [',', 'f', 's'];
  const a = [], b = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) { a.push(P.variantCode(x, y, codes, 1)); b.push(P.variantCode(x, y, codes, 2)); }
  assert.deepEqual(a, Array.from({ length: 400 }, (_, i) => P.variantCode(i % 20, Math.floor(i / 20), codes, 1)));
  for (const c of codes) assert.ok(a.filter((v) => v === c).length > 80, `distribuição de ${c}`);
  assert.notDeepEqual(a, b);
  assert.equal(P.variantCode(0, 0, [], 1), '');
});

test('mistura só com tiles da mesma camada automática e sem entradas', () => {
  const grass = { code: ',', group: 'Terrenos' }, sand = { code: ':', group: 'Terrenos' }, tree = { code: 't', group: 'Natureza' }, rock = { code: 'R', group: 'Natureza' };
  assert.equal(P.canMix([grass, sand]), true);
  assert.equal(P.canMix([tree, rock]), true);
  assert.equal(P.canMix([grass, tree]), false);
  assert.equal(P.canMix([tree, { code: 'S', group: 'Jogo' }]), false);
});

test('contagem de códigos de uma camada, do mais frequente ao menos', () => {
  assert.deepEqual(P.codeCounts(['__t', '_tR']), [['_', 3], ['t', 2], ['R', 1]]);
});
