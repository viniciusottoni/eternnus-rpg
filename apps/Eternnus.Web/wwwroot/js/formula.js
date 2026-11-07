// Linguagem de fórmulas no cliente: espelho fiel de Domain/Formulas/*.cs para pré-visualização no editor e na ficha.
// O servidor é a autoridade: valida ao salvar e rola os dados da mesa.
// Segurança: sem eval/Function, sem regex sobre a fórmula, alfabeto fechado (ASCII + × ÷ −), recursão limitada (profundidade 32,
// 200 elementos), funções resolvidas por switch e escopo lido somente por propriedades próprias (sem protótipo).
// Toda mudança aqui exige a mesma mudança no C# e um caso em tests/fixtures/formula-cases.json.

export const LIMITS = Object.freeze({
  length: 300,
  tokens: 200,
  depth: 32,
  dice: 200,
  dicePerGroup: 100,
  arguments: 10,
  literal: 1e9,
  value: 1e12,
  fields: 300,
});

const ALLOWED_SIDES = [4, 6, 8, 10, 12, 20, 100];
const TRUTHY = ["true", "1", "on", "sim"];
const FIELD_TYPES = ["text", "number", "textarea", "checkbox", "select", "computed"];
const FIELD_ROLES = ["name", "level", "hp", "maxHp", "movement", "armor"];
const NUMERIC_ROLES = ["level", "hp", "maxHp", "movement", "armor"];

export class FormulaError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = "FormulaError";
    this.position = position;
  }
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isDigit = (c) => c >= "0" && c <= "9";
const isLower = (c) => c >= "a" && c <= "z";
const isLetter = (c) => isLower(c) || (c >= "A" && c <= "Z");
const isNameChar = (c) => isLetter(c) || isDigit(c) || c === "_";
const isSpace = (c) => c === " " || c === "\t" || c === "\r" || c === "\n";
const isRunChar = (c) => isNameChar(c) || c === "." || c === "%";
const at = (position) => String(position + 1);
const short = (name) => (name.length > 20 ? name.slice(0, 20) + "…" : name);

function asciiLower(value) {
  let out = "";
  for (const c of value) out += c >= "A" && c <= "Z" ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
  return out;
}

/** Nome de campo: ^[a-z][a-z0-9_]{0,39}$ (verificado sem regex). */
export function isValidName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 40 || !isLower(name[0])) return false;
  for (const c of name) if (!(isLower(c) || isDigit(c) || c === "_")) return false;
  return true;
}

/** Arredonda ao inteiro mais próximo; meio para longe de zero (igual ao servidor, diferente de Math.round). */
export function roundHalfAwayFromZero(value) {
  const magnitude = Math.abs(value);
  let floor = Math.floor(magnitude);
  if (magnitude - floor >= 0.5) floor += 1;
  return value < 0 ? -floor : floor;
}

/**
 * Centavos de um valor não negativo, arredondados meio para longe de zero sobre o valor binário EXATO do double
 * (aritmética inteira com BigInt, igual ao servidor). Evita o duplo arredondamento de value * 100:
 * 2.675 é 2.67499999… e vira 2.67; empates exatos (0.125, 0.625) sobem.
 */
function centsOf(magnitude) {
  if (magnitude === 0) return 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, magnitude);
  const bits = view.getBigUint64(0);
  let exponent = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & 0xfffffffffffffn;
  if (exponent === 0) exponent = 1;
  else mantissa |= 1n << 52n;
  exponent -= 1075; // magnitude = mantissa × 2^exponent
  const scaled = mantissa * 100n;
  if (exponent >= 0) return Number(scaled << BigInt(exponent));
  const divisor = 1n << BigInt(-exponent);
  let quotient = scaled / divisor;
  if ((scaled % divisor) * 2n >= divisor) quotient += 1n;
  return Number(quotient);
}

/** Até 2 casas (meio para longe de zero sobre o valor exato), sem zeros à direita, ponto decimal. Não finito ou acima de 1e12 → "". */
export function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > LIMITS.value) return "";
  const cents = centsOf(Math.abs(value));
  if (cents === 0) return "0";
  const whole = Math.floor(cents / 100);
  const fraction = cents - whole * 100;
  let result = (value < 0 ? "-" : "") + String(whole);
  if (fraction !== 0) result += "." + (fraction < 10 ? "0" : "") + (fraction % 10 === 0 ? String(fraction / 10) : String(fraction));
  return result;
}

// ---------- Analisador léxico ----------

function isNumberText(w) {
  let i = 0;
  while (i < w.length && isDigit(w[i])) i++;
  if (i === 0) return false;
  if (i === w.length) return true;
  if (w[i] !== ".") return false;
  const fractionStart = ++i;
  while (i < w.length && isDigit(w[i])) i++;
  return i > fractionStart && i === w.length;
}

function looksLikeDice(w) {
  let j = 0;
  while (j < w.length && isDigit(w[j])) j++;
  return j + 1 < w.length && w[j] === "d" && (isDigit(w[j + 1]) || w[j + 1] === "%");
}

const smallInt = (digits) => (digits.length === 0 || digits.length > 3 ? -1 : Number(digits));

function tryDice(w, start) {
  let j = 0;
  while (j < w.length && isDigit(w[j])) j++;
  const countText = w.slice(0, j);
  if (j >= w.length || w[j] !== "d") return null;
  j++;
  let sidesText;
  if (j < w.length && w[j] === "%") {
    sidesText = "100";
    j++;
  } else {
    const sidesStart = j;
    while (j < w.length && isDigit(w[j])) j++;
    if (j === sidesStart) return null;
    sidesText = w.slice(sidesStart, j);
  }
  let mode = "";
  let keepText = "";
  if (j < w.length) {
    if (j + 2 > w.length) return null;
    mode = w.slice(j, j + 2);
    if (mode !== "kh" && mode !== "kl" && mode !== "dh" && mode !== "dl") return null;
    j += 2;
    const keepStart = j;
    while (j < w.length && isDigit(w[j])) j++;
    if (j !== w.length) return null;
    keepText = w.slice(keepStart, j);
  }
  const count = countText.length === 0 ? 1 : smallInt(countText);
  if (count < 1 || count > LIMITS.dicePerGroup) throw new FormulaError(`Quantidade de dados deve ser de 1 a 100 (posição ${at(start)}).`, start);
  const sides = smallInt(sidesText);
  if (!ALLOWED_SIDES.includes(sides)) throw new FormulaError(`Dado deve ter 4, 6, 8, 10, 12, 20 ou 100 faces (posição ${at(start)}).`, start);
  let keep = 0;
  if (mode.length > 0) {
    keep = keepText.length === 0 ? 1 : smallInt(keepText);
    if (keep < 1 || keep > count) throw new FormulaError(`Manter ou descartar deve ser de 1 a ${count} dados (posição ${at(start)}).`, start);
  }
  const notation = `${count}d${sides}${mode.length > 0 ? mode + keep : ""}`;
  return { kind: "dice", position: start, text: notation, count, sides, mode, keep };
}

function classify(raw, start) {
  const w = asciiLower(raw);
  if (isDigit(w[0]) && isNumberText(w)) {
    const value = Number(w);
    if (value > LIMITS.literal) throw new FormulaError(`Número grande demais na posição ${at(start)}.`, start);
    return { kind: "number", position: start, text: w, value };
  }
  const dice = tryDice(w, start);
  if (dice) return dice;
  if (looksLikeDice(w)) throw new FormulaError(`Dado inválido na posição ${at(start)}. Use NdS, como 1d20 ou 4d6kh3.`, start);
  if (isLetter(w[0]) || w[0] === "_") {
    let ok = true;
    for (const c of w) ok = ok && isNameChar(c);
    if (ok) return { kind: "ident", position: start, text: w };
  }
  if (isDigit(w[0]) || w[0] === ".") throw new FormulaError(`Número inválido na posição ${at(start)}.`, start);
  throw new FormulaError(`Expressão inválida na posição ${at(start)}.`, start);
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (tokens.length >= LIMITS.tokens) throw new FormulaError("Fórmula longa demais (máx. 200 elementos).", i);
    const start = i;
    if (c === "@") {
      i++;
      while (i < source.length && isNameChar(source[i])) i++;
      const name = source.slice(start + 1, i);
      if (!isValidName(name)) throw new FormulaError(`Nome de campo inválido na posição ${at(start)}.`, start);
      tokens.push({ kind: "ref", position: start, text: name });
      continue;
    }
    if (isRunChar(c)) {
      while (i < source.length && isRunChar(source[i])) i++;
      tokens.push(classify(source.slice(start, i), start));
      continue;
    }
    i++;
    if (c === "(") tokens.push({ kind: "lparen", position: start, text: "(" });
    else if (c === ")") tokens.push({ kind: "rparen", position: start, text: ")" });
    else if (c === ",") tokens.push({ kind: "comma", position: start, text: "," });
    else if (c === "+" || c === "-" || c === "*" || c === "/") tokens.push({ kind: "op", position: start, text: c });
    // Sinais tipográficos (copiados de livros e PDFs) são sinônimos exatos; o detalhamento sempre usa a forma ASCII.
    else if (c === "\u00d7") tokens.push({ kind: "op", position: start, text: "*" });
    else if (c === "\u00f7") tokens.push({ kind: "op", position: start, text: "/" });
    else if (c === "\u2212") tokens.push({ kind: "op", position: start, text: "-" });
    else if (c === "<" || c === ">") {
      if (i < source.length && source[i] === "=") {
        i++;
        tokens.push({ kind: "op", position: start, text: c + "=" });
      } else tokens.push({ kind: "op", position: start, text: c });
    } else if (c === "=") {
      if (i < source.length && source[i] === "=") {
        i++;
        tokens.push({ kind: "op", position: start, text: "==" });
      } else throw new FormulaError(`Use == para comparar (posição ${at(start)}).`, start);
    } else if (c === "!") {
      if (i < source.length && source[i] === "=") {
        i++;
        tokens.push({ kind: "op", position: start, text: "!=" });
      } else throw new FormulaError(`Use != ou not (posição ${at(start)}).`, start);
    } else throw new FormulaError(`Caractere não permitido na posição ${at(start)}.`, start);
  }
  tokens.push({ kind: "end", position: source.length, text: "" });
  return tokens;
}

// ---------- Analisador sintático ----------

const COMPARISONS = ["<", "<=", ">", ">=", "==", "!="];

function arity(name) {
  switch (name) {
    case "floor":
    case "ceil":
    case "round":
    case "abs":
    case "mod":
      return [1, 1];
    case "min":
    case "max":
      return [2, LIMITS.arguments];
    case "clamp":
      return [3, 3];
    default:
      return null;
  }
}

function parse(expression, mode) {
  if (typeof expression !== "string" || [...expression].every(isSpace)) throw new FormulaError("Informe uma fórmula.");
  if (expression.length > LIMITS.length) throw new FormulaError("Fórmula longa demais (máx. 300 caracteres).");
  const tokens = tokenize(expression);
  const references = [];
  const seen = new Set();
  let index = 0;
  let dice = 0;

  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const peekIdent = (word) => peek().kind === "ident" && peek().text === word;
  const peekOp = (op) => peek().kind === "op" && peek().text === op;
  const enter = (depth) => {
    if (depth > LIMITS.depth) throw new FormulaError("Aninhamento profundo demais (máx. 32 níveis).", peek().position);
  };

  function expressionAt(depth) {
    enter(depth);
    let left = andAt(depth);
    while (peekIdent("or")) {
      next();
      left = { type: "binary", op: "or", left, right: andAt(depth) };
    }
    return left;
  }
  function andAt(depth) {
    let left = notAt(depth);
    while (peekIdent("and")) {
      next();
      left = { type: "binary", op: "and", left, right: notAt(depth) };
    }
    return left;
  }
  function notAt(depth) {
    if (!peekIdent("not")) return comparisonAt(depth);
    next();
    enter(depth + 1);
    return { type: "unary", op: "not", operand: notAt(depth + 1) };
  }
  const isComparison = (token) => token.kind === "op" && COMPARISONS.includes(token.text);
  function comparisonAt(depth) {
    let left = additiveAt(depth);
    if (!isComparison(peek())) return left;
    const op = next().text;
    left = { type: "binary", op, left, right: additiveAt(depth) };
    if (isComparison(peek())) throw new FormulaError(`Comparações encadeadas não são permitidas (posição ${at(peek().position)}).`, peek().position);
    return left;
  }
  function additiveAt(depth) {
    let left = multiplicativeAt(depth);
    while (peekOp("+") || peekOp("-")) {
      const op = next().text;
      left = { type: "binary", op, left, right: multiplicativeAt(depth) };
    }
    return left;
  }
  function multiplicativeAt(depth) {
    let left = unaryAt(depth);
    while (peekOp("*") || peekOp("/")) {
      const op = next().text;
      left = { type: "binary", op, left, right: unaryAt(depth) };
    }
    return left;
  }
  function unaryAt(depth) {
    if (!peekOp("-") && !peekOp("+")) return primaryAt(depth);
    const op = next().text;
    enter(depth + 1);
    return { type: "unary", op, operand: unaryAt(depth + 1) };
  }
  function expectClose() {
    if (peek().kind === "rparen") {
      next();
      return;
    }
    throw new FormulaError(`Falta fechar parêntese (posição ${at(peek().position)}).`, peek().position);
  }
  function expectWord(word) {
    if (peekIdent(word)) {
      next();
      return;
    }
    throw new FormulaError(`Esperado ${word} na posição ${at(peek().position)}.`, peek().position);
  }
  function wordAt(token, depth) {
    const name = token.text;
    if (name === "if") {
      const condition = expressionAt(depth + 1);
      expectWord("then");
      const then = expressionAt(depth + 1);
      expectWord("else");
      const otherwise = expressionAt(depth + 1);
      return { type: "if", condition, then, else: otherwise };
    }
    if (["then", "else", "and", "or", "not"].includes(name)) throw new FormulaError(`Valor esperado na posição ${at(token.position)}.`, token.position);
    const range = arity(name);
    if (!range) {
      if (peek().kind === "lparen") throw new FormulaError(`Função desconhecida: ${short(name)}.`, token.position);
      throw new FormulaError(`Nome desconhecido: ${short(name)}. Campos usam @nome.`, token.position);
    }
    if (peek().kind !== "lparen") throw new FormulaError(`Esperado ( após ${name} (posição ${at(peek().position)}).`, peek().position);
    next();
    const args = [];
    if (peek().kind === "rparen") next();
    else {
      for (;;) {
        args.push(expressionAt(depth + 1));
        if (args.length > range[1]) break;
        if (peek().kind === "comma") {
          next();
          continue;
        }
        expectClose();
        break;
      }
    }
    if (args.length < range[0] || args.length > range[1]) {
      const expected = range[0] === range[1] ? (range[0] === 1 ? "1 argumento" : `${range[0]} argumentos`) : `de ${range[0]} a ${range[1]} argumentos`;
      throw new FormulaError(`${name} espera ${expected}.`, token.position);
    }
    return { type: "call", name, args };
  }
  function primaryAt(depth) {
    const token = next();
    switch (token.kind) {
      case "number":
        return { type: "number", value: token.value, text: token.text };
      case "ref":
        if (!seen.has(token.text)) {
          seen.add(token.text);
          references.push({ name: token.text, position: token.position });
        }
        return { type: "ref", name: token.text };
      case "dice":
        if (mode !== "roll") throw new FormulaError("Campos calculados não podem rolar dados.", token.position);
        dice += token.count;
        if (dice > LIMITS.dice) throw new FormulaError("Dados demais (máx. 200 por fórmula).", token.position);
        return { type: "dice", notation: token.text, count: token.count, sides: token.sides, mode: token.mode, keep: token.keep };
      case "lparen": {
        const inner = expressionAt(depth + 1);
        expectClose();
        return { type: "group", inner };
      }
      case "ident":
        return wordAt(token, depth);
      case "end":
        throw new FormulaError("Fórmula incompleta.", token.position);
      default:
        throw new FormulaError(`Valor esperado na posição ${at(token.position)}.`, token.position);
    }
  }

  const root = expressionAt(0);
  const rest = peek();
  if (rest.kind === "rparen") throw new FormulaError(`Parêntese sem abertura na posição ${at(rest.position)}.`, rest.position);
  if (rest.kind !== "end") throw new FormulaError(`Operador esperado na posição ${at(rest.position)}.`, rest.position);
  return { root, references };
}

// ---------- Avaliação ----------

function scopeValue(scope, name) {
  let value;
  if (scope instanceof Map) value = scope.get(name);
  else if (scope && typeof scope === "object" && hasOwn(scope, name)) value = scope[name];
  if (typeof value === "string") value = parseNumber(value);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function check(value) {
  if (!Number.isFinite(value) || Math.abs(value) > LIMITS.value) throw new FormulaError("Resultado fora do limite.");
  return value;
}

/** Índices mantidos em ordem crescente. Empates: o dado rolado antes tem prioridade. */
export function keptIndexes(values, mode, keep) {
  const n = values.length;
  let highest = true;
  let take = n;
  if (mode === "kh") take = keep;
  else if (mode === "kl") [highest, take] = [false, keep];
  else if (mode === "dh") [highest, take] = [false, n - keep];
  else if (mode === "dl") take = n - keep;
  const order = values.map((_, i) => i);
  order.sort((a, b) => {
    const byValue = highest ? values[b] - values[a] : values[a] - values[b];
    return byValue !== 0 ? byValue : a - b;
  });
  return order.slice(0, take).sort((a, b) => a - b);
}

function evaluator(scope, die, withText) {
  const groups = [];
  let text = "";
  const write = (value) => {
    if (withText) text += value;
  };

  function render(node) {
    if (!withText) return;
    switch (node.type) {
      case "number":
        write(node.text);
        break;
      case "ref":
        write("@" + node.name);
        break;
      case "dice":
        write(node.notation);
        break;
      case "group":
        write("(");
        render(node.inner);
        write(")");
        break;
      case "unary":
        write(node.op === "not" ? "not " : node.op);
        render(node.operand);
        break;
      case "binary":
        render(node.left);
        write(" " + node.op + " ");
        render(node.right);
        break;
      case "call":
        write(node.name + "(");
        node.args.forEach((arg, i) => {
          if (i > 0) write(", ");
          render(arg);
        });
        write(")");
        break;
      case "if":
        write("if ");
        render(node.condition);
        write(" then ");
        render(node.then);
        write(" else ");
        render(node.else);
        break;
    }
  }

  function rollDice(node) {
    if (!die) throw new FormulaError("Campos calculados não podem rolar dados.");
    const values = [];
    for (let i = 0; i < node.count; i++) {
      const value = die(node.sides);
      if (!Number.isInteger(value) || value < 1 || value > node.sides) throw new FormulaError("Gerador de dados inválido.");
      values.push(value);
    }
    const kept = keptIndexes(values, node.mode, node.keep);
    let subtotal = 0;
    for (const index of kept) subtotal += values[index];
    groups.push({ notation: node.notation, count: node.count, sides: node.sides, values, kept, subtotal });
    if (withText) {
      const keptSet = new Set(kept);
      write(node.notation + "[" + values.map((v, i) => (keptSet.has(i) ? String(v) : `~${v}~`)).join(", ") + "]");
    }
    return subtotal;
  }

  function evalBinary(node) {
    const left = evaluate(node.left);
    write(" " + node.op + " ");
    if (node.op === "and" && left === 0) {
      render(node.right);
      return 0;
    }
    if (node.op === "or" && left !== 0) {
      render(node.right);
      return 1;
    }
    const right = evaluate(node.right);
    switch (node.op) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        if (right === 0) throw new FormulaError("Divisão por zero.");
        return left / right;
      case "<":
        return left < right ? 1 : 0;
      case "<=":
        return left <= right ? 1 : 0;
      case ">":
        return left > right ? 1 : 0;
      case ">=":
        return left >= right ? 1 : 0;
      case "==":
        return left === right ? 1 : 0;
      case "!=":
        return left !== right ? 1 : 0;
      case "and":
      case "or":
        return right !== 0 ? 1 : 0;
      default:
        throw new FormulaError("Fórmula inválida.");
    }
  }

  function evalCall(node) {
    write(node.name + "(");
    const args = node.args.map((arg, i) => {
      if (i > 0) write(", ");
      return evaluate(arg);
    });
    write(")");
    switch (node.name) {
      case "floor":
        return Math.floor(args[0]);
      case "ceil":
        return Math.ceil(args[0]);
      case "round":
        return roundHalfAwayFromZero(args[0]);
      case "abs":
        return Math.abs(args[0]);
      case "mod":
        return Math.floor((args[0] - 10) / 2);
      case "clamp":
        return Math.min(Math.max(args[0], args[1]), args[2]);
      case "min":
        return args.reduce((a, b) => Math.min(a, b));
      case "max":
        return args.reduce((a, b) => Math.max(a, b));
      default:
        throw new FormulaError("Função desconhecida.");
    }
  }

  function evaluateCore(node) {
    switch (node.type) {
      case "number":
        write(node.text);
        return node.value;
      case "ref": {
        const value = check(scopeValue(scope, node.name));
        write("@" + node.name + "[" + formatNumber(value) + "]");
        return value;
      }
      case "dice":
        return rollDice(node);
      case "group": {
        write("(");
        const value = evaluate(node.inner);
        write(")");
        return value;
      }
      case "unary": {
        write(node.op === "not" ? "not " : node.op);
        const value = evaluate(node.operand);
        if (node.op === "-") return -value;
        if (node.op === "not") return value === 0 ? 1 : 0;
        return value;
      }
      case "binary":
        return evalBinary(node);
      case "call":
        return evalCall(node);
      case "if": {
        write("if ");
        const condition = evaluate(node.condition);
        write(" then ");
        if (condition !== 0) {
          const value = evaluate(node.then);
          write(" else ");
          render(node.else);
          return value;
        }
        render(node.then);
        write(" else ");
        return evaluate(node.else);
      }
      default:
        throw new FormulaError("Fórmula inválida.");
    }
  }

  function evaluate(node) {
    return check(evaluateCore(node));
  }

  return {
    run: (root) => evaluate(root) + 0, // -0 vira 0, como no servidor
    get groups() {
      return groups;
    },
    get text() {
      return text;
    },
  };
}

function cryptoDie(sides) {
  // Amostragem por rejeição para distribuição uniforme sem viés de módulo.
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buffer = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return (buffer[0] % sides) + 1;
  }
}

const normalizeMode = (mode) => (mode === "roll" ? "roll" : "deterministic");

// ---------- API pública ----------

/** Valida sintaxe, limites e referências. knownNames: array/Set de nomes ou null para não conferir. */
export function validate(expression, mode = "deterministic", knownNames = null) {
  try {
    const parsed = parse(expression, normalizeMode(mode));
    if (knownNames) {
      const known = knownNames instanceof Set ? knownNames : new Set(knownNames);
      for (const reference of parsed.references) {
        if (!known.has(reference.name)) return { ok: false, error: "Campo desconhecido: @" + reference.name, references: [], position: reference.position };
      }
    }
    return { ok: true, error: null, references: parsed.references.map((r) => r.name), position: null };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { ok: false, error: error.message, references: [], position: error.position };
  }
}

/** Avalia uma fórmula determinística (sem dados). Nome ausente vale 0. Lança FormulaError. */
export function evaluate(expression, scope = {}) {
  const parsed = parse(expression, "deterministic");
  return evaluator(scope, null, false).run(parsed.root);
}

/** Nomes referenciados (@nome, sem o @), na ordem da primeira aparição. Fórmula inválida → []. */
export function references(expression) {
  try {
    return parse(expression, "roll").references.map((r) => r.name);
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return [];
  }
}

/** Prévia de rolagem (o resultado oficial é sempre o do servidor). die(faces) → 1..faces; padrão: crypto. */
export function rollPreview(expression, scope = {}, die = cryptoDie) {
  const parsed = parse(expression, "roll");
  const run = evaluator(scope, die || cryptoDie, true);
  const total = run.run(parsed.root);
  return { total, dice: run.groups, breakdown: run.text + " = " + formatNumber(total) };
}

// ---------- Ficha ----------

/** Remove espaço, tab, quebras e espaço não separável das pontas (igual ao servidor). */
function trimValue(value) {
  const blank = (c) => c === " " || c === "\t" || c === "\r" || c === "\n" || c === " ";
  let start = 0;
  let end = value.length;
  while (start < end && blank(value[start])) start++;
  while (end > start && blank(value[end - 1])) end--;
  return value.slice(start, end);
}

/** Número em cultura invariante; aceita vírgula decimal pt-BR ("2,5"). Sem expoente nem milhar. |x| ≤ 1e12. Inválido → null. */
export function parseNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && Math.abs(raw) <= LIMITS.value ? raw + 0 : null;
  if (typeof raw !== "string") return null;
  let s = trimValue(raw);
  if (s.length === 0 || s.length > 40) return null;
  if (s.includes(",")) {
    if (s.includes(".")) return null;
    s = s.replaceAll(",", ".");
  }
  let i = 0;
  if (s[0] === "+" || s[0] === "-") i++;
  const digitsStart = i;
  while (i < s.length && isDigit(s[i])) i++;
  if (i === digitsStart) return null;
  if (i < s.length) {
    if (s[i] !== ".") return null;
    const fractionStart = ++i;
    while (i < s.length && isDigit(s[i])) i++;
    if (i === fractionStart || i !== s.length) return null;
  }
  const value = Number(s);
  return Math.abs(value) > LIMITS.value ? null : value + 0;
}

function isTruthy(raw) {
  if (typeof raw === "boolean") return raw;
  if (raw === null || raw === undefined) return false;
  return TRUTHY.includes(asciiLower(trimValue(String(raw))));
}

const isNumericType = (type) => type === "number" || type === "computed" || type === "checkbox";
// Ausente (undefined) assume o padrão do servidor; null explícito é inválido como no C#.
const fieldType = (field) => (typeof field.type === "string" ? field.type : field.type === undefined ? "text" : "");
const optionsOf = (field) => (Array.isArray(field.options) ? field.options : []);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const hasValue = (value) => value !== null && value !== undefined;

function textLimit(field) {
  const textArea = fieldType(field) === "textarea";
  const cap = textArea ? 10000 : 2000;
  if (Number.isInteger(field.maxLength) && field.maxLength >= 1) return Math.min(field.maxLength, cap);
  return textArea ? 10000 : 200;
}

function cut(value, max) {
  if (value.length > max) {
    let end = max;
    if (end > 0) {
      const code = value.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    value = value.slice(0, end);
  }
  return value.includes("\0") ? value.replaceAll("\0", "") : value;
}

function asText(raw) {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return "";
}

function normalize(field, raw) {
  switch (fieldType(field)) {
    case "number": {
      let value = parseNumber(asText(raw));
      if (value === null) return "";
      if (isNumber(field.min) && value < field.min) value = field.min;
      if (isNumber(field.max) && value > field.max) value = field.max;
      return formatNumber(value);
    }
    case "checkbox":
      return isTruthy(raw) ? "true" : "false";
    case "select": {
      const wanted = trimValue(asText(raw));
      if (wanted.length === 0) return "";
      for (const option of optionsOf(field)) if (typeof option === "string" && trimValue(option) === wanted) return wanted;
      return "";
    }
    default:
      return cut(asText(raw), textLimit(field));
  }
}

function usable(fields) {
  const list = [];
  if (!Array.isArray(fields)) return list;
  const seen = new Set();
  for (const field of fields) {
    if (list.length >= LIMITS.fields) break;
    if (!field || typeof field !== "object" || !isValidName(field.name) || seen.has(field.name)) continue;
    seen.add(field.name);
    list.push(field);
  }
  return list;
}

function readValue(values, name) {
  if (values instanceof Map) return values.has(name) ? values.get(name) : undefined;
  if (values && typeof values === "object" && hasOwn(values, name)) return values[name];
  return undefined;
}

/** Valores finais (texto) de todos os campos, com calculados em ordem de dependência. Nunca lança por dado do jogador. */
export function computeSheet(fields, values) {
  const result = {};
  const scope = new Map();
  const computed = [];
  for (const field of usable(fields)) {
    const type = fieldType(field);
    if (type === "computed") {
      computed.push(field);
      result[field.name] = "";
      continue;
    }
    const provided = readValue(values, field.name);
    const raw = hasValue(provided) ? provided : hasValue(field.default) ? field.default : "";
    const text = normalize(field, raw);
    result[field.name] = text;
    if (type === "number") scope.set(field.name, parseNumber(text) ?? 0);
    else if (type === "checkbox") scope.set(field.name, text === "true" ? 1 : 0);
  }

  const names = new Set(computed.map((f) => f.name));
  const parsed = new Map();
  const dependents = new Map();
  const pending = new Map();
  for (const field of computed) {
    let formula = null;
    try {
      formula = parse(field.formula, "deterministic");
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
    }
    parsed.set(field.name, formula);
    let count = 0;
    if (formula) {
      for (const reference of formula.references) {
        if (!names.has(reference.name)) continue;
        count++;
        if (!dependents.has(reference.name)) dependents.set(reference.name, []);
        dependents.get(reference.name).push(field.name);
      }
    }
    pending.set(field.name, count);
  }
  const queue = computed.filter((f) => pending.get(f.name) === 0).map((f) => f.name);
  for (let head = 0; head < queue.length; head++) {
    const name = queue[head];
    let text = "";
    const formula = parsed.get(name);
    if (formula) {
      try {
        text = formatNumber(evaluator(scope, null, false).run(formula.root));
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        text = "";
      }
    }
    result[name] = text;
    scope.set(name, parseNumber(text) ?? 0);
    for (const dependent of dependents.get(name) || []) {
      pending.set(dependent, pending.get(dependent) - 1);
      if (pending.get(dependent) === 0) queue.push(dependent);
    }
  }
  return result;
}

/** Escopo numérico (@nome → número) para rolar ações da ficha a partir dos valores calculados. */
export function sheetScope(fields, computedValues) {
  const scope = {};
  for (const field of usable(fields)) {
    const type = fieldType(field);
    if (!isNumericType(type)) continue;
    const raw = readValue(computedValues, field.name);
    scope[field.name] = type === "checkbox" ? (isTruthy(raw) ? 1 : 0) : (parseNumber(asText(raw)) ?? 0);
  }
  return scope;
}

const inRange = (value, min, max) => isNumber(value) && value >= min && value <= max;

function checkComputedFormula(formula, types) {
  if (typeof formula !== "string" || [...formula].every(isSpace)) return { error: "informe a fórmula." };
  const result = validate(formula, "deterministic");
  if (!result.ok) return { error: result.error };
  for (const name of result.references) {
    if (!types.has(name)) return { error: "Campo desconhecido: @" + name };
    if (!isNumericType(types.get(name))) return { error: `@${name} não é numérico (use número, calculado ou caixa de seleção).` };
  }
  return { error: null, references: result.references };
}

function checkDefault(field, type, value) {
  const incompatible = "valor padrão incompatível com o tipo.";
  switch (type) {
    case "computed":
      return "campo calculado não tem valor padrão.";
    case "number":
      return parseNumber(value) === null ? incompatible : null;
    case "checkbox":
      return value === "true" || value === "false" ? null : incompatible;
    case "select":
      return optionsOf(field).some((o) => typeof o === "string" && trimValue(o) === trimValue(value)) ? null : incompatible;
    default:
      return value.length > Math.min(textLimit(field), 200) ? incompatible : null;
  }
}

function findCycles(graph, order) {
  const messages = [];
  const color = new Map();
  for (const start of order) {
    if ((color.get(start) || 0) !== 0) continue;
    const stack = [[start, 0]];
    const path = [start];
    color.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const [node, edge] = top;
      const edges = graph.get(node);
      if (edge < edges.length) {
        top[1] = edge + 1;
        const nextNode = edges[edge];
        if (!graph.has(nextNode)) continue;
        const state = color.get(nextNode) || 0;
        if (state === 1) {
          const cycle = [...path.slice(path.indexOf(nextNode)), nextNode];
          messages.push("Ciclo entre campos calculados: " + cycle.join(" → ") + ".");
          if (messages.length >= 5) return messages;
        } else if (state === 0) {
          color.set(nextNode, 1);
          stack.push([nextNode, 0]);
          path.push(nextNode);
        }
      } else {
        color.set(node, 2);
        stack.pop();
        path.pop();
      }
    }
  }
  return messages;
}

/** Valida os campos de uma ficha-modelo (mesmas regras do servidor). Devolve erros em pt-BR; vazio = válido. */
export function validateFields(fields) {
  if (!Array.isArray(fields)) return ["Lista de campos ausente."];
  if (fields.length > LIMITS.fields) return ["No máximo 300 campos por modelo."];
  const errors = [];
  const types = new Map();
  for (const field of fields) {
    if (field && typeof field === "object" && isValidName(field.name) && !types.has(field.name)) types.set(field.name, fieldType(field));
  }
  const seenNames = new Set();
  const roles = new Map();
  const graph = new Map();
  const graphOrder = [];

  fields.forEach((field, i) => {
    const position = "Campo " + (i + 1);
    if (!field || typeof field !== "object") {
      errors.push(position + ": inválido.");
      return;
    }
    const validName = isValidName(field.name);
    const p = validName ? field.name : position;
    const unique = validName && !seenNames.has(field.name);
    if (validName) seenNames.add(field.name);
    if (!validName) errors.push(p + ": nome inválido (letras minúsculas, números e _, começando por letra, até 40).");
    else if (!unique) errors.push(p + ": nome repetido.");

    const label = typeof field.label === "string" ? field.label : "";
    if (label.length > 80 || trimValue(label).length === 0) errors.push(p + ": rótulo deve ter de 1 a 80 caracteres.");

    const type = fieldType(field);
    const validType = FIELD_TYPES.includes(type);
    if (!validType) errors.push(p + ": tipo inválido.");

    if (hasValue(field.role) && field.role !== "") {
      const role = field.role;
      if (typeof role !== "string" || !FIELD_ROLES.includes(role)) errors.push(p + ": papel inválido.");
      else if (roles.has(role)) errors.push(`${p}: o papel ${role} já é usado por ${roles.get(role)}.`);
      else {
        roles.set(role, p);
        if (validType && NUMERIC_ROLES.includes(role) && type !== "number" && type !== "computed") errors.push(`${p}: o papel ${role} exige campo de número ou calculado.`);
        if (validType && role === "name" && type !== "text") errors.push(`${p}: o papel name exige campo de texto.`);
      }
    }

    const page = hasValue(field.page) ? field.page : 0;
    if (!Number.isInteger(page) || page < 0) errors.push(p + ": página inválida.");
    const tolerance = 1e-6;
    const { x, y, w, h } = field;
    if (!(inRange(x, -tolerance, 1) && inRange(y, -tolerance, 1) && isNumber(w) && isNumber(h) && w > 0.005 && h > 0.005 && x + w <= 1 + tolerance && y + h <= 1 + tolerance))
      errors.push(p + ": posição ou tamanho fora da página.");

    if (type === "computed") {
      const checked = checkComputedFormula(field.formula, types);
      if (checked.error) errors.push(p + ": " + checked.error);
      else if (unique) {
        graph.set(field.name, checked.references.filter((r) => types.get(r) === "computed"));
        graphOrder.push(field.name);
      }
    }

    if (type === "select") {
      const options = optionsOf(field);
      if (options.length < 1 || options.length > 50) errors.push(p + ": a lista precisa ter de 1 a 50 opções.");
      else if (options.some((o) => typeof o !== "string" || o.length > 60 || trimValue(o).length === 0)) errors.push(p + ": cada opção deve ter de 1 a 60 caracteres.");
      else if (new Set(options.map(trimValue)).size !== options.length) errors.push(p + ": opções repetidas.");
    }

    if (hasValue(field.maxLength)) {
      const cap = type === "textarea" ? 10000 : 2000;
      if (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > cap) errors.push(`${p}: limite de caracteres deve ser de 1 a ${cap}.`);
    }

    const min = field.min;
    const max = field.max;
    if ((hasValue(min) && !isNumber(min)) || (hasValue(max) && !isNumber(max))) errors.push(p + ": mínimo ou máximo inválido.");
    else if (isNumber(min) && isNumber(max) && min > max) errors.push(p + ": mínimo maior que o máximo.");

    const fontSize = field.fontSize === undefined ? 10 : field.fontSize;
    if (!inRange(fontSize, 6, 32)) errors.push(p + ": tamanho da fonte deve ser de 6 a 32.");
    const align = field.align === undefined ? "left" : field.align;
    if (align !== "left" && align !== "center" && align !== "right") errors.push(p + ": alinhamento inválido.");

    if (validType && typeof field.default === "string" && field.default !== "") {
      const error = checkDefault(field, type, field.default);
      if (error) errors.push(p + ": " + error);
    }
  });
  errors.push(...findCycles(graph, graphOrder));
  return errors;
}
