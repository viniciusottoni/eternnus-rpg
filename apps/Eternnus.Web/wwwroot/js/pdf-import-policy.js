// Regras puras da importação de PDF preenchido: casa campos AcroForm com os campos do modelo padrão.
import { parseNumber } from "./formula.js";

export const IMPORT_LIMITS = Object.freeze({ bytes: 25 * 1024 * 1024, pages: 50, widgets: 5000, minOverlap: 0.5 });

/** Problema do arquivo escolhido antes de lê-lo (vazio = ok). */
export function importFileProblem(file) {
  if (!file || !file.size) return "Escolha um arquivo PDF.";
  if (file.size > IMPORT_LIMITS.bytes) return "O PDF excede o limite de 25 MB.";
  if (file.type && file.type !== "application/pdf") return "Escolha um arquivo PDF.";
  return "";
}

/** Importação disponível somente no modelo padrão de um sistema, com PDF de fundo e edição permitida. */
export function canImportPdf(sheet, canEdit) {
  return Boolean(canEdit && sheet?.template?.isDefault === true && sheet?.version?.pdfUrl);
}

/** Normaliza nomes para o casamento por nome: sem acentos, minúsculas, só letras e números. */
export function normalizeName(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
function intersection(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const finite = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;

/** Converte o valor bruto do PDF para o formato do campo; null quando não deve ser importado. */
export function coerceValue(field, raw) {
  if (field.type === "checkbox") return raw === true || raw === "true" ? "true" : null;
  if (raw === true || raw === false || raw == null) return null;
  const text = String(raw).replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  if (field.type === "number") {
    const n = parseNumber(text);
    if (n === null) return null;
    if (field.min != null && n < field.min) return null;
    if (field.max != null && n > field.max) return null;
    return text;
  }
  if (field.type === "select") {
    const key = text.toLocaleLowerCase("pt-BR");
    return (field.options || []).find((o) => String(o).toLocaleLowerCase("pt-BR") === key) ?? null;
  }
  const single = field.type === "textarea" ? text : text.replace(/\s*\n\s*/g, " ");
  return single.slice(0, Number(field.maxLength) || 2000);
}

/**
 * Casa widgets do PDF ({ page, rect:{x,y,w,h} normalizado, name, value }) com os campos do modelo.
 * 1) Posição: cada widget vai ao campo da mesma página que mais o cobre (≥ 50% da área do widget).
 * 2) Nome: widgets sem posição correspondente casam pelo nome normalizado do campo ou do rótulo.
 * Campos calculados nunca recebem valor; valores vazios não apagam o que já existe.
 */
export function matchPdfValues(fields, widgets) {
  const editable = (fields || []).filter((f) => f.type !== "computed" && f.name);
  const groups = new Map();
  const leftovers = [];
  for (const widget of (widgets || []).slice(0, IMPORT_LIMITS.widgets)) {
    let best = null, bestScore = 0;
    if (finite(widget.rect)) {
      for (const field of editable) {
        if (Number(field.page || 0) !== widget.page || !finite(field)) continue;
        const score = intersection(field, widget.rect) / area(widget.rect);
        if (score > bestScore) { best = field; bestScore = score; }
      }
    }
    if (best && bestScore >= IMPORT_LIMITS.minOverlap) {
      if (!groups.has(best.name)) groups.set(best.name, []);
      groups.get(best.name).push(widget);
    } else leftovers.push(widget);
  }
  const byName = new Map();
  for (const field of editable) {
    for (const key of [normalizeName(field.name), normalizeName(field.label)]) if (key && !byName.has(key)) byName.set(key, field);
  }
  for (const widget of leftovers) {
    const field = byName.get(normalizeName(widget.name));
    if (!field || groups.has(field.name)) continue;
    groups.set(field.name, [widget]);
  }
  const values = Object.create(null);
  const rejected = [];
  for (const field of editable) {
    const found = groups.get(field.name);
    if (!found) continue;
    const ordered = [...found].sort((a, b) => (a.rect?.y ?? 0) - (b.rect?.y ?? 0) || (a.rect?.x ?? 0) - (b.rect?.x ?? 0));
    let raw;
    if (field.type === "checkbox") raw = ordered.some((w) => w.value === true || w.value === "true");
    else {
      const parts = ordered.map((w) => (typeof w.value === "string" ? w.value.trim() : "")).filter(Boolean);
      raw = field.type === "textarea" ? parts.join("\n") : field.type === "text" ? parts.join(" ") : parts[0];
    }
    const value = coerceValue(field, raw);
    if (value !== null) values[field.name] = value;
    else if (raw !== false && raw != null && String(raw).trim()) rejected.push(field.label || field.name);
  }
  return { values, imported: Object.keys(values).length, rejected };
}
