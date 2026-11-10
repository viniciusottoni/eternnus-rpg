(() => {
// Ficha Chamado de Cthulhu 7e (PDF comum: pág. 1 A4 595,28 x 841,89; pág. 2 Carta 612 x 792). Mesmo formato do editor (compactDoc).
const PAGES = [{ width: 595.28, height: 841.89 }, { width: 612, height: 792 }], F = [];
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
const onLine = (L, fs) => [L - 4 - 0.905 * fs, 1.2 * fs + 1];
const boxed = (cy, fs) => { const h = 1.2 * fs + 1; return [cy - h / 2, h]; };
let y, h;
// ---------- Página 1: investigador ----------
[y, h] = onLine(67, 11); add("nome", "Nome", "text", 0, 81, y, 193, h, 11, { role: "name", maxLength: 100 });
[y, h] = onLine(83, 11); add("jogador", "Jogador(a)", "text", 0, 107, y, 167, h, 11, { maxLength: 80 });
[y, h] = onLine(99, 11); add("ocupacao", "Ocupação", "text", 0, 101, y, 173, h, 11, { maxLength: 60 });
[y, h] = onLine(115.5, 11);
add("idade", "Idade", "number", 0, 77, y, 74, h, 11, { default: "25", min: 15, max: 120 });
add("sexo", "Sexo", "text", 0, 183, y, 91, h, 11, { maxLength: 30 });
[y, h] = onLine(131.5, 11); add("residencia", "Residência", "text", 0, 107, y, 167, h, 11, { maxLength: 80 });
[y, h] = onLine(148, 11); add("nascimento", "Local de nascimento", "text", 0, 113, y, 161, h, 11, { maxLength: 80 });
// Características: valor, metade e quinto
const CH = [["forca", "Força (FOR)", 324, 61], ["destreza", "Destreza (DES)", 409, 61], ["poder", "Poder (POD)", 498.5, 61],
  ["constituicao", "Constituição (CON)", 324, 93], ["aparencia", "Aparência (APA)", 409, 93], ["educacao", "Educação (EDU)", 498.5, 93],
  ["tamanho", "Tamanho (TAM)", 324, 125], ["inteligencia", "Inteligência (INT)", 409, 125]];
for (const [k, l, bx, by] of CH) {
  [y, h] = boxed(by + 13, 14);
  add(k, l, "number", 0, bx + 1, y, 24, h, 14, { default: "50", min: 0, max: 999, align: "center" });
  [y, h] = boxed(by + 6.5, 9); add(`${k}_metade`, `${l} — metade`, "computed", 0, bx + 27, y, 21, h, 9, { formula: `floor(@${k} / 2)`, align: "center" });
  [y, h] = boxed(by + 19.5, 9); add(`${k}_quinto`, `${l} — quinto`, "computed", 0, bx + 27, y, 21, h, 9, { formula: `floor(@${k} / 5)`, align: "center" });
}
[y, h] = boxed(137, 16);
add("movimento", "Taxa de movimento (MOV)", "computed", 0, 503, y, 21, h, 16, { role: "movement",
  formula: "max(1, (if @destreza > @tamanho and @forca > @tamanho then 9 else if @destreza < @tamanho and @forca < @tamanho then 7 else 8) - (if @idade >= 40 then min(5, floor((@idade - 30) / 10)) else 0))", align: "center" });
// Pontos de vida, sanidade, sorte e magia
add("lesao_grave", "Lesão grave", "checkbox", 0, 69, 161, 11, 11, 11);
[y, h] = boxed(167, 11);
add("pv_max", "PV máximos", "computed", 0, 120, y, 19, h, 11, { role: "maxHp", formula: "floor((@constituicao + @tamanho) / 10)", align: "center" });
add("pv_atual", "PV atuais", "number", 0, 141, y, 24, h, 11, { role: "hp", default: "10", min: 0, max: 999, align: "center" });
add("insanidade_temporaria", "Insanidade temporária", "checkbox", 0, 199.5, 159, 12, 11, 11);
add("insanidade_indefinida", "Insanidade indefinida", "checkbox", 0, 258.5, 159, 11, 11, 11);
add("sanidade_atual", "Sanidade atual", "number", 0, 270.5, y + 0.5, 17, h - 1, 10, { default: "50", min: 0, max: 99, align: "center" });
add("sanidade_inicial", "Sanidade inicial (POD)", "computed", 0, 316, y, 20, h, 11, { formula: "@poder", align: "center" });
add("sanidade_maxima", "Sanidade máxima (99 − Mythos)", "computed", 0, 364, y, 20, h, 11, { formula: "99 - @mythos", align: "center" });
[y, h] = boxed(249.25, 11); add("sorte", "Sorte (atual)", "number", 0, 196, y, 18, h, 11, { default: "50", min: 0, max: 99, align: "center" });
[y, h] = boxed(225.5, 11);
add("pm_atual", "Pontos de magia atuais", "number", 0, 440, y, 26, h, 11, { default: "10", min: 0, max: 999, align: "center" });
add("pm_max", "Pontos de magia máximos", "computed", 0, 494, y, 18, h, 11, { formula: "floor(@poder / 5)", align: "center" });
// Perícias: valor (base como padrão), metade e quinto. Linhas em branco têm campo para o nome.
const COLS = [137, 265, 393, 521.5];
const NAMEX = [[52, 80], [182, 80], [310, 80], [437.5, 79]];
const SK = [
  [["antropologia", "Antropologia", "1"], ["armas_pistolas", "Armas de Fogo (Pistolas)", "20"], ["armas_rifles", "Armas de Fogo (Rifles)", "25"], ["arqueologia", "Arqueologia", "1"],
   ["arremessar", "Arremessar", "20"], ["arte_oficio", "Arte/Ofício", "5"], ["livre_1", null], ["livre_2", null], ["livre_3", null], ["avaliacao", "Avaliação", "5"],
   ["cavalgar", "Cavalgar", "5"], ["charme", "Charme", "15"], ["chaveiro", "Chaveiro", "1"], ["ciencia", "Ciência", "1"], ["livre_4", null]],
  [["livre_5", null], ["livre_6", null], ["consertos_eletricos", "Consertos Elétricos", "10"], ["consertos_mecanicos", "Consertos Mecânicos", "5"], ["contabilidade", "Contabilidade", "5"],
   ["direito", "Direito", "5"], ["dirigir_auto", "Dirigir Auto", "20"], ["disfarce", "Disfarce", "5"], ["encontrar", "Encontrar", "25"], ["escutar", "Escutar", "20"],
   ["escalar", "Escalar", "20"], ["esquivar", "Esquivar (metade da DES)", ""], ["labia", "Lábia", "5"], ["intimidacao", "Intimidação", "15"], ["historia", "História", "5"]],
  [["furtividade", "Furtividade", "20"], ["lingua_natural", "Língua Natural (EDU)", ""], ["livre_7", null], ["lingua_outra", "Língua (Outra)", "1"], ["livre_8", null],
   ["livre_9", null], ["livre_10", null], ["lutar", "Lutar (Brigar)", "25"], ["livre_11", null], ["medicina", "Medicina", "1"],
   ["mythos", "Mythos de Cthulhu", "0"], ["mundo_natural", "Mundo Natural", "10"], ["natacao", "Natação", "20"], ["navegacao", "Navegação", "10"], ["nivel_credito", "Nível de Crédito", "0"]],
  [["ocultismo", "Ocultismo", "5"], ["operar_maquinario", "Operar Maquinário", "1"], ["persuasao", "Persuasão", "10"], ["pilotar", "Pilotar", "1"], ["livre_12", null],
   ["prestidigitacao", "Prestidigitação", "10"], ["primeiros_socorros", "Primeiros Socorros", "30"], ["psicanalise", "Psicanálise", "1"], ["psicologia", "Psicologia", "10"], ["saltar", "Saltar", "20"],
   ["rastrear", "Rastrear", "10"], ["sobrevivencia", "Sobrevivência", "10"], ["usar_biblioteca", "Usar Biblioteca", "20"], ["livre_13", null], ["livre_14", null]],
];
SK.forEach((col, c) => col.forEach(([k, l, base], r) => {
  const top = 323.5 + 19.75 * r, mid = top + 9.25, bx = COLS[c];
  const label = l ?? `Perícia livre ${k.split("_")[1]}`;
  if (!l) { [y, h] = onLine(top + 15.5, 9); add(`${k}_nome`, `${label} — nome`, "text", 0, NAMEX[c][0], y, NAMEX[c][1], h, 9, { maxLength: 40 }); }
  [y, h] = boxed(mid, 10);
  add(k, label, "number", 0, bx + 0.5, y, 16.5, h, 10, { default: base || null, min: 0, max: 999, align: "center" });
  add(`${k}_metade`, `${label} — metade`, "computed", 0, bx + 17.5, top + 1, 12.5, 8.2, 7, { formula: `floor(@${k} / 2)`, align: "center" });
  add(`${k}_quinto`, `${label} — quinto`, "computed", 0, bx + 17.5, mid + 0.4, 12.5, 8.2, 7, { formula: `floor(@${k} / 5)`, align: "center" });
}));
// Armas: Desarmado usa Lutar (Brigar); duas linhas livres
[y, h] = onLine(664, 9);
add("desarmado_regular", "Desarmado — regular", "computed", 0, 120, y, 29, h, 9, { formula: "@lutar", align: "center" });
add("desarmado_dificil", "Desarmado — difícil", "computed", 0, 159.5, y, 29, h, 9, { formula: "floor(@lutar / 2)", align: "center" });
add("desarmado_extremo", "Desarmado — extremo", "computed", 0, 198.5, y, 29, h, 9, { formula: "floor(@lutar / 5)", align: "center" });
const WCOLS = [["nome", "arma", 45.5, 64, 40], ["regular", "regular", 120, 29, 6], ["dificil", "difícil", 159.5, 29, 6], ["extremo", "extremo", 198.5, 29, 6],
  ["dano", "dano", 237, 53, 20], ["alcance", "alcance", 301, 30, 15], ["ataques", "ataques", 341, 29, 6], ["municao", "munição", 380, 29, 10], ["defeito", "defeito", 420, 28, 6]];
[678.5, 692.5].forEach((L, i) => {
  [y, h] = onLine(L, 9);
  for (const [k, l, x, w, ml] of WCOLS) add(`arma_${i + 1}_${k}`, `Arma ${i + 1} — ${l}`, "text", 0, x, y, w, h, 9, { maxLength: ml });
});
// Combate
[y, h] = boxed(659, 12); add("bonus_dano", "Bônus de dano", "text", 0, 504, y, 40, h, 12, { default: "0", maxLength: 10 });
[y, h] = boxed(690, 12); add("corpo", "Corpo", "computed", 0, 512, y, 24, h, 12, {
  formula: "if @forca + @tamanho < 65 then -2 else if @forca + @tamanho < 85 then -1 else if @forca + @tamanho < 125 then 0 else if @forca + @tamanho < 165 then 1 else if @forca + @tamanho < 205 then 2 else 3 + floor((@forca + @tamanho - 205) / 80)", align: "center" });
[y, h] = boxed(721.75, 12); add("esquiva", "Esquiva (valor de Esquivar)", "computed", 0, 501.5, y, 24.5, h, 12, { formula: "@esquivar", align: "center" });
[y, h] = boxed(715, 9); add("esquiva_metade", "Esquiva — metade", "computed", 0, 528, y, 20, h, 9, { formula: "floor(@esquivar / 2)", align: "center" });
[y, h] = boxed(728.5, 9); add("esquiva_quinto", "Esquiva — quinto", "computed", 0, 528, y, 20, h, 9, { formula: "floor(@esquivar / 5)", align: "center" });
// ---------- Página 2: antecedentes ----------
const BG = [["descricao_pessoal", "Descrição pessoal", 0, 87, 42], ["caracteristicas", "Características", 1, 87, 42],
  ["ideologias", "Ideologias/Crenças", 0, 147, 41], ["ferimentos", "Ferimentos e cicatrizes", 1, 147, 41],
  ["pessoas", "Pessoas significativas", 0, 206, 41], ["fobias", "Fobias e manias", 1, 206, 41],
  ["locais", "Locais importantes", 0, 265, 41], ["tomos", "Tomos arcanos, feitiços e artefatos", 1, 265, 41],
  ["pertences", "Pertences queridos", 0, 326, 62], ["encontros", "Encontros com entidades estranhas", 1, 326, 62]];
for (const [k, l, col, yy, hh] of BG) add(k, l, "textarea", 1, col ? 311 : 57, yy, k === "caracteristicas" ? 162 : (col ? 245 : 240), hh, 9, { maxLength: 3000 });
add("equipamento_1", "Equipamento e pertences (coluna esquerda)", "textarea", 1, 53, 428, 140, 154, 9, { maxLength: 3000 });
add("equipamento_2", "Equipamento e pertences (coluna direita)", "textarea", 1, 200, 428, 138, 154, 9, { maxLength: 3000 });
[y, h] = onLine(442, 10); add("nivel_gastos", "Nível de gastos", "text", 1, 431, y, 121, h, 10, { maxLength: 40 });
[y, h] = onLine(458.5, 10); add("dinheiro", "Dinheiro", "text", 1, 402, y, 150, h, 10, { maxLength: 40 });
[y, h] = onLine(472, 10); add("patrimonio", "Patrimônio", "text", 1, 413, y, 139, h, 10, { maxLength: 60 });
add("patrimonio_detalhes", "Patrimônio e recursos (detalhes)", "textarea", 1, 352, 479, 200, 101, 9, { maxLength: 3000 });
const COMP = [[299, 634.5, 645], [396, 627, 636.5], [492.5, 635.25, 645], [299, 682, 692.25], [492.5, 682, 693], [299, 729.5, 739.5], [396, 738.5, 748.5], [492.5, 729.5, 740.5]];
COMP.forEach(([x, Lp, Lj], i) => {
  [y, h] = onLine(Lp + 0.5, 7); add(`companheiro_${i + 1}`, `Companheiro ${i + 1} — personagem`, "text", 1, x, y, 62, h, 7, { maxLength: 40 });
  [y, h] = onLine(Lj + 0.5, 7); add(`companheiro_${i + 1}_jogador`, `Companheiro ${i + 1} — jogador`, "text", 1, x, y, 62, h, 7, { maxLength: 40 });
});
const actions = [
  { key: "teste_percentual", name: "Teste percentual", kind: "habilidade", formula: "1d100", description: "Role 1d100 e compare com a perícia: ≤ valor regular, ≤ metade difícil, ≤ quinto extremo; 01 crítico." },
  { key: "teste_sanidade", name: "Teste de Sanidade", kind: "habilidade", formula: "1d100", description: "Role 1d100: sucesso se o resultado for ≤ Sanidade atual." },
  { key: "teste_sorte", name: "Teste de Sorte", kind: "habilidade", formula: "1d100", description: "Role 1d100: sucesso se o resultado for ≤ Sorte." },
];
return { pages: PAGES, fields: F, actions,
  notes: "Mapeamento da ficha de Chamado de Cthulhu 7e (PDF comum, 2 páginas): características com metade/quinto, MOV, PV/PM máximos, sanidade inicial e máxima, Corpo, 60 linhas de perícia com valor base, metade e quinto, armas (Desarmado pelo Lutar), esquiva e antecedentes." };
})()
