# Eternnus RPG

Plataforma web monólito em ASP.NET Core 10 e PostgreSQL. A base reutilizável cobre abertura, acesso/cadastro, início com validação da conta e gerenciamento de campanhas; inclui sessões/mesa ao vivo e as Ondas A/B: painel administrativo, sistemas de RPG, suporte, biblioteca, editor de fichas-modelo, fórmulas, Guilda, progressão e fichas de jogador com PDF preenchido. A identidade visual usa os mockups oficiais e o cenário de castelo em `assets`, combinados com a organização de painel lateral.

## Executar localmente

Requer .NET SDK 10, PostgreSQL 17 e Node.js 22+ para os testes de frontend/integração. A integração também usa Python 3 para ler mensagens MIME. Node.js e Python não são necessários na hospedagem. Em uma instalação nova, com Docker Desktop em execução:

```powershell
docker compose up -d
dotnet tool restore
dotnet restore Eternnus.sln
dotnet run --project apps/Eternnus.Web --launch-profile http --urls http://localhost:5180
```

Se o contêiner `eternnus-postgres-dev` já foi criado manualmente, use `docker start eternnus-postgres-dev` em vez de tentar criá-lo novamente pelo Compose. Não apague o contêiner/volume para resolver um conflito de nome. O banco de desenvolvimento usa porta loopback 54329, banco/usuário `eternnus` e senha `local-development-only`; esses valores são exclusivos do ambiente local. Para outra instalação PostgreSQL, fornecer `ConnectionStrings__Eternnus` com a conexão correspondente.

Acesse [http://localhost:5180](http://localhost:5180). Não há conta ou senha de usuário padrão. Em desenvolvimento, as migrações são aplicadas automaticamente e os e-mails são gravados em `apps/Eternnus.Web/App_Data/mail/*.eml`, fora da pasta pública. Abra a mensagem local para usar seu link. Não publicar essa pasta nem disponibilizar um endpoint de leitura de e-mails.

## Fluxos desta etapa

- Abertura medieval programada para 3.000 ms, independente da conclusão das chamadas de rede, com movimento reduzido quando solicitado pelo sistema.
- Acesso local por e-mail/senha; cadastro com nome, e-mail, senha e confirmação; avatar padrão para contas locais.
- Google e Discord com importação de nome, e-mail e avatar permitido. O acesso imediato exige e-mail verificado pelo provedor. As opções ficam indisponíveis enquanto suas credenciais não estiverem configuradas.
- Confirmação de e-mail e recuperação de senha por links com validade de uma hora, fila persistente e envio SMTP.
- Início disponível para contas locais pendentes; recursos de jogo bloqueados também no servidor até a confirmação.
- Campanhas com busca, ordenação, paginação, criação, edição pelo criador, exclusão somente sem outros jogadores e saída de participantes.
- Página da campanha com visão geral, sessões (mestre), jogadores, recursos e configurações.
- Sessões: o mestre inicia uma sessão escolhendo mapa cartográfico ou tileset tático; a campanha fica **ONLINE** e os jogadores entram direto na mesa (sem ver a lista de sessões). Uma sessão ativa por campanha.
- Mesa ao vivo: aventureiros online à esquerda com avatar, nível e barra de vida; mapa central; chat, rolagens, histórico e notas (mestre) ou sua ficha (jogador); barra de turno. O mestre define de quem é a vez, abre qualquer ficha pelo avatar, ajusta vida, troca o mapa e posiciona criaturas. Na sua vez, o jogador ataca, usa habilidades, magias e itens da ficha, move-se, defende e encerra o turno.
- Rastreio: cada sessão guarda linha do tempo com rolagens, ações, movimentos, mapas e mudanças de ficha com antes/depois; o mestre registra notas privadas ou compartilhadas e consulta sessões anteriores com filtros e busca.
- Fichas com Constituição, Armadura, Movimento e ações criadas pelo jogador, versionadas a cada alteração.
- Navegação inferior fixa no celular, com destinos identificáveis e área segura para dispositivos com gesto de início.
- PWA instalável na tela inicial, sem loja de aplicativos. A instalação exige contexto seguro; a casca visual pode abrir offline, mas login e operações de dados precisam de conexão.

Veja [a plataforma integrada e seus limites](docs/PLATAFORMA.md) e [o registro de conclusão das Ondas A/B](docs/IMPLEMENTACAO_ONDAS.md).

## Documentação normativa

| Documento | Uso |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Regras de trabalho para manter futuras alterações coerentes. |
| [Arquitetura](docs/ARQUITETURA.md) | Responsabilidades, dependências e fluxo de uma funcionalidade. |
| [Guia visual](docs/GUIA_VISUAL.md) | Referências oficiais, componentes, estados, movimento e acessibilidade. |
| [Decisões](docs/DECISOES.md) | Motivos e consequências das escolhas desta etapa. |
| [Contratos da API](docs/API.md) | Autenticação, verificação, campanhas e respostas esperadas. |
| [Segurança e operação](docs/SEGURANCA_OPERACAO.md) | Controles implementados, limites conhecidos e preparação de escala. |
| [Hospedagem](docs/HOSPEDAGEM.md) | PostgreSQL, domínio, SMTP, SSO, migrações e publicação IIS. |
| [Validação](docs/TESTES.md) | Como executar testes e conferir os fluxos, incluindo a mesa ao vivo. |
| [Aplicação instalável](docs/PWA.md) | Instalação Android/iPhone, navegação móvel, cache seguro e atualização. |

## Configuração pública e limites

O endereço de produção é `https://rpg.eternnus.com`, com envio de e-mails por SMTP. Credenciais SMTP, banco e provedores ficam em configuração privada do servidor; não no código, frontend ou chat.

Não existe promessa de invulnerabilidade nem de capacidade ilimitada. Os testes locais não substituem validação do IIS, envio real de e-mail, consentimento OAuth e teste de carga no plano escolhido. A troca de SQLite/SQL Server da versão anterior para PostgreSQL não transfere dados automaticamente: preservar bancos antigos e planejar qualquer importação separadamente.


## Arquivos locais e versionamento

O `.gitignore` exclui compilação/publicação (`bin`, `obj`, `artifacts`), estado privado em `App_Data` (e-mails e chaves), configurações locais/segredos, bancos de teste e backups, relatórios/logs e caches de ferramentas. `Claude outputs` e `continuacao-plataforma` são materiais locais de QA/transferência e também ficam fora do versionamento; seus arquivos continuam preservados no disco.

Código, migrações EF Core, documentação, artes oficiais de `assets`, arquivos públicos de `wwwroot`, fixtures de teste, configurações públicas `appsettings.json`/`appsettings.Development.json`, manifest de ferramentas e eventuais lockfiles permanecem elegíveis para Git. Exemplos `.env.example`, `.env.sample` e `.env.template` devem conter somente valores fictícios.

Configuração privada em JSON deve usar `appsettings.Local.json` ou `appsettings.<Ambiente>.local.json`, ou ficar fora do repositório. O ASP.NET Core não carrega automaticamente arquivos com esses sufixos; usar user-secrets, variáveis de ambiente ou carregamento explícito no servidor. Regras de ignore não removem arquivos já rastreados pelo Git.

## Evolução de campanhas e mesas

Fichas compartilhadas/privadas e auditoria com ator/sessão: [FICHAS_PRIVACIDADE.md](docs/FICHAS_PRIVACIDADE.md). Três bibliotecas, mapas privados com pastas, grade e escala: [CAMPANHA_ACERVOS.md](docs/CAMPANHA_ACERVOS.md). Quotas de conta, mesas livres descartáveis e admin com autenticador: [CONTAS_MESAS_LIVRES.md](docs/CONTAS_MESAS_LIVRES.md). Imagens apresentadas sem upload: [IMAGENS_TEMPORARIAS.md](docs/IMAGENS_TEMPORARIAS.md). Migração aditiva CampaignWorkspace; aplicar sobre o banco existente com backup, sem recriar dados.
