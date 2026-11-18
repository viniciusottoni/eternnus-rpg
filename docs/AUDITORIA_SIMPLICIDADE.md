# Auditoria de simplicidade — jornadas principais (17/11/2026)

Objetivo: deixar o Eternnus fácil de começar e de conduzir, sem retirar ferramentas. A referência negativa são as críticas recorrentes ao Roll20: preparação trabalhosa (mapa → grade → token → vínculo com ficha → barras → visão), luz dinâmica difícil e pesada, interface carregada, macros obscuras e celular fraco.

Status: **implementado em 18/11/2026 (ADR-100)**, exceto a medição em navegador (ver "Como medir"). Contrato em `API.md`, ajuda em `AJUDA_CONTEXTUAL.md`, evidências em `TESTES.md`.

Ajuste da auditoria: o editor de cena **já permitia** arrastar personagens da lista para o mapa (`[data-se-char]`). N2 foi implementado só na mesa. J8, parte "Voltar ao mapa": a barra inferior do celular já tem "Mapa"; a mudança implementada é a troca automática na vez do jogador.

## Método e limites

- Auditoria por leitura do código atual (branch `feature/setup`, com as alterações locais ainda não commitadas). As jornadas foram seguidas pelos módulos de `wwwroot/js` e pelos serviços chamados.
- **Não foi medido no navegador.** Esta máquina não tem Docker nem PostgreSQL, então o app não subiu. Contagens de cliques são estimativas pelo código. A seção "Como medir" descreve a verificação real.
- Não houve teste em aparelho físico.

## O que já está bom — manter

| Ponto | Onde |
| --- | --- |
| Criar campanha pede só 2 campos obrigatórios (nome e sistema). A forma de jogar vem sugerida; premissa e continuidade ficam recolhidas. | `js/campaigns.js:160` |
| Depois de criar, a visão geral mostra "Primeiros passos" com link de convite e botão de iniciar. | `js/campaign-page.js:179-181`, `js/campaigns.js:187` |
| Convite por link guarda o código enquanto a conta confirma o e-mail e leva direto à mesa quando há sessão. | `js/invite.js` |
| Interface Básica/Completa com **Básica como padrão**. Inventário único de ferramentas; paredes, luz e grade só na Completa. | `js/scene-policy.js:9-13`, `:29-64` |
| Visibilidade da cena em 4 opções em linguagem simples. | `js/scene-policy.js:69-74` |
| Detecção automática de grade e importação UVTT. | `js/grid-align-policy.js:109`, `js/map-import.js` |
| Desfazer/refazer nos editores de imagem, cena e tiles. | `js/editor-policy.js:90` |
| Dados rápidos (d4–d20) e botões de rolagem na ficha compacta, sem digitar fórmula. | `js/play-policy.js:178`, `js/sheet-compact.js` |
| Mesa no celular com três vistas: Mapa, Ficha e Conversa (jogador) / Mapa, Grupo e Conversa (mestre). | `js/play-policy.js:161-164` |
| Personagem de jogador no mapa herda nome, lado e ficha. | `js/table.js:1076` |
| 20 cenários oficiais prontos. | `Domain/BattleMaps.cs` |

A base é boa. Os problemas estão nas **costuras entre as etapas** e em **números crus** onde caberia uma escolha simples.

## Achados por jornada

### A. Criar campanha — ~4 cliques, 1 modal, 2 campos obrigatórios

- A1. O sistema começa vazio ("Escolha o sistema de RPG"). O mestre iniciante pode não saber qual escolher. `js/campaigns.js:119`
- A2. O bloco "Como esta campanha começa aqui?" (origem, continuidade, número mínimo da próxima sessão) aparece aberto na criação, embora o padrão "Nova, do zero" atenda à maioria. `js/campaigns.js:160`
- A3. Não existe ponto de partida com conteúdo. A one-shot cria uma mesa vazia; não há aventura de exemplo com cena, NPCs e mapa. `js/one-shots.js:67`

### B. Preparar a primeira cena — ~5 cliques, 2 modais

- B1. **Desencontro entre preparação e sessão.** O mestre prepara uma *cena* na Preparação, mas "Iniciar nova sessão" pede um *mapa*: `StartSessionInput` não recebe cena (`Application/SessionService.cs:5`). A cena preparada só é apresentada depois, pela aba Cenas da mesa. São dois conceitos e dois passos para a mesma intenção.
- B2. Luz em números crus: "Raio de luz plena (casas)" na Básica; penumbra, cor e intensidade na Completa (`js/scene-editor.js:1923-1927`). Sem predefinições.
- B3. Para colocar personagens no mapa: escolher a ferramenta, clicar na casa, depois "Colocar aqui" numa lista (`js/scene-editor.js:1915-1921`). Não dá para arrastar da lista para o mapa. O arrastar existente só serve para imagens e arquivos (`js/image-drop.js:173`).

### C. Convidar, preparar fichas e abrir a sessão — ~3 cliques + digitação

- C1. "Nome da sessão" é **obrigatório** no modal de início (`js/campaign-page.js:244`), mas o número já é automático. Para quem só quer jogar, é uma decisão a mais.
- C2. "Primeiros passos" é uma lista estática. Não mostra quem aceitou o convite, quem tem ficha nem se há cena pronta. Inclui "Capítulos" (opcional) no mesmo peso que o essencial. `js/campaign-page.js:179-181`
- C3. O modal de início faz 5 chamadas antes de abrir (mapas, sessões, capítulos, sessões passadas e o módulo de capítulos). `js/campaign-page.js:230-238`

### D. Conduzir na mesa

- D1. Luz e visão do marcador em números ("Luz (casas)", "Visão própria (casas)", percepção, sentidos em texto livre). `js/table.js:1077`. O raio das tochas dos cenários também é numérico. `js/fog-policy.js:252`
- D2. Vincular ficha a um NPC na mesa "não pode ser desfeito aqui" (`js/table.js:1073`). Isso gera medo de errar.
- D3. Desfazer na mesa só vale para movimento e ficha (`js/play-policy.js:149-153`). Revelar névoa, adicionar e remover marcador não têm desfazer.
- D4. Não há atalho global para ferramentas ou ações; o único atalho global é Esc no menu (`js/layout.js:169`). O mestre depende de menus, abas e grupos.

### E. Jogador no celular

- E1. O fluxo convite → cadastro → confirmação → ficha → mesa existe e é curto pelo código. A quantidade real de toques e a legibilidade em 390 px só podem ser confirmadas no aparelho.
- E2. Na mesa compacta, abrir Trilha ou Cenas troca a vista para Conversa (`js/table.js:1293`, `:1302`). Faz sentido, mas o jogador precisa voltar ao Mapa manualmente na sua vez.

## Plano

Prioridade: **P1** = maior ganho na primeira experiência; **P2** = condução; **P3** = escala e governança. Esforço: P (até 1 dia), M (2–4 dias), G (1–2 semanas).

### Ajustes (mudam o que existe)

| # | Ajuste | Prior. | Esforço | Arquivos principais |
| --- | --- | --- | --- | --- |
| J1 | Nome da sessão **opcional**; vazio vira "Sessão N". Objetivo e capítulo recolhidos em "Mais opções". | P1 | P | `js/campaign-page.js`, `Application/SessionService.cs`, `docs/API.md` |
| J2 | "Primeiros passos" vira checklist com estado: jogadores que entraram (x de y), fichas vinculadas, cena pronta (opcional), botão Iniciar. Capítulos saem da lista. Usa dados que `detail` já traz (`members`, `characters`). | P1 | P | `js/campaign-page.js`, `help/campanhas.js` |
| J3 | Na criação, recolher "Como esta campanha começa aqui?" em um `details` fechado. Abrir só quando a origem for "Já está em andamento". | P1 | P | `js/campaigns.js` |
| J4 | Sistema de RPG com padrão sugerido (o mais usado ou "Sistema livre"), com texto "você pode trocar depois". | P1 | P | `js/campaigns.js` |
| J5 | **Iniciar sessão a partir de uma cena preparada.** O modal oferece primeiro "Cenas prontas" e depois "Só um mapa". A cena escolhida é apresentada na abertura, dentro da mesma transação do `SessionService`. | P1 | M | `Application/SessionService.cs`, `Features/Play/PlayEndpoints.cs`, `js/campaign-page.js`, `js/map-picker.js`, testes de sessão |
| J6 | **Predefinições de luz e visão** no lugar do número na Básica: "Vela", "Tocha", "Lanterna", "Fogueira" (foco) e "Sem visão no escuro", "Visão no escuro curta", "Visão no escuro longa" (marcador). Os números ficam em "Personalizar" e na Completa. Valores em casas, sem presumir regra de um sistema específico. Política pura testada. | P2 | M | `js/scene-policy.js` (ou `light-presets-policy.js` novo), `js/scene-editor.js`, `js/table.js`, `docs/NEVOA_ILUMINACAO.md` |
| J7 | Vínculo de ficha do NPC com troca e remoção na própria mesa, pelo `SessionService` e registrado como evento. | P2 | M | `js/table.js`, `Application/SessionNpcSheets.cs` |
| J8 | Ao terminar Trilha ou Cenas no celular, oferecer "Voltar ao mapa"; na vez do jogador, abrir o Mapa automaticamente se ele estava em Conversa (sem roubar foco de um formulário aberto). | P2 | P | `js/table.js`, `js/play-policy.js` |
| J9 | Modal de início com menos chamadas: um endpoint de "contexto de início" (próximo número, mapas, cenas e capítulos) ou carregar capítulos só ao expandir "Mais opções". | P3 | P | `Features/Play/PlayEndpoints.cs`, `js/campaign-page.js` |

### Novas implementações

| # | Implementação | Prior. | Esforço | Observações |
| --- | --- | --- | --- | --- |
| N1 | **Aventura inicial pronta.** Opção "Começar com uma aventura de exemplo" na criação de campanha e de one-shot. Cria uma cena com um cenário oficial, 2 NPCs com ficha, uma página de premissa e um objetivo. Conteúdo copiado (nunca referência mutável), dono = mestre, dentro das quotas. | P1 | G | Serviço de aplicação próprio; reutilizar criação de cena, NPC e página; texto original do Eternnus. |
| N2 | **Arrastar personagem ou NPC da lista para o mapa** no editor de cena e na mesa. Reaproveitar o padrão `ASSET_DND` de `image-drop.js`. Alternativa por teclado: selecionar na lista e Enter na casa focada. | P2 | M | Escrita na mesa pelo `SessionService`; acessibilidade obrigatória. |
| N3 | **"Colocar o grupo"**: um clique põe todos os personagens dos jogadores no ponto de entrada da cena (os pontos de entrada já existem em `scene-editor.js:517`). | P2 | P | Depende de N2 só para a interface; pode vir antes. |
| N4 | **Busca de ações (Ctrl+K / "/")** no editor e na mesa: lista de ferramentas do `TOOL_INVENTORY` e ações frequentes ("Adicionar NPC", "Trocar cena", "Pedir teste", "Iniciar turnos"). Respeita papel e interface; na Básica, ferramentas da Completa aparecem marcadas e trocam o modo ao escolher. | P2 | M | Novo `command-palette.js` + política pura; função de descarte no roteador. |
| N5 | **Desfazer na mesa** para revelar ou cobrir névoa e para adicionar ou remover marcador, como evento compensatório no `SessionService` (mesmo padrão de `canUndo`). | P3 | M | Não criar estado em memória; teste de corrida. |
| N6 | **Aviso de peso da cena** para o mestre: quantidade de paredes, luzes e imagens; acima do limite medido, mostrar aviso e sugestão ("unir paredes", "reduzir luzes"). O limite sai de medição real, sem prometer números antes. | P3 | M | Medir primeiro com Playwright + perfil de desempenho. |

### Regras de governança (para não voltar a complicar)

- G1. Toda ferramenta nova entra no `TOOL_INVENTORY` com `basic` decidido no ADR. Um teste limita a quantidade de ferramentas da Básica por local (editor e mesa) ao valor atual. Aumentar exige ADR.
- G2. Toda funcionalidade nova declara a jornada que afeta e não pode aumentar seus cliques obrigatórios sem justificativa no ADR.
- G3. Campos obrigatórios novos precisam de valor padrão ou justificativa.
- G4. Incluir G1–G3 em `AGENTS.md` quando aprovadas.

## Fora de escopo agora

- Linguagem de script ou macros.
- Novas camadas de mapa ou um terceiro modo de interface.
- Cobrar por névoa, luz ou visão.

## Ordem sugerida

1. **Rodada 1 (P1 rápido):** J1, J2, J3, J4. Somente frontend e um ajuste de contrato. Cerca de 2 dias.
2. **Rodada 2 (P1 estrutural):** J5 e N1. Juntas, fazem "criar → jogar" ter um caminho único com conteúdo.
3. **Rodada 3 (condução):** J6, N3, N2, J8, J7.
4. **Rodada 4:** N4, N5, N6, J9 e as regras G1–G4.

## Como medir

Antes da Rodada 1 e depois de cada rodada, com PostgreSQL local e Playwright (desktop 1366 px e celular 390 px):

| Jornada | Métrica | Meta proposta |
| --- | --- | --- |
| Criar campanha até a visão geral | cliques e campos obrigatórios | ≤ 3 cliques, ≤ 2 campos |
| Campanha nova até mesa aberta com cena | cliques, modais e decisões | ≤ 5 cliques, ≤ 2 decisões (com N1 + J5) |
| Colocar o grupo no mapa | cliques | 1 (N3) |
| Acender uma tocha | cliques e campos digitados | 2 cliques, 0 números (J6) |
| Jogador: link de convite até a primeira rolagem | toques, sem contar o e-mail | medir; meta definida após a primeira medição |

Registrar as medições em `TESTES.md`. Um teste em aparelho físico Android e iPhone continua necessário para a jornada E.
