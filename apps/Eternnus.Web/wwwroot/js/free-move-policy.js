/**
 * Movimentação livre (ADR-074): marcadores em qualquer ponto da imagem. A casa (x, y) continua sendo a unidade de paredes,
 * névoa, luz e visão; fx/fy dizem onde, dentro da casa, o marcador está (milésimos, nulo = centro).
 * Mesma conta de Domain/FinePositions.cs. Regras puras: sem DOM.
 */
export const FINE_SCALE = 1000, FINE_CENTER = 500;

/** O mapa recebido usa movimentação livre? */
export const isFreeMap = (map) => !!map?.freeMovement && map?.kind === "tileset";

/** Centro do marcador em casas (0,5 = meio da primeira casa). Fora do modo livre, sempre o centro da casa. */
export function tokenCenter(token, free) {
  const fine = (v) => (free && Number.isInteger(v) && v >= 0 && v < FINE_SCALE ? v : FINE_CENTER) / FINE_SCALE;
  return { x: token.x + fine(token.fx), y: token.y + fine(token.fy) };
}

/**
 * Ponto do tabuleiro (em casas, fracionário) → casa + posição fina. Nulo fora da grade.
 * Ex.: 3,25 × 1,9 → { x: 3, y: 1, fx: 250, fy: 900 }.
 */
export function finePoint(cx, cy, width, height) {
  if (!(cx >= 0) || !(cy >= 0) || cx >= width || cy >= height) return null;
  const x = Math.floor(cx), y = Math.floor(cy);
  const part = (v, base) => Math.min(FINE_SCALE - 1, Math.max(0, Math.round((v - base) * FINE_SCALE)));
  return { x, y, fx: part(cx, x), fy: part(cy, y) };
}

/** Distância em linha reta, em casas, entre dois marcadores ou pontos finos. */
export function fineDistance(a, b) {
  const p = tokenCenter(a, true), q = tokenCenter(b, true);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Dentro do alcance (casas), com a mesma tolerância do servidor. */
export const withinReach = (from, to, squares) => fineDistance(from, to) <= squares + 1e-9;

/**
 * Marcador sob o ponto (em casas): o mais próximo cujo círculo (raio 0,4 casa, como no desenho) contém o ponto.
 * Em empate, vale o desenhado por último (fica por cima).
 */
export function tokenAtPoint(tokens, cx, cy, free, radius = 0.4) {
  let best = null, bestDistance = Infinity;
  (tokens || []).forEach((t) => {
    const c = tokenCenter(t, free);
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d <= radius && d <= bestDistance) { best = t; bestDistance = d; }
  });
  return best;
}

/**
 * Casas que contêm algum ponto alcançável em linha reta (círculo de raio `squares` em volta do marcador).
 * `cells` vem do alcance por casas (paredes, névoa, caminho) já calculado com um passo a mais.
 */
export function freeReachCells(cells, token, squares) {
  const c = tokenCenter(token, true);
  return (cells || []).filter((cell) => {
    const nx = Math.max(cell.x, Math.min(c.x, cell.x + 1)), ny = Math.max(cell.y, Math.min(c.y, cell.y + 1));
    return Math.hypot(nx - c.x, ny - c.y) <= squares + 1e-9;
  });
}

/** Corpo de escrita (mover, adicionar): fx/fy só no modo livre; com grade, o servidor usa o centro da casa. */
export function placement(point, free) {
  const body = { x: point.x, y: point.y };
  if (free && Number.isInteger(point.fx) && Number.isInteger(point.fy)) { body.fx = point.fx; body.fy = point.fy; }
  return body;
}
