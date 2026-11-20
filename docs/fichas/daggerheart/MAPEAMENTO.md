# Daggerheart — mapeamento da ficha em branco (PDF comum)

- **Sistema:** Daggerheart (`daggerheart`), id `4a313bcc-5204-404c-ae8b-84868cf11dd7`
- **Modelo:** Ficha oficial Daggerheart, id `25f7ead6-2876-443b-8bfb-85c07f573269`, versão `41ec7ff6-9435-41f6-91e0-83719f909365`, **v1 publicada** e **padrão do sistema**
- **PDF:** `Daggerheart - Ficha em Branco.pdf` (2 páginas de 612 × 792 pt; MediaBox = CropBox), sha256 `1634b708948ef4c8f7780ee2bfe67172999b968730dcbea3de039ed1a0141a39`
- **Conteúdo:** 148 campos e 7 ações. O formato é o mesmo do editor (compactDoc); sha256 do documento `19332abfce74252036ab4b9f474085f82fa72ef45b547de02dde6e573893ed88`.
- **Arquivos:** `gerar-mapeamento.js` (gerador), `daggerheart-ficha-v1.json` (documento aplicado) e `previa-exportacao.png` (simulação das 2 páginas).

O PDF traz um formulário parcial próprio; ele é ignorado, porque o site desenha os valores sobre a página.

## Cálculos automáticos

| Campo | Fórmula |
|---|---|
| Limiar de dano maior | limiar base maior da armadura + nível (sem armadura: nível) |
| Limiar de dano severo | limiar base severo da armadura + nível (sem armadura: 2 × nível) |

## Listas (ADR-098)

No preenchimento, cada lista tem uma caixa por linha. Cada linha é um item com descrição própria, sem quebra; o que não cabe termina em "…".

- **Áreas de lista:**
  - habilidade de classe (16 linhas);
  - inventário (7);
  - cartas de domínio (56, com o nome `cartas_dominio_itens` para ser reconhecida);
  - habilidades de fundamento (9), especializada (10) e de maestria (10).
- **Itens de uma linha:**
  - armas (ativas e do inventário);
  - armadura ativa;
  - habilidade de esperança;
  - habilidades de ancestralidade (1ª e 2ª) e de comunidade.
- **Colunas e linhas de habilidade das armas e da armadura:** campos próprios terminados em `_atributo_alcance`, `_dano` e `_descricao`, sem descrição por item.

## Página 1

- **Cabeçalho:** nome (papel *nome*), pronomes, herança, classe & subclasse e nível (papel *nível*, 1–10).
- **Atributos:** agilidade, força, finesse, instinto, presença e conhecimento (−5 a 10), cada um com a caixa do círculo de "aumentado".
- **Defesa:**
  - evasão (papel *armadura*, porque é o número que os ataques precisam superar);
  - pontuação de armadura;
  - 12 espaços de armadura.
- **Dano & saúde:** limiares maior e severo (calculados), 12 PV e 12 estresse (caixas de marcar; da 7ª em diante são os espaços extras).
- **Esperança:** 6 diamantes e a habilidade de esperança.
- **Experiências:** 5 linhas com bônus.
- **Ouro:** 9 punhados, 9 bolsas e o baú.
- **Armas ativas:** proficiência (círculos 2 a 6; o 1º já vem impresso), primária e secundária.
  - Cada arma tem nome, atributo & alcance, dano & tipo e duas linhas de habilidade.
- **Armadura ativa:** nome, limiares base (maior e severo), defesa base e duas linhas de habilidade.
- **Inventário** e **2 armas no inventário:** cada arma com as mesmas colunas e as caixas primária/secundária.

## Página 2

- **Detalhes:** idade, altura, peso, outro, olhos, corpo e cabelos.
- **Cartas de domínio.**
- **Habilidades:**
  - de ancestralidade (1ª e 2ª, com linha de descrição);
  - de comunidade;
  - atributo de conjuração;
  - de fundamento, especializada e de maestria.

## Ações

- **Teste de cada atributo:** 2d12 (Dados de Dualidade: Esperança e Medo) + atributo.
- **Dados de Dualidade** (2d12) genérico.
- A Esperança ou o Medo é lido no maior dado: a rolagem mostra os dois resultados.

## Limitações

- **PV e estresse:** são caixas de marcar, como na ficha; não há número de PV, então os papéis *PV* e *PV máx.* não são usados.
- **Proficiência:** são caixas de marcar; o dano das armas é texto (ex.: `d8+3 físico`), então não vira ação de rolagem.
- **Ícones de mãos (uma/duas):** não mapeados.

## Verificação (19/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio. Depois do ajuste de fonte de nível, evasão e armadura (16 e 18), os campos e as ações no servidor batem 100% com o gerador.
- **Exportação real no site** (nível 3, armadura com limiares base 6/13):
  - os limiares saíram 9 e 16;
  - os textos caíram nas linhas e caixas, com "…" nos itens longos de lista;
  - os ✓ caíram nos círculos, escudos e diamantes.
- **"Testar ficha"** com valores altos (nível 10, evasão 15, armadura 12, limiares base 15/30 → 25/40):
  - nenhum valor foi cortado;
  - as listas mostram uma caixa por linha;
  - digitar em linhas separadas do inventário gravou uma linha por item.
