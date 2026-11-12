// Regras puras de névoa no cliente: decodificação das máscaras do servidor, alcance destacado e campos de configuração.
// O servidor decide a visibilidade; o cliente só desenha o que recebeu e destaca alcances prováveis.

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
  const taken = new Set(tokens.filter((t) => t.x !== from.x || t.y !== from.y).map((t) => t.x + ":" + t.y));
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

/** Linha entre centros de casas, idêntica a FogGrid.LineClear do servidor (prévia do editor). */
export function lineClear(cells, width, height, x0, y0, x1, y1) {
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
    const r = l.radius;
    for (let y = Math.max(0, l.y - r); y <= Math.min(height - 1, l.y + r); y++)
      for (let x = Math.max(0, l.x - r); x <= Math.min(width - 1, l.x + r); x++) {
        const i = y * width + x;
        if (lit[i] || (x - l.x) ** 2 + (y - l.y) ** 2 > r * r) continue;
        if (lineClear(layer.cells, width, height, l.x, l.y, x, y)) lit[i] = true;
      }
  }
  return encodeBits(lit);
}

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
