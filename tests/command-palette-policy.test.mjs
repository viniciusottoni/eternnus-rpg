import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const p = await import("../apps/Eternnus.Web/wwwroot/js/command-palette-policy.js");

const commands = [
  { id: "scene", label: "Trocar cena", group: "Cena", keywords: ["mapa"] },
  { id: "npc", label: "Adicionar NPC", group: "Personagens", masterOnly: true, keywords: ["monstro", "inimigo"] },
  { id: "test", label: "Pedir teste", group: "Rolagens", masterOnly: true, keywords: ["perícia", "dado"] },
  { id: "turns", label: "Iniciar turnos", group: "Combate", masterOnly: true, basic: false, keywords: ["iniciativa"] },
  { id: "roll", label: "Rolar dados", group: "Rolagens", basic: true },
  { id: "light", label: "Luz e visão", group: "Iluminação", basic: false, disabled: "Escolha um marcador primeiro." },
  { id: "notes", label: "Anotações da sessão", group: "Sessão" },
];
const master = { role: "master", mode: "complete" };
const ids = (list) => list.map((c) => c.id);

test("empty query returns every visible command in original order, limited to 50", () => {
  assert.deepEqual(ids(p.rankCommands(commands, "", master)), ids(commands));
  assert.deepEqual(ids(p.rankCommands(commands, "   ", master)), ids(commands));
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, label: `Ação ${i}`, group: "G" }));
  const out = p.rankCommands(many, "", master);
  assert.equal(out.length, p.COMMAND_LIMIT);
  assert.equal(p.COMMAND_LIMIT, 50);
  assert.equal(out[0].id, "c0");
  assert.equal(p.rankCommands(many, "acao", master).length, 50);
  assert.deepEqual(p.rankCommands(null, "x", master), []);
});

test("matching ignores case and accents in label, keywords and group", () => {
  assert.deepEqual(ids(p.rankCommands(commands, "LUZ E VISAO", master)), ["light"]);
  assert.deepEqual(ids(p.rankCommands(commands, "anotacoes", master)), ["notes"]);
  assert.deepEqual(ids(p.rankCommands(commands, "pericia", master)), ["test"]);
  assert.deepEqual(ids(p.rankCommands(commands, "ILUMINAÇÃO", master)), ["light"]);
  assert.deepEqual(ids(p.rankCommands(commands, "mapa", master)), ["scene"]);
  assert.deepEqual(ids(p.rankCommands(commands, "zzz", master)), []);
});

test("word prefix beats substring, which beats subsequence; ties keep label matches and original order", () => {
  assert.equal(p.termTier("dic", "dica rapida"), 3);
  assert.equal(p.termTier("dic", "condicao"), 2);
  assert.equal(p.termTier("dcn", "adicionar"), 1);
  assert.equal(p.termTier("xq", "adicionar"), 0);
  const order = ids(p.rankCommands([
    { id: "seq", label: "Abrir menu de dados", group: "G" }, // "amd": letras em ordem
    { id: "none", label: "Zebra", group: "G" },              // não casa
    { id: "mid", label: "Xamdz", group: "G" },               // "amd": trecho no meio da palavra
    { id: "pre", label: "Amdo", group: "G" },                // "amd": início de palavra
    { id: "pre2", label: "Outro amdo", group: "G" },         // mesmo nível: mantém a ordem original
  ], "amd", master));
  assert.deepEqual(order, ["pre", "pre2", "mid", "seq"]);
  // Empate de força: quem casa no rótulo vem antes de quem só casa em palavra-chave.
  const tie = ids(p.rankCommands([
    { id: "kw", label: "Outra coisa", group: "G", keywords: ["turnos"] },
    { id: "label", label: "Turnos", group: "G" },
  ], "turn", master));
  assert.deepEqual(tie, ["label", "kw"]);
  // Vários termos: todos precisam casar.
  assert.deepEqual(ids(p.rankCommands(commands, "adic npc", master)), ["npc"]);
  assert.deepEqual(ids(p.rankCommands(commands, "adic cena", master)), []);
});

test("masterOnly commands are hidden from players", () => {
  const player = { role: "player", mode: "complete" };
  assert.deepEqual(ids(p.rankCommands(commands, "", player)), ["scene", "roll", "light", "notes"]);
  assert.deepEqual(ids(p.rankCommands(commands, "npc", player)), []);
  assert.deepEqual(ids(p.rankCommands(commands, "npc", {})), []);
  assert.deepEqual(ids(p.rankCommands(commands, "npc", master)), ["npc"]);
});

test("basic mode keeps Complete-only tools but flags them; complete mode never flags", () => {
  const basic = p.rankCommands(commands, "", { role: "master", mode: "basic" });
  assert.deepEqual(ids(basic), ids(commands));
  assert.deepEqual(basic.filter((c) => c.needsComplete).map((c) => c.id), ["turns", "light"]);
  assert.equal(basic.find((c) => c.id === "roll").needsComplete, false);
  assert.equal(basic.find((c) => c.id === "scene").needsComplete, false);
  assert.ok(p.rankCommands(commands, "", master).every((c) => c.needsComplete === false));
  // Devolve cópias: a lista do chamador não é alterada; o motivo de indisponibilidade segue junto.
  assert.equal("needsComplete" in commands[3], false);
  assert.equal(basic.find((c) => c.id === "light").disabled, "Escolha um marcador primeiro.");
});

const key = (key, extra = {}, target = { tagName: "DIV" }) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, ...extra });

test("Ctrl+K and Cmd+K open anywhere, even while typing", () => {
  assert.equal(p.shouldOpenPalette(key("k", { ctrlKey: true })), true);
  assert.equal(p.shouldOpenPalette(key("K", { ctrlKey: true, shiftKey: true })), true);
  assert.equal(p.shouldOpenPalette(key("k", { metaKey: true })), true);
  assert.equal(p.shouldOpenPalette(key("k", { ctrlKey: true }, { tagName: "INPUT" })), true);
  assert.equal(p.shouldOpenPalette(key("k", { metaKey: true }, { tagName: "TEXTAREA" })), true);
  assert.equal(p.shouldOpenPalette(key("k", { ctrlKey: true, altKey: true })), false);
  assert.equal(p.shouldOpenPalette(key("k")), false);
  assert.equal(p.shouldOpenPalette(key("j", { ctrlKey: true })), false);
  assert.equal(p.shouldOpenPalette(key("k", { ctrlKey: true, isComposing: true })), false);
  assert.equal(p.shouldOpenPalette(null), false);
});

test('"/" opens only outside text fields and without Ctrl, Cmd or Alt', () => {
  assert.equal(p.shouldOpenPalette(key("/")), true);
  assert.equal(p.shouldOpenPalette(key("/", {}, { tagName: "BUTTON" })), true);
  assert.equal(p.shouldOpenPalette(key("/", {}, null)), true);
  assert.equal(p.shouldOpenPalette(key("/", { shiftKey: true })), true);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) assert.equal(p.shouldOpenPalette(key("/", {}, { tagName })), false, tagName);
  assert.equal(p.shouldOpenPalette(key("/", {}, { tagName: "DIV", isContentEditable: true })), false);
  assert.equal(p.shouldOpenPalette(key("/", { ctrlKey: true })), false);
  assert.equal(p.shouldOpenPalette(key("/", { metaKey: true })), false);
  assert.equal(p.shouldOpenPalette(key("/", { altKey: true })), false);
});

test("the policy module stays pure (no DOM, storage or network)", async () => {
  const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/command-palette-policy.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|localStorage|document\.|window\./);
});
