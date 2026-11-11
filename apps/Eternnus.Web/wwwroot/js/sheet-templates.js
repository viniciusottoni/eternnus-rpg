import { helpButton } from "./help.js";
// Fichas-modelo (#templates, #templates/{id}, #templates/{id}/versions/{versionId}): lista por sistema, página do modelo com versões,
// editor visual do rascunho (PDF de fundo + campos arrastáveis, propriedades, ações, teste com valores de exemplo, publicação com diff)
// e visualização de versões publicadas. Somente equipe (admin/embaixador); o servidor reaplica papel e auditoria em todas as rotas.
// Regras puras ficam em sheet-editor-policy.js; a página com PDF e campos em pdf-sheet.js; fórmulas em formula.js.
import { api, ApiError } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { $, esc, button, formError, modal, toast, empty, formatDate, navigate, submitForm } from "./ui.js";
import { isAdmin } from "./policy.js";
import { mountClientTable } from "./data-table.js";
import { isGuid } from "./session-policy.js";
import { renderSheet, clampZoom } from "./pdf-sheet.js";
import { validate, validateFields, rollPreview, computeSheet, sheetScope } from "./formula.js";
import {
  LIMITS,
  FIELD_TYPES,
  FIELD_ROLES,
  ACTION_KINDS,
  ALIGNS,
  CHANGE_LABELS,
  UndoStack,
  typeInfo,
  roleInfo,
  kindInfo,
  normalizeField,
  normalizeRect,
  newField,
  duplicateField,
  compactDoc,
  structuralIssues,
  publishIssues,
  diffVersions,
  diffIsEmpty,
  sampleValues,
  numericNames,
  validateFieldName,
  validateActionKey,
  nameFromLabel,
  suggestName,
  referenceSuggestions,
  applySuggestion,
  lostOnRename,
} from "./sheet-editor-policy.js";

const PAGE_SIZE = 20;
let generation = 0;
let cleanup = null;

// ---------- Regras puras da tela (exportadas para testes) ----------

/** Situação de uma versão para o selo: rascunho, publicada atual ou arquivada (publicada substituída). */
export function versionStatus(v) {
  if (v.isDraft) return { label: "Rascunho", tone: "warn" };
  if (v.isCurrent) return { label: "Publicada · atual", tone: "good" };
  return { label: "Arquivada", tone: "quiet" };
}
/** Converte mensagens de validateFields (formula.js) em itens { field, index, message } apontando o campo. */
export function formulaIssues(fields) {
  const out = [];
  for (const message of validateFields(fields)) {
    const named = /^([a-z][a-z0-9_]{0,39}):\s/.exec(message);
    const numbered = /^Campo (\d+):\s/.exec(message);
    if (named) out.push({ field: named[1], index: fields.findIndex((f) => f.name === named[1]), message: "Campo " + message });
    else if (numbered) out.push({ index: Number(numbered[1]) - 1, message });
    else out.push({ message });
  }
  return out;
}
/** Todos os problemas que impedem publicar: estrutura + semântica (policy), fórmulas e regras de formula.js e fórmulas de ação. */
export function collectIssues(doc) {
  const compact = compactDoc(doc);
  const fields = compact.fields.map((f, i) => ({ ...f, page: f.page ?? 0, options: f.options || [], index: i }));
  const issues = publishIssues({ ...doc, fields: doc.fields.map((f) => ({ ...f, label: f.label || f.name })) });
  const seen = new Set(issues.map((i) => i.message));
  // Regras de formula.js que o espelho do editor não cobre (fórmulas, ciclos, fonte, opções, limites).
  for (const issue of formulaIssues(fields.map(({ index, ...f }) => f))) {
    if (/papel|nome inválido|nome repetido|opções repetidas|mínimo maior/.test(issue.message)) continue;
    if (seen.has(issue.message)) continue;
    seen.add(issue.message);
    issues.push(issue);
  }
  const names = numericNames(doc.fields);
  doc.actions.forEach((a, i) => {
    if (!String(a.formula || "").trim()) return;
    const check = validate(a.formula, "roll", names);
    if (!check.ok) issues.push({ action: a.key, actionIndex: i, message: `Ação ${a.name || a.key}: ${check.error}` });
  });
  return issues;
}
/** Mensagem curta para falhas de envio de PDF. */
export function pdfUploadError(error) {
  if (!(error instanceof ApiError)) return "A conexão caiu durante o envio. Confira o arquivo (PDF de até 25 MB) e tente novamente.";
  if (error.status === 413) return "O PDF excede o limite de 25 MB. Reduza o arquivo antes de enviar.";
  if (error.status === 415) return "O arquivo não é um PDF válido (o tipo é conferido pelo conteúdo, não pela extensão).";
  if (error.status === 503) return "A verificação de segurança de arquivos está indisponível agora. Nada foi alterado; tente mais tarde.";
  if (error.status === 429) return "Muitos envios em pouco tempo. Aguarde alguns minutos.";
  if (error.status === 409) return "O rascunho mudou em outra sessão. Recarregue antes de enviar o PDF.";
  return error.message;
}
/** Conferência local do PDF antes de abrir (UX). O servidor confere assinatura, tamanho real e antivírus. */
export function precheckPdf(file) {
  if (!file || !file.size) return "Escolha um arquivo PDF.";
  if (file.size > LIMITS.pdfBytes) return "O PDF excede o limite de 25 MB.";
  if (file.type && file.type !== "application/pdf") return "Escolha um arquivo PDF.";
  return "";
}
const date = (value) => (value ? formatDate(String(value)) : "—");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Rota base e contêiner: #templates/#main para embaixadores; #admin/templates dentro do Painel admin para administradores.
let base = "templates";
let host = null;
const routeOf = (...parts) => [base, ...parts].join("/");
const root = () => host || $("#main");

// ---------- Entrada ----------

/** `embed` ({ base, root }) monta o módulo dentro de outra tela (Painel admin) sem redesenhar o shell. */
export async function renderTemplates(segments = [], embed = null) {
  cleanup?.();
  cleanup = null;
  const gen = ++generation;
  if (!embed && isAdmin(state.user)) {
    // Admin edita fichas-modelo pelo painel; replace evita prender o botão Voltar no redirecionamento.
    location.replace("#" + ["admin", "templates", ...segments].join("/"));
    return;
  }
  base = embed?.base || "templates";
  host = embed?.root || null;
  if (!embed) shell("templates");
  const [id, sub, versionId] = segments;
  if (segments.length && (!isGuid(id) || (segments.length > 1 && (sub !== "versions" || !isGuid(versionId))))) {
    root().innerHTML = notFound();
    return;
  }
  if (!id) await renderList(gen);
  else if (!versionId) await renderTemplatePage(gen, id);
  else await renderVersionPage(gen, id, versionId);
  return () => {
    generation++;
    cleanup?.();
    cleanup = null;
  };
}

const backToList = () => `<a class="tpl-back" href="#${routeOf()}">← Fichas-modelo</a>`;
const notFound = () =>
  `${backToList()}${empty("Ficha-modelo não encontrada.", "O endereço está incorreto ou o modelo foi removido.")}`;
function failure(error, retry) {
  if (error instanceof ApiError && error.status === 404) return notFound();
  if (error instanceof ApiError && error.status === 403)
    return empty("Área da equipe.", "Somente administradores e embaixadores editam fichas-modelo.");
  return `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>Não foi possível carregar.</h3><p>${esc(error.message)}</p>${button("Tentar novamente", retry, "", "primary")}</div>`;
}

// ---------- Lista ----------

const listState = { systemId: "", archived: false, page: 1 };
async function renderList(gen) {
  const main = root();
  const intro = "PDFs de ficha com campos marcados: a ficha de cada jogador nasce de uma versão publicada.";
  const newButton = button("+ Nova ficha-modelo", "tpl-new", "", "primary");
  // Dentro do painel o título da página já existe: a lista abre com um cabeçalho de seção.
  main.innerHTML = `${
    host
      ? `<div class="section-title tpl-embed-head"><div><h2>Fichas-modelo</h2><p class="muted small">${intro}</p></div>${newButton}</div>`
      : `<div class="page-heading"><div><span class="eyebrow">OFICINA DA EQUIPE</span><h1>Fichas-modelo <span class="heading-gem">✦</span></h1><p>${intro}</p></div>${newButton}</div>`
  }
<form class="tpl-filters" id="tpl-filters" role="search" aria-label="Filtrar fichas-modelo">
  <div class="tpl-filter"><label for="tpl-system">Sistema</label><select id="tpl-system" name="systemId"><option value="">Todos os sistemas</option></select></div>
  <label class="tpl-toggle"><input type="checkbox" id="tpl-archived" ${listState.archived ? "checked" : ""}> Mostrar arquivados</label>
</form>
<div id="tpl-list" class="tpl-list" aria-live="polite" aria-busy="true"><p class="tpl-loading">Carregando fichas-modelo…</p></div>
<div id="tpl-pagination" class="pagination"></div>`;
  const systems = await loadSystems();
  if (gen !== generation) return;
  const select = $("#tpl-system");
  for (const s of systems) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    o.selected = s.id === listState.systemId;
    select.append(o);
  }
  select.onchange = () => {
    listState.systemId = select.value;
    listState.page = 1;
    loadList(gen);
  };
  $("#tpl-archived").onchange = (e) => {
    listState.archived = e.target.checked;
    listState.page = 1;
    loadList(gen);
  };
  $("#tpl-filters").onsubmit = (e) => e.preventDefault();
  main.onclick = (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    if (b.dataset.action === "tpl-new") openCreate(systems);
    if (b.dataset.action === "tpl-retry") loadList(gen);
    if (b.dataset.action === "tpl-page") {
      listState.page = Number(b.dataset.id) || 1;
      loadList(gen);
    }
  };
  await loadList(gen);
}
async function loadSystems() {
  try {
    const list = await api("/rpg-systems", "GET", undefined, { background: true });
    return Array.isArray(list) ? list.filter((s) => isGuid(s?.id)) : [];
  } catch {
    return [];
  }
}
async function loadList(gen) {
  const box = $("#tpl-list");
  box.setAttribute("aria-busy", "true");
  const query = new URLSearchParams({ page: String(listState.page) });
  if (listState.systemId) query.set("systemId", listState.systemId);
  if (listState.archived) query.set("archived", "true");
  try {
    const data = await api("/sheet-templates/manage?" + query, "GET", undefined, { background: true });
    if (gen !== generation) return;
    box.innerHTML = data.items.length
      ? data.items.map(templateRow).join("")
      : listState.systemId || listState.archived
        ? empty("Nenhuma ficha-modelo aqui.", listState.archived ? "Não há modelos arquivados com este filtro." : "Este sistema ainda não tem fichas-modelo. Crie a primeira.", "tpl-new", "+ Nova ficha-modelo")
        : empty("Nenhuma ficha-modelo ainda.", "Envie o PDF de uma ficha e marque os campos para os jogadores preencherem.", "tpl-new", "+ Nova ficha-modelo");
    const pages = Math.max(1, Math.ceil(data.total / (data.pageSize || PAGE_SIZE)));
    $("#tpl-pagination").innerHTML =
      pages > 1
        ? `${button("← Anterior", "tpl-page", data.page - 1, "subtle", data.page <= 1 ? "disabled" : "")}<span>Página ${data.page} de ${pages}</span>${button("Próxima →", "tpl-page", data.page + 1, "subtle", data.page >= pages ? "disabled" : "")}`
        : "";
  } catch (error) {
    if (gen !== generation) return;
    box.innerHTML = failure(error, "tpl-retry");
    $("#tpl-pagination").innerHTML = "";
  } finally {
    box.setAttribute("aria-busy", "false");
  }
}
function templateRow(t) {
  if (!isGuid(t.id)) return "";
  const chips = [
    t.isDefault ? '<span class="status-chip good">Padrão do sistema</span>' : "",
    t.isFree ? '<span class="status-chip">Embutido</span>' : "",
    t.archived ? '<span class="status-chip quiet">Arquivado</span>' : "",
    t.currentVersion ? `<span class="status-chip">Publicada v${Number(t.currentVersion.number)}</span>` : '<span class="status-chip warn">Sem versão publicada</span>',
    t.draft ? `<span class="status-chip warn">Rascunho v${Number(t.draft.number)}</span>` : "",
  ].join("");
  const draftLink = t.draft && isGuid(t.draft.id) ? `<a class="button primary" href="#${routeOf(t.id, "versions", t.draft.id)}">Editar rascunho</a>` : "";
  return `<article class="tpl-row metal">
  <span class="tpl-row-icon" aria-hidden="true">▤</span>
  <div class="tpl-row-info"><h2><a href="#${routeOf(t.id)}">${esc(t.name)}</a></h2>
    <div class="tpl-row-meta"><span>${esc(t.system || "Sistema")}</span><span>${plural(Number(t.versionCount) || 0, "versão", "versões")}</span><span>${plural(Number(t.characterCount) || 0, "ficha de jogador", "fichas de jogadores")}</span><span>Atualizada ${esc(date(t.updatedAt))}</span></div>
    ${t.description ? `<p>${esc(t.description)}</p>` : ""}
    <div class="tpl-chips">${chips}</div></div>
  <div class="tpl-row-actions">${draftLink}<a class="button subtle" href="#${routeOf(t.id)}">Abrir</a></div>
</article>`;
}
function openCreate(systems) {
  if (!systems.length) {
    modal("Nova ficha-modelo", `<p>Não foi possível carregar os sistemas de RPG agora. Atualize a página e tente novamente.</p>`);
    return;
  }
  const preset = listState.systemId;
  modal(
    "Nova ficha-modelo",
    `<form id="tpl-create" class="tpl-form">
  <div class="field"><label for="f-tpl-system">Sistema de RPG</label><select id="f-tpl-system" name="systemId" required>${systems
    .map((s) => `<option value="${esc(s.id)}" ${s.id === preset ? "selected" : ""}>${esc(s.name)}</option>`)
    .join("")}</select></div>
  <div class="field"><label for="f-tpl-name">Nome</label><input id="f-tpl-name" name="name" required maxlength="100" autocomplete="off" placeholder="Ex.: Ficha oficial do aventureiro"></div>
  <div class="field"><label for="f-tpl-description">Descrição (opcional)</label><textarea id="f-tpl-description" name="description" maxlength="2000" rows="3"></textarea></div>
  <p class="tpl-help">Começa como rascunho com uma página A4 em branco. Depois você envia o PDF e marca os campos.</p>
  ${formError()}
  <div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Criar e abrir o editor</button></div>
</form>`,
  );
  const form = $("#tpl-create");
  form.elements.name.focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const created = await api("/sheet-templates", "POST", { systemId: data.systemId, name: data.name, description: data.description });
      $("#modal").close();
      toast("Ficha-modelo criada. Envie o PDF e marque os campos.");
      navigate(routeOf(created.id, "versions", created.draftId));
    });
  };
}

// ---------- Página do modelo ----------

async function renderTemplatePage(gen, id) {
  const main = root();
  main.innerHTML = `${backToList()}<p class="tpl-loading" aria-live="polite">Carregando ficha-modelo…</p>`;
  let t;
  try {
    t = await api("/sheet-templates/" + id);
  } catch (error) {
    if (gen !== generation) return;
    main.innerHTML = backToList() + failure(error, "tpl-reload");
    main.onclick = (e) => e.target.closest('[data-action="tpl-reload"]') && renderTemplatePage(gen, id);
    return;
  }
  if (gen !== generation) return;
  const versions = (t.versions || []).filter((v) => isGuid(v.id));
  const draft = versions.find((v) => v.isDraft);
  const admin = isAdmin(state.user);
  main.innerHTML = `${backToList()}
<div class="page-heading"><div><span class="eyebrow">${esc(String(t.system || "").toUpperCase())}</span><h1>${esc(t.name)}</h1>
  <div class="tpl-chips">${t.isDefault ? '<span class="status-chip good">Padrão do sistema</span>' : ""}${t.isFree ? '<span class="status-chip">Modelo embutido</span>' : ""}${t.archived ? '<span class="status-chip quiet">Arquivado</span>' : ""}${t.currentVersion ? `<span class="status-chip">Publicada v${Number(t.currentVersion.number)}</span>` : '<span class="status-chip warn">Sem versão publicada</span>'}</div>
  ${t.description ? `<p class="tpl-description">${esc(t.description)}</p>` : ""}</div>
  <div class="tpl-heading-actions">${button("Editar dados", "tpl-meta", "", "subtle")}${
    draft
      ? `<a class="button primary" href="#${routeOf(t.id, "versions", draft.id)}">Editar rascunho v${Number(draft.number)}</a>`
      : button(t.currentVersion ? "+ Nova versão" : "+ Criar rascunho", "tpl-version-new", "", "primary")
  }</div></div>
<section class="tpl-section"><div class="section-title"><h2>Versões${helpButton("modelos.versao.publicacao", "Rascunho e publicação")}</h2><span>PUBLICADAS SÃO IMUTÁVEIS</span></div>
${
  versions.length
    ? `<div data-tpl-versions></div>`
    : empty("Nenhuma versão.", "Crie um rascunho para começar a marcar os campos.", "tpl-version-new", "+ Criar rascunho")
}
<p class="tpl-help">Fichas de jogadores ficam presas à versão em que nasceram e migram para a nova com um clique. Campos são casados pelo <strong>nome</strong>: renomear ou remover um campo descarta o valor nas fichas migradas.</p>
</section>`;
  mountVersions(main, t, versions, !!draft, admin);
  main.onclick = (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const action = b.dataset.action;
    if (action === "tpl-meta") openMeta(gen, t);
    if (action === "tpl-version-new") createDraft(t, b.dataset.id && isGuid(b.dataset.id) ? b.dataset.id : null);
    if (action === "tpl-version-discard") discardDraft(gen, t, b.dataset.id);
    if (action === "tpl-version-republish") republish(gen, t, b.dataset.id);
  };
}
/** Versões em tabela: busca no número e nas notas, filtro de situação; 15 por página. Ações seguem no clique delegado. */
function mountVersions(root, t, versions, hasDraft, admin) {
  const box = root.querySelector("[data-tpl-versions]");
  if (!box) return;
  mountClientTable(box, {
    id: "tv",
    rows: versions.map((v) => ({ ...v, label: `v${Number(v.number)}`, situation: v.isDraft ? "draft" : v.isCurrent ? "current" : "archived" })),
    fields: ["label", "notes"],
    search: { label: "Buscar versões", placeholder: "Número ou notas" },
    filters: [{ name: "situation", label: "Situação", options: [["draft", "Rascunho"], ["current", "Publicada · atual"], ["archived", "Arquivada"]] }],
    unit: "versões",
    table: (items) => `<div class="data-table-wrap" tabindex="0" role="region" aria-label="Versões da ficha-modelo"><table class="data-table tpl-versions"><thead><tr><th scope="col">Versão</th><th scope="col">Situação</th><th scope="col">Criada</th><th scope="col">Publicada</th><th scope="col">PDF</th><th scope="col" class="num">Fichas</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${items.map((v) => versionRow(t, v, hasDraft, admin)).join("")}</tbody></table></div>`,
  });
}
function versionRow(t, v, hasDraft, admin) {
  const s = versionStatus(v);
  const actions = [
    `<a class="button small ${v.isDraft ? "primary" : "subtle"}" href="#${routeOf(t.id, "versions", v.id)}">${v.isDraft ? "Editar" : "Ver"}</a>`,
    v.isDraft ? button("Descartar", "tpl-version-discard", v.id, "small danger") : "",
    !v.isDraft && !hasDraft ? button("Novo rascunho desta", "tpl-version-new", v.id, "small subtle") : "",
    !v.isDraft && !v.isCurrent && admin ? button("Republicar", "tpl-version-republish", v.id, "small subtle") : "",
  ].join("");
  return `<tr><td data-label="Versão"><strong>v${Number(v.number)}</strong>${v.notes ? `<small class="tpl-notes">${esc(v.notes)}</small>` : ""}</td><td data-label="Situação"><span class="status-chip ${s.tone}">${s.label}</span></td><td data-label="Criada">${esc(date(v.createdAt))}</td><td data-label="Publicada">${v.publishedAt ? `${esc(date(v.publishedAt))}${v.publishedBy ? `<small>por ${esc(v.publishedBy)}</small>` : ""}` : "—"}</td><td data-label="PDF">${v.hasPdf ? "Com PDF" : "Páginas em branco"}</td><td data-label="Fichas" class="num">${Number(v.characters) || 0}</td><td class="tpl-version-actions">${actions}</td></tr>`;
}
async function createDraft(t, fromVersionId) {
  try {
    const draft = await api(`/sheet-templates/${t.id}/versions`, "POST", { fromVersionId });
    toast(`Rascunho v${Number(draft.number)} criado.`);
    navigate(routeOf(t.id, "versions", draft.id));
  } catch (error) {
    toast(error.message);
  }
}
function discardDraft(gen, t, versionId) {
  if (!isGuid(versionId)) return;
  modal(
    "Descartar rascunho",
    `<p>O rascunho e o PDF enviado nele (se não for usado por outra versão) serão apagados. Versões publicadas não mudam.</p><div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${button("Descartar rascunho", "tpl-confirm-discard", "", "danger")}</div>`,
  );
  $("#modal-body").querySelector('[data-action="tpl-confirm-discard"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api(`/sheet-templates/${t.id}/versions/${versionId}`, "DELETE");
      sessionStorage.removeItem(backupKey(versionId));
      $("#modal").close();
      toast("Rascunho descartado.");
      renderTemplatePage(gen, t.id);
    } catch (error) {
      e.target.disabled = false;
      toast(error.message);
    }
  };
}
function republish(gen, t, versionId) {
  if (!isGuid(versionId)) return;
  modal(
    "Republicar versão antiga",
    `<p>Uma cópia desta versão será publicada como a nova versão atual. Fichas existentes não mudam até migrarem. A ação fica registrada na auditoria.</p><div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${button("Republicar", "tpl-confirm-republish", "", "primary")}</div>`,
  );
  $("#modal-body").querySelector('[data-action="tpl-confirm-republish"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const result = await api(`/sheet-templates/${t.id}/versions/${versionId}/republish`, "POST");
      $("#modal").close();
      toast(`Publicada como v${Number(result.number)}.`);
      renderTemplatePage(gen, t.id);
    } catch (error) {
      e.target.disabled = false;
      toast(error.message);
    }
  };
}
function openMeta(gen, t) {
  modal(
    "Dados da ficha-modelo",
    `<form id="tpl-meta" class="tpl-form">
  <div class="field"><label for="f-meta-name">Nome</label><input id="f-meta-name" name="name" required maxlength="100" value="${esc(t.name)}"></div>
  <div class="field"><label for="f-meta-description">Descrição</label><textarea id="f-meta-description" name="description" maxlength="2000" rows="3">${esc(t.description || "")}</textarea></div>
  <label class="tpl-check"><input type="checkbox" name="isDefault" ${t.isDefault ? "checked" : ""} ${t.isDefault ? "disabled" : ""}> Padrão do sistema para novas fichas${t.isDefault ? " <small>(para trocar, marque outro modelo como padrão)</small>" : t.currentVersion ? "" : " <small>(publique uma versão antes)</small>"}</label>
  <label class="tpl-check"><input type="checkbox" name="archived" ${t.archived ? "checked" : ""} ${t.isFree ? "disabled" : ""}> Arquivado (some da escolha de novas fichas; fichas existentes continuam)</label>
  ${formError()}
  <div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar</button></div>
</form>`,
  );
  const form = $("#tpl-meta");
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async () => {
      await api("/sheet-templates/" + t.id, "PUT", {
        name: form.elements.name.value,
        description: form.elements.description.value,
        isDefault: t.isDefault || form.elements.isDefault.checked,
        archived: form.elements.archived.checked,
        revision: t.revision,
      });
      $("#modal").close();
      toast("Dados salvos.");
      renderTemplatePage(gen, t.id);
    });
  };
}

// ---------- Versão: editor (rascunho) ou visualização (publicada) ----------

const backupKey = (versionId) => "eternnus.template-draft." + versionId;
const snapshot = (doc) => JSON.stringify({ pages: doc.pages, fields: doc.fields, actions: doc.actions, notes: doc.notes });
const PROP_LABELS = { name: "Nome do personagem", level: "Nível", hp: "Vida", maxHp: "Vida máx.", movement: "Deslocamento", armor: "Armadura", light: "Luz", vision: "Visão própria", perception: "Percepção", senses: "Sentidos", reach: "Alcance de ataque" };

async function renderVersionPage(gen, id, versionId) {
  const main = root();
  main.innerHTML = `<a class="tpl-back" href="#${routeOf(id)}">← Ficha-modelo</a><p class="tpl-loading" aria-live="polite">Abrindo a versão…</p>`;
  let t, v, published = null;
  try {
    [t, v] = await Promise.all([api("/sheet-templates/" + id), api(`/sheet-templates/${id}/versions/${versionId}`)]);
    const currentId = t.currentVersion?.id;
    if (isGuid(currentId) && currentId !== versionId) published = await api(`/sheet-templates/${id}/versions/${currentId}`, "GET", undefined, { background: true });
  } catch (error) {
    if (gen !== generation) return;
    main.innerHTML = `<a class="tpl-back" href="#${routeOf(id)}">← Ficha-modelo</a>` + failure(error, "tpl-reload");
    main.onclick = (e) => e.target.closest('[data-action="tpl-reload"]') && renderVersionPage(gen, id, versionId);
    return;
  }
  if (gen !== generation) return;
  const editor = new Editor(main, t, v, published);
  cleanup = () => editor.destroy();
}

class Editor {
  constructor(main, template, version, published) {
    this.main = main;
    this.t = template;
    this.v = version;
    this.isDraft = !!version.isDraft;
    // Diferenças e avisos de renomeação só fazem sentido no rascunho (comparado à versão publicada atual).
    this.published = version.isDraft ? published : null;
    this.publishedNames = (published?.fields || []).map((f) => f.name);
    this.revision = version.revision;
    this.hasPdf = !!version.hasPdf;
    this.doc = {
      pages: (version.pages || []).map((p) => ({ width: p.width, height: p.height })),
      fields: (version.fields || []).map((f) => ({ ...normalizeField(f), origin: this.publishedNames.includes(f.name) ? f.name : null })),
      actions: (version.actions || []).map((a) => ({ key: a.key || "", name: a.name || "", kind: a.kind || "ataque", formula: a.formula || "", description: a.description || "" })),
      notes: version.notes || "",
    };
    if (!this.doc.pages.length) this.doc.pages = [{ width: 595.28, height: 841.89 }];
    this.saved = JSON.stringify(compactDoc(this.doc));
    this.undo = new UndoStack();
    this.selected = -1;
    this.tab = "field";
    this.view = "draw";
    this.snap = false;
    this.zoomValue = 1;
    this.samples = sampleValues(this.doc.fields);
    this.issues = [];
    this.lastKey = "";
    this.lastAt = 0;
    this.saving = false;
    this.pdfToken = 0;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    document.addEventListener("keydown", (e) => this.onShortcut(e), { signal });
    window.addEventListener("beforeunload", (e) => this.dirty && e.preventDefault(), { signal });
    main.addEventListener(
      "focusout",
      (e) => {
        if (e.target.getAttribute?.("role") === "combobox" && this.suggestion?.input === e.target) this.closeSuggest(e.target);
      },
      { signal },
    );
    this.render();
    this.offerBackup();
  }

  // ----- Estrutura -----
  render() {
    const t = this.t,
      v = this.v;
    const status = this.isDraft ? `<span class="status-chip warn">Rascunho v${Number(v.number)}</span>` : `<span class="status-chip ${t.currentVersion?.id === v.id ? "good" : "quiet"}">v${Number(v.number)} · ${t.currentVersion?.id === v.id ? "publicada, atual" : "arquivada"}</span>`;
    const draftId = t.draftId && isGuid(t.draftId) ? t.draftId : null;
    const actions = this.isDraft
      ? `${button("↶", "ed-undo", "", "subtle tpl-icon", 'aria-label="Desfazer (Ctrl+Z)" data-tip="Desfazer (Ctrl+Z)" aria-describedby="ed-history-help" disabled')}${button("↷", "ed-redo", "", "subtle tpl-icon", 'aria-label="Refazer (Ctrl+Shift+Z)" data-tip="Refazer (Ctrl+Shift+Z)" aria-describedby="ed-history-help" disabled')}${button("Salvar", "ed-save", "", "subtle", 'data-tip="Ctrl+S"')}${button("Publicar…", "ed-publish", "", "primary")}`
      : draftId
        ? `<a class="button primary" href="#${routeOf(t.id, "versions", draftId)}">Abrir rascunho</a>`
        : button("+ Novo rascunho desta versão", "ed-new-draft", "", "primary");
    this.main.innerHTML = `<a class="tpl-back" href="#${routeOf(t.id)}">← ${esc(t.name)}</a>
<div class="page-heading tpl-editor-heading"><div><span class="eyebrow">${esc(String(t.system || "").toUpperCase())} · ${this.isDraft ? "EDITOR DE CAMPOS" : "VERSÃO PUBLICADA"}</span><h1>${esc(t.name)} ${status}</h1>
  <p id="ed-save-state" class="tpl-save-state" aria-live="polite">${this.isDraft ? "Tudo salvo." : `Publicada em ${esc(date(v.publishedAt))}. Versões publicadas não mudam.`}</p></div>
  <div class="tpl-heading-actions">${actions}</div></div>
<p id="ed-history-help" class="form-help">Desfazer e Refazer ficam disponíveis quando há alterações na edição atual. Setas movem; Shift redimensiona; Alt usa passo fino; Ctrl+S salva.</p><div class="tpl-toolbar" role="toolbar" aria-label="Ferramentas da ficha">${helpButton("modelos.editor.atalhos", "Atalhos do editor")}
  <div class="tpl-seg" role="group" aria-label="Modo">${button(this.isDraft ? "✎ Desenhar campos" : "◫ Visualizar", "ed-view", "draw", "subtle", 'aria-pressed="true"')}${button("▶ Testar ficha", "ed-view", "test", "subtle", 'aria-pressed="false"')}</div>
  <div class="tpl-zoom" role="group" aria-label="Zoom">${button("−", "ed-zoom", "-1", "subtle tpl-icon", 'aria-label="Diminuir zoom"')}<output id="ed-zoom" aria-live="polite">100%</output>${button("+", "ed-zoom", "1", "subtle tpl-icon", 'aria-label="Aumentar zoom"')}${button("Ajustar", "ed-zoom", "0", "subtle")}</div>
  ${
    this.isDraft
      ? `<label class="tpl-toggle"><input type="checkbox" id="ed-snap"> Encaixar na grade</label>
  ${button("+ Campo", "ed-add-field", "", "subtle")}
  <div class="tpl-pdf" role="group" aria-label="PDF de fundo">${button(this.hasPdf ? "Trocar PDF" : "Enviar PDF", "ed-pdf", "", "subtle")}${this.hasPdf ? button("Remover PDF", "ed-pdf-remove", "", "subtle danger") : ""}<input type="file" id="ed-pdf-file" accept="application/pdf,.pdf" hidden></div>`
      : ""
  }
</div>
<p class="tpl-hint" id="ed-hint">${
      this.isDraft
        ? '<span class="tpl-hint-desktop">Arraste numa área vazia para criar um campo; arraste o campo para mover e as alças para redimensionar. No campo focado: setas movem, Shift+setas redimensionam, Alt dá passo fino, Delete exclui.</span><span class="tpl-hint-touch">Toque num campo para selecioná-lo e edite posição e tamanho no painel. Use “+ Campo” para criar.</span>'
        : "Clique num campo para ver as propriedades. “Testar ficha” mostra como o jogador preenche, com valores de exemplo."
    } ${this.hasPdf ? "" : "Sem PDF: a ficha usa páginas em branco do tamanho indicado."}</p>
<div class="tpl-workbench">
  <div class="tpl-stage" id="ed-stage"></div>
  <aside class="tpl-panel metal" aria-label="Propriedades">
    <div class="tpl-panel-tabs" role="tablist" aria-label="Painel" id="ed-tabs"></div>
    <div class="tpl-panel-body" id="ed-panel" role="tabpanel"></div>
  </aside>
</div>`;
    this.main.onclick = (e) => this.onClick(e);
    this.main.oninput = (e) => this.onInput(e);
    this.main.onchange = (e) => this.onInput(e, true);
    this.main.onkeydown = (e) => this.onPanelKey(e);
    const snap = $("#ed-snap");
    if (snap) snap.onchange = () => this.sheet?.setOptions({ snap: (this.snap = snap.checked) ? 0.005 : 0 });
    const file = $("#ed-pdf-file");
    if (file)
      file.onchange = () => {
        const chosen = file.files[0];
        file.value = "";
        if (chosen) this.uploadPdf(chosen);
      };
    this.mountStage();
    this.renderTabs();
    this.renderPanel();
    this.refreshState();
    this.scheduleIssues(0);
  }
  destroy() {
    this.abort.abort();
    clearTimeout(this.issueTimer);
    clearTimeout(this.backupTimer);
    if (this.dirty) this.writeBackup();
    this.sheet?.destroy();
    this.sheet = null;
  }
  get dirty() {
    return this.isDraft && JSON.stringify(compactDoc(this.doc)) !== this.saved;
  }
  pdfUrl() {
    return this.hasPdf ? `/api/sheet-templates/${this.t.id}/versions/${this.v.id}/pdf?r=${this.pdfToken}` : null;
  }
  mountStage() {
    this.sheet?.destroy();
    const stage = $("#ed-stage");
    const edit = this.isDraft && this.view === "draw";
    this.sheet = renderSheet(stage, {
      pdfUrl: this.pdfUrl(),
      pages: this.doc.pages,
      fields: this.doc.fields,
      mode: edit ? "edit" : this.view === "test" ? "fill" : "view",
      values: this.view === "test" ? this.samples : {},
      snap: this.snap ? 0.005 : 0,
      label: edit ? "Ficha em edição" : "Pré-visualização da ficha",
      invalid: this.invalidNames(),
      onSelect: (index, extra) => this.selectField(index, { activate: extra?.activate, fromStage: true }),
      onCreate: (rect, page) => this.createField(rect, page),
      onDelete: (index) => this.deleteField(index),
      onChange: (a, b) => {
        if (this.view === "test") {
          this.samples[a] = b;
          this.renderTestResults();
        } else this.moveField(a, b);
      },
    });
    if (this.view !== "test" && this.selected >= 0) this.sheet.select(this.selected);
    // Modo visualização reaproveita a seleção para mostrar as propriedades somente leitura.
    if (!edit && this.view !== "test") stage.onclick = (e) => {
      const f = e.target.closest(".ps-field");
      if (f) this.selectField(Number(f.dataset.index), {});
    };
    else stage.onclick = null;
    this.sheet.zoom(this.zoomValue);
    $("#ed-zoom").textContent = Math.round(this.zoomValue * 100) + "%";
  }

  // ----- Alterações com desfazer -----
  commit(key = "") {
    const now = Date.now();
    if (key && key === this.lastKey && now - this.lastAt < 1500) {
      this.lastAt = now;
      return;
    }
    this.undo.push(snapshot(this.doc));
    this.lastKey = key;
    this.lastAt = now;
  }
  changed({ stage = true, panel = false, tabs = true } = {}) {
    if (stage && this.view === "draw") this.sheet?.setFields(this.doc.fields);
    if (panel) this.renderPanel();
    if (tabs) this.renderTabs();
    this.refreshState();
    this.scheduleIssues();
    clearTimeout(this.backupTimer);
    this.backupTimer = setTimeout(() => this.writeBackup(), 600);
  }
  restore(json) {
    const data = JSON.parse(json);
    Object.assign(this.doc, data);
    if (this.selected >= this.doc.fields.length) this.selected = -1;
    this.lastKey = "";
    this.sheet?.setFields(this.doc.fields);
    if (this.selected >= 0) this.sheet?.select(this.selected);
    this.changed({ stage: false, panel: true });
  }
  doUndo() {
    const prev = this.undo.undo(snapshot(this.doc));
    if (prev) this.restore(prev);
  }
  doRedo() {
    const next = this.undo.redo(snapshot(this.doc));
    if (next) this.restore(next);
  }
  refreshState() {
    if (!this.isDraft) return;
    const undo = this.main.querySelector('[data-action="ed-undo"]'),
      redo = this.main.querySelector('[data-action="ed-redo"]');
    if (undo) undo.disabled = !this.undo.canUndo;
    if (redo) redo.disabled = !this.undo.canRedo;
    const stateEl = $("#ed-save-state");
    if (stateEl && !this.saving) {
      stateEl.textContent = this.conflict ? "Conflito: o rascunho mudou em outra sessão. Recarregue para continuar." : this.dirty ? "Alterações não salvas." : "Tudo salvo.";
      stateEl.classList.toggle("is-dirty", this.dirty || !!this.conflict);
    }
  }

  // ----- Campos -----
  selectField(index, { activate = false, fromStage = false } = {}) {
    this.selected = index >= 0 && index < this.doc.fields.length ? index : -1;
    if (!fromStage && this.view !== "test") this.sheet?.select(this.selected, { scroll: this.selected >= 0 });
    if (this.selected >= 0 && this.tab !== "field") {
      this.tab = "field";
      this.renderTabs();
    }
    if (this.view !== "test") this.renderPanel();
    if (activate) $("#ed-prop-label")?.focus();
  }
  createField(rect, page) {
    if (this.doc.fields.length >= LIMITS.fields) return toast(`Use no máximo ${LIMITS.fields} campos.`);
    this.commit();
    const field = { ...newField(rect, page, this.doc.fields, this.doc.pages[page]?.height), origin: null };
    this.doc.fields.push(field);
    this.selected = this.doc.fields.length - 1;
    this.tab = "field";
    this.changed({ panel: true });
    this.sheet?.select(this.selected);
    $("#ed-prop-label")?.focus();
  }
  addField() {
    const page = this.selected >= 0 ? this.doc.fields[this.selected].page : 0;
    const taken = this.doc.fields.filter((f) => f.page === page);
    let y = 0.06;
    while (y < 0.9 && taken.some((f) => f.y < y + 0.045 && f.y + f.h > y && f.x < 0.42 && f.x + f.w > 0.08)) y += 0.05;
    this.createField(normalizeRect({ x: 0.08, y: Math.min(y, 0.9), w: 0.34, h: 0.04 }), page);
  }
  moveField(index, rect) {
    const f = this.doc.fields[index];
    if (!f) return;
    this.commit("move:" + index);
    Object.assign(f, rect);
    this.changed({ stage: false });
    if (index === this.selected) this.syncGeometryInputs();
  }
  deleteField(index) {
    const f = this.doc.fields[index];
    if (!f) return;
    this.commit();
    this.doc.fields.splice(index, 1);
    this.selected = -1;
    this.changed({ panel: true });
    toast(f.origin ? `Campo “${f.label || f.name}” removido. Fichas que migrarem perderão esse valor (Ctrl+Z desfaz).` : `Campo “${f.label || f.name}” removido (Ctrl+Z desfaz).`);
  }
  duplicate(index) {
    const f = this.doc.fields[index];
    if (!f || this.doc.fields.length >= LIMITS.fields) return;
    this.commit();
    this.doc.fields.push({ ...duplicateField(f, this.doc.fields), origin: null });
    this.selected = this.doc.fields.length - 1;
    this.changed({ panel: true });
    this.sheet?.select(this.selected, { scroll: true });
  }

  // ----- Painel -----
  renderTabs() {
    const tabs = $("#ed-tabs");
    if (!tabs) return;
    if (this.view === "test") {
      tabs.innerHTML = `<span class="tpl-panel-title">Teste da ficha</span>`;
      return;
    }
    const count = this.issues.length;
    const items = [
      ["field", "Campo"],
      ["fields", `Campos <small>${this.doc.fields.length}</small>`],
      ["actions", `Ações <small>${this.doc.actions.length}</small>`],
      ["version", `Versão${this.isDraft && count ? ` <small class="tpl-issue-count" aria-label="${count} problemas">⚠ ${count}</small>` : ""}`],
    ];
    tabs.innerHTML = items
      .map(([key, label]) => `<button type="button" role="tab" id="ed-tab-${key}" data-action="ed-tab" data-id="${key}" aria-selected="${this.tab === key}" tabindex="${this.tab === key ? 0 : -1}">${label}</button>`)
      .join("");
    $("#ed-panel").setAttribute("aria-labelledby", "ed-tab-" + this.tab);
  }
  renderPanel() {
    const panel = $("#ed-panel");
    if (!panel) return;
    if (this.view === "test") panel.innerHTML = this.testPanel();
    else if (this.tab === "fields") panel.innerHTML = this.fieldsPanel();
    else if (this.tab === "actions") panel.innerHTML = this.actionsPanel();
    else if (this.tab === "version") panel.innerHTML = this.versionPanel();
    else panel.innerHTML = this.fieldPanel();
    if (this.view === "test") this.renderTestResults();
    if (this.tab === "field") this.refreshFormulaCheck();
  }
  fieldPanel() {
    const f = this.doc.fields[this.selected];
    if (!f)
      return `<div class="tpl-panel-empty"><span aria-hidden="true">▢</span><p>${this.isDraft ? "Selecione um campo na ficha ou na lista “Campos”, ou crie um novo." : "Selecione um campo na ficha ou na lista “Campos”."}</p>${this.isDraft ? button("+ Adicionar campo", "ed-add-field", "", "subtle") : ""}</div>`;
    const ro = this.isDraft ? "" : "disabled";
    const type = typeInfo(f.type);
    const role = roleInfo(f.role);
    const nameError = validateFieldName(f.name, this.doc.fields, this.selected);
    const lost = lostOnRename(f.origin, f.name, this.publishedNames);
    const numeric = f.type === "number" || f.type === "computed";
    const textual = f.type === "text" || f.type === "textarea";
    const pagesOptions = this.doc.pages.map((_, i) => `<option value="${i}" ${f.page === i ? "selected" : ""}>Página ${i + 1}</option>`).join("");
    const num = (v) => (v == null ? "" : String(v));
    const pctv = (v) => String(Math.round(v * 10000) / 100);
    return `<div class="tpl-prop-head"><span class="tpl-type-icon ${type.css}" aria-hidden="true" data-tip="${esc(type.label)}">${esc(type.icon)}</span><div><strong>${esc(f.label || f.name)}</strong><small>@${esc(f.name)} · página ${f.page + 1}</small></div>
  ${this.isDraft ? `<div class="tpl-prop-tools">${button("⧉", "ed-duplicate", "", "subtle tpl-icon", 'aria-label="Duplicar campo" data-tip="Duplicar"')}${button("🗑", "ed-delete", "", "subtle danger tpl-icon", 'aria-label="Excluir campo" data-tip="Excluir (Delete)"')}</div>` : ""}</div>
<form class="tpl-props" id="ed-field-form" autocomplete="off" novalidate>
  <div class="field"><label for="ed-prop-label">Rótulo</label><input id="ed-prop-label" data-prop="label" maxlength="80" value="${esc(f.label)}" placeholder="${esc(f.name)}" ${ro}></div>
  <div class="field"><div class="field-label"><label for="ed-prop-name">Nome nas fórmulas</label>${helpButton("modelos.campo.nome", "Nome nas fórmulas")}</div><div class="tpl-prefixed"><span aria-hidden="true">@</span><input id="ed-prop-name" data-prop="name" maxlength="40" spellcheck="false" value="${esc(f.name)}" aria-describedby="ed-prop-name-msg" aria-invalid="${!!nameError}" ${ro}></div>
    <p class="tpl-msg ${nameError ? "is-error" : lost ? "is-warn" : ""}" id="ed-prop-name-msg" aria-live="polite">${nameError ? esc(nameError) : lost ? esc(`“${f.origin}” existe na versão publicada: ao migrar, as fichas perdem o valor desse campo. Volte ao nome antigo para preservá-lo.`) : "Minúsculas, números e _. É a chave do valor nas fichas."}</p></div>
  <div class="tpl-prop-row">
    <div class="field"><label for="ed-prop-type">Tipo</label><select id="ed-prop-type" data-prop="type" ${ro}>${FIELD_TYPES.map((t) => `<option value="${t.value}" ${t.value === f.type ? "selected" : ""}>${esc(t.icon)} ${t.label}</option>`).join("")}</select></div>
    <div class="field"><div class="field-label"><label for="ed-prop-role">Papel na mesa</label>${helpButton("modelos.campo.papel-na-mesa", "Papel na mesa")}</div><select id="ed-prop-role" data-prop="role" aria-describedby="ed-prop-role-msg" ${ro}><option value="">Nenhum</option>${FIELD_ROLES.map((r) => {
      const owner = this.doc.fields.findIndex((o, i) => i !== this.selected && o.role === r.value);
      return `<option value="${r.value}" ${r.value === f.role ? "selected" : ""}>${r.label}${owner >= 0 ? " (em uso)" : ""}</option>`;
    }).join("")}</select></div>
  </div>
  <p class="tpl-msg ${role && !role.types.includes(f.type) ? "is-error" : ""}" id="ed-prop-role-msg">${role ? esc(role.types.includes(f.type) ? role.help : role.value === "name" ? "O papel Nome exige um campo de texto curto." : role.value === "senses" ? "O papel Sentidos exige um campo de texto." : "Este papel exige um campo de número ou calculado.") : "Papéis ligam o campo à mesa: vida, nível, deslocamento, armadura, nome, luz, visão, percepção, sentidos e alcance de ataque."}</p>
  ${
    f.type === "computed"
      ? `<div class="field tpl-formula-field"><div class="field-label"><label for="ed-prop-formula">Fórmula</label>${helpButton("modelos.campo.formula", "Fórmulas calculadas")}</div><div class="tpl-combo"><input id="ed-prop-formula" data-prop="formula" maxlength="300" spellcheck="false" value="${esc(f.formula || "")}" placeholder="Ex.: floor((@forca - 10) / 2)" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ed-prop-formula-list" aria-describedby="ed-prop-formula-msg" ${ro}><ul class="tpl-suggest" id="ed-prop-formula-list" role="listbox" hidden></ul></div>
    <p class="tpl-msg" id="ed-prop-formula-msg" aria-live="polite"></p></div>`
      : ""
  }
  ${
    numeric
      ? `<div class="tpl-prop-row"><div class="field"><label for="ed-prop-min">Mínimo</label><input id="ed-prop-min" data-prop="min" inputmode="decimal" value="${num(f.min)}" ${ro}></div><div class="field"><label for="ed-prop-max">Máximo</label><input id="ed-prop-max" data-prop="max" inputmode="decimal" value="${num(f.max)}" ${ro}></div></div>`
      : ""
  }
  ${f.type === "number" || textual ? `<div class="field"><label for="ed-prop-default">Valor inicial</label><input id="ed-prop-default" data-prop="default" maxlength="200" ${f.type === "number" ? 'inputmode="decimal"' : ""} value="${esc(f.default ?? "")}" ${ro}></div>` : ""}
  ${textual ? `<div class="field"><label for="ed-prop-maxlength">Limite de caracteres</label><input id="ed-prop-maxlength" data-prop="maxLength" type="number" min="1" max="${f.type === "textarea" ? 10000 : 2000}" value="${num(f.maxLength)}" placeholder="Sem limite próprio" ${ro}></div>` : ""}
  ${f.type === "checkbox" ? `<div class="field"><label for="ed-prop-default">Valor inicial</label><select id="ed-prop-default" data-prop="default" ${ro}><option value="">Desmarcada</option><option value="true" ${f.default === "true" ? "selected" : ""}>Marcada</option></select></div>` : ""}
  ${
    f.type === "select"
      ? `<div class="field"><label for="ed-prop-options">Opções (uma por linha)</label><textarea id="ed-prop-options" data-prop="options" rows="4" maxlength="4500" ${ro}>${esc((f.options || []).join("\n"))}</textarea></div>
  <div class="field"><label for="ed-prop-default">Valor inicial</label><select id="ed-prop-default" data-prop="default" ${ro}><option value="">Nenhum</option>${(f.options || []).map((o) => `<option value="${esc(o)}" ${o === f.default ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`
      : ""
  }
  <fieldset class="tpl-geometry"><legend>Posição e aparência</legend>
    <div class="tpl-prop-row">
      <div class="field"><label for="ed-prop-page">Página</label><select id="ed-prop-page" data-prop="page" ${ro}>${pagesOptions}</select></div>
      <div class="field"><label for="ed-prop-font">Fonte (pt)</label><input id="ed-prop-font" data-prop="fontSize" type="number" min="6" max="32" step="0.5" value="${num(f.fontSize)}" ${ro}></div>
      <div class="field"><label for="ed-prop-align">Alinhamento</label><select id="ed-prop-align" data-prop="align" ${ro}>${ALIGNS.map((a) => `<option value="${a.value}" ${a.value === f.align ? "selected" : ""}>${a.label}</option>`).join("")}</select></div>
    </div>
    <div class="tpl-prop-row tpl-geo-row">
      <div class="field"><label for="ed-prop-x">X (%)</label><input id="ed-prop-x" data-prop="x" type="number" step="0.1" min="0" max="100" value="${pctv(f.x)}" ${ro}></div>
      <div class="field"><label for="ed-prop-y">Y (%)</label><input id="ed-prop-y" data-prop="y" type="number" step="0.1" min="0" max="100" value="${pctv(f.y)}" ${ro}></div>
      <div class="field"><label for="ed-prop-w">Largura (%)</label><input id="ed-prop-w" data-prop="w" type="number" step="0.1" min="0.5" max="100" value="${pctv(f.w)}" ${ro}></div>
      <div class="field"><label for="ed-prop-h">Altura (%)</label><input id="ed-prop-h" data-prop="h" type="number" step="0.1" min="0.5" max="100" value="${pctv(f.h)}" ${ro}></div>
    </div>
  </fieldset>
</form>`;
  }
  syncGeometryInputs() {
    const f = this.doc.fields[this.selected];
    if (!f) return;
    for (const key of ["x", "y", "w", "h"]) {
      const input = $("#ed-prop-" + key);
      if (input && document.activeElement !== input) input.value = String(Math.round(f[key] * 10000) / 100);
    }
  }
  applyProp(prop, input, final) {
    const index = this.selected;
    const f = this.doc.fields[index];
    if (!f || !this.isDraft) return;
    const raw = input.value;
    const number = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(",", ".")));
    let rerender = false;
    this.commit(`${prop}:${index}`);
    switch (prop) {
      case "label": {
        // O nome acompanha o rótulo enquanto ainda for automático (campo_N ou derivado do rótulo) e não existir na versão publicada.
        const autoName = !f.origin && (/^campo_\d+$/.test(f.name) || f.name === nameFromLabel(f.label, this.doc.fields, index));
        f.label = raw;
        if (autoName && raw.trim()) {
          f.name = nameFromLabel(raw, this.doc.fields, index);
          const nameInput = $("#ed-prop-name");
          if (nameInput) nameInput.value = f.name;
        }
        break;
      }
      case "name":
        f.name = raw.trim();
        break;
      case "type":
        f.type = FIELD_TYPES.some((t) => t.value === raw) ? raw : "text";
        if (f.type !== "computed") f.formula = null;
        if (f.type === "computed") f.default = null;
        if (f.type !== "select") f.options = [];
        if (f.type === "checkbox" && !["true", "false"].includes(f.default)) f.default = null;
        if (!["text", "textarea"].includes(f.type)) f.maxLength = null;
        if (!["number", "computed"].includes(f.type)) f.min = f.max = null;
        rerender = true;
        break;
      case "role":
        f.role = raw || null;
        rerender = true;
        break;
      case "formula":
        f.formula = raw;
        break;
      case "default":
        f.default = raw === "" ? null : raw;
        break;
      case "min":
      case "max": {
        const n = number(raw);
        f[prop] = Number.isFinite(n) ? n : null;
        break;
      }
      case "maxLength": {
        const n = number(raw);
        f.maxLength = Number.isInteger(n) && n > 0 ? n : null;
        break;
      }
      case "options":
        f.options = raw
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean)
          .slice(0, LIMITS.options);
        if (f.default != null && !f.options.includes(f.default)) f.default = null;
        if (final) rerender = true;
        break;
      case "page":
        f.page = Math.max(0, Math.min(this.doc.pages.length - 1, Number(raw) || 0));
        break;
      case "fontSize": {
        const n = number(raw);
        if (Number.isFinite(n) && n >= 6 && n <= 32) f.fontSize = n;
        break;
      }
      case "align":
        f.align = ALIGNS.some((a) => a.value === raw) ? raw : "left";
        break;
      case "x":
      case "y":
      case "w":
      case "h": {
        const n = number(raw);
        if (!Number.isFinite(n)) return;
        Object.assign(f, normalizeRect({ ...f, [prop]: n / 100 }));
        if (final) this.syncGeometryInputs();
        break;
      }
      default:
        return;
    }
    this.changed({ panel: rerender });
    if (prop === "name" || prop === "label") this.refreshNameMessage();
    if (prop === "formula") this.refreshFormulaCheck();
    if (rerender) $("#ed-prop-" + (prop === "maxLength" ? "maxlength" : prop))?.focus();
  }
  refreshNameMessage() {
    const f = this.doc.fields[this.selected];
    const msg = $("#ed-prop-name-msg"),
      input = $("#ed-prop-name");
    if (!f || !msg) return;
    const error = validateFieldName(f.name, this.doc.fields, this.selected);
    const lost = lostOnRename(f.origin, f.name, this.publishedNames);
    input.setAttribute("aria-invalid", String(!!error));
    msg.className = "tpl-msg " + (error ? "is-error" : lost ? "is-warn" : "");
    msg.textContent = error || (lost ? `“${f.origin}” existe na versão publicada: ao migrar, as fichas perdem o valor desse campo. Volte ao nome antigo para preservá-lo.` : "Minúsculas, números e _. É a chave do valor nas fichas.");
    const head = this.main.querySelector(".tpl-prop-head div");
    if (head) {
      head.querySelector("strong").textContent = f.label || f.name;
      head.querySelector("small").textContent = `@${f.name} · página ${f.page + 1}`;
    }
  }
  refreshFormulaCheck() {
    const f = this.doc.fields[this.selected];
    const msg = $("#ed-prop-formula-msg");
    if (!f || !msg || f.type !== "computed") return;
    const input = $("#ed-prop-formula");
    const expr = String(f.formula || "").trim();
    if (!expr) {
      msg.className = "tpl-msg";
      msg.textContent = "Use @nome de campos numéricos, + − × ÷, parênteses e floor, ceil, min, max, abs, round, mod, if … then … else.";
      input?.setAttribute("aria-invalid", "false");
      return;
    }
    const names = numericNames(this.doc.fields).filter((n) => n !== f.name);
    const check = validate(expr, "deterministic", names);
    input?.setAttribute("aria-invalid", String(!check.ok));
    if (!check.ok) {
      msg.className = "tpl-msg is-error";
      msg.textContent = check.error + (check.position != null ? ` (posição ${check.position + 1})` : "");
      return;
    }
    const values = computeSheet(compactDoc(this.doc).fields, sampleValues(this.doc.fields));
    msg.className = "tpl-msg is-ok";
    msg.textContent = `✓ Fórmula válida. Com os valores de exemplo: ${values[f.name] || "—"}.`;
  }
  fieldsPanel() {
    if (!this.doc.fields.length)
      return `<div class="tpl-panel-empty"><span aria-hidden="true">▢</span><p>Nenhum campo ainda. ${this.isDraft ? "Arraste sobre a ficha ou use o botão abaixo." : ""}</p>${this.isDraft ? button("+ Adicionar campo", "ed-add-field", "", "subtle") : ""}</div>`;
    const invalid = this.invalidNames();
    const groups = this.doc.pages.map((_, page) => {
      const items = this.doc.fields
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => f.page === page)
        .sort((a, b) => a.f.y - b.f.y || a.f.x - b.f.x);
      if (!items.length) return "";
      return `<h3 class="tpl-list-title">Página ${page + 1}</h3><ul class="tpl-field-list">${items
        .map(({ f, i }) => {
          const type = typeInfo(f.type);
          const role = roleInfo(f.role);
          return `<li><button type="button" data-action="ed-pick" data-id="${i}" class="${i === this.selected ? "is-selected" : ""}" aria-current="${i === this.selected}"><span class="tpl-type-icon ${type.css}" aria-hidden="true" data-tip="${esc(type.label)}">${esc(type.icon)}</span><span class="tpl-field-text"><strong>${esc(f.label || f.name)}</strong><small>@${esc(f.name)} · ${type.label}</small></span>${role ? `<span class="status-chip">${PROP_LABELS[role.value]}</span>` : ""}${invalid.includes(f.name) ? '<span class="tpl-warn" aria-label="com problema" data-tip="Com problema">⚠</span>' : ""}</button></li>`;
        })
        .join("")}</ul>`;
    });
    const orphans = this.doc.fields.map((f, i) => ({ f, i })).filter(({ f }) => f.page >= this.doc.pages.length);
    return (
      groups.join("") +
      (orphans.length
        ? `<h3 class="tpl-list-title">Fora das páginas</h3><ul class="tpl-field-list">${orphans
            .map(({ f, i }) => `<li><button type="button" data-action="ed-pick" data-id="${i}"><span class="tpl-warn" aria-hidden="true">⚠</span><span class="tpl-field-text"><strong>${esc(f.label || f.name)}</strong><small>Página ${f.page + 1} não existe mais. Mude a página no painel.</small></span></button></li>`)
            .join("")}</ul>`
        : "") +
      (this.isDraft ? `<div class="tpl-panel-foot">${button("+ Adicionar campo", "ed-add-field", "", "subtle")}</div>` : "")
    );
  }
  actionsPanel() {
    const ro = this.isDraft ? "" : "disabled";
    const intro = `<p class="tpl-help">Golpes, magias e habilidades prontos na ficha. Fórmulas de rolagem aceitam dados (1d20, 2d6kh1) e @campos numéricos. O jogador pode criar outros.</p>`;
    if (!this.doc.actions.length)
      return intro + `<div class="tpl-panel-empty"><span aria-hidden="true">⚔</span><p>Nenhuma ação predefinida.</p>${this.isDraft ? button("+ Adicionar ação", "ed-action-add", "", "subtle") : ""}</div>`;
    return (
      intro +
      this.doc.actions
        .map((a, i) => {
          const kind = kindInfo(a.kind);
          const keyError = validateActionKey(a.key, this.doc.actions, i);
          return `<fieldset class="tpl-action" data-action-index="${i}"><legend><span aria-hidden="true">${esc(kind.icon)}</span> ${esc(a.name || "Nova ação")}</legend>
  <div class="tpl-prop-row"><div class="field"><label for="ed-act-name-${i}">Nome</label><input id="ed-act-name-${i}" data-act="name" data-index="${i}" maxlength="60" value="${esc(a.name)}" ${ro}></div>
  <div class="field"><label for="ed-act-kind-${i}">Tipo</label><select id="ed-act-kind-${i}" data-act="kind" data-index="${i}" ${ro}>${ACTION_KINDS.map((k) => `<option value="${k.value}" ${k.value === a.kind ? "selected" : ""}>${esc(k.icon)} ${k.label}</option>`).join("")}</select></div></div>
  <div class="field"><div class="field-label"><label for="ed-act-key-${i}">Chave</label>${helpButton("modelos.acoes.chave", "Chave da ação")}</div><input id="ed-act-key-${i}" data-act="key" data-index="${i}" maxlength="40" spellcheck="false" value="${esc(a.key)}" aria-invalid="${!!keyError}" aria-describedby="ed-act-key-msg-${i}" ${ro}><p class="tpl-msg ${keyError ? "is-error" : ""}" id="ed-act-key-msg-${i}">${esc(keyError || "Identifica a ação no histórico e nas migrações.")}</p></div>
  <div class="field tpl-formula-field"><label for="ed-act-formula-${i}">Rolagem</label><div class="tpl-combo"><input id="ed-act-formula-${i}" data-act="formula" data-index="${i}" maxlength="300" spellcheck="false" value="${esc(a.formula)}" placeholder="Ex.: 1d20 + @forca_mod" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ed-act-formula-${i}-list" aria-describedby="ed-act-formula-msg-${i}" ${ro}><ul class="tpl-suggest" id="ed-act-formula-${i}-list" role="listbox" hidden></ul></div>
    <p class="tpl-msg" id="ed-act-formula-msg-${i}" aria-live="polite">${esc(this.actionCheck(a).text)}</p></div>
  <div class="field"><label for="ed-act-desc-${i}">Descrição</label><input id="ed-act-desc-${i}" data-act="description" data-index="${i}" maxlength="300" value="${esc(a.description)}" ${ro}></div>
  <div class="tpl-action-tools">${button("🎲 Testar rolagem", "ed-action-roll", i, "subtle small")}${this.isDraft ? button("Remover", "ed-action-remove", i, "subtle small danger") : ""}<output class="tpl-roll" id="ed-act-roll-${i}" aria-live="polite"></output></div>
</fieldset>`;
        })
        .join("") +
      (this.isDraft ? `<div class="tpl-panel-foot">${button("+ Adicionar ação", "ed-action-add", "", "subtle")}</div>` : "")
    );
  }
  actionCheck(a) {
    if (!String(a.formula || "").trim()) return { ok: false, text: "Informe a rolagem (ex.: 1d20 + @forca_mod)." };
    const check = validate(a.formula, "roll", numericNames(this.doc.fields));
    return check.ok ? { ok: true, text: "✓ Rolagem válida." } : { ok: false, text: check.error };
  }
  applyAction(prop, input) {
    const i = Number(input.dataset.index);
    const a = this.doc.actions[i];
    if (!a || !this.isDraft) return;
    this.commit(`act-${prop}:${i}`);
    const value = input.value;
    if (prop === "name") {
      const auto = /^acao_\d+$/.test(a.key) || a.key === nameFromLabel(a.name, this.doc.actions, i, "key");
      a.name = value;
      if (auto && value.trim()) {
        a.key = nameFromLabel(value, this.doc.actions, i, "key");
        const keyInput = $("#ed-act-key-" + i);
        if (keyInput) keyInput.value = a.key;
      }
      const legend = input.closest("fieldset")?.querySelector("legend");
      if (legend) legend.lastChild.textContent = " " + (value || "Nova ação");
    } else if (prop === "kind") a.kind = ACTION_KINDS.some((k) => k.value === value) ? value : "ataque";
    else if (prop === "key") a.key = value.trim();
    else if (prop === "formula") a.formula = value;
    else if (prop === "description") a.description = value;
    const keyError = validateActionKey(a.key, this.doc.actions, i);
    const keyMsg = $("#ed-act-key-msg-" + i);
    if (keyMsg) {
      keyMsg.className = "tpl-msg " + (keyError ? "is-error" : "");
      keyMsg.textContent = keyError || "Identifica a ação no histórico e nas migrações.";
      $("#ed-act-key-" + i)?.setAttribute("aria-invalid", String(!!keyError));
    }
    const check = this.actionCheck(a);
    const msg = $("#ed-act-formula-msg-" + i);
    if (msg) {
      msg.className = "tpl-msg " + (check.ok ? "is-ok" : a.formula ? "is-error" : "");
      msg.textContent = check.text;
    }
    this.changed({ stage: false });
  }
  rollAction(i) {
    const a = this.doc.actions[i];
    const out = $("#ed-act-roll-" + i);
    if (!a || !out) return;
    try {
      const fields = compactDoc(this.doc).fields;
      const result = rollPreview(a.formula, sheetScope(fields, computeSheet(fields, this.view === "test" ? this.samples : sampleValues(this.doc.fields))));
      out.textContent = result.breakdown;
      out.classList.remove("is-error");
    } catch (error) {
      out.textContent = error?.message || "Rolagem inválida.";
      out.classList.add("is-error");
    }
  }
  versionPanel() {
    const ro = this.isDraft ? "" : "disabled";
    const pages = this.doc.pages.length;
    const pageInfo = this.hasPdf
      ? `<p>${plural(pages, "página", "páginas")} do PDF de fundo.</p>`
      : `<p>${plural(pages, "página em branco", "páginas em branco")} (${Math.round(this.doc.pages[0].width)} × ${Math.round(this.doc.pages[0].height)} pt).</p>${
          this.isDraft ? `<div class="tpl-inline-actions">${button("+ Página", "ed-page-add", "", "subtle small", pages >= LIMITS.pages ? "disabled" : "")}${button("Remover última página", "ed-page-remove", "", "subtle small", pages <= 1 ? "disabled" : "")}</div>` : ""
        }`;
    const issues = this.isDraft
      ? this.issues.length
        ? `<ul class="tpl-issues">${this.issues
            .slice(0, 60)
            .map((issue) => {
              const fieldIndex = issue.index ?? (issue.field ? this.doc.fields.findIndex((f) => f.name === issue.field) : -1);
              const target = fieldIndex >= 0 ? button("Mostrar", "ed-pick", fieldIndex, "text-button") : issue.actionIndex >= 0 ? button("Mostrar", "ed-pick-action", issue.actionIndex, "text-button") : "";
              return `<li><span aria-hidden="true">⚠</span><span>${esc(issue.message)}</span>${target}</li>`;
            })
            .join("")}</ul>${this.issues.length > 60 ? `<p class="tpl-help">E mais ${this.issues.length - 60}.</p>` : ""}`
        : '<p class="tpl-msg is-ok">✓ Nenhum problema encontrado. Pronto para publicar.</p>'
      : "";
    return `${this.isDraft ? `<section class="tpl-block"><h3>Para publicar</h3>${issues}</section>` : ""}
<section class="tpl-block"><h3>${this.published ? `Mudanças desde a v${Number(this.published.number)} publicada` : this.isDraft ? "Primeira versão" : "Sobre esta versão"}</h3>${this.published ? this.diffHtml() : this.isDraft ? "<p>Ainda não há versão publicada: tudo será novo.</p>" : `<p>${plural(this.doc.fields.length, "campo", "campos")}, ${plural(this.doc.actions.length, "ação", "ações")}.</p>`}</section>
<section class="tpl-block"><h3>Páginas</h3>${pageInfo}</section>
<section class="tpl-block"><div class="field"><label for="ed-notes">Notas da versão</label><textarea id="ed-notes" data-doc="notes" rows="3" maxlength="${LIMITS.notes}" placeholder="O que mudou nesta versão (visível para a equipe)." ${ro}>${esc(this.doc.notes)}</textarea></div></section>`;
  }
  diffHtml() {
    const d = diffVersions(this.published, compactDoc(this.doc));
    if (diffIsEmpty(d)) return "<p>Nenhuma mudança de campos ou ações.</p>";
    const names = (list) => list.map((n) => `<code>@${esc(n)}</code>`).join(", ");
    const rows = [
      d.added.length ? `<li class="is-good"><strong>${plural(d.added.length, "campo novo", "campos novos")}:</strong> ${names(d.added)}</li>` : "",
      d.removed.length ? `<li class="is-bad"><strong>${plural(d.removed.length, "campo removido", "campos removidos")}:</strong> ${names(d.removed)} <small>— fichas que migrarem perdem esses valores.</small></li>` : "",
      d.changed.length ? `<li><strong>${plural(d.changed.length, "campo alterado", "campos alterados")}:</strong> ${d.changed.map((c) => `<code>@${esc(c.name)}</code> (${c.changes.map((k) => CHANGE_LABELS[k] || k).join(", ")})`).join("; ")}</li>` : "",
      d.moved.length ? `<li><strong>${plural(d.moved.length, "campo reposicionado", "campos reposicionados")}</strong> (só posição ou aparência).</li>` : "",
      d.actionsAdded.length ? `<li class="is-good"><strong>Ações novas:</strong> ${esc(d.actionsAdded.join(", "))}</li>` : "",
      d.actionsRemoved.length ? `<li class="is-bad"><strong>Ações removidas:</strong> ${esc(d.actionsRemoved.join(", "))}</li>` : "",
      d.actionsChanged.length ? `<li><strong>Ações alteradas:</strong> ${esc(d.actionsChanged.join(", "))}</li>` : "",
    ];
    return `<ul class="tpl-diff">${rows.join("")}</ul>`;
  }
  testPanel() {
    return `<p class="tpl-help">Assim o jogador preenche a ficha. Os valores abaixo são de exemplo e não são gravados; campos calculados se atualizam ao digitar.</p>
<div class="tpl-inline-actions">${button("↺ Restaurar exemplos", "ed-samples", "", "subtle small")}${button("Limpar valores", "ed-samples-clear", "", "subtle small")}</div>
<section class="tpl-block"><h3>Calculados</h3><dl class="tpl-computed" id="ed-test-computed"></dl></section>
<section class="tpl-block"><h3>Ações</h3>${
      this.doc.actions.length
        ? `<ul class="tpl-test-actions">${this.doc.actions
            .map((a, i) => `<li><span><strong>${esc(kindInfo(a.kind).icon)} ${esc(a.name || a.key)}</strong><small>${esc(a.formula || "—")}</small></span>${button("🎲 Rolar", "ed-action-roll", i, "subtle small")}<output class="tpl-roll" id="ed-act-roll-${i}" aria-live="polite"></output></li>`)
            .join("")}</ul>`
        : "<p>Nenhuma ação predefinida.</p>"
    }</section>`;
  }
  renderTestResults() {
    const box = $("#ed-test-computed");
    if (!box) return;
    const fields = compactDoc(this.doc).fields;
    const values = computeSheet(fields, this.samples);
    const computed = this.doc.fields.filter((f) => f.type === "computed");
    box.innerHTML = computed.length
      ? computed.map((f) => `<div><dt>${esc(f.label || f.name)}</dt><dd>${esc(values[f.name] || "—")}</dd></div>`).join("")
      : "<div><dt>Nenhum campo calculado.</dt></div>";
  }
  invalidNames() {
    return [...new Set(this.issues.map((i) => i.field || this.doc.fields[i.index]?.name).filter(Boolean))];
  }
  scheduleIssues(delay = 350) {
    if (!this.isDraft) return;
    clearTimeout(this.issueTimer);
    this.issueTimer = setTimeout(() => {
      this.issues = collectIssues(this.doc);
      this.sheet?.setOptions({ invalid: this.view === "draw" ? this.invalidNames() : [] });
      this.renderTabs();
      if (this.tab === "version" && this.view !== "test" && !this.main.querySelector("#ed-panel")?.contains(document.activeElement)) this.renderPanel();
    }, delay);
  }

  // ----- Eventos -----
  onClick(e) {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    switch (b.dataset.action) {
      case "ed-undo":
        return this.doUndo();
      case "ed-redo":
        return this.doRedo();
      case "ed-save":
        return this.save();
      case "ed-publish":
        return this.openPublish();
      case "ed-new-draft":
        return createDraft(this.t, this.v.id);
      case "ed-view":
        return this.setView(id === "test" ? "test" : "draw");
      case "ed-zoom":
        this.zoomValue = id === "0" ? 1 : clampZoom(this.zoomValue + Number(id) * 0.25);
        this.sheet?.zoom(this.zoomValue);
        $("#ed-zoom").textContent = Math.round(this.zoomValue * 100) + "%";
        return;
      case "ed-add-field":
        return this.isDraft && this.addField();
      case "ed-pdf":
        return $("#ed-pdf-file")?.click();
      case "ed-pdf-remove":
        return this.removePdf();
      case "ed-tab":
        this.tab = ["field", "fields", "actions", "version"].includes(id) ? id : "field";
        this.renderTabs();
        this.renderPanel();
        $("#ed-tab-" + this.tab)?.focus();
        return;
      case "ed-pick":
        return this.selectField(Number(id), {});
      case "ed-pick-action":
        this.tab = "actions";
        this.renderTabs();
        this.renderPanel();
        $("#ed-act-name-" + Number(id))?.focus();
        return;
      case "ed-duplicate":
        return this.duplicate(this.selected);
      case "ed-delete":
        return this.deleteField(this.selected);
      case "ed-action-add": {
        if (this.doc.actions.length >= LIMITS.actions) return toast(`Use no máximo ${LIMITS.actions} ações.`);
        this.commit();
        this.doc.actions.push({ key: suggestName(this.doc.actions, "acao", "key"), name: "", kind: "ataque", formula: "1d20", description: "" });
        this.changed({ stage: false, panel: true });
        $("#ed-act-name-" + (this.doc.actions.length - 1))?.focus();
        return;
      }
      case "ed-action-remove":
        this.commit();
        this.doc.actions.splice(Number(id), 1);
        this.changed({ stage: false, panel: true });
        return;
      case "ed-action-roll":
        return this.rollAction(Number(id));
      case "ed-page-add":
        this.commit();
        this.doc.pages.push({ ...this.doc.pages[this.doc.pages.length - 1] });
        this.changed({ stage: false, panel: true });
        return this.mountStage();
      case "ed-page-remove": {
        const last = this.doc.pages.length - 1;
        if (this.doc.fields.some((f) => f.page === last)) return toast(`Mova ou exclua os campos da página ${last + 1} antes de removê-la.`);
        this.commit();
        this.doc.pages.pop();
        this.changed({ stage: false, panel: true });
        return this.mountStage();
      }
      case "ed-samples":
        this.samples = sampleValues(this.doc.fields);
        this.sheet?.setValues(this.samples);
        return this.renderTestResults();
      case "ed-samples-clear":
        this.samples = {};
        this.sheet?.setValues(this.samples);
        return this.renderTestResults();
      case "ed-suggest":
        return;
    }
  }
  onInput(e, final = false) {
    const target = e.target;
    if (target.dataset.prop) {
      this.applyProp(target.dataset.prop, target, final);
      if (target.getAttribute("role") === "combobox") this.suggest(target);
    } else if (target.dataset.act) {
      this.applyAction(target.dataset.act, target);
      if (target.getAttribute("role") === "combobox") this.suggest(target);
    } else if (target.dataset.doc === "notes" && this.isDraft) {
      this.commit("notes");
      this.doc.notes = target.value;
      this.changed({ stage: false, tabs: false });
    }
  }
  // Autocompletar @campos nas fórmulas (combobox acessível).
  suggest(input) {
    const list = document.getElementById(input.getAttribute("aria-controls"));
    if (!list) return;
    const own = input.dataset.prop === "formula" ? this.doc.fields[this.selected]?.name : null;
    const names = numericNames(this.doc.fields).filter((n) => n !== own && /^[a-z][a-z0-9_]{0,39}$/.test(n));
    const s = referenceSuggestions(input.value, input.selectionStart ?? input.value.length, names);
    this.suggestion = { input, start: s.start, items: s.items, active: 0 };
    if (s.start < 0 || !s.items.length) return this.closeSuggest(input);
    list.innerHTML = s.items
      .map((name, i) => {
        const f = this.doc.fields.find((x) => x.name === name);
        return `<li role="option" id="${esc(list.id)}-${i}" data-name="${esc(name)}" aria-selected="${i === 0}">@${esc(name)}<small>${esc(f?.label || "")}</small></li>`;
      })
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", list.id + "-0");
    list.onmousedown = (ev) => {
      const li = ev.target.closest("li[data-name]");
      if (!li) return;
      ev.preventDefault();
      this.pickSuggestion(input, li.dataset.name);
    };
  }
  closeSuggest(input) {
    const list = document.getElementById(input.getAttribute("aria-controls"));
    if (list) {
      list.hidden = true;
      list.innerHTML = "";
    }
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    this.suggestion = null;
  }
  pickSuggestion(input, name) {
    const s = this.suggestion;
    if (!s) return;
    const caret = input.selectionStart ?? input.value.length;
    const result = applySuggestion(input.value, s.start, caret, name);
    input.value = result.text;
    input.setSelectionRange(result.caret, result.caret);
    this.closeSuggest(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    this.closeSuggest(input);
  }
  onPanelKey(e) {
    const input = e.target;
    if (input.getAttribute?.("role") === "combobox" && this.suggestion?.input === input) {
      const s = this.suggestion;
      const list = document.getElementById(input.getAttribute("aria-controls"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        s.active = (s.active + (e.key === "ArrowDown" ? 1 : -1) + s.items.length) % s.items.length;
        list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === s.active)));
        input.setAttribute("aria-activedescendant", `${list.id}-${s.active}`);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.pickSuggestion(input, s.items[s.active]);
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        this.closeSuggest(input);
        return;
      }
    }
    if (input.getAttribute?.("role") === "tab" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const keys = ["field", "fields", "actions", "version"];
      const next = keys[(keys.indexOf(this.tab) + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
      e.preventDefault();
      this.tab = next;
      this.renderTabs();
      this.renderPanel();
      $("#ed-tab-" + next)?.focus();
    }
    if (e.key === "Enter" && input.tagName === "INPUT" && input.closest(".tpl-panel")) e.preventDefault();
  }
  onShortcut(e) {
    if (!this.isDraft || $("#modal")?.open) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      this.save();
      return;
    }
    const typing = e.target.closest?.("input, textarea, select");
    if (typing) return; // desfazer nativo do campo de texto
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.doUndo();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      this.doRedo();
    }
  }
  setView(view) {
    if (this.view === view) return;
    this.view = view;
    this.main.querySelectorAll('[data-action="ed-view"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === view)));
    this.main.classList.toggle("tpl-testing", view === "test");
    if (view === "test") this.samples = { ...sampleValues(this.doc.fields), ...this.samples };
    this.mountStage();
    this.renderTabs();
    this.renderPanel();
  }

  // ----- Persistência -----
  writeBackup() {
    if (!this.isDraft) return;
    try {
      if (this.dirty) sessionStorage.setItem(backupKey(this.v.id), JSON.stringify({ revision: this.revision, doc: compactDoc(this.doc) }));
      else sessionStorage.removeItem(backupKey(this.v.id));
    } catch {
      /* armazenamento cheio ou bloqueado: segue sem cópia local */
    }
  }
  offerBackup() {
    if (!this.isDraft) return;
    let backup = null;
    try {
      backup = JSON.parse(sessionStorage.getItem(backupKey(this.v.id)) || "null");
    } catch {
      backup = null;
    }
    if (!backup?.doc || JSON.stringify(backup.doc) === this.saved) return;
    const same = backup.revision === this.revision;
    modal(
      "Alterações não salvas",
      `<p>Encontramos alterações deste rascunho que não foram salvas nesta aba${same ? "" : ", feitas sobre uma revisão anterior (o rascunho mudou depois disso)"}.</p><div class="form-actions">${button("Descartar", "tpl-backup-drop", "", "subtle")}${button("Recuperar alterações", "tpl-backup-use", "", "primary")}</div>`,
    );
    const body = $("#modal-body");
    body.querySelector('[data-action="tpl-backup-drop"]').onclick = () => {
      sessionStorage.removeItem(backupKey(this.v.id));
      $("#modal").close();
    };
    body.querySelector('[data-action="tpl-backup-use"]').onclick = () => {
      $("#modal").close();
      this.commit();
      const doc = backup.doc;
      this.doc.pages = this.hasPdf ? this.doc.pages : (doc.pages || this.doc.pages).map((p) => ({ width: p.width, height: p.height }));
      this.doc.fields = (doc.fields || []).map((f) => ({ ...normalizeField(f), origin: this.publishedNames.includes(f.name) ? f.name : null }));
      this.doc.actions = (doc.actions || []).map((a) => ({ key: a.key || "", name: a.name || "", kind: a.kind || "ataque", formula: a.formula || "", description: a.description || "" }));
      this.doc.notes = doc.notes || "";
      this.selected = -1;
      this.mountStage();
      this.changed({ stage: false, panel: true });
      toast("Alterações recuperadas. Salve para gravá-las.");
    };
  }
  async save({ quiet = false } = {}) {
    if (!this.isDraft || this.saving) return false;
    if (this.conflict) {
      this.showConflict();
      return false;
    }
    if (!this.dirty) {
      if (!quiet) toast("Nada para salvar.");
      return true;
    }
    const structural = structuralIssues(this.doc);
    if (structural.length) {
      this.issues = collectIssues(this.doc);
      this.tab = "version";
      this.renderTabs();
      this.renderPanel();
      toast("Corrija antes de salvar: " + structural[0].message);
      return false;
    }
    this.saving = true;
    const stateEl = $("#ed-save-state");
    if (stateEl) stateEl.textContent = "Salvando…";
    const body = compactDoc(this.doc);
    try {
      const result = await api(`/sheet-templates/${this.t.id}/versions/${this.v.id}`, "PUT", { ...body, revision: this.revision });
      this.revision = result.revision;
      this.saved = JSON.stringify(body);
      sessionStorage.removeItem(backupKey(this.v.id));
      if (!quiet) toast("Rascunho salvo.");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        this.conflict = true;
        this.showConflict();
      } else {
        if (error instanceof ApiError && error.status === 400) {
          this.issues = [...collectIssues(this.doc), ...error.errors.map(issue => ({
            field: issue.field, index: this.doc.fields.findIndex(f => f.name === issue.field),
            action: issue.action, actionIndex: this.doc.actions.findIndex(a => a.key === issue.action),
            message: String(issue.message || "Campo inválido."),
          }))];
          this.tab = "version";
          this.renderTabs();
          this.renderPanel();
        }
        toast(error.message);
      }
      return false;
    } finally {
      this.saving = false;
      this.writeBackup();
      this.refreshState();
    }
  }
  showConflict() {
    this.writeBackup();
    modal(
      "O rascunho mudou em outra sessão",
      `<p>Alguém (ou outra aba) salvou este rascunho depois que você o abriu. Para não sobrescrever o trabalho de ninguém, suas alterações não foram gravadas.</p><p class="tpl-help">Ao recarregar, você poderá recuperar suas alterações locais e reaplicá-las sobre a versão mais nova.</p><div class="form-actions">${button("Continuar olhando", "modal-close", "", "subtle")}${button("Recarregar rascunho", "tpl-conflict-reload", "", "primary")}</div>`,
    );
    $("#modal-body").querySelector('[data-action="tpl-conflict-reload"]').onclick = () => {
      $("#modal").close();
      this.writeBackup();
      navigate(routeOf(this.t.id, "versions", this.v.id));
    };
  }
  async uploadPdf(file) {
    const problem = precheckPdf(file);
    if (problem) return toast(problem);
    if (this.dirty && !(await this.save({ quiet: true }))) return;
    let pages;
    const finishStatus = (text) => {
      const el = $("#ed-save-state");
      if (el) el.textContent = text;
    };
    finishStatus("Lendo o PDF…");
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await import("/vendor/pdfjs/pdf.min.js");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false, enableScripting: false, enableXfa: false, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/" }).promise;
      try {
        if (doc.numPages > LIMITS.pages) throw new Error(`O PDF tem ${doc.numPages} páginas; o limite é ${LIMITS.pages}.`);
        pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const viewport = (await doc.getPage(i)).getViewport({ scale: 1 });
          pages.push({ width: Math.round(viewport.width * 100) / 100, height: Math.round(viewport.height * 100) / 100 });
        }
      } finally {
        doc.destroy();
      }
    } catch (error) {
      this.refreshState();
      return toast(error?.name === "PasswordException" ? "O PDF é protegido por senha. Exporte uma versão sem senha." : error?.message?.startsWith("O PDF tem") ? error.message : "Não foi possível ler este arquivo como PDF.");
    }
    const form = new FormData();
    form.append("pages", JSON.stringify(pages));
    form.append("revision", String(this.revision));
    form.append("pdf", file, file.name);
    try {
      finishStatus("Enviando o PDF…");
      const result = await api(`/sheet-templates/${this.t.id}/versions/${this.v.id}/pdf`, "PUT", form);
      this.applyServerPages(result, true);
      const outside = this.doc.fields.filter((f) => f.page >= this.doc.pages.length).length;
      toast(`PDF enviado (${plural(this.doc.pages.length, "página", "páginas")}).${outside ? ` ${plural(outside, "campo ficou", "campos ficaram")} fora das páginas: veja a lista “Campos”.` : ""}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        this.conflict = true;
        this.showConflict();
      } else toast(pdfUploadError(error));
    } finally {
      this.refreshState();
    }
  }
  applyServerPages(result, hasPdf) {
    // O servidor trocou páginas e revisão: o histórico local de desfazer deixa de valer.
    this.revision = result.revision;
    this.hasPdf = hasPdf;
    this.doc.pages = (result.pages || []).map((p) => ({ width: p.width, height: p.height }));
    const saved = JSON.parse(this.saved);
    saved.pages = this.doc.pages.map((p) => ({ width: p.width, height: p.height }));
    this.saved = JSON.stringify(saved);
    this.undo.clear();
    this.pdfToken++;
    this.render();
  }
  removePdf() {
    modal(
      "Remover o PDF de fundo",
      `<p>Os campos continuam no lugar, sobre páginas em branco do mesmo tamanho. Você pode enviar outro PDF depois.</p><div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${button("Remover PDF", "tpl-confirm-pdf-remove", "", "danger")}</div>`,
    );
    $("#modal-body").querySelector('[data-action="tpl-confirm-pdf-remove"]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      $("#modal").close();
      if (this.dirty && !(await this.save({ quiet: true }))) return;
      try {
        const result = await api(`/sheet-templates/${this.t.id}/versions/${this.v.id}/pdf`, "DELETE");
        this.applyServerPages(result, false);
        toast("PDF removido.");
      } catch (error) {
        toast(error.message);
      }
    };
  }
  async openPublish() {
    if (!(await this.save({ quiet: true }))) return;
    const issues = collectIssues(this.doc);
    this.issues = issues;
    this.renderTabs();
    if (issues.length) {
      modal(
        "Ainda não dá para publicar",
        `<p>${plural(issues.length, "problema impede", "problemas impedem")} a publicação:</p><ul class="tpl-issues">${issues
          .slice(0, 12)
          .map((i) => `<li><span aria-hidden="true">⚠</span><span>${esc(i.message)}</span></li>`)
          .join("")}</ul>${issues.length > 12 ? `<p class="tpl-help">E mais ${issues.length - 12}. Veja a aba “Versão”.</p>` : ""}<div class="form-actions">${button("Ver na aba Versão", "tpl-show-issues", "", "primary")}</div>`,
      );
      $("#modal-body").querySelector('[data-action="tpl-show-issues"]').onclick = () => {
        $("#modal").close();
        this.tab = "version";
        if (this.view === "test") this.setView("draw");
        this.renderTabs();
        this.renderPanel();
      };
      return;
    }
    const counts = `${plural(this.doc.fields.length, "campo", "campos")}, ${plural(this.doc.actions.length, "ação", "ações")}, ${plural(this.doc.pages.length, "página", "páginas")}${this.hasPdf ? " com PDF" : " em branco"}`;
    modal(
      "Publicar versão",
      `<p>Depois de publicada, a versão não pode ser alterada. Novas fichas passam a usá-la; fichas existentes migram quando o dono quiser. A publicação fica registrada na auditoria.</p>
<p class="tpl-help">${esc(counts)}.</p>
<h3 class="tpl-modal-sub">${this.published ? `Mudanças em relação à v${Number(this.published.number)}` : "Primeira versão publicada deste modelo"}</h3>${this.published ? this.diffHtml() : "<p>Tudo é novo.</p>"}
<p class="form-error" id="tpl-publish-error" role="alert"></p>
<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${button("Publicar agora", "tpl-confirm-publish", "", "primary")}</div>`,
    );
    $("#modal-body").querySelector('[data-action="tpl-confirm-publish"]').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const result = await api(`/sheet-templates/${this.t.id}/versions/${this.v.id}/publish`, "POST", { revision: this.revision });
        sessionStorage.removeItem(backupKey(this.v.id));
        this.saved = JSON.stringify(compactDoc(this.doc));
        $("#modal").close();
        toast(`Versão v${Number(result.number)} publicada.`);
        navigate(routeOf(this.t.id));
      } catch (error) {
        b.disabled = false;
        $("#tpl-publish-error").textContent =
          error instanceof ApiError && error.status === 409 ? "O rascunho mudou em outra sessão. Feche e recarregue a página." : error.message;
      }
    };
  }
}
