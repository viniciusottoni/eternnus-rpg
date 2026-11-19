// Composição da cena (ADR-090): imagens só desta cena por cima do mapa, editadas na mesma superfície gráfica e com as
// mesmas regras dos mapas de imagem (composition-canvas.js + composition-policy.js). O mapa compartilhado aparece como
// fundo travado (elemento sintético `scene-map`) e nunca é alterado aqui; ele não entra no documento salvo.
// O estado do documento pertence ao editor de cenas (rascunho e histórico); aqui ficam seleção, camada ativa e operações.
import * as P from "./composition-policy.js";
import { createCompositionSurface, createImageCache, flattenComposition } from "./composition-canvas.js";
import { publicComposition, hasPublicElements } from "./scene-policy.js";
import * as MI from "./map-instance-policy.js";
import { claimSystemClipboard, maxImageBytes } from "./image-drop.js";
import { formatBytes } from "./account-usage-policy.js";

export const MAP_ELEMENT = "scene-map";
const G = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const GUID = new RegExp(`^${G}$`);
const SAFE_IMAGE = new RegExp(`^/api/campaigns/${G}/assets/maps/${G}/image$`);

/** Documento vazio da composição no tamanho da imagem do mapa (camadas Fundo e Elementos). */
export function blankSceneComposition(width, height) {
  const doc = P.blankComposition(width, height, "#000000");
  doc.layers = doc.layers.map((l) => (l.id === "base" ? { ...l, name: "Fundo" } : l));
  return doc;
}

/** Documento do servidor normalizado; null quando a cena não tem composição. */
export const loadSceneComposition = (raw, artboard) => (raw ? P.normalizeComposition(raw, artboard) : null);

/** `src` → URL da própria campanha (imagem-fonte da cena, mapa de imagem ou retrato); `self` é a imagem do mapa da cena. */
export function sceneSourceResolver(campaignId, mapUrl) {
  return (src) => {
    if (src === "self") { const u = mapUrl(); return SAFE_IMAGE.test(String(u || "")) ? u : null; }
    const id = typeof src === "string" && src.startsWith("asset:") ? src.slice(6) : "";
    return GUID.test(id) ? `/api/campaigns/${encodeURIComponent(campaignId)}/assets/maps/${id}/image` : null;
  };
}

/** Documento de desenho: o mapa como primeiro elemento da Base, travado, e os elementos da cena por cima. */
export function withMap(doc) {
  const ab = doc.artboard;
  const map = { id: MAP_ELEMENT, layer: "base", type: "image", name: "Mapa (compartilhado)", src: "self", x: 0, y: 0, width: ab.width, height: ab.height, rotation: 0, opacity: 100, visible: true, locked: true, flipX: false, flipY: false };
  return { ...doc, elements: [map, ...doc.elements] };
}

/** Prévia do tabuleiro: mapa + elementos visíveis no editor (o mestre vê também os "só o mestre vê"). → URL blob. */
export async function flattenPreview(doc, cache) {
  const canvas = await flattenComposition(withMap(doc), cache);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("O navegador não conseguiu gerar a prévia da composição.");
  return URL.createObjectURL(blob);
}

/**
 * Sobreposição enviada ao servidor: PNG transparente do tamanho do mapa, só com o que os jogadores podem ver.
 * Null quando não há nada público (a mesa mostra só o mapa).
 */
export async function flattenOverlay(doc, cache, maxBytes = maxImageBytes()) {
  if (!doc || !hasPublicElements(doc)) return null;
  const canvas = await flattenComposition(publicComposition(doc), cache, { transparent: true });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("O navegador não conseguiu gerar a imagem da composição.");
  // Mesmo limite que o servidor aplica (maior arquivo do plano, ADR-102). PNG obrigatório: a camada é transparente.
  if (blob.size > maxBytes) throw new Error(`A composição achatada passa de ${formatBytes(maxBytes)}, o limite de arquivo do seu plano. Use imagens menores ou menos elementos.`);
  return blob;
}

export { createImageCache };

/**
 * Controlador da composição sobre a superfície gráfica comum. `opts`:
 * { host, doc(): documento|null, tool(): ferramenta do núcleo, resolveSrc, options(): { snap, snapObjects, grid },
 *   change(label, fn) → bool (histórico do editor), begin(label), commit(), cancel(),
 *   onSelection(), onLive() (durante arrastes), onContext(at, id, point), cursor(point|null), camera(), say(text) }.
 */
export function createSceneComposer(opts) {
  let selection = new Set(), activeLayer = "elements", clipboard = null, pasteCount = 0, mapEl = null;
  /** Mapas inseridos (ADR-113): { mapOf(key), grid() → grade da cena|null, snap() → encaixe ligado }. Configurado pelo editor. */
  let instances = null;
  const instanceSnap = (el) => {
    if (!instances?.snap?.() || !MI.isMapInstance(el)) return null;
    const m = instances.mapOf(el.mapKey), g = instances.grid();
    return m && g && MI.canInstance(m) ? MI.snapInstance(el, m, g) : null;
  };
  /** Ao soltar um arraste, giro ou redimensionamento, os mapas inseridos voltam a encaixar na grade da cena. */
  function resnapSelected() { for (const el of editableSelection()) { const patch = instanceSnap(el); if (patch) Object.assign(el, patch); } }
  const doc = () => opts.doc();
  const EMPTY = { v: 1, artboard: { width: 64, height: 64, background: "#000000" }, layers: P.normalizeLayers([]), elements: [] };
  // Os elementos são os mesmos objetos do rascunho: o arraste da superfície altera o rascunho diretamente (histórico em begin/commit).
  function drawDoc() {
    const d = doc();
    if (!d) return EMPTY;
    if (!mapEl || mapEl.width !== d.artboard.width || mapEl.height !== d.artboard.height) mapEl = withMap(d).elements[0];
    return { v: 1, artboard: d.artboard, layers: d.layers, elements: [mapEl, ...d.elements] };
  }
  const layerOf = (el) => doc()?.layers.find((l) => l.id === el.layer);
  const editable = (el) => !!el && el.id !== MAP_ELEMENT && !el.locked && !layerOf(el)?.locked;
  const selected = () => (doc()?.elements || []).filter((e) => selection.has(e.id));
  const editableSelection = () => selected().filter(editable);
  function select(ids, additive) {
    const next = additive ? new Set(selection) : new Set();
    for (const id of ids) {
      if (id === MAP_ELEMENT) continue;
      if (additive === true && next.has(id)) next.delete(id); else next.add(id);
    }
    selection = next;
    const first = selected()[0];
    if (first) activeLayer = first.layer;
    surface.invalidate();
    opts.onSelection?.();
  }
  function prune() {
    const d = doc();
    const ids = new Set((d?.elements || []).map((e) => e.id));
    selection = new Set([...selection].filter((id) => ids.has(id)));
    if (!d?.layers.some((l) => l.id === activeLayer)) activeLayer = "elements";
  }

  const surface = createCompositionSurface(opts.host, {
    doc: drawDoc,
    selection: () => selection,
    tool: () => (["select", "hand", "zoom"].includes(opts.tool()) ? opts.tool() : "select"),
    options: () => ({ showGrid: !!opts.options?.().grid, snap: opts.options?.().snap !== false, snapObjects: opts.options?.().snapObjects !== false, hideOutside: false, grid: opts.options?.().grid || null, keepRatio: opts.keepRatio?.() !== false }),
    resolveSrc: opts.resolveSrc,
    cache: opts.cache,
    // Clicar num membro de grupo seleciona o grupo inteiro (mesma regra do editor de mapas).
    select: (ids, additive) => select(P.expandGroups(doc() || { elements: [] }, ids), additive),
    begin: (label) => opts.begin(label),
    changed: () => opts.onLive?.(),
    commit: () => { resnapSelected(); opts.commit(); },
    cancel: () => opts.cancel(),
    create: () => {},
    crop: () => {},
    context: (at, id, point) => opts.onContext?.(at, id === MAP_ELEMENT ? null : id, point),
    open: (id) => { if (id !== MAP_ELEMENT) opts.onOpen?.(id); },
    cursor: (p) => opts.cursor?.(p),
    camera: () => opts.camera?.(),
  });

  // ---------- Criar ----------
  function canAdd(n = 1) {
    const d = doc();
    if (!d) return false;
    if (d.elements.length + n > P.LIMITS.elements) { opts.say(`Use até ${P.LIMITS.elements} elementos por cena.`); return false; }
    const layer = d.layers.find((l) => l.id === activeLayer);
    if (layer?.locked) { opts.say(`A camada ${layer.name} está bloqueada. Desbloqueie ou escolha outra camada.`); return false; }
    if (layer && !layer.visible) opts.say(`A camada ${layer.name} está oculta no editor: o novo elemento não aparece até mostrá-la.`);
    return true;
  }
  /** Imagem ({ key|src, name, width, height }) no tamanho natural, centrada em `point` (documento). → elemento ou null. */
  function addImage(source, point, { fill = false, label = "Adicionar imagem", fitLarge = true } = {}) {
    if (!canAdd()) return null;
    const d = doc();
    const src = source.key || source.src || `asset:${source.id}`;
    let w = Math.max(1, Math.min(P.LIMITS.sizeMax, Number(source.width) || 256)), h = Math.max(1, Math.min(P.LIMITS.sizeMax, Number(source.height) || 256));
    // Imagem maior que a área visível entra inteira, com a proporção mantida (Tamanho original desfaz; Preencher cobre a área).
    if (fitLarge && !fill && (w > d.artboard.width || h > d.artboard.height)) {
      const k = Math.min(d.artboard.width / w, d.artboard.height / h);
      w = Math.max(1, Math.round(w * k * 100) / 100); h = Math.max(1, Math.round(h * k * 100) / 100);
      opts.say?.("Imagem maior que a área visível: reduzida para caber inteira, mantendo a proporção. Tamanho original desfaz.");
    }
    const p = point || surface.viewCenter();
    const el = P.normalizeElement({ id: P.newElementId(d.elements, "image"), layer: activeLayer, type: "image", name: String(source.name || "Imagem").slice(0, 80), src, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), width: w, height: h });
    if (fill) Object.assign(el, P.fitToArtboard(el, d.artboard, "fill"));
    P.clampGeometry(el);
    if (!opts.change(label, () => { doc().elements.push(el); })) return null;
    selection = new Set([el.id]);
    surface.invalidate(); opts.onSelection?.();
    return el;
  }

  /** Mapa da campanha inserido como instância (ADR-113), já encaixado na grade da cena e centrado em `point`. */
  function addMapInstance(map, grid, point) {
    if (!canAdd()) return null;
    const d = doc();
    const placed = MI.placeInstance(map, grid, point || surface.viewCenter());
    const el = P.normalizeElement({ ...placed, id: P.newElementId(d.elements, "image"), layer: activeLayer, name: String(map.name || "Mapa").slice(0, 80) });
    P.clampGeometry(el);
    if (!opts.change(`Inserir mapa “${el.name}”`, () => { doc().elements.push(el); })) return null;
    selection = new Set([el.id]);
    surface.invalidate(); opts.onSelection?.();
    return el;
  }
  /** Encaixa os mapas inseridos selecionados na grade da cena (escala da casa, giro de 90° e linhas). */
  function snapInstances() {
    const els = editableSelection().filter(MI.isMapInstance);
    if (!els.length) { opts.say("Selecione um mapa inserido e desbloqueado."); return false; }
    const g = instances?.grid();
    if (!g) { opts.say("A cena precisa de grade (mapa tático ou área em branco jogável) para encaixar mapas."); return false; }
    const ok = els.filter((el) => MI.canInstance(instances.mapOf(el.mapKey)));
    if (!ok.length) { opts.say("O mapa original não está mais disponível ou não tem grade."); return false; }
    opts.change("Encaixar na grade da cena", () => { for (const el of ok) { Object.assign(el, MI.snapInstance(el, instances.mapOf(el.mapKey), g)); P.clampGeometry(el); } });
    surface.invalidate();
    opts.say(ok.length === 1 ? "Mapa encaixado na grade da cena." : `${ok.length} mapas encaixados na grade da cena.`);
    return true;
  }
  /** Seleciona o mapa inserido seguinte (dir 1) ou anterior (−1). */
  function selectInstance(dir) {
    const id = MI.nextInstance(doc()?.elements, selected().find(MI.isMapInstance)?.id || null, dir);
    if (!id) { opts.say("Nenhum mapa inserido nesta cena."); return null; }
    select([id], false);
    return id;
  }

  // ---------- Editar ----------
  function copy() {
    const els = selected();
    if (!els.length) return opts.say("Selecione uma imagem para copiar.");
    clipboard = P.clone(els); pasteCount = 0; claimSystemClipboard();
    opts.say(els.length === 1 ? "Elemento copiado." : `${els.length} elementos copiados.`);
  }
  function cut() {
    const els = editableSelection();
    if (!els.length) return opts.say("Selecione um elemento desbloqueado para recortar.");
    clipboard = P.clone(els); pasteCount = 0; claimSystemClipboard();
    const ids = new Set(els.map((e) => e.id));
    opts.change("Recortar", () => { const d = doc(); d.elements = d.elements.filter((e) => !ids.has(e.id)); });
    selection = new Set(); surface.invalidate(); opts.onSelection?.();
  }
  function paste(at = null) {
    if (!clipboard?.length) return false;
    if (!canAdd(clipboard.length)) return true;
    pasteCount++;
    let dx = 16 * pasteCount, dy = 16 * pasteCount;
    // Ponteiro em cima do original (acabou de clicar nele): a cópia nasceria sobreposta e pareceria que nada colou.
    // Nesse caso vale o deslocamento em escada; fora dele, a cópia centraliza no ponteiro.
    const b = P.unionBounds(clipboard);
    if (at && !(at.x >= b.x && at.x <= b.x + b.width && at.y >= b.y && at.y <= b.y + b.height)) { dx = at.x - (b.x + b.width / 2); dy = at.y - (b.y + b.height / 2); }
    const d = doc();
    const copies = P.regroupCopies(P.cloneElements(clipboard, d.elements, dx, dy).map((e) => ({ ...e, layer: activeLayer, locked: false })), d.elements);
    opts.change("Colar", () => { doc().elements.push(...copies); });
    selection = new Set(copies.map((e) => e.id)); surface.invalidate(); opts.onSelection?.();
    return true;
  }
  function duplicate() {
    const els = selected();
    if (!els.length) return opts.say("Selecione um elemento para duplicar.");
    const d = doc();
    if (d.elements.length + els.length > P.LIMITS.elements) return opts.say(`Use até ${P.LIMITS.elements} elementos por cena.`);
    const copies = P.regroupCopies(P.cloneElements(els, d.elements, 16, 16).map((e) => ({ ...e, locked: false })), d.elements);
    opts.change("Duplicar", () => { doc().elements.push(...copies); });
    selection = new Set(copies.map((e) => e.id)); surface.invalidate(); opts.onSelection?.();
  }
  function remove() {
    const els = selected();
    if (!els.length) return false;
    const removable = els.filter(editable);
    if (!removable.length) { opts.say("Elemento bloqueado: desbloqueie para excluir."); return true; }
    const ids = new Set(removable.map((e) => e.id));
    opts.change(removable.length === 1 ? "Excluir elemento" : `Excluir ${removable.length} elementos`, () => { const d = doc(); d.elements = d.elements.filter((e) => !ids.has(e.id)); });
    selection = new Set(); surface.invalidate(); opts.onSelection?.();
    opts.say(`${removable.length === 1 ? "Elemento excluído" : `${removable.length} elementos excluídos`}${removable.length < els.length ? "; bloqueados foram mantidos" : ""}. Ctrl+Z desfaz.`);
    return true;
  }
  function transform(label, fn) {
    const els = editableSelection();
    if (!els.length) return opts.say("Selecione um elemento desbloqueado.");
    opts.change(label, () => { for (const el of els) { fn(el); P.clampGeometry(el); } });
    surface.invalidate();
  }
  /** Ajustar (inteira na área), Preencher (cobre a área, pode recortar), Tamanho original e Centralizar. */
  function fit(mode) {
    const ab = doc()?.artboard;
    if (!ab) return;
    if (mode === "original") {
      return transform("Tamanho original", (el) => {
        const img = el.type === "image" ? surface.cache.get(el.src) : null;
        if (img?.state !== "ready") return;
        const c = P.center(el);
        el.width = img.img.naturalWidth; el.height = img.img.naturalHeight;
        el.x = c.x - el.width / 2; el.y = c.y - el.height / 2;
      });
    }
    if (mode === "center") return transform("Centralizar", (el) => { el.x = (ab.width - el.width) / 2; el.y = (ab.height - el.height) / 2; });
    transform(mode === "fill" ? "Preencher a área visível" : "Ajustar à área visível", (el) => Object.assign(el, P.fitToArtboard(el, ab, mode)));
  }
  const flip = (axis) => transform(axis === "x" ? "Espelhar na horizontal" : "Espelhar na vertical", (el) => { if (axis === "x") el.flipX = !el.flipX; else el.flipY = !el.flipY; });
  const rotate = (deg) => transform(deg > 0 ? "Girar 90° à direita" : "Girar 90° à esquerda", (el) => { el.rotation = P.normalizeRotation(el.rotation + deg); const patch = instanceSnap(el); if (patch) Object.assign(el, patch); });
  function zorder(op) {
    const els = editableSelection();
    if (!els.length) return opts.say("Selecione um elemento desbloqueado.");
    const label = { front: "Trazer para frente", forward: "Avançar", backward: "Recuar", back: "Enviar para trás" }[op];
    opts.change(label, () => { const d = doc(); d.elements = P.reorder(d, els.map((e) => e.id), op); });
    surface.invalidate();
  }
  function align(mode) {
    const els = editableSelection();
    if (!els.length) return opts.say("Selecione um elemento desbloqueado.");
    const ab = doc().artboard;
    const ref = els.length >= 2 ? P.unionBounds(els) : { x: 0, y: 0, width: ab.width, height: ab.height };
    const offsets = P.alignOffsets(els, mode, ref);
    opts.change("Alinhar", () => { for (const el of els) { const o = offsets.get(el.id); el.x += o.dx; el.y += o.dy; P.clampGeometry(el); } });
    surface.invalidate();
  }
  /** Bloquear, ocultar no editor ou "só o mestre vê" (alterna para toda a seleção). */
  function toggle(flag) {
    const els = selected();
    if (!els.length) return;
    const on = flag === "visible" ? !els.every((e) => e.visible) : !els.every((e) => e[flag]);
    const label = { locked: on ? "Bloquear" : "Desbloquear", visible: on ? "Mostrar no editor" : "Ocultar no editor", secret: on ? "Só o mestre vê" : "Visível para os jogadores" }[flag];
    opts.change(label, () => { for (const el of els) { if (flag === "secret" && !on) delete el.secret; else el[flag] = on; } });
    surface.invalidate();
  }
  function group(on) {
    const els = editableSelection();
    if (on) {
      const plan = P.planGroup(doc(), els.map((e) => e.id));
      if (plan.error) return opts.say(plan.error);
      opts.change("Agrupar", () => { for (const el of doc().elements) if (plan.ids.includes(el.id)) el.group = plan.group; });
      return opts.say(`${plan.ids.length} elementos agrupados.`);
    }
    const groups = new Set(els.filter((e) => e.group).map((e) => e.group));
    if (!groups.size) return opts.say("Selecione um grupo desbloqueado para desagrupar.");
    opts.change("Desagrupar", () => { for (const el of doc().elements) if (el.group && groups.has(el.group)) delete el.group; });
  }
  function moveToLayer(id) {
    const d = doc(), target = d?.layers.find((l) => l.id === id);
    const els = editableSelection();
    if (!target || !els.length) return opts.say("Selecione elementos desbloqueados.");
    if (target.locked) return opts.say(`A camada ${target.name} está bloqueada.`);
    opts.change(`Mover para ${target.name}`, () => { for (const el of els) el.layer = id; });
    activeLayer = id; surface.invalidate();
  }
  /** Campo da barra de propriedades (x, y, largura, altura, giro, opacidade, proporção) aplicado ao selecionado. */
  function setField(name, value) {
    const els = editableSelection();
    if (!els.length) return;
    if (name === "layer") return moveToLayer(String(value));
    if (name === "locked" || name === "secret" || name === "visible") return toggle(name);
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const labels = { x: "Posição X", y: "Posição Y", width: "Largura", height: "Altura", rotation: "Rotação", opacity: "Opacidade" };
    opts.change(labels[name] || "Propriedades", () => {
      for (const el of els) {
        if (name === "width" || name === "height") {
          // Proporção mantida por padrão (como nas alças); "Liberar proporção" na barra solta.
          const ratio = el.height > 0 ? el.width / el.height : 1;
          const keep = opts.keepRatio?.() !== false;
          if (name === "width") { el.width = Math.max(1, n); if (keep) el.height = Math.max(1, Math.round((n / ratio) * 100) / 100); }
          else { el.height = Math.max(1, n); if (keep) el.width = Math.max(1, Math.round(n * ratio * 100) / 100); }
        } else if (name === "rotation") el.rotation = P.normalizeRotation(n);
        else if (name === "opacity") el.opacity = Math.max(0, Math.min(100, n));
        else el[name] = n;
        P.clampGeometry(el);
      }
    });
    surface.invalidate();
  }
  // Setas: 1 px (Shift 10 px), uma entrada no histórico por sequência.
  let nudgeTimer = 0, nudging = false;
  function flushNudge() { if (!nudging) return; clearTimeout(nudgeTimer); nudging = false; opts.commit(); }
  function nudge(dx, dy) {
    const els = editableSelection();
    if (!els.length) return false;
    if (!nudging) { opts.begin("Mover com o teclado"); nudging = true; }
    // Mapa inserido com encaixe ligado anda de casa em casa (1 px quebraria o alinhamento com a grade da cena).
    const cell = els.every((el) => instanceSnap(el)) ? instances.grid().size : 1;
    for (const el of els) { el.x += dx * cell; el.y += dy * cell; P.clampGeometry(el); }
    surface.invalidate(); opts.onLive?.();
    clearTimeout(nudgeTimer); nudgeTimer = setTimeout(flushNudge, 700);
    return true;
  }
  const docPoint = (p) => { const r = surface.canvas.getBoundingClientRect(); return surface.toDoc(p.clientX - r.left, p.clientY - r.top); };

  return {
    surface,
    get selection() { return selection; },
    get activeLayer() { return activeLayer; },
    set activeLayer(id) { activeLayer = id; },
    get hasClipboard() { return !!clipboard?.length; },
    selected, editableSelection, editable, select, prune,
    addImage, addMapInstance, snapInstances, selectInstance, setInstances: (cfg) => { instances = cfg; },
    copy, cut, paste, duplicate, remove, transform, fit, flip, rotate, zorder, align, toggle, group, moveToLayer, setField, nudge, flushNudge,
    docPoint, viewCenter: () => surface.viewCenter(), lastPointer: () => surface.lastPointer(),
    invalidate: () => surface.invalidate(),
    destroy() { flushNudge(); surface.destroy(); },
  };
}
