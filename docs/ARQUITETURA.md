# Arquitetura da plataforma

Névoa e iluminação: regras puras em `Domain/TableFog.cs` (`FogGrid`, `FogRules`, `TableSettings`, `MapFogState`); composição e imagem mascarada em `Application/TableFogService.cs`; casos de uso da mesa em `Application/SessionFog.cs` (parte de `SessionService`); preparação em `CampaignAssetsService`. Cliente: `js/fog-policy.js` (puro), `js/table-settings.js` (formulário), `js/fog-editor.js` (sob demanda) e camada de névoa em `js/table-map.js`. Ver [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md).

Evolução de jornada e atlas: `Domain/Progression` centraliza contadores compostos e os 21 marcos; `ProgressEndpoints` projeta progresso histórico sem escrever em GET. `SessionService` concede XP elegível também antes da limpeza explícita de one-shots. `js/map-picker.js` compartilha escolha e busca de cenários; `Domain/BattleMaps` continua sendo a única fonte das oito grades/referências oficiais. Ver [PROGRESSAO_CENARIOS.md](PROGRESSAO_CENARIOS.md) para compatibilidade e limitações.

## Objetivo e limites

Um único processo ASP.NET Core entrega a interface, os endpoints e o processamento de e-mails. Um único banco PostgreSQL mantém os dados. O projeto adota separação de responsabilidades por funcionalidades, com infraestrutura compartilhada e componentes visuais reutilizáveis. Evita serviços distribuídos, repositórios genéricos e abstrações sem necessidade demonstrada.

As pastas são fronteiras de organização dentro de um projeto .NET, não assemblies independentes nem uma alegação de Clean Architecture estrita. A camada de aplicação usa EF Core diretamente para manter transações e consultas explícitas. Separar projetos será uma decisão posterior se trouxer isolamento ou manutenção mensuráveis.

## Backend

| Local | Responsabilidade | Não deve fazer |
| --- | --- | --- |
| `Program.cs` | Composition root: conectar registro de serviços, pipeline, rotas e inicialização. | Acumular regras de campanha ou HTML de tela. |
| `Domain/` | Entidades e regras puras: dados, mapas oficiais (`BattleMaps`), regras da mesa (`TableRules`: modificador, deslocamento, rotação de turno, presença, validação de ações e diferença de fichas). | Conhecer HTTP, DOM, SMTP ou configuração de ambiente. |
| `Application/CampaignService.cs` | Casos de uso de campanhas, validação, proprietário, transações e concorrência. | Confiar em permissões enviadas pelo frontend. |
| `Application/SessionService.cs` | Casos de uso da sessão: abertura/encerramento, presença, turnos, ações, mapa/marcadores, ajustes de ficha, notas, estado ao vivo e histórico. | Aceitar turno, papel ou ficha vindos do cliente sem conferir no banco. |
| `Application/ExternalAccounts.cs` | Resolver identidade externa, exigir e-mail verificado, impedir fusão automática por e-mail e limitar avatares. | Guardar access tokens ou aceitar identidade do corpo de uma requisição comum. |
| `Features/Authentication/` | Contratos HTTP dos fluxos de conta e sessão. | Expor tokens de e-mail em respostas de produção. |
| `Features/Campaigns/` | Endpoints finos que encaminham comandos ao serviço. | Duplicar regras de exclusão, saída ou proprietário. |
| `Features/Sessions/` | Endpoints finos da sessão e da mesa ao vivo. | Implementar regras de turno ou permissão no endpoint. |
| `Features/Game/` | Fichas, versões, recursos do mestre, rolagens pessoais e detalhe da campanha. | Contornar a política de conta verificada. |
| `Infrastructure/` | Identity, `GameDb`, configuração de provedores, migrações, outbox, transporte SMTP e `SessionSignals` (sinal em memória para acordar consultas ao vivo). | Tornar credenciais públicas ou montar links a partir de um Host arbitrário. |

`Infrastructure/ServiceRegistration.cs` registra banco, Identity, e-mail e limitação de requisições. `HttpPipeline.cs` centraliza cabeçalhos, CSRF e tratamento de erros. `DatabaseInitialization.cs` aplica a inicialização permitida pelo ambiente. Esses arquivos são infraestrutura/composição; não recebem regras de uma funcionalidade.

### Fluxo de uma operação

1. O middleware limita o tamanho da requisição e aplica cabeçalhos e tratamento de erros.
2. Autenticação valida o cookie e o security stamp; proteção antiforgery, limitação de requisições e autorização são aplicadas à escrita/rota correspondente.
3. Endpoints de jogo exigem `Verified`, que consulta o estado de confirmação no banco. Cadastro/login de uma conta pendente continuam permitidos.
4. O endpoint recebe um DTO específico e chama o caso de uso. Identidade vem do principal autenticado.
5. O caso de uso valida campos e acesso ao recurso, executa a operação assíncrona e usa transação onde houver invariantes entre registros.
6. A resposta contém somente os campos necessários. Erros de negócio usam status e mensagem controlados.

Operações da mesma requisição compartilham um `GameDb` scoped. Não executar consultas paralelas no mesmo contexto. Propagar `CancellationToken` nos novos casos de uso; não bloquear com `.Result`, `.Wait()` ou `Task.Run` para I/O de banco.

## PostgreSQL e consistência

- Desenvolvimento e produção usam PostgreSQL. SQLite fica restrito ao modo explícito de teste, sem assumir equivalência de bloqueios ou SQL.
- Migrações versionadas são a fonte da evolução do esquema. Não usar `EnsureCreated` para atualizar bancos reais.
- `Campaign.Revision` e `Character.Revision` são tokens de concorrência. Edição com revisão desatualizada retorna conflito; o cliente deve recarregar antes de repetir.
- Editar, excluir, entrar, sair e remover participante usam transação e bloqueio de linha da campanha em PostgreSQL. Assim, a verificação de participantes e a exclusão não ficam separadas de uma entrada concorrente.
- Chaves compostas impedem vínculos duplicados. Índices suportam proprietário/atividade, participantes, convites, versões e eventos.
- Exclusão de campanha remove seus registros dependentes; fichas pessoais não são removidas. Saída de participante também remove seus vínculos de ficha à campanha, preservando as fichas.
- Cadastro local e gravação da mensagem de confirmação na outbox pertencem à mesma transação; o cookie só é emitido depois do commit.
- Datas persistidas são UTC; a apresentação converte para o horário local do navegador.
- `LastActivityAt` representa atualização de gestão da campanha nesta etapa (criação, edição, entrada, saída e remoção), não todas as ações de mesa. O contrato e a interface usam essa semântica explicitamente.

## Sessões e mesa ao vivo

Uma **sessão** é a unidade de histórico de uma campanha. Sem `EndedAt`, ela está em andamento e a campanha aparece como online. O índice único filtrado `IX_Sessions_OneActivePerCampaign` garante no banco que exista no máximo uma sessão ativa por campanha; o caso de uso também bloqueia a linha da campanha ao abrir uma sessão e numera as sessões em sequência (`CampaignId, Number` único).

| Registro | Papel |
| --- | --- |
| `GameSession` | Número, título, objetivo, início/fim, mapa atual, turno ativo, último turno concedido, contador de turnos e `Revision`. |
| `SessionParticipant` | Quem entrou, com qual ficha, quando entrou e `LastSeenAt` (presença). O mestre também é registrado. |
| `SessionToken` | Marcadores do tileset: personagens dos jogadores e criaturas do mestre, com o turno do último deslocamento. |
| `TableEvent` | Linha do tempo: `SessionId`, tipo, texto, `Data` JSON (antes/depois, rolagem, origem/destino) e `MasterOnly`. |
| `Character.Actions` | Ações criadas pelo jogador, persistidas como JSON e versionadas com a ficha. |

Fluxo de uma escrita da mesa: transação → `SELECT … FOR UPDATE` da sessão → conferência de acesso, papel, sessão ativa e turno → alteração → evento na mesma transação → `Revision++` → commit → `SessionSignals.Pulse`. A rolagem de dados acontece no servidor. Mudanças de ficha feitas pelo jogador durante uma sessão ativa geram evento `sheet` com antes/depois.

Leitura: `GET /live?after=n` é somente leitura. Ela confere a revisão no banco, aguarda o sinal em memória por até 5 s por vez (reconferindo o banco a cada intervalo) e devolve o estado após uma mudança ou em ~25 s. Com um processo, a atualização é praticamente imediata; com vários processos, cada um percebe mudanças de outro em até ~5 s, sem depender de afinidade de sessão. Presença usa heartbeat por `POST` a cada 20 s, para que nenhum `GET` altere dados. Quem volta de uma ausência publica nova revisão.

Visibilidade: jogadores não recebem notas privadas nem o objetivo inicial; somente o mestre lista sessões e abre o histórico completo da sessão. Participantes leem fichas compartilhadas; fichas privadas e históricos de alteração ficam restritos ao dono e ao mestre autorizado. O detalhe da campanha não expõe e-mails dos membros. Ver [FICHAS_PRIVACIDADE.md](FICHAS_PRIVACIDADE.md).

## Frontend

ES Modules nativos, servidos pelo mesmo host. Não há framework ou processo Node em produção. O cliente não guarda senha, cookie de sessão ou token de provedor em localStorage.

`Infrastructure/LoginSession.cs` centraliza emissão e validação dos tickets Identity de cadastro, senha, OAuth e MFA. O início original fica nas propriedades protegidas do ticket, preservadas na renovação do principal. O login comum tem janela de oito horas e teto de 24 horas; o persistente é opcional e termina em 14 dias; administrador tem MFA e oito horas fixas. `POST /auth/logout-all` invalida tickets e desafios pendentes pelo security stamp, sem nova tabela ou migração. A aplicação descarta a tela contínua ao perder autenticação e retoma somente uma rota interna validada após entrar; uma escrita não é repetida automaticamente.

| Módulo | Contrato |
| --- | --- |
| `js/app.js` | Inicialização, término da abertura, roteamento e carregamento de funcionalidades. |
| `js/state.js` | Estado transitório da sessão e das listas. Não é fonte de autorização. |
| `js/loading.js` | Controlador único da superfície de abertura e de carregamentos em primeiro plano; controla concorrência, foco e bloqueio temporário da interação. |
| `js/api.js` | Único caminho compartilhado de `fetch`, CSRF, credenciais same-origin e erros HTTP. |
| `js/ui.js` | Escape de texto, campos, botões, modal, feedback e submissão de formulários. |
| `js/help.js`, `js/help-policy.js`, `js/help/<area>.js` | Apresentação delegada de tooltip/popover, regras puras e catálogos públicos congelados importados sob demanda. Contratos em [AJUDA_CONTEXTUAL.md](AJUDA_CONTEXTUAL.md). |
| `js/policy.js` | Regras puras de apresentação de acesso, ações e prazo da abertura. Espelha o servidor apenas para UX. |
| `js/layout.js` | Shell, menu, perfil e início. |
| `js/auth.js` | Login, cadastro, recuperação, renovação de CSRF e ações de confirmação. |
| `js/campaigns.js` | Lista, busca, ordenação, paginação, formulários e confirmações de campanha. |
| `js/game.js` | Personagens e versões das fichas, carregados sob demanda. |
| `js/one-shots.js` | Página One-shot (`#one-shot`, antiga "Mesa rápida"): lista, criação com sessão única aberta, convite, encerramento e saída. |
| `js/sheet.js` | Formulário da ficha com editor de ações, visualização reutilizada pela mesa e barras de vida. |
| `js/campaign-page.js` | Página da campanha (visão geral, sessões, jogadores, recursos, configurações) e abertura de sessão com escolha de mapa. |
| `js/table.js` | Mesa ao vivo: entrada/escolha de ficha, consulta ao vivo, heartbeat, grupo, painel de registros, comandos do mestre e do jogador. Devolve uma função de descarte usada pelo roteador. |
| `js/table-map.js` | Tabuleiro em canvas (camada estática em cache, luzes/água animadas, marcadores, alcance, teclado) e imagem cartográfica; miniaturas de mapas. |
| `js/session-history.js` | Histórico da sessão: resumo, linha do tempo, notas, personagens, rolagens, busca e paginação. |
| `js/session-policy.js` | Regras puras de UX da mesa: rotas, modificadores, alcance, comandos habilitados, feeds, intervalo da consulta ao vivo. Espelha o servidor sem substituí-lo. |
| `js/pwa.js` | Registro/estado da experiência instalável e orientação de instalação conforme o navegador. Não armazena perfil nem dados da API. |
| `js/pwa-policy.js` | Lista explícita de arquivos públicos e função pura de elegibilidade de cache. Deve negar query strings e origens externas. |

Rotas com identificador usam `#campaign/{id}/{aba}`, `#table/{campaignId}` e `#session/{sessionId}/{aba}`; o roteador valida o GUID, carrega o módulo sob demanda e chama a função de descarte da tela anterior antes de renderizar outra (encerrando consulta ao vivo, heartbeat e animação). A mesa usa um layout imersivo próprio em `#app`, mantendo `#main` como área do mapa.

O layout é criado pela camada de composição; uma funcionalidade ocupa `#main` e seus próprios diálogos. Não recriar menus ou clientes HTTP por tela. O estado de campanha retorna da API; `isMaster` e `canDelete` orientam a interface, mas o backend sempre reaplica a regra.

`manifest.webmanifest` define identidade e apresentação instalável. `service-worker.js` usa a lista explícita de recursos estáticos permitidos e shell offline; ele não é cache da API nem mecanismo de autenticação. Todas as telas reutilizam a navegação inferior no celular, sem criar uma navegação diferente para cada funcionalidade. Ver `PWA.md` para os limites de cache e atualização.

## Procedimento para uma nova funcionalidade

1. Definir o resultado esperado, quem pode executar a ação e quais dados ela expõe.
2. Reutilizar shell, campos e estados do guia visual; documentar qualquer novo componente.
3. Criar DTO e endpoint na funcionalidade, com `Verified` para dados de jogo.
4. Colocar validação e invariantes no caso de uso; autorizar recurso por identificador e usuário.
5. Criar migração e revisar índices/relacionamentos se o esquema mudar.
6. Adicionar testes de sucesso, acesso negado, validação e concorrência relevante.
7. Atualizar contrato de API, decisão arquitetural e instruções operacionais afetadas.

## Escopo posterior

Regras específicas de um sistema de RPG (iniciativa automática, cálculo de acerto contra armadura, condições), desenho livre no mapa, voz/vídeo e serviços distribuídos não fazem parte desta etapa. Névoa e trilha sonora compartilhada (catálogo do servidor) agora existem (ver seções próprias). As ações registram a rolagem e o alvo; o mestre interpreta o resultado e ajusta a vida. Upload privado de mapas agora integra [CAMPANHA_ACERVOS.md](CAMPANHA_ACERVOS.md).


## Perfil e imagens pessoais

`ProfileService` implementa edição de nome e a sequência de validação/antivírus/normalização/moderação/persistência. `AvatarProcessor` limita os parsers a JPEG/PNG, delegados/filtros e acesso a paths ficam negados; limites do processador e semáforo evitam processamento concorrente irrestrito. Operações nativas de imagem são CPU síncrona limitada; cancelamento é observado nas fronteiras, sem alegar cancelamento instantâneo dentro do decoder.

`Infrastructure/AvatarSafety` implementa o protocolo INSTREAM do ClamAV e o contrato HTTPS do Azure AI Content Safety. `Features/Authentication/ProfileEndpoints` obtém a identidade autenticada e reaproveita CSRF. A tabela `Avatars` tem uma linha por usuário, FK com cascade, versão opaca e somente os bytes JPEG reconstruídos. A imagem e a URL do usuário são gravadas no mesmo SaveChanges transacional; o concurrency stamp de Identity impede sobrepor alterações de usuário obsoletas. A migração `UserAvatars` é aditiva.

`js/profile.js` é carregado sob demanda na conta, reutiliza shell, formulários, cliente API e loading universal. A conta pendente pode alterar nome; o envio de imagem continua exigindo verificação de e-mail no servidor.



## Plataforma — Ondas A/B concluídas

[PLATAFORMA.md](PLATAFORMA.md) descreve a integração de sistemas/papéis, auditoria, suporte, biblioteca, editor de modelos, fórmulas, Guilda, progressão e ficha por modelo. Domain/Platform.cs e Domain/Formulas mantêm dados/regras puras; os serviços específicos ficam em Application e endpoints finos em Features. A composição continua em Program.cs/ServiceRegistration, com PostgreSQL e migrações versionadas.

CharacterSheetService centraliza origem, validação, colunas espelhadas, histórico e migração; SessionService reaproveita essas regras e continua dono das escritas na mesa. CampaignService.SetSheetTemplateAsync usa o bloqueio transacional/revisão de campanha existentes. api.js oferece resposta binária além de JSON para os PDFs privados, sem duplicar autenticação/erros/fetch. character-sheet.js coordena o preenchimento acessível, pdf-sheet.js é compartilhado com o editor e filled-pdf.js produz páginas novas sem conteúdo ativo.

## Campanhas, contas e acervos — evolução integrada

[CONTAS_MESAS_LIVRES.md](CONTAS_MESAS_LIVRES.md) define quotas transacionais, expiração/coleta e bootstrap/MFA. [CAMPANHA_ACERVOS.md](CAMPANHA_ACERVOS.md) define os três acervos e mapas privados organizados. [IMAGENS_TEMPORARIAS.md](IMAGENS_TEMPORARIAS.md) define transmissão WebRTC sem upload. A migração CampaignWorkspace é aditiva e copia os textos legados para o novo acervo, preservando os originais. Toda alteração de ficha passa por SessionService, inclusive endpoints clássicos; os detalhes estão em FICHAS_PRIVACIDADE.md.


## Condução independente do sistema (ADR-046)

- Regras puras em `Domain/TablePlay.cs`: `PlayModes`, `TurnOrders`, `DiceRoller`/`DiceSpec`, `RollVisibility`, `SheetSummary` e `Shortcuts`.
- Entidades de preparação em `Domain/Preparation.cs`: `Scene`, `MasterCharacter`, `RollRequest`, `CampaignAttendance`.
- Escritas da mesa continuam em `SessionService`, nas parciais:
  - `SessionPlay.cs`: pausa, ordem, rolagens, pedidos, recursos, condições e desfazer;
  - `SessionScenes.cs`: cenas, personagens do mestre e resumo;
  - `SessionLiveExtras.cs`: blocos de leitura;
  - `SessionOneShots.cs`: conversão.
  Todas seguem bloqueio → evento → `Revision++` → `Pulse`.
- Preparação fora da mesa: `PreparationService` (cenas, PNJs, diário, convite, início e modelos privados). Arquivamento: `CampaignService`.
- Endpoints finos em `Features/Play/PlayEndpoints.cs`.
- Cliente:
  - `js/play-policy.js`: puro;
  - `js/table-tools.js`: construtor de rolagens, pedidos, ordem e PNJs, sob demanda;
  - `js/campaign-prep.js`: cartões de cenas, PNJs, diário e modelos simples, sob demanda;
  - `js/scene-policy.js` (puro), `js/scene-editor.js` (editor único de cenas e da preparação do mapa), `js/table-scenes.js` (aba Cenas da mesa), `js/interface-mode.js` (Básica/Completa), `js/grid-adjust.js` e `js/map-picker.js` (seletor compartilhado), sob demanda. Ver [CENAS_EDITOR.md](CENAS_EDITOR.md);
  - `js/invite.js`: convite, sob demanda.
  `table.js` usa esses módulos sem duplicar `api.js`/`ui.js`.
- Ver [CONDUCAO_MESA.md](CONDUCAO_MESA.md).


## Catálogo de músicas e trilha da sessão (ADR-049)

- `Domain/Music.cs`: `MusicTrack` global (sem campanha), limites (`MusicLimits`), ações e `SoundtrackState` (posição esperada pura). `Domain/AudioProbe.cs`: validação estrutural MP3/M4A/OGG e duração.
- `Application/MusicCatalogService.cs`: busca por nome para contas verificadas e gestão Admin (lista com uso, envio, renomear, excluir), com auditoria. Quota e duplicidade serializadas por `pg_advisory_xact_lock`; exclusão bloqueia a faixa `FOR UPDATE` e confere sessões ativas. `AudioUploads` lê e valida a estrutura; não usa o `IDocumentScanner` (ADR-051).
- `Application/SessionSoundtrack.cs` (parcial de `SessionService`): comandos da trilha com bloqueio da sessão (e da faixa `FOR SHARE` na seleção) → evento → `Revision++` → `Pulse`, bloco `music` do estado ao vivo e autorização dos bytes pela sessão. `EndAsync` limpa a trilha.
- `Features/Music/MusicEndpoints.cs`: `/api/music`, `/api/admin/music` e rotas da sessão; entrega com HTTP Range.
- `Infrastructure/MusicStorage.cs`: diretório privado `Music:Directory` (fora de wwwroot, validado em `ValidateEternnusConfiguration`) e `MusicStorageSweeper` para órfãos. Metadados no PostgreSQL; bytes no disco.
- Cliente: `js/soundtrack-policy.js` (puro: posição, correção, ordem de estados, limites, textos), `js/soundtrack-api.js` (HTTP via `api.js`: busca no catálogo, gestão Admin e comandos), `js/session-audio.js` (elemento de áudio, sincronização, autoplay, preferência pessoal), `js/table-soundtrack.js` (selo e aba ♪ Trilha da mesa), `js/admin-music.js` (Painel admin → Músicas, sob demanda). `js/music.js` expõe `suspendMusic`/`resumeMusic` para a trilha global.
- Ver [TRILHA_SONORA.md](TRILHA_SONORA.md).
