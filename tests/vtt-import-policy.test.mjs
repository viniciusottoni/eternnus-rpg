// Mapas soltos na mesa e arquivos Universal VTT: grade, escala e paredes/portas/luzes em casas.
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../apps/Eternnus.Web/wwwroot/js/vtt-import-policy.js";

const room = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
const uvtt = (over = {}) => ({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 8, y: 6 }, pixels_per_grid: 100 },
  line_of_sight: [room(1, 1, 7, 5)],
  portals: [{ position: { x: 3.5, y: 1 }, bounds: [{ x: 3.1, y: 1 }, { x: 3.9, y: 1 }], closed: true }],
  lights: [{ position: { x: 3.5, y: 3.5 }, range: 4.6 }, { position: { x: 3.2, y: 3.8 }, range: 2 }, { position: { x: 99, y: 1 }, range: 3 }],
  image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
  ...over,
});

test("reconhece arquivos UVTT e o tipo real da imagem", () => {
  assert.ok(v.isUvttName("Taverna.DD2VTT"));
  assert.ok(v.isUvttName("x.uvtt") && v.isUvttName("x.df2vtt"));
  assert.equal(v.isUvttName("mapa.json"), false);
  assert.equal(v.imageKind([0x89, 0x50, 0x4e, 0x47]), "image/png");
  assert.equal(v.imageKind([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg");
  assert.equal(v.imageKind([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp");
  assert.equal(v.imageKind([0x3c, 0x73, 0x76, 0x67]), null); // SVG/HTML não passam
  assert.equal(v.mapNameFrom("cripta_de-baixo.png"), "cripta de baixo");
  assert.equal(v.mapNameFrom(".png"), "Mapa da mesa");
});

test("reduz mantendo o quadrado inteiro e recusa grades fora do limite da mesa", () => {
  assert.deepEqual(v.scaledGrid(100, 20, 20), { gridPixels: 100, width: 2000, height: 2000, scaled: false });
  const big = v.scaledGrid(256, 40, 30);
  assert.ok(big.scaled && Number.isInteger(big.gridPixels));
  assert.ok(big.width <= 4096 && big.height <= 4096 && big.width * big.height <= 8_000_000);
  assert.equal(big.width, 40 * big.gridPixels);
  assert.throws(() => v.scaledGrid(70, 120, 10), /até 100 por lado/);
  assert.throws(() => v.scaledGrid(70, 70, 70), /4\.096 casas/);
  assert.throws(() => v.scaledGrid(0, 10, 10), /grade/);
});

test("sugere uma grade comum para imagens soltas, sempre dentro dos limites", () => {
  assert.equal(v.guessGridPixels(1400, 1050), 70);
  assert.equal(v.guessGridPixels(2000, 1000), 100);
  const odd = v.guessGridPixels(1234, 777);
  assert.ok(Math.floor(1234 / odd) <= 100 && Math.floor(1234 / odd) * Math.floor(777 / odd) <= 4096 && odd >= 8);
  assert.ok(v.fitScale(8000, 8000) < 1 && v.fitScale(1000, 1000) === 1);
});

test("lê o UVTT relativo à origem e recusa arquivo sem grade ou imagem", () => {
  const p = v.parseUvtt(uvtt({ resolution: { map_origin: { x: 1, y: 0 }, map_size: { x: 8, y: 6 }, pixels_per_grid: 100 } }));
  assert.equal(p.cellsX, 8);
  assert.equal(p.walls[0][0].x, 0); // 1 − origem 1
  assert.equal(p.portals[0].closed, true);
  assert.throws(() => v.parseUvtt({ image: "x".repeat(20) }), /resolution/);
  assert.throws(() => v.parseUvtt({ resolution: { map_size: { x: 2, y: 2 }, pixels_per_grid: 50 } }), /imagem/);
  assert.equal(v.parseUvtt(uvtt({ image: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAA" })).image, "AAAAAAAAAAAAAAAAAAAA");
});

test("paredes da sala ficam do lado de fora, porta e luzes viram casas", () => {
  const p = v.parseUvtt(uvtt());
  const layer = v.uvttLayer(p, 8, 6, ["........", "........", "..m.....", "........", "........", "........"]);
  const at = (x, y) => layer.cells[y][x];
  // Sala de x 1..7, y 1..5: interior (colunas 1–6, linhas 1–4) continua livre.
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 6; x++) if (!(x === 2 && y === 2)) assert.equal(at(x, y), ".", `${x},${y}`);
  assert.equal(at(2, 2), "m"); // marca anterior preservada
  assert.equal(at(0, 2), "#"); // parede esquerda, lado de fora
  assert.equal(at(7, 2), "#"); // parede direita, lado de fora
  assert.equal(at(5, 5), "#"); // parede de baixo
  assert.equal(at(5, 0), "#"); // parede de cima
  assert.equal(at(3, 0), "d"); // porta fechada na parede de cima
  assert.deepEqual(layer.lights, [{ x: 3, y: 3, radius: 5 }]); // duas luzes na mesma casa viram uma; fora do mapa é ignorada
  assert.equal(layer.counts.doors, 1);
  assert.ok(layer.counts.walls > 10);
  assert.equal(layer.cells.length, 6);
  assert.ok(layer.cells.every((r) => r.length === 8 && /^[.mld#o]+$/.test(r)));
});
