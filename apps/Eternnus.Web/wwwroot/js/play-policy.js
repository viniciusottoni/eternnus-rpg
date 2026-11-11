// Regras puras da condução independente do sistema. Espelham o servidor só para UX; o servidor sempre decide.
export const PLAY_MODES = Object.freeze([
  ["free", "Livre", "Cada um age quando fizer sentido; o mestre conduz a conversa."],
  ["turns", "Por turnos", "O mestre define a ordem e concede a vez."],
  ["tactical", "Tática", "Turnos com grade, alcance e limite de deslocamento."],
]);
export const VISION_MODES = Object.freeze([
  ["all", "Tudo visível", "Sem névoa: todos veem o mapa inteiro."],
  ["manual", "Revelação manual", "Você revela as áreas; luz e visão não revelam sozinhas."],
  ["character", "Visão por personagem", "Cada um vê pela luz e visão do próprio personagem."],
]);
/** Rolagem do mestre: só ele escolhe quem vê. */
export const MASTER_VISIBILITY = Object.freeze([
  ["table", "Mesa inteira"],
  ["blind", "Somente eu"],
  ["group", "Eu e jogadores escolhidos"],
]);
/** Pedido de teste e configuração das rolagens dos jogadores. */
export const VISIBILITY = Object.freeze([
  ["table", "Mesa inteira"],
  ["master", "Quem rolou e o mestre"],
  ["blind", "Somente o mestre (quem rolou não vê)"],
]);
export const visibilityLabel = (v) => (VISIBILITY.find(([k]) => k === v) || VISIBILITY[0])[1];
export const DICE = Object.freeze([4, 6, 8, 10, 12, 20, 100]);
const KIND_LABELS = { ataque: "Ataques", habilidade: "Habilidades", magia: "Magias", item: "Itens" };

export const modeLabel = (mode) => (PLAY_MODES.find((m) => m[0] === mode) || PLAY_MODES[2])[1];
export const requiresTurn = (mode) => mode !== "free";

/** Agrupa ações pelo nome usado no sistema (ou pelo tipo); grupos vazios não aparecem. */
export function actionGroups(actions) {
  const groups = new Map();
  for (const a of actions || []) {
    const name = (a.group || "").trim() || KIND_LABELS[a.kind] || "Ações";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(a);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}

/**
 * Comandos do jogador conforme forma de jogo, vez e pausa. Devolve o que mostrar e, quando bloqueado,
 * o motivo e o próximo passo — nunca um botão inútil sem explicação.
 */
export function playerCommands(state) {
  const play = state?.play || {};
  const character = state?.me?.character;
  const ended = !!state?.session?.endedAt;
  const mode = play.mode || "tactical";
  const turnNeeded = requiresTurn(mode);
  const myTurn = !!play.myTurn;
  const canAct = !ended && !play.paused && (!turnNeeded || myTurn) && !!character;
  const actions = character?.actions || [];
  const favoriteIds = character?.shortcuts?.actions || [];
  const favorites = favoriteIds.map((id) => actions.find((a) => a.id === id)).filter(Boolean);
  const classic = !!character?.classic;
  let reason = "";
  if (ended) reason = "A sessão foi encerrada.";
  else if (play.paused) reason = "Partida pausada pelo mestre. Você ainda pode conversar.";
  else if (!character) reason = "Entre com uma ficha para agir.";
  else if (turnNeeded && !myTurn) reason = "Nesta mesa as ações acontecem por turnos. Aguarde o mestre conceder a sua vez.";
  return {
    canAct,
    canRoll: !ended && !play.paused,
    reason,
    favorites: favorites.length ? favorites : actions.slice(0, 3),
    groups: actionGroups(actions),
    hasActions: actions.length > 0 || classic,
    classic,
    showEndTurn: turnNeeded && myTurn && !ended,
    canMove: canAct && state?.map?.kind === "tileset",
  };
}

/** Mesmo texto que o servidor grava (ex.: "4d6kh3+2", "3d6!", "5d10≥8", "1d100 ≤ 45"). */
export function diceNotation(s) {
  if (!s) return "";
  let text = `${s.count}d${s.sides}`;
  if (s.keep) text += s.keep + s.keepCount;
  if (s.explode) text += "!";
  if (s.successAt) text += "≥" + s.successAt;
  if (s.modifier) text += (s.modifier > 0 ? "+" : "") + s.modifier;
  if (s.percentTarget) text += (s.percentRule === "lte" ? " ≤ " : " ≥ ") + s.percentTarget;
  return text;
}

/** Converte o formulário do construtor em DiceSpec, com mensagens compreensíveis. */
export function specFromForm(data) {
  const int = (v) => (v === "" || v == null ? null : Math.trunc(Number(v)));
  const count = int(data.count) ?? 1;
  const sides = int(data.sides) ?? 20;
  const spec = { count, sides, modifier: int(data.modifier) ?? 0, keep: null, keepCount: 0, explode: false, successAt: null, percentTarget: null, percentRule: null };
  const mechanic = data.mechanic || "sum";
  if (count < 1 || count > 100) throw new Error("Use de 1 a 100 dados.");
  if (sides < 2 || sides > 1000) throw new Error("Os dados têm de 2 a 1000 faces.");
  if (mechanic === "keep") {
    spec.keep = data.keep || "kh";
    spec.keepCount = int(data.keepCount) ?? 1;
    if (spec.keepCount < 1 || spec.keepCount > count) throw new Error(`Manter ou descartar vai de 1 a ${count} dados.`);
  }
  if (mechanic === "explode") spec.explode = true;
  if (mechanic === "success") {
    spec.successAt = int(data.successAt);
    if (!spec.successAt || spec.successAt > sides) throw new Error(`O sucesso vai de 1 a ${sides}.`);
    spec.explode = data.explodeSuccess === "on";
  }
  if (mechanic === "percent") {
    Object.assign(spec, { count: 1, sides: 100, percentTarget: int(data.percentTarget), percentRule: data.percentRule === "gte" ? "gte" : "lte" });
    if (!spec.percentTarget || spec.percentTarget > 100) throw new Error("O alvo percentual vai de 1 a 100.");
  }
  return spec;
}

/** Percentual e texto acessível de um recurso (sem presumir vida). */
export function resourceState(r) {
  const max = Number(r?.max);
  const value = Number(r?.value) || 0;
  if (!Number.isFinite(max) || max <= 0) return { percent: null, text: `${value}` };
  return { percent: Math.max(0, Math.min(100, Math.round((value / max) * 100))), text: `${value} de ${max}` };
}

/** Texto da espera recuperável da one-shot (prazo vindo do servidor, apresentado no horário local). */
export function waitingText(play, now = Date.now()) {
  if (!play?.masterAway || !play.recoverUntil) return "";
  const until = new Date(play.recoverUntil);
  const minutes = Math.max(0, Math.ceil((until.getTime() - now) / 60000));
  return `O mestre se desconectou. A mesa fica guardada até ${until.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (cerca de ${minutes} min).`;
}

/** Data/hora local com o fuso do navegador, para datas UTC do servidor. */
export function localDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
};
/** Valor de <input type="datetime-local"> a partir de ISO UTC, no horário local. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Eventos que podem ser desfeitos por quem vê: o próprio movimento/ajuste (mestre: todos). */
export function canUndo(event, data, isMaster) {
  if (!data?.undoable) return false;
  if (!["move", "sheet"].includes(event.kind)) return false;
  return isMaster || !!event.mine;
}

/** Quantas mensagens chegaram desde a última vez que a conversa esteve visível. */
export function unreadCount(events, lastSeenId) {
  return (events || []).filter((e) => e.id > lastSeenId && ["message", "roll", "action", "note", "request", "scene"].includes(e.kind) && !e.mine).length;
}

/** Visões da navegação móvel da mesa. */
export const MOBILE_VIEWS = Object.freeze({
  player: [["map", "Mapa"], ["sheet", "Ficha"], ["chat", "Conversa"]],
  master: [["map", "Mapa"], ["party", "Grupo"], ["chat", "Conversa"]],
});

/**
 * Imagem de NPC/criatura: só endereços que o servidor produz — link https validado, retrato protegido do marcador
 * (com versão opcional), imagem do acervo da campanha (prévia do mestre) ou retrato de NPC conhecido. Qualquer outro valor é descartado.
 */
const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PORTRAIT = new RegExp(`^/api/sessions/${GUID}/tokens/${GUID}/portrait(?:[?]v=[0-9a-f]{1,32})?$`);
const ASSET_IMAGE = new RegExp(`^/api/campaigns/${GUID}/assets/maps/${GUID}/image$`);
const KNOWN_PORTRAIT = new RegExp(`^/api/campaigns/${GUID}/known-npcs/${GUID}/portrait(?:[?]v=[0-9a-f]{8})?$`);
export const safeImageUrl = (url) =>
  typeof url === "string" && (/^https:\/\/[^\s"'<>\\]+$/.test(url) || PORTRAIT.test(url) || ASSET_IMAGE.test(url) || KNOWN_PORTRAIT.test(url)) ? url : null;
