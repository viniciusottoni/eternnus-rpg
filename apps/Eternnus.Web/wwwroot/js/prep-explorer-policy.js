// Regras puras do gerenciador da Preparação (ADR-081): árvore por categoria, caminhos, compatibilidade de
// mover/colar, ordenação, busca, seleção em intervalo, histórico de navegação e grupos do seletor de mapas.
// Sem DOM nem HTTP (testado em Node); o servidor valida novamente toda escrita.

export const CATEGORIES = Object.freeze(["scenes", "maps", "characters"]);
/** Pastas-raiz fixas (virtuais: `folderId` nulo), na ordem da árvore. Não podem ser renomeadas nem excluídas. */
export const ROOTS = Object.freeze({ scenes: "Cenas", maps: "Mapas", characters: "Personagens" });
export const TYPE_OF_CATEGORY = Object.freeze({ scenes: "scene", maps: "map", characters: "character" });
export const CATEGORY_OF_TYPE = Object.freeze({ scene: "scenes", map: "maps", character: "characters" });
/** Limites de nome por tipo (iguais aos do servidor). */
export const NAME_LIMITS = Object.freeze({ folder: 100, scene: 80, map: 120, character: 40 });
export const MAX_DEPTH = 8;
export const MAX_TRANSFER = 200;
export const SORT_KEYS = Object.freeze([["name", "Nome"], ["type", "Tipo"], ["created", "Criação"], ["modified", "Modificação"]]);

const NOUNS = { folder: ["pasta", "pastas"], scene: ["cena", "cenas"], map: ["mapa", "mapas"], character: ["personagem", "personagens"], item: ["item", "itens"] };
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "1 cena", "3 mapas", "2 pastas". */
export const countLabel = (type, n) => plural(n, ...(NOUNS[type] || NOUNS.item));
export const isCategory = (c) => CATEGORIES.includes(c);
export const categoryOfType = (type) => CATEGORY_OF_TYPE[type] || null;
export const entryKey = (type, id) => `${type}:${id}`;

/** Texto para comparação: sem acentos, minúsculo, espaços normalizados. */
export function normalizeText(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Chaves `asset:`/`resource:` são da campanha; as demais são cenários oficiais do catálogo interno. */
export const isOfficialKey = (key) => !!key && !String(key).startsWith("asset:") && !String(key).startsWith("resource:");
export const officialTemplates = (items) => (items || []).filter((m) => isOfficialKey(m.key));

/** Tipo legível de cada entrada do explorador. */
export function typeLabel(entry) {
  const raw = entry?.raw || {};
  if (entry?.type === "folder") return "Pasta";
  if (entry?.type === "scene") return raw.kind === "text" ? "Cena textual" : raw.kind === "image" ? "Cena com imagem" : "Cena com mapa";
  if (entry?.type === "map") return mapKindLabel(raw);
  if (entry?.type === "character") return raw.kind === "creature" ? "Criatura" : "Personagem";
  return "";
}

/** Tipo do mapa (campanha ou modelo oficial). */
export function mapKindLabel(map) {
  if (!map) return "";
  if (isOfficialKey(map.key)) return map.kind === "tileset" ? "Modelo de tiles" : "Cartografia";
  if (map.isTileMap) return "Mapa de tiles";
  if (map.hasGrid === false || map.kind === "cartographic") return "Imagem sem grade";
  if (map.freeMovement) return "Imagem com movimentação livre";
  return "Imagem com grade";
}

/** Dimensões legíveis: casas para tiles e modelos; pixels (e casas, com grade) para imagens. */
export function mapDimensions(map) {
  if (!map) return "";
  if (Array.isArray(map.rows) && map.rows.length && (map.isTileMap || isOfficialKey(map.key)) && map.kind === "tileset")
    return `${String(map.rows[0]).length} × ${map.rows.length} casas`;
  if (isOfficialKey(map.key)) return map.kind === "cartographic" ? "Imagem panorâmica" : "";
  const px = map.pixelWidth && map.pixelHeight ? `${map.pixelWidth} × ${map.pixelHeight} px` : "";
  const cells = map.hasGrid !== false && map.width && map.height ? `${map.width} × ${map.height} casas` : "";
  return [px, cells].filter(Boolean).join(" · ");
}

/** Mapa com grade (aceita cena "Mapa tático"); sem grade vira cena de imagem. */
export const mapHasGrid = (map) => !!map && map.kind === "tileset" && map.hasGrid !== false;

const idOrNull = (v) => (v ? String(v) : null);
/** Converte a resposta de `GET /prep/explorer` em entradas uniformes `{ key, type, id, name, category, folderId, … }`. */
export function toEntries(data = {}) {
  const folders = (data.folders || []).filter((f) => isCategory(f.category)).map((f) => ({
    key: entryKey("folder", f.id), type: "folder", id: String(f.id), name: String(f.name || ""), category: f.category,
    folderId: idOrNull(f.parentId), parentId: idOrNull(f.parentId), description: "", createdAt: null, updatedAt: null, raw: f,
  }));
  const item = (type, x, description) => ({
    key: entryKey(type, x.id), type, id: String(x.id), name: String(x.name || ""), category: CATEGORY_OF_TYPE[type],
    folderId: idOrNull(x.folderId), description: String(description || ""), createdAt: x.createdAt || null, updatedAt: x.updatedAt || null, raw: x,
  });
  const items = [
    ...(data.scenes || []).map((s) => item("scene", s, s.description)),
    ...(data.maps || []).filter((m) => !isOfficialKey(m.key)).map((m) => item("map", m, m.summary || m.description)),
    ...(data.characters || []).map((c) => item("character", c, c.summary)),
  ];
  return { folders, items };
}

/** Árvore de uma categoria: mapa pai ("" = raiz) → pastas filhas em ordem alfabética. Órfãs sobem para a raiz. */
export function buildTree(folders, category) {
  const own = folders.filter((f) => f.category === category);
  const ids = new Set(own.map((f) => f.id));
  const children = new Map();
  for (const f of own) {
    const parent = f.parentId && ids.has(f.parentId) ? f.parentId : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(f);
  }
  for (const list of children.values()) list.sort(compareNames);
  return children;
}

/** Caminho da raiz até a pasta (sem a raiz virtual), protegido contra ciclos. */
export function folderPathOf(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = [], seen = new Set();
  for (let at = byId.get(id); at && !seen.has(at.id); at = byId.get(at.parentId)) { seen.add(at.id); path.unshift(at); }
  return path;
}

/** Trilha de navegação: raiz da categoria e as pastas até `folderId`. */
export function breadcrumbs(folders, category, folderId) {
  return [{ id: null, name: ROOTS[category] || "", category, root: true }, ...(folderId ? folderPathOf(folders, folderId).map((f) => ({ id: f.id, name: f.name, category: f.category, root: false })) : [])];
}

/** Texto do local ("Mapas › Masmorras › Andar 1"). */
export function locationLabel(folders, category, folderId) {
  return breadcrumbs(folders, category, folderId).map((c) => c.name).join(" › ");
}

/** Verdadeiro quando `id` é `ancestorId` ou está dentro dele. */
export function isSelfOrDescendant(folders, ancestorId, id) {
  if (!ancestorId || !id) return false;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set();
  for (let at = id; at && !seen.has(at); at = byId.get(at)?.parentId || null) {
    if (at === ancestorId) return true;
    seen.add(at);
  }
  return false;
}

/** Nível da pasta (1 = logo abaixo da raiz; 0 = raiz). */
export function folderDepth(folders, id) { return id ? folderPathOf(folders, id).length : 0; }

/** Altura da subárvore (1 = pasta sem subpastas). */
export function subtreeHeight(folders, id, guard = 0) {
  if (guard > MAX_DEPTH * 2) return 1;
  const kids = folders.filter((f) => f.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(folders, k.id, guard + 1))) : 0);
}

const CATEGORY_RULE = {
  scenes: "Cenas só ficam em pastas de Cenas.",
  maps: "Mapas só ficam em pastas de Mapas.",
  characters: "Personagens só ficam em pastas de Personagens.",
};
/**
 * Confere mover/copiar/colar sem chamar o servidor. `target` = { category, folderId|null }; `mode` = move | copy.
 * Devolve { ok:true } ou { ok:false, reason, noop? }. Regras: mesma categoria, pasta nunca dentro de si ou de
 * uma descendente, oito níveis, até 200 itens; mover para a pasta onde tudo já está é um "noop".
 */
export function checkTransfer(entries, target, folders, { mode = "move", maxDepth = MAX_DEPTH } = {}) {
  const list = (entries || []).filter(Boolean);
  if (!list.length) return { ok: false, reason: "Selecione ao menos um item." };
  if (!target || !isCategory(target.category)) return { ok: false, reason: "Escolha uma pasta de destino." };
  if (list.length > MAX_TRANSFER) return { ok: false, reason: `Mova ou copie até ${MAX_TRANSFER} itens por vez.` };
  const folderId = target.folderId || null;
  if (folderId) {
    const dest = folders.find((f) => f.id === folderId);
    if (!dest) return { ok: false, reason: "A pasta de destino não existe mais. Atualize a lista." };
    if (dest.category !== target.category) return { ok: false, reason: CATEGORY_RULE[target.category] };
  }
  for (const e of list) {
    if (e.category !== target.category) return { ok: false, reason: e.type === "folder" ? `Pastas de ${ROOTS[e.category] || "outra categoria"} só ficam em ${ROOTS[e.category] || "sua categoria"}.` : CATEGORY_RULE[e.category] || "Categoria incompatível." };
    if (e.type === "folder" && folderId && isSelfOrDescendant(folders, e.id, folderId))
      return { ok: false, reason: "Uma pasta não pode entrar nela mesma nem em uma subpasta dela." };
    if (e.type === "folder" && folderDepth(folders, folderId) + subtreeHeight(folders, e.id) > maxDepth)
      return { ok: false, reason: `As pastas chegam a ${maxDepth} níveis.` };
  }
  if (mode === "move" && list.every((e) => (e.folderId || null) === folderId))
    return { ok: false, noop: true, reason: "Os itens já estão nesta pasta." };
  return { ok: true };
}

/** Corpo de `POST /prep/move` e `/prep/copy`. */
export function transferBody(entries, target) {
  return { category: target.category, folderId: target.folderId || null, items: entries.map((e) => ({ type: e.type, id: e.id })) };
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
export function compareNames(a, b) {
  return collator.compare(normalizeText(a?.name), normalizeText(b?.name)) || String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}
const time = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };

/** Ordena com pastas sempre primeiro (por nome); itens por nome, tipo, criação ou modificação, asc/desc. */
export function sortEntries(entries, key = "name", dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  const primary = {
    name: (a, b) => compareNames(a, b),
    type: (a, b) => collator.compare(typeLabel(a), typeLabel(b)),
    created: (a, b) => time(a.createdAt) - time(b.createdAt),
    modified: (a, b) => time(a.updatedAt) - time(b.updatedAt),
  }[key] || compareNames;
  return [...entries].sort((a, b) => {
    const fa = a.type === "folder", fb = b.type === "folder";
    if (fa !== fb) return fa ? -1 : 1;
    if (fa && fb) return sign * compareNames(a, b);
    return sign * primary(a, b) || compareNames(a, b);
  });
}

/** Busca sem acentos no nome, descrição e tipo. Termos separados por espaço precisam aparecer todos. */
export function filterEntries(entries, query = "") {
  const terms = normalizeText(query).split(" ").filter(Boolean);
  if (!terms.length) return [...entries];
  return entries.filter((e) => { const text = normalizeText(`${e.name} ${e.description || ""} ${typeLabel(e)}`); return terms.every((t) => text.includes(t)); });
}

/**
 * Conteúdo visível: filhos da pasta atual (pastas e itens) ou, com `everywhere`, tudo que casa com a busca
 * em todas as categorias. Ordenação aplicada no fim.
 */
export function visibleEntries({ folders = [], items = [] }, { category, folderId = null, query = "", everywhere = false, sort = "name", dir = "asc" } = {}) {
  const here = (e) => e.category === category && (e.folderId || null) === (folderId || null);
  const pool = everywhere && normalizeText(query) ? [...folders, ...items] : [...folders, ...items].filter(here);
  return sortEntries(filterEntries(pool, query), sort, dir);
}

/** Seleção Shift+clique: do âncora até o alvo, na ordem exibida. Sem âncora visível, só o alvo. */
export function rangeSelection(orderedKeys, anchorKey, targetKey) {
  const a = orderedKeys.indexOf(anchorKey), b = orderedKeys.indexOf(targetKey);
  if (b < 0) return [];
  if (a < 0) return [targetKey];
  return orderedKeys.slice(Math.min(a, b), Math.max(a, b) + 1);
}
/** Ctrl+clique: inclui ou retira mantendo a ordem. */
export function toggleKey(keys, key) { return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]; }

/** Resumo da seleção ("2 mapas e 1 pasta"). */
export function selectionSummary(entries) {
  const counts = new Map();
  for (const e of entries) counts.set(e.type, (counts.get(e.type) || 0) + 1);
  const parts = ["folder", "scene", "map", "character"].filter((t) => counts.get(t)).map((t) => countLabel(t, counts.get(t)));
  if (parts.length <= 1) return parts[0] || "Nada selecionado";
  return `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
}

// ---------- Histórico de navegação (Voltar/Avançar) ----------
export const sameLocation = (a, b) => !!a && !!b && a.category === b.category && (a.folderId || null) === (b.folderId || null);
export function createNav(location) { return { back: [], current: location, forward: [] }; }
export function pushLocation(nav, location, limit = 50) {
  if (sameLocation(nav.current, location)) return nav;
  return { back: [...nav.back, nav.current].filter(Boolean).slice(-limit), current: location, forward: [] };
}
export function goBack(nav) {
  if (!nav.back.length) return nav;
  return { back: nav.back.slice(0, -1), current: nav.back.at(-1), forward: [nav.current, ...nav.forward] };
}
export function goForward(nav) {
  if (!nav.forward.length) return nav;
  return { back: [...nav.back, nav.current], current: nav.forward[0], forward: nav.forward.slice(1) };
}
/** Retira do histórico pastas que deixaram de existir (a atual cai para a raiz da categoria). */
export function pruneNav(nav, folders) {
  const ok = (l) => !l.folderId || folders.some((f) => f.id === l.folderId && f.category === l.category);
  const fix = (l) => (ok(l) ? l : { category: l.category, folderId: null });
  return { back: nav.back.filter(ok), current: fix(nav.current), forward: nav.forward.filter(ok) };
}
/** Pasta-mãe para "Subir"; `null` na raiz. */
export function parentLocation(folders, location) {
  if (!location?.folderId) return null;
  const f = folders.find((x) => x.id === location.folderId);
  return { category: location.category, folderId: f?.parentId || null };
}

// ---------- Seletor "Nova cena › A partir de mapa" ----------
export const PICKER_GROUPS = Object.freeze([
  ["own", "Mapas da campanha (criados do zero ou importados)"],
  ["template", "Mapas criados a partir de modelos"],
  ["official", "Modelos oficiais"],
]);
/** Grupo de cada mapa: próprio sem origem, próprio com `sourceKey`, ou modelo oficial. */
export function pickerGroupOf(map) {
  if (isOfficialKey(map?.key)) return "official";
  return map?.sourceKey ? "template" : "own";
}
/** Filtro por tipo do seletor: "" | grid | image | tiles. */
export function matchesMapType(map, type) {
  if (!type) return true;
  if (type === "tiles") return !!map.isTileMap || (isOfficialKey(map.key) && map.kind === "tileset");
  if (type === "grid") return mapHasGrid(map);
  if (type === "image") return !mapHasGrid(map);
  return true;
}
/** Três grupos nesta ordem (sempre presentes, talvez vazios), com busca sem acentos e filtro por tipo. */
export function mapPickerGroups(campaignMaps = [], officialMaps = [], { query = "", type = "" } = {}) {
  const terms = normalizeText(query).split(" ").filter(Boolean);
  const match = (m) => matchesMapType(m, type) && (!terms.length || terms.every((t) => normalizeText(`${m.name} ${m.summary || ""} ${m.description || ""} ${mapKindLabel(m)}`).includes(t)));
  const all = [...campaignMaps.filter((m) => !isOfficialKey(m.key)), ...officialMaps.filter((m) => isOfficialKey(m.key))];
  return PICKER_GROUPS.map(([id, label]) => ({ id, label, items: all.filter((m) => pickerGroupOf(m) === id && match(m)).sort(compareNames) }));
}

/** Corpo de `POST /scenes` para uma cena nova a partir de um mapa (a cena referencia o mapa, sem copiar bytes). */
export function sceneFromMapBody(map, { name, folderId = null, order = 0 } = {}) {
  return {
    name: String(name || map?.name || "Nova cena").trim().slice(0, NAME_LIMITS.scene), description: "",
    kind: mapHasGrid(map) ? "map" : "image", mapKey: map.key, mapKind: null, sharedText: "", privateNotes: "",
    visionMode: null, order, revision: 0, folderId: folderId || null,
  };
}

/** Nome limpo e dentro do limite do tipo; devolve { name } ou { error }. */
export function validateName(type, value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  const max = NAME_LIMITS[type] || 100;
  if (!name) return { error: "Informe um nome." };
  if (name.length > max) return { error: `Use até ${max} caracteres.` };
  return { name };
}

/** Rótulo "Novo …" da categoria (barra e menu de contexto). */
export const NEW_LABELS = Object.freeze({ scenes: "Nova cena", maps: "Novo mapa", characters: "Novo personagem" });

// ---------- Favoritos, recentes, coleções inteligentes e filtros (ADR-084) ----------
// Preferências do mestre guardadas no próprio navegador, por usuário e campanha: só chaves `tipo:id`, datas e
// critérios de filtro (nada de texto da campanha). Coleções são vistas virtuais: nunca movem nem copiam itens.

export const FAVORITE_LIMIT = 500;
export const RECENT_LIMIT = 30;
export const RECENT_DAYS = 14;
export const COLLECTION_LIMIT = 20;
export const COLLECTION_NAME_MAX = 40;
const DAY = 86_400_000;
const KEY_RE = /^(folder|scene|map|character):[A-Za-z0-9-]{1,64}$/;
export const isEntryKey = (key) => typeof key === "string" && KEY_RE.test(key);

/** Chave do armazenamento local: separa usuários e campanhas no mesmo navegador. */
export const userPrefsKey = (userId, campaignId) => `eternnus.prep.user.${String(userId || "anon")}.${String(campaignId || "")}`;

/** Preferências válidas a partir do que estava guardado (entrada desconhecida vira vazia; nunca lança). */
export function normalizeUserPrefs(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const favorites = [...new Set((Array.isArray(src.favorites) ? src.favorites : []).filter(isEntryKey))].slice(0, FAVORITE_LIMIT);
  const seen = new Set();
  const recents = (Array.isArray(src.recents) ? src.recents : [])
    .filter((r) => r && isEntryKey(r.key) && Number.isFinite(r.at) && r.at > 0 && !seen.has(r.key) && seen.add(r.key))
    .map((r) => ({ key: r.key, at: r.at }))
    .sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT);
  const ids = new Set();
  const collections = (Array.isArray(src.collections) ? src.collections : [])
    .map((c) => (c && typeof c === "object" ? { id: String(c.id || ""), name: cleanName(c.name), query: String(c.query || "").slice(0, 100), filters: normalizeFilters(c.filters) } : null))
    .filter((c) => c && /^c[A-Za-z0-9]{1,24}$/.test(c.id) && c.name && !ids.has(c.id) && ids.add(c.id))
    .slice(0, COLLECTION_LIMIT);
  return { favorites, recents, collections };
}
const cleanName = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, COLLECTION_NAME_MAX);

/** Marca ou desmarca favorito(s). Com várias chaves: se alguma não é favorita, todas viram favoritas; senão, todas saem. */
export function toggleFavorites(prefs, keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(isEntryKey);
  const current = new Set(prefs.favorites);
  const add = list.some((k) => !current.has(k));
  for (const k of list) add ? current.add(k) : current.delete(k);
  return { ...prefs, favorites: [...current].slice(-FAVORITE_LIMIT) };
}

/** Registra uma abertura (o item vai para o topo dos recentes). */
export function touchRecent(prefs, key, now = Date.now()) {
  if (!isEntryKey(key) || key.startsWith("folder:")) return prefs;
  return { ...prefs, recents: [{ key, at: now }, ...prefs.recents.filter((r) => r.key !== key)].slice(0, RECENT_LIMIT) };
}

/** Retira favoritos e recentes de itens que não existem mais. */
export function pruneUserPrefs(prefs, existingKeys) {
  const has = (k) => existingKeys.has(k);
  const favorites = prefs.favorites.filter(has), recents = prefs.recents.filter((r) => has(r.key));
  return favorites.length === prefs.favorites.length && recents.length === prefs.recents.length ? prefs : { ...prefs, favorites, recents };
}

/** Coleção salva a partir da busca e dos filtros atuais (sempre na campanha toda). Devolve { prefs, collection } ou { error }. */
export function saveCollection(prefs, { name, query = "", filters = {} } = {}, id = "c" + Math.random().toString(36).slice(2, 12)) {
  const clean = cleanName(name);
  if (!clean) return { error: "Dê um nome à coleção." };
  if (prefs.collections.length >= COLLECTION_LIMIT) return { error: `Guarde até ${COLLECTION_LIMIT} coleções. Exclua uma antes.` };
  if (prefs.collections.some((c) => normalizeText(c.name) === normalizeText(clean))) return { error: "Já existe uma coleção com esse nome." };
  const f = normalizeFilters(filters), q = String(query || "").trim().slice(0, 100);
  if (!q && !activeFilterCount(f)) return { error: "Defina uma busca ou um filtro antes de salvar a coleção." };
  const collection = { id: /^c[A-Za-z0-9]{1,24}$/.test(id) ? id : "c" + Date.now().toString(36), name: clean, query: q, filters: f };
  return { prefs: { ...prefs, collections: [...prefs.collections, collection] }, collection };
}
export const removeCollection = (prefs, id) => ({ ...prefs, collections: prefs.collections.filter((c) => c.id !== id) });

// ---------- Estado de preparo ----------
/**
 * Pendências de uma cena (critérios de "cena incompleta"):
 * - cena com mapa ou imagem sem cenário escolhido, ou com um cenário que não existe mais;
 * - cena com mapa (grade) sem nenhum marcador posicionado;
 * - cena sem texto compartilhável para ler à mesa (`hasText` falso; ausente = desconhecido, não conta).
 * `mapExists(key)` diz se a chave aponta para um mapa da campanha, um recurso ou um cenário oficial conhecido.
 */
export function sceneIssues(scene, mapExists = () => true) {
  const s = scene || {}, issues = [];
  if (s.kind !== "text" && (!s.mapKey || !mapExists(s.mapKey))) issues.push({ id: "map", label: s.mapKey ? "Mapa não encontrado" : "Sem mapa" });
  if (s.kind === "map" && !(Number(s.prepared) > 0)) issues.push({ id: "tokens", label: "Sem marcadores" });
  if (s.hasText === false) issues.push({ id: "text", label: "Sem texto para a mesa" });
  return issues;
}
/** Pendências de um personagem do mestre: sem ficha-modelo vinculada ou sem resumo. Cópias de encontro seguem o original. */
export function characterIssues(character) {
  const c = character || {}, issues = [];
  if (!c.templateName) issues.push({ id: "sheet", label: "Sem ficha-modelo" });
  if (!String(c.summary || "").trim()) issues.push({ id: "summary", label: "Sem resumo" });
  return issues;
}
/** Pendências de qualquer entrada (mapas e pastas não têm critérios de preparo). */
export function entryIssues(entry, ctx = {}) {
  if (entry?.type === "scene") return sceneIssues(entry.raw, ctx.mapExists);
  if (entry?.type === "character") return characterIssues(entry.raw);
  return [];
}
/** Mapa sem nenhuma cena e fora da mesa. */
export const isUnusedMap = (entry) => entry?.type === "map" && !(Number(entry.raw?.scenes) > 0) && !entry.raw?.inUse;
/** Cenas da campanha que usam o mapa (por chave), em ordem de nome. */
export function scenesUsingMap(items, mapKey) {
  return (items || []).filter((e) => e.type === "scene" && mapKey && e.raw?.mapKey === mapKey).sort(compareNames);
}

// ---------- Filtros ----------
export const FILTER_FIELDS = Object.freeze({
  type: { label: "Tipo", options: [["", "Todos os tipos"], ["scene-map", "Cena com mapa"], ["scene-image", "Cena com imagem"], ["scene-text", "Cena textual"], ["map-tiles", "Mapa de tiles"], ["map-image", "Mapa de imagem"], ["character", "Personagem"], ["creature", "Criatura"]] },
  origin: { label: "Origem do mapa", options: [["", "Qualquer origem"], ["tiles", "Criado com tiles"], ["image", "Enviado ou importado"], ["template", "A partir de modelo"]] },
  modified: { label: "Modificado", options: [["", "Qualquer data"], ["1", "Últimas 24 horas"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["older", "Há mais de 30 dias"]] },
  usage: { label: "Uso", options: [["", "Qualquer uso"], ["used", "Usados (cenas ou mesa)"], ["unused", "Não usados"], ["live", "Na mesa agora"]] },
  status: { label: "Preparo", options: [["", "Qualquer estado"], ["ready", "Prontos"], ["incomplete", "Incompletos"]] },
});
export const SCOPES = Object.freeze([["here", "Nesta pasta"], ["subtree", "Nesta pasta e subpastas"], ["all", "Toda a campanha"]]);
export const FILTER_DEFAULTS = Object.freeze({ type: "", origin: "", modified: "", usage: "", status: "", favorites: false });

export function normalizeFilters(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = { ...FILTER_DEFAULTS };
  for (const [k, field] of Object.entries(FILTER_FIELDS)) if (field.options.some(([v]) => v === src[k])) out[k] = src[k];
  out.favorites = src.favorites === true;
  return out;
}
export function activeFilterCount(filters) {
  const f = normalizeFilters(filters);
  return Object.keys(FILTER_FIELDS).filter((k) => f[k]).length + (f.favorites ? 1 : 0);
}
/** "Tipo: Mapa de tiles · Uso: Não usados · Favoritos". */
export function filterSummary(filters) {
  const f = normalizeFilters(filters);
  const parts = Object.entries(FILTER_FIELDS).filter(([k]) => f[k]).map(([k, field]) => `${field.label}: ${field.options.find(([v]) => v === f[k])[1]}`);
  if (f.favorites) parts.push("Só favoritos");
  return parts.join(" · ");
}
const entryKind = (e) => {
  const r = e.raw || {};
  if (e.type === "scene") return r.kind === "text" ? "scene-text" : r.kind === "image" ? "scene-image" : "scene-map";
  if (e.type === "map") return r.isTileMap ? "map-tiles" : "map-image";
  if (e.type === "character") return r.kind === "creature" ? "creature" : "character";
  return "";
};
/** Origem do mapa: modelo oficial (`sourceKey`), tiles ou imagem enviada/importada. */
export const mapOrigin = (raw) => (raw?.sourceKey ? "template" : raw?.isTileMap || raw?.origin === "tiles" ? "tiles" : "image");
/** Uso: mapas por cenas/mesa; cenas por apresentação (em apresentação ou já visitada). Personagens não têm esse dado. */
function usageOf(e) {
  const r = e.raw || {};
  if (e.type === "map") return { live: !!r.inUse, used: !!r.inUse || Number(r.scenes) > 0 };
  if (e.type === "scene") return { live: !!r.current, used: !!r.current || !!r.hasSaved };
  return null;
}
/**
 * Confere uma entrada contra os filtros. Pastas só passam sem filtros. Filtros que não se aplicam a um tipo
 * (origem fora de mapas, uso em personagens, preparo em mapas) excluem esse tipo.
 * `ctx`: { favorites:Set, now:number, mapExists:fn }.
 */
export function matchesFilters(entry, filters, ctx = {}) {
  const f = normalizeFilters(filters);
  if (!activeFilterCount(f)) return true;
  if (!entry || entry.type === "folder") return false;
  if (f.favorites && !ctx.favorites?.has(entry.key)) return false;
  if (f.type && entryKind(entry) !== f.type) return false;
  if (f.origin && (entry.type !== "map" || mapOrigin(entry.raw) !== f.origin)) return false;
  if (f.modified) {
    const t = time(entry.updatedAt || entry.createdAt), age = (ctx.now ?? Date.now()) - t;
    if (!t) return false;
    if (f.modified === "older" ? age <= 30 * DAY : age > Number(f.modified) * DAY) return false;
  }
  if (f.usage) {
    const u = usageOf(entry);
    if (!u) return false;
    if (f.usage === "live" ? !u.live : f.usage === "used" ? !u.used : u.used) return false;
  }
  if (f.status) {
    if (entry.type !== "scene" && entry.type !== "character") return false;
    const incomplete = entryIssues(entry, ctx).length > 0;
    if ((f.status === "incomplete") !== incomplete) return false;
  }
  return true;
}

// ---------- Coleções ----------
export const SMART_COLLECTIONS = Object.freeze([
  { id: "favorites", name: "Favoritos", empty: "Marque itens com a estrela para encontrá-los aqui." },
  { id: "recent", name: "Recentes", empty: `Itens abertos neste navegador ou modificados nos últimos ${RECENT_DAYS} dias.` },
  { id: "ready-scenes", name: "Cenas prontas para apresentar", empty: "Nenhuma cena tem mapa, marcadores e texto completos." },
  { id: "incomplete-scenes", name: "Cenas incompletas", empty: "Todas as cenas estão completas." },
  { id: "incomplete-characters", name: "Personagens sem ficha completa", empty: "Todos os personagens têm ficha-modelo e resumo." },
  { id: "unused-maps", name: "Mapas não usados", empty: "Todos os mapas são usados por alguma cena ou estão na mesa." },
]);
export const isSmartCollection = (id) => SMART_COLLECTIONS.some((c) => c.id === id);

/** Recentes: aberto neste navegador ou modificado nos últimos dias; ordem do mais recente, até `limit`. */
export function recentEntries(items, recents = [], { now = Date.now(), days = RECENT_DAYS, limit = RECENT_LIMIT } = {}) {
  const opened = new Map(recents.map((r) => [r.key, r.at]));
  const since = now - days * DAY;
  return (items || []).filter((e) => e.type !== "folder")
    .map((e) => ({ e, at: Math.max(opened.get(e.key) || 0, time(e.updatedAt) >= since ? time(e.updatedAt) : 0) }))
    .filter((x) => x.at > 0)
    .sort((a, b) => b.at - a.at || compareNames(a.e, b.e))
    .slice(0, limit).map((x) => x.e);
}

/** Itens (nunca pastas) de uma coleção embutida ou salva. `ctx`: { favorites:Set, recents, now, mapExists, saved }. */
export function collectionEntries(id, all = {}, ctx = {}) {
  const items = all.items || [];
  const favorites = ctx.favorites || new Set();
  switch (id) {
    case "favorites": return [...(all.folders || []), ...items].filter((e) => favorites.has(e.key));
    case "recent": return recentEntries(items, ctx.recents, { now: ctx.now });
    case "ready-scenes": return items.filter((e) => e.type === "scene" && !e.raw?.current && sceneIssues(e.raw, ctx.mapExists).length === 0);
    case "incomplete-scenes": return items.filter((e) => e.type === "scene" && sceneIssues(e.raw, ctx.mapExists).length > 0);
    case "incomplete-characters": return items.filter((e) => e.type === "character" && characterIssues(e.raw).length > 0);
    case "unused-maps": return items.filter(isUnusedMap);
    default: {
      const saved = (ctx.saved || []).find((c) => c.id === id);
      if (!saved) return [];
      return filterEntries(items, saved.query).filter((e) => matchesFilters(e, saved.filters, ctx));
    }
  }
}

/**
 * Conteúdo do gerenciador com busca, abrangência, filtros e coleção. Sem coleção: `scope` here (filhos da pasta),
 * subtree (itens da pasta e subpastas) ou all (itens da campanha); a busca "em todas as pastas" equivale a all.
 * Pastas aparecem em "here" e, buscando, em subtree/all — nunca com filtros ativos.
 * A coleção "Recentes" mantém a ordem de recência; as demais seguem a ordenação escolhida.
 */
export function browseEntries(all = {}, opts = {}, ctx = {}) {
  const { category, folderId = null, query = "", everywhere = false, sort = "name", dir = "asc", collection = null } = opts;
  const folders = all.folders || [], items = all.items || [];
  const filters = normalizeFilters(opts.filters);
  const filtering = activeFilterCount(filters) > 0;
  const searching = !!normalizeText(query);
  const keep = (list) => filterEntries(list, query).filter((e) => matchesFilters(e, filters, ctx));
  if (collection) {
    const list = keep(collectionEntries(collection, all, ctx));
    return collection === "recent" ? list : sortEntries(list, sort, dir);
  }
  const scope = everywhere && searching ? "all" : SCOPES.some(([k]) => k === opts.scope) ? opts.scope : "here";
  let pool;
  if (scope === "here") {
    const here = (e) => e.category === category && (e.folderId || null) === (folderId || null);
    pool = [...folders, ...items].filter(here);
  } else {
    const inside = (e) => scope === "all" || (e.category === category && (!folderId || isSelfOrDescendant(folders, folderId, e.folderId)));
    pool = [...(searching ? folders.filter((f) => inside(f) && f.id !== folderId) : []), ...items.filter(inside)];
  }
  if (filtering) pool = pool.filter((e) => e.type !== "folder");
  return sortEntries(keep(pool), sort, dir);
}
