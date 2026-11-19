// Mesa do convidado (ADR-114): #/convidado/{segredo} funciona sem conta. O nome é pedido, o convite é resgatado
// (cookie HttpOnly do servidor) e o segredo sai da barra de endereço e do histórico na hora (replaceState).
// O segredo nunca é guardado nem registrado. Observador só acompanha; participante rola, conversa e move o marcador
// que o mestre entregar. Consulta longa com recuo, presença a cada 30 s (pausada em aba oculta) e descarte ao sair.
import { api } from "./api.js";
import { $, esc, toast, formError, submitForm } from "./ui.js";
import { icon } from "./icons.js";
import { helpButton } from "./help.js";
import { nextPollDelay, eventMeta, eventData, initials } from "./session-policy.js";
import { mountSpectatorBoard, spectatorView } from "./spectator-view.js";
import { placement, isFreeMap } from "./free-move-policy.js";
import { normalizeGuestName, guestAbilities, redeemMessage, DEFAULT_GUEST_NAME, GUEST_NAME_MAX, GUEST_MODES } from "./guest-policy.js";

const GUEST_HEARTBEAT_MS = 30000;
const quick = (path, method, body, signal) => api(path, method, body, { background: true, signal });
const time = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Entrada do roteador. Devolve sempre a função de descarte (a mesa pode montar depois do formulário). */
export async function renderGuest(secret = "") {
  let cleanup = null, disposed = false;
  const mount = (state) => { if (!disposed) cleanup = mountGuest(state, () => { cleanup = null; }); };
  document.title = "Mesa como convidado · Eternnus RPG";
  if (secret) askName(secret, mount, () => disposed);
  else {
    try {
      mount(await api("/guest/state"));
    } catch (error) {
      if (error.status === 401 || error.status === 404) gate("Entrar como convidado", "Abra o link de convite que o mestre enviou para entrar na mesa. O link só vale por tempo limitado.");
      else gate("Não foi possível abrir a mesa", error.message || "Tente novamente em instantes.", true);
    }
  }
  return () => { disposed = true; cleanup?.(); cleanup = null; };
}

/** Tela simples (sem menu da conta): instruções, fim do acesso ou falha. */
function gate(title, text, retry = false) {
  const app = $("#app");
  app.className = "guest-app";
  app.innerHTML = `<main id="main" class="guest-gate metal" tabindex="-1"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"><h1>${esc(title)}</h1><p>${esc(text)}</p>${retry ? `<button type="button" class="primary" id="g-retry">Tentar de novo</button>` : `<a class="button subtle" href="#overview">Ir para o Eternnus RPG</a>`}</main>`;
  $("#g-retry")?.addEventListener("click", () => location.reload());
  $("#main").focus({ preventScroll: true });
}

function askName(secret, mount, isDisposed) {
  const app = $("#app");
  app.className = "guest-app";
  app.innerHTML = `<main id="main" class="guest-gate metal" tabindex="-1"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG">`
    + `<h1>Entrar na mesa como convidado${helpButton("mesa.convidado.entrar", "Entrar como convidado")}</h1>`
    + `<p>Você entra sem conta, só nesta mesa e enquanto o convite valer. O mestre pode encerrar o acesso a qualquer momento.</p>`
    + `<form id="g-join" class="guest-join" autocomplete="off" novalidate><div class="field"><div class="field-label"><label for="g-name">Seu nome na mesa</label></div>`
    + `<input id="g-name" name="name" maxlength="${GUEST_NAME_MAX}" value="${esc(DEFAULT_GUEST_NAME)}" autocomplete="nickname" aria-describedby="g-name-hint">`
    + `<small class="form-help" id="g-name-hint">Até ${GUEST_NAME_MAX} caracteres. O mestre e a mesa veem este nome.</small></div>${formError()}`
    + `<button type="submit" class="primary">Entrar na mesa</button></form></main>`;
  const form = $("#g-join");
  $("#g-name").select();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const name = normalizeGuestName(data.name);
      try {
        await api("/guest/redeem", "POST", { secret, name });
      } catch (error) {
        throw new Error(redeemMessage(error.status, error.message));
      }
      // O segredo sai do endereço e do histórico assim que o convite é aceito (sem disparar nova navegação).
      history.replaceState(null, "", "/#/convidado");
      secret = "";
      if (isDisposed()) return;
      let state;
      try { state = await api("/guest/state"); }
      catch (error) { gate("Não foi possível abrir a mesa", error.message || "Tente novamente em instantes.", true); return; }
      if (!isDisposed()) mount(state);
    });
  });
}

function mountGuest(initial, onGone) {
  const app = $("#app");
  app.className = "guest-app";
  app.innerHTML = `<div class="guest-shell">`
    + `<header class="guest-top"><img class="guest-logo" src="/assets/eternnus-logo.webp" alt="Eternnus RPG"><div class="guest-title"><h1 id="g-title">Mesa</h1><p id="g-sub"></p></div>`
    + `<div class="guest-follow" id="g-follow"></div><div class="guest-camera" id="g-camera"></div><div class="music-dock"></div>`
    + `<button type="button" class="subtle" id="g-leave">${icon("leave")}<span>Sair da mesa</span></button></header>`
    + `<main id="main" class="guest-stage" tabindex="-1" aria-label="Mapa da sessão"><div class="board" id="g-board"></div><p class="guest-hint" id="g-hint" role="status" hidden></p><p class="display-status" id="g-status" role="status" hidden></p></main>`
    + `<section class="guest-side" aria-labelledby="g-feed-title"><h2 id="g-feed-title">Acontecimentos${helpButton("mesa.convidado.mesa", "Mesa do convidado")}</h2><ol class="feed-list guest-feed" id="g-feed" tabindex="0" aria-label="Acontecimentos públicos da mesa"></ol><div id="g-forms"></div></section>`
    + `</div>`;
  const controller = new AbortController();
  let live = null, rev = 0, failures = 0, stopped = false, timer = 0, selected = null, formsKey = "";
  const view = mountSpectatorBoard($("#g-board"), {
    sessionId: initial.session?.id, cameraHost: $("#g-camera"), followHost: $("#g-follow"), followDefault: true,
    onToken: (token) => onToken(token), onCell: (cell) => onCell(cell), onDrop: (token, cell) => onDrop(token, cell),
  });

  const abilities = () => guestAbilities(live?.me, live || {});
  function boardView() {
    const can = abilities();
    return spectatorView({ draggable: can.move ? can.token.id : null, selected: can.move ? selected : null });
  }
  function hint(text) {
    $("#g-hint").textContent = text;
    $("#g-hint").hidden = !text;
  }
  function apply(state) {
    live = state;
    rev = state.revision;
    const me = state.me || {};
    const scene = state.play?.scene?.name || state.map?.name || "";
    $("#g-title").textContent = state.campaign?.name || "Mesa";
    $("#g-sub").innerHTML = [esc(me.name || DEFAULT_GUEST_NAME), `<span class="mode-chip">${esc(GUEST_MODES[me.mode]?.label || "Convidado")}</span>`, scene ? esc(scene) : ""].filter(Boolean).join('<span aria-hidden="true"> • </span>');
    document.title = `${state.campaign?.name || "Mesa"} · Convidado · Eternnus RPG`;
    const can = abilities();
    if (!can.move) selected = null;
    view.update(state, boardView());
    renderFeed();
    renderForms(can);
    hint(can.move ? (selected ? "Toque na casa de destino ou arraste o marcador. Esc cancela." : `Você controla ${can.token.label || "um marcador"}: arraste ou toque nele e depois na casa.`) : "");
    if (state.session?.endedAt) end("A sessão terminou", "O mestre encerrou a sessão. Obrigado por participar!");
  }
  function renderFeed() {
    const list = (live.events || []).filter((e) => !["move", "token", "music"].includes(e.kind)).slice(-80);
    const feed = $("#g-feed");
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    feed.innerHTML = list.map(eventHtml).join("") || `<li class="feed-empty">Os acontecimentos públicos aparecem aqui.</li>`;
    if (nearBottom || !feed.dataset.ready) feed.scrollTop = feed.scrollHeight;
    feed.dataset.ready = "1";
  }
  function renderForms(can) {
    // Só redesenha quando muda o que é permitido: preserva o texto digitado entre atualizações.
    const key = `${can.roll}|${can.chat}`;
    if (key === formsKey) return;
    formsKey = key;
    $("#g-forms").innerHTML = can.participant
      ? `${can.roll ? `<form id="g-roll" class="guest-roll" autocomplete="off"><div class="field-label"><label for="g-formula">Rolar dados</label></div><div class="guest-inline"><input id="g-formula" name="formula" maxlength="100" required placeholder="1d20+2" aria-describedby="g-formula-hint" inputmode="text"><button type="submit" class="primary">${icon("dice")}<span>Rolar</span></button></div><small class="form-help" id="g-formula-hint">Ex.: 1d20+2, 2d6. A rolagem acontece no servidor e aparece para a mesa.</small></form>` : ""}`
        + `${can.chat ? `<form id="g-chat" class="chat-form guest-chat" autocomplete="off"><label class="sr-only" for="g-message">Mensagem para a mesa</label><input id="g-message" name="content" maxlength="2000" required placeholder="Escrever mensagem…"><button type="submit" class="primary icon-send" aria-label="Enviar">➤</button></form>` : ""}`
      : `<p class="form-help guest-observer">Você está como observador: acompanha o mapa e os acontecimentos, sem agir na mesa.</p>`;
  }
  function eventHtml(e) {
    const [mark, label] = eventMeta(e.kind);
    const data = eventData(e);
    if (e.kind === "message") return `<li class="feed-item message"><span class="feed-avatar" aria-hidden="true">${esc(initials(e.author))}</span><div><p class="feed-head"><strong>${esc(data.master && !data.guest ? "Mestre" : e.author)}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(e.content)}</p></div></li>`;
    if (e.kind === "roll" && data.roll) return `<li class="feed-item roll"><span class="feed-die" aria-hidden="true">⬡</span><div><p class="feed-head"><strong>${esc(data.actor || e.author || "Rolagem")}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(data.label ? `${data.label}: ` : "")}${esc(data.roll.formula || "")} = <b>${esc(String(data.roll.total ?? ""))}</b></p></div></li>`;
    if (e.kind === "scene") return `<li class="feed-item scene"><span class="feed-die" aria-hidden="true">▤</span><div><p class="feed-head"><strong>${esc(data.name || "Cena")}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(data.sharedText || e.content)}</p></div></li>`;
    return `<li class="feed-item ${esc(e.kind)} system"><span aria-hidden="true">${esc(mark)}</span> <span class="sr-only">${esc(label)}: </span>${esc(e.content)} <time>${time(e.createdAt)}</time></li>`;
  }

  // ---------- Movimento do marcador entregue pelo mestre ----------
  async function move(cell) {
    const can = abilities();
    if (!can.move) return false;
    try {
      await quick("/guest/move", "POST", placement(cell, isFreeMap(live.map)), controller.signal);
      selected = null;
      return true;
    } catch (error) {
      if (error.name !== "AbortError") { hint(error.message); toast(error.message); }
      return false;
    }
  }
  function onToken(token) {
    const can = abilities();
    if (!can.move) return;
    if (token.id === can.token.id) {
      selected = selected ? null : token.id;
      if (selected) view.board.interact();
      view.board.setView(boardView());
      hint(selected ? "Toque na casa de destino ou arraste o marcador. Esc cancela." : "");
    } else if (selected) move({ x: token.x, y: token.y });
  }
  function onCell(cell) {
    if (selected) move(cell).then(() => view.board.setView(boardView()));
  }
  async function onDrop(token, cell) {
    return token.id === abilities().token?.id ? move(cell) : false;
  }
  const onKey = (e) => {
    if (e.key === "Escape" && selected && !document.querySelector("#help-popup:popover-open")) { selected = null; view.board.setView(boardView()); hint(""); }
  };
  document.addEventListener("keydown", onKey);

  // ---------- Formulários (rolagem e conversa) ----------
  const onSubmit = async (e) => {
    const form = e.target;
    if (!["g-roll", "g-chat"].includes(form.id)) return;
    e.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (form.id === "g-roll") {
        const r = await quick("/guest/roll", "POST", { formula: String(data.formula || "").trim() });
        toast(r?.hidden ? "Rolagem enviada ao mestre." : r?.total != null ? `Resultado: ${r.total}` : "Rolagem enviada.");
      } else await quick("/guest/message", "POST", { content: String(data.content || "").trim() });
      form.reset();
      form.querySelector("input")?.focus();
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
  };
  $(".guest-side").addEventListener("submit", onSubmit);

  // ---------- Leitura ao vivo, presença e saída ----------
  function connection(ok) {
    $("#g-status").hidden = ok;
    $("#g-status").textContent = ok ? "" : "Reconectando…";
  }
  async function poll() {
    while (!stopped) {
      const started = performance.now();
      try {
        const next = await quick(`/guest/live?after=${rev}`, "GET", undefined, controller.signal);
        failures = 0;
        connection(true);
        if (next && next.revision >= rev) apply(next);
      } catch (error) {
        if (stopped || error.name === "AbortError") return;
        if (error.status === 401 || error.status === 404) return end("Seu acesso de convidado terminou.", "O mestre encerrou o convite ou a sessão. Peça um novo link se quiser voltar.");
        failures++;
        connection(false);
      }
      await new Promise((r) => { timer = setTimeout(r, nextPollDelay(failures, performance.now() - started)); });
    }
  }
  async function heartbeat() {
    if (stopped || document.hidden) return;
    try { await quick("/guest/heartbeat", "POST", undefined, controller.signal); }
    catch (error) { if (!stopped && error.status === 401) end("Seu acesso de convidado terminou.", "O mestre encerrou o convite ou a sessão. Peça um novo link se quiser voltar."); }
  }
  const beat = setInterval(heartbeat, GUEST_HEARTBEAT_MS);
  const onVisible = () => { if (!document.hidden) heartbeat(); };
  document.addEventListener("visibilitychange", onVisible);
  $("#g-leave").addEventListener("click", async () => {
    $("#g-leave").disabled = true;
    try { await quick("/guest/leave", "POST"); } catch {}
    end("Você saiu da mesa.", "Para voltar, abra de novo um link de convite válido.");
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    controller.abort();
    clearTimeout(timer);
    clearInterval(beat);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("keydown", onKey);
    view.destroy();
  }
  function end(title, text) {
    stop();
    onGone();
    gate(title, text);
  }

  apply(initial);
  if (!stopped) { poll(); heartbeat(); }
  return stop;
}
