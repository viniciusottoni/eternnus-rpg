# Ficha-modelo Tormenta20 — mapeamento do PDF oficial

**Publicada em produção em 10/11/2026** — rpg.eternnus.com, sistema Tormenta20:
"Ficha oficial Tormenta20" (modelo `bbd5e2c3-a4a1-4dad-8706-8118bc380af2`, v1 `3276877e-c1ab-4175-9eb7-a87c602abd97`),
**padrão do sistema** para novas fichas. Para ajustar: crie um novo rascunho no editor (versões publicadas são imutáveis).

Sistema: **Tormenta20** · PDF de fundo: `T20 - Ficha em Branco.pdf` (2 páginas, 581,1 × 779,53 pt)
Versão gerada: `tormenta20-ficha-v1.json` — corpo idêntico ao que o editor envia em
`PUT /api/sheet-templates/{id}/versions/{versionId}` (mesmo `compactDoc`, coordenadas normalizadas com 5 casas).

**293 campos · 30 ações · validado com as regras do editor** (`structuralIssues`, `publishIssues`, `validateFields`, fórmulas de ação).

## Papéis ligados à mesa

| Papel | Campo |
|---|---|
| Nome | `personagem` |
| Nível | `nivel` (1–20) |
| PV / PV máximos | `pv_atual` / `pv_max` |
| Armadura (Defesa) | `defesa` (calculado) |
| Deslocamento (m) | `deslocamento` (padrão 9) |
| Percepção | `percepcao` (total da perícia) |

## Regras calculadas

| Campo | Fórmula |
|---|---|
| `<atributo>_mod` | `mod(@atributo)` → (valor − 10) ÷ 2, arredondado para baixo |
| `defesa` | 10 + mod. Des + bônus de armadura + bônus de escudo + outros |
| `defesa_armadura` / `defesa_escudo` | defesa informada nas linhas "Armadura" e "Escudo" do quadro Armadura & Escudo |
| `penalidade_armadura` | −(\|penalidade da armadura\| + \|penalidade do escudo\|) — aceita "2" ou "−2" |
| `<pericia>` (TOTAL) | ½ nível + mod. do atributo + treino + outros |
| treino | caixa "Treino" marcada vale +2 (níveis 1–6), +4 (7–14), +6 (15+) |
| Acrobacia, Furtividade, Ladinagem (‡) | somam a penalidade de armadura |
| Furtividade | soma também o modificador de tamanho para Furtividade |
| `carga_maxima` / `levantar` | 3 × Força / 10 × Força |
| `magias_resistencia` | 10 + ½ nível + mod. do atributo-chave |

## Organização dos campos

- **Cabeçalho:** jogador, personagem, raça, origem, classe, nível (separado da classe para alimentar as fórmulas), divindade.
- **Atributos:** `forca`, `destreza`, `constituicao`, `inteligencia`, `sabedoria`, `carisma` (padrão 10) + modificadores.
- **PV/PM:** máximos e atuais.
- **Ataques:** 5 linhas × nome, teste, dano, crítico, tipo, alcance (`ataque_N_*`).
- **Perícias:** para cada uma `<pericia>`, `_metade_nivel`, `_atributo`, `_treino` (caixa), `_outros`; Ofício 1 e 2 têm `_nome` para a especialidade.
- **Tamanho:** categoria (lista; padrão Médio) no espaço do rótulo; o quadro "/" guarda os modificadores de Furtividade / manobra.
- **Equipamento:** 16 linhas item + peso (9 à esquerda, 7 à direita), carga máxima, levantar, T$ e TO.
- **Página 2:** descrição, habilidades de raça e origem, habilidades de classe e poderes, anotações (textos longos com fonte cujo entrelinhado acompanha as linhas impressas), atributo-chave/mod./teste de resistência das magias e 24 linhas de magia.

## Ações predefinidas

Uma ação "habilidade" por perícia (`teste_<pericia>`: `1d20 + @<pericia>`), para rolar testes direto da mesa.

## Limitações conhecidas

- O editor e a exportação alinham o conteúdo à esquerda; os números ficam em caixas estreitas para parecerem centralizados.
- O mod. do atributo-chave das magias é digitado (listas não entram em fórmulas).
- "Somente treinado" (✻) e a limitação de Destreza por armadura pesada não são bloqueadas automaticamente — use "outros".
- Cada linha de magia é um único campo de texto (não há campos suficientes no limite de 300 para as 8 colunas × 24 linhas).
