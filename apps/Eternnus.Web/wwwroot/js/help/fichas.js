// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "fichas.visibilidade.privacidade": {
    "title": "Ficha compartilhada ou privada",
    "summary": "Você escolhe a visibilidade da sua ficha.",
    "body": [
      "Membros da mesa podem ler fichas compartilhadas. Uma ficha privada fica restrita ao dono e ao Mestre autorizado.",
      "Compartilhar a ficha não compartilha seu histórico de alterações. Só o dono muda a visibilidade; a edição também pode ser feita pelo Mestre autorizado."
    ],
    "audience": "all"
  },
  "fichas.versao.migracao": {
    "title": "Versão da ficha",
    "summary": "Sua ficha mantém a versão do modelo usada na criação.",
    "body": [
      "Uma publicação nova não atualiza sua ficha automaticamente. Você pode abrir uma prévia para conferir valores preservados, adicionados, removidos e ajustados.",
      "A migração exige confirmação e é conferida novamente pelo servidor. O histórico é preservado."
    ],
    "audience": "all"
  },
  "fichas.pdf.exportacao": {
    "title": "PDF preenchido",
    "summary": "O PDF usa os últimos valores salvos da ficha.",
    "body": [
      "Salve antes de exportar. O navegador reconstrói um documento visual com o fundo e os valores.",
      "O PDF exportado é estático e seu texto não é pesquisável. A ficha editável continua na plataforma."
    ],
    "audience": "all"
  },
  "fichas.pdf.importacao": {
    "title": "Importar PDF preenchido",
    "summary": "Traz os valores de um PDF editável para a ficha padrão do sistema.",
    "body": [
      "Disponível somente quando a ficha usa o modelo padrão do sistema. O arquivo é lido no seu navegador e não é enviado ao servidor.",
      "Os campos são reconhecidos pela posição na página e, se preciso, pelo nome. Campos vazios, calculados ou com formato inválido não são importados. Revise e salve para gravar."
    ],
    "audience": "all"
  },
  "fichas.acoes.campos": {
    "title": "Ações da ficha",
    "summary": "Tipo, dados e efeito descrevem a ação.",
    "body": [
      "O tipo organiza a ação na mesa. A fórmula determina os dados rolados no servidor; sem fórmula, a ação pode ser narrativa.",
      "O efeito descreve o que acontece. Você edita suas ações pessoais; ações do modelo vêm da versão publicada."
    ],
    "audience": "all"
  },
  "fichas.historico.privado": {
    "title": "Histórico de alterações",
    "summary": "O histórico é reservado ao dono e ao Mestre autorizado.",
    "body": [
      "Você pode consultar os valores anteriores e posteriores de cada campo, com origem e responsável.",
      "O Mestre só vê o histórico ligado às sessões que mestra. Compartilhar a ficha não libera essa auditoria para os demais membros."
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
