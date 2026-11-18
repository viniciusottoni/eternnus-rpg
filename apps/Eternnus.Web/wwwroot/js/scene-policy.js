import { decodeBits, encodeBits, lineClear, lightReach } from "./fog-policy.js";
import { ensureLayers } from "./editor-policy.js";
import { takenKeys, tokenSpan } from "./token-look.js";

// Regras puras do editor de cenas e da mesa do mestre: apresentação Básica/Completa, inventário de ferramentas,
// seletor de cenários, grade, visibilidade e estados de preparação. Sem DOM nem HTTP; o servidor sempre decide.

/** Interface: só apresentação das ferramentas. Não muda regras (Livre/Turnos/Tática) nem visibilidade. */
export const INTERFACE_MODES = Object.freeze([
  ["basic", "Básica", "Mostra o essencial para preparar e conduzir."],
  ["complete", "Completa", "Mostra todas as ferramentas, organizadas por grupo."],
]);
export const normalizeInterface = (value) => (value === "complete" ? "complete" : "basic");

/** Grupos da interface Completa (mesma ordem no editor e na mesa). */
export const TOOL_GROUPS = Object.freeze([
  ["elements", "Elementos"],
  ["walls", "Paredes e portas"],
  ["light", "Luz e visão"],
  ["explore", "Exploração"],
  ["grid", "Grade e escala"],
  ["scene", "Configuração da cena"],
]);

/**
 * Inventário das ferramentas existentes e de onde ficam em cada apresentação.
 * `where`: "editor", "table" ou ambos. `basic`: true quando aparece na Básica. Nenhuma ferramenta some na Completa.
 */
export const TOOL_INVENTORY = Object.freeze([
  { id: "select", label: "Selecionar e mover", group: "elements", basic: true, where: ["editor", "table"] },
  { id: "add", label: "Adicionar personagem ou marcador", group: "elements", basic: true, where: ["editor", "table"] },
  { id: "npc", label: "Personagens do mestre e cópias de encontro", group: "elements", basic: true, where: ["editor", "table"] },
  { id: "hide", label: "Mostrar ou ocultar elemento", group: "elements", basic: true, where: ["editor", "table"] },
  { id: "gather", label: "Colocar o grupo na entrada", group: "elements", basic: true, where: ["table"] },
  { id: "remove", label: "Remover marcador", group: "elements", basic: true, where: ["editor", "table"] },
  { id: "tokenSenses", label: "Luz, visão, sentidos e detecção do marcador", group: "light", basic: false, where: ["table"] },
  { id: "wall", label: "Parede", group: "walls", basic: false, where: ["editor", "table"] },
  { id: "blockMove", label: "Bloqueia só movimento", group: "walls", basic: false, where: ["editor", "table"] },
  { id: "blockLight", label: "Bloqueia só luz", group: "walls", basic: false, where: ["editor", "table"] },
  { id: "door", label: "Porta", group: "walls", basic: false, where: ["editor", "table"] },
  { id: "toggleDoor", label: "Abrir ou fechar porta", group: "walls", basic: false, where: ["editor", "table"] },
  { id: "erase", label: "Liberar casa", group: "walls", basic: false, where: ["editor", "table"] },
  { id: "light", label: "Foco de luz", group: "light", basic: false, where: ["editor", "table"] },
  { id: "fogState", label: "Névoa neste mapa", group: "light", basic: false, where: ["editor", "table"] },
  { id: "visibility", label: "Visibilidade", group: "explore", basic: true, where: ["editor"] },
  { id: "reveal", label: "Revelar área", group: "explore", basic: true, where: ["editor", "table"] },
  { id: "conceal", label: "Cobrir área", group: "explore", basic: true, where: ["editor", "table"] },
  { id: "mark", label: "Marca oculta e formas de revelação", group: "explore", basic: false, where: ["editor", "table"] },
  { id: "resetExploration", label: "Recomeçar exploração", group: "explore", basic: false, where: ["editor", "table"] },
  { id: "viewAs", label: "Ver como jogador", group: "explore", basic: true, where: ["editor", "table"] },
  { id: "gridToggle", label: "Mostrar ou ocultar a grade", group: "grid", basic: false, where: ["editor", "table"] },
  { id: "gridAdjust", label: "Ajustar grade e escala do mapa", group: "grid", basic: false, where: ["editor"] },
  { id: "scenery", label: "Escolher cenário", group: "scene", basic: true, where: ["editor"] },
  { id: "text", label: "Texto compartilhável", group: "scene", basic: true, where: ["editor"] },
  { id: "notes", label: "Notas privadas", group: "scene", basic: true, where: ["editor"] },
  { id: "sceneSettings", label: "Tipo, ordem, descrição e alcance da preparação", group: "scene", basic: false, where: ["editor"] },
  { id: "tableSettings", label: "Configuração da mesa", group: "scene", basic: false, where: ["table"] },
  { id: "captureArrangement", label: "Guardar posições atuais como arranjo inicial", group: "elements", basic: false, where: ["table"] },
]);

/**
 * Orçamento da interface Básica por local (ADR-100, regra G1). Uma ferramenta nova na Básica que ultrapasse o número
 * exige ADR justificando o aumento; o teste de scene-policy falha antes disso.
 */
export const BASIC_BUDGET = Object.freeze({ editor: 12, table: 9 });

/** Ferramentas visíveis numa apresentação. A Completa sempre inclui todas as da Básica (mesmos nomes e ordem). */
export function toolsFor(mode, where) {
  const list = TOOL_INVENTORY.filter((t) => t.where.includes(where));
  return normalizeInterface(mode) === "complete" ? list : list.filter((t) => t.basic);
}

export const toolLabel = (id) => TOOL_INVENTORY.find((t) => t.id === id)?.label || id;

/** Visibilidade da cena com explicação curta e honesta sobre o que o servidor aplica. */
export const VISIBILITY_OPTIONS = Object.freeze([
  ["", "Seguir a configuração da mesa", "Usa o que a campanha definiu para névoa."],
  ["all", "Tudo visível", "Sem névoa: o grupo vê o mapa inteiro."],
  ["manual", "Revelação manual", "Você escolhe quais partes o grupo pode ver."],
  ["character", "Visão por personagem", "Cada um vê pela luz e pela visão do próprio personagem."],
]);

/** Ajuda contextual da interface Básica (sem presumir regras de um RPG específico). */
export const HELP = Object.freeze({
  select: "Selecionar e mover: clique num marcador e depois na casa de destino, ou arraste.",
  add: "Adicionar: clique numa casa livre para colocar um personagem ou um marcador.",
  reveal: "Revelar área: arraste sobre as casas que o grupo passa a ver.",
  conceal: "Cobrir área: retira uma revelação manual. Casas ainda iluminadas ou vistas por um personagem continuam visíveis, e o que alguém já viu não é apagado da memória dele.",
  wall: "Parede: impede passagem e bloqueia a visão.",
  blockMove: "Bloqueia só movimento: ninguém passa, mas a luz atravessa.",
  blockLight: "Bloqueia só luz: dá para passar, mas não dá para ver através.",
  door: "Porta: fechada bloqueia passagem e visão; aberta libera as duas.",
  light: "Foco de luz: ilumina em círculo e para nas paredes.",
  mark: "Marca oculta: armadilha, porta secreta ou pista que só aparece quando revelada.",
  notes: "Nota privada: este texto não aparece para os jogadores.",
  text: "Texto compartilhável: aparece para o grupo quando a cena for apresentada ou quando você aplicar a alteração.",
  resume: "Retomar: continua com o estado salvo da última visita.",
  restart: "Reiniciar: volta ao arranjo e ao mapa preparados e recomeça a exploração.",
  preview: "Simulação com as regras da mesa: luz, áreas reveladas e a visão da ficha do personagem escolhido. Não inclui sentidos especiais, Percepção nem o que o grupo já explorou na partida; a visão exata de um jogador fica em “Ver como” na mesa.",
});

/** Tipos de cena em linguagem simples. */
export const SCENE_KINDS = Object.freeze([
  ["map", "Mapa tático", "Com grade (personagens andam por casas) ou com movimentação livre (em qualquer ponto), conforme o mapa; dá para usar paredes, luz e névoa."],
  ["image", "Imagem sem grade", "Uma imagem para o grupo ver, sem casas nem movimento."],
  ["text", "Apresentação textual", "Só o texto da cena, sem trocar o mapa."],
]);
export const sceneKindLabel = (kind) => (SCENE_KINDS.find((k) => k[0] === kind) || SCENE_KINDS[0])[1];

/** Tipo do cenário explicado para quem não conhece o termo técnico. */
export function mapTypeLabel(map) {
  if (!map) return "";
  if (map.isTileMap) return "Mapa criado com tiles";
  if (map.kind === "tileset" && map.freeMovement) return "Imagem com movimentação livre (enviada por você)";
  if (map.kind === "tileset") return map.key?.startsWith("asset:") ? "Imagem com grade (enviada por você)" : "Mapa pronto com grade";
  return map.key?.startsWith("asset:") ? "Imagem sem grade (enviada por você)" : map.key?.startsWith("resource:") ? "Imagem por link da campanha" : "Cenário pronto sem grade";
}
export const isCampaignMap = (map) => !!map?.key && (map.key.startsWith("asset:") || map.key.startsWith("resource:"));

const normalize = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Cenários aceitos por um tipo de cena: mapa com grade exige grade; imagem sem grade aceita qualquer imagem
 * (inclusive uma imagem com grade, usada sem casas). Mesma regra do servidor.
 */
export function acceptsMap(sceneKind, map) {
  if (sceneKind === "map") return map.kind === "tileset";
  if (sceneKind === "image") return map.kind === "cartographic" || (map.key?.startsWith("asset:") && !map.isTileMap);
  return true;
}

/** Filtra por busca (sem acentos), tipo ("grid" | "image" | "") e pasta (Completa). A seleção atual nunca some. */
export function filterMaps(items, { query = "", type = "", folderId = "", selected = "" } = {}) {
  const q = normalize(query);
  return items.filter((m) => {
    if (m.key === selected) return true;
    if (q && !normalize(`${m.name} ${m.description || ""} ${mapTypeLabel(m)}`).includes(q)) return false;
    if (type === "grid" && m.kind !== "tileset") return false;
    if (type === "image" && m.kind === "tileset") return false;
    if (folderId && (m.folderId || "") !== folderId) return false;
    return true;
  });
}

/** Grupos do seletor: recentes (quando há dados), cenários prontos e mapas da campanha. */
export function groupMaps(items, recentKeys = []) {
  const recent = recentKeys.map((k) => items.find((m) => m.key === k)).filter(Boolean).slice(0, 6);
  return [
    ["recent", "Recentes", recent],
    ["ready", "Cenários prontos", items.filter((m) => !isCampaignMap(m))],
    ["campaign", "Mapas da campanha", items.filter(isCampaignMap)],
  ].filter(([, , list]) => list.length);
}

/** Recentes a partir das cenas (mais recentes primeiro) e do mapa atual da mesa. */
export function recentMapKeys(scenes = [], currentKey = "") {
  const keys = [currentKey, ...[...scenes].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((s) => s.mapKey)];
  return [...new Set(keys.filter(Boolean))];
}

/**
 * Grade autoritativa a partir do tamanho da imagem, do lado do quadrado e do deslocamento.
 * Espelha CampaignMapView.Grid no servidor: só casas inteiras; até 100 por lado e 4.096 no total.
 */
export function gridFor(pixelWidth, pixelHeight, size, offsetX = 0, offsetY = 0) {
  const s = Math.trunc(Number(size)), ox = Math.trunc(Number(offsetX) || 0), oy = Math.trunc(Number(offsetY) || 0);
  if (!(s >= 8 && s <= 1024)) return { valid: false, width: 0, height: 0, message: "O quadrado vai de 8 a 1.024 pixels." };
  if (ox < 0 || oy < 0 || ox >= s || oy >= s) return { valid: false, width: 0, height: 0, message: "O deslocamento vai de 0 até o tamanho do quadrado menos 1 pixel." };
  if (s > Math.min(pixelWidth, pixelHeight)) return { valid: false, width: 0, height: 0, message: "O quadrado deve caber na imagem." };
  const width = Math.floor((pixelWidth - ox) / s), height = Math.floor((pixelHeight - oy) / s);
  if (width < 1 || height < 1 || width > 100 || height > 100 || width * height > 4096)
    return { valid: false, width, height, message: "A grade deve ter até 100 quadrados por lado e 4.096 casas. Aumente o tamanho do quadrado." };
  return { valid: true, width, height, message: `${width} × ${height} casas` };
}

/** Estado de uma cena na sessão e a ação principal adequada. */
export function sceneStatus(scene, currentId) {
  if (scene.id === currentId) return { key: "presenting", label: "Em apresentação", action: "edit", actionLabel: "Editar preparação" };
  if (scene.hasSaved) return { key: "visited", label: "Já visitada", action: "resume", actionLabel: "Retomar cena" };
  return { key: "prepared", label: "Preparada", action: "present", actionLabel: "Apresentar cena" };
}

/** Pendências entre a preparação salva e o que está na mesa, em texto. */
export function pendingParts(pending = {}) {
  return [
    pending.text && ["text", "Nome e texto para os jogadores"],
    pending.vision && ["vision", "Visibilidade"],
    pending.layer && ["layer", "Paredes, portas, luzes e marcas do mapa"],
    pending.map && ["map", "Cenário (só com “Reiniciar cena”)"],
  ].filter(Boolean);
}

/** O que "Aplicar à cena atual" mantém: estado da partida que não faz parte da alteração. */
export const APPLY_PRESERVES = "Continuam como estão: exploração, portas abertas ou fechadas na partida e áreas já reveladas. Posições e criaturas na mesa só mudam se você marcar “Recolocar os marcadores”.";

/** Parte opcional (desmarcada por padrão) de "Aplicar": volta ao arranjo preparado sem recomeçar a exploração. */
export const APPLY_TOKENS = Object.freeze({
  label: "Recolocar os marcadores no arranjo preparado",
  help: "Personagens voltam às posições preparadas (sem posição, entram pelos pontos de entrada); criaturas fora do arranjo saem da mesa. A exploração continua.",
});

/** Ajustes avançados ativos que ficam ocultos na interface Básica (continuam valendo). */
export function hiddenCustomizations({ layer = null, scene = null, tokens = [], fog = null } = {}) {
  const list = [];
  const marks = (layer?.marks || fog?.marks || []).length;
  // Tochas e braseiros que vêm do próprio cenário oficial (ids t{x}-{y}/b{x}-{y}) não são ajustes do mestre.
  const lights = (layer?.lights || fog?.lights || []).filter((l) => !/^[tb]\d+-\d+$/.test(String(l.id ?? ""))).length;
  if (marks) list.push(`${marks} marca(s) oculta(s)`);
  if (lights) list.push(`${lights} foco(s) de luz`);
  if (layer && layer.fog != null) list.push(layer.fog ? "Névoa sempre ligada neste mapa" : "Névoa sempre desligada neste mapa");
  if (fog && fog.inherited === false) list.push(fog.active ? "Névoa ligada só neste mapa" : "Névoa desligada só neste mapa");
  if (scene?.layerMode === "scene") list.push("Preparação do mapa própria desta cena");
  if (scene?.description) list.push("Descrição de preparo");
  const special = tokens.filter((t) => t.light != null && t.characterId == null && t.light > 0).length;
  if (special) list.push(`${special} marcador(es) com luz própria`);
  const detect = tokens.filter((t) => t.dc != null || t.detectSense).length;
  if (detect) list.push(`${detect} marcador(es) com detecção automática`);
  return list;
}

/**
 * Pré-validação do arranjo (o servidor confere de novo): casa dentro da grade, livre para movimento e sem outro marcador.
 * Devolve a mensagem de recusa ou "" quando a casa serve.
 */
export function placementProblem(cells, width, height, tokens, x, y, ignoreIndex = -1, free = false, span = { w: 1, h: 1 }) {
  // Mapa tático: a criatura grande (ADR-092) ocupa a área inteira a partir de (x, y), como TokenSpan no servidor.
  const area = free ? { w: 1, h: 1 } : span, big = area.w * area.h > 1;
  if (x < 0 || y < 0 || x + area.w > width || y + area.h > height) return big ? "A criatura não cabe no mapa nessa posição." : "Escolha uma casa dentro do mapa.";
  for (let dy = 0; dy < area.h; dy++)
    for (let dx = 0; dx < area.w; dx++) {
      const c = cells?.[y + dy]?.[x + dx];
      if (c === "m" || c === "#" || c === "d") return big ? `A casa ${x + dx + 1}, ${y + dy + 1}, sob a criatura, bloqueia movimento.` : "Essa casa bloqueia movimento. Escolha outra.";
    }
  // Movimentação livre: vários marcadores podem dividir a casa (ScenePrep.ValidateTokens com free).
  if (!free) {
    const taken = takenKeys(tokens.filter((_, i) => i !== ignoreIndex));
    for (let dy = 0; dy < area.h; dy++)
      for (let dx = 0; dx < area.w; dx++) if (taken.has(`${x + dx}:${y + dy}`)) return big ? "A área da criatura encosta em outro marcador." : "Já há um marcador nessa casa.";
  }
  if (ignoreIndex < 0 && tokens.length >= 60) return "Use até 60 marcadores por cena.";
  return "";
}

/** Metros → casas, igual a TableFog.MetersToCells (raio máximo 30). */
export const metersToCells = (meters, scale) => (!(meters > 0) || !(scale > 0) ? 0 : Math.min(30, Math.floor(meters / scale)));

function reach(layer, width, height, sx, sy, radius, into) {
  const cells = layer.cells, walls = layer.walls;
  if (!(radius > 0) || sx < 0 || sy < 0 || sx >= width || sy >= height) return;
  for (let y = Math.max(0, sy - radius); y <= Math.min(height - 1, sy + radius); y++)
    for (let x = Math.max(0, sx - radius); x <= Math.min(width - 1, sx + radius); x++) {
      const i = y * width + x;
      if (into[i] || (x - sx) ** 2 + (y - sy) ** 2 > radius * radius) continue;
      if (lineClear(cells, width, height, sx, sy, x, y, walls)) into[i] = true;
    }
}

/**
 * Simulação do editor com as mesmas regras de FogRules.Shared/Visible/View do servidor: luz dos focos e dos marcadores
 * não ocultos, casas reveladas e — quando `viewer` aponta um personagem posicionado — a visão da ficha dele.
 * Revelação manual zera luz e visão (como na mesa). Devolve { fog, tokens } prontos para o tabuleiro.
 * Não reproduz sentidos especiais, detecção por Percepção nem casas exploradas em partidas anteriores.
 */
export function simulateView({ visionMode, layer, width, height, tokens, characters = [], settings = {}, scale = 1.5, viewer = null }) {
  const fogOn = visionMode === "all" ? false : visionMode ? true : layer?.fog ?? settings.fogEnabled ?? true;
  const visibleTokens = tokens.filter((t) => !t.hidden);
  if (!fogOn || !layer) return { fog: { active: false }, tokens: visibleTokens };
  const manual = visionMode === "manual" || (!visionMode && (layer.manual ?? settings.manualReveal));
  const count = width * height;
  const lit = [...decodeBits(layer.revealed, count)].map(Boolean);
  const byId = new Map(characters.map((c) => [c.id, c]));
  if (!manual) {
    for (const l of layer.lights || []) reach(layer, width, height, l.x, l.y, lightReach(l), lit);
    for (const t of visibleTokens) {
      const ch = t.characterId ? byId.get(t.characterId) : null;
      const light = t.light ?? (t.characterId ? metersToCells(ch?.lightMeters ?? settings.playerLightMeters ?? 0, scale) : settings.creatureLight ?? 0);
      reach(layer, width, height, t.x, t.y, Math.min(30, light), lit);
    }
    const v = viewer != null ? tokens.find((t) => t.characterId && t.characterId === viewer) : null;
    if (v) {
      const ch = byId.get(v.characterId);
      reach(layer, width, height, v.x, v.y, metersToCells(ch?.visionMeters ?? settings.playerVisionMeters ?? 0, scale), lit);
    }
  }
  const allies = settings.alliesAlwaysVisible ?? true;
  const shown = visibleTokens.filter((t) => t.characterId || (allies && t.side === "ally") || lit[t.y * width + t.x]);
  const bits = encodeBits(lit);
  return { fog: { active: true, visible: bits, explored: bits, cells: layer.cells, lights: [], marks: [] }, tokens: shown };
}


// ---------- Editor de cenas sobre o núcleo gráfico (ADR-081) ----------
// Camadas da cena só organizam marcadores no editor: olho, cadeado e opacidade nunca mudam o que o jogador vê.

/** Lados de um marcador, em linguagem simples. */
export const SCENE_SIDES = Object.freeze([["enemy", "Inimigo"], ["neutral", "Neutro"], ["ally", "Aliado"]]);
const sideName = (side) => (SCENE_SIDES.find(([v]) => v === side) || [, ""])[1];

/** Camadas persistidas da cena (Base e Elementos sempre presentes; só os campos do contrato). */
export function sceneLayers(layers) {
  return ensureLayers(layers).map(({ id, name, kind, visible, locked, opacity }) => ({ id, name, kind, visible, locked, opacity }));
}

/** Camada de um marcador: precisa existir e não pode ser a Base (referência do mapa); senão, Elementos. */
export function tokenLayerOf(layerId, layers = []) {
  const id = String(layerId || "");
  return id && id !== "base" && layers.some((l) => l.id === id) ? id : "elements";
}

/** Alfa de exibição no editor: camada oculta não é desenhada; opacidade 0–100 vira 0–1. */
export function layerAlpha(layer) {
  if (!layer) return 1;
  if (layer.visible === false) return 0;
  const o = Number(layer.opacity);
  return Number.isFinite(o) ? Math.max(0, Math.min(100, o)) / 100 : 1;
}

/** Casa livre mais próxima de (x, y) em anéis crescentes; empate pela distância em linha reta. Null quando não há. */
export function nearestFreeCell(cells, width, height, tokens, x, y, free = false, span = { w: 1, h: 1 }) {
  if (!(width > 0 && height > 0)) return null;
  const sx = Math.max(0, Math.min(width - 1, Math.round(x))), sy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const max = Math.max(width, height);
  for (let r = 0; r <= max; r++) {
    const ring = [];
    for (let yy = sy - r; yy <= sy + r; yy++)
      for (let xx = sx - r; xx <= sx + r; xx++)
        if (Math.max(Math.abs(xx - sx), Math.abs(yy - sy)) === r && xx >= 0 && yy >= 0 && xx < width && yy < height) ring.push([xx, yy]);
    ring.sort((a, b) => ((a[0] - x) ** 2 + (a[1] - y) ** 2) - ((b[0] - x) ** 2 + (b[1] - y) ** 2));
    for (const [xx, yy] of ring) if (!placementProblem(cells, width, height, tokens, xx, yy, -1, free, span)) return { x: xx, y: yy };
  }
  return null;
}

/** Itens da área de transferência: cópia de cada marcador com a posição relativa ao canto do grupo. */
export function clipboardFrom(tokens, indices) {
  const list = [...new Set(indices)].sort((a, b) => a - b).map((i) => tokens[i]).filter(Boolean);
  if (!list.length) return [];
  const ax = Math.min(...list.map((t) => t.x)), ay = Math.min(...list.map((t) => t.y));
  return list.map((t) => ({ token: { ...t }, dx: t.x - ax, dy: t.y - ay }));
}

/**
 * Colar a partir da casa `anchor`: cada item tenta a casa relativa e, se ela não servir, a casa livre mais próxima
 * (mesma validação de "Colocar aqui"). Personagens dos jogadores já presentes não entram de novo.
 * Devolve { placed, skipped } sem alterar `tokens`.
 */
export function pastePlacement({ cells, width, height, tokens = [], items = [], anchor, free = false }) {
  const placed = [];
  let skipped = 0;
  const present = new Set(tokens.map((t) => t.characterId).filter(Boolean));
  for (const item of items) {
    const t = item.token;
    if (t.characterId && present.has(t.characterId)) { skipped++; continue; }
    const all = [...tokens, ...placed];
    const tx = anchor.x + item.dx, ty = anchor.y + item.dy;
    const exact = !placementProblem(cells, width, height, all, tx, ty, -1, free, tokenSpan(t));
    const spot = exact ? { x: tx, y: ty } : nearestFreeCell(cells, width, height, all, tx, ty, free, tokenSpan(t));
    if (!spot) { skipped++; continue; }
    placed.push({ ...t, x: spot.x, y: spot.y, fx: free && exact ? t.fx ?? null : null, fy: free && exact ? t.fy ?? null : null });
    if (t.characterId) present.add(t.characterId);
  }
  return { placed, skipped };
}

/** Move vários marcadores pelo mesmo deslocamento (setas ou arraste em grupo). Tudo ou nada: { tokens } ou { error }. */
export function moveTokensBy(cells, width, height, tokens, indices, dx, dy, free = false) {
  const set = new Set(indices.filter((i) => tokens[i]));
  if (!set.size) return { error: "Selecione um marcador." };
  const others = tokens.filter((_, i) => !set.has(i));
  const next = tokens.map((t) => ({ ...t }));
  const moved = [];
  for (const i of set) {
    const x = tokens[i].x + dx, y = tokens[i].y + dy;
    const problem = placementProblem(cells, width, height, [...others, ...moved], x, y, -1, free, tokenSpan(tokens[i]));
    if (problem) return { error: problem };
    next[i] = { ...tokens[i], x, y };
    moved.push(next[i]);
  }
  return { tokens: next };
}

/**
 * Grupos do painel Estrutura: marcadores por camada (a mais alta primeiro, sem a Base) e, quando `technical`,
 * a preparação do mapa (focos de luz, marcas ocultas e portas). Ids: t{índice}, light:x:y, mark:x:y, door:x:y.
 */
export function structureGroups({ tokens = [], layers = [], selected = [], layer = null, technical = false, kinds = [] } = {}) {
  const chosen = new Set(selected);
  const list = ensureLayers(layers);
  const groups = [...list].reverse().filter((l) => l.id !== "base").map((l) => ({
    id: l.id, label: l.name, showEmpty: true,
    items: tokens.map((t, i) => [t, i]).filter(([t]) => tokenLayerOf(t.layer, list) === l.id).map(([t, i]) => ({
      id: `t${i}`, label: t.label || "Marcador", icon: "character", hidden: !!t.hidden, locked: !!l.locked, selected: chosen.has(i),
      meta: [sideName(t.side), t.characterId ? "personagem" : t.masterCharacterId ? "do mestre" : "", t.hidden ? "oculto" : ""].filter(Boolean).join(" · "),
    })),
  }));
  if (!technical || !layer) return groups;
  const at = (x, y) => `coluna ${x + 1}, linha ${y + 1}`;
  const doors = [];
  (layer.cells || []).forEach((row, y) => [...String(row)].forEach((c, x) => { if ((c === "d" || c === "o") && doors.length < 200) doors.push({ x, y, open: c === "o" }); }));
  return [...groups,
    { id: "lights", label: "Focos de luz", items: (layer.lights || []).map((l) => ({ id: `light:${l.x}:${l.y}`, label: `Foco de luz (${at(l.x, l.y)})`, meta: `raio ${l.radius}`, icon: "light" })) },
    { id: "marks", label: "Marcas ocultas", items: (layer.marks || []).map((m) => ({ id: `mark:${m.x}:${m.y}`, label: m.label || "Marca", meta: `${(kinds.find(([v]) => v === m.kind) || [, ""])[1]} · ${at(m.x, m.y)}`.replace(/^ · /, ""), icon: "mark" })) },
    { id: "doors", label: "Portas", items: doors.map((d) => ({ id: `door:${d.x}:${d.y}`, label: `Porta (${at(d.x, d.y)})`, meta: d.open ? "aberta" : "fechada", icon: "door" })) },
  ];
}

/** Igualdade de instantâneos (rascunho/preparação) para recalcular "alterações não salvas" depois de desfazer. */
export const sameSnapshot = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- Composição da cena, entradas e distribuição do grupo (ADR-090) ----------

/** Como a imagem de fundo é usada. Três escolhas que não se confundem; a grade técnica da movimentação livre fica oculta. */
export const BACKGROUND_MODES = Object.freeze([
  ["free", "Movimentação livre", "Personagens ficam em qualquer ponto da imagem, sem grade visível. Uma grade técnica oculta serve só de escala, paredes e névoa."],
  ["tactical", "Movimentação tática", "Mapa com grade visível: uma casa por personagem e regras de alcance. Ajuste a grade depois, se precisar."],
  ["image", "Somente apresentação", "Imagem ilustrativa para o grupo ver, sem personagens nem movimento."],
]);

/** Quadrado da grade técnica para uma imagem nova: ~64 px, aumentado até caber em 100 × 100 casas e 4.096 casas. Null se não couber. */
export function defaultGrid(width, height) {
  const w = Math.floor(Number(width)), h = Math.floor(Number(height));
  if (!(w >= 8 && h >= 8)) return null;
  for (let s = Math.max(8, Math.min(64, w, h)); s <= 1024; s++) if (gridFor(w, h, s).valid) return s;
  return null;
}

/** Tipos de ponto de entrada de um mapa reutilizável (não vinculados a personagens). */
export const ENTRY_KINDS = Object.freeze([
  ["party", "Entrada do grupo"],
  ["enemies", "Entrada de inimigos"],
  ["reinforcements", "Reforços"],
  ["other", "Outro ponto"],
]);
export const MAX_ENTRIES = 12;
export const MAX_ENTRY_SIDE = 20;
const ENTRY_ID = /^[a-z0-9-]{1,24}$/;

/** Retângulo (em casas) que envolve as casas pintadas, limitado a 20 × 20 a partir do primeiro canto. */
export function entryRect(cells) {
  const list = (cells || []).filter((c) => Number.isInteger(c?.x) && Number.isInteger(c?.y));
  if (!list.length) return null;
  const x = Math.min(...list.map((c) => c.x)), y = Math.min(...list.map((c) => c.y));
  const w = Math.min(MAX_ENTRY_SIDE, Math.max(...list.map((c) => c.x)) - x + 1), h = Math.min(MAX_ENTRY_SIDE, Math.max(...list.map((c) => c.y)) - y + 1);
  return { x, y, w, h };
}

/** Casas de um retângulo dentro da grade, em ordem de leitura. */
export function rectCells(rect, width, height) {
  if (!rect) return [];
  const out = [];
  for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.h); y++)
    for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.w); x++) out.push({ x, y });
  return out;
}

/** Id curto e único para um ponto de entrada novo. */
export function newEntryId(entries = []) {
  const used = new Set(entries.map((e) => e.id));
  for (let i = 1; i < 1000; i++) if (!used.has(`entrada-${i}`)) return `entrada-${i}`;
  return `entrada-${Date.now().toString(36)}`.slice(0, 24);
}

/** Mesmas regras do servidor (MapEntries.Validate): até 12, ids únicos, nome 1–40, tipo conhecido, retângulo na grade. "" = válido. */
export function entriesProblem(entries, width, height) {
  if (!Array.isArray(entries)) return "Pontos de entrada inválidos.";
  if (entries.length > MAX_ENTRIES) return `Use até ${MAX_ENTRIES} pontos de entrada por mapa.`;
  const ids = new Set();
  for (const e of entries) {
    if (!ENTRY_ID.test(String(e?.id ?? "")) || ids.has(e.id)) return "Cada ponto de entrada precisa de um identificador único.";
    ids.add(e.id);
    const name = String(e.name ?? "").trim();
    if (!name || name.length > 40) return "Dê um nome de até 40 caracteres a cada ponto de entrada.";
    if (!ENTRY_KINDS.some(([k]) => k === e.kind)) return "Escolha o tipo do ponto de entrada.";
    if (![e.x, e.y, e.w, e.h].every(Number.isInteger) || e.w < 1 || e.h < 1 || e.w > MAX_ENTRY_SIDE || e.h > MAX_ENTRY_SIDE || e.x < 0 || e.y < 0 || e.x + e.w > width || e.y + e.h > height)
      return `O ponto “${name}” precisa ficar dentro do mapa (até ${MAX_ENTRY_SIDE} × ${MAX_ENTRY_SIDE} casas).`;
  }
  return "";
}

/**
 * Área de entrada efetiva da cena, na ordem da regra de posicionamento (ADR-090 §6.3):
 * área própria da cena → ponto do mapa escolhido pela cena → primeira "Entrada do grupo" do mapa → nenhuma (regra antiga).
 * → { rect, source: "scene"|"map-ref"|"map-party", entry? } ou null.
 */
export function sceneEntryArea(sceneEntry, mapEntries = []) {
  if (sceneEntry && Number.isInteger(sceneEntry.x)) return { rect: { x: sceneEntry.x, y: sceneEntry.y, w: sceneEntry.w, h: sceneEntry.h }, source: "scene" };
  if (sceneEntry?.ref) {
    const e = mapEntries.find((m) => m.id === sceneEntry.ref);
    if (e) return { rect: { x: e.x, y: e.y, w: e.w, h: e.h }, source: "map-ref", entry: e };
  }
  const party = mapEntries.find((m) => m.kind === "party");
  return party ? { rect: { x: party.x, y: party.y, w: party.w, h: party.h }, source: "map-party", entry: party } : null;
}

const SLOTS = [[500, 500], [250, 250], [750, 250], [250, 750], [750, 750], [500, 250], [500, 750], [250, 500], [750, 500]];
/**
 * "Distribuir grupo na área inicial": coloca na área os personagens ainda sem posição. Posições já preparadas são
 * preservadas (fixadas manualmente). Com grade, uma casa por personagem; com movimentação livre, casas livres primeiro e
 * depois pontos distintos dentro das casas já usadas. Casas que bloqueiam movimento ficam de fora.
 * → { tokens, placed:[characterId], missing:[characterId] } sem alterar a entrada.
 */
export function distributeInArea({ cells, width, height, tokens = [], area, characters = [], free = false, layer = "elements" }) {
  const next = tokens.map((t) => ({ ...t }));
  const present = new Set(next.map((t) => t.characterId).filter(Boolean));
  const pending = characters.filter((c) => c?.id && !present.has(c.id));
  const spots = rectCells(area, width, height).filter((c) => !placementProblem(cells, width, height, [], c.x, c.y, -1, true));
  const placed = [], missing = [];
  const count = (s) => next.filter((t) => t.x === s.x && t.y === s.y).length;
  for (const c of pending) {
    if (next.length >= 60) { missing.push(c.id); continue; }
    let spot = spots.find((s) => !placementProblem(cells, width, height, next, s.x, s.y, -1, false));
    let fine = SLOTS[0];
    if (!spot && free && spots.length) {
      const least = spots.reduce((best, s) => (count(s) < count(best) ? s : best), spots[0]);
      if (count(least) < SLOTS.length) { spot = least; fine = SLOTS[count(least)]; }
    }
    if (!spot) { missing.push(c.id); continue; }
    next.push({ characterId: c.id, label: String(c.name || "Personagem").slice(0, 40), side: "ally", hidden: false, x: spot.x, y: spot.y, fx: free ? fine[0] : null, fy: free ? fine[1] : null, layer });
    placed.push(c.id);
  }
  return { tokens: next, placed, missing };
}

/**
 * Documento que os jogadores recebem (achatado em PNG transparente): sem camadas ou elementos "só o mestre vê".
 * O olho de edição fica fora da regra de segredo: ocultar no editor não oculta dos jogadores.
 */
export function publicComposition(doc) {
  const secret = new Set((doc?.layers || []).filter((l) => l.secret).map((l) => l.id));
  return {
    ...doc,
    layers: (doc?.layers || []).map((l) => ({ ...l, visible: !l.secret })),
    elements: (doc?.elements || []).filter((e) => !e.secret && !secret.has(e.layer)).map((e) => ({ ...e, visible: true })),
  };
}

/** Há algo para os jogadores verem na composição? Sem isso, nenhuma sobreposição é enviada. */
export const hasPublicElements = (doc) => publicComposition(doc).elements.some((e) => e.opacity > 0);

/** Fontes de imagem (`asset:{guid}`) usadas pela composição, sem repetição. */
export const compositionSources = (doc) => [...new Set((doc?.elements || []).filter((e) => e.type === "image" && /^asset:/.test(e.src || "")).map((e) => e.src))];
