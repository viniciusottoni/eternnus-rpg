/**
 * Aparência dos marcadores (ADR-079): redondo ou imagem livre (PNG com transparência) e tamanho em porcentagem da casa.
 * ADR-092: a imagem livre pode ter largura e altura próprias (`width`/`height`, % da casa) e é esticada para preencher a área;
 * no mapa tático ocupa round(largura/100) × round(altura/100) casas a partir de (x, y), canto superior esquerdo.
 * Mesmo intervalo e conta de Domain/Sessions.cs (TokenLooks, TokenSpan). Só o mestre altera; o servidor confere. Regras puras: sem DOM.
 */
import { tokenCenter, FINE_SCALE } from "./free-move-policy.js";

export const LOOK_ROUND = "round", LOOK_IMAGE = "image";
export const MIN_SIZE = 50, MAX_SIZE = 800, DEFAULT_SIZE = 100, SIZE_STEP = 5;

/** Tamanho válido (inteiro entre os limites); valor ausente ou inválido = uma casa. */
export function clampSize(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value !== null && value !== "" ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)) : DEFAULT_SIZE;
}

/** Escala do marcador em casas (1 = uma casa). */
export const tokenScale = (token) => clampSize(token?.size ?? DEFAULT_SIZE) / 100;

/** Imagem livre só quando há imagem para desenhar; sem ela, o marcador continua redondo. */
export const isImageLook = (token) => token?.appearance === LOOK_IMAGE && !!token?.image;

/** Imagem livre com largura e altura próprias (área retangular, ADR-092)? Vale pela forma escolhida, mesmo antes de a imagem carregar. */
export const hasSpan = (token) => token?.appearance === LOOK_IMAGE && Number(token?.width) > 0 && Number(token?.height) > 0;

/** Porcentagem da casa → casas inteiras (mínimo uma), como TokenSpan.ToCells. Ex.: 150 → 2. */
export const spanCells = (percent) => Math.max(1, Math.round(Number(percent) / 100));

/** Casas ocupadas no mapa tático: { w, h } a partir de (x, y). Fora da área retangular, uma casa. */
export const tokenSpan = (token) => (hasSpan(token) ? { w: spanCells(token.width), h: spanCells(token.height) } : { w: 1, h: 1 });

/** Chaves "x:y" de todas as casas ocupadas pelos marcadores (menos `except`), no mapa tático. */
export function takenKeys(tokens, except = null) {
  const set = new Set();
  for (const t of tokens || []) {
    if (except && t === except) continue;
    const { w, h } = tokenSpan(t);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set.add(`${t.x + dx}:${t.y + dy}`);
  }
  return set;
}

/** A área do marcador em (x, y) cobre a casa (cx, cy)? */
export function covers(token, cx, cy, x = token.x, y = token.y) {
  const { w, h } = tokenSpan(token);
  return cx >= x && cy >= y && cx < x + w && cy < y + h;
}

/**
 * Retângulo desenhado do marcador, em casas. Área retangular: no tático, as casas ocupadas; no modo livre, centrado no ponto.
 * Demais: o quadrado da escala centrado no marcador (redondo e imagem encaixada).
 */
export function tokenBox(token, free) {
  if (hasSpan(token) && !free) { const { w, h } = tokenSpan(token); return { x: token.x, y: token.y, w, h }; }
  const c = tokenCenter(token, free);
  if (hasSpan(token)) { const w = token.width / 100, h = token.height / 100; return { x: c.x - w / 2, y: c.y - h / 2, w, h }; }
  const half = tokenHalf(token);
  return { x: c.x - half, y: c.y - half, w: half * 2, h: half * 2 };
}

/** Meia largura da área do marcador, em casas: o redondo tem raio 0,4 × escala; a imagem livre ocupa o quadrado da escala (ou o maior lado da área). */
export const tokenHalf = (token) => (hasSpan(token) ? Math.max(token.width, token.height) / 200 : (isImageLook(token) ? 0.5 : 0.4) * tokenScale(token));

/** Alças de redimensionar a área: cantos e meios dos lados (dx, dy = −1 esquerda/cima, 1 direita/baixo, 0 meio). */
export const SPAN_HANDLES = [
  { id: "nw", dx: -1, dy: -1 }, { id: "n", dx: 0, dy: -1 }, { id: "ne", dx: 1, dy: -1 }, { id: "e", dx: 1, dy: 0 },
  { id: "se", dx: 1, dy: 1 }, { id: "s", dx: 0, dy: 1 }, { id: "sw", dx: -1, dy: 1 }, { id: "w", dx: -1, dy: 0 },
];

/**
 * Nova área ao arrastar uma alça: o lado puxado segue o ponteiro e o oposto fica parado, em qualquer direção.
 * Tático: bordas presas às linhas da grade (1 a 8 casas). Livre: de 0,5 a 8 casas, em passos de 5% da casa.
 * Sempre dentro do mapa (`width` × `height` casas). Ex.: alça "w" de {x:2,y:2,w:1,h:1} até x = 0,4 → {x:0,y:2,w:3,h:1}.
 */
export function boxFromHandle(box, handle, point, free, width, height) {
  const min = free ? MIN_SIZE / 100 : 1, max = MAX_SIZE / 100;
  const snap = (v) => (free ? Math.round(v * 20) / 20 : Math.round(v));
  // Bordas paradas também presas à grade: um marcador antigo de 200% (centrado na casa) vira uma área alinhada às casas.
  let left = snap(box.x), top = snap(box.y), right = Math.max(left + min, snap(box.x + box.w)), bottom = Math.max(top + min, snap(box.y + box.h));
  if (handle.dx < 0) left = Math.max(right - max, Math.min(right - min, Math.max(0, snap(point.x))));
  if (handle.dx > 0) right = Math.min(left + max, Math.max(left + min, Math.min(width, snap(point.x))));
  if (handle.dy < 0) top = Math.max(bottom - max, Math.min(bottom - min, Math.max(0, snap(point.y))));
  if (handle.dy > 0) bottom = Math.min(top + max, Math.max(top + min, Math.min(height, snap(point.y))));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Campos do marcador para uma área: posição (canto no tático; ponto central fino no livre) e largura/altura em %.
 * Ex. livre: {x:1,y:1,w:2,h:1} → centro 2 × 1,5 → { x: 2, y: 1, fx: 0, fy: 500, width: 200, height: 100 }.
 */
export function spanFromBox(box, free) {
  const pct = (v) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round((v * 100) / SIZE_STEP) * SIZE_STEP));
  if (!free) return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.w) * 100, height: Math.round(box.h) * 100 };
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const x = Math.floor(cx), y = Math.floor(cy);
  const part = (v, base) => Math.min(FINE_SCALE - 1, Math.max(0, Math.round((v - base) * FINE_SCALE)));
  return { x, y, fx: part(cx, x), fy: part(cy, y), width: pct(box.w), height: pct(box.h) };
}

/** Texto curto da área: "2 × 3 casas" no tático; "150% × 200%" no modo livre. */
export const spanLabel = (token, free) => (free ? `${token.width}% × ${token.height}%` : `${spanCells(token.width)} × ${spanCells(token.height)} casas`);

/**
 * Retângulo da imagem livre centrado em (cx, cy) que cabe inteiro num quadrado de lado `side`, mantendo a proporção.
 * Ex.: 200 × 100 px num quadrado de 80 → 80 × 40.
 */
export function imageBox(cx, cy, side, width, height) {
  if (!(width > 0) || !(height > 0)) return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
  const scale = Math.min(side / width, side / height);
  const w = width * scale, h = height * scale;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Tamanho a partir da alça de redimensionar: a distância do centro ao ponteiro (em casas, maior eixo) vira a meia largura.
 * Arredonda em passos de 5% e respeita os limites.
 */
export function sizeFromHandle(center, point, token) {
  const half = Math.max(Math.abs(point.x - center.x), Math.abs(point.y - center.y));
  const base = isImageLook(token) ? 0.5 : 0.4;
  return clampSize(Math.round((half / base) * 100 / SIZE_STEP) * SIZE_STEP);
}

/**
 * Marcador sob o ponto (em casas). `centerOf(token)` devolve o centro em casas.
 * Imagem livre: quadrado. Redondo: círculo no modo livre; com grade, ao menos a casa inteira (como antes).
 * Entre vários, vale o menor (um lobo sobre um dragão continua clicável) e, no empate, o desenhado por último.
 */
export function tokenUnder(tokens, cx, cy, centerOf, free) {
  let best = null, bestHalf = Infinity;
  (tokens || []).forEach((t) => {
    const c = centerOf(t), half = tokenHalf(t);
    const dx = Math.abs(cx - c.x), dy = Math.abs(cy - c.y);
    const box = hasSpan(t) ? tokenBox(t, free) : null;
    const inside = box ? cx >= box.x && cy >= box.y && cx <= box.x + box.w && cy <= box.y + box.h
      : isImageLook(t) ? dx <= half && dy <= half
      : free ? Math.hypot(dx, dy) <= half
      : dx <= Math.max(0.5, half) && dy <= Math.max(0.5, half);
    if (inside && half <= bestHalf) { best = t; bestHalf = half; }
  });
  return best;
}

/** Ordem de desenho: maiores primeiro, para que os menores fiquem por cima. Estável para o mesmo tamanho. */
export const drawOrder = (tokens) => (tokens || []).map((t, i) => [t, i]).sort((a, b) => tokenHalf(b[0]) - tokenHalf(a[0]) || a[1] - b[1]).map(([t]) => t);
