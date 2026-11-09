// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "modelos.campo.nome": {
    "title": "Nome nas fórmulas",
    "summary": "O nome identifica o campo em expressões com @.",
    "body": [
      "Use um nome estável e único. Fórmulas referenciam esse nome, não o rótulo exibido na ficha.",
      "Ao migrar versões, o servidor relaciona os campos pelos nomes. Renomear pode mudar quais valores são preservados."
    ],
    "audience": "all"
  },
  "modelos.campo.papel-na-mesa": {
    "title": "Papel na mesa",
    "summary": "O papel liga um campo aos recursos usados pela mesa.",
    "body": [
      "Vida, vida máxima, movimento, alcance, Luz e Visão têm funções próprias. Luz e Visão usam metros; a mesa converte pela escala do mapa.",
      "Escolha um tipo compatível. Sem o papel Movimento, não há limite de distância pela ficha; paredes, névoa e um movimento por vez continuam valendo."
    ],
    "audience": "all"
  },
  "modelos.campo.formula": {
    "title": "Fórmulas calculadas",
    "summary": "O servidor calcula os campos a partir dos valores da ficha.",
    "body": [
      "Você pode combinar números, nomes numéricos com @ e operações aceitas pelo editor. A validação indica nomes desconhecidos e dependências inválidas.",
      "Valores enviados pelo cliente para campos calculados não substituem o cálculo do servidor."
    ],
    "audience": "all",
    "example": "@forca + 2"
  },
  "modelos.acoes.chave": {
    "title": "Chave da ação",
    "summary": "A chave identifica a ação do modelo.",
    "body": [
      "Use uma chave única para a ação. O nome serve à leitura e a fórmula define a rolagem.",
      "Publicar fixa as ações na versão. O Jogador pode acrescentar ações pessoais sem alterar as do modelo."
    ],
    "audience": "all"
  },
  "modelos.versao.publicacao": {
    "title": "Rascunho e publicação",
    "summary": "Versões publicadas são imutáveis.",
    "body": [
      "Você edita o rascunho, testa a ficha e resolve os problemas antes de publicar. Para corrigir uma versão publicada, crie outra versão.",
      "Fichas existentes continuam na versão anterior até uma migração explícita com prévia."
    ],
    "audience": "all"
  },
  "modelos.editor.atalhos": {
    "title": "Atalhos do editor",
    "summary": "Você pode operar os campos pelo teclado.",
    "body": [
      "Use setas para mover e Shift para redimensionar. Alt ajusta o passo fino. Ctrl+Z desfaz; Ctrl+Shift+Z refaz; Ctrl+S salva.",
      "Duplicar cria outro campo. Excluir remove o campo do rascunho; confira as mudanças antes de publicar."
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
