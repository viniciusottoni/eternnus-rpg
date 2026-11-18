// Predefinições de luz e visão (ADR-100). Valores em casas da grade, sem presumir regras de um sistema de RPG:
// a escolha só preenche os números que o servidor já valida (raio 1–30, penumbra ≥ raio, visão 0–30).
// Puro: sem DOM; testado em tests/light-presets-policy.test.mjs.

/** Focos de luz do mapa: raio de luz plena e penumbra. */
export const LIGHT_PRESETS = Object.freeze([
  Object.freeze({ id: "candle", label: "Vela", radius: 1, dim: 2 }),
  Object.freeze({ id: "torch", label: "Tocha", radius: 4, dim: 8 }),
  Object.freeze({ id: "campfire", label: "Fogueira", radius: 5, dim: 10 }),
  Object.freeze({ id: "lantern", label: "Lanterna", radius: 6, dim: 12 }),
]);

/** Luz carregada por um marcador (um raio só; a mesa não tem penumbra por marcador). */
export const TOKEN_LIGHT_PRESETS = Object.freeze([
  Object.freeze({ id: "off", label: "Sem luz", light: 0 }),
  ...LIGHT_PRESETS.map((p) => Object.freeze({ id: p.id, label: p.label, light: p.radius })),
]);

/** Visão própria do marcador (enxerga no escuro; só o dono vê). */
export const VISION_PRESETS = Object.freeze([
  Object.freeze({ id: "none", label: "Sem visão no escuro", vision: 0 }),
  Object.freeze({ id: "short", label: "Visão no escuro curta", vision: 6 }),
  Object.freeze({ id: "long", label: "Visão no escuro longa", vision: 12 }),
]);

export const CUSTOM = "custom";
/** Opção "usar o padrão" dos campos opcionais do marcador (campo vazio: ficha ou padrão da mesa). */
export const DEFAULT = "";

const num = (v) => (v === "" || v == null ? null : Number(v));

/** Texto da opção com os números, para quem quiser conferir. */
export function presetText(p) {
  if ("dim" in p) return `${p.label} — ${p.radius} ${p.radius === 1 ? "casa" : "casas"}, penumbra até ${p.dim}`;
  const n = "light" in p ? p.light : p.vision;
  return n ? `${p.label} — ${n} casas` : p.label;
}

/** Id da predefinição que corresponde aos valores atuais; CUSTOM quando nenhuma corresponde. */
export function lightPresetOf(radius, dim) {
  const r = num(radius), d = num(dim);
  const hit = LIGHT_PRESETS.find((p) => p.radius === r && (d == null ? false : p.dim === d));
  return hit ? hit.id : CUSTOM;
}

/** Para campos opcionais do marcador: vazio = DEFAULT; valor de uma predefinição = seu id; senão CUSTOM. */
export function tokenPresetOf(list, key, value) {
  const v = num(value);
  if (v == null || Number.isNaN(v)) return DEFAULT;
  return list.find((p) => p[key] === v)?.id ?? CUSTOM;
}

/** Valores de uma predefinição (null para CUSTOM/DEFAULT ou id desconhecido). */
export const presetById = (list, id) => list.find((p) => p.id === id) || null;
