import { helpButton } from "./help.js";
// Suporte: chamados do usuário (#support, #support/{id}) e fila da equipe (renderAdminTickets, usada em #admin/tickets).
// Regras puras e rótulos ficam em support-policy.js; o servidor reaplica todas as permissões.
import { api } from "./api.js";
import { shell } from "./layout.js";
import { $, esc, button, field, formError, submitForm, modal, toast, empty, formatDate } from "./ui.js";
import { guardAvatars } from "./sheet.js";
import * as P from "./support-policy.js";

const mine = { status: "", page: 1 };
const filters = { status: "active", priority: "", category: "", assigned: "any", q: "", page: 1 };
let userGeneration = 0,
  adminGeneration = 0;

// ---------- Peças compartilhadas ----------

const chip = (status, staff = false) =>
  `<span class="status-chip ${P.statusTone(status)}" data-tip="${esc(P.statusLabel(status, staff))}">${esc(P.statusLabel(status, staff))}</span>`;
const priorityChip = (priority) =>
  `<span class="status-chip ${P.priorityTone(priority)}" data-tip="Prioridade definida pela equipe administrativa"><span class="sr-only">Prioridade </span>${esc(P.priorityLabel(priority))}</span>`;
const loadingBlock = (text) => `<p class="support-loading" role="status">${esc(text)}</p>`;
const failure = (message, action, title = "Não foi possível carregar.") =>
  `<div class="empty support-error" role="alert"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>${esc(title)}</h3><p>${esc(message)}</p>${action ? button("Tentar novamente", action, "", "subtle") : ""}</div>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const options = (values, label, selected, first = "") =>
  first +
  values
    .map((v) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(label(v))}</option>`)
    .join("");

function messageItem(m, { staffView }) {
  const role = m.fromStaff ? (staffView ? "Equipe" : "Equipe Eternnus") : staffView ? "Solicitante" : m.mine ? "Você" : "Solicitante";
  const internal = staffView && m.internal;
  return `<li class="support-msg ${m.fromStaff ? "from-staff" : "from-user"}${internal ? " is-internal" : ""}"><img class="avatar" src="${esc(P.safeAvatar(m.author?.avatarUrl))}" alt="" referrerpolicy="no-referrer"><div class="support-bubble"><header><strong>${esc(m.author?.name || "Aventureiro")}</strong><span class="support-role">${role}</span>${internal ? '<span class="support-internal-label">Interna — invisível ao usuário</span>' : ""}<time datetime="${esc(m.createdAt)}">${formatDate(m.createdAt)}</time></header><div class="support-body">${esc(m.body)}</div></div></li>`;
}

function pagination(total, page, action) {
  const pages = P.pageCount(total);
  if (pages <= 1) return "";
  return `${button("← Anterior", action, page - 1, "subtle", page <= 1 ? "disabled" : "")}<span>Página ${page} de ${pages}</span>${button("Próxima →", action, page + 1, "subtle", page >= pages ? "disabled" : "")}`;
}

// ---------- Usuário ----------

export async function renderSupport(segments = []) {
  shell("support");
  const main = $("#main");
  const controller = new AbortController();
  main.addEventListener("click", onUserClick, { signal: controller.signal });
  const id = P.ticketFromSegments(segments);
  if (id) await showTicket(id);
  else await showList();
  return () => {
    controller.abort();
    userGeneration++;
  };
}

async function onUserClick(event) {
  const b = event.target.closest("[data-action]");
  if (!b || !b.dataset.action.startsWith("sup-")) return;
  const { action, id } = b.dataset;
  if (action === "sup-new") openNewTicket();
  if (action === "sup-retry") await showList();
  if (action === "sup-page") {
    mine.page = Math.max(1, Number(id) || 1);
    await loadList();
  }
  if (action === "sup-ticket-retry" && P.isGuid(id)) await showTicket(id);
  if (action === "sup-close" && P.isGuid(id)) confirmClose(id);
  if (action === "sup-reopen" && P.isGuid(id)) {
    b.disabled = true;
    try {
      await api(`/support/tickets/${id}/reopen`, "POST");
      toast("Chamado reaberto. A equipe será avisada pela fila.");
      await showTicket(id);
    } catch (e) {
      b.disabled = false;
      toast(e.message);
    }
  }
}

async function showList() {
  const main = $("#main");
  main.innerHTML = `<div class="page-heading"><div><span class="eyebrow">CENTRAL DE SUPORTE</span><h1>Meus chamados ${helpButton("suporte.chamados.categorias", "Categorias e acompanhamento")}<span class="heading-gem">✦</span></h1><p>Fale com a equipe Eternnus sobre conta, erros, campanhas, fichas ou sugestões.</p></div><div class="support-new">${button("+ Abrir chamado", "sup-new", "", "primary", 'id="sup-new" aria-describedby="sup-limit"')}<small id="sup-limit" class="muted small"></small>${helpButton("suporte.chamados.limite", "Limite de chamados")}</div></div><div class="support-toolbar"><div class="sort-field"><label for="sup-status">Mostrar</label><select id="sup-status">${options(P.STATUSES, (s) => P.statusLabel(s), mine.status, `<option value=""${mine.status === "" ? " selected" : ""}>Todos</option><option value="active"${mine.status === "active" ? " selected" : ""}>Em aberto</option>`)}</select></div><span id="sup-count" class="muted small" aria-live="polite"></span></div><ul id="sup-list" class="support-list" aria-busy="true"><li>${loadingBlock("Carregando seus chamados…")}</li></ul><div id="sup-pages" class="pagination"></div>`;
  $("#sup-status").onchange = (e) => {
    mine.status = e.target.value;
    mine.page = 1;
    loadList();
  };
  await loadList();
}

async function loadList() {
  const request = ++userGeneration;
  const list = $("#sup-list");
  if (!list) return;
  list.setAttribute("aria-busy", "true");
  let data;
  try {
    data = await api("/support/tickets?" + P.myQuery(mine));
  } catch (e) {
    if (request !== userGeneration || !$("#sup-list")) return;
    list.removeAttribute("aria-busy");
    list.innerHTML = `<li>${failure(e.message, "sup-retry")}</li>`;
    $("#sup-pages").innerHTML = "";
    return;
  }
  if (request !== userGeneration || !$("#sup-list")) return;
  list.removeAttribute("aria-busy");
  const canOpen = P.canOpenTicket(data.openCount);
  const newButton = $("#sup-new");
  newButton.disabled = !canOpen;
  if (!canOpen) newButton.setAttribute("aria-describedby", "sup-limit");
  else newButton.removeAttribute("aria-describedby");
  $("#sup-limit").textContent = canOpen
    ? ""
    : `Você tem ${data.openCount} chamados em aberto (limite ${data.maxOpen}). Feche ou aguarde a resolução de um deles.`;
  $("#sup-count").textContent = plural(data.total, "chamado", "chamados");
  const items = data.items.filter((t) => P.isGuid(t.id));
  list.innerHTML = items.length
    ? items.map(ticketRow).join("")
    : `<li>${
        mine.status
          ? empty("Nenhum chamado neste filtro.", "Escolha “Todos” para ver o histórico completo.")
          : empty(
              "Nenhum chamado por aqui.",
              "Se algo não estiver funcionando ou você tiver uma dúvida, abra um chamado. A equipe responde nesta página.",
              canOpen ? "sup-new" : "",
              "+ Abrir chamado",
            )
      }</li>`;
  $("#sup-pages").innerHTML = pagination(data.total, data.page, "sup-page");
}

function ticketRow(t) {
  const flag =
    t.status === "waiting_user" && t.lastFromStaff
      ? '<span class="support-flag">✉ Nova resposta da equipe</span>'
      : "";
  return `<li><a class="support-row metal" href="#support/${esc(t.id)}"><span class="support-number">#${Number(t.number)}</span><span class="support-row-main"><strong>${esc(t.subject)}</strong><span class="support-meta"><span>${esc(P.categoryLabel(t.category))}</span><span>◷ Atualizado em ${formatDate(t.updatedAt)}</span><span>${plural(Number(t.messageCount) || 0, "mensagem", "mensagens")}</span></span></span><span class="support-row-status">${chip(t.status)}${flag}</span></a></li>`;
}

function openNewTicket() {
  modal(
    "Abrir chamado",
    `<p class="muted small">Conte o que aconteceu. A equipe responde por aqui e você acompanha em “Meus chamados”. Nunca envie sua senha.</p><form id="sup-form" novalidate>${field("subject", "Assunto", "", "text", 'required minlength="3" maxlength="120" autocomplete="off"')}<div class="field"><label for="f-category">Categoria</label><select id="f-category" name="category" required>${options(P.CATEGORIES, P.categoryLabel, "", '<option value="">Escolha uma categoria…</option>')}</select></div><div class="field"><label for="f-body">Descrição</label><textarea id="f-body" name="body" required minlength="10" maxlength="5000" rows="6" aria-describedby="f-body-hint"></textarea><small id="f-body-hint" class="muted small">De 10 a 5.000 caracteres. Inclua o que você tentou fazer e o que apareceu na tela.</small></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Enviar chamado</button></div></form>`,
  );
  $("#sup-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const problem = P.validateTicket(data);
      if (problem) throw new Error(problem);
      const created = await api("/support/tickets", "POST", data);
      $("#modal").close();
      toast(`Chamado #${Number(created.number)} aberto. Acompanhe a resposta por aqui.`);
      if (P.isGuid(created.id)) location.hash = "support/" + created.id;
    });
  };
  $("#f-subject").focus();
}

async function showTicket(id) {
  const request = ++userGeneration;
  const main = $("#main");
  main.innerHTML = `<a class="text-button support-back" href="#support">← Meus chamados</a><div id="sup-ticket" aria-busy="true">${loadingBlock("Carregando o chamado…")}</div>`;
  let t;
  try {
    t = await api("/support/tickets/" + id);
  } catch (e) {
    if (request !== userGeneration || !$("#sup-ticket")) return;
    $("#sup-ticket").removeAttribute("aria-busy");
    $("#sup-ticket").innerHTML =
      e.status === 404
        ? empty("Chamado não encontrado.", "Confira o link. Você só vê os chamados abertos pela sua conta.")
        : failure(e.message, "") + `<p class="support-center">${button("Tentar novamente", "sup-ticket-retry", id, "subtle")}</p>`;
    return;
  }
  if (request !== userGeneration || !$("#sup-ticket")) return;
  renderUserTicket(t);
}

function renderUserTicket(t) {
  const target = $("#sup-ticket");
  target.removeAttribute("aria-busy");
  const actions = [
    t.canReopen ? button("↺ Reabrir chamado", "sup-reopen", t.id, "subtle") : "",
    t.canClose ? button("Fechar chamado", "sup-close", t.id, "subtle") : "",
  ].join("");
  const reply = t.canReply
    ? `<form id="sup-reply" class="support-reply metal" novalidate><div class="field"><label for="f-reply">Sua resposta</label><textarea id="f-reply" name="body" rows="4" maxlength="5000" required${t.status === "resolved" ? ' aria-describedby="f-reply-hint"' : ""}></textarea>${t.status === "resolved" ? '<small id="f-reply-hint" class="muted small">Responder reabre o chamado.</small>' : ""}</div>${formError()}<div class="form-actions"><button type="submit" class="primary">Enviar resposta</button></div></form>`
    : `<p class="support-closed notice">${esc(P.statusHint(t.status, t.canReopen))}</p>`;
  target.innerHTML = `<div class="page-heading support-heading"><div><span class="eyebrow">CHAMADO #${Number(t.number)} · ${esc(P.categoryLabel(t.category).toUpperCase())}</span><h1 tabindex="-1" id="sup-title">${esc(t.subject)}</h1><p class="support-status-line">${chip(t.status)}<span>Aberto em ${formatDate(t.createdAt)}</span>${t.closedAt ? `<span>Concluído em ${formatDate(t.closedAt)}</span>` : ""}</p></div><div class="support-actions">${actions}</div></div>${t.canReply ? `<p class="support-hint">${esc(P.statusHint(t.status, t.canReopen))}</p>` : ""}<ol class="support-thread" aria-label="Conversa do chamado">${t.messages.map((m) => messageItem(m, { staffView: false })).join("")}</ol>${reply}`;
  guardAvatars(target);
  const form = $("#sup-reply");
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (data) => {
        const problem = P.validateReply(data.body);
        if (problem) throw new Error(problem);
        await api(`/support/tickets/${t.id}/messages`, "POST", { body: data.body });
        toast("Resposta enviada.");
        await showTicket(t.id);
        $("#f-reply")?.focus();
      });
    };
}

function confirmClose(id) {
  modal(
    "Fechar este chamado?",
    `<p>Use quando o problema estiver resolvido ou você não precisar mais de ajuda.</p><p class="muted small">Você poderá reabri-lo em até ${P.REOPEN_DAYS} dias. Depois disso, será preciso abrir um novo chamado.</p><form id="sup-close-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="primary">Fechar chamado</button></div></form>`,
  );
  $("#sup-close-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      await api(`/support/tickets/${id}/close`, "POST");
      $("#modal").close();
      toast("Chamado fechado.");
      await showTicket(id);
    });
  };
}

// ---------- Equipe (admin) ----------

/**
 * Renderiza a fila (segments vazio) ou um chamado (segments[0] = GUID) dentro de `container`.
 * Não chama shell(): o painel admin (#admin/tickets) é dono do layout. Devolve função de descarte.
 */
export async function renderAdminTickets(container, segments = []) {
  const controller = new AbortController();
  const ctx = { root: container, signal: controller.signal };
  container.addEventListener("click", (event) => onAdminClick(event, ctx), { signal: controller.signal });
  const id = P.ticketFromSegments(segments);
  if (id) await showAdminTicket(ctx, id);
  else await showQueue(ctx);
  return () => {
    controller.abort();
    adminGeneration++;
  };
}

const q = (ctx, selector) => ctx.root.querySelector(selector);

async function onAdminClick(event, ctx) {
  const b = event.target.closest("[data-action]");
  if (!b || !b.dataset.action.startsWith("adm-t-") || !ctx.root.contains(b)) return;
  const { action, id } = b.dataset;
  if (action === "adm-t-retry") await showQueue(ctx);
  if (action === "adm-t-page") {
    filters.page = Math.max(1, Number(id) || 1);
    await loadQueue(ctx);
  }
  if (action === "adm-t-clear") {
    Object.assign(filters, { status: "active", priority: "", category: "", assigned: "any", q: "", page: 1 });
    await showQueue(ctx);
  }
  if (action === "adm-t-reload" && P.isGuid(id)) await showAdminTicket(ctx, id);
}

async function showQueue(ctx) {
  const assigned = [
    ["any", "Qualquer responsável"],
    ["me", "Atribuídos a mim"],
    ["none", "Sem responsável"],
  ];
  ctx.root.innerHTML = `<div class="section-title support-admin-title"><h2>Chamados de suporte</h2><span>FILA DA EQUIPE</span></div><div class="stat-grid support-stats" id="adm-t-stats" aria-live="polite"></div><form id="adm-t-filters" class="support-filters" role="search" aria-label="Filtrar chamados"><div class="field"><label for="adm-t-status">Status</label><select id="adm-t-status" name="status">${options(P.STATUSES, (s) => P.statusLabel(s, true), filters.status, `<option value="active"${filters.status === "active" ? " selected" : ""}>Ativos</option><option value=""${filters.status === "" ? " selected" : ""}>Todos</option>`)}</select></div><div class="field"><label for="adm-t-priority">Prioridade</label><select id="adm-t-priority" name="priority">${options(P.PRIORITIES, P.priorityLabel, filters.priority, '<option value="">Todas</option>')}</select></div><div class="field"><label for="adm-t-category">Categoria</label><select id="adm-t-category" name="category">${options(P.CATEGORIES, P.categoryLabel, filters.category, '<option value="">Todas</option>')}</select></div><div class="field"><label for="adm-t-assigned">Responsável</label><select id="adm-t-assigned" name="assigned">${assigned.map(([v, l]) => `<option value="${v}"${filters.assigned === v ? " selected" : ""}>${l}</option>`).join("")}</select></div><div class="field support-search"><label for="adm-t-q">Busca</label><input id="adm-t-q" name="q" type="search" maxlength="100" placeholder="Nº ou assunto" value="${esc(filters.q)}"></div><div class="support-filter-actions"><button type="submit" class="primary">Filtrar</button>${button("Limpar", "adm-t-clear", "", "subtle")}</div></form><p id="adm-t-count" class="muted small" aria-live="polite"></p><div id="adm-t-list" aria-busy="true">${loadingBlock("Carregando a fila…")}</div><div id="adm-t-pages" class="pagination"></div>`;
  q(ctx, "#adm-t-filters").addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget));
      Object.assign(filters, { ...data, q: String(data.q || "").trim(), page: 1 });
      loadQueue(ctx);
    },
    { signal: ctx.signal },
  );
  await loadQueue(ctx);
}

async function loadQueue(ctx) {
  const request = ++adminGeneration;
  const list = q(ctx, "#adm-t-list");
  if (!list) return;
  list.setAttribute("aria-busy", "true");
  let data;
  try {
    data = await api("/admin/tickets?" + P.queueQuery(filters));
  } catch (e) {
    if (request !== adminGeneration || !ctx.root.isConnected) return;
    list.removeAttribute("aria-busy");
    list.innerHTML =
      e.status === 403
        ? failure("Somente administradores atendem chamados.", "", "Acesso indisponível.")
        : failure(e.message, "adm-t-retry");
    q(ctx, "#adm-t-pages").innerHTML = "";
    return;
  }
  if (request !== adminGeneration || !ctx.root.isConnected) return;
  list.removeAttribute("aria-busy");
  const c = data.counts || {};
  q(ctx, "#adm-t-stats").innerHTML = [
    [c.open, "Abertos"],
    [c.in_progress, "Em andamento"],
    [c.waiting_user, "Aguardando usuário"],
    [data.mine, "Atribuídos a mim (ativos)"],
  ]
    .map(([n, label]) => `<div class="stat-tile"><strong>${Number(n) || 0}</strong><span>${label}</span></div>`)
    .join("");
  q(ctx, "#adm-t-count").textContent = plural(data.total, "chamado encontrado", "chamados encontrados");
  const items = data.items.filter((t) => P.isGuid(t.id));
  list.innerHTML = items.length
    ? `<div class="data-table-wrap"><table class="data-table support-queue"><caption class="sr-only">Chamados de suporte, por prioridade e atualização</caption><thead><tr><th scope="col">Nº</th><th scope="col">Assunto</th><th scope="col">Solicitante</th><th scope="col">Categoria</th><th scope="col">Prioridade</th><th scope="col">Status</th><th scope="col">Responsável</th><th scope="col">Atualizado</th></tr></thead><tbody>${items.map(queueRow).join("")}</tbody></table></div>`
    : empty(
        "Nenhum chamado neste filtro.",
        filters.status === "active" && !filters.q && !filters.priority && !filters.category && filters.assigned === "any"
          ? "A fila está em dia. Novos chamados aparecem aqui."
          : "Ajuste os filtros ou use “Limpar” para ver a fila padrão.",
      );
  q(ctx, "#adm-t-pages").innerHTML = pagination(data.total, data.page, "adm-t-page");
}

function queueRow(t) {
  return `<tr><td class="num">#${Number(t.number)}</td><td class="support-subject"><a href="#admin/tickets/${esc(t.id)}">${esc(t.subject)}</a><small>${plural(Number(t.messageCount) || 0, "mensagem", "mensagens")}</small></td><td>${esc(t.author?.name || "—")}</td><td>${esc(P.categoryLabel(t.category))}</td><td>${priorityChip(t.priority)}</td><td>${chip(t.status, true)}</td><td>${t.assignee ? esc(t.assignee.name || "—") : '<span class="muted">Ninguém</span>'}</td><td><time datetime="${esc(t.updatedAt)}">${formatDate(t.updatedAt)}</time></td></tr>`;
}

async function showAdminTicket(ctx, id) {
  const request = ++adminGeneration;
  ctx.root.innerHTML = `<a class="text-button support-back" href="#admin/tickets">← Fila de chamados</a><div id="adm-t-ticket" aria-busy="true">${loadingBlock("Carregando o chamado…")}</div>`;
  let t, assignees;
  try {
    [t, assignees] = await Promise.all([api("/admin/tickets/" + id), api("/admin/tickets/assignees")]);
  } catch (e) {
    if (request !== adminGeneration || !ctx.root.isConnected) return;
    const box = q(ctx, "#adm-t-ticket");
    box.removeAttribute("aria-busy");
    box.innerHTML =
      e.status === 404
        ? empty("Chamado não encontrado.", "Ele pode ter sido removido ou o link está incorreto.")
        : failure(e.message, "") + `<p class="support-center">${button("Tentar novamente", "adm-t-reload", id, "subtle")}</p>`;
    return;
  }
  if (request !== adminGeneration || !ctx.root.isConnected) return;
  renderStaffTicket(ctx, t, assignees);
}

function renderStaffTicket(ctx, t, assignees) {
  const box = q(ctx, "#adm-t-ticket");
  box.removeAttribute("aria-busy");
  const people = [...assignees];
  if (t.assignee && !people.some((a) => a.id === t.assignee.id))
    people.unshift({ id: t.assignee.id, name: t.assignee.name + " (sem papel de equipe)", role: "" });
  const names = Object.fromEntries(people.map((a) => [a.id, a.name]));
  const roleName = (role) => (role === "admin" ? "Admin" : role === "ambassador" ? "Embaixador" : "Usuário");
  box.innerHTML = `<div class="support-admin-head"><span class="eyebrow">CHAMADO #${Number(t.number)} · ${esc(P.categoryLabel(t.category).toUpperCase())}</span><h2 id="adm-t-title" tabindex="-1">${esc(t.subject)}</h2><p class="support-status-line">${chip(t.status, true)}${priorityChip(t.priority)}<span>Aberto em ${formatDate(t.createdAt)}</span><span>Atualizado em ${formatDate(t.updatedAt)}</span>${t.closedAt ? `<span>Concluído em ${formatDate(t.closedAt)}</span>` : ""}</p></div><div class="support-admin-grid"><section class="support-admin-thread" aria-label="Conversa e notas internas"><ol class="support-thread">${t.messages.map((m) => messageItem(m, { staffView: true })).join("")}</ol><form id="adm-t-reply" class="support-reply metal" novalidate><div class="field"><label for="adm-t-body">Mensagem</label><textarea id="adm-t-body" name="body" rows="4" maxlength="5000" required aria-describedby="adm-t-reply-hint"></textarea></div><label class="support-check"><input type="checkbox" name="internal" id="adm-t-internal"> Nota interna (invisível ao usuário)</label><small id="adm-t-reply-hint" class="muted small">Resposta ao usuário muda “Aberto” ou “Em andamento” para “Aguardando usuário”. Notas internas não mudam o status.</small>${formError()}<div class="form-actions"><button type="submit" class="primary" id="adm-t-send">Enviar resposta ao usuário</button></div></form></section><aside class="support-admin-side"><section class="card support-card" aria-labelledby="adm-t-req"><h3 id="adm-t-req">Solicitante</h3><p><strong>${esc(t.author.name)}</strong></p><p class="support-email">${esc(t.author.email || "")}</p><p class="muted small">${roleName(t.author.role)} · ${plural(Number(t.authorOtherOpen) || 0, "outro chamado ativo", "outros chamados ativos")}</p></section><form id="adm-t-manage" class="card support-card" aria-labelledby="adm-t-manage-title"><h3 id="adm-t-manage-title">Atendimento</h3><div class="field"><label for="adm-t-set-status">Status</label><select id="adm-t-set-status" name="status">${options(P.STATUSES, (s) => P.statusLabel(s, true), t.status)}</select></div><div class="field"><label for="adm-t-set-priority">Prioridade</label><select id="adm-t-set-priority" name="priority">${options(P.PRIORITIES, P.priorityLabel, t.priority)}</select></div><div class="field"><label for="adm-t-set-assignee">Responsável</label><select id="adm-t-set-assignee" name="assignedToId"><option value="">Ninguém</option>${people.map((a) => `<option value="${esc(a.id)}"${t.assignee?.id === a.id ? " selected" : ""}>${esc(a.name)}${a.role ? ` · ${roleName(a.role)}` : ""}</option>`).join("")}</select></div><ul id="adm-t-preview" class="support-preview" aria-live="polite"></ul>${formError()}<div class="form-actions"><button type="submit" class="primary">Salvar atendimento</button><span id="adm-t-conflict" hidden>${button("Recarregar chamado", "adm-t-reload", t.id, "subtle")}</span></div></form></aside></div>`;
  guardAvatars(box);
  const before = { status: t.status, priority: t.priority, assignedToId: t.assignee?.id || null };
  const manage = q(ctx, "#adm-t-manage");
  const current = () => {
    const data = Object.fromEntries(new FormData(manage));
    return { status: data.status, priority: data.priority, assignedToId: data.assignedToId || null };
  };
  const preview = () => {
    const lines = P.changeSummary(before, current(), names);
    q(ctx, "#adm-t-preview").innerHTML = lines.length
      ? `<li class="muted small">Ao salvar:</li>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}`
      : "";
  };
  manage.addEventListener("change", preview, { signal: ctx.signal });
  manage.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      submitForm(manage, async () => {
        const next = current();
        if (!P.changeSummary(before, next, names).length) throw new Error("Nada mudou. Altere status, prioridade ou responsável.");
        try {
          const updated = await api(`/admin/tickets/${t.id}`, "PUT", { ...next, revision: t.revision });
          toast("Atendimento atualizado.");
          if (ctx.root.isConnected) renderStaffTicket(ctx, updated, assignees);
        } catch (error) {
          if (error.status === 409) q(ctx, "#adm-t-conflict").hidden = false;
          throw error;
        }
      });
    },
    { signal: ctx.signal },
  );
  const reply = q(ctx, "#adm-t-reply");
  const internal = q(ctx, "#adm-t-internal");
  internal.addEventListener(
    "change",
    () => {
      reply.classList.toggle("is-internal", internal.checked);
      q(ctx, "#adm-t-send").textContent = internal.checked ? "Salvar nota interna" : "Enviar resposta ao usuário";
    },
    { signal: ctx.signal },
  );
  reply.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      submitForm(reply, async (data) => {
        const problem = P.validateReply(data.body);
        if (problem) throw new Error(problem);
        const isInternal = internal.checked;
        await api(`/admin/tickets/${t.id}/messages`, "POST", { body: data.body, internal: isInternal });
        toast(isInternal ? "Nota interna salva." : "Resposta enviada ao usuário.");
        await showAdminTicket(ctx, t.id);
        q(ctx, "#adm-t-body")?.focus();
      });
    },
    { signal: ctx.signal },
  );
}
