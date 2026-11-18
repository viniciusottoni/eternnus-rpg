// Núcleo gráfico compartilhado (ADR-081): janela do editor em tela cheia, menus, ferramentas, painéis, barra de estado,
// menus de contexto, janela de propriedades, painel de camadas/estrutura/histórico e atalhos.
// Usado pelos editores de mapas de tiles, mapas de imagem e cenas. Não faz chamadas HTTP nem guarda estado de jogo.
import { $, esc, modal, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { interfaceMode, interfaceToggle, mountInterfaceToggle, onInterfaceChange, setInterfaceMode } from "./interface-mode.js";
import { mountCommandPalette } from "./command-palette.js";
import { FIELD_SAFE, clampMenu, isTypingTarget, isRequiredLayer, rulerLabel, rulerSteps, shortcutLabel, shortcutOf, zoomLabel,
  normalizeContexts, toolInContext, panelInContext, availableContexts, toolAfterContext, contextShortcutIndex,
  layoutPrefKey, normalizeLayoutPref, panelOrder, movePanel, PANEL_WIDTH } from "./editor-policy.js";
import { state } from "./state.js";

let shellSequence = 0;
/** Descrição curta das dicas (o componente de ajuda aceita até 240 caracteres). */
const tipDetail = (text) => { const s = String(text || "").trim(); return s.length > 240 ? `${s.slice(0, 237).trimEnd()}…` : s; };

// ---------- Ícones: conjunto compartilhado em icons.js (ADR-101) ----------
export { icon } from "./icons.js";
import { icon } from "./icons.js";

/** Contêiner para camadas flutuantes: o <dialog> aberto (camada superior) ou o documento. */
const floatingHost = () => document.querySelector("dialog[open]") || document.body;

// ---------- Menu de contexto ----------
let openMenus = [];
/**
 * Abre um menu acessível em (x, y) ou abaixo de `anchor`. Itens: { label, shortcut, run, disabled, checked, danger, items, separator, hint }.
 * Devolve a função que fecha o menu. Esc fecha e devolve o foco; setas percorrem; Enter/Espaço executam.
 */
export function openContextMenu(at, items, { label = "Ações", onClose, parent = null, onKey } = {}) {
  if (!parent) closeAllMenus();
  const visible = items.filter(Boolean);
  if (!visible.length) return () => {};
  const returnFocus = parent ? null : document.activeElement;
  const menu = document.createElement("div");
  menu.className = "ed-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.tabIndex = -1;
  menu.innerHTML = visible.map((item, i) => item.separator
    ? '<div class="ed-menu-sep" role="separator"></div>'
    : `<button type="button" role="${item.checked != null ? "menuitemcheckbox" : "menuitem"}" class="ed-menu-item${item.danger ? " danger" : ""}" data-index="${i}" ${item.checked != null ? `aria-checked="${item.checked ? "true" : "false"}"` : ""} ${item.disabled ? 'aria-disabled="true"' : ""} ${item.items ? 'aria-haspopup="menu" aria-expanded="false"' : ""} tabindex="-1"><span class="ed-menu-check" aria-hidden="true">${item.checked ? "✓" : ""}</span><span class="ed-menu-label">${esc(item.label)}${item.hint ? `<small>${esc(item.hint)}</small>` : ""}</span><span class="ed-menu-key">${item.items ? "›" : esc(shortcutLabel(item.shortcut || ""))}</span></button>`).join("");
  floatingHost().append(menu);
  const rect = at?.getBoundingClientRect ? at.getBoundingClientRect() : null;
  const x = rect ? (parent ? rect.right - 2 : rect.left) : at.x, y = rect ? (parent ? rect.top - 4 : rect.bottom + 2) : at.y;
  const pos = clampMenu(x, y, menu.offsetWidth, menu.offsetHeight, innerWidth, innerHeight);
  menu.style.left = `${pos.x}px`; menu.style.top = `${pos.y}px`;
  const buttons = () => [...menu.querySelectorAll(".ed-menu-item")];
  const focusAt = (i) => { const list = buttons(); if (list.length) list[(i + list.length) % list.length].focus(); };
  let child = null;
  const entry = { menu, close };
  openMenus.push(entry);
  function close(restore = true) {
    child?.(false); child = null;
    if (!menu.isConnected) return;
    menu.remove();
    openMenus = openMenus.filter((m) => m !== entry);
    if (!parent) { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("blur", blur); }
    if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    onClose?.();
  }
  function openChild(button) {
    const item = visible[Number(button.dataset.index)];
    child?.(false);
    button.setAttribute("aria-expanded", "true");
    child = openContextMenu(button, item.items, { label: item.label, parent: menu, onClose: () => { button.setAttribute("aria-expanded", "false"); } });
  }
  function activate(button) {
    const item = visible[Number(button.dataset.index)];
    if (!item || item.disabled) { if (item?.disabledReason) toast(item.disabledReason); return; }
    if (item.items) return openChild(button);
    closeAllMenus(false);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    Promise.resolve().then(() => item.run?.()).catch((e) => toast(e?.message || String(e)));
  }
  menu.addEventListener("click", (e) => { const b = e.target.closest(".ed-menu-item"); if (b) activate(b); });
  menu.addEventListener("pointerover", (e) => {
    const b = e.target.closest(".ed-menu-item"); if (!b) return;
    b.focus({ preventScroll: true });
    if (visible[Number(b.dataset.index)]?.items) openChild(b); else { child?.(false); child = null; }
  });
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  menu.addEventListener("keydown", (e) => {
    const list = buttons(), i = list.indexOf(document.activeElement);
    if (onKey?.(e) === true) return;
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(-1); }
    else if (e.key === "ArrowRight" && list[i]?.getAttribute("aria-haspopup")) { e.preventDefault(); openChild(list[i]); setTimeout(() => openMenus.at(-1)?.menu.querySelector(".ed-menu-item")?.focus(), 0); }
    else if (e.key === "ArrowLeft" && parent) { e.preventDefault(); close(false); parent.querySelector('[aria-expanded="true"]')?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") { e.preventDefault(); closeAllMenus(true); }
    else if ((e.key === "Enter" || e.key === " ") && list[i]) { e.preventDefault(); activate(list[i]); }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const start = i + 1, k = e.key.toLowerCase();
      const hit = [...list.slice(start), ...list.slice(0, start)].find((b) => b.textContent.trim().toLowerCase().startsWith(k));
      hit?.focus();
    }
  });
  const outside = (e) => { if (!openMenus.some((m) => m.menu.contains(e.target))) closeAllMenus(false); };
  const blur = () => closeAllMenus(false);
  if (!parent) { setTimeout(() => document.addEventListener("pointerdown", outside, true), 0); window.addEventListener("blur", blur); }
  setTimeout(() => { if (menu.isConnected && !parent) focusAt(0); }, 0);
  return close;
}
export function closeAllMenus(restore = false) { for (const m of [...openMenus].reverse()) m.close(restore); }

// ---------- Janela de propriedades (não modal, arrastável) ----------
/**
 * Campos: { name, label, type: text|textarea|number|range|checkbox|select|color|static|heading, value, min, max, step, unit,
 * options:[[valor, rótulo]], help, maxlength, required }. `onApply(values)` pode lançar erro (mostrado na janela) ou devolver false.
 */
export function openPropertiesDialog({ title, fields, onApply, onClose, live = false }) {
  document.querySelector(".ed-props")?.dispatchEvent(new Event("ed-close"));
  const returnFocus = document.activeElement;
  const box = document.createElement("section");
  box.className = "ed-props";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "false");
  const titleId = `ed-props-title-${Date.now()}`;
  box.setAttribute("aria-labelledby", titleId);
  const field = (f, i) => {
    const id = `ed-p-${i}`;
    const help = f.help ? `<small class="form-help" id="${id}-help">${esc(f.help)}</small>` : "";
    const described = f.help ? `aria-describedby="${id}-help"` : "";
    const attrs = `id="${id}" name="${esc(f.name)}" ${described} ${f.required ? "required" : ""} ${f.disabled ? "disabled" : ""}`;
    if (f.type === "heading") return `<h4 class="ed-props-heading">${esc(f.label)}</h4>`;
    if (f.type === "static") return `<div class="ed-props-row ed-props-static"><span>${esc(f.label)}</span><strong>${esc(f.value ?? "")}</strong></div>`;
    if (f.type === "checkbox") return `<label class="check ed-props-check"><input type="checkbox" ${attrs} ${f.value ? "checked" : ""}> ${esc(f.label)}</label>${help}`;
    if (f.type === "select") return `<div class="field ed-props-row"><label for="${id}">${esc(f.label)}</label><select ${attrs}>${(f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${help}</div>`;
    if (f.type === "textarea") return `<div class="field ed-props-row"><label for="${id}">${esc(f.label)}</label><textarea ${attrs} rows="${f.rows || 4}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ""}>${esc(f.value ?? "")}</textarea>${help}</div>`;
    const type = f.type === "range" ? "range" : f.type === "number" ? "number" : f.type === "color" ? "color" : "text";
    const range = type === "number" || type === "range" ? `${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} ${f.step != null ? `step="${f.step}"` : ""}` : "";
    return `<div class="field ed-props-row"><label for="${id}">${esc(f.label)}${f.unit ? ` <small>(${esc(f.unit)})</small>` : ""}</label><input type="${type}" ${attrs} ${range} ${f.maxlength ? `maxlength="${f.maxlength}"` : ""} value="${esc(f.value ?? "")}">${type === "range" ? `<output for="${id}">${esc(f.value ?? "")}</output>` : ""}${help}</div>`;
  };
  box.innerHTML = `<header class="ed-props-head"><h3 id="${titleId}">${esc(title)}</h3><button type="button" class="ed-icon-button" data-props="cancel" aria-label="Fechar propriedades">${icon("close")}</button></header><form class="ed-props-form" novalidate>${fields.map(field).join("")}<p class="form-error" role="alert" data-props-error></p><div class="form-actions"><button type="button" class="subtle" data-props="cancel">Cancelar</button>${live ? "" : '<button type="button" class="subtle" data-props="apply">Aplicar</button>'}<button type="submit" class="primary">OK</button></div></form>`;
  floatingHost().append(box);
  const form = box.querySelector("form"), error = box.querySelector("[data-props-error]");
  const read = () => {
    const values = {};
    for (const f of fields) {
      const input = form.elements.namedItem(f.name);
      if (!input || f.type === "static" || f.type === "heading") continue;
      values[f.name] = f.type === "checkbox" ? input.checked : f.type === "number" || f.type === "range" ? (input.value === "" ? null : Number(input.value)) : input.value;
    }
    return values;
  };
  async function apply(closeAfter) {
    error.textContent = "";
    if (!form.reportValidity()) return;
    try {
      const result = await onApply?.(read());
      if (result === false) return;
      if (closeAfter) close();
    } catch (e) { error.textContent = e?.message || String(e); }
  }
  function close() {
    if (!box.isConnected) return;
    box.remove();
    document.removeEventListener("keydown", onKey, true);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    onClose?.();
  }
  const onKey = (e) => { if (e.key === "Escape" && box.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  box.addEventListener("ed-close", close);
  form.addEventListener("submit", (e) => { e.preventDefault(); apply(true); });
  form.addEventListener("input", (e) => {
    const out = e.target.type === "range" ? form.querySelector(`output[for="${e.target.id}"]`) : null;
    if (out) out.textContent = e.target.value;
    if (live) apply(false);
  });
  box.addEventListener("click", (e) => {
    const action = e.target.closest("[data-props]")?.dataset.props;
    if (action === "cancel") close();
    if (action === "apply") apply(false);
  });
  // Arrastar pela barra do título; posição inicial no canto superior direito do palco.
  const head = box.querySelector(".ed-props-head");
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = box.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = clampMenu(e.clientX - drag.dx, e.clientY - drag.dy, box.offsetWidth, box.offsetHeight, innerWidth, innerHeight, 4);
    box.style.left = `${p.x}px`; box.style.top = `${p.y}px`; box.style.right = "auto";
  });
  head.addEventListener("pointerup", () => { drag = null; });
  setTimeout(() => form.querySelector("input:not([type=hidden]):not(:disabled), select, textarea")?.focus(), 0);
  return { close, element: box };
}

// ---------- Painéis reutilizáveis ----------
/**
 * Painel de camadas (topo primeiro, como em editores gráficos). `onAction(action, id, value)`:
 * select | visible | lock | opacity | rename | up | down | add | duplicate | delete | move-selection.
 */
export function renderLayersPanel(host, { layers, active, complete = true, selectionCount = 0, lockedNote = "", visibilityNote = "", onAction }) {
  const rows = [...layers].reverse().map((l) => {
    const required = isRequiredLayer(l.id), current = l.id === active;
    return `<li class="ed-layer${current ? " active" : ""}${l.visible ? "" : " hidden-layer"}" data-layer="${esc(l.id)}">
      <button type="button" class="ed-icon-button" data-layer-action="visible" aria-pressed="${l.visible}" aria-label="${l.visible ? "Ocultar" : "Mostrar"} a camada ${esc(l.name)}">${icon(l.visible ? "eye" : "eyeOff")}</button>
      <button type="button" class="ed-icon-button" data-layer-action="lock" aria-pressed="${l.locked}" aria-label="${l.locked ? "Desbloquear" : "Bloquear"} a camada ${esc(l.name)}">${icon(l.locked ? "lock" : "unlock")}</button>
      <button type="button" class="ed-layer-name" data-layer-action="select" aria-pressed="${current}"><span>${esc(l.name)}</span><small>${required ? (l.id === "base" ? "obrigatória · base" : "obrigatória") : "extra"}${l.opacity < 100 ? ` · ${l.opacity}%` : ""}</small></button>
      ${complete ? `<label class="ed-layer-opacity"><span class="sr-only">Opacidade de ${esc(l.name)}</span><input type="number" min="0" max="100" step="5" value="${l.opacity}" data-layer-action="opacity" aria-label="Opacidade de ${esc(l.name)} (%)"></label>` : ""}
    </li>`;
  }).join("");
  const current = layers.find((l) => l.id === active);
  const required = current && isRequiredLayer(current.id);
  const index = layers.findIndex((l) => l.id === active);
  host.innerHTML = `<ul class="ed-layers" aria-label="Camadas, da mais alta para a mais baixa">${rows}</ul>
    <div class="ed-layer-tools" role="group" aria-label="Ações de camada">
      <button type="button" class="ed-icon-button" data-layer-action="add" aria-label="Nova camada" ${layers.length >= 8 ? 'aria-disabled="true"' : ""}>${icon("plus")}</button>
      <button type="button" class="ed-icon-button" data-layer-action="duplicate" aria-label="Duplicar camada ativa" ${!current || layers.length >= 8 ? 'aria-disabled="true"' : ""}>${icon("copy")}</button>
      <button type="button" class="ed-icon-button" data-layer-action="up" aria-label="Subir camada ativa" ${required || index >= layers.length - 1 ? 'aria-disabled="true"' : ""}>${icon("up")}</button>
      <button type="button" class="ed-icon-button" data-layer-action="down" aria-label="Descer camada ativa" ${required || index <= 2 ? 'aria-disabled="true"' : ""}>${icon("down")}</button>
      <button type="button" class="ed-icon-button" data-layer-action="rename" aria-label="Renomear camada ativa">${icon("text")}</button>
      <button type="button" class="ed-icon-button danger" data-layer-action="delete" aria-label="Excluir camada ativa" ${required ? 'aria-disabled="true" data-tip="Base e Elementos são obrigatórias."' : ""}>${icon("trash")}</button>
    </div>
    ${selectionCount ? `<label class="field ed-move-layer"><span>Mover ${selectionCount === 1 ? "seleção" : `${selectionCount} itens`} para</span><select data-layer-action="move-selection"><option value="">Escolha a camada…</option>${layers.filter((l) => l.id !== "base" || lockedNote !== "no-base").map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("")}</select></label>` : ""}
    ${visibilityNote ? `<p class="form-help">${esc(visibilityNote)}</p>` : ""}`;
  host.onclick = (e) => {
    const b = e.target.closest("[data-layer-action]");
    if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
    if (b.getAttribute("aria-disabled") === "true") { if (b.dataset.tip) toast(b.dataset.tip); return; }
    const id = b.closest("[data-layer]")?.dataset.layer || active;
    const action = b.dataset.layerAction;
    if (action === "rename") {
      const layer = layers.find((l) => l.id === id);
      const name = prompt("Nome da camada (até 40 caracteres)", layer?.name || "");
      if (name != null && name.trim()) onAction("rename", id, name.trim().slice(0, 40));
      return;
    }
    onAction(action, id);
  };
  host.ondblclick = (e) => {
    const row = e.target.closest(".ed-layer-name"); if (!row) return;
    const id = row.closest("[data-layer]").dataset.layer, layer = layers.find((l) => l.id === id);
    const name = prompt("Nome da camada (até 40 caracteres)", layer?.name || "");
    if (name != null && name.trim()) onAction("rename", id, name.trim().slice(0, 40));
  };
  host.onchange = (e) => {
    const t = e.target;
    if (t.dataset.layerAction === "opacity") onAction("opacity", t.closest("[data-layer]").dataset.layer, Math.max(0, Math.min(100, Math.round(Number(t.value) || 0))));
    if (t.dataset.layerAction === "move-selection" && t.value) onAction("move-selection", t.value);
  };
}

/**
 * Árvore de estrutura (grupos → itens) para localizar e selecionar elementos.
 * Item: { id, label, meta, icon, hidden, locked, selected }. Clique seleciona (Ctrl/Shift soma); botão direito abre o menu do item.
 */
export function renderStructurePanel(host, { groups, empty = "Nada nesta camada ainda.", onSelect, onContext }) {
  const any = groups.some((g) => g.items.length);
  host.innerHTML = any ? `<div class="ed-tree" role="tree" aria-label="Estrutura do documento">${groups.filter((g) => g.items.length || g.showEmpty).map((g) => `<div role="treeitem" aria-expanded="true" class="ed-tree-group"><span class="ed-tree-group-label">${esc(g.label)} <small>${g.items.length}</small></span><ul role="group">${g.items.map((it) => `<li role="treeitem" aria-selected="${!!it.selected}" class="ed-tree-item${it.selected ? " selected" : ""}${it.hidden ? " is-hidden" : ""}" data-item="${esc(it.id)}" tabindex="${it.selected ? 0 : -1}">${icon(it.icon || "object")}<span>${esc(it.label)}</span>${it.meta ? `<small>${esc(it.meta)}</small>` : ""}${it.locked ? icon("lock") : ""}</li>`).join("")}</ul></div>`).join("")}</div>` : `<p class="muted small">${esc(empty)}</p>`;
  const first = host.querySelector('.ed-tree-item[tabindex="0"]') || host.querySelector(".ed-tree-item");
  if (first) first.tabIndex = 0;
  host.onclick = (e) => { const it = e.target.closest("[data-item]"); if (it) onSelect(it.dataset.item, e.ctrlKey || e.metaKey || e.shiftKey); };
  host.oncontextmenu = (e) => { const it = e.target.closest("[data-item]"); if (!it || !onContext) return; e.preventDefault(); onSelect(it.dataset.item, false); onContext(it.dataset.item, { x: e.clientX, y: e.clientY }); };
  host.onkeydown = (e) => {
    const items = [...host.querySelectorAll("[data-item]")], i = items.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; items.forEach((x) => (x.tabIndex = -1)); n.tabIndex = 0; n.focus(); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(items[i].dataset.item, e.ctrlKey || e.shiftKey); }
    if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && onContext) { e.preventDefault(); const r = items[i].getBoundingClientRect(); onContext(items[i].dataset.item, { x: r.left + 20, y: r.bottom }); }
  };
}

/** Painel Histórico: lista as etapas desta sessão de edição; clicar volta/avança até ela. */
export function renderHistoryPanel(host, history) {
  const entries = history.entries();
  host.innerHTML = `<ol class="ed-history" aria-label="Histórico desta edição"><li><button type="button" data-history="0" aria-current="${history.position === 0 ? "step" : "false"}">Estado aberto</button></li>${entries.map((e) => `<li class="${e.done ? "" : "undone"}"><button type="button" data-history="${e.index}" aria-current="${history.position === e.index ? "step" : "false"}">${esc(e.label)}</button></li>`).join("")}</ol>${entries.length ? "" : '<p class="muted small">Nenhuma alteração ainda.</p>'}`;
  host.onclick = (e) => { const b = e.target.closest("[data-history]"); if (b) history.jump(Number(b.dataset.history)); };
}

// ---------- Janela do editor ----------
/**
 * Abre o editor em tela cheia no diálogo comum.
 * opts: { title, subtitle, help:[chave, rótulo], menus: () => [{ id, label, items: () => [...] }], tools: [{ id, label, tip, icon, key, group,
 * basic, hidden(), disabled() → motivo|null, pressed(), action }], groups: [{ id, label }], panels: [{ id, title, basic, open }],
 * actions: html extra no topo, keys: { "mod+z": fn, … }, isDirty(), onTool(id), onClose(), onSize() (tamanho clicável na barra de estado) }.
 * A câmera (`setCamera`) pode expor `ruler()` → { x, y, cellPx, cellUnits, unit } | null: origem da área visível em coordenadas
 * da janela, pixels de tela por casa, metros (ou pixels) por casa e a unidade; sem ele, as réguas ficam ocultas.
 * Opcionais no mesmo objeto: `onScale()` abre o ajuste da escala do editor; `scaleReason` explica quando ela não pode mudar.
 *
 * Contextos de trabalho (ADR-086), opcionais: `kind` (ex. "image", "tiles", "scene": chave das preferências visuais),
 * `contexts: [{ id, label?, tools?:[ids], groups?:[ids], panels?:[ids], defaultTool? }]` (ids de `EDITOR_CONTEXTS`),
 * `commonTools: [ids]` (em todos os contextos), `defaultContext`, `onContext(id)`. Ferramenta/painel pode declarar
 * `context: id | [ids] | "*"`; sem contexto declarado aparece em todos. Trocar o contexto só reorganiza a interface.
 * `contextBar: true` reserva a barra contextual de propriedades (API `shell.contextBar`).
 */
export function createEditorShell(opts) {
  const uid = ++shellSequence;
  let mode = interfaceMode(), tool = opts.initialTool || opts.tools[0]?.id, camera = null, closed = false, resolveClosed;
  const whenClosed = new Promise((r) => (resolveClosed = r));
  const kind = /^[a-z][a-z0-9-]{0,23}$/.test(String(opts.kind || "")) ? opts.kind : "editor";
  const contexts = normalizeContexts(opts.contexts);
  const commonTools = (opts.commonTools || []).map(String);
  modal(opts.title, `<div class="ed-shell" data-interface="${mode}" data-panels="open" data-kind="${esc(kind)}"${opts.contextBar ? ' data-contextbar="top"' : ""}>
    <header class="ed-top">
      <div class="ed-brand"><strong class="ed-title" data-ed-title></strong><small class="ed-sub" data-ed-sub></small></div>
      <nav class="ed-menubar" role="menubar" aria-label="Menus do editor" data-ed-menubar></nav>
      ${contexts.length ? `<nav class="ed-contexts" role="toolbar" aria-label="Contexto de trabalho (Alt+1 a Alt+6)" data-ed-contexts></nav>${helpButton("campanhas.editor.contextos", "Contextos, barra de propriedades e layout")}` : ""}
      <div class="ed-top-actions">${opts.actions || ""}${interfaceToggle("ed-interface")}
        <button type="button" class="ed-icon-button" data-ed="maximize" aria-pressed="false" aria-label="Maximizar a área de edição (Ctrl+\\)" data-tip="Maximizar a área de edição" data-tip-detail="Esconde painéis e réguas temporariamente. Ctrl+\\ alterna.">${icon("maximize")}</button>
        <button type="button" class="ed-icon-button" data-ed="panels" aria-pressed="true" aria-label="Mostrar ou ocultar painéis">${icon("panels")}</button>
        <button type="button" class="ed-icon-button" data-ed="fullscreen" aria-pressed="false" aria-label="Tela cheia">${icon("fullscreen")}</button>
        <button type="button" class="ed-icon-button" data-ed="close" aria-label="Fechar editor">${icon("close")}</button>
      </div>
    </header>
    <div class="ed-body">
      <nav class="ed-tools" role="toolbar" aria-orientation="vertical" aria-label="Ferramentas" data-ed-tools></nav>
      <div class="ed-canvas-area" data-rulers="on">
        ${opts.contextBar ? '<div class="ed-contextbar" role="toolbar" aria-label="Propriedades do selecionado" data-ed-contextbar></div>' : ""}
        <button type="button" class="ed-ruler-corner" data-ed="scale" data-ed-ruler-unit aria-label="Escala da régua"></button>
        <canvas class="ed-ruler ed-ruler-x" aria-hidden="true" data-ed-ruler="x"></canvas>
        <canvas class="ed-ruler ed-ruler-y" aria-hidden="true" data-ed-ruler="y"></canvas>
        <section class="ed-stage" aria-label="Área de edição" data-ed-stage></section>
      </div>
      <div class="ed-resizer" role="separator" aria-orientation="vertical" aria-label="Largura dos painéis" tabindex="0" aria-valuemin="220" aria-valuemax="520" data-ed-resizer></div>
      <aside class="ed-panels" aria-label="Painéis" data-ed-panels>${opts.panels.map((p) => `<section class="ed-panel" data-panel="${esc(p.id)}" data-basic="${p.basic !== false}" data-open="${p.open !== false}"><h2 class="ed-panel-title"><button type="button" data-ed-panel-toggle="${esc(p.id)}" aria-expanded="${p.open !== false}">${esc(p.title)}</button>${p.help ? helpButton(p.help[0], p.help[1]) : ""}<button type="button" class="ed-icon-button ed-panel-menu" data-ed-panel-menu="${esc(p.id)}" aria-haspopup="menu" aria-label="Opções do painel ${esc(p.title)}">${icon("dots")}</button></h2><div class="ed-panel-body" data-panel-body="${esc(p.id)}"></div></section>`).join("")}</aside>
    </div>
    <footer class="ed-status" data-ed-status>
      <div class="ed-zoom" role="group" aria-label="Zoom"><button type="button" class="ed-icon-button" data-ed-zoom="out" aria-label="Afastar (Ctrl −)">−</button><button type="button" class="ed-zoom-value" data-ed-zoom="fit" aria-label="Ajustar à tela (Ctrl 0)"><span data-ed-zoom-label>100%</span></button><button type="button" class="ed-icon-button" data-ed-zoom="in" aria-label="Aproximar (Ctrl +)">+</button><button type="button" class="subtle small" data-ed-zoom="actual">100%</button></div>
      <span class="ed-status-cell" data-ed-coords aria-label="Posição do cursor"></span>
      ${opts.onSize ? `<button type="button" class="ed-status-cell ed-size-button" data-ed-size data-ed="size" data-tip="Alterar o tamanho" data-tip-detail="Abre o tamanho do documento: largura e altura da área visível."></button>` : '<span class="ed-status-cell" data-ed-size></span>'}
      <button type="button" class="ed-status-cell ed-scale-button" data-ed="scale" data-ed-scale hidden></button>
      <span class="ed-status-cell ed-state" data-ed-state></span>
      <span class="ed-status-cell ed-draft-state" data-ed-draft></span>
      <span class="ed-status-msg" role="status" aria-live="polite" data-ed-message></span>
      ${opts.help ? `<span class="ed-status-help">${helpButton(opts.help[0], opts.help[1])}</span>` : ""}
    </footer>
  </div>`);
  const dialog = $("#modal");
  dialog.classList.add("editor-modal");
  const root = dialog.querySelector(".ed-shell");
  const q = (sel) => root.querySelector(sel);
  const stage = q("[data-ed-stage]");
  setTitle(opts.title, opts.subtitle || "");

  // Preferências de layout (só visuais, por conta neste navegador; ADR-086): largura, painéis recolhidos e ordem,
  // réguas, barra de propriedades e último contexto por tipo de editor. Nunca entram no documento.
  const PREF = layoutPrefKey(state.user?.id);
  const readPref = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
  let pref = normalizeLayoutPref(readPref(PREF) ?? readPref("eternnus.editor.layout") ?? {});
  const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch { /* armazenamento indisponível */ } };
  if (pref.width) root.style.setProperty("--ed-panel-width", `${pref.width}px`);
  const defaultClosed = opts.panels.filter((p) => p.open === false).map((p) => p.id);
  applyPanelOrder();
  if (pref.closed?.length) for (const id of pref.closed) togglePanel(id, false, false);
  if (matchMedia("(max-width: 900px)").matches) setPanels(false);
  if (opts.contextBar && pref.bar) root.dataset.contextbar = pref.bar;

  function applyPanelOrder() {
    const host = q("[data-ed-panels]");
    for (const id of panelOrder(opts.panels.map((p) => p.id), pref.order?.[kind])) {
      const section = host.querySelector(`[data-panel="${CSS.escape(id)}"]`);
      if (section) host.append(section);
    }
  }
  function shiftPanel(id, delta) {
    const order = movePanel(panelOrder(opts.panels.map((p) => p.id), pref.order?.[kind]), id, delta);
    pref.order = { ...(pref.order || {}), [kind]: order }; savePref();
    applyPanelOrder();
    q(`[data-ed-panel-menu="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }
  /** Restaura o layout padrão: largura, painéis abertos e ordem, réguas, barra de propriedades e maximização. */
  function resetLayout() {
    pref = {}; savePref();
    root.style.removeProperty("--ed-panel-width");
    for (const p of opts.panels) togglePanel(p.id, !defaultClosed.includes(p.id), false);
    applyPanelOrder();
    setMaximized(false);
    setRulers(true);
    if (opts.contextBar) root.dataset.contextbar = "top";
    setPanels(!matchMedia("(max-width: 900px)").matches);
    message("Layout padrão restaurado. O documento não mudou.");
  }

  // Topo sem cortes: mede o transbordo e compacta em etapas (ícones nos contextos → ações compactas → segunda linha).
  // Recalcula a cada redimensionamento e quando o conteúdo do topo muda (ações, contextos, título).
  const topBar = q(".ed-top"), narrow = matchMedia("(max-width: 900px), (max-width: 1200px) and (pointer: coarse)");
  function fitTop() {
    delete topBar.dataset.compact;
    if (closed || narrow.matches) return;
    for (const level of ["1", "2", "3"]) {
      if (topBar.scrollWidth <= topBar.clientWidth + 1) return;
      topBar.dataset.compact = level;
    }
  }
  const topFit = (() => {
    const resize = new ResizeObserver(() => fitTop());
    const mutate = new MutationObserver(() => fitTop());
    resize.observe(topBar);
    mutate.observe(topBar, { childList: true, subtree: true, characterData: true });
    return { disconnect: () => { resize.disconnect(); mutate.disconnect(); } };
  })();

  function setTitle(title, sub = "") { q("[data-ed-title]").textContent = title; q("[data-ed-sub]").textContent = sub; $("#modal-title").textContent = title; }
  function setPanels(open) { root.dataset.panels = open ? "open" : "closed"; q('[data-ed="panels"]').setAttribute("aria-pressed", String(open)); }
  function togglePanel(id, open, persist = true) {
    const section = q(`[data-panel="${CSS.escape(id)}"]`); if (!section) return;
    const next = open ?? section.dataset.open !== "true";
    section.dataset.open = String(next);
    section.querySelector("[data-ed-panel-toggle]").setAttribute("aria-expanded", String(next));
    if (!persist) return;
    const closedSet = new Set(pref.closed || []);
    next ? closedSet.delete(id) : closedSet.add(id);
    pref.closed = [...closedSet]; savePref();
  }
  /** Maximizar a área de edição: esconde painéis, réguas e barras auxiliares. Temporário (não fica salvo). */
  function setMaximized(on) {
    root.dataset.maximized = on ? "on" : "off";
    q('[data-ed="maximize"]').setAttribute("aria-pressed", String(!!on));
    rulerSig = "";
  }
  const toggleMaximize = () => { const on = root.dataset.maximized !== "on"; setMaximized(on); message(on ? "Área de edição maximizada. Ctrl+\\ restaura." : "Painéis restaurados."); };

  // ---------- Contextos de trabalho (ADR-086) ----------
  // Só apresentação: filtram ferramentas e painéis. Seleção, câmera, histórico e alterações continuam como estão.
  const toolVisible = (t) => !(t.hidden?.()) && (mode === "complete" || t.basic !== false);
  let wantedContext = contexts.length ? (pref.contexts?.[kind] || opts.defaultContext || contexts[0].id) : null;
  let context = wantedContext;
  const shownContexts = () => availableContexts(contexts, opts.tools, toolVisible, commonTools);
  function effectiveContext() {
    if (!contexts.length) return null;
    const list = shownContexts();
    if (list.some((c) => c.id === wantedContext)) return wantedContext;
    return list[0]?.id || contexts[0].id;
  }
  const inContext = (t, id = context) => toolInContext(t, id, contexts, commonTools);
  function renderContexts() {
    const host = q("[data-ed-contexts]");
    if (!host) return;
    context = effectiveContext();
    const list = shownContexts();
    host.hidden = list.length < 2;
    host.innerHTML = list.map((c, i) => `<button type="button" class="ed-context${c.id === context ? " active" : ""}" data-ed-context="${esc(c.id)}" aria-pressed="${c.id === context}" data-tip="${esc(`${c.label} (Alt+${i + 1})`)}" data-tip-detail="${esc(c.tip)}" tabindex="${c.id === context ? 0 : -1}">${icon(c.icon)}<span>${esc(c.label)}</span></button>`).join("");
    for (const section of root.querySelectorAll("[data-panel]")) {
      const panel = opts.panels.find((p) => p.id === section.dataset.panel);
      section.dataset.ctxHidden = String(!!panel && !panelInContext(panel, context, contexts));
    }
    root.dataset.context = context || "";
  }
  /** Troca o contexto. `user` = escolha explícita (fica salva para este tipo de editor). Mantém a ferramenta se ela continua visível. */
  function setContext(id, { user = true, keepTool = false } = {}) {
    const c = contexts.find((x) => x.id === id);
    if (!c) return;
    wantedContext = id;
    if (user) { pref.contexts = { ...(pref.contexts || {}), [kind]: id }; savePref(); }
    renderContexts();
    if (!keepTool) {
      const candidates = opts.tools.filter((t) => toolVisible(t) && inContext(t, context) && !t.disabled?.());
      const next = toolAfterContext(tool, candidates, c.defaultTool);
      if (next !== tool) { tool = next; opts.onTool?.(next, false); }
    }
    renderTools();
    opts.onContext?.(context);
    if (user) message(`Contexto: ${c.label}. Seleção, zoom e alterações continuam como estavam.`);
  }
  /** Se a ferramenta pedida está fora do contexto atual (atalho de letra, ação do editor), vai ao primeiro contexto que a mostra. */
  function revealTool(t) {
    if (!contexts.length || inContext(t)) return;
    const target = shownContexts().find((c) => inContext(t, c.id));
    if (target) setContext(target.id, { user: false, keepTool: true });
  }

  // ---------- Menus ----------
  function renderMenus() {
    const menus = opts.menus();
    q("[data-ed-menubar]").innerHTML = menus.map((m, i) => `<button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" data-ed-menu="${i}" tabindex="${i === 0 ? 0 : -1}">${esc(m.label)}</button>`).join("");
  }
  /** Itens de layout acrescentados ao fim do menu Exibir de qualquer editor (ADR-086). */
  function layoutMenuItems() {
    const items = [{ separator: true }];
    if (contexts.length) items.push({ label: "Contexto de trabalho", items: shownContexts().map((c, i) => ({ label: c.label, shortcut: `alt+${i + 1}`, checked: c.id === context, run: () => setContext(c.id) })) });
    items.push({ label: "Maximizar área de edição", shortcut: "mod+\\", checked: root.dataset.maximized === "on", run: toggleMaximize });
    if (opts.contextBar) items.push({ label: "Barra de propriedades", items: [["top", "Acima da área de edição"], ["bottom", "Abaixo da área de edição"], ["off", "Oculta"]].map(([v, label]) => ({ label, checked: root.dataset.contextbar === v, run: () => { root.dataset.contextbar = v; pref.bar = v; savePref(); rulerSig = ""; } })) });
    items.push({ label: "Restaurar layout padrão", run: resetLayout, hint: "Painéis, larguras e barras; o documento não muda" });
    return items;
  }
  function openMenu(index) {
    const menus = opts.menus(), bar = q("[data-ed-menubar]"), buttons = [...bar.querySelectorAll("[data-ed-menu]")];
    const i = (index + menus.length) % menus.length, button = buttons[i];
    if (!button) return;
    buttons.forEach((b) => b.setAttribute("aria-expanded", "false"));
    button.setAttribute("aria-expanded", "true");
    button.focus();
    const menuItems = menus[i].id === "view" ? [...menus[i].items(), ...layoutMenuItems()] : menus[i].items();
    openContextMenu(button, menuItems, {
      label: menus[i].label, onClose: () => button.setAttribute("aria-expanded", "false"),
      onKey: (e) => { if (e.key === "ArrowRight" && !e.target.getAttribute("aria-haspopup")) { e.preventDefault(); openMenu(i + 1); return true; } if (e.key === "ArrowLeft") { e.preventDefault(); openMenu(i - 1); return true; } return false; },
    });
  }
  q("[data-ed-menubar]").addEventListener("click", (e) => { const b = e.target.closest("[data-ed-menu]"); if (b) openMenu(Number(b.dataset.edMenu)); });
  q("[data-ed-menubar]").addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-ed-menu]"); if (!b) return;
    const all = [...q("[data-ed-menubar]").querySelectorAll("[data-ed-menu]")], i = all.indexOf(b);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const n = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length]; all.forEach((x) => (x.tabIndex = -1)); n.tabIndex = 0; n.focus(); }
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openMenu(i); }
  });

  // ---------- Ferramentas ----------
  const visibleTools = () => opts.tools.filter((t) => toolVisible(t) && inContext(t));
  function renderTools() {
    renderContexts();
    const tools = visibleTools();
    const groups = opts.groups || [{ id: "", label: "" }];
    const html = groups.map((g) => {
      const list = tools.filter((t) => (t.group || "") === g.id);
      if (!list.length) return "";
      return `<div class="ed-tool-group" role="group" aria-label="${esc(g.label || "Ferramentas")}">${list.map((t) => {
        const reason = t.disabled?.() || null;
        const pressed = t.pressed ? t.pressed() : t.id === tool;
        const name = `${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ""}`;
        // Dica ao passar o mouse ou focar: nome e atalho em destaque e, em letras menores, o que fazer com a ferramenta
        // (ou por que ela está indisponível agora). O motivo também fica no nome acessível descrito.
        const detail = tipDetail(reason ? `Indisponível agora: ${reason}` : t.tip);
        const reasonId = `ed-${uid}-why-${t.id}`;
        return `<button type="button" class="ed-tool${pressed ? " active" : ""}" data-ed-tool="${esc(t.id)}" aria-pressed="${!!pressed}" aria-label="${esc(name)}" data-tip="${esc(name)}" data-tip-side="right"${detail ? ` data-tip-detail="${esc(detail)}"` : ""} ${reason ? `aria-disabled="true" aria-describedby="${esc(reasonId)}"` : ""} tabindex="-1">${icon(t.icon)}<span class="ed-tool-label">${esc(t.label)}</span>${reason ? `<span class="sr-only" id="${esc(reasonId)}">${esc(reason)}</span>` : ""}</button>`;
      }).join("")}</div>`;
    }).join("");
    const host = q("[data-ed-tools]");
    host.innerHTML = html;
    const current = host.querySelector(".ed-tool.active") || host.querySelector(".ed-tool");
    if (current) current.tabIndex = 0;
  }
  function useTool(id, fromKey = false) {
    const t = opts.tools.find((x) => x.id === id);
    if (!t || t.hidden?.()) return;
    if (mode !== "complete" && t.basic === false) return;
    const reason = t.disabled?.();
    if (reason) { message(reason); return; }
    revealTool(t);
    if (t.action) { t.action(); renderTools(); return; }
    tool = id;
    renderTools();
    opts.onTool?.(id, fromKey);
  }
  q("[data-ed-tools]").addEventListener("click", (e) => { const b = e.target.closest("[data-ed-tool]"); if (b) useTool(b.dataset.edTool); });
  q("[data-ed-contexts]")?.addEventListener("click", (e) => { const b = e.target.closest("[data-ed-context]"); if (b) setContext(b.dataset.edContext); });
  q("[data-ed-contexts]")?.addEventListener("keydown", (e) => {
    const all = [...q("[data-ed-contexts]").querySelectorAll("[data-ed-context]")], i = all.indexOf(document.activeElement);
    if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length;
    all.forEach((x) => (x.tabIndex = -1)); all[n].tabIndex = 0; all[n].focus();
  });
  q("[data-ed-tools]").addEventListener("keydown", (e) => {
    const all = [...q("[data-ed-tools]").querySelectorAll("[data-ed-tool]")], i = all.indexOf(document.activeElement);
    if (i < 0) return;
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const n = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length;
      all.forEach((x) => (x.tabIndex = -1)); all[n].tabIndex = 0; all[n].focus();
    }
  });

  // ---------- Painéis ----------
  root.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-ed-panel-toggle]");
    if (toggle) togglePanel(toggle.dataset.edPanelToggle);
    const panelMenu = e.target.closest("[data-ed-panel-menu]");
    if (panelMenu) {
      const id = panelMenu.dataset.edPanelMenu, order = panelOrder(opts.panels.map((p) => p.id), pref.order?.[kind]);
      const open = q(`[data-panel="${CSS.escape(id)}"]`)?.dataset.open === "true", i = order.indexOf(id);
      openContextMenu(panelMenu, [
        { label: open ? "Recolher" : "Expandir", run: () => togglePanel(id, !open) },
        { label: "Mover para cima", run: () => shiftPanel(id, -1), disabled: i <= 0 },
        { label: "Mover para baixo", run: () => shiftPanel(id, 1), disabled: i >= order.length - 1 },
        { separator: true },
        { label: "Restaurar layout padrão", run: resetLayout },
      ], { label: "Opções do painel" });
    }
    const action = e.target.closest("[data-ed]")?.dataset.ed;
    if (action === "maximize") toggleMaximize();
    if (action === "panels") setPanels(root.dataset.panels !== "open");
    if (action === "fullscreen") toggleFullscreen();
    if (action === "close") requestClose();
    if (action === "size") opts.onSize?.();
    if (action === "scale") openScale();
    const zoom = e.target.closest("[data-ed-zoom]")?.dataset.edZoom;
    if (zoom && camera) { ({ in: () => camera.zoomIn(), out: () => camera.zoomOut(), fit: () => camera.fit(), actual: () => camera.actual() })[zoom]?.(); updateZoom(); }
  });
  const resizer = q("[data-ed-resizer]");
  let resizing = null;
  const setWidth = (w) => { const width = Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, Math.round(w))); root.style.setProperty("--ed-panel-width", `${width}px`); resizer.setAttribute("aria-valuenow", String(width)); pref.width = width; savePref(); };
  resizer.addEventListener("pointerdown", (e) => { resizing = { x: e.clientX, w: q("[data-ed-panels]").offsetWidth, id: e.pointerId }; resizer.setPointerCapture(e.pointerId); });
  resizer.addEventListener("pointermove", (e) => { if (resizing && e.pointerId === resizing.id) setWidth(resizing.w - (e.clientX - resizing.x)); });
  resizer.addEventListener("pointerup", () => { resizing = null; });
  resizer.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWidth(q("[data-ed-panels]").offsetWidth + (e.key === "ArrowLeft" ? 16 : -16)); } });

  // ---------- Barra contextual de propriedades (ADR-086) ----------
  // Faixa fixa acima (ou abaixo) da área de edição com os campos simples do selecionado, sem abrir janela.
  // A altura é reservada mesmo sem seleção: mostrar/esconder não redimensiona o canvas (sem custo de redesenho).
  // Campos: { name, label, type: number|text|select|checkbox|color, value, min, max, step, unit, options:[[v, rótulo]], disabled, wide }.
  // Ações: { id, label, icon, disabled, danger }. `onChange(name, valor)` e `onAction(id)` ficam a cargo do editor (histórico).
  const contextBar = (() => {
    const host = q("[data-ed-contextbar]");
    let current = null;
    const hint = opts.contextBarHint || "Selecione um elemento para editar aqui as propriedades simples.";
    const fieldId = (name) => `ed-${uid}-cb-${String(name).replace(/[^a-zA-Z0-9_-]/g, "")}`;
    function fieldHtml(f) {
      const id = fieldId(f.name), dis = f.disabled ? "disabled" : "";
      const label = `<span>${esc(f.label)}${f.unit ? ` <small>${esc(f.unit)}</small>` : ""}</span>`;
      if (f.type === "checkbox") return `<label class="ed-cb-field ed-cb-check" for="${id}"><input type="checkbox" id="${id}" name="${esc(f.name)}" ${f.value ? "checked" : ""} ${dis}>${label}</label>`;
      if (f.type === "select") return `<label class="ed-cb-field" for="${id}">${label}<select id="${id}" name="${esc(f.name)}" ${dis}>${(f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
      const type = f.type === "number" ? "number" : f.type === "color" ? "color" : "text";
      const range = type === "number" ? `${f.min != null ? `min="${Number(f.min)}"` : ""} ${f.max != null ? `max="${Number(f.max)}"` : ""} step="${f.step != null ? Number(f.step) : "any"}" inputmode="decimal"` : "";
      return `<label class="ed-cb-field${f.wide ? " wide" : ""}" for="${id}">${label}<input type="${type}" id="${id}" name="${esc(f.name)}" ${range} ${f.maxlength ? `maxlength="${Number(f.maxlength)}"` : ""} ${dis}></label>`;
    }
    const fmtValue = (f, v) => (v == null ? "" : f.type === "number" ? String(Math.round(Number(v) * 100) / 100) : String(v));
    function writeValues(values, force = false) {
      if (!host || !current) return;
      for (const f of current.fields) {
        if (!(f.name in values)) continue;
        const input = host.querySelector(`[name="${CSS.escape(f.name)}"]`);
        if (!input || (!force && input === document.activeElement)) continue;
        f.value = values[f.name];
        if (f.type === "checkbox") input.checked = !!f.value;
        else input.value = fmtValue(f, f.value);
      }
    }
    function empty() {
      if (!host) return;
      current = null;
      host.dataset.empty = "true";
      host.innerHTML = `<p class="ed-cb-hint">${esc(hint)}</p>`;
    }
    function show(spec) {
      if (!host) return;
      const focused = host.contains(document.activeElement);
      if (current && spec.key && current.key === spec.key && focused) { current.onChange = spec.onChange; current.onAction = spec.onAction; writeValues(Object.fromEntries((spec.fields || []).map((f) => [f.name, f.value]))); return; }
      current = { key: spec.key || "", fields: (spec.fields || []).map((f) => ({ ...f })), onChange: spec.onChange, onAction: spec.onAction };
      host.dataset.empty = "false";
      const actions = (spec.actions || []).map((a) => `<button type="button" class="ed-icon-button${a.danger ? " danger" : ""}" data-cb-action="${esc(a.id)}" aria-label="${esc(a.label)}" data-tip="${esc(a.label)}" ${a.disabled ? 'aria-disabled="true"' : ""}>${icon(a.icon || "object")}</button>`).join("");
      host.innerHTML = `<span class="ed-cb-title">${spec.icon ? icon(spec.icon) : ""}<span>${esc(spec.title || "")}</span></span><div class="ed-cb-fields">${current.fields.map(fieldHtml).join("")}</div>${actions ? `<div class="ed-cb-actions" role="group" aria-label="Ações rápidas">${actions}</div>` : ""}`;
      writeValues(Object.fromEntries(current.fields.map((f) => [f.name, f.value])), true);
    }
    host?.addEventListener("change", (e) => {
      const f = current?.fields.find((x) => x.name === e.target.name);
      if (!f) return;
      let value = e.target.value;
      if (f.type === "checkbox") value = e.target.checked;
      else if (f.type === "number") {
        value = Number(e.target.value);
        if (e.target.value === "" || !Number.isFinite(value)) { writeValues({ [f.name]: f.value }, true); return; }
        if (f.min != null) value = Math.max(Number(f.min), value);
        if (f.max != null) value = Math.min(Number(f.max), value);
      }
      f.value = value;
      Promise.resolve().then(() => current?.onChange?.(f.name, value)).catch((err) => message(err?.message || String(err)));
    });
    host?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cb-action]");
      if (!b) return;
      if (b.getAttribute("aria-disabled") === "true") return;
      current?.onAction?.(b.dataset.cbAction);
    });
    host?.addEventListener("keydown", (e) => {
      // Enter confirma o campo e devolve o foco ao palco; Esc desiste da digitação.
      if (e.key === "Enter" && e.target.matches("input:not([type=checkbox])")) { e.target.blur(); stage.querySelector("canvas, [tabindex]")?.focus({ preventScroll: true }); }
    });
    empty();
    return {
      /** Mostra os campos do selecionado. Mesma `key` com o foco na barra só atualiza valores (não rouba o foco). */
      show,
      /** Atualiza valores (durante arrastes) sem mexer no campo em edição. */
      update: (values) => writeValues(values),
      /** Sem seleção: mostra a dica (a faixa continua com a mesma altura). */
      hide: empty,
      get available() { return !!host; },
    };
  })();

  // ---------- Barra de estado ----------
  function updateZoom() { if (camera) q("[data-ed-zoom-label]").textContent = zoomLabel(camera.zoom()); }
  let messageTimer = 0;
  function message(text) { const el = q("[data-ed-message]"); el.textContent = text || ""; clearTimeout(messageTimer); if (text) messageTimer = setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 6000); }
  /** `state` é HTML já escapado pelo editor (selos fixos); coordenadas e tamanho são texto. */
  function setStatus({ coords, size, state } = {}) {
    if (coords !== undefined) q("[data-ed-coords]").textContent = coords || "";
    if (size !== undefined) {
      const cell = q("[data-ed-size]");
      cell.textContent = size || "";
      if (opts.onSize) cell.setAttribute("aria-label", size ? `Tamanho: ${size}. Alterar o tamanho` : "Alterar o tamanho");
    }
    if (state !== undefined) q("[data-ed-state]").innerHTML = state || "";
    updateZoom();
  }

  // ---------- Réguas ----------
  // Superior e esquerda, discretas, em metros pela grade (0 no canto da área visível; negativos na área externa).
  // Só redesenham quando a vista, o tamanho ou o cursor mudam; o laço de quadros para quando o editor fecha.
  const area = q(".ed-canvas-area"), rulerX = q('[data-ed-ruler="x"]'), rulerY = q('[data-ed-ruler="y"]'), rulerUnit = q("[data-ed-ruler-unit]");
  let pointer = null, rulerSig = "", rulerFrame = 0;
  if (pref.rulers === false) area.dataset.rulers = "off";
  const trackPointer = (e) => { pointer = { x: e.clientX, y: e.clientY }; };
  const forgetPointer = () => { pointer = null; };
  stage.addEventListener("pointermove", trackPointer, { passive: true });
  stage.addEventListener("pointerleave", forgetPointer);
  function paintRuler(canvas, rect, axis, origin, steps, cursor, unit = "") {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);
    const len = axis === "x" ? rect.width : rect.height, thick = axis === "x" ? rect.height : rect.width;
    const line = (pos, size) => { const p = Math.round(pos) + 0.5; if (axis === "x") { g.moveTo(p, thick); g.lineTo(p, thick - size); } else { g.moveTo(thick, p); g.lineTo(thick - size, p); } };
    g.strokeStyle = "rgba(216,208,180,.28)"; g.lineWidth = 1; g.beginPath();
    if (steps.minorPx > 0) {
      const first = Math.ceil(-origin / steps.minorPx), last = Math.floor((len - origin) / steps.minorPx);
      for (let i = first; i <= last; i++) line(origin + i * steps.minorPx, thick * 0.28);
    }
    g.stroke();
    g.strokeStyle = "rgba(216,208,180,.5)"; g.beginPath();
    const first = Math.floor(-origin / steps.majorPx), last = Math.ceil((len - origin) / steps.majorPx);
    for (let i = first; i <= last; i++) line(origin + i * steps.majorPx, thick * 0.62);
    g.stroke();
    g.fillStyle = "rgba(216,208,180,.62)"; g.font = "9px system-ui, sans-serif"; g.textBaseline = "top";
    for (let i = first; i <= last; i++) {
      const pos = origin + i * steps.majorPx;
      if (pos < -40 || pos > len + 4) continue;
      // O zero leva a unidade ("0 m"): deixa claro que a régua mede distância no mapa, não pixels da tela.
      const label = i === 0 && unit ? `0 ${unit}` : rulerLabel(i * steps.majorUnits);
      if (axis === "x") g.fillText(label, Math.round(pos) + 3, 2);
      else { g.save(); g.translate(2, Math.round(pos) - 3); g.rotate(-Math.PI / 2); g.textAlign = "left"; g.fillText(label, 0, 0); g.restore(); }
    }
    if (cursor != null && cursor >= 0 && cursor <= len) {
      g.strokeStyle = "rgba(241,215,156,.95)"; g.beginPath(); line(cursor, thick); g.stroke();
    }
  }
  // Escala da régua: o canto e a barra de estado dizem a unidade e quanto vale cada casa; clicar abre o ajuste do editor.
  const scaleButton = q("[data-ed-scale]");
  let scaleInfo = null, scaleSig = "";
  function scaleText(info) {
    if (!info) return { short: "", long: "" };
    if (info.unit === "m") {
      const v = rulerLabel(Number(info.cellUnits) || 0);
      return { short: `Régua em metros · 1 casa = ${v} m`, long: `Régua em metros: cada casa da grade representa ${v} m.` };
    }
    return { short: `Régua em ${info.unit || "unidades"}`, long: `Régua em ${info.unit === "px" ? "pixels da imagem (sem grade)" : info.unit || "unidades"}.` };
  }
  function updateScale(info) {
    scaleInfo = info;
    const sig = info ? [info.unit, info.cellUnits, !!info.onScale, info.scaleReason || ""].join("|") : "";
    if (sig === scaleSig) return;
    scaleSig = sig;
    const { short, long } = scaleText(info);
    const how = info?.onScale ? "Clique para mudar a escala." : info?.scaleReason || "";
    scaleButton.hidden = !info;
    scaleButton.textContent = short;
    rulerUnit.textContent = info?.unit || "";
    for (const el of [scaleButton, rulerUnit]) {
      el.setAttribute("aria-label", `${long} ${how}`.trim());
      el.dataset.tip = long;
      if (how) el.dataset.tipDetail = how; else delete el.dataset.tipDetail;
      el.setAttribute("aria-disabled", String(!info?.onScale));
    }
  }
  function openScale() {
    if (scaleInfo?.onScale) { setMaximized(false); scaleInfo.onScale(); return; }
    if (scaleInfo) message(scaleInfo.scaleReason || "A escala deste documento não pode ser alterada aqui.");
  }
  function drawRulers() {
    const info = camera?.ruler?.() || null;
    const steps = info && rulerSteps(info.cellPx, info.cellUnits);
    area.classList.toggle("ed-no-ruler", !steps);
    updateScale(steps ? info : null);
    if (!steps || area.dataset.rulers === "off" || !rulerX.offsetHeight) return;
    const rx = rulerX.getBoundingClientRect(), ry = rulerY.getBoundingClientRect();
    const sig = [info.x, info.y, info.cellPx, info.cellUnits, info.unit, rx.left, rx.width, ry.top, ry.height, pointer?.x, pointer?.y].join("|");
    if (sig === rulerSig) return;
    rulerSig = sig;
    paintRuler(rulerX, rx, "x", info.x - rx.left, steps, pointer ? pointer.x - rx.left : null, info.unit);
    paintRuler(rulerY, ry, "y", info.y - ry.top, steps, pointer ? pointer.y - ry.top : null, info.unit);
  }
  function rulerLoop() {
    rulerFrame = 0;
    if (closed) return;
    try { drawRulers(); } catch { /* régua é só apresentação: nunca derruba o editor */ }
    rulerFrame = requestAnimationFrame(rulerLoop);
  }
  rulerFrame = requestAnimationFrame(rulerLoop);
  function setRulers(on) {
    area.dataset.rulers = on ? "on" : "off";
    pref.rulers = !!on; savePref(); rulerSig = "";
  }

  // ---------- Tela cheia ----------
  function toggleFullscreen() {
    const on = document.fullscreenElement === dialog;
    (on ? document.exitFullscreen() : dialog.requestFullscreen?.())?.catch?.(() => message("Tela cheia indisponível neste navegador."));
  }
  const onFullscreen = () => q('[data-ed="fullscreen"]').setAttribute("aria-pressed", String(document.fullscreenElement === dialog));
  document.addEventListener("fullscreenchange", onFullscreen);

  // ---------- Teclado ----------
  let spaceHeld = false;
  function onKeyDown(e) {
    if (closed || !dialog.open) return;
    // Menus e a janela de propriedades tratam as próprias teclas.
    if (e.target.closest?.(".ed-menu, .ed-props")) return;
    const id = shortcutOf(e);
    const typing = isTypingTarget(e.target);
    if (typing && !FIELD_SAFE.has(id)) return;
    if (id === "space" && !typing) { if (!spaceHeld) { spaceHeld = true; camera?.setPanHold?.(true); root.classList.add("ed-space"); } e.preventDefault(); return; }
    // Contextos (Alt+1…) e maximizar (Ctrl+\): nunca dentro de campos de texto (ADR-086).
    const ctxIndex = typing ? -1 : contextShortcutIndex(e);
    if (ctxIndex >= 0 && contexts.length) { const c = shownContexts()[ctxIndex]; if (c) { e.preventDefault(); setContext(c.id); } return; }
    if (!typing && id === "mod+\\" && !opts.keys?.[id]) { e.preventDefault(); toggleMaximize(); return; }
    const cam = { "mod+0": () => camera?.fit(), "mod+1": () => camera?.actual(), "mod+plus": () => camera?.zoomIn(), "mod+minus": () => camera?.zoomOut() }[id];
    if (cam) { e.preventDefault(); cam(); updateZoom(); return; }
    const fn = opts.keys?.[id];
    // Ctrl+V não bloqueia a colagem nativa: o evento "paste" traz imagens do sistema (ADR-090); o editor decide no paste.
    if (fn) { if (id !== "mod+v") e.preventDefault(); e.stopPropagation(); fn(e); return; }
    if (id === "escape") { e.preventDefault(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && id.length === 1) {
      const t = opts.tools.find((x) => x.key && x.key.toLowerCase() === id);
      if (t) { e.preventDefault(); useTool(t.id, true); }
    }
  }
  function onKeyUp(e) { if ((e.key === " " || e.key === "Spacebar") && spaceHeld) { spaceHeld = false; camera?.setPanHold?.(false); root.classList.remove("ed-space"); } }
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  // ---------- Fechar com proteção ----------
  const beforeUnload = (e) => { if (opts.isDirty?.()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  const onCancel = (e) => { e.preventDefault(); }; // Esc pertence ao editor (cancelar ação), nunca fecha a janela.
  dialog.addEventListener("cancel", onCancel);
  const closeButton = $("#close-modal");
  const guardClose = (e) => { e.preventDefault(); e.stopImmediatePropagation(); requestClose(); };
  closeButton?.addEventListener("click", guardClose, true);
  async function requestClose() {
    if (opts.isDirty?.()) {
      if (!confirm("Fechar sem salvar? As alterações não salvas deste documento serão perdidas.")) return false;
      // Escolha explícita do mestre: o rascunho local também é descartado (editor-drafts.js). Outros fechamentos o guardam.
      root.dataset.discard = "1";
    }
    dialog.close();
    return true;
  }
  const disposeToggle = mountInterfaceToggle(root);
  // Busca de ações (ADR-100): as ferramentas do editor por nome; as da Completa trocam a interface ao escolher.
  const disposePalette = mountCommandPalette(root, {
    getContext: () => ({ role: "master", mode }),
    getCommands: () => opts.tools.filter((t) => !t.hidden?.()).map((t) => ({
      id: t.id, label: t.label, group: (opts.groups || []).find((g) => g.id === t.group)?.label || "Ferramentas", keywords: [t.tip || "", t.key ? `tecla ${t.key}` : ""],
      basic: t.basic !== false, disabled: t.disabled?.() || null,
    })),
    onRun: (c) => { if (c.needsComplete) setInterfaceMode("complete"); useTool(c.id); },
  });
  const stopMode = onInterfaceChange((next) => {
    mode = next; root.dataset.interface = next;
    const current = opts.tools.find((t) => t.id === tool);
    if (current && next !== "complete" && current.basic === false) tool = opts.tools.find((t) => t.basic !== false && !t.action)?.id || tool;
    renderTools();
    opts.onModeChange?.(next);
  });
  dialog.addEventListener("close", () => {
    disposePalette();
    closed = true;
    cancelAnimationFrame(rulerFrame);
    topFit.disconnect();
    closeAllMenus(false);
    document.querySelector(".ed-props")?.dispatchEvent(new Event("ed-close"));
    if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {});
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("fullscreenchange", onFullscreen);
    dialog.removeEventListener("cancel", onCancel);
    closeButton?.removeEventListener("click", guardClose, true);
    disposeToggle(); stopMode();
    dialog.classList.remove("editor-modal");
    opts.onClose?.();
    resolveClosed();
  }, { once: true });

  // Primeira pintura depois da montagem síncrona do editor: menus e ferramentas consultam estado declarado após a janela.
  let attempts = 0;
  const firstPaint = () => {
    if (closed) return;
    try { renderMenus(); renderTools(); }
    catch (error) { if (++attempts < 20) requestAnimationFrame(firstPaint); else throw error; }
  };
  queueMicrotask(firstPaint);
  return {
    root, stage, dialog, whenClosed,
    get tool() { return tool; },
    get mode() { return mode; },
    get spaceHeld() { return spaceHeld; },
    /** Contexto de trabalho efetivo (ou null sem contextos). */
    get context() { return context; },
    setContext: (id) => setContext(id),
    contextBar,
    toggleMaximize, resetLayout,
    panel: (id) => q(`[data-panel-body="${CSS.escape(id)}"]`),
    setTool: (id) => { const t = opts.tools.find((x) => x.id === id); if (t) revealTool(t); tool = id; renderTools(); },
    useTool,
    refreshTools: renderTools,
    refreshMenus: renderMenus,
    togglePanel, setPanels, setTitle, setStatus, message,
    /** Último salvamento / rascunho local (texto simples, ADR-083). */
    setDraftStatus: (text) => { q("[data-ed-draft]").textContent = text || ""; },
    /** Item de menu "Réguas" (Exibir), igual nos três editores. */
    rulersMenuItem: () => ({ label: "Réguas", checked: area.dataset.rulers !== "off", run: () => setRulers(area.dataset.rulers === "off") }),
    setCamera(adapter) { camera = adapter; updateZoom(); },
    updateZoom,
    requestClose,
    close: () => dialog.close(),
  };
}
