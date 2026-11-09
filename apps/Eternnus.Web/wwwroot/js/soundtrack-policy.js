// Regras puras da trilha sonora da sessão: posição esperada pelo relógio do servidor, correção de desvio,
// ordem dos estados recebidos, limites do catálogo (espelho do servidor, só para UX) e textos de estado.
// Nenhuma função concede acesso: o servidor decide quem controla a trilha e quem recebe os bytes.

export const MUSIC_LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxTracks: 200,
  maxCatalogBytes: 2 * 1024 * 1024 * 1024,
  pageSize: 20,
  maxTitle: 120,
});
export const AUDIO_EXTENSIONS = Object.freeze(["mp3", "m4a", "ogg", "oga", "opus"]);
export const AUDIO_ACCEPT = ".mp3,.m4a,.ogg,.oga,.opus,audio/mpeg,audio/mp4,audio/ogg";
export const PREFERENCE_KEY = "eternnus.session-audio";

// Desvios abaixo de softMs são ignorados; entre softMs e hardMs a velocidade é ajustada aos poucos;
// acima de hardMs (ou em um novo comando do mestre) a posição é corrigida de uma vez, no máximo a cada seekCooldownMs.
export const SYNC = Object.freeze({
  softMs: 300,
  settleMs: 90,
  hardMs: 1500,
  maxRate: 0.06,
  seekCooldownMs: 8000,
  checkMs: 2000,
  suspendGapMs: 6000,
  samples: 7,
});

/**
 * Diferença estimada entre o relógio do servidor e o local (ms). Cada amostra (serverTime − chegada local) só pode
 * subestimar a diferença real, pois inclui o tempo de processamento e de rede; a maior amostra recente é a mais precisa.
 */
export function clockOffset(samples) {
  const valid = (samples || []).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : 0;
}

/** Acrescenta uma amostra (serverTime recebido − relógio local) mantendo só as mais recentes. */
export function addClockSample(samples, serverTime, localNow) {
  const server = Date.parse(serverTime);
  if (!Number.isFinite(server) || !Number.isFinite(localNow)) return samples || [];
  return [...(samples || []), server - localNow].slice(-SYNC.samples);
}

/**
 * Posição esperada da faixa no instante do servidor `serverNow` (ms). `knownDuration` é a duração lida pelo navegador,
 * usada quando o servidor não informou a duração do arquivo.
 */
export function expectedPosition(music, serverNow, knownDuration = null) {
  if (!music?.trackId) return { positionMs: 0, ended: false };
  let position = Math.max(0, Number(music.positionMs) || 0);
  const reference = Date.parse(music.referenceAt);
  if (music.playing && Number.isFinite(reference) && Number.isFinite(serverNow)) position += Math.max(0, serverNow - reference);
  const duration = Number(music.durationMs) > 0 ? Number(music.durationMs) : Number(knownDuration) > 0 ? Number(knownDuration) : 0;
  if (!duration) return { positionMs: position, ended: false };
  if (music.loop) return { positionMs: position % duration, ended: false };
  return position >= duration ? { positionMs: duration, ended: true } : { positionMs: position, ended: false };
}

/**
 * Decide como alinhar o áudio local: `seek` (salto), `rate` (ajuste suave de velocidade) ou `none`.
 * `forced` vem de um novo comando do mestre, carregamento da faixa, volta de suspensão ou ativação do áudio.
 */
export function correction(actualMs, expectedMs, { now = 0, lastSeekAt = -Infinity, forced = false, correcting = false, durationMs = 0, loop = false } = {}) {
  let drift = actualMs - expectedMs;
  // Na repetição, a distância mais curta pode atravessar o fim da faixa.
  if (loop && durationMs > 0 && Math.abs(drift) > durationMs / 2) drift -= Math.sign(drift) * durationMs;
  const distance = Math.abs(drift);
  if (forced && distance > SYNC.settleMs) return { kind: "seek", toMs: expectedMs, rate: 1, drift };
  if (distance >= SYNC.hardMs && now - lastSeekAt >= SYNC.seekCooldownMs) return { kind: "seek", toMs: expectedMs, rate: 1, drift };
  if (distance > (correcting ? SYNC.settleMs : SYNC.softMs)) {
    const rate = 1 - Math.max(-SYNC.maxRate, Math.min(SYNC.maxRate, drift / 4000));
    return { kind: "rate", rate: Math.round(rate * 1000) / 1000, drift };
  }
  return { kind: "none", rate: 1, drift };
}

/** Um estado recebido só substitui o atual se não for mais antigo (respostas atrasadas de comandos ou consultas). */
export function isNewerMusic(current, incoming) {
  if (!incoming || typeof incoming !== "object") return false;
  if (!current) return true;
  return Number(incoming.version) >= Number(current.version);
}

/** O áudio global do site fica suspenso enquanto a sessão tem uma faixa selecionada. */
export const sessionAudioActive = (music) => !!music?.trackId;

export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024)).toLocaleString("pt-BR")} KB`;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  return `${(n / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Validação local antes do envio (o servidor revalida conteúdo, tamanho e quotas). Retorna a mensagem de erro ou "". */
export function validateAudioFile(file, usage = null) {
  if (!file) return "Escolha um arquivo de áudio.";
  const extension = String(file.name || "").toLowerCase().split(".").pop();
  if (!AUDIO_EXTENSIONS.includes(extension)) return "Formato não aceito. Envie MP3, M4A (AAC) ou OGG.";
  if (!(file.size > 0)) return "O arquivo está vazio.";
  if (file.size > MUSIC_LIMITS.maxFileBytes) return "O arquivo excede 20 MB.";
  if (usage && usage.tracks >= MUSIC_LIMITS.maxTracks) return `O catálogo já tem ${MUSIC_LIMITS.maxTracks} faixas. Exclua uma antes de enviar.`;
  if (usage && usage.bytes + file.size > MUSIC_LIMITS.maxCatalogBytes) return "O catálogo atingiria 2 GB. Exclua faixas antes de enviar.";
  return "";
}

/** Título sugerido a partir do nome do arquivo, sem extensão e sem caracteres de controle. */
export function titleFromFile(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MUSIC_LIMITS.maxTitle);
}

/**
 * Estado apresentado na tela. `local` descreve o navegador: blocked (reprodução automática bloqueada),
 * loading, error. O texto não promete sincronização perfeita.
 */
export function statusOf(music, local = {}, ended = false) {
  if (!music?.trackId) return { key: "idle", label: "Sem trilha" };
  if (local.error) return { key: "error", label: "Faixa indisponível neste dispositivo" };
  if (ended) return { key: "ended", label: "Terminou" };
  if (!music.playing) return { key: "paused", label: "Pausada" };
  if (local.blocked) return { key: "blocked", label: "Áudio bloqueado pelo navegador" };
  if (local.loading) return { key: "loading", label: "Carregando…" };
  return { key: "playing", label: local.muted ? "Tocando (silenciada para você)" : "Tocando" };
}

/** Preferência pessoal de volume/silêncio da trilha da sessão: formato próprio; qualquer outro valor volta ao padrão. */
export function readAudioPreference(raw) {
  let value;
  try {
    value = JSON.parse(raw ?? "null");
  } catch {
    value = null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  const volume = Number(value.volume);
  return {
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, Math.round(volume * 100) / 100)) : 0.8,
    muted: value.muted === true,
  };
}
