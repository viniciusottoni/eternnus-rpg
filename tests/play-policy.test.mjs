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
