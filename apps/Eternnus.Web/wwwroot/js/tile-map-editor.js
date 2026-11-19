// Editor de mapas de tiles em tela cheia (ADR-081) sobre o núcleo gráfico (`editor-core.js`).
// Documento = camadas (Base com o terreno; Elementos e extras com "_" nas casas vazias). A grade efetiva (regras) é a fusão
// calculada em `tile-map-policy.js`; o servidor refaz a fusão e valida ao salvar. Só o mestre edita.
import { api } from "./api.js";
import { esc, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { createBoard } from "./table-map.js";
import { drawTile } from "./tile-art.js";
import { createEditorShell, openContextMenu, openPropertiesDialog, renderHistoryPanel } from "./editor-core.js";
import { renderOutline } from "./editor-outline.js";
import { addLayer, createHistory, ensureLayers, isRequiredLayer, moveLayer, patchLayer, removeLayer } from "./editor-policy.js";
import * as P from "./tile-map-policy.js";
import { attachDrafts } from "./editor-drafts.js";

const AUTO_PREF = "eternnus.tiles.autoLayer";
const BRUSH_PREF = "eternnus.tiles.brush";
const clone = (value) => JSON.parse(JSON.stringify(value));
const fold = (text) => String(text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const meters = (value) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const TOOL_HINTS = {
  inspect: "Inspecionar: clique numa casa (ou use as setas) para ver as camadas dela em Propriedades.",
  brush: "Pincel: arraste para pintar com o tile escolhido. [ e ] mudam o tamanho. Teclado: setas e Enter.",
  erase: "Borracha: arraste para apagar. [ e ] mudam o tamanho. Na Base, apagar pinta o piso escolhido em Propriedades.",
  fill: "Preenchimento: clique para preencher a área ligada da mesma camada (dentro da seleção, se clicar nela). Áreas grandes pedem confirmação.",
  rect: "Retângulo: arraste de um canto ao outro. Teclado: Enter marca o primeiro canto e Enter de novo conclui.",
  marquee: "Seleção: arraste para selecionar uma área; depois copie, recorte, cole, exclua ou preencha.",
  pick: "Conta-gotas: clique numa casa para capturar o tile visível.",
  hand: "Mão: arraste para mover a vista. Espaço ou botão do meio também movem.",
  zoom: "Zoom: clique para aproximar; Alt + clique afasta. A roda do mouse também ajusta o zoom.",
};

/**
 * Abre o editor. `item`: mapa de tiles existente; `source`: modelo oficial `{ name, rows, scaleMeters, key }` para uma
 * cópia nova; nenhum dos dois: mapa vazio. Resolve quando o editor fecha.
 */
export async function openTileMapEditor(campaign, { item = null, source = null, folderId = "", onSaved = () => {} } = {}) {
  const assets = `/campaigns/${campaign.id}/assets`;
  const [catalog, saved] = await Promise.all([
    api(`${assets}/tile-catalog`), item ? api(`${assets}/tile-maps/${item.id}`) : Promise.resolve(null),
  ]);
  const tiles = catalog.items || [];
  const byCode = new Map(tiles.map((t) => [t.code, t]));
  const groups = [...new Set(tiles.map((t) => t.group))];
  const terrains = tiles.filter((t) => t.group === "Terrenos");

  // ---------- Estado ----------
  let mapId = saved?.id || null, revision = saved?.revision || 0, mapKey = saved?.key || (mapId ? `asset:${mapId}` : "");
  let folder = saved ? saved.folderId ?? null : folderId || null;
  let sourceKey = saved ? saved.sourceKey || null : source?.key || null;
  let doc = loadDocument(saved, source);
  let active = "elements", selected = tiles.some((t) => t.code === ",") ? "," : tiles[0]?.code;
  let ground = P.dominantGround(baseLayer().rows, tiles);
  let auto = (() => { try { return localStorage.getItem(AUTO_PREF) !== "off"; } catch { return true; } })();
  let grid = true, selection = null, clip = null, inspected = null, hover = null, kbCursor = null, kbAnchor = null;
  let pressStart = null, preview = null, pressing = false, cancelStroke = false, lastAlt = false, busy = false, closed = false, fogKey = "";
  // Pincel (tamanho/formato, preferência local), mistura de tiles compatíveis e prévia fantasma de operações extensas.
  let brush = (() => { try { const b = JSON.parse(localStorage.getItem(BRUSH_PREF) || "{}"); return { size: P.BRUSH_SIZES.includes(b.size) ? b.size : 1, shape: b.shape === "round" ? "round" : "square" }; } catch { return { size: 1, shape: "square" }; } })();
  let mix = { on: false, codes: [], seed: 1 }, ghost = null, hoverFoot = null, hoverSig = "";
  let savedSerial = serial();

  function loadDocument(data, from) {
    const fallback = data?.rows || from?.rows || P.blankTiles();
    const layers = P.fitLayerRows(ensureLayers(data?.layers || from?.layers || [{ id: "base", name: "Base", kind: "base", rows: fallback }]), fallback);
    return {
      name: data?.name || (from ? `${String(from.name || "Modelo").slice(0, 112)} — cópia` : ""),
      summary: data?.summary || "",
      scaleMeters: Number(data?.scaleMeters || from?.scaleMeters || 1.5),
      layers: layers.map(({ id, name, kind, visible, locked, opacity, rows }) => ({ id, name, kind, visible, locked, opacity, rows })),
    };
  }
  function serial() { return JSON.stringify(doc); }
  const dirty = () => serial() !== savedSerial;
  function baseLayer() { return doc.layers.find((l) => l.id === "base"); }
  const activeLayer = () => doc.layers.find((l) => l.id === active) || doc.layers[1];
  const layerById = (id) => doc.layers.find((l) => l.id === id);
  const width = () => baseLayer().rows[0].length, height = () => baseLayer().rows.length;
  const tileName = (code) => (code === P.EMPTY ? "vazia" : byCode.get(code)?.name || code);
  const lockedMessage = (layer) => `A camada ${layer.name} está bloqueada. Desbloqueie-a no painel Camadas para editar.`;

  const history = createHistory({
    capture: () => clone(doc),
    restore: (snap) => {
      doc = clone(snap);
      if (!layerById(active)) active = "elements";
      clampToGrid();
      render();
    },
    onChange: () => renderHistory(),
  });

  // ---------- Janela ----------
  const tools = [
    { id: "brush", tip: "Pinta o tile escolhido na paleta. Clique numa casa ou arraste para pintar várias.", label: "Pincel", icon: "brush", key: "b", group: "paint" },
    { id: "erase", tip: "Apaga o tile da camada ativa. Na Base, a casa volta ao piso escolhido em Propriedades.", label: "Borracha", icon: "eraser", key: "e", group: "paint" },
    { id: "fill", tip: "Preenche com o tile escolhido a área contínua de casas iguais à clicada.", label: "Preenchimento", icon: "fill", key: "g", group: "paint" },
    { id: "rect", tip: "Arraste para pintar um retângulo inteiro com o tile escolhido.", label: "Retângulo", icon: "rect", key: "u", group: "paint" },
    { id: "pick", tip: "Clique numa casa para usar o tile dela no pincel.", label: "Conta-gotas (capturar tile)", icon: "pick", key: "i", group: "paint", basic: false },
    { id: "inspect", tip: "Clique numa casa para ver o tile de cada camada e a regra que vale na mesa.", label: "Inspecionar casa", icon: "select", key: "v", group: "select", basic: false },
    { id: "marquee", tip: "Arraste para selecionar uma área; depois copie, recorte, cole ou apague pelo menu Editar.", label: "Seleção de área", icon: "marquee", key: "m", group: "select" },
    { id: "hand", tip: "Arraste para mover a vista. Espaço ou o botão do meio do mouse também movem.", label: "Mão", icon: "hand", key: "h", group: "view" },
    { id: "zoom", tip: "Clique para aproximar; com Alt, afasta. A roda do mouse aproxima no ponto do cursor.", label: "Zoom", icon: "zoom", key: "z", group: "view", basic: false },
    { id: "grid", tip: "Mostra ou esconde as linhas da grade no editor. Não muda o mapa.", label: "Grade", icon: "grid", group: "view", pressed: () => grid, action: () => toggleGrid() },
  ];
  const shell = createEditorShell({
    title: "Editor de mapa de tiles",
    subtitle: doc.name || "Novo mapa",
    help: ["campanhas.mapas.tiles", "Criar mapas com tiles"],
    initialTool: "brush",
    tools,
    onSize: () => sizeDialog(),
    groups: [{ id: "select", label: "Seleção" }, { id: "paint", label: "Pintura" }, { id: "view", label: "Vista" }],
    // Contextos (ADR-086): Terreno pinta a Base; Elementos pinta objetos sobre ela. Mesmas ferramentas; só a camada ativa muda.
    kind: "tiles",
    contexts: [
      { id: "terrain", tip: "Pintar o piso na camada Base: grama, pedra, água, areia.", groups: ["paint", "select"], panels: ["layers", "palette", "props"] },
      { id: "elements", tip: "Pintar objetos na camada Elementos, por cima do terreno: árvores, móveis, paredes.", groups: ["paint", "select"], panels: ["layers", "palette", "props"] },
    ],
    commonTools: ["hand", "zoom", "grid"],
    defaultContext: "elements",
    onContext: (id) => { const target = id === "terrain" ? "base" : "elements"; if (active !== target && layerById(target)) layerAction("select", target); },
    // Barra lateral (ADR-118): Organizar (camadas), Adicionar (paleta de tiles) e Configurar (mapa e pintura).
    // Sem objetos selecionáveis, o editor de tiles não usa o inspetor: a casa inspecionada aparece em Configurar.
    panels: [
      { id: "layers", title: "Camadas", area: "organize", help: ["campanhas.editor.camadas", "Camadas"] },
      { id: "palette", title: "Paleta de tiles", area: "add" },
      { id: "props", title: "Mapa e pintura", area: "configure" },
      { id: "history", title: "Histórico", basic: false, area: "history" },
    ],
    defaultArea: "add",
    actions: `<button type="button" class="subtle small tme-current" data-tme-action="palette" aria-label="Tile escolhido: abrir a paleta"><canvas width="24" height="24" aria-hidden="true" data-tme-current-art></canvas><span data-tme-current-name></span></button><span class="ed-save-state" data-tme-save-state aria-live="polite"></span><button type="button" class="primary small tme-save" data-tme-action="save">Salvar</button>`,
    menus,
    keys: {
      "mod+s": () => save(),
      "mod+z": () => undo(),
      "mod+shift+z": () => redo(),
      "mod+y": () => redo(),
      "mod+c": () => copySelection(),
      "mod+x": () => cutSelection(),
      "mod+v": () => paste(),
      "mod+a": () => selectAll(),
      "mod+d": () => deselect(),
      delete: () => deleteSelection(),
      backspace: () => deleteSelection(),
      escape: () => cancelAction(),
      "[": () => stepBrush(-1),
      "]": () => stepBrush(1),
    },
    isDirty: () => dirty(),
    onTool: (id) => applyTool(id),
    onModeChange: () => applyTool(shell.tool),
    onClose: () => { closed = true; board.destroy(); window.removeEventListener("pointerup", endPress, true); },
  });
  const root = shell.root;
  // Rascunho local e versões (ADR-083): o rascunho guarda o documento; restaurar mantém a revisão de origem.
  const drafts = attachDrafts(shell, {
    campaignId: campaign.id, kind: "tilemap", versionKind: "tilemap",
    docId: () => mapId, label: () => doc.name, revision: () => revision, capture: () => clone(doc), isDirty: () => dirty(),
    restore: (snap, rev) => {
      history.record("Restaurar rascunho");
      doc = clone(snap); if (Number.isInteger(rev)) revision = rev;
      if (!layerById(active)) active = "elements";
      clampToGrid(); render();
    },
    loadVersion: (payload) => {
      history.record("Carregar versão");
      doc = loadDocument(payload, null);
      if (!layerById(active)) active = "elements";
      clampToGrid(); render();
    },
  });

  // Contexto salvo "Terreno" começa na Base (o resto do editor lê `active`).
  if (shell.context === "terrain" && layerById("base")) active = "base";
  // ---------- Palco ----------
  shell.stage.innerHTML = `<div class="board tme-board" aria-describedby="tme-board-help"></div><p class="sr-only" id="tme-board-help">Setas escolhem uma casa; Enter aplica a ferramenta atual; Shift+F10 abre as ações da casa.</p>`;
  const board = createBoard(shell.stage.querySelector(".tme-board"), {
    editor: true,
    onPaint,
    onHover: (cell) => { hover = cell; updateHover(cell); },
    onContext: (at) => cellMenu(at),
    onZoom: () => shell.updateZoom(),
  });
  // Réguas: 0 no canto do mapa; metros pela escala (metros por casa).
  shell.setCamera({ ...board.camera, ruler: () => { const r = board.camera.cellRect({ x: 0, y: 0 }); return r.size > 0 ? { x: r.x, y: r.y, cellPx: r.size, cellUnits: Number(doc.scaleMeters) || 1.5, unit: "m", onScale: () => documentProperties() } : null; } });
  const canvas = shell.stage.querySelector("canvas");
  // Início do arraste (prévia do retângulo/seleção) e Alt do zoom; o tabuleiro entrega a pintura ao soltar.
  shell.stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    lastAlt = e.altKey; cancelStroke = false;
    pressing = shell.tool !== "hand" && !shell.spaceHeld;
    pressStart = ["rect", "marquee"].includes(shell.tool) && !shell.spaceHeld ? board.camera.cellAt(e.clientX, e.clientY) : null;
  }, true);
  // Captura na janela roda antes do tabuleiro entregar a pintura: `pressing` só cai depois desse evento.
  function endPress() {
    setTimeout(() => { pressing = false; }, 0);
    if (!pressStart && !preview) return;
    pressStart = null; preview = null; refreshView();
  }
  window.addEventListener("pointerup", endPress, true);
  // Cursor do teclado: espelha o do tabuleiro (setas a partir do centro) para coordenadas, inspeção e colagem.
  canvas.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    const start = kbCursor || { x: Math.floor(width() / 2), y: Math.floor(height() / 2) };
    kbCursor = { x: Math.min(width() - 1, Math.max(0, start.x + step[0])), y: Math.min(height() - 1, Math.max(0, start.y + step[1])) };
    hover = kbCursor;
    updateHover(kbCursor);
    if (shell.tool === "inspect") inspect(kbCursor, false);
    if (kbAnchor) refreshView();
  });
  canvas.addEventListener("blur", () => { kbCursor = null; });

  // ---------- Painéis ----------
  const palette = shell.panel("palette");
  palette.innerHTML = `<div class="tme-filters">
      <div class="field"><label for="tme-search">Buscar tile</label><input id="tme-search" type="search" data-tme-search autocomplete="off" placeholder="Nome do tile"></div>
      <div class="field"><label for="tme-group">Grupo</label><select id="tme-group" data-tme-group><option value="">Todos os grupos</option>${groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("")}</select></div>
    </div>
    <div class="tme-selected" data-tme-selected aria-live="polite"></div>
    <fieldset class="tme-brush" data-tme-brush>
      <legend>Pincel e borracha${helpButton("campanhas.mapas.pincel", "Tamanho do pincel")}</legend>
      <div class="tme-seg" role="group" aria-label="Tamanho do pincel em casas. Atalhos: [ diminui, ] aumenta.">${P.BRUSH_SIZES.map((n) => `<button type="button" class="subtle small" data-tme-size="${n}" aria-pressed="false" aria-label="${n} × ${n} casas">${n}</button>`).join("")}</div>
      <div class="tme-seg" role="group" aria-label="Formato do pincel">${P.BRUSH_SHAPES.map(([id, label]) => `<button type="button" class="subtle small" data-tme-shape="${id}" aria-pressed="false">${esc(label)}</button>`).join("")}</div>
    </fieldset>
    <fieldset class="tme-mix" data-tme-mix>
      <legend>Mistura de tiles${helpButton("campanhas.mapas.mistura", "Mistura de tiles")}</legend>
      <label class="check"><input type="checkbox" data-tme-mix-on> Pintar com a mistura</label>
      <ul class="tme-mix-list" data-tme-mix-list aria-label="Tiles da mistura"></ul>
      <div class="tme-mix-actions"><button type="button" class="subtle small" data-tme-action="mix-add">Adicionar o tile escolhido</button><button type="button" class="subtle small" data-tme-action="mix-seed">Nova variação</button></div>
      <p class="form-help">Pincel, retângulo, preenchimento e seleção sorteiam entre os tiles da mistura (resultado repetível). Só tiles da mesma camada automática.</p>
    </fieldset>
    <div class="tme-tiles" role="group" aria-label="Tiles do catálogo. Setas percorrem; Enter escolhe.">${groups.map((g) => `<section class="tme-group" data-tme-group-box="${esc(g)}"><h3 class="tme-group-title">${esc(g)}</h3><div class="tme-grid">${tiles.map((t, i) => t.group !== g ? "" : `<button type="button" class="tme-tile" data-tile="${i}" aria-pressed="false" tabindex="-1" aria-label="${esc(t.name)}: ${esc(P.tileRule(t))}"><canvas width="48" height="48" aria-hidden="true"></canvas><span>${esc(t.name)}</span></button>`).join("")}</div></section>`).join("")}</div>
    <p class="muted small" data-tme-empty hidden>Nenhum tile encontrado.</p>`;
  for (const button of palette.querySelectorAll("[data-tile]")) {
    const t = tiles[Number(button.dataset.tile)];
    drawThumb(button.querySelector("canvas"), t, 48);
  }
  palette.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tile]");
    if (b) { selectTile(tiles[Number(b.dataset.tile)].code, true); return; }
    const size = e.target.closest("[data-tme-size]"), shape = e.target.closest("[data-tme-shape]"), drop = e.target.closest("[data-tme-mix-remove]");
    if (size) setBrush({ size: Number(size.dataset.tmeSize) });
    if (shape) setBrush({ shape: shape.dataset.tmeShape });
    if (drop) mixRemove(drop.dataset.tmeMixRemove);
  });
  palette.addEventListener("change", (e) => { if (e.target.matches("[data-tme-mix-on]")) setMix(e.target.checked); });
  palette.addEventListener("input", (e) => { if (e.target.matches("[data-tme-search], [data-tme-group]")) filterPalette(); });
  palette.addEventListener("change", (e) => { if (e.target.matches("[data-tme-group]")) filterPalette(); });
  palette.addEventListener("keydown", (e) => {
    const current = e.target.closest?.("[data-tile]");
    if (!current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const list = [...palette.querySelectorAll("[data-tile]")].filter((b) => !b.hidden && !b.closest("[hidden]"));
    const i = list.indexOf(current);
    let next = null;
    if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list.at(-1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") next = list[i + (e.key === "ArrowRight" ? 1 : -1)];
    else {
      const r = current.getBoundingClientRect(), down = e.key === "ArrowDown";
      const candidates = list.filter((b) => { const o = b.getBoundingClientRect(); return down ? o.top > r.top + 4 : o.top < r.top - 4; });
      next = candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return Math.abs(ra.top - r.top) - Math.abs(rb.top - r.top) || Math.abs(ra.left - r.left) - Math.abs(rb.left - r.left);
      })[0];
    }
    if (!next) return;
    for (const b of list) b.tabIndex = -1;
    next.tabIndex = 0; next.focus();
  });

  const props = shell.panel("props");
  props.innerHTML = `<div data-tme-info></div>
    <label class="check ed-props-check"><input type="checkbox" data-tme-auto> Camada automática</label>
    <p class="form-help">Terrenos vão para a Base; natureza, construções, objetos e entradas vão para Elementos. Com uma camada extra ativa, vale a camada ativa.</p>
    <div class="field"><label for="tme-ground">Piso ao apagar na Base</label><select id="tme-ground" data-tme-ground>${terrains.map((t) => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join("")}</select></div>
    <div class="tme-prop-actions"><button type="button" class="subtle small" data-tme-action="doc-props">Propriedades do mapa…</button><button type="button" class="subtle small" data-tme-action="doc-size">Tamanho do mapa…</button></div>
    <p class="muted small tme-shortcuts">Atalhos do editor${helpButton("campanhas.editor.atalhos", "Atalhos do editor")}</p>`;
  props.addEventListener("change", (e) => {
    if (e.target.matches("[data-tme-auto]")) setAuto(e.target.checked);
    if (e.target.matches("[data-tme-ground]")) { ground = e.target.value; shell.message(`Piso da borracha na Base: ${tileName(ground)}.`); }
  });
  root.addEventListener("click", (e) => {
    const action = e.target.closest("[data-tme-action]")?.dataset.tmeAction;
    if (!action) return;
    if (action === "save") save();
    if (action === "doc-props") documentProperties();
    if (action === "doc-size") sizeDialog();
    if (action === "palette") { shell.setPanels(true); shell.togglePanel("palette", true); palette.querySelector('[data-tile][tabindex="0"]')?.focus(); }
    if (action === "mix-add") mixAdd(selected);
    if (action === "mix-seed") { mix.seed = (mix.seed % 9973) + 1; shell.message(`Nova variação da mistura (semente ${mix.seed}). As próximas pinturas sorteiam de outro jeito.`); }
  });

  // ---------- Desenho ----------
  function displayRows() {
    return P.mergeLayers(doc.layers, { hideBase: baseLayer().visible === false });
  }
  function highlight() {
    if (ghost) return ghost;
    if (preview) return preview;
    if (kbAnchor) return kbCursor ? P.rectCells(P.rectBetween(kbAnchor, kbCursor), width(), height()) : [kbAnchor];
    const marked = selection ? P.rectCells(selection, width(), height()) : [];
    return hoverFoot ? marked.concat(hoverFoot) : marked;
  }
  /** Contorno do pincel sob o cursor (só com pincel/borracha maiores que uma casa e fora de um arraste). */
  function updateFootprint(cell) {
    const show = cell && !pressing && brush.size > 1 && ["brush", "erase"].includes(shell.tool);
    const sig = show ? `${cell.x},${cell.y},${brush.size},${brush.shape}` : "";
    if (sig === hoverSig) return;
    hoverSig = sig;
    hoverFoot = show ? P.brushFootprint(cell, brush.size, brush.shape, width(), height()) : null;
    refreshView();
  }
  function refreshView() { if (!closed) board.setView({ grid, paint: highlight() }); }
  function render() {
    if (closed) return;
    const base = baseLayer();
    board.update({
      map: { kind: "tileset", key: "tile-editor", name: doc.name || "Novo mapa", rows: displayRows(), terrain: base.visible === false ? null : base.rows, scaleMeters: doc.scaleMeters },
      tokens: [], participants: [], session: {}, me: { isMaster: true },
    }, { mode: "paint", grid, paint: highlight() });
    shell.setTitle("Editor de mapa de tiles", doc.name || "Novo mapa");
    renderLayers(); renderInfo(); renderHistory(); syncSaveState();
  }
  /** Camadas na árvore comum (ADR-118). Tiles não são objetos: cada camada é uma linha, sem filhos. */
  function renderLayers() {
    const full = doc.layers.length >= 8;
    renderOutline(shell.panel("layers"), {
      label: "Camadas do mapa, da mais alta para a mais baixa",
      sections: [{ id: "tiles", layers: [...doc.layers].reverse().map((l) => {
        const fixed = isRequiredLayer(l.id);
        return {
          id: l.id, name: l.name, icon: l.id === "base" ? "fill" : "layers", active: l.id === active, fixed,
          visible: l.visible !== false, locked: !!l.locked, opacity: null,
          visibleTip: l.id === "base" ? "Só esconde no editor: o terreno continua nas regras e na mesa." : "Oculta fica fora das regras e da mesa (os jogadores não veem estes tiles).",
          items: [],
        };
      }) }],
      actions: [
        { id: "add-layer", label: "Nova camada", icon: "plus", reason: full ? "Use até 8 camadas." : "", run: () => layerAction("add") },
        { id: "palette", label: "Abrir a paleta de tiles", icon: "brush", run: () => { shell.revealPanel("palette"); palette.querySelector('[data-tile][tabindex="0"]')?.focus(); } },
      ],
      onLayer: (action, id, value) => layerAction(action, id, value),
      layerMenu: (id) => {
        const l = layerById(id), fixed = isRequiredLayer(id), index = doc.layers.findIndex((x) => x.id === id);
        if (!l) return [];
        return [
          { label: "Renomear…", run: () => { const name = prompt("Nome da camada (até 40 caracteres)", l.name); if (name?.trim()) layerAction("rename", id, name.trim().slice(0, 40)); } },
          { label: "Nova camada acima", run: () => { active = id; layerAction("add"); }, disabled: full, disabledReason: "Use até 8 camadas." },
          { label: "Duplicar camada", run: () => layerAction("duplicate", id), disabled: full, disabledReason: "Use até 8 camadas." },
          { label: "Subir camada", run: () => layerAction("up", id), disabled: fixed || index >= doc.layers.length - 1, disabledReason: fixed ? "Base e Elementos são fixas e ficam sempre embaixo." : "Já é a camada mais alta." },
          { label: "Descer camada", run: () => layerAction("down", id), disabled: fixed || index <= 2, disabledReason: fixed ? "Base e Elementos são fixas e ficam sempre embaixo." : "Camadas extras ficam acima de Elementos." },
          { separator: true },
          { label: "Excluir camada", danger: true, run: () => layerAction("delete", id), disabled: fixed, disabledReason: "Base e Elementos são camadas fixas: não podem ser excluídas." },
        ];
      },
    });
  }
  function renderHistory() { if (!closed) renderHistoryPanel(shell.panel("history"), history); }
  function renderInfo() {
    const merged = P.mergeLayers(doc.layers), spawns = P.countSpawns(merged), error = P.tileMapError(merged, tiles);
    const layer = activeLayer();
    let cell = "";
    if (inspected) {
      const stack = P.cellStack(doc.layers, inspected.x, inspected.y), effective = merged[inspected.y]?.[inspected.x];
      cell = `<h3 class="tme-sub">Casa: coluna ${inspected.x + 1}, linha ${inspected.y + 1}</h3>
        <ol class="tme-stack">${stack.map((s) => `<li class="${s.visible || s.base ? "" : "is-hidden"}${s.id === active ? " is-active" : ""}"><span>${esc(s.name)}${s.visible ? "" : " (oculta)"}</span><strong>${esc(tileName(s.code))}</strong>${s.code === P.EMPTY ? "" : `<small>${esc(P.tileRule(byCode.get(s.code)))}</small>`}</li>`).join("")}</ol>
        <p class="small">Nas regras: <strong>${esc(tileName(effective))}</strong> · ${esc(P.tileRule(byCode.get(effective)))}</p>`;
    } else cell = '<p class="muted small">Use Inspecionar casa (V) ou o botão direito numa casa para ver as camadas dela.</p>';
    props.querySelector("[data-tme-info]").innerHTML = `<dl class="tme-info">
        <div><dt>Nome</dt><dd>${esc(doc.name || "Sem nome")}</dd></div>
        <div><dt>Tamanho</dt><dd>${width()} × ${height()} casas</dd></div>
        <div><dt>Escala</dt><dd>${esc(meters(doc.scaleMeters))} m por casa</dd></div>
        <div><dt>Entradas</dt><dd class="${spawns >= P.MIN_SPAWNS ? "" : "tme-warn"}">${spawns}/${P.MIN_SPAWNS} entradas mínimas</dd></div>
        <div><dt>Camada ativa</dt><dd>${esc(layer.name)}${layer.locked ? " (bloqueada)" : ""}</dd></div>
      </dl>${error ? `<p class="form-error">${esc(error)}</p>` : ""}${cell}`;
    props.querySelector("[data-tme-auto]").checked = auto;
    props.querySelector("[data-tme-ground]").value = ground;
  }
  function syncSaveState() {
    if (closed) return;
    const isDirty = dirty();
    const state = root.querySelector("[data-tme-save-state]"), button = root.querySelector('[data-tme-action="save"]');
    state.textContent = busy ? "Salvando…" : isDirty ? "Alterações não salvas" : mapId ? "Salvo" : "Ainda não salvo";
    state.classList.toggle("dirty", isDirty && !busy);
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    shell.setSideHeader({
      name: doc.name || "Novo mapa", kind: `Mapa de tiles · ${width()} × ${height()} casas`,
      chips: [busy ? { text: "Salvando…" } : isDirty ? { text: "Não salvo", tone: "dirty", tip: "Há alterações não salvas. Ctrl+S salva." } : mapId ? { text: "Salvo", tone: "ok" } : { text: "Novo mapa" }],
      menu: () => [
        { label: "Salvar", shortcut: "mod+s", run: () => save(), disabled: busy },
        { label: "Propriedades do mapa…", run: () => documentProperties() },
        { label: "Tamanho do mapa…", run: () => sizeDialog() },
        { separator: true },
        { label: "Restaurar layout padrão", run: () => shell.resetLayout(), hint: "O documento não muda" },
      ],
    });
    shell.setStatus({
      size: `${width()} × ${height()} casas · ${meters(doc.scaleMeters)} m/casa`,
      state: isDirty ? '<span class="ed-chip dirty">Alterações não salvas</span>' : mapId ? '<span class="ed-chip ok">Salvo</span>' : '<span class="ed-chip">Novo mapa</span>',
    });
  }
  function updateHover(cell) {
    updateFootprint(cell);
    if (!cell) { shell.setStatus({ coords: "" }); return; }
    const code = displayRows()[cell.y]?.[cell.x];
    shell.setStatus({ coords: `Coluna ${cell.x + 1}, linha ${cell.y + 1}${code && code !== P.HIDDEN ? ` · ${tileName(code)}` : ""}` });
    if (pressStart && ["rect", "marquee"].includes(shell.tool)) {
      preview = P.rectCells(P.rectBetween(pressStart, cell), width(), height());
      refreshView();
    }
  }
  function drawThumb(target, tile, size) {
    const g = target.getContext("2d");
    g.clearRect(0, 0, size, size);
    if (tile) drawTile(g, [tile.code], 0, 0, size, tile.surface === ",", false, tile.group === "Terrenos" ? null : [tile.surface || "."]);
  }

  // ---------- Paleta ----------
  function selectTile(code, fromPalette = false) {
    if (!byCode.has(code)) return;
    selected = code;
    const tile = byCode.get(code);
    for (const b of palette.querySelectorAll("[data-tile]")) {
      const on = tiles[Number(b.dataset.tile)].code === code;
      b.setAttribute("aria-pressed", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const target = layerById(P.layerForTile(tile, { auto, active, layers: doc.layers }));
    palette.querySelector("[data-tme-selected]").innerHTML = `<canvas width="40" height="40" aria-hidden="true"></canvas><div><strong>${esc(tile.name)}</strong><small>${esc(tile.group)} · ${esc(P.tileRule(tile))}</small><small>Pinta em: ${esc(target?.name || "")}${auto && target?.id !== active ? " (camada automática)" : ""}</small></div>`;
    drawThumb(palette.querySelector("[data-tme-selected] canvas"), tile, 40);
    drawThumb(root.querySelector("[data-tme-current-art]"), tile, 24);
    root.querySelector("[data-tme-current-name]").textContent = tile.name;
    if (fromPalette && ["pick", "erase", "inspect", "zoom", "hand"].includes(shell.tool)) shell.useTool("brush");
  }
  function filterPalette() {
    const term = fold(palette.querySelector("[data-tme-search]").value.trim()), group = palette.querySelector("[data-tme-group]").value;
    let shown = 0;
    for (const b of palette.querySelectorAll("[data-tile]")) {
      const t = tiles[Number(b.dataset.tile)];
      b.hidden = (group && t.group !== group) || (term && !fold(`${t.name} ${t.group}`).includes(term));
      if (!b.hidden) shown++;
    }
    for (const box of palette.querySelectorAll("[data-tme-group-box]")) box.hidden = !box.querySelector("[data-tile]:not([hidden])");
    palette.querySelector("[data-tme-empty]").hidden = shown > 0;
    const focusable = palette.querySelector('[data-tile][tabindex="0"]');
    if (focusable?.hidden) { focusable.tabIndex = -1; const first = palette.querySelector("[data-tile]:not([hidden])"); if (first) first.tabIndex = 0; }
  }

  // ---------- Ferramentas ----------
  function applyTool(id) {
    if (closed) return;
    board.camera.setPan(id === "hand");
    kbAnchor = null; preview = null; pressStart = null;
    root.dataset.tmeTool = id;
    hoverFoot = null; hoverSig = "";
    shell.message(TOOL_HINTS[id] || "");
    refreshView();
  }
  function setBrush(patch) {
    brush = { ...brush, ...patch };
    if (!P.BRUSH_SIZES.includes(brush.size)) brush.size = 1;
    try { localStorage.setItem(BRUSH_PREF, JSON.stringify(brush)); } catch { /* preferência só visual */ }
    renderBrush();
    hoverSig = ""; updateFootprint(hover);
    shell.message(`Pincel e borracha: ${brush.size} × ${brush.size} casas${brush.size > 2 ? `, ${brush.shape === "round" ? "redondo" : "quadrado"}` : ""}.`);
  }
  function stepBrush(delta) {
    const i = P.BRUSH_SIZES.indexOf(brush.size);
    setBrush({ size: P.BRUSH_SIZES[Math.min(P.BRUSH_SIZES.length - 1, Math.max(0, i + delta))] });
  }
  function renderBrush() {
    for (const b of palette.querySelectorAll("[data-tme-size]")) b.setAttribute("aria-pressed", String(Number(b.dataset.tmeSize) === brush.size));
    for (const b of palette.querySelectorAll("[data-tme-shape]")) b.setAttribute("aria-pressed", String(b.dataset.tmeShape === brush.shape));
  }
  /** Tiles da pintura: a mistura ligada (2+ tiles) ou só o tile escolhido. */
  const paintCodes = () => (mix.on && mix.codes.length > 1 ? mix.codes : [selected]);
  function renderMix() {
    const list = palette.querySelector("[data-tme-mix-list]");
    list.innerHTML = mix.codes.length
      ? mix.codes.map((c) => `<li><span>${esc(tileName(c))}</span><button type="button" class="ed-icon-button small" data-tme-mix-remove="${esc(c)}" aria-label="Tirar ${esc(tileName(c))} da mistura">×</button></li>`).join("")
      : '<li class="muted small">Nenhum tile. Escolha um tile e use "Adicionar o tile escolhido".</li>';
    const toggle = palette.querySelector("[data-tme-mix-on]");
    toggle.checked = mix.on;
    toggle.disabled = mix.codes.length < 2;
  }
  function mixAdd(code) {
    const tile = byCode.get(code);
    if (!tile) return;
    if (mix.codes.includes(code)) { shell.message(`${tile.name} já está na mistura.`); return; }
    if (mix.codes.length >= 8) { shell.message("Use até 8 tiles na mistura."); return; }
    if (!P.canMix([...mix.codes.map((c) => byCode.get(c)), tile])) { shell.message(code === "S" ? "Entradas do grupo não entram na mistura." : "Misture só terrenos entre si, ou só elementos (natureza, construções, objetos) entre si."); return; }
    mix.codes = [...mix.codes, code];
    if (mix.codes.length > 1) mix.on = true;
    renderMix();
    shell.message(`${tile.name} entrou na mistura (${mix.codes.length} tiles).`);
  }
  function mixRemove(code) {
    mix.codes = mix.codes.filter((c) => c !== code);
    if (mix.codes.length < 2) mix.on = false;
    renderMix();
  }
  function setMix(on) {
    mix.on = !!on && mix.codes.length > 1;
    renderMix();
    shell.message(mix.on ? `Pintando com a mistura de ${mix.codes.length} tiles.` : "Mistura desligada: pinta só o tile escolhido.");
  }
  /** Mostra a prévia fantasma e pede confirmação com a contagem; a prévia some ao responder. */
  async function confirmLarge(cells, heading, text) {
    ghost = cells; refreshView();
    try {
      return (await chooseDialog({ heading, text, choices: [["ok", "Aplicar", "primary"], ["cancel", "Cancelar", "subtle"]] })) === "ok";
    } finally { ghost = null; refreshView(); }
  }
  /** Seleção que contém a casa (o preenchimento fica dentro dela); fora da seleção, o mapa todo. */
  const boundsFor = (cell) => (selection && cell.x >= selection.x && cell.y >= selection.y && cell.x < selection.x + selection.w && cell.y < selection.y + selection.h ? selection : null);
  function toggleGrid() { grid = !grid; refreshView(); shell.refreshTools(); shell.message(grid ? "Grade visível." : "Grade oculta."); }
  function setAuto(on) {
    auto = !!on;
    try { localStorage.setItem(AUTO_PREF, auto ? "on" : "off"); } catch { /* preferência só visual */ }
    selectTile(selected);
    renderInfo();
    shell.message(auto ? "Camada automática ligada: terrenos na Base, demais tiles em Elementos." : "Camada automática desligada: tudo vai para a camada ativa.");
  }
  function onPaint(cells, end) {
    if (closed || shell.spaceHeld || !cells?.length) return;
    const keyboard = end === undefined;
    if (cancelStroke && !keyboard) { cancelStroke = false; return; }
    const first = cells[0], last = end || cells.at(-1);
    pressStart = null; preview = null;
    switch (shell.tool) {
      case "inspect": inspect(keyboard ? first : last); break;
      case "pick": pick(first); break;
      case "zoom": (lastAlt && !keyboard ? board.camera.zoomOut : board.camera.zoomIn)(); lastAlt = false; shell.updateZoom(); break;
      case "brush": paintRouted(P.strokeCells(cells, brush.size, brush.shape, width(), height()), "brush", brush.size > 1 ? `Pincel ${brush.size}×${brush.size}` : "Pincel"); break;
      case "erase": eraseCells(P.strokeCells(cells, brush.size, brush.shape, width(), height())); break;
      case "fill": paintRouted([first], "fill", "Preenchimento"); break;
      case "rect": case "marquee": {
        let a = first, b = last;
        if (keyboard) {
          if (!kbAnchor) { kbAnchor = first; shell.message("Primeiro canto marcado. Mova até o canto oposto e pressione Enter (Esc cancela)."); refreshView(); return; }
          a = kbAnchor; b = first; kbAnchor = null;
        }
        if (shell.tool === "rect") paintRouted([a, b], "rectangle", "Retângulo");
        else if (!keyboard && a.x === b.x && a.y === b.y && selection) deselect();
        else setSelection(P.rectBetween(a, b));
        break;
      }
      default: break;
    }
    refreshView();
  }
  /** Pinta com o tile escolhido na camada indicada pela camada automática (ou na ativa). */
  async function paintRouted(cells, shape, label) {
    const tile = byCode.get(selected);
    if (!tile || !cells?.length) return;
    const codes = paintCodes();
    const target = layerById(P.layerForTile(byCode.get(codes[0]) || tile, { auto, active, layers: doc.layers }));
    if (target.locked) { shell.message(lockedMessage(target)); return; }
    // Casas atingidas: preenchimento contíguo na própria camada (limitado à seleção que contém o clique) e retângulo inclusivo.
    let area = cells;
    if (shape === "fill") area = P.floodCells(target.rows, cells[0], boundsFor(cells[0]));
    else if (shape === "rectangle") area = P.rectCells(P.rectBetween(cells[0], cells.at(-1)), width(), height());
    const name = codes.length > 1 ? `mistura de ${codes.length} tiles` : tile.name;
    if (shape === "fill" && area.length >= P.LARGE_OPERATION) {
      const ok = await confirmLarge(area, "Preencher uma área grande", `O preenchimento vai pintar ${area.length} casas com ${name} na camada ${target.name}. A área aparece destacada no mapa. Desfazer recupera.`);
      if (!ok || closed) { shell.message("Preenchimento cancelado."); return; }
    }
    const value = codes.length > 1 ? (x, y) => P.variantCode(x, y, codes, mix.seed) : codes[0];
    const rows = P.setCells(target.rows, area, value);
    if (commitRows(target.id, rows, `${label}: ${name} em ${target.name}`)) {
      const notes = [];
      if (target.id !== active) notes.push(`Pintado em ${target.name} (camada automática).`);
      if (target.visible === false && target.id !== "base") notes.push(`A camada ${target.name} está oculta: o resultado não aparece nem entra nas regras.`);
      if (notes.length) shell.message(notes.join(" "));
    }
  }
  function eraseCells(cells) {
    const layer = activeLayer();
    if (auto && isRequiredLayer(active)) {
      const result = P.eraseTopmost(doc.layers, cells, ground);
      if (result.layers !== doc.layers) commit("Borracha", { layers: result.layers });
      if (result.skipped) shell.message(`${result.skipped} casa(s) ficaram como estavam: a camada de cima está bloqueada.`);
      return;
    }
    if (layer.locked) { shell.message(lockedMessage(layer)); return; }
    commitRows(layer.id, P.paintLayer(layer.rows, cells, "", "erase", { base: layer.id === "base", ground }), `Borracha em ${layer.name}`);
  }
  function eraseActive(cells, label) {
    const layer = activeLayer();
    if (layer.locked) { shell.message(lockedMessage(layer)); return false; }
    return commitRows(layer.id, P.paintLayer(layer.rows, cells, "", "erase-rectangle", { base: layer.id === "base", ground }), label || `Apagar em ${layer.name}`);
  }
  function inspect(cell, openPanel = true) {
    if (!cell) return;
    inspected = { x: cell.x, y: cell.y };
    const top = P.topLayerAt(doc.layers, cell.x, cell.y);
    renderInfo();
    if (openPanel) shell.togglePanel("props", true);
    shell.message(`Coluna ${cell.x + 1}, linha ${cell.y + 1}: ${tileName(top.rows[cell.y][cell.x])} (${top.name}).`);
  }
  function pick(cell) {
    const top = P.topLayerAt(doc.layers, cell.x, cell.y), code = top.rows[cell.y][cell.x];
    if (!byCode.has(code)) return;
    selectTile(code);
    shell.useTool("brush");
    shell.message(`Tile capturado: ${tileName(code)} (camada ${top.name}).`);
  }

  // ---------- Histórico e alterações ----------
  /** Registra uma entrada e aplica a mudança; ignora quando nada muda. */
  function commit(label, patch) {
    const next = { ...doc, ...patch };
    if (JSON.stringify(next) === serial()) return false;
    history.record(label);
    doc = next;
    clampToGrid();
    render();
    return true;
  }
  function commitRows(id, rows, label) {
    const layer = layerById(id);
    if (!layer || rows === layer.rows || rows.join("\n") === layer.rows.join("\n")) return false;
    return commit(label, { layers: doc.layers.map((l) => (l.id === id ? { ...l, rows } : l)) });
  }
  function undo() { const label = history.undo(); shell.message(label ? `Desfeito: ${label}.` : "Nada para desfazer."); }
  function redo() { const label = history.redo(); shell.message(label ? `Refeito: ${label}.` : "Nada para refazer."); }
  function clampToGrid() {
    const w = width(), h = height();
    if (selection) {
      const x2 = Math.min(w, selection.x + selection.w), y2 = Math.min(h, selection.y + selection.h);
      selection = selection.x < w && selection.y < h ? { ...selection, w: x2 - selection.x, h: y2 - selection.y } : null;
    }
    if (inspected && (inspected.x >= w || inspected.y >= h)) inspected = null;
    if (kbCursor && (kbCursor.x >= w || kbCursor.y >= h)) kbCursor = null;
    if (kbAnchor && (kbAnchor.x >= w || kbAnchor.y >= h)) kbAnchor = null;
  }
  function cancelAction() {
    if (pressing || pressStart || preview) { cancelStroke = true; pressing = false; pressStart = null; preview = null; shell.message("Ação cancelada: solte o botão sem alterar o mapa."); }
    else if (kbAnchor) { kbAnchor = null; shell.message("Retângulo cancelado."); }
    else if (selection) deselect();
    else if (shell.tool !== "brush") shell.useTool("brush");
    refreshView();
  }

  // ---------- Seleção ----------
  function setSelection(rect) {
    selection = rect;
    shell.message(`Seleção: ${rect.w} × ${rect.h} casas. Ctrl+C copia, Ctrl+X recorta, Delete exclui na camada ${activeLayer().name}.`);
    refreshView();
  }
  function selectAll() { setSelection({ x: 0, y: 0, w: width(), h: height() }); }
  function deselect() { if (!selection) return; selection = null; shell.message("Seleção desfeita."); refreshView(); }
  function needSelection() { if (!selection) shell.message("Selecione uma área com a ferramenta Seleção de área (M) ou Ctrl+A."); return !!selection; }
  function copySelection(quiet = false) {
    if (!needSelection()) return false;
    const layer = activeLayer();
    clip = { rows: P.copyRegion(layer.rows, selection), from: layer.name };
    if (!quiet) shell.message(`Copiado de ${layer.name}: ${selection.w} × ${selection.h} casas.`);
    return true;
  }
  function cutSelection() {
    if (activeLayer().locked) { shell.message(lockedMessage(activeLayer())); return; }
    if (!copySelection(true)) return;
    eraseActive(corners(selection), `Recortar seleção em ${activeLayer().name}`);
    shell.message(`Recortado de ${clip.from}.`);
  }
  function deleteSelection() {
    if (!needSelection()) return;
    if (eraseActive(corners(selection), `Excluir seleção em ${activeLayer().name}`)) shell.message(activeLayer().id === "base" ? `Seleção pintada com ${tileName(ground)} na Base.` : "Seleção apagada.");
  }
  function fillSelection() {
    if (!needSelection()) return;
    paintRouted(corners(selection), "rectangle", "Preencher seleção");
  }
  /**
   * Substituir tile: troca todas as casas de um tile por outro numa camada (inteira ou só na seleção).
   * Camada padrão: a indicada (tile clicado), senão a ativa; a ativa vazia cai na Base (troca de terreno).
   * As casas atingidas ficam destacadas no mapa enquanto a janela está aberta; a contagem acompanha a escolha.
   */
  function replaceDialog(fromCode = null, layerId = null) {
    const emptyLayer = (l) => !l.rows.some((r) => /[^_]/.test(r));
    const start = layerById(layerId) || (emptyLayer(activeLayer()) ? baseLayer() : activeLayer());
    const fromOptions = (l) => P.codeCounts(l.rows).map(([c, n]) => [c, `${c === P.EMPTY ? "Vazia" : tileName(c)} (${n} casa${n === 1 ? "" : "s"})`]);
    const toOptions = (l) => [...(l.id === "base" ? [] : [[P.EMPTY, "Vazia (apagar)"]]), ...tiles.map((t) => [t.code, `${t.name} — ${t.group}`])];
    const firstFrom = (l) => (P.codeCounts(l.rows).some(([c]) => c === fromCode) ? fromCode : P.codeCounts(l.rows).find(([c]) => c !== P.EMPTY)?.[0] || P.EMPTY);
    const from = firstFrom(start);
    const to = selected !== from ? selected : (tiles.find((t) => t.code !== from && (start.id === "base" ? t.group === "Terrenos" : true))?.code || selected);
    const scopes = [["layer", "A camada inteira"], ...(selection ? [["selection", `Só a seleção (${selection.w} × ${selection.h})`]] : [])];
    const read = () => ({ layer: form.elements.namedItem("layer").value, from: form.elements.namedItem("from").value, scope: form.elements.namedItem("scope").value });
    const box = openPropertiesDialog({
      title: "Substituir tile",
      fields: [
        { name: "layer", label: "Camada", type: "select", value: start.id, options: [...doc.layers].reverse().map((l) => [l.id, `${l.name}${l.locked ? " (bloqueada)" : ""}`]) },
        { name: "from", label: "Trocar", type: "select", value: from, options: fromOptions(start) },
        { name: "to", label: "Por", type: "select", value: to, options: toOptions(start) },
        { name: "scope", label: "Onde", type: "select", value: selection ? "selection" : "layer", options: scopes },
        { type: "static", label: "Casas que mudam", value: "" },
      ],
      onApply: (v) => {
        const current = layerById(v.layer);
        if (!current) throw new Error("Escolha uma camada.");
        if (current.locked) throw new Error(lockedMessage(current));
        const base = current.id === "base";
        if (v.from === v.to) throw new Error("Escolha um tile diferente para a troca.");
        if (base && v.to === P.EMPTY) throw new Error("A Base não pode ter casas vazias.");
        const result = P.replaceTiles(current.rows, v.from, v.to, v.scope === "selection" ? selection : null, { base });
        if (!result.count) throw new Error("Nenhuma casa com esse tile na área escolhida.");
        const label = (c) => (c === P.EMPTY ? "vazia" : tileName(c));
        commitRows(current.id, result.rows, `Substituir ${label(v.from)} por ${label(v.to)} em ${current.name} (${result.count} casas)`);
        shell.message(`${result.count} casa(s) trocadas de ${label(v.from)} para ${label(v.to)} em ${current.name}.`);
        queueMicrotask(() => { if (box.element.isConnected) { refill(layerById(v.layer), v.from); sync(); } });
      },
      onClose: () => { ghost = null; refreshView(); },
    });
    const form = box.element.querySelector("form"), out = box.element.querySelector(".ed-props-static strong");
    const fill = (select, options, value) => {
      select.replaceChildren(...options.map(([v, text]) => new Option(text, v)));
      select.value = options.some(([v]) => v === value) ? value : options[0]?.[0] ?? "";
    };
    const refill = (l, keep) => {
      fill(form.elements.namedItem("from"), fromOptions(l), keep);
      const toSelect = form.elements.namedItem("to");
      fill(toSelect, toOptions(l), toSelect.value);
    };
    const sync = () => {
      const v = read(), l = layerById(v.layer);
      ghost = l ? P.matchCells(l.rows, v.from, v.scope === "selection" ? selection : null) : [];
      out.textContent = `${ghost.length} casa${ghost.length === 1 ? "" : "s"} (destacadas no mapa)`;
      refreshView();
    };
    form.addEventListener("change", (e) => {
      if (e.target.name === "layer") { const l = layerById(e.target.value); if (l) refill(l, firstFrom(l)); }
      sync();
    });
    sync();
  }
  function paste(at = null) {
    if (!clip) { shell.message("Nada para colar. Copie uma seleção primeiro."); return; }
    const layer = activeLayer();
    if (layer.locked) { shell.message(lockedMessage(layer)); return; }
    const where = at || kbCursor || hover || (selection ? { x: selection.x, y: selection.y } : { x: 0, y: 0 });
    const rows = P.pasteRegion(layer.rows, clip.rows, where, { base: layer.id === "base" });
    if (commitRows(layer.id, rows, `Colar em ${layer.name}`)) {
      selection = { x: where.x, y: where.y, w: clip.rows[0].length, h: clip.rows.length };
      clampToGrid();
      shell.message(`Colado em ${layer.name}, a partir da coluna ${where.x + 1}, linha ${where.y + 1}.`);
      refreshView();
    }
  }
  const corners = (rect) => [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 }];

  // ---------- Camadas ----------
  function layerAction(action, id, value) {
    const layer = layerById(id);
    const apply = (label, result) => {
      if (result.error) { shell.message(result.error); return false; }
      return commit(label, { layers: result.layers });
    };
    if (action === "select" && layer) { active = id; selectTile(selected); render(); shell.message(`Camada ativa: ${layer.name}.`); return; }
    if (action === "visible" && layer) { commit(`${layer.visible ? "Ocultar" : "Mostrar"} ${layer.name}`, { layers: patchLayer(doc.layers, id, { visible: !layer.visible }) }); return; }
    if (action === "lock" && layer) { commit(`${layer.locked ? "Desbloquear" : "Bloquear"} ${layer.name}`, { layers: patchLayer(doc.layers, id, { locked: !layer.locked }) }); return; }
    if (action === "rename" && layer && value) { commit("Renomear camada", { layers: patchLayer(doc.layers, id, { name: value }) }); return; }
    if (action === "up" || action === "down") { apply(action === "up" ? "Subir camada" : "Descer camada", moveLayer(doc.layers, id, action === "up" ? 1 : -1)); return; }
    if (action === "add") {
      const r = addLayer(doc.layers, "", active, { rows: P.emptyRows(width(), height()) });
      if (r.error) { shell.message(r.error); return; }
      if (apply("Nova camada", r)) { active = r.id; render(); }
      return;
    }
    if (action === "duplicate" && layer) {
      const r = addLayer(doc.layers, `${layer.name} (cópia)`.slice(0, 40), id, { rows: [...layer.rows] });
      if (r.error) { shell.message(r.error); return; }
      if (apply(`Duplicar ${layer.name}`, r)) { active = r.id; render(); }
      return;
    }
    if (action === "delete" && layer) {
      const filled = layer.rows.some((r) => /[^_]/.test(r));
      if (!isRequiredLayer(id) && filled && !confirm(`Excluir a camada ${layer.name} e os tiles dela? Desfazer recupera.`)) return;
      if (apply(`Excluir ${layer.name}`, removeLayer(doc.layers, id)) && active === id) { active = "elements"; render(); }
    }
  }
  function renameActive() {
    const layer = activeLayer();
    const name = prompt("Nome da camada (até 40 caracteres)", layer.name);
    if (name != null && name.trim()) layerAction("rename", layer.id, name.trim().slice(0, 40));
  }

  // ---------- Diálogos ----------
  function documentProperties() {
    openPropertiesDialog({
      title: "Propriedades do mapa",
      fields: [
        { name: "name", label: "Nome", type: "text", value: doc.name, maxlength: 120, required: true },
        { name: "summary", label: "Descrição", type: "textarea", value: doc.summary, maxlength: 500, help: "Até 500 caracteres." },
        { name: "scaleMeters", label: "Escala", unit: "metros por casa", type: "number", min: 0.01, max: 1000, step: 0.01, value: doc.scaleMeters, required: true },
      ],
      onApply: (v) => {
        const name = String(v.name || "").trim().slice(0, 120);
        if (!name) throw new Error("Informe o nome do mapa.");
        if (!P.validScale(v.scaleMeters)) throw new Error("Use de 0,01 a 1.000 metros por casa, com até duas casas decimais.");
        commit("Propriedades do mapa", { name, summary: String(v.summary || "").trim().slice(0, 500), scaleMeters: v.scaleMeters });
      },
    });
  }
  function sizeDialog() {
    const box = openPropertiesDialog({
      title: "Tamanho do mapa",
      fields: [
        { name: "columns", label: "Colunas", type: "number", min: P.MIN_SIDE, max: P.MAX_SIDE, step: 1, value: width(), required: true },
        { name: "rows", label: "Linhas", type: "number", min: P.MIN_SIDE, max: P.MAX_SIDE, step: 1, value: height(), required: true },
        { name: "anchor", label: "Âncora (onde o conteúdo atual fica)", type: "select", value: "tl", options: P.ANCHORS.map(([id, label]) => [id, label]) },
        { name: "ground", label: "Terreno das casas novas", type: "select", value: ground, options: terrains.map((t) => [t.code, t.name]) },
        { type: "static", label: "Novo tamanho", value: `${width()} × ${height()} casas` },
      ],
      onApply: (v) => {
        const w = v.columns, h = v.rows;
        if (![w, h].every((n) => Number.isInteger(n) && n >= P.MIN_SIDE && n <= P.MAX_SIDE)) throw new Error("Use de 8 a 64 casas por lado.");
        if (w === width() && h === height()) return;
        const loss = P.resizeLoss(doc.layers, w, h, v.anchor);
        if (loss.shrinks) {
          const parts = [`Reduzir para ${w} × ${h} casas corta as bordas do terreno`];
          if (loss.cells) parts.push(`remove ${loss.cells} casa(s) com elementos`);
          if (loss.spawns) parts.push(`apaga ${loss.spawns} entrada(s) do grupo`);
          if (!confirm(`${parts.join(", ")}. Desfazer recupera. Continuar?`)) return false;
        }
        commit(`Tamanho do mapa: ${w} × ${h}`, { layers: P.resizeLayers(doc.layers, w, h, v.anchor, v.ground) });
        shell.message(mapId ? `Mapa com ${w} × ${h} casas. Se ele já tiver preparação, salvar pedirá confirmação.` : `Mapa com ${w} × ${h} casas.`);
      },
    });
    const form = box.element.querySelector("form"), out = box.element.querySelector(".ed-props-static strong");
    form.addEventListener("input", () => {
      const w = Number(form.elements.namedItem("columns").value), h = Number(form.elements.namedItem("rows").value);
      out.textContent = `${w || "?"} × ${h || "?"} casas`;
    });
  }
  function cellProperties(cell) {
    const layer = activeLayer(), stack = P.cellStack(doc.layers, cell.x, cell.y);
    const effective = P.mergeLayers(doc.layers)[cell.y][cell.x];
    openPropertiesDialog({
      title: "Propriedades da casa",
      fields: [
        { type: "heading", label: `Coluna ${cell.x + 1}, linha ${cell.y + 1}` },
        ...stack.map((s) => ({ type: "static", label: `${s.name}${s.visible || s.base ? "" : " (oculta)"}`, value: s.code === P.EMPTY ? "vazia" : `${tileName(s.code)} · ${P.tileRule(byCode.get(s.code))}` })),
        { type: "static", label: "Nas regras", value: `${tileName(effective)} · ${P.tileRule(byCode.get(effective))}` },
        {
          name: "code", label: `Tile na camada ${layer.name}`, type: "select", value: layer.rows[cell.y][cell.x], disabled: layer.locked,
          options: [...(layer.id === "base" ? [] : [[P.EMPTY, "Vazia"]]), ...tiles.map((t) => [t.code, `${t.name} — ${t.group}`])],
          help: layer.locked ? "Camada bloqueada: desbloqueie-a no painel Camadas." : "Troca só o tile da camada ativa nesta casa.",
        },
      ],
      onApply: (v) => {
        const current = activeLayer();
        if (current.locked) throw new Error(lockedMessage(current));
        if (current.id === "base" && v.code === P.EMPTY) throw new Error("A Base não pode ter casas vazias.");
        if (v.code !== P.EMPTY && !byCode.has(v.code)) throw new Error("Escolha um tile do catálogo.");
        commitRows(current.id, P.paintTiles(current.rows, [cell], v.code), `Casa ${cell.x + 1}, ${cell.y + 1}: ${tileName(v.code)}`);
        inspected = { x: cell.x, y: cell.y }; renderInfo();
      },
    });
  }
  function shortcutsDialog() {
    const rows = [["Ferramentas", "B pincel · E borracha · G preenchimento · U retângulo · M seleção · I conta-gotas · V inspecionar · H mão · Z zoom"],
      ["Pincel", "[ menor · ] maior (1, 2, 3 ou 5 casas)"],
      ["Desfazer / refazer", "Ctrl+Z · Ctrl+Shift+Z ou Ctrl+Y"], ["Seleção", "Ctrl+A tudo · Ctrl+D desmarcar · Ctrl+C/X/V · Delete"],
      ["Vista", "Roda = zoom · Espaço ou botão do meio = mover · Ctrl+0 ajustar · Ctrl+1 100%"], ["Salvar", "Ctrl+S"], ["Cancelar", "Esc"],
      ["Teclado no mapa", "Setas escolhem a casa · Enter aplica · Shift+F10 ações da casa"]];
    openPropertiesDialog({ title: "Atalhos do editor", live: true, fields: rows.map(([label, value]) => ({ type: "static", label, value })), onApply: () => {} });
  }

  // ---------- Menus ----------
  function cellMenu({ cell, x, y }) {
    const items = [];
    const layer = activeLayer();
    if (cell) {
      const top = P.topLayerAt(doc.layers, cell.x, cell.y), code = top.rows[cell.y][cell.x];
      items.push(
        { label: "Inspecionar casa", hint: `Coluna ${cell.x + 1}, linha ${cell.y + 1}`, run: () => inspect(cell) },
        { label: "Capturar tile", hint: tileName(code), run: () => pick(cell) },
        { label: "Apagar nesta camada", hint: layer.name, disabled: layer.locked, disabledReason: lockedMessage(layer), run: () => eraseActive([cell], `Apagar casa em ${layer.name}`) },
        { label: "Preencher área ligada", hint: tileName(selected), run: () => paintRouted([cell], "fill", "Preenchimento") },
        { label: "Substituir este tile…", hint: `${tileName(code)} em ${top.name}`, disabled: top.locked, disabledReason: lockedMessage(top), run: () => replaceDialog(code, top.id) },
        { label: "Colar aqui", shortcut: "mod+v", disabled: !clip, disabledReason: "Copie uma seleção primeiro.", run: () => paste(cell) },
        { separator: true },
        { label: `Selecionar camada ${top.name}`, disabled: top.id === active, disabledReason: "Esta já é a camada ativa.", run: () => layerAction("select", top.id) },
        { label: "Propriedades da casa…", run: () => cellProperties(cell) },
      );
    }
    if (selection) items.push({ separator: true },
      { label: "Copiar seleção", shortcut: "mod+c", run: () => copySelection() },
      { label: "Recortar seleção", shortcut: "mod+x", run: () => cutSelection() },
      { label: "Excluir seleção", shortcut: "delete", danger: true, run: () => deleteSelection() },
      { label: "Preencher seleção", hint: tileName(selected), run: () => fillSelection() },
      { label: "Substituir tile na seleção…", run: () => { const top = cell ? P.topLayerAt(doc.layers, cell.x, cell.y) : null; replaceDialog(top ? top.rows[cell.y][cell.x] : null, top?.id); } },
      { label: "Desmarcar", shortcut: "mod+d", run: () => deselect() });
    else items.push({ separator: true }, { label: "Selecionar tudo", shortcut: "mod+a", run: () => selectAll() });
    items.push({ separator: true }, { label: "Propriedades do mapa…", run: () => documentProperties() });
    openContextMenu({ x, y }, items, { label: cell ? `Ações da casa ${cell.x + 1}, ${cell.y + 1}` : "Ações do mapa" });
  }
  function menus() {
    const layer = activeLayer(), index = doc.layers.findIndex((l) => l.id === active);
    const noSel = !selection, noSelReason = "Selecione uma área com a ferramenta Seleção de área (M).";
    return [
      { id: "file", label: "Arquivo", items: () => [
        { label: "Salvar", shortcut: "mod+s", disabled: busy, run: () => save() },
        { label: "Salvar cópia", disabled: !mapId || busy, disabledReason: "Salve o mapa antes de criar uma cópia.", run: () => save({ copy: true }) },
        { separator: true },
        { label: "Preparar névoa e luz…", hint: "Paredes, portas, luzes e névoa deste mapa", run: () => prepareFog() },
        { separator: true },
        ...drafts.menuItems(),
        { label: "Fechar", run: () => shell.requestClose() },
      ] },
      { id: "edit", label: "Editar", items: () => [
        { label: "Desfazer", hint: history.undoLabel, shortcut: "mod+z", disabled: !history.canUndo, run: () => undo() },
        { label: "Refazer", hint: history.redoLabel, shortcut: "mod+shift+z", disabled: !history.canRedo, run: () => redo() },
        { separator: true },
        { label: "Copiar seleção", shortcut: "mod+c", disabled: noSel, disabledReason: noSelReason, run: () => copySelection() },
        { label: "Recortar seleção", shortcut: "mod+x", disabled: noSel, disabledReason: noSelReason, run: () => cutSelection() },
        { label: "Colar", shortcut: "mod+v", disabled: !clip, disabledReason: "Copie uma seleção primeiro.", run: () => paste() },
        { label: "Excluir seleção", shortcut: "delete", disabled: noSel, disabledReason: noSelReason, run: () => deleteSelection() },
        { label: "Preencher seleção", hint: tileName(selected), disabled: noSel, disabledReason: noSelReason, run: () => fillSelection() },
        { label: "Substituir tile…", hint: selection ? "Na camada ou só na seleção" : "Troca um tile por outro numa camada", run: () => replaceDialog() },
        { separator: true },
        { label: "Pincel maior", shortcut: "]", disabled: brush.size >= P.BRUSH_SIZES.at(-1), run: () => stepBrush(1) },
        { label: "Pincel menor", shortcut: "[", disabled: brush.size <= 1, run: () => stepBrush(-1) },
        { label: "Pincel redondo", checked: brush.shape === "round", hint: "Vale a partir de 3 casas", run: () => setBrush({ shape: brush.shape === "round" ? "square" : "round" }) },
        { separator: true },
        { label: "Selecionar tudo", shortcut: "mod+a", run: () => selectAll() },
        { label: "Desmarcar", shortcut: "mod+d", disabled: noSel, run: () => deselect() },
      ] },
      { id: "document", label: "Documento", items: () => [
        { label: "Propriedades do mapa…", hint: "Nome, descrição e escala", run: () => documentProperties() },
        { label: "Tamanho do mapa…", hint: `${width()} × ${height()} casas`, run: () => sizeDialog() },
      ] },
      { id: "layer", label: "Camada", items: () => [
        { label: "Nova camada", disabled: doc.layers.length >= 8, disabledReason: "Use até 8 camadas por documento.", run: () => layerAction("add", active) },
        { label: "Duplicar camada", hint: layer.name, disabled: doc.layers.length >= 8, disabledReason: "Use até 8 camadas por documento.", run: () => layerAction("duplicate", active) },
        { label: "Excluir camada", hint: layer.name, danger: true, disabled: isRequiredLayer(active), disabledReason: "Base e Elementos são obrigatórias.", run: () => layerAction("delete", active) },
        { label: "Subir camada", disabled: isRequiredLayer(active) || index >= doc.layers.length - 1, disabledReason: "Reordene só as camadas extras.", run: () => layerAction("up", active) },
        { label: "Descer camada", disabled: isRequiredLayer(active) || index <= 2, disabledReason: "Reordene só as camadas extras.", run: () => layerAction("down", active) },
        { label: "Renomear camada…", hint: layer.name, run: () => renameActive() },
        { separator: true },
        { label: "Camada automática", checked: auto, hint: "Terrenos na Base, demais em Elementos", run: () => setAuto(!auto) },
      ] },
      { id: "view", label: "Exibir", items: () => [
        { label: "Aproximar", shortcut: "mod+plus", run: () => { board.camera.zoomIn(); shell.updateZoom(); } },
        { label: "Afastar", shortcut: "mod+minus", run: () => { board.camera.zoomOut(); shell.updateZoom(); } },
        { label: "Ajustar à tela", shortcut: "mod+0", run: () => { board.camera.fit(); shell.updateZoom(); } },
        { label: "100%", hint: "64 px por casa", shortcut: "mod+1", run: () => { board.camera.actual(64); shell.updateZoom(); } },
        { separator: true },
        { label: "Mostrar grade", checked: grid, run: () => toggleGrid() },
        shell.rulersMenuItem(),
        { label: "Painéis", checked: root.dataset.panels === "open", run: () => shell.setPanels(root.dataset.panels !== "open") },
        { label: "Tela cheia", run: () => root.querySelector('[data-ed="fullscreen"]')?.click() },
        { separator: true },
        { label: "Atalhos do editor…", run: () => shortcutsDialog() },
      ] },
    ];
  }

  // ---------- Salvar ----------
  /** Salva (ou salva cópia). Devolve verdadeiro quando o documento atual ficou gravado. */
  async function save({ copy = false, reset = false } = {}) {
    if (busy || closed) return false;
    if (!doc.name.trim()) { shell.message("Dê um nome ao mapa antes de salvar."); documentProperties(); return false; }
    const merged = P.mergeLayers(doc.layers), error = P.tileMapError(merged, tiles);
    if (error) { shell.message(error); toast(error); shell.togglePanel("props", true); return false; }
    const editing = !!mapId && !copy;
    const name = copy ? `${doc.name.trim().slice(0, 112)} — cópia` : doc.name.trim();
    const layers = doc.layers.map(({ id, name: n, kind, visible, locked, opacity, rows }) => ({ id, name: n, kind, visible, locked, opacity, rows }));
    const body = editing
      ? { name, summary: doc.summary, folderId: folder, scaleMeters: doc.scaleMeters, rows: merged, layers, revision, keepFolder: true, resetPreparation: reset }
      : { name, summary: doc.summary, folderId: folder, scaleMeters: doc.scaleMeters, rows: merged, layers, sourceKey, revision: 0 };
    const sent = serial();
    let result = null, failure = null;
    busy = true; syncSaveState();
    try { result = await api(`${assets}/tile-maps${editing ? `/${mapId}` : ""}`, editing ? "PUT" : "POST", body); }
    catch (e) { failure = e; }
    finally { busy = false; }
    if (closed) return false;
    if (failure) {
      syncSaveState();
      const text = failure.message || "Não foi possível salvar o mapa.";
      if (failure.status === 409 && editing && /prepara|cenas/i.test(text)) return preparationConflict();
      if (failure.status === 409 && editing && /mudou/i.test(text)) return staleConflict(text);
      shell.message(text); toast(text);
      return false;
    }
    mapId = result.id; revision = result.revision; mapKey = result.key || `asset:${result.id}`;
    folder = result.folderId ?? folder;
    if (copy) { doc = { ...doc, name }; savedSerial = serial(); }
    else savedSerial = sent;
    history.markSaved();
    render();
    shell.message(copy ? "Cópia salva. Você está editando a cópia; o original não mudou." : dirty() ? "Mapa salvo. Há alterações feitas durante o salvamento." : "Mapa salvo.");
    try { await onSaved(result); } catch (e) { toast(e?.message || String(e)); }
    return true;
  }
  async function preparationConflict() {
    const choice = await chooseDialog({
      heading: "O terreno deste mapa já tem preparação",
      text: "Este mapa tem névoa, paredes, luzes ou marcas preparadas, ou é usado por cenas. Salvar o novo terreno recria a névoa, as paredes, as luzes e as marcas e remove as posições preparadas e salvas dos marcadores nas cenas que usam este mapa. Textos e fichas são mantidos. Para preservar o original, salve uma cópia.",
      choices: [["reset", "Recriar preparação e salvar", "primary"], ["copy", "Salvar como cópia", ""], ["cancel", "Continuar editando", "subtle"]],
    });
    if (choice === "reset") return save({ reset: true });
    if (choice === "copy") return save({ copy: true });
    shell.message("O mapa não foi salvo. Seu rascunho continua aberto.");
    return false;
  }
  async function staleConflict(text) {
    const choice = await chooseDialog({
      heading: "O mapa mudou em outra janela",
      text: `${text} Recarregar abre a versão salva e guarda este rascunho localmente (Arquivo › Rascunho local…); salvar cópia guarda o rascunho como um mapa novo.`,
      choices: [["reload", "Recarregar a versão salva", "primary"], ["copy", "Salvar como cópia", ""], ["keep", "Continuar editando", "subtle"]],
    });
    if (choice === "copy") return save({ copy: true });
    if (choice !== "reload") { shell.message("Rascunho mantido. Para salvar sobre o mapa, recarregue a versão salva."); return false; }
    await drafts.preserve();
    try {
      const fresh = await api(`${assets}/tile-maps/${mapId}`);
      if (closed) return false;
      doc = loadDocument(fresh, null);
      revision = fresh.revision; folder = fresh.folderId ?? folder; sourceKey = fresh.sourceKey || sourceKey;
      if (!layerById(active)) active = "elements";
      history.clear(); savedSerial = serial(); clampToGrid(); render();
      shell.message("Versão salva recarregada.");
    } catch (e) { shell.message(e.message); toast(e.message); }
    return false;
  }
  async function prepareFog() {
    if (!mapId || dirty()) {
      const choice = await chooseDialog({
        heading: "Salvar antes de preparar",
        text: mapId ? "Há alterações não salvas. A névoa e a luz são preparadas sobre a versão salva do mapa." : "Salve o mapa para preparar paredes, portas, luzes e névoa.",
        choices: [["save", "Salvar e continuar", "primary"], ["cancel", "Cancelar", "subtle"]],
      });
      if (choice !== "save" || !(await save()) || dirty()) return;
    }
    fogKey = mapKey;
    shell.close();
  }

  // ---------- Inicialização ----------
  selectTile(selected);
  filterPalette();
  renderBrush();
  renderMix();
  render();
  applyTool(shell.tool);
  board.interact();
  if (!doc.name) shell.message("Mapa novo: pinte o terreno e dê um nome em Documento › Propriedades do mapa.");

  return shell.whenClosed.then(() => {
    if (!fogKey) return;
    import("./fog-editor.js").then((m) => m.openLayerEditor(campaign, fogKey)).catch((e) => toast(e?.message || String(e)));
  });
}

/**
 * Escolha entre poucas ações (não modal, no estilo da janela de propriedades). O núcleo não tem esse diálogo:
 * implementado aqui. Resolve com o valor do botão ou "cancel" (Esc, fechar, outro diálogo aberto).
 */
function chooseDialog({ heading, text, choices }) {
  return new Promise((resolve) => {
    document.querySelector(".ed-props")?.dispatchEvent(new Event("ed-close"));
    const returnFocus = document.activeElement;
    const box = document.createElement("section");
    const id = `tme-choice-${Date.now()}`;
    box.className = "ed-props tme-choice";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "false");
    box.setAttribute("aria-labelledby", `${id}-h`);
    box.setAttribute("aria-describedby", `${id}-t`);
    box.innerHTML = `<header class="ed-props-head"><h3 id="${id}-h">${esc(heading)}</h3></header><div class="ed-props-form"><p id="${id}-t">${esc(text)}</p><div class="form-actions">${choices.map(([value, label, cls]) => `<button type="button" class="${esc(cls || "")}" data-choice="${esc(value)}">${esc(label)}</button>`).join("")}</div></div>`;
    (document.querySelector("dialog[open]") || document.body).append(box);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      box.remove();
      document.removeEventListener("keydown", onKey, true);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => { if (e.key === "Escape" && box.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); finish("cancel"); } };
    document.addEventListener("keydown", onKey, true);
    box.addEventListener("ed-close", () => finish("cancel"));
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-choice]"); if (b) finish(b.dataset.choice); });
    setTimeout(() => box.querySelector("[data-choice]")?.focus(), 0);
  });
}
