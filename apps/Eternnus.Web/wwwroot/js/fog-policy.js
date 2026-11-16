// Regras puras de névoa no cliente: decodificação das máscaras do servidor, alcance destacado e campos de configuração.
// O servidor decide a visibilidade; o cliente só desenha o que recebeu e destaca alcances prováveis.
// Casas ocupadas, inclusive as áreas de criaturas grandes (ADR-092). Mesma conta de token-look.js (takenKeys);
// fica local porque este módulo é carregado sozinho nos testes.
function takenKeys(tokens) {
  const set = new Set();
  for (const t of tokens || []) {
    const span = t?.appearance === "image" && t.width > 0 && t.height > 0;
    const w = span ? Math.max(1, Math.round(t.width / 100)) : 1, h = span ? Math.max(1, Math.round(t.height / 100)) : 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set.add(`${t.x + dx}:${t.y + dy}`);
  }
  return set;
}

/** Conjunto de casas em base64 (bit i = casa i), igual ao servidor. */
export function decodeBits(value, count) {
  const out = new Uint8Array(count);
  if (!value) return out;
  let bin;
  try { bin = atob(value); } catch { return out; }
  for (let i = 0; i < count && (i >> 3) < bin.length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

export function encodeBits(set) {
  if (!set.some(Boolean)) return "";
  const bytes = new Uint8Array((set.length + 7) >> 3);
  set.forEach((on, i) => { if (on) bytes[i >> 3] |= 1 << (i & 7); });
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const CELL = { free: ".", move: "m", light: "l", wall: "#", doorClosed: "d", doorOpen: "o", unknown: "?" };

// ---------- Paredes vetoriais (ADR-087) ----------
// Coordenadas inteiras em centésimos de casa: a casa (x, y) ocupa [100x, 100x+100]; o centro fica em 100x+50.
// Mesmas contas de FogGrid.Crosses no servidor, só com inteiros (resultado idêntico).
export const WALL_UNIT = 100;
export const MAX_WALLS = 2000;
/** Tipos de parede: o texto e o traço distinguem os tipos sem depender de cor. */
export const WALL_KINDS = [
  { id: "wall", label: "Parede", short: "Parede", move: true, sight: true, dash: [], help: "Bloqueia movimento e visão." },
  { id: "door", label: "Porta", short: "Porta", move: true, sight: true, dash: [], help: "Fechada, bloqueia como parede; aberta, deixa passar. Abre e fecha na mesa." },
  { id: "window", label: "Janela", short: "Janela", move: true, sight: false, dash: [2, 3], help: "Bloqueia movimento; luz e visão atravessam." },
  { id: "sight", label: "Bloqueia só visão", short: "Só visão", move: false, sight: true, dash: [8, 4], help: "Cortina ou ilusão: dá para atravessar, mas não para ver através." },
  { id: "move", label: "Bloqueia só movimento", short: "Só movimento", move: true, sight: false, dash: [1, 5], help: "Barreira invisível ou beirada: a visão passa." },
];
const KIND = Object.fromEntries(WALL_KINDS.map((k) => [k.id, k]));
export const wallKind = (id) => KIND[id] || KIND.wall;

/** Bloqueia movimento agora? Aceita parede completa (mestre) ou a forma reduzida do jogador (`door: "open"|"closed"|null`). */
export function wallBlocksMove(w) {
  if (!w) return false;
  if (!w.kind) return w.door !== "open";
  if (w.kind === "door") return !w.open;
  return !!KIND[w.kind]?.move;
}
export function wallBlocksSight(w) {
  if (!w?.kind) return false;
  if (w.kind === "door") return !w.open;
  return !!KIND[w.kind]?.sight;
}

const orient = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

/**
 * A→B atravessa algum segmento? Cruzamento próprio bloqueia; reta passando exatamente por uma ponta de parede bloqueia só
 * quando há parede dos dois lados nessa ponta (junção ou canto fechado). Terminar sobre a parede ou correr ao longo dela não bloqueia.
 */
export function wallsCross(segs, ax, ay, bx, by) {
  let touches = null;
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
  for (const s of segs) {
    if (Math.max(s.x1, s.x2) < minX || Math.min(s.x1, s.x2) > maxX || Math.max(s.y1, s.y2) < minY || Math.min(s.y1, s.y2) > maxY) continue;
    const d1 = orient(ax, ay, bx, by, s.x1, s.y1), d2 = orient(ax, ay, bx, by, s.x2, s.y2);
    if (d1 === d2) continue;
    const d3 = orient(s.x1, s.y1, s.x2, s.y2, ax, ay), d4 = orient(s.x1, s.y1, s.x2, s.y2, bx, by);
    if (d3 === 0 || d4 === 0 || d3 === d4) continue;
    if (d1 !== 0 && d2 !== 0) return true;
    (touches ||= []).push(d1 === 0 ? [s.x1, s.y1, d2] : [s.x2, s.y2, d1]);
  }
  if (!touches) return false;
  for (let i = 0; i < touches.length; i++)
    for (let j = i + 1; j < touches.length; j++)
      if (touches[i][0] === touches[j][0] && touches[i][1] === touches[j][1] && touches[i][2] !== touches[j][2]) return true;
  return false;
}

const prepared = new WeakMap();
/** Separa uma vez as paredes que bloqueiam visão e as que bloqueiam movimento (cache por lista). */
export function wallSets(walls) {
  if (!Array.isArray(walls) || !walls.length) return { sight: [], move: [] };
  let sets = prepared.get(walls);
  if (!sets) prepared.set(walls, (sets = { sight: walls.filter(wallBlocksSight), move: walls.filter(wallBlocksMove) }));
  return sets;
}
const center = (c) => c * WALL_UNIT + WALL_UNIT / 2;
/** Parede que bloqueia movimento entre duas casas vizinhas (passo do caminho). */
export const stepBlocked = (walls, x0, y0, x1, y1) => { const m = wallSets(walls).move; return m.length > 0 && wallsCross(m, center(x0), center(y0), center(x1), center(y1)); };
/** Parede que bloqueia visão entre os centros de duas casas. */
export const sightBlocked = (walls, x0, y0, x1, y1) => { const v = wallSets(walls).sight; return v.length > 0 && wallsCross(v, center(x0), center(y0), center(x1), center(y1)); };
export const blocksMove = (c) => c === "m" || c === "#" || c === "d";
export const blocksLight = (c) => c === "l" || c === "#" || c === "d";

/** Ferramentas de pintura do mestre (mesmos nomes do contrato POST /fog/paint). */
export const FOG_TOOLS = [
  { id: "reveal", icon: "☀", label: "Clarear casas" },
  { id: "conceal", icon: "☾", label: "Escurecer casas" },
  { id: "wall", icon: "▇", label: "Parede (bloqueia movimento e luz)" },
  { id: "blockMove", icon: "⛔", label: "Bloqueia só movimento" },
  { id: "blockLight", icon: "◐", label: "Bloqueia só luz" },
  { id: "door", icon: "🚪", label: "Porta (fechada)" },
  { id: "erase", icon: "⌫", label: "Liberar casa" },
];
/** Ferramentas de clique (uma casa por vez). */
export const FOG_PICKS = [
  { id: "toggleDoor", icon: "⇆", label: "Abrir ou fechar porta" },
  { id: "light", icon: "✹", label: "Foco de luz" },
  { id: "mark", icon: "⚠", label: "Marca oculta" },
];
export const MARK_KINDS = [
  ["trap", "Armadilha", "⚠"],
  ["door", "Porta secreta", "▯"],
  ["clue", "Pista", "✦"],
];

/** Aplica uma pintura localmente (preparação do mapa), espelhando FogEdits.Paint do servidor. */
export function paintLocal(layer, width, tool, cells) {
  const revealed = decodeBits(layer.revealed, width * layer.cells.length);
  const rows = layer.cells.map((r) => r.split(""));
  const char = { wall: "#", blockMove: "m", blockLight: "l", door: "d", erase: "." }[tool];
  for (const { x, y } of cells) {
    if (tool === "reveal") revealed[y * width + x] = 1;
    else if (tool === "conceal") revealed[y * width + x] = 0;
    else if (char) rows[y][x] = char;
  }
  return { ...layer, cells: rows.map((r) => r.join("")), revealed: encodeBits([...revealed].map(Boolean)) };
}

export function toggleDoorLocal(layer, x, y) {
  const c = layer.cells[y]?.[x];
  if (c !== "d" && c !== "o") return null;
  const cells = layer.cells.slice();
  cells[y] = cells[y].slice(0, x) + (c === "d" ? "o" : "d") + cells[y].slice(x + 1);
  return { ...layer, cells };
}

/**
 * Casas destacadas para mover com névoa: caminho por casas conhecidas, livres e desocupadas, dentro do deslocamento,
 * sem cortar canto entre dois bloqueios. Sem névoa, devolve null (usar a regra clássica).
 */
export function fogReach(fog, width, height, tokens, from, squares, pathMovement = true) {
  if (!fog?.active || !fog.cells?.length) return null;
  const known = decodeBits(fog.explored, width * height);
  // Casas ocupadas por outros, inclusive as áreas de criaturas grandes (ADR-092).
  const taken = takenKeys(tokens.filter((t) => t !== from && (t.x !== from.x || t.y !== from.y)));
  const at = (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? fog.cells[y][x] : "#");
  const free = (x, y) => x >= 0 && y >= 0 && x < width && y < height && known[y * width + x] && !blocksMove(at(x, y)) && at(x, y) !== "?" && !taken.has(x + ":" + y);
  const out = [];
  if (!pathMovement) {
    for (let y = from.y - squares; y <= from.y + squares; y++)
      for (let x = from.x - squares; x <= from.x + squares; x++) if ((x !== from.x || y !== from.y) && free(x, y)) out.push({ x, y });
    return out;
  }
  const dist = new Map([[from.x + ":" + from.y, 0]]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift();
    const d = dist.get(c.x + ":" + c.y);
    if (d >= squares) continue;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const x = c.x + ox, y = c.y + oy, key = x + ":" + y;
        if (dist.has(key) || !free(x, y)) continue;
        if (ox && oy && blocksMove(at(c.x + ox, c.y)) && blocksMove(at(c.x, c.y + oy))) continue;
        if (stepBlocked(fog.walls, c.x, c.y, x, y)) continue;
        dist.set(key, d + 1);
        out.push({ x, y });
        queue.push({ x, y });
      }
  }
  return out;
}

/**
 * Área do alcance de ataque no turno: casas a até `squares` (diagonal 1, como o deslocamento) da posição atual.
 * Só informativa: o mestre decide o efeito. Sem alcance definido na ficha, devolve [] (o mestre informa verbalmente).
 */
export function attackCells(width, height, from, squares) {
  if (!from || !(squares > 0)) return [];
  const out = [];
  for (let y = Math.max(0, from.y - squares); y <= Math.min(height - 1, from.y + squares); y++)
    for (let x = Math.max(0, from.x - squares); x <= Math.min(width - 1, from.x + squares); x++)
      if (x !== from.x || y !== from.y) out.push({ x, y });
  return out;
}

/** Linha entre centros de casas, idêntica a FogGrid.LineClear do servidor (prévia do editor). `walls`: paredes vetoriais. */
export function lineClear(cells, width, height, x0, y0, x1, y1, walls = null) {
  if (!cellLineClear(cells, width, height, x0, y0, x1, y1)) return false;
  return !sightBlocked(walls, x0, y0, x1, y1);
}

function cellLineClear(cells, width, height, x0, y0, x1, y1) {
  const solid = (x, y) => x < 0 || y < 0 || x >= width || y >= height || blocksLight(cells[y][x]);
  const nx = Math.abs(x1 - x0), ny = Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
    const cmp = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (cmp === 0) {
      if (solid(x + sx, y) && solid(x, y + sy)) return false;
      x += sx; y += sy; ix++; iy++;
    } else if (cmp < 0) { x += sx; ix++; }
    else { y += sy; iy++; }
    if ((x !== x1 || y !== y1) && solid(x, y)) return false;
  }
  return true;
}

/** Casas iluminadas pelos focos + reveladas (prévia do mestre na preparação). Devolve base64 como o servidor. */
export function sharedPreview(layer, width, height) {
  const lit = [...decodeBits(layer.revealed, width * height)].map(Boolean);
  for (const l of layer.lights || []) {
    const r = lightReach(l);
    for (let y = Math.max(0, l.y - r); y <= Math.min(height - 1, l.y + r); y++)
      for (let x = Math.max(0, l.x - r); x <= Math.min(width - 1, l.x + r); x++) {
        const i = y * width + x;
        if (lit[i] || (x - l.x) ** 2 + (y - l.y) ** 2 > r * r) continue;
        if (lineClear(layer.cells, width, height, l.x, l.y, x, y, layer.walls)) lit[i] = true;
      }
  }
  return encodeBits(lit);
}

/** Alcance de um foco para as regras: luz plena ou penumbra, o maior (FogLight.Reach). */
export const lightReach = (l) => Math.max(l?.radius || 0, l?.dim || 0);

/** Campos da configuração da mesa (mesmos nomes de TableSettings no servidor). */
export const SETTING_FIELDS = [
  { key: "playMode", type: "choice", label: "Forma de jogar", help: "A sessão guarda a forma com que começou; mudar aqui na mesa vale a partir de agora.",
    options: [["free", "Livre — ações sem turnos"], ["turns", "Por turnos — o mestre concede a vez"], ["tactical", "Tática — turnos, grade e deslocamento"]], fallback: "tactical" },
  { key: "playerRollVisibility", type: "choice", label: "Quem vê as rolagens dos jogadores", help: "Jogadores não escolhem; vale para todas as rolagens deles.",
    options: [["table", "Mesa inteira"], ["master", "Quem rolou e o mestre"], ["blind", "Somente o mestre (quem rolou não vê)"]], fallback: "table" },
  { key: "moveNeedsGrant", type: "bool", label: "Movimento só com liberação do mestre", help: "O jogador move o próprio personagem depois que você libera o movimento na vez dele. Trocar a vez bloqueia de novo." },
  { key: "fogEnabled", type: "bool", label: "Névoa ativa", help: "Jogadores veem só o que luz, visão e o mestre revelam." },
  { key: "manualReveal", type: "bool", label: "Revelação manual", help: "Com névoa, só aparece o que você revelar; luz e visão não revelam sozinhas." },
  { key: "rememberExplored", type: "bool", label: "Lembrar áreas exploradas", help: "Casas já vistas ficam atenuadas, sem mostrar criaturas." },
  { key: "pathMovement", type: "bool", label: "Movimento por caminho livre", help: "Com névoa, o jogador contorna paredes e portas fechadas." },
  { key: "alliesAlwaysVisible", type: "bool", label: "Aliados sempre visíveis", help: "Criaturas aliadas aparecem ao grupo mesmo no escuro." },
  { key: "torchRadius", type: "int", min: 0, max: 30, label: "Raio das tochas (casas)", help: "Tochas dos cenários oficiais." },
  { key: "brazierRadius", type: "int", min: 0, max: 30, label: "Raio dos braseiros (casas)", help: "Braseiros dos cenários oficiais." },
  { key: "creatureLight", type: "int", min: 0, max: 30, label: "Luz padrão das criaturas (casas)", help: "O mestre ajusta cada marcador." },
  { key: "playerLightMeters", type: "int", min: 0, max: 300, label: "Luz padrão dos personagens (m)", help: "Quando o modelo de ficha não tem o papel Luz." },
  { key: "playerVisionMeters", type: "int", min: 0, max: 300, label: "Visão padrão dos personagens (m)", help: "Quando o modelo de ficha não tem o papel Visão." },
];

/** Converte os valores de um formulário (FormData → objeto) em configuração validada no cliente. */
export function settingsFromForm(data) {
  const out = {};
  for (const f of SETTING_FIELDS) {
    if (f.type === "bool") out[f.key] = data[f.key] === "on" || data[f.key] === true;
    else if (f.type === "choice") out[f.key] = f.options.some(([v]) => v === data[f.key]) ? data[f.key] : f.fallback;
    else {
      const n = Math.round(Number(data[f.key]));
      if (!Number.isFinite(n) || n < f.min || n > f.max) throw new Error(`${f.label}: use um valor de ${f.min} a ${f.max}.`);
      out[f.key] = n;
    }
  }
  return out;
}

/** Normaliza nomes vindos do servidor (camelCase ou PascalCase). */
export function normalizeSettings(raw = {}) {
  const out = {};
  for (const f of SETTING_FIELDS) {
    const pascal = f.key[0].toUpperCase() + f.key.slice(1);
    out[f.key] = raw[f.key] ?? raw[pascal];
  }
  return out;
}
