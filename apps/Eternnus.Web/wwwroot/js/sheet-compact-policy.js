// Ficha compacta, busca na ficha e "Usar" item (ADR-099). Regras puras, sem DOM: testáveis com node --test.
import { fieldItems, isListField, noteKey } from "./item-notes-policy.js";
import { rollFormulas } from "./sheet-roll-policy.js";

const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const label = (f) => String(f?.label || f?.name || "");
const fold = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Recursos (contadores com teto) e destaques, com a mesma regra do servidor (SheetSummary.Build):
 * campo marcado como recurso ou com papel Vida; destaques marcados ou, sem nenhum, Nível/Armadura/Deslocamento.
 */
export function summaryOf(fields, values) {
  const list = fields || [];
  const byRole = new Map();
  for (const f of list) if (f?.role && !byRole.has(f.role)) byRole.set(f.role, f);
  const resources = [];
  for (const f of list) {
    const isResource = f.track === "resource" || (!f.track && f.role === "hp");
    if (!isResource || !(f.type === "number" || f.type === "computed")) continue;
    const maxField = f.maxField || (f.role === "hp" ? byRole.get("maxHp")?.name : null);
    const max = num(values?.[maxField]) ?? (Number.isFinite(f.max) ? f.max : null);
    resources.push({ field: f.name, label: label(f), value: num(values?.[f.name]) ?? 0, max, min: Number.isFinite(f.min) ? f.min : 0 });
  }
  // Reservas sem marcação no modelo: número com um par "_max" (pm_atual ↔ pm_max, mana ↔ mana_max).
  const names = new Map(list.map((f) => [f?.name, f]));
  for (const f of list) {
    if (f?.type !== "number" || f.track || resources.some((r) => r.field === f.name)) continue;
    const base = String(f.name).replace(/_(atual|atuais)$/, "");
    const maxField = [`${base}_max`, `${f.name}_max`].find((n) => n !== f.name && names.has(n));
    if (!maxField || resources.some((r) => r.maxField === maxField)) continue;
    resources.push({ field: f.name, label: label(f), value: num(values?.[f.name]) ?? 0, max: num(values?.[maxField]), min: Number.isFinite(f.min) ? f.min : 0, maxField });
  }
  let marked = list.filter((f) => f.track === "summary");
  if (!marked.length) marked = ["level", "armor", "movement"].map((r) => byRole.get(r)).filter(Boolean);
  const stats = marked.filter((f) => values?.[f.name] != null && String(values[f.name]) !== "").map((f) => ({ field: f.name, label: label(f), value: String(values[f.name]) }));
  return { resources, stats };
}

/**
 * Modelo da ficha compacta: recursos, destaques, testes que rolam (com valor) e listas com descrições.
 * Testes só com valor preenchido; listas só com itens.
 */
export function compactModel(fields, values, notes = {}) {
  const { resources, stats } = summaryOf(fields, values);
  const formulas = rollFormulas(fields);
  const rolls = (fields || []).filter((f) => formulas.has(f.name) && String(values?.[f.name] ?? "") !== "")
    .map((f) => ({ field: f.name, label: label(f), value: String(values[f.name]), formula: formulas.get(f.name) }));
  const lists = (fields || []).filter(isListField).map((f) => ({
    field: f.name,
    label: label(f),
    items: fieldItems(values?.[f.name]).map((item) => ({ key: item.key, text: item.label, note: Object.hasOwn(notes || {}, item.key) ? String(notes[item.key] || "") : "" })),
  })).filter((l) => l.items.length);
  return { resources, stats, rolls, lists };
}

const DICE = /(?:^|[^\w@])((\d{1,2})?d(\d{1,3})(?:\s*(?:kh|kl)\d{0,2})?(?:\s*[+-]\s*(?:\d+|@[a-z][a-z0-9_]*))*)/i;
const COST = /(\d{1,4})\s*([a-zà-ü][\wà-ü]*)/gi;
const STOP = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Sigla de um rótulo de recurso: "Pontos de Mana" → "pm"; "PM atuais" → "pm". */
function acronyms(text) {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(words.filter((w) => w.length <= 4));
  const initials = words.filter((w) => !STOP.has(w)).map((w) => w[0]).join("");
  if (initials.length >= 2) out.add(initials);
  return out;
}

/**
 * Sugestão para "Usar": a primeira expressão de dados da descrição (ex.: "6d6", "1d8+@forca_mod") e um custo
 * "N SIGLA" cuja sigla corresponda a um recurso da ficha (ex.: "3 PM" → recurso "Pontos de Mana").
 * Sempre só uma sugestão: o jogador confere e ajusta antes de usar.
 */
export function suggestUse(note, resources) {
  const text = String(note || "");
  const dice = DICE.exec(text);
  const formula = dice ? dice[1].replace(/\s+/g, " ").trim() : "";
  let field = "", cost = null;
  for (const m of text.matchAll(COST)) {
    const word = fold(m[2]);
    const hit = (resources || []).find((r) => acronyms(r.label).has(word) || fold(r.label) === word);
    if (hit) { field = hit.field; cost = Number(m[1]); break; }
  }
  return { formula, field, cost };
}

/**
 * Busca na ficha (ADR-099): rótulo do campo, valor ou linha de lista e descrições por item, sem acentos/maiúsculas.
 * Resultado em ordem dos campos: { field, label, line, text, kind: "label" | "value" | "note" }. Máximo `limit`.
 */
export function searchSheet(fields, values, notes, query, limit = 50) {
  const q = fold(query);
  if (q.length < 2) return [];
  const out = [];
  for (const f of fields || []) {
    if (out.length >= limit) break;
    const value = String(values?.[f.name] ?? "");
    const lines = value.split("\n");
    const lineHit = lines.findIndex((l) => fold(l).includes(q));
    if (lineHit >= 0) { out.push({ field: f.name, label: label(f), line: lines.length > 1 ? lineHit : null, text: lines[lineHit].trim(), kind: "value" }); continue; }
    if (fold(label(f)).includes(q)) { out.push({ field: f.name, label: label(f), line: null, text: value.split("\n")[0].trim(), kind: "label" }); continue; }
    if (!isListField(f)) continue;
    const described = lines.findIndex((l) => l.trim() && fold(notes?.[noteKey(l)] || "").includes(q));
    if (described >= 0) out.push({ field: f.name, label: label(f), line: lines.length > 1 ? described : null, text: lines[described].trim(), kind: "note" });
  }
  return out;
}

/**
 * Restaurar a partir do histórico (ADR-099): só campos que existem, não são calculados e cujo valor antigo não foi
 * cortado no histórico (2.000 caracteres). Descrições por item ("@descricao") não são restauradas por aqui.
 */
export function restorable(row, fields) {
  if (!row || row.field === "@descricao") return false;
  const f = (fields || []).find((x) => x.name === row.field);
  return !!f && f.type !== "computed" && String(row.oldValue ?? "").length < 2000;
}
