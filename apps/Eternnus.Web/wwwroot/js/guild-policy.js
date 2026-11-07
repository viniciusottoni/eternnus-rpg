// Regras puras da Guilda (sem DOM e sem rede). Espelham o servidor apenas para UX; o servidor sempre reaplica as regras.

export const PAGE_SIZE = 20;
export const LIMITS = Object.freeze({
  titleMin: 4,
  titleMax: 140,
  bodyMin: 2,
  bodyMax: 10000,
  reasonMin: 3,
  reasonMax: 300,
  reportMin: 5,
  reportMax: 500,
  noteMax: 500,
  searchMax: 100,
});
export const DEFAULT_AVATAR = "/assets/avatar.svg";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isGuid = (value) => GUID.test(String(value ?? ""));
export const isSlug = (value) => String(value ?? "").length <= 60 && SLUG.test(String(value ?? ""));

/**
 * Rotas da Guilda a partir dos segmentos após "#guild":
 * [] → salão; ["c", slug] → categoria; ["t", id, página?] → tópico; ["moderation", aba?] → moderação.
 * Segmentos inválidos voltam ao salão.
 */
export function parseGuildRoute(segments = []) {
  const [kind = "", a = "", b = ""] = segments;
  if (kind === "c" && isSlug(a)) return { view: "category", slug: a };
  if (kind === "t" && isGuid(a)) return { view: "topic", id: a.toLowerCase(), page: positiveInt(b, 1) };
  if (kind === "moderation") {
    const tab = ["open", "resolved", "topics", "categories"].includes(a) ? a : "open";
    return { view: "moderation", tab };
  }
  return { view: "hall" };
}
function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : fallback;
}

/** Datas da API são UTC; sem sufixo de fuso, assume-se UTC. */
export function parseDate(value) {
  if (value instanceof Date) return value;
  const text = String(value ?? "");
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text + "Z");
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Data relativa em pt-BR: "agora mesmo", "há 5 min", "há 3 h", "ontem", "há 4 dias", depois data curta. */
export function relativeTime(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return "";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return "agora mesmo";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const URL_CANDIDATE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?…)\]}»"']$/;
const count = (text, char) => text.split(char).length - 1;

/** Valida e normaliza um link http(s); devolve null para qualquer outro esquema ou URL malformada. */
export function safeHttpUrl(candidate) {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Divide texto puro em segmentos de texto e links http(s) validados.
 * O chamador cria nós DOM (textContent / <a> com rel seguro); nada aqui produz HTML.
 */
export function linkSegments(text) {
  const source = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(URL_CANDIDATE)) {
    let raw = match[0];
    // Pontuação final costuma pertencer à frase, não ao link. Parêntese só sai se estiver desbalanceado.
    while (raw && TRAILING.test(raw.at(-1))) {
      if (raw.at(-1) === ")" && count(raw, ")") <= count(raw, "(")) break;
      raw = raw.slice(0, -1);
    }
    const href = safeHttpUrl(raw);
    if (!href) continue;
    if (match.index > last) parts.push({ type: "text", value: source.slice(last, match.index) });
    parts.push({ type: "link", value: raw, href });
    last = match.index + raw.length;
  }
  if (last < source.length) parts.push({ type: "text", value: source.slice(last) });
  return parts;
}

/** Avatar exibível: caminho local ("/…", nunca "//…") ou https. Qualquer outro valor usa o avatar padrão. */
export function safeAvatar(url) {
  const value = String(url ?? "");
  if (/^\/(?!\/)[A-Za-z0-9/_\-.]*$/.test(value)) return value;
  if (/^https:\/\//i.test(value) && safeHttpUrl(value)) return value;
  return DEFAULT_AVATAR;
}

/** Selo de papel no cartão do autor. Cor nunca é o único indicador: sempre há texto. */
export function roleBadge(role) {
  if (role === "admin") return { label: "Admin", kind: "admin" };
  if (role === "ambassador") return { label: "Embaixador", kind: "ambassador" };
  return null;
}

export function removedLabel(removed) {
  if (removed === "moderation") return "Mensagem removida pela moderação";
  if (removed === "author") return "Mensagem removida pelo autor";
  return "";
}

/**
 * Botões de um post. Combina as capacidades devolvidas pelo servidor (autoridade) com o estado da tela.
 * ctx: { staff, canReply }.
 */
export function postButtons(post, ctx = {}) {
  const deleted = !!post.removed;
  const staff = !!ctx.staff;
  return {
    useful: {
      show: !deleted,
      disabled: !post.canMarkUseful,
      pressed: !!post.markedUseful,
      count: Number(post.usefulCount) || 0,
    },
    reply: !deleted && !!ctx.canReply,
    edit: !!post.canEdit,
    delete: !!post.canDelete,
    report: !!post.canReport,
    reported: !!post.reported && !deleted,
    moderateRemove: staff && !deleted,
    moderateRestore: staff && post.removed === "moderation",
  };
}

/** Ferramentas de moderação do tópico (somente equipe). */
export function topicTools(topic, staff) {
  if (!staff || !topic) return [];
  return [
    { key: "pin", label: topic.pinned ? "Desafixar" : "Fixar", change: { pinned: !topic.pinned } },
    { key: "lock", label: topic.locked ? "Destrancar" : "Trancar", change: { locked: !topic.locked } },
    { key: "move", label: "Mover", change: null },
    { key: "delete", label: topic.deleted ? "Restaurar tópico" : "Remover tópico", change: { deleted: !topic.deleted } },
  ];
}

/**
 * Pode abrir tópico na categoria? Usa o resultado do servidor quando houver (canCreateTopic/blockedReason)
 * e, na falta dele, as regras visíveis: arquivada, só equipe, nível mínimo e bloqueio geral de nível.
 */
export function topicGate(category, viewer = {}) {
  if (!category) return { canCreate: false, reason: "Categoria indisponível.", requiredLevel: null };
  if (typeof category.canCreateTopic === "boolean")
    return {
      canCreate: category.canCreateTopic,
      reason: category.blockedReason || "",
      requiredLevel: category.requiredLevel ?? null,
    };
  if (category.archived) return { canCreate: false, reason: "Esta categoria foi arquivada e não recebe novos tópicos.", requiredLevel: null };
  if (viewer.staff) return { canCreate: true, reason: "", requiredLevel: null };
  if (category.staffOnly)
    return { canCreate: false, reason: `Somente a equipe da Guilda abre tópicos em ${category.name}.`, requiredLevel: null };
  const level = Number(viewer.level) || 1;
  const min = Number(category.minLevelToPost) || 1;
  if (level < min)
    return {
      canCreate: false,
      reason: `Abrir tópicos em ${category.name} exige nível ${min}. Seu nível atual é ${level}.`,
      requiredLevel: min,
    };
  if (viewer.topicBlockedReason) return { canCreate: false, reason: viewer.topicBlockedReason, requiredLevel: null };
  return { canCreate: true, reason: "", requiredLevel: null };
}

/** Contador de caracteres para caixas de texto. */
export function charCounter(length, max, min = 0) {
  const n = Number(length) || 0;
  const left = max - n;
  const state = n > max ? "over" : n < min ? "short" : left <= Math.max(20, Math.round(max * 0.05)) ? "warn" : "ok";
  return { text: `${n.toLocaleString("pt-BR")} / ${max.toLocaleString("pt-BR")}`, state, valid: n >= min && n <= max };
}

/** Página em que um post de posição (1-based) aparece. */
export const pageOf = (position, size = PAGE_SIZE) => Math.max(1, Math.ceil((Number(position) || 1) / size));
export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil((Number(total) || 0) / size));

/** Rótulo de respostas: "Sem respostas", "1 resposta", "N respostas". */
export function repliesLabel(count) {
  const n = Math.max(0, Number(count) || 0);
  return n === 0 ? "Sem respostas" : n === 1 ? "1 resposta" : `${n.toLocaleString("pt-BR")} respostas`;
}
