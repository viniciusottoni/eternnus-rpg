// Texto público estático; catálogos avaliados sob demanda.
const entries = {
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
      "Cada personagem pode ter até oito recursos. Colocar o original mantém sua referência; criar uma cópia para o encontro começa com os recursos cheios.",
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
