# Ficha-modelo D&D 5e — mapeamento do PDF

**Publicada em produção em 10/11/2026** — rpg.eternnus.com:
- Sistema criado: **Dungeons & Dragons 5ª Edição** (`f5c5b001-e5b7-4c0b-8efc-d759560fbaa7`, slug `dungeons-dragons-5e`).
- Ficha-modelo **"Ficha oficial D&D 5e"** (`cfdc0cfb-b6ca-4cc0-a97b-aaf5dfa7ec51`, v1 `6c3c58da-1574-45d3-9572-f7c3053f1dde`), **padrão do sistema**.
- PDF de fundo: `DeD 5e - Ficha em Branco.pdf` (3 páginas, 612 × 792 pt, sha256 `610bbf1b…f67c`).

`dnd5e-ficha-v1.json` é o corpo exato do `PUT` do editor (243 campos, 26 ações), gerado por `gerar-mapeamento.js`
(`node -e 'console.log(JSON.stringify(eval(require("fs").readFileSync("gerar-mapeamento.js","utf8"))))'`).
Validado com as regras do editor (estrutura, publicação, fórmulas e ações) e exportado pelo `filled-pdf.js` do site.

## Papéis ligados à mesa
Nome `personagem` · Nível `nivel` · PV `pv_atual` / `pv_max` · Armadura `classe_armadura` · Deslocamento (m) `deslocamento` · Percepção `sabedoria_passiva`.

## Regras calculadas
| Campo | Fórmula |
|---|---|
| `<atributo>_mod` (quadro grande) | (valor − 10) ÷ 2, para baixo — o valor do atributo fica no oval |
| `proficiencia` | 2 + ⌊(nível − 1) ÷ 4⌋ |
| `resistencia_<atributo>` | mod. + proficiência se o círculo estiver marcado |
| `<pericia>` | mod. + ⌊multiplicador × proficiência⌋ — no círculo: vazio/0, **1** proficiente, **2** especialista, **0.5** meia proficiência |
| `sabedoria_passiva` | 10 + Percepção |
| `iniciativa` | mod. de Destreza |

## Páginas
1. Cabeçalho (classe e nível separados), inspiração, atributos, resistências, 18 perícias, CA, iniciativa, deslocamento, PV (máx./atuais/temporários), dados de vida, testes contra a morte, 3 ataques + quadro livre, personalidade, idiomas, moedas, equipamento, características.
2. Nome (repetido), idade/altura/peso/olhos/pele/cabelos, aparência, aliados, nome do símbolo, história, outras características, tesouro.
3. Classe de conjurador, habilidade chave (lista), CD e bônus de ataque (digitados), espaços total/usados dos níveis 1–9, 8 truques e todas as 93 linhas de magia.

## Limitações conhecidas
- O nome do personagem da página 2 é um campo próprio (o editor não copia texto entre campos).
- CD e bônus de ataque de magia são digitados (listas não entram em fórmulas).
- Os círculos de "preparada" da página 3 não foram mapeados (limite de 300 campos); escreva "(P)" no nome se quiser.
- Bônus fora das regras (talentos, itens) na iniciativa/perícias não têm campo próprio na folha.
