// Paredes vetoriais (ADR-087): paridade com o servidor (fixture compartilhado com VectorWallTests.cs) e regras do editor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lineClear, stepBlocked, fogReach, sharedPreview, decodeBits, wallBlocksMove, wallBlocksSight, lightReach } from "../apps/Eternnus.Web/wwwroot/js/fog-policy.js";
import {
  snapPoint, constrainAngle, hitWall, polylineWalls, roomWalls, addWalls, moveVertex, splitWall, removeVertex, joinCollinear,
  translateWalls, copyWalls, wallsInBox, patchWalls, cellsToWalls, diagnose, diagnosticLayers, layerDiff, diffSummary,
} from "../apps/Eternnus.Web/wwwroot/js/wall-policy.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/vector-walls.json", import.meta.url), "utf8"));
const free = Array.from({ length: fx.height }, () => ".".repeat(fx.width));

test("visão: mesmas respostas do servidor no fixture compartilhado", () => {
  for (const c of fx.sight) {
    const [x0, y0] = c.from, [x1, y1] = c.to;
    assert.equal(lineClear(free, fx.width, fx.height, x0, y0, x1, y1, fx.walls), c.clear, `${c.from}→${c.to}: ${c.why}`);
    assert.equal(lineClear(free, fx.width, fx.height, x1, y1, x0, y0, fx.walls), c.clear, `simétrico ${c.to}→${c.from}`);
  }
});

test("movimento: passos bloqueados iguais ao servidor", () => {
  for (const c of fx.steps) assert.equal(stepBlocked(fx.walls, ...c.from, ...c.to), c.blocked, `${c.from}→${c.to}`);
});

test("caminho do jogador contorna paredes e não entra na sala fechada", () => {
  const known = Buffer.from(new Uint8Array(Math.ceil(36 / 8)).fill(255)).toString("base64");
  const fog = { active: true, cells: free, explored: known, walls: fx.walls };
  for (const c of fx.paths) {
    const reach = fogReach(fog, fx.width, fx.height, [], { x: c.from[0], y: c.from[1] }, c.limit);
    const hit = reach.some((p) => p.x === c.to[0] && p.y === c.to[1]);
    assert.equal(hit, c.length !== null, `${c.from}→${c.to}`);
  }
  // Com dois passos, (4,4) é alcançável; com um, não.
  const one = fogReach(fog, fx.width, fx.height, [], { x: 2, y: 2 }, 1);
  assert.ok(!one.some((p) => p.x === 4 && p.y === 4));
});

test("forma reduzida do jogador: porta aberta não bloqueia, janela/parede sim", () => {
  assert.equal(wallBlocksMove({ x1: 0, y1: 0, x2: 100, y2: 0, door: "open" }), false);
  assert.equal(wallBlocksMove({ x1: 0, y1: 0, x2: 100, y2: 0, door: "closed" }), true);
  assert.equal(wallBlocksMove({ x1: 0, y1: 0, x2: 100, y2: 0, door: null }), true);
  assert.equal(wallBlocksSight({ x1: 0, y1: 0, x2: 100, y2: 0, door: null }), false);
  assert.equal(wallBlocksSight({ kind: "door", open: true }), false);
  assert.equal(wallBlocksMove({ kind: "sight" }), false);
});

test("porta aberta deixa ver e passar", () => {
  const walls = fx.walls.map((w) => (w.id === "d" ? { ...w, open: true } : w));
  assert.equal(lineClear(free, 6, 6, 1, 3, 1, 5, walls), true);
  assert.equal(stepBlocked(walls, 1, 3, 1, 4), false);
});

test("luz não atravessa parede e penumbra conta como alcance", () => {
  const { x, y, radius } = fx.light;
  const lit = decodeBits(sharedPreview({ cells: free, revealed: "", lights: [{ x, y, radius }], walls: fx.walls }, 6, 6), 36);
  for (const [cx, cy] of fx.light.lit) assert.equal(lit[cy * 6 + cx], 1, `iluminada ${cx},${cy}`);
  for (const [cx, cy] of fx.light.dark) assert.equal(lit[cy * 6 + cx], 0, `escura ${cx},${cy}`);
  assert.equal(lightReach({ radius: 2, dim: 5 }), 5);
  assert.equal(lightReach({ radius: 4 }), 4);
});

test("ímã: vértice > grade > segmento; tolerância em unidades do mapa", () => {
  const walls = [{ id: "a", x1: 100, y1: 100, x2: 300, y2: 100 }];
  assert.deepEqual(snapPoint({ x: 108, y: 95 }, walls, { tolerance: 20 }), { x: 100, y: 100, snapped: true, target: "vertex" });
  assert.equal(snapPoint({ x: 248, y: 205 }, walls, { tolerance: 10 }).target, "grid");
  const s = snapPoint({ x: 222, y: 108 }, walls, { tolerance: 10, grid: false });
  assert.deepEqual([s.x, s.y, s.target], [222, 100, "segment"]);
  assert.equal(snapPoint({ x: 222, y: 140 }, walls, { tolerance: 10, grid: false }).snapped, false);
  // Fica dentro do mapa.
  assert.deepEqual([snapPoint({ x: -40, y: 9999 }, [], { grid: false, width: 3, height: 3 }).x, snapPoint({ x: -40, y: 9999 }, [], { grid: false, width: 3, height: 3 }).y], [0, 300]);
});

test("Shift trava 0/45/90 graus", () => {
  assert.deepEqual(constrainAngle({ x: 0, y: 0 }, { x: 100, y: 8 }), { x: 100, y: 0 });
  assert.deepEqual(constrainAngle({ x: 0, y: 0 }, { x: 5, y: -90 }), { x: 0, y: -90 });
  const d = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 95 });
  assert.equal(d.x, d.y);
});

test("desenho, vértices, divisão e remoção mantêm cadeias ligadas", () => {
  let walls = polylineWalls([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }]);
  assert.equal(walls.length, 2, "ponto repetido ignorado");
  walls = moveVertex(walls, { x: 200, y: 0 }, { x: 250, y: 50 });
  assert.deepEqual([walls[0].x2, walls[0].y2, walls[1].x1, walls[1].y1], [250, 50, 250, 50]);
  const split = splitWall(walls, walls[0].id, { x: 125, y: 25 });
  assert.equal(split.length, 3);
  assert.equal(splitWall(walls, walls[0].id, { x: 0, y: 0 }).length, 2, "ponta não divide");
  const removed = removeVertex(split, { x: split[0].x2, y: split[0].y2 });
  assert.equal(removed.error, "");
  assert.equal(removed.walls.length, 2);
  assert.match(removeVertex(roomWalls({ x: 0, y: 0 }, { x: 100, y: 100 }).concat(polylineWalls([{ x: 0, y: 0 }, { x: -1, y: 50 }])), { x: 0, y: 0 }).error, /Três ou mais/);
  assert.equal(roomWalls({ x: 0, y: 0 }, { x: 300, y: 200 }).length, 4);
});

test("unir segmentos colineares do mesmo tipo; porta e encontro de três ficam", () => {
  const walls = polylineWalls([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 300, y: 0 }]);
  const joined = joinCollinear(walls);
  assert.equal(joined.length, 1);
  assert.deepEqual([joined[0].x1, joined[0].x2], [0, 300]);
  const bent = polylineWalls([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(joinCollinear(bent).length, 2);
  const doors = patchWalls(walls, [walls[0].id], { kind: "door" });
  assert.equal(joinCollinear(doors).length, 2);
});

test("mover, copiar, seleção retangular e atributos", () => {
  const walls = polylineWalls([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  assert.match(translateWalls(walls, [walls[0].id], -10, 0, 5, 5).error, /sairia do mapa/);
  assert.equal(translateWalls(walls, [walls[0].id], 50, 50, 5, 5).walls[0].x1, 50);
  const copy = copyWalls(walls, [walls[0].id], 0, 100);
  assert.notEqual(copy[0].id, walls[0].id);
  assert.deepEqual(wallsInBox([...walls, ...copy], { x1: -1, y1: 50, x2: 200, y2: 150 }), [copy[0].id]);
  const patched = patchWalls(walls, [walls[0].id], { kind: "window", open: true });
  assert.equal(patched[0].open, false, "só porta fica aberta");
  assert.equal(patchWalls(walls, [walls[0].id], { kind: "x" })[0].kind, "wall");
  assert.match(addWalls(Array(2000).fill(walls[0]), walls).error, /Limite de 2000/);
});

test("conversão de casas em paredes vetoriais (não destrutiva) produz o mesmo bloqueio", () => {
  const cells = ["......", "..##..", "..##..", "......"];
  const walls = cellsToWalls(cells, 6, 4);
  assert.equal(walls.length, 4, "contorno do bloco 2×2 em quatro trechos retos");
  // A conversão bloqueia a passagem pelo bloco como as casas bloqueavam.
  assert.equal(stepBlocked(walls, 1, 1, 2, 1), true);
  assert.equal(lineClear(["......", "......", "......", "......"], 6, 4, 1, 1, 4, 1, walls), false);
  assert.equal(cells[1], "..##..", "casas originais intactas");
  // Bloco na borda: a borda do mapa não vira parede.
  assert.equal(cellsToWalls(["#.", ".."], 2, 2).length, 2);
});

test("diagnóstico aponta problemas reais da geometria", () => {
  const walls = [
    { id: "a", x1: 0, y1: 0, x2: 100, y2: 0, kind: "wall" },
    { id: "b", x1: 100, y1: 0, x2: 0, y2: 0, kind: "wall" },
    { id: "c", x1: 205, y1: 0, x2: 300, y2: 0, kind: "wall" },
    { id: "d", x1: 200, y1: 100, x2: 200, y2: 200, kind: "door" },
  ];
  const cells = ["#...", "....", "...."];
  const issues = diagnose({ cells, walls: [...walls, { id: "e", x1: 100, y1: 0, x2: 198, y2: 0, kind: "wall" }], lights: [{ x: 0, y: 0, radius: 3 }], tokens: [{ x: 0, y: 0, label: "Orc" }] }, 4, 3);
  const types = new Set(issues.map((i) => i.type));
  for (const t of ["duplicate", "gap", "lightInWall", "tokenBlocked", "doorLoose"]) assert.ok(types.has(t), t);
  assert.equal(diagnose({ cells: ["...."], walls: polylineWalls([{ x: 0, y: 0 }, { x: 100, y: 0 }]) }, 4, 1).length, 0);
  const layers = diagnosticLayers({ cells: ["#.", ".."], revealed: "", lights: [{ x: 1, y: 1, radius: 1 }] }, 2, 2);
  assert.equal(decodeBits(layers.blocked, 4)[0], 1);
  assert.equal(layers.lit, 3, "raio 1 alcança a própria casa e as duas vizinhas");
});

test("revisão de diferenças antes de aplicar ignora portas abertas", () => {
  const live = { cells: ["d."], revealed: "", fog: null, walls: [{ id: "d", x1: 0, y1: 0, x2: 100, y2: 0, kind: "door", open: true }], lights: [], marks: [] };
  const prep = { cells: ["o#"], revealed: "", fog: null, walls: [{ id: "d", x1: 0, y1: 0, x2: 100, y2: 0, kind: "door", open: false }, { id: "n", x1: 0, y1: 100, x2: 100, y2: 100, kind: "wall" }], lights: [{ id: "l", x: 0, y: 0, radius: 2 }], marks: [] };
  const d = layerDiff(live, prep);
  assert.deepEqual(d.walls, { added: 1, removed: 0, changed: 0 });
  assert.equal(d.cells, 1, "porta d/o não conta; só a parede nova");
  assert.deepEqual(diffSummary(d), ["1 parede nova", "1 luz nova", "1 casa de bloqueio alterada"]);
  assert.deepEqual(diffSummary(layerDiff(live, live)), []);
});

test("hit-test prefere vértice ao corpo do segmento", () => {
  const walls = [{ id: "a", x1: 0, y1: 0, x2: 200, y2: 0 }];
  assert.equal(hitWall(walls, { x: 5, y: 3 }, 10).part, "a");
  assert.equal(hitWall(walls, { x: 100, y: 6 }, 10).part, "segment");
  assert.equal(hitWall(walls, { x: 100, y: 60 }, 10), null);
});
