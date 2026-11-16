import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/editor-policy.js", import.meta.url), "utf8");
const P = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test("documents always get Base and Elementos first and at most eight layers", () => {
  const layers = P.ensureLayers([{ id: "extra-1", name: "Teto" }, { id: "base", name: "Chão", opacity: 250 }, { id: "BAD ID" }]);
  assert.deepEqual(layers.map((l) => l.id), ["base", "elements", "extra-1"]);
  assert.equal(layers[0].name, "Chão");
  assert.equal(layers[0].opacity, 100);
  assert.equal(layers[0].kind, "base");
  assert.equal(layers[2].kind, "custom");
  const many = P.ensureLayers(Array.from({ length: 12 }, (_, i) => ({ id: `c-${i}` })));
  assert.equal(many.length, P.MAX_LAYERS);
});

test("required layers cannot be removed and extras stay above Elementos", () => {
  let layers = P.ensureLayers([]);
  assert.match(P.removeLayer(layers, "base").error, /obrigatórias/);
  assert.match(P.removeLayer(layers, "elements").error, /obrigatórias/);
  const a = P.addLayer(layers, "A"); layers = a.layers;
  const b = P.addLayer(layers, "B"); layers = b.layers;
  assert.deepEqual(layers.map((l) => l.id), ["base", "elements", a.id, b.id]);
  layers = P.moveLayer(layers, b.id, -1).layers;
  assert.deepEqual(layers.map((l) => l.id), ["base", "elements", b.id, a.id]);
  assert.deepEqual(P.moveLayer(layers, b.id, -1).layers.map((l) => l.id), ["base", "elements", b.id, a.id]);
  assert.ok(P.moveLayer(layers, "elements", 1).error);
  layers = P.removeLayer(layers, a.id).layers;
  assert.deepEqual(layers.map((l) => l.id), ["base", "elements", b.id]);
  while (layers.length < P.MAX_LAYERS) layers = P.addLayer(layers).layers;
  assert.ok(P.addLayer(layers).error);
  assert.equal(P.patchLayer(layers, "base", { opacity: -5, kind: "custom" })[0].opacity, 0);
  assert.equal(P.patchLayer(layers, "base", { kind: "custom" })[0].kind, "base");
});

test("history groups a drag into one entry, skips no-op drags and supports undo, redo and jump", () => {
  let state = { x: 0 };
  const h = P.createHistory({ capture: () => structuredClone(state), restore: (s) => { state = structuredClone(s); } });
  h.begin("Mover");
  for (let i = 1; i <= 50; i++) state.x = i;
  assert.equal(h.commit(), true);
  assert.equal(h.entries().length, 1);
  h.begin("Mover"); assert.equal(h.commit(), false);
  h.record("Pintar"); state.x = 99;
  assert.equal(h.undo(), "Pintar"); assert.equal(state.x, 50);
  assert.equal(h.undo(), "Mover"); assert.equal(state.x, 0);
  assert.equal(h.canUndo, false);
  assert.equal(h.redo(), "Mover"); assert.equal(state.x, 50);
  h.jump(2); assert.equal(state.x, 99);
  h.jump(0); assert.equal(state.x, 0);
  h.begin("Arrastar"); state.x = 7; h.cancel(); assert.equal(state.x, 0);
  h.record("Nova ação"); assert.equal(h.canRedo, false);
});

test("history keeps at most the configured number of steps", () => {
  let n = 0;
  const h = P.createHistory({ capture: () => n, restore: (v) => { n = v; }, limit: 3 });
  for (let i = 0; i < 10; i++) { h.record("passo"); n++; }
  assert.equal(h.entries().length, 3);
});

test("shortcuts are normalized and never fire while typing, except save and escape", () => {
  assert.equal(P.shortcutOf({ key: "z", ctrlKey: true }), "mod+z");
  assert.equal(P.shortcutOf({ key: "Z", ctrlKey: true, shiftKey: true }), "mod+shift+z");
  assert.equal(P.shortcutOf({ key: "y", metaKey: true }), "mod+y");
  assert.equal(P.shortcutOf({ key: "=", ctrlKey: true }), "mod+plus");
  assert.equal(P.shortcutOf({ key: ")", code: "Digit0", ctrlKey: true, shiftKey: true }), "mod+shift+0");
  assert.equal(P.shortcutOf({ key: "0", code: "Digit0", ctrlKey: true }), "mod+0");
  assert.equal(P.shortcutOf({ key: " " }), "space");
  assert.equal(P.shortcutOf({ key: "V" }), "v");
  assert.equal(P.shortcutOf({ key: "Delete" }), "delete");
  assert.equal(P.isTypingTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(P.isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(P.isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(P.isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(P.isTypingTarget({ tagName: "CANVAS" }), false);
  assert.ok(P.FIELD_SAFE.has("mod+s") && P.FIELD_SAFE.has("escape") && !P.FIELD_SAFE.has("mod+z"));
  assert.equal(P.shortcutLabel("mod+shift+z"), "Ctrl+Shift+Z");
});

test("zoom keeps the point under the cursor fixed and menus stay inside the window", () => {
  const view = { x: 100, y: 50, scale: 1 };
  const next = P.zoomAround(view, 2, 300, 250);
  const before = { x: (300 - view.x) / view.scale, y: (250 - view.y) / view.scale };
  assert.deepEqual({ x: (300 - next.x) / next.scale, y: (250 - next.y) / next.scale }, before);
  assert.ok(P.fitScale(2000, 1000, 1000, 800) < 0.5);
  assert.equal(P.stepZoom(16, 1), 16);
  assert.deepEqual(P.clampMenu(990, 790, 200, 100, 1000, 800), { x: 794, y: 694 });
  assert.equal(P.zoomLabel(1.5), "150%");
});
