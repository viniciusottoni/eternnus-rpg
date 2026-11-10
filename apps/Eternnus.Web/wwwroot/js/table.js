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
  modal,
  formError,
  submitForm,
  toast,
  navigate,
} from "./ui.js";
import { createBoard } from "./table-map.js";
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
import { playerCommands, requiresTurn, modeLabel, resourceState, waitingText, canUndo, unreadCount, MOBILE_VIEWS } from "./play-policy.js";
import { interfaceMode, interfaceToggle, mountInterfaceToggle, onInterfaceChange, setInterfaceMode } from "./interface-mode.js";
import { HELP, hiddenCustomizations, pendingParts } from "./scene-policy.js";
const tools = () => import("./table-tools.js");
const npcSheets = () => import("./npc-sheet.js");
/** Ferramentas de névoa por grupo (interface Completa) e o atalho "Revelar área" da Básica. */
const FOG_GROUPS = {
  reveal: { label: "Revelar área", tools: ["reveal", "conceal"] },
  walls: { label: "Paredes e portas", tools: ["wall", "blockMove", "blockLight", "door", "toggleDoor", "erase"] },
  light: { label: "Luz e visão", tools: ["light"] },
  explore: { label: "Exploração", tools: ["reveal", "conceal", "mark"] },
};

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
    `<main id="main" class="table-offline metal" tabindex="-1"><span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>ONLINE</span><h1>${esc(entry.campaign.name)}</h1><p>${esc(sessionLabel(entry.session.number, entry.session.title))}</p>${
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
    grid = true,
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
    lastSeenChat = 0;
  const previousHp = new Map();
  let previousActive;
  const controller = new AbortController();

  $("#app").className = "table-app";
  $("#app").innerHTML = `<div class="table-shell">
    <header class="table-top"><a class="table-brand" href="#campaign/${esc(campaignId)}" aria-label="Voltar à campanha"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"></a><div class="table-title"><h1><span id="t-campaign">Mesa</span> <span class="online-badge" data-tip="A sessão está ativa; presenças aparecem no grupo." id="t-online"><i aria-hidden="true"></i>ONLINE</span></h1><p id="t-sub">Conectando à sessão…</p></div><div class="table-top-scroll" role="group" aria-label="Comandos da sessão — deslize para ver mais"><button type="button" id="t-fullscreen" class="subtle" hidden>Tela cheia</button><div class="table-top-actions" id="t-top"></div><div class="session-audio-host" id="t-audio" hidden></div><div class="music-dock"></div></div></header>
    <aside class="party" aria-labelledby="party-title" tabindex="-1"><h2 id="party-title"><span aria-hidden="true">⚔</span> Aventureiros <span class="count-chip" id="t-count">0 online</span></h2><ul id="t-party" class="party-list"></ul><p class="party-caption">Avatares conectados e estado atual${helpButton("mesa.mapa.legenda", "Marcadores, vida e presença")}</p></aside>
    <main class="stage" id="main" tabindex="-1" aria-label="Mapa da sessão"><div class="stage-chip" id="t-chip"></div><div class="stage-tools" id="t-tools" role="toolbar" aria-label="Ferramentas do mapa" aria-orientation="vertical"></div><div class="fog-palette" id="t-fog" role="toolbar" aria-label="Névoa e luz" hidden></div><div class="play-banner" id="t-banner" role="status" hidden></div><div class="pending-banner" id="t-pending" role="status" hidden></div><div class="board" id="t-board"></div><div class="turn-herald" id="t-herald" aria-hidden="true"><span></span></div><p class="stage-hint" id="t-hint" role="status"></p></main>
    <section class="side-panel" aria-label="Registros da mesa"><div class="panel-tabs" role="tablist" id="t-tabs"></div><div class="panel-body" id="t-panel" role="tabpanel" tabindex="0"></div><form id="t-chat" class="chat-form" autocomplete="off"><div class="field-label"><label class="sr-only" for="t-message">Mensagem para a mesa</label>${helpButton("mesa.chat.comandos", "Conversa e dados")}</div><input id="t-message" name="content" maxlength="2000" placeholder="Escrever mensagem… (/r 1d20+3 para rolar)" required><button type="submit" class="primary icon-send" aria-label="Enviar">➤</button></form></section>
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
    onCancel: () => setMode("none"),
  });
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
    if (!document.hidden) heartbeat();
  };
  document.addEventListener("visibilitychange", onVisible);

  function stop() {
    stopped = true;
    controller.abort();
    clearInterval(beat);
    document.removeEventListener("visibilitychange", onVisible);
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
    guardAvatars($("#t-turn"));
    if (mode === "move" && !canMoveNow()) mode = "none";
    if (selected && !live.tokens.some((t) => t.id === selected))
      selected = null;
    if (viewAs && !live.participants.some((p) => p.userId === viewAs && p.characterId)) { viewAs = null; viewAsState = null; }
    board.update(boardState(), boardView());
    if (viewAs) refreshViewAs();
    herald(first);
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
    // Interface Básica/Completa só para o mestre; encerrar fica separado das ações frequentes.
    const top = live.me.isMaster
      ? `${interfaceToggle("t-interface")}${button(play.paused ? "▶ Retomar partida" : "⏸ Pausar", "t-pause", "", "subtle")}<span class="top-separator" aria-hidden="true"></span>${button("↩ Sair da tela", "t-exit", "", "subtle")}${button(live.campaign.isOneShot ? "■ Encerrar e apagar" : "■ Encerrar sessão", "t-end", "", "danger")}`
      : `${button("▣ Minha ficha", "t-my-sheet", "", "subtle")}${button("Sair da mesa", "t-exit", "", "subtle")}`;
    // Só redesenha quando muda: preserva o foco no controle de interface entre atualizações ao vivo.
    if (top !== topHtml) { topHtml = top; $("#t-top").innerHTML = `<a class="button subtle" href="#campaign/${esc(campaignId)}/notes" target="_blank" rel="noopener">Meu caderno</a>` + top; }
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
          const detail = !p.canView ? "<small>Ficha privada</small>" : `${res ? `<small>${esc(res.label)}: ${esc(resourceState(res).text)}</small>${res.max ? hpBar(res.value, res.max, `${res.label} de ${p.characterName}`) : ""}` : ""}${p.summary?.conditions ? `<small class="conditions">${esc(p.summary.conditions)}</small>` : ""}`;
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
    const tool = (icon, action, label, active = false, disabled = false) =>
      `<button type="button" class="tool ${active ? "active" : ""}" data-action="${action}" aria-label="${label}" data-tip="${disabled ? "Aguarde sua vez e use um mapa com grade para mover o personagem." : label}" ${active ? 'aria-pressed="true"' : 'aria-pressed="false"'} ${disabled ? 'aria-disabled="true"' : ""}>${icon}</button>`;
    const sel = live.tokens.find((t) => t.id === selected);
    // Mestre: rótulos visíveis. A Básica vem primeiro, sempre na mesma posição; a Completa acrescenta grupos depois dela.
    const labeled = (icon, action, label, active = false, disabled = false, id = "") =>
      `<button type="button" class="tool labeled ${active ? "active" : ""}" data-action="${action}" data-id="${esc(id)}" aria-pressed="${active}" ${disabled ? `aria-disabled="true" data-tip="${action === 't-token-settings' ? 'Selecione um marcador para ajustar luz e visão.' : 'Esta ferramenta exige um mapa com grade.'}"` : ""}><span aria-hidden="true">${icon}</span><span class="tool-label">${esc(label)}</span></button>`;
    const fogOn = !!live.fog?.active;
    const complete = ui === "complete";
    const basicTools = `${labeled("➤", "t-tool-select", "Selecionar e mover", mode === "none" && tiles && !watched, !tiles)}${labeled("⚑", "t-tool-place", "Adicionar personagem", mode === "place", !tiles)}${fogOn ? labeled("☀", "t-fog-group", "Revelar área", mode === "fog" && fogGroup === "reveal", !tiles, "reveal") : ""}${labeled("👁", "t-view-as", watched ? "Voltar à visão do mestre" : "Ver como jogador", !!watched, !tiles)}${sel?.masterCharacterId ? labeled("▣", "t-token-sheet", "Ficha do elemento", false, false) : ""}${sel && !sel.characterId ? labeled("✕", "t-tool-remove", "Remover marcador", false, false) : ""}`;
    const completeTools = complete
      ? `<div class="tool-group" role="group" aria-label="Elementos"><span class="tool-group-title">Elementos</span>${labeled("✎", "t-token-settings", "Luz, visão e ocultação", false, !sel)}</div><div class="tool-group" role="group" aria-label="Paredes, luz e exploração">${labeled("▇", "t-fog-group", "Paredes e portas", mode === "fog" && fogGroup === "walls", !tiles, "walls")}${labeled("✹", "t-fog-group", "Luz e visão", mode === "fog" && fogGroup === "light", !tiles, "light")}${labeled("⚠", "t-fog-group", "Exploração", mode === "fog" && fogGroup === "explore", !tiles, "explore")}</div><div class="tool-group" role="group" aria-label="Grade e configuração">${labeled("▦", "t-tool-grid", "Mostrar grade", grid, !tiles)}${labeled("⚙", "t-table-settings", "Configuração da mesa")}</div>`
      : "";
    const hidden = live.me.isMaster && !complete ? hiddenCustomizations({ fog: live.fog, scene: live.play?.scene, tokens: live.tokens }) : [];
    $("#t-tools").innerHTML = live.me.isMaster
      ? `${basicTools}${completeTools}${hidden.length ? `<button type="button" class="hidden-chip" data-action="t-hidden">Ajustes avançados ativos (${hidden.length}) · ver</button>` : ""}`
      : `${tool("➤", "t-move", "Mover meu personagem", mode === "move", !canMoveNow())}${tool("▦", "t-tool-grid", "Mostrar ou ocultar a grade", grid, !tiles)}${tool("⌖", "t-focus-board", "Usar o mapa pelo teclado", false, !tiles)}`;
    $("#t-tools").classList.toggle("labeled-tools", live.me.isMaster);
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
          ? "Clique em uma casa livre para posicionar uma criatura."
          : mode === "fog"
            ? pick ? `${pick.label}: clique em uma casa. Esc sai da névoa.` : `${FOG_TOOLS.find((t) => t.id === fogTool)?.label}: clique ou arraste sobre as casas. Esc sai da névoa.`
            : sel && live.me.isMaster
              ? `${sel.label} selecionado: clique no destino.`
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
    const item = (id) => { const t = all.find((x) => x.id === id); return `<button type="button" class="tool labeled ${fogTool === id ? "active" : ""}" data-action="t-fog-tool" data-id="${id}" aria-pressed="${fogTool === id}"><span aria-hidden="true">${t.icon}</span><span class="tool-label">${esc(t.label)}</span></button>`; };
    const state = fog.inherited ? "inherit" : fog.active ? "on" : "off";
    const fogState = fogGroup === "light" ? `<label class="fog-select"><span>Névoa neste mapa</span><select id="t-fog-state" data-fog-state><option value="inherit" ${state === "inherit" ? "selected" : ""}>Padrão da mesa</option><option value="on" ${state === "on" ? "selected" : ""}>Ligada aqui</option><option value="off" ${state === "off" ? "selected" : ""}>Desligada aqui</option></select></label>` : "";
    const reset = fogGroup === "explore" ? `<button type="button" class="text-button small" data-action="t-fog-reset">Recomeçar exploração…</button>` : "";
    const help = fogGroup === "reveal" || fogGroup === "explore" ? `<p class="fog-help">${esc(HELP.conceal)}</p>` : fogGroup === "walls" ? `<p class="fog-help">${esc(HELP.wall)}</p>` : `<p class="fog-help">${esc(HELP.light)}</p>`;
    host.innerHTML = `<div class="fog-head"><strong>${esc(group.label)}</strong>${helpButton("mesa.nevoa.ferramentas", "Ferramentas de névoa")}<span class="live-note">Ao vivo: os jogadores veem as mudanças.</span><button type="button" class="text-button small" data-action="t-tool-select">Concluir</button></div><div class="fog-group" role="group" aria-label="${esc(group.label)}">${group.tools.map(item).join("")}${fogState}${reset}</div>${help}`;
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
    if (!viewAs || !viewAsState) return live;
    const p = live.participants.find((x) => x.userId === viewAs);
    return { ...live, map: viewAsState.map, tokens: viewAsState.tokens, fog: viewAsState.fog, me: { ...live.me, isMaster: false, characterId: p?.characterId } };
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
    let reach = [];
    if (c?.movementRole !== false) {
      const squares = movementSquares(c?.movement, scale);
      reach = fogReach(live.fog, w, h, live.tokens, token, squares) ?? reachableCells(rows, live.tokens, token, squares);
    }
    const attack = c?.reach > 0 ? attackCells(w, h, token, Math.floor(c.reach / scale)) : [];
    return { reach, attack, token };
  }
  /** Sem o papel Deslocamento, qualquer casa pode ser tentada: o servidor confere paredes, névoa e o movimento do turno. */
  /** Pode mover agora: modo livre (sem vez) ou na própria vez; na tática, um deslocamento por turno. */
  function canMoveNow() {
    const token = myToken(live);
    if (!token || live.me.isMaster || live.map.kind !== "tileset" || !playerCommands(live).canAct) return false;
    return live.play?.mode !== "tactical" || token.lastMovedTurn !== live.session.turnNumber;
  }
  function canMoveTo(cell) {
    if (live.me.character?.movementRole === false || live.play?.mode !== "tactical") return true;
    return turnReach().reach.some((c) => c.x === cell.x && c.y === cell.y);
  }

  function boardView() {
    const turn = mode === "fog" || mode === "place" ? { reach: [], attack: [], token: null } : turnReach();
    const paintTool = mode === "fog" && FOG_TOOLS.some((t) => t.id === fogTool);
    const draggable = live.me.isMaster
      ? (mode === "none" && !viewAs ? "*" : null)
      : turn.token && canMoveNow() ? turn.token.id : null;
    return { mode: paintTool ? "paint" : mode, reach: turn.reach, attack: turn.attack, draggable, selected, grid, fogTools: mode === "fog", viewAs: !!(viewAs && viewAsState) };
  }

  async function onDrop(token, cell) {
    try {
      if (live.me.isMaster) return await quick(`${base}/tokens/${token.id}/move`, "POST", cell);
      if (token.characterId !== live.me.characterId || !canMoveNow()) return;
      if (!canMoveTo(cell)) return toast("Solte o personagem em uma casa destacada dentro do seu alcance.");
      await quick(`${base}/tokens/${token.id}/move`, "POST", cell);
      setMode("none");
    } catch (error) {
      toast(error.message);
    }
  }
  function setMode(next) {
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
    if (fogTool === "toggleDoor") return quick(`${base}/fog/door`, "POST", cell);
    if (fogTool === "light") return lightModal(cell, (fog.lights || []).find((l) => l.x === cell.x && l.y === cell.y));
    if (fogTool === "mark") return markModal(cell, (fog.marks || []).find((m) => m.x === cell.x && m.y === cell.y));
  }

  function renderTabs() {
    const tabs = live.me.isMaster
      ? [
          ["chat", "Chat"],
          ["rolls", "Rolagens"],
          ["scenes", "Cenas"],
          ["history", "Histórico"],
          ["notes", "Notas"],
          ["soundtrack", "♪ Trilha"],
        ]
      : [
          ["chat", "Chat"],
          ["rolls", "Rolagens"],
          ["sheet", "Sua ficha"],
          ["soundtrack", "♪ Trilha"],
        ];
    if (!tabs.some(([k]) => k === tab)) tab = "chat";
    $("#t-tabs").innerHTML = tabs
      .map(
        ([key, label]) =>
          `<button type="button" role="tab" id="tab-${key}" aria-selected="${key === tab}" class="${key === tab ? "active" : ""}" data-action="t-tab" data-id="${key}">${label}</button>`,
      )
      .join("");
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
    const cls = `feed-item ${e.kind} ${fresh ? "fresh" : ""} ${e.mine ? "mine" : ""}`;
    if (e.kind === "message")
      return `<li class="${cls}"><span class="feed-avatar" aria-hidden="true">${esc(initials(e.author))}</span><div><p class="feed-head"><strong>${esc(data.master ? "Mestre" : e.author)}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(e.content)}</p></div></li>`;
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
    return [...live.events].reverse().find((e) => e.mine && canUndo(e, eventData(e), live.me.isMaster) && !undone.has(e.id));
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
    return `<div class="sheet-summary"><h3>${esc(c.name)}</h3>${resources ? `<ul class="resource-list">${resources}</ul>` : '<p class="muted small">Este modelo não define recursos para acompanhar na mesa.</p>'}${stats ? `<ul class="stat-list">${stats}</ul>` : ""}<form id="t-conditions" class="conditions-form"><label for="t-cond">Condições e nota curta</label><input id="t-cond" name="conditions" maxlength="300" value="${esc(c.conditions || "")}" placeholder="Ex.: envenenado, sem munição"><button type="submit" class="subtle small">Salvar</button></form><div class="summary-actions"><h4>Ações favoritas${helpButton("mesa.acoes.desfazer", "Desfazer uma mudança")}</h4>${cmds.favorites.length ? cmds.favorites.map((a) => button(esc(a.name), "t-act-id", a.id, "subtle small", cmds.canAct ? "" : `aria-disabled="true" data-tip="${esc(cmds.reason)}"`)).join("") : '<p class="muted small">Sua ficha ainda não tem ações.</p>'}${(c.actions || []).length ? button("☆ Escolher favoritas", "t-favorites", "", "text-button small") : ""}</div>${button("Ver ficha completa", "t-my-sheet", "", "primary wide-button")}</div>`;
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
    const text = live.session.endedAt ? "" : play.paused ? "⏸ Partida pausada pelo mestre. A conversa continua aberta." : waiting && !live.me.isMaster ? `⌛ ${waiting}` : "";
    banner.hidden = !text;
    banner.textContent = text;
  }

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
      const turn = turnMode
        ? `${button("◉ Ordem", "t-order", "", "subtle")}${button("⌛ Dar a vez", "t-set-turn", "", "subtle", people ? "" : 'aria-disabled="true" aria-describedby="t-master-why"')}${button("➤ Próxima vez", "t-next", "", "primary", (people || play.turnOrder?.length) && !s.endedAt ? "" : 'aria-disabled="true" aria-describedby="t-master-why"')}`
        : "";
      $("#t-turn").innerHTML =
        `<div class="turn-who">${active ? `<img class="avatar" src="${esc(active.avatarUrl)}" alt="">` : '<span class="turn-crest" aria-hidden="true">♛</span>'}<div><strong>${turnMode ? (activeLabel ? "Vez de " + esc(activeLabel) : "Narrativa do mestre") : "Condução livre"}</strong><small>${esc(modeLabel(play.mode))}${turnMode ? ` · turno ${s.turnNumber || "—"}` : ""}${play.scene ? ` · cena: ${esc(play.scene.name)}` : ""}</small></div></div><div class="turn-actions">${helpButton("mesa.turnos.ordem", "Ordem e vez")}${button("▤ Cenas", "t-scenes", "", "subtle")}${button("✦ Pedir teste", "t-request", "", "subtle", people ? "" : 'aria-disabled="true" aria-describedby="t-master-why"')}${button("⬡ Rolar", "t-roll-builder", "", "subtle")}${button("✎ Nota", "t-note", "", "subtle")}${ui === "complete" ? button("♙ Ficha", "t-open-sheet", "", "subtle", people ? "" : 'aria-disabled="true" aria-describedby="t-master-why"') : ""}${turn}</div>${!people || s.endedAt ? `<p class="turn-why" id="t-master-why">${s.endedAt ? "A sessão foi encerrada." : "Aguarde um jogador conectado com ficha. Para avançar, também é possível preparar a ordem."}</p>` : ""}`;
      return;
    }
    const me = live.participants.find((p) => p.isMe);
    const mine = !!play.myTurn;
    const cmds = playerCommands(live);
    const status = play.paused ? "Partida pausada" : !turnMode ? "Aja quando fizer sentido na cena" : mine ? "Sua vez agora" : activeLabel ? "Vez de " + esc(activeLabel) : "O mestre está narrando";
    const fav = cmds.favorites.slice(0, 3).map((a) => `<button type="button" class="subtle" data-action="t-act-id" data-id="${esc(a.id)}" ${cmds.canAct ? "" : `aria-disabled="true" aria-describedby="t-why"`}>${esc(a.name)}</button>`).join("");
    const undo = lastUndoable();
    $("#t-turn").innerHTML =
      `${requestCardsHtml()}<div class="turn-who"><img class="avatar" src="${esc(me?.avatarUrl || "/assets/avatar.svg")}" alt=""><div><strong>${esc(me?.characterName || "")}</strong><small>${status}</small></div>${turnMode ? `<span class="turn-chip ${mine ? "yours" : "waiting"}" data-tip="${mine ? "Você pode agir nesta vez." : "Aguarde o Mestre conceder a sua vez."}">${mine ? "⌛ Sua vez" : "◷ Aguardando"}</span>` : ""}</div><div class="turn-actions"><button type="button" class="primary" data-action="t-roll-builder" ${cmds.canRoll ? "" : 'aria-disabled="true" aria-describedby="t-why"'}>⬡ Rolar dados</button>${fav}${cmds.hasActions ? `<button type="button" class="subtle" data-action="t-actions" ${cmds.canAct ? "" : 'aria-disabled="true" aria-describedby="t-why"'}>✧ Ações</button>` : ""}${button("▣ Minha ficha", "t-my-sheet", "", "subtle")}${cmds.canMove ? `<button type="button" class="subtle ${mode === "move" ? "active" : ""}" data-action="t-move" ${canMoveNow() ? "" : 'aria-disabled="true" data-tip="Você já moveu nesta vez ou não pode mover neste momento."'}>➤ Mover</button>` : ""}${undo ? button("↶ Desfazer", "t-undo", String(undo.id), "subtle", `data-tip="Desfazer a última mudança elegível"`) : ""}${cmds.showEndTurn ? button("✓ Encerrar a vez", "t-end-turn", "", "primary") : ""}</div>${cmds.reason ? `<p class="turn-why" id="t-why">${esc(cmds.reason)}</p>` : ""}`;
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
      if (live.me.isMaster && mode === "place") return addTokenModal(cell);
      if (live.me.isMaster && selected) {
        await quick(`${base}/tokens/${selected}/move`, "POST", cell);
        return;
      }
      // No turno, clicar numa casa destacada também move (sem precisar ativar "Mover").
      const turnMove = !live.me.isMaster && canMoveNow() && turnReach().reach.some((c) => c.x === cell.x && c.y === cell.y);
      if (mode === "move" || turnMove) {
        const token = myToken(live);
        if (!canMoveTo(cell))
          return toast("Escolha uma casa destacada dentro do seu alcance.");
        await quick(`${base}/tokens/${token.id}/move`, "POST", cell);
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
    const [templates, images] = await Promise.all([api(`/campaigns/${campaignId}/npc-templates`), sheets.imageChoices(campaignId)]);
    modal(
      "Adicionar ao mapa",
      `<form id="token-form"><div class="field"><label for="f-label">Nome</label><input id="f-label" name="label" maxlength="40" required placeholder="Esqueleto guardião"></div><div class="form-grid two"><div class="field"><label for="f-side">Lado</label><select id="f-side" name="side"><option value="enemy">Inimigo</option><option value="neutral">Neutro</option><option value="ally">Aliado</option></select></div><div class="field"><label for="f-light">Luz que carrega (casas, opcional)</label><input id="f-light" name="light" type="number" min="0" max="30" step="1" placeholder="Padrão da mesa"></div></div><div class="field"><div class="field-label"><label for="f-template">Ficha (opcional)</label>${helpButton("mesa.npcs.ficha", "Ficha de NPC ou criatura")}</div><select id="f-template" name="templateId"><option value="">Sem ficha</option>${templates.items.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.playerDefault ? " — modelo dos jogadores" : ""}</option>`).join("")}</select><small class="form-help">Com ficha, você acompanha vida e atributos pelo botão “Ficha do elemento”.</small></div>${sheets.imageFields("f-img", "", images)}<label class="check"><input type="checkbox" name="hidden"> Oculta: só você vê até revelar</label><p class="form-help">Posição: coluna ${cell.x + 1}, linha ${cell.y + 1}.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${button("♞ Personagem do mestre", "t-npcs-at", `${cell.x}|${cell.y}`, "subtle")}<button type="submit" class="primary">⚑ Posicionar</button></div></form>`,
    );
    $("#f-label").focus();
    $("#token-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        const imageUrl = sheets.imageFromForm(data);
        const created = await api(`${base}/tokens`, "POST", { label: data.label, side: data.side, x: cell.x, y: cell.y, hidden: data.hidden === "on", light: data.light === "" ? null : Number(data.light), templateId: data.templateId || null, imageUrl });
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
        await api(`${base}/fog/lights`, "POST", { id: light?.id || null, x: cell.x, y: cell.y, radius: Number(data.radius) });
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

  function tokenSettingsModal(token) {
    const o = token.overrides || {};
    const creature = !token.characterId;
    const num = (name, label, value, min, max, help) => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="number" min="${min}" max="${max}" step="1" value="${value ?? ""}" placeholder="${creature && name !== "light" ? "—" : "Valor da ficha/mesa"}"><small class="form-help">${help}</small></div>`;
    modal(
      `✎ ${token.label}`,
      `<form id="token-settings-form"><p class="form-help">Agora: luz ${token.light ?? 0} · visão ${token.vision ?? 0} casas${token.characterId ? ` · percepção ${token.perception ?? 0}` : ""}. Deixe em branco para usar ${token.characterId ? "a ficha" : "o padrão da mesa"}.</p>${num("light", "Luz (casas)", o.light, 0, 30, "Ilumina para todos; para em paredes.")}${num("vision", "Visão própria (casas)", o.vision, 0, 30, "Só o dono enxerga, mesmo no escuro.")}${token.characterId ? `${num("perception", "Percepção", o.perception, -100, 1000, "Usada na detecção automática.")}<div class="field"><label for="f-senses">Sentidos</label><textarea id="f-senses" name="senses" rows="2" maxlength="400" placeholder="sentir magia: 9">${esc(o.senses || "")}</textarea><small class="form-help">Um por linha; alcance em metros opcional.</small></div>` : `<label class="check"><input type="checkbox" name="hidden" ${token.hidden ? "checked" : ""}> Oculta</label><fieldset><legend>Detecção automática</legend>${num("dc", "Dificuldade de percepção", token.dc, -100, 1000, "Percepção da ficha igual ou maior revela.")}${num("detectRange", "Distância máxima (casas)", token.detectRange, 0, 30, "Opcional.")}<div class="field"><label for="f-dsense">Sentido que detecta</label><input id="f-dsense" name="detectSense" maxlength="40" value="${esc(token.detectSense || "")}"></div></fieldset>${token.hidden ? playerChecks(token.revealedTo || []) : ""}`}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${creature && token.hidden ? button("Revelar para todos", "t-token-reveal-all", token.id, "subtle") : ""}<button type="submit" class="primary">Salvar</button></div></form>`,
    );
    $("#token-settings-form").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      submitForm(form, async (data) => {
        await api(`${base}/tokens/${token.id}/settings`, "POST", {
          light: optionalInt(data.light), vision: optionalInt(data.vision), perception: optionalInt(data.perception),
          senses: data.senses || null, hidden: data.hidden === "on", dc: optionalInt(data.dc), detectSense: data.detectSense || null, detectRange: optionalInt(data.detectRange),
        });
        if (creature && data.hidden === "on" && token.hidden) await api(`${base}/tokens/${token.id}/reveal`, "POST", { all: false, userIds: checkedPlayers(form) });
        $("#modal").close();
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
    let sheetController;
    const p = live.participants.find((x) => x.characterId === characterId);
    const master = live.me.isMaster;
    modal(
      `Ficha de ${c.name}`,
      `${p ? `<p class="muted small">Jogador: ${esc(p.name)}${p.online ? " · conectado" : " · ausente"}</p>` : ""}${sheetViewHtml(c, { full: true })}<div id="table-model-sheet"></div>${
        master
          ? `<form id="hp-form" class="hp-form"><h4>Ajustar vida</h4><div class="hp-row"><div class="field"><label for="f-amount">Pontos</label><input id="f-amount" name="amount" type="number" min="1" max="100000" value="5" required></div><div class="field"><label for="f-reason">Motivo</label><input id="f-reason" name="reason" maxlength="120" placeholder="Ataque de criatura"></div></div>${formError()}<div class="form-actions"><button type="submit" class="danger" name="kind" value="damage">− Dano</button><button type="submit" class="subtle" name="kind" value="heal">+ Cura</button>${button("✎ Editar ficha", "t-edit-sheet", characterId, "subtle")}${button("⌛ Conceder turno", "t-give-turn", characterId, "primary", p?.online && !live.session.endedAt ? "" : "disabled")}</div></form>`
          : `<div class="form-actions">${c.canEdit ? button("✎ Editar ficha", "t-edit-sheet", characterId, "primary") : ""}</div>`
      }`,
    );
    if (c.sheet) {
      const { renderSheet } = await import("./pdf-sheet.js");
      const container = $("#table-model-sheet");
      sheetController = renderSheet(container, { pdfUrl: c.sheet.version.pdfUrl, pages: c.sheet.version.pages, fields: c.sheet.version.fields, mode: "view", values: { ...c.sheet.values, ...c.sheet.computed } });
      $("#modal").addEventListener("close", () => sheetController?.destroy(), { once: true });
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
    if (action === "t-npcs-at") { const [x, y] = id.split("|").map(Number); await (await tools()).openNpcs({ base, live, campaignId, cell: { x, y } }); }
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
      grid = !grid;
      renderTools();
      board.setView(boardView());
    }
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
    if (action === "t-token-settings") { const sel = live.tokens.find((t) => t.id === selected); if (sel) tokenSettingsModal(sel); }
    if (action === "t-token-reveal-all") { await quick(`${base}/tokens/${id}/reveal`, "POST", { all: true, userIds: [] }); $("#modal").close(); }
    if (action === "t-view-as") {
      if (viewAs) { viewAs = null; viewAsState = null; renderTools(); board.update(boardState(), boardView()); }
      else viewAsModal();
    }
    if (action === "t-table-settings") await tableSettingsModal();
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
    command("t-tab", next.dataset.id);
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
  const onKey = (e) => {
    if (e.key === "Escape" && mode !== "none" && !$("#modal").open)
      setMode("none");
  };
  document.addEventListener("keydown", onKey);

  poll();
  return () => {
    stop();
    document.removeEventListener("click", onModalClick);
    document.removeEventListener("keydown", onKey);
    app.liveTable = null;
  };
}
