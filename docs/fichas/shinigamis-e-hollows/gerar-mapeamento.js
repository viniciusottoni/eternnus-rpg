(() => {
// Ficha Shinigamis & Hollows (PDF comum, 6 páginas de 612 x 792 pt; a 6ª só tem notas). Mesmo formato do editor (compactDoc).
// Limite de 300 campos: perícias com T, E e Total (sem "Outros"); cada cartão de técnica com nome, nível, conjuração e descrição.
// Listas (ADR-098): habilidades, ataques, treinamentos, inventário, aptidões e kidos conhecidos, com uma caixa por linha e descrição por item.
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
const num = (name, label, type, page, x, w, cy, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  line(name, label, type, page, left, cy, Math.min(w - 1, x + w - left - 0.5), fs, kw);
};
const check = (name, label, page, cx, cy, fs) => num(name, label, "checkbox", page, cx - 0.5 * fs, fs, cy, fs, {}, 1);
// Lista em tabela: células de altura ch, passo P a partir do topo r0; fonte P / 1,2.
const ruled = (name, label, page, x, r0, ch, w, P, n, max) => {
  const fs = Math.round((P / 1.2) * 1e4) / 1e4;
  add(name, label, "textarea", page, x, r0 + ch / 2 - 0.6 * fs - 0.5, w, n * P + 1, fs, { maxLength: max });
};
const S = 6.5; // fonte das caixas pequenas (linhas de 8 pt)
const actions = [];

// ---------- Página 1 ----------
line("nome", "Nome", "text", 0, 240, 70.75, 101, 8, { role: "name", maxLength: 40 });
line("jogador", "Jogador", "text", 0, 240, 83.5, 101, S, { maxLength: 30 });
line("origem", "Origem", "text", 0, 375.5, 66.5, 60, S, { maxLength: 30 });
line("divisao", "Divisão", "text", 0, 375.5, 75, 60, S, { maxLength: 30 });
line("classe", "Classe", "text", 0, 375.5, 83.5, 60, S, { maxLength: 30 });
num("nivel", "Nível", "number", 0, 447.5, 20, 79.25, 9, { role: "level", default: "1", min: 1, max: 99 });
num("bonus", "Bônus", "number", 0, 478.5, 20.5, 79.25, 9, { min: -99, max: 99 });
[["forca", "FOR", 92.5, 104.5], ["inteligencia", "INT", 155, 104.5], ["destreza", "DES", 92.5, 121.5],
  ["sabedoria", "SAB", 155, 121.5], ["constituicao", "CON", 92.5, 138.5], ["carisma", "CAR", 155, 138.5]]
  .forEach(([k, l, x, y]) => num(k, `Atributo ${l}`, "number", 0, x, 20.5, y + 4, S, { min: -99, max: 99 }));
[["zanjutsu", "Zanjutsu", 61], ["hakuda", "Hakuda", 92.5], ["hoho", "Hoho", 123.5], ["kido", "Kido", 155]]
  .forEach(([k, l, x]) => num(`caminho_${k}`, `Nível em caminho — ${l}`, "number", 0, x, 20.5, 176, S, { min: 0, max: 99 }));
ruled("habilidades_classe_talentos", "Habilidades de classe e talentos (uma por linha)", 0, 62, 197.5, 8, 122.5, (341 - 197.5) / 17, 18, 2000);
// Pontos de vida e de reiryoku
[["pv_max", "Pontos de vida — máximos", 196.5, "maxHp"], ["pv", "Pontos de vida — atuais", 238.5, "hp"], ["pv_temp", "Pontos de vida — temporários", 280],
  ["pr_max", "Pontos de reiryoku — máximos", 322], ["pr", "Pontos de reiryoku — atuais", 363.5], ["pr_temp", "Pontos de reiryoku — temporários", 405.5]]
  .forEach(([k, l, x, role]) => num(k, l, "number", 0, x, 31, 129.75, 12, { role, min: -999, max: 9999 }, 3));
// Esquiva: total = 10 + parcelas
num("esquiva", "Esquiva — total (10 + DES + armadura + escudo + nível + outros)", "computed", 0, 196.5, 31, 188.75, 12,
  { role: "armor", formula: "10 + @esquiva_des + @esquiva_armadura + @esquiva_escudo + @esquiva_nivel + @esquiva_outros" });
[["des", "DES", 259.5, 180.5], ["armadura", "armadura", 290.5, 180.5], ["escudo", "escudo", 228, 197.5], ["nivel", "nível", 259.5, 197.5], ["outros", "outros", 290.5, 197.5]]
  .forEach(([k, l, x, y]) => num(`esquiva_${k}`, `Esquiva — ${l}`, "number", 0, x, 20.5, y + 4, S, { min: -99, max: 99 }));
[["fortitude", "Fortitude", 322], ["reflexos", "Reflexos", 363.5], ["vontade", "Vontade", 405.5]].forEach(([k, l, x]) => {
  num(k, `Salvaguarda — ${l}`, "number", 0, x, 31, 188.75, 12, { min: -99, max: 99 });
  actions.push({ key: `teste_${k}`, name: `Salvaguarda de ${l}`, kind: "habilidade", formula: `1d20 + @${k}`, description: `1d20 + ${l}.` });
});
[["caminhada", "caminhada", 196.5, "movement"], ["escalada", "escalada", 238.5], ["voo", "voo", 280]]
  .forEach(([k, l, x, role]) => num(`deslocamento_${k}`, `Deslocamento — ${l}`, "number", 0, x, 31, 235, S, { role, min: 0, max: 999 }, 3));
add("percepcao_sentidos", "Percepção e sentidos", "textarea", 0, 323, 224, 112, 14.5, S, { maxLength: 200 });
[["classe", "classe", 196.5], ["conjuracao", "conjuração", 238.5], ["manejo", "manejo", 280]]
  .forEach(([k, l, x]) => num(`cd_${k}`, `Classe de dificuldade — ${l}`, "number", 0, x, 31, 269, S, { min: 0, max: 99 }));
line("dureza", "Dureza", "text", 0, 355, 260.5, 80, S, { maxLength: 40 });
line("resistencias_imunidades", "Resistências/imunidades", "text", 0, 355, 269, 80, S, { maxLength: 60 });
// Ataques (lista em tabela; as colunas seguem as linhas da arma)
const A = (k, l, x, w, max) => ruled(k, l, 0, x + 1, 298.5, 8, w - 2, 8.5, 6, max);
A("ataque_armas", "Ataques — arma (uma por linha)", 196.5, 41.5, 300);
A("ataque_bonus", "Ataques — bônus", 238.5, 20.5, 60);
A("ataque_dano", "Ataques — dano", 259.5, 41, 120);
A("ataque_critico", "Ataques — crítico", 301, 20.5, 60);
A("ataque_tipo", "Ataques — tipo", 322, 31, 80);
A("ataque_alcance", "Ataques — alcance", 353.5, 30.5, 80);
A("ataque_tracos", "Ataques — traços", 384.5, 52, 200);
// Perícias: T (treinada), E (especialista) e total
const PER = [["acrobacia", "Acrobacia"], ["atletismo", "Atletismo"], ["conhecimento_1", "Conhecimento 1"], ["conhecimento_2", "Conhecimento 2"],
  ["conhecimento_3", "Conhecimento 3"], ["direcao", "Direção"], ["enganacao", "Enganação"], ["espiritualismo", "Espiritualismo"],
  ["furtividade", "Furtividade"], ["intimidacao", "Intimidação"], ["intuicao", "Intuição"], ["investigacao", "Investigação"],
  ["medicina", "Medicina"], ["ocultismo", "Ocultismo"], ["oficio_1", "Ofício 1"], ["oficio_2", "Ofício 2"], ["percepcao", "Percepção"],
  ["performance", "Performance"], ["persuasao", "Persuasão"], ["prestidigitacao", "Prestidigitação"], ["sobrevivencia", "Sobrevivência"],
  ["tatica", "Tática"], ["tecnologia", "Tecnologia"]];
PER.forEach(([k, l], i) => {
  const cy = 113 + ((298.5 - 113) / 22) * i + 4;
  check(`${k}_treinada`, `${l} — treinada (T)`, 0, 494, cy, 6);
  check(`${k}_especialista`, `${l} — especialista (E)`, 0, 504.5, cy, 6);
  num(k, `${l} — total`, "number", 0, 531, 20, cy, S, { min: -99, max: 99, ...(k === "percepcao" ? { role: "perception" } : {}) });
  actions.push({ key: `teste_${k}`, name: l, kind: "habilidade", formula: `1d20 + @${k}`, description: `1d20 + total de ${l}.` });
});
add("treinamentos_itens", "Treinamentos (um por linha)", "textarea", 0, 449, 325, 100, 3 * 1.2 * 6.5 + 1, S, { maxLength: 500 });

// ---------- Página 2: inventário ----------
const INV = (n, x0) => {
  const R = (k, l, x, w, max) => ruled(k, l, 1, x + 1, 98, 10.5, w - 2, (350 - 98) / 23, 24, max);
  R(`inventario_itens_${n}`, `Inventário ${n} — item (um por linha)`, x0, 135, 1500);
  R(`inventario_quant_${n}`, `Inventário ${n} — quantidade`, x0 + 135.5, 27, 200);
  R(`inventario_peso_${n}`, `Inventário ${n} — peso`, x0 + 163, 26.5, 200);
  R(`inventario_custo_${n}`, `Inventário ${n} — valor`, x0 + 190, 45, 300);
};
INV(1, 64); INV(2, 313);
line("peso_carregado", "Peso carregado", "text", 1, 202, 377.25, 95, 8, { maxLength: 20 });
line("peso_maximo", "Peso máximo", "text", 1, 451.5, 377.25, 95, 8, { maxLength: 20 });

// ---------- Página 3: perfil espiritual ----------
line("zanpakuto", "Zanpakuto", "text", 2, 108, 98.75, 107, 8, { maxLength: 40 });
line("forma_selada", "Forma selada", "text", 2, 108, 112.25, 107, S, { maxLength: 60 });
line("shikai_nome", "Shikai — nome", "text", 2, 108, 139.25, 107, S, { maxLength: 40 });
line("shikai_forma", "Shikai — forma", "text", 2, 108, 148.25, 107, S, { maxLength: 60 });
add("shikai_funcionamento", "Funcionamento de shikai", "textarea", 2, 63, 163.5, 152, 42, 7, { maxLength: 1500 });
line("bankai_nome", "Bankai — nome", "text", 2, 108, 229, 107, S, { maxLength: 40 });
line("bankai_forma", "Bankai — forma", "text", 2, 108, 237.75, 107, S, { maxLength: 60 });
add("bankai_funcionamento", "Funcionamento de bankai", "textarea", 2, 63, 253, 152, 42, 7, { maxLength: 1500 });
ruled("aptidoes_itens", "Aptidões espirituais (uma por linha)", 2, 230, 99, 8.5, 152, (251.5 - 99) / 17, 18, 1500);
ruled("kidos_itens", "Kidos conhecidos (um por linha)", 2, 397, 99, 8.5, 152, (251.5 - 99) / 17, 18, 1500);

// ---------- Páginas 4 e 5: cartões de técnicas de manejo e de kido ----------
const XS = [62, 187, 312, 437], YS = [127.5, 228.5, 329.5, 430.5, 531.5];
const card = (page, base, label, n, x0, yb) => {
  const k = `${base}_${n}`, L = `${label} ${n}`;
  line(k, `${L} — nome`, "text", page, x0 + 24, yb - 32.25, 88, S, { maxLength: 40 });
  line(`${k}_nivel`, `${L} — nível`, "text", page, x0 + 24, yb - 23.25, 20, S, { maxLength: 6 });
  line(`${k}_execucao`, `${L} — conjuração`, "text", page, x0 + 69.5, yb - 23.25, 43, S, { maxLength: 20 });
  add(`${k}_descricao`, `${L} — descrição (alcance, alvo, duração e efeito)`, "textarea", page, x0 + 2, yb + 1.5, 109, 51.5, S, { maxLength: 1200 });
};
YS.forEach((yb, r) => XS.forEach((x0, c) => card(3, "tecnica", "Técnica de manejo", r * 4 + c + 1, x0, yb)));
YS.forEach((yb, r) => XS.forEach((x0, c) => card(4, "magia_kido", "Kido", r * 4 + c + 1, x0, yb)));

return { pages: Array.from({ length: 6 }, () => ({ width: PW, height: PH })), fields: F, actions,
  notes: "Mapeamento da ficha de Shinigamis & Hollows (6 páginas): atributos, PV e reiryoku, esquiva calculada, salvaguardas, perícias (T, E e total), ataques, inventário, perfil espiritual e 40 cartões de técnicas (manejo e kido). Listas com uma caixa por linha e descrição por item." };
})()
