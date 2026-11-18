// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "loja.pagina.afiliados": {
    "title": "Links de afiliado",
    "summary": "A compra acontece na loja parceira; o Eternnus pode receber comissão.",
    "body": [
      "Cada oferta abre a página do produto na Amazon, na Shopee ou no Mercado Livre, em nova aba. Pagamento, entrega e trocas são da loja de origem; o Eternnus não vende nem guarda dados de pagamento.",
      "O link carrega a identificação de afiliado do Eternnus. Isso não muda o preço para você. Preço e disponibilidade aparecem só quando foram conferidos recentemente; fora disso, a loja mostra “Consultar preço na loja”."
    ],
    "audience": "all",
    "related": [
      "loja.pagina.personalizacao"
    ]
  },
  "loja.pagina.personalizacao": {
    "title": "Personalização da loja",
    "summary": "Você decide o que orienta as sugestões e pode apagar tudo.",
    "body": [
      "Por padrão, a loja usa apenas o sistema de RPG das suas campanhas: dentro de uma campanha vale o sistema dela; nas outras páginas, a campanha ativa mais recente ou o sistema que você escolher.",
      "A análise de mensagens é opcional e começa desligada. Com ela ligada, só entram textos seus dos últimos 180 dias: tópicos e respostas da Guilda e mensagens abertas à mesa. Mensagens privadas, de outras pessoas, rolagens, fichas e notas do Mestre ficam de fora, e só palavras do catálogo são guardadas.",
      {
        "list": [
          "Desligar a análise apaga os interesses inferidos na hora.",
          "“Apagar interesses inferidos” remove os termos e ignora mensagens anteriores.",
          "Você pode ocultar a vitrine do topo das páginas a qualquer momento.",
          "Nada do que você escreve é enviado às lojas parceiras."
        ]
      }
    ],
    "audience": "all",
    "related": [
      "loja.pagina.afiliados"
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
