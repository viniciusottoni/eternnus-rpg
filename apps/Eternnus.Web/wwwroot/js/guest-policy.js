// Convidados da mesa (ADR-114): regras puras de rota, nome, convites e permissões exibidas. Sem DOM nem HTTP;
// testadas em tests/guest-policy.test.mjs. Somente UX: o servidor revalida modo, assento, marcador e validade em cada escrita.

export const GUEST_NAME_MAX = 40;
export const DEFAULT_GUEST_NAME = "Convidado";

/** Duração do convite (horas) e usos: predefinições comuns em vez de números crus (ADR-100). */
export const GUEST_DURATIONS = Object.freeze([
  Object.freeze({ hours: 2, label: "2 horas" }),
  Object.freeze({ hours: 4, label: "4 horas" }),
  Object.freeze({ hours: 12, label: "12 horas" }),
  Object.freeze({ hours: 24, label: "24 horas" }),
]);
export const DEFAULT_DURATION = 4;
export const GUEST_USES = Object.freeze([1, 5, 10]);
export const DEFAULT_USES = 1;

export const GUEST_MODES = Object.freeze({
  observer: Object.freeze({ label: "Observador", hint: "Acompanha o mapa e os acontecimentos públicos; não age na mesa." }),
  participant: Object.freeze({ label: "Participante", hint: "Também rola dados, conversa e move um marcador que você entregar." }),
});

/** Segredo do link: só caracteres seguros para URL (o servidor decide se vale). */
export const isGuestSecret = (value) => /^[A-Za-z0-9_-]{16,128}$/.test(String(value ?? ""));

/**
 * Rota do convidado: "convidado" (retomar pelo cookie) ou "convidado/<segredo>". Barra inicial opcional (#/convidado/…).
 * Devolve { secret } (segredo ou "") ou null quando não é rota de convidado ou o segredo é inválido.
 */
export function guestRoute(hash) {
  const parts = String(hash ?? "").replace(/^#/, "").replace(/^\/+/, "").split("/");
  if (parts[0] !== "convidado" || parts.length > 2) return null;
  const secret = parts[1] || "";
  if (secret && !isGuestSecret(secret)) return null;
  return { secret };
}

/** Rota da exibição externa: "mesa/<sessão>/exibicao" (barra inicial opcional). Devolve o id da sessão ou null. */
export function displayRoute(hash) {
  const parts = String(hash ?? "").replace(/^#/, "").replace(/^\/+/, "").split("/");
  if (parts.length !== 3 || parts[0] !== "mesa" || parts[2] !== "exibicao") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1]) ? parts[1] : null;
}

/** Nome exibido: espaços normalizados, sem controles, até 40 caracteres; vazio vira "Convidado". */
export function normalizeGuestName(value) {
  // eslint-disable-next-line no-control-regex
  const clean = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || DEFAULT_GUEST_NAME).slice(0, GUEST_NAME_MAX).trim();
}

/** Corpo do POST de convite com valores dentro das predefinições. */
export function inviteRequest({ mode, hours, maxUses, label } = {}) {
  const h = GUEST_DURATIONS.some((d) => d.hours === Number(hours)) ? Number(hours) : DEFAULT_DURATION;
  const uses = GUEST_USES.includes(Number(maxUses)) ? Number(maxUses) : DEFAULT_USES;
  const text = String(label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return { mode: mode === "participant" ? "participant" : "observer", hours: h, maxUses: uses, ...(text ? { label: text } : {}) };
}

/** Situação do convite para a lista do mestre: ativo, esgotado, expirado ou revogado (com rótulo). */
export function inviteStatus(invite, now = Date.now()) {
  if (!invite) return { id: "revoked", label: "Revogado" };
  if (invite.revokedAt) return { id: "revoked", label: "Revogado" };
  const expires = Date.parse(invite.expiresAt);
  if (Number.isFinite(expires) && expires <= now) return { id: "expired", label: "Expirado" };
  if (Number(invite.uses) >= Number(invite.maxUses) && Number(invite.maxUses) > 0) return { id: "used", label: "Usos esgotados" };
  if (invite.active === false) return { id: "expired", label: "Expirado" };
  return { id: "active", label: "Ativo" };
}

/** Link completo a partir do `path` devolvido pelo servidor; só aceita o formato do convidado. */
export function inviteLink(path, origin) {
  const p = String(path ?? "");
  const m = /^\/#\/convidado\/([A-Za-z0-9_-]{16,128})$/.exec(p);
  if (!m || !/^https?:\/\/[^/\s]+$/.test(String(origin ?? ""))) return null;
  return `${origin}${p}`;
}

/** O que o convidado pode fazer na tela (o servidor decide de verdade). */
export function guestAbilities(me, state = {}) {
  const participant = me?.mode === "participant";
  const ended = !!state.session?.endedAt;
  const token = participant && me?.tokenId ? (state.tokens || []).find((t) => t.id === me.tokenId) || null : null;
  return {
    participant,
    roll: participant && !ended,
    chat: participant && !ended,
    move: !!token && !ended && state.map?.kind === "tileset",
    token,
  };
}

/** Marcadores que o mestre pode entregar a convidados: sem ficha de jogador. */
export const controllableToken = (token) => !!token && !token.characterId;

/** Assentos de participante ativos para "Dar controle a convidado". */
export function participantSeats(guests) {
  return (Array.isArray(guests) ? guests : []).filter((g) => g && g.mode === "participant" && !g.revokedAt && g.seatId);
}

/** Assento que controla o marcador (para o selo e "Retirar controle"). */
export const seatControlling = (guests, tokenId) => (Array.isArray(guests) ? guests : []).find((g) => g?.tokenId && g.tokenId === tokenId) || null;

/** Mensagem do resgate do convite por código de resposta. */
export function redeemMessage(status, fallback = "") {
  if (status === 404) return "Este convite não vale mais: pode ter expirado, sido revogado ou já usado. Peça um novo link ao mestre.";
  if (status === 409) return "A mesa ainda não começou. Tente de novo quando o mestre abrir a sessão.";
  if (status === 429) return "Muitas tentativas seguidas. Aguarde um pouco e tente de novo.";
  if (status === 400) return fallback || "Confira o nome e tente de novo.";
  return fallback || "Não foi possível entrar agora. Tente de novo.";
}
