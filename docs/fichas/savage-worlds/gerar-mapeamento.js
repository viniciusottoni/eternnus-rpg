(() => {
// Ficha Savage Worlds — Edição Aventura (RetroPunk; PDF comum, 1 página A4 de 595 x 842 pt). Mesmo formato do editor (compactDoc).
// Dados de atributos e perícias: número do dado (4, 6, 8, 10 ou 12; 13 = d12+1…) na caixinha quadrada, usado nas ações e nos cálculos.
// Listas (ADR-098): vantagens, complicações (desvantagens), armamento e poderes, com uma caixa por linha e descrição por item.
const PW = 595, PH = 842, F = [];
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
const line = (name, label, type, x, cy, w, fs, kw = {}) => { const [y, h] = boxed(cy, fs); add(name, label, type, 0, x, y, w, h, fs, kw); };
const onLine = (name, label, type, x, L, w, fs, kw = {}) => add(name, label, type, 0, x, L - 3 - 0.905 * fs, w, 1.2 * fs + 1, fs, kw);
const num = (name, label, type, x, w, cy, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  line(name, label, type, left, cy, Math.min(w - 1, x + w - left - 0.5), fs, kw);
};
const check = (name, label, cx, cy, fs) => num(name, label, "checkbox", cx - 0.5 * fs, fs, cy, fs, {}, 1);
// Lista sobre linhas impressas (texto apoiado em cada linha, passo P a partir da linha L0).
const ruledLines = (name, label, x, L0, w, P, n, kw = {}) => {
  const fs = Math.round((P / 1.2) * 1e4) / 1e4;
  add(name, label, "textarea", 0, x, L0 - 3 - 0.905 * fs, w, n * P + 1, fs, kw);
};
// Lista em tabela (células de altura ch, passo P a partir do topo r0).
const ruledCells = (name, label, x, r0, ch, w, P, n, kw = {}) => {
  const fs = Math.round((P / 1.2) * 1e4) / 1e4;
  add(name, label, "textarea", 0, x, r0 + ch / 2 - 0.6 * fs - 0.5, w, n * P + 1, fs, kw);
};
const DIE = { min: 0, max: 16 };
const dieHelp = "dado 4 a 12; 13 = d12+1";
// Teste com dado selvagem: dado da característica e d6, fica o maior; sem dado (0), d4 − 2.
const wild = (k) => `if @${k} >= 12 then max(1d12, 1d6) + @${k} - 12 else if @${k} >= 10 then max(1d10, 1d6) else if @${k} >= 8 then max(1d8, 1d6) else if @${k} >= 6 then max(1d6, 1d6) else if @${k} >= 4 then max(1d4, 1d6) else max(1d4, 1d6) - 2`;
const actions = [];
const act = (k, l, desc) => {
  const formula = wild(k);
  if (formula.length > 300) throw new Error(`fórmula longa demais: ${k}`);
  actions.push({ key: `teste_${k}`, name: l, kind: "habilidade", formula, description: desc });
};

// ---------- Cabeçalho ----------
line("nome", "Nome", "text", 215, 42.75, 182, 11, { role: "name", maxLength: 40 });
line("jogador", "Jogador", "text", 454, 42.75, 108, 11, { maxLength: 30 });
line("aparencia", "Aparência", "text", 215, 70.75, 346, 11, { maxLength: 80 });
line("conceito", "Conceito", "text", 215, 99.25, 160, 11, { maxLength: 40 });
num("experiencia", "Experiência (pontos)", "number", 451, 113, 99.25, 11, { min: 0, max: 999 }, 3);
// ---------- Atributos ----------
[["agilidade", "Agilidade", 112], ["esperteza", "Esperteza", 219], ["espirito", "Espírito", 326], ["forca", "Força", 433], ["vigor", "Vigor", 540.5]]
  .forEach(([k, l, x]) => {
    num(k, `${l} — ${dieHelp}`, "number", x, 18, 129.25, 9, { ...DIE, default: "4" });
    act(k, `Teste de ${l}`, `Dado de ${l} e dado selvagem d6: fica o maior.`);
  });
// ---------- Perícias (3 colunas x 12 linhas; caixinha quadrada = dado) ----------
const ROWS = [198.5, 213, 227, 241, 255.5, 269.5, 284, 298, 312, 326.5, 340.5, 354.5];
const COLS = [91, 275.25, 448];
const SK = [
  ["arremessar", "Arremessar (Agi)"], ["arrombar", "Arrombar (Agi)"], ["atirar", "Atirar (Agi)"], ["cavalgar", "Cavalgar (Agi)"],
  ["ciencia_estranha", "Ciência Estranha (Eza)"], ["conhecimento", "Conhecimento (Eza)"], ["conhecimento_1", "*Conhecimento 1 (Eza)"], ["conhecimento_2", "*Conhecimento 2 (Eza)"],
  ["consertar", "Consertar (Eza)"], ["coragem", "Coragem (Esp)"], ["curar", "Curar (Eza)"], ["dirigir", "Dirigir (Agi)"],
  ["escalar", "Escalar (For)"], ["fe", "Fé (Esp)"], ["furtividade", "Furtividade (Agi)"], ["intimidar", "Intimidar (Esp)"],
  ["investigar", "Investigar (Eza)"], ["jogar", "Jogar (Eza)"], ["lutar", "Lutar (Agi)"], ["magia", "Magia (Eza)"],
  ["manha", "Manha (Eza)"], ["nadar", "Nadar (Agi)"], ["navegar", "Navegar (Agi)"], ["perceber", "Perceber (Eza)"],
  ["persuadir", "Persuadir (Esp)"], ["pilotar", "Pilotar (Agi)"], ["provocar", "Provocar (Eza)"], ["psiquismo", "Psiquismo (Eza)"],
  ["rastrear", "Rastrear (Eza)"], ["sobreviver", "Sobreviver (Eza)"],
  ["pericia_extra_1", "*Perícia extra 1"], ["pericia_extra_2", "*Perícia extra 2"], ["pericia_extra_3", "*Perícia extra 3"],
  ["pericia_extra_4", "*Perícia extra 4"], ["pericia_extra_5", "*Perícia extra 5"], ["pericia_extra_6", "*Perícia extra 6"],
];
SK.forEach(([k, raw], i) => {
  const col = Math.floor(i / 12), y = ROWS[i % 12], cy = y + 5.75, typed = raw.startsWith("*"), l = typed ? raw.slice(1) : raw;
  if (typed) line(`${k}_nome`, `${l} — nome`, "text", col === 0 ? 135.5 : 470, cy, col === 0 ? 67 : 82, 8, { maxLength: 30 });
  num(k, `${l} — ${dieHelp}; vazio = sem perícia`, "number", COLS[col], 16.5, cy, 8, DIE);
  act(k, l.replace(/ \(\w+\)$/, ""), `${l}: dado da perícia e dado selvagem d6, fica o maior. Sem a perícia: d4 − 2.`);
});
// ---------- Estatísticas derivadas ----------
num("movimentacao", "Movimentação", "number", 60.5, 32, 413.75, 15, { role: "movement", default: "6", min: 0, max: 99 });
num("aparar", "Aparar (2 + metade de Lutar)", "computed", 160, 31.5, 413.75, 15, { role: "armor", formula: "2 + floor(@lutar / 2)" });
num("resistencia", "Resistência (2 + metade do Vigor + armadura do tronco)", "computed", 270.5, 31.5, 413.75, 15,
  { formula: "2 + floor(@vigor / 2) + @armadura_tronco" });
num("carisma", "Carisma", "number", 384, 31.5, 413.75, 15, { default: "0", min: -9, max: 9 });
// ---------- Vantagens e complicações ----------
ruledLines("vantagens", "Vantagens (uma por linha)", 38, 518.5, 134, (587 - 518.5) / 6, 7, { maxLength: 1000 });
ruledLines("desvantagens_iniciais", "Complicações iniciais (uma por linha)", 222, 518.5, 223, 11.5, 2, { maxLength: 300 });
ruledLines("desvantagens_outras", "Complicações — outras (uma por linha)", 222, 541, 223, 11.5, 5, { maxLength: 800 });
// ---------- Armamentos e poderes (listas em tabela; as colunas seguem as linhas do item) ----------
const W = (k, l, x, w, max) => ruledCells(k, l, x + 1, 627, 10.5, w - 2, 11.25, 3, { maxLength: max });
W("armamento", "Armamento (um por linha)", 37, 124.5, 300);
W("armamento_distancia", "Armamento — distância", 164.5, 48, 100);
W("armamento_cdt", "Armamento — CdT", 215.5, 33.5, 40);
W("armamento_dano", "Armamento — dano", 252.5, 48, 100);
W("armamento_pa_mod", "Armamento — PA (penetração de armadura)", 303.5, 28, 30);
W("armamento_peso", "Armamento — peso", 335, 27.5, 30);
W("armamento_anotacoes", "Armamento — anotações", 366, 81.5, 200);
const P = (k, l, x, w, max) => ruledCells(k, l, x + 1, 672, 11, w - 2, (706 - 672) / 3, 4, { maxLength: max });
P("poderes", "Poderes (um por linha)", 37, 124.5, 400);
P("poderes_custo", "Poderes — custo", 164.5, 48, 100);
P("poderes_distancia", "Poderes — distância", 215.5, 48, 100);
P("poderes_dano", "Poderes — dano/efeito", 267, 127, 300);
P("poderes_duracao", "Poderes — duração", 397, 48, 100);
// ---------- Anotações adicionais (texto corrido sobre as 4 linhas) ----------
const an = Math.round(((788.25 - 754.25) / 3 / 1.2) * 1e4) / 1e4;
add("anotacoes", "Anotações adicionais", "textarea", 0, 38, 754.25 - 3 - 0.905 * an, 408, 4 * 1.2 * an + 1, an, { maxLength: 1200 });
// ---------- Saúde ----------
[["ferimento_1", "Ferimento −1", 417.5], ["ferimento_2", "Ferimento −2", 451.5], ["ferimento_3", "Ferimento −3", 485.5]]
  .forEach(([k, l, y]) => check(k, l, 544.25, y + 16, 22));
check("incapacitado", "Incapacitado", 533, 533, 16);
check("fadiga_2", "Fadiga −2", 544.25, 564, 22);
check("fadiga_1", "Fadiga −1", 544.25, 598.25, 22);
add("ferimentos_permanentes", "Ferimentos permanentes", "textarea", 0, 465, 638, 92, 31, 8, { maxLength: 300 });
// ---------- Armadura e carga ----------
[["cabeca", "Cabeça", 705], ["tronco", "Tronco", 715], ["bracos", "Braços", 725], ["pernas", "Pernas", 735]]
  .forEach(([k, l, L]) => onLine(`armadura_${k}`, `Armadura — ${l}`, "number", 491, L, 64, 8, { min: 0, max: 99 }));
onLine("carga_peso", "Carga — peso carregado", "text", 522, 768, 35, 8, { maxLength: 10 });
onLine("carga_limite", "Carga — limite", "text", 487, 778, 71, 8, { maxLength: 20 });
onLine("carga_penalidade", "Carga — penalidade", "text", 507, 788, 51, 8, { maxLength: 15 });
// ---------- Trilha de experiência (43 marcas) ----------
for (let n = 1; n <= 43; n++) check(`xp_${n}`, `Experiência — marca ${n}`, 34.9 + (n - 1) * 12.47, 805.5, 9);
actions.push({ key: "dado_selvagem", name: "Dado selvagem", kind: "habilidade", formula: "1d6", description: "d6 rolado junto com o dado da característica em todo teste de Carta Selvagem." });
return { pages: [{ width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da ficha de Savage Worlds (Edição Aventura, RetroPunk): atributos e perícias com o dado na caixinha (testes com dado selvagem), Aparar e Resistência calculados, vantagens, complicações, armamento e poderes em listas, saúde, armadura, carga e trilha de experiência." };
})()
