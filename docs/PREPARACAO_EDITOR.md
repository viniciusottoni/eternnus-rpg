# Preparação unificada e editores visuais (ADR-081)

Fonte de verdade da área **Preparação** (gerenciador de arquivos da campanha) e dos editores de **mapas** e **cenas** construídos sobre um núcleo gráfico comum. Complementa [CENAS_EDITOR.md](CENAS_EDITOR.md), [CAMPANHA_ACERVOS.md](CAMPANHA_ACERVOS.md), [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md) e [API.md](API.md).

## 1. Visão geral

| Antes | Agora |
| --- | --- |
| Preparação listava cenas (cartões) e personagens (tabela); mapas ficavam em Mundo e acervo › Mapas e cenários. | Preparação é um gerenciador único com três pastas-raiz fixas: **Cenas**, **Mapas**, **Personagens**. A subpágina "Mapas e cenários" deixou de existir; o endereço antigo `#campaign/{id}/maps` abre a Preparação na raiz Mapas. |
| Cenários oficiais apareciam como "Atlas do Eternnus" junto dos mapas próprios. | O explorador mostra só recursos da campanha. Os vinte cenários oficiais continuam no catálogo interno (`Domain/BattleMaps.cs`) e aparecem nos fluxos **Novo mapa › A partir de modelo** e **Nova cena › A partir de mapa** (grupo "Modelos oficiais"). Referências antigas (`crypt`, `valley`…) continuam funcionando. |
| Editor de tiles em modal com formulário; editor de cenas com lateral contextual. | Editores em tela cheia sobre o **núcleo gráfico** (`js/editor-core.js`): menus no topo, ferramentas à esquerda, canvas central, camadas/estrutura/propriedades à direita e barra de estado. |

Mundo e acervo mantém Páginas, Linha do tempo, NPCs conhecidos, Atlas compartilhado e Bibliotecas.

## 2. Modelo de dados (migração `PrepWorkspace`, aditiva)

| Entidade | Campo novo | Uso |
| --- | --- | --- |
| `CampaignMapFolder` | `Category` (`scenes`/`maps`/`characters`, padrão `maps`) | Pastas de cada categoria. As raízes são virtuais (`FolderId` nulo) e não podem ser excluídas. Pastas antigas viram `maps`. |
| `Scene` | `FolderId`, `CreatedAt` (preenchido com `UpdatedAt`), `Layers` (JSON) | Pasta, ordenação por criação e camadas visuais da cena. |
| `SceneToken` | `Layer` | Camada visual do marcador (padrão `elements`). |
| `MasterCharacter` | `FolderId`, `CreatedAt` | Pasta e ordenação. |
| `CampaignMap` | `CreatedAt`, `UpdatedAt`, `Summary` (descrição, até 500), `SourceKey` (modelo oficial de origem), `Composition` (JSON de camadas/elementos), `OwnerMapId` | Metadados, origem, documento editável e imagens-fonte. |

`CampaignAssetPurposes.Layer` (`layer`): imagem-fonte de um elemento de mapa, pertencente a um mapa (`OwnerMapId`). Nunca é listada como mapa ou retrato, não conta no limite de 50 mapas, conta no limite de 250 MiB e é excluída com o mapa dono. Só o mestre lê os bytes.

Limites: 100 pastas por categoria, oito níveis; 100 cenas, 50 mapas, 200 personagens; 8 camadas por documento; 200 elementos por mapa de imagem; 40 imagens-fonte por mapa.

## 3. Camadas

Todo documento tem as camadas obrigatórias **Base** (`id = "base"`) e **Elementos** (`id = "elements"`), sempre nessa ordem de baixo para cima, e até seis camadas extras (`kind = "custom"`). Base e Elementos não podem ser excluídas; podem ser renomeadas, bloqueadas e ter opacidade ajustada.

| Documento | Base | Elementos e extras | Visibilidade/opacidade |
| --- | --- | --- | --- |
| **Mapa de tiles** | Terreno (todas as casas preenchidas). | Grade do mesmo tamanho, `_` = vazio. Objetos ficam por cima do terreno (árvore sobre grama, mesa sobre piso). | A grade efetiva (`TileData`) é a fusão: em cada casa vale o tile da camada visível mais alta que não esteja vazia; a Base sempre entra nas regras (o olho dela só esconde no editor). Camadas extras ocultas ficam fora das regras e da mesa. Camadas de tiles não têm opacidade (tiles são opacos na mesa). |
| **Mapa de imagem** | Imagem principal (ou fundo). | Imagens, textos, retângulos e elipses posicionados livremente, com transformação. | Camada oculta fica fora da imagem achatada entregue à mesa; opacidade entra no achatamento. |
| **Cena** | Referência do mapa (somente leitura; edita-se o mapa no editor de mapas). | Marcadores (personagens, criaturas, NPCs) organizados por camada. | Visibilidade, bloqueio e opacidade das camadas da cena são **só do editor** (organização). O que o jogador vê continua decidido por "Oculto" no marcador, névoa e visibilidade da cena. |

As camadas técnicas (paredes e portas, luz, névoa/exploração, marcas ocultas) continuam sendo a preparação do mapa (`CampaignMapLayer`) e aparecem no painel como grupo "Preparação do mapa", com controles próprios. Alterar camadas visuais nunca reinicia explorações.

Regras e passagem: a fusão produz o mesmo alfabeto de tiles de antes; `MapTiles.Validate`, entradas, bloqueio de visão e movimento continuam calculados sobre `TileData`. A mesa recebe também `terrain` (a Base) para desenhar o piso real sob os objetos; para jogadores, `terrain` passa pela mesma máscara de casas desconhecidas que `rows`.

## 4. Mapas de imagem: área visível e área externa

`Composition` de um mapa de imagem:

```json
{ "v": 1,
  "artboard": { "width": 2048, "height": 1536, "background": "#000000" },
  "layers": [ { "id": "base", "name": "Base", "kind": "base", "visible": true, "locked": false, "opacity": 100 },
              { "id": "elements", "name": "Elementos", "kind": "elements", "visible": true, "locked": false, "opacity": 100 } ],
  "elements": [ { "id": "e1", "layer": "base", "type": "image", "name": "Fundo", "src": "asset:{guid}",
                  "x": -300, "y": -120, "width": 2800, "height": 2100, "rotation": 0, "opacity": 100,
                  "visible": true, "locked": false, "flipX": false, "flipY": false } ] }
```

- **Área visível (artboard)**: largura × altura em pixels (64–4.096 por lado, até 8 milhões de pixels). É o que vira a imagem do mapa (`Content`), a grade e o que a mesa mostra.
- **Área externa (pasteboard)**: coordenadas livres em volta (de −16.384 a 20.480). Elementos podem ficar total ou parcialmente fora; nada é cortado nos dados. O recorte acontece só no achatamento.
- **Salvar** achata no navegador (canvas) as camadas visíveis recortadas ao artboard e envia PNG + `Composition` numa única escrita. O servidor normaliza a imagem pelo mesmo caminho do envio (verificação, limites, JPEG), confere que as dimensões batem com o artboard e guarda os dois. A mesa e os jogadores continuam recebendo só `Content` (com a máscara de névoa existente): a parte externa nunca chega aos jogadores.
- `src` aceita `asset:{guid}` de imagem-fonte do próprio mapa ou `self` (a imagem atual do mapa). Ao salvar, `self` é copiado para uma imagem-fonte, para que reeditar nunca degrade a imagem por recompressão sucessiva. Imagens-fonte não referenciadas são removidas ao salvar.
- Mapas antigos sem `Composition` abrem com Base = imagem atual (`self`, tamanho inteiro) e Elementos vazio.

### Redimensionar o documento

O diálogo **Imagem › Tamanho do documento** distingue:

1. **Tamanho da área visível**: muda só o artboard (ancoragem em 9 posições); conteúdo fica onde está, o que sair do artboard vai para a área externa.
2. **Redimensionar conteúdo**: escala artboard e elementos proporcionalmente.
3. **Recortar para seleção/região**: define o artboard por um retângulo, sem apagar elementos.

Com o mapa já preparado (névoa, marcadores), o diálogo mostra a nova grade ("N × M casas") e pede confirmação; paredes/névoa seguem `TableFog.Fit` e marcadores fora da nova grade saem da preparação das cenas (mesma regra de ajuste de grade).

## 5. Contratos HTTP novos

Todas as rotas exigem `Verified`, são do mestre (403 jogador, 404 sem vínculo) e escritas passam por antiforgery (`js/api.js`). Campanha arquivada responde 409 em escritas.

| Método/caminho | Contrato |
| --- | --- |
| GET `/api/campaigns/{id}/prep/explorer` | `{folders:[{id,name,parentId,category}], scenes:[…], maps:[…], characters:[…], activeSessionId, archived, limits}`. Listas limitadas pelos limites de domínio, projetadas. Mapas: campos de `CampaignMapView` + `summary, sourceKey, origin ('tiles'|'image'), createdAt, updatedAt, scenes (cenas que usam), inUse`. Cenas: `id,name,description,kind,mapKey,mapName,layerMode,visionMode,prepared,hasSaved,hasText,current,order,revision,folderId,createdAt,updatedAt` (`hasText` desde a ADR-084). Personagens: `id,name,summary,kind,side,copy,sharedWithPlayers,imagePreview,templateName,folderId,revision,createdAt,updatedAt`. Retratos, imagens-fonte e cenários oficiais não aparecem. |
| POST `/prep/folders` | `{name, parentId, category}` → pasta. 400 nome/categoria/pai de outra categoria/profundidade; 409 limite. |
| PUT `/prep/folders/{id}` | `{name}` → pasta renomeada. |
| DELETE `/prep/folders/{id}` | 204; 409 se tiver subpasta ou item. |
| POST `/prep/move` | `{category, folderId, items:[{type:'scene'|'map'|'character'|'folder', id}]}` (até 200). Tudo ou nada. 400 categoria incompatível ("Cenas só ficam em pastas de Cenas"), pasta para dentro de si mesma/descendente, profundidade. IDs e referências nunca mudam; revisões não mudam. |
| POST `/prep/copy` | Mesmo corpo. Duplica cenas (com preparação própria sem exploração), mapas (bytes, tiles, composição, imagens-fonte e preparação de névoa sem exploração), personagens (cópia independente, não "cópia de encontro") e pastas recursivamente. Tudo ou nada; 409 em limites. → `{created:[{type,id}]}`. |
| PUT `/prep/rename` | `{type, id, name, revision}` → `{id, revision}`. 409 revisão obsoleta (pastas ignoram revisão). |
| GET `/assets/tile-maps/{id}` | Inclui `layers:[{id,name,kind,visible,locked,opacity,rows}]` (sintetizadas para mapas antigos), `summary`, `sourceKey`. |
| POST/PUT `/assets/tile-maps` | Corpo anterior + `summary`, `sourceKey` (criação; precisa ser cenário oficial), `layers` (opcional; ausente = `rows` vira a Base), `keepFolder` (edição sem mexer na pasta). |
| GET `/assets/maps/{id}/composition` | `{map, summary, composition}`; sintetiza a composição de mapas antigos. |
| PUT `/assets/maps/{id}/composition` | multipart: `file` (PNG/JPEG achatado ≤ 10 MiB), `composition` (JSON), `revision`, `name`, `summary`, `gridPixels`, `scaleMeters`, `hasGrid`, `gridOffsetX`, `gridOffsetY`, `freeMovement`. 409 revisão/mapa na mesa/limites; 400 composição ou dimensões inválidas. → mapa + composição. |
| POST `/assets/maps/{id}/sources` | multipart `file` (+`name`): imagem-fonte do mapa (PNG com transparência preservada). → `{id,key,name,width,height,imageUrl}`. |
| POST `/assets/maps/{id}/sources/import` | `{url, name}` pelo mesmo baixador seguro. |
| POST `/assets/maps/{id}/sources/copy` | `{from:"asset:{guid}"}`: copia uma imagem da campanha (mapa ou retrato). |
| POST `/assets/maps`, `/maps/import`, PUT `/maps/{id}` | Aceitam `summary` e, na criação, `sourceKey`. Pasta precisa ser da categoria Mapas. |
| POST/PUT `/scenes` | `SceneInput` + `folderId` (só na criação) e `layers` (nulo mantém); marcadores aceitam `layer`. GET devolve `layers`, `folderId`, `createdAt`. |
| POST `/npcs` | `NpcInput` + `folderId` (só na criação). |

Excluir continua nos endpoints existentes (`DELETE /scenes/{id}`, `/assets/maps/{id}`, `/npcs/{id}`), com as mesmas proteções (cena em apresentação, mapa na mesa). Excluir um mapa remove as imagens-fonte dele.

## 6. Núcleo gráfico (`js/editor-core.js`)

Componentes reutilizados pelos três editores:

- `createEditorShell`: layout em tela cheia (no `#modal` com a classe `editor-modal`): barra de menus, ferramentas (ícone + nome acessível + atalho), palco, painéis à direita redimensionáveis/recolhíveis, barra de estado (zoom, coordenadas, dimensões, estado, ajuda), tela cheia, guarda de saída com alterações não salvas e `beforeunload`.
- `createHistory`: desfazer/refazer por instantâneos com rótulo; `begin/commit` agrupa um arraste numa única entrada; limite de 100 etapas; painel "Histórico" da sessão de edição.
- `openContextMenu`: menu de contexto acessível (setas, Enter, Esc, Tab fecha), posicionado dentro da janela.
- `openPropertiesDialog`: janela flutuante (não modal, arrastável) com apenas os campos do elemento; Aplicar/OK/Cancelar.
- `renderOutline` (`editor-outline.js`, ADR-118): árvore unificada de camadas e elementos (olho, cadeado, opacidade, Todos/Mestre, renomear, ordem, nova, duplicar, excluir extras, arrastar entre camadas, localizar). Substitui os antigos painéis Camadas e Estrutura.
- `bindEditorKeys`: atalhos (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Ctrl+C/X/V, Ctrl+D, Ctrl+S, Delete, Esc, Ctrl+0, Ctrl+1, Ctrl+±, letras das ferramentas) que nunca disparam dentro de campos de texto, exceto Ctrl+S e Esc.

Navegação: roda do mouse = zoom centrado no cursor; espaço + arrastar e botão do meio = mover a vista; pinça no toque; ferramenta Mão. O tabuleiro da mesa (`createBoard`, opção `editor`) e a superfície de composição (`js/composition-canvas.js`) implementam a mesma navegação. A câmera nunca muda as coordenadas dos elementos.

Interface Básica/Completa: a Básica mostra as ferramentas essenciais e esconde grupos avançados e painéis secundários; nada nos dados ou nas regras muda.

Réguas, dicas e tamanho (16/11/2026):

- **Réguas** superior e esquerda, discretas (18 px), desenhadas pelo núcleo a partir de `camera.ruler()` de cada editor → `{ x, y, cellPx, cellUnits, unit }` (origem em coordenadas da janela, pixels de tela por casa, metros por casa). Valem em metros pela grade: 0 no canto do mapa (tiles e cenas) ou na primeira linha da grade (imagem); valores negativos na área externa. Marcas maiores a cada 1, 2, 5, 10… casas com pelo menos 56 px (`rulerSteps`, `editor-policy.js`), menores por casa; linha dourada na posição do cursor. Mapa de imagem sem grade mostra pixels. Cena textual não mostra réguas. Liga/desliga em Exibir › Réguas (preferência local); ocultas no celular. Só redesenham quando a vista, o tamanho ou o cursor mudam.
- **Dicas das ferramentas**: ao passar o mouse (400 ms) ou focar pelo teclado, a dica compartilhada de `help.js` abre ao lado da barra com o nome e o atalho em destaque e, em letras menores, o que fazer com a ferramenta (`tool.tip`; na cena, o texto de `scene-policy.HELP`). Ferramenta indisponível mostra o motivo. Não abre por toque.
- **Área visível**: fica centralizada no palco com a área externa escura em volta. O tamanho na barra de estado é um botão que abre o diálogo de tamanho (mapa de tiles: Tamanho do mapa; imagem: Tamanho do documento).

### 6.1 Contextos de trabalho, barra de propriedades e layout flexível (ADR-086, 16/11/2026)

**Contextos** são modos de trabalho do mesmo documento, exibidos no topo (Alt+1 a Alt+6; setas navegam): Elementos, Terreno, Paredes e portas, Iluminação, Exploração e Cena (`EDITOR_CONTEXTS` em `editor-policy.js`). Cada editor declara os seus; o núcleo filtra ferramentas e painéis. Trocar de contexto não salva, não desfaz e não muda seleção, câmera, zoom, histórico, rascunho nem alterações não salvas. Combina com Básica/Completa: um contexto sem ferramenta própria visível na interface atual some da barra (com um só contexto, a barra fica oculta).

| Editor | Contextos (rótulo) | O que mostram |
| --- | --- | --- |
| Tiles (`kind: "tiles"`) | Terreno, Elementos | Mesmas ferramentas de pintura; Terreno torna a Base a camada ativa e Elementos a camada Elementos. |
| Imagem (`kind: "image"`) | Elementos, Documento (`scene`) | Elementos: criar e transformar (painéis Camadas, Estrutura, Propriedades). Documento: Recortar documento e Grade. |
| Cena (`kind: "scene"`; preparação do mapa `map-prep`) | Elementos, Paredes e portas, Iluminação, Exploração, Cena | Pelos grupos de `TOOL_INVENTORY` (`scene-policy.js`): `elements`+Adicionar; `walls`; `light`; `explore`+Visibilidade/Revelar/Cobrir; `grid`+`scene`+Cenário/Texto/Notas. Ferramentas novas entram pelo grupo. |

Regras (`toolInContext`, `panelInContext`, `availableContexts`, `toolAfterContext`): ferramenta pertence ao contexto pelo próprio `context` (id, lista ou `"*"`), senão pela lista `tools`/`groups` do contexto; `commonTools` (Selecionar, Mão, Zoom) aparecem em todos; **ferramenta ou painel sem contexto declarado aparece sempre** (nada fica inalcançável). Ao trocar, a ferramenta atual continua se estiver visível; senão vale a `defaultTool` do contexto. O atalho de letra de uma ferramenta de outro contexto leva a esse contexto (os atalhos existentes continuam valendo). O último contexto escolhido fica salvo por tipo de editor.

**Janela de ação no ponto** (ADR-125, `openFloatingPanel` em `editor-core.js`): criar ou editar algo numa casa abre uma janela não modal ao lado do clique, e nunca na lateral direita. O mesmo vale para as ferramentas básicas da esquerda que têm formulário. A posição vem de `popoverPosition` (`editor-policy.js`): à direita do ponto ou, sem espaço, à esquerda, sem cobrir a casa, sempre dentro da tela e reajustada quando o conteúdo cresce. No celular vira folha inferior. Esc, Fechar ou clicar fora fecham sem aplicar e devolvem o foco. Fica uma janela por vez, e abrir uma fecha a janela de propriedades.

| Editor de cenas | Abre em janela | Fica na lateral direita |
| --- | --- | --- |
| Casa (ferramenta, menu de contexto, árvore) | Adicionar aqui (+ Novo personagem aqui, reservados, jogadores, NPCs, marcador avulso), Foco de luz, Marca oculta | — |
| Ferramentas da esquerda | Cenário, Visibilidade, Texto compartilhável, Notas privadas (ao lado do botão) | Névoa, Recomeçar exploração, Ajustar grade, Configuração da cena |
| Fluxos | Aplicar à cena, Reiniciar, Recolocar personagens, imagens novas, Imagem do marcador, Vincular personagem | Ensaio, conflito ao salvar, erros, paredes, diagnóstico, detalhes avançados |
| Seleção | Duplo clique, Enter ou menu de contexto: janela de propriedades | Propriedades do selecionado, Organizar, Adicionar, Configurar |

**Barra de propriedades** (`contextBar: true`, hoje no editor de imagem): faixa fixa acima (padrão) ou abaixo da área de edição, ou oculta (Exibir › Barra de propriedades). A altura fica reservada mesmo sem seleção, para o canvas não mudar de tamanho a cada clique. No editor de imagem mostra X, Y, largura, altura, giro, opacidade, camada e bloqueio do selecionado (conjunto: X, Y, opacidade, camada, bloqueio) e ações rápidas (todas as propriedades, alinhar ×6, distribuir ×2, agrupar/desagrupar, duplicar, excluir). Cada mudança é uma entrada do histórico. A janela de propriedades e o painel Propriedades continuam.

API para outros editores: `shell.contextBar.show({ key, title, icon, fields, actions, onChange(name, value), onAction(id) })`, `update(values)` (durante arrastes; não mexe no campo em edição) e `hide()`. Campos: `{ name, label, type: number|text|select|checkbox|color, value, min, max, step, unit, options:[[valor, rótulo]], disabled, wide }`. Mesma `key` com o foco na barra só atualiza valores. Números fora de `min/max` são limitados; vazio ou inválido volta ao valor anterior.

**Layout flexível** (só apresentação, por conta neste navegador — `eternnus.editor.layout.{usuário}`, com leitura da chave antiga; nunca entra no documento): largura dos painéis (divisor, 220–520 px), painéis recolhidos, ordem dos painéis por tipo de editor (botão ⋮ do painel: recolher/expandir, mover para cima/baixo), réguas, posição da barra de propriedades e último contexto. **Maximizar área de edição** (botão no topo ou Ctrl+\\) esconde painéis, réguas e a barra de propriedades até ser desligado (não fica salvo). Exibir ganha, em todos os editores, Contexto de trabalho, Maximizar, Barra de propriedades e **Restaurar layout padrão**. No celular, os painéis seguem em gaveta sobre o palco, contextos e ações têm 44 px e a área segura é respeitada.

**Editor de imagem — ferramentas profissionais**: seleção por clique, Shift/Ctrl (soma) e retângulo; com dois ou mais selecionados e desbloqueados, as alças do retângulo de limites redimensionam (Shift trava a proporção; imagens já a mantêm por padrão; Alt a partir do centro) e giram o conjunto (Shift em passos de 15°), com dimensões e porcentagem durante o arraste (`scaleGroup`, `rotateGroup`). Elementos girados fora de múltiplos de 90° escalam de forma uniforme para não deformar. **Grupos**: `group` opcional no elemento (a-z, 0-9 e hífen, até 24; validado também no servidor; composições antigas não mudam); Ctrl+G agrupa elementos da mesma camada, Ctrl+Shift+G desagrupa; clicar num membro no canvas seleciona o grupo e a Estrutura escolhe um só; cópias (colar/duplicar) ganham grupo novo. **Guias magnéticas**: além da área visível e da grade, bordas e centros dos outros elementos visíveis (Exibir › Encaixar em objetos; Ctrl ao arrastar ignora). Alinhar, distribuir, bloquear, edição numérica e setas (1 px; Shift 10 px) já existiam e continuam.

Desempenho medido (Node 24, `composition-policy.js`, 200 elementos girados): `hitTest` 0,03 ms por consulta; linhas de encaixe calculadas uma vez por arraste em 0,6 ms; `snapMove` 0,05 ms por movimento. Com o limite de 200 elementos por mapa, um índice espacial não traria ganho perceptível e não foi adotado.

### 6.2 Barra lateral contextual (ADR-118, 19/11/2026)

A lateral é igual nos três editores (e a mesa ao vivo usa as mesmas abas):

| Região | Conteúdo | Observações |
| --- | --- | --- |
| Cabeçalho | Nome, tipo, selos (Salvo / Não salvo / Na mesa / Não aplicado / Ensaio), mapa original, menu ⋯ | `shell.setSideHeader({ name, kind, chips, origin, menu })`. No celular, o X fecha a gaveta. |
| Inspetor | Painéis `area: "inspect"` (Propriedades) | Sempre no alto; divisor horizontal ajusta a altura (setas no teclado). Recolher o painel devolve a altura às áreas. |
| Organizar | Árvore unificada (`renderOutline`) | Camadas como ramos; elementos como folhas. A seleção do palco destaca e abre o ramo; só "Localizar" move a câmera. |
| Adicionar | Acervo, paleta de tiles, Personagens (cena) | Clique insere no centro da vista; arrastar solta no ponto. Busca e vista ficam como estavam ao voltar. |
| Configurar | Documento (imagem), Mapa e pintura (tiles), Cena (cena) | Itens abrem o formulário existente no inspetor. |
| Histórico | Ícone ao lado das abas | Secundário; clicar de novo volta à área anterior. |

API: painéis declaram `area` (`inspect`, `organize`, `add`, `configure`, `history`); `shell.setArea(id)`, `shell.area`, `shell.revealPanel(id)` (abre a lateral, vai à área e expande — `togglePanel(id, true)` faz o mesmo), `shell.views.get/set(nome)` e `views.collapsed()/setCollapsed(chave, on)` para preferências visuais do editor. Contexto pode declarar `area` (para onde a lateral vai quando a área atual fica vazia nele); área sem painel no contexto mostra um estado vazio com botões para os contextos que a preenchem. Regras puras em `editor-policy.js`: `SIDE_AREAS`, `panelArea`, `sideAreasFor`, `initialArea`, `INSPECT_SPLIT`/`clampSplit`, `rangeIds`, `outlineDropProblem`.

| Editor | Inspetor | Organizar | Adicionar | Configurar |
| --- | --- | --- | --- | --- |
| Imagem | Documento, camada, elemento (com Manter proporção) ou vários | Camadas › elementos; arrastar move de camada ou reordena | Enviar imagem, Texto, formas (Completa), acervo Imagens/Mapas/Recentes/Favoritos | Área visível e externa, recorte, grade e escala, fundo, propriedades, névoa e luz |
| Tiles | — (sem objetos selecionáveis) | Camadas | Paleta de tiles | Mapa e pintura (casa inspecionada, camada automática, piso da borracha) |
| Cena | Marcador, vários, camada de marcadores, imagem ou camada da composição, formulários de configuração | Marcadores, Composição desta cena (Todos/Mestre), Preparação do mapa (Completa), Mapa de origem (somente leitura) | Personagens (Em cena / Disponíveis / Reservados) e Acervo (Imagens/Mapas/Recentes/Favoritos) | Cena, Mapa de origem, Composição, Preparação do mapa, Área de entrada |

Preferências novas no mesmo armazenamento de layout (por conta e tipo de editor): `area`, `split`, `tree`, `views`. Nunca entram no documento; valores inválidos são descartados.

## 7. Fluxos

- **Novo mapa** → "Criar do zero" (enviar imagem, importar URL, arquivo VTT, mapa vazio com tiles, área em branco) ou "A partir de modelo" (catálogo oficial com miniaturas, busca, filtro por tipo e prévia ampliada). Um modelo de tiles vira mapa de tiles editável (camadas preservadas, nada é rasterizado); a cartografia oficial vira mapa de imagem. O original nunca é alterado. Após criar, o editor abre.
- **Nova cena** → "Do zero" (abre o editor de cena sem mapa; textual ou visual) ou "A partir de mapa" (seletor em três grupos nesta ordem: mapas próprios criados do zero/importados, mapas criados de modelos, modelos oficiais). A cena referencia o mapa (sem cópia de bytes).
- **Personagens**: abrir ficha, editar, duplicar, cópia de encontro, história, organizar em pastas. No editor de cena, o painel Personagens permite arrastar para o canvas.

### 7.1 Gerenciador: favoritos, recentes, coleções e filtros (ADR-084, 16/11/2026)

Auditoria antes da mudança: já existiam busca sem acentos (pasta ou "em todas as pastas"), ordenação, grade/lista, seleção múltipla (Ctrl/Shift/teclado), copiar/recortar/colar/duplicar/mover em lote (tudo ou nada no servidor), excluir em lote com relatório de falhas, arrastar para pastas da árvore, do conteúdo e do caminho (com "Mover para…" no toque), breadcrumbs, histórico Voltar/Avançar, painel de detalhes com miniatura e o selo "N cenas" nos mapas. O que faltava foi acrescentado sem mudar as três raízes nem os endpoints `/prep/*`:

- **Favoritos**: estrela na barra (`aria-pressed`), no painel de detalhes e no menu do item; vale para itens e pastas. Selo "★ favorito" no item.
- **Recentes**: o que o mestre abriu neste navegador (até 30) mais o que foi modificado nos últimos 14 dias, do mais recente para o mais antigo.
- **Coleções inteligentes** (seção "Coleções" abaixo das pastas, com contagem): Favoritos, Recentes, Cenas prontas para apresentar, Cenas incompletas, Personagens sem ficha completa, Mapas não usados. **Coleções salvas**: "Salvar como coleção…" guarda a busca e os filtros atuais (até 20, nome até 40), sempre aplicados à campanha toda. Coleções são vistas virtuais: nunca movem, copiam nem renomeiam; colar e soltar não valem nelas ("Abra uma pasta para colar."). "Mostrar na pasta" leva ao local real do item.
- **Filtros** (botão "Filtros (N)"): tipo (cena com mapa/imagem/textual, mapa de tiles/imagem, personagem, criatura), origem do mapa (tiles, enviado/importado, a partir de modelo), modificado (24 h, 7, 30 dias, há mais de 30), uso, preparo (prontos/incompletos), só favoritos e **Onde** (nesta pasta, nesta pasta e subpastas, toda a campanha). Com filtro ativo as pastas saem da lista. Filtros que não se aplicam a um tipo excluem esse tipo: origem só mapas; uso só mapas (cenas que usam ou mesa) e cenas (em apresentação ou já visitadas); preparo só cenas e personagens.
- **Critérios de preparo** (`sceneIssues`, `characterIssues` em `prep-explorer-policy.js`): cena incompleta = (a) cena com mapa ou imagem sem cenário, ou com cenário que não existe mais; (b) cena com mapa sem nenhum marcador; (c) sem texto compartilhável para a mesa. Cena textual não precisa de mapa. "Pronta para apresentar" = sem pendências e fora de apresentação. Personagem incompleto = sem ficha-modelo vinculada ou sem resumo. Mapa não usado = nenhuma cena usa e não está na mesa. As pendências aparecem em texto (selo "⚠ incompleta: …" e lista "Pendências" no detalhe), nunca só por cor, e nada é corrigido automaticamente.
- **Vínculos**: o detalhe do mapa lista as cenas que o usam (até 12, cada uma leva à cena) ou "Mapa não usado".
- **Listas longas**: o conteúdo desenha 240 itens por vez com "Mostrar mais"; o teclado amplia sozinho ao avançar.
- **Armazenamento**: favoritos, recentes e coleções salvas ficam em `localStorage` sob `eternnus.prep.user.{usuário}.{campanha}`, só com chaves `tipo:id`, datas e critérios (nenhum texto da campanha). São podados quando o item deixa de existir. Valem só neste navegador; leitura/escrita indisponível não quebra o gerenciador.
- **Servidor**: `GET /prep/explorer` passou a projetar `hasText` em cada cena (só o booleano; texto compartilhável e notas privadas continuam fora da lista). Sem migração.

### 7.2 Editor de tiles: pincel, preenchimento, substituição e mistura (ADR-085, 16/11/2026)

Regras puras em `js/tile-map-policy.js` (`brushFootprint`, `strokeCells`, `floodCells`, `matchCells`, `setCells`, `replaceTiles`, `variantCode`, `canMix`, `codeCounts`), testadas em `tests/tile-tools-policy.test.mjs`.

| Ferramenta | Comportamento |
| --- | --- |
| **Tamanho do pincel** (Paleta › Pincel e borracha; `[` e `]`; Editar › Pincel maior/menor/redondo) | 1, 2, 3 ou 5 casas por lado, quadrado ou redondo (redondo vale a partir de 3: 3 = cruz, 5 = disco de 21 casas). Vale para pincel e borracha; tamanhos pares crescem para a direita/baixo. O contorno aparece sob o cursor antes de pintar. Preferência local (`eternnus.tiles.brush`). |
| **Preenchimento** (G) | Área contígua (4 vizinhos) de casas iguais **na camada que recebe o tile**, como antes. Clicando dentro de uma seleção, fica limitado a ela. A partir de 250 casas (`LARGE_OPERATION`) as casas atingidas ficam destacadas no mapa e o editor pede confirmação com a contagem. |
| **Substituir tile…** (Editar; botão direito numa casa ou na seleção) | Troca todas as casas de um tile por outro na camada ativa inteira ou só na seleção. "Por" aceita "Vazia (apagar)" fora da Base; a Base nunca fica vazia. As casas que mudam ficam destacadas no mapa enquanto a janela está aberta, com a contagem ao lado. |
| **Mistura de tiles** (Paleta › Mistura de tiles) | Até 8 tiles da mesma camada automática (só terrenos, ou só natureza/construções/objetos; entradas do grupo nunca). Com "Pintar com a mistura", pincel, retângulo, preenchimento e "Preencher seleção" sorteiam um tile por casa com hash determinístico (casa + semente); "Nova variação" muda a semente. O catálogo não tem variantes do mesmo tile: a variação é entre tiles diferentes escolhidos pelo mestre. |
| **Região** | Seleção de área (M) + Preencher seleção, Excluir seleção, Substituir na seleção e preenchimento limitado à seleção. |

Toda operação é uma única entrada do histórico. A semântica das camadas não muda: o tile vai para a camada indicada pela camada automática (ou a ativa), `_` continua sendo vazio, a fusão/regras/entradas seguem `mergeLayers`. A repintura continua parcial (ADR-082): o tabuleiro compara as grades e redesenha só as casas afetadas; operações grandes (mais de ⅓ das casas) caem no caminho de redesenho completo em fatias que já existia.

### 7.3 Assistente de alinhamento da grade (ADR-085, 16/11/2026)

Faz parte do ajuste compartilhado `js/grid-adjust.js`, então aparece em todos os lugares que já ajustavam a grade (envio/importação de mapa, Ajustar grade do acervo e editor de cenas), sem mudar os chamadores. Regras puras em `js/grid-align-policy.js` (`tests/grid-align-policy.test.mjs`).

1. **Marcar** a referência na prévia (aproximar com + para precisão; arrastar continua movendo a vista; um clique sem arrastar marca o ponto):
   - **Marcar uma casa**: dois cantos opostos de uma casa → lado = média de largura e altura; deslocamento = canto superior esquerdo módulo o lado. Avisa se a casa marcada não for quadrada (> 10% ou 2 px).
   - **Marcar N casas**: dois cruzamentos de linhas na mesma linha ou coluna + número de casas entre eles (1–100) → lado = distância ÷ N arredondado; mostra o desvio acumulado quando a casa real tem fração de pixel.
   - **Detectar automaticamente**: autocorrelação dos perfis de borda (diferença de brilho entre colunas numa faixa horizontal de 384 px e entre linhas numa faixa vertical, na resolução real da imagem). Escolhe o menor período com pico ≥ 85% do maior (evita múltiplos), informa a certeza e recusa (sem inventar) quando não reconhece grade. Imagens que o navegador não deixa ler mostram a orientação para marcar à mão.
2. **Conferir**: o resultado é aplicado à prévia (linhas douradas e "N × M casas" validados por `gridFor`, a mesma conta de `CampaignMapView.Grid`), sem gravar nada.
3. **Confirmar** com "Usar este alinhamento", ou **Cancelar** (Esc) para voltar aos valores anteriores. Os controles de tamanho/alinhamento continuam para o ajuste fino.

Grava pelos campos existentes (`gridPixels`, `gridOffsetX`, `gridOffsetY`, `scaleMeters`); sem migração e sem contrato novo. Se o formulário do chamador for enviado com o assistente aberto, valem os valores visíveis na prévia.

**Hexagonal e isométrica — não implementadas.** O servidor e o cliente assumem casas quadradas em toda a cadeia: `CampaignMapView.Grid`, `FogGrid` (linha de visão por passo inteiro entre centros, `Reach` circular em casas), `FogRules.PathLength` (8 vizinhos, diagonal custo 1, regra de canto), `ScenePrep.ValidateTokens`, movimentação livre (`FinePositions`), alcance de ataque, máscara de imagem por casa, bitsets de exploração (`Bits`, índice `y × largura + x`), paredes por casa (`Cells`) e o desenho de `table-map.js`/`fog-policy.js`. Uma grade não quadrada exige: (1) um tipo de grade versionado no mapa (`GridKind` + orientação, migração aditiva com padrão `square`); (2) um sistema de coordenadas próprio (axial/cúbico para hex; losango para isométrica) com conversão pixel ↔ casa no servidor e no cliente; (3) vizinhança de 6 casas e distância hex nas regras de caminho, alcance, luz e visão, com linha de visão por amostragem de centros; (4) máscara de névoa por polígono da casa; (5) ajuste de `TableFog.Fit`, importação UVTT e edição de tiles (os tilesets oficiais são quadrados). Apresentar só o desenho hexagonal sem essas regras faria a mesa calcular distância e visão diferentes do que o jogador vê — por isso o assistente oferece só a grade quadrada.

### 7.4 Rascunho local, conflitos e versões (ADR-083, 16/11/2026)

**Rascunho local (neste navegador).** Os três editores (tiles, imagem, cena — inclusive a preparação só do mapa) guardam o documento em edição no IndexedDB (`js/editor-drafts.js`; regras puras em `js/draft-policy.js`):

| Regra | Valor |
| --- | --- |
| Chave | usuário + campanha + tipo (`tilemap`, `imagemap`, `scene`, `maplayer`) + documento (`new` antes do primeiro salvamento) |
| Conteúdo | o mesmo instantâneo do desfazer + revisão de origem + data; sem credenciais, e-mails ou bytes de imagem (imagens-fonte por `asset:{id}`) |
| Quando grava | ~2 s depois da última mudança; ao esconder ou fechar a página; ao fechar o editor sem ser por "Fechar sem salvar" |
| Quando apaga | documento salvo (sem alterações pendentes), "Fechar sem salvar" confirmado, sair da conta, 30 dias, além de 30 rascunhos por usuário |
| Limite | 8 MiB por rascunho (acima disso a barra de estado avisa e nada é gravado) |

- Ao abrir um documento com rascunho diferente do salvo: aviso "Rascunho local não salvo" com **Restaurar rascunho**, **Descartar** e **Decidir depois** (Arquivo › Rascunho local… reabre; enquanto isso o rascunho automático fica pausado para não sobrescrever o anterior).
- Restaurar entra no histórico de desfazer e mantém a **revisão de origem**: se o documento foi salvo depois (outra aba, outro dispositivo), salvar mostra o conflito em vez de sobrescrever.
- Barra de estado: "Salvo às hh:mm" ou "Rascunho local hh:mm".
- Outra aba com o mesmo documento: mensagem ao abrir e quando a outra aba salva (`BroadcastChannel`).
- Falha do IndexedDB (modo privado, cota) nunca bloqueia o editor; só não há rascunho.

**Conflitos (409 de revisão).** Nunca há sobrescrita silenciosa. Tiles: Recarregar / Salvar como cópia / Continuar editando. Imagem: Continuar editando / Recarregar. Cena: Continuar editando / **Salvar como nova cena** (grava a cena numa cópia na mesma pasta e passa a editá-la; a preparação do mapa continua pendente) / Recarregar. Em todos, **Recarregar** guarda antes o rascunho, que continua em Arquivo › Rascunho local….

**Versões persistentes (servidor).** Arquivo › Versões… (mapa de tiles, mapa de imagem e cena já salvos):

- Cada salvamento registra uma **versão automática** (deduplicada por conteúdo; ficam as 20 mais recentes). O mestre **guarda a versão salva atual com nome** (até 20 por documento, 1–80 caracteres) ou nomeia uma automática.
- **Carregar** coloca a versão no editor como alteração desfazível; nada muda até **Salvar**, que segue as regras de sempre (revisão, mapa na mesa, preparação/cenas do mapa de tiles).
- Mapa de imagem: a versão guarda a composição e a grade, nunca a imagem achatada. Imagens-fonte usadas por versões retidas não são apagadas ao salvar; saem quando nenhuma versão retida nem o documento as usam. Mapas antigos sem composição precisam ser salvos no editor antes da primeira versão nomeada.
- Cena: a versão guarda nome, textos, notas privadas, cenário, visibilidade, alcance, ordem, arranjo e camadas. Não guarda a preparação do mapa (paredes, luzes, névoa), posições "Retomar" nem exploração.
- Excluir o mapa ou a cena exclui as versões. Não confundir com o painel Histórico (desfazer da sessão de edição).

## 8. Segurança e sessão

- Nada do editor apresenta ou aplica à mesa: salvar grava a preparação; apresentar/aplicar continuam ações explícitas (`POST …/scene`, `…/scene/apply`).
- Editar um mapa na mesa continua recusado (409). A imagem achatada é a única que chega aos jogadores, com a máscara de névoa; `terrain` é mascarado como `rows`.
- Elementos fora do artboard não alteram grade, movimento ou visibilidade (a grade vem do artboard).
- Imagens-fonte só são lidas pelo mestre (`ImageAsync` exige o mapa em sessão ativa para jogadores; imagem-fonte nunca está).

## 9. Verificação e limitações (15/11/2026)

- Unitários: `node --test tests/*.test.mjs` (inclui `editor-policy`, `prep-explorer-policy`, `tile-map-policy`, `composition-policy`, `scene-editor-policy`, `help-catalog`, `pwa`); .NET filtrado (`PrepWorkspace`, `CampaignAssets`, `SceneEditor`, `TableFog`, `TablePlay`, `SessionService`, `UploadLimits`, `Workspace`, `Progression`).
- Navegador (Chrome headless, app em `SqliteTest` de desenvolvimento): gerenciador nas três raízes, criação (tiles vazio, modelo de tiles, cartografia oficial, área em branco, pasta), cena a partir de mapa com a ordem de grupos, cena do zero, editores de tiles/imagem/cena (roda com zoom no cursor, pintura e desfazer, menu de contexto, propriedades, camada extra, imagem parcialmente fora da área visível, texto, salvar e reabrir pela API), menus de contexto de itens e geometria do editor em 390 × 844.
- Não executado aqui: integrações com PostgreSQL e Playwright (`tests/tile-map-editor.mjs`, `tests/help-ui.mjs`, `tests/table-viewport.mjs`, `tests/scene-editor.mjs`), atualizados para os seletores novos; a migração `PrepWorkspace` não foi aplicada a um PostgreSQL real.
- Limitações: arrastar itens no gerenciador funciona com mouse; no toque use "Mover para…". O seletor "A partir de mapa" tem uma busca e um filtro para os três grupos. A ferramenta Zoom dos editores aproxima pelo centro (a roda aproxima no cursor). No editor de cenas, "Colocar no cursor" usa a última casa apontada. Camadas de cena duplicadas começam vazias (uma casa comporta um marcador). Imagens-fonte sem uso são removidas ao salvar: o histórico do editor de imagem é zerado após salvar.

## 10. Composição da cena, pontos de entrada e entrada de imagens (ADR-090, 16/11/2026)

| Entidade | Campo novo (migração `SceneComposition`, aditiva) | Uso |
| --- | --- | --- |
| `Scene` | `Composition`, `OverlayId`, `Entry` | Imagens só da cena (mesmo documento da composição de mapas), sobreposição achatada para a mesa e área de entrada (`{ref}` ou `{x,y,w,h}`). |
| `CampaignMap` | `OwnerSceneId`, `Entries` | Imagens-fonte e sobreposições da cena (propósito `layer`, só o mestre lê) e pontos de entrada do mapa. |
| `GameSession` | `OverlayId` | Sobreposição em uso na mesa (instantâneo de apresentar, reiniciar ou aplicar). |

- `EditorLayer` e `CompositionElement` aceitam `secret` opcional ("Só o mestre vê"); mapas descartam o campo.
- Editor de mapas de imagem: soltar arquivos no mapa, colar com Ctrl+V, "Adicionar imagem" com vários arquivos e painel **Acervo** (arrastar ou Adicionar). Cada imagem vira imagem-fonte do mapa, no tamanho natural, selecionada. Salvar com o mapa na mesa continua recusado (o rascunho fica aberto).
- Preparação do mapa (`kind: "layer"`): ferramenta **Área de entrada** cria pontos de entrada; painel com nome, tipo e exclusão; salvos com "Salvar preparação" (`PUT /assets/entries`, revisão do mapa).
- Módulos novos: `js/image-drop.js` (validação PNG/JPEG ≤ 10 MB, até 12 por vez, soltar, colar, acervo) e `js/scene-composition.js` (controlador da composição sobre `composition-canvas.js`). O núcleo (`editor-core.js`) não bloqueia mais a colagem nativa em Ctrl+V; `createCompositionSurface` aceita um cache de imagens externo; `flattenComposition` aceita fundo transparente. Contexto novo `compose` ("Composição") em `EDITOR_CONTEXTS`.
- Contratos em [API.md](API.md); fluxo do mestre em [CENAS_EDITOR.md](CENAS_EDITOR.md); decisão em ADR-090.

## Grade, envio e mapas inseridos (19/11/2026, ADR-112/113)

O assistente de alinhamento (§7.3) ganhou zoom sob o cursor, lupa, ajuste fino, tamanhos comuns, voltar ao alinhamento anterior/detectado e a prévia `grid-impact` antes de aplicar. O envio de imagens (§10) usa um fluxo único em `image-drop.js` nos dois editores. A composição da cena aceita instâncias de mapa (`mapKey`) encaixadas na grade global; regras do original só entram por "Trazer paredes, portas e luzes deste mapa". Ver [EVOLUCAO_VTT_TOKENS_MAPAS_UX.md](EVOLUCAO_VTT_TOKENS_MAPAS_UX.md).

## Dicas na barra de propriedades (ADR-124, 20/11/2026)

Sem seleção, a barra de propriedades dos editores de cena, de preparação do mapa e de mapa de imagem mostra dicas do catálogo `js/editor-tips/`. A escolha considera o contexto de trabalho, a interface Básica/Completa e o nível de intimidade do mestre, calculado só neste navegador. A dica troca a cada 30 s com pausa no ponteiro ou no foco. Há anterior/próxima, **Experimentar** (ativa a ferramenta citada) e "Próxima dica do editor" na Busca de ações. API: `shell.contextBar.tips` (`show`, `hide`, `refresh`, `record`, `next`). O núcleo registra ferramentas usadas, contextos visitados e aberturas. Detalhes e limites na ADR-124.
