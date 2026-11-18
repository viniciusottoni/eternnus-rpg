// Descrições por item da ficha (ADR-098): regras puras. Um item é uma linha não vazia de um campo de lista.
// A chave segue CharacterItemNotes.Key no servidor: NFC, espaços colapsados, minúsculas, até 200 caracteres.

export const NOTE_MAX = 500;
export const NOTES_MAX = 200;
const KEY_MAX = 200;

/** Palavras (início do termo) que indicam lista de itens com regras próprias: magias, poderes, habilidades, equipamento… */
const LIST_WORDS = Object.freeze([
  "magia", "feitico", "ritual", "rituais", "truque", "poder", "poderes", "habilidade", "talento", "vantage", "desvantage",
  "tecnica", "disciplina", "pericia", "item", "itens", "equip", "inventario", "posses", "mochila", "arma", "ataque",
  "golpe", "acao", "reacao", "caracteristica", "maestria", "aptidao", "dom", "dons", "beneficio", "escudo", "armadura",
  "pertence", "tomo",
]);
/** Último termo que indica coluna auxiliar de uma linha (dano, custo, peso…) ou texto corrido: sem descrição própria. */
const COLUMN_WORDS = new Set([
  "dano", "teste", "critico", "tipo", "alcance", "peso", "custo", "quant", "quantidade", "espacos", "categoria", "municao", "notas",
  "descricao", "pm", "alvos", "alvo", "duracao", "execucao", "resistencia", "bonus", "nh", "relativo", "volume", "investido",
  "atual", "max", "pagina", "posicao", "dados", "outro", "tracos", "regular", "dificil", "extremo", "ataques", "defeito",
  "beneficios", "especial", "atributo", "mod", "cd", "chave", "total", "nivel", "prec", "distancia", "cdt", "tiros", "st",
  "magnitude", "rco", "cl", "aparar", "detalhes", "anotacoes", "historia", "aparencia", "status", "reputacao", "outros", "espec",
]);

/** Primeiro termo que indica texto corrido ou modificador (descricao_tecnica, bonus_poder): não é lista. */
const LEAD_WORDS = new Set(["descricao", "bonus", "mod", "nivel", "total", "anotacoes", "historia", "aparencia", "notas"]);

const fold = (text) => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const words = (name) => fold(name).split(/[^a-z]+/).filter(Boolean);

/**
 * Campo de lista (um item por linha, com descrição por item)? `field.notes` true/false força a escolha;
 * sem ela, decide pelo nome: texto/texto longo com termo de lista e sem termo final de coluna auxiliar.
 */
export function isListField(field) {
  if (!field || !["text", "textarea"].includes(field.type)) return false;
  if (typeof field.notes === "boolean") return field.notes;
  const terms = words(field.name);
  // Coluna auxiliar no fim (arma_1_dano) ou no início (descricao_tecnica, bonus_poder): não é lista de itens.
  if (!terms.length || COLUMN_WORDS.has(terms.at(-1)) || LEAD_WORDS.has(terms[0])) return false;
  return terms.some((t) => LIST_WORDS.some((w) => t === w || (w.length >= 4 && t.startsWith(w))));
}

/** Chave do item (igual à do servidor). */
export function noteKey(text) {
  const key = String(text ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return key.length > KEY_MAX ? key.slice(0, KEY_MAX) : key;
}

/** Itens do valor: linhas não vazias, sem repetir a mesma chave. */
export function fieldItems(value) {
  const seen = new Set();
  const items = [];
  for (const raw of String(value ?? "").split("\n")) {
    const label = raw.trim();
    const key = noteKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, label });
  }
  return items;
}

/** Quantos itens do valor têm descrição. */
export function describedCount(value, notes) {
  return fieldItems(value).filter((item) => notes?.[item.key]).length;
}

/** Aplica as descrições editadas de um campo ao conjunto: vazio remove; limita ao máximo de caracteres. */
export function applyNotes(notes, edits) {
  const next = { ...(notes || {}) };
  for (const [key, text] of Object.entries(edits || {})) {
    const clean = String(text ?? "").replace(/\r\n/g, "\n").trim().slice(0, NOTE_MAX);
    if (clean) next[key] = clean;
    else delete next[key];
  }
  return next;
}

/** Só as descrições de itens que existem nos campos de lista atuais (o servidor faz o mesmo ao salvar). */
export function liveNotes(fields, values, notes) {
  const keys = new Set();
  for (const f of fields || []) if (isListField(f)) for (const item of fieldItems(values?.[f.name])) keys.add(item.key);
  return Object.fromEntries(Object.entries(notes || {}).filter(([key, text]) => keys.has(key) && text));
}

/**
 * Campos desenhados linha a linha (um texto por linha, sem quebra, "…" no que não couber): as listas de texto longo e as
 * colunas delas — texto longo com o mesmo começo de nome e as mesmas linhas de uma lista (mesma página e fonte, começando
 * e terminando na mesma linha), como posses_custo ao lado de posses ou cc_dano ao lado de cc_arma.
 * Colunas não têm descrição própria: a descrição fica no item.
 * `pages` (alturas em pt) converte a altura de linha (1,2 × fonte); sem ela, vale A4.
 */
export function lineFieldNames(fields, pages = []) {
  const areas = (fields || []).filter((f) => f?.type === "textarea");
  const lists = areas.filter(isListField);
  const names = new Set(lists.map((f) => f.name));
  const size = (f) => Number(f.fontSize) || 10;
  const line = (f) => (1.2 * size(f)) / (Number(pages?.[f.page || 0]?.height) || 841.89);
  for (const f of areas) {
    if (names.has(f.name)) continue;
    const lead = words(f.name)[0];
    const column = lists.some((l) => words(l.name)[0] === lead && (l.page || 0) === (f.page || 0) && Math.abs(size(l) - size(f)) <= size(l) * 0.02
      && Math.abs(l.y - f.y) <= line(l) / 2 && Math.abs(l.y + l.h - (f.y + f.h)) <= line(l) / 2);
    if (column) names.add(f.name);
  }
  return names;
}

/** Corta um texto de uma linha para caber na largura, com "…" (measure: texto → largura). */
export function fitLine(text, width, measure) {
  const value = String(text ?? "").replace(/\s+$/, "");
  if (!value || measure(value) <= width) return value;
  let low = 0, high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(value.slice(0, mid).trimEnd() + "…") <= width) low = mid; else high = mid - 1;
  }
  return low > 0 ? value.slice(0, low).trimEnd() + "…" : "";
}

/**
 * Descrições anexadas ao PDF exportado: `[{ label, items: [{ item, text }] }]` na ordem dos campos e das linhas.
 * Só itens descritos que existem nos campos de lista; campo sem descrição não aparece; o mesmo item pode aparecer em
 * dois campos, mas não se repete dentro de um campo.
 */
export function noteSections(fields, values, notes) {
  const sections = [];
  for (const f of fields || []) {
    if (!isListField(f)) continue;
    const items = [];
    for (const { key, label } of fieldItems(values?.[f.name])) {
      const text = Object.hasOwn(notes || {}, key) ? String(notes[key] ?? "").trim() : "";
      if (text) items.push({ item: label, text });
    }
    if (items.length) sections.push({ label: String(f.label || f.name), items });
  }
  return sections;
}

/**
 * Quebra um texto em linhas que cabem na largura (measure: texto → largura). Cada "\n" inicia uma linha (linha vazia
 * vira ""); palavra maior que a largura é partida por caractere. Texto vazio não gera linha.
 */
export function wrapWords(text, maxWidth, measure) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];
  const lines = [];
  for (const paragraph of source.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= maxWidth) { line = joined; continue; }
      if (line) lines.push(line);
      line = "";
      if (measure(word) <= maxWidth) { line = word; continue; }
      for (const ch of word) {
        if (line && measure(line + ch) > maxWidth) { lines.push(line); line = ""; }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Texto que a fonte padrão do PDF (WinAnsi) codifica: NFC, quebras normalizadas, tabulação e espaços especiais viram
 * espaço, controles somem; caractere não suportado perde o acento (ő → o) ou vira "?". supports: code point → boolean.
 */
export function pdfText(text, supports) {
  const source = String(text ?? "").normalize("NFC").replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[\t\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
  let out = "";
  for (const ch of source) {
    const cp = ch.codePointAt(0);
    if (ch === "\n" || supports(cp)) { out += ch; continue; }
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += base && [...base].every((c) => supports(c.codePointAt(0))) ? base : "?";
  }
  return out;
}
