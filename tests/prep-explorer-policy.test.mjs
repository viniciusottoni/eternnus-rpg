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

// ---------- ADR-084: favoritos, recentes, coleções inteligentes e filtros ----------
const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAYMS = 86_400_000;
const rich = {
  folders: [{ id: "fa", name: "Ato I", parentId: null, category: "scenes" }, { id: "fb", name: "Cap 1", parentId: "fa", category: "scenes" }, { id: "fm", name: "Masmorras", parentId: null, category: "maps" }],
  scenes: [
    { id: "s1", name: "Pronta", kind: "map", mapKey: "asset:m1", prepared: 3, hasText: true, folderId: "fb", updatedAt: new Date(NOW - 2 * DAYMS).toISOString() },
    { id: "s2", name: "Sem mapa", kind: "image", mapKey: "", hasText: true, folderId: "fa", updatedAt: new Date(NOW - 40 * DAYMS).toISOString() },
    { id: "s3", name: "Vazia", kind: "map", mapKey: "asset:m1", prepared: 0, hasText: false, folderId: null, current: true },
    { id: "s4", name: "Leitura", kind: "text", mapKey: "", hasText: true, folderId: null, hasSaved: true },
    { id: "s5", name: "Fantasma", kind: "map", mapKey: "asset:gone", prepared: 2, hasText: true, folderId: null },
  ],
  maps: [
    { id: "m1", key: "asset:m1", name: "Cripta", isTileMap: true, kind: "tileset", scenes: 2, folderId: "fm", updatedAt: new Date(NOW - 1000).toISOString() },
    { id: "m2", key: "asset:m2", name: "Praça", kind: "tileset", scenes: 0, inUse: true, sourceKey: "crypt", folderId: null },
    { id: "m3", key: "asset:m3", name: "Esquecido", kind: "cartographic", hasGrid: false, scenes: 0, folderId: null },
  ],
  characters: [
    { id: "c1", name: "Completo", kind: "npc", templateName: "Herói", summary: "líder" },
    { id: "c2", name: "Rascunho", kind: "creature", templateName: null, summary: "" },
  ],
};
const all = P.toEntries(rich);
const mapExists = (key) => all.items.some((e) => e.type === "map" && e.raw.key === key);
const ids = (list) => list.map((e) => e.key);

test("scene and character readiness criteria are explicit", () => {
  assert.deepEqual(P.sceneIssues(rich.scenes[0], mapExists), []);
  assert.deepEqual(P.sceneIssues(rich.scenes[1], mapExists).map((i) => i.id), ["map"]);
  assert.deepEqual(P.sceneIssues(rich.scenes[2], mapExists).map((i) => i.id), ["tokens", "text"]);
  assert.deepEqual(P.sceneIssues(rich.scenes[3], mapExists), [], "cena textual não precisa de mapa nem marcadores");
  assert.equal(P.sceneIssues(rich.scenes[4], mapExists)[0].label, "Mapa não encontrado");
  assert.deepEqual(P.sceneIssues({ kind: "map", mapKey: "asset:m1", prepared: 1 }, mapExists), [], "hasText ausente (servidor antigo) não conta");
  assert.deepEqual(P.characterIssues(rich.characters[0]), []);
  assert.deepEqual(P.characterIssues(rich.characters[1]).map((i) => i.id), ["sheet", "summary"]);
  const m = (id) => all.items.find((e) => e.key === `map:${id}`);
  assert.equal(P.isUnusedMap(m("m1")), false);
  assert.equal(P.isUnusedMap(m("m2")), false, "na mesa conta como uso");
  assert.equal(P.isUnusedMap(m("m3")), true);
  assert.deepEqual(ids(P.scenesUsingMap(all.items, "asset:m1")), ["scene:s1", "scene:s3"]);
});

test("user preferences are validated, bounded and pruned", () => {
  const p = P.normalizeUserPrefs({ favorites: ["map:m1", "map:m1", "x:1", 3], recents: [{ key: "scene:s1", at: 5 }, { key: "scene:s1", at: 9 }, { key: "bad", at: 1 }, { key: "map:m2", at: 7 }], collections: [{ id: "cabc", name: "  Minhas  ", filters: { type: "map-tiles", origin: "nope" } }, { id: "<x>", name: "Má" }] });
  assert.deepEqual(p.favorites, ["map:m1"]);
  assert.deepEqual(p.recents, [{ key: "map:m2", at: 7 }, { key: "scene:s1", at: 5 }], "primeira ocorrência válida vence");
  assert.equal(p.collections.length, 1);
  assert.equal(p.collections[0].name, "Minhas");
  assert.deepEqual(p.collections[0].filters, { ...P.FILTER_DEFAULTS, type: "map-tiles" });
  assert.deepEqual(P.normalizeUserPrefs("lixo"), { favorites: [], recents: [], collections: [] });
  assert.equal(P.userPrefsKey("u1", "c9"), "eternnus.prep.user.u1.c9");
  let q = P.toggleFavorites(p, ["map:m1", "scene:s1"]);
  assert.deepEqual([...q.favorites].sort(), ["map:m1", "scene:s1"], "algum não favorito: todos viram favoritos");
  q = P.toggleFavorites(q, ["map:m1", "scene:s1"]);
  assert.deepEqual(q.favorites, []);
  q = P.touchRecent(p, "scene:s1", 100);
  assert.deepEqual(q.recents[0], { key: "scene:s1", at: 100 });
  assert.equal(q.recents.filter((r) => r.key === "scene:s1").length, 1);
  assert.equal(P.touchRecent(p, "folder:fa", 100), p, "pastas não entram nos recentes");
  let many = P.normalizeUserPrefs({});
  for (let i = 0; i < 40; i++) many = P.touchRecent(many, `map:m${i}`, i + 1);
  assert.equal(many.recents.length, P.RECENT_LIMIT);
  assert.equal(many.recents[0].key, "map:m39");
  const pruned = P.pruneUserPrefs({ favorites: ["map:m1", "map:gone"], recents: [{ key: "map:gone", at: 1 }], collections: [] }, new Set(["map:m1"]));
  assert.deepEqual(pruned, { favorites: ["map:m1"], recents: [], collections: [] });
});

test("filters cover type, origin, date, usage, status and favorites", () => {
  const ctx = { favorites: new Set(["map:m3"]), now: NOW, mapExists };
  const pick = (filters) => ids(all.items.filter((e) => P.matchesFilters(e, filters, ctx))).sort();
  assert.deepEqual(pick({ type: "map-tiles" }), ["map:m1"]);
  assert.deepEqual(pick({ type: "creature" }), ["character:c2"]);
  assert.deepEqual(pick({ origin: "template" }), ["map:m2"]);
  assert.deepEqual(pick({ origin: "image" }), ["map:m3"]);
  assert.deepEqual(pick({ modified: "7" }), ["map:m1", "scene:s1"]);
  assert.deepEqual(pick({ modified: "older" }), ["scene:s2"]);
  assert.deepEqual(pick({ usage: "unused" }), ["map:m3", "scene:s1", "scene:s2", "scene:s5"]);
  assert.deepEqual(pick({ usage: "live" }), ["map:m2", "scene:s3"]);
  assert.deepEqual(pick({ status: "incomplete" }), ["character:c2", "scene:s2", "scene:s3", "scene:s5"]);
  assert.deepEqual(pick({ status: "ready" }), ["character:c1", "scene:s1", "scene:s4"]);
  assert.deepEqual(pick({ favorites: true }), ["map:m3"]);
  assert.deepEqual(pick({ type: "scene-map", status: "ready" }), ["scene:s1"]);
  assert.equal(P.matchesFilters(all.folders[0], { type: "" }, ctx), true, "sem filtro, pastas passam");
  assert.equal(P.matchesFilters(all.folders[0], { usage: "used" }, ctx), false);
  assert.equal(P.activeFilterCount({ type: "map-tiles", favorites: true, origin: "inválido" }), 2);
  assert.equal(P.filterSummary({ type: "map-tiles", usage: "unused" }), "Tipo: Mapa de tiles · Uso: Não usados");
});

test("smart collections are virtual views; only favorites may include folders", () => {
  const ctx = { favorites: new Set(["folder:fa", "map:m1"]), recents: [{ key: "character:c2", at: NOW - 10 }], now: NOW, mapExists };
  assert.deepEqual(ids(P.collectionEntries("favorites", all, ctx)).sort(), ["folder:fa", "map:m1"]);
  assert.deepEqual(ids(P.collectionEntries("recent", all, ctx)), ["character:c2", "map:m1", "scene:s1"], "aberto agora, modificado há 1 s, há 2 dias");
  assert.deepEqual(ids(P.collectionEntries("ready-scenes", all, ctx)).sort(), ["scene:s1", "scene:s4"]);
  assert.deepEqual(ids(P.collectionEntries("incomplete-scenes", all, ctx)).sort(), ["scene:s2", "scene:s3", "scene:s5"]);
  assert.deepEqual(ids(P.collectionEntries("incomplete-characters", all, ctx)), ["character:c2"]);
  assert.deepEqual(ids(P.collectionEntries("unused-maps", all, ctx)), ["map:m3"]);
  assert.deepEqual(P.collectionEntries("desconhecida", all, ctx), []);
  const base = P.normalizeUserPrefs({});
  assert.match(P.saveCollection(base, { name: "  " }).error, /nome/);
  assert.match(P.saveCollection(base, { name: "Nada" }).error, /busca ou um filtro/);
  const r = P.saveCollection(base, { name: "Tiles", filters: { type: "map-tiles" } }, "ctiles");
  assert.equal(r.collection.id, "ctiles");
  assert.match(P.saveCollection(r.prefs, { name: "tiles", query: "x" }).error, /Já existe/);
  assert.deepEqual(ids(P.collectionEntries("ctiles", all, { ...ctx, saved: r.prefs.collections })), ["map:m1"]);
  assert.deepEqual(P.removeCollection(r.prefs, "ctiles").collections, []);
  let full = base;
  for (let i = 0; i < P.COLLECTION_LIMIT; i++) full = P.saveCollection(full, { name: `C${i}`, query: "a" }, `c${i}`).prefs;
  assert.match(P.saveCollection(full, { name: "Extra", query: "a" }).error, /até 20/);
});

test("browse combines scope, search, filters and collections without moving files", () => {
  const ctx = { favorites: new Set(), recents: [], now: NOW, mapExists };
  const opts = { category: "scenes", folderId: null };
  assert.deepEqual(ids(P.browseEntries(all, opts, ctx)), ["folder:fa", "scene:s5", "scene:s4", "scene:s3"], "nesta pasta: subpastas e itens da raiz");
  assert.deepEqual(ids(P.browseEntries(all, { ...opts, folderId: "fa", scope: "subtree" }, ctx)), ["scene:s1", "scene:s2"], "subpastas: só itens, sem a própria pasta");
  assert.deepEqual(ids(P.browseEntries(all, { ...opts, folderId: "fa", scope: "subtree", query: "cap" }, ctx)), ["folder:fb"], "buscando, subpastas também aparecem");
  assert.equal(P.browseEntries(all, { ...opts, scope: "all" }, ctx).length, all.items.length);
  assert.deepEqual(ids(P.browseEntries(all, { ...opts, query: "cripta", everywhere: true }, ctx)), ["map:m1"], "busca em todas as pastas = campanha inteira");
  assert.deepEqual(ids(P.browseEntries(all, { ...opts, filters: { status: "incomplete" } }, ctx)), ["scene:s5", "scene:s3"], "filtro esconde pastas");
  assert.deepEqual(ids(P.browseEntries(all, { ...opts, collection: "unused-maps", query: "esq" }, ctx)), ["map:m3"]);
  const recent = P.browseEntries(all, { ...opts, collection: "recent", sort: "name" }, { ...ctx, recents: [{ key: "scene:s4", at: NOW }] });
  assert.deepEqual(ids(recent), ["scene:s4", "map:m1", "scene:s1"], "Recentes ignora a ordenação por nome");
  assert.equal(all.items.find((e) => e.key === "scene:s1").folderId, "fb", "coleções e filtros nunca mudam os dados");
});
