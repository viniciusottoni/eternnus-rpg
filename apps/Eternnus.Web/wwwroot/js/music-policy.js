// Regras puras da trilha sonora: preferência salva, volume e início automático.
// O arquivo é servido sem recodificação; trocar a faixa exige um novo nome versionado (.vN).
export const MUSIC_SRC = "/assets/audio/the-blade-and-the-serpent.v1.mp3";
export const MUSIC_STORAGE_KEY = "eternnus.music";
export const DEFAULT_VOLUME = 0.5;

export function clampVolume(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_VOLUME;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, Math.round(number * 100) / 100));
}

// Aceita somente o formato gravado por este módulo; qualquer outro conteúdo volta ao padrão.
export function readPreference(raw) {
  let value;
  try {
    value = JSON.parse(raw ?? "null");
  } catch {
    value = null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  return { paused: value.paused === true, volume: clampVolume(value.volume) };
}

// Pausa explícita do usuário e o modo de economia de dados do navegador impedem o início automático.
export const shouldAutoplay = (preference, saveData = false) =>
  !preference.paused && !saveData;

export const volumeLevel = (volume) =>
  volume <= 0 ? "muted" : volume < 0.5 ? "low" : "high";
