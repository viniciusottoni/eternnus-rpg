import { mountMapGestures } from "./map-gestures.js";
import { helpButton } from "./help.js";
// Ajuste visual da grade de uma imagem: tamanho do quadrado e alinhamento com prévia imediata.
// A conta das casas é a mesma do servidor (gridFor ↔ CampaignMapView.Grid). Números precisos aparecem na interface Completa.
import { esc } from "./ui.js";
import { api } from "./api.js";
import { gridFor } from "./scene-policy.js";
import { GRID_PRESETS, describeAlignment, detectFromProfiles, edgeProfiles, fromCell, fromSpan, impactLines, nudgeGrid, pickPoint, sameGrid } from "./grid-align-policy.js";

const MAX_ZOOM = 8;
const G = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const MAP_IMAGE = new RegExp(`^/api/campaigns/(${G})/assets/maps/(${G})/image$`);
/** Prévia do impacto (P1.2): só para mapas já guardados na campanha (a imagem vem da rota protegida do acervo). */
export function impactPathFor(src) {
  const m = MAP_IMAGE.exec(String(src || "").split("?")[0]);
  return m ? `/campaigns/${m[1]}/assets/maps/${m[2]}/grid-impact` : null;
}

// Assistente (§9): 1 marcar a referência na prévia (ou detectar), 2 conferir o resultado aplicado à prévia, 3 confirmar.
const WIZARD_STEPS = Object.freeze({
  cell: ["Clique no canto superior esquerdo de uma casa do desenho.", "Agora clique no canto oposto (inferior direito) da mesma casa."],
  span: ["Clique num cruzamento de linhas da grade do desenho.", "Agora clique noutro cruzamento na mesma linha ou coluna, várias casas adiante, e informe quantas casas há entre eles."],
});
function wizardHtml(prefix) {
  return `<div class="grid-wizard" data-grid-wizard>
    <div class="grid-wizard-head"><strong>Assistente de alinhamento</strong>${helpButton("campanhas.mapas.alinhamento", "Assistente de alinhamento")}</div>
    <div class="grid-wizard-start" data-grid-wiz-start><button type="button" class="subtle small" data-grid-wiz="detect">Detectar automaticamente</button><button type="button" class="subtle small" data-grid-wiz="cell">Marcar uma casa</button><button type="button" class="subtle small" data-grid-wiz="span">Marcar N casas</button></div>
    <div class="grid-wizard-run" data-grid-wiz-run hidden>
      <ol class="grid-wizard-steps" aria-label="Etapas do assistente"><li data-grid-wiz-stage="1">Marcar</li><li data-grid-wiz-stage="2">Conferir</li><li data-grid-wiz-stage="3">Confirmar</li></ol>
      <p class="grid-wizard-text" data-grid-wiz-text role="status" aria-live="polite"></p>
      <div class="field grid-wizard-count" data-grid-wiz-count hidden><label for="${prefix}-wiz-count">Casas entre os dois pontos</label><input id="${prefix}-wiz-count" type="number" min="1" max="100" step="1" value="5" data-grid-wiz-n></div>
      <div class="grid-wizard-actions"><button type="button" class="subtle small" data-grid-wiz="undo">Desfazer ponto</button><button type="button" class="subtle small" data-grid-wiz="cancel">Cancelar</button><button type="button" class="primary small" data-grid-wiz="apply" disabled>Usar este alinhamento</button></div>
    </div>
  </div>`;
}

/** Campos do ajuste. `values`: { gridPixels, gridOffsetX, gridOffsetY, scaleMeters }. */
export function gridAdjustHtml(prefix, values, { complete = false } = {}) {
  const v = { gridPixels: 64, gridOffsetX: 0, gridOffsetY: 0, scaleMeters: 1.5, ...values };
  const slider = (key, label, min, max, help) => `<div class="field grid-slider"><label for="${prefix}-${key}">${label}</label><div class="grid-slider-row"><button type="button" class="subtle small" data-grid-step="${key}|-1" aria-label="Diminuir ${esc(label.toLowerCase())}">−</button><input id="${prefix}-${key}" type="range" name="${key}" min="${min}" max="${max}" step="1" value="${Number(v[key])}" aria-describedby="${prefix}-${key}-help"><button type="button" class="subtle small" data-grid-step="${key}|1" aria-label="Aumentar ${esc(label.toLowerCase())}">+</button>${complete ? `<input type="number" class="grid-number" data-grid-number="${key}" min="${min}" max="${max}" step="1" value="${Number(v[key])}" aria-label="${esc(label)} em pixels">` : `<output data-grid-out="${key}">${Number(v[key])} px</output>`}</div><small class="form-help" id="${prefix}-${key}-help">${help}</small></div>`;
  const presets = `<div class="field grid-presets"><label for="${prefix}-preset">Tamanhos comuns</label><select id="${prefix}-preset" data-grid-preset aria-describedby="${prefix}-preset-help"><option value="">Escolher…</option>${GRID_PRESETS.map(([px, label]) => `<option value="${px}">${esc(label)}</option>`).join("")}</select><small class="form-help" id="${prefix}-preset-help">Mapas exportados de VTTs costumam usar estes tamanhos por casa.</small></div>`;
  return `<div class="grid-adjust" data-grid-adjust><div class="grid-zoom-controls"><button type="button" class="subtle" data-grid-zoom="out" aria-label="Afastar prévia">−</button><button type="button" class="subtle" data-grid-zoom="in" aria-label="Aproximar prévia">+</button><button type="button" class="subtle" data-grid-zoom="fit">Imagem inteira</button><small>Roda do mouse ou dois dedos aproximam no ponto indicado (1–${MAX_ZOOM}×).</small></div><div class="grid-preview" tabindex="0" role="group" aria-label="Prévia da grade" aria-describedby="${prefix}-keys"><canvas data-grid-canvas aria-hidden="true"></canvas><canvas class="grid-loupe" data-grid-loupe width="144" height="144" aria-hidden="true" hidden></canvas></div><p class="grid-summary" data-grid-summary role="status"></p><small class="form-help" id="${prefix}-keys">Com a prévia em foco: setas movem a grade 1 px (Shift: 10 px) e + / − mudam o quadrado. Com pontos marcados, as setas movem o último ponto; arraste um ponto para corrigi-lo com a lupa.</small>
    ${wizardHtml(prefix)}
    ${slider("gridPixels", "Tamanho do quadrado", 8, 256, "Arraste até cada quadrado da grade dourada cobrir um quadrado do desenho.")}
    ${presets}
    ${slider("gridOffsetX", "Alinhamento horizontal", 0, Math.max(0, Number(v.gridPixels) - 1), "Move a grade para a direita até as linhas coincidirem com o desenho.")}
    ${slider("gridOffsetY", "Alinhamento vertical", 0, Math.max(0, Number(v.gridPixels) - 1), "Move a grade para baixo até as linhas coincidirem com o desenho.")}
    <div class="grid-restore" role="group" aria-label="Restaurar alinhamento"><button type="button" class="subtle small" data-grid-restore="original" disabled>Voltar ao alinhamento anterior</button><button type="button" class="subtle small" data-grid-restore="detected" hidden>Usar o alinhamento detectado</button></div>
    <div class="grid-impact" data-grid-impact hidden><div class="grid-impact-head"><strong>O que a nova grade afeta</strong>${helpButton("campanhas.mapas.impacto-grade", "Impacto da nova grade")}</div><div data-grid-impact-body role="status" aria-live="polite"></div></div>
    <div class="field"><div class="field-label"><label for="${prefix}-scale">Cada quadrado representa (metros)</label>${helpButton("campanhas.mapas.grade", "Grade e escala")}</div><input id="${prefix}-scale" name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" required value="${esc(v.scaleMeters)}" aria-describedby="${prefix}-scale-help"><small class="form-help" id="${prefix}-scale-help">Usada para converter distâncias da ficha (deslocamento, luz, visão) em casas. 1,5 m é comum em mapas táticos.</small></div></div>`;
}

/**
 * Liga o ajuste a uma imagem (URL ou objeto local). `onChange({ gridPixels, gridOffsetX, gridOffsetY, valid })`.
 * `impact`: caminho de POST …/grid-impact, `false` para não prever, ou ausente (deduzido da imagem do acervo).
 * Devolve { values(), lossWarning(), dispose() }. `lossWarning()` = texto de confirmação quando a prévia mostra perdas.
 */
export function mountGridAdjust(root, src, { onChange, impact } = {}) {
  const box = root.querySelector("[data-grid-adjust]");
  const canvas = box.querySelector("[data-grid-canvas]");
  const loupe = box.querySelector("[data-grid-loupe]");
  const summary = box.querySelector("[data-grid-summary]");
  const input = (key) => box.querySelector(`input[type=range][name="${key}"]`);
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  let ready = false, zoom = 1, scale = 1;
  /** Assistente em curso: { mode: cell|span|detect, points: [{x,y}] em pixels da imagem, prev: valores antes, result }. */
  let wiz = null, active = -1;
  /** Valores ao abrir (Voltar ao alinhamento anterior) e último resultado da detecção automática. */
  let original = null, detected = null;
  const preview = box.querySelector('.grid-preview');
  let drag = null;
  function zoomAt(value, clientX, clientY) {
    const rect = preview.getBoundingClientRect();
    const x = clientX == null ? preview.clientWidth / 2 : clientX - rect.left;
    const y = clientY == null ? preview.clientHeight / 2 : clientY - rect.top;
    const ax = (preview.scrollLeft + x) / Math.max(1, canvas.offsetWidth);
    const ay = (preview.scrollTop + y) / Math.max(1, canvas.offsetHeight);
    zoom = Math.max(1, Math.min(MAX_ZOOM, value));
    const width = Math.max(1, preview.clientWidth) * zoom;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${width * canvas.height / Math.max(1, canvas.width)}px`;
    preview.scrollLeft = ax * canvas.offsetWidth - x;
    preview.scrollTop = ay * canvas.offsetHeight - y;
    preview.dataset.zoom = String(zoom);
    box.querySelector('[data-grid-zoom="out"]').disabled = zoom <= 1;
    box.querySelector('[data-grid-zoom="in"]').disabled = zoom >= MAX_ZOOM;
  }
  const disposeGestures = mountMapGestures(preview, { scale: () => zoom, zoom: zoomAt, cancel: () => { drag = null; hideLoupe(); } });
  /** Ponto da janela → pixels da imagem original (null fora da imagem). */
  function imagePoint(clientX, clientY, clampToImage = false) {
    const r = canvas.getBoundingClientRect();
    if (!ready || !r.width || !r.height) return null;
    let x = (clientX - r.left) / r.width * image.naturalWidth, y = (clientY - r.top) / r.height * image.naturalHeight;
    if (clampToImage) { x = Math.max(0, Math.min(image.naturalWidth, x)); y = Math.max(0, Math.min(image.naturalHeight, y)); }
    else if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) return null;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }
  /** Pontos marcados na escala da janela (para pegar com o dedo ou o mouse). */
  function clientPoints() {
    const r = canvas.getBoundingClientRect();
    return (wiz?.points || []).map((p) => ({ x: r.left + p.x / image.naturalWidth * r.width, y: r.top + p.y / image.naturalHeight * r.height }));
  }
  const down = e => {
    if (e.button !== 0) return;
    const hit = wiz && wiz.mode !== "detect" ? pickPoint(clientPoints(), e.clientX, e.clientY, e.pointerType === "touch" ? 24 : 14) : -1;
    if (hit >= 0) {
      // Pegar um ponto marcado: arrastar corrige a marcação com a lupa (o resultado é recalculado ao vivo).
      e.preventDefault();
      drag = { id: e.pointerId, point: hit };
      active = hit;
      preview.setPointerCapture(e.pointerId);
      showLoupe(wiz.points[hit]);
      return;
    }
    drag = { id:e.pointerId, x:e.clientX, y:e.clientY, left:preview.scrollLeft, top:preview.scrollTop };
    preview.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (drag && drag.id === e.pointerId && drag.point != null) {
      const p = imagePoint(e.clientX, e.clientY, true);
      if (!p || !wiz?.points[drag.point]) return;
      wiz.points[drag.point] = p;
      wizRefresh(); showLoupe(p);
      return;
    }
    if (!drag) {
      // Marcando com o mouse: a lupa acompanha o cursor para acertar o canto da casa.
      if (wiz && wiz.mode !== "detect" && wiz.points.length < 2 && e.pointerType === "mouse") { const p = imagePoint(e.clientX, e.clientY); if (p) showLoupe(p); else hideLoupe(); }
      return;
    }
    if (drag.id !== e.pointerId) return;
    preview.scrollLeft=drag.left+drag.x-e.clientX; preview.scrollTop=drag.top+drag.y-e.clientY;
  };
  // Com o assistente marcando pontos, um clique (sem arrastar) vira um ponto; arrastar continua movendo a vista.
  const up = e => {
    const wasPoint = drag?.point != null && drag.id === e?.pointerId;
    const tap = drag && drag.point == null && e?.type === "pointerup" && drag.id === e.pointerId && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5;
    drag = null;
    if (wasPoint) { hideLoupe(); wizText(`Ponto ${active + 1} corrigido. ${box.querySelector("[data-grid-wiz-text]").textContent.replace(/^Ponto \d corrigido\. /, "")}`); return; }
    if (tap && wiz && wiz.mode !== "detect" && wiz.points.length < 2) addPoint(e.clientX, e.clientY);
  };
  const leave = () => { if (!drag) hideLoupe(); };
  // Roda do mouse: aproxima/afasta no ponto do cursor (a página não rola junto).
  const wheel = e => { if (!ready) return; e.preventDefault(); zoomAt(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); };
  preview.addEventListener('pointerdown',down); preview.addEventListener('pointermove',move); preview.addEventListener('pointerup',up); preview.addEventListener('pointercancel',up); preview.addEventListener('pointerleave', leave);
  preview.addEventListener('wheel', wheel, { passive: false });
  const resize = new ResizeObserver(() => zoomAt(zoom));
  resize.observe(preview);
  const values = () => ({ gridPixels: Number(input("gridPixels").value), gridOffsetX: Number(input("gridOffsetX").value), gridOffsetY: Number(input("gridOffsetY").value) });

  // ---------- Lupa: recorte da imagem original ampliado, com a grade atual e os pontos marcados ----------
  function showLoupe(p) {
    if (!ready || !p) return;
    const v = values(), side = loupe.width, region = Math.max(16, Math.min(96, Math.round(v.gridPixels * 0.75)));
    const k = side / region, sx = p.x - region / 2, sy = p.y - region / 2;
    const c = loupe.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b0a08"; c.fillRect(0, 0, side, side);
    try { c.drawImage(image, sx, sy, region, region, 0, 0, side, side); } catch { /* imagem sem leitura: só a grade */ }
    c.strokeStyle = "rgba(241,215,156,.9)"; c.lineWidth = 1;
    c.beginPath();
    const first = (o) => o + Math.ceil((sx - o) / v.gridPixels) * v.gridPixels;
    for (let x = first(v.gridOffsetX); x <= sx + region; x += v.gridPixels) { const lx = Math.round((x - sx) * k) + 0.5; c.moveTo(lx, 0); c.lineTo(lx, side); }
    const firstY = v.gridOffsetY + Math.ceil((sy - v.gridOffsetY) / v.gridPixels) * v.gridPixels;
    for (let y = firstY; y <= sy + region; y += v.gridPixels) { const ly = Math.round((y - sy) * k) + 0.5; c.moveTo(0, ly); c.lineTo(side, ly); }
    c.stroke();
    // Mira no ponto (preto sob dourado, legível sobre qualquer imagem).
    for (const [w, color] of [[3, "rgba(11,10,8,.9)"], [1.5, "#f1d79c"]]) {
      c.lineWidth = w; c.strokeStyle = color;
      c.beginPath(); c.moveTo(side / 2 - 14, side / 2); c.lineTo(side / 2 + 14, side / 2); c.moveTo(side / 2, side / 2 - 14); c.lineTo(side / 2, side / 2 + 14); c.stroke();
    }
    // A lupa fica no canto oposto ao ponto, dentro da área visível da prévia.
    const r = canvas.getBoundingClientRect(), pr = preview.getBoundingClientRect();
    const clientX = r.left + p.x / image.naturalWidth * r.width;
    const left = clientX - pr.left < pr.width / 2 ? preview.clientWidth - side - 8 : 8;
    loupe.style.left = `${preview.scrollLeft + Math.max(0, left)}px`;
    loupe.style.top = `${preview.scrollTop + 8}px`;
    loupe.hidden = false;
  }
  function hideLoupe() { loupe.hidden = true; }

  function draw() {
    const v = values();
    if (!ready) { summary.textContent = "Carregando a imagem…"; return; }
    const g = gridFor(image.naturalWidth, image.naturalHeight, v.gridPixels, v.gridOffsetX, v.gridOffsetY);
    summary.textContent = g.valid ? `Resultado: ${g.message} (imagem de ${image.naturalWidth} × ${image.naturalHeight} px). Faixas fora da grade ficam escurecidas.` : g.message;
    summary.classList.toggle("invalid", !g.valid);
    scale = Math.min(1, 720 / image.naturalWidth, 480 / image.naturalHeight);
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
    // Pontos marcados no assistente: círculo com cruz e número, legíveis sobre qualquer imagem; o ativo ganha anel extra.
    for (const [i, p] of (wiz?.points || []).entries()) {
      const px = p.x * scale, py = p.y * scale;
      c.lineWidth = 3; c.strokeStyle = "rgba(11,10,8,.9)";
      c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.moveTo(px - 10, py); c.lineTo(px + 10, py); c.moveTo(px, py - 10); c.lineTo(px, py + 10); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = "#f1d79c";
      c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.moveTo(px - 10, py); c.lineTo(px + 10, py); c.moveTo(px, py - 10); c.lineTo(px, py + 10); c.stroke();
      if (i === active) { c.beginPath(); c.arc(px, py, 10, 0, Math.PI * 2); c.stroke(); }
      c.font = "bold 12px sans-serif"; c.fillStyle = "#f1d79c"; c.fillText(String(i + 1), px + 8, py - 8);
    }
    const restore = box.querySelector('[data-grid-restore="original"]');
    restore.disabled = !original || sameGrid(v, original);
    const useDetected = box.querySelector('[data-grid-restore="detected"]');
    useDetected.hidden = !detected; useDetected.disabled = !detected || sameGrid(v, detected);
    onChange?.({ ...v, valid: g.valid, width: g.width, height: g.height });
    scheduleImpact(v, g.valid);
  }

  // ---------- Prévia do impacto (somente leitura no servidor) ----------
  const impactPath = impact === false ? null : typeof impact === "string" ? impact : impactPathFor(src);
  const impactBox = box.querySelector("[data-grid-impact]"), impactBody = box.querySelector("[data-grid-impact-body]");
  let impactTimer = 0, impactAbort = null, lastImpact = null;
  function scheduleImpact(v, valid) {
    if (!impactPath) return;
    clearTimeout(impactTimer); impactAbort?.abort(); impactAbort = null;
    if (!valid || !original || sameGrid(v, original)) { impactBox.hidden = true; lastImpact = null; return; }
    impactBox.hidden = false;
    impactBody.innerHTML = '<p class="form-help">Calculando o que a nova grade afeta…</p>';
    // Sem atraso artificial: só espera o fim do arraste do controle para não consultar a cada pixel.
    impactTimer = setTimeout(async () => {
      const ctrl = new AbortController(); impactAbort = ctrl;
      try {
        const r = await api(impactPath, "POST", v, { background: true, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        const { lines, loss } = impactLines(r);
        lastImpact = { values: v, loss, lines };
        impactBody.innerHTML = `<ul class="grid-impact-list${loss ? " loss" : ""}">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="form-help">Nada muda até aplicar a grade.</p>`;
      } catch (e) {
        if (ctrl.signal.aborted || e?.name === "AbortError") return;
        lastImpact = null;
        impactBody.innerHTML = `<p class="form-help">Não foi possível prever o impacto agora: ${esc(e?.message || "falha de conexão")} A grade ainda pode ser aplicada.</p>`;
      }
    }, 250);
  }
  function lossWarning() {
    if (!lastImpact?.loss || !sameGrid(lastImpact.values, values())) return "";
    return `${lastImpact.lines.join(" ")} Aplicar a nova grade assim mesmo?`;
  }

  // ---------- Assistente de alinhamento ----------
  const wizStartBox = box.querySelector("[data-grid-wiz-start]"), wizRun = box.querySelector("[data-grid-wiz-run]");
  const wizText = (text) => { box.querySelector("[data-grid-wiz-text]").textContent = text; };
  const wizCount = () => Number(box.querySelector("[data-grid-wiz-n]").value);
  function wizStage(n) {
    for (const li of box.querySelectorAll("[data-grid-wiz-stage]")) {
      const s = Number(li.dataset.gridWizStage);
      li.classList.toggle("done", s < n);
      if (s === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    }
  }
  function setValues(v) { set("gridPixels", v.gridPixels); set("gridOffsetX", v.gridOffsetX); set("gridOffsetY", v.gridOffsetY); }
  function wizStart(mode) {
    if (!ready) { summary.textContent = "Aguarde a imagem carregar para usar o assistente."; return; }
    wiz = { mode, points: [], prev: values(), result: null }; active = -1;
    wizStartBox.hidden = true; wizRun.hidden = false; preview.dataset.wizard = mode;
    box.querySelector("[data-grid-wiz-count]").hidden = mode !== "span";
    box.querySelector('[data-grid-wiz="undo"]').hidden = mode === "detect";
    if (mode === "detect") detect(); else wizRefresh();
  }
  function wizEnd(keep) {
    if (!wiz) return;
    const prev = wiz.prev;
    wiz = null; active = -1; hideLoupe();
    wizStartBox.hidden = false; wizRun.hidden = true; delete preview.dataset.wizard;
    if (!keep) setValues(prev);
    draw();
    if (keep) summary.textContent = `Alinhamento aplicado. ${summary.textContent} Use os controles abaixo para o ajuste fino.`;
    box.querySelector(keep ? '[data-grid-wiz="detect"]' : '[data-grid-wiz="cell"]')?.focus();
  }
  function addPoint(clientX, clientY) {
    const p = imagePoint(clientX, clientY);
    if (!p) return;
    wiz.points.push(p); active = wiz.points.length - 1;
    wizRefresh();
  }
  function wizRefresh() {
    if (!wiz) return;
    if (wiz.points.length < 2) {
      if (wiz.result) setValues(wiz.prev);
      wiz.result = null;
      wizStage(1);
      wizText(`${WIZARD_STEPS[wiz.mode][wiz.points.length]} Aproxime a prévia (roda do mouse ou +) e use a lupa para marcar com precisão.`);
      box.querySelector('[data-grid-wiz="apply"]').disabled = true;
      box.querySelector('[data-grid-wiz="undo"]').disabled = !wiz.points.length;
      draw();
      return;
    }
    box.querySelector('[data-grid-wiz="undo"]').disabled = false;
    const [a, b] = wiz.points;
    showResult(wiz.mode === "cell" ? fromCell(a, b) : fromSpan(a, b, wizCount()));
  }
  /** Aplica o resultado à prévia (sem gravar) e descreve; erro volta aos valores anteriores. */
  function showResult(result) {
    const apply = box.querySelector('[data-grid-wiz="apply"]');
    if (!result || result.error) {
      wiz.result = null; setValues(wiz.prev); draw();
      wizStage(wiz.mode === "detect" ? 1 : 2);
      wizText(result?.error || "Não foi possível calcular a grade.");
      apply.disabled = true;
      return;
    }
    wiz.result = result;
    if (wiz.mode === "detect") detected = { gridPixels: result.gridPixels, gridOffsetX: result.gridOffsetX, gridOffsetY: result.gridOffsetY };
    setValues(result); draw();
    const g = gridFor(image.naturalWidth, image.naturalHeight, result.gridPixels, result.gridOffsetX, result.gridOffsetY);
    wizStage(g.valid ? 3 : 2);
    const certainty = result.confidence != null ? ` Certeza do reconhecimento: ${Math.round(result.confidence * 100)}%.` : "";
    const fix = wiz.mode === "detect" ? "" : " Arraste um ponto para corrigi-lo.";
    wizText(`${describeAlignment(result)} ${g.message}.${certainty} ${result.warnings.join(" ")} ${g.valid ? `Confira as linhas douradas na prévia e confirme.${fix}` : ""}`.replace(/\s+/g, " ").trim());
    apply.disabled = !g.valid;
  }
  /** Mede colunas numa faixa horizontal e linhas numa faixa vertical da imagem em tamanho real (sem perder precisão). */
  function detect() {
    wizStage(1); wizText("Procurando a grade na imagem…");
    try {
      const W = image.naturalWidth, H = image.naturalHeight, band = 384;
      const read = (sx, sy, sw, sh) => {
        const c = document.createElement("canvas");
        c.width = sw; c.height = sh;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        return g.getImageData(0, 0, sw, sh).data;
      };
      const bh = Math.min(H, band), bw = Math.min(W, band);
      const step = (n) => Math.max(1, Math.round(n / 1024));
      const columns = edgeProfiles(read(0, Math.floor((H - bh) / 2), W, bh), W, bh, step(bh)).columns;
      const rows = edgeProfiles(read(Math.floor((W - bw) / 2), 0, bw, H), bw, H, step(bw)).rows;
      showResult(detectFromProfiles(columns, rows));
    } catch {
      showResult({ error: "Esta imagem não permite a detecção automática. Use Marcar uma casa ou Marcar N casas." });
    }
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
    if (e.target.matches("[data-grid-wiz-n]")) { if (wiz?.mode === "span" && wiz.points.length === 2) wizRefresh(); return; }
    if (e.target.matches("input[type=range]")) set(e.target.name, e.target.value);
    else if (e.target.dataset.gridNumber) set(e.target.dataset.gridNumber, e.target.value);
    else return;
    draw();
  };
  const onChangeSelect = (e) => {
    if (!e.target.matches("[data-grid-preset]") || !e.target.value) return;
    const px = Number(e.target.value);
    e.target.value = "";
    if (px > Number(input("gridPixels").max)) { summary.textContent = `O quadrado de ${px} px não cabe nesta imagem.`; return; }
    set("gridPixels", px); draw();
  };
  const onClick = (e) => {
    const zoomAction = e.target.closest('[data-grid-zoom]')?.dataset.gridZoom;
    if (zoomAction) { zoomAt(zoomAction === 'fit' ? 1 : zoom * (zoomAction === 'in' ? 1.25 : .8)); return; }
    const restore = e.target.closest("[data-grid-restore]")?.dataset.gridRestore;
    if (restore) {
      const target = restore === "detected" ? detected : original;
      if (target) { if (wiz) wizEnd(false); setValues(target); draw(); summary.textContent = `${restore === "detected" ? "Alinhamento detectado em uso." : "Alinhamento anterior restaurado."} ${summary.textContent}`; }
      return;
    }
    const wizAction = e.target.closest("[data-grid-wiz]")?.dataset.gridWiz;
    if (wizAction) {
      if (["detect", "cell", "span"].includes(wizAction)) wizStart(wizAction);
      else if (wizAction === "undo" && wiz) { wiz.points.pop(); active = wiz.points.length - 1; wizRefresh(); }
      else if (wizAction === "cancel") wizEnd(false);
      else if (wizAction === "apply" && wiz?.result) wizEnd(true);
      return;
    }
    const b = e.target.closest("[data-grid-step]");
    if (!b) return;
    const [key, delta] = b.dataset.gridStep.split("|");
    set(key, Number(input(key).value) + Number(delta));
    draw();
  };
  // Enter no número de casas recalcula sem enviar o formulário do chamador; Esc cancela o assistente.
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const onKey = (e) => {
    if (e.target === preview && ready && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const dir = ARROWS[e.key], step = e.shiftKey ? 10 : 1;
      if (dir) {
        e.preventDefault();
        if (wiz && wiz.mode !== "detect" && wiz.points[active]) {
          // Ajuste fino do ponto marcado: 1 px da imagem original (Shift: 10).
          const p = wiz.points[active];
          wiz.points[active] = { x: Math.max(0, Math.min(image.naturalWidth, p.x + dir[0] * step)), y: Math.max(0, Math.min(image.naturalHeight, p.y + dir[1] * step)) };
          wizRefresh();
        } else {
          let v = values();
          if (dir[0]) v = nudgeGrid(v, "gridOffsetX", dir[0] * step);
          if (dir[1]) v = nudgeGrid(v, "gridOffsetY", dir[1] * step);
          setValues(v); draw();
        }
        return;
      }
      if (!wiz && ["+", "=", "-", "_"].includes(e.key)) {
        e.preventDefault();
        setValues(nudgeGrid(values(), "gridPixels", (e.key === "+" || e.key === "=" ? 1 : -1) * step, Number(input("gridPixels").max)));
        draw();
        return;
      }
    }
    if (!wiz) return;
    if (e.key === "Enter" && e.target.matches("[data-grid-wiz-n]")) { e.preventDefault(); wizRefresh(); }
    else if (e.key === "Escape" && (wizRun.contains(e.target) || e.target === preview)) { e.preventDefault(); e.stopPropagation(); wizEnd(false); }
  };
  box.addEventListener("input", onInput);
  box.addEventListener("change", onChangeSelect);
  box.addEventListener("click", onClick);
  box.addEventListener("keydown", onKey);
  image.onload = () => {
    ready = true;
    input("gridPixels").max = String(Math.max(8, Math.min(1024, image.naturalWidth, image.naturalHeight)));
    box.querySelector('[data-grid-number="gridPixels"]')?.setAttribute("max", input("gridPixels").max);
    original = values();
    draw(); zoomAt(zoom);
  };
  image.onerror = () => { summary.textContent = "Não foi possível abrir a imagem para a prévia. Os números continuam valendo."; };
  image.src = src;
  draw();
  return {
    values, lossWarning,
    dispose() {
      disposeGestures(); resize.disconnect(); clearTimeout(impactTimer); impactAbort?.abort();
      preview.removeEventListener('pointerdown',down); preview.removeEventListener('pointermove',move); preview.removeEventListener('pointerup',up); preview.removeEventListener('pointercancel',up); preview.removeEventListener('pointerleave', leave); preview.removeEventListener('wheel', wheel);
      box.removeEventListener("input", onInput); box.removeEventListener("change", onChangeSelect); box.removeEventListener("click", onClick); box.removeEventListener("keydown", onKey);
      wiz = null; image.onload = image.onerror = null;
    },
  };
}
