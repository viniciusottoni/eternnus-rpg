// Reprodução da trilha da sessão neste navegador. Um único <audio> por mesa segue o estado autoritativo recebido
// do servidor (faixa, tocando/pausada, posição e instante de referência, repetição). Não decide nada sozinho:
// só alinha o áudio local à posição esperada, com correção suave e saltos raros (regras em soundtrack-policy.js).
// Volume e silêncio são preferências pessoais deste dispositivo e nunca afetam os demais participantes.
import {
  PREFERENCE_KEY,
  SYNC,
  addClockSample,
  clockOffset,
  correction,
  expectedPosition,
  isNewerMusic,
  readAudioPreference,
  sessionAudioActive,
} from "./soundtrack-policy.js";
import { resumeMusic, suspendMusic } from "./music.js";

// iOS ignora HTMLMediaElement.volume: nesses aparelhos só o silêncio pessoal fica disponível.
const volumeWritable = (() => {
  const probe = document.createElement("audio");
  probe.volume = 0.5;
  return probe.volume === 0.5;
})();

export function createSessionAudio({ onChange = () => {} } = {}) {
  // Fica fora de #app (sobrevive aos redesenhos da mesa), oculto e sem controles próprios; removido no descarte.
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.hidden = true;
  audio.dataset.sessionAudio = "";
  document.body.append(audio);
  let music = null,
    samples = [],
    src = "",
    loadSeq = 0,
    loading = false,
    blocked = false,
    error = false,
    correcting = false,
    lastSeekAt = -Infinity,
    lastTick = performance.now(),
    holding = false,
    errorAt = 0,
    mediaTitle = "",
    disposed = false;
  let preference = loadPreference();
  applyPreference();

  function loadPreference() {
    try {
      return readAudioPreference(localStorage.getItem(PREFERENCE_KEY));
    } catch {
      return readAudioPreference(null);
    }
  }
  function savePreference() {
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
    } catch {
      // Armazenamento indisponível: a escolha vale somente nesta visita.
    }
  }
  function applyPreference() {
    audio.muted = preference.muted;
    if (volumeWritable) audio.volume = preference.volume;
  }

  const serverNow = () => Date.now() + clockOffset(samples);
  const knownDuration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : null);
  const expected = () => expectedPosition(music, serverNow(), knownDuration());
  // Eventos de uma faixa anterior (carregamento atrasado) são ignorados: só vale o src atual.
  const isCurrent = () => !!src && audio.src === new URL(src, location.origin).href;

  function snapshot() {
    const exp = expected();
    const hearing = music?.playing && !blocked && !audio.paused && audio.readyState >= 1;
    return {
      music,
      positionMs: hearing ? audio.currentTime * 1000 : exp.positionMs,
      durationMs: Number(music?.durationMs) > 0 ? Number(music.durationMs) : knownDuration(),
      ended: exp.ended,
      loading,
      blocked,
      error,
      muted: preference.muted,
      volume: preference.volume,
      volumeAvailable: volumeWritable,
    };
  }
  function emit() {
    if (!disposed) onChange(snapshot());
  }

  function hold() {
    if (holding) return;
    holding = true;
    suspendMusic();
  }
  function release() {
    if (!holding) return;
    holding = false;
    mediaTitle = "";
    resumeMusic();
  }

  // Controles de mídia do sistema: tocar ativa o áudio da sessão; pausar silencia só para esta pessoa.
  function claimMediaSession() {
    if (!("mediaSession" in navigator) || !music?.title || mediaTitle === music.title) return;
    mediaTitle = music.title;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: music.title,
        artist: "Trilha da sessão · Eternnus RPG",
        artwork: [{ src: "/assets/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
      });
      navigator.mediaSession.setActionHandler("play", () => unlock());
      navigator.mediaSession.setActionHandler("pause", () => setMuted(true));
    } catch {
      // Media Session é opcional.
    }
  }

  function unload() {
    loadSeq++;
    src = "";
    loading = blocked = error = correcting = false;
    audio.pause();
    audio.playbackRate = 1;
    audio.removeAttribute("src");
    audio.load();
  }

  function load(url) {
    loadSeq++;
    src = url;
    loading = true;
    error = correcting = false;
    audio.playbackRate = 1;
    audio.src = url;
    audio.load();
  }

  function seek(ms) {
    try {
      audio.currentTime = Math.max(0, ms / 1000);
      lastSeekAt = performance.now();
    } catch {
      // Posição ainda indisponível: a próxima conferência tenta de novo.
    }
  }

  function play() {
    const seq = loadSeq;
    let attempt;
    try {
      attempt = audio.play();
    } catch (failure) {
      attempt = Promise.reject(failure);
    }
    attempt?.then?.(() => {
      if (seq !== loadSeq || disposed) return;
      blocked = false;
      emit();
    }).catch((failure) => {
      if (seq !== loadSeq || disposed) return;
      // Sem interação prévia, o navegador pode recusar som: a tela oferece "Ativar áudio da sessão".
      if (failure?.name === "NotAllowedError") blocked = true;
      else if (failure?.name !== "AbortError") error = true;
      emit();
    });
  }

  function reconcile(forced = false) {
    if (disposed) return;
    if (!sessionAudioActive(music) || !music.audioUrl) {
      if (src) unload();
      release();
      emit();
      return;
    }
    hold();
    claimMediaSession();
    if (music.audioUrl !== src || (error && forced)) {
      load(music.audioUrl);
      emit();
      return; // loadedmetadata chama reconcile(true) quando a posição puder ser aplicada.
    }
    audio.loop = !!music.loop;
    if (audio.readyState < 1) {
      emit();
      return;
    }
    const exp = expected();
    if (exp.ended) {
      if (!audio.paused) audio.pause();
      emit();
      return;
    }
    if (!music.playing) {
      if (!audio.paused) audio.pause();
      audio.playbackRate = 1;
      correcting = false;
      if (Math.abs(audio.currentTime * 1000 - exp.positionMs) > SYNC.softMs) seek(exp.positionMs);
      emit();
      return;
    }
    const step = correction(audio.currentTime * 1000, exp.positionMs, {
      now: performance.now(),
      lastSeekAt,
      forced,
      correcting,
      durationMs: knownDuration() || Number(music.durationMs) || 0,
      loop: !!music.loop,
    });
    if (step.kind === "seek") {
      seek(step.toMs);
      audio.playbackRate = 1;
      correcting = false;
    } else if (step.kind === "rate") {
      audio.playbackRate = step.rate;
      correcting = true;
    } else {
      audio.playbackRate = 1;
      correcting = false;
    }
    if (audio.paused && !blocked) play();
    emit();
  }

  const listeners = {
    loadedmetadata: () => {
      if (!isCurrent()) return;
      loading = false;
      reconcile(true);
    },
    playing: () => {
      if (!isCurrent()) return;
      loading = false;
      emit();
    },
    canplay: () => {
      if (!isCurrent()) return;
      loading = false;
      emit();
    },
    waiting: () => {
      if (!isCurrent()) return;
      loading = true;
      emit();
    },
    ended: () => {
      if (isCurrent()) emit();
    },
    error: () => {
      if (!isCurrent()) return;
      loading = false;
      error = true;
      errorAt = performance.now();
      emit();
    },
  };
  for (const [type, listener] of Object.entries(listeners)) audio.addEventListener(type, listener);

  // Conferência periódica: corrige desvios e percebe suspensão do dispositivo (intervalo muito maior que o previsto).
  const timer = setInterval(() => {
    const now = performance.now();
    const gap = now - lastTick;
    lastTick = now;
    // Falha passageira (rede, servidor reiniciando): recarrega a faixa a cada 10 s enquanto ela estiver na mesa.
    if (music?.trackId) reconcile(gap > SYNC.suspendGapMs || (error && now - errorAt > 10000));
  }, SYNC.checkMs);
  const onVisibility = () => {
    if (document.hidden) return;
    lastTick = performance.now();
    if (music?.trackId) reconcile(false);
  };
  document.addEventListener("visibilitychange", onVisibility);

  /** Novo estado do servidor (consulta ao vivo ou resposta de comando). Estados mais antigos são ignorados. */
  function update(next, serverTime) {
    if (disposed) return;
    if (serverTime) samples = addClockSample(samples, serverTime, Date.now());
    if (!isNewerMusic(music, next)) return;
    const changed = !music || next.version !== music.version || next.audioUrl !== music.audioUrl;
    music = next;
    reconcile(changed);
  }

  /** Gesto explícito ("Ativar áudio da sessão"): tenta tocar dentro do clique e depois alinha à posição atual. */
  function unlock() {
    if (disposed || !music?.trackId) return;
    blocked = false;
    if (error) {
      reconcile(true);
      return;
    }
    if (music.playing && !expected().ended && audio.paused && src) play();
    reconcile(true);
  }

  function setMuted(muted) {
    preference = { ...preference, muted: !!muted };
    applyPreference();
    savePreference();
    emit();
  }
  function setVolume(volume) {
    preference = { ...preference, volume: Math.min(1, Math.max(0, Math.round(Number(volume) * 100) / 100)) };
    if (preference.volume > 0 && preference.muted) preference.muted = false;
    applyPreference();
    savePreference();
    emit();
  }

  function dispose() {
    if (disposed) return;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    for (const [type, listener] of Object.entries(listeners)) audio.removeEventListener(type, listener);
    unload();
    audio.remove();
    disposed = true;
    release();
  }

  return { update, unlock, setMuted, setVolume, snapshot, serverNow, dispose };
}
