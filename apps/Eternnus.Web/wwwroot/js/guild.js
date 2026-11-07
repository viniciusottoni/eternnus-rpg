// Guilda: salão (#guild), categoria (#guild/c/{slug}), tópico (#guild/t/{id}[/página]) e moderação (#guild/moderation[/aba]).
// Apresentação e eventos aqui; regras puras em guild-policy.js; HTTP via api.js. Todo texto do usuário passa por esc() ou textContent.
import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { $, esc, button, modal, toast, formError, submitForm, formatDate, navigate } from "./ui.js";
import { isStaff, isAdmin } from "./policy.js";
import {
  LIMITS,
  DEFAULT_AVATAR,
  parseGuildRoute,
  relativeTime,
  linkSegments,
  safeAvatar,
  roleBadge,
  removedLabel,
  postButtons,
  topicTools,
  topicGate,
  charCounter,
  pageCount,
  repliesLabel,
  isGuid,
  isSlug,
} from "./guild-policy.js";

const SIGILS = ["⚜", "⚑", "⚔", "✧", "♛", "❖", "⚒", "✦"];
let generation = 0;
let route = { view: "hall" };
let topicData = null;
let pendingScroll = null;
const listState = { slug: "", q: "", systemId: "", page: 1 };
const modState = { page: 1 };

export async function renderGuild(segments = []) {
  shell("guild");
  route = parseGuildRoute(segments);
  const main = $("#main");
  main.classList.add("guild-page");
  main.addEventListener("click", onClick);
  await show();
}

async function show() {
  const request = ++generation;
  const main = $("#main");
  try {
    if (route.view === "category") await renderCategory(request);
    else if (route.view === "topic") await renderTopic(request);
    else if (route.view === "moderation") await renderModeration(request);
    else await renderHall(request);
    if (request !== generation) return;
    guardAvatars(main);
  } catch (error) {
    if (request !== generation || !main.isConnected) return;
    main.innerHTML = failure(error);
  }
}
const stale = (request) => request !== generation || !$("#main")?.classList.contains("guild-page");

// ---------- Peças comuns ----------
function failure(error) {
  const missing = error?.status === 404;
  const forbidden = error?.status === 403;
  return `<a class="back-link" href="#guild">← Salão da Guilda</a><section class="empty guild-state" role="alert"><span class="empty-sigil" aria-hidden="true">⚜</span><h3>${missing ? "Este caminho não leva a lugar algum." : forbidden ? "Área indisponível para a sua conta." : "Os portões do salão emperraram."}</h3><p>${esc(error?.message || "Não foi possível carregar a Guilda.")}</p>${missing || forbidden ? '<a class="button primary" href="#guild">Voltar ao salão</a>' : button("Tentar novamente", "guild-retry", "", "primary")}</section>`;
}
function guardAvatars(root) {
  root.querySelectorAll("img.avatar:not([data-guarded])").forEach((img) => {
    img.dataset.guarded = "1";
    img.addEventListener("error", () => {
      if (!img.src.endsWith(DEFAULT_AVATAR)) img.src = DEFAULT_AVATAR;
    }, { once: true });
  });
}
function timeTag(value) {
  return `<time datetime="${esc(value)}" title="${esc(formatDate(String(value)))}">${esc(relativeTime(value))}</time>`;
}
function badge(role) {
  const b = roleBadge(role);
  return b ? `<span class="guild-role ${b.kind}">${b.kind === "admin" ? "♛" : "✧"} ${b.label}</span>` : "";
}
function authorInline(a) {
  return `<span class="guild-author-inline"><img class="avatar" src="${esc(safeAvatar(a?.avatarUrl))}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer"><span>${esc(a?.name || "Aventureiro")}</span><small>Nv. ${esc(Number(a?.level) || 1)}</small>${badge(a?.role)}</span>`;
}
function topicHref(id, page) {
  return isGuid(id) ? `#guild/t/${id}${page > 1 ? "/" + page : ""}` : "#guild";
}
function categoryHref(slug) {
  return isSlug(slug) ? `#guild/c/${slug}` : "#guild";
}
function pager(page, total, action) {
  const pages = pageCount(total);
  if (pages <= 1) return "";
  return `${button("← Anterior", action, page - 1, "subtle", page <= 1 ? "disabled" : "")}<span>Página ${page} de ${pages}</span>${button("Próxima →", action, page + 1, "subtle", page >= pages ? "disabled" : "")}`;
}
function counterHtml(id, max) {
  return `<span class="guild-counter" id="${id}" aria-live="polite">0 / ${max.toLocaleString("pt-BR")}</span>`;
}
/** Liga um contador de caracteres a um campo (input/textarea). */
function bindCounter(input, output, max, min = 0) {
  if (!input || !output) return;
  const update = () => {
    const c = charCounter(input.value.length, max, min);
    output.textContent = c.text;
    output.dataset.state = c.state;
  };
  input.addEventListener("input", update);
  update();
}
/** Texto puro com quebras preservadas (CSS) e links http(s) validados criados via DOM. */
function fillBody(element, text) {
  element.textContent = "";
  for (const part of linkSegments(text)) {
    if (part.type === "text") element.append(document.createTextNode(part.value));
    else {
      const link = document.createElement("a");
      link.href = part.href;
      link.textContent = part.value;
      link.rel = "noopener noreferrer nofollow ugc";
      link.target = "_blank";
      element.append(link);
    }
  }
}
function textareaField(name, label, max, min, value = "", rows = 6, hint = "") {
  return `<div class="field guild-textarea"><label for="g-${name}">${label}</label><textarea id="g-${name}" name="${name}" rows="${rows}" maxlength="${max}" ${min ? `minlength="${min}" required` : ""}>${esc(value)}</textarea><div class="guild-field-foot"><small class="muted">${hint}</small>${counterHtml(`g-${name}-count`, max)}</div></div>`;
}
function reasonModal(title, intro, label, submitLabel, task, { danger = false, min = LIMITS.reasonMin, max = LIMITS.reasonMax, extra = "" } = {}) {
  modal(
    title,
    `<p class="muted small">${intro}</p><form id="guild-reason-form">${extra}${textareaField("reason", label, max, min, "", 3, "Fica registrado na auditoria.")}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="${danger ? "danger" : "primary"}">${submitLabel}</button></div></form>`,
  );
  bindCounter($("#g-reason"), $("#g-reason-count"), max, min);
  $("#guild-reason-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await task(data);
      $("#modal").close();
    });
  };
}

// ---------- Salão ----------
async function renderHall(request) {
  const [categories, recent] = await Promise.all([api("/guild/categories"), api("/guild/recent?limit=5")]);
  if (stale(request)) return;
  const viewer = categories.viewer || {};
  const staff = !!viewer.staff;
  const taverna = categories.items.find((c) => c.slug === "taverna");
  const tavernaGate = taverna ? topicGate(taverna, viewer) : null;
  const allowed = categories.items.filter((c) => topicGate(c, viewer).canCreate);
  $("#main").innerHTML = `<div class="page-heading"><div><span class="eyebrow">SALÃO DA GUILDA</span><h1>Guilda dos Aventureiros <span class="heading-gem">✦</span></h1><p>Converse, encontre grupo, tire dúvidas de regras e compartilhe lendas com toda a comunidade.</p></div><div class="guild-heading-actions">${staff ? `<a class="button subtle" href="#guild/moderation">⚖ Moderação <span class="guild-mod-count" id="guild-mod-count" hidden></span></a>` : ""}${allowed.length ? button("+ Novo tópico", "guild-new", "", "primary") : ""}</div></div>
  <section class="guild-hearth metal" aria-labelledby="guild-hearth-title"><div class="guild-hearth-flame" aria-hidden="true">🜂</div><div><span class="eyebrow">CHAMADO À LAREIRA</span><h2 id="guild-hearth-title">Apresente-se na Taverna</h2><p>Conte quem você é, que sistemas joga e que tipo de mesa procura. Cada participação rende XP e aproxima você de novos desbloqueios.</p></div><div class="guild-hearth-actions">${tavernaGate?.canCreate ? button("Apresentar-me", "guild-new", taverna.id, "primary") : ""}${taverna ? `<a class="button subtle" href="#guild/c/taverna">Entrar na Taverna →</a>` : ""}</div></section>
  ${viewer.topicBlockedReason && !staff ? `<p class="guild-gate" role="note"><span aria-hidden="true">♙</span> ${esc(viewer.topicBlockedReason)} Responder continua liberado. <a href="#progress">Ver meu nível →</a></p>` : ""}
  <div class="section-title"><h2>Salões da Guilda</h2><span>${categories.items.length} CATEGORIAS</span></div>
  <div class="guild-halls">${categories.items.length ? categories.items.map((c, i) => hallCard(c, i, viewer)).join("") : `<div class="empty"><h3>Nenhum salão aberto.</h3><p>A administração ainda não abriu categorias.</p></div>`}</div>
  <div class="section-title"><h2>Movimento recente</h2><span>ÚLTIMOS TÓPICOS</span></div>
  <div class="guild-topic-list">${recent.length ? recent.map((t) => topicRow(t, true)).join("") : `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚜</span><h3>O salão ainda está silencioso.</h3><p>Seja a primeira voz: apresente-se na Taverna.</p></div>`}</div>`;
  $("#main").dataset.allowed = JSON.stringify(allowed.map((c) => ({ id: c.id, name: c.name })));
  if (staff)
    api("/guild/moderation/reports?status=open", "GET", undefined, { background: true })
      .then((r) => {
        const el = $("#guild-mod-count");
        if (el && r.total) {
          el.hidden = false;
          el.textContent = String(r.total);
          el.setAttribute("aria-label", `${r.total} denúncias abertas`);
        }
      })
      .catch(() => {});
}
function hallCard(c, index, viewer) {
  const gate = topicGate(c, viewer);
  const tags = [
    c.staffOnly ? '<span class="status-chip warn">♛ Somente equipe abre tópicos</span>' : "",
    !c.staffOnly && c.minLevelToPost > 1 ? `<span class="status-chip ${gate.canCreate ? "quiet" : "warn"}">Nível ${esc(c.minLevelToPost)}+ para abrir tópicos</span>` : "",
  ].join("");
  const last = c.lastTopic
    ? `<p class="guild-hall-last"><span class="muted small">Último:</span> <a href="${topicHref(c.lastTopic.id)}">${esc(c.lastTopic.title)}</a> <span class="muted small">· ${esc(c.lastTopic.author || "")} · ${timeTag(c.lastTopic.lastPostAt)}</span></p>`
    : '<p class="guild-hall-last muted small">Nenhum tópico ainda. Inaugure este salão.</p>';
  return `<article class="guild-hall metal"><span class="guild-hall-sigil" aria-hidden="true">${SIGILS[index % SIGILS.length]}</span><div class="guild-hall-body"><h3><a href="${categoryHref(c.slug)}">${esc(c.name)}</a></h3><p>${esc(c.description)}</p><div class="guild-hall-tags">${tags}</div>${last}</div><dl class="guild-hall-stats"><div><dt>Tópicos</dt><dd>${esc(Number(c.topicCount).toLocaleString("pt-BR"))}</dd></div><div><dt>Mensagens</dt><dd>${esc(Number(c.postCount).toLocaleString("pt-BR"))}</dd></div></dl></article>`;
}
function topicRow(t, showCategory = false) {
  const marks = `${t.pinned ? '<span class="status-chip warn">📌 Fixado</span>' : ""}${t.locked ? '<span class="status-chip quiet">🔒 Trancado</span>' : ""}${t.deleted ? '<span class="status-chip bad">Removido</span>' : ""}`;
  const where = [showCategory && t.category ? `<a href="${categoryHref(t.category.slug)}">${esc(t.category.name)}</a>` : "", t.system ? `<span>▤ ${esc(t.system.name)}</span>` : ""].filter(Boolean).join(" · ");
  return `<article class="guild-topic-row ${t.pinned ? "is-pinned" : ""}"><span class="guild-topic-sigil" aria-hidden="true">${t.pinned ? "📌" : t.locked ? "🔒" : "✦"}</span><div class="guild-topic-main"><h3><a href="${topicHref(t.id)}">${esc(t.title)}</a></h3><div class="guild-topic-meta">${marks}${authorInline(t.author)}${where ? `<span class="muted small">${where}</span>` : ""}</div></div><div class="guild-topic-stats"><strong>${esc(repliesLabel(t.replyCount))}</strong><span class="muted small">${timeTag(t.lastPostAt)}</span></div></article>`;
}

// ---------- Novo tópico ----------
async function openNewTopic(categories, selectedId) {
  if (!categories.length) return toast("Você ainda não pode abrir tópicos em nenhuma categoria.");
  modal(
    "Novo tópico",
    `<p class="muted small">Texto puro: quebras de linha são mantidas e links http(s) ficam clicáveis. Seja gentil com os demais aventureiros.</p><form id="guild-topic-form"><div class="field"><label for="g-category">Categoria</label><select id="g-category" name="categoryId" required>${categories.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div><div class="field"><label for="g-title">Título</label><input id="g-title" name="title" required minlength="${LIMITS.titleMin}" maxlength="${LIMITS.titleMax}" autocomplete="off"><div class="guild-field-foot"><small class="muted">De ${LIMITS.titleMin} a ${LIMITS.titleMax} caracteres.</small>${counterHtml("g-title-count", LIMITS.titleMax)}</div></div><div class="field" id="g-system-field" hidden><label for="g-system">Sistema de RPG (opcional)</label><select id="g-system" name="systemId"><option value="">Nenhum em especial</option></select></div>${textareaField("body", "Mensagem", LIMITS.bodyMax, LIMITS.bodyMin, "", 8)}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Publicar tópico</button></div></form>`,
  );
  bindCounter($("#g-title"), $("#g-title-count"), LIMITS.titleMax, LIMITS.titleMin);
  bindCounter($("#g-body"), $("#g-body-count"), LIMITS.bodyMax, LIMITS.bodyMin);
  loadSystems($("#g-system"), $("#g-system-field"));
  $("#guild-topic-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const result = await api("/guild/topics", "POST", {
        categoryId: data.categoryId,
        title: data.title,
        body: data.body,
        systemId: isGuid(data.systemId) ? data.systemId : null,
      });
      $("#modal").close();
      toast("Tópico publicado na Guilda.");
      navigate("guild/t/" + result.id);
    });
  };
}
let systemsCache = null;
async function loadSystems(select, wrapper, selected = "") {
  try {
    systemsCache ??= await api("/rpg-systems", "GET", undefined, { background: true });
    if (!select?.isConnected || !Array.isArray(systemsCache) || !systemsCache.length) return;
    for (const s of systemsCache) {
      if (!isGuid(s.id)) continue;
      const option = document.createElement("option");
      option.value = s.id;
      option.textContent = s.name;
      option.selected = s.id === selected;
      select.append(option);
    }
    wrapper.hidden = false;
  } catch {
    systemsCache = null; // sistemas indisponíveis: o campo opcional continua oculto
  }
}

// ---------- Categoria ----------
async function renderCategory(request) {
  if (listState.slug !== route.slug) Object.assign(listState, { slug: route.slug, q: "", systemId: "", page: 1 });
  const params = new URLSearchParams({ category: route.slug, page: listState.page });
  if (listState.q) params.set("q", listState.q);
  if (isGuid(listState.systemId)) params.set("systemId", listState.systemId);
  const result = await api("/guild/topics?" + params);
  if (stale(request)) return;
  const c = result.category;
  const gate = topicGate(c);
  $("#main").innerHTML = `<a class="back-link" href="#guild">← Salão da Guilda</a>
  <div class="page-heading"><div><span class="eyebrow">SALÃO DA GUILDA</span><h1>${esc(c.name)}</h1><p>${esc(c.description)}</p></div><div class="guild-heading-actions">${button("+ Novo tópico", "guild-new", c.id, "primary", gate.canCreate ? "" : 'disabled aria-describedby="guild-gate"')}</div></div>
  ${gate.canCreate ? "" : `<div class="guild-gate" id="guild-gate" role="note"><span aria-hidden="true">♙</span><div><strong>Novo tópico bloqueado${gate.requiredLevel ? ` — nível ${esc(gate.requiredLevel)} necessário` : ""}.</strong> ${esc(gate.reason)} Responder em tópicos continua liberado.${gate.requiredLevel || /nível/i.test(gate.reason) ? ' <a href="#progress">Ver meu nível e como subir →</a>' : ""}</div></div>`}
  <div class="campaign-toolbar guild-toolbar"><form id="guild-search" role="search"><label class="sr-only" for="g-q">Buscar tópicos por título</label><input id="g-q" name="q" maxlength="${LIMITS.searchMax}" value="${esc(listState.q)}" placeholder="Buscar pelo título…"><span class="guild-system-filter" id="g-filter-field" hidden><label class="sr-only" for="g-filter">Filtrar por sistema</label><select id="g-filter" name="systemId"><option value="">Todos os sistemas</option></select></span><button type="submit" class="subtle">Buscar</button></form></div>
  <div class="list-summary"><span>${esc(result.total)} ${result.total === 1 ? "tópico" : "tópicos"}${listState.q ? ` para “${esc(listState.q)}”` : ""}</span></div>
  <div class="guild-topic-list" aria-live="polite">${result.items.length ? result.items.map((t) => topicRow(t)).join("") : `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚜</span><h3>${listState.q || listState.systemId ? "Nenhum tópico encontrado." : "Este salão ainda está vazio."}</h3><p>${listState.q || listState.systemId ? "Tente outra busca ou limpe os filtros." : gate.canCreate ? "Abra o primeiro tópico e puxe uma cadeira." : "Volte em breve: a equipe e os veteranos abrem os primeiros tópicos."}</p></div>`}</div>
  <nav class="pagination" aria-label="Páginas de tópicos">${pager(result.page, result.total, "guild-list-page")}</nav>`;
  $("#main").dataset.allowed = JSON.stringify(gate.canCreate ? [{ id: c.id, name: c.name }] : []);
  loadSystems($("#g-filter"), $("#g-filter-field"), listState.systemId);
  $("#guild-search").onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    listState.q = String(data.get("q") || "").trim().slice(0, LIMITS.searchMax);
    listState.systemId = String(data.get("systemId") || "");
    listState.page = 1;
    show();
  };
}

// ---------- Tópico ----------
async function renderTopic(request) {
  const data = await api(`/guild/topics/${route.id}?page=${route.page}`);
  if (stale(request)) return;
  topicData = data;
  const t = data.topic;
  const staff = !!data.staff;
  const tools = topicTools(t, staff);
  $("#main").innerHTML = `<a class="back-link" href="${categoryHref(t.category?.slug)}">← ${esc(t.category?.name || "Guilda")}</a>
  <header class="guild-topic-head metal"><span class="eyebrow">${esc(t.category?.name || "GUILDA")}${t.system ? ` · ${esc(t.system.name)}` : ""}</span><h1>${esc(t.title)}</h1><div class="guild-topic-meta">${t.pinned ? '<span class="status-chip warn">📌 Fixado</span>' : ""}${t.locked ? '<span class="status-chip quiet">🔒 Trancado</span>' : ""}${t.deleted ? '<span class="status-chip bad">Removido — visível só para a equipe</span>' : ""}<span class="muted small">Aberto por</span>${authorInline(t.author)}<span class="muted small">${timeTag(t.createdAt)} · ${esc(data.total)} ${data.total === 1 ? "mensagem" : "mensagens"}</span></div></header>
  ${tools.length ? `<div class="guild-mod-tools" role="group" aria-label="Moderação do tópico"><span class="eyebrow">MODERAÇÃO</span>${tools.map((tool) => button(esc(tool.label), "guild-topic-tool", tool.key, tool.key === "delete" && !t.deleted ? "danger small" : "subtle small")).join("")}</div>` : ""}
  <ol class="guild-posts">${data.posts.map((p, i) => `<li>${postCard(p, i, data)}</li>`).join("")}</ol>
  <nav class="pagination" aria-label="Páginas do tópico">${data.pageCount > 1 ? topicPager(t.id, data.page, data.pageCount) : ""}</nav>
  ${replyBox(data)}`;
  document.querySelectorAll("[data-post-body]").forEach((el) => fillBody(el, data.posts[Number(el.dataset.postBody)]?.body ?? ""));
  const reply = $("#g-reply");
  if (reply) {
    bindCounter(reply, $("#g-reply-count"), LIMITS.bodyMax, LIMITS.bodyMin);
    $("#guild-reply-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (form) => {
        const result = await api(`/guild/topics/${t.id}/posts`, "POST", { body: form.body });
        toast("Resposta publicada.");
        pendingScroll = result.id;
        reply.value = "";
        navigate(`guild/t/${t.id}${result.page > 1 ? "/" + result.page : ""}`);
      });
    };
  }
  if (pendingScroll) {
    const target = document.getElementById("post-" + pendingScroll);
    pendingScroll = null;
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }
}
function topicPager(id, page, pages) {
  const link = (p, label, rel) => `<a class="button subtle" href="${topicHref(id, p)}" ${rel ? `rel="${rel}"` : ""}>${label}</a>`;
  return `${page > 1 ? link(page - 1, "← Anterior", "prev") : '<button type="button" class="subtle" disabled>← Anterior</button>'}<span>Página ${page} de ${pages}</span>${page < pages ? link(page + 1, "Próxima →", "next") : '<button type="button" class="subtle" disabled>Próxima →</button>'}`;
}
function postCard(p, index, data) {
  const b = postButtons(p, { staff: data.staff, canReply: data.canReply });
  const a = p.author || {};
  const removed = removedLabel(p.removed);
  const number = (data.page - 1) * data.pageSize + index + 1;
  const actions = [
    b.useful.show
      ? `<button type="button" class="subtle small guild-useful" data-action="guild-useful" data-id="${esc(p.id)}" aria-pressed="${b.useful.pressed}" ${b.useful.disabled ? `disabled title="${p.author?.id === state.user?.id ? "Não é possível marcar a própria mensagem" : "Indisponível"}"` : ""}><span aria-hidden="true">✦</span> Útil <span class="guild-useful-count">${esc(b.useful.count)}</span></button>`
      : "",
    b.reply ? button("↩ Responder", "guild-reply-to", p.id, "subtle small") : "",
    b.edit ? button("✎ Editar", "guild-edit", p.id, "subtle small") : "",
    b.delete ? button("Excluir", "guild-delete", p.id, "subtle small") : "",
    b.report ? button("⚑ Denunciar", "guild-report", p.id, "text-button") : b.reported ? '<span class="muted small">Denúncia enviada</span>' : "",
    b.moderateRemove ? button("Remover (moderação)", "guild-mod-remove", p.id, "danger small") : "",
    b.moderateRestore ? button("Restaurar", "guild-mod-restore", p.id, "subtle small") : "",
  ].join("");
  return `<article class="guild-post metal ${p.removed ? "is-removed" : ""}" id="post-${esc(p.id)}" tabindex="-1" aria-labelledby="post-${esc(p.id)}-author"><aside class="guild-author-card">${isGuid(a.id) ? `<button type="button" class="guild-author-open" data-action="guild-author" data-id="${esc(a.id)}" aria-label="Ver perfil de ${esc(a.name || "Aventureiro")}">` : "<div>"}<img class="avatar" src="${esc(safeAvatar(a.avatarUrl))}" alt="" width="64" height="64" loading="lazy" referrerpolicy="no-referrer"><strong id="post-${esc(p.id)}-author">${esc(a.name || "Aventureiro")}</strong>${isGuid(a.id) ? "</button>" : "</div>"}<span class="guild-level">Nível ${esc(Number(a.level) || 1)}</span>${badge(a.role)}</aside><div class="guild-post-content"><header class="guild-post-meta"><span class="muted small">#${esc(number)}${p.isFirst ? " · abertura" : ""}</span>${timeTag(p.createdAt)}${p.editedAt ? `<span class="muted small" title="${esc(formatDate(String(p.editedAt)))}">· editada</span>` : ""}${data.staff && p.openReports ? `<span class="status-chip bad">${esc(p.openReports)} ${p.openReports === 1 ? "denúncia aberta" : "denúncias abertas"}</span>` : ""}</header>${removed ? `<p class="guild-removed"><span aria-hidden="true">⊘</span> ${removed}${data.staff && p.body != null ? " — texto visível só para a equipe:" : ""}</p>` : ""}${p.body != null ? `<div class="guild-body ${p.removed ? "is-staff-only" : ""}" data-post-body="${index}"></div>` : ""}${actions ? `<footer class="guild-post-actions">${actions}</footer>` : ""}</div></article>`;
}
function replyBox(data) {
  if (data.topic.deleted) return "";
  if (!data.canReply)
    return `<section class="guild-reply locked metal" role="note"><span aria-hidden="true">🔒</span> Este tópico foi trancado pela moderação e não recebe novas respostas.</section>`;
  return `<section class="guild-reply metal" aria-labelledby="guild-reply-title"><h2 id="guild-reply-title">Sua resposta</h2>${data.topic.locked ? '<p class="muted small">Tópico trancado: somente a equipe pode responder.</p>' : ""}<form id="guild-reply-form">${textareaField("reply", "Mensagem", LIMITS.bodyMax, LIMITS.bodyMin, "", 5, "Texto puro; links http(s) ficam clicáveis.").replace('name="reply"', 'name="body"')}${formError()}<div class="form-actions"><button type="submit" class="primary">Publicar resposta</button></div></form></section>`;
}
const findPost = (id) => topicData?.posts.find((p) => String(p.id) === String(id));

/** Cartão público do autor (nível, XP, papel e conquistas). Nunca mostra e-mail: o endpoint não o devolve. */
async function openAuthor(id) {
  if (!isGuid(id)) return;
  modal("Aventureiro da Guilda", '<p class="muted" role="status">Carregando perfil…</p>');
  const body = $("#modal-body");
  try {
    const p = await api(`/progress/users/${encodeURIComponent(id)}`, "GET", undefined, { background: true });
    if (!$("#modal").open || body !== $("#modal-body")) return;
    const achievements = Array.isArray(p.achievements) ? p.achievements.slice(0, 12) : [];
    body.innerHTML = `<div class="guild-profile"><img class="avatar" src="${esc(safeAvatar(p.avatarUrl))}" alt="" width="72" height="72" referrerpolicy="no-referrer"><div><h3>${esc(p.name || "Aventureiro")}</h3><p><span class="guild-level">Nível ${esc(Number(p.level) || 1)}</span> <span class="muted small">${esc(Number(p.xp || 0).toLocaleString("pt-BR"))} XP</span> ${badge(p.role)}</p></div></div><h4 class="guild-profile-title">Conquistas</h4>${achievements.length ? `<ul class="guild-achievements">${achievements.map((x) => `<li><span aria-hidden="true">${esc(x.icon || "✦")}</span> ${esc(x.title)}</li>`).join("")}</ul>` : '<p class="muted small">Nenhuma conquista ainda. Toda lenda começa em algum lugar.</p>'}<div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}</div>`;
    guardAvatars(body);
  } catch (error) {
    if ($("#modal").open) body.innerHTML = `<p role="alert">${esc(error.message || "Não foi possível carregar o perfil.")}</p><div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}</div>`;
  }
}

async function toggleUseful(target) {
  const id = target.dataset.id;
  const pressed = target.getAttribute("aria-pressed") === "true";
  target.disabled = true;
  try {
    const result = await api(`/guild/posts/${encodeURIComponent(id)}/useful`, pressed ? "DELETE" : "POST", undefined, { background: true });
    target.setAttribute("aria-pressed", String(!!result.markedUseful));
    target.querySelector(".guild-useful-count").textContent = String(result.usefulCount);
    const post = findPost(id);
    if (post) Object.assign(post, { markedUseful: result.markedUseful, usefulCount: result.usefulCount });
  } catch (error) {
    toast(error.message);
  } finally {
    target.disabled = false;
  }
}
function editPost(id) {
  const post = findPost(id);
  if (!post) return;
  modal(
    "Editar mensagem",
    `<form id="guild-edit-form">${textareaField("body", "Mensagem", LIMITS.bodyMax, LIMITS.bodyMin, post.body || "", 8)}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar edição</button></div></form>`,
  );
  bindCounter($("#g-body"), $("#g-body-count"), LIMITS.bodyMax, LIMITS.bodyMin);
  $("#guild-edit-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      try {
        await api(`/guild/posts/${encodeURIComponent(id)}`, "PUT", { body: data.body, revision: Number(post.revision) || 0 });
      } catch (error) {
        if (error.status !== 409) throw error;
        // Outra aba ou a moderação mudou a mensagem: recarrega o tópico em vez de sobrescrever.
        $("#modal").close();
        toast(error.message);
        pendingScroll = id;
        await show();
        return;
      }
      $("#modal").close();
      toast("Mensagem atualizada.");
      pendingScroll = id;
      await show();
    });
  };
}
function deletePost(id) {
  const post = findPost(id);
  if (!post) return;
  const last = post.isFirst && topicData.total === 1;
  modal(
    "Excluir sua mensagem?",
    `<p>${last ? "Esta é a única mensagem do tópico: o tópico inteiro sairá da Guilda." : "A mensagem ficará marcada como removida pelo autor no tópico."}</p><p class="muted small">Esta ação não pode ser desfeita por você.</p><form id="guild-delete-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir mensagem</button></div></form>`,
  );
  $("#guild-delete-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      const result = await api(`/guild/posts/${encodeURIComponent(id)}`, "DELETE");
      $("#modal").close();
      if (result?.topicDeleted) {
        toast("Tópico excluído.");
        navigate(categoryHref(topicData.topic.category?.slug).slice(1));
      } else {
        toast("Mensagem excluída.");
        await show();
      }
    });
  };
}
function reportPost(id) {
  reasonModal(
    "Denunciar mensagem",
    "Conte à moderação o que há de errado (ofensa, spam, conteúdo impróprio…). O autor não vê quem denunciou.",
    "Motivo da denúncia",
    "Enviar denúncia",
    async (data) => {
      await api(`/guild/posts/${encodeURIComponent(id)}/report`, "POST", { reason: data.reason });
      toast("Denúncia enviada à moderação. Obrigado por cuidar da Guilda.");
      await show();
    },
    { min: LIMITS.reportMin, max: LIMITS.reportMax },
  );
}
function moderatePost(id, restore) {
  reasonModal(
    restore ? "Restaurar mensagem" : "Remover mensagem",
    restore ? "A mensagem volta a aparecer para todos." : "A mensagem aparecerá como “removida pela moderação”. Denúncias abertas dela serão resolvidas.",
    "Motivo",
    restore ? "Restaurar" : "Remover mensagem",
    async (data) => {
      await api(`/guild/moderation/posts/${encodeURIComponent(id)}/${restore ? "restore" : "delete"}`, "POST", { reason: data.reason });
      toast(restore ? "Mensagem restaurada." : "Mensagem removida.");
      pendingScroll = id;
      await show();
    },
    { danger: !restore },
  );
}
async function topicTool(key) {
  const t = topicData?.topic;
  if (!t) return;
  const tool = topicTools(t, true).find((x) => x.key === key);
  if (!tool) return;
  let extra = "";
  if (key === "move") {
    const categories = await api("/guild/categories");
    extra = `<div class="field"><label for="g-move">Mover para</label><select id="g-move" name="categoryId" required>${categories.items
      .filter((c) => c.id !== t.category?.id)
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
      .join("")}</select></div>`;
  }
  reasonModal(
    `${tool.label}: ${t.title.length > 50 ? t.title.slice(0, 50) + "…" : t.title}`,
    key === "delete" && !t.deleted ? "O tópico some das listas para todos; a equipe pode restaurá-lo." : "A alteração vale na hora e fica registrada na auditoria.",
    "Motivo",
    tool.label,
    async (data) => {
      const change = key === "move" ? { categoryId: data.categoryId } : tool.change;
      try {
        await api(`/guild/moderation/topics/${t.id}`, "POST", { ...change, reason: data.reason, revision: t.revision });
      } catch (error) {
        if (error.status === 409) {
          $("#modal").close();
          toast(error.message);
          await show();
          return;
        }
        throw error;
      }
      toast("Tópico atualizado.");
      await show();
    },
    { danger: key === "delete" && !t.deleted, extra },
  );
}

// ---------- Moderação ----------
async function renderModeration(request) {
  const main = $("#main");
  if (!isStaff(state.user)) {
    main.innerHTML = failure({ status: 403, message: "A moderação da Guilda é feita por administradores e embaixadores." });
    return;
  }
  const admin = isAdmin(state.user);
  const tab = route.tab === "categories" && !admin ? "open" : route.tab;
  if (modState.tab !== tab) Object.assign(modState, { tab, page: 1 });
  const tabs = [
    ["open", "Denúncias abertas"],
    ["resolved", "Resolvidas"],
    ["topics", "Tópicos removidos"],
    ...(admin ? [["categories", "Categorias"]] : []),
  ];
  let body = "";
  if (tab === "categories") body = await categoriesPanel();
  else if (tab === "topics") body = await deletedTopicsPanel();
  else body = await reportsPanel(tab);
  if (stale(request)) return;
  main.innerHTML = `<a class="back-link" href="#guild">← Salão da Guilda</a><div class="page-heading"><div><span class="eyebrow">GUARDIÕES DO SALÃO</span><h1>Moderação da Guilda</h1><p>Denúncias, tópicos removidos e categorias. Toda decisão exige motivo e fica na auditoria.</p></div></div><nav class="page-tabs" aria-label="Seções da moderação">${tabs.map(([key, label]) => `<a href="#guild/moderation/${key}" ${key === tab ? 'aria-current="page" class="active"' : ""}>${label}</a>`).join("")}</nav>${body}`;
}
async function reportsPanel(status) {
  const data = await api(`/guild/moderation/reports?status=${status}&page=${modState.page}`);
  modState.reports = data.items;
  if (!data.items.length)
    return `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚖</span><h3>${status === "open" ? "Nenhuma denúncia aguardando." : "Nenhuma denúncia resolvida ainda."}</h3><p>${status === "open" ? "O salão está em paz. Volte mais tarde." : "Decisões aparecem aqui com quem decidiu e quando."}</p></div>`;
  const rows = data.items
    .map(
      (r) => `<tr><td class="guild-report-post" data-label="Mensagem"><a href="${topicHref(r.post.topic.id)}">${esc(r.post.topic.title)}</a>${r.post.topic.deleted ? ' <span class="status-chip bad">tópico removido</span>' : ""}<blockquote>${esc(r.post.excerpt)}</blockquote><span class="muted small">por ${esc(r.post.author?.name || "—")}${r.post.deleted ? " · mensagem já removida" : ""}</span></td><td data-label="Denunciante">${esc(r.reporter?.name || "—")}<br><span class="muted small">${timeTag(r.createdAt)}</span></td><td class="guild-report-reason" data-label="Motivo">${esc(r.reason)}</td><td class="num" data-label="Denúncias do post">${esc(r.postReports)}</td><td data-label="${status === "open" ? "Decisão" : "Resultado"}">${
        status === "open"
          ? `<div class="guild-report-actions">${button("Arquivar", "guild-resolve", r.id + ":dismissed", "subtle small")}${button("Remover mensagem", "guild-resolve", r.id + ":removed", "danger small")}</div>`
          : `<span class="status-chip ${r.resolution === "removed" ? "bad" : "quiet"}">${r.resolution === "removed" ? "Mensagem removida" : "Arquivada"}</span><br><span class="muted small">${esc(r.resolvedBy || "")} · ${timeTag(r.resolvedAt)}</span>`
      }</td></tr>`,
    )
    .join("");
  return `<p class="list-summary">${esc(data.total)} ${data.total === 1 ? "denúncia" : "denúncias"}</p><div class="data-table-wrap"><table class="data-table guild-reports"><caption class="sr-only">Denúncias ${status === "open" ? "abertas" : "resolvidas"}</caption><thead><tr><th scope="col">Mensagem</th><th scope="col">Denunciante</th><th scope="col">Motivo</th><th scope="col">Denúncias do post</th><th scope="col">${status === "open" ? "Decisão" : "Resultado"}</th></tr></thead><tbody>${rows}</tbody></table></div><nav class="pagination" aria-label="Páginas de denúncias">${pager(data.page, data.total, "guild-mod-page")}</nav>`;
}
function resolveReport(value) {
  const [id, resolution] = String(value).split(":");
  if (!/^\d+$/.test(id) || !["dismissed", "removed"].includes(resolution)) return;
  const removed = resolution === "removed";
  reasonModal(
    removed ? "Remover mensagem denunciada" : "Arquivar denúncia",
    removed ? "A mensagem será removida e todas as denúncias abertas dela serão resolvidas." : "A mensagem continua publicada; a denúncia sai da fila.",
    "Justificativa da decisão",
    removed ? "Remover mensagem" : "Arquivar denúncia",
    async (data) => {
      try {
        await api(`/guild/moderation/reports/${id}/resolve`, "POST", { resolution, note: data.reason });
        toast(removed ? "Mensagem removida e denúncias resolvidas." : "Denúncia arquivada.");
      } catch (error) {
        if (error.status !== 409) throw error;
        toast(error.message); // outra pessoa da moderação decidiu antes: só atualiza a fila
      }
      $("#modal").close();
      await show();
    },
    { danger: removed, max: LIMITS.noteMax },
  );
}
async function deletedTopicsPanel() {
  const data = await api(`/guild/topics?deleted=true&page=${modState.page}`);
  modState.deleted = data.items;
  if (!data.items.length) return `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚖</span><h3>Nenhum tópico removido.</h3><p>Tópicos removidos pela equipe ou pelo autor aparecem aqui para restauração.</p></div>`;
  return `<div class="guild-topic-list">${data.items.map((t) => `<div class="guild-deleted-row">${topicRow(t, true)}${button("Restaurar", "guild-topic-restore", t.id, "subtle small")}</div>`).join("")}</div><nav class="pagination" aria-label="Páginas de tópicos removidos">${pager(data.page, data.total, "guild-mod-page")}</nav>`;
}
function restoreTopic(id) {
  const t = modState.deleted?.find((x) => x.id === id);
  if (!t) return;
  reasonModal("Restaurar tópico", "O tópico volta às listas da categoria.", "Motivo", "Restaurar", async (data) => {
    await api(`/guild/moderation/topics/${t.id}`, "POST", { deleted: false, reason: data.reason, revision: t.revision });
    toast("Tópico restaurado.");
    await show();
  });
}
async function categoriesPanel() {
  const items = await api("/guild/admin/categories");
  modState.categories = items;
  const rows = items
    .map(
      (c) => `<tr><td class="num">${esc(c.order)}</td><td><strong>${esc(c.name)}</strong><br><span class="muted small">${esc(c.slug)}</span></td><td>${esc(c.description)}</td><td class="num">${esc(c.minLevelToPost)}</td><td>${c.staffOnly ? '<span class="status-chip warn">Sim</span>' : '<span class="status-chip quiet">Não</span>'}</td><td class="num">${esc(c.topicCount)}</td><td>${c.archived ? '<span class="status-chip quiet">Arquivada</span>' : '<span class="status-chip good">Ativa</span>'}</td><td><div class="guild-report-actions">${button("Editar", "guild-cat-edit", c.id, "subtle small")}${button(c.archived ? "Reativar" : "Arquivar", "guild-cat-archive", c.id, "subtle small")}${button("Excluir", "guild-cat-delete", c.id, "danger small", c.topicCount ? 'disabled title="Tem tópicos: arquive em vez de excluir"' : "")}</div></td></tr>`,
    )
    .join("");
  return `<div class="section-title"><h2>Categorias</h2>${button("+ Nova categoria", "guild-cat-new", "", "primary")}</div><div class="data-table-wrap"><table class="data-table"><caption class="sr-only">Categorias da Guilda</caption><thead><tr><th scope="col">Ordem</th><th scope="col">Nome</th><th scope="col">Descrição</th><th scope="col">Nível mín.</th><th scope="col">Só equipe</th><th scope="col">Tópicos</th><th scope="col">Estado</th><th scope="col">Ações</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted small">Categorias com tópicos não podem ser excluídas: arquive para tirá-las do salão sem perder o histórico.</p>`;
}
function categoryInput(c, overrides = {}) {
  return {
    name: c.name,
    slug: c.slug,
    description: c.description,
    order: Number(c.order),
    minLevelToPost: Number(c.minLevelToPost),
    staffOnly: !!c.staffOnly,
    archived: !!c.archived,
    ...overrides,
  };
}
function categoryForm(c) {
  modal(
    c ? "Editar categoria" : "Nova categoria",
    `<form id="guild-cat-form"><div class="field"><label for="gc-name">Nome</label><input id="gc-name" name="name" required minlength="2" maxlength="60" value="${esc(c?.name || "")}"></div><div class="field"><label for="gc-slug">Identificador (endereço)</label><input id="gc-slug" name="slug" required minlength="2" maxlength="60" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(c?.slug || "")}" aria-describedby="gc-slug-hint"><small class="muted" id="gc-slug-hint">Minúsculas, números e hífens. Ex.: contos-de-mesa</small></div><div class="field"><label for="gc-desc">Descrição</label><input id="gc-desc" name="description" maxlength="300" value="${esc(c?.description || "")}"></div><div class="guild-form-row"><div class="field"><label for="gc-order">Ordem</label><input id="gc-order" name="order" type="number" min="0" max="1000" required value="${esc(c?.order ?? 10)}"></div><div class="field"><label for="gc-level">Nível mínimo para abrir tópicos</label><input id="gc-level" name="minLevelToPost" type="number" min="1" max="100" required value="${esc(c?.minLevelToPost ?? 1)}"></div></div><label class="guild-check"><input type="checkbox" name="staffOnly" ${c?.staffOnly ? "checked" : ""}> Somente a equipe abre tópicos</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">${c ? "Salvar categoria" : "Criar categoria"}</button></div></form>`,
  );
  $("#guild-cat-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const input = {
        name: data.name,
        slug: data.slug,
        description: data.description,
        order: Number(data.order),
        minLevelToPost: Number(data.minLevelToPost),
        staffOnly: data.staffOnly === "on",
        archived: !!c?.archived,
      };
      await api("/guild/admin/categories" + (c ? "/" + c.id : ""), c ? "PUT" : "POST", input);
      $("#modal").close();
      toast(c ? "Categoria atualizada." : "Categoria criada.");
      await show();
    });
  };
}
async function archiveCategory(c) {
  try {
    await api(`/guild/admin/categories/${c.id}`, "PUT", categoryInput(c, { archived: !c.archived }));
    toast(c.archived ? "Categoria reativada." : "Categoria arquivada.");
    await show();
  } catch (error) {
    toast(error.message);
  }
}
function deleteCategory(c) {
  modal(
    "Excluir categoria?",
    `<p>A categoria <strong>${esc(c.name)}</strong> será excluída.</p><p class="muted small">Somente categorias sem tópicos podem ser excluídas.</p><form id="guild-cat-delete">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir categoria</button></div></form>`,
  );
  $("#guild-cat-delete").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      await api(`/guild/admin/categories/${c.id}`, "DELETE");
      $("#modal").close();
      toast("Categoria excluída.");
      await show();
    });
  };
}

// ---------- Eventos ----------
function onClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target || !target.dataset.action.startsWith("guild-")) return;
  const id = target.dataset.id;
  const run = (task) => Promise.resolve(task).catch((error) => toast(error.message));
  switch (target.dataset.action) {
    case "guild-retry":
      return run(show());
    case "guild-new": {
      let allowed = [];
      try {
        allowed = JSON.parse($("#main").dataset.allowed || "[]");
      } catch {
        allowed = [];
      }
      return run(openNewTopic(allowed, id || allowed[0]?.id));
    }
    case "guild-list-page":
      listState.page = Math.max(1, Number(id) || 1);
      return run(show());
    case "guild-mod-page":
      modState.page = Math.max(1, Number(id) || 1);
      return run(show());
    case "guild-useful":
      return run(toggleUseful(target));
    case "guild-reply-to": {
      const post = findPost(id);
      const box = $("#g-reply");
      if (!box) return;
      if (post && !box.value.trim()) box.value = `@${post.author?.name || ""} `;
      box.dispatchEvent(new Event("input"));
      box.scrollIntoView({ block: "center" });
      box.focus();
      return;
    }
    case "guild-author":
      return run(openAuthor(id));
    case "guild-edit":
      return editPost(id);
    case "guild-delete":
      return deletePost(id);
    case "guild-report":
      return reportPost(id);
    case "guild-mod-remove":
      return moderatePost(id, false);
    case "guild-mod-restore":
      return moderatePost(id, true);
    case "guild-topic-tool":
      return run(topicTool(id));
    case "guild-resolve":
      return resolveReport(id);
    case "guild-topic-restore":
      return restoreTopic(id);
    case "guild-cat-new":
      return categoryForm(null);
    case "guild-cat-edit":
      return categoryForm(modState.categories?.find((c) => c.id === id));
    case "guild-cat-archive": {
      const c = modState.categories?.find((x) => x.id === id);
      return c && run(archiveCategory(c));
    }
    case "guild-cat-delete": {
      const c = modState.categories?.find((x) => x.id === id);
      return c && deleteCategory(c);
    }
  }
}
