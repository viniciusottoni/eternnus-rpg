// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "progresso.jornada.niveis": {
    "title": "Níveis e conquistas",
    "summary": "O progresso reconhece atividades compartilhadas.",
    "body": [
      "Você ganha XP em atividades elegíveis e pode alcançar conquistas. Ausência não remove XP; não existe obrigação de sequência diária.",
      "Nível não aumenta atributos da ficha nem quotas de campanhas. Algumas categorias da Guilda exigem nível para abrir tópicos."
    ],
    "audience": "all"
  },
  "progresso.jornada.pontos": {
    "title": "Pontos e limites diários",
    "summary": "O teto de XP não impede você de continuar a atividade.",
    "body": [
      "Os limites diários usam UTC. Só lançamentos concedidos aumentam os contadores das conquistas; suporte não gera XP.",
      "Sessões precisam durar dez minutos e ter Jogador elegível com ficha e entrada ao menos dez minutos antes do encerramento. O Mestre recebe se houver um Jogador elegível."
    ],
    "audience": "all"
  },
  "progresso.atlas.cenarios": {
    "title": "Atlas do Eternnus",
    "summary": "Os cenários oficiais estão disponíveis sem exigência de nível.",
    "body": [
      "Você pode usar os locais como referência e adaptar nomes, habitantes e trama ao seu sistema.",
      "O Mestre escolhe o cenário da mesa. A grade oficial é a mesma validada pelo servidor."
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
