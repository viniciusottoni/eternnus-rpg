# Vampiro: A Máscara 5ª Edição — mapeamento da ficha oficial

- **Sistema:** Vampiro: A Máscara 5ª Edição (`vampiro-a-mascara-v5`), id `06bd677c-e120-4370-936a-dc2a657c7abe`
- **Modelo:** Ficha oficial Vampiro: A Máscara V5, id `66c59ecd-0dee-4cdd-a9b1-18002c4c6c09`, **v1 publicada** e **padrão do sistema**
- **PDF:** `Vampiro A Máscara V5 - Ficha em Branco.pdf` (2 páginas Carta, 612 × 792 pt), sha256 `f01fe41c603b97fbb5f854623e8244107bfb1daa3efd5d48fa11bba5492b3af7`
- **Conteúdo:** 179 campos e 1 ação. O formato é o mesmo do editor (compactDoc).
- **Arquivos:** `gerar-mapeamento.js` (gerador) e `vampiro-v5-ficha-v1.json` (documento aplicado).

## Como as bolinhas e os quadradinhos funcionam

Bolinhas (●) e quadradinhos (■) são campos de **lista** cujas opções são os próprios símbolos. Quem preenche escolhe, por exemplo, `●●●` em Força.

Na exportação, os símbolos são escritos em Arial no tamanho exato para cobrir os círculos e quadrados impressos:
- ● em 16,35 pt reproduz o passo de 9,875 pt da ficha;
- ■ em 18 pt reproduz o passo de 10,875 pt.

As listas de 10 posições usam um espaço fino para pular o vão entre o 5º e o 6º símbolo impressos:
- Humanidade usa U+2006;
- Potência de Sangue usa U+2005.

## Página 1

| Bloco | Campos |
|---|---|
| Cabeçalho | nome (papel *nome*), conceito, predador, crônica, ambição, clã, senhor, desejo, geração |
| Atributos | 9 listas de bolinhas (padrão ●) |
| Vitalidade e Força de Vontade | um campo por caixa (10 + 10), com as opções `/` (dano superficial) e `X` (agravado) |
| Habilidades | 27 listas de bolinhas, cada uma com a especialização na linha pontilhada |
| Disciplinas | 6 blocos: nome, nível em bolinhas e 5 linhas de poderes |
| Rodapé | Ressonância, Fome (1 a 5 ■, padrão ■) e Humanidade (1 a 10 ■, padrão 7) |

## Página 2

- **Áreas de texto:** Princípios da Crônica, Pilares & Convicções e Perdição do Clã.
- **Vantagens & Defeitos:** 11 linhas, cada uma com nome e bolinhas.
- **Potência de Sangue:** 1 a 10 bolinhas.
- **Efeitos do sangue:** Surto de Sangue, Quantidade Recuperada, Bônus de Poder, Rerrolagem de Sangue, Penalidade de Alimentação e Gravidade da Perdição.
- **Experiência:** total e gasta (números).
- **Dados pessoais:** idade verdadeira, idade aparente, data de nascimento e data de morte.
- **Textos livres:** Aparência, Traços Distintivos, História e Notas.

## Ação

- **Teste de Despertar (1d10):** 6 ou mais é sucesso; em falha, a Fome aumenta em 1.

## Limitações

- Vitalidade (Vigor + 3) e Força de Vontade (Autocontrole + Determinação) **não são calculadas**: atributos em lista não são numéricos nas fórmulas da plataforma.
- Pelo mesmo motivo, a parada de dados (atributo + habilidade, com dados de Fome) é montada pelo jogador à mesa. A quantidade de dados de uma rolagem também precisa ser um número fixo.

## Verificação (16/11/2026)

- O validador do editor não apontou nenhum problema (estrutura, publicação, campos e ação). O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio.
- Exportação real no site (Arial do navegador): as bolinhas de atributos, habilidades, disciplinas e vantagens e os quadradinhos de Fome e Humanidade caem exatamente sobre os símbolos impressos, inclusive os vãos de Humanidade e Potência de Sangue.
- "Testar ficha": todas as 76 listas abriram e aceitaram o valor máximo. Os números (XP 9999) couberam sem corte.
