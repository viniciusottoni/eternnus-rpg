# Ajuda contextual

Fonte de verdade da ajuda atual e futura (ADR-047). Fase A documentada antes da implementação da Fase B em 8 de novembro de 2026.

## Objetivo e decisão

Cada elemento usa um nível principal. Texto auxiliar sempre visível informa formato, limite, requisito ou consequência e se liga por `aria-describedby`. Tooltip reforça uma informação breve, de até 80 caracteres. Botão ⓘ abre uma explicação com mais de uma frase sobre conceitos, papéis e diferenças entre opções. Uma explicação conceitual pode coexistir com o requisito visível do campo; não esconde esse requisito.

| Situação | Nível e exemplo real |
| --- | --- |
| Ícone sem texto | Nome acessível e tooltip: ampliar mapa, enviar mensagem, fechar. |
| Selo, abreviação, data relativa | Tooltip: ONLINE, tipo de evento, horário completo da Guilda. O nome/valor precisa continuar acessível em toque. |
| Formato, limite, requisito | Auxiliar visível: senha 10–128, upload, fórmula opcional e raios 0–30. |
| Consequência irreversível | Texto na confirmação: excluir campanha ou encerrar one-shot. |
| Conceito e comparação | ⓘ: forma de jogar, Luz/Visão, visibilidade blind, migração. |
| Indisponível | Motivo alcançável por teclado/leitor: `aria-disabled` com bloqueio ou auxiliar descrito. Tooltip só reforça. |
| Atalho | Tooltip no controle e orientação visível no editor com vários atalhos. |

## Acessibilidade e interação

`helpButton(key, label)` gera um ⓘ discreto de 18 px visíveis (área de toque ampliada por pseudo-elemento: cerca de 30 px com mouse e 44 px em toque, sem empurrar o layout), `type=button`, nome “Ajuda: tema”, `aria-expanded`, `aria-controls=help-popup` e `aria-haspopup=dialog`. Fica colado ao texto a que se refere, na mesma linha: dentro do título (`h1`–`h4`), da legenda ou do `summary`, ou ao lado do label em `.field-label` (sem esticar o label). Nunca fica sozinho numa linha, nem dentro de legenda `sr-only` ou de `<ol>`/`<ul>`. O teste `tests/help-ui.mjs` mede a distância até o texto anterior. O popup único tem `popover=auto`, `role=dialog`, `aria-labelledby=help-title` e foco inicial no próprio popup. Esc, o X e clique fora fecham e devolvem foco ao gatilho. Trocar de ⓘ substitui o conteúdo e sincroniza os estados. Se o gatilho sumir em re-render, procurar seu substituto pela chave; ao sair da tela, fechar e focar o destino principal, nunca deliberadamente o body.

Tooltip singleton usa `role=tooltip`, `aria-describedby` sem substituir outros IDs ou o nome. Hover abre após 400 ms; foco abre imediatamente. Esc dispensa sem mover foco. Permanece enquanto gatilho ou tooltip tiver ponteiro/foco; é dispensável e hoverable (WCAG 1.4.13). Não abre por toque. Informação necessária em celular fica visível ou no ⓘ. Posicionar com CSSOM dentro do viewport, inverter acima/abaixo e recalcular em scroll/resize.

O popup é sempre centralizado na tela (desktop, celular, sobre modal ou mesa), com fundo levemente escurecido (`::backdrop`), até 440 px de largura e altura limitada à tela com rolagem interna. Fecha só pelo X no cabeçalho (`aria-label="Fechar ajuda"`), sem botão de texto “Fechar”. Botões de fechar (×) não recebem tooltip. `popover` usa top layer acima do único `#modal` e da mesa imersiva, sem diálogo aninhado. Esc consome primeiro ajuda aberta e só depois pode cancelar o modo do mapa. Não capturar Tab nem tornar a tela inerte.

Fade breve de entrada; `prefers-reduced-motion` remove animação. Ajuda não atrasa ações nem altera os 3.000 ms de abertura.

## Arquitetura e conteúdo

- `js/help-policy.js`: regras puras de chave, texto, audiência, rota e resolução de módulo. Reutiliza `isAdmin`, `isStaff`, `isSafeSegment` de `policy.js`. Índice leve de chaves conhecidas permite omitir botões inválidos em produção sem carregar textos longos.
- `js/help.js`: apresentação, helpers `tip`, `helpButton`, `installHelp`, singleton de tooltip e popup. Delegação de pointerover/pointerout/focusin/focusout/keydown/click. Instalação única junto de `installUi` em `app.js`.
- `js/help/<area>.js`: dados congelados, importados somente na primeira abertura por área. Áreas: conta, campanhas, sessoes, mesa, fichas, modelos, biblioteca, guilda, progresso, suporte, admin.
- Chave `area.tela.elemento`: minúsculas e hífens; três segmentos. Entrada `{ title, summary, body, example?, audience?, related?, route? }`. Título até 80, summary até 160, body com parágrafos ou `{ list: [...] }`; nenhum HTML. Audiência all/player/master/ambassador/admin considera papel global e contexto do recurso, sem conceder acesso.
- `ui.field` e `ui.passwordField` aceitam opções `{ hint, help }`, preservam chamadas antigas e ligam hint por `aria-describedby`. Configurações compartilhadas reaproveitam esse mecanismo, mantendo `SETTING_FIELDS.help` como hint.

Catálogo contém só texto público revisado. Renderizar por `textContent`, ou `esc` para estrutura fixa. Não aceitar HTML, URLs livres, classes ou atributos. Saiba mais só aceita `#rota` cujos segmentos passam `isSafeSegment`. Validar related e audiência; dados nunca autorizam ações. Conteúdo do Jogador não descreve recursos privados do Mestre. Ajuda descreve apenas garantias verificadas nas fontes e código; conflitos documentais antigos de one-shot seguem ADR-046/CONDUCAO_MESA.md e implementação atual.

Redação pt-BR, frases curtas, voz ativa, “você”, Mestre/Jogador/Embaixador, ficha-modelo, névoa, vez e cena. Explicar quem pode. Sem promessas de capacidade, moderação perfeita ou sucesso de rolagem sem critério.

## Carregamento, falhas e PWA

Primeiro ⓘ mostra “Carregando ajuda…”. Falha mostra mensagem curta dentro do popup, com nova tentativa, sem toast. Chave inexistente avisa no console local de desenvolvimento; produção omite o botão. Teste de integridade impede referência inexistente. Mudança de gatilho durante import ignora resposta antiga.

`help.js` e `help-policy.js` ficam no shell. Precache dos onze catálogos públicos estáticos é permitido: são textos sem dados autenticados e a importação/avaliação continua sob demanda. Listar cada arquivo explicitamente em STATIC_PATHS e subir o cache a partir de v22; versão integrada final v25 (inclui o trabalho paralelo de mapas/cenas). Nunca cachear API, PDFs, perfis, tokens ou dados de jogo. Sem skipWaiting forçado ou recarga da sessão.

## Inventário por tela

Auditoria inicial: 59 conceitos e 202 linhas de controles/opções, antes de editar código. A integração paralela Básica/Completa acrescentou seis conceitos. O inventário final abaixo identifica os pontos de acesso reais dos 65 conceitos; o teste de integridade exige que todos tenham uso. “Aplicado” indica integração no código, sem significar que cada variação de conteúdo foi percorrida no navegador.

### Conceitos e pontos de acesso

| Elemento | Arquivo | Nível | Chave | Texto proposto | Status |
| --- | --- | --- | --- | --- | --- |
| Papéis da plataforma | `admin.js` | ⓘ | `admin.usuarios.papeis` | Só Admin altera papéis pela gestão auditada. | Aplicado |
| Identificador do sistema | `admin.js` | ⓘ | `admin.sistemas.identificador` | O identificador organiza a referência do sistema. | Aplicado |
| Motivo e auditoria | `admin.js` | ⓘ | `admin.acoes.auditoria` | Ações administrativas registram ator e motivo. | Aplicado |
| Arquivos da Biblioteca | `library.js` | ⓘ | `biblioteca.arquivos.verificacao` | A equipe publica materiais após validação no servidor. | Aplicado |
| Leitor de PDF | `library.js` | ⓘ | `biblioteca.leitor.controles` | Você pode trocar de página e ajustar o zoom. | Aplicado |
| Mestre e Jogador | `campaigns.js` | ⓘ | `campanhas.lista.papeis` | Seu papel depende da campanha. | Aplicado |
| Catálogo de músicas | `admin-music.js` | ⓘ | `admin.musicas.catalogo` | Faixas do servidor que os Mestres buscam por nome e tocam na mesa. | Aplicado (Admin) |
| Trilha sonora compartilhada | `table-soundtrack.js` | ⓘ | `mesa.trilha.compartilhada` | O Mestre escolhe no catálogo do servidor e controla a mesma música para toda a mesa. | Aplicado |
| Ativar áudio da sessão | `table-soundtrack.js` | ⓘ | `mesa.trilha.ativar-audio` | Alguns navegadores só tocam som depois de um toque ou clique. | Aplicado |
| Limites da conta | `one-shots.js` | ⓘ | `campanhas.conta.limites` | Campanhas e one-shots usam quotas diferentes. | Aplicado |
| Forma de jogar | `campaigns.js`; `table-settings.js` | ⓘ | `campanhas.config.forma-de-jogar` | Livre, Por turnos e Tática organizam as ações. | Aplicado |
| Convite da campanha | `campaign-page.js` | ⓘ | `campanhas.convite.codigo` | Compartilhe o convite apenas com quem deseja convidar. | Aplicado |
| Ficha-modelo da campanha | `campaign-page.js` | ⓘ | `campanhas.config.modelo` | A escolha orienta as novas fichas. | Aplicado |
| Arquivar e restaurar | `campaign-page.js` | ⓘ | `campanhas.config.arquivamento` | Arquivar guarda o conteúdo e impede novas partidas. | Aplicado |
| One-shot e continuidade | `one-shots.js` | ⓘ | `campanhas.one-shot.continuidade` | Uma one-shot abre uma única sessão temporária. | Aplicado |
| Cenas preparadas | `campaign-prep.js` | ⓘ | `campanhas.preparo.cenas` | O Mestre prepara e apresenta cenas para a mesa. | Aplicado |
| Personagens do Mestre | `campaign-prep.js` | ⓘ | `campanhas.preparo.personagens` | O Mestre pode guardar personagens e criar cópias para encontros. | Aplicado |
| Modelos privados | `campaign-prep.js` | ⓘ | `campanhas.preparo.modelos-privados` | O Mestre cria modelos próprios para sua campanha. | Aplicado |
| Textos antigos (Bibliotecas) | `campaign-assets.js` | ⓘ | `campanhas.acervo.publicacao` | Textos de antes das Páginas; o Mestre converte cada um em página. | Aplicado |
| Mapas e escala | `campaign-assets.js` | ⓘ | `campanhas.acervo.mapas` | A grade e a escala ligam o mapa ao deslocamento. | Aplicado |
| Preparar e apresentar | `scene-editor.js`; `table-scenes.js` | ⓘ | `campanhas.cenas.preparacao` | Salvar a preparação não apresenta a cena aos jogadores. | Aplicado |
| Aplicar à cena atual | `scene-editor.js` | ⓘ | `campanhas.cenas.aplicar` | Você escolhe quais partes salvas passam a valer agora. | Aplicado |
| Alcance da preparação | `scene-editor.js` | ⓘ | `campanhas.cenas.alcance` | A preparação pode pertencer ao mapa ou só à cena. | Aplicado |
| Simulação de visão | `scene-editor.js` | ⓘ | `campanhas.cenas.simulacao` | A prévia usa as regras da mesa e a visão da ficha do personagem escolhido. | Aplicado |
| "Visão de" (simulação) | `scene-editor.js` | Texto visível | — | Rótulo visível e explicação no aviso da simulação; sem ⓘ redundante. | Aplicado |
| Recolocar os marcadores no arranjo preparado | `scene-editor.js`, `table-scenes.js` | Texto visível | — | `APPLY_TOKENS.help` abaixo da opção, desmarcada por padrão. | Aplicado |
| Reiniciar cena com o novo cenário… | `scene-editor.js`, `table-scenes.js` | Texto visível | — | Explicação ao lado do botão e confirmação com o que muda. | Aplicado |
| Grade e escala | `grid-adjust.js`; `scene-editor.js` | ⓘ | `campanhas.mapas.grade` | Ajuste a grade antes de preparar paredes e névoa. | Aplicado |
| Manter conectado | `auth.js` | ⓘ | `conta.acesso.persistencia` | Use esta opção apenas em um dispositivo pessoal. | Aplicado |
| Acesso com Google ou Discord | `auth.js` | ⓘ | `conta.acesso.social` | O provedor precisa informar um e-mail verificado. | Aplicado |
| Autenticador | `auth.js` | ⓘ | `conta.acesso.autenticador` | Uma segunda etapa protege o acesso à conta. | Aplicado |
| Aprovação do avatar | `profile.js` | ⓘ | `conta.perfil.avatar` | A imagem só aparece após a aprovação no servidor. | Aplicado |
| Instalar o Eternnus | `pwa.js` | ⓘ | `conta.app.instalacao` | Você pode adicionar o site à tela inicial. | Aplicado |
| Ficha compartilhada ou privada | `character-sheet.js` | ⓘ | `fichas.visibilidade.privacidade` | Você escolhe a visibilidade da sua ficha. | Aplicado |
| Versão da ficha | `character-sheet.js` | ⓘ | `fichas.versao.migracao` | Sua ficha mantém a versão do modelo usada na criação. | Aplicado |
| PDF preenchido | `character-sheet.js` | ⓘ | `fichas.pdf.exportacao` | O PDF usa os últimos valores salvos da ficha. | Aplicado |
| Ações da ficha | `sheet.js` | ⓘ | `fichas.acoes.campos` | Tipo, dados e efeito descrevem a ação. | Aplicado |
| Histórico de alterações | `character-sheet.js` | ⓘ | `fichas.historico.privado` | O histórico é reservado ao dono e ao Mestre autorizado. | Aplicado |
| Marcar como útil | `guild.js` | ⓘ | `guilda.posts.util` | Você reconhece uma resposta que ajudou. | Aplicado |
| Papéis e moderação | `guild.js` | ⓘ | `guilda.equipe.moderacao` | Admin e Embaixador identificam a equipe. | Aplicado |
| Configuração da mesa | `table.js` | ⓘ | `mesa.config.heranca` | O Mestre pode ajustar a sessão ou toda a campanha. | Aplicado |
| Névoa e exploração | `table-settings.js` | ⓘ | `mesa.config.nevoa` | A névoa limita o que cada Jogador recebe do mapa. | Aplicado |
| Revelação manual | `table-settings.js` | ⓘ | `mesa.config.revelacao-manual` | O Mestre escolhe as casas reveladas. | Aplicado |
| Movimento por caminho livre | `table-settings.js` | ⓘ | `mesa.config.caminho` | A névoa pode exigir um caminho conhecido e livre. | Aplicado |
| Aliados visíveis | `table-settings.js` | ⓘ | `mesa.config.aliados` | Esta opção mantém criaturas aliadas visíveis no escuro. | Aplicado |
| Luz e visão | `table-settings.js` | ⓘ | `mesa.config.luz-visao` | Luz ilumina o mapa; visão própria serve ao dono da ficha. | Aplicado |
| Ferramentas de névoa | `scene-editor.js`; `table.js` | ⓘ | `mesa.nevoa.ferramentas` | O Mestre edita casas, portas, luzes e marcas. | Aplicado |
| Modos de visão | `table.js` | ⓘ | `mesa.nevoa.visao` | O Mestre pode conferir a visão de um Jogador. | Aplicado |
| Ordem de turnos | `table-tools.js`; `table.js` | ⓘ | `mesa.turnos.ordem` | O Mestre organiza a vez de personagens e grupos. | Aplicado |
| Como ler os dados | `table-tools.js` | ⓘ | `mesa.rolagem.mecanicas` | Escolha a mecânica da rolagem. | Aplicado |
| Quem vê a rolagem | `table-tools.js` | ⓘ | `mesa.rolagem.visibilidade` | A visibilidade é aplicada no servidor. | Aplicado |
| Fórmula de rolagem | `table-tools.js` | ⓘ | `mesa.rolagem.formula` | A fórmula avançada substitui os dados escolhidos acima. | Aplicado |
| Pedidos de teste | `table-tools.js` | ⓘ | `mesa.testes.pedidos` | O Mestre pede uma rolagem a personagens selecionados. | Aplicado |
| Desfazer uma mudança | `table.js` | ⓘ | `mesa.acoes.desfazer` | Movimento e ajuste de recurso podem ser corrigidos. | Aplicado |
| Marcadores, vida e presença | `table.js` | ⓘ | `mesa.mapa.legenda` | O mapa e o grupo usam texto junto das cores. | Aplicado |
| Conversa e dados | `table.js` | ⓘ | `mesa.chat.comandos` | Você pode rolar dados pela conversa. | Aplicado |
| Imagens temporárias | `temporary-images.js` | ⓘ | `mesa.imagens.temporarias` | O Mestre apresenta uma imagem aos navegadores conectados. | Aplicado |
| Interface Básica e Completa | `interface-mode.js` | ⓘ | `mesa.interface.apresentacao` | A escolha muda as ferramentas mostradas, sem mudar as regras. | Aplicado |
| Nome nas fórmulas | `sheet-templates.js` | ⓘ | `modelos.campo.nome` | O nome identifica o campo em expressões com @. | Aplicado |
| Papel na mesa | `sheet-templates.js` | ⓘ | `modelos.campo.papel-na-mesa` | O papel liga um campo aos recursos usados pela mesa. | Aplicado |
| Fórmulas calculadas | `sheet-templates.js` | ⓘ | `modelos.campo.formula` | O servidor calcula os campos a partir dos valores da ficha. | Aplicado |
| Chave da ação | `sheet-templates.js` | ⓘ | `modelos.acoes.chave` | A chave identifica a ação do modelo. | Aplicado |
| Rascunho e publicação | `sheet-templates.js` | ⓘ | `modelos.versao.publicacao` | Versões publicadas são imutáveis. | Aplicado |
| Atalhos do editor | `sheet-templates.js` | ⓘ | `modelos.editor.atalhos` | Você pode operar os campos pelo teclado. | Aplicado |
| Níveis e conquistas | `progress.js` | ⓘ | `progresso.jornada.niveis` | O progresso reconhece atividades compartilhadas. | Aplicado |
| Pontos e limites diários | `progress.js` | ⓘ | `progresso.jornada.pontos` | O teto de XP não impede você de continuar a atividade. | Aplicado |
| Atlas do Eternnus | `campaign-assets.js` | ⓘ | `progresso.atlas.cenarios` | Os cenários oficiais estão disponíveis sem exigência de nível. | Aplicado |
| Uma sessão ativa | `campaign-page.js` | ⓘ | `sessoes.abertura.unica` | Uma campanha pode ter apenas uma sessão ativa. | Aplicado |
| Antes e depois | `session-history.js` | ⓘ | `sessoes.historico.alteracoes` | O histórico registra as mudanças da sessão. | Aplicado |
| Categorias e acompanhamento | `support.js` | ⓘ | `suporte.chamados.categorias` | Escolha a categoria que melhor descreve o problema. | Aplicado |
| Limite de chamados | `support.js` | ⓘ | `suporte.chamados.limite` | O formulário informa quantos chamados você pode manter abertos. | Aplicado |

### Campos, ícones, selos, datas e controles

Os rótulos suficientes continuam visíveis, sem ⓘ redundante. Requisitos já escritos são preservados e associados; nos formulários antigos sem auxiliar, `installHelp` escreve os limites explícitos do controle (required, minlength, maxlength, min/max) como texto visível. Isso descreve a restrição da interface, sem conceder autoridade ao cliente. Não se gera ajuda de conteúdo de usuário.

Tooltip dinâmico só abre se passar pelo limite de 80 caracteres. Nome acessível e valor visível permanecem disponíveis em toque. Ícones de `ui.button` usam seu aria-label; controles diretos são aprimorados uma vez por nó. A delegação não recria listeners a cada estado ao vivo. Os registros abaixo agrupam ocorrências repetidas do mesmo elemento em um arquivo.

| Elemento | Arquivo | Nível | Chave | Texto proposto | Status |
| --- | --- | --- | --- | --- | --- |
| Nome ou e-mail | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Papel | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Situação | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Duração | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Suspenso até (inclusive) | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome da campanha | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sistema | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Mesa | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Identificador (slug) | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Ação (prefixo) | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Ator (nome ou id) | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo de alvo | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Id do alvo | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| De | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Até | `admin.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome | `admin.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Reforço: Papel global da conta na plataforma | `admin.js` | Tooltip | — | Papel global da conta na plataforma | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Sistema da plataforma que não pode ser excluído. | `admin.js` | Tooltip | — | Sistema da plataforma que não pode ser excluído. | Aplicado; nome/valor/motivo continua alcançável |
| Chave do autenticador | `auth.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Código do autenticador | `auth.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Ou um código de recuperação | `auth.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| E-mail da sua conta | `auth.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Como podemos chamar você? | `auth.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| E-mail | `auth.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Reforço: Indisponível no momento | `auth.js` | Tooltip | — | Indisponível no momento | Aplicado; nome/valor/motivo continua alcançável |
| Nome | `campaign-assets.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Texto de apoio | `campaign-assets.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome da pasta | `campaign-assets.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome do mapa | `campaign-assets.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Imagem PNG ou JPEG (até 10 MB) | `campaign-assets.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Pasta | `campaign-assets.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Reforço: Esvazie a pasta antes de excluir. | `campaign-assets.js` | Tooltip | — | Esvazie a pasta antes de excluir. | Aplicado; nome/valor/motivo continua alcançável |
| Controle: Subir para a pasta anterior | `campaign-assets.js` | Tooltip | — | Subir para a pasta anterior | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Nome da sessão | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Objetivo / nota inicial do mestre | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo de recurso | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição, anotações ou URL do mapa | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sua ficha | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Modelo das novas fichas | `campaign-page.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Reforço: Há uma sessão ativa nesta campanha. | `campaign-page.js` | Tooltip | — | Há uma sessão ativa nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Nenhuma sessão está aberta nesta campanha. | `campaign-page.js` | Tooltip | — | Nenhuma sessão está aberta nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Encerre a sessão em andamento antes | `campaign-page.js` | Tooltip | — | Encerre a sessão em andamento antes | Aplicado; nome/valor/motivo continua alcançável |
| Nome | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Lado | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Resumo curto | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Valor | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Máximo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Notas privadas | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Observação | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Título | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Texto | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| O que aconteceu | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Campo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Opções (separe por vírgula) | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Máximo fixo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| ou máximo vindo do campo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome do modelo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Seção | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Ação | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Dados ou fórmula | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Grupo | `campaign-prep.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Buscar campanhas | `campaigns.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Ordenar por | `campaigns.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sistema de RPG | `campaigns.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Premissa e narrativa | `campaigns.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome da campanha | `campaigns.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Código de convite | `campaigns.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Reforço: Mesa temporária com uma única sessão. | `campaigns.js` | Tooltip | — | Mesa temporária com uma única sessão. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Conteúdo preservado; novas partidas estão bloqueadas. | `campaigns.js` | Tooltip | — | Conteúdo preservado; novas partidas estão bloqueadas. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Há uma sessão ativa nesta campanha. | `campaigns.js` | Tooltip | — | Há uma sessão ativa nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Nenhuma sessão está aberta nesta campanha. | `campaigns.js` | Tooltip | — | Nenhuma sessão está aberta nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Não disponível com jogadores vinculados | `campaigns.js` | Tooltip | — | Não disponível com jogadores vinculados | Aplicado; nome/valor/motivo continua alcançável |
| Ficha-modelo | `character-sheet.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome do personagem | `character-sheet.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Cada quadrado representa (metros) | `grid-adjust.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Categoria | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Título | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sistema de RPG (opcional) | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Buscar tópicos por título | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Filtrar por sistema | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Mover para | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Identificador (endereço) | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Ordem | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nível mínimo para abrir tópicos | `guild.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Reforço: Tópico destacado pela equipe. | `guild.js` | Tooltip | — | Tópico destacado pela equipe. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Somente a equipe pode responder neste tópico. | `guild.js` | Tooltip | — | Somente a equipe pode responder neste tópico. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Conteúdo retirado da conversa pública. | `guild.js` | Tooltip | — | Conteúdo retirado da conversa pública. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Tem tópicos: arquive em vez de excluir | `guild.js` | Tooltip | — | Tem tópicos: arquive em vez de excluir | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Há uma sessão ativa nesta campanha. | `invite.js` | Tooltip | — | Há uma sessão ativa nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Confirme seu e-mail | `layout.js` | Tooltip | — | Confirme seu e-mail | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Seu nível e conquistas | `layout.js` | Tooltip | — | Seu nível e conquistas | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Há uma sessão ativa nesta campanha. | `layout.js` | Tooltip | — | Há uma sessão ativa nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Buscar | `library.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sistema | `library.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Categoria | `library.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo | `library.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Título | `library.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Controle: Página anterior | `library.js` | Tooltip | — | Página anterior | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Próxima página | `library.js` | Tooltip | — | Próxima página | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Diminuir zoom | `library.js` | Tooltip | — | Diminuir zoom | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Aumentar zoom | `library.js` | Tooltip | — | Aumentar zoom | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Volume | `music.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Arquivo de áudio | `admin-music.js` | Texto visível | — | Formatos, 20 MB por arquivo e limites do catálogo em texto associado. | Aplicado |
| Título da faixa | `admin-music.js` | Texto visível | — | Opcional; sem título, usa o nome do arquivo. | Aplicado |
| Buscar faixa | `admin-music.js`, `table-soundtrack.js` | Texto visível | — | Rótulo permanente; até 100 caracteres. | Aplicado |
| Seu volume / Silenciar para mim | `table-soundtrack.js` | Texto visível | — | Só muda o som neste dispositivo (st-volume-help associado). | Aplicado |
| Controle: Posição da faixa | `table-soundtrack.js` | Texto visível | — | Rótulo acessível e aria-valuetext com tempo atual e duração. | Aplicado |
| Controles: Tocar/Pausar, ↺ 10 s, 10 s ↻, Repetir, Parar | `table-soundtrack.js` | Texto visível | — | Rótulos visíveis; Repetir com aria-pressed e "✓". | Aplicado |
| Selo da trilha: silenciar | `table-soundtrack.js` | Tooltip | — | Silenciar a trilha para você / Ouvir a trilha neste dispositivo. | Nome acessível + tooltip sincronizados |
| Sistema de RPG | `one-shots.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Premissa | `one-shots.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome da one-shot | `one-shots.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Código de convite | `one-shots.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Reforço: Há uma sessão ativa nesta campanha. | `one-shots.js` | Tooltip | — | Há uma sessão ativa nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Nenhuma sessão está aberta nesta campanha. | `one-shots.js` | Tooltip | — | Nenhuma sessão está aberta nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Novo avatar | `profile.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Como podemos chamar você? | `profile.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Nome da cena | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Texto compartilhável | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Notas privadas | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Lado | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Luz que carrega (casas) | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Raio (casas) | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Dificuldade de percepção | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Distância máxima (casas) | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sentido que detecta | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição de preparo (só você) | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Ordem na lista | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Névoa | `scene-editor.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Reforço: Salve a preparação antes de aplicar. | `scene-editor.js` | Tooltip | — | Salve a preparação antes de aplicar. | Aplicado; nome/valor/motivo continua alcançável |
| Buscar evento ou personagem | `session-history.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sistema | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sistema de RPG | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição (opcional) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Rótulo | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome nas fórmulas | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Papel na mesa | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Fórmula | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Mínimo | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Máximo | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Valor inicial | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Limite de caracteres | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Opções (uma por linha) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Página | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Fonte (pt) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Alinhamento | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| X (%) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Y (%) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Largura (%) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Altura (%) | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Chave | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Rolagem | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Notas da versão | `sheet-templates.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Reforço: Desfazer (Ctrl+Z) | `sheet-templates.js` | Tooltip | — | Desfazer (Ctrl+Z) | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Refazer (Ctrl+Shift+Z) | `sheet-templates.js` | Tooltip | — | Refazer (Ctrl+Shift+Z) | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Ctrl+S | `sheet-templates.js` | Tooltip | — | Ctrl+S | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Duplicar | `sheet-templates.js` | Tooltip | — | Duplicar | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Excluir (Delete) | `sheet-templates.js` | Tooltip | — | Excluir (Delete) | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Com problema | `sheet-templates.js` | Tooltip | — | Com problema | Aplicado; nome/valor/motivo continua alcançável |
| Controle: Desfazer (Ctrl+Z) | `sheet-templates.js` | Tooltip | — | Desfazer (Ctrl+Z) | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Refazer (Ctrl+Shift+Z) | `sheet-templates.js` | Tooltip | — | Refazer (Ctrl+Shift+Z) | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Zoom | `sheet-templates.js` | Tooltip | — | Zoom | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Diminuir zoom | `sheet-templates.js` | Tooltip | — | Diminuir zoom | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Aumentar zoom | `sheet-templates.js` | Tooltip | — | Aumentar zoom | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Duplicar campo | `sheet-templates.js` | Tooltip | — | Duplicar campo | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Controle: Excluir campo | `sheet-templates.js` | Tooltip | — | Excluir campo | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Nome | `sheet.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo | `sheet.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Dados | `sheet.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Efeito | `sheet.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| História, inventário e anotações | `sheet.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome do personagem | `sheet.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Classe / arquétipo | `sheet.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Controle: Remover ação | `sheet.js` | Tooltip | — | Remover ação | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Mostrar | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Categoria | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sua resposta | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Status | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Prioridade | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Responsável | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Busca | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Mensagem | `support.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Assunto | `support.js` | Texto visível | — | ui.field preserva o rótulo e associa hint; limites explícitos não ficam em tooltip. | Aplicado no componente compartilhado |
| Reforço: Prioridade definida pela equipe administrativa | `support.js` | Tooltip | — | Prioridade definida pela equipe administrativa | Aplicado; nome/valor/motivo continua alcançável |
| Nome da cena | `table-scenes.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Texto para os jogadores (opcional) | `table-scenes.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Quantidade | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Modificador | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Regra | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Quantos dados | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sucesso a partir de | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Alvo (1 a 100) | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sucesso quando | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Fórmula (substitui os dados acima) | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Descrição (opcional) | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome do teste | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Alvo | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sucesso quando o total for | `table-tools.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome do personagem | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Mensagem para a mesa | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Anotação da sessão | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Condições e nota curta | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Nome | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Lado | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Luz que carrega (casas, opcional) | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Raio (casas) | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Tipo | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Dificuldade de percepção | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Distância máxima (casas) | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sentido que detecta | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Sentidos | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Pontos | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Motivo | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Alvo (opcional) | `table.js` | Texto visível | — | Rótulo permanente; limites e requisitos do controle ficam visíveis e associados. | Preservado e associado |
| Reforço: Nenhuma sessão está aberta nesta campanha. | `table.js` | Tooltip | — | Nenhuma sessão está aberta nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Há uma sessão ativa nesta campanha. | `table.js` | Tooltip | — | Há uma sessão ativa nesta campanha. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: A sessão está ativa; presenças aparecem no grupo. | `table.js` | Tooltip | — | A sessão está ativa; presenças aparecem no grupo. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Forma de jogar desta sessão | `table.js` | Tooltip | — | Forma de jogar desta sessão | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Aguarde um Jogador conectado com ficha na mesa. | `table.js` | Tooltip | — | Aguarde um Jogador conectado com ficha na mesa. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Defina a ordem e aguarde um Jogador conectado em uma sessão ativa. | `table.js` | Tooltip | — | Defina a ordem e aguarde um Jogador conectado em uma sessão ativa. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Você já moveu nesta vez ou não pode mover neste momento. | `table.js` | Tooltip | — | Você já moveu nesta vez ou não pode mover neste momento. | Aplicado; nome/valor/motivo continua alcançável |
| Reforço: Desfazer a última mudança elegível | `table.js` | Tooltip | — | Desfazer a última mudança elegível | Aplicado; nome/valor/motivo continua alcançável |
| Controle: Enviar | `table.js` | Tooltip | — | Enviar | Nome acessível + tooltip compartilhado; limites do controle preservados |
| Variações de conteúdo do componente | `guild.js` | Texto visível / tooltip conforme elemento | — | Data relativa → horário completo; edição de mensagem → horário completo; selos Admin/Embaixador; ação Útil bloqueada para a própria mensagem. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `table.js` | Texto visível / tooltip conforme elemento | — | Ferramentas de ícone, chip da forma de jogar, vez, presença, motivo dos comandos sem vez/pausados e legenda do grupo. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `session-history.js` | Texto visível / tooltip conforme elemento | — | Ícone de tipo de evento; o label identifica o evento e antes → depois permanece no detalhe visível. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `sheet-templates.js` | Texto visível / tooltip conforme elemento | — | Tipos de campo, atalhos de desfazer/refazer/salvar e ações de duplicar/excluir; instruções do editor permanecem visíveis. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `music.js` | Texto visível / tooltip conforme elemento | — | Tocar/pausar trilha e volume em percentual; os nomes acessíveis são atualizados junto com data-tip. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `grid-adjust.js` | Texto visível / tooltip conforme elemento | — | Diminuir/aumentar tamanho e alinhamento; instrução e limites da grade visíveis, mesma ajuda na Básica e na Completa. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `table-scenes.js` | Texto visível / tooltip conforme elemento | — | Estados Preparada/Já visitada/Em apresentação e ações Apresentar/Retomar/Reiniciar/Aplicar: estado e consequência visíveis, conceito detalhado no catálogo campanhas. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `interface-mode.js` | Texto visível / tooltip conforme elemento | — | Básica e Completa: rótulos e descrição visíveis/associados; ajustes avançados não desaparecem da regra. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `fog-policy.js` | Texto visível / tooltip conforme elemento | — | Todos os onze SETTING_FIELDS: cada help permanece como hint; configurações compartilham os conceitos da mesa/campanha. | Aplicado; grupos conceituais têm chave na tabela anterior |
| Variações de conteúdo do componente | `scene-policy.js` | Texto visível / tooltip conforme elemento | — | Todos os SCENE_KINDS, VISIBILITY_OPTIONS e HELP: preservar instruções necessárias no contexto, com associação aos controles pelo núcleo. | Aplicado; grupos conceituais têm chave na tabela anterior |

### Indisponibilidade e consequências

| Elemento | Arquivo | Nível | Chave | Texto proposto | Status |
| --- | --- | --- | --- | --- | --- |
| Conta sem confirmação / menu bloqueado | `layout.js` | Texto visível | — | Confirme seu e-mail para acessar os destinos de jogo. | Aplicado: foco, aria-disabled e descrição comum; tooltip reforça |
| Exclusão com jogadores | `campaigns.js`, `campaign-page.js` | Texto visível | — | Exclusão bloqueada enquanto houver jogadores. | Aplicado: aria-disabled com bloqueio ou motivo visível |
| Pasta ocupada / sistema protegido ou em uso | `campaign-assets.js`, `admin.js` | Texto visível | — | Esvazie a pasta; sistema protegido; em uso, desative em vez de excluir. | Aplicado: motivo visível associado e captura bloqueia a ação |
| Próxima/Anterior nos limites | `ui.js`, listas paginadas | Texto visível | — | Você está no início/fim da lista. | Aplicado: aria-disabled para paginação; motivo associado |
| Leitor de PDF nos limites/carregando | `library.js` | Texto visível | — | Anterior indisponível na primeira; Próxima, na última; aguarde a abertura. | Aplicado: disabled com pdf-page-help visível e associado |
| Desfazer/refazer e páginas do modelo | `sheet-templates.js`, `ui.js` | Texto visível | — | Exige alterações na edição atual; modelo precisa ter 1–50 páginas. | Aplicado: ed-history-help ou aria-disabled com motivo |
| Preparação arquivada | `campaign-prep.js`, `ui.js` | Texto visível | — | Restaure a campanha arquivada para editar a preparação. | Aplicado aos comandos de criação/agenda; estado da campanha preservado |
| Ficha de outro participante | `character-sheet.js` | Texto visível | — | Somente leitura; edição e histórico exigem dono ou Mestre autorizado. | Aplicado: cs-readonly associado aos controles |
| Fora da vez, pausa, sem Jogador ou sem grade | `table.js` | Texto visível | — | Mensagem do contexto em t-why ou motivo específico junto ao comando. | Aplicado; servidor continua revalidando |
| Faixa tocando em sessão | `admin-music.js` | Texto visível | — | Excluir exige que o Mestre pare ou troque a música (am-in-use). | Aplicado: aria-disabled com motivo; servidor responde 409 |
| Controles da trilha sem faixa, sessão encerrada ou comando pendente | `table-soundtrack.js` | Texto visível | — | Motivo em st-why associado aos botões. | Aplicado; servidor revalida mestre e versão |
| Limite de faixas ou de espaço do catálogo | `admin-music.js` | Texto visível | — | Uso da quota em am-usage; validação local antes do envio. | Aplicado; servidor reconfere sob bloqueio |
| Upload/avatar indisponível | `profile.js` | Texto visível | — | Confirme o e-mail ou aguarde a configuração de verificação. | Preservado e associado a arquivo/submit |
| Limite de chamados | `support.js` | Texto visível | — | Contagem e limite em sup-limit. | Aplicado: botão descrito pelo contador |
| Gravação em andamento | `ui.submitForm` e handlers existentes | Estado visível | — | Loading e aria-busy sinalizam a operação. | Preservado; sem atraso artificial |
| Reiniciar/apagar/encerrar/converter | Confirmações dos respectivos módulos | Texto visível | — | Consequência já aparece antes de confirmar. | Preservado; ⓘ não substitui confirmação |

Não há exceções de title na interface. document.title continua sendo o título da aba; propriedades title de entidades são dados, não tooltips. O HTML estático e os módulos são verificados pelo teste de integridade.

## Checklist de novas funcionalidades

- Classificar cada elemento pela matriz; registrar chaves no catálogo da área e nesta tabela.
- Requisitos e consequências ficam visíveis e descritos; botões só com ícone têm nome e tooltip.
- Conferir quem pode, privacidade e regra real do servidor nas fontes de verdade.
- Garantir toque, teclado, foco de retorno, Esc, contraste e movimento reduzido.
- Cobrir carregando, falha e chave inexistente; testar integridade e viewport móvel/desktop.
- Revisar lista pública e versão PWA quando arquivos controlados mudarem.

## Evolução futura — não implementada

Ajuda escrita por usuário em campos de ficha-modelo ou descrição de sistema exige contrato próprio em API.md, migração versionada, limite, texto puro, validação no servidor e moderação. Não aceitar conteúdo arbitrário no catálogo atual. Uma Central de ajuda com busca pode consultar o catálogo no futuro. Ajuda por regra de sistema acompanha a implementação futura de iniciativa automática ou condições. Telemetria dos ⓘ mais abertos exige decisão explícita de privacidade, finalidade e retenção antes de coletar.

## Contrato HTTP

Esta entrega não altera contrato HTTP: API.md permanece inalterado por este trabalho. Ajuda é apresentação e texto público estático; não cria endpoints, campos persistidos, backend ou migrações. Alterações preexistentes de API.md pertencem ao trabalho anterior no workspace.

## Verificação e desvios

Resultados reais registrados em TESTES.md e artifacts/qa/ajuda-contextual/. `title` permitido: nenhum atualmente; um futuro iframe deve declarar sua exceção e justificativa no teste de integridade. Requisitos de campo não podem ser substituídos por tooltip.

## Integração com mapas e cenas Básica/Completa

A implementação paralela de mapas/cenas usa `scene-editor.js`, `scene-policy.js`, `interface-mode.js` e `grid-adjust.js`. Esta padronização inclui os dois modos. A apresentação da interface não altera Livre/Turnos/Tática, visibilidade ou ajustes ativos. Preservar a ajuda visível existente em `scene-policy.HELP`, SCENE_KINDS e VISIBILITY_OPTIONS: são instruções necessárias, não tooltips. Preparação salva e mesa atual têm estados separados.

| Elemento | Arquivo | Nível | Chave | Texto proposto | Status |
| --- | --- | --- | --- | --- | --- |
| Interface Básica e Completa | `interface-mode.js` | ⓘ | `mesa.interface.apresentacao` | A escolha muda as ferramentas mostradas, sem mudar as regras. | Aplicado |
| Preparar e apresentar | `scene-editor.js` | ⓘ | `campanhas.cenas.preparacao` | Salvar a preparação não apresenta a cena aos jogadores. | Aplicado |
| Aplicar à cena atual | `scene-editor.js` | ⓘ | `campanhas.cenas.aplicar` | Você escolhe quais partes salvas passam a valer agora. | Aplicado |
| Alcance da preparação | `scene-editor.js` | ⓘ | `campanhas.cenas.alcance` | A preparação pode pertencer ao mapa ou só à cena. | Aplicado |
| Simulação de visão | `scene-editor.js` | ⓘ | `campanhas.cenas.simulacao` | A prévia da preparação não representa um Jogador específico. | Aplicado |
| Grade e escala | `grid-adjust.js` | ⓘ | `campanhas.mapas.grade` | Ajuste a grade antes de preparar paredes e névoa. | Aplicado |


## Entrega e limites

Arquivos novos: `js/help.js`, `js/help-policy.js`, os onze `js/help/<area>.js`, este documento e `tests/help-{policy,catalog,fields}.test.mjs`, `tests/help-ui.mjs`, `tests/help-interactions.mjs`.

Arquivos integrados: `js/app.js`, `ui.js`, `layout.js`, `auth.js`, `profile.js`, `pwa.js`, `campaigns.js`, `one-shots.js`, `campaign-page.js`, `campaign-prep.js`, `campaign-assets.js`, `character-sheet.js`, `sheet.js`, `sheet-templates.js`, `library.js`, `guild.js`, `progress.js`, `support.js`, `admin.js`, `session-history.js`, `table.js`, `table-map.js`, `table-settings.js`, `table-tools.js`, `temporary-images.js`, `pdf-sheet.js`, `music.js`, `scene-editor.js`, `interface-mode.js`, `grid-adjust.js`, `table-scenes.js`, `pwa-policy.js`, `styles.css` e `service-worker.js`. Documentação: `AGENTS.md`, `ARQUITETURA.md`, `GUIA_VISUAL.md`, `DECISOES.md`, `PWA.md`, `TESTES.md`. Alterações preexistentes/da implementação paralela nesses arquivos foram preservadas.

| Catálogo | Entradas |
| --- | ---: |
| conta | 5 |
| campanhas | 17 |
| sessoes | 2 |
| mesa | 18 |
| fichas | 5 |
| modelos | 6 |
| biblioteca | 2 |
| guilda | 2 |
| progresso | 3 |
| suporte | 2 |
| admin | 3 |
| **Total** | **65** |

Evidência final: compilação sem avisos/erros; 675 testes .NET; 128 testes frontend; 289 verificações de navegador e 37 capturas, sem erros de página/CSP. Comandos, caminhos e limites estão no registro datado de [TESTES.md](TESTES.md).

Todos os 65 conceitos planejados possuem ponto de acesso e entrada validada. Nenhum item conceitual ficou sem implementação. Controles com instruções suficientes conservaram o texto visível; não receberam popup redundante. A ajuda longa já visível no editor de cenas continua visível. O inventário foi atualizado para os módulos da implementação paralela, incluindo table-scenes.js; alterações posteriores devem seguir o checklist.

Desvios de escopo: seis conceitos de mapas/cenas foram acrescentados por orientação explícita do usuário. O cache final integrado é v25, pois a implementação paralela também versionou o shell. Nenhuma mudança no modelo de três níveis ou no contrato HTTP desta entrega. Catálogos são precacheados como texto público, mas importados/avaliados só na primeira abertura. Leitor de tela real, aparelho físico, teclado virtual, Safari/iOS, instalação real e carga não foram validados por este trabalho. Evoluções futuras continuam sem implementação.

## Continuidade e acervo — classificação

| Elemento | Nível | Chave ou justificativa |
| --- | --- | --- |
| Origem e numeração | ⓘ | campanhas.continuidade.origem |
| Acervo/caderno e acesso | ⓘ | campanhas.acervo.cadernos |
| Registro anterior | ⓘ | campanhas.continuidade.historico |
| Título, conteúdo, coleção, etiquetas, capítulo, ordem, estado, relações e fixar | Visível | Labels, limites e instruções no editor; sem popup redundante |
| Importar, exportar, versões e lixeira | Visível | Texto do comando e limites adjacentes |
| Anexos | Visível | Tipos, tamanho e escopo de leitores no formulário |
| Atlas | Visível | Publicação integral e confirmação explícita; cópia independente |
| Salvamento | Visível | Estado acessível no editor; falha preserva texto e oferece baixar rascunho |

Catálogo campanhas e índice help-policy incluem as três novas chaves. Público estático, sem conteúdo da campanha.


## Mesa horizontal — classificação (ADR-056)

| Elemento | Nível | Chave ou justificativa |
| --- | --- | --- |
| Orientação e tela cheia | ⓘ | `mesa.tela.horizontal`, catálogo mesa e índice; limites do navegador e painéis |
| Vire o celular | Visível | Requisito permanente na superfície de rotação; título recebe foco |
| Entrar em tela cheia | Visível | Botão rotulado, instrução/erro em `rotate-status` associado por aria-describedby; ocupado/desabilitado durante a tentativa; ausente sem suporte |
| Tela cheia / Sair da tela cheia | Visível | Rótulo e aria-pressed refletem o estado; sem ícone isolado |
| Voltar à campanha | Visível | Link explícito disponível também em retrato |
| Ações indisponíveis do mestre | Visível | Uma orientação compartilhada em `t-master-why`; todos os botões afetados a referenciam, evitando repetição |

As abas Mapa/Grupo/Ficha/Conversa e suas permissões são as existentes; agora abrem painéis laterais no layout compacto.


## Câmera e preparação — ADR-057

- `mesa.mapa.camera`: conceito compartilhado da câmera, catálogo mesa; acesso Visão ⓘ na mesa e no editor. Explica zoom limitado, pan, interação e privacidade.
- Arrastar mapa: texto e aria-pressed; orientação visível associada por aria-describedby com ID único por instância.
- Mapa inteiro/Ampliar mapa: rótulo visível e estado. ±: nomes acessíveis/tooltip gerado pelo helper compartilhado; disabled no limite.
- Propriedades: rótulo visível e aria-expanded, mostra/recolhe painel no editor compacto.
- Prévia de grade: orientação visível para pinça, intervalo 1–4× e botões rotulados; zoom não muda valores da grade.
- Círculo: dimensões protegidas no componente compartilhado; o alvo touch permanece 44 px sem esticar a borda.

### Classificação dos elementos da ADR-059 (10/11/2026)

| Elemento | Arquivo | Nível | Chave |
| --- | --- | --- | --- |
| Contagem “usados/limite” | `ui.js` | Auxiliar visível ligado por `aria-describedby`; substitui a dica automática “Até N caracteres”. | — |
| Submenus de Mundo e acervo e Configurações | `campaign-page.js` | Rótulos autoexplicativos; sem ⓘ. | — |
| Blocos do Diário | `campaign-page.js`, `campaign-prep.js` | Texto visível sob cada título (o que é e quem vê); Antes do Eternnus mantém ⓘ. | `campanhas.continuidade.historico` (corpo cita as cenas) |
| Cenas da sessão anterior | `campaign-workspace.js` | Auxiliar visível com formato e limite (30 cenas; título vazio vira “Cena N”). | — |
| Retrato na Ficha do elemento | `npc-sheet.js` | Auxiliar visível + ⓘ existente da imagem. | `mesa.npcs.imagem` (corpo cita trocar/remover) |


### Classificação — capítulos e premissa (ADR-060, 10/11/2026)

| Elemento | Arquivo | Nível | Chave |
| --- | --- | --- | --- |
| Capítulos, atos e arcos (bloco do Diário) | `campaign-chapters.js` | ⓘ no título + texto visível sob o título (quem vê e recomendação de criar antes); no editor, texto sob “Visível para os jogadores” diz o que o grupo passa a ver | `campanhas.capitulos.organizacao` (todos; jogador vê o bloco só com capítulos visíveis) |
| Seletor de capítulo (iniciar sessão, registro anterior, mover sessão) | `campaign-chapters.js` | Auxiliar visível por `aria-describedby`; sem capítulos, recomenda criar o primeiro e lembra a opção avulsa | — |
| Título, tipo e resumo do capítulo | `campaign-chapters.js` | Labels, limites e contagem comuns; resumo indica "Só você vê" | — |
| Subir/descer capítulo | `campaign-chapters.js` | Nome acessível com o título; `disabled` nas pontas | — |
| Excluir capítulo | `campaign-chapters.js` | Consequência na confirmação (sessões continuam, ficam avulsas) | — |
| "mais" da premissa | `campaign-page.js` | Nome acessível "Ler a premissa completa"; abre o modal comum | — |
| Chip de capítulo/Avulsa nas sessões | `campaign-page.js`, `campaign-workspace.js` | Texto visível | — |

Catálogo campanhas e índice help-policy incluem a nova chave.


### Classificação — tabela de sessões, busca e importação (ADR-061, 10/11/2026)

| Elemento | Arquivo | Nível | Chave |
| --- | --- | --- | --- |
| Tabela de sessões (origem, visibilidade, busca, importação) | `campaign-sessions.js` | ⓘ no título + texto visível sob o título conforme o papel | `campanhas.sessoes.tabela` |
| Filtros (busca, capítulo, origem) | `campaign-sessions.js` | Labels visíveis; contagem de resultados em `role=status`; "Limpar filtros" | — |
| Importar em lote | `campaign-sessions.js` | Passos visíveis no modal, auxiliar do arquivo (limites, formato de data e publicado), prévia com erros por linha em `role=alert` | — |
| Busca na campanha (Visão geral) | `campaign-search.js` | ⓘ no título + auxiliar com as fontes buscadas conforme o papel | `campanhas.busca.geral` |
| NPCs conhecidos | `campaign-search.js` | Texto visível sob o título (o que o grupo vê) | — |
| "Visível para os jogadores" (NPC) | `campaign-prep.js` | Auxiliar visível com os campos compartilhados | — |
| Registro anterior | `campaign-workspace.js` | ⓘ movido para o texto de abertura do formulário | `campanhas.continuidade.historico` |

### Classificação — NPCs e páginas de história (ADR-064, 11/11/2026)

| Elemento | Arquivo | Nível | Chave |
| --- | --- | --- | --- |
| “+ História” e link “História:” no NPC | `campaign-prep.js` | Texto visível sob o título “Personagens do mestre” + ⓘ existente | `campanhas.preparo.personagens` |
| “Esta página conta a história do NPC” | `campaign-workspace.js` | Auxiliar visível sob o campo (`aria-describedby`) | — |
| Selo “NPC: nome” na lista de Páginas | `campaign-workspace.js` | Rótulo autoexplicativo + `data-tip` | — |
| “Ler página” em NPCs conhecidos | `campaign-search.js` | Texto visível sob o título; aviso ao mestre quando a página não é de toda a mesa | — |
