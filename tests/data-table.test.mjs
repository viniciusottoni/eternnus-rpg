import { test } from "node:test";
import assert from "node:assert/strict";

const t = await import("../apps/Eternnus.Web/wwwroot/js/data-table.js");

const rows = Array.from({ length: 33 }, (_, i) => ({
  id: String(i), name: i % 2 ? `Lôbo ${i}` : `Goblin ${i}`, summary: i === 4 ? "Chefe da caverna" : "", kind: i % 3 ? "npc" : "creature", side: i % 2 ? "enemy" : "ally",
}));

test("paginates 20 per page with clamped page", () => {
  assert.equal(t.TABLE_PAGE_SIZE, 20);
  const p1 = t.pageSlice(rows, 1);
  assert.equal(p1.items.length, 20);
  assert.equal(p1.pages, 2);
  assert.equal(t.pageSlice(rows, 2).items.length, 13);
  assert.equal(t.pageSlice(rows, 99).page, 2);
  assert.equal(t.pageSlice(rows, 0).page, 1);
  assert.equal(t.pageSlice([], 1).pages, 1);
});

test("general search ignores case and accents and requires every term", () => {
  assert.equal(filter({ q: "LOBO" }).length, 16);
  assert.equal(filter({ q: "lôbo 3" }).map((r) => r.id).join(), "3,13,23,31");
  assert.equal(filter({ q: "caverna" })[0].id, "4");
  assert.equal(filter({ q: "   " }).length, 33);
});

test("column filters use exact match and empty values are ignored", () => {
  assert.equal(filter({ filters: { side: "ally" } }).every((r) => r.side === "ally"), true);
  assert.equal(filter({ filters: { kind: "creature", side: "" } }).length, 11);
  assert.equal(filter({ filters: { kind: "crea" } }).length, 0);
});

test("boolean-like fields compare as strings", () => {
  const data = [{ shared: true }, { shared: false }];
  assert.equal(t.filterRows(data, { filters: { shared: "true" } }).length, 1);
});

test("normalizes accents and case for comparison", () => {
  assert.equal(t.normalizeText("Ação Ñ"), "acao n");
});

test("search highlight ignores case and accents, merges overlaps and keeps original text", () => {
  assert.deepEqual(t.highlightRanges("Lôbo da Caverna", "lobo CAVERNA"), [[0, 4], [8, 15]]);
  assert.deepEqual(t.highlightRanges("aaaa", "aa a"), [[0, 4]]);
  assert.deepEqual(t.highlightRanges("Ação", "acao"), [[0, 4]]);
  assert.deepEqual(t.highlightRanges("Nada aqui", "   "), []);
  assert.equal(t.highlightHtml("Lôbo mau", "lobo"), '<mark class="search-hit">Lôbo</mark> mau');
});

test("search highlight escapes text and search terms", () => {
  assert.equal(t.highlightHtml("<b>Goblin</b>", "goblin"), '&lt;b&gt;<mark class="search-hit">Goblin</mark>&lt;/b&gt;');
  assert.equal(t.highlightHtml("a<img>b", "<img"), 'a<mark class="search-hit">&lt;img</mark>&gt;b');
  assert.equal(t.highlightHtml("preço (x) [y]", "(x) [y] .*"), 'preço <mark class="search-hit">(x)</mark> <mark class="search-hit">[y]</mark>');
});

function filter(opts) {
  return t.filterRows(rows, { fields: ["name", "summary"], ...opts });
}

test("search highlight keeps positions with emoji and expanded characters", () => {
  assert.equal(t.highlightHtml("🐉 Dragão", "dragao"), '🐉 <mark class="search-hit">Dragão</mark>');
  assert.equal(t.highlightHtml("ﬁo Ação", "acao"), 'ﬁo <mark class="search-hit">Ação</mark>');
});
