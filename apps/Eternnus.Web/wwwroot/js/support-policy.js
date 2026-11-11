// Suporte: rótulos e regras puras (sem DOM). Espelha SupportRules (C#) apenas para UX; o servidor decide.
export const STATUSES = Object.freeze(["open", "in_progress", "waiting_user", "resolved", "closed"]);
export const PRIORITIES = Object.freeze(["urgent", "high", "normal", "low"]);
export const CATEGORIES = Object.freeze(["account", "bug", "campaign", "sheet", "abuse", "suggestion", "other"]);
export const MAX_OPEN = 5;
export const REOPEN_DAYS = 30;
export const PAGE_SIZE = 15;
export const SUBJECT_LIMITS = Object.freeze({ min: 3, max: 120 });
export const BODY_LIMITS = Object.freeze({ min: 10, max: 10000 });
export const REPLY_LIMITS = Object.freeze({ min: 1, max: 10000 });

const STATUS_LABELS = Object.freeze({
  open: "Aberto",
  in_progress: "Em andamento",
  waiting_user: "Aguardando você",
  resolved: "Resolvido",
  closed: "Fechado",
});
const STAFF_STATUS_LABELS = Object.freeze({ ...STATUS_LABELS, waiting_user: "Aguardando usuário" });
const PRIORITY_LABELS = Object.freeze({ low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" });
const CATEGORY_LABELS = Object.freeze({
  account: "Conta",
  bug: "Erro na plataforma",
  campaign: "Campanha",
  sheet: "Ficha",
  abuse: "Denúncia/abuso",
  suggestion: "Sugestão",
  other: "Outro",
});
// Classes de status-chip (platform.css) vêm desta tabela fixa, nunca do valor recebido.
const STATUS_TONES = Object.freeze({ open: "warn", in_progress: "", waiting_user: "warn", resolved: "good", closed: "quiet" });
const PRIORITY_TONES = Object.freeze({ urgent: "bad", high: "warn", normal: "", low: "quiet" });

const own = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
export function statusLabel(status, staff = false) {
  const labels = staff ? STAFF_STATUS_LABELS : STATUS_LABELS;
  return own(labels, status) ? labels[status] : "Desconhecido";
}
export const priorityLabel = (priority) => (own(PRIORITY_LABELS, priority) ? PRIORITY_LABELS[priority] : "Normal");
export const categoryLabel = (category) => (own(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category] : "Outro");
export const statusTone = (status) => (own(STATUS_TONES, status) ? STATUS_TONES[status] : "quiet");
export const priorityTone = (priority) => (own(PRIORITY_TONES, priority) ? PRIORITY_TONES[priority] : "");

export const isDone = (status) => status === "resolved" || status === "closed";
/** Resposta do autor: "aguardando você" e "resolvido" voltam a "aberto"; fechado não aceita resposta. */
export const afterUserReply = (status) => (status === "waiting_user" || status === "resolved" ? "open" : status);
/** Resposta pública da equipe: aberto/em andamento passam a aguardar o usuário. */
export const afterStaffReply = (status) => (status === "open" || status === "in_progress" ? "waiting_user" : status);
export const canUserReply = (status) => STATUSES.includes(status) && status !== "closed";
export const canUserClose = (status) => STATUSES.includes(status) && status !== "closed";

function utc(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(text) ? text : text + "Z");
}
export function canUserReopen(status, closedAt, now = Date.now()) {
  const at = utc(closedAt);
  return isDone(status) && Number.isFinite(at) && now - at < REOPEN_DAYS * 86400000;
}

/** Explicação curta do estado para o autor (texto puro). */
export function statusHint(status, canReopen) {
  switch (status) {
    case "open":
      return "A equipe recebeu seu chamado e vai responder por aqui.";
    case "in_progress":
      return "A equipe está analisando seu chamado.";
    case "waiting_user":
      return "A equipe respondeu e aguarda o seu retorno.";
    case "resolved":
      return "A equipe marcou como resolvido. Se ainda precisar de ajuda, responda para reabrir.";
    case "closed":
      return canReopen
        ? `Chamado fechado. Você pode reabri-lo em até ${REOPEN_DAYS} dias.`
        : `Chamado fechado há mais de ${REOPEN_DAYS} dias. Se precisar, abra um novo chamado.`;
    default:
      return "";
  }
}

const hasControl = (text, multiline) =>
  [...text].some((c) => {
    const code = c.charCodeAt(0);
    if (multiline && (c === "\n" || c === "\t")) return false;
    return code < 32 || (code >= 127 && code < 160);
  });
const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/** Validação local do formulário de abertura; devolve a mensagem de erro ou "". */
export function validateTicket({ subject, category, body } = {}) {
  const s = normalize(subject);
  const b = normalize(body);
  if (s.length < SUBJECT_LIMITS.min || s.length > SUBJECT_LIMITS.max || hasControl(s, false))
    return "O assunto deve ter de 3 a 120 caracteres.";
  if (!CATEGORIES.includes(category)) return "Escolha uma categoria válida.";
  if (b.length < BODY_LIMITS.min || b.length > BODY_LIMITS.max || hasControl(b, true))
    return "A descrição deve ter de 10 a 10.000 caracteres.";
  return "";
}
export function validateReply(body) {
  const b = normalize(body);
  return b.length < REPLY_LIMITS.min || b.length > REPLY_LIMITS.max || hasControl(b, true)
    ? "A mensagem deve ter de 1 a 10.000 caracteres."
    : "";
}

/** Query string da fila da equipe com somente valores reconhecidos. */
export function queueQuery({ status = "active", priority = "", category = "", assigned = "any", q = "", page = 1 } = {}) {
  const params = new URLSearchParams();
  if (status === "active" || STATUSES.includes(status)) params.set("status", status);
  if (PRIORITIES.includes(priority)) params.set("priority", priority);
  if (CATEGORIES.includes(category)) params.set("category", category);
  if (assigned === "me" || assigned === "none") params.set("assigned", assigned);
  const term = String(q ?? "").trim().slice(0, 100);
  if (term) params.set("q", term);
  params.set("page", String(Math.max(1, Math.floor(Number(page)) || 1)));
  return params.toString();
}
export const myQuery = ({ status = "", page = 1 } = {}) => {
  const params = new URLSearchParams();
  if (status === "active" || STATUSES.includes(status)) params.set("status", status);
  params.set("page", String(Math.max(1, Math.floor(Number(page)) || 1)));
  return params.toString();
};
export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil((Number(total) || 0) / size));

export const isGuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));
/** Primeiro segmento GUID → ticket; qualquer outra coisa → lista. */
export const ticketFromSegments = (segments = []) => (isGuid(segments?.[0]) ? String(segments[0]).toLowerCase() : null);

/** Avatar só de caminho local (sem "//") ou HTTPS; o resto cai no padrão. */
export function safeAvatar(url) {
  const text = String(url ?? "");
  return (/^\/(?!\/)[\w\-./]*$/.test(text) || /^https:\/\/[^\s"'<>]+$/.test(text)) ? text : "/assets/avatar.svg";
}

/** Abrir chamado: botão habilitado somente abaixo do limite de abertos. */
export const canOpenTicket = (openCount) => (Number(openCount) || 0) < MAX_OPEN;

/** Mudanças que o PUT da equipe vai registrar (mesmo texto das notas automáticas do servidor). */
export function changeSummary(before, after, names = {}) {
  const lines = [];
  if (before.status !== after.status)
    lines.push(`Status: ${statusLabel(before.status, true)} → ${statusLabel(after.status, true)}`);
  if (before.priority !== after.priority)
    lines.push(`Prioridade: ${priorityLabel(before.priority)} → ${priorityLabel(after.priority)}`);
  const from = before.assignedToId || null,
    to = after.assignedToId || null;
  if (from !== to) lines.push(`Atribuição: ${(from && names[from]) || "ninguém"} → ${(to && names[to]) || "ninguém"}`);
  return lines;
}
