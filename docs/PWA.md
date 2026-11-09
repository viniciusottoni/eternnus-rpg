# PWA e navegação no celular

## Ajuda contextual e integração de mapas/cenas — 8 de novembro de 2026

Versão integrada vigente: `eternnus-public-shell-v31` (v31: layout estável de modais e do popup de ajuda durante o fade de saída, revisão visual da mesa e espera sem piscar; v30: foco visível sem corte, alinhamento comum de formulários e fade de entrada/saída em modais e popups; v29: revisão de modais e da ajuda — ⓘ discreto junto ao texto, popup centralizado, modal com cabeçalho fixo e uma única rolagem, ações de pasta/envio abaixo do Atlas e renomear pasta; nenhum arquivo novo na lista. As versões v27–v28 vieram da trilha sonora. Histórico: v26: simulação por personagem no editor de cenas, opção de recolocar marcadores em “Aplicar”, mesa do celular com o mapa primeiro e controle de Interface compacto; nenhum arquivo novo na lista). A v25 acrescenta `js/help.js`, `js/help-policy.js` e os onze catálogos públicos `js/help/{conta,campanhas,sessoes,mesa,fichas,modelos,biblioteca,guilda,progresso,suporte,admin}.js` à lista explícita STATIC_PATHS. O precache transfere texto público estático; os catálogos só são importados e avaliados na primeira abertura de ⓘ de sua área. Não há conteúdo de conta ou jogo nesses arquivos.

A v25 incorpora o shell da implementação paralela Básica/Completa (scene-policy, scene-editor, interface-mode, grid-adjust e table-scenes), cuja versão intermediária foi v24. Revisão da lista mantém API, callbacks OAuth, query com token, perfis, mapas enviados, exploração, imagens mascaradas e PDFs fora do Cache Storage. Não usa skipWaiting forçado e não recarrega mesa ativa. Modelo em [AJUDA_CONTEXTUAL.md](AJUDA_CONTEXTUAL.md).

Cache público v21: inclui `fog-policy.js`, `fog-editor.js` e `table-settings.js` (névoa e configuração da mesa) e as mudanças em `table.js`, `table-map.js`, `campaign-assets.js`, `campaign-page.js`, `admin.js`, editor de fichas e `sessions.css`. Estado de névoa, imagens mascaradas e configurações são dados autenticados de `/api` e nunca entram no cache. Sem `skipWaiting` nem recarga de sessão ativa.

Login persistente (cache público v20): versão incrementada pelos ajustes em autenticação, roteamento, conta, cliente HTTP e CSS. A lista `STATIC_PATHS` foi revisada e permanece igual: nenhum dado de login, API, cookie ou destino de retorno entra no Cache Storage. O prazo do login continua sendo validado no servidor também no modo instalado. Não usa `skipWaiting` nem recarrega sessão ativa. Uma rota interna validada pode ficar temporariamente no `sessionStorage` durante OAuth, sem query ou credenciais.

Trilha sonora da sessão (cache público v28): acrescenta `soundtrack-policy.js`, `soundtrack-api.js`, `session-audio.js`, `table-soundtrack.js` e `admin-music.js` à lista explícita. Mudaram `music.js`, `table.js`, `admin.js`, `campaign-page.js`, `help-policy.js`, `pwa-policy.js`, os catálogos `help/mesa.js`, `help/admin.js` e `help/campanhas.js` e `sessions.css`. O catálogo, os bytes de áudio e o estado da trilha são `/api` e nunca entram no Cache Storage (o worker não intercepta `/api`). Sem `skipWaiting` nem recarga de sessão ativa. Ver [TRILHA_SONORA.md](TRILHA_SONORA.md).

## Contrato desta etapa

Eternnus pode ser adicionado à tela inicial como aplicação web, sem passagem por loja. O manifest identifica a aplicação por `/eternnus-rpg`, cobre o escopo `/`, inicia em `/#overview` e solicita apresentação `standalone`. Define cores de fundo/tema e ícones PNG de 192 e 512 px, incluindo composição apropriada para recorte maskable.

Arquivos compartilhados: `wwwroot/manifest.webmanifest`, `wwwroot/service-worker.js`, `wwwroot/js/pwa.js` e `wwwroot/js/pwa-policy.js`. A lista `STATIC_PATHS` e a função `cacheablePath` pertencem ao módulo de política; não duplicá-las em outro worker ou tela. Os ícones PNG, incluindo o ícone Apple de 180 px, são derivados da marca oficial, não uma marca alternativa.

O mesmo frontend e a mesma API atendem navegador e aplicação instalada. Instalar não confirma e-mail, não autentica uma conta e não altera permissões. O loading e os estados de acesso continuam com as mesmas regras.

## Instalação

| Ambiente | Caminho previsto | Limite |
| --- | --- | --- |
| Android/Chrome compatível | Usar a ação de instalação quando o navegador emitir `beforeinstallprompt`, ou a opção de instalar/adicionar oferecida pelo navegador. | O evento depende dos critérios/estado do navegador; não é garantido em toda visita ou quando o app já está instalado. |
| iPhone/Safari | Abrir o site, usar Compartilhar e “Adicionar à Tela de Início”; seguir a opção de abrir como aplicação web quando apresentada. | Fluxo manual; não se simula o prompt Android. Nomes/posição dos controles podem variar com a versão do sistema. |
| Desktop compatível | Usar a ação/ícone de instalação oferecido pelo navegador. | Instalação desktop não comprova o comportamento nos sistemas móveis. |

A instalação em produção exige HTTPS válido em `https://rpg.eternnus.com`. `localhost` é apropriado para desenvolvimento no próprio dispositivo; o IP HTTP de outra máquina não é a mesma exceção segura. Sem contexto adequado, a interface deve continuar utilizável como site e explicar a indisponibilidade de instalação, sem sugerir ignorar alertas de certificado.

A ação de instalação é discreta e opcional; usa o prompt capturado quando disponível e mostra instruções de menu/Safari quando não há evento. Não toma o foco de login/campanhas, não repete prompts automaticamente e não promete capacidades nativas não implementadas. Em modo standalone, o convite deixa de ser necessário. Orientação de instalação do iPhone segue o fluxo documentado pela [Apple](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios).

## Política do service worker

**Pode guardar:** shell HTML estático, CSS/JavaScript conhecidos, arte pública do cenário/logotipo, avatar padrão, manifest e ícones explicitamente permitidos.

**Nunca guardar:** `/api` e suas respostas; callbacks de Google/Discord; perfil ou dados autenticados; mensagens de e-mail; códigos/URLs de confirmação ou recuperação; respostas de autenticação/CSRF; avatares externos privados ou conteúdo arbitrário por simples correspondência de extensão.

Regras de manutenção:

1. A lista de cache é explícita. Não transformar em cache genérico de todos os GETs ou de toda navegação.
2. Navegação com query de token/fluxo de conta não deve ser armazenada nem convertida em uma cópia cacheada do link sensível. Em falha de rede, recebe somente a página pública `offline.html`, sem processar o token. Navegação comum sem query pode receber `index.html` estático.
3. API e OAuth permanecem Network Only. Não devolver um HTML offline como se fosse JSON ou resposta de autenticação.
4. Offline permite abrir a casca visual e informar indisponibilidade. Login, consulta, alteração de dados e confirmação de conta exigem rede.
5. Não persistir o estado de `state.js` para fabricar sessão offline. O backend continua sendo a fonte da identidade e das permissões.
6. Nunca incluir no precache pastas de e-mail, arquivos de configuração do servidor ou qualquer artefato de teste.

## Atualização sem misturar versões ativas

Ao alterar um arquivo controlado, incrementar a versão do cache e revisar a lista de recursos. O novo worker instala, mas não força `skipWaiting` enquanto houver abas usando a versão anterior; normalmente assume quando todas essas abas fecharem. O ciclo de vida do service worker foi escolhido para evitar trocar código sob uma interação ativa. [Referência do ciclo de vida](https://web.dev/articles/service-worker-lifecycle).

Uma publicação deve enviar uma versão coerente de HTML, módulos, CSS, manifest, ícones e worker. `/service-worker.js` recebe `Cache-Control: no-cache`; seu registro usa `updateViaCache: 'none'`. Não marcar todos os arquivos como imutáveis indefinidamente se os nomes não tiverem hash. A limpeza deve remover somente caches pertencentes à aplicação, conforme sua versão, sem apagar caches de outras aplicações da mesma origem.

### Versão atual

Versão histórica: `eternnus-public-shell-v19`. Incluiu o novo módulo público `map-picker.js`, acabamento compartilhado, jornada com progresso de conquistas e renderização evoluída dos cenários. Lista permitida revisada: nenhuma resposta do atlas, perfil, XP, sessão ou arquivo privado é armazenada. O worker continua aguardando o fechamento das versões anteriores, sem `skipWaiting` ou recarga automática. O parágrafo seguinte registra a evolução anterior.

`eternnus-public-shell-v18` inclui os módulos públicos de sessões/mesa, perfil, administração, suporte, biblioteca, Guilda, progressão, editor, fórmulas e ficha/PDF preenchido, além de campaign-assets, temporary-images e session-presence. A v18 também traz o explorador de pastas da aba Mapas e cenários (campaign-assets.js, policy.js e sessions.css) e corrige o histórico de sessão (session-history.js importava `guardAvatars` de forma ausente e a rota falhava). A v17 traz a página One-shot e leva Fichas-modelo para o Painel admin (Suporte e Fichas-modelo saem do menu do admin); a lista permitida foi revisada e permanece sem dados autenticados. A v16 ajusta o detector de manutenção para reconhecer também o HTML app_offline servido pelo IIS com status HTTP 200. A v15 incorporou o módulo público maintenance.js para detectar janelas de deploy sem recarregar uma aba ativa. A v14 atualizou a apresentação móvel da marca e da conta. Estado da mesa, mapas enviados, imagens temporárias, PDFs privados, fichas, perfil e histórico continuam fora do cache. A lista efetiva está em js/pwa-policy.js. As bibliotecas locais pdf.js/pdf-lib e suas fontes acompanham a publicação, mas são carregadas pela rede e não pertencem ao precache.

## Navegação inferior

No celular, os destinos principais ficam no rodapé fixo da área de aplicação. Cada item combina ícone e nome, mostra o ativo e conserva o estado de bloqueio de conta pendente. O conteúdo reserva espaço para a barra e para `safe-area-inset-bottom`; alvos principais têm pelo menos 44 px.

A mesa ao vivo é a exceção documentada na ADR-019: em modo imersivo, a barra de turno ocupa o rodapé fixo (mesmas regras de área segura e alvos de 44 px) e a saída fica no topo.

Conferir listas longas, formulários, modal, toast, rotação e teclado virtual. Instalação standalone não dispensa essa revisão. A tela de acesso mantém seu próprio foco em login/cadastro; não acrescentar uma barra de destinos que o usuário ainda não pode acessar.

## Verificação e limites

- Conferir manifest válido, caminhos dos ícones, escopo, identidade e apresentação.
- Confirmar que o worker registra e que os recursos públicos previstos entram no cache.
- Fazer login, abrir campanha e usar um link de recuperação; inspecionar os caches e garantir ausência de dados/API/tokens.
- Desligar a rede: o shell pode abrir e deve explicar que os dados precisam de conexão, sem sucesso fictício.
- Publicar uma versão de teste com cache incrementado: aba antiga permanece coerente; depois de fechar as abas antigas, a versão nova assume.
- Instalar em Android/Chrome e iPhone/Safari físicos via HTTPS; conferir ícone, abertura, login, retorno do SSO, teclado e área segura.

A validação desta entrega passou em nove testes específicos de política/comportamento do worker e 37 verificações HTTP de manifest, ícones, escopo e cabeçalhos. A navegação inferior foi conferida no navegador em layout móvel, sem overflow horizontal. Os comandos e evidências estão em `TESTES.md`.

A validação de registro/manifest no desktop é distinta do teste em aparelho. Esta documentação não declara instalação física iOS/Android como executada. Resultados devem ser registrados em `TESTES.md` somente após a verificação correspondente.

Avatares enviados pertencem à API autenticada e nunca são assets públicos/cacheáveis. O módulo estático de perfil integra a lista permitida no cache v11; dados e bytes pessoais continuam exclusivamente na rede.

### Atualização temporária do servidor (IIS/FTPS)

O GitHub Actions produz `app_offline.htm` autossuficiente com o splash oficial. Uma nova visita recebe esse HTML do IIS enquanto a aplicação está parada e tenta `/health` até o retorno. Uma aba já aberta usa `js/maintenance.js`: recebe `503` no health check e mostra a camada `#splash` existente sem recarregar. Quando `/health` volta a responder saudável, libera a interface, mas **não atualiza a página automaticamente**, pois isso poderia descartar edições ainda não enviadas. A interface pede que a pessoa salve suas mudanças antes de recarregar. O health check não entra no cache e somente HTTP 503 ou a página HTML de manutenção com marcador explícito acionam o modo de manutenção; uma queda aleatória de rede não aciona o modo. Não se promete recuperação de chamadas falhadas, uploads ou WebRTC em trânsito.


Cache público v22 (ADR-046): acrescenta `play-policy.js`, `table-tools.js`, `campaign-prep.js` e `invite.js` à lista permitida. `table.js`, `campaign-page.js`, `campaigns.js`, `layout.js`, `app.js`, `policy.js`, `one-shots.js`, `fog-policy.js`, `table-settings.js`, `styles.css` e `sessions.css` mudaram. Início (`/api/home`), convite, diário, cenas e pedidos de teste são dados autenticados de `/api` e nunca entram no cache. Sem `skipWaiting` nem recarga de sessão ativa.
