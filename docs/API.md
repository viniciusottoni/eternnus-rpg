# Contratos HTTP — contas, campanhas e sessões

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
| `POST /auth/login` | `{ email, password }` | `200` com cookie; conta pode estar pendente. Consultar `/me`. |
| `POST /auth/logout` | Sessão | `204`; limpa sessão. |
| `POST /auth/resend` | Sessão | `200 { message }`; enfileira se ainda necessário e fora do intervalo de envio. |
| `POST /auth/confirm` | `{ userId, code }` | `200 { message }`; token válido confirma a conta. |
| `POST /auth/forgot-password` | `{ email }` | `200 { message }` genérico, inclusive para e-mail inexistente ou inelegível. |
| `POST /auth/reset-password` | `{ userId, code, password, confirmPassword }` | `200 { message }`; troca senha e invalida sessões anteriores. |
| `GET /auth/external/google` | — | Redireciona ao Google configurado. |
| `GET /auth/external/discord` | — | Redireciona ao Discord configurado. |

Callbacks `/signin-google`, `/signin-discord` e `/api/auth/external-callback` pertencem ao fluxo do middleware de autenticação. Não são endpoints para receber perfil arbitrário do frontend.

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
| `GET /campaigns` | Query `search`, `sort`, `page` opcionais | `200 { items, total, page, pageSize }`. Somente campanhas próprias ou com participação. |
| `POST /campaigns` | `{ name, system, description }` | `200 { id }`; o criador é obtido da sessão. |
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

- Nome obrigatório até 100 caracteres; sistema obrigatório até 80; descrição até 5.000.
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
| `GET /campaigns/{id}/sessions?page=` | Mestre | — | `200 { campaign, items, total, page, pageSize: 20, lastActivityAt }`. Itens: `id, number, title, objective, startedAt, endedAt, mapKind, mapKey, active, eventCount, noteCount, participantCount`, do mais recente ao mais antigo. Jogador recebe `403`: ele não vê a lista de sessões. |
| `POST /campaigns/{id}/sessions` | Mestre | `{ title, objective, mapKind, mapKey }` | `200 { id, number }`. Abre a sessão e coloca a campanha online. `409` se já houver sessão em andamento. |
| `GET /campaigns/{id}/table` | Mestre/jogador | — | `200 { campaign, isMaster, online, session, joinedCharacterId, characters }`. Ponto de entrada da mesa; `characters` lista as fichas do próprio jogador (vinculadas primeiro). |
| `GET /campaigns/{id}/maps` | Mestre | — | `200 { items }` com mapas oficiais (`valley`, `crypt`, `forest`) e recursos `mapa` da campanha (`resource:{id}`), com `rows` para tilesets. |

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
| `/api/library` | GET lista/detalhe/arquivo; POST /{id}/downloaded registra download. Staff: POST multipart para publicar, PUT metadados ou /{id}/file para substituir, DELETE para retirada. Admin pode restaurar/reverter versões. Formato permitido: PDF, PNG, JPEG, WebP; até 25 MiB e antivírus obrigatório em produção. |
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

Documentos: as únicas exceções de corpo grande são POST `/api/library`, PUT `/api/library/{guid}/file` e PUT `/api/sheet-templates/{guid}/versions/{guid}/pdf`: arquivo até 25 MiB, requisição até 25 MiB + 256 KiB. Tipo/assinatura/tamanho real e antivírus continuam obrigatórios. Falha no scanner retorna 503 e não publica; arquivo recusado retorna 422. GET de bytes usa private/no-store e sandbox. O limite geral das outras rotas permanece 64 KiB.

Campos da ficha: número aceita vírgula decimal e min/max; papéis numéricos exigem inteiros e os limites da mesa. Texto/textarea têm MaxLength e teto de 2.000/10.000; checkbox aceita true/false; select exige opção conhecida. Nome é obrigatório e tem até 100 caracteres. O conjunto Values é limitado a 100.000 caracteres; computados e nomes desconhecidos são ignorados. Alterações preservam snapshots e histórico por campo com fontes edit, migration ou master. Fichas antigas são convertidas na primeira escrita, sem alterar dados em GET.

## Evolução de campanhas e mesa (contratos atuais)

Os contratos abaixo complementam e substituem as permissões anteriores nas rotas correspondentes:

- [Fichas e auditoria privada](FICHAS_PRIVACIDADE.md): leitura compartilhada configurável, escrita dono/mestre, histórico por campo e snapshots com ator/sessão. As rotas de sheet, field-history, history e migration autorizam dono/mestre vinculado; histórico do mestre restringe-se às sessões que mestra. private só pode ser alterado pelo dono.
- [Contas e one-shots](CONTAS_MESAS_LIVRES.md): sistema explícito válido obrigatório, isOneShot na criação, limites de 3 campanhas persistentes e 10 one-shots acumuladas para comuns; limites na conta/lista, bootstrap privado e MFA obrigatório admin.
- [Bibliotecas e mapas](CAMPANHA_ACERVOS.md): acervo textual/publicação da campanha, hierarquia, upload privado de 10 MiB, grade/escala e visibilidade na sessão. Mapas atualmente mostrados devem ser ocultados antes de editar/excluir; conflito retorna 409.
- [Imagens temporárias](IMAGENS_TEMPORARIAS.md): comandos transacionais de apresentação e WebSocket de sinalização; bytes exclusivamente entre navegadores.

POST /api/campaigns/{id}/assets/maps é a nova exceção enumerada em UploadLimits: até 10 MiB de imagem e 64 KiB de margem multipart. Demais limites e proteções mantêm seus contratos.

DELETE /api/campaigns/{id} também retorna409 se há sessão ativa; encerrar a sessão antes da exclusão. A restrição de participantes continua aplicada. Encerrar/sair como mestre de uma one-shot remove seus dados pelo comando transacional da sessão.
