import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FINE_CENTER, isFreeMap, tokenCenter, finePoint, fineDistance, withinReach, tokenAtPoint, freeReachCells, placement,
} from "../apps/Eternnus.Web/wwwroot/js/free-move-policy.js";
import { placementProblem, mapTypeLabel } from "../apps/Eternnus.Web/wwwroot/js/scene-policy.js";
import { STATIC_PATHS } from "../apps/Eternnus.Web/wwwroot/js/pwa-policy.js";

test("only tactical maps flagged by the server use free movement", () => {
  assert.equal(isFreeMap({ kind: "tileset", freeMovement: true }), true);
  assert.equal(isFreeMap({ kind: "tileset" }), false);
  assert.equal(isFreeMap({ kind: "cartographic", freeMovement: true }), false);
  assert.equal(isFreeMap(null), false);
});

test("token centre uses the fine point only on free maps and falls back to the cell centre", () => {
  assert.deepEqual(tokenCenter({ x: 3, y: 1, fx: 250, fy: 900 }, true), { x: 3.25, y: 1.9 });
  assert.deepEqual(tokenCenter({ x: 3, y: 1, fx: 250, fy: 900 }, false), { x: 3.5, y: 1.5 });
  assert.deepEqual(tokenCenter({ x: 3, y: 1, fx: null, fy: 1000 }, true), { x: 3.5, y: 1.5 }); // fora da faixa = centro
  assert.equal(FINE_CENTER, 500);
});

test("board points become cell + fine position (thousandths), same arithmetic as FinePositions.cs", () => {
  assert.deepEqual(finePoint(3.25, 1.9, 10, 10), { x: 3, y: 1, fx: 250, fy: 900 });
  assert.deepEqual(finePoint(0, 0, 10, 10), { x: 0, y: 0, fx: 0, fy: 0 });
  assert.deepEqual(finePoint(9.9999, 0.5, 10, 10), { x: 9, y: 0, fx: 999, fy: 500 }); // nunca 1000
  assert.equal(finePoint(10, 0, 10, 10), null);
  assert.equal(finePoint(-0.1, 0, 10, 10), null);
});

test("reach is a straight line: a 5×5 diagonal is beyond 6 squares, 4×4 is within", () => {
  const from = { x: 0, y: 0 };
  assert.ok(Math.abs(fineDistance(from, { x: 5, y: 5, fx: 500, fy: 500 }) - Math.SQRT2 * 5) < 1e-9);
  assert.equal(withinReach(from, { x: 5, y: 5, fx: 500, fy: 500 }, 6), false);
  assert.equal(withinReach(from, { x: 4, y: 4, fx: 200, fy: 700 }, 6), true);
  assert.equal(withinReach(from, { x: 6, y: 0 }, 6), true); // borda incluída
});

test("hit test picks the nearest token whose circle contains the point, even across cell borders", () => {
  const tokens = [{ id: "a", x: 1, y: 1, fx: 950, fy: 500 }, { id: "b", x: 2, y: 1, fx: 100, fy: 500 }];
  // a está em (1,95; 1,5) e b em (2,1; 1,5): o ponto 2,06 fica dentro dos dois círculos, mais perto de b.
  assert.equal(tokenAtPoint(tokens, 2.06, 1.5, true).id, "b");
  assert.equal(tokenAtPoint(tokens, 1.9, 1.5, true).id, "a");
  assert.equal(tokenAtPoint(tokens, 5, 5, true), null);
  // Com grade, o centro da casa vale.
  assert.equal(tokenAtPoint([{ id: "c", x: 1, y: 1, fx: 0, fy: 0 }], 1.5, 1.5, false).id, "c");
});

test("reach cells keep only cells touched by the circle", () => {
  // Centro em (0,5; 0,5), raio 2: (2,0) começa a 1,5; o canto mais próximo de (2,2) fica a 2,12.
  const cells = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }];
  assert.deepEqual(freeReachCells(cells, { x: 0, y: 0 }, 2), [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
});

test("write bodies carry fx/fy only on free maps", () => {
  assert.deepEqual(placement({ x: 2, y: 3, fx: 10, fy: 20, cx: 2.01 }, true), { x: 2, y: 3, fx: 10, fy: 20 });
  assert.deepEqual(placement({ x: 2, y: 3, fx: 10, fy: 20 }, false), { x: 2, y: 3 });
  assert.deepEqual(placement({ x: 2, y: 3 }, true), { x: 2, y: 3 });
});

test("scene preparation lets free maps share cells and labels the map type", () => {
  const tokens = [{ x: 1, y: 1 }];
  assert.equal(placementProblem([], 4, 4, tokens, 1, 1), "Já há um marcador nessa casa.");
  assert.equal(placementProblem([], 4, 4, tokens, 1, 1, -1, true), "");
  assert.equal(placementProblem([["#"]], 4, 4, [], 0, 0, -1, true), "Essa casa bloqueia movimento. Escolha outra.");
  assert.equal(mapTypeLabel({ kind: "tileset", key: "asset:1", freeMovement: true }), "Imagem com movimentação livre (enviada por você)");
});

test("the free movement module is public shell, listed for the service worker", async () => {
  assert.ok(STATIC_PATHS.includes("/js/free-move-policy.js"));
  const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/free-move-policy.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|localStorage|document\./);
});
