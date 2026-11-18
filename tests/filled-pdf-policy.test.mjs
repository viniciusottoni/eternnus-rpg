// Descrições por item no PDF exportado (ADR-098): seções, quebra de linha e texto codificável pela fonte padrão.
import test from "node:test";
import assert from "node:assert/strict";
import { noteSections, wrapWords, pdfText } from "../apps/Eternnus.Web/wwwroot/js/item-notes-policy.js";

const f = (name, label, extra = {}) => ({ name, label, type: "textarea", ...extra });
const measure = (t) => t.length; // 1 unidade por caractere

test("seções na ordem dos campos e das linhas, só itens descritos que existem", () => {
  const fields = [f("magias", "Magias"), f("anotacoes", "Anotações"), f("poderes", "Poderes"), f("item_1", "Item 1"), f("ataque_1_dano", "Dano")];
  const values = {
    magias: "Bola de Fogo\n\n bola  de fogo \nMísseis Mágicos\nLuz",
    anotacoes: "Luz", // texto corrido: não é lista
    poderes: "Aura\nLuz",
    item_1: "Corda",
    ataque_1_dano: "Luz",
  };
  const notes = { "mísseis mágicos": "3 dardos.", "bola de fogo": "Explode.", luz: "Ilumina.", aura: "  ", sumiu: "Não existe mais." };
  assert.deepEqual(noteSections(fields, values, notes), [
    { label: "Magias", items: [{ item: "Bola de Fogo", text: "Explode." }, { item: "Mísseis Mágicos", text: "3 dardos." }, { item: "Luz", text: "Ilumina." }] },
    { label: "Poderes", items: [{ item: "Luz", text: "Ilumina." }] },
  ]);
});

test("sem descrições ou sem campos, nenhuma seção; rótulo cai no nome do campo", () => {
  assert.deepEqual(noteSections([f("magias", "Magias")], { magias: "Luz" }, {}), []);
  assert.deepEqual(noteSections([f("magias", "Magias")], { magias: "Luz" }, null), []);
  assert.deepEqual(noteSections(null, null, { luz: "x" }), []);
  assert.deepEqual(noteSections([f("magias", "")], { magias: "Luz" }, { luz: "x" }), [{ label: "magias", items: [{ item: "Luz", text: "x" }] }]);
  assert.deepEqual(noteSections([f("magias", "Magias")], { magias: "constructor" }, {}), []);
});

test("quebra por largura, mantém linhas vazias e parte palavra maior que a largura", () => {
  assert.deepEqual(wrapWords("Bola de fogo que explode", 12, measure), ["Bola de fogo", "que explode"]);
  assert.deepEqual(wrapWords("Primeira\n\nTerceira", 20, measure), ["Primeira", "", "Terceira"]);
  assert.deepEqual(wrapWords("a\r\nb", 20, measure), ["a", "b"]);
  assert.deepEqual(wrapWords("ab Supercalifragilistico x", 8, measure), ["ab", "Supercal", "ifragili", "stico x"]);
  assert.deepEqual(wrapWords("   espaços   demais   ", 40, measure), ["espaços demais"]);
  assert.deepEqual(wrapWords("", 10, measure), []);
  assert.deepEqual(wrapWords(" \n ", 10, measure), []);
  assert.deepEqual(wrapWords("abc", 0, measure), ["a", "b", "c"]); // largura mínima: um caractere por linha, sem laço infinito
});

test("texto codificável pela fonte padrão: acentos ficam, o resto perde o acento ou vira ?", () => {
  const winAnsi = (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || [0x2026, 0x2014, 0x2013, 0x201c, 0x201d, 0x20ac].includes(cp);
  assert.equal(pdfText("Ação, coração — “ótimo” € …", winAnsi), "Ação, coração — “ótimo” € …");
  assert.equal(pdfText("Ação", winAnsi), "Ação"); // NFD vira NFC
  assert.equal(pdfText("Erdős ⚔ 火", winAnsi), "Erdos ? ?");
  assert.equal(pdfText("a\tb\r\nc\rd e", winAnsi), "a b\nc\nd\ne");
  assert.equal(pdfText("x\u0007y​z w", winAnsi), "xyz w");
  assert.equal(pdfText("😀", winAnsi), "?");
  assert.equal(pdfText(null, winAnsi), "");
});
