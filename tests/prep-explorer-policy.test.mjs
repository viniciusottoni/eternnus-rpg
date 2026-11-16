import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/prep-explorer-policy.js", import.meta.url), "utf8");
const P = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

const data = {
  folders: [
    { id: "f1", name: "Masmorras", parentId: null, category: "maps" },
    { id: "f2", name: "Andar 1", parentId: "f1", category: "maps" },
    { id: "f3", name: "Ato I", parentId: null, category: "scenes" },
    { id: "f4", name: "Aliados", parentId: null, category: "characters" },
    { id: "f5", name: "Éter", parentId: null, category: "maps" },
    { id: "f6", name: "Bosque", parentId: null, category: "maps" },
    { id: "fx", name: "Estranha", parentId: null, category: "outra" },
  ],
  scenes: [
    { id: "s1", name: "Emboscada", description: "na estrada", kind: "map", mapKey: "crypt", folderId: "f3", createdAt: "2026-01-02T10:00:00Z", updatedAt: "2026-03-01T10:00:00Z" },
    { id: "s2", name: "Abertura", kind: "text", folderId: null, createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-05T10:00:00Z" },
  ],
  maps: [
    { id: "m1", key: "asset:m1", name: "Cripta", isTileMap: true, kind: "tileset", rows: ["........", "........"], folderId: "f2", sourceKey: "crypt", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    { id: "m2", key: "asset:m2", name: "Ágora", summary: "praça central", kind: "tileset", hasGrid: true, pixelWidth: 1024, pixelHeight: 768, width: 16, height: 12, folderId: null, createdAt: "2026-01-10T00:00:00Z", updatedAt: "2026-01-11T00:00:00Z" },
    { id: "m3", key: "asset:m3", name: "Vista", kind: "cartographic", hasGrid: false, pixelWidth: 800, pixelHeight: 600, folderId: null },
    { id: "valley", key: "valley", name: "Vale Dourado", kind: "cartographic", imageUrl: "/assets/valley.webp" },
  ],
  characters: [{ id: "c1", name: "Lobo", kind: "creature", summary: "fera", folderId: "f4" }],
};

test("entries are normalized per category; official maps and unknown categories never become files", () => {
  const { folders, items } = P.toEntries(data);
  assert.equal(folders.length, 6);
  assert.ok(!folders.some((f) => f.id === "fx"));
  assert.deepEqual(items.map((e) => e.key).sort(), ["character:c1", "map:m1", "map:m2", "map:m3", "scene:s1", "scene:s2"]);
  const m2 = items.find((e) => e.id === "m2");
  assert.equal(m2.category, "maps");
  assert.equal(m2.description, "praça central");
  assert.equal(P.categoryOfType("character"), "characters");
  assert.equal(P.TYPE_OF_CATEGORY.scenes, "scene");
  assert.equal(P.isOfficialKey("valley"), true);
  assert.equal(P.isOfficialKey("asset:x"), false);
  assert.equal(P.isOfficialKey("resource:x"), false);
  assert.deepEqual(P.officialTemplates(data.maps).map((m) => m.key), ["valley"]);
});

test("tree is built per category with accent-insensitive alphabetical order", () => {
  const { folders } = P.toEntries(data);
  const tree = P.buildTree(folders, "maps");
  assert.deepEqual(tree.get("").map((f) => f.name), ["Bosque", "Éter", "Masmorras"]);
  assert.deepEqual(tree.get("f1").map((f) => f.id), ["f2"]);
  assert.equal(P.buildTree(folders, "scenes").get("").length, 1);
  assert.equal(P.buildTree(folders, "characters").get("f1"), undefined);
});

test("path, breadcrumbs, depth and descendants", () => {
  const { folders } = P.toEntries(data);
  assert.deepEqual(P.folderPathOf(folders, "f2").map((f) => f.id), ["f1", "f2"]);
  assert.deepEqual(P.breadcrumbs(folders, "maps", "f2").map((c) => c.name), ["Mapas", "Masmorras", "Andar 1"]);
  assert.deepEqual(P.breadcrumbs(folders, "scenes", null).map((c) => c.name), ["Cenas"]);
  assert.equal(P.locationLabel(folders, "maps", "f2"), "Mapas › Masmorras › Andar 1");
  assert.equal(P.folderDepth(folders, "f2"), 2);
  assert.equal(P.folderDepth(folders, null), 0);
  assert.equal(P.subtreeHeight(folders, "f1"), 2);
  assert.equal(P.isSelfOrDescendant(folders, "f1", "f2"), true);
  assert.equal(P.isSelfOrDescendant(folders, "f1", "f1"), true);
  assert.equal(P.isSelfOrDescendant(folders, "f2", "f1"), false);
  const cyclic = [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }];
  assert.equal(P.isSelfOrDescendant(cyclic, "z", "a"), false);
  assert.ok(P.folderPathOf(cyclic, "a").length <= 2);
});

test("drop and paste compatibility never mixes categories nor nests a folder in itself", () => {
  const { folders, items } = P.toEntries(data);
  const scene = items.find((e) => e.id === "s1"), map = items.find((e) => e.id === "m2");
  const f1 = folders.find((f) => f.id === "f1"), f2 = folders.find((f) => f.id === "f2");
  assert.match(P.checkTransfer([scene], { category: "characters", folderId: null }, folders).reason, /Cenas só ficam em pastas de Cenas/);
  assert.match(P.checkTransfer([map], { category: "maps", folderId: "f3" }, folders).reason, /Mapas só ficam/);
  assert.match(P.checkTransfer([f1], { category: "maps", folderId: "f2" }, folders).reason, /nela mesma/);
  assert.match(P.checkTransfer([f1], { category: "maps", folderId: "f1" }, folders).reason, /nela mesma/);
  assert.equal(P.checkTransfer([map], { category: "maps", folderId: "f1" }, folders).ok, true);
  const noop = P.checkTransfer([f2], { category: "maps", folderId: "f1" }, folders);
  assert.equal(noop.ok, false); assert.equal(noop.noop, true);
  assert.equal(P.checkTransfer([f2], { category: "maps", folderId: "f1" }, folders, { mode: "copy" }).ok, true);
  assert.equal(P.checkTransfer([], { category: "maps" }, folders).ok, false);
  assert.match(P.checkTransfer([map], { category: "maps", folderId: "gone" }, folders).reason, /não existe/);
  assert.equal(P.checkTransfer(Array.from({ length: 201 }, () => map), { category: "maps", folderId: "f1" }, folders).ok, false);
  // profundidade: subárvore de 2 níveis dentro de uma pasta no nível 7 ultrapassa 8.
  const deep = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, parentId: i ? `d${i - 1}` : null, category: "maps" }));
  assert.match(P.checkTransfer([f1], { category: "maps", folderId: "d6" }, [...folders, ...deep]).reason, /8 níveis/);
  assert.deepEqual(P.transferBody([map, f2], { category: "maps", folderId: "f5" }), { category: "maps", folderId: "f5", items: [{ type: "map", id: "m2" }, { type: "folder", id: "f2" }] });
});

test("sort keeps folders first and orders by name (pt-BR, accents ignored), type and dates in both directions", () => {
  const { folders, items } = P.toEntries(data);
  const maps = [...folders.filter((f) => f.category === "maps" && !f.parentId), ...items.filter((e) => e.category === "maps")];
  assert.deepEqual(P.sortEntries(maps, "name").map((e) => e.name), ["Bosque", "Éter", "Masmorras", "Ágora", "Cripta", "Vista"]);
  assert.deepEqual(P.sortEntries(maps, "name", "desc").map((e) => e.name), ["Masmorras", "Éter", "Bosque", "Vista", "Cripta", "Ágora"]);
  assert.deepEqual(P.sortEntries(items.filter((e) => e.type === "scene"), "created").map((e) => e.id), ["s2", "s1"]);
  assert.deepEqual(P.sortEntries(items.filter((e) => e.type === "scene"), "modified", "desc").map((e) => e.id), ["s1", "s2"]);
  assert.deepEqual(P.sortEntries(items.filter((e) => e.type === "map"), "type").map((e) => P.typeLabel(e)), ["Imagem com grade", "Imagem sem grade", "Mapa de tiles"]);
  assert.equal(P.compareNames({ name: "Mapa 2" }, { name: "Mapa 10" }) < 0, true);
});

test("search is accent-insensitive within the folder or across every folder", () => {
  const entries = P.toEntries(data);
  assert.deepEqual(P.filterEntries(entries.items, "agora").map((e) => e.id), ["m2"]);
  assert.deepEqual(P.filterEntries(entries.items, "PRACA").map((e) => e.id), ["m2"]);
  assert.deepEqual(P.filterEntries(entries.items, "criatura").map((e) => e.id), ["c1"]);
  assert.equal(P.filterEntries(entries.items, "").length, entries.items.length);
  const here = P.visibleEntries(entries, { category: "maps", folderId: null });
  assert.deepEqual(here.map((e) => e.id), ["f6", "f5", "f1", "m2", "m3"]);
  assert.deepEqual(P.visibleEntries(entries, { category: "maps", folderId: null, query: "cripta" }).map((e) => e.id), []);
  assert.deepEqual(P.visibleEntries(entries, { category: "maps", folderId: null, query: "cripta", everywhere: true }).map((e) => e.id), ["m1"]);
  assert.deepEqual(P.visibleEntries(entries, { category: "scenes", folderId: null, query: "estrada", everywhere: true }).map((e) => e.id), ["s1"]);
});

test("range and toggle selection follow the displayed order", () => {
  const keys = ["a", "b", "c", "d", "e"];
  assert.deepEqual(P.rangeSelection(keys, "b", "d"), ["b", "c", "d"]);
  assert.deepEqual(P.rangeSelection(keys, "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(P.rangeSelection(keys, "zz", "c"), ["c"]);
  assert.deepEqual(P.rangeSelection(keys, "a", "zz"), []);
  assert.deepEqual(P.toggleKey(["a"], "b"), ["a", "b"]);
  assert.deepEqual(P.toggleKey(["a", "b"], "a"), ["b"]);
});

test("labels: plurals, types, dimensions and selection summary", () => {
  assert.equal(P.countLabel("map", 1), "1 mapa");
  assert.equal(P.countLabel("character", 2), "2 personagens");
  assert.equal(P.countLabel("folder", 0), "0 pastas");
  const { folders, items } = P.toEntries(data);
  assert.equal(P.typeLabel(items.find((e) => e.id === "s2")), "Cena textual");
  assert.equal(P.typeLabel(folders[0]), "Pasta");
  assert.equal(P.mapDimensions(data.maps[0]), "8 × 2 casas");
  assert.equal(P.mapDimensions(data.maps[1]), "1024 × 768 px · 16 × 12 casas");
  assert.equal(P.mapDimensions(data.maps[2]), "800 × 600 px");
  assert.equal(P.mapKindLabel(data.maps[3]), "Cartografia");
  assert.equal(P.selectionSummary([folders[0], items[0], items[1], items[2]]), "1 pasta, 2 cenas e 1 mapa");
  assert.equal(P.selectionSummary([items[0]]), "1 cena");
  assert.equal(P.selectionSummary([]), "Nada selecionado");
  assert.equal(P.NEW_LABELS.maps, "Novo mapa");
});

test("back/forward history and up navigation", () => {
  let nav = P.createNav({ category: "maps", folderId: null });
  nav = P.pushLocation(nav, { category: "maps", folderId: "f1" });
  nav = P.pushLocation(nav, { category: "maps", folderId: "f2" });
  assert.equal(P.pushLocation(nav, { category: "maps", folderId: "f2" }), nav);
  nav = P.goBack(nav);
  assert.equal(nav.current.folderId, "f1");
  nav = P.goForward(nav);
  assert.equal(nav.current.folderId, "f2");
  nav = P.goBack(P.goBack(nav));
  assert.equal(nav.current.folderId, null);
  assert.equal(P.goBack(nav), nav);
  nav = P.pushLocation(nav, { category: "scenes", folderId: null });
  assert.equal(nav.forward.length, 0);
  const pruned = P.pruneNav({ back: [{ category: "maps", folderId: "gone" }], current: { category: "maps", folderId: "gone" }, forward: [] }, data.folders);
  assert.deepEqual(pruned, { back: [], current: { category: "maps", folderId: null }, forward: [] });
  assert.deepEqual(P.parentLocation(data.folders, { category: "maps", folderId: "f2" }), { category: "maps", folderId: "f1" });
  assert.equal(P.parentLocation(data.folders, { category: "maps", folderId: null }), null);
});

test("scene-from-map picker groups: own scratch, then from template, then official", () => {
  const groups = P.mapPickerGroups(data.maps, data.maps.filter((m) => P.isOfficialKey(m.key)));
  assert.deepEqual(groups.map((g) => g.id), ["own", "template", "official"]);
  assert.deepEqual(groups[0].items.map((m) => m.id), ["m2", "m3"]);
  assert.deepEqual(groups[1].items.map((m) => m.id), ["m1"]);
  assert.deepEqual(groups[2].items.map((m) => m.key), ["valley"]);
  const filtered = P.mapPickerGroups(data.maps, [data.maps[3]], { query: "vale" });
  assert.deepEqual(filtered.map((g) => g.items.length), [0, 0, 1]);
  assert.deepEqual(P.mapPickerGroups(data.maps, [], { type: "tiles" }).map((g) => g.items.length), [0, 1, 0]);
  assert.deepEqual(P.mapPickerGroups(data.maps, [], { type: "image" })[0].items.map((m) => m.id), ["m3"]);
});

test("scene body references the map; grid maps become tactical scenes and the rest image scenes", () => {
  const grid = P.sceneFromMapBody(data.maps[1], { name: "  Praça ", folderId: "f3", order: 4 });
  assert.deepEqual(grid, { name: "Praça", description: "", kind: "map", mapKey: "asset:m2", mapKind: null, sharedText: "", privateNotes: "", visionMode: null, order: 4, revision: 0, folderId: "f3" });
  assert.equal(P.sceneFromMapBody(data.maps[2]).kind, "image");
  assert.equal(P.sceneFromMapBody(data.maps[3]).kind, "image");
  assert.equal(P.sceneFromMapBody({ key: "crypt", kind: "tileset", name: "Cripta" }).kind, "map");
  assert.equal(P.sceneFromMapBody(data.maps[3]).folderId, null);
});

test("names are trimmed and limited per type", () => {
  assert.deepEqual(P.validateName("folder", "  Nova   pasta "), { name: "Nova pasta" });
  assert.match(P.validateName("character", "x".repeat(41)).error, /40/);
  assert.match(P.validateName("map", "   ").error, /nome/);
});
