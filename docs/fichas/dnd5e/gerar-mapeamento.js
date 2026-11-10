(() => {
// Ficha D&D 5e (PDF comum, 3 páginas, 612 x 792 pt). Mesmo formato do editor (compactDoc).
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
const onLine = (L, fs) => [L - 4 - 0.905 * fs, 1.2 * fs + 1];
const boxed = (cy, fs) => { const h = 1.2 * fs + 1; return [cy - h / 2, h]; };
let y, h;
// ---------- Página 1 ----------
add("personagem", "Nome do personagem", "text", 0, 52, 61, 196, 21, 16, { role: "name", maxLength: 100 });
[y, h] = onLine(63.75, 11);
add("classe", "Classe", "text", 0, 271, y, 76, h, 11, { maxLength: 60 });
add("nivel", "Nível", "number", 0, 350, y, 28, h, 11, { role: "level", default: "1", min: 1, max: 20, align: "center" });
add("antecedente", "Antecedente", "text", 0, 384, y, 90, h, 11, { maxLength: 60 });
add("jogador", "Nome do jogador", "text", 0, 481, y, 86, h, 11, { maxLength: 80 });
[y, h] = onLine(89.5, 11);
add("raca", "Raça", "text", 0, 271, y, 106, h, 11, { maxLength: 60 });
add("tendencia", "Tendência", "text", 0, 384, y, 90, h, 11, { maxLength: 60 });
add("experiencia", "Pontos de experiência", "number", 0, 481, y, 86, h, 11, { default: "0", min: 0, max: 9999999 });
add("inspiracao", "Inspiração", "checkbox", 0, 101, 133, 14, 14, 14);
add("proficiencia", "Bônus de proficiência", "computed", 0, 103.5, 168.5, 20, 17, 14, { formula: "2 + floor((@nivel - 1) / 4)", align: "center" });
const ATTRS = [["forca", "Força"], ["destreza", "Destreza"], ["constituicao", "Constituição"], ["inteligencia", "Inteligência"], ["sabedoria", "Sabedoria"], ["carisma", "Carisma"]];
const LBL = [145.1, 216.9, 288.2, 360.1, 431.6, 503.1];
ATTRS.forEach(([k, l], i) => {
  add(k + "_mod", "Mod. de " + l, "computed", 0, 43, LBL[i] + 13, 30, 25, 20, { formula: `mod(@${k})`, align: "center" });
  add(k, l, "number", 0, 48, LBL[i] + 40.5, 18, 14, 11, { default: "10", min: 1, max: 30, align: "center" });
});
// Testes de resistência: círculo = proficiente; linha = valor
const SAVE_Y = [211.25, 224.75, 238.25, 251.75, 265.25, 278.75];
ATTRS.forEach(([k, l], i) => {
  const c = SAVE_Y[i];
  add(`resistencia_${k}_prof`, `Resistência de ${l} — proficiente`, "checkbox", 0, 101, c - 3.5, 7, 7, 7);
  [y, h] = onLine(c + 3.8, 8);
  add(`resistencia_${k}`, `Resistência de ${l}`, "computed", 0, 112.5, y, 14.5, h, 8, { formula: `@${k}_mod + @resistencia_${k}_prof * @proficiencia`, align: "center" });
});
// Perícias: círculo = multiplicador de proficiência (vazio/0, 1 = proficiente, 2 = especialista, 0.5 = meia proficiência)
const SK = [["acrobacia", "Acrobacia", "destreza"], ["arcanismo", "Arcanismo", "inteligencia"], ["atletismo", "Atletismo", "forca"], ["atuacao", "Atuação", "carisma"],
  ["blefar", "Blefar", "carisma"], ["furtividade", "Furtividade", "destreza"], ["historia", "História", "inteligencia"], ["intimidacao", "Intimidação", "carisma"],
  ["intuicao", "Intuição", "sabedoria"], ["investigacao", "Investigação", "inteligencia"], ["lidar_animais", "Lidar com Animais", "sabedoria"], ["medicina", "Medicina", "sabedoria"],
  ["natureza", "Natureza", "inteligencia"], ["percepcao", "Percepção", "sabedoria"], ["persuasao", "Persuasão", "carisma"], ["prestidigitacao", "Prestidigitação", "destreza"],
  ["religiao", "Religião", "inteligencia"], ["sobrevivencia", "Sobrevivência", "sabedoria"]];
SK.forEach(([k, l, a], i) => {
  const c = 326.5 + 13.5 * i;
  add(`${k}_prof`, `${l} — proficiência (1 = proficiente, 2 = especialista)`, "number", 0, 100.5, c - 4, 8, 8, 7, { min: 0, max: 2 });
  [y, h] = onLine(c + 3.8, 8);
  add(k, l, "computed", 0, 112.5, y, 14.5, h, 8, { formula: `@${a}_mod + floor(@${k}_prof * @proficiencia)`, align: "center" });
});
add("sabedoria_passiva", "Sabedoria passiva (Percepção)", "computed", 0, 32, 591, 24, 17, 14, { role: "perception", formula: "10 + @percepcao", align: "center" });
// Combate
add("classe_armadura", "Classe de armadura", "number", 0, 234, 143, 28, 20, 16, { role: "armor", default: "10", min: 0, max: 99, align: "center" });
add("iniciativa", "Iniciativa", "computed", 0, 293, 145, 28, 22, 18, { formula: "@destreza_mod", align: "center" });
add("deslocamento", "Deslocamento (m)", "number", 0, 352, 146, 30, 20, 16, { role: "movement", default: "9", min: 0, max: 300, align: "center" });
[y, h] = onLine(207, 10);
add("pv_max", "PV totais (máximo)", "number", 0, 292, y, 86, h, 10, { role: "maxHp", default: "10", min: 1, max: 9999 });
add("pv_atual", "Pontos de vida atuais", "number", 0, 236, 216, 140, 26, 22, { role: "hp", default: "10", min: 0, max: 9999, align: "center" });
add("pv_temporarios", "Pontos de vida temporários", "number", 0, 236, 267, 140, 24, 20, { min: 0, max: 9999, align: "center" });
[y, h] = onLine(328, 9);
add("dados_vida_total", "Dados de vida — total", "text", 0, 248, y, 46, h, 9, { maxLength: 20 });
add("dados_vida", "Dados de vida restantes", "text", 0, 230, 334, 66, 15, 12, { maxLength: 20 });
[350.75, 363, 376].forEach((cx, i) => add(`morte_sucesso_${i + 1}`, `Teste contra a morte — sucesso ${i + 1}`, "checkbox", 0, cx - 3.5, 323.5, 7, 7, 7));
[350.75, 363, 376].forEach((cx, i) => add(`morte_fracasso_${i + 1}`, `Teste contra a morte — fracasso ${i + 1}`, "checkbox", 0, cx - 3.5, 338.5, 7, 7, 7));
// Ataques e magias
[400, 420.5, 441].forEach((cy, i) => {
  [y, h] = boxed(cy, 9);
  add(`ataque_${i + 1}_nome`, `Ataque ${i + 1} — nome`, "text", 0, 225, y, 60, h, 9, { maxLength: 40 });
  add(`ataque_${i + 1}_bonus`, `Ataque ${i + 1} — bônus`, "text", 0, 293, y, 28, h, 9, { maxLength: 10 });
  add(`ataque_${i + 1}_dano`, `Ataque ${i + 1} — dano/tipo`, "text", 0, 329, y, 58, h, 9, { maxLength: 40 });
});
add("ataques_magias", "Ataques e magias (outros)", "textarea", 0, 226, 455, 160, 108, 9, { maxLength: 2000 });
// Personalidade
add("tracos", "Traços de personalidade", "textarea", 0, 418, 140, 155, 47, 9, { maxLength: 1000 });
add("ideais", "Ideais", "textarea", 0, 418, 209, 155, 34, 9, { maxLength: 1000 });
add("ligacoes", "Ligações", "textarea", 0, 418, 264, 155, 34, 9, { maxLength: 1000 });
add("defeitos", "Defeitos", "textarea", 0, 418, 319, 155, 34, 9, { maxLength: 1000 });
add("idiomas_proficiencias", "Idiomas e outras proficiências", "textarea", 0, 35, 628, 164, 125, 9, { maxLength: 3000 });
// Equipamento
[["pc", "PC (peças de cobre)", 607.5], ["pp", "PP (peças de prata)", 633.5], ["pe", "PE (peças de electrum)", 659.5], ["po", "PO (peças de ouro)", 685.5], ["pl", "PL (peças de platina)", 711.5]]
  .forEach(([k, l, cy]) => { [y, h] = boxed(cy, 10); add(`moedas_${k}`, l, "number", 0, 231, y, 30, h, 10, { min: 0, max: 999999999, align: "center" }); });
add("equipamento", "Equipamento", "textarea", 0, 270, 592, 120, 160, 9, { maxLength: 4000 });
add("caracteristicas", "Características e habilidades", "textarea", 0, 412, 386, 166, 367, 9, { maxLength: 10000 });
// ---------- Página 2 ----------
add("personagem_pag2", "Nome do personagem (página 2)", "text", 1, 52, 63, 196, 21, 16, { maxLength: 100 });
[y, h] = onLine(66.5, 11);
add("idade", "Idade", "text", 1, 266, y, 105, h, 11, { maxLength: 30 });
add("altura", "Altura", "text", 1, 379, y, 90, h, 11, { maxLength: 30 });
add("peso", "Peso", "text", 1, 476, y, 90, h, 11, { maxLength: 30 });
[y, h] = onLine(92.5, 11);
add("olhos", "Olhos", "text", 1, 266, y, 105, h, 11, { maxLength: 30 });
add("pele", "Pele", "text", 1, 379, y, 90, h, 11, { maxLength: 30 });
add("cabelos", "Cabelos", "text", 1, 476, y, 90, h, 11, { maxLength: 30 });
add("aparencia", "Aparência do personagem", "textarea", 1, 35, 132, 166, 216, 9, { maxLength: 3000 });
add("aliados", "Aliados e organizações", "textarea", 1, 222, 132, 184, 216, 9, { maxLength: 3000 });
add("simbolo_nome", "Símbolo — nome", "text", 1, 423, 155.5, 138, 12, 9, { maxLength: 60 });
add("historia_personagem", "História do personagem", "textarea", 1, 35, 386, 166, 366, 9, { maxLength: 10000 });
add("outras_caracteristicas", "Outras características e habilidades", "textarea", 1, 222, 377, 357, 200, 9, { maxLength: 10000 });
add("tesouro", "Tesouro", "textarea", 1, 222, 606, 357, 147, 9, { maxLength: 4000 });
// ---------- Página 3 (magias) ----------
add("classe_conjurador", "Classe de conjurador", "text", 2, 52, 63, 200, 20, 14, { maxLength: 60 });
[y, h] = boxed(68.7, 11);
add("habilidade_chave", "Habilidade chave", "select", 2, 284, y, 64, h, 11, { options: ["Força", "Destreza", "Constituição", "Inteligência", "Sabedoria", "Carisma"] });
[y, h] = boxed(68.7, 16);
add("cd_magia", "CD do teste de resistência das magias", "number", 2, 405, y, 26, h, 16, { min: 0, max: 99, align: "center" });
add("ataque_magia", "Bônus de ataque com magia", "number", 2, 509, y, 26, h, 16, { min: -10, max: 99, align: "center" });
const LEVELS = [
  // [nível, deslocamento da coluna, centro do cabeçalho, linhas]
  [0, 0, 156.25, [184.5, 198.5, 212.5, 226.5, 240.5, 254.5, 268.5, 282.5]],
  [1, 0, 324, Array.from({ length: 13 }, (_, i) => 355.5 + 14 * i)],
  [2, 0, 552.5, Array.from({ length: 13 }, (_, i) => 582 + 14 * i)],
  [3, 189, 156.25, Array.from({ length: 13 }, (_, i) => 185.8 + 14 * i)],
  [4, 189, 381.9, Array.from({ length: 13 }, (_, i) => 411.2 + 14 * i)],
  [5, 189, 608.5, Array.from({ length: 9 }, (_, i) => 638 + 14 * i)],
  [6, 376, 156.25, Array.from({ length: 9 }, (_, i) => 185.8 + 14 * i)],
  [7, 376, 326, Array.from({ length: 9 }, (_, i) => 355.5 + 14 * i)],
  [8, 376, 495.9, Array.from({ length: 7 }, (_, i) => 525.2 + 14 * i)],
  [9, 376, 636.6, Array.from({ length: 7 }, (_, i) => 666 + 14 * i)],
];
for (const [lv, dx, cy, lines] of LEVELS) {
  if (lv > 0) {
    [y, h] = boxed(cy, 11);
    add(`espacos_${lv}_total`, `Espaços de magia ${lv}º nível — total`, "number", 2, 58 + dx, y, 32, h, 11, { min: 0, max: 99, align: "center" });
    add(`espacos_${lv}_usados`, `Espaços de magia ${lv}º nível — usados`, "number", 2, 108 + dx, y, 86, h, 11, { min: 0, max: 99, align: "center" });
  }
  lines.forEach((L, i) => {
    [y, h] = onLine(L, 9);
    const x = (lv === 0 ? 34 : 42) + dx;
    add(lv === 0 ? `truque_${i + 1}` : `magia_${lv}_${i + 1}`, lv === 0 ? `Truque ${i + 1}` : `Magia de ${lv}º nível ${i + 1}`, "text", 2, x, y, lv === 0 ? 168 : 160, h, 9, { maxLength: 80 });
  });
}
// ---------- Ações ----------
const actions = [{ key: "iniciativa", name: "Iniciativa", kind: "habilidade", formula: "1d20 + @iniciativa", description: "Teste de iniciativa: 1d20 + modificador de Destreza." }];
ATTRS.forEach(([k, l]) => actions.push({ key: `resistencia_${k}`, name: `Resistência de ${l}`, kind: "habilidade", formula: `1d20 + @resistencia_${k}`, description: `Teste de resistência de ${l}.` }));
SK.forEach(([k, l]) => actions.push({ key: `teste_${k}`, name: l, kind: "habilidade", formula: `1d20 + @${k}`, description: `Teste de ${l}: 1d20 + valor da perícia.` }));
actions.push({ key: "teste_morte", name: "Teste contra a morte", kind: "habilidade", formula: "1d20", description: "10 ou mais é sucesso; 1 conta como dois fracassos; 20 recupera 1 PV." });
return { pages: [{ width: PW, height: PH }, { width: PW, height: PH }, { width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da ficha de D&D 5e (PDF comum, 3 páginas): atributos e modificadores, bônus de proficiência pelo nível, resistências e 18 perícias automáticas (proficiente/especialista), percepção passiva, PV, ataques, personalidade, equipamento, detalhes do personagem e página de magias com espaços por nível." };
})()
