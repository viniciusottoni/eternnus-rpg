// Mapas da campanha inseridos numa cena (ADR-113). Regras puras, sem DOM.
// A cena tem UMA grade global (a do mapa de fundo ou da área em branco). Uma instância é um elemento de imagem da composição
// com `mapKey: "asset:{guid}"` (igual ao `src`): mostra a imagem do mapa original, que nunca é copiado nem alterado.
// Encaixar na grade = escala em que a casa do mapa original mede a casa da cena, giro de 0/90/180/270° e a grade do
// original sobre as linhas da cena. Regras (paredes, portas, casas bloqueadas, luzes) só entram por importação explícita,
// convertidas aqui para casas da cena; marcadores continuam em casas globais da cena e não dependem das instâncias.
import { WALL_UNIT, MAX_WALLS } from "./fog-policy.js";

const ASSET = /^asset:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const RAD = Math.PI / 180;
const MAX_LIGHTS = 100;
const round2 = (v) => Math.round(v * 100) / 100;
const near = (v, eps) => Math.abs(v - Math.round(v)) <= eps;
const normRot = (deg) => { const v = ((((Number(deg) || 0) + 180) % 360) + 360) % 360 - 180; return Math.abs(v) < 1e-9 ? 0 : round2(v); };

export const isMapInstance = (el) => el?.type === "image" && typeof el.mapKey === "string" && ASSET.test(el.mapKey) && el.mapKey.toLowerCase() === String(el.src).toLowerCase();

/** Mapa da campanha que pode ser inserido como instância: mapa de imagem com grade (não tiles nem cenário pronto). */
export function canInstance(map) {
  return !!map && ASSET.test(String(map.key)) && !map.isTileMap && map.hasGrid !== false && map.kind !== "cartographic"
    && Number(map.gridPixels) >= 8 && Number(map.pixelWidth) > 0 && Number(map.pixelHeight) > 0;
}

/** Grade da cena a partir dos dados da camada/mapa de fundo: { size, offsetX, offsetY, width, height } (largura/altura em casas). */
export function sceneGrid(meta) {
  const size = Number(meta?.gridPixels) || 0;
  if (size < 1 || !(meta?.width > 0) || !(meta?.height > 0)) return null;
  return { size, offsetX: Number(meta.gridOffsetX) || 0, offsetY: Number(meta.gridOffsetY) || 0, width: Number(meta.width), height: Number(meta.height) };
}

/** Casas da grade do mapa original (mesma conta de CampaignMapView.Grid). */
export function mapCells(map) {
  const s = Number(map.gridPixels) || 0;
  if (s <= 0) return { width: 0, height: 0 };
  return { width: Math.floor((map.pixelWidth - (map.gridOffsetX || 0)) / s), height: Math.floor((map.pixelHeight - (map.gridOffsetY || 0)) / s) };
}

/** Escala que faz a casa do original medir a casa da cena. */
export const instanceScale = (map, grid) => grid.size / Number(map.gridPixels);

/**
 * Converte um ponto da grade do mapa original (casas, podendo ser fracionário) em casas da cena, seguindo o desenho da
 * superfície: centro do elemento, giro e espelhamento (mesma ordem de composition-canvas.js).
 */
export function toSceneCells(el, map, grid) {
  const ex = el.width / map.pixelWidth, ey = el.height / map.pixelHeight;
  const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
  const r = (el.rotation || 0) * RAD, cos = Math.cos(r), sin = Math.sin(r);
  const ox = map.gridOffsetX || 0, oy = map.gridOffsetY || 0, s = Number(map.gridPixels);
  return (gx, gy) => {
    let u = (ox + gx * s) * ex - el.width / 2, v = (oy + gy * s) * ey - el.height / 2;
    if (el.flipX) u = -u;
    if (el.flipY) v = -v;
    const dx = cx + u * cos - v * sin, dy = cy + u * sin + v * cos;
    return { x: (dx - grid.offsetX) / grid.size, y: (dy - grid.offsetY) / grid.size };
  };
}

/**
 * A instância está encaixada? Giro múltiplo de 90°, casa do original do tamanho da casa da cena (±0,5%) e o canto da grade
 * do original sobre uma linha da cena (±5% de casa). → { aligned, problem }.
 */
export function alignment(el, map, grid) {
  if (!grid) return { aligned: false, problem: "A cena precisa de grade (mapa tático ou área em branco com grade)." };
  if (!canInstance(map)) return { aligned: false, problem: "O mapa original não tem grade." };
  if (!near((el.rotation || 0) / 90, 0.001)) return { aligned: false, problem: "Gire em passos de 90° (use Encaixar na grade da cena)." };
  const quarter = Math.abs(Math.round((el.rotation || 0) / 90)) % 2 === 1;
  const cellW = map.gridPixels * el.width / map.pixelWidth, cellH = map.gridPixels * el.height / map.pixelHeight;
  if (Math.abs(cellW - grid.size) > grid.size * 0.005 || Math.abs(cellH - grid.size) > grid.size * 0.005)
    return { aligned: false, problem: `A casa do mapa mede ${Math.round(quarter ? cellH : cellW)} px e a da cena ${grid.size} px. Use Encaixar na grade da cena.` };
  const p = toSceneCells(el, map, grid)(0, 0);
  if (!near(p.x, 0.05) || !near(p.y, 0.05)) return { aligned: false, problem: "A grade do mapa não coincide com as linhas da cena. Use Encaixar na grade da cena." };
  return { aligned: true, problem: "" };
}

/**
 * Encaixe na grade da cena mantendo o centro aproximado: escala da casa, giro arredondado para 0/90/180/270° e posição
 * deslocada até a grade do original cair sobre as linhas da cena. → { x, y, width, height, rotation }.
 */
export function snapInstance(el, map, grid) {
  const k = instanceScale(map, grid);
  const width = round2(map.pixelWidth * k), height = round2(map.pixelHeight * k);
  const rotation = normRot(Math.round((el.rotation || 0) / 90) * 90);
  const c = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  const tmp = { ...el, width, height, rotation, x: c.x - width / 2, y: c.y - height / 2 };
  const p = toSceneCells(tmp, map, grid)(0, 0);
  return { x: round2(tmp.x + (Math.round(p.x) - p.x) * grid.size), y: round2(tmp.y + (Math.round(p.y) - p.y) * grid.size), width, height, rotation };
}

/** Elemento novo de instância centrado em `point` (pixels do documento), já encaixado. */
export function placeInstance(map, grid, point, { rotation = 0 } = {}) {
  const k = instanceScale(map, grid);
  const width = map.pixelWidth * k, height = map.pixelHeight * k;
  const el = { type: "image", src: map.key, mapKey: map.key, x: point.x - width / 2, y: point.y - height / 2, width, height, rotation, flipX: false, flipY: false };
  return { ...el, ...snapInstance(el, map, grid) };
}

/** Instância seguinte/anterior na ordem do documento (dir = 1 ou −1); null sem instâncias. */
export function nextInstance(elements, currentId, dir = 1) {
  const list = (elements || []).filter(isMapInstance);
  if (!list.length) return null;
  const i = list.findIndex((e) => e.id === currentId);
  if (i < 0) return (dir < 0 ? list[list.length - 1] : list[0]).id;
  return list[(i + (dir < 0 ? -1 : 1) + list.length) % list.length].id;
}

/** Recorte de segmento ao retângulo [0,w]×[0,h] (Liang–Barsky). → [x1,y1,x2,y2] ou null. */
export function clipSegment(x1, y1, x2, y2, w, h) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1], [dx, w - x1], [-dy, y1], [dy, h - y1]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/**
 * Preparação do mapa original (`source`: { cells: string[], lights, walls }) em casas da cena para a instância `el`.
 * Translação, giros de 90° e espelhamento; o que cai fora da cena é recortado (paredes) ou descartado (casas, luzes).
 * Só casas que não são livres entram. → { cells: [{x,y,c}], lights, walls, dropped: { cells, lights, walls } } ou { error }.
 */
export function transformPrep(source, el, map, grid) {
  const a = alignment(el, map, grid);
  if (!a.aligned) return { error: a.problem };
  const f = toSceneCells(el, map, grid);
  const W = grid.width, H = grid.height;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const cellAt = (cx, cy) => { const p = f(cx + 0.5, cy + 0.5); return { x: Math.floor(p.x), y: Math.floor(p.y) }; };
  const dropped = { cells: 0, lights: 0, walls: 0 };
  const cells = [];
  (source?.cells || []).forEach((row, cy) => {
    for (let cx = 0; cx < row.length; cx++) {
      const c = row[cx];
      if (c === "." || !".mld#o".includes(c)) continue;
      const p = cellAt(cx, cy);
      if (inside(p.x, p.y)) cells.push({ x: p.x, y: p.y, c }); else dropped.cells++;
    }
  });
  const lights = [];
  for (const l of source?.lights || []) {
    const p = cellAt(l.x, l.y);
    if (!inside(p.x, p.y)) { dropped.lights++; continue; }
    const { id, ...rest } = l;
    lights.push({ ...rest, x: p.x, y: p.y });
  }
  const walls = [];
  for (const w of source?.walls || []) {
    const a1 = f(w.x1 / WALL_UNIT, w.y1 / WALL_UNIT), a2 = f(w.x2 / WALL_UNIT, w.y2 / WALL_UNIT);
    const seg = clipSegment(a1.x * WALL_UNIT, a1.y * WALL_UNIT, a2.x * WALL_UNIT, a2.y * WALL_UNIT, W * WALL_UNIT, H * WALL_UNIT);
    const r = seg && seg.map((v) => Math.round(v));
    if (!r || (r[0] === r[2] && r[1] === r[3])) { dropped.walls++; continue; }
    const { id, ...rest } = w;
    walls.push({ ...rest, x1: r[0], y1: r[1], x2: r[2], y2: r[3] });
  }
  return { cells, lights, walls, dropped };
}

/**
 * Junta a preparação convertida à camada própria da cena (sem mutar a entrada). Casas não livres do original sobrepõem;
 * luzes na mesma casa e paredes idênticas não se repetem; limites do servidor (100 luzes, 2.000 paredes) são respeitados.
 * `seed` gera ids novos e únicos (alfanuméricos). → { layer, added: { cells, lights, walls }, skipped }.
 */
export function mergePrep(layer, t, width, seed = "mi") {
  const rows = (layer.cells || []).map((r) => r.split(""));
  let cells = 0;
  for (const c of t.cells || []) {
    if (!rows[c.y] || c.x >= rows[c.y].length || c.x >= width) continue;
    if (rows[c.y][c.x] !== c.c) { rows[c.y][c.x] = c.c; cells++; }
  }
  const tag = String(seed).replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "mi";
  const lights = [...(layer.lights || [])];
  const walls = [...(layer.walls || [])];
  const ids = new Set([...lights, ...walls].map((x) => x.id).filter(Boolean));
  const fresh = (n) => { let i = n, id; do id = `${tag}${i++}`; while (ids.has(id)); ids.add(id); return id; };
  let addedLights = 0, addedWalls = 0, skipped = 0;
  for (const l of t.lights || []) {
    if (lights.some((x) => x.x === l.x && x.y === l.y)) { skipped++; continue; }
    if (lights.length >= MAX_LIGHTS) { skipped++; continue; }
    lights.push({ ...l, id: fresh(lights.length) }); addedLights++;
  }
  const key = (w) => [w.kind || "wall", ...[[w.x1, w.y1], [w.x2, w.y2]].sort((p, q) => p[0] - q[0] || p[1] - q[1]).flat()].join(",");
  const seen = new Set(walls.map(key));
  for (const w of t.walls || []) {
    if (seen.has(key(w)) || walls.length >= MAX_WALLS) { skipped++; continue; }
    seen.add(key(w));
    walls.push({ ...w, id: fresh(walls.length) }); addedWalls++;
  }
  return { layer: { ...layer, cells: rows.map((r) => r.join("")), lights, walls }, added: { cells, lights: addedLights, walls: addedWalls }, skipped };
}

/** Frase do resultado da importação, para a barra de status. */
export function importSummary(name, added, dropped, skipped) {
  const parts = [];
  if (added.walls) parts.push(`${added.walls} parede(s)/porta(s)`);
  if (added.cells) parts.push(`${added.cells} casa(s) bloqueada(s)`);
  if (added.lights) parts.push(`${added.lights} luz(es)`);
  const out = (dropped.cells || 0) + (dropped.lights || 0) + (dropped.walls || 0);
  const head = parts.length ? `Trazido de “${name}”: ${parts.join(", ")}.` : `Nada novo para trazer de “${name}”.`;
  return `${head}${out ? ` ${out} item(ns) ficaram fora da cena e não entraram.` : ""}${skipped ? ` ${skipped} repetido(s) ou acima do limite ignorado(s).` : ""}`;
}

/** Áreas em branco por número de casas (cenas com vários mapas precisam de superfície maior que um mapa só). */
export const BLANK_PRESETS = Object.freeze([[30, 20], [40, 30], [60, 40]]);

/**
 * Superfície em branco de `cols × rows` casas: lado da casa até 70 px, limitado pelos 4.096 px por lado e 8 milhões de pixels
 * da imagem e pelas 100 casas por lado / 4.096 casas da grade. → { width, height, gridPixels } ou { error }.
 */
export function blankSurface(cols, rows) {
  const c = Math.trunc(Number(cols)), r = Math.trunc(Number(rows));
  if (!(c >= 8 && c <= 100 && r >= 8 && r <= 100)) return { error: "Use de 8 a 100 casas por lado." };
  if (c * r > 4096) return { error: `A grade aceita até 4.096 casas (${c} × ${r} = ${(c * r).toLocaleString("pt-BR")}).` };
  const px = Math.min(70, Math.floor(4096 / c), Math.floor(4096 / r), Math.floor(Math.sqrt(8_000_000 / (c * r))));
  if (px < 8) return { error: "Casas pequenas demais para essa área." };
  return { width: c * px, height: r * px, gridPixels: px };
}
