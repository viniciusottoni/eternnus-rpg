// Regras puras do núcleo gráfico (ADR-081): histórico, atalhos, camadas e geometria de câmera/menus.
// Sem DOM nem HTTP: usadas pelos editores de mapas e cenas e testadas em Node.

/** Camadas obrigatórias, sempre nesta ordem (de baixo para cima). */
export const REQUIRED_LAYERS = Object.freeze([
  Object.freeze({ id: "base", name: "Base", kind: "base" }),
  Object.freeze({ id: "elements", name: "Elementos", kind: "elements" }),
]);
export const MAX_LAYERS = 8;
export const MAX_HISTORY = 100;
const LAYER_ID = /^[a-z0-9-]{1,24}$/;

/** Camada com valores padrão e limites aplicados (nome 1–40, opacidade 0–100). */
export function normalizeLayer(layer, fallback = {}) {
  const name = String(layer?.name ?? fallback.name ?? "Camada").trim().slice(0, 40) || fallback.name || "Camada";
  const opacity = Math.round(Number(layer?.opacity ?? 100));
  return {
    ...layer,
    id: String(layer?.id ?? fallback.id ?? ""),
    name,
    kind: layer?.kind ?? fallback.kind ?? "custom",
    visible: layer?.visible !== false,
    locked: !!layer?.locked,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) : 100,
  };
}

/** Garante Base e Elementos nas duas primeiras posições e no máximo oito camadas; preserva extras válidas. */
export function ensureLayers(layers) {
  const list = Array.isArray(layers) ? layers : [];
  const byId = new Map(list.filter((l) => l && LAYER_ID.test(String(l.id))).map((l) => [String(l.id), l]));
  const required = REQUIRED_LAYERS.map((r) => normalizeLayer({ ...r, ...(byId.get(r.id) || {}), id: r.id, kind: r.kind }, r));
  const extras = list.filter((l) => l && LAYER_ID.test(String(l.id)) && !REQUIRED_LAYERS.some((r) => r.id === l.id))
    .filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i)
    .map((l) => normalizeLayer({ ...l, kind: "custom" }));
  return [...required, ...extras].slice(0, MAX_LAYERS);
}

export const isRequiredLayer = (id) => REQUIRED_LAYERS.some((r) => r.id === id);

/** Identificador novo e único (minúsculas, até 24 caracteres). */
export function newLayerId(layers, prefix = "camada") {
  const used = new Set((layers || []).map((l) => l.id));
  for (let i = 1; i < 1000; i++) {
    const id = `${prefix}-${i}`.slice(0, 24);
    if (!used.has(id)) return id;
  }
  return `${prefix}-${Date.now().toString(36)}`.slice(0, 24);
}

/** Acrescenta uma camada extra no topo (ou acima de `after`). Devolve { layers, id } ou { error }. */
export function addLayer(layers, name = "", after = null, extra = {}) {
  if (layers.length >= MAX_LAYERS) return { error: `Use até ${MAX_LAYERS} camadas por documento.` };
  const id = newLayerId(layers);
  const layer = normalizeLayer({ id, name: name || `Camada ${layers.length - 1}`, kind: "custom", ...extra });
  const index = after ? Math.max(2, layers.findIndex((l) => l.id === after) + 1) : layers.length;
  const next = [...layers];
  next.splice(Math.min(Math.max(2, index), next.length), 0, layer);
  return { layers: next, id };
}

/** Remove uma camada extra; Base e Elementos são obrigatórias. */
export function removeLayer(layers, id) {
  if (isRequiredLayer(id)) return { error: "Base e Elementos são camadas obrigatórias." };
  if (!layers.some((l) => l.id === id)) return { error: "Camada não encontrada." };
  return { layers: layers.filter((l) => l.id !== id) };
}

/** Move uma camada extra para cima (+1) ou para baixo (−1) sem passar abaixo de Elementos. */
export function moveLayer(layers, id, delta) {
  const index = layers.findIndex((l) => l.id === id);
  if (index < 2) return { error: "Base e Elementos ficam sempre embaixo; reordene as camadas extras." };
  const target = index + delta;
  if (target < 2 || target >= layers.length) return { layers };
  const next = [...layers];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return { layers: next };
}

/** Altera uma propriedade simples (visível, bloqueada, opacidade, nome). */
export function patchLayer(layers, id, patch) {
  return layers.map((l) => (l.id === id ? normalizeLayer({ ...l, ...patch, id: l.id, kind: l.kind }) : l));
}

/**
 * Histórico por instantâneos. `capture()` devolve um estado serializável; `restore(state)` o aplica.
 * `begin/commit` agrupam um arraste numa entrada; `record(label)` registra o estado anterior a uma mudança imediata.
 */
export function createHistory({ capture, restore, limit = MAX_HISTORY, onChange = () => {} }) {
  const undo = [], redo = [];
  let pending = null, savedMark = 0, counter = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const changed = () => onChange(api);
  function push(entry) {
    undo.push(entry);
    if (undo.length > limit) undo.shift();
    redo.length = 0;
    changed();
  }
  const api = {
    /** Registra o estado atual como "antes" de uma mudança imediata. */
    record(label) { pending = null; push({ label, snap: capture(), id: ++counter, at: Date.now() }); },
    begin(label) { pending = { label, snap: capture() }; },
    /** Fecha o agrupamento: só entra no histórico se o estado mudou. */
    commit() {
      if (!pending) return false;
      const entry = pending; pending = null;
      if (same(entry.snap, capture())) return false;
      push({ ...entry, id: ++counter, at: Date.now() });
      return true;
    },
    /** Cancela o agrupamento devolvendo o estado anterior (Esc durante um arraste). */
    cancel() { if (!pending) return; const snap = pending.snap; pending = null; restore(snap); changed(); },
    get pending() { return !!pending; },
    undo() {
      const entry = undo.pop();
      if (!entry) return null;
      redo.push({ ...entry, snap: capture() });
      restore(entry.snap); changed();
      return entry.label;
    },
    redo() {
      const entry = redo.pop();
      if (!entry) return null;
      undo.push({ ...entry, snap: capture() });
      restore(entry.snap); changed();
      return entry.label;
    },
    /** Volta ou avança até a entrada `index` da lista combinada (0 = estado inicial). */
    jump(index) {
      while (undo.length > index && undo.length) api.undo();
      while (undo.length < index && redo.length) api.redo();
    },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    get undoLabel() { return undo.at(-1)?.label || ""; },
    get redoLabel() { return redo.at(-1)?.label || ""; },
    /** Entradas para o painel Histórico: feitas (em ordem) e desfeitas (que ainda podem ser refeitas). */
    entries() {
      return [
        ...undo.map((e, i) => ({ label: e.label, index: i + 1, done: true, at: e.at })),
        ...[...redo].reverse().map((e, i) => ({ label: e.label, index: undo.length + i + 1, done: false, at: e.at })),
      ];
    },
    get position() { return undo.length; },
    clear() { undo.length = 0; redo.length = 0; pending = null; savedMark = 0; changed(); },
    markSaved() { savedMark = counter; changed(); },
    get savedMark() { return savedMark; },
  };
  return api;
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);
/** Verdadeiro quando a tecla pertence a um campo de texto (atalhos de letra, Delete e setas não podem agir). */
export function isTypingTarget(el) {
  if (!el || typeof el !== "object") return false;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  if (tag === "input") return TEXT_INPUTS.has(String(el.type || "").toLowerCase());
  return false;
}

/** Identificador normalizado do atalho: "mod+shift+z", "delete", "v", "mod+0", "space". */
export function shortcutOf(e) {
  let key = String(e.key || "");
  if (key === " " || key === "Spacebar") key = "space";
  else if (key === "Del") key = "delete";
  else if (key === "+" || key === "=") key = "plus";
  else if (key === "-" || key === "_") key = "minus";
  key = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  // Shift muda o caractere de dígitos/símbolos; usa a tecla física quando disponível.
  if (/^Digit\d$/.test(e.code || "") && (e.ctrlKey || e.metaKey)) key = e.code.slice(5);
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && key.length > 1 || e.shiftKey && (e.ctrlKey || e.metaKey)) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/** Atalhos que valem mesmo com o foco num campo de texto. */
export const FIELD_SAFE = new Set(["mod+s", "escape"]);

/** Rótulo exibido do atalho (Ctrl+Shift+Z). */
export function shortcutLabel(id) {
  if (!id) return "";
  return id.split("+").map((p) => ({ mod: "Ctrl", shift: "Shift", alt: "Alt", delete: "Delete", escape: "Esc", plus: "+", minus: "−", space: "Espaço", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" }[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))).join("+");
}

/** Posição de um menu de `w × h` aberto em (x, y), mantida dentro da janela com margem. */
export function clampMenu(x, y, w, h, vw, vh, margin = 6) {
  return {
    x: Math.max(margin, Math.min(x, vw - w - margin)),
    y: Math.max(margin, Math.min(y, vh - h - margin)),
  };
}

/**
 * Zoom ancorado: devolve o novo deslocamento da vista para que o ponto sob o cursor (sx, sy) continue no mesmo lugar.
 * `view` = { x, y, scale } (documento → tela: tela = doc * scale + view.x).
 */
export function zoomAround(view, nextScale, sx, sy) {
  const docX = (sx - view.x) / view.scale, docY = (sy - view.y) / view.scale;
  return { scale: nextScale, x: sx - docX * nextScale, y: sy - docY * nextScale };
}

/** Escala para caber um retângulo de documento (w × h) numa área (aw × ah) com margem. */
export function fitScale(w, h, aw, ah, margin = 32) {
  if (!(w > 0 && h > 0 && aw > 0 && ah > 0)) return 1;
  return Math.max(0.02, Math.min((aw - margin * 2) / w, (ah - margin * 2) / h));
}

/** Próximo passo de zoom (fator 1,25), limitado. */
export function stepZoom(scale, direction, min = 0.05, max = 16) {
  const next = direction > 0 ? scale * 1.25 : scale / 1.25;
  return Math.max(min, Math.min(max, next));
}

/** Porcentagem legível do zoom. */
export const zoomLabel = (scale) => `${Math.round(scale * 100)}%`;

// ---------- Réguas ----------
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
/**
 * Divisões da régua alinhadas à grade: cada marca maior vale um número "redondo" de casas (1, 2, 5, 10…) com pelo menos
 * `minMajorPx` pixels de tela; as menores marcam cada casa (ou frações da casa quando ela está grande na tela).
 * `cellPx`: pixels de tela por casa; `cellUnits`: metros (ou pixels) por casa.
 */
export function rulerSteps(cellPx, cellUnits, minMajorPx = 56) {
  if (!(cellPx > 0) || !(cellUnits > 0) || !Number.isFinite(cellPx) || !Number.isFinite(cellUnits)) return null;
  const k = RULER_STEPS.find((n) => n * cellPx >= minMajorPx) ?? RULER_STEPS.at(-1);
  const majorPx = k * cellPx;
  const options = k === 1 ? [4, 2] : [k, 10, 5, 2].filter((d) => k % d === 0);
  const d = options.find((n) => majorPx / n >= 6) || 1;
  return { majorPx, majorUnits: k * cellUnits, minorPx: d > 1 ? majorPx / d : 0 };
}
/** Rótulo curto da régua (até duas casas decimais, vírgula decimal). */
export const rulerLabel = (value) => {
  const v = Math.round(value * 100) / 100;
  return (Object.is(v, -0) ? 0 : v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
};
