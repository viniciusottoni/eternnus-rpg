(() => {
// Ficha Daggerheart (PDF comum, 2 páginas de 612 x 792 pt). Mesmo formato do editor (compactDoc).
// Listas (ADR-098): nomes com termo de lista (habilidade, arma, armadura, inventario, "_itens") viram uma caixa por linha
// com descrição por item; colunas e linhas de descrição terminam em termo auxiliar (alcance, dano, descricao).
const PW = 612, PH = 792, F = [];
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
// Texto apoiado numa linha impressa L (base do texto logo acima da linha).
const onLine = (name, label, page, x, L, w, fs, kw = {}) => add(name, label, "text", page, x, L - 3 - 0.905 * fs, w, 1.2 * fs + 1, fs, kw);
// Número centrado numa caixa (x, w) na altura cy.
const num = (name, label, type, page, x, w, cy, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  line(name, label, type, page, left, cy, Math.min(w - 1, x + w - left - 0.5), fs, kw);
};
const check = (name, label, page, cx, cy, fs) => num(name, label, "checkbox", page, cx - 0.5 * fs, fs, cy, fs, {}, 1);
// Lista de texto longo sem linhas impressas: n linhas de 1,2 × fonte a partir de y.
const list = (name, label, page, x, y, w, n, fs, max) => add(name, label, "textarea", page, x, y, w, n * 1.2 * fs + 1, fs, { maxLength: max });

// ---------- Página 1 ----------
line("nome", "Nome", "text", 0, 233, 18.5, 160, 10, { role: "name", maxLength: 40 });
line("pronomes", "Pronomes", "text", 0, 444, 18.5, 87, 10, { maxLength: 20 });
line("heranca", "Herança (ancestralidade e comunidade)", "text", 0, 235, 38, 129, 10, { maxLength: 40 });
line("classe_subclasse", "Classe & subclasse", "text", 0, 445, 38, 87, 8.5, { maxLength: 40 });
num("nivel", "Nível", "number", 0, 554, 35, 29, 16, { role: "level", default: "1", min: 1, max: 10 });
// Atributos (escudo 42,5 x 38; o círculo ao lado marca o atributo aumentado)
[["agilidade", "Agilidade", 205.5, 248.5], ["forca", "Força", 274, 317], ["finesse", "Finesse", 340.5, 383.5],
  ["instinto", "Instinto", 407, 450], ["presenca", "Presença", 475.5, 518.5], ["conhecimento", "Conhecimento", 541.5, 584.5]]
  .forEach(([k, l, x, c]) => {
    num(k, l, "number", 0, x + 3, 36, 95, 20, { min: -5, max: 10 });
    check(`${k}_marcado`, `${l} — aumentado (círculo)`, 0, c + 5.75, 73.25, 10);
  });
num("evasao", "Evasão", "number", 0, 20, 39, 99, 18, { role: "armor", min: 0, max: 99 });
num("armadura", "Armadura (pontuação)", "number", 0, 85.5, 40, 99, 18, { min: 0, max: 99 });
[79.5, 94, 108.5, 122.5].forEach((y, r) => [136.5, 149.5, 162.5].forEach((x, c) =>
  check(`armadura_espaco_${r * 3 + c + 1}`, `Espaço de armadura ${r * 3 + c + 1}`, 0, x + 4.75, y + 5.25, 9)));
// Dano & saúde: limiares = base da armadura + nível (sem armadura: nível e 2 × nível)
num("limiar_maior", "Limiar de dano maior (base + nível)", "computed", 0, 81.5, 31.5, 199, 12,
  { formula: "if @armadura_limiar_maior > 0 then @armadura_limiar_maior + @nivel else @nivel" });
num("limiar_severo", "Limiar de dano severo (base + nível)", "computed", 0, 169.5, 31.5, 199, 12,
  { formula: "if @armadura_limiar_severo > 0 then @armadura_limiar_severo + @nivel else 2 * @nivel" });
for (let i = 0; i < 12; i++) check(`pv_${i + 1}`, `PV ${i + 1}${i >= 6 ? " (espaço extra)" : ""}`, 0, 44.5 + 18.75 * i, 234.25, 8);
for (let i = 0; i < 12; i++) check(`estresse_${i + 1}`, `Estresse ${i + 1}${i >= 6 ? " (espaço extra)" : ""}`, 0, 69.5 + 16.5 * i, 256.5, 8);
[40, 75.5, 111, 146.5, 182, 217.5].forEach((x, i) => check(`esperanca_${i + 1}`, `Esperança ${i + 1}`, 0, x + 7, 309.5, 11));
onLine("habilidade_esperanca", "Habilidade de esperança", 0, 18, 344.25, 236, 9, { maxLength: 120 });
[397.75, 417.5, 437, 456.75, 476.5].forEach((L, i) => {
  onLine(`experiencia_${i + 1}`, `Experiência ${i + 1}`, 0, 18, L, 194, 9, { maxLength: 60 });
  num(`experiencia_${i + 1}_bonus`, `Experiência ${i + 1} — bônus`, "number", 0, 218, 38, L - 8.3, 9, { min: -9, max: 9 });
});
[16, 28, 40.5, 53, 65.5, 78.5, 90.5, 103, 115.5].forEach((x, i) => check(`ouro_punhado_${i + 1}`, `Ouro — punhado ${i + 1}`, 0, x + 3.5, 517, 7));
[134.5, 145.5, 157, 168, 179.5, 190.5, 202, 213, 224.5].forEach((x, i) => check(`ouro_bolsa_${i + 1}`, `Ouro — bolsa ${i + 1}`, 0, x + 4.6, 518, 8));
check("ouro_bau", "Ouro — baú", 0, 250, 518.5, 8);
list("habilidade_classe", "Habilidade de classe (uma por linha)", 0, 8, 563, 252, 16, 10, 2000);
// Armas ativas
[451.5, 463, 474.5, 486, 497.5].forEach((x, i) => check(`proficiencia_${i + 2}`, `Proficiência ${i + 2}`, 0, x + 3.75, 176.75, 8));
const weapon = (k, l, L1, L2, L3) => {
  onLine(k, `${l} — nome`, 0, 292, L1, 120, 9, { maxLength: 40 });
  onLine(`${k}_atributo_alcance`, `${l} — atributo & alcance`, 0, 418, L1, 90, 9, { maxLength: 30 });
  onLine(`${k}_dano`, `${l} — dano & tipo`, 0, 514, L1, 81, 9, { maxLength: 30 });
  onLine(`${k}_descricao`, `${l} — habilidade (linha 1)`, 0, 292, L2, 303, 9, { maxLength: 80 });
  onLine(`${k}_descricao_2`, `${l} — habilidade (linha 2)`, 0, 329, L3, 266, 9, { maxLength: 80 });
};
weapon("arma_primaria", "Arma primária", 212.25, 237.75, 261);
weapon("arma_secundaria", "Arma secundária", 305.5, 331, 355);
// Armadura ativa
onLine("armadura_ativa", "Armadura ativa — nome", 0, 292, 409.25, 154, 9, { maxLength: 40 });
num("armadura_limiar_maior", "Armadura — limiar base maior", "number", 0, 452, 38, 403, 9, { min: 0, max: 99 });
num("armadura_limiar_severo", "Armadura — limiar base severo", "number", 0, 491, 38, 403, 9, { min: 0, max: 99 });
num("armadura_defesa_base", "Armadura — defesa base", "number", 0, 535, 60, 403, 9, { min: 0, max: 99 });
onLine("armadura_ativa_descricao", "Armadura ativa — habilidade (linha 1)", 0, 292, 436, 303, 9, { maxLength: 80 });
onLine("armadura_ativa_descricao_2", "Armadura ativa — habilidade (linha 2)", 0, 329, 459, 266, 9, { maxLength: 80 });
// Inventário e armas no inventário
list("inventario", "Inventário (um item por linha)", 0, 286, 498, 318, 7, 10, 1500);
[[1, 610.25, 633.5, 659, 681], [2, 700.75, 724, 749.75, 771.75]].forEach(([n, cb, L1, L2, L3]) => {
  weapon(`arma_inventario_${n}`, `Arma no inventário ${n}`, L1, L2, L3);
  check(`arma_inventario_${n}_primaria`, `Arma no inventário ${n} — primária`, 0, 502.75, cb, 8);
  check(`arma_inventario_${n}_secundaria`, `Arma no inventário ${n} — secundária`, 0, 548.5, cb, 8);
});

// ---------- Página 2 ----------
line("idade", "Idade", "text", 1, 233, 18.5, 42, 10, { maxLength: 15 });
line("altura", "Altura", "text", 1, 315, 18.5, 41, 10, { maxLength: 15 });
line("peso", "Peso", "text", 1, 387, 18.5, 52, 10, { maxLength: 15 });
line("outro", "Outro", "text", 1, 475, 18.5, 128, 10, { maxLength: 40 });
line("olhos", "Olhos", "text", 1, 225, 38, 76, 10, { maxLength: 30 });
line("corpo", "Corpo", "text", 1, 337, 38, 114, 10, { maxLength: 40 });
line("cabelos", "Cabelos", "text", 1, 495, 38, 108, 10, { maxLength: 40 });
list("cartas_dominio_itens", "Cartas de domínio (uma por linha)", 1, 8, 92, 262, 56, 10, 4000);
[[1, 108.25, 131.75], [2, 157.25, 180.25]].forEach(([n, L1, L2]) => {
  onLine(`habilidade_ancestralidade_${n}`, `Habilidade de ancestralidade ${n}`, 1, 298, L1, 302, 9, { maxLength: 60 });
  onLine(`habilidade_ancestralidade_${n}_descricao`, `Habilidade de ancestralidade ${n} — descrição`, 1, 336, L2, 264, 9, { maxLength: 80 });
});
onLine("habilidade_comunidade", "Habilidade de comunidade", 1, 298, 234.75, 302, 9, { maxLength: 60 });
onLine("habilidade_comunidade_descricao", "Habilidade de comunidade — descrição", 1, 336, 257.75, 264, 9, { maxLength: 80 });
onLine("atributo_conjuracao", "Atributo de conjuração", 1, 330, 325.75, 238, 9, { maxLength: 30 });
list("habilidade_fundamento", "Habilidade de fundamento (uma por linha)", 1, 292, 337, 304, 9, 10, 1500);
list("habilidade_especializada", "Habilidade especializada (uma por linha)", 1, 292, 482, 304, 10, 10, 1500);
list("habilidade_maestria", "Habilidade de maestria (uma por linha)", 1, 292, 636, 304, 10, 10, 1500);

// ---------- Ações: Dados de Dualidade (2d12: Esperança e Medo) + atributo ----------
const actions = [["agilidade", "Agilidade", "correr, saltar, manobrar"], ["forca", "Força", "levantar, esmagar, agarrar"],
  ["finesse", "Finesse", "controlar, esconder, futucar"], ["instinto", "Instinto", "perceber, pressentir, navegar"],
  ["presenca", "Presença", "encantar, performar, enganar"], ["conhecimento", "Conhecimento", "lembrar, analisar, compreender"]]
  .map(([k, l, d]) => ({ key: `teste_${k}`, name: `Teste de ${l}`, kind: "habilidade", formula: `2d12 + @${k}`,
    description: `Dados de Dualidade (Esperança e Medo) + ${l}: ${d}. O dado maior indica com Esperança ou com Medo.` }));
actions.push({ key: "dualidade", name: "Dados de Dualidade", kind: "habilidade", formula: "2d12",
  description: "1d12 de Esperança e 1d12 de Medo; some atributo e experiência conforme o teste." });
return { pages: [{ width: PW, height: PH }, { width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da ficha de Daggerheart (2 páginas): atributos, evasão, armadura e limiares calculados, PV, estresse, esperança, experiências, ouro, armas, armadura ativa, inventário, cartas de domínio e habilidades (listas com uma caixa por linha e descrição por item)." };
})()
