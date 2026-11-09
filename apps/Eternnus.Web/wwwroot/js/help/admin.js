// Texto público estático; catálogos avaliados sob demanda.
const entries = {
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
