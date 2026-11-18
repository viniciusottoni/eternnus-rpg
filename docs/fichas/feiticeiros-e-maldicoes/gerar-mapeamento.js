(() => {
// Ficha Feiticeiros e Maldições v2.0 (modelo de Setsugiri), 6 páginas A4 paisagem 842 x 595. Mesmo formato do editor (compactDoc).
const PW = 842, PH = 595, F = [];
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
// Texto centrado verticalmente numa célula (centro cy).
const boxed = (cy, fs) => { const h = 1.2 * fs + 1; return [cy - h / 2, h]; };
// Campo de uma linha dentro da célula (x, y, w, h).
const cell = (name, label, type, page, x, y, w, h, fs, kw = {}) => { const [yy, hh] = boxed(y + h / 2, fs); add(name, label, type, page, x, yy, w, hh, fs, kw); };
// Área de texto cujas linhas caem sobre as linhas impressas (primeira linha começando em r0, passo step, n linhas de altura rh).
const ruled = (name, label, page, x, r0, w, step, n, rh, maxLength) => {
  const fs = Math.round((step / 1.2) * 100) / 100;
  const [yy] = boxed(r0 + rh / 2, fs);
  add(name, label, "textarea", page, x, yy, w, step * (n - 1) + 1.2 * fs + 1, fs, { maxLength });
};
const NUM = (d, min = 0, max = 9999) => ({ default: d, min, max });
// ---------- Página 1 ----------
cell("nome", "Nome", "text", 0, 106, 71.25, 114, 25.75, 14, { role: "name", maxLength: 60 });
const HEAD = [[["nivel", "Nível", "number", { role: "level", ...NUM("1", 1, 20) }], ["maestria", "Bônus de maestria", "computed", { formula: "2 + floor((max(1, @nivel) - 1) / 4)" }], ["experiencia", "Experiência", "number", NUM("0", 0, 999999)]],
  [["origem", "Origem", "text", { maxLength: 40 }], ["especializacao", "Especialização", "text", { maxLength: 40 }], ["tecnica", "Técnica", "text", { maxLength: 40 }]],
  [["jogador", "Jogador(a)", "text", { maxLength: 40 }], ["campanha", "Campanha", "text", { maxLength: 40 }], ["grau", "Grau", "text", { maxLength: 30 }]]];
const HX = [276, 405, 544.75], HY = [71.25, 80, 88.75];
HEAD.forEach((col, c) => col.forEach(([k, l, t, kw], r) => cell(k, l, t, 0, HX[c] + 1, HY[r], 84, 8.25, 6.5, kw)));
// Atributos
const ATR = [["forca", "Força", 115, 149.5], ["destreza", "Destreza", 115, 166.75], ["constituicao", "Constituição", 115, 184.25],
  ["inteligencia", "Inteligência", 254.5, 149.5], ["sabedoria", "Sabedoria", 254.5, 166.75], ["carisma", "Carisma", 254.5, 184.25]];
for (const [k, l, x, y] of ATR) {
  cell(k, l, "number", 0, x + 13, y, 28, 17, 12, NUM("10", 1, 40));
  cell(`${k}_mod`, `${l} — modificador`, "computed", 0, x + 56, y, 28, 17, 12, { formula: `floor((@${k} - 10) / 2)` });
}
// Pontos de vida, integridade, energia e derivados (caixas 32 x 34)
const BIG = (k, l, t, x, y, kw) => cell(k, l, t, 0, x + 3.5, y, 28, 34.25, 13, kw);
BIG("pv_atual", "PV atuais", "number", 351.25, 106, { role: "hp", ...NUM("10") });
BIG("pv_max", "PV máximos", "number", 383.5, 106, { role: "maxHp", ...NUM("10") });
BIG("pv_temp", "PV temporários", "number", 415.75, 106, NUM(null));
BIG("integridade_atual", "Integridade atual", "number", 458.75, 106, NUM(null));
BIG("integridade_max", "Integridade máxima", "number", 491, 106, NUM(null));
BIG("integridade_temp", "Integridade temporária", "number", 523.25, 106, NUM(null));
BIG("pe_atual", "PE atuais", "number", 351.25, 175.5, NUM(null));
BIG("pe_max", "PE máximos", "number", 383.5, 175.5, NUM(null));
BIG("pe_temp", "PE temporários", "number", 415.75, 175.5, NUM(null));
BIG("atencao", "Atenção (10 + Percepção)", "computed", 458.75, 175.5, { role: "perception", formula: "10 + @percepcao" });
BIG("iniciativa", "Iniciativa (mod. Destreza)", "computed", 491, 175.5, { formula: "@destreza_mod" });
BIG("movimento", "Movimento (m)", "number", 523.25, 175.5, { role: "movement", ...NUM("9", 0, 999) });
// Classe de armadura
const CAY = [132.25, 140.75, 149.5, 158.25];
cell("ca_uniforme", "CA — uniforme", "number", 0, 641.5, CAY[0], 10.5, 8.25, 6.5, NUM(null, -99, 99));
cell("ca_escudo", "CA — escudo", "number", 0, 641.5, CAY[1], 10.5, 8.25, 6.5, NUM(null, -99, 99));
cell("ca_destreza", "CA — Destreza", "computed", 0, 641.5, CAY[2], 10.5, 8.25, 6.5, { formula: "@destreza_mod" });
cell("ca_outros", "CA — outros", "number", 0, 641.5, CAY[3], 10.5, 8.25, 6.5, NUM(null, -99, 99));
cell("ca_total", "Classe de Armadura", "computed", 0, 569.75, 123.5, 28, 34.25, 14, { role: "armor", formula: "10 + @ca_uniforme + @ca_escudo + @destreza_mod + @ca_outros" });
// Testes de morte
[["sucesso", "Sucesso", 193], ["fracasso", "Fracasso", 210.25]].forEach(([k, l, y]) =>
  [620, 630.75, 641.5].forEach((x, i) => cell(`morte_${k}_${i + 1}`, `Teste de morte — ${l.toLowerCase()} ${i + 1}`, "checkbox", 0, x + 1.25, y, 9, 17, 7)));
// Perícias: outros, maestria (Mt), especialista (Es) e total
const SK = [
  [["atletismo", "Atletismo", "forca"], ["luta", "Luta", "forca", 1], ["acrobacia", "Acrobacia", "destreza"], ["furtividade", "Furtividade", "destreza"], ["pontaria", "Pontaria", "destreza", 1],
   ["prestidigitacao", "Prestidigitação", "destreza"], ["reflexos", "Reflexos", "destreza"], ["fortitude", "Fortitude", "constituicao"], ["integridade", "Integridade", "constituicao"],
   ["intuicao", "Intuição", "sabedoria"], ["medicina", "Medicina", "sabedoria"], ["percepcao", "Percepção", "sabedoria"], ["ocultismo", "Ocultismo", "sabedoria"], ["vontade", "Vontade", "sabedoria"]],
  [["astucia", "Astúcia", "inteligencia"], ["feiticaria", "Feitiçaria", "inteligencia"], ["investigacao", "Investigação", "inteligencia"], ["historia", "História", "inteligencia"],
   ["oficio_1", "Ofício 1", "inteligencia"], ["oficio_2", "Ofício 2", "inteligencia"], ["oficio_3", "Ofício 3", "inteligencia"], ["oficio_4", "Ofício 4", "inteligencia"],
   ["religiao", "Religião", "inteligencia"], ["tecnologia", "Tecnologia", "inteligencia"], ["persuasao", "Persuasão", "carisma"], ["enganacao", "Enganação", "carisma"],
   ["intimidacao", "Intimidação", "carisma"], ["performance", "Performance", "carisma"]],
];
const SKX = [[125.75, 147.25, 158, 168.75, 21], [276, 297.5, 308.25, 319, 21.25]];
SK.forEach((col, c) => col.forEach(([k, l, a, noEs], r) => {
  const y = 236.25 + 8.6923 * r, [xo, xm, xe, xt, wn] = SKX[c];
  if (k.startsWith("oficio")) cell(`${k}_nome`, `${l} — qual`, "text", 0, 230, y, 22, 8.25, 6, { maxLength: 12 });
  cell(`${k}_outros`, `${l} — outros`, "number", 0, xo + 1, y, wn - 2, 8.25, 6.5, NUM(null, -99, 99));
  cell(`${k}_mt`, `${l} — maestria`, "checkbox", 0, xm + 1.5, y, 8.5, 8.25, 6);
  if (!noEs) cell(`${k}_es`, `${l} — especialista`, "checkbox", 0, xe + 1.5, y, 8.5, 8.25, 6);
  const bonus = noEs ? `@${k}_mt * @maestria` : `@maestria * max(@${k}_mt, 2 * @${k}_es)`;
  cell(k, l, "computed", 0, xt + 3, y, wn - 4, 8.25, 6.5, { formula: `@${a}_mod + @${k}_outros + ${bonus}` });
}));
// Dados de vida (d12, d10, d8)
ruled("dados_vida_gastos", "Dados de vida — gastos (d12, d10, d8)", 0, 588.75, 262.25, 30, 8.75, 3, 8.25, 60);
ruled("dados_vida_disponiveis", "Dados de vida — disponíveis (d12, d10, d8)", 0, 621, 262.25, 30, 8.75, 3, 8.25, 60);
// Registro rápido (4 linhas)
[["arma", "arma", 351.25, 42.75], ["bonus", "bônus", 394.25, 21.25], ["dano", "dano", 415.75, 42.75], ["critico", "crítico", 458.75, 32], ["tipo", "tipo", 491, 32], ["alcance", "alcance", 523.25, 32]]
  .forEach(([k, l, x, w]) => ruled(`registro_${k}`, `Registro rápido — ${l}`, 0, x + 1, 271, w - 1.5, 8.6667, 4, 8.25, 400));
add("caracteristicas", "Características", "textarea", 0, 352.5, 324, 201.5, 32.5, 7, { maxLength: 3000 });
add("maestrias", "Maestrias", "textarea", 0, 567.5, 315.5, 83.5, 50.5, 7, { maxLength: 3000 });
// Habilidades de especialização (25 linhas) e talentos (10 linhas)
[["nome", "nome", 663, 53.25, 1200], ["atual", "atual", 716.75, 21, 200], ["max", "máx.", 738.25, 21, 200], ["custo", "custo", 759.75, 21, 200]].forEach(([k, l, x, w, ml]) => {
  // Nome com "habilidades": lista reconhecida pelo site (ADR-098); as colunas atual/máx./custo seguem o mesmo começo de nome.
  ruled(k === "nome" ? "habilidades_especializacao" : `habilidades_especializacao_${k}`, `Habilidades de especialização — ${l}`, 0, x + 1, 88.75, w - 1.5, 8.6771, 25, 8.25, ml);
  ruled(`talento_${k}`, `Talentos — ${l}`, 0, x + 1, 340.5, w - 1.5, 8.6667, 10, 8.25, ml);
});
// ---------- Página 2 ----------
cell("nome_pagina_2", "Nome (página 2)", "text", 1, 96, 62.75, 168, 17, 11, { maxLength: 60 });
ruled("tracos_fisicos", "Detalhes físicos: idade, altura, peso… marcas (um por linha)", 1, 191, 80, 73.5, 8.675, 11, 8.25, 600);
add("aparencia", "Aparência", "textarea", 1, 62, 89.75, 94, 84, 7, { maxLength: 2000 });
[["tracos_personalidade", "Traços de personalidade", 184.25], ["ideais", "Ideais", 219], ["ligacoes", "Ligações", 253.75], ["defeitos", "Defeitos", 288.5]]
  .forEach(([k, l, y]) => add(k, l, "textarea", 1, 62, y + 1, 202, 24, 7, { maxLength: 2000 }));
[["nome", "nome do item", 0, 107], ["quant", "quantidade", 107.75, 21], ["espacos", "espaços", 129.25, 21], ["custo", "custo", 150.5, 21]].forEach(([k, l, dx, w]) => {
  ruled(`inventario_${k}_1`, `Inventário (coluna 1) — ${l}`, 1, 276 + dx + 1, 88.75, w - 1.5, 8.6848, 24, 8.25, 1500);
  ruled(`inventario_${k}_2`, `Inventário (coluna 2) — ${l}`, 1, 459.25 + dx + 1, 88.75, w - 1.5, 8.6848, 24, 8.25, 1500);
});
cell("espacos_ocupados", "Espaços ocupados", "number", 1, 385, 305.75, 62, 8.25, 6.5, NUM(null));
cell("limite_espacos", "Limite de espaços", "number", 1, 567, 305.75, 62, 8.25, 6.5, NUM(null));
add("historia_personagem", "História do personagem", "textarea", 1, 643.5, 81.5, 136, 231, 7, { maxLength: 8000 });
// ---------- Página 3: perfil amaldiçoado ----------
cell("hab_conhecidas", "Habilidades de técnica conhecidas", "number", 2, 102, 78.5, 18.5, 16, 9, NUM(null, 0, 99));
cell("hab_maximas", "Habilidades de técnica máximas", "number", 2, 102, 95, 18.5, 16, 9, NUM(null, 0, 99));
cell("atributo_principal", "Atributo principal", "text", 2, 61.5, 127.75, 57, 16, 9, { maxLength: 20 });
cell("pe_atual_perfil", "PE atuais (da página 1)", "computed", 2, 135, 78.5, 26, 32, 12, { formula: "@pe_atual" });
cell("pe_max_perfil", "PE máximos (da página 1)", "computed", 2, 165, 78.5, 26, 32, 12, { formula: "@pe_max" });
cell("pe_temp_perfil", "PE temporários (da página 1)", "computed", 2, 195, 78.5, 26, 32, 12, { formula: "@pe_temp" });
cell("nome_tecnica", "Nome da técnica", "text", 2, 61.5, 168.75, 159, 16, 9, { maxLength: 60 });
add("descricao_tecnica", "Descrição da técnica", "textarea", 2, 61.5, 194, 159, 80, 7, { maxLength: 4000 });
[["nome", "nome", 233, 50.5, 1200], ["atual", "atual", 284, 19.75, 200], ["max", "máx.", 304, 20, 200]]
  .forEach(([k, l, x, w, ml]) => ruled(`aptidao_${k}`, `Aptidões amaldiçoadas — ${l}`, 2, x + 1, 103.25, w - 1.5, 8.2083, 25, 7.75, ml));
[["1", 345, 86.75], ["1b", 436.5, 86.75], ["2", 528, 86.75], ["3", 345, 177], ["4", 436.5, 177], ["5", 528, 177]].forEach(([n, x, y], i) =>
  ruled(`hab_tecnica_${i + 1}`, `Habilidades de técnica — bloco ${i + 1} (${["nível 1", "nível 1", "nível 2", "nível 3", "nível 4", "nível 5"][i]})`, 2, x + 1, y, 79.5, 8.2222, 10, 7.75, 1500));
cell("expansao_nome", "Nome da expansão", "text", 2, 620.5, 86.75, 159.5, 16, 9, { maxLength: 60 });
cell("expansao_tipo", "Tipo de expansão", "text", 2, 620.5, 111, 159.5, 8.25, 6.5, { maxLength: 60 });
add("expansao_descricao", "Descrição da expansão", "textarea", 2, 620.5, 128.5, 159.5, 80, 7, { maxLength: 4000 });
cell("tecnica_atributo", "Aspectos — atributo principal", "text", 2, 620.5, 242.75, 58, 7.75, 6.5, { maxLength: 20 });
add("tecnica_pericia", "Aspectos — perícia da técnica", "textarea", 2, 620.5, 258.6, 58, 16.6, 6.5, { maxLength: 60 });
cell("cd_tecnica", "CD de técnica", "number", 2, 693, 242.75, 34, 32.5, 13, NUM(null, 0, 99));
cell("bonus_acerto", "Bônus de acerto da técnica", "number", 2, 744, 242.75, 34, 32.5, 13, NUM(null, -99, 99));
[["energia", "Energia"], ["controle", "Controle e Leitura"], ["barreira", "Barreira"], ["dominio", "Domínio"], ["energia_reversa", "Energia Reversa"]]
  .forEach(([k, l], i) => cell(`aptidao_nivel_${k}`, `Nível de aptidão em ${l}`, "number", 2, [355.5, 406.25, 457, 507.75, 558.5][i] + 12, 283.75, 25, 24, 12, NUM(null, 0, 99)));
// ---------- Página 4: shikigamis (invocações 1 a 5) ----------
[70, 216.25, 362.75, 509, 655.25].forEach((x0, i) => {
  const n = i + 1, L = `Invocação ${n}`;
  cell(`inv${n}_grau`, `${L} — grau`, "text", 3, x0 + 1, 109.25, 115, 8.25, 6.5, { maxLength: 40 });
  [["pv_atual", "PV atuais", 0], ["pv_max", "PV máximos", 29.25], ["ca", "Classe de Armadura", 58.5], ["movimento", "Movimento", 87.75]]
    .forEach(([k, l, dx]) => cell(`inv${n}_${k}`, `${L} — ${l}`, "number", 3, x0 + dx + 3, 125, 25, 31, 12, NUM(null, 0, 9999)));
  ruled(`inv${n}_atributos`, `${L} — atributos (FOR, DES, CON, INT, SAB, CAR)`, 3, x0 + 40, 189, 36, 7.9, 6, 7.5, 60);
  ruled(`inv${n}_modificadores`, `${L} — modificadores`, 3, x0 + 79, 189, 37, 7.9, 6, 7.5, 60);
  // "_itens": lista de ações da invocação (um item por linha, com descrição por item; ADR-098).
  ruled(`inv${n}_acoes_itens`, `${L} — ações e características`, 3, x0 + 1, 245.5, 114.5, 7.875, 5, 7.5, 1000);
  ruled(`inv${n}_pericias`, `${L} — perícias (nome)`, 3, x0 + 1, 301.75, 36.5, 7.886, 12, 7.5, 600);
  ruled(`inv${n}_pericias_atributo`, `${L} — perícias (atributo)`, 3, x0 + 40, 301.75, 27.5, 7.886, 12, 7.5, 200);
  ruled(`inv${n}_pericias_bonus`, `${L} — perícias (bônus)`, 3, x0 + 89, 301.75, 27.5, 7.886, 12, 7.5, 200);
});
// ---------- Página 6: treinamentos (etapas concluídas) ----------
const ETAPAS = ["✓", "✓\n✓", "✓\n✓\n✓", "✓\n✓\n✓\n✓"];
const TR = [["agilidade", "Treino de Agilidade"], ["barreiras", "Treino de Barreiras"], ["compreensao", "Treino de Compreensão"], ["controle_energia", "Controle de Energia"],
  ["dominios", "Treino de Domínios"], ["energia_reversa", "Energia Reversa"], ["luta", "Treino de Luta"], ["manejo_arma", "Manejo de Arma"], ["pericia", "Treino de Perícia"],
  ["potencial_fisico", "Potencial Físico"], ["resistencia", "Treino de Resistência"]];
const TX = [154.5, 271.75, 389, 506.25, 623.5, 740.75];
TR.forEach(([k, l], i) => {
  const x = TX[i < 6 ? i : i - 6], y = i < 6 ? 97.5 : 225.25;
  add(`treino_${k}`, `${l} — etapas concluídas`, "select", 5, x + 8.25, y - 0.4, 10.5, 42, 8.75, { options: ETAPAS });
});
// ---------- Ações: testes de perícia (d20 + total) e iniciativa ----------
const actions = SK.flat().map(([k, l]) => ({ key: `teste_${k}`, name: l, kind: "habilidade", formula: `1d20 + @${k}`, description: `Teste de ${l}: 1d20 + total da perícia.` }));
actions.push({ key: "iniciativa", name: "Iniciativa", kind: "habilidade", formula: "1d20 + @iniciativa", description: "1d20 + modificador de Destreza." });
return { pages: Array.from({ length: 6 }, () => ({ width: PW, height: PH })), fields: F, actions,
  notes: "Mapeamento da ficha de Feiticeiros e Maldições v2.0 (modelo de Setsugiri, 6 páginas): modificadores, bônus de maestria pelo nível, perícias com maestria/especialista e total automático, atenção, iniciativa e CA calculadas, perfil amaldiçoado, inventário, shikigamis 1 a 5 e treinamentos." };
})()
