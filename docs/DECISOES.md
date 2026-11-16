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

## ADR-037 — Registro sanitizado de falha de inicialização

**Decisão:** uma falha fatal na inicialização é gravada em `App_Data/logs/startup-failure.txt` (tipos, códigos e local; sem mensagens com dados) e o deploy a exibe quando `/health` não responde.

**Motivo:** no IIS do SmarterASP a falha aparece apenas como HTTP 502.5, sem acesso ao Event Log; o stdout completo do ANCM incluiria logs de requisições e SQL, contrariando a regra de não registrar consultas ou mensagens de exceção.

**Limites:** não cobre falhas anteriores ao .NET (runtime/ANCM ausente) nem diagnostica sozinho a causa: aponta tipo e código para a correção.

## ADR-038 — Chaves de Data Protection com DPAPI de máquina

**Decisão:** no Windows, o key ring em `DataProtection:Directory` é protegido com `ProtectKeysWithDpapi(protectToLocalMachine: true)`. A inicialização valida a proteção com um teste de proteger/ler antes de aceitar requisições.

**Motivo:** em produção, `/api/auth/csrf` e `/api/auth/external/*` respondiam HTTP 500, e com isso o boot do cliente deixava login e botões sociais indisponíveis. O DPAPI de usuário exige perfil carregado, o que o pool compartilhado do SmarterASP não oferece. O escopo de máquina é o mesmo que o ASP.NET Core adota por padrão no IIS sem perfil.

**Limites:** com DPAPI de máquina, qualquer processo do servidor que consiga ler os arquivos das chaves pode decifrá-las. O isolamento passa a depender da ACL da pasta, que fica fora de `wwwroot` e restrita à identidade do site. As chaves gravadas antes desta mudança deixam de ser lidas: cookies e tokens emitidos com elas expiram, e é preciso entrar de novo. A causa exata do 500 não foi lida no servidor; se o teste de inicialização falhar, o registro sanitizado mostra o tipo e o código.

## ADR-039 — One-shot nasce pela página One-shot, com sessão única

**Decisão:** o link "Mesa rápida" passa a se chamar **One-shot** (`#one-shot`; `#dice` redireciona). One-shots são criadas somente ali, por `POST /api/one-shots`, que cria a campanha temporária, reserva a quota e abre a sessão única na mesma transação. O modal de campanha deixa de oferecer tipo de mesa e `POST /api/campaigns` rejeita `isOneShot=true` (400). `SessionService.StartAsync` rejeita one-shots (409). "Minhas campanhas" lista só persistentes; a página One-shot lista as one-shots. A página da campanha de uma one-shot não mostra aba de sessões nem "iniciar sessão".

**Motivo:** a sessão da one-shot é única: encerrar ou sair como mestre já apaga a mesa. Permitir criar a mesa e iniciar a sessão em passos separados expunha um fluxo de campanha que não se aplica.

**Limites:** o rolador pessoal de dados da antiga página "Mesa rápida" saiu da interface; `POST /api/rolls` e `GET /api/events` continuam no servidor. Como a sessão abre na criação, o preparo ocorre com a mesa aberta e exige presença do mestre (página da campanha e editor de ficha mantêm o heartbeat). One-shots criadas antes desta mudança sem sessão não podem mais abrir mesa; expiram em até 72 h ou podem ser excluídas pelo mestre.

## ADR-040 — Fichas-modelo e tickets do admin ficam no Painel admin

**Decisão:** para administradores, "Fichas-modelo" vira a aba `#admin/templates` do Painel admin (lista, página do modelo e editor de versão, com o mesmo módulo `sheet-templates.js` montado no painel), e `#templates` redireciona para ela com `location.replace`. "Suporte" e "Fichas-modelo" saem do menu lateral e do painel "Mais" do admin. Embaixadores mantêm "Fichas-modelo" no menu (`#templates`), pois não acessam o painel. Links de auditoria e o contador de fichas publicadas apontam para `#admin/templates`.

**Motivo:** quem resolve chamados é o admin, pela aba Tickets; o próprio menu de suporte e uma entrada separada para fichas-modelo duplicavam caminhos da equipe.

**Limites:** mudança somente de navegação. `#support` continua acessível ao admin por link direto (chamados próprios). Papel e permissões continuam conferidos no servidor em cada endpoint de fichas-modelo e suporte.

## ADR-041 — Aba "Mapas e cenários" como explorador de pastas

**Decisão:** a aba de mapas da campanha passa a se chamar **Mapas e cenários** e funciona como um explorador de arquivos: árvore lateral com níveis ligados por linhas, ícones de pasta (fechada/aberta) e chevrons para expandir/recolher; à direita, caminho clicável, botão de subir, contagem, grade de pastas e miniaturas de mapas. A árvore é montada no cliente a partir da lista plana de pastas já devolvida por `GET …/assets/maps` (até 100 pastas, 8 níveis), com funções puras em `policy.js`. O estado expandido é apenas visual, por campanha, em memória. A escolha de pasta no envio/edição mostra a hierarquia indentada.

**Motivo:** a lista de botões soltos não mostrava hierarquia nem localização; o mestre organiza cenários por região/local e precisa reconhecer a estrutura como em um sistema operacional.

**Limites:** sem arrastar e soltar nem renomear pasta (o contrato da API não mudou). No celular a árvore fica acima do conteúdo, com altura limitada e alvos de 44 px.

## ADR-042 — Progressão por participação, sem obrigação diária

**Decisão:** preservar curva e histórico, aumentar XP de sessão para 50 (jogador) e 60 (mestre), exigir jogador com ficha e entrada pelo menos dez minutos antes do encerramento, limitar respostas/marcações úteis recompensadas a cinco por dia e retirar incentivo de XP do suporte. Fechamento explícito de one-shot concede XP antes da limpeza. Acrescentar oito conquistas com progresso e sugestões opcionais, reconhecendo marcos históricos por projeção somente leitura. Quotas de conta continuam independentes do nível.

**Motivo:** valorizar encontros e colaboração, reduzir incentivo à repetição e mostrar objetivos alcançáveis sem penalizar ausências ou saídas antecipadas.

**Limites:** contadores consideram lançamentos recompensados; tempo entre entrada e encerramento não mede presença contínua. Expiração automática de one-shot não concede recompensa. A concorrência preexistente do resumo de XP não foi reformulada. Regras, valores, compatibilidade e limites estão em [PROGRESSAO_CENARIOS.md](PROGRESSAO_CENARIOS.md).

## ADR-043 — Atlas compartilhado e movimento ambiental

**Decisão:** ampliar o atlas para oito cenários, com cinco tilesets neutros novos, corrigir a grade da cripta e conectar as margens da floresta. Renderizar madeira, areia, mobiliário e bordas de água usando a grade oficial; usar um único seletor pesquisável nas sessões e na mesa. Expor o atlas na campanha sem substituir as pastas privadas. Refinar componentes compartilhados, pausar animações em aba oculta e interpolar marcadores somente na apresentação. Cache público v19.

**Motivo:** oferecer locais utilizáveis por diferentes sistemas e histórias, com leitura tática consistente e melhor descoberta dos cenários disponíveis.

**Limites:** tilesets são ilustrações procedurais no canvas, sem novas imagens de terceiros; movimento não altera alcance, colisão ou estado autorizado. Prefers-reduced-motion e abertura de 3.000 ms preservados. Não força atualização de PWA em sessão ativa.

## ADR-044 — Persistência de login opcional e limitada

**Decisão:** oferecer “Manter conectado por 14 dias” desmarcado, para senha, Google e Discord. Centralizar os tickets no Identity: login comum com janela de oito horas e teto de 24 horas; persistente com 14 dias fixos; administrador com MFA obrigatório, cookie sem persistência e oito horas fixas. Guardar início original nas propriedades protegidas do ticket e conferir o limite a cada requisição, inclusive ao reconstruir o principal. Preservar escolha de OAuth/MFA somente em tickets/state protegidos. Adicionar `POST /auth/logout-all` com CSRF e invalidação por security stamp. Descartar recursos contínuos ao perder autenticação e retomar apenas uma rota interna validada depois do login, sem repetir comandos.

**Motivo:** acomodar mesas longas e encontros semanais em dispositivos pessoais, com limite explícito de exposição e revogação no servidor. A renovação automática do Identity e o tráfego da mesa não podem manter um login válido indefinidamente.

**Limites:** tickets anteriores sem data original exigem novo login no rollout. Fechar o navegador não garante apagar cookie de sessão em navegadores que restauram sessões. Sair limpa o cookie local; sair de todos troca o stamp e afeta também desafios MFA na próxima requisição. Não inclui lista/revogação individual de dispositivos, detecção de atividade humana nem persistência de rascunhos. OAuth real depende de credenciais; testes usam state e tickets protegidos do middleware. Cache público v20, sem novos caminhos públicos nem atualização forçada.


## ADR-045 — Névoa, iluminação e visão decididas no servidor

**Decisão:** a mesa ganha névoa ativa por padrão em mapas com grade, paredes, portas e obstáculos por casa (bloqueio de movimento e de luz independentes), focos de luz, luz e visão por marcador (ficha → sobrescrita do mestre), elementos ocultos com revelação manual e automática (percepção/sentidos) e "ver como" para o mestre. O servidor calcula visibilidade e exploração (`FogRules`) e envia a cada jogador só o que ele enxerga: marcadores, marcas, paredes, linhas de tileset e, em mapas enviados, pixels da imagem. Eventos de criaturas não visíveis ficam com o mestre. A camada de cada mapa (`CampaignMapLayer`) é da campanha e continua entre sessões; "Recomeçar exploração" substitui "salvar como padrão". Configuração em três níveis: sistema (admin) → campanha (aba do mestre) → sessão (ajuste pontual, com pergunta de escopo na mesa).

**Motivo:** exploração com sigilo real. Esconder no canvas não protege contra as ferramentas do navegador, que todo jogador tem. Ajustes do mestre não devem ser refeitos a cada sessão.

**Limites:** bytes já entregues não são revogáveis; desenho dos mapas oficiais é público; exploração por mudança de ficha fora da mesa só é gravada na próxima escrita; custo de luz/máscara sem medição de carga. Cache público v21 com `fog-policy`, `fog-editor` e `table-settings`. Detalhes em [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md).

**Complemento — alcance no turno:** no turno do jogador a mesa mostra casas de movimento e a área do alcance de ataque, com arraste do boneco. Os valores vêm dos papéis `movement` e `reach` da ficha-modelo; sem eles nada é desenhado e o mestre informa verbalmente (sem `movement`, o servidor deixa de limitar a distância).


## ADR-046 — Condução independente do sistema, preparação reutilizável e continuidade

**Contexto:** a mesa presumia convenções de um único estilo de jogo: ataque básico 1d20 + Força, quatro categorias fixas, vida/nível sempre visíveis e turno obrigatório. One-shots eram apagadas 45 s depois de o mestre perder presença. Convites dependiam de código digitado, e o destino se perdia na confirmação de e-mail.

**Decisão:**
- **Forma de jogar** (`free`/`turns`/`tactical`) na cadeia de `TableSettings` (sistema → campanha → sessão), fixada em `GameSession.PlayMode` ao abrir a sessão. Valor ausente = tática (compatibilidade explícita). Mudança na mesa é ato explícito do mestre e gera evento; mudança da campanha fora da mesa não altera a partida em andamento.
- **Ações vêm da ficha e do modelo**, com `group` opcional para os nomes do sistema. Ataque básico e Defender ficam restritos à ficha clássica do Sistema livre.
- **Ficha resumida** derivada de `SheetField.Track` (`resource`/`summary`) e `MaxField`. O papel Vida da ficha clássica vira recurso. Atalhos pessoais em `Character.Shortcuts`, como preferência fora do versionamento.
- **Modelos privados de campanha** reutilizam `SheetTemplate`/`SheetTemplateVersion`, validação, publicação e migração. `CampaignId` (sem FK, para preservar versões de fichas pessoais) os tira do catálogo e do editor da equipe.
- **Rolagens:** construtor visual (`DiceSpec` + `DiceRoller`, puro e testado) ao lado do motor de fórmulas, que segue como opção avançada. Não ampliamos a gramática de fórmulas, para manter a paridade servidor/cliente já testada. Visibilidade `table`/`master`/`blind` aplicada com os campos existentes `MasterOnly`/`VisibleToUserId`.
- **Pedidos de teste** em `RollRequests` (alvos em JSON). Duplicidade impedida pelo bloqueio da sessão. Sem critério, nenhum resultado é declarado.
- **Desfazer** cria evento corretivo (`undoOf`), revalida permissão e estado atual e recusa mudanças concorrentes. Rolagens não são desfeitas.
- **Cenas** referenciam mapas por chave e guardam `Prepared`/`Saved` em JSON; exploração continua na camada por mapa. **Personagens do mestre** reutilizáveis, com cópias de encontro (`SourceId`). Visão simplificada por mapa (`MapFogState.Manual`/`Fog`) e `TableSettings.ManualReveal`.
- **One-shot recuperável:** sair da tela e perder presença não apagam; prazo `OneShots:RecoveryMinutes` (padrão 10, 1–120). Pausa (`PausedAt`) mantém a sessão como a única ativa. Encerrar continua apagando.
- **Conversão** de one-shot com ordem sessão → campanha → contas e quotas preservadas. **Arquivamento** sem sessão ativa, contando na quota.
- **Convite por link** com `AppUser.PendingInvite`, guardado sem Verified e sem conceder acesso. **Início** com próxima partida em destaque. **Diário** reaproveitando o acervo (`Kind` objetivo/pista), resumo publicado, data em UTC e presença.

**Motivo:** simplicidade sem perder compatibilidade. Cada ponto reaproveita um mecanismo existente — configuração em cascata, eventos com visibilidade, bloqueio da sessão, acervo, modelos versionados — em vez de criar camadas paralelas.

**Consequências e limites:**
- Migração aditiva `TablePlayEvolution`: colunas e tabelas novas. O índice único de nome de modelo foi recriado com filtro, sem tocar nos dados.
- O motor não cobre todas as mecânicas de todos os sistemas; o restante é resolução manual.
- Arquivadas continuam na quota. A proposta de liberar vaga fica separada, pois depende de decisão comercial.
- O prazo de recuperação é global do servidor.
- Testes cobrem regras puras, SQLite e PostgreSQL. Não houve medição de carga nem teste em aparelho físico.
- Detalhes em [CONDUCAO_MESA.md](CONDUCAO_MESA.md).

## ADR-047 — Ajuda contextual em três níveis com popover nativo

Status: aceito em 8 de novembro de 2026. Contexto: title não atende toque/teclado; o sistema possui um único modal e mesa imersiva, campos e conceitos com necessidades diferentes.

Decisão: texto auxiliar visível para requisitos; tooltip acessível breve para reforço; botão ⓘ para conceitos detalhados em popover nativo único não modal. Núcleo no shell, regras puras e catálogos públicos congelados por área, importados sob demanda. Modelo e inventário em [AJUDA_CONTEXTUAL.md](AJUDA_CONTEXTUAL.md), fonte de verdade para novas telas.

Alternativas descartadas: title nativo (inacessível a toque/foco), modal aninhado (conflita com o diálogo compartilhado), biblioteca externa (complexidade sem necessidade) e ajuda servida pelo backend nesta etapa (não precisa de contrato ou persistência).

Consequências: foco, Esc, hover persistente, viewport e descarte precisam de testes; inventário e catálogo acompanham cada funcionalidade. Cache pode incluir apenas textos estáticos públicos. Conteúdo de usuário, busca e telemetria ficam como evolução separada. Nenhum contrato HTTP é alterado.

## ADR-048 — Editor de cenas único, interface Básica/Completa e preparação separada da apresentação

**Contexto:**
- Cenas só podiam ser preparadas na mesa ao vivo ("apresentar, arrumar, guardar arranjo").
- Havia três editores paralelos: modal da cena, editor de névoa e paleta da mesa. As ferramentas da mesa só tinham ícones.
- `play.scene` lia a cena preparada: editar o texto mudava o que os jogadores viam sem aplicar.
- A camada de névoa era única por mapa, e o editor da camada aplicava direto à mesa quando o mapa estava em uso.
- Imagens enviadas exigiam grade, sem alinhamento.

**Decisão:**
- **Interface Básica/Completa** como preferência visual da conta (`AppUser.InterfaceMode`, nula = Básica). Separada das regras (`PlayMode`) e da visibilidade.
  - A Básica fica sempre no topo e na mesma posição; a Completa acrescenta grupos (`TOOL_INVENTORY`, testado contra as ferramentas reais).
  - Ajustes avançados ativos continuam valendo e são indicados.
- **Editor único** (`scene-editor.js`) para cena nova, cena existente, preparação compartilhada do mapa (Mapas e cenários) e edição sobre a mesa, sem substituí-la.
  - Abre em "Selecionar e mover". Arranjo privado (`Scene.Prepared`) validado no servidor contra a grade e a preparação do mapa.
- **Preparação × apresentação:**
  - `GameSession.SceneName/SceneText` guardam o que foi apresentado.
  - `CampaignMapLayer.Prepared` guarda a preparação salva com a camada na mesa.
  - "Aplicar à cena atual" é uma escrita explícita do `SessionService`, por partes, com revisão da cena e `prepVersion`. Preserva posições, explorações, portas da partida e revelações (soma, nunca cobre).
- **Mesmo mapa em várias cenas:** `Scene.LayerMode` `map` (compartilhada, padrão anterior) ou `scene` (`{mapa}@{cena}`, independente, sem duplicar bytes). `GameSession.LayerKey` indica a camada em uso.
- **Grade autoritativa com deslocamento** (`CampaignMap.GridOffsetX/Y`) e **apenas imagem** (`HasGrid`). Mesma conta em servidor (`CampaignMapView.Grid`), máscara de imagem, tabuleiro e `gridFor`.
- **Improviso:** trocar o cenário salva o estado da cena para retomar. "Salvar como cena" registra o improviso.

**Motivo:** permitir que um mestre iniciante prepare sem expor conteúdo, e que o experiente encontre tudo, sem criar camadas paralelas. Cada ponto reaproveita mecanismos existentes: bloqueio da sessão, eventos, `Revision`/`Pulse`, camada por chave, `TableFog.Fit` e o seletor compartilhado.

**Consequências e limites:**
- Migração aditiva `SceneEditorPresentation`, com padrões que preservam o comportamento anterior: `HasGrid = true` e `LayerMode = "map"`. Colunas nulas em sessões, camadas e contas.
- Sessões anteriores sem `SceneName` continuam mostrando a cena.
- "Aplicar" recoloca marcadores só com a parte opcional `tokens` (desmarcada por padrão); trocar o cenário continua exigindo "Reiniciar cena", oferecida como atalho com confirmação.
- A simulação do editor reproduz luz, revelação e a visão da ficha do personagem escolhido (mesmas regras de `FogRules`); sentidos especiais, Percepção e explorações anteriores ficam de fora. A prévia real continua na mesa.
- No celular, a vista Mapa da mesa mostra o tabuleiro logo após o topo e o grupo do mestre só na aba Grupo; o controle de Interface mantém as descrições associadas (`aria-describedby`) e explicadas no ⓘ, sem ocupar o topo.
- A preferência de interface é por conta. Sem teste em aparelho físico nem medição de carga.
- Detalhes em [CENAS_EDITOR.md](CENAS_EDITOR.md).


## ADR-049 — Catálogo global de músicas e trilha sonora compartilhada pela consulta ao vivo

**Contexto:**
- A mesa não tinha áudio próprio; só existia a trilha global do site (`music.js`).
- O mestre precisa escolher e controlar a mesma música para todos, com quem entra depois acompanhando o ponto atual.
- A hospedagem é IIS compartilhado com PostgreSQL de quota limitada; arquivos de áudio são grandes e tocados por HTTP Range.
- A primeira versão previa um acervo enviado pelo mestre em cada campanha. Antes de qualquer publicação, o usuário decidiu que as músicas vêm do servidor.

**Decisão:**
- **Catálogo global gerenciado pelo Admin.** O mestre não envia arquivos: só busca por nome e reproduz. Envio, renomeação e exclusão ficam no Painel admin, com auditoria. A busca do mestre recebe só título, formato e duração.
- **Limites e validação:** MP3, M4A (AAC) e OGG; 20 MiB por arquivo, 200 faixas e 2 GiB no catálogo; arquivo repetido (SHA-256) recusado. Validação estrutural própria (`AudioProbe`); antivírus removido pelo ADR-051; áudio não passa pelos decodificadores de imagem. Quota serializada por `pg_advisory_xact_lock`.
- **Bytes em disco privado** (`Music:Directory`, padrão `App_Data/music`), metadados no PostgreSQL. Diferente dos mapas (bytea): o Range servido do disco não carrega o arquivo inteiro na memória a cada trecho e não infla a quota do banco compartilhado. Nomes opacos, gravação atômica, exclusão após commit e varredura de órfãos.
- **Estado autoritativo em `GameSession`** (faixa, tocando, posição e instante de referência, repetição, versão). Escrita só pelo `SessionService`, com o fluxo comum da mesa.
- **Bloqueios sem ciclo:** seleção bloqueia sessão → faixa (`FOR SHARE`); exclusão bloqueia só a faixa (`FOR UPDATE`) e recusa com `409` se alguma sessão ativa a usa.
- **Distribuição pela consulta ao vivo existente**: sem WebSocket ou novo canal. A latência do long-poll basta porque o cliente calcula a posição pelo relógio do servidor.
- **Versão de comando**: o cliente envia a versão conhecida; diferente da atual, `409`. Respostas e eventos antigos são descartados no cliente.
- **Sincronização tolerante**: ajuste suave de velocidade para desvios médios, salto raro para grandes; "Ativar áudio da sessão" quando o navegador bloqueia.

**Consequências e limites:**
- Migração aditiva `SessionSoundtrack` (colunas em `Sessions` com padrões neutros e tabela `MusicTracks` sem campanha). A versão anterior por campanha nunca foi aplicada nem publicada e foi regenerada.
- Excluir uma campanha não afeta o catálogo. O backup passa a incluir o diretório de áudio junto com o PostgreSQL e as chaves.
- Bytes entregues não são revogáveis; não há sincronização perfeita nem reprodução automática garantida. OGG pode não tocar em alguns aparelhos Apple.
- Excluir faixa em uso exige que o mestre pare ou troque a música. Vários hosts exigiriam armazenamento compartilhado de áudio.
- Detalhes em [TRILHA_SONORA.md](TRILHA_SONORA.md).

## ADR-050 — Revisão de modais e da ajuda: popup centralizado, ⓘ junto ao texto e X único

**Contexto:** em uso real, os ⓘ de 44 px visíveis ficaram desproporcionais e, por serem irmãos de títulos em blocos ou em linhas `space-between`, apareciam soltos no meio da linha ou abaixo do título. O popup ancorado ao gatilho (folha inferior no celular) variava de posição. Modais tinham X e botão “Fechar” ao mesmo tempo, tooltip “Fechar” sobre o X, rolagem do diálogo e do corpo ao mesmo tempo, bordas padrão do navegador em `fieldset` e um input dentro de `legend`. Na aba Mapas e cenários, criar pasta e enviar mapa ficavam no topo, longe do explorador, abaixo do Atlas.

**Decisão:** substitui as partes de posição e tamanho do ADR-047.
- ⓘ de 18 px visíveis, área de toque por pseudo-elemento (cerca de 30 px no mouse e 44 px em toque), sempre colado ao texto: dentro do título, da legenda ou do `summary`, ou ao lado do label em `.field-label`.
- O popup de ajuda é sempre centralizado com fundo levemente escurecido e fecha só pelo X (mais Esc e clique fora).
- Modais têm cabeçalho fixo (título + X sem tooltip). Só o corpo rola, e os botões de texto “Fechar” redundantes saem. Formulários mantêm Cancelar.
- `fieldset`/`legend` ganham a moldura dourada comum. O modelo simples da campanha deixa de usar input dentro de `legend`.
- Na aba Mapas e cenários, ações de pasta e envio ficam no bloco “Mapas da campanha”, abaixo do Atlas. A pasta aberta pode ser renomeada (`PUT /folders/{id}`, mesmo bloqueio de campanha das demais escritas).

**Consequências:**
- Nomes acessíveis de títulos com ⓘ incluem “Ajuda: …”, uma troca aceita pela proximidade visual.
- `tests/help-ui.mjs` passa a medir tamanho e distância do ⓘ, centralização e X.
- `tests/modals-ui.mjs` abre os modais alcançáveis em desktop e celular e acusa rolagem dupla, transbordo, `fieldset` padrão, ⓘ grande, tooltip no X e “Fechar” duplicado.
- Cache público v29.

**Complemento (mesmo dia):**
- Formulários com altura única de 44 px e dicas automáticas só quando orientam.
- Foco de campos por dentro e de botões colado; contorno interno em áreas com rolagem.
- Fade de 160 ms em modais e popups, só com CSS e sem atrasar ações.
- Classes de layout do modal saem ao abrir o próximo.
- Novas verificações automáticas de alinhamento e foco cortado.
- Cache v30.

**Correção (mesmo dia):** ao fechar, modal e popup de ajuda perdiam `[open]`/`:popover-open` mas seguiam visíveis no fade de 160 ms; a coluna flex e o `overflow` estavam presos a esses seletores, e o layout se rearranjava (popup de ajuda saltava de 247 para 397 px), parecendo piscar. Direção e `overflow` passam à regra base; só `display` depende do estado aberto. Cache v31.

**Revisão visual da mesa e formulários (mesmo dia, cache v31):**
- Rádio e checkbox não herdam `min-height: 44px` nem o `padding` dos campos de texto; o foco volta a ser circular.
- Regra global `label` do `game.css` (`margin: 15px 0 5px`) anulada nos rótulos usados como componentes (cartões de cenário, opções Básica/Completa), que desalinhava grades e o alternador.
- Seletor de cenários: cada grupo ocupa a linha inteira e os cartões ficam lado a lado (4 colunas no desktop, 2 no celular).
- Trilho do mestre com 200 px, sem rolagem horizontal, ícones numa coluna e rótulos inteiros; chip do cenário alinhado ao trilho.
- Alternador Básica/Completa com 44 px (mesma altura dos botões do topo) e 4 px de respiro em volta da opção marcada.
- ⓘ da barra de turno no tamanho padrão de 18 px.
- Aba Rolagens só com “Montar rolagem” e “Pedir teste”, do mesmo tamanho; atalhos 1d20/1d6/1d100 removidos.
- Painel de imagem temporária sem espaço reservado pelo status vazio.

## ADR-051 — Áudio do catálogo sem antivírus

**Contexto:** a produção roda em hospedagem compartilhada (SmarterASP.NET). O suporte confirmou que a aplicação não pode chamar o antivírus do servidor nem manter um `clamd` próprio; só VPS/Cloud permite. Migrar para VPS não é opção. Com o ClamAV obrigatório, todo envio de música respondia `503`.

**Decisão:** o envio de áudio ao catálogo deixa de passar pelo `IDocumentScanner`. Continuam valendo: envio só pelo Admin (política Admin com MFA), limite de 20 MiB, validação estrutural completa pelo `AudioProbe`, SHA-256 contra duplicidade, disco privado fora de `wwwroot` e entrega com `nosniff`, CSP sandbox e `Cross-Origin-Resource-Policy: same-origin`. Documentos da biblioteca, PDFs de modelos e avatar continuam exigindo antivírus e seguem indisponíveis enquanto não houver scanner.

**Consequências:**
- Um arquivo de áudio infectado enviado por um Admin não seria detectado. O navegador só o reproduz; a plataforma não executa os bytes.
- A segurança do envio depende da conta Admin (MFA) e da validação estrutural; decodificadores de áudio do navegador continuam sendo superfície externa.
- Os erros `422`/`503` de scanner deixam de existir na rota de música.

## ADR-052 — Espera em primeiro plano sem piscar em operações rápidas

**Contexto:** a superfície de carregamento (ADR-012) aparecia e sumia em toda ação de formulário, mesmo quando a resposta chegava em ~100 ms. Na mesa isso aparecia como piscadas na tela (por exemplo, ao registrar uma nota compartilhada) e deixava ver o fade do modal através do fundo translúcido.

**Decisão:** em operações (fora da abertura e da manutenção), `js/loading.js` trava a interface na hora (`inert`, `aria-busy`, Esc bloqueado no modal) e só exibe a superfície se a operação continuar pendente depois de `OPERATION_REVEAL_MS` (300 ms). Nenhuma ação é atrasada; abertura e manutenção continuam imediatas. Com a superfície aberta, o modal que fecha some sem transição.

**Consequências:** respostas rápidas não piscam; esperas longas mantêm o mesmo retorno visual. Durante os primeiros 300 ms a interface fica bloqueada sem aviso visual além do botão ocupado do formulário.

## ADR-053 — Só o mestre escolhe quem vê as rolagens

**Contexto:** jogadores escolhiam a visibilidade das próprias rolagens; o mestre queria decidir e também mostrar uma rolagem só a alguns jogadores.

**Decisão:**
- Rolagens do mestre: mesa inteira, somente ele ou ele e jogadores escolhidos (`group`, 1 a 20 personagens da sessão).
- Rolagens de jogador seguem `TableSettings.PlayerRollVisibility` (mesa inteira, quem rolou e o mestre, ou somente o mestre), definida na configuração da mesa; o servidor ignora o valor enviado pelo jogador.
- `group` grava o original privado do mestre e uma cópia privada por destinatário (`TableEvent.IsRecipientCopy`, migração aditiva `RollRecipientCopies`); o mestre não recebe as cópias no estado ao vivo nem no histórico.
- Pedidos de teste mantêm mesa / quem rolou e o mestre / só o mestre.

**Consequências:** a escolha do jogador some do construtor (ele vê a regra vigente). Uma rolagem em grupo gera N+1 eventos.

## ADR-054 — Fichas e imagens de NPCs e criaturas

**Contexto:** o mestre precisava acompanhar o estado de cada NPC/criatura e mostrar uma imagem aos jogadores.

**Decisão:**
- `MasterCharacter` ganha `Kind` (npc/creature), `TemplateVersionId`, `Values` e `ImageUrl` (migração aditiva `NpcSheetsAndImages`; registros antigos ficam `npc`, sem ficha).
- A ficha usa os mesmos modelos aceitos pelas fichas da campanha e a mesma validação de valores. A gravação bloqueia sessão ativa → personagem, grava evento privado e incrementa a revisão.
- Imagem: do acervo (`asset:{id}`, servida por rota que confere a visibilidade do marcador) ou link `https://` validado (sem credenciais). A CSP já permitia `img-src https:`. Marcador oculto ou apenas percebido não envia imagem ao jogador.
- O envio de novas imagens ao acervo continua passando pelo antivírus (mesma rota dos mapas): sem ClamAV na hospedagem compartilhada, use o link https ou imagens já presentes no acervo.

**Consequências:** link externo expõe o IP de quem abre ao site da imagem e pode mudar de conteúdo; o formulário avisa e recomenda o acervo. Fichas de NPC não têm histórico por campo nem PDF.


## ADR-055 — Continuidade e acervo da campanha (10/11/2026)

Decisão: registrar origem nova/trazida, numeração mínima e resumo compartilhado sem exigir reconstruir o passado. Registros anteriores são PastSession e não sessões ao vivo nem fontes de XP. A numeração de ambas usa bloqueio comum da campanha, preservando a única sessão ativa.

Páginas do mundo e notas usam WorkspacePage, mantendo caderno pessoal com autorização distinta das fichas: self exclui mestre; compartilhamento concede leitura. Segredos/versões só para editor. SET NULL no vínculo da campanha preserva notas do autor. Leitura do caderno próprio oferece recuperação textual fora da campanha; arquivos exigem vínculo.

Arquivos reutilizam DocumentFiles e CSRF; atlas publica cópia explícita da imagem inteira, sem sincronizar mudanças futuras do preparo. Limites, preservação, alternativas e lacunas documentados em CAMPANHAS_CONTINUIDADE.md. Coleções são texto simples, capítulos têm um nível, relações têm limite vinte; importadores por plataforma e pacote integral ficam fora desta entrega.


## ADR-056 — Mesa horizontal no celular (10/11/2026)

Pedido: exigir a visão deitada e aproximar a organização da mesa web. A mesa em dispositivo de toque até 1200 px exige orientação horizontal; em retrato mostra instrução acessível e retorno à campanha, deixando o shell inerte. `table-viewport.js` tenta `screen.orientation.lock("landscape")` ao montar. O botão Tela cheia solicita fullscreen do documento (mantendo os modais globais) e tenta novamente com gesto do usuário. Falta de suporte/recusa exige rotação manual, sem alegar que o site controla o sistema. Somente a mesa é afetada; manifest e demais páginas conservam orientação livre. Sair remove listeners, libera o bloqueio adquirido e sai da tela cheia que o módulo abriu.

Layout compacto até 900 px ou toque até 1200 px: altura do viewport, topo em faixa rolável, mapa central e painéis de grupo/ficha/conversa à direita sob demanda. Mapa recolhe os painéis para ampliar o cenário. Rodapé em linha própria do grid com ações roláveis e navegação inferior, sem sobrepor o mapa; motivos iguais de indisponibilidade do mestre compartilham texto com aria-describedby. Ferramentas não encolhem nem se sobrepõem. Desktop conserva as três colunas. Cache v33, sem skipWaiting/recarga de mesa ativa.

Limitação: fullscreen/lock dependem do navegador e do aparelho. A validação automatizada de viewport não comprova rotação física, teclado virtual, área segura real ou instalação iOS/Android.


## ADR-057 — Câmera e controles compartilhados de mapas (10/11/2026)

Pedido: ajuda sempre circular, barras horizontais roláveis, mapa maior e mesma experiência na preparação; pinça restrita ao mapa em telas touch. O componente help-button fixa 18×18 px independentemente das regras de botões, preservando o alvo ampliado por pseudo-elemento. Mesa reúne comandos superiores numa faixa; rodapé também rola sem quebrar em colunas.

createBoard compartilha câmera local com mesa e editor único de cenas/mapas: inicia preenchendo o viewport compacto, preserva proporção da grade, permite arrastar, Mapa inteiro, Ampliar e botões −/+. Zoom mínimo ajusta o mapa inteiro; máximo equivale a três vezes a escala que preenche o viewport. Superfícies rolam até as bordas; canvas limita seu buffer a 4096 px por lado ajustando DPR. Desktop inicia com mapa inteiro. A câmera não modifica coordenadas de jogo, máscaras ou permissões.

map-gestures.js captura pinça só na superfície; dois dedos cancelam arraste de marcador/pintura pendentes antes de soltar. Ajuste de grade reutiliza o gesto com limite 1–4× e sem alterar tamanho/alinhamento salvos. Nenhum preventDefault/touch-action global impede zoom do navegador fora dessas superfícies. Editor compacto tem comandos e ferramentas roláveis, prévia central e propriedades recolhíveis; em retrato mantém prévia e propriedades empilhadas. Preparação continua privada até os comandos explícitos existentes.


## ADR-058 — Antivírus de documentos em melhor esforço (10/11/2026)

**Contexto:** a hospedagem compartilhada não oferece `clamd` (ADR-051). Com o ClamAV obrigatório, todo envio de PDF/imagem que passa por `DocumentFiles` (biblioteca, PDFs de fichas-modelo, mapas e imagens do acervo, anexos do caderno) respondia `503`.

**Decisão:** `ClamAvDocumentScanner` sempre tenta verificar quando há host configurado (`Uploads:ClamAv:*`, com fallback para `Avatar:ClamAv:*`). Resposta `FOUND` continua recusando com `422`. Scanner não configurado, recusa/timeout de conexão (5 s para conectar, 30 s no total) ou resposta inesperada não bloqueiam mais: o documento é aceito e um aviso sem conteúdo do arquivo vai para o log. `Uploads:AllowUnscanned` deixa de ser necessário. Continuam valendo assinatura/tipo real, limite de 25 MiB, nome saneado, SHA-256, armazenamento fora de `wwwroot`, pdf.js sem scripting e entrega com CSP sandbox. O avatar não muda: continua exigindo antivírus e moderação e falha fechado.

**Consequências:** enquanto não houver `clamd`, documentos são publicados sem varredura e um arquivo malicioso não seria detectado; a proteção depende da validação estrutural, do visualizador sem scripts e do isolamento na entrega. Os avisos no log indicam quantos envios ficaram sem verificação.


## ADR-059 — Campanha sem abas escondidas, loading translúcido, contagem de caracteres e retrato dos marcadores (10/11/2026)

Pedido: tudo alinhado e fluido na página da campanha, sem abas que surgem ao clicar; diário compreensível; loading sem piscar; contagem nos campos limitados; imagem carregada como avatar do marcador, visível e editável pelo mestre; registro opcional por cena nas sessões anteriores.

**Navegação da campanha:** a barra tem só abas fixas — Visão geral, Diário, Preparação (mestre), Grupo, Mundo e acervo, Minhas notas e Configurações (mestre). Subpáginas ficam dentro da aba-mãe com um submenu sempre visível: Mundo e acervo › Páginas, Atlas compartilhado, Bibliotecas, Mapas e cenários (mestre); Configurações › Campanha, Mesa. Os botões soltos acima da coluna lateral saem. Endereços antigos continuam válidos: `#campaign/{id}/sessions` e `/past` abrem o Diário já na seção; `/atlas`, `/resources`, `/maps` e `/table` destacam a aba-mãe. O convite vive em Grupo (Configurações aponta para lá). Paginação só aparece quando há mais de uma página; o motivo de botão indisponível na paginação continua acessível, sem empurrar o layout.

**Diário em uma página, na ordem de leitura:** próxima partida; objetivos e pistas lado a lado; Sessões no Eternnus (só mestre: histórico, notas e resumo de cada sessão); Resumos (busca e leitura do grupo); Antes do Eternnus. Cada bloco tem título e texto explicando o que é e quem vê.

**Sessões anteriores com cenas:** `PastSession.Scenes` (JSON, migração `PastSessionScenes`, coluna nula — registros existentes preservados) guarda cenas opcionais `{title, text}` em ordem. Até 30 cenas, título ≤ 120 (vazio vira “Cena N”), texto ≤ 10.000, soma ≤ 60.000 para manter a listagem paginada leve. Mesma visibilidade do registro. O editor permite adicionar, reordenar e remover cenas; a leitura mostra as cenas numa lista recolhível.

**Loading:** abertura e manutenção continuam opacas e imediatas (3.000 ms intactos). Troca de tela (`withLoading(..., { kind: "route" })`) usa a mesma animação e textos numa camada translúcida sobre a tela atual, sem o cenário de fundo; a página da campanha busca os dados antes de trocar o conteúdo e a moldura (menu lateral, topo, música) não é reconstruída quando a identidade não mudou. Ações por botão travam e escurecem levemente a tela; o botão acionado (envio de formulário ou último clique) mostra um círculo girando no lugar do rótulo até liberar. A camada só aparece após 200 ms; chamadas encadeadas mantêm a mesma camada (intervalo de 40 ms só para a parte visual — a trava sai na hora). Nenhum atraso é acrescentado às ações.

**Contagem de caracteres:** todo campo de texto com `maxlength` dentro de `.field` mostra “usados/limite” no canto da linha do rótulo (textareas sempre; campos curtos ao focar ou perto do limite), ligado por `aria-describedby`. A dica automática deixa de repetir “Até N caracteres”. Os limites de 5.000 passam a 10.000: premissa e “Onde paramos” da campanha, premissa de one-shot, resumo de sessão, resumo de sessão anterior e mensagens de suporte (migração `ExpandLongTextLimits`, que só amplia colunas).

**Retrato do marcador:** marcador de NPC/criatura com imagem é desenhado com a imagem recortada no círculo (iniciais quando não há imagem ou a carga falha). A URL protegida do retrato ganha `?v=` derivado da imagem escolhida para trocar no navegador quando muda. “Ficha do elemento” mostra a prévia (link para tamanho real) e permite trocar ou remover a imagem por `PUT /npcs/{id}/image`, só mestre, com o fluxo transacional da mesa. Endereços de imagem passam por `safeImageUrl` (`play-policy.js`): https validado, retrato da sessão ou imagem do acervo da campanha. Jogadores continuam recebendo a imagem só de marcadores que enxergam.

Cache v35. Limitação: link https externo pode mudar de conteúdo ou ficar indisponível; o acervo continua recomendado.


## ADR-060 — Capítulos, atos e arcos das sessões e premissa com parágrafos (10/11/2026)

Pedido: a premissa aparecia como texto corrido; o topo da campanha deve mostrar um trecho com "mais" abrindo o texto formatado; sessões podem ser avulsas, mas o ideal é criar capítulos/atos/arcos antes e associar cada sessão a um deles.

**Premissa:** o texto já era gravado com as quebras de linha; só a exibição as descartava. A Visão geral usa `.workspace-prose` (`pre-wrap`). O topo mostra até três linhas/260 caracteres com `white-space: pre-line` e o botão "mais" (`aria-haspopup=dialog`), que abre o texto completo no modal comum. Nenhuma mudança de dados.

**Capítulos:** nova entidade `StoryChapter` (campanha, rótulo `chapter|act|arc`, título, resumo, ordem, revisão). Lista plana: o rótulo não cria hierarquia, para não exigir árvore de arcos/atos/capítulos sem uso concreto. `GameSession.ChapterId` e `PastSession.ChapterId` são opcionais (sessão avulsa) com FK `SET NULL`; excluir um capítulo nunca apaga sessões. As páginas `chapter` do acervo não foram reutilizadas: são textos de lore com visibilidade própria; o capítulo de sessões é organização privada do mestre, como a lista de sessões.

**Fluxo:** o Diário do mestre ganha o bloco "Capítulos, atos e arcos" antes de "Sessões no Eternnus". Ao iniciar sessão ou registrar uma anterior, o seletor sugere o capítulo da sessão mais recente; sem capítulos, sugere criar o primeiro no mesmo envio (criado uma única vez, mesmo se a abertura falhar), e "Sessão avulsa" continua disponível. Mover sessão de capítulo passa por `SessionService` (bloqueio, revisão, `Pulse`), sem evento na linha do tempo. Ordenar e excluir capítulos usa o bloqueio da campanha.

**Consequências:** migração aditiva `StoryChapters` (tabela nova, duas colunas nulas, índices e FKs); bancos existentes preservados e sessões existentes ficam avulsas. Jogadores não veem capítulos nesta entrega; resumos e registros publicados continuam como antes. Cache v36 acrescenta `js/campaign-chapters.js`.


## ADR-061 — Tabela única de sessões, busca geral, NPCs conhecidos e importação em lote (10/11/2026)

Pedido: capítulos e sessões anteriores em tabelas paginadas; busca nas sessões para mestre e jogadores; sessões do Eternnus e anteriores na mesma tabela, diferenciadas por coluna; NPCs visíveis aos jogadores; importação em lote de atos e sessões por modelo baixado no site, com cuidado contra injeções; busca geral na Visão geral com link para o conteúdo.

**Tabela única:** `GET /session-log` faz UNION ALL das duas tabelas numa projeção comum, ordenada por número e paginada no banco (vinte). A coluna **Origem** ("No Eternnus" / "Antes do Eternnus") diferencia as fontes; o mestre vê também **Estado** (Publicado, Privado, Sem resumo, Em andamento). As ações por sessão (histórico, notas, resumo, capítulo, editar) ficam na leitura da sessão, para manter a tabela legível e operável no celular, onde as linhas viram cartões. Substitui os blocos "Sessões no Eternnus", "Resumos das sessões" e "Antes do Eternnus".

**Mudança de regra:** antes o jogador não recebia a lista de sessões. Por pedido explícito, o jogador agora consulta a tabela, mas só com sessões cujo resumo foi publicado e registros anteriores publicados — o mesmo conteúdo que já lia em "Resumos" e "Antes do Eternnus". Objetivo inicial, rascunhos, notas e histórico da mesa continuam do mestre. O título do capítulo aparece ao jogador apenas em sessões visíveis; resumo do capítulo nunca. AGENTS.md foi atualizado.

**Busca:** `TextSearch` gera ILIKE (PostgreSQL) ou LIKE (SQLite nos testes) com curingas escapados e o termo como parâmetro; nunca SQL montado. Cenas (JSON) são consultadas com `Any` traduzido pelo provedor. Sem índice de texto completo nem remoção de acentos nesta entrega: a busca é por trecho, sem diferenciar maiúsculas, e pode ficar lenta com acervos muito grandes (não medido). A busca geral reaproveita as regras de visibilidade de cada tela e limita oito resultados por tipo; segredos de páginas nunca entram.

**NPCs conhecidos:** `MasterCharacter.SharedWithPlayers` (migração aditiva `SharedMasterCharacters`, padrão falso). O grupo vê nome, tipo, resumo e imagem numa subpágina de "Mundo e acervo"; lado, recursos, ficha e notas continuam privados. Imagem do acervo sai por rota própria que confere o compartilhamento.

**Importação:** CSV (não XLSX) para não acrescentar dependência de leitura de planilhas binárias; Excel, LibreOffice e Google Planilhas abrem e salvam o modelo. Fluxo em duas etapas — prévia sem gravar e confirmação com o mesmo arquivo — e gravação tudo-ou-nada sob o bloqueio da campanha. Defesas: limite de corpo dedicado (1 MiB + margem), um único arquivo, extensão .csv/.txt, UTF-8 estrito com recuo para Windows-1252, recusa de bytes nulos, caracteres de controle e controles bidirecionais (Trojan Source), leitor RFC 4180 próprio sem avaliação de conteúdo, limites de linhas/colunas/campos, validação por linha com os mesmos limites dos formulários, números conferidos contra as duas tabelas. O conteúdo é texto puro e sempre escapado na interface. Fórmulas de planilha (`=…`) são guardadas como texto: o site não exporta esses dados para planilhas, então não há reinjeção; se uma exportação surgir, ela deve neutralizar células iniciadas por `= + - @`. Importa só sessões anteriores (não cria sessões da mesa) e não altera registros existentes.

**Consequências:** cache v37 acrescenta `campaign-sessions.js` e `campaign-search.js`. Rotas da campanha aceitam um item opcional (`#campaign/{id}/{aba}/{item}`) para abrir sessão, página, NPC, capítulo ou a premissa a partir da busca.

## ADR-062 — Capítulos, atos e arcos visíveis aos jogadores por escolha do mestre (10/11/2026)

Pedido: os atos/capítulos/arcos devem ficar visíveis também para os jogadores, apenas os que o mestre determinar.

**Decisão:** `StoryChapter.Published` (migração aditiva `PublishedChapters`, padrão falso). Capítulos existentes, importados ou criados pelo seletor da sessão começam ocultos; o mestre marca “Visível para os jogadores” no editor. O jogador lê tipo, título e resumo dos capítulos visíveis no bloco do Diário (só leitura, some quando não há nenhum), no filtro e na coluna Capítulo da tabela de sessões e na busca geral. As contagens dele consideram só sessões publicadas.

**Capítulo oculto não vaza:** para o jogador, `session-log`, `session-log/{key}` e a busca devolvem `chapterId`/`chapterTitle` nulos quando o capítulo está oculto; filtrar por um capítulo oculto não traz linhas, e essas sessões entram em “Sem capítulo”. A regra fica no servidor (`ShownChapters`), não na tela.

**Mudança em relação à ADR-061:** antes o jogador via o título do capítulo de qualquer sessão publicada. Agora só vê capítulos publicados. O resumo do capítulo passa a ser lido pelo grupo quando o capítulo está visível; o editor avisa isso.

**Consequências:** cache v39. Ajuda `campanhas.capitulos.organizacao` passa a ser para todos.

## ADR-063 — Um acervo só (Páginas), objetivos e pistas como páginas e imagens por link (11/11/2026)

Pedido: o “+ Texto da campanha” das Bibliotecas e a “+ Página” do Mundo faziam a mesma coisa; escolher o mais simples e intuitivo para objetivos e pistas do Diário. Depois: imagem por link ou arquivo em páginas, mapas e personagens do mestre.

**Decisão — acervo:** Páginas (`WorkspacePage`) é o único acervo textual da campanha. Bibliotecas mostra só os atalhos (biblioteca geral e do sistema) e um aviso apontando para Páginas. Textos antigos (`CampaignLibraryEntry`) não podem mais ser criados nem editados (`POST/PUT /assets/library` saem); enquanto existirem, aparecem em “Textos antigos da campanha” com **Converter em página** e **Excluir**. Converter copia título e texto (publicado → “Toda a mesa”; rascunho → “Só eu”; objetivo/pista mantêm o tipo), guarda `ConvertedPageId` e tira o texto da lista. O registro antigo é preservado, sem sincronização posterior.

**Decisão — Diário:** objetivos e pistas passam a ser páginas dos tipos `objective`/`clue`, que já tinham estado aberto/resolvido/abandonado, segredos, relações, versões e anexos. O Diário lê essas páginas com a regra de leitura das páginas (mestre vê todas; jogador vê “Toda a mesa” e as compartilhadas com ele; segredos nunca entram) e usa o mesmo editor: “+ Objetivo”/“+ Pista” abrem a página já com o tipo, começando em “Só eu”. Alternativa descartada: manter um formulário simplificado gravando em outra tabela — duplicaria regras e o conteúdo apareceria em dois lugares.

**Migração `LegacyTextsToPages`:** acrescenta `ConvertedPageId` e copia objetivos/pistas antigos para `WorkspacePage` (dono = mestre da campanha), sem apagar os originais. O `Down` remove só a coluna; as páginas copiadas ficam, pois podem ter sido editadas.

**Decisão — imagens:** mapas e anexos de página aceitam imagem por link. O servidor baixa uma única vez (`RemoteImageFetcher`) e trata o resultado como upload: assinatura, antivírus e, nos mapas, normalização. Hotlink foi descartado para mapas porque a névoa mascara os bytes no servidor; nos anexos, porque os leitores exporiam o IP ao site de origem. Defesas contra SSRF: autorização antes de qualquer acesso à rede; só https na porta padrão, sem credenciais nem nomes locais; DNS resolvido no servidor e conexão só a endereços públicos (todos os endereços do nome precisam ser públicos); sem proxy, cookies ou redirecionamento automático (até três, cada um revalidado); 15 s e 10 MiB. Imagens anexadas aparecem na leitura da página. O personagem do mestre (e a criatura criada na mesa) ganha envio de arquivo: a imagem entra em Mapas e cenários como “Apenas imagem” e o personagem usa `asset:{id}`; o link https direto continua como antes, com o aviso de privacidade.

**Limites:** a imagem do NPC é enviada antes de salvar o personagem; se o salvamento falhar, ela fica no acervo para reuso. Retratos enviados contam no teto de 50 mapas e 250 MiB. Sites que exigem login, cookies ou bloqueiam robôs não podem ser importados; o mestre envia o arquivo. Cache público v41.

## ADR-064 — NPCs nascem em Preparação; páginas contam a história deles (11/11/2026)

Pedido: havia NPCs da Preparação (exibidos em “NPCs conhecidos”) e páginas do tipo NPC (exibidas só em Páginas), sem relação entre si. O mestre esperava ver as páginas NPC em “NPCs conhecidos”.

**Decisão:** a Preparação é o único cadastro de NPCs. É nela que o mestre decide se o personagem existe e se o grupo o conhece (“Visível para os jogadores”). O tipo `npc` deixa de ser oferecido em páginas novas. O servidor recusa `kind: npc` em criação e em troca de tipo, mas aceita páginas que já são desse tipo, que continuam editáveis (não havia nenhuma na base em uso). O texto longo continua em Páginas: o vínculo que já existia (`WorkspacePage.NpcId`, só do mestre) passa a ser a “história” do NPC. Não há coluna nem migração nova.

**Exibição:** “NPCs conhecidos” mostra “Ler página” quando a página ligada está fora da lixeira e quem consulta pode lê-la, pela mesma regra de leitura das páginas (`WorkspaceService.Readable`). Se houver mais de uma página ligada, vale a fixada primeiro e depois a de menor título. O mestre vê um aviso quando a página não é de toda a mesa. Na Preparação, cada NPC mostra o link da história ou o botão “+ História”, que abre uma página nova já ligada e privada (“Só eu”). Na lista de Páginas, o mestre vê o selo “NPC: nome”.

**Privacidade:** o jogador só fica sabendo que uma página trata de um NPC quando o NPC está compartilhado e ele já pode ler a página. NPC oculto, página privada e página na lixeira não aparecem. Os segredos da página continuam fora.

**Exclusão:** como `NpcId` não tem chave estrangeira, excluir o NPC limpa o vínculo das páginas na mesma transação. As páginas continuam no acervo. Antes, o id órfão fazia a página responder 404 ao salvar.

**Alternativa descartada:** juntar páginas NPC e NPCs da Preparação na mesma lista sem vínculo. Mantinha dois cadastros e duas regras de visibilidade para o mesmo personagem.

**Consequências:** cache v42 (nenhum arquivo novo na lista). Ajuda `campanhas.preparo.personagens` ganha o parágrafo da história.

## ADR-065 — Vida e recursos de NPCs ficam na ficha, não no cadastro (11/11/2026)

Pedido: o cadastro de personagem do mestre trazia “Recursos” (com `Vida 10/10` já preenchido), e a ficha, criada depois, também acompanha vida e recursos pelo modelo. Com um modelo escolhido, a mesa mostrava os dois: a vida da ficha e a vida simples com −/+, sem sincronia.

**Decisão:** o cadastro guarda só identidade (nome, tipo, lado, resumo, imagem, notas, visibilidade). “Ficha” é o único lugar do estado: sem modelo, edita os recursos simples (até 8, nome/valor/máximo); com modelo, os campos do modelo. Ao criar um personagem, a ficha abre em seguida.

**Servidor:** `NpcInput.Resources` omitido ou nulo mantém os recursos na edição (criação começa vazia); clientes antigos que enviam a lista continuam funcionando. `PUT /npcs/{id}/sheet` aceita `resources` só com `templateId` nulo e devolve `simpleResources`. Escolher um modelo não apaga os recursos simples: eles ficam guardados, somem de `GET /live` (`resources: []` quando `hasSheet`) e `POST …/resource` responde 409; voltar a “Sem ficha” os traz de volta. A gravação segue o fluxo existente da ficha (sessão → personagem bloqueados, evento privado, `Revision++`, sinal após o commit).

**Alternativa descartada:** manter a seção no cadastro, recolhida e sem valor inicial. Mais simples, mas a duplicação com a ficha continuava possível.

**Consequências:** sem migração; NPCs existentes mantêm seus recursos. Cache v43 (nenhum arquivo novo na lista). Ajudas `campanhas.preparo.personagens` e `mesa.npcs.ficha` explicam onde ficam os recursos. A lista da Preparação passa a mostrar o lado (Inimigo, Neutro, Aliado) como selo com texto e a cor do marcador no mapa; o vermelho do texto é mais claro para manter contraste. Em “NPCs conhecidos”, o retrato vira botão (nome acessível e tooltip) que abre a imagem inteira no visualizador comum `showImage`; `safeImageUrl` passa a aceitar a rota `/api/campaigns/{id}/known-npcs/{npcId}/portrait?v=…`, e a página deixa de ter validação própria (cache v44).

## Tabelas com busca e filtros, 15 por página

Toda tabela da plataforma pagina em 15 itens. A busca geral da campanha não limita mais o número por tipo: retorna todos os acertos, paginados, com filtro de tipo aplicado antes da paginação. Os NPCs conhecidos e os personagens do mestre passam a ser tabela com busca por nome/resumo e filtros por coluna (lado, tipo, visível ao grupo). A busca e os filtros de tipo ficam no servidor quando a lista é paginada pelo servidor; a tabela de personagens do mestre (até 200) filtra e pagina no cliente pela função pura de `data-table.js`. A busca geral tem teto técnico de 500 acertos por fonte e no total (`truncated` avisa para refinar), consulta só a fonte do tipo filtrado e devolve a última página quando a pedida não existe. Tabelas no cliente filtram ao digitar e redesenham só a área da tabela; as do servidor mantêm o foco no controle usado. NPCs conhecidos aceitam `focus` para abrir na página do NPC vindo da busca.

## Retratos de NPC são categoria isolada do acervo

Imagens enviadas pela ficha do personagem do mestre eram gravadas como mapa “apenas imagem” e apareciam no Atlas do Eternnus, no seletor de cenas e na publicação do atlas. `CampaignMap.Purpose` passa a separar `map` de `portrait` (migração `NpcPortraitAssets`, padrão `map`). A migração reclassifica de forma conservadora: só imagens sem grade ligadas a um NPC ou com o nome gerado pelo envio do NPC, e que não sejam usadas por cena, sessão, atlas ou camada de névoa; nada é apagado. Listas de mapas, `ResolveMapAsync` e o atlas ignoram retratos; o seletor de imagem do NPC lista só retratos (mantendo a imagem atual de outra categoria); o acervo ganha a seção “Retratos de NPC” em tabela. Mapas e retratos têm cotas separadas (50 e 200) e dividem os 250 MB. O “Atlas do Eternnus” passa a mostrar só os cenários oficiais, pois os mapas da campanha já têm o explorador.

Tabelas restantes (mesma decisão de 15 por página com busca e filtros por coluna): capítulos (`q`, `kind`, `published` no servidor; ↑/↓ só sem filtro, pois movem na ordem completa), registro de sessões (filtro `state` do mestre), denúncias da Guilda (`q`, `resolution`, 15 por página; tópicos continuam com 20 por não serem tabela), categorias da Guilda, regras de XP, ranking e versões de ficha-modelo (no cliente, listas curtas, via `mountClientTable`), campanhas do admin (busca também pelo nome do mestre). Fila de suporte, usuários e auditoria do admin já tinham busca e filtros por coluna. Em telas estreitas, as tabelas novas usam `.stack-table` (linhas viram cartões com rótulos).

## ADR-066 — Senha local mais simples: 8 a 128 caracteres e dois tipos (11/11/2026)

A exigência anterior (10 a 128 caracteres com maiúscula, minúscula, número e símbolo) dificultava o cadastro. A senha local passa a aceitar de 8 a 128 caracteres com ao menos dois tipos distintos entre maiúscula, minúscula, número e símbolo. A regra vive em `PasswordPolicy` (pura, testada) e é aplicada pelos endpoints de cadastro/redefinição e por `PasswordPolicyValidator`, registrado no Identity com os requisitos padrão desligados. Hash, tokens e bloqueio por tentativas continuam do Identity. Contas existentes não são afetadas; o login só limita o tamanho máximo. A interface mostra o requisito uma única vez, abaixo do campo de senha.

## ADR-067 — Importar PDF preenchido na ficha padrão do sistema (11/11/2026)

Jogadores que já têm a ficha oficial preenchida em PDF editável podem trazer os valores para a ficha da plataforma, em qualquer sistema que tenha modelo padrão (`IsDefault`, fora de campanha) com PDF de fundo. Modelos privados de campanha e modelos não padrão não oferecem a importação, pois a correspondência depende do mesmo layout da ficha oficial.

O arquivo é lido somente no navegador (`pdf-import.js`, pdf.js com scripts, XFA e eval desligados, até 25 MB e 50 páginas) e nunca é enviado. Os campos AcroForm (texto, lista, caixa e rádio) casam com os campos do modelo pela posição: cada widget vai ao campo da mesma página que cobre ao menos 50% da sua área; widgets sem posição correspondente casam pelo nome normalizado do campo ou do rótulo (`pdf-import-policy.js`, puro e testado). Vários widgets num texto longo são unidos em ordem de leitura. Campos calculados, vazios, desmarcados ou com formato inválido (número fora de faixa, opção inexistente) não são importados e os inválidos são listados. A importação só preenche a tela; gravar continua sendo “Criar personagem”/“Salvar ficha”, com a validação do servidor. Em ficha existente, a substituição pede confirmação. A API passa a expor `template.isDefault` na ficha e no modelo da campanha.

No mesmo trabalho, o “formulário acessível” da ficha passa a mostrar os campos em três colunas (duas até 1.100 px, uma até 760 px); textos longos ocupam a linha inteira.

## ADR-067 — Listas padronizadas: uma barra de busca, “Buscar” sempre, sem “Limpar” (11/11/2026)

Cada lista tinha um arranjo próprio: “Filtrar” dourado em umas, “Buscar” em outras, nenhum botão nas tabelas filtradas no cliente, “Limpar” em quase todas e contagens entre a busca e a tabela. Fica assim:

- `controlsHtml` (`data-table.js`) é a barra única: busca larga, filtros por coluna e o botão secundário “Buscar”, alinhados pela base; no celular, empilhados. Tabelas no cliente continuam reagindo ao digitar; “Buscar” aplica na hora. Personagens do mestre, capítulos, sessões, Páginas, notas, NPCs conhecidos, denúncias da Guilda e a busca geral usam essa barra. Admin, suporte e biblioteca mantêm o layout próprio, com “Buscar” no lugar de “Filtrar”.
- Não existe botão “Limpar”: apagar a busca e voltar os filtros para “Todos” mostra a lista inteira.
- Nada entre a barra e a tabela: contagens saem (o total fica na paginação) e avisos de filtro vão para baixo da tabela.
- O botão de adicionar de cada lista (“+ …”) é sempre dourado (`primary`).
- Páginas e Minhas notas viram tabela (título com coleção/etiquetas e NPC, tipo, quem lê, estado, ações); a lixeira é um filtro “Mostrar”.
- Mapas e cenários não mostra mais a seção “Retratos de NPC”. Retratos continuam isolados dos mapas (ADR anterior) e são escolhidos e trocados pela ficha do personagem; a API `assets/portraits` permanece para o seletor.

## ADR-069 — Indicadores de novidade no menu, nos cartões e nos itens (11/11/2026)

**Contexto:** a pessoa não sabia o que mudou desde a última visita (tópico novo na Guilda, resumo publicado, mesa aberta, conquista liberada, resposta de chamado). O pedido: selo vermelho com a quantidade no menu, no cartão/aba e no próprio item, para guiar a leitura; ao ver a tela e sair dela, o selo some. Em campanhas, só para quem participa.

**Decisão:** dois mecanismos, conforme o conteúdo já tenha data própria e público amplo ou não.
- `Notice` (por leitor) para campanhas: o caso de uso que publica grava o aviso na mesma transação, para o público que pode ler o item (jogadores, mestre, leitores escolhidos de uma página) e nunca para o autor. Itens sem data de publicação (sessões anteriores, capítulos, atlas, integrantes) não precisam de colunas novas. Ver a aba apaga os avisos daquela área até o instante mostrado (`asOf`); despublicar/excluir remove o aviso de todos. O público de uma campanha é pequeno; a cópia por leitor é barata e mantém a leitura de contadores simples.
- `ReadMark` (por instante) para Guilda (por tópico e geral), conquistas, chamados (por chamado e fila do Admin) e denúncias: o conteúdo já tem data e o público é a plataforma inteira, então copiar por leitor não escalaria. Novidade = conteúdo de outra pessoa mais novo que a marca, numa janela de 60 dias. A própria mensagem na Guilda avança a marca do tópico.
- GETs nunca escrevem; "visto" é `POST /api/notices/seen` com CSRF. A migração `Notices` cria as tabelas e uma marca de base para as contas existentes (sem enxurrada de itens antigos); contas novas usam a data de criação.
- Cliente: `notices.js` consulta os contadores a cada navegação e a cada 60 s com a aba visível; o destino aberto preserva o próprio selo até a próxima navegação, e os itens destacados continuam marcados enquanto a pessoa estiver na tela. Abrir um tópico/chamado marca só ele; abrir uma aba da campanha marca as áreas dela; o Início marca mesas abertas e partidas marcadas; Conquistas e a moderação marcam ao abrir.

**Alternativas descartadas:** caixa de notificações com cópia por usuário também para a Guilda (crescimento com o número de contas a cada mensagem); colunas `PublishedAt` em cada entidade de campanha (várias migrações e regras de visibilidade repetidas na leitura); estado só no navegador (some ao trocar de aparelho e não respeita quem pode ler).

**Consequências e limites:** contadores limitados a 99+ e listas a 100 chaves. Página compartilhada reacende o aviso a cada gravação; resumo, sessão anterior, capítulo e NPC avisam só na primeira publicação. Integrante removido deixa de ver os avisos da campanha (a leitura filtra por participação). Sem push nem e-mail; atualização por consulta a cada 60 s. Cache v48 com `notices.js` na lista pública.

## ADR-068 — Três salões novos e ocultação na primeira denúncia da Guilda (11/11/2026)

**Contexto:** a Guilda tinha seis salões e nenhum lugar para sugestões de melhoria da plataforma. Denúncias só entravam na fila: o conteúdo denunciado continuava visível até alguém da equipe agir. O pedido: mais três salões, sendo um para melhorias, e que uma única denúncia já esconda o tópico e o envie à moderação, em todos os salões.

**Decisão:**
- Salões semeados (abertos a partir do nível 1): Forja de Ideias (sugestões de melhorias e novos recursos), Galeria do Artífice (mapas, retratos, tokens e artes) e Portal do Aprendiz (dúvidas de iniciantes, que não podem abrir tópicos em "Regras e sistemas"). A migração `GuildModerationHold` insere com `ON CONFLICT DO NOTHING`, preservando bancos onde a administração já criou um salão com o mesmo identificador; ordens e textos dos salões existentes não são alterados.
- `HeldAt` em `GuildPosts` e `GuildTopics`. A primeira denúncia oculta a mensagem; se ela for a abertura, oculta também o tópico inteiro. Denunciar uma resposta oculta só a resposta: uma denúncia numa resposta não pode derrubar a conversa toda.
- Oculto para todos, exceto equipe e autor. O autor lê o próprio texto com aviso, mas não edita nem responde até a decisão (a moderação julga o texto denunciado). Tópico oculto sai de listas, recentes, contagens dos salões e indicador de novidades; a leitura responde 404 a quem não é equipe nem autor.
- A ocultação termina quando não resta denúncia aberta da mensagem: arquivar devolve a mensagem (e o tópico) ao público; remover deixa "removida pela moderação" e o tópico volta às listas. Para tirar o tópico inteiro, a equipe usa "Remover tópico".
- Contra abuso: mensagens de Admin/Embaixador entram na fila sem serem ocultadas (avisos oficiais não somem por uma denúncia), e mensagem com denúncia arquivada depois da última edição também não volta a ser ocultada por novas denúncias, até o autor editar o texto. O limite "social" já se aplica à rota de denúncia.
- Denúncia e decisão travam tópico e post nessa ordem (a mesma da exclusão pelo autor) e gravam a ocultação na mesma transação da denúncia. Ocultar por denúncia não gera auditoria (é ação de membro); remover e arquivar continuam auditados.

**Alternativas descartadas:** ocultar o tópico inteiro a cada denúncia de qualquer resposta (uma conta derrubaria qualquer conversa); limite de N denúncias (pedido explícito por uma); reutilizar `DeletedAt` para a ocultação (misturaria "removido" com "em análise" e a restauração da moderação).

**Consequências e limites:** uma conta mal-intencionada ainda pode ocultar temporariamente mensagens de membros até a equipe arquivar; a fila de denúncias e a auditoria ficam como ferramentas de resposta. Não há punição automática para denúncias falsas.

## ADR-070 — Dados rápidos, bolhas de vida e armadura, mapa solto na mesa e UVTT (11/11/2026)

**Contexto:** retorno de jogador comparando com Owlbear e Roll20: a mesa parecia pouco intuitiva; faltavam dados à mão, estado dos marcadores no próprio mapa e um jeito direto de trazer mapas (inclusive do Dungeondraft).

**Decisão:**
- **Bandeja de dados** sempre visível no palco (d4 a d20, um clique = 1 dado sem modificador; ⬡ abre o construtor). Usa `POST /rolls` com `spec`; o mestre alterna “mesa”/“só eu” (`table`/`blind`); para jogadores vale a regra da mesa. O resultado aparece em destaque sobre o mapa a partir do evento recebido pela consulta ao vivo: quem não recebe o evento não vê nada. Máximo/mínimo só com um dado sem modificador. A bandeja tem faixa própria (o mapa encolhe e nenhuma casa fica coberta); no celular, duas colunas de alvos de 44 px.
- **Bolhas** sobre o marcador: barra do primeiro recurso da ficha (vida) e escudo com o campo de papel Armadura. Só com dados já enviados: resumo do grupo (fichas legíveis) e, para o mestre, `play.npcs`. Clique na barra abre o ajuste; personagem usa `POST /characters/{id}/resource` (dono ou mestre), NPC usa `POST /npcs/{id}/resource`, que passa a aceitar `field` para NPC com ficha-modelo. Alternância ♥ é só de apresentação. Alternativa por teclado: “♥ … do selecionado” nas ferramentas do mestre e a ficha resumida do jogador.
- **Mapa solto na mesa** (arrastar ou “Enviar mapa ou UVTT”): só o mestre. A imagem vai ao acervo (`POST /assets/maps`) com grade sugerida; WebP e imagens acima dos limites são redesenhadas no navegador. Depois de mostrar na mesa abre o ajuste de grade. Novo `POST /sessions/{id}/map/grid` ajusta a grade **com o mapa na mesa** (antes era preciso tirar o mapa da mesa): sessão → mapa bloqueados, evento privado, névoa recalculada (`TableFog.Fit`), marcadores fora da grade vão à casa livre mais próxima.
- **UVTT** (.dd2vtt/.uvtt/.df2vtt): lido no navegador; imagem e `pixels_per_grid` viram o mapa (a redução mantém o quadrado inteiro em pixels); paredes, portas e luzes viram a preparação do mapa via `PUT /assets/layers`. A camada da mesa é por casas: paredes sobre linhas da grade marcam a casa do lado de fora da sala quando o desenho fecha a sala (empate: direita/baixo); portas viram `d`/`o`; luzes viram focos (raio em casas, até 100). Importação também no acervo (“Importar UVTT”).

**Consequências:** nenhuma tabela nova. A conversão de paredes é aproximada; o mestre confere em “Paredes e portas”. O arquivo UVTT (até 60 MB) é lido no aparelho; só a imagem preparada e as marcas são enviadas. Exportar mapas fica fora desta etapa.

## ADR-071 — Ordem dos salões da Guilda e barra de ações agrupada (11/11/2026)

**Contexto:** a ordem dos salões não seguia a jornada de quem chega (avisos, iniciantes, sugestões, conversa). Modais de leitura com cinco ações quebravam a linha sem critério, deixando um botão isolado à direita, e o texto longo empurrava “Editar” para o fim da rolagem.

**Decisão:**
- Ordem dos salões: Avisos da Guilda, Portal do Aprendiz, Forja de Ideias, Taverna, Procura-se grupo, Mestres e campanhas, Galeria do Artífice, Regras e sistemas, Fichas e biblioteca. A migração `GuildHallOrder` atualiza só a coluna `Order` dos nove salões semeados, por `Id`; salões criados pela administração não mudam. Substitui a nota do ADR-068 de que ordens existentes não seriam alteradas.
- `actionBar(tools, main)` em `js/ui.js`: ferramentas à esquerda, ações principais à direita (perigo antes da primária, primária por último). Sem espaço, cada grupo ocupa sua linha; no celular os botões preenchem a linha com 44 px. Dentro do modal a barra fica fixa no rodapé da rolagem, com filete dourado.
- Aplicada ao modal de leitura de “Mundo e acervo” e ao ajuste de vida da mesa (Dano/Cura × Editar ficha/Conceder turno). Linhas com até três botões continuam em `.form-actions`; ações raras seguem em “Mais opções”.

**Consequências:** nova linha de ações com quatro ou mais botões deve usar `actionBar`. Bancos com ordem personalizada dos salões semeados recebem a nova ordem.

## ADR-072 — Linha do tempo da campanha em Mundo e acervo (11/11/2026)

**Contexto:** o grupo precisava ler a história da campanha em ordem, num só lugar, e o mestre precisava inserir acontecimentos sem montar páginas soltas.

**Decisão:**

- Nova subpágina “Linha do tempo” em Mundo e acervo (`#campaign/{id}/timeline`, módulo `js/campaign-timeline.js` carregado sob demanda). Tabela própria `TimelineEvent`; migração `CampaignTimeline`.
- Pontos criados somente à mão pelo mestre. Nada é derivado de sessões, capítulos, diário ou páginas. Cada ponto tem título, “quando” em texto livre (até 60; sem formato de data, não ordena), descrição curta (até 280, mostrada na linha) e relato completo (até 10.000, entregue só ao abrir o ponto).
- Ordem manual (`Position`), escolhida no editor (“No início” / “Depois de …”) ou por “Inserir depois” no ponto aberto. Início e fim são marcos opcionais, no máximo um de cada (índice único filtrado); sem eles, as pontas da linha ficam abertas (tracejadas).
- Visibilidade segue ADR-061/062: jogador recebe só pontos publicados (“Mostrar ao grupo”); rascunho nunca sai do servidor para ele. A lista não traz o relato longo. Escritas bloqueiam a campanha, conferem `Revision` e renumeram as posições na mesma transação. Publicar gera novidade na área `timeline` (ADR-069).
- Limite de 300 acontecimentos por campanha; a linha é devolvida inteira, sem paginação, porque a serpente precisa da sequência completa.
- Visual: SVG atrás dos pontos desenha a serpente — fileiras alternam de direção e curvas ligam uma fileira à outra; 2 a 5 colunas conforme a largura; abaixo de 640 px vira linha vertical. Pontos são botões de 44 px ou mais. O traço anima uma vez só sem `prefers-reduced-motion`; o redesenho por `ResizeObserver` é descartado ao sair da aba (o roteador da campanha agora chama o descarte devolvido pela aba).

**Consequências:** service worker `v51` com `js/campaign-timeline.js` na lista permitida. A ajuda `campanhas.acervo.linha-do-tempo` explica autoria, ordem manual e publicação. Não há edição colaborativa pelos jogadores nem importação automática.

## ADR-073 — Listas com 20 itens por página e termos da busca destacados (11/11/2026)

**Contexto:** as listas usavam tamanhos diferentes (15 nas tabelas, 20 em campanhas, Guilda e biblioteca, 50 no histórico da sessão), e o resultado de uma busca não mostrava onde o termo aparecia.

**Decisão:**
- Toda lista paginada usa 20 itens por página, no cliente (`TABLE_PAGE_SIZE` em `js/data-table.js`, `support-policy.js`, painel admin) e no servidor: administração (usuários, campanhas, auditoria), histórico de campos da ficha, denúncias da Guilda, NPCs conhecidos, tabela de sessões e capítulos, fichas-modelo, suporte, busca geral da campanha e histórico da sessão (antes 50). A biblioteca continua aceitando `pageSize` menor, mas o teto passa de 50 para 20. Substitui o tamanho de 15 do ADR-067; as demais regras daquele ADR continuam.
- Quando a lista está filtrada por texto, os termos buscados aparecem em `<mark class="search-hit">` (negrito, dourado `--gold`, sem fundo). O destaque ignora caixa e acento, aceita várias palavras e funde trechos sobrepostos.
- Um único auxiliar em `js/data-table.js`: `highlightIn(raiz, busca)` percorre só nós de texto já renderizados e cria a marcação com `createElement`/`textContent`, sem `innerHTML`; `highlightHtml(texto, busca)` escapa o texto antes de marcar. A busca nunca é inserida como HTML nem como expressão regular. Campos, botões de ação, paginação, código e texto só para leitor de tela não recebem destaque; títulos clicáveis (`.text-button`) recebem. `mountClientTable` aplica o destaque sozinho; as listas paginadas no servidor chamam `highlightIn` na área da tabela ou nos títulos quando a busca é só pelo nome (campanhas, biblioteca, músicas, seletor de cenários).
- O cartão “Notas do mestre” do histórico da sessão passa a buscar a última página de notas, para continuar mostrando a nota mais recente com páginas de 20.

**Consequências:** service worker `v52`, sem arquivo novo na lista. Testes de serviço, `data-table.test.mjs` e `tables-portraits.mjs` passam a esperar 20 por página e conferem o destaque. Listas sem campo de busca (fichas-modelo, meus chamados) só mudam o tamanho da página.

## ADR-074 — Mapas com movimentação livre (12/11/2026)

**Contexto:** cenas e mapas só ofereciam "Apenas imagem" (sem marcadores) e "Usar grade" (um marcador por casa, no centro). Mapas desenhados à mão ou cartográficos pedem que personagens e criaturas fiquem em qualquer ponto da imagem.

**Decisão:**
- Terceira opção por mapa enviado: **Movimentação livre** (`CampaignMap.FreeMovement`, exige `HasGrid`). O mapa continua tático (`tileset`) e a grade vira referência: escala, paredes, portas, luz, névoa, exploração e máscara da imagem seguem por casa, sem duplicar o motor de visibilidade.
- Posição fina: `SessionToken`/`SceneToken` ganham `Fx`/`Fy` (milésimos da casa, 0–999; nulo = centro). A casa `(X, Y)` continua sendo a unidade autoritativa para paredes e visão. Contas iguais em `Domain/FinePositions.cs` e `js/free-move-policy.js`. Em mapa com grade, `Fx`/`Fy` são descartados.
- Sem casa exclusiva no modo livre (mesa, preparo da cena, recolocar, desfazer). Na forma tática, o alcance é a distância em linha reta entre os pontos, com o mesmo limite em quadrados da ficha; com movimento por caminho, marcadores não bloqueiam e a casa de destino pode ficar um passo além do raio. Um deslocamento por turno e as recusas que não revelam terreno continuam iguais.
- Mesa: a grade fica oculta por padrão (Mostrar grade continua disponível), o alcance aparece como círculo, o toque escolhe o marcador mais próximo do ponto e o arraste solta no ponto exato. Teclado: setas escolhem uma casa e Enter posiciona no centro dela.
- Tilesets oficiais e mapas sem grade não mudam. Trocar um mapa de livre para grade preserva as posições finas guardadas nas cenas, mas a mesa e o preparo passam a usar o centro da casa e voltam a exigir uma casa por marcador.

**Consequências:** migração `FreeMovementMaps` (colunas anuláveis; bancos antigos preservados; cenas guardam marcadores em JSON). Service worker `v53` com `js/free-move-policy.js`. Ajuda `campanhas.acervo.movimentacao`. Limitação: faixas da imagem menores que uma casa de referência nas bordas ficam fora da área jogável, como no mapa com grade; a simulação "Ver como jogador" do editor usa a casa do marcador.

## ADR-075 — Mesa vazia é pausada automaticamente (12/11/2026)

**Contexto:** uma sessão aberta só terminava quando o mestre a encerrava. Mesas abandonadas apareciam como ONLINE para sempre nas listas e no painel administrativo.

**Decisão:**
- Sessão ativa sem presença de ninguém (`SessionParticipant.LastSeenAt`) por `TableRules.EmptyTableGrace` (3 min) é pausada pelo `EmptyTableWorker` (a cada 30 s), via `SessionService.PauseEmptyAsync`: bloqueio da sessão, reconferência no banco, evento `pause` (`automatic: true`, autor "Mesa" em nome do dono), revisão e sinal após o commit.
- A folga de 3 min cobre o heartbeat espaçado pelo navegador em aba oculta (até 1 por minuto).
- A sessão continua a única ativa da campanha; não há encerramento automático nem retomada automática. O mestre retoma ao voltar.
- Listas (`activeSessionPaused`, `activeSession.paused`) mostram **Pausada**; o painel administrativo conta como online só sessões ativas não pausadas.

**Consequências:** sem migração (usa `PausedAt`). One-shots mantêm o prazo de recuperação e o limite de 72 h. Service worker `v55`. Mensagens de pausa deixam de dizer "pelo mestre", porque a pausa pode ser automática.

## ADR-076 — Toda busca ignora maiúsculas e acentos (12/11/2026)

**Contexto:** parte das buscas no servidor usava `ToLower().Contains` ou `Contains` simples (sensível a acento e, em alguns casos, a maiúsculas); a busca geral da campanha usava ILIKE, que ignora caixa mas não acento. "gargula" não encontrava "Gárgula".

**Decisão:**
- Todas as buscas textuais do servidor passam por `Application/TextSearch.cs`: o termo é dobrado em C# (`TextSearch.Fold`: minúsculas, sem marcas diacríticas) e enviado como parâmetro com curingas escapados; a coluna é dobrada no banco.
- PostgreSQL: `unaccent(coluna) ILIKE unaccent(@padrão)`. A extensão `unaccent` (contrib, confiável desde o PostgreSQL 13) é criada pela migração `SearchUnaccent`.
- SQLite (testes e desenvolvimento local): `eternnus_fold(coluna) LIKE @padrão`, função registrada na conexão com a mesma regra de `Fold`.
- `TextSearch.Excerpt` localiza o trecho sem diferenciar caixa nem acento e devolve o texto original.
- Migradas para o auxiliar: administração (usuários, campanhas, auditoria por nome do autor), lista de campanhas, tópicos da Guilda, biblioteca, catálogo de músicas, diário de resumos, histórico da sessão, suporte e páginas do acervo. O cliente já normalizava (`normalizeText` em `js/data-table.js`, filtro de cenários em `js/scene-policy.js`).

**Consequências:** a migração exige que o usuário de migração possa criar extensões confiáveis no banco (privilégio `CREATE` no banco). As consultas não usam índice na coluna dobrada; as listas continuam paginadas e limitadas. Nenhum contrato HTTP muda além da regra de comparação.

## ADR-077 — Arte procedural dos cenários e tiles (12/11/2026)

**Contexto:** cenários oficiais tinham superfícies uniformes e objetos representados por retângulos e círculos simples, com pouca identidade de jogo.

**Decisão:** usar os recursos nativos do Canvas 2D para materiais texturizados e silhuetas reconhecíveis: copas recortadas, pedra lascada, pilares facetados, altares, mobiliário, ferragens, margens e chamas em curvas. `js/tile-art.js` concentra o desenho estático compartilhado, com variação determinística e menos detalhes em escalas pequenas. Mesas adjacentes se conectam na estalagem; caixotes preservam travessas individuais no cais. Miniaturas usam o mesmo desenho em maior resolução.

**Consequências:** grades, legenda, colisão e autorização do servidor permanecem iguais. O recorte por casa impede que ornamentos invadam casas desconhecidas ou confundam a área ocupada. Luz/água seguem o ciclo existente, com movimento reduzido, pausa em aba oculta e descarte pelo roteador. Sem dependência gráfica, imagens externas, endpoint ou migração. Ajuda existente `mesa.mapa.legenda` explica a distinção entre acabamento e ocupação. Cache público v56 inclui o módulo, sem persistir dados da mesa. O Vale Dourado mantém a arte cartográfica oficial.

## ADR-078 — Vinte cenários e mapas próprios com tiles (12/11/2026)

**Contexto:** ampliar os ambientes oficiais e permitir que o Mestre desenhe mapas reutilizáveis com as peças do jogo, sem depender de uma imagem pronta.

**Decisão:**
- Manter os oito cenários anteriores e adicionar Montanha, Savana, Deserto, Floresta densa, Tumba, Cemitério, Castelo, Caverna, Vulcão, Debaixo d’água, Aldeia e Cidade em `Domain/BattleMaps.cs`: vinte cenários (dezenove táticos e o Vale Dourado cartográfico). Grades oficiais têm seis entradas e áreas caminháveis conectadas, verificadas por teste.
- `Domain/MapTiles.cs` define as 44 peças, agrupamentos e regras de ocupação/visão; `BattleMap.Walkable` conserva a legenda de movimento. `TableFog.Initial` deriva os bloqueios dessa mesma fonte. Água profunda e lava bloqueiam passagem; fundo submerso e algas são transitáveis. Não se implementam dano, natação ou regras de sistema implicitamente.
- Mapas próprios são `CampaignMap` com `TileData` anulável (linhas separadas por LF), migração `TileMapDrafts`. Não existe imagem gerada persistida nem aceitação de HTML/SVG do cliente. Mapas antigos mantêm `TileData = null`. JSON omite `TileData`: envia só `rows`, para que a máscara de névoa não deixe uma cópia integral escondida no payload.
- Editor sob demanda em Mapas e cenários: criar vazio ou copiar um oficial/mapa próprio, escolher peças por grupo, pincel, retângulo, preenchimento ligado, capturar peça, desfazer/refazer (30 etapas), grade, câmera compartilhada, tamanho e escala. De 8 a 64 casas por lado, seis entradas mínimas, cota comum de cinquenta mapas. Rascunho só em memória.
- Escritas usam identidade autenticada, política Verified e antiforgery comum. Bloqueio sessão → campanha serializa salvamento de terreno com abertura/apresentação, preparação de névoa e salvamento/duplicação de cenas. Revisão evita sobrescrita; mapa na mesa responde 409. Mudança de terreno já preparado exige `resetPreparation=true`: remove camadas e posições de cenas, preservando textos e personagens. Cópia preserva o original.

**Consequências:** mapas próprios aparecem no acervo, no seletor de cenários e na mesa, com névoa calculada no servidor. São mapas táticos: não são retratos nem imagens para o Atlas compartilhado. Metadados sem alteração de terreno preservam a preparação. O editor usa o mesmo Canvas dos mapas oficiais e não muda cenas ao salvar. PWA v57 inclui apenas os módulos públicos; APIs, grades de campanha e rascunhos continuam fora do cache.

## ADR-079 — Forma e tamanho dos marcadores e liberação do movimento (12/11/2026)

**Contexto:** o mestre quer posicionar jogadores, personagens do mestre, criaturas e inimigos como marcador redondo ou como imagem livre (PNG recortado, sem moldura), com tamanho ajustável no mapa. O jogador só deve mover o próprio personagem quando o mestre permitir, na vez dele. Arrastar um marcador também o fazia voltar à origem antes de chegar ao destino.

**Decisão:**
- `SessionToken` guarda `Appearance` (`round`/`image`), `Size` (50–800 % da casa) e `ImageUrl` própria (acervo da campanha ou https). Só o mestre altera, por `POST …/tokens/{id}/appearance`, por `appearance`/`size` ao posicionar (`/tokens`, `/npc-tokens`) ou pela alça dourada do marcador selecionado. A imagem própria vale para qualquer marcador, inclusive de jogadores, sem mudar a ficha; sem ela, vale a imagem do personagem do mestre. Cenas guardam e devolvem os três campos (`SceneToken`, JSON); valores inválidos de cenas antigas voltam a redondo/100%.
- Retratos do acervo enviados em PNG com transparência continuam PNG; mapas continuam JPEG. As rotas de imagem respondem com o tipo real. Marcador apenas percebido chega ao jogador como redondo/100%, sem nome nem imagem.
- Nova configuração da mesa `MoveNeedsGrant` (padrão ligado). `GameSession.MoveGrantTurn` guarda o número do turno liberado pelo mestre (`POST …/move-grant`); trocar a vez muda o número e bloqueia de novo, sem escrita extra. No modo Livre, a liberação vale até o mestre bloquear. O servidor confere em `MoveTokenAsync`; o cliente só desabilita o botão e explica o motivo.
- O cliente mantém o marcador solto (e o tamanho escolhido na alça) desenhado no destino até o estado novo chegar; recusa ou falta de confirmação em 5 s devolve com a animação curta. Clique acha marcadores maiores que uma casa; entre sobrepostos vence o menor. Regras puras em `js/token-look.js`.

**Consequências:** mesas existentes passam a exigir a liberação do movimento até o mestre desligar a opção em Configuração da mesa. O editor de cenas preserva forma, tamanho e imagem dos marcadores capturados da mesa, mas ainda não oferece campos para editá-los. Imagem por link https continua sujeita ao site de terceiros. PWA v59 acrescenta `js/token-look.js`; nenhuma imagem ou estado de sessão entra no cache.

## ADR-080 — Editar marcador: nome, lado e ficha (12/11/2026)

**Contexto:** o mestre posicionava uma criatura “Sem ficha” e depois não tinha como renomeá-la, trocar o lado nem vincular uma ficha; ao selecionar, nada indicava por que “Ficha do elemento” não aparecia. A única saída era remover e criar de novo, perdendo posição e ajustes de névoa.

**Decisão:**
- `POST …/tokens/{id}/settings` ganha `label`, `side` e `templateId` opcionais; ausentes mantêm o valor atual, então clientes anteriores seguem válidos. Valem só para criaturas: personagem de jogador continua com nome e lado da ficha (409 se o pedido tentar mudar).
- `templateId` cria o personagem do mestre (tipo criatura) com o nome e o lado atuais, pelo mesmo caminho de `POST …/tokens` (`CreatureAsync`). Marcador já vinculado responde 409: o modelo é trocado em “Ficha do elemento”. Não há desvincular nesta tela.
- Renomear não altera a ficha do personagem do mestre (pode ser o “Original” usado em outras cenas), só o marcador. A ordem de turnos guarda uma cópia do nome e é atualizada na mesma transação (`TurnOrders.Relabel`). Evento só do mestre: “Mestre renomeou X para Y” ou “Mestre vinculou uma ficha a X”.
- Interface: ferramenta “Editar marcador” na Básica sempre que uma criatura está selecionada; o modal traz Identificação (nome, lado, vincular ficha) e, recolhidos, luz, visão e ocultação. “Luz, visão e ocultação” (Completa) abre o mesmo modal com o grupo aberto. A dica de seleção avisa quando a criatura não tem ficha.

**Consequências:** escrita segue o fluxo comum (bloqueio da sessão, evento, revisão, sinal). Vincular conta no limite de personagens do mestre da campanha. PWA v60 atualiza `table.js`, `sessions.css` e o catálogo de ajuda da mesa, sem arquivo novo.

## ADR-081 — Preparação unificada e editores visuais sobre um núcleo gráfico (15/11/2026)

**Contexto:** a preparação estava dividida entre a aba Preparação (cenas e personagens) e Mundo e acervo › Mapas e cenários (mapas, pastas e o Atlas do Eternnus). O editor de tiles era um formulário em modal e o editor de cenas tinha outra organização de ferramentas; nenhum dos dois oferecia camadas, manipulação direta, menus de contexto ou navegação de editor gráfico. Mapas de tiles aceitavam um único tile por casa.

**Decisão:**
- **Gerenciador único.** A aba Preparação vira um gerenciador de arquivos com três pastas-raiz fixas (Cenas, Mapas, Personagens). `CampaignMapFolder.Category` separa as pastas por categoria (as existentes viram `maps`); cenas e personagens ganham `FolderId`. Operações de pasta, mover, copiar e renomear passam por `/prep/*` (mestre, `Verified`, antiforgery, bloqueio comum da campanha, tudo ou nada). Mover/renomear preservam IDs e chaves (`asset:{id}`), então cenas, sessões e camadas de névoa continuam ligadas. A subpágina "Mapas e cenários" deixa de existir; o endereço antigo abre a Preparação.
- **Modelos oficiais fora do explorador.** `BattleMaps` continua sendo o catálogo único; os modelos aparecem só nos fluxos de criação. Criar a partir de modelo gera um mapa próprio (`SourceKey` registra a origem); tiles continuam tiles.
- **Núcleo gráfico compartilhado** (`js/editor-core.js` + `js/editor-policy.js` puro): janela em tela cheia, menus, ferramentas por ícone, painéis (camadas, estrutura, propriedades, histórico), barra de estado, menu de contexto, janela de propriedades, histórico por instantâneos e atalhos. Superfícies: `createBoard` (tiles e cenas, opção `editor`) e `js/composition-canvas.js` (mapas de imagem). Sem dependências externas.
- **Camadas obrigatórias Base e Elementos** em todo documento. Em tiles, as camadas são grades com `_` para vazio e `TileData` passa a ser a fusão efetiva (mesmo alfabeto, mesmas regras de passagem/visão/entradas); a Base vai à mesa como `terrain`, mascarada para jogadores como `rows`. Em cenas, as camadas organizam marcadores e valem só no editor. Camadas técnicas (paredes, luz, névoa, marcas) continuam sendo `CampaignMapLayer`.
- **Área visível × área externa** em mapas de imagem: `CampaignMap.Composition` guarda o documento; salvar achata no navegador as camadas visíveis recortadas ao artboard e envia PNG + documento numa escrita (`PUT …/composition`), normalizada pelo pipeline existente. A mesa recebe só `Content`. Imagens-fonte (`Purpose = layer`, `OwnerMapId`) pertencem ao mapa, nunca são listadas e só o mestre as lê.

**Alternativas rejeitadas:** rasterizar no servidor (mais um decodificador de imagens e mais memória por requisição); enviar elementos soltos à mesa (exigiria máscara de névoa por elemento e exporia a área externa); manter dois editores independentes (duplicação de câmera, histórico e atalhos).

**Consequências:** migração `PrepWorkspace` só acrescenta colunas e preenche datas; pastas antigas viram Mapas. Cada salvamento de mapa de imagem regrava `Content` a partir das fontes (sem recompressão acumulada). Visibilidade/opacidade das camadas de cena não mudam o que jogadores veem. Limites: 100 pastas por categoria, 8 camadas, 200 elementos e 40 imagens-fonte por mapa. Testes E2E com PostgreSQL e navegador não foram executados neste ambiente (ver TESTES.md).

## ADR-082 — Tabuleiro desenha só a área visível e reaproveita a camada estática (16/11/2026)

**Contexto:** com zoom, o canvas do tabuleiro cobria o mapa ampliado inteiro (até 4096 px por lado) e era redesenhado a 20 quadros/s; cada passo de zoom e cada pintura refaziam em vetor todas as casas do tileset (0,6–1,3 s num mapa 40 × 30), travando o editor de tiles e o de cenas. Além disso, ao criar um mapa pelo gerenciador, o editor era aberto dentro da espera do formulário e ficava inerte até ser fechado.

**Decisão:**
- O canvas tem o tamanho da área visível (`position: sticky` na superfície rolável); a superfície ampliada só dá a extensão da rolagem e a origem (`ox`/`oy`) desconta a rolagem. As contas de coordenada continuam as mesmas.
- A camada estática (tiles + vinheta) é desenhada fora da tela com casas em pixels inteiros. O zoom reaproveita a camada escalada e refaz a resolução nova em fatias de ~10 ms depois que o zoom para. Uma grade alterada repinta só as casas afetadas (`affectedCells` em `tile-art.js`: vizinhança de 2 casas e entradas à direita na linha); mudanças globais (chão dominante, piso externo/madeira) ou acima de ⅓ das casas refazem tudo, também em fatias.
- Máscaras de névoa ficam em cache por objeto de estado (antes eram recriadas a cada quadro).
- Fluxos de criação nunca aguardam o editor dentro de uma espera em primeiro plano: o gerenciador abre o editor depois que o envio termina.

**Consequências:** zoom de 1–7 ms por passo e pintura sem tarefas longas na medição local (Chrome headless, renderização por software). Acima de ~100 px por casa a camada é ampliada (limite de 4096 px). A mesa ao vivo usa o mesmo tabuleiro e recebe o ganho; o E2E `tests/table-viewport.mjs` (PostgreSQL + Playwright) não foi executado neste ambiente.

## ADR-083 — Rascunho local, conflitos e versões persistentes dos documentos de preparação (16/11/2026)

**Contexto:** horas de preparação podiam se perder com uma aba fechada, falha do navegador ou sessão expirada: o editor só guardava o documento em memória. O conflito de revisão (409) já era recusado pelo servidor, mas "Recarregar a versão salva" descartava o rascunho. Não havia histórico além do desfazer da sessão de edição.

**Decisão:**

- **Rascunho local no IndexedDB** (`js/editor-drafts.js` + regras puras em `js/draft-policy.js`), por usuário + campanha + tipo (`tilemap`, `imagemap`, `scene`, `maplayer`) + documento (`new` antes do primeiro salvamento). Guarda o mesmo instantâneo do histórico de desfazer, a revisão de origem e datas — nunca credenciais, e-mails ou bytes de imagem (mapas de imagem referenciam imagens-fonte `asset:{id}` já enviadas). Grava ~2 s depois da última mudança e ao esconder/fechar a página; limites de 30 rascunhos por usuário, 8 MiB cada e 30 dias. Falha de armazenamento nunca interrompe o editor. O rascunho some ao salvar (documento limpo), ao "Fechar sem salvar" confirmado e ao sair da conta; qualquer outro fechamento o guarda.
- **Recuperação explícita:** ao abrir um documento com rascunho diferente do salvo, aviso não modal com Restaurar / Descartar / Decidir depois (Arquivo › Rascunho local… reabre). Restaurar mantém a **revisão de origem** do rascunho: se o documento mudou depois, salvar cai no 409 existente em vez de sobrescrever.
- **Conflito:** "Recarregar a versão salva" passa a guardar o rascunho antes (continua recuperável); a cena ganha "Salvar como nova cena" (o mapa de tiles já tinha "Salvar como cópia"). Aviso entre abas por `BroadcastChannel` (documento aberto ou salvo em outra aba).
- **Versões persistentes no servidor** (`DocumentVersion`, migração aditiva `DocumentVersions`): cada salvamento de mapa de tiles, mapa de imagem e cena registra, na mesma transação, uma versão automática deduplicada por SHA-256; o mestre nomeia versões (até 20 por documento) e as automáticas ficam nas 20 mais recentes. Restaurar acontece **no editor**: a versão volta como alteração desfazível e só é gravada pelo caminho normal de salvar (mesmas validações, revisão, mapa na mesa e preparação). Imagens-fonte referenciadas por versões retidas não são apagadas ao salvar; saem quando nenhuma versão retida nem o documento as usa. Excluir mapa/cena exclui as versões.

**Alternativas rejeitadas:** `localStorage` (limite de ~5 MB e síncrono); restaurar versão no servidor (duplicaria validações de cada tipo e contornaria as proteções de mapa na mesa); versionar a preparação do mapa (paredes/luz/névoa) agora — ela tem estado ao vivo, exploração e preparação pendente (ADR-048), e o fluxo seguro de aplicação já existe.

**Consequências:** a remoção de imagens-fonte sem uso ao salvar (ADR-081) passa a respeitar versões retidas (mais armazenamento usado, ainda contado no limite de 250 MB). Versões de cena guardam a preparação da cena, não a do mapa nem posições "Retomar". Rascunhos são do navegador: não seguem a conta para outro dispositivo. Não validado em navegador real neste ambiente; PostgreSQL real não executado (testes em SQLite).

## ADR-084 — Gerenciador da Preparação com favoritos, recentes, coleções inteligentes e filtros (16/11/2026)

**Contexto:** o gerenciador da ADR-081 já tinha busca, ordenação, grade/lista, seleção múltipla, operações em lote, arrastar e breadcrumbs, mas campanhas grandes exigiam navegar pasta a pasta para achar o que faltava preparar: não havia favoritos, recentes, filtros por tipo/origem/data/uso, abrangência por subpastas nem indicação de cenas incompletas, personagens sem ficha ou mapas sem uso.

**Decisão:**
- **Coleções são vistas virtuais** calculadas no cliente sobre a lista já projetada de `GET /prep/explorer`: Favoritos, Recentes, Cenas prontas para apresentar, Cenas incompletas, Personagens sem ficha completa, Mapas não usados e coleções salvas (busca + filtros, campanha toda). Nunca movem, copiam nem renomeiam; colar e soltar ficam indisponíveis nelas.
- **Critérios de preparo explícitos e puros** (`prep-explorer-policy.js`, testados): cena incompleta = sem cenário (ou cenário inexistente) em cena com mapa/imagem, sem marcador em cena com mapa, ou sem texto compartilhável; personagem incompleto = sem ficha-modelo ou sem resumo; mapa não usado = nenhuma cena e fora da mesa. Exibidos em texto, nunca corrigidos automaticamente.
- **Filtros + abrangência** (nesta pasta, com subpastas, campanha toda); com filtro ativo só itens aparecem. Filtros que não se aplicam a um tipo o excluem (origem → mapas; uso → mapas e cenas; preparo → cenas e personagens).
- **Preferências por usuário e campanha no navegador** (`localStorage`, chave `eternnus.prep.user.{usuário}.{campanha}`): só chaves `tipo:id`, datas e critérios; podadas quando o item some. Leitura/escrita indisponível não quebra o gerenciador.
- **Servidor**: só um campo projetado novo, `hasText` (booleano) por cena, sem migração; texto compartilhável e notas privadas continuam fora da lista.
- Listas desenham 240 itens por vez ("Mostrar mais"; o teclado amplia).

**Alternativas rejeitadas:** guardar favoritos/coleções no servidor (exigiria migração e endpoints novos nesta rodada; fica como evolução se o uso entre aparelhos for pedido); coleções como pastas reais ou atalhos persistidos (duplicariam a estrutura e confundiriam mover/excluir); devolver o texto das cenas na lista para calcular o critério (exporia conteúdo além do necessário).

**Consequências:** favoritos, recentes e coleções salvas não acompanham o mestre entre navegadores. "Uso" de personagens não existe (a lista não diz em que cenas um personagem está). O E2E do gerenciador em navegador não foi executado neste ambiente (sem Playwright/PostgreSQL locais).

## ADR-085 — Ferramentas de pintura do editor de tiles e assistente de alinhamento da grade (16/11/2026)

**Contexto:** o editor de tiles pintava uma casa por vez (pincel) e preenchia áreas sem mostrar quantas casas mudariam; não havia como trocar um terreno por outro nem variar o desenho sem pintar casa por casa. O ajuste de grade de imagens exigia tentativa e erro com os controles de tamanho e alinhamento.

**Decisão:**
- **Pincel 1/2/3/5, quadrado ou redondo**, para pincel e borracha; **preenchimento contíguo limitado à seleção** quando o clique cai nela; **Substituir tile** na camada ativa ou na seleção; **mistura** de tiles da mesma camada automática com sorteio determinístico por casa e semente. Regras puras em `tile-map-policy.js`; cada operação é uma entrada do histórico.
- **Prévia fantasma + confirmação com contagem** para preenchimentos a partir de 250 casas e para toda substituição (janela com as casas destacadas no mapa). O retângulo não pede confirmação porque a prévia do arraste já mostra a área.
- Nenhuma mudança no formato: camadas, `_`, fusão, entradas e validação do servidor continuam iguais; a repintura parcial da ADR-082 é usada sem alteração (o tabuleiro compara as grades).
- **Assistente de alinhamento dentro de `grid-adjust.js`**, o ajuste compartilhado: todos os fluxos que ajustam grade ganham o assistente sem editar os chamadores. Três modos — marcar uma casa, marcar N casas entre cruzamentos, detectar automaticamente (autocorrelação dos perfis de borda em faixas da imagem em resolução real) — com o resultado aplicado à prévia antes de confirmar e Cancelar voltando aos valores anteriores. Grava pelos campos existentes; validação final continua em `gridFor`/`CampaignMapView.Grid`.
- **Só grade quadrada.** Hexagonal e isométrica não são oferecidas nem como desenho: exigiriam tipo de grade versionado, coordenadas próprias e novas regras de distância, vizinhança, caminho, luz, visão e máscara no servidor (migração descrita em PREPARACAO_EDITOR.md §7.3).

**Alternativas rejeitadas:** variantes de tile no catálogo (mudaria o alfabeto validado por `MapTiles` e os tilesets oficiais); detecção de grade no servidor (mais um decodificador e CPU por requisição, sem ganho de segurança — o resultado é só uma sugestão validada como qualquer ajuste manual); detecção sobre a imagem reduzida (perde até 1/escala px por casa, acumulando desvio).

**Consequências:** sem migração nem contrato HTTP novo. A mistura não é salva no documento (é ferramenta, não dado). A detecção automática pode falhar em mapas sem linhas de grade desenhadas ou com texturas muito regulares; o mestre vê a certeza e confere na prévia. Validação em navegador (pintura com pincel grande, substituição com prévia, assistente nos três fluxos) não foi executada neste ambiente.

## ADR-086 — Contextos de trabalho, barra de propriedades, layout flexível e grupos no editor de imagem (16/11/2026)

**Contexto:** os editores mostravam todas as ferramentas de uma vez (a cena chega a 24 botões na Completa), propriedades simples exigiam abrir janela ou painel lateral, o layout só guardava largura e painéis recolhidos (sem ordem, sem maximizar, sem restaurar) e a preferência era compartilhada entre contas do mesmo navegador. No editor de imagem faltavam transformar um conjunto pelas alças, grupos e guias magnéticas em outros elementos.

**Decisão:**
- **Contextos no núcleo** (`createEditorShell`: `kind`, `contexts`, `commonTools`, `defaultContext`, `onContext`; regras puras em `editor-policy.js`). Catálogo fixo de seis contextos; cada editor declara os seus por grupos/listas de ferramentas e painéis. É só apresentação: seleção, câmera, histórico, rascunhos e alterações ficam intactos. Ferramenta sem contexto aparece sempre; atalho de letra leva ao contexto da ferramenta; Alt+1…Alt+6 trocam; contextos sem ferramenta visível na interface atual somem. Tiles: Terreno/Elementos trocam a camada ativa (Base/Elementos). Cena: mapeada pelos grupos de `TOOL_INVENTORY`, então ferramentas novas de paredes/luz entram sozinhas.
- **Barra contextual de propriedades** como componente do núcleo (`shell.contextBar.show/update/hide`), numa faixa de altura fixa acima ou abaixo da área de edição — não sobre o canvas (não cobre o mapa) e sem mudar o tamanho do palco a cada seleção (sem redesenho do canvas, preservando a ADR-082). Editor de imagem ligado; demais editores podem adotar pela mesma API.
- **Layout flexível** em preferência visual normalizada (`normalizeLayoutPref`) por usuário (`eternnus.editor.layout.{id}`, lendo a chave antiga): largura, painéis recolhidos e ordem por tipo de editor, réguas, posição da barra e último contexto; maximizar (Ctrl+\\) temporário; Restaurar layout padrão. Itens de layout entram automaticamente no menu Exibir de todo editor.
- **Editor de imagem:** alças no retângulo de limites de um conjunto (redimensionar com proporção; girar em torno do centro), grupos com o campo opcional `group` (validado em `composition-policy.js` e `MapComposition`; ausente nas composições antigas e omitido quando vazio), cópias com grupo novo, e guias magnéticas em bordas/centros dos outros elementos calculadas uma vez por arraste.

**Alternativas rejeitadas:** contextos como documentos ou abas separadas (duplicaria estado e histórico); barra flutuante sobre o canvas (cobre o mapa e exige reposicionamento a cada movimento); barra que aparece só com seleção (redimensiona o canvas a cada clique); preferência no servidor (exigiria migração e contrato para algo puramente visual); índice espacial para hit-testing (com no máximo 200 elementos a busca linear mediu 0,03 ms por consulta); grupos aninhados ou com transformação própria (mudaria o formato e o achatamento).

**Consequências:** sem migração. O contrato `PUT …/composition` aceita `group` opcional nos elementos (compatível: ausente = sem grupo). A preferência de layout continua só neste navegador. Grupos podem atravessar camadas se um membro for movido depois; agrupar exige mesma camada. A barra contextual na cena (marcadores, paredes, luzes) fica para a integração das ferramentas vetoriais. Validação: unitários `tests/editor-contexts.test.mjs`, .NET `MapCompositionGroupTests` e roteiro em Chrome headless sobre o editor de imagem real com API simulada (ver TESTES.md); E2E com PostgreSQL não executado.

## ADR-087 — Paredes e portas vetoriais somadas ao bloqueio por casas (16/11/2026)

**Contexto:** paredes, portas e bloqueios eram só casas da grade (`MapFogState.Cells`). Paredes diagonais, salas irregulares, portas no meio de uma casa e a importação UVTT viravam casas inteiras (paredes "grossas") e a geometria original se perdia.

**Decisão:**
- `MapFogState.Walls`: segmentos `{ id, x1, y1, x2, y2, kind, open, hidden }` em **centésimos de casa** (`TableFog.WallUnit = 100`; a casa (x, y) ocupa [100x, 100x+100], centro em 100x+50). Coordenadas do documento, nunca da tela; inteiros dão o mesmo resultado no servidor (`FogGrid`) e no cliente (`fog-policy.js`), conferido por um fixture compartilhado (`tests/fixtures/vector-walls.json`).
- Tipos (`FogWallKinds`): `wall` (movimento + visão), `door` (fechada = parede; aberta = livre), `window` (só movimento), `sight` (só visão/luz) e `move` (só movimento). `hidden` = não aparece para jogadores (porta secreta, barreira invisível), mas vale nas regras.
- Regra de cruzamento (luz, visão e passo de movimento entre centros de casas): cruzamento próprio bloqueia; reta que passa exatamente por uma ponta de parede bloqueia só se houver parede dos dois lados ali (junção de parede contínua ou canto fechado); tangenciar ponta solta, correr ao longo da parede ou terminar sobre ela não bloqueia (a face fica visível). `FogGrid.LineClear` = regra antiga das casas **e** paredes vetoriais; `PathLength` recusa passos que cruzam parede de movimento. `Reach` filtra as paredes perto do alcance.
- Compatibilidade: as casas continuam valendo junto (nada é convertido sozinho). Camadas antigas sem `walls` leem lista vazia. "Converter casas em paredes" no editor cria o contorno sem apagar as casas. A conversão nunca é destrutiva.
- Preparação × mesa (ADR-048): `PrepOf`, `ApplyStructure` (porta que continua porta, pelo id, mantém aberta/fechada da partida), `Restart` e `SameStructure` (ignora `open`) incluem as paredes. Ajustar a grade de um mapa enviado (`RegridWallsAsync`) converte as paredes de todas as camadas do mapa para continuarem sobre o mesmo ponto da imagem; grade menor prende pontas à borda (`FitWalls`).
- Contratos: `PUT …/assets/layers` aceita `walls` (ausente = mantém as atuais, para editores antigos); mesa: `POST …/fog/walls` (lista inteira) e `POST …/fog/wall-door {id}`. Limite de 2.000 segmentos por mapa.
- Jogadores recebem em `fog.walls` só segmentos que bloqueiam movimento agora e tocam casas conhecidas, sem id, tipo nem `hidden` (para o destaque de alcance seguir as mesmas regras do servidor); porta não secreta vem com `door: "open"|"closed"` para desenhar o símbolo. Janelas e paredes só de visão não são enviadas.
- UVTT: linhas de visão e portais viram segmentos exatos (`uvttWalls`); as casas do mapa não são tocadas.

**Alternativas rejeitadas:** rasterizar paredes em casas finas (perde diagonais e continua dependente da resolução); ponto flutuante (diferenças entre C# e JS na borda); substituir o modelo por casas de vez (quebraria mapas, sessões e testes existentes); enviar todas as paredes aos jogadores (revelaria portas secretas e a planta de áreas não exploradas).

**Consequências:** sem migração (o JSON da camada ganha um campo). Movimento sem névoa ou sem "caminho livre" continua não verificando o trajeto, como antes com as casas. Grades hexagonais/isométricas continuam fora (ADR-085). Testes: `tests/wall-policy.test.mjs`, `tests/vtt-import-policy.test.mjs`, `VectorWallTests` (.NET); E2E com navegador e PostgreSQL não executados.

## ADR-088 — Prévia real do jogador, diagnóstico de visão, luzes com penumbra e revisão antes de aplicar (16/11/2026)

**Contexto:** o "Ver como jogador" do editor era uma simulação no cliente sem sentidos, percepção nem explorações; não havia como conferir bloqueios e áreas escuras antes de apresentar; luzes tinham só raio; "Aplicar à cena atual" não mostrava o que mudaria.

**Decisão:**
- `POST /api/campaigns/{id}/prep/preview-view` (mestre, `Verified`, antiforgery comum): recebe a preparação **não salva** do editor (mesmas validações de salvar), o arranjo e quem vê (personagem, jogador ou grupo) e roda `FogRules` (luz, visão da ficha, sentidos, detecção automática em memória, revelações e explorações gravadas na camada). Somente leitura: não grava camada, sessão, evento nem exploração; a resposta tem o formato do jogador (casas desconhecidas como `?`, paredes reduzidas). É POST porque leva o rascunho, não por mudar estado. O editor usa essa resposta; a simulação local fica só como reserva rotulada se o servidor falhar.
- Diagnóstico de visão (só no editor do mestre, nada vai ao jogador): hachura nas casas que bloqueiam movimento, azul nas casas sem luz comum, paredes por traço (contínuo/tracejado/pontilhado, não só cor) e lista de problemas (`wall-policy.diagnose`: paredes sobrepostas, frestas entre pontas, porta solta, luz dentro ou sobre parede, marcador em casa bloqueada).
- `FogLight` ganha `dim` (penumbra até N casas, ≥ raio; conta como alcance nas regras), `color` (#rrggbb), `intensity` (10–100) e `animation` (`flicker`/`pulse`). Cor, intensidade e animação são só apresentação; animação respeita `prefers-reduced-motion` e pausa com a aba oculta. A mesa preserva esses campos ao ajustar o raio.
- Revisão de diferenças: `GET …/assets/layers` passa a trazer `live` (estrutura ao vivo sem explorações) para o mestre; o painel "Aplicar à cena atual" lista paredes, luzes, marcas e casas que mudam (`layerDiff`, portas abertas/fechadas não contam) e o que é preservado. A aplicação continua explícita e seletiva (ADR-048).

**Alternativas rejeitadas:** manter a simulação do cliente como principal (resultado diferente da mesa); criar sessão temporária para a prévia (escrita, bloqueios e sinal sem necessidade); enviar o diagnóstico ao cliente do jogador.

**Consequências:** a prévia custa uma chamada por alteração (com espera de 250 ms e descarte de respostas antigas); o custo sob carga não foi medido. Testes: `PrepPreviewTests` (.NET, SQLite), `wall-policy.test.mjs`; navegador real não executado.

## ADR-089 — Topo do editor sem cortes, zoom real em imagens, escala da régua e personagens pelo menu (16/11/2026)

**Contexto:** em larguras intermediárias o topo dos editores transbordava: título e menus encolhiam até sumir (vão vazio à esquerda) e botões da direita saíam da tela. O diálogo usava `100vw` e a página por trás continuava rolável, então a barra de rolagem da página cobria a do painel. Em "Imagem sem grade" o rótulo de zoom ficava sempre em 100% e não era possível afastar além de "ajustar à tela". A régua não dizia a unidade nem como mudar a escala. Colocar personagens dependia de um submenu que nascia desabilitado ("Carregando…") e, sem mapa tático, o botão direito abria o menu do navegador.

**Decisão:**
- `editor-core.js` mede o transbordo do topo (ResizeObserver + MutationObserver) e compacta em etapas (`data-compact`): 1 contextos só com ícone; 2 sem subtítulo/legenda e ações com ícone só com ícone; 3 ações em segunda linha à direita. Substitui o corte fixo em 1500 px. Nenhum bloco encolhe até sumir.
- Diálogo do editor: `width: 100%`, `overflow: clip`, e `html` sem rolagem enquanto ele está aberto.
- Tabuleiro (`createBoard` com `editor`): zoom mínimo de 0,1 × "ajustar à tela" (só no editor; a mesa continua em 1); imagem sem grade tem tamanho e posição explícitos, rótulo e "100%" medidos em pixels da imagem e roda do mouse ativa.
- Régua: o zero mostra a unidade ("0 m"), o canto vira botão e a barra de estado mostra "Régua em metros · 1 casa = N m". `ruler()` pode trazer `onScale()` (abre o ajuste: grade da cena, propriedades do mapa de tiles, grade do mapa de imagem) e `scaleReason` quando a escala é fixa (cenários prontos).
- Entrada do grupo (`S`, `tile-art.js`): os cantos dourados translúcidos sumiam em terrenos claros (neve). Passa a ser um anel dourado com contorno escuro e bandeira vermelha, com contraste por forma e por claro/escuro em qualquer terreno; o terreno segue visível dentro do anel. Vale para miniatura, editor e mesa.
- Botão direito em mapa tático: "Colocar personagem de jogador aqui" e "Colocar personagem do mestre aqui" em submenus separados, com a lista carregada antes de abrir. Fora de mapa tático, o menu do editor explica o motivo e leva a "Usar mapa tático nesta cena…". Imagens sem grade continuam sem marcadores (regra de cena inalterada).

**Consequências:** apresentação apenas; nenhuma regra, contrato de API ou dado muda. Verificado em Chrome headless com páginas isoladas (shell e tabuleiro reais, sem backend) e testes `*.test.mjs` do frontend; o fluxo completo com PostgreSQL não foi executado (Docker indisponível).

## ADR-090 — Composição visual direta da cena, imagens soltas/coladas, pontos de entrada e posições iniciais (16/11/2026)

**Contexto:** uma cena nova abria com "Escolha um cenário" e obrigava a sair do editor, criar um mapa na Preparação e voltar. Não havia como arrastar ou colar imagens no palco, enviar várias de uma vez, compor imagens só numa cena sem alterar o mapa compartilhado, definir pontos de entrada reutilizáveis num mapa nem uma área de entrada por cena. Arrastar de novo um personagem já posicionado era recusado ("já está na cena").

**Decisão:**
- **Composição da cena separada do mapa.** `Scene.Composition` (mesmo documento `CompositionDocument` dos mapas de imagem, validado por `MapComposition.Validate`) guarda imagens só desta cena por cima do mapa. O mapa continua sendo um recurso compartilhado (`MapKey`) e não muda; outras cenas com o mesmo mapa não recebem os elementos. A edição usa a mesma superfície gráfica (`composition-canvas.js`) e as mesmas regras (`composition-policy.js`) do editor de mapas de imagem, num contexto novo **Composição** do editor de cenas (`scene-composition.js`): o mapa aparece como fundo travado (`scene-map`, nunca salvo), sem segundo sistema de desenho.
- **Imagens sem duplicar arquivos.** Envios da cena viram imagens-fonte da própria cena (`CampaignMap.OwnerSceneId`, propósito `layer`, só o mestre lê); imagens do acervo (mapas de imagem e retratos da campanha) são referenciadas por `asset:{guid}` sem cópia. Excluir a cena remove as imagens dela; duplicar a cena duplica só as imagens dela (independência). Excluir um mapa usado como elemento de alguma composição é recusado (409).
- **Entrega segura à mesa.** Ao salvar, o navegador achata só o que os jogadores podem ver (camadas/elementos sem "Só o mestre vê"; o olho do editor não conta) num PNG transparente do tamanho do mapa (`Scene.OverlayId`). A mesa recebe o mapa já mesclado com essa sobreposição pelo servidor (`…/image?overlay=`), e a máscara de névoa é aplicada depois da mescla: nada fora do explorado nem fora da área visível chega ao jogador. Imagens-fonte e a sobreposição nunca são legíveis pelo jogador por id (404). A sobreposição é um instantâneo da sessão (`GameSession.OverlayId`): salvar não muda a mesa; apresentar, reiniciar ou "Aplicar à cena atual › Imagens da composição" muda. As fontes originais nunca são recomprimidas; a sobreposição é regenerada a cada salvamento a partir delas.
- **Começar visualmente.** Cena sem fundo mostra "Como deseja começar?" (enviar imagem, escolher mapa, modelo, área em branco) e o palco inteiro aceita arquivos soltos e Ctrl+V. A primeira imagem pergunta "Usar como fundo da cena" (padrão) ou "Adicionar como elemento independente" (fundo liso do mesmo tamanho) e o uso: **Movimentação livre** (padrão; grade técnica oculta, `FreeMovement`), **Movimentação tática** (grade visível) ou **Somente apresentação** (sem personagens). O fundo é criado pelo upload de mapas existente e associado à cena sem sair do editor; ele fica em Preparação › Mapas e é reutilizável. Cena de imagem pode ser tornada jogável por escolha explícita ("Tornar a imagem jogável…"), que acrescenta a grade técnica ao mapa sem mudar outras cenas que o usam como imagem.
- **Entrada de imagens comum (`image-drop.js`).** Soltar (com indicação no ponto do cursor), colar (o núcleo deixa de bloquear a colagem nativa em Ctrl+V; colar texto em campos continua normal), vários arquivos (até 12 por vez, PNG/JPEG até 10 MB) e arrastar do painel **Acervo**, nos editores de cena e de mapa de imagem.
- **Pontos de entrada do mapa** (`CampaignMap.Entries`, até 12, tipos Entrada do grupo/inimigos/reforços/outro, retângulos de até 20 × 20 casas), desenhados com a ferramenta "Área de entrada" na preparação do mapa. **Área de entrada da cena** (`Scene.Entry`: ponto do mapa escolhido ou área própria). Regra única de posicionamento (`ScenePlacement`, servidor) ao apresentar, aplicar, recolocar e quando alguém entra na mesa: posição preparada na cena › área de entrada da cena › primeira Entrada do grupo do mapa › regra antiga (pontos `S` e casa livre mais próxima).
- **Posições iniciais.** Painel "Personagens e posições iniciais": todos os personagens dos jogadores com o estado (posicionado/sem posição), "Mostrar", "Remover posição"; arrastar um personagem já posicionado move o mesmo marcador. "Distribuir grupo na área inicial" coloca quem ainda não tem posição sem sobreposição em mapas táticos, pula casas bloqueadas, preserva as posições manuais e avisa quando falta espaço. "Recolocar personagens nas posições preparadas…" mostra a prévia calculada pelo servidor (`GET …/scene/reposition`, só leitura) antes de confirmar; retomar continua preservando as posições da sessão.

**Alternativas rejeitadas:** mesclar a composição no próprio mapa (alteraria todas as cenas); criar um mapa derivado por cena (perderia paredes, luzes e pontos de entrada do mapa e as mudanças futuras do original); desenhar as transformações no servidor (segundo sistema de renderização); entregar as imagens soltas ao jogador (vazaria áreas não exploradas e imagens só do mestre).

**Consequências:** migração aditiva `SceneComposition` (colunas anuláveis em `Scenes`, `CampaignMap`, `Sessions` e um índice); cenas, mapas e sessões antigos não mudam. Mapas de tiles e cenários prontos não recebem composição (o editor explica e oferece usar uma imagem própria como fundo). O mestre na mesa vê a mesma sobreposição dos jogadores (elementos "Só o mestre vê" ficam visíveis só no editor). Mesclas ficam em cache por mapa, revisão e sobreposição; o custo sob carga não foi medido. A composição ainda não entra nas versões persistentes da cena (ADR-083).

## ADR-091 — Forma do marcador escolhida na preparação da cena (16/11/2026)

**Contexto:** a mesa já permitia marcador redondo ou imagem livre (ADR-079), e a preparação da cena já guardava `appearance`/`size` em cada marcador preparado, mas o editor não oferecia a escolha nem desenhava a imagem do personagem do mestre.

**Decisão:** o editor de cenas desenha cada personagem do mestre com a imagem da ficha (prévia `imagePreview` da lista de NPCs) e permite escolher a forma: ao colocar ("Colocar personagens do mestre como", nos painéis Personagens e Adicionar) e a qualquer momento pelo painel do marcador, por Propriedades (forma e tamanho) ou pelo menu do botão direito ("Forma no mapa"). Sem imagem, o marcador fica redondo e o editor explica onde escolher uma. A simulação do jogador mantém a regra da mesa: marcador apenas percebido não revela imagem, forma nem porte.

**Alternativas rejeitadas:** novo endpoint para a forma na preparação (o contrato de salvar a cena já aceita os campos, validados por `TokenLooks`); forma fixa por personagem na ficha (impediria variar por cena).

**Consequências:** sem migração nem mudança de contrato. A escolha "ao colocar" vale só enquanto o editor está aberto. O servidor continua validando `appearance` e `size`; ao apresentar a cena, a forma preparada passa ao marcador da sessão.

## ADR-092 — Imagem livre com largura e altura próprias e criaturas que ocupam várias casas (16/11/2026)

**Contexto:** a imagem livre (ADR-079) tinha um só tamanho, quadrado, com a imagem encaixada mantendo a proporção. O mestre precisa redimensionar criaturas em qualquer direção (por exemplo 3 × 1 casas) na preparação da cena e na mesa.

**Decisão:** marcadores ganham `Width`/`Height` (% da casa, 50–800, juntos ou nenhum). Com os dois e a forma imagem, a imagem estica para preencher a área. No mapa tático a área ocupa round(largura/100) × round(altura/100) casas a partir de (X, Y), canto superior esquerdo (`TokenSpan`): colocar, mover, desfazer, recolocar a cena, entrada de personagens e redimensionar exigem a área inteira dentro do mapa, sem casa que bloqueia movimento e sem outro marcador; o caminho com névoa confere a área em cada passo. No mapa de movimentação livre o tamanho é livre e a área fica centrada no ponto, sem ocupação (casas compartilhadas). Oito alças (cantos e lados) no editor de cenas e na mesa do mestre mudam a área; puxar a esquerda ou o topo move o canto (`POST …/appearance` com `x`/`y`). Com névoa, a criatura aparece quando qualquer casa da área está à vista.

**Alternativas rejeitadas:** manter a proporção da imagem (a área escolhida não corresponderia ao desenho); só visual, sem ocupar casas (o mestre pediu que a criatura grande conte para as regras); área centrada na casa no tático (não alinharia a criaturas de 2 casas).

**Consequências:** migração aditiva `TokenImageSpan` (duas colunas anuláveis em `SessionTokens`); cenas guardam os campos no JSON do arranjo e marcadores antigos não mudam. Luz, visão e percepção da criatura continuam a partir da casa do canto, e as paredes entre casas da área não são conferidas no caminho; o destaque de alcance do jogador usa a área dos outros marcadores, mas o servidor decide. Marcador apenas percebido não revela a área.
