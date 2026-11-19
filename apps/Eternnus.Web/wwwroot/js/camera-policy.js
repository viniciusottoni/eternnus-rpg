// Câmera compartilhada (ADR-115): "Mostrar esta região", "Seguir o mestre" e exibição externa. Regras puras, sem DOM;
// testadas em tests/camera-policy.test.mjs. A câmera só enquadra a visão local: nunca move marcadores nem revela névoa.

/** Estados de quem recebe o enquadramento: câmera livre, seguindo o mestre ou seguindo pausado pelo próprio gesto. */
export const FOLLOW = Object.freeze({ FREE: "free", FOLLOWING: "following", PAUSED: "paused" });

/** Duração da transição de enquadramento; movimento reduzido ou aba oculta tornam a troca instantânea. */
export const FRAME_MS = 450;

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Próximo estado do seguimento.
 * - enable/disable: escolha explícita da pessoa (botão "Seguir o mestre").
 * - user: pan/zoom manual; quem seguia passa a "pausado" (mostra "Voltar a seguir"); câmera livre continua livre.
 * - resume: "Voltar a seguir" a partir do pausado. Câmera livre não liga sozinha.
 */
export function followReducer(mode, event) {
  const current = Object.values(FOLLOW).includes(mode) ? mode : FOLLOW.FREE;
  if (event === "enable") return FOLLOW.FOLLOWING;
  if (event === "disable") return FOLLOW.FREE;
  if (event === "user") return current === FOLLOW.FOLLOWING ? FOLLOW.PAUSED : current;
  if (event === "resume") return current === FOLLOW.PAUSED ? FOLLOW.FOLLOWING : current;
  return current;
}

/** Enquadramento vindo do servidor, validado: `{ x, y, w, h, seq }` com números finitos e lados positivos; senão null. */
export function normalizeFrame(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { x, y, w, h, seq } = raw;
  if (![x, y, w, h, seq].every(finite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h, seq };
}

/**
 * Decide se um enquadramento recebido move a câmera local. Só aplica quando a sequência aumenta (a mesma resposta
 * repetida a cada consulta não faz a tela pular) e quem recebe está seguindo. A sequência vista avança sempre,
 * para que voltar a seguir não reaplique um enquadramento antigo como se fosse novo — `force` cobre esse caso.
 * Devolve { apply, lastSeq, frame }.
 */
export function frameDecision({ mode, lastSeq = -Infinity, frame, force = false }) {
  const f = normalizeFrame(frame);
  if (!f) return { apply: false, lastSeq, frame: null };
  const fresh = f.seq > lastSeq;
  const next = Math.max(lastSeq, f.seq);
  return { apply: mode === FOLLOW.FOLLOWING && (fresh || force), lastSeq: next, frame: f };
}

/**
 * Região visível (casas) a partir do canvas: origem do tabuleiro e tamanho da janela em pixels do dispositivo e o tamanho
 * de uma casa. Recorta ao mapa e arredonda a 2 casas decimais (o servidor guarda com essa precisão). Null sem mapa.
 */
export function visibleRegion({ originX, originY, viewW, viewH, cell, cols, rows }) {
  if (![originX, originY, viewW, viewH, cell, cols, rows].every(finite) || cell <= 0 || cols < 1 || rows < 1) return null;
  const x0 = clamp(-originX / cell, 0, cols), y0 = clamp(-originY / cell, 0, rows);
  const x1 = clamp((viewW - originX) / cell, 0, cols), y1 = clamp((viewH - originY) / cell, 0, rows);
  let w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  // O servidor aceita no mínimo 1 casa por lado: amplia em volta do centro, sem sair do mapa.
  const grow = (start, size, limit) => {
    if (size >= 1 || limit < 1) return [start, Math.max(size, Math.min(1, limit))];
    const s = clamp(start + size / 2 - 0.5, 0, limit - 1);
    return [s, 1];
  };
  const [x, ww] = grow(x0, w, cols), [y, hh] = grow(y0, h, rows);
  return { x: round2(x), y: round2(y), w: round2(ww), h: round2(hh) };
}

/**
 * Enquadramento local que mostra a região inteira, preservando a proporção do mapa: o lado mais restritivo decide o zoom.
 * `fitCell` = pixels de tela por casa no zoom 1 ("ajustar à tela"). O zoom fica entre os limites do tabuleiro; o centro
 * (em casas) fica dentro do mapa. Devolve { zoom, cx, cy } ou null.
 */
export function fitRegion({ region, viewW, viewH, fitCell, minZoom = 1, maxZoom = 3, cols, rows }) {
  const r = normalizeFrame({ seq: 0, ...region });
  if (!r || ![viewW, viewH, fitCell].every(finite) || viewW <= 0 || viewH <= 0 || fitCell <= 0) return null;
  const lo = finite(minZoom) ? minZoom : 1, hi = Math.max(lo, finite(maxZoom) ? maxZoom : 3);
  const zoom = clamp(Math.min(viewW / (r.w * fitCell), viewH / (r.h * fitCell)), lo, hi);
  let cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (finite(cols) && cols > 0) cx = clamp(cx, 0, cols);
  if (finite(rows) && rows > 0) cy = clamp(cy, 0, rows);
  return { zoom, cx, cy };
}

/** Duração da transição: 0 com movimento reduzido ou aba oculta (a troca é instantânea). */
export function frameDuration({ reducedMotion = false, hidden = false } = {}) {
  return reducedMotion || hidden ? 0 : FRAME_MS;
}

/** Suavização simétrica (começa e termina devagar). */
export const easeInOut = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};

/** Ponto intermediário entre dois enquadramentos; o zoom interpola em escala logarítmica (aproximação uniforme). */
export function mixView(from, to, t) {
  const k = easeInOut(t);
  const z0 = Math.max(1e-3, from.zoom), z1 = Math.max(1e-3, to.zoom);
  return {
    zoom: Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * k),
    cx: from.cx + (to.cx - from.cx) * k,
    cy: from.cy + (to.cy - from.cy) * k,
  };
}

/** Chave por sessão para lembrar "Seguir o mestre" na aba (sessionStorage). Só GUIDs; senão null. */
export function followKey(sessionId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId || ""))
    ? `eternnus.follow.${String(sessionId).toLowerCase()}`
    : null;
}

/** Lê a escolha guardada; sem escolha (ou armazenamento indisponível) usa o padrão da tela. */
export function readFollow(storage, key, fallback = false) {
  if (!key) return !!fallback;
  try {
    const v = storage?.getItem(key);
    return v === "1" ? true : v === "0" ? false : !!fallback;
  } catch {
    return !!fallback;
  }
}

export function writeFollow(storage, key, on) {
  if (!key) return;
  try { storage?.setItem(key, on ? "1" : "0"); } catch {}
}

/** Texto do controle e do aviso para cada estado (ajuda o leitor de tela a saber o que acontece). */
export function followLabels(mode) {
  if (mode === FOLLOW.FOLLOWING) return { toggle: "Parar de seguir o mestre", status: "Seguindo o mestre" };
  if (mode === FOLLOW.PAUSED) return { toggle: "Parar de seguir o mestre", status: "Seguir pausado: você moveu a visão" };
  return { toggle: "Seguir o mestre", status: "Câmera livre" };
}
