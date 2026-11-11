// Busca geral da campanha (Visão geral) e NPCs que o mestre compartilhou com o grupo.
import { api } from "./api.js";
import { $, esc, button, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { safeImageUrl } from "./play-policy.js";
import { controlsHtml, readControls, pagerHtml, emptyTableHtml } from "./data-table.js";

const KINDS = Object.freeze({
  premise: "Premissa", session: "Sessão", chapter: "Capítulo", page: "Mundo", note: "Nota", objective: "Objetivo",
  clue: "Pista", library: "Biblioteca", npc: "NPC", scene: "Cena preparada",
});
// Rotas vêm do servidor, mas só seguem o formato conhecido da própria campanha.
const ROUTE = /^campaign\/[0-9a-f-]{36}(\/[a-z]+(\/[a-z0-9-]{1,48})?)?$/i;

export function searchForm(d) {
  return `<section class="campaign-search metal" aria-labelledby="cs-title"><h2 id="cs-title" class="small-heading">Buscar na campanha${helpButton("campanhas.busca.geral", "Busca na campanha")}</h2><form id="cs-form" class="search-bar table-controls" role="search"><div class="field"><label for="cs-q" class="sr-only">Termo de busca</label><input id="cs-q" name="q" type="search" minlength="2" maxlength="100" required placeholder="Nome, lugar, acontecimento…" aria-describedby="cs-hint"></div><div class="field"><label for="cs-kind" class="sr-only">Tipo</label><select id="cs-kind" name="kind"><option value="">Todos os tipos</option>${Object.entries(KINDS).filter(([v]) => d.isMaster || v !== "scene").map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></div><div class="table-controls-actions"><button type="submit" class="subtle">Buscar</button></div><small id="cs-hint" class="form-help search-extra">${d.isMaster ? "Sessões, capítulos, mundo, notas, diário, NPCs e cenas." : "Sessões publicadas, mundo, suas notas, diário e NPCs conhecidos."}</small></form><div id="cs-results" aria-live="polite"></div></section>`;
}

/** Busca geral: tabela paginada de 15 itens no servidor. Filtros de tipo e página vão na consulta. */
export function mountSearch(d) {
  const form = $("#cs-form"), results = $("#cs-results");
  if (!form) return;
  const state = { q: "", kind: "", page: 1 };
  /** `focusSel`: o que recebe o foco depois de redesenhar (o botão clicado some no redesenho). */
  const load = async (focusSel = "") => {
    results.innerHTML = '<p class="loading-line" role="status">Buscando…</p>';
    try {
      const params = new URLSearchParams({ q: state.q, page: String(state.page) });
      if (state.kind) params.set("kind", state.kind);
      const r = await api(`/campaigns/${d.id}/search?${params}`);
      if (!results.isConnected) return;
      state.page = r.page;
      const items = r.items.filter((i) => ROUTE.test(i.route));
      const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
      const table = items.length
        ? `<div class="data-table-wrap" tabindex="0" role="region" aria-label="Resultados da busca"><table class="data-table stack-table search-table"><caption class="sr-only">Resultados para ${esc(r.q)}, página ${r.page} de ${pages}</caption><thead><tr><th scope="col">Tipo</th><th scope="col">Título</th><th scope="col">Trecho</th><th scope="col">Abrir</th></tr></thead><tbody>${items.map((i) => `<tr><td data-label="Tipo"><span class="status-chip">${esc(KINDS[i.kind] || "Conteúdo")}</span></td><td data-label="Título"><strong>${esc(i.title)}</strong></td><td data-label="Trecho" class="small">${esc(i.excerpt || "")}</td><td data-label="Abrir"><a class="button subtle small" href="#${esc(i.route)}">Abrir</a></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted small" role="status">Nada encontrado para “${esc(r.q)}”${state.kind ? " neste tipo" : ""}.</p>`;
      const pager = pages > 1 ? `<nav class="pagination" aria-label="Páginas da busca">${button("← Anterior", "cs-page", state.page - 1, "subtle small", state.page <= 1 ? "disabled" : "")}<span>Página ${r.page} de ${pages} · ${r.total} ${r.total === 1 ? "resultado" : "resultados"} para “${esc(r.q)}”</span>${button("Próxima →", "cs-page", state.page + 1, "subtle small", state.page >= pages ? "disabled" : "")}</nav>` : `<p class="muted small" role="status">${r.total} ${r.total === 1 ? "resultado" : "resultados"} para “${esc(r.q)}”.</p>`;
      const notice = r.truncated ? `<p class="muted small" role="status">Mostrando os primeiros 500 acertos. Refine a busca para ver mais.</p>` : "";
      results.innerHTML = table + notice + pager;
      if (focusSel) results.querySelector(focusSel)?.focus();
    } catch (error) {
      if (results.isConnected) results.innerHTML = `<p role="alert">${esc(error.message)}</p>${button("Tentar novamente", "cs-retry", "", "subtle small")}`;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const q = String(data.get("q") || "").trim();
    if (q.length < 2) { results.innerHTML = '<p class="muted small" role="status">Digite ao menos 2 caracteres.</p>'; return; }
    Object.assign(state, { q, kind: String(data.get("kind") || ""), page: 1 });
    await load();
  };
  // Trocar o tipo refaz a busca atual; sem termo, o tipo vale para a próxima busca.
  form.onchange = async (e) => {
    if (e.target.id !== "cs-kind" || !state.q) return;
    Object.assign(state, { kind: e.target.value, page: 1 });
    await load();
  };
  results.onclick = async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled) return;
    if (b.dataset.action === "cs-page") { state.page = Number(b.dataset.id); await load(".data-table-wrap"); }
    if (b.dataset.action === "cs-retry") await load();
  };
}

// Mesma regra de imagem da mesa: link https validado ou o retrato protegido do NPC conhecido.
const safeImage = (url) => safeImageUrl(url) || "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Link "Ler página": só com id válido. O servidor já filtra pelo direito de leitura; o mestre também vê se o grupo alcança a página. */
const loreLink = (d, page) => {
  if (!page || !UUID.test(page.id || "")) return "";
  const note = d.isMaster && page.visibility !== "table" ? `<small class="muted">${page.visibility === "selected" ? "Só as pessoas escolhidas na página veem este link." : "Página privada: o grupo não vê este link."}</small>` : "";
  return `<p class="small"><a class="lore-link" href="#campaign/${esc(d.id)}/world/${esc(page.id)}" aria-label="Ler a página ${esc(page.title)}">Ler página: ${esc(page.title)}</a></p>${note}`;
};

/** NPCs conhecidos em tabela paginada de 15: busca, tipo e página vêm do servidor. `focus`: id do NPC vindo da busca. */
export async function renderKnownNpcs(d, target, focus = "", page = 1, filter = {}) {
  const state = { q: filter.q || "", kind: filter.kind || "", page };
  await loadKnown(d, target, state, focus);
}

/** `focus`: NPC vindo da busca (o servidor abre na página dele). `focusSel`: controle que recebe o foco após redesenhar. */
async function loadKnown(d, target, state, focus, focusSel = "") {
  target.innerHTML = '<p class="loading-line" role="status">Reunindo os rostos conhecidos…</p>';
  try {
    const params = new URLSearchParams({ page: String(state.page) });
    if (state.q) params.set("q", state.q);
    if (state.kind) params.set("kind", state.kind);
    if (focus && UUID.test(focus)) params.set("focus", focus);
    const r = await api(`/campaigns/${d.id}/known-npcs?${params}`);
    if (!target.isConnected) return;
    state = { ...state, page: r.page };
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    const filtered = Boolean(state.q || state.kind);
    const rows = r.items.map((n) => {
      const img = safeImage(n.image);
      const portrait = img ? `<button type="button" class="known-npc-zoom" data-zoom data-tip="Ver imagem em tamanho grande" aria-label="Ver a imagem de ${esc(n.name)} em tamanho grande"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async"></button>` : `<span class="known-npc-initial" aria-hidden="true">${esc((n.name || "?").trim().charAt(0).toUpperCase())}</span>`;
      return `<tr id="npc-${esc(n.id)}" tabindex="-1"><td data-label="Imagem">${portrait}</td><td data-label="Nome"><strong>${esc(n.name)}</strong></td><td data-label="Tipo"><span class="status-chip">${n.kind === "creature" ? "Criatura" : "Personagem"}</span></td><td data-label="Resumo" class="small">${esc(n.summary || "")}</td><td data-label="História">${loreLink(d, n.page) || '<span class="muted small">—</span>'}</td></tr>`;
    }).join("");
    const controls = controlsHtml("kn", {
      search: { label: "Buscar NPCs conhecidos", placeholder: "Nome ou resumo", value: state.q },
      filters: [{ name: "kind", label: "Tipo", options: [["npc", "Personagem"], ["creature", "Criatura"]], value: state.kind }],
    });
    target.innerHTML = `<div class="section-title"><h2>NPCs conhecidos</h2>${d.isMaster ? `<a class="button subtle small" href="#campaign/${esc(d.id)}/prep">Gerenciar em Preparação</a>` : ""}</div><p class="muted small section-lead">${d.isMaster ? "Aparecem aqui os personagens marcados como “Visível para os jogadores”. O grupo vê nome, tipo, resumo, imagem e a página de história, se puder lê-la. Lado, recursos, ficha e notas continuam com você." : "Personagens que o mestre apresentou ao grupo."}</p>${controls}${
      r.items.length
        ? `<div class="data-table-wrap" tabindex="0" role="region" aria-label="NPCs conhecidos"><table class="data-table stack-table known-npc-table"><caption class="sr-only">NPCs conhecidos, página ${r.page} de ${pages}${filtered ? ", com filtros" : ""}</caption><thead><tr><th scope="col">Imagem</th><th scope="col">Nome</th><th scope="col">Tipo</th><th scope="col">Resumo</th><th scope="col">História</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : emptyTableHtml(filtered, d.isMaster ? "Nenhum personagem compartilhado. Edite um personagem em Preparação e marque “Visível para os jogadores”." : "O mestre ainda não apresentou nenhum NPC.")
    }${pagerHtml({ page: r.page, pages, total: r.total }, "kn-page", "NPCs")}`;
    target.querySelectorAll(".known-npc-zoom img").forEach((img) => img.addEventListener("error", () => img.closest(".known-npc-zoom").replaceWith(Object.assign(document.createElement("span"), { className: "known-npc-initial", ariaHidden: "true", textContent: img.closest("tr").querySelector("strong").textContent.trim().charAt(0).toUpperCase() })), { once: true }));
    target.onsubmit = (e) => {
      if (e.target.id !== "kn-controls") return;
      e.preventDefault();
      const { q, filters } = readControls(e.target);
      // Mesmo mínimo do servidor: evita um 400 por um termo de 1 caractere.
      if (q.length === 1) { const hint = target.querySelector("#kn-q-hint"); if (hint) hint.textContent = "Digite ao menos 2 caracteres ou deixe vazio."; target.querySelector("#kn-q")?.focus(); return; }
      loadKnown(d, target, { q, kind: filters.kind || "", page: 1 }, "", "#kn-q");
    };
    target.onclick = async (e) => {
      // Imagem em tamanho grande: mesmo visualizador da mesa (npc-sheet.js), carregado sob demanda.
      const zoom = e.target.closest("[data-zoom]");
      if (zoom) {
        try { (await import("./npc-sheet.js")).showImage(zoom.querySelector("img")?.getAttribute("src"), zoom.closest("tr").querySelector("strong").textContent); }
        catch (error) { toast(error.message); }
        return;
      }
      const b = e.target.closest("[data-action='kn-page']");
      if (b && !b.disabled) loadKnown(d, target, { ...state, page: Number(b.dataset.id) }, "", ".data-table-wrap");
      const retry = e.target.closest("[data-action='kn-retry']");
      if (retry) loadKnown(d, target, state, focus);
    };
    if (focusSel) target.querySelector(focusSel)?.focus();
    if (focus) { const row = document.getElementById("npc-" + focus); if (row) { row.scrollIntoView({ block: "center" }); row.classList.add("is-target"); row.focus({ preventScroll: true }); } }
  } catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<p role="alert">${esc(error.message)}</p>${button("Tentar novamente", "kn-retry", "", "subtle small")}`;
    target.onclick = (e) => { if (e.target.closest("[data-action='kn-retry']")) loadKnown(d, target, state, focus); };
  }
}
