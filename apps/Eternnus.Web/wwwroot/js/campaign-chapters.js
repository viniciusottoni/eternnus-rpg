// Capítulos, atos e arcos da campanha: organização privada do mestre para agrupar sessões (Eternnus e anteriores).
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";

export const CHAPTER_KINDS = Object.freeze([["chapter", "Capítulo"], ["act", "Ato"], ["arc", "Arco"]]);
export const chapterKindLabel = (kind) => (CHAPTER_KINDS.find(([k]) => k === kind) || CHAPTER_KINDS[0])[1];
export const chapterName = (c) => `${chapterKindLabel(c.kind)} — ${c.title}`;
export const NEW_CHAPTER = "__new";

export function loadChapters(campaignId) {
  return api(`/campaigns/${campaignId}/chapters`);
}
export function createChapter(campaignId, data) {
  return api(`/campaigns/${campaignId}/chapters`, "POST", { title: data.title, kind: data.kind, summary: data.summary || "" });
}

const kindOptions = (selected) => CHAPTER_KINDS.map(([k, label]) => `<option value="${k}" ${k === selected ? "selected" : ""}>${label}</option>`).join("");

/**
 * Seletor de capítulo para formulários de sessão. `allowNew` oferece criar um capítulo no mesmo envio (campos extras
 * ficam ocultos até a opção ser escolhida). Sem capítulos, a criação vem sugerida, mas "Sessão avulsa" continua disponível.
 */
export function chapterPicker(items, selected, { allowNew = false, idPrefix = "chapter" } = {}) {
  const none = !items.length;
  const value = selected ?? (allowNew && none ? NEW_CHAPTER : "");
  const options = `<option value="">Sessão avulsa (sem capítulo)</option>${items.map((c) => `<option value="${esc(c.id)}" ${c.id === value ? "selected" : ""}>${esc(chapterName(c))}</option>`).join("")}${allowNew ? `<option value="${NEW_CHAPTER}" ${value === NEW_CHAPTER ? "selected" : ""}>+ Criar novo capítulo, ato ou arco…</option>` : ""}`;
  const hint = none
    ? "Recomendado: crie o primeiro capítulo para organizar a história. Escolha “Sessão avulsa” para seguir sem ele."
    : "Agrupa a sessão no Diário. Você pode mudar depois.";
  const fresh = allowNew
    ? `<div class="chapter-new form-grid two" data-chapter-new ${value === NEW_CHAPTER ? "" : "hidden"}><div class="field"><label for="${idPrefix}-new-title">Título do novo capítulo</label><input id="${idPrefix}-new-title" name="chapterTitle" maxlength="120" placeholder="O Despertar da Tormenta" ${value === NEW_CHAPTER ? "required" : ""}></div><div class="field"><label for="${idPrefix}-new-kind">Tipo</label><select id="${idPrefix}-new-kind" name="chapterKind">${kindOptions("chapter")}</select></div></div>`
    : "";
  return `<div class="field"><label for="${idPrefix}-select">Capítulo, ato ou arco</label><select id="${idPrefix}-select" name="chapterId" aria-describedby="${idPrefix}-hint" data-chapter-select>${options}</select><small id="${idPrefix}-hint" class="form-help">${hint}</small></div>${fresh}`;
}

/** Mostra/oculta os campos de novo capítulo conforme a escolha. */
export function mountChapterPicker(form) {
  const select = form.querySelector("[data-chapter-select]");
  const fresh = form.querySelector("[data-chapter-new]");
  if (!select || !fresh) return;
  select.addEventListener("change", () => {
    const creating = select.value === NEW_CHAPTER;
    fresh.hidden = !creating;
    fresh.querySelector("input").required = creating;
    if (creating) fresh.querySelector("input").focus();
  });
}

/** Resolve o capítulo escolhido: cria o novo uma única vez (mesmo se o envio seguinte falhar) e devolve o id ou null. */
export function chapterResolver(campaignId) {
  let created = null;
  return async (data) => {
    if (data.chapterId !== NEW_CHAPTER) return data.chapterId || null;
    if (!created) created = await createChapter(campaignId, { title: data.chapterTitle, kind: data.chapterKind });
    return created.id;
  };
}

function range(c) {
  const total = c.sessionCount + c.pastCount;
  if (!total) return "Nenhuma sessão ainda";
  const span = c.firstNumber === c.lastNumber ? `Sessão ${String(c.firstNumber).padStart(2, "0")}` : `Sessões ${String(c.firstNumber).padStart(2, "0")}–${String(c.lastNumber).padStart(2, "0")}`;
  return `${span} · ${total} ${total === 1 ? "sessão" : "sessões"}`;
}

/** Bloco do Diário (mestre): lista ordenada com criar, editar, mover e excluir. */
export async function renderChapters(d, target, onChange, page = 1) {
  // Outros blocos do Diário (registro anterior, importação) avisam por evento quando mudam contagens ou criam capítulo.
  if (!target.dataset.listening) { target.dataset.listening = "1"; target.addEventListener("chapters-changed", () => target.onchapterschanged()); }
  target.onchapterschanged = () => renderChapters(d, target, onChange, page);
  target.innerHTML = '<p class="loading-line" role="status">Consultando capítulos…</p>';
  let result;
  try { result = await api(`/campaigns/${d.id}/chapters?page=${page}`); }
  catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<p role="alert">${esc(error.message)}</p>${button("Tentar novamente", "ch-retry", "", "subtle small")}`;
    target.onclick = (e) => { if (e.target.closest("[data-action='ch-retry']")) renderChapters(d, target, onChange, page); };
    return;
  }
  if (!target.isConnected) return;
  const items = result.items;
  const editable = !d.archived;
  const full = result.total >= result.max;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const row = (c, i) => {
    const n = result.offset + i;
    return `<tr><td class="num" data-label="Ordem">${n + 1}</td><td data-label="Tipo">${esc(chapterKindLabel(c.kind))}</td><td data-label="Título"><a href="#campaign/${esc(d.id)}/sessions/chapter-${esc(c.id)}" class="chapter-link">${esc(c.title)}</a>${c.summary ? `<p class="log-excerpt chapter-summary">${esc(c.summary)}</p>` : ""}</td><td data-label="Sessões">${esc(range(c))}</td>${editable ? `<td data-label="Ações"><div class="chapter-tools">${button("↑", "ch-up", c.id, "subtle small icon-button", `aria-label="Subir ${esc(c.title)}"${n === 0 ? " disabled" : ""}`)}${button("↓", "ch-down", c.id, "subtle small icon-button", `aria-label="Descer ${esc(c.title)}"${n === result.total - 1 ? " disabled" : ""}`)}${button("Editar", "ch-edit", c.id, "subtle small", `aria-label="Editar ${esc(c.title)}"`)}${button("Excluir", "ch-delete", c.id, "text-button small", `aria-label="Excluir ${esc(c.title)}"`)}</div></td>` : ""}</tr>`;
  };
  target.innerHTML = `<div class="section-title"><h2 id="cp-chapters-title">Capítulos, atos e arcos${helpButton("campanhas.capitulos.organizacao", "Capítulos, atos e arcos")}</h2>${editable ? button("+ Novo capítulo", "ch-new", "", "subtle small", full ? `disabled aria-describedby="ch-full"` : "") : ""}</div><p class="muted small section-lead">Só você vê. Organize a história antes de abrir as sessões e escolha o capítulo ao iniciar cada uma; sessões avulsas continuam permitidas. Abra um capítulo para ver suas sessões.${full ? ` <span id="ch-full">Limite de ${result.max} capítulos atingido.</span>` : ""}</p>${
    items.length
      ? `<div class="data-table-wrap"><table class="data-table chapter-table"><caption class="sr-only">Capítulos da campanha, página ${result.page} de ${pages}</caption><thead><tr><th scope="col">Ordem</th><th scope="col">Tipo</th><th scope="col">Título</th><th scope="col">Sessões</th>${editable ? '<th scope="col">Ações</th>' : ""}</tr></thead><tbody>${items.map(row).join("")}</tbody></table></div>${result.looseSessions ? `<p class="muted small table-note">${result.looseSessions} ${result.looseSessions === 1 ? "sessão avulsa" : "sessões avulsas"}, sem capítulo. <a href="#campaign/${esc(d.id)}/sessions/chapter-none">Ver avulsas</a></p>` : ""}${pages > 1 ? `<div class="pagination">${button("← Anterior", "ch-page", page - 1, "subtle", page <= 1 ? "disabled" : "")}<span>Página ${page} de ${pages} · ${result.total} capítulos</span>${button("Próxima →", "ch-page", page + 1, "subtle", page >= pages ? "disabled" : "")}</div>` : ""}`
      : `<p class="muted small">Nenhum capítulo criado.${editable ? " Crie o primeiro antes de abrir a próxima sessão — por exemplo, “Ato I — A Chegada” — ou importe vários de uma vez pela tabela de sessões." : ""}</p>`
  }`;
  target.onclick = async (e) => {
    const b = e.target.closest("[data-action^='ch-']");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    const chapter = items.find((c) => c.id === b.dataset.id);
    try {
      if (b.dataset.action === "ch-page") return renderChapters(d, target, onChange, Number(b.dataset.id));
      if (b.dataset.action === "ch-new") chapterEditor(d, null, onChange);
      if (b.dataset.action === "ch-edit" && chapter) chapterEditor(d, chapter, onChange);
      if ((b.dataset.action === "ch-up" || b.dataset.action === "ch-down") && chapter) {
        await api(`/campaigns/${d.id}/chapters/${chapter.id}/move`, "POST", { direction: b.dataset.action === "ch-up" ? -1 : 1, revision: chapter.revision });
        await onChange();
      }
      if (b.dataset.action === "ch-delete" && chapter) deleteChapter(d, chapter, onChange);
    } catch (error) { toast(error.message); }
  };
}

function chapterEditor(d, c, onChange) {
  modal(c ? "Editar capítulo" : "Novo capítulo, ato ou arco", `<form id="chapter-form"><div class="form-grid two"><div class="field"><label for="ch-title">Título</label><input id="ch-title" name="title" required maxlength="120" value="${esc(c?.title || "")}" placeholder="A Chegada a Valkaria"></div><div class="field"><label for="ch-kind">Tipo</label><select id="ch-kind" name="kind">${kindOptions(c?.kind || "chapter")}</select></div></div><div class="field"><label for="ch-summary">Resumo (opcional)</label><textarea id="ch-summary" name="summary" maxlength="2000" rows="4" aria-describedby="ch-summary-hint">${esc(c?.summary || "")}</textarea><small id="ch-summary-hint" class="form-help">Propósito ou ganchos do capítulo. Só você vê.</small></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">${c ? "Salvar capítulo" : "Criar capítulo"}</button></div></form>`);
  $("#ch-title").focus();
  $("#chapter-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      if (c) await api(`/campaigns/${d.id}/chapters/${c.id}`, "PUT", { ...data, revision: c.revision });
      else await createChapter(d.id, data);
      $("#modal").close();
      toast(c ? "Capítulo atualizado." : "Capítulo criado.");
      await onChange();
    });
  };
}

function deleteChapter(d, c, onChange) {
  const total = c.sessionCount + c.pastCount;
  modal("Excluir capítulo?", `<p><strong>${esc(chapterName(c))}</strong> será excluído. ${total ? `${total} ${total === 1 ? "sessão continua" : "sessões continuam"} guardada${total === 1 ? "" : "s"}, agora sem capítulo.` : "Nenhuma sessão está vinculada."}</p><form id="chapter-delete">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button class="danger" type="submit">Excluir capítulo</button></div></form>`);
  $("#chapter-delete").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      await api(`/campaigns/${d.id}/chapters/${c.id}?revision=${c.revision}`, "DELETE");
      $("#modal").close();
      toast("Capítulo excluído. As sessões foram preservadas.");
      await onChange();
    });
  };
}

/** Move uma sessão do Eternnus para outro capítulo (ou a deixa avulsa). */
export async function moveSessionModal(d, session, onChange) {
  const { items } = await loadChapters(d.id);
  modal("Capítulo da sessão", `<form id="session-chapter"><p class="modal-lead">${esc(session.label)}</p>${chapterPicker(items, session.chapterId || "", { allowNew: true, idPrefix: "sc" })}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar</button></div></form>`);
  const form = $("#session-chapter");
  mountChapterPicker(form);
  $("#sc-select").focus();
  const resolve = chapterResolver(d.id);
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(`/sessions/${session.id}/chapter`, "POST", { chapterId: await resolve(data) });
      $("#modal").close();
      toast("Sessão reorganizada.");
      await onChange();
    });
  };
}
