(() => {
// Ficha Fabula Ultima (PDF comum, 3 páginas A4 paisagem, 841,89 x 595,28 pt). Mesmo formato do editor (compactDoc).
const PW = 841.89, PH = 595.28, F = [];
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
let y, h;
// ---------- Página 1 ----------
add("nome", "Nome", "text", 0, 45, 22, 240, 15, 13, { role: "name", maxLength: 100 });
add("pronomes", "Pronomes", "text", 0, 330, 22, 85, 15, 11, { maxLength: 30 });
[y, h] = boxed(59.5, 11); add("identidade", "Identidade", "text", 0, 68, y, 340, h, 11, { maxLength: 120 });
[y, h] = boxed(82.5, 11);
add("tema", "Tema", "text", 0, 51, y, 140, h, 11, { maxLength: 40 });
add("origem", "Origem", "text", 0, 226, y, 180, h, 11, { maxLength: 60 });
// Laços: nome + seis sentimentos (caixas)
const FEEL = [["admiracao", "Admiração", 0, 0], ["lealdade", "Lealdade", 1, 0], ["afeicao", "Afeição", 2, 0], ["inferioridade", "Inferioridade", 0, 1], ["suspeita", "Suspeita", 1, 1], ["odio", "Ódio", 2, 1]];
const BOND_ROWS = [104.2, 127.5, 150.9];
for (let side = 0; side < 2; side++) BOND_ROWS.forEach((top, r) => {
  const n = side * 3 + r + 1, xs = side ? [297.2, 336.2, 369.0] : [109.0, 147.6, 180.8], nx = side ? 223 : 35;
  [y, h] = boxed(top + 8, 9);
  add(`laco_${n}`, `Laço ${n} — com quem`, "text", 0, nx, y, 70, h, 9, { maxLength: 40 });
  for (const [k, l, col, line] of FEEL) add(`laco_${n}_${k}`, `Laço ${n} — ${l}`, "checkbox", 0, xs[col], top + 10 * line, 5.5, 6, 7);
});
[y, h] = boxed(206, 16); add("pontos_fabula", "Pontos Fabula", "number", 0, 22, y, 28, h, 16, { default: "3", min: 0, max: 99, align: "center" });
[y, h] = boxed(285, 16); add("experiencia", "Pontos de experiência", "number", 0, 22, y, 28, h, 16, { default: "0", min: 0, max: 999, align: "center" });
[y, h] = boxed(289, 11); add("iniciativa_mod", "Modificador de iniciativa", "number", 0, 375, y, 33, h, 11, { default: "0", min: -99, max: 99 });
[y, h] = boxed(306.6, 11); add("defesa", "Defesa", "number", 0, 341, y, 67, h, 11, { role: "armor", default: "8", min: 0, max: 99 });
[y, h] = boxed(324.3, 11); add("defesa_magica", "Defesa mágica", "number", 0, 364, y, 44, h, 11, { default: "8", min: 0, max: 99 });
[["armadura", "Armadura marcial", 163.4], ["escudos", "Escudos marciais", 210.6], ["corpo_a_corpo", "Armas corpo a corpo marciais", 260.8], ["longo_alcance", "Armas de longo alcance marciais", 331.6]]
  .forEach(([k, l, x]) => add(`pode_equipar_${k}`, `Pode equipar — ${l}`, "checkbox", 0, x, 337.9, 5.5, 6, 7));
[["acessorio", "Acessório", 358.5], ["armadura", "Armadura", 387.5], ["mao_primaria", "Mão primária", 416], ["mao_secundaria", "Mão secundária", 444.5]].forEach(([k, l, top]) => {
  add(`equip_${k}`, `${l} — item`, "text", 0, 20, top + 4, 128, 13, 10, { maxLength: 60 });
  add(`equip_${k}_descricao`, `${l} — descrição`, "textarea", 0, 155, top + 2, 248, 25, 8, { maxLength: 300 });
});
add("mochila", "Mochila e anotações", "textarea", 0, 20, 503, 282, 74, 9, { maxLength: 4000 });
[y, h] = boxed(568, 14); add("zenite", "Zênite", "number", 0, 312, y, 88, h, 14, { default: "0", min: 0, max: 999999999 });
// Atributos: base (6/8/10/12) e atual (reduzido um passo por condição, mínimo 6)
const ATTRS = [["destreza", "Destreza", 50.4, "lento", "enfurecido"], ["intuicao", "Intuição", 71.7, "confuso", "enfurecido"],
  ["vigor", "Vigor", 93.1, "fraco", "envenenado"], ["vontade", "Vontade", 114.5, "abalado", "envenenado"]];
for (const [k, l, cy, c1, c2] of ATTRS) {
  [y, h] = boxed(cy, 14);
  add(`${k}_base`, `${l} — dado base (6, 8, 10 ou 12)`, "number", 0, 630, y, 26, h, 14, { default: "8", min: 6, max: 12, align: "center" });
  add(`${k}_atual`, `${l} — dado atual`, "computed", 0, 672, y, 26, h, 14, { formula: `max(6, @${k}_base - 2 * (@${c1} + @${c2}))`, align: "center" });
}
[["lento", "Lento", 710.5, 45], ["confuso", "Confuso", 710.5, 66.4], ["fraco", "Fraco", 710.5, 87.7], ["abalado", "Abalado", 710.5, 109.1],
  ["enfurecido", "Enfurecido", 768.7, 55.4], ["envenenado", "Envenenado", 768.7, 98.2]]
  .forEach(([k, l, x, yy]) => add(k, `Condição: ${l}`, "checkbox", 0, x, yy, 9.5, 9.5, 10));
// PV / PM / PI
[y, h] = boxed(170, 16); add("pv_max", "PV máximos", "computed", 0, 580, y, 36, h, 16, { role: "maxHp", formula: "5 * @vigor_base + @nivel + @pv_bonus", align: "center" });
add("pv_bonus", "PV — outros (bônus)", "number", 0, 617, 169, 14, 10.6, 8, { min: -999, max: 999 });
[y, h] = boxed(172, 13); add("pv_crise", "Crise (metade dos PV)", "computed", 0, 645, y, 32, h, 13, { formula: "floor(@pv_max / 2)", align: "center" });
[y, h] = boxed(173.5, 16); add("pv_atual", "PV atuais", "number", 0, 692, y, 128, h, 16, { role: "hp", default: "45", min: 0, max: 9999 });
[y, h] = boxed(196, 16); add("pm_max", "PM máximos", "computed", 0, 580, y, 36, h, 16, { formula: "5 * @vontade_base + @nivel + @pm_bonus", align: "center" });
add("pm_bonus", "PM — outros (bônus)", "number", 0, 642, 192.5, 14, 10.6, 8, { min: -999, max: 999 });
[y, h] = boxed(197, 16); add("pm_atual", "PM atuais", "number", 0, 692, y, 128, h, 16, { min: 0, max: 9999 });
[y, h] = boxed(219, 16); add("pi_max", "PI máximos (pontos de inventário)", "computed", 0, 582, y, 34, h, 16, { formula: "6 + @pi_bonus", align: "center" });
add("pi_bonus", "PI — outros (bônus)", "number", 0, 631, 215.5, 14, 10.6, 8, { min: -99, max: 99 });
[y, h] = boxed(221, 16); add("pi_atual", "PI atuais", "number", 0, 692, y, 128, h, 16, { min: 0, max: 999 });
[y, h] = boxed(262.5, 18); add("nivel", "Nível de personagem", "number", 0, 796, y, 30, h, 18, { role: "level", default: "5", min: 1, max: 60, align: "center" });
// Classes (página 1: 3 blocos; página 2: 4 blocos)
const classBlock = (page, n, cy, cx, cw, bx, bw, dy, dh, dx) => {
  [y, h] = boxed(cy, 10);
  add(`classe_${n}`, `Classe ${n} — classe/nível`, "text", page, cx, y, cw, h, 10, { maxLength: 40 });
  add(`classe_${n}_beneficios`, `Classe ${n} — benefícios`, "text", page, bx, y, bw, h, 10, { maxLength: 100 });
  add(`classe_${n}_habilidades`, `Classe ${n} — detalhes das habilidades`, "textarea", page, dx, dy, 378, dh, 9, { maxLength: 3000 });
};
classBlock(0, 1, 271, 478, 120, 640, 145, 294, 62, 444);
classBlock(0, 2, 378.5, 478, 120, 640, 180, 401, 62, 444);
classBlock(0, 3, 485, 478, 120, 640, 180, 508, 70, 444);
// ---------- Página 2 ----------
add("nome_pag2", "Nome do personagem (página 2)", "text", 1, 100, 22, 300, 15, 12, { maxLength: 100 });
[0, 1, 2, 3].forEach((i) => classBlock(1, i + 4, 74.5 + 106.6 * i, 57, 122, 219, 180, 96 + 106.6 * i, 66, 20));
add("habilidades_heroicas", "Habilidades heróicas", "textarea", 1, 20, 512, 380, 66, 9, { maxLength: 4000 });
// Arcana & feitiços: blocos com nome, PM, alvos, duração e descrição
let spell = 0;
const spellBlock = (page, dx, k) => {
  spell++;
  const s = `feitico_${spell}`, L = `Feitiço ${spell}`;
  [y, h] = boxed(92 + 71.07 * k, 10);
  add(`${s}_nome`, `${L} — nome`, "text", page, 439 + dx, y, 159, h, 10, { maxLength: 60 });
  add(`${s}_pm`, `${L} — PM`, "text", page, 603 + dx, y, 31, h, 10, { maxLength: 10 });
  add(`${s}_alvos`, `${L} — alvos`, "text", page, 640 + dx, y, 109, h, 10, { maxLength: 40 });
  add(`${s}_duracao`, `${L} — duração`, "text", page, 755 + dx, y, 62, h, 10, { maxLength: 30 });
  add(`${s}_descricao`, `${L} — descrição`, "textarea", page, 438 + dx, 103 + 71.07 * k, 375, 45, 8, { maxLength: 1000 });
};
for (let k = 0; k < 6; k++) spellBlock(1, 0, k);
const DISC = [["arcanismo", "Arcanismo", 584.6], ["quimerismo", "Quimerismo", 617.8], ["elementalismo", "Elementalismo", 654.6], ["entropismo", "Entropismo", 698.6], ["ritualismo", "Ritualismo", 734.2], ["espiritismo", "Espiritismo", 768.1]];
DISC.forEach(([k, l, x]) => add(`disciplina_${k}`, `Ritual — disciplina ${l}`, "checkbox", 1, x, 517.2, 5.5, 6, 7));
// ---------- Página 3 ----------
add("nome_pag3", "Nome do personagem (página 3)", "text", 2, 100, 22, 300, 15, 12, { maxLength: 100 });
for (let k = 0; k < 7; k++) spellBlock(2, -420, k);
for (let k = 0; k < 6; k++) spellBlock(2, 0, k);
DISC.forEach(([k, l, x]) => add(`disciplina_${k}_pag3`, `Ritual — disciplina ${l} (página 3)`, "checkbox", 2, x, 517.2, 5.5, 6, 7));
// ---------- Ações: testes de atributo (dois dados pelo valor atual) ----------
const die = (a) => `(if @${a}_atual >= 12 then 1d12 else if @${a}_atual >= 10 then 1d10 else if @${a}_atual >= 8 then 1d8 else 1d6)`;
const AB = { destreza: "DES", intuicao: "INT", vigor: "VIG", vontade: "VON" }, K = Object.keys(AB);
const actions = [{ key: "iniciativa", name: "Iniciativa [DES + INT]", kind: "habilidade", formula: `${die("destreza")} + ${die("intuicao")} + @iniciativa_mod`, description: "Teste de iniciativa: dados atuais de Destreza e Intuição + modificador." }];
for (let i = 0; i < K.length; i++) for (let j = i; j < K.length; j++)
  actions.push({ key: `teste_${K[i]}_${K[j]}`, name: `Teste [${AB[K[i]]} + ${AB[K[j]]}]`, kind: "habilidade", formula: `${die(K[i])} + ${die(K[j])}`, description: `Rola os dados atuais de ${AB[K[i]]} e ${AB[K[j]]}.` });
return { pages: [{ width: PW, height: PH }, { width: PW, height: PH }, { width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da ficha de Fabula Ultima (PDF comum, 3 páginas paisagem): identidade, laços, atributos com dado atual calculado pelas condições, PV/PM/PI e crise automáticos, defesa, equipamento, 7 classes, habilidades heróicas, 19 feitiços e disciplinas de ritual; testes de atributo prontos." };
})()
