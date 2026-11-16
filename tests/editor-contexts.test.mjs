// ADR-086: contextos de trabalho, preferências de layout (editor-policy) e grupos/encaixe/transformação em conjunto (composition-policy).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const load = async (file) => import("data:text/javascript;base64," + Buffer.from(await readFile(new URL(`../apps/Eternnus.Web/wwwroot/js/${file}`, import.meta.url), "utf8")).toString("base64"));
const E = await load("editor-policy.js");
const C = await load("composition-policy.js");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("contexts keep catalog order, drop unknown ids and allow editor labels", () => {
  const list = E.normalizeContexts([{ id: "scene", label: "Documento" }, { id: "x" }, { id: "elements", groups: ["create"] }, { id: "elements" }]);
  assert.deepEqual(list.map((c) => c.id), ["elements", "scene"]);
  assert.equal(list[1].label, "Documento");
  assert.equal(list[0].label, "Elementos");
  assert.ok(list[0].groups.has("create"));
  assert.equal(E.EDITOR_CONTEXTS.length, 7);
  assert.equal(E.EDITOR_CONTEXTS[0].id, "compose", "Composição (ADR-090) vem primeiro: fundo e imagens antes de personagens");
  assert.ok(Object.isFrozen(E.EDITOR_CONTEXTS));
});

test("tools appear by own context, by group or tool list, common tools everywhere and undeclared tools always", () => {
  const contexts = E.normalizeContexts([
    { id: "elements", tools: ["add"], groups: ["create"] },
    { id: "walls", groups: ["walls"] },
  ]);
  const common = ["select", "hand"];
  const wall = { id: "wall", group: "walls" }, add = { id: "add", group: "basic" }, text = { id: "text", group: "create" };
  const select = { id: "select", group: "basic" }, orphan = { id: "grid", group: "view" }, explicit = { id: "x", group: "walls", context: ["elements"] };
  assert.equal(E.toolInContext(wall, "walls", contexts, common), true);
  assert.equal(E.toolInContext(wall, "elements", contexts, common), false);
  assert.equal(E.toolInContext(add, "elements", contexts, common), true);
  assert.equal(E.toolInContext(text, "walls", contexts, common), false);
  assert.equal(E.toolInContext(select, "walls", contexts, common), true);
  assert.equal(E.toolInContext(orphan, "walls", contexts, common), true, "sem contexto declarado: nunca fica inalcançável");
  assert.equal(E.toolInContext(explicit, "walls", contexts, common), false, "o contexto próprio da ferramenta vence o grupo");
  assert.equal(E.toolInContext({ id: "y", context: "*" }, "walls", contexts), true);
  assert.equal(E.toolInContext(wall, "walls", [], common), true, "sem contextos, tudo aparece");
});

test("panels follow the same rules and contexts without visible own tools are hidden", () => {
  const contexts = E.normalizeContexts([
    { id: "elements", groups: ["edit"], panels: ["layers"] },
    { id: "walls", groups: ["walls"] },
    { id: "light", groups: ["light"] },
  ]);
  assert.equal(E.panelInContext({ id: "layers" }, "walls", contexts), false);
  assert.equal(E.panelInContext({ id: "history" }, "walls", contexts), true);
  const tools = [{ id: "select", group: "edit" }, { id: "wall", group: "walls", basic: false }, { id: "light", group: "light", hidden: true }];
  const basicVisible = (t) => t.basic !== false && !t.hidden;
  assert.deepEqual(E.availableContexts(contexts, tools, basicVisible, []).map((c) => c.id), ["elements"]);
  const completeVisible = (t) => !t.hidden;
  assert.deepEqual(E.availableContexts(contexts, tools, completeVisible, []).map((c) => c.id), ["elements", "walls"]);
});

test("switching context keeps the current tool when visible, else default, else first usable", () => {
  const cands = [{ id: "toggle", action: () => {} }, { id: "wall" }, { id: "door" }];
  assert.equal(E.toolAfterContext("door", cands, "wall"), "door");
  assert.equal(E.toolAfterContext("brush", cands, "wall"), "wall");
  assert.equal(E.toolAfterContext("brush", cands, "missing"), "wall");
  assert.equal(E.toolAfterContext("brush", [{ id: "a", action: () => {} }]), "brush");
});

test("Alt+digit picks contexts by physical key and never with Ctrl, Shift or plain digits", () => {
  assert.equal(E.contextShortcutIndex({ altKey: true, code: "Digit3", key: "£" }), 2);
  assert.equal(E.contextShortcutIndex({ altKey: true, key: "1" }), 0);
  assert.equal(E.contextShortcutIndex({ altKey: true, ctrlKey: true, code: "Digit1" }), -1);
  assert.equal(E.contextShortcutIndex({ altKey: true, shiftKey: true, code: "Digit1" }), -1);
  assert.equal(E.contextShortcutIndex({ code: "Digit1", key: "1" }), -1);
  assert.equal(E.contextShortcutIndex({ altKey: true, code: "Digit0", key: "0" }), -1);
});

test("layout preferences are per user, typed and bounded; invalid values fall back", () => {
  assert.equal(E.layoutPrefKey("abc-123"), "eternnus.editor.layout.abc-123");
  assert.equal(E.layoutPrefKey(""), "eternnus.editor.layout");
  assert.equal(E.layoutPrefKey("a b<script>"), "eternnus.editor.layout");
  const p = E.normalizeLayoutPref({ width: 9999, closed: ["history", "history", "<x>"], rulers: false, bar: "middle",
    contexts: { scene: "walls", tiles: "nope", "Bad Kind": "elements" }, order: { scene: ["props", "props", "layers"], image: "x" }, extra: 1 });
  assert.deepEqual(p, { width: 520, closed: ["history"], rulers: false, contexts: { scene: "walls" }, order: { scene: ["props", "layers"] } });
  assert.deepEqual(E.normalizeLayoutPref(null), {});
  assert.deepEqual(E.normalizeLayoutPref([1]), {});
  assert.equal(E.normalizeLayoutPref({ width: 10 }).width, 220);
  assert.equal(E.normalizeLayoutPref({ bar: "bottom" }).bar, "bottom");
});

test("panel order keeps saved order for known panels and appends new ones; moving is bounded", () => {
  assert.deepEqual(E.panelOrder(["a", "b", "c"], ["c", "x", "a"]), ["c", "a", "b"]);
  assert.deepEqual(E.panelOrder(["a", "b"], undefined), ["a", "b"]);
  assert.deepEqual(E.movePanel(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(E.movePanel(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(E.movePanel(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});

const el = (over = {}) => C.normalizeElement({ id: "e1", layer: "elements", type: "rect", x: 0, y: 0, width: 100, height: 50, fill: "#ffffff", ...over });
const docWith = (elements) => ({ ...C.blankComposition(1000, 800), elements });

test("group field is optional, round-trips through serialize and is validated", () => {
  const plain = el();
  assert.equal("group" in plain, false);
  assert.equal(JSON.parse(C.serializeComposition(docWith([plain]))).elements[0].group, undefined, "documentos antigos não ganham campo novo");
  const grouped = el({ group: "grupo-1" });
  assert.equal(grouped.group, "grupo-1");
  assert.equal(JSON.parse(C.serializeComposition(docWith([grouped]))).elements[0].group, "grupo-1");
  assert.equal(el({ group: "Bad Group!" }).group, undefined);
  assert.equal(C.validateComposition(docWith([grouped])), null);
  assert.match(C.validateComposition(docWith([{ ...grouped, group: "X Y" }])), /Grupo inválido/);
});

test("groups expand selection, require two elements in the same layer and get unique ids", () => {
  const doc = docWith([el({ id: "a", group: "grupo-1" }), el({ id: "b", group: "grupo-1" }), el({ id: "c" }), el({ id: "d", group: "grupo-1", visible: false })]);
  assert.deepEqual(C.expandGroups(doc, ["a"]).sort(), ["a", "b"]);
  assert.deepEqual(C.expandGroups(doc, ["c"]), ["c"]);
  assert.equal(C.newGroupId(doc.elements), "grupo-2");
  assert.match(C.planGroup(doc, ["c"]).error, /dois ou mais/);
  const layered = docWith([el({ id: "a" }), el({ id: "b", layer: "base" })]);
  assert.match(C.planGroup(layered, ["a", "b"]).error, /mesma camada/);
  assert.deepEqual(C.planGroup(doc, ["a", "c"]), { group: "grupo-2", ids: ["a", "c"] });
  const copies = C.regroupCopies([{ id: "x", group: "grupo-1" }, { id: "y", group: "grupo-1" }, { id: "z" }], doc.elements);
  assert.deepEqual(copies.map((c) => c.group), ["grupo-2", "grupo-2", undefined], "cópias formam um grupo novo, separado do original");
});

test("magnetic guides snap moving bounds to other elements' edges and centers", () => {
  const doc = docWith([el({ id: "a", x: 300, y: 300, width: 100, height: 100 }), el({ id: "b", x: 0, y: 0, width: 50, height: 50 }), el({ id: "h", x: 700, y: 700, visible: false })]);
  const lines = C.snapLines(doc, new Set(["b"]));
  assert.ok(lines.x.includes(300) && lines.x.includes(350) && lines.x.includes(400));
  assert.ok(!lines.x.includes(700), "ocultos não viram guia");
  const s = C.snapMove({ x: 296, y: 120, width: 50, height: 50 }, { artboard: doc.artboard, grid: null, lines, threshold: 6 });
  assert.equal(s.dx, 4);
  assert.deepEqual(s.guides.find((g) => g.axis === "x"), { axis: "x", at: 300 });
  const none = C.snapMove({ x: 296, y: 120, width: 50, height: 50 }, { artboard: doc.artboard, grid: null, threshold: 6 });
  assert.equal(none.dx, 0, "sem linhas, só artboard e grade");
});

test("group scale moves centers and sizes with the bounds; rotated elements keep proportions", () => {
  const a = el({ id: "a", x: 0, y: 0, width: 100, height: 100 }), b = el({ id: "b", x: 100, y: 100, width: 100, height: 100 });
  const from = C.unionBounds([a, b]);
  const r = C.scaleGroup([a, b], from, { x: 0, y: 0, width: 400, height: 200 });
  assert.deepEqual(r.get("a"), { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(r.get("b"), { x: 200, y: 100, width: 200, height: 100 });
  const turned = el({ id: "t", x: 0, y: 0, width: 100, height: 50, rotation: 90 });
  const t = C.scaleGroup([turned], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 100 }).get("t");
  assert.equal(t.width, 100); assert.equal(t.height, 100, "90° troca os eixos");
  const skew = el({ id: "s", width: 100, height: 50, rotation: 30 });
  const s = C.scaleGroup([skew], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 400, height: 100 }).get("s");
  near(s.width / s.height, 2, 1e-2);
  assert.equal(C.scaleGroup([a], { x: 0, y: 0, width: 0, height: 10 }, from).size, 0);
});

test("group rotation turns centers around the pivot and adds the angle", () => {
  const a = el({ id: "a", x: 90, y: -10, width: 20, height: 20, rotation: 10 });
  const r = C.rotateGroup([a], { x: 0, y: 0 }, 90).get("a");
  near(r.x + 10, 0, 1e-6); near(r.y + 10, 100, 1e-6);
  assert.equal(r.rotation, 100);
  const p = C.boundsHandlePoints({ x: 0, y: 0, width: 100, height: 40 }, 10);
  assert.deepEqual([p.se.x, p.se.y], [100, 40]);
  near(p.rotate.y, -10);
});
