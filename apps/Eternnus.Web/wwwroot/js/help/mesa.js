// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "mesa.mapa.camera": {
    "title": "Ampliar e percorrer o mapa",
    "summary": "No celular, o mapa ocupa a área disponível sem deformar a grade.",
    "body": [
      "O mapa abre ampliado no celular. Arrastar mapa desloca apenas a sua visão; não move personagens nem altera a névoa. Use a rolagem para alcançar as bordas. A pinça de dois dedos aproxima ou afasta só o mapa, do encaixe inteiro até três vezes a escala que preenche a janela.",
      "Mapa inteiro mostra todo o cenário de uma vez; Ampliar mapa volta a preencher o espaço. Em mapas com outra proporção, partes ficam fora da janela e podem ser alcançadas arrastando.",
      "Desative Arrastar mapa para tocar nos personagens e casas. Escolher uma ferramenta de movimento ou pintura também volta à interação. As setas percorrem as casas e mantêm o cursor visível; Enter confirma.",
      "Os botões + e − também ajustam o zoom. Esta câmera é compartilhada com a preparação de cenas e mapas. As barras superior e inferior rolam lateralmente. A câmera é pessoal e não muda o que o servidor permite enxergar."
    ],
    "audience": "all"
  },
  "mesa.tela.horizontal": {
    "title": "Mesa na horizontal",
    "summary": "No celular, vire a tela para usar o mapa e os comandos lado a lado.",
    "body": [
      "A mesa aguarda a orientação horizontal. Ative a rotação automática do aparelho se a tela continuar em pé. Voltar à campanha permanece disponível.",
      "Tela cheia tenta fixar a orientação quando o navegador permite. Nos demais navegadores, vire o aparelho manualmente. Ao sair da mesa, a orientação é liberada.",
      "Mapa amplia o cenário. Grupo, Ficha e Conversa abrem um painel ao lado dele. As faixas de ferramentas e ações podem ser deslizadas na horizontal."
    ],
    "audience": "all"
  },
  "mesa.config.heranca": {
    "title": "Configuração da mesa",
    "summary": "O Mestre pode ajustar a sessão ou toda a campanha.",
    "body": [
      "O padrão vem do sistema e pode ser substituído na campanha. Uma sessão pode ter seu próprio ajuste.",
      "Ao salvar na campanha toda, o ajuste vale para esta sessão e para as próximas. Voltar ao padrão remove a substituição correspondente."
    ],
    "audience": "master"
  },
  "mesa.config.nevoa": {
    "title": "Névoa e exploração",
    "summary": "A névoa limita o que cada Jogador recebe do mapa.",
    "body": [
      "Casas nunca vistas ficam escuras. Áreas exploradas podem ficar atenuadas, sem mostrar criaturas.",
      "A luz, a visão e as revelações do Mestre determinam as casas visíveis. Mapas cartográficos não têm névoa. Pixels já recebidos não podem ser recolhidos."
    ],
    "audience": "all"
  },
  "mesa.config.revelacao-manual": {
    "title": "Revelação manual",
    "summary": "O Mestre escolhe as casas reveladas.",
    "body": [
      "Com a névoa ativa e a revelação manual, luz e visão não revelam casas sozinhas.",
      "O Mestre pode clarear ou escurecer casas com as ferramentas de névoa."
    ],
    "audience": "all"
  },
  "mesa.config.caminho": {
    "title": "Movimento por caminho livre",
    "summary": "A névoa pode exigir um caminho conhecido e livre.",
    "body": [
      "O Jogador contorna paredes, portas fechadas e casas ocupadas. O caminho não atravessa casas desconhecidas nem corta cantos entre dois bloqueios.",
      "O servidor confere o caminho e o deslocamento. Uma recusa não informa o terreno ou ocupante escondido."
    ],
    "audience": "all"
  },
  "mesa.config.aliados": {
    "title": "Aliados visíveis",
    "summary": "Esta opção mantém criaturas aliadas visíveis no escuro.",
    "body": [
      "Personagens dos jogadores são sempre visíveis. A opção estende essa visibilidade às criaturas aliadas.",
      "Criaturas inimigas e neutras dependem da visão atual e das regras de ocultação."
    ],
    "audience": "all"
  },
  "mesa.config.luz-visao": {
    "title": "Luz e visão",
    "summary": "Luz ilumina o mapa; visão própria serve ao dono da ficha.",
    "body": [
      "Tochas, braseiros e criaturas usam raios em casas. Os papéis Luz e Visão da ficha usam metros, convertidos pela escala do mapa.",
      "O valor padrão do personagem vale quando o modelo não tem o papel correspondente. Luz e visão param nos bloqueios de luz. Uma criatura oculta não emite luz."
    ],
    "audience": "all"
  },
  "mesa.nevoa.ferramentas": {
    "title": "Ferramentas de névoa",
    "summary": "O Mestre edita casas, portas, luzes e marcas.",
    "body": [
      "Parede bloqueia movimento e luz. Os bloqueios separados impedem apenas movimento ou apenas luz. Porta fechada bloqueia ambos; aberta permite passagem.",
      "Foco espalha luz em círculo. Marca oculta pode ser revelada manualmente ou por percepção e sentidos, conforme a configuração."
    ],
    "audience": "master"
  },
  "mesa.nevoa.visao": {
    "title": "Modos de visão",
    "summary": "O Mestre pode conferir a visão de um Jogador.",
    "body": [
      "Ver como mostra o mapa e os marcadores que o Jogador selecionado recebe. Voltar à visão do Mestre encerra essa prévia.",
      "A cena pode mostrar tudo, usar revelação manual ou visão por personagem. A configuração detalhada continua disponível."
    ],
    "audience": "master"
  },
  "mesa.turnos.ordem": {
    "title": "Ordem de turnos",
    "summary": "O Mestre organiza a vez de personagens e grupos.",
    "body": [
      "Você pode ordenar manualmente ou pela iniciativa informada. Rolar iniciativa é opcional; o sistema não aplica regras automáticas de cada RPG.",
      "Próxima vez avança na ordem. Encerrar a vez termina a vez atual. Em Livre, as ações não dependem de vez."
    ],
    "audience": "all"
  },
  "mesa.rolagem.mecanicas": {
    "title": "Como ler os dados",
    "summary": "Escolha a mecânica da rolagem.",
    "body": [
      "Somar totaliza dados e modificador. kh mantém os maiores; kl, os menores; dh descarta os maiores; dl, os menores.",
      "Explosão rola novamente no valor máximo, com limite de 100 dados extras. Sucessos conta dados que atingem o valor indicado. No percentual, lte aceita total igual ou menor; gte aceita igual ou maior."
    ],
    "audience": "all",
    "example": "Em 4d6 com kh e quantidade 3, você soma os três maiores dados."
  },
  "mesa.rolagem.visibilidade": {
    "title": "Quem vê a rolagem",
    "summary": "Só o Mestre escolhe; o servidor aplica a escolha.",
    "body": [
      "Só o Mestre escolhe quem vê. Nas próprias rolagens: mesa inteira, somente ele ou ele e os jogadores que marcar (um ou mais).",
      "As rolagens dos jogadores seguem a configuração da mesa: mesa inteira, quem rolou e o Mestre, ou somente o Mestre. Neste último caso o jogador recebe só a confirmação de envio, sem o resultado.",
      "Nos pedidos de teste, o Mestre escolhe entre as mesmas três opções das rolagens dos jogadores."
    ],
    "audience": "all"
  },
  "mesa.rolagem.formula": {
    "title": "Fórmula de rolagem",
    "summary": "A fórmula avançada substitui os dados escolhidos acima.",
    "body": [
      "Você pode usar os nomes numéricos da ficha com @nome. Ao digitar @, aparecem os atributos disponíveis; use as setas e Enter para inserir. O servidor valida e rola os dados.",
      "Sem critério de alvo, o servidor não declara sucesso ou falha. Regras que a plataforma não implementa são interpretadas pelo Mestre."
    ],
    "audience": "all",
    "example": "2d6 + @forca_mod"
  },
  "mesa.npcs.ficha": {
    "title": "Ficha de NPC ou criatura",
    "summary": "Acompanhe vida, atributos e o estado de cada NPC ou criatura.",
    "body": [
      "Escolha qualquer modelo de ficha aceito pela campanha: o mesmo dos jogadores ou outro, como um modelo próprio para criaturas.",
      "No mapa, selecione o marcador e use “Ficha do elemento”. Trocar o modelo recomeça os valores. Só você, Mestre, vê e edita essas fichas."
    ],
    "audience": "master"
  },
  "mesa.npcs.imagem": {
    "title": "Imagem de NPC ou criatura",
    "summary": "A imagem vira o retrato do marcador no mapa; quem o enxerga também pode abri-la maior.",
    "body": [
      "Prefira uma imagem do acervo da campanha: ela fica no servidor e só chega a quem enxerga o marcador.",
      "Um link https carrega a imagem direto do site de terceiros: esse site vê o endereço IP de quem abre e pode trocar o conteúdo depois.",
      "Marcadores ocultos ou apenas percebidos (“?”) não mostram a imagem.",
      "Para trocar ou remover depois, selecione o marcador e abra “Ficha do elemento”."
    ],
    "audience": "master"
  },
  "mesa.testes.pedidos": {
    "title": "Pedidos de teste",
    "summary": "O Mestre pede uma rolagem a personagens selecionados.",
    "body": [
      "Você pode manter até cinco pedidos abertos. Cada personagem responde uma vez; cancelar impede novas respostas.",
      "O alvo e a comparação são opcionais. Sem critério, o Mestre interpreta o resultado. A visibilidade também vale para a resposta do pedido."
    ],
    "audience": "master"
  },
  "mesa.acoes.desfazer": {
    "title": "Desfazer uma mudança",
    "summary": "Movimento e ajuste de recurso podem ser corrigidos.",
    "body": [
      "O Mestre ou o autor autorizado pode desfazer um evento elegível. A correção só acontece se o estado ainda corresponde ao resultado do evento.",
      "Outra mudança posterior pode impedir a correção. Rolagens e ações não são desfeitas."
    ],
    "audience": "all"
  },
  "mesa.mapa.legenda": {
    "title": "Marcadores, vida e presença",
    "summary": "O mapa e o grupo usam texto junto das cores.",
    "body": [
      "Aliados usam verde, inimigos vermelho e a vez atual recebe destaque dourado. A barra de vida mostra o valor e o máximo quando a ficha permite a leitura.",
      "A presença vem da renovação de conexão. Uma pessoa sem renovação por 45 segundos aparece ausente; isso não encerra uma campanha persistente."
    ],
    "audience": "all"
  },
  "mesa.chat.comandos": {
    "title": "Conversa e dados",
    "summary": "Você pode rolar dados pela conversa.",
    "body": [
      "Envie /r seguido da fórmula para registrar uma rolagem. A conversa continua disponível durante a pausa.",
      "Para escolher quem vê o resultado e outras mecânicas, use Rolar dados."
    ],
    "audience": "all",
    "example": "/r 1d20+3"
  },
  "mesa.imagens.temporarias": {
    "title": "Imagens temporárias",
    "summary": "O Mestre apresenta uma imagem aos navegadores conectados.",
    "body": [
      "Os bytes passam entre os navegadores. A imagem não vira arquivo do acervo e é descartada ao sair.",
      "Conexões entre redes restritas podem falhar. Retirar a apresentação não apaga uma cópia que alguém já guardou."
    ],
    "audience": "master"
  },
  "mesa.interface.apresentacao": {
    "title": "Interface Básica e Completa",
    "summary": "A escolha muda as ferramentas mostradas, sem mudar as regras.",
    "body": [
      "Básica mostra o essencial para preparar e conduzir. Completa acrescenta grupos de ferramentas de paredes, luz, exploração, grade e configuração.",
      "Ajustes avançados ativos continuam valendo na Básica. Você pode conferir o aviso e voltar à Completa para editar. A preferência fica na sua conta; não altera a interface dos jogadores."
    ],
    "audience": "master"
  },
  "mesa.trilha.compartilhada": {
    "title": "Trilha sonora compartilhada",
    "summary": "O Mestre escolhe e controla a mesma música para toda a mesa.",
    "body": [
      "As músicas vêm do catálogo do servidor, mantido pela administração. Somente o Mestre busca a faixa pelo nome, toca, pausa, para, muda a posição e liga a repetição. Quem entra ou volta à mesa acompanha o ponto atual da música.",
      "Volume e silenciar são pessoais: mudam o som só no seu dispositivo.",
      "Cada aparelho calcula a posição pelo relógio do servidor e corrige desvios aos poucos. Rede lenta, economia de energia ou o próprio navegador podem causar pequenas diferenças entre os participantes."
    ],
    "audience": "all",
    "related": [
      "mesa.trilha.ativar-audio"
    ]
  },
  "mesa.trilha.ativar-audio": {
    "title": "Ativar áudio da sessão",
    "summary": "Alguns navegadores só tocam som depois de um toque ou clique.",
    "body": [
      "Quando o navegador bloqueia a reprodução automática, a mesa mostra Ativar áudio da sessão. Depois do toque, a música começa no ponto em que a mesa está.",
      "Ao voltar de outra aba ou do bloqueio do aparelho, o som é realinhado sozinho. Se o navegador bloquear de novo, o botão volta a aparecer."
    ],
    "audience": "all"
  }
};
for (const entry of Object.values(entries)) {
  entry.body.forEach((part) => { if (typeof part === "object") { Object.freeze(part.list); Object.freeze(part); } });
  Object.freeze(entry.body);
  if (entry.related) Object.freeze(entry.related);
  Object.freeze(entry);
}
export default Object.freeze(entries);
