import { helpButton } from "./help.js";
import { mountTableViewport, COMPACT_TABLE } from "./table-viewport.js";
// Mesa ao vivo (Telas 07 e 08): grupo à esquerda, mapa central, painel de registros e barra de turno.
// Leitura por long-poll somente GET; todas as escritas passam por api.js (CSRF). O servidor decide turnos e permissões.
import { api } from "./api.js";
import { state as app } from "./state.js";
import {
  $,
  esc,
  button,
  iconButton,
  actionBar,
  modal,
  formError,
  submitForm,
  toast,
  navigate,
  liveBadge,
} from "./ui.js";
import { createBoard } from "./table-map.js";
import { mountMapRulers } from "./map-ruler.js";
import { icon } from "./icons.js";
import { mountTemporaryImages } from "./temporary-images.js";
import { mountSoundtrack } from "./table-soundtrack.js";
import {
  sheetViewHtml,
  hpBar,
  paintBars,
  openSheetEditor,
  guardAvatars,
} from "./sheet.js";
import {
  HEARTBEAT_MS,
  eventData,
  eventMeta,
  feedFor,
  hpState,
  isMyTurn,
  myToken,
  movementSquares,
  nextPollDelay,
  onlinePlayers,
  reachableCells,
  initials,
  sessionLabel,
} from "./session-policy.js";
import { FOG_TOOLS, FOG_PICKS, MARK_KINDS, fogReach, decodeBits, settingsFromForm, attackCells } from "./fog-policy.js";
import { settingsFields } from "./table-settings.js";
import { TOKEN_LIGHT_PRESETS, VISION_PRESETS, CUSTOM, DEFAULT, presetText, tokenPresetOf, presetById } from "./light-presets-policy.js";
import { tableCommands } from "./table-commands-policy.js";
import { mountCommandPalette, openCommandPalette } from "./command-palette.js";
import { viewOnMyTurn, playerCommands, requiresTurn, modeLabel, resourceState, waitingText, canUndo, unreadCount, MOBILE_VIEWS, QUICK_DICE, quickSpec, rollSpotlight, tokenBubbles } from "./play-policy.js";
import { isImageType, isUvttName } from "./vtt-import-policy.js";
import { doorNear } from "./wall-policy.js";
import { interfaceMode, interfaceToggle, mountInterfaceToggle, onInterfaceChange, setInterfaceMode } from "./interface-mode.js";
import { HELP, hiddenCustomizations, pendingParts } from "./scene-policy.js";
import { isFreeMap, tokenCenter, freeReachCells, withinReach, placement } from "./free-move-policy.js";
import { createFollow } from "./spectator-view.js";
import { FOLLOW, followLabels } from "./camera-policy.js";
import { controllableToken, participantSeats, seatControlling, GUEST_MODES } from "./guest-policy.js";
const guestsAdmin = () => import("./table-guests.js");
const tools = () => import("./table-tools.js");
const npcSheets = () => import("./npc-sheet.js");
const tableSheet = () => import("./table-sheet.js");
const mapImport = () => import("./map-import.js");
/** Ferramentas de névoa por grupo (interface Completa) e o atalho "Revelar área" da Básica. */
const FOG_GROUPS = {
  reveal: { label: "Revelar área", tools: ["reveal", "conceal"] },
  walls: { label: "Paredes e portas", tools: ["wall", "blockMove", "blockLight", "door", "toggleDoor", "erase"] },
  light: { label: "Luz e visão", tools: ["light"] },
  explore: { label: "Exploração", tools: ["reveal", "conceal", "mark"] },
};
/** Ícones de linha (icons.js) das ferramentas de névoa, paredes e luz. */
const FOG_ICONS = { reveal: "sun", conceal: "moon", wall: "wall", blockMove: "blockMove", blockLight: "blockLight", door: "door", toggleDoor: "doorToggle", erase: "erase", light: "light", mark: "warning" };

const time = (iso) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

export async function renderTable(campaignId) {
  const entry = await api(`/campaigns/${campaignId}/table`);
  if (entry.campaign.archived) { renderOffline(entry); return null; }
  if (!entry.online) {
    if (entry.isMaster) {
      toast("Nenhuma sessão em andamento. Inicie uma nova sessão.");
      navigate(`campaign/${campaignId}/sessions`);
      return null;
    }
    renderOffline(entry);
    return null;
  }
  const sessionId = entry.session.id;
  if (!entry.isMaster) {
    const linked = entry.characters.filter((c) => c.linked);
    const chosen =
      entry.joinedCharacterId || (linked.length === 1 && !entry.incompatible?.length ? linked[0].id : null);
    if (!chosen) return chooseCharacter(entry, campaignId);
    await api(`/sessions/${sessionId}/join`, "POST", { characterId: chosen });
  } else await api(`/sessions/${sessionId}/join`, "POST", {});
  return mountTable(campaignId, sessionId, entry.isMaster);
}

function renderOffline(entry) {
  $("#app").className = "table-app offline-table";
  $("#app").innerHTML =
    `<main id="main" class="table-offline metal" tabindex="-1"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"><span class="offline-badge" data-tip="Nenhuma sessão está aberta nesta campanha.">Offline</span><h1>${esc(entry.campaign.name)}</h1><p>${entry.campaign.archived ? "Esta campanha está arquivada: o histórico continua disponível, mas não há novas partidas até o mestre restaurá-la." : "A mesa está fechada no momento. Quando o mestre iniciar uma sessão, a campanha aparecerá como <strong>ONLINE</strong> e você entrará direto nela."}</p><div class="form-actions"><a class="button subtle" href="#campaign/${esc(entry.campaign.id)}">Ver campanha</a><a class="button primary" href="#campaigns">← Minhas campanhas</a></div></main>`;
}

function chooseCharacter(entry, campaignId) {
  $("#app").className = "table-app offline-table";
  $("#app").innerHTML =
    `<main id="main" class="table-offline metal" tabindex="-1">${liveBadge(true, entry.paused)}<h1>${esc(entry.campaign.name)}</h1><p>${esc(sessionLabel(entry.session.number, entry.session.title))}</p>${
      entry.characters.length
        ? `<form id="choose-form"><fieldset class="character-choices"><legend>Com qual ficha você entra na mesa?</legend>${entry.characters.map((c, i) => `<label class="character-choice metal"><input type="radio" name="characterId" value="${esc(c.id)}" ${i === 0 ? "checked" : ""}><span class="choice-avatar" aria-hidden="true">${esc(initials(c.name))}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.archetype || "Personagem")}${c.linked ? " · já está nesta campanha" : " · será vinculada"}</small></span></label>`).join("")}</fieldset>${formError()}<div class="form-actions"><a class="button subtle" href="#campaigns">Voltar</a><button type="submit" class="primary">▶ Entrar na mesa</button></div></form>`
        : `<p class="muted">Você ainda não tem uma ficha compatível com esta campanha.</p>`
    }<section class="new-sheet metal"><h2>Criar ficha com o modelo da campanha</h2><p class="small">Modelo: <strong>${esc(entry.template?.name || "da campanha")}</strong>. Você completa o restante da ficha depois, com calma.</p><form id="quick-sheet"><div class="field"><label for="qs-name">Nome do personagem</label><input id="qs-name" name="name" maxlength="100" required autocomplete="off"></div>${formError()}<button type="submit" class="${entry.characters.length ? "subtle" : "primary"}">+ Criar e entrar</button></form></section>${
      entry.incompatible?.length
        ? `<details class="incompatible"><summary>Fichas que não servem aqui (${entry.incompatible.length})</summary><p class="small">Estas fichas são de outro sistema ou usam o modelo privado de outra campanha. Crie uma ficha com o modelo acima.</p><ul>${entry.incompatible.map((c) => `<li>${esc(c.name)} <small>· ${esc(c.system)}</small></li>`).join("")}</ul></details>`
        : ""
    }</main>`;
  const quick = $("#quick-sheet");
  quick.onsubmit = (e) => {
    e.preventDefault();
    submitForm(quick, async (data) => {
      const created = await api("/characters", "POST", { campaignId, name: data.name, values: {} });
      await api(`/sessions/${entry.session.id}/join`, "POST", { characterId: created.id });
      navigate("table/" + campaignId);
    });
  };
  const form = $("#choose-form");
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      submitForm(form, async (data) => {
        await api(`/sessions/${entry.session.id}/join`, "POST", {
          characterId: data.characterId,
        });
        navigate("table/" + campaignId);
      });
    };
  return null;
}

function mountTable(campaignId, sessionId, isMaster) {
  app.liveTable = { campaignId, sessionId, isMaster: !!isMaster };
  const base = `/sessions/${sessionId}`;
  // Comandos rápidos da mesa têm retorno próprio: não cobrem o mapa com o loading universal (ADR-014).
  const quick = (path, method, body) =>
    api(path, method, body, { background: true });
  let live = null,
    rev = 0,
    tab = "chat",
    mode = "none",
    selected = null,
    grid = null, // nulo = padrão do mapa (oculta na movimentação livre, visível com grade)
    failures = 0,
    stopped = false,
    lastEventId = 0,
    sheetSignature = "",
    fogTool = "reveal",
    viewAs = null,
    viewAsState = null,
    fogGroup = "reveal",
    scenesPanel = null,
    scenesLoading = false,
    topHtml = "",
    ui = interfaceMode(),
    mobileView = "map",
    lastSeenChat = 0,
    bubbles = true,
    quickHidden = false,
    pendingNpc = null,
    npcDock = [],
    spotTimer = 0;
  const previousHp = new Map();
  let previousActive;
  const controller = new AbortController();

  $("#app").className = "table-app";
  $("#app").innerHTML = `<div class="table-shell">
    <header class="table-top"><a class="table-brand" href="#campaign/${esc(campaignId)}" aria-label="Voltar à campanha"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"></a><div class="table-title"><h1><span id="t-campaign">Mesa</span> <span class="online-badge" data-tip="A sessão está ativa; presenças aparecem no grupo." id="t-online"><i aria-hidden="true"></i>ONLINE</span></h1><p id="t-sub">Conectando à sessão…</p></div><div class="table-top-scroll" role="group" aria-label="Comandos da sessão — deslize para ver mais"><button type="button" id="t-fullscreen" class="subtle tool-icon" hidden></button><div class="table-top-actions" id="t-top"></div><div class="session-audio-host" id="t-audio" hidden></div><div class="music-dock"></div></div></header>
    <aside class="party" aria-labelledby="party-title" tabindex="-1"><h2 id="party-title"><span aria-hidden="true">⚔</span> Aventureiros <span class="count-chip" id="t-count">0 online</span></h2>${isMaster ? button("Visão do grupo", "t-party-view", "", "subtle small party-view-button") : ""}<ul id="t-party" class="party-list"></ul>${isMaster ? `<details class="npc-dock" id="t-npc-dock"><summary>Personagens do mestre</summary><p class="form-help">Arraste para o mapa ou use “Colocar” e escolha a casa.</p><ul class="npc-dock-list" id="t-npc-dock-list"></ul></details>` : ""}<p class="party-caption">Avatares conectados e estado atual${helpButton("mesa.mapa.legenda", "Marcadores, vida e presença")}</p></aside>
    <main class="stage" id="main" tabindex="-1" aria-label="Mapa da sessão"><div class="stage-chip" id="t-chip"></div><div class="stage-tools" id="t-tools" role="toolbar" aria-label="Ferramentas do mapa" aria-orientation="vertical"></div><div class="fog-palette" id="t-fog" role="toolbar" aria-label="Névoa e luz" hidden></div><div class="play-banner" id="t-banner" role="status" hidden></div><div class="pending-banner" id="t-pending" role="status" hidden></div><div class="board" id="t-board"></div><div class="follow-chip" id="t-follow-chip" hidden></div><div class="turn-herald" id="t-herald" aria-hidden="true"><span></span></div><div class="roll-spotlight" id="t-spot" role="status" aria-live="polite" hidden></div><div class="dice-tray" id="t-dice" role="toolbar" aria-label="Dados rápidos"></div><div class="drop-veil" id="t-drop" hidden><p><strong>Solte para usar como mapa</strong><span>Imagem PNG, JPEG ou WebP, ou arquivo UVTT (.dd2vtt, .uvtt, .df2vtt)</span></p></div><input type="file" id="t-map-file" accept="image/png,image/jpeg,image/webp,.dd2vtt,.uvtt,.df2vtt" hidden><p class="stage-hint" id="t-hint" role="status"></p></main>
    <section class="side-panel" aria-label="Registros da mesa"><div class="ed-side-nav"><div class="panel-tabs ed-side-tabs" role="tablist" aria-label="Painel da mesa" id="t-tabs"></div></div><div class="panel-body" id="t-panel" role="tabpanel" tabindex="0"></div><form id="t-chat" class="chat-form" autocomplete="off"><div class="field-label"><label class="sr-only" for="t-message">Mensagem para a mesa</label>${helpButton("mesa.chat.comandos", "Conversa e dados")}</div><input id="t-message" name="content" maxlength="2000" placeholder="Escrever mensagem… (/r 1d20+3 para rolar)" required><button type="submit" class="primary icon-send" aria-label="Enviar">➤</button></form></section>
    <div class="table-bottom"><footer class="turn-bar" id="t-turn" aria-live="polite"></footer><nav class="table-view-switch" id="t-views" aria-label="Alternar entre mapa, ficha e conversa"></nav></div>
    <div class="ended-veil" id="t-ended" hidden></div>
  </div>`;
  const disposeViewport = mountTableViewport($("#app"), campaignId);
  const board = createBoard($("#t-board"), {
    camera: $(".table-top-scroll"),
    onToken: (token) => onToken(token),
    onCell: (cell) => onCell(cell),
    onPaint: (cells) => onPaint(cells),
    onDrop: (token, cell) => onDrop(token, cell),
    onResize: (token, size) => onResize(token, size),
    onBubble: (token) => bubbleModal(token),
    onCancel: () => setMode("none"),
    onContext: (at) => openTableMenu(at),
    onUserCamera: () => follow?.userMoved(),
  });
  // Réguas do mapa (ADR-117): as mesmas dos editores, 0 no canto do mapa e metros pela escala da grade.
  // Só em mapa com grade e fora do layout compacto; cada pessoa liga ou desliga para si (Busca de ações e menu do mapa).
  const rulers = mountMapRulers($("#main"), $("#t-board"), () => {
    if (!live || live.map.kind !== "tileset") return null;
    const r = board.camera.cellRect({ x: 0, y: 0 });
    const meters = Number(live.map.scaleMeters) > 0 ? Number(live.map.scaleMeters) : 1.5;
    return r.size > 0 ? { x: r.x, y: r.y, cellPx: r.size, cellUnits: meters, unit: "m" } : null;
  });
  // Câmera compartilhada (ADR-115): jogador escolhe seguir o mestre (desligado por padrão, lembrado nesta aba).
  // O mestre nunca segue; a câmera de quem não segue nunca é movida.
  const follow = isMaster ? null : createFollow({
    getBoard: () => board, sessionId, defaultOn: false,
    onChange: () => { if (live) { renderTools(); renderFollowChip(); } },
  });
  function renderFollowChip() {
    const chip = $("#t-follow-chip");
    if (!chip) return;
    const mode = follow && live && !live.me.isMaster ? follow.mode : FOLLOW.FREE;
    chip.hidden = mode === FOLLOW.FREE;
    const html = mode === FOLLOW.PAUSED
      ? `<span class="sr-only" role="status">${followLabels(mode).status}</span>${button("Voltar a seguir", "t-follow-resume", "", "primary small")}`
      : mode === FOLLOW.FOLLOWING ? `<span class="follow-on" role="status">${icon("compass")} Seguindo o mestre</span>` : "";
    if (chip.dataset.mode !== mode) { chip.dataset.mode = mode; chip.innerHTML = html; }
  }
  const temporaryImages = mountTemporaryImages(sessionId, $(".party"));
  // Trilha sonora compartilhada: o selo do topo existe para todos; o painel "Trilha" monta sob demanda.
  const soundtrack = mountSoundtrack({ sessionId, campaignId, chipHost: $("#t-audio"), onOpen: () => openSoundtrackTab() });
  // Interface Básica/Completa: troca só a apresentação; modo, seleção, grade e texto digitado continuam.
  const disposeToggle = mountInterfaceToggle($(".table-shell"));
  const stopInterface = onInterfaceChange((next) => {
    ui = next;
    if (next === "basic" && mode === "fog" && fogGroup !== "reveal") { fogGroup = "reveal"; fogTool = "reveal"; }
    if (!live) return;
    topHtml = "";
    renderHeader(); renderTools(); renderTurnBar(); board.setView(boardView());
    if (tab === "scenes") scenesPanel?.ctl.update({ ...live, _mode: next });
  });

  // ---------- Leitura ao vivo ----------
  async function poll() {
    while (!stopped) {
      const started = performance.now();
      try {
        const next = await api(`${base}/live?after=${rev}`, "GET", undefined, {
          background: true,
          signal: controller.signal,
        });
        failures = 0;
        $("#connection-banner").hidden = true;
        if (next && next.revision >= rev) apply(next);
        if (next?.session.endedAt) return;
      } catch (error) {
        if (stopped || error.name === "AbortError") return;
        if (
          error.status === 404 || error.status === 410 ||
          error.status === 401 ||
          error.status === 403
        ) {
          toast(
            error.status === 404 || error.status === 410
              ? "Você não tem mais acesso a esta mesa."
              : error.message,
          );
          stop();
          navigate(live?.campaign?.isOneShot ? "one-shot" : "campaigns");
          return;
        }
        failures++;
        $("#connection-banner").hidden = false;
        $("#connection-banner").textContent =
          "Conexão com a mesa instável. Tentando novamente…";
      }
      await new Promise((r) =>
        setTimeout(r, nextPollDelay(failures, performance.now() - started)),
      );
    }
  }
  async function heartbeat() {
    if (stopped || !live || live.session.endedAt) return;
    try {
      await quick(`${base}/heartbeat`, "POST");
    } catch (error) {
      if (error.status !== 409 || stopped) return;
      // A presença expirou ou a sessão terminou: confere o estado antes de tentar voltar à mesa.
      try {
        const current = await quick(`${base}/live`);
        apply(current);
        if (!current.session.endedAt && !current.me.joined)
          await quick(
            `${base}/join`,
            "POST",
            current.me.isMaster ? {} : { characterId: current.me.characterId },
          );
      } catch {}
    }
  }
  const beat = setInterval(heartbeat, HEARTBEAT_MS);
  const onVisible = () => {
    if (document.hidden) return;
    heartbeat();
    // NPC criado em outra aba (Preparação › Personagens): a lista aberta se atualiza ao voltar para a mesa.
    if (document.querySelector("#t-npc-dock")?.open) loadNpcDock();
  };
  document.addEventListener("visibilitychange", onVisible);

  function stop() {
    stopped = true;
    controller.abort();
    clearTimeout(spotTimer);
    clearInterval(beat);
    document.removeEventListener("visibilitychange", onVisible);
    rulers.destroy();
    board.destroy();
    disposeViewport();
    temporaryImages.dispose();
    soundtrack.dispose();
    stopInterface();
    disposeToggle();
    scenesPanel?.ctl.unmount();
    const banner = $("#connection-banner");
    if (banner) banner.hidden = true;
  }

  // ---------- Renderização ----------
  function apply(next) {
    const first = !live;
    live = next;
    temporaryImages.update(next);
    soundtrack.update(next);
    rev = next.revision;
    app.liveTable = { campaignId, sessionId, isMaster: !!live.me.isMaster };
    renderHeader();
    renderParty(first);
    renderTools();
    renderTabs();
    renderPanel();
    renderTurnBar();
    renderBanner();
    renderViews();
    renderDice();
    guardAvatars($("#t-turn"));
    if (mode === "move" && !canMoveNow()) mode = "none";
    if (selected && !live.tokens.some((t) => t.id === selected))
      selected = null;
    if (viewAs && !live.participants.some((p) => p.userId === viewAs && p.characterId)) { viewAs = null; viewAsState = null; }
    board.update(boardState(), boardView());
    if (!live.me.isMaster) { follow?.sync(live.camera); renderFollowChip(); }
    if (viewAs) refreshViewAs();
    herald(first);
    if (!first) spotlight();
    lastEventId = Math.max(lastEventId, ...live.events.map((e) => e.id), 0);
    if (live.session.endedAt) showEnded();
  }

  function renderHeader() {
    const s = live.session;
    $("#t-campaign").textContent = live.campaign.name;
    document.title = `${live.campaign.name} — ${sessionLabel(s.number, s.title)} · Eternnus RPG`;
    const me = live.participants.find((p) => p.isMe);
    const play = live.play || {};
    $("#t-sub").innerHTML = [
      esc(sessionLabel(s.number, s.title)),
      live.me.isMaster
        ? `Mestre: ${esc(live.campaign.master)}`
        : `Você joga como <strong>${esc(me?.characterName || "")}</strong>`,
      `<span class="mode-chip" data-tip="Forma de jogar desta sessão">${esc(modeLabel(play.mode))}</span>`,
      requiresTurn(play.mode) ? `Vez: <strong>${esc(s.activeName || "narrativa do mestre")}</strong>` : "",
      play.paused ? '<strong class="paused-chip">⏸ Pausada</strong>' : "",
    ].filter(Boolean).join('<span aria-hidden="true"> • </span>');
    if (live.campaign.isOneShot) $("#t-sub").insertAdjacentHTML("beforeend", `<span class="small"> · One-shot: se o mestre sair, a mesa espera ${play.recoveryMinutes || 10} min; expira ${esc(new Date(live.campaign.expiresAt).toLocaleString("pt-BR"))}</span>`);
    $("#t-online").hidden = !!s.endedAt;
    // Interface Básica/Completa só para o mestre; encerrar fica separado das ações frequentes e mantém o texto.
    // Ações frequentes só com ícone (ADR-105): nome acessível e dica; o estado pausado fica no subtítulo e em destaque.
    const top = live.me.isMaster
      ? `${iconButton("search", "Busca de ações (Ctrl+K)", "t-palette")}${interfaceToggle("t-interface")}${iconButton(play.paused ? "play" : "pause", play.paused ? "Retomar partida" : "Pausar partida", "t-pause", "", play.paused ? "primary" : "subtle")}<span class="top-separator" aria-hidden="true"></span>${iconButton("leave", "Sair da tela (a sessão continua)", "t-exit")}${button(live.campaign.isOneShot ? "■ Encerrar e apagar" : "■ Encerrar sessão", "t-end", "", "danger")}`
      : `${iconButton("search", "Busca de ações (Ctrl+K)", "t-palette")}${iconButton("sheet", "Minha ficha", "t-my-sheet")}${iconButton("leave", "Sair da mesa", "t-exit")}`;
    // Só redesenha quando muda: preserva o foco no controle de interface entre atualizações ao vivo.
    if (top !== topHtml) { topHtml = top; $("#t-top").innerHTML = `<a class="button subtle tool-icon" href="#campaign/${esc(campaignId)}/notes" target="_blank" rel="noopener" aria-label="Meu caderno (abre em nova aba)" data-tip="Meu caderno (abre em nova aba)">${icon("notes")}</a>` + top; }
  }

  function renderParty(first) {
    const players = onlinePlayers(live);
    $("#t-count").textContent = `${players.length} online`;
    const away = live.participants.filter(
      (p) => !p.isMaster && !p.online && p.characterId,
    );
    $("#t-party").innerHTML =
      players
        .map((p) => {
          const active = p.characterId === live.session.activeCharacterId;
          const { tone } = hpState(p.hp, p.maxHp);
          const clickable = p.canView;
          const res = p.summary?.resources?.[0];
          const detail = !p.canView ? "<small>Ficha privada</small>" : `${res ? `<small>${esc(res.label)}: ${esc(resourceState(res).text)}</small>${res.max ? hpBar(res.value, res.max, `${res.label} de ${p.characterName}`) : ""}` : ""}${p.summary?.conditions ? `<small class="conditions">${esc(p.summary.conditions)}</small>` : ""}${p.summary?.effects?.length ? `<small class="effects-chip">${esc(p.summary.effects.map((e) => `${e.name}${e.rounds ? ` · ${e.rounds}` : ""}`).join(", "))}</small>` : ""}`;
          const body = `<img class="avatar" src="${esc(p.avatarUrl)}" alt="" referrerpolicy="no-referrer"><span class="party-text"><strong>${esc(p.characterName)}</strong>${detail}</span><i class="presence" aria-label="Conectado" data-tip="Presença renovada nos últimos 45 segundos"></i>`;
          return `<li class="party-card ${active ? "active" : ""} ${tone}" data-character="${esc(p.characterId)}">${clickable ? `<button type="button" class="party-button" data-action="t-sheet" data-id="${esc(p.characterId)}" aria-label="Abrir ficha de ${esc(p.characterName)}${active ? " (turno atual)" : ""}">${body}</button>` : `<div class="party-button" aria-label="${esc(p.characterName)}${active ? ", turno atual" : ""}">${body}</div>`}${active ? '<span class="turn-flag" aria-hidden="true">⌛</span>' : ""}</li>`;
        })
        .join("") ||
      `<li class="party-empty">${live.me.isMaster ? "Aguardando os aventureiros entrarem na mesa." : "Somente você por enquanto."}</li>`;
    if (away.length)
      $("#t-party").insertAdjacentHTML(
        "beforeend",
        `<li class="party-away">Ausentes: ${away.map((p) => esc(p.characterName)).join(", ")}</li>`,
      );
    // Convidados (ADR-114), só para o mestre: nome, modo, presença e o marcador que controlam.
    const guests = live.me.isMaster && Array.isArray(live.guests) ? live.guests : [];
    if (guests.length)
      $("#t-party").insertAdjacentHTML(
        "beforeend",
        `<li class="party-guests"><span class="party-guests-title">Convidados</span>${guests.map((g) => `<span class="guest-chip${g.online ? " online" : ""}">${esc(g.name)} · ${esc(GUEST_MODES[g.mode]?.label || "Convidado")}${g.tokenId ? ` · controla ${esc(live.tokens.find((t) => t.id === g.tokenId)?.label || "um marcador")}` : ""}${g.online ? "" : " (ausente)"}</span>`).join("")}</li>`,
      );
    paintBars($("#t-party"));
    guardAvatars($("#t-party"));
    for (const p of players) {
      const before = previousHp.get(p.characterId);
      if (!first && before !== undefined && before !== p.hp) {
        const card = $("#t-party").querySelector(
          `[data-character="${CSS.escape(p.characterId)}"]`,
        );
        card?.classList.add(p.hp < before ? "hit" : "heal");
        setTimeout(() => card?.classList.remove("hit", "heal"), 1200);
      }
      previousHp.set(p.characterId, p.hp);
    }
  }

  function renderTools() {
    const tiles = live.map.kind === "tileset";
    const watched = viewAs && live.participants.find((p) => p.userId === viewAs);
    const fogLabel = live.fog?.active ? " · névoa ativa" : "";
    const chip = `<span aria-hidden="true">⚑</span> ${esc(live.map.name)} <span aria-hidden="true">/</span> ${watched ? `Vendo como ${esc(watched.characterName || watched.name)}` : live.me.isMaster ? "Visão do mestre" + fogLabel : "Mapa compartilhado" + fogLabel}`;
    $("#t-chip").innerHTML = chip;
    // Motivo do bloqueio: a liberação do mestre (ADR-079) tem mensagem própria.
    const blocked = awaitingMoveGrant() && (live.play?.myTurn || !requiresTurn(live.play?.mode)) ? "Aguarde o mestre liberar o seu movimento." : "Aguarde sua vez e use um mapa com grade para mover o personagem.";
    const sel = live.tokens.find((t) => t.id === selected);
    // Trilho no padrão dos editores (ADR-105): ferramenta só com ícone, nome acessível e dica; indisponível diz o motivo
    // na dica e no leitor de tela. A Básica vem primeiro, sempre na mesma posição; a Completa acrescenta grupos depois dela
    // e as ações do marcador selecionado ficam no fim, para nada mudar de lugar ao selecionar.
    const railTool = (name, action, label, active = false, reason = "", id = "") =>
      `<button type="button" class="ed-tool${active ? " active" : ""}" data-action="${action}" data-id="${esc(id)}" aria-label="${esc(label)}" aria-pressed="${active}" data-tip="${esc(reason ? `${label}: ${reason}` : label)}"${reason ? ' aria-disabled="true"' : ""}>${icon(name)}</button>`;
    const group = (label, html) => (html ? `<div class="ed-tool-group" role="group" aria-label="${esc(label)}">${html}</div>` : "");
    const needsGrid = tiles ? "" : "Esta ferramenta exige um mapa com grade.";
    const fogOn = !!live.fog?.active;
    const complete = ui === "complete";
    const selBubble = sel ? tokenBubbles(live).get(sel.id) : null;
    const gridMap = tiles && Number(live.map.gridPixels) >= 8 && String(live.map.key || "").startsWith("asset:") && !watched;
    const basicTools = group("Ferramentas básicas", `${railTool("select", "t-tool-select", "Selecionar e mover", mode === "none" && tiles && !watched, needsGrid)}${railTool("flag", "t-tool-place", "Adicionar personagem", mode === "place", needsGrid)}${railTool("gather", "t-gather", "Colocar o grupo na entrada", false, needsGrid)}${fogOn ? railTool("sun", "t-fog-group", "Revelar área", mode === "fog" && fogGroup === "reveal", needsGrid, "reveal") : ""}${railTool(watched ? "eyeOff" : "eye", "t-view-as", watched ? "Voltar à visão do mestre" : "Ver como jogador", !!watched, needsGrid)}`)
      + group("Mapa", `${railTool("upload", "t-map-upload", "Enviar mapa ou UVTT")}${gridMap ? railTool("grid", "t-map-grid", "Ajustar grade do mapa") : ""}`);
    const completeTools = complete
      ? group("Elementos", railTool("light", "t-token-settings", "Luz, visão e ocultação do marcador", false, sel ? "" : "Selecione um marcador no mapa."))
        + group("Paredes, luz e exploração", `${railTool("wall", "t-fog-group", "Paredes e portas", mode === "fog" && fogGroup === "walls", needsGrid, "walls")}${railTool("sun", "t-fog-group", "Luz e visão", mode === "fog" && fogGroup === "light", needsGrid, "light")}${railTool("compass", "t-fog-group", "Exploração e marcas", mode === "fog" && fogGroup === "explore", needsGrid, "explore")}`)
        + group("Grade e configuração", `${railTool("grid", "t-tool-grid", "Mostrar grade", gridShown(), needsGrid)}${railTool("heart", "t-tool-bubbles", "Vida e armadura nos marcadores", bubbles, needsGrid)}${railTool("settings", "t-table-settings", "Configuração da mesa")}`)
        // Participantes (ADR-114/115): câmera compartilhada, exibição externa e convidados.
        + group("Participantes", `${railTool("target", "t-show-region", "Mostrar esta região aos participantes", false, needsGrid)}${railTool("panels", "t-external-display", "Abrir exibição externa")}${railTool("group", "t-guests", "Convidados da mesa")}`)
      : "";
    const selectedTools = sel
      ? group(`Selecionado: ${sel.label}`, `${sel.masterCharacterId ? railTool("sheet", "t-token-sheet", "Ficha do elemento") : ""}${!sel.characterId ? railTool("edit", "t-token-edit", "Editar marcador") : ""}${railTool("character", "t-token-look", "Forma e tamanho")}${selBubble?.target ? railTool("heart", "t-token-bubble", `${selBubble.resource.label} do selecionado`) : ""}${!sel.characterId ? railTool("trash", "t-tool-remove", "Remover marcador") : ""}`)
      : "";
    const hidden = live.me.isMaster && !complete ? hiddenCustomizations({ fog: live.fog, scene: live.play?.scene, tokens: live.tokens }) : [];
    const hiddenTool = hidden.length
      ? `<button type="button" class="ed-tool hidden-chip" data-action="t-hidden" aria-label="Ajustes avançados ativos (${hidden.length}): ver">${icon("settings")}<span class="tool-count" aria-hidden="true">${hidden.length}</span></button>`
      : "";
    $("#t-tools").innerHTML = live.me.isMaster
      ? `${basicTools}${completeTools}${selectedTools}${hiddenTool ? group("Ajustes avançados", hiddenTool) : ""}`
      : group("Mapa", `${railTool("move", "t-move", "Mover meu personagem", mode === "move", canMoveNow() ? "" : blocked)}${railTool("grid", "t-tool-grid", "Mostrar ou ocultar a grade", gridShown(), needsGrid)}${railTool("heart", "t-tool-bubbles", "Mostrar ou ocultar vida e armadura nos marcadores", bubbles, needsGrid)}${railTool("target", "t-focus-board", "Usar o mapa pelo teclado", false, needsGrid)}${railTool("compass", "t-follow", "Seguir o mestre", !!follow?.following)}${railTool("maximize", "t-camera-fit", "Restaurar enquadramento")}`);
    $("#t-tools").classList.remove("labeled-tools");
    $("#t-tools").classList.add("ed-tools", "table-rail");
    renderPending();
    renderFogPalette();
    const pick = FOG_PICKS.find((p) => p.id === fogTool);
    const hint =
      mode === "move"
        ? live.me.character?.movementRole === false || live.play?.mode !== "tactical"
          ? "Arraste seu personagem ou escolha a casa de destino. Esc cancela."
          : `Escolha uma casa destacada ou arraste seu personagem (alcance de ${movementSquares(live.me.character?.movement, live.map.scaleMeters)} quadros). Esc cancela.`
        : !live.me.isMaster && isMyTurn(live) && live.map.kind === "tileset" && live.play?.mode === "tactical"
          ? [canMoveNow() && live.me.character?.movementRole !== false ? "Casas douradas: para onde você pode ir (arraste seu personagem)" : "", live.me.character?.reach > 0 ? `área vermelha: alcance de ataque (${live.me.character.reach} m)` : ""].filter(Boolean).join(" · ")
        : mode === "place"
          ? pendingNpc ? `Clique em uma casa livre para colocar ${npcDock.find((n) => n.id === pendingNpc)?.name || "o personagem"}. Esc cancela.` : "Clique em uma casa livre para posicionar uma criatura."
          : mode === "fog"
            ? pick ? `${pick.label}: clique em uma casa. Esc sai da névoa.` : `${FOG_TOOLS.find((t) => t.id === fogTool)?.label}: clique ou arraste sobre as casas. Esc sai da névoa.`
            : sel && live.me.isMaster
              ? `${sel.label} selecionado: clique no destino.${!sel.characterId && !sel.masterCharacterId ? " Sem ficha: use “Editar marcador” para vincular." : ""}`
              : "";
    $("#t-hint").textContent = hint;
    $("#t-hint").hidden = !hint;
  }

  function renderFogPalette() {
    const host = $("#t-fog");
    const open = live.me.isMaster && mode === "fog";
    host.hidden = !open;
    const stage = $(".stage");
    stage.classList.toggle("fog-open", open);
    if (!open) { stage.style.removeProperty("--fog-h"); return host.replaceChildren(); }
    const fog = live.fog || {};
    // Rótulos visíveis e só as ferramentas do grupo escolhido; ações ao vivo, com aviso persistente.
    const group = FOG_GROUPS[fogGroup] || FOG_GROUPS.reveal;
    const all = [...FOG_TOOLS, ...FOG_PICKS];
    // Barra contextual no padrão dos editores (ADR-105): ferramentas só com ícone numa fila; o nome da escolhida fica visível ao lado.
    const item = (id) => { const t = all.find((x) => x.id === id); return `<button type="button" class="ed-tool${fogTool === id ? " active" : ""}" data-action="t-fog-tool" data-id="${id}" aria-label="${esc(t.label)}" data-tip="${esc(t.label)}" aria-pressed="${fogTool === id}">${icon(FOG_ICONS[id] || "brush")}</button>`; };
    const current = all.find((x) => x.id === fogTool && group.tools.includes(x.id));
    const currentLabel = current ? `<span class="fog-current" aria-hidden="true">${esc(current.label)}</span>` : "";
    const state = fog.inherited ? "inherit" : fog.active ? "on" : "off";
    const fogState = fogGroup === "light" ? `<label class="fog-select"><span>Névoa neste mapa</span><select id="t-fog-state" data-fog-state><option value="inherit" ${state === "inherit" ? "selected" : ""}>Padrão da mesa</option><option value="on" ${state === "on" ? "selected" : ""}>Ligada aqui</option><option value="off" ${state === "off" ? "selected" : ""}>Desligada aqui</option></select></label>` : "";
    const reset = fogGroup === "explore" ? `<button type="button" class="text-button small" data-action="t-fog-reset">Recomeçar exploração…</button>` : "";
    const help = fogGroup === "reveal" || fogGroup === "explore" ? `<p class="fog-help">${esc(HELP.conceal)}</p>` : fogGroup === "walls" ? `<p class="fog-help">${esc(HELP.wall)}</p>` : `<p class="fog-help">${esc(HELP.light)}</p>`;
    host.innerHTML = `<div class="fog-head"><strong>${esc(group.label)}</strong>${helpButton("mesa.nevoa.ferramentas", "Ferramentas de névoa")}<span class="live-note">Ao vivo: os jogadores veem as mudanças.</span><button type="button" class="text-button small" data-action="t-tool-select">Concluir</button></div><div class="fog-group" role="group" aria-label="${esc(group.label)}">${group.tools.map(item).join("")}${currentLabel}${fogState}${reset}</div>${help}`;
    // Reserva o espaço da paleta: o mapa encolhe em vez de ficar coberto.
    requestAnimationFrame(() => { if (!host.hidden) stage.style.setProperty("--fog-h", `${host.offsetTop + host.offsetHeight + 6}px`); });
    const select = host.querySelector("[data-fog-state]");
    if (select) select.onchange = async (e) => {
      const v = e.target.value;
      try { await quick(`${base}/fog/enabled`, "POST", { enabled: v === "inherit" ? null : v === "on" }); }
      catch (error) { toast(error.message); }
    };
  }

  /** Estado desenhado: o do mestre ou, em "ver como", o mapa/marcadores/névoa exatamente como o jogador recebe. */
  function boardState() {
    let state = live;
    if (viewAs && viewAsState) {
      const p = live.participants.find((x) => x.userId === viewAs);
      state = { ...live, map: viewAsState.map, tokens: viewAsState.tokens, fog: viewAsState.fog, me: { ...live.me, isMaster: false, characterId: p?.characterId } };
    }
    // Bolhas de vida e armadura: só dados já recebidos; "ver como" mostra o que o jogador veria.
    const found = tokenBubbles(state);
    return found.size ? { ...state, tokens: state.tokens.map((t) => (found.has(t.id) ? { ...t, bubble: found.get(t.id) } : t)) } : state;
  }
  let viewAsRevision = -1;
  async function refreshViewAs() {
    if (!viewAs || viewAsRevision === live.revision) return;
    viewAsRevision = live.revision;
    try {
      viewAsState = await quick(`${base}/view?as=${encodeURIComponent(viewAs)}`);
      board.update(boardState(), boardView());
    } catch (error) {
      toast(error.message);
      viewAs = null; viewAsState = null;
      renderTools();
      board.update(boardState(), boardView());
    }
  }

  /**
   * No turno do jogador: casas de movimento (se o modelo define Deslocamento) e área do alcance de ataque
   * (se define Alcance de ataque). Sem o papel, nada é desenhado: o mestre informa verbalmente.
   */
  function turnReach() {
    const token = myToken(live), c = live.me.character;
    if (live.me.isMaster || !token || !canMoveNow() || live.map.kind !== "tileset") return { reach: [], attack: [], token: null };
    // Fora da forma tática não há alcance a destacar: o servidor confere paredes e ocupação.
    if (live.play?.mode !== "tactical") return { reach: [], attack: [], token };
    const rows = live.map.rows, w = rows[0]?.length || 0, h = rows.length;
    const scale = Number(live.map.scaleMeters) > 0 ? Number(live.map.scaleMeters) : 1.5;
    let reach = [], reachCircle = null;
    if (c?.movementRole !== false) {
      const squares = movementSquares(c?.movement, scale);
      if (freeMap()) {
        // Livre: outros marcadores não bloqueiam; a casa de destino pode ficar uma além do raio, recortada pelo círculo.
        const cells = fogReach(live.fog, w, h, [token], token, squares + 1) ?? reachableCells(rows, [token], token, squares + 1);
        const own = cells.some((c) => c.x === token.x && c.y === token.y) ? [] : [{ x: token.x, y: token.y }];
        reach = freeReachCells(cells.concat(own), token, squares);
        reachCircle = { ...tokenCenter(token, true), r: squares, squares };
      } else reach = fogReach(live.fog, w, h, live.tokens, token, squares) ?? reachableCells(rows, live.tokens, token, squares);
    }
    const attack = c?.reach > 0 ? attackCells(w, h, token, Math.floor(c.reach / scale)) : [];
    return { reach, attack, token, reachCircle };
  }
  const freeMap = () => isFreeMap(live?.map);
  /** Grade visível: escolha da pessoa nesta mesa ou, sem escolha, oculta na movimentação livre (a grade é só referência). */
  const gridShown = () => grid ?? !freeMap();
  /** Sem o papel Deslocamento, qualquer casa pode ser tentada: o servidor confere paredes, névoa e o movimento do turno. */
  /** Pode mover agora: modo livre (sem vez) ou na própria vez; na tática, um deslocamento por turno. */
  function canMoveNow() {
    const token = myToken(live);
    if (!token || live.me.isMaster || live.map.kind !== "tileset" || !playerCommands(live).canAct) return false;
    // O mestre libera o movimento do turno (configuração "Movimento só com liberação do mestre").
    if (awaitingMoveGrant()) return false;
    return live.play?.mode !== "tactical" || token.lastMovedTurn !== live.session.turnNumber;
  }
  /** Jogador na própria vez, mas o mestre ainda não liberou o movimento. */
  function awaitingMoveGrant() {
    return !live.me.isMaster && !!live.play?.moveNeedsGrant && !live.play?.moveGranted;
  }
  function canMoveTo(cell) {
    if (live.me.character?.movementRole === false || live.play?.mode !== "tactical") return true;
    const turn = turnReach();
    if (!turn.reach.some((c) => c.x === cell.x && c.y === cell.y)) return false;
    return !turn.reachCircle || withinReach(turn.token, cell, turn.reachCircle.squares);
  }

  function boardView() {
    const turn = mode === "fog" || mode === "place" ? { reach: [], attack: [], token: null } : turnReach();
    const paintTool = mode === "fog" && FOG_TOOLS.some((t) => t.id === fogTool);
    const draggable = live.me.isMaster
      ? (mode === "none" && !viewAs ? "*" : null)
      : turn.token && canMoveNow() ? turn.token.id : null;
    const resizable = live.me.isMaster && mode === "none" && !viewAs;
    return { resizable, mode: paintTool ? "paint" : mode, reach: turn.reach, attack: turn.attack, reachCircle: turn.reachCircle ?? null, draggable, selected, grid: gridShown(), bubbles, fogTools: mode === "fog", viewAs: !!(viewAs && viewAsState) };
  }

  /**
   * Alça do mestre: muda o tamanho ou, na imagem livre, a largura/altura e o canto (ADR-092), mantendo forma e imagem.
   * `patch` traz só os campos alterados. True quando o servidor aceitou.
   */
  async function onResize(token, patch) {
    if (!live.me.isMaster) return false;
    const next = { ...token, ...patch };
    const moved = patch.x != null;
    try {
      await quick(`${base}/tokens/${token.id}/appearance`, "POST", {
        appearance: next.appearance || "round", size: next.size ?? 100, imageUrl: token.imageUrl || null,
        width: next.width ?? null, height: next.height ?? null,
        ...(moved ? { x: next.x, y: next.y, fx: next.fx ?? null, fy: next.fy ?? null } : {}),
      });
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  }
  /** Devolve true quando o servidor aceitou: o tabuleiro mantém o marcador no ponto solto até o estado novo chegar. */
  async function onDrop(token, cell) {
    try {
      if (live.me.isMaster) { await quick(`${base}/tokens/${token.id}/move`, "POST", placement(cell, freeMap())); return true; }
      if (token.characterId !== live.me.characterId || !canMoveNow()) return false;
      if (!canMoveTo(cell)) { toast("Solte o personagem em uma casa destacada dentro do seu alcance."); return false; }
      await quick(`${base}/tokens/${token.id}/move`, "POST", placement(cell, freeMap()));
      setMode("none");
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  }
  function setMode(next) {
    if (next !== "place") pendingNpc = null;
    mode = next;
    if (next !== "none") selected = null;
    renderTools();
    board.setView(boardView());
  }

  async function onPaint(cells) {
    if (!live.me.isMaster || mode !== "fog") return;
    try {
      if (fogTool === "conceal" && live.map.gridPixels) {
        const w = live.map.rows[0].length;
        const seen = decodeBits(live.fog?.explored, w * live.map.rows.length);
        if (cells.some((c) => seen[c.y * w + c.x])) toast("Algum jogador já viu parte dessas casas: a imagem já entregue não pode ser recolhida.");
      }
      await quick(`${base}/fog/paint`, "POST", { tool: fogTool, cells });
    } catch (error) {
      toast(error.message);
    }
  }

  async function onFogPick(cell) {
    const fog = live.fog || {};
    if (fogTool === "toggleDoor") {
      // Porta por casa tem prioridade; senão, a porta vetorial mais próxima da casa clicada (ADR-087).
      const c = fog.cells?.[cell.y]?.[cell.x];
      if (c === "d" || c === "o") return quick(`${base}/fog/door`, "POST", cell);
      const door = doorNear(fog.walls, cell);
      if (door) return quick(`${base}/fog/wall-door`, "POST", { id: door.id });
      return toast("Não há porta nessa casa.");
    }
    if (fogTool === "light") return lightModal(cell, (fog.lights || []).find((l) => l.x === cell.x && l.y === cell.y));
    if (fogTool === "mark") return markModal(cell, (fog.marks || []).find((m) => m.x === cell.x && m.y === cell.y));
  }

  function renderTabs() {
    const tabs = live.me.isMaster
      ? [
          ["chat", "Chat", "chat"],
          ["rolls", "Rolagens", "dice"],
          ["scenes", "Cenas", "scenery"],
          ["history", "Histórico", "history"],
          ["notes", "Notas", "notes"],
          ["soundtrack", "Trilha", "music"],
        ]
      : [
          ["chat", "Chat", "chat"],
          ["rolls", "Rolagens", "dice"],
          ["sheet", "Sua ficha", "sheet"],
          ["soundtrack", "Trilha", "music"],
        ];
    if (!tabs.some(([k]) => k === tab)) tab = "chat";
    // Abas no mesmo padrão da barra lateral dos editores (ADR-105/117): ícone em todas, nome visível só na ativa, sem rolagem.
    // O nome continua no leitor de tela (texto oculto) e na dica.
    const html = tabs
      .map(
        ([key, label, name]) =>
          `<button type="button" role="tab" id="tab-${key}" aria-selected="${key === tab}" tabindex="${key === tab ? 0 : -1}" class="ed-side-tab" data-action="t-tab" data-id="${key}" data-tip="${esc(label)}">${icon(name)}<span>${esc(label)}</span></button>`,
      )
      .join("");
    if ($("#t-tabs").innerHTML !== html) $("#t-tabs").innerHTML = html;
    $("#t-chat").hidden = tab !== "chat" || !!live.session.endedAt;
  }

  function renderPanel() {
    const panel = $("#t-panel");
    panel.setAttribute("aria-labelledby", "tab-" + tab);
    if (tab !== "soundtrack" && soundtrack.isMounted(panel)) soundtrack.unmountPanel();
    if (tab === "scenes" && live.me.isMaster) {
      // Painel próprio: mantém seleção e prévia entre atualizações ao vivo.
      if (scenesPanel?.host === panel) return scenesPanel.ctl.update(live);
      if (scenesLoading) return;
      scenesLoading = true;
      sheetSignature = "";
      panel.innerHTML = '<p class="loading-line" role="status">Reunindo cenas…</p>';
      import("./table-scenes.js").then(({ createScenePanel }) => {
        scenesLoading = false;
        if (tab !== "scenes" || stopped) return;
        scenesPanel ??= { ctl: createScenePanel({ base, campaign: { id: campaignId, name: live.campaign.name }, getLive: () => live }), host: null };
        scenesPanel.host = panel;
        scenesPanel.ctl.mount(panel);
      }).catch((error) => toast(error.message));
      return;
    }
    if (scenesPanel?.host) { scenesPanel.ctl.unmount(); scenesPanel.host = null; }
    if (tab === "soundtrack") {
      // Painel próprio: preserva busca, foco e posição do controle entre atualizações ao vivo.
      sheetSignature = "";
      soundtrack.mountPanel(panel);
      return;
    }
    if (tab === "sheet") {
      const c = live.me.character;
      const signature = JSON.stringify(c);
      if (signature === sheetSignature && panel.querySelector(".sheet-view"))
        return;
      sheetSignature = signature;
      panel.innerHTML = c ? summaryHtml(c) : '<p class="muted small">Nenhuma ficha vinculada.</p>';
      paintBars(panel);
      return;
    }
    sheetSignature = "";
    const nearBottom =
      panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
    const list = feedFor(live.events, tab === "history" ? "all" : tab);
    const rollForm =
      tab === "rolls" && !live.session.endedAt
        ? `<div class="roll-quick">${button("⬡ Montar rolagem", "t-roll-builder", "", "primary")}${live.me.isMaster ? button("✦ Pedir teste", "t-request", "", "subtle") : ""}<small>Rolagens acontecem no servidor. Você escolhe quem vê o resultado.</small></div>${live.me.isMaster ? requestsHtml() : ""}`
        : "";
    const noteForm =
      tab === "notes"
        ? `<form id="t-note" class="note-form"><label for="t-note-text">Anotação da sessão</label><textarea id="t-note-text" name="content" maxlength="2000" rows="3" required placeholder="Pistas, consequências, lembretes…"></textarea><label class="check"><input type="checkbox" name="shared"> Compartilhar com os jogadores como narração</label><button type="submit" class="primary">✎ Registrar nota</button></form>`
        : "";
    const empty = {
      chat: "A conversa da mesa começa aqui.",
      rolls: "Nenhuma rolagem nesta sessão ainda.",
      history: "Os acontecimentos aparecerão aqui.",
      notes: "Nenhuma anotação registrada.",
    }[tab];
    if (tab === "chat") { lastSeenChat = lastEventId; }
    panel.innerHTML = `${rollForm}${noteForm}<ol class="feed-list ${tab}">${list.map((e) => eventHtml(e, e.id > lastEventId && lastEventId > 0)).join("") || `<li class="feed-empty">${empty}</li>`}</ol>`;
    if (tab !== "notes" && (nearBottom || !panel.dataset.ready))
      panel.scrollTop = panel.scrollHeight;
    panel.dataset.ready = "1";
  }

  function rollDetail(roll, request) {
    if (!roll?.values) return roll?.breakdown ? `<span class="roll-detail">${esc(roll.breakdown)}</span>` : "";
    const values = roll.values.map(Number);
    const kept = Array.isArray(roll.kept) ? new Set(roll.kept) : null;
    const dice = values.map((v, i) => (kept && !kept.has(i) ? `<s aria-label="descartado ${v}">${v}</s>` : String(v))).join(", ");
    const mod = Number(roll.modifier) || 0;
    const result = roll.successes != null ? `${Number(roll.total)} ${Number(roll.total) === 1 ? "sucesso" : "sucessos"}` : Number(roll.total);
    const outcome = roll.outcome || request?.outcome;
    return `<span class="roll-detail">${esc(roll.formula)} (${dice})${mod && roll.successes == null ? ` ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}` : ""} = <b>${esc(result)}</b>${outcome ? ` <em class="outcome ${outcome === "sucesso" ? "ok" : "fail"}">${esc(outcome)}</em>` : ""}${roll.capped ? ' <small>(limite de explosões atingido)</small>' : ""}</span>`;
  }

  function eventHtml(e, fresh) {
    const [icon, label] = eventMeta(e.kind);
    const data = eventData(e);
    const undo = canUndo(e, data, live.me.isMaster) && !live.session.endedAt ? button("↶ Desfazer", "t-undo", String(e.id), "text-button small") : "";
    if (data.secret && live.me.isMaster) return "";
    if (e.kind === "scene")
      return `<li class="${`feed-item scene ${fresh ? "fresh" : ""}`}"><span class="feed-die" aria-hidden="true">▤</span><div><p class="feed-head"><strong>${esc(data.name || "Cena")}</strong> <time>${time(e.createdAt)}</time></p>${data.sharedText ? `<p class="note-text">${esc(data.sharedText)}</p>` : `<p>${esc(e.content)}</p>`}</div></li>`;
    if (e.kind === "request" || e.kind === "pause")
      return `<li class="feed-item ${e.kind} system"><span aria-hidden="true">${e.kind === "pause" ? "⏸" : "✦"}</span> ${esc(e.content)} <time>${time(e.createdAt)}</time></li>`;
    const cls = `feed-item ${e.kind} ${fresh ? "fresh" : ""} ${e.mine && !data.guest ? "mine" : ""}${data.guest ? " guest" : ""}`;
    if (e.kind === "message")
      return `<li class="${cls}"><span class="feed-avatar" aria-hidden="true">${esc(initials(e.author))}</span><div><p class="feed-head"><strong>${esc(data.master && !data.guest ? "Mestre" : e.author)}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(e.content)}</p></div></li>`;
    if (e.kind === "roll" || e.kind === "action") {
      const roll = data.roll;
      const title =
        e.kind === "roll"
          ? `Rolagem${data.label ? ": " + data.label : ""}`
          : data.action || (data.kind === "defender" ? "Defender" : "Ação");
      const actor =
        data.actor || e.content.split(" usou ")[0].split(" assumiu ")[0];
      const summary =
        e.kind === "roll"
          ? ""
          : data.kind === "defender"
            ? "Assumiu postura defensiva até o próximo turno."
            : `Usou ${data.action}${data.target ? " em " + data.target : ""}.${data.description ? " " + data.description : ""}`;
      const privacy = data.visibility === "master" ? '<span class="lock">Jogador e mestre</span>' : data.visibility === "blind" ? '<span class="lock">Somente o mestre</span>' : "";
      return `<li class="${cls}"><span class="feed-die" aria-hidden="true">${roll ? "⬡" : icon}</span><div><p class="feed-head"><strong>${esc(actor)}</strong> · ${esc(title)} <time>${time(e.createdAt)}</time> ${privacy}</p>${summary ? `<p>${esc(summary)}</p>` : ""}${data.secret ? "<p>O resultado fica só com o mestre.</p>" : ""}${roll ? rollDetail(roll, data.request) : ""}</div></li>`;
    }
    if (e.kind === "note")
      return `<li class="${cls} ${e.masterOnly ? "private" : "shared"}"><span class="feed-die" aria-hidden="true">✎</span><div><p class="feed-head"><strong>${e.masterOnly ? "Nota do mestre" : "Narração"}</strong> <time>${time(e.createdAt)}</time>${e.masterOnly ? ' <span class="lock">Visível apenas ao mestre</span>' : ""}</p><p class="note-text">${esc(e.content)}</p></div></li>`;
    if (e.kind === "sheet")
      return `<li class="${cls}"><span class="feed-die" aria-hidden="true">♜</span><div><p class="feed-head"><strong>${label}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(e.content)}</p>${data.reason ? `<small>Motivo: ${esc(data.reason)}</small>` : ""}${undo}</div></li>`;
    return `<li class="${cls} system"><span aria-hidden="true">${icon}</span> ${esc(e.content)} <time>${time(e.createdAt)}</time> ${undo}</li>`;
  }

  /** Último ajuste próprio que ainda pode ser desfeito (o servidor revalida estado e permissão). */
  function lastUndoable() {
    const undone = new Set(live.events.map((e) => eventData(e).undoOf).filter(Boolean));
    return [...live.events].reverse().find((e) => e.mine && !eventData(e).guest && canUndo(e, eventData(e), live.me.isMaster) && !undone.has(e.id));
  }

  function requestCardsHtml() {
    const pending = (live.play?.rollRequests || []).filter((r) => !r.responded);
    const done = (live.play?.rollRequests || []).filter((r) => r.responded);
    if (!pending.length && !done.length) return "";
    return `<div class="request-cards">${pending.map((r) => `<div class="request-card metal" role="group" aria-label="Pedido de teste do mestre"><span><strong>O mestre pediu: ${esc(r.label)}</strong><small>${esc(r.notation)}${r.visibility === "blind" ? " · resultado só para o mestre" : ""}</small></span>${button("⬡ Rolar", "t-respond", r.id, "primary")}</div>`).join("")}${done.map((r) => `<div class="request-card done"><span>${esc(r.label)}: ${r.total == null ? "enviado ao mestre" : `<b>${esc(r.total)}</b>${r.outcome ? ` · ${esc(r.outcome)}` : ""}`}</span></div>`).join("")}</div>`;
  }

  function requestsHtml() {
    const list = live.play?.rollRequests || [];
    if (!list.length) return "";
    return `<section class="request-board" aria-label="Pedidos de teste"><h3>Pedidos de teste</h3>${list.map((r) => `<article class="metal"><header><strong>${esc(r.label)}</strong> <small>${esc(r.notation)}${r.target != null ? ` · alvo ${r.rule === "lte" ? "≤" : "≥"} ${r.target}` : ""} · ${esc({ table: "mesa", master: "jogador e mestre", blind: "só o mestre" }[r.visibility] || "")}</small>${r.closed ? "" : button("Cancelar", "t-request-cancel", r.id, "text-button small")}</header><ul>${r.targets.map((t) => `<li>${esc(t.name)}: ${t.responded ? `<b>${esc(t.total)}</b>${t.outcome ? ` · ${esc(t.outcome)}` : ""}` : '<span class="muted">aguardando</span>'}</li>`).join("")}</ul></article>`).join("")}</section>`;
  }

  /** Ficha resumida: recursos do modelo, destaques, condições, favoritas e acesso à ficha completa. */
  function summaryHtml(c) {
    const resources = (c.resources || []).map((r) => {
      const st = resourceState(r);
      return `<li class="resource-row"><span class="resource-name">${esc(r.label)}</span><span class="resource-value" aria-live="polite">${esc(st.text)}</span>${r.max ? hpBar(r.value, r.max, r.label) : ""}<span class="resource-buttons">${button("−", "t-res", `${r.field}|-1`, "subtle small", `aria-label="Diminuir ${esc(r.label)}"`)}${button("+", "t-res", `${r.field}|1`, "subtle small", `aria-label="Aumentar ${esc(r.label)}"`)}</span></li>`;
    }).join("");
    const stats = (c.stats || []).map((s) => `<li><span>${esc(s.label)}</span><b>${esc(s.value)}</b></li>`).join("");
    const cmds = playerCommands(live);
    return `<div class="sheet-summary"><h3>${esc(c.name)}</h3>${resources ? `<ul class="resource-list">${resources}</ul>` : '<p class="muted small">Este modelo não define recursos para acompanhar na mesa.</p>'}${stats ? `<ul class="stat-list">${stats}</ul>` : ""}<form id="t-conditions" class="conditions-form"><label for="t-cond">Condições e nota curta</label><input id="t-cond" name="conditions" maxlength="300" value="${esc(c.conditions || "")}" placeholder="Ex.: envenenado, sem munição"><button type="submit" class="subtle small">Salvar</button></form><div class="summary-effects"><h4>Condições com duração${helpButton("mesa.condicoes.duracao", "Condições com duração")}</h4><p class="small">${(c.effects || []).length ? esc(c.effects.map((e) => `${e.name}${e.rounds ? ` · ${e.rounds} ${e.rounds === 1 ? "rodada" : "rodadas"}` : ""}`).join(", ")) : "Nenhuma."}</p>${button("Ajustar condições", "t-effects", c.id, "subtle small")}</div><div class="summary-actions"><h4>Ações favoritas${helpButton("mesa.acoes.desfazer", "Desfazer uma mudança")}</h4>${cmds.favorites.length ? cmds.favorites.map((a) => button(esc(a.name), "t-act-id", a.id, "subtle small", cmds.canAct ? "" : `aria-disabled="true" data-tip="${esc(cmds.reason)}"`)).join("") : '<p class="muted small">Sua ficha ainda não tem ações.</p>'}${(c.actions || []).length ? button("☆ Escolher favoritas", "t-favorites", "", "text-button small") : ""}</div>${button("Ver ficha completa", "t-my-sheet", "", "primary wide-button")}</div>`;
  }

  /** Mestre: preparação salva que ainda não vale na mesa (texto, visibilidade, mapa). Aplicar é sempre explícito. */
  function renderPending() {
    const host = $("#t-pending");
    const parts = live.me.isMaster && !live.session.endedAt ? pendingParts(live.play?.scene?.pending) : [];
    host.hidden = !parts.length;
    const html = parts.length ? `<span>Alterações não aplicadas à mesa<span class="pending-detail">: ${parts.map((x) => esc(x[1])).join(", ")}</span>.</span>${button("Revisar e aplicar…", "t-apply-scene", "", "subtle small")}` : "";
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function renderBanner() {
    const banner = $("#t-banner");
    const play = live.play || {};
    const waiting = waitingText(play);
    const text = live.session.endedAt ? "" : play.paused ? "⏸ Partida pausada. A conversa continua aberta até o mestre retomar." : waiting && !live.me.isMaster ? `⌛ ${waiting}` : "";
    banner.hidden = !text;
    banner.textContent = text;
  }

  /** Bandeja de dados sempre visível: um clique rola 1 dado; "Mais" abre o construtor completo. */
  function renderDice() {
    const host = $("#t-dice");
    const cmds = playerCommands(live);
    const off = !!live.session.endedAt || (!live.me.isMaster && !cmds.canRoll);
    const why = live.session.endedAt ? "A sessão foi encerrada." : "A partida está pausada.";
    const dis = off ? `aria-disabled="true" data-tip="${esc(why)}"` : "";
    const html = `${QUICK_DICE.map((d) => `<button type="button" class="die" data-action="t-quick-roll" data-id="${d}" aria-label="Rolar 1d${d}" ${dis}>d${d}</button>`).join("")}<button type="button" class="die more" data-action="t-roll-builder" aria-label="Mais opções de rolagem" ${off ? dis : 'data-tip="Quantidade, modificador, fórmula e favoritas"'}>${icon("dice")}</button>${live.me.isMaster ? `<button type="button" class="die privacy" data-action="t-quick-hidden" aria-pressed="${quickHidden}" aria-label="${quickHidden ? "Rolagens rápidas só para você" : "Rolagens rápidas visíveis à mesa"}" data-tip="${quickHidden ? "Rolagens rápidas só para você" : "Rolagens rápidas visíveis à mesa"}">${icon(quickHidden ? "lock" : "eye")}</button>` : ""}${helpButton("mesa.dados.bandeja", "Dados rápidos")}`;
    if (host.innerHTML !== html) host.innerHTML = html;
    $(".stage").classList.add("has-dice");
  }

  /** Resultado de rolagem recém-chegada em destaque sobre o mapa (o servidor já filtrou quem vê). */
  function spotlight() {
    const fresh = live.events.filter((e) => e.id > lastEventId && e.kind === "roll");
    const last = fresh[fresh.length - 1];
    const s = last && rollSpotlight(last, eventData(last));
    if (!s) return;
    const el = $("#t-spot");
    el.className = `roll-spotlight ${s.tone}`;
    el.innerHTML = `<span class="spot-who">${esc(s.actor)}${s.label ? ` · ${esc(s.label)}` : ""}</span><strong class="spot-total">${esc(s.total)}</strong><span class="spot-formula">${esc(s.formula)}${s.outcome ? ` · ${esc(s.outcome)}` : ""}${s.private ? " · privada" : ""}${s.tone === "crit" ? " · máximo!" : s.tone === "fumble" ? " · mínimo" : ""}</span>`;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(spotTimer);
    spotTimer = setTimeout(() => { el.hidden = true; el.classList.remove("show"); }, 3600);
  }

  async function quickRoll(sides) {
    const cmds = playerCommands(live);
    if (live.session.endedAt || (!live.me.isMaster && !cmds.canRoll)) return toast(live.session.endedAt ? "A sessão foi encerrada." : "A partida está pausada.");
    const body = { spec: quickSpec(sides), label: "" };
    if (live.me.isMaster) body.visibility = quickHidden ? "blind" : "table";
    const r = await quick(`${base}/rolls`, "POST", body);
    if (r?.hidden) toast("Rolagem enviada ao mestre.");
  }

  /** Ajuste da barra de vida (ou do primeiro recurso) do marcador: escrita comum da mesa, conferida no servidor. */
  function bubbleModal(token) {
    const b = token.bubble || tokenBubbles(live).get(token.id);
    if (!b?.target || !b.resource) return;
    const r = b.resource;
    const hp = /^(vida|pv|hp|pontos de vida)/i.test(r.label);
    modal(`${token.label}: ${r.label}`, `<form id="bubble-form"><p class="bubble-now">Agora: <strong>${esc(resourceState(r).text)}</strong>${b.armor ? ` · ${esc(b.armor.label)} ${esc(b.armor.value)}` : ""}</p><div class="field"><label for="f-bubble">Quanto</label><input id="f-bubble" name="amount" type="number" min="1" max="100000" step="1" value="1" required inputmode="numeric"></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger" name="kind" value="down">${hp ? "− Dano" : "− Diminuir"}</button><button type="submit" class="primary" name="kind" value="up">${hp ? "+ Cura" : "+ Aumentar"}</button></div></form>`);
    $("#f-bubble").select();
    $("#bubble-form").onsubmit = (e) => {
      e.preventDefault();
      const up = e.submitter?.value === "up";
      submitForm(e.currentTarget, async (data) => {
        const delta = (up ? 1 : -1) * Math.abs(Math.round(Number(data.amount)));
        if (!delta) throw new Error("Informe um valor maior que zero.");
        const t = b.target;
        if (t.kind === "character") await api(`${base}/characters/${t.id}/resource`, "POST", { field: t.field, delta });
        else await api(`${base}/npcs/${t.id}/resource`, "POST", { index: t.index ?? 0, delta, field: t.field ?? null });
        $("#modal").close();
      });
    };
  }

  /** Mestre solta (ou escolhe) um arquivo: imagem vira mapa com grade sugerida; UVTT traz grade, paredes, portas e luzes. */
  async function useMapFile(file) {
    if (!file) return;
    if (!isImageType(file.type) && !isUvttName(file.name)) return toast("Use imagem PNG, JPEG ou WebP, ou arquivo UVTT (.dd2vtt, .uvtt, .df2vtt).");
    // Depois de trocar o mapa, a conferência da grade abre com o estado ao vivo já atualizado.
    const onGrid = () => setTimeout(() => { if (!stopped && live) mapImport().then((m) => m.openGridModal({ base, live })).catch((e) => toast(e.message)); }, 900);
    (await mapImport()).openDroppedMap({ file, campaignId, base, live, onGrid });
  }

  // Arrastar arquivo sobre o palco: só o mestre troca o mapa. Para todos, soltar não abre o arquivo no navegador.
  const stage = $(".stage");
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  // Personagens do mestre arrastáveis (ADR-100): lista carregada ao abrir; "Colocar" é a alternativa por teclado e toque.
  const NPC_DND = "application/x-eternnus-npc";
  const dock = $("#t-npc-dock");
  async function loadNpcDock() {
    const list = $("#t-npc-dock-list");
    list.innerHTML = '<li class="loading-line" role="status">Carregando…</li>';
    try {
      npcDock = (await api(`/campaigns/${campaignId}/npcs`)).items.filter((n) => !n.copy);
      list.innerHTML = npcDock.length
        ? npcDock.map((n) => `<li draggable="true" data-npc-drag="${esc(n.id)}"><span>${esc(n.name)}</span>${button("Colocar", "t-npc-place", n.id, "subtle small")}</li>`).join("")
        : '<li class="muted small">Nenhum personagem do mestre ainda. Crie em Preparação › Personagens.</li>';
    } catch (error) {
      list.innerHTML = `<li role="alert">Não foi possível carregar. ${esc(error.message)}</li>`;
    }
  }
  dock?.addEventListener("toggle", () => { if (dock.open) loadNpcDock(); });
  dock?.addEventListener("dragstart", (e) => {
    const li = e.target.closest?.("[data-npc-drag]");
    if (!li || !e.dataTransfer) return;
    e.dataTransfer.setData(NPC_DND, li.dataset.npcDrag);
    e.dataTransfer.setData("text/plain", li.querySelector("span")?.textContent || "");
    e.dataTransfer.effectAllowed = "copy";
  });
  const carriesNpc = (e) => [...(e.dataTransfer?.types || [])].includes(NPC_DND) && live?.me.isMaster && !live.session.endedAt && live.map.kind === "tileset";
  async function placeNpc(npcId, cell) {
    await api(`${base}/npc-tokens`, "POST", { masterCharacterId: npcId, ...placement(cell, freeMap()) });
    if (mode === "place") setMode("none");
  }
  stage.addEventListener("dragover", (e) => { if (!carriesNpc(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  stage.addEventListener("drop", (e) => {
    if (!carriesNpc(e)) return;
    e.preventDefault();
    const cell = board.pointAt(e.clientX, e.clientY);
    if (!cell) return toast("Solte o personagem dentro do mapa.");
    placeNpc(e.dataTransfer.getData(NPC_DND), cell).catch((error) => toast(error.message));
  });

  let dragDepth = 0;
  stage.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!live?.me.isMaster || live.session.endedAt) return;
    dragDepth++;
    $("#t-drop").hidden = false;
  });
  stage.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = live?.me.isMaster && !live.session.endedAt ? "copy" : "none";
  });
  stage.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("#t-drop").hidden = true;
  });
  stage.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $("#t-drop").hidden = true;
    if (!live?.me.isMaster || live.session.endedAt) return;
    useMapFile(e.dataTransfer.files?.[0]).catch((error) => toast(error.message));
  });
  $("#t-map-file").addEventListener("change", (e) => { useMapFile(e.target.files?.[0]).catch((error) => toast(error.message)); });

  function renderViews() {
    const views = MOBILE_VIEWS[live.me.isMaster ? "master" : "player"];
    const unread = mobileView === "chat" ? 0 : unreadCount(live.events, lastSeenChat);
    $("#t-views").innerHTML = views.map(([key, label]) => `<button type="button" data-action="t-view" data-id="${key}" aria-pressed="${mobileView === key}" class="${mobileView === key ? "active" : ""}">${label}${key === "chat" && unread ? ` <span class="badge" aria-label="${unread} novas">${unread}</span>` : ""}</button>`).join("");
    $(".table-shell").dataset.view = mobileView;
    $(".table-shell").dataset.role = live.me.isMaster ? "master" : "player";
  }

  function renderTurnBar() {
    const s = live.session;
    const play = live.play || {};
    const turnMode = requiresTurn(play.mode);
    const activeLabel = s.activeName;
    const active = live.participants.find((p) => p.characterId && p.characterId === s.activeCharacterId);
    if (live.me.isMaster) {
      const people = onlinePlayers(live).length;
      // Liberação do movimento: vale para a vez atual (ou, no modo livre, até bloquear).
      const grant = play.moveNeedsGrant && !s.endedAt && (!turnMode || s.activeCharacterId || play.activeTurnKey)
        ? button(play.moveGranted ? "⛔ Bloquear movimento" : "⇢ Liberar movimento", "t-move-grant", play.moveGranted ? "0" : "1", play.moveGranted ? "subtle" : "primary", `aria-pressed="${!!play.moveGranted}"`)
        : "";
      const turn = turnMode
        ? `${iconButton("order", "Ordem de turnos", "t-order")}${iconButton("hourglass", "Dar a vez", "t-set-turn", "", "subtle", people ? "" : 'aria-disabled="true" aria-describedby="t-master-why"')}${button("➤ Próxima vez", "t-next", "", "primary", (people || play.turnOrder?.length) && !s.endedAt ? "" : 'aria-disabled="true" aria-describedby="t-master-why"')}`
        : "";
      $("#t-turn").innerHTML =
        `<div class="turn-who">${active ? `<img class="avatar" src="${esc(active.avatarUrl)}" alt="">` : '<span class="turn-crest" aria-hidden="true">♛</span>'}<div><strong>${turnMode ? (activeLabel ? "Vez de " + esc(activeLabel) : "Narrativa do mestre") : "Condução livre"}</strong><small>${esc(modeLabel(play.mode))}${turnMode ? ` · turno ${s.turnNumber || "—"}` : ""}${play.scene ? ` · cena: ${esc(play.scene.name)}` : ""}</small></div></div><div class="turn-actions">${helpButton("mesa.turnos.ordem", "Ordem e vez")}${iconButton("scenery", "Cenas", "t-scenes")}${iconButton("request", "Pedir teste", "t-request", "", "subtle", people ? "" : 'aria-disabled="true" aria-describedby="t-master-why"')}${iconButton("dice", "Rolar dados", "t-roll-builder")}${iconButton("edit", "Nota", "t-note")}${ui === "complete" ? iconButton("sheet", "Ficha de um jogador", "t-open-sheet", "", "subtle", people ? "" : 'aria-disabled="true" aria-describedby="t-master-why"') : ""}${turn}${grant}${play.moveNeedsGrant ? helpButton("mesa.turnos.liberar-movimento", "Liberar movimento") : ""}</div>${!people || s.endedAt ? `<p class="turn-why" id="t-master-why">${s.endedAt ? "A sessão foi encerrada." : "Aguarde um jogador conectado com ficha. Para avançar, também é possível preparar a ordem."}</p>` : ""}`;
      return;
    }
    const me = live.participants.find((p) => p.isMe);
    const mine = !!play.myTurn;
    const cmds = playerCommands(live);
    const status = play.paused ? "Partida pausada" : !turnMode ? "Aja quando fizer sentido na cena" : mine ? "Sua vez agora" : activeLabel ? "Vez de " + esc(activeLabel) : "O mestre está narrando";
    const fav = cmds.favorites.slice(0, 3).map((a) => `<button type="button" class="subtle" data-action="t-act-id" data-id="${esc(a.id)}" ${cmds.canAct ? "" : `aria-disabled="true" aria-describedby="t-why"`}>${esc(a.name)}</button>`).join("");
    const undo = lastUndoable();
    $("#t-turn").innerHTML =
      `${requestCardsHtml()}<div class="turn-who"><img class="avatar" src="${esc(me?.avatarUrl || "/assets/avatar.svg")}" alt=""><div><strong>${esc(me?.characterName || "")}</strong><small>${status}</small></div>${turnMode ? `<span class="turn-chip ${mine ? "yours" : "waiting"}" data-tip="${mine ? "Você pode agir nesta vez." : "Aguarde o Mestre conceder a sua vez."}">${mine ? "⌛ Sua vez" : "◷ Aguardando"}</span>` : ""}</div><div class="turn-actions"><button type="button" class="primary" data-action="t-roll-builder" ${cmds.canRoll ? "" : 'aria-disabled="true" aria-describedby="t-why"'}>⬡ Rolar dados</button>${fav}${cmds.hasActions ? `<button type="button" class="subtle" data-action="t-actions" ${cmds.canAct ? "" : 'aria-disabled="true" aria-describedby="t-why"'}>✧ Ações</button>` : ""}${iconButton("sheet", "Minha ficha", "t-my-sheet")}${cmds.canMove ? `<button type="button" class="subtle tool-icon ${mode === "move" ? "active" : ""}" data-action="t-move" aria-label="Mover meu personagem" aria-pressed="${mode === "move"}" ${canMoveNow() ? "" : `aria-disabled="true" data-tip="${awaitingMoveGrant() ? "Aguarde o mestre liberar o seu movimento." : "Você já moveu nesta vez ou não pode mover neste momento."}"`}>${icon("move")}</button>` : ""}${cmds.canMove && mine && awaitingMoveGrant() ? `<span class="turn-chip waiting" role="status">◷ Movimento aguardando o mestre</span>` : ""}${undo ? iconButton("undo", "Desfazer a última mudança elegível", "t-undo", String(undo.id)) : ""}${cmds.showEndTurn ? button("✓ Encerrar a vez", "t-end-turn", "", "primary") : ""}</div>${cmds.reason ? `<p class="turn-why" id="t-why">${esc(cmds.reason)}</p>` : ""}`;
    $("#t-turn").classList.toggle("my-turn", mine && turnMode);
  }

  function herald(first) {
    const now = live.session.activeCharacterId;
    if (!first && now !== previousActive && !live.session.endedAt && requiresTurn(live.play?.mode)) {
      const el = $("#t-herald");
      const mine = !!live.play?.myTurn;
      el.querySelector("span").textContent = now
        ? mine
          ? `Seu turno, ${live.session.activeName}`
          : `Turno de ${live.session.activeName}`
        : "O mestre retoma a narrativa";
      el.classList.remove("show", "yours");
      void el.offsetWidth;
      el.classList.add("show");
      if (mine) el.classList.add("yours");
      if (mine) toast("É o seu turno. Escolha sua ação.");
      if (mine) {
        const typing = document.activeElement?.matches?.("input, textarea, select, [contenteditable='true']");
        const next = viewOnMyTurn(mobileView, { compact: matchMedia(COMPACT_TABLE).matches, busy: !!typing || !!document.querySelector("dialog[open]") });
        if (next !== mobileView) { mobileView = next; renderViews(); }
      }
    }
    previousActive = now;
  }

  function showEnded() {
    const veil = $("#t-ended");
    if (!veil.hidden) return;
    veil.hidden = false;
    veil.innerHTML = `<div class="ended-card metal" role="alertdialog" aria-labelledby="ended-title"><span class="status-chip">✓ Sessão encerrada</span><h2 id="ended-title">O capítulo chegou ao fim.</h2><p>${esc(sessionLabel(live.session.number, live.session.title))} foi encerrada pelo mestre. Tudo o que aconteceu ficou registrado.</p><div class="form-actions">${live.me.isMaster ? `<a class="button subtle" href="#campaign/${esc(campaignId)}/sessions">Sessões da campanha</a><a class="button primary" href="#session/${esc(sessionId)}">Ver histórico</a>` : `<a class="button primary" href="#campaigns">← Minhas campanhas</a>`}</div></div>`;
    veil.querySelector("a.primary")?.focus();
    clearInterval(beat);
  }

  // ---------- Tabuleiro ----------
  async function onToken(token) {
    if (live.me.isMaster) {
      if (mode === "fog") return onCell({ x: token.x, y: token.y });
      if (mode === "place") return;
      if (selected && selected !== token.id) {
        selected = token.id;
      } else selected = selected === token.id ? null : token.id;
      renderTools();
      board.setView(boardView());
      return;
    }
    if (
      token.characterId === live.me.characterId &&
      canMoveNow()
    )
      return setMode(mode === "move" ? "none" : "move");
    // NPC/criatura visível com imagem: o jogador abre a imagem maior.
    if (token.image && !token.characterId) (await npcSheets()).showImage(token.image, token.label);
  }
  async function onCell(cell) {
    try {
      if (live.me.isMaster && mode === "fog") return await onFogPick(cell);
      if (live.me.isMaster && mode === "place" && pendingNpc) return await placeNpc(pendingNpc, cell);
      if (live.me.isMaster && mode === "place") return addTokenModal(cell);
      if (live.me.isMaster && selected) {
        await quick(`${base}/tokens/${selected}/move`, "POST", placement(cell, freeMap()));
        return;
      }
      // No turno, clicar numa casa destacada também move (sem precisar ativar "Mover").
      const turnMove = !live.me.isMaster && canMoveNow() && turnReach().reach.some((c) => c.x === cell.x && c.y === cell.y);
      if (mode === "move" || turnMove) {
        const token = myToken(live);
        if (!canMoveTo(cell))
          return toast("Escolha uma casa destacada dentro do seu alcance.");
        await quick(`${base}/tokens/${token.id}/move`, "POST", placement(cell, freeMap()));
        setMode("none");
      }
    } catch (error) {
      toast(error.message);
    }
  }

  // ---------- Modais ----------
  async function addTokenModal(cell) {
    // Ficha (modelo da campanha) e imagem opcionais: com elas, o marcador vira uma criatura acompanhável pela ficha.
    const sheets = await npcSheets();
    const [templates, images, { lookFields, lookFromForm }] = await Promise.all([api(`/campaigns/${campaignId}/npc-templates`), sheets.imageChoices(campaignId), tools()]);
    modal(
      "Adicionar ao mapa",
      `<form id="token-form"><div class="field"><label for="f-label">Nome</label><input id="f-label" name="label" maxlength="40" required placeholder="Esqueleto guardião"></div><div class="form-grid two"><div class="field"><label for="f-side">Lado</label><select id="f-side" name="side"><option value="enemy">Inimigo</option><option value="neutral">Neutro</option><option value="ally">Aliado</option></select></div><div class="field"><label for="f-light">Luz que carrega (casas, opcional)</label><input id="f-light" name="light" type="number" min="0" max="30" step="1" placeholder="Padrão da mesa"></div></div><div class="field"><div class="field-label"><label for="f-template">Ficha (opcional)</label>${helpButton("mesa.npcs.ficha", "Ficha de NPC ou criatura")}</div><select id="f-template" name="templateId"><option value="">Sem ficha</option>${templates.items.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.playerDefault ? " — modelo dos jogadores" : ""}</option>`).join("")}</select><small class="form-help">Com ficha, você acompanha vida e atributos pelo botão “Ficha do elemento”.</small></div>${sheets.imageFields("f-img", "", images)}${lookFields("f-look")}<label class="check"><input type="checkbox" name="hidden"> Oculta: só você vê até revelar</label><p class="form-help">Posição: coluna ${cell.x + 1}, linha ${cell.y + 1}.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${button("♞ Personagem do mestre", "t-npcs-at", `${cell.x}|${cell.y}|${cell.fx ?? ""}|${cell.fy ?? ""}`, "subtle")}<button type="submit" class="primary">⚑ Posicionar</button></div></form>`,
    );
    $("#f-label").focus();
    $("#token-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        const imageUrl = await sheets.imageFromUpload(data, campaignId, data.label);
        const look = lookFromForm(data, !!imageUrl);
        const created = await api(`${base}/tokens`, "POST", { label: data.label, side: data.side, ...placement(cell, freeMap()), hidden: data.hidden === "on", light: data.light === "" ? null : Number(data.light), templateId: data.templateId || null, imageUrl, ...look });
        $("#modal").close();
        if (data.templateId && created.masterCharacterId) {
          selected = created.id;
          toast("Criatura no mapa. Abra “Ficha do elemento” para acompanhar o estado.");
        }
      });
    };
  }

  const optionalInt = (v) => (v === "" || v == null ? null : Math.round(Number(v)));
  const playerChecks = (chosen = []) => {
    const players = live.participants.filter((p) => !p.isMaster && p.characterId);
    return players.length
      ? `<fieldset class="reveal-players"><legend>Revelar para</legend>${players.map((p) => `<label class="check"><input type="checkbox" name="reveal" value="${esc(p.userId)}" ${chosen.includes(p.userId) ? "checked" : ""}> ${esc(p.characterName || p.name)}</label>`).join("")}</fieldset>`
      : `<p class="form-help">Nenhum jogador na sessão para revelar individualmente.</p>`;
  };
  const checkedPlayers = (form) => [...form.querySelectorAll("input[name=reveal]:checked")].map((i) => i.value);

  function lightModal(cell, light) {
    modal(
      light ? "✹ Foco de luz" : "✹ Novo foco de luz",
      `<form id="light-form"><div class="field"><label for="f-radius">Raio (casas)</label><input id="f-radius" name="radius" type="number" min="1" max="30" step="1" value="${light?.radius ?? 4}" required></div><p class="form-help">A luz se espalha em círculo e para em casas que bloqueiam luz. Posição: coluna ${cell.x + 1}, linha ${cell.y + 1}.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${light ? button("Apagar foco", "t-light-remove", light.id, "danger") : ""}<button type="submit" class="primary">Salvar</button></div></form>`,
    );
    $("#light-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        // Cor, penumbra, intensidade e animação (ajustadas no editor) continuam como estavam.
        await api(`${base}/fog/lights`, "POST", { id: light?.id || null, x: cell.x, y: cell.y, radius: Number(data.radius), dim: light?.dim != null && light.dim >= Number(data.radius) ? light.dim : null, color: light?.color ?? null, intensity: light?.intensity ?? null, animation: light?.animation ?? null });
        $("#modal").close();
      });
    };
  }

  function markModal(cell, mark) {
    modal(
      mark ? "⚠ Marca oculta" : "⚠ Nova marca oculta",
      `<form id="mark-form"><div class="field"><label for="f-kind">Tipo</label><select id="f-kind" name="kind">${MARK_KINDS.map(([v, l]) => `<option value="${v}" ${mark?.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="field"><label for="f-mlabel">Nome</label><input id="f-mlabel" name="label" maxlength="40" required value="${esc(mark?.label || "")}" placeholder="Fosso com estacas"></div><fieldset><legend>Detecção automática (opcional)</legend><div class="field"><label for="f-dc">Dificuldade de percepção</label><input id="f-dc" name="dc" type="number" min="-100" max="1000" step="1" value="${mark?.dc ?? ""}"></div><div class="field"><label for="f-maxd">Distância máxima (casas)</label><input id="f-maxd" name="maxDistance" type="number" min="0" max="30" step="1" value="${mark?.maxDistance ?? ""}"></div><div class="field"><label for="f-sense">Sentido que detecta</label><input id="f-sense" name="sense" maxlength="40" value="${esc(mark?.sense || "")}" placeholder="sentir magia"></div><p class="form-help">Sem dificuldade nem sentido, só você revela.</p></fieldset>${mark ? `${playerChecks(mark.revealedTo || [])}<label class="check"><input type="checkbox" name="all" ${mark.revealedAll ? "checked" : ""}> Revelar para todos</label>` : ""}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${mark ? button("Remover marca", "t-mark-remove", mark.id, "danger") : ""}<button type="submit" class="primary">Salvar</button></div></form>`,
    );
    $("#mark-form").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      submitForm(form, async (data) => {
        await api(`${base}/fog/marks`, "POST", { id: mark?.id || null, x: cell.x, y: cell.y, kind: data.kind, label: data.label, dc: optionalInt(data.dc), sense: data.sense || null, maxDistance: optionalInt(data.maxDistance) });
        if (mark) await api(`${base}/fog/marks/${encodeURIComponent(mark.id)}/reveal`, "POST", { all: data.all === "on", userIds: checkedPlayers(form) });
        $("#modal").close();
      });
    };
  }

  /**
   * Editar marcador: nome, lado e ficha (só criaturas) e, agrupados, luz/visão/ocultação.
   * O servidor recebe o estado completo; campos avançados recolhidos seguem no formulário com os valores atuais.
   */
  async function tokenSettingsModal(token, { advanced = false } = {}) {
    const o = token.overrides || {};
    const creature = !token.characterId;
    // Modelos só são carregados quando há ficha para vincular.
    // Criaturas sempre carregam os modelos: vincular, trocar ou remover a ficha (ADR-100).
    const templates = creature ? (await api(`/campaigns/${campaignId}/npc-templates`)).items : [];
    // Predefinições (ADR-100): escolher preenche o número abaixo; vazio usa a ficha ou o padrão da mesa.
    const presetSelect = (key, label, list, value) => {
      const current = tokenPresetOf(list, key, value);
      return `<div class="field"><label for="f-${key}-preset">${label}</label><select id="f-${key}-preset" data-token-preset="${key}"><option value="${DEFAULT}" ${current === DEFAULT ? "selected" : ""}>${token.characterId ? "Usar o valor da ficha" : "Usar o padrão da mesa"}</option>${list.map((p) => `<option value="${p.id}" ${p.id === current ? "selected" : ""}>${esc(presetText(p))}</option>`).join("")}<option value="${CUSTOM}" ${current === CUSTOM ? "selected" : ""}>Personalizado</option></select></div>`;
    };
    const num = (name, label, value, min, max, help) => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="number" min="${min}" max="${max}" step="1" value="${value ?? ""}" placeholder="${creature && name !== "light" ? "—" : "Valor da ficha/mesa"}" aria-describedby="f-${name}-help"><small class="form-help" id="f-${name}-help">${help}</small></div>`;
    const sideOption = (value, label) => `<option value="${value}" ${token.side === value ? "selected" : ""}>${label}</option>`;
    const templateField = (label, help) => `<div class="field"><div class="field-label"><label for="f-template">${label}</label>${helpButton("mesa.npcs.ficha", "Ficha de NPC ou criatura")}</div><select id="f-template" name="templateId" aria-describedby="f-template-help"><option value="">Sem ficha</option>${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.playerDefault ? " — modelo dos jogadores" : ""}</option>`).join("")}</select><small class="form-help" id="f-template-help">${help}</small></div>`;
    const sheetField = !creature ? "" : token.masterCharacterId
      ? `<p class="form-help">Ficha vinculada. Para ver os valores, use “Ficha do elemento”.</p><label class="check"><input type="checkbox" name="unlinkSheet" data-unlink-sheet aria-describedby="f-unlink-help"> Trocar ou remover a ficha</label><small class="form-help" id="f-unlink-help">A ficha atual continua em Preparação › Personagens; só deixa de acompanhar este marcador.</small><div data-replace-sheet hidden>${templateField("Nova ficha (opcional)", "Sem ficha: o marcador fica só com nome e lado.")}</div>`
      : templateField("Vincular ficha (opcional)", "Com ficha, você acompanha vida e atributos pelo botão “Ficha do elemento”. Dá para trocar ou remover depois.");
    const identity = creature
      ? `<fieldset><legend>Identificação${helpButton("mesa.marcadores.editar", "Editar marcador")}</legend><div class="form-grid two"><div class="field"><label for="f-tlabel">Nome</label><input id="f-tlabel" name="label" maxlength="40" required value="${esc(token.label)}"></div><div class="field"><label for="f-tside">Lado</label><select id="f-tside" name="side">${sideOption("enemy", "Inimigo")}${sideOption("neutral", "Neutro")}${sideOption("ally", "Aliado")}</select></div></div>${sheetField}</fieldset>`
      : `<p class="form-help">Nome, lado e ficha deste personagem vêm da ficha do jogador.</p>`;
    const details = `<p class="form-help">Agora: luz ${token.light ?? 0} · visão ${token.vision ?? 0} casas${token.characterId ? ` · percepção ${token.perception ?? 0}` : ""}. Deixe em branco para usar ${token.characterId ? "a ficha" : "o padrão da mesa"}.</p>${presetSelect("light", "Luz carregada", TOKEN_LIGHT_PRESETS, o.light)}${num("light", "Luz (casas)", o.light, 0, 30, "Ilumina para todos; para em paredes.")}${presetSelect("vision", "Visão no escuro", VISION_PRESETS, o.vision)}${num("vision", "Visão própria (casas)", o.vision, 0, 30, "Só o dono enxerga, mesmo no escuro.")}${token.characterId ? `${num("perception", "Percepção", o.perception, -100, 1000, "Usada na detecção automática.")}<div class="field"><label for="f-senses">Sentidos</label><textarea id="f-senses" name="senses" rows="2" maxlength="400" placeholder="sentir magia: 9" aria-describedby="f-senses-help">${esc(o.senses || "")}</textarea><small class="form-help" id="f-senses-help">Um por linha; alcance em metros opcional.</small></div>` : `<label class="check"><input type="checkbox" name="hidden" ${token.hidden ? "checked" : ""}> Oculta</label><fieldset><legend>Detecção automática</legend>${num("dc", "Dificuldade de percepção", token.dc, -100, 1000, "Percepção da ficha igual ou maior revela.")}${num("detectRange", "Distância máxima (casas)", token.detectRange, 0, 30, "Opcional.")}<div class="field"><label for="f-dsense">Sentido que detecta</label><input id="f-dsense" name="detectSense" maxlength="40" value="${esc(token.detectSense || "")}"></div></fieldset>${token.hidden ? playerChecks(token.revealedTo || []) : ""}`}`;
    // Criatura: identificação primeiro; luz, visão e ocultação recolhidas, abertas quando vêm da ferramenta própria.
    const body = creature ? `${identity}<details class="token-advanced" ${advanced ? "open" : ""}><summary>Luz, visão e ocultação</summary>${details}</details>` : `${identity}${details}`;
    modal(
      `✎ ${token.label}`,
      `<form id="token-settings-form">${body}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${creature && token.hidden ? button("Revelar para todos", "t-token-reveal-all", token.id, "subtle") : ""}<button type="submit" class="primary">Salvar</button></div></form>`,
    );
    (creature && !advanced ? $("#f-tlabel") : $("#token-settings-form input, #token-settings-form select"))?.focus();
    $("#token-settings-form").addEventListener("change", (e) => {
      const t = e.target, form = e.currentTarget;
      if (t.dataset.unlinkSheet !== undefined) { form.querySelector("[data-replace-sheet]").hidden = !t.checked; return; }
      const lists = { light: TOKEN_LIGHT_PRESETS, vision: VISION_PRESETS };
      if (t.dataset.tokenPreset) {
        const key = t.dataset.tokenPreset, input = form.querySelector(`#f-${key}`), p = presetById(lists[key], t.value);
        if (t.value === CUSTOM) return input.focus();
        input.value = p ? p[key] : "";
      } else if (t.id === "f-light" || t.id === "f-vision") {
        const key = t.id.slice(2);
        form.querySelector(`#f-${key}-preset`).value = tokenPresetOf(lists[key], key, t.value);
      }
    });
    $("#token-settings-form").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      submitForm(form, async (data) => {
        await api(`${base}/tokens/${token.id}/settings`, "POST", {
          light: optionalInt(data.light), vision: optionalInt(data.vision), perception: optionalInt(data.perception),
          senses: data.senses || null, hidden: data.hidden === "on", dc: optionalInt(data.dc), detectSense: data.detectSense || null, detectRange: optionalInt(data.detectRange),
          ...(creature ? { label: data.label, side: data.side, templateId: (!token.masterCharacterId || data.unlinkSheet === "on") && data.templateId ? data.templateId : null, unlinkSheet: data.unlinkSheet === "on" } : {}),
        });
        if (creature && data.hidden === "on" && token.hidden) await api(`${base}/tokens/${token.id}/reveal`, "POST", { all: false, userIds: checkedPlayers(form) });
        $("#modal").close();
        if (data.templateId && (!token.masterCharacterId || data.unlinkSheet === "on")) toast("Ficha vinculada. Abra “Ficha do elemento” para acompanhar o estado.");
        else if (data.unlinkSheet === "on") toast("Ficha desvinculada. Ela continua em Preparação › Personagens.");
      });
    };
  }

  function viewAsModal() {
    const players = live.participants.filter((p) => !p.isMaster && p.characterId);
    if (!players.length) return toast("Nenhum jogador na sessão para ver como.");
    modal(
      "👁 Ver como um jogador",
      `<form id="view-as-form"><fieldset class="character-choices"><legend>O mapa ficará exatamente como esta pessoa vê${helpButton("mesa.nevoa.visao", "Modos de visão")}</legend>${players.map((p, i) => `<label class="character-choice metal"><input type="radio" name="userId" value="${esc(p.userId)}" ${i === 0 ? "checked" : ""}><span><strong>${esc(p.characterName || p.name)}</strong><small>${esc(p.name)}${p.online ? " · conectado" : " · ausente"}</small></span></label>`).join("")}</fieldset>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">👁 Ver como</button></div></form>`,
    );
    $("#view-as-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        viewAs = data.userId; viewAsState = null; viewAsRevision = -1;
        setMode("none");
        await refreshViewAs();
        renderTools();
        $("#modal").close();
      });
    };
  }

  async function tableSettingsModal() {
    const current = await api(`${base}/table-settings`);
    modal(
      "⚙ Configuração da mesa",
      `<form id="table-settings-form"><p class="form-help">${current.scope === "session" ? "Esta sessão usa um ajuste próprio." : "Esta sessão segue a configuração da campanha."}</p>${settingsFields(current.settings, "tbl")}<fieldset class="scope-choice"><legend>Aplicar a mudança em${helpButton("mesa.config.heranca", "Configuração da mesa")}</legend><label class="check"><input type="radio" name="scope" value="session" required> Somente nesta sessão</label><label class="check"><input type="radio" name="scope" value="campaign" required> Na campanha toda (vale também para as próximas sessões)</label></fieldset>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${current.scope === "session" ? button("Voltar à configuração da campanha", "t-settings-campaign", "", "subtle") : ""}<button type="submit" class="primary">Salvar</button></div></form>`,
    );
    $("#table-settings-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        await api(`${base}/table-settings`, "PUT", { settings: settingsFromForm(data), scope: data.scope });
        $("#modal").close();
        toast(data.scope === "campaign" ? "Configuração salva na campanha." : "Configuração aplicada só nesta sessão.");
      });
    };
  }

  async function sheetModal(characterId) {
    const c = await api(`${base}/characters/${characterId}`);
    const p = live.participants.find((x) => x.characterId === characterId);
    const master = live.me.isMaster;
    modal(
      `Ficha de ${c.name}`,
      `${p ? `<p class="muted small">Jogador: ${esc(p.name)}${p.online ? " · conectado" : " · ausente"}</p>` : ""}${sheetViewHtml(c, { full: true })}${c.canEdit ? `<section class="ts-effects"><h4>Condições com duração${helpButton("mesa.condicoes.duracao", "Condições com duração")}</h4><p class="small" id="ts-effects-text">${(c.effects || []).length ? esc(c.effects.map((e) => `${e.name}${e.rounds ? ` · ${e.rounds}` : ""}`).join(", ")) : "Nenhuma."}</p>${button("Ajustar condições", "t-effects", characterId, "subtle small")}</section>` : ""}<div id="table-model-sheet"></div>${
        master
          ? `<form id="hp-form" class="hp-form"><h4>Ajustar vida</h4><div class="hp-row"><div class="field"><label for="f-amount">Pontos</label><input id="f-amount" name="amount" type="number" min="1" max="100000" value="5" required></div><div class="field"><label for="f-reason">Motivo</label><input id="f-reason" name="reason" maxlength="120" placeholder="Ataque de criatura"></div></div>${formError()}${actionBar(`<button type="submit" class="danger" name="kind" value="damage">− Dano</button><button type="submit" class="subtle" name="kind" value="heal">+ Cura</button>`, button("✎ Editar ficha", "t-edit-sheet", characterId, "subtle") + button("⌛ Conceder turno", "t-give-turn", characterId, "primary", p?.online && !live.session.endedAt ? "" : "disabled"))}</form>`
          : `<div class="form-actions">${c.canEdit ? button("✎ Editar ficha", "t-edit-sheet", characterId, "primary") : ""}</div>`
      }`,
    );
    if (c.sheet) {
      // Resumo com testes e itens que se usam + ficha completa com o botão de rolar (ADR-099). Editar continua na página da ficha.
      const { mountTableSheet } = await tableSheet();
      const canAct = master || (live.me.characterId === characterId && c.canEdit);
      const release = mountTableSheet($("#table-model-sheet"), { c, base, master, canAct });
      $("#modal").addEventListener("close", () => release(), { once: true });
    }
    paintBars($("#modal-body"));
    guardAvatars($("#modal-body"));
    const form = $("#hp-form");
    if (form)
      form.onsubmit = (e) => {
        e.preventDefault();
        const kind = e.submitter?.value || "damage";
        submitForm(form, async (data) => {
          const amount = Math.abs(Number(data.amount));
          await api(`${base}/characters/${characterId}/hp`, "POST", {
            delta: kind === "heal" ? amount : -amount,
            reason: data.reason,
          });
          $("#modal").close();
          toast(
            kind === "heal"
              ? "Vida recuperada registrada."
              : "Dano registrado na ficha.",
          );
        });
      };
  }

  function choosePlayerModal(
    title,
    action,
    submitLabel,
    allowNarration = false,
  ) {
    const players = onlinePlayers(live);
    modal(
      title,
      `<form id="player-form"><fieldset class="character-choices"><legend class="sr-only">Aventureiros conectados</legend>${players.map((p, i) => `<label class="character-choice metal"><input type="radio" name="characterId" value="${esc(p.characterId)}" ${p.characterId === live.session.activeCharacterId || (!live.session.activeCharacterId && i === 0) ? "checked" : ""}><img class="avatar" src="${esc(p.avatarUrl)}" alt=""><span><strong>${esc(p.characterName)}</strong><small>${esc(p.name)} · Nv. ${p.level} · Vida ${p.hp}/${p.maxHp}</small></span></label>`).join("")}${allowNarration ? `<label class="character-choice metal"><input type="radio" name="characterId" value=""><span class="turn-crest" aria-hidden="true">♛</span><span><strong>Narrativa do mestre</strong><small>Nenhum jogador age até o próximo turno.</small></span></label>` : ""}</fieldset>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">${submitLabel}</button></div></form>`,
    );
    guardAvatars($("#modal-body"));
    $("#player-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        await action(data.characterId || null);
      });
    };
  }

  /** Ações da ficha agrupadas pelos nomes do sistema. A ficha clássica mantém Ataque básico e Defender por compatibilidade. */
  function actionModal(preselect) {
    const c = live.me.character;
    const cmds = playerCommands(live);
    const actions = [...(c.actions || [])];
    if (cmds.classic) actions.push({ id: "", kind: "ataque", name: "Ataque básico", formula: `1d20${(Math.floor((c.strength - 10) / 2) >= 0 ? "+" : "") + Math.floor((c.strength - 10) / 2)}`, description: "Ficha clássica: usa o modificador de Força.", group: "Ataques" }, { id: "__defend", kind: "defender", name: "Defender", formula: "", description: "Ficha clássica: +2 de Armadura até o próximo turno.", group: "Ataques" });
    const groups = new Map();
    for (const a of actions) { const g = a.group || { ataque: "Ataques", habilidade: "Habilidades", magia: "Magias", item: "Itens" }[a.kind] || "Ações"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a); }
    const targets = [...new Set([...live.tokens.filter((t) => t.characterId !== c.id).map((t) => t.label), ...onlinePlayers(live).filter((p) => !p.isMe).map((p) => p.characterName)])];
    const first = preselect ?? actions[0]?.id;
    modal(
      "✧ Ações",
      `<form id="action-form">${[...groups.entries()].map(([name, list]) => `<fieldset class="action-choices"><legend>${esc(name)}</legend>${list.map((a) => `<label class="action-choice metal"><input type="radio" name="actionId" value="${esc(a.id)}" data-kind="${esc(a.kind)}" ${a.id === first ? "checked" : ""}><span><strong>${esc(a.name)}</strong>${a.formula ? ` <code>${esc(a.formula)}</code>` : ""}<small>${esc(a.description || "")}</small></span></label>`).join("")}</fieldset>`).join("")}<div class="field"><label for="f-target">Alvo (opcional)</label><input id="f-target" name="target" maxlength="60" list="target-list" placeholder="Quem ou o quê?"><datalist id="target-list">${targets.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Usar ação</button></div></form>`,
    );
    $("#action-form").onsubmit = (e) => {
      e.preventDefault();
      const chosen = e.currentTarget.querySelector("input[name=actionId]:checked");
      submitForm(e.currentTarget, async (data) => {
        if (!chosen) throw new Error("Escolha uma ação.");
        const kind = chosen.dataset.kind;
        const result = await api(`${base}/actions`, "POST", kind === "defender" ? { kind } : { kind, actionId: data.actionId || null, target: data.target });
        $("#modal").close();
        toast(result.message);
      });
    };
  }

  async function useAction(id) {
    const a = (live.me.character?.actions || []).find((x) => x.id === id);
    if (!a) return actionModal();
    // Favorita: um clique usa a ação; para escolher alvo, o jogador abre “Ações”.
    const result = await quick(`${base}/actions`, "POST", { kind: a.kind, actionId: a.id, target: "" });
    toast(result.message);
  }

  function favoritesModal() {
    const c = live.me.character;
    const chosen = new Set(c.shortcuts?.actions || []);
    modal(
      "☆ Ações favoritas",
      `<form id="fav-form"><p class="form-help">Escolha até 8 ações para aparecer primeiro. Isso não muda regras nem a ficha.</p>${(c.actions || []).map((a) => `<label class="check"><input type="checkbox" name="fav" value="${esc(a.id)}" ${chosen.has(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("")}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar</button></div></form>`,
    );
    $("#fav-form").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      submitForm(form, async () => {
        const actions = [...form.querySelectorAll("input[name=fav]:checked")].map((i) => i.value);
        if (actions.length > 8) throw new Error("Escolha até 8 ações favoritas.");
        await api(`/characters/${c.id}/shortcuts`, "PUT", { actions, rolls: c.shortcuts?.rolls || [] });
        c.shortcuts = { ...(c.shortcuts || {}), actions };
        $("#modal").close();
        sheetSignature = "";
        renderPanel();
        renderTurnBar();
      });
    };
  }

  function noteModal() {
    modal(
      "✎ Registrar nota",
      `<form id="note-modal-form"><div class="field"><label for="f-note">Anotação da sessão</label><textarea id="f-note" name="content" maxlength="2000" rows="5" required></textarea></div><label class="check"><input type="checkbox" name="shared"> Compartilhar com os jogadores como narração</label><p class="form-help">Sem compartilhar, a nota fica visível apenas para você no histórico da sessão.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Registrar</button></div></form>`,
    );
    $("#note-modal-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        await api(`${base}/notes`, "POST", {
          content: data.content,
          shared: data.shared === "on",
        });
        $("#modal").close();
        toast("Anotação registrada na sessão.");
      });
    };
  }

  function endModal() {
    modal(
      "Encerrar a sessão?",
        `<p>${live.campaign.isOneShot ? "Encerrar apaga a one-shot e seus dados. As fichas pessoais e a participação consumida são preservadas. Para continuar depois, use “Sair da tela” ou converta em campanha na página One-shot." : "A campanha ficará offline e os jogadores verão o encerramento. O histórico, as notas e as alterações das fichas continuam disponíveis para consulta. Para uma pausa curta, use “Pausar”."}</p><form id="end-form">${formError()}<div class="form-actions">${button("Continuar jogando", "modal-close", "", "subtle")}<button type="submit" class="danger">■ Encerrar sessão</button></div></form>`,
    );
    $("#end-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async () => {
        await api(`${base}/end`, "POST");
        $("#modal").close();
        if (live.campaign.isOneShot) { stop(); navigate("one-shot"); }
      });
    };
  }

  /** Aba "Trilha" aberta pelo selo do topo; no celular, troca para a vista do painel. */
  function openSoundtrackTab() {
    if (!live) return;
    tab = "soundtrack";
    if (mobileView === "map" && matchMedia(COMPACT_TABLE).matches) mobileView = "chat";
    renderTabs(); renderPanel(); renderViews();
    $("#tab-soundtrack")?.focus();
  }

  /** Aba "Cenas": painel recolhível ao lado do mapa (no celular, a vista do painel). */
  async function openScenesTab(then) {
    const reopened = tab === "scenes";
    tab = "scenes";
    if (mobileView === "map" && matchMedia(COMPACT_TABLE).matches) mobileView = "chat";
    renderTabs(); renderPanel(); renderViews();
    $("#tab-scenes")?.focus();
    if (reopened && scenesPanel?.host) scenesPanel.ctl.reload().catch(() => {});
    if (!then) return;
    const { createScenePanel } = await import("./table-scenes.js");
    scenesPanel ??= { ctl: createScenePanel({ base, campaign: { id: campaignId, name: live.campaign.name }, getLive: () => live }), host: null };
    if (then === "apply") await scenesPanel.ctl.applyModal();
    if (then === "improvise") await scenesPanel.ctl.improviseModal();
  }

  /** Ajustes da interface Completa que continuam valendo na Básica, com acesso direto aos detalhes. */
  function hiddenModal() {
    const list = hiddenCustomizations({ fog: live.fog, scene: live.play?.scene, tokens: live.tokens });
    modal("Ajustes avançados ativos", `<p class="form-help">Continuam valendo na interface Básica; só os controles ficam ocultos. A interface não muda regras nem o que os jogadores veem.</p><ul>${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div class="form-actions">${button("Mostrar na interface Completa", "t-go-complete", "", "primary")}</div>`);
  }

  // ---------- Comandos ----------
  async function command(action, id, source) {
    if (action === "t-tab") {
      tab = id;
      renderTabs();
      renderPanel();
      $("#tab-" + id)?.focus();
    }
    if (action === "t-sheet" || action === "t-give-turn") {
      if (action === "t-give-turn") {
        await quick(`${base}/turn`, "POST", { characterId: id });
        $("#modal").close();
      } else await sheetModal(id);
    }
    if (action === "t-my-sheet" && live.me.characterId)
      await sheetModal(live.me.characterId);
    if (action === "t-party-view" && live.me.isMaster) {
      const { partyModal } = await tableSheet();
      await partyModal({ campaignId });
    }
    if (action === "t-effects" && id) {
      const { effectsDialog } = await tableSheet();
      const mine = live.me.character?.id === id ? live.me.character : null;
      const who = live.participants.find((x) => x.characterId === id);
      const effects = mine?.effects ?? who?.summary?.effects ?? [];
      effectsDialog({ base, characterId: id, name: mine?.name || who?.characterName || "personagem", effects, onSaved: (items) => {
        const text = document.querySelector("#ts-effects-text");
        if (text) text.textContent = items.length ? items.map((e) => `${e.name}${e.rounds ? ` · ${e.rounds}` : ""}`).join(", ") : "Nenhuma.";
      } });
    }
    if (action === "t-edit-sheet") {
      openSheetEditor({ id }, async () => {});
    }
    if (action === "t-open-sheet")
      choosePlayerModal(
        "♙ Abrir ficha",
        async (cid) => sheetModal(cid),
        "Abrir ficha",
      );
    if (action === "t-set-turn")
      choosePlayerModal(
        "◉ Definir turno",
        async (cid) => {
          await api(`${base}/turn`, "POST", { characterId: cid });
          $("#modal").close();
        },
        "Conceder turno",
        true,
      );
    if (action === "t-next") await quick(`${base}/turn/next`, "POST");
    if (action === "t-note") noteModal();
    if (action === "t-map") await openScenesTab("improvise");
    if (action === "t-end") endModal();
    if (action === "t-exit") {
      if (!live.me.isMaster) {
        try {
          await quick(`${base}/leave`, "POST");
        } catch {}
        stop();
        navigate(live.campaign.isOneShot ? "one-shot" : "campaigns");
      } else if (live.campaign.isOneShot) {
        try { await quick(`${base}/leave`, "POST"); } catch {}
        stop();
        toast(`Você saiu da tela. A mesa espera por ${live.play?.recoveryMinutes || 10} min; volte pela página One-shot.`);
        navigate("one-shot");
      } else {
        toast("A sessão continua online. Você pode voltar pela campanha.");
        stop();
        navigate("campaign/" + campaignId + "/sessions");
      }
    }
    if (action === "t-act" || action === "t-actions") actionModal();
    if (action === "t-act-id") await useAction(id);
    if (action === "t-favorites") favoritesModal();
    if (action === "t-pause") await quick(`${base}/pause`, "POST", { paused: !live.play?.paused });
    if (action === "t-roll-builder") (await tools()).openRollBuilder({ base, character: live.me.character, live, onDone: (r) => toast(r.hidden ? "Rolagem enviada ao mestre." : `Resultado: ${r.total}`) });
    if (action === "t-request") (await tools()).openRequestModal({ base, live });
    if (action === "t-request-cancel") await quick(`${base}/roll-requests/${id}/cancel`, "POST");
    if (action === "t-respond") {
      const r = await quick(`${base}/roll-requests/${id}/respond`, "POST");
      toast(r.hidden ? "Resultado enviado ao mestre." : `Resultado: ${r.total}${r.outcome ? " — " + r.outcome : ""}`);
    }
    if (action === "t-order") (await tools()).openTurnOrder({ base, live });
    if (action === "t-scenes") await openScenesTab();
    if (action === "t-apply-scene") await openScenesTab("apply");
    if (action === "t-hidden") hiddenModal();
    if (action === "t-go-complete") { setInterfaceMode("complete"); $("#modal").close(); }
    if (action === "t-npcs-at") { const [x, y, fx, fy] = id.split("|").map((v) => (v === "" ? undefined : Number(v))); await (await tools()).openNpcs({ base, live, campaignId, cell: { x, y, fx, fy } }); }
    if (action === "t-undo") { await quick(`${base}/undo`, "POST", { eventId: Number(id) }); toast("Alteração desfeita e registrada no histórico."); }
    if (action === "t-res") {
      const [field, delta] = id.split("|");
      await quick(`${base}/characters/${live.me.characterId}/resource`, "POST", { field, delta: Number(delta) });
    }
    if (action === "t-fog-group") {
      if (mode === "fog" && fogGroup === id) setMode("none");
      else { fogGroup = FOG_GROUPS[id] ? id : "reveal"; fogTool = FOG_GROUPS[fogGroup].tools[0]; setMode("fog"); }
    }
    if (action === "t-view") {
      mobileView = id;
      if (id === "chat") { tab = "chat"; lastSeenChat = lastEventId; }
      if (id === "sheet" && !live.me.isMaster) tab = "sheet";
      renderTabs(); renderPanel(); renderViews();
      $(id === "map" ? "#main" : id === "party" ? ".party" : "#t-panel")?.focus?.();
    }
    if (action === "t-move") setMode(mode === "move" ? "none" : "move");
    if (action === "t-defend")
      toast(
        (await quick(`${base}/actions`, "POST", { kind: "defender" })).message,
      );
    if (action === "t-end-turn") {
      setMode("none");
      await quick(`${base}/turn/end`, "POST");
    }
    if (action === "t-tool-select") setMode("none");
    if (action === "t-tool-place") setMode(mode === "place" ? "none" : "place");
    if (action === "t-tool-grid") {
      grid = !gridShown();
      renderTools();
      board.setView(boardView());
    }
    if (action === "t-rulers") rulers.setEnabled(!rulers.enabled());
    if (action === "t-tool-bubbles") {
      bubbles = !bubbles;
      renderTools();
      board.setView(boardView());
    }
    if (action === "t-quick-roll") await quickRoll(Number(id));
    if (action === "t-quick-hidden") { quickHidden = !quickHidden; renderDice(); }
    if (action === "t-token-bubble") { const sel = boardState().tokens.find((t) => t.id === selected); if (sel) bubbleModal(sel); }
    if (action === "t-map-upload") { const input = $("#t-map-file"); input.value = ""; input.click(); }
    if (action === "t-map-grid") await (await mapImport()).openGridModal({ base, live });
    if (action === "t-focus-board") board.focus();
    if (action === "t-tool-fog") { fogGroup = ui === "complete" ? "walls" : "reveal"; setMode(mode === "fog" ? "none" : "fog"); }
    if (action === "t-fog-tool") { fogTool = id; renderTools(); board.setView(boardView()); }
    if (action === "t-fog-reset" && confirm("Recomeçar a exploração? A névoa revelada, o que os jogadores já viram e as marcas percebidas voltam ao início. Paredes, portas e luzes continuam.")) {
      await quick(`${base}/fog/reset`, "POST");
      toast("Exploração recomeçada.");
    }
    if (action === "t-light-remove") { await quick(`${base}/fog/lights/${encodeURIComponent(id)}`, "DELETE"); $("#modal").close(); }
    if (action === "t-mark-remove") { await quick(`${base}/fog/marks/${encodeURIComponent(id)}`, "DELETE"); $("#modal").close(); }
    if (action === "t-token-sheet") { const sel = live.tokens.find((t) => t.id === selected); if (sel?.masterCharacterId) await (await npcSheets()).openNpcSheet({ campaignId, npcId: sel.masterCharacterId }); }
    if (action === "t-token-settings" || action === "t-token-edit") { const sel = live.tokens.find((t) => t.id === selected); if (sel) await tokenSettingsModal(sel, { advanced: action === "t-token-settings" }); }
    if (action === "t-token-look") { const sel = live.tokens.find((t) => t.id === selected); if (sel) await (await tools()).openTokenLook({ base, campaignId, token: sel }); }
    if (action === "t-move-grant") await quick(`${base}/move-grant`, "POST", { allowed: id === "1" });
    if (action === "t-token-reveal-all") { await quick(`${base}/tokens/${id}/reveal`, "POST", { all: true, userIds: [] }); $("#modal").close(); }
    if (action === "t-palette") openCommandPalette();
    if (action === "t-gather") {
      if (live.map.kind !== "tileset") return toast("Colocar o grupo exige um mapa com grade.");
      const r = await api(`${base}/party/gather`, "POST");
      toast(r.moved + r.placed ? `Grupo reunido na entrada (${r.moved + r.placed} ${r.moved + r.placed === 1 ? "personagem" : "personagens"}). Cada movimento pode ser desfeito.` : "O grupo já está na entrada.");
    }
    if (action === "t-npc-place") {
      if (live.map.kind !== "tileset") return toast("Colocar personagens exige um mapa com grade.");
      pendingNpc = id; setMode("place");
      $("#t-board")?.focus?.();
    }
    if (action === "t-view-as") {
      if (viewAs) { viewAs = null; viewAsState = null; renderTools(); board.update(boardState(), boardView()); }
      else viewAsModal();
    }
    if (action === "t-table-settings") await tableSettingsModal();
    // Câmera compartilhada e exibição externa (ADR-115); convidados (ADR-114).
    if (action === "t-show-region" && live.me.isMaster) {
      const region = board.camera.visibleCells();
      if (!region) return toast("Mostrar a região exige um mapa com grade.");
      await quick(`${base}/camera`, "POST", region);
      toast("Região enviada: quem segue o mestre e a exibição externa passam a vê-la.");
    }
    if (action === "t-external-display" && live.me.isMaster) {
      window.open(`/#/mesa/${encodeURIComponent(sessionId)}/exibicao`, "_blank", "noopener");
      toast("Exibição externa aberta em outra aba. Leve-a para a TV ou o projetor.");
    }
    if (action === "t-guests" && live.me.isMaster) (await guestsAdmin()).openGuestsModal({ campaignId });
    if (action === "t-follow" && follow) { follow.toggle(); toast(follow.following ? "Seguindo o mestre: sua câmera acompanha a região que ele mostrar." : "Câmera livre: você controla a sua visão."); }
    if (action === "t-follow-resume" && follow) follow.resume();
    if (action === "t-camera-fit") { if (follow) follow.fit(); else board.camera.fit(); }
    if (action === "t-settings-campaign") {
      await api(`${base}/table-settings`, "PUT", { settings: null, scope: "session" });
      $("#modal").close();
      toast("A sessão voltou à configuração da campanha.");
    }
    if (action === "t-tool-remove" && selected) {
      await quick(`${base}/tokens/${selected}`, "DELETE");
      selected = null;
    }
    source?.blur?.();
  }

  const shell = $(".table-shell");
  const onClick = async (e) => {
    const b = e.target.closest("[data-action^='t-']");
    if (!b || b.disabled || !live) return;
    try {
      await command(b.dataset.action, b.dataset.id, null);
    } catch (error) {
      toast(error.message);
    }
  };
  shell.addEventListener("click", onClick);
  // Modais vivem fora da mesa; seus comandos também passam pelo mesmo despacho.
  const onModalClick = (e) => {
    const b = e.target.closest("#modal [data-action^='t-']");
    if (b && !b.disabled)
      command(b.dataset.action, b.dataset.id).catch((error) =>
        toast(error.message),
      );
  };
  document.addEventListener("click", onModalClick);
  $("#t-tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const tabs = [...$("#t-tabs").querySelectorAll("[role=tab]")];
    const i = tabs.findIndex((t) => t.dataset.id === tab);
    const next =
      tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    e.preventDefault();
    Promise.resolve(command("t-tab", next.dataset.id)).then(() => $(`#tab-${next.dataset.id}`)?.focus()).catch(() => {});
  });
  shell.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!["t-chat", "t-roll", "t-note", "t-conditions"].includes(form.id)) return;
    e.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (form.id === "t-chat") {
        const text = data.content.trim();
        const rollCommand = text.match(/^\/r(?:oll)?\s+(\S+)\s*(.*)$/i);
        if (rollCommand)
          await quick(`${base}/rolls`, "POST", {
            formula: rollCommand[1],
            label: rollCommand[2],
          });
        else await quick(`${base}/messages`, "POST", { content: text });
        form.reset();
        $("#t-message").focus();
      }
      if (form.id === "t-conditions") {
        await quick(`${base}/characters/${live.me.characterId}/conditions`, "POST", { conditions: data.conditions });
        toast("Condições atualizadas.");
      }
      if (form.id === "t-note") {
        await quick(`${base}/notes`, "POST", {
          content: data.content,
          shared: data.shared === "on",
        });
        form.reset();
        toast("Anotação registrada.");
      }
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
  });
  // ---------- Menu de contexto e atalhos (mesmo padrão do editor de cena, com as ações da mesa) ----------
  // O menu só reúne ações que já existem no trilho e na Busca de ações; o servidor revalida cada uma.
  const run = (action, arg = "") => () => command(action, arg, null);
  function selectToken(id) {
    if (selected === id) return;
    selected = id;
    renderTools();
    board.setView(boardView());
  }
  function tokenMenuItems(token) {
    const ended = live.session.endedAt ? "A sessão foi encerrada." : null;
    if (!live.me.isMaster) {
      if (token.characterId === live.me.characterId) return [
        { label: "Mover meu personagem", checked: mode === "move", disabled: !canMoveNow(), disabledReason: awaitingMoveGrant() ? "Aguarde o mestre liberar o seu movimento." : "Aguarde sua vez para mover.", run: run("t-move") },
        { label: "Minha ficha", run: run("t-my-sheet") },
      ];
      if (token.image && !token.characterId) return [{ label: "Ver imagem", run: async () => (await npcSheets()).showImage(token.image, token.label) }];
      return [];
    }
    selectToken(token.id);
    const bubble = tokenBubbles(live).get(token.id);
    const PC = "Personagens dos jogadores ficam no mapa; remova só criaturas e elementos do mestre.";
    return [
      token.masterCharacterId ? { label: "Ficha do elemento", run: run("t-token-sheet") } : null,
      !token.characterId ? { label: "Editar marcador…", shortcut: "enter", disabled: !!ended, disabledReason: ended, run: run("t-token-edit") } : null,
      { label: "Forma e tamanho…", disabled: !!ended, disabledReason: ended, run: run("t-token-look") },
      bubble?.target ? { label: `${bubble.resource.label}…`, disabled: !!ended, disabledReason: ended, run: run("t-token-bubble") } : null,
      ui === "complete" ? { label: "Luz, visão e ocultação…", disabled: !!ended, disabledReason: ended, run: run("t-token-settings") } : null,
      ...guestControlItems(token, ended),
      { separator: true },
      { label: "Remover marcador", shortcut: "delete", danger: true, disabled: !!(ended || token.characterId), disabledReason: ended || PC, run: run("t-tool-remove") },
      { separator: true },
      { label: "Desmarcar", shortcut: "escape", run: () => { selected = null; renderTools(); board.setView(boardView()); } },
    ];
  }
  /** Convidados participantes (ADR-114): o mestre entrega ou retira o controle de um marcador sem ficha de jogador. */
  function guestControlItems(token, ended) {
    if (!controllableToken(token) || !Array.isArray(live.guests)) return [];
    const seats = participantSeats(live.guests), holder = seatControlling(live.guests, token.id);
    if (!seats.length && !holder) return [];
    const give = async (seatId) => {
      try {
        await quick(`${base}/guest-control`, "POST", { tokenId: token.id, seatId });
        toast(seatId ? "Controle entregue ao convidado." : "Controle do convidado retirado.");
      } catch (error) { toast(error.message); }
    };
    return [
      seats.length ? { label: "Dar controle a convidado", disabled: !!ended, disabledReason: ended, items: seats.map((s) => ({ label: `${s.name}${s.online ? "" : " (ausente)"}`, checked: s.tokenId === token.id, run: () => give(s.seatId) })) } : null,
      holder ? { label: `Retirar controle de ${holder.name}`, disabled: !!ended, disabledReason: ended, run: () => give(null) } : null,
    ];
  }
  function cellMenuItems(cell) {
    const ended = live.session.endedAt ? "A sessão foi encerrada." : null;
    const tiles = live.map.kind === "tileset";
    const items = [];
    if (!live.me.isMaster) {
      if (cell && canMoveNow() && canMoveTo(cell)) items.push({ label: "Mover para cá", run: () => onCell(cell) });
      items.push({ label: "Montar rolagem…", run: run("t-roll-builder") });
    } else {
      const sel = live.tokens.find((t) => t.id === selected);
      if (cell && sel && tiles) items.push({ label: `Mover ${sel.label} para cá`, disabled: !!ended, disabledReason: ended, run: () => onCell(cell) });
      if (cell && tiles) items.push({ label: "Adicionar personagem aqui…", disabled: !!ended, disabledReason: ended, run: () => addTokenModal(cell) });
      items.push({ label: "Colocar o grupo na entrada", disabled: !!(ended || !tiles), disabledReason: ended || "Exige um mapa com grade.", run: run("t-gather") });
      if (live.fog?.active) items.push({ label: "Revelar área", disabled: !!ended, disabledReason: ended, run: run("t-fog-group", "reveal") });
      items.push({ label: "Mostrar esta região aos participantes", disabled: !!(ended || !tiles), disabledReason: ended || "Exige um mapa com grade.", run: run("t-show-region") });
      items.push({ separator: true }, { label: "Montar rolagem…", run: run("t-roll-builder") });
    }
    const undo = lastUndoable();
    items.push(
      { label: "Desfazer a última alteração", shortcut: "mod+z", disabled: !undo || !!ended, disabledReason: ended || "Nada para desfazer agora.", run: run("t-undo", undo ? String(undo.id) : "") },
      { label: "Mostrar grade", checked: gridShown(), disabled: !tiles, disabledReason: "Exige um mapa com grade.", run: run("t-tool-grid") },
      { label: "Mostrar réguas", checked: rulers.enabled(), disabled: !tiles, disabledReason: "Exige um mapa com grade.", run: run("t-rulers") },
      { label: "Busca de ações…", shortcut: "mod+k", run: run("t-palette") },
    );
    return items;
  }
  async function openTableMenu({ cell, token, x, y }) {
    if (!live || $("#modal").open) return;
    const found = token ? live.tokens.find((t) => t.id === token.id) || token : null;
    const items = found ? tokenMenuItems(found) : [];
    const { openContextMenu } = await import("./editor-core.js");
    if (items.length) return openContextMenu({ x, y }, items, { label: found.label || "Marcador" });
    openContextMenu({ x, y }, cellMenuItems(cell), { label: "Mapa" });
  }
  const typing = (el) => !!el && (el.matches?.("input, textarea, select, [contenteditable], [contenteditable] *") || el.isContentEditable);
  const onKey = (e) => {
    // Campos, diálogos (Busca de ações, ajuda) e menus abertos tratam as próprias teclas.
    if ($("#modal").open || document.querySelector(".ed-menu, #help-popup:popover-open") || typing(e.target) || e.target.closest?.("dialog, [role=dialog]")) {
      if (e.key === "Escape" && mode !== "none" && !$("#modal").open) setMode("none");
      return;
    }
    if (e.key === "Escape") {
      if (mode !== "none") setMode("none");
      else if (selected && live?.me.isMaster) { selected = null; renderTools(); board.setView(boardView()); }
      return;
    }
    if (!live || live.session.endedAt) return;
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl+Z: mesma ação do botão "Desfazer" (só a última alteração elegível, revalidada no servidor).
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      const undo = lastUndoable();
      if (!undo) return;
      e.preventDefault();
      command("t-undo", String(undo.id), null).catch((error) => toast(error.message));
      return;
    }
    if (!live.me.isMaster || !selected || mod || e.altKey) return;
    const sel = live.tokens.find((t) => t.id === selected);
    if (!sel) return;
    // Delete/Backspace removem o marcador selecionado; Enter abre a edição (fora de botões e do mapa, que já usam Enter).
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (sel.characterId) return toast("Personagens dos jogadores ficam no mapa; remova só criaturas e elementos do mestre.");
      command("t-tool-remove", "", null).catch((error) => toast(error.message));
    } else if (e.key === "Enter" && !sel.characterId && !e.target.closest?.("button, a[href], canvas, summary, [role=tab]")) {
      e.preventDefault();
      command("t-token-edit", "", null).catch((error) => toast(error.message));
    }
  };
  document.addEventListener("keydown", onKey);

  poll();
  // Busca de ações (ADR-100): mesmo despacho dos botões; o servidor revalida tudo.
  const disposePalette = mountCommandPalette($(".table-shell"), {
    getContext: () => ({ role: live?.me.isMaster ? "master" : "player", mode: ui }),
    getCommands: () => !live ? [] : tableCommands({
      isMaster: live.me.isMaster, tiles: live.map.kind === "tileset", fogOn: !!live.fog?.active, complete: ui === "complete",
      selected: live.tokens.find((t) => t.id === selected) || null, undoId: lastUndoable()?.id ?? null,
      ended: !!live.session.endedAt, paused: !!live.play?.paused, following: !!follow?.following,
    }),
    onRun: async (c) => {
      if (c.needsComplete) setInterfaceMode("complete");
      await command(c.action, c.arg, null);
    },
  });
  return () => {
    disposePalette();
    stop();
    document.removeEventListener("click", onModalClick);
    document.removeEventListener("keydown", onKey);
    app.liveTable = null;
  };
}
