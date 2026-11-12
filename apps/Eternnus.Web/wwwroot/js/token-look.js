/**
 * Aparência dos marcadores (ADR-079): redondo ou imagem livre (PNG com transparência) e tamanho em porcentagem da casa.
 * Mesmo intervalo de Domain/Sessions.cs (TokenLooks). Só o mestre altera; o servidor confere. Regras puras: sem DOM.
 */
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

/** Meia largura da área do marcador, em casas: o redondo tem raio 0,4 × escala; a imagem livre ocupa o quadrado da escala. */
export const tokenHalf = (token) => (isImageLook(token) ? 0.5 : 0.4) * tokenScale(token);

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
    const inside = isImageLook(t) ? dx <= half && dy <= half
      : free ? Math.hypot(dx, dy) <= half
      : dx <= Math.max(0.5, half) && dy <= Math.max(0.5, half);
    if (inside && half <= bestHalf) { best = t; bestHalf = half; }
  });
  return best;
}

/** Ordem de desenho: maiores primeiro, para que os menores fiquem por cima. Estável para o mesmo tamanho. */
export const drawOrder = (tokens) => (tokens || []).map((t, i) => [t, i]).sort((a, b) => tokenHalf(b[0]) - tokenHalf(a[0]) || a[1] - b[1]).map(([t]) => t);
