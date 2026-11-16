import test from "node:test";
import assert from "node:assert/strict";
import {
  LOOK_IMAGE, hasSpan, spanCells, tokenSpan, takenKeys, covers, tokenBox, boxFromHandle, spanFromBox, spanLabel, tokenUnder, SPAN_HANDLES,
} from "../apps/Eternnus.Web/wwwroot/js/token-look.js";
import { placementProblem, moveTokensBy } from "../apps/Eternnus.Web/wwwroot/js/scene-policy.js";
import { tokenCenter } from "../apps/Eternnus.Web/wwwroot/js/free-move-policy.js";

// ADR-092: imagem livre com largura e altura próprias; no mapa tático ocupa as casas da área.
const big = (x, y, width, height) => ({ x, y, appearance: LOOK_IMAGE, width, height });
const handle = (id) => SPAN_HANDLES.find((h) => h.id === id);

test("span exists only for image look with width and height, rounded like TokenSpan.ToCells", () => {
  assert.equal(hasSpan({ appearance: "round", width: 200, height: 200 }), false);
  assert.equal(hasSpan({ appearance: LOOK_IMAGE }), false);
  assert.equal(hasSpan(big(0, 0, 200, 300)), true);
  assert.deepEqual(tokenSpan(big(0, 0, 200, 300)), { w: 2, h: 3 });
  assert.deepEqual(tokenSpan({ x: 0, y: 0 }), { w: 1, h: 1 });
  assert.equal(spanCells(50), 1);
  assert.equal(spanCells(150), 2); // meio arredonda para cima, como MidpointRounding.AwayFromZero
  assert.equal(spanCells(249), 2);
});

test("taken cells include every cell of a large creature", () => {
  const keys = takenKeys([big(1, 1, 200, 100), { x: 5, y: 5 }]);
  assert.deepEqual([...keys].sort(), ["1:1", "2:1", "5:5"]);
  assert.ok(covers(big(1, 1, 200, 200), 2, 2));
  assert.ok(!covers(big(1, 1, 200, 200), 3, 1));
});

test("tactical box sits on the anchor cell; free box is centered on the fine point", () => {
  assert.deepEqual(tokenBox(big(2, 3, 200, 100), false), { x: 2, y: 3, w: 2, h: 1 });
  const free = tokenBox({ ...big(2, 3, 200, 100), fx: 500, fy: 500 }, true);
  assert.deepEqual(free, { x: 1.5, y: 3, w: 2, h: 1 });
});

test("dragging a handle moves only that side, in any direction, snapped to cells on tactical maps", () => {
  const box = { x: 2, y: 2, w: 1, h: 1 };
  assert.deepEqual(boxFromHandle(box, handle("w"), { x: 0.4, y: 9 }, false, 10, 10), { x: 0, y: 2, w: 3, h: 1 });
  assert.deepEqual(boxFromHandle(box, handle("se"), { x: 4.6, y: 3.2 }, false, 10, 10), { x: 2, y: 2, w: 3, h: 1 });
  assert.deepEqual(boxFromHandle(box, handle("n"), { x: 0, y: -5 }, false, 10, 10), { x: 2, y: 0, w: 1, h: 3 });
  // Nunca menor que uma casa nem fora do mapa; no máximo 8 casas.
  assert.deepEqual(boxFromHandle(box, handle("e"), { x: 1, y: 0 }, false, 10, 10), { x: 2, y: 2, w: 1, h: 1 });
  assert.deepEqual(boxFromHandle(box, handle("e"), { x: 40, y: 0 }, false, 10, 10), { x: 2, y: 2, w: 8, h: 1 });
  assert.deepEqual(boxFromHandle({ x: 8, y: 2, w: 1, h: 1 }, handle("e"), { x: 40, y: 0 }, false, 10, 10), { x: 8, y: 2, w: 2, h: 1 });
});

test("free maps resize freely (5% steps, minimum half a cell)", () => {
  const box = { x: 2, y: 2, w: 1, h: 1 };
  const r = boxFromHandle(box, handle("e"), { x: 3.73, y: 0 }, true, 10, 10);
  assert.equal(r.x, 2);
  assert.ok(Math.abs(r.w - 1.75) < 1e-9);
  const tiny = boxFromHandle(box, handle("s"), { x: 0, y: 2.1 }, true, 10, 10);
  assert.ok(Math.abs(tiny.h - 0.5) < 1e-9);
});

test("box becomes token fields: anchor cell on tactical, fine center on free", () => {
  assert.deepEqual(spanFromBox({ x: 0, y: 2, w: 3, h: 1 }, false), { x: 0, y: 2, width: 300, height: 100 });
  assert.deepEqual(spanFromBox({ x: 1, y: 1, w: 2, h: 1 }, true), { x: 2, y: 1, fx: 0, fy: 500, width: 200, height: 100 });
  const t = { ...big(0, 0, 0, 0), ...spanFromBox({ x: 1, y: 1, w: 2, h: 1 }, true) };
  assert.deepEqual(tokenCenter(t, true), { x: 2, y: 1.5 });
  assert.equal(spanLabel(big(0, 0, 200, 300), false), "2 × 3 casas");
  assert.equal(spanLabel(big(0, 0, 150, 75), true), "150% × 75%");
});

test("clicking anywhere on a large creature selects it", () => {
  const dragon = { id: "d", ...big(1, 1, 300, 200) }, wolf = { id: "w", x: 6, y: 6 };
  const centerOf = (t) => tokenCenter(t, false);
  assert.equal(tokenUnder([dragon, wolf], 3.9, 2.9, centerOf, false)?.id, "d");
  assert.equal(tokenUnder([dragon, wolf], 4.2, 1.5, centerOf, false), null);
});

test("placement checks the whole area of a large creature on tactical maps", () => {
  const cells = ["......", "..#...", "......"];
  const others = [{ x: 4, y: 0 }];
  assert.equal(placementProblem(cells, 6, 3, others, 0, 0, -1, false, { w: 2, h: 2 }), "");
  assert.match(placementProblem(cells, 6, 3, others, 1, 0, -1, false, { w: 2, h: 2 }), /bloqueia movimento/);
  assert.match(placementProblem(cells, 6, 3, others, 3, 0, -1, false, { w: 2, h: 1 }), /encosta em outro marcador/);
  assert.match(placementProblem(cells, 6, 3, others, 5, 0, -1, false, { w: 2, h: 1 }), /não cabe/);
  // Um marcador comum não pode entrar na área de uma criatura grande.
  assert.match(placementProblem(cells, 6, 3, [big(0, 0, 200, 200)], 1, 1, -1, false), /Já há um marcador/);
  // Movimentação livre: casas podem ser divididas.
  assert.equal(placementProblem(cells, 6, 3, [big(0, 0, 200, 200)], 1, 1, -1, true, { w: 2, h: 2 }), "");
});

test("moving a group keeps large creatures inside free cells", () => {
  const cells = ["......", "......"];
  const tokens = [big(0, 0, 200, 100), { x: 4, y: 0 }];
  assert.ok(moveTokensBy(cells, 6, 2, tokens, [0], 1, 0).tokens);
  assert.match(moveTokensBy(cells, 6, 2, tokens, [0], 3, 0).error, /encosta|não cabe/);
});
