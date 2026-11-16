// Regras puras dos rascunhos locais dos editores (ADR-083). Sem DOM, sem IndexedDB: testáveis com node --test.
// Um rascunho guarda só o documento em edição (o mesmo instantâneo do histórico de desfazer), a revisão de origem e datas.

export const DRAFT_KINDS = Object.freeze(["tilemap", "imagemap", "scene", "maplayer"]);
/** Limites por usuário: 30 rascunhos, 8 MiB cada (texto JSON), 30 dias. */
export const MAX_DRAFTS = 30;
export const MAX_DRAFT_CHARS = 8 * 1024 * 1024;
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Espera depois da última mudança antes de gravar. */
export const DRAFT_DEBOUNCE_MS = 2000;

const SAFE = /^[A-Za-z0-9_:@.-]{1,120}$/;

/** Chave estável: usuário + campanha + tipo + documento ("new" para um documento ainda não salvo). Nulo se algo for inválido. */
export function draftKey(user, campaign, kind, doc) {
  const parts = [user, campaign, kind, doc || "new"].map((p) => String(p ?? ""));
  if (!DRAFT_KINDS.includes(parts[2]) || !parts.every((p) => SAFE.test(p))) return null;
  return parts.join("|");
}

/** Monta o registro a gravar ou devolve `{ error }` quando não cabe. */
export function buildDraft({ key, user, campaign, kind, doc, label, revision, snapshot, now = Date.now() }) {
  if (!key) return { error: "Rascunho sem identificação." };
  let data;
  try { data = JSON.stringify(snapshot); } catch { return { error: "O documento não pôde ser guardado localmente." }; }
  if (data == null) return { error: "Nada para guardar." };
  if (data.length > MAX_DRAFT_CHARS) return { error: "O documento é grande demais para o rascunho local (8 MB). Salve para não perder as alterações." };
  return {
    record: {
      key, user: String(user), campaign: String(campaign), kind, doc: String(doc || "new"),
      label: String(label || "").slice(0, 120), revision: revision ?? null, savedAt: now, size: data.length, data,
    },
  };
}

/** Lê um registro guardado; nulo se estiver corrompido, expirado ou for de outro dono/documento. */
export function readDraft(record, { key, now = Date.now() } = {}) {
  if (!record || typeof record !== "object" || record.key !== key || typeof record.data !== "string") return null;
  if (!Number.isFinite(record.savedAt) || now - record.savedAt > DRAFT_TTL_MS) return null;
  try { return { ...record, snapshot: JSON.parse(record.data) }; } catch { return null; }
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * O que oferecer ao abrir um documento com rascunho: `{ offer, conflict }`.
 * `conflict` = o documento mudou no servidor depois do rascunho (revisões diferentes).
 * Um rascunho igual ao documento aberto não é oferecido (nada a recuperar).
 */
export function draftDecision(draft, { revision, snapshot } = {}) {
  if (!draft) return { offer: false, conflict: false };
  if (snapshot !== undefined && same(draft.snapshot, snapshot)) return { offer: false, conflict: false };
  return { offer: true, conflict: !same(draft.revision, revision) };
}

/** Chaves a apagar: expiradas e as mais antigas além do limite (por usuário). */
export function pruneDrafts(records, { user, now = Date.now(), max = MAX_DRAFTS } = {}) {
  const mine = records.filter((r) => r && r.user === String(user));
  const expired = mine.filter((r) => !Number.isFinite(r.savedAt) || now - r.savedAt > DRAFT_TTL_MS).map((r) => r.key);
  const alive = mine.filter((r) => !expired.includes(r.key)).sort((a, b) => b.savedAt - a.savedAt);
  return [...expired, ...alive.slice(max).map((r) => r.key)];
}

/** Hora curta (hh:mm) para a barra de estado. */
export function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Texto da barra de estado: último salvamento no servidor e/ou último rascunho local. */
export function saveStatusText({ savedAt = null, draftAt = null, dirty = false, paused = false } = {}) {
  if (paused) return "Rascunho anterior guardado · rascunho automático pausado";
  if (dirty && draftAt) return `Rascunho local ${clock(draftAt)}`;
  if (savedAt) return `Salvo às ${clock(savedAt)}`;
  return "";
}

/** Data e hora legíveis (pt-BR) para listas de rascunhos e versões. */
export function when(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${clock(ms)}`;
}
