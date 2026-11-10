(() => {
// Ficha 3DeT Victory (PDF comum, 1 página, 453,6 x 652,08 pt). Mesmo formato do editor (compactDoc).
const PW = 453.6, PH = 652.08, F = [];
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
const onLine = (L, fs) => [L - 4 - 0.905 * fs, 1.2 * fs + 1];
const boxed = (cy, fs) => { const h = 1.2 * fs + 1; return [cy - h / 2, h]; };
let y, h;
// Cabeçalho
[y, h] = onLine(73.4, 12);
add("nome", "Nome", "text", 0, 22, y, 192, h, 12, { role: "name", maxLength: 100 });
add("pontos", "Pontos", "number", 0, 240, y, 88, h, 12, { default: "10", min: 0, max: 9999 });
add("xp", "XP", "number", 0, 344, y, 88, h, 12, { default: "0", min: 0, max: 999999 });
[y, h] = onLine(95.1, 12);
add("arquetipo", "Arquétipo", "text", 0, 22, y, 192, h, 12, { maxLength: 60 });
add("conceito", "Conceito", "text", 0, 240, y, 88, h, 12, { maxLength: 60 });
add("escala", "Escala", "text", 0, 344, y, 88, h, 12, { maxLength: 30 });
// Atributos e recursos: PA = Poder, PM = 5 x Habilidade, PV = 5 x Resistência (mínimo 1)
const ROWS = [["poder", "Poder (P)", "pa", "PA", "Pontos de Ação", "max(1, @poder)", 135.5],
  ["habilidade", "Habilidade (H)", "pm", "PM", "Pontos de Mana", "max(1, 5 * @habilidade)", 188.5],
  ["resistencia", "Resistência (R)", "pv", "PV", "Pontos de Vida", "max(1, 5 * @resistencia)", 243]];
for (const [k, l, r, sigla, nome, formula, cy] of ROWS) {
  add(k, l, "number", 0, 47, cy - 13.5, 28, 27, 22, { default: "1", min: 0, max: 99, align: "center" });
  add(`${r}_max`, `${sigla} máximos (${nome})`, "computed", 0, 140, cy - 12.5, 33, 25, 20, { role: r === "pv" ? "maxHp" : null, formula, align: "center" });
  [y, h] = boxed(cy, 14);
  add(`${r}_atual`, `${sigla} atuais`, "number", 0, 189, y, 26, h, 14, { role: r === "pv" ? "hp" : null, default: r === "pv" ? "5" : null, min: 0, max: 9999, align: "center" });
}
// Perícias (marque as que o personagem possui)
const SK1 = ["Animais", "Arte", "Esporte", "Influência", "Luta", "Manha"], SK2 = ["Máquinas", "Medicina", "Mística", "Percepção", "Saber", "Sobrevivência"];
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SKY = [143.3, 157.9, 172.4, 187.0, 201.6, 216.2];
SK1.forEach((s, i) => add(`pericia_${slug(s)}`, `Perícia: ${s}`, "checkbox", 0, 245, SKY[i] - 3, 7, 7, 8));
SK2.forEach((s, i) => add(`pericia_${slug(s)}`, `Perícia: ${s}`, "checkbox", 0, 342.5, SKY[i] - 3, 7, 7, 8));
// Força de Ataque / Força de Defesa: atributo + 1d + Luta + Ganho
for (const [k, sigla, nome, cy] of [["fa", "FA", "Força de Ataque", 238], ["fd", "FD", "Força de Defesa", 263.5]]) {
  [y, h] = boxed(cy, 12);
  add(`${k}_atributo`, `${sigla} — atributo (${nome})`, "number", 0, 268, y, 26, h, 12, { min: 0, max: 99, align: "center" });
  add(`${k}_luta`, `${sigla} — dado de Luta`, "checkbox", 0, 377, cy - 5, 10, 10, 10);
  add(`${k}_ganho`, `${sigla} — dados de ganho`, "number", 0, 419, y, 13, h, 12, { min: 0, max: 9, align: "center" });
}
// Listas: uma linha impressa = um campo
[321.1, 338.4, 355.6, 372.6, 389.9, 407.1, 424.1, 441.4, 458.4, 475.6].forEach((L, i) => {
  [y, h] = onLine(L, 10); add(`vantagem_${i + 1}`, `Vantagem ${i + 1}`, "text", 0, 22, y, 192, h, 10, { maxLength: 100 });
});
[511.9, 528.9, 546.1, 563.4, 580.4, 597.6, 614.6, 631.9].forEach((L, i) => {
  [y, h] = onLine(L, 10); add(`desvantagem_${i + 1}`, `Desvantagem ${i + 1}`, "text", 0, 22, y, 192, h, 10, { maxLength: 100 });
});
[321.1, 338.4, 355.6, 372.6, 389.9, 407.1].forEach((L, i) => {
  [y, h] = onLine(L, 10); add(`tecnica_${i + 1}`, `Técnica ${i + 1}`, "text", 0, 240, y, 192, h, 10, { maxLength: 100 });
});
[444.1, 461.1, 478.4, 495.6, 512.6, 529.9, 546.9, 564.1, 581.4, 598.4].forEach((L, i) => {
  [y, h] = onLine(L, 10); add(`item_${i + 1}`, `Inventário ${i + 1}`, "text", 0, 240, y, 192, h, 10, { maxLength: 100 });
});
// Espaços de itens por raridade
const SLOTS = [["comum", "comum", [248.3, 267.1, 286.1, 305.1, 324.1]], ["incomum", "incomum", [344.9, 363.9, 382.9, 401.9]], ["raro", "raro", [423]]];
for (const [k, l, xs] of SLOTS) xs.forEach((cx, i) => add(`espaco_${k}_${i + 1}`, `Espaço de item ${l} ${i + 1}`, "checkbox", 0, cx - 5, 619.6, 10, 10, 10));
return { pages: [{ width: PW, height: PH }], fields: F, actions: [],
  notes: "Mapeamento da ficha de 3DeT Victory (PDF comum, 1 página): Poder, Habilidade e Resistência; PA, PM e PV máximos calculados (P, 5×H, 5×R, mínimo 1) e atuais; 12 perícias; FA e FD; vantagens, desvantagens, técnicas, inventário e espaços de itens." };
})()
