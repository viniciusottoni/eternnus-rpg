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

// ---------- Personagens reservados, tamanhos predefinidos e Acervo rápido (ADR-110) ----------
const SP = await import("../apps/Eternnus.Web/wwwroot/js/scene-policy.js");
const TL = await import("../apps/Eternnus.Web/wwwroot/js/token-look.js");

test("reservado vira marcador aliado com o vínculo, aparece uma vez por cena e recebe nomes livres", () => {
  const slot = { id: "s1", name: "Guerreiro de nome muito comprido que passa do limite", archetype: "warrior", appearance: null, size: 150, width: null, height: null };
  const t = SP.slotToken(slot, "extra");
  assert.equal(t.slotId, "s1");
  assert.equal(t.side, "ally");
  assert.equal(t.label.length, 40);
  assert.equal(t.size, 150);
  assert.equal(t.imageUrl, null, "a imagem vem do reservado, sem copiar");
  assert.equal(t.layer, "extra");
  const tokens = [{ x: 0, y: 0, label: "A" }, { ...t, x: 2, y: 0 }];
  assert.equal(SP.slotIndex(tokens, "s1"), 1);
  assert.equal(SP.slotIndex(tokens, "outro"), -1);
  // Colar/duplicar não cria um segundo token do mesmo reservado.
  const { placed, skipped } = pastePlacement({ cells, width: 4, height: 3, tokens, items: clipboardFrom(tokens, [1]), anchor: { x: 0, y: 2 } });
  assert.equal(placed.length, 0);
  assert.equal(skipped, 1);
  assert.equal(SP.nextSlotName([], "Personagem", true), "Personagem 1");
  assert.equal(SP.nextSlotName(["Personagem 1"], "Personagem", true), "Personagem 2");
  assert.equal(SP.nextSlotName([], "Guerreiro"), "Guerreiro");
  assert.equal(SP.nextSlotName(["guerreiro", "Guerreiro 2"], "Guerreiro"), "Guerreiro 3");
  assert.equal(SP.MAX_SLOTS, 12);
});

test("arquétipos são desenhos próprios (caminho SVG simples) com identificadores do servidor", () => {
  assert.deepEqual(TL.ARCHETYPES.map((a) => a.id), ["warrior", "mage", "archer", "cleric", "rogue"]);
  for (const a of TL.ARCHETYPES) assert.match(a.path, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/, a.id);
  assert.equal(TL.archetypeOf("mage").label, "Mago");
  assert.equal(TL.archetypeOf("<script>"), null);
});

test("tamanhos predefinidos seguem TokenSpan: área inteira só com imagem; redondo maior ocupa uma casa", () => {
  assert.deepEqual(SP.SIZE_PRESETS.map((p) => p.label), ["Pequeno", "Médio", "Grande", "Enorme", "Imenso"]);
  assert.deepEqual(SP.sizePresetPatch("small"), { appearance: null, size: 75, width: null, height: null });
  assert.deepEqual(SP.sizePresetPatch("medium", { image: true, appearance: "image" }), { appearance: "image", size: null, width: null, height: null });
  assert.deepEqual(SP.sizePresetPatch("large", { image: true }), { appearance: "image", size: null, width: 200, height: 200 });
  assert.deepEqual(SP.sizePresetPatch("gargantuan", { image: false }), { appearance: null, size: 400, width: null, height: null });
  assert.equal(SP.sizePresetPatch("nada"), null);
  const big = { x: 0, y: 0, ...SP.sizePresetPatch("huge", { image: true }) };
  assert.deepEqual(TL.tokenSpan(big), { w: 3, h: 3 });
  assert.equal(SP.sizePresetOf(big), "huge");
  assert.equal(SP.sizePresetOf({ size: null }), "medium");
  assert.equal(SP.sizePresetOf({ size: 75 }), "small");
  assert.equal(SP.sizePresetOf({ size: 130 }), "");
  // Validação igual a soltar: 3 × 3 não cabe em 4 × 3 com a casa (1,0) bloqueada.
  assert.ok(SP.placementProblem(cells, 4, 3, [], 0, 0, -1, false, TL.tokenSpan(big)));
  assert.equal(TL.sizeReadout({ appearance: "image", width: 200, height: 200 }, false), "2 × 2 casas · 200%");
  assert.equal(TL.sizeReadout({ appearance: "image", width: 300, height: 200 }, false), "3 × 2 casas · 300% × 200%");
  assert.equal(TL.sizeReadout({ appearance: "image", width: 150, height: 200 }, true), "150% × 200%");
  assert.equal(TL.sizeReadout({ size: 75 }, false), "75% da casa");
});

test("Acervo rápido filtra por categoria e busca, só com referências seguras e sem cópias de encontro", () => {
  const G = "0b5e6f2a-1111-4c2d-9e8f-123456789abc", H = "1c6f7a3b-2222-4d3e-8f90-23456789abcd";
  const data = {
    characters: [{ id: "c1", name: "Aria" }],
    slots: [{ id: "s1", name: "Guerreiro", archetype: "warrior" }, { id: "s2", name: "Maga", characterId: "c1", characterName: "Aria" }],
    npcs: [{ id: "n1", name: "Lobo cinzento" }, { id: "n2", name: "Lobo (cópia)", copy: true }],
    maps: [
      { id: "m1", key: `asset:${G}`, name: "Ponte", kind: "tileset", hasGrid: true, imageUrl: "/x.png", pixelWidth: 640, pixelHeight: 480 },
      { id: "m2", key: `asset:${H}`, name: "Retrato da rainha", kind: "cartographic", imageUrl: "/y.png" },
      { id: "m3", key: "official:castelo", name: "Castelo", kind: "tileset", imageUrl: "/z.png" },
    ],
    prefs: { favorites: ["map:m2", "character:n1", "character:n2"], recents: [{ key: "map:m1", at: 2 }, { key: "scene:x", at: 1 }] },
  };
  const names = (cat, q = "") => SP.quickAssetItems(data, cat, q).map((x) => x.name);
  assert.deepEqual(SP.QUICK_CATEGORIES.map(([id]) => id), ["recent", "favorites", "party", "reserved", "npcs", "maps", "images"]);
  assert.deepEqual(names("party"), ["Aria", "Guerreiro", "Maga"]);
  assert.deepEqual(names("reserved"), ["Guerreiro", "Maga"]);
  assert.equal(SP.quickAssetItems(data, "reserved")[1].sub, "Vinculado a Aria");
  assert.deepEqual(names("npcs"), ["Lobo cinzento"]);
  assert.deepEqual(names("maps"), ["Ponte"]);
  assert.deepEqual(names("images"), ["Retrato da rainha"]);
  assert.deepEqual(names("favorites"), ["Retrato da rainha", "Lobo cinzento"]);
  assert.deepEqual(names("recent"), ["Ponte"]);
  assert.deepEqual(names("party", "guerr"), ["Guerreiro"]);
  assert.deepEqual(names("npcs", "LÔBO"), ["Lobo cinzento"]);
  const map = SP.quickAssetItems(data, "maps")[0];
  assert.deepEqual(map.asset, { src: `asset:${G}`, name: "Ponte", width: 640, height: 480 });
  assert.equal(SP.quickAssetItems(data, "party")[1].ref, "slot:s1");
  assert.deepEqual(SP.quickAssetItems({}, "recent"), []);
});
