// ADR-090: composição da cena, entradas, distribuição do grupo e entrada de imagens (regras puras, sem DOM).
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultGrid, gridFor, entryRect, rectCells, newEntryId, entriesProblem, sceneEntryArea, distributeInArea,
  publicComposition, hasPublicElements, compositionSources, BACKGROUND_MODES, ENTRY_KINDS,
} from "../apps/Eternnus.Web/wwwroot/js/scene-policy.js";
import { imageFileProblem, splitImageFiles, parseAssetDrag, baseName, MAX_FILES, assetListHtml } from "../apps/Eternnus.Web/wwwroot/js/image-drop.js";
import { withMap, blankSceneComposition, sceneSourceResolver, MAP_ELEMENT } from "../apps/Eternnus.Web/wwwroot/js/scene-composition.js";
import * as CP from "../apps/Eternnus.Web/wwwroot/js/composition-policy.js";

const G1 = "11111111-1111-4111-8111-111111111111", G2 = "22222222-2222-4222-8222-222222222222";
const rows = (w, h, fill = ".") => Array.from({ length: h }, () => fill.repeat(w));

test("background modes keep the three choices distinct and the technical grid fits the server limits", () => {
  assert.deepEqual(BACKGROUND_MODES.map(([v]) => v), ["free", "tactical", "image"]);
  for (const [w, h] of [[2048, 1536], [4096, 4096], [4096, 64], [300, 200], [1000, 3000]]) {
    const s = defaultGrid(w, h);
    assert.ok(s >= 8 && gridFor(w, h, s).valid, `${w}×${h} → ${s}`);
  }
  assert.equal(defaultGrid(2048, 1536), 64);
  assert.equal(defaultGrid(4, 4), null);
});

test("entry rectangles come from painted cells, stay inside the grid and are validated like the server", () => {
  assert.deepEqual(entryRect([{ x: 3, y: 2 }, { x: 5, y: 4 }, { x: 4, y: 3 }]), { x: 3, y: 2, w: 3, h: 3 });
  assert.deepEqual(entryRect([{ x: 0, y: 0 }, { x: 40, y: 0 }]), { x: 0, y: 0, w: 20, h: 1 }, "até 20 casas por lado");
  assert.equal(entryRect([]), null);
  assert.deepEqual(rectCells({ x: 8, y: 0, w: 4, h: 1 }, 10, 10), [{ x: 8, y: 0 }, { x: 9, y: 0 }]);
  assert.equal(newEntryId([{ id: "entrada-1" }]), "entrada-2");
  const ok = [{ id: "entrada-1", name: "Entrada norte", kind: "party", x: 0, y: 0, w: 2, h: 1 }];
  assert.equal(entriesProblem(ok, 10, 10), "");
  assert.match(entriesProblem([...ok, { ...ok[0] }], 10, 10), /único/);
  assert.match(entriesProblem([{ ...ok[0], x: 9 }], 10, 10), /dentro do mapa/);
  assert.match(entriesProblem([{ ...ok[0], kind: "x" }], 10, 10), /tipo/);
  assert.match(entriesProblem([{ ...ok[0], name: " " }], 10, 10), /nome/);
  assert.match(entriesProblem(Array.from({ length: 13 }, (_, i) => ({ ...ok[0], id: `e-${i}` })), 10, 10), /até 12/);
  assert.ok(ENTRY_KINDS.some(([k]) => k === "party"));
});

test("scene entry area follows the priority: scene area, chosen map point, map party entry, nothing", () => {
  const entries = [{ id: "sul", name: "Sul", kind: "other", x: 0, y: 9, w: 3, h: 1 }, { id: "grupo", name: "Grupo", kind: "party", x: 4, y: 4, w: 2, h: 2 }];
  assert.equal(sceneEntryArea({ x: 1, y: 1, w: 1, h: 1 }, entries).source, "scene");
  assert.deepEqual(sceneEntryArea({ ref: "sul" }, entries).rect, { x: 0, y: 9, w: 3, h: 1 });
  assert.equal(sceneEntryArea(null, entries).entry.id, "grupo");
  assert.equal(sceneEntryArea({ ref: "sumiu" }, entries).source, "map-party", "ponto removido cai na entrada padrão");
  assert.equal(sceneEntryArea(null, [entries[0]]), null);
});

test("distribution keeps manual positions, skips blocked and occupied cells and reports lack of space", () => {
  const cells = rows(6, 6); cells[0] = "#....."; // casa (0,0) bloqueia movimento
  const tokens = [{ characterId: "a", x: 1, y: 0, label: "A" }];
  const characters = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }];
  const r = distributeInArea({ cells, width: 6, height: 6, tokens, area: { x: 0, y: 0, w: 3, h: 1 }, characters });
  assert.deepEqual(r.tokens[0], tokens[0], "posição manual preservada");
  assert.deepEqual(r.placed, ["b"]);
  assert.deepEqual(r.missing, ["c", "d"]);
  assert.deepEqual(r.tokens.map((t) => `${t.x},${t.y}`), ["1,0", "2,0"]);
  assert.equal(tokens.length, 1, "não altera a entrada");
  // Movimentação livre: casas livres primeiro, depois pontos distintos na mesma casa.
  const free = distributeInArea({ cells: rows(3, 3), width: 3, height: 3, tokens: [], area: { x: 0, y: 0, w: 1, h: 1 }, characters, free: true });
  assert.equal(free.placed.length, 4);
  const points = new Set(free.tokens.map((t) => `${t.x},${t.y},${t.fx},${t.fy}`));
  assert.equal(points.size, 4, "sem sobreposição exata");
  assert.ok(free.tokens.every((t) => t.fx >= 0 && t.fx < 1000 && t.side === "ally"));
});

test("players receive only public composition elements; editor visibility is not secrecy", () => {
  const doc = blankSceneComposition(800, 600);
  doc.layers.push({ id: "segredos", name: "Segredos", kind: "custom", visible: true, locked: false, opacity: 100, secret: true });
  doc.elements.push(
    CP.normalizeElement({ id: "img-1", layer: "elements", type: "image", src: `asset:${G1}`, width: 10, height: 10, visible: false }),
    CP.normalizeElement({ id: "img-2", layer: "elements", type: "image", src: `asset:${G2}`, width: 10, height: 10, secret: true }),
    CP.normalizeElement({ id: "img-3", layer: "segredos", type: "image", src: `asset:${G1}`, width: 10, height: 10 }),
  );
  const pub = publicComposition(doc);
  assert.deepEqual(pub.elements.map((e) => e.id), ["img-1"], "oculto só no editor continua indo para os jogadores");
  assert.ok(pub.elements[0].visible);
  assert.equal(pub.layers.find((l) => l.id === "segredos").visible, false);
  assert.ok(hasPublicElements(doc));
  assert.deepEqual(compositionSources(doc), [`asset:${G1}`, `asset:${G2}`]);
  // O contrato mantém "secret" só quando verdadeiro (mapas nunca enviam o campo).
  const json = JSON.parse(CP.serializeComposition(doc));
  assert.equal(json.layers.find((l) => l.id === "segredos").secret, true);
  assert.equal(json.elements.find((e) => e.id === "img-2").secret, true);
  assert.equal("secret" in json.elements.find((e) => e.id === "img-1"), false);
  assert.equal(CP.validateComposition(CP.normalizeComposition(json)), null);
});

test("the shared map is a locked synthetic element that never enters the saved scene document", () => {
  const doc = blankSceneComposition(640, 480);
  assert.equal(doc.layers[0].name, "Fundo");
  const view = withMap(doc);
  assert.equal(view.elements[0].id, MAP_ELEMENT);
  assert.ok(view.elements[0].locked && view.elements[0].src === "self");
  assert.equal(doc.elements.length, 0);
  const resolve = sceneSourceResolver("c1", () => `/api/campaigns/${G1}/assets/maps/${G2}/image`);
  assert.equal(resolve("self"), `/api/campaigns/${G1}/assets/maps/${G2}/image`);
  assert.equal(resolve(`asset:${G2}`), `/api/campaigns/c1/assets/maps/${G2}/image`);
  assert.equal(resolve("https://evil.example/x.png"), null);
  assert.equal(sceneSourceResolver("c1", () => "javascript:alert(1)")("self"), null);
});

test("image input accepts PNG/JPEG up to the plan limit (Basic 20 MB without account), limits batches and trusts only campaign assets from drags", () => {
  const file = (name, type, size) => ({ name, type, size });
  assert.equal(imageFileProblem(file("a.png", "image/png", 10)), "");
  assert.equal(imageFileProblem(file("a.jpg", "", 10)), "", "tipo vazio com extensão conhecida");
  assert.match(imageFileProblem(file("a.gif", "image/gif", 10)), /PNG nem JPEG/);
  assert.equal(imageFileProblem(file("a.png", "image/png", 11 * 1024 * 1024)), "", "acima do antigo limite de 10 MB");
  assert.match(imageFileProblem(file("a.png", "image/png", 21 * 1024 * 1024)), /20 MB/);
  assert.match(imageFileProblem(file("a.png", "image/png", 0)), /vazio/);
  const many = Array.from({ length: MAX_FILES + 2 }, (_, i) => file(`f${i}.png`, "image/png", 5));
  const split = splitImageFiles([...many, file("x.webp", "image/webp", 5)]);
  assert.equal(split.files.length, MAX_FILES);
  assert.equal(split.problems.length, 3);
  assert.equal(baseName("Floresta Sombria.PNG"), "Floresta Sombria");
  assert.deepEqual(parseAssetDrag(JSON.stringify({ src: `asset:${G1}`, name: "Casa", width: 10, height: 5 })), { src: `asset:${G1}`, name: "Casa", width: 10, height: 5 });
  assert.equal(parseAssetDrag(JSON.stringify({ src: "https://x/y.png" })), null);
  assert.equal(parseAssetDrag("<script>"), null);
  const html = assetListHtml([{ key: `asset:${G1}`, name: "<b>Casa</b>", imageUrl: `/api/campaigns/${G2}/assets/maps/${G1}/image`, pixelWidth: 10, pixelHeight: 5 }, { key: `asset:${G2}`, name: "Externa", imageUrl: "https://x/y.png" }]);
  assert.ok(html.includes("&lt;b&gt;Casa"));
  assert.ok(!html.includes("Externa"), "só a rota de imagem da própria campanha");
});
