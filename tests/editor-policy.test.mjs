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

test("régua: marcas maiores em casas inteiras com espaço legível, menores por casa", () => {
  assert.deepEqual(P.rulerSteps(40, 1.5), { majorPx: 80, majorUnits: 3, minorPx: 40 });
  assert.deepEqual(P.rulerSteps(5, 1.5), { majorPx: 100, majorUnits: 30, minorPx: 10 });
  assert.deepEqual(P.rulerSteps(200, 1.5), { majorPx: 200, majorUnits: 1.5, minorPx: 50 });
  assert.equal(P.rulerSteps(0, 1.5), null);
  assert.equal(P.rulerSteps(40, 0), null);
  assert.equal(P.rulerSteps(Infinity, 1), null);
  // Sem grade (pixels): 1 px por unidade ainda gera marcas legíveis.
  assert.deepEqual(P.rulerSteps(1, 1), { majorPx: 100, majorUnits: 100, minorPx: 10 });
});

test("régua: rótulos com vírgula decimal e sem -0", () => {
  assert.equal(P.rulerLabel(4.5), "4,5");
  assert.equal(P.rulerLabel(-3), "-3");
  assert.equal(P.rulerLabel(-0.0001), "0");
  assert.equal(P.rulerLabel(1.25), "1,25");
  assert.equal(P.rulerLabel(1500), "1.500");
});

// ---------- Barra lateral dos editores (ADR-118) ----------
test("lateral: áreas declaradas, inicial salva/declarada e Histórico secundário", () => {
  const panels = [{ id: "quick", area: "inspect" }, { id: "structure" }, { id: "assets", area: "add" }, { id: "doc", area: "configure" }, { id: "history" }];
  assert.equal(P.panelArea(panels[1]), "organize");
  assert.equal(P.panelArea(panels[4]), "history");
  assert.equal(P.panelArea({ id: "x", area: "evil" }), "organize");
  assert.deepEqual(P.sideAreasFor(panels).map((a) => a.id), ["organize", "add", "configure"]);
  assert.deepEqual(P.sideAreasFor([{ id: "a", area: "add" }]).map((a) => a.id), ["add"]);
  assert.equal(P.initialArea(panels, "configure", "add"), "configure");
  assert.equal(P.initialArea(panels, "bogus", "add"), "add");
  assert.equal(P.initialArea([{ id: "l" }], "add", null), "organize");
  assert.equal(P.initialArea([{ id: "h", area: "history" }], null, null), "history");
});
test("lateral: preferências novas normalizadas; antigas e inválidas não quebram o layout", () => {
  const p = P.normalizeLayoutPref({ width: 9999, area: { image: "add", scene: "evil", "BAD KEY": "add" }, split: { image: 0.95, scene: "x", tiles: 0.3 }, tree: { image: ["map:base", "<script>", 3] }, views: { scene: { charView: "reserved", bad: "<b>" } } });
  assert.equal(p.width, P.PANEL_WIDTH.max);
  assert.deepEqual(p.area, { image: "add" });
  assert.deepEqual(p.split, { image: P.INSPECT_SPLIT.max, tiles: 0.3 });
  assert.deepEqual(p.tree, { image: ["map:base", "3"] });
  assert.deepEqual(p.views, { scene: { charView: "reserved" } });
  assert.deepEqual(P.normalizeLayoutPref({ width: 300, closed: ["layers"] }), { width: 300, closed: ["layers"] });
  assert.equal(P.clampSplit(0.01), P.INSPECT_SPLIT.min);
});
test("árvore: intervalo com Shift e destinos de arraste", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(P.rangeIds(order, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(P.rangeIds(order, "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(P.rangeIds(order, "zz", "c"), ["c"]);
  assert.deepEqual(P.rangeIds(order, "a", "zz"), []);
  const items = [{ layer: "elements", movable: true }];
  assert.equal(P.outlineDropProblem(items, { name: "Teto" }), null);
  assert.match(P.outlineDropProblem(items, { name: "Teto", locked: true }), /bloqueada/);
  assert.match(P.outlineDropProblem(items, { name: "Mapa", readonly: true }), /não recebe/);
  assert.match(P.outlineDropProblem(items, { name: "Luzes", accepts: false }), /não recebe/);
  assert.match(P.outlineDropProblem([{ layer: "x", movable: false }], { name: "Teto" }), /bloqueado/);
  assert.ok(P.outlineDropProblem([], { name: "Teto" }));
  assert.ok(P.outlineDropProblem(items, null));
});
