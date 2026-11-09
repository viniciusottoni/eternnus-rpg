// Regras puras do editor de fichas-modelo (sem DOM, sem rede). Espelham os limites do servidor apenas para UX;
// o servidor (SheetTemplateService) reaplica tudo ao salvar e ao publicar.

export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const LIMITS = Object.freeze({
  pages: 50,
  fields: 300,
  actions: 100,
  minPage: 50,
  maxPage: 5000,
  minFont: 4,
  maxFont: 72,
  minField: 0.004,
  options: 50,
  optionLength: 80,
  notes: 1000,
  textLength: 10000,
  pdfBytes: 25 * 1024 * 1024,
  undo: 100,
});
export const A4 = Object.freeze({ width: 595.28, height: 841.89 });

/** Tipos de campo: valor gravado, rótulo, ícone (texto puro) e classe CSS fixa (nunca derivada do dado). */
export const FIELD_TYPES = Object.freeze([
  { value: "text", label: "Texto curto", icon: "T", css: "type-text" },
  { value: "number", label: "Número", icon: "#", css: "type-number" },
  { value: "textarea", label: "Texto longo", icon: "¶", css: "type-textarea" },
  { value: "checkbox", label: "Caixa de marcação", icon: "☑", css: "type-checkbox" },
  { value: "select", label: "Lista de opções", icon: "▾", css: "type-select" },
  { value: "computed", label: "Calculado (fórmula)", icon: "ƒ", css: "type-computed" },
]);
export const FIELD_ROLES = Object.freeze([
  { value: "name", label: "Nome do personagem", help: "Aparece no grupo da mesa, na lista de fichas e nos registros.", types: ["text"] },
  { value: "level", label: "Nível", help: "Mostrado no cartão do grupo da mesa.", types: ["number", "computed"] },
  { value: "hp", label: "Vida atual", help: "Alimenta a barra de vida da mesa; o mestre ajusta durante a sessão.", types: ["number", "computed"] },
  { value: "maxHp", label: "Vida máxima", help: "Limite da barra de vida e dos ajustes do mestre.", types: ["number", "computed"] },
  { value: "movement", label: "Deslocamento (m)", help: "Define quantas casas o personagem anda por turno no mapa (1,5 m por casa).", types: ["number", "computed"] },
  { value: "armor", label: "Armadura", help: "Mostrada ao mestre como defesa do personagem.", types: ["number", "computed"] },
  { value: "light", label: "Luz (m)", help: "Raio da luz que o personagem carrega; ilumina o mapa para todos.", types: ["number", "computed"] },
  { value: "vision", label: "Visão própria (m)", help: "Visão no escuro: só o dono do personagem enxerga essa área.", types: ["number", "computed"] },
  { value: "perception", label: "Percepção", help: "Percepção passiva: revela elementos ocultos com dificuldade igual ou menor.", types: ["number", "computed"] },
  { value: "reach", label: "Alcance de ataque (m)", help: "Mostrado no turno do jogador. Use um campo calculado para variar com a arma escolhida.", types: ["number", "computed"] },
  { value: "senses", label: "Sentidos especiais", help: "Um por linha, \"nome\" ou \"nome: metros\" (ex.: sentir magia: 9).", types: ["text", "textarea"] },
]);
export const ACTION_KINDS = Object.freeze([
  { value: "ataque", label: "Ataque", icon: "⚔" },
  { value: "habilidade", label: "Habilidade", icon: "✦" },
  { value: "magia", label: "Magia", icon: "✧" },
  { value: "item", label: "Item", icon: "⚗" },
]);
export const ALIGNS = Object.freeze([
  { value: "left", label: "Esquerda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Direita" },
]);
export const typeInfo = (type) => FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];
export const roleInfo = (role) => FIELD_ROLES.find((r) => r.value === role) || null;
export const kindInfo = (kind) => ACTION_KINDS.find((k) => k.value === kind) || ACTION_KINDS[0];

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const roundCoord = (v) => Math.round(v * 1e5) / 1e5;

// ---------- Nomes ----------

/** Mensagem de erro do nome (vazia se válido). `index` é a posição do próprio campo (ignorado na unicidade). */
export function validateFieldName(name, fields = [], index = -1) {
  const value = String(name ?? "");
  if (!value) return "Informe um nome.";
  if (!NAME_PATTERN.test(value))
    return "Use letra minúscula no início e só a–z, 0–9 e _ (até 40).";
  if (fields.some((f, i) => i !== index && f.name === value))
    return "Já existe um campo com esse nome.";
  return "";
}
export function validateActionKey(key, actions = [], index = -1) {
  const value = String(key ?? "");
  if (!NAME_PATTERN.test(value))
    return "Use letra minúscula no início e só a–z, 0–9 e _ (até 40).";
  if (actions.some((a, i) => i !== index && a.key === value))
    return "Já existe uma ação com essa chave.";
  return "";
}
/** Menor `base_N` livre (campo_1, campo_2…). */
export function suggestName(items = [], base = "campo", key = "name") {
  const used = new Set(items.map((f) => f[key]));
  for (let n = 1; n < 10000; n++) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}
/** Converte um rótulo ("Força Máx.") em nome válido e único ("forca_max"). */
export function nameFromLabel(label, items = [], index = -1, key = "name") {
  let base = String(label ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "campo";
  if (!/^[a-z]/.test(base)) base = "c_" + base;
  base = base.slice(0, 40).replace(/_+$/, "");
  const used = new Set(items.filter((_, i) => i !== index).map((f) => f[key]));
  if (!used.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const suffix = "_" + n;
    const candidate = base.slice(0, 40 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

// ---------- Geometria (coordenadas normalizadas 0..1, origem no canto superior esquerdo) ----------

/** Garante retângulo dentro da página e com tamanho mínimo. */
export function normalizeRect(rect, min = LIMITS.minField) {
  const w = clamp(Number(rect.w) || 0, min, 1);
  const h = clamp(Number(rect.h) || 0, min, 1);
  return {
    x: roundCoord(clamp(Number(rect.x) || 0, 0, 1 - w)),
    y: roundCoord(clamp(Number(rect.y) || 0, 0, 1 - h)),
    w: roundCoord(w),
    h: roundCoord(h),
  };
}
/** Retângulo entre dois pontos (qualquer direção de arrasto), limitado à página. */
export function rectFromPoints(a, b) {
  const x1 = clamp(Math.min(a.x, b.x), 0, 1),
    y1 = clamp(Math.min(a.y, b.y), 0, 1),
    x2 = clamp(Math.max(a.x, b.x), 0, 1),
    y2 = clamp(Math.max(a.y, b.y), 0, 1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
/** Converte pixels do elemento da página em coordenadas normalizadas. */
export function toNormalized(px, py, width, height) {
  return { x: width > 0 ? px / width : 0, y: height > 0 ? py / height : 0 };
}
export const snapValue = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
/** Encaixa as bordas na grade preservando o tamanho mínimo. */
export function snapRect(rect, step, min = LIMITS.minField) {
  if (!(step > 0)) return { ...rect };
  const x = snapValue(rect.x, step),
    y = snapValue(rect.y, step);
  const right = Math.max(x + min, snapValue(rect.x + rect.w, step)),
    bottom = Math.max(y + min, snapValue(rect.y + rect.h, step));
  return normalizeRect({ x, y, w: right - x, h: bottom - y }, min);
}
export function moveRect(rect, dx, dy) {
  return normalizeRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, Math.min(rect.w, rect.h, LIMITS.minField));
}
/** Redimensiona por uma alça (n, s, e, w, ne, nw, se, sw) sem inverter nem sair da página. */
export function resizeRect(rect, handle, dx, dy, min = LIMITS.minField) {
  let left = rect.x,
    top = rect.y,
    right = rect.x + rect.w,
    bottom = rect.y + rect.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - min);
  if (handle.includes("e")) right = clamp(right + dx, left + min, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, 1);
  return normalizeRect({ x: left, y: top, w: right - left, h: bottom - top }, min);
}
/**
 * Guias de alinhamento simples: encaixa bordas/centros do retângulo nos de outros campos quando estão a menos de `threshold`.
 * `mode` "move" preserva o tamanho; "resize" ajusta só as bordas indicadas por `handle`. Devolve { rect, lines: [{ axis, at }] }.
 */
export function alignGuides(rect, others, threshold, mode = "move", handle = "") {
  const out = { ...rect };
  const lines = [];
  const xs = [],
    ys = [];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const best = (candidates, targets) => {
    let found = null;
    for (const c of candidates)
      for (const t of targets) {
        const d = Math.abs(c.value - t);
        if (d <= threshold && (!found || d < found.d)) found = { d, delta: t - c.value, at: t };
      }
    return found;
  };
  const xCandidates =
    mode === "move"
      ? [{ value: rect.x }, { value: rect.x + rect.w / 2 }, { value: rect.x + rect.w }]
      : [
          ...(handle.includes("w") ? [{ value: rect.x, edge: "w" }] : []),
          ...(handle.includes("e") ? [{ value: rect.x + rect.w, edge: "e" }] : []),
        ];
  const yCandidates =
    mode === "move"
      ? [{ value: rect.y }, { value: rect.y + rect.h / 2 }, { value: rect.y + rect.h }]
      : [
          ...(handle.includes("n") ? [{ value: rect.y, edge: "n" }] : []),
          ...(handle.includes("s") ? [{ value: rect.y + rect.h, edge: "s" }] : []),
        ];
  const bx = best(xCandidates, xs);
  if (bx) {
    if (mode === "move") out.x = rect.x + bx.delta;
    else if (handle.includes("w")) {
      out.x = rect.x + bx.delta;
      out.w = rect.w - bx.delta;
    } else out.w = rect.w + bx.delta;
    lines.push({ axis: "x", at: bx.at });
  }
  const by = best(yCandidates, ys);
  if (by) {
    if (mode === "move") out.y = rect.y + by.delta;
    else if (handle.includes("n")) {
      out.y = rect.y + by.delta;
      out.h = rect.h - by.delta;
    } else out.h = rect.h + by.delta;
    lines.push({ axis: "y", at: by.at });
  }
  return { rect: out.w > 0 && out.h > 0 ? normalizeRect(out, Math.min(LIMITS.minField, rect.w, rect.h)) : rect, lines };
}

// ---------- Desfazer / refazer ----------

/** Pilha de estados (strings JSON ou objetos imutáveis). `push` antes de cada alteração. */
export class UndoStack {
  constructor(limit = LIMITS.undo) {
    this.limit = Math.max(50, limit);
    this.past = [];
    this.future = [];
  }
  push(state) {
    if (this.past.length && this.past[this.past.length - 1] === state) return;
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}

// ---------- Documento da versão ----------

const FIELD_DEFAULTS = { role: null, page: 0, formula: null, default: null, min: null, max: null, maxLength: null, fontSize: 10, align: "left" };
/** Campo com somente as propriedades conhecidas (remove marcas internas do editor e valores padrão), coordenadas arredondadas. */
export function compactField(f) {
  const out = {
    name: f.name,
    label: f.label || f.name,
    type: f.type,
    x: roundCoord(f.x),
    y: roundCoord(f.y),
    w: roundCoord(f.w),
    h: roundCoord(f.h),
  };
  for (const [key, fallback] of Object.entries(FIELD_DEFAULTS)) {
    const value = f[key];
    if (value === undefined || value === null || value === "" || value === fallback) continue;
    out[key] = value;
  }
  if (f.type === "select" && Array.isArray(f.options) && f.options.length) out.options = f.options.slice();
  if (f.type !== "computed") delete out.formula;
  return out;
}
export function compactAction(a) {
  const out = { key: a.key, name: a.name, kind: a.kind };
  if (a.formula) out.formula = a.formula;
  if (a.description) out.description = a.description;
  return out;
}
/** Corpo do PUT do rascunho, enxuto para caber no limite comum de requisição. */
export function compactDoc(doc) {
  return {
    pages: doc.pages.map((p) => ({ width: p.width, height: p.height })),
    fields: doc.fields.map(compactField),
    actions: doc.actions.map(compactAction),
    notes: doc.notes || "",
  };
}
/** Cópia normalizada de um campo vindo da API (todas as propriedades presentes). */
export function normalizeField(f) {
  return {
    name: f.name ?? "",
    label: f.label ?? "",
    type: f.type ?? "text",
    role: f.role ?? null,
    page: f.page ?? 0,
    x: f.x ?? 0,
    y: f.y ?? 0,
    w: f.w ?? 0.2,
    h: f.h ?? 0.04,
    formula: f.formula ?? null,
    default: f.default ?? null,
    min: f.min ?? null,
    max: f.max ?? null,
    maxLength: f.maxLength ?? null,
    options: Array.isArray(f.options) ? f.options.slice() : [],
    fontSize: f.fontSize ?? 10,
    align: f.align ?? "left",
  };
}
/** Novo campo criado por arrasto. Tipo e tamanho de fonte sugeridos pela altura. */
export function newField(rect, page, fields, pageHeightPt = A4.height) {
  const heightPt = rect.h * pageHeightPt;
  const tall = heightPt > 60;
  return {
    ...normalizeField({}),
    name: suggestName(fields),
    label: "",
    type: tall ? "textarea" : "text",
    page,
    ...normalizeRect(rect),
    fontSize: clamp(Math.round(Math.min(heightPt * 0.55, 14)), 6, 14),
  };
}
/** Duplicata deslocada levemente, com nome único (forca → forca_copia, forca_copia_2…). */
export function duplicateField(field, fields) {
  const base = (field.name + "_copia").slice(0, 40);
  const used = new Set(fields.map((f) => f.name));
  let name = base;
  for (let n = 2; used.has(name); n++) name = base.slice(0, 40 - String(n).length - 1) + "_" + n;
  const offset = 0.015;
  const rect = normalizeRect({
    x: field.x + field.w + offset <= 1 ? field.x + offset : field.x - offset,
    y: field.y + field.h + offset <= 1 ? field.y + offset : field.y - offset,
    w: field.w,
    h: field.h,
  });
  return { ...normalizeField(field), options: [...(field.options || [])], name, role: null, ...rect };
}
export const numericNames = (fields) => fields.filter((f) => f.type === "number" || f.type === "computed").map((f) => f.name);

/** Problemas estruturais (mesmos limites do servidor ao salvar). Itens: { field?, action?, message }. */
export function structuralIssues(doc) {
  const issues = [];
  const { pages = [], fields = [], actions = [], notes = "" } = doc;
  if (pages.length < 1 || pages.length > LIMITS.pages) issues.push({ message: `A ficha precisa ter de 1 a ${LIMITS.pages} páginas.` });
  if (pages.some((p) => !(p.width >= LIMITS.minPage && p.width <= LIMITS.maxPage && p.height >= LIMITS.minPage && p.height <= LIMITS.maxPage)))
    issues.push({ message: `Cada página deve medir entre ${LIMITS.minPage} e ${LIMITS.maxPage} pontos.` });
  if (fields.length > LIMITS.fields) issues.push({ message: `Use no máximo ${LIMITS.fields} campos.` });
  if (actions.length > LIMITS.actions) issues.push({ message: `Use no máximo ${LIMITS.actions} golpes e magias.` });
  if (String(notes).length > LIMITS.notes) issues.push({ message: `As notas da versão têm limite de ${LIMITS.notes} caracteres.` });
  const roles = new Set();
  fields.forEach((f, i) => {
    const field = NAME_PATTERN.test(f.name) ? f.name : null;
    const add = (message) => issues.push({ field, index: i, message: `Campo ${f.name || "(sem nome)"}: ${message}` });
    const nameError = validateFieldName(f.name, fields, i);
    if (nameError) add(nameError.charAt(0).toLowerCase() + nameError.slice(1));
    if ((f.label || "").length > 80) add("rótulo com mais de 80 caracteres.");
    if (!FIELD_TYPES.some((t) => t.value === f.type)) add("tipo desconhecido.");
    if (f.role) {
      if (!roleInfo(f.role)) add("papel desconhecido.");
      else if (roles.has(f.role)) add(`o papel "${roleInfo(f.role).label}" já está em outro campo.`);
      roles.add(f.role);
    }
    if (!(f.x >= 0 && f.y >= 0 && f.w >= LIMITS.minField && f.h >= LIMITS.minField && f.x + f.w <= 1.0001 && f.y + f.h <= 1.0001)) add("posição ou tamanho fora da página.");
    if ((f.formula || "").length > 300) add("fórmula com mais de 300 caracteres.");
    if ((f.default ?? "").length > 200) add("valor padrão com mais de 200 caracteres.");
    if (f.min != null && f.max != null && f.min > f.max) add("o mínimo é maior que o máximo.");
    if (f.maxLength != null && !(f.maxLength >= 1 && f.maxLength <= LIMITS.textLength)) add(`limite de caracteres entre 1 e ${LIMITS.textLength}.`);
    const options = f.type === "select" ? f.options || [] : [];
    if (options.length > LIMITS.options || options.some((o) => !String(o).trim() || String(o).length > LIMITS.optionLength))
      add(`até ${LIMITS.options} opções, cada uma com 1 a ${LIMITS.optionLength} caracteres.`);
    else if (new Set(options).size !== options.length) add("opções repetidas.");
    if (!(f.fontSize >= LIMITS.minFont && f.fontSize <= LIMITS.maxFont)) add(`tamanho de fonte entre ${LIMITS.minFont} e ${LIMITS.maxFont}.`);
  });
  actions.forEach((a, i) => {
    const action = NAME_PATTERN.test(a.key) ? a.key : null;
    const add = (message) => issues.push({ action, actionIndex: i, message: `Ação ${a.name || a.key || "(sem nome)"}: ${message}` });
    const keyError = validateActionKey(a.key, actions, i);
    if (keyError) add(keyError.charAt(0).toLowerCase() + keyError.slice(1));
    if (!String(a.name || "").trim() || a.name.length > 60) add("nome obrigatório, até 60 caracteres.");
    if (!ACTION_KINDS.some((k) => k.value === a.kind)) add("escolha o tipo.");
    if ((a.formula || "").length > 300) add("fórmula com mais de 300 caracteres.");
    if ((a.description || "").length > 300) add("descrição com mais de 300 caracteres.");
  });
  return issues;
}
/** Regras exigidas só para publicar (espelho de SemanticIssues no servidor). */
export function publishIssues(doc) {
  const issues = structuralIssues(doc);
  const { pages = [], fields = [] } = doc;
  if (!fields.length) issues.push({ message: "Desenhe ao menos um campo antes de publicar." });
  fields.forEach((f, i) => {
    const add = (message) => issues.push({ field: f.name, index: i, message: `Campo ${f.name}: ${message}` });
    if (f.page >= pages.length) add(`está na página ${f.page + 1}, mas a ficha tem ${pages.length}.`);
    const role = roleInfo(f.role);
    if (role && !role.types.includes(f.type)) add(role.value === "name" ? "o papel Nome exige um campo de texto." : role.value === "senses" ? "o papel Sentidos exige um campo de texto." : "este papel exige um campo numérico ou calculado.");
    if (f.type === "computed" && !String(f.formula || "").trim()) add("campo calculado precisa de fórmula.");
    if (f.type === "select" && !(f.options || []).length) add("lista de opções vazia.");
    if (f.default != null && f.default !== "") {
      if (f.type === "number" && !Number.isFinite(Number(f.default))) add("valor padrão precisa ser um número (use ponto como separador decimal).");
      if (f.type === "number" && Number.isFinite(Number(f.default)) && ((f.min != null && Number(f.default) < f.min) || (f.max != null && Number(f.default) > f.max)))
        add("valor padrão fora do mínimo/máximo.");
      if (f.type === "checkbox" && !["true", "false"].includes(f.default)) add("valor padrão da caixa deve ser marcado ou desmarcado.");
      if (f.type === "select" && !(f.options || []).includes(f.default)) add("valor padrão precisa ser uma das opções.");
    }
  });
  return issues;
}

/** Diferenças entre versões casando campos por NOME e ações por chave (mesma regra do servidor e da migração das fichas). */
export function diffVersions(before, after) {
  const oldFields = new Map((before?.fields || []).map((f) => [f.name, f]));
  const newNames = new Set((after?.fields || []).map((f) => f.name));
  const result = { added: [], removed: [], changed: [], moved: [], actionsAdded: [], actionsRemoved: [], actionsChanged: [] };
  const same = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-6;
  const norm = (v) => (v === undefined || v === null ? "" : String(v));
  for (const f of after?.fields || []) {
    const o = oldFields.get(f.name);
    if (!o) {
      result.added.push(f.name);
      continue;
    }
    const changes = [];
    if (norm(o.label) !== norm(f.label)) changes.push("label");
    if (o.type !== f.type) changes.push("type");
    if (norm(o.role) !== norm(f.role)) changes.push("role");
    if (norm(o.formula) !== norm(f.formula)) changes.push("formula");
    if (norm(o.default) !== norm(f.default)) changes.push("default");
    if (norm(o.min) !== norm(f.min)) changes.push("min");
    if (norm(o.max) !== norm(f.max)) changes.push("max");
    if (norm(o.maxLength) !== norm(f.maxLength)) changes.push("maxLength");
    if (JSON.stringify(o.options || []) !== JSON.stringify(f.options || [])) changes.push("options");
    if (changes.length) result.changed.push({ name: f.name, changes });
    else if ((o.page ?? 0) !== (f.page ?? 0) || !same(o.x, f.x) || !same(o.y, f.y) || !same(o.w, f.w) || !same(o.h, f.h) || !same(o.fontSize ?? 10, f.fontSize ?? 10) || (o.align || "left") !== (f.align || "left"))
      result.moved.push(f.name);
  }
  for (const f of before?.fields || []) if (!newNames.has(f.name)) result.removed.push(f.name);
  const oldActions = new Map((before?.actions || []).map((a) => [a.key, a]));
  const newKeys = new Set((after?.actions || []).map((a) => a.key));
  for (const a of after?.actions || []) {
    const o = oldActions.get(a.key);
    if (!o) result.actionsAdded.push(a.key);
    else if (norm(o.name) !== norm(a.name) || norm(o.kind) !== norm(a.kind) || norm(o.formula) !== norm(a.formula) || norm(o.description) !== norm(a.description))
      result.actionsChanged.push(a.key);
  }
  for (const a of before?.actions || []) if (!newKeys.has(a.key)) result.actionsRemoved.push(a.key);
  return result;
}
export const CHANGE_LABELS = Object.freeze({
  label: "rótulo",
  type: "tipo",
  role: "papel",
  formula: "fórmula",
  default: "padrão",
  min: "mínimo",
  max: "máximo",
  maxLength: "limite de caracteres",
  options: "opções",
});
export const diffIsEmpty = (d) => Object.values(d).every((v) => !v.length);

// ---------- Valores de exemplo e fórmulas ----------

/** Valor de exemplo coerente com o tipo (usado no teste da ficha e nas prévias de fórmula). */
export function sampleValue(field) {
  if (field.type === "computed") return "";
  if (field.default != null && field.default !== "") return String(field.default);
  if (field.role === "name") return "Tharion";
  switch (field.type) {
    case "number": {
      const min = field.min ?? null,
        max = field.max ?? null;
      let v = field.role === "level" ? 3 : field.role === "movement" ? 9 : 10;
      if (min != null) v = Math.max(v, min);
      if (max != null) v = Math.min(v, max);
      return String(v);
    }
    case "checkbox":
      return "false";
    case "select":
      return (field.options || [])[0] ?? "";
    case "textarea":
      return "Anotações de exemplo.";
    default:
      return field.label ? `${field.label}` : "Exemplo";
  }
}
export function sampleValues(fields) {
  const values = {};
  for (const f of fields) values[f.name] = sampleValue(f);
  return values;
}
/** Escopo numérico (@nome → número) a partir de valores de texto. */
export function numericScope(fields, values) {
  const scope = {};
  for (const name of numericNames(fields)) {
    const n = Number(values?.[name]);
    scope[name] = Number.isFinite(n) ? n : 0;
  }
  return scope;
}
/** Sugestões de @nome para o texto antes do cursor. Devolve { start, query, items }. */
export function referenceSuggestions(text, caret, names, limit = 8) {
  const before = String(text ?? "").slice(0, caret ?? String(text ?? "").length);
  const match = /@([a-z0-9_]*)$/.exec(before);
  if (!match) return { start: -1, query: "", items: [] };
  const query = match[1];
  const items = names.filter((n) => n.startsWith(query)).concat(names.filter((n) => !n.startsWith(query) && n.includes(query)));
  return { start: before.length - match[0].length, query, items: items.slice(0, limit) };
}
/** Insere a sugestão escolhida no lugar do @parcial. */
export function applySuggestion(text, start, caret, name) {
  const value = String(text ?? "");
  const insert = "@" + name;
  return { text: value.slice(0, start) + insert + value.slice(caret), caret: start + insert.length };
}
/** Nomes que deixaram de existir em relação à versão publicada (para o aviso de vínculo perdido). */
export function lostOnRename(originalName, newName, publishedNames) {
  return !!originalName && originalName !== newName && publishedNames.includes(originalName);
}

/**
 * Atributos numéricos de um modelo simples (seções com campos por rótulo), com os mesmos nomes que o servidor gera
 * (PreparationJournal.Slug): sem acentos, minúsculas, "_" entre palavras, até 34 caracteres, repetições com _2, _3…
 */
export function simpleTemplateFormulaFields(sections = []) {
  const used = new Set();
  const slug = (label) => {
    let clean = String(label).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!clean || !/^[a-z]/.test(clean)) clean = "campo_" + clean;
    if (clean.length > 34) clean = clean.slice(0, 34).replace(/_+$/, "");
    let candidate = clean, n = 2;
    while (used.has(candidate)) candidate = `${clean}_${n++}`;
    used.add(candidate);
    return candidate;
  };
  const all = sections.flatMap((s) => s.fields || []);
  const hasName = all.some((f) => f.type === "text" && String(f.label || "").trim().toLowerCase() === "nome");
  if (!hasName) slug("Nome");
  const out = [];
  for (const f of all) {
    const label = String(f.label || "").trim();
    if (!label) continue;
    const name = slug(label);
    if (f.type === "number") out.push({ name, label });
  }
  return out;
}

