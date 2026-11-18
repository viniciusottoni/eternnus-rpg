// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "biblioteca.arquivos.verificacao": {
    "title": "Arquivos da Biblioteca",
    "summary": "A equipe publica materiais após validação no servidor.",
    "body": [
      "PDF, PNG, JPEG e WebP têm limite de 25 MiB. O servidor confere tamanho, tipo e assinatura antes de publicar e, quando disponível, passa o arquivo no antivírus.",
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
  },
  "biblioteca.leitor.imagem": {
    "title": "Zoom da imagem",
    "summary": "Aproxime, afaste e mova a imagem para ver os detalhes.",
    "body": [
      "Role o mouse (ou faça pinça no celular) para aproximar no ponto indicado; arraste para mover a imagem aproximada. Duplo clique alterna entre ajustar à tela e o tamanho real.",
      "Com a imagem em foco: + e − mudam o zoom, 0 ajusta à tela, 1 mostra o tamanho real e as setas movem. Ajustar e 100% também ficam na barra. A capa do cartão é uma miniatura; o arquivo original só é baixado ao abrir."
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
