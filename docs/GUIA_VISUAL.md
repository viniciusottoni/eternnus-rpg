# Guia visual e componentes

Névoa e luz: jogador vê preto nas casas nunca vistas e penumbra nas exploradas; mestre vê véu translúcido, paredes (vermelho), bloqueio de movimento (âmbar), bloqueio de luz (azul), portas, focos (✹) e marcas (⚠ ▯ ✦); ocultos e percebidos têm contorno tracejado. A paleta de névoa reserva espaço acima do mapa (no celular o palco cresce), alvos de 44 px no celular, pintura por arraste ou teclado. Brilhos respeitam `prefers-reduced-motion` e pausam em aba oculta.

Evolução de novembro: [Jornada e atlas](PROGRESSAO_CENARIOS.md) documenta componentes de conquistas, atlas, seletor compartilhado e movimento. O token `--quiet` passa a `#a2a397` para reforçar legibilidade; cabeçalhos ganham separador de ouro discreto, campos mostram halo de foco, erros têm superfície contextual e modais usam entrada por opacidade. Campos móveis mantêm 16 px e alvos principais 44 px. Animações CSS pausam em aba oculta; canvas pausa o agendamento e remove listeners ao sair. Não se adicionam esperas às ações.

## Direção oficial

O foco visual é o game medieval dos mockups, emulado com elegância e simplicidade. O painel lateral ajuda a localizar informações; não deve substituir a atmosfera da referência por um dashboard genérico. Priorizar leitura, ações previsíveis e conteúdo relevante. Uma tela não deve exigir que o usuário decifre seus ornamentos para operar.

| Referência em `assets` | Aplicação |
| --- | --- |
| `Mockup - Tela 1.png` | Abertura centralizada, logotipo oficial, círculo rúnico, mensagem temática e dissolução. |
| `Mockup - Tela 2.png` | Login/cadastro no mesmo painel, ouro/metal escuro, acesso social e recuperação localizáveis. |
| `Mockup - Tela 3.png` | Perfil no painel, aviso de confirmação, estados bloqueado/liberado e atalhos claros. |
| `Mockup - Tela 4.png` | Lista horizontal de campanhas, papel, sistema, jogadores, atividade e ações conforme permissão. |
| `05_Campanha_Sessoes.png` | Página da campanha: banner, abas, histórico de sessões com miniatura, estado e ações, e cartão "Visão da campanha". |
| `06_Abrir_Sessao.png` | Modal de nova sessão: nome, objetivo do mestre, escolha visual de mapa e aviso de que a campanha ficará online. |
| `07_Mesa_Mestre.png` | Mesa do mestre: grupo à esquerda, mapa central com ferramentas, chat/rolagens/histórico/notas e barra de controle de turno. |
| `08_Mesa_Jogador.png` | Mesa do jogador: mapa compartilhado, sua ficha no painel e comandos habilitados somente na sua vez. |
| `09_Historico_Sessao.png` | Histórico: linha do tempo com horário, título e detalhe, busca, notas do mestre e resumo de alterações. |
| `Golden Valley Castle at Sunset.png` | Cenário oficial de castelo, montanhas, névoa e luz de entardecer. |
| `Eternnus RPG Dragonblade Logo.png` | Marca oficial: espada de aço, ouro envelhecido e serpente dracônica. |

Os mockups são especificações de composição, não imagens a serem usadas como uma tela única com texto embutido. Conteúdo e controles devem continuar sendo HTML acessível. Os originais são preservados; os derivados WebP em `wwwroot/assets` reduzem transferência sem redesenhar a marca.

## Tokens compartilhados

Fonte de verdade executável: `wwwroot/styles.css`. Alterar o token antes de introduzir uma cor/medida alternativa em vários componentes.

| Token | Valor base | Uso |
| --- | --- | --- |
| `--bg` | `#111110` | Fundo escuro neutro. |
| `--panel` / `--panel2` | `#181817` / `#22211e` | Superfícies estáveis para leitura. |
| `--line` | `#494337` | Divisores e estrutura discreta. |
| `--gold` / `--bright` | `#c6a463` / `#f1d79c` | Ouro envelhecido e destaque luminoso. |
| `--text` / `--muted` | `#f0ede5` / `#b0aea4` | Texto principal/secundário. |
| `--quiet` | `#a2a397` | Metadados menos prioritários, com contraste reforçado. |
| `--burgundy` | `#461f1c` | Tom medieval de aviso/ênfase contextual. |
| `--danger` | `#e2a18c` | Ações e feedback destrutivos. |
| `--steel` | `#bfc5c2` | Acentos de aço, sem competir com ouro. |
| `--serif` | Georgia / Times New Roman | Títulos e atmosfera medieval. |
| `--shadow` | `0 16px 44px #0005` | Profundidade de painéis. |
| `--radius` | `7px` | Raio de superfície compartilhado. |
| `--motion-fast` / `--motion-slow` | `180ms` / `650ms` | Resposta breve de controles e transições de cena. |
| `--sidebar-width` | `244px` | Largura base da navegação; adapta nos breakpoints. |
| `--mobile-nav-height` | `68px` no layout móvel | Altura útil da navegação inferior; a área segura é somada separadamente. |

Texto funcional usa fontes do sistema. O produto não depende de serviço externo de fontes. Cor é reforço, nunca o único indicador de erro, bloqueio ou papel.

## Hierarquia e composição

- **Acesso e abertura:** cenário de maior presença, logo central, formulário único com contraste e espaço. O usuário localiza imediatamente entrar, cadastrar, recuperar senha e provedores.
- **Início:** menu e perfil estáveis; saudação, cena de boas-vindas e quatro destinos. Para conta pendente, o banner de confirmação é a ação principal e os destinos ficam explicitamente bloqueados.
- **Campanhas:** título e “Nova campanha”; busca/ordenação; contagem e convite; lista e paginação. O cenário é atenuado atrás das linhas para não competir com nome, papel e ações.
- Uma ação principal visual por contexto. Usar ouro preenchido para continuar/criar/salvar, contorno neutro para alternativas e estilo destrutivo para exclusão.
- Não carregar na lista todas as informações de uma campanha. Nome, sistema, papel, jogadores e atualização bastam; narrativa detalhada, convite e entrada aparecem ao abrir. Nesta etapa, “Atualizada” é a última alteração de gestão da campanha, não a última mensagem/rolagem da mesa.
- Nomes e descrições extensos devem quebrar/limitar linhas sem empurrar controles para fora da tela. Não esconder informação essencial apenas em tooltip.

## Componentes e contratos

| Componente | Fonte | Contrato de reutilização |
| --- | --- | --- |
| Loading universal | `js/loading.js` / `#splash` | Mesmo cenário, logotipo e círculo rúnico da abertura em toda espera em primeiro plano, inclusive formulários e SSO. Abertura de 3.000 ms; demais esperas duram a operação, sem atraso mínimo. Sobrepõe modais, torna o conteúdo inerte e restaura foco. Atualização automática em segundo plano não interrompe tarefas. |
| Shell | `js/layout.js` | Renderiza menu, perfil, contexto, `#main` e rodapé. Uma funcionalidade não deve criar outro menu. |
| Navegação inferior móvel | `js/layout.js` / `styles.css` | Barra fixa com ícone e nome do destino, estado ativo e bloqueio coerente com a conta. Reserva espaço no conteúdo e respeita a área segura. |
| Instalação PWA | `js/pwa.js` | Ação discreta: usa o prompt capturado quando disponível e oferece instruções manuais nos demais casos, incluindo iPhone. Não bloquear a navegação nem repetir prompts forçadamente. |
| Superfície `.metal` | `styles.css` | Bordas de ouro/metal e relevo discreto; ornamentos ficam fora da área de leitura. |
| Botão/link de ação | `ui.button`, `.button`, `.primary`, `.subtle`, `.danger` | Botões para comandos, links para navegação. Estado disabled deve impedir ação e ter motivo quando relevante. |
| Campo `.field` | `ui.field` / `ui.passwordField` | Label permanente, autocomplete apropriado, limites e erro junto ao formulário. Nunca usar placeholder como único label. |
| Tooltip `.tooltip` | `help.tip`, `help.installHelp` | Até 80 caracteres; hover de 400 ms, foco imediato, Esc e aria-describedby. Não abre por toque. |
| Botão ⓘ `.help-button` | `help.helpButton` | Irmão do label em `.field-label`; nome Ajuda: tema, expanded/controls/haspopup; alvo de 44 × 44 px. |
| Popup de ajuda `.help-popup.metal` | `help.js` | Popover único não modal com foco e retorno, Fechar visível e folha móvel acima da navegação/área segura. Ver [AJUDA_CONTEXTUAL.md](AJUDA_CONTEXTUAL.md). |
| Formulário | `ui.submitForm` | Impede submissão repetida, sinaliza `aria-busy`, preserva erro legível e restaura o botão. |
| Modal | `ui.modal`, `#modal` | Título visível, botão fechar, cancelamento e foco de diálogo. Não abrir diálogos aninhados. |
| Banner de confirmação | `layout.renderHome` | Explica o bloqueio, mostra e-mail e oferece reenviar/já confirmei. Não promete entrega antes de resposta do servidor. |
| Card de destino `.feature-card` | `layout.renderHome` | Acesso verificado usa link; pendente usa superfície não clicável com indicação de bloqueio. |
| Linha `.campaign-row` | `campaigns.js` | Capa atmosférica, título, papel, metadados de atualização e ações. Ações vêm das capacidades retornadas e das regras compartilhadas. |
| Selo de estado `.online-badge` / `.offline-badge` / `.status-chip` | `sessions.css` | "ONLINE" com ponto pulsante, "Offline" neutro e "Encerrada". Texto sempre presente; a cor reforça. |
| Banner da campanha `.campaign-hero` | `campaign-page.js` | Cenário atenuado, nome, premissa, mestre, jogadores, sessões e acesso à mesa quando online. |
| Abas de página `.page-tabs` | `campaign-page.js`, `session-history.js` | Links com `aria-current`; a aba ativa usa o ouro preenchido. Rolagem horizontal em telas estreitas. |
| Linha de sessão `.session-row` | `campaign-page.js` | Miniatura por tipo de mapa, "Sessão NN — título", data, duração, eventos, notas e aventureiros; ações Histórico/Notas. |
| Escolha de mapa `.map-choice` | `campaign-page.js`, `table.js` | Rádio acessível em cartão com miniatura real (imagem ou tileset desenhado), tipo e descrição; seleção com borda e brilho. |
| Editor de ficha `.sheet-form` / `.action-row` | `sheet.js` | Atributos em grade, ações com nome/tipo/dados/efeito, adicionar/remover. Fórmula validada também no servidor. |
| Barra de vida `.hp-bar` | `sheet.js` | `role="meter"` com valores; tons saudável/ferido/crítico e texto "Vida: x/y". Largura aplicada via CSSOM (sem estilo inline, compatível com a CSP). |
| Mesa `.table-shell` | `table.js` | Grid imersivo: topo, grupo, palco, painel e barra de turno. Ver comportamento móvel abaixo. |
| Cartão do grupo `.party-card` | `table.js` | Avatar, personagem, nível, vida e presença. Turno atual com borda dourada e selo ⌛. Mestre (ou o próprio jogador) abre a ficha pelo cartão. Avatar enviado que não puder ser exibido a outro participante cai no avatar padrão (`guardAvatars`). |
| Tabuleiro `.board` | `table-map.js` | Canvas com foco visível; setas movem o cursor e Enter confirma; Esc cancela o modo. Marcadores: verde aliado, vermelho inimigo, aura dourada no turno atual. |
| Painel de registros `.side-panel` | `table.js` | Abas do mestre (Chat, Rolagens, Histórico, Notas) e do jogador (Chat, Rolagens, Sua ficha). Chat aceita `/r 1d20+3`. |
| Barra de turno `.turn-bar` | `table.js` | Mestre: registrar nota, mostrar mapa, definir turno, abrir ficha e próximo turno. Jogador: atacar, habilidade, magia, item, mover, defender e encerrar turno, desabilitados com motivo fora da vez. |
| Arauto de turno `.turn-herald` | `table.js` | Faixa "Turno de X" / "Seu turno, X" sobre o mapa por ~2 s; não captura cliques. |
| Linha do tempo `.timeline-item` | `session-history.js` | Horário, título, detalhe (antes → depois, rolagem, mapa) e ícone do tipo. |
| Feedback e vazio | `ui.toast`, `ui.empty`, `ui.formError` | Mensagens curtas em português, estados vivos acessíveis e orientação concreta de próximo passo. |

Os atributos `data-action` são comandos de interface, não autorização. Valores vindos do usuário passam por `esc()` ou `textContent`; classes/atributos livres não podem vir diretamente do banco.

## Estados obrigatórios

| Contexto | Estados a cobrir |
| --- | --- |
| Abertura | Visível por prazo programado; transição; movimento reduzido; rede indisponível sem prolongar indefinidamente. |
| Login/cadastro | Vazio, campos inválidos, enviando, sucesso, credenciais inválidas, limite temporário e provedor não configurado. |
| Confirmação | Pendente, envio solicitado, intervalo entre solicitações, link inválido/expirado/usado e conta liberada. |
| Campanhas | Carregando, lista, nenhum cadastro, busca sem resultado, erro, conflito de revisão e paginação. |
| Sessões | Carregando, sem sessões (convite para iniciar), lista paginada, sessão em andamento, conflito ao abrir segunda sessão. |
| Mesa | Campanha offline, escolha de ficha, sem ficha, conectando, conexão instável (faixa com nova tentativa), vez do jogador, aguardando, sessão encerrada (véu com destino), perda de acesso. |
| Histórico | Carregando, sem registros, busca sem resultado, paginação, sessão ativa (atalho para a mesa) e encerrada. |
| Ações destrutivas | Explicação da consequência, cancelar, confirmar, enviando e falha. Exclusão bloqueada informa que existem jogadores. |
| Ajuda contextual | Catálogo carregando, falha curta no popup com nova tentativa e chave inexistente sem quebrar a tela (botão omitido em produção). |

“Já confirmei” atualiza a conta; não exibe sucesso fictício. Reenvio não precisa prometer uma nova mensagem quando a solicitação ainda está no intervalo mínimo. Erros não devem apagar o formulário nem repetir comandos automaticamente.

## Movimento e acessibilidade

Ajuda: entrada por fade de 120 ms, removido com movimento reduzido. O popup recebe foco ao abrir; Esc, Fechar e clique fora devolvem ao ⓘ. Após re-render, usar o gatilho substituto; na ausência dele, fechar com foco no conteúdo principal. Esc fecha primeiro a ajuda e depois pode cancelar o modo da mesa. Texto necessário ao preenchimento permanece visível e associado por aria-describedby.

Movimento é ambiental: névoa lenta, brasas discretas, brilho suave e transição de entrada. Na mesa, o movimento comunica estado: chamas e água do tileset, revelação do mapa ao trocar, arauto de turno, brilho da barra no "Seu turno", lampejo vermelho/verde no cartão quando a vida muda e entrada de novos registros com dado girando. Tudo isso é removido ou fica estático com `prefers-reduced-motion`; o canvas pausa em aba oculta. Controles respondem rapidamente; não dançam nem mudam de posição durante a tarefa. Evitar parallax dependente do mouse, flashes e grandes deslocamentos de texto.

`prefers-reduced-motion: reduce` remove névoa/brasas e reduz as demais animações, preservando a funcionalidade e o prazo de abertura. A abertura é programada em 3.000 ms em `policy.js`; timers de navegador podem ser atrasados por suspensão da aba ou travamento, conforme ADR-004.

Manter foco visível, ordem de tabulação coerente, labels e nomes acessíveis, texto de erro associado ao contexto e estados anunciados. Provedores usam nome além do ícone. Conteúdo decorativo usa `aria-hidden`; logo e avatar relevante têm alternativas.

## Responsividade e revisão visual

O menu lateral usa 244 px no desktop e 220 px até 1.200 px; abaixo de 760 px, o layout migra para navegação inferior fixa e conteúdo em coluna. A barra de 68 px mantém cinco destinos com ícone e nome, usa alvos principais de 54 px e respeita `safe-area-inset-bottom`; o mínimo de manutenção é 44 px. Reservar no conteúdo a altura da navegação e da área segura, sem depender de um valor arbitrário que esconda a última linha. Conferir pelo menos tela estreita (~390 px) e desktop (~1.440 px). Critérios:

- Formulário inteiro operável sem zoom horizontal.
- Busca e filtros não sobrepõem botões; ações das linhas continuam localizáveis.
- Banner de confirmação não invade cards; títulos longos quebram corretamente.
- Fundo e efeitos não reduzem a leitura; contraste/foco permanecem claros.
- Modal cabe no viewport e pode rolar quando necessário.
- Barra inferior não cobre botões, campo focado, mensagem de erro ou toast; a interação com teclado virtual deve ser conferida em dispositivo real.
- Instalação em modo standalone mantém as mesmas dimensões/contraste e respeita as áreas seguras.
- Nenhum dado de outra conta ou token de e-mail aparece em imagens de validação.

No desktop (acima de 760 px), a barra lateral ocupa ao menos a altura da tela e, quando seu conteúdo é maior, desce junto com a página; o menu “Seu universo” não tem rolagem interna. Barras de rolagem do site são finas, em ouro envelhecido sobre trilho transparente (`styles.css`), sem setas.

No shell móvel (até 760 px), a faixa da marca tem 78 px mais a área segura superior. Logo e subtítulo ficam centralizados, com espaçamento vertical compacto. Avatar, nome, status, nível e “Sair da conta” ficam no painel “Mais”; os mesmos elementos retornam à barra lateral ao ampliar a tela, sem duplicação. O painel rola em telas baixas, mantém alvos de 44 px e devolve o foco ao botão “Mais” quando fechado com Esc.

Mesa no celular (≤ 900 px): topo com ações em linha própria; grupo em faixa horizontal com rolagem por cartão; mapa com altura proporcional à largura; painel abaixo; barra de turno fixa no rodapé com comandos roláveis horizontalmente e alvos de 44 px, somando `safe-area-inset-bottom`. A mesa não exibe a navegação inferior geral (ADR-019).

Um novo componente precisa ser descrito aqui com finalidade, estados e comportamento móvel antes de virar padrão para outras telas.


## Minha conta — edição

No login, o checkbox “Manter conectado por 14 dias” inicia desmarcado, tem label clicável de pelo menos 44 px e orientação para dispositivo pessoal; a escolha vale também para os botões sociais. O texto informa que administrador tem prazo menor. Em Minha conta, “Sair de todos os dispositivos” abre o modal compartilhado com consequência, cancelar, confirmação, loading e erro local. A perda de autenticação fecha o modal, descarta consultas/heartbeat/animações e mostra aviso acessível no login; após autenticar, retorna à rota anterior, sem reenviar ações interrompidas nem prometer preservar rascunhos.

Painel `.account-panel` mantém avatar, nome, e-mail e status. Nome e imagem têm formulários independentes, labels permanentes, erros locais e feedback de sucesso. Salvar nome atualiza também a identificação do menu; o envio de imagem substitui o avatar apenas após aprovação no servidor. O controle de arquivo aceita JPEG/PNG, informa limites e análise externa antes do envio. Sem configuração ou sem confirmação de e-mail, o campo fica desabilitado com motivo. Falha na consulta de disponibilidade orienta recarregar; nenhuma falha apaga nome/arquivo escolhido. Não há prévia pública de um arquivo ainda não aprovado. Usar loading universal durante envio/verificação, com a barra móvel e área segura preservadas ao retornar.


## Ondas A/B — componentes integrados

Biblioteca, suporte, painel, Guilda, progresso e modelos seguem o cenário/metal/ouro e componentes compartilhados; sua navegação e acesso estão descritos em PLATAFORMA.md. O menu móvel Mais mantém os destinos adicionais acessíveis sem comprimir alvos de toque. Vazios orientam o próximo passo; indisponibilidade e falhas mantêm os dados do formulário.

O editor de modelos oferece alças, guias e teclado (setas para mover, Shift para redimensionar, Alt para passo fino), desfazer/refazer, Ctrl+S, teste e publicação com lista de problemas. A ficha do jogador reutiliza o PDF com campos e zoom; o formulário acessível apresenta os mesmos valores com labels e controles maiores para celular/teclado. O banner de nova versão leva à prévia com valores preservados/ajustados/removidos, sem migração automática. Download exige dados salvos; o loading universal cobre preparação do PDF e ações de campanha, sem demora artificial.

Na ficha do jogador, conteúdo dos campos (inclusive números e calculados) fica alinhado à esquerda, tanto no preenchimento e leitura pela mesa como no PDF exportado. A posição e o tamanho dos campos continuam definidos pelo modelo.

## Campanhas e mesa — evolução

Campanhas mostram consumo de quota e escolha explícita do sistema; Minha conta repete os limites. One-shots exibem descarte/72h. A aba Bibliotecas reutiliza resource-card; a aba Mapas e cenários é um explorador de pastas (árvore com linhas de nível e ícones, caminho clicável, grade de pastas e miniaturas). Ambas reutilizam formulários, feedback e modais compartilhados; rascunhos e publicados têm rótulos claros. Ficha oferece opção privada somente ao dono, editor completo ao mestre autorizado e histórico reservado. Apresentação temporária aparece no grupo da mesa com estado de conexão, escolha de arquivo e comando de retirada do mestre. O fluxo do autenticador oferece chave manual e códigos de recuperação sem serviços externos de QR.


## Condução por contexto (ADR-046)

- **Mesa do jogador:** a barra inferior mostra, nesta ordem:
  - cartões de pedido de teste do mestre;
  - favoritas (até 3);
  - **✧ Ações** (agrupadas pelos nomes do sistema, sem grupos vazios);
  - **⬡ Rolar dados** (botão principal);
  - **▣ Minha ficha**;
  - **➤ Mover**, quando cabe;
  - **↶ Desfazer**, para o último ajuste próprio;
  - **✓ Encerrar a vez**, só com turnos e na própria vez.
  Bloqueios aparecem como texto abaixo da barra (`.turn-why`), ligado por `aria-describedby`.
- **Mesa do mestre:** barra com Cenas, Pedir teste, Rolar, Nota e Ficha. Ordem, Dar a vez e Próxima vez só aparecem com turnos. Ferramentas de preparo ficam em **⋯ Mais ferramentas**, no trilho do mapa.
- **Banner** (`.play-banner`, `role=status`) para pausa e espera do mestre, sobre o mapa e sem cobrir comandos.
- **Ficha resumida** (`.sheet-summary`): recursos com barra só quando há teto, botões −/+ de 44 px, destaques, condições e favoritas.
- **Construtor de rolagens:** dados como opções de 44 px (`.die-choice`), opções avançadas em `<details>` e prévia da notação ao vivo.
- **Celular (≤ 900 px):** navegação **Mapa | Ficha | Conversa** (`.table-view-switch`) acima da barra de turno; contador de novas mensagens; troca por CSS, que preserva campos e seleção.
- **Início:** seção "Próxima partida" (`.resume-card`) antes dos cartões de recursos, com pendências e agenda. A identidade (cenário, metal e dourado) é mantida.
- **Campanha:** abas Diário e Cenas e personagens; cartão **Primeiros passos** com link de convite; arquivar, restaurar e converter em Configurações, com motivo e consequências escritos.

## Ajuda contextual (ADR-047)

Seguir [AJUDA_CONTEXTUAL.md](AJUDA_CONTEXTUAL.md).

| Componente | Fonte | Contrato |
| --- | --- | --- |
| Tooltip `.tooltip` | `help.tip`, `help.installHelp` | Até 80 caracteres, hover 400 ms, foco imediato, Esc, aria-describedby, sem abertura por toque. |
| Botão ⓘ `.help-button` | `help.helpButton` | Ouro/metal, ícone serifado, alvo 44 px, irmão do label, nome Ajuda: tema, expanded/controls/haspopup. |
| Popup `.help-popup.metal` | `help.js` | Popover único não modal, foco inicial e retorno, folha móvel acima da barra e área segura, Fechar sempre visível. |

Estados obrigatórios da ajuda: catálogo carregando, falha curta com nova tentativa no popup e chave inexistente sem quebrar a tela (omitida em produção). Movimento e acessibilidade: fade curto, sem animação com movimento reduzido; Esc fecha primeiro a ajuda, depois permite cancelar o modo da mesa. Texto necessário ao preenchimento é sempre visível com aria-describedby.

## Editor de cenas e interface Básica/Completa (ADR-048)

| Elemento | Regra visual |
| --- | --- |
| Controle "Interface: Básica \| Completa" | Grupo de opções com legenda visível e estado escolhido marcado com "✓" além da cor. Fica no topo do editor e no topo da mesa do mestre; nunca aparece para jogadores. Compacto: as descrições das opções ficam associadas ao controle e explicadas no ⓘ, sem ocupar o topo. |
| Ferramentas do mestre | Ícone + rótulo visível (sem depender de dica). A Básica fica sempre no topo e na mesma posição; a Completa acrescenta grupos com título (Elementos, Paredes e portas, Luz e visão, Exploração, Grade e escala, Configuração). |
| Estado da preparação | Chips de texto: "Prévia privada — somente você vê.", "Em apresentação — os jogadores estão vendo esta cena.", "Alterações não salvas", "Alterações não aplicadas à mesa.". |
| Paleta ao vivo | Título do grupo, "Ao vivo: os jogadores veem as mudanças." e "Concluir". Ajuda curta e honesta sobre "Cobrir área". |
| Ações destrutivas | "Reiniciar cena…", "Remover da cena" e "Excluir cena" ficam em "Mais opções" ou no fim do painel, como links de texto; "Encerrar sessão" fica isolado no topo. |
| Celular (< 900 px) | Editor em tela cheia, ferramentas numa faixa horizontal com "Categoria" (uma por vez), prévia antes das propriedades; na mesa, vista Mapa com o tabuleiro logo após o topo (grupo do mestre na aba Grupo), aviso de pendência numa linha e trilho horizontal sobre o mapa; alvos de 44 px. |

Cartões de cena (campanha e mesa) usam miniaturas reais de `mapThumbnail` e o estado em texto (Preparada, Já visitada, Em apresentação). Regras completas em [CENAS_EDITOR.md](CENAS_EDITOR.md).


## Trilha sonora da sessão (ADR-049)

| Componente | Fonte | Contrato |
| --- | --- | --- |
| Selo `.session-audio` | `table-soundtrack.js` | No topo da mesa só com faixa selecionada: nota, título, estado anunciado (`aria-live`), silenciar pessoal e **Ativar áudio da sessão** quando bloqueado; abre a aba ♪ Trilha. A trilha global fica suspensa e oculta nesse intervalo. |
| Painel `.soundtrack` | `table-soundtrack.js` | Aba ♪ Trilha: faixa, estado, progresso (mestre: controle de posição; jogador: `role=progressbar`), duração e repetição. Mestre: tocar/pausar, ±10 s, repetir (`aria-pressed` e "✓"), parar e busca por nome no catálogo do servidor, sem envio. Todos: silenciar e volume pessoal, com aviso de que só mudam o próprio dispositivo. |
| Painel admin → Músicas (`.ml-*`) | `admin-music.js` | Aviso de direitos, uso da quota do catálogo, busca, linhas com formato/duração/tamanho, prévia, renomear, excluir e envio. Faixa tocando em sessão: exclusão bloqueada com motivo visível. |

Estados obrigatórios: sem trilha, carregando, tocando, pausada, terminou, bloqueado pelo navegador, faixa indisponível, catálogo vazio (a mesa explica que as faixas vêm da administração), busca sem resultado, erro com nova tentativa, faixa em uso e comandos indisponíveis com motivo (`#st-why`). Não prometer sincronização perfeita nem reprodução automática.

Celular (≤ 900 px): o selo ocupa linha própria no topo; alvos de 44 px no selo, nos controles e na lista; as abas do painel não quebram rótulo e rolam na horizontal. Movimento: pulso da nota e transição da barra removidos com `prefers-reduced-motion` e pausados em aba oculta.
