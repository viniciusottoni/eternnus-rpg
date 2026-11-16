// Regras puras do editor de paredes vetoriais (ADR-087): ímã, seleção, vértices, divisão/união, conversão de casas,
// diagnóstico da geometria e diferenças entre preparação e mesa. Sem DOM; testado em tests/wall-policy.test.mjs.
// Coordenadas em centésimos de casa (WALL_UNIT), as mesmas de FogWall no servidor.
import { WALL_UNIT, MAX_WALLS, WALL_KINDS, blocksLight, blocksMove, decodeBits, encodeBits, lightReach, sharedPreview, wallBlocksSight, wallsCross } from "./fog-policy.js";

const KINDS = new Set(WALL_KINDS.map((k) => k.id));
let seq = 0;
/** Id curto (só letras e números, como o servidor aceita). */
export const wallId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const same = (a, b) => a.x === b.x && a.y === b.y;
const ends = (w) => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
export const wallLength = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
const clampTo = (v, max) => Math.max(0, Math.min(max, Math.round(v)));

/** Ponto do segmento mais próximo de p (t de 0 a 1) e a distância. */
export function project(w, p) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2)) : 0;
  const x = w.x1 + dx * t, y = w.y1 + dy * t;
  return { x, y, t, dist: Math.hypot(p.x - x, p.y - y) };
}

/**
 * Ímã: vértice existente (prioridade), depois ponto sobre um segmento e, com `grid`, o passo da grade (cantos e meios das casas).
 * `tolerance` em centésimos de casa (o editor converte de pixels de tela, então o ímã não muda com o zoom).
 */
export function snapPoint(p, walls, { tolerance = 20, grid = true, step = WALL_UNIT / 2, width = Infinity, height = Infinity, ignore = null } = {}) {
  const maxX = width * WALL_UNIT, maxY = height * WALL_UNIT;
  let best = null;
  for (const w of walls || []) {
    if (ignore?.has?.(w.id)) continue;
    for (const e of ends(w)) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= tolerance && (!best || d < best.d)) best = { x: e.x, y: e.y, d, target: "vertex" };
    }
  }
  if (best) return { x: best.x, y: best.y, snapped: true, target: "vertex" };
  if (grid) {
    const gx = Math.round(p.x / step) * step, gy = Math.round(p.y / step) * step;
    if (Math.hypot(gx - p.x, gy - p.y) <= tolerance) return { x: clampTo(gx, maxX), y: clampTo(gy, maxY), snapped: true, target: "grid" };
  }
  let seg = null;
  for (const w of walls || []) {
    if (ignore?.has?.(w.id)) continue;
    const q = project(w, p);
    if (q.dist <= tolerance && (!seg || q.dist < seg.dist)) seg = q;
  }
  if (seg) return { x: clampTo(seg.x, maxX), y: clampTo(seg.y, maxY), snapped: true, target: "segment" };
  return { x: clampTo(p.x, maxX), y: clampTo(p.y, maxY), snapped: false, target: null };
}

/** Shift: trava o ângulo em múltiplos de 45° a partir da âncora (paredes retas e diagonais exatas). */
export function constrainAngle(anchor, p) {
  const dx = p.x - anchor.x, dy = p.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { x: anchor.x, y: anchor.y };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(Math.cos(a)) < 1e-9) return { x: anchor.x, y: Math.round(anchor.y + Math.sign(Math.sin(a)) * len) };
  if (Math.abs(Math.sin(a)) < 1e-9) return { x: Math.round(anchor.x + Math.sign(Math.cos(a)) * len), y: anchor.y };
  const d = Math.round(len / Math.SQRT2);
  return { x: anchor.x + Math.sign(Math.cos(a)) * d, y: anchor.y + Math.sign(Math.sin(a)) * d };
}

/** O que está sob o ponteiro: vértice (part "a"/"b") tem prioridade sobre o corpo do segmento. */
export function hitWall(walls, p, tolerance = 20) {
  let best = null;
  for (const w of walls || []) {
    for (const [part, e] of [["a", { x: w.x1, y: w.y1 }], ["b", { x: w.x2, y: w.y2 }]]) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= tolerance && (!best || best.part === "segment" || d < best.dist)) best = { id: w.id, part, dist: d, x: e.x, y: e.y };
    }
  }
  if (best) return best;
  for (const w of walls || []) {
    const q = project(w, p);
    if (q.dist <= tolerance && (!best || q.dist < best.dist)) best = { id: w.id, part: "segment", dist: q.dist, t: q.t, x: Math.round(q.x), y: Math.round(q.y) };
  }
  return best;
}

/** Linha poligonal (cliques sequenciais) → segmentos novos. Pontos repetidos seguidos são ignorados. */
export function polylineWalls(points, kind = "wall", { hidden = false, closed = false } = {}) {
  const pts = (points || []).filter((p, i, list) => i === 0 || !same(p, list[i - 1]));
  if (closed && pts.length > 2 && !same(pts[0], pts[pts.length - 1])) pts.push(pts[0]);
  const out = [];
  for (let i = 1; i < pts.length; i++)
    out.push({ id: wallId(), x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, kind: KINDS.has(kind) ? kind : "wall", open: false, hidden: !!hidden });
  return out;
}

/** Retângulo (sala) com quatro paredes ligadas. */
export const roomWalls = (a, b, kind = "wall") =>
  polylineWalls([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], kind, { closed: true });

/** Acrescenta respeitando o limite do servidor. Devolve { walls, error }. */
export function addWalls(walls, added) {
  const list = [...(walls || []), ...added.filter((w) => wallLength(w) > 0)];
  if (list.length > MAX_WALLS) return { walls, error: `Limite de ${MAX_WALLS} segmentos de parede por mapa.` };
  return { walls: list, error: "" };
}

/** Arrasta um vértice: todas as pontas no mesmo ponto andam juntas (cantos e cadeias continuam ligados). */
export function moveVertex(walls, from, to) {
  return walls.map((w) => ({
    ...w,
    ...(w.x1 === from.x && w.y1 === from.y ? { x1: to.x, y1: to.y } : {}),
    ...(w.x2 === from.x && w.y2 === from.y ? { x2: to.x, y2: to.y } : {}),
  })).filter((w) => wallLength(w) > 0);
}

/** Divide o segmento no ponto (projetado sobre ele). Pontas não dividem. */
export function splitWall(walls, id, p) {
  const w = walls.find((x) => x.id === id);
  if (!w) return walls;
  const q = project(w, p), x = Math.round(q.x), y = Math.round(q.y);
  if ((x === w.x1 && y === w.y1) || (x === w.x2 && y === w.y2)) return walls;
  return walls.flatMap((s) => (s.id !== id ? [s] : [{ ...s, x2: x, y2: y }, { ...s, id: wallId(), x1: x, y1: y }]));
}

/**
 * Remove um vértice: com exatamente dois segmentos do mesmo tipo ligados ali, une os dois num só; com um, apaga o segmento.
 * Com três ou mais (encontro de paredes), não mexe e explica.
 */
export function removeVertex(walls, p) {
  const at = walls.filter((w) => (w.x1 === p.x && w.y1 === p.y) || (w.x2 === p.x && w.y2 === p.y));
  if (!at.length) return { walls, error: "Não há vértice nesse ponto." };
  if (at.length === 1) return { walls: walls.filter((w) => w.id !== at[0].id), error: "" };
  if (at.length > 2) return { walls, error: "Três ou mais paredes se encontram nesse ponto. Apague um dos segmentos." };
  const [a, b] = at;
  if (a.kind !== b.kind) return { walls, error: "Os dois segmentos são de tipos diferentes. Mude o tipo antes de unir." };
  const far = (w) => (w.x1 === p.x && w.y1 === p.y ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 });
  const fa = far(a), fb = far(b);
  if (same(fa, fb)) return { walls: walls.filter((w) => w.id !== a.id && w.id !== b.id), error: "" };
  const merged = { ...a, x1: fa.x, y1: fa.y, x2: fb.x, y2: fb.y };
  return { walls: walls.filter((w) => w.id !== b.id).map((w) => (w.id === a.id ? merged : w)), error: "" };
}

/** Une segmentos compatíveis: mesmo tipo e estado, ligados pela ponta e na mesma reta. Devolve a lista simplificada. */
export function joinCollinear(walls, ids = null) {
  let list = walls.slice();
  const pick = ids ? new Set(ids) : null;
  for (let changed = true; changed;) {
    changed = false;
    outer: for (const a of list) {
      if (pick && !pick.has(a.id)) continue;
      for (const b of list) {
        if (a === b || (pick && !pick.has(b.id)) || a.kind !== b.kind || !!a.open !== !!b.open || !!a.hidden !== !!b.hidden || a.kind === "door") continue;
        const shared = ends(a).find((e) => ends(b).some((f) => same(e, f)));
        if (!shared) continue;
        const fa = ends(a).find((e) => !same(e, shared)), fb = ends(b).find((e) => !same(e, shared));
        if (!fa || !fb) continue;
        const cross = (shared.x - fa.x) * (fb.y - fa.y) - (shared.y - fa.y) * (fb.x - fa.x);
        if (cross !== 0) continue;
        // A ponta comum precisa ficar entre as outras duas (não dobra para trás) e não pode ser encontro de três paredes.
        if ((shared.x - fa.x) * (fb.x - shared.x) + (shared.y - fa.y) * (fb.y - shared.y) <= 0) continue;
        if (list.filter((w) => ends(w).some((e) => same(e, shared))).length !== 2) continue;
        list = list.filter((w) => w.id !== b.id).map((w) => (w.id === a.id ? { ...a, x1: fa.x, y1: fa.y, x2: fb.x, y2: fb.y } : w));
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

/** Move segmentos inteiros. Recusa se algum ponto sair do mapa (nada é cortado em silêncio). */
export function translateWalls(walls, ids, dx, dy, width, height) {
  const set = new Set(ids), maxX = width * WALL_UNIT, maxY = height * WALL_UNIT;
  const out = walls.map((w) => (set.has(w.id) ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w));
  const bad = out.some((w) => set.has(w.id) && ([w.x1, w.x2].some((v) => v < 0 || v > maxX) || [w.y1, w.y2].some((v) => v < 0 || v > maxY)));
  return bad ? { walls, error: "A parede sairia do mapa." } : { walls: out, error: "" };
}

/** Cópias (novos ids) deslocadas; o chamador confere o limite com addWalls. */
export const copyWalls = (walls, ids, dx = 0, dy = 0) =>
  walls.filter((w) => ids.includes(w.id)).map((w) => ({ ...w, id: wallId(), x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }));

/** Ids dos segmentos inteiramente dentro do retângulo (seleção retangular). */
export function wallsInBox(walls, box) {
  const x0 = Math.min(box.x1, box.x2), x1 = Math.max(box.x1, box.x2), y0 = Math.min(box.y1, box.y2), y1 = Math.max(box.y1, box.y2);
  return walls.filter((w) => [w.x1, w.x2].every((x) => x >= x0 && x <= x1) && [w.y1, w.y2].every((y) => y >= y0 && y <= y1)).map((w) => w.id);
}

/** Atualiza campos de vários segmentos (tipo, oculta, aberta). Porta só fica aberta se for porta. */
export function patchWalls(walls, ids, patch) {
  const set = new Set(ids);
  return walls.map((w) => {
    if (!set.has(w.id)) return w;
    const next = { ...w, ...patch };
    if (!KINDS.has(next.kind)) next.kind = "wall";
    if (next.kind !== "door") next.open = false;
    return next;
  });
}

const CELL_KIND = { "#": "wall", l: "sight", m: "move" };
/**
 * Conversão não destrutiva: contorno das casas bloqueadas (parede, só luz, só movimento) vira segmentos, juntando trechos
 * retos. As casas continuam como estão; o mestre decide se limpa depois. Portas por casa ficam como estão.
 */
export function cellsToWalls(cells, width, height) {
  const kindAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? null : CELL_KIND[cells[y]?.[x]] || null);
  const runs = [];
  // Bordas horizontais (entre a linha y-1 e y) e verticais (entre a coluna x-1 e x) onde muda o bloqueio.
  for (let y = 0; y <= height; y++) {
    let start = null, kind = null;
    for (let x = 0; x <= width; x++) {
      const a = kindAt(x, y - 1), b = kindAt(x, y);
      const k = x < width && a !== b ? (a && b ? a : a || b) : null;
      if (k !== kind) {
        if (kind) runs.push({ id: wallId(), x1: start * WALL_UNIT, y1: y * WALL_UNIT, x2: x * WALL_UNIT, y2: y * WALL_UNIT, kind, open: false, hidden: false });
        start = x; kind = k;
      }
    }
  }
  for (let x = 0; x <= width; x++) {
    let start = null, kind = null;
    for (let y = 0; y <= height; y++) {
      const a = kindAt(x - 1, y), b = kindAt(x, y);
      const k = y < height && a !== b ? (a && b ? a : a || b) : null;
      if (k !== kind) {
        if (kind) runs.push({ id: wallId(), x1: x * WALL_UNIT, y1: start * WALL_UNIT, x2: x * WALL_UNIT, y2: y * WALL_UNIT, kind, open: false, hidden: false });
        start = y; kind = k;
      }
    }
  }
  // Borda do mapa já fecha a passagem: não vira parede.
  const W = width * WALL_UNIT, H = height * WALL_UNIT;
  return runs.filter((w) => !((w.x1 === 0 && w.x2 === 0) || (w.x1 === W && w.x2 === W) || (w.y1 === 0 && w.y2 === 0) || (w.y1 === H && w.y2 === H)));
}

/** Casas em que a parede vetorial atravessa (para limpar casas depois da conversão ou avisar). */
export function cellsUnder(w) {
  const out = new Set();
  const steps = Math.max(1, Math.ceil(wallLength(w) / (WALL_UNIT / 4)));
  for (let i = 0; i <= steps; i++) {
    const x = w.x1 + ((w.x2 - w.x1) * i) / steps, y = w.y1 + ((w.y2 - w.y1) * i) / steps;
    out.add(`${Math.floor(x / WALL_UNIT)}:${Math.floor(y / WALL_UNIT)}`);
  }
  return out;
}

const center = (c) => c * WALL_UNIT + WALL_UNIT / 2;
/**
 * Diagnóstico da geometria (só no editor do mestre). Cada item: { type, x, y (centésimos), message }.
 * Texto descreve o problema; o desenho usa forma ("!"), não só cor.
 */
export function diagnose({ cells = [], walls = [], lights = [], tokens = [] }, width, height, limit = 100) {
  const issues = [];
  const add = (type, x, y, message) => { if (issues.length < limit) issues.push({ type, x: Math.round(x), y: Math.round(y), message }); };
  const keys = new Map();
  for (const w of walls) {
    const k = [`${w.x1},${w.y1}`, `${w.x2},${w.y2}`].sort().join("|");
    if (keys.has(k)) add("duplicate", (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, "Paredes sobrepostas no mesmo trecho.");
    else keys.set(k, w.id);
    if (wallLength(w) < WALL_UNIT / 10) add("short", w.x1, w.y1, "Parede muito curta (menos de um décimo de casa).");
  }
  // Pontas quase encostadas: a luz escapa pela fresta.
  const points = walls.flatMap(ends);
  const gap = WALL_UNIT / 8;
  const reported = new Set();
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      const k = `${points[i].x},${points[i].y}`;
      if (d > 0 && d < gap && !reported.has(k)) { reported.add(k); add("gap", points[i].x, points[i].y, "Pontas de parede quase encostadas: a luz pode escapar pela fresta. Arraste uma sobre a outra."); }
    }
  const sight = walls.filter(wallBlocksSight);
  for (const l of lights) {
    if (blocksLight(cells[l.y]?.[l.x])) add("lightInWall", center(l.x), center(l.y), "Foco de luz dentro de uma casa que bloqueia luz: ele não ilumina nada.");
    else if (sight.some((w) => { const q = project(w, { x: center(l.x), y: center(l.y) }); return q.dist < 1; })) add("lightOnWall", center(l.x), center(l.y), "Foco de luz exatamente sobre uma parede: ilumina os dois lados.");
  }
  for (const t of tokens) {
    if (blocksMove(cells[t.y]?.[t.x])) add("tokenBlocked", center(t.x), center(t.y), `${t.label || "Marcador"} está numa casa que bloqueia movimento.`);
  }
  for (const d of walls.filter((w) => w.kind === "door")) {
    const linked = ends(d).every((e) => walls.some((w) => w !== d && ends(w).some((f) => same(e, f))));
    if (!linked) add("doorLoose", (d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, "Porta sem parede ligada às duas pontas: dá para contornar.");
  }
  if (walls.some((w) => [w.x1, w.x2].some((v) => v < 0 || v > width * WALL_UNIT) || [w.y1, w.y2].some((v) => v < 0 || v > height * WALL_UNIT)))
    add("outside", 0, 0, "Há parede fora do mapa.");
  return issues;
}

/**
 * Camadas do diagnóstico para o tabuleiro: casas que bloqueiam movimento (por casa) e casas sem luz compartilhada
 * (focos e reveladas, as mesmas regras do servidor). `blocked`/`dark` em base64, como as máscaras do servidor.
 */
export function diagnosticLayers(layer, width, height) {
  const n = width * height;
  const blocked = new Array(n).fill(false);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) blocked[y * width + x] = blocksMove(layer.cells?.[y]?.[x]);
  const lit = decodeBits(sharedPreview(layer, width, height), n);
  const dark = Array.from(lit, (v) => !v);
  return { blocked: encodeBits(blocked), dark: encodeBits(dark), lit: lit.reduce((a, b) => a + b, 0), total: n };
}

/** Passo de movimento bloqueado entre casas vizinhas por parede vetorial (atalho para testes/diagnóstico). */
export const crossesBetween = (segs, a, b) => wallsCross(segs, center(a.x), center(a.y), center(b.x), center(b.y));

/**
 * Diferenças entre a camada ao vivo e a preparação (revisão antes de aplicar). Portas abertas/fechadas não contam
 * (é estado da partida); devolve contagens legíveis para o diálogo de aplicação.
 */
export function layerDiff(live, prep) {
  const out = { walls: { added: 0, removed: 0, changed: 0 }, lights: { added: 0, removed: 0, changed: 0 }, marks: { added: 0, removed: 0, changed: 0 }, cells: 0, revealed: 0, fog: false };
  const sig = (w) => `${w.x1},${w.y1},${w.x2},${w.y2}|${w.kind}|${!!w.hidden}`;
  const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
  const cmp = (a, b, key, sigOf) => {
    const A = byId(a), B = byId(b);
    for (const [id, x] of B) { if (!A.has(id)) out[key].added++; else if (sigOf(A.get(id)) !== sigOf(x)) out[key].changed++; }
    for (const id of A.keys()) if (!B.has(id)) out[key].removed++;
  };
  cmp(live?.walls, prep?.walls, "walls", sig);
  cmp(live?.lights, prep?.lights, "lights", (l) => `${l.x},${l.y},${l.radius},${l.dim ?? ""},${l.color ?? ""},${l.intensity ?? ""},${l.animation ?? ""}`);
  cmp(live?.marks, prep?.marks, "marks", (m) => `${m.x},${m.y},${m.kind},${m.label},${m.dc ?? ""},${m.sense ?? ""},${m.maxDistance ?? ""}`);
  const norm = (c) => (c === "o" ? "d" : c);
  (prep?.cells || []).forEach((row, y) => { for (let x = 0; x < row.length; x++) if (norm(row[x]) !== norm(live?.cells?.[y]?.[x])) out.cells++; });
  const n = (prep?.cells?.length || 0) * (prep?.cells?.[0]?.length || 0);
  const a = decodeBits(live?.revealed, n), b = decodeBits(prep?.revealed, n);
  for (let i = 0; i < n; i++) if (b[i] && !a[i]) out.revealed++;
  out.fog = (live?.fog ?? null) !== (prep?.fog ?? null);
  return out;
}

/** Frases do resumo de diferenças ("2 paredes novas", …). Vazio = nada muda na estrutura. */
export function diffSummary(d) {
  const parts = [];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const group = (g, one, many) => {
    if (g.added) parts.push(`${n(g.added, one, many)} ${g.added === 1 ? "nova" : "novas"}`);
    if (g.removed) parts.push(`${n(g.removed, one, many)} ${g.removed === 1 ? "removida" : "removidas"}`);
    if (g.changed) parts.push(`${n(g.changed, one, many)} ${g.changed === 1 ? "alterada" : "alteradas"}`);
  };
  group(d.walls, "parede", "paredes");
  group(d.lights, "luz", "luzes");
  group(d.marks, "marca", "marcas");
  if (d.cells) parts.push(`${n(d.cells, "casa de bloqueio alterada", "casas de bloqueio alteradas")}`);
  if (d.revealed) parts.push(`${n(d.revealed, "casa revelada a mais", "casas reveladas a mais")}`);
  if (d.fog) parts.push("névoa do mapa alterada");
  return parts;
}

export { lightReach };

/**
 * Porta vetorial mais próxima de uma casa (mesa: "Abrir ou fechar porta" por clique). A porta precisa passar a menos de
 * 3/4 de casa do centro; ocultas também contam (é o mestre quem clica).
 */
export function doorNear(walls, cell, reach = WALL_UNIT * 0.75) {
  const c = { x: cell.x * WALL_UNIT + WALL_UNIT / 2, y: cell.y * WALL_UNIT + WALL_UNIT / 2 };
  let best = null;
  for (const w of walls || []) {
    if (w.kind !== "door") continue;
    const d = project(w, c).dist;
    if (d <= reach && (!best || d < best.d)) best = { d, door: w };
  }
  return best?.door || null;
}
