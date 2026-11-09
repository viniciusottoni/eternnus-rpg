// Regras puras de progresso. Os números são os mesmos de tests/Eternnus.Tests/ProgressionTests.cs (curva do C#).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/progress-policy.js", import.meta.url),
  "utf8",
);
const p = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test("xp para cada nível segue 50·(n−1)·n", () => {
  for (const [level, xp] of [
    [1, 0],
    [2, 100],
    [3, 300],
    [5, 1000],
    [10, 4500],
    [100, 495000],
  ])
    assert.equal(p.xpForLevel(level), xp, `nível ${level}`);
  assert.equal(p.xpForLevel(0), 0);
  assert.equal(p.xpForLevel(250), 495000);
});

test("nível alcançado para um XP total", () => {
  for (const [xp, level] of [
    [-5, 1],
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [999, 4],
    [1000, 5],
    [4499, 9],
    [4500, 10],
    [494999, 99],
    [495000, 100],
    [10_000_000, 100],
  ])
    assert.equal(p.levelForXp(xp), level, `xp ${xp}`);
  for (let n = 2; n <= p.MAX_LEVEL; n++) {
    assert.equal(p.levelForXp(p.xpForLevel(n)), n);
    assert.equal(p.levelForXp(p.xpForLevel(n) - 1), n - 1);
  }
});

test("progresso dentro do nível", () => {
  assert.deepEqual(p.levelProgress(150), { xp: 150, level: 2, levelXp: 100, nextLevelXp: 300, percent: 25, remaining: 150 });
  assert.deepEqual(p.levelProgress(-20), { xp: 0, level: 1, levelXp: 0, nextLevelXp: 100, percent: 0, remaining: 100 });
  assert.deepEqual(p.levelProgress(4499), { xp: 4499, level: 9, levelXp: 3600, nextLevelXp: 4500, percent: 99, remaining: 1 });
  assert.deepEqual(p.levelProgress(500000), { xp: 500000, level: 100, levelXp: 495000, nextLevelXp: null, percent: 100, remaining: 0 });
});

test("formatação em pt-BR", () => {
  assert.equal(p.formatXp(1250), "1.250 XP");
  assert.equal(p.formatXp("x"), "0 XP");
  assert.equal(p.formatSigned(30), "+30");
  assert.equal(p.formatSigned(-1200), "−1.200");
  assert.equal(p.formatSigned(0), "0");
  assert.equal(p.amountLabel(50), "+50 XP");
  assert.equal(p.amountLabel(null), "Variável");
  assert.equal(p.dailyLimitLabel(10), "10 por dia");
  assert.equal(p.dailyLimitLabel(null), "Sem limite diário");
  assert.equal(p.todayLabel(2, 10), "2 de 10 hoje");
  assert.equal(p.todayLabel(10, 10), "Limite de hoje atingido");
  assert.equal(p.todayLabel(3, null), "");
  assert.equal(p.progressText(p.levelProgress(150)), "50 XP de 200 XP para o nível 3 (25%)");
  assert.equal(p.progressText(p.levelProgress(495000)), "Nível máximo alcançado · 495.000 XP");
});

test("ranking, conquistas e próximos desbloqueios", () => {
  assert.equal(p.rankingPeriod("week"), "week");
  assert.equal(p.rankingPeriod(undefined), "all");
  assert.equal(p.rankingPeriod("<script>"), "all");
  const sorted = p.sortAchievements([
    { key: "a", unlocked: false },
    { key: "b", unlocked: true, unlockedAt: "2026-11-01T10:00:00Z" },
    { key: "c", unlocked: true, unlockedAt: "2026-11-05T10:00:00Z" },
    { key: "d", unlocked: false },
  ]);
  assert.deepEqual(sorted.map((a) => a.key), ["c", "b", "a", "d"]);
  const next = p.nextUnlocks([
    { key: "x", level: 3, unlocked: false },
    { key: "y", level: 1, unlocked: true },
    { key: "z", level: 2, unlocked: false },
  ]);
  assert.deepEqual(next.map((u) => u.key), ["z", "x"]);
});

test("datas do servidor (UTC) formatadas em pt-BR", () => {
  assert.equal(p.formatDay("2026-11-07T22:30:00Z", false, "UTC"), "07/11/2026");
  assert.equal(p.formatDay("2026-11-07T22:30:00", false, "UTC"), "07/11/2026");
  assert.match(p.formatDay("2026-11-07T22:30:00Z", true, "UTC"), /^07\/11\/2026,? 22:30$/);
  assert.equal(p.formatDay("2026-11-08T01:30:00Z", false, "America/Sao_Paulo"), "07/11/2026");
  assert.equal(p.formatDay("não é data"), "");
  assert.equal(p.formatDay(null), "");
});

test("marcos sugerem caminhos distintos, próximos e com destinos conhecidos", () => {
  const items = [
    { key: "done", counter: "sessions", current: 3, threshold: 3, unlocked: true },
    { key: "near", counter: "sessions", current: 3, threshold: 5, unlocked: false },
    { key: "far", counter: "sessions", current: 3, threshold: 25, unlocked: false },
    { key: "help", counter: "useful_received", current: 4, threshold: 5, unlocked: false },
    { key: "unsafe", counter: "https://foreign.test", current: 1, threshold: 2, unlocked: false },
  ];
  const result = p.nextMilestones(items);
  assert.deepEqual(result.map(a => a.key), ["help", "near"]);
  assert.deepEqual(result.map(a => a.href), ["#guild", "#campaigns"]);
  assert.equal(p.amountLabel(0), "Sem XP");
  assert.equal(p.dailyLimitLabel(0), "Sem pontuação");
  assert.equal(p.todayLabel(0, 0), "");
});
