// Gerenciador da Preparação (ADR-081): explorador de arquivos com as pastas-raiz fixas Cenas, Mapas e Personagens.
// Árvore à esquerda, conteúdo (ícones ou lista) ao centro, detalhes à direita e barra de ações no topo.
// Toda escrita passa pelos endpoints /prep/* e pelos DELETE existentes (js/api.js, antiforgery); o estado visual
// nunca substitui a validação do servidor. Regras puras em prep-explorer-policy.js; fluxos de criação em prep-create.js.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { mapThumbnail } from "./table-map.js";
import { safeImageUrl } from "./play-policy.js";
import { openContextMenu, closeAllMenus, icon } from "./editor-core.js";
import { isTypingTarget, shortcutLabel } from "./editor-policy.js";
import * as P from "./prep-explorer-policy.js";

const ARCHIVED = "Restaure a campanha arquivada para editar a preparação.";
const PREF_KEY = "eternnus.prep.view";
/** Ajuda de cada raiz (chaves literais: o catálogo confere os pontos de acesso). */
const rootHelp = (category) => (category === "scenes" ? helpButton("campanhas.preparo.cenas", "Cenas preparadas")
  : category === "maps" ? helpButton("campanhas.acervo.mapas", "Mapas e escala")
  : helpButton("campanhas.preparo.personagens", "Personagens do Mestre"));
const ROOT_LEAD = {
  scenes: "Prepare em particular: escolha o mapa, posicione personagens e escreva o texto. Nada aparece aos jogadores até você apresentar a cena na mesa.",
  maps: "Mapas de tiles, imagens enviadas ou importadas e mapas criados a partir dos modelos oficiais. A mesma imagem serve a várias cenas sem duplicar o arquivo.",
  characters: "Aliados, inimigos e criaturas reutilizáveis. Na mesa, use “Cópia para encontro” para mexer nos recursos sem alterar o original.",
};
const EMPTY_TEXT = {
  scenes: "Uma cena pode usar um mapa com grade, uma imagem ou só um texto para ler à mesa.",
  maps: "Crie um mapa do zero, a partir de um modelo oficial, ou importe uma imagem ou arquivo VTT.",
  characters: "Crie um personagem com nome e resumo. Depois, na ficha, escolha um modelo ou recursos simples.",
};

// Ícones locais (SVG estático, sem dados do usuário), no mesmo traço do núcleo gráfico.
const LOCAL = {
  folder: '<path d="M3 6.5A1.5 1.5 0 014.5 5h4.2l2 2h8.8A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/>',
  folderOpen: '<path d="M3 17.5V6.5A1.5 1.5 0 014.5 5h4.2l2 2h7.3A1.5 1.5 0 0119.5 8.5V10M3 17.5l2.3-6.4A1.5 1.5 0 016.7 10h13.8a1 1 0 01.9 1.3l-2.1 6.6a1.5 1.5 0 01-1.4 1.1H4.5A1.5 1.5 0 013 17.5z"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  cut: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8.2 15 18 3M15.8 15 6 3"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4V2.5h6V4M9 10h6M9 14h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  tiles: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  scene: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4"/>',
  atlas: '<path d="M3 6.2 8.6 4l6.8 2.4L21 4.2v13.6L15.4 20l-6.8-2.4L3 19.8zM8.6 4v13.6M15.4 6.4V20"/>',
  folderPlus: '<path d="M3 6.5A1.5 1.5 0 014.5 5h4.2l2 2h8.8A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5zM12 10v6M9 13h6"/>',
  sortAsc: '<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M14 6h3M14 12h5M14 18h7"/>',
  sortDesc: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M14 6h7M14 12h5M14 18h3"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
};
const ico = (name) => (LOCAL[name] ? `<svg class="ed-icon px-ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${LOCAL[name]}</svg>` : icon(name));
const ROOT_ICON = { scenes: "scene", maps: "atlas", characters: "character" };
const TYPE_ICON = { scene: "scene", map: "atlas", character: "character", folder: "folder" };

// Estado que sobrevive à troca de aba: pastas expandidas e área de transferência interna (por campanha).
const expandedByCampaign = new Map();
const clipboardByCampaign = new Map();

function loadPrefs() {
  const fallback = { view: "grid", sort: "name", dir: "asc", details: true };
  try {
    const p = { ...fallback, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") };
    return {
      view: p.view === "list" ? "list" : "grid",
      sort: P.SORT_KEYS.some(([k]) => k === p.sort) ? p.sort : "name",
      dir: p.dir === "desc" ? "desc" : "asc",
      details: p.details !== false,
    };
  } catch { return fallback; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* armazenamento indisponível: preferências só nesta visita */ } }

/** Data local curta (servidor envia UTC; sem fuso explícito, trata como UTC). */
function localDate(value) {
  if (!value) return "";
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text + "Z");
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
const decimal = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const locKey = (loc) => `${loc.category}|${loc.folderId || ""}`;
const parseLoc = (text) => { const [category, folderId] = String(text || "").split("|"); return P.isCategory(category) ? { category, folderId: folderId || null } : null; };

/**
 * Monta o gerenciador em `target`. `opts.category` abre numa raiz. Devolve a função de descarte (ouvintes,
 * observador de miniaturas e menus abertos).
 */
export async function renderPrepExplorer(d, target, { category = "" } = {}) {
  const base = `/campaigns/${d.id}`;
  const prefs = loadPrefs();
  if (!expandedByCampaign.has(d.id)) expandedByCampaign.set(d.id, new Set(P.CATEGORIES.map((c) => `root:${c}`)));
  const expanded = expandedByCampaign.get(d.id);
  const st = {
    data: null, entries: { folders: [], items: [] }, byKey: new Map(), official: null, npcs: null,
    nav: P.createNav({ category: P.isCategory(category) ? category : "scenes", folderId: null }),
    selected: [], anchor: null, focusKey: null, query: "", everywhere: false, visible: [],
    archived: !!d.archived, treeOpen: false, disposed: false, loading: false,
  };
  const thumbs = new Map();
  let observer = null, drag = null, lastDropReason = "", renaming = false, lastOpen = 0;

  let root = null;
  const q = (sel) => (root ? root.querySelector(sel) : null);

  async function start() {
    target.innerHTML = '<p class="loading-line" role="status">Abrindo a preparação…</p>';
    if (!(await load()) || st.disposed || !target.isConnected) return;
    target.innerHTML = shellHtml();
    root = target.querySelector(".px");
    bind();
    paintAll();
  }

  // ---------- Dados ----------
  async function load() {
    try {
      const [data, official] = await Promise.all([
        api(`${base}/prep/explorer`),
        st.official ? Promise.resolve(st.official) : api(`${base}/maps`).then((r) => P.officialTemplates(r.items)).catch(() => []),
      ]);
      if (st.disposed) return false;
      st.data = data; st.official = official; st.npcs = null;
      st.archived = !!(data.archived ?? d.archived);
      st.entries = P.toEntries(data);
      st.byKey = new Map([...st.entries.folders, ...st.entries.items].map((e) => [e.key, e]));
      st.nav = P.pruneNav(st.nav, st.entries.folders);
      st.selected = st.selected.filter((k) => st.byKey.has(k));
      return true;
    } catch (error) {
      if (st.disposed || !target.isConnected) return false;
      // Falha ao atualizar com o explorador aberto: mantém a última lista e avisa.
      if (root) { toast(error.message); return false; }
      const unavailable = error.status === 403 || error.status === 404;
      target.innerHTML = `<div class="px-state px-error" role="alert"><h3>${unavailable ? "Preparação indisponível" : "Não foi possível abrir a preparação"}</h3><p>${esc(unavailable ? "Só o mestre da campanha organiza a preparação." : error.message)}</p>${unavailable ? "" : '<button type="button" class="primary" data-px-retry>Tentar novamente</button>'}</div>`;
      target.querySelector("[data-px-retry]")?.addEventListener("click", () => start(), { once: true });
      return false;
    }
  }

  /** Recarrega sem refazer a página; seleciona `select` (chaves `tipo:id`) quando informado. */
  async function refresh(select = null) {
    if (st.loading) return;
    st.loading = true;
    root?.setAttribute("aria-busy", "true");
    try {
      const ok = await load();
      if (!ok || st.disposed) return;
      if (Array.isArray(select)) { st.selected = select.filter((k) => st.byKey.has(k)); st.anchor = st.selected[0] || null; st.focusKey = st.selected[0] || st.focusKey; }
      paintAll();
    } finally { st.loading = false; root?.removeAttribute("aria-busy"); }
  }

  const folders = () => st.entries.folders;
  const loc = () => st.nav.current;
  const selection = () => st.selected.map((k) => st.byKey.get(k)).filter(Boolean);
  const blocked = () => st.archived;
  const mapByKey = (key) => (st.data?.maps || []).find((m) => m.key === key) || (st.official || []).find((m) => m.key === key) || null;
  const officialName = (key) => (st.official || []).find((m) => m.key === key)?.name || key;
  const say = (text) => { const el = q?.(".px-status"); if (el) el.textContent = text || ""; };

  async function npcs() {
    if (!st.npcs) st.npcs = (await api(`${base}/npcs`)).items || [];
    return st.npcs;
  }

  // ---------- Estrutura ----------
  function shellHtml() {
    return `<section class="px" data-view="${prefs.view}" data-details="${prefs.details ? "open" : "closed"}" data-tree="closed" aria-labelledby="px-title">
  <div class="px-head"><h2 id="px-title">Preparação${helpButton("campanhas.preparo.explorador", "Gerenciador da Preparação")}</h2><p class="muted small px-lead" data-px-lead></p></div>
  ${st.archived ? `<p class="notice-box px-archived">${esc(ARCHIVED)} Você ainda pode abrir e consultar tudo.</p>` : ""}
  <div class="px-toolbar" role="toolbar" aria-label="Ações da Preparação" data-px-toolbar></div>
  <div class="px-address"><button type="button" class="px-tb px-tree-toggle" data-px="tree" aria-expanded="false" aria-controls="px-tree" aria-label="Pastas">${ico("folder")}<span class="px-tb-label">Pastas</span></button><nav class="px-crumbs" aria-label="Caminho da pasta" data-px-crumbs></nav>
    <form class="px-search" role="search" data-px-search><label class="sr-only" for="px-q">Buscar na preparação</label><input id="px-q" type="search" maxlength="100" placeholder="Buscar…" autocomplete="off" data-no-count><label class="check px-everywhere"><input type="checkbox" data-px-everywhere> em todas as pastas</label></form></div>
  <div class="px-body">
    <nav class="px-tree" id="px-tree" aria-label="Pastas da Preparação" data-px-tree></nav>
    <section class="px-content" aria-label="Conteúdo da pasta" data-px-content><div class="px-content-body" tabindex="-1" data-px-body></div></section>
    <aside class="px-details" aria-label="Detalhes da seleção" tabindex="-1" data-px-details></aside>
  </div>
  <p class="px-status" role="status" aria-live="polite"></p>
</section>`;
  }

  function paintAll() {
    if (!root?.isConnected) return;
    root.dataset.view = prefs.view;
    root.dataset.details = prefs.details ? "open" : "closed";
    q("[data-px-lead]").textContent = ROOT_LEAD[loc().category];
    for (const f of P.folderPathOf(folders(), loc().folderId)) expanded.add(f.id);
    paintTree(); paintCrumbs(); paintContent(); paintToolbar(); paintDetails();
  }

  // ---------- Barra de ações ----------
  function tb(id, label, iconName, { shortcut = "", reason = "", pressed = null, primary = false, haspopup = false, text = true } = {}) {
    const name = shortcut ? `${label} (${shortcutLabel(shortcut)})` : label;
    return `<button type="button" class="px-tb${primary ? " primary" : ""}${text ? "" : " icon-only"}" data-px="${id}" aria-label="${esc(name)}" data-tip="${esc(reason || name)}"${reason ? ' aria-disabled="true"' : ""}${pressed != null ? ` aria-pressed="${pressed}"` : ""}${haspopup ? ' aria-haspopup="menu"' : ""}>${ico(iconName)}<span class="px-tb-label">${esc(label)}</span></button>`;
  }
  function paintToolbar() {
    const focused = document.activeElement?.closest?.("[data-px-toolbar] [data-px]")?.dataset.px;
    paintToolbarHtml();
    if (focused) q(`[data-px-toolbar] [data-px="${focused}"]`)?.focus({ preventScroll: true });
  }
  function paintToolbarHtml() {
    const sel = selection(), cat = loc().category, write = blocked() ? ARCHIVED : "";
    const none = sel.length ? "" : "Selecione um item.";
    const clip = clipboardByCampaign.get(d.id);
    const pasteReason = write || (clip?.entries.length ? "" : "Copie ou recorte itens antes de colar.");
    const renameReason = write || (sel.length === 1 ? "" : "Selecione um único item para renomear.");
    const deleteReason = write || none || (sel.some((e) => e.type === "scene" && e.raw.current) ? "Apresente outra cena antes de excluir a cena atual." : "");
    q("[data-px-toolbar]").innerHTML = `<div class="px-tb-group" role="group" aria-label="Navegação">${tb("back", "Voltar", "back", { shortcut: "alt+arrowleft", reason: st.nav.back.length ? "" : "Não há pasta anterior.", text: false })}${tb("forward", "Avançar", "forward", { shortcut: "alt+arrowright", reason: st.nav.forward.length ? "" : "Não há pasta seguinte.", text: false })}${tb("up", "Subir", "up", { shortcut: "alt+arrowup", reason: loc().folderId ? "" : "Você está na raiz.", text: false })}${tb("refresh", "Atualizar", "refresh", { text: false })}</div>
<div class="px-tb-group" role="group" aria-label="Criar">${tb("new", P.NEW_LABELS[cat], "plus", { primary: true, reason: write })}${tb("folder", "Nova pasta", "folderPlus", { reason: write })}${cat === "maps" ? tb("import", "Importar", "import", { reason: write, haspopup: true }) : ""}</div>
<div class="px-tb-group" role="group" aria-label="Editar">${tb("copy", "Copiar", "copy", { shortcut: "mod+c", reason: write || none, text: false })}${tb("cut", "Recortar", "cut", { shortcut: "mod+x", reason: write || none, text: false })}${tb("paste", "Colar", "paste", { shortcut: "mod+v", reason: pasteReason, text: false })}${tb("rename", "Renomear", "rename", { shortcut: "f2", reason: renameReason, text: false })}${tb("delete", "Excluir", "trash", { shortcut: "delete", reason: deleteReason, text: false })}${tb("actions", "Mais ações", "more", { reason: none, haspopup: true, text: false })}</div>
<div class="px-tb-group px-tb-view" role="group" aria-label="Exibição">${tb("view-grid", "Ícones", "tiles", { pressed: prefs.view === "grid", text: false })}${tb("view-list", "Lista", "list", { pressed: prefs.view === "list", text: false })}<label class="sr-only" for="px-sort">Ordenar por</label><select id="px-sort" class="px-sort" data-px-sort>${P.SORT_KEYS.map(([k, l]) => `<option value="${k}" ${prefs.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>${tb("dir", prefs.dir === "asc" ? "Ordem crescente" : "Ordem decrescente", prefs.dir === "asc" ? "sortAsc" : "sortDesc", { text: false })}${tb("details", "Painel de detalhes", "panels", { pressed: prefs.details, text: false })}</div>`;
  }

  // ---------- Árvore ----------
  function paintTree() {
    const cur = loc();
    const trees = Object.fromEntries(P.CATEGORIES.map((c) => [c, P.buildTree(folders(), c)]));
    const node = (category, folder, level) => {
      const tree = trees[category];
      const id = folder?.id || null, key = id || `root:${category}`;
      const kids = tree.get(id || "") || [];
      const open = expanded.has(key) && kids.length > 0;
      const current = P.sameLocation(cur, { category, folderId: id });
      const name = folder ? folder.name : P.ROOTS[category];
      const iconName = folder ? (current || open ? "folderOpen" : "folder") : ROOT_ICON[category];
      const where = esc(locKey({ category, folderId: id }));
      return `<li role="treeitem" class="px-tnode${current ? " current" : ""}${folder ? "" : " px-troot"}" aria-level="${level}" aria-selected="${current}"${kids.length ? ` aria-expanded="${open}"` : ""} tabindex="-1" data-loc="${where}" data-drop="${where}"><div class="px-trow"><span class="px-twisty" data-twisty aria-hidden="true">${kids.length ? ico("chevron") : ""}</span>${ico(iconName)}<span class="px-tname">${esc(name)}</span></div>${open && level <= P.MAX_DEPTH ? `<ul role="group">${kids.map((k) => node(category, k, level + 1)).join("")}</ul>` : ""}</li>`;
    };
    const host = q("[data-px-tree]");
    const hadFocus = host.contains(document.activeElement);
    host.innerHTML = `<ul class="px-tree-list" role="tree" aria-label="Pastas da Preparação">${P.CATEGORIES.map((c) => node(c, null, 1)).join("")}</ul>`;
    const items = [...host.querySelectorAll("[role=treeitem]")];
    const active = items.find((li) => li.dataset.loc === locKey(cur)) || items[0];
    active.tabIndex = 0;
    if (hadFocus) active.focus({ preventScroll: true });
  }

  // ---------- Caminho ----------
  function paintCrumbs() {
    const crumbs = P.breadcrumbs(folders(), loc().category, loc().folderId);
    q("[data-px-crumbs]").innerHTML = `<ol>${crumbs.map((c, i) => {
      const where = esc(locKey({ category: c.category, folderId: c.id }));
      const label = `${c.root ? ico(ROOT_ICON[c.category]) : ico("folder")}<span>${esc(c.name)}</span>`;
      return i === crumbs.length - 1 ? `<li><span class="px-crumb" aria-current="location" data-drop="${where}">${label}</span></li>` : `<li><button type="button" class="px-crumb" data-nav="${where}" data-drop="${where}">${label}</button></li>`;
    }).join("")}</ol>`;
    const ol = q("[data-px-crumbs] ol");
    ol.scrollLeft = ol.scrollWidth;
  }

  // ---------- Conteúdo ----------
  function badges(e) {
    const b = [], raw = e.raw;
    if (e.type === "scene") {
      if (raw.current) b.push(["live", "Em apresentação"]);
      else if (raw.hasSaved) b.push(["", "Já visitada"]);
      if (raw.layerMode === "scene") b.push(["", "mapa próprio"]);
    }
    if (e.type === "map") {
      if (raw.inUse) b.push(["live", "Na mesa"]);
      if (raw.sourceKey) b.push(["", `modelo: ${officialName(raw.sourceKey)}`]);
      if (raw.scenes > 0) b.push(["", P.countLabel("scene", raw.scenes)]);
    }
    if (e.type === "character") {
      if (raw.copy) b.push(["", "cópia"]);
      if (raw.sharedWithPlayers) b.push(["", "visível ao grupo"]);
      if (raw.templateName) b.push(["", `ficha: ${raw.templateName}`]);
    }
    return b.map(([cls, text]) => `<span class="chip px-badge${cls ? " " + cls : ""}">${esc(text)}</span>`).join("");
  }
  function meta(e) {
    if (e.type === "folder") {
      const kids = folders().filter((f) => f.parentId === e.id).length + st.entries.items.filter((i) => i.folderId === e.id).length;
      return kids ? P.countLabel("item", kids) : "Pasta vazia";
    }
    if (e.type === "map") return [P.typeLabel(e), P.mapDimensions(e.raw)].filter(Boolean).join(" · ");
    if (e.type === "scene") return [P.typeLabel(e), e.raw.mapName].filter(Boolean).join(" · ");
    return [P.typeLabel(e), e.raw.summary].filter(Boolean).join(" · ");
  }
  function itemHtml(e, everywhere) {
    const selected = st.selected.includes(e.key);
    const where = e.type === "folder" ? esc(locKey({ category: e.category, folderId: e.id })) : "";
    const place = everywhere ? `<span class="px-col px-col-place">${esc(P.locationLabel(folders(), e.category, e.folderId))}</span>` : "";
    return `<li role="option" class="px-item px-${e.type}${selected ? " selected" : ""}${isCut(e) ? " px-cut" : ""}" aria-selected="${selected}" tabindex="-1" draggable="${blocked() ? "false" : "true"}" data-key="${esc(e.key)}"${where ? ` data-drop="${where}"` : ""}>
<div class="px-thumb" data-thumb="${esc(e.key)}" aria-hidden="true">${e.type === "folder" ? ico("folder") : ""}</div>
<div class="px-info"><span class="px-name">${esc(e.name)}</span><small class="px-meta">${esc(meta(e))}</small><span class="px-badges">${badges(e)}</span></div>
<span class="px-col px-col-type">${esc(P.typeLabel(e))}</span>${place}<span class="px-col px-col-date">${esc(localDate(e.createdAt))}</span><span class="px-col px-col-date">${esc(localDate(e.updatedAt))}</span></li>`;
  }
  const isCut = (e) => { const c = clipboardByCampaign.get(d.id); return c?.mode === "cut" && c.entries.some((x) => x.key === e.key); };

  function paintContent() {
    const cur = loc();
    const everywhere = st.everywhere && !!P.normalizeText(st.query);
    st.visible = P.visibleEntries(st.entries, { category: cur.category, folderId: cur.folderId, query: st.query, everywhere, sort: prefs.sort, dir: prefs.dir });
    const body = q("[data-px-body]");
    const hadFocus = body.contains(document.activeElement) && document.activeElement !== body;
    observer?.disconnect();
    const head = prefs.view === "list" ? `<div class="px-list-head" role="presentation">${[["name", "Nome"], ["type", "Tipo"], ...(everywhere ? [["", "Local"]] : []), ["created", "Criação"], ["modified", "Modificação"]].map(([k, l]) => k ? `<button type="button" class="px-colhead${prefs.sort === k ? " active" : ""}" data-px-sortcol="${k}" aria-label="Ordenar por ${l.toLowerCase()}${prefs.sort === k ? (prefs.dir === "asc" ? ", crescente" : ", decrescente") : ""}">${l}${prefs.sort === k ? (prefs.dir === "asc" ? " ▲" : " ▼") : ""}</button>` : `<span class="px-colhead">${l}</span>`).join("")}</div>` : "";
    if (!st.visible.length) {
      const searching = !!P.normalizeText(st.query);
      body.innerHTML = `<div class="px-state px-empty" data-drop="${esc(locKey(cur))}">${ico(searching ? "zoom" : "folderOpen")}<h3>${searching ? "Nada encontrado." : cur.folderId ? "Esta pasta está vazia." : `Nenhum item em ${esc(P.ROOTS[cur.category])}.`}${searching ? "" : rootHelp(cur.category)}</h3><p>${searching ? `Nenhum item corresponde a “${esc(st.query)}”${everywhere ? "" : " nesta pasta. Marque “em todas as pastas” para ampliar a busca"}.` : esc(EMPTY_TEXT[cur.category])}</p>${searching || blocked() ? "" : `<div class="px-empty-actions"><button type="button" class="primary" data-px-empty="new">${esc(P.NEW_LABELS[cur.category])}</button><button type="button" class="subtle" data-px-empty="folder">Nova pasta</button></div>`}</div>`;
    } else {
      body.innerHTML = `${head}<ul class="px-items" role="listbox" aria-multiselectable="true" aria-label="${esc(everywhere ? "Resultados da busca" : P.locationLabel(folders(), cur.category, cur.folderId))}" data-drop="${esc(locKey(cur))}">${st.visible.map((e) => itemHtml(e, everywhere)).join("")}</ul>`;
      const focus = st.visible.find((e) => e.key === st.focusKey) || st.visible.find((e) => st.selected.includes(e.key)) || st.visible[0];
      st.focusKey = focus.key;
      option(focus.key).tabIndex = 0;
      if (hadFocus) option(focus.key).focus({ preventScroll: true });
      observeThumbs(body);
    }
    say(`${P.countLabel("item", st.visible.length)}${st.selected.length ? ` · ${st.selected.length} selecionado${st.selected.length === 1 ? "" : "s"}` : ""}`);
  }
  const option = (key) => q(`[data-px-body] [data-key="${CSS.escape(key)}"]`);

  function observeThumbs(host) {
    const draw = (el) => { const e = st.byKey.get(el.dataset.thumb); if (e) drawThumb(el, e); };
    if (!("IntersectionObserver" in window)) { host.querySelectorAll("[data-thumb]").forEach(draw); return; }
    observer = new IntersectionObserver((list) => { for (const it of list) if (it.isIntersecting) { observer.unobserve(it.target); draw(it.target); } }, { root: null, rootMargin: "200px" });
    host.querySelectorAll("[data-thumb]").forEach((el) => observer.observe(el));
  }
  function drawThumb(el, e) {
    if (e.type === "folder") return;
    if (e.type === "character") {
      const initial = (e.name || "?").trim().charAt(0).toUpperCase();
      const src = safeImageUrl(e.raw.imagePreview);
      if (!src) { el.innerHTML = `<span class="px-initial">${esc(initial)}</span>`; return; }
      const img = Object.assign(document.createElement("img"), { alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer", src });
      img.addEventListener("error", () => { el.innerHTML = `<span class="px-initial">${esc(initial)}</span>`; }, { once: true });
      el.replaceChildren(img);
      return;
    }
    const map = e.type === "map" ? e.raw : e.raw.kind === "text" ? null : mapByKey(e.raw.mapKey);
    if (!map) { el.innerHTML = `<span class="px-initial px-text-scene">${e.raw.kind === "text" ? "¶" : ico("atlas")}</span>`; return; }
    const cacheKey = `${e.key}|${map.key}|${map.revision ?? ""}|${map.updatedAt ?? ""}`;
    const cached = thumbs.get(cacheKey);
    if (cached) { el.replaceChildren(cached); return; }
    mapThumbnail(el, map);
    if (el.firstElementChild) thumbs.set(cacheKey, el.firstElementChild);
  }

  // ---------- Seleção ----------
  function setSelection(keys, { anchor, focus } = {}) {
    st.selected = [...new Set(keys)].filter((k) => st.byKey.has(k));
    if (anchor !== undefined) st.anchor = anchor;
    if (focus) st.focusKey = focus;
    paintSelection();
  }
  function paintSelection() {
    for (const el of q("[data-px-body]").querySelectorAll("[data-key]")) {
      const on = st.selected.includes(el.dataset.key);
      el.classList.toggle("selected", on);
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = el.dataset.key === st.focusKey ? 0 : -1;
    }
    say(`${P.countLabel("item", st.visible.length)}${st.selected.length ? ` · ${st.selected.length} selecionado${st.selected.length === 1 ? "" : "s"}` : ""}`);
    paintToolbar(); paintDetails();
  }
  function focusOption(key) {
    const el = key && option(key);
    if (!el) return;
    st.focusKey = key;
    for (const o of q("[data-px-body]").querySelectorAll("[data-key]")) o.tabIndex = o === el ? 0 : -1;
    el.focus({ preventScroll: false });
  }
  function clickSelect(key, e) {
    const keys = st.visible.map((x) => x.key);
    if (e.shiftKey) setSelection(P.rangeSelection(keys, st.anchor || st.focusKey, key), { focus: key });
    else if (e.ctrlKey || e.metaKey) setSelection(P.toggleKey(st.selected, key), { anchor: key, focus: key });
    else setSelection([key], { anchor: key, focus: key });
  }

  // ---------- Detalhes ----------
  function row(label, value) { return value === "" || value == null ? "" : `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`; }
  function paintDetails() {
    const host = q("[data-px-details]");
    const hadFocus = host.contains(document.activeElement);
    paintDetailsHtml(host);
    if (hadFocus && !host.contains(document.activeElement)) host.focus({ preventScroll: true });
  }
  function paintDetailsHtml(host) {
    if (!prefs.details) { host.innerHTML = ""; return; }
    const sel = selection(), cur = loc();
    const close = `<button type="button" class="px-tb icon-only px-details-close" data-px="details" aria-label="Recolher detalhes" data-tip="Recolher detalhes">${icon("close")}</button>`;
    if (!sel.length) {
      const here = P.visibleEntries(st.entries, { category: cur.category, folderId: cur.folderId });
      const name = P.breadcrumbs(folders(), cur.category, cur.folderId).at(-1).name;
      host.innerHTML = `<div class="px-details-head">${close}<h3>${ico(cur.folderId ? "folderOpen" : ROOT_ICON[cur.category])}<span>${esc(name)}</span>${rootHelp(cur.category)}</h3></div><dl class="px-props">${row("Local", P.locationLabel(folders(), cur.category, cur.folderId))}${row("Conteúdo", `${P.countLabel("folder", here.filter((e) => e.type === "folder").length)} · ${P.countLabel(P.TYPE_OF_CATEGORY[cur.category], here.filter((e) => e.type !== "folder").length)}`)}${cur.folderId ? "" : row("Limite", limitText(cur.category))}</dl><p class="muted small">Selecione um item para ver detalhes. Clique com o botão direito para mais ações.</p>`;
      return;
    }
    if (sel.length > 1) {
      host.innerHTML = `<div class="px-details-head">${close}<h3>${ico("tiles")}<span>${esc(P.selectionSummary(sel))}</span></h3></div><p class="muted small">Ações valem para todos os itens selecionados.</p><div class="px-detail-actions">${panelButtons(sel)}</div>`;
      return;
    }
    const e = sel[0], raw = e.raw;
    if (e.type === "character" && !st.npcs) npcs().then(() => { if (!st.disposed && st.selected.length === 1 && st.selected[0] === e.key) paintDetails(); }).catch(() => {});
    const props = [row("Tipo", P.typeLabel(e)), row("Local", P.locationLabel(folders(), e.category, e.folderId))];
    if (e.type === "map") {
      props.push(row("Dimensões", P.mapDimensions(raw)));
      if (!raw.isTileMap && raw.hasGrid !== false && raw.gridPixels) props.push(row("Grade", `${raw.gridPixels} px por casa${raw.gridOffsetX || raw.gridOffsetY ? ` · deslocada ${raw.gridOffsetX}/${raw.gridOffsetY} px` : ""}`));
      if (raw.scaleMeters) props.push(row("Escala", `${decimal(raw.scaleMeters)} m por casa`));
      props.push(row("Origem", raw.sourceKey ? `Modelo: ${officialName(raw.sourceKey)}` : raw.isTileMap ? "Criado com tiles" : "Enviado ou importado"));
      props.push(row("Cenas que usam", String(raw.scenes || 0)));
      props.push(row("Estado", raw.inUse ? "Na mesa agora" : ""));
    }
    if (e.type === "scene") {
      props.push(row("Mapa", raw.kind === "text" ? "Sem mapa (texto)" : raw.mapName || ""));
      props.push(row("Camadas", raw.layerMode === "scene" ? "Preparação própria da cena" : raw.kind === "text" ? "" : "Preparação do mapa"));
      props.push(row("Marcadores", raw.prepared ? String(raw.prepared) : ""));
      props.push(row("Estado", raw.current ? "Em apresentação" : raw.hasSaved ? "Já visitada" : "Preparada"));
    }
    if (e.type === "character") {
      props.push(row("Lado", { enemy: "Inimigo", neutral: "Neutro", ally: "Aliado" }[raw.side] || ""));
      props.push(row("Ficha", raw.templateName || "Recursos simples"));
      props.push(row("Visível ao grupo", raw.sharedWithPlayers ? "Sim" : "Não"));
      props.push(row("Cópia para encontro", raw.copy ? "Sim" : ""));
    }
    if (e.type === "folder") props.push(row("Conteúdo", meta(e)));
    props.push(row("Criado em", localDate(e.createdAt)), row("Modificado em", localDate(e.updatedAt)));
    host.innerHTML = `<div class="px-details-head">${close}<h3>${ico(TYPE_ICON[e.type])}<span>${esc(e.name)}</span></h3></div>${e.type === "folder" ? "" : `<div class="px-preview" data-thumb="${esc(e.key)}" aria-hidden="true"></div>`}${e.description ? `<p class="px-desc">${esc(e.description)}</p>` : ""}<dl class="px-props">${props.join("")}</dl><div class="px-detail-actions">${panelButtons(sel)}</div>`;
    const preview = host.querySelector(".px-preview");
    if (preview) { const clone = { ...e, key: `detail:${e.key}` }; drawThumb(preview, clone); }
  }
  function limitText(category) {
    const l = st.data?.limits || {};
    const n = st.entries.items.filter((i) => i.category === category).length;
    const max = { scenes: l.scenes, maps: l.maps, characters: l.characters }[category];
    return max ? `${n} de ${max}` : "";
  }
  function panelButtons(sel) {
    return actionsFor(sel).filter((a) => a.panel && !a.separator).map((a, i) => `<button type="button" class="${i === 0 ? "primary" : "subtle"} small" data-px-act="${esc(a.id)}"${a.disabled ? ` aria-disabled="true" data-tip="${esc(a.disabledReason || "")}"` : ""}>${esc(a.label)}</button>`).join("");
  }

  // ---------- Ações ----------
  const writeItem = (item) => (blocked() ? { ...item, disabled: true, disabledReason: ARCHIVED } : item);
  function moveMenu(sel) {
    const category = sel[0]?.category;
    if (!category || sel.some((e) => e.category !== category)) return [{ label: "Selecione itens de uma só categoria", disabled: true }];
    const list = [{ id: null, name: P.ROOTS[category], depth: 0 }, ...flatten(P.buildTree(folders(), category)).map((f) => ({ ...f, depth: f.depth + 1 }))];
    return list.slice(0, 101).map((f) => {
      const target = { category, folderId: f.id };
      const check = P.checkTransfer(sel, target, folders());
      return { label: `${" ".repeat(f.depth)}${f.name}`, disabled: !check.ok, disabledReason: check.reason, run: () => moveTo(sel, target) };
    });
  }
  function actionsFor(sel) {
    if (!sel.length) return [];
    const one = sel.length === 1 ? sel[0] : null, raw = one?.raw || {};
    const A = [];
    const add = (a) => A.push(a);
    const sep = () => A.push({ separator: true });
    if (one?.type === "folder") add({ id: "open", label: "Abrir", shortcut: "enter", run: () => openEntry(one), panel: true });
    if (one?.type === "scene") add(writeItem({ id: "open", label: "Editar preparação", shortcut: "enter", run: () => openEntry(one), panel: true }));
    if (one?.type === "map") {
      add(writeItem({ id: "open", label: "Editar mapa", shortcut: "enter", run: () => openEntry(one), panel: true }));
      if (!raw.isTileMap) add(writeItem({ id: "configure", label: "Configurar…", run: () => configureMap(one), panel: true }));
      if (raw.hasGrid !== false && raw.kind === "tileset") add(writeItem({ id: "fog", label: "Preparar névoa e luz", run: () => openFog(one), panel: true }));
      add(writeItem({ id: "scene-from", label: "Criar cena a partir deste mapa", run: () => sceneFromMap(one), panel: true }));
      if (st.data?.activeSessionId) add(raw.inUse ? { id: "hide", label: "Ocultar mapa da mesa", run: () => showOnTable(null), panel: true } : { id: "show", label: "Mostrar na mesa", run: () => showOnTable(one), panel: true });
    }
    if (one?.type === "character") {
      add({ id: "open", label: "Abrir ficha", shortcut: "enter", run: () => openEntry(one), panel: true });
      add(writeItem({ id: "edit", label: "Editar…", run: () => editCharacter(one), panel: true }));
      const full = (st.npcs || []).find((n) => n.id === one.id);
      if (!raw.copy && !full?.page) add(writeItem({ id: "lore", label: "+ História", hint: "Página em Mundo e acervo", run: () => characterLore(one), panel: true }));
      if (full?.page) add({ id: "lore-open", label: "Abrir história", run: () => { location.hash = `#campaign/${d.id}/world/${full.page.id}`; }, panel: true });
      add(writeItem({ id: "encounter", label: "Cópia para encontro", run: () => encounterCopy(one), panel: true }));
    }
    sep();
    add(writeItem({ id: "duplicate", label: "Duplicar", shortcut: "mod+d", run: () => duplicate(sel), panel: true }));
    add(writeItem({ id: "copy", label: "Copiar", shortcut: "mod+c", run: () => toClipboard("copy", sel) }));
    add(writeItem({ id: "cut", label: "Recortar", shortcut: "mod+x", run: () => toClipboard("cut", sel) }));
    if (one?.type === "folder") {
      const clip = clipboardByCampaign.get(d.id);
      add(writeItem({ id: "paste-into", label: "Colar nesta pasta", disabled: !clip?.entries.length, disabledReason: "Copie ou recorte itens antes de colar.", run: () => paste({ category: one.category, folderId: one.id }) }));
    }
    add(writeItem({ id: "move", label: "Mover para", items: blocked() ? undefined : moveMenu(sel), panel: false }));
    sep();
    add(writeItem({ id: "rename", label: "Renomear", shortcut: "f2", disabled: !one, disabledReason: "Selecione um único item.", run: () => startRename(one), panel: !!one }));
    const current = sel.find((e) => e.type === "scene" && e.raw.current);
    add(writeItem({ id: "delete", label: "Excluir", shortcut: "delete", danger: true, disabled: !!current, disabledReason: "Apresente outra cena antes de excluir esta.", run: () => confirmDelete(sel), panel: true }));
    sep();
    add({ id: "properties", label: "Propriedades", shortcut: "alt+enter", run: () => showProperties() });
    return A.filter((a, i, all) => !(a.separator && (i === 0 || all[i - 1]?.separator || i === all.length - 1)));
  }
  function backgroundMenu() {
    const cur = loc(), clip = clipboardByCampaign.get(d.id);
    return [
      writeItem({ label: `${P.NEW_LABELS[cur.category]}…`, run: () => createNew(cur.category) }),
      writeItem({ label: "Novo em outra raiz", items: P.CATEGORIES.filter((c) => c !== cur.category).map((c) => ({ label: `${P.NEW_LABELS[c]}…`, run: async () => { navigate({ category: c, folderId: null }); await createNew(c); } })) }),
      writeItem({ label: "Nova pasta", run: () => newFolder() }),
      ...(cur.category === "maps" ? [writeItem({ label: "Importar", items: importItems() })] : []),
      { separator: true },
      writeItem({ label: "Colar", shortcut: "mod+v", disabled: !clip?.entries.length, disabledReason: "Copie ou recorte itens antes de colar.", run: () => paste() }),
      { label: "Selecionar tudo", shortcut: "mod+a", run: () => setSelection(st.visible.map((e) => e.key), { anchor: st.visible[0]?.key }) },
      { label: "Atualizar", run: () => refresh(st.selected) },
      { separator: true },
      { label: "Exibição", items: [
        { label: "Ícones", checked: prefs.view === "grid", run: () => setPref({ view: "grid" }) },
        { label: "Lista e detalhes", checked: prefs.view === "list", run: () => setPref({ view: "list" }) },
        { separator: true },
        ...P.SORT_KEYS.map(([k, l]) => ({ label: `Ordenar por ${l.toLowerCase()}`, checked: prefs.sort === k, run: () => setPref({ sort: k }) })),
        { label: "Ordem decrescente", checked: prefs.dir === "desc", run: () => setPref({ dir: prefs.dir === "asc" ? "desc" : "asc" }) },
        { separator: true },
        { label: "Painel de detalhes", checked: prefs.details, run: () => setPref({ details: !prefs.details }) },
      ] },
    ];
  }
  function importItems() {
    return [
      { label: "Arquivo VTT (UVTT)…", run: async () => (await creator()).importUvtt(ctx()) },
      { label: "Imagem do dispositivo…", run: async () => (await creator()).uploadImage(ctx(), "file") },
      { label: "Imagem por link…", run: async () => (await creator()).uploadImage(ctx(), "link") },
    ];
  }
  async function openMenu(at, sel) {
    if (sel.some((e) => e.type === "character")) await npcs().catch(() => null);
    openContextMenu(at, sel.length ? actionsFor(sel) : backgroundMenu(), { label: sel.length ? `Ações: ${P.selectionSummary(sel)}` : "Ações da pasta" });
  }
  function setPref(patch) {
    Object.assign(prefs, patch);
    savePrefs(prefs);
    if ("view" in patch || "sort" in patch || "dir" in patch) paintContent();
    root.dataset.view = prefs.view;
    root.dataset.details = prefs.details ? "open" : "closed";
    paintToolbar(); paintDetails();
  }

  // ---------- Navegação ----------
  function navigate(next, { push = true } = {}) {
    if (!next) return;
    st.nav = push ? P.pushLocation(st.nav, next) : { ...st.nav, current: next };
    st.selected = []; st.anchor = null; st.focusKey = null; st.query = ""; st.everywhere = false;
    const input = q("#px-q"); if (input) input.value = "";
    const every = q("[data-px-everywhere]"); if (every) every.checked = false;
    closeTree();
    paintAll();
  }
  function navHistory(dir) {
    const next = dir < 0 ? P.goBack(st.nav) : P.goForward(st.nav);
    if (next === st.nav) return;
    st.nav = next;
    navigate(next.current, { push: false });
  }
  function closeTree() {
    if (!st.treeOpen) return;
    st.treeOpen = false; root.dataset.tree = "closed";
    q('[data-px="tree"]').setAttribute("aria-expanded", "false");
  }

  // ---------- Abrir e editar ----------
  async function openEntry(e) {
    if (!e) return;
    if (e.type === "folder") return navigate({ category: e.category, folderId: e.id });
    if (e.type === "character") {
      await (await import("./npc-sheet.js")).openNpcSheet({ campaignId: d.id, npcId: e.id, onSaved: () => !st.disposed && refresh([e.key]) });
      return;
    }
    if (blocked()) return toast(ARCHIVED);
    if (e.type === "scene") {
      await (await import("./scene-editor.js")).openSceneEditor({ campaign: d, sceneId: e.id });
      if (!st.disposed) await refresh([e.key]);
      return;
    }
    await openMapEditor(e.raw);
    if (!st.disposed) await refresh([e.key]);
  }
  async function openMapEditor(map) {
    const onSaved = () => {};
    if (map.isTileMap) await (await import("./tile-map-editor.js")).openTileMapEditor(d, { item: map, onSaved });
    else await (await import("./image-map-editor.js")).openImageMapEditor(d, { item: map, onSaved });
  }
  async function configureMap(e) {
    (await import("./campaign-assets.js")).openMapUpload(d, { item: { ...e.raw }, folders: folders(), onSaved: () => refresh([e.key]) });
  }
  async function openFog(e) {
    await (await import("./fog-editor.js")).openLayerEditor(d, e.raw.key);
    if (!st.disposed) await refresh([e.key]);
  }
  async function sceneFromMap(e) { (await creator()).sceneFromMapFlow(ctx(), e.raw); }
  async function showOnTable(e) {
    const session = st.data?.activeSessionId;
    if (!session) return toast("Abra uma sessão para mostrar mapas na mesa.");
    await api(`/sessions/${session}/map`, "POST", e ? { mapKind: e.raw.kind || "tileset", mapKey: e.raw.key } : { mapKind: "cartographic", mapKey: "valley" });
    toast(e ? "Mapa mostrado para a mesa." : "Mapa da campanha ocultado. A mesa exibe o cenário oficial.");
    await refresh(st.selected);
  }
  async function editCharacter(e) {
    const full = (await npcs()).find((n) => n.id === e.id);
    if (!full) return toast("Personagem não encontrado. Atualize a lista.");
    (await import("./campaign-prep.js")).npcModal(d, full, () => refresh([e.key]));
  }
  async function characterLore(e) {
    await (await import("./campaign-workspace.js")).newPage(d, { kind: "text", title: e.name, npcId: e.id }, () => !st.disposed && refresh([e.key]));
  }
  async function encounterCopy(e) {
    const copy = await api(`${base}/npcs/${e.id}/copy`, "POST");
    toast("Cópia para encontro criada.");
    await refresh(copy?.id ? [P.entryKey("character", copy.id)] : [e.key]);
  }
  function showProperties() {
    if (!prefs.details) setPref({ details: true });
    const host = q("[data-px-details]");
    host.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    host.focus({ preventScroll: true });
  }

  // ---------- Criação ----------
  let createModule = null;
  async function creator() { createModule ||= await import("./prep-create.js"); return createModule; }
  function ctx() {
    return {
      d, folderId: loc().folderId, folders: folders(), maps: st.data?.maps || [], official: st.official || [],
      sceneCount: st.entries.items.filter((e) => e.type === "scene").length,
      onCreated: (created) => afterCreate(created),
    };
  }
  /** Depois de criar: atualiza, seleciona o novo item e, quando pedido, abre o editor certo. */
  async function afterCreate({ type, id, open = false } = {}) {
    if (st.disposed) return;
    const key = type && id ? P.entryKey(type, id) : null;
    await refresh(key ? [key] : st.selected);
    const e = key && st.byKey.get(key);
    if (!e) return;
    if (!P.sameLocation(loc(), { category: e.category, folderId: e.folderId })) { navigate({ category: e.category, folderId: e.folderId }); setSelection([key], { anchor: key, focus: key }); }
    focusOption(key);
    // O editor fica aberto até o mestre fechar: nunca aguardá-lo aqui. Quem chama costuma estar dentro de um envio
    // de formulário (espera em primeiro plano), que deixaria a página — e o próprio editor — inerte até o fechamento.
    if (open) setTimeout(() => { if (!st.disposed) Promise.resolve(openEntry(e)).catch((error) => toast(error.message)); }, 0);
  }
  async function createNew(category = loc().category) {
    if (blocked()) return toast(ARCHIVED);
    const c = await creator();
    if (category === "maps") return c.openNewMap(ctx());
    if (category === "scenes") return c.openNewScene(ctx());
    return c.openNewCharacter(ctx());
  }
  async function newFolder() {
    if (blocked()) return toast(ARCHIVED);
    const cur = loc();
    const siblings = new Set(folders().filter((f) => f.category === cur.category && (f.parentId || null) === (cur.folderId || null)).map((f) => P.normalizeText(f.name)));
    let name = "Nova pasta";
    for (let i = 2; siblings.has(P.normalizeText(name)) && i < 200; i++) name = `Nova pasta (${i})`;
    try {
      const folder = await api(`${base}/prep/folders`, "POST", { name, parentId: cur.folderId || null, category: cur.category });
      const key = P.entryKey("folder", folder.id);
      await refresh([key]);
      focusOption(key);
      const e = st.byKey.get(key);
      if (e) startRename(e);
    } catch (error) { toast(error.message); }
  }

  // ---------- Área de transferência, mover, duplicar ----------
  function toClipboard(mode, sel) {
    if (blocked()) return toast(ARCHIVED);
    if (!sel.length) return;
    clipboardByCampaign.set(d.id, { mode, entries: sel.map((e) => ({ key: e.key, type: e.type, id: e.id, category: e.category })) });
    say(`${P.selectionSummary(sel)} ${mode === "cut" ? "recortado(s)" : "copiado(s)"}. Use Colar na pasta de destino.`);
    paintContent(); paintSelection();
  }
  async function paste(target = loc()) {
    if (blocked()) return toast(ARCHIVED);
    const clip = clipboardByCampaign.get(d.id);
    const entries = (clip?.entries || []).map((x) => st.byKey.get(x.key)).filter(Boolean);
    if (!entries.length) { clipboardByCampaign.delete(d.id); paintToolbar(); return toast("A área de transferência está vazia."); }
    const check = P.checkTransfer(entries, target, folders(), { mode: clip.mode === "cut" ? "move" : "copy" });
    if (!check.ok) return toast(check.reason);
    try {
      if (clip.mode === "cut") {
        await api(`${base}/prep/move`, "POST", P.transferBody(entries, target));
        clipboardByCampaign.delete(d.id);
        toast(`${P.selectionSummary(entries)} movido(s).`);
        await refresh(entries.map((e) => e.key));
      } else {
        const r = await api(`${base}/prep/copy`, "POST", P.transferBody(entries, target));
        toast(`${P.selectionSummary(entries)} copiado(s).`);
        await refresh((r?.created || []).map((c) => P.entryKey(c.type, c.id)));
      }
    } catch (error) { toast(error.message); }
  }
  async function moveTo(entries, target) {
    if (blocked()) return toast(ARCHIVED);
    const check = P.checkTransfer(entries, target, folders());
    if (!check.ok) { if (!check.noop) toast(check.reason); return; }
    try {
      await api(`${base}/prep/move`, "POST", P.transferBody(entries, target));
      say(`${P.selectionSummary(entries)} movido(s) para ${P.locationLabel(folders(), target.category, target.folderId)}.`);
      await refresh(entries.map((e) => e.key));
    } catch (error) { toast(error.message); }
  }
  async function duplicate(sel) {
    if (blocked()) return toast(ARCHIVED);
    const groups = new Map();
    for (const e of sel) { const k = locKey({ category: e.category, folderId: e.folderId }); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const created = [];
    try {
      for (const [k, list] of groups) {
        const r = await api(`${base}/prep/copy`, "POST", P.transferBody(list, parseLoc(k)));
        created.push(...(r?.created || []).map((c) => P.entryKey(c.type, c.id)));
      }
      toast(`${P.selectionSummary(sel)} duplicado(s).`);
    } catch (error) { toast(error.message); }
    await refresh(created.length ? created : st.selected);
  }

  // ---------- Renomear ----------
  function startRename(e) {
    if (!e) return;
    if (blocked()) return toast(ARCHIVED);
    const el = option(e.key);
    if (!el) return renameDialog(e);
    const nameEl = el.querySelector(".px-name");
    const input = Object.assign(document.createElement("input"), { className: "px-rename", value: e.name, maxLength: P.NAME_LIMITS[e.type] || 100, type: "text" });
    input.dataset.noCount = "";
    input.setAttribute("aria-label", `Novo nome de ${e.name}`);
    el.draggable = false;
    nameEl.replaceWith(input);
    renaming = true;
    input.focus(); input.select();
    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      const next = P.validateName(e.type, input.value);
      if (!commit || next.name === e.name) { renaming = false; paintContent(); focusOption(e.key); return; }
      if (next.error) { toast(next.error); finished = false; input.focus(); return; }
      input.disabled = true;
      try { await api(`${base}/prep/rename`, "PUT", { type: e.type, id: e.id, name: next.name, revision: e.raw.revision || 0 }); }
      catch (error) { toast(error.status === 409 ? "Este item mudou em outro lugar. A lista foi atualizada; tente renomear de novo." : error.message); }
      renaming = false;
      await refresh([e.key]);
      focusOption(e.key);
    };
    for (const type of ["pointerdown", "click", "dblclick", "contextmenu"]) input.addEventListener(type, (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  }
  function renameDialog(e) {
    modal(`Renomear ${P.typeLabel(e).toLowerCase()}`, `<form id="px-rename-form"><div class="field"><label for="px-rename-name">Nome</label><input id="px-rename-name" name="name" required maxlength="${P.NAME_LIMITS[e.type] || 100}" value="${esc(e.name)}"></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Renomear</button></div></form>`);
    $("#px-rename-name").select();
    $("#px-rename-form").onsubmit = (ev) => {
      ev.preventDefault();
      submitForm(ev.currentTarget, async (data) => {
        const next = P.validateName(e.type, data.name);
        if (next.error) throw new Error(next.error);
        await api(`${base}/prep/rename`, "PUT", { type: e.type, id: e.id, name: next.name, revision: e.raw.revision || 0 });
        $("#modal").close();
        await refresh([e.key]);
      });
    };
  }

  // ---------- Excluir ----------
  function deletePath(e) {
    return { scene: `${base}/scenes/${e.id}`, map: `${base}/assets/maps/${e.id}`, character: `${base}/npcs/${e.id}`, folder: `${base}/prep/folders/${e.id}` }[e.type];
  }
  function confirmDelete(sel) {
    if (blocked()) return toast(ARCHIVED);
    if (!sel.length) return;
    const shown = sel.slice(0, 12);
    const note = [
      sel.some((e) => e.type === "folder") ? "Pastas precisam estar vazias (itens selecionados junto são excluídos antes)." : "",
      sel.some((e) => e.type === "scene") ? "Mapas e personagens usados pelas cenas continuam na campanha; a preparação própria da cena é excluída." : "",
      sel.some((e) => e.type === "map") ? "Mapas na mesa não podem ser excluídos: oculte-os antes. As imagens-fonte do mapa também são removidas." : "",
    ].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join("");
    modal(sel.length === 1 ? `Excluir “${sel[0].name}”?` : `Excluir ${P.countLabel("item", sel.length)}?`, `<p>Esta ação não pode ser desfeita.</p><ul class="px-delete-list">${shown.map((e) => `<li>${ico(TYPE_ICON[e.type])}<span><strong>${esc(e.name)}</strong> <small>${esc(P.typeLabel(e))}${e.type === "scene" && e.raw.current ? " · em apresentação, não será excluída" : ""}</small></span></li>`).join("")}${sel.length > shown.length ? `<li class="muted">e mais ${sel.length - shown.length}…</li>` : ""}</ul>${note ? `<ul class="form-help px-delete-notes">${note}</ul>` : ""}<form id="px-delete-form">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="danger" type="submit">Excluir</button></div></form>`);
    $("#px-delete-form").onsubmit = (ev) => {
      ev.preventDefault();
      submitForm(ev.currentTarget, async () => {
        const items = sel.filter((e) => e.type !== "folder");
        const fold = sel.filter((e) => e.type === "folder").sort((a, b) => P.folderDepth(folders(), b.id) - P.folderDepth(folders(), a.id));
        const errors = [];
        let done = 0;
        for (const e of [...items, ...fold]) {
          if (e.type === "scene" && e.raw.current) { errors.push(`${e.name}: em apresentação na mesa.`); continue; }
          try { await api(deletePath(e), "DELETE"); done++; }
          catch (error) { errors.push(`${e.name}: ${error.status === 409 && e.type === "folder" ? "a pasta não está vazia." : error.message}`); }
        }
        const clip = clipboardByCampaign.get(d.id);
        if (clip) clip.entries = clip.entries.filter((x) => !sel.some((e) => e.key === x.key));
        await refresh(errors.length ? sel.map((e) => e.key) : []);
        if (errors.length) throw new Error(`${done ? `${P.countLabel("item", done)} excluído(s). ` : ""}Não excluídos — ${errors.join(" ")}`);
        $("#modal").close();
        toast(`${P.countLabel("item", done)} excluído${done === 1 ? "" : "s"}.`);
        q("[data-px-body]")?.focus?.();
      });
    };
  }

  // ---------- Eventos ----------
  function bind() {
    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", onDblClick);
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("keydown", onKey);
    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);
    root.addEventListener("dragend", onDragEnd);
    const input = q("#px-q");
    let timer = 0;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { st.query = input.value; st.selected = []; paintContent(); paintToolbar(); paintDetails(); }, 120); });
    q("[data-px-search]").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); st.query = input.value; paintContent(); });
    q("[data-px-everywhere]").addEventListener("change", (e) => { st.everywhere = e.target.checked; paintContent(); });
    q("[data-px-toolbar]").addEventListener("change", (e) => { if (e.target.matches("[data-px-sort]")) setPref({ sort: e.target.value }); });
  }

  async function onClick(e) {
    const tool = e.target.closest("[data-px]");
    if (tool) {
      if (tool.getAttribute("aria-disabled") === "true") { toast(tool.dataset.tip || "Indisponível."); return; }
      return runTool(tool.dataset.px, tool);
    }
    const act = e.target.closest("[data-px-act]");
    if (act) {
      if (act.getAttribute("aria-disabled") === "true") { toast(act.dataset.tip || "Indisponível."); return; }
      if (selection().some((x) => x.type === "character")) await npcs().catch(() => null);
      const a = actionsFor(selection()).find((x) => x.id === act.dataset.pxAct);
      if (a && !a.disabled) Promise.resolve(a.run?.()).catch((error) => toast(error.message));
      return;
    }
    const empty = e.target.closest("[data-px-empty]");
    if (empty) return empty.dataset.pxEmpty === "new" ? createNew() : newFolder();
    const crumb = e.target.closest("[data-nav]");
    if (crumb) return navigate(parseLoc(crumb.dataset.nav));
    const twisty = e.target.closest("[data-twisty]");
    const tnode = e.target.closest("[role=treeitem]");
    if (tnode) {
      const where = parseLoc(tnode.dataset.loc), id = where.folderId || `root:${where.category}`;
      if (twisty && tnode.hasAttribute("aria-expanded")) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); paintTree(); focusTree(tnode.dataset.loc); return; }
      const drawer = st.treeOpen;
      navigate(where);
      if (drawer) q("[data-px-body]").focus({ preventScroll: true }); else focusTree(tnode.dataset.loc);
      return;
    }
    const item = e.target.closest("[data-px-body] [data-key]");
    if (item) {
      if (renaming) return;
      // Segundo clique: abre mesmo que a seleção tenha redesenhado o item (o nó novo não recebe "dblclick").
      if (e.detail === 2 && !e.ctrlKey && !e.shiftKey && !e.metaKey) { lastOpen = Date.now(); const entry = st.byKey.get(item.dataset.key); Promise.resolve(openEntry(entry)).catch((error) => toast(error.message)); return; }
      clickSelect(item.dataset.key, e); return;
    }
    if (e.target.closest("[data-px-body]") && !e.ctrlKey && !e.shiftKey) setSelection([], { anchor: null });
  }
  function onDblClick(e) {
    const item = e.target.closest("[data-px-body] [data-key]");
    if (!item || renaming || Date.now() - lastOpen < 600) return;
    lastOpen = Date.now();
    const entry = st.byKey.get(item.dataset.key);
    Promise.resolve(openEntry(entry)).catch((error) => toast(error.message));
  }
  function onContextMenu(e) {
    if (isTypingTarget(e.target)) return;
    const item = e.target.closest("[data-px-body] [data-key]");
    const inContent = e.target.closest("[data-px-body]");
    const tnode = e.target.closest("[role=treeitem]");
    if (!item && !inContent && !tnode) return;
    e.preventDefault();
    // Tecla de menu (sem coordenadas): abre junto do elemento em foco.
    const point = (anchor) => (e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : anchor);
    if (tnode) {
      const where = parseLoc(tnode.dataset.loc);
      if (!where.folderId) { navigate(where); openMenu(point(tnode), []); return; }
      const entry = st.byKey.get(P.entryKey("folder", where.folderId));
      if (entry) openMenu(point(tnode), [entry]);
      return;
    }
    if (item) {
      const key = item.dataset.key;
      if (!st.selected.includes(key)) setSelection([key], { anchor: key, focus: key });
      focusOption(key);
      openMenu(point(item), selection());
      return;
    }
    setSelection([], { anchor: null });
    openMenu(point(inContent), []);
  }

  async function runTool(id, el) {
    try {
      if (id === "back") return navHistory(-1);
      if (id === "forward") return navHistory(1);
      if (id === "up") return navigate(P.parentLocation(folders(), loc()));
      if (id === "refresh") return refresh(st.selected);
      if (id === "new") return createNew();
      if (id === "folder") return newFolder();
      if (id === "import") return openContextMenu(el, importItems(), { label: "Importar mapa" });
      if (id === "copy") return toClipboard("copy", selection());
      if (id === "cut") return toClipboard("cut", selection());
      if (id === "paste") return paste();
      if (id === "rename") return startRename(selection()[0]);
      if (id === "delete") return confirmDelete(selection());
      if (id === "actions") return openMenu(el, selection());
      if (id === "view-grid") return setPref({ view: "grid" });
      if (id === "view-list") return setPref({ view: "list" });
      if (id === "dir") return setPref({ dir: prefs.dir === "asc" ? "desc" : "asc" });
      if (id === "details") return setPref({ details: !prefs.details });
      if (id === "tree") {
        st.treeOpen = !st.treeOpen;
        root.dataset.tree = st.treeOpen ? "open" : "closed";
        el.setAttribute("aria-expanded", String(st.treeOpen));
        if (st.treeOpen) q("[data-px-tree] [role=treeitem][tabindex='0']")?.focus();
      }
    } catch (error) { toast(error.message); }
  }

  function focusTree(where) {
    const items = [...q("[data-px-tree]").querySelectorAll("[role=treeitem]")];
    const target = items.find((li) => li.dataset.loc === where) || items[0];
    items.forEach((li) => (li.tabIndex = li === target ? 0 : -1));
    target?.focus({ preventScroll: true });
  }
  function onTreeKey(e, li) {
    const items = [...q("[data-px-tree]").querySelectorAll("[role=treeitem]")];
    const i = items.indexOf(li);
    const where = parseLoc(li.dataset.loc), id = where.folderId || `root:${where.category}`;
    const move = (n) => { const t = items[Math.max(0, Math.min(items.length - 1, n))]; if (t) focusTree(t.dataset.loc); };
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(i + 1); return true;
      case "ArrowUp": e.preventDefault(); move(i - 1); return true;
      case "Home": e.preventDefault(); move(0); return true;
      case "End": e.preventDefault(); move(items.length - 1); return true;
      case "ArrowRight":
        e.preventDefault();
        if (li.getAttribute("aria-expanded") === "false") { expanded.add(id); paintTree(); focusTree(li.dataset.loc); }
        else if (li.getAttribute("aria-expanded") === "true") move(i + 1);
        return true;
      case "ArrowLeft": {
        e.preventDefault();
        if (li.getAttribute("aria-expanded") === "true") { expanded.delete(id); paintTree(); focusTree(li.dataset.loc); return true; }
        const parent = li.parentElement.closest("[role=treeitem]");
        if (parent) focusTree(parent.dataset.loc);
        return true;
      }
      case "Enter": case " ": e.preventDefault(); navigate(where); focusTree(li.dataset.loc); return true;
      default: return false;
    }
  }

  function gridColumns() {
    const opts = [...q("[data-px-body]").querySelectorAll("[data-key]")];
    if (prefs.view === "list" || opts.length < 2) return 1;
    const top = opts[0].offsetTop;
    const n = opts.findIndex((o) => o.offsetTop !== top);
    return n < 0 ? opts.length : n;
  }
  function onContentKey(e, id) {
    const keys = st.visible.map((x) => x.key);
    const i = Math.max(0, keys.indexOf(st.focusKey));
    const cols = gridColumns();
    const step = { arrowright: prefs.view === "grid" ? 1 : 0, arrowleft: prefs.view === "grid" ? -1 : 0, arrowdown: cols, arrowup: -cols, home: -Infinity, end: Infinity }[e.key.toLowerCase()];
    if (step != null && step !== 0 && !e.altKey) {
      e.preventDefault();
      const n = step === -Infinity ? 0 : step === Infinity ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, i + step));
      const key = keys[n];
      if (e.shiftKey) setSelection(P.rangeSelection(keys, st.anchor || st.focusKey, key), { focus: key });
      else if (e.ctrlKey || e.metaKey) st.focusKey = key;
      else setSelection([key], { anchor: key, focus: key });
      focusOption(key);
      return true;
    }
    if (id === "space" || id === "mod+space") { e.preventDefault(); if (st.focusKey) setSelection(e.ctrlKey || e.metaKey ? P.toggleKey(st.selected, st.focusKey) : [st.focusKey], { anchor: st.focusKey }); return true; }
    if (id === "enter") { e.preventDefault(); const entry = st.byKey.get(st.focusKey); if (entry) Promise.resolve(openEntry(entry)).catch((error) => toast(error.message)); return true; }
    return false;
  }

  function onKey(e) {
    if (renaming || e.defaultPrevented) return;
    const id = keyId(e);
    if (isTypingTarget(e.target)) {
      if (id === "escape" && e.target.id === "px-q" && e.target.value) { e.preventDefault(); e.target.value = ""; st.query = ""; paintContent(); }
      return;
    }
    if (e.target.closest(".ed-menu")) return;
    const li = e.target.closest("[role=treeitem]");
    if (li && onTreeKey(e, li)) return;
    const inContent = !!e.target.closest("[data-px-body]");
    if (inContent && onContentKey(e, id)) return;
    const sel = selection();
    const handlers = {
      "mod+a": () => setSelection(st.visible.map((x) => x.key), { anchor: st.visible[0]?.key }),
      "mod+c": () => toClipboard("copy", sel),
      "mod+x": () => toClipboard("cut", sel),
      "mod+v": () => paste(),
      "mod+d": () => sel.length && duplicate(sel),
      f2: () => sel.length === 1 && startRename(sel[0]),
      delete: () => sel.length && confirmDelete(sel),
      escape: () => { if (st.treeOpen) { closeTree(); q('[data-px="tree"]').focus(); } else setSelection([], { anchor: null }); },
      backspace: () => navHistory(-1),
      "alt+arrowleft": () => navHistory(-1),
      "alt+arrowright": () => navHistory(1),
      "alt+arrowup": () => navigate(P.parentLocation(folders(), loc())),
      "alt+enter": () => showProperties(),
      "shift+f10": () => openMenu(option(st.focusKey) || q("[data-px-body]"), sel),
    };
    const fn = handlers[id];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn()).catch((error) => toast(error.message));
  }

  // ---------- Arrastar e soltar ----------
  function onDragStart(e) {
    const item = e.target.closest?.("[data-px-body] [data-key]");
    if (!item || blocked() || renaming) { if (item) e.preventDefault(); return; }
    const key = item.dataset.key;
    if (!st.selected.includes(key)) setSelection([key], { anchor: key, focus: key });
    drag = selection();
    lastDropReason = "";
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", drag.map((x) => x.name).join(", "));
    root.classList.add("px-dragging");
  }
  function clearDrop() { root.querySelectorAll(".px-drop-ok, .px-drop-no").forEach((el) => el.classList.remove("px-drop-ok", "px-drop-no")); }
  function dropCheck(el) { const target = parseLoc(el.dataset.drop); return { target, check: target ? P.checkTransfer(drag, target, folders()) : { ok: false, reason: "Destino inválido." } }; }
  function onDragOver(e) {
    if (!drag) return;
    const el = e.target.closest("[data-drop]");
    clearDrop();
    if (!el) return;
    const { check } = dropCheck(el);
    el.classList.add(check.ok ? "px-drop-ok" : "px-drop-no");
    if (check.ok) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; lastDropReason = ""; }
    else { e.dataTransfer.dropEffect = "none"; if (check.reason !== lastDropReason && !check.noop) { lastDropReason = check.reason; say(check.reason); } }
  }
  function onDragLeave(e) { const el = e.target.closest?.("[data-drop]"); if (el && !el.contains(e.relatedTarget)) el.classList.remove("px-drop-ok", "px-drop-no"); }
  function onDrop(e) {
    if (!drag) return;
    const el = e.target.closest("[data-drop]");
    clearDrop();
    if (!el) return;
    e.preventDefault();
    const entries = drag; drag = null;
    root.classList.remove("px-dragging");
    const { target, check } = dropCheck(el);
    if (!check.ok) { if (!check.noop) toast(check.reason); return; }
    moveTo(entries, target);
  }
  function onDragEnd() { drag = null; clearDrop(); root?.classList.remove("px-dragging"); }

  function dispose() {
    st.disposed = true;
    observer?.disconnect();
    closeAllMenus(false);
    thumbs.clear();
  }
  // Só depois de todas as declarações acima (constantes não podem ser usadas antes de inicializadas).
  await start();
  return dispose;
}

/** Identificador do atalho no padrão do núcleo ("mod+c", "alt+arrowleft", "f2", "delete", "space"). */
function keyId(e) {
  let key = String(e.key || "");
  if (key === " " || key === "Spacebar") key = "space";
  else if (key === "Del") key = "delete";
  key = key.toLowerCase();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && key.length > 1 && key !== "space") parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/** Lista de pastas em profundidade a partir da árvore de uma categoria. */
function flatten(children, parent = "", depth = 0, out = []) {
  for (const f of children.get(parent) || []) {
    if (out.some((x) => x.id === f.id)) continue;
    out.push({ ...f, depth });
    if (depth < P.MAX_DEPTH) flatten(children, f.id, depth + 1, out);
  }
  return out;
}
