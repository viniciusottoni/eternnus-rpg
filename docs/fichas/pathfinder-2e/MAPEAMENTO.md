# Pathfinder 2ª Edição — mapeamento da ficha oficial

- **Sistema:** Pathfinder 2ª Edição (`pathfinder-2e`), id `de09cc13-e121-4224-9d2e-ad01847bd38e`
- **Modelo:** Ficha oficial Pathfinder 2e, id `71afa45a-45af-4dc8-9685-06bdb831b263`, **v2 publicada** (versão `6d7d0b84-e65f-49a9-814c-deb9fba64188`) e **padrão do sistema**. A v1 continua publicada para fichas que ainda não migraram.
- **PDF:** `Pathfinder 2e - Ficha em Branco.pdf` (4 páginas de 603 × 783 pt), sha256 `8ff7b24e55ed76f09ed386af04538415539c234e2ac16337f887d6dc61e6ce34`
- **Conteúdo:** **300 campos** (o limite da plataforma) e 29 ações. O formato é o mesmo do editor (compactDoc).
- **Arquivos:** `gerar-mapeamento.js` (gerador), `pathfinder-2e-ficha-v2.json` (documento publicado na v2), `pathfinder-2e-ficha-v1.json` (v1) e `previa-exportacao.png` (simulação da página 1).

## Regras calculadas

| Campo | Fórmula |
|---|---|
| Modificador de atributo | floor((valor − 10) / 2) |
| CA | 10 + Destreza aplicada + proficiência + item (papel *armadura*) |
| Fortitude / Reflexos / Vontade | mod. de CON / DES / SAB + proficiência + item |
| Percepção | mod. de SAB + proficiência + item (papel *percepção*) |
| CD de classe | 10 + atributo-chave + proficiência + item |
| Perícias | mod. do atributo + proficiência + item − penalidade de armadura (em Acrobatismo, Atletismo, Furtividade e Ladroagem) |
| Golpes | FOR (corpo a corpo) ou DES (à distância) + proficiência + item |
| Ataque / CD de magia | atributo-chave + proficiência / 10 + o mesmo (a CD copia atributo e proficiência do ataque) |
| Volume | atravancado = 5 + FOR; máximo = 10 + FOR |

## Proficiência T/E/M/L

Cada conjunto T/E/M/L é uma lista com as opções `■`, `■■`, `■■■` e `■■■■`. O tamanho da fonte é calculado para que o avanço do ■ no Arial (0,604 em) seja igual ao espaçamento das caixas (≈ 8 pt), então cada quadrado cai na sua caixa.

Como listas não são numéricas nas fórmulas, o valor **PROF** é digitado à mão (2/4/6/8 + nível, como na legenda da ficha).

## Página 1

- **Cabeçalho:** nome (papel *nome*), jogador, XP, ancestralidade, biografia, classe, tamanho, tendência, traços, divindade, nível (papel *nível*) e pontos de heroísmo.
- **Atributos:** 6 valores e 6 modificadores calculados.
- **CA:** total; DES aplicada e limite; PROF; T/E/M/L; item; T/E/M/L de sem armadura, leve, média e pesada.
- **Escudo:** bônus, dureza, PV máximos, limiar de quebra e PV atuais.
- **PV:** máximos e atuais (papéis *PV máx.* e *PV*), temporários, ferido e morrendo; resistências e condições.
- **Salvamentos e Percepção:** total, atributo, PROF, item e T/E/M/L, mais anotações e sentidos.
- **CD de classe, velocidade e tipos de movimento.**
- **6 golpes:** arma, bônus de ataque, PROF, item, dados de dano, outros e traços.
- **Proficiência com armas:** simples, marcial e 2 "outras" com nome.
- **18 perícias:** total, PROF, T/E/M/L, item, penalidade de armadura e tema dos 2 Saberes.
- **Idiomas.**

## Página 2

- **Talentos:** áreas de texto pautadas para ancestralidade, perícia, gerais, classe e bônus. Cada linha cai numa linha da ficha; por isso a fonte é grande, cerca de 16 pt.
- **Inventário:** itens vestidos (com colunas investido e volume), preparados e outros (com volume).
- **Volume e moedas:** volume total, limites calculados e moedas PC/PP/PO/PL.

## Página 3

- Etnia, nacionalidade, local de nascimento, idade, gênero, altura e peso.
- Aparência, atitude, crenças, gostos, desgostos e bordões.
- Anotações, aliados, inimigos e organizações.
- 6 ações: nome e descrição.
- 4 ações livres ou reações: nome, e acionamento + descrição.

## Página 4

- Ataque e CD de magia.
- Nível dos truques e espaços por dia e restantes (1º a 10º círculo).
- Tradições mágicas e preparado/espontâneo.
- Pontos de foco.
- Truques, magias (2 colunas) e magias inatas: **3 linhas por magia** (nome / detalhes / detalhes).
- Magias de foco: 2 linhas por magia.

## Ações

- 1d20 + total em: Percepção, os 3 salvamentos, as 18 perícias, os 6 golpes e o ataque de magia.

## Limitações (por causa do limite de 300 campos)

Ficaram sem campo:
- o atributo de cada perícia (o total já o inclui);
- o FOR/DES, o T/E/M/L, ESPEC, o dano de FOR e Cn/Ct/Pf de cada golpe;
- os FOR das caixas de volume;
- as caixas ações, traços e página dos blocos da página 3 (escreva isso na descrição);
- PREP, ações e M/S/V das magias;
- o desenho do personagem.

A **penalidade de armadura** é digitada sem sinal; o "−" já vem impresso.

## Verificação (17/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
- Os hashes do documento e do PDF foram conferidos antes do envio. Depois de 2 ajustes (PV máximos e moedas), os campos e as ações publicados batem 100% com o gerador.
- Exportação real no site, com um guerreiro de nível 3:
  - Calculados: CA 21, Fortitude 9, Percepção 8, Atletismo 6 (com penalidade 3), golpe com espada +12.
  - Visual: os ■ das proficiências caíram nas caixas, e as magias e talentos ficaram nas linhas.
- Em "Testar ficha" com valores realistas de nível 20 (atributos 24, PROF 28, PV 320, CA 46), nenhum número foi cortado.

## v2 (17/11/2026): listas linha a linha (ADR-098)

- **O que mudou:** só nomes de campo, para o site reconhecer as listas pelo nome: `talentos_bonus` passou a `talentos_extras` (o termo final "bônus" indicava coluna auxiliar). Posição, fonte, ações e PDF são os mesmos da v1.
- **Listas:** cada linha é um item, sem quebra; o que não cabe termina em "…" e o texto inteiro aparece no tooltip. Cada item pode ter uma descrição própria (botão no canto do campo). As colunas da mesma tabela (dados, atual, custo…) também ficam uma linha por linha, sem descrição própria.
- **Altura de linha:** listas e colunas usam 1,2 × fonte na tela e no PDF exportado, por isso cada item cai na linha impressa.
- **Verificação:** campos e ações da v2 no servidor batem 100% com o gerador. Nenhuma ficha de jogador usava a v1, então a renomeação não descartou valores.

