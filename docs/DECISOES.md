# Registro de decisões

Estado: decisões aceitas para a base das quatro primeiras telas (ADR-001 a ADR-011), loading universal (ADR-012), perfil e avatar (ADR-013) e sessões e mesa ao vivo (ADR-014 a ADR-019). Alterações futuras devem acrescentar uma nova decisão com motivo, impacto e plano de transição; não apagar o histórico para ocultar uma mudança.

## ADR-001 — Monólito modular e responsabilidades explícitas

**Decisão:** ASP.NET Core 10 entrega frontend, API e worker de e-mail. Separação por pastas de domínio, casos de uso, funcionalidades HTTP e infraestrutura, em um projeto executável.

**Motivo:** o produto será hospedado inicialmente em IIS e precisa evoluir sem exigir vários serviços. KISS e SoC são mais úteis aqui que abstrações sem consumidores.

**Consequência:** deploy simples e transações locais. As fronteiras não são impostas por assemblies. Uma extração futura exige justificativa de manutenção, isolamento ou capacidade.

## ADR-002 — PostgreSQL como banco único

**Decisão:** PostgreSQL em desenvolvimento e produção, com EF Core/Npgsql e migrações versionadas. SQLite somente em testes que não dependam de comportamento específico de PostgreSQL.

**Motivo:** seguir a escolha do produto e testar o mesmo comportamento transacional usado na hospedagem.

**Consequência:** a versão anterior não é migrada por simples troca de connection string. Bancos SQLite/SQL Server devem ser preservados; importação de dados é um trabalho separado com backup e validação.

## ADR-003 — Interface cinematográfica com hierarquia de painel

**Decisão:** mockups oficiais como direção principal; cenário do castelo, ouro envelhecido, metal/pele escura e movimento ambiental. Menu lateral e áreas de conteúdo preservam a legibilidade do painel anterior.

**Motivo:** transmitir fantasia medieval sem transformar ações comuns em uma interface difícil de usar.

**Consequência:** uma ação principal por tela, ornamentos periféricos, texto em áreas estáveis e fundo atenuado no dashboard. Componentes e estados seguem `GUIA_VISUAL.md`. Movimentos respeitam acessibilidade.

## ADR-004 — Abertura de 3.000 ms sem bloquear o backend

**Decisão:** relógio compartilhado de 3.000 ms por abertura/recarga da aplicação; a rede pode carregar em paralelo, mas não aumenta o prazo programado.

**Motivo:** cumprir o ritual de entrada solicitado sem usar loading infinito para esconder indisponibilidade.

**Consequência:** chamadas lentas recebem feedback próprio depois da abertura. Navegar entre telas internas não reinicia o ritual. Navegadores podem atrasar timers em abas suspensas ou sob bloqueio da thread; não existe garantia física de renderização no milissegundo exato.

## ADR-005 — Sessão por cookie e CSRF explícito

**Decisão:** cookie HttpOnly, Secure em produção, token antiforgery por formulário/requisição e APIs same-origin. Nenhum JWT ou segredo de sessão no armazenamento JavaScript.

**Motivo:** frontend e backend compartilham origem; não há necessidade de expor credenciais ao cliente para essa arquitetura.

**Consequência:** o cliente obtém `/api/auth/csrf` e envia `X-CSRF-TOKEN` nas escritas, junto do cabeçalho da aplicação. Após login, cadastro ou logout, renova o token. Novos endpoints não podem contornar esse fluxo.

## ADR-006 — Confirmação de e-mail é uma política do servidor

**Decisão:** contas locais podem entrar e ver o início, mas recursos de jogo exigem `Verified`. SSO libera somente e-mail declarado verificado por Google/Discord. O avatar local é padrão.

**Motivo:** bloquear somente botões não protege dados nem operações. O usuário deve entender o próximo passo sem perder acesso à sessão.

**Consequência:** confirmação concluída libera a conta sem recadastro. “Já confirmei” apenas consulta o estado; não o altera. Links expiram em uma hora. Provedor indisponível não é substituído por um login simulado.

## ADR-007 — Não vincular contas por coincidência de e-mail

**Decisão:** o vínculo externo é identificado por provedor e chave estável. Uma conta local já existente não é fundida automaticamente com SSO do mesmo e-mail.

**Motivo:** a conveniência de fusão não justifica um caminho implícito de tomada de conta.

**Consequência:** colisões recebem mensagem controlada e continuam pelo método já registrado. Vincular identidades no futuro exige sessão autenticada e fluxo específico, com testes.

## ADR-008 — E-mails persistidos antes do transporte

**Decisão:** links são enfileirados em outbox no PostgreSQL, protegidos por Data Protection; worker usa lease, tentativas e backoff. Desenvolvimento grava mensagens `.eml` fora da pasta pública. Produção usa SMTP com TLS.

**Motivo:** a requisição não deve depender do tempo do servidor SMTP e um reinício não deve perder a fila.

**Consequência:** entrega é pelo menos uma vez. Um crash depois da aceitação pelo SMTP pode duplicar uma mensagem; não há promessa de exactly-once. Chaves de Data Protection são parte do backup operacional.

## ADR-009 — Consistência de campanhas sob concorrência

**Decisão:** o criador edita; só exclui sem outros jogadores. Participante pode sair, criador não. Entrada, edição, remoção, saída e exclusão usam bloqueio da mesma linha de campanha em transação PostgreSQL.

**Motivo:** uma checagem isolada de contagem não protege contra uma entrada simultânea.

**Consequência:** operações na mesma campanha são serializadas no trecho crítico. Edição exige revisão atual. A UI mostra ações possíveis, mas conflito pode ocorrer legitimamente e deve ser explicado ao usuário.

## ADR-010 — Performance medida, escala preparada sem promessa ilimitada

**Decisão:** consultas com projeção, índices e paginação; I/O assíncrono; módulos de jogo sob demanda; imagens oficiais sem serviços externos obrigatórios.

**Motivo:** reduzir trabalho e manter a arquitetura operável antes de introduzir cache ou distribuição.

**Consequência:** capacidade depende do plano e será medida. Rate limiting atual é por processo; múltiplos hosts exigem limites distribuídos/na borda e chaves compartilhadas. Não adicionar cache de autorização sem invalidar confirmação e security stamp corretamente.

## ADR-011 — PWA instalável e navegação móvel persistente

**Decisão:** disponibilizar instalação web sem loja, com manifest de identidade `/eternnus-rpg`, escopo `/`, entrada `/#overview`, apresentação `standalone` e ícones próprios. No celular, os destinos principais ficam em uma barra inferior fixa, com rótulo, estado ativo e área segura.

**Motivo:** facilitar o uso recorrente no celular e aproximar a experiência de um aplicativo sem duplicar frontend/backend ou introduzir uma distribuição nativa nesta etapa.

**Consequência:** a instalação depende das capacidades e critérios do navegador, em HTTPS ou ambiente local confiável. Android/Chrome pode fornecer o evento de instalação; no iPhone, a interface orienta a adição manual pela opção Compartilhar/Adicionar à Tela de Início. Não há promessa de que um navegador exibirá um prompt em toda visita.

**Cache e atualização:** service worker guarda somente o shell estático e uma lista explícita de arquivos públicos. API, OAuth, URLs com tokens e dados do usuário permanecem na rede. Offline permite abrir a interface, não autenticar ou gravar dados. Não forçar a ativação de uma nova versão enquanto houver abas controladas; incrementar a versão de cache nas alterações de assets e validar atualização/limpeza. A estratégia e seus testes estão em `PWA.md`.


## ADR-012 — Loading universal com o visual da abertura

**Decisão:** reutilizar a própria superfície `#splash` (cenário, marca e círculo rúnico) em todo carregamento em primeiro plano. `js/loading.js` controla abertura, chamadas HTTP/CSRF, formulários, rotas/módulos sob demanda e saída para SSO. Operações concorrentes mantêm a superfície até a última conclusão; `finally` libera a interface também em falhas.

**Prazo:** somente a abertura tem o prazo compartilhado de 3.000 ms. Depois dele, o mesmo componente indica uma operação realmente pendente, sem repetir a barra temporal ou acrescentar duração mínima. Atualizações automáticas da mesa são silenciosas, pois não representam espera solicitada pelo usuário.

**Acessibilidade:** superfície na camada superior via Popover API, inclusive sobre modal; conteúdo atrás fica inerte e o foco anterior é restaurado se ainda existir. Escape não fecha um formulário enquanto a operação está pendente. Movimento reduzido continua respeitado pelo CSS compartilhado.

**PWA:** módulo público adicionado à lista explícita e cache incrementado para v2, sem ativação forçada. Nenhuma resposta de API ou SSO entra no cache.


## ADR-013 — Perfil editável e avatar condicionado a aprovação automática

**Decisão:** permitir editar nome da própria conta autenticada, inclusive pendente, e enviar avatar somente após confirmar e-mail. Exigir validação estrutural, antivírus ClamAV, reconstrução segura e moderação externa Azure AI Content Safety. Aceitar somente severidade zero em todas as quatro categorias; verificadores ausentes/indisponíveis falham de forma fechada, conforme escolha explícita do usuário. Vírus, spyware, trojans e demais ameaças detectáveis entram na etapa antivírus, sem promessa de cobertura completa.

**Persistência:** uma imagem normalizada por conta no PostgreSQL, substituição transacional e URL versionada por API autenticada sem cache. Não publicar nem guardar o original; não reutilizar nomes de arquivo como caminhos. Magick.NET 15.1.0 escolhido com consulta de vulnerabilidades, formatos limitados a JPEG/PNG, política restrita e limites de recursos. A abertura/loading universal é reutilizada.

**Consequências:** ativação exige configuração privada, antivírus atualizado e recurso externo de moderação. A imagem é enviada à Microsoft, informado no formulário. Não disponibilizar bypass de desenvolvimento ou publicação enquanto uma verificação falha. Os testes locais de integração não atestam a eficácia real dos serviços externos. A permissão de conta pendente em settings expande a ADR-006 apenas para perfil; recursos de jogo continuam exigindo Verified.

## ADR-014 — A sessão é a unidade de histórico e o estado online da campanha

**Decisão:** o mestre inicia uma sessão ao entrar em jogo; sessão sem `EndedAt` coloca a campanha online. Existe no máximo uma sessão ativa por campanha, garantida por índice único filtrado e pelo bloqueio da campanha na abertura. As sessões são numeradas em sequência. A agenda de sessões da versão anterior foi substituída: a migração `LiveSessions` converte cada registro antigo em sessão encerrada e numerada, preservando título e notas (coluna renomeada para `Objective`, sem truncar).

**Motivo:** cada encontro precisa de um histórico próprio e consultável, e a lista de campanhas precisa indicar quando há mesa aberta. Uma sessão ativa explícita evita inferir presença por atividade recente.

**Consequência:** jogadores veem "ONLINE" e entram direto na mesa; não veem a lista de sessões nem o histórico (`403`). O mestre consulta sessões anteriores, adiciona notas inclusive após o encerramento e abre uma nova sessão somente depois de encerrar a atual. Excluir a campanha remove suas sessões e eventos.

## ADR-015 — Atualização ao vivo por long-poll e revisão no banco

**Decisão:** `GET /api/sessions/{id}/live?after=n` espera até a revisão da sessão superar `n` ou até ~25 s. Toda escrita incrementa `GameSession.Revision` na mesma transação e, após o commit, acorda as consultas do processo por `SessionSignals`. As consultas reconferem o banco a cada 5 s. Presença usa `POST /heartbeat`.

**Motivo:** atende o tempo de resposta de uma mesa sem pacote adicional no cliente, reutiliza `api.js`/CSRF, funciona atrás de IIS sem depender de WebSocket/streaming e mantém GET sem efeitos colaterais. SignalR ou SSE foram avaliados; a troca futura só exige substituir o transporte, pois a fonte de verdade continua sendo a revisão no banco.

**Espera na interface:** a consulta ao vivo, o heartbeat e os comandos rápidos da mesa (chat, rolagem, nota inline, movimento, turno, defesa, remoção de marcador) usam a opção `background` de `api.js`: têm retorno próprio (botão ocupado, registro no painel, arauto) e não devem cobrir o mapa compartilhado com o loading universal da ADR-012 a cada jogada. Entrada na mesa, abertura de fichas/mapas e formulários em modal continuam usando a espera em primeiro plano.

**Consequência:** cada mesa aberta mantém uma requisição pendente por aba. Em vários processos, o atraso máximo entre eles é de ~5 s e a carga de leitura cresce com o número de mesas; um backplane (por exemplo, `LISTEN/NOTIFY` do PostgreSQL) pode ser adicionado sem mudar o contrato. A rota tem limitador próprio (balde de 180/min e 4 consultas simultâneas por usuário) e não consome o balde global das escritas. Capacidade deve ser medida antes de anunciar números.

## ADR-016 — Turnos, ações e movimento decididos no servidor

**Decisão:** o mestre concede, avança ou retoma o turno. Somente o jogador da vez usa ações da própria ficha, move o próprio personagem (uma vez por turno, dentro do deslocamento) e encerra a vez. Rolagens acontecem no servidor. O ataque básico usa `1d20 + modificador de Força`. O mestre ajusta a vida com motivo; cada ajuste cria nova versão da ficha e um evento com antes/depois.

**Motivo:** a interface reflete a vez, mas não pode ser a fonte de permissão. Registrar a rolagem e o alvo, sem automatizar acerto/dano, mantém o produto agnóstico ao sistema de RPG.

**Consequência:** a mesa é auditável (rolagens, ações, movimentos e fichas). Regras de sistema específicas (iniciativa, acerto contra armadura, condições) ficam para decisão futura. A rotação continua a partir do último personagem que recebeu o turno, mesmo depois de ele encerrar a vez.

## ADR-017 — Ações na ficha, versionadas como JSON

**Decisão:** a ficha ganha Constituição, Armadura, Movimento (metros) e até 16 ações (`ataque`, `habilidade`, `magia`, `item`) com nome, fórmula opcional e efeito, persistidas como coluna JSON (`jsonb` no PostgreSQL) e incluídas no snapshot de versão.

**Motivo:** o jogador "cria ações de acordo com a ficha"; manter as ações junto da ficha aproveita a revisão/versão existentes e evita uma tabela sem consultas próprias.

**Consequência:** validação de quantidade, tipo e fórmula no servidor; clientes antigos que não enviam ações não as apagam. Buscas por ação específica entre fichas não são suportadas.

## ADR-018 — Mapas oficiais como grades compartilhadas e desenho em canvas

**Decisão:** tilesets oficiais são grades de caracteres em `Domain/BattleMaps.cs`, enviadas no estado ao vivo e desenhadas pelo cliente em canvas (camada estática em cache; luzes e água animadas a ~30 fps, pausadas em aba oculta e estáticas com movimento reduzido). O servidor usa a mesma grade para validar casas livres. Mapas cartográficos são a arte oficial do vale ou recursos `mapa` HTTPS da campanha.

**Motivo:** evita depender de upload ou arte externa para um tabuleiro funcional, mantém uma única fonte de verdade e respeita a CSP atual.

**Consequência:** novos tilesets são adicionados no domínio com teste de formato. Upload de mapas e editor de tilesets ficam fora desta etapa. O canvas tem alternativa por teclado e anúncio de posição; a lista de participantes e o registro textual permanecem acessíveis.

## ADR-019 — Mesa em modo imersivo

**Decisão:** a mesa ocupa a tela inteira, sem o menu lateral nem a navegação inferior: grupo à esquerda, mapa ao centro, registros à direita e barra de turno embaixo, como em MMORPGs. No celular, as áreas empilham, o grupo rola horizontalmente e a barra de turno fica fixa no rodapé respeitando a área segura. A saída é sempre visível no topo.

**Motivo:** a mesa precisa de espaço para mapa e comandos; repetir a navegação geral competiria com a ação principal do turno.

**Consequência:** é a única tela sem a navegação inferior da ADR-011. Ao sair, o roteador encerra consulta ao vivo, heartbeat e animação. O jogador sai explicitamente da mesa; o mestre pode sair mantendo a sessão online e encerra a sessão por comando separado com confirmação.


## ADR-020 — Plataforma modular com papéis e auditoria

Admin/Staff são políticas consultadas no banco e reaplicadas nos serviços; contas comuns acessam recursos próprios/participantes. Biblioteca/modelos são publicados pela equipe com auditoria; administração, suporte interno, reversão e restauração conservam suas políticas específicas. Sem permissões ou papéis autoritativos vindos do navegador.

## ADR-021 — Fichas fixadas em versões e migração explícita

Modelos publicados são imutáveis. Cada ficha guarda a versão de origem; uma publicação nova gera banner/prévia, e um POST com revisão/versão alvo migra por nome de campo. Valores removidos e alterações permanecem no histórico. Escolha de modelo da campanha afeta somente novas fichas e usa bloqueio/revisão existentes.

## ADR-022 — PDF compartilhado, exportação sem conteúdo ativo

Editor e jogador reutilizam pdf-sheet.js com pdf.js sem eval/scripting/XFA. A exportação monta um PDF visual estático novo, com páginas rasterizadas e valores salvos, sem transferir scripts/anexos/formulários ativos do fundo. A ficha editável continua na aplicação. Aceita-se o custo de tamanho e ausência de texto pesquisável no PDF exportado para preservar a aparência sem carregar fontes adicionais ou conteúdo ativo.

## ADR-023 — Progressão incentiva participação sem bloquear jogo

XP tem fonte idempotente, teto diário e regras no servidor. Nível libera extras, nunca a participação básica na mesa. Ranking/cartões não expõem e-mails. Ajustes administrativos exigem motivo e auditoria.

## ADR-024 — Atividade da conta é escrita explícita

A integração recuperada gravava LastSeenAt ao consultar GET /auth/me. Foi substituída por POST /auth/activity com CSRF e intervalo de cinco minutos; GET permanece somente leitura. Navegação autenticada registra a atividade silenciosamente, sem alterar permissões ou conteúdo de jogo.

## ADR-025 — Conversão compatível de fichas e espelho para a mesa

Fichas clássicas são interpretadas como modelo livre v1 sem escrita na leitura; a primeira alteração válida persiste versão/valores. Campos com papéis sincronizam as colunas clássicas lidas pela mesa. Para modelos próprios, a interface apresenta o modelo e suas ações em vez de mostrar atributos clássicos que não pertencem ao esquema. Fórmulas antigas XdY±Z continuam pelo dado clássico; as demais usam a linguagem limitada compartilhada. O histórico conserva versões e alterações por campo. Renomear campo no modelo equivale a remover e criar: a prévia de migração deve mostrar essa consequência.

## ADR-026 — Conteúdo da ficha alinhado à esquerda

Por solicitação do usuário, a ficha do jogador padroniza o conteúdo dos campos à esquerda, inclusive no PDF exportado e na leitura pela mesa. O ajuste é de apresentação: não altera valores, coordenadas ou versões publicadas. O editor de modelos conserva suas ferramentas de composição. Este ajuste pontual é conferido no navegador/PDF sem repetir a bateria completa já aprovada.

## ADR-027 — Fichas compartilháveis e auditoria reservada

Por solicitação explícita do produto, substitui-se a antiga leitura exclusiva do mestre: membros leem fichas compartilhadas, o dono pode restringi-las, e somente dono/mestre editam. Qualquer histórico de alteração é privado aos dois. SessionService centraliza a transação das rotas clássicas, por modelo, ações e migração, registrando ator/sessão e publicando sinais após commit. O mestre não pode mudar a preferência de privacidade do dono. Ver FICHAS_PRIVACIDADE.md.

## ADR-028 — Três acervos e mapas privados da campanha

Geral e por sistema permanecem disponíveis fora da campanha; o terceiro acervo é somente texto, preparado pelo mestre e revelado explicitamente. Uploads de mapa são privados, limitados, examinados pelo scanner e reconstruídos; pastas/grade/escala integram a campanha. Mapas enviados funcionam como tilesets com grade, marcadores e movimento pela escala escolhida, sem inferir paredes/obstáculos da imagem. A migração copia textos antigos sem apagar originais. Ver CAMPANHA_ACERVOS.md.

## ADR-029 — Quotas fixas e mesas livres descartáveis

Contas comuns têm três campanhas persistentes somando os dois papéis e dez participações vitalícias em mesas livres. Embaixadores/admins têm isenção; nível não aumenta quota. Uma mesa livre dura até 72 horas da criação, fecha ao mestre sair e considera desconexão após 45 segundos sem heartbeat. Coleta apaga conteúdo, preserva fichas pessoais e somente recibo mínimo de consumo. Bloqueios de usuário/campanha/sessão protegem reservas e expiração concorrentes. Ver CONTAS_MESAS_LIVRES.md.

## ADR-030 — Admin provisionado por segredo e TOTP obrigatório

O e-mail inicial padrão é admin@eternnus.com; a senha solicitada é configuração privada, sem credencial versionada. Provisionamento não toma conta existente pelo e-mail. Administradores só recebem sessão de aplicação após autenticador Identity ou código de recuperação; cookies anteriores à promoção não concedem acesso. O segredo do bootstrap é removível após provisionar. Ver CONTAS_MESAS_LIVRES.md.

## ADR-031 — Imagem efêmera entre navegadores

WebRTC transmite bytes sem upload ao servidor. SessionService mantém apenas metadados autoritativos e revisão; WebSocket autenticado sinaliza conexões. A aba do mestre mantém a imagem enquanto apresenta; recarregar exige nova seleção. STUN/TURN e transporte entre instâncias são requisitos operacionais explícitos, sem prometer conectividade universal. Ver IMAGENS_TEMPORARIAS.md.

## ADR-032 — Conta no menu Mais e marca central no celular

Por solicitação do usuário, o shell até 760 px mantém somente logo e subtítulo centralizados na faixa da marca, com altura de 78 px mais a área segura e menor espaçamento vertical. Perfil e saída passam para o painel “Mais” existente. Os mesmos nós de conta são reposicionados ao mudar o breakpoint, preservando atualização do perfil e o fluxo compartilhado de logout. No desktop, continuam na barra lateral. O cache público avança para v14; a lista permitida foi revisada e permanece igual, sem dados autenticados e sem atualização forçada de abas ativas.

## ADR-033 — Deploy de PR mesclado na main com splash sem reload forçado

**Decisão:** o workflow de publicação do Eternnus RPG foi criado na branch `feature/setup`, mas só publica no FTPS da SmarterASP.NET quando um PR for **mesclado em main**. A pasta remota deve ser informada explicitamente em uma variável de produção; Secrets FTP são fornecidos no GitHub, nunca no código. O build executa testes .NET/JS e verifica o pacote antes de interromper o IIS. As migrations PostgreSQL são aplicadas automaticamente em uma etapa exclusiva do GitHub Actions, com um EF Core migration bundle, **após colocar o IIS em manutenção e antes do upload FTPS**. O runner recebe conexão de produção via Secret, nunca reutiliza automaticamente configurações do IIS. O processo mantém `Database__Migrate=false` no servidor para evitar executores concorrentes; alterações destrutivas exigem backup/planejamento prévios. Se migrations ou upload falharem, o site permanece em manutenção para recuperação manual, evitando servir código antigo sobre um esquema potencialmente incompatível.

**Atualização visual:** o script gera `app_offline.htm` a partir do splash HTML/CSS e das imagens oficiais, todos incorporados para funcionar durante a parada de IIS. Novos acessos aguardam `/health` e recarregam. Abas existentes exibem a camada `#splash` sem navegação ou reload; depois, a camada é removida e o usuário é orientado a concluir edições antes de atualizar. O cache da PWA avança para v15 incluindo `maintenance.js`.

**Limites:** não há garantia de preservar envios em trânsito ou edições em componentes já desmontados, nem de conexões WebRTC/WebSocket durante reinício. Dados gravados, banco, chaves de autenticação e diretórios privados precisam persistir fora da sincronização FTP.

## ADR-034 — Upload FTPS por curl e pacote somente Windows

**Decisão:** o deploy envia o pacote com `curl.exe` (`.github/scripts/ftps-upload.ps1`), em lotes com novas tentativas, no lugar do `FTP-Deploy-Action`. O publish remove de `runtimes/` tudo que não for `win`, `win-x64` ou `win-x86`.

**Motivo:** o primeiro deploy falhou duas vezes com `ECONNRESET (data socket)` no FTP-Deploy-Action antes de enviar arquivos, enquanto o `curl.exe` publicava o `app_offline.htm` no mesmo servidor. O pacote tinha cerca de 300 MB, dos quais ~220 MB eram nativos de plataformas que o IIS nunca carrega; menos volume reduz tempo e exposição a quedas de conexão.

**Limites:** não há exclusão remota de arquivos obsoletos nem publicação atômica. O pacote podado é validado pelo `tests/release.mjs` no runner Windows x64; a bitness real do Application Pool continua coberta por manter x64 e x86. Sucesso contra o servidor SmarterASP só é comprovado pela execução real do workflow.

## ADR-035 — IIS fora do processo no pool compartilhado

**Decisão:** publicar com `AspNetCoreHostingModel=OutOfProcess`; o deploy valida o `web.config` gerado.

**Motivo:** o primeiro upload concluído respondeu HTTP 500.34 em `eternnus.com` e `rpg.eternnus.com`: o subdomínio compartilha o Application Pool do site principal, e o pacote InProcess não pode coexistir com outro modelo. Aplicações OutOfProcess coexistem no mesmo pool, cada uma em seu processo.

**Impacto e limites:** há um salto de proxy local entre IIS e Kestrel; WebSocket continua dependendo do recurso WebSocket do IIS. A correção só resolve o conflito se nenhum outro app do pool usar InProcess; caso contrário, é necessário pool próprio no painel do SmarterASP.

## ADR-036 — Deploy preserva as variáveis do painel

**Decisão:** antes da manutenção, o deploy baixa o `web.config` do servidor e mantém seu bloco `environmentVariables` no `web.config` gerado.

**Motivo:** a configuração de produção é feita no painel do SmarterASP, que a grava no `web.config`. O upload do arquivo gerado apagava connection string e SMTP, e o app parava na validação de inicialização (HTTP 502.5).

**Limites:** só o bloco de variáveis é preservado; demais ajustes manuais no `web.config` continuam sendo substituídos. Os valores passam pelo runner efêmero do GitHub e não são exibidos no log.
