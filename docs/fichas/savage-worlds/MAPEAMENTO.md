# Savage Worlds (Edição Aventura, RetroPunk) — mapeamento da ficha em branco (PDF comum)

- **Sistema:** Savage Worlds (`savage-worlds`), id `1594c16f-d324-4821-9078-ab78384ad1b3`
- **Modelo:** Ficha oficial Savage Worlds, id `e5e0c2e3-04ef-4d49-b3fa-2677d39c2a34`, versão `db00dd3f-48db-4b4d-a850-d8edae912863`, **v1 publicada** e **padrão do sistema**
- **PDF:** `Savage Worlds - Ficha em Branco.pdf` (1 página A4 de 595 × 842 pt; MediaBox = CropBox), sha256 `b4eba03753588af134cce59fe88aee91faa8deae4a89d9129d42c5be562200f6`
- **Conteúdo:** 131 campos e 42 ações. O formato é o mesmo do editor (compactDoc); sha256 do documento `42d43d4f951f5ca9a3479cc5b5cbfac263474c03d0ab03cb8521e2054536c70e`.
- **Arquivos:** `gerar-mapeamento.js` (gerador), `savage-worlds-ficha-v1.json` (documento aplicado) e `previa-exportacao.png` (simulação da página).

## Dados de atributos e perícias

A caixinha quadrada de cada atributo e perícia recebe o **número do dado**: 4, 6, 8, 10 ou 12. Para d12+1, d12+2… use 13, 14…; perícia vazia = sem a perícia.

- O número entra nos cálculos e nas ações.
- A fileira de dados impressa (d4 a d12) fica só como referência.
- Atributos começam em 4.
- **Perícias com nome digitado:** duas linhas "Con." (Conhecimento 1 e 2) e as 6 linhas em branco da 3ª coluna (Perícia extra 1 a 6).

## Cálculos automáticos

| Campo | Fórmula |
|---|---|
| Aparar | 2 + metade de Lutar (arredondada para baixo) |
| Resistência | 2 + metade do Vigor + armadura do tronco |

Com d12+1, o resultado bate com a regra: a metade de 13 é 6, como a metade do d12 mais metade do +1 arredondada para baixo.

## Ações (testes com dado selvagem)

- **Testes (41):** um por atributo e por perícia, incluindo Conhecimento 1 e 2 e as perícias extras.
  - Cada teste rola o dado da característica e o **dado selvagem d6** e fica com o maior. Acima de d12 soma o bônus (+1, +2…).
  - Sem a perícia: d4 e d6, o maior, − 2.
  - A ação escolhe o dado pelo número na caixinha e só rola o dado certo.
- **Dado selvagem** (1d6) avulso.
- **Não automático:** o dado explodindo (ás) e os modificadores de ferimento e fadiga.

## Listas (ADR-098)

No preenchimento, cada lista tem uma caixa por linha, e cada item tem descrição própria.

- **Vantagens** (7 linhas).
- **Complicações:** iniciais (2 linhas) e outras (5 linhas). Os campos se chamam `desvantagens_*` para o site reconhecer a lista; o primeiro texto de cada uma começa depois do rótulo "Iniciais:"/"Outros:".
- **Armamento** (3 linhas): distância, CdT, dano, PA, peso e anotações são colunas, uma linha por item, sem descrição própria.
- **Poderes** (4 linhas): custo, distância, dano/efeito e duração são colunas, do mesmo jeito.

## Demais campos

- **Cabeçalho:** nome (papel *nome*), jogador, aparência, conceito e experiência (pontos).
- **Estatísticas derivadas:**
  - Movimentação (papel *movimento*, padrão 6);
  - Aparar (papel *armadura*, calculado);
  - Resistência (calculada);
  - Carisma (padrão 0).
- **Saúde:**
  - ferimentos −1, −2 e −3, Incapacitado e fadiga −2 e −1, como caixas de marcar (o ✓ cai sobre o hexágono);
  - ferimentos permanentes (texto corrido).
- **Armadura** (cabeça, tronco, braços, pernas: números) e **carga** (peso carregado, limite, penalidade).
- **Anotações adicionais:** texto corrido sobre as 4 linhas.
- **Trilha de experiência:** 43 marcas.

## Limitações

- Aparar não inclui bônus de escudo e vantagens, porque a ficha não tem onde anotá-los. A Resistência só soma a armadura do tronco.
- O limite de carga é digitado: a regra depende da edição e da unidade.
- Os Benês não aparecem na ficha impressa, então não foram mapeados.

## Verificação (19/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio. Os campos e as ações no servidor batem 100% com o gerador.
- **Exportação real no site** (Agilidade d8, Vigor d8, Lutar d8, Atirar d10, armadura do tronco 2):
  - Aparar 6 e Resistência 8;
  - os textos caíram nas caixas e nas linhas;
  - os itens longos de lista terminaram em "…".
- **"Testar ficha"** com valores altos (Lutar 13 → Aparar 8; Vigor 14 + armadura 4 → Resistência 13; experiência 120; Carisma −2):
  - nenhum valor foi cortado;
  - listas e colunas mostram uma caixa por linha.
