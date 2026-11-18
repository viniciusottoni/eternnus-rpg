// Regras puras da imagem do personagem (ADR-097). Sem dados de conta: só formatos, limites e URL.
// O limite de tamanho vem do plano (ADR-102) e é passado pelo chamador.
import { BASIC_FILE_BYTES, formatBytes } from "./account-usage-policy.js";

export const PORTRAIT_TYPES = Object.freeze(["image/png", "image/jpeg"]);
/** Limite usado sem plano informado: o do Basic. */
export const PORTRAIT_MAX_BYTES = BASIC_FILE_BYTES;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL da imagem com a versão como cache-buster; nulo sem imagem ou com id inválido (nunca interpolar sem validar). */
export function portraitUrl(id, version) {
  const v = Number(version);
  if (!GUID.test(String(id ?? "")) || !Number.isInteger(v) || v <= 0) return null;
  return `/api/characters/${id}/portrait?v=${v}`;
}

/** Até duas iniciais do nome; "?" quando vazio. */
export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words.at(-1)][0]];
  return letters.join("").toLocaleUpperCase("pt-BR");
}

/** Erro de validação local do arquivo escolhido, ou "" quando aceito. O servidor revalida tipo real, dimensões e conteúdo. */
export function portraitFileError(file, maxBytes = PORTRAIT_MAX_BYTES) {
  if (!file || !file.size) return "Escolha uma imagem PNG ou JPEG.";
  if (!PORTRAIT_TYPES.includes(file.type)) return "Use uma imagem PNG ou JPEG.";
  if (file.size > maxBytes) return `Envie uma imagem de até ${formatBytes(maxBytes)} (limite do seu plano).`;
  return "";
}

/** Nome exibido do personagem: campo com papel "name" do modelo, senão o nome da ficha. */
export function characterName(sheet) {
  const field = (sheet?.version?.fields || []).find((f) => f.role === "name");
  const value = field ? String(sheet?.values?.[field.name] ?? "").trim() : "";
  return value || String(sheet?.name ?? "").trim() || "Personagem";
}
