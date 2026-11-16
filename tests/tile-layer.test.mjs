// Repintura parcial da camada estática do tabuleiro (ADR-081): quais casas refazer quando a grade muda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedCells, dominantGround, TILE_REACH } from "../apps/Eternnus.Web/wwwroot/js/tile-art.js";

const grid = (w, h, c = ",") => Array.from({ length: h }, () => c.repeat(w));
const put = (rows, x, y, c) => rows.map((r, i) => (i === y ? r.slice(0, x) + c + r.slice(x + 1) : r));
const at = (w, list) => new Set(list.map((i) => `${i % w},${Math.floor(i / w)}`));

test("grade igual não repinta nada", () => {
  const rows = grid(10, 10);
  assert.deepEqual(affectedCells(rows, rows), []);
  assert.deepEqual(affectedCells(rows, [...rows]), []);
});

test("uma casa alterada repinta ela e as vizinhas que dependem dela", () => {
  const before = grid(12, 12), after = put(before, 6, 6, "#");
  const cells = at(12, affectedCells(before, after));
  const side = 2 * TILE_REACH + 1;
  assert.equal(cells.size, side * side);
  for (let dy = -TILE_REACH; dy <= TILE_REACH; dy++)
    for (let dx = -TILE_REACH; dx <= TILE_REACH; dx++) assert.ok(cells.has(`${6 + dx},${6 + dy}`));
  assert.ok(!cells.has("9,6"));
});

test("vizinhança é cortada nas bordas do mapa", () => {
  const before = grid(8, 8), after = put(before, 0, 0, ".");
  assert.equal(affectedCells(before, after).length, (TILE_REACH + 1) ** 2);
});

test("entradas à direita na mesma linha herdam o piso e também são repintadas", () => {
  const before = put(grid(12, 12), 11, 6, "S"), after = put(before, 1, 6, ".");
  const cells = at(12, affectedCells(before, after));
  assert.ok(cells.has("11,6"));
  assert.ok(!cells.has("11,5"));
});

test("mudança só no terreno da Base também repinta", () => {
  const rows = grid(12, 12, "t"), before = grid(12, 12), after = put(before, 6, 6, "~");
  assert.ok(affectedCells(rows, rows, before, after).length > 0);
  assert.deepEqual(affectedCells(rows, rows, before, before), []);
});

test("alteração grande pede redesenho completo", () => {
  const before = grid(10, 10), after = grid(10, 10, ".");
  assert.equal(affectedCells(before, after), null);
});

test("chão dominante é a dependência global do desenho", () => {
  assert.equal(dominantGround(grid(4, 4)), ",");
  assert.equal(dominantGround([",,..", "....", "....", "...."]), ".");
});
