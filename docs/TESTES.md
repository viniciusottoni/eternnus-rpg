# Validação

Esta página define como validar a entrega e manter o comportamento nas próximas alterações. Resultados de execução devem ser registrados pelo trabalho que executou os comandos; a presença de um teste no repositório não significa que ele passou no ambiente de produção.

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
node --test tests/frontend.test.mjs tests/loading.test.mjs tests/pwa.test.mjs tests/service-worker.test.mjs tests/session-policy.test.mjs
node tests/smoke.mjs
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
