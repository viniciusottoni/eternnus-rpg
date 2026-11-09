// Chamadas HTTP do catálogo de músicas e da trilha da sessão. Tudo passa por api.js (CSRF, credenciais e erros comuns).
import { api } from "./api.js";

const query = (search, page) => {
  const q = new URLSearchParams({ page: String(page) });
  if (search) q.set("search", search);
  return q;
};

/** Busca por nome no catálogo do servidor (mestre na mesa). `background` evita o loading universal. */
export const searchCatalog = ({ search = "", page = 1, background = false, signal } = {}) =>
  api(`/music?${query(search, page)}`, "GET", undefined, { background, signal });

/** Gestão do catálogo (somente Admin): lista com uso e faixas tocando em sessões ativas. */
export const adminListTracks = ({ search = "", page = 1, background = false } = {}) =>
  api(`/admin/music?${query(search, page)}`, "GET", undefined, { background });

/** Envio multipart: um arquivo no campo `file` e título opcional. O servidor valida conteúdo, tamanho e quotas. */
export function adminUploadTrack(file, title) {
  const form = new FormData();
  if (title) form.append("title", title);
  form.append("file", file, file.name);
  return api("/admin/music", "POST", form);
}

export const adminRenameTrack = (track, title) =>
  api(`/admin/music/${encodeURIComponent(track.id)}`, "PUT", { title, revision: track.revision });

export const adminDeleteTrack = (trackId) => api(`/admin/music/${encodeURIComponent(trackId)}`, "DELETE");

/**
 * Comando da trilha da sessão (somente mestre): select, play, pause, stop, seek ou loop.
 * `version` é a versão da trilha conhecida pela tela; o servidor recusa comandos baseados em versão anterior.
 */
export const soundtrackCommand = (sessionId, action, version, extra = {}) =>
  api(`/sessions/${encodeURIComponent(sessionId)}/music`, "POST", { action, version, ...extra }, { background: true });
