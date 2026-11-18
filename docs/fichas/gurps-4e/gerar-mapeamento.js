(() => {
// Ficha GURPS 4ª Edição (Devir, 2 páginas de 578,268 x 807,874 pt). Mesmo formato do editor (compactDoc).
const PW = 578.268, PH = 807.874, F = [];
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const DEF = [["role", null], ["page", 0], ["formula", null], ["default", null], ["min", null], ["max", null], ["maxLength", null], ["fontSize", 10], ["align", "left"]];
// As medidas foram feitas na MediaBox; a página visível (CropBox) começa 14,1732 pt à direita e no mesmo topo.
const OX = 14.1732;
function add(name, label, type, page, x, y, w, h, fs = 10, kw = {}) {
  x -= OX;
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
// Texto sobre uma linha impressa em L (base do texto 2 pt acima da linha).
const onLine = (name, label, type, page, x, L, w, fs, kw = {}) => add(name, label, type, page, x, L - 3 - 0.905 * fs, w, 1.2 * fs + 1, fs, kw);
// Número centrado numa caixa, com espaço para `digits` dígitos.
const num = (name, label, type, page, x, y, w, h, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  const [yy, hh] = boxed(y + h / 2, fs);
  add(name, label, type, page, left, yy, Math.min(w - 1, x + w - left - 0.5), hh, fs, kw);
};
// Custo entre colchetes impressos: interior x0..x1, centro vertical cy.
const cost = (name, label, type, page, x0, x1, cy, fs, kw = {}) => { const [yy, hh] = boxed(cy, fs); add(name, label, type, page, x0 + 0.5, yy, x1 - x0 - 0.5, hh, fs, kw); };
// Área de texto pautada sobre linhas impressas (primeira linha L0, passo step, n linhas).
const ruled = (name, label, page, x, L0, w, step, n, maxLength) => {
  const fs = Math.round((step / 1.2) * 100) / 100;
  add(name, label, "textarea", page, x, L0 - 3 - 0.905 * fs, w, step * (n - 1) + 1.2 * fs + 1, fs, { maxLength });
};
const N = (d = null, min = -9999, max = 9999) => ({ default: d, min, max });
const C = (formula) => ({ formula });
// ---------- Página 1 ----------
onLine("nome", "Nome", "text", 0, 210, 35.38, 135, 10, { role: "name", maxLength: 50 });
onLine("jogador", "Jogador", "text", 0, 390, 35.38, 75, 10, { maxLength: 40 });
onLine("total_pontos", "Total de pontos", "number", 0, 544, 35.38, 26, 10, N("150", 0, 99999));
onLine("altura", "Altura", "text", 0, 211, 51.88, 21, 8, { maxLength: 10 });
onLine("peso", "Peso", "text", 0, 258, 51.88, 27, 8, { maxLength: 10 });
onLine("mod_tamanho", "Modificador de tamanho", "text", 0, 372.5, 51.88, 26, 9, { maxLength: 6 });
onLine("idade", "Idade", "text", 0, 429, 51.88, 35, 9, { maxLength: 10 });
onLine("pontos_gastar", "Pontos para gastar (total − gastos)", "computed", 0, 544.5, 51.88, 25.5, 9, C("@total_pontos - (@resumo_atributos + @resumo_vantagens + @resumo_desvantagens + @resumo_pericias + @resumo_outros)"));
onLine("aparencia_fisica", "Aparência", "text", 0, 230, 68.38, 339, 9, { maxLength: 120 });
// Atributos (custo: ST/HT 10, DX/IQ 20 por nível)
const AT = [["st", "ST", 10], ["dx", "DX", 20], ["iq", "IQ", 20], ["ht", "HT", 10]];
const ROWY = [90.6, 126.5, 162.6, 199.0, 235.1];
AT.forEach(([k, l, c], i) => {
  num(k, l, "number", 0, 66.25, ROWY[i], 37, ROWY[i + 1] - ROWY[i], 20, N("10", 1, 99));
  cost(`${k}_custo`, `${l} — custo em pontos`, "computed", 0, 111.5, 130.5, (ROWY[i] + ROWY[i + 1]) / 2 - 1, 9, C(`(@${k} - 10) * ${c}`));
});
// Características secundárias
const SEC = [["pv", "PV (pontos de vida)", "st", 2, { role: "maxHp" }], ["vont", "Vontade", "iq", 5, {}], ["per", "Percepção", "iq", 5, { role: "perception" }], ["pf", "PF (pontos de fadiga)", "ht", 3, {}]];
SEC.forEach(([k, l, base, c, kw], i) => {
  num(k, l, "number", 0, 192, ROWY[i], 36.25, ROWY[i + 1] - ROWY[i], 20, { ...N("10", 0, 999), ...kw });
  cost(`${k}_custo`, `${l} — custo em pontos`, "computed", 0, 272, 290.75, (ROWY[i] + ROWY[i + 1]) / 2 - 1, 9, C(`(@${k} - @${base}) * ${c}`));
});
num("pv_atual", "PV atuais", "number", 0, 228.25, 90.6, 36, 35.9, 20, { role: "hp", ...N("10", -999, 999) });
num("pf_atual", "PF atuais", "number", 0, 228.25, 199, 36, 36.1, 20, N("10", -999, 999));
onLine("base_carga", "Base de carga (kg)", "computed", 0, 152, 251.12, 27, 9,
  C("if @st * @st / 10 >= 10 then round(@st * @st / 10) else round(@st * @st) / 10"));
onLine("dano_gdp", "Dano — golpe de ponta (GdP)", "text", 0, 233, 251.12, 23, 8, { maxLength: 10 });
onLine("dano_geb", "Dano — golpe em balanço (GeB)", "text", 0, 278, 251.12, 21, 8, { maxLength: 10 });
onLine("vel_basica", "Velocidade básica", "number", 0, 97, 264.5, 45, 9, N("5", 0, 99));
cost("vel_custo", "Velocidade básica — custo", "computed", 0, 147, 160, 259, 6.5, C("(@vel_basica - (@dx + @ht) / 4) * 20"));
onLine("desl_basico", "Deslocamento básico", "number", 0, 237.5, 264.5, 41, 9, { role: "movement", ...N("5", 0, 99) });
cost("desl_custo", "Deslocamento básico — custo", "computed", 0, 282.5, 296, 259, 6.5, C("(@desl_basico - floor(@vel_basica)) * 5"));
// Tabela de carga
[[0, 1, 1], [1, 2, 0.8], [2, 3, 0.6], [3, 6, 0.4], [4, 10, 0.2]].forEach(([n, mult, f], i) => {
  const L = [299.88, 313.25, 326.62, 340, 353.38][i], nm = ["Nenhuma", "Leve", "Média", "Pesada", "Muito pesada"][i];
  onLine(`carga_${n}`, `Carga ${nm} (${mult}×BC, kg)`, "computed", 0, 133, L, 29, 9, C(`@base_carga * ${mult}`));
  onLine(`desl_carga_${n}`, `Deslocamento com carga ${nm}`, "computed", 0, 201, L, 30, 9, C(n ? `max(1, floor(@desl_basico * ${f}))` : "@desl_basico"));
  onLine(`esquiva_${n}`, `Esquiva com carga ${nm}`, "computed", 0, 278, L, 20, 9, C(`max(1, floor(@vel_basica) + 3 - ${n})`));
});
// Línguas, NT e familiaridades culturais
const LANG = [109.75, 123.12, 136.5, 149.88, 163.38];
// "_itens": lista (ADR-098); falada e escrita seguem as mesmas linhas como colunas.
ruled("linguas_itens", "Línguas (uma por linha)", 0, 309, 109.75, 127, 13.4, 5, 300);
ruled("linguas_falada", "Línguas — falada (nível)", 0, 438, 109.75, 66, 13.4, 5, 200);
ruled("linguas_escrita", "Línguas — escrita (nível)", 0, 507, 109.75, 42, 13.4, 5, 200);
LANG.forEach((L, i) => cost(`li${i + 1}`, `Língua ${i + 1} — custo`, "number", 0, 555, 566.5, L - 5, 7, N(null, -99, 99)));
onLine("nt", "NT (nível tecnológico)", "text", 0, 385, 182, 163, 9, { maxLength: 40 });
cost("nt_custo", "NT — custo", "number", 0, 555, 566.5, 177, 7, N(null, -99, 99));
ruled("familiaridades_itens", "Familiaridades culturais (uma por linha)", 0, 368, 206.75, 180, 13.375, 3, 200);
[206.75, 220.12, 233.5].forEach((L, i) => cost(`fc${i + 1}`, `Familiaridade cultural ${i + 1} — custo`, "number", 0, 555, 566.5, L - 5, 7, N(null, -99, 99)));
add("rd", "RD (resistência a dano)", "textarea", 0, 307, 187, 52, 47, 10, { maxLength: 200 });
num("aparar", "Aparar", "text", 0, 305, 254, 56, 44, 16, { maxLength: 12 }, 3);
num("bloqueio", "Bloqueio", "text", 0, 305, 311, 56, 44, 16, { maxLength: 12 }, 3);
onLine("reacao_aparencia", "Modificador de reação — aparência", "text", 0, 421, 272.62, 148, 9, { maxLength: 60 });
onLine("reacao_status", "Modificador de reação — status", "text", 0, 397, 286, 172, 9, { maxLength: 60 });
onLine("reacao_reputacao", "Modificador de reação — reputação", "text", 0, 419, 299.38, 150, 9, { maxLength: 60 });
ruled("reacao_outros", "Outros modificadores de reação", 0, 368, 312.75, 201, 13.375, 4, 400);
// Vantagens, desvantagens e perícias (nomes em áreas pautadas, custos numéricos somados no resumo)
const ADV = Array.from({ length: 12 }, (_, i) => 386.12 + 15.4545 * i);
const DIS = Array.from({ length: 13 }, (_, i) => 587.12 + 15.4583 * i);
const SKL = Array.from({ length: 25 }, (_, i) => 401.75 + 15.4529 * i);
ruled("vantagens", "Vantagens e qualidades (uma por linha)", 0, 38, ADV[0], 227, 15.4545, 12, 1200);
ADV.forEach((L, i) => cost(`av${i + 1}`, `Vantagem ${i + 1} — custo`, "number", 0, 273.5, 293.5, L - 4.8, 9, N(null, -999, 999)));
ruled("desvantagens", "Desvantagens e peculiaridades (uma por linha)", 0, 38, DIS[0], 227, 15.4583, 13, 1300);
DIS.forEach((L, i) => cost(`dv${i + 1}`, `Desvantagem ${i + 1} — custo (negativo)`, "number", 0, 273.5, 293.5, L - 4.8, 9, N(null, -999, 999)));
ruled("pericias", "Perícias (uma por linha)", 0, 310, SKL[0], 138, 15.4529, 25, 2500);
ruled("pericias_nh", "Perícias — NH", 0, 452, SKL[0], 26, 15.4529, 25, 250);
ruled("pericias_relativo", "Perícias — NH relativo", 0, 486, SKL[0], 52, 15.4529, 25, 400);
SKL.forEach((L, i) => cost(`pc${i + 1}`, `Perícia ${i + 1} — custo`, "number", 0, 545, 565.5, L - 4.8, 9, N(null, -999, 999)));
// ---------- Página 2 ----------
onLine("nome_pagina_2", "Nome (página 2)", "text", 1, 64.5, 102.25, 96, 9, { maxLength: 50 });
const MEL = [["arma", "arma", 169, 103], ["dano", "dano", 274.5, 47], ["alcance", "alcance", 323.5, 40], ["aparar", "aparar", 365.5, 38], ["notas", "notas", 405.5, 60]];
MEL.forEach(([k, l, x, w]) => ruled(`cc_${k}`, `Armas corpo a corpo — ${l}`, 1, x, 62.88, w, 11.31, 5, 500));
ruled("cc_custo", "Armas corpo a corpo — custo", 1, 477, 62.88, 44, 11.31, 5, 200);
ruled("cc_peso", "Armas corpo a corpo — peso", 1, 525, 62.88, 44, 11.31, 5, 200);
const RAN = [["arma", "arma", 37.5, 102], ["dano", "dano", 141, 57], ["prec", "precisão", 199.5, 27.5], ["distancia", "distância", 228.5, 43], ["cdt", "CdT", 273.5, 22.5],
  ["tiros", "tiros", 297, 25], ["st", "ST", 323.2, 15], ["magnitude", "magnitude", 339.5, 47.5], ["rco", "RCO", 388, 27], ["cl", "CL", 416.5, 15.5], ["notas", "notas", 433.5, 32.5]];
RAN.forEach(([k, l, x, w]) => ruled(`ad_${k}`, `Armas à distância — ${l}`, 1, x, 152.12, w, 13.3889, 10, 800));
ruled("ad_custo", "Armas à distância — custo", 1, 477, 152.12, 44, 13.3889, 10, 300);
ruled("ad_peso", "Armas à distância — peso", 1, 525, 152.12, 44, 13.3889, 10, 300);
ruled("posses", "Armadura e posses — item (um por linha)", 1, 280, 316, 142, 13.392, 34, 3000);
ruled("posses_posicao", "Armadura e posses — posição", 1, 425, 316, 41, 13.392, 34, 1000);
ruled("posses_custo", "Armadura e posses — custo", 1, 477, 316, 44, 13.392, 34, 1000);
ruled("posses_peso", "Armadura e posses — peso", 1, 525, 316, 44, 13.392, 34, 1000);
onLine("total_custo", "Total — custo ($)", "text", 1, 486, 772, 31, 9, { maxLength: 12 });
onLine("total_peso", "Total — peso (kg)", "text", 1, 523, 772, 29, 9, { maxLength: 12 });
ruled("anotacoes", "Anotações do personagem", 1, 38, 563.38, 232, 13.39, 9, 3000);
// Resumo dos pontos (somas automáticas)
const sum = (p, n) => Array.from({ length: n }, (_, i) => `@${p}${i + 1}`).join(" + ");
cost("resumo_atributos", "Resumo — atributos e características secundárias", "computed", 1, 250.5, 266.5, 704, 6.5,
  C("@st_custo + @dx_custo + @iq_custo + @ht_custo + @pv_custo + @vont_custo + @per_custo + @pf_custo + @vel_custo + @desl_custo"));
cost("resumo_vantagens", "Resumo — vantagens, qualidades, NT, idiomas e familiaridades", "computed", 1, 250.5, 266.5, 730.6, 6.5, C(`${sum("av", 12)} + ${sum("li", 5)} + @nt_custo + ${sum("fc", 3)}`));
cost("resumo_desvantagens", "Resumo — desvantagens e peculiaridades", "computed", 1, 250.5, 266.5, 744.1, 6.5, C(sum("dv", 13)));
cost("resumo_pericias", "Resumo — perícias e técnicas", "computed", 1, 250.5, 266.5, 757.6, 6.5, C(sum("pc", 25)));
cost("resumo_outros", "Resumo — outros", "number", 1, 250.5, 266.5, 770.9, 6.5, N(null, -9999, 9999));
// ---------- Ações: testes 3d6 (margem de sucesso = atributo − 3d6) ----------
const T = (k, n, ref) => ({ key: `teste_${k}`, name: `Teste de ${n}`, kind: "habilidade", formula: `@${ref} - 3d6`, description: `Margem = ${n} − 3d6: 0 ou mais é sucesso (3–4 sempre crítico; 17–18 sempre falha).` });
const actions = [T("st", "ST", "st"), T("dx", "DX", "dx"), T("iq", "IQ", "iq"), T("ht", "HT", "ht"), T("vontade", "Vontade", "vont"), T("percepcao", "Percepção", "per"), T("esquiva", "Esquiva", "esquiva_0"),
  { key: "teste_3d6", name: "Rolagem 3d6", kind: "habilidade", formula: "3d6", description: "3d6 para testes de perícia (sucesso se ≤ NH) e reação." }];
return { pages: [{ width: PW, height: PH }, { width: PW, height: PH }], fields: F, actions,
  notes: "Mapeamento da planilha de personagem de GURPS 4ª Edição (Devir, 2 páginas): custos de atributos e características secundárias, base de carga, tabela de carga com deslocamento e esquiva, listas com custos somados no resumo dos pontos e pontos para gastar." };
})()
