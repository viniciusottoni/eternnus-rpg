// Exibição externa da mesa (ADR-115): #/mesa/{sessão}/exibicao, aberta pelo mestre numa TV, projetor ou segunda tela.
// Só o tabuleiro com a visão de jogador (o servidor entrega estado seguro: sem notas, objetivo nem eventos privados).
// Sem ferramentas do mestre, sem conversa e sem fichas. Segue a câmera do mestre por padrão; consulta longa com
// reconexão e recuo. Devolve a função de descarte ao roteador.
import { api } from "./api.js";
import { state } from "./state.js";
import { $, esc } from "./ui.js";
import { icon } from "./icons.js";
import { helpButton } from "./help.js";
import { nextPollDelay } from "./session-policy.js";
import { mountSpectatorBoard } from "./spectator-view.js";

export async function renderTableDisplay(sessionId) {
  const base = `/sessions/${sessionId}/display`;
  // Contexto da ajuda (ⓘ do mestre). Somente UX: o servidor recusa a exibição a quem não é o mestre.
  state.liveTable = { campaignId: null, sessionId, isMaster: true, display: true };
  const app = $("#app");
  app.className = "display-app";
  app.innerHTML = `<main id="main" class="display-shell" tabindex="-1" aria-label="Exibição externa da mesa">`
    + `<header class="display-bar"><h1 class="display-title"><span id="d-scene">Exibição da mesa</span>${helpButton("mesa.exibicao.externa", "Exibição externa")}</h1>`
    + `<p class="display-status" id="d-status" role="status" hidden></p>`
    + `<div class="display-follow" id="d-follow"></div><div class="display-camera" id="d-camera"></div><div class="music-dock"></div>`
    + `<button type="button" class="subtle tool-icon" id="d-full" aria-label="Tela cheia" data-tip="Tela cheia" aria-pressed="false">${icon("fullscreen")}</button></header>`
    + `<div class="board display-board" id="d-board"></div>`
    + `<section class="display-veil" id="d-veil" hidden aria-live="polite"></section></main>`;
  document.title = "Exibição da mesa · Eternnus RPG";
  const controller = new AbortController();
  let stopped = false, loaded = false, rev = 0, failures = 0, timer = 0;
  const view = mountSpectatorBoard($("#d-board"), { sessionId, cameraHost: $("#d-camera"), followHost: $("#d-follow"), followDefault: true });
  const status = $("#d-status"), veil = $("#d-veil"), full = $("#d-full");

  function showVeil(title, text) {
    veil.hidden = false;
    veil.innerHTML = `<div class="metal"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
  }
  function apply(state) {
    loaded = true;
    rev = state.revision;
    const scene = state.play?.scene?.name || state.map?.name || "";
    $("#d-scene").textContent = scene ? `${state.campaign?.name || "Mesa"} — ${scene}` : state.campaign?.name || "Exibição da mesa";
    view.update(state);
    if (state.session?.endedAt) { stop(); showVeil("Sessão encerrada", "O mestre encerrou a sessão. Feche esta janela quando quiser."); }
  }
  function connection(ok) {
    status.hidden = ok;
    status.textContent = ok ? "" : "Reconectando…";
  }

  async function poll() {
    while (!stopped) {
      const started = performance.now();
      try {
        const path = loaded ? `${base}/live?after=${rev}` : base;
        const next = await api(path, "GET", undefined, { background: true, signal: controller.signal });
        failures = 0;
        connection(true);
        if (next && next.revision >= rev) apply(next);
      } catch (error) {
        if (stopped || error.name === "AbortError") return;
        if ([401, 403, 404, 410].includes(error.status)) {
          stop();
          showVeil("Exibição indisponível", error.status === 401 ? "Entre novamente na conta do mestre para abrir a exibição." : "A exibição externa é do mestre de uma sessão aberta. Abra-a de novo pela mesa.");
          return;
        }
        failures++;
        connection(false);
      }
      await new Promise((r) => { timer = setTimeout(r, nextPollDelay(failures, performance.now() - started)); });
    }
  }

  // Tela cheia (Fullscreen API): o botão some quando o navegador não oferece.
  const canFull = !!document.documentElement.requestFullscreen && document.fullscreenEnabled;
  full.hidden = !canFull;
  const syncFull = () => {
    const on = !!document.fullscreenElement;
    const label = on ? "Sair da tela cheia" : "Tela cheia";
    full.setAttribute("aria-pressed", String(on));
    full.setAttribute("aria-label", label);
    full.dataset.tip = label;
  };
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#main").requestFullscreen();
    } catch {
      status.hidden = false;
      status.textContent = "A tela cheia não está disponível neste navegador.";
    }
  };
  full.addEventListener("click", toggleFull);
  document.addEventListener("fullscreenchange", syncFull);

  function stop() {
    if (stopped) return;
    stopped = true;
    controller.abort();
    clearTimeout(timer);
  }
  poll();
  return () => {
    stop();
    document.removeEventListener("fullscreenchange", syncFull);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    view.destroy();
    if (state.liveTable?.display) state.liveTable = null;
  };
}
