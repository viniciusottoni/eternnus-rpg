# Ficha-modelo Ordem Paranormal — mapeamento do PDF

**Publicada em produção em 10/11/2026** — rpg.eternnus.com:
- Sistema criado: **Ordem Paranormal RPG** (`261ed1b0-3364-44e0-a2d9-7e23f3ae33fb`, slug `ordem-paranormal`).
- Ficha-modelo **"Ficha oficial Ordem Paranormal"** (`5cac918c-3e92-41e6-a746-8457648fe4ea`, v1 `f0af1aad-4803-42d9-b1c4-4f79fa06a264`), **padrão do sistema**.
- PDF de fundo: `Ordem Paranormal - Ficha em Branco.pdf` (3 páginas A4, sha256 `a8f7e0a4…11b9`).

`ordem-paranormal-ficha-v1.json` é o corpo exato do `PUT` do editor (268 campos, 29 ações), gerado por `gerar-mapeamento.js`.
Validado com as regras do editor e exportado pelo `filled-pdf.js` do site; rolagem de teste conferida (Luta com FOR 3 → 3d20, fica o maior, + 12).

## Papéis ligados à mesa
Nome `personagem` · PV `pv_atual` / `pv_max` · Armadura `defesa` · Deslocamento (m) `deslocamento` · Percepção `percepcao` (bônus).
NEX não usa o papel "nível" (o papel exige 1+ e NEX começa em 0%).

## Regras calculadas
| Campo | Fórmula |
|---|---|
| `pe_rodada` | NEX ÷ 5 (mín. 1; NEX 99% = 20) |
| `defesa` | 10 + Agilidade + equipamento + outros |
| `<pericia>` (BÔNUS) | treino (5 treinado, 10 veterano, 15 expert) + outros |
| `rituais_dt` (págs. 2 e 3) | 10 + limite de PE + Presença |
| `carga_maxima` | 5 × Força (Força 0 = 2 espaços) |
| ações `teste_<pericia>` | d20 iguais ao atributo, fica o maior (atributo 0: 2d20, fica o menor) + bônus |

## Organização
1. Personagem/jogador, 5 atributos, origem/classe/trilha, NEX, PE por rodada, deslocamento, PV/PE/Sanidade (máx. e atuais), defesa, proteção, resistências, 29 perícias (incl. 2 Profissões com especialidade) e 7 ataques.
2. Habilidades, proficiências (caixas), rituais (nome/custo/página — uma linha por ritual, alinhadas às linhas impressas), prestígio, patente, limite de itens I–IV, crédito, carga atual/máxima, inventário (item/categoria/espaços nas duas colunas, um por linha) e descrição (aparência, personalidade, histórico, objetivo).
3. Personagem e DT, e 6 fichas de ritual completas (nome, elemento, círculo, execução, alcance, alvo, duração, resistência, descrição).

## Limitações conhecidas
- Listas de rituais e inventário da página 2 são áreas de texto (uma linha por item) para caber no limite de 300 campos; uma linha longa demais quebra e desalinha as colunas.
- O nome da página 3 é um campo próprio.
- Penalidade de carga (✦) e "somente treinada" (*) não são aplicadas automaticamente — use "outros".
- A rolagem mostra no detalhe os ramos não usados da fórmula (por causa do `if` por atributo); o total está correto.
