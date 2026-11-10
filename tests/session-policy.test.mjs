import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/session-policy.js", import.meta.url),
  "utf8",
);
const p = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("a legenda tática do navegador coincide com a fonte oficial do servidor", async () => {
  const domain = await readFile(new URL("../apps/Eternnus.Web/Domain/BattleMaps.cs", import.meta.url), "utf8");
  const walkable = domain.match(/const string Walkable = "([^"]+)"/)[1];
  for (const cell of "#ToAbt~.,+=rSdh:")
    assert.equal(p.canStand([cell], 0, 0), walkable.includes(cell), cell);
  assert.equal(p.canStand(["h"], 0, 0), false);
  assert.equal(p.canStand(["d:"], 1, 0), true);
});
const policySource = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/policy.js", import.meta.url),
  "utf8",
);
const { canAccess } = await import(
  "data:text/javascript;base64," + Buffer.from(policySource).toString("base64")
);

const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
const crypt = ["#####", "#.S.#", "#.#~#", "#...#", "#####"];
function live({ mine = true, actions = [], moved = 0, map = "tileset" } = {}) {
  return {
    session: {
      activeCharacterId: mine ? "c1" : "c2",
      turnNumber: 3,
      endedAt: null,
    },
    me: {
      isMaster: false,
      characterId: "c1",
      character: { actions, movement: 3 },
    },
    map: { kind: map, rows: crypt },
    tokens: [{ id: "t1", characterId: "c1", x: 2, y: 1, lastMovedTurn: moved }],
    participants: [],
  };
}

test("online campaigns send players straight to the table; masters and offline campaigns open the campaign page", () => {
  assert.equal(
    p.campaignRoute({ id, isMaster: false, activeSessionId: "s" }),
    "table/" + id,
  );
  assert.equal(
    p.campaignRoute({ id, isMaster: false, activeSessionId: null }),
    "campaign/" + id,
  );
  assert.equal(
    p.campaignRoute({ id, isMaster: true, activeSessionId: "s" }),
    "campaign/" + id,
  );
});

test("routes are parsed into view, identifier and tab, and identifiers are validated", () => {
  assert.deepEqual(p.parseRoute("#session/" + id + "/notes"), {
    view: "session",
    id,
    tab: "notes",
    item: "",
  });
  assert.deepEqual(p.parseRoute(""), { view: "overview", id: "", tab: "", item: "" });
  assert.deepEqual(p.parseRoute("#campaign/" + id + "/sessions/live-" + id), { view: "campaign", id, tab: "sessions", item: "live-" + id });
  assert.equal(p.isGuid(id), true);
  for (const bad of ["", "../campaigns", id + "x", "javascript:alert(1)"])
    assert.equal(p.isGuid(bad), false);
});

test("nested game routes follow the verified-account rule", () => {
  assert.equal(canAccess({ verified: false }, "table/" + id), false);
  assert.equal(canAccess({ verified: true }, "table/" + id), true);
  assert.equal(canAccess({ verified: false }, "overview"), true);
});

test("attribute modifiers, movement squares and labels match the server rules", () => {
  assert.deepEqual([16, 13, 10, 9, 1].map(p.modifier), [3, 1, 0, -1, -5]);
  assert.deepEqual([9, 6, 0, -3].map(m => p.movementSquares(m)), [6, 4, 1, 1]);
  assert.equal(p.movementSquares(3, 2), 1);
  assert.equal(p.movementSquares(9, 3), 3);
  assert.equal(p.signed(2), "+2");
  assert.equal(p.signed(-1), "-1");
  assert.equal(p.sessionLabel(6, "A Cripta"), "Sessão 06 — A Cripta");
  assert.equal(
    p.sessionLabel(6, "Sessão 06 — A Cripta"),
    "Sessão 06 — A Cripta",
  );
  assert.equal(p.formatDuration(134), "2h14min");
  assert.equal(p.formatDuration(9), "9min");
  assert.equal(p.initials("Lysara da Lua"), "LL");
});

test("hp bar percent and tone are bounded and never rely on a negative or overflowing value", () => {
  assert.deepEqual(p.hpState(48, 48), { percent: 100, tone: "healthy" });
  assert.deepEqual(p.hpState(20, 48), { percent: 42, tone: "wounded" });
  assert.deepEqual(p.hpState(7, 34), { percent: 21, tone: "critical" });
  assert.deepEqual(p.hpState(0, 10), { percent: 0, tone: "down" });
  assert.deepEqual(p.hpState(999, 10), { percent: 100, tone: "healthy" });
  assert.deepEqual(p.hpState(-5, 0), { percent: 0, tone: "down" });
});

test("commands are enabled only on the player's turn and according to the sheet", () => {
  const off = p.availableCommands(
    live({ mine: false, actions: [{ kind: "magia" }] }),
  );
  assert.ok(Object.values(off).every((v) => v === false));
  const on = p.availableCommands(live({ actions: [{ kind: "magia" }] }));
  assert.deepEqual(on, {
    ataque: true,
    habilidade: false,
    magia: true,
    item: false,
    mover: true,
    defender: true,
    encerrar: true,
  });
  assert.equal(p.availableCommands(live({ moved: 3 })).mover, false);
  assert.equal(p.availableCommands(live({ map: "cartographic" })).mover, false);
  const ended = live();
  ended.session.endedAt = "2026-11-06T22:00:00Z";
  assert.equal(p.isMyTurn(ended), false);
  const master = live();
  master.me.isMaster = true;
  assert.equal(p.isMyTurn(master), false);
});

test("reachable cells exclude walls, water, occupied cells and the origin", () => {
  const cells = p
    .reachableCells(crypt, [{ x: 1, y: 3 }], { x: 2, y: 1 }, 2)
    .map((c) => `${c.x},${c.y}`);
  assert.deepEqual(cells.sort(), ["1,1", "1,2", "2,3", "3,1", "3,3"].sort());
  assert.equal(p.canStand(crypt, -1, 0), false);
});

test("feeds split chat, rolls and notes; chat never shows private notes", () => {
  const events = [
    { id: 1, kind: "message" },
    { id: 2, kind: "roll" },
    { id: 3, kind: "action" },
    { id: 4, kind: "note", masterOnly: true },
    { id: 5, kind: "note", masterOnly: false },
    { id: 6, kind: "move" },
  ];
  assert.deepEqual(
    p.feedFor(events, "chat").map((e) => e.id),
    [1, 2, 3, 5],
  );
  assert.deepEqual(
    p.feedFor(events, "rolls").map((e) => e.id),
    [2, 3],
  );
  assert.deepEqual(
    p.feedFor(events, "notes").map((e) => e.id),
    [4, 5],
  );
  assert.equal(p.feedFor(events, "all").length, 6);
  assert.deepEqual(p.eventData({ data: "{bad" }), {});
  assert.deepEqual(p.eventData({ data: '{"a":1}' }), { a: 1 });
});

test("live polling spaces requests and backs off after failures", () => {
  assert.equal(p.nextPollDelay(0, 0), p.MIN_POLL_GAP_MS);
  assert.equal(p.nextPollDelay(0, 5000), 0);
  assert.equal(p.nextPollDelay(1, 0), 2000);
  assert.equal(p.nextPollDelay(9, 0), 30000);
});
