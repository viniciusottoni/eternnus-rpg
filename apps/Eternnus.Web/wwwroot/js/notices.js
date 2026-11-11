// Indicadores de novidade (ADR-069): contadores do menu, selos nos cartões/abas e destaque dos itens novos.
// O servidor decide o que é novidade e para quem; este módulo só apresenta e pede "visto" (POST) depois de mostrar.
// Regra de apresentação: o que a pessoa vê numa tela continua destacado enquanto ela estiver ali; some ao sair.
import { api } from "./api.js";
import { state } from "./state.js";
import { esc } from "./ui.js";

const POLL_MS = 60_000;
let summary = null;
let pending = null;
let installed = false;
let timer = 0;
// "Visto" em andamento: as consultas seguintes esperam por ele para não trazer de volta o que acabou de ser visto.
let seenChain = Promise.resolve();
// Contador do destino aberto, preservado até a navegação seguinte (o "visto" não apaga o selo diante da pessoa).
let held = { route: "", value: 0 };

const routeOf = (hash) => String(hash || "").replace(/^#/, "").split("/")[0] || "overview";
/** Quantidade de novidades de cada destino do menu. */
const NAV = {
  overview: (s) => s.home,
  campaigns: (s) => s.campaigns,
  "one-shot": (s) => s.oneShots,
  guild: (s) => s.guild,
  progress: (s) => s.progress,
  support: (s) => s.support,
  admin: (s) => s.supportQueue,
};

export const currentNotices = () => summary;

/** Texto do selo: número até 99, depois "99+". */
export const badgeText = (n) => (n > 99 ? "99+" : String(n));
const plural = (n) => `${badgeText(n)} ${n === 1 ? "novidade" : "novidades"}`;

/** Selo vermelho com a quantidade (vazio quando não há novidade). `label` completa o nome acessível. */
export function newsBadge(n, label = "") {
  const value = Number(n) || 0;
  if (value <= 0) return "";
  const name = label ? `${plural(value)} em ${label}` : plural(value);
  return `<span class="news-badge" data-tip="${esc(plural(value))}"><span aria-hidden="true">${badgeText(value)}</span><span class="sr-only">${esc(name)}</span></span>`;
}

/** Quantidade para um destino do menu, respeitando o valor preservado do destino aberto. */
export function navCount(route) {
  const value = summary && NAV[route] ? Number(NAV[route](summary)) || 0 : 0;
  if (route === held.route) return Math.max(value, held.value);
  return value;
}

/** Atualiza os selos do menu lateral, da barra inferior e do botão "Mais" sem recriar o menu. */
export function paintNav() {
  document.querySelectorAll(".app-shell a.nav-item[href^='#']").forEach((link) => {
    const route = routeOf(link.getAttribute("href"));
    if (!(route in NAV)) return;
    const label = [...link.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
    const html = newsBadge(navCount(route), label);
    const current = link.querySelector(".news-badge");
    if (!html) current?.remove();
    else if (current) current.outerHTML = html;
    else link.insertAdjacentHTML("beforeend", html);
  });
  paintSlots();
  const more = document.querySelector(".app-shell .nav-more");
  if (more) {
    const total = [...document.querySelectorAll("#nav-more-panel a.nav-item")].reduce((sum, link) => sum + navCount(routeOf(link.getAttribute("href"))), 0);
    more.querySelector(".news-dot")?.remove();
    if (total > 0) more.insertAdjacentHTML("beforeend", `<span class="news-dot"><span class="sr-only">${esc(plural(total))} em Mais caminhos</span></span>`);
  }
}

/** Contador de um marcador de página: `campaign:{id}`, `guild:{slug}`, `moderation` ou `queue` (fila do Admin). */
function slotCount(slot) {
  if (!summary) return 0;
  const [kind, key] = String(slot).split(":");
  if (kind === "campaign") return Number(summary.byCampaign?.[key]) || 0;
  if (kind === "guild") return Number(summary.guildCategories?.[key]) || 0;
  if (kind === "moderation") return Number(summary.moderation) || 0;
  if (kind === "queue") return Number(summary.supportQueue) || 0;
  return 0;
}

/** Marcador de selo em cartões/botões, preenchido agora e a cada atualização dos contadores. */
export function newsSlot(slot, label = "") {
  return `<span class="news-slot" data-news-count="${esc(slot)}" data-news-label="${esc(label)}">${newsBadge(slotCount(slot), label)}</span>`;
}

function paintSlots() {
  document.querySelectorAll("[data-news-count]").forEach((node) => {
    const html = newsBadge(slotCount(node.dataset.newsCount), node.dataset.newsLabel || "");
    if (node.innerHTML !== html) node.innerHTML = html;
  });
}

/** Busca os contadores (em segundo plano). Conta pendente de verificação não consulta. */
export function refreshNotices() {
  if (!state.user?.verified) { summary = null; return Promise.resolve(null); }
  if (pending) return pending;
  pending = seenChain.then(() => api("/notices", "GET", undefined, { background: true }))
    .then((data) => { summary = data; paintNav(); return data; })
    .catch(() => summary)
    .finally(() => { pending = null; });
  return pending;
}

/** Contadores atuais, aguardando a consulta em andamento (para telas que destacam itens ao abrir). */
export function ensureNotices() {
  return pending || (summary ? Promise.resolve(summary) : refreshNotices());
}

/** Registra "visto" do próprio usuário. Falha silenciosa: o indicador volta na próxima consulta. */
export function markSeen(body) {
  if (!state.user?.verified) return Promise.resolve();
  seenChain = seenChain.then(() => api("/notices/seen", "POST", body, { background: true })).catch(() => {});
  return seenChain;
}

/** Novidades de uma campanha (por área e itens). Nulo se a consulta falhar: a página segue sem selos. */
export function campaignNotices(id) {
  return seenChain.then(() => api(`/notices/campaigns/${encodeURIComponent(id)}`, "GET", undefined, { background: true })).catch(() => null);
}

const escapeAttr = (value) => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));
const ITEM_HOST = "li, tr, article, figure, .card, .metal";

/**
 * Destaca, dentro de `root`, os elementos ligados às chaves novas: links que apontam para o item (`href` termina na chave),
 * botões com `data-id`, linhas com `id` terminado na chave, imagens servidas pela rota do item ou `data-news-key`.
 * O destaque vai para o item de lista que os contém.
 */
export function highlightNew(root, keys) {
  if (!root || !keys?.length) return;
  for (const key of keys) {
    const k = escapeAttr(String(key));
    const nodes = root.querySelectorAll(`[href$="/${k}"], [href*="/${k}?"], [data-id="${k}"], [data-news-key="${k}"], [id$="-${k}"], img[src*="/${k}/"]`);
    nodes.forEach((node) => {
      const host = node.matches?.("[data-news-key]") ? node : node.closest(ITEM_HOST) || node;
      if (host.classList.contains("is-new") || host.closest(".page-tabs, .sub-tabs, nav")) return;
      host.classList.add("is-new");
      const anchor = host.querySelector("h3, h4, strong, a") || host;
      if (!host.querySelector(":scope .new-pill")) anchor.insertAdjacentHTML("afterend", '<span class="new-pill">Novo</span>');
    });
  }
}

/** Mantém o destaque em conteúdo que chega depois (paginação, carregamento sob demanda). Devolve o descarte. */
export function keepHighlighted(root, keys) {
  if (!root || !keys?.length) return () => {};
  highlightNew(root, keys);
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; highlightNew(root, keys); });
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Ação explícita ("marcar tudo como lido"): o selo do destino aberto não precisa esperar a navegação. */
export function releaseHeld() {
  held = { route: "", value: 0 };
  return refreshNotices();
}

/** Instala a atualização periódica (aba visível) e a troca de destino. Uma vez. */
export function installNotices() {
  if (installed) return;
  installed = true;
  const schedule = () => {
    clearInterval(timer);
    timer = document.hidden ? 0 : setInterval(refreshNotices, POLL_MS);
  };
  document.addEventListener("visibilitychange", () => { schedule(); if (!document.hidden) refreshNotices(); });
  schedule();
}

/** Chamado pelo roteador ao entrar num destino: guarda o selo dele até a próxima navegação e atualiza o resto. */
export function enterRoute(hash) {
  const route = routeOf(hash);
  const before = navCount(route);
  held = { route, value: before };
  return refreshNotices().then(() => {
    if (held.route === route) held.value = Math.max(before, navCount(route));
    paintNav();
  });
}
