// Descrições por item e rolagem ao clicar no editor de fichas-modelo (ADR-099): regras puras.
import test from "node:test";
import assert from "node:assert/strict";
import {
  supportsNotes,
  supportsRoll,
  notesMode,
  notesFromMode,
  rollMode,
  rollFromMode,
  suggestedRoll,
  rollFormulaError,
  normalizeField,
  compactField,
  structuralIssues,
  publishIssues,
  diffVersions,
  CHANGE_LABELS,
  LIMITS,
} from "../apps/Eternnus.Web/wwwroot/js/sheet-editor-policy.js";

const f = (name, type, extra = {}) => ({ ...normalizeField({ name, label: name, type, x: 0.1, y: 0.1, w: 0.2, h: 0.04 }), ...extra });
const doc = (fields) => ({ pages: [{ width: 595.28, height: 841.89 }], fields, actions: [], notes: "" });

test("tipos aceitos por cada propriedade", () => {
  assert.deepEqual(["text", "textarea", "number", "computed", "select", "checkbox"].map(supportsNotes), [true, true, false, false, false, false]);
  assert.deepEqual(["text", "textarea", "number", "computed", "select", "checkbox"].map(supportsRoll), [false, false, true, true, false, false]);
});

test("descrições por item: opção do seletor ida e volta", () => {
  for (const [notes, mode] of [[true, "yes"], [false, "no"], [null, "auto"], [undefined, "auto"]]) {
    assert.equal(notesMode({ notes }), mode);
    if (notes !== undefined) assert.equal(notesFromMode(mode), notes);
  }
  assert.equal(notesFromMode("qualquer"), null);
});

test("rolagem: automático, não rolar e fórmula própria", () => {
  assert.equal(rollMode({ roll: null }), "auto");
  assert.equal(rollMode({}), "auto");
  assert.equal(rollMode({ roll: "" }), "none");
  assert.equal(rollMode({ roll: "   " }), "none");
  assert.equal(rollMode({ roll: "1d20 + @luta" }), "custom");
  const luta = { name: "luta", roll: null };
  assert.equal(rollFromMode("auto", luta), null);
  assert.equal(rollFromMode("none", luta), "");
  assert.equal(rollFromMode("custom", luta), "1d20 + @luta");
  assert.equal(rollFromMode("custom", { name: "luta", roll: "2d20kh1 + @luta" }), "2d20kh1 + @luta");
  assert.equal(suggestedRoll({ name: "Inválido" }), "1d20");
});

test("normalização e corpo do PUT preservam escolhas explícitas e descartam o automático", () => {
  assert.deepEqual([normalizeField({}).notes, normalizeField({}).roll], [null, null]);
  assert.equal(normalizeField({ notes: "sim" }).notes, null);
  assert.equal(normalizeField({ roll: 5 }).roll, null);
  assert.equal(compactField(f("pericias", "textarea", { notes: false })).notes, false);
  assert.equal(compactField(f("pericias", "textarea", { notes: true })).notes, true);
  assert.equal("notes" in compactField(f("pericias", "textarea")), false);
  assert.equal(compactField(f("forca", "number", { roll: "" })).roll, "");
  assert.equal(compactField(f("forca", "number", { roll: " 1d20 + @forca " })).roll, "1d20 + @forca");
  assert.equal("roll" in compactField(f("forca", "number")), false);
  // Tipo errado: nada vai ao servidor.
  assert.equal("roll" in compactField(f("nome", "text", { roll: "1d20" })), false);
  assert.equal("notes" in compactField(f("forca", "number", { notes: true })), false);
});

test("validação da fórmula de rolagem no modo roll com campos numéricos do modelo", () => {
  const fields = [f("forca", "number"), f("acrobacia", "computed", { formula: "@forca" }), f("nome", "text")];
  const check = (roll, type = "number") => rollFormulaError({ ...f("teste", type), roll }, fields);
  assert.equal(check(null), null);
  assert.equal(check(""), null);
  assert.equal(check("1d20 + @acrobacia"), null);
  assert.equal(check("1d100 <= @forca"), null);
  assert.equal(check("2d20kh1 + @forca", "computed"), null);
  assert.match(check("1d20 + @inexistente"), /@inexistente/);
  assert.match(check("1d20 + @nome"), /@nome/);
  assert.ok(check("1d20 + ("));
  assert.match(check("1".repeat(LIMITS.roll + 1)), /120/);
  assert.equal(rollFormulaError({ ...f("nome", "text"), roll: "1d20 + (" }, fields), null);
});

test("problemas de estrutura e de publicação apontam o campo", () => {
  const long = structuralIssues(doc([f("forca", "number", { roll: "1".repeat(LIMITS.roll + 1) })]));
  assert.ok(long.some((i) => i.field === "forca" && /rolagem/.test(i.message)));
  const bad = publishIssues(doc([f("forca", "number", { roll: "1d20 + @sumiu" })]));
  assert.ok(bad.some((i) => i.field === "forca" && /rolagem — .*@sumiu/.test(i.message)));
  assert.deepEqual(publishIssues(doc([f("forca", "number", { roll: "1d20 + @forca" }), f("pericias", "textarea", { notes: true })])), []);
  assert.equal(publishIssues(doc([f("forca", "number", { roll: "1".repeat(LIMITS.roll + 1) })])).filter((i) => /rolagem/.test(i.message)).length, 1);
});

test("diferenças entre versões distinguem automático de escolha explícita", () => {
  const before = doc([f("forca", "number"), f("pericias", "textarea")]);
  const after = doc([f("forca", "number", { roll: "" }), f("pericias", "textarea", { notes: false })]);
  const d = diffVersions(before, after);
  assert.deepEqual(d.changed, [{ name: "forca", changes: ["roll"] }, { name: "pericias", changes: ["notes"] }]);
  assert.deepEqual(diffVersions(after, after).changed, []);
  assert.equal(CHANGE_LABELS.notes, "descrições por item");
  assert.equal(CHANGE_LABELS.roll, "rolagem");
});
