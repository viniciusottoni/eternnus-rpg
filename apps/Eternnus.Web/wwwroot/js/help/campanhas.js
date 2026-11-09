// Texto público estático; catálogos avaliados sob demanda.
const entries = {
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
      "A cópia não altera o original."
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
    "title": "Acervo da campanha",
    "summary": "O Mestre escolhe o que compartilha com o grupo.",
    "body": [
      "Bibliotecas, objetivos e pistas podem ficar em rascunho ou ser publicados. Jogadores recebem o conteúdo publicado.",
      "Mapas pertencem à campanha. Um mapa em uso precisa ser ocultado antes de editar ou excluir o arquivo."
    ],
    "audience": "all"
  },
  "campanhas.acervo.mapas": {
    "title": "Mapas e escala",
    "summary": "A grade e a escala ligam o mapa ao deslocamento.",
    "body": [
      "O Mestre organiza mapas em pastas e configura grade e escala. Os alcances em metros da ficha são convertidos em casas pela escala do mapa.",
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
