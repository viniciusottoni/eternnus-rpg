// Regras puras do caminho "criar → jogar" (ADR-100): checklist "Pronto para jogar?" e escolha inicial do modal de sessão.
// Sem DOM e sem rede; testado em tests/start-policy.test.mjs.

/**
 * Itens do checklist da visão geral do mestre. `d` = detalhe da campanha (members, characters, sceneCount).
 * Cada item: { key, label, done, detail, optional }. Só "Convidar" e "Fichas" contam para `ready`.
 */
export function readinessChecklist(d) {
  const members = Array.isArray(d?.members) ? d.members : [];
  const characters = Array.isArray(d?.characters) ? d.characters : [];
  const withSheet = members.filter((m) => characters.some((c) => c.ownerId === m.id)).length;
  const scenes = Number(d?.sceneCount) || 0;
  const items = [
    {
      key: "invite",
      label: "Convide o grupo",
      done: members.length > 0,
      detail: members.length ? `${members.length} ${members.length === 1 ? "jogador entrou" : "jogadores entraram"}.` : "Ninguém entrou ainda. Envie o link abaixo.",
      optional: false,
    },
    {
      key: "sheets",
      label: "Fichas dos jogadores",
      done: members.length > 0 && withSheet === members.length,
      detail: members.length ? `${withSheet} de ${members.length} com ficha. Quem ainda não tem cria ao entrar na mesa.` : "Cada jogador cria a ficha ao entrar, com o modelo da campanha.",
      optional: false,
    },
    {
      key: "scene",
      label: "Cena preparada (opcional)",
      done: scenes > 0,
      detail: scenes ? `${scenes} ${scenes === 1 ? "cena pronta" : "cenas prontas"} para abrir a sessão.` : "Sem cena, a sessão abre num mapa pronto.",
      optional: true,
    },
  ];
  return { items, ready: items.filter((i) => !i.optional).every((i) => i.done) };
}

/** Cenas que podem abrir uma sessão (todas as preparadas; texto usa o mapa escolhido). */
export const startableScenes = (scenes) => (Array.isArray(scenes) ? scenes.filter((s) => s && typeof s.id === "string" && s.id) : []);

/**
 * Escolha inicial do modal: com cena preparada, a primeira (ordem da Preparação); sem cena, um mapa.
 * Devolve { mode: "scene"|"map", sceneId, mapKey } — mapKey é o primeiro tileset (ou o primeiro mapa).
 */
export function startDefaults(context) {
  const scenes = startableScenes(context?.scenes);
  const maps = Array.isArray(context?.maps) ? context.maps : [];
  const mapKey = (maps.find((m) => m.kind === "tileset") || maps[0])?.key || "";
  return scenes.length ? { mode: "scene", sceneId: scenes[0].id, mapKey } : { mode: "map", sceneId: "", mapKey };
}

/** Rótulo curto do tipo de cena (mesmos termos de scene-policy.SCENE_KINDS). */
export const startSceneKind = (kind) => ({ map: "Mapa tático", image: "Imagem sem grade", text: "Apresentação textual" })[kind] || "Cena";

/** Corpo do POST /sessions a partir do formulário. Nome vazio vai vazio (o número identifica a sessão). */
export function startPayload(data, chapterId) {
  const [mapKind, ...rest] = String(data.map || "").split("|");
  const scene = data.start && data.start !== "map" ? data.start : null;
  return {
    title: String(data.title || "").trim(),
    objective: String(data.objective || ""),
    mapKind: mapKind || null,
    mapKey: rest.join("|") || null,
    sceneId: scene,
    chapterId: chapterId || null,
  };
}
