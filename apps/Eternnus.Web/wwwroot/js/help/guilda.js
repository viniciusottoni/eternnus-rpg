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
  "guilda.denuncias.ocultacao": {
    "title": "Denúncia e ocultação",
    "summary": "A primeira denúncia já oculta o conteúdo até a decisão da moderação.",
    "body": [
      "A mensagem denunciada some para todos, exceto a equipe e o autor. Se for a abertura, o tópico inteiro sai das listas e não recebe respostas até a decisão.",
      "A equipe remove o conteúdo ou arquiva a denúncia; arquivada, a mensagem volta a aparecer. Mensagens da equipe e mensagens já mantidas pela moderação (sem edição depois) entram na fila sem ser ocultadas.",
      "O autor não vê quem denunciou. Denúncias falsas ou repetidas podem levar a medidas da moderação."
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
