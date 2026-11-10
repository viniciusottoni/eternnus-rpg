(() => {
// Ficha Ordem Paranormal RPG (PDF comum, 3 páginas A4, 595,28 x 841,89 pt). Mesmo formato do editor (compactDoc).
const PW = 595.28, PH = 841.89, F = [];
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
// Área de texto cujas linhas (1,2 x fonte) caem sobre as linhas impressas: primeira linha em L0, passo `pitch`, n linhas.
const ruled = (L0, pitch, n) => { const fs = Math.round(pitch / 1.2 * 10) / 10; const y = L0 - 4 - 0.905 * fs; return [y, L0 + pitch * (n - 1) + 3 - y, fs]; };
let y, h, fs;
// ---------- Página 1 ----------
add("personagem", "Personagem", "text", 0, 72, 40, 158, 16, 13, { role: "name", maxLength: 100 });
add("jogador", "Jogador", "text", 0, 244, 40, 78, 16, 13, { maxLength: 80 });
const ATTRS = [["agilidade", "Agilidade", 199, 108], ["forca", "Força", 112.5, 166], ["intelecto", "Intelecto", 284, 166], ["presenca", "Presença", 140, 266], ["vigor", "Vigor", 264, 266]];
for (const [k, l, cx, top] of ATTRS) add(k, l, "number", 0, cx - 10, top, 26, 27, 22, { default: "1", min: 0, max: 6, align: "center" });
[y, h] = boxed(361, 11); add("origem", "Origem", "text", 0, 136, y, 183, h, 11, { maxLength: 60 });
[y, h] = boxed(399, 11); add("classe", "Classe", "text", 0, 129, y, 190, h, 11, { maxLength: 60 });
[y, h] = boxed(421, 11); add("trilha", "Trilha", "text", 0, 129, y, 190, h, 11, { maxLength: 60 });
[y, h] = boxed(461, 16);
add("nex", "NEX (%)", "number", 0, 108, y, 30, h, 16, { default: "5", min: 0, max: 99, align: "center" });
add("pe_rodada", "PE por rodada (limite)", "computed", 0, 157, y, 26, h, 16, { formula: "if @nex >= 99 then 20 else max(1, floor(@nex / 5))", align: "center" });
add("deslocamento", "Deslocamento (m)", "number", 0, 268, y, 40, h, 16, { role: "movement", default: "9", min: 0, max: 300, align: "center" });
[y, h] = boxed(507, 16);
add("pv_max", "PV máximos", "number", 0, 85, y, 36, h, 16, { role: "maxHp", default: "10", min: 1, max: 9999, align: "center" });
add("pe_max", "PE máximos", "number", 0, 212, y, 36, h, 16, { min: 0, max: 9999, align: "center" });
[y, h] = boxed(532, 14);
add("pv_atual", "PV atuais", "number", 0, 100, y, 76, h, 14, { role: "hp", default: "10", min: 0, max: 9999 });
add("pe_atual", "PE atuais", "number", 0, 227, y, 76, h, 14, { min: 0, max: 9999 });
[y, h] = boxed(579, 16); add("san_max", "Sanidade máxima", "number", 0, 244, y, 36, h, 16, { min: 0, max: 9999, align: "center" });
[y, h] = boxed(605, 12); add("san_atual", "Sanidade atual", "number", 0, 258, y, 56, h, 12, { min: 0, max: 9999 });
add("defesa", "Defesa", "computed", 0, 85, 569, 32, 25, 20, { role: "armor", formula: "10 + @agilidade + @defesa_equipamento + @defesa_outros", align: "center" });
[y, h] = onLine(602.5, 10);
add("defesa_equipamento", "Defesa — equipamento", "number", 0, 173, y, 18, h, 10, { min: -99, max: 99, align: "center" });
add("defesa_outros", "Defesa — outros", "number", 0, 198, y, 18, h, 10, { min: -99, max: 99, align: "center" });
[y, h] = onLine(635.5, 10); add("protecao", "Proteção", "text", 0, 118, y, 203, h, 10, { maxLength: 100 });
[y, h] = onLine(652.5, 10); add("resistencias", "Resistências", "text", 0, 131, y, 190, h, 10, { maxLength: 100 });
// Perícias: BÔNUS = treino + outros; o atributo (DADOS) define quantos d20 rolar
const SK = [["acrobacia", "Acrobacia", "agilidade", 172.55], ["adestramento", "Adestramento", "presenca", 189.0], ["artes", "Artes", "presenca", 205.45],
  ["atletismo", "Atletismo", "forca", 221.9], ["atualidades", "Atualidades", "intelecto", 238.35], ["ciencias", "Ciências", "intelecto", 254.8],
  ["crime", "Crime", "agilidade", 271.25], ["diplomacia", "Diplomacia", "presenca", 287.7], ["enganacao", "Enganação", "presenca", 304.1],
  ["fortitude", "Fortitude", "vigor", 320.6], ["furtividade", "Furtividade", "agilidade", 337.0], ["iniciativa", "Iniciativa", "agilidade", 353.5],
  ["intimidacao", "Intimidação", "presenca", 369.9], ["intuicao", "Intuição", "presenca", 386.4], ["investigacao", "Investigação", "intelecto", 402.8],
  ["luta", "Luta", "forca", 419.3], ["medicina", "Medicina", "intelecto", 435.7], ["ocultismo", "Ocultismo", "intelecto", 452.2],
  ["percepcao", "Percepção", "presenca", 468.6], ["pilotagem", "Pilotagem", "agilidade", 485.1], ["pontaria", "Pontaria", "agilidade", 501.5],
  ["profissao_1", "Profissão (1)", "intelecto", 517.95], ["profissao_2", "Profissão (2)", "intelecto", 534.4], ["reflexos", "Reflexos", "agilidade", 550.85],
  ["religiao", "Religião", "presenca", 567.3], ["sobrevivencia", "Sobrevivência", "intelecto", 583.75], ["tatica", "Tática", "intelecto", 600.2],
  ["tecnologia", "Tecnologia", "intelecto", 616.65], ["vontade", "Vontade", "presenca", 633.1]];
for (const [k, l, a, c] of SK) {
  [y, h] = boxed(c, 10);
  add(k, l, "computed", 0, 477.5, y, 18, h, 10, { formula: `@${k}_treino + @${k}_outros`, role: k === "percepcao" ? "perception" : null, align: "center" });
  [y, h] = onLine(c + 7.5, 9);
  add(`${k}_treino`, `${l} — treino (5 treinado, 10 veterano, 15 expert)`, "number", 0, 501, y, 20, h, 9, { min: 0, max: 15, align: "center" });
  add(`${k}_outros`, `${l} — outros`, "number", 0, 528, y, 20, h, 9, { min: -99, max: 99, align: "center" });
  if (k.startsWith("profissao_")) add(`${k}_nome`, `${l} — qual`, "text", 0, 397, c - 5.5, 37, 10, 7, { maxLength: 30 });
}
// Ataques: 7 linhas
[701, 717, 733, 749, 765, 781, 797].forEach((L, i) => {
  [y, h] = onLine(L, 9);
  add(`ataque_${i + 1}_nome`, `Ataque ${i + 1} — nome`, "text", 0, 70, y, 162, h, 9, { maxLength: 60 });
  add(`ataque_${i + 1}_teste`, `Ataque ${i + 1} — teste`, "text", 0, 242, y, 57, h, 9, { maxLength: 20 });
  add(`ataque_${i + 1}_dano`, `Ataque ${i + 1} — dano`, "text", 0, 309, y, 60, h, 9, { maxLength: 30 });
  add(`ataque_${i + 1}_especial`, `Ataque ${i + 1} — crítico/alcance/especial`, "text", 0, 379, y, 169, h, 9, { maxLength: 80 });
});
// ---------- Página 2 ----------
add("habilidades", "Habilidades", "textarea", 1, 46, 92, 236, 286, 9, { maxLength: 10000 });
[["arma_simples", "Proficiência — armas simples", 173.5, 68], ["arma_taticas", "Proficiência — armas táticas", 211.5, 68], ["arma_pesadas", "Proficiência — armas pesadas", 246.5, 68],
  ["protecao_leves", "Proficiência — proteções leves", 173.5, 81], ["protecao_pesadas", "Proficiência — proteções pesadas", 211.5, 81]]
  .forEach(([k, l, x, yy]) => add(`prof_${k}`, l, "checkbox", 1, x, yy, 6.5, 6.5, 7));
[y, h] = boxed(45, 14);
add("rituais_dt", "DT dos rituais", "computed", 1, 415, y, 26, h, 14, { formula: "10 + @pe_rodada + @presenca", align: "center" });
[y, h, fs] = ruled(73.6, 15.59, 20);
add("rituais_lista", "Rituais (um por linha)", "textarea", 1, 296, y, 146, h, fs, { maxLength: 2000 });
add("rituais_custo", "Rituais — custo (um por linha)", "textarea", 1, 459, y, 31, h, fs, { maxLength: 400 });
add("rituais_pagina", "Rituais — página (um por linha)", "textarea", 1, 496, y, 30, h, fs, { maxLength: 400 });
[y, h] = boxed(395, 12); add("pontos_prestigio", "Pontos de prestígio", "number", 1, 263, y, 30, h, 12, { default: "0", min: 0, max: 99999, align: "center" });
[y, h] = boxed(395, 11); add("patente", "Patente", "text", 1, 340, y, 175, h, 11, { maxLength: 60 });
[y, h] = boxed(425, 11);
[[1, "I", 117], [2, "II", 156], [3, "III", 195], [4, "IV", 234]].forEach(([n, r, x1]) =>
  add(`limite_itens_${n}`, `Limite de itens — categoria ${r}`, "number", 1, x1 - 14, y, 13, h, 11, { min: 0, max: 99 }));
add("limite_credito", "Limite de crédito", "text", 1, 291, y, 132, h, 11, { maxLength: 40 });
add("carga_atual", "Carga atual (espaços)", "number", 1, 466, y, 24, h, 11, { min: 0, max: 999, align: "center" });
add("carga_maxima", "Carga máxima (espaços)", "computed", 1, 499, y, 24, h, 11, { formula: "if @forca >= 1 then 5 * @forca else 2", align: "center" });
[y, h, fs] = ruled(472.4, 15.58, 11);
add("inventario_itens_1", "Inventário — itens (coluna esquerda, um por linha)", "textarea", 1, 48, y, 158, h, fs, { maxLength: 2000 });
add("inventario_categoria_1", "Inventário — categoria (coluna esquerda)", "textarea", 1, 214, y, 29, h, fs, { maxLength: 200 });
add("inventario_espacos_1", "Inventário — espaços (coluna esquerda)", "textarea", 1, 251, y, 28, h, fs, { maxLength: 200 });
add("inventario_itens_2", "Inventário — itens (coluna direita, um por linha)", "textarea", 1, 293, y, 161, h, fs, { maxLength: 2000 });
add("inventario_categoria_2", "Inventário — categoria (coluna direita)", "textarea", 1, 460, y, 29, h, fs, { maxLength: 200 });
add("inventario_espacos_2", "Inventário — espaços (coluna direita)", "textarea", 1, 496, y, 29, h, fs, { maxLength: 200 });
[["aparencia", "Aparência", 46], ["personalidade", "Personalidade", 167], ["historico", "Histórico", 289], ["objetivo", "Objetivo", 411]]
  .forEach(([k, l, x]) => add(k, l, "textarea", 1, x, 680, 115, 128, 8, { maxLength: 3000 }));
// ---------- Página 3 (fichas de rituais) ----------
add("personagem_pag3", "Personagem (ficha de rituais)", "text", 2, 301, 44, 111, 16, 12, { maxLength: 100 });
[y, h] = boxed(52, 14);
add("rituais_dt_pag3", "DT dos rituais (ficha de rituais)", "computed", 2, 449, y, 26, h, 14, { formula: "10 + @pe_rodada + @presenca", align: "center" });
const ELEMENTS = [["conhecimento", "Conhecimento", 46.5], ["energia", "Energia", 119.5], ["morte", "Morte", 169.5], ["sangue", "Sangue", 208.5], ["medo", "Medo", 252.5]];
const CIRCLES = [93.5, 119, 144.5, 170];
for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
  const n = row * 2 + col + 1, dx = col * 265.5, dy = row * 240.8, p = `ritual_${n}`, L = `Ritual ${n}`;
  add(`${p}_nome`, `${L} — nome`, "text", 2, 51 + dx, 103.5 + dy, 230, 14, 11, { maxLength: 60 });
  for (const [k, l, x] of ELEMENTS) add(`${p}_${k}`, `${L} — elemento ${l}`, "checkbox", 2, x + dx, 128 + dy, 7, 7, 7);
  CIRCLES.forEach((x, i) => add(`${p}_circulo_${i + 1}`, `${L} — ${i + 1}º círculo`, "checkbox", 2, x + dx, 144 + dy, 7, 7, 7));
  [y, h] = onLine(169 + dy, 9);
  add(`${p}_execucao`, `${L} — execução`, "text", 2, 89 + dx, y, 86, h, 9, { maxLength: 30 });
  add(`${p}_alcance`, `${L} — alcance`, "text", 2, 214 + dx, y, 70, h, 9, { maxLength: 30 });
  [y, h] = onLine(183.5 + dy, 9); add(`${p}_alvo`, `${L} — alvo`, "text", 2, 77 + dx, y, 205, h, 9, { maxLength: 80 });
  [y, h] = onLine(199.5 + dy, 9); add(`${p}_duracao`, `${L} — duração`, "text", 2, 88 + dx, y, 194, h, 9, { maxLength: 60 });
  [y, h] = onLine(215.5 + dy, 9); add(`${p}_resistencia`, `${L} — resistência`, "text", 2, 99 + dx, y, 183, h, 9, { maxLength: 60 });
  add(`${p}_descricao`, `${L} — descrição`, "textarea", 2, 47 + dx, 221 + dy, 237, 87, 8, { maxLength: 2000 });
}
// ---------- Ações: testes de perícia (atributo = quantidade de d20, fica o maior; atributo 0 = 2d20, fica o menor) ----------
const dice = (a) => `(if @${a} >= 6 then 6d20kh1 else if @${a} >= 5 then 5d20kh1 else if @${a} >= 4 then 4d20kh1 else if @${a} >= 3 then 3d20kh1 else if @${a} >= 2 then 2d20kh1 else if @${a} >= 1 then 1d20 else 2d20kl1)`;
const actions = SK.map(([k, l, a]) => ({ key: `teste_${k}`, name: l.replace(" (", " ").replace(")", ""), kind: "habilidade", formula: `${dice(a)} + @${k}`,
  description: `Teste de ${l}: rola d20 iguais ao atributo, fica o maior, + bônus.` }));
return { pages: [{ width: PW, height: PH }, { width: PW, height: PH }, { width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da ficha de Ordem Paranormal RPG (PDF comum, 3 páginas): atributos, NEX e limite de PE, PV/PE/Sanidade, defesa automática, 29 perícias (treino + outros) com testes que rolam d20 pelo atributo, ataques, habilidades, rituais com DT automática, inventário com carga e 6 fichas de ritual." };
})()
