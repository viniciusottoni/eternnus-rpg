(() => {
// Ficha Cyberpunk RED (3 páginas de 1920 x 1080 pt, paisagem). Mesmo formato do editor (compactDoc).
const PW = 1920, PH = 1080, F = [];
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
// Número centrado numa caixa (x, y, w, h) na altura cy.
const num = (name, label, type, page, x, w, cy, fs, kw = {}, digits = 2) => {
  const tw = 0.556 * fs * digits, left = Math.max(x + 1, x + w / 2 - tw / 2 - 1);
  line(name, label, type, page, left, cy, Math.min(w - 1, x + w - left - 0.5), fs, kw);
};
// Área pautada: n linhas de passo P a partir da linha r0 (altura da célula ch), fonte P / 1,2.
const ruled = (name, label, page, x, w, r0, ch, P, n, kw = {}) => {
  const fs = Math.round((P / 1.2) * 1e4) / 1e4;
  add(name, label, "textarea", page, x, r0 + ch / 2 - 0.6 * fs - 0.5, w, n * P + 1, fs, kw);
};
// ---------- Página 1 ----------
// Atributos (caixas de 100 x 75 com o rótulo no alto à esquerda).
const ST = [["int", "INT (Inteligência)", 35], ["ref", "REF (Reflexos)", 115], ["des", "DES (Destreza)", 195], ["tec", "TEC (Técnica)", 275], ["cool", "COOL (Frieza)", 355],
  ["fvo", "FVO (Força de Vontade)", 435], ["sor", "SOR (Sorte) — pontos atuais", 515], ["mov", "MOV (Movimento)", 595], ["tco", "TCO (Tipo Corporal)", 675], ["emp", "EMP (Empatia) — atual", 755]];
for (const [k, l, y] of ST) {
  const half = k === "sor" || k === "emp";
  if (k === "emp") num("emp", `${l} (Humanidade ÷ 10)`, "computed", 0, 420, 55, y + 47, 32, { formula: "if @humanidade > 0 then min(@emp_max, floor(@humanidade / 10)) else @emp_max" });
  else num(k, l, "number", 0, 420, half ? 55 : 100, y + 47, 32, { min: 0, max: 20, ...(k === "mov" ? { role: "movement" } : {}) });
  if (half) num(`${k}_max`, k === "sor" ? "SOR — máximo" : "EMP — base (máximo)", "number", 0, 480, 40, y + 55, 22, { min: 0, max: 20 });
}
line("nome", "Nome", "text", 0, 40, 331, 355, 20, { role: "name", maxLength: 40 });
line("papel", "Papel", "text", 0, 40, 381, 355, 20, { maxLength: 40 });
line("habilidade_papel", "Habilidade do papel", "text", 0, 40, 431, 272, 20, { maxLength: 40 });
num("nivel", "Nível da habilidade do papel", "number", 0, 320, 80, 431, 22, { role: "level", default: "1", min: 1, max: 10 });
add("notas", "Notas", "textarea", 0, 40, 466, 355, 255, 14, { maxLength: 4000 });
num("humanidade", "Humanidade", "number", 0, 35, 180, 795, 32, { min: 0, max: 200 }, 3);
num("humanidade_max", "Humanidade — máxima (EMP × 10)", "computed", 0, 220, 180, 795, 32, { formula: "@emp_max * 10" }, 3);
num("pv", "Pontos de vida", "number", 0, 35, 120, 884, 22, { role: "hp", min: -99, max: 999 }, 3);
num("pv_max", "Pontos de vida — máximo", "computed", 0, 160, 115, 884, 22, { role: "maxHp", formula: "10 + 5 * floor((@tco + @fvo + 1) / 2)" });
num("gravemente_ferido", "Gravemente ferido (metade dos PV)", "computed", 0, 35, 240, 937, 24, { formula: "floor((@pv_max + 1) / 2)" });
num("resistencia_morte", "Resistência à morte (TCO)", "computed", 0, 35, 240, 1027, 24, { formula: "@tco" });
add("lesoes", "Lesões críticas", "textarea", 0, 285, 867, 230, 78, 14, { maxLength: 600 });
add("vicios", "Vícios", "textarea", 0, 285, 972, 230, 68, 14, { maxLength: 600 });
// Perícias: nível digitado e base calculada (nível + atributo). A coluna ATR fica em branco (o atributo já está no nome).
const SK = [
  // coluna 1
  [1, "concentracao", "Concentração", "fvo", 62.5], [1, "ocultar_revelar", "Ocultar/Revelar Objeto", "int", 89.5], [1, "leitura_labial", "Leitura Labial", "int", 117],
  [1, "percepcao", "Percepção", "int", 144], [1, "rastrear", "Rastrear", "int", 171.5],
  [1, "atletismo", "Atletismo", "des", 225.5], [1, "contorcionismo", "Contorcionismo", "des", 253], [1, "dancar", "Dançar", "des", 280],
  [1, "resistencia", "Resistência", "fvo", 307.5], [1, "resistencia_tortura", "Resistência à Tortura/Drogas", "fvo", 334.5], [1, "furtividade", "Furtividade", "des", 362],
  [1, "dirigir", "Dirigir Veículo Terrestre", "ref", 416.5], [1, "pilotar_aereo", "Pilotar Veículo Aéreo", "ref", 443.5], [1, "pilotar_maritimo", "Pilotar Veículo Marítimo", "ref", 471],
  [1, "motocicleta", "Motocicleta", "ref", 498],
  [1, "contabilidade", "Contabilidade", "int", 552.5], [1, "lidar_animais", "Lidar com Animais", "int", 580], [1, "burocracia", "Burocracia", "int", 607],
  [1, "negocios", "Negócios", "int", 634], [1, "composicao", "Composição", "int", 661.5], [1, "criminologia", "Criminologia", "int", 688.5],
  [1, "criptografia", "Criptografia", "int", 716], [1, "deducao", "Dedução", "int", 743], [1, "educacao", "Educação", "int", 770.5], [1, "apostar", "Apostar", "int", 798],
  // coluna 2 (linhas com "*" têm nome digitado)
  [2, "idioma_ruas", "Idioma: Idioma das Ruas", "int", 89.5], [2, "idioma_2", "*Idioma 2", "int", 117], [2, "idioma_3", "*Idioma 3", "int", 144],
  [2, "pesquisa_biblioteca", "Pesquisa em Biblioteca", "int", 171.5],
  [2, "especialista_casa", "Especialista Local: Sua casa", "int", 225.5], [2, "especialista_2", "*Especialista Local 2", "int", 253], [2, "especialista_3", "*Especialista Local 3", "int", 280],
  [2, "ciencia_1", "*Ciência 1", "int", 334.5], [2, "ciencia_2", "*Ciência 2", "int", 362],
  [2, "estrategia", "Estratégia", "int", 389], [2, "sobrevivencia", "Sobrevivência", "int", 416.5],
  [2, "briga", "Briga", "des", 471], [2, "evasao", "Evasão", "des", 498], [2, "artes_marciais", "Artes Marciais", "des", 525.5], [2, "armas_brancas", "Armas Brancas", "des", 552.5],
  [2, "atuacao", "Atuação", "cool", 607], [2, "instrumento_1", "*Tocar Instrumento 1", "tec", 661.5], [2, "instrumento_2", "*Tocar Instrumento 2", "tec", 688.5],
  [2, "arqueirismo", "Arqueirismo", "ref", 743], [2, "automatica", "Automática", "ref", 770.5], [2, "armas_curtas", "Armas Curtas", "ref", 798],
  // coluna 3
  [3, "armas_pesadas", "Armas Pesadas", "ref", 62.5], [3, "fuzil", "Fuzil", "ref", 89.5],
  [3, "suborno", "Suborno", "cool", 144], [3, "oratoria", "Oratória", "emp", 171.5], [3, "percepcao_humana", "Percepção Humana", "emp", 198.5],
  [3, "interrogatorio", "Interrogatório", "cool", 225.5], [3, "persuasao", "Persuasão", "cool", 253], [3, "cuidados_pessoais", "Cuidados Pessoais", "cool", 280],
  [3, "malandragem", "Malandragem", "cool", 307.5], [3, "negociacao", "Negociação", "cool", 334.5], [3, "roupa_estilo", "Roupa e Estilo", "cool", 362],
  [3, "tec_aereos", "Tecnologia de Veículos Aéreos", "tec", 416.5], [3, "tecnologia_basica", "Tecnologia Básica", "tec", 443.5], [3, "cibertecnologia", "Cibertecnologia", "tec", 471],
  [3, "demolicoes", "Demolições", "tec", 498], [3, "eletronica_seguranca", "Eletrônica/Tec. de Segurança", "tec", 525.5], [3, "primeiros_socorros", "Primeiros Socorros", "tec", 552.5],
  [3, "falsificacao", "Falsificação", "tec", 580], [3, "tec_terrestre", "Tecnologia de Veículo Terrestre", "tec", 607], [3, "pintar_desenhar", "Pintar/Desenhar/Esculpir", "tec", 634],
  [3, "medicamentos", "Medicamentos", "tec", 661.5], [3, "fotografia_filmagem", "Fotografia e Filmagem", "tec", 688.5], [3, "arrombamento", "Arrombamento", "tec", 716],
  [3, "furto", "Furto", "tec", 743], [3, "tec_maritimo", "Tecnologia de Veículo Marítimo", "tec", 770.5], [3, "tec_armas", "Tecnologia de Armas/Armeiro", "tec", 798],
];
const COLX = { 1: 800.5, 2: 1255.5, 3: 1710.5 };
const actions = [];
for (const [c, k, raw, st, y] of SK) {
  const typed = raw.startsWith("*"), l = typed ? raw.slice(1) : raw, S = st.toUpperCase(), cy = y + 11;
  if (typed) line(`${k}_nome`, `${l} — nome`, "text", 0, 1033, cy, 216, 14, { maxLength: 30 });
  num(`${k}_nvl`, `${l} (${S}) — nível`, "number", 0, COLX[c], 55, cy, 16, { min: 0, max: 10 });
  num(`${k}_base`, `${l} — base (nível + ${S})`, "computed", 0, COLX[c] + 119.5, 55, cy, 16, { formula: `@${k}_nvl + @${st}`, ...(k === "percepcao" ? { role: "perception" } : {}) });
  actions.push({ key: k, name: l, kind: "habilidade", formula: `1d10 + @${k}_base`, description: `${S} + nível + 1d10.` });
}
// Armadura (4 linhas) e armas (6 linhas).
[900, 930, 960, 990].forEach((y, i) => {
  const cy = y + 12.5, n = i + 1;
  line(`armadura_${n}`, `Armadura ${n}`, "text", 0, 545, cy, 262, 16, { maxLength: 40 });
  num(`armadura_${n}_pb`, `Armadura ${n} — PB`, "number", 0, 815, 80, cy, 18, { min: 0, max: 99, ...(n === 1 ? { role: "armor" } : {}) });
  num(`armadura_${n}_penalidade`, `Armadura ${n} — penalidade`, "number", 0, 900, 95, cy, 18, { min: -9, max: 9 });
});
[870, 900, 930, 960, 990, 1020].forEach((y, i) => {
  const cy = y + 12.5, n = i + 1;
  line(`arma_${n}`, `Arma ${n}`, "text", 0, 1005, cy, 247, 16, { maxLength: 40 });
  line(`arma_${n}_dano`, `Arma ${n} — dano`, "text", 0, 1265, cy, 77, 16, { maxLength: 10 });
  line(`arma_${n}_municao`, `Arma ${n} — munição`, "text", 0, 1355, cy, 92, 16, { maxLength: 15 });
  num(`arma_${n}_cdt`, `Arma ${n} — CDT`, "number", 0, 1455, 75, cy, 18, { min: 0, max: 9 });
  line(`arma_${n}_notas`, `Arma ${n} — notas`, "text", 0, 1540, cy, 342, 16, { maxLength: 60 });
});
// ---------- Página 2 ----------
line("aliados", "Aliados", "text", 1, 40, 63, 905, 16, { maxLength: 120 });
num("pe", "Pontos de experiência", "number", 1, 35, 200, 107, 18, { min: 0, max: 9999 }, 4);
num("pe_total", "Pontos de experiência — total", "number", 1, 240, 200, 107, 18, { min: 0, max: 9999 }, 4);
num("reputacao", "Reputação", "number", 1, 35, 405, 152, 18, { min: 0, max: 10 });
add("eventos_reputacao", "Eventos de reputação", "textarea", 1, 450, 97, 495, 66, 14, { maxLength: 600 });
const FL = [["origens", "Origens culturais"], ["personalidade", "Personalidade"], ["estilo_roupas", "Estilo das roupas"], ["estilo_cabelo", "Estilo do cabelo"],
  ["mais_valoriza", "O que você mais valoriza?"], ["opiniao_pessoas", "Opinião em relação à maioria das pessoas"], ["pessoa_valoriza", "Pessoa que mais valoriza"],
  ["objeto_valoriza", "Objeto que mais valoriza"], ["antecedente_familiar", "Antecedente familiar"], ["ambiente_infancia", "Ambiente da sua infância"],
  ["tragedia_familiar", "Tragédia familiar"], ["objetivo_vida", "Objetivo de vida"]];
FL.forEach(([k, l], i) => add(k, l, "textarea", 1, i % 2 ? 500 : 40, 220 + 65 * Math.floor(i / 2) + 17, 445, 40, 16, { maxLength: 200 }));
[635, 700, 765].forEach((y, i) => {
  add(`amigo_${i + 1}`, `Amigo ${i + 1}`, "textarea", 1, 85, y + 8, 400, 45, 16, { maxLength: 150 });
  add(`amor_tragico_${i + 1}`, `Amor trágico ${i + 1}`, "textarea", 1, 545, y + 8, 400, 45, 16, { maxLength: 150 });
});
[855, 920, 985].forEach((y, i) => {
  const n = i + 1, kw = { maxLength: 150 };
  add(`inimigo_${n}`, `Inimigo ${n} — quem?`, "textarea", 1, 135, y + 4, 165, 52, 14, kw);
  add(`inimigo_${n}_causa`, `Inimigo ${n} — o que causou isso?`, "textarea", 1, 315, y + 4, 170, 52, 14, kw);
  add(`inimigo_${n}_confronto`, `Inimigo ${n} — como pode te confrontar?`, "textarea", 1, 500, y + 4, 260, 52, 14, kw);
  add(`inimigo_${n}_desfecho`, `Inimigo ${n} — o que vai acontecer?`, "textarea", 1, 775, y + 4, 170, 52, 14, kw);
});
ruled("equipamento", "Equipamento (um item por linha)", 1, 975, 240, 65, 25, 30, 19, { maxLength: 1500 });
ruled("equipamento_notas", "Equipamento — notas (uma por linha)", 1, 1230, 650, 65, 25, 30, 19, { maxLength: 3000 });
line("municao", "Munição", "text", 1, 1230, 647.5, 650, 16, { maxLength: 100 });
line("dinheiro", "Dinheiro", "text", 1, 1230, 677.5, 650, 16, { maxLength: 40 });
add("moda_estilo", "Moda/estilo", "textarea", 1, 975, 727, 905, 66, 16, { maxLength: 500 });
line("habitacao", "Habitação", "text", 1, 975, 843, 395, 16, { maxLength: 60 });
line("aluguel", "Aluguel", "text", 1, 1385, 843, 185, 16, { maxLength: 20 });
line("estilo_vida", "Estilo de vida", "text", 1, 1585, 843, 295, 16, { maxLength: 40 });
add("fluxovida_papel", "Fluxovida específico do papel", "textarea", 1, 975, 893, 905, 148, 16, { maxLength: 2000 });
// ---------- Página 3 (cyberware) ----------
const CW = [["neural", "Equipamento neural", 855, 1065, 235, 5, 1020, 200], ["audio", "Ciberáudio", 35, 245, 305, 3, 200, 270],
  ["olho_esq", "Ciberóptico esquerdo", 35, 245, 460, 3, 200, 425], ["olho_dir", "Ciberóptico direito", 855, 1065, 460, 3, 1020, 425],
  ["braco_esq", "Ciberbraço esquerdo", 35, 245, 615, 4, 200, 580], ["braco_dir", "Ciberbraço direito", 855, 1065, 615, 4, 1020, 580],
  ["perna_esq", "Ciberperna esquerda", 35, 245, 805, 3, 200, 770], ["perna_dir", "Ciberperna direita", 855, 1065, 805, 3, 1020, 770],
  ["interno", "Cyberware interno", 1380, 1590, 70, 7], ["externo", "Cyberware externo", 1380, 1590, 325, 7],
  ["cibermoda", "Cibermoda", 1380, 1590, 580, 7], ["borgware", "Borgware", 1380, 1590, 835, 7]];
for (const [k, l, xn, xd, r0, n, bx, by] of CW) {
  const big = bx !== undefined, P = big ? 35 : 30, ch = big ? 30 : 25;
  if (big) num(`cw_${k}_base`, `${l} — base instalada`, "checkbox", 2, bx, 40, by + 15, 22, {}, 1);
  // Nome com "equip": o site reconhece a tabela como lista (um item por linha, com descrição por item; ADR-098).
  ruled(`equip_${k}`, `${l} (um por linha)`, 2, xn + 5, 195, r0, ch, P, n, { maxLength: 400 });
  ruled(`equip_${k}_dados`, `${l} — dados (um por linha)`, 2, xd + 5, 285, r0, ch, P, n, { maxLength: 600 });
}
// ---------- Ações extras ----------
actions.push(
  { key: "iniciativa", name: "Iniciativa", kind: "habilidade", formula: "1d10 + @ref", description: "REF + 1d10." },
  { key: "teste_morte", name: "Teste de Resistência à Morte", kind: "habilidade", formula: "1d10", description: "Sucesso se o resultado for menor que a Resistência à Morte." },
  { key: "d10", name: "Rolagem 1d10", kind: "habilidade", formula: "1d10", description: "1d10 genérico." },
);
return { pages: [0, 1, 2].map(() => ({ width: PW, height: PH })), fields: F, actions,
  notes: "Mapeamento da ficha de Cyberpunk RED (3 páginas): atributos, PV e humanidade calculados, 72 perícias com nível e base (nível + atributo), armadura, armas, fluxovida, equipamento e cyberware (áreas pautadas, um item por linha)." };
})()
