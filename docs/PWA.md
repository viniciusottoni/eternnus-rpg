# PWA e navegação no celular

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

`eternnus-public-shell-v16` inclui os módulos públicos de sessões/mesa, perfil, administração, suporte, biblioteca, Guilda, progressão, editor, fórmulas e ficha/PDF preenchido, além de campaign-assets, temporary-images e session-presence. A v16 ajusta o detector de manutenção para reconhecer também o HTML app_offline servido pelo IIS com status HTTP 200. A v15 incorporou o módulo público maintenance.js para detectar janelas de deploy sem recarregar uma aba ativa. A v14 atualizou a apresentação móvel da marca e da conta. Estado da mesa, mapas enviados, imagens temporárias, PDFs privados, fichas, perfil e histórico continuam fora do cache. A lista efetiva está em js/pwa-policy.js. As bibliotecas locais pdf.js/pdf-lib e suas fontes acompanham a publicação, mas são carregadas pela rede e não pertencem ao precache.

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
