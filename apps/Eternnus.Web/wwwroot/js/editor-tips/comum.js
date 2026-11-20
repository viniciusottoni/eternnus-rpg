// Dicas comuns aos editores de cena, de preparação do mapa e de mapa de imagem (ADR-124): navegação, atalhos, layout,
// histórico, rascunho e interface. Texto público revisado contra PREPARACAO_EDITOR.md §6–§7 e editor-core.js.
const d = (id, level, ctx, text, extra = {}) => Object.freeze({ id, level, ctx, text, ...extra });

export const TIPS = Object.freeze([
  // ---------- Navegação ----------
  d("g-nav-roda", 1, "*", "A roda do mouse aproxima e afasta no ponto do cursor. Aponte para onde quer olhar antes de girar."),
  d("g-nav-espaco", 1, "*", "Segure Espaço e arraste para mover a vista sem trocar de ferramenta. O botão do meio do mouse faz o mesmo."),
  d("g-nav-mao", 1, "*", "Mão (H) arrasta a vista pelo mapa sem risco de mover nada.", { tool: "hand" }),
  d("g-nav-zoom", 1, "*", "Zoom (Z): clique para aproximar; com Alt, afasta.", { tool: "zoom" }),
  d("g-nav-ajustar", 1, "*", "Ctrl+0 ajusta o mapa à tela; Ctrl+1 mostra em 100%."),
  d("g-nav-mais-menos", 2, "*", "Ctrl++ e Ctrl+− mudam o zoom em passos, sem o mouse."),
  d("g-nav-pinca", 1, "*", "No toque, use a pinça com dois dedos para aproximar e afastar."),
  d("g-nav-camera", 3, "*", "Mover a vista e dar zoom nunca muda as coordenadas dos elementos: é só a sua câmera."),
  d("g-nav-zoom-status", 2, "*", "O valor do zoom na barra de estado é um botão: clique para ajustar o mapa à tela."),

  // ---------- Ferramentas e atalhos ----------
  d("g-tool-selecionar", 1, "*", "Selecionar e mover (V) é a ferramenta segura: nada é pintado sem querer.", { tool: "select" }),
  d("g-tool-letras", 2, "*", "Cada ferramenta tem uma letra. Passe o mouse sobre o botão para ver o atalho e o que ela faz."),
  d("g-tool-indisponivel", 1, "*", "Ferramenta apagada? Passe o mouse sobre ela: a dica explica o motivo e o que fazer."),
  d("g-tool-campos", 2, "*", "Os atalhos de letra não agem enquanto você digita num campo. Ctrl+S e Esc continuam valendo."),
  d("g-tool-esc", 1, "*", "Esc cancela a ação em andamento, como um traço pela metade ou uma seleção."),
  d("g-tool-contexto-letra", 3, "*", "A letra de uma ferramenta de outro contexto leva direto a esse contexto, já com a ferramenta escolhida."),
  d("g-busca", 1, "*", "Ctrl+K ou / abre a Busca de ações: digite o que quer fazer, como parede ou revelar, e tecle Enter."),
  d("g-busca-completa", 2, "*", "A Busca de ações também encontra ferramentas da Completa; escolher uma troca a interface para você.", { ui: "basic" }),
  d("g-busca-lateral", 3, "*", "A Busca de ações leva também a Organizar, Adicionar, Configurar e Histórico, sem procurar a aba."),
  d("g-menu-direito", 1, "*", "Botão direito abre as ações do elemento ou da área sob o cursor."),
  d("g-contextos-alt", 2, "*", "Alt+1 a Alt+6 trocam o contexto pelo teclado, na ordem dos botões do topo."),
  d("g-contexto-nada-muda", 1, "*", "Trocar de contexto não salva, não desfaz e não muda seleção, zoom ou alterações não salvas."),
  d("g-contexto-lembra", 3, "*", "O editor lembra o último contexto escolhido para cada tipo de documento neste navegador."),

  // ---------- Desfazer, salvar e rascunho ----------
  d("g-desfazer", 1, "*", "Ctrl+Z desfaz; Ctrl+Shift+Z ou Ctrl+Y refazem. Teste à vontade."),
  d("g-historico", 2, "*", "O relógio ao lado das abas da lateral abre o Histórico: clique numa etapa para voltar até ela.", { ui: "complete" }),
  d("g-historico-limite", 3, "*", "O Histórico guarda até 100 etapas desta edição. Um arraste inteiro conta como uma etapa só.", { ui: "complete" }),
  d("g-salvar", 1, "*", "Ctrl+S salva sem tirar as mãos do teclado, mesmo com o foco num campo."),
  d("g-rascunho", 1, "*", "O editor guarda um rascunho neste navegador cerca de 2 segundos depois de cada mudança. Uma queda não leva seu trabalho."),
  d("g-rascunho-restaurar", 2, "*", "Ao reabrir um documento com rascunho, escolha Restaurar rascunho, Descartar ou Decidir depois."),
  d("g-rascunho-menu", 3, "*", "Arquivo › Rascunho local… reabre a decisão sobre um rascunho que você deixou para depois."),
  d("g-rascunho-limites", 3, "*", "Rascunhos locais duram até 30 dias, até 30 por conta e 8 MiB cada. Salvar apaga o rascunho."),
  d("g-rascunho-status", 2, "*", "A barra de estado mostra Salvo às hh:mm ou Rascunho local hh:mm: veja ali se algo ficou pendente."),
  d("g-outra-aba", 3, "*", "Abriu o mesmo documento em outra aba? O editor avisa quando a outra aba salva, para você não sobrescrever."),
  d("g-versoes-nome", 2, "*", "Em Arquivo › Versões…, guarde a versão atual com um nome antes de uma mudança grande."),
  d("g-versoes-carregar", 3, "*", "Carregar uma versão a coloca no editor como alteração desfazível. Nada muda até você salvar."),
  d("g-versoes-limite", 3, "*", "Ficam as 20 versões automáticas mais recentes e até 20 versões com nome por documento."),
  d("g-fechar", 2, "*", "Fechar com alterações não salvas pede confirmação. Fechar sem salvar apaga o rascunho local."),

  // ---------- Layout e barra lateral ----------
  d("g-lateral-areas", 1, "*", "A barra lateral tem três áreas: Organizar (camadas e elementos), Adicionar (acervo) e Configurar (documento)."),
  d("g-lateral-inspetor", 1, "*", "Propriedades, no alto da lateral, mostra só o que vale para a seleção atual."),
  d("g-lateral-largura", 2, "*", "Arraste o divisor vertical para alargar a barra lateral. Com ele em foco, as setas também ajustam."),
  d("g-lateral-altura", 2, "*", "O divisor horizontal da lateral ajusta a altura de Propriedades em relação às áreas de baixo."),
  d("g-lateral-ordem", 3, "*", "O botão ⋮ de cada painel recolhe ou muda a ordem dos painéis. A escolha fica salva neste navegador."),
  d("g-maximizar", 2, "*", "Ctrl+\\ maximiza a área de edição, escondendo lateral, réguas e esta faixa. O mesmo atalho traz tudo de volta."),
  d("g-reguas", 2, "*", "As réguas medem em metros pela grade. Exibir › Réguas liga e desliga."),
  d("g-reguas-cursor", 3, "*", "A linha dourada nas réguas acompanha o cursor: útil para medir distâncias de cabeça."),
  d("g-barra-posicao", 2, "*", "Exibir › Barra de propriedades põe esta faixa acima ou abaixo da área de edição, ou a oculta."),
  d("g-layout-padrao", 3, "*", "Bagunçou os painéis? Exibir › Restaurar layout padrão volta tudo ao início sem mexer no documento."),
  d("g-tela-cheia", 2, "*", "Exibir › Tela cheia aproveita o monitor inteiro para preparar mapas grandes."),
  d("g-tamanho-status", 2, "*", "O tamanho na barra de estado é um botão: clique para abrir o ajuste de tamanho do documento."),
  d("g-organizar-ctrl", 2, "*", "Em Organizar, Ctrl+clique soma itens à seleção e Shift+clique seleciona um intervalo."),
  d("g-organizar-alvo", 2, "*", "O alvo ao lado de um item em Organizar o localiza no mapa; a seleção comum não mexe na câmera."),
  d("g-ajuda", 1, "*", "Os botões ⓘ explicam cada área com mais detalhes. Esta faixa traz dicas curtas enquanto nada está selecionado."),

  // ---------- Interface Básica e Completa ----------
  d("g-interface", 1, "*", "Interface Básica mostra o essencial; a Completa acrescenta grupos avançados. Trocar não muda nada no documento.", { ui: "basic" }),
  d("g-interface-volta", 2, "*", "Na Completa tudo da Básica continua no mesmo lugar. Volte para a Básica quando quiser menos botões.", { ui: "complete" }),
  d("g-interface-conta", 3, "*", "A escolha entre Básica e Completa fica na sua conta e vale também na mesa ao vivo."),
]);
