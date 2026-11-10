// Tabela única de sessões (no Eternnus e antes dele) com busca, filtros, leitura e importação em lote.
// Mestre e jogadores usam a mesma tela; o servidor filtra o que cada um pode ler.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { sessionLabel } from "./session-policy.js";
import { chapterKindLabel } from "./campaign-chapters.js";

const SOURCES = Object.freeze([["", "Todas"], ["eternnus", "No Eternnus"], ["past", "Antes do Eternnus"]]);
const sourceLabel = (s) => (s === "past" ? "Antes do Eternnus" : "No Eternnus");
const KEY = /^(live|past)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowDate(r) {
  if (r.date) return new Date(r.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  if (r.startedAt) return new Date(r.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return "—";
}
function rowState(r) {
  if (r.active) return '<span class="online-badge"><i aria-hidden="true"></i>Em andamento</span>';
  if (r.source === "eternnus" && !r.hasText) return '<span class="status-chip quiet">Sem resumo</span>';
  return r.published ? '<span class="status-chip good">Publicado</span>' : '<span class="status-chip quiet">Privado</span>';
}

/**
 * `query`: {search, chapter ("" | "none" | id), source, page}. `open`: chave live-/past- para abrir a leitura logo após carregar.
 * `onChanged`: chamado quando o mestre altera dados que outros blocos exibem (capítulos).
 */
export async function renderSessionLog(d, target, query = {}, { open = "", onChanged } = {}) {
  const q = { search: query.search || "", chapter: query.chapter || "", source: query.source || "", page: Math.max(1, Number(query.page) || 1) };
  target.innerHTML = '<p class="loading-line" role="status">Consultando as sessões…</p>';
  let r;
  try {
    const params = new URLSearchParams({ page: q.page });
    for (const k of ["search", "chapter", "source"]) if (q[k]) params.set(k, q[k]);
    r = await api(`/campaigns/${d.id}/session-log?${params}`);
  } catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<div class="section-title"><h2 id="cp-log-title">Sessões</h2></div><p role="alert">${esc(error.message)}</p>${button("Tentar novamente", "lg-retry", "", "subtle small")}`;
    target.onclick = (e) => { if (e.target.closest("[data-action='lg-retry']")) renderSessionLog(d, target, { ...q, search: "" }, { onChanged }); };
    return;
  }
  if (!target.isConnected) return;
  const master = r.isMaster;
  const editable = master && !d.archived && !d.isOneShot;
  const reload = (next = {}) => renderSessionLog(d, target, { ...q, ...next }, { onChanged });
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const filtered = q.search || q.chapter || q.source;
  const chapterOptions = `<option value="">Todos</option><option value="none" ${q.chapter === "none" ? "selected" : ""}>Sem capítulo (avulsas)</option>${r.chapters.map((c) => `<option value="${esc(c.id)}" ${c.id === q.chapter ? "selected" : ""}>${esc(chapterKindLabel(c.kind))} — ${esc(c.title)}</option>`).join("")}`;
  const row = (s) => `<tr><td class="num" data-label="Nº">${String(s.number).padStart(2, "0")}</td><td data-label="Sessão"><button type="button" class="text-button log-open" data-action="lg-open" data-id="${esc(s.key)}">${esc(s.title)}</button>${s.excerpt ? `<p class="log-excerpt">${esc(s.excerpt)}</p>` : ""}</td><td data-label="Capítulo">${s.chapterTitle ? `<span class="status-chip">❖ ${esc(s.chapterTitle)}</span>` : '<span class="muted">Avulsa</span>'}</td><td data-label="Origem">${sourceLabel(s.source)}</td><td data-label="Data">${esc(rowDate(s))}</td>${master ? `<td data-label="Estado">${rowState(s)}</td>` : ""}</tr>`;
  target.innerHTML = `<div class="section-title"><h2 id="cp-log-title">Sessões${helpButton("campanhas.sessoes.tabela", "Tabela de sessões")}</h2>${editable ? `<div class="section-actions">${button("+ Sessão anterior", "lg-past", "", "subtle small")}${button("⇪ Importar em lote", "lg-import", "", "subtle small")}${d.activeSession ? "" : button("✦ Iniciar nova sessão", "cp-start", d.id, "subtle small")}</div>` : ""}</div>
  <p class="muted small section-lead">${master ? "Sessões jogadas no Eternnus e as registradas antes da plataforma, numa só lista. Os jogadores veem só resumos e registros publicados." : "O que aconteceu em cada sessão, publicado pelo mestre — no Eternnus ou antes dele. Busque por nomes, lugares ou acontecimentos."}</p>
  <form class="search-bar log-filters" role="search" data-log-filters><div class="field"><label for="lg-search">Buscar nas sessões</label><input id="lg-search" name="search" type="search" minlength="2" maxlength="100" value="${esc(q.search)}" placeholder="Goblins, Rosered, pedra negra…"></div><div class="field"><label for="lg-chapter">Capítulo</label><select id="lg-chapter" name="chapter">${chapterOptions}</select></div><div class="field"><label for="lg-source">Origem</label><select id="lg-source" name="source">${SOURCES.map(([v, l]) => `<option value="${v}" ${v === q.source ? "selected" : ""}>${l}</option>`).join("")}</select></div><button type="submit" class="subtle">Buscar</button>${filtered ? `<p class="search-extra"><span role="status">${r.total} ${r.total === 1 ? "sessão encontrada" : "sessões encontradas"}.</span> ${button("Limpar filtros", "lg-clear", "", "text-button small")}</p>` : ""}</form>
  ${r.items.length ? `<div class="data-table-wrap"><table class="data-table log-table"><caption class="sr-only">Sessões da campanha${q.search ? `, busca por ${esc(q.search)}` : ""}, página ${q.page} de ${pages}</caption><thead><tr><th scope="col">Nº</th><th scope="col">Sessão</th><th scope="col">Capítulo</th><th scope="col">Origem</th><th scope="col">Data</th>${master ? '<th scope="col">Estado</th>' : ""}</tr></thead><tbody>${r.items.map(row).join("")}</tbody></table></div>` : `<p class="muted small">${filtered ? "Nenhuma sessão encontrada com estes filtros." : master ? "Nenhuma sessão ainda. Inicie a primeira, registre uma anterior ou importe várias de uma vez." : "Nenhum resumo publicado ainda."}</p>`}
  ${pages > 1 ? `<div class="pagination">${button("← Mais recentes", "lg-page", q.page - 1, "subtle", q.page <= 1 ? "disabled" : "")}<span>Página ${q.page} de ${pages} · ${r.total} sessões</span>${button("Anteriores →", "lg-page", q.page + 1, "subtle", q.page >= pages ? "disabled" : "")}</div>` : ""}`;
  target.querySelector("[data-log-filters]").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const search = String(f.get("search") || "").trim();
    if (search.length === 1) { toast("Digite ao menos 2 caracteres para buscar."); return; }
    reload({ search, chapter: String(f.get("chapter") || ""), source: String(f.get("source") || ""), page: 1 });
  };
  const changed = async () => { await reload(); await onChanged?.(); };
  target.onclick = async (e) => {
    const b = e.target.closest("[data-action^='lg-']");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    try {
      if (b.dataset.action === "lg-page") await reload({ page: Number(b.dataset.id) });
      if (b.dataset.action === "lg-clear") await reload({ search: "", chapter: "", source: "", page: 1 });
      if (b.dataset.action === "lg-open") await openEntry(d, b.dataset.id, changed);
      if (b.dataset.action === "lg-past") await (await import("./campaign-workspace.js")).pastEditor(d, {}, changed);
      if (b.dataset.action === "lg-import") importModal(d, changed);
    } catch (error) { toast(error.message); }
  };
  if (KEY.test(open)) await openEntry(d, open, changed).catch((error) => toast(error.message));
}

/** Leitura completa de uma sessão; o mestre também encontra aqui as ações (histórico, notas, resumo, capítulo, editar). */
export async function openEntry(d, key, onChanged) {
  if (!KEY.test(key)) return;
  const s = await api(`/campaigns/${d.id}/session-log/${encodeURIComponent(key)}`);
  const master = d.isMaster;
  const meta = [sourceLabel(s.source), rowDate(s) === "—" ? "" : rowDate(s), s.chapterTitle ? `Capítulo: ${s.chapterTitle}` : "Avulsa", master ? (s.active ? "Em andamento" : s.published ? "Publicado para o grupo" : "Privado") : ""].filter(Boolean).map(esc).join(" · ");
  const scenes = (s.scenes || []).length ? `<h3 class="entry-heading">Cenas (${s.scenes.length})</h3><ol class="entry-scenes">${s.scenes.map((c) => `<li><h4>${esc(c.title)}</h4><p class="workspace-prose">${esc(c.text)}</p></li>`).join("")}</ol>` : "";
  const live = s.source === "eternnus";
  const actions = master && !d.archived
    ? live
      ? `<a class="button subtle small" href="#session/${esc(s.id)}/timeline">◷ Histórico</a><a class="button subtle small" href="#session/${esc(s.id)}/notes">✎ Notas</a>${button(s.published ? "Resumo publicado" : "✍ Resumo", "le-recap", "", "subtle small")}${button("❖ Capítulo", "le-chapter", "", "subtle small")}`
      : button("Editar registro", "le-edit", "", "subtle small")
    : "";
  modal(sessionLabel(s.number, s.title), `<p class="muted small entry-meta">${meta}</p>${s.objective ? `<details class="entry-private"><summary>Objetivo inicial (só você vê)</summary><p class="workspace-prose">${esc(s.objective)}</p></details>` : ""}<h3 class="entry-heading">${live ? "Resumo" : "Resumo geral"}</h3>${s.text ? `<div class="workspace-prose entry-text">${esc(s.text)}</div>` : `<p class="muted small">${live ? "O resumo desta sessão ainda não foi escrito." : "Sem resumo geral."}</p>`}${scenes}<div class="form-actions entry-actions">${actions}${button("Fechar", "modal-close", "", "subtle small")}</div>`);
  $("#modal").classList.add("wide");
  const body = $("#modal-body");
  body.onclick = async (e) => {
    const b = e.target.closest("[data-action^='le-']");
    if (!b) return;
    body.onclick = null;
    try {
      if (b.dataset.action === "le-recap") (await import("./campaign-prep.js")).recapModal({ id: s.id, number: s.number, recap: s.text, published: s.published }, onChanged);
      if (b.dataset.action === "le-chapter") await (await import("./campaign-chapters.js")).moveSessionModal(d, { id: s.id, chapterId: s.chapterId, label: sessionLabel(s.number, s.title) }, onChanged);
      if (b.dataset.action === "le-edit") await (await import("./campaign-workspace.js")).pastEditor(d, { id: s.id, number: s.number, title: s.title, summary: s.text, date: s.date, published: s.published, revision: s.revision, scenes: s.scenes, chapterId: s.chapterId }, onChanged);
    } catch (error) { toast(error.message); }
  };
}

/** Importação em lote: baixa o modelo, envia o CSV para prévia (nada é gravado) e confirma com o mesmo arquivo. */
function importModal(d, onDone) {
  modal("Importar capítulos e sessões", `<ol class="import-steps"><li><strong>Baixe o modelo.</strong> <a class="button subtle small" href="/api/session-import/template" download>⤓ Baixar modelo CSV</a></li><li><strong>Preencha</strong> no Excel, LibreOffice ou Google Planilhas: uma linha por sessão anterior. Apague as linhas de exemplo. Para criar um capítulo sem sessões, deixe número e título vazios.</li><li><strong>Salve como CSV</strong> (UTF-8, separado por ponto e vírgula) e gere a prévia. Nada é gravado antes de você confirmar.</li></ol><form id="import-form"><div class="field"><label for="import-file">Arquivo CSV</label><input id="import-file" name="file" type="file" accept=".csv,text/csv" required aria-describedby="import-hint"><small id="import-hint" class="form-help">Até 1 MB e 1.000 linhas. Sessões existentes não são alteradas; capítulos com o mesmo nome são reutilizados. Datas em dd/mm/aaaa; publicado: sim ou não.</small></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Gerar prévia</button></div></form><div id="import-preview" aria-live="polite"></div>`);
  $("#modal").classList.add("wide");
  const input = $("#import-file"), preview = $("#import-preview");
  const send = (confirm) => { const form = new FormData(); form.append("file", input.files[0]); return api(`/campaigns/${d.id}/session-import?confirm=${confirm}`, "POST", form); };
  input.onchange = () => { preview.innerHTML = ""; };
  $("#import-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      if (!input.files[0]) throw new Error("Escolha o arquivo CSV.");
      const p = await send(false);
      preview.innerHTML = previewHtml(p);
      preview.querySelector("[data-import-confirm]")?.addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        try {
          const done = await send(true);
          $("#modal").close();
          toast(`Importação concluída: ${done.sessions.length} ${done.sessions.length === 1 ? "sessão" : "sessões"} e ${done.newChapters} ${done.newChapters === 1 ? "capítulo novo" : "capítulos novos"}.`);
          await onDone();
        } catch (error) { b.disabled = false; toast(error.message); }
      });
      preview.querySelector("h3")?.focus();
    });
  };
}

function previewHtml(p) {
  const errors = p.errors.length ? `<div class="import-errors" role="alert"><h4>Corrija ${p.errors.length === 1 ? "esta linha" : `estas ${p.errors.length} linhas`} e envie de novo</h4><ul>${p.errors.slice(0, 100).map((e) => `<li><strong>Linha ${Number(e.line)}:</strong> ${esc(e.message)}</li>`).join("")}</ul>${p.errors.length > 100 ? `<p class="small">E mais ${p.errors.length - 100}.</p>` : ""}</div>` : "";
  const chapters = p.chapters.length ? `<p class="small"><strong>Capítulos:</strong> ${p.chapters.map((c) => (c.existing ? `${esc(c.title)} (já existe)` : `${esc(chapterKindLabel(c.kind))} — ${esc(c.title)} (novo)`)).join("; ")}</p>` : "";
  const sessions = p.sessions.length ? `<div class="data-table-wrap"><table class="data-table import-table"><caption class="sr-only">Sessões que serão importadas</caption><thead><tr><th scope="col">Linha</th><th scope="col">Nº</th><th scope="col">Título</th><th scope="col">Capítulo</th><th scope="col">Data</th><th scope="col">Publicado</th><th scope="col">Cenas</th></tr></thead><tbody>${p.sessions.slice(0, 200).map((s) => `<tr><td class="num" data-label="Linha">${Number(s.line)}</td><td class="num" data-label="Nº">${Number(s.number)}</td><td data-label="Título">${esc(s.title)}</td><td data-label="Capítulo">${esc(s.chapter || "Avulsa")}</td><td data-label="Data">${s.date ? esc(new Date(s.date + "T12:00:00").toLocaleDateString("pt-BR")) : "—"}</td><td data-label="Publicado">${s.published ? "Sim" : "Não"}</td><td class="num" data-label="Cenas">${Number(s.scenes)}</td></tr>`).join("")}</tbody></table></div>${p.sessions.length > 200 ? `<p class="small">E mais ${p.sessions.length - 200} sessões.</p>` : ""}` : "";
  const summary = `${p.sessions.length} ${p.sessions.length === 1 ? "sessão" : "sessões"} e ${p.newChapters} ${p.newChapters === 1 ? "capítulo novo" : "capítulos novos"}`;
  return `<h3 tabindex="-1" class="import-title">Prévia: ${summary}</h3>${errors}${chapters}${sessions}${p.ready ? `<div class="form-actions"><button type="button" class="primary" data-import-confirm>Importar ${summary}</button></div>` : ""}`;
}

/** Item da rota (#campaign/{id}/sessions/{item}): chave de sessão para abrir ou chapter-{id} para filtrar. */
export function parseLogItem(item) {
  if (KEY.test(item || "")) return { open: item };
  const chapter = /^chapter-(.+)$/i.exec(item || "")?.[1];
  return chapter && (chapter === "none" || GUID.test(chapter)) ? { chapter: chapter.toLowerCase() } : {};
}
