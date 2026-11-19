// Réguas do mapa (ADR-117): o mesmo desenho nos editores (`editor-core.js`) e na mesa ao vivo (`table.js`).
// Só apresentação: nunca grava nada nem decide regra. Passos e rótulos vêm de `editor-policy.js` (puro, testado em Node).
import { rulerLabel, rulerSteps } from "./editor-policy.js";

/** Espessura das réguas em px (igual à `--ed-ruler` dos editores). */
export const RULER_SIZE = 18;
/** Onde as réguas somem (celular e tablet): a mesma faixa em que os editores escondem as suas. */
export const RULER_HIDDEN_QUERY = "(max-width: 900px), (max-width: 1200px) and (pointer: coarse)";

/** Texto da escala: curto (canto/barra) e longo (leitor de tela e dica). */
export function rulerScaleText(info) {
  if (!info) return { short: "", long: "" };
  if (info.unit === "m") {
    const v = rulerLabel(Number(info.cellUnits) || 0);
    return { short: `Régua em metros · 1 casa = ${v} m`, long: `Régua em metros: cada casa da grade representa ${v} m.` };
  }
  return { short: `Régua em ${info.unit || "unidades"}`, long: `Régua em ${info.unit === "px" ? "pixels da imagem (sem grade)" : info.unit || "unidades"}.` };
}

/**
 * Desenha uma régua num canvas. `rect` = retângulo do canvas na janela; `origin` = posição do 0 (canto do mapa) em px
 * a partir do início da régua; `steps` = rulerSteps(); `cursor` = posição do ponteiro na régua ou null.
 */
export function paintRuler(canvas, rect, axis, origin, steps, cursor, unit = "") {
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

/**
 * Réguas superior e esquerda presas ao tabuleiro da mesa. `stage` recebe as réguas e a classe `has-rulers` (que abre
 * a margem do tabuleiro); `getInfo()` → { x, y, cellPx, cellUnits, unit } | null, como o `ruler()` da câmera dos editores.
 * Redesenha só quando a vista, o tamanho ou o cursor mudam; `requestAnimationFrame` já para em aba oculta.
 * Devolve { setEnabled(on), enabled(), destroy() }.
 */
export function mountMapRulers(stage, board, getInfo) {
  const corner = document.createElement("span");
  corner.className = "ed-ruler-corner map-ruler-corner";
  corner.innerHTML = '<span aria-hidden="true"></span><span class="sr-only"></span>';
  const rulerX = document.createElement("canvas"), rulerY = document.createElement("canvas");
  rulerX.className = "ed-ruler ed-ruler-x map-ruler"; rulerY.className = "ed-ruler ed-ruler-y map-ruler";
  for (const el of [rulerX, rulerY]) el.setAttribute("aria-hidden", "true");
  const parts = [corner, rulerX, rulerY];
  for (const el of parts) { el.hidden = true; board.after(el); }
  const media = window.matchMedia(RULER_HIDDEN_QUERY);
  let on = true, pointer = null, paintSig = "", boxSig = "", scaleSig = "", frame = 0, destroyed = false;
  const track = (e) => { pointer = { x: e.clientX, y: e.clientY }; };
  const forget = () => { pointer = null; };
  board.addEventListener("pointermove", track, { passive: true });
  board.addEventListener("pointerleave", forget);

  function hide() {
    if (!stage.classList.contains("has-rulers")) return;
    stage.classList.remove("has-rulers");
    for (const el of parts) el.hidden = true;
    paintSig = boxSig = "";
  }
  function draw() {
    const info = on && !media.matches ? getInfo() : null;
    const steps = info && rulerSteps(info.cellPx, info.cellUnits);
    if (!steps) return hide();
    if (!stage.classList.contains("has-rulers")) {
      stage.classList.add("has-rulers");
      for (const el of parts) el.hidden = false;
      return; // a margem do tabuleiro muda neste quadro; mede no próximo
    }
    const s = RULER_SIZE, l = board.offsetLeft, t = board.offsetTop, w = board.offsetWidth, h = board.offsetHeight;
    const box = [l, t, w, h].join("|");
    if (box !== boxSig) {
      boxSig = box;
      Object.assign(corner.style, { left: `${l - s}px`, top: `${t - s}px`, width: `${s}px`, height: `${s}px` });
      Object.assign(rulerX.style, { left: `${l}px`, top: `${t - s}px`, width: `${w}px`, height: `${s}px` });
      Object.assign(rulerY.style, { left: `${l - s}px`, top: `${t}px`, width: `${s}px`, height: `${h}px` });
    }
    const scale = [info.unit, info.cellUnits].join("|");
    if (scale !== scaleSig) {
      scaleSig = scale;
      const { long } = rulerScaleText(info);
      corner.firstChild.textContent = info.unit || "";
      corner.lastChild.textContent = long;
      corner.dataset.tip = long;
    }
    const rx = rulerX.getBoundingClientRect(), ry = rulerY.getBoundingClientRect();
    const sig = [info.x, info.y, info.cellPx, info.cellUnits, info.unit, rx.left, rx.width, ry.top, ry.height, pointer?.x, pointer?.y].join("|");
    if (sig === paintSig) return;
    paintSig = sig;
    paintRuler(rulerX, rx, "x", info.x - rx.left, steps, pointer ? pointer.x - rx.left : null, info.unit);
    paintRuler(rulerY, ry, "y", info.y - ry.top, steps, pointer ? pointer.y - ry.top : null, info.unit);
  }
  function loop() {
    frame = 0;
    if (destroyed) return;
    try { draw(); } catch { /* régua é só apresentação: nunca derruba a mesa */ }
    frame = requestAnimationFrame(loop);
  }
  frame = requestAnimationFrame(loop);
  return {
    setEnabled(value) { on = !!value; paintSig = ""; },
    enabled: () => on,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      board.removeEventListener("pointermove", track);
      board.removeEventListener("pointerleave", forget);
      stage.classList.remove("has-rulers");
      for (const el of parts) el.remove();
    },
  };
}
