# Névoa, iluminação e visão

Este documento é a fonte de verdade da névoa da mesa: regras, dados, contratos HTTP e limites. A decisão está registrada em [DECISOES.md](DECISOES.md) (ADR-045). O design aprovado fica em [superpowers/specs/2026-11-08-nevoa-iluminacao-design.md](superpowers/specs/2026-11-08-nevoa-iluminacao-design.md).

## Regras

A névoa vale para mapas com grade: os tilesets oficiais e os mapas enviados pela campanha. Mapas cartográficos não têm névoa.

A névoa vem **ativa por padrão**. Uma casa fica **visível agora** para um jogador quando cumpre qualquer uma destas condições:

- o mestre a clareou (revelada);
- está iluminada por um foco do mapa ou pela luz de um marcador não oculto;
- está dentro da visão própria de um personagem desse jogador.

Alcance e bloqueio:

- O alcance é circular: a distância euclidiana entre os centros das casas precisa ser no máximo igual ao raio.
- A luz e a visão param em casas que bloqueiam luz. A face da parede fica iluminada.
- O canto entre duas casas bloqueadas que se tocam na diagonal também fecha a passagem.
- A linha é simétrica e usa só inteiros: `FogGrid.LineClear` no servidor e `lineClear` no cliente.

O que o jogador recebe:

- Casas já vistas ficam **exploradas** (a configuração "lembrar áreas exploradas" controla isso). O fundo aparece atenuado e nenhuma criatura é mostrada nelas.
- Personagens dos jogadores são sempre visíveis.
- Criaturas aliadas também são sempre visíveis quando a configuração permite.
- Inimigas e neutras só aparecem em casas visíveis agora.
- Uma criatura oculta não emite luz.

Detecção de elementos ocultos (criaturas e marcas):

- **Manual:** o mestre revela a jogadores específicos ou a todos.
- **Por percepção:** o elemento precisa estar numa casa visível. A percepção do personagem precisa ser igual ou maior que a dificuldade. Se o mestre definiu uma distância máxima, ela também precisa ser respeitada.
- **Por sentido:** o nome do sentido exigido precisa coincidir com um sentido da ficha. A comparação ignora maiúsculas, acentos e espaços nas pontas.
  - Se o sentido tem alcance, ele detecta através da escuridão, sem parede no caminho. Uma criatura detectada assim chega como `perceived: true`, com rótulo `?`.
  - Sem alcance, vale a área visível.
- A detecção roda na mesma transação de toda escrita que muda a visibilidade. O que foi revelado continua revelado até o mestre esconder de novo.
- Cada revelação gera um evento visível só ao mestre e a quem percebeu.

Movimento com névoa:

- O jogador só mira casas exploradas ou visíveis.
- Com "movimento por caminho livre", o servidor exige um caminho dentro do deslocamento, com diagonal de custo 1. O caminho não pode cortar canto entre dois bloqueios nem passar por casas desconhecidas, casas que bloqueiam movimento, portas fechadas ou casas ocupadas.
- Recusas que poderiam revelar terreno ou ocupantes invisíveis respondem `400 "Esse ponto não está disponível."`.
- O mestre move livremente, mas nunca para casas que bloqueiam movimento.

## Alcance no turno do jogador

No turno do jogador, a mesa destaca sozinha duas coisas, sem precisar ativar "Mover":

- **Movimento:** casas douradas onde ele pode chegar, seguindo as mesmas regras de névoa e caminho do servidor. O jogador **arrasta o próprio boneco** até uma delas ou clica na casa. O mestre pode arrastar qualquer marcador.
- **Ataque:** área avermelhada com as casas a até `floor(alcance / escala)` quadrados, com diagonal de custo 1. Serve só de informação; o mestre decide o efeito.

Os dois alcances vêm da ficha-modelo:

- **Movimento:** papel `movement`. Sem esse papel, nada é desenhado e o servidor não limita a distância (o mestre informa verbalmente). Paredes, névoa e um movimento por turno continuam valendo.
- **Ataque:** papel `reach` ("Alcance de ataque (m)"). Para variar com a arma, o autor liga o papel a um campo calculado. Sem o papel, nada é desenhado.

`GET …/live` traz `me.character.movementRole` e `me.character.reach` (metros, ou nulo).

## Dados

| Onde | O quê |
| --- | --- |
| `RpgSystem.TableSettings` | Padrão da mesa do sistema (admin). Nulo = padrão da plataforma. |
| `Campaign.TableSettings` | Ajuste do mestre na aba "Configuração da mesa". Vale para todas as sessões seguintes. Nulo = padrão do sistema. |
| `GameSession.TableSettings` | Ajuste só da sessão atual, escolhido pelo mestre na mesa. Nulo = campanha. |
| `CampaignMapLayer` | Uma linha por campanha + chave do mapa (oficial ou `asset:{guid}`). JSON `MapFogState`: névoa do mapa (nulo herda), células, focos, casas reveladas, marcas e explorações por jogador. **Continua entre sessões.** |
| `SessionToken` | Sobrescritas do mestre (luz, visão, percepção, sentidos), `Hidden`, `RevealedTo` e detecção (`Dc`, `DetectSense`, `DetectRange`). |
| `Character` | `LightMeters`, `VisionMeters`, `Perception`, `Senses` e `ReachMeters`, espelhados dos papéis `light`, `vision`, `perception`, `senses` e `reach` da ficha. Nulo = o modelo não tem o papel. |

Legenda das células: `.` livre, `m` bloqueia movimento, `l` bloqueia luz, `#` parede (bloqueia as duas coisas), `d` porta fechada, `o` porta aberta. Os cenários oficiais derivam as células da legenda do tileset: `#`, `o` e `T` viram parede; `t`, `~`, `h`, `A` e `b` bloqueiam movimento; `+` vira porta aberta. Tochas e braseiros viram focos com o raio da configuração.

Raios em casas vão de 0 a 30. Na ficha, luz, visão e alcance dos sentidos ficam em metros e são convertidos pela escala do mapa: `floor(m / escala)`. Limites: 100 focos e 100 marcas por mapa, rótulo de até 40 caracteres e até 10 sentidos.

## Contratos

Todas as rotas exigem `Verified`. As escritas usam antiforgery comum e `js/api.js`. As escritas da mesa passam por `SessionService` com a sequência de sempre: bloqueio da sessão, evento, `Revision++` e `Pulse`.

| Método e caminho | Quem | Entrada / resultado |
| --- | --- | --- |
| `GET /api/campaigns/{id}/table-settings` | Mestre | `{ settings, inherited, system }` |
| `PUT /api/campaigns/{id}/table-settings` | Mestre | `{ settings \| null }`. Nulo volta ao padrão do sistema. Bloqueia a sessão ativa e depois a campanha. |
| `PUT /api/admin/rpg-systems/{id}/table-settings` | Admin | `{ settings \| null, revision }`. Auditado como `system.table`. |
| `GET /api/campaigns/{id}/assets/layers?key=` | Mestre | Grade, imagem, células, focos, marcas, `explored` (união), `revision`, `settings` e `inUse`. |
| `PUT /api/campaigns/{id}/assets/layers?key=` | Mestre | `{ fog, cells, lights, revealed, marks, revision, resetExploration }`. `409` para revisão obsoleta. Se o mapa está na mesa, incrementa a revisão da sessão e sinaliza. |
| `GET /api/sessions/{id}/table-settings` | Mestre | `{ settings, scope: "session"\|"campaign", campaign, campaignInherited, system }` |
| `PUT /api/sessions/{id}/table-settings` | Mestre | `{ settings \| null, scope: "session"\|"campaign" }`. "campaign" grava na campanha e limpa o ajuste da sessão. |
| `GET /api/sessions/{id}/view?as={userId}` | Mestre | "Ver como": `{ revision, asUser, map, tokens, fog }`, idênticos ao que o jogador recebe. |
| `POST /api/sessions/{id}/fog/paint` | Mestre | `{ tool, cells: [{x,y}] }` (1–4.096 casas). Ferramentas: `reveal`, `conceal`, `wall`, `blockMove`, `blockLight`, `door`, `erase`. |
| `POST …/fog/door` | Mestre | `{ x, y }` abre ou fecha a porta. `409` se a casa não tem porta. |
| `POST …/fog/enabled` | Mestre | `{ enabled: true \| false \| null }`. Nulo segue a configuração. |
| `POST …/fog/reset` | Mestre | Recomeça a exploração: zera reveladas, explorações e percepções de marcas. Paredes, portas e luzes ficam. |
| `POST …/fog/lights`, `DELETE …/fog/lights/{id}` | Mestre | `{ id?, x, y, radius }` |
| `POST …/fog/marks`, `DELETE …/fog/marks/{id}` | Mestre | `{ id?, x, y, kind: trap\|door\|clue, label, dc?, sense?, maxDistance? }` |
| `POST …/fog/marks/{id}/reveal` | Mestre | `{ all, userIds }` (somente jogadores da sessão) |
| `POST …/tokens` | Mestre | Aceita também `hidden` e `light`. |
| `POST …/tokens/{id}/settings` | Mestre | Estado completo: `{ light, vision, perception, senses, hidden, dc, detectSense, detectRange }`. Nulo = ficha/configuração. |
| `POST …/tokens/{id}/reveal` | Mestre | `{ all, userIds }`. `all` deixa a criatura visível; o contrário a mantém oculta para quem não está na lista. |
| `GET /api/campaigns/{id}/assets/maps/{mapId}/image?as=` | Mestre/jogador | Jogador com névoa ativa recebe só os pixels das casas exploradas (o resto em preto). O mestre recebe a imagem completa, ou a do jogador indicado em `as`. |

O `GET …/live` passa a incluir `fog`:

- **Jogador:** `{ active, remember, cells (desconhecidas = "?"), visible, explored, lights (em casas conhecidas), marks (reveladas), imageVersion }`. `map.rows` tem `?` nas casas nunca vistas. Em mapa enviado, `imageUrl` recebe `?v=` com a versão da exploração. `tokens` contém só o que o jogador enxerga, com `light` e `perceived`.
- **Mestre:** `{ active, inherited, cells, revealed, shared, explored, lights, marks, revision, settings, players }`. Os marcadores trazem sobrescritas, ocultação, `revealedTo` e detecção.

## Interface

- **Mesa (mestre):** ferramenta ☼ "Névoa, paredes e luz" com paleta de pintura por clique ou arraste (`pointer events`; teclado com setas e Enter), porta, foco, marca, estado da névoa e "Recomeçar exploração". Também: ✎ "Luz, visão e ocultação do marcador", 👁 "Ver como" e ⚙ "Configuração da mesa". Ao salvar a configuração, a mesa pergunta se a mudança vale só nesta sessão ou na campanha toda.
- **Aba "Mapas e cenários":** botão "☼ Névoa e luz" em cada mapa com grade (enviado ou oficial). Abre o editor único de cenas só com a preparação compartilhada do mapa, com prévia de luz igual à do servidor e uma única escrita ao salvar.
- **Camadas por cena e preparação pendente** (ADR-048): camada própria `{mapa}@{cena}` e `CampaignMapLayer.Prepared`. Com a camada na mesa, salvar não muda o ao vivo; "Aplicar à cena atual" é explícito. Detalhes em [CENAS_EDITOR.md](CENAS_EDITOR.md).
- **Aba "Configuração da mesa" da campanha:** salva na campanha ou volta ao padrão do sistema.
- **Painel admin → Sistemas:** "Mesa padrão" por sistema.
- **Editor de fichas:** papéis Luz (m), Visão própria (m), Percepção e Sentidos.

## Limites conhecidos

- Bytes de imagem já entregues não podem ser recolhidos. Escurecer de novo uma casa que o jogador já explorou não apaga o que ele pode ter guardado; a mesa avisa o mestre.
- Mapas oficiais têm desenho público. Nesses mapas, o servidor oculta terreno, paredes, criaturas e marcas, mas não um desenho que já é público.
- A exploração é gravada nas escritas da mesa. Uma mudança de luz feita só pela ficha aparece na hora, mas só entra na exploração lembrada na próxima escrita da mesa.
- O custo de calcular luz por jogador e gerar imagens mascaradas não foi medido sob carga.
  - As imagens têm cache em memória de até 96 MiB e no máximo 2 gerações simultâneas.
  - A busca da imagem espera até 10 s pela fila de geração; se não conseguir a vez, responde `429`.
  - Uma falha na geração responde `503` e nunca devolve a imagem completa.
