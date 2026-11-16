// Regras puras do rascunho de mapas de tiles; o servidor valida novamente ao salvar.
// Camadas (ADR-081): Base = terreno (todas as casas preenchidas); Elementos e extras usam "_" para casa vazia.
// A grade efetiva (regras, passagem, entradas) é a fusão: em cada casa vale a camada visível mais alta não vazia; a Base sempre entra.

/** Código de casa vazia fora da Base. */
export const EMPTY = "_";
/** Código neutro usado só na exibição do editor quando a Base está oculta. */
export const HIDDEN = "?";
export const MIN_SIDE = 8, MAX_SIDE = 64, MIN_SPAWNS = 6;
const TERRAIN_GROUP = "Terrenos";

export function blankTiles(width = 28, height = 20, ground = ",") {
  const rows = Array.from({ length: height }, () => ground.repeat(width));
  for (let y = height - 3; y < height - 1; y++) rows[y] = rows[y].slice(0, 1) + "SSS" + rows[y].slice(4);
  return rows;
}
/** Redimensionamento simples ancorado no canto superior esquerdo (compatibilidade). */
export function resizeTiles(rows, width, height, ground) {
  return Array.from({ length: height }, (_, y) => ((rows[y] || "") + ground.repeat(width)).slice(0, width));
}
export function paintTiles(rows, cells, code, tool = "brush") {
  if (!cells.length) return rows;
  const width = rows[0].length, height = rows.length, copy = rows.map(r => [...r]);
  const inside = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  const points = cells.filter(inside);
  if (!points.length) return rows;
  if (tool === "fill") {
    const from = copy[points[0].y][points[0].x];
    if (from === code) return rows;
    const queue = [points[0]];
    while (queue.length) {
      const p = queue.pop();
      if (!inside(p) || copy[p.y][p.x] !== from) continue;
      copy[p.y][p.x] = code;
      queue.push({x:p.x-1,y:p.y},{x:p.x+1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1});
    }
  } else if (tool === "rectangle") {
    const a = points[0], b = points.at(-1);
    for (let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)
      for (let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++) copy[y][x]=code;
  } else for (const {x,y} of points) copy[y][x]=code;
  return copy.map(r=>r.join(""));
}
export function tileMapError(rows, catalog) {
  if (!Array.isArray(rows) || rows.length < MIN_SIDE || rows.length > MAX_SIDE || rows.some(r=>typeof r!=="string" || r.length<MIN_SIDE || r.length>MAX_SIDE || r.length!==rows[0].length)) return "Use de 8 a 64 casas por lado.";
  const codes = new Set(catalog.map(t=>t.code));
  if (rows.some(r=>[...r].some(c=>!codes.has(c)))) return "O mapa contém tiles fora do catálogo.";
  if (countSpawns(rows) < MIN_SPAWNS) return "Marque pelo menos seis entradas livres para o grupo.";
  return "";
}

/** Quantidade de entradas do grupo ("S") numa grade. */
export const countSpawns = (rows) => (rows || []).reduce((n, r) => n + (r.split("S").length - 1), 0);

/** Texto da regra de passagem/visão de um tile do catálogo. */
export function tileRule(tile) {
  if (!tile) return "casa vazia";
  return tile.walkable ? "passagem livre" : tile.blocksSight ? "bloqueia passagem e visão" : "bloqueia passagem";
}

/** Grade vazia ("_") do tamanho pedido. */
export function emptyRows(width, height) {
  return Array.from({ length: height }, () => EMPTY.repeat(width));
}

const isBase = (layer) => layer?.id === "base" || layer?.kind === "base";

/**
 * Camadas prontas para edição: cada uma com `rows` do tamanho da Base. Base inválida usa `fallback`;
 * extras de outro tamanho ficam vazias. Não altera a ordem nem os metadados.
 */
export function fitLayerRows(layers, fallback) {
  const base = layers.find(isBase);
  const valid = (rows) => Array.isArray(rows) && rows.length >= MIN_SIDE && rows.every((r) => typeof r === "string" && r.length === rows[0].length && r.length >= MIN_SIDE);
  const baseRows = valid(base?.rows) && !base.rows.some((r) => r.includes(EMPTY)) ? [...base.rows] : [...fallback];
  const width = baseRows[0].length, height = baseRows.length;
  return layers.map((l) => {
    if (isBase(l)) return { ...l, rows: baseRows };
    const ok = Array.isArray(l.rows) && l.rows.length === height && l.rows.every((r) => typeof r === "string" && r.length === width);
    return { ...l, rows: ok ? [...l.rows] : emptyRows(width, height) };
  });
}

/**
 * Fusão das camadas (de baixo para cima). Fora da Base, só camadas visíveis e casas não vazias contam.
 * `hideBase` (só exibição no editor): a Base vira `HIDDEN` onde nada a cobre; as regras sempre usam `hideBase = false`.
 */
export function mergeLayers(layers, { hideBase = false } = {}) {
  const base = layers.find(isBase);
  if (!base?.rows?.length) return [];
  const cells = base.rows.map((r) => (hideBase ? HIDDEN.repeat(r.length) : r).split(""));
  for (const layer of layers) {
    if (isBase(layer) || layer.visible === false || !layer.rows) continue;
    layer.rows.forEach((row, y) => {
      if (!cells[y]) return;
      for (let x = 0; x < row.length && x < cells[y].length; x++) if (row[x] !== EMPTY) cells[y][x] = row[x];
    });
  }
  return cells.map((r) => r.join(""));
}

/**
 * Camada que recebe um tile. Com "Camada automática": terrenos vão para a Base e os demais (natureza, construções,
 * objetos, entradas) para Elementos. Sem ela, ou com uma camada extra ativa, vale a camada ativa.
 */
export function layerForTile(tile, { auto = true, active = "elements", layers = [] } = {}) {
  const current = layers.find((l) => l.id === active);
  if (!auto || (current && !isBase(current) && current.id !== "elements")) return active;
  return tile?.group === TERRAIN_GROUP ? "base" : "elements";
}

/**
 * Pinta uma camada. Ferramentas: brush | rectangle | fill | erase | erase-rectangle | erase-fill.
 * Apagar na Base pinta o piso `ground` (a Base nunca fica vazia); nas outras camadas grava "_".
 * O preenchimento usa a região ligada do mesmo código NA PRÓPRIA camada.
 */
export function paintLayer(rows, cells, code, tool = "brush", { base = false, ground = "," } = {}) {
  const erasing = tool.startsWith("erase");
  const value = erasing ? (base ? ground : EMPTY) : code;
  const shape = tool === "erase" ? "brush" : erasing ? tool.slice(6) : tool;
  if (!value || (base && value === EMPTY)) return rows;
  return paintTiles(rows, cells, value, shape);
}

/**
 * Borracha automática: em cada casa apaga a camada visível mais alta (fora a Base) que tenha conteúdo; sem nenhuma,
 * a Base recebe o piso. Casas cuja camada de cima está bloqueada ficam como estão e são contadas em `skipped`.
 */
export function eraseTopmost(layers, cells, ground = ",") {
  const next = layers.map((l) => ({ ...l, rows: l.rows.map((r) => r.split("")) }));
  let skipped = 0, changed = false;
  const height = next[0]?.rows.length || 0, width = next[0]?.rows[0]?.length || 0;
  for (const { x, y } of cells) {
    if (!(x >= 0 && y >= 0 && x < width && y < height)) continue;
    const top = [...next].reverse().find((l) => !isBase(l) && l.visible !== false && l.rows[y][x] !== EMPTY) || next.find(isBase);
    if (top.locked) { skipped++; continue; }
    const value = isBase(top) ? ground : EMPTY;
    if (top.rows[y][x] !== value) { top.rows[y][x] = value; changed = true; }
  }
  return { layers: changed ? next.map((l) => ({ ...l, rows: l.rows.map((r) => r.join("")) })) : layers, skipped };
}

/** Pilha de uma casa, da camada mais alta para a Base: [{ id, name, code, visible, locked }]. */
export function cellStack(layers, x, y) {
  return [...layers].reverse().map((l) => ({ id: l.id, name: l.name, code: l.rows?.[y]?.[x] ?? EMPTY, visible: l.visible !== false, locked: !!l.locked, base: isBase(l) }));
}

/** Camada visível mais alta com conteúdo na casa (a Base quando nada a cobre). */
export function topLayerAt(layers, x, y) {
  return [...layers].reverse().find((l) => !isBase(l) && l.visible !== false && l.rows?.[y]?.[x] && l.rows[y][x] !== EMPTY) || layers.find(isBase);
}

/** Âncoras do redimensionamento (posição do conteúdo atual na nova grade). */
export const ANCHORS = Object.freeze([
  ["tl", "Superior esquerda", 0, 0], ["t", "Superior centro", .5, 0], ["tr", "Superior direita", 1, 0],
  ["l", "Centro esquerda", 0, .5], ["c", "Centro", .5, .5], ["r", "Centro direita", 1, .5],
  ["bl", "Inferior esquerda", 0, 1], ["b", "Inferior centro", .5, 1], ["br", "Inferior direita", 1, 1],
]);
/** Deslocamento (dx, dy) do conteúdo antigo dentro da nova grade para a âncora escolhida. */
export function anchorOffset(oldWidth, oldHeight, width, height, anchor = "tl") {
  const [, , ax, ay] = ANCHORS.find((a) => a[0] === anchor) || ANCHORS[0];
  return { dx: Math.floor((width - oldWidth) * ax), dy: Math.floor((height - oldHeight) * ay) };
}

function shiftRows(rows, width, height, dx, dy, fill) {
  return Array.from({ length: height }, (_, y) => {
    const source = rows[y - dy];
    let line = "";
    for (let x = 0; x < width; x++) line += source?.[x - dx] ?? fill;
    return line;
  });
}

/** Redimensiona/recorta todas as camadas com âncora. Casas novas: piso `ground` na Base, "_" nas demais. */
export function resizeLayers(layers, width, height, anchor = "tl", ground = ",") {
  const base = layers.find(isBase);
  const { dx, dy } = anchorOffset(base.rows[0].length, base.rows.length, width, height, anchor);
  return layers.map((l) => ({ ...l, rows: shiftRows(l.rows, width, height, dx, dy, isBase(l) ? ground : EMPTY) }));
}

/** Casas com conteúdo (fora da Base) e entradas que ficariam fora da nova grade. */
export function resizeLoss(layers, width, height, anchor = "tl") {
  const base = layers.find(isBase);
  const { dx, dy } = anchorOffset(base.rows[0].length, base.rows.length, width, height, anchor);
  let cells = 0, spawns = 0;
  for (const l of layers) l.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) continue;
      if (!isBase(l) && row[x] !== EMPTY) cells++;
      if (row[x] === "S") spawns++;
    }
  });
  const removed = Math.max(0, base.rows[0].length - width) + Math.max(0, base.rows.length - height);
  return { cells, spawns, shrinks: removed > 0 };
}

/** Retângulo normalizado entre duas casas: { x, y, w, h }. */
export function rectBetween(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
/** Casas de um retângulo (limitado à grade quando `width/height` são dados). */
export function rectCells(rect, width = Infinity, height = Infinity) {
  const cells = [];
  for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.h); y++)
    for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.w); x++) cells.push({ x, y });
  return cells;
}
/** Recorte de uma camada (área de transferência): linhas do retângulo. */
export function copyRegion(rows, rect) {
  return rows.slice(rect.y, rect.y + rect.h).map((r) => r.slice(rect.x, rect.x + rect.w));
}
/** Cola um recorte com o canto superior esquerdo em `at`; "_" do recorte não sobrescreve; o que sai da grade é ignorado. */
export function pasteRegion(rows, clip, at, { base = false } = {}) {
  const copy = rows.map((r) => r.split(""));
  clip.forEach((line, cy) => {
    for (let cx = 0; cx < line.length; cx++) {
      const x = at.x + cx, y = at.y + cy, c = line[cx];
      if (c === EMPTY || !copy[y] || x < 0 || x >= copy[y].length) continue;
      if (base && c === HIDDEN) continue;
      copy[y][x] = c;
    }
  });
  return copy.map((r) => r.join(""));
}

/** Terreno mais frequente da Base que pertence ao grupo de terrenos e é transitável (piso padrão da borracha). */
export function dominantGround(rows, catalog, fallback = ",") {
  const ok = new Set(catalog.filter((t) => t.group === TERRAIN_GROUP && t.walkable).map((t) => t.code));
  const count = new Map();
  for (const r of rows || []) for (const c of r) if (ok.has(c)) count.set(c, (count.get(c) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || (ok.has(fallback) ? fallback : [...ok][0] || fallback);
}

/** Escala válida: 0,01–1.000 metros com até duas casas decimais. */
export const validScale = (v) => Number.isFinite(v) && v >= .01 && v <= 1000 && Math.round(v * 100) / 100 === v;
