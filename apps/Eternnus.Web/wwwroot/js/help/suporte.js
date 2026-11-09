// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "suporte.chamados.categorias": {
    "title": "Categorias e acompanhamento",
    "summary": "Escolha a categoria que melhor descreve o problema.",
    "body": [
      "Você acompanha a conversa em Meus chamados. Informe o contexto e os passos para reproduzir um erro, sem enviar senhas ou códigos.",
      "O status indica o andamento. A prioridade e a atribuição são gerenciadas pela equipe administrativa; não representam promessa de prazo."
    ],
    "audience": "all"
  },
  "suporte.chamados.limite": {
    "title": "Limite de chamados",
    "summary": "O formulário informa quantos chamados você pode manter abertos.",
    "body": [
      "Se você atingir o limite, acompanhe ou responda nos chamados existentes. Resolva o mesmo assunto na conversa correspondente.",
      "O servidor confere limites e prazos para fechar ou reabrir. Mensagens internas da equipe não aparecem na conversa pública."
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
