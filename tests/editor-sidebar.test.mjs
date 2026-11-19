// Contrato da barra lateral (ADR-118): os três editores e a mesa usam a mesma estrutura e a mesma aparência.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root = new URL("../apps/Eternnus.Web/wwwroot/js/", import.meta.url);
const read = (f) => readFile(new URL(f, root), "utf8");
const [core, outline, image, tiles, scene, table] = await Promise.all(["editor-core.js", "editor-outline.js", "image-map-editor.js", "tile-map-editor.js", "scene-editor.js", "table.js"].map(read));

test("núcleo monta cabeçalho, inspetor, Organizar/Adicionar/Configurar e Histórico secundário", () => {
  for (const marker of ["data-ed-side-head", "data-ed-inspect", "data-ed-split", 'role="tablist"', "data-ed-area-tab", "HISTORY_AREA", "setSideHeader", "revealPanel"]) assert.match(core, new RegExp(marker.replace(/[[\]]/g, "\$&")), marker);
  assert.doesNotMatch(core, /renderLayersPanel|renderStructurePanel/, "painéis antigos de Camadas/Estrutura removidos");
});
test("os três editores usam a árvore unificada e declaram a área de cada painel", () => {
  for (const [name, src] of [["image", image], ["tiles", tiles], ["scene", scene]]) {
    assert.match(src, /renderOutline\(/, name);
    assert.match(src, /area: "history"/, name);
    assert.match(src, /area: "organize"/, name);
    assert.match(src, /area: "add"/, name);
    assert.match(src, /area: "configure"/, name);
    assert.match(src, /setSideHeader\(/, name);
  }
  for (const [name, src] of [["image", image], ["scene", scene]]) assert.match(src, /area: "inspect"/, name);
});
test("árvore: teclado, arraste com destino validado, localizar e sem title nativo", () => {
  for (const marker of ["ArrowDown", "ArrowLeft", "F2", "ContextMenu", "outlineDropProblem", "rangeIds", "onLocate", "aria-expanded", 'role="tree"']) assert.ok(outline.includes(marker), marker);
  assert.doesNotMatch(outline, /\.title\s*=|title="/);
});
test("cena: visibilidade para jogadores separada da do editor; personagens em três vistas; original somente leitura", () => {
  assert.match(scene, /players: l\.secret \? "master" : "all"/);
  assert.match(scene, /Oculto para os jogadores/);
  assert.match(scene, /CHAR_VIEWS = \[\["scene", "Em cena"\], \["available", "Disponíveis"\], \["reserved", "Reservados"\]\]/);
  assert.match(scene, /readonly: true/);
  assert.match(scene, /Abrir original/);
  assert.match(scene, /<details class="se-slot-archetypes">/);
});
test("mesa ao vivo usa as mesmas abas da lateral dos editores", () => {
  assert.match(table, /class="ed-side-nav"><div class="panel-tabs ed-side-tabs" role="tablist"/);
  assert.match(table, /class="ed-side-tab/);
  assert.doesNotMatch(table, /class="ed-context/);
});
