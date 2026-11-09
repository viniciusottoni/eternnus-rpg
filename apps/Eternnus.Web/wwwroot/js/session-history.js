import { helpButton } from "./help.js";
// Histórico e rastreio de uma sessão (Tela 09). Exclusivo do mestre; a API reaplica a permissão.
import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { $, esc, button, formError, submitForm, toast, empty } from "./ui.js";
import { guardAvatars } from "./sheet.js";
import {
  eventData,
  eventMeta,
  formatDuration,
  sessionLabel,
} from "./session-policy.js";

const TABS = [
  ["summary", "Resumo", ""],
  ["timeline", "Linha do tempo", ""],
  ["notes", "Notas", "note"],
  ["characters", "Personagens", "sheet"],
  ["rolls", "Rolagens", "rolls"],
];
let search = "",
  page = 1,
  generation = 0;
const time = (iso) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

export async function renderHistory(sessionId, tab = "timeline") {
  if (!TABS.some(([k]) => k === tab)) tab = "timeline";
  shell("campaigns");
  const request = ++generation;
  if ($("#main").dataset.session !== sessionId) {
    search = "";
    page = 1;
  }
  $("#main").dataset.session = sessionId;
  $("#main").innerHTML =
    '<p class="loading-line" role="status">Reunindo os registros da sessão…</p>';
  const kind = TABS.find(([k]) => k === tab)[2];
  const query = new URLSearchParams({
    page,
    ...(kind ? { kind } : {}),
    ...(search ? { search } : {}),
  });
  const h = await api(`/sessions/${sessionId}/history?${query}`);
  if (request !== generation) return;
  // A leitura autorizada do histórico é exclusiva do Mestre, inclusive ao abrir a rota diretamente.
  state.campaign = { ...h.campaign, isMaster: true };
  const s = h.session;
  const count = (k) =>
    h.counts
      .filter((c) => (Array.isArray(k) ? k.includes(c.kind) : c.kind === k))
      .reduce((a, c) => a + c.count, 0);
  const notes =
    tab === "notes"
      ? h.events
      : (await api(`/sessions/${sessionId}/history?kind=note`)).events;
  if (request !== generation) return;
  const latestNote = notes.at(-1);
  $("#main").innerHTML =
    `<a class="back-link" href="#campaign/${esc(h.campaign.id)}/sessions">← Sessões de ${esc(h.campaign.name)}</a>
  <header class="history-head"><div><h1>${esc(sessionLabel(s.number, s.title))}</h1><p>${esc(h.campaign.name)} <span aria-hidden="true">•</span> ${new Date(s.startedAt).toLocaleDateString("pt-BR")} <span aria-hidden="true">•</span> Duração: ${formatDuration(s.durationMinutes)} <span aria-hidden="true">•</span> Mapa: ${esc(s.map)}</p></div>${s.active ? `<a class="button primary" href="#table/${esc(h.campaign.id)}"><span class="online-dot" aria-hidden="true"></span> Em andamento · voltar à mesa</a>` : '<span class="status-chip">✓ Sessão encerrada</span>'}</header>
  <nav class="page-tabs" aria-label="Registros da sessão">${TABS.map(([k, label]) => `<a href="#session/${esc(sessionId)}/${k}" ${k === tab ? 'aria-current="page" class="active"' : ""}>${label}</a>`).join("")}</nav>
  <div class="history-grid"><section class="history-main" aria-live="polite">${tab === "summary" ? summary(h, count) : timeline(h, tab)}</section>
  <aside class="history-aside"><article class="metal aside-card"><h2>✎ Notas do mestre</h2>${latestNote ? `<p class="note-text">${esc(latestNote.content)}</p><small class="muted">Registrado às ${time(latestNote.createdAt)} · ${latestNote.masterOnly ? "Visível apenas ao mestre" : "Compartilhado com o grupo"}</small>` : '<p class="muted small">Nenhuma anotação nesta sessão.</p>'}<form id="history-note" class="note-form"><label for="hn-text">Nova anotação${s.active ? "" : " (após o encerramento)"}</label><textarea id="hn-text" name="content" rows="3" maxlength="2000" required></textarea>${formError()}<button type="submit" class="subtle">✎ Registrar nota</button></form></article>
  <article class="metal aside-card"><h2>▤ Alterações da sessão${helpButton("sessoes.historico.alteracoes", "Antes e depois")}</h2><ul class="change-summary"><li><b>${count("sheet")}</b> mudanças em fichas</li><li><b>${count(["roll", "action"])}</b> rolagens e ações</li><li><b>${count("map")}</b> alterações no mapa</li><li><b>${count("note")}</b> notas do mestre</li><li><b>${count("message")}</b> mensagens</li></ul></article>
  <a class="button subtle" href="#campaign/${esc(h.campaign.id)}/sessions">↩ Voltar às sessões</a></aside></div>`;
  guardAvatars($("#main"));
  const form = $("#history-search");
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      search = new FormData(form).get("search").trim();
      page = 1;
      renderHistory(sessionId, tab).catch((error) => toast(error.message));
    };
  $("#history-note").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(`/sessions/${sessionId}/notes`, "POST", {
        content: data.content,
        shared: false,
      });
      toast("Anotação registrada na sessão.");
      await renderHistory(sessionId, tab);
    });
  };
  $("#main").onclick = (e) => {
    const b = e.target.closest("[data-action='h-page']");
    if (!b) return;
    page = Number(b.dataset.id);
    renderHistory(sessionId, tab).catch((error) => toast(error.message));
  };
}

function summary(h, count) {
  const s = h.session;
  return `<article class="metal summary-card"><h2>Objetivo do mestre</h2><p>${esc(s.objective || "Nenhum objetivo registrado.")}</p></article><div class="summary-stats">${[
    ["◷", formatDuration(s.durationMinutes), "de duração"],
    [
      "♙",
      h.participants.length,
      h.participants.length === 1 ? "aventureiro" : "aventureiros",
    ],
    ["⬡", count(["roll", "action"]), "rolagens e ações"],
    ["♜", count("sheet"), "mudanças em fichas"],
  ]
    .map(
      ([i, v, l]) =>
        `<div class="metal stat-tile"><span aria-hidden="true">${i}</span><strong>${esc(v)}</strong><small>${l}</small></div>`,
    )
    .join(
      "",
    )}</div><article class="metal summary-card"><h2>Participantes</h2>${participants(h)}</article>`;
}
function participants(h) {
  return h.participants.length
    ? `<ul class="history-party">${h.participants.map((p) => `<li><img class="avatar" src="${esc(p.avatarUrl)}" alt="" referrerpolicy="no-referrer"><div><strong>${esc(p.name)}</strong><small>${esc(p.player)} · Nv. ${p.level} · Vida atual ${p.hp}/${p.maxHp} · entrou às ${time(p.joinedAt)}</small></div></li>`).join("")}</ul>`
    : '<p class="muted small">Nenhum jogador entrou nesta sessão.</p>';
}

function detail(e) {
  const d = eventData(e);
  if (Array.isArray(d.changes) && d.changes.length)
    return (
      d.changes
        .map(
          (c) => `${esc(c.label)} alterada: ${esc(c.before)} → ${esc(c.after)}`,
        )
        .join(" · ") + (d.reason ? ` · Motivo: ${esc(d.reason)}` : "")
    );
  if (d.roll?.values)
    return `Rolagem ${esc(d.roll.formula)}: [${d.roll.values.map(Number).join(", ")}] ${Number(d.roll.modifier) ? (d.roll.modifier > 0 ? "+" : "") + Number(d.roll.modifier) : ""} = ${Number(d.roll.total)}${d.target ? ` · Alvo: ${esc(d.target)}` : ""}`;
  if (e.kind === "map" && d.from)
    return `${esc(d.from)} → ${esc(d.to)}. Visível a todos os jogadores.`;
  if (e.kind === "move" && d.from)
    return `Coluna ${d.from.x + 1}, linha ${d.from.y + 1} → coluna ${d.to.x + 1}, linha ${d.to.y + 1}`;
  if (e.kind === "note")
    return d.shared
      ? "Compartilhada com o grupo como narração."
      : d.title
        ? esc(d.title)
        : "Visível apenas ao mestre.";
  if (e.kind === "action" && d.description) return esc(d.description);
  return `Por ${esc(e.author)}`;
}

function timeline(h, tab) {
  const head = `<div class="section-title"><h2>${tab === "notes" ? "Notas da sessão" : tab === "characters" ? "Mudanças de fichas" : tab === "rolls" ? "Rolagens e ações" : "Histórico de eventos"} <small>(${h.total} ${h.total === 1 ? "registro" : "registros"})</small></h2><form id="history-search" role="search" class="history-search"><label class="sr-only" for="hs">Buscar evento ou personagem</label><input id="hs" name="search" maxlength="100" value="${esc(search)}" placeholder="⌕ Buscar evento ou personagem"></form></div>`;
  const party =
    tab === "characters"
      ? `<article class="metal summary-card">${participants(h)}</article>`
      : "";
  if (!h.events.length)
    return (
      head +
      party +
      empty(
        search ? "Nenhum registro encontrado." : "Nada registrado aqui ainda.",
        search
          ? "Tente outro termo de busca."
          : "Os acontecimentos da mesa aparecem nesta linha do tempo.",
      )
    );
  const pages = Math.ceil(h.total / h.pageSize);
  return `${head}${party}<ol class="timeline">${h.events
    .map((e) => {
      const [icon, label] = eventMeta(e.kind);
      return `<li class="timeline-item metal ${e.kind}"><time>${time(e.createdAt)}</time><div><h3>${esc(e.content)}</h3><p>${detail(e)}</p></div><span class="timeline-kind" data-tip="${label}" aria-label="${label}">${icon}</span></li>`;
    })
    .join(
      "",
    )}</ol>${pages > 1 ? `<div class="pagination">${button("← Anteriores", "h-page", h.page - 1, "subtle", h.page === 1 ? "disabled" : "")}<span>Página ${h.page} de ${pages}</span>${button("Seguintes →", "h-page", h.page + 1, "subtle", h.page >= pages ? "disabled" : "")}</div>` : ""}`;
}
