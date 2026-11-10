// Regras puras de apresentação da mesa. Espelham o servidor apenas para UX; o servidor sempre reaplica as regras.
export const HEARTBEAT_MS = 20000;
export const MIN_POLL_GAP_MS = 400;
export const ACTION_KINDS = Object.freeze([
  ["ataque", "⚔", "Atacar"],
  ["habilidade", "✧", "Habilidade"],
  ["magia", "✦", "Magia"],
  ["item", "◈", "Item"],
]);
const WALKABLE = ".,+=rSd:";

/** Destino ao abrir uma campanha da lista: mesa ao vivo para jogador com sessão ativa; página da campanha nos demais casos. */
export function campaignRoute(c) {
  if (!c.isMaster && c.activeSessionId) return "table/" + c.id;
  return "campaign/" + c.id;
}

export function parseRoute(hash) {
  const [view = "overview", id = "", tab = "", item = ""] = String(hash || "")
    .replace(/^#/, "")
    .split("/");
  return { view: view || "overview", id, tab, item };
}

export const isGuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );

export function modifier(attribute) {
  return Math.floor((Number(attribute) - 10) / 2);
}
export function signed(n) {
  return (n >= 0 ? "+" : "") + n;
}
export function movementSquares(meters, scaleMeters = 1.5) {
  const scale = Number(scaleMeters) > 0 ? Number(scaleMeters) : 1.5;
  return Math.max(1, Math.floor(Math.max(0, Number(meters) || 0) / scale));
}

/** Percentual e tom da barra de vida. Cor nunca é o único indicador: o texto mostra os pontos. */
export function hpState(hp, maxHp) {
  const max = Math.max(1, Number(maxHp) || 1);
  const value = Math.min(max, Math.max(0, Number(hp) || 0));
  const percent = Math.round((value / max) * 100);
  return {
    percent,
    tone:
      value === 0
        ? "down"
        : percent <= 25
          ? "critical"
          : percent <= 50
            ? "wounded"
            : "healthy",
  };
}

export function isMyTurn(state) {
  return (
    !!state?.me?.characterId &&
    !state.me.isMaster &&
    !state.session?.endedAt &&
    state.session?.activeCharacterId === state.me.characterId
  );
}

/** Quais comandos o jogador vê habilitados no próprio turno, a partir das ações da ficha. */
export function availableCommands(state) {
  const mine = isMyTurn(state);
  const actions = state?.me?.character?.actions || [];
  const token = myToken(state);
  return {
    ataque: mine, // sempre há o ataque básico
    habilidade: mine && actions.some((a) => a.kind === "habilidade"),
    magia: mine && actions.some((a) => a.kind === "magia"),
    item: mine && actions.some((a) => a.kind === "item"),
    mover:
      mine &&
      state?.map?.kind === "tileset" &&
      !!token &&
      token.lastMovedTurn !== state.session.turnNumber,
    defender: mine,
    encerrar: mine,
  };
}

export function myToken(state) {
  return (state?.tokens || []).find(
    (t) => t.characterId && t.characterId === state?.me?.characterId,
  );
}

export function canStand(rows, x, y) {
  return (
    y >= 0 &&
    y < rows.length &&
    x >= 0 &&
    x < rows[y].length &&
    WALKABLE.includes(rows[y][x])
  );
}

/** Células alcançáveis por distância de Chebyshev, livres e não ocupadas. */
export function reachableCells(rows, tokens, from, squares) {
  const taken = new Set(tokens.map((t) => t.x + ":" + t.y));
  const cells = [];
  for (let y = from.y - squares; y <= from.y + squares; y++)
    for (let x = from.x - squares; x <= from.x + squares; x++)
      if (
        (x !== from.x || y !== from.y) &&
        canStand(rows, x, y) &&
        !taken.has(x + ":" + y)
      )
        cells.push({ x, y });
  return cells;
}

export function onlinePlayers(state) {
  return (state?.participants || []).filter((p) => !p.isMaster && p.online);
}

/** "Sessão 06 — Título", sem repetir o prefixo quando o título já o contém. */
export function sessionLabel(number, title) {
  const prefix = `Sessão ${String(number).padStart(2, "0")}`;
  const clean = String(title || "").replace(
    /^\s*sess[aã]o\s*\d+\s*[—–-]\s*/i,
    "",
  );
  return clean ? `${prefix} — ${clean}` : prefix;
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return m < 60
    ? `${m}min`
    : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}min`;
}

export function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    (parts[0]?.[0] || "?") + (parts.length > 1 ? parts.at(-1)[0] : "")
  ).toUpperCase();
}

const EVENT_META = {
  start: ["✦", "Início"],
  end: ["✓", "Encerramento"],
  join: ["➤", "Entrada"],
  leave: ["↩", "Saída"],
  message: ["✉", "Mensagem"],
  roll: ["⬡", "Rolagem"],
  action: ["⚔", "Ação"],
  turn: ["⌛", "Turno"],
  map: ["◈", "Mapa"],
  move: ["➶", "Movimento"],
  token: ["⚑", "Marcador"],
  sheet: ["♜", "Ficha"],
  note: ["✎", "Anotação"],
  music: ["♪", "Trilha sonora"],
};
export function eventMeta(kind) {
  return EVENT_META[kind] || ["•", "Registro"];
}

/** Lê o JSON de detalhes de um evento sem lançar exceção. */
export function eventData(event) {
  try {
    return event?.data ? JSON.parse(event.data) : {};
  } catch {
    return {};
  }
}

/** Separa eventos para as abas de chat e rolagens da mesa. */
export function feedFor(events, tab) {
  if (tab === "rolls")
    return events.filter((e) => e.kind === "roll" || e.kind === "action");
  if (tab === "notes") return events.filter((e) => e.kind === "note");
  if (tab === "chat")
    return events.filter(
      (e) =>
        !["move", "token", "music"].includes(e.kind) &&
        !(e.kind === "note" && e.masterOnly),
    );
  return events;
}

/** Atraso até a próxima consulta ao vivo: evita rajadas e recua após falhas consecutivas. */
export function nextPollDelay(failures, elapsedMs) {
  if (failures > 0) return Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
  return Math.max(0, MIN_POLL_GAP_MS - elapsedMs);
}
