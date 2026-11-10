// Busca geral da campanha (Visão geral) e NPCs que o mestre compartilhou com o grupo.
import { api } from "./api.js";
import { $, esc, button } from "./ui.js";
import { helpButton } from "./help.js";

const KINDS = Object.freeze({
  premise: "Premissa", session: "Sessão", chapter: "Capítulo", page: "Mundo", note: "Nota", objective: "Objetivo",
  clue: "Pista", library: "Biblioteca", npc: "NPC", scene: "Cena preparada",
});
// Rotas vêm do servidor, mas só seguem o formato conhecido da própria campanha.
const ROUTE = /^campaign\/[0-9a-f-]{36}(\/[a-z]+(\/[a-z0-9-]{1,48})?)?$/i;

export function searchForm(d) {
  return `<section class="campaign-search metal" aria-labelledby="cs-title"><h2 id="cs-title" class="small-heading">Buscar na campanha${helpButton("campanhas.busca.geral", "Busca na campanha")}</h2><form id="cs-form" class="search-bar" role="search"><div class="field"><label for="cs-q" class="sr-only">Termo de busca</label><input id="cs-q" name="q" type="search" minlength="2" maxlength="100" required placeholder="Nome, lugar, acontecimento…" aria-describedby="cs-hint"><small id="cs-hint" class="form-help">${d.isMaster ? "Sessões, capítulos, mundo, notas, diário, NPCs e cenas." : "Sessões publicadas, mundo, suas notas, diário e NPCs conhecidos."}</small></div><button type="submit" class="subtle">Buscar</button></form><div id="cs-results" aria-live="polite"></div></section>`;
}

export function mountSearch(d) {
  const form = $("#cs-form"), results = $("#cs-results");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = String(new FormData(form).get("q") || "").trim();
    if (q.length < 2) { results.innerHTML = '<p class="muted small" role="status">Digite ao menos 2 caracteres.</p>'; return; }
    results.innerHTML = '<p class="loading-line" role="status">Buscando…</p>';
    try {
      const r = await api(`/campaigns/${d.id}/search?q=${encodeURIComponent(q)}`);
      if (!results.isConnected) return;
      const items = r.items.filter((i) => ROUTE.test(i.route));
      results.innerHTML = items.length
        ? `<p class="muted small" role="status">${items.length} ${items.length === 1 ? "resultado" : "resultados"} para “${esc(r.q)}”. Até ${r.perKind} por tipo.</p><ul class="search-results">${items.map((i) => `<li><a href="#${esc(i.route)}"><span class="status-chip">${esc(KINDS[i.kind] || "Conteúdo")}</span> <strong>${esc(i.title)}</strong></a>${i.excerpt ? `<p class="small">${esc(i.excerpt)}</p>` : ""}</li>`).join("")}</ul>`
        : `<p class="muted small" role="status">Nada encontrado para “${esc(r.q)}”.</p>`;
    } catch (error) {
      if (results.isConnected) results.innerHTML = `<p role="alert">${esc(error.message)}</p>`;
    }
  };
}

const safeImage = (url) => (typeof url === "string" && (/^https:\/\//i.test(url) || /^\/api\/campaigns\/[0-9a-f-]{36}\/known-npcs\/[0-9a-f-]{36}\/portrait\?v=[0-9a-f]{8}$/i.test(url)) ? url : "");

/** NPCs conhecidos: nome, tipo, resumo e imagem que o mestre liberou. `focus`: id do NPC vindo da busca. */
export async function renderKnownNpcs(d, target, focus = "", page = 1) {
  target.innerHTML = '<p class="loading-line" role="status">Reunindo os rostos conhecidos…</p>';
  try {
    const r = await api(`/campaigns/${d.id}/known-npcs?page=${page}`);
    if (!target.isConnected) return;
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    target.innerHTML = `<div class="section-title"><h2>NPCs conhecidos</h2>${d.isMaster ? `<a class="button subtle small" href="#campaign/${esc(d.id)}/prep">Gerenciar em Preparação</a>` : ""}</div><p class="muted small section-lead">${d.isMaster ? "Aparecem aqui os personagens marcados como “Visível para os jogadores”. O grupo vê só nome, tipo, resumo e imagem; lado, recursos, ficha e notas continuam com você." : "Personagens que o mestre apresentou ao grupo."}</p>${
      r.items.length
        ? `<ul class="known-npcs">${r.items.map((n) => { const img = safeImage(n.image); return `<li id="npc-${esc(n.id)}" class="metal known-npc" tabindex="-1">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async">` : `<span class="known-npc-initial" aria-hidden="true">${esc((n.name || "?").trim().charAt(0).toUpperCase())}</span>`}<div><h3>${esc(n.name)}</h3><span class="status-chip">${n.kind === "creature" ? "Criatura" : "Personagem"}</span>${n.summary ? `<p class="workspace-prose small">${esc(n.summary)}</p>` : ""}</div></li>`; }).join("")}</ul>`
        : `<p class="muted small">${d.isMaster ? "Nenhum personagem compartilhado. Edite um personagem em Preparação e marque “Visível para os jogadores”." : "O mestre ainda não apresentou nenhum NPC."}</p>`
    }${pages > 1 ? `<div class="pagination">${button("← Anterior", "kn-page", page - 1, "subtle", page <= 1 ? "disabled" : "")}<span>Página ${page} de ${pages}</span>${button("Próxima →", "kn-page", page + 1, "subtle", page >= pages ? "disabled" : "")}</div>` : ""}`;
    target.querySelectorAll(".known-npc img").forEach((img) => img.addEventListener("error", () => img.replaceWith(Object.assign(document.createElement("span"), { className: "known-npc-initial", textContent: img.closest("li").querySelector("h3").textContent.trim().charAt(0).toUpperCase() })), { once: true }));
    target.onclick = (e) => { const b = e.target.closest("[data-action='kn-page']"); if (b && !b.disabled) renderKnownNpcs(d, target, "", Number(b.dataset.id)); };
    if (focus) { const card = document.getElementById("npc-" + focus); if (card) { card.scrollIntoView({ block: "center" }); card.classList.add("is-target"); card.focus({ preventScroll: true }); } }
  } catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<p role="alert">${esc(error.message)}</p>${button("Tentar novamente", "kn-retry", "", "subtle small")}`;
    target.onclick = (e) => { if (e.target.closest("[data-action='kn-retry']")) renderKnownNpcs(d, target, focus, page); };
  }
}
