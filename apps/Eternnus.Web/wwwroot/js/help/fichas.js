// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "fichas.ficha.resumo": {
    "title": "Resumo da ficha",
    "summary": "Recursos, testes e listas da ficha numa página só, sem o PDF.",
    "body": [
      "O Resumo mostra os recursos com barra (vida, mana…), os destaques do modelo, os testes que rolam e as listas como magias, poderes e itens, com as descrições abertas por item.",
      "É só uma forma de ver: editar continua na ficha completa ou no formulário acessível. A escolha fica guardada neste navegador.",
      "Na mesa, o Resumo é o padrão e os testes e itens podem ser usados direto dali."
    ],
    "audience": "all"
  },
  "fichas.ficha.busca": {
    "title": "Buscar na ficha",
    "summary": "Acha um campo, item de lista ou descrição pelo texto.",
    "body": [
      "Digite ao menos duas letras: a busca olha os nomes dos campos, os valores, cada linha das listas e as descrições por item, sem diferenciar acentos ou maiúsculas.",
      "Escolha um resultado (ou tecle Enter para o primeiro) e a ficha completa rola até o campo, destacando a linha encontrada por alguns segundos. Esc limpa a busca."
    ],
    "audience": "all"
  },
  "fichas.ficha.duplicar": {
    "title": "Duplicar ficha",
    "summary": "Cria uma cópia da sua ficha para uma variante ou outro personagem.",
    "body": [
      "A cópia leva a mesma versão do modelo, os valores, as ações pessoais, as descrições por item, a visibilidade e a imagem. O nome ganha “(cópia)”.",
      "Ela nasce fora das campanhas, sem histórico de alterações nem condições da mesa. Só o dono duplica, e é preciso salvar antes. Cada conta guarda até 200 personagens."
    ],
    "audience": "all"
  },
  "fichas.ficha.rascunho": {
    "title": "Rascunho local da ficha",
    "summary": "O que você ainda não salvou fica guardado neste navegador.",
    "body": [
      "Enquanto você edita, valores e descrições por item são guardados neste aparelho a cada poucos segundos e ao fechar a aba. Nada vai ao servidor até “Salvar ficha”.",
      "Ao reabrir a ficha, escolha Restaurar (os valores voltam ao formulário para você revisar e salvar) ou Descartar. Se a ficha foi salva depois do rascunho, restaurar e salvar substitui o que foi salvo.",
      "Ações pessoais não entram no rascunho. Sair da conta apaga os rascunhos deste navegador."
    ],
    "audience": "all"
  },
  "fichas.historico.restaurar": {
    "title": "Restaurar pelo histórico",
    "summary": "Volta um campo, ou a ficha inteira, a um valor anterior.",
    "body": [
      "Em cada alteração do histórico, “Voltar a este valor anterior” coloca o valor de antes no formulário.",
      "O dono também pode voltar a ficha ao início de uma sessão: os campos alterados desde então recebem o valor que tinham quando a sessão começou.",
      "Nada é gravado até você salvar a ficha, com a validação e o histórico de sempre. Descrições por item, campos calculados e valores longos demais no histórico não são restaurados por aqui."
    ],
    "audience": "all"
  },
  "fichas.imagem.personagem": {
    "title": "Imagem do personagem",
    "summary": "Cada ficha pode ter uma imagem, mostrada ao lado da ficha.",
    "body": [
      "A imagem fica fora do PDF: nada cobre os campos. Só o dono da ficha envia, troca ou remove; trocar a imagem não altera a ficha nem a revisão dela.",
      "Aceita PNG ou JPEG de até 10 MB. O servidor confere o arquivo, remove metadados e reduz para até 1.024 px. PNG com transparência continua transparente.",
      "Quem pode ler a ficha também vê a imagem: o mestre das campanhas vinculadas e, se a ficha for compartilhada, os participantes da mesa. A imagem conta no armazenamento da sua conta."
    ],
    "audience": "all"
  },
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
