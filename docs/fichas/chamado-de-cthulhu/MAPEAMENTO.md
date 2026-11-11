# Chamado de Cthulhu 7ª Edição — mapeamento da ficha oficial

- **Sistema:** Chamado de Cthulhu 7ª Edição (`chamado-de-cthulhu-7e`), id `d6f86955-5733-4e55-80a7-967d5e198864`
- **Modelo:** Ficha oficial Chamado de Cthulhu 7e, id `7fe81fd4-fbe8-4c17-8027-51b5367bff1f`, **v1 publicada** e **padrão do sistema**
- **PDF:** `Chamado de Cthulhu 7e - Ficha em Branco.pdf` (2 páginas: pág. 1 A4 595,28 × 841,89 pt; pág. 2 Carta 612 × 792 pt), sha256 `f8ce6be119f48289ce5f5cb8e8efebaa3ae19b3f10056a172427df74e2c8b7b1`
- **Conteúdo:** 295 campos e 3 ações. O formato é o mesmo do editor (compactDoc), e as coordenadas de cada página são normalizadas pelo tamanho dela.
- **Arquivos:** `gerar-mapeamento.js` (gerador), `chamado-de-cthulhu-ficha-v1.json` (documento aplicado) e `previa-exportacao.png` (simulação da exportação).

## Página 1 — investigador

| Bloco | Campos | Regras |
|---|---|---|
| Identificação | nome (papel *nome*), jogador, ocupação, idade (número, padrão 25), sexo, residência, local de nascimento | — |
| Características | FOR, DES, POD, CON, APA, EDU, TAM, INT (número, padrão 50) | Para cada uma, `_metade = floor(x/2)` e `_quinto = floor(x/5)`, calculados |
| MOV | `movimento` (papel *movimento*) | 9 se DES e FOR > TAM; 7 se ambas < TAM; senão 8. Subtrai 1 por década a partir dos 40 anos (até −5). |
| Pontos de vida | lesão grave (caixa), `pv_max = floor((CON+TAM)/10)` (papel *PV máx.*), `pv_atual` (papel *PV*) | — |
| Sanidade | insanidade temporária e indefinida (caixas), sanidade atual, `sanidade_inicial = POD`, `sanidade_maxima = 99 − Mythos` | — |
| Sorte / PM | sorte atual; PM atuais, `pm_max = floor(POD/5)` | — |
| Perícias | 60 linhas: valor (com o valor base como padrão), metade e quinto. As 14 linhas em branco têm também o campo `livre_N_nome`. | Esquivar e Língua Natural ficam sem padrão (dependem de DES/2 e EDU). |
| Armas | Desarmado regular/difícil/extremo calculados a partir de Lutar (Brigar); 2 linhas livres (arma, regular, difícil, extremo, dano, alcance, ataques, munição, defeito) | — |
| Combate | bônus de dano (texto, padrão 0), Corpo, Esquiva com metade e quinto | Corpo: FOR+TAM <65 → −2; <85 → −1; <125 → 0; <165 → 1; <205 → 2; depois +1 a cada 80. |

## Página 2 — antecedentes

- **Áreas de texto:** descrição pessoal, características, ideologias/crenças, ferimentos e cicatrizes, pessoas significativas, fobias e manias, locais importantes, tomos arcanos/feitiços/artefatos, pertences queridos e encontros com entidades estranhas.
- **Equipamento e pertences:** duas colunas.
- **Dinheiro e recursos:** nível de gastos, dinheiro, patrimônio e detalhes.
- **Companheiros investigadores:** 8 quadros, cada um com personagem e jogador.

## Ações

- **Teste percentual (1d100):** sucesso se o resultado for ≤ ao valor da perícia; difícil ≤ metade; extremo ≤ quinto; 01 é crítico.
- **Teste de Sanidade (1d100)**
- **Teste de Sorte (1d100)**

## Limitações

- Não foram mapeados:
  - as caixinhas de marcação de evolução das perícias, por causa do limite de 300 campos;
  - as trilhas numéricas impressas de PV, Sanidade, Sorte e PM (o valor atual fica no campo próprio);
  - as marcações Morrendo/Inconsciente.
- Dados de bônus e penalidade não podem ser expressos na fórmula da plataforma: role 1d100 pela ação e aplique-os à mesa.

## Verificação

- O validador do editor não apontou nenhum problema (estrutura, publicação, fórmulas e ações). O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio.
- Exportação real no site:
  - Com valores de exemplo, a ficha exportada mostrou MOV 6, PV 12, SAN máx. 96 e Corpo 0.
  - Os textos caíram nas linhas e caixas das duas páginas.
- Em "Testar ficha" com valores de pior caso (90/99/88), nenhum campo de preenchimento ficou cortado, e os cálculos atualizaram ao digitar.
