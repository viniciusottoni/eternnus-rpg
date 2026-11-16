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

// ---------- Contextos de trabalho (ADR-086) ----------
// Modos de trabalho do mesmo documento: só reorganizam ferramentas e painéis visíveis. Nunca mudam dados, seleção,
// câmera, histórico ou regras. Cada editor declara os contextos que tem; os rótulos podem ser trocados pelo editor.

/** Catálogo dos contextos (ordem de exibição, ícone do núcleo e descrição curta para a dica). */
export const EDITOR_CONTEXTS = Object.freeze([
  Object.freeze({ id: "compose", label: "Composição", icon: "image", tip: "Imagens da cena por cima do mapa: arrastar, posicionar, redimensionar, girar e organizar em camadas." }),
  Object.freeze({ id: "elements", label: "Elementos", icon: "character", tip: "Selecionar, mover e transformar objetos, personagens e recursos visuais." }),
  Object.freeze({ id: "terrain", label: "Terreno", icon: "brush", tip: "Pintar tiles, preencher áreas, texturas e superfícies do mapa." }),
  Object.freeze({ id: "walls", label: "Paredes e portas", icon: "wall", tip: "Construir obstáculos, portas, janelas e passagens." }),
  Object.freeze({ id: "light", label: "Iluminação", icon: "light", tip: "Focos de luz, alcance, intensidade e névoa do mapa." }),
  Object.freeze({ id: "explore", label: "Exploração", icon: "fog", tip: "Revelar, cobrir, marcas ocultas e visão dos personagens." }),
  Object.freeze({ id: "scene", label: "Cena", icon: "scenery", tip: "Cenário, textos, notas, grade e propriedades da apresentação." }),
]);
const CONTEXT_IDS = new Set(EDITOR_CONTEXTS.map((c) => c.id));
export const isContextId = (id) => CONTEXT_IDS.has(String(id));

/**
 * Normaliza a declaração de contextos de um editor: `[{ id, label?, icon?, tip?, tools?:[ids], groups?:[ids], panels?:[ids], defaultTool? }]`.
 * Ids fora do catálogo e repetidos são descartados; a ordem segue o catálogo.
 */
export function normalizeContexts(list) {
  const input = Array.isArray(list) ? list.filter((c) => c && isContextId(c.id)) : [];
  const out = [];
  for (const base of EDITOR_CONTEXTS) {
    const c = input.find((x) => x.id === base.id);
    if (!c) continue;
    out.push({
      id: base.id, label: String(c.label || base.label).slice(0, 40), icon: c.icon || base.icon, tip: String(c.tip || base.tip).slice(0, 240),
      tools: new Set((c.tools || []).map(String)), groups: new Set((c.groups || []).map(String)), panels: new Set((c.panels || []).map(String)),
      defaultTool: c.defaultTool || null,
    });
  }
  return out;
}

const listOf = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);
/** Contextos aos quais um item (ferramenta ou painel) pertence; "*" = todos; vazio = nenhum declarado. */
function memberships(item, contexts, kind) {
  const own = listOf(item.context);
  if (own.length) return own;
  return contexts.filter((c) => (kind === "panel" ? c.panels.has(item.id) : c.tools.has(item.id) || (item.group != null && c.groups.has(String(item.group))))).map((c) => c.id);
}
/**
 * A ferramenta aparece no contexto? Sem contextos declarados, ou sem pertencer a nenhum, aparece sempre (nada fica inalcançável).
 * `common` lista as ferramentas presentes em todos os contextos (selecionar, mão, zoom).
 */
export function toolInContext(tool, contextId, contexts, common = []) {
  if (!contexts?.length || !contextId) return true;
  if (common.includes(tool.id)) return true;
  const m = memberships(tool, contexts, "tool");
  return !m.length || m.includes("*") || m.includes(contextId);
}
/** O painel aparece no contexto? Mesmas regras das ferramentas. */
export function panelInContext(panel, contextId, contexts) {
  if (!contexts?.length || !contextId) return true;
  const m = memberships(panel, contexts, "panel");
  return !m.length || m.includes("*") || m.includes(contextId);
}
/**
 * Contextos com alguma ferramenta própria visível (não comum) na interface atual. `visible(tool)` decide hidden/Básica.
 * Contexto só com painéis também conta (ex.: Cena com propriedades).
 */
export function availableContexts(contexts, tools, visible, common = []) {
  return contexts.filter((c) => c.panels.size > 0 || tools.some((t) => visible(t) && !common.includes(t.id) && memberships(t, contexts, "tool").includes(c.id)));
}
/**
 * Ferramenta após trocar de contexto: mantém a atual se ela continua visível; senão a padrão do contexto; senão a primeira
 * ferramenta de uso (sem `action`) visível. `candidates` = ferramentas visíveis no novo contexto, na ordem da barra.
 */
export function toolAfterContext(current, candidates, defaultTool = null) {
  const usable = candidates.filter((t) => !t.action);
  if (usable.some((t) => t.id === current)) return current;
  if (defaultTool && usable.some((t) => t.id === defaultTool)) return defaultTool;
  return usable[0]?.id ?? current;
}
/** Alt+1…Alt+9 escolhe o contexto pela posição (tecla física, não depende do layout). → índice 0–8 ou −1. */
export function contextShortcutIndex(e) {
  if (!e?.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1;
  const m = /^Digit([1-9])$/.exec(String(e.code || "")) || /^([1-9])$/.exec(String(e.key || ""));
  return m ? Number(m[1]) - 1 : -1;
}

// ---------- Preferências visuais do editor (ADR-086) ----------
// Só apresentação, por conta neste navegador: nunca entram no documento, no mapa ou na cena.

export const PANEL_WIDTH = Object.freeze({ min: 220, max: 520 });
export const CONTEXT_BAR_POSITIONS = Object.freeze(["top", "bottom", "off"]);
/** Chave de armazenamento por usuário (sem usuário: chave compartilhada antiga). */
export const layoutPrefKey = (userId) => (userId && /^[A-Za-z0-9_-]{1,64}$/.test(String(userId)) ? `eternnus.editor.layout.${userId}` : "eternnus.editor.layout");
const KIND = /^[a-z][a-z0-9-]{0,23}$/;
const PANEL_ID = /^[a-zA-Z0-9_-]{1,32}$/;
/** Preferência lida do armazenamento, com tipos e limites aplicados. Valores inválidos voltam ao padrão. */
export function normalizeLayoutPref(raw) {
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  const width = Math.round(Number(p.width));
  if (Number.isFinite(width) && width > 0) out.width = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, width));
  if (Array.isArray(p.closed)) out.closed = [...new Set(p.closed.map(String).filter((id) => PANEL_ID.test(id)))].slice(0, 24);
  if (p.rulers === false) out.rulers = false;
  if (CONTEXT_BAR_POSITIONS.includes(p.bar)) out.bar = p.bar;
  const maps = (value, ok) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entries = Object.entries(value).filter(([k, v]) => KIND.test(k) && ok(v)).slice(0, 12);
    return entries.length ? Object.fromEntries(entries) : null;
  };
  const contexts = maps(p.contexts, (v) => isContextId(v));
  if (contexts) out.contexts = contexts;
  const order = maps(p.order, (v) => Array.isArray(v) && v.every((id) => PANEL_ID.test(String(id))));
  if (order) out.order = Object.fromEntries(Object.entries(order).map(([k, v]) => [k, [...new Set(v.map(String))].slice(0, 24)]));
  return out;
}
/** Ordem dos painéis: a salva primeiro (só ids conhecidos), depois os novos na ordem declarada. */
export function panelOrder(declared, saved = []) {
  const known = declared.map(String);
  const first = (saved || []).map(String).filter((id) => known.includes(id));
  return [...new Set([...first, ...known])];
}
/** Move um painel `delta` posições (−1 sobe, +1 desce) dentro da ordem. */
export function movePanel(order, id, delta) {
  const list = [...order];
  const i = list.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}
