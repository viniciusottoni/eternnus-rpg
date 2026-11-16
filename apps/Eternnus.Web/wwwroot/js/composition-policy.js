// Regras puras do documento de mapa de imagem (ADR-081): modelo, limites, geometria (rotação, alças, encaixe),
// redimensionamento do documento, ordem, alinhamento e validação. Sem DOM, sem HTTP e sem importações: testado em Node.
// Coordenadas sempre em pixels do documento; o artboard (área visível) começa em (0, 0).

export const LIMITS = Object.freeze({
  artboardMin: 64, artboardMax: 4096, artboardPixels: 8_000_000,
  coordMin: -16384, coordMax: 20480, sizeMin: 1, sizeMax: 16384,
  elements: 200, layers: 8, text: 500, elementName: 80, layerName: 40,
  fontMin: 6, fontMax: 400, strokeMax: 100, sources: 40, rotation: 360,
});
export const ELEMENT_TYPES = Object.freeze(["image", "text", "rect", "ellipse"]);
export const FONTS = Object.freeze(["serif", "sans", "display"]);
export const ALIGNS = Object.freeze(["left", "center", "right"]);
export const ANCHORS = Object.freeze(["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"]);
export const HANDLES = Object.freeze(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
const HANDLE_VECTOR = Object.freeze({ nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] });
const ID = /^[a-z0-9-]{1,24}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ASSET = /^asset:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const REQUIRED = [["base", "Base"], ["elements", "Elementos"]];
const RAD = Math.PI / 180;

const num = (v, d = 0) => (v === null || v === "" || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round2 = (v) => Math.round(v * 100) / 100;
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const isHex = (v) => typeof v === "string" && HEX.test(v);
export const isSource = (v) => v === "self" || (typeof v === "string" && ASSET.test(v));

// ---------- Modelo ----------

/** Documento vazio (artboard w × h, fundo preto) com Base e Elementos. */
export function blankComposition(width = 1024, height = 768, background = "#000000") {
  return { v: 1, artboard: { width, height, background }, layers: normalizeLayers([]), elements: [] };
}

/** Camadas com Base e Elementos primeiro, extras válidas e únicas, no máximo oito. */
export function normalizeLayers(list) {
  const input = Array.isArray(list) ? list.filter((l) => l && typeof l === "object") : [];
  const layer = (l, id, kind, name) => {
    const opacity = Math.round(num(l?.opacity, 100));
    return {
      id, kind, name: String(l?.name ?? name).trim().slice(0, LIMITS.layerName) || name,
      visible: l?.visible !== false, locked: !!l?.locked, opacity: clamp(opacity, 0, 100),
    };
  };
  const required = REQUIRED.map(([id, name]) => layer(input.find((l) => l.id === id), id, id, name));
  const seen = new Set(["base", "elements"]);
  const extras = [];
  for (const l of input) {
    const id = String(l.id ?? "");
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    extras.push(layer(l, id, "custom", "Camada"));
  }
  return [...required, ...extras].slice(0, LIMITS.layers);
}

/** Identificador novo e único para elemento (`img-3`, `txt-1`…). */
export function newElementId(elements, type = "") {
  const prefix = { image: "img", text: "txt", rect: "ret", ellipse: "eli" }[type] || "el";
  const used = new Set((elements || []).map((e) => e.id));
  for (let i = 1; i < 10000; i++) if (!used.has(`${prefix}-${i}`)) return `${prefix}-${i}`;
  return `${prefix}-${Date.now().toString(36)}`.slice(0, 24);
}

/** Elemento com valores padrão; só os campos do tipo. `layerIds` (opcional) devolve à Elementos quem estiver em camada inexistente. */
export function normalizeElement(raw, layerIds = null) {
  const type = ELEMENT_TYPES.includes(raw?.type) ? raw.type : "rect";
  const layer = String(raw?.layer ?? "elements");
  const el = {
    id: String(raw?.id ?? ""),
    layer: layerIds && !layerIds.has(layer) ? "elements" : layer,
    type,
    name: String(raw?.name ?? "").slice(0, LIMITS.elementName),
    x: num(raw?.x), y: num(raw?.y),
    width: Math.max(LIMITS.sizeMin, num(raw?.width, 100)), height: Math.max(LIMITS.sizeMin, num(raw?.height, 100)),
    rotation: num(raw?.rotation), opacity: clamp(num(raw?.opacity, 100), 0, 100),
    visible: raw?.visible !== false, locked: !!raw?.locked, flipX: !!raw?.flipX, flipY: !!raw?.flipY,
  };
  // Grupo (ADR-086): opcional; documentos antigos não têm o campo e continuam iguais.
  if (typeof raw?.group === "string" && ID.test(raw.group)) el.group = raw.group;
  if (type === "image") el.src = String(raw?.src ?? "");
  if (type === "text") {
    el.text = String(raw?.text ?? "").slice(0, LIMITS.text);
    el.fontSize = clamp(num(raw?.fontSize, 48), LIMITS.fontMin, LIMITS.fontMax);
    el.fontFamily = FONTS.includes(raw?.fontFamily) ? raw.fontFamily : "serif";
    el.color = isHex(raw?.color) ? raw.color.toLowerCase() : "#ffffff";
    el.align = ALIGNS.includes(raw?.align) ? raw.align : "left";
    el.bold = !!raw?.bold; el.italic = !!raw?.italic;
  }
  if (type === "rect" || type === "ellipse") {
    el.fill = isHex(raw?.fill) ? raw.fill.toLowerCase() : null;
    el.stroke = isHex(raw?.stroke) ? raw.stroke.toLowerCase() : null;
    el.strokeWidth = clamp(num(raw?.strokeWidth, 0), 0, LIMITS.strokeMax);
  }
  return el;
}

/** Documento recebido do servidor (campos nulos omitidos) com padrões; ids fora do padrão local são renovados. */
export function normalizeComposition(raw, fallback = { width: 1024, height: 768 }) {
  const a = raw?.artboard || {};
  const width = Math.round(num(a.width, fallback.width)), height = Math.round(num(a.height, fallback.height));
  const layers = normalizeLayers(raw?.layers);
  const ids = new Set(layers.map((l) => l.id));
  const elements = [];
  for (const e of Array.isArray(raw?.elements) ? raw.elements.slice(0, LIMITS.elements) : []) {
    if (!e || typeof e !== "object") continue;
    const el = normalizeElement(e, ids);
    if (!ID.test(el.id) || elements.some((x) => x.id === el.id)) el.id = newElementId(elements, el.type);
    elements.push(el);
  }
  return { v: 1, artboard: { width, height, background: isHex(a.background) ? a.background.toLowerCase() : "#000000" }, layers, elements };
}

/** JSON exato do contrato: só os campos conhecidos de cada tipo (o servidor recusa campos desconhecidos). */
export function serializeComposition(doc) {
  const out = {
    v: 1,
    artboard: { width: Math.round(doc.artboard.width), height: Math.round(doc.artboard.height), background: doc.artboard.background || "#000000" },
    layers: doc.layers.map((l) => ({ id: l.id, name: l.name, kind: l.kind, visible: !!l.visible, locked: !!l.locked, opacity: Math.round(l.opacity) })),
    elements: doc.elements.map((e) => {
      const base = { id: e.id, layer: e.layer, type: e.type, name: e.name || null, x: round2(e.x), y: round2(e.y), width: round2(e.width), height: round2(e.height),
        rotation: round2(e.rotation), opacity: round2(e.opacity), visible: !!e.visible, locked: !!e.locked, flipX: !!e.flipX, flipY: !!e.flipY };
      if (e.group && ID.test(e.group)) base.group = e.group;
      if (e.type === "image") base.src = e.src;
      if (e.type === "text") Object.assign(base, { text: e.text, fontSize: round2(e.fontSize), fontFamily: e.fontFamily, color: e.color, align: e.align, bold: !!e.bold, italic: !!e.italic });
      if (e.type === "rect" || e.type === "ellipse") Object.assign(base, { fill: e.fill || null, stroke: e.stroke || null, strokeWidth: round2(e.strokeWidth || 0) });
      return base;
    }),
  };
  return JSON.stringify(out);
}

// ---------- Validação (mesmos limites do servidor) ----------

/** Erro de tamanho do artboard ou null. */
export function artboardError(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < LIMITS.artboardMin || height < LIMITS.artboardMin || width > LIMITS.artboardMax || height > LIMITS.artboardMax)
    return "A área visível vai de 64 a 4.096 pixels por lado.";
  if (width * height > LIMITS.artboardPixels) return "A área visível aceita até 8 milhões de pixels (ex.: 4.096 × 1.953).";
  return null;
}

/** Valida o documento antes de salvar. Devolve a mensagem em português ou null. */
export function validateComposition(doc) {
  if (!doc || doc.v !== 1) return "Documento em versão desconhecida.";
  const a = doc.artboard;
  if (!a) return "Informe a área visível.";
  const ab = artboardError(a.width, a.height);
  if (ab) return ab;
  if (!isHex(a.background)) return "A cor de fundo precisa estar no formato #rrggbb.";
  const layers = doc.layers;
  if (!Array.isArray(layers) || layers.length < 2 || layers.length > LIMITS.layers) return "Use de 2 a 8 camadas, começando por Base e Elementos.";
  const layerIds = new Set();
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const fixed = i === 0 ? "base" : i === 1 ? "elements" : null;
    const ok = fixed ? l.id === fixed && l.kind === fixed : l.kind === "custom" && ID.test(String(l.id)) && !["base", "elements"].includes(l.id);
    if (!ok) return "Camadas inválidas: Base e Elementos vêm primeiro; as extras usam identificador curto (a-z, 0-9 e hífen).";
    if (layerIds.has(l.id)) return "Há camadas com o mesmo identificador.";
    layerIds.add(l.id);
    const name = String(l.name ?? "").trim();
    if (!name || name.length > LIMITS.layerName) return "Dê um nome de até 40 caracteres a cada camada.";
    if (!Number.isInteger(l.opacity) || l.opacity < 0 || l.opacity > 100) return "A opacidade da camada vai de 0 a 100.";
  }
  const elements = doc.elements || [];
  if (elements.length > LIMITS.elements) return `Use até ${LIMITS.elements} elementos por mapa.`;
  const ids = new Set(), sources = new Set();
  const inRange = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  for (const e of elements) {
    const label = e.name ? `“${e.name}”` : "sem nome";
    if (!ID.test(String(e.id)) || ids.has(e.id)) return "Cada elemento precisa de um identificador único (a-z, 0-9 e hífen, até 24).";
    ids.add(e.id);
    if (!layerIds.has(e.layer)) return `O elemento ${label} está em uma camada inexistente.`;
    if (!ELEMENT_TYPES.includes(e.type)) return "Tipo de elemento desconhecido.";
    if (!inRange(e.x, LIMITS.coordMin, LIMITS.coordMax) || !inRange(e.y, LIMITS.coordMin, LIMITS.coordMax))
      return `O elemento ${label} está fora da área de trabalho (posição de −16.384 a 20.480).`;
    if (!inRange(e.width, LIMITS.sizeMin, LIMITS.sizeMax) || !inRange(e.height, LIMITS.sizeMin, LIMITS.sizeMax))
      return `Largura e altura do elemento ${label} vão de 1 a 16.384 pixels.`;
    if (!inRange(e.rotation, -LIMITS.rotation, LIMITS.rotation)) return "A rotação vai de −360 a 360 graus.";
    if (!inRange(e.opacity, 0, 100)) return "A opacidade vai de 0 a 100.";
    if (String(e.name ?? "").length > LIMITS.elementName) return "O nome do elemento aceita até 80 caracteres.";
    if (e.group != null && !ID.test(String(e.group))) return "Grupo inválido (a-z, 0-9 e hífen, até 24).";
    if (e.type === "image") {
      if (!isSource(e.src)) return `A imagem ${label} não tem origem válida.`;
      if (e.src !== "self") sources.add(e.src.toLowerCase());
    } else if (e.src != null) return "Só elementos de imagem têm origem.";
    if (e.type === "text") {
      if (String(e.text ?? "").length > LIMITS.text) return "O texto aceita até 500 caracteres.";
      if (!inRange(e.fontSize, LIMITS.fontMin, LIMITS.fontMax)) return "O tamanho da fonte vai de 6 a 400.";
      if (!FONTS.includes(e.fontFamily)) return "Fonte desconhecida.";
      if (!ALIGNS.includes(e.align)) return "Alinhamento desconhecido.";
      if (!isHex(e.color)) return "Use cor no formato #rrggbb.";
    }
    if (e.type === "rect" || e.type === "ellipse") {
      if ((e.fill != null && !isHex(e.fill)) || (e.stroke != null && !isHex(e.stroke))) return "Use cor no formato #rrggbb.";
      if (!inRange(e.strokeWidth ?? 0, 0, LIMITS.strokeMax)) return "O contorno vai de 0 a 100.";
    }
  }
  if (sources.size > LIMITS.sources) return `Use até ${LIMITS.sources} imagens-fonte por mapa.`;
  return null;
}

/** Contagem de casas igual à do servidor (CampaignMapView.Grid). */
export function gridCount(width, height, size, offsetX = 0, offsetY = 0) {
  const s = Math.trunc(num(size)), ox = Math.trunc(num(offsetX)), oy = Math.trunc(num(offsetY));
  const invalid = (message) => ({ valid: false, columns: 0, rows: 0, message });
  if (!(s >= 8 && s <= 1024)) return invalid("O quadrado vai de 8 a 1.024 pixels.");
  if (ox < 0 || oy < 0 || ox >= s || oy >= s) return invalid("O deslocamento vai de 0 até o tamanho do quadrado menos 1 pixel.");
  if (s > Math.min(width, height)) return invalid("O quadrado deve caber na área visível.");
  const columns = Math.floor((width - ox) / s), rows = Math.floor((height - oy) / s);
  if (columns < 1 || rows < 1 || columns > 100 || rows > 100 || columns * rows > 4096)
    return { valid: false, columns, rows, message: "A grade deve ter até 100 quadrados por lado e 4.096 casas. Aumente o tamanho do quadrado." };
  return { valid: true, columns, rows, message: "" };
}

// ---------- Ordem de pintura e geometria ----------

/** Elementos na ordem de pintura (de baixo para cima): camadas na ordem do documento, depois a ordem da lista. */
export function paintOrder(doc) {
  const out = [];
  for (const layer of doc.layers) for (const e of doc.elements) if (e.layer === layer.id) out.push(e);
  return out;
}

export const center = (el) => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
const rotate = (x, y, deg) => { const r = deg * RAD, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };

/** Ponto do documento no referencial do elemento (origem no centro, sem rotação). */
export function toLocal(el, px, py) {
  const c = center(el);
  return rotate(px - c.x, py - c.y, -(el.rotation || 0));
}
/** Ponto local (relativo ao centro) de volta ao documento. */
export function fromLocal(el, lx, ly) {
  const c = center(el), p = rotate(lx, ly, el.rotation || 0);
  return { x: c.x + p.x, y: c.y + p.y };
}

/** Quatro cantos do elemento girado (nw, ne, se, sw) no documento. */
export function corners(el) {
  const w = el.width / 2, h = el.height / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => fromLocal(el, x, y));
}

/** Retângulo alinhado aos eixos que contém o elemento girado. */
export function elementBounds(el) {
  const pts = corners(el);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** União dos limites de vários elementos (null se vazio). */
export function unionBounds(list) {
  if (!list?.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const el of list) {
    const b = elementBounds(el);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Verdadeiro se o ponto cai no elemento (respeita rotação; elipse usa a própria forma). `tolerance` em pixels do documento. */
export function pointInElement(el, px, py, tolerance = 0) {
  const p = toLocal(el, px, py);
  const w = el.width / 2 + tolerance, h = el.height / 2 + tolerance;
  if (el.type === "ellipse") return (p.x * p.x) / (w * w) + (p.y * p.y) / (h * h) <= 1;
  return Math.abs(p.x) <= w && Math.abs(p.y) <= h;
}

/** Elemento visível e não bloqueado (nem ele nem a camada). */
export function isSelectable(doc, el, { includeLocked = false, includeHidden = false } = {}) {
  const layer = doc.layers.find((l) => l.id === el.layer);
  if (!layer) return false;
  if (!includeHidden && (!layer.visible || !el.visible)) return false;
  if (!includeLocked && (layer.locked || el.locked)) return false;
  return true;
}

/** Elemento mais alto sob o ponto (ou null). Bloqueados e ocultos ficam de fora por padrão. */
export function hitTest(doc, px, py, { tolerance = 0, includeLocked = false } = {}) {
  const order = paintOrder(doc);
  for (let i = order.length - 1; i >= 0; i--) {
    const el = order[i];
    if (isSelectable(doc, el, { includeLocked }) && pointInElement(el, px, py, tolerance)) return el;
  }
  return null;
}

/** Interseção de polígonos convexos pelo teorema dos eixos separadores. */
export function polygonsIntersect(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      const nx = p2.y - p1.y, ny = p1.x - p2.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of a) { const d = p.x * nx + p.y * ny; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const p of b) { const d = p.x * nx + p.y * ny; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}
const rectPolygon = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];

/** Retângulo normalizado a partir de dois pontos. */
export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** O elemento girado toca o retângulo (seleção por laço retangular). */
export function rectIntersectsElement(rect, el) {
  return polygonsIntersect(rectPolygon(rect), corners(el));
}

/** Elementos selecionáveis tocados pelo retângulo, na ordem de pintura. */
export function elementsInRect(doc, rect, opts = {}) {
  return paintOrder(doc).filter((el) => isSelectable(doc, el, opts) && rectIntersectsElement(rect, el));
}

/** "inside" (totalmente na área visível), "partial" (parcialmente fora) ou "outside" (totalmente na área externa). */
export function artboardStatus(el, artboard) {
  const ab = { x: 0, y: 0, width: artboard.width, height: artboard.height };
  const pts = corners(el);
  const eps = 1e-6;
  if (pts.every((p) => p.x >= -eps && p.y >= -eps && p.x <= ab.width + eps && p.y <= ab.height + eps)) return "inside";
  // Encostar na borda não conta como visível.
  const inner = { x: eps, y: eps, width: ab.width - 2 * eps, height: ab.height - 2 * eps };
  return polygonsIntersect(rectPolygon(inner), pts) ? "partial" : "outside";
}

// ---------- Alças: redimensionar e girar ----------

/** Posições das oito alças e da alça de giro (`rotateDistance` acima do topo, em pixels do documento). */
export function handlePoints(el, rotateDistance = 24) {
  const out = {};
  for (const h of HANDLES) { const [sx, sy] = HANDLE_VECTOR[h]; out[h] = fromLocal(el, (sx * el.width) / 2, (sy * el.height) / 2); }
  out.rotate = fromLocal(el, 0, -el.height / 2 - rotateDistance);
  return out;
}

/** Ângulo (graus, eixo da tela) para o cursor de redimensionamento de uma alça num elemento girado. */
export function handleAngle(handle, rotation = 0) {
  const [sx, sy] = HANDLE_VECTOR[handle] || [0, 0];
  return ((Math.atan2(sy, sx) / RAD + rotation) % 360 + 360) % 360;
}

/**
 * Novo retângulo ao arrastar `handle` até `pointer` (documento), partindo de `start`.
 * `keepRatio` mantém a proporção; `fromCenter` redimensiona a partir do centro (Alt). A rotação é preservada:
 * o lado oposto (ou o centro) fica parado na tela. Tamanho mínimo 1.
 */
export function resizeFromHandle(start, handle, pointer, { keepRatio = false, fromCenter = false, minSize = LIMITS.sizeMin } = {}) {
  const [sx, sy] = HANDLE_VECTOR[handle] || [0, 0];
  const w = start.width, h = start.height;
  const p = toLocal(start, pointer.x, pointer.y);
  const ax = fromCenter ? 0 : (-sx * w) / 2, ay = fromCenter ? 0 : (-sy * h) / 2;
  let nw = sx ? (fromCenter ? 2 * sx * p.x : sx * (p.x - ax)) : w;
  let nh = sy ? (fromCenter ? 2 * sy * p.y : sy * (p.y - ay)) : h;
  nw = Math.max(minSize, nw); nh = Math.max(minSize, nh);
  if (keepRatio && w > 0 && h > 0) {
    if (sx && sy) { const k = Math.max(nw / w, nh / h); nw = w * k; nh = h * k; }
    else if (sx) nh = (nw * h) / w;
    else if (sy) nw = (nh * w) / h;
    if (nw < minSize || nh < minSize) { const k = Math.max(minSize / nw, minSize / nh); nw *= k; nh *= k; }
  }
  const cx = fromCenter || !sx ? 0 : ax + (sx * nw) / 2;
  const cy = fromCenter || !sy ? 0 : ay + (sy * nh) / 2;
  const c = fromLocal(start, cx, cy);
  return { x: c.x - nw / 2, y: c.y - nh / 2, width: nw, height: nh };
}

/** Ângulo (graus) do vetor centro → ponto, com 0 para cima (alça de giro). */
export function pointerAngle(c, p) { return Math.atan2(p.y - c.y, p.x - c.x) / RAD + 90; }

/** Rotação normalizada para [−180, 180). */
export function normalizeRotation(deg) {
  const v = ((((Number(deg) || 0) + 180) % 360) + 360) % 360 - 180;
  return Math.abs(v) < 1e-9 ? 0 : round2(v);
}
export function snapAngle(deg, step = 15) { return normalizeRotation(Math.round(deg / step) * step); }

/** Rotação ao arrastar a alça: `startRotation` + variação do ângulo do cursor; `snap` encaixa em 15°. */
export function rotateFromPointer(start, startPointer, pointer, snap = false) {
  const c = center(start);
  const next = (start.rotation || 0) + pointerAngle(c, pointer) - pointerAngle(c, startPointer);
  return snap ? snapAngle(next) : normalizeRotation(next);
}

// ---------- Encaixe ----------

function gridLine(v, size, offset) { return offset + Math.round((v - offset) / size) * size; }

/**
 * Alvos de encaixe por eixo: bordas e centro do artboard, com grade a linha mais próxima e, com `lines` (ver `snapLines`),
 * bordas e centros de outros elementos (guias magnéticas).
 */
function snapTargets(axis, value, { artboard, grid, lines }) {
  const len = axis === "x" ? artboard.width : artboard.height;
  const out = [0, len / 2, len];
  if (grid?.size >= 1) out.push(gridLine(value, grid.size, axis === "x" ? grid.offsetX || 0 : grid.offsetY || 0));
  const extra = lines?.[axis];
  if (extra?.length) for (const v of extra) out.push(v);
  return out;
}

/**
 * Linhas de encaixe dos elementos (bordas e centros dos limites), excluindo `excludeIds` (os que estão sendo movidos).
 * Calculadas uma vez no começo do arraste. Ocultos, de camada oculta e fora da lista ficam de fora; bloqueados contam.
 */
export function snapLines(doc, excludeIds = new Set()) {
  const xs = new Set(), ys = new Set();
  for (const el of doc.elements) {
    if (excludeIds.has(el.id) || !isSelectable(doc, el, { includeLocked: true })) continue;
    const b = elementBounds(el);
    for (const v of [b.x, b.x + b.width / 2, b.x + b.width]) xs.add(round2(v));
    for (const v of [b.y, b.y + b.height / 2, b.y + b.height]) ys.add(round2(v));
  }
  return { x: [...xs], y: [...ys] };
}

/** Encaixa um valor ao alvo mais próximo dentro do limite. → { value, guide|null }. */
export function snapValue(axis, value, opts) {
  let best = null;
  for (const t of snapTargets(axis, value, opts)) {
    const d = Math.abs(t - value);
    if (d <= (opts.threshold ?? 6) && (!best || d < best.d)) best = { d, t };
  }
  return best ? { value: best.t, guide: best.t } : { value, guide: null };
}

/** Encaixe de um ponto (desenho e alças). */
export function snapPoint(p, opts) {
  const x = snapValue("x", p.x, opts), y = snapValue("y", p.y, opts);
  return { x: x.value, y: y.value, guides: [...(x.guide != null ? [{ axis: "x", at: x.guide }] : []), ...(y.guide != null ? [{ axis: "y", at: y.guide }] : [])] };
}

/**
 * Encaixe ao mover: compara esquerda/centro/direita (e topo/meio/base) dos limites movidos com os alvos.
 * → { dx, dy, guides } com o ajuste extra a somar ao deslocamento.
 */
export function snapMove(bounds, opts) {
  const axis = (name, start, size) => {
    let best = null;
    for (const v of [start, start + size / 2, start + size]) {
      for (const t of snapTargets(name, v, opts)) {
        const d = t - v;
        if (Math.abs(d) <= (opts.threshold ?? 6) && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
      }
    }
    return best;
  };
  const bx = axis("x", bounds.x, bounds.width), by = axis("y", bounds.y, bounds.height);
  return {
    dx: bx ? bx.d : 0, dy: by ? by.d : 0,
    guides: [...(bx ? [{ axis: "x", at: bx.t }] : []), ...(by ? [{ axis: "y", at: by.t }] : [])],
  };
}

// ---------- Documento: tamanho, escala e recorte ----------

/** Fração da âncora em cada eixo (0, ½ ou 1). */
export function anchorFactor(anchor) {
  const a = ANCHORS.includes(anchor) ? anchor : "c";
  const fx = a.endsWith("l") ? 0 : a.endsWith("r") ? 1 : 0.5;
  const fy = a.startsWith("t") ? 0 : a.startsWith("b") ? 1 : 0.5;
  return { fx, fy };
}

/** Deslocamento dos elementos ao mudar o artboard de (ow × oh) para (nw × nh) com a âncora escolhida. */
export function anchorOffset(ow, oh, nw, nh, anchor) {
  const { fx, fy } = anchorFactor(anchor);
  return { dx: Math.round((nw - ow) * fx) || 0, dy: Math.round((nh - oh) * fy) || 0 };
}

/** Deslocamento da grade que acompanha o conteúdo ao mover a origem do artboard. */
export function shiftGridOffset(offset, delta, size) {
  if (!(size >= 1)) return 0;
  return (((Math.round(offset + delta)) % size) + size) % size;
}

/** (1) Tamanho da área visível: muda só o artboard; os elementos mantêm a posição relativa à âncora. */
export function resizeArtboard(doc, width, height, anchor = "c") {
  const { dx, dy } = anchorOffset(doc.artboard.width, doc.artboard.height, width, height, anchor);
  const next = clone(doc);
  next.artboard.width = width; next.artboard.height = height;
  for (const e of next.elements) { e.x += dx; e.y += dy; }
  return { doc: next, dx, dy };
}

/** (2) Redimensionar conteúdo: escala artboard e elementos (posição, tamanho, fonte e contorno). */
export function scaleComposition(doc, width, height) {
  const sx = width / doc.artboard.width, sy = height / doc.artboard.height, k = Math.sqrt(sx * sy);
  const next = clone(doc);
  next.artboard.width = width; next.artboard.height = height;
  for (const e of next.elements) {
    e.x = round2(e.x * sx); e.y = round2(e.y * sy);
    e.width = Math.max(1, round2(e.width * sx)); e.height = Math.max(1, round2(e.height * sy));
    if (e.type === "text") e.fontSize = clamp(round2(e.fontSize * k), LIMITS.fontMin, LIMITS.fontMax);
    if (e.strokeWidth) e.strokeWidth = clamp(round2(e.strokeWidth * k), 0, LIMITS.strokeMax);
  }
  return { doc: next, sx, sy };
}

/** (3) Recortar: o retângulo (documento) vira o novo artboard; nada é apagado (o resto vai à área externa). */
export function cropComposition(doc, rect) {
  const x = Math.round(rect.x), y = Math.round(rect.y);
  const width = Math.round(rect.width), height = Math.round(rect.height);
  const next = clone(doc);
  next.artboard.width = width; next.artboard.height = height;
  for (const e of next.elements) { e.x -= x; e.y -= y; }
  return { doc: next, dx: -x, dy: -y };
}

/** Retângulo de recorte ajustado aos limites do artboard (64–4.096, ≤ 8 Mpx), sem mudar a origem. */
export function clampCropRect(rect) {
  let w = clamp(Math.round(rect.width), LIMITS.artboardMin, LIMITS.artboardMax);
  let h = clamp(Math.round(rect.height), LIMITS.artboardMin, LIMITS.artboardMax);
  if (w * h > LIMITS.artboardPixels) h = Math.max(LIMITS.artboardMin, Math.floor(LIMITS.artboardPixels / w));
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: w, height: h };
}

// ---------- Ordem (z) ----------

/**
 * Reordena os selecionados dentro da própria camada: "front" (topo), "forward" (uma posição), "backward", "back".
 * Devolve a nova lista de elementos (agrupada por camada, na ordem das camadas).
 */
export function reorder(doc, ids, op) {
  const sel = new Set(ids);
  const out = [];
  const known = new Set(doc.layers.map((l) => l.id));
  for (const layer of doc.layers) {
    let list = doc.elements.filter((e) => e.layer === layer.id);
    if (op === "front") list = [...list.filter((e) => !sel.has(e.id)), ...list.filter((e) => sel.has(e.id))];
    else if (op === "back") list = [...list.filter((e) => sel.has(e.id)), ...list.filter((e) => !sel.has(e.id))];
    else if (op === "forward") {
      for (let i = list.length - 2; i >= 0; i--) if (sel.has(list[i].id) && !sel.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else if (op === "backward") {
      for (let i = 1; i < list.length; i++) if (sel.has(list[i].id) && !sel.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
    out.push(...list);
  }
  out.push(...doc.elements.filter((e) => !known.has(e.layer)));
  return out;
}

// ---------- Alinhar e distribuir ----------

/**
 * Deslocamentos para alinhar (`left|center|right|top|middle|bottom`) os limites de cada elemento à referência
 * (a seleção quando há 2 ou mais; senão o artboard). → Map id → { dx, dy }.
 */
export function alignOffsets(elements, mode, reference) {
  const out = new Map();
  for (const el of elements) {
    const b = elementBounds(el);
    let dx = 0, dy = 0;
    if (mode === "left") dx = reference.x - b.x;
    if (mode === "center") dx = reference.x + reference.width / 2 - (b.x + b.width / 2);
    if (mode === "right") dx = reference.x + reference.width - (b.x + b.width);
    if (mode === "top") dy = reference.y - b.y;
    if (mode === "middle") dy = reference.y + reference.height / 2 - (b.y + b.height / 2);
    if (mode === "bottom") dy = reference.y + reference.height - (b.y + b.height);
    out.set(el.id, { dx: round2(dx), dy: round2(dy) });
  }
  return out;
}

/** Distribui (≥ 3) com espaços iguais entre os limites, mantendo o primeiro e o último. → Map id → { dx, dy }. */
export function distributeOffsets(elements, axis = "x") {
  const out = new Map();
  if (elements.length < 3) return out;
  const pos = axis === "x" ? "x" : "y", size = axis === "x" ? "width" : "height";
  const items = elements.map((el) => ({ el, b: elementBounds(el) })).sort((a, b) => a.b[pos] + a.b[size] / 2 - (b.b[pos] + b.b[size] / 2));
  const first = items[0].b, last = items.at(-1).b;
  const total = last[pos] + last[size] - first[pos] - items.reduce((s, it) => s + it.b[size], 0);
  const gap = total / (items.length - 1);
  let cursor = first[pos];
  for (const it of items) {
    const d = round2(cursor - it.b[pos]);
    out.set(it.el.id, axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cursor += it.b[size] + gap;
  }
  return out;
}

/** Ajusta ao artboard mantendo a proporção: "fit" cabe inteiro, "fill" cobre tudo. Centraliza e zera a rotação. */
export function fitToArtboard(el, artboard, mode = "fit") {
  const kx = artboard.width / el.width, ky = artboard.height / el.height;
  const k = mode === "fill" ? Math.max(kx, ky) : Math.min(kx, ky);
  const width = round2(el.width * k), height = round2(el.height * k);
  return { x: round2((artboard.width - width) / 2), y: round2((artboard.height - height) / 2), width, height, rotation: 0 };
}

/** Cópias com ids novos, deslocadas (colar/duplicar), sem passar do limite de elementos. */
export function cloneElements(list, existing, dx = 16, dy = 16) {
  const all = [...existing];
  const out = [];
  for (const el of list) {
    if (all.length >= LIMITS.elements) break;
    const copy = { ...clone(el), id: newElementId(all, el.type), x: round2(el.x + dx), y: round2(el.y + dy) };
    all.push(copy); out.push(copy);
  }
  return out;
}

/** Limita posição/tamanho aos intervalos aceitos (após arrastes e campos numéricos). */
export function clampGeometry(el) {
  el.width = clamp(num(el.width, 1), LIMITS.sizeMin, LIMITS.sizeMax);
  el.height = clamp(num(el.height, 1), LIMITS.sizeMin, LIMITS.sizeMax);
  el.x = clamp(num(el.x), LIMITS.coordMin, LIMITS.coordMax);
  el.y = clamp(num(el.y), LIMITS.coordMin, LIMITS.coordMax);
  el.rotation = normalizeRotation(el.rotation);
  el.opacity = clamp(num(el.opacity, 100), 0, 100);
  return el;
}

// ---------- Grupos e transformação em conjunto (ADR-086) ----------

/** Identificador novo de grupo (`grupo-1`…), único entre os elementos. */
export function newGroupId(elements) {
  const used = new Set((elements || []).map((e) => e.group).filter(Boolean));
  for (let i = 1; i < 10000; i++) if (!used.has(`grupo-${i}`)) return `grupo-${i}`;
  return `grupo-${Date.now().toString(36)}`.slice(0, 24);
}

/** Cópias (colar/duplicar) ganham grupos novos: nunca entram no grupo dos originais. Altera e devolve `copies`. */
export function regroupCopies(copies, existing) {
  const all = [...existing];
  const map = new Map();
  for (const el of copies) {
    if (!el.group) continue;
    if (!map.has(el.group)) { const id = newGroupId(all); map.set(el.group, id); all.push({ group: id }); }
    el.group = map.get(el.group);
  }
  return copies;
}

/** Seleção expandida aos grupos: clicar num membro seleciona o grupo inteiro (só membros selecionáveis). */
export function expandGroups(doc, ids) {
  const sel = new Set(ids);
  const groups = new Set(doc.elements.filter((e) => sel.has(e.id) && e.group).map((e) => e.group));
  if (!groups.size) return [...sel];
  for (const e of doc.elements) if (e.group && groups.has(e.group) && isSelectable(doc, e)) sel.add(e.id);
  return [...sel];
}

/** Agrupar exige dois ou mais elementos na mesma camada. → { group, ids } ou { error }. */
export function planGroup(doc, ids) {
  const els = doc.elements.filter((e) => ids.includes(e.id));
  if (els.length < 2) return { error: "Selecione dois ou mais elementos para agrupar." };
  if (new Set(els.map((e) => e.layer)).size > 1) return { error: "Agrupe elementos da mesma camada. Mova-os para uma camada antes." };
  return { group: newGroupId(doc.elements), ids: els.map((e) => e.id) };
}

/**
 * Redimensionar um conjunto pelos limites: cada elemento acompanha a escala do retângulo `from` → `to`
 * (posição do centro e tamanho). Girado em múltiplo de 90° troca os eixos; outros ângulos usam escala uniforme
 * (média geométrica) para não deformar. → Map id → { x, y, width, height }.
 */
export function scaleGroup(items, from, to) {
  const out = new Map();
  if (!(from?.width > 0 && from?.height > 0)) return out;
  const sx = to.width / from.width, sy = to.height / from.height, k = Math.sqrt(Math.abs(sx * sy));
  for (const el of items) {
    const c = center(el);
    const nx = to.x + (c.x - from.x) * sx, ny = to.y + (c.y - from.y) * sy;
    const r = ((Math.round(el.rotation || 0) % 180) + 180) % 180;
    const aligned = Math.abs((el.rotation || 0) - Math.round(el.rotation || 0)) < 1e-9 && r % 90 === 0;
    const [fx, fy] = aligned ? (r === 90 ? [sy, sx] : [sx, sy]) : [k, k];
    const width = Math.max(LIMITS.sizeMin, round2(el.width * fx)), height = Math.max(LIMITS.sizeMin, round2(el.height * fy));
    out.set(el.id, { x: round2(nx - width / 2), y: round2(ny - height / 2), width, height });
  }
  return out;
}

/** Girar um conjunto `deg` graus em torno de `pivot`: os centros giram e cada rotação soma o ângulo. → Map id → { x, y, rotation }. */
export function rotateGroup(items, pivot, deg) {
  const out = new Map();
  for (const el of items) {
    const c = center(el), p = rotate(c.x - pivot.x, c.y - pivot.y, deg);
    out.set(el.id, { x: round2(pivot.x + p.x - el.width / 2), y: round2(pivot.y + p.y - el.height / 2), rotation: normalizeRotation((el.rotation || 0) + deg) });
  }
  return out;
}

/** Alças do retângulo de limites de um conjunto (sem rotação), no mesmo formato de `handlePoints`. */
export function boundsHandlePoints(bounds, rotateDistance = 24) {
  return handlePoints({ ...bounds, rotation: 0 }, rotateDistance);
}
