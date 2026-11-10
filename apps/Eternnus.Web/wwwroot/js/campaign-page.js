import { helpButton } from "./help.js";
// Página da campanha (Tela 05) e abertura de sessão (Tela 06).
import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import {
  $,
  esc,
  button,
  modal,
  formError,
  submitForm,
  toast,
  empty,
  formatDate,
  navigate,
} from "./ui.js";
import { campaignForm, confirmCampaign } from "./campaigns.js";
import { formatDuration, isGuid, sessionLabel } from "./session-policy.js";
import { mapChoices, mountMapChoices } from "./map-picker.js";
import { guardAvatars } from "./sheet.js";
import { renderCampaignLibrary, renderCampaignMaps } from "./campaign-assets.js";
import { keepMasterPresence } from "./session-presence.js";

// Abas principais [chave, rótulo, só mestre]. Nada aparece ou some da barra ao navegar: subpáginas ficam dentro da aba-mãe.
const TABS = [
  ["overview", "Visão geral", false],
  ["journal", "Diário", false],
  ["prep", "Preparação", true],
  ["players", "Grupo", false],
  ["world", "Mundo e acervo", false],
  ["notes", "Minhas notas", false],
  ["settings", "Configurações", true],
];
// Subpáginas com submenu sempre visível na aba-mãe: [chave, rótulo, só mestre].
const SUBPAGES = {
  world: [["world", "Páginas", false], ["atlas", "Atlas compartilhado", false], ["resources", "Bibliotecas", false], ["maps", "Mapas e cenários", true]],
  settings: [["settings", "Campanha", true], ["table", "Mesa", true]],
};
// Seções do Diário com endereço próprio (links antigos e atalhos): abrem o Diário já na seção.
const JOURNAL_SECTIONS = { sessions: "cp-sessions", past: "cp-past" };
/** Aba principal que contém `tab` (ela mesma, a mãe de uma subpágina ou o Diário). */
export function parentTab(tab) {
  if (TABS.some(([key]) => key === tab)) return tab;
  if (JOURNAL_SECTIONS[tab]) return "journal";
  return Object.entries(SUBPAGES).find(([, items]) => items.some(([key]) => key === tab))?.[0] || null;
}
const subpageAllowed = (tab, d) => {
  const parent = parentTab(tab);
  const item = SUBPAGES[parent]?.find(([key]) => key === tab);
  if (item && item[2] && !d.isMaster) return false;
  if (tab === "sessions") return d.isMaster && !d.isOneShot;
  return true;
};
function subnav(d, parent, tab) {
  const items = (SUBPAGES[parent] || []).filter(([, , masterOnly]) => !masterOnly || d.isMaster);
  if (items.length < 2) return "";
  const label = TABS.find(([key]) => key === parent)?.[1] || "";
  return `<nav class="sub-tabs" aria-label="Seções de ${esc(label)}">${items.map(([key, text]) => `<a href="#campaign/${esc(d.id)}/${key}" ${key === tab ? 'aria-current="page" class="active"' : ""}>${esc(text)}</a>`).join("")}</nav>`;
}
let page = 1,
  lastSessions = [],
  generation = 0,
  currentCampaign = "";

export async function renderCampaignPage(id, tab = "overview") {
  const request = ++generation;
  if (currentCampaign !== id) page = 1;
  currentCampaign = id;
  // A tela anterior fica sob a camada de carregamento até os dados chegarem: sem página vazia entre as abas.
  const detail = await api("/campaigns/" + id);
  if (request !== generation) return;
  shell("campaigns");
  state.campaign = detail;
  const visible = TABS.filter(([, , masterOnly]) => !masterOnly || detail.isMaster);
  let parent = parentTab(tab);
  if (!parent || !visible.some(([key]) => key === parent) || !subpageAllowed(tab, detail)) { tab = "overview"; parent = "overview"; }
  const online = !!detail.activeSession;
  const masterName = detail.masterName || "o mestre";
  $("#main").innerHTML =
    `${detail.isOneShot ? '<a class="back-link" href="#one-shot">← One-shots</a>' : '<a class="back-link" href="#campaigns">← Minhas campanhas</a>'}
  <section class="campaign-hero metal"><div class="campaign-hero-copy"><span class="eyebrow">${esc(detail.system)}</span><h1>${esc(detail.name)}</h1>${detail.archived ? '<p class="notice-box">Campanha arquivada: conteúdo e histórico preservados, sem novas partidas até ser restaurada.</p>' : ""}${heroPremise(detail)}<div class="hero-meta"><span>♛ <b>Mestre:</b> ${esc(masterName)}</span><span>♙ <b>${detail.members.length}</b> ${detail.members.length === 1 ? "jogador" : "jogadores"}</span>${detail.isMaster && !detail.isOneShot ? `<span>▣ <b>${detail.sessionCount}</b> ${detail.sessionCount === 1 ? "sessão" : "sessões"}</span>` : ""}${online ? '<span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>ONLINE</span>' : ""}</div></div>${online ? `<a class="button primary enter-table" href="#table/${esc(id)}">▶ ${detail.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a>` : ""}</section>
  <nav class="page-tabs" aria-label="Seções da campanha">${visible.map(([key, label]) => `<a href="#campaign/${esc(id)}/${key}" ${key === parent ? 'aria-current="page" class="active"' : ""}>${label}</a>`).join("")}</nav>
  <div class="campaign-page-grid"><section id="campaign-tab" class="campaign-tab" aria-live="polite">${subnav(detail, parent, tab)}<div id="campaign-tab-body" class="campaign-tab-body"></div></section>${overviewCard(detail)}</div>`;
  await renderTab(detail, tab);
  const anchor = JOURNAL_SECTIONS[tab];
  if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  guardAvatars($("#main"));
  if (detail.isOneShot) $(".campaign-hero-copy").insertAdjacentHTML("beforeend", `<p class="notice-box">One-shot: se o mestre se desconectar, a mesa espera ${detail.recoveryMinutes || 10} minutos antes de ser removida. Encerrar apaga os dados; converter em campanha preserva tudo. Prazo máximo: ${esc(new Date(detail.expiresAt).toLocaleString("pt-BR"))}.</p>`);
  const releasePresence = keepMasterPresence(detail);
  return () => { ++generation; releasePresence(); };
}

/** Premissa no topo: trecho curto com as quebras preservadas; "mais" abre o texto completo num popup. */
const PREMISE_BRIEF = 260;
function heroPremise(d) {
  const text = (d.description || "").trim();
  if (!text) return '<p class="hero-premise">Uma nova história aguarda seu primeiro capítulo.</p>';
  const lines = text.split(/\r?\n/);
  const long = text.length > PREMISE_BRIEF || lines.length > 3;
  const head = lines.slice(0, 3).join("\n");
  // Corta no último espaço só quando o trecho interrompe uma palavra.
  const brief = !long ? text : (head.length > PREMISE_BRIEF ? head.slice(0, PREMISE_BRIEF).replace(/\s+\S*$/, "") : head).trimEnd() + "…";
  return `<p class="hero-premise">${esc(brief)}${long ? ` ${button("mais", "cp-premise", "", "text-button hero-more", 'aria-label="Ler a premissa completa" aria-haspopup="dialog"')}` : ""}</p>`;
}

function overviewCard(d) {
  const online = !!d.activeSession;
  return `<aside class="campaign-aside metal" aria-label="Visão da campanha"><h2>Visão da campanha</h2><dl><div><dt>Estado atual</dt><dd>${online ? '<span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>Online</span>' : '<span class="offline-badge" data-tip="Nenhuma sessão está aberta nesta campanha.">Offline</span>'}</dd></div>${d.isMaster && !d.isOneShot ? `<div><dt>Sessões realizadas</dt><dd>${String(d.sessionCount).padStart(2, "0")} ${d.sessionCount === 1 ? "sessão" : "sessões"}</dd></div>` : ""}<div><dt>Participantes</dt><dd>${d.members.length} ${d.members.length === 1 ? "aventureiro" : "aventureiros"}</dd></div>${online ? `<div><dt>Sessão em andamento</dt><dd>${esc(sessionLabel(d.activeSession.number, d.activeSession.title))}</dd></div>` : ""}<div><dt>Seu acesso</dt><dd>${d.isMaster ? "Mestre · histórico e notas" : "Jogador · mesa e ficha"}</dd></div></dl>${online ? `<a class="button primary" href="#table/${esc(d.id)}">▶ ${d.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a>` : d.isOneShot ? '<p class="muted small waiting-note">Mesa fechada: a sessão única desta one-shot não está aberta.</p>' : d.isMaster ? button("✦ Iniciar nova sessão", "cp-start", d.id, "primary") : '<p class="muted small waiting-note">⌛ Aguardando o mestre abrir a próxima sessão.</p>'}${d.isMaster ? `<a class="button subtle" href="#campaign/${esc(d.id)}/players">⚑ Gerenciar jogadores</a>` : ""}</aside>`;
}

async function renderTab(d, tab) {
  const target = $("#campaign-tab-body");
  if (tab === "journal" || JOURNAL_SECTIONS[tab]) return renderJournalTab(d, target);
  if (tab === "players") {
    target.innerHTML = `<div class="section-title"><h2>Jogadores</h2>${d.isMaster ? "" : button("+ Vincular minha ficha", "cp-link", d.id, "subtle small")}</div>${
      d.members.length
        ? `<ul class="member-list">${d.members
            .map((m) => {
              const sheets = d.characters.filter((c) => c.ownerId === m.id);
              return `<li class="member-row metal"><img class="avatar" src="${esc(m.avatarUrl)}" alt="" referrerpolicy="no-referrer"><div><strong>${esc(m.name)}</strong><small>${sheets.length ? sheets.map((c) => `${esc(c.name)} · Nv. ${c.level} · Vida ${c.hp}/${c.maxHp}`).join("<br>") : "Nenhuma ficha vinculada"}</small></div>${d.isMaster ? button("Remover", "cp-remove", m.id, "subtle small") : ""}</li>`;
            })
            .join("")}</ul>`
        : empty(
            "Sua guilda ainda está se formando.",
            d.isMaster
              ? "Compartilhe o código de convite para reunir os jogadores."
              : "Os demais jogadores aparecerão aqui.",
          )
    }${d.isMaster ? inviteBox(d) : ""}`;
    return;
  }
  if (tab === "world" || tab === "notes") return (await import("./campaign-workspace.js")).renderWorkspace(d, target, tab === "notes");
  if (tab === "atlas") return (await import("./campaign-workspace.js")).renderAtlas(d, target);
  if (tab === "past") return (await import("./campaign-workspace.js")).renderPast(d, target);
  if (tab === "resources") return renderCampaignLibrary(d, target);
  if (tab === "prep") return (await import("./campaign-prep.js")).renderPrep(d, target);
  if (tab === "maps") return renderCampaignMaps(d, target);
  if (tab === "table") return (await import("./fog-editor.js")).renderTableSettingsTab(d, target);
  if (tab === "settings") {
    target.innerHTML = `<div class="section-title"><h2>Configurações${helpButton("campanhas.config.arquivamento", "Arquivar e restaurar")}</h2></div><div class="settings-list"><article class="metal"><h3>Identidade da campanha</h3><p class="muted small">Nome, sistema, premissa, origem e continuidade.</p>${button("Editar campanha", "cp-edit", d.id, "subtle")}</article><article class="metal"><h3>Convite e jogadores</h3><p class="muted small">O link de convite e a lista de jogadores ficam na aba Grupo.</p><a class="button subtle" href="#campaign/${esc(d.id)}/players">Abrir o grupo</a></article>${d.isOneShot ? `<article class="metal"><h3>Continuar depois</h3><p class="muted small">Converta em campanha persistente para guardar sessão, fichas, mapas e histórico. Usa uma das suas vagas de campanha; jogadores sem vaga podem voltar pelo convite.</p>${button("Converter em campanha", "cp-convert", d.id, "primary")}</article><article class="metal danger-zone"><h3>Encerrar one-shot</h3><p class="muted small">Encerre a sessão na mesa ou pela página One-shot. Todo o conteúdo da mesa é apagado; fichas pessoais são preservadas.</p><a class="button subtle" href="#one-shot">Ir para One-shot</a></article>` : `<article class="metal"><h3>${d.archived ? "Restaurar campanha" : "Arquivar campanha"}</h3><p class="muted small">${d.archived ? "Volta a permitir sessões e preparação. A campanha arquivada já ocupa sua vaga, então restaurar não ultrapassa o limite." : "Guarda conteúdo e histórico e impede novas partidas. A campanha continua contando no limite de campanhas."}</p>${button(d.archived ? "Restaurar" : "Arquivar", d.archived ? "cp-restore" : "cp-archive", d.id, "subtle", d.activeSession ? 'aria-disabled="true" data-tip="Encerre a sessão em andamento antes"' : "")}</article><article class="metal danger-zone"><h3>Excluir campanha</h3><p class="muted small">${d.members.length ? "Indisponível enquanto houver jogadores vinculados." : "Sessões, registros e recursos serão apagados. Fichas pessoais são preservadas."}</p>${button("Excluir campanha", "cp-delete", d.id, "danger", d.members.length ? "disabled" : "")}</article>`}</div>`;
    await templateSettings(d, target);
    return;
  }
  const firstSteps = d.isMaster && !d.isOneShot && !d.archived && !d.sessionCount
    ? `<article class="first-steps metal"><h3>Primeiros passos</h3><ol><li><strong>Convide o grupo</strong> — envie o link abaixo.${inviteLink(d)}</li><li><strong>Ficha</strong> — as fichas nascem com o modelo sugerido pelo sistema. <a href="#campaign/${esc(d.id)}/settings">Trocar ou criar um modelo simples</a>.</li><li><strong>Capítulos</strong> — <a href="#campaign/${esc(d.id)}/journal">crie o primeiro capítulo, ato ou arco</a> para agrupar as sessões (opcional).</li><li><strong>Cenário (opcional)</strong> — <a href="#campaign/${esc(d.id)}/prep">prepare uma cena</a> ou comece direto.</li><li>${button("✦ Iniciar próxima sessão", "cp-start", d.id, "primary small")}</li></ol><p class="form-help">Configurações avançadas (névoa, luz, ordem de turnos) ficam disponíveis quando você precisar.</p></article>`
    : "";
  const next = d.nextSessionAt ? `<article class="metal next-session"><h3>Próxima partida</h3><p><strong>${esc(new Date(d.nextSessionAt).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }))}</strong></p><a class="text-button" href="#campaign/${esc(d.id)}/journal">${d.isMaster ? "Ver confirmações" : "Confirmar presença"} →</a></article>` : "";
  target.innerHTML = `${d.continuity || d.currentArc ? `<article class="metal overview-story"><h3>Onde paramos${d.currentArc ? " — " + esc(d.currentArc) : ""}</h3><p class="workspace-prose">${esc(d.continuity || "O resumo ainda será escrito.")}</p></article>` : ""}${firstSteps}${d.isMaster ? "" : `<a class="button primary" href="#character/new/${esc(d.id)}">+ Criar ficha com o modelo da campanha</a>`}${next}<div class="section-title"><h2>Visão geral</h2></div><article class="overview-story metal"><h3>Premissa</h3><p class="workspace-prose">${esc(d.description || "A premissa desta campanha ainda será escrita.")}</p></article>${
    d.activeSession
      ? `<article class="live-callout metal"><span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>Sessão em andamento</span><h3>${esc(sessionLabel(d.activeSession.number, d.activeSession.title))}</h3><p class="muted small">Iniciada em ${formatDate(d.activeSession.startedAt)}.</p><a class="button primary" href="#table/${esc(d.id)}">▶ ${d.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a></article>`
      : d.isOneShot
        ? `<article class="live-callout metal offline"><h3>Mesa fechada</h3><p class="muted small">A one-shot tem sessão única, aberta na criação. Sem ela, a mesa não volta a abrir.</p></article>`
        : `<article class="live-callout metal offline"><h3>Campanha offline</h3><p class="muted small">${d.isMaster ? "Inicie uma sessão para colocar a campanha online e receber os jogadores." : "Quando o mestre iniciar uma sessão, a campanha aparecerá como ONLINE e você entrará direto na mesa."}</p></article>`
  }<article class="metal overview-party"><h3>Personagens do grupo</h3>${d.characters.length ? `<ul>${d.characters.map((c) => `<li><strong>${esc(c.name)}</strong><span>${esc(c.archetype || "Aventureiro")} · Nv. ${c.level} · Vida ${c.hp}/${c.maxHp}</span></li>`).join("")}</ul>` : '<p class="muted small">Nenhuma ficha vinculada ainda.</p>'}</article>`;
}

const inviteUrl = (d) => `${location.origin}/#invite/${d.inviteCode}`;
function inviteLink(d) {
  return d.inviteCode ? `<div class="invite-code"><code>${esc(inviteUrl(d))}</code>${button("Copiar link", "cp-copy", inviteUrl(d), "subtle small")}</div>` : "";
}
function inviteBox(d) {
  return `<article class="metal invite-box"><h3>Convite${helpButton("campanhas.convite.codigo", "Convite da campanha")}</h3><p class="muted small">Quem abrir o link entra, confirma o e-mail se precisar e escolhe o personagem. Compartilhe só com quem deseja convidar.</p>${inviteLink(d)}<details><summary>Código para digitar</summary><div class="invite-code"><code>${esc(d.inviteCode)}</code>${button("Copiar código", "cp-copy", d.inviteCode, "subtle small")}</div></details></article>`;
}

/** Diário numa só página, em ordem de leitura: próxima partida, objetivos e pistas, sessões jogadas aqui, resumos e o histórico anterior. */
async function renderJournalTab(d, target) {
  const showSessions = d.isMaster && !d.isOneShot;
  target.innerHTML = `<div id="cp-journal" class="journal-block"></div>${showSessions ? '<section id="cp-chapters" class="journal-block" aria-labelledby="cp-chapters-title"></section><section id="cp-sessions" class="journal-block" aria-labelledby="cp-sessions-title"></section>' : ""}<section id="cp-recaps" class="journal-block" aria-labelledby="jr-recaps-title"></section><section id="cp-past" class="journal-block" aria-labelledby="past-title"></section>`;
  const [prep, workspace] = await Promise.all([import("./campaign-prep.js"), import("./campaign-workspace.js")]);
  await Promise.all([
    prep.renderJournal(d, { main: $("#cp-journal"), recaps: $("#cp-recaps") }),
    showSessions ? renderChapterBlock(d) : null,
    showSessions ? renderSessions(d, $("#cp-sessions")) : null,
    workspace.renderPast(d, $("#cp-past")),
  ]);
}

/** Capítulos e lista de sessões mudam juntos: contagens e rótulos dependem um do outro. */
async function refreshChapters(d) {
  const past = $("#cp-past");
  await Promise.all([
    renderChapterBlock(d),
    $("#cp-sessions") ? renderSessions(d, $("#cp-sessions")) : null,
    past ? import("./campaign-workspace.js").then((w) => w.renderPast(d, past)) : null,
  ]);
}
async function renderChapterBlock(d) {
  const host = $("#cp-chapters");
  if (host) await (await import("./campaign-chapters.js")).renderChapters(d, host, () => refreshChapters(d));
}

async function renderSessions(d, target) {
  target.innerHTML =
    '<p class="loading-line" role="status">Consultando as crônicas…</p>';
  const result = await api(`/campaigns/${d.id}/sessions?page=${page}`);
  lastSessions = result.items;
  if (!target.isConnected) return;
  const live = result.items.find((s) => s.active);
  target.innerHTML = `<div class="section-title"><h2 id="cp-sessions-title">Sessões no Eternnus</h2>${live ? `<a class="button primary small" href="#table/${esc(d.id)}">▶ Voltar à mesa</a>` : d.archived ? "" : button("✦ Iniciar nova sessão", "cp-start", d.id, "subtle small start-session")}</div><p class="muted small section-lead">Só você vê esta lista. Cada sessão guarda linha do tempo, rolagens e notas; o resumo publicado aparece para o grupo em “Resumos”.</p>${
    result.items.length
      ? `<ol class="session-list">${result.items
          .map((s) => {
            const minutes = s.endedAt
              ? (new Date(s.endedAt) - new Date(s.startedAt)) / 60000
              : (Date.now() - new Date(s.startedAt)) / 60000;
            return `<li class="session-row metal ${s.active ? "active" : ""}"><div class="session-thumb ${s.mapKind === "tileset" ? "tileset" : "cartographic"}" aria-hidden="true"></div><div class="session-info"><h3><a href="#session/${esc(s.id)}">${esc(sessionLabel(s.number, s.title))}</a></h3><p class="session-chapter">${s.chapterTitle ? `<span class="status-chip">❖ ${esc(s.chapterTitle)}</span>` : '<span class="status-chip quiet">Avulsa</span>'}</p><p>${new Date(s.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })} · ${formatDuration(minutes)} · ${s.eventCount} eventos · ${s.noteCount} ${s.noteCount === 1 ? "nota" : "notas"} · ${s.participantCount} ${s.participantCount === 1 ? "aventureiro" : "aventureiros"}</p></div><div class="session-row-actions">${s.active ? '<span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>Em andamento</span>' : '<span class="status-chip">◉ Encerrada</span>'}<a class="button subtle small" href="#session/${esc(s.id)}/timeline">◷ Histórico</a><a class="button subtle small" href="#session/${esc(s.id)}/notes">✎ Notas</a>${button(s.recapPublished ? "Resumo publicado" : "✍ Resumo", "cp-recap", s.id, "subtle small")}${d.archived ? "" : button("❖ Capítulo", "cp-session-chapter", s.id, "subtle small", `aria-label="Mudar o capítulo de ${esc(sessionLabel(s.number, s.title))}"`)}</div></li>`;
          })
          .join("")}</ol>${pagination(result)}`
      : '<p class="muted small">Nenhuma sessão jogada aqui ainda. Ao iniciar a primeira, ela aparece nesta lista.</p>'
  }`;
}

function pagination(r) {
  if (r.total <= r.pageSize) return "";
  const pages = Math.ceil(r.total / r.pageSize);
  return `<div class="pagination">${button("← Mais recentes", "cp-page", r.page - 1, "subtle", r.page === 1 ? "disabled" : "")}<span>Página ${r.page} de ${pages}</span>${button("Anteriores →", "cp-page", r.page + 1, "subtle", r.page >= pages ? "disabled" : "")}</div>`;
}

async function startSessionModal(campaignId) {
  const [maps, list, chapters, chapterUi] = await Promise.all([
    api(`/campaigns/${campaignId}/maps`),
    api(`/campaigns/${campaignId}/sessions?page=1`),
    api(`/campaigns/${campaignId}/chapters`),
    import("./campaign-chapters.js"),
  ]);
  // Sugere o capítulo da sessão mais recente; sem capítulos, sugere criar o primeiro (sessão avulsa continua possível).
  const lastChapter = list.items[0] ? list.items[0].chapterId || "" : chapters.items.at(-1)?.id;
  const past = await api(`/campaigns/${campaignId}/workspace/past-sessions?page=1`);
  const next = Math.max(state.campaign?.firstSessionNumber || 1, (list.items[0]?.number || 0) + 1, (past.items[0]?.number || 0) + 1);
  const choices = maps.items;
  const firstTileset = choices.find((m) => m.kind === "tileset") || choices[0];
  modal(
    "✦ Iniciar nova sessão",
    `<p class="modal-lead">A campanha ficará online para os aventureiros convidados.</p><form id="start-session"><div class="field"><div class="field-label"><label for="f-title">Nome da sessão</label>${helpButton("sessoes.abertura.unica", "Uma sessão ativa")}</div><div class="title-field"><span aria-hidden="true">Sessão ${String(next).padStart(2, "0")} —</span><input id="f-title" name="title" required maxlength="120" placeholder="A Cripta dos Antigos" aria-describedby="title-help"></div><small id="title-help" class="form-help">O número da sessão é atribuído automaticamente.</small></div><div class="field"><label for="f-objective">Objetivo / nota inicial do mestre</label><textarea id="f-objective" name="objective" maxlength="2000" rows="3" placeholder="Visível apenas para você no histórico da sessão."></textarea></div>${chapterUi.chapterPicker(chapters.items, lastChapter, { allowNew: true, idPrefix: "f-chapter" })}${mapChoices(choices, firstTileset?.key, "Mapa inicial da sessão")}<p class="notice-box">✧ Ao confirmar, a sessão será aberta e a campanha mudará para <strong>ONLINE</strong>. Os jogadores entrarão diretamente na mesa.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">▶ Iniciar sessão</button></div></form>`,
  );
  $("#modal").classList.add("wide");
  mountMapChoices($("#start-session"), choices);
  chapterUi.mountChapterPicker($("#start-session"));
  const resolveChapter = chapterUi.chapterResolver(campaignId);
  $("#f-title").focus();
  $("#start-session").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const [mapKind, mapKey] = String(data.map || "").split("|");
      await api(`/campaigns/${campaignId}/sessions`, "POST", {
        title: data.title,
        objective: data.objective,
        mapKind,
        mapKey,
        chapterId: await resolveChapter(data),
      });
      $("#modal").close();
      toast("A campanha está online. Bem-vindo à mesa, mestre.");
      navigate("table/" + campaignId);
    });
  };
}

function resourceModal(campaignId) {
  modal(
    "Prepare a sua narrativa",
    `<form id="resource-form"><div class="field"><label for="f-kind">Tipo de recurso</label><select id="f-kind" name="kind"><option value="npc">NPC</option><option value="encontro">Encontro</option><option value="mapa">Mapa (URL de imagem HTTPS)</option><option value="nota">Nota narrativa</option></select></div><div class="field"><label for="f-rname">Nome</label><input id="f-rname" name="name" required maxlength="120"></div><div class="field"><label for="f-content">Descrição, anotações ou URL do mapa</label><textarea id="f-content" name="content" maxlength="10000" rows="4"></textarea></div><label class="check"><input type="checkbox" name="shared"> Compartilhar com os jogadores</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Guardar recurso</button></div></form>`,
  );
  $("#resource-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(`/campaigns/${campaignId}/resources`, "POST", {
        ...data,
        shared: data.shared === "on",
      });
      $("#modal").close();
      toast("Recurso guardado.");
      await renderCampaignPage(campaignId, "resources");
    });
  };
}

async function linkModal(campaignId) {
  const mine = await api("/characters");
  if (!mine.length) {
    toast("Crie uma ficha em Personagens para vinculá-la.");
    return;
  }
  modal(
    "Leve seu herói à aventura",
    `<form id="link-form"><div class="field"><label for="f-char">Sua ficha</label><select id="f-char" name="characterId">${mine.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · Nv. ${c.level}</option>`).join("")}</select></div><p class="form-help">Nome, arquétipo, nível e vida ficam visíveis para o grupo. O mestre pode abrir a ficha completa durante a sessão.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Vincular ficha</button></div></form>`,
  );
  $("#link-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(
        `/campaigns/${campaignId}/characters/${data.characterId}`,
        "POST",
      );
      $("#modal").close();
      toast("Ficha vinculada à campanha.");
      await renderCampaignPage(campaignId, "players");
    });
  };
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action^='cp-']");
  if (!b || !location.hash.startsWith("#campaign/")) return;
  const d = state.campaign;
  const { action, id } = b.dataset;
  const reload = (tab) => renderCampaignPage(d.id, tab);
  try {
    if (action === "cp-start" && d?.isMaster) await startSessionModal(d.id);
    if (action === "cp-premise" && d) {
      modal(`Premissa — ${d.name}`, `<div class="workspace-prose premise-full">${esc(d.description || "")}</div><div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}</div>`);
      $("#modal").classList.add("wide");
    }
    if (action === "cp-session-chapter" && d?.isMaster) {
      const sess = lastSessions.find((x) => x.id === id);
      if (sess) await (await import("./campaign-chapters.js")).moveSessionModal(d, { id: sess.id, chapterId: sess.chapterId, label: sessionLabel(sess.number, sess.title) }, () => refreshChapters(d));
    }
    if (action === "cp-page") {
      page = Math.max(1, Number(id));
      const host = $("#cp-sessions");
      if (host) await renderSessions(d, host);
    }
    if (action === "cp-copy") {
      await navigator.clipboard.writeText(id);
      toast("Convite copiado.");
    }
    if (action === "cp-resource" && d?.isMaster) resourceModal(d.id);
    if (action === "cp-resource-delete" && d?.isMaster && isGuid(id)) {
      await api(`/campaigns/${d.id}/resources/${id}`, "DELETE");
      toast("Recurso excluído.");
      await reload("resources");
    }
    if (action === "cp-link") await linkModal(d.id);
    if (action === "cp-remove" && d?.isMaster) {
      const member = d.members.find((m) => m.id === id);
      modal(
        "Remover jogador?",
        `<p><strong>${esc(member?.name)}</strong> perderá o acesso à campanha e à mesa. As fichas pessoais são preservadas.</p><form id="remove-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Remover jogador</button></div></form>`,
      );
      $("#remove-form").onsubmit = (ev) => {
        ev.preventDefault();
        submitForm(ev.currentTarget, async () => {
          await api(
            `/campaigns/${d.id}/members/${encodeURIComponent(id)}`,
            "DELETE",
          );
          $("#modal").close();
          toast("Acesso do jogador removido.");
          await reload("players");
        });
      };
    }
    if (action === "cp-edit" && d?.isMaster)
      campaignForm(d, () => reload("settings"));
    if (action === "cp-archive" && d?.isMaster && confirm("Arquivar a campanha? O histórico fica guardado e novas partidas ficam bloqueadas até restaurar.")) {
      await api(`/campaigns/${d.id}/archive`, "POST"); toast("Campanha arquivada."); await reload("settings");
    }
    if (action === "cp-restore" && d?.isMaster) { await api(`/campaigns/${d.id}/restore`, "POST"); toast("Campanha restaurada."); await reload("settings"); }
    if (action === "cp-convert" && d?.isMaster && confirm("Converter esta one-shot em campanha persistente? Ela passa a usar uma vaga de campanha sua; jogadores sem vaga deixam a mesa e podem voltar pelo convite.")) {
      const r = await api(`/campaigns/${d.id}/convert`, "POST");
      toast(r.removed ? `Campanha criada. ${r.removed} jogador(es) sem vaga ficaram de fora.` : "Campanha criada. Tudo foi preservado.");
      navigate(`campaign/${d.id}`);
    }
    if (action === "cp-template-new" && d?.isMaster) (await import("./campaign-prep.js")).privateTemplateModal(d, null, () => reload("settings"));
    if (action === "cp-template-edit" && d?.isMaster) {
      const list = await api(`/campaigns/${d.id}/private-templates`);
      (await import("./campaign-prep.js")).privateTemplateModal(d, list.items.find((t) => t.id === id), () => reload("settings"));
    }
    if (action === "cp-recap" && d?.isMaster) {
      const sess = lastSessions.find((x) => x.id === id);
      if (sess) (await import("./campaign-prep.js")).recapModal({ id: sess.id, number: sess.number, recap: sess.recap, published: sess.recapPublished }, () => reload("journal"));
    }
    if (action === "cp-delete" && d?.isMaster && !d.members.length)
      confirmCampaign({ id: d.id, name: d.name }, false, () =>
        navigate("campaigns"),
      );
  } catch (error) {
    toast(error.message);
  }
});

async function templateSettings(campaign, target) {
  const [templates, current, own] = await Promise.all([api(`/sheet-templates?systemId=${campaign.rpgSystemId}`), api(`/campaigns/${campaign.id}/sheet-template`), api(`/campaigns/${campaign.id}/private-templates`)]);
  if (!target.isConnected) return;
  const section = document.createElement("section"); section.className = "metal cs-template-settings";
  section.innerHTML = `<h3>Ficha-modelo da campanha${helpButton("campanhas.config.modelo", "Ficha-modelo da campanha")}</h3><p>Novas fichas usam ${esc(current.template.name)}. Alterar esta escolha preserva as fichas existentes e suas versões.</p><form id="cp-template-form"><div class="field"><label for="cp-template">Modelo das novas fichas</label><select id="cp-template" name="templateId"><option value="">Usar o padrão do sistema</option>${templates.map(t => `<option value="${esc(t.id)}" ${campaign.sheetTemplateId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}${own.items.length ? `<optgroup label="Modelos desta campanha">${own.items.map(t => `<option value="${esc(t.id)}" ${campaign.sheetTemplateId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</optgroup>` : ""}</select></div>${formError()}<button type="submit" class="primary">Salvar modelo da campanha</button></form><h4>Modelos simples desta campanha</h4><p class="muted small">Campos de texto, número, seleção e marcação; recursos como estresse ou munição; ações com fórmula opcional. Não entram no catálogo público.</p>${own.items.length ? `<ul class="plain-list">${own.items.map(t => `<li>${esc(t.name)} <small>v${t.version?.number ?? 1}${t.inUse ? " · em uso" : ""}</small> ${button("Editar", "cp-template-edit", t.id, "text-button small")}</li>`).join("")}</ul>` : ""}${campaign.archived ? "" : button("+ Criar modelo simples", "cp-template-new", "", "subtle small")}`;
  target.append(section);
  section.querySelector("form").onsubmit = event => {
    event.preventDefault(); submitForm(event.currentTarget, async data => {
      await api(`/campaigns/${campaign.id}/sheet-template`, "PUT", { templateId: data.templateId || null, revision: campaign.revision });
      toast("Modelo da campanha atualizado."); await renderCampaignPage(campaign.id, "settings");
    });
  };
}
