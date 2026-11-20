// Regras puras das dicas do editor (ADR-124): nível de intimidade do mestre com a plataforma, escolha da próxima dica
// e normalização do estado guardado neste navegador. Sem DOM, sem rede e sem telemetria: os sinais ficam só no
// localStorage da conta neste navegador e servem apenas para escolher a dica.

/** Tempo entre dicas com a barra sem seleção (a troca pausa com o ponteiro ou o foco na barra e com a aba oculta). */
export const TIP_INTERVAL_MS = 30000;
/** Níveis de intimidade, do primeiro contato ao domínio. */
export const TIP_LEVELS = Object.freeze([
  Object.freeze({ id: 1, label: "Primeiros passos" }),
  Object.freeze({ id: 2, label: "Ganhando ritmo" }),
  Object.freeze({ id: 3, label: "Domínio" }),
]);
/** Editores que mostram dicas: cena, preparação compartilhada do mapa e mapa de imagem (os que têm barra de propriedades). */
export const TIP_EDITORS = Object.freeze(["scene", "map-prep", "image"]);
/** Contextos aceitos no catálogo (os mesmos ids de `EDITOR_CONTEXTS`); "*" vale em qualquer contexto. */
export const TIP_CONTEXTS = Object.freeze(["*", "compose", "elements", "walls", "light", "explore", "scene"]);
export const TIP_TEXT_MAX = 200;
const TIP_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const TOOL_ID = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
/** Quantas dicas recentes não se repetem (por editor), e limites do estado guardado. */
const RECENT = 24, MAX_SEEN = 800, MAX_TOOLS = 80, CAP = 100000;

/** Chave do armazenamento local por conta (mesmo padrão do layout do editor). */
export const tipsStoreKey = (userId) => `eternnus.editor.tips.${/^[a-zA-Z0-9-]{1,64}$/.test(String(userId || "")) ? userId : "anon"}`;

const count = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, CAP) : 0; };
const counts = (raw, max, valid) => {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, max)) if (valid(k) && count(v)) out[k] = count(v);
  return out;
};

/** Estado local: aberturas por editor, usos de ferramentas, contextos visitados, vezes que cada dica apareceu e preferências. */
export function normalizeTipState(raw) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    v: 1,
    opens: counts(s.opens, TIP_EDITORS.length, (k) => TIP_EDITORS.includes(k)),
    tools: counts(s.tools, MAX_TOOLS, (k) => TOOL_ID.test(k)),
    contexts: counts(s.contexts, TIP_CONTEXTS.length, (k) => TIP_CONTEXTS.includes(k) && k !== "*"),
    seen: counts(s.seen, MAX_SEEN, (k) => TIP_ID.test(k)),
    recent: Array.isArray(s.recent) ? s.recent.filter((id) => TIP_ID.test(String(id))).slice(-RECENT) : [],
  };
}

const bump = (map, key, max) => {
  const next = { ...map, [key]: Math.min((map[key] || 0) + 1, CAP) };
  const keys = Object.keys(next);
  if (keys.length > max) delete next[keys[0]];
  return next;
};
/** Registra um sinal (sem mutar o estado recebido). `kind`: "open" | "tool" | "context" | "seen". */
export function recordTipSignal(state, kind, id) {
  const s = normalizeTipState(state);
  const key = String(id || "");
  if (kind === "open" && TIP_EDITORS.includes(key)) s.opens = bump(s.opens, key, TIP_EDITORS.length);
  else if (kind === "tool" && TOOL_ID.test(key)) s.tools = bump(s.tools, key, MAX_TOOLS);
  else if (kind === "context" && TIP_CONTEXTS.includes(key) && key !== "*") s.contexts = bump(s.contexts, key, TIP_CONTEXTS.length);
  else if (kind === "seen" && TIP_ID.test(key)) { s.seen = bump(s.seen, key, MAX_SEEN); s.recent = [...s.recent.filter((x) => x !== key), key].slice(-RECENT); }
  return s;
}

const sum = (map) => Object.values(map).reduce((a, b) => a + b, 0);
/**
 * Pontuação de intimidade: aberturas do editor, variedade de ferramentas, volume de uso, contextos visitados e a
 * interface Completa. Cada parcela tem teto, para que só repetir a mesma ação não pule etapas.
 */
export function familiarityScore(state, mode = "basic") {
  const s = normalizeTipState(state);
  return Math.min(sum(s.opens), 30) * 2
    + Math.min(Object.keys(s.tools).length, 25) * 3
    + Math.min(Math.floor(sum(s.tools) / 10), 20)
    + Math.min(Object.keys(s.contexts).length, 6) * 2
    + (mode === "complete" ? 10 : 0);
}
/** Nível 1 (primeiros passos), 2 (ganhando ritmo) ou 3 (domínio). */
export function familiarityLevel(state, mode = "basic") {
  const score = familiarityScore(state, mode);
  return score < 24 ? 1 : score < 70 ? 2 : 3;
}

/** Problema de uma dica do catálogo (ou null). Texto puro, sem HTML; contexto, nível, interface e ferramenta válidos. */
export function tipProblem(tip) {
  if (!tip || typeof tip !== "object") return "dica inválida";
  if (!TIP_ID.test(String(tip.id || ""))) return `id inválido: ${tip.id}`;
  const text = String(tip.text || "");
  if (!text.trim() || text.length > TIP_TEXT_MAX) return `${tip.id}: texto vazio ou com mais de ${TIP_TEXT_MAX} caracteres`;
  if (/[<>]/.test(text)) return `${tip.id}: o texto não aceita marcação`;
  if (![1, 2, 3].includes(tip.level)) return `${tip.id}: nível deve ser 1, 2 ou 3`;
  if (!TIP_CONTEXTS.includes(tip.ctx)) return `${tip.id}: contexto desconhecido ${tip.ctx}`;
  if (tip.ui != null && tip.ui !== "basic" && tip.ui !== "complete") return `${tip.id}: interface deve ser basic ou complete`;
  if (tip.tool != null && !TOOL_ID.test(String(tip.tool))) return `${tip.id}: ferramenta inválida`;
  if (tip.ed != null && (!Array.isArray(tip.ed) || !tip.ed.length || tip.ed.some((e) => !TIP_EDITORS.includes(e)))) return `${tip.id}: editor desconhecido`;
  return null;
}

/**
 * Dicas que valem agora: editor, contexto, interface, nível (nunca acima do do mestre) e ferramenta disponível.
 * `toolReady(id)` diz se a ferramenta citada existe e está visível nesta cena e nesta interface.
 */
export function eligibleTips(catalog, { editor, context, mode = "basic", level = 1, toolReady = () => true } = {}) {
  return (catalog || []).filter((t) => !tipProblem(t)
    && (!t.ed || t.ed.includes(editor))
    && (t.ctx === "*" || t.ctx === context)
    && (!t.ui || t.ui === mode)
    && t.level <= level
    && (!t.tool || toolReady(t.tool)));
}

/**
 * Peso de cada dica elegível: nunca vista vale mais; o nível atual vale mais que os anteriores; a do contexto atual
 * vale mais que a geral; uma ferramenta ainda não usada é sugerida antes de uma que o mestre já domina.
 */
export function tipWeight(tip, { state, level = 1 } = {}) {
  const s = normalizeTipState(state);
  const seen = s.seen[tip.id] || 0;
  let w = seen ? 1 / (1 + seen) : 4;
  if (tip.level === level) w *= 2;
  if (tip.ctx !== "*") w *= 1.5;
  if (tip.tool) w *= s.tools[tip.tool] ? (s.tools[tip.tool] > 5 ? 0.4 : 1) : 2;
  return w;
}

/**
 * Escolhe a próxima dica. Evita as recentes (e a atual) enquanto houver alternativa. `random` é injetável para testes.
 * Devolve null quando nada vale (o editor mostra então o texto fixo da barra).
 */
export function pickTip(catalog, { editor, context, mode = "basic", state, toolReady, currentId = "", random = Math.random } = {}) {
  const s = normalizeTipState(state);
  const level = familiarityLevel(s, mode);
  const all = eligibleTips(catalog, { editor, context, mode, level, toolReady });
  if (!all.length) return null;
  const recent = new Set([...s.recent, currentId]);
  const fresh = all.filter((t) => !recent.has(t.id));
  const pool = fresh.length ? fresh : all.filter((t) => t.id !== currentId);
  const list = pool.length ? pool : all;
  const weights = list.map((t) => tipWeight(t, { state: s, level }));
  let r = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r < 0) return list[i]; }
  return list[list.length - 1];
}

/** Rótulo do nível para leitores de tela e para a dica do botão de ajuda. */
export const levelLabel = (level) => (TIP_LEVELS.find((l) => l.id === level) || TIP_LEVELS[0]).label;
