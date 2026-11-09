import { helpButton } from "./help.js";
import { api } from "./api.js";
import { shell } from "./layout.js";
import { $, esc, button, field, formError, submitForm, toast, modal, formatDate, navigate } from "./ui.js";
import { renderSheet } from "./pdf-sheet.js";
import { validate } from "./formula.js";
import { editableValues, ownActions, downloadName } from "./character-policy.js";
import { withLoading } from "./loading.js";
import { keepMasterPresence } from "./session-presence.js";
import { formulaSuggestOn } from "./formula-suggest.js";

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
function accessibleFields(fields, values) {
  return fields.map(f => {
    const value = String(values[f.name] ?? f.default ?? "");
    const id = "cs-access-" + f.name;
    let control;
    if (f.type === "select") control = `<select id="${esc(id)}" data-cs-field="${esc(f.name)}"><option value="">—</option>${(f.options || []).map(o => `<option value="${esc(o)}" ${value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else if (f.type === "textarea") control = `<textarea id="${esc(id)}" data-cs-field="${esc(f.name)}" maxlength="${Number(f.maxLength) || 2000}">${esc(value)}</textarea>`;
    else control = `<input id="${esc(id)}" data-cs-field="${esc(f.name)}" type="${f.type === "checkbox" ? "checkbox" : "text"}" ${f.type === "computed" ? 'readonly aria-readonly="true"' : ""} ${f.type === "number" ? 'inputmode="decimal"' : ""} ${f.type === "checkbox" && value === "true" ? "checked" : ""} value="${esc(value)}" maxlength="${Number(f.maxLength) || 2000}">`;
    return `<div class="field"><label for="${esc(id)}">${esc(f.label || f.name)}${f.type === "computed" ? " (calculado)" : ""}</label>${control}</div>`;
  }).join("");
}
export async function renderCharacterPage(id, context) {
  shell("characters");
  const root = $("#main");
  const abort = new AbortController();
  const opts = { signal: abort.signal };
  let controller, sheet, dirty = false, historyPage = 1, dead = false, releasePresence = () => {};
  // Fórmulas das ações pessoais: @atributos numéricos do modelo desta ficha.
  const releaseSuggest = formulaSuggestOn(root, '.cs-action input[data-k="formula"]', () => (sheet?.version?.fields || []).filter((f) => f.type === "number" || f.type === "computed"));
  const fresh = id === "new";
  const campaignId = fresh && context && /^[0-9a-f-]{36}$/i.test(context) ? context : null;
  const returnCampaignId = !fresh && context && /^[0-9a-f-]{36}$/i.test(context) ? context : null;
  const call = (path, method = "GET", body) => api(path, method, body, opts);
  const mark = () => { dirty = true; const note = root.querySelector("#cs-saved"); if (note) note.textContent = "Há alterações ainda não salvas."; };
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
    root.innerHTML = `<a class="back-link" href="${returnCampaignId ? "#table/" + esc(returnCampaignId) : campaignId ? "#campaign/" + esc(campaignId) : "#characters"}">← Voltar</a><div class="page-heading"><div><span class="eyebrow">SUA LENDA, SEUS CAPÍTULOS</span><h1>${fresh ? "Criar personagem" : "Sua ficha"}${helpButton("fichas.versao.migracao", "Versão da ficha")}</h1><p>${esc(sheet.template.name)} · versão ${version.number}${sheet.legacy ? " · ficha antiga, preservada no Sistema livre" : ""}</p></div></div>${fresh ? `<div class="field"><label for="cs-template">Ficha-modelo</label><select id="cs-template" ${campaignId ? "disabled" : ""}></select></div>` : ""}${sheet.newerVersion ? `<section class="notice-box"><strong>Nova versão do modelo disponível: v${sheet.newerVersion.number}.</strong><p>Sua ficha continua na versão atual até você revisar a migração.</p>${button("Revisar migração", "cs-migrate", "", "subtle")}</section>` : ""}<form id="cs-form" class="cs-form"><div class="field-label"><span>Visibilidade da ficha</span>${helpButton("fichas.visibilidade.privacidade", "Ficha compartilhada ou privada")}</div>${fresh || sheet.canChangeVisibility ? `<label class="field"><span><input id="cs-private" type="checkbox" ${sheet.private ? "checked" : ""}> Ficha privada: somente você e o mestre</span></label><p class="form-help">Desmarcada: os participantes da mesa podem ler a ficha. Histórico e edição ficam com o dono e o mestre.</p>` : `<p>${sheet.private ? "Ficha privada." : "Ficha compartilhada."} ${canEdit ? "Somente o dono pode alterar a visibilidade." : "Somente leitura."}</p>`}${fresh && !version.fields.some(f => f.role === "name") ? field("name", "Nome do personagem", "", "text", 'required maxlength="100"') : ""}<div class="cs-toolbar">${helpButton("fichas.pdf.exportacao", "PDF preenchido")}${button("− Zoom", "cs-zoom-out", "", "subtle")}${button("+ Zoom", "cs-zoom-in", "", "subtle")}${!fresh ? button("Baixar PDF preenchido", "cs-pdf", "", "subtle") + button("Histórico por campo", "cs-history", "", "subtle") : ""}<button type="submit" class="primary">${fresh ? "Criar personagem" : "Salvar ficha"}</button></div><p id="cs-saved" class="form-help" role="status">${fresh ? "Preencha sua ficha. Campos calculados são atualizados automaticamente." : "Ficha carregada. O PDF usa os últimos valores salvos."}</p>${formError()}<details class="cs-accessible metal"><summary>Preencher em formulário acessível</summary><p>Os mesmos valores da ficha, com campos maiores para teclado e celular.</p><div id="cs-accessible">${accessibleFields(version.fields, { ...sheet.values, ...sheet.computed })}</div></details><div id="cs-pages" class="cs-pages"></div><section class="metal cs-actions"><h2>Ações do modelo</h2>${version.actions.length ? version.actions.map(a => `<p><strong>${esc(a.name)}</strong> · ${esc(a.formula || "Narrativa")}<br>${esc(a.description)}</p>`).join("") : "<p>Este modelo não define ações.</p>"}<h2>Suas ações</h2><p class="form-help">Use fórmulas em inglês e campos como @nome_do_campo. Até 16 ações pessoais.</p><div id="cs-actions">${ownActions(sheet).map(actionRow).join("")}</div>${button("+ Adicionar ação", "cs-add", "", "subtle")}</section></form><section id="cs-history" class="metal cs-history" hidden></section>`;
    controller = renderSheet(root.querySelector("#cs-pages"), { pdfUrl: version.pdfUrl, pages: version.pages, fields: version.fields, mode: canEdit ? "fill" : "view", values: { ...sheet.values, ...sheet.computed }, onChange: () => { mark(); syncAccessible(); } });
    if (!canEdit) {
      const hint = document.createElement('p'); hint.id = 'cs-readonly'; hint.className = 'form-help'; hint.textContent = 'Somente leitura. A edição e o histórico exigem o dono ou o Mestre autorizado.';
      root.querySelector('#cs-form').prepend(hint);
      for (const control of root.querySelectorAll("#cs-form input, #cs-form textarea, #cs-form select, #cs-form button[type=submit], [data-action=cs-add], [data-action=cs-remove], [data-action=cs-history], [data-action=cs-migrate]")) {
        control.disabled = true;
        control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '));
      }
    }
    if (fresh) await fillTemplates();
    root.querySelector("#cs-form").addEventListener("input", event => {
      const input = event.target.closest("[data-cs-field]");
      if (input && !input.readOnly) {
        controller.setValues({ ...controller.values(), [input.dataset.csField]: input.type === "checkbox" ? String(input.checked) : input.value });
        syncAccessible();
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
          sheet = await call(`/characters/${id}/sheet`, "PUT", { values, actions, revision: sheet.revision, private: privateSheet });
          if (dead) return;
          controller.setValues({ ...sheet.values, ...sheet.computed }); syncAccessible(); dirty = false;
          root.querySelector("#cs-saved").textContent = "Ficha salva."; toast("Ficha salva.");
        }
      });
    };
    await controller.ready;
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
    const selected = panel.querySelector("select")?.value || "";
    const result = await call(`/characters/${id}/field-history?` + new URLSearchParams({ field: selected, page: historyPage }));
    if (dead) return;
    panel.innerHTML = `<h2>Histórico por campo${helpButton("fichas.historico.privado", "Histórico de alterações")}</h2><label>Filtrar campo<select id="cs-history-field"><option value="">Todos os campos</option>${sheet.version.fields.map(f => `<option value="${esc(f.name)}" ${f.name === selected ? "selected" : ""}>${esc(f.label || f.name)}</option>`).join("")}</select></label>${result.items.length ? `<ol>${result.items.map(row => `<li><strong>${esc(row.label)}</strong> · ${formatDate(row.createdAt)}<p>${esc(row.oldValue || "—")} → ${esc(row.newValue || "—")}</p><small>${esc(row.changedBy || "Aventureiro")}${row.session ? " · Sessão " + Number(row.session.number) + ": " + esc(row.session.title) : ""} · ${esc(({ migration: "Migração", edit: "Edição", master: "Mestre", table: "Mesa" })[row.source] || "Alteração")}</small></li>`).join("")}</ol>` : "<p>Nenhuma alteração registrada para este filtro.</p>"}<div class="pagination">${button("Anterior", "cs-history-prev", "", "subtle", result.page <= 1 ? "disabled" : "")}<span>Página ${result.page}</span>${button("Próxima", "cs-history-next", "", "subtle", result.page * result.pageSize >= result.total ? "disabled" : "")}</div>`;
    panel.querySelector("select").onchange = () => { historyPage = 1; history().catch(e => toast(e.message)); };
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
  return () => { dead = true; abort.abort(); releasePresence(); releaseSuggest(); controller?.destroy(); root.removeEventListener("click", click); };
}
