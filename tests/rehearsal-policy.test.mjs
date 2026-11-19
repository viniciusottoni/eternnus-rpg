import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_PRESETS, profileFor, profileLabel, sandboxFrom, nextRehearsalLabel, rehearsalToken, rehearsalDiff, diffLines, applyRehearsal,
  sandboxChanged, observerOptions, defaultObserver, viewerFields, previewProfiles,
} from "../apps/Eternnus.Web/wwwroot/js/rehearsal-policy.js";

const prepared = [
  { characterId: "c1", label: "Aria", side: "ally", x: 1, y: 1, layer: "elements" },
  { slotId: "s1", label: "Guerreiro", side: "ally", x: 2, y: 1, layer: "elements" },
  { masterCharacterId: "n1", label: "Lobo", side: "enemy", x: 4, y: 3, size: null, layer: "elements" },
];

test("presets de perfil são genéricos e a visão no escuro usa o formato de sentidos da mesa", () => {
  assert.deepEqual(PROFILE_PRESETS.map((p) => p.id), ["default", "wide", "dark", "nolight", "torch", "custom"]);
  assert.deepEqual(profileFor("default"), {});
  assert.deepEqual(profileFor("wide"), { visionMeters: 36 });
  assert.deepEqual(profileFor("nolight"), { lightMeters: 0 });
  assert.deepEqual(profileFor("torch"), { lightMeters: 12 });
  const dark = profileFor("dark");
  assert.match(dark.senses, /^[^:;,\n]+:\s*\d+$/, "nome: metros, como TableFog.ParseSenses");
  assert.deepEqual(profileFor("custom", { visionMeters: "24", lightMeters: "", perception: 9999 }), { visionMeters: 24, perception: 1000 });
  assert.deepEqual(profileFor("custom", { visionMeters: -3 }), { visionMeters: 0 });
  assert.deepEqual(profileFor("inexistente"), {});
  assert.equal(profileLabel({ id: "torch" }), "Carregando uma fonte de luz");
  assert.equal(profileLabel({ id: "custom", custom: { visionMeters: 6 } }), "Personalizado: visão 6 m");
  assert.equal(profileLabel({ id: "default" }), "");
});

test("a caixa de areia é uma cópia profunda: mexer nela não altera a preparação", () => {
  const sandbox = sandboxFrom(prepared);
  sandbox[0].x = 9;
  assert.equal(prepared[0].x, 1);
  assert.deepEqual(sandbox.map((t) => [t.ref, t.key]), [[0, "p0"], [1, "p1"], [2, "p2"]]);
  assert.equal(sandboxChanged(sandboxFrom(prepared), sandboxFrom(prepared)), false);
  assert.equal(sandboxChanged(sandboxFrom(prepared), sandbox), true);
});

test("tokens de ensaio recebem rótulos livres e nunca são aplicados", () => {
  const sandbox = sandboxFrom(prepared);
  sandbox.push(rehearsalToken(sandbox, { x: 0, y: 0 }, "r1"));
  assert.equal(sandbox[3].label, "Ensaio 1");
  assert.equal(sandbox[3].rehearsal, true);
  assert.equal(nextRehearsalLabel(sandbox), "Ensaio 2");
  const next = applyRehearsal(prepared, sandbox);
  assert.equal(next.length, 3);
  assert.ok(next.every((t) => !t.rehearsal && !("ref" in t) && !("key" in t)));
});

test("diferença conta movidos, redimensionados, removidos, convertidos e lista os só de ensaio", () => {
  const sandbox = sandboxFrom(prepared);
  sandbox[0] = { ...sandbox[0], x: 3, y: 0 };
  sandbox[1] = { ...sandbox[1], appearance: "image", width: 200, height: 200 };
  sandbox.splice(2, 1); // Lobo removido
  sandbox.push({ ...rehearsalToken(sandbox, { x: 0, y: 4 }, "r1") });
  sandbox.push({ ...rehearsalToken(sandbox, { x: 1, y: 4 }, "r2"), rehearsal: false, slotId: "s2", label: "Novo", converted: true });
  const diff = rehearsalDiff(prepared, sandbox);
  assert.deepEqual(diff.moved, ["Aria"]);
  assert.deepEqual(diff.resized, ["Guerreiro"]);
  assert.deepEqual(diff.removed, ["Lobo"]);
  assert.deepEqual(diff.converted, ["Novo"]);
  assert.deepEqual(diff.rehearsalOnly, ["Ensaio 1"]);
  assert.equal(diff.changed, 4);
  const lines = diffLines(diff);
  assert.ok(lines.some((l) => l.startsWith("1 movido(s)")));
  assert.ok(lines.some((l) => l.includes("Não serão salvos") && l.includes("Ensaio 1")));
  const next = applyRehearsal(prepared, sandbox);
  assert.deepEqual(next.map((t) => t.label), ["Aria", "Guerreiro", "Novo"]);
  assert.equal(next[0].x, 3);
  assert.equal(next[1].width, 200);
  assert.equal(next[2].slotId, "s2");
  assert.ok(!("converted" in next[2]));
  assert.equal(prepared[0].x, 1, "a preparação original continua igual");
});

test("observador: grupo, personagens, reservados e tokens de ensaio viram campos da prévia", () => {
  const sandbox = sandboxFrom(prepared);
  sandbox.push(rehearsalToken(sandbox, { x: 0, y: 0 }, "r1"));
  const values = observerOptions(sandbox).map((o) => o.value);
  assert.deepEqual(values, ["", "party", "c:c1", "t:p1", "t:r1"]);
  assert.equal(defaultObserver(sandbox), "c:c1");
  assert.equal(defaultObserver(sandbox.filter((t) => !t.characterId)), "t:p1");
  assert.equal(defaultObserver([]), "");
  assert.deepEqual(viewerFields("t:r1", sandbox), { viewerCharacterId: null, viewerToken: 3, party: false });
  assert.deepEqual(viewerFields("c:c1", sandbox), { viewerCharacterId: "c1", viewerToken: null, party: false });
  assert.deepEqual(viewerFields("party", sandbox), { viewerCharacterId: null, viewerToken: null, party: true });
  assert.deepEqual(viewerFields("c:sumiu", sandbox), { viewerCharacterId: null, viewerToken: null, party: false });
  // Sem personagens dos jogadores, não há opção de grupo (funciona sem jogadores).
  assert.ok(!observerOptions([rehearsalToken([], { x: 0, y: 0 }, "r1")]).some((o) => o.value === "party"));
});

test("perfis enviados usam o índice do token no array enviado e omitem o padrão", () => {
  const sandbox = sandboxFrom(prepared);
  sandbox.push(rehearsalToken(sandbox, { x: 0, y: 0 }, "r1"));
  const choices = new Map([["r1", { id: "torch" }], ["p0", { id: "default" }], ["p1", { id: "custom", custom: { perception: 12 } }]]);
  assert.deepEqual(previewProfiles(sandbox, choices), [{ token: 1, perception: 12 }, { token: 3, lightMeters: 12 }]);
});
