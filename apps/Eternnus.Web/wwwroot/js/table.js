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
import {
  sheetViewHtml,
  hpBar,
  paintBars,
  openSheetEditor,
  guardAvatars,
} from "./sheet.js";
import {
  ACTION_KINDS,
  HEARTBEAT_MS,
  availableCommands,
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

const time = (iso) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

export async function renderTable(campaignId) {
  const entry = await api(`/campaigns/${campaignId}/table`);
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
      entry.joinedCharacterId || (linked.length === 1 ? linked[0].id : null);
    if (!chosen) return chooseCharacter(entry, campaignId);
    await api(`/sessions/${sessionId}/join`, "POST", { characterId: chosen });
  } else await api(`/sessions/${sessionId}/join`, "POST", {});
  return mountTable(campaignId, sessionId);
}

function renderOffline(entry) {
  $("#app").className = "table-app offline-table";
  $("#app").innerHTML =
    `<main id="main" class="table-offline metal" tabindex="-1"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"><span class="offline-badge">Offline</span><h1>${esc(entry.campaign.name)}</h1><p>A mesa está fechada no momento. Quando o mestre iniciar uma sessão, a campanha aparecerá como <strong>ONLINE</strong> e você entrará direto nela.</p><div class="form-actions"><a class="button subtle" href="#campaign/${esc(entry.campaign.id)}">Ver campanha</a><a class="button primary" href="#campaigns">← Minhas campanhas</a></div></main>`;
}

function chooseCharacter(entry, campaignId) {
  $("#app").className = "table-app offline-table";
  $("#app").innerHTML =
    `<main id="main" class="table-offline metal" tabindex="-1"><span class="online-badge"><i aria-hidden="true"></i>ONLINE</span><h1>${esc(entry.campaign.name)}</h1><p>${esc(sessionLabel(entry.session.number, entry.session.title))}</p>${
      entry.characters.length
        ? `<form id="choose-form"><fieldset class="character-choices"><legend>Com qual ficha você entra na mesa?</legend>${entry.characters.map((c, i) => `<label class="character-choice metal"><input type="radio" name="characterId" value="${esc(c.id)}" ${i === 0 ? "checked" : ""}><span class="choice-avatar" aria-hidden="true">${esc(initials(c.name))}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.archetype || "Aventureiro")} · Nv. ${c.level} · Vida ${c.hp}/${c.maxHp}${c.linked ? "" : " · será vinculada"}</small></span></label>`).join("")}</fieldset>${formError()}<div class="form-actions"><a class="button subtle" href="#campaigns">Voltar</a><button type="submit" class="primary">▶ Entrar na mesa</button></div></form>`
        : `<p class="muted">Você precisa de uma ficha para entrar na mesa.</p><div class="form-actions"><a class="button subtle" href="#campaigns">Voltar</a><a class="button primary" href="#characters">+ Criar personagem</a></div>`
    }</main>`;
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

function mountTable(campaignId, sessionId) {
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
    sheetSignature = "";
  const previousHp = new Map();
  let previousActive;
  const controller = new AbortController();

  $("#app").className = "table-app";
  $("#app").innerHTML = `<div class="table-shell">
    <header class="table-top"><a class="table-brand" href="#campaign/${esc(campaignId)}" aria-label="Voltar à campanha"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"></a><div class="table-title"><h1><span id="t-campaign">Mesa</span> <span class="online-badge" id="t-online"><i aria-hidden="true"></i>ONLINE</span></h1><p id="t-sub">Conectando à sessão…</p></div><div class="table-top-actions" id="t-top"></div><div class="music-dock"></div></header>
    <aside class="party" aria-labelledby="party-title"><h2 id="party-title"><span aria-hidden="true">⚔</span> Aventureiros <span class="count-chip" id="t-count">0 online</span></h2><ul id="t-party" class="party-list"></ul><p class="party-caption">Avatares conectados e estado atual</p></aside>
    <main class="stage" id="main" tabindex="-1" aria-label="Mapa da sessão"><div class="stage-chip" id="t-chip"></div><div class="stage-tools" id="t-tools" role="toolbar" aria-label="Ferramentas do mapa" aria-orientation="vertical"></div><div class="board" id="t-board"></div><div class="turn-herald" id="t-herald" aria-hidden="true"><span></span></div><p class="stage-hint" id="t-hint" role="status"></p></main>
    <section class="side-panel" aria-label="Registros da mesa"><div class="panel-tabs" role="tablist" id="t-tabs"></div><div class="panel-body" id="t-panel" role="tabpanel" tabindex="0"></div><form id="t-chat" class="chat-form" autocomplete="off"><label class="sr-only" for="t-message">Mensagem para a mesa</label><input id="t-message" name="content" maxlength="2000" placeholder="Escrever mensagem… (/r 1d20+3 para rolar)" required><button type="submit" class="primary icon-send" aria-label="Enviar">➤</button></form></section>
    <footer class="turn-bar" id="t-turn" aria-live="polite"></footer>
    <div class="ended-veil" id="t-ended" hidden></div>
  </div>`;
  const board = createBoard($("#t-board"), {
    onToken: (token) => onToken(token),
    onCell: (cell) => onCell(cell),
    onCancel: () => setMode("none"),
  });
  const temporaryImages = mountTemporaryImages(sessionId, $(".party"));

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
          navigate("campaigns");
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
    temporaryImages.dispose();
    $("#connection-banner").hidden = true;
  }

  // ---------- Renderização ----------
  function apply(next) {
    const first = !live;
    live = next;
    temporaryImages.update(next);
    rev = next.revision;
    app.liveTable = { campaignId, sessionId };
    renderHeader();
    renderParty(first);
    renderTools();
    renderTabs();
    renderPanel();
    renderTurnBar();
    guardAvatars($("#t-turn"));
    if (mode === "move" && !availableCommands(live).mover) mode = "none";
    if (selected && !live.tokens.some((t) => t.id === selected))
      selected = null;
    board.update(live, boardView());
    herald(first);
    lastEventId = Math.max(lastEventId, ...live.events.map((e) => e.id), 0);
    if (live.session.endedAt) showEnded();
  }

  function renderHeader() {
    const s = live.session;
    $("#t-campaign").textContent = live.campaign.name;
    document.title = `${live.campaign.name} — ${sessionLabel(s.number, s.title)} · Eternnus RPG`;
    const me = live.participants.find((p) => p.isMe);
    $("#t-sub").innerHTML = [
      esc(sessionLabel(s.number, s.title)),
      live.me.isMaster
        ? `Mestre: ${esc(live.campaign.master)}`
        : `Você joga como <strong>${esc(me?.characterName || "")}</strong>`,
      `Turno atual: <strong>${esc(s.activeName || "narrativa do mestre")}</strong>`,
    ].join('<span aria-hidden="true"> • </span>');
    if (live.campaign.isOneShot) $("#t-sub").insertAdjacentHTML("beforeend", `<span class="small"> · One-shot: encerra ao mestre sair; expira ${esc(new Date(live.campaign.expiresAt).toLocaleString("pt-BR"))}</span>`);
    $("#t-online").hidden = !!s.endedAt;
    $("#t-top").innerHTML = live.me.isMaster
      ? `${button("⚙ Gerenciar turnos", "t-set-turn", "", "subtle")}${button("■ Encerrar sessão", "t-end", "", "danger")}${button("Sair da mesa", "t-exit", "", "subtle")}`
      : `${button("▣ Minha ficha", "t-my-sheet", "", "subtle")}${button("Sair da mesa", "t-exit", "", "subtle")}`;
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
          const body = `<img class="avatar" src="${esc(p.avatarUrl)}" alt="" referrerpolicy="no-referrer"><span class="party-text"><strong>${esc(p.characterName)}</strong>${p.canView ? `<small>Nv. ${p.level} · Vida: ${p.hp}/${p.maxHp}</small>${hpBar(p.hp, p.maxHp, "Vida de " + p.characterName)}` : "<small>Ficha privada</small>"}</span><i class="presence" aria-label="Conectado"></i>`;
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
    const chip = `<span aria-hidden="true">⚑</span> ${esc(live.map.name)} <span aria-hidden="true">/</span> ${live.me.isMaster ? "Visão do mestre" : "Mapa compartilhado"}`;
    $("#t-chip").innerHTML = chip;
    const tool = (icon, action, label, active = false, disabled = false) =>
      `<button type="button" class="tool ${active ? "active" : ""}" data-action="${action}" aria-label="${label}" title="${label}" ${active ? 'aria-pressed="true"' : 'aria-pressed="false"'} ${disabled ? "disabled" : ""}>${icon}</button>`;
    const sel = live.tokens.find((t) => t.id === selected);
    $("#t-tools").innerHTML = live.me.isMaster
      ? `${tool("➤", "t-tool-select", "Selecionar e mover marcadores", mode === "none" && tiles, !tiles)}${tool("⚑", "t-tool-place", "Adicionar criatura ao mapa", mode === "place", !tiles)}${tool("▦", "t-tool-grid", "Mostrar ou ocultar a grade", grid, !tiles)}${tool("◈", "t-map", "Trocar o mapa mostrado")}${tool("✕", "t-tool-remove", "Remover marcador selecionado", false, !sel || !!sel.characterId)}`
      : `${tool("➤", "t-move", "Mover meu personagem", mode === "move", !availableCommands(live).mover)}${tool("▦", "t-tool-grid", "Mostrar ou ocultar a grade", grid, !tiles)}${tool("⌖", "t-focus-board", "Usar o mapa pelo teclado", false, !tiles)}`;
    const hint =
      mode === "move"
        ? `Escolha uma casa destacada (alcance de ${movementSquares(live.me.character?.movement, live.map.scaleMeters)} quadros). Esc cancela.`
        : mode === "place"
          ? "Clique em uma casa livre para posicionar uma criatura."
          : sel && live.me.isMaster
            ? `${sel.label} selecionado: clique no destino.`
            : "";
    $("#t-hint").textContent = hint;
    $("#t-hint").hidden = !hint;
  }

  function boardView() {
    let reach = [];
    if (mode === "move") {
      const token = myToken(live);
      if (token)
        reach = reachableCells(
          live.map.rows,
          live.tokens,
          token,
          movementSquares(live.me.character?.movement, live.map.scaleMeters),
        );
    } else if (mode === "place") reach = [];
    return { mode, reach, selected, grid };
  }
  function setMode(next) {
    mode = next;
    if (next !== "none") selected = null;
    renderTools();
    board.setView(boardView());
  }

  function renderTabs() {
    const tabs = live.me.isMaster
      ? [
          ["chat", "Chat"],
          ["rolls", "Rolagens"],
          ["history", "Histórico"],
          ["notes", "Notas"],
        ]
      : [
          ["chat", "Chat"],
          ["rolls", "Rolagens"],
          ["sheet", "Sua ficha"],
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
    if (tab === "sheet") {
      const c = live.me.character;
      const signature = JSON.stringify(c);
      if (signature === sheetSignature && panel.querySelector(".sheet-view"))
        return;
      sheetSignature = signature;
      panel.innerHTML = c
        ? `${sheetViewHtml(c)}<p class="sheet-hint">Sua ficha é pessoal. As ações são habilitadas conforme as regras e a vez do jogador.</p>${button("Ver ficha completa", "t-my-sheet", "", "primary wide-button")}`
        : '<p class="muted small">Nenhuma ficha vinculada.</p>';
      paintBars(panel);
      return;
    }
    sheetSignature = "";
    const nearBottom =
      panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
    const list = feedFor(live.events, tab === "history" ? "all" : tab);
    const rollForm =
      tab === "rolls" && !live.session.endedAt
        ? `<form id="t-roll" class="roll-form"><label class="sr-only" for="t-formula">Fórmula</label><input id="t-formula" name="formula" value="1d20" maxlength="40" required aria-describedby="roll-help"><label class="sr-only" for="t-label">Descrição</label><input id="t-label" name="label" maxlength="60" placeholder="Percepção"><button type="submit" class="primary">⬡ Rolar</button><small id="roll-help">Rolagem livre registrada no servidor.</small></form>`
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
    panel.innerHTML = `${rollForm}${noteForm}<ol class="feed-list ${tab}">${list.map((e) => eventHtml(e, e.id > lastEventId && lastEventId > 0)).join("") || `<li class="feed-empty">${empty}</li>`}</ol>`;
    if (tab !== "notes" && (nearBottom || !panel.dataset.ready))
      panel.scrollTop = panel.scrollHeight;
    panel.dataset.ready = "1";
  }

  function rollDetail(roll) {
    if (!roll?.values) return "";
    const values = roll.values.map(Number);
    const dice = roll.formula.replace(/[+-]\d+$/, "");
    const mod = Number(roll.modifier) || 0;
    return `<span class="roll-detail">${esc(dice)} (${values.join(", ")})${mod ? ` ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}` : ""} = <b>${Number(roll.total)}</b></span>`;
  }

  function eventHtml(e, fresh) {
    const [icon, label] = eventMeta(e.kind);
    const data = eventData(e);
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
      return `<li class="${cls}"><span class="feed-die" aria-hidden="true">${roll ? "⬡" : icon}</span><div><p class="feed-head"><strong>${esc(actor)}</strong> · ${esc(title)} <time>${time(e.createdAt)}</time></p>${summary ? `<p>${esc(summary)}</p>` : ""}${roll ? rollDetail(roll) : ""}</div></li>`;
    }
    if (e.kind === "note")
      return `<li class="${cls} ${e.masterOnly ? "private" : "shared"}"><span class="feed-die" aria-hidden="true">✎</span><div><p class="feed-head"><strong>${e.masterOnly ? "Nota do mestre" : "Narração"}</strong> <time>${time(e.createdAt)}</time>${e.masterOnly ? ' <span class="lock">Visível apenas ao mestre</span>' : ""}</p><p class="note-text">${esc(e.content)}</p></div></li>`;
    if (e.kind === "sheet")
      return `<li class="${cls}"><span class="feed-die" aria-hidden="true">♜</span><div><p class="feed-head"><strong>${label}</strong> <time>${time(e.createdAt)}</time></p><p>${esc(e.content)}</p>${data.reason ? `<small>Motivo: ${esc(data.reason)}</small>` : ""}</div></li>`;
    return `<li class="${cls} system"><span aria-hidden="true">${icon}</span> ${esc(e.content)} <time>${time(e.createdAt)}</time></li>`;
  }

  function renderTurnBar() {
    const s = live.session;
    const active = live.participants.find(
      (p) => p.characterId && p.characterId === s.activeCharacterId,
    );
    if (live.me.isMaster) {
      $("#t-turn").innerHTML =
        `<div class="turn-who">${active ? `<img class="avatar" src="${esc(active.avatarUrl)}" alt="">` : '<span class="turn-crest" aria-hidden="true">♛</span>'}<div><strong>${active ? "Turno de " + esc(active.characterName) : "Narrativa do mestre"}</strong><small>Turno ${s.turnNumber || "—"}</small></div><span class="turn-chip master">♛ Controle do mestre</span></div><div class="turn-actions">${button("✎ Registrar nota", "t-note", "", "subtle")}${button("◈ Mostrar mapa", "t-map", "", "subtle")}${button("◉ Definir turno", "t-set-turn", "", "subtle")}${button("♙ Abrir ficha", "t-open-sheet", "", "subtle", onlinePlayers(live).length ? "" : "disabled")}${button("➤ Próximo turno", "t-next", "", "primary", onlinePlayers(live).length && !s.endedAt ? "" : "disabled")}</div>`;
      return;
    }
    const me = live.participants.find((p) => p.isMe);
    const mine = isMyTurn(live);
    const can = availableCommands(live);
    const why = mine ? "" : 'title="Aguarde o mestre conceder o seu turno"';
    const cmd = (key, icon, label, action, extra = "") =>
      `<button type="button" class="${key === "encerrar" ? "primary" : "subtle"} ${mode === "move" && key === "mover" ? "active" : ""}" data-action="${action}" data-id="${key}" ${can[key] ? "" : "disabled"} ${can[key] ? "" : why} ${extra}>${icon} ${label}</button>`;
    const kindTitle = (k) =>
      mine && !can[k] ? `title="Crie uma ação de ${k} na sua ficha"` : "";
    $("#t-turn").innerHTML =
      `<div class="turn-who"><img class="avatar" src="${esc(me?.avatarUrl || "/assets/avatar.svg")}" alt=""><div><strong>${esc(me?.characterName || "")} · Nv. ${me?.level ?? ""}</strong><small>${mine ? "Seu turno agora" : active ? "Turno de " + esc(active.characterName) : "O mestre está narrando"}</small></div><span class="turn-chip ${mine ? "yours" : "waiting"}">${mine ? "⌛ Seu turno" : "◷ Aguardando"}</span></div><div class="turn-actions">${ACTION_KINDS.map(([k, icon, label]) => cmd(k, icon, label, "t-act", k === "ataque" ? "" : kindTitle(k))).join("")}${cmd("mover", "➤", "Mover", "t-move")}${cmd("defender", "▢", "Defender", "t-defend")}${cmd("encerrar", "✓", "Encerrar turno", "t-end-turn")}</div>`;
    $("#t-turn").classList.toggle("my-turn", mine);
  }

  function herald(first) {
    const now = live.session.activeCharacterId;
    if (!first && now !== previousActive && !live.session.endedAt) {
      const el = $("#t-herald");
      const mine = isMyTurn(live);
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
      availableCommands(live).mover
    )
      setMode(mode === "move" ? "none" : "move");
  }
  async function onCell(cell) {
    try {
      if (live.me.isMaster && mode === "place") return addTokenModal(cell);
      if (live.me.isMaster && selected) {
        await quick(`${base}/tokens/${selected}/move`, "POST", cell);
        return;
      }
      if (mode === "move") {
        const token = myToken(live);
        const reach = boardView().reach;
        if (!reach.some((c) => c.x === cell.x && c.y === cell.y))
          return toast("Escolha uma casa destacada dentro do seu alcance.");
        await quick(`${base}/tokens/${token.id}/move`, "POST", cell);
        setMode("none");
      }
    } catch (error) {
      toast(error.message);
    }
  }

  // ---------- Modais ----------
  function addTokenModal(cell) {
    modal(
      "Adicionar ao mapa",
      `<form id="token-form"><div class="field"><label for="f-label">Nome</label><input id="f-label" name="label" maxlength="40" required placeholder="Esqueleto guardião"></div><div class="field"><label for="f-side">Lado</label><select id="f-side" name="side"><option value="enemy">Inimigo</option><option value="neutral">Neutro</option><option value="ally">Aliado</option></select></div><p class="form-help">Posição: coluna ${cell.x + 1}, linha ${cell.y + 1}.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">⚑ Posicionar</button></div></form>`,
    );
    $("#token-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        await api(`${base}/tokens`, "POST", { ...data, x: cell.x, y: cell.y });
        $("#modal").close();
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
          : `<div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}${c.canEdit ? button("✎ Editar ficha", "t-edit-sheet", characterId, "primary") : ""}</div>`
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

  function actionModal(kind) {
    const c = live.me.character;
    const [, icon, label] = ACTION_KINDS.find((k) => k[0] === kind);
    const options = (c.actions || []).filter((a) => a.kind === kind);
    const basic =
      kind === "ataque"
        ? [
            {
              id: "",
              name: "Ataque básico",
              formula: `1d20${(Math.floor((c.strength - 10) / 2) >= 0 ? "+" : "") + Math.floor((c.strength - 10) / 2)}`,
              description: "Usa o modificador de Força.",
            },
          ]
        : [];
    const all = [...options, ...basic];
    const targets = [
      ...new Set([
        ...live.tokens
          .filter((t) => t.characterId !== c.id)
          .map((t) => t.label),
        ...onlinePlayers(live)
          .filter((p) => !p.isMe)
          .map((p) => p.characterName),
      ]),
    ];
    modal(
      `${icon} ${label}`,
      `<form id="action-form"><fieldset class="action-choices"><legend>Escolha a ação</legend>${all.map((a, i) => `<label class="action-choice metal"><input type="radio" name="actionId" value="${esc(a.id)}" ${i === 0 ? "checked" : ""}><span><strong>${esc(a.name)}</strong>${a.formula ? ` <code>${esc(a.formula)}</code>` : ""}<small>${esc(a.description || "")}</small></span></label>`).join("")}</fieldset><div class="field"><label for="f-target">Alvo (opcional)</label><input id="f-target" name="target" maxlength="60" list="target-list" placeholder="Quem ou o quê?"><datalist id="target-list">${targets.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">${icon} Usar ação</button></div></form>`,
    );
    $("#action-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        const result = await api(`${base}/actions`, "POST", {
          kind,
          actionId: data.actionId || null,
          target: data.target,
        });
        $("#modal").close();
        toast(result.message);
        tab = tab === "sheet" ? "rolls" : tab;
      });
    };
  }

  async function mapModal() {
    const maps = await api(`/campaigns/${campaignId}/maps`);
    const { mapThumbnail } = await import("./table-map.js");
    modal(
      "◈ Mostrar mapa",
      `<form id="map-form"><fieldset class="map-choices"><legend>Escolha o que os jogadores verão</legend>${maps.items.map((m) => `<label class="map-choice"><input type="radio" name="map" value="${esc(m.kind)}|${esc(m.key)}" ${m.key === live.map.key ? "checked" : ""}><span class="map-preview" data-map-key="${esc(m.key)}"></span><span class="map-choice-text"><strong>${m.kind === "tileset" ? "▦ Tileset" : "◎ Cartográfico"} · ${esc(m.name)}</strong><small>${esc(m.description)}</small></span></label>`).join("")}</fieldset><p class="form-help">Ao trocar de tileset, criaturas saem do mapa e os aventureiros voltam aos pontos de entrada.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">◈ Revelar mapa</button></div></form>`,
    );
    $("#modal").classList.add("wide");
    $("#modal").addEventListener(
      "close",
      () => $("#modal").classList.remove("wide"),
      { once: true },
    );
    document.querySelectorAll("#map-form .map-preview").forEach((el) =>
      mapThumbnail(
        el,
        maps.items.find((m) => m.key === el.dataset.mapKey),
      ),
    );
    $("#map-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        const [mapKind, mapKey] = data.map.split("|");
        await api(`${base}/map`, "POST", { mapKind, mapKey });
        $("#modal").close();
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
        `<p>${live.campaign.isOneShot ? "A one-shot será fechada e seus dados serão apagados. As fichas pessoais e a participação consumida são preservadas." : "A campanha ficará offline e os jogadores verão o encerramento. O histórico, as notas e as alterações das fichas continuam disponíveis para consulta."}</p><form id="end-form">${formError()}<div class="form-actions">${button("Continuar jogando", "modal-close", "", "subtle")}<button type="submit" class="danger">■ Encerrar sessão</button></div></form>`,
    );
    $("#end-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async () => {
        await api(`${base}/end`, "POST");
        $("#modal").close();
        if (live.campaign.isOneShot) { stop(); navigate("campaigns"); }
      });
    };
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
    if (action === "t-map") await mapModal();
    if (action === "t-end") endModal();
    if (action === "t-exit") {
      if (!live.me.isMaster) {
        try {
          await quick(`${base}/leave`, "POST");
        } catch {}
        stop();
        navigate("campaigns");
      } else if (live.campaign.isOneShot) {
        await quick(`${base}/leave`, "POST");
        stop();
        toast("One-shot encerrada. Os dados da mesa foram removidos.");
        navigate("campaigns");
      } else {
        toast("A sessão continua online. Você pode voltar pela campanha.");
        stop();
        navigate("campaign/" + campaignId + "/sessions");
      }
    }
    if (action === "t-act") actionModal(id);
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
    if (!["t-chat", "t-roll", "t-note"].includes(form.id)) return;
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
      if (form.id === "t-roll") {
        await quick(`${base}/rolls`, "POST", data);
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
