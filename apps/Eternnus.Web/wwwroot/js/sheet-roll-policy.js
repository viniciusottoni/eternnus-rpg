// Rolar pela ficha (ADR-099). Regras puras, sem DOM: testáveis com node --test.
// A fórmula vem do modelo (`field.roll`: texto = fórmula própria, "" = não rolar) ou, sem ela, de uma inferência
// conservadora só para fichas no estilo d20 (atributos com modificador): modificadores, perícias com componentes,
// resistências, iniciativa e percepção rolam 1d20 + valor. Outros sistemas só rolam com `roll` definido no modelo.
// O servidor avalia a fórmula com a ficha escolhida como escopo dos @campos (a mesma linguagem das ações).

const ATTRIBUTES = ["forca", "destreza", "constituicao", "inteligencia", "sabedoria", "carisma"];
const PARTS = new Set(["atributo", "prof", "treino", "proficiencia", "profic"]);
const FIXED = new Set(["iniciativa", "percepcao", "fortitude", "reflexos", "vontade"]);
const NEVER = /^(ca|cd|defesa|classe_armadura|proficiencia|nivel|deslocamento)$|^cd_|_cd$/;
const NUMERIC = new Set(["number", "computed"]);

/** Ficha no estilo d20: ao menos quatro atributos com campo de modificador (forca_mod, destreza_mod…). */
export function isD20Sheet(fields) {
  const names = new Set((fields || []).map((f) => f?.name));
  return ATTRIBUTES.filter((a) => names.has(`${a}_mod`)).length >= 4;
}

/** Inferência para um campo numérico de ficha d20; nulo quando o campo não é um teste. */
function inferred(field, names) {
  const name = String(field.name || "");
  if (NEVER.test(name)) return null;
  const base = name.endsWith("_mod") ? name.slice(0, -4) : null;
  if (base && ATTRIBUTES.includes(base)) return `1d20 + @${name}`;
  if (FIXED.has(name) || name.startsWith("resistencia_")) return `1d20 + @${name}`;
  for (const part of PARTS) if (names.has(`${name}_${part}`)) return `1d20 + @${name}`;
  return null;
}

/**
 * Mapa nome → fórmula dos campos que rolam ao clicar. `field.roll` (texto) vale sobre a inferência;
 * "" desliga. Só campos numéricos e calculados.
 */
export function rollFormulas(fields) {
  const list = fields || [];
  const d20 = isD20Sheet(list);
  const names = new Set(list.map((f) => f?.name));
  const out = new Map();
  for (const f of list) {
    if (!f || !NUMERIC.has(f.type)) continue;
    if (typeof f.roll === "string") {
      const own = f.roll.trim();
      if (own) out.set(f.name, own.slice(0, 120));
      continue;
    }
    const formula = d20 ? inferred(f, names) : null;
    if (formula) out.set(f.name, formula);
  }
  return out;
}

/** Rótulo curto da rolagem no registro da mesa (até 60 caracteres, como o servidor aceita). */
export function rollLabel(field) {
  const text = String(field?.label || field?.name || "Teste").replace(/\s+/g, " ").trim();
  return text.length > 60 ? text.slice(0, 59) + "…" : text;
}

/** "+7", "−2", "0": modificador para mostrar ao lado do nome do teste. */
export function signed(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return String(value ?? "");
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}
