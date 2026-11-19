import test from "node:test";
import assert from "node:assert/strict";
import { isMapInstance, canInstance, sceneGrid, mapCells, toSceneCells, alignment, snapInstance, placeInstance, nextInstance, clipSegment, transformPrep, mergePrep, importSummary } from "../apps/Eternnus.Web/wwwroot/js/map-instance-policy.js";

const KEY = "asset:11111111-2222-3333-4444-555555555555";
const KEY2 = "asset:aaaaaaaa-2222-3333-4444-555555555555";
// Original: 700 × 420 px, casa de 70 px → 10 × 6 casas. Cena: casa de 50 px, deslocamento (10, 5), 40 × 30 casas.
const MAP = { key: KEY, pixelWidth: 700, pixelHeight: 420, gridPixels: 70, gridOffsetX: 0, gridOffsetY: 0, hasGrid: true, kind: "tileset", isTileMap: false };
const GRID = sceneGrid({ gridPixels: 50, gridOffsetX: 10, gridOffsetY: 5, width: 40, height: 30 });
const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-6;

test("instância: reconhece só imagem com mapKey igual à origem e mapas com grade", () => {
  assert.ok(isMapInstance({ type: "image", src: KEY, mapKey: KEY }));
  assert.ok(!isMapInstance({ type: "image", src: KEY }));
  assert.ok(!isMapInstance({ type: "image", src: KEY2, mapKey: KEY }));
  assert.ok(!isMapInstance({ type: "rect", mapKey: KEY }));
  assert.ok(canInstance(MAP));
  assert.ok(!canInstance({ ...MAP, hasGrid: false }));
  assert.ok(!canInstance({ ...MAP, isTileMap: true }));
  assert.ok(!canInstance({ ...MAP, key: "crypt" }));
  assert.deepEqual(mapCells(MAP), { width: 10, height: 6 });
  assert.equal(sceneGrid({ gridPixels: 0 }), null);
});

test("inserir: escala da casa, posição na grade da cena (com deslocamento) e giro 0", () => {
  const el = placeInstance(MAP, GRID, { x: 523, y: 311 });
  assert.equal(el.width, 500); assert.equal(el.height, 300); assert.equal(el.rotation, 0);
  assert.equal(el.mapKey, KEY); assert.equal(el.src, KEY);
  const p = toSceneCells(el, MAP, GRID)(0, 0);
  assert.ok(isInt(p.x) && isInt(p.y), JSON.stringify(p));
  assert.ok(Math.abs((el.x - 10) % 50) < 1e-6 && Math.abs((el.y - 5) % 50) < 1e-6);
  assert.ok(alignment(el, MAP, GRID).aligned);
});

test("encaixar: giro livre vira múltiplo de 90°, tamanho e linhas da grade voltam", () => {
  const loose = { type: "image", src: KEY, mapKey: KEY, x: 101, y: 77, width: 640, height: 380, rotation: 83 };
  assert.ok(!alignment(loose, MAP, GRID).aligned);
  const snapped = { ...loose, ...snapInstance(loose, MAP, GRID) };
  assert.equal(snapped.rotation, 90);
  assert.equal(snapped.width, 500); assert.equal(snapped.height, 300);
  assert.ok(alignment(snapped, MAP, GRID).aligned);
  // Encaixar de novo não move (idempotente).
  assert.deepEqual(snapInstance(snapped, MAP, GRID), { x: snapped.x, y: snapped.y, width: 500, height: 300, rotation: 90 });
  // Original com casa diferente e deslocamento próprio também encaixa.
  const odd = { ...MAP, gridPixels: 64, gridOffsetX: 17, gridOffsetY: 9, pixelWidth: 1000, pixelHeight: 700 };
  const placed = placeInstance(odd, GRID, { x: 400, y: 400 }, { rotation: 180 });
  assert.equal(placed.rotation, -180);
  assert.ok(alignment(placed, odd, GRID).aligned);
});

test("converter preparação: translação, 90° e paredes no referencial da cena", () => {
  const source = {
    cells: ["#.........", "..........", "..........", "..........", "..........", "d........."],
    lights: [{ id: "x", x: 9, y: 0, radius: 4 }],
    walls: [{ id: "w", x1: 0, y1: 0, x2: 100, y2: 0, kind: "door", open: true }],
  };
  const flat = placeInstance(MAP, GRID, { x: 260, y: 160 });
  const o = toSceneCells(flat, MAP, GRID)(0, 0);
  const t0 = transformPrep(source, flat, MAP, GRID);
  assert.deepEqual(t0.cells, [{ x: o.x, y: o.y, c: "#" }, { x: o.x, y: o.y + 5, c: "d" }]);
  assert.deepEqual(t0.lights, [{ x: o.x + 9, y: o.y, radius: 4 }]);
  assert.deepEqual(t0.walls, [{ x1: o.x * 100, y1: o.y * 100, x2: o.x * 100 + 100, y2: o.y * 100, kind: "door", open: true }]);
  // 90° à direita: a casa (cx, cy) vai para (5 − cy, cx) no retângulo girado (6 × 10).
  const turned = placeInstance(MAP, GRID, { x: 500, y: 500 }, { rotation: 90 });
  const t = transformPrep(source, turned, MAP, GRID);
  const hash = t.cells.find((c) => c.c === "#"), door = t.cells.find((c) => c.c === "d");
  const ox = door.x, oy = door.y; // (0,5) → (0,0) do retângulo girado
  assert.deepEqual(hash, { x: ox + 5, y: oy, c: "#" });
  assert.deepEqual(t.lights, [{ x: ox + 5, y: oy + 9, radius: 4 }]);
  const w = t.walls[0];
  assert.deepEqual([Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)], [(ox + 6) * 100, oy * 100, (ox + 6) * 100, (oy + 1) * 100]);
  assert.equal(w.kind, "door"); assert.equal(w.open, true);
  assert.ok(!("id" in w) && !("id" in t.lights[0]));
});

test("converter preparação: recorta paredes e descarta casas e luzes fora da cena", () => {
  const source = { cells: ["#########m", "", "", "", "", ""], lights: [{ x: 9, y: 5, radius: 2 }], walls: [{ x1: 0, y1: 300, x2: 1000, y2: 300, kind: "wall" }] };
  // Na borda direita: só 4 das 10 colunas cabem (cena com 40 casas).
  const edge = placeInstance(MAP, GRID, { x: 0, y: 0 });
  const o = toSceneCells(edge, MAP, GRID)(0, 0);
  const shifted = { ...edge, x: edge.x + (36 - o.x) * 50, y: edge.y + (2 - o.y) * 50 };
  const t = transformPrep(source, shifted, MAP, GRID);
  assert.equal(t.cells.length, 4);
  assert.equal(t.dropped.cells, 6);
  assert.equal(t.dropped.lights, 1);
  assert.deepEqual(t.walls.map((s) => [s.x1, s.y1, s.x2, s.y2]), [[3600, 500, 4000, 500]]);
  assert.deepEqual(clipSegment(-50, 10, 50, 10, 100, 100), [0, 10, 50, 10]);
  assert.equal(clipSegment(-50, -10, -1, -10, 100, 100), null);
  // Desalinhada: recusa em vez de adivinhar.
  assert.match(transformPrep(source, { ...shifted, x: shifted.x + 7 }, MAP, GRID).error, /grade/);
});

test("duas instâncias lado a lado: regras se somam sem repetir e os marcadores não mudam", () => {
  const source = { cells: ["#.........", "..........", "..........", "..........", "..........", "........."], lights: [{ x: 1, y: 1, radius: 3 }], walls: [{ x1: 0, y1: 0, x2: 1000, y2: 0, kind: "wall" }] };
  const a = placeInstance(MAP, GRID, { x: 260, y: 160 });
  const oa = toSceneCells(a, MAP, GRID)(0, 0);
  const b = { ...a, mapKey: KEY2, src: KEY2, x: a.x + 500 };
  const ob = toSceneCells(b, { ...MAP, key: KEY2 }, GRID)(0, 0);
  assert.equal(ob.x, oa.x + 10); assert.equal(ob.y, oa.y);
  const tokens = [{ x: oa.x + 2, y: oa.y + 2 }, { x: ob.x + 2, y: ob.y + 2, fx: 250, fy: 750 }];
  const before = JSON.parse(JSON.stringify(tokens));
  const layer = { cells: Array.from({ length: 30 }, () => ".".repeat(40)), lights: [], walls: [] };
  const first = mergePrep(layer, transformPrep(source, a, MAP, GRID), 40, "a");
  const both = mergePrep(first.layer, transformPrep(source, b, { ...MAP, key: KEY2 }, GRID), 40, "b");
  assert.equal(both.layer.lights.length, 2);
  assert.equal(both.layer.walls.length, 2);
  assert.equal(both.layer.cells[oa.y][oa.x], "#"); assert.equal(both.layer.cells[ob.y][ob.x], "#");
  assert.equal(new Set(both.layer.walls.map((w) => w.id)).size, 2);
  assert.ok(both.layer.walls.every((w) => /^[A-Za-z0-9]+$/.test(w.id)));
  assert.deepEqual(tokens, before);
  assert.equal(layer.walls.length, 0); // entrada não muda
  // Trazer de novo não duplica.
  const again = mergePrep(both.layer, transformPrep(source, b, { ...MAP, key: KEY2 }, GRID), 40, "c");
  assert.deepEqual(again.added, { cells: 0, lights: 0, walls: 0 });
  assert.equal(again.skipped, 2);
  assert.match(importSummary("Corredor", both.added, { cells: 0 }, 0), /Corredor.*parede/);
});

test("navegar entre instâncias segue a ordem do documento", () => {
  const els = [{ id: "a", type: "image", src: KEY, mapKey: KEY }, { id: "x", type: "image", src: KEY }, { id: "b", type: "image", src: KEY2, mapKey: KEY2 }];
  assert.equal(nextInstance(els, "a", 1), "b");
  assert.equal(nextInstance(els, "b", 1), "a");
  assert.equal(nextInstance(els, "a", -1), "b");
  assert.equal(nextInstance(els, "x", -1), "b");
  assert.equal(nextInstance([], null, 1), null);
});

test("área em branco por casas: limites da imagem e da grade", async () => {
  const { blankSurface, BLANK_PRESETS } = await import("../apps/Eternnus.Web/wwwroot/js/map-instance-policy.js");
  assert.deepEqual(blankSurface(30, 20), { width: 2100, height: 1400, gridPixels: 70 });
  assert.deepEqual(blankSurface(40, 30), { width: 2800, height: 2100, gridPixels: 70 });
  const big = blankSurface(60, 40);
  assert.equal(big.gridPixels, 57); assert.ok(big.width * big.height <= 8_000_000 && big.width <= 4096);
  for (const [c, r] of BLANK_PRESETS) assert.ok(!blankSurface(c, r).error);
  assert.match(blankSurface(100, 50).error, /4\.096/);
  assert.match(blankSurface(4, 20).error, /8 a 100/);
});
