import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  tokenLayerOf, layerAlpha, nearestFreeCell, clipboardFrom, pastePlacement, moveTokensBy, structureGroups, sameSnapshot, sceneLayers,
} from "../apps/Eternnus.Web/wwwroot/js/scene-policy.js";
import { addLayer, ensureLayers, createHistory } from "../apps/Eternnus.Web/wwwroot/js/editor-policy.js";

const root = new URL("../apps/Eternnus.Web/", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");
// 4 × 3 casas; (1,0) bloqueia movimento, (2,1) é parede.
const cells = [".m..", "..#.", "...."];

test("scene layers keep Base and Elementos and only the contract fields", () => {
  const layers = sceneLayers([{ id: "extra-1", name: "Emboscada", kind: "custom", visible: false, junk: 1 }]);
  assert.deepEqual(layers.map((l) => l.id), ["base", "elements", "extra-1"]);
  assert.deepEqual(Object.keys(layers[2]).sort(), ["id", "kind", "locked", "name", "opacity", "visible"]);
  assert.equal(sceneLayers(null).length, 2);
});

test("token layer falls back to Elementos for Base, missing or unknown layers", () => {
  const { layers } = addLayer(ensureLayers([]), "Reforços");
  const extra = layers[2].id;
  assert.equal(tokenLayerOf(extra, layers), extra);
  assert.equal(tokenLayerOf("base", layers), "elements");
  assert.equal(tokenLayerOf("", layers), "elements");
  assert.equal(tokenLayerOf("nope", layers), "elements");
  assert.equal(tokenLayerOf(undefined, layers), "elements");
});

test("layer visibility and opacity are editor-only display alpha", () => {
  assert.equal(layerAlpha({ visible: false, opacity: 100 }), 0);
  assert.equal(layerAlpha({ visible: true, opacity: 40 }), 0.4);
  assert.equal(layerAlpha({ visible: true, opacity: 250 }), 1);
  assert.equal(layerAlpha(null), 1);
});

test("nearest free cell skips blocked and occupied cells and respects the 60-marker limit", () => {
  assert.deepEqual(nearestFreeCell(cells, 4, 3, [], 0, 0), { x: 0, y: 0 });
  assert.deepEqual(nearestFreeCell(cells, 4, 3, [{ x: 0, y: 0 }], 0, 0), { x: 0, y: 1 });
  const p = nearestFreeCell(cells, 4, 3, [], 2, 1);
  assert.equal(Math.abs(p.x - 2) + Math.abs(p.y - 1), 1, "vizinho direto da parede");
  assert.equal(nearestFreeCell(cells, 4, 3, Array.from({ length: 60 }, (_, i) => ({ x: 99, y: i })), 0, 0), null);
  assert.equal(nearestFreeCell(cells, 0, 0, [], 0, 0), null);
});

test("paste keeps relative arrangement, moves to the nearest free cell and never duplicates a player character", () => {
  const tokens = [{ label: "A", x: 0, y: 0, side: "enemy" }, { label: "B", x: 1, y: 1, side: "enemy" }, { label: "Lia", characterId: "c1", x: 3, y: 2 }];
  const items = clipboardFrom(tokens, [1, 0, 2]);
  assert.deepEqual(items.map((i) => [i.dx, i.dy]), [[0, 0], [1, 1], [3, 2]]);
  const { placed, skipped } = pastePlacement({ cells, width: 4, height: 3, tokens, items, anchor: { x: 0, y: 1 } });
  assert.equal(skipped, 1, "personagem já presente não é colado");
  assert.equal(placed.length, 2);
  assert.deepEqual([placed[0].x, placed[0].y], [0, 1]);
  // (1,2) livre → mantém a posição relativa.
  assert.deepEqual([placed[1].x, placed[1].y], [1, 2]);
  const crowded = pastePlacement({ cells, width: 4, height: 3, tokens: [{ x: 3, y: 0 }], items: clipboardFrom([{ label: "X", x: 0, y: 0 }], [0]), anchor: { x: 3, y: 0 } });
  assert.notDeepEqual([crowded.placed[0].x, crowded.placed[0].y], [3, 0]);
  assert.equal(crowded.placed[0].fx, null);
  // Recortar um personagem e colar: volta à cena (não está mais presente).
  const back = pastePlacement({ cells, width: 4, height: 3, tokens: [], items: clipboardFrom(tokens, [2]), anchor: { x: 3, y: 2 } });
  assert.equal(back.placed[0].characterId, "c1");
  assert.equal(clipboardFrom(tokens, []).length, 0);
});

test("moving a selection is all-or-nothing and validated like a single move", () => {
  const tokens = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 3, y: 2 }];
  const ok = moveTokensBy(cells, 4, 3, tokens, [0, 1], 0, 1);
  assert.deepEqual(ok.tokens.slice(0, 2).map((t) => [t.x, t.y]), [[0, 1], [0, 2]], "o grupo pode ocupar a casa que ele mesmo libera");
  assert.ok(moveTokensBy(cells, 4, 3, tokens, [0, 1], 1, 0).error, "(1,0) bloqueia movimento");
  assert.ok(moveTokensBy(cells, 4, 3, tokens, [2], 1, 0).error, "fora do mapa");
  assert.ok(moveTokensBy(cells, 4, 3, tokens, [], 1, 0).error);
  assert.deepEqual(tokens[0], { x: 0, y: 0 }, "não altera a lista original");
});

test("structure lists markers by layer (top first, no Base) and optional technical groups", () => {
  const { layers } = addLayer(ensureLayers([]), "Reforços");
  const extra = layers[2].id;
  const tokens = [{ label: "Lobo", side: "enemy", x: 0, y: 0, layer: extra, hidden: true }, { label: "Lia", characterId: "c1", side: "ally", x: 1, y: 1 }];
  const groups = structureGroups({ tokens, layers, selected: [1] });
  assert.deepEqual(groups.map((g) => g.id), [extra, "elements"]);
  assert.equal(groups[0].items[0].id, "t0");
  assert.match(groups[0].items[0].meta, /oculto/);
  assert.equal(groups[1].items[0].selected, true);
  const layer = { cells: ["d.o.", "....", "...."], lights: [{ x: 1, y: 1, radius: 4 }], marks: [{ x: 3, y: 2, kind: "trap", label: "Fosso" }] };
  const all = structureGroups({ tokens, layers, layer, technical: true, kinds: [["trap", "Armadilha"]] });
  const by = Object.fromEntries(all.map((g) => [g.id, g]));
  assert.deepEqual(by.lights.items.map((i) => i.id), ["light:1:1"]);
  assert.deepEqual(by.marks.items.map((i) => [i.id, i.meta]), [["mark:3:2", "Armadilha · coluna 4, linha 3"]]);
  assert.deepEqual(by.doors.items.map((i) => [i.id, i.meta]), [["door:0:0", "fechada"], ["door:2:0", "aberta"]]);
  assert.equal(structureGroups({ tokens, layers, layer }).length, 2, "Básica: sem grupos técnicos");
});

test("history snapshots recompute dirty state after undo/redo", () => {
  let state = { draft: { name: "Ponte", prepared: [] }, layer: null };
  const saved = JSON.parse(JSON.stringify(state));
  const history = createHistory({ capture: () => JSON.parse(JSON.stringify(state)), restore: (s) => { state = s; } });
  history.record("Adicionar marcador");
  state.draft.prepared.push({ label: "Guarda", x: 0, y: 0 });
  assert.equal(sameSnapshot(state, saved), false);
  history.undo();
  assert.equal(sameSnapshot(state, saved), true, "desfazer até o salvo deixa de ter alterações");
  history.redo();
  assert.equal(sameSnapshot(state, saved), false);
});

test("scene editor builds on the shared core and keeps the API contract", async () => {
  const src = await read("wwwroot/js/scene-editor.js");
  assert.match(src, /createEditorShell/);
  assert.match(src, /createHistory/);
  for (const path of ["/scenes", "/assets/layers?key=", "/scene/apply", "/assets/maps/", "/npcs"]) assert.ok(src.includes(path), path);
  assert.match(src, /folderId/);
  assert.match(src, /layers: sceneLayers/);
  assert.doesNotMatch(src, /(?<![\w.-])title=["']/);
  const css = await read("wwwroot/editor-scene.css");
  assert.doesNotMatch(css, /@import/);
});
