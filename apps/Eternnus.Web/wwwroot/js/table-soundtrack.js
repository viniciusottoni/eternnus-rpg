// Trilha sonora na mesa: selo no topo (faixa, estado, silenciar e "Ativar áudio da sessão") e painel "Trilha"
// com progresso, controles do mestre, busca no catálogo do servidor e controles pessoais. A reprodução fica em session-audio.js;
// as chamadas HTTP em soundtrack-api.js; as regras em soundtrack-policy.js. O servidor revalida cada comando.
import { esc, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { createSessionAudio } from "./session-audio.js";
import { searchCatalog, soundtrackCommand } from "./soundtrack-api.js";
import { formatTime, statusOf } from "./soundtrack-policy.js";

const SPEAKER =
  '<svg class="music-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="speaker" d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z"/><path class="wave wave-near" d="M15.4 9.4a3.7 3.7 0 0 1 0 5.2"/><path class="wave wave-far" d="M17.9 6.9a7.2 7.2 0 0 1 0 10.2"/><path class="mute-mark" d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8"/></svg>';

/**
 * Monta a trilha da mesa. `chipHost` recebe o selo do topo; `onOpen` abre a aba "Trilha" do painel.
 * Devolve update(live), mountPanel(host), unmountPanel() e dispose() — integrados ao descarte do roteador.
 */
export function mountSoundtrack({ sessionId, campaignId, chipHost, onOpen = () => {} }) {
  let live = null,
    panel = null,
    pending = false,
    search = "",
    page = 1,
    listSeq = 0,
    list = null,
    listState = "idle",
    listError = "",
    searchTimer = 0,
    seekTimer = 0,
    seeking = false,
    ticker = 0,
    disposed = false;
  const engine = createSessionAudio({ onChange: (snap) => render(snap) });

  // ---------- Selo do topo ----------
  chipHost.innerHTML = `<div class="session-audio" role="group" aria-label="Trilha da sessão"><button type="button" class="sa-open" data-action="st-open"><span class="sa-note" aria-hidden="true">♪</span><span class="sa-text"><strong class="sa-title"></strong><small class="sa-status" aria-live="polite"></small></span></button><button type="button" class="primary sa-unlock" data-action="st-unlock" hidden>▶ Ativar áudio da sessão</button><button type="button" class="music-button sa-mute" data-action="st-mute" aria-pressed="false">${SPEAKER}</button></div>`;
  chipHost.hidden = true;
  const chip = {
    root: chipHost.querySelector(".session-audio"),
    open: chipHost.querySelector(".sa-open"),
    title: chipHost.querySelector(".sa-title"),
    status: chipHost.querySelector(".sa-status"),
    unlock: chipHost.querySelector(".sa-unlock"),
    mute: chipHost.querySelector(".sa-mute"),
  };

  const setText = (element, text) => {
    if (element && element.textContent !== text) element.textContent = text;
  };
  const isMaster = () => !!live?.me?.isMaster;
  const ended = () => !!live?.session?.endedAt;

  function renderChip(snap) {
    const music = snap.music;
    chipHost.hidden = !music?.trackId;
    if (!music?.trackId) return;
    const status = statusOf(music, snap, snap.ended);
    chip.root.dataset.status = status.key;
    setText(chip.title, music.title || "Faixa");
    setText(chip.status, status.label);
    chip.open.setAttribute("aria-label", `Trilha sonora: ${music.title || "faixa"}, ${status.label}. Abrir painel`);
    chip.unlock.hidden = status.key !== "blocked";
    const muteLabel = snap.muted ? "Ouvir a trilha neste dispositivo" : "Silenciar a trilha para você";
    chip.mute.setAttribute("aria-pressed", String(snap.muted));
    chip.mute.setAttribute("aria-label", muteLabel);
    chip.mute.dataset.tip = muteLabel;
    chip.mute.dataset.level = snap.muted ? "muted" : snap.volume < 0.5 ? "low" : "high";
  }

  // ---------- Painel ----------
  function panelHtml() {
    const master = isMaster();
    return `<section class="soundtrack" aria-labelledby="st-heading">
      <div class="section-title"><h2 id="st-heading">Trilha sonora</h2>${helpButton("mesa.trilha.compartilhada", "Trilha sonora compartilhada")}</div>
      <div class="st-now metal" data-status="idle">
        <p class="st-track"><span aria-hidden="true">♪</span> <strong class="st-title">Sem trilha</strong></p>
        <p class="st-status" id="st-status">${master ? "Busque uma faixa do catálogo para tocar para todos." : "O mestre ainda não escolheu uma música."}</p>
        <div class="st-progress">
          ${master
            ? '<label class="sr-only" for="st-seek">Posição da faixa</label><input id="st-seek" class="st-seek" type="range" min="0" max="0" step="1" value="0" disabled aria-describedby="st-status">'
            : '<div class="st-bar" role="progressbar" aria-label="Progresso da faixa" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="st-fill"></span></div>'}
          <p class="st-time"><span class="st-elapsed">0:00</span> / <span class="st-duration">--:--</span><span class="st-loop"></span></p>
        </div>
        <div class="st-unlock-row" hidden><button type="button" class="primary" data-action="st-unlock">▶ Ativar áudio da sessão</button>${helpButton("mesa.trilha.ativar-audio", "Ativar áudio da sessão")}<p class="form-help">O navegador pediu um toque antes de tocar som. A música continua no ponto atual da mesa.</p></div>
      </div>
      ${master
        ? `<div class="st-controls" role="group" aria-label="Controles da trilha para todos">
            <button type="button" class="primary st-toggle" data-action="st-toggle">▶ Tocar</button>
            <button type="button" class="subtle" data-action="st-back">↺ 10 s</button>
            <button type="button" class="subtle" data-action="st-forward">10 s ↻</button>
            <button type="button" class="subtle st-loop-button" data-action="st-loop" aria-pressed="false">⟳ Repetir</button>
            <button type="button" class="subtle" data-action="st-stop">■ Parar</button>
          </div>
          <p class="form-help st-why" id="st-why" hidden></p>`
        : ""}
      <div class="st-personal" role="group" aria-labelledby="st-personal-title">
        <h3 id="st-personal-title">Seu áudio</h3>
        <button type="button" class="subtle st-mute" data-action="st-mute" aria-pressed="false">🔇 Silenciar para mim</button>
        <div class="st-volume field"><label for="st-volume">Seu volume</label><input id="st-volume" type="range" min="0" max="100" step="5" aria-describedby="st-volume-help"><output for="st-volume" aria-hidden="true"></output></div>
        <p class="form-help" id="st-volume-help">Só muda o som neste dispositivo; os demais continuam ouvindo normalmente.</p>
      </div>
      ${master
        ? `<div class="st-library">
            <h3>Catálogo de músicas</h3>
            <form class="st-search" role="search"><div class="field"><label for="st-search">Buscar faixa pelo nome</label><input id="st-search" type="search" maxlength="100" autocomplete="off" spellcheck="false"></div></form>
            <div class="st-list" aria-live="polite" aria-busy="false"></div>
          </div>`
        : ""}
    </section>`;
  }

  function q(selector) {
    return panel?.querySelector(selector) || null;
  }

  function renderProgress(snap) {
    if (!panel) return;
    const music = snap.music;
    const duration = Number(snap.durationMs) || 0;
    const position = Math.min(Math.max(0, snap.positionMs || 0), duration || Infinity);
    setText(q(".st-elapsed"), music?.trackId ? formatTime(position) : "0:00");
    setText(q(".st-duration"), music?.trackId && duration ? formatTime(duration) : "--:--");
    const seek = q("#st-seek");
    if (seek && !seeking) {
      seek.max = String(Math.floor(duration / 1000));
      seek.value = String(Math.floor(position / 1000));
      seek.setAttribute("aria-valuetext", music?.trackId ? `${formatTime(position)} de ${duration ? formatTime(duration) : "duração desconhecida"}` : "Sem faixa");
    }
    const bar = q(".st-bar");
    if (bar) {
      const percent = duration ? Math.round((position / duration) * 100) : 0;
      bar.setAttribute("aria-valuenow", String(percent));
      bar.setAttribute("aria-valuetext", music?.trackId ? `${formatTime(position)} de ${duration ? formatTime(duration) : "duração desconhecida"}` : "Sem faixa");
      q(".st-fill").style.width = `${percent}%`;
    }
  }

  function renderPanel(snap) {
    if (!panel) return;
    const music = snap.music;
    const status = statusOf(music, snap, snap.ended);
    const master = isMaster();
    q(".st-now").dataset.status = status.key;
    setText(q(".st-title"), music?.trackId ? music.title || "Faixa" : "Sem trilha");
    setText(
      q("#st-status"),
      music?.trackId ? status.label : ended() ? "Sessão encerrada." : master ? "Busque uma faixa do catálogo para tocar para todos." : "O mestre ainda não escolheu uma música.",
    );
    setText(q(".st-loop"), music?.trackId ? (music.loop ? " · Repetição ativada" : " · Sem repetição") : "");
    q(".st-unlock-row").hidden = status.key !== "blocked";
    renderProgress(snap);
    const mute = q(".st-mute");
    mute.setAttribute("aria-pressed", String(snap.muted));
    setText(mute, snap.muted ? "🔊 Ouvir neste dispositivo" : "🔇 Silenciar para mim");
    const volume = q("#st-volume");
    volume.closest(".st-volume").hidden = !snap.volumeAvailable;
    if (document.activeElement !== volume) volume.value = String(Math.round(snap.volume * 100));
    volume.setAttribute("aria-valuetext", `${Math.round(snap.volume * 100)}%`);
    setText(q(".st-volume output"), `${Math.round(snap.volume * 100)}%`);
    if (!master) return;
    const has = !!music?.trackId;
    const blockedReason = ended() ? "A sessão foi encerrada." : !has ? "Escolha uma faixa do catálogo primeiro." : pending ? "Aguarde o comando anterior." : "";
    const toggle = q(".st-toggle");
    setText(toggle, has && music.playing && !snap.ended ? "⏸ Pausar" : "▶ Tocar");
    for (const element of panel.querySelectorAll(".st-controls button")) {
      element.disabled = !!blockedReason;
      if (blockedReason) element.setAttribute("aria-describedby", "st-why");
      else element.removeAttribute("aria-describedby");
    }
    q(".st-loop-button").setAttribute("aria-pressed", String(!!music?.loop));
    const why = q("#st-why");
    why.hidden = !blockedReason;
    setText(why, blockedReason);
    const seek = q("#st-seek");
    seek.disabled = !has || ended() || !(Number(snap.durationMs) > 0);
    for (const select of panel.querySelectorAll("[data-action='st-select']")) select.disabled = pending || ended();
  }

  function render(snap = engine.snapshot()) {
    if (disposed) return;
    renderChip(snap);
    renderPanel(snap);
  }

  // ---------- Acervo (mestre) ----------
  function renderList() {
    const host = q(".st-list");
    if (!host) return;
    host.setAttribute("aria-busy", String(listState === "loading"));
    if (listState === "loading" && !list) {
      host.innerHTML = '<p class="loading-line" role="status">Consultando o catálogo…</p>';
      return;
    }
    if (listState === "error") {
      host.innerHTML = `<p class="form-error" role="alert">${esc(listError)}</p><button type="button" class="subtle small" data-action="st-retry">Tentar novamente</button>`;
      return;
    }
    if (!list) return;
    if (!list.total) {
      host.innerHTML = search
        ? `<p class="feed-empty">Nenhuma faixa encontrada para “${esc(search)}”.</p>`
        : `<div class="st-empty"><p><strong>O catálogo ainda não tem músicas.</strong></p><p class="small">As faixas são disponibilizadas pela administração da plataforma. Quando houver músicas, elas aparecem aqui para busca.</p></div>`;
      return;
    }
    const current = engine.snapshot().music?.trackId;
    const pages = Math.ceil(list.total / list.pageSize);
    host.innerHTML = `<ul class="st-tracks">${list.items
      .map(
        (t) =>
          `<li class="st-track-row${t.id === current ? " is-current" : ""}"><div><strong>${esc(t.title)}</strong><small>${esc(t.format)} · ${t.durationMs ? formatTime(t.durationMs) : "duração desconhecida"}${t.id === current ? ' · <span class="status-chip">Na mesa</span>' : ""}</small></div><button type="button" class="subtle small" data-action="st-select" data-id="${esc(t.id)}" aria-label="Tocar na mesa: ${esc(t.title)}"${pending || ended() ? " disabled" : ""}>▶ Tocar</button></li>`,
      )
      .join("")}</ul>${
      pages > 1
        ? `<div class="pagination"><button type="button" class="subtle small" data-action="st-page" data-id="${list.page - 1}"${list.page <= 1 ? ' aria-disabled="true" data-tip="Você está no início da lista."' : ""}>← Anterior</button><span>Página ${list.page} de ${pages}</span><button type="button" class="subtle small" data-action="st-page" data-id="${list.page + 1}"${list.page >= pages ? ' aria-disabled="true" data-tip="Você está no fim da lista."' : ""}>Próxima →</button></div>`
        : ""
    }`;
  }

  async function loadList() {
    if (!isMaster() || !panel) return;
    const seq = ++listSeq;
    listState = "loading";
    renderList();
    try {
      const result = await searchCatalog({ search, page, background: true });
      // Resposta de uma busca anterior chegou depois: descartada.
      if (seq !== listSeq || disposed) return;
      list = result;
      listState = "ready";
    } catch (failure) {
      if (seq !== listSeq || disposed) return;
      listState = "error";
      listError = failure.message;
    }
    renderList();
  }

  // ---------- Comandos ----------
  async function run(action, extra = {}) {
    if (pending || !isMaster() || ended()) return;
    pending = true;
    render();
    try {
      const version = engine.snapshot().music?.version ?? live?.music?.version ?? 0;
      const result = await soundtrackCommand(sessionId, action, version, extra);
      engine.update(result.music, result.serverTime);
      if (action === "select" || action === "stop") renderList();
    } catch (failure) {
      toast(failure.message);
    } finally {
      pending = false;
      render();
    }
  }

  function relativeSeek(deltaMs) {
    const snap = engine.snapshot();
    if (!snap.music?.trackId) return;
    const duration = Number(snap.durationMs) || Infinity;
    run("seek", { positionMs: Math.round(Math.min(duration, Math.max(0, snap.positionMs + deltaMs))) });
  }

  async function handle(action, element) {
    if (action === "st-open") return onOpen();
    if (action === "st-unlock") return engine.unlock();
    if (action === "st-mute") return engine.setMuted(!engine.snapshot().muted);
    if (action === "st-retry") return loadList();
    if (action === "st-page") {
      if (element.getAttribute("aria-disabled") === "true") return;
      page = Math.max(1, Number(element.dataset.id) || 1);
      return loadList();
    }
    if (action === "st-select") return run("select", { trackId: element.dataset.id, autoplay: true });
    const music = engine.snapshot().music;
    if (action === "st-toggle") return run(music?.playing && !engine.snapshot().ended ? "pause" : "play");
    if (action === "st-stop") return run("stop");
    if (action === "st-loop") return run("loop", { loop: !music?.loop });
    if (action === "st-back") return relativeSeek(-10000);
    if (action === "st-forward") return relativeSeek(10000);
  }

  const onClick = (event) => {
    const element = event.target.closest("[data-action^='st-']");
    if (!element || element.disabled) return;
    event.preventDefault();
    handle(element.dataset.action, element).catch((failure) => toast(failure.message));
  };
  chipHost.addEventListener("click", onClick);

  const onInput = (event) => {
    const target = event.target;
    if (target.id === "st-volume") engine.setVolume(Number(target.value) / 100);
    if (target.id === "st-seek") {
      seeking = true;
      const duration = Number(engine.snapshot().durationMs) || 0;
      setText(q(".st-elapsed"), formatTime(Number(target.value) * 1000));
      target.setAttribute("aria-valuetext", `${formatTime(Number(target.value) * 1000)} de ${formatTime(duration)}`);
    }
    if (target.id === "st-search") {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        search = target.value.trim().slice(0, 100);
        page = 1;
        loadList();
      }, 300);
    }
  };
  const onChange = (event) => {
    if (event.target.id !== "st-seek") return;
    // Teclado gera um "change" por tecla: envia uma única posição depois da última alteração.
    clearTimeout(seekTimer);
    const value = Number(event.target.value);
    seekTimer = setTimeout(() => {
      seeking = false;
      run("seek", { positionMs: value * 1000 });
    }, 350);
  };
  const onSubmit = (event) => {
    if (event.target.closest(".st-search")) event.preventDefault();
  };

  function mountPanel(host) {
    if (panel === host && host.querySelector(".soundtrack")) return render();
    unmountPanel();
    panel = host;
    host.innerHTML = panelHtml();
    host.addEventListener("click", onClick);
    host.addEventListener("input", onInput);
    host.addEventListener("change", onChange);
    host.addEventListener("submit", onSubmit);
    // Progresso visível: atualiza uma vez por segundo, sem trabalho com a aba oculta.
    ticker = setInterval(() => {
      if (!document.hidden && panel) renderProgress(engine.snapshot());
    }, 1000);
    render();
    if (isMaster()) {
      const field = q("#st-search");
      if (field) field.value = search;
      if (list) renderList();
      loadList();
    }
  }

  function unmountPanel() {
    if (!panel) return;
    clearInterval(ticker);
    clearTimeout(searchTimer);
    clearTimeout(seekTimer);
    seeking = false;
    listSeq++;
    panel.removeEventListener("click", onClick);
    panel.removeEventListener("input", onInput);
    panel.removeEventListener("change", onChange);
    panel.removeEventListener("submit", onSubmit);
    panel = null;
  }

  function update(next) {
    if (disposed) return;
    const roleChanged = panel && live && !!live.me?.isMaster !== !!next.me?.isMaster;
    live = next;
    if (next.music) engine.update(next.music, next.serverTime);
    if (roleChanged) {
      const host = panel;
      unmountPanel();
      mountPanel(host);
    }
    render();
  }

  function dispose() {
    if (disposed) return;
    unmountPanel();
    disposed = true;
    chipHost.removeEventListener("click", onClick);
    engine.dispose();
    chipHost.hidden = true;
    chipHost.innerHTML = "";
  }

  return { update, mountPanel, unmountPanel, dispose, isMounted: (host) => panel === host };
}
