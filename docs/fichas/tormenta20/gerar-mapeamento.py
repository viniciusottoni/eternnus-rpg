"""Gera o documento da versão (pages/fields/actions/notes) da ficha Tormenta20 no MESMO formato
que o editor de fichas-modelo do Eternnus envia no PUT do rascunho (compactDoc em sheet-editor-policy.js).
Coordenadas medidas em pontos PDF sobre a página 581,1 x 779,53 e normalizadas (0..1, origem no topo)."""
import json, sys

PW, PH = 581.1, 779.53
fields = []


def r6(v):
    return round(v + 0.0, 5)


def add(name, label, type_, page, x, y, w, h, fs=10, **kw):
    f = {"name": name, "label": label, "type": type_,
         "x": r6(x / PW), "y": r6(y / PH), "w": r6(w / PW), "h": r6(h / PH)}
    # mesma ordem/omissões de compactField: só grava o que difere do padrão
    for key, fallback in (("role", None), ("page", 0), ("formula", None), ("default", None), ("min", None),
                          ("max", None), ("maxLength", None), ("fontSize", 10), ("align", "left")):
        value = {"page": page, "fontSize": fs}.get(key, kw.get(key))
        if value is None or value == "" or value == fallback:
            continue
        f[key] = value
    if type_ == "select":
        f["options"] = kw["options"]
    if type_ != "computed":
        f.pop("formula", None)
    fields.append(f)
    return f


def on_line(L, fs):
    """Caixa de uma linha cujo texto assenta ~2 pt acima da linha impressa L (texto exportado começa no topo da caixa)."""
    return L - 4.0 - 0.905 * fs, 1.2 * fs + 1.0


def boxed(cy, fs):
    h = 1.2 * fs + 1.0
    return cy - h / 2, h


# ---------------- Página 1 ----------------
# Cabeçalho
add("jogador", "Jogador", "text", 0, 261, 43.5, 133, 14.5, 11, maxLength=80)
add("personagem", "Personagem", "text", 0, 36, 35.5, 202, 20.5, 16, role="name", maxLength=100)
y, h = boxed(76, 11)
add("raca", "Raça", "text", 0, 111, y, 76, h, 11, maxLength=60)
add("origem", "Origem", "text", 0, 198, y, 100, h, 11, maxLength=60)
add("classe", "Classe", "text", 0, 310, y, 112, h, 11, maxLength=80)
add("nivel", "Nível", "number", 0, 428, y, 30, h, 11, role="level", default="1", min=1, max=20, align="center")
add("divindade", "Divindade", "text", 0, 471, y, 84, h, 11, maxLength=60)

# Atributos (valor no corpo do brasão, modificador no círculo)
ATTRS = [("forca", "Força", "FOR"), ("destreza", "Destreza", "DES"), ("constituicao", "Constituição", "CON"),
         ("inteligencia", "Inteligência", "INT"), ("sabedoria", "Sabedoria", "SAB"), ("carisma", "Carisma", "CAR")]
CENTERS = [46.0, 102.6, 159.2, 216.0, 273.2, 329.4]
ABBR = {}
for (key, label, abbr), cx in zip(ATTRS, CENTERS):
    ABBR[abbr] = key
    add(key, label, "number", 0, cx - 13, 112, 32, 24, 18, default="10", min=0, max=99, align="center")
for (key, label, abbr), cx in zip(ATTRS, CENTERS):
    add(key + "_mod", "Mod. " + label, "computed", 0, cx - 7, 141, 18, 14, 11, formula=f"mod(@{key})", align="center")

# Pontos de vida / mana
add("pv_max", "PV máximos", "number", 0, 30, 179, 36, 20, 16, role="maxHp", default="10", min=1, max=9999, align="center")
add("pv_atual", "PV atuais", "number", 0, 82, 178, 90, 22, 18, role="hp", default="10", min=0, max=9999, align="center")
add("pm_max", "PM máximos", "number", 0, 201, 179, 36, 20, 16, min=0, max=9999, align="center")
add("pm_atual", "PM atuais", "number", 0, 253, 178, 92, 22, 18, min=0, max=9999, align="center")

# Ataques (5 linhas impressas)
ATK_LINES = [265.5, 286.8, 308.0, 329.5, 350.8]
ATK_COLS = [("nome", "nome", 31, 93, 60), ("teste", "teste de ataque", 133, 36, 20), ("dano", "dano", 178, 37, 30),
            ("critico", "crítico", 224, 36, 20), ("tipo", "tipo", 269, 34, 20), ("alcance", "alcance", 312, 39, 20)]
for i, L in enumerate(ATK_LINES, 1):
    y, h = on_line(L, 9)
    for col, desc, x, w, ml in ATK_COLS:
        add(f"ataque_{i}_{col}", f"Ataque {i} — {desc}", "text", 0, x, y, w, h, 9, maxLength=ml)

# Defesa = 10 + Des + armadura + escudo + outros
add("defesa", "Defesa", "computed", 0, 30, 404, 32, 22, 18, role="armor",
    formula="10 + @defesa_des + @defesa_armadura + @defesa_escudo + @defesa_outros", align="center")
y, h = on_line(422.5, 10)
add("defesa_des", "Defesa — mod. de Destreza", "computed", 0, 97, y, 19, h, 10, formula="@destreza_mod", align="center")
add("defesa_armadura", "Defesa — bônus de armadura", "computed", 0, 125, y, 19, h, 10, formula="@armadura_defesa", align="center")
add("defesa_escudo", "Defesa — bônus de escudo", "computed", 0, 153, y, 19, h, 10, formula="@escudo_defesa", align="center")
add("defesa_outros", "Defesa — outros", "number", 0, 181, y, 22, h, 10, default="0", min=-99, max=99, align="center")
y, h = on_line(437.0, 10)
add("penalidade_armadura", "Penalidade de armadura", "computed", 0, 168, y, 36, h, 10,
    formula="0 - abs(@armadura_penalidade) - abs(@escudo_penalidade)", align="center")

# Armadura & escudo (linha 1 = armadura, linha 2 = escudo)
for key, label, L in (("armadura", "Armadura", 473.3), ("escudo", "Escudo", 491.8)):
    y, h = on_line(L, 10)
    add(f"{key}_nome", label, "text", 0, 30, y, 92, h, 10, maxLength=60)
    add(f"{key}_defesa", f"{label} — defesa", "number", 0, 140, y, 22, h, 10, default="0", min=0, max=99, align="center")
    add(f"{key}_penalidade", f"{label} — penalidade", "number", 0, 180, y, 24, h, 10, default="0", min=-99, max=99, align="center")

# Proficiências (4 linhas impressas)
for i, L in enumerate((406.2, 422.5, 438.0, 453.8), 1):
    y, h = on_line(L, 9)
    add(f"proficiencias_{i}", f"Proficiências ({i})", "text", 0, 229, y, 119, h, 9, maxLength=80)

# Tamanho: categoria no espaço do rótulo; o quadro "/" guarda os modificadores de Furtividade / manobra
y, h = boxed(487.5, 9)
add("tamanho", "Tamanho", "select", 0, 263, y, 42, h, 9, default="Médio",
    options=["Minúsculo", "Pequeno", "Médio", "Grande", "Enorme", "Colossal"])
y, h = boxed(487.5, 10)
add("tamanho_furtividade", "Tamanho — mod. de Furtividade", "number", 0, 310, y, 15, h, 10, default="0", min=-20, max=20, align="center")
add("tamanho_manobra", "Tamanho — mod. de manobra", "number", 0, 332, y, 15, h, 10, default="0", min=-20, max=20, align="center")

y, h = boxed(520, 11)
add("experiencia", "Pontos de experiência", "number", 0, 124, y, 82, h, 11, default="0", min=0, max=9999999)
add("deslocamento", "Deslocamento (m)", "number", 0, 288, y, 58, h, 11, role="movement", default="9", min=0, max=300)

# Perícias: TOTAL = ½ nível + mod. atributo + treino + outros (− penalidade de armadura nas marcadas com ‡)
SKILLS = [
    ("acrobacia", "Acrobacia", "DES", True), ("adestramento", "Adestramento", "CAR", False), ("atletismo", "Atletismo", "FOR", False),
    ("atuacao", "Atuação", "CAR", False), ("cavalgar", "Cavalgar", "DES", False), ("conhecimento", "Conhecimento", "INT", False),
    ("cura", "Cura", "SAB", False), ("diplomacia", "Diplomacia", "CAR", False), ("enganacao", "Enganação", "CAR", False),
    ("fortitude", "Fortitude", "CON", False), ("furtividade", "Furtividade", "DES", True), ("guerra", "Guerra", "INT", False),
    ("iniciativa", "Iniciativa", "DES", False), ("intimidacao", "Intimidação", "CAR", False), ("intuicao", "Intuição", "SAB", False),
    ("investigacao", "Investigação", "INT", False), ("jogatina", "Jogatina", "CAR", False), ("ladinagem", "Ladinagem", "DES", True),
    ("luta", "Luta", "FOR", False), ("misticismo", "Misticismo", "INT", False), ("nobreza", "Nobreza", "INT", False),
    ("oficio_1", "Ofício (1)", "INT", False), ("oficio_2", "Ofício (2)", "INT", False), ("percepcao", "Percepção", "SAB", False),
    ("pilotagem", "Pilotagem", "DES", False), ("pontaria", "Pontaria", "DES", False), ("reflexos", "Reflexos", "DES", False),
    ("religiao", "Religião", "SAB", False), ("sobrevivencia", "Sobrevivência", "SAB", False), ("vontade", "Vontade", "SAB", False),
]
SKILL_LINES = [134.2, 147.2, 160.5, 173.8, 187.0, 200.0, 213.2, 226.5, 239.8, 252.8, 266.0, 279.2, 292.2, 305.5, 318.8,
               332.0, 345.0, 358.2, 371.5, 384.8, 397.8, 411.0, 424.2, 437.5, 450.5, 463.8, 477.0, 490.2, 503.2, 516.5]
TRAINING = "(if @nivel >= 15 then 6 else if @nivel >= 7 then 4 else 2)"
assert len(SKILLS) == len(SKILL_LINES) == 30
for (key, label, abbr, armor), L in zip(SKILLS, SKILL_LINES):
    attr = ABBR[abbr]
    y, h = on_line(L, 9)
    total = f"@{key}_metade_nivel + @{key}_atributo + @{key}_treino * {TRAINING} + @{key}_outros"
    if armor:
        total += " + @penalidade_armadura"
    if key == "furtividade":
        total += " + @tamanho_furtividade"
    role = "perception" if key == "percepcao" else None
    add(key, label, "computed", 0, 439.5, y, 17, h, 9, formula=total, role=role, align="center")
    add(f"{key}_metade_nivel", f"{label} — ½ nível", "computed", 0, 467, y, 15, h, 9, formula="floor(@nivel / 2)", align="center")
    add(f"{key}_atributo", f"{label} — mod. de {abbr}", "computed", 0, 499.5, y + 0.8, 10.5, h - 1.5, 7.5, formula=f"@{attr}_mod")
    add(f"{key}_treino", f"{label} — treinada", "checkbox", 0, 516.5, L - 10.5, 9.5, 9.5, 9)
    add(f"{key}_outros", f"{label} — outros", "number", 0, 535, y, 22, h, 9, min=-99, max=99, align="center")
    if key.startswith("oficio_"):
        add(f"{key}_nome", f"{label} — especialidade", "text", 0, 398, L - 12.5, 30.5, 9.5, 7, maxLength=30)

# Equipamento (9 linhas à esquerda, 7 à direita)
EQ_LEFT = [583.0, 602.2, 621.3, 640.5, 659.7, 678.9, 698.1, 717.3, 736.4]
n = 0
for L in EQ_LEFT:
    n += 1
    y, h = on_line(L, 9)
    add(f"item_{n}", f"Item {n}", "text", 0, 31, y, 207, h, 9, maxLength=80)
    add(f"item_{n}_peso", f"Item {n} — peso", "text", 0, 252, y, 32, h, 9, maxLength=10)
for L in EQ_LEFT[:7]:
    n += 1
    y, h = on_line(L, 9)
    add(f"item_{n}", f"Item {n}", "text", 0, 303, y, 208, h, 9, maxLength=80)
    add(f"item_{n}_peso", f"Item {n} — peso", "text", 0, 525, y, 32, h, 9, maxLength=10)
y, h = on_line(717.0, 10)
add("carga_maxima", "Carga máxima (3x Força)", "computed", 0, 305, y, 32, h, 10, formula="3 * @forca", align="center")
add("levantar", "Levantar (até 10x Força)", "computed", 0, 355, y, 33, h, 10, formula="10 * @forca", align="center")
add("tibares", "T$ (tibares)", "number", 0, 426, y, 128, h, 10, default="0", min=0, max=999999999)
y, h = on_line(736.0, 10)
add("tibares_ouro", "TO (tibares de ouro)", "number", 0, 433, y, 121, h, 10, default="0", min=0, max=999999999)

# ---------------- Página 2 ----------------
# Áreas longas: textarea com fonte cujo entrelinhado (1,2 x fonte) acompanha as linhas impressas
add("descricao", "Descrição", "textarea", 1, 35, 43.4, 179, 113, 13.1, maxLength=2000)
add("habilidades_raca_origem", "Habilidades de raça e origem", "textarea", 1, 31, 185.8, 184, 117, 13.5, maxLength=4000)
add("habilidades_classe_poderes", "Habilidades de classe e poderes", "textarea", 1, 31, 333.7, 184, 406.3, 13.4, maxLength=10000)
add("anotacoes", "Anotações (histórico, aliados, tesouros etc.)", "textarea", 1, 240, 526.4, 313, 213.6, 13.5, maxLength=10000)

# Magias
y, h = on_line(57.0, 8)
add("magias_atributo", "Magias — atributo-chave", "select", 1, 285, y, 34, h, 8,
    options=["FOR", "DES", "CON", "INT", "SAB", "CAR"])
add("magias_mod", "Magias — mod. do atributo-chave", "number", 1, 339, y, 32, h, 8, default="0", min=-10, max=99, align="center")
add("magias_resistencia", "Teste de resistência das magias", "computed", 1, 432, y, 25, h, 8,
    formula="10 + floor(@nivel / 2) + @magias_mod", align="center")
SPELL_LINES = [89.0, 105.2, 121.5, 137.5, 153.8, 170.0, 186.2, 202.2, 218.5, 234.8, 251.0, 267.0, 283.3, 299.6,
               315.8, 332.0, 348.2, 364.4, 380.6, 396.8, 413.0, 429.2, 445.4, 461.6]
for i, L in enumerate(SPELL_LINES, 1):
    y, h = on_line(L, 9)
    add(f"magia_{i}", f"Magia {i}", "text", 1, 240, y, 314, h, 9, maxLength=200)

# ---------------- Ações (testes de perícia rolados na mesa) ----------------
actions = []
for key, label, abbr, _ in SKILLS:
    name = label if not key.startswith("oficio_") else "Ofício " + key[-1]
    actions.append({"key": "teste_" + key, "name": name, "kind": "habilidade",
                    "formula": f"1d20 + @{key}", "description": f"Teste de {name}: 1d20 + total da perícia."})

doc = {
    "pages": [{"width": PW, "height": PH}, {"width": PW, "height": PH}],
    "fields": fields,
    "actions": actions,
    "notes": "Mapeamento da ficha oficial Tormenta20 (PDF comum, 2 páginas): atributos e modificadores, PV/PM, ataques, "
             "defesa automática, 30 perícias com ½ nível, atributo, treino (+2/+4/+6) e penalidade de armadura, "
             "equipamento com carga, magias e textos longos alinhados às linhas impressas.",
}
out = sys.argv[1] if len(sys.argv) > 1 else "tormenta20-ficha-v1.json"
body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
open(out, "w", encoding="utf-8").write(body)
print("fields", len(fields), "actions", len(actions), "bytes", len(body.encode()), "notes", len(doc["notes"]))
