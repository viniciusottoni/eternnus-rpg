# Validação

## Revisão de modais, ajuda e Mapas e cenários (ADR-050) — 9 de novembro de 2026

Validação local com bancos PostgreSQL exclusivos de teste (harness), Chrome headless, desktop 1440×900 e viewport móvel 390×844. A viewport não equivale a aparelho físico, e não houve teste com leitor de tela real.

| Verificação | Resultado |
| --- | --- |
| `dotnet build Eternnus.sln` | 0 erros, 0 avisos |
| `dotnet test tests/Eternnus.Tests --filter CampaignAssets` | 7 passaram, incluindo `Folder_rename_keeps_place_and_requires_master` |
| `node --test tests/*.test.mjs` | 137 passaram |
| `node tests/campaign-assets.mjs` | 84 verificações (renomear pasta: mestre 200, nome em branco 400, jogador 403, fora da campanha 404) |
| `node tests/modals-ui.mjs` (novo) | 59 modais abertos (desktop + celular) sem rolagem no diálogo, transbordo, `fieldset` padrão, ⓘ grande, tooltip no X ou “Fechar” duplicado; capturas e folhas de contato em `artifacts/qa/modais/` |
| `node tests/help-ui.mjs` | 422 verificações, 40 capturas: ⓘ ≤ 20 px e a até 16 px do texto, popup centralizado com fundo escurecido e X, foco/Esc, editor de cena sem rolagem externa, “Continuar” compacto, sem erro de CSP |

Complemento (formulários, foco e fade):

- `node tests/forms-ui.mjs` (novo): 64 páginas (32 rotas × desktop/celular) sem desalinhamento nem foco cortado.
- `node tests/modals-ui.mjs`: 61 modais (incluindo o editor de cena), agora também com alinhamento e foco.
- `node tests/help-ui.mjs`: 422 verificações.
- `node --test tests/*.test.mjs`: 137 passaram.
- Medição de opacidade: o modal e a ajuda entram e saem em cerca de 160 ms, com `display: none` só após a opacidade chegar a 0.
- Limite: a verificação de foco desliga a transição do elemento durante a leitura, porque com movimento reduzido a regra global de 0,01 ms faria ler o valor inicial.

Correção encontrada pela suíte: no celular, o `<span class="sr-only">` (posição absoluta) de cabeçalhos de `.data-table` escapava da rolagem horizontal e alargava o viewport de layout para 799 px, o que descentralizava diálogos e popups no Painel admin. Agora `.data-table-wrap` tem `position: relative`.

## Catálogo de músicas do servidor e trilha sonora da sessão (ADR-049) — 9 de novembro de 2026

Validação local com bancos PostgreSQL exclusivos de teste e diretório de áudio temporário (`Music__Directory` do harness). Nenhuma partida real, ClamAV real ou aparelho físico foi usado. Revalidado depois da mudança de direção: catálogo global enviado pelo Admin; mestre só busca e reproduz.

| Verificação | Resultado |
| --- | --- |
| `dotnet build Eternnus.sln` | 0 erros, 0 avisos |
| `dotnet test tests/Eternnus.Tests` | 691 passaram, 0 falhas. Novos: `AudioProbeTests` (MP3/OGG/M4A sintéticos, trilha oficial, PNG/executável/arquivo truncado/poliglota recusados), `SoundtrackStateTests` (posição, pausa, fim, repetição, duração desconhecida, relógio anterior), `MusicCatalogTests` (busca paginada só com campos de apresentação, página extrema, quotas de faixas e bytes, arquivo repetido 409, auditoria de envio/renomeação/exclusão, revisão, exclusão do arquivo, varredura de órfãos, comandos com versão 409, faixa inexistente 404, entrada tardia, bytes só para participante presente e faixa selecionada, exclusão em uso 409, encerramento limpa a trilha) |
| `node --test tests/*.test.mjs` | 137 passaram; `soundtrack-policy.test.mjs` (9): posição esperada, estimativa de relógio, correção de desvio com histerese/intervalo, ordem dos estados, textos de estado, validação local, preferência pessoal, lista PWA e cache v28 sem `skipWaiting` |
| `node tests/soundtrack.mjs` | 154 verificações PostgreSQL: gestão só para Admin com MFA (mestre/jogador/visitante 403), 415 para PNG renomeado e executável, upload acima do limite recusado (413 ou conexão encerrada pelo Kestrel), campo extra 400, arquivo repetido 409, duração calculada, nomes opacos no disco, auditoria, busca do mestre só com `id/title/format/durationMs`, página extrema sem erro, revisão, prévia do Admin com Range, Range 206/sufixo/416 com bytes idênticos para o jogador, `no-store`/`nosniff`, consulta ao vivo acordada pelo comando (< 5 s), eventos `music` fora do payload do jogador, comandos concorrentes 200/409, pausa/busca/retomada, entrada tardia, seleção na mesa × exclusão no catálogo serializadas, parada, encerramento sem bytes, quota de 200 faixas, catálogo preservado ao excluir campanha |
| Integrações existentes | `sessions`, `campaign-assets`, `table-play`, `scene-editor`, `admin` e `migrations` (banco legado preservado) aprovados |
| `node tests/soundtrack-ui.mjs` | 48 verificações em dois Chrome headless independentes (mestre e jogador, cookies separados; catálogo aberto por um Admin), 1.440 × 900 e 390 × 844; sem erro de página/CSP; capturas em `artifacts/qa/trilha-sonora/` |

Medidas da última execução (posição do `<audio>` − posição esperada pelo estado do servidor): mestre × jogador tocando 76 ms; após selecionar −259/−225 ms; pausados −69/0 ms; após buscar 1:00 0 ms; após retomar −215 ms; após desvio artificial de +6 s −174 ms; após reconectar (contexto offline enquanto o mestre avançava 20 s) −386 ms; após recarregar e ativar −654 ms (dentro da tolerância de 700 ms; reduzido aos poucos pela velocidade). Os dois navegadores rodaram na mesma máquina e no mesmo relógio: não medem latência de rede real nem diferença de relógio entre aparelhos.

O UI verificou: Painel admin → Músicas (lista, quota, busca e busca vazia, envio pela interface com título sugerido, exclusão bloqueada da faixa tocando com motivo visível), painel da mesa (busca no catálogo e seleção), trilha global oculta durante a sessão e restaurada ao parar, “Ativar áudio da sessão” e alinhamento após o clique, jogador sem comandos do mestre, silenciar/volume pessoais sem afetar o mestre, pausa, busca na faixa, repetição, correção de desvio, reconexão, recarga, alvos de 44 px e controles acima da barra inferior no celular, descarte do áudio ao sair da mesa.

Limitações: o Chrome sob automação concede ativação nas avaliações do Playwright, então o bloqueio de reprodução automática do jogador foi **emulado** por script de teste (`play()` rejeita com `NotAllowedError` até um clique confiável). A política real de Safari/Chrome em aparelho, iOS (volume fixo), suspensão física do aparelho e aba oculta real não foram verificados. ClamAV usou a exceção de desenvolvimento (`Uploads:AllowUnscanned`). Carga não medida.

## Editor de cenas e interface Básica/Completa (ADR-048) — 8 de novembro de 2026

Validação local, com bancos PostgreSQL exclusivos de teste (nenhuma partida real foi usada):

| Verificação | Resultado |
| --- | --- |
| Compilação .NET | Sem erros nem avisos de compilação |
| `SceneEditorTests` (SQLite, novo) | 12 passaram: arranjo privado sem apresentar e validado; salvar não muda a mesa; aplicar por partes com revisão obsoleta 409; camada na mesa fica pendente, aplicar preserva exploração e portas; duas cenas no mesmo mapa independentes; retomar × reiniciar; imagem sem grade; grade com deslocamento; improviso e "Salvar como cena"; sessão anterior sem snapshot; regras puras de `ScenePrep` |
| Classes .NET impactadas | 116 passaram (`SceneEditor`, `SessionService`, `TableFog`, `TablePlay*`, `CampaignAssets`, `TableRules`, `UploadLimits`, `Profile`, `TemporaryImage`) |
| JavaScript | `scene-policy.test.mjs` (9, novo), `pwa`, `service-worker`, `frontend`, `fog-policy`, `play-policy`: 42 passaram |
| `node tests/scene-editor.mjs` (novo) | 83 verificações PostgreSQL: preferência de interface; preparação privada fora do payload do jogador; snapshot do texto; corrida edição × aplicar sem 500 e sem texto não aplicado; duas gravações concorrentes da preparação (200/409); imagem sem grade só durante a apresentação; retomar; improviso |
| Integrações existentes | `migrations` (banco legado preservado), `table-fog` 73, `table-play` 88, `campaign-assets` 79 |
| QA de navegador (`artifacts/qa-scenes.mjs`) | 21 capturas em 1.440 × 1.000 e viewport móvel 390 × 844, sem overflow horizontal nem erro de página |

O QA verificou:
- editor iniciando em "Selecionar e mover", com Básica por padrão;
- escolha por miniatura e marcador adicionado pelo teclado (setas + Enter);
- troca Básica → Completa preservando nome digitado, seleção e "Alterações não salvas";
- simulação rotulada e salvar sem alterar a mesa;
- aviso "Alterações não aplicadas à mesa" e aba Cenas com prévia privada;
- paleta ao vivo agrupada e aplicação explícita do texto;
- jogador sem controle de interface nem notas privadas.

Capturas em `artifacts/qa/scenes-*.png` e relatório em `scenes-report.json`.

A inspeção visual das capturas levou a três correções:
- posição estável de "Revelar/Cobrir área" nas duas interfaces;
- tochas e braseiros oficiais deixaram de contar como "ajuste avançado";
- botões do celular esticados pelo motivo de indisponibilidade da ajuda contextual.

`artifacts/qa-play.mjs` foi atualizado para os novos seletores e reexecutado: 23 capturas, sem overflow horizontal nem erro de página.

**Complemento (mesmo dia):**
- simulação do editor com a visão da ficha do personagem escolhido (`simulateView`);
- "Aplicar" com a parte opcional `tokens` e atalho para "Reiniciar cena" quando o cenário mudou;
- mesa no celular com o mapa logo após o topo e aviso de pendência numa linha;
- controle de Interface compacto;
- reabrir a aba Cenas recarrega a lista;
- cache v26.

| Verificação | Resultado |
| --- | --- |
| Compilação .NET | Sem erros nem avisos |
| `SceneEditorTests` | 13 passaram (novo: recolocar marcadores preserva exploração, incrementa a revisão; 400 sem parte; 409 em cena de texto) |
| Classes .NET impactadas (`SceneEditor`, `SessionService`, `TableFog`, `TablePlay*`, `Preparation*`, `CampaignAssets*`) | 63 passaram |
| JavaScript (todos os `tests/*.test.mjs`) | 128 passaram; `scene-policy.test.mjs` cobre `simulateView` (parede bloqueia a visão, luz de foco, revelação manual, filtro de marcadores) |
| `node tests/scene-editor.mjs` | 92 verificações PostgreSQL, em duas execuções. Novo: corrida "recolocar × mover" sem 500 e sem marcador duplicado. A corrida de gravação da preparação passou a usar duas edições reais diferentes; antes, uma das gravações não mudava nada e o resultado dependia da ordem. |
| `artifacts/qa-scenes.mjs` | 23 capturas (novas `editor-simulation-character-desktop`, `editor-simulation-group-desktop`), asserções de mapa visível sem rolar no celular, grupo do mestre fora da vista Mapa, descrição da interface fora do topo e "Recolocar" desmarcado |
| `artifacts/qa-play.mjs` | 23 capturas, sem overflow horizontal nem erro de página |

Não houve teste em aparelho físico, medição de carga nem publicação.

## Ajuda contextual (ADR-047) — 8 de novembro de 2026

Modelo e inventário em [AJUDA_CONTEXTUAL.md](AJUDA_CONTEXTUAL.md). Integração inclui o editor e o uso de mapas/cenas Básica/Completa do trabalho paralelo (ADR-048). Não houve alteração de backend, contrato HTTP ou migração por esta entrega.

| Comando executado | Resultado real | Evidência |
| --- | --- | --- |
| `dotnet build Eternnus.sln --nologo -v minimal` | Aprovado; 0 avisos, 0 erros | `artifacts/help-build.log` |
| `dotnet test Eternnus.sln --logger 'trx;LogFileName=help-contextual.trx' --results-directory artifacts/test-results --nologo -v minimal` | 675 passaram; 0 falhas, 0 ignorados | `artifacts/help-dotnet.log`, `artifacts/test-results/help-contextual.trx` |
| `node --test tests/*.test.mjs` | 128 passaram; 0 falhas | `artifacts/help-frontend.log` |
| `node tests/help-ui.mjs` | 271 verificações; 34 capturas; nenhum erro de página/CSP | `artifacts/qa/ajuda-contextual/report.json`, `accessibility.json` |
| `node tests/help-interactions.mjs` | 18 verificações; nenhuma falha; mais 3 capturas | `artifacts/qa/ajuda-contextual/interactions.json` |

Os 13 testes unitários novos estão em `help-policy.test.mjs`, `help-catalog.test.mjs` e `help-fields.test.mjs`: chaves/limites, audiência por papel/contexto, rotas internas, referências do catálogo, congelamento/texto puro, ausência de title nativo, limite de tooltip, arquivos públicos explicitamente enumerados, escape e compatibilidade de campos/senhas e paginação indisponível. O teste de integridade exige ponto de acesso para os 65 conceitos.

Playwright usa Chrome/Chromium local, viewports de **1440 × 900** e **390 × 844**, PostgreSQL exclusivo criado pelo harness e contas sintéticas. `help-ui.mjs` usa movimento normal no desktop e `reducedMotion: reduce` no celular. Verificou teclado em uma tela de cada uma das onze áreas; nomes por snapshots de acessibilidade; tooltip por hover e foco, permanência no próprio tooltip e Esc sem mover foco; toque sem tooltip; ⓘ focado/expanded, Esc e retorno; popup dentro do modal e na mesa imersiva; folha móvel acima da barra fixa; editor Básica/Completa; ausência de overflow horizontal e de erros de CSP.

As interações adicionais verificaram carregando antes da chegada do catálogo, falha e nova tentativa sem toast, troca de conceito no único popup, clique fora e retorno de foco, chave desconhecida omitida, substituição real do gatilho pela consulta ao vivo, foco no gatilho novo, primeiro Esc fechando ajuda e segundo Esc cancelando o modo do mapa, bloqueio de aria-disabled antes do handler, remoção do gatilho sem foco no body e histórico aberto diretamente reconhecendo o Mestre. As 37 capturas finais ficam em `artifacts/qa/ajuda-contextual/`; capturas de tentativas intermediárias foram removidas.

Pré-requisitos para repetir o QA: ambiente Docker/PostgreSQL do harness, assembly Debug e Playwright em `artifacts/qa-runtime` (mesmo runtime das revisões anteriores; somente ferramenta de teste, sem dependência nova no produto). As portas isoladas são 5258 e 5259. Os contextos bloqueiam service workers para testar importação/falha sem mistura de caches; a lista e as exclusões da PWA são verificadas pela suíte frontend. O ciclo real de instalação/atualização da PWA não foi repetido nesta revisão.

Limitações: sem leitor de tela real, aparelho físico, teclado virtual, Safari/iOS, credenciais SMTP/SSO reais, publicação ou medição de carga. A revisão local e os snapshots não substituem esses testes. Abertura compartilhada permanece em 3.000 ms.

Esta página define como validar a entrega e manter o comportamento nas próximas alterações. Resultados de execução devem ser registrados pelo trabalho que executou os comandos; a presença de um teste no repositório não significa que ele passou no ambiente de produção.

## Condução independente do sistema (ADR-046) — 8 de novembro de 2026

Validação local, com bancos PostgreSQL exclusivos de teste:

| Verificação | Resultado |
| --- | --- |
| Compilação .NET | Sem avisos nem erros |
| Testes .NET | 663 passaram, incluindo `TablePlayRulesTests` (regras puras) e `TablePlayServiceTests` (SQLite) |
| JavaScript | 106 passaram, incluindo `play-policy.test.mjs` e a paridade de `TableSettings.PlayMode` |
| `node tests/table-play.mjs` | 88 verificações PostgreSQL: convite → verificação → personagem → mesa; modo livre e tático; rolagens às cegas e privadas sem vazamento; resposta concorrente a pedido de teste (200/409); arquivar × iniciar concorrentes; espera recuperável da one-shot; reconexão; conversão com quotas; limpeza após o prazo |
| Integrações existentes | `sessions` 185, `campaign-assets` 79, `account-limits` 79, `progress` 133, `table-fog` 73, `character-sheets` 200, `sheet-templates` 156 |
| `smoke.mjs` | **Falha pré-existente**: espera excluir uma campanha com sessão ativa (204), mas `CampaignService.DeleteAsync` já recusava com 409 no `HEAD`. Não alterado neste trabalho. |
| QA de navegador (`artifacts/qa-play.mjs`) | 23 capturas em 1.440 × 1.000 e 390 × 844, sem overflow horizontal nem erro de página |

O QA verificou:
- início com "Retomar mesa";
- primeiros passos;
- diário e cenas;
- mesa do mestre: rolagens, pedidos e "Mais ferramentas";
- mesa do jogador no modo livre, sem "Encerrar a vez";
- ficha resumida sem vida e nível artificiais;
- construtor de rolagens;
- troca Mapa/Ficha/Conversa preservando o texto digitado;
- convite por link no celular.

Capturas em `artifacts/qa/play-*.png` e relatório em `play-report.json`.

Mudança de expectativa: `campaign-assets.mjs` e `SessionServiceTests` agora esperam que a saída do mestre de uma one-shot **não** apague a mesa; `/end` apaga.

Não houve publicação, teste de carga, validação em aparelho físico nem medição de ganho de usabilidade.

## Jornada, atlas e acabamento visual — 8 de novembro de 2026

Validação desta alteração, em ambiente local com bancos PostgreSQL exclusivos de teste:

| Verificação | Resultado |
| --- | --- |
| Compilação .NET | Sem avisos ou erros |
| Testes .NET | 610 passaram; TRX em `artifacts/test-results/evolution.trx` |
| JavaScript | 86 passaram, incluindo marcos sugeridos e paridade da legenda tática |
| Integração progressão | 133 verificações PostgreSQL |
| Integração sessões | 184 verificações PostgreSQL |
| Integração Guilda | 218 verificações PostgreSQL |
| QA de navegador | 54 verificações de página/viewport em duas passagens; sem overflow horizontal ou erros de página |
| Mapas | Oito cenários exibidos no catálogo; sete tilesets conferidos na mesa, com movimento normal e reduzido |
| Revisão de diff | Sem erros de espaço em branco |

As 535 verificações HTTP cobrem XP, idempotência, tetos diários, histórico reconhecido sem mutação em GET, cartão público, auditoria administrativa, fechamento explícito de one-shot preservando XP após cascade, sessão única, permissões, presença, turnos e Guilda. Os testes de mapas verificam retangularidade, símbolos válidos, ao menos seis entradas e conectividade de todas as casas caminháveis. Limitações de concorrência do resumo de XP permanecem documentadas em `PROGRESSAO_CENARIOS.md`.

QA com Chrome/Playwright em 1.440 × 1.000 e 390 × 844: início, login/cadastro, campanhas, one-shots, personagens/ficha, conta, biblioteca, suporte, Guilda, progressão/ranking, administração/fichas-modelo, campanha/atlas/recursos/configurações, sessões, resumo/linha do tempo e mesa. Conferidos busca sem acentos no seletor, troca real de mapa e preferência de movimento. Revisão visual dos screenshots incluiu progressão, atlas, mapas, login móvel, ficha móvel e histórico. Não equivale a validar todos os estados de todas as páginas ou aparelhos físicos.

Evidências: `artifacts/qa/evolution-*.png`, `evolution-report.json` e `evolution-extra-report.json`; roteiro local `artifacts/qa-evolution.mjs` e sua opção `--extra`. Reprodução dos testes: `dotnet test Eternnus.sln`, `node --test tests/*.test.mjs`, `node tests/progress.mjs`, `node tests/sessions.mjs`, `node tests/guild.mjs`.

Não houve publicação em produção, alteração do esquema, teste de carga, validação SMTP/SSO real ou instalação em dispositivo físico. Dados existentes e alterações anteriores do checkout foram preservados.

## Preparação

- .NET SDK 10 e dependências restauradas.
- Node.js 22+ para os testes JavaScript e de integração.
- Python 3 no PATH para decodificar mensagens MIME no teste de integração.
- Docker Desktop/PostgreSQL local funcionando para testes que dependem de migrações, transações e bloqueios reais.
- Sem credenciais ou mensagens reais nos fixtures. Banco de teste deve ser separado do banco normal.

## Verificação de build

```powershell
dotnet restore Eternnus.sln
dotnet build Eternnus.sln
dotnet list apps/Eternnus.Web package --vulnerable --include-transitive
```

O projeto trata warnings de compilação como erros. Revisar avisos de dependências e não baixar proteções apenas para obter um build verde.

Executar o build Debug antes da integração, que inicia diretamente seu assembly.

## Suítes automatizadas

```powershell
dotnet test tests/Eternnus.Tests/Eternnus.Tests.csproj --nologo
node --test tests/auth.test.mjs tests/frontend.test.mjs tests/loading.test.mjs tests/pwa.test.mjs tests/service-worker.test.mjs tests/session-policy.test.mjs
node tests/smoke.mjs
node tests/login-session.mjs
node tests/sessions.mjs
```

| Suíte | Escopo | Limite |
| --- | --- | --- |
| `Eternnus.Tests` | Identidades externas, verificação, colisão de e-mail, avatares, security stamp, dados, regras da mesa (`TableRulesTests`) e casos de uso da sessão em SQLite (`SessionServiceTests`: uma sessão ativa, visibilidade, turno, movimento, presença, vida, encerramento e consulta ao vivo). | Não faz login real em Google/Discord; SQLite não reproduz bloqueios do PostgreSQL. |
| `frontend.test.mjs` | Regras puras de prazo de abertura, acesso e ações de campanha. | Não substitui revisão no navegador. |
| `pwa.test.mjs` | Fronteiras da lista permitida de cache: origens, métodos, query strings e arquivos públicos. | Não comprova instalação em aparelho. |
| `service-worker.test.mjs` | Código real do worker em ambiente isolado: bypass de API/OAuth, fallback de link sensível, cache público e instalação sem cookies. | Plataforma de service worker simulada; requer revisão no navegador. |
| `session-policy.test.mjs` | Regras puras da mesa no cliente: rotas, comandos habilitados, alcance, barras de vida, feeds e recuo da consulta ao vivo. | Não substitui revisão no navegador. |
| `smoke.mjs` | Fluxos HTTP com PostgreSQL real, links de e-mail, isolamento, CRUD, permissões, concorrência e regressões de jogo. | Não mede carga nem entrega SMTP externa. |
| `login-session.mjs` | Persistência explícita, cookie sem persistência no login comum, novo cliente HTTP, saída global com CSRF, revogação entre dispositivos, isolamento de outra conta e MFA do administrador com PostgreSQL real. | Usa banco exclusivo; OAuth real exige credenciais. |
| `sessions.mjs` | Mesa com PostgreSQL real e três contas: abertura concorrente (uma vence, outra `409`), campanha online, entrada com ficha, long-poll acordado por escrita, turnos, ações e rolagens, movimento, mapa/marcadores, vida e ficha com antes/depois, notas privadas, presença, histórico/busca, encerramento e perda de acesso. | Não mede carga nem múltiplos processos. |

Com a prévia local executando em `http://localhost:5180`, conferir os arquivos efetivamente servidos:

```powershell
node tests/pwa-http.mjs
```

`pwa-http.mjs` permite indicar outra origem por `ETERNNUS_PREVIEW_URL`. Confere manifest, identidade/escopo/entrada, dimensões dos ícones, MIME/cache do worker e ausência de cache HTTP para dados de conta/API. Ele não inicia o servidor e não instala a aplicação no sistema operacional.

`smoke.mjs` e `sessions.mjs` compartilham `tests/support/harness.mjs` (banco exclusivo, servidor em porta própria — 5191 e 5193 —, pasta de e-mail temporária e limpeza dos próprios recursos).

O smoke espera o contêiner `eternnus-postgres-dev`, a conexão local da porta 54329 e a porta 5191 livre para seu processo. O nome do contêiner pode ser indicado por `ETERNNUS_TEST_CONTAINER`; a configuração de conexão do script deve continuar coerente. Ele cria um banco com prefixo `eternnus_test_` e identificador único, aplica migrações, grava mensagens em pasta temporária e elimina apenas seus próprios recursos ao finalizar. Não aponta para o banco normal `eternnus`.

Os ajustes auxiliares de cooldown/inspeção SQL ocorrem somente no banco isolado de teste. Eles não introduzem endpoint de bypass na aplicação. Se o processo de teste for interrompido externamente, revisar os recursos com o prefixo específico antes de remover qualquer resíduo; nunca excluir bancos ou volumes por um padrão amplo.

### Registro desta entrega — sessões e mesa ao vivo

Em 7 de novembro de 2026 (UTC), em contêiner Linux com .NET SDK 10.0.114, PostgreSQL 16 e Chromium/Playwright, sobre a árvore já mesclada com o loading universal e o perfil/avatares desenvolvidos em paralelo: build sem avisos (warnings como erro), 80 testes .NET, 25 testes JavaScript (incluindo os 9 da mesa em `session-policy.test.mjs`), 211 verificações de `smoke.mjs`, 179 de `sessions.mjs` e 37 de `pwa-http.mjs`; os arquivos da lista do service worker responderam `200`. A migração `LiveSessions` (posterior a `UserAvatars`) foi aplicada sobre um banco no esquema anterior com sessões e ficha existentes (numeração, encerramento, objetivo de 5.000 caracteres preservado e atributos padrão conferidos), o script idempotente foi aplicado duas vezes em banco vazio e não restaram mudanças pendentes de modelo.

A revisão no navegador cobriu, em 1.440 × 900 e 390 × 844: lista com selo ONLINE (mestre e jogador), página da campanha com sessões, modal de nova sessão com miniaturas, mesa do mestre e do jogador, ficha aberta pelo avatar, ataque com escolha de ação, modo de movimento com alcance, arauto de turno, ajuste de vida refletido no outro navegador, troca de mapa, véu de encerramento e histórico — sem erros de console.

Essa execução não ocorreu no Windows/IIS nem com PostgreSQL 17 do `compose.yaml`. Antes de publicar, executar novamente os comandos acima no ambiente de desenvolvimento normal.

### Registro local da etapa anterior

Em 6 de novembro de 2026, a execução comunicada pela suíte desta entrega passou em 27 testes .NET, 14 testes de frontend/PWA e 192 verificações de integração com PostgreSQL real, além de 37 verificações HTTP dos arquivos e contratos da PWA. Os 14 testes de frontend incluem cinco de regras da interface, cinco de política de cache e quatro de comportamento do worker em ambiente isolado. O total de verificações do smoke pode variar conforme o vencedor das corridas deliberadas de concorrência; usar o total impresso pela própria execução. As verificações incluíram bloqueio após tentativas inválidas, `429`, rejeição de corpo acima de 64 KiB, invalidação de sessão após troca de senha e entrada/exclusão concorrentes.

A revisão no navegador conferiu cadastro, estado pendente, confirmação por link, liberação de recursos e criação/edição de campanhas. Em janela móvel de 390 × 844, a barra inferior permaneceu fixa com altura de 68 px e não houve overflow horizontal do conteúdo. Imagens de evidência local estão em `artifacts/qa/loading.jpg`, `artifacts/qa/campanhas-desktop.jpg` e `artifacts/qa/campanhas-mobile.jpg`.

Esse registro descreve a revisão testada naquele momento. Alterações posteriores exigem nova execução; ele não comprova o ambiente de produção nem valida integrações externas sem credenciais.

## Matriz de comportamento

### Ajuste do topo móvel e conta no Mais — 7 de novembro de 2026

No Windows, `dotnet build Eternnus.sln --nologo` concluiu sem avisos/erros. `node --test tests/frontend.test.mjs tests/loading.test.mjs tests/pwa.test.mjs tests/service-worker.test.mjs` passou nos 17 testes.

Chromium/Playwright com os arquivos reais de `wwwroot`, APIs simuladas e perfil sintético conferiu 320, 360, 390 e 760 px: marca e subtítulo centralizados, faixa de 79 px incluindo borda, ausência de overflow horizontal, perfil/saída somente no painel Mais, alvos de 44 px e Esc devolvendo foco. Redimensionar para 1.440 × 900 devolveu os mesmos nós de conta à barra lateral, sem duplicação. Conta pendente, nome longo e painel rolável foram conferidos em 320 × 568; editar o nome atualizou o perfil único e a saída enviou POST com os cabeçalhos CSRF comuns. Não houve erros JavaScript. As capturas `artifacts/qa/mobile-header.png`, `mobile-more.png` e `desktop-header.png` foram inspecionadas visualmente.

Essa revisão cobre apresentação e integração do cliente com respostas simuladas; não representa novo teste de autenticação no servidor ou de instalação/teclado em aparelho físico. O cache foi incrementado para v14; a lista pública foi revisada sem alterações e os testes de política/worker passaram.

| Área | Verificações essenciais |
| --- | --- |
| Abertura | Constante de 3.000 ms, cálculo do prazo restante, sem dependência da rede e sem reinício na navegação interna. |
| Cadastro | Nome/e-mail/senhas válidos, confirmação igual, avatar padrão, sessão pendente e e-mail enfileirado. |
| Conta pendente | Início e edição de nome disponíveis; envio de avatar e chamadas diretas de campanha, ficha e dados negadas, mesmo alterando UI/estado local. |
| Confirmação | Link válido libera; código inválido, outro usuário, repetição e expiração não liberam indevidamente. |
| Recuperação | Resposta genérica, cooldown, link válido altera senha, link reutilizado falha e sessão antiga deixa de valer. |
| SSO | Exige claim de e-mail verificado; perfis sem verificação e colisão de e-mail local são rejeitados; avatar inválido vira padrão. |
| CSRF | Escrita sem token, sem cookie correspondente ou com contexto antigo falha; token renovado após login funciona. |
| Campanhas | Busca/ordenação/paginação, criar, editar como dono e conflito de revisão; participante não edita nem exclui. |
| Participação | Entrada idempotente, criador não sai, participante sai e perde acesso; ficha pessoal continua existindo. |
| Exclusão | Dono exclui sem jogadores; com jogadores é negado; entrada concorrente não cria vínculo órfão. |
| Isolamento | IDs de outra conta não expõem detalhes, segredos, fichas ou histórico. |
| Entradas | Limites, conteúdo HTML tratado como texto, URLs de avatar/mapa validadas e fórmulas de dados restritas. |
| Sessões | Somente o mestre abre/encerra; uma sessão ativa por campanha (inclusive em corrida); numeração sequencial; campanha online/offline na lista; jogador sem lista de sessões. |
| Mesa | Entrada com ficha própria; presença e ausência; turno concedido/avançado/encerrado; ações e movimento só na vez; casas bloqueadas/ocupadas; mapa e marcadores do mestre; consulta ao vivo acordada por escrita. |
| Registros | Notas privadas invisíveis aos jogadores; mudanças de ficha e vida com antes/depois; histórico com filtros/busca; dados preservados após o encerramento. |

Não usar um endpoint de desenvolvimento para confirmar contas ou revelar tokens. Testes de e-mail leem somente a pasta de coleta do próprio ambiente temporário. Se precisarem avançar cooldown/tempo, devem atuar em dados/relógio de teste, nunca adicionar bypass à aplicação pública.

## Revisão manual de interface

1. Abrir a aplicação sem sessão e conferir a abertura, login, alternância de cadastro e recuperação.
2. Usar teclado nos campos, mostrar/ocultar senha, submeter erros e conferir que o formulário não desaparece.
3. Criar conta local; conferir avatar, banner pendente e cards/menu indisponíveis. Abrir o link de confirmação e atualizar estado.
4. Criar campanha com nome/descrição longos, buscar, editar, cancelar exclusão e confirmar exclusão quando permitida.
5. Entrar na campanha com outra conta; verificar papel/contagem, exclusão bloqueada e saída do participante.
6. Conferir em tela estreita e desktop, com movimento normal e reduzido. Usar os critérios do guia visual.
7. No celular, conferir barra inferior fixa, estado ativo, bloqueio pendente, alvos de toque e espaço da área segura. Verificar o último item da lista e o campo com teclado virtual aberto.
8. Abrir uma sessão como mestre e entrar como dois jogadores em navegadores distintos. Conferir ONLINE na lista, grupo à esquerda, vez do jogador, ações desabilitadas fora da vez, movimento por mouse e teclado, ajuste de vida visível ao outro jogador, troca de mapa, nota privada ausente para os jogadores, saída e encerramento.
9. Validar manifest, registro do service worker, política de cache e atualização conforme `PWA.md`. Separar essa validação da instalação real em Android/iPhone.

## Validação externa ainda necessária

OAuth real exige aplicativos Google/Discord e callbacks autorizados; testes de claims não comprovam esse handshake externo. SMTP real exige host, remetente, TLS, credencial e validação de recebimento. IIS, HTTPS, persistência de chaves e disponibilidade contínua do worker precisam ser conferidos na conta da hospedagem.

Inspeção de manifest/service worker no navegador de desktop não comprova instalação real nem comportamento do teclado/área segura no celular. A validação em Android e iPhone físico permanece uma etapa específica; não registrar como realizada sem executá-la.

Teste de carga é separado de teste funcional. Seguir `SEGURANCA_OPERACAO.md` para medir latência, erros, recursos e conexões em homologação antes de afirmar capacidade de usuários simultâneos.

## Conferência do pacote publicado

Após gerar `artifacts/postgres-pwa-publish`, executar `node tests/release.mjs`. O teste inicia o assembly Release na porta 5192, com banco SQLite estritamente temporário e diretórios privados isolados, e o encerra ao terminar. Confere disponibilidade, manifesto/ícones/worker, 37 verificações HTTP (incluindo `no-store` nos links sensíveis) e ausência de `App_Data`, mensagens `.eml` e configuração de desenvolvimento no pacote. Não usa o banco normal e não substitui os testes PostgreSQL.

A entrega passou nessa conferência do pacote. A proteção de cache é aplicada também ao fallback HTML de `/`, além de `/index.html`, para que links de conta não fiquem no cache HTTP do navegador.


## Loading universal — 6 de novembro de 2026

Build sem avisos/erros; 27 testes .NET, 16 testes JavaScript (incluindo concorrência, falha, liberação do foco e preservação de estado inerte do loading) e 37 verificações HTTP PWA passaram. O controlador é testado com fronteiras DOM simuladas; isso não substitui a revisão visual do navegador. Prévia isolada com SQLite estritamente de teste: abertura e retorno ao acesso conferidos em desktop; envio inválido preservou campos e mostrou erro com loading liberado. Loading conferido também em viewport móvel de 390 × 844. OAuth real permanece sem validação externa; provedores desativados na prévia sem credenciais. Testes PostgreSQL não foram repetidos nesta alteração de interface.

Na revisão móvel, um proxy local exclusivo de QA atrasou respostas POST para observar a espera real: o loading universal ficou visível no modo de operação e sem overflow horizontal; após a resposta inválida, os campos foram preservados e o erro ficou legível. Atraso aplicado somente no proxy de QA, sem temporização artificial no produto. Evidência: `artifacts/qa/loading-universal-mobile.png`.


## Perfil e avatar — 6 de novembro de 2026

Executados nesta alteração: compilação sem avisos/erros; 48 testes .NET (21 novos casos para perfil/avatar/adaptadores), 16 testes JS, 204 verificações de integração PostgreSQL com banco isolado e migrações, e 37 verificações HTTP da PWA. Consulta de vulnerabilidades com dependências transitivas não encontrou pacotes vulneráveis nas fontes configuradas no momento da execução.

Os testes de perfil cobrem edição do próprio nome sem mudar identidade/confirmação/outros usuários, formato falsificado, arquivo excessivo/corrompido, dimensões excessivas, PNG animado, reconstrução JPEG sem metadados, substituição sem acumular avatares, recusa/indisponibilidade sem perder a imagem anterior, respostas de moderação incompletas/recusadas e enquadramento INSTREAM do adaptador antivírus. Adaptadores externos usam servidor TCP local de teste e HTTP simulado, sem amostras reais de vírus ou imagens impróprias. A integração HTTP verifica autenticação, CSRF, pendência de confirmação, nome persistido, upload bloqueado em 503 sem configuração e API de imagem inexistente em 404. Não certifica eficácia real de antivírus/classificador; ativação externa continua pendente conforme HOSPEDAGEM.md.


Revisão visual da conta: conta sintética pendente acessou Minha conta, alterou o nome e recebeu confirmação, com atualização simultânea do nome no menu e loading universal. Campo de avatar permaneceu desabilitado com orientação para confirmar e-mail. Conferidos desktop e viewport 390 × 844, sem overflow horizontal e com navegação inferior preservada. Evidência: `artifacts/qa/perfil-mobile.png`. A prévia de QA usou SQLite temporário separado; nenhuma credencial ou imagem real foi enviada aos verificadores externos.

## Conclusão das Ondas A/B — 7 de novembro de 2026

Validação local no Windows, .NET SDK 10.0.303 e PostgreSQL 17.11 real (Docker), após consolidar master/editor/Guilda e implementar a ficha completa:

| Verificação | Resultado |
| --- | --- |
| Build Debug | Sem avisos/erros |
| Testes .NET | 577 passaram, nenhum ignorado |
| Testes frontend | 72 passaram |
| smoke | 209 verificações |
| sessions | 179 verificações |
| admin | 155 verificações |
| support | 158 verificações |
| library | 129 verificações |
| progress | 109 verificações |
| guild | 212 verificações |
| sheet-templates | 150 verificações |
| character-sheets | 174 verificações |
| Banco legado | Usuário, sistema textual, campanha, ficha e objetivo de 4.500 caracteres preservados; SQL idempotente reaplicado |
| Modelo EF | Nenhuma alteração pendente de migração |
| Publicação Release | Inicializou isoladamente; 37 checks HTTP PWA passaram; sem App_Data, e-mails ou configuração de desenvolvimento |
| Precache | Todos os 53 caminhos públicos existem na publicação |
| Dependências NuGet transitivas | Nenhuma vulnerabilidade conhecida nas fontes configuradas no momento da consulta |

As nove suítes somam 1.475 verificações de integração. O harness cria e remove somente bancos únicos eternnus_test_*. Os logs locais estão em artifacts/onda-ab-*.log e o TRX em artifacts/test-results/ondas-ab.trx. Não confundir essas contagens com registros históricos acima.

Reprodução, após preparar Docker/porta/conexão do harness e compilar Debug:

```powershell
dotnet build Eternnus.sln
dotnet test Eternnus.sln --no-build
node --test tests/*.test.mjs
foreach ($suite in 'smoke','sessions','admin','support','library','progress','guild','sheet-templates','character-sheets') {
  node "tests/$suite.mjs"
  if ($LASTEXITCODE -ne 0) { throw "Falhou: $suite" }
}
dotnet ef migrations script 0 LiveSessions --idempotent --project apps/Eternnus.Web --output artifacts/postgres-legacy.sql
dotnet ef migrations script --idempotent --project apps/Eternnus.Web --output artifacts/postgres-ondas-ab.sql
node tests/migrations.mjs
```

A integração da ficha cobre multipart real de PDF (sem contorno por SQL), dono/CSRF/sistema/revisão na escolha de modelo, valores calculados, edição/histórico, migração, ações de modelo no live, vida ajustada pelo mestre e GET /me somente leitura com atividade por POST. Os testes de limites recusam caminhos parecidos que não são uploads autorizados.

QA de navegador: biblioteca, suporte, conquistas, Guilda, administração e editor em desktop e viewport móvel de 390 × 844; sem overflow horizontal nas telas conferidas. Na ficha: criar modelo livre, preencher PDF e formulário acessível, salvar, calculados, histórico, migrar, escolher modelo da campanha, gerar PDF e usar ação do modelo na mesa. PDFs exportados foram renderizados e inspecionados visualmente; a estrutura não contém ações de abertura, formulário ativo, anexos ou anotações. Revisão de publicação sem mudanças deixou de acusar defaults de aparência como movimento de campos.

Depois da bateria acima, o usuário solicitou apenas alinhamento dos campos à esquerda. Esse ajuste de CSS/exportação foi conferido pontualmente na tela e no PDF; a bateria completa não foi repetida. O pacote foi atualizado com os arquivos públicos finais e cache v11. A atualização da PWA foi observada aguardando o fechamento da aba anterior, sem skipWaiting.

Não foram validados IIS/HTTPS de produção, handshake OAuth, SMTP real, ClamAV/Azure reais, instalação em Android/iPhone físico ou carga. Serviços externos permanecem dependentes de configuração privada e arquivos são recusados quando verificadores obrigatórios não estão disponíveis. Ver HOSPEDAGEM.md e SEGURANCA_OPERACAO.md.

## Campanhas e mesas — 7 de novembro de 2026

Validação desta evolução no Windows/.NET10/PostgreSQL17 local, com bancos exclusivos de teste:

| Verificação | Resultado |
| --- | --- |
| Build Debug | Sem avisos ou erros |
| Testes .NET | 601 passaram na árvore final, nenhum ignorado (limites de upload, fichas privadas, auditoria, quotas e ciclo one-shot) |
| JavaScript | 72 passaram |
| smoke | 226 verificações PostgreSQL |
| sessions | 184 verificações PostgreSQL |
| character-sheets | 200 verificações PostgreSQL |
| admin | 162 verificações PostgreSQL |
| support / library / progress | 164 / 135 / 115 verificações PostgreSQL |
| guild / sheet-templates | 218 / 156 verificações PostgreSQL |
| account-limits | 72 verificações: bootstrap privado, TOTP, recuperação, promoção e quotas concorrentes |
| campaign-assets | 73 verificações: upload real, hierarquia, visibilidade, grade/movimento/escala, corrida selecionar/excluir e cascata one-shot |
| temporary-images | 49 verificações HTTP/WebSocket: autorização, CSRF, Origin, remetente/peerId, duas abas e limite de sockets |
| Migração CampaignWorkspace | Banco legado atualizado; dados e objetivo de 4.500 caracteres preservados; textos copiados para acervo mantendo originais; script idempotente reaplicado |
| Snapshot EF | Nenhuma mudança de modelo pendente |
| PWA | 58 arquivos da lista pública existem; testes de política/worker passaram, cache v12 sem API/bytes privados |

As 12 suítes HTTP somam 1.754 verificações. TRX: artifacts/test-results/campaign-workspace.trx. A suíte de long-poll usa prazo de 15 s para cobrir a reconferência de banco de até 5 s, inclusive quando o pulso acontece na fronteira da inscrição. Isso não acrescenta atraso à aplicação.

QA automatizada com Chrome/Playwright em 1.440 × 900 e 390 × 844, movimento reduzido: biblioteca mestre/jogador (rascunho ausente para jogador), navegação de pastas, mapas, ficha privada/salvamento, tabuleiro com imagem enviada e tokens, transmissão WebRTC real e retirada da apresentação, duas abas do jogador e duas do mestre, troca da apresentação entre abas e onboarding TOTP com recuperação. Sem erros de página ou overflow horizontal nas telas verificadas. Evidências em artifacts/qa/workspace-*.png; script local artifacts/qa-campaign-workspace.mjs. Playwright foi instalado somente em artifacts/qa-runtime, fora das dependências do produto.

Reprodução dos novos testes após build: node tests/account-limits.mjs, node tests/campaign-assets.mjs, node tests/temporary-images.mjs; demais comandos seguem as seções anteriores. A migração de legado usa os scripts gerados por dotnet ef migrations script e tests/migrations.mjs, em banco temporário próprio. Nenhum banco normal ou volume foi apagado.

Não foram executados SMTP/SSO/antivírus/moderação reais, IIS/HTTPS de produção, instalação física Android/iOS, carga ou conectividade WebRTC entre redes/NAT externos. Arquivos são recusados em produção sem scanner configurado. Redes restritivas podem exigir STUN/TURN; esta execução demonstrou conexão entre navegadores locais. A migração foi validada em bancos de teste e não representa publicação/migração automática da produção.


## Névoa, iluminação e visão — 8 de novembro de 2026

- `dotnet test`: 638 testes, incluindo `FogRulesTests` (alcance circular, parede, canto diagonal, simetria, legenda oficial, sentidos, caminho, detecção e máscara de imagem) e `TableFogSessionTests` (criatura no escuro fora do payload/eventos, movimento por casas conhecidas com mensagem genérica, luz da ficha × sobrescrita, detecção por percepção e sentido, escopo sessão/campanha, "ver como", continuidade e recomeço da exploração, alcance do turno pelos papéis `movement`/`reach` e movimento sem limite quando o modelo não define Deslocamento).
- `node --test tests/*.test.mjs`: 99 testes, incluindo `fog-policy.test.mjs` (bitset igual ao servidor, legenda, linha de visão, prévia de luz, alcance com névoa, pintura local, campos de configuração e papéis de ficha iguais aos do servidor e área do alcance de ataque).
- `node tests/table-fog.mjs`: 73 verificações em PostgreSQL (migração, filtragem por jogador, movimento, corrida pintura × ajuste × leitura sem 500, escopos, preparação com revisão/409, imagem mascarada e "ver como", continuidade entre sessões e reset). `sessions.mjs` e `campaign-assets.mjs` passam a desligar a névoa na campanha para manter a cobertura das regras clássicas; ambos aprovados, assim como `migrations.mjs`, `character-sheets.mjs` e `sheet-templates.mjs`.
- Revisão no navegador (Playwright, 1366×860 e 390×844): visão do jogador, visão do mestre com paleta, pintura por arraste, "ver como", modal de configuração com escolha de escopo e editor de preparação; sem rolagem horizontal no celular e alvos da paleta com 44 px. Turno do jogador com casas de movimento, área de ataque e arraste do boneco (movimento gravado no servidor). Capturas em `artifacts/qa/fog-*.png` e `artifacts/qa/turn-*.png`. `tests/support/fog-demo.mjs` sobe um ambiente manual para revisão.
- Não validado: carga/latência da geração de imagens mascaradas e do cálculo de luz com muitos jogadores.

## Login persistente — 8 de novembro de 2026

- `dotnet build Eternnus.sln --nologo`: aprovado, sem avisos ou erros. `dotnet test tests/Eternnus.Tests/Eternnus.Tests.csproj --no-build --nologo`: 637 testes aprovados. Os 14 casos de `LoginSessionTests` usam HTTP/Kestrel, pipeline, cookies, CSRF e Identity reais, SQLite isolado e relógio controlado: janela de oito horas, teto de 24 horas, prazo fixo de 14 dias, renovação, confirmação de e-mail, cookie legado, MFA/expiração do desafio, administrador, alteração de senha, logout local/global e state/callback de Google/Discord com escolha verdadeira/falsa e query adulterada.
- `node --test tests/auth.test.mjs tests/frontend.test.mjs tests/loading.test.mjs tests/pwa.test.mjs tests/service-worker.test.mjs tests/session-policy.test.mjs`: 34 testes aprovados. Novos casos conferem rota interna, falha MFA sem descartar o desafio, consulta de identidade após CSRF expirado e ausência de repetição automática de escrita.
- `node tests/login-session.mjs`: 42 verificações aprovadas com PostgreSQL real em banco exclusivo; cookies persistente/não persistente, CSRF obrigatório, revogação entre dispositivos sem afetar outra conta e administrador com MFA sem persistência longa.
- Playwright/Chromium com arquivos reais e APIs simuladas, em 1.440 × 1.000 e 390 × 844: opção inicialmente desmarcada, teclado, alvo de 44 px, envio booleano, retorno à conta após senha/OAuth, modal de saída global, erro/nova tentativa, aviso de expiração e descarte do polling real de `table.js` após resposta `401`. Sem erros JavaScript ou overflow horizontal. Capturas `artifacts/qa/login-session-1440.png`, `login-session-390.png`, `logout-all-1440.png` e `logout-all-390.png` inspecionadas visualmente. Cache v20, lista pública revisada sem novos caminhos.
- O smoke geral foi executado, mas parou em `tests/smoke.mjs:501`: esperava `204` ao excluir uma campanha com sessão em andamento e recebeu o `409` da regra de `CampaignService`. Não foi declarado aprovado nem ajustado neste trabalho de autenticação.
- Limites: não houve login externo real com credenciais Google/Discord, entrega SMTP real, teste de carga, publicação ou conferência em aparelho físico. As chaves privadas e bancos normais foram preservados; não há nova migração nesta funcionalidade.

## Continuidade e acervo — 10/11/2026

- `dotnet build Eternnus.sln --no-restore -v quiet`: aprovado, zero avisos e erros.
- `dotnet test Eternnus.sln --no-restore -v quiet`: **703 aprovados**, zero falhas/ignorados. Inclui oito testes novos em WorkspaceTests: notas privadas (inclusive contra mestre), leitores escolhidos/recolhimento, versões/conflitos/lixeira, capítulos e pais privados, numeração sem XP, anexos e cópia do atlas, preservação textual após saída/exclusão, relacionados/backlinks/busca e bloqueio de campanhas arquivadas.
- `node --test tests/help-policy.test.mjs tests/help-catalog.test.mjs tests/help-fields.test.mjs tests/pwa-policy.test.mjs`: **13 aprovados**. Catálogo/índice e enumeração pública conferidos.
- `node tests/campaign-workspace.mjs`: aprovado em PostgreSQL isolado pelo harness. Exercita migrações, criação em andamento, privacidade do mestre/jogador/externo, publicação de sessões anteriores, corrida de número entre registro anterior e sessão real, duas escritas da mesma revisão (uma 200, outra 409), anexos PDF autenticados, referências ocultas, publicação/recolhimento do atlas, formulário de página, configuração da origem, salvamento automático, recuperação do caderno depois da saída e interface móvel de 390 px sem overflow horizontal.
- `dotnet ef migrations has-pending-model-changes --project apps/Eternnus.Web --no-build`: nenhuma mudança pendente no modelo.
- `node --check` dos módulos novos/alterados e `git diff --check`: aprovados.

Evidências: `artifacts/qa/campaign-workspace/result.json`, `world-desktop.png`, `settings.png`, `notes-mobile.png` e `past-mobile.png`. Quatro capturas revisadas; nenhuma exceção de página capturada na execução aprovada. Correções feitas durante a QA: escape de títulos nos botões de relações, bloqueio dos controles enquanto associações carregam, descarte do timer ao fechar o editor, respeito a aria-disabled e paginação com quebra de linha em telas estreitas.

O Docker estava inicialmente desligado; foi iniciado e o contêiner PostgreSQL de desenvolvimento existente foi retomado, sem excluir volumes. O harness criou/removeu exclusivamente seu banco temporário. Scanner foi explicitamente dispensado pelo modo de testes de desenvolvimento existente; disponibilidade do ClamAV em produção permanece externa. Não houve teste em aparelho físico/leitor de tela, medição de carga, aplicação no banco de produção nem importação de serviços de terceiros. Exportação é textual por página/caderno; não é pacote integral de campanha. Limites adicionais em CAMPANHAS_CONTINUIDADE.md.

## Mesa horizontal no celular — 10/11/2026 (ADR-056)

- `dotnet build Eternnus.sln --no-restore`: aprovado, zero avisos e erros.
- `dotnet test Eternnus.sln --no-build --filter "FullyQualifiedName~TableRulesTests|FullyQualifiedName~SessionServiceTests|FullyQualifiedName~TablePlayRulesTests" --verbosity quiet`: 48 aprovados, zero falhas/ignorados.
- `node --test tests/session-policy.test.mjs tests/play-policy.test.mjs tests/help-policy.test.mjs tests/help-catalog.test.mjs tests/pwa.test.mjs tests/service-worker.test.mjs`: 36 aprovados.
- `node tests/table-viewport.mjs`: 93 verificações aprovadas em Chrome/Playwright com PostgreSQL isolado. Mestre/jogador, interface Completa, retrato 390×844; paisagem 640×320, 740×360, 844×390, 932×430; desktop 1440×900. Confere geometria do mapa/rodapé, navegação, ausência de overflow, ações em painel aberto, grupo, ficha, envio real de conversa, modal de rolagem, névoa redimensionada, trilha selecionada, fallback de fullscreen, APIs ausentes e descarte de lock simulado. Autoplay bloqueado simulado verifica o botão de ativação dentro do topo. Redução do viewport para 844×240 verifica campo acima do rodapé e preservação do rascunho.
- Zero erros JavaScript/CSP na execução final. Capturas e relatório em `artifacts/qa/mesa-horizontal/`; imagens de orientação, mestre, conversa, ficha, névoa, trilha e fallback inspecionadas visualmente. `node --check` dos módulos e `git diff --check` aprovados.

Ajustes encontrados na QA: posicionamento explícito dos filhos do rodapé; prioridade das regras para manter ações em painéis abertos; tamanho mínimo dos botões nas ferramentas; atualização da área de névoa por ResizeObserver; ativação de áudio bloqueado no topo. O teste espera a atualização real de dvh após redimensionamento emulado.

Limites: não houve publicação, teste em aparelho físico, Safari/iOS, instalação standalone, rotação física, teclado virtual real ou medição de carga. Sucesso da API de orientação foi simulado apenas para conferir tentativa e liberação; recusa real do Chrome desktop e ausência das APIs também foram testadas. Nenhuma mudança de backend ou migração pertence a esta entrega; alterações preexistentes foram preservadas.


## Câmera, ajuda e editores móveis — 10/11/2026 (ADR-057)

- `dotnet build Eternnus.sln --no-restore -v quiet`: aprovado, zero avisos e erros.
- `dotnet test Eternnus.sln --no-build --filter "FullyQualifiedName~TableRulesTests|FullyQualifiedName~SceneEditorTests" --verbosity quiet`: 38 aprovados.
- `node --test tests/help-catalog.test.mjs tests/pwa.test.mjs tests/service-worker.test.mjs tests/scene-policy.test.mjs tests/session-policy.test.mjs tests/play-policy.test.mjs`: 41 aprovados.
- `node tests/table-viewport.mjs`: 122 verificações em Chromium/Playwright com PostgreSQL isolado; mesa, editor de cena, preparação de mapa e prévia de grade. Pinça por eventos de toque do protocolo Chromium verifica aproximação, afastamento, limites, escala da página, cancelamento de pintura sem escrita e preservação dos valores da grade. Confere círculos de ajuda, barras e painéis, áudio, conversa, modal e dimensões móveis; zero erros JavaScript/CSP. Capturas e relatório em `artifacts/qa/mesa-horizontal`.
- `node --check` nos módulos alterados e `git diff --check`: aprovados.

O ensaio usa emulação, não aparelho físico: toque real em Android/iOS, Safari e teclado virtual ainda precisam de conferência. Não houve publicação nem alterações no banco de produção.


## Capítulos e premissa — 10/11/2026 (ADR-060)

- `dotnet test Eternnus.sln -v q`: **711 aprovados**, zero falhas. Novos: `WorkspaceTests.Chapters_are_master_only_ordered_and_group_past_sessions` e `SessionServiceTests.Sessions_can_start_in_a_chapter_move_between_chapters_or_stay_loose` (SQLite).
- `node --test tests/*.test.mjs`: 143 aprovados.
- `node tests/campaign-chapters.mjs`: PostgreSQL isolado com a migração `StoryChapters` + Chromium/Playwright em desktop e 390 px. Permissões (jogador 403), vínculo na abertura com criação no mesmo envio, mudança de capítulo, exclusão com sessões avulsas, premissa com parágrafos no popup e na Visão geral, sem overflow móvel e sem erros de console.

Sem aparelho físico, Safari/iOS ou publicação.
