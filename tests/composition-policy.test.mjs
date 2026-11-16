import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/composition-policy.js", import.meta.url), "utf8");
const P = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const el = (over = {}) => P.normalizeElement({ id: "e1", layer: "elements", type: "rect", x: 0, y: 0, width: 100, height: 50, fill: "#ffffff", ...over });
const docWith = (elements, artboard = { width: 1000, height: 800 }) => ({ ...P.blankComposition(artboard.width, artboard.height), elements });

test("hit-testing respects rotation, ellipse shape, hidden and locked elements, and returns the topmost", () => {
  const r = el({ x: 0, y: 0, width: 200, height: 20 });
  assert.ok(P.pointInElement(r, 190, 10));
  r.rotation = 90; // centro (100,10); vira uma barra vertical de 20 × 200
  assert.equal(P.pointInElement(r, 190, 10), false);
  assert.ok(P.pointInElement(r, 100, 100));
  assert.ok(P.pointInElement(r, 100, -85));
  const e = el({ type: "ellipse", width: 100, height: 100 });
  assert.equal(P.pointInElement(e, 2, 2), false, "canto da caixa fica fora da elipse");
  assert.ok(P.pointInElement(e, 50, 50));
  const a = el({ id: "a" }), b = el({ id: "b" });
  const doc = docWith([a, b]);
  assert.equal(P.hitTest(doc, 10, 10).id, "b");
  b.locked = true;
  assert.equal(P.hitTest(doc, 10, 10).id, "a");
  assert.equal(P.hitTest(doc, 10, 10, { includeLocked: true }).id, "b");
  a.visible = false;
  assert.equal(P.hitTest(doc, 10, 10), null);
  // Camada acima vence mesmo se o elemento vier antes na lista.
  const top = el({ id: "top", layer: "base" });
  const d2 = docWith([el({ id: "upper" }), top]);
  assert.equal(P.hitTest(d2, 10, 10).id, "upper");
  d2.layers[1].locked = true;
  assert.equal(P.hitTest(d2, 10, 10).id, "top");
});

test("bounds of rotated elements and marquee intersection", () => {
  const r = el({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
  const b = P.elementBounds(r);
  near(b.width, Math.SQRT2 * 100); near(b.height, Math.SQRT2 * 100);
  near(b.x, 50 - (Math.SQRT2 * 100) / 2);
  // O canto da caixa alinhada toca a área, mas o losango não.
  assert.equal(P.rectIntersectsElement({ x: -20, y: -20, width: 15, height: 15 }, r), false);
  assert.ok(P.rectIntersectsElement({ x: 40, y: -20, width: 20, height: 15 }, r));
  const u = P.unionBounds([el({ x: 0, y: 0 }), el({ id: "b", x: 300, y: 200, width: 10, height: 10 })]);
  assert.deepEqual(u, { x: 0, y: 0, width: 310, height: 210 });
  const doc = docWith([el({ id: "a" }), el({ id: "b", x: 500, y: 500 })]);
  assert.deepEqual(P.elementsInRect(doc, { x: -5, y: -5, width: 20, height: 20 }).map((e) => e.id), ["a"]);
});

test("handle resize keeps the opposite side fixed, supports proportion (Shift) and center (Alt), also when rotated", () => {
  const start = el({ x: 100, y: 100, width: 200, height: 100 });
  assert.deepEqual(P.resizeFromHandle(start, "se", { x: 400, y: 260 }), { x: 100, y: 100, width: 300, height: 160 });
  assert.deepEqual(P.resizeFromHandle(start, "e", { x: 350, y: 999 }), { x: 100, y: 100, width: 250, height: 100 });
  assert.deepEqual(P.resizeFromHandle(start, "nw", { x: 50, y: 80 }), { x: 50, y: 80, width: 250, height: 120 });
  const ratio = P.resizeFromHandle(start, "se", { x: 500, y: 210 }, { keepRatio: true });
  near(ratio.width / ratio.height, 2); near(ratio.width, 400); near(ratio.x, 100); near(ratio.y, 100);
  const edge = P.resizeFromHandle(start, "e", { x: 500, y: 150 }, { keepRatio: true });
  near(edge.width, 400); near(edge.height, 200); near(edge.y + edge.height / 2, 150, 1e-6);
  const centered = P.resizeFromHandle(start, "e", { x: 350, y: 150 }, { fromCenter: true });
  near(centered.width, 300); near(centered.x + centered.width / 2, 200);
  const tiny = P.resizeFromHandle(start, "se", { x: 0, y: 0 });
  assert.equal(tiny.width, 1); assert.equal(tiny.height, 1);
  // Girado 90°: a alça "e" (local) aponta para baixo; arrastar para baixo aumenta a largura e o lado oposto fica parado.
  const rot = el({ x: 0, y: 0, width: 100, height: 40, rotation: 90 });
  const before = P.handlePoints(rot).w;
  const res = P.resizeFromHandle(rot, "e", { x: 50, y: 120 }); // alça "w" fica em y = −30
  near(res.width, 150); near(res.height, 40);
  const after = P.handlePoints({ ...rot, ...res }).w;
  near(after.x, before.x); near(after.y, before.y);
});

test("rotation from the handle, normalization and 15° snapping", () => {
  const start = el({ x: 0, y: 0, width: 100, height: 100 });
  near(P.pointerAngle({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
  near(P.rotateFromPointer(start, { x: 50, y: -50 }, { x: 150, y: 50 }), 90);
  assert.equal(P.rotateFromPointer(start, { x: 50, y: -50 }, { x: 150, y: 40 }, true), 90);
  assert.equal(P.snapAngle(22), 15);
  assert.equal(P.snapAngle(23), 30);
  assert.equal(P.normalizeRotation(270), -90);
  assert.equal(P.normalizeRotation(-190), 170);
  assert.equal(P.normalizeRotation(360), 0);
  assert.equal(P.handleAngle("e", 0), 0);
  assert.equal(P.handleAngle("s", 0), 90);
  assert.equal(P.handleAngle("e", 45), 45);
});

test("snapping to artboard edges/center and to the grid", () => {
  const opts = { artboard: { width: 1000, height: 800 }, grid: null, threshold: 6 };
  assert.deepEqual(P.snapMove({ x: 3, y: 100, width: 50, height: 50 }, opts), { dx: -3, dy: 0, guides: [{ axis: "x", at: 0 }] });
  const centered = P.snapMove({ x: 472, y: 372, width: 50, height: 50 }, opts);
  assert.equal(centered.dx, 3); assert.equal(centered.dy, 3);
  assert.deepEqual(P.snapMove({ x: 300, y: 300, width: 50, height: 50 }, opts), { dx: 0, dy: 0, guides: [] });
  const grid = { ...opts, grid: { size: 64, offsetX: 10, offsetY: 0 } };
  const g = P.snapMove({ x: 140, y: 300, width: 30, height: 30 }, grid);
  assert.equal(g.dx, -2); // 138 = 10 + 2 × 64
  const p = P.snapPoint({ x: 995, y: 402 }, opts);
  assert.equal(p.x, 1000); assert.equal(p.y, 400);
});

test("document resize: visible area with anchors, proportional content scale and crop", () => {
  assert.deepEqual(P.anchorOffset(1000, 800, 1200, 600, "tl"), { dx: 0, dy: 0 });
  assert.deepEqual(P.anchorOffset(1000, 800, 1200, 600, "c"), { dx: 100, dy: -100 });
  assert.deepEqual(P.anchorOffset(1000, 800, 1200, 600, "br"), { dx: 200, dy: -200 });
  assert.deepEqual(P.anchorOffset(1000, 800, 1200, 600, "r"), { dx: 200, dy: -100 });
  const doc = docWith([el({ x: 10, y: 20 })]);
  const resized = P.resizeArtboard(doc, 1200, 600, "br");
  assert.deepEqual(resized.doc.artboard, { width: 1200, height: 600, background: "#000000" });
  assert.equal(resized.doc.elements[0].x, 210); assert.equal(resized.doc.elements[0].y, -180);
  assert.equal(doc.elements[0].x, 10, "o original não muda");
  assert.equal(P.shiftGridOffset(10, 200, 64), 18);
  assert.equal(P.shiftGridOffset(10, -180, 64), 22);
  const text = P.normalizeElement({ id: "t", layer: "elements", type: "text", text: "Oi", x: 100, y: 100, width: 200, height: 60, fontSize: 40 });
  const scaled = P.scaleComposition(docWith([text, el({ x: 10, y: 20, width: 100, height: 50, strokeWidth: 4 })]), 500, 400);
  assert.deepEqual(scaled.doc.artboard, { width: 500, height: 400, background: "#000000" });
  assert.deepEqual([scaled.doc.elements[0].x, scaled.doc.elements[0].width, scaled.doc.elements[0].fontSize], [50, 100, 20]);
  assert.deepEqual([scaled.doc.elements[1].x, scaled.doc.elements[1].y, scaled.doc.elements[1].height, scaled.doc.elements[1].strokeWidth], [5, 10, 25, 2]);
  const cropped = P.cropComposition(doc, { x: 5, y: 15, width: 300, height: 200 });
  assert.deepEqual([cropped.doc.artboard.width, cropped.doc.artboard.height, cropped.doc.elements[0].x, cropped.doc.elements[0].y], [300, 200, 5, 5]);
  assert.equal(cropped.doc.elements.length, 1, "recortar não apaga elementos");
  assert.deepEqual(P.clampCropRect({ x: 1.4, y: 2, width: 10, height: 5000 }), { x: 1, y: 2, width: 64, height: 4096 });
  assert.equal(P.clampCropRect({ x: 0, y: 0, width: 4096, height: 4096 }).height, 1953);
});

test("z-order stays within the layer; align and distribute", () => {
  const doc = docWith(["a", "b", "c", "d"].map((id) => el({ id })));
  doc.elements.push(el({ id: "z", layer: "base" }));
  const ids = (list) => list.map((e) => e.id);
  assert.deepEqual(ids(P.reorder(doc, ["a"], "front")), ["z", "b", "c", "d", "a"]);
  assert.deepEqual(ids(P.reorder(doc, ["d"], "back")), ["z", "d", "a", "b", "c"]);
  assert.deepEqual(ids(P.reorder(doc, ["a", "b"], "forward")), ["z", "c", "a", "b", "d"]);
  assert.deepEqual(ids(P.reorder(doc, ["c"], "backward")), ["z", "a", "c", "b", "d"]);
  assert.deepEqual(ids(P.reorder(doc, ["d"], "forward")), ["z", "a", "b", "c", "d"]);
  const items = [el({ id: "a", x: 0, y: 0, width: 10, height: 10 }), el({ id: "b", x: 50, y: 30, width: 20, height: 20 })];
  const left = P.alignOffsets(items, "left", P.unionBounds(items));
  assert.deepEqual(left.get("b"), { dx: -50, dy: 0 });
  const bottom = P.alignOffsets(items, "bottom", P.unionBounds(items));
  assert.deepEqual(bottom.get("a"), { dx: 0, dy: 40 });
  const centered = P.alignOffsets([items[0]], "center", { x: 0, y: 0, width: 1000, height: 800 });
  assert.deepEqual(centered.get("a"), { dx: 495, dy: 0 });
  const row = [el({ id: "a", x: 0, width: 10 }), el({ id: "b", x: 15, width: 30 }), el({ id: "c", x: 100, width: 20 })];
  const dist = P.distributeOffsets(row, "x");
  assert.equal(dist.get("a").dx, 0); assert.equal(dist.get("c").dx, 0);
  assert.equal(dist.get("b").dx, 25); // espaços iguais de 40
  assert.equal(P.distributeOffsets(row.slice(0, 2), "x").size, 0);
  assert.deepEqual(P.fitToArtboard(el({ width: 200, height: 100, rotation: 30 }), { width: 1000, height: 800 }, "fit"), { x: 0, y: 150, width: 1000, height: 500, rotation: 0 });
  assert.deepEqual(P.fitToArtboard(el({ width: 200, height: 100 }), { width: 1000, height: 800 }, "fill"), { x: -300, y: 0, width: 1600, height: 800, rotation: 0 });
});

test("validation enforces the server limits with Portuguese messages", () => {
  const ok = docWith([el({ id: "img-1", type: "image", src: "self" })]);
  assert.equal(P.validateComposition(ok), null);
  const bad = (mutate) => { const d = JSON.parse(JSON.stringify(ok)); mutate(d); return P.validateComposition(d); };
  assert.match(bad((d) => { d.artboard.width = 63; }), /64 a 4\.096/);
  assert.match(bad((d) => { d.artboard.width = 4096; d.artboard.height = 4096; }), /8 milhões/);
  assert.equal(bad((d) => { d.artboard.width = 4096; d.artboard.height = 1953; }), null);
  assert.match(bad((d) => { d.elements[0].x = -16385; }), /área de trabalho/);
  assert.equal(bad((d) => { d.elements[0].x = 20480; }), null);
  assert.match(bad((d) => { d.elements[0].width = 0.5; }), /1 a 16\.384/);
  assert.match(bad((d) => { d.elements[0].width = 16385; }), /1 a 16\.384/);
  assert.match(bad((d) => { d.elements[0].id = "Maiúsculo"; }), /identificador/);
  assert.match(bad((d) => { d.elements.push({ ...d.elements[0] }); }), /identificador único/);
  assert.match(bad((d) => { d.elements[0].layer = "nada"; }), /camada inexistente/);
  assert.match(bad((d) => { d.elements[0].src = "https://x/y.png"; }), /origem válida/);
  assert.equal(bad((d) => { d.elements[0].src = "asset:0d6f7f4e-2b8c-4bb6-9a8e-111111111111"; }), null);
  assert.match(bad((d) => { d.elements = Array.from({ length: 201 }, (_, i) => ({ ...d.elements[0], id: `e-${i}` })); }), /200 elementos/);
  assert.match(bad((d) => { for (let i = 0; i < 7; i++) d.layers.push({ id: `c-${i}`, name: "C", kind: "custom", visible: true, locked: false, opacity: 100 }); }), /2 a 8 camadas/);
  assert.match(bad((d) => { d.layers.reverse(); }), /Base e Elementos/);
  assert.match(bad((d) => { d.elements[0] = P.normalizeElement({ id: "t", layer: "base", type: "text", text: "x".repeat(10) }); d.elements[0].text = "x".repeat(501); }), /500 caracteres/);
  assert.match(bad((d) => { d.elements[0] = P.normalizeElement({ id: "t", layer: "base", type: "text", text: "a" }); d.elements[0].fontSize = 5; }), /fonte/);
  assert.match(bad((d) => { d.elements[0] = el({ id: "r" }); d.elements[0].fill = "red"; }), /#rrggbb/);
  assert.match(bad((d) => { d.artboard.background = "#fff"; }), /#rrggbb/);
  assert.match(bad((d) => { d.v = 2; }), /versão/);
  // Dimensões do artboard e grade
  assert.match(P.artboardError(4096, 4096), /8 milhões/);
  assert.equal(P.artboardError(64, 64), null);
  assert.deepEqual(P.gridCount(2048, 1536, 64), { valid: true, columns: 32, rows: 24, message: "" });
  assert.deepEqual(P.gridCount(2048, 1536, 64, 10, 5), { valid: true, columns: 31, rows: 23, message: "" });
  assert.equal(P.gridCount(4096, 4096, 40).valid, false);
  assert.equal(P.gridCount(1000, 1000, 64, 64).valid, false);
});

test("serialization keeps only contract fields per type and normalization fills defaults", () => {
  const doc = docWith([
    P.normalizeElement({ id: "i", layer: "base", type: "image", src: "self", x: 0.123, y: 1, width: 10, height: 10, extra: 1 }),
    P.normalizeElement({ id: "t", layer: "elements", type: "text", text: "Olá" }),
    P.normalizeElement({ id: "r", layer: "elements", type: "rect", fill: "#ABCDEF" }),
  ]);
  const json = JSON.parse(P.serializeComposition(doc));
  assert.deepEqual(Object.keys(json), ["v", "artboard", "layers", "elements"]);
  assert.equal(json.elements[0].src, "self");
  assert.equal(json.elements[0].x, 0.12);
  assert.equal("extra" in json.elements[0], false);
  assert.equal("text" in json.elements[0], false);
  assert.equal("src" in json.elements[1], false);
  assert.deepEqual([json.elements[1].fontFamily, json.elements[1].color, json.elements[1].align, json.elements[1].fontSize], ["serif", "#ffffff", "left", 48]);
  assert.equal(json.elements[2].fill, "#abcdef");
  assert.equal(json.elements[2].stroke, null);
  // Documento do servidor sem campos nulos e com id fora do padrão local.
  const normalized = P.normalizeComposition({ v: 1, artboard: { width: 640, height: 480 }, layers: [{ id: "elements", name: "Objetos", kind: "elements" }], elements: [{ id: "Base_Image", layer: "sumiu", type: "image", src: "self", x: 0, y: 0, width: 640, height: 480 }] });
  assert.deepEqual(normalized.layers.map((l) => [l.id, l.name]), [["base", "Base"], ["elements", "Objetos"]]);
  assert.equal(normalized.elements[0].layer, "elements");
  assert.match(normalized.elements[0].id, /^[a-z0-9-]{1,24}$/);
  assert.equal(normalized.artboard.background, "#000000");
  assert.equal(P.validateComposition(normalized), null);
  const copies = P.cloneElements([doc.elements[2]], doc.elements, 16, 16);
  assert.notEqual(copies[0].id, "r");
  assert.equal(copies[0].x, 16);
});

test("artboard classification: inside, partially outside and fully outside", () => {
  const ab = { width: 1000, height: 800 };
  assert.equal(P.artboardStatus(el({ x: 10, y: 10 }), ab), "inside");
  assert.equal(P.artboardStatus(el({ x: 0, y: 0, width: 1000, height: 800 }), ab), "inside");
  assert.equal(P.artboardStatus(el({ x: -50, y: 10 }), ab), "partial");
  assert.equal(P.artboardStatus(el({ x: -300, y: -120, width: 2800, height: 2100 }), ab), "partial");
  assert.equal(P.artboardStatus(el({ x: -200, y: 10 }), ab), "outside");
  assert.equal(P.artboardStatus(el({ x: -100, y: 10 }), ab), "outside", "encostar na borda não conta");
  // Girado: a caixa alinhada tocaria a área, mas o elemento não.
  assert.equal(P.artboardStatus(el({ x: -95, y: -95, width: 100, height: 100, rotation: 45 }), ab), "outside");
  assert.equal(P.artboardStatus(el({ x: 960, y: 10, width: 100, height: 20, rotation: 0 }), ab), "partial");
});
