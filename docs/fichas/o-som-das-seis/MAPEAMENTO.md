# O Som das Seis — mapeamento da ficha em branco (PDF comum)

- **Sistema:** O Som das Seis (`o-som-das-seis`), id `cfccfba2-f674-4fc6-baea-27710c64dc14`
- **Modelo:** Ficha oficial O Som das Seis, id `038ebbe6-4ef5-422b-8486-5ca3fbbc30cc`, versão `eecaa2b4-3b65-48c8-b7a7-17271b3f5f73`, **v1 publicada** e **padrão do sistema**
- **PDF:** `O Som das Seis - Ficha em Branco.pdf` (2 páginas de 595,32 × 839,16 pt; MediaBox = CropBox), sha256 `7104a5306098ddd3e42d069d8b868be8dbf6056330afe28ed22dd0f980704242`
- **Conteúdo:** 69 campos e 2 ações. O formato é o mesmo do editor (compactDoc); sha256 do documento `8dc6146eb66322f6ac3300a1a3f61f3d97d64ae3d714627425af8eddfc9e0647`.
- **Arquivos:** `gerar-mapeamento.js` (gerador), `o-som-das-seis-ficha-v1.json` (documento aplicado) e `previa-exportacao.png` (simulação das 2 páginas).

## Quadradinhos

Atributos, antecedentes, potência e vigor do cavalo são **listas** com 5 opções: `■`, `■ ■`, … até 5 quadrados, separados por U+2006 (espaço de 1/6 em).

- A fonte de cada lista é ajustada ao passo das caixas impressas: fs = passo ÷ 0,7705 (≈ 26 pt). Assim cada ■ cai dentro de uma caixa.
- Na exportação o ■ preto fica com uma borda bege da caixa em volta, então a caixa marcada é bem visível.
- Por serem listas, esses valores **não entram em fórmulas** (listas valem 0). Por isso vida, defesa, iniciativa e ações são digitados.

## Página 1

- **Nome** (papel *nome*) e **nível** (papel *nível*, padrão 1).
- **Atributos:** físico, agilidade, intelecto e coragem (quadradinhos).
- **Vida** (papel *PV*, padrão 6) e **defesa** (papel *armadura*, padrão 5). A regra é defesa = 5 + Coragem; vida inicial = 1d6 + 1d6 por Físico.
- **Tormento** e **recompensa:** áreas de texto de 2 linhas.
- **Iniciativa** (+1 por Coragem, padrão 0) e **ações por turno** (2 + Agilidade, padrão 2).
- **Antecedentes:** combate, negócios, montaria, tradição, labuta, exploração, roubo e medicina (quadradinhos).
- **Habilidades:** área de texto grande (fonte 11).
- **Reputação** e **dinheiro (U$).**

## Página 2

- **Equipamento:** 10 linhas, cada uma com item e dano (texto, ex.: `1d6+2`).
- **Cavalo:**
  - Nome e fidelidade.
  - Potência e vigor (quadradinhos).
  - Vida (1d6 + vigor), defesa (5 + vigor) e dano (6 + potência), digitados.
  - Itens no cavalo: 15 linhas.
  - 4 marcos (caixas de marcar): deu um nome, corre mais rápido, vem com um assovio, mais esbelto e forte.

## Ações

- **Iniciativa:** 1d6 + @iniciativa.
- **Rolagem 1d6** genérica.

## Limitações

- Defesa, iniciativa, ações e os valores do cavalo não são calculados, porque os atributos são quadradinhos (listas). Para calcular seria preciso trocá-los por números, e aí os quadradinhos impressos ficariam vazios na exportação.
- O dano do equipamento é texto, então não vira ação de rolagem.

## Verificação (17/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos no navegador antes do envio; o servidor devolveu os 69 campos e as 2 ações.
- Exportação real no site, com físico 2, agilidade 3, intelecto 1, coragem 5, antecedentes variados e o cavalo com potência 3 e vigor 2:
  - Todos os ■ caíram centrados nas caixas, nas duas páginas.
  - Os textos ficaram dentro dos quadros e os marcos do cavalo receberam ✓.
- Em "Testar ficha" com textos longos e números de 2 dígitos (nível 12, iniciativa −5, dinheiro 12000), nenhum campo foi cortado.
