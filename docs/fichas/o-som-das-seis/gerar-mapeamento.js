(() => {
// Ficha O Som das Seis (2 páginas de 595,32 x 839,16 pt). Mesmo formato do editor (compactDoc).
const PW = 595.32, PH = 839.16, F = [];
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const DEF = [["role", null], ["page", 0], ["formula", null], ["default", null], ["min", null], ["max", null], ["maxLength", null], ["fontSize", 10], ["align", "left"]];
function add(name, label, type, page, x, y, w, h, fs = 10, kw = {}) {
  const f = { name, label, type, x: r5(x / PW), y: r5(y / PH), w: r5(w / PW), h: r5(h / PH) };
  for (const [k, fb] of DEF) {
    const v = k === "page" ? page : k === "fontSize" ? fs : kw[k];
    if (v === undefined || v === null || v === "" || v === fb) continue;
    f[k] = v;
  }
  if (type === "select") f.options = kw.options;
  if (type !== "computed") delete f.formula;
  F.push(f);
}
const boxed = (cy, fs) => { const h = 1.2 * fs + 1; return [cy - h / 2, h]; };
const line = (name, label, type, page, x, cy, w, fs, kw = {}) => { const [y, h] = boxed(cy, fs); add(name, label, type, page, x, y, w, h, fs, kw); };
// Número centrado numa caixa (x, y, w, h).
const num = (name, label, type, page, x, y, w, h, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  line(name, label, type, page, left, y + h / 2, Math.min(w - 1, x + w - left - 0.5), fs, kw);
};
// Quadradinhos: lista cujas opções são ■ separados por U+2006 (avanço 0,604 + 0,1665 em em Arial), com a fonte ajustada ao passo das caixas.
const GAP = " ";
const marks = (n) => Array.from({ length: n }, (_, i) => Array(i + 1).fill("■").join(GAP));
const squares = (name, label, page, x1, x5, bw, cy) => {
  const pitch = (x5 - x1) / 4, fs = Math.round((pitch / 0.7705) * 100) / 100, c1 = x1 + bw / 2;
  const hh = 1 + 0.545 * fs;
  add(name, label, "select", page, c1 - 1 - 0.302 * fs, cy - hh, 4 * pitch + 0.62 * fs + 8, 2 * hh, fs, { options: marks(5) });
};
// ---------- Página 1 ----------
line("nome", "Nome", "text", 0, 60, 172, 352, 22, { role: "name", maxLength: 40 });
num("nivel", "Nível", "number", 0, 425.37, 148, 107.72, 50, 26, { role: "level", default: "1", min: 1, max: 99 });
[["fisico", "Físico", 257.75], ["agilidade", "Agilidade", 287.66], ["intelecto", "Intelecto", 317.65], ["coragem", "Coragem", 346.5]]
  .forEach(([k, l, y]) => squares(k, l, 0, 123.84, 204.19, 18.49, y + 9.37));
num("vida", "Vida", "number", 0, 266.17, 264.42, 48.49, 37.74, 20, { role: "hp", default: "6", min: 0, max: 99 });
num("defesa", "Defesa (5 + Coragem)", "number", 0, 266.42, 326.65, 48.49, 37.74, 20, { role: "armor", default: "5", min: 0, max: 99 });
add("tormento", "Tormento", "textarea", 0, 360, 258, 186, 32, 10, { maxLength: 300 });
add("recompensa", "Recompensa", "textarea", 0, 360, 343.5, 186, 32, 10, { maxLength: 300 });
num("iniciativa", "Iniciativa (+1 por Coragem)", "number", 0, 50.23, 416.5, 65.73, 24.5, 16, { default: "0", min: -9, max: 99 });
num("acoes", "Ações por turno (2 + Agilidade)", "number", 0, 156.7, 416, 68.23, 24.5, 16, { default: "2", min: 0, max: 99 });
const ANT = [["combate", "Combate", 485.85], ["negocios", "Negócios", 513.34], ["montaria", "Montaria", 540.09], ["tradicao", "Tradição", 569.1],
  ["labuta", "Labuta", 598.45], ["exploracao", "Exploração", 628.95], ["roubo", "Roubo", 659.45], ["medicina", "Medicina", 690.04]];
ANT.forEach(([k, l, y]) => squares(k, `Antecedente: ${l}`, 0, 122.6, 205.3, 17, y + 9.1));
add("habilidades", "Habilidades", "textarea", 0, 268, 442, 279, 276, 11, { maxLength: 6000 });
line("reputacao", "Reputação", "text", 0, 64, 785, 308, 14, { maxLength: 80 });
line("dinheiro", "Dinheiro (U$)", "text", 0, 395, 785, 140, 14, { maxLength: 30 });
// ---------- Página 2 ----------
for (let i = 0; i < 10; i++) {
  const y = 51.98 + 33.8233 * i, cy = y + (i ? 16.3 : 19.5);
  line(`equipamento_${i + 1}`, `Equipamento ${i + 1}`, "text", 1, 52, cy, 384, 12, { maxLength: 80 });
  line(`equipamento_${i + 1}_dano`, `Equipamento ${i + 1} — dano`, "text", 1, 448, cy, 96, 12, { maxLength: 20 });
}
line("cavalo_nome", "Cavalo — nome", "text", 1, 250, 459, 182, 14, { maxLength: 40 });
line("cavalo_fidelidade", "Cavalo — fidelidade", "text", 1, 452, 459, 88, 14, { maxLength: 20 });
squares("cavalo_potencia", "Cavalo — potência", 1, 128.21, 208.69, 18.24, 510.85 + 9.5);
squares("cavalo_vigor", "Cavalo — vigor", 1, 128.21, 208.69, 18.24, 540.84 + 9.4);
num("cavalo_vida", "Cavalo — vida (1d6 + vigor)", "number", 1, 305.66, 497.35, 19.99, 21.99, 12, { min: 0, max: 99 });
num("cavalo_defesa", "Cavalo — defesa (5 + vigor)", "number", 1, 305.66, 522.34, 19.99, 21.74, 12, { min: 0, max: 99 });
num("cavalo_dano", "Cavalo — dano (6 + potência)", "number", 1, 305.66, 547.08, 19.99, 21.74, 12, { min: 0, max: 99 });
for (let i = 0; i < 15; i++) line(`cavalo_item_${i + 1}`, `Item no cavalo ${i + 1}`, "text", 1, 407, 506.35 + 19.7793 * i + 8.25, 141, 10, { maxLength: 40 });
[["nome", "Deu um nome ao animal", 616.56], ["potencia", "Corre mais rápido (+1 Potência)", 662.8], ["assovio", "Vem com um assovio", 709.04], ["forte", "Mais esbelto e forte (+2 Potência)", 755.27]]
  .forEach(([k, l, y]) => num(`cavalo_marco_${k}`, `Cavalo: ${l}`, "checkbox", 1, 58.98, y, 30.99, 29.24, 20, {}, 1));
// ---------- Ações ----------
const actions = [
  { key: "iniciativa", name: "Iniciativa", kind: "habilidade", formula: "1d6 + @iniciativa", description: "1d6 + Iniciativa: define a ordem no combate." },
  { key: "d6", name: "Rolagem 1d6", kind: "habilidade", formula: "1d6", description: "1d6 para testes e dano." },
];
return { pages: [{ width: PW, height: PH }, { width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da ficha de O Som das Seis (2 páginas): atributos, antecedentes, potência e vigor do cavalo em quadradinhos (listas com ■ que cobrem as caixas impressas), vida, defesa, iniciativa, ações, tormento, recompensa, habilidades, equipamento e o cavalo." };
})()
