(() => {
// Ficha Pathfinder 2e (PDF comum, 4 páginas de 603 x 783 pt). Mesmo formato do editor (compactDoc).
const PW = 603, PH = 783, F = [];
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
// Campo de uma linha com o texto centrado verticalmente em cy.
const line = (name, label, type, page, x, cy, w, fs, kw = {}) => { const [y, h] = boxed(cy, fs); add(name, label, type, page, x, y, w, h, fs, kw); };
// Número centrado numa caixa (x, y, w, h): o texto começa à esquerda de um espaço para `digits` dígitos.
const num = (name, label, type, page, x, y, w, h, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  line(name, label, type, page, left, y + h / 2, Math.min(w - 1, x + w - left - 0.5), fs, kw);
};
// Área de texto pautada: linha i centrada em r0 + rh/2 + i*step.
const ruled = (name, label, page, x, r0, w, step, n, rh, maxLength) => {
  const fs = Math.round((step / 1.2) * 100) / 100;
  const [y] = boxed(r0 + rh / 2, fs);
  add(name, label, "textarea", page, x, y, w, step * (n - 1) + 1.2 * fs + 1, fs, { maxLength });
};
// Proficiência T/E/M/L: lista cujas opções (■ em Arial, avanço 0,604 em) cobrem as caixas impressas a partir da primeira.
const RANKS = ["■", "■■", "■■■", "■■■■"];
const teml = (name, label, page, x1, x4, cw, cy) => {
  const pitch = (x4 - x1) / 3, fs = Math.round((pitch / 0.604) * 100) / 100, c1 = x1 + cw / 2;
  const hh = 1 + 0.545 * fs;
  add(name, `${label} — proficiência (T/E/M/L)`, "select", page, c1 - 1 - 0.302 * fs, cy - hh, 4 * pitch + 1, 2 * hh, fs, { options: RANKS });
};
const N = (d = null, min = -99, max = 999) => ({ default: d, min, max });
const ATTRS = { FOR: "forca", DES: "destreza", CON: "constituicao", INT: "inteligencia", SAB: "sabedoria", CAR: "carisma" };
// ---------- Página 1 ----------
line("nome", "Nome do personagem", "text", 0, 140, 48, 195, 14, { role: "name", maxLength: 60 });
line("jogador", "Nome do jogador", "text", 0, 170, 75, 165, 11, { maxLength: 60 });
line("experiencia", "Pontos de experiência (XP)", "number", 0, 198, 92.5, 138, 10, N("0", 0, 999999));
[["ancestralidade", "Ancestralidade e herança", 18.5], ["biografia", "Biografia (background)", 37.5], ["classe", "Classe", 56.5]]
  .forEach(([k, l, y]) => line(k, l, "text", 0, 345, y + 11.5, 182, 8.5, { maxLength: 80 }));
line("tamanho", "Tamanho", "text", 0, 343, 83.3, 28, 6, { maxLength: 12 });
line("tendencia", "Tendência", "text", 0, 375, 83.3, 45, 6, { maxLength: 20 });
line("tracos", "Traços", "text", 0, 425, 83.3, 104, 6, { maxLength: 60 });
line("divindade", "Divindade", "text", 0, 381, 94.4, 146, 8, { maxLength: 40 });
num("nivel", "Nível", "number", 0, 534, 31.75, 51, 27, 18, { role: "level", ...N("1", 1, 20) });
num("pontos_heroismo", "Pontos de heroísmo", "number", 0, 540, 75.25, 38, 23, 16, N("1", 0, 3), 1);
// Atributos (modificador calculado do valor)
["forca", "destreza", "constituicao", "inteligencia", "sabedoria", "carisma"].forEach((k, i) => {
  const l = ["Força", "Destreza", "Constituição", "Inteligência", "Sabedoria", "Carisma"][i];
  num(k, l, "number", 0, 166, 122.25 + 27.8 * i, 28, 18, 12, N("10", 1, 30));
  num(`${k}_mod`, `${l} — modificador`, "computed", 0, 20, 122.25 + 27.5 * i, 34, 21, 14, { formula: `floor((@${k} - 10) / 2)` });
});
// Classe de armadura
num("ca", "Classe de Armadura", "computed", 0, 232, 133, 39, 28, 16, { role: "armor", formula: "10 + @ca_des + @ca_prof + @ca_item" });
num("ca_des", "CA — Destreza aplicada (até o limite da armadura)", "number", 0, 304, 128, 21, 17, 9, N(null, -9, 99));
line("ca_limite", "CA — limite de Destreza da armadura", "text", 0, 335, 136.5, 18, 9, { maxLength: 4 });
num("ca_prof", "CA — proficiência", "number", 0, 356, 128.25, 23, 17, 10, N(null, 0, 99));
num("ca_item", "CA — item (armadura)", "number", 0, 416, 127.25, 23, 17, 10, N(null, -9, 99));
teml("ca_rank", "CA", 0, 381.75, 405.75, 6.5, 136.9);
[["sem_armadura", "Sem armadura", 290, 314, 162.6], ["leve", "Armadura leve", 327.25, 351, 162.6], ["media", "Armadura média", 364.25, 388.25, 162.6], ["pesada", "Armadura pesada", 401.5, 425.25, 162.9]]
  .forEach(([k, l, a, b, cy]) => teml(`armadura_${k}`, l, 0, a, b, 6.5, cy));
num("escudo_bonus", "Escudo — bônus de CA", "number", 0, 312, 173.75, 15, 21, 12, N(null, 0, 9), 1);
num("escudo_dureza", "Escudo — dureza", "number", 0, 334, 180.5, 30, 13, 10, N(null, 0, 99));
num("escudo_pv_max", "Escudo — PV máximos", "number", 0, 372, 180.25, 17, 14, 8, N(null, 0, 999));
num("escudo_lq", "Escudo — limiar de quebra", "number", 0, 390, 180.25, 16, 14, 8, N(null, 0, 999));
num("escudo_pv", "Escudo — PV atuais", "number", 0, 414, 180.5, 33, 13, 10, N(null, 0, 999));
// Pontos de vida
num("pv_max", "PV máximos", "number", 0, 465, 108.25, 24, 24, 10, { role: "maxHp", ...N("10", 1, 9999) }, 3);
num("pv_atual", "PV atuais", "number", 0, 458, 136, 64, 38, 20, { role: "hp", ...N("10", 0, 9999) }, 3);
num("pv_temp", "PV temporários", "number", 0, 526, 130.5, 55, 19, 12, N(null, 0, 9999));
num("ferido", "Ferido", "number", 0, 526, 158.5, 22, 16, 10, N(null, 0, 9), 1);
num("morrendo", "Morrendo", "number", 0, 551, 158.5, 30, 16, 10, N(null, 0, 9), 1);
add("resistencias", "Resistências e imunidades", "textarea", 0, 467, 186.5, 112, 19, 7.5, { maxLength: 600 });
add("condicoes", "Condições", "textarea", 0, 467, 220, 112, 20, 7.5, { maxLength: 600 });
// Jogadas de salvamento
[["fortitude", "Fortitude", "constituicao", 0, 251.5, 275.5], ["reflexos", "Reflexos", "destreza", 80.5, 331.5, 355.25], ["vontade", "Vontade", "sabedoria", 159.5, 410.5, 434.5]].forEach(([k, l, a, dx, t1, t4]) => {
  num(k, l, "computed", 0, 235 + dx, 227.75, 32, 16, 12, { formula: `@${a}_mod + @${k}_prof + @${k}_item` });
  num(`${k}_atributo`, `${l} — modificador de atributo`, "computed", 0, 223 + dx, 254.5, 22, 16, 10, { formula: `@${a}_mod` });
  num(`${k}_prof`, `${l} — proficiência`, "number", 0, 254 + dx, 254.5, 22, 16, 10, N(null, 0, 99));
  num(`${k}_item`, `${l} — item`, "number", 0, 223 + dx, 279.25, 22, 16, 10, N(null, -9, 99));
  teml(`${k}_rank`, l, 0, t1, t4, 6.5, 288.25);
});
line("salvamento_anotacoes", "Jogadas de salvamento — anotações", "text", 0, 266, 308.5, 169, 8, { maxLength: 120 });
// Percepção
num("percepcao", "Percepção", "computed", 0, 458, 248.25, 26, 26, 12, { role: "perception", formula: "@sabedoria_mod + @percepcao_prof + @percepcao_item" });
num("percepcao_atributo", "Percepção — Sabedoria", "computed", 0, 483, 272.5, 20, 16, 10, { formula: "@sabedoria_mod" });
num("percepcao_prof", "Percepção — proficiência", "number", 0, 506, 272.5, 19, 16, 10, N(null, 0, 99));
num("percepcao_item", "Percepção — item", "number", 0, 562, 272.5, 18, 16, 10, N(null, -9, 99));
teml("percepcao_rank", "Percepção", 0, 528.75, 552.75, 6.5, 279.9);
add("sentidos", "Sentidos", "textarea", 0, 476, 300, 103, 17, 7.5, { maxLength: 300 });
// CD de classe
num("cd_classe", "CD de classe", "computed", 0, 20, 299.75, 34, 21, 12, { formula: "10 + @cd_classe_atributo + @cd_classe_prof + @cd_classe_item" });
num("cd_classe_atributo", "CD de classe — modificador do atributo-chave", "number", 0, 86, 306.25, 22, 14, 10, N(null, -9, 99));
num("cd_classe_prof", "CD de classe — proficiência", "number", 0, 112, 306.25, 22, 14, 10, N(null, 0, 99));
num("cd_classe_item", "CD de classe — item", "number", 0, 172, 306, 22, 14, 10, N(null, -9, 99));
teml("cd_classe_rank", "CD de classe", 0, 137.75, 162, 6.5, 313.25);
// Velocidade
num("velocidade", "Velocidade (metros)", "number", 0, 75, 327, 44, 18, 12, { role: "movement", ...N("7.5", 0, 999) }, 3);
add("movimento_anotacoes", "Tipos de movimento e anotações", "textarea", 0, 156, 333.5, 154, 12.5, 7.5, { maxLength: 200 });
// Golpes corpo a corpo (FOR) e à distância (DES)
[[373.75, 365.5, 28, 374.75, 406.25, "forca"], [431.5, 423, 28, 432.5, 464, "forca"], [489.75, 481.25, 28, 490.75, 522.25, "forca"],
 [563.25, 558.5, 21, 564.25, 595.5, "destreza"], [620, 615.25, 21, 621, 652.25, "destreza"], [676.5, 671.75, 21.25, 677.75, 709, "destreza"]].forEach(([ya, yt, ht, yp, yd, a], i) => {
  const n = i + 1, L = `${i < 3 ? "Corpo a corpo" : "À distância"} ${i < 3 ? n : n - 3}`;
  line(`golpe${n}_arma`, `${L} — arma`, "text", 0, 23.5, ya + 7.6, 121, 9, { maxLength: 40 });
  num(`golpe${n}`, `${L} — bônus de ataque`, "computed", 0, 151.75, yt, 36, ht, 14, { formula: `@${a}_mod + @golpe${n}_prof + @golpe${n}_item` });
  num(`golpe${n}_prof`, `${L} — proficiência`, "number", 0, 226.25, yp, 22.75, 17, 10, N(null, 0, 99));
  num(`golpe${n}_item`, `${L} — item`, "number", 0, 286.25, yp, 22.25, 17, 10, N(null, -9, 99));
  line(`golpe${n}_dados`, `${L} — dados de dano`, "text", 0, 22.5, yd + 7, 21.5, 7, { maxLength: 12 });
  line(`golpe${n}_outro`, `${L} — outros (dano)`, "text", 0, 130.5, yd + 7, 65.5, 7, { maxLength: 40 });
  line(`golpe${n}_tracos`, `${L} — traços`, "text", 0, 201, yd + 7, 108, 7, { maxLength: 60 });
});
// Proficiência com armas
teml("armas_simples", "Armas simples", 0, 21.25, 45.25, 6.5, 759.5);
teml("armas_marciais", "Armas marciais", 0, 59.5, 83.75, 6.5, 759.6);
teml("armas_outra_1", "Outra arma 1", 0, 100, 124, 6.5, 759.5);
teml("armas_outra_2", "Outra arma 2", 0, 209, 233, 6.5, 759.5);
line("armas_outra_1_nome", "Outra arma 1 — qual", "text", 0, 135.5, 753.5, 64, 8, { maxLength: 30 });
line("armas_outra_2_nome", "Outra arma 2 — qual", "text", 0, 244.5, 753.5, 64, 8, { maxLength: 30 });
line("idiomas", "Idiomas", "text", 0, 320, 756.5, 262, 8, { maxLength: 120 });
// Perícias
const SK = [["acrobatismo", "Acrobatismo", "DES", 1], ["arcanismo", "Arcanismo", "INT"], ["atletismo", "Atletismo", "FOR", 1], ["diplomacia", "Diplomacia", "CAR"],
  ["dissimulacao", "Dissimulação", "CAR"], ["furtividade", "Furtividade", "DES", 1], ["intimidacao", "Intimidação", "CAR"], ["ladroagem", "Ladroagem", "DES", 1],
  ["manufatura", "Manufatura", "INT"], ["medicina", "Medicina", "SAB"], ["natureza", "Natureza", "SAB"], ["ocultismo", "Ocultismo", "INT"],
  ["performance", "Performance", "CAR"], ["religiao", "Religião", "SAB"], ["saber_1", "Saber 1", "INT"], ["saber_2", "Saber 2", "INT"], ["sociedade", "Sociedade", "INT"], ["sobrevivencia", "Sobrevivência", "SAB"]];
const SKT = [344.75, 366.75, 388.5, 410.5, 432.25, 454, 476, 497.75, 519.75, 541.5, 563.25, 585.25, 607, 629, 650.75, 672.75, 694.5, 716.25];
const SKR = [350, 371.75, 393.5, 415.5, 437.25, 459.25, 481, 503, 524.75, 546.5, 568.5, 590.25, 612.25, 634, 656, 677.75, 699.5, 721.5];
SK.forEach(([k, l, a, armor], i) => {
  const yt = SKT[i], yb = yt + 2;
  const pen = armor ? ` - abs(@${k}_armadura)` : "";
  num(k, l, "computed", 0, 406.25, yt, 28.75, 15.25, 11, { formula: `@${ATTRS[a]}_mod + @${k}_prof + @${k}_item${pen}` });
  num(`${k}_prof`, `${l} — proficiência`, "number", 0, 470.5, yb, 23.25, 14, 10, N(null, 0, 99));
  num(`${k}_item`, `${l} — item`, "number", 0, 530.5, yb, 23.25, 14, 10, N(null, -9, 99));
  teml(`${k}_rank`, l, 0, 497, 521, 6.4, SKR[i] + 5.15);
  if (armor) num(`${k}_armadura`, `${l} — penalidade de armadura (sem sinal)`, "number", 0, 561, yb, 20, 14, 10, N(null, -9, 9), 1);
  if (k.startsWith("saber")) line(`${k}_tema`, `${l} — tema`, "text", 0, 321, (i === 14 ? 653 : 675.75) + 6.4, 49, 7.5, { maxLength: 20 });
});
// ---------- Página 2: talentos e inventário ----------
ruled("talentos_ancestralidade", "Talentos de ancestralidade (especial, herança, 1º … 17º — uma linha cada)", 1, 25, 35, 210, 19.417, 7, 14, 700);
ruled("talentos_pericia", "Talentos de perícia (biografia, 2º, 4º … 20º — uma linha cada)", 1, 25, 190.5, 215, 19.575, 11, 14, 1100);
ruled("talentos_gerais", "Talentos gerais (3º, 7º, 11º, 15º, 19º — uma linha cada)", 1, 25, 423.75, 244, 19.6875, 5, 14, 500);
ruled("talentos_classe", "Habilidades e talentos de classe (1º a 20º — uma linha cada)", 1, 309, 34.5, 186, 19.5476, 22, 14, 2200);
ruled("talentos_extras", "Talentos bônus", 1, 309, 482.25, 268, 20, 2, 14, 200);
add("itens_vestidos", "Itens vestidos", "textarea", 1, 24, 561, 212, 196, 8, { maxLength: 3000 });
add("itens_vestidos_investido", "Itens vestidos — investido", "textarea", 1, 241, 561, 24, 196, 8, { maxLength: 300 });
add("itens_vestidos_volume", "Itens vestidos — volume", "textarea", 1, 267, 561, 20, 196, 8, { maxLength: 300 });
add("itens_preparados", "Itens preparados", "textarea", 1, 309, 557, 110, 139, 8, { maxLength: 3000 });
add("itens_preparados_volume", "Itens preparados — volume", "textarea", 1, 422, 557, 18, 139, 8, { maxLength: 300 });
add("outros_itens", "Outros itens", "textarea", 1, 448, 557, 108, 139, 8, { maxLength: 3000 });
add("outros_itens_volume", "Outros itens — volume", "textarea", 1, 559, 557, 19, 139, 8, { maxLength: 300 });
num("volume_total", "Volume total carregado", "number", 1, 316, 728.75, 27, 27, 12, N(null, 0, 999));
num("volume_atravancado", "Atravancado a partir de (5 + FOR)", "computed", 1, 361, 712.75, 26, 18, 12, { formula: "5 + @forca_mod" });
num("volume_maximo", "Volume máximo (10 + FOR)", "computed", 1, 361, 741.75, 26, 18, 12, { formula: "10 + @forca_mod" });
[["pc", "Peças de cobre"], ["pp", "Peças de prata"], ["po", "Peças de ouro"], ["pl", "Peças de platina"]].forEach(([k, l], i) =>
  num(`moedas_${k}`, l, "number", 1, [444, 479, 514, 550][i], 711.25, 32, 30, 10, N(null, 0, 999999), 4));
// ---------- Página 3: rascunho, personalidade, anotações, ações ----------
[["etnia", "Etnia", 230, 58], ["nacionalidade", "Nacionalidade", 291, 58], ["local_nascimento", "Local de nascimento", 351, 70], ["idade", "Idade", 424, 26],
 ["genero", "Gênero e pronomes", 453, 70], ["altura", "Altura", 526, 26], ["peso", "Peso", 554, 26]]
  .forEach(([k, l, x, w]) => line(k, l, "text", 2, x + 1.5, 38.5, w - 3, 8, { maxLength: 40 }));
[["aparencia", "Aparência", 48.5, 25], ["atitude", "Atitude", 91, 22], ["crencas", "Crenças", 118, 29], ["bordoes", "Bordões", 193, 37]]
  .forEach(([k, l, y, h]) => add(k, l, "textarea", 2, 232, y + 9, 346, h - 10, 8, { maxLength: 1000 }));
add("gostos", "Gostos", "textarea", 2, 232, 161.25, 173, 26, 8, { maxLength: 800 });
add("desgostos", "Desgostos", "textarea", 2, 415, 161, 163, 26, 8, { maxLength: 800 });
add("anotacoes", "Anotações de campanha", "textarea", 2, 24, 263, 272, 130, 8, { maxLength: 5000 });
[["aliados", "Aliados", 253.25], ["inimigos", "Inimigos", 301.75], ["organizacoes", "Organizações", 350.25]]
  .forEach(([k, l, y]) => add(k, l, "textarea", 2, 308, y + 10, 270, 33, 8, { maxLength: 1500 }));
[[419.75, 444.5], [479.25, 504], [538.5, 563.25]].forEach(([yh, yd], r) => [[22, 306], [306, 590]].forEach(([x0], c) => {
  const n = r * 2 + c + 1, L = `Ação ${n}`;
  line(`acao${n}_nome`, `${L} — nome`, "text", 2, x0 + 1.5, yh + 15, (c ? 96 : 97) - 3, 8, { maxLength: 40 });
  add(`acao${n}_descricao`, `${L} — ações, traços, página e descrição`, "textarea", 2, x0 + 2, yd + 9, 272, 20, 7.5, { maxLength: 1200 });
}));
[[618.75, 642], [691.75, 715]].forEach(([yh, yd], r) => [[22, 306], [306, 590]].forEach(([x0], c) => {
  const n = r * 2 + c + 1, L = `Ação livre/reação ${n}`;
  line(`reacao${n}_nome`, `${L} — nome`, "text", 2, x0 + 1.5, yh + 13.5, 91, 8, { maxLength: 40 });
  add(`reacao${n}_descricao`, `${L} — acionamento (1ª linha) e descrição`, "textarea", 2, x0 + 62, yd + 1, 212, 43, 7.5, { maxLength: 1500 });
}));
// ---------- Página 4: magias ----------
num("magia_ataque", "Ataque de magia", "computed", 3, 50, 35.75, 26, 18, 12, { formula: "@magia_atributo + @magia_prof" });
num("magia_atributo", "Magia — modificador do atributo-chave", "number", 3, 86, 40.75, 22, 14, 10, N(null, -9, 99));
num("magia_prof", "Magia — proficiência", "number", 3, 116, 40.75, 22, 14, 10, N(null, 0, 99));
teml("magia_ataque_rank", "Ataque de magia", 3, 141, 165.5, 6.6, 47.75);
num("magia_cd", "CD de magia", "computed", 3, 40, 74.75, 26, 18, 12, { formula: "10 + @magia_atributo + @magia_prof" });
num("magia_cd_atributo", "CD de magia — atributo-chave (do ataque)", "computed", 3, 96, 79.75, 22, 14, 10, { formula: "@magia_atributo" });
num("magia_cd_prof", "CD de magia — proficiência (do ataque)", "computed", 3, 125, 79.75, 22, 14, 10, { formula: "@magia_prof" });
teml("magia_cd_rank", "CD de magia", 3, 152, 176.25, 6.5, 86.6);
num("truque_nivel", "Nível dos truques", "number", 3, 216, 60.25, 29, 19, 11, N(null, 0, 10));
[249.5, 282.75, 316.25, 349.75, 383, 416.5, 450, 483.5, 517, 550.5].forEach((x, i) => {
  num(`espacos_${i + 1}`, `Espaços de magia por dia — ${i + 1}º círculo`, "number", 3, x, 35.75, 29, 19, 11, N(null, 0, 99));
  num(`espacos_${i + 1}_restantes`, `Espaços espontâneos restantes — ${i + 1}º círculo`, "number", 3, x, 65, 29, 18, 11, N(null, 0, 99));
});
[["arcana", "Arcana", 89.75, 123], ["ocultista", "Ocultista", 111.5, 123], ["primal", "Primal", 89.75, 144.25], ["divina", "Divina", 111.5, 144.25]]
  .forEach(([k, l, x, y]) => line(`tradicao_${k}`, `Tradição mágica: ${l}`, "checkbox", 3, x + 4, y + 9, 12, 11));
line("conjurador_preparado", "Conjurador: magias preparadas", "checkbox", 3, 54.5, 188.6, 10, 9);
line("conjurador_espontaneo", "Conjurador: magias espontâneas", "checkbox", 3, 110, 188.6, 10, 9);
num("foco_atual", "Pontos de foco atuais", "number", 3, 88, 638, 44, 13, 10, N(null, 0, 3), 1);
num("foco_max", "Pontos de foco máximos", "number", 3, 136, 638, 44, 13, 10, N(null, 0, 3), 1);
ruled("truques", "Truques (3 linhas por truque: nome / detalhes / detalhes)", 3, 23, 218, 148, 42.75 / 3, 21, 14, 3000);
ruled("magias_1", "Magias, coluna 1 (3 linhas por magia: nome / detalhes / detalhes)", 3, 217, 114.5, 148, 40.4833 / 3, 48, 14, 6000);
ruled("magias_2", "Magias, coluna 2 (3 linhas por magia: nome / detalhes / detalhes)", 3, 402, 114.5, 148, 40.4833 / 3, 48, 14, 6000);
ruled("magias_inatas", "Magias inatas (3 linhas por magia: nome / detalhes / detalhes)", 3, 23, 532.5, 148, 41 / 3, 6, 14, 1000);
ruled("magias_foco", "Magias de foco (2 linhas por magia: nome / detalhes)", 3, 23, 653.5, 148, 27.4167 / 2, 8, 10, 1500);
// ---------- Ações: rolagens d20 ----------
const R = (key, name, ref) => ({ key, name, kind: "habilidade", formula: `1d20 + @${ref}`, description: `1d20 + ${name}.` });
const actions = [R("teste_percepcao", "Percepção", "percepcao"), R("teste_fortitude", "Fortitude", "fortitude"), R("teste_reflexos", "Reflexos", "reflexos"), R("teste_vontade", "Vontade", "vontade"),
  ...SK.map(([k, l]) => R(`teste_${k}`, l, k)),
  ...[1, 2, 3, 4, 5, 6].map((n) => R(`ataque_golpe${n}`, `Golpe ${n <= 3 ? "corpo a corpo " + n : "à distância " + (n - 3)}`, `golpe${n}`)),
  R("ataque_magia", "Ataque de magia", "magia_ataque")];
return { pages: Array.from({ length: 4 }, () => ({ width: PW, height: PH })), fields: F, actions,
  notes: "Mapeamento da ficha de Pathfinder 2e (4 páginas): atributos com modificador, CA, salvamentos, percepção, CD de classe, perícias e golpes com total automático (atributo + proficiência + item), proficiência T/E/M/L em listas que marcam as caixas, talentos, inventário com volume, personalidade, ações e magias." };
})()
