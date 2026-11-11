// Regras puras da condução independente do sistema no cliente (espelho de UX; o servidor decide).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as p from "../apps/Eternnus.Web/wwwroot/js/play-policy.js";

const state = (over = {}) => ({
  session: { endedAt: null, turnNumber: 2 },
  map: { kind: "tileset" },
  me: { character: { actions: [{ id: "a", name: "Golpe", kind: "ataque" }, { id: "b", name: "Truque", kind: "magia", group: "Truques" }], shortcuts: { actions: ["b"] } } },
  play: { mode: "free", myTurn: false, paused: false },
  ...over,
});

test("modo livre libera ações sem turno; turnos explicam o bloqueio", () => {
  assert.equal(p.playerCommands(state()).canAct, true);
  assert.equal(p.playerCommands(state()).showEndTurn, false);
  const waiting = p.playerCommands(state({ play: { mode: "turns", myTurn: false } }));
  assert.equal(waiting.canAct, false);
  assert.match(waiting.reason, /turnos/);
  const mine = p.playerCommands(state({ play: { mode: "tactical", myTurn: true } }));
  assert.equal(mine.canAct, true);
  assert.equal(mine.showEndTurn, true);
  assert.match(p.playerCommands(state({ play: { mode: "free", paused: true } })).reason, /pausada/);
});

test("ações usam favoritas e nomes do sistema, sem grupos vazios", () => {
  const cmds = p.playerCommands(state());
  assert.deepEqual(cmds.favorites.map((a) => a.id), ["b"]);
  assert.deepEqual(cmds.groups.map((g) => g.name), ["Ataques", "Truques"]);
  assert.equal(p.playerCommands(state({ me: { character: { actions: [] } } })).hasActions, false);
});

test("notação do construtor coincide com o servidor", async () => {
  assert.equal(p.diceNotation({ count: 4, sides: 6, modifier: 2, keep: "kh", keepCount: 3 }), "4d6kh3+2");
  assert.equal(p.diceNotation({ count: 3, sides: 6, explode: true }), "3d6!");
  assert.equal(p.diceNotation({ count: 5, sides: 10, successAt: 8 }), "5d10≥8");
  assert.equal(p.diceNotation({ count: 1, sides: 100, percentTarget: 45, percentRule: "lte" }), "1d100 ≤ 45");
  const domain = await readFile(new URL("../apps/Eternnus.Web/Domain/TablePlay.cs", import.meta.url), "utf8");
  for (const piece of ['"≥"', '"!"', '" ≤ "', '" ≥ "']) assert.ok(domain.includes(piece), piece);
});

test("formulário do construtor valida limites com mensagens claras", () => {
  assert.deepEqual(p.specFromForm({ count: "2", sides: "20", modifier: "3", mechanic: "keep", keep: "kh", keepCount: "1" }).keep, "kh");
  assert.throws(() => p.specFromForm({ count: "0", sides: "6" }), /1 a 100/);
  assert.throws(() => p.specFromForm({ count: "2", sides: "6", mechanic: "keep", keepCount: "3" }), /1 a 2/);
  const pct = p.specFromForm({ count: "3", sides: "6", mechanic: "percent", percentTarget: "40", percentRule: "lte" });
  assert.equal(pct.count, 1);
  assert.equal(pct.sides, 100);
  assert.throws(() => p.specFromForm({ mechanic: "success", count: "3", sides: "6", successAt: "7" }), /sucesso/);
});

test("recursos sem teto e desfazer só do que é próprio", () => {
  assert.deepEqual(p.resourceState({ value: 3 }), { percent: null, text: "3" });
  assert.equal(p.resourceState({ value: 5, max: 10 }).percent, 50);
  assert.equal(p.canUndo({ kind: "move", mine: true }, { undoable: true }, false), true);
  assert.equal(p.canUndo({ kind: "move", mine: false }, { undoable: true }, false), false);
  assert.equal(p.canUndo({ kind: "roll", mine: true }, { undoable: true }, true), false);
  assert.equal(p.unreadCount([{ id: 5, kind: "message", mine: false }, { id: 6, kind: "move" }, { id: 7, kind: "roll", mine: true }], 4), 1);
});

test("espera recuperável mostra prazo e fusos usam o horário local", () => {
  const until = new Date(Date.now() + 9 * 60000).toISOString();
  assert.match(p.waitingText({ masterAway: true, recoverUntil: until }), /cerca de 9 min/);
  assert.equal(p.waitingText({ masterAway: false }), "");
  const iso = "2026-11-14T23:00:00.000Z";
  assert.equal(new Date(p.toLocalInput(iso)).toISOString(), iso);
});

test("formas de jogo do cliente coincidem com o servidor", async () => {
  const domain = await readFile(new URL("../apps/Eternnus.Web/Domain/TablePlay.cs", import.meta.url), "utf8");
  const server = [...domain.match(/Free = "(\w+)", Turns = "(\w+)", Tactical = "(\w+)"/).slice(1)];
  assert.deepEqual(p.PLAY_MODES.map((m) => m[0]), server);
});

test("imagem de NPC/criatura aceita só endereços produzidos pelo servidor", () => {
  const s = "0b6f1f4e-2d0a-4b8c-9a55-7d1e3c2b4a10", t = "9c8b7a65-4321-4fed-8cba-0123456789ab";
  for (const ok of [`/api/sessions/${s}/tokens/${t}/portrait`, `/api/sessions/${s}/tokens/${t}/portrait?v=1a2b3c4d5e6f`, `/api/campaigns/${s}/assets/maps/${t}/image`, `/api/campaigns/${s}/known-npcs/${t}/portrait?v=1a2b3c4d`, "https://exemplo.test/retrato.png"])
    assert.equal(p.safeImageUrl(ok), ok);
  for (const bad of [null, "", "http://exemplo.test/a.png", "javascript:alert(1)", "data:image/png;base64,AAA", `/api/sessions/${s}/tokens/${t}/portrait?v=1&x=2`, `/api/campaigns/${s}/assets/maps/${t}/image?x`, `/api/campaigns/${s}/known-npcs/${t}/portrait?v=1a2b3c4d&x=1`, `/api/campaigns/${s}/known-npcs/../portrait`,'https://a.test/x" onerror="y', "/api/users/me"])
    assert.equal(p.safeImageUrl(bad), null, String(bad));
});

test("bandeja: dados de um clique e destaque da rolagem recebida", () => {
  assert.deepEqual([...p.QUICK_DICE], [4, 6, 8, 10, 12, 20]);
  assert.equal(p.diceNotation(p.quickSpec(20)), "1d20");
  const ev = (data) => ({ kind: "roll", author: "Ana", data: JSON.stringify(data) });
  const read = (e) => p.rollSpotlight(e, JSON.parse(e.data));
  const crit = read(ev({ actor: "Tharion", label: "Ataque", visibility: "table", roll: { formula: "1d20", values: [20], total: 20, modifier: 0 } }));
  assert.deepEqual([crit.actor, crit.total, crit.tone, crit.private], ["Tharion", "20", "crit", false]);
  assert.equal(read(ev({ actor: "T", roll: { formula: "1d20", values: [1], total: 1 } })).tone, "fumble");
  assert.equal(read(ev({ actor: "T", roll: { formula: "1d20+3", values: [20], total: 23, modifier: 3 } })).tone, ""); // com modificador não marca crítico
  assert.equal(read(ev({ actor: "T", roll: { formula: "5d10≥8", values: [8, 9, 1, 2, 3], total: 2, successes: 2 } })).total, "2 sucessos");
  assert.equal(read(ev({ actor: "T", visibility: "master", roll: { formula: "1d6", values: [3], total: 3 } })).private, true);
  assert.equal(p.rollSpotlight({ kind: "roll" }, { secret: true, label: "x" }), null); // aviso de rolagem secreta não revela nada
  assert.equal(p.rollSpotlight({ kind: "message" }, {}), null);
});

test("bolhas de vida e armadura: só o que o servidor enviou, editável por dono e mestre", () => {
  const base = {
    me: { isMaster: false, characterId: "c1" },
    participants: [
      { characterId: "c1", isMe: true, canView: true, summary: { resources: [{ field: "vida", label: "Vida", value: 3, max: 12 }], stats: [], armor: { label: "Armadura", value: "15" } } },
      { characterId: "c2", isMe: false, canView: true, summary: { resources: [{ field: "pv", label: "PV", value: 8, max: 8 }], stats: [{ label: "CA", value: "13" }] } },
      { characterId: "c3", isMe: false, canView: false, summary: null },
    ],
    tokens: [{ id: "t1", characterId: "c1" }, { id: "t2", characterId: "c2" }, { id: "t3", characterId: "c3" }, { id: "t4", masterCharacterId: "n1" }, { id: "t5", characterId: "c2", perceived: true }],
    play: { npcs: [{ tokenId: "t4", id: "n1", resources: [{ label: "Vida", value: 5, max: 10 }] }] },
  };
  const mine = p.tokenBubbles(base);
  assert.deepEqual(mine.get("t1").resource, { label: "Vida", value: 3, max: 12, tone: "critical" });
  assert.deepEqual(mine.get("t1").armor, { label: "Armadura", value: "15" });
  assert.deepEqual(mine.get("t1").target, { kind: "character", id: "c1", field: "vida" });
  assert.equal(mine.get("t2").armor.value, "13"); // CA pelo rótulo do destaque
  assert.equal(mine.get("t2").target, null); // ficha de outro jogador: só leitura
  assert.equal(mine.has("t3"), false); // ficha privada
  assert.equal(mine.has("t4"), false); // NPC: jogador não recebe
  assert.equal(mine.has("t5"), false); // percebido não revela
  const master = p.tokenBubbles({ ...base, me: { isMaster: true } });
  assert.deepEqual(master.get("t4").target, { kind: "npc", id: "n1", index: 0 });
  assert.equal(master.get("t4").resource.tone, "wounded");
  assert.deepEqual(master.get("t2").target, { kind: "character", id: "c2", field: "pv" });
  const sheetNpc = p.tokenBubbles({ ...base, me: { isMaster: true }, play: { npcs: [{ tokenId: "t4", id: "n1", resources: [], sheet: { resources: [{ field: "vida", label: "Vida", value: 0, max: 9 }], stats: [], armor: { label: "Armadura", value: "11" } } }] } });
  assert.deepEqual(sheetNpc.get("t4").target, { kind: "npc", id: "n1", field: "vida" });
  assert.equal(sheetNpc.get("t4").resource.tone, "down");
  const simpleArmor = p.tokenBubbles({ ...base, me: { isMaster: true }, play: { npcs: [{ tokenId: "t4", id: "n1", resources: [{ label: "CA", value: 14 }, { label: "Vida", value: 2, max: 4 }] }] } });
  assert.deepEqual(simpleArmor.get("t4").target, { kind: "npc", id: "n1", index: 1 });
  assert.equal(simpleArmor.get("t4").armor.value, "14");
});
