// Peso da cena (ADR-100, N6). Puro; testado em tests/scene-weight-policy.test.mjs.
// O aviso usa os limites que o servidor já impõe (Domain/TableFog.cs e ScenePreparation.cs), não uma medição de desempenho:
// perto do limite, a mesa recusa novos itens e aparelhos simples tendem a desenhar mais devagar. Medição real: TESTES.md.

export const SCENE_LIMITS = Object.freeze({ walls: 2000, lights: 100, marks: 100, tokens: 60 });
const LABELS = Object.freeze({ walls: "segmentos de parede", lights: "focos de luz", marks: "marcas ocultas", tokens: "marcadores" });
/** Fração do limite a partir da qual o editor avisa. */
export const WARN_SHARE = 0.8;

/** counts = { walls, lights, marks, tokens } (números; ausentes contam 0). */
export function sceneWeight(counts = {}) {
  const items = Object.entries(SCENE_LIMITS).map(([key, limit]) => {
    const count = Math.max(0, Math.floor(Number(counts[key]) || 0));
    return { key, label: LABELS[key], count, limit, share: count / limit };
  });
  const near = items.filter((i) => i.share >= WARN_SHARE).sort((a, b) => b.share - a.share);
  return {
    heavy: near.length > 0,
    items,
    text: near.length ? `Cena pesada: ${near.map((i) => `${i.count} de ${i.limit} ${i.label}`).join(", ")}. Una paredes retas e reduza luzes para manter a mesa leve.` : "",
  };
}
