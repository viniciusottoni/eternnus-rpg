// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "campanhas.preparo.colecoes": {title:"Coleções, favoritos e recentes", summary:"Vistas automáticas da campanha inteira que não movem nem copiam itens.", body:["Coleções reúnem itens de todas as pastas por um critério: Favoritos, Recentes, Cenas prontas para apresentar, Cenas incompletas, Personagens sem ficha completa e Mapas não usados. Os itens continuam nas suas pastas; use “Mostrar na pasta” para ir até um deles.","Marque favoritos pela estrela na barra, no painel de detalhes ou no menu do item. Recentes mostra o que você abriu neste navegador e o que foi modificado nos últimos 14 dias.","Para criar a sua coleção, defina uma busca ou filtros e use “Salvar como coleção…”. Favoritos, recentes e coleções salvas ficam guardados só neste navegador, para a sua conta e esta campanha."], audience:"master", related:["campanhas.preparo.filtros","campanhas.preparo.explorador"]},
  "campanhas.preparo.filtros": {title:"Filtros e itens incompletos", summary:"Filtre por tipo, origem, data, uso, preparo e pasta; veja o que falta em cada item.", body:["Os filtros valem para a pasta aberta, para as subpastas ou para a campanha toda (campo Onde). Com filtros ativos, as pastas saem da lista e só os itens aparecem. Origem vale só para mapas; Uso vale para mapas (cenas ou mesa) e cenas (apresentadas); Preparo vale para cenas e personagens.","Uma cena está incompleta quando: usa mapa ou imagem e não tem cenário (ou o cenário não existe mais); é cena com mapa e não tem nenhum marcador; ou não tem texto para ler à mesa. Cenas textuais não precisam de mapa.","Um personagem está incompleto quando não tem ficha-modelo vinculada ou não tem resumo. Um mapa não usado é aquele que nenhuma cena usa e que não está na mesa.","As indicações aparecem em texto no item e no painel de detalhes; nada é alterado automaticamente."], audience:"master", related:["campanhas.preparo.colecoes","campanhas.preparo.explorador"]},
  "campanhas.preparo.explorador": {title:"Gerenciador da Preparação", summary:"Cenas, mapas e personagens do mestre num só lugar, organizados em pastas.", body:["As três pastas-raiz (Cenas, Mapas e Personagens) são fixas. Crie subpastas livres dentro de cada uma, até oito níveis e 100 pastas por categoria. Cada item só pode ficar em pastas da própria categoria.","Clique seleciona; Ctrl+clique e Shift+clique selecionam vários; duplo clique abre. O botão direito mostra as ações do item. Atalhos: F2 renomeia, Delete exclui, Ctrl+C, Ctrl+X e Ctrl+V copiam, recortam e colam, Ctrl+A seleciona tudo.","Arraste itens para uma pasta da árvore, do conteúdo ou do caminho para movê-los. Mover ou renomear não muda vínculos: cenas continuam usando o mesmo mapa e a mesa continua funcionando.","Os cenários prontos do Eternnus não aparecem como arquivos: use-os em Novo mapa › A partir de modelo ou em Nova cena › A partir de mapa. Excluir uma pasta exige que ela esteja vazia."], audience:"master"},
  "campanhas.mapas.novo": {title:"Novo mapa", summary:"Crie do zero ou a partir de um cenário pronto, sem alterar o original.", body:["Criar do zero: envie uma imagem do aparelho, importe por link https, importe um arquivo VTT, desenhe com tiles a partir de um mapa vazio ou comece por uma área em branco. Grade, movimentação livre, escala e alinhamento continuam disponíveis, com prévia antes de confirmar.","A partir de modelo: escolha um cenário pronto pela miniatura, dê um nome e uma pasta. Você recebe uma cópia própria e editável; o cenário oficial nunca muda. Modelos de tiles continuam editáveis por casa.","Depois de criar, o editor abre. Nada é mostrado aos jogadores até você levar o mapa à mesa."], audience:"master"},
  "campanhas.cenas.nova": {title:"Nova cena", summary:"Comece uma cena vazia ou a partir de um mapa existente.", body:["Do zero: abre o editor sem mapa. Uma cena pode ser só texto, uma imagem sem grade ou um mapa tático; escolha o cenário depois, se quiser.","A partir de mapa: aparecem primeiro os mapas que você criou ou importou, depois os criados a partir de modelos e, por fim, os modelos oficiais. A cena usa o mapa sem copiar a imagem; o mesmo mapa pode servir a várias cenas.","Preparar a cena não apresenta nada: o grupo só vê quando você apresentar na mesa."], audience:"master"},
  "campanhas.cenas.camadas": {title:"Camadas da cena", summary:"Organize marcadores por camada sem mudar o que os jogadores veem.", body:["A Base mostra o mapa usado pela cena; ela é editada no editor de mapas. Elementos e as camadas extras agrupam personagens, criaturas e marcadores.","O olho, o cadeado e a opacidade das camadas da cena valem só no editor, para organizar o trabalho. Para esconder um marcador dos jogadores, use “Oculto” nas propriedades dele.","Paredes, portas, luzes, névoa e marcas continuam na preparação do mapa, com as ferramentas próprias."], audience:"master"},
  "campanhas.mapas.imagem": {title:"Editor de mapas de imagem", summary:"Componha o mapa com imagens, textos e formas em camadas.", body:["Use Selecionar para mover, redimensionar pelas alças e girar pela alça superior. Shift mantém a proporção, Alt transforma a partir do centro e as setas ajustam a posição.","Clique com o botão direito num elemento para editar propriedades, duplicar, mudar de camada, bloquear, ocultar ou trazer para frente. O painel Estrutura localiza qualquer elemento.","Salvar gera a imagem do mapa a partir das camadas visíveis e guarda o documento editável. Mapas em uso na mesa precisam sair da mesa antes de serem editados."], audience:"master"},
  "campanhas.mapas.area-visivel": {title:"Área visível e área externa", summary:"Só a área visível vira o mapa; o resto continua editável.", body:["A área visível (moldura) define o tamanho do mapa, a grade e o que a mesa mostra. Em volta fica a área externa: posicione imagens maiores que o mapa, enquadre só a parte desejada ou guarde objetos para depois.","Nada é cortado nos dados: o recorte acontece só ao salvar a imagem do mapa. A parte externa nunca chega aos jogadores.","Tamanho do documento distingue mudar só a área visível, redimensionar todo o conteúdo e recortar para uma região. Mudar a grade de um mapa preparado pede confirmação: paredes e névoa seguem as casas e marcadores fora da nova grade saem das preparações."], audience:"master"},
  "campanhas.editor.camadas": {title:"Camadas", summary:"Base e Elementos sempre existem; crie até seis camadas extras.", body:["A Base guarda o terreno ou a imagem principal. Elementos recebe o que fica por cima: árvores, móveis, construções, personagens. Ambas são obrigatórias e podem ser renomeadas e bloqueadas.","Clique no nome para escolher a camada ativa; duplo clique renomeia. O olho mostra ou oculta e o cadeado impede mudanças. As setas mudam a ordem das camadas extras, que ficam sempre acima de Elementos.","Em mapas de tiles, uma árvore em Elementos fica sobre a grama da Base sem apagá-la. Camadas extras ocultas ficam fora da mesa; a Base sempre vale para passagem e visão."], audience:"master"},
  "campanhas.editor.rascunhos": {title:"Rascunho local e versões", summary:"Alterações não salvas ficam guardadas neste navegador; cada salvamento vira uma versão.", body:["Enquanto você edita, o documento é guardado neste navegador cerca de 2 segundos depois de cada mudança e ao fechar ou esconder a página. Se o navegador fechar sem salvar, ao reabrir o mesmo mapa ou cena o editor oferece Restaurar rascunho, Descartar ou Decidir depois. A barra de estado mostra a hora do último salvamento e do último rascunho.","O rascunho guarda só o documento (nada de senhas ou e-mails), vale para a sua conta neste navegador e some ao salvar, ao fechar sem salvar por escolha sua ou ao sair da conta. Se o documento foi salvo em outro lugar depois do rascunho, salvar o rascunho mostra o conflito: recarregue a versão salva (o rascunho continua em Arquivo › Rascunho local…) ou salve uma cópia.",{list:["Arquivo › Versões… lista as versões salvas no servidor: uma automática a cada salvamento (as 20 mais recentes) e até 20 com nome, que você mantém.","Carregar uma versão a coloca no editor como alteração desfazível; nada muda na campanha até você salvar, com as mesmas regras de sempre (mapa na mesa, preparação, revisão).","Versões de cenas guardam a preparação da cena; a preparação do mapa (paredes, luzes, névoa) e a exploração dos jogadores não entram."]}], audience:"master", related:["campanhas.editor.atalhos"]},
  "campanhas.editor.atalhos": {title:"Atalhos do editor", summary:"Teclado e mouse como num editor gráfico.", body:[{list:["Roda do mouse: zoom no ponto do cursor. Espaço ou botão do meio + arrastar: mover a vista. Pinça no toque.","Ctrl+0 ajusta à tela, Ctrl+1 mostra em 100%, Ctrl++ e Ctrl+− mudam o zoom.","Ctrl+Z desfaz; Ctrl+Shift+Z ou Ctrl+Y refaz. Ctrl+S salva.","Ctrl+C, Ctrl+X e Ctrl+V copiam, recortam e colam; Delete exclui; Ctrl+D desmarca; Esc cancela a ação.","Letras escolhem ferramentas (veja o nome de cada botão). Atalhos não agem enquanto você digita num campo."]},"O botão direito abre as ações do elemento ou da área. Fechar com alterações não salvas pede confirmação."], audience:"master"},
  "campanhas.editor.contextos": {title:"Contextos, barra de propriedades e layout", summary:"Mostre só as ferramentas da tarefa atual e ajuste o editor ao seu jeito.", body:["Os contextos (Elementos, Terreno, Paredes e portas, Iluminação, Exploração, Cena) são modos de trabalho do mesmo documento: escolhem quais ferramentas e painéis aparecem. Trocar de contexto não salva, não desfaz e não muda seleção, zoom ou alterações não salvas. Alt+1 a Alt+6 trocam pelo teclado; a letra de uma ferramenta de outro contexto leva até ele.",{list:["Barra de propriedades: acima ou abaixo da área de edição, mostra os campos simples do que está selecionado (posição, tamanho, giro, opacidade, camada) e ações rápidas. Escolha a posição ou oculte em Exibir.","Maximizar (Ctrl+\\): esconde painéis e réguas por um momento; o mesmo botão traz tudo de volta.","Painéis: o botão ⋮ de cada painel recolhe, expande e muda a ordem; o divisor ajusta a largura.","Exibir › Restaurar layout padrão volta tudo ao início. Essas escolhas ficam só neste navegador, na sua conta, e nunca mudam o mapa ou a cena."]},"No editor de mapas de imagem: Ctrl+G agrupa e Ctrl+Shift+G desagrupa; clicar num membro seleciona o grupo, a Estrutura escolhe um só. Com dois ou mais selecionados, as alças redimensionam e giram o conjunto. As guias magnéticas encaixam nas bordas e centros dos outros elementos (Exibir › Encaixar em objetos; Ctrl ao arrastar ignora)."], audience:"master", related:["campanhas.editor.atalhos","campanhas.editor.camadas"]},
  "campanhas.mapas.tiles": {
    "title": "Criar mapas com tiles",
    "summary": "Monte seu cenário, salve no acervo e escolha quando mostrar ao grupo.",
    "body": [
      "Só o Mestre cria e edita mapas. Comece vazio ou copie um cenário pronto. Escolha tiles no catálogo: cada peça indica se permite passagem ou bloqueia passagem e visão. Lava e água profunda bloqueiam; o fundo submerso permite movimento.",
      "Use pincel, retângulo preenchido ou preenchimento de área ligada. Capturar tile escolhe a peça de uma casa. Setas e Enter pintam pelo teclado; arrastar mapa e zoom ajudam a percorrer o desenho. Desfazer e Refazer guardam até 30 etapas nesta edição.",
      "Use de 8 a 64 casas por lado e marque pelo menos seis entradas para os aventureiros. A escala define quantos metros uma casa representa. Os mapas de tiles compartilham o limite de 50 mapas da campanha.",
      "Salvar não apresenta o mapa. Ele passa a aparecer no acervo e na escolha de cenários das cenas e sessões. Névoa, luz e personagens são preparados depois, pelos controles existentes.",
      "Troque o mapa que está na mesa antes de editar. Alterar terreno já preparado exige confirmar a recriação da névoa, paredes, luzes e marcas e a remoção dos marcadores preparados/salvos nas cenas. Textos e fichas de personagens continuam; posicione os marcadores novamente. Salvar cópia preserva o original. Mapas de tiles são táticos, não imagens para retratos ou publicação no atlas."
    ],
    "audience": "master"
  },
  "campanhas.continuidade.origem": {title:"Origem e continuidade", summary:"Continue uma campanha sem reconstruir todas as sessões.", body:["Escolha se a história começa agora ou se veio de outra mesa. Onde paramos e o arco atual são compartilhados com o grupo.","A numeração mínima vale para próximas sessões e não renumera registros existentes. Corrigir a origem preserva o acervo."], audience:"all"},
  "campanhas.acervo.cadernos": {title:"Acervo e cadernos", summary:"Páginas do mundo e notas pessoais têm acesso próprio.", body:["O mestre organiza o mundo. Cada pessoa escreve seu caderno. Só eu exclui inclusive o mestre; compartilhar permite leitura.","Segredos e versões anteriores ficam com quem pode editar. Capítulos podem pertencer a um livro. A lixeira permite recuperar páginas."], audience:"all"},
  "campanhas.continuidade.historico": {title:"Histórico anterior", summary:"Registre partidas jogadas antes de chegar ao Eternnus.", body:["O mestre informa número, título, resumo e, se souber, a data. Só registros publicados aparecem aos jogadores.","Opcionalmente, registre cada cena separadamente, com título e o que aconteceu, na ordem da sessão.","Esses registros não criam presença, rolagens ou XP retroativo. A próxima sessão continua depois do maior número conhecido."], audience:"all"},
  "campanhas.capitulos.organizacao": {title:"Capítulos, atos e arcos", summary:"Agrupe as sessões da campanha em partes da história.", body:["Crie capítulos, atos ou arcos antes de abrir as sessões e escolha um ao iniciar cada partida. O tipo é só um rótulo; a ordem é a que você definir.","Sessões do Eternnus e registros anteriores podem ficar avulsos e mudar de capítulo depois. Excluir um capítulo não apaga sessões: elas ficam avulsas.","Somente o mestre organiza. Novos capítulos ficam ocultos; ao marcar “Visível para os jogadores”, o grupo passa a ver tipo, título, resumo e as sessões já publicadas daquele capítulo.","Para o jogador, sessões de capítulos ainda ocultos aparecem sem capítulo."], audience:"all"},
  "campanhas.sessoes.tabela": {title:"Tabela de sessões", summary:"Sessões no Eternnus e anteriores, numa só lista pesquisável.", body:["A coluna Origem diferencia as partidas jogadas no Eternnus das registradas antes da plataforma. Busque por nomes, lugares ou acontecimentos: a busca olha título, resumo e cenas.","Jogadores veem só resumos e registros publicados pelo mestre. O objetivo inicial e os rascunhos ficam com o mestre.","O mestre pode importar várias sessões e capítulos de uma vez com o modelo CSV. A prévia mostra o que será criado e os erros por linha; nada é gravado antes da confirmação."], audience:"all"},
  "campanhas.busca.geral": {title:"Busca na campanha", summary:"Procura em todo o conteúdo que você pode ler.", body:["Encontra sessões, páginas do mundo, suas notas, objetivos, pistas, NPCs conhecidos e a premissa. O mestre também encontra capítulos, cenas preparadas e notas dos personagens.","Cada resultado leva à tela onde o conteúdo está. Conteúdo privado de outras pessoas nunca aparece."], audience:"all"},
  "campanhas.lista.papeis": {
    "title": "Mestre e Jogador",
    "summary": "Seu papel depende da campanha.",
    "body": [
      "O Mestre conduz a campanha e administra seus recursos. O Jogador participa com sua ficha e recebe o conteúdo compartilhado.",
      "Papéis da equipe, como Embaixador, não concedem acesso automático às campanhas de outras pessoas."
    ],
    "audience": "all"
  },
  "campanhas.conta.limites": {
    "title": "Limites da conta",
    "summary": "Campanhas e one-shots usam quotas diferentes.",
    "body": [
      "Uma conta comum dispõe de três campanhas persistentes, somando as que mestra e as de que participa. Campanhas arquivadas continuam contando.",
      "Você tem dez participações vitalícias em one-shots. Sair ou encerrar não devolve essa participação. Nível e XP não ampliam quotas. Administradores e Embaixadores não têm esses limites."
    ],
    "audience": "all"
  },
  "campanhas.config.forma-de-jogar": {
    "title": "Forma de jogar",
    "summary": "Livre, Por turnos e Tática organizam as ações.",
    "body": [
      "Livre permite ações sem esperar a vez. Por turnos permite que o Mestre conceda a vez. Tática acrescenta grade e deslocamento aos turnos.",
      "A sessão guarda a forma ao abrir. O Mestre pode mudar a configuração da sessão; mudar o padrão da campanha orienta as próximas sessões."
    ],
    "audience": "all"
  },
  "campanhas.convite.codigo": {
    "title": "Convite da campanha",
    "summary": "Compartilhe o convite apenas com quem deseja convidar.",
    "body": [
      "Você precisa entrar na conta e confirmar o e-mail antes de participar. O convite pode ficar guardado enquanto você confirma a conta.",
      "O servidor confere o convite, o acesso e a quota ao entrar. Ter o código não permite administrar a campanha."
    ],
    "audience": "all"
  },
  "campanhas.config.modelo": {
    "title": "Ficha-modelo da campanha",
    "summary": "A escolha orienta as novas fichas.",
    "body": [
      "O Mestre escolhe um modelo publicado e ativo do sistema da campanha. Sem escolha específica, vale o padrão do sistema ou o Sistema livre.",
      "Fichas existentes mantêm o modelo e a versão que já usam. Trocar a escolha não migra essas fichas."
    ],
    "audience": "all"
  },
  "campanhas.config.arquivamento": {
    "title": "Arquivar e restaurar",
    "summary": "Arquivar guarda o conteúdo e impede novas partidas.",
    "body": [
      "O Mestre precisa encerrar a sessão ativa antes de arquivar. O histórico e o diário compartilhado continuam legíveis.",
      "A campanha arquivada continua ocupando uma vaga. Restaurar volta a permitir preparação e sessões."
    ],
    "audience": "all"
  },
  "campanhas.one-shot.continuidade": {
    "title": "One-shot e continuidade",
    "summary": "Uma one-shot abre uma única sessão temporária.",
    "body": [
      "A mesa dura no máximo 72 horas. Se o Mestre se desconectar, ela entra em espera recuperável pelo prazo informado na mesa. Pausar não suspende esse prazo.",
      "Encerrar remove o conteúdo da mesa e preserva fichas pessoais, XP e o recibo da participação. O Mestre pode converter em campanha se tiver vaga; jogadores sem vaga precisam voltar depois pelo convite."
    ],
    "audience": "all"
  },
  "campanhas.preparo.cenas": {
    "title": "Cenas preparadas",
    "summary": "O Mestre prepara e apresenta cenas para a mesa.",
    "body": [
      "Retomar recupera marcadores e exploração guardados. Reiniciar volta ao arranjo preparado e recomeça a exploração.",
      "Guardar arranjo usa as posições atuais como preparo. Trocar o mapa da cena descarta os arranjos ligados à grade anterior."
    ],
    "audience": "master"
  },
  "campanhas.preparo.personagens": {
    "title": "Personagens do Mestre",
    "summary": "O Mestre pode guardar personagens e criar cópias para encontros.",
    "body": [
      "O cadastro guarda nome, tipo, lado, resumo, imagem e notas. Vida e recursos ficam em “Ficha”: escolha um modelo ou use até oito recursos simples.",
      "Colocar o original mantém sua referência; criar uma cópia para o encontro começa com os recursos cheios.",
      "A cópia não altera o original.",
      "Os NPCs da campanha nascem aqui. Use “+ História” para escrever a história do personagem em Páginas: a página fica ligada a ele e aparece como “Ler página” em NPCs conhecidos para quem puder lê-la."
    ],
    "audience": "master"
  },
  "campanhas.preparo.modelos-privados": {
    "title": "Modelos privados",
    "summary": "O Mestre cria modelos próprios para sua campanha.",
    "body": [
      "Membros podem usar os modelos privados da campanha. Criar ou editar esses modelos não concede o papel de Embaixador.",
      "Publicar uma versão nova não muda automaticamente as fichas já criadas."
    ],
    "audience": "master"
  },
  "campanhas.acervo.publicacao": {
    "title": "Textos antigos",
    "summary": "Textos de antes das Páginas; o Mestre converte cada um em página.",
    "body": [
      "O acervo da campanha (lore, objetivos e pistas) fica em Mundo e acervo › Páginas. Converter copia título e texto: publicado vira “Toda a mesa”, rascunho vira “Só eu”.",
      "Mapas pertencem à campanha. Um mapa em uso precisa ser ocultado antes de editar ou excluir o arquivo."
    ],
    "audience": "all"
  },
  "campanhas.acervo.linha-do-tempo": {
    "title": "Linha do tempo",
    "summary": "A história da campanha em ordem, com relato completo ao abrir cada ponto.",
    "body": [
      "O Mestre cria cada ponto à mão: título, quando aconteceu (texto livre, como “Ano 1042 da Era do Fogo”), descrição curta e relato completo. Nada é preenchido a partir de sessões ou capítulos.",
      "A ordem é a escolhida pelo Mestre, não pela data. Início e fim são opcionais; sem eles, a linha fica com as pontas abertas.",
      "O grupo vê apenas os pontos marcados como “Mostrar ao grupo”. Rascunhos ficam visíveis só para o Mestre."
    ],
    "audience": "all"
  },
  "campanhas.acervo.mapas": {
    "title": "Mapas e escala",
    "summary": "A grade e a escala ligam o mapa ao deslocamento.",
    "body": [
      "O Mestre organiza mapas em pastas e configura grade e escala. Os alcances em metros da ficha são convertidos em casas pela escala do mapa.",
      "A imagem pode vir do aparelho ou de um link https. Com link, o Eternnus baixa uma cópia uma única vez; depois ela é tratada como um envio e os jogadores não acessam o site de origem.",
      "Os cenários do atlas são públicos e não exigem nível. Mapas enviados e suas imagens mascaradas exigem acesso à campanha."
    ],
    "audience": "master"
  },
  "campanhas.acervo.movimentacao": {
    "title": "Movimentação livre",
    "summary": "Personagens e criaturas ficam em qualquer ponto da imagem, sem se prender às casas.",
    "body": [
      "Apenas imagem serve para mostrar ao grupo, sem marcadores. Usar grade faz cada personagem ocupar uma casa. Movimentação livre deixa arrastar e soltar em qualquer ponto, e vários marcadores podem ficar próximos ou dividir a mesma área.",
      "A grade continua como referência: a escala converte o deslocamento da ficha em distância, e paredes, portas, luz e névoa seguem as áreas da grade. Na mesa a grade fica oculta; use Mostrar grade para vê-la.",
      "Na forma tática, o alcance aparece como um círculo em volta do personagem e é medido em linha reta. Pelo teclado, as setas escolhem uma área e Enter posiciona no centro dela."
    ],
    "audience": "master"
  },
  "campanhas.cenas.preparacao": {
    "title": "Preparar e apresentar",
    "summary": "Salvar a preparação não apresenta a cena aos jogadores.",
    "body": [
      "Você pode preparar cenário, texto, visibilidade e marcadores antes de apresentar. O editor serve à campanha, ao mapa compartilhado e à preparação durante a mesa.",
      "Apresentar ou retomar usa a preparação salva conforme o estado da cena. Reiniciar volta ao arranjo preparado e recomeça a exploração."
    ],
    "audience": "master"
  },
  "campanhas.cenas.aplicar": {
    "title": "Aplicar à cena atual",
    "summary": "Você escolhe quais partes salvas passam a valer agora.",
    "body": [
      "O Mestre pode aplicar texto, visibilidade e preparação do mapa à cena em apresentação. Salve a preparação antes de aplicar.",
      "Posições dos personagens, criaturas, exploração, portas alteradas na partida e áreas reveladas continuam como estão. Trocar o cenário preparado exige Reiniciar cena para usá-lo na mesa."
    ],
    "audience": "master"
  },
  "campanhas.cenas.alcance": {
    "title": "Alcance da preparação",
    "summary": "A preparação pode pertencer ao mapa ou só à cena.",
    "body": [
      "Compartilhada com o mapa vale para cenas que usam esse mapa no modo compartilhado; a exploração também é compartilhada.",
      "Própria desta cena começa como a do mapa e depois segue separada, sem duplicar a imagem. Não é possível trocar esse alcance enquanto a cena está em apresentação."
    ],
    "audience": "master"
  },
  "campanhas.cenas.simulacao": {
    "title": "Simulação de visão",
    "summary": "A prévia usa as regras da mesa e a visão da ficha do personagem escolhido.",
    "body": [
      "Ver como jogador no editor simula luz, áreas reveladas e, em “Visão de”, a visão da ficha de um personagem posicionado. Sentidos especiais, Percepção e o que o grupo já explorou ficam de fora.",
      "Na mesa, Ver como consulta a visão exata do Jogador escolhido. Escolher um cenário no editor muda apenas a prévia até você apresentar ou aplicar."
    ],
    "audience": "master"
  },
  "campanhas.mapas.pincel": {title:"Tamanho do pincel", summary:"Pinte ou apague várias casas de uma vez.", body:["O pincel e a borracha cobrem 1, 2, 3 ou 5 casas por lado. O formato redondo vale a partir de 3 casas (3 forma uma cruz; 5, um disco). O contorno aparece sob o cursor antes de pintar.","[ diminui e ] aumenta o pincel. Cada traço vira uma única etapa do histórico.","O preenchimento pinta a área ligada de casas iguais na camada; clicando dentro de uma seleção, ele fica limitado a ela. Áreas grandes e a troca de um tile por outro (Editar › Substituir tile…) mostram as casas atingidas destacadas no mapa e pedem confirmação."], audience:"master"},
  "campanhas.mapas.mistura": {title:"Mistura de tiles", summary:"Varie o terreno sem pintar casa por casa.", body:["Adicione à mistura dois ou mais tiles que vão para a mesma camada (só terrenos, ou só natureza, construções e objetos). Com \"Pintar com a mistura\" ligado, pincel, retângulo, preenchimento e seleção sorteiam um tile da mistura em cada casa.","O sorteio é repetível: a mesma casa recebe o mesmo tile. \"Nova variação\" muda o sorteio das próximas pinturas. Entradas do grupo não entram na mistura."], audience:"master"},
  "campanhas.mapas.alinhamento": {title:"Assistente de alinhamento", summary:"Alinhe a grade em poucos cliques.", body:["Detectar automaticamente procura linhas regulares na imagem. Funciona melhor em mapas com grade desenhada; confira o resultado na prévia.","Marcar uma casa: clique em dois cantos opostos de uma casa do desenho. Marcar N casas: clique em dois cruzamentos de linhas na mesma linha ou coluna e informe quantas casas há entre eles; é o modo mais preciso para casas com fração de pixel.","Aproxime a prévia com + para marcar com precisão; arrastar continua movendo a vista. O resultado aparece antes de valer: Usar este alinhamento confirma e Cancelar volta aos valores anteriores. Os controles de tamanho e alinhamento continuam para o ajuste fino.","A grade é quadrada. Grades hexagonais e isométricas ainda não são oferecidas porque mudariam distância, movimento e visão na mesa."], audience:"master"},
  "campanhas.mapas.grade": {
    "title": "Grade e escala",
    "summary": "Ajuste a grade antes de preparar paredes e névoa.",
    "body": [
      "Tamanho do quadrado e alinhamento fazem a grade coincidir com a imagem. A escala informa quantos metros cada casa representa.",
      "A grade aceita até 100 casas por lado e 4.096 no total. O ajuste de uma imagem vale para as cenas que a usam. Um mapa em apresentação precisa sair da mesa antes do ajuste."
    ],
    "audience": "master"
  }
};
for (const entry of Object.values(entries)) {
  entry.body.forEach((part) => { if (typeof part === "object") { Object.freeze(part.list); Object.freeze(part); } });
  Object.freeze(entry.body);
  if (entry.related) Object.freeze(entry.related);
  Object.freeze(entry);
}
export default Object.freeze(entries);
