# Cyberpunk RED — mapeamento da ficha em branco (PDF comum)

- **Sistema:** Cyberpunk RED (`cyberpunk-red`), id `84ac4ee1-52cf-489d-8b9e-069c7c8f9263`
- **Modelo:** Ficha oficial Cyberpunk RED, id `7da59b4a-c6c5-460e-9584-8a8e3a40f3fa`, **v2 publicada** (versão `2d6e50fe-bc41-45cf-9627-ef477b025519`) e **padrão do sistema**. A v1 continua publicada para fichas que ainda não migraram.
- **PDF:** `Cyberpunk RED - Ficha em Branco.pdf` (3 páginas de 1920 × 1080 pt, paisagem; MediaBox = CropBox), sha256 `ddcc4d136f07f47758f3b97e6498a829d4dfe8b61659f49c08d25125a1c937b1`
- **Conteúdo:** 295 campos e 75 ações (perto dos limites de 300 campos e 64 KB; o documento tem 60,5 KB). O formato é o mesmo do editor (compactDoc); sha256 do documento `be7cd68f904a4534f4e00df8517d1f6f560af16ec8e87d79eb6e64b460174e61`.
- **Arquivos:** `gerar-mapeamento.js` (gerador), `cyberpunk-red-ficha-v2.json` (documento publicado na v2), `cyberpunk-red-ficha-v1.json` (v1) e `previa-exportacao.png` (simulação das 3 páginas).

O PDF traz 7 campos de formulário próprios (INT, REF, DES, TEC, COOL, FVO, EMP). Eles são ignorados: o site rasteriza a página e desenha os valores por cima.

## Cálculos automáticos

| Campo | Fórmula |
|---|---|
| Base de cada perícia | nível + atributo indicado entre parênteses |
| PV máximo | 10 + 5 × ⌈(TCO + FVO) ÷ 2⌉ |
| Gravemente ferido | ⌈PV máximo ÷ 2⌉ |
| Resistência à morte | TCO |
| Humanidade máxima | EMP base × 10 |
| EMP atual | ⌊Humanidade ÷ 10⌋, limitado à EMP base (com a humanidade em branco, usa a EMP base) |

## Página 1

- **Atributos:** INT, REF, DES, TEC, COOL, FVO, MOV (papel *movimento*) e TCO, de 0 a 20.
  - SOR: pontos atuais e máximo ("DE").
  - EMP: atual (calculada) e base ("DE").
- **Identidade:** nome (papel *nome*), papel, habilidade do papel, nível (papel *nível*, 1–10) e notas.
- **Humanidade:** atual (digitada) e máxima (calculada).
- **Saúde:**
  - PV (papel *PV*) e PV máximo (papel *PV máx.*).
  - Gravemente ferido e resistência à morte (calculados).
  - Lesões críticas e vícios (áreas de texto).
- **Perícias:** as 72 linhas da ficha, cada uma com **nível** (digitado) e **base** (calculada). A base de Percepção tem o papel *percepção*.
  - Nas 8 linhas em branco (Idioma 2 e 3, Especialista Local 2 e 3, Ciência 1 e 2, Tocar Instrumento 1 e 2), o nome também é digitado.
- **Armadura:** 4 linhas com armadura, PB e penalidade. O PB da 1ª linha tem o papel *armadura*.
- **Armas:** 6 linhas com arma, dano, munição, CDT e notas.

## Página 2

- Aliados, pontos de experiência (atuais e total), reputação e eventos de reputação.
- **Fluxovida:**
  - os 12 quadros (origens, personalidade, estilos, valores, família, objetivo);
  - 3 amigos e 3 amores trágicos;
  - 3 inimigos com quem, causa, confronto e desfecho.
- **Equipamento e notas:** duas áreas pautadas de 19 linhas, uma por coluna.
- Munição, dinheiro, moda/estilo, habitação, aluguel, estilo de vida e fluxovida específico do papel.

## Página 3 (cyberware)

- Equipamento neural, ciberáudio, ciberópticos, ciberbraços e ciberpernas: caixa de marcar "base instalada" (o quadradinho ao lado do título) e duas áreas pautadas, uma para o item e outra para os dados.
- Cyberware interno, cyberware externo, cibermoda e borgware: duas áreas pautadas de 7 linhas cada.

## Áreas pautadas

O equipamento da página 2 e todas as tabelas de cyberware estão em **áreas de texto com uma linha da ficha por linha de texto**: é só escrever um item por linha.

- Para o texto cair nas linhas, a fonte é o passo das linhas ÷ 1,2. Isso dá fonte 25 nas tabelas de passo 30 e fonte 29,2 nas de passo 35, maiores que as dos outros campos.
- Desde a v2 (ADR-098), um texto que não cabe na largura não quebra mais: termina em "…" e o texto inteiro aparece no tooltip. Cada item pode ter uma descrição própria.
- Um campo por linha exigiria 150 campos a mais, acima do limite de 300.

## Ações

- Uma rolagem por perícia (72): **1d10 + base**.
- Iniciativa (1d10 + REF), teste de resistência à morte (1d10; sucesso se ficar abaixo da resistência à morte) e 1d10 genérico.
- O crítico (10 rola mais 1d10, 1 é falha crítica) não é automático.

## Limitações

- **Coluna ATR das perícias:** fica em branco. O atributo está no nome da perícia e já entra na base. Preencher a coluna custaria mais 72 campos.
- **Penalidade de armadura:** não é descontada de REF, DES e MOV.
- **Dano das armas:** é texto (ex.: `4d6`), então não vira ação de rolagem.

## Verificação (17/11/2026)

- O validador do editor não apontou nenhum problema de estrutura nem de publicação. O compactDoc é idempotente.
  - O único aviso é "papel inválido" na base de Percepção. É um aviso conhecido do validador do cliente para o papel *percepção*; o servidor aceita.
- Os hashes do documento e do PDF foram conferidos no navegador antes do envio. Depois do envio, os 295 campos e as 75 ações do servidor batem 100% com o gerador.
- Exportação real no site, com INT 6, REF 8, DES 7, FVO 6, TCO 7, EMP base 6 e humanidade 52:
  - Calculados: PV máximo 45, gravemente ferido 23, humanidade máxima 60, EMP atual 5, Percepção 10 (nível 4) e Armas Curtas 14 (nível 6).
  - Visual: todos os textos caíram nas caixas e nas linhas, nas 3 páginas.
- Em "Testar ficha" com valores máximos (atributos 10–18, PE 9999, PV −12, nomes longos), nenhum valor foi cortado.

## v2 (17/11/2026): listas linha a linha (ADR-098)

- **O que mudou:** só nomes de campo, para o site reconhecer as listas pelo nome: as 12 tabelas de cyberware passaram de `cw_<parte>` / `cw_<parte>_dados` para `equip_<parte>` / `equip_<parte>_dados` (ex.: `equip_neural`, `equip_braco_esq_dados`); as caixas `cw_<parte>_base` não mudaram. Posição, fonte, ações e PDF são os mesmos da v1.
- **Listas:** cada linha é um item, sem quebra; o que não cabe termina em "…" e o texto inteiro aparece no tooltip. Cada item pode ter uma descrição própria (botão no canto do campo). As colunas da mesma tabela (dados, atual, custo…) também ficam uma linha por linha, sem descrição própria.
- **Altura de linha:** listas e colunas usam 1,2 × fonte na tela e no PDF exportado, por isso cada item cai na linha impressa.
- **Verificação:** campos e ações da v2 no servidor batem 100% com o gerador. Nenhuma ficha de jogador usava a v1, então a renomeação não descartou valores.

