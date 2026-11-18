// Zoom e arraste de uma imagem dentro de um palco (visualizador da Biblioteca, ADR-095). Regras puras exportadas para teste;
// `mountImageZoom` liga roda, arraste, pinça, duplo clique e teclado e devolve o descarte.

export const ZOOM_STEP = 1.25;
export const ZOOM_MAX = 4; // 400% do tamanho real

/** Escala que faz a imagem caber inteira no palco, sem ampliar além do tamanho real. */
export function fitScale(iw, ih, vw, vh) {
  if (!(iw > 0 && ih > 0 && vw > 0 && vh > 0)) return 1;
  return Math.min(1, vw / iw, vh / ih);
}
/** Limites de escala: de "caber" até 400% (ou o próprio "caber", se for maior). */
export function scaleLimits(iw, ih, vw, vh) {
  const fit = fitScale(iw, ih, vw, vh);
  return { min: fit, max: Math.max(ZOOM_MAX, fit) };
}
/** Mantém a imagem no palco: menor que o palco fica centralizada; maior não deixa vão nas bordas. */
export function clampView(view, iw, ih, vw, vh) {
  const w = iw * view.scale, h = ih * view.scale;
  const x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, view.x));
  const y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, view.y));
  return { scale: view.scale, x, y };
}
/** Nova vista com a escala multiplicada por `factor`, mantendo fixo o ponto (px, py) do palco. */
export function zoomAt(view, factor, px, py, size) {
  const { min, max } = scaleLimits(size.iw, size.ih, size.vw, size.vh);
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const k = scale / view.scale;
  return clampView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, size.iw, size.ih, size.vw, size.vh);
}
/** Vista que encaixa a imagem inteira, centralizada. */
export function fitView(size) {
  return clampView({ scale: fitScale(size.iw, size.ih, size.vw, size.vh), x: 0, y: 0 }, size.iw, size.ih, size.vw, size.vh);
}

/**
 * Liga o zoom a `stage` (palco com `overflow: hidden`) e `img` (já carregada). `onChange({ percent, fit, min, max })`
 * atualiza a barra. Devolve `{ zoomIn, zoomOut, fit, actual, destroy }`.
 */
export function mountImageZoom(stage, img, { onChange = () => {} } = {}) {
  const size = () => ({ iw: img.naturalWidth, ih: img.naturalHeight, vw: stage.clientWidth, vh: stage.clientHeight });
  let view = fitView(size()), fitted = true;
  const pointers = new Map();
  let pan = null, pinch = null;
  const apply = () => {
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    const s = size(), { min, max } = scaleLimits(s.iw, s.ih, s.vw, s.vh);
    stage.classList.toggle("is-zoomed", view.scale > min + 1e-6);
    onChange({ percent: Math.round(view.scale * 100), fit: fitted, atMin: view.scale <= min + 1e-6, atMax: view.scale >= max - 1e-6 });
  };
  const set = (next, isFit = false) => { view = next; fitted = isFit; apply(); };
  const center = () => ({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const zoomBy = (factor, p = center()) => set(zoomAt(view, factor, p.x, p.y, size()));
  const fit = () => set(fitView(size()), true);
  const actual = (p = center()) => zoomBy(1 / view.scale, p);

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomBy(Math.exp(-delta * 0.0015), local(e));
  };
  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, view };
      pan = null;
    } else if (pointers.size === 1) pan = { start: local(e), view };
  };
  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    const s = size();
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      set(zoomAt(pinch.view, Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist, mid.x, mid.y, s));
      return;
    }
    if (!pan) return;
    const p = local(e);
    set(clampView({ scale: pan.view.scale, x: pan.view.x + p.x - pan.start.x, y: pan.view.y + p.y - pan.start.y }, s.iw, s.ih, s.vw, s.vh), fitted);
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) { const [p] = pointers.values(); pan = { start: p, view }; } else if (!pointers.size) pan = null;
  };
  // Duplo clique/toque: alterna entre caber e o tamanho real (ou o dobro, quando o real já cabe) no ponto tocado.
  const onDouble = (e) => {
    const p = local(e), s = size(), { min } = scaleLimits(s.iw, s.ih, s.vw, s.vh);
    if (view.scale > min + 1e-6) return fit();
    zoomBy(Math.max(1, min * 2) / view.scale, p);
  };
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = 60, s = size();
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
    else if (e.key === "0") fit();
    else if (e.key === "1") actual();
    else if (moves[e.key] && stage.classList.contains("is-zoomed")) {
      const [dx, dy] = moves[e.key];
      set(clampView({ ...view, x: view.x + dx, y: view.y + dy }, s.iw, s.ih, s.vw, s.vh));
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // Palco muda de tamanho (janela, celular girado): reencaixa se estava encaixado; senão só mantém dentro dos limites.
  const observer = new ResizeObserver(() => {
    const s = size();
    if (fitted) return fit();
    const { min } = scaleLimits(s.iw, s.ih, s.vw, s.vh);
    set(clampView({ ...view, scale: Math.max(min, view.scale) }, s.iw, s.ih, s.vw, s.vh));
  });

  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("dblclick", onDouble);
  stage.addEventListener("keydown", onKey);
  observer.observe(stage);
  apply();
  return {
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    fit,
    actual: () => actual(),
    destroy() {
      observer.disconnect();
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("dblclick", onDouble);
      stage.removeEventListener("keydown", onKey);
    },
  };
}
