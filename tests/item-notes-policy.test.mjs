// Descrições por item e campos de lista da ficha (ADR-098): regras puras.
import test from "node:test";
import assert from "node:assert/strict";
import { isListField, noteKey, fieldItems, describedCount, applyNotes, liveNotes, lineFieldNames, fitLine, NOTE_MAX } from "../apps/Eternnus.Web/wwwroot/js/item-notes-policy.js";

const f = (name, type = "textarea", extra = {}) => ({ name, type, ...extra });

test("campos de lista pelo nome, sem colunas auxiliares nem texto corrido", () => {
  for (const name of ["habilidades_classe_poderes", "habilidades_raca_origem", "magia_3", "ataque_1_nome", "item_7", "talentos_classe", "rituais_lista", "disciplina_2_poder_1", "ataques_magias", "outros_itens"])
    assert.equal(isListField(f(name)), true, name);
  for (const name of ["descricao", "anotacoes", "item_7_peso", "ataque_1_dano", "feitico_2_descricao", "descricao_tecnica", "bonus_poder", "reacao_aparencia", "armas_brancas_espec", "personagem"])
    assert.equal(isListField(f(name)), false, name);
  assert.equal(isListField(f("magia_1", "number")), false);
  assert.equal(isListField(f("anotacoes", "textarea", { notes: true })), true);
  assert.equal(isListField(f("magia_1", "text", { notes: false })), false);
});

test("chave igual à do servidor", () => {
  assert.equal(noteKey("  Golpe\tDivino  "), "golpe divino");
  assert.equal(noteKey("E\u0301lan"), "élan");
  assert.equal(noteKey("x".repeat(300)).length, 200);
});

test("itens: linhas não vazias, sem repetir", () => {
  assert.deepEqual(fieldItems("(HC) Golpe Divino\n\n (hc) golpe divino \nAura"), [{ key: "(hc) golpe divino", label: "(HC) Golpe Divino" }, { key: "aura", label: "Aura" }]);
  assert.deepEqual(fieldItems(""), []);
});

test("aplica, remove e conta descrições", () => {
  let notes = applyNotes({}, { aura: "  Cura aliados.  ", vazio: "" });
  assert.deepEqual(notes, { aura: "Cura aliados." });
  notes = applyNotes(notes, { aura: "", golpe: "x".repeat(NOTE_MAX + 20) });
  assert.equal(notes.aura, undefined);
  assert.equal(notes.golpe.length, NOTE_MAX);
  assert.equal(describedCount("Golpe\nAura", notes), 1);
});

test("só ficam descrições de itens atuais dos campos de lista", () => {
  const fields = [f("poderes"), f("anotacoes")];
  const notes = { golpe: "a", sumiu: "b", nota: "c" };
  assert.deepEqual(liveNotes(fields, { poderes: "Golpe", anotacoes: "Nota" }, notes), { golpe: "a" });
});

test("linha a linha: listas e as colunas delas (mesmo começo de nome e mesmas linhas), sem texto corrido", () => {
  const pages = [{ height: 800 }, { height: 800 }]; // linha de fonte 12 = 14,4 pt = 0,018 da página
  const area = (name, y, h, fontSize = 12, page = 0) => f(name, "textarea", { x: 0.1, y, w: 0.3, h, fontSize, page });
  const names = lineFieldNames([
    area("posses", 0.2, 0.5), area("posses_custo", 0.2, 0.5), area("posses_peso", 0.205, 0.497),
    area("posses_notas", 0.2, 0.3), area("descricao_pessoal", 0.2, 0.5), area("anotacoes", 0.2, 0.5),
    area("posses_nh", 0.2, 0.5, 9), area("posses_dano", 0.2, 0.5, 12, 1),
    f("magia_1", "text", { x: 0, y: 0.2, w: 0.2, h: 0.02 }),
  ], pages);
  assert.deepEqual([...names].sort(), ["posses", "posses_custo", "posses_peso"]);
  assert.deepEqual([...lineFieldNames([area("descricao", 0.1, 0.3), area("historia", 0.1, 0.3)], pages)], []);
});

test("corta a linha com reticências para caber", () => {
  const measure = (t) => t.length; // 1 unidade por caractere
  assert.equal(fitLine("Bola de Fogo", 20, measure), "Bola de Fogo");
  assert.equal(fitLine("Bola de Fogo Acelerada", 10, measure), "Bola de F…");
  assert.equal(fitLine("Bola de Fogo", 1, measure), "");
  assert.equal(fitLine("", 10, measure), "");
  assert.equal(fitLine("Aura   ", 10, measure), "Aura");
});
