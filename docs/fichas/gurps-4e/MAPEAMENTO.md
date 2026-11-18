# GURPS 4ª Edição — mapeamento da planilha oficial (Devir)

- **Sistema:** GURPS 4ª Edição (`gurps-4e`), id `175cd437-ba53-4516-a624-f2835a05db56`
- **Modelo:** Ficha oficial GURPS 4e, id `a6b27457-1177-4ba9-9a72-6f3f6b2132e0`, **v2 publicada** (versão `3ac469ad-e15d-4bcf-9472-6fd76a065ee4`) e **padrão do sistema**; as versões anteriores continuam publicadas para fichas que ainda não migraram. Documento: `gurps-4e-ficha-v2.json`.
- **PDF:** `GURPS 4e - Ficha em Branco.pdf` (2 páginas), sha256 `82691381a71fe019964b297a0b93ce60b1fdc2c689016a8a1bdd75151f3461d6`
- **Conteúdo:** 158 campos e 8 ações. O formato é o mesmo do editor (compactDoc).
- **Arquivos:** `gerar-mapeamento.js` (gerador), `gurps-4e-ficha-v1.json` (documento aplicado) e `previa-exportacao.png` (simulação das 2 páginas).

## Atenção: área visível (CropBox)

O PDF tem MediaBox de 651,97 × 864,57 pt, mas a área visível (CropBox) é de 578,27 × 807,87 pt e começa 14,17 pt à direita. O site e o pdf.js usam a CropBox.

As medidas foram feitas na MediaBox; o gerador subtrai `OX = 14,1732` de todo x. Para re-renderizar e conferir, use `pdftoppm -cropbox`.

## Cálculos automáticos

| Campo | Fórmula |
|---|---|
| Custo de ST / DX / IQ / HT | (valor − 10) × 10 / 20 / 20 / 10 |
| Custo de PV / Vont / Per / PF | (valor − ST / IQ / IQ / HT) × 2 / 5 / 5 / 3 |
| Custo da velocidade básica | (velocidade − (DX + HT)/4) × 20 |
| Custo do deslocamento básico | (deslocamento − ⌊velocidade⌋) × 5 |
| Base de carga | ST × ST / 10 (arredondada quando ≥ 10) |
| Tabela de carga | BC × 1, 2, 3, 6, 10 · deslocamento × 1, 0,8, 0,6, 0,4, 0,2 (mín. 1) · Esquiva = ⌊velocidade⌋ + 3 − nível (mín. 1) |
| Resumo dos pontos | atributos e características secundárias · vantagens + línguas + NT + familiaridades · desvantagens · perícias · outros (digitado) |
| Pontos para gastar | total de pontos − soma do resumo |

## Página 1

- **Cabeçalho:** nome (papel *nome*), jogador, total de pontos (padrão 150), altura, peso, modificador de tamanho, idade, pontos para gastar (calculado) e aparência.
- **Atributos:** ST, DX, IQ e HT (padrão 10) com custo.
- **Características secundárias:**
  - PV (papel *PV máx.*) com PV atuais (papel *PV*).
  - Vontade e Percepção (papel *percepção*).
  - PF com PF atuais.
  - Todas com custo.
- **Base de carga e dano:** base de carga; dano GdP e GeB (texto).
- **Velocidade:** velocidade básica e deslocamento básico (papel *movimento*), com custos.
- **Tabela de carga:** 15 campos calculados.
- **Línguas:** áreas pautadas para língua, falada e escrita, mais 5 custos.
- **NT e familiaridades:** NT com custo; familiaridades culturais (3 linhas, com custos).
- **Combate e reação:** RD, Aparar, Bloqueio; modificadores de reação (aparência, status, reputação e mais 4 linhas).
- **Listas com custo por linha:**
  - Vantagens: 12 linhas.
  - Desvantagens: 13 linhas (custo negativo).
  - Perícias: 25 linhas, com NH e NH relativo pautados.

## Página 2

- **Nome.**
- **Armas corpo a corpo:** 5 linhas com arma, dano, alcance, aparar, notas, custo e peso.
- **Armas à distância:** 10 linhas com 11 colunas, mais custo e peso.
- **Armadura e posses:** 34 linhas com item, posição, custo e peso.
- **Totais:** $ e kg (digitados).
- **Anotações.**
- **Resumo dos pontos:** calculado.

## Ações

- Testes de ST, DX, IQ, HT, Vontade, Percepção e Esquiva: **margem = valor − 3d6** (0 ou mais é sucesso).
- Rolagem 3d6 genérica.

## Limitações

- **Dano GdP/GeB:** a fórmula só devolve números, então dano em dados (ex.: 1d-2) é digitado.
- **Custos de posses e armas:** estão em áreas de texto, então os totais $ e kg não são somados.
- **NH das perícias:** é digitado. Calcular exigiria saber o atributo e a dificuldade de cada perícia.

## Verificação (17/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio. Depois do ajuste de fonte do resumo, os campos e as ações publicados batem 100% com o gerador.
- Exportação real no site, com DX 15, IQ 12, HT 11 e Per 14:
  - Calculados: atributos 160 pontos, BC 10, Esquiva 9, vantagens 27, desvantagens −40, perícias 20.
  - Visual: os textos caem sobre as linhas e os custos dentro dos colchetes, nas 2 páginas.
- Em "Testar ficha" com valores altos (atributos 14 e 18, totais de 3 dígitos), nenhum número foi cortado.

## v2 (18/11/2026): mais listas (ADR-098)

- **O que mudou:** só nomes de campo, para o site tratar como lista: `linguas` e `familiaridades` passaram a `linguas_itens` e `familiaridades_itens`; `linguas_falada` e `linguas_escrita` seguem as mesmas linhas como colunas das línguas. Posição, fonte, ações e PDF são os mesmos da v1.
- **Como fica:** no preenchimento, uma caixa por linha impressa (como as linhas de magias), todas no mesmo campo; cada linha é um item com descrição própria; o que não cabe termina em "…".
- **Fichas existentes:** Nenhuma ficha de jogador usava a v1.
- **Verificação:** campos e ações da v2 no servidor batem 100% com o gerador.

