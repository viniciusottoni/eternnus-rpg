// Editor de mapas de imagem (ADR-081) sobre o núcleo gráfico: área visível (artboard) + área externa, camadas,
// imagens/textos/formas com transformação, histórico e salvamento achatado (PNG/JPEG + composição numa única escrita).
// Só o mestre abre. Nada aqui apresenta ou aplica algo à mesa. Carregado sob demanda.
import { api } from "./api.js";
import { esc, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { createEditorShell, openContextMenu, openPropertiesDialog, renderHistoryPanel, renderLayersPanel, renderStructurePanel, icon } from "./editor-core.js";
import { addLayer, createHistory, isTypingTarget, moveLayer, patchLayer, removeLayer, clampMenu } from "./editor-policy.js";
import * as P from "./composition-policy.js";
import { createCompositionSurface, encodeFlat, flattenComposition, textHeight, textWidth } from "./composition-canvas.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TYPE_LABEL = { image: "Imagem", text: "Texto", rect: "Retângulo", ellipse: "Elipse" };
const TYPE_ICON = { image: "image", text: "text", rect: "rect", ellipse: "ellipse" };
const ANCHOR_LABEL = { tl: "Superior esquerda", t: "Superior centro", tr: "Superior direita", l: "Meio esquerda", c: "Centro", r: "Meio direita", bl: "Inferior esquerda", b: "Inferior centro", br: "Inferior direita" };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const G = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** Só a rota de imagem do acervo (mesma origem) entra em `src`. */
const SAFE_IMAGE = new RegExp(`^/api/campaigns/${G}/assets/maps/${G}/image$`);
const safeImage = (url) => (typeof url === "string" && SAFE_IMAGE.test(url) ? url : null);
let clipboard = null; // área de transferência interna (só elementos deste tipo de documento)

/** Folha de estilo do editor carregada sob demanda (CSP: só arquivos do próprio site). */
function ensureStyles() {
  for (const href of ["/editor.css", "/editor-image.css"]) {
    if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = href;
    document.head.append(link);
  }
}

const metaFrom = (map, summary) => ({
  name: String(map.name || ""), summary: String(summary ?? map.summary ?? ""),
  hasGrid: map.hasGrid !== false, freeMovement: !!map.freeMovement,
  gridPixels: Number(map.gridPixels) || 64, gridOffsetX: Number(map.gridOffsetX) || 0, gridOffsetY: Number(map.gridOffsetY) || 0,
  scaleMeters: Number(map.scaleMeters) || 1.5,
});
const elementLabel = (el) => el.name || (el.type === "text" ? String(el.text || "").replace(/\s+/g, " ").trim().slice(0, 32) || "Texto" : TYPE_LABEL[el.type]);
const fmt = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
const int = (n) => Math.round(n).toLocaleString("pt-BR");

/**
 * Abre o editor de um mapa de imagem do acervo da campanha. `item` = visão do mapa ({id, key, name, revision, imageUrl, …}).
 * Devolve uma promessa resolvida quando o editor fecha.
 */
export async function openImageMapEditor(campaign, { item, onSaved = () => {} }) {
  ensureStyles();
  const base = `/campaigns/${campaign.id}/assets/maps/${item.id}`;
  const data = await api(`${base}/composition`);
  let map = data.map || item;
  let doc = P.normalizeComposition(data.composition, { width: map.pixelWidth, height: map.pixelHeight });
  let meta = metaFrom(map, data.summary);
  let selection = new Set(), activeLayer = "elements", saving = false, quickKey = "", pasteCount = 0, conflict = null;
  const view = { showGrid: meta.hasGrid, snap: true, hideOutside: false };
  const sources = new Map(); // src → { name, width, height } das imagens adicionadas nesta sessão

  // ---------- Histórico e estado salvo ----------
  const capture = () => ({ doc: P.clone(doc), meta: { ...meta } });
  const signature = () => JSON.stringify(capture());
  let savedSig = signature();
  const history = createHistory({
    capture,
    restore: (snap) => { doc = P.clone(snap.doc); meta = { ...snap.meta }; afterRestore(); },
    onChange: () => scheduleUi(),
  });
  const isDirty = () => signature() !== savedSig;

  // ---------- Janela ----------
  const tools = [
    { id: "select", tip: "Clique num elemento para selecioná-lo e arraste para mover. As alças redimensionam e giram; Shift soma à seleção.", label: "Selecionar e mover", icon: "select", key: "v", group: "edit" },
    { id: "hand", tip: "Arraste para mover a vista. Espaço ou o botão do meio do mouse também movem.", label: "Mão (mover a vista)", icon: "hand", key: "h", group: "edit" },
    { id: "zoom", tip: "Clique para aproximar; com Alt, afasta. A roda do mouse aproxima no ponto do cursor.", label: "Zoom (Alt afasta)", icon: "zoom", key: "z", group: "edit", basic: false },
    { id: "crop", tip: "Arraste para definir um novo recorte da área visível. O que ficar fora vai para a área externa.", label: "Recortar documento", icon: "marquee", key: "c", group: "edit", basic: false },
    { id: "text", tip: "Clique na área de trabalho para criar um texto; ajuste fonte e cor em Propriedades.", label: "Texto", icon: "text", key: "t", group: "create" },
    { id: "rect", tip: "Arraste para desenhar um retângulo na camada ativa.", label: "Retângulo", icon: "rect", key: "u", group: "create", basic: false },
    { id: "ellipse", tip: "Arraste para desenhar uma elipse na camada ativa.", label: "Elipse", icon: "ellipse", key: "e", group: "create", basic: false },
    { id: "image", tip: "Adiciona uma imagem do dispositivo como novo elemento da camada ativa.", label: "Adicionar imagem", icon: "image", key: "i", group: "create", action: () => openAddImage() },
    { id: "grid", tip: "Mostra ou esconde a grade sobre o mapa. Não altera a imagem salva.", label: "Grade", icon: "grid", key: "g", group: "view", action: () => toggleGrid(), pressed: () => view.showGrid && meta.hasGrid },
  ];
  const shell = createEditorShell({
    title: "Editor de mapa de imagem", subtitle: meta.name,
    help: ["campanhas.mapas.imagem", "Editor de mapas de imagem"],
    menus: () => menus(),
    tools,
    onSize: () => openDocSize("canvas"),
    groups: [{ id: "edit", label: "Seleção e vista" }, { id: "create", label: "Criar" }, { id: "view", label: "Exibição" }],
    panels: [
      { id: "layers", title: "Camadas", help: ["campanhas.editor.camadas", "Camadas"] },
      { id: "structure", title: "Estrutura", help: ["campanhas.mapas.area-visivel", "Área visível e área externa"] },
      { id: "quick", title: "Propriedades" },
      { id: "history", title: "Histórico", basic: false },
    ],
    actions: '<button type="button" class="primary small im-save" data-im="save">Salvar</button>',
    keys: {
      "mod+s": () => save(), "mod+z": () => undo(), "mod+shift+z": () => redo(), "mod+y": () => redo(),
      "mod+c": () => copy(), "mod+x": () => cut(), "mod+v": () => paste(), "mod+j": () => duplicate(),
      "mod+a": () => selectAll(), "mod+d": () => select([], false), delete: () => removeSelected(), backspace: () => removeSelected(),
      "mod+]": () => zorder("front"), "mod+[": () => zorder("back"),
      escape: (e) => onEscape(e),
    },
    isDirty,
    initialTool: "select",
    onTool: () => { surface.refreshCursor(); surface.invalidate(); },
    onModeChange: () => { quickKey = ""; scheduleUi(); },
    onClose: () => { flushNudge(); closeFloating(); surface.destroy(); },
  });
  shell.root.classList.add("im-editor");
  shell.stage.innerHTML = `<div class="im-stage" data-im-stage></div><p class="sr-only" id="im-canvas-help">Setas movem a seleção 1 pixel (Shift: 10). Delete exclui. Enter abre as propriedades. Shift+F10 abre o menu do elemento. Tab leva aos painéis.</p>`;
  const stageHost = shell.stage.querySelector("[data-im-stage]");
  shell.root.addEventListener("click", (e) => { if (e.target.closest('[data-im="save"]')) save(); });

  // ---------- Superfície ----------
  const surface = createCompositionSurface(stageHost, {
    doc: () => doc,
    selection: () => selection,
    tool: () => shell.tool,
    options: () => ({ showGrid: view.showGrid && meta.hasGrid, snap: view.snap, hideOutside: view.hideOutside, grid: meta.hasGrid ? { size: meta.gridPixels, offsetX: meta.gridOffsetX, offsetY: meta.gridOffsetY } : null }),
    resolveSrc,
    select: (ids, additive) => select(ids, additive),
    begin: (label) => { flushNudge(); history.begin(label); },
    changed: () => liveUpdate(),
    commit: () => { history.commit(); scheduleUi(); },
    cancel: () => history.cancel(),
    create: (type, rect, point) => createAt(type, rect, point),
    crop: (rect) => openDocSize("crop", P.clampCropRect(rect)),
    context: (at, id, point) => (id ? openElementMenu(at) : openCanvasMenu(at, point)),
    open: (id) => openProps(id),
    cursor: (p) => shell.setStatus({ coords: p ? `${Math.round(p.x)}, ${Math.round(p.y)} px` : "" }),
    camera: () => shell.updateZoom(),
  });
  // Réguas: com grade, em metros a partir da primeira linha da grade; sem grade, em pixels a partir do canto da área visível.
  shell.setCamera({ ...surface.camera, ruler: () => {
    const v = surface.camera.view();
    return meta.hasGrid
      ? { x: v.left + meta.gridOffsetX * v.scale, y: v.top + meta.gridOffsetY * v.scale, cellPx: meta.gridPixels * v.scale, cellUnits: Number(meta.scaleMeters) || 1.5, unit: "m" }
      : { x: v.left, y: v.top, cellPx: v.scale, cellUnits: 1, unit: "px" };
  } });
  surface.canvas.setAttribute("aria-describedby", "im-canvas-help");
  surface.canvas.addEventListener("keydown", onCanvasKey);

  function resolveSrc(src) {
    if (src === "self") return safeImage(map.imageUrl);
    const id = typeof src === "string" && src.startsWith("asset:") ? src.slice(6) : "";
    return GUID.test(id) ? `/api/campaigns/${encodeURIComponent(campaign.id)}/assets/maps/${id}/image` : null;
  }

  // ---------- Seleção ----------
  const layerOf = (el) => doc.layers.find((l) => l.id === el.layer);
  const editable = (el) => !el.locked && !layerOf(el)?.locked;
  const selected = () => doc.elements.filter((e) => selection.has(e.id));
  const editableSelection = () => selected().filter(editable);
  function select(ids, additive) {
    const next = additive ? new Set(selection) : new Set();
    // additive: true alterna cada id (Ctrl/Shift+clique); "add" só acrescenta (laço com Ctrl/Shift).
    for (const id of ids) { if (additive === true && next.has(id)) next.delete(id); else next.add(id); }
    const changed = next.size !== selection.size || [...next].some((id) => !selection.has(id));
    selection = next;
    if (selection.size) { const first = doc.elements.find((e) => selection.has(e.id)); if (first) activeLayer = first.layer; }
    surface.invalidate(); scheduleUi();
    if (changed) announce();
  }
  function announce() {
    const els = selected();
    shell.message(els.length === 1 ? `Selecionado: ${elementLabel(els[0])} (${TYPE_LABEL[els[0].type]}${editable(els[0]) ? "" : ", bloqueado"}).` : els.length ? `${els.length} elementos selecionados.` : "Nenhum elemento selecionado.");
  }
  function prune() {
    const ids = new Set(doc.elements.map((e) => e.id));
    selection = new Set([...selection].filter((id) => ids.has(id)));
    if (!doc.layers.some((l) => l.id === activeLayer)) activeLayer = "elements";
  }
  function afterRestore() { prune(); quickKey = ""; surface.invalidate(); scheduleUi(); }

  /** Uma entrada de histórico por operação lógica. */
  function change(label, fn) {
    if (saving) { shell.message("Aguarde o salvamento terminar."); return false; }
    flushNudge();
    history.record(label);
    fn();
    prune();
    surface.invalidate(); scheduleUi();
    return true;
  }

  // ---------- Interface (painéis, estado, menus) ----------
  let uiQueued = false;
  function scheduleUi() { if (uiQueued) return; uiQueued = true; queueMicrotask(() => { uiQueued = false; renderUi(); }); }
  function renderUi() {
    if (!shell.root.isConnected) return;
    renderLayers(); renderStructure(); renderQuick();
    renderHistoryPanel(shell.panel("history"), history);
    updateStatus(); updateAria();
    shell.setTitle("Editor de mapa de imagem", meta.name);
    shell.refreshTools();
  }
  function gridInfo(width = doc.artboard.width, height = doc.artboard.height, m = meta) {
    return m.hasGrid ? P.gridCount(width, height, m.gridPixels, m.gridOffsetX, m.gridOffsetY) : null;
  }
  function updateStatus() {
    const ab = doc.artboard, g = gridInfo();
    const size = `${int(ab.width)} × ${int(ab.height)} px${g ? (g.valid ? ` · ${g.columns} × ${g.rows} casas` : " · grade inválida") : " · sem grade"}`;
    const state = saving ? '<span class="ed-chip">Salvando…</span>' : isDirty() ? '<span class="ed-chip dirty">Alterações não salvas</span>' : '<span class="ed-chip ok">Salvo</span>';
    shell.setStatus({ size, state });
  }
  function updateAria() {
    const els = selected();
    const sel = els.length === 1 ? `selecionado ${elementLabel(els[0])}` : els.length ? `${els.length} elementos selecionados` : "nada selecionado";
    surface.canvas.setAttribute("aria-label", `Mapa ${meta.name}: área visível de ${doc.artboard.width} por ${doc.artboard.height} pixels, ${doc.elements.length} elementos; ${sel}.`);
  }
  /** Durante arrastes: só desenho, leitura rápida e estado (painéis completos ao soltar). */
  function liveUpdate() { updateQuickValues(); }

  function renderLayers() {
    const els = selected();
    renderLayersPanel(shell.panel("layers"), {
      layers: doc.layers, active: activeLayer, complete: shell.mode === "complete", selectionCount: els.length,
      visibilityNote: "Camada oculta fica fora da imagem salva; a opacidade entra no achatamento.",
      onAction: layerAction,
    });
  }
  function renderStructure() {
    const host = shell.panel("structure");
    const focused = host.contains(document.activeElement) ? document.activeElement.dataset?.item : null;
    renderStructurePanel(host, {
      groups: [...doc.layers].reverse().map((l) => ({
        label: `${l.name}${l.visible ? "" : " (oculta)"}${l.locked ? " (bloqueada)" : ""}`, showEmpty: true,
        items: doc.elements.filter((e) => e.layer === l.id).reverse().map((e) => {
          const status = P.artboardStatus(e, doc.artboard);
          return {
            id: e.id, label: elementLabel(e), icon: TYPE_ICON[e.type],
            meta: status === "outside" ? "fora da área visível" : status === "partial" ? "parcialmente fora" : "",
            hidden: !e.visible || !l.visible, locked: e.locked || l.locked, selected: selection.has(e.id),
          };
        }),
      })),
      empty: "Nenhum elemento ainda. Use Texto, Retângulo ou Adicionar imagem.",
      onSelect: (id, additive) => select([id], additive),
      onContext: (id, at) => openElementMenu(at),
    });
    if (focused) host.querySelector(`[data-item="${CSS.escape(focused)}"]`)?.focus();
  }

  // Propriedades rápidas: x, y, largura, altura, rotação e opacidade da seleção.
  const QUICK = [["x", "X", "px"], ["y", "Y", "px"], ["width", "Largura", "px"], ["height", "Altura", "px"], ["rotation", "Rotação", "°"], ["opacity", "Opacidade", "%"]];
  function quickValues() {
    const els = selected();
    if (els.length === 1) return Object.fromEntries(QUICK.map(([k]) => [k, els[0][k]]));
    if (els.length > 1) { const b = P.unionBounds(els); return { x: b.x, y: b.y, opacity: els[0].opacity }; }
    return {};
  }
  function renderQuick() {
    const host = shell.panel("quick");
    const els = selected();
    const key = `${els.map((e) => `${e.id}:${editable(e)}`).join(",")}|${shell.mode}`;
    if (key === quickKey && host.contains(document.activeElement)) { updateQuickValues(); return; }
    quickKey = key;
    const ab = doc.artboard;
    if (!els.length) {
      host.innerHTML = `<p class="muted small">Nada selecionado. Área visível: ${int(ab.width)} × ${int(ab.height)} px.</p><p class="form-help">Clique num elemento ou escolha na Estrutura. Duplo clique abre todas as propriedades. ${helpButton("campanhas.editor.atalhos", "Atalhos do editor")}</p>`;
      return;
    }
    const locked = !els.every(editable);
    const fields = els.length === 1 ? QUICK : QUICK.filter(([k]) => ["x", "y", "opacity"].includes(k));
    host.innerHTML = `<form class="im-quick" data-quick novalidate>
      <p class="small im-quick-title">${els.length === 1 ? `${icon(TYPE_ICON[els[0].type])}<span>${esc(elementLabel(els[0]))}</span>` : `<span>${els.length} elementos (limites do grupo)</span>`}</p>
      <div class="im-quick-grid">${fields.map(([k, label, unit]) => `<label class="im-quick-field"><span>${esc(label)} <small>${esc(unit)}</small></span><input type="number" name="${k}" step="${k === "rotation" ? "0.5" : "1"}" ${k === "opacity" ? 'min="0" max="100"' : k === "width" || k === "height" ? 'min="1" max="16384"' : k === "rotation" ? 'min="-360" max="360"' : 'min="-16384" max="20480"'} ${locked ? "disabled" : ""}></label>`).join("")}</div>
      ${locked ? '<p class="form-help">Elemento ou camada bloqueada. Desbloqueie para editar.</p>' : ""}
      ${els.length === 1 ? `<p class="im-quick-status small">${statusText(els[0])}</p><button type="button" class="subtle small" data-quick-open>Todas as propriedades…</button>` : ""}
    </form>`;
    updateQuickValues(true);
    const form = host.querySelector("[data-quick]");
    form.addEventListener("change", (e) => applyQuick(e.target));
    form.addEventListener("submit", (e) => e.preventDefault());
    host.querySelector("[data-quick-open]")?.addEventListener("click", () => openProps(els[0].id));
  }
  function statusText(el) {
    const s = P.artboardStatus(el, doc.artboard);
    return s === "outside" ? "Totalmente na área externa: não entra na imagem salva." : s === "partial" ? "Parcialmente fora: só a parte dentro da área visível entra na imagem." : "Dentro da área visível.";
  }
  function updateQuickValues(force = false) {
    const form = shell.panel("quick").querySelector("[data-quick]");
    if (!form) return;
    const v = quickValues();
    for (const input of form.querySelectorAll("input[name]")) {
      if (!force && input === document.activeElement) continue;
      const n = v[input.name];
      input.value = n == null ? "" : String(Math.round(n * 100) / 100);
    }
  }
  function applyQuick(input) {
    const value = Number(input.value), k = input.name;
    if (input.value === "" || !Number.isFinite(value)) { updateQuickValues(true); return; }
    const els = editableSelection();
    if (!els.length) return;
    change("Propriedades rápidas", () => {
      if (els.length > 1 && (k === "x" || k === "y")) {
        const b = P.unionBounds(els), d = value - b[k];
        for (const el of els) { el[k] += d; P.clampGeometry(el); }
        return;
      }
      for (const el of els) {
        if (k === "width" || k === "height") {
          // Redimensiona mantendo o centro (o elemento pode estar girado).
          const c = P.center(el); el[k] = value; el.x = c.x - el.width / 2; el.y = c.y - el.height / 2;
        } else el[k] = value;
        P.clampGeometry(el);
      }
    });
  }

  // ---------- Camadas ----------
  function layerAction(action, id, value) {
    const layer = doc.layers.find((l) => l.id === id);
    if (action === "select") { activeLayer = id; scheduleUi(); return; }
    if (action === "visible" && layer) return change(layer.visible ? "Ocultar camada" : "Mostrar camada", () => { doc.layers = patchLayer(doc.layers, id, { visible: !layer.visible }); });
    if (action === "lock" && layer) return change(layer.locked ? "Desbloquear camada" : "Bloquear camada", () => { doc.layers = patchLayer(doc.layers, id, { locked: !layer.locked }); });
    if (action === "opacity" && layer) return change("Opacidade da camada", () => { doc.layers = patchLayer(doc.layers, id, { opacity: value }); });
    if (action === "rename" && layer) return change("Renomear camada", () => { doc.layers = patchLayer(doc.layers, id, { name: value }); });
    if (action === "up" || action === "down") {
      const r = moveLayer(doc.layers, id, action === "up" ? 1 : -1);
      if (r.error) return shell.message(r.error);
      return change(action === "up" ? "Subir camada" : "Descer camada", () => { doc.layers = r.layers; });
    }
    if (action === "add") return newLayer();
    if (action === "duplicate") return duplicateLayer(id);
    if (action === "delete") return deleteLayer(id);
    if (action === "move-selection") return moveSelectionTo(id);
  }
  function newLayer() {
    const r = addLayer(doc.layers, "", activeLayer);
    if (r.error) return shell.message(r.error);
    change("Nova camada", () => { doc.layers = r.layers; activeLayer = r.id; });
  }
  function duplicateLayer(id) {
    const layer = doc.layers.find((l) => l.id === id);
    if (!layer) return;
    const r = addLayer(doc.layers, `${layer.name} (cópia)`.slice(0, 40), id, { visible: layer.visible, opacity: layer.opacity });
    if (r.error) return shell.message(r.error);
    const items = doc.elements.filter((e) => e.layer === id);
    const copies = P.cloneElements(items, doc.elements, 0, 0).map((e) => ({ ...e, layer: r.id }));
    if (copies.length < items.length) return shell.message(`Use até ${P.LIMITS.elements} elementos por mapa: a cópia da camada não cabe.`);
    change("Duplicar camada", () => { doc.layers = r.layers; doc.elements.push(...copies); activeLayer = r.id; selection = new Set(copies.map((e) => e.id)); });
  }
  function deleteLayer(id) {
    const layer = doc.layers.find((l) => l.id === id);
    const r = removeLayer(doc.layers, id);
    if (r.error) return shell.message(r.error);
    const count = doc.elements.filter((e) => e.layer === id).length;
    if (count && !confirm(`Excluir a camada “${layer.name}” e ${count === 1 ? "o elemento dela" : `os ${count} elementos dela`}? Desfazer recupera.`)) return;
    change("Excluir camada", () => { doc.layers = r.layers; doc.elements = doc.elements.filter((e) => e.layer !== id); if (activeLayer === id) activeLayer = "elements"; });
  }
  function moveSelectionTo(layerId) {
    const target = doc.layers.find((l) => l.id === layerId);
    const els = selected();
    if (!target || !els.length) return;
    change(`Mover para ${target.name}`, () => {
      const ids = new Set(els.map((e) => e.id));
      const moving = doc.elements.filter((e) => ids.has(e.id)).map((e) => ({ ...e, layer: layerId }));
      doc.elements = [...doc.elements.filter((e) => !ids.has(e.id)), ...moving];
      activeLayer = layerId;
    });
    shell.message(`${els.length === 1 ? "Elemento movido" : `${els.length} elementos movidos`} para ${target.name}.`);
  }

  // ---------- Criar elementos ----------
  function canAdd(n = 1) {
    if (doc.elements.length + n > P.LIMITS.elements) { shell.message(`Use até ${P.LIMITS.elements} elementos por mapa.`); return false; }
    const layer = doc.layers.find((l) => l.id === activeLayer);
    if (layer?.locked) { shell.message(`A camada ${layer.name} está bloqueada. Desbloqueie ou escolha outra camada.`); return false; }
    if (layer && !layer.visible) shell.message(`A camada ${layer.name} está oculta: o novo elemento não aparece até mostrá-la.`);
    return true;
  }
  function addElement(raw, label) {
    const el = P.normalizeElement({ ...raw, id: P.newElementId(doc.elements, raw.type), layer: activeLayer });
    P.clampGeometry(el);
    if (!change(label, () => { doc.elements.push(el); selection = new Set([el.id]); })) return null;
    announce();
    return el;
  }
  function createAt(type, rect, point) {
    if (!canAdd()) return;
    const p = point || surface.viewCenter();
    const ab = doc.artboard;
    if (type === "text") {
      const fontSize = Math.max(16, Math.min(160, Math.round(Math.max(ab.width, ab.height) / 40)));
      const draft = { type: "text", name: "", text: "Texto", fontSize, fontFamily: "serif", color: "#ffffff", align: "left", x: p.x, y: p.y, width: fontSize * 6, height: fontSize * 1.25 };
      draft.height = textHeight(draft);
      const el = addElement(draft, "Adicionar texto");
      shell.setTool("select");
      if (el) openProps(el.id);
      return;
    }
    const w = rect ? rect.width : Math.round(Math.max(64, ab.width / 6)), h = rect ? rect.height : Math.round(Math.max(48, ab.height / 8));
    addElement({ type, name: "", x: rect ? rect.x : p.x - w / 2, y: rect ? rect.y : p.y - h / 2, width: w, height: h, fill: "#6d5a33", stroke: "#e6cf98", strokeWidth: Math.max(1, Math.round(Math.min(w, h) / 60)) }, type === "rect" ? "Adicionar retângulo" : "Adicionar elipse");
    shell.setTool("select");
  }
  /** Imagem-fonte devolvida pelo servidor ({id,key,name,width,height,imageUrl}) entra no tamanho natural, centrada na vista. */
  function addImageElement(source, point) {
    if (!canAdd()) return;
    const key = source.key || `asset:${source.id}`;
    const w = Math.max(1, Math.min(P.LIMITS.sizeMax, Number(source.width) || 256)), h = Math.max(1, Math.min(P.LIMITS.sizeMax, Number(source.height) || 256));
    sources.set(key, { name: source.name || "", width: w, height: h });
    const p = point || surface.viewCenter();
    addElement({ type: "image", name: String(source.name || "Imagem").slice(0, 80), src: key, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), width: w, height: h }, "Adicionar imagem");
    shell.setTool("select");
  }

  // ---------- Editar ----------
  function undo() { flushNudge(); if (surface.busy) return; const label = history.undo(); shell.message(label ? `Desfeito: ${label}.` : "Nada para desfazer."); }
  function redo() { flushNudge(); if (surface.busy) return; const label = history.redo(); shell.message(label ? `Refeito: ${label}.` : "Nada para refazer."); }
  function copy() {
    const els = selected();
    if (!els.length) return shell.message("Selecione algo para copiar.");
    clipboard = P.clone(els); pasteCount = 0;
    shell.message(els.length === 1 ? "Elemento copiado." : `${els.length} elementos copiados.`);
  }
  function cut() {
    const els = editableSelection();
    if (!els.length) return shell.message("Selecione um elemento desbloqueado para recortar.");
    clipboard = P.clone(els); pasteCount = 0;
    const ids = new Set(els.map((e) => e.id));
    change("Recortar", () => { doc.elements = doc.elements.filter((e) => !ids.has(e.id)); selection = new Set(); });
  }
  function paste(at = null) {
    if (!clipboard?.length) return shell.message("A área de transferência do editor está vazia.");
    if (!canAdd(clipboard.length)) return;
    pasteCount++;
    let dx = 16 * pasteCount, dy = 16 * pasteCount;
    if (at) { const b = P.unionBounds(clipboard); dx = at.x - (b.x + b.width / 2); dy = at.y - (b.y + b.height / 2); }
    const copies = P.cloneElements(clipboard, doc.elements, dx, dy).map((e) => ({ ...e, layer: activeLayer, locked: false }));
    change("Colar", () => { doc.elements.push(...copies); selection = new Set(copies.map((e) => e.id)); });
    announce();
  }
  function duplicate() {
    const els = selected();
    if (!els.length) return shell.message("Selecione algo para duplicar.");
    if (doc.elements.length + els.length > P.LIMITS.elements) return shell.message(`Use até ${P.LIMITS.elements} elementos por mapa.`);
    const copies = P.cloneElements(els, doc.elements, 16, 16).map((e) => ({ ...e, locked: false }));
    change("Duplicar", () => { doc.elements.push(...copies); selection = new Set(copies.map((e) => e.id)); });
    announce();
  }
  function removeSelected() {
    const els = selected();
    if (!els.length) return;
    const removable = els.filter(editable);
    if (!removable.length) return shell.message("Elemento bloqueado: desbloqueie para excluir.");
    const ids = new Set(removable.map((e) => e.id));
    change(removable.length === 1 ? "Excluir elemento" : `Excluir ${removable.length} elementos`, () => { doc.elements = doc.elements.filter((e) => !ids.has(e.id)); selection = new Set(); });
    shell.message(`${removable.length === 1 ? "Elemento excluído" : `${removable.length} elementos excluídos`}${removable.length < els.length ? "; bloqueados foram mantidos" : ""}. Ctrl+Z desfaz.`);
  }
  function selectAll() { select(doc.elements.filter((e) => P.isSelectable(doc, e)).map((e) => e.id), false); }
  function onEscape(e) {
    if (isTypingTarget(e?.target)) { surface.canvas.focus(); return; }
    if (surface.cancelInteraction()) { shell.message("Ação cancelada."); return; }
    if (selection.size) select([], false);
  }
  // Setas: só com o foco no canvas (os painéis usam as setas para navegar).
  let nudgeTimer = 0, nudging = false;
  function flushNudge() { if (!nudging) return; clearTimeout(nudgeTimer); nudging = false; history.commit(); scheduleUi(); }
  function nudge(dx, dy) {
    const els = editableSelection();
    if (!els.length || saving) return;
    if (!nudging) { history.begin("Mover com o teclado"); nudging = true; }
    for (const el of els) { el.x += dx; el.y += dy; P.clampGeometry(el); }
    surface.invalidate(); updateQuickValues(); updateStatus();
    clearTimeout(nudgeTimer); nudgeTimer = setTimeout(flushNudge, 700);
  }
  function onCanvasKey(e) {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); const step = e.shiftKey ? 10 : 1; nudge(dir[0] * step, dir[1] * step); return; }
    if (e.key === "Enter" && selection.size === 1) { e.preventDefault(); openProps([...selection][0]); return; }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const el = selected()[0];
      const at = surface.clientPointOf(el);
      if (el) openElementMenu(at); else openCanvasMenu(at, surface.viewCenter());
    }
  }

  // ---------- Objeto ----------
  function zorder(op) {
    const els = editableSelection();
    if (!els.length) return shell.message("Selecione um elemento desbloqueado.");
    const label = { front: "Trazer para frente", forward: "Avançar", backward: "Recuar", back: "Enviar para trás" }[op];
    change(label, () => { doc.elements = P.reorder(doc, els.map((e) => e.id), op); });
  }
  function align(mode) {
    const els = editableSelection();
    if (!els.length) return shell.message("Selecione um elemento desbloqueado.");
    const ref = els.length >= 2 ? P.unionBounds(els) : { x: 0, y: 0, width: doc.artboard.width, height: doc.artboard.height };
    const offsets = P.alignOffsets(els, mode, ref);
    change("Alinhar", () => { for (const el of els) { const o = offsets.get(el.id); el.x += o.dx; el.y += o.dy; P.clampGeometry(el); } });
    shell.message(els.length >= 2 ? "Alinhado à seleção." : "Alinhado à área visível.");
  }
  function distribute(axis) {
    const els = editableSelection();
    if (els.length < 3) return shell.message("Selecione três ou mais elementos para distribuir.");
    const offsets = P.distributeOffsets(els, axis);
    change("Distribuir", () => { for (const el of els) { const o = offsets.get(el.id); el.x += o.dx; el.y += o.dy; P.clampGeometry(el); } });
  }
  function transform(label, fn) {
    const els = editableSelection();
    if (!els.length) return shell.message("Selecione um elemento desbloqueado.");
    change(label, () => { for (const el of els) { fn(el); P.clampGeometry(el); } });
  }
  const rotateBy = (deg) => transform(deg > 0 ? "Girar 90° à direita" : "Girar 90° à esquerda", (el) => { el.rotation = P.normalizeRotation(el.rotation + deg); });
  const flip = (axis) => transform(axis === "x" ? "Espelhar na horizontal" : "Espelhar na vertical", (el) => { if (axis === "x") el.flipX = !el.flipX; else el.flipY = !el.flipY; });
  const fitTo = (mode) => transform(mode === "fill" ? "Preencher a área visível" : "Caber na área visível", (el) => Object.assign(el, P.fitToArtboard(el, doc.artboard, mode)));
  const setOpacity = (v) => transform(`Opacidade ${v}%`, (el) => { el.opacity = v; });
  function toggleFlag(flag) {
    const els = selected();
    if (!els.length) return;
    const all = els.every((e) => e[flag]);
    const label = flag === "locked" ? (all ? "Desbloquear" : "Bloquear") : (all ? "Mostrar" : "Ocultar");
    const value = flag === "visible" ? !els.every((e) => e.visible) : !all;
    change(label, () => { for (const el of els) el[flag] = value; });
  }

  // ---------- Menus ----------
  const layerSubmenu = () => doc.layers.slice().reverse().map((l) => ({ label: l.name, checked: selected().length > 0 && selected().every((e) => e.layer === l.id), run: () => moveSelectionTo(l.id), disabled: !selected().length }));
  const alignItems = () => [
    ["left", "Esquerda"], ["center", "Centro horizontal"], ["right", "Direita"], ["top", "Topo"], ["middle", "Meio vertical"], ["bottom", "Base"],
  ].map(([m, label]) => ({ label, run: () => align(m) }));
  function menus() {
    const has = selected().length > 0, many = editableSelection().length;
    const one = selected().length === 1 ? selected()[0] : null;
    const active = doc.layers.find((l) => l.id === activeLayer);
    const required = activeLayer === "base" || activeLayer === "elements";
    return [
      { id: "file", label: "Arquivo", items: () => [
        { label: "Salvar", shortcut: "mod+s", run: save, disabled: saving },
        { label: "Propriedades do mapa…", run: openMapProps },
        { label: "Preparar névoa e luz…", run: prepareFog, disabled: !meta.hasGrid, disabledReason: "Ative a grade (Imagem › Grade e escala) para preparar névoa e luz.", hint: meta.hasGrid ? "Salva antes de abrir" : "Requer grade" },
        { separator: true },
        { label: "Fechar", run: () => shell.requestClose() },
      ] },
      { id: "edit", label: "Editar", items: () => [
        { label: "Desfazer", shortcut: "mod+z", run: undo, disabled: !history.canUndo, hint: history.undoLabel },
        { label: "Refazer", shortcut: "mod+shift+z", run: redo, disabled: !history.canRedo, hint: history.redoLabel },
        { separator: true },
        { label: "Recortar", shortcut: "mod+x", run: cut, disabled: !many },
        { label: "Copiar", shortcut: "mod+c", run: copy, disabled: !has },
        { label: "Colar", shortcut: "mod+v", run: () => paste(), disabled: !clipboard?.length },
        { label: "Duplicar", shortcut: "mod+j", run: duplicate, disabled: !has },
        { label: "Excluir", shortcut: "delete", run: removeSelected, disabled: !many, danger: true },
        { separator: true },
        { label: "Selecionar tudo", shortcut: "mod+a", run: selectAll },
        { label: "Desmarcar", shortcut: "mod+d", run: () => select([], false), disabled: !has },
      ] },
      { id: "image", label: "Imagem", items: () => [
        { label: "Tamanho do documento…", run: () => openDocSize("canvas") },
        { label: "Recortar para a seleção…", run: () => openDocSize("crop", selectionCrop()), disabled: !has },
        { label: "Cor de fundo…", run: openBackground },
        { label: "Grade e escala…", run: openGridDialog },
      ] },
      { id: "layer", label: "Camada", items: () => [
        { label: "Nova camada", run: newLayer, disabled: doc.layers.length >= P.LIMITS.layers },
        { label: "Duplicar camada", run: () => duplicateLayer(activeLayer), disabled: doc.layers.length >= P.LIMITS.layers },
        { label: "Excluir camada", run: () => deleteLayer(activeLayer), disabled: required, danger: true, hint: required ? "Base e Elementos são obrigatórias" : "" },
        { label: "Subir camada", run: () => layerAction("up", activeLayer), disabled: required },
        { label: "Descer camada", run: () => layerAction("down", activeLayer), disabled: required },
        { label: "Renomear camada…", run: () => { const name = prompt("Nome da camada (até 40 caracteres)", active?.name || ""); if (name?.trim()) layerAction("rename", activeLayer, name.trim().slice(0, 40)); } },
        { separator: true },
        { label: "Mover seleção para", items: layerSubmenu(), disabled: !has },
      ] },
      { id: "object", label: "Objeto", items: () => [
        { label: "Trazer para frente", shortcut: "mod+]", run: () => zorder("front"), disabled: !many },
        { label: "Avançar", run: () => zorder("forward"), disabled: !many },
        { label: "Recuar", run: () => zorder("backward"), disabled: !many },
        { label: "Enviar para trás", shortcut: "mod+[", run: () => zorder("back"), disabled: !many },
        { separator: true },
        { label: "Alinhar", items: alignItems(), disabled: !many, hint: many >= 2 ? "à seleção" : "à área visível" },
        { label: "Distribuir", items: [{ label: "Horizontalmente", run: () => distribute("x") }, { label: "Verticalmente", run: () => distribute("y") }], disabled: many < 3 },
        { separator: true },
        { label: "Girar 90° à direita", run: () => rotateBy(90), disabled: !many },
        { label: "Girar 90° à esquerda", run: () => rotateBy(-90), disabled: !many },
        { label: "Espelhar na horizontal", run: () => flip("x"), disabled: !many },
        { label: "Espelhar na vertical", run: () => flip("y"), disabled: !many },
        { label: "Ajustar à área visível", items: [{ label: "Caber inteiro", run: () => fitTo("fit") }, { label: "Preencher", run: () => fitTo("fill") }], disabled: !many },
        { separator: true },
        { label: selected().length && selected().every((e) => e.locked) ? "Desbloquear" : "Bloquear", run: () => toggleFlag("locked"), disabled: !has },
        { label: selected().length && selected().every((e) => !e.visible) ? "Mostrar" : "Ocultar", run: () => toggleFlag("visible"), disabled: !has },
        { label: "Propriedades…", run: () => openProps(one.id), disabled: !one },
      ] },
      { id: "view", label: "Exibir", items: () => [
        { label: "Aproximar", shortcut: "mod+plus", run: () => { surface.camera.zoomIn(); shell.updateZoom(); } },
        { label: "Afastar", shortcut: "mod+minus", run: () => { surface.camera.zoomOut(); shell.updateZoom(); } },
        { label: "Ajustar à tela", shortcut: "mod+0", run: () => { surface.fit(); shell.updateZoom(); } },
        { label: "Tamanho real (100%)", shortcut: "mod+1", run: () => { surface.camera.actual(); shell.updateZoom(); } },
        { label: "Enquadrar a seleção", run: () => { const b = P.unionBounds(selected()); if (b) surface.fitRect(b); }, disabled: !has },
        { separator: true },
        { label: "Mostrar grade", checked: view.showGrid && meta.hasGrid, run: toggleGrid, disabled: !meta.hasGrid, disabledReason: "Mapa sem grade. Ative em Imagem › Grade e escala." },
        { label: "Encaixar", checked: view.snap, run: () => { view.snap = !view.snap; shell.message(view.snap ? "Encaixe ligado (bordas e centro da área visível e grade). Ctrl ao arrastar ignora." : "Encaixe desligado."); } },
        shell.rulersMenuItem(),
        { label: "Mostrar área externa", checked: !view.hideOutside, run: () => { view.hideOutside = !view.hideOutside; surface.invalidate(); }, hint: "Escurecida quando ligada; encoberta quando desligada" },
        { separator: true },
        { label: "Painéis", checked: shell.root.dataset.panels === "open", run: () => shell.setPanels(shell.root.dataset.panels !== "open") },
        { label: "Tela cheia", run: () => shell.root.querySelector('[data-ed="fullscreen"]')?.click() },
      ] },
    ];
  }
  function openElementMenu(at) {
    const els = selected();
    if (!els.length) return;
    const many = editableSelection().length;
    const one = els.length === 1 ? els[0] : null;
    const locked = els.every((e) => e.locked), hidden = els.every((e) => !e.visible);
    openContextMenu(at, [
      { label: "Editar propriedades…", run: () => openProps(one.id), disabled: !one },
      { label: "Duplicar", shortcut: "mod+j", run: duplicate },
      { label: "Copiar", shortcut: "mod+c", run: copy },
      { label: "Recortar", shortcut: "mod+x", run: cut, disabled: !many },
      { label: "Colar", shortcut: "mod+v", run: () => paste(), disabled: !clipboard?.length },
      { label: "Excluir", shortcut: "delete", run: removeSelected, disabled: !many, danger: true },
      { separator: true },
      { label: "Trazer para frente", shortcut: "mod+]", run: () => zorder("front"), disabled: !many },
      { label: "Enviar para trás", shortcut: "mod+[", run: () => zorder("back"), disabled: !many },
      { label: "Mover para camada", items: layerSubmenu() },
      { separator: true },
      { label: locked ? "Desbloquear" : "Bloquear", run: () => toggleFlag("locked") },
      { label: hidden ? "Mostrar" : "Ocultar", run: () => toggleFlag("visible") },
      { label: "Transformar", disabled: !many, items: [
        { label: "Girar 90° à direita", run: () => rotateBy(90) },
        { label: "Girar 90° à esquerda", run: () => rotateBy(-90) },
        { label: "Espelhar na horizontal", run: () => flip("x") },
        { label: "Espelhar na vertical", run: () => flip("y") },
        { label: "Redefinir rotação", run: () => transform("Redefinir rotação", (el) => { el.rotation = 0; }) },
        { label: "Caber na área visível", run: () => fitTo("fit") },
        { label: "Preencher a área visível", run: () => fitTo("fill") },
      ] },
      { label: "Aparência", disabled: !many, items: [100, 75, 50, 25].map((v) => ({ label: `Opacidade ${v}%`, checked: els.every((e) => e.opacity === v), run: () => setOpacity(v) })) },
    ], { label: one ? `Ações de ${elementLabel(one)}` : `Ações de ${els.length} elementos` });
  }
  function openCanvasMenu(at, point) {
    openContextMenu(at, [
      { label: "Colar aqui", run: () => paste(point), disabled: !clipboard?.length },
      { separator: true },
      { label: "Adicionar texto aqui", run: () => createAt("text", null, point) },
      { label: "Adicionar retângulo aqui", run: () => createAt("rect", null, point) },
      { label: "Adicionar imagem aqui…", run: () => openAddImage(point) },
      { separator: true },
      { label: "Grade e escala…", run: openGridDialog },
      { label: "Tamanho do documento…", run: () => openDocSize("canvas") },
      { label: "Propriedades do mapa…", run: openMapProps },
    ], { label: "Ações da área de composição" });
  }

  // ---------- Janelas flutuantes próprias (conteúdo livre; o núcleo só oferece campos simples) ----------
  let floating = null;
  function closeFloating() { floating?.close(); floating = null; }
  function floatingDialog({ title, body, submit = "OK", onSubmit, onInput, wide = false }) {
    document.querySelector(".ed-props")?.dispatchEvent(new Event("ed-close"));
    const returnFocus = document.activeElement;
    const box = document.createElement("section");
    const titleId = `im-dlg-${Date.now()}`;
    box.className = `ed-props im-dialog${wide ? " im-wide" : ""}`;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "false"); box.setAttribute("aria-labelledby", titleId);
    box.innerHTML = `<header class="ed-props-head"><h3 id="${titleId}">${esc(title)}</h3><button type="button" class="ed-icon-button" data-dlg="close" aria-label="Fechar">${icon("close")}</button></header><form class="ed-props-form" novalidate>${body}<p class="form-error" role="alert" data-dlg-error></p><div class="form-actions"><button type="button" class="subtle" data-dlg="close">Cancelar</button>${submit ? `<button type="submit" class="primary">${esc(submit)}</button>` : ""}</div></form>`;
    (document.querySelector("dialog[open]") || document.body).append(box);
    const form = box.querySelector("form"), error = box.querySelector("[data-dlg-error]");
    const handle = {
      element: box, form,
      error(text) { error.textContent = text || ""; },
      close() {
        if (!box.isConnected) return;
        box.remove(); document.removeEventListener("keydown", onKey, true);
        if (floating === handle) floating = null;
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      },
    };
    const onKey = (e) => { if (e.key === "Escape" && box.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); handle.close(); } };
    document.addEventListener("keydown", onKey, true);
    box.addEventListener("ed-close", () => handle.close());
    box.addEventListener("click", (e) => { if (e.target.closest('[data-dlg="close"]')) handle.close(); });
    form.addEventListener("input", () => onInput?.(form, handle));
    form.addEventListener("change", () => onInput?.(form, handle));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); handle.error("");
      if (!onSubmit || !form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try { if ((await onSubmit(form, handle)) !== false) handle.close(); }
      catch (err) { handle.error(err?.message || String(err)); }
      finally { if (button) button.disabled = false; }
    });
    const head = box.querySelector(".ed-props-head");
    let drag = null;
    head.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; const r = box.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }; head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = clampMenu(e.clientX - drag.dx, e.clientY - drag.dy, box.offsetWidth, box.offsetHeight, innerWidth, innerHeight, 4);
      box.style.left = `${p.x}px`; box.style.top = `${p.y}px`; box.style.right = "auto";
    });
    head.addEventListener("pointerup", () => { drag = null; });
    floating = handle;
    onInput?.(form, handle);
    setTimeout(() => form.querySelector("input:not([type=hidden]):not(:disabled), select, textarea, button[role=tab]")?.focus(), 0);
    return handle;
  }

  // ---------- Propriedades do elemento ----------
  function originText(el) {
    if (el.src === "self") return "Imagem do mapa (antes da edição)";
    const info = sources.get(el.src), entry = surface.cache.get(el.src);
    const w = info?.width || entry.img?.naturalWidth, h = info?.height || entry.img?.naturalHeight;
    const size = w && h ? ` · ${int(w)} × ${int(h)} px` : entry.state === "error" ? " · indisponível" : "";
    return `${info?.name || "Imagem-fonte do mapa"}${size}`;
  }
  function openProps(id) {
    const el = doc.elements.find((e) => e.id === id);
    if (!el) return;
    const pos = [
      { type: "heading", label: "Posição e tamanho" },
      { name: "x", label: "X", type: "number", value: fmtNum(el.x), min: P.LIMITS.coordMin, max: P.LIMITS.coordMax, step: 1, unit: "px" },
      { name: "y", label: "Y", type: "number", value: fmtNum(el.y), min: P.LIMITS.coordMin, max: P.LIMITS.coordMax, step: 1, unit: "px" },
    ];
    const size = [
      { name: "width", label: el.type === "text" ? "Largura da caixa" : "Largura", type: "number", value: fmtNum(el.width), min: 1, max: P.LIMITS.sizeMax, step: 1, unit: "px" },
      ...(el.type === "text" ? [] : [{ name: "height", label: "Altura", type: "number", value: fmtNum(el.height), min: 1, max: P.LIMITS.sizeMax, step: 1, unit: "px" }]),
    ];
    const common = [
      { name: "rotation", label: "Rotação", type: "number", value: fmtNum(el.rotation), min: -360, max: 360, step: 0.5, unit: "graus" },
      { name: "opacity", label: "Opacidade", type: "range", value: Math.round(el.opacity), min: 0, max: 100, step: 1, unit: "%" },
      { name: "visible", label: "Visível", type: "checkbox", value: el.visible },
      { name: "locked", label: "Bloqueado (não seleciona por clique)", type: "checkbox", value: el.locked },
    ];
    const name = { name: "name", label: "Nome", type: "text", value: el.name, maxlength: P.LIMITS.elementName, help: "Aparece na Estrutura. Opcional." };
    let fields;
    if (el.type === "image") fields = [
      name, { type: "static", label: "Origem", value: originText(el) },
      ...pos, ...size, { name: "keepRatio", label: "Manter proporção", type: "checkbox", value: true },
      ...common.slice(0, 2), { name: "flipX", label: "Espelhar na horizontal", type: "checkbox", value: el.flipX }, { name: "flipY", label: "Espelhar na vertical", type: "checkbox", value: el.flipY }, ...common.slice(2),
    ];
    else if (el.type === "text") fields = [
      name, { name: "text", label: "Texto", type: "textarea", value: el.text, maxlength: P.LIMITS.text, rows: 4, required: true },
      { name: "fontFamily", label: "Fonte", type: "select", value: el.fontFamily, options: [["serif", "Serifada (Georgia)"], ["sans", "Sem serifa"], ["display", "Decorativa"]] },
      { name: "fontSize", label: "Tamanho", type: "number", value: fmtNum(el.fontSize), min: P.LIMITS.fontMin, max: P.LIMITS.fontMax, step: 1, unit: "px" },
      { name: "bold", label: "Negrito", type: "checkbox", value: el.bold }, { name: "italic", label: "Itálico", type: "checkbox", value: el.italic },
      { name: "color", label: "Cor", type: "color", value: el.color },
      { name: "align", label: "Alinhamento", type: "select", value: el.align, options: [["left", "À esquerda"], ["center", "Centralizado"], ["right", "À direita"]] },
      ...pos, ...size, ...common,
    ];
    else fields = [
      name,
      { type: "heading", label: "Aparência" },
      { name: "fill", label: "Preenchimento", type: "color", value: el.fill || "#6d5a33" }, { name: "noFill", label: "Sem preenchimento", type: "checkbox", value: !el.fill },
      { name: "stroke", label: "Contorno", type: "color", value: el.stroke || "#e6cf98" }, { name: "noStroke", label: "Sem contorno", type: "checkbox", value: !el.stroke },
      { name: "strokeWidth", label: "Espessura do contorno", type: "number", value: fmtNum(el.strokeWidth || 0), min: 0, max: P.LIMITS.strokeMax, step: 1, unit: "px" },
      ...pos, ...size, ...common,
    ];
    openPropertiesDialog({
      title: `${TYPE_LABEL[el.type]}: ${elementLabel(el)}`.slice(0, 80),
      fields,
      onApply: (v) => {
        const target = doc.elements.find((e) => e.id === id);
        if (!target) throw new Error("O elemento não existe mais (desfeito ou excluído).");
        const next = { ...target };
        const numIn = (k, min, max, label) => {
          if (v[k] == null) return;
          if (!Number.isFinite(v[k]) || v[k] < min || v[k] > max) throw new Error(`${label}: de ${int(min)} a ${int(max)}.`);
          next[k] = v[k];
        };
        next.name = String(v.name ?? "").trim().slice(0, P.LIMITS.elementName);
        numIn("x", P.LIMITS.coordMin, P.LIMITS.coordMax, "Posição X"); numIn("y", P.LIMITS.coordMin, P.LIMITS.coordMax, "Posição Y");
        numIn("width", 1, P.LIMITS.sizeMax, "Largura"); numIn("height", 1, P.LIMITS.sizeMax, "Altura");
        numIn("rotation", -360, 360, "Rotação"); numIn("opacity", 0, 100, "Opacidade");
        next.visible = !!v.visible; next.locked = !!v.locked;
        if (target.type === "image") {
          if (v.keepRatio) {
            const dw = next.width !== target.width, dh = next.height !== target.height;
            if (dw && !dh) next.height = Math.max(1, Math.round((next.width * target.height) / target.width * 100) / 100);
            else if (dh && !dw) next.width = Math.max(1, Math.round((next.height * target.width) / target.height * 100) / 100);
          }
          next.flipX = !!v.flipX; next.flipY = !!v.flipY;
        }
        if (target.type === "text") {
          const text = String(v.text ?? "");
          if (!text.trim()) throw new Error("Escreva o texto.");
          if (text.length > P.LIMITS.text) throw new Error("O texto aceita até 500 caracteres.");
          next.text = text; next.fontFamily = v.fontFamily; next.align = v.align; next.bold = !!v.bold; next.italic = !!v.italic;
          next.color = P.isHex(v.color) ? v.color.toLowerCase() : target.color;
          numIn("fontSize", P.LIMITS.fontMin, P.LIMITS.fontMax, "Tamanho da fonte");
          next.height = Math.min(P.LIMITS.sizeMax, textHeight(next));
        }
        if (target.type === "rect" || target.type === "ellipse") {
          next.fill = v.noFill ? null : P.isHex(v.fill) ? v.fill.toLowerCase() : target.fill;
          next.stroke = v.noStroke ? null : P.isHex(v.stroke) ? v.stroke.toLowerCase() : target.stroke;
          numIn("strokeWidth", 0, P.LIMITS.strokeMax, "Contorno");
          if (!next.fill && (!next.stroke || !next.strokeWidth)) throw new Error("Sem preenchimento e sem contorno, a forma fica invisível. Escolha um dos dois.");
        }
        P.clampGeometry(next);
        if (JSON.stringify(next) === JSON.stringify(target)) return;
        change(`Propriedades de ${elementLabel(next)}`, () => { Object.assign(target, next); });
      },
    });
  }
  const fmtNum = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // ---------- Propriedades do mapa, fundo, grade ----------
  function openMapProps() {
    openPropertiesDialog({
      title: "Propriedades do mapa",
      fields: [
        { name: "name", label: "Nome", type: "text", value: meta.name, maxlength: 120, required: true },
        { name: "summary", label: "Descrição", type: "textarea", value: meta.summary, maxlength: 500, rows: 4, help: "Só o mestre vê. Até 500 caracteres." },
        { type: "static", label: "Área visível", value: `${int(doc.artboard.width)} × ${int(doc.artboard.height)} px` },
      ],
      onApply: (v) => {
        const name = String(v.name || "").trim(), summary = String(v.summary || "").trim();
        if (!name || name.length > 120) throw new Error("Dê um nome de até 120 caracteres.");
        if (summary.length > 500) throw new Error("A descrição aceita até 500 caracteres.");
        if (name === meta.name && summary === meta.summary) return;
        change("Propriedades do mapa", () => { meta.name = name; meta.summary = summary; });
      },
    });
  }
  function openBackground() {
    openPropertiesDialog({
      title: "Cor de fundo da área visível",
      fields: [{ name: "background", label: "Cor de fundo", type: "color", value: doc.artboard.background, help: "Aparece onde nenhum elemento cobre a área visível." }],
      onApply: (v) => { if (!P.isHex(v.background) || v.background.toLowerCase() === doc.artboard.background) return; change("Cor de fundo", () => { doc.artboard.background = v.background.toLowerCase(); }); },
    });
  }
  function toggleGrid() {
    if (!meta.hasGrid) { shell.message("Este mapa está sem grade. Ative em Imagem › Grade e escala."); openGridDialog(); return; }
    view.showGrid = !view.showGrid;
    surface.invalidate(); shell.refreshTools();
    shell.message(view.showGrid ? "Grade visível." : "Grade oculta (continua valendo na mesa).");
  }
  function openGridDialog() {
    const ab = doc.artboard;
    floatingDialog({
      title: "Grade e escala",
      submit: "Aplicar",
      body: `<label class="check ed-props-check"><input type="checkbox" name="hasGrid" ${meta.hasGrid ? "checked" : ""}> Usar grade (casas para movimento, névoa e paredes)</label>
        <label class="check ed-props-check"><input type="checkbox" name="freeMovement" ${meta.freeMovement ? "checked" : ""}> Movimentação livre dos marcadores</label>
        <div class="field"><label for="im-g-size">Tamanho do quadrado <small>(px, 8–1.024)</small></label><input id="im-g-size" name="gridPixels" type="number" min="8" max="1024" step="1" required value="${meta.gridPixels}"></div>
        <div class="im-two"><div class="field"><label for="im-g-ox">Deslocamento X <small>(px)</small></label><input id="im-g-ox" name="gridOffsetX" type="number" min="0" max="1023" step="1" value="${meta.gridOffsetX}"></div>
        <div class="field"><label for="im-g-oy">Deslocamento Y <small>(px)</small></label><input id="im-g-oy" name="gridOffsetY" type="number" min="0" max="1023" step="1" value="${meta.gridOffsetY}"></div></div>
        <div class="field"><label for="im-g-scale">Cada quadrado representa <small>(metros, 0,01–1.000)</small></label><input id="im-g-scale" name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" required value="${meta.scaleMeters}"></div>
        <p class="im-preview" role="status" aria-live="polite" data-grid-preview></p>
        <p class="form-help">A grade vem da área visível (${int(ab.width)} × ${int(ab.height)} px): até 100 casas por lado e 4.096 no total. Paredes e névoa seguem a grade; marcadores fora da nova grade saem das preparações de cena. Tirar a grade é recusado se uma cena tática usa o mapa.</p>`,
      onInput: (form) => {
        const v = gridValues(form);
        form.elements.namedItem("freeMovement").disabled = !v.hasGrid;
        for (const n of ["gridPixels", "gridOffsetX", "gridOffsetY"]) form.elements.namedItem(n).disabled = !v.hasGrid;
        form.elements.namedItem("gridOffsetX").max = String(Math.max(0, v.gridPixels - 1));
        form.elements.namedItem("gridOffsetY").max = String(Math.max(0, v.gridPixels - 1));
        const g = v.hasGrid ? P.gridCount(ab.width, ab.height, v.gridPixels, v.gridOffsetX, v.gridOffsetY) : null;
        const out = form.querySelector("[data-grid-preview]");
        out.textContent = !v.hasGrid ? "Sem grade: o mapa é só imagem (sem névoa por casas)." : g.valid ? `${g.columns} × ${g.rows} casas (${int(g.columns * g.rows)} no total).` : g.message;
        out.classList.toggle("im-bad", !!g && !g.valid);
      },
      onSubmit: (form) => {
        const v = gridValues(form);
        const scale = Math.round(v.scaleMeters * 100) / 100;
        if (!(scale >= 0.01 && scale <= 1000)) throw new Error("A escala vai de 0,01 a 1.000 metros.");
        if (v.hasGrid) { const g = P.gridCount(ab.width, ab.height, v.gridPixels, v.gridOffsetX, v.gridOffsetY); if (!g.valid) throw new Error(g.message); }
        const next = { ...meta, hasGrid: v.hasGrid, freeMovement: v.hasGrid && v.freeMovement, scaleMeters: scale, ...(v.hasGrid ? { gridPixels: v.gridPixels, gridOffsetX: v.gridOffsetX, gridOffsetY: v.gridOffsetY } : {}) };
        if (JSON.stringify(next) === JSON.stringify(meta)) return;
        const before = gridInfo();
        const after = gridInfo(ab.width, ab.height, next);
        if (before && after && (before.columns !== after.columns || before.rows !== after.rows) && !confirm(gridWarning(before, after))) return false;
        change("Grade e escala", () => { meta = next; });
        if (v.hasGrid) view.showGrid = true;
      },
    });
  }
  function gridValues(form) {
    const n = (k) => Math.trunc(Number(form.elements.namedItem(k).value) || 0);
    return { hasGrid: form.elements.namedItem("hasGrid").checked, freeMovement: form.elements.namedItem("freeMovement").checked, gridPixels: n("gridPixels"), gridOffsetX: n("gridOffsetX"), gridOffsetY: n("gridOffsetY"), scaleMeters: Number(form.elements.namedItem("scaleMeters").value) };
  }
  const gridWarning = (before, after) => `A grade muda de ${before.columns} × ${before.rows} para ${after.columns} × ${after.rows} casas. Se o mapa já estiver preparado, paredes e névoa seguem a nova grade e marcadores fora dela saem das preparações das cenas ao salvar. Continuar?`;

  // ---------- Tamanho do documento: área visível, conteúdo ou recorte ----------
  function selectionCrop() {
    const b = P.unionBounds(selected());
    return b ? P.clampCropRect(b) : null;
  }
  function openDocSize(initialMode = "canvas", cropRect = null) {
    const ab = doc.artboard;
    const crop = cropRect || { x: 0, y: 0, width: ab.width, height: ab.height };
    const anchors = P.ANCHORS.map((a) => `<label class="im-anchor-cell"><input type="radio" name="anchor" value="${a}" ${a === "c" ? "checked" : ""} aria-label="${esc(ANCHOR_LABEL[a])}"><span aria-hidden="true"></span></label>`).join("");
    const mode = (m, label, help) => `<label class="im-mode"><input type="radio" name="mode" value="${m}" ${m === initialMode ? "checked" : ""}><span><strong>${esc(label)}</strong><small>${esc(help)}</small></span></label>`;
    let pending = null;
    const dlg = floatingDialog({
      title: "Tamanho do documento", submit: "Aplicar", wide: true,
      body: `<fieldset class="im-modes"><legend>O que mudar</legend>
          ${mode("canvas", "Tamanho da área visível", "Muda só o recorte; o conteúdo fica onde está e o que sair vai para a área externa.")}
          ${mode("scale", "Redimensionar conteúdo", "Escala a área visível e todos os elementos juntos.")}
          ${mode("crop", "Recortar para seleção ou região", "Define a área visível por um retângulo, sem apagar elementos.")}
        </fieldset>
        <div data-show="canvas scale"><div class="im-two">
          <div class="field"><label for="im-d-w">Largura <small>(px)</small></label><input id="im-d-w" name="width" type="number" min="64" max="4096" step="1" value="${ab.width}"></div>
          <div class="field"><label for="im-d-h">Altura <small>(px)</small></label><input id="im-d-h" name="height" type="number" min="64" max="4096" step="1" value="${ab.height}"></div></div>
          <label class="check ed-props-check"><input type="checkbox" name="ratio" ${initialMode === "scale" ? "checked" : ""}> Manter proporção (${int(ab.width)} : ${int(ab.height)})</label></div>
        <fieldset data-show="canvas" class="im-anchor-box"><legend>Âncora</legend><div class="im-anchor" role="radiogroup" aria-label="Âncora do redimensionamento">${anchors}</div><small class="form-help">O conteúdo fica preso a este ponto; a área cresce ou encolhe pelos outros lados.</small></fieldset>
        <div data-show="scale">${meta.hasGrid ? '<label class="check ed-props-check"><input type="checkbox" name="scaleGrid" checked> Escalar a grade junto (mesmo número de casas sobre o mesmo conteúdo)</label>' : ""}</div>
        <div data-show="crop"><div class="im-two">
          <div class="field"><label for="im-c-x">X <small>(px)</small></label><input id="im-c-x" name="cx" type="number" step="1" value="${crop.x}"></div>
          <div class="field"><label for="im-c-y">Y <small>(px)</small></label><input id="im-c-y" name="cy" type="number" step="1" value="${crop.y}"></div>
          <div class="field"><label for="im-c-w">Largura <small>(px)</small></label><input id="im-c-w" name="cw" type="number" min="64" max="4096" step="1" value="${crop.width}"></div>
          <div class="field"><label for="im-c-h">Altura <small>(px)</small></label><input id="im-c-h" name="ch" type="number" min="64" max="4096" step="1" value="${crop.height}"></div></div>
          <button type="button" class="subtle small" data-crop-selection ${selected().length ? "" : "disabled"}>Usar os limites da seleção</button></div>
        <p class="im-preview" role="status" aria-live="polite" data-doc-preview></p>
        <div class="im-warn" data-doc-warn hidden><p data-doc-warn-text></p><label class="check ed-props-check"><input type="checkbox" name="confirmGrid"> Entendi: paredes e névoa seguem a grade, e marcadores fora da nova grade saem das preparações de cena.</label></div>`,
      onInput: (form, dlg) => {
        const r = docSizeResult(form);
        pending = r;
        const m = form.elements.namedItem("mode").value;
        for (const el of form.querySelectorAll("[data-show]")) el.hidden = !el.dataset.show.split(" ").includes(m);
        const out = form.querySelector("[data-doc-preview]"), warn = form.querySelector("[data-doc-warn]");
        if (r.error) { out.textContent = r.error; out.classList.add("im-bad"); warn.hidden = true; return; }
        out.classList.toggle("im-bad", !!r.gridError);
        const outside = r.doc.elements.filter((e) => P.artboardStatus(e, r.doc.artboard) === "outside").length;
        out.textContent = `Resultado: ${int(r.doc.artboard.width)} × ${int(r.doc.artboard.height)} px (antes ${int(ab.width)} × ${int(ab.height)})${r.grid ? ` · ${r.grid.valid ? `${r.grid.columns} × ${r.grid.rows} casas` : r.grid.message}` : ""}${outside ? ` · ${outside} elemento(s) ficam totalmente na área externa` : ""}.`;
        const before = gridInfo();
        const gridChanged = !!(before && r.grid && (before.columns !== r.grid.columns || before.rows !== r.grid.rows));
        warn.hidden = !gridChanged;
        r.needsConfirm = gridChanged;
        if (gridChanged) form.querySelector("[data-doc-warn-text]").textContent = `A grade muda de ${before.columns} × ${before.rows} para ${r.grid.columns} × ${r.grid.rows} casas. Se o mapa já foi preparado (névoa, paredes, marcadores), a preparação será ajustada à nova grade ao salvar.`;
        dlg.error("");
      },
      onSubmit: (form) => {
        const r = pending || docSizeResult(form);
        if (r.error) throw new Error(r.error);
        if (r.gridError) throw new Error(`${r.gridError} Ajuste em Imagem › Grade e escala antes ou escolha outro tamanho.`);
        if (r.needsConfirm && !form.elements.namedItem("confirmGrid").checked) throw new Error("Confirme o ajuste da grade marcando a caixa acima.");
        change(r.label, () => { doc = r.doc; meta = { ...meta, ...r.meta }; });
        surface.fit(); shell.updateZoom();
        shell.message(`${r.label}: ${int(doc.artboard.width)} × ${int(doc.artboard.height)} px.`);
      },
    });
    const form = dlg.form;
    const w = form.elements.namedItem("width"), h = form.elements.namedItem("height"), ratio = form.elements.namedItem("ratio");
    w.addEventListener("input", () => { if (ratio.checked && Number(w.value) > 0) h.value = String(Math.round((Number(w.value) * ab.height) / ab.width)); });
    h.addEventListener("input", () => { if (ratio.checked && Number(h.value) > 0) w.value = String(Math.round((Number(h.value) * ab.width) / ab.height)); });
    form.querySelector("[data-crop-selection]")?.addEventListener("click", () => {
      const r = selectionCrop(); if (!r) return;
      form.elements.namedItem("cx").value = r.x; form.elements.namedItem("cy").value = r.y;
      form.elements.namedItem("cw").value = r.width; form.elements.namedItem("ch").value = r.height;
      form.dispatchEvent(new Event("input"));
    });
  }
  function docSizeResult(form) {
    const n = (k) => Math.round(Number(form.elements.namedItem(k)?.value));
    const mode = form.elements.namedItem("mode").value;
    const ab = doc.artboard;
    let r, label, m = {};
    if (mode === "crop") {
      const rect = { x: n("cx"), y: n("cy"), width: n("cw"), height: n("ch") };
      const err = P.artboardError(rect.width, rect.height);
      if (err) return { error: err };
      if (rect.x < P.LIMITS.coordMin || rect.y < P.LIMITS.coordMin || rect.x > P.LIMITS.coordMax || rect.y > P.LIMITS.coordMax) return { error: "A região precisa ficar dentro da área de trabalho." };
      r = P.cropComposition(doc, rect); label = "Recortar documento";
      m = { gridOffsetX: P.shiftGridOffset(meta.gridOffsetX, r.dx, meta.gridPixels), gridOffsetY: P.shiftGridOffset(meta.gridOffsetY, r.dy, meta.gridPixels) };
    } else {
      const width = n("width"), height = n("height");
      const err = P.artboardError(width, height);
      if (err) return { error: err };
      if (mode === "scale") {
        r = P.scaleComposition(doc, width, height); label = "Redimensionar conteúdo";
        if (meta.hasGrid && form.elements.namedItem("scaleGrid")?.checked) {
          const size = Math.max(8, Math.min(1024, Math.round(meta.gridPixels * Math.sqrt(r.sx * r.sy))));
          m = { gridPixels: size, gridOffsetX: Math.round(meta.gridOffsetX * r.sx) % size, gridOffsetY: Math.round(meta.gridOffsetY * r.sy) % size };
        }
      } else {
        r = P.resizeArtboard(doc, width, height, form.elements.namedItem("anchor").value || "c"); label = "Tamanho da área visível";
        m = { gridOffsetX: P.shiftGridOffset(meta.gridOffsetX, r.dx, meta.gridPixels), gridOffsetY: P.shiftGridOffset(meta.gridOffsetY, r.dy, meta.gridPixels) };
      }
    }
    for (const el of r.doc.elements) P.clampGeometry(el);
    if (r.doc.elements.length === doc.elements.length && JSON.stringify(r.doc) === JSON.stringify(doc) && !Object.keys(m).some((k) => m[k] !== meta[k])) return { error: "Nada muda com estes valores." };
    const nextMeta = { ...meta, ...m };
    const grid = gridInfo(r.doc.artboard.width, r.doc.artboard.height, nextMeta);
    return { doc: r.doc, meta: m, label, grid, gridError: grid && !grid.valid ? grid.message : "", sizeChanged: r.doc.artboard.width !== ab.width || r.doc.artboard.height !== ab.height };
  }

  // ---------- Adicionar imagem ----------
  function openAddImage(point = null) {
    const tab = (id, label, on) => `<button type="button" role="tab" id="im-tab-${id}" aria-controls="im-pane-${id}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${id}">${esc(label)}</button>`;
    const dlg = floatingDialog({
      title: "Adicionar imagem", submit: "", wide: true,
      body: `<div class="im-tabs" role="tablist" aria-label="Origem da imagem">${tab("device", "Do dispositivo", true)}${tab("url", "Por endereço", false)}${tab("campaign", "Da campanha", false)}</div>
        <div role="tabpanel" id="im-pane-device" aria-labelledby="im-tab-device" data-pane="device">
          <div class="field"><label for="im-a-file">Arquivo <small>(PNG, JPEG ou WebP, até 10 MB)</small></label><input id="im-a-file" type="file" name="file" accept="image/png,image/jpeg,image/webp"></div>
          <div class="field"><label for="im-a-name">Nome <small>(opcional)</small></label><input id="im-a-name" name="name" maxlength="120"></div>
          <p class="form-help">PNG com transparência continua transparente. Imagens maiores que a área visível são permitidas: a parte de fora fica na área externa.</p>
          <div class="form-actions"><button type="button" class="primary" data-add="device">Enviar e adicionar</button></div></div>
        <div role="tabpanel" id="im-pane-url" aria-labelledby="im-tab-url" data-pane="url" hidden>
          <div class="field"><label for="im-a-url">Endereço da imagem <small>(https)</small></label><input id="im-a-url" type="url" name="url" maxlength="2048" inputmode="url"></div>
          <div class="field"><label for="im-a-uname">Nome <small>(opcional)</small></label><input id="im-a-uname" name="urlName" maxlength="120"></div>
          <p class="form-help">O servidor baixa a imagem com as mesmas proteções da importação de mapas.</p>
          <div class="form-actions"><button type="button" class="primary" data-add="url">Importar e adicionar</button></div></div>
        <div role="tabpanel" id="im-pane-campaign" aria-labelledby="im-tab-campaign" data-pane="campaign" hidden>
          <div class="field"><label for="im-a-filter">Filtrar por nome</label><input id="im-a-filter" type="search" name="filter" maxlength="80"></div>
          <div class="im-pick-host" data-pick><p class="muted small">Abra esta aba para listar mapas e retratos da campanha.</p></div></div>
        <p class="sr-only" role="status" aria-live="polite" data-add-status></p>`,
    });
    const box = dlg.element, form = dlg.form;
    const status = box.querySelector("[data-add-status]");
    let choices = null;
    const setTab = (id) => {
      for (const b of box.querySelectorAll("[data-tab]")) { const on = b.dataset.tab === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
      for (const p of box.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== id;
      if (id === "campaign" && !choices) loadChoices();
    };
    box.querySelector(".im-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
    box.querySelector(".im-tabs").addEventListener("keydown", (e) => {
      const all = [...box.querySelectorAll("[data-tab]")], i = all.indexOf(document.activeElement);
      if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const n = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length;
      all[n].focus(); setTab(all[n].dataset.tab);
    });
    async function run(button, task) {
      dlg.error("");
      if (doc.elements.length >= P.LIMITS.elements) return dlg.error(`Use até ${P.LIMITS.elements} elementos por mapa.`);
      button.disabled = true; status.textContent = "Enviando a imagem…";
      try {
        const source = await task();
        if (!source || !box.isConnected) return;
        dlg.close();
        addImageElement(source, point);
        shell.message(`Imagem “${source.name || "sem nome"}” adicionada à camada ${doc.layers.find((l) => l.id === activeLayer)?.name || ""}.`);
      } catch (e) { dlg.error(e?.message || String(e)); status.textContent = ""; }
      finally { button.disabled = false; }
    }
    box.querySelector('[data-add="device"]').addEventListener("click", (e) => run(e.currentTarget, async () => {
      const file = form.elements.namedItem("file").files?.[0];
      if (!file) throw new Error("Escolha um arquivo de imagem.");
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use PNG, JPEG ou WebP.");
      if (file.size > MAX_IMAGE_BYTES) throw new Error("A imagem passa de 10 MB.");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", (form.elements.namedItem("name").value.trim() || file.name.replace(/\.[^.]+$/, "")).slice(0, 120));
      return api(`${base}/sources`, "POST", fd);
    }));
    box.querySelector('[data-add="url"]').addEventListener("click", (e) => run(e.currentTarget, async () => {
      const url = form.elements.namedItem("url").value.trim();
      let parsed = null;
      try { parsed = new URL(url); } catch { /* inválido */ }
      if (!parsed || parsed.protocol !== "https:") throw new Error("Informe um endereço https:// válido.");
      return api(`${base}/sources/import`, "POST", { url, name: form.elements.namedItem("urlName").value.trim().slice(0, 120) || null });
    }));
    const pick = box.querySelector("[data-pick]");
    async function loadChoices() {
      pick.innerHTML = '<p class="muted small" role="status">Carregando imagens da campanha…</p>';
      try {
        const root = `/campaigns/${campaign.id}`;
        const [maps, portraits] = await Promise.all([
          // Todas as pastas (limite de 50 mapas): o explorador da Preparação lista mapas sem paginar por pasta.
          api(`${root}/prep/explorer`, "GET", undefined, { background: true }).then((r) => r?.maps || []),
          api(`${root}/assets/portraits`, "GET", undefined, { background: true }).then((r) => r?.items || []).catch(() => []),
        ]);
        choices = [
          ...maps.filter((m) => !m.isTileMap && m.origin !== "tiles" && m.id !== map.id && safeImage(m.imageUrl)).map((m) => ({ key: m.key || `asset:${m.id}`, name: String(m.name || "Mapa"), imageUrl: m.imageUrl, kind: "Mapa", meta: m.pixelWidth ? `${int(m.pixelWidth)} × ${int(m.pixelHeight)} px` : "" })),
          ...portraits.filter((p) => safeImage(p.imageUrl)).map((p) => ({ key: p.key || `asset:${p.id}`, name: String(p.name || "Retrato"), imageUrl: p.imageUrl, kind: "Retrato", meta: "" })),
        ].filter((c) => P.isSource(c.key) && c.key !== "self");
        renderChoices();
      } catch (e) {
        choices = null;
        pick.innerHTML = `<p class="form-error" role="alert">${esc(e?.message || "Não foi possível listar as imagens.")}</p><button type="button" class="subtle small" data-retry>Tentar novamente</button>`;
        pick.querySelector("[data-retry]").addEventListener("click", loadChoices);
      }
    }
    function renderChoices() {
      const q = form.elements.namedItem("filter").value.trim().toLowerCase();
      const list = (choices || []).filter((c) => !q || c.name.toLowerCase().includes(q));
      pick.innerHTML = !choices?.length ? '<p class="muted small">Nenhum mapa de imagem ou retrato na campanha (mapas da pasta raiz).</p>'
        : !list.length ? '<p class="muted small">Nada com esse nome.</p>'
        : `<ul class="im-pick" aria-label="Imagens da campanha">${list.map((c, i) => `<li><button type="button" class="im-pick-item" data-choice="${i}"><img src="${esc(c.imageUrl)}" alt="" loading="lazy" decoding="async"><span><strong>${esc(c.name)}</strong><small>${esc(c.kind)}${c.meta ? ` · ${esc(c.meta)}` : ""}</small></span></button></li>`).join("")}</ul>`;
      pick.querySelectorAll("[data-choice]").forEach((b) => b.addEventListener("click", () => {
        const c = list[Number(b.dataset.choice)];
        run(b, () => api(`${base}/sources/copy`, "POST", { from: c.key }));
      }));
    }
    form.elements.namedItem("filter").addEventListener("input", () => { if (choices) renderChoices(); });
  }

  // ---------- Salvar ----------
  function compositionErrors() {
    const err = P.validateComposition(doc);
    if (err) return err;
    if (meta.hasGrid) { const g = gridInfo(); if (!g.valid) return `${g.message} (Imagem › Grade e escala)`; }
    if (!meta.name.trim()) return "Dê um nome ao mapa (Arquivo › Propriedades do mapa).";
    return null;
  }
  async function save() {
    if (saving) return false;
    if (surface.busy) { shell.message("Termine o arraste antes de salvar."); return false; }
    flushNudge();
    const error = compositionErrors();
    if (error) { shell.message(error); toast(error); return false; }
    saving = true; updateStatus();
    shell.stage.inert = true; // sem edições durante o envio: a resposta substitui o documento
    const json = P.serializeComposition(doc);
    try {
      const flat = await flattenComposition(doc, surface.cache);
      const { blob, type } = await encodeFlat(flat, MAX_IMAGE_BYTES);
      const fd = new FormData();
      fd.append("file", blob, type === "image/png" ? "mapa.png" : "mapa.jpg");
      fd.append("composition", json);
      fd.append("revision", String(map.revision));
      fd.append("name", meta.name.trim());
      fd.append("summary", meta.summary.trim());
      fd.append("gridPixels", String(Math.trunc(meta.gridPixels)));
      fd.append("scaleMeters", String(Math.round(meta.scaleMeters * 100) / 100));
      fd.append("hasGrid", meta.hasGrid ? "true" : "false");
      fd.append("gridOffsetX", String(Math.trunc(meta.gridOffsetX)));
      fd.append("gridOffsetY", String(Math.trunc(meta.gridOffsetY)));
      fd.append("freeMovement", meta.hasGrid && meta.freeMovement ? "true" : "false");
      const res = await api(`${base}/composition`, "PUT", fd);
      applySaved(res, meta.summary);
      shell.message(type === "image/png" ? "Mapa salvo." : "Mapa salvo (imagem grande: enviada em JPEG).");
      toast("Mapa salvo. Os jogadores só veem a área visível quando você mostrar o mapa na mesa.");
      try { onSaved(map); } catch { /* o editor continua aberto */ }
      return true;
    } catch (e) {
      saveFailed(e);
      return false;
    } finally { saving = false; shell.stage.inert = false; scheduleUi(); }
  }
  /** Resposta {map, composition} substitui o estado local (o servidor troca `self` por imagem-fonte e remove fontes sem uso). */
  function applySaved(res, summary) {
    if (res?.map) map = res.map;
    doc = P.normalizeComposition(res?.composition || P.clone(doc), { width: doc.artboard.width, height: doc.artboard.height });
    meta = metaFrom(map, res?.summary ?? res?.map?.summary ?? summary);
    surface.cache.clear();
    // Desfazer para antes do salvamento poderia apontar para imagens-fonte já removidas pelo servidor: o histórico recomeça.
    history.clear();
    prune();
    savedSig = signature();
    history.markSaved();
    quickKey = ""; surface.invalidate();
  }
  function saveFailed(e) {
    const msg = e?.message || "Não foi possível salvar.";
    if (e?.status === 409 && /mudou|atualize/i.test(msg)) return showConflict();
    if (e?.status === 409 && /oculte|troque o mapa|na mesa/i.test(msg)) {
      const text = "Este mapa está na mesa da sessão ativa. Oculte ou troque o mapa na mesa antes de salvar; seu rascunho continua aberto aqui.";
      shell.message(text); toast(text); return;
    }
    const text = e?.status === 413 ? "O envio passou do limite do servidor (10 MB de imagem). Reduza a área visível." : e?.status === 415 ? "O servidor recusou o formato da imagem achatada." : msg;
    shell.message(text); toast(text);
  }
  function showConflict() {
    conflict?.remove();
    conflict = document.createElement("div");
    conflict.className = "ed-stage-banner im-conflict";
    conflict.setAttribute("role", "alertdialog");
    conflict.setAttribute("aria-labelledby", "im-conflict-text");
    conflict.innerHTML = `<p id="im-conflict-text">Este mapa foi salvo em outro lugar depois que você abriu o editor. Seu rascunho continua aqui, sem salvar.</p><div class="im-conflict-actions"><button type="button" class="subtle small" data-conflict="keep">Continuar editando</button><button type="button" class="primary small" data-conflict="reload">Recarregar a versão salva</button></div>`;
    shell.stage.append(conflict);
    conflict.querySelector("[data-conflict=keep]").focus();
    conflict.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-conflict]")?.dataset.conflict;
      if (action === "keep") { conflict.remove(); conflict = null; surface.canvas.focus(); }
      if (action === "reload") {
        if (isDirty() && !confirm("Descartar o rascunho e abrir a versão salva? Alterações deste editor serão perdidas.")) return;
        try { await reload(); conflict?.remove(); conflict = null; surface.canvas.focus(); }
        catch (err) { shell.message(err?.message || "Não foi possível recarregar."); }
      }
    });
    shell.message("Conflito: o mapa mudou desde que você abriu o editor.");
  }
  async function reload() {
    const fresh = await api(`${base}/composition`);
    map = fresh.map || map;
    doc = P.normalizeComposition(fresh.composition, { width: map.pixelWidth, height: map.pixelHeight });
    meta = metaFrom(map, fresh.summary);
    surface.cache.clear(); history.clear(); selection = new Set(); prune();
    savedSig = signature(); history.markSaved();
    view.showGrid = meta.hasGrid; quickKey = "";
    surface.fit(); scheduleUi();
    shell.message("Versão salva recarregada.");
  }

  // ---------- Névoa e luz ----------
  async function prepareFog() {
    if (!meta.hasGrid) return shell.message("Ative a grade (Imagem › Grade e escala) para preparar névoa e luz.");
    if (isDirty()) {
      if (!confirm("Salvar o mapa antes de abrir a preparação de névoa e luz?")) return;
      if (!(await save())) return;
    }
    if (map.hasGrid === false) return shell.message("Salve o mapa com grade antes de preparar névoa e luz.");
    const key = map.key || `asset:${map.id}`;
    shell.close();
    await shell.whenClosed;
    await (await import("./fog-editor.js")).openLayerEditor(campaign, key);
  }

  renderUi();
  shell.message("Arraste para mover, use as alças para redimensionar e girar. Roda do mouse aproxima; espaço + arrastar move a vista.");
  setTimeout(() => surface.canvas.focus({ preventScroll: true }), 0);
  return shell.whenClosed;
}
