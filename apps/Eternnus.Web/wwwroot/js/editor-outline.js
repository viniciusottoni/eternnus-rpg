// Árvore unificada da barra lateral (ADR-118): camadas e os elementos de cada uma numa só hierarquia.
// Substitui os antigos painéis separados de Camadas e Estrutura nos três editores. Só apresentação e eventos:
// cada editor decide o que cada ação faz (histórico, permissões, regras de camada). Não faz chamadas HTTP.
//
// renderOutline(host, spec) — pode ser chamada a cada mudança; preserva foco, rolagem e o ramo recolhido.
// spec: {
//   label, sections: [{ id, label?, note?, layers: [Layer] }], collapsed: iterável de chaves "seção:camada",
//   complete (modo Completa), empty: { text, action?: { label, run } },
//   actions: [{ id, label, icon, reason?, run }]  (barra do topo: nova camada, localizar seleção…),
//   onToggle(key, collapsed), onLayer(action, layerId, value, sectionId)  (select|visible|lock|opacity|players),
//   layerMenu(layerId, sectionId) → itens do menu ⋯ da camada, onSelect(ids, mode, sectionId) (replace|toggle|range),
//   itemMenu(id, at, sectionId), onLocate(id, sectionId), onMove(ids, layerId, sectionId),
//   onReorder?(ids, targetId, "before"|"after", sectionId), onRename?(id, nome, sectionId)
// }
// Layer: { id, name, icon?, active, fixed, readonly, accepts, visible (null = sem controle), locked (null = sem controle),
//   opacity (null = sem controle), players ("all" | "master" | null), visibleTip, playersTip, readonlyAction?: { label, icon, run },
//   note?, emptyText?, items: [Item] }
// Item: { id, label, icon, meta, hidden, playerHidden, locked, selected, outside ("" | "partial" | "outside"), movable, renamable }
import { esc, toast } from "./ui.js";
import { icon } from "./icons.js";
import { openContextMenu } from "./editor-core.js";
import { outlineDropProblem, rangeIds } from "./editor-policy.js";

const DND = "application/x-eternnus-outline";
const memory = new WeakMap(); // host → { anchor, selectionSig, spec }
let dragging = null;

const keyOf = (sectionId, layerId) => `${sectionId}:${layerId}`;
const tip = (label, detail = "") => `data-tip="${esc(label)}"${detail ? ` data-tip-detail="${esc(detail)}"` : ""}`;

function layerRow(section, l, open) {
  const key = keyOf(section.id, l.id), count = l.items?.length || 0;
  const controls = [];
  if (l.visible != null) controls.push(`<button type="button" class="ed-icon-button o-ctl${l.visible ? "" : " off"}" data-o-layer="visible" aria-pressed="${!l.visible}" aria-label="${l.visible ? "Ocultar no editor" : "Mostrar no editor"}: ${esc(l.name)}" ${tip(l.visible ? "Visível no editor" : "Oculta no editor", l.visibleTip || "Só muda o que você vê ao preparar.")}>${icon(l.visible ? "eye" : "eyeOff")}</button>`);
  if (l.locked != null) controls.push(`<button type="button" class="ed-icon-button o-ctl${l.locked ? " on" : ""}" data-o-layer="lock" aria-pressed="${!!l.locked}" aria-label="${l.locked ? "Desbloquear" : "Bloquear"}: ${esc(l.name)}" ${tip(l.locked ? "Bloqueada" : "Desbloqueada", l.locked ? "Elementos desta camada não podem ser selecionados nem movidos." : "Clique para impedir mudanças acidentais nesta camada.")}>${icon(l.locked ? "lock" : "unlock")}</button>`);
  if (l.players != null) {
    const master = l.players === "master";
    controls.push(`<button type="button" class="ed-icon-button o-ctl o-players${master ? " master" : ""}" data-o-layer="players" aria-pressed="${master}" aria-label="${master ? "Só o mestre vê" : "Jogadores veem"}: ${esc(l.name)}. Alterna a visibilidade para os jogadores." ${tip(master ? "Só o mestre vê" : "Jogadores veem", l.playersTip || "Visibilidade para os jogadores na sessão. Diferente de ocultar no editor.")}>${icon(master ? "master" : "players")}</button>`);
  }
  const flags = [
    l.readonly ? `<span class="o-chip">Somente leitura</span>` : "",
    l.opacity != null && l.opacity < 100 ? `<span class="o-chip" aria-label="opacidade ${Number(l.opacity)}%">${Number(l.opacity)}%</span>` : "",
  ].join("");
  // Dica no nome (a coluna estreita corta): só no hover dele. `tabindex="-1"` evita que a ajuda crie parada de Tab
  // e a dica não abre ao refocar a linha depois de cada redesenho.
  const detail = [l.fixed ? "Camada fixa: não pode ser excluída nem reordenada." : "", l.readonly ? l.note || "Somente leitura: não pode ser editada aqui." : "", l.opacity != null ? `Opacidade no editor: ${Number(l.opacity)}% (menu ⋯).` : ""].filter(Boolean).join(" ");
  const ro = l.readonlyAction ? `<button type="button" class="subtle small o-ro-action" data-o-layer="readonly-action">${l.readonlyAction.icon ? icon(l.readonlyAction.icon) : ""}<span>${esc(l.readonlyAction.label)}</span></button>` : "";
  const expandable = count > 0 || l.emptyText;
  return `<div class="o-layer-row${l.active ? " active" : ""}${l.visible === false ? " is-hidden" : ""}${l.readonly ? " readonly" : ""}" role="treeitem" aria-level="1" ${expandable ? `aria-expanded="${open}"` : ""} aria-selected="${!!l.active}" tabindex="-1"${l.fixed ? ' data-fixed="true"' : ""} data-o-row="layer" data-o-key="${esc(key)}" data-o-section="${esc(section.id)}" data-o-layer-id="${esc(l.id)}">
    <button type="button" class="o-twisty" data-o-toggle tabindex="-1" aria-hidden="true" ${expandable ? "" : "disabled"}>${expandable ? icon("chevron") : ""}</button>
    <span class="o-layer-name" data-o-layer="select">${l.icon ? icon(l.icon) : ""}<span class="o-text" tabindex="-1" ${tip(l.name, detail)}>${esc(l.name)}</span>${count ? `<small class="o-count">${count}</small>` : ""}${flags}</span>
    <span class="o-ctls">${controls.join("")}${ro}${l.menu === false ? "" : `<button type="button" class="ed-icon-button o-more" data-o-layer="menu" aria-haspopup="menu" aria-label="Ações da camada ${esc(l.name)}" ${tip("Ações da camada")}>${icon("dots")}</button>`}</span>
  </div>`;
}

function itemRow(section, l, it) {
  const badges = [
    it.hidden ? `<span class="o-badge" ${tip("Oculto no editor")} aria-label="oculto no editor">${icon("eyeOff")}</span>` : "",
    it.playerHidden ? `<span class="o-chip master" ${tip("Oculto para os jogadores", "Só o mestre vê até revelar.")}>${icon("master")}<span>Mestre</span></span>` : "",
    it.locked ? `<span class="o-badge" ${tip("Bloqueado")} aria-label="bloqueado">${icon("lock")}</span>` : "",
    it.outside ? `<span class="o-badge warn" ${tip(it.outside === "outside" ? "Fora da área visível" : "Parcialmente fora da área visível", "A parte de fora não aparece no resultado.")} aria-label="${it.outside === "outside" ? "fora da área visível" : "parcialmente fora"}">${icon("warning")}</span>` : "",
  ].join("");
  return `<li class="o-item${it.selected ? " selected" : ""}${it.hidden ? " is-hidden" : ""}" role="treeitem" aria-level="2" aria-selected="${!!it.selected}" tabindex="-1" data-o-row="item" data-o-item="${esc(it.id)}" data-o-section="${esc(section.id)}" data-o-layer-id="${esc(l.id)}" ${it.movable === false ? "" : 'draggable="true"'}>
    ${icon(it.icon || "object")}<span class="o-text" tabindex="-1" ${tip(it.label)}>${esc(it.label)}${it.meta ? `<small>${esc(it.meta)}</small>` : ""}</span>${badges}
    <span class="o-item-acts"><button type="button" class="ed-icon-button" data-o-item-act="locate" tabindex="-1" aria-label="Localizar no mapa: ${esc(it.label)}" ${tip("Localizar no mapa", "Enquadra o item sem movê-lo.")}>${icon("target")}</button><button type="button" class="ed-icon-button" data-o-item-act="menu" tabindex="-1" aria-haspopup="menu" aria-label="Ações de ${esc(it.label)}">${icon("dots")}</button></span>
  </li>`;
}

/** Desenha (ou redesenha) a árvore em `host`. Devolve nada; eventos ficam em propriedades `on*` do host (sem acumular). */
export function renderOutline(host, spec) {
  if (!host) return;
  const mem = memory.get(host) || { anchor: null, selectionSig: "", spec: null };
  memory.set(host, mem);
  mem.spec = spec;
  const collapsed = new Set(spec.collapsed || []);
  const sections = (spec.sections || []).filter((s) => s.layers?.length);
  const selected = sections.flatMap((s) => s.layers.flatMap((l) => (l.items || []).filter((i) => i.selected).map((i) => ({ s, l, i }))));
  const selectionSig = selected.map((x) => `${x.s.id}/${x.i.id}`).join(",");
  // Seleção vinda do canvas dentro de um ramo recolhido: o ramo abre para o item aparecer destacado.
  if (selectionSig && selectionSig !== mem.selectionSig) {
    for (const { s, l } of selected) {
      const k = keyOf(s.id, l.id);
      if (collapsed.delete(k)) spec.onToggle?.(k, false);
    }
  }
  const focusedKey = host.contains(document.activeElement) ? rowKey(document.activeElement.closest?.("[data-o-row]")) : null;
  const total = sections.reduce((n, s) => n + s.layers.reduce((m, l) => m + (l.items?.length || 0), 0), 0);
  const actions = (spec.actions || []).map((a) => `<button type="button" class="ed-icon-button" data-o-action="${esc(a.id)}" aria-label="${esc(a.label)}" ${tip(a.label, a.reason || a.tip || "")} ${a.reason ? 'aria-disabled="true"' : ""}>${icon(a.icon || "object")}</button>`).join("");
  const body = sections.map((s) => `<div class="o-section" role="group" aria-label="${esc(s.label || spec.label || "Camadas")}">${s.label ? `<p class="o-section-label">${esc(s.label)}${s.note ? `<small>${esc(s.note)}</small>` : ""}</p>` : ""}${s.layers.map((l) => {
    const open = !collapsed.has(keyOf(s.id, l.id));
    const items = l.items || [];
    return `<div class="o-layer" data-o-drop-layer="${esc(l.id)}" data-o-section="${esc(s.id)}">${layerRow(s, l, open)}${open ? (items.length ? `<ul class="o-items" role="group">${items.map((it) => itemRow(s, l, it)).join("")}</ul>` : l.emptyText ? `<p class="o-empty-layer">${esc(l.emptyText)}</p>` : "") : ""}</div>`;
  }).join("")}</div>`).join("");
  const empty = !total && spec.empty ? `<div class="o-empty"><p>${esc(spec.empty.text)}</p>${spec.empty.action ? `<button type="button" class="subtle small" data-o-empty>${esc(spec.empty.action.label)}</button>` : ""}</div>` : "";
  host.innerHTML = `${actions ? `<div class="o-toolbar" role="toolbar" aria-label="Ações da árvore">${actions}<span class="o-summary" aria-live="polite" data-text="${total ? `${total} ${total === 1 ? "elemento" : "elementos"}${selected.length ? ` · ${selected.length} selecionado${selected.length > 1 ? "s" : ""}` : ""}` : ""}">${total ? `${total} ${total === 1 ? "elemento" : "elementos"}${selected.length ? ` · ${selected.length} selecionado${selected.length > 1 ? "s" : ""}` : ""}` : ""}</span></div>` : ""}<div class="ed-outline" role="tree" aria-multiselectable="true" aria-label="${esc(spec.label || "Camadas e elementos")}">${body}</div>${empty}`;
  // Roving tabindex: o item focado antes, senão o primeiro selecionado, senão a camada ativa, senão a primeira linha.
  const rows = [...host.querySelectorAll("[data-o-row]")];
  const byKey = focusedKey && rows.find((r) => rowKey(r) === focusedKey);
  const current = byKey || host.querySelector(".o-item.selected") || host.querySelector(".o-layer-row.active") || rows[0];
  if (current) current.tabIndex = 0;
  if (byKey) byKey.focus({ preventScroll: true });
  if (selectionSig !== mem.selectionSig) {
    mem.selectionSig = selectionSig;
    host.querySelector(".o-item.selected")?.scrollIntoView?.({ block: "nearest" });
  }
  bind(host);
}

function rowKey(row) {
  if (!row) return null;
  return row.dataset.oRow === "item" ? `i:${row.dataset.oSection}:${row.dataset.oItem}` : `l:${row.dataset.oKey}`;
}
const specOf = (host) => memory.get(host)?.spec;
const layerOf = (spec, sectionId, layerId) => spec.sections.find((s) => s.id === sectionId)?.layers.find((l) => l.id === layerId);
const itemOf = (spec, sectionId, id) => spec.sections.find((s) => s.id === sectionId)?.layers.flatMap((l) => l.items || []).find((i) => i.id === id);
const visibleItemIds = (host, sectionId) => [...host.querySelectorAll(`.o-item[data-o-section="${CSS.escape(sectionId)}"]`)].map((r) => r.dataset.oItem);

function selectRow(host, row, e) {
  const spec = specOf(host), mem = memory.get(host);
  const section = row.dataset.oSection;
  if (row.dataset.oRow === "layer") { spec.onLayer?.("select", row.dataset.oLayerId, undefined, section); return; }
  const id = row.dataset.oItem;
  if (e?.shiftKey && mem.anchor?.section === section) { spec.onSelect?.(rangeIds(visibleItemIds(host, section), mem.anchor.id, id), "range", section); return; }
  const toggle = !!(e && (e.ctrlKey || e.metaKey));
  mem.anchor = { section, id };
  spec.onSelect?.([id], toggle ? "toggle" : "replace", section);
}

function toggleBranch(host, row, open) {
  const spec = specOf(host);
  const key = row.dataset.oKey;
  if (!key || !row.hasAttribute("aria-expanded")) return false;
  const isOpen = row.getAttribute("aria-expanded") === "true";
  const next = open ?? !isOpen;
  if (next === isOpen) return false;
  spec.onToggle?.(key, !next);
  return true;
}

function layerMenu(host, row, at) {
  const spec = specOf(host);
  const items = spec.layerMenu?.(row.dataset.oLayerId, row.dataset.oSection) || [];
  if (items.length) openContextMenu(at, items, { label: "Ações da camada" });
}
function itemMenu(host, row, at) {
  const spec = specOf(host);
  const s = row.dataset.oSection, id = row.dataset.oItem;
  if (!itemOf(spec, s, id)?.selected) spec.onSelect?.([id], "replace", s);
  spec.itemMenu?.(id, at, s);
}
function renameItem(host, row) {
  const spec = specOf(host), it = itemOf(spec, row.dataset.oSection, row.dataset.oItem);
  if (!spec.onRename || !it?.renamable) return false;
  const name = prompt("Novo nome (até 80 caracteres)", it.label || "");
  if (name != null && name.trim()) spec.onRename(it.id, name.trim().slice(0, 80), row.dataset.oSection);
  return true;
}
const pointAt = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 24, y: r.bottom }; };

function bind(host) {
  if (host.dataset.oBound) return;
  host.dataset.oBound = "1";
  host.addEventListener("click", (e) => {
    const spec = specOf(host);
    const action = e.target.closest("[data-o-action]");
    if (action) {
      const a = (spec.actions || []).find((x) => x.id === action.dataset.oAction);
      if (a?.reason) { toast(a.reason); return; }
      a?.run?.();
      return;
    }
    if (e.target.closest("[data-o-empty]")) { spec.empty?.action?.run?.(); return; }
    const row = e.target.closest("[data-o-row]");
    if (!row) return;
    if (e.target.closest("[data-o-toggle]")) { toggleBranch(host, row); return; }
    const itemAct = e.target.closest("[data-o-item-act]")?.dataset.oItemAct;
    if (itemAct === "locate") { spec.onLocate?.(row.dataset.oItem, row.dataset.oSection); return; }
    if (itemAct === "menu") { itemMenu(host, row, e.target.closest("button")); return; }
    const ctl = e.target.closest("[data-o-layer]")?.dataset.oLayer;
    if (ctl && ctl !== "select") {
      const l = layerOf(spec, row.dataset.oSection, row.dataset.oLayerId);
      if (ctl === "menu") { layerMenu(host, row, e.target.closest("button")); return; }
      if (ctl === "readonly-action") { l?.readonlyAction?.run?.(); return; }
      const reason = l?.reasons?.[ctl];
      if (reason) { toast(reason); return; }
      spec.onLayer?.(ctl, row.dataset.oLayerId, undefined, row.dataset.oSection);
      return;
    }
    selectRow(host, row, e);
  });
  host.addEventListener("dblclick", (e) => {
    const row = e.target.closest('[data-o-row="item"]');
    if (row && !e.target.closest("button")) renameItem(host, row);
    const layer = e.target.closest('[data-o-row="layer"] .o-layer-name');
    if (layer) { const r = layer.closest("[data-o-row]"); const spec = specOf(host); const l = layerOf(spec, r.dataset.oSection, r.dataset.oLayerId); if (l && !l.readonly && !l.reasons?.rename) { const name = prompt("Nome da camada (até 40 caracteres)", l.name); if (name != null && name.trim()) spec.onLayer?.("rename", l.id, name.trim().slice(0, 40), r.dataset.oSection); } }
  });
  host.addEventListener("contextmenu", (e) => {
    const row = e.target.closest("[data-o-row]");
    if (!row) return;
    e.preventDefault();
    if (row.dataset.oRow === "layer") layerMenu(host, row, { x: e.clientX, y: e.clientY });
    else itemMenu(host, row, { x: e.clientX, y: e.clientY });
  });
  host.addEventListener("keydown", (e) => {
    const row = e.target.closest?.("[data-o-row]");
    if (!row || e.target !== row) return;
    const rows = [...host.querySelectorAll("[data-o-row]")], i = rows.indexOf(row);
    const go = (n) => { const next = rows[Math.max(0, Math.min(rows.length - 1, n))]; if (!next) return null; rows.forEach((r) => (r.tabIndex = -1)); next.tabIndex = 0; next.focus(); return next; };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = go(i + (e.key === "ArrowDown" ? 1 : -1));
      if (e.shiftKey && next?.dataset.oRow === "item") selectRow(host, next, { shiftKey: true });
    } else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(rows.length - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (row.dataset.oRow === "layer" && !toggleBranch(host, row, true)) go(i + 1); }
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (row.dataset.oRow === "layer") toggleBranch(host, row, false);
      else row.closest(".o-layer")?.querySelector('[data-o-row="layer"]')?.focus();
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectRow(host, row, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey }); }
    else if (e.key === "F2") { e.preventDefault(); if (row.dataset.oRow === "item") renameItem(host, row); }
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); if (row.dataset.oRow === "layer") layerMenu(host, row, pointAt(row)); else itemMenu(host, row, pointAt(row)); }
    else if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && !e.altKey && row.dataset.oRow === "item") { e.preventDefault(); e.stopPropagation(); specOf(host).onLocate?.(row.dataset.oItem, row.dataset.oSection); }
  });

  // ---------- Arrastar entre camadas (e reordenar, quando o editor permite) ----------
  const clearMarks = () => host.querySelectorAll(".o-drop-into, .o-drop-before, .o-drop-after, .o-drop-no").forEach((el) => el.classList.remove("o-drop-into", "o-drop-before", "o-drop-after", "o-drop-no"));
  host.addEventListener("dragstart", (e) => {
    const row = e.target.closest?.('[data-o-row="item"]');
    if (!row || !e.dataTransfer) return;
    const spec = specOf(host), s = row.dataset.oSection;
    const it = itemOf(spec, s, row.dataset.oItem);
    const ids = it?.selected ? spec.sections.find((x) => x.id === s).layers.flatMap((l) => (l.items || []).filter((i) => i.selected).map((i) => ({ ...i, layer: l.id }))) : [{ ...it, layer: row.dataset.oLayerId }];
    dragging = { host, section: s, items: ids };
    e.dataTransfer.setData(DND, JSON.stringify(ids.map((i) => i.id)));
    e.dataTransfer.effectAllowed = "move";
    row.classList.add("o-dragging");
  });
  host.addEventListener("dragend", () => {
    dragging = null; clearMarks(); host.querySelector(".o-dragging")?.classList.remove("o-dragging");
    const hint = host.querySelector(".o-summary"); if (hint) hint.textContent = hint.dataset.text || "";
  });
  const targetOf = (e) => {
    if (!dragging || dragging.host !== host) return null;
    const spec = specOf(host);
    const itemRowEl = e.target.closest?.('[data-o-row="item"]');
    const box = e.target.closest?.("[data-o-drop-layer]");
    if (!box || box.dataset.oSection !== dragging.section) return { el: box || itemRowEl, problem: "Elementos só mudam de camada dentro do mesmo grupo." };
    const l = layerOf(spec, box.dataset.oSection, box.dataset.oDropLayer);
    if (itemRowEl && spec.onReorder && !dragging.items.some((i) => i.id === itemRowEl.dataset.oItem)) {
      const r = itemRowEl.getBoundingClientRect();
      const where = e.clientY < r.top + r.height / 2 ? "before" : "after";
      return { el: itemRowEl, mode: where, layer: l, targetId: itemRowEl.dataset.oItem, problem: outlineDropProblem(dragging.items, l ? { name: l.name, locked: l.locked, readonly: l.readonly, accepts: l.accepts } : null) };
    }
    const problem = dragging.items.every((i) => i.layer === l?.id) ? "Os itens já estão nesta camada." : outlineDropProblem(dragging.items, l ? { name: l.name, locked: l.locked, readonly: l.readonly, accepts: l.accepts } : null);
    return { el: box.querySelector('[data-o-row="layer"]'), mode: "into", layer: l, problem };
  };
  host.addEventListener("dragover", (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes(DND)) return;
    const t = targetOf(e);
    clearMarks();
    if (!t?.el) return;
    const hint = host.querySelector(".o-summary");
    if (t.problem) { t.el.classList.add("o-drop-no"); if (hint) hint.textContent = t.problem; e.dataTransfer.dropEffect = "none"; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hint) hint.textContent = t.mode === "into" ? `Soltar em ${t.layer?.name || "camada"}` : "Soltar aqui";
    t.el.classList.add(t.mode === "into" ? "o-drop-into" : t.mode === "before" ? "o-drop-before" : "o-drop-after");
  });
  host.addEventListener("dragleave", (e) => { if (!host.contains(e.relatedTarget)) clearMarks(); });
  host.addEventListener("drop", (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes(DND)) return;
    e.preventDefault();
    const t = targetOf(e), spec = specOf(host), d = dragging;
    clearMarks(); dragging = null;
    if (!t || !d) return;
    if (t.problem) { toast(t.problem); return; }
    const ids = d.items.map((i) => i.id);
    if (t.mode === "into") spec.onMove?.(ids, t.layer.id, d.section);
    else spec.onReorder?.(ids, t.targetId, t.mode, d.section);
  });
}
