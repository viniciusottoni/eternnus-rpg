// Linha do tempo (ADR-072/093): trechos recolhíveis e preferência de trechos abertos. Regras puras.
import test from "node:test";
import assert from "node:assert/strict";
import { timelineChunks, openChunks, serpentCell, CHUNK } from "../apps/Eternnus.Web/wwwroot/js/campaign-timeline.js";

test("divide os acontecimentos em trechos de 10, sempre com ao menos um", () => {
  assert.equal(CHUNK, 10);
  assert.deepEqual(timelineChunks(0), [{ index: 0, from: 0, to: 0 }]);
  assert.deepEqual(timelineChunks(10).map((c) => [c.from, c.to]), [[0, 10]]);
  assert.deepEqual(timelineChunks(45).map((c) => [c.from, c.to]), [[0, 10], [10, 20], [20, 30], [30, 40], [40, 45]]);
});

test("sem preferência abre só o último trecho; preferência salva é filtrada e o foco sempre abre", () => {
  assert.deepEqual([...openChunks(5, null)], [4]);
  assert.deepEqual([...openChunks(5, [0, 2, 9, -1, "x"])], [0, 2]);
  assert.deepEqual([...openChunks(5, [], 3)].sort(), [3]);
  assert.deepEqual([...openChunks(5, [1], 1)], [1]);
});

test("serpente alterna o sentido das fileiras", () => {
  assert.deepEqual(serpentCell(0, 4), { row: 1, col: 1 });
  assert.deepEqual(serpentCell(4, 4), { row: 2, col: 4 });
});
