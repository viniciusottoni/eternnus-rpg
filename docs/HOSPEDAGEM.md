# Publicação — rpg.eternnus.com

Destino: aplicação ASP.NET Core 10 no IIS da SmarterASP.NET, com PostgreSQL e SMTP. Confirmar no painel o runtime, acesso ao PostgreSQL, certificado do domínio, permissões de diretório e limites do plano/servidor atribuídos antes de publicar. Este repositório não provisiona a conta de hospedagem.

## 1. Preparar configuração privada

Configurar no painel/ambiente do processo, ou em arquivo apenas no servidor e fora do versionamento:

| Chave de ambiente | Valor esperado |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `PublicUrl` | `https://rpg.eternnus.com` |
| `AllowedHosts` | `rpg.eternnus.com` |
| `ConnectionStrings__Eternnus` | Conexão PostgreSQL do servidor, com credencial privada. |
| `Database__Migrate` | `false`; migração executada de forma controlada antes de subir o código. |
| `Mail__Mode` | `Smtp` |
| `Smtp__Host` | Host SMTP autorizado pelo provedor. |
| `Smtp__Port` | `587` para STARTTLS, ou `465` se o provedor exigir TLS desde a conexão. |
| `Smtp__UseSsl` | `false` para STARTTLS; `true` para TLS direto. Ambos usam conexão protegida. |
| `Smtp__Username` | Usuário SMTP privado, quando exigido. |
| `Smtp__Password` | Senha SMTP privada. |
| `Smtp__From` | Remetente do domínio autorizado a enviar. |
| `DataProtection__Directory` | Caminho persistente e privado para as chaves, preservado nos deploys. |

Usar uma conexão PostgreSQL com validação do certificado conforme o servidor: por exemplo, `Host=SERVIDOR;Port=5432;Database=BANCO;Username=USUARIO;Password=SENHA;SSL Mode=VerifyFull`. Os valores em maiúsculas são placeholders. Resolver problemas de certificado com o provedor; não desabilitar sua validação como solução permanente.

Produção falha na inicialização se a conexão do banco estiver ausente, se `PublicUrl` não for HTTPS ou se SMTP estiver sem host/modo adequado. `PublicUrl` é configuração confiável, não o Host recebido de uma requisição; isso evita construir links de conta com uma origem manipulada.

Para desenvolvimento privado, usar `dotnet user-secrets --project apps/Eternnus.Web` ou variáveis de ambiente. Nunca preencher secrets reais em `appsettings.json`, JS, Docker Compose versionado ou documentação. Nenhuma credencial Google/Discord/SMTP real está incluída.

## 2. Configurar Google e Discord

Cadastrar aplicativos nos portais oficiais e autorizar exatamente os callbacks de produção:

| Provedor | Chaves privadas | Callback |
| --- | --- | --- |
| Google | `Authentication__Google__ClientId`, `Authentication__Google__ClientSecret` | `https://rpg.eternnus.com/signin-google` |
| Discord | `Authentication__Discord__ClientId`, `Authentication__Discord__ClientSecret` | `https://rpg.eternnus.com/signin-discord` |

Google importa perfil/e-mail; Discord solicita `identify` e `email`. O backend exige sinal de e-mail verificado. Autorização é iniciada pelo navegador em `/api/auth/external/google` ou `/api/auth/external/discord`; não enviar o secret ao cliente.

Para Google, criar um cliente OAuth do tipo aplicação web e configurar a tela de consentimento/público; se estiver em teste, autorizar as contas de teste aplicáveis antes de tentar o login. Para Discord, usar a aplicação do Developer Portal e seus redirects OAuth2; não é necessário token de bot. Os callbacks precisam coincidir exatamente com o endereço usado pelo servidor, incluindo protocolo, domínio, porta e caminho. Referências: [Google OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server) e [Discord OAuth2](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx).

Além de `ClientId`, o respectivo `ClientSecret` precisa existir na configuração privada do processo publicado. Após configurar, reiniciar a aplicação e conferir `/api/auth/providers`; `true` indica configuração presente, não um handshake externo validado. Confirmar HTTPS e o endereço público percebido pelo servidor/IIS; `PublicUrl` sozinho não corrige callbacks gerados com protocolo/host incorreto. Testar cancelamento, retorno e novo login com conta de e-mail verificado. SMTP não é requisito do login social com e-mail verificado.

Se testar localmente, cadastrar separadamente os callbacks `http://localhost:5180/signin-google` e `http://localhost:5180/signin-discord` conforme permitido pelo provedor. Credenciais de desenvolvimento devem ser separadas das de produção. As opções sociais ficam desativadas na tela quando o provedor não está configurado.

Uma conta local já existente não será vinculada automaticamente pelo mesmo e-mail. Testar uma conta nova de cada provedor e a rejeição de colisão. Tokens de acesso externos não são persistidos.

## 3. Criar e atualizar o banco

**Operação atual:** este procedimento manual continua útil para recuperação e revisão; o fluxo automatizado de produção está documentado na seção “Publicação automática” ao final. O GitHub Actions deve ter acesso ao banco e o Secret de migração configurado antes do primeiro deploy.

Criar um banco PostgreSQL vazio e credencial com permissões adequadas para a migração inicial. Na raiz:

```powershell
dotnet tool restore
dotnet ef migrations script --idempotent --project apps/Eternnus.Web --output artifacts/postgres-migrations.sql
```

Revisar e aplicar o script pelo mecanismo administrativo seguro da hospedagem, com backup e janela de mudança apropriados. `artifacts/postgres-migrations.sql` é gerado da revisão do código que será publicada. Alternativamente, executar `dotnet ef database update --project apps/Eternnus.Web` em uma estação confiável com a conexão privada configurada para o destino.

A migração `LiveSessions` renomeia `Sessions.StartsAt`/`Notes` para `StartedAt`/`Objective`, converte sessões agendadas antigas em sessões encerradas e numeradas, cria participantes/marcadores, acrescenta campos de evento e de ficha e cria o índice que impede duas sessões ativas na mesma campanha. Fazer backup antes e gerar novamente o script idempotente a partir desta revisão.

Não aplicar migrações de várias instâncias simultaneamente. A credencial runtime pode ter menos permissões depois da atualização. Não usar `EnsureCreated` nem apagar tabelas para contornar incompatibilidades. Dados antigos em SQLite/SQL Server exigem uma migração/importação de dados separada; não são transferidos automaticamente.

## 4. Gerar e enviar publicação

```powershell
dotnet publish apps/Eternnus.Web/Eternnus.Web.csproj -c Release -o artifacts/publish --self-contained false
```

O SDK gera `web.config` para IIS. Publicar o conteúdo de `artifacts/publish` pelo mecanismo disponível na conta. Preservar o diretório de chaves e a configuração privada entre versões; não copiar `App_Data` de desenvolvimento nem `.eml` para o servidor.

Configurar HTTPS válido para o domínio antes de usar contas reais. O processo deve conseguir ler sua configuração e criar/ler as chaves privadas; somente a identidade necessária deve ter acesso. No Windows, a implementação protege as chaves com DPAPI. Para múltiplas máquinas, definir key ring compartilhado e proteção compatível com todas as instâncias antes de escalar.

O worker SMTP está no mesmo processo web. Confirmar as opções de inicialização/idle do pool IIS: uma aplicação suspensa não processa a fila até voltar a executar. Se o plano não permitir processo continuamente ativo, planejar um worker/hospedagem compatível antes de exigir um prazo de entrega contínuo.

### Mesa ao vivo no IIS

A mesa usa requisições `GET` que aguardam até ~25 s. Manter o `requestTimeout` do ASP.NET Core Module acima disso (o padrão de 2 minutos atende) e não habilitar buffering/caching de resposta para `/api`. Cada jogador com a mesa aberta ocupa uma conexão pendente; considerar o limite de conexões do plano.

### Arquivos e atualização da PWA

Publicar junto o manifest, o service worker, os ícones PNG e os módulos da interface. Manter `/service-worker.js` acessível na raiz/escopo previsto, sem resposta de HTML no lugar de JavaScript e com `Cache-Control: no-cache`, como o pipeline atual. Não configurar cache prolongado para seu script ou para o HTML inicial. Incrementar a constante `CACHE` quando qualquer recurso controlado mudar e revisar a lista permitida; nunca adicionar `/api`, callbacks ou URLs com token. A nova versão aguarda a saída das abas antigas antes de assumir o controle, conforme `PWA.md`.

Instalação real no celular deve ocorrer em `https://rpg.eternnus.com` ou homologação HTTPS válida. `http://localhost` é uma exceção local confiável para testes no próprio dispositivo; acessar o IP HTTP de outro computador pelo celular não equivale a localhost e pode impedir a instalação.

## 5. Conferir no ambiente real

1. Abrir `/health` via HTTPS: banco acessível retorna `200 { "status": "ok" }`.
2. Confirmar que a abertura termina no prazo programado, login é legível em celular e foco/teclado funcionam.
3. Cadastrar uma conta local, receber e-mail real e verificar que chamadas de campanha permanecem negadas até confirmar.
4. Confirmar o link, repetir o link e conferir a rejeição de reutilização; testar recuperação e senha nova.
5. Testar login Google/Discord com consentimento real, perfil verificado, avatar e rejeição de colisão de e-mail local.
6. Usar duas contas para criação, edição, entrada, exclusão bloqueada e saída de campanha.
7. Reiniciar o processo e verificar dados, sessão/chaves e processamento da fila pendente.
8. Conferir logs sem segredos, backup/restauração e indicadores de capacidade descritos em `SEGURANCA_OPERACAO.md`.

Builds e testes locais não comprovam entrega SMTP real, configuração de domínio ou funcionamento do OAuth na conta de produção. Registrar esses resultados após a configuração, sem marcar como realizado por antecipação.


## Ativar envio de avatares

Aplicar a migração aditiva `UserAvatars` com o procedimento de backup/migração existente. Não apagar banco ou volumes. Imagens reconstruídas entram no backup PostgreSQL. Não há diretório público de uploads.

Configuração privada necessária (nenhum segredo real acompanha o projeto):

| Chave | Uso |
| --- | --- |
| `Avatar__ClamAv__Host` | Host do clamd acessível somente na rede privada/localhost. |
| `Avatar__ClamAv__Port` | Porta TCP privada; padrão 3310. `StreamMaxLength` deve permitir pelo menos 2 MiB. |
| `Avatar__Moderation__Endpoint` | Origem HTTPS do recurso Azure AI Content Safety, sem path/query. |
| `Avatar__Moderation__Key` | Chave privada do recurso Azure, nunca no frontend/repositório. |

Sem os verificadores configurados, o nome continua editável e o upload permanece desabilitado; chamadas diretas não publicam imagem. Reiniciar após configurar. Validar antivírus com fixture oficial de teste em ambiente isolado (não usar amostras maliciosas reais), falha/timeout, conteúdo recusado e imagem permitida. O scanner precisa de assinaturas atualizadas por freshclam e conectividade privada; análise Azure requer recurso/credencial/região contratados. Estes serviços não foram provisionados por esta alteração e a validação real externa continua pendente.

IIS/proxy: permitir até 2 MiB + 16 KiB no POST `/api/auth/avatar`, preservando o limite comum de 64 KiB fora das rotas de upload; documentos têm a exceção específica descrita abaixo. Confirmar espaço/ACLs do diretório temporário ASP.NET e suporte do host às bibliotecas nativas do Magick.NET 15.1.0. Publicar todas as dependências da saída .NET. O service worker usa o cache v11; lista pública inclui apenas o módulo de perfil, sem imagens pessoais ou API.

## Plataforma, documentos e pacote das Ondas A/B

A migração aditiva `20261107105920_PlatformFoundation` vem depois de LiveSessions. Ela mantém usuários, campanhas, fichas, sessões e seus vínculos; sistemas textuais antigos recebem um sistema correspondente. A inicialização garante o modelo publicado do Sistema livre. Guardar backup do banco e das chaves antes da atualização; testar restauração. A leitura de ficha clássica não grava conversão; a primeira escrita válida fixa sua versão livre.

O primeiro administrador usa `Platform__InitialAdmin__Password` em configuração privada; e-mail padrão `admin@eternnus.com` (substituível por `Platform__InitialAdmin__Email`). Não versionar a senha. O bootstrap não redefine nem promove uma conta preexistente com esse e-mail. O primeiro login exige ativação TOTP por autenticador; códigos de recuperação são mostrados uma única vez. Remover o segredo de bootstrap após provisionar. A lista operacional `Platform__BootstrapAdmins__0` de contas já verificadas permanece compatível e também exige MFA no acesso. Depois, somente admin gerencia papéis no painel. Ver [CONTAS_MESAS_LIVRES.md](CONTAS_MESAS_LIVRES.md).

Documentos da biblioteca e modelos usam `Uploads__ClamAv__Host` e `Uploads__ClamAv__Port` (3310 por padrão), com fallback para Avatar:ClamAv. Exigem clamd privado, engine/assinaturas atualizadas e StreamMaxLength de ao menos 25 MiB. Erro, ausência ou timeout impede publicar. `Uploads__AllowUnscanned` só é reconhecido em Development e apenas para fixtures isolados; não habilita avatar. A moderação Azure continua obrigatória no avatar; não se aplica automaticamente aos documentos publicados pela equipe.

No IIS/proxy, permitir requisições até 26.476.544 bytes somente para as três rotas de documento listadas em API.md; cada arquivo tem teto de 26.214.400 bytes. Avatar mantém 2.113.536 bytes por requisição. O Kestrel seleciona a exceção pelo método e caminho exatos; a validação final continua no endpoint. Reservar memória/temporários e espaço de banco/backup para os arquivos versionados; não copiar App_Data para wwwroot.

Gerar uma publicação nova, sem reutilizar uma pasta com restos de versões anteriores:

```powershell
dotnet publish apps/Eternnus.Web -c Release --self-contained false -o artifacts/ondas-ab-publish
dotnet ef migrations script --idempotent --project apps/Eternnus.Web --output artifacts/postgres-ondas-ab.sql
$env:ETERNNUS_PUBLISH_DIR = 'artifacts/ondas-ab-publish'
node tests/release.mjs
```

O pacote framework-dependent exige runtime/Hosting Bundle ASP.NET Core 10 compatível na máquina Windows/IIS. Node e Python servem apenas a desenvolvimento/verificação. Enviar o conteúdo completo da publicação, inclusive vendors/fontes/worker, usando o procedimento de parada/troca/reinício do host. Preservar configuração privada e os diretórios de chaves/dados fora do pacote. Aplicar o SQL revisado uma vez por janela controlada antes de subir esta versão; a verificação local aplicou-o também duas vezes para conferir idempotência.

Os artefatos finais e resultados locais estão em IMPLEMENTACAO_ONDAS.md. Instalação em IIS real, OAuth/SMTP, scanners externos, aparelho físico e carga permanecem validações do destino.

Mapas da campanha exigem a exceção de upload de 10 MiB + 64 KiB no proxy/IIS e ClamAV disponível. Imagens temporárias usam WebSocket de sinalização e WebRTC; habilitar upgrade WSS no proxy e configurar WebRtc:IceServers para redes que precisem de STUN/TURN. Não há serviço TURN pré-configurado. O relay atual pressupõe um processo; expansão exige estratégia de transporte compartilhado/afinidade documentada. Ver IMAGENS_TEMPORARIAS.md.

## Publicação automática no GitHub Actions — merge de PR na main

Workflow: `.github/workflows/deploy-smarterasp.yml` (criado em `feature/setup`; só começa a funcionar depois de entrar na `main`).

**Gatilho:** evento `pull_request.closed` com `merged == true` e base `main`. Criar, atualizar ou apenas fechar um PR não faz deploy; merge em `feature/setup` também não faz deploy. Publicações diretas sem PR na main não acionam esse workflow.

**Preparação obrigatória em GitHub → Settings → Environments → production** (ou secrets/variables do repositório, respeitando permissões):

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret | `SMARTERASP_FTP_SERVER` | Nome DNS do host FTP SmarterASP.NET, sem `ftp://`, porta ou caminho. |
| Secret | `SMARTERASP_FTP_USERNAME` | Usuário FTP da aplicação Eternnus. |
| Secret | `SMARTERASP_FTP_PASSWORD` | Senha FTP privada. |
| Secret | `ETERNNUS_DB_MIGRATION_CONNECTION` | Connection string **PostgreSQL de produção** para o runner do GitHub. Idealmente um usuário de migração com privilégios de alteração de esquema, distinto do usuário da aplicação. |
| Variable | `SMARTERASP_FTP_SERVER_DIR` | **Diretório remoto correto do IIS do Eternnus**; p.ex. `./` se a conta FTP já abrir na raiz exclusiva do site, ou `./rpg/` se essa for a pasta física mapeada. Confirmar no painel/FTP antes do primeiro deploy. |

Não reutilizar por suposição o caminho remoto de `replaystudio`. Uma pasta incorreta pode substituir arquivos de outro website. O workflow rejeita diretório ausente; ainda cabe ao operador conferir se o caminho corresponde ao aplicativo do domínio `rpg.eternnus.com`. Preferir credencial FTP restrita à própria aplicação.

**Sequência:** checkout da revisão mesclada na main → .NET 10 restore/build/test → testes Node 22 → publish framework-dependent para IIS, removendo nativos de `runtimes/` que não sejam `win`, `win-x64` ou `win-x86` (≈300 MB → ≈82 MB) → validação contra `App_Data` e configurações privadas → teste real `tests/release.mjs` em banco temporário → geração da tela autossuficiente `app_offline.htm` → criação de um EF Core 10 migration bundle → validação de todos os secrets e da pasta FTP → `app_offline.htm` via FTPS → **execução das migrations pendentes do PostgreSQL de produção, com o runner e segredo do GitHub** → somente se a migration passar, upload da nova aplicação por `curl.exe` em lotes com novas tentativas (`.github/scripts/ftps-upload.ps1`; nunca apaga arquivos remotos) → retirada do marcador offline somente após upload comprovadamente concluído → health check HTTPS de `https://rpg.eternnus.com/health`.

O HTML offline é produzido por `.github/scripts/build-app-offline.ps1` a cada publicação. A geração incorpora logos, cenário e estilos em `data:`/CSS inline, pois ANCM/IIS pode servir a mesma resposta offline até para requisições de assets. Uma nova visita vê a abertura medieval atual com texto de atualização e consulta `/health` até poder recarregar. Abas **já abertas** consultam `/health` e exibem o mesmo splash sem navegar nem recarregar, conservando os campos ainda presentes no DOM; após retorno saudável, escondem o overlay e pedem para salvar qualquer edição pendente antes de atualizar. Não confundir isso com salvamento automático nem garantir preservação de requisições em trânsito durante reinício, drafts de componentes descartados ou uploads iniciados.

**Segurança de dados:** o FTP não envia `App_Data`, arquivos `.eml`, senhas, dados do PostgreSQL ou chaves de Data Protection; manter esses recursos persistidos fora da pasta de sincronização e com backup. Agora a atualização de esquema ocorre automaticamente no GitHub Actions, com um **migration bundle** compilado da mesma revisão do aplicativo e executado apenas uma vez pelo job de deploy. O bundle aplica apenas migrações pendentes e guarda o histórico no PostgreSQL. Antes de habilitar esse fluxo, garantir **backup válido e restauração testada** do banco; mudanças destrutivas ou não retrocompatíveis devem ser revisadas e planejadas antes do merge. Configurar `Database__Migrate=false` na SmarterASP.NET, evitando segundo executor de migrations na inicialização. A fábrica `GameDbFactory` cria o DbContext para o EF CLI sem iniciar workers, SMTP ou bootstrap administrativo. O deploy não cria banco PostgreSQL, SSL, domínio, configurações SMTP/OAuth ou Application Pool, e não prova compatibilidade de runtime IIS até a primeira publicação real. Reter capacidade de rollback com artefato de release anterior e backup adequado.

**Rede e segurança da migração:** o runner do GitHub Actions não acessa variáveis do IIS/SmarterASP.NET. `ETERNNUS_DB_MIGRATION_CONNECTION` deve ter o formato `Host=HOST_POSTGRES;Port=5432;Database=BANCO;Username=USUARIO;Password=SENHA;SSL Mode=VerifyFull`, com certificado/hostname válidos. Esse valor é segredo do ambiente `production` do GitHub, **nunca** comitado em arquivos, logs ou argumentos de CLI. O servidor PostgreSQL deve autorizar conexões externas seguras a partir do runner. Caso esteja restrito à rede interna da SmarterASP.NET, o processo falhará e será necessário adaptar o executor (por exemplo, runner privado com acesso ao banco); **FTP não executa migrations no servidor**. Testar conectividade antes do primeiro merge produtivo e não habilitar acesso público irrestrito ao banco. Se a migration ou o upload falhar, o marcador offline é mantido propositalmente para evitar disponibilizar código antigo sobre esquema já alterado; operar recuperação manual/rollback a partir de backup e artefato validado. A execução não realiza backup por si só e não consegue garantir restauração automática. O health check só ocorre após upload e remoção bem-sucedidos do marcador.

**Upload FTPS:** o `SamKirkland/FTP-Deploy-Action` foi substituído porque o canal de dados TLS era encerrado pelo servidor (`ECONNRESET (data socket)`) antes do primeiro arquivo. O `curl.exe`, que já enviava o `app_offline.htm` ao mesmo servidor, envia o pacote em lotes de 40 arquivos reutilizando a conexão; cada lote tem até três tentativas e o passo falha se algum lote não concluir. Como não há sincronização com exclusão, arquivos removidos de uma versão permanecem no servidor até limpeza manual; isso evita apagar `App_Data` ou estado do servidor por engano. A pasta `runtimes/` mantém x64 e x86 porque a arquitetura do Application Pool pode variar; ARM, Linux e macOS nunca são carregados no IIS.

**Modelo de hospedagem:** o pacote usa `hostingModel="OutOfProcess"` (`AspNetCoreHostingModel` no `.csproj`; o workflow rejeita outro valor). No SmarterASP, `rpg.eternnus.com` divide o Application Pool do site `eternnus.com`; um pool aceita um único app InProcess e não mistura modelos, o que causou HTTP 500.34 nos dois endereços. Fora do processo, cada aplicação ASP.NET Core roda em seu próprio `dotnet` atrás do ANCM e os limites do Kestrel (64 KiB e exceções de upload) valem como nos testes. Se outro app do mesmo pool continuar InProcess, o 500.34 persiste: converter esse app para OutOfProcess ou mover o Eternnus para um pool próprio no painel.

**Configuração do painel:** o painel do SmarterASP grava as variáveis de ambiente do app em `<aspNetCore><environmentVariables>` do `web.config` do servidor. Como o pacote leva um `web.config` gerado, antes de colocar o site em manutenção o deploy baixa o `web.config` remoto e copia esse bloco para o novo (`.github/scripts/preserve-remote-env.ps1`; registra só os nomes, nunca os valores). Sem `web.config` remoto, segue sem mesclar; outra falha de download interrompe o deploy antes da parada. Os deploys anteriores a essa etapa sobrescreveram o arquivo: recadastrar as variáveis no painel uma vez.

**Limite do FTPS:** não há publicação atômica nem troca instantânea de versões: conexões WebSocket/WebRTC/long-poll e ações não concluídas são interrompidas na parada do processo. Histórico e progresso já confirmados no PostgreSQL permanecem; alterações que nunca chegaram ao servidor exigem salvar/repetir depois da atualização. Monitorar logs do GitHub Actions, IIS e `/health`.
