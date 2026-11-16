// Superfície de composição dos mapas de imagem (ADR-081): desenho em canvas, câmera própria e manipulação direta.
// O estado do documento e da seleção pertence ao editor (`ctl`); aqui só há câmera, arrastes em andamento e cache de imagens.
// A câmera nunca muda as coordenadas dos elementos (pixels do documento). Desenho sob demanda (requestAnimationFrame único).
import { fitScale, stepZoom, zoomAround } from "./editor-policy.js";
import {
  HANDLES, artboardStatus, center, elementBounds, elementsInRect, handleAngle, handlePoints, hitTest, paintOrder,
  rectFromPoints, resizeFromHandle, rotateFromPointer, snapMove, snapPoint, clampGeometry, unionBounds, isSelectable,
} from "./composition-policy.js";

const MIN_SCALE = 0.02, MAX_SCALE = 16;
const ROTATE_GAP = 28; // distância da alça de giro acima do topo (px de tela)
export const FONT_STACKS = Object.freeze({
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Segoe UI", Arial, sans-serif',
  display: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
});

// ---------- Cache de imagens ----------
/** Imagens por `src` (`self`/`asset:{guid}`), com estado loading|ready|error. `onChange` redesenha ao terminar. */
export function createImageCache(resolveUrl, onChange = () => {}) {
  const map = new Map();
  function load(src) {
    const url = resolveUrl(src);
    const entry = { state: url ? "loading" : "error", img: null, promise: null };
    if (!url) { entry.promise = Promise.resolve(entry); return entry; }
    const img = new Image();
    img.decoding = "async";
    entry.promise = new Promise((resolve) => {
      img.onload = () => { entry.state = "ready"; entry.img = img; onChange(); resolve(entry); };
      img.onerror = () => { entry.state = "error"; onChange(); resolve(entry); };
    });
    img.src = url;
    return entry;
  }
  const get = (src) => { let e = map.get(src); if (!e) { e = load(src); map.set(src, e); } return e; };
  return {
    get,
    ready: (srcs) => Promise.all([...new Set(srcs)].map((s) => get(s).promise)),
    retry(src) { if (map.get(src)?.state === "error") map.delete(src); return get(src); },
    clear() { map.clear(); },
  };
}

// ---------- Desenho dos elementos (tela e achatamento usam o mesmo código) ----------
/** Linhas do texto quebradas pela largura do elemento (ctx já com a fonte). */
export function layoutText(ctx, el) {
  const lines = [];
  for (const para of String(el.text ?? "").split("\n")) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (line && ctx.measureText(next.trimEnd()).width > el.width) { lines.push(line.trimEnd()); line = w.trimStart(); }
      else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export const textFont = (el) => `${el.italic ? "italic " : ""}${el.bold ? "700" : "400"} ${el.fontSize}px ${FONT_STACKS[el.fontFamily] || FONT_STACKS.serif}`;
/** Altura que cabe o texto inteiro (para ajustar a caixa após editar). */
export function textHeight(el) {
  const c = document.createElement("canvas").getContext("2d");
  c.font = textFont(el);
  return Math.max(el.fontSize * 1.25, layoutText(c, el).length * el.fontSize * 1.25);
}
export function textWidth(el) {
  const c = document.createElement("canvas").getContext("2d");
  c.font = textFont(el);
  return Math.max(...String(el.text || " ").split("\n").map((l) => c.measureText(l).width), el.fontSize);
}

function drawPlaceholder(ctx, el, label) {
  const w = el.width, h = el.height;
  ctx.fillStyle = "#2b2b2b"; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = "#8a6a2a"; ctx.lineWidth = Math.max(1, Math.min(w, h) / 200);
  ctx.beginPath();
  const step = Math.max(12, Math.min(w, h) / 8);
  ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
  ctx.beginPath();
  for (let d = -h; d < w; d += step) { ctx.moveTo(-w / 2 + d, -h / 2); ctx.lineTo(-w / 2 + d + h, h / 2); }
  ctx.stroke(); ctx.restore();
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "#f0c977"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `${Math.max(10, Math.min(w, h) / 10)}px "Segoe UI", Arial, sans-serif`;
  ctx.fillText(label, 0, 0, w * 0.9);
}

/** Desenha um elemento no contexto atual (documento → contexto já aplicado). `placeholder` marca imagens ausentes. */
export function drawElement(ctx, el, cache, alpha, { placeholder = true } = {}) {
  if (alpha <= 0) return;
  const c = center(el);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(c.x, c.y);
  ctx.rotate(((el.rotation || 0) * Math.PI) / 180);
  if (el.flipX || el.flipY) ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
  const w = el.width, h = el.height;
  if (el.type === "image") {
    const entry = cache.get(el.src);
    if (entry.state === "ready") ctx.drawImage(entry.img, -w / 2, -h / 2, w, h);
    else if (placeholder) drawPlaceholder(ctx, el, entry.state === "loading" ? "Carregando…" : "Imagem indisponível");
  } else if (el.type === "text") {
    ctx.font = textFont(el);
    ctx.fillStyle = el.color || "#ffffff";
    ctx.textBaseline = "top";
    ctx.textAlign = el.align || "left";
    const x = el.align === "center" ? 0 : el.align === "right" ? w / 2 : -w / 2;
    const lh = el.fontSize * 1.25;
    layoutText(ctx, el).forEach((line, i) => ctx.fillText(line, x, -h / 2 + i * lh + el.fontSize * 0.1));
  } else {
    ctx.beginPath();
    if (el.type === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(-w / 2, -h / 2, w, h);
    if (el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
    if (el.stroke && el.strokeWidth > 0) { ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeWidth; ctx.stroke(); }
  }
  ctx.restore();
}

/** Camadas visíveis e elementos visíveis na ordem, com opacidade camada × elemento. */
export function renderElements(ctx, doc, cache, opts) {
  const layers = new Map(doc.layers.map((l) => [l.id, l]));
  for (const el of paintOrder(doc)) {
    const layer = layers.get(el.layer);
    if (!layer?.visible || !el.visible) continue;
    drawElement(ctx, el, cache, (layer.opacity / 100) * (el.opacity / 100), opts);
  }
}

/** Fontes usadas pelas camadas/elementos visíveis. */
export function visibleSources(doc) {
  const layers = new Map(doc.layers.map((l) => [l.id, l]));
  return doc.elements.filter((e) => e.type === "image" && e.visible && layers.get(e.layer)?.visible).map((e) => e.src);
}

/**
 * Achata o documento fora da tela exatamente no tamanho do artboard: fundo, camadas/elementos visíveis, transformações.
 * O que está na área externa fica de fora (o canvas recorta). Recusa se alguma imagem visível não carregou.
 */
export async function flattenComposition(doc, cache) {
  const entries = await cache.ready(visibleSources(doc));
  if (entries.some((e) => e.state !== "ready")) throw new Error("Uma imagem visível não carregou. Recarregue o editor ou oculte/exclua o elemento marcado como indisponível.");
  const canvas = document.createElement("canvas");
  canvas.width = doc.artboard.width; canvas.height = doc.artboard.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não liberou o desenho em canvas.");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = doc.artboard.background || "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderElements(ctx, doc, cache, { placeholder: false });
  return canvas;
}

/** PNG; acima de `maxBytes`, JPEG 0,92 e depois 0,85. Erro se ainda passar do limite. → { blob, type }. */
export async function encodeFlat(canvas, maxBytes) {
  const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  for (const [type, quality] of [["image/png"], ["image/jpeg", 0.92], ["image/jpeg", 0.85]]) {
    const blob = await toBlob(type, quality);
    if (!blob) throw new Error("O navegador não conseguiu gerar a imagem do mapa.");
    if (blob.size <= maxBytes) return { blob, type };
  }
  throw new Error("A imagem achatada passa de 10 MB mesmo em JPEG. Reduza a área visível (Imagem › Tamanho do documento).");
}

// ---------- Superfície interativa ----------
/**
 * `ctl`: { doc(), selection(): Set, tool(), options(): { showGrid, snap, hideOutside, grid:{size,offsetX,offsetY}|null },
 * resolveSrc(src), select(ids, additive), begin(label), changed(), commit(), cancel(), create(type, rect, point), crop(rect),
 * context(clientPoint, id|null, docPoint), open(id), cursor(docPoint|null), camera() }.
 */
export function createCompositionSurface(host, ctl) {
  const canvas = document.createElement("canvas");
  canvas.className = "im-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "área de composição");
  host.append(canvas);
  const ctx = canvas.getContext("2d");
  const cam = { x: 0, y: 0, scale: 1 };
  let width = 0, height = 0, dpr = 1, frame = 0, fitted = false, panHold = false, drag = null, hover = null, lastDoc = null, disposed = false;
  const touches = new Map();
  let pinch = null;
  const cache = createImageCache((src) => ctl.resolveSrc(src), () => invalidate());
  const pattern = (() => {
    const p = document.createElement("canvas"); p.width = p.height = 32;
    const g = p.getContext("2d");
    g.fillStyle = "#26272a"; g.fillRect(0, 0, 32, 32);
    g.fillStyle = "#2e3033"; g.fillRect(0, 0, 16, 16); g.fillRect(16, 16, 16, 16);
    return ctx.createPattern(p, "repeat");
  })();

  // ---------- Câmera ----------
  const toDoc = (sx, sy) => ({ x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale });
  const toScreen = (x, y) => ({ x: x * cam.scale + cam.x, y: y * cam.scale + cam.y });
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function setView(v) { cam.x = v.x; cam.y = v.y; cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale)); invalidate(); ctl.camera?.(); }
  function zoomAt(next, sx, sy) { setView(zoomAround(cam, Math.max(MIN_SCALE, Math.min(MAX_SCALE, next)), sx, sy)); }
  function fit() {
    const ab = ctl.doc().artboard;
    const s = fitScale(ab.width, ab.height, width, height, 40);
    setView({ scale: s, x: (width - ab.width * s) / 2, y: (height - ab.height * s) / 2 });
  }
  function fitRect(r) {
    const s = Math.min(fitScale(r.width, r.height, width, height, 60), 4);
    setView({ scale: s, x: width / 2 - (r.x + r.width / 2) * s, y: height / 2 - (r.y + r.height / 2) * s });
  }
  const camera = {
    zoomIn: () => zoomAt(stepZoom(cam.scale, 1, MIN_SCALE, MAX_SCALE), width / 2, height / 2),
    zoomOut: () => zoomAt(stepZoom(cam.scale, -1, MIN_SCALE, MAX_SCALE), width / 2, height / 2),
    fit,
    actual: () => zoomAt(1, width / 2, height / 2),
    zoom: () => cam.scale,
    setPanHold(on) { panHold = !!on; updateCursor(); },
    setPan(x, y) { setView({ ...cam, x, y }); },
    /** Origem do documento (canto da área visível) em coordenadas da janela e a escala atual (réguas). */
    view: () => { const r = canvas.getBoundingClientRect(); return { left: r.left + cam.x, top: r.top + cam.y, scale: cam.scale }; },
  };

  // ---------- Tamanho ----------
  function resize() {
    const r = host.getBoundingClientRect();
    width = Math.max(1, Math.floor(r.width)); height = Math.max(1, Math.floor(r.height));
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    if (!fitted && r.width > 0 && r.height > 0) { fitted = true; fit(); }
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  function invalidate() { if (!frame && !disposed) frame = requestAnimationFrame(draw); }

  // ---------- Desenho ----------
  function draw() {
    frame = 0;
    if (disposed || !width) return;
    const doc = ctl.doc(), ab = doc.artboard, opts = ctl.options(), sel = ctl.selection(), s = cam.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pattern || "#2a2b2e"; ctx.fillRect(0, 0, width, height);
    const a = toScreen(0, 0), aw = ab.width * s, ah = ab.height * s;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
    ctx.fillStyle = ab.background || "#000000"; ctx.fillRect(a.x, a.y, aw, ah); ctx.restore();
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * cam.x, dpr * cam.y);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = s < 1 ? "medium" : "high";
    renderElements(ctx, doc, cache, { placeholder: true });
    ctx.restore();
    {
      // Área externa: escurecida (elementos continuam visíveis e editáveis) ou encoberta ("Mostrar área externa" desligado).
      ctx.save(); ctx.fillStyle = opts.hideOutside ? "#1d1e21" : "rgba(10,11,9,.62)";
      ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.rect(a.x, a.y, aw, ah); ctx.fill("evenodd");
      ctx.restore();
    }
    if (opts.showGrid && opts.grid?.size >= 1 && opts.grid.size * s >= 4) drawGrid(opts.grid, ab, a, s);
    // Borda da área visível.
    ctx.save(); ctx.strokeStyle = "#e6cf98"; ctx.lineWidth = 1.5; ctx.strokeRect(Math.round(a.x) - 0.75, Math.round(a.y) - 0.75, Math.round(aw) + 1.5, Math.round(ah) + 1.5); ctx.restore();
    // Contorno de passagem do cursor.
    if (hover && !sel.has(hover.id) && !drag) outline(hover, "rgba(230,207,152,.55)", 1, [4, 3]);
    const selected = doc.elements.filter((e) => sel.has(e.id));
    for (const el of selected) outline(el, isLocked(el) ? "#b0aea4" : "#4fc3f7", 1.5, isLocked(el) ? [5, 4] : []);
    if (selected.length > 1) { const b = unionBounds(selected); const p = toScreen(b.x, b.y); ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = "#4fc3f7"; ctx.strokeRect(p.x - 0.5, p.y - 0.5, b.width * s + 1, b.height * s + 1); ctx.restore(); }
    const single = handleTarget();
    if (single) drawHandles(single);
    if (drag?.kind === "marquee" || drag?.kind === "draw" || drag?.kind === "crop") drawRubber(drag);
    if (drag?.guides?.length) drawGuides(drag.guides);
    if (drag?.readout) drawReadout(drag.readout, drag.at);
  }
  function drawGrid(grid, ab, a, s) {
    ctx.save();
    ctx.beginPath(); ctx.rect(a.x, a.y, ab.width * s, ab.height * s); ctx.clip();
    ctx.strokeStyle = "rgba(240,215,156,.38)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = grid.offsetX || 0; x <= ab.width; x += grid.size) { const sx = Math.round(a.x + x * s) + 0.5; ctx.moveTo(sx, a.y); ctx.lineTo(sx, a.y + ab.height * s); }
    for (let y = grid.offsetY || 0; y <= ab.height; y += grid.size) { const sy = Math.round(a.y + y * s) + 0.5; ctx.moveTo(a.x, sy); ctx.lineTo(a.x + ab.width * s, sy); }
    ctx.stroke(); ctx.restore();
  }
  function outline(el, color, w, dash) {
    const pts = handlePoints(el, 0);
    const ring = ["nw", "ne", "se", "sw"].map((h) => toScreen(pts[h].x, pts[h].y));
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
    ctx.beginPath(); ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  function drawHandles(el) {
    const pts = handlePoints(el, ROTATE_GAP / cam.scale);
    const top = toScreen(pts.n.x, pts.n.y), rot = toScreen(pts.rotate.x, pts.rotate.y);
    ctx.save();
    ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
    ctx.fillStyle = "#12140f"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(rot.x, rot.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#f4f7f8"; ctx.strokeStyle = "#1f6d91";
    for (const h of HANDLES) { const p = toScreen(pts[h].x, pts[h].y); ctx.fillRect(p.x - 4.5, p.y - 4.5, 9, 9); ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9); }
    ctx.restore();
  }
  function drawRubber(d) {
    const r = rectFromPoints(d.p0, d.p1), p = toScreen(r.x, r.y);
    ctx.save();
    ctx.setLineDash(d.kind === "marquee" ? [4, 3] : d.kind === "crop" ? [8, 4] : []);
    ctx.strokeStyle = d.kind === "crop" ? "#f0c977" : "#4fc3f7"; ctx.lineWidth = 1.5;
    ctx.fillStyle = d.kind === "marquee" ? "rgba(79,195,247,.12)" : d.kind === "crop" ? "rgba(240,201,119,.08)" : "rgba(79,195,247,.08)";
    if (d.kind === "draw" && d.type === "ellipse") { ctx.beginPath(); ctx.ellipse(p.x + (r.width * cam.scale) / 2, p.y + (r.height * cam.scale) / 2, (r.width * cam.scale) / 2, (r.height * cam.scale) / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(p.x, p.y, r.width * cam.scale, r.height * cam.scale); ctx.strokeRect(p.x, p.y, r.width * cam.scale, r.height * cam.scale); }
    ctx.restore();
    if (d.kind !== "marquee") drawReadout(`${Math.round(r.width)} × ${Math.round(r.height)} px`, d.at);
  }
  function drawGuides(guides) {
    ctx.save(); ctx.strokeStyle = "#ff5fa2"; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const g of guides) {
      if (g.axis === "x") { const x = Math.round(toScreen(g.at, 0).x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      else { const y = Math.round(toScreen(0, g.at).y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(width, y); }
    }
    ctx.stroke(); ctx.restore();
  }
  function drawReadout(text, at) {
    if (!text || !at) return;
    ctx.save();
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const x = Math.min(width - w - 4, at.x + 16), y = Math.min(height - 26, at.y + 18);
    ctx.fillStyle = "rgba(18,20,15,.92)"; ctx.strokeStyle = "#6d5a33";
    ctx.fillRect(x, y, w, 22); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 21);
    ctx.fillStyle = "#ecebe3"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 6, y + 11);
    ctx.restore();
  }

  // ---------- Estado auxiliar ----------
  function isLocked(el) { const l = ctl.doc().layers.find((x) => x.id === el.layer); return !!(el.locked || l?.locked); }
  /** Único selecionado e editável: recebe alças. */
  function handleTarget() {
    const sel = ctl.selection();
    if (sel.size !== 1) return null;
    const el = ctl.doc().elements.find((e) => sel.has(e.id));
    return el && !isLocked(el) ? el : null;
  }
  function handleAt(sp, touch) {
    const el = handleTarget(); if (!el) return null;
    const r = touch ? 16 : 8;
    const pts = handlePoints(el, ROTATE_GAP / cam.scale);
    const near = (p) => { const q = toScreen(p.x, p.y); return Math.hypot(q.x - sp.x, q.y - sp.y) <= r; };
    if (near(pts.rotate)) return { el, handle: "rotate" };
    for (const h of HANDLES) if (near(pts[h])) return { el, handle: h };
    return null;
  }
  const effectiveTool = () => (panHold ? "hand" : ctl.tool());
  const snapOpts = () => { const o = ctl.options(); return { artboard: ctl.doc().artboard, grid: o.showGrid ? o.grid : null, threshold: 6 / cam.scale }; };
  function resizeCursor(angle) {
    const a = ((angle % 180) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? "ew-resize" : a < 67.5 ? "nwse-resize" : a < 112.5 ? "ns-resize" : "nesw-resize";
  }
  function updateCursor(sp = null, touch = false) {
    let c = "default";
    const tool = effectiveTool();
    if (drag?.kind === "pan") c = "grabbing";
    else if (tool === "hand") c = "grab";
    else if (tool === "zoom") c = "zoom-in";
    else if (tool === "text") c = "text";
    else if (["rect", "ellipse", "crop"].includes(tool)) c = "crosshair";
    else if (tool === "select" && sp) {
      const h = handleAt(sp, touch);
      if (h) c = h.handle === "rotate" ? "grab" : resizeCursor(handleAngle(h.handle, h.el.rotation));
      else if (hover) c = "move";
    }
    canvas.style.cursor = c;
  }

  // ---------- Ponteiro ----------
  function onDown(e) {
    if (disposed) return;
    canvas.focus({ preventScroll: true });
    const sp = local(e), dp = toDoc(sp.x, sp.y);
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, sp);
      if (touches.size === 2) { startPinch(); e.preventDefault(); return; }
      if (touches.size > 2) return;
    }
    if (e.button === 2) return; // menu de contexto
    canvas.setPointerCapture(e.pointerId);
    const tool = effectiveTool();
    if (e.button === 1 || tool === "hand") { e.preventDefault(); drag = { kind: "pan", id: e.pointerId, sx: sp.x, sy: sp.y, cx: cam.x, cy: cam.y }; updateCursor(); return; }
    if (e.button !== 0) return;
    if (tool === "zoom") { zoomAt(e.altKey ? cam.scale / 1.5 : cam.scale * 1.5, sp.x, sp.y); return; }
    if (tool === "text") { ctl.create("text", null, snapIf(dp, e).point); return; }
    if (tool === "rect" || tool === "ellipse" || tool === "crop") {
      const p = snapIf(dp, e).point;
      drag = { kind: tool === "crop" ? "crop" : "draw", type: tool, id: e.pointerId, p0: p, p1: p, at: sp };
      invalidate(); return;
    }
    // Selecionar / mover
    const h = handleAt(sp, e.pointerType === "touch");
    if (h) {
      const start = { ...h.el };
      drag = h.handle === "rotate"
        ? { kind: "rotate", id: e.pointerId, el: h.el, start, p0: dp, began: false, at: sp }
        : { kind: "resize", id: e.pointerId, el: h.el, start, handle: h.handle, began: false, at: sp };
      return;
    }
    const doc = ctl.doc();
    const hit = hitTest(doc, dp.x, dp.y, { tolerance: 2 / cam.scale });
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const sel = ctl.selection();
    if (hit) {
      if (additive) { ctl.select([hit.id], true); return; }
      if (!sel.has(hit.id)) ctl.select([hit.id], false);
      const now = ctl.selection();
      const moving = doc.elements.filter((el) => now.has(el.id) && isSelectable(doc, el));
      drag = { kind: "move", id: e.pointerId, p0: dp, sp0: sp, start: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])), els: moving, bounds: unionBounds(moving), began: false, at: sp };
      return;
    }
    if (!additive && sel.size) ctl.select([], false);
    drag = { kind: "marquee", id: e.pointerId, p0: dp, p1: dp, additive, at: sp };
    invalidate();
  }
  function snapIf(p, e) {
    if (!ctl.options().snap || e.ctrlKey || e.metaKey) return { point: p, guides: [] };
    const s = snapPoint(p, snapOpts());
    return { point: { x: s.x, y: s.y }, guides: s.guides };
  }
  function onMove(e) {
    if (disposed) return;
    const sp = local(e), dp = toDoc(sp.x, sp.y);
    lastDoc = dp;
    if (e.pointerType === "touch" && touches.has(e.pointerId)) { touches.set(e.pointerId, sp); if (pinch) { applyPinch(); return; } }
    ctl.cursor?.(dp);
    if (!drag) {
      const doc = ctl.doc();
      const next = effectiveTool() === "select" ? hitTest(doc, dp.x, dp.y, { tolerance: 2 / cam.scale }) : null;
      if (next !== hover) { hover = next; invalidate(); }
      updateCursor(sp, e.pointerType === "touch");
      return;
    }
    if (e.pointerId !== drag.id) return;
    drag.at = sp;
    if (drag.kind === "pan") { setView({ ...cam, x: drag.cx + sp.x - drag.sx, y: drag.cy + sp.y - drag.sy }); return; }
    if (drag.kind === "marquee" || drag.kind === "crop" || drag.kind === "draw") {
      let p = drag.kind === "marquee" ? dp : snapIf(dp, e).point;
      if (drag.kind === "draw" && e.shiftKey) { const d = Math.max(Math.abs(p.x - drag.p0.x), Math.abs(p.y - drag.p0.y)); p = { x: drag.p0.x + Math.sign(p.x - drag.p0.x || 1) * d, y: drag.p0.y + Math.sign(p.y - drag.p0.y || 1) * d }; }
      drag.p1 = p; invalidate(); return;
    }
    if (drag.kind === "move") {
      if (!drag.began) {
        if (Math.hypot(sp.x - drag.sp0.x, sp.y - drag.sp0.y) < 3) return;
        if (!drag.els.length) { drag = null; return; }
        drag.began = true; ctl.begin(drag.els.length > 1 ? `Mover ${drag.els.length} elementos` : "Mover elemento");
      }
      let dx = dp.x - drag.p0.x, dy = dp.y - drag.p0.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      drag.guides = [];
      if (ctl.options().snap && !(e.ctrlKey || e.metaKey) && drag.bounds) {
        const s = snapMove({ ...drag.bounds, x: drag.bounds.x + dx, y: drag.bounds.y + dy }, snapOpts());
        dx += s.dx; dy += s.dy; drag.guides = s.guides;
      }
      for (const el of drag.els) { const st = drag.start.get(el.id); el.x = Math.round((st.x + dx) * 100) / 100; el.y = Math.round((st.y + dy) * 100) / 100; clampGeometry(el); }
      const first = drag.els[0];
      drag.readout = drag.els.length === 1 ? `x ${Math.round(first.x)}, y ${Math.round(first.y)}` : `Δ ${Math.round(dx)}, ${Math.round(dy)}`;
      ctl.changed(); invalidate(); return;
    }
    if (drag.kind === "resize") {
      if (!drag.began) { drag.began = true; ctl.begin("Redimensionar"); }
      let p = dp;
      drag.guides = [];
      // Encaixe do ponteiro só com o elemento alinhado aos eixos (0°, 90°, 180°…).
      if (Math.abs(drag.start.rotation % 90) < 0.01) { const s = snapIf(dp, e); p = s.point; drag.guides = s.guides; }
      const keepRatio = (drag.start.type === "image") !== e.shiftKey;
      const r = resizeFromHandle(drag.start, drag.handle, p, { keepRatio, fromCenter: e.altKey });
      Object.assign(drag.el, { x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 });
      clampGeometry(drag.el);
      drag.readout = `${Math.round(drag.el.width)} × ${Math.round(drag.el.height)} px`;
      ctl.changed(); invalidate(); return;
    }
    if (drag.kind === "rotate") {
      if (!drag.began) { drag.began = true; ctl.begin("Girar"); }
      drag.el.rotation = rotateFromPointer(drag.start, drag.p0, dp, e.shiftKey);
      drag.readout = `${Math.round(drag.el.rotation * 10) / 10}°`;
      ctl.changed(); invalidate();
    }
  }
  function onUp(e) {
    if (e.pointerType === "touch") { touches.delete(e.pointerId); if (pinch && touches.size < 2) { pinch = null; return; } }
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (e.type === "pointercancel") { if (d.began) ctl.cancel(); invalidate(); return; }
    if (d.kind === "marquee") {
      const r = rectFromPoints(d.p0, d.p1);
      if (r.width * cam.scale > 2 || r.height * cam.scale > 2) ctl.select(elementsInRect(ctl.doc(), r).map((el) => el.id), d.additive ? "add" : false);
    } else if (d.kind === "draw") {
      const r = rectFromPoints(d.p0, d.p1);
      ctl.create(d.type, r.width >= 4 && r.height >= 4 ? r : null, d.p0);
    } else if (d.kind === "crop") {
      const r = rectFromPoints(d.p0, d.p1);
      if (r.width >= 8 && r.height >= 8) ctl.crop(r);
    } else if (d.began) ctl.commit();
    updateCursor(local(e), e.pointerType === "touch");
    invalidate();
  }
  function startPinch() {
    if (drag) { if (drag.began) ctl.cancel(); drag = null; }
    const [a, b] = [...touches.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: { ...cam } };
  }
  function applyPinch() {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinch.cam.scale * (dist / pinch.dist)));
    const docX = (pinch.mid.x - pinch.cam.x) / pinch.cam.scale, docY = (pinch.mid.y - pinch.cam.y) / pinch.cam.scale;
    setView({ scale, x: mid.x - docX * scale, y: mid.y - docY * scale });
  }
  function onWheel(e) {
    e.preventDefault();
    const sp = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * height : e.deltaY;
    zoomAt(cam.scale * Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0015), sp.x, sp.y);
  }
  function onContext(e) {
    e.preventDefault();
    if (drag) return;
    const sp = local(e), dp = toDoc(sp.x, sp.y);
    lastDoc = dp;
    const hit = hitTest(ctl.doc(), dp.x, dp.y, { tolerance: 2 / cam.scale, includeLocked: true });
    if (hit && !ctl.selection().has(hit.id)) ctl.select([hit.id], false);
    ctl.context({ x: e.clientX, y: e.clientY }, hit?.id || null, dp);
  }
  function onDouble(e) {
    if (effectiveTool() !== "select") return;
    const sp = local(e), dp = toDoc(sp.x, sp.y);
    const hit = hitTest(ctl.doc(), dp.x, dp.y, { tolerance: 2 / cam.scale });
    if (hit) ctl.open(hit.id);
  }
  function onLeave() { if (hover) { hover = null; invalidate(); } ctl.cursor?.(null); }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContext);
  canvas.addEventListener("dblclick", onDouble);
  canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  resize();

  return {
    canvas, camera, cache,
    invalidate,
    fit, fitRect,
    toDoc, toScreen,
    /** Centro da vista em coordenadas do documento. */
    viewCenter: () => toDoc(width / 2, height / 2),
    /** Último ponto do cursor sobre o canvas (documento), se houver. */
    lastPointer: () => lastDoc,
    /** Verdadeiro durante um arraste que já entrou no histórico. */
    get busy() { return !!drag; },
    /** Esc: cancela o arraste em andamento (devolve o estado anterior). Verdadeiro se havia algo a cancelar. */
    cancelInteraction() {
      if (!drag) return false;
      const d = drag; drag = null;
      if (d.began) ctl.cancel();
      invalidate();
      return true;
    },
    /** Ponto de tela (cliente) do centro de um elemento, para menus abertos pelo teclado. */
    clientPointOf(el) {
      const r = canvas.getBoundingClientRect();
      const b = el ? elementBounds(el) : null;
      const p = b ? toScreen(b.x + b.width / 2, b.y + b.height / 2) : { x: width / 2, y: height / 2 };
      return { x: r.left + Math.max(0, Math.min(width, p.x)), y: r.top + Math.max(0, Math.min(height, p.y)) };
    },
    status: (el) => artboardStatus(el, ctl.doc().artboard),
    refreshCursor: () => updateCursor(),
    destroy() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.remove();
      cache.clear();
    },
  };
}
