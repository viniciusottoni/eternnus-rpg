// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "admin.loja.link": {
    "title": "Cadastro por link de afiliado",
    "summary": "Cole o link de afiliado, revise os dados e publique.",
    "body": [
      "Aceita links https da Amazon, da Shopee e do Mercado Livre, inclusive encurtados das próprias lojas. O link é guardado como foi informado, com os parâmetros de afiliado, e é o destino aberto pelos usuários.",
      "“Buscar dados” lê apenas metadados públicos da página quando a leitura está ligada para a loja (por padrão, Shopee e Mercado Livre). Nenhuma API oficial está integrada: o que não for encontrado fica para preenchimento manual, e nada é publicado sem revisão.",
      "Preço e disponibilidade só são exibidos com a confirmação “Conferi agora na loja”, que registra a data. Depois da validade configurada, o público vê “Consultar preço na loja”."
    ],
    "audience": "admin",
    "related": [
      "admin.loja.recomendacao"
    ]
  },
  "admin.loja.recomendacao": {
    "title": "Como a recomendação ordena",
    "summary": "Primeiro o sistema da campanha; prioridade comercial só desempata.",
    "body": [
      "Os produtos entram em grupos fixos: sistema da campanha aberta (ou da campanha ativa mais recente), sistemas das outras campanhas, genéricos, outros sistemas ligados aos interesses do usuário e, por fim, os demais.",
      "Dentro de cada grupo pesam interesses consentidos, categorias que o próprio usuário abriu, imagem e descrição, preço conferido, novidade, popularidade interna e a prioridade administrativa. Nenhum desses fatores muda o grupo.",
      "A vitrine evita repetir loja e categoria quando há alternativa próxima e alterna produtos empatados a cada janela de rotação."
    ],
    "audience": "admin",
    "related": [
      "admin.loja.metricas"
    ]
  },
  "admin.loja.metricas": {
    "title": "Indicadores da loja",
    "summary": "Cliques agregados; sem CTR, receita ou dados individuais.",
    "body": [
      "Cada clique em “Ver oferta” é registrado por usuário, produto e origem (vitrine, página da loja ou detalhe), contado uma vez a cada 30 minutos e guardado por 365 dias.",
      "Impressões não são registradas, por isso não há CTR. Receita, comissão e conversões dependem de integração oficial com as lojas e não são exibidas. O painel nunca mostra termos, mensagens ou interesses de usuários."
    ],
    "audience": "admin"
  },
  "admin.usuarios.planos": {
    "title": "Planos de conta",
    "summary": "Basic, Plus, Pro e Max definem os limites da conta.",
    "body": [
      "Basic: 3 campanhas, 10 one-shots, 5 fichas, campanhas com até 5 jogadores e one-shots com até 8, 500 MB e arquivos de até 20 MB. Plus: 5 campanhas, 15 one-shots, 10 fichas, mesas de até 8 jogadores, 2 GB e 30 MB. Pro: 10 campanhas, 30 one-shots, 20 fichas, mesas de até 15 jogadores, 4 GB e 60 MB. Max: sem limite de campanhas, one-shots, fichas e jogadores, 20 GB e 100 MB.",
      "O limite de jogadores vem do plano de quem mestra a mesa. Embaixadores e Admins usam o Max enquanto tiverem o papel. Reduzir o plano não apaga nada; só bloqueia novas criações e envios acima do novo limite. Toda troca exige motivo e entra na auditoria."
    ],
    "audience": "admin"
  },
  "admin.usuarios.papeis": {
    "title": "Papéis da plataforma",
    "summary": "Só Admin altera papéis pela gestão auditada.",
    "body": [
      "Conta comum joga, mestra e participa da Guilda. Embaixador também publica materiais, cria fichas-modelo e modera a Guilda.",
      "Admin administra usuários, sistemas e chamados. O servidor protege o último administrador e exige autenticador para acesso administrativo."
    ],
    "audience": "admin"
  },
  "admin.sistemas.identificador": {
    "title": "Identificador do sistema",
    "summary": "O identificador organiza a referência do sistema.",
    "body": [
      "Use o formato indicado no campo. Sistemas inativos deixam de aparecer nas novas campanhas, mas não apagam as antigas.",
      "O Sistema livre é protegido. Sistemas em uso não podem ser excluídos; desative para impedir novas escolhas."
    ],
    "audience": "admin"
  },
  "admin.acoes.auditoria": {
    "title": "Motivo e auditoria",
    "summary": "Ações administrativas registram ator e motivo.",
    "body": [
      "Você precisa informar o motivo quando o formulário exigir. Confira a consequência visível antes de confirmar uma ação sobre conta ou campanha.",
      "Suspensão impede o acesso e invalida sessões. Excluir uma campanha remove seus dados conforme a confirmação. A ajuda não concede autorização."
    ],
    "audience": "admin"
  },
  "admin.musicas.catalogo": {
    "title": "Catálogo de músicas",
    "summary": "Faixas do servidor que os Mestres buscam e tocam na mesa.",
    "body": [
      "Envie somente músicas que a plataforma tem autorização para usar: composição própria, licença adquirida ou domínio público. Não baixe músicas de outros serviços.",
      {
        "list": [
          "Formatos: MP3, M4A (AAC) ou OGG. MP3 toca na maior parte dos aparelhos.",
          "Até 20 MB por arquivo, 200 faixas e 2 GB no catálogo.",
          "O conteúdo real do arquivo é conferido no servidor e passa pela verificação de segurança. Arquivos repetidos são recusados."
        ]
      },
      "O título é o nome que os Mestres buscam. Mestres e Jogadores não enviam músicas; Jogadores só recebem a faixa que estiver tocando na sessão. Envio, renomeação e exclusão ficam na auditoria. Uma faixa tocando em sessão ativa só pode ser excluída depois que o Mestre parar ou trocar a música."
    ],
    "audience": "admin",
    "related": [
      "mesa.trilha.compartilhada"
    ]
  }
};
for (const entry of Object.values(entries)) {
  entry.body.forEach((part) => { if (typeof part === "object") { Object.freeze(part.list); Object.freeze(part); } });
  Object.freeze(entry.body);
  if (entry.related) Object.freeze(entry.related);
  Object.freeze(entry);
}
export default Object.freeze(entries);
