// Regras puras para trazer mapas à mesa: imagem solta (grade sugerida) e arquivos Universal VTT
// (.dd2vtt do Dungeondraft, .uvtt, .df2vtt). Sem DOM: o navegador decodifica e envia em map-import.js.
// A camada de névoa da mesa é por casas; paredes do UVTT são linhas, então a conversão é aproximada e o mestre ajusta depois.

/** Limites de imagem do servidor (CampaignAssetsService.Normalize) e da grade (CampaignMapView.Grid). */
export const IMAGE_LIMITS = Object.freeze({ maxSide: 4096, maxPixels: 8_000_000, minSide: 64, maxBytes: 10 * 1024 * 1024, maxCells: 4096, maxCellsSide: 100 });
export const UVTT_EXTENSIONS = Object.freeze([".dd2vtt", ".uvtt", ".df2vtt"]);
/** Arquivo UVTT aceito para leitura (a imagem embutida costuma ser grande). */
export const MAX_UVTT_BYTES = 60 * 1024 * 1024;
export const MAX_LIGHTS = 100;

export const isUvttName = (name) => UVTT_EXTENSIONS.some((ext) => String(name || "").toLowerCase().endsWith(ext));
export const isImageType = (type) => ["image/png", "image/jpeg", "image/webp"].includes(type);

/** Nome do mapa a partir do arquivo: sem extensão, sem separadores, até 120 caracteres. */
export function mapNameFrom(fileName) {
  const base = String(fileName || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Mapa da mesa").slice(0, 120);
}

/** Tipo real da imagem pelos primeiros bytes (não pela extensão). */
export function imageKind(bytes) {
  const b = bytes || [];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Escala que coloca a imagem dentro dos limites do servidor (1 = não precisa reduzir). */
export function fitScale(width, height, limits = IMAGE_LIMITS) {
  if (!(width > 0 && height > 0)) return 1;
  return Math.min(1, limits.maxSide / width, limits.maxSide / height, Math.sqrt(limits.maxPixels / (width * height)));
}

/**
 * Reduz uma imagem com grade conhecida mantendo o quadrado inteiro em pixels (senão a grade escorrega).
 * Devolve o novo tamanho do quadrado e da imagem; erro se o quadrado ficaria menor que 8 px.
 */
export function scaledGrid(pixelsPerGrid, cellsX, cellsY, limits = IMAGE_LIMITS) {
  const ppg = Math.round(Number(pixelsPerGrid));
  if (!(ppg >= 1) || !(cellsX >= 1) || !(cellsY >= 1)) throw new Error("O arquivo não informa a grade do mapa.");
  if (cellsX > limits.maxCellsSide || cellsY > limits.maxCellsSide || cellsX * cellsY > limits.maxCells)
    throw new Error(`O mapa tem ${cellsX} × ${cellsY} casas. A mesa aceita até ${limits.maxCellsSide} por lado e ${limits.maxCells.toLocaleString("pt-BR")} casas.`);
  const scale = fitScale(cellsX * ppg, cellsY * ppg, limits);
  const gridPixels = Math.min(ppg, Math.floor(ppg * scale));
  if (gridPixels < 8) throw new Error("O mapa é grande demais para manter a grade legível. Exporte com menos pixels por quadrado ou em partes.");
  return { gridPixels, width: cellsX * gridPixels, height: cellsY * gridPixels, scaled: gridPixels !== ppg };
}

/**
 * Grade sugerida para uma imagem solta: um tamanho de quadrado comum que divida a imagem;
 * senão, cerca de 24 casas no lado maior. Sempre dentro dos limites de casas da mesa.
 */
export function guessGridPixels(width, height, limits = IMAGE_LIMITS) {
  const fits = (s) => s >= 8 && s <= Math.min(width, height) && Math.floor(width / s) <= limits.maxCellsSide && Math.floor(height / s) <= limits.maxCellsSide && Math.floor(width / s) * Math.floor(height / s) <= limits.maxCells;
  for (const s of [140, 128, 100, 70, 64, 50]) if (width % s === 0 && height % s === 0 && Math.min(width, height) / s >= 4 && fits(s)) return s;
  let s = Math.max(8, Math.round(Math.max(width, height) / 24));
  while (!fits(s) && s < Math.min(width, height)) s++;
  return Math.min(s, Math.max(8, Math.min(width, height)));
}

const point = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);

/** Lê o JSON do Universal VTT (formatos 0.2/0.3). Coordenadas em casas, relativas à origem do mapa. */
export function parseUvtt(json) {
  if (!json || typeof json !== "object") throw new Error("Arquivo UVTT inválido.");
  const res = json.resolution || {};
  const origin = point(res.map_origin) || { x: 0, y: 0 };
  const size = point(res.map_size);
  const ppg = Number(res.pixels_per_grid);
  if (!size || !(size.x >= 1) || !(size.y >= 1) || !(ppg >= 1)) throw new Error("O arquivo não informa tamanho e grade do mapa (resolution).");
  if (typeof json.image !== "string" || json.image.length < 16) throw new Error("O arquivo não traz a imagem do mapa. Exporte de novo com a imagem incluída.");
  const rel = (p) => { const q = point(p); return q ? { x: q.x - origin.x, y: q.y - origin.y } : null; };
  const line = (list) => (Array.isArray(list) ? list.map(rel).filter(Boolean) : []);
  const walls = [...(json.line_of_sight || []), ...(json.objects_line_of_sight || [])].map(line).filter((l) => l.length >= 2);
  const portals = (json.portals || []).map((p) => {
    const b = Array.isArray(p?.bounds) ? p.bounds.map(rel).filter(Boolean) : [];
    return b.length >= 2 ? { a: b[0], b: b[1], closed: p.closed !== false } : null;
  }).filter(Boolean);
  const lights = (json.lights || []).map((l) => { const at = rel(l?.position); return at ? { ...at, range: Number(l.range) || 0 } : null; }).filter(Boolean);
  return { pixelsPerGrid: ppg, cellsX: Math.floor(size.x), cellsY: Math.floor(size.y), walls, portals, lights, image: json.image.replace(/^data:[^,]*,/, "") };
}

/** Polígonos fechados (salas) entre as linhas de parede: decidem o lado "de fora" de cada parede. */
function closedLoops(walls) {
  return walls.filter((l) => l.length >= 4 && Math.hypot(l[0].x - l[l.length - 1].x, l[0].y - l[l.length - 1].y) < 0.01);
}
function insideCount(loops, x, y) {
  let count = 0;
  for (const poly of loops) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) count++;
  }
  return count;
}

/**
 * Casas tocadas por um segmento. Sobre uma linha da grade, a parede separa duas casas: marca a que fica
 * "mais para fora" (dentro de menos salas); empate escolhe a da direita/de baixo. Linhas na borda do mapa não marcam nada.
 */
function segmentCells(a, b, width, height, depth) {
  const out = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / 0.1));
  const EPS = 0.08;
  for (let i = 0; i <= steps; i++) {
    const px = a.x + ((b.x - a.x) * i) / steps, py = a.y + ((b.y - a.y) * i) / steps;
    const nx = Math.round(px), ny = Math.round(py);
    const onV = Math.abs(px - nx) < EPS, onH = Math.abs(py - ny) < EPS;
    if (onV && onH) continue; // vértice da grade: as casas vizinhas vêm das amostras ao lado
    let options;
    if (onV) options = [{ x: nx - 1, y: Math.floor(py) }, { x: nx, y: Math.floor(py) }];
    else if (onH) options = [{ x: Math.floor(px), y: ny - 1 }, { x: Math.floor(px), y: ny }];
    else options = [{ x: Math.floor(px), y: Math.floor(py) }];
    const inside = options.filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height);
    if (inside.length !== options.length) continue;
    if (options.length === 1) { out.push(options[0]); continue; }
    const [d0, d1] = options.map((c) => depth(c.x, c.y));
    out.push(d0 < d1 ? options[0] : options[1]);
  }
  return out;
}

/**
 * Converte paredes, portas e luzes do UVTT para a camada da mesa (mesma legenda de TableFog):
 * `#` parede, `d` porta fechada, `o` porta aberta. Mantém marcas já existentes nas casas não tocadas.
 */
export function uvttLayer(parsed, width, height, baseCells = []) {
  const rows = Array.from({ length: height }, (_, y) => {
    const r = String(baseCells[y] || "").padEnd(width, ".").slice(0, width).split("");
    return r.map((c) => (".mld#o".includes(c) ? c : "."));
  });
  const loops = closedLoops(parsed.walls);
  const cache = new Map();
  const depth = (x, y) => {
    const k = y * width + x;
    if (!cache.has(k)) cache.set(k, insideCount(loops, x + 0.5, y + 0.5));
    return cache.get(k);
  };
  const walls = new Set(), doors = new Set();
  for (const line of parsed.walls)
    for (let i = 1; i < line.length; i++)
      for (const c of segmentCells(line[i - 1], line[i], width, height, depth)) { rows[c.y][c.x] = "#"; walls.add(c.y * width + c.x); }
  for (const p of parsed.portals)
    for (const c of segmentCells(p.a, p.b, width, height, depth)) { rows[c.y][c.x] = p.closed ? "d" : "o"; doors.add(c.y * width + c.x); walls.delete(c.y * width + c.x); }
  const seen = new Set(), lights = [];
  for (const l of parsed.lights) {
    const x = Math.floor(l.x), y = Math.floor(l.y);
    if (x < 0 || y < 0 || x >= width || y >= height || seen.has(y * width + x)) continue;
    seen.add(y * width + x);
    if (lights.length < MAX_LIGHTS) lights.push({ x, y, radius: Math.max(1, Math.min(30, Math.round(l.range) || 1)) });
  }
  return {
    cells: rows.map((r) => r.join("")),
    lights,
    counts: { walls: walls.size, doors: doors.size, lights: lights.length, skippedLights: Math.max(0, seen.size - lights.length) },
  };
}
