import {
  MUSIC_SRC,
  MUSIC_STORAGE_KEY,
  clampVolume,
  readPreference,
  shouldAutoplay,
  volumeLevel,
} from "./music-policy.js";

// Trilha sonora contínua. Um único elemento de áudio vive fora de #app e sobrevive às trocas de tela;
// o controle se encaixa no ".music-dock" da tela atual (topbar ou cabeçalho da mesa) ou flutua no canto.
// O MP3 original é transmitido por HTTP Range: a reprodução começa antes do download terminar.
const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
let audio, control, toggle, volumeButton, panel, slider, output;
let preference = readPreference(null);
let waitingForGesture = false;
let pausedByVisibility = false;
let graph = null;
let installed = false;
// Trilha da sessão ativa: a música global fica pausada e oculta; ao sair, volta conforme a preferência anterior.
let suspended = false;
let resumeAfterSuspend = false;

function loadPreference() {
  try {
    return readPreference(localStorage.getItem(MUSIC_STORAGE_KEY));
  } catch {
    return readPreference(null);
  }
}
function savePreference() {
  try {
    localStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Armazenamento indisponível (modo privado/cota): a escolha vale só para esta visita.
  }
}

// iOS ignora HTMLMediaElement.volume (sempre 1). Nesse caso o volume passa por um GainNode,
// criado somente dentro de um gesto do usuário, como o navegador exige para o AudioContext.
const volumeWritable = (() => {
  const probe = document.createElement("audio");
  probe.volume = 0.5;
  return probe.volume === 0.5;
})();
function ensureGraph() {
  if (volumeWritable || graph) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    const context = new Context();
    const gain = context.createGain();
    context.createMediaElementSource(audio).connect(gain).connect(context.destination);
    graph = { context, gain };
    gain.gain.value = preference.volume;
  } catch {
    graph = null;
  }
}
function applyVolume() {
  if (graph) graph.gain.gain.value = preference.volume;
  else audio.volume = preference.volume;
  render();
}

function setStatus(status) {
  if (control) control.dataset.status = status;
  render();
}

async function play(fromGesture) {
  if (suspended) return;
  if (fromGesture) ensureGraph();
  if (audio.getAttribute("src") !== MUSIC_SRC) audio.src = MUSIC_SRC;
  audio.preload = "auto";
  if (audio.readyState < 3) setStatus("loading");
  try {
    // Sem await: fora de um gesto, resume() pode ficar pendente e não deve atrasar play().
    if (graph && graph.context.state !== "running") graph.context.resume().catch(() => {});
    await audio.play();
    stopWaitingForGesture();
  } catch (error) {
    // Sem interação prévia, o navegador bloqueia som automático: tocar no primeiro gesto em qualquer ponto.
    if (error?.name === "NotAllowedError") {
      setStatus("idle");
      waitForGesture();
    } else if (error?.name !== "AbortError") setStatus("error");
  }
}

function onGesture(event) {
  if (event.type === "keydown" && (event.key === "Escape" || event.repeat)) return;
  // O próprio controle trata seus cliques (tocar/pausar/volume) sem disparar uma segunda ação.
  if (control?.contains(event.target)) return;
  if (preference.paused) {
    stopWaitingForGesture();
    return;
  }
  play(true);
}
function waitForGesture() {
  if (waitingForGesture) return;
  waitingForGesture = true;
  for (const type of GESTURES)
    document.addEventListener(type, onGesture, { capture: true, passive: true });
}
function stopWaitingForGesture() {
  if (!waitingForGesture) return;
  waitingForGesture = false;
  for (const type of GESTURES)
    document.removeEventListener(type, onGesture, { capture: true });
}

function toggleMusic() {
  if (control.dataset.status === "error") audio.load();
  if (audio.paused) {
    preference.paused = false;
    savePreference();
    play(true);
  } else {
    preference.paused = true;
    savePreference();
    stopWaitingForGesture();
    audio.pause();
  }
}

function render() {
  if (!control) return;
  const playing = !audio.paused;
  const status = control.dataset.status;
  const label =
    status === "error"
      ? "Trilha sonora indisponível. Tentar novamente"
      : playing
        ? "Pausar trilha sonora"
        : "Tocar trilha sonora";
  toggle.setAttribute("aria-label", label);
  toggle.dataset.tip = label;
  toggle.dataset.playing = String(playing);
  const percent = Math.round(preference.volume * 100);
  volumeButton.dataset.level = volumeLevel(preference.volume);
  volumeButton.setAttribute("aria-label", `Volume da trilha sonora: ${percent}%`);
  volumeButton.dataset.tip = `Volume: ${percent}%`;
  if (Number(slider.value) !== percent) slider.value = String(percent);
  slider.setAttribute("aria-valuetext", `${percent}%`);
  output.textContent = `${percent}%`;
}

function openPanel(open) {
  panel.hidden = !open;
  volumeButton.setAttribute("aria-expanded", String(open));
  if (open) slider.focus();
}

function buildControl() {
  const root = document.createElement("div");
  root.className = "music-control";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Trilha sonora");
  root.dataset.status = "idle";
  root.innerHTML = `<button type="button" class="music-button music-toggle" aria-label="Tocar trilha sonora"><svg class="music-icon icon-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z"/></svg><svg class="music-icon icon-pause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg></button><button type="button" class="music-button music-volume" aria-expanded="false" aria-controls="music-panel" aria-label="Volume da trilha sonora"><svg class="music-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="speaker" d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z"/><path class="wave wave-near" d="M15.4 9.4a3.7 3.7 0 0 1 0 5.2"/><path class="wave wave-far" d="M17.9 6.9a7.2 7.2 0 0 1 0 10.2"/><path class="mute-mark" d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8"/></svg></button><div class="music-panel" id="music-panel" hidden><label for="music-volume-range">Volume</label><input id="music-volume-range" type="range" min="0" max="100" step="5"><output for="music-volume-range" aria-hidden="true"></output></div>`;
  return root;
}

// Encaixa o controle na tela atual; sem encaixe (login, mesa offline), flutua no canto superior.
function dock() {
  const slot = document.querySelector("#app .music-dock");
  const target = slot || document.body;
  if (control.parentElement !== target) {
    openPanel(false);
    target.append(control);
  }
  control.classList.toggle("is-docked", Boolean(slot));
}

// Controles de mídia do sistema apontam para a trilha global; a trilha da sessão os assume enquanto estiver ativa.
function applyMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "The Blade and the Serpent",
      artist: "Eternnus RPG",
      artwork: [{ src: "/assets/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    navigator.mediaSession.setActionHandler("play", () => {
      preference.paused = false;
      savePreference();
      play(false);
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      preference.paused = true;
      savePreference();
      audio.pause();
    });
  } catch {
    // Media Session é opcional; o controle da página continua disponível.
  }
}

/**
 * Suspende a trilha global enquanto a mesa toca a trilha da sessão. Não altera a preferência salva:
 * `resumeMusic` só volta a tocar se a música estava tocando (ou aguardando o primeiro gesto) antes da suspensão.
 */
export function suspendMusic() {
  if (!installed || suspended) return;
  resumeAfterSuspend = !audio.paused || (waitingForGesture && !preference.paused);
  suspended = true;
  pausedByVisibility = false;
  stopWaitingForGesture();
  audio.pause();
  openPanel(false);
  control.hidden = true;
}
export function resumeMusic() {
  if (!installed || !suspended) return;
  suspended = false;
  control.hidden = false;
  applyMediaSession();
  if (resumeAfterSuspend && !preference.paused) play(false);
  resumeAfterSuspend = false;
}

export function installMusic() {
  if (installed) return;
  installed = true;
  preference = loadPreference();
  audio = document.createElement("audio");
  audio.loop = true;
  audio.preload = "none";
  control = buildControl();
  toggle = control.querySelector(".music-toggle");
  volumeButton = control.querySelector(".music-volume");
  panel = control.querySelector(".music-panel");
  slider = control.querySelector("input");
  output = control.querySelector("output");
  if (!volumeWritable && !(window.AudioContext || window.webkitAudioContext))
    control.classList.add("no-volume");

  audio.addEventListener("playing", () => setStatus("playing"));
  audio.addEventListener("waiting", () => setStatus("loading"));
  audio.addEventListener("pause", () => setStatus("idle"));
  audio.addEventListener("error", () => setStatus("error"));

  toggle.addEventListener("click", toggleMusic);
  volumeButton.addEventListener("click", () => {
    ensureGraph();
    openPanel(panel.hidden);
  });
  slider.addEventListener("input", () => {
    ensureGraph();
    preference.volume = clampVolume(Number(slider.value) / 100);
    applyVolume();
  });
  slider.addEventListener("change", savePreference);
  control.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.stopPropagation();
      openPanel(false);
      volumeButton.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !control.contains(event.target)) openPanel(false);
  });

  // Aba oculta pausa a trilha; ao voltar, retoma somente se o usuário não a pausou.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!audio.paused) {
        pausedByVisibility = true;
        audio.pause();
      }
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      if (!preference.paused && !suspended) play(false);
    }
  });

  applyMediaSession();

  applyVolume();
  dock();
  new MutationObserver(dock).observe(document.querySelector("#app"), { childList: true });
  if (shouldAutoplay(preference, Boolean(navigator.connection?.saveData))) play(false);
}
