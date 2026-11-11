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
