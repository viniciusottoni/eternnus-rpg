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
| `POST …/tokens/{id}/settings` | Mestre | Estado completo: `{ light, vision, perception, senses, hidden, dc, detectSense, detectRange, label?, side?, templateId? }`. Nulo = ficha/configuração. ADR-080: `label` (1–40) e `side` (`ally`/`enemy`/`neutral`) valem só para criaturas; ausentes mantêm o atual. `templateId` (modelo permitido à campanha) vincula uma ficha a criatura que ainda não tem personagem do mestre; marcador já vinculado responde 409. Personagem de jogador com nome, lado ou ficha diferentes responde 409. Renomear atualiza o nome guardado na ordem de turnos. |
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

## Paredes vetoriais, penumbra e prévia real (ADR-087/088)

**Paredes vetoriais** (`MapFogState.walls`) somam-se às casas de `cells`; nada antigo foi convertido sozinho.

| Campo | Significado |
| --- | --- |
| `x1, y1, x2, y2` | Pontas em centésimos de casa (casa (x, y) = [100x, 100x+100]; centro 100x+50). Dentro do mapa, pontas diferentes. |
| `kind` | `wall` (bloqueia movimento e visão), `door` (fechada bloqueia tudo; aberta, nada), `window` (só movimento), `sight` (só visão e luz), `move` (só movimento). |
| `open` | Porta aberta. Na preparação é o estado inicial; na mesa é estado da partida (preservado ao aplicar). |
| `hidden` | Não aparece para jogadores (porta secreta, barreira invisível). Continua valendo nas regras. |

- Luz, visão e sentidos param numa parede que bloqueia visão; um passo de movimento (inclusive diagonal) não cruza parede que bloqueia movimento. Reta exatamente sobre a ponta de uma parede só bloqueia se houver parede dos dois lados ali (junção ou canto fechado). Mesmas contas inteiras em `FogGrid` (servidor) e `fog-policy.js` (cliente).
- Jogador recebe em `fog.walls` só segmentos que bloqueiam movimento agora e tocam casas conhecidas, sem id, tipo nem `hidden`; portas não secretas vêm com `door: "open"|"closed"`.
- Ajustar a grade de um mapa enviado converte as paredes de todas as camadas para o mesmo ponto da imagem. Limite: 2.000 segmentos por mapa.
- UVTT: linhas de visão e portais entram como paredes e portas vetoriais exatas.

**Luzes:** `radius` é a luz plena; `dim` (opcional, ≥ raio, até 30) é a penumbra e também ilumina para as regras. `color` (#rrggbb), `intensity` (10–100) e `animation` (`flicker`, `pulse`) são só visuais; animação respeita redução de movimento.

**Prévia real e diagnóstico (editor do mestre):** "Ver como jogador" usa `POST /api/campaigns/{id}/prep/preview-view` com as regras acima (inclui sentidos, percepção e explorações gravadas), sem gravar nada. O diagnóstico mostra bloqueios, áreas sem luz e problemas de geometria e nunca é enviado a jogadores.

| Método e caminho | Quem | Entrada / resultado |
| --- | --- | --- |
| `PUT /api/campaigns/{id}/assets/layers?key=` | Mestre | Aceita também `walls` (ausente = mantém) e luzes com `dim, color, intensity, animation`. O GET devolve `walls` e `live` (estrutura ao vivo, sem explorações). |
| `POST /api/sessions/{id}/fog/walls` | Mestre | `{ walls }` substitui as paredes vetoriais da camada ao vivo. |
| `POST /api/sessions/{id}/fog/wall-door` | Mestre | `{ id }` abre ou fecha a porta vetorial. `404` sem a porta, `409` se o segmento não é porta. |
| `POST /api/sessions/{id}/fog/lights` | Mestre | Aceita também `dim, color, intensity, animation`. |
| `POST /api/campaigns/{id}/prep/preview-view` | Mestre | `{ mapKey, sceneId?, layer?, tokens, visionMode?, viewerCharacterId? \| viewerUserId? \| party }` → `{ active, viewer, visible, explored, cells, lights, walls, marks, shown, perceived }` (índices do arranjo). Somente leitura. |

## Predefinições, desfazer e peso da cena (ADR-100)

- **Tipos de luz:** Vela (1/2), Tocha (4/8), Fogueira (5/10) e Lanterna (6/12), em casas de luz plena e penumbra. A escolha preenche os números validados pelo servidor. "Personalizado" mostra o raio na Básica; a Completa mantém penumbra, cor, intensidade e animação. Os valores não dependem de nenhum sistema de RPG.
- **Marcador:** "Luz carregada" (Sem luz ou um dos tipos) e "Visão no escuro" (sem, curta 6, longa 12). "Usar o valor da ficha/padrão da mesa" deixa o campo vazio, como antes.
- **Desfazer:** revelar e cobrir na mesa geram evento privado do mestre com as casas alteradas. Desfazer só vale no mesmo mapa/camada e se as casas ainda estiverem como a pintura deixou. A exploração dos jogadores (memória) não é apagada.
- **Peso:** o editor mostra "Cena pesada" a partir de 80% dos limites do servidor (paredes, luzes, marcas, marcadores). É aviso de limite; o custo real de desenho não foi medido.

## Limites conhecidos

- Bytes de imagem já entregues não podem ser recolhidos. Escurecer de novo uma casa que o jogador já explorou não apaga o que ele pode ter guardado; a mesa avisa o mestre.
- Mapas oficiais têm desenho público. Nesses mapas, o servidor oculta terreno, paredes, criaturas e marcas, mas não um desenho que já é público.
- A exploração é gravada nas escritas da mesa. Uma mudança de luz feita só pela ficha aparece na hora, mas só entra na exploração lembrada na próxima escrita da mesa.
- O custo de calcular luz por jogador e gerar imagens mascaradas não foi medido sob carga (nem com muitas paredes vetoriais; o alcance de cada fonte só considera as paredes próximas).
- Sem névoa, ou sem "movimento por caminho livre", o servidor não confere o trajeto: paredes (por casa ou vetoriais) só limitam o destino e a visão.
  - As imagens têm cache em memória de até 96 MiB e no máximo 2 gerações simultâneas.
  - A busca da imagem espera até 10 s pela fila de geração; se não conseguir a vez, responde `429`.
  - Uma falha na geração responde `503` e nunca devolve a imagem completa.
