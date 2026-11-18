import { helpButton } from "./help.js";
import { api } from "./api.js";
import { shell } from "./layout.js";
import { $, esc, button, iconButton, field, formError, submitForm, toast, modal, formatDate, navigate } from "./ui.js";
import { renderSheet } from "./pdf-sheet.js";
import { validate } from "./formula.js";
import { editableValues, ownActions, downloadName } from "./character-policy.js";
import { withLoading } from "./loading.js";
import { keepMasterPresence } from "./session-presence.js";
import { formulaSuggestOn } from "./formula-suggest.js";
import { canImportPdf, matchPdfValues } from "./pdf-import-policy.js";
import { mountCharacterPortrait } from "./character-portrait.js";
import { characterName } from "./character-portrait-policy.js";
import { isListField, lineFieldNames, describedCount, applyNotes, liveNotes } from "./item-notes-policy.js";
import { openItemNotes, closeItemNotes } from "./item-notes.js";
import { renderCompactSheet } from "./sheet-compact.js";
import { searchSheet, restorable } from "./sheet-compact-policy.js";
import { buildDraft, draftDecision, draftKey, readDraft, when, DRAFT_DEBOUNCE_MS } from "./draft-policy.js";
import { localDrafts } from "./editor-drafts.js";
import { state } from "./state.js";

const VIEW_KEY = "eternnus.sheet-view";
const savedView = () => { try { return localStorage.getItem(VIEW_KEY) === "compact" ? "compact" : "full"; } catch { return "full"; } };

const KINDS = [["ataque", "Ataque"], ["habilidade", "Habilidade"], ["magia", "Magia"], ["item", "Item"]];
function actionRow(a = {}) {
  return `<fieldset class="cs-action" data-id="${esc(a.id || "")}"><legend>Ação pessoal</legend><label>Nome<input data-k="name" maxlength="60" required value="${esc(a.name || "")}"></label><label>Tipo<select data-k="kind">${KINDS.map(([key, label]) => `<option value="${key}" ${a.kind === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Fórmula<input data-k="formula" maxlength="300" value="${esc(a.formula || "")}" placeholder="1d20 + @forca"></label><label>Efeito<input data-k="description" maxlength="300" value="${esc(a.description || "")}"></label>${button("Remover ação", "cs-remove", "", "subtle small")}</fieldset>`;
}
function actionsFrom(form) {
  return [...form.querySelectorAll(".cs-action")].map(row => {
    const get = k => row.querySelector(`[data-k="${k}"]`).value.trim();
    const formula = get("formula");
    if (formula && !validate(formula, "roll").ok) throw new Error("Confira a fórmula da ação: " + get("name"));
    return { id: row.dataset.id || null, name: get("name"), kind: get("kind"), formula, description: get("description") };
  });
}
function accessibleFields(fields, values, withNotes = false) {
  return fields.map(f => {
    const value = String(values[f.name] ?? f.default ?? "");
    const id = "cs-access-" + f.name;
    let control;
    if (f.type === "select") control = `<select id="${esc(id)}" data-cs-field="${esc(f.name)}"><option value="">—</option>${(f.options || []).map(o => `<option value="${esc(o)}" ${value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else if (f.type === "textarea") control = `<textarea id="${esc(id)}" data-cs-field="${esc(f.name)}" maxlength="${Number(f.maxLength) || 2000}">${esc(value)}</textarea>`;
    else control = `<input id="${esc(id)}" data-cs-field="${esc(f.name)}" type="${f.type === "checkbox" ? "checkbox" : "text"}" ${f.type === "computed" ? 'readonly aria-readonly="true"' : ""} ${f.type === "number" ? 'inputmode="decimal"' : ""} ${f.type === "checkbox" && value === "true" ? "checked" : ""} value="${esc(value)}" maxlength="${Number(f.maxLength) || 2000}">`;
    const notes = withNotes && isListField(f) ? button("Descrições", "cs-notes", f.name, "subtle cs-notes-button") : "";
    return `<div class="field${f.type === "textarea" ? " field-wide" : ""}"><label for="${esc(id)}">${esc(f.label || f.name)}${f.type === "computed" ? " (calculado)" : ""}</label>${control}${notes}</div>`;
  }).join("");
}
export async function renderCharacterPage(id, context) {
  shell("characters");
  const root = $("#main");
  const abort = new AbortController();
  const opts = { signal: abort.signal };
  let controller, sheet, dirty = false, historyPage = 1, dead = false, releasePresence = () => {}, releasePortrait = () => {}, notes = {}, compact = null, view = savedView(), findTimer = 0, draftTimer = 0, draftSig = null, changedAt = 0;
  // Fórmulas das ações pessoais: @atributos numéricos do modelo desta ficha.
  const releaseSuggest = formulaSuggestOn(root, '.cs-action input[data-k="formula"]', () => (sheet?.version?.fields || []).filter((f) => f.type === "number" || f.type === "computed"));
  const fresh = id === "new";
  const campaignId = fresh && context && /^[0-9a-f-]{36}$/i.test(context) ? context : null;
  const returnCampaignId = !fresh && context && /^[0-9a-f-]{36}$/i.test(context) ? context : null;
  const call = (path, method = "GET", body) => api(path, method, body, opts);
  // Descrições por item (ADR-098): popup padrão; aplicar marca a ficha como alterada e grava com "Salvar ficha".
  function openNotes(name) {
    const f = sheet?.version?.fields.find((x) => x.name === name);
    if (!f || !controller) return;
    openItemNotes({
      label: f.label || f.name,
      value: String(controller.values()[f.name] ?? ""),
      notes,
      editable: fresh || !!sheet.canEdit,
      onApply: (edits) => { notes = applyNotes(notes, edits); controller.refreshNotes(); syncNoteButtons(); refreshCompact(); mark(); },
    });
  }
  function syncNoteButtons() {
    if (!controller) return;
    const values = controller.values();
    for (const b of root.querySelectorAll("[data-action='cs-notes']")) {
      const count = describedCount(values[b.dataset.id], notes);
      b.textContent = count ? `Descrições (${count})` : "Descrições";
    }
  }
  const mark = () => { dirty = true; changedAt = Date.now(); const note = root.querySelector("#cs-saved"); if (note) note.textContent = "Há alterações ainda não salvas."; };
  const refreshCompact = () => { if (compact && view === "compact") compact.update({ values: controller.values(), notes }); };
  function setView(next) {
    view = next === "compact" ? "compact" : "full";
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* Preferência opcional. */ }
    root.querySelector("#cs-pages").hidden = view === "compact";
    root.querySelector("#cs-compact").hidden = view !== "compact";
    for (const [action, on] of [["cs-view-full", view === "full"], ["cs-view-compact", view === "compact"]]) root.querySelector(`[data-action="${action}"]`)?.setAttribute("aria-pressed", String(on));
    refreshCompact();
  }
  // Busca na ficha (ADR-099): rótulos, valores, linhas de listas e descrições; Enter vai ao primeiro resultado.
  let findHits = [];
  function find(query, go = false) {
    const list = root.querySelector("#cs-find-results"), status = root.querySelector("#cs-find-status");
    if (!list || !controller) return;
    findHits = searchSheet(sheet.version.fields, controller.values(), notes, query, 8);
    const typed = query.trim().length >= 2;
    status.textContent = typed ? (findHits.length ? `${findHits.length} resultado(s).` : "Nada encontrado na ficha.") : "";
    list.innerHTML = typed ? (findHits.length ? findHits.map((h, i) => `<li><button type="button" class="subtle small" data-action="cs-find-go" data-id="${i}"><strong>${esc(h.label)}</strong>${h.text && h.kind !== "label" ? ` · ${esc(h.text.slice(0, 60))}` : ""}${h.kind === "note" ? " · na descrição" : ""}</button></li>`).join("") : `<li class="muted small">Nada encontrado.</li>`) : "";
    list.hidden = !typed;
    if (go && findHits[0]) reveal(findHits[0]);
  }
  function reveal(hit) {
    if (view === "compact") setView("full");
    controller.reveal(hit.field, hit.line);
    root.querySelector("#cs-find-results").hidden = true;
  }
  // Rascunho local (ADR-099): valores e descrições ainda não salvos ficam neste navegador, por usuário e ficha.
  let draftRecord = null;
  const draftId = () => (fresh || !state.user?.id ? null : draftKey(state.user.id, "fichas", "sheet", id));
  const capture = () => ({ values: editableValues(sheet.version.fields, controller.values()), notes });
  async function writeDraft(force = false) {
    const key = draftId();
    if (!key || !controller || !dirty || !sheet?.canEdit) return;
    if (!force && Date.now() - changedAt < DRAFT_DEBOUNCE_MS) return;
    const snapshot = capture(), sig = JSON.stringify(snapshot);
    if (sig === draftSig) return;
    const built = buildDraft({ key, user: state.user.id, campaign: "fichas", kind: "sheet", doc: id, label: characterName(sheet), revision: sheet.revision, snapshot });
    if (built.error) return;
    if (await localDrafts.put(built.record) != null) draftSig = sig;
  }
  async function dropDraft() { const key = draftId(); draftSig = null; if (key) await localDrafts.remove(key); }
  async function offerDraft() {
    const key = draftId();
    if (!key) return;
    const record = readDraft(await localDrafts.get(key), { key });
    if (dead || !record || !controller) return;
    const decision = draftDecision(record, { revision: sheet.revision, snapshot: capture() });
    if (!decision.offer) { await localDrafts.remove(key); return; }
    const box = root.querySelector("#cs-draft");
    if (!box) return;
    draftRecord = record;
    box.innerHTML = `<p id="cs-draft-text"><strong>Alterações não salvas desta ficha</strong> ${helpButton("fichas.ficha.rascunho", "Rascunho local da ficha")} de ${esc(when(record.savedAt))}.${decision.conflict ? " A ficha foi salva depois disso: ao restaurar e salvar, o rascunho substitui o que foi salvo." : ""}</p><div class="form-actions">${button("Restaurar rascunho", "cs-draft-restore", "", "primary small")}${button("Descartar", "cs-draft-discard", "", "subtle small")}</div>`;
    box.hidden = false;
  }
  function syncAccessible() {
    if (!controller) return;
    const values = controller.values();
    for (const input of root.querySelectorAll("[data-cs-field]")) {
      const value = String(values[input.dataset.csField] ?? "");
      if (input.type === "checkbox") input.checked = value === "true";
      else if (document.activeElement !== input) input.value = value;
    }
  }
  async function draw() {
    controller?.destroy();
    const version = sheet.version;
    const canEdit = fresh || sheet.canEdit;
    root.innerHTML = `<a class="back-link" href="${returnCampaignId ? "#table/" + esc(returnCampaignId) : campaignId ? "#campaign/" + esc(campaignId) : "#characters"}">← Voltar</a><div class="page-heading"><div><span class="eyebrow">SUA LENDA, SEUS CAPÍTULOS</span><h1>${fresh ? "Criar personagem" : "Sua ficha"}${helpButton("fichas.versao.migracao", "Versão da ficha")}</h1><p>${esc(sheet.template.name)} · versão ${version.number}${sheet.legacy ? " · ficha antiga, preservada no Sistema livre" : ""}</p></div></div>${fresh ? `<div class="field"><label for="cs-template">Ficha-modelo</label><select id="cs-template" ${campaignId ? "disabled" : ""}></select></div>` : ""}${sheet.newerVersion ? `<section class="notice-box"><strong>Nova versão do modelo disponível: v${sheet.newerVersion.number}.</strong><p>Sua ficha continua na versão atual até você revisar a migração.</p>${button("Revisar migração", "cs-migrate", "", "subtle")}</section>` : ""}<form id="cs-form" class="cs-form"><div class="field-label"><span>Visibilidade da ficha</span>${helpButton("fichas.visibilidade.privacidade", "Ficha compartilhada ou privada")}</div>${fresh || sheet.canChangeVisibility ? `<label class="field"><span><input id="cs-private" type="checkbox" ${sheet.private ? "checked" : ""}> Ficha privada: somente você e o mestre</span></label><p class="form-help">Desmarcada: os participantes da mesa podem ler a ficha. Histórico e edição ficam com o dono e o mestre.</p>` : `<p>${sheet.private ? "Ficha privada." : "Ficha compartilhada."} ${canEdit ? "Somente o dono pode alterar a visibilidade." : "Somente leitura."}</p>`}${fresh && !version.fields.some(f => f.role === "name") ? field("name", "Nome do personagem", "", "text", 'required maxlength="100"') : ""}<div class="cs-toolbar"><div class="cs-view" role="group" aria-label="Apresentação da ficha">${button("Ficha completa", "cs-view-full", "", "subtle", 'aria-pressed="false"')}${button("Resumo", "cs-view-compact", "", "subtle", 'aria-pressed="false"')}${helpButton("fichas.ficha.resumo", "Resumo da ficha")}</div><div class="cs-find"><label class="sr-only" for="cs-find">Buscar na ficha</label><input id="cs-find" type="search" maxlength="60" placeholder="Buscar na ficha" autocomplete="off" aria-controls="cs-find-results" aria-describedby="cs-find-status">${helpButton("fichas.ficha.busca", "Buscar na ficha")}<p id="cs-find-status" class="sr-only" role="status"></p><ul id="cs-find-results" class="cs-find-results" hidden></ul></div><div class="cs-tools" role="group" aria-label="Ferramentas da ficha">${iconButton("zoomOut", "Diminuir zoom da ficha", "cs-zoom-out")}${iconButton("zoomIn", "Aumentar zoom da ficha", "cs-zoom-in")}${canImportPdf(sheet, canEdit) ? helpButton("fichas.pdf.importacao", "Importar PDF preenchido") + iconButton("upload", "Importar PDF preenchido", "cs-import") + '<input id="cs-import-file" type="file" accept="application/pdf,.pdf" hidden>' : ""}${!fresh ? iconButton("download", "Baixar PDF preenchido", "cs-pdf") + helpButton("fichas.pdf.exportacao", "PDF preenchido") + iconButton("history", "Histórico por campo", "cs-history") : ""}${!fresh && sheet.canChangePortrait ? iconButton("copy", "Duplicar ficha", "cs-copy") + helpButton("fichas.ficha.duplicar", "Duplicar ficha") : ""}</div><button type="submit" class="primary">${fresh ? "Criar personagem" : "Salvar ficha"}</button></div><p id="cs-saved" class="form-help" role="status">${fresh ? "Preencha sua ficha. Campos calculados são atualizados automaticamente." : "Ficha carregada. O PDF usa os últimos valores salvos."}</p>${formError()}<details class="cs-accessible metal"><summary>Preencher em formulário acessível</summary><p>Os mesmos valores da ficha, com campos maiores para teclado e celular.</p><div id="cs-accessible">${accessibleFields(version.fields, { ...sheet.values, ...sheet.computed }, !fresh)}</div></details><div id="cs-draft" class="notice-box cs-draft" role="alertdialog" aria-labelledby="cs-draft-text" hidden></div><div class="cs-body"><aside id="cs-portrait" class="cs-portrait metal" aria-label="Imagem do personagem"></aside><div id="cs-pages" class="cs-pages"></div><div id="cs-compact" class="cs-compact metal" hidden></div></div><section class="metal cs-actions"><h2>Ações do modelo</h2>${version.actions.length ? version.actions.map(a => `<p><strong>${esc(a.name)}</strong> · ${esc(a.formula || "Narrativa")}<br>${esc(a.description)}</p>`).join("") : "<p>Este modelo não define ações.</p>"}<h2>Suas ações</h2><p class="form-help">Use fórmulas em inglês e campos como @nome_do_campo. Até 16 ações pessoais.</p><div id="cs-actions">${ownActions(sheet).map(actionRow).join("")}</div>${button("+ Adicionar ação", "cs-add", "", "subtle")}</section></form><section id="cs-history" class="metal cs-history" hidden></section>`;
    releasePortrait();
    // Imagem do personagem fora do PDF (ADR-097): a troca não marca a ficha como alterada nem muda a revisão.
    releasePortrait = mountCharacterPortrait(root.querySelector("#cs-portrait"), { id: fresh ? null : id, name: characterName(sheet), version: sheet.portraitVersion || 0, canChange: !fresh && !!sheet.canChangePortrait, fresh }, { onChange: (v) => { sheet.portraitVersion = v; } });
    notes = { ...(sheet.notes || {}) };
    controller = renderSheet(root.querySelector("#cs-pages"), {
      // Listas (magias, poderes, itens…): um item por linha com "…" e descrição por item em popup (ADR-098).
      isList: isListField,
      isLines: ((names) => (f) => names.has(f.name))(lineFieldNames(version.fields, version.pages)),
      notes: fresh ? null : { count: (f, value) => describedCount(value, notes), text: (key) => notes[key] || "", open: (f) => openNotes(f.name) }, pdfUrl: version.pdfUrl, pages: version.pages, fields: version.fields, mode: canEdit ? "fill" : "view", values: { ...sheet.values, ...sheet.computed }, onChange: () => { mark(); syncAccessible(); syncNoteButtons(); refreshCompact(); } });
    syncNoteButtons();
    compact?.destroy();
    // Resumo (ADR-099): recursos, testes e listas com descrições; atualizado a cada mudança da ficha.
    compact = renderCompactSheet(root.querySelector("#cs-compact"), { fields: version.fields, values: controller.values(), notes, canRoll: false, canUse: false });
    setView(view);
    if (!fresh && canEdit) offerDraft().catch(() => {});
    if (!canEdit) {
      const hint = document.createElement('p'); hint.id = 'cs-readonly'; hint.className = 'form-help'; hint.textContent = 'Somente leitura. A edição e o histórico exigem o dono ou o Mestre autorizado.';
      root.querySelector('#cs-form').prepend(hint);
      for (const control of root.querySelectorAll("#cs-form input, #cs-form textarea, #cs-form select, #cs-form button[type=submit], [data-action=cs-add], [data-action=cs-remove], [data-action=cs-history], [data-action=cs-migrate]")) {
        control.disabled = true;
        control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '));
      }
    }
    if (fresh) await fillTemplates();
    const importInput = root.querySelector("#cs-import-file");
    if (importInput) importInput.onchange = () => importPdf(importInput);
    root.querySelector("#cs-find").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); find(event.currentTarget.value, true); }
      if (event.key === "Escape") { event.currentTarget.value = ""; find(""); }
    });
    root.querySelector("#cs-form").addEventListener("input", event => {
      if (event.target.id === "cs-find") { clearTimeout(findTimer); const q = event.target.value; findTimer = setTimeout(() => find(q), 150); return; }
      if (event.target.id === "cs-import-file" || event.target.closest("#cs-portrait")) return;
      const input = event.target.closest("[data-cs-field]");
      if (input && !input.readOnly) {
        controller.setValues({ ...controller.values(), [input.dataset.csField]: input.type === "checkbox" ? String(input.checked) : input.value });
        syncAccessible(); refreshCompact();
      }
      mark();
    });
    root.querySelector("#cs-form").onsubmit = event => {
      event.preventDefault();
      submitForm(event.currentTarget, async () => {
        const values = editableValues(version.fields, controller.values());
        if (!canEdit) return;
        const actions = actionsFrom(event.currentTarget);
        const privateSheet = root.querySelector("#cs-private")?.checked;
        if (fresh) {
          const data = await call("/characters", "POST", { name: event.currentTarget.elements.name?.value || "", templateId: sheet.template.id, campaignId, values, actions, private: privateSheet });
          toast("Personagem criado."); navigate("character/" + data.id);
        } else {
          // Descrições só de itens que ainda existem nas listas (o servidor confere de novo).
          sheet = await call(`/characters/${id}/sheet`, "PUT", { values, actions, revision: sheet.revision, private: privateSheet, notes: liveNotes(version.fields, controller.values(), notes) });
          if (dead) return;
          notes = { ...(sheet.notes || {}) };
          controller.setValues({ ...sheet.values, ...sheet.computed }); controller.refreshNotes(); syncAccessible(); syncNoteButtons(); refreshCompact(); dirty = false;
          await dropDraft();
          root.querySelector("#cs-saved").textContent = "Ficha salva."; toast("Ficha salva.");
        }
      });
    };
    await controller.ready;
  }
  // Importação local: lê o PDF preenchido no navegador e só preenche a ficha; o servidor valida ao salvar.
  async function importPdf(input) {
    const file = input.files?.[0]; input.value = "";
    if (!file || !controller) return;
    try {
      let result;
      await withLoading(async () => {
        const { readPdfWidgets } = await import("./pdf-import.js");
        const widgets = await readPdfWidgets(file, opts);
        if (!widgets.length) throw new Error("Este PDF não tem campos editáveis. Use a versão preenchível da ficha oficial do sistema.");
        result = matchPdfValues(sheet.version.fields, widgets);
        if (!result.imported) throw new Error("Nenhum campo preenchido deste PDF corresponde à ficha padrão do sistema.");
      });
      if (dead || !result) return;
      if (!fresh && !confirm(`Substituir ${result.imported} campo(s) da ficha pelos valores do PDF? Nada é salvo até você confirmar em “Salvar ficha”.`)) return;
      controller.setValues({ ...controller.values(), ...result.values }); syncAccessible(); mark();
      const skipped = result.rejected.length ? ` Não importados por formato inválido: ${result.rejected.slice(0, 8).join(", ")}${result.rejected.length > 8 ? "…" : ""}.` : "";
      root.querySelector("#cs-saved").textContent = `${result.imported} campo(s) importado(s) do PDF. Revise e ${fresh ? "crie o personagem" : "salve a ficha"}.${skipped}`;
      toast(`${result.imported} campo(s) importado(s). Revise antes de salvar.`);
    } catch (error) { if (!dead && error.name !== "AbortError") toast(error.message); }
  }
  let templates = [];
  async function loadTemplate(template) {
    const version = await call(`/sheet-templates/${template.id}/versions/${template.currentVersion.id}`);
    sheet = { template, version: { ...version, pdfUrl: version.hasPdf ? `/api/sheet-templates/${template.id}/versions/${version.id}/pdf` : null }, values: editableValues(version.fields, {}), computed: {}, actions: [], revision: 0 };
    dirty = false;
  }
  async function fillTemplates() {
    const select = root.querySelector("#cs-template");
    select.innerHTML = templates.map(t => `<option value="${esc(t.id)}" ${t.id === sheet.template.id ? "selected" : ""}>${esc(t.name)} · ${esc(t.system || "Modelo da campanha")}</option>`).join("");
    select.onchange = async () => {
      if (dirty && !confirm("Trocar o modelo descarta os valores ainda não salvos. Continuar?")) { select.value = sheet.template.id; return; }
      try { await withLoading(async () => { await loadTemplate(templates.find(t => t.id === select.value)); if (!dead) await draw(); }); } catch (error) { if (!dead) toast(error.message); }
    };
  }
  async function history() {
    const panel = root.querySelector("#cs-history"); panel.hidden = false;
    const selected = panel.querySelector("#cs-history-field")?.value || "";
    const result = await call(`/characters/${id}/field-history?` + new URLSearchParams({ field: selected, page: historyPage }));
    if (dead) return;
    historyRows = result.items;
    const points = sheet.canChangePortrait ? await call(`/characters/${id}/restore-points`).catch(() => ({ items: [] })) : { items: [] };
    if (dead) return;
    const restoreBox = points.items.length ? `<form id="cs-restore-point" class="cs-restore-point"><label for="cs-restore-session">Voltar a ficha ao início de uma sessão${helpButton("fichas.historico.restaurar", "Restaurar pelo histórico")}</label><div class="hp-row"><select id="cs-restore-session">${points.items.map((p) => `<option value="${esc(p.id)}">Sessão ${Number(p.number)}: ${esc(p.title)}${p.campaign ? ` · ${esc(p.campaign)}` : ""} · ${formatDate(p.startedAt)}</option>`).join("")}</select><button type="submit" class="subtle">Ver e aplicar</button></div><p class="form-help">Os valores voltam ao formulário; nada é gravado até você salvar a ficha.</p></form>` : "";
    panel.innerHTML = `<h2>Histórico por campo${helpButton("fichas.historico.privado", "Histórico de alterações")}</h2>${restoreBox}<label>Filtrar campo<select id="cs-history-field"><option value="">Todos os campos</option>${sheet.version.fields.map(f => `<option value="${esc(f.name)}" ${f.name === selected ? "selected" : ""}>${esc(f.label || f.name)}</option>`).join("")}</select></label>${result.items.length ? `<ol>${result.items.map(row => `<li><strong>${esc(row.label)}</strong> · ${formatDate(row.createdAt)}<p>${esc(row.oldValue || "—")} → ${esc(row.newValue || "—")}</p>${sheet.canEdit && restorable(row, sheet.version.fields) ? button("Voltar a este valor anterior", "cs-restore-value", String(row.id), "subtle small") : ""}<small>${esc(row.changedBy || "Aventureiro")}${row.session ? " · Sessão " + Number(row.session.number) + ": " + esc(row.session.title) : ""} · ${esc(({ migration: "Migração", edit: "Edição", master: "Mestre", table: "Mesa" })[row.source] || "Alteração")}</small></li>`).join("")}</ol>` : "<p>Nenhuma alteração registrada para este filtro.</p>"}<div class="pagination">${button("Anterior", "cs-history-prev", "", "subtle", result.page <= 1 ? "disabled" : "")}<span>Página ${result.page}</span>${button("Próxima", "cs-history-next", "", "subtle", result.page * result.pageSize >= result.total ? "disabled" : "")}</div>`;
    panel.querySelector("#cs-history-field").onchange = () => { historyPage = 1; history().catch(e => toast(e.message)); };
    const pointForm = panel.querySelector("#cs-restore-point");
    if (pointForm) pointForm.onsubmit = (event) => { event.preventDefault(); restorePoint(pointForm.querySelector("select").value).catch((e) => { if (!dead) toast(e.message); }); };
  }
  let historyRows = [];
  /** Coloca valores do histórico no formulário (sem gravar): a gravação passa pelo "Salvar ficha" com validação e histórico. */
  function applyRestored(values, message) {
    controller.setValues({ ...controller.values(), ...values }); controller.refreshNotes(); syncAccessible(); syncNoteButtons(); refreshCompact(); mark();
    root.querySelector("#cs-saved").textContent = message;
    toast(message);
  }
  async function restorePoint(sessionId) {
    if (!sessionId) return;
    const point = await call(`/characters/${id}/restore-points/${sessionId}`);
    if (dead) return;
    const names = Object.keys(point.values);
    const labels = names.map((n) => sheet.version.fields.find((f) => f.name === n)?.label || n);
    const skipped = point.skipped?.length ? `<p class="form-help">Não restaurados (valor longo demais no histórico): ${point.skipped.map(esc).join(", ")}.</p>` : "";
    modal(`Voltar ao início da sessão ${Number(point.session.number)}`, names.length
      ? `<p>${names.length} campo(s) voltam ao valor de quando a sessão “${esc(point.session.title)}” começou: ${labels.slice(0, 12).map(esc).join(", ")}${labels.length > 12 ? "…" : ""}.</p>${skipped}<p class="form-help">Descrições por item e campos calculados não mudam. Nada é gravado até você salvar a ficha.</p><form id="cs-restore-form"><div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Aplicar no formulário</button></div></form>`
      : `<p>A ficha já está como no início dessa sessão.</p>${skipped}<div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}</div>`);
    const form = $("#cs-restore-form");
    if (form) form.onsubmit = (event) => { event.preventDefault(); $("#modal").close(); applyRestored(point.values, `Valores do início da sessão ${Number(point.session.number)} aplicados. Revise e salve a ficha.`); };
  }
  async function migration() {
    if (dirty) throw new Error("Salve a ficha antes de revisar a migração.");
    const plan = await call(`/characters/${id}/migration`);
    const group = (title, rows) => rows.length ? `<h3>${title}</h3><ul>${rows.map(row => `<li>${esc(row.label)}: ${esc(row.oldValue ?? "—")} → ${esc(row.newValue ?? "—")}</li>`).join("")}</ul>` : "";
    modal("Revisar migração do modelo", `<p>Versão ${plan.from.number} → ${plan.to.number}. Campos removidos continuam no histórico.</p>${group("Preservados", plan.kept)}${group("Adicionados", plan.added)}${group("Ajustados", plan.changed)}${group("Removidos", plan.removed)}${plan.warnings.map(w => `<p role="alert">${esc(w)}</p>`).join("")}<form id="cs-migration">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Migrar para esta versão</button></div></form>`);
    $("#cs-migration").onsubmit = event => {
      event.preventDefault(); submitForm(event.currentTarget, async () => {
        const result = await call(`/characters/${id}/migration`, "POST", { targetVersionId: plan.to.id, revision: plan.revision });
        sheet = result.sheet; $("#modal").close(); if (!dead) await draw(); toast("Ficha migrada. O histórico foi preservado.");
      });
    };
  }
  const click = async event => {
    const b = event.target.closest("[data-action^='cs-']"); if (!b || b.disabled) return;
    const action = b.dataset.action;
    try {
      if (action === "cs-add") {
        if (root.querySelectorAll(".cs-action").length >= 16) throw new Error("Cada ficha pode ter até 16 ações pessoais.");
        root.querySelector("#cs-actions").insertAdjacentHTML("beforeend", actionRow()); mark();
      }
      if (action === "cs-remove") { b.closest(".cs-action").remove(); mark(); }
      if (action === "cs-import") root.querySelector("#cs-import-file")?.click();
      if (action === "cs-notes") openNotes(b.dataset.id);
      if (action === "cs-view-full") setView("full");
      if (action === "cs-view-compact") setView("compact");
      if (action === "cs-find-go") { const hit = findHits[Number(b.dataset.id)]; if (hit) reveal(hit); }
      if (action === "cs-restore-value") {
        const row = historyRows.find((r) => String(r.id) === b.dataset.id);
        if (row && restorable(row, sheet.version.fields)) applyRestored({ [row.field]: row.oldValue ?? "" }, `${row.label} voltou ao valor anterior no formulário. Revise e salve a ficha.`);
      }
      if (action === "cs-draft-restore" || action === "cs-draft-discard") {
        const box = root.querySelector("#cs-draft"), record = draftRecord;
        box.hidden = true; box.replaceChildren(); draftRecord = null;
        if (action === "cs-draft-discard") await dropDraft();
        else if (record?.snapshot) {
          notes = { ...(record.snapshot.notes || {}) };
          applyRestored(record.snapshot.values || {}, "Rascunho restaurado. Revise e salve a ficha.");
        }
      }
      if (action === "cs-copy") {
        if (dirty) throw new Error("Salve suas alterações antes de duplicar a ficha.");
        if (!confirm("Criar uma cópia desta ficha? A cópia fica fora das campanhas, sem histórico, com o nome “(cópia)”.")) return;
        const copy = await withLoading(() => call(`/characters/${id}/copy`, "POST"));
        if (dead) return;
        toast("Ficha duplicada."); navigate("character/" + copy.id);
      }
      if (action === "cs-zoom-in") controller.zoom(controller.zoom() + 0.1);
      if (action === "cs-zoom-out") controller.zoom(controller.zoom() - 0.1);
      if (action === "cs-history-prev") { historyPage--; await history(); }
      if (action === "cs-history-next") { historyPage++; await history(); }
      if (action === "cs-history") await history();
      if (action === "cs-migrate") await migration();
      if (action === "cs-pdf") await withLoading(async () => {
        if (dirty) throw new Error("Salve suas alterações antes de baixar o PDF.");
        const current = await call(`/characters/${id}/sheet`);
        const { filledPdf } = await import("./filled-pdf.js");
        const blob = await filledPdf(current, opts); if (dead) return;
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = downloadName(Object.values(current.values)[0] || "Ficha"); link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    } catch (error) { if (!dead && error.name !== "AbortError") toast(error.message); }
  };
  root.addEventListener("click", click);
  draftTimer = setInterval(() => { writeDraft().catch(() => {}); }, 1000);
  const flushDraft = () => { if (document.visibilityState === "hidden") writeDraft(true).catch(() => {}); };
  const onPageHide = () => { writeDraft(true).catch(() => {}); };
  document.addEventListener("visibilitychange", flushDraft);
  window.addEventListener("pagehide", onPageHide);
  try {
    if (returnCampaignId) releasePresence = keepMasterPresence(await call(`/campaigns/${returnCampaignId}`));
    if (fresh) {
      if (campaignId) {
        const info = await call(`/campaigns/${campaignId}/sheet-template`);
        templates = [{ ...info.template, currentVersion: info.version }];
      } else templates = await call("/sheet-templates");
      if (!templates.length) throw new Error("Nenhum modelo publicado disponível para criar uma ficha.");
      await loadTemplate(templates[0]);
    } else sheet = await call(`/characters/${id}/sheet`);
    if (!dead) await draw();
  } catch (error) {
    if (!dead) root.innerHTML = `<section class="empty"><h2>Não foi possível abrir a ficha.</h2><p>${esc(error.message)}</p><a class="button subtle" href="#characters">Voltar aos personagens</a></section>`;
  }
  return () => {
    writeDraft(true).catch(() => {});
    dead = true; abort.abort(); releasePresence(); releaseSuggest(); releasePortrait(); closeItemNotes(); compact?.destroy(); controller?.destroy();
    clearInterval(draftTimer); clearTimeout(findTimer);
    document.removeEventListener("visibilitychange", flushDraft); window.removeEventListener("pagehide", onPageHide);
    root.removeEventListener("click", click);
  };
}
