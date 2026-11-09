import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeInterface, toolsFor, TOOL_INVENTORY, TOOL_GROUPS, gridFor, filterMaps, groupMaps, acceptsMap, recentMapKeys,
  sceneStatus, pendingParts, hiddenCustomizations, placementProblem, simulateView, metersToCells, mapTypeLabel, VISIBILITY_OPTIONS,
} from "../apps/Eternnus.Web/wwwroot/js/scene-policy.js";
import { decodeBits } from "../apps/Eternnus.Web/wwwroot/js/fog-policy.js";

const root = new URL("../apps/Eternnus.Web/", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");

test("interface defaults to Básica and Completa keeps every basic tool in the same order", () => {
  assert.equal(normalizeInterface(null), "basic");
  assert.equal(normalizeInterface("anything"), "basic");
  assert.equal(normalizeInterface("complete"), "complete");
  for (const where of ["editor", "table"]) {
    const basic = toolsFor("basic", where).map((t) => t.id);
    const complete = toolsFor("complete", where).map((t) => t.id);
    assert.deepEqual(complete.filter((id) => basic.includes(id)), basic, where);
    assert.equal(complete.length, TOOL_INVENTORY.filter((t) => t.where.includes(where)).length);
  }
  for (const id of ["select", "add", "reveal", "conceal", "viewAs"]) assert.ok(toolsFor("basic", "table").some((t) => t.id === id), id);
  for (const id of ["select", "add", "scenery", "visibility", "text", "notes", "viewAs"]) assert.ok(toolsFor("basic", "editor").some((t) => t.id === id), id);
  const groups = new Set(TOOL_GROUPS.map(([k]) => k));
  assert.ok(TOOL_INVENTORY.every((t) => groups.has(t.group)));
});

test("inventory covers every live fog tool and every paint tool of the server contract", async () => {
  const fog = await read("wwwroot/js/fog-policy.js");
  const ids = [...fog.matchAll(/\{ id: "(\w+)", icon:/g)].map((m) => m[1]);
  assert.ok(ids.length >= 10);
  for (const id of ids) assert.ok(TOOL_INVENTORY.some((t) => t.id === id), `ferramenta ${id} sem lugar no inventário`);
  const server = await read("Application/SessionFog.cs");
  const tools = server.match(/Tools = \[([^\]]+)\]/)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
  for (const id of tools) assert.ok(TOOL_INVENTORY.some((t) => t.id === id), id);
});

test("grid math matches the authoritative server grid (CampaignMapView.Grid)", () => {
  assert.deepEqual([gridFor(640, 640, 64).width, gridFor(640, 640, 64).height], [10, 10]);
  assert.equal(gridFor(640, 640, 64, 10, 0).width, 9);
  assert.equal(gridFor(640, 640, 64, 0, 63).height, 9);
  assert.equal(gridFor(1000, 700, 50, 25, 0).width, 19);
  assert.equal(gridFor(1000, 700, 50, 25, 0).height, 14);
  assert.equal(gridFor(640, 640, 64, 64, 0).valid, false);
  assert.equal(gridFor(640, 640, 64, -1, 0).valid, false);
  assert.equal(gridFor(4096, 4096, 8).valid, false); // 512 × 512 casas
  assert.equal(gridFor(64, 64, 64, 1, 0).valid, false);
  assert.equal(gridFor(100, 100, 200).valid, false);
});

test("map picker groups, filters without accents and never hides the selection", () => {
  const maps = [
    { key: "crypt", kind: "tileset", name: "Cripta", description: "Salão subterrâneo", rows: ["...."] },
    { key: "valley", kind: "cartographic", name: "Vale Dourado", description: "Vista do castelo" },
    { key: "asset:1", kind: "tileset", name: "Ponte", description: "Grade", folderId: "f1" },
    { key: "asset:2", kind: "cartographic", name: "Retrato", description: "Imagem" },
  ];
  assert.deepEqual(filterMaps(maps, { query: "salao" }).map((m) => m.key), ["crypt"]);
  assert.deepEqual(filterMaps(maps, { query: "xyz", selected: "valley" }).map((m) => m.key), ["valley"]);
  assert.deepEqual(filterMaps(maps, { type: "grid" }).map((m) => m.key), ["crypt", "asset:1"]);
  assert.deepEqual(filterMaps(maps, { folderId: "f1" }).map((m) => m.key), ["asset:1"]);
  const groups = groupMaps(maps, ["asset:2", "missing"]);
  assert.deepEqual(groups.map(([k]) => k), ["recent", "ready", "campaign"]);
  assert.deepEqual(groups[0][2].map((m) => m.key), ["asset:2"]);
  assert.ok(acceptsMap("map", maps[0]) && !acceptsMap("map", maps[1]));
  assert.ok(acceptsMap("image", maps[2]) && acceptsMap("image", maps[1]) && !acceptsMap("image", maps[0]));
  assert.match(mapTypeLabel(maps[2]), /com grade/);
  assert.match(mapTypeLabel(maps[3]), /sem grade/);
  assert.deepEqual(recentMapKeys([{ mapKey: "a", updatedAt: "2026-01-01" }, { mapKey: "b", updatedAt: "2026-02-01" }, { mapKey: "" }], "c"), ["c", "b", "a"]);
});

test("scene states, pending parts and hidden customizations are described in text", () => {
  assert.equal(sceneStatus({ id: "1" }, "1").label, "Em apresentação");
  assert.equal(sceneStatus({ id: "2", hasSaved: true }, "1").actionLabel, "Retomar cena");
  assert.equal(sceneStatus({ id: "3" }, "1").actionLabel, "Apresentar cena");
  assert.deepEqual(pendingParts({ text: true, layer: true }).map(([k]) => k), ["text", "layer"]);
  assert.deepEqual(pendingParts({}), []);
  const hidden = hiddenCustomizations({ layer: { marks: [{}], lights: [{}, {}], fog: true }, scene: { layerMode: "scene" }, tokens: [{ light: 3 }, { characterId: "x", light: 2 }, { dc: 12 }] });
  assert.equal(hidden.length, 6);
  assert.deepEqual(hiddenCustomizations({}), []);
  assert.deepEqual(VISIBILITY_OPTIONS.map(([v]) => v), ["", "all", "manual", "character"]);
});

test("placement pre-check mirrors the server arrangement validation", () => {
  const cells = ["..#", ".m.", "d.."];
  const tokens = [{ x: 0, y: 0 }];
  assert.equal(placementProblem(cells, 3, 3, tokens, 1, 0), "");
  assert.match(placementProblem(cells, 3, 3, tokens, 2, 0), /bloqueia/);
  assert.match(placementProblem(cells, 3, 3, tokens, 1, 1), /bloqueia/);
  assert.match(placementProblem(cells, 3, 3, tokens, 0, 2), /bloqueia/);
  assert.match(placementProblem(cells, 3, 3, tokens, 0, 0), /Já há/);
  assert.equal(placementProblem(cells, 3, 3, tokens, 0, 0, 0), "");
  assert.match(placementProblem(cells, 3, 3, tokens, 3, 0), /dentro/);
  assert.match(placementProblem(cells, 3, 3, Array.from({ length: 60 }, (_, i) => ({ x: 100 + i, y: 0 })), 1, 0), /60/);
});

test("simulation mirrors server visibility: shared light, character vision and token filtering", () => {
  const layer = { revealed: "", cells: ["..#.."], lights: [], fog: true };
  const tokens = [
    { characterId: "c1", label: "Aria", side: "ally", x: 0, y: 0, hidden: false, light: null },
    { characterId: null, label: "Lobo", side: "enemy", x: 4, y: 0, hidden: false, light: null },
    { characterId: null, label: "Guia", side: "ally", x: 3, y: 0, hidden: false, light: null },
    { characterId: null, label: "Espião", side: "enemy", x: 1, y: 0, hidden: true, light: null },
  ];
  const characters = [{ id: "c1", name: "Aria", lightMeters: 0, visionMeters: 6 }];
  const settings = { playerLightMeters: 0, creatureLight: 0, alliesAlwaysVisible: true };
  const seen = (r) => [...decodeBits(r.fog.visible, 5)].map(Number).join("");
  const base = { visionMode: "", layer, width: 5, height: 1, tokens, characters, settings, scale: 1.5 };
  assert.equal(metersToCells(6, 1.5), 4);
  assert.equal(metersToCells(1000, 1.5), 30);
  const group = simulateView(base);
  assert.equal(seen(group), "00000");
  assert.deepEqual(group.tokens.map((t) => t.label), ["Aria", "Guia"]);
  const aria = simulateView({ ...base, viewer: "c1" });
  assert.equal(seen(aria), "11100", "a parede bloqueia a visão além dela");
  assert.ok(!aria.tokens.some((t) => t.label === "Lobo" || t.label === "Espião"));
  const lit = simulateView({ ...base, layer: { ...layer, lights: [{ x: 4, y: 0, radius: 1 }] } });
  assert.equal(seen(lit), "00011");
  assert.ok(lit.tokens.some((t) => t.label === "Lobo"));
  const manual = simulateView({ ...base, visionMode: "manual", viewer: "c1", layer: { ...layer, revealed: "EA==" } });
  assert.equal(seen(manual), "00001", "revelação manual: luz e visão não revelam");
  const all = simulateView({ ...base, visionMode: "all" });
  assert.equal(all.fog.active, false);
  assert.equal(all.tokens.length, 3);
});

test("new scene modules are public shell files and the service worker version moved", async () => {
  const pwa = await read("wwwroot/js/pwa-policy.js");
  for (const m of ["scene-policy", "scene-editor", "interface-mode", "grid-adjust", "table-scenes", "map-picker"]) assert.match(pwa, new RegExp(`"${m}"`));
  const sw = await read("wwwroot/service-worker.js");
  assert.doesNotMatch(sw, /shell-v2[0-3]"/);
});

test("the old parallel editors are gone: one scene editor, layer editor delegates to it", async () => {
  const fog = await read("wwwroot/js/fog-editor.js");
  assert.match(fog, /openSceneEditor/);
  assert.doesNotMatch(fog, /createBoard/);
  const prep = await read("wwwroot/js/campaign-prep.js");
  assert.doesNotMatch(prep, /function sceneModal/);
  const tools = await read("wwwroot/js/table-tools.js");
  assert.doesNotMatch(tools, /export async function openScenes/);
  const editor = await read("wwwroot/js/scene-editor.js");
  assert.match(editor, /tool = "select"/); // começa em Selecionar e mover, nunca pintando
});
