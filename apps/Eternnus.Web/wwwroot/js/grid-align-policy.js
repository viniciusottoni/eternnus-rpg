// Regras puras do assistente de alinhamento da grade (§9). Coordenadas em pixels da imagem original.
// O resultado usa os campos existentes (gridPixels, gridOffsetX, gridOffsetY); a validação final continua sendo
// `gridFor` (scene-policy.js) no cliente e `CampaignMapView.Grid` no servidor. Só grade quadrada: hexagonal e
// isométrica exigem regras de distância/vizinhança/visão no servidor e não são oferecidas (ver PREPARACAO_EDITOR.md).

/** Limites do lado do quadrado (os mesmos de `gridFor`). */
export const MIN_SIDE = 8, MAX_SIDE = 1024, MAX_SPAN = 100;

const mod = (v, s) => ((Math.round(v) % s) + s) % s;
const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

function result(side, ox, oy, extra = {}) {
  if (!(side >= MIN_SIDE && side <= MAX_SIDE)) return { error: `O quadrado medido tem ${side} px; use de ${MIN_SIDE} a ${MAX_SIDE.toLocaleString("pt-BR")} pixels. Aproxime a prévia e marque de novo.` };
  return { gridPixels: side, gridOffsetX: mod(ox, side), gridOffsetY: mod(oy, side), warnings: [], drift: 0, ...extra };
}

/**
 * Dois cantos opostos de UMA casa do desenho → lado (média de largura e altura) e deslocamento.
 * Avisa quando a casa marcada não é quadrada (diferença acima de 10% ou 2 px).
 */
export function fromCell(a, b) {
  if (!finite(a) || !finite(b)) return { error: "Marque dois cantos opostos de uma casa." };
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (w < 4 || h < 4) return { error: "Os dois pontos estão muito próximos. Marque cantos opostos de uma mesma casa." };
  const side = Math.round((w + h) / 2);
  const out = result(side, Math.min(a.x, b.x), Math.min(a.y, b.y));
  if (!out.error && Math.abs(w - h) > Math.max(2, side * .1)) out.warnings.push(`A casa marcada mede ${Math.round(w)} × ${Math.round(h)} px; a grade usa quadrados de ${side} px. Confira o alinhamento.`);
  return out;
}

/**
 * Dois cruzamentos de linhas da grade separados por `count` casas na horizontal ou na vertical → lado e deslocamento.
 * `drift`: erro acumulado (px) ao longo do trecho causado pelo arredondamento do lado para pixels inteiros.
 */
export function fromSpan(a, b, count) {
  if (!finite(a) || !finite(b)) return { error: "Marque dois cruzamentos de linhas da grade." };
  const n = Math.trunc(Number(count));
  if (!(n >= 1 && n <= MAX_SPAN)) return { error: `Informe de 1 a ${MAX_SPAN} casas entre os pontos.` };
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), along = Math.max(dx, dy), across = Math.min(dx, dy);
  if (along < 8) return { error: "Os dois pontos estão muito próximos. Marque pontos mais distantes." };
  const raw = along / n, side = Math.round(raw);
  const out = result(side, a.x, a.y, { drift: Math.round(Math.abs(raw - side) * n * 10) / 10 });
  if (out.error) return out;
  if (across > Math.max(4, along * .1)) out.warnings.push("Os pontos não estão na mesma linha ou coluna da grade; use pontos alinhados na horizontal ou na vertical.");
  if (out.drift >= side / 4) out.warnings.push(`As casas medem ${raw.toFixed(1).replace(".", ",")} px: com quadrados inteiros, a grade desvia ${String(out.drift).replace(".", ",")} px ao longo de ${n} casas.`);
  return out;
}

/**
 * Perfis de borda de uma imagem RGBA: soma das diferenças de brilho entre colunas vizinhas (por coluna) e entre linhas
 * vizinhas (por linha). Linhas de grade aparecem como picos periódicos. `step` amostra uma a cada N linhas/colunas.
 */
export function edgeProfiles(data, width, height, step = 1) {
  const gray = (i) => data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
  const columns = new Float64Array(Math.max(0, width)), rows = new Float64Array(Math.max(0, height));
  for (let y = 0; y < height; y += step) for (let x = 0; x + 1 < width; x++) {
    const i = (y * width + x) * 4;
    columns[x + 1] += Math.abs(gray(i + 4) - gray(i));
  }
  for (let x = 0; x < width; x += step) for (let y = 0; y + 1 < height; y++) {
    const i = (y * width + x) * 4;
    rows[y + 1] += Math.abs(gray(i + width * 4) - gray(i));
  }
  return { columns, rows };
}

/**
 * Período e fase de picos regulares num perfil (autocorrelação). Prefere o menor período cujo pico chega a 85% do maior,
 * para não escolher múltiplos do lado. → { period, phase, confidence 0–1 } ou null.
 */
export function detectPeriod(profile, min = MIN_SIDE, max = MAX_SIDE) {
  const n = profile?.length || 0;
  const hi = Math.min(max, Math.floor(n / 2));
  if (hi < min) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += profile[i];
  mean /= n;
  const f = Float64Array.from(profile, (v) => v - mean);
  let zero = 0;
  for (let i = 0; i < n; i++) zero += f[i] * f[i];
  if (zero <= 0) return null;
  zero /= n;
  const ac = new Float64Array(hi + 2);
  for (let p = Math.max(1, min - 1); p <= Math.min(hi + 1, n - 1); p++) {
    let s = 0;
    for (let i = 0; i + p < n; i++) s += f[i] * f[i + p];
    ac[p] = s / (n - p) / zero;
  }
  let best = 0;
  for (let p = min; p <= hi; p++) if (ac[p] > best) best = ac[p];
  if (best <= 0) return null;
  let period = 0;
  for (let p = min; p <= hi; p++) if (ac[p] >= best * .85 && ac[p] >= ac[p - 1] && ac[p] >= ac[p + 1]) { period = p; break; }
  if (!period) return null;
  let phase = 0, top = -Infinity;
  for (let φ = 0; φ < period; φ++) {
    let s = 0;
    // Uma linha que começa na coluna L gera a primeira borda em L (diferença L−1→L); no empate vale a primeira.
    for (let i = φ; i < n; i += period) s += profile[i];
    if (s > top) { top = s; phase = φ; }
  }
  return { period, phase, confidence: Math.max(0, Math.min(1, ac[period])) };
}

/**
 * Detecção automática a partir dos pixels (RGBA) da imagem. `scale` = tamanho analisado ÷ tamanho original (para
 * converter o resultado de volta). → resultado de alinhamento com `confidence`, ou { error }.
 */
export function detectGrid(data, width, height, { scale = 1, minConfidence = .15 } = {}) {
  const step = Math.max(1, Math.round(Math.max(width, height) / 1024));
  const { columns, rows } = edgeProfiles(data, width, height, step);
  return detectFromProfiles(columns, rows, { scale, minConfidence });
}

/**
 * Mesma detecção a partir de perfis já calculados (o navegador mede colunas numa faixa horizontal e linhas numa faixa
 * vertical da imagem em tamanho real, sem carregar a imagem inteira na memória).
 */
export function detectFromProfiles(columns, rows, { scale = 1, minConfidence = .15 } = {}) {
  const min = Math.max(4, Math.floor(MIN_SIDE * scale));
  const cx = detectPeriod(columns, min, Math.floor(MAX_SIDE * scale)), cy = detectPeriod(rows, min, Math.floor(MAX_SIDE * scale));
  const good = [cx, cy].filter((c) => c && c.confidence >= minConfidence);
  if (!good.length) return { error: "Não foi possível reconhecer uma grade nesta imagem. Marque uma casa ou ajuste pelos controles." };
  // Lados próximos (até 2 px) viram um só; senão vale o eixo mais confiável.
  let period;
  if (good.length === 2 && Math.abs(cx.period - cy.period) <= 2) period = (cx.period + cy.period) / 2;
  else period = [...good].sort((a, b) => b.confidence - a.confidence)[0].period;
  const side = Math.round(period / scale);
  const ox = cx && Math.abs(cx.period - period) <= 2 ? cx.phase / scale : 0;
  const oy = cy && Math.abs(cy.period - period) <= 2 ? cy.phase / scale : 0;
  const confidence = Math.min(...good.map((c) => c.confidence));
  const out = result(side, ox, oy, { confidence });
  if (!out.error && good.length < 2) out.warnings.push("A grade foi reconhecida só em uma direção; confira o alinhamento da outra.");
  if (!out.error && confidence < .35) out.warnings.push("Reconhecimento com pouca certeza: confira se as linhas douradas coincidem com o desenho.");
  return out;
}

/** Texto curto do resultado para a prévia. */
export function describeAlignment(r) {
  if (!r || r.error) return r?.error || "";
  return `Quadrado de ${r.gridPixels} px, deslocamento ${r.gridOffsetX} × ${r.gridOffsetY} px.`;
}
