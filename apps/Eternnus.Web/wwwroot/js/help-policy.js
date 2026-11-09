// Regras puras: somente apresentação. Nenhuma função concede acesso a recursos.
import { isAdmin, isStaff, isSafeSegment } from './policy.js';

export const HELP_AREAS = Object.freeze(['conta', 'campanhas', 'sessoes', 'mesa', 'fichas', 'modelos', 'biblioteca', 'guilda', 'progresso', 'suporte', 'admin']);
const audiences = Object.freeze(['all', 'player', 'master', 'ambassador', 'admin']);
const plain = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u001f]/u.test(value);
export function validHelpKey(value) {
  return typeof value === 'string' && value.length <= 150 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*){2}$/.test(value) && HELP_AREAS.includes(value.split('.')[0]);
}
export const validTip = (value) => plain(value, 80);
export function catalogModule(key) {
  return validHelpKey(key) ? `./help/${key.split('.')[0]}.js` : null;
}
export function safeHelpRoute(value) {
  return typeof value === 'string' && value.length <= 256 && value.startsWith('#') && value.slice(1).split('/').every(isSafeSegment);
}
export function canReadHelp(audience = 'all', user, context = {}) {
  if (audience === 'all') return true;
  if (audience === 'master') return !!user && context.isMaster === true;
  if (audience === 'player') return !!user && context.isPlayer === true;
  if (audience === 'ambassador') return isStaff(user);
  if (audience === 'admin') return isAdmin(user);
  return false;
}
export function validHelpEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const allowed = ['title', 'summary', 'body', 'example', 'audience', 'related', 'route'];
  if (!Object.keys(entry).every((key) => allowed.includes(key))) return false;
  return plain(entry.title, 80) && plain(entry.summary, 160) &&
    Array.isArray(entry.body) && entry.body.length > 0 && entry.body.length <= 20 &&
    entry.body.every((part) => typeof part === 'string' ? plain(part, 2000) :
      part && Object.keys(part).length === 1 && Array.isArray(part.list) && part.list.length > 0 && part.list.length <= 20 && part.list.every((item) => plain(item, 500))) &&
    (entry.example === undefined || plain(entry.example, 1000)) &&
    (entry.audience === undefined || audiences.includes(entry.audience)) &&
    (entry.related === undefined || Array.isArray(entry.related) && entry.related.length <= 10 && entry.related.every(validHelpKey)) &&
    (entry.route === undefined || safeHelpRoute(entry.route));
}

// Índice pequeno, sem parágrafos. Catálogos longos são importados ao abrir um ⓘ.
export const HELP_KEYS = Object.freeze({
  "conta.acesso.persistencia": "all",
  "conta.acesso.social": "all",
  "conta.acesso.autenticador": "all",
  "conta.perfil.avatar": "all",
  "conta.app.instalacao": "all",
  "campanhas.lista.papeis": "all",
  "campanhas.conta.limites": "all",
  "campanhas.config.forma-de-jogar": "all",
  "campanhas.convite.codigo": "all",
  "campanhas.config.modelo": "all",
  "campanhas.config.arquivamento": "all",
  "campanhas.one-shot.continuidade": "all",
  "campanhas.preparo.cenas": "master",
  "campanhas.preparo.personagens": "master",
  "campanhas.preparo.modelos-privados": "master",
  "campanhas.acervo.publicacao": "all",
  "campanhas.acervo.mapas": "master",
  "sessoes.abertura.unica": "master",
  "sessoes.historico.alteracoes": "master",
  "mesa.config.heranca": "master",
  "mesa.config.nevoa": "all",
  "mesa.config.revelacao-manual": "all",
  "mesa.config.caminho": "all",
  "mesa.config.aliados": "all",
  "mesa.config.luz-visao": "all",
  "mesa.nevoa.ferramentas": "master",
  "mesa.nevoa.visao": "master",
  "mesa.turnos.ordem": "all",
  "mesa.rolagem.mecanicas": "all",
  "mesa.rolagem.visibilidade": "all",
  "mesa.rolagem.formula": "all",
  "mesa.testes.pedidos": "master",
  "mesa.acoes.desfazer": "all",
  "mesa.mapa.legenda": "all",
  "mesa.chat.comandos": "all",
  "mesa.imagens.temporarias": "master",
  "fichas.visibilidade.privacidade": "all",
  "fichas.versao.migracao": "all",
  "fichas.pdf.exportacao": "all",
  "fichas.acoes.campos": "all",
  "fichas.historico.privado": "all",
  "modelos.campo.nome": "all",
  "modelos.campo.papel-na-mesa": "all",
  "modelos.campo.formula": "all",
  "modelos.acoes.chave": "all",
  "modelos.versao.publicacao": "all",
  "modelos.editor.atalhos": "all",
  "biblioteca.arquivos.verificacao": "all",
  "biblioteca.leitor.controles": "all",
  "guilda.posts.util": "all",
  "guilda.equipe.moderacao": "ambassador",
  "progresso.jornada.niveis": "all",
  "progresso.jornada.pontos": "all",
  "progresso.atlas.cenarios": "all",
  "suporte.chamados.categorias": "all",
  "suporte.chamados.limite": "all",
  "admin.usuarios.papeis": "admin",
  "admin.sistemas.identificador": "admin",
  "admin.acoes.auditoria": "admin",
  "admin.musicas.catalogo": "admin",
  "mesa.interface.apresentacao": "master",
  "mesa.trilha.compartilhada": "all",
  "mesa.trilha.ativar-audio": "all",
  "campanhas.cenas.preparacao": "master",
  "campanhas.cenas.aplicar": "master",
  "campanhas.cenas.alcance": "master",
  "campanhas.cenas.simulacao": "master",
  "campanhas.mapas.grade": "master"
});
