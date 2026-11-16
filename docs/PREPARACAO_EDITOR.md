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
| GET `/api/campaigns/{id}/prep/explorer` | `{folders:[{id,name,parentId,category}], scenes:[…], maps:[…], characters:[…], activeSessionId, archived, limits}`. Listas limitadas pelos limites de domínio, projetadas. Mapas: campos de `CampaignMapView` + `summary, sourceKey, origin ('tiles'|'image'), createdAt, updatedAt, scenes (cenas que usam), inUse`. Cenas: `id,name,description,kind,mapKey,mapName,layerMode,visionMode,prepared,hasSaved,current,order,revision,folderId,createdAt,updatedAt`. Personagens: `id,name,summary,kind,side,copy,sharedWithPlayers,imagePreview,templateName,folderId,revision,createdAt,updatedAt`. Retratos, imagens-fonte e cenários oficiais não aparecem. |
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
- `renderLayersPanel`: lista de camadas (olho, cadeado, opacidade, renomear, ordem, nova, duplicar, excluir extras, mover elemento para camada).
- `bindEditorKeys`: atalhos (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Ctrl+C/X/V, Ctrl+D, Ctrl+S, Delete, Esc, Ctrl+0, Ctrl+1, Ctrl+±, letras das ferramentas) que nunca disparam dentro de campos de texto, exceto Ctrl+S e Esc.

Navegação: roda do mouse = zoom centrado no cursor; espaço + arrastar e botão do meio = mover a vista; pinça no toque; ferramenta Mão. O tabuleiro da mesa (`createBoard`, opção `editor`) e a superfície de composição (`js/composition-canvas.js`) implementam a mesma navegação. A câmera nunca muda as coordenadas dos elementos.

Interface Básica/Completa: a Básica mostra as ferramentas essenciais e esconde grupos avançados e painéis secundários; nada nos dados ou nas regras muda.

Réguas, dicas e tamanho (16/11/2026):

- **Réguas** superior e esquerda, discretas (18 px), desenhadas pelo núcleo a partir de `camera.ruler()` de cada editor → `{ x, y, cellPx, cellUnits, unit }` (origem em coordenadas da janela, pixels de tela por casa, metros por casa). Valem em metros pela grade: 0 no canto do mapa (tiles e cenas) ou na primeira linha da grade (imagem); valores negativos na área externa. Marcas maiores a cada 1, 2, 5, 10… casas com pelo menos 56 px (`rulerSteps`, `editor-policy.js`), menores por casa; linha dourada na posição do cursor. Mapa de imagem sem grade mostra pixels. Cena textual não mostra réguas. Liga/desliga em Exibir › Réguas (preferência local); ocultas no celular. Só redesenham quando a vista, o tamanho ou o cursor mudam.
- **Dicas das ferramentas**: ao passar o mouse (400 ms) ou focar pelo teclado, a dica compartilhada de `help.js` abre ao lado da barra com o nome e o atalho em destaque e, em letras menores, o que fazer com a ferramenta (`tool.tip`; na cena, o texto de `scene-policy.HELP`). Ferramenta indisponível mostra o motivo. Não abre por toque.
- **Área visível**: fica centralizada no palco com a área externa escura em volta. O tamanho na barra de estado é um botão que abre o diálogo de tamanho (mapa de tiles: Tamanho do mapa; imagem: Tamanho do documento).

## 7. Fluxos

- **Novo mapa** → "Criar do zero" (enviar imagem, importar URL, arquivo VTT, mapa vazio com tiles, área em branco) ou "A partir de modelo" (catálogo oficial com miniaturas, busca, filtro por tipo e prévia ampliada). Um modelo de tiles vira mapa de tiles editável (camadas preservadas, nada é rasterizado); a cartografia oficial vira mapa de imagem. O original nunca é alterado. Após criar, o editor abre.
- **Nova cena** → "Do zero" (abre o editor de cena sem mapa; textual ou visual) ou "A partir de mapa" (seletor em três grupos nesta ordem: mapas próprios criados do zero/importados, mapas criados de modelos, modelos oficiais). A cena referencia o mapa (sem cópia de bytes).
- **Personagens**: abrir ficha, editar, duplicar, cópia de encontro, história, organizar em pastas. No editor de cena, o painel Personagens permite arrastar para o canvas.

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
