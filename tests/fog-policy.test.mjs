import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = async (file) => import("data:text/javascript;base64," + Buffer.from(await readFile(new URL(file, import.meta.url), "utf8")).toString("base64"));
const p = await load("../apps/Eternnus.Web/wwwroot/js/fog-policy.js");
const domain = await readFile(new URL("../apps/Eternnus.Web/Domain/TableFog.cs", import.meta.url), "utf8");

test("máscaras usam o mesmo bitset em base64 do servidor", () => {
  const set = Array.from({ length: 16 }, (_, i) => i === 0 || i === 9);
  assert.equal(p.encodeBits(set), "AQI=");
  assert.deepEqual([...p.decodeBits("AQI=", 16)].map(Boolean), set);
  assert.equal(p.encodeBits([false, false]), "");
  assert.equal(p.decodeBits("@@inválido", 4).length, 4);
});

test("legenda de bloqueios coincide com TableFog.cs", () => {
  for (const c of ".mld#o") {
    const move = new RegExp(`BlocksMove\\(char c\\) => (.+);`).exec(domain)[1];
    const light = new RegExp(`BlocksLight\\(char c\\) => (.+);`).exec(domain)[1];
    const name = { ".": "Free", m: "BlockMove", l: "BlockLight", d: "DoorClosed", "#": "Wall", o: "DoorOpen" }[c];
    assert.equal(p.blocksMove(c), move.includes(name), `movimento ${c}`);
    assert.equal(p.blocksLight(c), light.includes(name), `luz ${c}`);
  }
});

test("linha de visão: parede bloqueia, canto entre dois blocos fecha e é simétrica", () => {
  const cells = ["..........", "....#.....", "..........", ".........."];
  assert.equal(p.lineClear(cells, 10, 4, 2, 1, 4, 1), true);
  assert.equal(p.lineClear(cells, 10, 4, 2, 1, 5, 1), false);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) assert.equal(p.lineClear(cells, 10, 4, 2, 1, x, y), p.lineClear(cells, 10, 4, x, y, 2, 1));
  assert.equal(p.lineClear(["...", ".#.", "#.."], 3, 3, 0, 1, 1, 2), false);
});

test("prévia de luz ilumina em círculo e respeita paredes", () => {
  const layer = { cells: ["..........", "....#.....", "..........", ".........."], lights: [{ x: 2, y: 1, radius: 3 }], revealed: "" };
  const lit = p.decodeBits(p.sharedPreview(layer, 10, 4), 40);
  assert.equal(lit[1 * 10 + 4], 1);
  assert.equal(lit[1 * 10 + 5], 0);
  assert.equal(lit[3 * 10 + 5], 0);
  assert.equal(lit[3 * 10 + 4], 1);
});

test("alcance com névoa contorna paredes, não corta canto e ignora casas desconhecidas", () => {
  const all = p.encodeBits(Array(16).fill(true));
  const fog = { active: true, cells: ["....", ".#..", "#...", "...."], explored: all };
  const reach = p.fogReach(fog, 4, 4, [], { x: 0, y: 1 }, 1);
  assert.ok(!reach.some((c) => c.x === 1 && c.y === 2), "não corta o canto");
  const known = p.encodeBits(Array.from({ length: 16 }, (_, i) => i % 4 < 2));
  assert.ok(!p.fogReach({ ...fog, explored: known }, 4, 4, [], { x: 0, y: 0 }, 5).some((c) => c.x >= 2));
  assert.equal(p.fogReach({ active: false }, 4, 4, [], { x: 0, y: 0 }, 2), null);
  const occupied = p.fogReach(fog, 4, 4, [{ x: 1, y: 0 }], { x: 0, y: 0 }, 1);
  assert.ok(!occupied.some((c) => c.x === 1 && c.y === 0));
});

test("pintura local espelha as ferramentas do servidor", () => {
  let layer = { cells: ["...", "..."], revealed: "", lights: [], marks: [] };
  layer = p.paintLocal(layer, 3, "wall", [{ x: 0, y: 0 }]);
  layer = p.paintLocal(layer, 3, "door", [{ x: 1, y: 0 }]);
  layer = p.paintLocal(layer, 3, "reveal", [{ x: 2, y: 1 }]);
  assert.deepEqual(layer.cells, ["#d.", "..."]);
  assert.equal(p.decodeBits(layer.revealed, 6)[5], 1);
  assert.deepEqual(p.toggleDoorLocal(layer, 1, 0).cells, ["#o.", "..."]);
  assert.equal(p.toggleDoorLocal(layer, 0, 0), null);
});

test("campos de configuração são os mesmos de TableSettings e validam limites", () => {
  const props = [...domain.matchAll(/public (?:bool|int|string) (\w+) \{ get; init; \}/g)].map((m) => m[1][0].toLowerCase() + m[1].slice(1));
  assert.deepEqual(p.SETTING_FIELDS.map((f) => f.key).sort(), props.sort());
  const ok = p.settingsFromForm({ fogEnabled: "on", rememberExplored: "on", torchRadius: "4", brazierRadius: "3", creatureLight: "0", playerLightMeters: "0", playerVisionMeters: "18" });
  assert.equal(ok.fogEnabled, true);
  assert.equal(ok.pathMovement, false);
  assert.equal(ok.playerVisionMeters, 18);
  assert.throws(() => p.settingsFromForm({ torchRadius: "31", brazierRadius: "0", creatureLight: "0", playerLightMeters: "0", playerVisionMeters: "0" }));
  assert.equal(p.normalizeSettings({ TorchRadius: 2 }).torchRadius, 2);
});

test("papéis de ficha do editor coincidem com SheetFieldRoles", async () => {
  const platform = await readFile(new URL("../apps/Eternnus.Web/Domain/Platform.cs", import.meta.url), "utf8");
  const editor = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/sheet-editor-policy.js", import.meta.url), "utf8");
  const server = [...platform.match(/class SheetFieldRoles[\s\S]+?All = \[/)[0].matchAll(/= "(\w+)"/g)].map((m) => m[1]);
  const client = [...editor.match(/FIELD_ROLES = Object\.freeze\(\[([\s\S]+?)\]\);/)[1].matchAll(/value: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(client.sort(), server.sort());
});

test("alcance de ataque cobre as casas a até N quadrados (diagonal 1) e some sem alcance na ficha", () => {
  const cells = p.attackCells(10, 10, { x: 0, y: 0 }, 2);
  assert.equal(cells.length, 8); // 3×3 dentro do mapa menos a própria casa
  assert.ok(cells.some((c) => c.x === 2 && c.y === 2));
  assert.deepEqual(p.attackCells(10, 10, { x: 5, y: 5 }, 0), []);
  assert.deepEqual(p.attackCells(10, 10, null, 3), []);
});
