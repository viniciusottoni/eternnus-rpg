# Feiticeiros e Maldições v2.0 — mapeamento da ficha oficial

- **Sistema:** Feiticeiros e Maldições (`feiticeiros-e-maldicoes`), id `2219d683-4676-4985-b607-0a1294c09eeb`
- **Modelo:** Ficha oficial Feiticeiros e Maldições, id `c03bbdf9-3d65-455e-8fcb-cd46dcaf891e`, **v2 publicada** (versão `273fe728-7704-4033-8f00-1ec5741ab39c`) e **padrão do sistema**. A v1 continua publicada para fichas que ainda não migraram.
- **PDF:** `Feiticeiros e Maldicoes v2 - Ficha Limpa.pdf` (modelo de Setsugiri, compatível com o Livro Básico 2.0; 6 páginas A4 paisagem, 842 × 595 pt), sha256 `651f9a550920a45aa4dc483e8ec2c45480032afd7aa4f5f8d6afe16b8fa459d0`
- **Conteúdo:** 290 campos (o limite da plataforma é 300) e 29 ações. O formato é o mesmo do editor (compactDoc).
- **Arquivos:** `gerar-mapeamento.js` (gerador), `feiticeiros-e-maldicoes-ficha-v2.json` (documento publicado na v2), `feiticeiros-e-maldicoes-ficha-v1.json` (v1) e `previa-exportacao.png` (simulação das páginas 1 e 3).

## Regras calculadas (Livro Básico 2.0)

| Campo | Fórmula |
|---|---|
| Bônus de maestria | 2 + floor((nível − 1) / 4) → +2 no 1º nível e +1 nos níveis 5, 9, 13 e 17 |
| Modificador de atributo | floor((valor − 10) / 2) |
| Total de perícia | mod. do atributo + outros + maestria (Mt) **ou** 2 × maestria (Es, especialista) |
| Atenção | 10 + total de Percepção (papel *percepção*) |
| Iniciativa | modificador de Destreza |
| Classe de Armadura | 10 (natural) + uniforme + escudo + mod. de Destreza + outros (papel *armadura*) |
| PE na página 3 | cópias dos PE atuais, máximos e temporários da página 1 |

Luta e Pontaria não têm a caixa *Es* na ficha e, portanto, só somam a maestria.

## Página 1

- **Cabeçalho:** nome (papel *nome*), nível (papel *nível*, 1 a 20), maestria (calculada), experiência, origem, especialização, técnica, jogador, campanha e grau.
- **Atributos:** 6 valores (padrão 10) e 6 modificadores calculados.
- **Pontos e derivados:**
  - PV atuais, máximos e temporários (papéis *PV* e *PV máx.*).
  - Integridade e PE, cada um com atual, máximo e temporário.
  - Atenção, Iniciativa e Movimento (papel *movimento*, padrão 9).
- **CA:** uniforme, escudo, Destreza (calculada), outros e total.
- **Testes de morte:** 3 caixas de sucesso e 3 de fracasso.
- **Perícias:** 28 perícias, cada uma com outros, Mt, Es e total. Os 4 Ofícios também têm um campo para o nome do ofício.
- **Áreas de texto pautadas** (cada linha cai numa linha impressa):
  - Dados de Vida: gastos e disponíveis, para d12, d10 e d8.
  - Registro Rápido: 6 colunas × 4 linhas.
  - Habilidades de Especialização: 4 colunas × 25 linhas.
  - Talentos: 4 colunas × 10 linhas.
- **Textos livres:** Características e Maestrias.

## Página 2

- Nome.
- Detalhes físicos (idade a marcas, um por linha) e Aparência.
- Traços de personalidade, Ideais, Ligações e Defeitos.
- Inventário: 2 blocos × 4 colunas × 24 linhas.
- Espaços ocupados, limite de espaços e História.

## Página 3 — perfil amaldiçoado

- Habilidades de técnica conhecidas e máximas, atributo principal e PE (copiados da página 1).
- Nome e descrição da técnica.
- Aptidões Amaldiçoadas: 3 colunas × 25 linhas.
- Habilidades de Técnica: 6 blocos × 10 linhas.
- Expansão de Domínio: nome, tipo e descrição.
- Aspectos de Técnica: atributo, perícia, CD e bônus de acerto.
- 5 níveis de aptidão.

## Página 4 — shikigamis (invocações 1 a 5)

Cada invocação tem:
- grau;
- PV atuais e máximos, CA e movimento;
- atributos e modificadores (um valor por linha);
- ações e características;
- perícias: nome, atributo e bônus.

## Página 6 — treinamentos

Os 11 treinos são listas de "etapas concluídas" (1 a 4). A opção escolhida escreve um ✓ por linha (`✓`, `✓\n✓`, …). Como o passo das linhas é 10,5 pt, a fonte de 8,75 pt faz cada ✓ cair exatamente na caixa da etapa.

## Ações

- 28 testes de perícia, cada um com 1d20 + total da perícia.
- Iniciativa: 1d20 + modificador de Destreza.

## Limitações (por causa do limite de 300 campos)

- **Página 5** (invocações 6 a 10, cópia da página 4) **não foi mapeada**. Mapeá-la custaria mais 55 campos.
- **Shikigamis:** as caixas Mt/Es das perícias não foram mapeadas; o bônus é escrito direto.
- **Áreas pautadas:** desde a v2 (ADR-098) não quebram mais: cada linha é um item e o que não cabe termina em "…".
- **Perícia e CD da técnica:** não são calculadas. A plataforma não liga um atributo escolhido por nome a uma fórmula, então CD e bônus de acerto são preenchidos à mão.

## Verificação (17/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio. O servidor aceitou as opções com quebra de linha e o papel *percepção*.
- Exportação real no site, com valores de exemplo (nível 5, FOR 18…):
  - Calculados: maestria 3, Atletismo 10 (especialista), Luta 7, Atenção 14, CA 15.
  - Visual: os ✓ caíram nas caixas de Mt/Es, dos testes de morte e das etapas de treinamento, e os textos pautados ficaram nas linhas.
- Em "Testar ficha" com valores máximos, nenhum número foi cortado.

## v2 (17/11/2026): listas linha a linha (ADR-098)

- **O que mudou:** só nomes de campo, para o site reconhecer as listas pelo nome: `hab_esp_nome`, `hab_esp_atual`, `hab_esp_max` e `hab_esp_custo` passaram a `habilidades_especializacao`, `habilidades_especializacao_atual`, `habilidades_especializacao_max` e `habilidades_especializacao_custo`. Posição, fonte, ações e PDF são os mesmos da v1.
- **Listas:** cada linha é um item, sem quebra; o que não cabe termina em "…" e o texto inteiro aparece no tooltip. Cada item pode ter uma descrição própria (botão no canto do campo). As colunas da mesma tabela (dados, atual, custo…) também ficam uma linha por linha, sem descrição própria.
- **Altura de linha:** listas e colunas usam 1,2 × fonte na tela e no PDF exportado, por isso cada item cai na linha impressa.
- **Verificação:** campos e ações da v2 no servidor batem 100% com o gerador. Nenhuma ficha de jogador usava a v1, então a renomeação não descartou valores.

