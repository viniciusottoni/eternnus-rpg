// Tabelas da plataforma: busca geral, filtros por coluna e paginação de 15 itens.
// Regras puras (filtrar, paginar) ficam separadas da apresentação para teste em Node.
import { esc, button } from "./ui.js";

export const TABLE_PAGE_SIZE = 15;

/** Texto para comparação: minúsculas e sem acento. */
export const normalizeText = (value) =>
  String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Busca geral: cada termo (separado por espaço) deve aparecer em algum dos campos. */
export function matchesQuery(row, fields, q) {
  const terms = normalizeText(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = fields.map((f) => normalizeText(typeof f === "function" ? f(row) : row[f])).join(" ");
  return terms.every((t) => haystack.includes(t));
}

/** Filtros por coluna: `filters` = {chave: valor}; valor vazio ignora o filtro. Igualdade exata. */
export function filterRows(rows, { q = "", fields = [], filters = {} } = {}) {
  const active = Object.entries(filters).filter(([, v]) => v !== "" && v != null);
  return rows.filter((row) =>
    matchesQuery(row, fields, q) && active.every(([key, value]) => String(row[key] ?? "") === String(value)));
}

/** Fatia da página atual, com a página limitada ao intervalo válido. */
export function pageSlice(rows, page = 1, size = TABLE_PAGE_SIZE) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { items: rows.slice((current - 1) * size, current * size), total, page: current, pages, pageSize: size };
}

/**
 * Barra padrão de toda lista: busca geral, filtros por coluna e o botão "Buscar" (secundário, sempre presente).
 * Não há botão "Limpar": apagar a busca e voltar os filtros para "Todos" já mostra a lista inteira.
 * `filters`: [{name, label, options: [[valor, rótulo]], value, all}]; `all` troca o rótulo da opção vazia ("Todos").
 * `search.name` troca o nome do campo de busca (padrão `q`); `search.max`, o limite (padrão 100).
 */
export function controlsHtml(id, { search = {}, filters = [] } = {}) {
  const selects = filters.map((f) => `<div class="field"><label for="${id}-f-${esc(f.name)}">${esc(f.label)}</label><select id="${id}-f-${esc(f.name)}" name="${esc(f.name)}">${[["", f.all || "Todos"], ...f.options].map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`).join("");
  return `<form class="search-bar table-controls" role="search" id="${id}-controls"><div class="field"><label for="${id}-q">${esc(search.label || "Buscar na tabela")}</label><input id="${id}-q" name="${esc(search.name || "q")}" type="search" maxlength="${Number(search.max) || 100}" value="${esc(search.value || "")}" placeholder="${esc(search.placeholder || "")}" aria-describedby="${id}-q-hint"><small id="${id}-q-hint" class="form-help" aria-live="polite"></small></div>${selects}<div class="table-controls-actions"><button type="submit" class="subtle">Buscar</button></div></form>`;
}

/**
 * Tabelas no cliente: aplica busca e filtros ao digitar (com espera curta), ao trocar um select ou em "Buscar".
 * Os ouvintes ficam no próprio formulário (somem com ele). Redesenhe só a área da tabela em `apply({q, filters})`,
 * nunca o formulário, para não perder o cursor de quem digita.
 */
export function bindLiveControls(form, apply, wait = 200) {
  if (!form) return;
  let timer;
  const run = () => { clearTimeout(timer); apply(readControls(form)); };
  form.addEventListener("input", (e) => { if (e.target.type === "search") { clearTimeout(timer); timer = setTimeout(run, wait); } });
  form.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") run(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
}

/** Lê os valores da barra de controles (busca e filtros). */
export function readControls(form) {
  const data = new FormData(form);
  const searchName = form.querySelector("input[type='search']")?.name || "q";
  const filters = {};
  for (const [key, value] of data.entries()) if (key !== searchName) filters[key] = String(value);
  return { q: String(data.get(searchName) || "").trim(), filters };
}

/** Paginação de 15 itens; `action` vai no data-action dos botões e o número da página em data-id. */
export function pagerHtml({ page, pages, total }, action, label = "itens") {
  if (pages <= 1) return "";
  return `<nav class="pagination" aria-label="Páginas da tabela">${button("← Anterior", action, page - 1, "subtle small", page <= 1 ? "disabled" : "")}<span>Página ${page} de ${pages} · ${total} ${label}</span>${button("Próxima →", action, page + 1, "subtle small", page >= pages ? "disabled" : "")}</nav>`;
}

/**
 * Tabela inteira no cliente (lista já carregada e limitada): controles desenhados uma vez, repintura só dos resultados,
 * 15 por página. `table(items)` devolve o HTML da tabela da página; `afterPaint(results)` liga o que for preciso
 * (ex.: imagem com fallback). Devolve `repaint` para quem precisar redesenhar.
 */
export function mountClientTable(box, { id, rows, fields, filters = [], search = {}, table, unit = "itens", emptyText = "", afterPaint = () => {} }) {
  const view = { q: "", filters: {}, page: 1 };
  box.innerHTML = `${controlsHtml(id, { search, filters })}<div id="${id}-results"></div>`;
  const results = box.querySelector(`#${id}-results`);
  const paint = (focusSel = "") => {
    const list = filterRows(rows, { q: view.q, fields, filters: view.filters });
    const p = pageSlice(list, view.page);
    view.page = p.page;
    const filtered = Boolean(view.q || Object.values(view.filters).some(Boolean));
    results.innerHTML = list.length ? table(p.items) + pagerHtml(p, `${id}-page`, unit) : emptyTableHtml(filtered, emptyText);
    afterPaint(results);
    if (focusSel) results.querySelector(focusSel)?.focus();
  };
  bindLiveControls(box.querySelector(`#${id}-controls`), ({ q, filters: values }) => { Object.assign(view, { q, filters: values, page: 1 }); paint(); });
  results.addEventListener("click", (e) => {
    const b = e.target.closest(`[data-action='${id}-page']`);
    if (b && !b.disabled) { view.page = Number(b.dataset.id); paint(".data-table-wrap"); }
  });
  paint();
  return { repaint: paint };
}

/** Mensagem de resultado vazio com e sem filtros aplicados. */
export const emptyTableHtml = (filtered, emptyText) =>
  `<p class="muted small" role="status">${filtered ? "Nenhum resultado com estes filtros. Ajuste a busca ou volte os filtros para “Todos”." : esc(emptyText)}</p>`;
