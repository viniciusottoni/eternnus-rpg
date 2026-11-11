import { test } from "node:test";
import assert from "node:assert/strict";

const t = await import("../apps/Eternnus.Web/wwwroot/js/data-table.js");

const rows = Array.from({ length: 33 }, (_, i) => ({
  id: String(i), name: i % 2 ? `Lôbo ${i}` : `Goblin ${i}`, summary: i === 4 ? "Chefe da caverna" : "", kind: i % 3 ? "npc" : "creature", side: i % 2 ? "enemy" : "ally",
}));

test("paginates 15 per page with clamped page", () => {
  const p1 = t.pageSlice(rows, 1);
  assert.equal(p1.items.length, 15);
  assert.equal(p1.pages, 3);
  assert.equal(t.pageSlice(rows, 3).items.length, 3);
  assert.equal(t.pageSlice(rows, 99).page, 3);
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

function filter(opts) {
  return t.filterRows(rows, { fields: ["name", "summary"], ...opts });
}
