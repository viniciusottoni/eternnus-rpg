# Contratos HTTP — contas, campanhas e sessões

Névoa, iluminação, visão e configuração da mesa: contratos em [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md). `GET …/live` inclui `fog` e filtra `tokens`/`map.rows` por jogador; `POST …/tokens` aceita `hidden` e `light`; erros de movimento com névoa usam mensagem genérica. `me.character` inclui `movementRole` e `reach` (alcance de ataque em metros); sem o papel Deslocamento no modelo, o movimento do jogador não tem limite de distância no servidor.

Os campos JSON usam camelCase. Datas são UTC em ISO 8601. Não enviar identidade, proprietário ou permissões como autoridade do cliente. A base é `/api`; todas as respostas dessa base usam `Cache-Control: no-store`.

## Sessão e escrita

1. Obter `GET /api/auth/csrf`. A resposta fornece `{ "token": "..." }` e o servidor mantém o cookie antiforgery correspondente.
2. Enviar cookies same-origin nas chamadas. Em POST, PUT e DELETE, enviar `X-Eternnus: 1`, `X-CSRF-TOKEN: <token>` e `Content-Type: application/json` (exceto envio de avatar, que usa multipart definido pelo navegador).
3. Renovar o token CSRF depois de cadastro, login e logout, pois o contexto de identidade mudou.

O cookie de sessão é HttpOnly; o cliente não o lê nem o copia para outro armazenamento. `GET /auth/me` é a fonte do perfil atualizado, inclusive da confirmação de e-mail.

No shell móvel, a identificação da conta e “Sair da conta” são apresentados no painel “Mais”. A saída continua usando `POST /auth/logout` com CSRF e renovação do token após encerrar a sessão; não há alteração dos contratos HTTP.

## Contas

| Método e caminho | Entrada | Resultado principal |
| --- | --- | --- |
| `GET /auth/csrf` | — | `200 { token }`. |
| `GET /auth/providers` | — | `200 { google, discord }`; indica disponibilidade configurada, não garante disponibilidade externa. |
| `GET /auth/me` | Sessão | `200 { id, email, name, avatarUrl, verified }`; `401` sem sessão válida. |
| `POST /auth/register` | `{ name, email, password, confirmPassword }` | `200` com perfil e sessão pendente; confirmação enfileirada. |
| `POST /auth/login` | `{ email, password, rememberMe? }` | `200` com cookie ou `{ requiresTwoFactor, setupRequired }`; `rememberMe` booleano, padrão `false`. Conta pode estar pendente. Consultar `/me` após concluir MFA. |
| `POST /auth/logout` | Sessão | `204`; limpa sessão. |
| `POST /auth/logout-all` | Sessão + CSRF | `204`; troca o security stamp e limpa o acesso atual. Outros dispositivos e desafios MFA pendentes são recusados na próxima requisição. Falha de atualização retorna `409` controlado. |
| `POST /auth/resend` | Sessão | `200 { message }`; enfileira se ainda necessário e fora do intervalo de envio. |
| `POST /auth/confirm` | `{ userId, code }` | `200 { message }`; token válido confirma a conta. |
| `POST /auth/forgot-password` | `{ email }` | `200 { message }` genérico, inclusive para e-mail inexistente ou inelegível. |
| `POST /auth/reset-password` | `{ userId, code, password, confirmPassword }` | `200 { message }`; troca senha e invalida sessões anteriores. |
| `GET /auth/external/google` | Query `rememberMe` booleana opcional | Redireciona ao Google configurado. Escolha protegida no state do OAuth. |
| `GET /auth/external/discord` | Query `rememberMe` booleana opcional | Redireciona ao Discord configurado. Escolha protegida no state do OAuth. |

Callbacks `/signin-google`, `/signin-discord` e `/api/auth/external-callback` pertencem ao fluxo do middleware de autenticação. Não são endpoints para receber perfil arbitrário do frontend.

### Duração do login

- Login comum e cadastro: cookie sem persistência explícita no navegador, validade de oito horas renovada por requisições autenticadas, com teto de 24 horas desde a autenticação original. Restauração de sessão pelo navegador pode conservar cookies de sessão; fechar o navegador não substitui Sair.
- `rememberMe=true`: cookie persistente por até 14 dias desde o login, sem estender o prazo ao renovar o principal. Administrador ignora a opção, exige MFA e recebe cookie não persistente com prazo absoluto de oito horas.
- MFA mantém a escolha somente no ticket temporário protegido de cinco minutos. O corpo de `/auth/two-factor/verify` não altera essa escolha. OAuth preserva a escolha no state e no ticket externo; query no callback não a altera.
- O servidor valida prazo e security stamp; heartbeat, consulta ao vivo, confirmação de e-mail e renovação do principal não reiniciam o prazo absoluto. Cookies anteriores a esta política exigem novo login.
- Falhas antiforgery mantêm `400` e passam a incluir `code: "csrf_expired"`. O cliente descarta o CSRF antigo e consulta `/auth/me`: com `401`, encerra os recursos contínuos e pede login. Não repete a escrita original.
- A interface retorna a uma rota interna validada após autenticar. Somente essa rota, sem query ou credenciais, pode passar por `sessionStorage` durante OAuth. Rascunhos não salvos não são persistidos por este fluxo.

### Validação de conta

- Nome: obrigatório, até 80 caracteres. E-mail válido: até 200 caracteres.
- Senha local: entre 10 e 128 caracteres, com requisitos padrão de Identity de maiúscula, minúscula, número e símbolo. A confirmação deve ser idêntica.
- Avatar local inicial: `/assets/avatar.svg`; após upload aprovado, usa a rota autenticada versionada descrita em Edição de perfil e avatar. Avatares externos são limitados a URLs HTTPS dos hosts aceitos; valor inválido usa o avatar padrão.
- O link usa `PublicUrl`, finalidade de confirmação/recuperação, identificador e código Base64URL. A validade é de uma hora. Não registrar nem devolver esses códigos como forma de testar produção.
- Confirmação já utilizada ou inválida recebe `400`. Depois de uma troca de senha, o token de recuperação antigo não deve funcionar novamente.
- Reenvio/recuperação compartilham intervalo de pelo menos um minuto por conta. Uma resposta de sucesso genérica não significa que uma nova mensagem foi necessariamente enviada.
- SSO requer `email_verified=true` após validação do provedor; não cria vínculo automático com conta local existente do mesmo e-mail.

## Campanhas

Todas estas rotas exigem sessão **e** conta verificada. As permissões de proprietário/participante são reaplicadas no servidor em cada operação.

| Método e caminho | Entrada | Resultado principal |
| --- | --- | --- |
| `GET /campaigns` | Query `search`, `sort`, `page`, `oneShot` opcionais | `200 { items, total, page, pageSize }`. Somente campanhas próprias ou com participação. |
| `POST /campaigns` | `{ name, system, description }` | `200 { id }`; o criador é obtido da sessão. Somente campanhas persistentes; `isOneShot=true` → `400`. |
| `POST /one-shots` | `{ name, description, rpgSystemId, system? }` | `200 { campaignId, sessionId }`; cria a one-shot com a sessão única já aberta. Ver [Contas e one-shots](CONTAS_MESAS_LIVRES.md). |
| `PUT /campaigns/{id}` | `{ name, system, description, revision }` | `204`; somente criador, com revisão atual. |
| `DELETE /campaigns/{id}` | — | `204`; somente criador e sem outros jogadores. |
| `POST /campaigns/join` | `{ code }` | `200 { id }`; cria participação se ainda inexistente. |
| `POST /campaigns/{id}/leave` | — | `204`; somente participante, nunca o criador. |
| `GET /campaigns/{id}` | — | Detalhe acessível a criador/participante. |
| `DELETE /campaigns/{id}/members/{member}` | — | `204`; somente criador, remove vínculo do jogador. |

### Lista

`page` começa em 1; o tamanho é fixo em 20. `search` busca pelo nome e tem limite de 100 caracteres. `sort=name` ordena pelo nome; o padrão usa última atualização de gestão. A ordenação usa identificador como desempate para estabilizar páginas.

Cada item contém `id`, `name`, `system`, `description`, `revision`, `lastActivityAt`, `isMaster`, `playerCount` e `canDelete`. `playerCount` conta os outros jogadores vinculados; o criador não é um registro de participante. `canDelete` é uma indicação de interface calculada no momento da consulta, não uma autorização reutilizável.

Nesta etapa, `lastActivityAt` representa atualização de **gestão da campanha**: criação, edição, entrada, saída ou remoção de participante. Mensagens, rolagens, sessões e recursos de jogo não atualizam esse campo. A interface usa “Atualizada”/“Última atualização” para não apresentá-lo como a última ação realizada na mesa. Uma futura alteração dessa semântica exige decisão e teste próprios.

### Escritas e exclusão

- Nome obrigatório até 100 caracteres; sistema obrigatório até 80; descrição até 10.000.
- O criador pode editar mesmo com jogadores vinculados. Uma edição concorrente com revisão antiga recebe `409`.
- Exclusão com jogadores recebe `409`, inclusive se a UI estava desatualizada. A transação bloqueia a campanha junto das operações de entrada/saída.
- Excluir remove sessões, recursos, mensagens e vínculos da campanha. Não remove fichas pessoais.
- Sair ou ser removido encerra acesso e remove vínculos de suas fichas com a campanha, preservando as fichas pessoais.
- Código de convite tem 32 caracteres. O detalhe só devolve `inviteCode` ao criador; participantes recebem `null`.

## Erros e comportamento do cliente

| Status | Significado | Ação do cliente |
| --- | --- | --- |
| `400` | Campos, link ou contexto CSRF inválidos. | Mostrar mensagem; não repetir automaticamente a escrita. |
| `401` | Sessão inexistente/invalidada. | Pedir novo login. |
| `403` | Conta ainda não verificada. | Mostrar início com confirmação pendente. |
| `404` | Recurso/vínculo inexistente ou inacessível ao usuário. | Não inferir a existência de recursos de outra conta. |
| `409` | Revisão desatualizada ou regra de estado impede a operação. | Recarregar estado e explicar o conflito. |
| `429` | Limite de requisições. | Aguardar; evitar loops/retries imediatos. |
| `500` | Falha inesperada. | Mensagem controlada e nova tentativa manual; investigar por logs internos. |

Erros de negócio normalmente fornecem `{ "message": "..." }`. Algumas rejeições de middleware podem não trazer JSON; `js/api.js` fornece uma mensagem local adequada. Não interpretar toda resposta vazia como falha: escritas bem-sucedidas podem retornar `204`.


### Espera no cliente

Os contratos HTTP permanecem iguais. `js/api.js` envolve chamadas em primeiro plano e renovação de CSRF no loading universal de `js/loading.js`; formulários e rotas mantêm a espera durante sequências de operações. Sucesso ou falha libera a espera sem duração mínima adicional. Somente a leitura automática periódica de eventos utiliza a opção interna `background`, sem sobrepor a mesa. Essa opção não muda credenciais, CSRF, autorização ou política de cache.


## Edição de perfil e avatar

- `PUT /api/auth/profile`: sessão autenticada, inclusive pendente; JSON `{ name }`, nome após trim com 1–80 caracteres e sem caracteres de controle. Retorna o perfil atualizado. Não altera e-mail, senha, confirmação ou identidade; campos extras não têm autoridade. Usa CSRF e limite comum de autenticação.
- `GET /api/auth/avatar-policy`: sessão; `{ available, maxBytes }`. `available` indica configuração presente dos dois verificadores, não certifica saúde externa. Conta pendente ainda precisa confirmar o e-mail antes de enviar.
- `POST /api/auth/avatar`: sessão e `Verified`, CSRF comum, `multipart/form-data` com um único arquivo no campo `avatar` e sem outros campos. O cliente deixa o navegador definir o Content-Type/boundary. Até 2 MiB por arquivo e 2 MiB + 16 KiB por requisição; essa margem de avatar aplica-se apenas a esse POST; documentos têm exceções próprias em UploadLimits. Três envios/minuto/usuário e duas verificações simultâneas por processo. Retorna o perfil atualizado somente após aprovação de todas as etapas.
- `GET /api/auth/avatar/{version:guid}`: sessão; somente a imagem atual da própria conta. JPEG com `no-store`/`nosniff`; versão anterior, inexistente ou pertencente a outra conta retorna 404. Não é asset público nem recurso offline.

JPEG/PNG reais, extensão e MIME coerentes; mínimo 64 e máximo 4.096 pixels por lado, até 8 milhões de pixels. SVG, executáveis, GIF/WebP e PNG animado são recusados. O original passa pelo ClamAV; após decodificar com formatos/recursos restritos, a imagem inteira é redimensionada e acomodada em um JPEG de 512 × 512 sem perfis/metadados e analisada pelo Azure AI Content Safety. Apenas severidade 0 em todas as categorias Hate, SelfHarm, Sexual e Violence é aceita. A imagem normalizada é salva no PostgreSQL; o original não é publicado nem preservado como avatar.

Erros: 400 formato/dimensões/conteúdo inválido ou CSRF; 401 sem sessão; 403 e-mail pendente; 413 requisição excessiva; 422 ameaça detectada ou conteúdo recusado; 429 limite de envios/processamento; 503 verificadores ausentes, indisponíveis ou com resposta inválida. Nenhuma falha substitui o avatar anterior. Não repetir automaticamente um upload.

## Sessões e mesa ao vivo

Todas as rotas exigem sessão **e** conta verificada. O servidor identifica o usuário pelo cookie e reaplica, em cada chamada, se ele é o mestre (criador) ou participante da campanha. Recurso de outra campanha responde `404`; participante tentando ação exclusiva do mestre responde `403`.

### Campanha

| Método e caminho | Quem | Entrada | Resultado |
| --- | --- | --- | --- |
| `GET /campaigns/{id}/sessions?page=` | Mestre | — | `200 { campaign, items, total, page, pageSize: 20, lastActivityAt }`. Itens: `id, number, title, objective, startedAt, endedAt, mapKind, mapKey, active, eventCount, noteCount, participantCount, chapterId, chapterTitle` (nulos = sessão avulsa), do mais recente ao mais antigo. Jogador recebe `403`: ele não vê a lista de sessões. |
| `POST /campaigns/{id}/sessions` | Mestre | `{ title, objective, mapKind, mapKey, chapterId? }` (capítulo de outra campanha: `400`) | `200 { id, number }`. Abre a sessão e coloca a campanha online. `409` se já houver sessão em andamento ou se a campanha for one-shot (sessão única aberta na criação). |
| `GET /campaigns/{id}/table` | Mestre/jogador | — | `200 { campaign, isMaster, online, session, joinedCharacterId, characters }`. Ponto de entrada da mesa; `characters` lista as fichas do próprio jogador (vinculadas primeiro). |
| `GET /campaigns/{id}/maps` | Mestre | — | `200 { items }` com mapas oficiais (`valley`, `crypt`, `forest`, `tavern`, `bridge`, `courtyard`, `harbor`, `sanctuary`) e recursos `mapa` da campanha (`resource:{id}`), com `rows` para tilesets. |

`GET /campaigns` passa a incluir `activeSessionId` (ou `null`) em cada item. `GET /campaigns/{id}` substitui a lista antiga de sessões agendadas por `sessionCount` (somente mestre; `null` para jogadores) e `activeSession { id, number, title, startedAt }`, e inclui `revision` e `masterName`. Membros retornam `{ id, name, avatarUrl }`, sem e-mail.

### Sessão

Base: `/sessions/{sessionId}`. Escritas exigem sessão em andamento (`409` após o encerramento), salvo anotações do mestre.

| Método e caminho | Quem | Entrada | Regra |
| --- | --- | --- | --- |
| `GET /live?after={revisão}` | Participante | — | Long-poll somente leitura. Sem `after` (ou `0`) responde imediatamente; com `after`, espera até a revisão superar o valor ou até ~25 s e então responde o estado atual. |
| `POST /join` | Participante | `{ characterId? }` | Jogador entra com ficha própria; uma ficha ainda não vinculada é vinculada à campanha. Sem `characterId`, usa a ficha atual ou a única vinculada; senão `409`. Mestre entra sem ficha. Idempotente. |
| `POST /heartbeat` | Quem entrou | — | Renova a presença. `409` se o usuário saiu ou a sessão terminou. |
| `POST /leave` | Quem entrou | — | Sai da mesa; se era a vez dele, o turno volta ao mestre. |
| `POST /end` | Mestre | — | Encerra a sessão; a campanha fica offline; presença de todos é limpa. |
| `POST /messages` | Quem entrou | `{ content }` | 1 a 2.000 caracteres. |
| `POST /rolls` | Quem entrou | `{ formula, label? }` | Rolagem livre no servidor. `200 { formula, values, modifier, total }`. |
| `POST /notes` | Mestre | `{ content, shared }` | Privada por padrão (`masterOnly`). `shared=true` aparece aos jogadores como narração. Permitida também após o encerramento. |
| `POST /turn` | Mestre | `{ characterId \| null }` | Concede o turno a um personagem presente; `null` retoma a narrativa. |
| `POST /turn/next` | Mestre | — | Próximo personagem presente na ordem de entrada, a partir do turno atual ou do último concedido. |
| `POST /turn/end` | Jogador da vez (ou mestre) | — | Encerra o turno atual. |
| `POST /actions` | Jogador da vez | `{ kind, actionId?, target? }` | `kind`: `ataque`, `habilidade`, `magia`, `item` (ação da própria ficha) ou `defender`. `ataque` sem `actionId` usa o ataque básico `1d20 + modificador de Força`. `200 { message, roll }`. |
| `POST /map` | Mestre | `{ mapKind, mapKey }` | Troca o mapa. Novo tileset remove criaturas e recoloca os aventureiros nos pontos de entrada. |
| `POST /tokens` | Mestre | `{ label, side, x, y }` | Adiciona criatura (`enemy`, `neutral`, `ally`) em casa livre do tileset; até 60 marcadores. |
| `POST /tokens/{tokenId}/move` | Mestre ou jogador da vez | `{ x, y }` | Mestre move qualquer marcador. Jogador move somente o próprio personagem, uma vez por turno, até `floor(movimento/1,5)` quadrados (distância com diagonal 1). Casa bloqueada `400`; ocupada `409`. |
| `DELETE /tokens/{tokenId}` | Mestre | — | Remove criatura; personagens de jogadores não são removidos (`409`). |
| `GET /characters/{characterId}` | Participante autorizado | — | Ficha da sessão compartilhada; privada somente dono/mestre. Não inclui histórico para os demais membros. |
| `POST /characters/{characterId}/hp` | Mestre ou dono | `{ delta, reason? }` | Ajusta a vida entre 0 e o máximo, cria versão com ator/sessão e registra antes/depois privadamente. |
| `GET /history?kind=&search=&page=` | Mestre | — | `200 { session, campaign, counts, participants, events, total, page, pageSize: 50 }`. `kind` aceita um tipo de evento ou `rolls` (rolagens + ações); `search` até 100 caracteres. |

### Estado ao vivo

`GET /live` devolve `{ revision, serverTime, session, campaign, me, participants, map, tokens, events }`:

- `session`: `id, number, title, startedAt, endedAt, turnNumber, activeCharacterId, activeName` e `objective` somente para o mestre.
- `me`: `userId, isMaster, joined, characterId` e `character` para o jogador (status, templateId/templateName e ações combinadas; a ficha com valores completos usa a rota autorizada própria).
- `participants`: `userId, name, avatarUrl, isMaster, characterId, characterName, archetype, level, hp, maxHp, online, isMe`. `online` vale para presença renovada nos últimos 45 s.
- `map`: `kind` (`cartographic`/`tileset`), `key`, `name`, `imageUrl`, `rows`, `width`, `height`. `rows` usa a legenda descrita em `Domain/BattleMaps.cs`.
- `tokens`: `id, characterId, label, side, x, y, lastMovedTurn` (vazio em mapa cartográfico).
- `events`: os 60 mais recentes visíveis ao usuário, em ordem cronológica: `id, kind, author, content, data, createdAt, masterOnly, mine`. Jogadores nunca recebem eventos `masterOnly`. `data` é JSON com detalhes (antes/depois, rolagem, origem/destino).

Tipos de evento: `start`, `end`, `join`, `leave`, `message`, `roll`, `action`, `turn`, `map`, `move`, `token`, `sheet`, `note`.

### Fichas

`POST /characters` e `PUT /characters/{id}` aceitam também `constitution` (0–1.000), `armor` (0–1.000), `movement` em metros (0–300) e `actions` (até 16 itens `{ id?, name, kind, formula, description }`; nome até 60, fórmula de dados válida ou vazia, efeito até 300). Clientes que não enviam `actions` no `PUT` preservam as ações existentes. Quando uma ficha muda durante uma sessão ativa, a mudança é registrada como evento `sheet` na sessão.

### Comportamento esperado do cliente

- Consulta ao vivo, heartbeat e comandos rápidos da mesa usam `api(..., { background: true })`, sem o loading universal (ADR-015); a escrita continua com CSRF e autorização normais.
- Usar uma única consulta ao vivo por aba; enviar `after` com a última revisão recebida; aguardar ao menos 400 ms entre respostas e recuar exponencialmente após falhas. A rota tem limitador próprio (balde de 180/min e no máximo 4 consultas simultâneas por usuário).
- Enviar heartbeat a cada 20 s enquanto a mesa estiver aberta. Sem heartbeat por 45 s, o participante aparece como ausente.
- Tratar `404` na consulta ao vivo como perda de acesso (por exemplo, jogador removido) e `endedAt` preenchido como encerramento.
- As permissões vindas no estado (`isMaster`, turno ativo) orientam a interface; o servidor sempre revalida.


## Plataforma integrada — Ondas A e B

Ver [PLATAFORMA.md](PLATAFORMA.md) para regras de acesso, versão de fichas, operação e limites. Todos os grupos abaixo exigem Verified; Staff significa embaixador/admin e Admin é conferido no banco. Escritas mantêm CSRF, rate limiting e autorização do recurso. Listas devolvem projeções limitadas, com paginação/filtros conforme a resposta; revisão obsoleta recebe 409. Contas comuns não recebem e-mail de outros usuários nem mensagens internas do suporte.

| Grupo | Contratos principais |
| --- | --- |
| `/api/rpg-systems` | GET: sistemas ativos para escolha na campanha. Criação/edição de campanha aceita rpgSystemId; system textual continua por compatibilidade. |
| `/api/admin` | GET overview, users, users/{id}, campaigns, campaigns/{id}, audit, rpg-systems. Admin altera papel via PUT users/{id}/role; suspende/reativa por POST suspend/unsuspend com motivo; gerencia sistemas com POST/PUT/DELETE rpg-systems; exclui campanha pela rota administrativa com motivo. |
| `/api/support` | GET lista própria e /{id}; POST cria; POST /{id}/messages responde; POST close/reopen altera o estado dentro das regras de prazo. |
| `/api/admin/tickets` | Admin: GET fila/detalhe/assignees, POST /{id}/messages (resposta pública ou nota interna), PUT /{id} (status, prioridade, responsável, revisão). |
| `/api/library` | GET lista/detalhe/arquivo; POST /{id}/downloaded registra download. Staff: POST multipart para publicar, PUT metadados ou /{id}/file para substituir, DELETE para retirada. Admin pode restaurar/reverter versões. Formato permitido: PDF, PNG, JPEG, WebP; até 25 MiB; antivírus em melhor esforço (ADR-058). |
| `/api/sheet-templates` | GET lista publicada (systemId opcional), /{id}, /{id}/versions/{versionId}, /pdf autenticado. Staff: GET manage; POST cria modelo/versão; PUT metadados/rascunho; PUT /pdf com arquivo pdf, pages JSON e revision; DELETE rascunho/PDF; POST publish. Admin: POST republish. Erros estruturados de validação: `{ message, errors: [{ field, action, message }] }`. |
| `/api/guild` | GET categorias, tópicos e posts; criação/resposta com POST; edição do próprio post com PUT e revisão; marcação útil e denúncia por POST. Moderação exige Staff; categorias exigem Admin. |
| `/api/progress` | GET jornada, ranking e users/{id} público sem e-mail. Ajustes administrativos usam POST com motivo e auditoria. XP/permissões enviados pelo cliente não são aceitos como autoridade. |

`GET /api/auth/me` acrescenta role, staff, level e xp ao perfil. `POST /api/auth/activity` autenticado retorna 204, com CSRF e atualização atômica limitada a uma vez a cada cinco minutos; GET não grava atividade.

### Escolha de modelo da campanha

`GET /api/campaigns/{id}/sheet-template` exige mestre/participante e retorna `{ campaignId, system, source, template, version }`, com source `campaign`, `default` ou `free`.

`PUT /api/campaigns/{id}/sheet-template` recebe `{ templateId: guid | null, revision }`. Somente proprietário; null restaura a escolha automática. Exige modelo ativo/publicado do sistema. Retorna `{ id, sheetTemplateId, revision }`; 400 para modelo inelegível, 404 sem propriedade/acesso e 409 para revisão antiga. A escolha não muda fichas já criadas.

### Ficha por modelo

| Rota | Contrato |
| --- | --- |
| POST `/api/characters` | Admite `{ campaignId?, templateId?, name?, values?, actions?, private? }`. Modelo/campanha e permissões são validados no servidor. O formato clássico continua aceito. |
| GET `/api/characters/{id}/sheet` | Dono/mestre ou membro com ficha compartilhada: `{ id, revision, legacy, private, canEdit, canChangeVisibility, template, version: { id, number, pages, fields, actions, hasPdf, pdfUrl }, values, computed, actions, newerVersion }`. Ações identificam source template/player e as do modelo usam prefixo `t:`. |
| PUT `/api/characters/{id}/sheet` | Dono/mestre: `{ values, actions?, revision, private? }`; envio parcial, actions nulo preserva ações pessoais e private ausente preserva visibilidade. Somente dono pode mudar private. Calcula no servidor e retorna a ficha atualizada. |
| GET `/api/characters/{id}/field-history?field=&page=` | Dono/mestre: `{ items, total, page, pageSize: 20 }`; itens com field/label, oldValue/newValue, source, sessionId, session, templateVersionId, createdAt, changedById e changedBy (nome). Mestre vê somente sessões que mestra. |
| GET `/api/characters/{id}/migration` | Dono/mestre: prévia com revision, from/to, kept/added/removed/changed, warnings e valores calculados. 409 se já atual. |
| POST `/api/characters/{id}/migration` | Dono/mestre: `{ targetVersionId, revision }`, reaplica a conferência da prévia; retorna `{ migrated, sheet }`. |

Na mesa, GET /sessions/{id}/characters/{characterId} inclui sheet conforme a visibilidade da ficha e o vínculo na sessão. Live inclui canView e retira nível/vida/arquétipo de fichas privadas para os demais jogadores. O estado pessoal inclui ações do modelo e pessoais. POST de ações usa o identificador retornado; as fórmulas são roladas somente no servidor. O PDF preenchido é gerado no cliente a partir da rota privada de PDF e da ficha salva; não há GET mutável para exportação.

Documentos: as únicas exceções de corpo grande são POST `/api/library`, PUT `/api/library/{guid}/file` e PUT `/api/sheet-templates/{guid}/versions/{guid}/pdf`: arquivo até 25 MiB, requisição até 25 MiB + 256 KiB. Tipo/assinatura/tamanho real continuam obrigatórios. O ClamAV é sempre tentado: arquivo detectado retorna 422; scanner ausente ou indisponível não bloqueia o envio (ADR-058). GET de bytes usa private/no-store e sandbox. O limite geral das outras rotas permanece 64 KiB.

Campos da ficha: número aceita vírgula decimal e min/max; papéis numéricos exigem inteiros e os limites da mesa. Texto/textarea têm MaxLength e teto de 2.000/10.000; checkbox aceita true/false; select exige opção conhecida. Nome é obrigatório e tem até 100 caracteres. O conjunto Values é limitado a 100.000 caracteres; computados e nomes desconhecidos são ignorados. Alterações preservam snapshots e histórico por campo com fontes edit, migration ou master. Fichas antigas são convertidas na primeira escrita, sem alterar dados em GET.

## Evolução de campanhas e mesa (contratos atuais)

Os contratos abaixo complementam e substituem as permissões anteriores nas rotas correspondentes:

- [Fichas e auditoria privada](FICHAS_PRIVACIDADE.md): leitura compartilhada configurável, escrita dono/mestre, histórico por campo e snapshots com ator/sessão. As rotas de sheet, field-history, history e migration autorizam dono/mestre vinculado; histórico do mestre restringe-se às sessões que mestra. private só pode ser alterado pelo dono.
- [Contas e one-shots](CONTAS_MESAS_LIVRES.md): sistema explícito válido obrigatório, one-shot criada por POST /one-shots com sessão única aberta, limites de 3 campanhas persistentes e 10 one-shots acumuladas para comuns; limites na conta/lista, bootstrap privado e MFA obrigatório admin.
- [Bibliotecas e mapas](CAMPANHA_ACERVOS.md): acervo textual/publicação da campanha, hierarquia, upload privado de 10 MiB, grade/escala e visibilidade na sessão. Mapas atualmente mostrados devem ser ocultados antes de editar/excluir; conflito retorna 409.
- [Imagens temporárias](IMAGENS_TEMPORARIAS.md): comandos transacionais de apresentação e WebSocket de sinalização; bytes exclusivamente entre navegadores.

POST /api/campaigns/{id}/assets/maps é a nova exceção enumerada em UploadLimits: até 10 MiB de imagem e 64 KiB de margem multipart. Demais limites e proteções mantêm seus contratos.

DELETE /api/campaigns/{id} também retorna409 se há sessão ativa; encerrar a sessão antes da exclusão. A restrição de participantes continua aplicada. Encerrar/sair como mestre de uma one-shot remove seus dados pelo comando transacional da sessão.

## Jornada e atlas — evolução de novembro de 2026

- `GET /api/progress/me`: cada conquista acrescenta `counter`, `threshold` e `current` (limitado ao limiar). `unlocked` considera a conquista persistida ou o histórico suficiente; `unlockedAt` pode ser nulo em um marco histórico ainda não persistido. GET continua somente leitura. O cartão público reconhece os mesmos marcos e mantém somente `key`, `title`, `icon`, sem contadores privados.
- Valores de XP e tetos são retornados em `rules`: sessão jogada 50, mestrada 60 (quatro/dia cada); respostas 4 e marcações úteis 6 (cinco/dia cada). Suporte retorna amount/dailyLimit zero e não gera lançamento. Valores anteriores do histórico não são recalculados com as novas tarifas.
- Recompensa de encerramento exige sessão de pelo menos dez minutos e jogador elegível com ficha e `JoinedAt <= EndedAt - 10 minutos`. Não exige presença online ao encerrar. Mestre recebe apenas com jogador elegível. Encerramento explícito/saída do mestre de one-shot aplica a mesma regra antes da exclusão; coleta automática não concede XP. Sessões curtas continuam podendo ser encerradas normalmente, sem recompensa.
- `GET /api/campaigns/{id}/maps` mantém o formato e passa a incluir `tavern`, `bridge`, `courtyard`, `harbor`, `sanctuary`, além de `valley`, `crypt`, `forest`. Todos os novos mapas são `tileset`. A legenda admite `d` (madeira livre), `:` (areia livre) e `h` (mobiliário bloqueado). Miniaturas e estado live usam as grades oficiais, nunca uma cópia divergente no cliente.
- Novos cenários não exigem nível; acesso de mestre à escolha e política Verified continuam aplicados. As regras completas e limites estão em [PROGRESSAO_CENARIOS.md](PROGRESSAO_CENARIOS.md).


## Condução, preparação e continuidade (ADR-046)

Todas as rotas exigem `Verified`, exceto `/api/invites/pending`, que exige só autenticação. Escritas passam pelo antiforgery comum. Detalhes de regras em [CONDUCAO_MESA.md](CONDUCAO_MESA.md).

### Mesa (`/api/sessions/{id}`)

| Método/caminho | Quem | Entrada → resultado |
| --- | --- | --- |
| POST `/rolls` | Participante | `{formula?, spec?, label?, visibility?, recipients?}`. `spec = {count, sides, modifier, keep?, keepCount, explode, successAt?, percentTarget?, percentRule?}`. Mestre: `visibility: table|blind|group` (`master` equivale a `blind`); `group` exige `recipients` = 1 a 20 `characterId` da sessão (cópia privada para cada jogador; o mestre vê só o original). Jogador: `visibility`/`recipients` são ignorados; vale `TableSettings.playerRollVisibility`. → `{hidden, visibility, roll?, total?}`; resultado às cegas de jogador → `{hidden:true}`. |
| POST `/pause` | Mestre | `{paused}` → 204. |
| PUT `/turn-order` | Mestre | `{entries:[{key:"c:{id}"|"t:{id}"|"g:x", label, initiative, members}], sortByInitiative}` → 204. Lista vazia volta à ordem de entrada. |
| POST `/turn` | Mestre | `{characterId}` ou `{key}` (entrada da ordem) → 204. |
| POST `/roll-requests` | Mestre | `{label, formula?, spec?, visibility: table|master|blind, target?, rule?: gte|lte, characterIds[]}` → `{id}`; `group` → 400. Máximo 5 abertos. |
| POST `/roll-requests/{rid}/respond` | Jogador convidado | → `{hidden, total?, outcome?, roll?}`; segunda resposta 409; cancelado 409. |
| POST `/roll-requests/{rid}/cancel` | Mestre | → 204. |
| POST `/characters/{cid}/resource` | Dono ou mestre | `{field, delta, reason?}` → `{hp, maxHp, resources}`; campo que não é recurso 404. |
| POST `/characters/{cid}/conditions` | Dono ou mestre | `{conditions}` (≤ 300) → 204. |
| POST `/undo` | Mestre ou autor | `{eventId}` → 204; já desfeito/concorrente 409; rolagem 400. |
| POST `/scene` | Mestre | `{sceneId, restart}` → 204. |
| POST `/scene/capture` | Mestre | `{sceneId}` → 204 (posições atuais viram o preparo). |
| POST `/npc-tokens` | Mestre | `{masterCharacterId, x, y, hidden, copy}` → `{id, masterCharacterId}`. |
| POST `/npcs/{npcId}/resource` | Mestre | `{index, delta}` → 204. |
| POST `/tokens` | Mestre | `{label, side, x, y, hidden, light?, templateId?, imageUrl?}` → `{id, masterCharacterId}`. Com `templateId` (modelo permitido à campanha) ou `imageUrl`, cria uma criatura do mestre ligada ao marcador. |
| GET `/tokens/{tid}/portrait` | Mestre; jogador da sessão | Imagem do acervo do NPC (`private, no-store`, `nosniff`). Jogador só recebe se o marcador estiver visível para ele e não apenas percebido; senão 404. |
| POST `/recap` | Mestre | `{text, publish}` → 204 (também após o encerramento). |
| POST `/chapter` | Mestre | `{chapterId}` → 204 (também após o encerramento). `null` deixa a sessão avulsa; capítulo de outra campanha `400`. Bloqueia a sessão, incrementa a revisão e sinaliza; não grava evento. |

`GET /live` acrescenta `play = {mode, modeLabel, paused, playerRollVisibility, turnOrder, activeTurnKey, myTurn, scene, masterAway, recoverUntil, recoveryMinutes, rollRequests, npcs, recap, recapPublished}`. `npcs[]` traz `{tokenId, id, name, kind, image, hasSheet, sheet:{resources, stats}, resources, revision}`. Marcadores trazem `image` (link https ou `/api/sessions/{id}/tokens/{tid}/portrait?v={versão}`, versão derivada da imagem escolhida) só quando visíveis; o cliente desenha a imagem recortada no círculo do marcador (sem imagem ou com falha de carga, as iniciais); o mestre recebe também `masterCharacterId`. `me.character.formulaFields` (jogador) e `me.formulaFields` (mestre: atributos das fichas na mesa) listam `{name, label}` para o autocompletar de fórmulas. `npcs` e `recap` vêm só para o mestre; `scene.description`/`privateNotes` vêm vazios para jogadores. Também acrescenta `me.character.{resources, stats, conditions, shortcuts, classic}` e `participants[].summary` (nulo para ficha privada alheia). `GET /campaigns/{id}/table` acrescenta `incompatible[]`, `template`, `paused` e `campaign.archived`.

### Campanha (`/api/campaigns/{id}`)

| Método/caminho | Quem | Entrada → resultado |
| --- | --- | --- |
| POST `/api/campaigns` | Conta | Novo campo opcional `playMode`. |
| POST `/archive`, `/restore` | Mestre | → 204; arquivar com sessão ativa 409. |
| POST `/convert` | Mestre de one-shot | → `{campaignId, kept, removed}`; sem vaga 409. |
| GET/POST `/scenes`, PUT/DELETE `/scenes/{sid}`, POST `/scenes/{sid}/duplicate` | Mestre | `{name, description, kind: map|image|text, mapKind, mapKey, sharedText, privateNotes, visionMode: all|manual|character|null, order, revision}`. |
| GET/POST `/npcs`, PUT/DELETE `/npcs/{nid}`, POST `/npcs/{nid}/copy` | Mestre | `{name, summary, notes, side, resources:[{label, value, max}], revision, kind?: npc|creature, imageUrl?}`. `imageUrl`: `https://…` (sem credenciais, ≤ 500) ou `asset:{id}` de imagem do acervo desta campanha; vazio remove. A lista devolve também `kind`, `imageUrl`, `templateName`. |
| GET `/npc-templates` | Mestre | Modelos aceitos pela campanha (sistema da campanha, privados dela e o Sistema livre) → `{items:[{id, name, campaign, playerDefault}]}`. |
| GET/PUT `/npcs/{nid}/sheet` | Mestre | PUT `{templateId|null, values?:{campo: texto}, revision}`. Trocar o modelo recomeça os valores; campo inexistente 400; revisão antiga 409. Com sessão ativa, grava evento privado e atualiza a mesa. → `{id, name, kind, revision, imageUrl, imagePreview, template, fields, values, resources, stats}`. `imagePreview` (só mestre): `/api/campaigns/{id}/assets/maps/{mapId}/image` para imagem do acervo ou o próprio link https. |
| PUT `/npcs/{nid}/image` | Mestre | `{imageUrl|null, revision}` → mesma resposta de `/sheet`. `asset:{id}` desta campanha ou `https://…` (≤ 500); nulo remove. Revisão antiga 409; campanha arquivada 409. Com sessão ativa segue o fluxo da mesa (sessão → personagem bloqueados, evento privado, `Revision++`, sinal após o commit): o retrato do marcador muda para todos que o enxergam. |
| GET `/journal` | Membro | `{nextSession, myAttendance, attendance, pending, recaps, entries}` (jogador: só publicados). |
| PUT `/schedule` | Mestre | `{at: ISO com fuso | null, note}` → 204. |
| POST `/attendance` | Jogador | `{status: yes|maybe|no}` → 204; sem data 409. |
| GET/POST `/private-templates`, PUT `/private-templates/{tid}` | Leitura: membros; escrita: mestre | `{name, description, sections:[{title, fields:[{label, type, options, resource, max, maxFrom, summary, min, default}]}], actions:[{name, formula, group, kind}], useForCampaign}` → `{id, versionId, number}`. |
| PUT/POST `/assets/library` | Mestre | Novo campo `kind: text|objective|clue`. |

### Conta

| Método/caminho | Entrada → resultado |
| --- | --- |
| GET `/api/home` | `{active, recent, upcoming, pendingInvite, pendingTests, hasCharacters}`. |
| GET `/api/invites/{code}` | Prévia `{campaignId, name, system, master, isOneShot, archived, expired, member, isMaster, online, playMode, playModeLabel}`. |
| GET/POST/DELETE `/api/invites/pending` | Autenticado (sem Verified): guarda/lê/limpa o código (formato 32 hex). |
| PUT `/api/characters/{id}/shortcuts` | Dono: `{actions:[id], rolls:[{label, spec|formula}]}` (até 8 cada). |

Mudança de contrato: `POST /api/sessions/{id}/leave` do mestre de one-shot **não** apaga mais a mesa (espera recuperável); apagar exige `/end`. `GET /api/rpg-systems` acrescenta `playMode` sugerido.

## Editor de cenas, preparação privada e apresentação (ADR-048)

Todas as rotas exigem `Verified` (preferências: só autenticação) e escritas passam pelo antiforgery comum. Regras em [CENAS_EDITOR.md](CENAS_EDITOR.md).

| Método/caminho | Quem | Entrada → resultado |
| --- | --- | --- |
| GET `/api/campaigns/{id}/scenes` | Mestre | Itens acrescentam `layerMode`; resposta acrescenta `characters:[{id, name}]` (personagens vinculados à campanha). |
| GET `/api/campaigns/{id}/scenes/{sid}` | Mestre | Cena completa: `prepared:[{characterId, masterCharacterId, label, side, x, y, hidden, light}]`, `layerMode`, `revision`, `live:{sessionId, current, textPending, mapPending} \| null`, `characters:[{id, name, lightMeters, visionMeters}]` (luz/visão da ficha, usadas só na simulação do editor). Jogador 403. |
| POST/PUT `/api/campaigns/{id}/scenes[/{sid}]` | Mestre | Novos campos opcionais `prepared` (nulo mantém) e `layerMode: map\|scene` (nulo mantém). Arranjo inválido 400; alcance trocado com a cena em apresentação 409; imagem sem grade como mapa 400. Salvar nunca altera a mesa. |
| DELETE `/api/campaigns/{id}/scenes/{sid}` | Mestre | Cena em apresentação 409; remove também a camada própria dela. |
| GET `/api/campaigns/{id}/assets/layers?key=&scene=` | Mestre | `scene` opcional seleciona a camada própria. Acrescenta `layerKey`, `mode`, `manual`, `prepVersion`, `pending`, `sharedWith:[{id, name}]`, `gridOffsetX/Y`. Os campos de preparação vêm da preparação pendente quando houver. |
| PUT `/api/campaigns/{id}/assets/layers?key=&scene=` | Mestre | Aceita `prepVersion` (preferido à `revision`). Camada fora da mesa: aplica à estrutura. Na mesa: guarda `Prepared` sem mudar o ao vivo. → `{revision, prepVersion, pendingLive, inUse}`. Versão obsoleta 409; `resetExploration` com a camada na mesa 409. |
| POST `/api/campaigns/{id}/assets/maps` (multipart) | Mestre | Campos opcionais `hasGrid` (`false` = apenas imagem), `gridOffsetX`, `gridOffsetY` (0 até lado − 1). Ausentes = grade sem deslocamento. |
| PUT `/api/campaigns/{id}/assets/maps/{mid}` | Mestre | `{…, hasGrid, gridOffsetX, gridOffsetY}`. Tirar a grade com cena tática usando o mapa 409. |
| POST `/api/sessions/{id}/scene` | Mestre | Igual; agora grava `SceneName/SceneText` (o que os jogadores veem) e `LayerKey`. `restart` aplica a preparação do mapa (inclusive a pendente) e zera a exploração. |
| POST `/api/sessions/{id}/scene/apply` | Mestre | `{sceneId, text, vision, layer, tokens?, sceneRevision, prepVersion?}` → `{applied:[…]}`. Nenhuma parte marcada: 400. Cena não apresentada, revisão ou versão obsoletas, cenário trocado, `tokens` numa cena sem grade: 409. `tokens` (opcional, padrão `false`) recoloca os marcadores no arranjo preparado com a mesma regra de “Reiniciar cena” (personagens sem posição entram pelos pontos de entrada; criaturas fora do arranjo saem). Nunca apaga explorações nem cobre áreas reveladas. |
| POST `/api/sessions/{id}/scene/save-as` | Mestre | `{name, sharedText?}` → `{id, revision}`: cenário improvisado vira cena (posições atuais como arranjo). Com cena já apresentada 409. |
| POST `/api/sessions/{id}/map` | Mestre | Agora guarda o estado da cena atual para "Retomar" e deixa a sessão sem cena (improviso). Aceita `mapKind: cartographic` para imagem da campanha. |
| PUT `/api/auth/preferences` | Autenticado | `{interfaceMode: basic\|complete}` → 204; outro valor 400. `GET /api/auth/me` acrescenta `interfaceMode` (nulo = Básica). |

`GET /live` (mestre): `play.scene` acrescenta `layerMode`, `revision`, `prepared:{name, sharedText}` e `pending:{text, vision, layer, map}`. Para jogadores, `play.scene.name/sharedText` são os apresentados (`GameSession.SceneName/SceneText`; sessões anteriores seguem a cena). Mapa da campanha apresentado como imagem chega como `kind: cartographic`, sem linhas.

## Catálogo de músicas e trilha da sessão (ADR-049)

Todas as rotas exigem `Verified`; as de `/api/admin/music` também a política Admin (papel no banco e MFA). Escritas passam pelo antiforgery comum. Não há rotas de música por campanha. Regras em [TRILHA_SONORA.md](TRILHA_SONORA.md).

| Método/caminho | Quem | Entrada → resultado |
| --- | --- | --- |
| GET `/api/music?search=&page=` | Conta verificada (mestre na mesa) | `{items, total, page, pageSize: 20}`; item somente `{id, title, format, durationMs}`, sem bytes nem URL de áudio. `search` até 100 caracteres; `page` limitada a 1–100.000. |
| GET `/api/admin/music?search=&page=` | Admin | `{items, total, page, pageSize, usage:{tracks, bytes}, limits:{maxFileBytes, maxTracks, maxCatalogBytes, formats}}`; item `{id, title, contentType, format, sizeBytes, durationMs, createdAt, revision, inUse, audioUrl}`. |
| POST `/api/admin/music` | Admin | Multipart: um arquivo em `file` e `title` opcional; outro campo `400`. Até 20 MiB (requisição 20 MiB + 64 KiB); limitador `catalog` (30/5 min). Arquivo já existente (mesmo SHA-256), 200 faixas ou 2 GiB `409`. → item. Auditoria `music.upload`. |
| PUT `/api/admin/music/{trackId}` | Admin | `{title, revision}` → item; revisão antiga `409`. Auditoria `music.rename`. |
| DELETE `/api/admin/music/{trackId}` | Admin | `204`; faixa tocando em sessão ativa `409`. Auditoria `music.delete`. |
| GET `/api/admin/music/{trackId}/audio` | Admin | Bytes da prévia (ver abaixo). |
| POST `/api/sessions/{id}/music` | Mestre | `{action: select\|play\|pause\|stop\|seek\|loop, version, trackId?, positionMs?, loop?, autoplay?}` → `{serverTime, revision, music}`. `version` diferente da atual `409`; sem faixa para play/pause/seek `409`; faixa inexistente `404` ("Faixa não encontrada no catálogo"); ação desconhecida ou posição negativa `400`; sessão encerrada `409`. |
| GET `/api/sessions/{id}/music/{trackId}/audio` | Mestre ou participante presente | Somente a faixa selecionada na sessão em andamento; senão `404`. |

Bytes: HTTP Range (`206`/`416`), ETag, tipo validado no envio (`audio/mpeg`, `audio/mp4`, `audio/ogg`), `private, no-store`, `nosniff`, CSP `sandbox` e `Cross-Origin-Resource-Policy: same-origin`.

`GET …/live` acrescenta `music = {trackId, title, durationMs, contentType, playing, positionMs, referenceAt, loop, version, audioUrl}` (sem faixa: `trackId`/`audioUrl` nulos, `playing` falso), igual para mestre e jogadores. `serverTime` passa a ser lido ao fim da montagem da resposta. Novo tipo de evento `music`, sempre `masterOnly`.

Erros: 400 campos/formulário; 403 sem papel Admin; 404 sem vínculo ou faixa indisponível; 409 versão, revisão, quota, duplicidade, faixa em uso ou estado; 413 tamanho; 415 formato; 429 limite. Áudio não passa por antivírus (ADR-051). Upload não é repetido automaticamente.

## Continuidade, mundo e cadernos (ADR-055)

Contrato completo e limites: [CAMPANHAS_CONTINUIDADE.md](CAMPANHAS_CONTINUIDADE.md). Todas as rotas abaixo exigem Verified; escritas usam antiforgery comum.

POST/PUT `/api/campaigns[/{id}]` acrescentam campos opcionais `origin: new|ongoing`, `continuity` (10.000), `currentArc` (120), `firstSessionNumber` (1–1.000.000), `originalStartDate` (yyyy-MM-dd|null). GET da campanha e lista retornam os mesmos campos. Ao enviar origin na edição, data nula limpa a data original. O resumo é compartilhado com o grupo. Alterar o mínimo com sessão ativa retorna 409. Não renumera registros.

Prefixo `/api/campaigns/{campaign}/workspace`:

| Método / caminho | Contrato |
| --- | --- |
| GET `/pages?search=&kind=&page=&trash=&mine=` | Membro: páginas autorizadas, projeção sem conteúdo/segredos, vinte por página. `{items,total,page,pageSize}`. Trash só mostra itens editáveis; mine restringe ao autor atual. |
| GET `/pages/{id}` | Página autorizada, conteúdo, segredos somente para editor, parent/children/related/backlinks filtrados, canEdit, revision e recipients somente para editor. |
| POST `/pages`, PUT `/pages/{id}` | `{title,content,kind,visibility,secrets?,collection?,tags?,status?,parentId?,npcId?,mapId?,order?,revision?,recipients?:userId[],related?:guid[],pinned?}`. Mestre: mundo; qualquer membro: notas próprias. Related até vinte, mesma campanha e acessível. Npc/map devem pertencer à campanha; referências são privadas. PUT exige revisão atual. Retorna registro salvo ao editor. |
| POST `/pages/{id}/trash` | Editor: `{revision,restore?:bool}`; lixeira ou restauração. 204. |
| GET `/pages/{id}/versions` | Editor: até cinquenta `{Number,At,Snapshot}`; JSON do texto anterior, nunca para leitores compartilhados. |
| GET `/pages/{id}/attachments` | Leitor: metadados de até dez anexos, sem bytes. |
| POST `/pages/{id}/attachments` | Editor: multipart com um arquivo em file, sem campos adicionais. Exceção explícita de corpo até 25 MiB + 256 KiB. Scanner comum, limitador upload. |
| GET/DELETE `/pages/{id}/attachments/{file}` | GET leitor atual: download privado; DELETE editor: exclusão definitiva, 204. |
| GET `/past-sessions?page=` | Mestre vê todos; membro só publicados. Vinte por página; cada item traz `scenes:[{title,text}]` na ordem registrada. |
| POST `/past-sessions`, PUT `/past-sessions/{id}` | Mestre: `{number,title,summary,date?,published?,revision?,scenes?:[{title?,text}]}`. `summary` até 10.000. Cenas opcionais: até 30, título ≤ 120 (vazio vira “Cena N”), texto obrigatório ≤ 10.000, soma ≤ 60.000; linhas totalmente vazias são ignoradas; enviar lista vazia remove as cenas. Mesma visibilidade do registro. Número exclusivo entre registros anteriores e sessões da plataforma sob bloqueio da campanha; não gera XP. |
| (capítulo) | `chapterId?` no corpo de `/past-sessions` vincula o registro a um capítulo da campanha (outra campanha: `400`); nulo = avulso. |
| GET `/atlas?page=` | Membro: publicações paginadas sem bytes. Mestre recebe também até cinquenta candidatos. |
| POST/DELETE `/atlas/{sourceMapId}` | Mestre: publica/atualiza cópia da imagem inteira, ou recolhe. 204. |
| GET `/atlas/{publicationId}/image` | Membro: cópia JPEG normalizada, private/no-store. |

GET `/api/notebook?page=` e GET `/api/notebook/{pageId}`: somente notas do autor autenticado, mesmo após saída/exclusão da campanha; conteúdo/segredos apenas no detalhe. Leitura textual; acesso aos anexos continua exigindo vínculo à campanha.

GET `/api/campaigns/{id}/journal` aceita `page` e `search` até 100 caracteres, retornando `recapTotal`, `page` e `pageSize:20`; mantém agenda/presença/entradas. Resumos continuam filtrados pela publicação. Erros novos seguem 400 validação, 403 papel, 404 acesso/recurso, 409 revisão/limite/estado, 413 tamanho, 415 formato e falhas do scanner existentes.


## Apresentação horizontal da mesa (ADR-056)

Não altera endpoints, DTOs, autorização, presença, turnos ou revisão. `GET …/live` permanece somente leitura; orientação/tela cheia são estado local transitório. A instrução de rotação em retrato não encerra nem pausa a sessão. Voltar à campanha usa o roteador e descarta os recursos locais normalmente.


ADR-057: pan/zoom/pinça e recolhimento de propriedades são apenas apresentação local. Contratos de preparação, movimento e névoa permanecem iguais; pinça não envia movimento, pintura ou mudança de grade. Seleção e arraste com zoom continuam convertendo as coordenadas pela mesma grade do servidor.


## Capítulos, atos e arcos (`/api/campaigns/{id}/chapters`) — ADR-060

Somente o mestre (`Verified`); jogador recebe `403`, quem não participa `404`. Escritas usam o bloqueio da campanha e a proteção antiforgery comum; campanha arquivada responde `409`.

| Rota | Contrato |
| --- | --- |
| GET (raiz) | `{items:[{id,kind,title,summary,order,revision,sessionCount,pastCount,firstNumber,lastNumber}], looseSessions, max:200}` na ordem definida pelo mestre. `looseSessions` soma sessões do Eternnus e anteriores sem capítulo. |
| POST (raiz), PUT `/{id}` | `{title, kind?: chapter/act/arc, summary?, revision?}` → capítulo. Título 1–120, resumo ≤ 2.000; `kind` é rótulo (sem hierarquia). Até 200 por campanha (`409`). PUT exige `revision` atual (`409`). |
| POST `/{id}/move` | `{direction: -1 ou 1, revision}` → 204. Troca com o vizinho e renumera a ordem. |
| DELETE `/{id}?revision=` | 204. Exclui só o capítulo; sessões vinculadas ficam avulsas (FK `SET NULL`). |
