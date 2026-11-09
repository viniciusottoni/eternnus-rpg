// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "guilda.posts.util": {
    "title": "Marcar como útil",
    "summary": "Você reconhece uma resposta que ajudou.",
    "body": [
      "Você não pode marcar sua própria mensagem. O controle mostra se você já marcou e quantas marcações a resposta recebeu.",
      "Regras de XP e tetos são conferidas no servidor. A marcação não concede permissões na plataforma."
    ],
    "audience": "all"
  },
  "guilda.equipe.moderacao": {
    "title": "Papéis e moderação",
    "summary": "Admin e Embaixador identificam a equipe.",
    "body": [
      "A equipe pode fixar, trancar, mover e moderar conteúdo da Guilda. Um tópico trancado aceita respostas apenas da equipe.",
      "Conteúdo removido pode aparecer com aviso; o texto reservado à equipe não é liberado aos demais usuários. Categorias são administradas pelo Admin."
    ],
    "audience": "ambassador"
  }
};
for (const entry of Object.values(entries)) {
  entry.body.forEach((part) => { if (typeof part === "object") { Object.freeze(part.list); Object.freeze(part); } });
  Object.freeze(entry.body);
  if (entry.related) Object.freeze(entry.related);
  Object.freeze(entry);
}
export default Object.freeze(entries);
