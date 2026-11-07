/**
 * Integração da mesa ao vivo com PostgreSQL real: abertura de sessão, presença, turnos, ações da ficha,
 * mapa/marcadores, alterações de ficha, notas privadas, histórico e encerramento.
 */
import assert from "node:assert/strict";
import { startEnvironment, wait } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5193 });
const { check, ok, sql } = env;
try {
  const master = await env.verifiedClient(
    "mestre.sessao@example.test",
    "Vinícius",
  );
  const player = await env.verifiedClient("jogador.sessao@example.test", "Ana");
  const second = await env.verifiedClient(
    "segundo.sessao@example.test",
    "Bruno",
  );
  const outsider = await env.verifiedClient(
    "fora.sessao@example.test",
    "Forasteiro",
  );

  const campaign = await master("/api/campaigns", "POST", {
    name: "A Sombra de Valdaran",
    system: "Sistema livre",
    description: "Ruínas e segredos",
  });
  const path = "/api/campaigns/" + campaign.id;
  const { inviteCode } = await master(path);
  await player("/api/campaigns/join", "POST", { code: inviteCode });
  await second("/api/campaigns/join", "POST", { code: inviteCode });

  const sheet = (name, extra = {}) => ({
    name,
    archetype: "Guerreiro",
    level: 6,
    hp: 48,
    maxHp: 48,
    strength: 16,
    agility: 13,
    intellect: 10,
    constitution: 15,
    armor: 17,
    movement: 9,
    notes: "",
    revision: 0,
    actions: [
      {
        id: "golpe",
        name: "Golpe brutal",
        kind: "ataque",
        formula: "1d20+5",
        description: "Corte pesado",
      },
      {
        id: "grito",
        name: "Grito de guerra",
        kind: "habilidade",
        formula: "",
        description: "Inspira aliados",
      },
    ],
    ...extra,
  });
  await player(
    "/api/characters",
    "POST",
    sheet("Inválido", {
      actions: [{ name: "X", kind: "veneno", formula: "" }],
    }),
    400,
  );
  await player(
    "/api/characters",
    "POST",
    sheet("Inválido", {
      actions: [{ name: "X", kind: "ataque", formula: "eval(1)" }],
    }),
    400,
  );
  const tharion = await player("/api/characters", "POST", sheet("Tharion"));
  check(tharion.actions.length, 2);
  check(tharion.constitution, 15);
  const lysara = await second(
    "/api/characters",
    "POST",
    sheet("Lysara", { hp: 36, maxHp: 36, movement: 6 }),
  );

  // Abertura exclusiva do mestre.
  await player(
    path + "/sessions",
    "POST",
    { title: "Golpe", objective: "", mapKind: "tileset", mapKey: "crypt" },
    403,
  );
  await outsider(
    path + "/sessions",
    "POST",
    { title: "Golpe", objective: "", mapKind: "tileset", mapKey: "crypt" },
    404,
  );
  await player(path + "/maps", "GET", undefined, 403);
  const maps = await master(path + "/maps");
  ok(
    maps.items.some((m) => m.key === "crypt" && m.kind === "tileset"),
    "crypt tileset listed",
  );
  await master(
    path + "/sessions",
    "POST",
    { title: "", objective: "", mapKind: "tileset", mapKey: "crypt" },
    400,
  );
  await master(
    path + "/sessions",
    "POST",
    { title: "X", objective: "", mapKind: "tileset", mapKey: "valley" },
    400,
  );
  await master(
    path + "/sessions",
    "POST",
    {
      title: "X",
      objective: "",
      mapKind: "cartographic",
      mapKey: "resource:" + crypto.randomUUID(),
    },
    400,
  );
  check((await player("/api/campaigns")).items[0].activeSessionId, null);
  check((await player(path + "/table")).online, false);

  const [a, b] = await Promise.all([
    master(
      path + "/sessions",
      "POST",
      {
        title: "Sessão 01 — A Cripta",
        objective: "Descobrir a origem da relíquia",
        mapKind: "tileset",
        mapKey: "crypt",
      },
      null,
      { raw: true },
    ),
    master(
      path + "/sessions",
      "POST",
      {
        title: "Sessão 01 — Duplicada",
        objective: "Descobrir a origem da relíquia",
        mapKind: "tileset",
        mapKey: "crypt",
      },
      null,
      { raw: true },
    ),
  ]);
  check([a.status, b.status].sort(), [200, 409]);
  const session = (a.status === 200 ? a : b).data;
  check(session.number, 1);
  check(
    sql(
      `SELECT count(*) FROM "Sessions" WHERE "CampaignId"='${campaign.id}' AND "EndedAt" IS NULL`,
    ),
    "1",
  );
  const s = "/api/sessions/" + session.id;

  // Campanha online para os participantes; o jogador não vê a lista de sessões.
  const listed = (await player("/api/campaigns")).items[0];
  check(listed.activeSessionId, session.id);
  await player(path + "/sessions", "GET", undefined, 403);
  await outsider(s + "/live", "GET", undefined, 404);
  const entry = await player(path + "/table");
  check(entry.online, true);
  check(entry.session.id, session.id);
  check(entry.characters.map((c) => c.name).sort(), ["Tharion"]);

  // Entrada com ficha própria; ficha alheia não é aceita.
  await player(s + "/join", "POST", { characterId: lysara.id }, 404);
  await player(s + "/messages", "POST", { content: "Antes de entrar" }, 409);
  await player(s + "/join", "POST", { characterId: tharion.id }, 204);
  await player(s + "/join", "POST", {}, 204); // Retorno idempotente com a mesma ficha.
  await second(s + "/join", "POST", { characterId: lysara.id }, 204);
  let state = await player(s + "/live");
  check(state.me.joined, true);
  check(state.me.character.name, "Tharion");
  check(state.map.key, "crypt");
  check(
    state.participants
      .filter((p) => !p.isMaster && p.online)
      .map((p) => p.characterName),
    ["Tharion", "Lysara"],
  );
  check(state.tokens.length, 2);
  ok(
    state.events.every((e) => !e.masterOnly),
    "players never receive private notes",
  );
  ok(
    !JSON.stringify(state).includes("@example.test"),
    "live state exposes no e-mail",
  );
  const masterState = await master(s + "/live");
  ok(
    masterState.events.some((e) => e.kind === "note" && e.masterOnly),
    "master sees the private objective",
  );

  // Ficha: jogador abre a própria; mestre abre qualquer participante.
  check((await master(s + "/characters/" + tharion.id)).actions.length, 2);
  check((await second(s + "/characters/" + tharion.id)).canEdit, false);
  await outsider(s + "/characters/" + tharion.id, "GET", undefined, 404);

  // Sem turno, as ações ficam bloqueadas.
  const myToken = state.tokens.find((t) => t.characterId === tharion.id);
  await player(s + "/actions", "POST", { kind: "ataque" }, 409);
  await player(
    s + "/tokens/" + myToken.id + "/move",
    "POST",
    { x: myToken.x + 1, y: myToken.y },
    409,
  );
  await player(s + "/turn/next", "POST", undefined, 403);
  await master(s + "/actions", "POST", { kind: "ataque" }, 409);

  // Long-poll acorda quando outra conta escreve.
  const before = (await second(s + "/live")).revision;
  const started = Date.now();
  const pending = second(`${s}/live?after=${before}`);
  await wait(300);
  await master(s + "/turn", "POST", { characterId: tharion.id }, 204);
  const woke = await pending;
  ok(
    woke.revision > before && Date.now() - started < 5000,
    "live poll resolves after a write",
  );
  check(woke.session.activeName, "Tharion");

  // Turno do jogador: ações da ficha, defesa, movimento e encerramento.
  const basic = await player(s + "/actions", "POST", {
    kind: "ataque",
    target: "Esqueleto",
  });
  ok(
    basic.roll && basic.roll.formula === "1d20+3",
    "basic attack uses strength modifier",
  );
  const strike = await player(s + "/actions", "POST", {
    kind: "ataque",
    actionId: "golpe",
  });
  check(strike.roll.total, strike.roll.values[0] + 5);
  check(
    (
      await player(s + "/actions", "POST", {
        kind: "habilidade",
        actionId: "grito",
      })
    ).roll,
    null,
  );
  await player(
    s + "/actions",
    "POST",
    { kind: "magia", actionId: "golpe" },
    404,
  );
  await player(s + "/actions", "POST", { kind: "veneno" }, 400);
  await player(s + "/actions", "POST", { kind: "defender" });
  await second(s + "/actions", "POST", { kind: "ataque" }, 409);
  await player(
    s + "/tokens/" + myToken.id + "/move",
    "POST",
    { x: 0, y: 0 },
    400,
  );
  await player(
    s + "/tokens/" + myToken.id + "/move",
    "POST",
    { x: myToken.x + 7, y: myToken.y },
    400,
  );
  const otherToken = state.tokens.find((t) => t.characterId === lysara.id);
  await player(
    s + "/tokens/" + otherToken.id + "/move",
    "POST",
    { x: myToken.x, y: myToken.y + 2 },
    403,
  );
  await player(
    s + "/tokens/" + myToken.id + "/move",
    "POST",
    { x: otherToken.x, y: otherToken.y },
    409,
  );
  await player(
    s + "/tokens/" + myToken.id + "/move",
    "POST",
    { x: myToken.x + 3, y: myToken.y },
    204,
  );
  await player(
    s + "/tokens/" + myToken.id + "/move",
    "POST",
    { x: myToken.x + 4, y: myToken.y },
    409,
  );
  await player(s + "/turn/end", "POST", undefined, 204);
  await player(s + "/turn/end", "POST", undefined, 409);
  // A rotação continua a partir de quem encerrou o turno.
  await master(s + "/turn/next", "POST", undefined, 204);
  check((await second(s + "/live")).session.activeName, "Lysara");
  await master(s + "/turn/next", "POST", undefined, 204);
  check((await second(s + "/live")).session.activeName, "Tharion");
  await master(s + "/turn", "POST", { characterId: lysara.id }, 204);

  // Mestre ajusta vida; jogador altera a ficha: ambos entram no histórico.
  await second(
    s + "/characters/" + tharion.id + "/hp",
    "POST",
    { delta: -5 },
    403,
  );
  check(await player(s + "/characters/" + tharion.id + "/hp", "POST", { delta: -5 }), { hp: 43, maxHp: 48 });
  check(await player(s + "/characters/" + tharion.id + "/hp", "POST", { delta: 5 }), { hp: 48, maxHp: 48 });
  check(
    await master(s + "/characters/" + tharion.id + "/hp", "POST", {
      delta: -8,
      reason: "Ataque de criatura",
    }),
    { hp: 40, maxHp: 48 },
  );
  check(
    await master(s + "/characters/" + tharion.id + "/hp", "POST", {
      delta: 500,
    }),
    { hp: 48, maxHp: 48 },
  );
  await master(
    s + "/characters/" + tharion.id + "/hp",
    "POST",
    { delta: 0 },
    400,
  );
  const fresh = await player("/api/characters");
  await player("/api/characters/" + tharion.id, "PUT", {
    ...sheet("Tharion"),
    level: 7,
    revision: fresh[0].revision,
  });

  // Mapa, marcadores e chat.
  await player(
    s + "/map",
    "POST",
    { mapKind: "cartographic", mapKey: "valley" },
    403,
  );
  await master(
    s + "/tokens",
    "POST",
    { label: "Esqueleto", side: "enemy", x: 0, y: 0 },
    400,
  );
  const enemy = await master(s + "/tokens", "POST", {
    label: "Esqueleto",
    side: "enemy",
    x: 2,
    y: 2,
  });
  await master(
    s + "/tokens",
    "POST",
    { label: "<b>Outro</b>", side: "enemy", x: 2, y: 2 },
    409,
  );
  await player(s + "/tokens/" + enemy.id, "DELETE", undefined, 403);
  await master(s + "/tokens/" + myToken.id, "DELETE", undefined, 409);
  await master(
    s + "/tokens/" + enemy.id + "/move",
    "POST",
    { x: 3, y: 2 },
    204,
  );
  await master(
    s + "/map",
    "POST",
    { mapKind: "cartographic", mapKey: "valley" },
    204,
  );
  state = await player(s + "/live");
  check([state.map.kind, state.tokens.length], ["cartographic", 0]);
  await master(
    s + "/tokens",
    "POST",
    { label: "Lobo", side: "enemy", x: 1, y: 1 },
    409,
  );
  await master(
    s + "/map",
    "POST",
    { mapKind: "tileset", mapKey: "forest" },
    204,
  );
  state = await player(s + "/live");
  check([state.map.key, state.tokens.length], ["forest", 2]);
  await player(
    s + "/messages",
    "POST",
    { content: "<img src=x onerror=alert(1)>" },
    204,
  );
  await player(s + "/messages", "POST", { content: "" }, 400);
  const free = await player(s + "/rolls", "POST", {
    formula: "1d20+3",
    label: "Percepção",
  });
  ok(free.total >= 4 && free.total <= 23, "free roll bounded");

  // Notas: privadas por padrão; compartilhadas aparecem aos jogadores.
  await player(
    s + "/notes",
    "POST",
    { content: "Tentativa", shared: false },
    403,
  );
  await master(
    s + "/notes",
    "POST",
    { content: "O selo pertence à ordem antiga", shared: false },
    204,
  );
  await master(
    s + "/notes",
    "POST",
    { content: "Um frio percorre o salão.", shared: true },
    204,
  );
  state = await player(s + "/live");
  ok(
    !state.events.some((e) => e.content.includes("ordem antiga")),
    "private note hidden from player",
  );
  ok(
    state.events.some((e) => e.content.includes("frio percorre")),
    "shared note visible",
  );

  // Presença: heartbeat, saída e retorno.
  await second(s + "/heartbeat", "POST", undefined, 204);
  await second(s + "/leave", "POST", undefined, 204);
  state = await player(s + "/live");
  check(state.session.activeCharacterId, null);
  check(
    state.participants.find((p) => p.characterName === "Lysara").online,
    false,
  );
  await second(s + "/heartbeat", "POST", undefined, 409);
  await second(s + "/join", "POST", {}, 204);

  // Histórico exclusivo do mestre, com filtros e busca.
  await player(s + "/history", "GET", undefined, 403);
  const history = await master(s + "/history");
  check(history.session.active, true);
  ok(history.total >= 20, "timeline has the session events");
  const sheetEvents = await master(s + "/history?kind=sheet");
  ok(
    sheetEvents.events.some((e) =>
      e.content.includes("sofreu 8 pontos de dano"),
    ),
    "damage recorded",
  );
  ok(
    sheetEvents.events.some((e) => e.content.includes("Nível 6 → 7")),
    "sheet update recorded with before/after",
  );
  check(
    JSON.parse(sheetEvents.events.find((e) => e.content.includes("sofreu 8 pontos")).data)
      .changes[0],
    { field: "hp", label: "Vida", before: "48", after: "40" },
  );
  ok(
    (await master(s + "/history?kind=rolls")).total >= 4,
    "rolls and actions are auditable",
  );
  check(
    (await master(s + "/history?search=" + encodeURIComponent("selo pertence")))
      .total,
    1,
  );
  await master(s + "/history?kind=invalid", "GET", undefined, 400);
  const sessions = await master(path + "/sessions");
  check(
    [
      sessions.total,
      sessions.items[0].active,
      sessions.items[0].participantCount,
    ],
    [1, true, 2],
  );

  // Encerramento: campanha offline, escritas bloqueadas, histórico preservado e nota posterior permitida.
  await player(s + "/end", "POST", undefined, 403);
  await master(s + "/end", "POST", undefined, 204);
  await player(s + "/messages", "POST", { content: "Ainda aqui?" }, 409);
  await master(s + "/turn/next", "POST", undefined, 409);
  check((await player("/api/campaigns")).items[0].activeSessionId, null);
  state = await player(s + "/live");
  ok(state.session.endedAt, "ended state is visible to clients");
  await master(
    s + "/notes",
    "POST",
    { content: "Revisão posterior", shared: false },
    204,
  );
  const closed = await master(s + "/history");
  check(closed.session.active, false);
  const nextSession = await master(path + "/sessions", "POST", {
    title: "Sessão 02",
    objective: "",
    mapKind: "cartographic",
    mapKey: "valley",
  });
  check(nextSession.number, 2);
  check(
    (await master(path + "/sessions")).items.map((x) => x.number),
    [2, 1],
  );

  // Remoção do participante encerra o acesso à mesa.
  const members = (await master(path)).members;
  ok(
    members.every((m) => !("email" in m)),
    "member list has no e-mail",
  );
  const removed = members.find((m) => m.name === "Bruno");
  await master(path + "/members/" + removed.id, "DELETE", undefined, 204);
  await second(
    "/api/sessions/" + nextSession.id + "/live",
    "GET",
    undefined,
    404,
  );

  console.log(
    `PASS: ${env.count()} live session assertions with real PostgreSQL. Start/one-active invariant, presence, turns, sheet actions, movement, map, notes, history and closure verified.`,
  );
} catch (error) {
  console.error(env.logs().slice(-6000));
  throw error;
} finally {
  await env.stop();
}
