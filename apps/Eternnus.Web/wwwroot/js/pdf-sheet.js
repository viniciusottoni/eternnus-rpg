import { sheetPdfPath } from "./character-policy.js";
import { api } from "./api.js";
import { withLoading } from "./loading.js";
// Renderização compartilhada de ficha: páginas do PDF de fundo (pdf.js local em /vendor/pdfjs) com uma camada de campos posicionados.
// Usada pelo editor de fichas-modelo (WP5) e pela ficha do jogador (WP6).
//
// API
//   const sheet = renderSheet(container, {
//     pdfUrl,   // string | null — URL same-origin do PDF de fundo. null → páginas em branco no tamanho de `pages`.
//     pages,    // [{ width, height }] em pontos PDF (autoridade do layout; o PDF só pinta o fundo).
//     fields,   // campos da ficha-modelo (coordenadas normalizadas 0..1 por página, origem no canto superior esquerdo).
//     mode,     // "edit" | "fill" | "view"
//     values,   // { nome: "texto" } — modos fill/view. Calculados são recomputados aqui (formula.js computeSheet).
//     onChange, // edit: (index, { x, y, w, h }, { kind: "move" | "resize" | "key" }) ao soltar/teclar.
//               // fill: (name, value, allValues) a cada digitação.
//     onSelect, // edit: (index | -1, { activate }) ao clicar, focar ou Enter (activate = true no Enter / duplo clique).
//     onCreate, // edit: (rect, pageIndex) ao arrastar numa área vazia (mouse/caneta; no toque o arrasto rola a página).
//     onDelete, // edit (opcional): (index) com Delete/Backspace no campo focado.
//     snap,     // edit (opcional): passo da grade em fração da página (ex.: 0.005). 0 = livre. Alt durante o arrasto desliga.
//     guides,   // edit (opcional, padrão true): guias de alinhamento com os outros campos da página.
//     label,    // nome acessível do conjunto (padrão "Ficha").
//     invalid,  // Set/array de nomes de campos a marcar como problemáticos (edit).
//   });
//   sheet.ready                → Promise resolvida quando o PDF terminou de abrir (ou falhou; a ficha continua utilizável).
//   sheet.setFields(fields)    → redesenha a camada de campos preservando seleção e foco.
//   sheet.setValues(values)    → atualiza os valores (fill/view) sem recriar a página.
//   sheet.select(index, { scroll, focus }) → seleciona (edit) sem disparar onSelect.
//   sheet.zoom(factor?)        → lê ou define o zoom (0,5–3; 1 = largura disponível, até 920 px).
//   sheet.setOptions({ snap, guides, invalid })
//   sheet.values()             → cópia dos valores atuais com os calculados.
//   sheet.destroy()            → cancela renderizações, libera o documento pdf.js e os observers e limpa o contêiner.
//
// Segurança: nenhum dado do usuário entra em innerHTML, classes ou atributos livres (textContent e propriedades DOM);
// estilos por CSSOM (compatível com a CSP sem 'unsafe-inline'); pdf.js com isEvalSupported:false e enableScripting:false.
import { computeSheet, parseNumber } from "./formula.js";
import { alignGuides, clamp, moveRect, normalizeRect, rectFromPoints, resizeRect, roleInfo, snapRect, typeInfo, ALIGNS } from "./sheet-editor-policy.js";

export const MODES = Object.freeze(["edit", "fill", "view"]);
export const HANDLES = Object.freeze(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
export const ZOOM = Object.freeze({ min: 0.5, max: 3, maxWidth: 920, minWidth: 240 });
/** Menor campo criado por arrasto (fração da página): acima do mínimo da validação de publicação (0,005). */
export const MIN_CREATE = 0.008;

// ---------- Regras puras (testadas em tests/pdf-sheet.test.mjs) ----------

export const clampZoom = (value) => clamp(Math.round((Number(value) || 1) * 100) / 100, ZOOM.min, ZOOM.max);
/** Tamanho da página em pixels: ocupa a largura disponível (até 920 px) vezes o zoom; `scale` = pixels por ponto PDF. */
export function pageBox(page, available, zoom = 1) {
  const width = Math.round(Math.max(ZOOM.minWidth, Math.min(available, ZOOM.maxWidth)) * clampZoom(zoom));
  const scale = width / page.width;
  return { width, height: Math.round(page.height * scale), scale };
}
/** Tecla → alteração do retângulo no modo edição. Setas movem; Shift+setas redimensionam; Alt = passo fino. */
export function keyboardChange(key, { shift = false, alt = false } = {}) {
  const step = alt ? 0.001 : 0.005;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
  if (!delta) return null;
  return { kind: shift ? "resize" : "move", dx: delta[0], dy: delta[1] };
}
/** Aplica a alteração de teclado: redimensionar mexe na borda direita/inferior. */
export function applyKeyboard(rect, change, min = MIN_CREATE) {
  if (change.kind === "move") return moveRect(rect, change.dx, change.dy);
  return resizeRect(rect, (change.dx ? "e" : "") + (change.dy ? "s" : ""), change.dx, change.dy, Math.min(min, rect.w, rect.h));
}
/** Controle usado no modo fill por tipo de campo. */
export function controlKind(field) {
  return { number: "number", textarea: "textarea", checkbox: "checkbox", select: "select", computed: "output" }[field?.type] || "text";
}
/** Texto mostrado no modo view. */
export function displayValue(field, value) {
  const text = value == null ? "" : String(value);
  if (field?.type === "checkbox") return text === "true" ? "✓" : "";
  return text;
}
/** Problema de um número digitado (vazio = ok). */
export function numberProblem(field, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const n = parseNumber(text);
  if (n === null) return "Digite um número.";
  if (field.min != null && n < field.min) return `Mínimo ${field.min}.`;
  if (field.max != null && n > field.max) return `Máximo ${field.max}.`;
  return "";
}
const alignClass = (align) => "ps-align-" + (ALIGNS.some((a) => a.value === align) ? align : "left");
const pct = (v) => (Number(v) * 100).toFixed(4) + "%";

// ---------- Componente ----------

export function renderSheet(container, options = {}) {
  const opts = {
    pdfUrl: null,
    pages: [],
    fields: [],
    mode: "view",
    values: {},
    snap: 0,
    guides: true,
    label: "Ficha",
    ...options,
  };
  const mode = MODES.includes(opts.mode) ? opts.mode : "view";
  const pages = (opts.pages?.length ? opts.pages : [{ width: 595.28, height: 841.89 }]).map((p) => ({
    width: Number(p.width) > 0 ? Number(p.width) : 595.28,
    height: Number(p.height) > 0 ? Number(p.height) : 841.89,
  }));
  let fields = (opts.fields || []).slice();
  let values = { ...(opts.values || {}) };
  let computed = computeSheet(fields, values);
  let invalid = new Set(opts.invalid || []);
  let zoomFactor = 1;
  let selected = -1;
  let destroyed = false;
  let doc = null;
  let drag = null;
  const controller = new AbortController();

  const root = document.createElement("div");
  root.className = "ps-root ps-mode-" + mode;
  root.setAttribute("role", "group");
  if (mode === "edit") root.tabIndex = -1;
  root.setAttribute("aria-label", String(opts.label));
  const status = document.createElement("p");
  status.className = "ps-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const list = document.createElement("div");
  list.className = "ps-pages";
  root.append(status, list);
  container.replaceChildren(root);

  const views = pages.map((page, index) => {
    const el = document.createElement("section");
    el.className = "ps-page";
    el.dataset.page = String(index);
    el.setAttribute("aria-label", `Página ${index + 1} de ${pages.length}`);
    const canvas = document.createElement("canvas");
    canvas.className = "ps-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.hidden = true;
    const layer = document.createElement("div");
    layer.className = "ps-layer";
    el.append(canvas, layer);
    list.append(el);
    return { page, index, el, canvas, layer, box: null, renderedWidth: 0, task: null, visible: false };
  });

  const setStatus = (text, tone = "") => {
    status.textContent = text;
    status.hidden = !text;
    status.className = "ps-status" + (tone === "error" ? " is-error" : "");
  };

  // ----- Layout -----
  function layout() {
    if (destroyed) return;
    const available = Math.max(ZOOM.minWidth, list.clientWidth || container.clientWidth || 600);
    for (const view of views) {
      view.box = pageBox(view.page, available, zoomFactor);
      view.el.style.width = view.box.width + "px";
      view.el.style.height = view.box.height + "px";
      view.el.style.setProperty("--ps-scale", String(view.box.scale));
      if (view.visible) queueRender(view);
    }
  }

  // ----- Campos -----
  function fieldLabel(f) {
    return (f.label || f.name || "Campo").trim();
  }
  function place(el, f) {
    el.style.left = pct(f.x);
    el.style.top = pct(f.y);
    el.style.width = pct(f.w);
    el.style.height = pct(f.h);
    el.style.setProperty("--ps-fs", String(Number(f.fontSize) || 10));
  }
  function editElement(f, index) {
    const el = document.createElement("div");
    const type = typeInfo(f.type);
    el.className = `ps-field ps-edit ${type.css} ${alignClass(f.align)}`;
    if (f.role) el.classList.add("ps-has-role");
    if (invalid.has(f.name)) el.classList.add("ps-invalid");
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    const role = roleInfo(f.role);
    el.setAttribute(
      "aria-label",
      `${fieldLabel(f)} — ${type.label}${role ? ", papel " + role.label : ""}${invalid.has(f.name) ? ", com problema" : ""}. Setas movem, Shift+setas redimensionam.`,
    );
    const tag = document.createElement("span");
    tag.className = "ps-tag";
    const icon = document.createElement("b");
    icon.textContent = type.icon;
    icon.setAttribute("aria-hidden", "true");
    tag.append(icon, document.createTextNode(" " + fieldLabel(f)));
    el.append(tag);
    return el;
  }
  function caption(f) {
    const c = document.createElement("span");
    c.className = "ps-caption";
    c.textContent = fieldLabel(f);
    c.setAttribute("aria-hidden", "true");
    return c;
  }
  function fillElement(f, index) {
    const el = document.createElement("div");
    el.className = `ps-field ps-fill ${typeInfo(f.type).css} ${alignClass(f.align)}`;
    const kind = controlKind(f);
    const id = `ps-${uid}-${index}`;
    let control;
    if (kind === "textarea") {
      control = document.createElement("textarea");
      if (f.maxLength) control.maxLength = f.maxLength;
    } else if (kind === "checkbox") {
      control = document.createElement("input");
      control.type = "checkbox";
    } else if (kind === "select") {
      control = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "—";
      control.append(empty);
      for (const option of f.options || []) {
        const o = document.createElement("option");
        o.value = option;
        o.textContent = option;
        control.append(o);
      }
    } else if (kind === "output") {
      control = document.createElement("output");
      control.setAttribute("aria-readonly", "true");
      control.title = f.formula ? "Calculado: " + f.formula : "Calculado";
    } else {
      control = document.createElement("input");
      control.type = "text";
      if (kind === "number") control.inputMode = "decimal";
      if (f.maxLength) control.maxLength = f.maxLength;
      control.autocomplete = "off";
    }
    control.className = "ps-control";
    control.id = id;
    control.dataset.index = String(index);
    control.setAttribute("aria-label", fieldLabel(f) + (kind === "output" ? " (calculado)" : ""));
    el.append(control);
    writeControl(control, f);
    return el;
  }
  function writeControl(control, f) {
    const value = computed[f.name] ?? "";
    const kind = controlKind(f);
    if (kind === "checkbox") control.checked = value === "true";
    else if (kind === "output") control.textContent = value === "" ? "—" : value;
    else if (document.activeElement !== control && control.value !== value) control.value = value;
    if (kind === "number") {
      const problem = numberProblem(f, control.value);
      control.setAttribute("aria-invalid", String(!!problem));
      control.title = problem;
    }
  }
  function viewElement(f) {
    const el = document.createElement("div");
    el.className = `ps-field ps-view ${typeInfo(f.type).css} ${alignClass(f.align)}`;
    const text = document.createElement("span");
    text.className = "ps-value";
    text.textContent = displayValue(f, computed[f.name]);
    el.setAttribute("role", "note");
    el.setAttribute("aria-label", `${fieldLabel(f)}: ${f.type === "checkbox" ? (computed[f.name] === "true" ? "marcado" : "desmarcado") : computed[f.name] || "vazio"}`);
    el.append(text);
    return el;
  }
  const uid = Math.random().toString(36).slice(2, 8);
  let elements = [];
  function renderFields() {
    const focused = document.activeElement;
    const focusIndex = root.contains(focused) ? Number(focused.closest("[data-index]")?.dataset.index ?? -1) : -1;
    const focusWasControl = focused?.classList?.contains("ps-control");
    for (const view of views) view.layer.replaceChildren();
    elements = fields.map((f, index) => {
      const view = views[f.page ?? 0];
      if (!view) return null;
      const el = mode === "edit" ? editElement(f, index) : mode === "fill" ? fillElement(f, index) : viewElement(f, index);
      el.dataset.index = String(index);
      if (mode !== "edit") el.append(caption(f));
      place(el, f);
      view.layer.append(el);
      return el;
    });
    applySelection();
    if (focusIndex >= 0 && elements[focusIndex]) {
      const target = focusWasControl ? elements[focusIndex].querySelector(".ps-control") : elements[focusIndex];
      target?.focus({ preventScroll: true });
    }
  }
  function applySelection() {
    for (const [index, el] of elements.entries()) {
      if (!el || mode !== "edit") continue;
      const on = index === selected;
      el.classList.toggle("ps-selected", on);
      el.setAttribute("aria-pressed", String(on));
      el.querySelectorAll(".ps-handle").forEach((h) => h.remove());
      if (on)
        for (const handle of HANDLES) {
          const h = document.createElement("span");
          h.className = "ps-handle ps-h-" + handle;
          h.dataset.handle = handle;
          h.setAttribute("aria-hidden", "true");
          el.append(h);
        }
    }
  }
  function select(index, { scroll = false, focus = false } = {}) {
    selected = Number.isInteger(index) && index >= 0 && index < fields.length ? index : -1;
    applySelection();
    const el = elements[selected];
    if (el && scroll) el.scrollIntoView({ block: "center", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (el && focus) el.focus({ preventScroll: !scroll });
  }
  const notifySelect = (index, extra = {}) => opts.onSelect?.(index, extra);

  // ----- Edição: arrastar, redimensionar, criar -----
  function pointFrom(event, rect) {
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  }
  function showGuides(view, lines) {
    view.layer.querySelectorAll(".ps-guide").forEach((g) => g.remove());
    for (const line of lines) {
      const g = document.createElement("span");
      g.className = "ps-guide ps-guide-" + (line.axis === "x" ? "x" : "y");
      if (line.axis === "x") g.style.left = pct(line.at);
      else g.style.top = pct(line.at);
      g.setAttribute("aria-hidden", "true");
      view.layer.append(g);
    }
  }
  function adjust(rect, event, view, index, kind, handle) {
    let r = rect;
    if (opts.snap > 0 && !event.altKey) r = snapRect(r, opts.snap, Math.min(MIN_CREATE, r.w, r.h));
    if (opts.guides !== false && !event.altKey) {
      const others = fields.filter((f, i) => i !== index && (f.page ?? 0) === view.index);
      const threshold = 6 / view.box.width;
      const g = alignGuides(r, others, threshold, kind === "resize" ? "resize" : "move", handle || "");
      showGuides(view, g.lines);
      return g.rect;
    }
    return r;
  }
  function onPointerDown(event) {
    if (mode !== "edit" || drag || event.button > 0) return;
    const layer = event.target.closest(".ps-layer");
    if (!layer) return;
    const view = views[Number(layer.parentElement.dataset.page)];
    const bounds = layer.getBoundingClientRect();
    const handle = event.target.closest(".ps-handle")?.dataset.handle;
    const fieldEl = event.target.closest(".ps-field");
    const touch = event.pointerType === "touch";
    const start = pointFrom(event, bounds);
    if (fieldEl) {
      const index = Number(fieldEl.dataset.index);
      const wasSelected = index === selected;
      if (!wasSelected) {
        select(index);
        notifySelect(index);
      }
      // No toque, o primeiro toque só seleciona (para a página continuar rolando); arrastar exige o campo já selecionado.
      if (touch && !wasSelected) return;
      drag = { kind: handle ? "resize" : "move", handle: handle || "", index, view, bounds, start, orig: { ...rectOf(fields[index]) }, el: fieldEl, moved: false, id: event.pointerId };
    } else {
      if (touch) {
        if (selected >= 0) {
          select(-1);
          notifySelect(-1);
        }
        return;
      }
      const ghost = document.createElement("span");
      ghost.className = "ps-ghost";
      ghost.setAttribute("aria-hidden", "true");
      drag = { kind: "create", index: -1, view, bounds, start, ghost, moved: false, id: event.pointerId };
    }
    event.preventDefault();
    try {
      layer.setPointerCapture(event.pointerId);
    } catch {
      /* captura indisponível: segue sem ela */
    }
  }
  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const p = pointFrom(event, drag.bounds);
    const dx = p.x - drag.start.x,
      dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx * drag.bounds.width, dy * drag.bounds.height) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      root.classList.add("ps-dragging");
      if (drag.ghost) drag.view.layer.append(drag.ghost);
    }
    if (drag.kind === "create") {
      drag.rect = rectFromPoints(drag.start, p);
      place(drag.ghost, { ...drag.rect, fontSize: 10 });
      return;
    }
    const base =
      drag.kind === "move"
        ? moveRect(drag.orig, dx, dy)
        : resizeRect(drag.orig, drag.handle, dx, dy, Math.min(MIN_CREATE, drag.orig.w, drag.orig.h));
    drag.rect = adjust(base, event, drag.view, drag.index, drag.kind, drag.handle);
    place(drag.el, { ...fields[drag.index], ...drag.rect });
  }
  function finishDrag(event, cancelled = false) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    root.classList.remove("ps-dragging");
    showGuides(d.view, []);
    d.ghost?.remove();
    if (d.kind === "create") {
      if (cancelled) return;
      const r = d.rect;
      if (d.moved && r && r.w * d.bounds.width >= 8 && r.h * d.bounds.height >= 8) {
        opts.onCreate?.(normalizeRect({ ...r, w: Math.max(r.w, MIN_CREATE), h: Math.max(r.h, MIN_CREATE) }), d.view.index);
      } else if (selected >= 0) {
        select(-1);
        notifySelect(-1);
      }
      return;
    }
    if (cancelled || !d.moved || !d.rect) {
      place(d.el, fields[d.index]);
      return;
    }
    fields[d.index] = { ...fields[d.index], ...d.rect };
    opts.onChange?.(d.index, { ...d.rect }, { kind: d.kind });
  }
  const rectOf = (f) => ({ x: f.x, y: f.y, w: f.w, h: f.h });
  function onKeyDown(event) {
    if (mode !== "edit") return;
    const fieldEl = event.target.closest?.(".ps-field");
    if (!fieldEl) return;
    const index = Number(fieldEl.dataset.index);
    if (event.key === "Escape") {
      if (drag) return finishDrag(null, true);
      select(-1);
      notifySelect(-1);
      root.focus?.();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(index);
      notifySelect(index, { activate: true });
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && opts.onDelete) {
      event.preventDefault();
      opts.onDelete(index);
      return;
    }
    const change = keyboardChange(event.key, { shift: event.shiftKey, alt: event.altKey });
    if (!change) return;
    event.preventDefault();
    const rect = applyKeyboard(rectOf(fields[index]), change);
    fields[index] = { ...fields[index], ...rect };
    place(fieldEl, fields[index]);
    if (index !== selected) {
      select(index);
      notifySelect(index);
    }
    opts.onChange?.(index, rect, { kind: "key" });
  }
  function onFocusIn(event) {
    if (mode !== "edit" || drag) return;
    const fieldEl = event.target.closest?.(".ps-field");
    if (!fieldEl) return;
    const index = Number(fieldEl.dataset.index);
    if (index !== selected) {
      select(index);
      notifySelect(index);
    }
  }
  function onDoubleClick(event) {
    if (mode !== "edit") return;
    const fieldEl = event.target.closest(".ps-field");
    if (fieldEl) notifySelect(Number(fieldEl.dataset.index), { activate: true });
  }

  // ----- Preenchimento -----
  function refreshComputed() {
    computed = computeSheet(fields, values);
    for (const [index, el] of elements.entries()) {
      if (!el) continue;
      const control = el.querySelector(".ps-control");
      if (control) writeControl(control, fields[index]);
    }
  }
  function onInput(event) {
    if (mode !== "fill") return;
    const control = event.target.closest?.(".ps-control");
    if (!control || control.tagName === "OUTPUT") return;
    const f = fields[Number(control.dataset.index)];
    if (!f) return;
    const value = control.type === "checkbox" ? String(control.checked) : control.value;
    values[f.name] = value;
    refreshComputed();
    opts.onChange?.(f.name, value, { ...values });
  }

  const signal = controller.signal;
  root.addEventListener("pointerdown", onPointerDown, { signal });
  root.addEventListener("pointermove", onPointerMove, { signal });
  root.addEventListener("pointerup", (e) => finishDrag(e), { signal });
  root.addEventListener("pointercancel", (e) => finishDrag(e, true), { signal });
  root.addEventListener("lostpointercapture", (e) => drag && e.pointerId === drag.id && finishDrag(e), { signal });
  root.addEventListener("keydown", onKeyDown, { signal });
  root.addEventListener("focusin", onFocusIn, { signal });
  root.addEventListener("dblclick", onDoubleClick, { signal });
  root.addEventListener("input", onInput, { signal });
  root.addEventListener("change", onInput, { signal });

  // ----- PDF: renderização sob demanda -----
  let chain = Promise.resolve();
  function queueRender(view) {
    if (!doc || destroyed || view.index >= doc.numPages || view.renderedWidth === view.box?.width) return;
    chain = chain.then(() => renderPage(view)).catch(() => {});
  }
  async function renderPage(view) {
    if (!doc || destroyed || !view.visible || view.renderedWidth === view.box.width) return;
    const width = view.box.width;
    const pdfPage = await doc.getPage(view.index + 1);
    if (destroyed) return;
    const base = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: width / base.width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = view.canvas;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    view.task?.cancel();
    view.task = pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    try {
      await view.task.promise;
    } catch (error) {
      if (error?.name === "RenderingCancelledException") return;
      throw error;
    } finally {
      view.task = null;
    }
    if (destroyed) return;
    view.renderedWidth = width;
    canvas.hidden = false;
    view.el.classList.add("ps-has-pdf");
  }
  function release(view) {
    // Páginas longe da tela liberam o bitmap (PDFs de até 50 páginas).
    view.task?.cancel();
    if (view.renderedWidth) {
      view.canvas.width = 0;
      view.canvas.height = 0;
      view.renderedWidth = 0;
    }
  }
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const view = views[Number(entry.target.dataset.page)];
              view.visible = entry.isIntersecting;
              if (view.visible) queueRender(view);
              else if (Math.abs(entry.boundingClientRect.top) > 4 * (entry.rootBounds?.height || 900)) release(view);
            }
          },
          { rootMargin: "600px 0px" },
        )
      : null;
  for (const view of views) {
    if (io) io.observe(view.el);
    else view.visible = true;
  }
  let resizeTimer = 0;
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(layout, 120);
        })
      : null;
  ro?.observe(list);

  async function loadPdf() {
    if (!opts.pdfUrl) return;
    root.classList.add("ps-loading");
    setStatus("Carregando o PDF de fundo…");
    try {
      const data = await api(sheetPdfPath(opts.pdfUrl), "GET", undefined, { signal, responseType: "bytes" });
      if (destroyed) return;
      const pdfjs = await import("/vendor/pdfjs/pdf.min.js");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      const loaded = await pdfjs.getDocument({
        data,
        isEvalSupported: false,
        enableScripting: false,
        enableXfa: false,
        disableAutoFetch: true,
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
      }).promise;
      if (destroyed) {
        loaded.destroy();
        return;
      }
      doc = loaded;
      setStatus(doc.numPages < pages.length ? `O PDF tem ${doc.numPages} página(s); as demais aparecem em branco.` : "");
      for (const view of views) if (view.visible) queueRender(view);
      await chain;
    } catch (error) {
      if (destroyed || error?.name === "AbortError") return;
      root.classList.add("ps-pdf-failed");
      setStatus(
        (error?.name === "PasswordException" ? "O PDF de fundo é protegido por senha." : error?.message?.startsWith("O PDF") || error?.message?.startsWith("Não foi") ? error.message : "Não foi possível abrir o PDF de fundo.") +
          " Os campos continuam disponíveis sobre páginas em branco.",
        "error",
      );
    } finally {
      root.classList.remove("ps-loading");
    }
  }

  layout();
  renderFields();
  if (!opts.pdfUrl) root.classList.add("ps-no-pdf");
  const ready = opts.pdfUrl ? withLoading(loadPdf) : Promise.resolve();

  return {
    ready,
    get mode() {
      return mode;
    },
    setFields(next) {
      if (destroyed) return;
      if (drag) finishDrag(null, true);
      fields = (next || []).slice();
      if (selected >= fields.length) selected = -1;
      computed = computeSheet(fields, values);
      renderFields();
    },
    setValues(next) {
      if (destroyed) return;
      values = { ...(next || {}) };
      if (mode === "fill") refreshComputed();
      else {
        computed = computeSheet(fields, values);
        renderFields();
      }
    },
    values() {
      return { ...computed };
    },
    select,
    zoom(factor) {
      if (factor === undefined) return zoomFactor;
      zoomFactor = clampZoom(factor);
      layout();
      return zoomFactor;
    },
    setOptions(next = {}) {
      if ("snap" in next) opts.snap = Number(next.snap) || 0;
      if ("guides" in next) opts.guides = next.guides !== false;
      if ("invalid" in next) {
        invalid = new Set(next.invalid || []);
        if (mode === "edit") renderFields();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      io?.disconnect();
      ro?.disconnect();
      clearTimeout(resizeTimer);
      for (const view of views) view.task?.cancel();
      doc?.destroy();
      doc = null;
      root.remove();
    },
  };
}
