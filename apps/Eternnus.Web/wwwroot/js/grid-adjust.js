import { mountMapGestures } from "./map-gestures.js";
import { helpButton } from "./help.js";
// Ajuste visual da grade de uma imagem: tamanho do quadrado e alinhamento com prévia imediata.
// A conta das casas é a mesma do servidor (gridFor ↔ CampaignMapView.Grid). Números precisos aparecem na interface Completa.
import { esc } from "./ui.js";
import { gridFor } from "./scene-policy.js";

/** Campos do ajuste. `values`: { gridPixels, gridOffsetX, gridOffsetY, scaleMeters }. */
export function gridAdjustHtml(prefix, values, { complete = false } = {}) {
  const v = { gridPixels: 64, gridOffsetX: 0, gridOffsetY: 0, scaleMeters: 1.5, ...values };
  const slider = (key, label, min, max, help) => `<div class="field grid-slider"><label for="${prefix}-${key}">${label}</label><div class="grid-slider-row"><button type="button" class="subtle small" data-grid-step="${key}|-1" aria-label="Diminuir ${esc(label.toLowerCase())}">−</button><input id="${prefix}-${key}" type="range" name="${key}" min="${min}" max="${max}" step="1" value="${Number(v[key])}" aria-describedby="${prefix}-${key}-help"><button type="button" class="subtle small" data-grid-step="${key}|1" aria-label="Aumentar ${esc(label.toLowerCase())}">+</button>${complete ? `<input type="number" class="grid-number" data-grid-number="${key}" min="${min}" max="${max}" step="1" value="${Number(v[key])}" aria-label="${esc(label)} em pixels">` : `<output data-grid-out="${key}">${Number(v[key])} px</output>`}</div><small class="form-help" id="${prefix}-${key}-help">${help}</small></div>`;
  return `<div class="grid-adjust" data-grid-adjust><div class="grid-zoom-controls"><button type="button" class="subtle" data-grid-zoom="out" aria-label="Afastar prévia">−</button><button type="button" class="subtle" data-grid-zoom="in" aria-label="Aproximar prévia">+</button><button type="button" class="subtle" data-grid-zoom="fit">Imagem inteira</button><small>Use dois dedos para aproximar ou afastar (1–4×).</small></div><div class="grid-preview"><canvas data-grid-canvas aria-hidden="true"></canvas><p class="grid-summary" data-grid-summary role="status"></p></div>
    ${slider("gridPixels", "Tamanho do quadrado", 8, 256, "Arraste até cada quadrado da grade dourada cobrir um quadrado do desenho.")}
    ${slider("gridOffsetX", "Alinhamento horizontal", 0, Math.max(0, Number(v.gridPixels) - 1), "Move a grade para a direita até as linhas coincidirem com o desenho.")}
    ${slider("gridOffsetY", "Alinhamento vertical", 0, Math.max(0, Number(v.gridPixels) - 1), "Move a grade para baixo até as linhas coincidirem com o desenho.")}
    <div class="field"><div class="field-label"><label for="${prefix}-scale">Cada quadrado representa (metros)</label>${helpButton("campanhas.mapas.grade", "Grade e escala")}</div><input id="${prefix}-scale" name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" required value="${esc(v.scaleMeters)}" aria-describedby="${prefix}-scale-help"><small class="form-help" id="${prefix}-scale-help">Usada para converter distâncias da ficha (deslocamento, luz, visão) em casas. 1,5 m é comum em mapas táticos.</small></div></div>`;
}

/**
 * Liga o ajuste a uma imagem (URL ou objeto local). `onChange({ gridPixels, gridOffsetX, gridOffsetY, valid })`.
 * Devolve { values(), dispose() }.
 */
export function mountGridAdjust(root, src, { onChange } = {}) {
  const box = root.querySelector("[data-grid-adjust]");
  const canvas = box.querySelector("[data-grid-canvas]");
  const summary = box.querySelector("[data-grid-summary]");
  const input = (key) => box.querySelector(`input[type=range][name="${key}"]`);
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  let ready = false, zoom = 1;
  const preview = box.querySelector('.grid-preview');
  let drag = null;
  function zoomAt(value, clientX, clientY) {
    const rect = preview.getBoundingClientRect();
    const x = clientX == null ? preview.clientWidth / 2 : clientX - rect.left;
    const y = clientY == null ? preview.clientHeight / 2 : clientY - rect.top;
    const ax = (preview.scrollLeft + x) / Math.max(1, canvas.offsetWidth);
    const ay = (preview.scrollTop + y) / Math.max(1, canvas.offsetHeight);
    zoom = Math.max(1, Math.min(4, value));
    const width = Math.max(1, preview.clientWidth) * zoom;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${width * canvas.height / Math.max(1, canvas.width)}px`;
    preview.scrollLeft = ax * canvas.offsetWidth - x;
    preview.scrollTop = ay * canvas.offsetHeight - y;
    preview.dataset.zoom = String(zoom);
    box.querySelector('[data-grid-zoom="out"]').disabled = zoom <= 1;
    box.querySelector('[data-grid-zoom="in"]').disabled = zoom >= 4;
  }
  const disposeGestures = mountMapGestures(preview, { scale: () => zoom, zoom: zoomAt, cancel: () => { drag = null; } });
  const down = e => { if (e.button !== 0) return; drag = { id:e.pointerId, x:e.clientX, y:e.clientY, left:preview.scrollLeft, top:preview.scrollTop }; preview.setPointerCapture(e.pointerId); };
  const move = e => { if (!drag || drag.id !== e.pointerId) return; preview.scrollLeft=drag.left+drag.x-e.clientX; preview.scrollTop=drag.top+drag.y-e.clientY; };
  const up = () => { drag=null; };
  preview.addEventListener('pointerdown',down); preview.addEventListener('pointermove',move); preview.addEventListener('pointerup',up); preview.addEventListener('pointercancel',up);
  const resize = new ResizeObserver(() => zoomAt(zoom));
  resize.observe(preview);
  const values = () => ({ gridPixels: Number(input("gridPixels").value), gridOffsetX: Number(input("gridOffsetX").value), gridOffsetY: Number(input("gridOffsetY").value) });
  function draw() {
    const v = values();
    if (!ready) { summary.textContent = "Carregando a imagem…"; return; }
    const g = gridFor(image.naturalWidth, image.naturalHeight, v.gridPixels, v.gridOffsetX, v.gridOffsetY);
    summary.textContent = g.valid ? `Resultado: ${g.message} (imagem de ${image.naturalWidth} × ${image.naturalHeight} px). Faixas fora da grade ficam escurecidas.` : g.message;
    summary.classList.toggle("invalid", !g.valid);
    const scale = Math.min(1, 720 / image.naturalWidth, 480 / image.naturalHeight);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const c = canvas.getContext("2d");
    c.drawImage(image, 0, 0, canvas.width, canvas.height);
    const s = v.gridPixels * scale, ox = v.gridOffsetX * scale, oy = v.gridOffsetY * scale;
    const gw = Math.max(0, g.width) * s, gh = Math.max(0, g.height) * s;
    c.fillStyle = "rgba(11,10,8,.55)";
    c.fillRect(0, 0, canvas.width, oy); c.fillRect(0, oy, ox, canvas.height);
    c.fillRect(ox + gw, oy, canvas.width, canvas.height); c.fillRect(ox, oy + gh, gw, canvas.height);
    c.strokeStyle = g.valid ? "rgba(241,215,156,.85)" : "rgba(212,83,63,.85)";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= Math.max(0, g.width); x++) { c.moveTo(ox + x * s + 0.5, oy); c.lineTo(ox + x * s + 0.5, oy + gh); }
    for (let y = 0; y <= Math.max(0, g.height); y++) { c.moveTo(ox, oy + y * s + 0.5); c.lineTo(ox + gw, oy + y * s + 0.5); }
    c.stroke();
    onChange?.({ ...v, valid: g.valid, width: g.width, height: g.height });
  }
  function set(key, value) {
    const el = input(key);
    const next = Math.min(Number(el.max), Math.max(Number(el.min), Math.round(Number(value) || 0)));
    el.value = String(next);
    const number = box.querySelector(`[data-grid-number="${key}"]`); if (number) number.value = String(next);
    const out = box.querySelector(`[data-grid-out="${key}"]`); if (out) out.textContent = `${next} px`;
    if (key === "gridPixels") for (const k of ["gridOffsetX", "gridOffsetY"]) { input(k).max = String(Math.max(0, next - 1)); if (Number(input(k).value) > next - 1) set(k, next - 1); }
  }
  const onInput = (e) => {
    if (e.target.matches("input[type=range]")) set(e.target.name, e.target.value);
    else if (e.target.dataset.gridNumber) set(e.target.dataset.gridNumber, e.target.value);
    else return;
    draw();
  };
  const onClick = (e) => {
    const zoomAction = e.target.closest('[data-grid-zoom]')?.dataset.gridZoom;
    if (zoomAction) { zoomAt(zoomAction === 'fit' ? 1 : zoom * (zoomAction === 'in' ? 1.25 : .8)); return; }
    const b = e.target.closest("[data-grid-step]");
    if (!b) return;
    const [key, delta] = b.dataset.gridStep.split("|");
    set(key, Number(input(key).value) + Number(delta));
    draw();
  };
  box.addEventListener("input", onInput);
  box.addEventListener("click", onClick);
  image.onload = () => {
    ready = true;
    input("gridPixels").max = String(Math.max(8, Math.min(1024, image.naturalWidth, image.naturalHeight)));
    box.querySelector('[data-grid-number="gridPixels"]')?.setAttribute("max", input("gridPixels").max);
    draw(); zoomAt(zoom);
  };
  image.onerror = () => { summary.textContent = "Não foi possível abrir a imagem para a prévia. Os números continuam valendo."; };
  image.src = src;
  draw();
  return { values, dispose() { disposeGestures(); resize.disconnect(); preview.removeEventListener('pointerdown',down); preview.removeEventListener('pointermove',move); preview.removeEventListener('pointerup',up); preview.removeEventListener('pointercancel',up); box.removeEventListener("input", onInput); box.removeEventListener("click", onClick); image.onload = image.onerror = null; } };
}
