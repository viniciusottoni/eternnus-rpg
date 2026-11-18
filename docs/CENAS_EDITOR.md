# Editor de cenas, mapas e cenários — interface Básica e Completa

Fonte de verdade da preparação e do uso de cenas. Desde a ADR-081 o editor roda sobre o núcleo gráfico comum e as cenas são criadas e organizadas no gerenciador da Preparação ([PREPARACAO_EDITOR.md](PREPARACAO_EDITOR.md)). Complementa [CONDUCAO_MESA.md](CONDUCAO_MESA.md), [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md), [API.md](API.md) e a decisão ADR-048 em [DECISOES.md](DECISOES.md).

## Três escolhas independentes

| Escolha | O que muda | Onde fica |
| --- | --- | --- |
| **Interface Básica/Completa** | Só a apresentação das ferramentas do mestre. | `AppUser.InterfaceMode` (`basic`/`complete`; nula = Básica). |
| **Condução Livre/Turnos/Tática** | Regras da partida. | `TableSettings.PlayMode` → `GameSession.PlayMode`. |
| **Visibilidade** | O que os jogadores recebem. | `Scene.VisionMode` + camada do mapa + configuração da mesa. |

Nenhuma escolha altera as outras. A Básica funciona também em partidas táticas. Trocar a interface:

- acontece na hora, sem recarregar a página, a sessão ou o editor;
- preserva seleção, mapa, rascunhos, campos digitados e alterações não salvas;
- não salva, não publica, não descarta e não muda regras nem visibilidade;
- não muda nada para os jogadores (eles não têm esse controle).

Recursos avançados continuam ativos com os controles ocultos. A Básica mostra "Ajustes avançados ativos (N) · ver" com a lista (marcas, focos de luz, névoa própria do mapa, preparação própria da cena, luz ou detecção em marcadores) e o atalho "Mostrar na interface Completa".

## Inventário das ferramentas

A Básica aparece sempre primeiro e na mesma posição; a Completa acrescenta grupos depois dela (`TOOL_INVENTORY` em `js/scene-policy.js`, testado contra `fog-policy.js` e `SessionFog.cs`).

| Ferramenta | Editor | Mesa | Básica | Completa (grupo) |
| --- | --- | --- | --- | --- |
| Selecionar e mover | ✓ | ✓ | ✓ | Elementos |
| Adicionar personagem ou marcador | ✓ | ✓ | ✓ | Elementos |
| Personagens do mestre e cópias de encontro | ✓ (lateral "Adicionar") | ✓ (Adicionar → Personagem do mestre) | ✓ | Elementos |
| Mostrar/ocultar elemento | ✓ (propriedades) | ✓ (Luz, visão e ocultação) | ✓ no editor | Elementos |
| Remover marcador | ✓ (propriedades) | ✓ (com marcador selecionado) | ✓ | Elementos |
| Luz, visão, sentidos e detecção do marcador | — | ✓ | — | Luz e visão |
| Parede, bloqueia só movimento, bloqueia só luz, porta, abrir/fechar porta, liberar casa | ✓ | ✓ | — | Paredes e portas |
| Parede vetorial (por pontos, diagonais, tipos), Editar paredes (vértices, dividir, unir, área, converter casas) | ✓ | abrir/fechar porta vetorial | — | Paredes e portas |
| Diagnóstico de visão | ✓ | — | — | Luz e visão |
| Foco de luz, névoa neste mapa | ✓ | ✓ | — | Luz e visão |
| Visibilidade (tudo visível, revelação manual, por personagem) | ✓ | — (vem da cena) | ✓ | Exploração |
| Revelar área / Cobrir área | ✓ (com revelação manual) | ✓ ("Revelar área", com névoa ativa) | ✓ | Exploração |
| Marca oculta e formas de revelação | ✓ | ✓ | — | Exploração |
| Recomeçar exploração | ✓ (ao salvar, mapa fora da mesa) | ✓ | — | Exploração |
| Ver como jogador | ✓ (simulação) | ✓ (prévia real) | ✓ | Exploração |
| Mostrar grade / ajustar grade e escala | ✓ | ✓ (mostrar) | — | Grade e escala |
| Escolher cenário, texto compartilhável, notas privadas | ✓ | — | ✓ | Configuração da cena |
| Tipo, ordem, descrição, alcance da preparação | ✓ | — | — | Configuração da cena |
| Configuração da mesa | — | ✓ | — | Configuração |
| Guardar posições atuais como arranjo inicial | — | ✓ (Cenas → Mais opções) | — | Elementos |

Barra inferior do mestre: **Cenas, Pedir teste, Rolar, Nota** e controles de turno quando a forma usa turnos; **Ficha** só na Completa (os cartões do grupo também abrem fichas). **Encerrar** fica separado, à direita do topo.

## Recurso, preparação e apresentação

| Camada | Propriedades | Onde |
| --- | --- | --- |
| **Recurso original** | Bytes da imagem, grade (lado, deslocamento, escala), com ou sem grade, nome, pasta. Tilesets oficiais. | `CampaignMap`, `BattleMaps`. Nunca copiado entre cenas. |
| **Preparação da cena** | Nome, tipo, cenário, texto, notas privadas, visibilidade, ordem, descrição, alcance da camada, arranjo de marcadores (`Prepared`). | `Scene`. |
| **Preparação do mapa** | Paredes, portas (estado inicial), luzes, marcas ocultas, névoa do mapa, casas reveladas de início. | `CampaignMapLayer.State` (estrutura) ou `.Prepared` (pendente). |
| **Apresentação (ao vivo)** | Nome e texto apresentados, mapa e camada em uso, marcadores da sessão, explorações, revelações e portas da partida, percepções. | `GameSession.SceneName/SceneText/LayerKey/MapKey`, `SessionToken`, `CampaignMapLayer.State`. |

Regras:

- **Salvar preparação** grava `Scene` e a preparação do mapa. Nunca altera a mesa ao vivo.
  - Com a camada fora da mesa, a estrutura vale para as próximas apresentações. Explorações e percepções continuam.
  - Com a camada na mesa, a preparação fica em `CampaignMapLayer.Prepared` e o estado ao vivo não muda. "Recomeçar exploração" pelo editor é recusado nesse caso.
- **Aplicar à cena atual** (`POST …/scene/apply`) aplica só as partes marcadas: nome e texto; visibilidade; paredes, portas, luzes e marcas.
  - Preserva posições, criaturas, explorações, portas abertas ou fechadas onde continua havendo porta e as percepções de marcas.
  - Casas reveladas na preparação **somam-se** às reveladas; aplicar nunca cobre o que o grupo viu.
  - **Recolocar os marcadores no arranjo preparado** é opcional e vem desmarcado. Personagens voltam às posições preparadas (sem posição, entram pelos pontos de entrada) e criaturas fora do arranjo saem da mesa. A exploração continua.
  - A troca de cenário só vale com **Reiniciar cena**: "Aplicar" mostra o atalho "Reiniciar cena com o novo cenário…", com confirmação, na mesa e no editor.
- Ações executadas na mesa (mover, abrir porta, pintar névoa) são **ao vivo**. A paleta mostra "Ao vivo: os jogadores veem as mudanças."
- Conflitos: o editor envia a revisão da cena e `prepVersion` (hash da preparação, que não muda com explorações). Revisão obsoleta → 409 com a mensagem. O rascunho fica na tela, com "Continuar editando" ou "Recarregar a versão salva".

Indicações persistentes (texto, não só cor):

- "Prévia privada — somente você vê."
- "Em apresentação — os jogadores estão vendo esta cena."
- "Alterações não salvas".
- "Alterações não aplicadas à mesa." (editor, painel Cenas e aviso sobre o mapa da mesa).

## Fluxos

### Preparar sem apresentar

1. Na **Preparação** da campanha (Novo › Nova cena, ou duplo clique numa cena) ou na aba **Cenas** da mesa, use "+ Nova cena" ou "Editar preparação". O editor abre em **Selecionar e mover**, nunca numa ferramenta que pinte.
2. Escolha o tipo (mapa com grade, imagem sem grade, apresentação textual) e o cenário por miniatura.
3. Posicione personagens e marcadores na prévia central. O servidor valida o arranjo (`ScenePrep.ValidateTokens`):
   - até 60 marcadores, dentro da grade, fora de casas que bloqueiam movimento e sem dois na mesma casa (em mapa de movimentação livre, a casa pode ser dividida e o ponto exato é guardado);
   - personagens vinculados à campanha e personagens do mestre da campanha.
4. Ajuste visibilidade, texto e notas e use **Salvar preparação**.

### Apresentar, retomar e reiniciar

| Ação | Marcadores | Paredes, portas, luzes, marcas | Revelações e exploração | Texto mostrado |
| --- | --- | --- | --- | --- |
| **Apresentar** (primeira vez) | Arranjo preparado | Estado atual da camada | Mantidas | O da cena, agora |
| **Retomar** | Estado salvo da última visita | Estado atual da camada (inclusive mudanças ao vivo) | Mantidas; preparação pendente não é aplicada | O da cena, agora |
| **Reiniciar** | Arranjo preparado | Preparação (inclusive a pendente) | Zeradas: revelações, explorações e percepções | O da cena, agora |

- Ao sair de uma cena com grade, as posições atuais são salvas (`Saved`) para "Retomar". Isso vale também para a troca improvisada.
- Personagens sem posição válida entram pelos pontos de entrada. Criaturas em casas inválidas ou ocupadas são descartadas.
- Fichas, conversa, rolagens e histórico nunca mudam.
- A visibilidade da cena é aplicada ao apresentar e ao aplicar.
- Cenas podem ser apresentadas fora da ordem.

### Improvisar

- **Usar outro cenário agora**: picker → "Apresentar agora". A cena atual guarda seu estado e deixa de estar em apresentação.
- **Salvar como cena**: grava o cenário e as posições atuais como cena (`POST …/scene/save-as`), sem cadastro prévio.

## Reutilização do mesmo mapa entre cenas

`Scene.LayerMode`:

- **`map` (compartilhada, padrão e comportamento anterior):** a cena usa a camada do mapa (`MapKey`), a mesma da ação "Preparar névoa e luz" do mapa e de outras cenas compartilhadas. A exploração também é compartilhada. O editor mostra "Compartilhada com: …".
- **`scene` (própria):** camada `{mapa}@{cena}`.
  - Começa com a preparação da camada compartilhada, sem explorações, e segue independente.
  - A imagem não é duplicada.
  - Duplicar a cena copia a preparação (sem exploração). Excluir a cena remove só a camada dela.

Trocar o alcance exige salvar antes de editar a camada. É recusado com a cena em apresentação. Editar uma cena nunca altera outra cena nem a mesa ao vivo.

## Cenários e imagens

- Seletor único (`js/map-picker.js`) no editor, no improviso e no início da sessão. Oferece:
  - miniaturas reais, nome e tipo explicado;
  - busca sem acentos;
  - grupos Recentes, Cenários prontos e Mapas da campanha.
- Na Completa, o seletor também filtra por tipo e pasta.
- Escolher só muda a seleção e a prévia. A seleção atual nunca some da busca.
- Upload com **Apenas imagem** (`HasGrid = false`), **Usar grade** ou **Movimentação livre** (`FreeMovement`, ADR-074): a prévia aparece antes dos números.
  - Movimentação livre: personagens e criaturas ficam em qualquer ponto da imagem e podem dividir a mesma casa. A grade ajustada é só referência de escala, paredes, luz e névoa e fica oculta na mesa (Mostrar grade a exibe). Na forma tática, o alcance é um círculo medido em linha reta.
  - Ajuste visual de tamanho e alinhamento, com resultado imediato ("N × M casas"; faixas fora da grade escurecidas).
  - Números exatos na Completa. Escala explicada ("cada quadrado representa N metros").
- Grade autoritativa: `CampaignMapView.Grid(largura, altura, lado, deslocX, deslocY)` = casas inteiras a partir do deslocamento. Mesma conta em `gridFor` (cliente) e na máscara de imagem do servidor.
- Cena **Imagem sem grade** aceita imagens da campanha (com ou sem grade) e cartografia oficial.
  - O jogador só recebe a imagem enquanto ela está apresentada (`ImageAsync` exige a sessão ativa com aquele mapa).
- Imagem sem grade nunca vira mapa tático (400).
- Tirar a grade de um mapa usado por cena com grade é recusado (409).

## Ver como jogador

- **Mesa:** prévia real (`GET …/view?as=`), idêntica ao payload daquele jogador. Exige jogador na sessão.
- **Editor (ADR-088):** prévia real calculada pelo servidor (`POST …/prep/preview-view`) sobre a preparação ainda não salva, com as mesmas regras da mesa: paredes por casa e vetoriais, luzes e penumbra, visão e sentidos da ficha, detecção por Percepção e áreas já exploradas gravadas na camada. "Visão de": só luz comum, o grupo inteiro ou um personagem posicionado. Não grava nada. Se o servidor não responder, o editor mostra a simulação local abaixo, com aviso.
- **Simulação local (reserva):** regras de `FogRules` no cliente (`simulateView` em `scene-policy.js`), escolhendo "Visão de" entre os personagens posicionados ou "Grupo — só luz comum e áreas reveladas".
  - Tudo visível: sem névoa.
  - Revelação manual: só as casas reveladas (luz e visão não revelam).
  - Demais modos: focos do mapa, luz dos marcadores não ocultos (ficha, padrão da mesa ou ajuste do marcador), casas reveladas e a visão da ficha do personagem escolhido, convertida pela escala do mapa.
  - Marcadores: personagens e aliados (com "Aliados sempre visíveis") aparecem; criaturas só em casa visível; ocultas nunca.
  - Não inclui sentidos especiais, detecção por Percepção nem o que o grupo já explorou na partida. A visão exata de um jogador continua em "Ver como" na mesa.

## Visibilidade honesta

"Cobrir área" retira só a revelação manual. Casas iluminadas ou vistas por personagens continuam visíveis. O que um jogador já viu não é apagado da memória dele, nem dos bytes de imagem já entregues. A interface explica isso junto da ferramenta.

## Celular

- Editor em tela cheia, com ferramentas numa faixa horizontal e "Categoria" para uma categoria por vez na Completa. Prévia e lateral seguem empilhadas.
- Mesa:
  - na vista Mapa, o tabuleiro vem logo após o topo; o grupo do mestre fica na aba Grupo e o do jogador desce para baixo do mapa;
  - aviso de pendência numa linha ("Alterações não aplicadas à mesa." + "Revisar e aplicar…"), com o detalhe no diálogo;
  - trilho do mestre horizontal no topo do mapa;
  - "Cenas" abre a vista do painel;
  - alvos principais de 44 px e área segura respeitada.

## Limitações

- A simulação local (reserva) não inclui sentidos especiais, Percepção nem explorações anteriores; a prévia real do servidor inclui.
- Trocar o cenário de uma cena em apresentação exige "Reiniciar cena" (recomeça a exploração daquele cenário).
- No celular, a barra inferior fixa (vez, ações e navegação) ainda cobre a faixa de baixo do mapa até rolar.
- Mapas com a grade ajustada depois de preparados: paredes e névoa seguem as casas (`TableFog.Fit`). Marcadores fora da nova grade saem da preparação.
- Movimentação livre: faixas da borda menores que uma casa de referência ficam fora da área jogável; a simulação do editor usa a casa do marcador. Voltar o mapa para "Usar grade" faz a mesa usar o centro da casa e exigir uma casa por marcador.
- A preferência de interface é por conta, não por dispositivo.
- Sem medição de carga nem teste em aparelho físico.


## Câmera e identidade móvel (ADR-057)

Editor de cenas e preparação de mapas/cenários compartilham câmera com a mesa: mapa ampliado em telas compactas, arraste local, pinça de dois dedos limitada e Mapa inteiro. Topo/ferramentas rolam na horizontal; Propriedades abre/recolhe a lateral sem desmontar o formulário. Toque duplo simultâneo cancela traço/arraste pendente, sem salvar ou apresentar. Ajuste de grade tem zoom de prévia 1–4×. Valores e operações de salvar/aplicar continuam nos contratos existentes.

## Editor sobre o núcleo gráfico (ADR-081)

- Menus Arquivo, Editar, Cena, Camada e Exibir; ferramentas por ícone à esquerda (Básica primeiro, grupos da Completa depois); painéis Propriedades, Camadas, Estrutura, Personagens e Histórico à direita; barra de estado com zoom, casa sob o cursor e estado.
- Botão direito num marcador: editar propriedades, duplicar, copiar, recortar, excluir, ocultar/mostrar aos jogadores, mover para camada. Numa casa vazia: adicionar marcador, colocar personagem, colar, foco de luz, marca oculta, revelar/cobrir.
- Personagens e criaturas podem ser arrastados do painel Personagens para o mapa, com a mesma validação de "Colocar aqui".
- Camadas da cena (Base = mapa, Elementos e extras) organizam marcadores; olho, cadeado e opacidade valem só no editor. "Oculto" continua sendo o controle do que os jogadores veem.
- Desfazer/refazer cobre arranjo, textos, camadas e a preparação do mapa da sessão de edição. Salvar, aplicar, apresentar e reiniciar continuam ações explícitas.


## Paredes vetoriais, diagnóstico e revisão antes de aplicar (ADR-087/088)

- **Parede vetorial** (J): cliques sequenciais; Enter, duplo clique ou clicar de novo no último ponto termina; clicar no primeiro ponto fecha a sala; Esc desiste. Ímã em vértices, paredes e cantos/meios das casas (tolerância fixa na tela); Shift trava 0/45/90°; Alt desliga o ímã. O tipo do próximo traço (parede, porta, janela, só visão, só movimento) e "Não mostrar aos jogadores" ficam no painel.
- **Editar paredes** (Q): clique seleciona (Shift soma), arrastar vértice move todas as pontas ligadas a ele, arrastar o segmento move a seleção (passos de 1/10 de casa; Alt = 1/100), arrastar no vazio seleciona por área, Alt+clique divide. Painel e barra contextual: tipo, oculta, porta aberta, pontas em casas com duas casas decimais, comprimento em metros, dividir, remover vértice, unir colineares, duplicar e excluir. Delete apaga; tudo entra no desfazer/refazer.
- **Converter casas em paredes**: cria o contorno das casas de parede/só luz/só movimento como segmentos; as casas continuam marcadas.
- **Diagnóstico de visão**: hachura em casas que bloqueiam movimento, azul nas sem luz comum, traço por tipo e lista de problemas com coluna/linha. Só no editor.
- **Aplicar à cena atual**: o painel lista as diferenças do mapa em relação à mesa ("2 paredes novas", "1 luz alterada"…) antes de aplicar; portas abertas/fechadas, posições e exploração continuam.
- **Mesa**: "Abrir ou fechar porta" também alcança a porta vetorial mais próxima da casa clicada.
- Limitações: sem curvas (use vários segmentos); sem teste em navegador real e em toque nesta entrega; a prévia real exige rede.

## Composição da cena, início visual e posições iniciais (ADR-090)

- **Cena nova sem fundo:** o palco mostra "Como deseja começar?" (enviar imagem, escolher mapa existente, usar um modelo, área em branco) e aceita arquivos soltos em qualquer ponto ou colados com Ctrl+V. A primeira imagem pergunta **Usar como fundo da cena** (padrão) ou **Adicionar como elemento independente**, e o uso: **Movimentação livre** (padrão, grade técnica oculta), **Movimentação tática** ou **Somente apresentação**. O fundo vira um mapa da campanha (Preparação › Mapas), associado à cena sem sair do editor.
- **Contexto Composição** (primeiro contexto do editor de cenas): imagens só desta cena por cima do mapa. Selecionar mostra contorno, alças laterais e de canto, alça de giro, dimensões durante o arraste e a barra de propriedades (X, Y, largura, altura, manter proporção, giro, opacidade, camada, Só o mestre vê, bloqueio) com Ajustar (imagem inteira), Preencher (cobre e pode recortar), Tamanho original, Centralizar, espelhar, duplicar, frente/trás e excluir. Alças mantêm a proporção das imagens (Shift sempre trava a proporção; "Manter proporção" desligado libera imagens; Alt a partir do centro), Shift no giro trava 15°, guias magnéticas na área visível, na grade e nos outros elementos (Ctrl ignora), setas 1 px (Shift 10 px), Ctrl+C/X/V/J, Ctrl+G agrupa, Ctrl+]/[ ordenam. Elementos podem ficar parcialmente fora da área visível; a parte de fora não vai para a mesa.
- **Camadas da composição:** Fundo (com o mapa travado embaixo), Elementos e extras; olho, cadeado e opacidade valem só no editor. "Só o mestre vê" (camada ou elemento) é o único controle do que os jogadores não recebem.
- **O que é compartilhado e o que é da cena:** o painel diz "Somente esta cena". **Abrir o mapa original…** salva, abre o editor do mapa (recurso compartilhado) e volta à cena; **Criar mapa a partir da composição** gera um mapa novo reutilizável sem mudar a cena. Trocar o cenário remove a composição da cena (com confirmação).
- **Mesa:** a composição chega mesclada ao mapa e sob a névoa. Salvar não muda a mesa; apresentar, reiniciar ou **Aplicar à cena atual › Imagens da composição** muda.
- **Personagens e posições iniciais** (contexto Personagens): todos os personagens dos jogadores com o estado; arrastar posiciona e arrastar de novo move o mesmo marcador; Mostrar e Remover posição. **Área de entrada:** ponto do mapa escolhido, área própria desenhada com a ferramenta Área de entrada ou automática (Entrada do grupo do mapa). **Distribuir grupo na área inicial** posiciona quem falta sem colisão e avisa quando falta espaço.
- **Pontos de entrada do mapa** (preparação do mapa): até 12, nomeados e com tipo; reutilizáveis e nunca movem posições já preparadas em cenas.
- Ordem ao apresentar: posição preparada › área de entrada da cena › Entrada do grupo do mapa › regra antiga. **Recolocar personagens nas posições preparadas…** (Arquivo, com a cena em apresentação) mostra a prévia antes de confirmar.
- Celular: contextos aparecem só com ícone (nome acessível e dica continuam).
- Limitações: mapas de tiles e cenários prontos não recebem composição; o mestre na mesa vê o mesmo que os jogadores (os elementos só do mestre aparecem no editor); a composição não entra nas versões persistentes da cena.
