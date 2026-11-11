import { helpButton } from "./help.js";
// Painel administrativo (#admin/{aba}/{id}). Somente UX: o servidor reaplica a política Admin em cada endpoint.
// Rotas: #admin, #admin/overview, #admin/users[/{guid}], #admin/campaigns[/{guid}], #admin/systems, #admin/templates/..., #admin/tickets/..., #admin/audit.
import { api } from "./api.js";
import { newsSlot } from "./notices.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { $, esc, button, field, formError, submitForm, modal, toast, navigate } from "./ui.js";
import { isAdmin } from "./policy.js";
import { guardAvatars } from "./sheet.js";

// ---------- Regras puras (testadas em tests/frontend.test.mjs) ----------
export const ADMIN_TABS = Object.freeze([
  ["overview", "Visão geral"],
  ["users", "Usuários"],
  ["campaigns", "Campanhas"],
  ["systems", "Sistemas"],
  ["templates", "Fichas-modelo"],
  ["music", "Músicas"],
  ["tickets", "Tickets"],
  ["audit", "Auditoria"],
]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isAdminGuid = (value) => GUID.test(String(value ?? ""));
export const ROLE_LABELS = Object.freeze({ common: "Comum", ambassador: "Embaixador", admin: "Admin" });
export const roleLabel = (role) => ROLE_LABELS[role] || "Comum";
export const TARGET_LABELS = Object.freeze({
  user: "Usuário",
  campaign: "Campanha",
  system: "Sistema",
  library: "Biblioteca",
  template: "Ficha-modelo",
  guild: "Guilda",
  ticket: "Ticket",
});

/** Rota (#hash sem #) da tela que mostra o alvo de uma entrada de auditoria; nulo quando não há tela segura. */
export function auditLink(targetType, targetId) {
  const type = String(targetType || "");
  const guid = isAdminGuid(targetId);
  if (type === "library") return "library";
  if (type === "template") return guid ? `admin/templates/${targetId}` : "admin/templates";
  if (type === "user") return guid ? `admin/users/${targetId}` : null;
  if (type === "campaign") return guid ? `admin/campaigns/${targetId}` : null;
  if (type === "system") return "admin/systems";
  if (type === "ticket") return guid ? `admin/tickets/${targetId}` : "admin/tickets";
  if (type === "guild" || type.startsWith("guild.")) return "guild";
  return null;
}

/** Espelha RpgSystemService.Slugify: minúsculas, sem acentos, a-z0-9 e hífens simples, até 60 caracteres. */
export function slugify(name) {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60).replace(/-+$/g, "");
}
export const isValidSlug = (slug) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(slug ?? "")) && String(slug).length <= 60;

/** Datas da API: DateTime em UTC ("…Z") ou DateTimeOffset ("…+00:00"). */
export function parseApiDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/(Z|[+-]\d\d:\d\d)$/.test(text) ? text : text + "Z");
  return Number.isNaN(date.getTime()) ? null : date;
}
/** Suspensão "sem fim" é gravada no ano 9999. */
export const isIndefinite = (value) => (parseApiDate(value)?.getUTCFullYear() ?? 0) >= 9000;

/** Fim da suspensão a partir da escolha do formulário; nulo = por tempo indeterminado. */
export function suspensionUntil(choice, date, now = Date.now()) {
  const days = { "1d": 1, "7d": 7, "30d": 30 }[choice];
  if (days) return new Date(now + days * 86400000).toISOString();
  if (choice === "date") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? new Date(date + "T23:59:00") : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined;
  }
  return null;
}

/** Parâmetros de busca sem valores vazios (a ordem das chaves é preservada). */
export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? "?" + text : "";
}

// ---------- Apresentação ----------
const PAGE_SIZE = 15;
let generation = 0;
const filters = {
  users: { q: "", role: "", status: "", page: 1 },
  campaigns: { q: "", systemId: "", online: "", page: 1 },
  audit: { action: "", actor: "", targetType: "", targetId: "", from: "", to: "", page: 1 },
};
const number = (n) => Number(n || 0).toLocaleString("pt-BR");
function when(value, fallback = "—") {
  const date = parseApiDate(value);
  return date ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : fallback;
}
const loading = (text = "Consultando os registros do reino…") => `<p class="loading-line" role="status">${esc(text)}</p>`;
function failure(error, retry = "admin-retry") {
  return `<div class="empty admin-state" role="alert"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>Não foi possível carregar.</h3><p>${esc(error?.message || "Tente novamente em instantes.")}</p>${button("Tentar novamente", retry, "", "primary")}</div>`;
}
function blank(title, text) {
  return `<div class="empty admin-state"><span class="empty-sigil" aria-hidden="true">✧</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}
function roleChip(role) {
  const tone = role === "admin" ? "warn" : role === "ambassador" ? "good" : "quiet";
  return `<span class="status-chip ${tone}" data-tip="Papel global da conta na plataforma">${esc(roleLabel(role))}</span>`;
}
function userStatusChip(u) {
  if (u.suspendedUntil) return `<span class="status-chip bad">Suspenso</span>`;
  if (!u.verified) return `<span class="status-chip quiet">Pendente</span>`;
  return `<span class="status-chip good">Ativo</span>`;
}
const onlineChip = (online) =>
  online ? '<span class="status-chip good">● Online</span>' : '<span class="status-chip quiet">Offline</span>';
function suspendedText(value) {
  return isIndefinite(value) ? "por tempo indeterminado" : "até " + when(value);
}
function avatar(url, name) {
  return `<img class="avatar admin-avatar" src="${esc(url || "/assets/avatar.svg")}" alt="${name ? "Avatar de " + esc(name) : ""}" referrerpolicy="no-referrer" loading="lazy">`;
}
function table(head, rows, caption) {
  return `<div class="data-table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="data-table"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function pager(result, action) {
  if (result.total <= (result.pageSize || PAGE_SIZE)) return "";
  const pages = Math.ceil(result.total / (result.pageSize || PAGE_SIZE));
  return `<nav class="pagination" aria-label="Paginação">${button("← Anterior", action, result.page - 1, "subtle", result.page <= 1 ? "disabled" : "")}<span>Página ${result.page} de ${pages}</span>${button("Próxima →", action, result.page + 1, "subtle", result.page >= pages ? "disabled" : "")}</nav>`;
}
const openLink = (route, label = "Abrir") => (route ? `<a class="button subtle small admin-open" href="#${esc(route)}">${esc(label)}</a>` : "");
function reasonField(required = true) {
  return `<div class="field"><label for="f-reason">Motivo ${required ? "(obrigatório)" : "(opcional)"}</label><textarea id="f-reason" name="reason" rows="3" maxlength="300" ${required ? 'required minlength="3"' : ""} aria-describedby="reason-help"></textarea><small id="reason-help" class="muted small">Fica registrado na auditoria. Não inclua senhas nem dados pessoais.</small></div>`;
}

export async function renderAdmin(segments = []) {
  shell("admin");
  const request = ++generation;
  if (!isAdmin(state.user)) {
    $("#main").innerHTML = blank("Área restrita.", "O painel administrativo é exclusivo de administradores.");
    return;
  }
  let tab = segments[0] || "overview";
  if (!ADMIN_TABS.some(([key]) => key === tab)) tab = "overview";
  const id = segments[1];
  if (id && ["users", "campaigns"].includes(tab) && !isAdminGuid(id)) {
    navigate("admin/" + tab);
    return;
  }
  $("#main").innerHTML = `<div class="page-heading admin-heading"><div><span class="eyebrow">CONSELHO DE ETERNNUS</span><h1>Painel admin <span class="heading-gem">✦</span></h1><p>O que acontece na plataforma, quem está nela e o que foi feito pela equipe.</p></div></div><nav class="page-tabs" aria-label="Seções do painel">${ADMIN_TABS.map(([key, label]) => `<a href="#admin/${key}" ${key === tab ? 'aria-current="page" class="active"' : ""}>${label}${key === "tickets" ? newsSlot("queue", label) : ""}</a>`).join("")}</nav><section id="admin-view" class="admin-page"${tab === "templates" ? "" : ' aria-live="polite"'}></section>`;
  const view = $("#admin-view");
  const alive = () => request === generation && view.isConnected;
  // Fichas-modelo: o mesmo módulo da equipe, montado dentro do painel; devolve ao roteador a função de descarte do editor.
  if (tab === "templates") {
    const { renderTemplates } = await import("./sheet-templates.js");
    if (!alive()) return;
    return renderTemplates(segments.slice(1), { base: "admin/templates", root: view });
  }
  // Catálogo de músicas do servidor: módulo próprio sob demanda; devolve ao roteador o descarte da prévia de áudio.
  if (tab === "music") {
    const { renderMusicCatalog } = await import("./admin-music.js");
    if (!alive()) return;
    return renderMusicCatalog(view);
  }
  const ctx = { view, alive, segments, rerender: () => renderAdmin(segments) };
  view.addEventListener("click", (event) => handleClick(event, ctx));
  if (tab === "tickets") return renderTickets(ctx);
  const renderers = {
    overview: renderOverview,
    users: id ? renderUser : renderUsers,
    campaigns: id ? renderCampaign : renderCampaigns,
    systems: renderSystems,
    audit: renderAudit,
  };
  ctx.id = id;
  await renderers[tab](ctx);
}

async function load(ctx, path, paint) {
  ctx.view.innerHTML = loading();
  try {
    const data = await api(path);
    if (!ctx.alive()) return;
    paint(data);
    guardAvatars(ctx.view);
  } catch (error) {
    if (ctx.alive()) ctx.view.innerHTML = failure(error);
  }
}

// ---------- Visão geral ----------
function trend(current, previous) {
  const diff = Number(current || 0) - Number(previous || 0);
  if (!diff) return "igual aos 7 dias anteriores";
  return `${diff > 0 ? "▲ +" : "▼ "}${number(diff)} vs. 7 dias anteriores`;
}
function tile(value, label, note = "", route = "") {
  const body = `<strong>${number(value)}</strong><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ""}`;
  return route ? `<a class="stat-tile admin-tile-link" href="#${esc(route)}">${body}</a>` : `<div class="stat-tile">${body}</div>`;
}
function auditLine(a) {
  return `<li><div><strong>${esc(a.actorName || "Conta removida")}</strong> <span class="muted">${esc(a.summary || a.action)}</span></div><small>${esc(when(a.createdAt))} · <code>${esc(a.action)}</code></small>${openLink(auditLink(a.targetType, a.targetId))}</li>`;
}
async function renderOverview(ctx) {
  await load(ctx, "/admin/overview", (d) => {
    const u = d.users, c = d.campaigns, k = d.community;
    ctx.view.innerHTML = `<div class="section-title"><h2>Pessoas</h2><span>ATUALIZADO ${esc(when(d.generatedAt))}</span></div><div class="stat-grid">${tile(u.total, "usuários cadastrados", `${number(u.pending)} aguardando confirmação`, "admin/users")}${tile(u.new7d, "novos nos últimos 7 dias", trend(u.new7d, u.newPrevious7d))}${tile(u.active7d, "ativos nos últimos 7 dias")}${tile(u.suspended, "suspensos agora", "", "admin/users")}${tile(u.staff, "na equipe (admin e embaixadores)")}</div>
<div class="section-title"><h2>Campanhas e mesas</h2></div><div class="stat-grid">${tile(c.total, "campanhas", `${number(c.new7d)} criadas em 7 dias`, "admin/campaigns")}${tile(c.online, "mesas online agora", "", "admin/campaigns")}${tile(c.sessions7d, "sessões em 7 dias", trend(c.sessions7d, c.sessionsPrevious7d))}</div>
<div class="section-title"><h2>Comunidade e acervo</h2></div><div class="stat-grid">${tile(k.openTickets, "tickets abertos", "abertos, em andamento ou aguardando", "admin/tickets")}${tile(k.pendingReports, "denúncias da Guilda pendentes", "", "guild")}${tile(k.guildPosts7d, "posts da Guilda em 7 dias", trend(k.guildPosts7d, k.guildPostsPrevious7d))}${tile(k.libraryItems, "itens na biblioteca", "", "library")}${tile(k.publishedTemplates, "fichas-modelo publicadas", "", "admin/templates")}</div>
<div class="admin-columns"><section class="metal admin-panel" aria-labelledby="recent-audit"><div class="admin-panel-head"><h2 id="recent-audit">Últimas ações da equipe</h2><a class="text-button" href="#admin/audit">Ver auditoria →</a></div>${d.recentAudit.length ? `<ul class="admin-feed">${d.recentAudit.map(auditLine).join("")}</ul>` : '<p class="muted small">Nenhuma ação registrada ainda.</p>'}</section><section class="metal admin-panel" aria-labelledby="recent-users"><div class="admin-panel-head"><h2 id="recent-users">Cadastros recentes</h2><a class="text-button" href="#admin/users">Ver usuários →</a></div>${d.recentUsers.length ? `<ul class="admin-people">${d.recentUsers.map((p) => `<li>${avatar(p.avatarUrl, p.name)}<div><strong>${esc(p.name)}</strong><small>${esc(when(p.createdAt))} · ${p.verified ? "confirmado" : "pendente"}</small></div>${roleChip(p.role)}${openLink(isAdminGuid(p.id) ? "admin/users/" + p.id : "")}</li>`).join("")}</ul>` : '<p class="muted small">Ninguém se cadastrou ainda.</p>'}</section></div>`;
  });
}

// ---------- Usuários ----------
async function renderUsers(ctx) {
  const f = filters.users;
  ctx.view.innerHTML = `<form id="admin-users-filter" class="admin-filters" role="search"><div class="field"><label for="f-q">Nome ou e-mail</label><input id="f-q" name="q" maxlength="100" value="${esc(f.q)}" placeholder="Buscar pessoa…"></div><div class="field"><label for="f-role">Papel</label><select id="f-role" name="role"><option value="">Todos</option>${Object.entries(ROLE_LABELS).map(([key, label]) => `<option value="${key}" ${f.role === key ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label for="f-status">Situação</label><select id="f-status" name="status">${[["", "Todas"], ["active", "Ativos"], ["pending", "Pendentes"], ["suspended", "Suspensos"]].map(([key, label]) => `<option value="${key}" ${f.status === key ? "selected" : ""}>${label}</option>`).join("")}</select></div><button type="submit" class="subtle">Buscar</button></form><div id="admin-list"></div>`;
  $("#admin-users-filter").onsubmit = (event) => {
    event.preventDefault();
    Object.assign(f, Object.fromEntries(new FormData(event.currentTarget)), { page: 1 });
    f.q = f.q.trim();
    listUsers(ctx);
  };
  await listUsers(ctx);
}
async function listUsers(ctx) {
  const target = $("#admin-list");
  const f = filters.users;
  target.innerHTML = loading("Buscando aventureiros…");
  try {
    const r = await api("/admin/users" + queryString(f));
    if (!ctx.alive()) return;
    target.innerHTML = `<p class="list-summary" role="status">${number(r.total)} ${r.total === 1 ? "pessoa encontrada" : "pessoas encontradas"}</p>${
      r.items.length
        ? table(
            ["Pessoa", "E-mail", "Papel", "Nível", "Situação", "Último acesso", "Cadastro", '<span class="sr-only">Ações</span>'],
            r.items.map(
              (u) =>
                `<tr><td><span class="admin-person">${avatar(u.avatarUrl, "")}<strong>${esc(u.name)}</strong></span></td><td class="admin-email">${esc(u.email)}</td><td>${roleChip(u.role)}</td><td class="num">${number(u.level)}</td><td>${userStatusChip(u)}</td><td>${esc(when(u.lastSeenAt, "nunca"))}</td><td>${esc(when(u.createdAt))}</td><td>${openLink(isAdminGuid(u.id) ? "admin/users/" + u.id : "", "Gerenciar")}</td></tr>`,
            ),
            "Usuários da plataforma",
          )
        : blank("Ninguém por aqui.", "Nenhuma pessoa corresponde aos filtros. Limpe a busca ou escolha outra situação.")
    }${pager(r, "admin-users-page")}`;
    guardAvatars(target);
  } catch (error) {
    if (ctx.alive()) target.innerHTML = failure(error, "admin-users-retry");
  }
}
async function renderUser(ctx) {
  await load(ctx, "/admin/users/" + ctx.id, (u) => {
    ctx.user = u;
    const suspended = !!u.suspendedUntil;
    const canSuspend = !u.isSelf && u.role !== "admin";
    ctx.view.innerHTML = `<a class="back-link" href="#admin/users">← Usuários</a><section class="metal admin-profile"><div class="admin-profile-id">${avatar(u.avatarUrl, u.name)}<div><h2>${esc(u.name)}${u.isSelf ? ' <span class="badge">VOCÊ</span>' : ""}</h2><p class="admin-email">${esc(u.email)}</p><p>${roleChip(u.role)} ${userStatusChip(u)}${suspended ? ` <span class="muted small">Suspenso ${esc(suspendedText(u.suspendedUntil))}</span>` : ""}</p></div></div><div class="admin-actions">${button("♛ Alterar papel", "admin-role", u.id, "subtle", u.isSelf ? 'disabled aria-describedby="self-note"' : "")}${suspended ? button("↺ Reativar conta", "admin-unsuspend", u.id, "primary") : button("⛔ Suspender", "admin-suspend", u.id, "danger", canSuspend ? "" : 'disabled aria-describedby="suspend-note"')}<small id="self-note" class="muted small">${u.isSelf ? "Você não altera o próprio papel nem se suspende. Peça a outro admin." : ""}</small><small id="suspend-note" class="muted small">${!u.isSelf && u.role === "admin" ? "Admins não podem ser suspensos: rebaixe o papel primeiro." : ""}</small></div></section>
<div class="stat-grid admin-user-stats">${tile(u.level, "nível", `${number(u.xp)} XP`)}${tile(u.stats.campaignsAsMaster, "campanhas como mestre")}${tile(u.stats.campaignsAsMember, "campanhas como jogador")}${tile(u.stats.characters, "personagens")}</div>
<dl class="admin-facts metal"><div><dt>Cadastro</dt><dd>${esc(when(u.createdAt))}</dd></div><div><dt>Último acesso</dt><dd>${esc(when(u.lastSeenAt, "nunca"))}</dd></div><div><dt>E-mail</dt><dd>${u.verified ? "Confirmado" : "Aguardando confirmação"}</dd></div><div><dt>Suspensão</dt><dd>${suspended ? esc(suspendedText(u.suspendedUntil)) : "Nenhuma"}</dd></div></dl>
<div class="section-title"><h2>Histórico administrativo${helpButton("admin.acoes.auditoria", "Motivo e auditoria")}</h2>${button("Ver na auditoria →", "admin-user-audit", u.id, "text-button")}</div>${u.audit.length ? auditTable(u.audit, "Ações administrativas sobre esta conta") : blank("Nenhuma ação registrada.", "Mudanças de papel e suspensões desta conta aparecerão aqui.")}`;
    fillAuditData(ctx.view, u.audit);
  });
}
function roleModal(ctx) {
  const u = ctx.user;
  modal(
    "Alterar papel",
    `<p class="modal-lead">${esc(u.name)} hoje é <strong>${esc(roleLabel(u.role))}</strong>.</p><form id="admin-role-form"><fieldset class="admin-choice"><legend>Novo papel${helpButton("admin.usuarios.papeis", "Papéis da plataforma")}</legend>${Object.entries(ROLE_LABELS)
      .map(([key, label]) => `<label><input type="radio" name="role" value="${key}" ${key === u.role ? "checked" : ""} required> <span><strong>${label}</strong><small>${{ common: "Joga, mestra e participa da Guilda.", ambassador: "Publica na biblioteca e nas fichas-modelo e modera a Guilda (auditado).", admin: "Acesso total ao painel, inclusive papéis e suspensões." }[key]}</small></span></label>`)
      .join("")}</fieldset>${reasonField()}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar papel</button></div></form>`,
  );
  $("#admin-role-form").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      await api(`/admin/users/${u.id}/role`, "PUT", { role: data.role, reason: data.reason.trim() });
      $("#modal").close();
      toast("Papel atualizado e registrado na auditoria.");
      await ctx.rerender();
    });
  };
}
function suspendModal(ctx) {
  const u = ctx.user;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  modal(
    "Suspender conta",
    `<p class="modal-lead"><strong>${esc(u.name)}</strong> será desconectado de todos os dispositivos na hora e não conseguirá entrar até o fim da suspensão.</p><form id="admin-suspend-form"><div class="field"><label for="f-duration">Duração</label><select id="f-duration" name="duration"><option value="1d">24 horas</option><option value="7d" selected>7 dias</option><option value="30d">30 dias</option><option value="date">Até uma data</option><option value="forever">Por tempo indeterminado</option></select></div><div class="field" id="suspend-date" hidden><label for="f-until">Suspenso até (inclusive)</label><input id="f-until" name="until" type="date" min="${tomorrow}"></div>${reasonField()}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger">Suspender conta</button></div></form>`,
  );
  const form = $("#admin-suspend-form");
  const duration = $("#f-duration");
  duration.onchange = () => {
    const custom = duration.value === "date";
    $("#suspend-date").hidden = !custom;
    $("#f-until").required = custom;
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async (data) => {
      const until = suspensionUntil(data.duration, data.until);
      if (until === undefined) throw new Error("Escolha a data de término da suspensão.");
      await api(`/admin/users/${u.id}/suspend`, "POST", { until, reason: data.reason.trim() });
      $("#modal").close();
      toast("Conta suspensa. As sessões abertas foram encerradas.");
      await ctx.rerender();
    });
  };
}
function unsuspendModal(ctx) {
  const u = ctx.user;
  modal(
    "Reativar conta",
    `<p class="modal-lead"><strong>${esc(u.name)}</strong> poderá entrar novamente assim que você confirmar.</p><form id="admin-unsuspend-form">${reasonField(false)}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Reativar conta</button></div></form>`,
  );
  $("#admin-unsuspend-form").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      await api(`/admin/users/${u.id}/unsuspend`, "POST", { reason: data.reason.trim() || null });
      $("#modal").close();
      toast("Conta reativada.");
      await ctx.rerender();
    });
  };
}

// ---------- Campanhas ----------
let systemsCache = null;
async function adminSystems() {
  if (!systemsCache) systemsCache = await api("/admin/rpg-systems", "GET", undefined, { background: true });
  return systemsCache;
}
async function renderCampaigns(ctx) {
  const f = filters.campaigns;
  let systems = [];
  try {
    systems = await adminSystems();
  } catch {
    systems = [];
  }
  if (!ctx.alive()) return;
  ctx.view.innerHTML = `<form id="admin-campaigns-filter" class="admin-filters" role="search"><div class="field"><label for="f-q">Campanha ou mestre</label><input id="f-q" name="q" maxlength="100" value="${esc(f.q)}" placeholder="Nome da campanha ou do mestre…"></div><div class="field"><label for="f-system">Sistema</label><select id="f-system" name="systemId"><option value="">Todos</option>${systems
    .filter((s) => isAdminGuid(s.id))
    .map((s) => `<option value="${s.id}" ${f.systemId === s.id ? "selected" : ""}>${esc(s.name)}${s.active ? "" : " (inativo)"}</option>`)
    .join("")}</select></div><div class="field"><label for="f-online">Mesa</label><select id="f-online" name="online">${[["", "Todas"], ["true", "Online agora"], ["false", "Offline"]].map(([key, label]) => `<option value="${key}" ${f.online === key ? "selected" : ""}>${label}</option>`).join("")}</select></div><button type="submit" class="subtle">Buscar</button></form><div id="admin-list"></div>`;
  $("#admin-campaigns-filter").onsubmit = (event) => {
    event.preventDefault();
    Object.assign(f, Object.fromEntries(new FormData(event.currentTarget)), { page: 1 });
    f.q = f.q.trim();
    listCampaigns(ctx);
  };
  await listCampaigns(ctx);
}
async function listCampaigns(ctx) {
  const target = $("#admin-list");
  target.innerHTML = loading("Percorrendo os mundos…");
  try {
    const r = await api("/admin/campaigns" + queryString(filters.campaigns));
    if (!ctx.alive()) return;
    target.innerHTML = `<p class="list-summary" role="status">${number(r.total)} ${r.total === 1 ? "campanha encontrada" : "campanhas encontradas"}</p>${
      r.items.length
        ? table(
            ["Campanha", "Mestre", "Sistema", "Membros", "Mesa", "Criada", "Última atividade", '<span class="sr-only">Ações</span>'],
            r.items.map(
              (c) =>
                `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.masterName || "—")}</td><td>${esc(c.system)}</td><td class="num">${number(c.memberCount)}</td><td>${onlineChip(c.online)}</td><td>${esc(when(c.createdAt))}</td><td>${esc(when(c.lastActivityAt))}</td><td>${openLink(isAdminGuid(c.id) ? "admin/campaigns/" + c.id : "", "Detalhes")}</td></tr>`,
            ),
            "Campanhas da plataforma",
          )
        : blank("Nenhuma campanha encontrada.", "Ajuste a busca, o sistema ou o estado da mesa.")
    }${pager(r, "admin-campaigns-page")}`;
  } catch (error) {
    if (ctx.alive()) target.innerHTML = failure(error, "admin-campaigns-retry");
  }
}
async function renderCampaign(ctx) {
  await load(ctx, "/admin/campaigns/" + ctx.id, (c) => {
    ctx.campaign = c;
    ctx.view.innerHTML = `<a class="back-link" href="#admin/campaigns">← Campanhas</a><section class="metal admin-profile"><div><span class="eyebrow">${esc(c.system)}</span><h2>${esc(c.name)}</h2><p class="muted">${esc(c.description || "Sem premissa registrada.")}</p><p>${onlineChip(c.online)} <span class="muted small">Criada em ${esc(when(c.createdAt))} · última atividade ${esc(when(c.lastActivityAt))}</span></p></div><div class="admin-actions">${button("Excluir campanha", "admin-campaign-delete", c.id, "danger", c.online ? 'disabled aria-describedby="delete-note"' : "")}<small id="delete-note" class="muted small">${c.online ? "Há uma sessão em andamento. Aguarde o mestre encerrar." : "Remove sessões, registros e recursos. Fichas pessoais são preservadas."}</small></div></section>
<div class="stat-grid admin-user-stats">${tile(c.members.length, "jogadores")}${tile(c.sessionCount, "sessões")}${tile(c.characterCount, "fichas vinculadas")}</div>
<div class="admin-columns"><section class="metal admin-panel" aria-labelledby="campaign-people"><div class="admin-panel-head"><h2 id="campaign-people">Mestre e jogadores</h2></div><ul class="admin-people">${c.master ? `<li>${avatar(c.master.avatarUrl, c.master.name)}<div><strong>${esc(c.master.name)}</strong><small>Mestre</small></div>${openLink(isAdminGuid(c.master.id) ? "admin/users/" + c.master.id : "")}</li>` : ""}${c.members.map((m) => `<li>${avatar(m.avatarUrl, m.name)}<div><strong>${esc(m.name)}</strong><small>Jogador</small></div>${openLink(isAdminGuid(m.id) ? "admin/users/" + m.id : "")}</li>`).join("")}</ul>${c.members.length ? "" : '<p class="muted small">Nenhum jogador vinculado.</p>'}</section><section class="metal admin-panel" aria-labelledby="campaign-sessions"><div class="admin-panel-head"><h2 id="campaign-sessions">Sessões recentes</h2></div>${
      c.sessions.length
        ? table(
            ["Nº", "Título", "Início", "Fim"],
            c.sessions.map((s) => `<tr><td class="num">${number(s.number)}</td><td>${esc(s.title)}</td><td>${esc(when(s.startedAt))}</td><td>${s.endedAt ? esc(when(s.endedAt)) : onlineChip(true)}</td></tr>`),
            "Sessões recentes da campanha",
          )
        : '<p class="muted small">Nenhuma sessão realizada.</p>'
    }</section></div><div class="section-title"><h2>Histórico administrativo${helpButton("admin.acoes.auditoria", "Motivo e auditoria")}</h2>${button("Ver na auditoria →", "admin-campaign-audit", c.id, "text-button")}</div>`;
  });
}
function deleteCampaignModal(ctx) {
  const c = ctx.campaign;
  modal(
    "Excluir campanha?",
    `<p class="modal-lead">Você excluirá <strong>${esc(c.name)}</strong>, com ${number(c.members.length)} ${c.members.length === 1 ? "jogador" : "jogadores"} e ${number(c.sessionCount)} ${c.sessionCount === 1 ? "sessão" : "sessões"}. Esta ação não pode ser desfeita.</p><form id="admin-campaign-delete-form">${reasonField()}${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir definitivamente</button></div></form>`,
  );
  $("#admin-campaign-delete-form").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      await api(`/admin/campaigns/${c.id}`, "DELETE", { reason: data.reason.trim() });
      $("#modal").close();
      toast("Campanha excluída e registrada na auditoria.");
      navigate("admin/campaigns");
    });
  };
}

// ---------- Sistemas de RPG ----------
async function renderSystems(ctx) {
  ctx.view.innerHTML = loading("Abrindo os tomos de regras…");
  try {
    systemsCache = null;
    const systems = await adminSystems();
    if (!ctx.alive()) return;
    ctx.systems = systems;
    ctx.view.innerHTML = `<div class="section-title admin-toolbar"><div><h2>Sistemas de RPG</h2><p class="muted small">Campanhas, fichas-modelo e biblioteca se organizam por sistema. Sistemas inativos somem das novas campanhas, mas as existentes continuam funcionando.</p></div>${button("+ Novo sistema", "admin-system-new", "", "primary")}</div>${
      systems.length
        ? table(
            ["Sistema", "Slug", "Situação", "Campanhas", "Fichas-modelo", "Biblioteca", '<span class="sr-only">Ações</span>'],
            systems.map((s) => {
              const used = s.campaigns + s.templates + s.library > 0;
              return `<tr><td><strong>${esc(s.name)}</strong>${s.protected ? ' <span class="badge" data-tip="Sistema da plataforma que não pode ser excluído.">PROTEGIDO</span>' : ""}${s.description ? `<small class="admin-sub">${esc(s.description)}</small>` : ""}</td><td><code>${esc(s.slug)}</code></td><td>${s.active ? '<span class="status-chip good">Ativo</span>' : '<span class="status-chip quiet">Inativo</span>'}</td><td class="num">${number(s.campaigns)}</td><td class="num">${number(s.templates)}</td><td class="num">${number(s.library)}</td><td><span class="admin-row-actions">${button("Editar", "admin-system-edit", s.id, "subtle small")}${button("Mesa padrão", "admin-system-table", s.id, "subtle small", `aria-label="Configuração padrão da mesa de ${esc(s.name)}"`)}${button("Excluir", "admin-system-delete", s.id, "danger small", s.protected || used ? `aria-disabled="true" data-tip="${s.protected ? "Sistema protegido" : "Em uso: desative em vez de excluir"}"` : "")}</span></td></tr>`;
            }),
            "Sistemas de RPG",
          )
        : blank("Nenhum sistema cadastrado.", "Crie o primeiro sistema para organizar campanhas e fichas.")
    }`;
  } catch (error) {
    if (ctx.alive()) ctx.view.innerHTML = failure(error);
  }
}
function systemModal(ctx, s) {
  modal(
    s ? "Editar sistema" : "Novo sistema de RPG",
    `<form id="admin-system-form">${field("name", "Nome", s?.name || "", "text", 'required minlength="2" maxlength="80"')}<div class="field"><div class="field-label"><label for="f-slug">Identificador (slug)</label>${helpButton("admin.sistemas.identificador", "Identificador do sistema")}</div><input id="f-slug" name="slug" value="${esc(s?.slug || "")}" maxlength="60" pattern="[a-z0-9]+(-[a-z0-9]+)*" ${s ? "required" : ""} aria-describedby="slug-help" autocapitalize="off" spellcheck="false"><small id="slug-help" class="muted small">Minúsculas sem acento, números e hífens (ex.: tormenta-20). ${s ? "Mudar o slug pode quebrar links externos." : "Gerado a partir do nome se ficar em branco."}</small></div><div class="field"><label for="f-description">Descrição</label><textarea id="f-description" name="description" rows="3" maxlength="2000">${esc(s?.description || "")}</textarea></div>${
      s
        ? `<label class="admin-check"><input id="f-active" type="checkbox" name="active" ${s.active ? "checked" : ""} ${s.protected ? "disabled" : ""}> Ativo para novas campanhas</label>${s.protected ? '<p class="muted small">O Sistema livre é protegido: não pode ser desativado nem excluído.</p>' : ""}`
        : ""
    }${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">${s ? "Salvar sistema" : "Criar sistema"}</button></div></form>`,
  );
  const form = $("#admin-system-form");
  const name = $("#f-name"),
    slugInput = $("#f-slug");
  let slugTouched = !!s;
  slugInput.addEventListener("input", () => (slugTouched = true));
  name.addEventListener("input", () => {
    if (!slugTouched) slugInput.placeholder = slugify(name.value);
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async (data) => {
      const slug = (data.slug || "").trim();
      if (slug && !isValidSlug(slug)) throw new Error("Identificador inválido: use minúsculas sem acento, números e hífens.");
      if (s)
        await api(`/admin/rpg-systems/${s.id}`, "PUT", {
          name: data.name.trim(),
          slug,
          description: data.description,
          active: s.protected ? true : $("#f-active").checked,
          revision: s.revision,
        });
      else await api("/admin/rpg-systems", "POST", { name: data.name.trim(), slug: slug || null, description: data.description });
      $("#modal").close();
      toast(s ? "Sistema atualizado." : "Sistema criado.");
      await ctx.rerender();
    });
  };
}
/** Configuração padrão da mesa do sistema: herdada pelas campanhas que não a ajustaram. */
async function systemTableModal(ctx, s) {
  const [{ settingsFields }, { settingsFromForm }] = await Promise.all([import("./table-settings.js"), import("./fog-policy.js")]);
  modal(
    `Mesa padrão — ${s.name}`,
    `<form id="admin-table-form"><p class="muted small">Campanhas deste sistema começam com estes valores. O mestre pode ajustar na campanha ou só numa sessão.${s.tableSettingsCustom ? "" : " Hoje vale o padrão da plataforma."}</p>${settingsFields(s.tableSettings, "sys")}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${s.tableSettingsCustom ? '<button type="submit" class="subtle" name="reset" value="1">Voltar ao padrão da plataforma</button>' : ""}<button type="submit" class="primary">Salvar padrão</button></div></form>`,
  );
  $("#admin-table-form").onsubmit = (event) => {
    event.preventDefault();
    const reset = event.submitter?.name === "reset";
    submitForm(event.currentTarget, async (data) => {
      await api(`/admin/rpg-systems/${s.id}/table-settings`, "PUT", { settings: reset ? null : settingsFromForm(data), revision: s.revision });
      $("#modal").close();
      toast("Configuração padrão da mesa salva.");
      await ctx.rerender();
    });
  };
}
function deleteSystemModal(ctx, s) {
  modal(
    "Excluir sistema?",
    `<p class="modal-lead">O sistema <strong>${esc(s.name)}</strong> não está em uso e será removido. A ação fica registrada na auditoria.</p><form id="admin-system-delete-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir sistema</button></div></form>`,
  );
  $("#admin-system-delete-form").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async () => {
      await api(`/admin/rpg-systems/${s.id}`, "DELETE");
      $("#modal").close();
      toast("Sistema excluído.");
      await ctx.rerender();
    });
  };
}

// ---------- Tickets (WP2: support.js) ----------
async function renderTickets(ctx) {
  ctx.view.innerHTML = loading("Abrindo a fila de suporte…");
  try {
    const support = await import("./support.js");
    if (!ctx.alive()) return;
    if (typeof support.renderAdminTickets !== "function") throw new Error("unavailable");
    ctx.view.innerHTML = "";
    return await support.renderAdminTickets(ctx.view, ctx.segments.slice(1));
  } catch {
    if (ctx.alive())
      ctx.view.innerHTML = blank("Tickets indisponíveis no momento.", "A fila de suporte ainda não está disponível nesta versão. Tente novamente mais tarde.");
  }
}

// ---------- Auditoria ----------
function auditTable(items, caption) {
  return table(
    ["Quando", "Ator", "Ação", "Alvo", "Resumo", "Dados"],
    items.map((a, index) => {
      const route = auditLink(a.targetType, a.targetId);
      return `<tr><td class="admin-nowrap">${esc(when(a.createdAt))}</td><td>${esc(a.actorName || "Conta removida")}</td><td><code>${esc(a.action)}</code></td><td><span class="admin-target">${esc(TARGET_LABELS[a.targetType] || a.targetType || "—")}${route ? openLink(route) : ""}</span></td><td class="admin-summary">${esc(a.summary)}</td><td>${a.data ? `<details class="admin-data"><summary>Ver</summary><pre data-audit-index="${index}"></pre></details>` : '<span class="muted">—</span>'}</td></tr>`;
    }),
    caption,
  );
}
/** Preenche o JSON das entradas por textContent (nunca como HTML). */
function fillAuditData(root, items) {
  root.querySelectorAll("pre[data-audit-index]").forEach((pre) => {
    const raw = items[Number(pre.dataset.auditIndex)]?.data || "";
    try {
      pre.textContent = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      pre.textContent = raw;
    }
  });
}
async function renderAudit(ctx) {
  const f = filters.audit;
  ctx.view.innerHTML = `<form id="admin-audit-filter" class="admin-filters admin-filters-wide" role="search"><div class="field"><label for="f-action">Ação (prefixo)</label><input id="f-action" name="action" maxlength="60" value="${esc(f.action)}" list="audit-actions" placeholder="ex.: user." autocapitalize="off" spellcheck="false"><datalist id="audit-actions">${["user.", "user.role", "user.suspend", "campaign.", "system.", "library.", "template.", "guild.", "ticket."].map((a) => `<option value="${a}"></option>`).join("")}</datalist></div><div class="field"><label for="f-actor">Ator (nome ou id)</label><input id="f-actor" name="actor" maxlength="100" value="${esc(f.actor)}"></div><div class="field"><label for="f-target-type">Tipo de alvo</label><select id="f-target-type" name="targetType"><option value="">Todos</option>${Object.entries(TARGET_LABELS).map(([key, label]) => `<option value="${key}" ${f.targetType === key ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label for="f-target-id">Id do alvo</label><input id="f-target-id" name="targetId" maxlength="80" value="${esc(f.targetId)}" autocapitalize="off" spellcheck="false"></div><div class="field"><label for="f-from">De</label><input id="f-from" name="from" type="date" value="${esc(f.from)}"></div><div class="field"><label for="f-to">Até</label><input id="f-to" name="to" type="date" value="${esc(f.to)}"></div><div class="admin-filter-buttons"><button type="submit" class="subtle">Buscar</button></div></form><div id="admin-list"></div>`;
  $("#admin-audit-filter").onsubmit = (event) => {
    event.preventDefault();
    Object.assign(f, Object.fromEntries(new FormData(event.currentTarget)), { page: 1 });
    for (const key of ["action", "actor", "targetId"]) f[key] = f[key].trim();
    listAudit(ctx);
  };
  await listAudit(ctx);
}
async function listAudit(ctx) {
  const target = $("#admin-list");
  target.innerHTML = loading("Lendo os registros do conselho…");
  try {
    const r = await api("/admin/audit" + queryString(filters.audit));
    if (!ctx.alive()) return;
    target.innerHTML = `<p class="list-summary" role="status">${number(r.total)} ${r.total === 1 ? "registro" : "registros"}. Para reverter uma ação, abra o alvo e use a tela correspondente.</p>${
      r.items.length ? auditTable(r.items, "Trilha de auditoria") : blank("Nenhum registro.", "Nenhuma ação corresponde aos filtros escolhidos.")
    }${pager(r, "admin-audit-page")}`;
    fillAuditData(target, r.items);
  } catch (error) {
    if (ctx.alive()) target.innerHTML = failure(error, "admin-audit-retry");
  }
}
function showAuditFor(targetType, targetId) {
  Object.assign(filters.audit, { action: "", actor: "", targetType, targetId, from: "", to: "", page: 1 });
  navigate("admin/audit");
}

// ---------- Eventos ----------
async function handleClick(event, ctx) {
  const b = event.target.closest("[data-action]");
  if (!b || !b.dataset.action.startsWith("admin-") || b.disabled) return;
  const { action, id } = b.dataset;
  try {
    if (action === "admin-retry") await ctx.rerender();
    if (action === "admin-users-retry") await listUsers(ctx);
    if (action === "admin-campaigns-retry") await listCampaigns(ctx);
    if (action === "admin-audit-retry") await listAudit(ctx);
    if (action === "admin-users-page") {
      filters.users.page = Math.max(1, Number(id) || 1);
      await listUsers(ctx);
    }
    if (action === "admin-campaigns-page") {
      filters.campaigns.page = Math.max(1, Number(id) || 1);
      await listCampaigns(ctx);
    }
    if (action === "admin-audit-page") {
      filters.audit.page = Math.max(1, Number(id) || 1);
      await listAudit(ctx);
    }
    if (action === "admin-role" && ctx.user) roleModal(ctx);
    if (action === "admin-suspend" && ctx.user) suspendModal(ctx);
    if (action === "admin-unsuspend" && ctx.user) unsuspendModal(ctx);
    if (action === "admin-user-audit" && isAdminGuid(id)) showAuditFor("user", id);
    if (action === "admin-campaign-audit" && isAdminGuid(id)) showAuditFor("campaign", id);
    if (action === "admin-campaign-delete" && ctx.campaign) deleteCampaignModal(ctx);
    if (action === "admin-system-new") systemModal(ctx);
    const system = ctx.systems?.find((s) => s.id === id);
    if (action === "admin-system-edit" && system) systemModal(ctx, system);
    if (action === "admin-system-delete" && system) deleteSystemModal(ctx, system);
    if (action === "admin-system-table" && system) await systemTableModal(ctx, system);
  } catch (error) {
    toast(error.message);
  }
}
