import { helpButton } from "./help.js";
// Biblioteca geral (#library e #library/<id>): grade de materiais, filtros, visualizador (imagem / pdf.js) e gestão da equipe.
// Leitura para contas verificadas; escrita para admin/embaixador (publica direto, auditado); restaurar/reverter só admin.
// O servidor reaplica papel e verificação em todas as rotas: os botões aqui são apenas UX.
import { api, ApiError } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { $, esc, button, field, formError, modal, toast, empty, formatDate } from "./ui.js";
import { isStaff, isAdmin } from "./policy.js";
import { isGuid } from "./session-policy.js";
import { highlightIn } from "./data-table.js";

export const CATEGORIES = Object.freeze({
  rules: ["Regras", "▤"],
  adventure: ["Aventuras", "⚔"],
  map: ["Mapas", "◈"],
  sheet: ["Fichas", "✎"],
  art: ["Arte", "✦"],
  other: ["Outros", "❖"],
});
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_BYTES = 25 * 1024 * 1024;
const PAGE_SIZE = 20;
const ACTIONS = {
  "library.upload": "Publicação",
  "library.update": "Edição de dados",
  "library.file.replace": "Arquivo substituído",
  "library.delete": "Exclusão",
  "library.restore": "Restauração",
  "library.revert": "Reversão",
};

const filters = { q: "", systemId: "", category: "", type: "" };
let page = 1,
  showDeleted = false,
  generation = 0,
  items = [],
  systems = [],
  viewer = null;

// ---------- Regras puras (exportadas para testes) ----------
export const kindOf = (contentType) =>
  contentType === "application/pdf" ? "pdf" : IMAGE_TYPES.includes(contentType) ? "image" : "file";
export const categoryLabel = (category) => (CATEGORIES[category] || CATEGORIES.other)[0];
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}
/** Mensagem clara para falhas de envio (o servidor já devolve texto pt-BR; aqui reforçamos o próximo passo). */
export function uploadError(error) {
  if (!(error instanceof ApiError))
    return "A conexão caiu durante o envio. Confira o tamanho do arquivo (até 25 MB) e tente novamente.";
  if (error.status === 413) return "O arquivo excede o limite de 25 MB. Reduza ou divida o arquivo antes de enviar.";
  if (error.status === 415)
    return "Formato não aceito. Envie PDF, PNG, JPEG ou WebP — o tipo é conferido pelo conteúdo do arquivo, não pela extensão.";
  if (error.status === 503)
    return "A verificação de segurança de arquivos está indisponível no momento. Nada foi publicado; tente novamente mais tarde.";
  if (error.status === 429) return "Muitos envios em pouco tempo. Aguarde alguns minutos antes de enviar outro arquivo.";
  if (error.status === 409) return "O material mudou em outra sessão. Feche, atualize a lista e tente novamente.";
  return error.message;
}
/** Conferência local antes do envio (UX). O servidor confere assinatura, tamanho real e antivírus. */
export function precheckFile(file) {
  if (!file || !file.size) return "Escolha um arquivo.";
  if (file.size > MAX_BYTES) return `O arquivo tem ${formatBytes(file.size)} e excede o limite de 25 MB.`;
  if (file.type && !["application/pdf", ...IMAGE_TYPES].includes(file.type))
    return "Formato não aceito. Envie PDF, PNG, JPEG ou WebP.";
  return "";
}
const fileUrl = (id, inline) => `/api/library/${id}/file${inline ? "?inline=1" : ""}`;
const dateOnly = (value) =>
  new Date(String(value).endsWith("Z") ? value : value + "Z").toLocaleDateString("pt-BR", { dateStyle: "medium" });

// ---------- Tela ----------
export async function renderLibrary(segments = []) {
  if (segments[0] === "general") { filters.systemId = "none"; page = 1; }
  if (segments[0] === "system" && isGuid(segments[1])) { filters.systemId = segments[1]; page = 1; }
  shell("library");
  const staff = isStaff(state.user);
  const main = $("#main");
  main.innerHTML = `<div class="page-heading"><div><span class="eyebrow">SABER GUARDADO PELA GUILDA</span><h1>Biblioteca ${helpButton("biblioteca.arquivos.verificacao", "Arquivos da Biblioteca")}<span class="heading-gem">✦</span></h1><p>Regras, aventuras, mapas, fichas e artes para a sua mesa.</p></div>${staff ? button("+ Adicionar material", "lib-add", "", "primary") : ""}</div>
<form id="lib-filters" class="lib-toolbar" role="search">
  <div class="lib-search"><label for="lib-q">Buscar</label><div class="lib-search-row"><input id="lib-q" name="q" type="search" maxlength="100" value="${esc(filters.q)}" placeholder="Título ou descrição…"><button type="submit" class="subtle">Buscar</button></div></div>
  <div class="lib-filter"><label for="lib-system">Sistema</label><select id="lib-system" name="systemId"><option value="">Todos os sistemas</option></select></div>
  <div class="lib-filter"><label for="lib-category">Categoria</label><select id="lib-category" name="category"><option value="">Todas</option>${Object.entries(CATEGORIES)
    .map(([key, [label]]) => `<option value="${key}" ${filters.category === key ? "selected" : ""}>${label}</option>`)
    .join("")}</select></div>
  <div class="lib-filter"><label for="lib-type">Tipo</label><select id="lib-type" name="type"><option value="">Todos</option><option value="pdf" ${filters.type === "pdf" ? "selected" : ""}>PDF</option><option value="image" ${filters.type === "image" ? "selected" : ""}>Imagem</option></select></div>
</form>
<div class="list-summary lib-summary"><span class="lib-summary-actions">${staff ? `<label class="lib-toggle"><input type="checkbox" id="lib-deleted" ${showDeleted ? "checked" : ""}> Mostrar excluídos</label>` : ""}</span></div>
<div id="lib-grid" class="lib-grid" aria-live="polite" aria-busy="true"></div>
<div id="lib-pagination" class="pagination"></div>`;
  if (!staff) showDeleted = false;
  const form = $("#lib-filters");
  form.onsubmit = (e) => {
    e.preventDefault();
    filters.q = form.elements.q.value.trim();
    page = 1;
    load();
  };
  for (const name of ["systemId", "category", "type"])
    form.elements[name].onchange = (e) => {
      filters[name] = e.target.value;
      page = 1;
      load();
    };
  const deleted = $("#lib-deleted");
  if (deleted)
    deleted.onchange = () => {
      showDeleted = deleted.checked;
      page = 1;
      load();
    };
  main.addEventListener("click", onClick);
  await Promise.all([loadSystems(), load()]);
  // Link direto: #library/<id> abre o material.
  if (isGuid(segments[0])) {
    try {
      openItem(await api("/library/" + segments[0]));
    } catch (error) {
      toast(error.message);
    }
  }
  return () => {
    generation++;
    closeViewer();
  };
}

async function loadSystems() {
  try {
    const list = await api("/rpg-systems");
    systems = Array.isArray(list) ? list.filter((s) => isGuid(s?.id)) : [];
  } catch {
    systems = []; // Indisponível: o filtro fica só com "Todos os sistemas".
  }
  const select = $("#lib-system");
  if (!select) return;
  if (filters.systemId && filters.systemId !== "none" && !systems.some((s) => s.id === filters.systemId)) filters.systemId = "";
  select.innerHTML =
    `<option value="">Todos os sistemas</option>` +
    (systems.length ? `<option value="none" ${filters.systemId === "none" ? "selected" : ""}>Material geral (qualquer sistema)</option>` : "") +
    systems.map((s) => `<option value="${s.id}" ${filters.systemId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

async function load() {
  const request = ++generation;
  const grid = $("#lib-grid");
  if (!grid) return;
  grid.setAttribute("aria-busy", "true");
  const query = new URLSearchParams({ page, pageSize: PAGE_SIZE });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  if (showDeleted) query.set("deleted", "1");
  let result;
  try {
    result = await api("/library?" + query);
  } catch (error) {
    if (request !== generation || !$("#lib-grid")) return;
    grid.removeAttribute("aria-busy");
    $("#lib-pagination").innerHTML = "";
    grid.innerHTML = `<div class="empty lib-error" role="alert"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>A biblioteca não respondeu.</h3><p>${esc(error.message)}</p>${button("Tentar novamente", "lib-retry", "", "primary")}</div>`;
    return;
  }
  if (request !== generation || !$("#lib-grid")) return;
  grid.removeAttribute("aria-busy");
  items = result.items.filter((i) => isGuid(i.id));
  const filtered = Object.values(filters).some(Boolean);
  grid.innerHTML = items.length
    ? items.map(card).join("")
    : showDeleted
      ? empty("Nenhum material excluído.", "Os materiais excluídos aparecem aqui para revisão e restauração.")
      : filtered
        ? empty("Nenhum material encontrado.", "Tente outra busca ou volte os filtros para “Todos”.")
        : isStaff(state.user)
          ? empty("A estante ainda está vazia.", "Publique o primeiro material para toda a guilda.", "lib-add", "+ Adicionar material")
          : empty("A estante ainda está vazia.", "Em breve a equipe publicará regras, mapas e aventuras aqui.");
  grid.querySelectorAll(".lib-title").forEach((title) => highlightIn(title, filters.q));
  const pages = Math.ceil(result.total / PAGE_SIZE);
  $("#lib-pagination").innerHTML =
    pages > 1
      ? `${button("← Anterior", "lib-page", page - 1, "subtle", page === 1 ? "disabled" : "")}<span>Página ${page} de ${pages}</span>${button("Próxima →", "lib-page", page + 1, "subtle", page >= pages ? "disabled" : "")}`
      : "";
}

function card(item) {
  const kind = kindOf(item.contentType);
  const category = CATEGORIES[item.category] ? item.category : "other";
  const [label, icon] = CATEGORIES[category];
  const staff = isStaff(state.user);
  return `<article class="lib-card metal${item.deletedAt ? " is-deleted" : ""}">
  <button type="button" class="lib-cover lib-cat-${category}" data-action="lib-open" data-id="${item.id}" aria-label="Abrir ${esc(item.title)}"><span class="lib-icon" aria-hidden="true">${icon}</span><span class="lib-kind">${kind === "pdf" ? "PDF" : kind === "image" ? "IMAGEM" : "ARQUIVO"}</span></button>
  <div class="lib-card-body">
    <div class="lib-tags"><span class="badge">${label}</span>${item.deletedAt ? `<span class="status-chip bad">Excluído em ${dateOnly(item.deletedAt)}</span>` : ""}</div>
    <h2 class="lib-title">${esc(item.title)}</h2>
    <p class="lib-system">${esc(item.system || "Material geral")}</p>
    <dl class="lib-meta"><div><dt>Tamanho</dt><dd>${formatBytes(item.size)}</dd></div><div><dt>Atualizado</dt><dd>${dateOnly(item.updatedAt)}</dd></div><div><dt>Downloads</dt><dd>${Number(item.downloads) || 0}</dd></div></dl>
  </div>
  <div class="lib-card-actions">${button("Abrir", "lib-open", item.id, "subtle")}${item.deletedAt ? "" : button("↓ Baixar", "lib-download", item.id, "subtle", `aria-label="Baixar ${esc(item.title)}"`)}${staff ? button("Gerenciar", "lib-manage", item.id, "subtle", `aria-label="Gerenciar ${esc(item.title)}"`) : ""}</div>
</article>`;
}

async function onClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b || !b.dataset.action.startsWith("lib-")) return;
  const { action, id } = b.dataset;
  const item = items.find((i) => i.id === id);
  if (action === "lib-retry") return load();
  if (action === "lib-page") {
    page = Math.max(1, Number(id) || 1);
    await load();
    $("#lib-grid")?.scrollIntoView({ block: "start" });
    return;
  }
  if (action === "lib-add" && isStaff(state.user)) return uploadForm();
  if (!item) return;
  if (action === "lib-open") openItem(item);
  if (action === "lib-download") download(item);
  if (action === "lib-manage" && isStaff(state.user)) manage(item);
}

// ---------- Modal compartilhado ----------
/** Abre conteúdo no #modal comum. Encerra o visualizador anterior e liga os cliques ao conteúdo novo (sem listeners globais). */
function openModal(title, html, { wide = false } = {}) {
  closeViewer();
  modal(title, `<div class="lib-modal">${html}</div>`);
  const dialog = $("#modal");
  dialog.classList.toggle("lib-wide", wide);
  dialog.addEventListener(
    "close",
    () => {
      dialog.classList.remove("lib-wide");
      closeViewer();
    },
    { once: true },
  );
  const root = $("#modal-body .lib-modal");
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !b.dataset.action.startsWith("lib-")) return;
    const item = currentItem;
    const { action, id } = b.dataset;
    if (action === "lib-download" && item) download(item);
    if (action === "lib-manage" && item) manage(item);
    if (action === "lib-edit" && item) editForm(item);
    if (action === "lib-replace" && item) replaceForm(item);
    if (action === "lib-delete" && item) deleteForm(item);
    if (action === "lib-history" && item) history(item, Number(id) || 1);
    if (action === "lib-restore" && item) restore(item);
    if (action === "lib-revert" && item) confirmRevert(item, Number(id), b.dataset.label || "");
    if (action === "lib-view" && item) openItem(item);
  });
  return root;
}
let currentItem = null;

function download(item) {
  if (!isGuid(item.id)) return;
  const link = document.createElement("a");
  link.href = fileUrl(item.id, false);
  link.download = "";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  api(`/library/${item.id}/downloaded`, "POST", undefined, { background: true }).catch(() => {});
}

// ---------- Visualizador ----------
function openItem(item) {
  if (!isGuid(item.id)) return;
  currentItem = item;
  const kind = kindOf(item.contentType);
  const staff = isStaff(state.user);
  const actions = `${item.deletedAt ? "" : button("↓ Baixar", "lib-download", item.id, "primary")}${staff ? button("Gerenciar", "lib-manage", item.id, "subtle") : ""}`;
  const meta = `<p class="lib-viewer-meta">${esc(categoryLabel(item.category))} · ${esc(item.system || "Material geral")} · ${esc(item.fileName)} · ${formatBytes(item.size)}</p>${item.description ? `<p class="lib-description">${esc(item.description)}</p>` : ""}`;
  if (kind === "image") {
    const root = openModal(
      item.title,
      `${meta}<div class="lib-stage lib-image-stage"><p class="lib-stage-status" role="status">Carregando imagem…</p><img class="lib-image" alt="${esc(item.title)}" hidden></div><div class="form-actions">${actions}</div>`,
      { wide: true },
    );
    const img = root.querySelector(".lib-image");
    const status = root.querySelector(".lib-stage-status");
    img.onload = () => {
      status.remove();
      img.hidden = false;
    };
    img.onerror = () => {
      status.textContent = "Não foi possível exibir a imagem. Tente baixar o arquivo.";
    };
    img.src = fileUrl(item.id, true);
    return;
  }
  if (kind !== "pdf") {
    openModal(item.title, `${meta}<p>Este arquivo não tem pré-visualização.</p><div class="form-actions">${actions}</div>`);
    return;
  }
  const root = openModal(
    item.title,
    `${meta}<div class="lib-pdf-toolbar" role="toolbar" aria-label="Controles do PDF">${helpButton("biblioteca.leitor.controles", "Leitor de PDF")}
  ${button("‹", "pdf-prev", "", "subtle", 'aria-label="Página anterior" aria-describedby="pdf-page-help" disabled')}
  <span class="lib-page-label" aria-live="polite">Página <b data-pdf-page>–</b> de <b data-pdf-pages>–</b></span>
  ${button("›", "pdf-next", "", "subtle", 'aria-label="Próxima página" aria-describedby="pdf-page-help" disabled')}
  <span class="lib-zoom">${button("−", "pdf-zoom-out", "", "subtle", 'aria-label="Diminuir zoom"')}<b data-pdf-zoom>100%</b>${button("+", "pdf-zoom-in", "", "subtle", 'aria-label="Aumentar zoom"')}${button("Ajustar", "pdf-fit", "", "subtle", 'aria-label="Ajustar à largura"')}</span>
</div>
<div class="lib-stage lib-pdf-stage" tabindex="0" aria-label="Documento ${esc(item.title)}. Use as setas para trocar de página e + ou − para o zoom."><p class="lib-stage-status" role="status">Abrindo o documento…</p><canvas class="lib-canvas" hidden></canvas></div>
<p id="pdf-page-help" class="muted small lib-keyboard-hint">Anterior fica indisponível na primeira página; Próxima, na última. Durante a abertura, aguarde o documento. Teclado: ← → trocam de página · + − ajustam o zoom · 0 ajusta à largura.</p>
<div class="form-actions">${actions}</div>`,
    { wide: true },
  );
  viewer = pdfViewer(root, item);
}

/** Visualizador pdf.js: bytes via fetch same-origin, sem eval nem scripts do PDF; renderiza uma página por vez sob demanda. */
function pdfViewer(root, item) {
  const controller = new AbortController();
  const stage = root.querySelector(".lib-pdf-stage");
  const canvas = root.querySelector(".lib-canvas");
  const status = root.querySelector(".lib-stage-status");
  const label = (name) => root.querySelector(`[data-pdf-${name}]`);
  const control = (name) => root.querySelector(`[data-action="pdf-${name}"]`);
  let doc = null,
    current = 1,
    zoom = 1,
    task = null,
    closed = false,
    pending = 0;
  const fail = (message) => {
    if (closed) return;
    status.textContent = message;
    status.hidden = false;
    canvas.hidden = true;
  };
  async function render() {
    if (!doc || closed) return;
    const ticket = ++pending;
    task?.cancel();
    try {
      const pdfPage = await doc.getPage(current);
      if (closed || ticket !== pending) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const available = Math.max(200, stage.clientWidth - 24);
      const viewport = pdfPage.getViewport({ scale: (available / base.width) * zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = Math.floor(viewport.width) + "px";
      canvas.style.height = Math.floor(viewport.height) + "px";
      task = pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (closed || ticket !== pending) return;
      status.hidden = true;
      canvas.hidden = false;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Página ${current} de ${doc.numPages} — ${item.title}`);
      label("page").textContent = current;
      label("zoom").textContent = Math.round(zoom * 100) + "%";
      control("prev").disabled = current <= 1;
      control("next").disabled = current >= doc.numPages;
    } catch (error) {
      if (error?.name === "RenderingCancelledException") return;
      fail("Não foi possível desenhar esta página. Baixe o arquivo para abri-lo no seu leitor.");
    }
  }
  const go = (delta) => {
    if (!doc) return;
    const next = Math.min(doc.numPages, Math.max(1, current + delta));
    if (next !== current) {
      current = next;
      render();
      stage.scrollTop = 0;
    }
  };
  const setZoom = (value) => {
    zoom = Math.min(4, Math.max(0.5, Math.round(value * 100) / 100));
    render();
  };
  const commands = {
    "pdf-prev": () => go(-1),
    "pdf-next": () => go(1),
    "pdf-zoom-in": () => setZoom(zoom + 0.25),
    "pdf-zoom-out": () => setZoom(zoom - 0.25),
    "pdf-fit": () => setZoom(1),
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action^='pdf-']");
    if (b && commands[b.dataset.action]) commands[b.dataset.action]();
  });
  stage.addEventListener("keydown", (e) => {
    const key = {
      ArrowLeft: "pdf-prev",
      PageUp: "pdf-prev",
      ArrowRight: "pdf-next",
      PageDown: "pdf-next",
      "+": "pdf-zoom-in",
      "=": "pdf-zoom-in",
      "-": "pdf-zoom-out",
      0: "pdf-fit",
    }[e.key];
    if (key) {
      e.preventDefault();
      commands[key]();
    }
  });
  (async () => {
    try {
      const response = await fetch(fileUrl(item.id, true), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new ApiError(response.status === 404 ? "Material não encontrado." : "Não foi possível baixar o documento.", response.status);
      const data = new Uint8Array(await response.arrayBuffer());
      if (closed) return;
      const pdfjs = await import("/vendor/pdfjs/pdf.min.js");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      const loading = pdfjs.getDocument({
        data,
        isEvalSupported: false,
        enableScripting: false,
        enableXfa: false,
        disableAutoFetch: true,
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
      });
      doc = await loading.promise;
      if (closed) {
        doc.destroy();
        return;
      }
      label("pages").textContent = doc.numPages;
      await render();
      stage.focus({ preventScroll: true });
    } catch (error) {
      if (error?.name === "AbortError") return;
      fail(
        error?.name === "PasswordException"
          ? "Este PDF é protegido por senha. Baixe o arquivo para abri-lo."
          : error instanceof ApiError
            ? error.message
            : "Não foi possível abrir o PDF aqui. Baixe o arquivo para abri-lo no seu leitor.",
      );
    }
  })();
  return {
    destroy() {
      closed = true;
      controller.abort();
      task?.cancel();
      doc?.destroy();
      doc = null;
    },
  };
}
function closeViewer() {
  viewer?.destroy();
  viewer = null;
}

// ---------- Gestão da equipe ----------
function systemOptions(selected) {
  const known = systems.some((s) => s.id === selected);
  return (
    `<option value="">Material geral (qualquer sistema)</option>` +
    (selected && !known && isGuid(selected) ? `<option value="${selected}" selected>Sistema atual</option>` : "") +
    systems.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("")
  );
}
function categoryOptions(selected) {
  return Object.entries(CATEGORIES)
    .map(([key, [label]]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}
function metadataFields(item = {}) {
  return `${field("title", "Título", item.title || "", "text", 'required maxlength="120" autocomplete="off"')}
<div class="field"><label for="f-description">Descrição <span class="muted">(opcional)</span></label><textarea id="f-description" name="description" maxlength="2000" rows="3">${esc(item.description || "")}</textarea></div>
<div class="lib-form-row"><div class="field"><label for="f-category">Categoria</label><select id="f-category" name="category" required>${categoryOptions(item.category || "rules")}</select></div>
<div class="field"><label for="f-systemId">Sistema</label><select id="f-systemId" name="systemId">${systemOptions(item.systemId || "")}</select></div></div>`;
}
const fileField = (label) =>
  `<div class="field"><label for="f-file">${label}</label><input id="f-file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" aria-describedby="lib-file-help"></div><p id="lib-file-help" class="form-help">PDF, PNG, JPEG ou WebP, até 25 MB. O tipo é conferido pelo conteúdo e o arquivo passa por verificação de segurança antes de ser publicado.</p>`;

/** Envio com estado visível: botão desabilitado com rótulo de progresso, aria-busy e erro junto ao formulário. */
async function sending(form, label, task) {
  const submit = form.querySelector('button[type="submit"]');
  const original = submit.textContent;
  const error = form.querySelector("[data-form-error]");
  error.textContent = "";
  submit.disabled = true;
  submit.textContent = label;
  form.setAttribute("aria-busy", "true");
  try {
    await task();
  } catch (e) {
    error.textContent = uploadError(e);
    if (e instanceof ApiError && e.status === 409) load();
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = original;
      form.removeAttribute("aria-busy");
    }
  }
}

function uploadForm() {
  currentItem = null;
  const root = openModal(
    "Adicionar material",
    `<p class="muted small">A publicação é imediata para toda a plataforma e fica registrada na auditoria.</p><form id="lib-upload" novalidate>${fileField("Arquivo")}${metadataFields({ systemId: filters.systemId !== "none" ? filters.systemId : "" })}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Publicar material</button></div></form>`,
  );
  const form = root.querySelector("#lib-upload");
  const fileInput = form.elements.file;
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    form.querySelector("[data-form-error]").textContent = file ? precheckFile(file) : "";
    if (file && !form.elements.title.value.trim()) form.elements.title.value = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    const problem = precheckFile(file) || (!form.elements.title.value.trim() ? "Informe um título." : "");
    if (problem) {
      form.querySelector("[data-form-error]").textContent = problem;
      return;
    }
    sending(form, "Enviando e verificando…", async () => {
      const created = await api("/library", "POST", new FormData(form));
      $("#modal").close();
      toast(`“${created.title}” foi publicado na biblioteca.`);
      showDeleted = false;
      const toggle = $("#lib-deleted");
      if (toggle) toggle.checked = false;
      page = 1;
      await load();
    });
  };
}

function manage(item) {
  currentItem = item;
  const admin = isAdmin(state.user);
  const deleted = !!item.deletedAt;
  openModal(
    "Gerenciar material",
    `<h3 class="lib-manage-title">${esc(item.title)}</h3>
<dl class="lib-details">
  <div><dt>Arquivo</dt><dd>${esc(item.fileName)} · ${formatBytes(item.size)}</dd></div>
  <div><dt>Categoria</dt><dd>${esc(categoryLabel(item.category))}</dd></div>
  <div><dt>Sistema</dt><dd>${esc(item.system || "Material geral")}</dd></div>
  <div><dt>Publicado por</dt><dd>${esc(item.createdBy || "—")}</dd></div>
  <div><dt>Atualizado</dt><dd>${formatDate(item.updatedAt)}</dd></div>
  <div><dt>Downloads</dt><dd>${Number(item.downloads) || 0}</dd></div>
  ${deleted ? `<div><dt>Situação</dt><dd><span class="status-chip bad">Excluído em ${formatDate(item.deletedAt)}</span></dd></div>` : ""}
</dl>
<div class="lib-manage-actions">
  ${button("Visualizar", "lib-view", item.id, "subtle")}
  ${deleted ? "" : button("Editar dados", "lib-edit", item.id, "subtle")}
  ${deleted ? "" : button("Substituir arquivo", "lib-replace", item.id, "subtle")}
  ${button("Histórico", "lib-history", 1, "subtle")}
  ${deleted && admin ? button("Restaurar material", "lib-restore", item.id, "primary") : ""}
  ${deleted ? "" : button("Excluir", "lib-delete", item.id, "danger")}
</div>
${deleted && !admin ? '<p class="muted small">Somente um administrador pode restaurar um material excluído.</p>' : ""}`,
  );
}

function editForm(item) {
  const root = openModal(
    "Editar material",
    `<form id="lib-edit">${metadataFields(item)}${formError()}<div class="form-actions">${button("Voltar", "lib-manage", item.id, "subtle")}<button type="submit" class="primary">Salvar alterações</button></div></form>`,
  );
  const form = root.querySelector("#lib-edit");
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    sending(form, "Salvando…", async () => {
      const updated = await api("/library/" + item.id, "PUT", {
        title: data.title,
        description: data.description,
        category: data.category,
        systemId: data.systemId || null,
        revision: item.revision,
      });
      toast("Material atualizado.");
      await load();
      manage(updated);
    });
  };
}

function replaceForm(item) {
  const root = openModal(
    "Substituir arquivo",
    `<p class="muted small">Arquivo atual: <strong>${esc(item.fileName)}</strong> (${formatBytes(item.size)}). O arquivo anterior fica guardado no histórico e pode ser recuperado por um administrador.</p><form id="lib-replace" novalidate>${fileField("Novo arquivo")}<input type="hidden" name="revision" value="${Number(item.revision) || 0}">${formError()}<div class="form-actions">${button("Voltar", "lib-manage", item.id, "subtle")}<button type="submit" class="primary">Substituir arquivo</button></div></form>`,
  );
  const form = root.querySelector("#lib-replace");
  form.elements.file.onchange = () => {
    form.querySelector("[data-form-error]").textContent = precheckFile(form.elements.file.files[0]);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const problem = precheckFile(form.elements.file.files[0]);
    if (problem) {
      form.querySelector("[data-form-error]").textContent = problem;
      return;
    }
    sending(form, "Enviando e verificando…", async () => {
      const updated = await api(`/library/${item.id}/file`, "PUT", new FormData(form));
      toast("Arquivo substituído.");
      await load();
      manage(updated);
    });
  };
}

function deleteForm(item) {
  const root = openModal(
    "Excluir material?",
    `<p>O material <strong>${esc(item.title)}</strong> deixará de aparecer na biblioteca para todos.</p><p class="muted small">A exclusão fica registrada na auditoria e um administrador pode restaurá-lo depois.</p><form id="lib-delete"><div class="field"><label for="f-reason">Motivo <span class="muted">(opcional)</span></label><textarea id="f-reason" name="reason" maxlength="300" rows="2"></textarea></div>${formError()}<div class="form-actions">${button("Voltar", "lib-manage", item.id, "subtle")}<button type="submit" class="danger">Excluir material</button></div></form>`,
  );
  const form = root.querySelector("#lib-delete");
  form.onsubmit = (e) => {
    e.preventDefault();
    sending(form, "Excluindo…", async () => {
      await api("/library/" + item.id, "DELETE", { reason: form.elements.reason.value, revision: item.revision });
      $("#modal").close();
      toast("Material excluído.");
      await load();
    });
  };
}

async function restore(item) {
  try {
    const restored = await api(`/library/${item.id}/restore`, "POST");
    toast("Material restaurado.");
    await load();
    manage(restored);
  } catch (error) {
    toast(error.message);
  }
}

async function history(item, historyPage = 1) {
  let result;
  try {
    result = await api(`/library/${item.id}/history?page=${historyPage}`);
  } catch (error) {
    openModal("Histórico", `<p class="form-error" role="alert">${esc(error.message)}</p><div class="form-actions">${button("Voltar", "lib-manage", item.id, "subtle")}</div>`);
    return;
  }
  const admin = isAdmin(state.user);
  const pages = Math.ceil(result.total / result.pageSize);
  const rows = result.items
    .map(
      (entry) => `<li class="lib-history-item"><div class="lib-history-head"><strong>${esc(ACTIONS[entry.action] || entry.action)}</strong><time datetime="${esc(entry.createdAt)}">${formatDate(entry.createdAt)}</time></div><p>${esc(entry.summary)}</p><small>por ${esc(entry.actor)}</small>${
        admin && entry.revertible && !item.deletedAt
          ? button("↺ Reverter para antes", "lib-revert", entry.id, "subtle small", `data-label="${esc(ACTIONS[entry.action] || "")}"`)
          : ""
      }</li>`,
    )
    .join("");
  openModal(
    "Histórico do material",
    `<h3 class="lib-manage-title">${esc(item.title)}</h3>${rows ? `<ol class="lib-history">${rows}</ol>` : '<p class="muted">Nenhum registro.</p>'}${
      !admin ? '<p class="muted small">Reversões são feitas por um administrador.</p>' : item.deletedAt ? '<p class="muted small">Restaure o material para poder reverter alterações.</p>' : ""
    }<div class="pagination">${
      pages > 1
        ? `${button("← Recentes", "lib-history", historyPage - 1, "subtle", historyPage === 1 ? "disabled" : "")}<span>${historyPage} de ${pages}</span>${button("Antigos →", "lib-history", historyPage + 1, "subtle", historyPage >= pages ? "disabled" : "")}`
        : ""
    }</div><div class="form-actions">${button("Voltar", "lib-manage", item.id, "subtle")}</div>`,
  );
}

function confirmRevert(item, auditId, label) {
  if (!Number.isSafeInteger(auditId) || auditId <= 0) return;
  const root = openModal(
    "Reverter alteração?",
    `<p>O material <strong>${esc(item.title)}</strong> voltará ao estado anterior ao registro “${esc(label)}” (#${auditId}).</p><p class="muted small">A reversão é registrada na auditoria. Alterações feitas depois desse registro no mesmo aspecto (arquivo ou dados) serão substituídas.</p><form id="lib-revert">${formError()}<div class="form-actions">${button("Voltar", "lib-history", 1, "subtle")}<button type="submit" class="primary">Reverter</button></div></form>`,
  );
  const form = root.querySelector("#lib-revert");
  form.onsubmit = (e) => {
    e.preventDefault();
    sending(form, "Revertendo…", async () => {
      const updated = await api(`/library/${item.id}/revert`, "POST", { auditId });
      toast("Alteração revertida.");
      await load();
      currentItem = updated;
      await history(updated, 1);
    });
  };
}
