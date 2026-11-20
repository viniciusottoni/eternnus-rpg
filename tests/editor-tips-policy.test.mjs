import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// Módulos puros carregados por data: URL (mesmo padrão dos demais testes de política).
const load = async (path) => import("data:text/javascript;base64," + Buffer.from(await readFile(new URL(`../apps/Eternnus.Web/wwwroot/js/${path}`, import.meta.url), "utf8")).toString("base64"));
const P = await load("editor-tips-policy.js");
const comum = (await load("editor-tips/comum.js")).TIPS;
const cena = (await load("editor-tips/cena.js")).TIPS;
const imagem = (await load("editor-tips/imagem.js")).TIPS;
const all = [...comum, ...cena, ...imagem];

// Ferramentas existentes em cada editor (scene-editor.js e image-map-editor.js). Uma dica só cita ferramenta real.
const SCENE_TOOLS = new Set(["select", "addImage", "add", "entry", "scenery", "visibility", "reveal", "conceal", "text", "notes", "hand", "zoom", "npc", "wall", "blockMove", "blockLight", "door", "toggleDoor", "erase", "vwall", "vedit", "light", "fogState", "diagnostic", "mark", "resetExploration", "gridToggle", "gridAdjust", "sceneSettings", "mapInstance"]);
const IMAGE_TOOLS = new Set(["select", "hand", "zoom", "crop", "text", "rect", "ellipse", "image", "grid"]);
const COMMON_TOOLS = new Set([...SCENE_TOOLS].filter((t) => IMAGE_TOOLS.has(t)));
const SCENE_CONTEXTS = new Set(["*", "compose", "elements", "walls", "light", "explore", "scene"]);
const IMAGE_CONTEXTS = new Set(["*", "elements", "scene"]);

test("catalog has hundreds of valid tips with unique stable ids", () => {
  assert.ok(all.length >= 300, `esperava ao menos 300 dicas, há ${all.length}`);
  for (const t of all) assert.equal(P.tipProblem(t), null, P.tipProblem(t));
  const ids = all.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos");
  assert.ok(comum.every((t) => t.id.startsWith("g-")) && cena.every((t) => t.id.startsWith("c-")) && imagem.every((t) => t.id.startsWith("i-")));
  assert.ok(all.every((t) => Object.isFrozen(t)));
});

test("tips only cite tools and contexts that exist in their editor", () => {
  for (const t of comum) { assert.ok(!t.tool || COMMON_TOOLS.has(t.tool), `${t.id}: ${t.tool}`); assert.equal(t.ctx, "*", t.id); }
  for (const t of cena) { assert.ok(!t.tool || SCENE_TOOLS.has(t.tool), `${t.id}: ${t.tool}`); assert.ok(SCENE_CONTEXTS.has(t.ctx), t.id); }
  for (const t of imagem) { assert.ok(!t.tool || IMAGE_TOOLS.has(t.tool), `${t.id}: ${t.tool}`); assert.ok(IMAGE_CONTEXTS.has(t.ctx), t.id); }
});

test("every editor, context and level has tips to show", () => {
  const level = (editor, ctx, mode, lvl) => P.eligibleTips(all.filter((t) => (editor === "image" ? !t.id.startsWith("c-") : !t.id.startsWith("i-"))), { editor, context: ctx, mode, level: lvl });
  for (const ctx of ["compose", "elements", "walls", "light", "explore", "scene"]) {
    assert.ok(level("scene", ctx, "complete", 3).filter((t) => t.ctx === ctx).length >= 15, `cena/${ctx}`);
    assert.ok(level("scene", ctx, "complete", 1).filter((t) => t.ctx === ctx).length >= 3, `cena/${ctx} nível 1`);
  }
  for (const ctx of ["elements", "scene"]) assert.ok(level("image", ctx, "complete", 3).filter((t) => t.ctx === ctx).length >= 15, `imagem/${ctx}`);
  assert.ok(level("map-prep", "walls", "complete", 3).length > level("map-prep", "walls", "complete", 1).length);
});

test("familiarity grows with varied use, not with repeating one action", () => {
  let s = P.normalizeTipState(null);
  assert.equal(P.familiarityLevel(s), 1);
  for (let i = 0; i < 500; i++) s = P.recordTipSignal(s, "tool", "select");
  assert.equal(P.familiarityLevel(s), 1, "repetir a mesma ferramenta não pula de nível");
  for (let i = 0; i < 6; i++) s = P.recordTipSignal(s, "open", "scene");
  for (const t of ["add", "wall", "light", "reveal", "notes"]) s = P.recordTipSignal(s, "tool", t);
  assert.equal(P.familiarityLevel(s), 2);
  for (let i = 0; i < 20; i++) s = P.recordTipSignal(s, "open", "image");
  for (const t of ["door", "vwall", "vedit", "mark", "fogState", "gridAdjust", "text", "crop", "rect", "entry", "npc", "diagnostic"]) s = P.recordTipSignal(s, "tool", t);
  for (const c of ["compose", "elements", "walls", "light", "explore", "scene"]) s = P.recordTipSignal(s, "context", c);
  assert.equal(P.familiarityLevel(s), 3);
  assert.ok(P.familiarityScore(P.normalizeTipState(null), "complete") > P.familiarityScore(P.normalizeTipState(null), "basic"));
});

test("stored state is sanitized and bounded", () => {
  const s = P.normalizeTipState({ opens: { scene: "3", evil: 9, image: -2 }, tools: { "<b>": 1, wall: 2.7 }, contexts: { "*": 4, walls: 1 }, seen: { "c-luz-foco": 1e12, "BAD ID": 1 }, recent: ["c-a1", "<x>", 5] });
  assert.deepEqual(s.opens, { scene: 3 });
  assert.deepEqual(s.tools, { wall: 2 });
  assert.deepEqual(s.contexts, { walls: 1 });
  assert.deepEqual(s.seen, { "c-luz-foco": 100000 });
  assert.deepEqual(s.recent, ["c-a1"]);
  for (const bad of [null, "x", [], 42]) assert.deepEqual(P.normalizeTipState(bad).tools, {});
  let big = P.normalizeTipState(null);
  for (let i = 0; i < 1000; i++) big = P.recordTipSignal(big, "seen", `g-x${i}`);
  assert.ok(Object.keys(big.seen).length <= 800);
  assert.equal(big.recent.length, 24);
  assert.equal(P.tipsStoreKey("abc-123"), "eternnus.editor.tips.abc-123");
  assert.equal(P.tipsStoreKey("../x"), "eternnus.editor.tips.anon");
});

test("eligibility respects editor, context, interface, level and tool availability", () => {
  const cat = [
    { id: "a-geral", level: 1, ctx: "*", text: "Geral." },
    { id: "a-parede", level: 1, ctx: "walls", text: "Parede.", tool: "wall" },
    { id: "a-completa", level: 1, ctx: "*", text: "Só na Completa.", ui: "complete" },
    { id: "a-basica", level: 1, ctx: "*", text: "Só na Básica.", ui: "basic" },
    { id: "a-avancada", level: 3, ctx: "*", text: "Avançada." },
    { id: "a-prep", level: 1, ctx: "*", text: "Só na preparação do mapa.", ed: ["map-prep"] },
    { id: "a-ruim", level: 1, ctx: "*", text: "<script>" },
  ];
  const ids = (o) => P.eligibleTips(cat, o).map((t) => t.id);
  assert.deepEqual(ids({ editor: "scene", context: "walls", mode: "basic", level: 1 }), ["a-geral", "a-parede", "a-basica"]);
  assert.deepEqual(ids({ editor: "scene", context: "light", mode: "complete", level: 3 }), ["a-geral", "a-completa", "a-avancada"]);
  assert.deepEqual(ids({ editor: "scene", context: "walls", mode: "complete", level: 1, toolReady: () => false }), ["a-geral", "a-completa"]);
  assert.ok(ids({ editor: "map-prep", context: "x", level: 1 }).includes("a-prep"));
  assert.match(P.tipProblem(cat[6]), /marcação/);
});

test("picking prefers unseen tips of the current context and avoids repeats", () => {
  const cat = [
    { id: "p-geral", level: 1, ctx: "*", text: "Geral." },
    { id: "p-luz", level: 1, ctx: "light", text: "Luz.", tool: "light" },
    { id: "p-luz2", level: 1, ctx: "light", text: "Luz 2." },
  ];
  const base = { editor: "scene", context: "light", mode: "basic" };
  // Sem nada visto e no nível 1: geral 8, contexto 12, contexto com ferramenta ainda não usada 24 (total 44).
  const w = cat.map((t) => P.tipWeight(t, { state: null, level: 1 }));
  assert.deepEqual(w, [8, 24, 12]);
  assert.equal(P.pickTip(cat, { ...base, random: () => 0.5 }).id, "p-luz");
  assert.equal(P.pickTip(cat, { ...base, random: () => 0.1 }).id, "p-geral");
  let s = P.recordTipSignal(P.recordTipSignal(null, "seen", "p-luz"), "seen", "p-luz2");
  assert.equal(P.pickTip(cat, { ...base, state: s, random: () => 0.99 }).id, "p-geral", "recentes ficam de fora enquanto houver alternativa");
  s = P.recordTipSignal(s, "seen", "p-geral");
  const again = P.pickTip(cat, { ...base, state: s, currentId: "p-geral", random: () => 0 });
  assert.notEqual(again.id, "p-geral", "nunca repete a dica atual quando há outra");
  assert.equal(P.pickTip([], base), null);
  assert.equal(P.pickTip(cat, { ...base, context: "walls" }).id, "p-geral");
});

test("a tool the master already masters is suggested less", () => {
  const tip = { id: "w-luz", level: 1, ctx: "light", text: "Luz.", tool: "light" };
  let s = P.normalizeTipState(null);
  const fresh = P.tipWeight(tip, { state: s, level: 1 });
  for (let i = 0; i < 8; i++) s = P.recordTipSignal(s, "tool", "light");
  assert.ok(P.tipWeight(tip, { state: s, level: 1 }) < fresh / 4);
});
