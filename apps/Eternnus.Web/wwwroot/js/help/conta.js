// Texto público estático; catálogos avaliados sob demanda.
const entries = {
  "conta.acesso.persistencia": {
    "title": "Manter conectado",
    "summary": "Use esta opção apenas em um dispositivo pessoal.",
    "body": [
      "Você pode manter o login por 14 dias fixos. A sessão comum tem renovação com teto de 24 horas.",
      "Administrador usa autenticação em duas etapas e sessão de oito horas, mesmo com esta opção."
    ],
    "audience": "all"
  },
  "conta.acesso.social": {
    "title": "Acesso com Google ou Discord",
    "summary": "O provedor precisa informar um e-mail verificado.",
    "body": [
      "Você entra com a identidade do provedor. A plataforma não une automaticamente uma conta social à conta local que usa o mesmo e-mail.",
      "Se o provedor estiver indisponível, você pode entrar com seu e-mail e senha locais."
    ],
    "audience": "all"
  },
  "conta.acesso.autenticador": {
    "title": "Autenticador",
    "summary": "Uma segunda etapa protege o acesso à conta.",
    "body": [
      "Você informa o código do seu aplicativo autenticador. Administradores precisam concluir esta etapa para entrar.",
      "Guarde os códigos de recuperação em local privado. Cada código funciona uma única vez e eles só aparecem na ativação."
    ],
    "audience": "all"
  },
  "conta.perfil.avatar": {
    "title": "Aprovação do avatar",
    "summary": "A imagem só aparece após a aprovação no servidor.",
    "body": [
      "Você envia JPEG ou PNG dentro dos limites mostrados no formulário. O servidor verifica o arquivo com antivírus, reconstrói a imagem e envia a versão normalizada à Microsoft para análise de conteúdo.",
      "Falha ou indisponibilidade da verificação impede a publicação. A análise pode cometer erros; não garante detectar toda ameaça."
    ],
    "audience": "all"
  },
  "conta.app.instalacao": {
    "title": "Instalar o Eternnus",
    "summary": "Você pode adicionar o site à tela inicial.",
    "body": [
      "Use Instalar app quando o navegador oferecer a instalação. No iPhone, use Compartilhar e Adicionar à Tela de Início.",
      "Login, consultas e ações continuam exigindo conexão. Instalar não confirma seu e-mail nem muda suas permissões."
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
