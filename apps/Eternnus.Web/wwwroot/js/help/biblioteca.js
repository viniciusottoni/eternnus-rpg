// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "biblioteca.arquivos.verificacao": {
    "title": "Arquivos da Biblioteca",
    "summary": "A equipe publica materiais após validação no servidor.",
    "body": [
      "PDF, PNG, JPEG e WebP têm limite de 25 MiB. O servidor confere tamanho, tipo, assinatura e antivírus antes de publicar.",
      "A verificação não garante ausência de toda ameaça. Os documentos exigem autenticação e não entram no cache offline."
    ],
    "audience": "all"
  },
  "biblioteca.leitor.controles": {
    "title": "Leitor de PDF",
    "summary": "Você pode trocar de página e ajustar o zoom.",
    "body": [
      "Use Anterior e Próxima para navegar. Ajustar enquadra a página na largura disponível.",
      "No leitor com foco, use as setas para trocar a página e + ou − para zoom. Baixar o arquivo é uma ação separada da leitura."
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
