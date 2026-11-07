// Linguagem de fórmulas no cliente (wwwroot/js/formula.js) contra os casos compartilhados com o C#
// (tests/fixtures/formula-cases.json, também executados por tests/Eternnus.Tests/FormulaTests.cs).
// Mesmo arquivo, mesmas expectativas: qualquer divergência C# × JS quebra um dos dois lados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/formula.js", import.meta.url), "utf8");
const f = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const cases = JSON.parse(await readFile(new URL("./fixtures/formula-cases.json", import.meta.url), "utf8"));

/** Monta a expressão: "expr" literal ou "build" = [[trecho, repetições], ...] concatenados. */
const expressionOf = (c) => (c.build ? c.build.map(([part, times]) => part.repeat(times)).join("") : c.expr);
const label = (c) => {
  const text = c.name ?? expressionOf(c);
  return JSON.stringify(text.length > 60 ? text.slice(0, 60) + "…" : text);
};

/** Gerador determinístico que devolve a sequência fixa do caso; falha se a engine pedir dados a mais. */
function scripted(values) {
  const queue = [...values];
  const die = (sides) => {
    assert.ok(Number.isInteger(sides) && sides > 0, "faces inválidas pedidas ao gerador");
    assert.ok(queue.length > 0, "a engine pediu mais dados do que o caso fornece");
    return queue.shift();
  };
  die.remaining = () => queue.length;
  return die;
}

/** Campos gerados: N campos number válidos f1..fN (mesma regra do C#). */
function fieldsOf(c) {
  if (!c.generate) return c.fields;
  return Array.from({ length: c.generate.count }, (_, i) => ({
    name: `f${i + 1}`,
    label: `F${i + 1}`,
    type: "number",
    page: 0,
    x: 0.1,
    y: 0.02,
    w: 0.3,
    h: 0.02,
  }));
}

const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof f.FormulaError, `erro inesperado: ${error}`);
    return error;
  }
  assert.fail("a fórmula deveria falhar");
};

test("o arquivo de casos tem todas as seções e nenhum caso vazio", () => {
  for (const key of ["evaluate", "evaluateErrors", "validate", "rolls", "rollErrors", "format", "validateFields", "compute"])
    assert.ok(Array.isArray(cases[key]) && cases[key].length > 0, key);
});

test("evaluate: resultado exato", () => {
  for (const c of cases.evaluate) assert.equal(f.evaluate(expressionOf(c), c.scope ?? {}), c.result, label(c));
});

test("evaluateErrors: mensagem e posição", () => {
  for (const c of cases.evaluateErrors) {
    const error = thrown(() => f.evaluate(expressionOf(c), c.scope ?? {}));
    assert.equal(error.message, c.error, label(c));
    assert.equal(error.position ?? null, c.position ?? null, label(c) + " posição");
  }
});

test("validate: ok, erro, posição e referências", () => {
  for (const c of cases.validate) {
    const result = f.validate(expressionOf(c), c.mode, c.known ?? null);
    assert.equal(result.ok, c.ok, label(c) + " " + result.error);
    if (c.ok) {
      assert.deepEqual(result.references, c.references, label(c));
      assert.equal(result.error, null);
    } else {
      assert.equal(result.error, c.error, label(c));
      assert.equal(result.position ?? null, c.position ?? null, label(c) + " posição");
      assert.deepEqual(result.references, []);
    }
  }
});

test("validate: knownNames aceita array ou Set", () => {
  assert.equal(f.validate("@a + @b", "deterministic", new Set(["a", "b"])).ok, true);
  assert.equal(f.validate("@a + @b", "deterministic", ["a"]).error, "Campo desconhecido: @b");
});

test("rolls: total, detalhamento e grupos com gerador determinístico", () => {
  for (const c of cases.rolls) {
    const die = scripted(c.dice);
    const result = f.rollPreview(expressionOf(c), c.scope ?? {}, die);
    assert.equal(result.total, c.total, label(c));
    assert.equal(result.breakdown, c.breakdown, label(c));
    assert.equal(die.remaining(), 0, label(c) + " usou todos os dados");
    if (c.groups) assert.deepEqual(result.dice, c.groups, label(c) + " grupos");
  }
});

test("rollErrors: mensagem", () => {
  for (const c of cases.rollErrors) {
    const error = thrown(() => f.rollPreview(expressionOf(c), c.scope ?? {}, scripted(c.dice ?? [])));
    assert.equal(error.message, c.error, label(c));
  }
});

test("format: duas casas, meio para longe de zero, sem notação científica", () => {
  for (const [value, expected] of cases.format) assert.equal(f.formatNumber(value), expected, String(value));
});

test("validateFields: lista exata de erros", () => {
  for (const c of cases.validateFields) assert.deepEqual(f.validateFields(fieldsOf(c)), c.errors, label(c));
});

test("compute: valores finais e escopo numérico", () => {
  for (const c of cases.compute) {
    const fields = fieldsOf(c);
    const computed = f.computeSheet(fields, c.values ?? {});
    assert.deepEqual({ ...computed }, c.expected, label(c));
    if (c.scope) assert.deepEqual({ ...f.sheetScope(fields, computed) }, c.scope, label(c) + " escopo");
  }
});

// ---------- Propriedades além dos casos ----------

test("rollPreview sem gerador usa crypto e respeita as faces", () => {
  for (let i = 0; i < 200; i++) {
    const r = f.rollPreview("4d6kh3", {});
    assert.equal(r.dice.length, 1);
    assert.ok(r.dice[0].values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6));
    assert.ok(r.total >= 3 && r.total <= 18);
  }
  const d100 = f.rollPreview("100d100", {});
  assert.ok(d100.dice[0].values.every((v) => v >= 1 && v <= 100));
});

test("mesma sequência de dados → mesmo resultado (determinismo)", () => {
  const seq = [3, 6, 1, 4, 2, 5, 17, 2, 3];
  const a = f.rollPreview("4d6kh3 + 2d6dl1 + 1d20 + 2d4 * 2", {}, scripted(seq));
  const b = f.rollPreview("4d6kh3 + 2d6dl1 + 1d20 + 2d4 * 2", {}, scripted(seq));
  assert.deepEqual(a, b);
  assert.equal(a.total, 13 + 5 + 17 + 10);
  assert.equal(a.breakdown, "4d6kh3[3, 6, ~1~, 4] + 2d6dl1[~2~, 5] + 1d20[17] + 2d4[2, 3] * 2 = 45");
});

test("escopo lê somente propriedades próprias (sem protótipo)", () => {
  assert.equal(f.evaluate("@constructor + @tostring + @valueof", {}), 0);
  const inherited = Object.create({ forca: 99 });
  assert.equal(f.evaluate("@forca", inherited), 0);
});

test("-0 é normalizado para 0 (paridade com o JSON do servidor)", () => {
  assert.ok(Object.is(f.evaluate("-0", {}), 0));
  assert.ok(Object.is(f.evaluate("-@a * 5", { a: 0 }), 0));
  assert.ok(Object.is(f.rollPreview("-(1d4 >= 5)", {}, () => 1).total, 0));
});

test("references: ordem da primeira aparição; inválida → []", () => {
  assert.deepEqual(f.references("@b + @a + @b + 1d6"), ["b", "a"]);
  assert.deepEqual(f.references("1 +"), []);
  assert.deepEqual(f.references(null), []);
});

test("entradas não textuais nunca executam código", () => {
  for (const value of [null, undefined, 42, {}, [], { toString: () => "1+1" }]) {
    const result = f.validate(value, "deterministic");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Informe uma fórmula.");
  }
});

test("limites: 300 caracteres, 200 elementos, 32 níveis, 200 dados", () => {
  assert.equal(f.validate("1 + ".repeat(74) + "1000", "deterministic").ok, true); // exatamente 300 caracteres
  assert.equal(f.validate("1".repeat(300), "deterministic").error, "Número grande demais na posição 1.");
  assert.equal(f.validate("1".repeat(301), "deterministic").error, "Fórmula longa demais (máx. 300 caracteres).");
  assert.equal(f.validate("(".repeat(32) + "1" + ")".repeat(32), "deterministic").ok, true);
  assert.match(f.validate("(".repeat(33) + "1" + ")".repeat(33), "deterministic").error, /Aninhamento profundo/);
  assert.equal(f.validate("100d6 + 100d6", "roll").ok, true);
  assert.match(f.validate("100d6 + 100d6 + 1d4", "roll").error, /Dados demais/);
  assert.equal(f.validate("1+".repeat(99) + "1", "deterministic").ok, true);
  assert.match(f.validate("1+".repeat(100) + "1", "deterministic").error, /200 elementos/);
});

test("parseNumber e isValidName", () => {
  assert.equal(f.parseNumber("2,5"), 2.5);
  assert.equal(f.parseNumber("1e3"), null);
  assert.equal(f.parseNumber(" -0 "), 0);
  assert.equal(Object.is(f.parseNumber("-0"), -0), false);
  assert.equal(f.isValidName("a".repeat(40)), true);
  assert.equal(f.isValidName("a".repeat(41)), false);
  assert.equal(f.isValidName("Forca"), false);
});
