(() => {
// Ficha Vampiro: A Máscara V5 (PDF comum, 2 páginas Carta 612 x 792). Mesmo formato do editor (compactDoc).
// Bolinhas e quadradinhos são listas cujas opções são os próprios símbolos (● e ■), na fonte e no
// tamanho que cobrem os círculos/quadrados impressos: ● Arial em 16,35 pt tem o passo de 9,875 pt da ficha,
// ■ em 18 pt tem o passo de 10,875 pt. Na exportação o texto começa em (x + 1, y + 1) pt e a linha de base
// fica 0,776 em abaixo do topo (Arial no Chrome).
const PAGES = [{ width: 612, height: 792 }, { width: 612, height: 792 }], F = [];
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const DEF = [["role", null], ["page", 0], ["formula", null], ["default", null], ["min", null], ["max", null], ["maxLength", null], ["fontSize", 10], ["align", "left"]];
function add(name, label, type, page, x, y, w, h, fs = 10, kw = {}) {
  const { width: PW, height: PH } = PAGES[page];
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
const base = (B, fs) => [B - 1 - 0.776 * fs, 1.2 * fs + 1]; // texto com linha de base em B
const mid = (cy, fs) => [cy - 1 - 0.416 * fs, 1.2 * fs + 1]; // texto centrado verticalmente em cy
const DOT = 16.35, BOX = 18;
const dotOpts = (n, gap) => Array.from({ length: n }, (_, i) => i < 5 ? "●".repeat(i + 1) : "●●●●●" + gap + "●".repeat(i - 4));
const boxOpts = (n, gap) => Array.from({ length: n }, (_, i) => i < 5 ? "■".repeat(i + 1) : "■■■■■" + gap + "■".repeat(i - 4));
const DOTS5 = dotOpts(5);
function dots(name, label, page, c1, cy, kw = {}, n = 5) {
  // caixa centrada no círculo (o centro do ● fica 1 + 0,495 em abaixo do topo) e larga o bastante para a seta da lista no modo de preenchimento
  const hh = 1 + 0.495 * DOT;
  add(name, label, "select", page, c1 - 1 - 0.3 * DOT, cy - hh, n === 5 ? 66 : 119, 2 * hh, DOT, { options: DOTS5, ...kw });
}
function boxes(name, label, page, c1, cy, w, kw) {
  const hh = 1 + 0.545 * BOX;
  add(name, label, "select", page, c1 - 1 - 0.295 * BOX, cy - hh, w, 2 * hh, BOX, kw);
}
let y, h;
// ---------- Página 1 ----------
const HEAD = [[["nome", "Nome", 85.2, 60], ["conceito", "Conceito", 260.0, 80], ["predador", "Predador", 424.4, 40]],
  [["cronica", "Crônica", 91.9, 80], ["ambicao", "Ambição", 259.9, 120], ["cla", "Clã", 403.9, 40]],
  [["senhor", "Senhor", 88.8, 60], ["desejo", "Desejo", 251.1, 120], ["geracao", "Geração", 421.0, 20]]];
const COLR = [223.5, 387.5, 551.5];
HEAD.forEach((row, r) => row.forEach(([k, l, end, ml], c) => {
  [y, h] = base([104.1, 126.8, 149.4][r], 10);
  add(k, l, "text", 0, end + 4, y, COLR[c] - end - 7, h, 10, { maxLength: ml, ...(k === "nome" ? { role: "name" } : {}) });
}));
// Atributos
const ATR = [[["forca", "Força"], ["destreza", "Destreza"], ["vigor", "Vigor"]],
  [["carisma", "Carisma"], ["manipulacao", "Manipulação"], ["autocontrole", "Autocontrole"]],
  [["inteligencia", "Inteligência"], ["raciocinio", "Raciocínio"], ["determinacao", "Determinação"]]];
const ATRC = [162.62, 326.62, 490.88], ATRY = [204.62, 224.38, 244.38];
ATR.forEach((col, c) => col.forEach(([k, l], r) => dots(k, l, 0, ATRC[c] - (c === 1 && r === 2 ? 0.24 : 0), ATRY[r] - (c === 1 && r === 2 ? 0.5 : 0), { default: "●" })));
// Vitalidade e Força de Vontade: um campo por quadrado (/ = superficial, X = agravado)
const VIT = [187.0, 197.75, 208.75, 219.5, 230.5, 245.75, 256.75, 267.5, 278.5, 289.25];
const FV = [320.0, 331.0, 341.75, 352.75, 363.5, 379.0, 389.75, 400.75, 411.5, 422.5];
const mark = (k, l, cx) => add(k, l, "select", 0, cx - 1 - 0.2325 * 8, 276 - (1 + 0.415 * 8), 10.5, 2 * (1 + 0.415 * 8), 8, { options: ["/", "X"] });
VIT.forEach((cx, i) => mark(`vitalidade_${i + 1}`, `Vitalidade — caixa ${i + 1}`, cx));
FV.forEach((cx, i) => mark(`vontade_${i + 1}`, `Força de Vontade — caixa ${i + 1}`, cx));
// Habilidades: bolinhas e especialização na linha pontilhada
const HAB = [
  [["armas_brancas", "Armas Brancas", 112.7], ["armas_fogo", "Armas de Fogo", 112.9], ["atletismo", "Atletismo", 94.7], ["briga", "Briga", 78.2], ["conducao", "Condução", 95.5],
   ["furtividade", "Furtividade", 100.4], ["ladroagem", "Ladroagem", 98.8], ["oficios", "Ofícios", 85.0], ["sobrevivencia", "Sobrevivência", 108.7]],
  [["empatia_animais", "Empatia com Animais", 303.4], ["etiqueta", "Etiqueta", 255.2], ["intimidacao", "Intimidação", 268.0], ["lideranca", "Liderança", 260.2], ["manha", "Manha", 249.6],
   ["performance", "Performance", 270.6], ["persuasao", "Persuasão", 259.7], ["sagacidade", "Sagacidade", 264.2], ["subterfugio", "Subterfúgio", 267.0]],
  [["ciencia", "Ciência", 420.0], ["erudicao", "Erudição", 424.9], ["financas", "Finanças", 424.1], ["investigacao", "Investigação", 436.8], ["medicina", "Medicina", 426.2],
   ["ocultismo", "Ocultismo", 430.6], ["percepcao", "Percepção", 429.3], ["politica", "Política", 420.3], ["tecnologia", "Tecnologia", 432.5]],
];
const HABC = [173.62, 340.62, 507.38], HABY = [321.62, 342.12, 362.62, 383.38, 404.12, 424.88, 445.62, 466.12, 486.88];
HAB.forEach((col, c) => col.forEach(([k, l, end], r) => {
  dots(k, l, 0, HABC[c], HABY[r] + (r === 0 && c > 0 ? -0.25 : r === 0 ? 0.25 : 0));
  [y, h] = base(324.6 + 20.7 * r, 7);
  add(`${k}_espec`, `${l} — especialização`, "text", 0, end + 2, y, HABC[c] - 9 - end - 2, h, 7, { maxLength: 40 });
}));
// Disciplinas: 2 linhas de 3 blocos (nome + bolinhas, 5 linhas de poderes)
const DCOL = [[59.5, 223.75, 175.62], [223.75, 387.5, 340.62], [387.5, 552.25, 504.38]];
[[516.75, 525.88], [619.5, 627.88]].forEach(([top, cy], b) => DCOL.forEach(([x0, x1, c1], c) => {
  const n = b * 3 + c + 1;
  const nx = x0 + (c ? 15 : 3); // deixa livre a ponta da lista de bolinhas da coluna à esquerda
  [y, h] = mid(cy, 10); add(`disciplina_${n}`, `Disciplina ${n}`, "text", 0, nx, y, c1 - 9 - nx, h, 10, { maxLength: 40 });
  dots(`disciplina_${n}_nivel`, `Disciplina ${n} — nível`, 0, c1, cy);
  for (let p = 0; p < 5; p++) {
    [y, h] = mid((b ? 636.5 : 534.5) + 17 * p + 8.5, 9);
    add(`disciplina_${n}_poder_${p + 1}`, `Disciplina ${n} — poder ${p + 1}`, "text", 0, x0 + 3, y, x1 - x0 - 6, h, 9, { maxLength: 60 });
  }
}));
[y, h] = base(741.6, 10); add("ressonancia", "Ressonância", "text", 0, 117, y, 107, h, 10, { maxLength: 40 });
boxes("fome", "Fome", 0, 297.5, 738.75, 95, { options: boxOpts(5), default: "■" });
boxes("humanidade", "Humanidade", 0, 445.5, 738.75, 172, { options: boxOpts(10, " "), default: "■■■■■ ■■" });
// ---------- Página 2 ----------
[["principios", "Princípios da Crônica", 59.5, 225], ["pilares", "Pilares & Convicções", 225, 390.25], ["perdicao", "Perdição do Clã", 390.25, 552.25]]
  .forEach(([k, l, x0, x1]) => add(k, l, "textarea", 1, x0 + 3, 98, x1 - x0 - 6, 130, 9, { maxLength: 3000 }));
for (let i = 0; i < 11; i++) {
  const cy = 265.12 + 22.75 * i - (i > 2 ? 0.08 * (i - 2) : 0);
  [y, h] = mid(cy, 10); add(`vantagem_${i + 1}`, `Vantagem/defeito ${i + 1}`, "text", 1, 62, y, 181, h, 10, { maxLength: 60 });
  dots(`vantagem_${i + 1}_nivel`, `Vantagem/defeito ${i + 1} — nível`, 1, 252.38, cy);
}
dots("potencia_sangue", "Potência de Sangue", 1, 433.88, 244.38, { options: dotOpts(10, " ") }, 10);
[["surto_sangue", "Surto de Sangue", 315.5, 281.5], ["quantidade_recuperada", "Quantidade Recuperada", 436, 281.5],
 ["bonus_poder", "Bônus de Poder", 315.5, 321.2], ["rerrolagem_sangue", "Rerrolagem de Sangue", 436, 321.2],
 ["penalidade_alimentacao", "Penalidade de Alimentação", 315.5, 361], ["gravidade_perdicao", "Gravidade da Perdição", 436, 361]]
  .forEach(([k, l, x, cy]) => { [y, h] = mid(cy, 10); add(k, l, "text", 1, x, y, 113, h, 10, { maxLength: 40 }); });
[y, h] = base(397, 11); add("xp_total", "Experiência total", "number", 1, 400, y, 150, h, 11, { default: "0", min: 0, max: 9999 });
[y, h] = base(421, 11); add("xp_gasta", "Experiência gasta", "number", 1, 401, y, 149, h, 11, { default: "0", min: 0, max: 9999 });
[["idade_verdadeira", "Idade verdadeira", 376.7, 448.2], ["idade_aparente", "Idade aparente", 370.8, 468.1],
 ["data_nascimento", "Data de nascimento", 387.4, 487.9], ["data_morte", "Data de morte", 367.2, 507.7]]
  .forEach(([k, l, end, B]) => { [y, h] = base(B, 10); add(k, l, "text", 1, end + 5, y, 549 - end - 5, h, 10, { maxLength: 40 }); });
add("aparencia", "Aparência", "textarea", 1, 315, 531, 235, 22, 9, { maxLength: 1000 });
add("tracos_distintivos", "Traços distintivos", "textarea", 1, 315, 571, 235, 22, 9, { maxLength: 1000 });
add("historia", "História", "textarea", 1, 315, 611, 235, 124, 9, { maxLength: 6000 });
add("notas", "Notas", "textarea", 1, 63, 528, 235, 207, 9, { maxLength: 6000 });
const actions = [
  { key: "teste_despertar", name: "Teste de Despertar", kind: "habilidade", formula: "1d10", description: "Role 1d10: 6 ou mais é sucesso; em falha, a Fome aumenta em 1." },
];
return { pages: PAGES, fields: F, actions,
  notes: "Mapeamento da ficha de Vampiro: A Máscara V5 (2 páginas). Bolinhas e quadradinhos são listas cujas opções (● / ■) cobrem os círculos e quadrados impressos; Vitalidade e Força de Vontade têm um campo por caixa (/ superficial, X agravado)." };
})()
