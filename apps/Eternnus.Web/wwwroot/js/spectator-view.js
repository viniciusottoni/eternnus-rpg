// Visão de espectador compartilhada (ADR-114/115): tabuleiro sem ferramentas do mestre, "Seguir o mestre" e
// "Restaurar enquadramento". Usada pela exibição externa (table-display.js) e pela mesa do convidado (guest-table.js);
// a mesa dos jogadores (table.js) reaproveita só o controle de seguimento. Sem chamadas HTTP aqui.
import { createBoard } from "./table-map.js";
import { icon } from "./icons.js";
import { helpButton } from "./help.js";
import { FOLLOW, followReducer, frameDecision, followKey, readFollow, writeFollow, followLabels } from "./camera-policy.js";

const storage = () => { try { return window.sessionStorage; } catch { return null; } };

/**
 * Controle de seguimento da câmera do mestre. `getBoard()` devolve o tabuleiro (createBoard).
 * A escolha fica guardada por sessão nesta aba (sessionStorage) quando `remember` é verdadeiro.
 * Só move a câmera de quem está seguindo, e só quando a sequência do enquadramento aumenta.
 */
export function createFollow({ getBoard, sessionId, defaultOn = false, remember = true, onChange = () => {} }) {
  const key = remember ? followKey(sessionId) : null;
  let mode = readFollow(storage(), key, defaultOn) ? FOLLOW.FOLLOWING : FOLLOW.FREE;
  let lastSeq = -Infinity, latest = null, first = true;
  const frame = (f, animate) => { if (f) getBoard()?.camera.frame(f, { animate }); };
  function move(event) {
    const next = followReducer(mode, event);
    if (next === mode) return;
    mode = next;
    onChange(mode);
  }
  return {
    get mode() { return mode; },
    get following() { return mode !== FOLLOW.FREE; },
    /** Enquadramento recebido no estado ao vivo (`camera`); a primeira aplicação é instantânea. */
    sync(raw) {
      const d = frameDecision({ mode, lastSeq, frame: raw });
      lastSeq = d.lastSeq;
      if (d.frame) latest = d.frame;
      if (d.apply) frame(d.frame, !first);
      if (d.frame) first = false;
    },
    toggle() { this.set(mode === FOLLOW.FREE); },
    set(on) {
      move(on ? "enable" : "disable");
      writeFollow(storage(), key, on);
      if (on) frame(latest, true);
    },
    resume() {
      move("resume");
      if (mode === FOLLOW.FOLLOWING) frame(latest, true);
    },
    /** Pan/zoom manual: quem seguia passa a "pausado". */
    userMoved() { move("user"); },
    /** "Restaurar enquadramento": mapa inteiro na janela; conta como gesto manual. */
    fit() { getBoard()?.camera.fit(); move("user"); },
  };
}

/**
 * Barra de seguimento com rótulos visíveis (exibição externa e convidado): seguir (botão alternável), voltar a seguir
 * quando pausado e restaurar enquadramento. `data-follow` identifica a ação para `bindFollowBar`.
 */
export function followBarHtml(mode) {
  const labels = followLabels(mode);
  const on = mode !== FOLLOW.FREE;
  return `<div class="follow-bar" role="group" aria-label="Câmera">`
    + `<button type="button" class="subtle follow-toggle" data-follow="toggle" aria-pressed="${on}">${icon("compass")}<span>Seguir o mestre</span></button>`
    + (mode === FOLLOW.PAUSED ? `<button type="button" class="primary follow-resume" data-follow="resume">Voltar a seguir</button>` : "")
    + `<button type="button" class="subtle tool-icon" data-follow="fit" aria-label="Restaurar enquadramento" data-tip="Restaurar enquadramento">${icon("maximize")}</button>`
    + `<span class="follow-status" role="status">${labels.status}</span>${helpButton("mesa.camera.seguir", "Seguir o mestre")}</div>`;
}

/** Liga os botões da barra ao controle; devolve a função de descarte. */
export function bindFollowBar(host, follow) {
  const onClick = (e) => {
    const action = e.target.closest("[data-follow]")?.dataset.follow;
    if (action === "toggle") follow.toggle();
    if (action === "resume") follow.resume();
    if (action === "fit") follow.fit();
  };
  host.addEventListener("click", onClick);
  return () => host.removeEventListener("click", onClick);
}

/** Vista do tabuleiro para quem só acompanha: sem pintura, alcance ou seleção; arrasto só do marcador indicado. */
export function spectatorView({ draggable = null, selected = null } = {}) {
  return { mode: "none", reach: [], attack: [], reachCircle: null, draggable, selected, grid: true, bubbles: false, fogTools: false, viewAs: false, resizable: false };
}

/**
 * Tabuleiro de espectador com seguimento. `followHost` recebe a barra de seguimento; `cameraHost` os controles de zoom.
 * Devolve { board, follow, update(state, view), destroy() }.
 */
export function mountSpectatorBoard(host, { sessionId, cameraHost, followHost, followDefault = true, remember = true, onToken, onCell, onDrop, onContext } = {}) {
  let board = null;
  const paint = () => { if (followHost) followHost.innerHTML = followBarHtml(follow.mode); };
  const follow = createFollow({ getBoard: () => board, sessionId, defaultOn: followDefault, remember, onChange: paint });
  board = createBoard(host, {
    camera: cameraHost,
    onToken: (t) => onToken?.(t),
    onCell: (c) => onCell?.(c),
    onDrop: (t, c) => (onDrop ? onDrop(t, c) : false),
    onResize: () => false,
    onContext: (at) => onContext?.(at),
    onUserCamera: () => follow.userMoved(),
  });
  paint();
  const unbind = followHost ? bindFollowBar(followHost, follow) : () => {};
  return {
    board,
    follow,
    update(state, view = spectatorView()) {
      board.update(state, view);
      follow.sync(state.camera);
    },
    destroy() { unbind(); board.destroy(); },
  };
}
