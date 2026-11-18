// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "sessoes.abertura.unica": {
    "title": "Uma sessão ativa",
    "summary": "Uma campanha pode ter apenas uma sessão ativa.",
    "body": [
      "O Mestre inicia a sessão para abrir a mesa aos jogadores. Pausar mantém a sessão ativa.",
      "Encerre a sessão antes de abrir outra ou arquivar a campanha. Uma one-shot já nasce com sua sessão única."
    ],
    "audience": "master"
  },
  "sessoes.abertura.cena": {
    "title": "Iniciar pela cena",
    "summary": "A sessão pode abrir já apresentando uma cena preparada.",
    "body": [
      "Ao escolher uma cena, a mesa abre no mapa dela, com os marcadores, a névoa e o texto preparados. Cenas de texto usam o mapa escolhido logo abaixo.",
      "Escolha “Só um mapa” para começar sem cena. As cenas continuam disponíveis na aba Cenas da mesa."
    ],
    "audience": "master"
  },
  "sessoes.inicio.checklist": {
    "title": "Pronto para jogar?",
    "summary": "Mostra o que já está pronto antes da primeira sessão.",
    "body": [
      "Convite e fichas mostram quantos jogadores entraram e quantos já têm ficha. A cena é opcional: sem ela, a sessão abre num mapa pronto.",
      "Você pode iniciar a qualquer momento. Quem entrar depois vai direto para a mesa e cria a ficha por lá."
    ],
    "audience": "master"
  },
  "sessoes.historico.alteracoes": {
    "title": "Antes e depois",
    "summary": "O histórico registra as mudanças da sessão.",
    "body": [
      "Você pode comparar os valores anteriores e posteriores nos eventos de alteração. Uma correção por desfazer gera outro evento e mantém o original.",
      "O histórico completo da sessão é exclusivo do Mestre. O histórico de alterações da ficha exige dono ou Mestre autorizado."
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
