// Editor único de cenas (preparação privada) sobre o núcleo gráfico comum (ADR-081): menus, ferramentas, palco,
// painéis Propriedades/Camadas/Estrutura/Personagens/Histórico e barra de estado.
// Usado na Preparação da campanha, na preparação compartilhada de um mapa (`kind: "layer"`) e sobre a mesa ao vivo,
// sem substituí-la. Escritas por api.js; o servidor valida grade, permissões e conflitos de revisão.
// Nada aqui apresenta a cena aos jogadores: "Aplicar à cena atual" e "Reiniciar cena" são ações explícitas.
import { helpButton, dismissHelp } from "./help.js";
import { api } from "./api.js";
import { esc, button } from "./ui.js";
import { createBoard } from "./table-map.js";
import { FOG_TOOLS, MARK_KINDS, WALL_KINDS, WALL_UNIT, paintLocal, toggleDoorLocal, sharedPreview } from "./fog-policy.js";
import { layerDiff, diffSummary, snapPoint, constrainAngle, hitWall, polylineWalls, addWalls, moveVertex, splitWall, removeVertex, joinCollinear, translateWalls, copyWalls, wallsInBox, patchWalls, cellsToWalls, diagnose, diagnosticLayers } from "./wall-policy.js";
import { interfaceMode, setInterfaceMode } from "./interface-mode.js";
import { createEditorShell, openContextMenu, openPropertiesDialog, renderLayersPanel, renderStructurePanel, renderHistoryPanel, icon } from "./editor-core.js";
import { attachDrafts } from "./editor-drafts.js";
import { addLayer, removeLayer, moveLayer, patchLayer, createHistory, isRequiredLayer, isTypingTarget, MAX_HISTORY } from "./editor-policy.js";
import {
  HELP, SCENE_KINDS, VISIBILITY_OPTIONS, APPLY_PRESERVES, APPLY_TOKENS, TOOL_GROUPS, toolLabel, acceptsMap, hiddenCustomizations,
  placementProblem, simulateView, recentMapKeys, mapTypeLabel, sceneKindLabel, SCENE_SIDES, sceneLayers, tokenLayerOf, layerAlpha,
  clipboardFrom, pastePlacement, moveTokensBy, structureGroups, sameSnapshot,
  BACKGROUND_MODES, defaultGrid, ENTRY_KINDS, entryRect, rectCells, newEntryId, entriesProblem, sceneEntryArea, distributeInArea, compositionSources,
} from "./scene-policy.js";
import { mountImageDrop, listenPaste, splitImageFiles, baseName, readImageSize, assetListHtml, bindAssetList } from "./image-drop.js";
import { MAP_ELEMENT, blankSceneComposition, loadSceneComposition, sceneSourceResolver, flattenPreview, flattenOverlay, createImageCache, createSceneComposer } from "./scene-composition.js";
import * as CP from "./composition-policy.js";

const SIDES = SCENE_SIDES;
const opt = (list, current) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`).join("");
const PAINT = new Set(FOG_TOOLS.map((t) => t.id));
/** Ferramentas que editam a preparação do mapa (paredes, luz, névoa e exploração). */
const LAYER_TOOLS = new Set(["reveal", "conceal", "wall", "blockMove", "blockLight", "door", "toggleDoor", "erase", "light", "mark", "fogState", "resetExploration", "vwall", "vedit", "diagnostic"]);
/** Ferramentas de paredes vetoriais (ADR-087): o tabuleiro entrega o ponto exato do ponteiro. */
const VECTOR_TOOLS = new Set(["vwall", "vedit"]);
/** Painéis que existem também na Básica (os demais voltam ao resumo ao trocar para a Básica). */
const BASIC_PANELS = new Set(["overview", "token", "add", "light", "mark", "hidden", "scenery", "visibility", "text", "notes"]);
const LOCAL_TOOLS = {
  hand: ["Mão (mover a vista)", "Mão: arraste para percorrer o mapa. Espaço ou o botão do meio também movem a vista."],
  zoom: ["Zoom", "Zoom: clique para aproximar; com Alt ou Shift, afasta. A roda do mouse aproxima no cursor."],
  vwall: ["Parede vetorial", "Parede vetorial: clique ponto a ponto, inclusive em diagonal. Enter ou duplo clique termina; Esc desiste. O ímã prende em vértices, paredes e cantos/meios das casas; Shift trava em 45°; Alt desliga o ímã."],
  vedit: ["Editar paredes", "Editar paredes: clique numa parede para selecionar (Shift soma), arraste um vértice ou o segmento, arraste no vazio para selecionar por área. Alt+clique divide o segmento; Delete apaga."],
  diagnostic: ["Diagnóstico de visão", "Diagnóstico de visão: mostra paredes por tipo, casas que bloqueiam movimento (hachura), áreas sem luz (azul) e problemas da geometria (!). Só você vê."],
  addImage: ["Adicionar imagem", "Adicionar imagem: envie uma ou várias imagens do computador. Também dá para arrastar arquivos para o palco ou colar uma imagem com Ctrl+V."],
  entry: ["Área de entrada", "Área de entrada: arraste sobre as casas por onde o grupo chega. Personagens sem posição preparada entram por ela ao apresentar a cena."],
};
const labelOf = (id) => LOCAL_TOOLS[id]?.[0] || toolLabel(id);
const helpOf = (id) => LOCAL_TOOLS[id]?.[1] || HELP[id] || "";
const GROUPS = [{ id: "basic", label: "Ferramentas principais" }, ...TOOL_GROUPS.map(([id, label]) => ({ id, label }))];
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** Tipo próprio do arrastar do painel Personagens (não aceita textos ou arquivos soltos de fora). */
const DND = "application/x-eternnus-scene-character";
const NEED_MAP = "Escolha um mapa com grade para usar esta ferramenta.";
const BASE_ONLY = "A Base é o mapa da cena (somente leitura). Edite o mapa no editor de mapas.";
const LAYER_NOTE = "Visibilidade, bloqueio e opacidade das camadas da cena valem só no editor; para esconder um marcador dos jogadores use “Oculto”";
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Rascunho editável a partir da cena salva (camadas garantidas e camada de cada marcador normalizada). */
function toDraft(s) {
  const layers = sceneLayers(s.layers);
  return {
    name: s.name || "", kind: s.kind, mapKey: s.mapKey || "", sharedText: s.sharedText || "", privateNotes: s.privateNotes || "",
    visionMode: s.visionMode || "", layerMode: s.layerMode || "map", description: s.description || "", order: s.order || 0, layers,
    prepared: (s.prepared || []).map((t) => ({ ...t, layer: tokenLayerOf(t.layer, layers) })),
    // ADR-090: área de entrada da cena ({ref} ou {x,y,w,h}) e composição só desta cena (imagens sobre o mapa).
    entry: s.entry && (s.entry.ref || Number.isInteger(s.entry.x)) ? { ...s.entry } : null,
    composition: loadSceneComposition(s.composition, s.composition?.artboard),
  };
}
/** Campos da cena salvos pelo PUT/POST de cenas (a composição tem endpoint próprio, com a imagem achatada). */
const sceneFields = (d) => ({ ...d, composition: undefined });

/**
 * Abre o editor. `sceneId` nulo cria uma cena (na pasta `folderId`); `mapKey` com `kind: "layer"` edita só a preparação
 * compartilhada do mapa. Devolve `{ id }` quando o editor fecha.
 */
export async function openSceneEditor({ campaign, sceneId = null, mapKey = null, kind = "map", folderId = null, onClose } = {}) {
  const mapOnly = !sceneId && !!mapKey && kind === "layer";
  const base = `/campaigns/${campaign.id}`;
  const [maps, scene, sceneList] = await Promise.all([
    api(`${base}/maps`),
    sceneId ? api(`${base}/scenes/${sceneId}`) : null,
    mapOnly ? null : api(`${base}/scenes`).catch(() => ({ items: [] })),
  ]);
  let draft = scene ? toDraft(scene)
    : toDraft({ kind: kind === "layer" ? "map" : kind, mapKey: mapKey || "", order: sceneList?.items?.length || 0 });
  let saved = { id: scene?.id || null, revision: scene?.revision || 0 };
  let live = scene?.live || null;
  const characters = scene?.characters || sceneList?.characters || [];
  let savedLayerMode = draft.layerMode;
  /** Trocar o alcance só passa a valer depois de salvar: até lá, a camada do mapa não é editada. */
  const layerLocked = () => draft.layerMode !== savedLayerMode;
  let npcs = null, npcLoading = null;
  let layer = null, meta = null;
  // Estado salvo (para recalcular "alterações não salvas" depois de desfazer/refazer).
  let savedScene = clone(draft), savedLayer = null;
  let sceneDirty = false, layerDirty = false, resetExploration = false;
  let tool = "select", selection = [], pick = null, panel = "overview", simulate = false, viewer = "", grid = true, conflict = null, applying = false, busy = false;
  let error = "", closed = false;
  let drafts = null; // rascunho local e versões (ADR-083), ligado depois de carregar a preparação do mapa
  let mode = interfaceMode();
  let activeLayer = "elements", clipboard = [], hover = null, lastCell = null, enterPress = null;
  const mods = { add: false };
  // Paredes vetoriais: traço em andamento, seleção, arraste, tipo do próximo traço e diagnóstico.
  let wallPts = [], wallSel = [], vdrag = null, vpoint = null, wallKind = "wall", wallHidden = false, diag = false;
  // Prévia do jogador calculada pelo servidor (mesmas regras da mesa); nula = recalcular.
  let serverView = null, serverViewError = "", previewTimer = 0, previewSeq = 0;
  let disposePicker = () => {}, disposeGrid = null;
  const recents = recentMapKeys(sceneList?.items || [], "");
  const mapOf = (key) => maps.items.find((m) => m.key === key);
  const mapKind = () => draft.kind === "map";
  const manual = () => draft.visionMode === "manual" || (!draft.visionMode && !!layer?.manual);
  const say = (text) => shell.message(text);

  // ---------- Composição da cena, área de entrada e pontos de entrada (ADR-090) ----------
  // Imagem da campanha usada como fundo: só ela recebe composição (o servidor mescla a sobreposição na entrega à mesa).
  const imageMap = () => { const m = mapOf(draft.mapKey); return m && String(m.key).startsWith("asset:") && !m.isTileMap && m.imageUrl && m.pixelWidth > 0 ? m : null; };
  const composable = () => !mapOnly && draft.kind !== "text" && !!imageMap();
  const composing = () => shell.context === "compose" && composable();
  let composer = null, pendingBlank = null, previewUrl = "", previewTimer2 = 0, previewSeq2 = 0, keepRatio = true, uploading = false;
  let mapEntries = [], savedEntries = [], startChoice = null;
  const imageCache = createImageCache(sceneSourceResolver(campaign.id, () => imageMap()?.imageUrl), () => composer?.invalidate());
  /** Documento editável da composição; enquanto a cena não tem nenhuma, um documento vazio pendente (só entra no rascunho ao mudar). */
  function compDoc() {
    if (draft.composition) return draft.composition;
    const m = imageMap();
    if (!m) return null;
    if (!pendingBlank || pendingBlank.artboard.width !== m.pixelWidth || pendingBlank.artboard.height !== m.pixelHeight) pendingBlank = blankSceneComposition(m.pixelWidth, m.pixelHeight);
    return pendingBlank;
  }
  const compElements = () => draft.composition?.elements?.length || 0;

  // ---------- Ferramentas (Básica primeiro; grupos da Completa depois) ----------
  function toolProblem(id) {
    if ((id === "add" || id === "npc") && !meta) return NEED_MAP;
    if (LAYER_TOOLS.has(id) && !meta) return NEED_MAP;
    if (LAYER_TOOLS.has(id) && layerLocked()) return "Salve o alcance da preparação antes de editar o mapa.";
    if (id === "gridAdjust" && !draft.mapKey?.startsWith("asset:")) return "A grade de cenários prontos já está definida.";
    if (id === "entry" && !meta) return NEED_MAP;
    if (id === "entry" && mapOnly && !meta.entriesEditable) return "Cenários prontos já trazem as entradas do grupo; crie um mapa a partir do modelo para editar.";
    if (id === "addImage" && uploading) return "Aguarde o envio em andamento terminar.";
    return null;
  }
  // Dica da ferramenta: o texto de ajuda dela sem o nome repetido no início ("Nome: o que fazer").
  const tipOf = (id) => { const h = helpOf(id), i = h.indexOf(": "), t = i > 0 && i < 60 ? h.slice(i + 2) : h; return t.charAt(0).toUpperCase() + t.slice(1); };
  const T = (id, iconName, key, group, basic, extra = {}) => ({ id, label: labelOf(id), tip: tipOf(id), icon: iconName, key, group, basic, disabled: () => toolProblem(id), ...extra });
  const panelTool = (id) => ({ action: () => openPanel(id), pressed: () => panel === id });
  const notMap = () => !mapKind();
  const tools = [
    T("select", "select", "v", "basic", true),
    // Composição (ADR-090): enviar imagens é a ação principal de uma cena visual; arrastar e colar também funcionam.
    T("addImage", "image", "u", "basic", true, { context: "compose", hidden: () => mapOnly || draft.kind === "text", action: () => pickImages() }),
    T("add", "plus", "a", "basic", true, { hidden: () => mapOnly || notMap() }),
    T("entry", "marquee", "", "elements", true, { hidden: notMap }),
    T("scenery", "scenery", "c", "basic", true, { hidden: () => mapOnly, ...panelTool("scenery") }),
    T("visibility", "eye", "", "basic", true, { hidden: () => mapOnly || notMap(), ...panelTool("visibility") }),
    T("reveal", "reveal", "r", "basic", true, { hidden: () => notMap() || (mode !== "complete" && !manual()) }),
    T("conceal", "conceal", "k", "basic", true, { hidden: () => notMap() || (mode !== "complete" && !manual()) }),
    T("text", "text", "t", "basic", true, { hidden: () => mapOnly, ...panelTool("text") }),
    T("notes", "notes", "p", "basic", true, { hidden: () => mapOnly, ...panelTool("notes") }),
    T("hand", "hand", "h", "basic", true),
    T("zoom", "zoom", "z", "basic", true),
    T("npc", "character", "n", "elements", false, { hidden: () => mapOnly || notMap() }),
    T("wall", "wall", "w", "walls", false, { hidden: notMap }),
    T("blockMove", "move", "b", "walls", false, { hidden: notMap }),
    T("blockLight", "eyeOff", "i", "walls", false, { hidden: notMap }),
    T("door", "door", "d", "walls", false, { hidden: notMap }),
    T("toggleDoor", "door2", "o", "walls", false, { hidden: notMap }),
    T("erase", "eraser", "e", "walls", false, { hidden: notMap }),
    T("vwall", "wall", "j", "walls", false, { hidden: notMap }),
    T("vedit", "select", "q", "walls", false, { hidden: notMap }),
    T("light", "light", "l", "light", false, { hidden: notMap }),
    T("fogState", "fog", "f", "light", false, { hidden: notMap, ...panelTool("fogState") }),
    T("diagnostic", "eye", "", "light", false, { hidden: notMap, action: () => toggleDiagnostic(), pressed: () => diag }),
    T("mark", "mark", "x", "explore", false, { hidden: notMap }),
    T("resetExploration", "wand", "", "explore", false, { hidden: notMap, ...panelTool("resetExploration") }),
    T("gridToggle", "grid", "g", "grid", false, { hidden: notMap, action: () => { grid = !grid; redraw(); }, pressed: () => grid }),
    T("gridAdjust", "measure", "", "grid", false, { hidden: notMap, ...panelTool("gridAdjust") }),
    T("sceneSettings", "settings", "", "scene", false, { hidden: () => mapOnly, ...panelTool("sceneSettings") }),
  ];
  const titleText = () => (mapOnly ? "Preparação do mapa" : saved.id ? "Editar preparação da cena" : "Nova cena");
  const subtitleText = () => (mapOnly ? `Preparação compartilhada do mapa${meta?.name ? ` · ${meta.name}` : ""}` : draft.name || "Cena sem nome");
  const nameField = mapOnly ? "" : `<div class="se-name-field"><label class="sr-only" for="se-name">Nome da cena</label><input id="se-name" maxlength="80" required autocomplete="off" placeholder="Nome da cena (ex.: Ponte da travessia)">${helpButton("campanhas.cenas.preparacao", "Preparar e apresentar")}</div>`;

  const shell = createEditorShell({
    title: titleText(), subtitle: subtitleText(),
    help: ["campanhas.editor.atalhos", "Atalhos do editor"],
    menus, tools, groups: GROUPS, initialTool: "select",
    // Contextos de trabalho (ADR-086), pelos grupos de TOOL_INVENTORY. Só reorganizam a interface; nada muda na preparação.
    kind: mapOnly ? "map-prep" : "scene",
    contexts: [
      ...(mapOnly ? [] : [{ id: "compose", tools: ["addImage"], panels: ["props", "layers", "assets"], defaultTool: "select" }]),
      { id: "elements", label: mapOnly ? "Elementos" : "Personagens", groups: ["elements"], tools: ["add", "entry"], panels: ["props", "layers", "structure", "characters"], defaultTool: "select" },
      { id: "walls", groups: ["walls"], panels: ["props", "structure"], defaultTool: "wall" },
      { id: "light", groups: ["light"], panels: ["props", "structure"], defaultTool: "light" },
      { id: "explore", groups: ["explore"], tools: ["visibility", "reveal", "conceal"], panels: ["props", "structure"], defaultTool: "select" },
      { id: "scene", groups: ["grid", "scene"], tools: ["scenery", "text", "notes"], panels: ["props"], defaultTool: "select" },
    ],
    commonTools: ["select", "hand", "zoom"],
    panels: [
      { id: "props", title: "Propriedades" },
      ...(mapOnly ? [] : [{ id: "layers", title: "Camadas" }]),
      { id: "structure", title: "Estrutura" },
      ...(mapOnly ? [] : [{ id: "characters", title: "Personagens e posições iniciais", help: ["campanhas.cenas.posicoes", "Posições iniciais e área de entrada"] }]),
      ...(mapOnly ? [] : [{ id: "assets", title: "Acervo", help: ["campanhas.cenas.composicao", "Composição da cena"] }]),
      { id: "history", title: "Histórico", basic: false },
    ],
    onContext: (id) => onWorkContext(id),
    actions: `${nameField}${button(`${icon("eye")}<span>Ver como jogador</span>`, "se-preview", "", "subtle", 'aria-pressed="false" data-tip="Ver como jogador" data-tip-detail="Simula luz, névoa e visão dos personagens, sem alterar a mesa."')}${button("Salvar preparação", "se-save", "", "primary")}<span id="se-apply-slot"></span>`,
    // No contexto Composição os atalhos agem nas imagens; nos demais, nos marcadores (ADR-090).
    keys: {
      "mod+s": () => save(),
      "mod+z": () => undo(), "mod+shift+z": () => redo(), "mod+y": () => redo(),
      "mod+c": () => (composing() ? composer?.copy() : copy()), "mod+x": () => (composing() ? (composer?.cut(), afterCompose()) : cut()),
      "mod+v": () => pasting.request(),
      "mod+j": () => { if (composing()) { composer?.duplicate(); afterCompose(); } },
      "mod+]": () => { if (composing()) { composer?.zorder("front"); afterCompose(); } },
      "mod+[": () => { if (composing()) { composer?.zorder("back"); afterCompose(); } },
      "mod+g": () => { if (composing()) { composer?.group(true); afterCompose(); } },
      "mod+shift+g": () => { if (composing()) { composer?.group(false); afterCompose(); } },
      "mod+a": () => (composing() ? composer?.select((draft.composition?.elements || []).filter((x) => CP.isSelectable(draft.composition, x)).map((x) => x.id), false) : selectAll()),
      "mod+d": () => (composing() ? composer?.select([], false) : deselect()),
      delete: () => (composing() ? (composer?.remove(), afterCompose()) : removeSelection()), backspace: () => (composing() ? (composer?.remove(), afterCompose()) : removeSelection()),
      escape: (e) => onEscape(e),
    },
    contextBar: true,
    contextBarHint: "Selecione uma imagem (Composição) ou paredes (Editar paredes) para ajustar as propriedades aqui.",
    isDirty: () => sceneDirty || layerDirty,
    onTool: (id) => onTool(id),
    onModeChange: (next) => onModeChange(next),
    onClose: () => cleanup(),
  });
  const root = shell.root;
  root.classList.add("scene-editor");
  root.dataset.tool = tool;
  const q = (sel) => root.querySelector(sel);
  shell.stage.innerHTML = `<div class="ed-stage-banner se-sim-banner" id="se-sim" role="note" hidden></div><div class="board se-board" id="se-board"></div><div class="se-compose" id="se-compose" hidden></div><div class="se-start" id="se-start" hidden></div><div class="se-text-preview" id="se-text" hidden></div><p class="se-hint" id="se-hint" role="status" hidden></p><input type="file" id="se-files" accept="image/png,image/jpeg" multiple hidden>`;
  const boardHost = q("#se-board");
  const nameInput = q("#se-name");
  if (nameInput) nameInput.value = draft.name;
  const board = createBoard(boardHost, {
    editor: true,
    onToken: (t) => onToken(t),
    onCell: (c) => onCell(c),
    onPaint: (cells) => onPaint(cells),
    onDrop: (t, c) => onDrop(t, c),
    onCancel: () => deselect(),
    onHover: (p) => onHover(p),
    onContext: (info) => onContext(info),
    onZoom: () => shell.updateZoom(),
    onVector: (e) => onVector(e),
  });
  // 100% = tamanho real da imagem enviada (pixels por casa); mapas de tiles usam 64 px por casa.
  const natural = () => (Number(meta?.gridPixels) >= 8 ? Number(meta.gridPixels) : 64);
  shell.setCamera({
    zoomIn: () => board.camera.zoomIn(), zoomOut: () => board.camera.zoomOut(), fit: () => board.camera.fit(),
    actual: () => board.camera.actual(natural()), zoom: () => board.camera.zoom(natural()),
    setPanHold: (on) => board.camera.setPanHold(on), setPan: (on) => board.camera.setPan(on),
    // Réguas só em mapa tático: 0 no canto do mapa, metros pela escala da grade.
    ruler: () => {
      if (!mapKind() || !meta) return null;
      const r = board.camera.cellRect({ x: 0, y: 0 });
      // A escala muda no ajuste da grade (imagens enviadas); cenários prontos têm grade fixa.
      const locked = toolProblem("gridAdjust");
      return r.size > 0 ? { x: r.x, y: r.y, cellPx: r.size, cellUnits: Number(meta.scaleMeters) || 1.5, unit: "m", onScale: locked ? null : () => openPanel("gridAdjust"), scaleReason: locked || "" } : null;
    },
  });

  // ---------- Histórico (instantâneos do rascunho e da preparação do mapa) ----------
  function capture() { return { draft: clone(draft), layer: clone(layer), reset: resetExploration, entries: clone(mapEntries) }; }
  function restore(snap) {
    draft = clone(snap.draft); layer = clone(snap.layer); resetExploration = !!snap.reset;
    if (Array.isArray(snap.entries)) mapEntries = clone(snap.entries);
    pendingBlank = null; composer?.prune(); composer?.invalidate(); schedulePreview();
    selection = selection.filter((i) => draft.prepared[i]);
    if (!draft.layers.some((l) => l.id === activeLayer)) activeLayer = "elements";
    if (panel === "token" && !selection.length) panel = "overview";
    if (nameInput && nameInput.value !== draft.name) nameInput.value = draft.name;
    recomputeDirty(); renderAll();
  }
  const history = createHistory({ capture, restore, limit: MAX_HISTORY, onChange: () => renderHistory() });
  /** Uma entrada por mudança lógica: só entra no histórico quando o estado mudou de fato. */
  function change(label, fn) {
    commitTyping();
    history.begin(label);
    fn();
    history.commit();
    recomputeDirty();
  }
  // Digitação: o "antes" é capturado na primeira tecla; a entrada fecha ao sair do campo.
  const beginTyping = (label) => { if (!history.pending) history.begin(label); };
  function commitTyping() { if (history.pending) history.commit(); }
  const entriesDirty = () => !!meta?.entriesEditable && !sameSnapshot(mapEntries, savedEntries);
  const compositionDirty = () => !mapOnly && !sameSnapshot(draft.composition, savedScene.composition);
  function recomputeDirty() {
    sceneDirty = !mapOnly && !sameSnapshot(draft, savedScene);
    layerDirty = (!!layer && (!sameSnapshot(layer, savedLayer) || resetExploration)) || entriesDirty();
    if (simulate) { serverView = null; serverViewError = ""; }
    renderStatus();
  }
  /** Contexto trocado (cenário, tipo, alcance, grade): instantâneos antigos não valem para o novo mapa. */
  function resetHistory(reason) { history.clear(); if (reason) say(reason); }
  function undo() { commitTyping(); const label = history.undo(); say(label ? `Desfeito: ${label}.` : "Nada para desfazer."); }
  function redo() { commitTyping(); const label = history.redo(); say(label ? `Refeito: ${label}.` : "Nada para refazer."); }

  // ---------- Dados do mapa ----------
  async function loadLayer() {
    layer = null; meta = null; savedLayer = null; resetExploration = false; mapEntries = []; savedEntries = [];
    const m = mapOf(draft.mapKey);
    if (draft.kind !== "map" || !m || m.kind !== "tileset") return;
    const data = await api(`${base}/assets/layers?key=${encodeURIComponent(draft.mapKey)}${saved.id ? `&scene=${encodeURIComponent(saved.id)}` : ""}`);
    meta = data;
    layer = { fog: data.fog, manual: data.manual, cells: data.cells, lights: data.lights.map((l) => ({ ...l })), revealed: data.revealed, marks: data.marks.map((x) => ({ ...x })), walls: (data.walls || []).map((w) => ({ ...w })) };
    wallSel = []; wallPts = [];
    savedLayer = clone(layer);
    // Pontos de entrada do mapa (reutilizáveis; editados na preparação do mapa) e grade: oculta na movimentação livre.
    mapEntries = (data.entries || []).map((e) => ({ ...e })); savedEntries = clone(mapEntries);
    if (gridKey !== data.key) { grid = !data.freeMovement; gridKey = data.key; }
  }
  let gridKey = "";
  const width = () => meta?.width || 0, height = () => meta?.height || 0;
  // Movimentação livre: marcadores guardam o ponto dentro da casa (fx/fy) e podem dividir a casa.
  const freeOn = () => !!meta?.freeMovement;
  const fineOf = (c) => ({ x: c.x, y: c.y, fx: freeOn() && Number.isInteger(c.fx) ? c.fx : null, fy: freeOn() && Number.isInteger(c.fy) ? c.fy : null });
  const fogOn = () => draft.visionMode === "all" ? false : draft.visionMode ? true : (layer?.fog ?? meta?.settings?.fogEnabled ?? true);
  const shared = () => (manual() ? layer?.revealed || "" : sharedPreview(layer, width(), height()));
  const layerOfToken = (t) => draft.layers.find((l) => l.id === tokenLayerOf(t?.layer, draft.layers));
  const tokenLayers = () => draft.layers.filter((l) => l.id !== "base");
  const activeTokenLayer = () => tokenLayerOf(activeLayer, draft.layers);
  /** Marcadores que podem ser editados agora (camada visível e desbloqueada no editor). */
  const editable = (i) => { const t = draft.prepared[i]; const l = t && layerOfToken(t); return !!t && !l?.locked && l?.visible !== false; };
  const editableSelection = () => selection.filter(editable);

  function boardState() {
    const m = mapOf(draft.mapKey);
    // Com composição, o tabuleiro mostra o mapa já com as imagens da cena (prévia achatada no navegador).
    const shown = previewUrl && compElements() ? previewUrl : null;
    if (draft.kind === "image" && m) return { map: { kind: "cartographic", key: m.key, name: m.name, imageUrl: shown || m.imageUrl || "/assets/valley.webp", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    if (!meta) return { map: { kind: "cartographic", key: "none", name: "", imageUrl: "", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    let tokens = draft.prepared.map((t, i) => {
      // Camadas da cena: olho e opacidade só mudam o desenho no editor; a simulação mostra o que os jogadores veem.
      const alpha = simulate ? 1 : layerAlpha(layerOfToken(t));
      return { id: "p" + i, characterId: t.characterId || null, label: t.label, side: t.side || "ally", x: t.x, y: t.y, fx: t.fx ?? null, fy: t.fy ?? null, hidden: !!t.hidden, light: t.light ?? null, appearance: t.appearance ?? null, size: t.size ?? null, alpha: alpha < 1 ? alpha : null };
    });
    let fog;
    if (simulate && serverView) {
      // Resultado do servidor: idêntico ao que o jogador receberia (paredes, luz, visão, sentidos, percepção e exploração).
      fog = serverView.active ? { active: true, visible: serverView.visible, explored: serverView.explored, cells: serverView.cells, lights: serverView.lights, marks: serverView.marks, walls: serverView.walls } : { active: false };
      const shown = new Set(serverView.shown), perceived = new Set(serverView.perceived || []);
      tokens = tokens.filter((_, i) => shown.has(i)).map((t) => (perceived.has(Number(t.id.slice(1))) ? { ...t, label: "?", perceived: true } : t));
    } else if (simulate) {
      requestServerView();
      const sim = simulateView({ visionMode: draft.visionMode, layer, width: width(), height: height(), tokens, characters, settings: meta.settings || {}, scale: meta.scaleMeters || 1.5, viewer: viewer && viewer !== "party" ? viewer : null });
      fog = sim.fog.active ? sim.fog : { active: false };
      tokens = sim.tokens;
    } else fog = { active: fogOn(), cells: layer.cells, lights: layer.lights, marks: layer.marks, walls: layer.walls, shared: shared() };
    return {
      map: { kind: "tileset", key: meta.layerKey, name: meta.name, rows: meta.rows, imageUrl: shown || meta.imageUrl, gridPixels: meta.gridPixels, gridOffsetX: meta.gridOffsetX, gridOffsetY: meta.gridOffsetY, scaleMeters: meta.scaleMeters, freeMovement: freeOn() },
      tokens, participants: tokens.filter((t) => t.characterId).map((t) => ({ characterId: t.characterId, online: true })), session: {}, me: { isMaster: !simulate, characterId: null }, fog,
    };
  }
  /** Casas destacadas no tabuleiro: a área de entrada efetiva da cena (ou todos os pontos do mapa, na preparação do mapa). */
  function entryHighlight() {
    if (simulate || !meta || !mapKind()) return [];
    const showAll = mapOnly || tool === "entry" || panel === "entries";
    if (showAll) return mapEntries.flatMap((e) => rectCells(e, width(), height()));
    if (shell.context !== "elements" && panel !== "characters") return [];
    return rectCells(sceneEntryArea(draft.entry, mapEntries)?.rect, width(), height());
  }
  function boardView() {
    const paint = !simulate && (PAINT.has(tool) || tool === "entry") && !!meta && (tool === "entry" || !layerLocked());
    const vector = !simulate && VECTOR_TOOLS.has(tool) && !!meta && !layerLocked();
    return {
      mode: paint ? "paint" : vector ? "vector" : "none", fogTools: !simulate && (mode === "complete" || (paint && tool !== "entry") || vector || diag), grid, reach: entryHighlight(), attack: [],
      vector: vector || wallSel.length ? { preview: wallPreview(), selected: wallSel, vertices: tool === "vedit", point: vector ? vpoint : null, box: vdrag?.box || null } : null,
      diagnostic: !simulate && diag && layer ? diagnosticView() : null,
      selected: !simulate && selection.length === 1 ? "p" + selection[0] : null, selectedIds: simulate ? [] : selection.map((i) => "p" + i),
      draggable: !simulate && tool === "select" ? "*" : null, viewAs: simulate,
    };
  }
  const redraw = () => board.update(boardState(), boardView());

  // ---------- Edição no tabuleiro ----------
  function moveToken(i, cell) {
    if (simulate || i == null || !draft.prepared[i]) return false;
    if (!editable(i)) { say("Esse marcador está numa camada oculta ou bloqueada."); return false; }
    const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, cell.x, cell.y, i, freeOn());
    if (problem) { say(problem); return false; }
    change("Mover marcador", () => { draft.prepared[i] = { ...draft.prepared[i], ...fineOf(cell) }; });
    refresh();
    return true;
  }
  function nudge(dx, dy) {
    const ids = editableSelection();
    const result = moveTokensBy(layer?.cells, width(), height(), draft.prepared, ids, dx, dy, freeOn());
    if (result.error) return say(result.error);
    change(ids.length > 1 ? "Mover seleção" : "Mover marcador", () => { draft.prepared = result.tokens; });
    refresh();
    const t = draft.prepared[ids[0]];
    say(`Coluna ${t.x + 1}, linha ${t.y + 1}.`);
  }
  function onDrop(t, c) {
    if (simulate) return false;
    const i = Number(t.id.slice(1));
    if (!editable(i)) { say("Esse marcador está numa camada oculta ou bloqueada. Ajuste em Camadas."); return false; }
    // Arraste de um marcador de uma seleção (com grade): o grupo inteiro anda o mesmo deslocamento.
    if (selection.length > 1 && selection.includes(i) && !freeOn()) {
      const tok = draft.prepared[i];
      const result = moveTokensBy(layer?.cells, width(), height(), draft.prepared, editableSelection(), c.x - tok.x, c.y - tok.y, false);
      if (result.error) { say(result.error); return false; }
      change("Mover seleção", () => { draft.prepared = result.tokens; });
      refresh();
      return true;
    }
    return moveToken(i, c);
  }
  function onToken(t) {
    if (simulate) return;
    lastCell = { x: t.x, y: t.y };
    if (tool === "light" || tool === "mark" || tool === "toggleDoor") return onCell({ x: t.x, y: t.y });
    const i = Number(t.id.slice(1)), tok = draft.prepared[i];
    if (!tok) return;
    const l = layerOfToken(tok);
    if (l?.visible === false) return onCell({ x: t.x, y: t.y }); // invisível no editor: age como a casa
    if (l?.locked) return say(`A camada “${l.name}” está bloqueada. Desbloqueie em Camadas para editar.`);
    if (enterPress) {
      enterPress.used = true;
      if (selection.length === 1 && selection[0] === i) return openTokenProperties(i);
    }
    if (mods.add) selection = selection.includes(i) ? selection.filter((x) => x !== i) : [...selection, i];
    else selection = [i];
    pick = null; panel = selection.length ? "token" : "overview";
    refreshSelection();
  }
  function onCell(c) {
    if (simulate || !meta) return;
    lastCell = c;
    if (enterPress) enterPress.used = true;
    if (tool === "select") {
      if (selection.length === 1 && !mods.add) return moveToken(selection[0], c);
      if (selection.length && !mods.add) { selection = []; panel = "overview"; refreshSelection(); }
      return;
    }
    if (tool === "add" || tool === "npc") { pick = c; selection = []; panel = "add"; renderSide(); showProps(); return focusFirst(); }
    if (tool === "toggleDoor") {
      const next = toggleDoorLocal(layer, c.x, c.y);
      if (!next) return say("Não há porta nessa casa.");
      change("Abrir ou fechar porta", () => { layer = next; });
      return refresh();
    }
    if (tool === "light" || tool === "mark") { pick = c; panel = tool; renderSide(); showProps(); }
  }
  function paintCells(id, cells) {
    if (simulate || !layer || layerLocked()) return;
    if (id === "conceal" && meta?.explored) say("Cobrir área retira só a revelação manual. Casas iluminadas ou vistas por personagens continuam visíveis na mesa.");
    change(`Pintar: ${labelOf(id)}`, () => { layer = paintLocal(layer, width(), id, cells); });
    refresh();
  }
  function onPaint(cells) {
    if (tool === "entry") return setEntryFromCells(cells);
    if (PAINT.has(tool)) paintCells(tool, cells);
  }
  /**
   * Área de entrada desenhada (retângulo das casas pintadas, até 20 × 20). Na cena, vira a área própria da cena;
   * na preparação do mapa, um novo ponto de entrada reutilizável do mapa (sem vínculo com personagens).
   */
  function setEntryFromCells(cells) {
    if (simulate || !meta) return;
    const rect = entryRect(cells);
    if (!rect) return;
    if (mapOnly) {
      if (!meta.entriesEditable) return say(toolProblem("entry"));
      if (mapEntries.length >= 12) return say("Use até 12 pontos de entrada por mapa.");
      const kind = mapEntries.some((e) => e.kind === "party") ? "other" : "party";
      const entry = { id: newEntryId(mapEntries), name: kind === "party" ? "Entrada do grupo" : `Ponto ${mapEntries.length + 1}`, kind, ...rect };
      change("Ponto de entrada", () => { mapEntries = [...mapEntries, entry]; });
      panel = "entries";
      refresh();
      return say(`Ponto de entrada criado (${rect.w} × ${rect.h} casas). Dê um nome e escolha o tipo no painel.`);
    }
    change("Área de entrada da cena", () => { draft.entry = rect; });
    panel = "characters";
    refresh();
    say(`Área de entrada da cena: ${rect.w} × ${rect.h} casas. Personagens sem posição preparada entram por ela.`);
  }
  function onHover(p) {
    hover = p;
    if (p) lastCell = { x: p.x, y: p.y, fx: p.fx, fy: p.fy };
    // Paredes vetoriais mostram o ponto exato (em casas) pelo onVector; aqui só a casa.
    if (VECTOR_TOOLS.has(tool) && p) return;
    shell.setStatus({ coords: p ? `Coluna ${p.x + 1}, linha ${p.y + 1}` : "" });
  }

  // ---------- Paredes vetoriais (ADR-087) ----------
  // Coordenadas do documento (centésimos de casa): o zoom só muda a tolerância do ímã, convertida de pixels de tela.
  const walls = () => layer?.walls || [];
  const tolerance = (e) => Math.max(6, Math.round((12 / Math.max(1, e.pixels || 40)) * WALL_UNIT));
  function snapped(e, anchor = null, ignore = null) {
    let p = { x: e.x, y: e.y };
    if (anchor && e.shiftKey) p = constrainAngle(anchor, p);
    if (e.altKey) return { x: Math.max(0, Math.min(width() * WALL_UNIT, p.x)), y: Math.max(0, Math.min(height() * WALL_UNIT, p.y)), snapped: false };
    return snapPoint(p, walls(), { tolerance: tolerance(e), width: width(), height: height(), ignore, grid: !(anchor && e.shiftKey) });
  }
  function wallPreview() {
    if (tool !== "vwall" || !wallPts.length) return [];
    const pts = vpoint ? [...wallPts, vpoint] : wallPts;
    return pts.slice(1).map((p, i) => ({ x1: pts[i].x, y1: pts[i].y, x2: p.x, y2: p.y }));
  }
  function setWalls(label, next) {
    change(label, () => { layer = { ...layer, walls: next }; });
    wallSel = wallSel.filter((id) => next.some((w) => w.id === id));
    refresh();
  }
  function finishWall() {
    if (wallPts.length < 2) { wallPts = []; return redraw(); }
    const added = polylineWalls(wallPts, wallKind, { hidden: wallHidden });
    const { walls: next, error: problem } = addWalls(walls(), added);
    wallPts = [];
    if (problem) { say(problem); return redraw(); }
    setWalls(added.length > 1 ? `Desenhar ${added.length} paredes` : "Desenhar parede", next);
    say(`${added.length} segmento(s) de ${WALL_KINDS.find((k) => k.id === wallKind)?.label.toLowerCase() || "parede"}. Continue clicando para outra parede.`);
  }
  function onVector(e) {
    if (simulate || !layer || layerLocked()) return;
    if (e.type === "cancel") { vdrag = null; wallPts = []; return redraw(); }
    if (tool === "vwall") {
      const anchor = wallPts[wallPts.length - 1] || null;
      const p = snapped(e, anchor);
      vpoint = p;
      if (e.type === "down") {
        if (anchor && p.x === anchor.x && p.y === anchor.y) return finishWall();
        if (wallPts.length >= 2 && p.x === wallPts[0].x && p.y === wallPts[0].y) { wallPts.push(p); return finishWall(); }
        wallPts.push({ x: p.x, y: p.y });
      } else if (e.type === "dbl") return finishWall();
      shell.setStatus({ coords: `x ${(p.x / WALL_UNIT).toFixed(2)} · y ${(p.y / WALL_UNIT).toFixed(2)} casas${p.snapped ? " · ímã" : ""}` });
      return redraw();
    }
    // Editar paredes.
    if (e.type === "move") { vpoint = hitWall(walls(), e, tolerance(e)) ? { x: e.x, y: e.y, snapped: true } : null; return redraw(); }
    if (e.type === "down") {
      const hit = hitWall(walls(), e, tolerance(e));
      if (hit && e.altKey && hit.part === "segment") {
        setWalls("Dividir parede", splitWall(walls(), hit.id, hit));
        return say("Segmento dividido: arraste o vértice novo.");
      }
      if (!hit) { vdrag = { box: { x1: e.x, y1: e.y, x2: e.x, y2: e.y }, add: e.shiftKey || e.ctrlKey }; return redraw(); }
      if (e.shiftKey || e.ctrlKey) wallSel = wallSel.includes(hit.id) ? wallSel.filter((id) => id !== hit.id) : [...wallSel, hit.id];
      else if (!wallSel.includes(hit.id)) wallSel = [hit.id];
      panel = wallSel.length ? "walls" : "overview";
      const before = clone(layer);
      vdrag = hit.part === "segment" ? { kind: "move", from: { x: e.x, y: e.y }, before, moved: false } : { kind: "vertex", from: { x: hit.x, y: hit.y }, before, moved: false };
      renderSide();
      return redraw();
    }
    if (e.type === "drag" && vdrag) {
      if (vdrag.box) { vdrag.box.x2 = e.x; vdrag.box.y2 = e.y; return redraw(); }
      if (!vdrag.moved) { commitTyping(); history.begin(vdrag.kind === "vertex" ? "Mover vértice" : "Mover paredes"); vdrag.moved = true; }
      const base = vdrag.before.walls || [];
      if (vdrag.kind === "vertex") {
        const ignore = new Set(base.filter((w) => (w.x1 === vdrag.from.x && w.y1 === vdrag.from.y) || (w.x2 === vdrag.from.x && w.y2 === vdrag.from.y)).map((w) => w.id));
        const p = snapped(e, null, ignore);
        layer = { ...layer, walls: moveVertex(base, vdrag.from, p) };
        vpoint = p;
      } else {
        const step = e.altKey ? 1 : WALL_UNIT / 10;
        const dx = Math.round((e.x - vdrag.from.x) / step) * step, dy = Math.round((e.y - vdrag.from.y) / step) * step;
        const moved = translateWalls(base, wallSel, dx, dy, width(), height());
        if (!moved.error) layer = { ...layer, walls: moved.walls };
      }
      return redraw();
    }
    if (e.type === "up" && vdrag) {
      if (vdrag.box) {
        const ids = wallsInBox(walls(), vdrag.box);
        wallSel = vdrag.add ? [...new Set([...wallSel, ...ids])] : ids;
        panel = wallSel.length ? "walls" : "overview";
        vdrag = null;
        say(wallSel.length ? `${wallSel.length} parede(s) selecionada(s).` : "Nenhuma parede inteira dentro da área.");
        return refreshSelection();
      }
      if (vdrag.moved) { history.commit(); recomputeDirty(); }
      vdrag = null;
      return refresh();
    }
  }
  function removeWalls() {
    const n = wallSel.length;
    setWalls(n > 1 ? `Excluir ${n} paredes` : "Excluir parede", walls().filter((w) => !wallSel.includes(w.id)));
    wallSel = []; panel = "overview";
    refresh();
  }
  function wallAction(action) {
    const sel = wallSel;
    if (action === "kind-draw") return;
    if (!sel.length && !["convert", "join-all"].includes(action)) return say("Selecione paredes com a ferramenta Editar paredes.");
    if (action === "delete") return removeWalls();
    if (action === "duplicate") {
      const copies = copyWalls(walls(), sel, WALL_UNIT / 2, WALL_UNIT / 2).map((w) => ({ ...w, x1: Math.min(w.x1, width() * WALL_UNIT), x2: Math.min(w.x2, width() * WALL_UNIT), y1: Math.min(w.y1, height() * WALL_UNIT), y2: Math.min(w.y2, height() * WALL_UNIT) }));
      const { walls: next, error: problem } = addWalls(walls(), copies);
      if (problem) return say(problem);
      setWalls("Duplicar paredes", next);
      wallSel = copies.map((w) => w.id);
      return refreshSelection();
    }
    if (action === "split") {
      const w = walls().find((x) => x.id === sel[0]);
      return setWalls("Dividir parede", splitWall(walls(), w.id, { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 }));
    }
    if (action === "join" || action === "join-all") {
      const before = walls().length, next = joinCollinear(walls(), action === "join" ? sel : null);
      if (next.length === before) return say("Nada para unir: os segmentos precisam ser do mesmo tipo, na mesma reta e ligados pela ponta.");
      setWalls("Unir paredes", next);
      return say(`${before - next.length} junção(ões) feita(s).`);
    }
    if (action === "vertex") {
      const w = walls().find((x) => x.id === sel[0]);
      const r = removeVertex(walls(), { x: w.x2, y: w.y2 });
      if (r.error) return say(r.error);
      return setWalls("Remover vértice", r.walls);
    }
    if (action === "convert") {
      const converted = cellsToWalls(layer.cells, width(), height());
      if (!converted.length) return say("Não há casas de parede, de bloqueio de luz ou de movimento para converter.");
      const { walls: next, error: problem } = addWalls(walls(), converted);
      if (problem) return say(problem);
      setWalls("Converter casas em paredes vetoriais", next);
      return say(`${converted.length} segmento(s) criados a partir das casas. As casas continuam marcadas; use “Liberar casa” se quiser só a parede vetorial.`);
    }
  }
  function wallPanel() {
    const sel = walls().filter((w) => wallSel.includes(w.id));
    const kinds = WALL_KINDS.map((k) => [k.id, k.label]);
    const drawing = `<fieldset><legend>Próximo traço</legend><div class="field"><label for="se-w-kind">Tipo</label><select id="se-w-kind" data-wall-draw="kind">${opt(kinds, wallKind)}</select><p class="form-help">${esc(WALL_KINDS.find((k) => k.id === wallKind)?.help || "")}</p></div><label class="check"><input type="checkbox" data-wall-draw="hidden" ${wallHidden ? "checked" : ""}> Não mostrar aos jogadores (porta secreta, barreira invisível)</label></fieldset>`;
    const help = `<p class="form-help">${esc(helpOf(tool === "vedit" ? "vedit" : "vwall"))}</p>`;
    const common = `<div class="form-actions">${button("Converter casas em paredes", "se-wall", "convert", "subtle")}${button("Unir todas as colineares", "se-wall", "join-all", "subtle")}</div><p class="form-help">${walls().length} segmento(s) neste mapa. As casas pintadas continuam valendo junto com as paredes vetoriais.</p>`;
    if (!sel.length) return `<div class="se-panel"><h3>${esc(labelOf(tool === "vedit" ? "vedit" : "vwall"))}${helpButton("mesa.nevoa.paredes", "Paredes vetoriais")}</h3>${help}${drawing}${common}</div>`;
    const kind = sel.every((w) => w.kind === sel[0].kind) ? sel[0].kind : "";
    const doors = sel.filter((w) => w.kind === "door");
    const one = sel.length === 1 ? sel[0] : null;
    const c = (v) => (v / WALL_UNIT).toFixed(2);
    const coords = one ? `<fieldset><legend>Pontas (em casas)</legend><div class="se-wall-coords">${[["x1", "Início x"], ["y1", "Início y"], ["x2", "Fim x"], ["y2", "Fim y"]].map(([k, l]) => `<label><span>${l}</span><input type="number" step="0.01" min="0" max="${k[0] === "x" ? width() : height()}" data-wall-coord="${k}" value="${c(one[k])}"></label>`).join("")}</div><p class="form-help">Comprimento: ${(Math.hypot(one.x2 - one.x1, one.y2 - one.y1) / WALL_UNIT).toFixed(2)} casas (${((Math.hypot(one.x2 - one.x1, one.y2 - one.y1) / WALL_UNIT) * (Number(meta?.scaleMeters) || 1.5)).toFixed(1)} m).</p></fieldset>` : "";
    return `<div class="se-panel"><h3>${sel.length === 1 ? esc(WALL_KINDS.find((k) => k.id === one.kind)?.label || "Parede") : `${sel.length} paredes selecionadas`}${helpButton("mesa.nevoa.paredes", "Paredes vetoriais")}</h3>
      <div class="field"><label for="se-w-sel-kind">Tipo</label><select id="se-w-sel-kind" data-wall-patch="kind">${kind ? "" : '<option value="">Tipos diferentes</option>'}${opt(kinds, kind)}</select></div>
      <label class="check"><input type="checkbox" data-wall-patch="hidden" ${sel.every((w) => w.hidden) ? "checked" : ""}> Não mostrar aos jogadores</label>
      ${doors.length ? `<label class="check"><input type="checkbox" data-wall-patch="open" ${doors.every((w) => w.open) ? "checked" : ""}> Porta começa aberta</label>` : ""}
      ${coords}
      <div class="form-actions">${one ? button("Dividir no meio", "se-wall", "split", "subtle") : ""}${one ? button("Remover vértice final", "se-wall", "vertex", "subtle") : ""}${sel.length > 1 ? button("Unir", "se-wall", "join", "subtle") : ""}${button("Duplicar", "se-wall", "duplicate", "subtle")}${button("Excluir", "se-wall", "delete", "text-button")}</div>${common}</div>`;
  }
  /** Barra contextual (ADR-086) para paredes selecionadas: tipo, visibilidade, porta aberta e ações rápidas, sem modal. */
  function syncWallBar() {
    const bar = shell.contextBar;
    if (!bar) return;
    const sel = walls().filter((w) => wallSel.includes(w.id));
    if (!sel.length || simulate) return bar.hide();
    const kind = sel.every((w) => w.kind === sel[0].kind) ? sel[0].kind : "";
    const doors = sel.some((w) => w.kind === "door");
    bar.show({
      key: "walls:" + wallSel.join(","), title: sel.length === 1 ? "Parede" : `${sel.length} paredes`, icon: "wall",
      fields: [
        { name: "kind", label: "Tipo", type: "select", value: kind, options: [...(kind ? [] : [["", "Tipos diferentes"]]), ...WALL_KINDS.map((k) => [k.id, k.label])] },
        { name: "hidden", label: "Oculta dos jogadores", type: "checkbox", value: sel.every((w) => w.hidden) },
        ...(doors ? [{ name: "open", label: "Porta aberta", type: "checkbox", value: sel.filter((w) => w.kind === "door").every((w) => w.open) }] : []),
      ],
      actions: [...(sel.length === 1 ? [{ id: "split", label: "Dividir", icon: "plus" }] : [{ id: "join", label: "Unir" }]), { id: "duplicate", label: "Duplicar", icon: "copy" }, { id: "delete", label: "Excluir", icon: "trash", danger: true }],
      onChange: (name, value) => {
        if (name === "kind" && !value) return;
        setWalls(name === "kind" ? "Mudar tipo da parede" : name === "open" ? "Porta aberta/fechada" : "Visibilidade da parede", patchWalls(walls(), wallSel, { [name]: value }));
      },
      onAction: (id) => wallAction(id),
    });
  }
  function onWallInput(t) {
    if (t.dataset.wallDraw === "kind") { wallKind = t.value; return renderSide(); }
    if (t.dataset.wallDraw === "hidden") { wallHidden = t.checked; return; }
    if (t.dataset.wallPatch) {
      const key = t.dataset.wallPatch;
      if (key === "kind" && !t.value) return;
      const patch = key === "kind" ? { kind: t.value } : { [key]: t.checked };
      return setWalls(key === "kind" ? "Mudar tipo da parede" : key === "open" ? "Porta aberta/fechada" : "Visibilidade da parede", patchWalls(walls(), wallSel, patch));
    }
    if (t.dataset.wallCoord) {
      const one = walls().find((w) => w.id === wallSel[0]);
      const k = t.dataset.wallCoord, max = (k[0] === "x" ? width() : height()) * WALL_UNIT;
      const v = Math.round(Number(t.value) * WALL_UNIT);
      if (!Number.isFinite(v) || v < 0 || v > max) return say("A ponta precisa ficar dentro do mapa.");
      const next = { ...one, [k]: v };
      if (next.x1 === next.x2 && next.y1 === next.y2) return say("As duas pontas não podem coincidir.");
      return setWalls("Ajustar ponta da parede", walls().map((w) => (w.id === one.id ? next : w)));
    }
  }
  // ---------- Diagnóstico de visão (só no editor) ----------
  function toggleDiagnostic() {
    if (!meta || !mapKind()) return say(NEED_MAP);
    diag = !diag;
    if (diag) panel = "diagnostic"; else if (panel === "diagnostic") panel = "overview";
    refresh();
    say(diag ? "Diagnóstico ligado: só você vê." : "Diagnóstico desligado.");
  }
  let diagCache = null;
  function diagnosticView() {
    const key = layer;
    if (diagCache?.key === key && diagCache.tokens === draft.prepared) return diagCache.value;
    const value = { ...diagnosticLayers(layer, width(), height()), issues: diagnose({ cells: layer.cells, walls: walls(), lights: layer.lights, tokens: draft.prepared }, width(), height()) };
    diagCache = { key, tokens: draft.prepared, value };
    return value;
  }
  function diagnosticPanel() {
    const d = diagnosticView();
    const counts = WALL_KINDS.map((k) => [k.label, walls().filter((w) => w.kind === k.id).length]).filter(([, n]) => n);
    const doors = walls().filter((w) => w.kind === "door");
    return `<div class="se-panel"><h3>Diagnóstico de visão${helpButton("mesa.nevoa.diagnostico", "Diagnóstico de visão")}</h3><p class="form-help">${esc(helpOf("diagnostic"))}</p>
      <ul class="se-diag-legend"><li><i class="lg-diag-dark" aria-hidden="true"></i>Sem luz para o grupo: ${d.total - d.lit} de ${d.total} casas</li><li><i class="lg-diag-block" aria-hidden="true"></i>Hachura: casa que bloqueia movimento</li><li>Traço contínuo: parede · tracejado: janela/só visão · pontilhado: só movimento</li><li>Portas: ${doors.filter((w) => !w.open).length} fechada(s), ${doors.filter((w) => w.open).length} aberta(s)</li><li>Focos de luz: ${layer.lights.length}</li>${counts.map(([l, n]) => `<li>${esc(l)}: ${n}</li>`).join("")}</ul>
      <h4>Problemas encontrados (${d.issues.length})</h4>${d.issues.length ? `<ol class="se-diag-issues">${d.issues.map((i) => `<li><strong>!</strong> ${esc(i.message)} <small>(coluna ${Math.floor(i.x / WALL_UNIT) + 1}, linha ${Math.floor(i.y / WALL_UNIT) + 1})</small></li>`).join("")}</ol>` : '<p class="small">Nenhum problema de geometria encontrado.</p>'}
      <p class="form-help">A visão exata de cada jogador fica em “Ver como jogador”, calculada pelo servidor com as regras da mesa.</p></div>`;
  }
  // ---------- Prévia real do jogador (servidor) ----------
  function requestServerView() {
    if (!simulate || !meta || !mapKind()) return;
    clearTimeout(previewTimer);
    const seq = ++previewSeq;
    previewTimer = setTimeout(async () => {
      const body = {
        mapKey: draft.mapKey, sceneId: saved.id || null, visionMode: mapKind() ? draft.visionMode || null : null,
        tokens: sceneBody().prepared,
        layer: { fog: layer.fog, cells: layer.cells, revealed: layer.revealed, revision: meta.revision,
          lights: layer.lights.map((l) => ({ x: l.x, y: l.y, radius: l.radius, dim: l.dim ?? null, color: l.color ?? null, intensity: l.intensity ?? null, animation: l.animation ?? null })),
          marks: layer.marks.map((m) => ({ id: m.id || null, x: m.x, y: m.y, kind: m.kind, label: m.label, dc: m.dc ?? null, sense: m.sense || null, maxDistance: m.maxDistance ?? null })),
          walls: walls().map((w) => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind, open: !!w.open, hidden: !!w.hidden })) },
        viewerCharacterId: viewer && viewer !== "party" ? viewer : null, party: viewer === "party",
      };
      try {
        const result = await api(`${base}/prep/preview-view`, "POST", body, { background: true });
        if (seq !== previewSeq || !simulate) return;
        serverView = result; serverViewError = "";
      } catch (err) {
        if (seq !== previewSeq || !simulate) return;
        serverViewError = err.message || "erro desconhecido.";
      }
      renderSimBanner();
      redraw();
    }, 250);
  }

  // ---------- Seleção, área de transferência e camadas ----------
  function placeToken(token, cell, label) {
    if (simulate || mapOnly || !mapKind() || !meta) { say("Personagens e marcadores entram em cenas de mapa tático."); return false; }
    const target = draft.layers.find((l) => l.id === activeTokenLayer());
    if (target?.locked) { say(`A camada “${target.name}” está bloqueada. Escolha outra em Camadas.`); return false; }
    // Personagem já posicionado: arrastar de novo move o marcador existente (nunca cria duplicata).
    const existing = token.characterId ? draft.prepared.findIndex((t) => t.characterId === token.characterId) : -1;
    if (existing >= 0) { selection = [existing]; panel = "token"; return moveToken(existing, cell); }
    const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, cell.x, cell.y, -1, freeOn());
    if (problem) { say(problem); return false; }
    change(label, () => { draft.prepared.push({ ...token, ...fineOf(cell), hidden: !!token.hidden, layer: activeTokenLayer() }); });
    selection = [draft.prepared.length - 1]; panel = "token"; pick = null;
    refresh();
    return true;
  }
  function placeRef(ref, cell) {
    const [type, id] = String(ref).split(":");
    if (type === "pc") {
      const c = characters.find((x) => x.id === id);
      return c ? placeToken({ characterId: c.id, label: c.name, side: "ally", hidden: false }, cell, "Colocar personagem") : false;
    }
    const n = (npcs || []).find((x) => x.id === id);
    return n ? placeToken({ masterCharacterId: n.id, label: n.name.slice(0, 40), side: n.side || "enemy", hidden: false }, cell, "Colocar personagem do mestre") : false;
  }
  function placeAtCursor(ref) {
    const cell = hover || lastCell;
    if (!cell) return say("Escolha uma casa no mapa (clique ou setas e Enter) e tente de novo.");
    placeRef(ref, cell);
  }
  function removeIndices(ids, label) {
    if (!ids.length) return;
    change(label, () => { draft.prepared = draft.prepared.filter((_, i) => !ids.includes(i)); });
    selection = []; if (panel === "token") panel = "overview";
    refresh();
  }
  function removeSelection() {
    if (simulate) return;
    if (wallSel.length) return removeWalls();
    const ids = editableSelection();
    if (!ids.length) return say("Selecione um marcador para excluir.");
    removeIndices(ids, ids.length > 1 ? `Excluir ${ids.length} marcadores` : "Excluir marcador");
  }
  function copy() {
    const ids = editableSelection();
    if (!ids.length) return say("Selecione um marcador para copiar.");
    const own = ids.filter((i) => !draft.prepared[i].characterId);
    if (!own.length) return say("Personagens dos jogadores aparecem uma vez por cena; use Recortar para movê-los.");
    clipboard = clipboardFrom(draft.prepared, own);
    say(own.length < ids.length ? `${own.length} copiado(s). Personagens dos jogadores não são copiados.` : own.length === 1 ? "Marcador copiado." : `${own.length} marcadores copiados.`);
    shell.refreshMenus();
  }
  function cut() {
    if (simulate) return;
    const ids = editableSelection();
    if (!ids.length) return say("Selecione um marcador para recortar.");
    clipboard = clipboardFrom(draft.prepared, ids);
    removeIndices(ids, "Recortar");
    say("Recortado. Use Colar (Ctrl+V) na casa de destino.");
  }
  function insertPlaced(placed, skipped, label) {
    if (!placed.length) return say(skipped ? "Não há casa livre (ou o personagem já está na cena)." : "Nada para colar.");
    const start = draft.prepared.length;
    change(label, () => { draft.prepared.push(...placed); });
    selection = placed.map((_, k) => start + k); panel = "token";
    refresh();
    say(skipped ? `${placed.length} colocado(s); ${skipped} ficaram de fora (sem casa livre ou personagem já na cena).` : `${label}: ${placed.length} marcador(es).`);
  }
  function paste(at = null) {
    if (simulate) return;
    if (!clipboard.length) return say("Nada para colar. Copie ou recorte um marcador antes.");
    if (mapOnly || !mapKind() || !meta) return say("Cole marcadores num mapa tático.");
    const target = draft.layers.find((l) => l.id === activeTokenLayer());
    if (target?.locked) return say(`A camada “${target.name}” está bloqueada. Escolha outra em Camadas.`);
    const anchor = at || hover || lastCell || { x: 0, y: 0 };
    const { placed, skipped } = pastePlacement({ cells: layer?.cells, width: width(), height: height(), tokens: draft.prepared, items: clipboard, anchor, free: freeOn() });
    insertPlaced(placed.map((t) => ({ ...t, layer: activeTokenLayer() })), skipped, "Colar");
  }
  function duplicate() {
    if (simulate) return;
    const own = editableSelection().filter((i) => !draft.prepared[i].characterId);
    if (!own.length) return say("Personagens dos jogadores aparecem uma vez por cena e não são duplicados.");
    const anchor = { x: Math.min(...own.map((i) => draft.prepared[i].x)) + 1, y: Math.min(...own.map((i) => draft.prepared[i].y)) };
    const { placed, skipped } = pastePlacement({ cells: layer?.cells, width: width(), height: height(), tokens: draft.prepared, items: clipboardFrom(draft.prepared, own), anchor, free: freeOn() });
    insertPlaced(placed, skipped, "Duplicar");
  }
  function toggleHidden() {
    const ids = editableSelection().filter((i) => !draft.prepared[i].characterId);
    if (!ids.length) return say("Personagens dos jogadores entram visíveis; oculte marcadores e personagens do mestre.");
    const show = ids.every((i) => draft.prepared[i].hidden);
    change(show ? "Mostrar aos jogadores" : "Ocultar dos jogadores", () => { for (const i of ids) draft.prepared[i] = { ...draft.prepared[i], hidden: !show }; });
    refresh();
  }
  function moveSelectionToLayer(id) {
    const target = draft.layers.find((l) => l.id === id);
    if (!target || id === "base") return say(BASE_ONLY);
    if (target.locked) return say(`A camada “${target.name}” está bloqueada.`);
    const ids = editableSelection();
    if (!ids.length) return say("Selecione marcadores para mover de camada.");
    change(`Mover para “${target.name}”`, () => { for (const i of ids) draft.prepared[i] = { ...draft.prepared[i], layer: id }; });
    selection = selection.filter(editable);
    refresh();
  }
  function selectLayer(id) {
    selection = draft.prepared.map((t, i) => [t, i]).filter(([t, i]) => tokenLayerOf(t.layer, draft.layers) === id && editable(i)).map(([, i]) => i);
    panel = selection.length ? "token" : "overview";
    refreshSelection();
    say(selection.length ? `${selection.length} marcador(es) selecionado(s).` : "Nenhum marcador editável nessa camada.");
  }
  function selectAll() {
    if (simulate) return;
    selection = draft.prepared.map((_, i) => i).filter(editable);
    panel = selection.length ? "token" : "overview";
    refreshSelection();
  }
  function deselect() {
    selection = []; pick = null;
    if (["token", "add", "light", "mark"].includes(panel)) panel = "overview";
    refreshSelection();
  }
  function layerAction(action, id, value) {
    const current = draft.layers.find((l) => l.id === id);
    if (action === "select") { activeLayer = id; return renderLayers(); }
    if (action === "move-selection") return moveSelectionToLayer(id);
    if (["visible", "lock", "opacity", "rename"].includes(action)) {
      if (id === "base" || !current) return say(BASE_ONLY);
      const patch = action === "visible" ? { visible: !current.visible } : action === "lock" ? { locked: !current.locked } : action === "opacity" ? { opacity: value } : { name: value };
      const label = { visible: patch.visible ? "Mostrar camada" : "Ocultar camada no editor", lock: patch.locked ? "Bloquear camada" : "Desbloquear camada", opacity: "Opacidade da camada", rename: "Renomear camada" }[action];
      change(label, () => { draft.layers = patchLayer(draft.layers, id, patch); });
      selection = selection.filter(editable);
      return refresh();
    }
    if (action === "up" || action === "down") {
      const result = moveLayer(draft.layers, id, action === "up" ? 1 : -1);
      if (result.error) return say(result.error);
      change(action === "up" ? "Subir camada" : "Descer camada", () => { draft.layers = result.layers; });
      return refresh();
    }
    if (action === "add" || action === "duplicate") {
      if (action === "duplicate" && (id === "base" || !current)) return say(BASE_ONLY);
      const result = action === "add" ? addLayer(draft.layers, "", id !== "base" ? id : null)
        : addLayer(draft.layers, `${current.name} (cópia)`.slice(0, 40), id, { visible: current.visible, opacity: current.opacity });
      if (result.error) return say(result.error);
      change(action === "add" ? "Nova camada" : "Duplicar camada", () => { draft.layers = result.layers; });
      activeLayer = result.id;
      if (action === "duplicate") say("Camada duplicada sem os marcadores: cada casa aceita um marcador.");
      return refresh();
    }
    if (action === "delete") {
      const result = removeLayer(draft.layers, id);
      if (result.error) return say(result.error);
      const moved = draft.prepared.filter((t) => t.layer === id).length;
      change("Excluir camada", () => { draft.layers = result.layers; draft.prepared = draft.prepared.map((t) => (t.layer === id ? { ...t, layer: "elements" } : t)); });
      activeLayer = "elements";
      if (moved) say(`${moved} marcador(es) foram para Elementos.`);
      return refresh();
    }
  }
  function renameActiveLayer() {
    const current = draft.layers.find((l) => l.id === activeLayer);
    if (!current || current.id === "base") return say(BASE_ONLY);
    const name = prompt("Nome da camada (até 40 caracteres)", current.name);
    if (name != null && name.trim()) layerAction("rename", current.id, name.trim().slice(0, 40));
  }

  // ---------- Propriedades do marcador (janela flutuante) ----------
  function openTokenProperties(i) {
    const t = draft.prepared[i];
    if (!t || simulate) return;
    if (!editable(i)) return say("Esse marcador está numa camada oculta ou bloqueada.");
    const pc = !!t.characterId;
    const fields = [
      pc ? { name: "label", label: "Nome", type: "static", value: t.label } : { name: "label", label: "Nome", type: "text", value: t.label, maxlength: 40, required: true },
      ...(pc ? [{ name: "kind", label: "Tipo", type: "static", value: "Personagem dos jogadores" }] : [
        { name: "side", label: "Lado", type: "select", value: t.side || "enemy", options: SIDES },
        { name: "hidden", label: "Oculto: só você vê até revelar", type: "checkbox", value: !!t.hidden },
      ]),
      ...(mode === "complete" && !pc ? [{ name: "light", label: "Luz que carrega", unit: "casas", type: "number", min: 0, max: 30, step: 1, value: t.light ?? "", help: "Vazio usa o padrão da mesa." }] : []),
      { name: "pos", label: "Posição", type: "heading" },
      { name: "x", label: "Coluna", type: "number", min: 1, max: width(), step: 1, value: t.x + 1, required: true },
      { name: "y", label: "Linha", type: "number", min: 1, max: height(), step: 1, value: t.y + 1, required: true },
      ...(freeOn() ? [
        { name: "fx", label: "Ponto na casa, horizontal (0–999)", type: "number", min: 0, max: 999, step: 1, value: t.fx ?? 500, help: "500 é o centro da casa." },
        { name: "fy", label: "Ponto na casa, vertical (0–999)", type: "number", min: 0, max: 999, step: 1, value: t.fy ?? 500 },
      ] : []),
      { name: "layer", label: "Camada", type: "select", value: tokenLayerOf(t.layer, draft.layers), options: tokenLayers().map((l) => [l.id, l.name]) },
    ];
    openPropertiesDialog({
      title: pc ? t.label : `Propriedades: ${t.label}`,
      fields,
      onApply: (v) => {
        const cur = draft.prepared[i];
        if (!cur) throw new Error("O marcador não está mais na cena.");
        const label = pc ? cur.label : String(v.label || "").trim().slice(0, 40);
        if (!label) throw new Error("Dê um nome ao marcador.");
        const x = Math.round(Number(v.x)) - 1, y = Math.round(Number(v.y)) - 1;
        if (x !== cur.x || y !== cur.y) {
          const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, x, y, i, freeOn());
          if (problem) throw new Error(problem);
        }
        const fine = (n, old) => (freeOn() ? (n == null ? old ?? null : Math.max(0, Math.min(999, Math.round(n)))) : null);
        const target = tokenLayerOf(v.layer, draft.layers);
        if (target !== tokenLayerOf(cur.layer, draft.layers) && draft.layers.find((l) => l.id === target)?.locked) throw new Error("A camada escolhida está bloqueada.");
        change("Propriedades do marcador", () => {
          draft.prepared[i] = {
            ...cur, label, x, y, fx: fine(v.fx, cur.fx), fy: fine(v.fy, cur.fy), layer: target,
            ...(pc ? {} : { side: v.side, hidden: !!v.hidden }),
            ...(mode === "complete" && !pc ? { light: v.light == null ? null : Math.max(0, Math.min(30, Math.round(v.light))) } : {}),
          };
        });
        refresh();
      },
    });
  }

  // ---------- Composição da cena (ADR-090) ----------
  // Elementos só desta cena sobre o mapa compartilhado. Cada operação entra no histórico do editor; salvar envia o
  // documento e a sobreposição achatada (PNG transparente) pelo endpoint próprio da composição.
  function compChange(label, fn) {
    if (!composable() || simulate) return false;
    change(label, () => { if (!draft.composition) { draft.composition = compDoc(); pendingBlank = null; } fn(); });
    afterCompose();
    return true;
  }
  function afterCompose() { composer?.invalidate(); if (composing()) { renderSide(); renderLayers(); } else schedulePreview(); renderStatus(); }
  /** Prévia achatada (mapa + imagens visíveis no editor) para o tabuleiro dos contextos de personagens, paredes e luz. */
  function schedulePreview() {
    clearTimeout(previewTimer2);
    if (!compElements() || !imageMap()) {
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; redraw(); }
      return;
    }
    if (composing()) return; // recalcula ao sair da composição
    const seq = ++previewSeq2;
    previewTimer2 = setTimeout(async () => {
      try {
        const url = await flattenPreview(draft.composition, imageCache);
        if (seq !== previewSeq2 || closed) { URL.revokeObjectURL(url); return; }
        const old = previewUrl; previewUrl = url; redraw();
        if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
      } catch (e) { say(e.message); }
    }, 150);
  }
  const boardCamera = {
    zoomIn: () => board.camera.zoomIn(), zoomOut: () => board.camera.zoomOut(), fit: () => board.camera.fit(),
    actual: () => board.camera.actual(natural()), zoom: () => board.camera.zoom(natural()),
    setPanHold: (on) => board.camera.setPanHold(on), setPan: (on) => board.camera.setPan(on),
    ruler: () => {
      if (!mapKind() || !meta) return null;
      const r = board.camera.cellRect({ x: 0, y: 0 });
      const locked = toolProblem("gridAdjust");
      return r.size > 0 ? { x: r.x, y: r.y, cellPx: r.size, cellUnits: Number(meta.scaleMeters) || 1.5, unit: "m", onScale: locked ? null : () => openPanel("gridAdjust"), scaleReason: locked || "" } : null;
    },
  };
  function composeCamera() {
    const cam = composer.surface.camera;
    return { ...cam, setPan: () => {}, ruler: () => {
      const v = cam.view();
      return meta?.gridPixels ? { x: v.left + (meta.gridOffsetX || 0) * v.scale, y: v.top + (meta.gridOffsetY || 0) * v.scale, cellPx: meta.gridPixels * v.scale, cellUnits: Number(meta.scaleMeters) || 1.5, unit: "m" }
        : { x: v.left, y: v.top, cellPx: v.scale, cellUnits: 1, unit: "px" };
    } };
  }
  function mountComposer() {
    if (composer) return composer;
    composer = createSceneComposer({
      host: q("#se-compose"), doc: compDoc, tool: () => tool, cache: imageCache,
      resolveSrc: sceneSourceResolver(campaign.id, () => imageMap()?.imageUrl),
      options: () => ({ snap: true, snapObjects: true, grid: meta?.gridPixels && grid ? { size: meta.gridPixels, offsetX: meta.gridOffsetX || 0, offsetY: meta.gridOffsetY || 0 } : null }),
      change: (label, fn) => compChange(label, fn),
      begin: (label) => { commitTyping(); history.begin(label); if (!draft.composition) { draft.composition = compDoc(); pendingBlank = null; } },
      commit: () => { history.commit(); recomputeDirty(); afterCompose(); },
      cancel: () => { history.cancel(); composer?.invalidate(); },
      onSelection: () => { if (composing()) { renderSide(); renderLayers(); } },
      onLive: () => syncComposeBar(),
      onContext: (at, id, point) => composeMenu(at, id, point),
      onOpen: () => showProps(),
      cursor: (p) => shell.setStatus({ coords: p ? `${Math.round(p.x)}, ${Math.round(p.y)} px` : "" }),
      camera: () => shell.updateZoom(),
      keepRatio: () => keepRatio,
      say,
    });
    composer.surface.canvas.setAttribute("aria-label", "Composição da cena: imagens por cima do mapa. Setas movem 1 pixel (Shift: 10); Enter abre as propriedades; Shift+F10 abre o menu.");
    composer.surface.canvas.addEventListener("keydown", onComposeKey);
    return composer;
  }
  function onWorkContext(id) {
    if (id === "compose" && composable()) { mountComposer(); shell.setCamera(composeCamera()); composer.invalidate(); }
    else { shell.setCamera(boardCamera); schedulePreview(); }
    shell.contextBar?.hide();
    renderAll();
  }
  function onComposeKey(e) {
    if (!composer) return;
    const dir = ARROWS[e.key];
    if (dir && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); const step = e.shiftKey ? 10 : 1; composer.nudge(dir[0] * step, dir[1] * step); return; }
    if (e.key === "Enter" && composer.selection.size) { e.preventDefault(); showProps(); return; }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const el = composer.selected()[0];
      composeMenu(composer.surface.clientPointOf(el), el?.id || null, composer.viewCenter());
    }
  }
  function composeMenu(at, id, point) {
    if (!composer || simulate) return;
    if (!id) {
      return openContextMenu(at, [
        { label: "Adicionar imagem…", run: () => pickImages() },
        { label: "Colar aqui", shortcut: "mod+v", disabled: !composer.hasClipboard, disabledReason: "Copie um elemento antes.", run: () => { composer.paste(point); afterCompose(); } },
        { label: "Selecionar tudo", shortcut: "mod+a", run: () => composer.select((draft.composition?.elements || []).filter((x) => CP.isSelectable(draft.composition, x)).map((x) => x.id), false) },
      ], { label: "Composição" });
    }
    const els = composer.selected(), one = els[0];
    const layers = compDoc().layers;
    const act = (fn) => () => { fn(); afterCompose(); };
    openContextMenu(at, [
      { label: "Propriedades…", shortcut: "enter", run: () => showProps() },
      { label: "Duplicar", shortcut: "mod+j", run: act(() => composer.duplicate()) },
      { label: "Copiar", shortcut: "mod+c", run: () => composer.copy() },
      { label: "Recortar", shortcut: "mod+x", run: act(() => composer.cut()) },
      { label: "Excluir", shortcut: "delete", danger: true, run: act(() => composer.remove()) },
      { separator: true },
      { label: "Ajustar à área (imagem inteira)", run: act(() => composer.fit("fit")) },
      { label: "Preencher a área (pode recortar)", run: act(() => composer.fit("fill")) },
      { label: "Tamanho original", run: act(() => composer.fit("original")) },
      { label: "Centralizar", run: act(() => composer.fit("center")) },
      { separator: true },
      { label: "Espelhar na horizontal", run: act(() => composer.flip("x")) },
      { label: "Espelhar na vertical", run: act(() => composer.flip("y")) },
      { label: "Girar 90° à direita", run: act(() => composer.rotate(90)) },
      { label: "Girar 90° à esquerda", run: act(() => composer.rotate(-90)) },
      { separator: true },
      { label: "Trazer para frente", shortcut: "mod+]", run: act(() => composer.zorder("front")) },
      { label: "Avançar", run: act(() => composer.zorder("forward")) },
      { label: "Recuar", run: act(() => composer.zorder("backward")) },
      { label: "Enviar para trás", shortcut: "mod+[", run: act(() => composer.zorder("back")) },
      { separator: true },
      { label: "Só o mestre vê (oculto dos jogadores)", checked: els.every((x) => x.secret), run: act(() => composer.toggle("secret")) },
      { label: els.every((x) => x.locked) ? "Desbloquear" : "Bloquear", run: act(() => composer.toggle("locked")) },
      { label: "Mover para camada", items: layers.slice().reverse().map((l) => ({ label: l.name, checked: els.every((x) => x.layer === l.id), disabled: l.locked, disabledReason: "Camada bloqueada.", run: act(() => composer.moveToLayer(l.id)) })) },
    ], { label: one?.name || "Imagem" });
  }
  /** Barra de propriedades do elemento selecionado: posição, tamanho, giro, opacidade, camada, proporção e ações rápidas. */
  function syncComposeBar() {
    const bar = shell.contextBar;
    if (!bar) return;
    if (!composer || !composing() || simulate) return;
    const els = composer.selected();
    if (!els.length) return bar.hide();
    const one = els.length === 1 ? els[0] : null;
    const layers = compDoc().layers;
    const values = one ? { x: one.x, y: one.y, width: one.width, height: one.height, rotation: one.rotation, opacity: one.opacity } : { opacity: els[0].opacity };
    const key = "comp:" + els.map((e) => e.id).join(",");
    if (bar.available && document.activeElement?.closest?.("[data-ed-contextbar]") && bar._key === key) return bar.update(values);
    bar._key = key;
    bar.show({
      key, title: one ? one.name || "Imagem" : `${els.length} elementos`, icon: "image",
      fields: [
        ...(one ? [
          { name: "x", label: "X", type: "number", step: 1, unit: "px", value: one.x },
          { name: "y", label: "Y", type: "number", step: 1, unit: "px", value: one.y },
          { name: "width", label: "Largura", type: "number", min: 1, max: 16384, step: 1, unit: "px", value: one.width },
          { name: "height", label: "Altura", type: "number", min: 1, max: 16384, step: 1, unit: "px", value: one.height },
          { name: "keepRatio", label: "Manter proporção", type: "checkbox", value: keepRatio },
          { name: "rotation", label: "Giro", type: "number", min: -360, max: 360, step: 1, unit: "°", value: one.rotation },
        ] : []),
        { name: "opacity", label: "Opacidade", type: "number", min: 0, max: 100, step: 1, unit: "%", value: els[0].opacity },
        { name: "layer", label: "Camada", type: "select", value: els.every((x) => x.layer === els[0].layer) ? els[0].layer : "", options: layers.map((l) => [l.id, l.name]) },
        { name: "secret", label: "Só o mestre vê", type: "checkbox", value: els.every((x) => x.secret) },
        { name: "locked", label: "Bloqueado", type: "checkbox", value: els.every((x) => x.locked) },
      ],
      actions: [
        { id: "fit", label: "Ajustar à área visível (imagem inteira)", icon: "maximize" },
        { id: "fill", label: "Preencher a área visível (pode recortar)", icon: "fill" },
        { id: "original", label: "Tamanho original", icon: "image" },
        { id: "center", label: "Centralizar no mapa", icon: "alignCenter" },
        { id: "flipX", label: "Espelhar na horizontal", icon: "distributeX" },
        { id: "flipY", label: "Espelhar na vertical", icon: "distributeY" },
        { id: "duplicate", label: "Duplicar (Ctrl+J)", icon: "copy" },
        { id: "front", label: "Trazer para frente", icon: "up" },
        { id: "back", label: "Enviar para trás", icon: "down" },
        { id: "delete", label: "Excluir", icon: "trash", danger: true },
      ],
      onChange: (name, value) => {
        if (name === "keepRatio") { keepRatio = !!value; return say(keepRatio ? "Proporção mantida ao mudar largura ou altura." : "Proporção liberada: largura e altura mudam separadamente."); }
        if (name === "layer" && !value) return;
        composer.setField(name, value); afterCompose(); syncComposeBar();
      },
      onAction: (id) => composeAction(id),
    });
  }
  function composeAction(id) {
    if (!composer) return;
    ({
      fit: () => composer.fit("fit"), fill: () => composer.fit("fill"), original: () => composer.fit("original"), center: () => composer.fit("center"),
      flipX: () => composer.flip("x"), flipY: () => composer.flip("y"), duplicate: () => composer.duplicate(), front: () => composer.zorder("front"), back: () => composer.zorder("back"),
      delete: () => composer.remove(), rotR: () => composer.rotate(90), rotL: () => composer.rotate(-90), add: () => pickImages(),
    })[id]?.();
    afterCompose(); syncComposeBar();
  }
  /** Painel Propriedades no contexto Composição: o selecionado ou, sem seleção, o que é desta cena e o que é compartilhado. */
  function composePanel() {
    const m = mapOf(draft.mapKey);
    if (!composable()) {
      if (!draft.mapKey) return `<div class="se-panel"><h3>Composição da cena${helpButton("campanhas.cenas.composicao", "Composição da cena")}</h3><p class="form-help">Comece pelo fundo: arraste uma imagem para o palco, envie do computador ou escolha um mapa.</p><div class="form-actions">${button("Enviar imagem…", "se-tool", "addImage", "primary")}${button("Escolher um mapa", "se-tool", "scenery", "subtle")}</div></div>`;
      return `<div class="se-panel"><h3>Composição da cena${helpButton("campanhas.cenas.composicao", "Composição da cena")}</h3><p class="form-help">A composição usa uma imagem da campanha como fundo. Esta cena usa “${esc(m?.name || "um cenário pronto")}” (${esc(mapTypeLabel(m))}), que não recebe imagens por cima.</p><div class="form-actions">${button("Usar uma imagem minha como fundo…", "se-replace-bg", "", "subtle")}${button("Escolher outro mapa", "se-tool", "scenery", "subtle")}</div></div>`;
    }
    const els = composer?.selected() || [];
    const scope = `<p class="se-scope" role="note"><strong>Somente esta cena.</strong> As imagens ficam por cima do mapa “${esc(m.name)}”, que é compartilhado${m && (m.scenes?.length || 0) > 1 ? " com outras cenas" : ""} e não muda aqui.</p>`;
    if (!els.length) {
      const n = compElements();
      return `<div class="se-panel"><h3>Composição da cena${helpButton("campanhas.cenas.composicao", "Composição da cena")}</h3>${scope}<p class="form-help">${n ? `${n} elemento(s) nesta cena. Clique numa imagem para mover, redimensionar (alças; Shift solta a proporção, Alt a partir do centro) e girar (alça de cima).` : "Arraste imagens do computador ou do painel Acervo, cole com Ctrl+V ou use Adicionar imagem. Cada imagem é um elemento independente."}</p>
        <div class="form-actions">${button("Adicionar imagem…", "se-tool", "addImage", "primary")}${button("Abrir o mapa original…", "se-open-map", "", "subtle")}${n ? button("Criar mapa a partir da composição", "se-map-from-comp", "", "subtle") : ""}</div>
        <p class="form-help">“Ocultar” e “Bloquear” nas camadas valem só no editor. Para esconder dos jogadores, marque <strong>Só o mestre vê</strong>.</p></div>`;
    }
    const one = els.length === 1 ? els[0] : null;
    const status = one ? CP.artboardStatus(one, compDoc().artboard) : "";
    return `<div class="se-panel"><h3>${one ? esc(one.name || "Imagem") : `${els.length} elementos`}</h3>${scope}
      ${one ? `<div class="field"><label for="se-c-name">Nome</label><input id="se-c-name" data-comp-name maxlength="80" value="${esc(one.name || "")}"></div><p class="form-help">${Math.round(one.width)} × ${Math.round(one.height)} px · giro ${Math.round(one.rotation)}°${status === "outside" ? " · fora da área visível (não aparece na mesa)" : status === "partial" ? " · parcialmente fora da área visível (a parte de fora não aparece)" : ""}.</p>` : ""}
      <label class="check"><input type="checkbox" data-comp-flag="secret" ${els.every((x) => x.secret) ? "checked" : ""}> Só o mestre vê (não vai para os jogadores)</label>
      <label class="check"><input type="checkbox" data-comp-flag="visible" ${els.every((x) => x.visible) ? "" : "checked"}> Ocultar só no editor</label>
      <label class="check"><input type="checkbox" data-comp-flag="locked" ${els.every((x) => x.locked) ? "checked" : ""}> Bloquear</label>
      <div class="se-comp-actions" role="group" aria-label="Tamanho e posição">${button("Ajustar à área", "se-comp", "fit", "subtle small")}${button("Preencher a área", "se-comp", "fill", "subtle small")}${button("Tamanho original", "se-comp", "original", "subtle small")}${button("Centralizar", "se-comp", "center", "subtle small")}</div>
      <p class="form-help"><strong>Ajustar</strong> mostra a imagem inteira dentro do mapa; <strong>Preencher</strong> cobre o mapa todo e pode recortar; <strong>Tamanho original</strong> usa os pixels da imagem.</p>
      <div class="se-comp-actions" role="group" aria-label="Transformar">${button("Espelhar ↔", "se-comp", "flipX", "subtle small")}${button("Espelhar ↕", "se-comp", "flipY", "subtle small")}${button("Girar 90°", "se-comp", "rotR", "subtle small")}${button("Duplicar", "se-comp", "duplicate", "subtle small")}${button("Frente", "se-comp", "front", "subtle small")}${button("Trás", "se-comp", "back", "subtle small")}</div>
      <div class="form-actions se-danger-zone">${button("Excluir", "se-comp", "delete", "text-button")}</div></div>`;
  }
  function renderCompLayers(host) {
    const d = compDoc();
    renderLayersPanel(host, {
      layers: d.layers, active: composer?.activeLayer || "elements", complete: mode === "complete", selectionCount: composer?.editableSelection().length || 0,
      visibilityNote: "Olho, cadeado e opacidade valem só no editor. Para esconder dos jogadores use “Só o mestre vê”.",
      onAction: compLayerAction,
    });
    host.insertAdjacentHTML("beforeend", `<fieldset class="se-secret-layers"><legend>Na sessão</legend>${d.layers.map((l) => `<label class="check"><input type="checkbox" data-comp-secret="${esc(l.id)}" ${l.secret ? "checked" : ""}> ${esc(l.name)}: só o mestre vê</label>`).join("")}<p class="form-help">O mapa compartilhado fica no fundo da camada ${esc(d.layers[0].name)} e não pode ser movido aqui.</p></fieldset>`);
  }
  function compLayerAction(action, id, value) {
    const d = compDoc(), current = d.layers.find((l) => l.id === id);
    if (action === "select") { if (composer) composer.activeLayer = id; return renderLayers(); }
    if (action === "move-selection") { composer?.moveToLayer(id); return afterCompose(); }
    if (["visible", "lock", "opacity", "rename"].includes(action)) {
      if (!current) return;
      const patch = action === "visible" ? { visible: !current.visible } : action === "lock" ? { locked: !current.locked } : action === "opacity" ? { opacity: value } : { name: value };
      return compChange({ visible: patch.visible ? "Mostrar camada no editor" : "Ocultar camada no editor", lock: patch.locked ? "Bloquear camada" : "Desbloquear camada", opacity: "Opacidade da camada", rename: "Renomear camada" }[action], () => { draft.composition.layers = patchLayer(draft.composition.layers, id, patch); });
    }
    if (action === "up" || action === "down") {
      const result = moveLayer(d.layers, id, action === "up" ? 1 : -1);
      if (result.error) return say(result.error);
      return compChange(action === "up" ? "Subir camada" : "Descer camada", () => { draft.composition.layers = result.layers; });
    }
    if (action === "add" || action === "duplicate") {
      const result = action === "add" ? addLayer(d.layers, "", id) : addLayer(d.layers, `${current?.name || "Camada"} (cópia)`.slice(0, 40), id, { visible: current?.visible, opacity: current?.opacity });
      if (result.error) return say(result.error);
      compChange(action === "add" ? "Nova camada" : "Duplicar camada", () => { draft.composition.layers = result.layers; });
      if (composer) composer.activeLayer = result.id;
      return renderLayers();
    }
    if (action === "delete") {
      const result = removeLayer(d.layers, id);
      if (result.error) return say(result.error);
      compChange("Excluir camada", () => { draft.composition.layers = result.layers; draft.composition.elements = draft.composition.elements.map((e) => (e.layer === id ? { ...e, layer: "elements" } : e)); });
      if (composer) composer.activeLayer = "elements";
    }
  }
  /** Painel Acervo: mapas de imagem da campanha arrastáveis para a composição (referência, sem copiar o arquivo). */
  let assetsKey = "";
  function renderAssets(force = false) {
    const host = shell.panel("assets");
    if (!host) return;
    if (!host.querySelector("[data-asset-q]")) {
      host.innerHTML = '<div class="field"><label for="se-asset-q">Buscar no acervo</label><input id="se-asset-q" type="search" data-asset-q maxlength="80" autocomplete="off"></div><div data-asset-list></div><p class="form-help">Arraste para o palco ou use Adicionar: a cena passa a usar a mesma imagem, sem duplicar o arquivo. Numa cena vazia, a imagem vira o fundo.</p>';
      bindAssetList(host, { onAdd: (item) => addFromAsset(item, null) });
    }
    // As miniaturas só são refeitas quando a lista muda (imagens do acervo não ficam em cache do navegador).
    const key = `${draft.mapKey}|${maps.items.length}|${host.querySelector("[data-asset-q]").value}`;
    if (!force && key === assetsKey) return;
    assetsKey = key;
    const items = maps.items.filter((m) => m.key !== draft.mapKey);
    host.querySelector("[data-asset-list]").innerHTML = assetListHtml(items, { query: host.querySelector("[data-asset-q]").value, empty: "Nenhuma imagem no acervo da campanha ainda. Envie imagens pela Preparação › Mapas ou solte arquivos aqui no palco." });
  }

  // ---------- Imagens soltas, coladas ou escolhidas (ADR-090) ----------
  function pickImages() { const input = q("#se-files"); input.value = ""; input.click(); }
  /** Ponto do documento (pixels da imagem) onde a imagem foi solta; null = centro da vista. */
  function dropPoint(p) {
    if (!p) return null;
    if (composing() && composer) return composer.docPoint(p);
    if (meta?.gridPixels) {
      const c = board.camera.pointAt(p.clientX, p.clientY);
      if (c) return { x: (meta.gridOffsetX || 0) + (c.x + (c.fx ?? 500) / 1000) * meta.gridPixels, y: (meta.gridOffsetY || 0) + (c.y + (c.fy ?? 500) / 1000) * meta.gridPixels };
    }
    return null;
  }
  async function handleFiles(list, p = null) {
    if (simulate) return say("Volte à edição antes de adicionar imagens.");
    if (busy || uploading) return say("Aguarde a operação em andamento terminar.");
    const { files, problems } = splitImageFiles(list);
    if (problems.length) say(problems.join(" "));
    if (!files.length) return;
    if (mapOnly) return say("Imagens entram no editor do mapa (Preparação › Mapas) ou na composição de uma cena.");
    if (draft.kind === "text") return say("Cenas textuais não têm imagem. Mude o tipo em Cena › Cenário.");
    if (!draft.mapKey) { startChoice = { files }; renderSide(); return showProps(); }
    if (!composable()) { startChoice = { files, replace: true }; renderSide(); return showProps(); }
    const at = dropPoint(p);
    if (shell.context !== "compose") shell.setContext("compose");
    await addFileElements(files, at);
  }
  /** Garante a cena salva (as imagens-fonte pertencem a ela). Cena nova sem nome recebe o nome da imagem. */
  async function ensureSceneSaved(hint) {
    if (saved.id) return true;
    if (!draft.name.trim()) { draft.name = `Cena — ${hint}`.slice(0, 80); if (nameInput) nameInput.value = draft.name; shell.setTitle(titleText(), subtitleText()); }
    await save();
    if (saved.id) say("Cena salva para guardar as imagens dela. Continue compondo.");
    return !!saved.id;
  }
  async function addFileElements(files, at) {
    if (!(await ensureSceneSaved(baseName(files[0].name)))) return;
    mountComposer();
    uploading = true; shell.refreshTools();
    const added = [];
    try {
      for (const [i, file] of files.entries()) {
        say(files.length > 1 ? `Enviando imagem ${i + 1} de ${files.length}…` : `Enviando “${baseName(file.name)}”…`);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", baseName(file.name));
        const source = await api(`${base}/scenes/${saved.id}/sources`, "POST", fd, { background: true });
        if (closed) return;
        const el = composer.addImage(source, at ? { x: at.x + i * 24, y: at.y + i * 24 } : null);
        if (el) added.push(el.id);
      }
      say(added.length > 1 ? `${added.length} imagens adicionadas só a esta cena.` : "Imagem adicionada só a esta cena: arraste para mover; as alças redimensionam e giram.");
    } catch (e) {
      say(`${added.length ? `${added.length} imagem(ns) adicionada(s). ` : ""}${e?.message || "O envio falhou."} As restantes não foram enviadas; tente de novo.`);
    } finally {
      uploading = false;
      if (added.length) composer.select(added, false);
      shell.refreshTools(); afterCompose(); syncComposeBar();
    }
  }
  /** Imagem do acervo: numa cena vazia vira o fundo; senão entra na composição como referência (sem copiar bytes). */
  async function addFromAsset(item, p) {
    if (simulate || mapOnly || draft.kind === "text") return;
    const m = mapOf(item.src);
    if (!draft.mapKey && m) return chooseMap(m);
    if (!composable()) return say("A composição usa uma imagem da campanha como fundo. Escolha o fundo antes.");
    const at = dropPoint(p);
    if (shell.context !== "compose") shell.setContext("compose");
    mountComposer().addImage({ key: item.src, name: item.name, width: item.width || m?.pixelWidth, height: item.height || m?.pixelHeight }, at, { label: "Imagem do acervo" });
    syncComposeBar();
  }

  // ---------- Primeira imagem, área em branco e tornar jogável (ADR-090) ----------
  function startPanel() {
    const c = startChoice;
    const modes = BACKGROUND_MODES.filter(([v]) => !(c.playable && v === "image"));
    const files = c.files || [];
    const head = c.playable ? "Tornar esta imagem jogável" : c.blank ? "Começar com uma área em branco" : c.replace ? "Usar como novo fundo da cena?" : "Primeira imagem da cena";
    const use = files.length ? `<fieldset><legend>“${esc(baseName(files[0].name))}”</legend><label class="check se-option"><input type="radio" name="use" value="background" checked><span><strong>Usar como fundo da cena</strong><small>Vira o mapa desta cena (guardado em Mapas e reutilizável em outras cenas).</small></span></label>${c.replace ? "" : `<label class="check se-option"><input type="radio" name="use" value="element"><span><strong>Adicionar como elemento independente</strong><small>Cria um fundo em branco do mesmo tamanho e coloca a imagem por cima, livre para mover.</small></span></label>`}</fieldset>${files.length > 1 ? `<p class="form-help">As outras ${files.length - 1} imagem(ns) entram como elementos por cima do fundo.</p>` : ""}` : "";
    const size = c.blank ? `<div class="field"><label for="se-blank-size">Tamanho</label><select id="se-blank-size" name="size">${opt([["2048x1536", "2048 × 1536 px (4:3)"], ["1920x1080", "1920 × 1080 px (16:9)"], ["1536x1536", "1536 × 1536 px (quadrado)"], ["3072x2048", "3072 × 2048 px (grande)"]], "2048x1536")}</select></div>` : "";
    const replaceNote = c.replace ? '<p class="notice-box">Trocar o fundo remove as posições preparadas e a composição desta cena (o mapa anterior continua em Mapas).</p>' : "";
    const sharedNote = c.playable ? `<p class="form-help">O mapa “${esc(imageMap()?.name || "")}” ganha uma grade técnica e passa a aceitar personagens. Outras cenas que o usam como imagem continuam iguais.</p>` : "";
    return `<form class="se-panel se-start-form" data-start-form><h3>${head}${helpButton("campanhas.cenas.composicao", "Composição da cena")}</h3>${replaceNote}${use}${size}
      <fieldset><legend>Como os personagens usam a imagem?</legend>${modes.map(([v, l, help], i) => `<label class="check se-option"><input type="radio" name="mode" value="${v}" ${i === 0 ? "checked" : ""}><span><strong>${esc(l)}</strong><small>${esc(help)}</small></span></label>`).join("")}</fieldset>${sharedNote}
      <div class="form-actions">${button("Cancelar", "se-start-cancel", "", "subtle")}<button type="submit" class="primary">Continuar</button></div></form>`;
  }
  async function confirmStart(form) {
    const c = startChoice;
    if (!c || busy || uploading) return;
    const data = Object.fromEntries(new FormData(form));
    const modeV = BACKGROUND_MODES.some(([v]) => v === data.mode) ? data.mode : "free";
    if (c.replace && (draft.prepared.length || compElements()) && !confirm("Trocar o fundo remove as posições preparadas e a composição desta cena. Continuar?")) return;
    startChoice = null;
    uploading = true; renderSide(); renderStatus();
    try {
      if (c.playable) { uploading = false; return await makePlayable(modeV); }
      if (c.blank) {
        const [w, h] = String(data.size || "2048x1536").split("x").map(Number);
        await createBackground(await blankImage(w, h), modeV, "Área em branco");
      } else if (data.use === "element") {
        const s = await readImageSize(c.files[0]);
        const k = Math.min(1, 4096 / Math.max(s.width, s.height), Math.sqrt(8_000_000 / (s.width * s.height)));
        await createBackground(await blankImage(Math.max(256, Math.round(s.width * k)), Math.max(256, Math.round(s.height * k))), modeV, "Área em branco");
        uploading = false;
        if (shell.context !== "compose") shell.setContext("compose");
        await addFileElements(c.files, null);
      } else {
        await createBackground(c.files[0], modeV, baseName(c.files[0].name));
        uploading = false;
        if (c.files.length > 1) { if (shell.context !== "compose") shell.setContext("compose"); await addFileElements(c.files.slice(1), null); }
      }
    } catch (e) { error = e?.message || "Não foi possível criar o fundo."; }
    finally { uploading = false; renderAll(); }
  }
  /** PNG liso (pergaminho escuro) para "área em branco". */
  function blankImage(w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(64, Math.min(4096, w)); canvas.height = Math.max(64, Math.min(4096, h));
    const g = canvas.getContext("2d");
    g.fillStyle = "#1d1a15"; g.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(new File([b], "area-em-branco.png", { type: "image/png" })) : reject(new Error("O navegador não gerou a área em branco."))), "image/png"));
  }
  /** Envia a imagem como mapa da campanha (pelo upload de mapas existente) e a associa a esta cena. */
  async function createBackground(file, modeV, name) {
    const s = await readImageSize(file);
    const playable = modeV !== "image";
    const gridPx = defaultGrid(s.width, s.height);
    if (playable && !gridPx) throw new Error("A imagem é pequena ou estreita demais para posicionar personagens. Use “Somente apresentação” ou outra imagem.");
    say("Enviando o fundo da cena…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", String(name || "Fundo").slice(0, 120));
    fd.append("gridPixels", String(gridPx || 64));
    fd.append("scaleMeters", "1.5");
    fd.append("hasGrid", String(playable));
    fd.append("freeMovement", String(modeV === "free"));
    const created = await api(`${base}/assets/maps`, "POST", fd, { background: true });
    maps.items = (await api(`${base}/maps`, "GET", undefined, { background: true })).items;
    commitTyping();
    draft.kind = playable ? "map" : "image"; draft.mapKey = `asset:${created.id}`;
    draft.prepared = []; draft.composition = null; draft.entry = null; pendingBlank = null; selection = [];
    await loadLayer();
    resetHistory("Fundo da cena definido. O histórico de desfazer recomeça a partir daqui.");
    recomputeDirty(); renderAll(); renderPanels();
    say(`Fundo “${created.name}” pronto (${playable ? (modeV === "free" ? "movimentação livre" : "movimentação tática") : "somente apresentação"}). Ele também fica em Preparação › Mapas.`);
  }
  /** Imagem sem grade → jogável: grade técnica (livre) ou visível (tática). Escolha explícita, que muda o mapa compartilhado. */
  async function makePlayable(modeV) {
    const m = imageMap();
    if (!m) return;
    try {
      if (!m.hasGrid || m.kind !== "tileset" || !!m.freeMovement !== (modeV === "free")) {
        const gridPx = m.hasGrid && m.kind === "tileset" ? m.gridPixels : defaultGrid(m.pixelWidth, m.pixelHeight);
        if (!gridPx) throw new Error("A imagem é pequena ou estreita demais para posicionar personagens.");
        const updated = await api(`${base}/assets/maps/${m.id}`, "PUT", { name: m.name, folderId: m.folderId || null, gridPixels: gridPx, scaleMeters: Number(m.scaleMeters) || 1.5, revision: m.revision, hasGrid: true, gridOffsetX: m.gridOffsetX || 0, gridOffsetY: m.gridOffsetY || 0, freeMovement: modeV === "free" });
        Object.assign(m, updated);
        maps.items = (await api(`${base}/maps`, "GET", undefined, { background: true })).items;
      }
      commitTyping();
      draft.kind = "map";
      await loadLayer();
      resetHistory("Cena jogável. O histórico de desfazer recomeça a partir daqui.");
      say(modeV === "free" ? "Movimentação livre: posicione os personagens em qualquer ponto da imagem." : "Movimentação tática: ajuste a grade em Grade e escala, se precisar.");
    } catch (e) { error = e.message; }
    recomputeDirty(); renderAll(); renderPanels();
  }
  /** Novo mapa reutilizável com o fundo e as imagens visíveis aos jogadores (não altera esta cena nem o mapa original). */
  async function mapFromComposition() {
    if (!draft.composition || busy) return;
    const name = prompt("Nome do novo mapa (até 120 caracteres)", `${imageMap()?.name || "Mapa"} (composição)`);
    if (name == null || !name.trim()) return;
    try {
      say("Gerando o mapa…");
      const doc = { ...draft.composition, layers: draft.composition.layers.map((l) => ({ ...l, visible: !l.secret })), elements: draft.composition.elements.filter((e) => !e.secret).map((e) => ({ ...e, visible: true })) };
      const url = await flattenPreview(doc, imageCache);
      const blob = await (await fetch(url)).blob();
      URL.revokeObjectURL(url);
      if (blob.size > 10 * 1024 * 1024) throw new Error("O mapa gerado passa de 10 MB.");
      const m = imageMap();
      const fd = new FormData();
      fd.append("file", new File([blob], "composicao.png", { type: "image/png" }));
      fd.append("name", name.trim().slice(0, 120));
      fd.append("gridPixels", String(m.gridPixels || defaultGrid(m.pixelWidth, m.pixelHeight) || 64));
      fd.append("scaleMeters", String(Number(m.scaleMeters) || 1.5));
      fd.append("hasGrid", String(!!m.hasGrid));
      fd.append("gridOffsetX", String(m.gridOffsetX || 0)); fd.append("gridOffsetY", String(m.gridOffsetY || 0));
      fd.append("freeMovement", String(!!m.freeMovement));
      await api(`${base}/assets/maps`, "POST", fd, { background: true });
      maps.items = (await api(`${base}/maps`, "GET", undefined, { background: true })).items;
      renderAssets();
      say(`Mapa “${name.trim()}” criado em Preparação › Mapas. Esta cena continua como estava.`);
    } catch (e) { say(e.message); }
  }
  /** Abre o mapa original no editor de mapas (outra janela de edição) e volta a esta cena ao fechar. */
  async function openOriginalMap() {
    const m = mapOf(draft.mapKey);
    if (!m?.id) return say("Cenários prontos não são editados aqui; crie um mapa a partir do modelo em Preparação › Mapas.");
    if (sceneDirty || layerDirty) {
      if (!confirm("Salvar a preparação antes de abrir o mapa original?")) return;
      await save();
      if (sceneDirty || layerDirty || conflict || error) return;
    }
    if (!saved.id) return say("Salve a cena antes de abrir o mapa original.");
    reopen = { mapId: m.id, tiles: !!m.isTileMap };
    shell.close();
  }
  let reopen = null;

  // ---------- Menus de contexto ----------
  function onContext({ cell, token, x, y }) {
    const at = { x, y };
    if (simulate) return openContextMenu(at, [{ label: "Voltar à edição", run: () => toggleSimulate(false) }], { label: "Simulação" });
    if (cell) lastCell = cell;
    if (token) {
      const i = Number(token.id.slice(1)), tok = draft.prepared[i];
      if (tok && layerOfToken(tok)?.visible !== false) return tokenMenu(i, at);
    }
    void cellMenu(cell, at);
  }
  function tokenMenu(i, at) {
    const tok = draft.prepared[i];
    if (!tok) return;
    const l = layerOfToken(tok);
    if (l?.locked) return openContextMenu(at, [{ label: `Desbloquear a camada “${l.name}”`, run: () => layerAction("lock", l.id) }], { label: tok.label || "Marcador" });
    if (!selection.includes(i)) { selection = [i]; panel = "token"; refreshSelection(); }
    const ids = editableSelection();
    const allPc = ids.every((k) => draft.prepared[k].characterId);
    const own = ids.filter((k) => !draft.prepared[k].characterId);
    const PC_ONCE = "Personagens dos jogadores aparecem uma vez por cena.";
    openContextMenu(at, [
      { label: "Editar propriedades…", shortcut: "enter", run: () => openTokenProperties(i) },
      { label: "Duplicar", disabled: allPc, disabledReason: PC_ONCE, run: duplicate },
      { separator: true },
      { label: "Copiar", shortcut: "mod+c", disabled: allPc, disabledReason: PC_ONCE, run: copy },
      { label: "Recortar", shortcut: "mod+x", run: cut },
      { label: "Excluir", shortcut: "delete", danger: true, run: removeSelection },
      { separator: true },
      { label: own.length && own.every((k) => draft.prepared[k].hidden) ? "Mostrar aos jogadores" : "Ocultar dos jogadores", hint: "Oculto: só você vê até revelar", disabled: !own.length, disabledReason: PC_ONCE, run: toggleHidden },
      { label: "Mover para camada", items: tokenLayers().map((x) => ({ label: x.name, checked: x.id === l?.id, disabled: x.locked, disabledReason: "Camada bloqueada.", run: () => moveSelectionToLayer(x.id) })) },
      { label: "Selecionar camada", hint: l?.name || "", run: () => selectLayer(l?.id || "elements") },
    ], { label: tok.label || "Marcador" });
  }
  async function cellMenu(cell, at) {
    const items = [];
    const tactical = !!meta && mapKind();
    // Personagens do mestre chegam sob demanda: espera a lista antes de abrir, para o submenu não nascer desabilitado.
    if (cell && tactical && !mapOnly && npcs == null) { await loadNpcs(); if (closed) return; }
    if (cell && tactical && !mapOnly) {
      const placed = new Set(draft.prepared.map((t) => t.characterId).filter(Boolean));
      const pcs = characters.filter((c) => !placed.has(c.id)).map((c) => ({ label: c.name, run: () => placeRef(`pc:${c.id}`, cell) }));
      const masters = (npcs || []).filter((n) => !n.copy).map((n) => ({ label: n.name, hint: n.summary || "", run: () => placeRef(`npc:${n.id}`, cell) }));
      items.push(
        { label: "Colocar personagem de jogador aqui", items: pcs, disabled: !pcs.length, disabledReason: characters.length ? "Todos os personagens dos jogadores já estão na cena." : "Nenhum personagem de jogador vinculado à campanha ainda." },
        { label: "Colocar personagem do mestre aqui", items: masters, disabled: !masters.length, disabledReason: "Crie personagens do mestre na Preparação (pasta Personagens)." },
        { label: "Adicionar marcador aqui", hint: "Criatura, aliado ou objeto", run: () => { pick = cell; selection = []; panel = "add"; renderSide(); showProps(); focusFirst(); } },
        { label: "Colar aqui", shortcut: "mod+v", disabled: !clipboard.length, disabledReason: "Copie ou recorte um marcador antes.", run: () => paste(cell) },
      );
    } else if (!mapOnly && draft.kind !== "text") {
      // Sem mapa tático não há casas para posicionar personagens: explica e leva direto à troca do tipo de cena.
      const why = !mapKind() ? "Personagens e marcadores entram em cenas de mapa tático." : "Escolha um cenário com grade para posicionar personagens.";
      items.push(
        { label: "Colocar personagem aqui", disabled: true, disabledReason: why, run: () => {} },
        { label: mapKind() ? "Escolher mapa tático…" : "Usar mapa tático nesta cena…", run: () => openPanel("scenery") },
      );
    }
    if (cell && tactical && mode === "complete") {
      const locked = layerLocked() ? "Salve o alcance da preparação antes de editar o mapa." : null;
      items.push({ separator: true },
        { label: "Foco de luz aqui", disabled: !!locked, disabledReason: locked, run: () => { pick = cell; panel = "light"; renderSide(); showProps(); focusFirst(); } },
        { label: "Marca oculta aqui", disabled: !!locked, disabledReason: locked, run: () => { pick = cell; panel = "mark"; renderSide(); showProps(); focusFirst(); } });
    }
    if (cell && tactical && manual() && !layerLocked()) {
      items.push({ separator: true },
        { label: "Revelar esta casa", run: () => paintCells("reveal", [cell]) },
        { label: "Cobrir esta casa", run: () => paintCells("conceal", [cell]) });
    }
    if (mode === "complete" && mapKind()) {
      items.push({ separator: true }, { label: "Ajustar grade…", disabled: !!toolProblem("gridAdjust"), disabledReason: toolProblem("gridAdjust"), run: () => openPanel("gridAdjust") });
    }
    if (mode === "complete" && !mapOnly) items.push({ label: "Configurações da cena", run: () => openPanel("sceneSettings") });
    if (!items.filter((x) => !x.separator).length) items.push({ label: "Escolher cenário", disabled: mapOnly, run: () => openPanel("scenery") });
    openContextMenu(at, items.filter((x, k, all) => !(x.separator && (k === 0 || all[k - 1].separator))), { label: cell ? `Casa ${cell.x + 1}, ${cell.y + 1}` : "Cena" });
  }

  // ---------- Menus do topo ----------
  function menus() {
    const zoom = (fn) => () => { fn(); shell.updateZoom(); };
    const presenting = !!live?.current && !!saved.id;
    return [
      { id: "file", label: "Arquivo", items: () => {
        const dirty = sceneDirty || layerDirty;
        return [
          { label: "Salvar preparação", shortcut: "mod+s", disabled: busy, disabledReason: "Salvando…", run: save },
          { label: "Ver como jogador", checked: simulate, disabled: !mapKind() || !meta, disabledReason: "A simulação vale para mapas táticos.", run: () => toggleSimulate() },
          ...(presenting ? [{ separator: true },
            { label: "Aplicar à cena atual…", disabled: dirty, disabledReason: "Salve a preparação antes de aplicar.", run: () => { applying = true; renderSide(); showProps(); } },
            { label: "Recolocar personagens nas posições preparadas…", disabled: dirty || !mapKind(), disabledReason: dirty ? "Salve a preparação antes." : "Vale para cenas jogáveis.", run: () => { applying = "reposition"; loadReposition(); } },
            { label: "Reiniciar cena…", danger: true, disabled: dirty, disabledReason: "Salve a preparação antes de reiniciar a cena.", run: () => { applying = "restart"; renderSide(); showProps(); } }] : []),
          { separator: true },
          ...(drafts?.menuItems() || []),
          { label: "Fechar", run: () => shell.requestClose() },
        ];
      } },
      { id: "edit", label: "Editar", items: () => {
        const sel = editableSelection().length;
        const none = "Selecione um marcador antes.";
        return [
          { label: history.canUndo ? `Desfazer: ${history.undoLabel}` : "Desfazer", shortcut: "mod+z", disabled: !history.canUndo, run: undo },
          { label: history.canRedo ? `Refazer: ${history.redoLabel}` : "Refazer", shortcut: "mod+shift+z", disabled: !history.canRedo, run: redo },
          { separator: true },
          { label: "Copiar", shortcut: "mod+c", disabled: !sel, disabledReason: none, run: copy },
          { label: "Recortar", shortcut: "mod+x", disabled: !sel, disabledReason: none, run: cut },
          { label: "Colar", shortcut: "mod+v", disabled: !clipboard.length, disabledReason: "Copie ou recorte um marcador antes.", run: () => paste() },
          { label: "Duplicar", disabled: !sel, disabledReason: none, run: duplicate },
          { label: "Excluir", shortcut: "delete", danger: true, disabled: !sel, disabledReason: none, run: removeSelection },
          { separator: true },
          { label: "Selecionar tudo", shortcut: "mod+a", disabled: !draft.prepared.length, disabledReason: "Nenhum marcador na cena.", run: selectAll },
          { label: "Desmarcar", shortcut: "mod+d", disabled: !selection.length, disabledReason: "Nada selecionado.", run: deselect },
        ];
      } },
      mapOnly ? { id: "map", label: "Mapa", items: () => [
        { label: "Névoa neste mapa", disabled: mode !== "complete" || !!toolProblem("fogState"), disabledReason: toolProblem("fogState") || "Disponível na interface Completa.", run: () => openPanel("fogState") },
        { label: "Recomeçar exploração", disabled: mode !== "complete" || !!toolProblem("resetExploration"), disabledReason: toolProblem("resetExploration") || "Disponível na interface Completa.", run: () => openPanel("resetExploration") },
        { label: "Ajustar grade…", disabled: mode !== "complete" || !!toolProblem("gridAdjust"), disabledReason: toolProblem("gridAdjust") || "Disponível na interface Completa.", run: () => openPanel("gridAdjust") },
      ] } : { id: "scene", label: "Cena", items: () => [
        { label: "Editar a composição (imagens desta cena)", disabled: draft.kind === "text", disabledReason: "Cenas textuais não têm imagem.", run: () => shell.setContext("compose") },
        { label: "Adicionar imagem…", shortcut: "u", disabled: draft.kind === "text", disabledReason: "Cenas textuais não têm imagem.", run: () => pickImages() },
        { label: "Abrir o mapa original…", disabled: !mapOf(draft.mapKey)?.id, disabledReason: "Cenários prontos não são editados aqui.", run: () => openOriginalMap() },
        { label: "Criar mapa a partir da composição…", disabled: !compElements(), disabledReason: "Adicione imagens à composição antes.", run: () => mapFromComposition() },
        { label: "Tornar a imagem jogável…", disabled: !(draft.kind === "image" && imageMap()), disabledReason: "Vale para cenas de imagem da campanha sem personagens.", run: () => { startChoice = { playable: true }; renderSide(); showProps(); } },
        { label: "Área de entrada e posições iniciais", disabled: !mapKind() || !meta, disabledReason: "Vale para cenas jogáveis.", run: () => { shell.setContext("elements"); shell.togglePanel("characters", true); } },
        { separator: true },
        { label: "Selecionar outro mapa…", run: () => openPanel("scenery") },
        { label: "Texto compartilhável", run: () => openPanel("text") },
        { label: "Notas privadas", run: () => openPanel("notes") },
        { label: "Visibilidade", disabled: !mapKind(), disabledReason: "A visibilidade vale para mapas táticos.", run: () => openPanel("visibility") },
        { label: "Configurações da cena", disabled: mode !== "complete", disabledReason: "Disponível na interface Completa.", run: () => openPanel("sceneSettings") },
      ] },
      !mapOnly && { id: "layer", label: "Camada", items: () => {
        const off = !mapKind() ? "Camadas organizam marcadores de mapas táticos." : null;
        const isBase = activeLayer === "base";
        return [
          { label: "Nova camada", disabled: !!off, disabledReason: off, run: () => layerAction("add", activeLayer) },
          { label: "Duplicar camada", disabled: !!off || isBase, disabledReason: off || BASE_ONLY, run: () => layerAction("duplicate", activeLayer) },
          { label: "Excluir camada", danger: true, disabled: !!off || isRequiredLayer(activeLayer), disabledReason: off || "Base e Elementos são obrigatórias.", run: () => layerAction("delete", activeLayer) },
          { separator: true },
          { label: "Subir", disabled: !!off || isRequiredLayer(activeLayer), disabledReason: off || "Reordene as camadas extras.", run: () => layerAction("up", activeLayer) },
          { label: "Descer", disabled: !!off || isRequiredLayer(activeLayer), disabledReason: off || "Reordene as camadas extras.", run: () => layerAction("down", activeLayer) },
          { label: "Renomear…", disabled: !!off || isBase, disabledReason: off || BASE_ONLY, run: renameActiveLayer },
          { separator: true },
          { label: "Mover seleção para", disabled: !!off || !editableSelection().length, disabledReason: off || "Selecione marcadores antes.", items: tokenLayers().map((x) => ({ label: x.name, disabled: x.locked, disabledReason: "Camada bloqueada.", run: () => moveSelectionToLayer(x.id) })) },
        ];
      } },
      { id: "view", label: "Exibir", items: () => [
        { label: "Aproximar", shortcut: "mod+plus", run: zoom(() => board.camera.zoomIn()) },
        { label: "Afastar", shortcut: "mod+minus", run: zoom(() => board.camera.zoomOut()) },
        { label: "Ajustar à tela", shortcut: "mod+0", run: zoom(() => board.camera.fit()) },
        { label: "Tamanho real (100%)", shortcut: "mod+1", run: zoom(() => board.camera.actual(natural())) },
        { separator: true },
        { label: "Mostrar grade", checked: grid, disabled: !mapKind(), disabledReason: "A grade vale para mapas táticos.", run: () => { grid = !grid; redraw(); shell.refreshTools(); } },
        shell.rulersMenuItem(),
        { label: "Painéis", checked: root.dataset.panels === "open", run: () => shell.setPanels(root.dataset.panels !== "open") },
        { label: "Tela cheia", checked: document.fullscreenElement === shell.dialog, run: () => q('[data-ed="fullscreen"]')?.click() },
      ] },
    ].filter(Boolean);
  }

  // ---------- Painéis à direita ----------
  function showProps() { shell.setPanels(true); shell.togglePanel("props", true); }
  function focusFirst() { setTimeout(() => shell.panel("props")?.querySelector("input:not([type=hidden]):not(:disabled), select, textarea")?.focus(), 0); }
  function openPanel(id) {
    panel = id; pick = null; selection = []; simulate = false; applying = false;
    renderAll(); showProps();
  }
  function renderLayers() {
    const host = shell.panel("layers");
    if (!host) return;
    if (shell.context === "compose" && composable()) return renderCompLayers(host);
    if (!mapKind()) { host.innerHTML = '<p class="muted small se-empty-note">Camadas organizam marcadores de cenas com mapa tático.</p>'; host.onclick = host.ondblclick = host.onchange = null; return; }
    const mapName = meta?.name || mapOf(draft.mapKey)?.name || "sem cenário";
    // A Base é a referência do mapa (somente leitura): aparece com o nome do mapa e travada.
    const display = draft.layers.map((l) => (l.id === "base" ? { ...l, name: `Mapa: ${mapName}`, locked: true, visible: true, opacity: 100 } : l));
    renderLayersPanel(host, { layers: display, active: activeLayer, complete: mode === "complete", selectionCount: editableSelection().length, lockedNote: "no-base", visibilityNote: LAYER_NOTE, onAction: layerAction });
    host.insertAdjacentHTML("beforeend", `<p class="form-help">Novos marcadores entram na camada ativa (a Base envia para Elementos).</p><p class="se-layer-help">Camadas da cena${helpButton("campanhas.cenas.camadas", "Camadas da cena")} · Controles de camada${helpButton("campanhas.editor.camadas", "Camadas do editor")}</p>`);
  }
  function renderStructure() {
    const host = shell.panel("structure");
    if (!host) return;
    if (!mapKind() || !meta) { host.innerHTML = '<p class="muted small se-empty-note">A estrutura lista marcadores e a preparação de mapas táticos.</p>'; host.onclick = host.oncontextmenu = host.onkeydown = null; return; }
    let groups = structureGroups({ tokens: draft.prepared, layers: draft.layers, selected: selection, layer, technical: mode === "complete", kinds: MARK_KINDS });
    if (mapOnly) groups = groups.filter((g) => ["lights", "marks", "doors"].includes(g.id));
    renderStructurePanel(host, {
      groups, empty: mapOnly ? "Nada preparado neste mapa ainda." : "Nenhum marcador nesta cena ainda.",
      onSelect: (id, additive) => structureSelect(id, additive),
      onContext: (id, at) => { if (id.startsWith("t")) tokenMenu(Number(id.slice(1)), at); },
    });
  }
  function structureSelect(id, additive) {
    if (simulate) return;
    if (/^t\d+$/.test(id)) {
      const i = Number(id.slice(1)), tok = draft.prepared[i];
      if (!tok) return;
      if (!editable(i)) return say(`“${tok.label}” está numa camada oculta ou bloqueada.`);
      selection = additive ? (selection.includes(i) ? selection.filter((x) => x !== i) : [...selection, i]) : [i];
      lastCell = { x: tok.x, y: tok.y };
      panel = selection.length ? "token" : "overview";
      refreshSelection();
      return say(`${tok.label}: coluna ${tok.x + 1}, linha ${tok.y + 1}.`);
    }
    const [kindOf, x, y] = id.split(":");
    const cell = { x: Number(x), y: Number(y) };
    lastCell = cell;
    if (kindOf === "light" || kindOf === "mark") { pick = cell; panel = kindOf; selection = []; renderSide(); showProps(); return say(`Coluna ${cell.x + 1}, linha ${cell.y + 1}.`); }
    if (kindOf === "door") say(`Porta na coluna ${cell.x + 1}, linha ${cell.y + 1}. Use “Abrir ou fechar porta” (O) para alternar.`);
  }
  function renderCharacters() {
    const host = shell.panel("characters");
    if (!host) return;
    if (!mapKind() || !meta) {
      host.innerHTML = `<p class="muted small se-empty-note">Personagens entram em cenas jogáveis (movimentação livre ou tática).${draft.kind === "image" && imageMap() ? "" : " Escolha um cenário com grade."}</p>${draft.kind === "image" && imageMap() ? button("Tornar esta imagem jogável…", "se-playable", "", "subtle small") : ""}`;
      return;
    }
    if (!host.querySelector("[data-se-char-search]")) {
      host.innerHTML = `<div class="field se-char-search"><label for="se-char-q">Buscar personagem</label><input id="se-char-q" type="search" data-se-char-search maxlength="60" autocomplete="off" placeholder="Nome"></div><div data-se-char-list></div><p class="form-help">Arraste para o mapa (arrastar de novo move o mesmo marcador) ou use “Colocar no cursor”. As posições ficam na preparação da cena e valem ao apresentá-la pela primeira vez ou ao reiniciá-la.</p>`;
    }
    renderCharacterList();
  }
  function renderCharacterList() {
    const host = shell.panel("characters");
    const list = host?.querySelector("[data-se-char-list]");
    if (!list) return;
    const query = plain(host.querySelector("[data-se-char-search]")?.value);
    const match = (s) => !query || plain(s).includes(query);
    const pos = new Map(draft.prepared.map((t, i) => [t.characterId, i]).filter(([id]) => id));
    // Todos os personagens dos jogadores: posicionados (arrastar move o mesmo marcador) e sem posição (entram pela área de entrada).
    const pcs = characters.filter((c) => match(c.name));
    const masters = (npcs || []).filter((n) => !n.copy && match(`${n.name} ${n.summary || ""}`));
    const area = sceneEntryArea(draft.entry, mapEntries);
    const item = (ref, name, sub, placedAt = -1) => `<li class="se-char${placedAt >= 0 ? " placed" : ""}" draggable="true" data-se-char="${esc(ref)}"><span>${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><span class="se-char-actions">${placedAt >= 0 ? `${button(`Mostrar<span class="sr-only"> ${esc(name)}</span>`, "se-char-show", String(placedAt), "subtle small")}${button(`Remover posição<span class="sr-only"> de ${esc(name)}</span>`, "se-char-unplace", String(placedAt), "text-button small")}` : button(`Colocar <span class="sr-only">${esc(name)} </span>no cursor`, "se-place-cursor", ref, "subtle small")}</span></li>`;
    const where = (i) => { const t = draft.prepared[i]; return `Posicionado · coluna ${t.x + 1}, linha ${t.y + 1}${t.hidden ? " · oculto" : ""}`; };
    const unplaced = area ? "Sem posição: entra pela área de entrada" : "Sem posição: entra pelo ponto padrão do mapa";
    const missing = characters.filter((c) => !pos.has(c.id)).length;
    list.innerHTML = `<h4 class="se-char-head">Personagens dos jogadores</h4>${pcs.length ? `<ul class="se-pick-list">${pcs.map((c) => item(`pc:${c.id}`, c.name, pos.has(c.id) ? where(pos.get(c.id)) : unplaced, pos.has(c.id) ? pos.get(c.id) : -1)).join("")}</ul>` : `<p class="muted small">${query ? "Nenhum resultado." : "Nenhum personagem vinculado à campanha ainda."}</p>`}
      <h4 class="se-char-head">Personagens do mestre</h4>${npcs == null ? '<p class="loading-line" role="status">Carregando…</p>' : masters.length ? `<ul class="se-pick-list">${masters.map((n) => item(`npc:${n.id}`, n.name, n.summary || "")).join("")}</ul><p class="form-help">Marque “Oculto” no marcador para preparar NPCs e emboscadas que só você vê.</p>` : `<p class="muted small">${query ? "Nenhum resultado." : "Crie personagens do mestre na Preparação (pasta Personagens)."}</p>`}
      ${entrySection(area, missing)}`;
  }
  /** Área de entrada da cena: escolha entre os pontos do mapa, área própria e distribuição automática do grupo. */
  function entrySection(area, missing) {
    const value = draft.entry?.ref ? `ref:${draft.entry.ref}` : draft.entry ? "scene" : "";
    const source = !area ? "Nenhuma: personagens sem posição usam a regra antiga (primeira linha livre do mapa)." : area.source === "scene" ? `Área própria desta cena · ${area.rect.w} × ${area.rect.h} casas a partir da coluna ${area.rect.x + 1}, linha ${area.rect.y + 1}.` : area.source === "map-ref" ? `Ponto do mapa “${area.entry.name}” (${area.rect.w} × ${area.rect.h} casas).` : `Entrada do grupo do mapa “${area.entry.name}” (padrão).`;
    const options = [["", "Automática (entrada do grupo do mapa)"], ...mapEntries.map((e) => [`ref:${e.id}`, `Ponto do mapa: ${e.name}`]), ...(draft.entry && !draft.entry.ref ? [["scene", "Área própria desta cena"]] : [])];
    return `<section class="se-entry" aria-labelledby="se-entry-h"><h4 class="se-char-head" id="se-entry-h">Área de entrada${helpButton("campanhas.cenas.posicoes", "Posições iniciais e área de entrada")}</h4>
      <div class="field"><label for="se-entry">Onde o grupo chega</label><select id="se-entry" data-se-entry>${opt(options, value)}</select></div>
      <p class="form-help">${esc(source)} Prioridade: posição preparada na cena › área de entrada da cena › entrada do mapa › regra automática.</p>
      <div class="form-actions">${button("Desenhar área da cena", "se-tool", "entry", "subtle small")}${draft.entry ? button("Usar a entrada do mapa", "se-entry-clear", "", "text-button small") : ""}${button(`Distribuir grupo na área inicial${missing ? ` (${missing})` : ""}`, "se-distribute", "", "subtle small", area && missing ? "" : `aria-disabled="true" data-tip="${esc(!area ? "Defina uma área de entrada antes." : "Todos os personagens já têm posição.")}"`)}</div></section>`;
  }
  /** Coloca os personagens sem posição na área de entrada, sem colisões, sem mexer nas posições fixadas manualmente. */
  function distributeParty() {
    const area = sceneEntryArea(draft.entry, mapEntries);
    if (!area) return say("Defina uma área de entrada (Desenhar área da cena) ou escolha um ponto do mapa.");
    const result = distributeInArea({ cells: layer?.cells, width: width(), height: height(), tokens: draft.prepared, area: area.rect, characters, free: freeOn(), layer: activeTokenLayer() });
    if (!result.placed.length) return say(result.missing.length ? "Não há espaço livre na área de entrada: aumente a área ou libere casas." : "Todos os personagens já têm posição.");
    change("Distribuir grupo na área inicial", () => { draft.prepared = result.tokens; });
    refresh();
    say(result.missing.length ? `${result.placed.length} posicionado(s); ${result.missing.length} sem espaço na área (entram pela regra automática ao apresentar).` : `${result.placed.length} personagem(ns) distribuído(s) na área de entrada. Ajuste à vontade.`);
  }
  function renderHistory() {
    const host = shell.panel("history");
    if (host) renderHistoryPanel(host, history);
  }
  const renderPanels = () => { renderLayers(); renderStructure(); renderCharacters(); renderHistory(); if (!mapOnly) renderAssets(); };

  // ---------- Renderização ----------
  function renderStatus() {
    const presenting = live?.current;
    const pendingLive = presenting && (live.textPending || live.mapPending || meta?.pending);
    const dirty = sceneDirty || layerDirty;
    shell.setStatus({
      size: meta && mapKind() ? `${width()} × ${height()} casas` : "",
      state: [
        presenting ? '<span class="ed-chip live">● Em apresentação — os jogadores estão vendo esta cena.</span>' : '<span class="ed-chip private">Prévia privada — somente você vê.</span>',
        busy ? '<span class="ed-chip">Salvando…</span>' : dirty ? '<span class="ed-chip dirty">Alterações não salvas</span>' : saved.id || mapOnly ? '<span class="ed-chip ok">Preparação salva</span>' : "",
        pendingLive && !dirty ? '<span class="ed-chip pending">Alterações não aplicadas à mesa.</span>' : "",
        !presenting && meta?.inUse ? '<span class="ed-chip pending">Este mapa está na mesa: salvar guarda a preparação sem mudar a partida.</span>' : "",
        composing() ? '<span class="ed-chip private">Composição: alterando só esta cena</span>' : "",
        mapOnly && meta ? '<span class="ed-chip pending">Preparação do mapa: vale para as cenas que o compartilham</span>' : "",
      ].join(""),
    });
    q("#se-apply-slot").innerHTML = presenting && saved.id && (pendingLive || mapKind()) ? button(pendingLive ? "Aplicar à cena atual…" : "Aplicar preparação à cena atual…", "se-apply", "", "subtle", dirty ? 'aria-disabled="true" data-tip="Salve a preparação antes de aplicar."' : "") : "";
    const previewBtn = q("[data-action=se-preview]");
    previewBtn.setAttribute("aria-pressed", String(simulate));
    previewBtn.innerHTML = simulate ? "← Voltar à edição" : `${icon("eye")}<span>Ver como jogador</span>`;
    previewBtn.disabled = !mapKind() || !meta;
    q("[data-action=se-save]").disabled = busy || (!dirty && !!(saved.id || mapOnly));
  }
  function renderStage() {
    const text = q("#se-text"), start = q("#se-start"), comp = q("#se-compose");
    const showText = draft.kind === "text";
    // Cena sem fundo: o palco inteiro aceita imagens soltas; as opções aparecem no centro (ADR-090).
    const showStart = !showText && !draft.mapKey && !mapOnly;
    const showComp = !showText && !showStart && composing() && !simulate;
    text.hidden = !showText;
    start.hidden = !showStart;
    comp.hidden = !showComp;
    boardHost.hidden = showText || showStart || showComp;
    if (showText) text.innerHTML = `<article class="se-text-card"><span class="eyebrow">Apresentação textual</span><h3>${esc(draft.name || "Cena sem nome")}</h3><p>${esc(draft.sharedText || "Escreva o texto compartilhável em Cena › Texto compartilhável.")}</p></article>`;
    if (showStart && !start.querySelector(".se-start-card")) start.innerHTML = `<div class="se-start-card" role="region" aria-labelledby="se-start-h"><h3 id="se-start-h">Como deseja começar?</h3><p>Arraste uma imagem para qualquer ponto desta área ou escolha uma opção.</p><div class="se-start-grid">
      <button type="button" class="se-start-option primary" data-action="se-start" data-id="upload">${icon("image")}<strong>Enviar imagem do computador</strong><small>PNG ou JPEG até 10 MB; várias de uma vez</small></button>
      <button type="button" class="se-start-option" data-action="se-start" data-id="map">${icon("scenery")}<strong>Escolher um mapa existente</strong><small>Mapas e imagens da campanha</small></button>
      <button type="button" class="se-start-option" data-action="se-start" data-id="model">${icon("layers")}<strong>Usar um modelo</strong><small>Cenários prontos do Eternnus</small></button>
      <button type="button" class="se-start-option" data-action="se-start" data-id="blank">${icon("rect")}<strong>Começar com uma área em branco</strong><small>Fundo liso para compor com imagens</small></button>
    </div><p class="form-help">Também dá para colar uma imagem (Ctrl+V) ou arrastar do painel Acervo. Nada é mostrado aos jogadores até você apresentar a cena.</p></div>`;
    if (showComp) { mountComposer(); composer.invalidate(); }
    renderSimBanner();
    const hint = simulate || showComp ? "" : PAINT.has(tool) || tool === "entry" ? `${helpOf(tool) || labelOf(tool)} Teclado: setas e Enter.` : helpOf(tool);
    const hintEl = q("#se-hint");
    hintEl.textContent = showText || showStart ? "" : hint;
    hintEl.hidden = showText || showStart || !hint;
    if (!showComp) redraw();
  }
  /** Simulação: escolher de quem é a visão (personagens posicionados). Sem personagem, só luz comum e revelações. */
  function renderSimBanner() {
    const banner = q("#se-sim");
    banner.hidden = !simulate;
    if (!simulate) { banner.innerHTML = ""; return; }
    const placed = draft.prepared.filter((t) => t.characterId);
    if (viewer && !placed.some((t) => t.characterId === viewer)) viewer = "";
    const options = [`<option value="">Só luz comum e áreas reveladas</option>`, placed.length ? `<option value="party"${viewer === "party" ? " selected" : ""}>Grupo (todos os jogadores juntos)</option>` : "", ...placed.map((t) => `<option value="${esc(t.characterId)}"${t.characterId === viewer ? " selected" : ""}>${esc(t.label || "Personagem")}</option>`)].join("");
    const status = serverViewError ? `<span class="se-sim-status" role="alert">Prévia do servidor indisponível: ${esc(serverViewError)} Mostrando a simulação local (sem sentidos, percepção e exploração).</span>`
      : serverView ? `<span class="se-sim-status">Prévia real: mesmas regras da mesa (paredes, luz, visão, sentidos, percepção e áreas já exploradas).</span>`
      : `<span class="se-sim-status" role="status">Calculando a prévia real…</span>`;
    banner.innerHTML = `<p>${esc(HELP.preview)}${helpButton("campanhas.cenas.simulacao", "Simulação de visão")}</p>${placed.length && mapKind() ? `<label class="se-sim-viewer"><span>Visão de</span><select id="se-viewer" name="se-viewer">${options}</select></label>` : ""}<p class="small">${status}</p>`;
  }

  function sidePanel() {
    if (error) return `<div class="se-panel"><p class="form-error" role="alert">${esc(error)}</p>${button("Entendi", "se-dismiss", "", "subtle")}</div>`;
    if (conflict) return `<div class="se-panel se-conflict" role="alert"><h3>Outra tela salvou antes</h3><p>${esc(conflict)}</p><p class="form-help">Suas alterações continuam aqui. Recarregar guarda este rascunho no navegador (Arquivo › Rascunho local…); "Salvar como nova cena" grava a cena numa cópia, sem tocar na outra.</p><div class="form-actions">${button("Continuar editando", "se-dismiss", "", "subtle")}${!mapOnly && saved.id ? button("Salvar como nova cena", "se-save-copy", "", "subtle") : ""}${button("Recarregar a versão salva", "se-reload", "", "danger")}</div></div>`;
    if (startChoice && !startChoice.pick) return startPanel();
    if (applying === "reposition") return repositionPanel();
    if (applying) return applyPanel();
    if (shell.context === "compose" && !mapOnly && draft.kind !== "text") return composePanel();
    if (panel === "entries" || (tool === "entry" && panel === "overview" && meta)) return entriesPanel();
    if (panel === "token" && selection.length > 1) return multiPanel();
    if (panel === "token" && selection.length === 1 && draft.prepared[selection[0]]) return tokenPanel(draft.prepared[selection[0]]);
    if (panel === "add" && pick) return addPanel();
    if (panel === "light" && pick && layer) return lightPanel();
    if (panel === "mark" && pick && layer) return markPanel();
    if (panel === "scenery") return sceneryPanel();
    if (panel === "visibility") return visibilityPanel();
    if (panel === "text") return `<div class="se-panel"><h3>Texto compartilhável${helpButton("campanhas.cenas.preparacao", "Preparar e apresentar")}</h3><p class="form-help">${esc(HELP.text)}</p><label class="sr-only" for="se-shared">Texto compartilhável</label><textarea id="se-shared" data-draft="sharedText" maxlength="2000" rows="8" placeholder="O que o grupo vê ao chegar">${esc(draft.sharedText)}</textarea></div>`;
    if (panel === "notes") return `<div class="se-panel"><h3>Notas privadas</h3><p class="form-help">${esc(HELP.notes)}</p><label class="sr-only" for="se-notes">Notas privadas</label><textarea id="se-notes" data-draft="privateNotes" maxlength="4000" rows="8">${esc(draft.privateNotes)}</textarea></div>`;
    if (panel === "sceneSettings") return settingsPanel();
    if (panel === "fogState") return fogPanel();
    if (panel === "walls" || ((tool === "vwall" || tool === "vedit") && panel === "overview" && meta)) return wallPanel();
    if (panel === "diagnostic" || (diag && panel === "overview" && meta)) return diagnosticPanel();
    if (panel === "resetExploration") return `<div class="se-panel"><h3>Recomeçar exploração</h3><p class="form-help">Ao salvar, apaga o que os jogadores já exploraram neste mapa e quem percebeu cada marca. Paredes, portas e luzes ficam.${meta?.inUse ? " Este mapa está na mesa agora: use “Reiniciar cena” ou “Recomeçar exploração” na mesa." : ""}</p><label class="check"><input type="checkbox" data-reset ${resetExploration ? "checked" : ""} ${meta?.inUse ? "disabled" : ""}> Recomeçar exploração ao salvar</label></div>`;
    if (panel === "gridAdjust") return gridPanel();
    if (panel === "hidden") return hiddenPanel();
    return overviewPanel();
  }
  function overviewPanel() {
    const m = mapOf(draft.mapKey);
    return `<div class="se-panel"><h3>${esc(labelOf(tool))}${helpButton("mesa.nevoa.ferramentas", "Ferramentas de névoa")}</h3><p class="form-help">${esc(helpOf(tool) || "Escolha uma ferramenta à esquerda.")}</p><dl class="se-summary"><div><dt>Tipo</dt><dd>${esc(sceneKindLabel(draft.kind))}</dd></div>${draft.kind !== "text" ? `<div><dt>Cenário</dt><dd>${m ? `${esc(m.name)} <small>${esc(mapTypeLabel(m))}</small>` : "Nenhum escolhido"}</dd></div>` : ""}${mapKind() ? `<div><dt>Marcadores preparados</dt><dd>${draft.prepared.length}</dd></div><div><dt>Visibilidade</dt><dd>${esc((VISIBILITY_OPTIONS.find((v) => v[0] === (draft.visionMode || "")) || VISIBILITY_OPTIONS[0])[1])}</dd></div>` : ""}${meta && meta.mode === "map" && meta.sharedWith?.length ? `<div><dt>Preparação do mapa</dt><dd>Compartilhada com: ${meta.sharedWith.map((s) => esc(s.name)).join(", ")}</dd></div>` : meta?.mode === "scene" ? `<div><dt>Preparação do mapa</dt><dd>Própria desta cena</dd></div>` : ""}</dl><p class="form-help">Clique com o botão direito (ou Shift+F10) no mapa para ver as ações da casa ou do marcador.</p></div>`;
  }
  function tokenPanel(t) {
    const isCharacter = !!t.characterId;
    const layerSelect = `<div class="field"><label for="se-t-layer">Camada</label><select id="se-t-layer" data-token="layer">${opt(tokenLayers().map((l) => [l.id, l.name]), tokenLayerOf(t.layer, draft.layers))}</select></div>`;
    return `<form class="se-panel" data-token-form><h3>${esc(t.label || "Marcador")}</h3><p class="form-help">Coluna ${t.x + 1}, linha ${t.y + 1}. Para mover, clique numa casa livre, arraste ou use as setas com o mapa em foco.</p>${isCharacter ? '<p class="small">Personagem dos jogadores: entra nesta casa quando a cena for apresentada, se a pessoa estiver na mesa.</p>' : `<div class="field"><label for="se-t-label">Nome</label><input id="se-t-label" data-token="label" maxlength="40" required value="${esc(t.label)}"></div><div class="field"><label for="se-t-side">Lado</label><select id="se-t-side" data-token="side">${opt(SIDES, t.side || "enemy")}</select></div><label class="check"><input type="checkbox" data-token="hidden" ${t.hidden ? "checked" : ""}> Oculto: só você vê até revelar</label>${mode === "complete" ? `<div class="field"><label for="se-t-light">Luz que carrega (casas)</label><input id="se-t-light" data-token="light" type="number" min="0" max="30" value="${t.light ?? ""}" placeholder="Padrão da mesa"></div>` : ""}`}${layerSelect}<div class="form-actions se-danger-zone">${button("Mais propriedades…", "se-token-props", "", "subtle")}${button("Remover da cena", "se-token-remove", "", "text-button")}</div></form>`;
  }
  function multiPanel() {
    const ids = editableSelection();
    const own = ids.filter((i) => !draft.prepared[i].characterId);
    const show = own.length && own.every((i) => draft.prepared[i].hidden);
    return `<div class="se-panel"><h3>${ids.length} marcadores selecionados</h3><p class="form-help">Ctrl ou Shift + clique soma ou retira da seleção. Arraste um deles ou use as setas (com o mapa em foco) para mover o grupo.</p><div class="form-actions">${own.length ? button(show ? "Mostrar aos jogadores" : "Ocultar dos jogadores", "se-sel-hide", "", "subtle") : ""}${own.length ? button("Duplicar", "se-sel-dup", "", "subtle") : ""}${button("Remover da cena", "se-token-remove", "", "text-button")}</div></div>`;
  }
  function addPanel() {
    const placed = new Set(draft.prepared.map((t) => t.characterId).filter(Boolean));
    const free = characters.filter((c) => !placed.has(c.id));
    const npcList = (npcs || []).filter((n) => !n.copy);
    return `<div class="se-panel"><h3>Adicionar na casa ${pick.x + 1}, ${pick.y + 1}</h3><form data-add-marker class="se-subform"><h4>Marcador</h4><div class="field"><label for="se-a-label">Nome</label><input id="se-a-label" name="label" maxlength="40" required placeholder="Guarda da ponte"></div><div class="field"><label for="se-a-side">Lado</label><select id="se-a-side" name="side">${opt(SIDES, "enemy")}</select></div><label class="check"><input type="checkbox" name="hidden"> Oculto: só você vê até revelar</label><button type="submit" class="primary">Adicionar marcador</button></form>
      <section class="se-subform"><h4>Personagem dos jogadores</h4>${free.length ? `<ul class="se-pick-list">${free.map((c) => `<li><span>${esc(c.name)}</span>${button("Colocar aqui", "se-add-character", c.id, "subtle small")}</li>`).join("")}</ul>` : `<p class="muted small">${characters.length ? "Todos os personagens da campanha já estão na cena." : "Nenhum personagem vinculado à campanha ainda."}</p>`}</section>
      <section class="se-subform"><h4>Personagem do mestre</h4>${npcs == null ? '<p class="loading-line" role="status">Carregando…</p>' : npcList.length ? `<ul class="se-pick-list">${npcList.map((n) => `<li><span>${esc(n.name)}<small>${esc(n.summary || "")}</small></span>${button("Colocar aqui", "se-add-npc", n.id, "subtle small")}</li>`).join("")}</ul><p class="form-help">Na mesa, “Cópia para o encontro” ajusta recursos sem alterar o original.</p>` : '<p class="muted small">Crie personagens do mestre na Preparação (pasta Personagens).</p>'}</section></div>`;
  }
  function lightPanel() {
    const light = layer.lights.find((l) => l.x === pick.x && l.y === pick.y);
    const advanced = mode === "complete" ? `<div class="field"><label for="se-dim">Penumbra até (casas)</label><input id="se-dim" name="dim" type="number" min="1" max="30" value="${light?.dim ?? ""}" placeholder="Sem penumbra"><p class="form-help">A luz cai aos poucos entre o raio e a penumbra. A penumbra também ilumina para as regras.</p></div><div class="field"><label for="se-color">Cor</label><input id="se-color" name="color" type="color" value="${esc(light?.color || "#ffbe64")}"></div><div class="field"><label for="se-intensity">Intensidade (10 a 100)</label><input id="se-intensity" name="intensity" type="number" min="10" max="100" value="${light?.intensity ?? 100}"></div><div class="field"><label for="se-anim">Animação</label><select id="se-anim" name="animation">${opt([["", "Fixa"], ["flicker", "Tremeluzir (tocha)"], ["pulse", "Pulsar (magia)"]], light?.animation || "")}</select><p class="form-help">Só visual. Quem pede menos movimento vê a luz fixa.</p></div>` : "";
    return `<form class="se-panel" data-light-form><h3>Foco de luz · coluna ${pick.x + 1}, linha ${pick.y + 1}</h3><p class="form-help">${esc(HELP.light)}</p><div class="field"><label for="se-radius">Raio de luz plena (casas)</label><input id="se-radius" name="radius" type="number" min="1" max="30" required value="${light?.radius ?? 4}"></div>${advanced}<div class="form-actions">${light ? button("Apagar foco", "se-light-remove", "", "text-button") : ""}<button type="submit" class="primary">${light ? "Atualizar" : "Adicionar"}</button></div></form>`;
  }
  function markPanel() {
    const mark = layer.marks.find((m) => m.x === pick.x && m.y === pick.y);
    return `<form class="se-panel" data-mark-form><h3>Marca oculta · coluna ${pick.x + 1}, linha ${pick.y + 1}</h3><p class="form-help">${esc(HELP.mark)}</p><div class="field"><label for="se-kind">Tipo</label><select id="se-kind" name="kind">${MARK_KINDS.map(([v, l]) => `<option value="${v}" ${mark?.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="field"><label for="se-mlabel">Nome</label><input id="se-mlabel" name="label" maxlength="40" required value="${esc(mark?.label || "")}"></div><fieldset><legend>Revelação automática (opcional)</legend><div class="field"><label for="se-dc">Dificuldade de percepção</label><input id="se-dc" name="dc" type="number" min="-100" max="1000" value="${mark?.dc ?? ""}"></div><div class="field"><label for="se-maxd">Distância máxima (casas)</label><input id="se-maxd" name="maxDistance" type="number" min="0" max="30" value="${mark?.maxDistance ?? ""}"></div><div class="field"><label for="se-sense">Sentido que detecta</label><input id="se-sense" name="sense" maxlength="40" value="${esc(mark?.sense || "")}"></div><p class="form-help">Sem dificuldade nem sentido, só você revela, pela mesa.</p></fieldset><div class="form-actions">${mark ? button("Remover marca", "se-mark-remove", "", "text-button") : ""}<button type="submit" class="primary">${mark ? "Atualizar" : "Adicionar"}</button></div></form>`;
  }
  function sceneryPanel() {
    return `<div class="se-panel se-scenery"><h3>Escolher cenário</h3>${mapOnly ? "" : `<fieldset class="se-kind"><legend>Tipo de cena</legend>${SCENE_KINDS.map(([v, l, help]) => `<label class="check se-option"><input type="radio" name="se-kind" value="${v}" ${draft.kind === v ? "checked" : ""}><span><strong>${esc(l)}</strong><small>${esc(help)}</small></span></label>`).join("")}</fieldset>`}${draft.kind === "text" ? '<p class="form-help">Cenas textuais não trocam o mapa da mesa.</p>' : '<div id="se-picker"></div><p class="form-help">Escolher só muda a prévia. Nada é mostrado aos jogadores até você apresentar a cena.</p>'}</div>`;
  }
  function visibilityPanel() {
    return `<div class="se-panel"><h3>Visibilidade${helpButton("campanhas.cenas.simulacao", "Simulação de visão")}</h3><fieldset><legend class="sr-only">O que o grupo vê</legend>${VISIBILITY_OPTIONS.map(([v, l, help]) => `<label class="check se-option"><input type="radio" name="se-vision" value="${v}" ${(draft.visionMode || "") === v ? "checked" : ""}><span><strong>${esc(l)}</strong><small>${esc(help)}</small></span></label>`).join("")}</fieldset><p class="form-help">${esc(HELP.conceal)}</p>${draft.visionMode === "manual" ? `<div class="form-actions">${button("Revelar área", "se-tool", "reveal", "subtle")}${button("Cobrir área", "se-tool", "conceal", "subtle")}</div>` : ""}<p class="form-help">A visibilidade vale ao apresentar a cena. Ela não muda a forma de jogar (livre, por turnos ou tática).</p></div>`;
  }
  function settingsPanel() {
    return `<div class="se-panel"><h3>Configuração da cena${helpButton("campanhas.cenas.alcance", "Alcance da preparação")}</h3>${mapOnly ? "" : `<div class="field"><label for="se-desc">Descrição de preparo (só você)</label><textarea id="se-desc" data-draft="description" maxlength="1000" rows="3">${esc(draft.description)}</textarea></div><div class="field"><label for="se-order">Ordem na lista</label><input id="se-order" data-draft="order" type="number" min="0" max="10000" value="${Number(draft.order) || 0}"></div>`}${mapKind() && !mapOnly ? `<fieldset><legend>Preparação do mapa (paredes, luzes, marcas e exploração)</legend><label class="check se-option"><input type="radio" name="se-layer" value="map" ${draft.layerMode === "map" ? "checked" : ""} ${live?.current ? "disabled" : ""}><span><strong>Compartilhada com o mapa</strong><small>Vale para todas as cenas com este mapa no modo compartilhado e para a preparação do mapa. A exploração também é compartilhada.</small></span></label><label class="check se-option"><input type="radio" name="se-layer" value="scene" ${draft.layerMode === "scene" ? "checked" : ""} ${live?.current ? "disabled" : ""}><span><strong>Própria desta cena</strong><small>Começa como a do mapa e depois segue separada. A imagem não é duplicada.</small></span></label>${live?.current ? '<p class="form-help">Com a cena em apresentação, o alcance não muda.</p>' : '<p class="form-help">Trocar o alcance carrega a preparação correspondente. Salve antes as mudanças do mapa.</p>'}</fieldset>` : ""}</div>`;
  }
  function fogPanel() {
    const value = layer?.fog == null ? "inherit" : layer.fog ? "on" : "off";
    return `<div class="se-panel"><h3>Névoa neste mapa</h3><div class="field"><label for="se-fog">Névoa</label><select id="se-fog" data-fog><option value="inherit" ${value === "inherit" ? "selected" : ""}>Conforme a configuração da mesa</option><option value="on" ${value === "on" ? "selected" : ""}>Sempre ligada</option><option value="off" ${value === "off" ? "selected" : ""}>Sempre desligada</option></select></div><p class="form-help">A visibilidade da cena, quando escolhida, prevalece ao apresentar.</p><ul class="fog-legend"><li><i class="lg-wall"></i>Parede</li><li><i class="lg-move"></i>Bloqueia movimento</li><li><i class="lg-light"></i>Bloqueia luz</li><li><i class="lg-door"></i>Porta</li></ul></div>`;
  }
  function gridPanel() {
    const m = mapOf(draft.mapKey);
    if (!m?.key?.startsWith("asset:")) return `<div class="se-panel"><h3>Grade e escala</h3><p class="form-help">Mapas prontos já vêm com a grade certa.</p></div>`;
    return `<form class="se-panel" data-grid-form><h3>Grade e escala de “${esc(m.name)}”${helpButton("campanhas.mapas.grade", "Grade e escala")}</h3><p class="form-help">Vale para todas as cenas que usam esta imagem. Paredes e névoa seguem as casas: ajuste a grade antes de preparar o mapa.</p>${meta?.inUse ? '<p class="notice-box">Este mapa está na mesa agora. Troque o cenário da mesa para ajustar a grade.</p>' : '<div id="se-grid"></div><div class="form-actions"><button type="submit" class="primary">Salvar grade</button></div>'}</form>`;
  }
  function hiddenPanel() {
    const list = hiddenCustomizations({ layer: meta ? layer : null, scene: { layerMode: draft.layerMode, description: draft.description }, tokens: draft.prepared });
    return `<div class="se-panel"><h3>Ajustes avançados ativos</h3><p class="form-help">Continuam valendo na interface Básica; só os controles ficam ocultos.</p><ul>${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${button("Mostrar na interface Completa", "se-go-complete", "", "subtle")}</div>`;
  }
  function applyPanel() {
    if (applying === "restart") return `<div class="se-panel"><h3>Reiniciar cena com o novo cenário?</h3><p>Os jogadores passam a ver o cenário preparado:</p><ul><li>marcadores voltam ao arranjo preparado;</li><li>paredes, portas, luzes, marcas e névoa voltam à preparação salva;</li><li>a exploração recomeça.</li></ul><p class="form-help">Fichas, conversa, rolagens e histórico continuam.</p><div class="form-actions">${button("Cancelar", "se-apply", "", "subtle")}${button("Reiniciar cena", "se-restart", "", "danger")}</div></div>`;
    const parts = [live.textPending && ["text", "Nome e texto para os jogadores"], !live.mapPending && ["vision", "Visibilidade da cena"], meta?.pending && !live.mapPending && ["layer", "Paredes, portas, luzes e marcas do mapa"], live.compositionPending && !live.mapPending && ["composition", "Imagens da composição da cena"]].filter(Boolean);
    const tokens = mapKind() && !live.mapPending;
    // Revisar diferenças: o que muda na mesa se a preparação do mapa for aplicada (portas abertas/fechadas não contam).
    const diff = meta?.pending && meta.live && savedLayer ? diffSummary(layerDiff(meta.live, savedLayer)) : [];
    const review = meta?.pending ? `<div class="se-diff" role="note"><h4>Diferenças do mapa em relação à mesa</h4>${diff.length ? `<ul>${diff.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : '<p class="small">Só ajustes que não mudam paredes, luzes nem marcas.</p>'}<p class="form-help">Posições, exploração, revelações, portas abertas ou fechadas, fichas e histórico continuam.</p></div>` : "";
    return `<form class="se-panel" data-apply-form><h3>Aplicar à cena atual${helpButton("campanhas.cenas.aplicar", "Aplicar à cena atual")}</h3><p>Escolha o que da preparação salva passa a valer na mesa agora. Os jogadores veem o resultado.</p>${review}<fieldset><legend>Aplicar</legend>${parts.map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${k !== "vision" ? "checked" : ""}> ${esc(l)}</label>`).join("")}${tokens ? `<label class="check"><input type="checkbox" name="tokens"> ${esc(APPLY_TOKENS.label)}</label><p class="form-help">${esc(APPLY_TOKENS.help)}</p>` : ""}</fieldset><p class="form-help">${esc(APPLY_PRESERVES)}</p>${live.mapPending ? `<div class="notice-box"><p>O cenário mudou na preparação. Trocar de cenário recomeça a exploração, então usa “Reiniciar cena”.</p>${button("Reiniciar cena com o novo cenário…", "se-restart-ask", "", "subtle")}</div>` : ""}<div class="form-actions">${button("Cancelar", "se-dismiss", "", "subtle")}<button type="submit" class="primary" ${parts.length || tokens ? "" : "disabled"}>Aplicar à mesa</button></div></form>`;
  }

  /** Pontos de entrada do mapa (reutilizáveis; editáveis na preparação do mapa) ou a área de entrada desta cena. */
  function entriesPanel() {
    const editable = mapOnly && meta?.entriesEditable;
    const rows = mapEntries.map((e) => `<li class="se-entry-item"><div class="field"><label for="se-en-${esc(e.id)}">Nome</label><input id="se-en-${esc(e.id)}" maxlength="40" data-entry-field="${esc(e.id)}:name" value="${esc(e.name)}" ${editable ? "" : "disabled"}></div><div class="field"><label for="se-ek-${esc(e.id)}">Tipo</label><select id="se-ek-${esc(e.id)}" data-entry-field="${esc(e.id)}:kind" ${editable ? "" : "disabled"}>${opt(ENTRY_KINDS, e.kind)}</select></div><p class="form-help">${e.w} × ${e.h} casas a partir da coluna ${e.x + 1}, linha ${e.y + 1}.</p>${editable ? button(`Excluir<span class="sr-only"> ${esc(e.name)}</span>`, "se-entry-remove", e.id, "text-button small") : ""}</li>`).join("");
    const problem = entriesProblem(mapEntries, width(), height());
    if (mapOnly) return `<div class="se-panel"><h3>Pontos de entrada${helpButton("campanhas.cenas.posicoes", "Posições iniciais e área de entrada")}</h3><p class="form-help">${esc(helpOf("entry"))} São do mapa: valem para qualquer cena que o use e nunca movem personagens já posicionados numa cena.</p>${editable ? "" : `<p class="notice-box">${esc(toolProblem("entry") || "")}</p>`}${rows ? `<ol class="se-entry-list">${rows}</ol>` : '<p class="muted small">Nenhum ponto ainda. Use a ferramenta Área de entrada e arraste sobre as casas.</p>'}${problem && mapEntries.length ? `<p class="form-error" role="alert">${esc(problem)}</p>` : ""}<p class="form-help">A primeira “Entrada do grupo” é a padrão das cenas. Salve com “Salvar preparação”.</p></div>`;
    return `<div class="se-panel"><h3>Área de entrada da cena</h3><p class="form-help">${esc(helpOf("entry"))}</p>${entrySection(sceneEntryArea(draft.entry, mapEntries), characters.filter((c) => !draft.prepared.some((t) => t.characterId === c.id)).length)}${rows ? `<h4>Pontos do mapa</h4><ol class="se-entry-list">${rows}</ol><p class="form-help">Edite os pontos do mapa na preparação do mapa (Preparação › Mapas › Preparar névoa e luz).</p>` : ""}</div>`;
  }
  /** Recolocar personagens nas posições preparadas: prévia das mudanças calculada pelo servidor e confirmação explícita. */
  let reposition = null;
  async function loadReposition() {
    reposition = { loading: true }; renderSide(); showProps();
    try {
      const r = await api(`/sessions/${live.sessionId}/scene/reposition?sceneId=${encodeURIComponent(saved.id)}`, "GET", undefined, { background: true });
      reposition = { moves: r.moves || [], unchanged: r.unchanged || 0 };
    } catch (e) { reposition = { error: e.message }; }
    if (applying === "reposition") renderSide();
  }
  function repositionPanel() {
    const at = (p) => (p ? `coluna ${p.x + 1}, linha ${p.y + 1}` : "");
    const body = !reposition || reposition.loading ? '<p class="loading-line" role="status">Calculando as mudanças…</p>'
      : reposition.error ? `<p class="form-error" role="alert">${esc(reposition.error)}</p>`
      : reposition.moves.length ? `<ul class="se-moves">${reposition.moves.map((m) => `<li><strong>${esc(m.label || "Marcador")}</strong>: ${m.from && m.to ? `${at(m.from)} → ${at(m.to)}` : m.to ? `entra em ${at(m.to)}` : "sai da mesa"}</li>`).join("")}</ul>${reposition.unchanged ? `<p class="small">${reposition.unchanged} marcador(es) já estão na posição preparada.</p>` : ""}`
      : '<p class="small">Todos já estão nas posições preparadas. Nada muda.</p>';
    return `<div class="se-panel" role="region" aria-labelledby="se-rp-h"><h3 id="se-rp-h">Recolocar personagens nas posições preparadas?</h3><p>Os jogadores veem os marcadores mudarem de lugar na mesa.</p>${body}<p class="form-help">Continuam: fichas, histórico, exploração, revelações, portas abertas ou fechadas e o estado dos personagens. Criaturas fora do arranjo preparado saem da mesa.</p><div class="form-actions">${button("Cancelar", "se-dismiss", "", "subtle")}${button("Recolocar agora", "se-reposition-go", "", "danger", reposition?.moves?.length ? "" : 'aria-disabled="true" data-tip="Nada a recolocar."')}</div></div>`;
  }
  async function applyReposition() {
    try {
      const result = await api(`/sessions/${live.sessionId}/scene/apply`, "POST", { sceneId: saved.id, text: false, vision: false, layer: false, tokens: true, composition: false, sceneRevision: saved.revision, prepVersion: meta?.prepVersion || null });
      applying = false; reposition = null;
      say(result.applied?.length ? "Personagens recolocados nas posições preparadas." : "Nada mudou: a mesa já estava assim.");
      renderSide();
    } catch (e) { if (e.status === 409) { applying = false; conflict = e.message; } else say(e.message); renderSide(); }
  }

  function renderSide() {
    disposePicker(); disposePicker = () => {};
    disposeGrid?.dispose(); disposeGrid = null;
    const hidden = mode === "basic" ? hiddenCustomizations({ layer: meta ? layer : null, scene: { layerMode: draft.layerMode, description: draft.description }, tokens: draft.prepared }) : [];
    const chip = hidden.length && panel !== "hidden" ? `<button type="button" class="se-hidden-chip" data-action="se-panel" data-id="hidden">Ajustes avançados ativos (${hidden.length}) · ver detalhes</button>` : "";
    shell.panel("props").innerHTML = chip + sidePanel();
    if (composing()) syncComposeBar(); else syncWallBar();
    if (panel === "scenery" && q("#se-picker")) mountPicker();
    if (panel === "gridAdjust" && q("#se-grid")) mountGrid();
    if (applying || conflict || error) showProps();
  }
  async function mountPicker() {
    const { mapChoices, mountMapChoices } = await import("./map-picker.js");
    const host = q("#se-picker");
    if (!host) return;
    let folders = [];
    if (mode === "complete") folders = (await api(`${base}/assets/maps`).catch(() => ({ folders: [] }))).folders || [];
    if (!host.isConnected) return;
    host.innerHTML = mapChoices(maps.items, draft.mapKey, mapKind() ? "Mapas táticos (grade ou movimentação livre)" : "Imagens", { sceneKind: draft.kind, recentKeys: recents, complete: mode === "complete", folders, name: "se-map" });
    disposePicker = mountMapChoices(host, maps.items, { name: "se-map", onChange: (m) => chooseMap(m) });
  }
  async function mountGrid() {
    const m = mapOf(draft.mapKey);
    const { gridAdjustHtml, mountGridAdjust } = await import("./grid-adjust.js");
    const host = q("#se-grid");
    if (!host) return;
    host.innerHTML = gridAdjustHtml("se-g", m, { complete: mode === "complete" });
    disposeGrid = mountGridAdjust(host, m.imageUrl);
  }
  async function chooseMap(m) {
    if (!m || m.key === draft.mapKey) return;
    if (draft.prepared.length && !confirm("Trocar o cenário remove os marcadores preparados, porque as posições pertencem à grade anterior. Continuar?")) return renderSide();
    if (compElements() && !confirm("Trocar o cenário remove a composição desta cena (imagens só desta cena). O mapa anterior continua em Mapas. Continuar?")) return renderSide();
    if (layerDirty && !confirm("As mudanças de paredes, luzes e névoa ainda não salvas deste mapa serão descartadas. Continuar?")) return renderSide();
    commitTyping();
    draft.mapKey = m.key; draft.prepared = []; draft.composition = null; draft.entry = null; pendingBlank = null; selection = [];
    composer?.select([], false);
    try { await loadLayer(); } catch (e) { say(e.message); }
    schedulePreview();
    resetHistory("Cenário trocado. O histórico de desfazer recomeça a partir daqui.");
    recomputeDirty();
    renderAll(false);
    renderPanels();
  }
  function refreshSelection() { board.setView(boardView()); renderSide(); renderStructure(); renderLayers(); }
  function refresh() { redraw(); renderSide(); renderPanels(); renderStatus(); shell.refreshTools(); }
  function renderAll(side = true) {
    root.dataset.tool = tool;
    shell.refreshTools(); renderStatus(); renderStage(); if (side) renderSide(); renderPanels();
    shell.setTitle(titleText(), subtitleText());
  }

  // ---------- Ferramentas e interface ----------
  function onTool(id) {
    board.interact();
    tool = id; pick = null; simulate = false;
    if (!VECTOR_TOOLS.has(id)) { wallPts = []; vdrag = null; vpoint = null; if (id !== "select") wallSel = []; }
    root.dataset.tool = id;
    board.camera.setPan(id === "hand");
    if (!["select", "hand", "zoom"].includes(id)) selection = [];
    panel = id === "select" && selection.length ? "token" : "overview";
    if ((id === "add" || id === "npc") && npcs == null) loadNpcs();
    renderAll();
  }
  function onModeChange(next) {
    mode = next;
    // Troca só a apresentação: seleção, rascunho, posição do mapa e alterações não salvas continuam.
    const def = tools.find((t) => t.id === tool);
    if (def && next !== "complete" && def.basic === false) { tool = "select"; shell.setTool("select"); board.camera.setPan(false); }
    if (next !== "complete" && !BASIC_PANELS.has(panel)) panel = "overview";
    if (next === "complete" && panel === "hidden") panel = "overview";
    renderAll();
  }
  function toggleSimulate(on = !simulate) {
    if (on && (!mapKind() || !meta)) return say("A simulação vale para mapas táticos.");
    simulate = on; selection = []; serverView = null; serverViewError = "";
    if (simulate && !viewer) viewer = draft.prepared.find((t) => t.characterId)?.characterId || "";
    renderAll();
  }
  function onEscape(e) {
    if (dismissHelp()) return;
    if (isTypingTarget(e.target)) { commitTyping(); e.target.blur(); return; }
    if (simulate) return toggleSimulate(false);
    if (startChoice) { startChoice = null; return renderSide(); }
    if (composing() && composer) {
      if (composer.surface.cancelInteraction()) return say("Ação cancelada.");
      if (composer.selection.size) return composer.select([], false);
    }
    if (wallPts.length) { wallPts = []; say("Traço de parede cancelado."); return redraw(); }
    if (vdrag) { vdrag = null; return redraw(); }
    if (wallSel.length) { wallSel = []; if (panel === "walls") panel = "overview"; return refreshSelection(); }
    if (history.pending) { history.cancel(); return; }
    if (applying) { applying = false; return renderSide(); }
    if (selection.length || pick) return deselect();
    if (tool !== "select") return shell.useTool("select");
  }

  // ---------- Salvar e aplicar ----------
  const sceneBody = () => ({
    name: mapOnly ? "" : draft.name.trim(), description: draft.description, kind: draft.kind, mapKind: null, mapKey: draft.kind === "text" ? null : draft.mapKey,
    sharedText: draft.sharedText, privateNotes: draft.privateNotes, visionMode: mapKind() ? draft.visionMode || null : null, order: Number(draft.order) || 0,
    revision: saved.revision, layerMode: draft.layerMode, layers: sceneLayers(draft.layers),
    // Área de entrada (ADR-090): JSON da cena; "" limpa (vale a entrada do mapa).
    entry: mapKind() && draft.entry ? JSON.stringify(draft.entry.ref ? { ref: draft.entry.ref } : { x: draft.entry.x, y: draft.entry.y, w: draft.entry.w, h: draft.entry.h }) : "",
    prepared: mapKind() ? draft.prepared.map((t) => ({ characterId: t.characterId || null, masterCharacterId: t.masterCharacterId || null, label: t.label, side: t.side, x: t.x, y: t.y, fx: freeOn() ? t.fx ?? null : null, fy: freeOn() ? t.fy ?? null : null, hidden: !!t.hidden, light: t.light ?? null, appearance: t.appearance ?? null, size: t.size ?? null, imageUrl: t.imageUrl ?? null, layer: tokenLayerOf(t.layer, draft.layers) })) : [],
  });
  async function saveLayer() {
    // Pontos de entrada do mapa (preparação do mapa): recurso compartilhado, com a revisão do próprio mapa.
    if (entriesDirty()) {
      const problem = entriesProblem(mapEntries, width(), height());
      if (problem) throw new Error(problem);
      const sentEntries = clone(mapEntries);
      const r = await api(`${base}/assets/entries?key=${encodeURIComponent(draft.mapKey)}`, "PUT", { entries: sentEntries, revision: meta.mapRevision }, { background: true });
      meta.mapRevision = r.revision; savedEntries = sentEntries;
      const m = mapOf(draft.mapKey); if (m) m.revision = r.revision;
    }
    if (sameSnapshot(layer, savedLayer) && !resetExploration) return;
    const sent = clone(layer);
    const result = await api(`${base}/assets/layers?key=${encodeURIComponent(draft.mapKey)}${saved.id ? `&scene=${encodeURIComponent(saved.id)}` : ""}`, "PUT", {
      fog: sent.fog, cells: sent.cells, revealed: sent.revealed,
      lights: sent.lights.map((l) => ({ x: l.x, y: l.y, radius: l.radius, dim: l.dim ?? null, color: l.color ?? null, intensity: l.intensity ?? null, animation: l.animation ?? null })),
      walls: (sent.walls || []).map((w) => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind, open: !!w.open, hidden: !!w.hidden })),
      marks: sent.marks.map((m) => ({ id: m.id || null, x: m.x, y: m.y, kind: m.kind, label: m.label, dc: m.dc ?? null, sense: m.sense || null, maxDistance: m.maxDistance ?? null })),
      revision: meta.revision, resetExploration, prepVersion: meta.prepVersion,
    }, { background: true });
    meta.revision = result.revision; meta.prepVersion = result.prepVersion; meta.pending = result.pendingLive; meta.inUse = result.inUse;
    savedLayer = sent; resetExploration = false;
  }
  async function save() {
    if (busy) return;
    commitTyping();
    if (!mapOnly && !draft.name.trim()) { nameInput?.focus(); return say("Dê um nome à cena antes de salvar."); }
    if (!mapOnly && draft.kind !== "text" && !draft.mapKey) { openPanel("scenery"); return say("Escolha o cenário da cena."); }
    busy = true; renderStatus();
    try {
      if (mapOnly) { if (layerDirty) await saveLayer(); }
      else if (!saved.id) {
        const sent = clone(draft);
        const created = await api(`${base}/scenes`, "POST", { ...sceneBody(), folderId: folderId || null }, { background: true });
        saved = { id: created.id, revision: created.revision }; savedScene = { ...sent, composition: savedScene.composition };
        if (layerDirty) await saveLayer();
        if (compositionDirty()) await saveComposition(sent.composition);
      } else {
        if (layerDirty) await saveLayer();
        if (!sameSnapshot(sceneFields(draft), sceneFields(savedScene))) { const sent = clone(draft); const r = await api(`${base}/scenes/${saved.id}`, "PUT", sceneBody(), { background: true }); saved.revision = r.revision; savedScene = { ...sent, composition: savedScene.composition }; }
        if (compositionDirty()) await saveComposition(clone(draft.composition));
      }
      if (layerLocked()) {
        savedLayerMode = draft.layerMode;
        await loadLayer();
        resetHistory("Alcance salvo: a preparação correspondente foi carregada e o histórico de desfazer recomeça.");
      }
      if (saved.id) { const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true }); live = fresh.live; saved.revision = fresh.revision; }
      history.markSaved();
      say(live?.current ? "Preparação salva. A mesa só muda quando você aplicar." : "Preparação salva.");
    } catch (e) {
      if (e.status === 409) conflict = e.message; else error = e.message;
      renderSide();
    } finally { busy = false; recomputeDirty(); renderAll(false); }
  }
  /**
   * Composição da cena: documento + sobreposição achatada (só o que os jogadores podem ver, PNG transparente).
   * Sem elementos, a composição é removida. A mesa só muda ao apresentar, reiniciar ou aplicar.
   */
  async function saveComposition(sent) {
    const empty = !sent || !sent.elements.length;
    if (!empty) { const problem = CP.validateComposition(sent); if (problem) throw new Error(problem); }
    const fd = new FormData();
    fd.append("composition", empty ? "" : CP.serializeComposition(sent));
    fd.append("revision", String(saved.revision));
    if (!empty) { const blob = await flattenOverlay(sent, imageCache); if (blob) fd.append("file", blob, "composicao.png"); }
    const r = await api(`${base}/scenes/${saved.id}/composition`, "PUT", fd, { background: true });
    saved.revision = r.revision;
    savedScene = { ...savedScene, composition: sent };
  }
  async function apply(form) {
    const data = Object.fromEntries(new FormData(form));
    if (!data.text && !data.vision && !data.layer && !data.tokens && !data.composition) return say("Escolha o que aplicar.");
    try {
      const result = await api(`/sessions/${live.sessionId}/scene/apply`, "POST", { sceneId: saved.id, text: !!data.text, vision: !!data.vision, layer: !!data.layer, tokens: !!data.tokens, composition: !!data.composition, sceneRevision: saved.revision, prepVersion: meta?.prepVersion || null });
      applying = false;
      const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true }); live = fresh.live; saved.revision = fresh.revision;
      if (meta) await loadLayer();
      say(result.applied?.length ? `Aplicado à mesa: ${result.applied.join(", ")}.` : "Nada a aplicar: a mesa já estava assim.");
      recomputeDirty(); renderAll();
    } catch (e) { if (e.status === 409) { applying = false; conflict = e.message; renderSide(); } else say(e.message); }
  }
  /** Reiniciar a partir do editor: mesmo comando da mesa (apresentar com restart), só depois da confirmação no painel. */
  async function restart() {
    if (busy || sceneDirty || layerDirty) return say("Salve a preparação antes de reiniciar a cena.");
    busy = true;
    try {
      await api(`/sessions/${live.sessionId}/scene`, "POST", { sceneId: saved.id, restart: true });
      applying = false;
      const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true }); live = fresh.live; saved.revision = fresh.revision;
      if (meta) await loadLayer();
      say("Cena reiniciada com o cenário preparado.");
    } catch (e) { say(e.message); }
    finally { busy = false; recomputeDirty(); renderAll(); }
  }
  /**
   * Conflito: grava os dados da cena (nome, textos, cenário, arranjo, camadas) como uma cena nova na mesma pasta e
   * passa a editar a cópia. A cena original não muda. A preparação do mapa continua pendente, se houver.
   */
  async function saveSceneCopy() {
    if (busy || mapOnly || !saved.id) return;
    commitTyping();
    busy = true; renderStatus();
    try {
      const sent = clone(draft);
      const name = `${draft.name.trim().slice(0, 70)} (cópia)`;
      const created = await api(`${base}/scenes`, "POST", { ...sceneBody(), name, revision: 0, folderId: scene?.folderId ?? folderId ?? null }, { background: true });
      draft.name = name; if (nameInput) nameInput.value = name;
      saved = { id: created.id, revision: created.revision }; savedScene = { ...sent, name };
      conflict = null; error = "";
      say(layerDirty ? "Cena salva como cópia. A preparação do mapa ainda não foi salva." : "Cena salva como cópia. Você está editando a cópia; a original não mudou.");
    } catch (e) { say(e.message); }
    finally { busy = false; recomputeDirty(); renderAll(); }
  }
  async function reload() {
    conflict = null; error = "";
    if (saved.id) {
      const fresh = await api(`${base}/scenes/${saved.id}`);
      draft = toDraft(fresh);
      savedScene = clone(draft); savedLayerMode = draft.layerMode;
      saved.revision = fresh.revision; live = fresh.live;
      if (nameInput) nameInput.value = draft.name;
    }
    await loadLayer();
    selection = []; pick = null; activeLayer = "elements";
    resetHistory("Versão salva recarregada.");
    recomputeDirty(); renderAll();
  }
  async function saveGrid() {
    const m = mapOf(draft.mapKey);
    const v = disposeGrid?.values();
    const scale = Number(q("#se-g-scale")?.value);
    if (!v || !m) return;
    try {
      const updated = await api(`${base}/assets/maps/${m.id}`, "PUT", { name: m.name, folderId: m.folderId || null, gridPixels: v.gridPixels, scaleMeters: scale, revision: m.revision, hasGrid: true, gridOffsetX: v.gridOffsetX, gridOffsetY: v.gridOffsetY, freeMovement: !!m.freeMovement });
      Object.assign(m, updated, { kind: "tileset" });
      const fresh = await api(`${base}/maps`); maps.items = fresh.items;
      const outside = draft.prepared.filter((t) => t.x >= updated.width || t.y >= updated.height).length;
      await loadLayer();
      resetHistory("");
      if (outside) { draft.prepared = draft.prepared.filter((t) => t.x < updated.width && t.y < updated.height); selection = []; say(`${outside} marcador(es) ficaram fora da nova grade e saíram da preparação.`); }
      else say("Grade salva. A mesa e o servidor usam a mesma grade.");
      recomputeDirty(); renderAll();
    } catch (e) { say(e.message); }
  }

  // ---------- Eventos ----------
  async function onClick(e) {
    const b = e.target.closest("[data-action^='se-']");
    if (!b || b.disabled || !root.contains(b)) return;
    if (b.getAttribute("aria-disabled") === "true") { if (b.dataset.tip) say(b.dataset.tip); return; }
    const id = b.dataset.id;
    switch (b.dataset.action) {
      case "se-tool": return shell.useTool(id);
      case "se-panel": panel = id; return renderSide();
      case "se-preview": return toggleSimulate();
      case "se-wall": return wallAction(id);
      case "se-save": return save();
      case "se-apply": applying = true; renderSide(); return showProps();
      case "se-restart-ask": applying = "restart"; return renderSide();
      case "se-restart": return restart();
      case "se-dismiss": conflict = null; error = ""; applying = false; return renderSide();
      case "se-reload": if (confirm("Recarregar abre a versão salva. Suas alterações ficam guardadas neste navegador (Arquivo › Rascunho local…). Continuar?")) { await drafts?.preserve(); await reload().catch((x) => say(x.message)); } return;
      case "se-save-copy": return saveSceneCopy();
      case "se-go-complete": setInterfaceMode("complete"); return;
      case "se-token-remove": return removeSelection();
      case "se-token-props": return selection.length === 1 && openTokenProperties(selection[0]);
      case "se-sel-hide": return toggleHidden();
      case "se-sel-dup": return duplicate();
      case "se-place-cursor": return placeAtCursor(id);
      case "se-add-character": return pick && placeRef(`pc:${id}`, pick);
      case "se-add-npc": return pick && placeRef(`npc:${id}`, pick);
      case "se-light-remove": change("Apagar foco de luz", () => { layer = { ...layer, lights: layer.lights.filter((l) => l.x !== pick.x || l.y !== pick.y) }; }); pick = null; panel = "overview"; return refresh();
      case "se-start": return startAction(id);
      case "se-start-cancel": startChoice = null; return renderSide();
      case "se-replace-bg": startChoice = { files: null, replace: true, pick: true }; return pickImages();
      case "se-comp": return composeAction(id);
      case "se-open-map": return openOriginalMap();
      case "se-map-from-comp": return mapFromComposition();
      case "se-playable": startChoice = { playable: true }; renderSide(); return showProps();
      case "se-char-show": { const i = Number(id); if (!draft.prepared[i]) return; if (shell.context !== "elements") shell.setContext("elements"); selection = [i]; panel = "token"; lastCell = { x: draft.prepared[i].x, y: draft.prepared[i].y }; return refreshSelection(); }
      case "se-char-unplace": { const i = Number(id); if (!draft.prepared[i]) return; return removeIndices([i], "Remover posição preparada"); }
      case "se-entry-clear": change("Usar a entrada do mapa", () => { draft.entry = null; }); return refresh();
      case "se-distribute": return distributeParty();
      case "se-entry-remove": change("Excluir ponto de entrada", () => { mapEntries = mapEntries.filter((x) => x.id !== id); }); return refresh();
      case "se-reposition-go": return applyReposition();
      case "se-mark-remove": change("Remover marca oculta", () => { layer = { ...layer, marks: layer.marks.filter((m) => m.x !== pick.x || m.y !== pick.y) }; }); pick = null; panel = "overview"; return refresh();
    }
  }
  function loadNpcs() {
    if (npcs || npcLoading || mapOnly) return npcLoading;
    npcLoading = api(`${base}/npcs`, "GET", undefined, { background: true }).then((r) => { npcs = r.items || []; }).catch(() => { npcs = []; }).finally(() => {
      npcLoading = null;
      if (closed) return;
      if (panel === "add") renderSide();
      renderCharacters();
    });
    return npcLoading;
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches("[data-se-char-search]")) return renderCharacterList();
    if (t.matches("[data-asset-q]")) return renderAssets();
    if (t.matches("[data-comp-name]")) {
      const el = composer?.selected()[0];
      if (!el || !composer.editable(el)) return;
      beginTyping("Renomear imagem");
      el.name = t.value.slice(0, 80); recomputeDirty(); syncComposeBar();
      return;
    }
    if (t.dataset.entryField?.endsWith(":name")) {
      const id = t.dataset.entryField.split(":")[0];
      beginTyping("Renomear ponto de entrada");
      mapEntries = mapEntries.map((x) => (x.id === id ? { ...x, name: t.value.slice(0, 40) } : x));
      return recomputeDirty();
    }
    if (t.id === "se-name") {
      beginTyping("Renomear cena");
      draft.name = t.value; recomputeDirty();
      shell.setTitle(titleText(), subtitleText());
      if (draft.kind === "text") renderStage();
      return;
    }
    if (t.dataset.draft) {
      beginTyping({ sharedText: "Texto compartilhável", privateNotes: "Notas privadas", description: "Descrição de preparo", order: "Ordem na lista" }[t.dataset.draft] || "Editar cena");
      draft[t.dataset.draft] = t.dataset.draft === "order" ? Number(t.value) : t.value;
      recomputeDirty();
      if (t.dataset.draft === "sharedText" && draft.kind === "text") renderStage();
      return;
    }
    if (t.dataset.token && selection.length === 1) {
      const i = selection[0], tok = draft.prepared[i];
      if (!tok) return;
      const key = t.dataset.token;
      if (key === "layer" && draft.layers.find((l) => l.id === t.value)?.locked) { t.value = tokenLayerOf(tok.layer, draft.layers); return say("A camada escolhida está bloqueada."); }
      beginTyping(key === "layer" ? "Mover para camada" : "Propriedades do marcador");
      const next = { ...tok };
      if (key === "hidden") next.hidden = t.checked;
      else if (key === "light") next.light = t.value === "" ? null : Math.max(0, Math.min(30, Math.round(Number(t.value))));
      else if (key === "layer") next.layer = tokenLayerOf(t.value, draft.layers);
      else next[key] = t.value;
      draft.prepared[i] = next;
      if (t.type === "checkbox" || t.tagName === "SELECT") commitTyping();
      recomputeDirty(); redraw(); renderStructure();
      if (key === "layer") { selection = selection.filter(editable); renderLayers(); }
    }
  }
  async function onChange(e) {
    const t = e.target;
    if (t.dataset.wallDraw || t.dataset.wallPatch || t.dataset.wallCoord) return onWallInput(t);
    if (t.id === "se-files") {
      const files = [...(t.files || [])];
      t.value = "";
      if (startChoice?.pick) { startChoice = null; const { files: ok, problems } = splitImageFiles(files); if (problems.length) say(problems.join(" ")); if (ok.length) { startChoice = { files: ok, replace: true }; renderSide(); showProps(); } return; }
      return handleFiles(files, null);
    }
    if (t.matches("[data-se-entry]")) {
      const v = t.value;
      if (v === "scene") return;
      change(v ? "Entrada da cena pelo ponto do mapa" : "Usar a entrada do mapa", () => { draft.entry = v.startsWith("ref:") ? { ref: v.slice(4) } : null; });
      return refresh();
    }
    if (t.dataset.entryField?.endsWith(":kind")) {
      const id = t.dataset.entryField.split(":")[0];
      change("Tipo do ponto de entrada", () => { mapEntries = mapEntries.map((x) => (x.id === id ? { ...x, kind: t.value } : x)); });
      return refresh();
    }
    if (t.dataset.compFlag) { commitTyping(); composer?.toggle(t.dataset.compFlag); return afterCompose(); }
    if (t.dataset.compSecret) {
      const id = t.dataset.compSecret, on = t.checked;
      compChange(on ? "Camada só do mestre" : "Camada visível aos jogadores", () => { draft.composition.layers = draft.composition.layers.map((l) => { if (l.id !== id) return l; const n = { ...l }; if (on) n.secret = true; else delete n.secret; return n; }); });
      return;
    }
    if (t.name === "se-kind") {
      if (draft.prepared.length && t.value !== "map" && !confirm("Sem grade, os marcadores preparados saem da cena. Continuar?")) { t.checked = false; return renderSide(); }
      if (t.value === "text" && compElements() && !confirm("Cenas textuais não têm imagem: a composição desta cena será removida ao salvar. Continuar?")) { t.checked = false; return renderSide(); }
      commitTyping();
      draft.kind = t.value; if (t.value !== "map") { draft.prepared = []; selection = []; draft.entry = null; }
      if (t.value === "text") { draft.composition = null; pendingBlank = null; }
      const m = mapOf(draft.mapKey);
      if (draft.kind === "text" || (m && !acceptsMap(draft.kind, m))) { draft.mapKey = ""; layer = null; meta = null; savedLayer = null; }
      else await loadLayer().catch((x) => say(x.message));
      if (simulate && !mapKind()) simulate = false;
      resetHistory("Tipo de cena trocado. O histórico de desfazer recomeça a partir daqui.");
      recomputeDirty(); return renderAll();
    }
    if (t.name === "se-viewer") { viewer = t.value; serverView = null; serverViewError = ""; renderSimBanner(); return redraw(); }
    if (t.name === "se-vision") { change("Visibilidade", () => { draft.visionMode = t.value; }); renderAll(false); return renderSide(); }
    if (t.name === "se-layer") {
      if (layerDirty && !confirm("As mudanças do mapa ainda não salvas serão descartadas ao trocar o alcance. Continuar?")) return renderSide();
      change("Alcance da preparação", () => { if (layerDirty) { layer = clone(savedLayer); resetExploration = false; } draft.layerMode = t.value; });
      // A camada a editar depende do alcance salvo: até salvar, paredes, luzes e névoa ficam bloqueadas.
      if (layerLocked()) say("Salve para passar a editar a preparação " + (t.value === "scene" ? "própria desta cena." : "compartilhada do mapa."));
      if (PAINT.has(tool) || ["light", "mark", "toggleDoor"].includes(tool)) { tool = "select"; shell.setTool("select"); }
      return renderAll(false);
    }
    if (t.dataset.fog !== undefined) { change("Névoa neste mapa", () => { layer = { ...layer, fog: t.value === "inherit" ? null : t.value === "on" }; }); return redraw(); }
    if (t.dataset.reset !== undefined) { change("Recomeçar exploração", () => { resetExploration = t.checked; }); renderStatus(); }
  }
  function onSubmit(e) {
    const f = e.target;
    if (!root.contains(f)) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (f.matches("[data-token-form]")) return;
    if (f.matches("[data-start-form]")) return confirmStart(f);
    if (f.matches("[data-add-marker]")) {
      const label = String(data.label || "").trim();
      if (!label) return say("Dê um nome ao marcador.");
      return placeToken({ label: label.slice(0, 40), side: data.side, hidden: data.hidden === "on" }, pick, "Adicionar marcador");
    }
    if (f.matches("[data-light-form]")) {
      const radius = Math.round(Number(data.radius));
      if (!(radius >= 1 && radius <= 30)) return say("O raio vai de 1 a 30 casas.");
      const old = layer.lights.find((l) => l.x === pick.x && l.y === pick.y);
      const lights = layer.lights.filter((l) => l !== old);
      if (!old && lights.length >= 100) return say("Limite de 100 focos de luz por mapa.");
      const dim = data.dim === "" || data.dim == null ? null : Math.round(Number(data.dim));
      if (dim != null && !(dim >= radius && dim <= 30)) return say("A penumbra vai do raio da luz até 30 casas.");
      const intensity = data.intensity == null || data.intensity === "" ? old?.intensity ?? null : Math.round(Number(data.intensity));
      if (intensity != null && !(intensity >= 10 && intensity <= 100)) return say("A intensidade vai de 10 a 100.");
      const visual = data.radius != null && "color" in data ? { dim: dim === radius ? null : dim, color: data.color && data.color.toLowerCase() !== "#ffbe64" ? data.color.toLowerCase() : null, intensity: intensity === 100 ? null : intensity, animation: data.animation || null } : {};
      lights.push({ ...(old || {}), x: pick.x, y: pick.y, radius, ...visual });
      change(old ? "Atualizar foco de luz" : "Foco de luz", () => { layer = { ...layer, lights }; });
      return refresh();
    }
    if (f.matches("[data-mark-form]")) {
      const label = String(data.label || "").trim();
      if (!label) return say("Dê um nome de até 40 caracteres à marca.");
      const num = (v) => (v === "" || v == null ? null : Math.round(Number(v)));
      const old = layer.marks.find((m) => m.x === pick.x && m.y === pick.y);
      const marks = layer.marks.filter((m) => m !== old);
      if (!old && marks.length >= 100) return say("Limite de 100 marcas ocultas por mapa.");
      marks.push({ ...(old || {}), x: pick.x, y: pick.y, kind: data.kind, label: label.slice(0, 40), dc: num(data.dc), maxDistance: num(data.maxDistance), sense: data.sense || null });
      change(old ? "Atualizar marca oculta" : "Marca oculta", () => { layer = { ...layer, marks }; });
      return refresh();
    }
    if (f.matches("[data-apply-form]")) return apply(f);
    if (f.matches("[data-grid-form]")) return saveGrid();
  }
  const onFocusOut = (e) => { if (e.target.matches?.("input, textarea, select")) commitTyping(); };
  // Ctrl/Shift + clique soma à seleção: o tabuleiro não repassa o evento, então guardamos as teclas no início do toque.
  const onStagePointer = (e) => { mods.add = e.ctrlKey || e.metaKey || e.shiftKey; };
  // Ferramenta Zoom: o clique no mapa aproxima (Alt/Shift afasta) em vez de agir sobre a casa.
  const onStageClick = (e) => {
    if (tool !== "zoom" || !boardHost.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    (e.altKey || e.shiftKey ? board.camera.zoomOut : board.camera.zoomIn)();
    shell.updateZoom();
  };
  // Setas movem a seleção com o mapa em foco; Enter abre as propriedades do marcador selecionado.
  function onStageKey(e) {
    if (e.target !== boardHost.querySelector("canvas")) return;
    if (e.key === "Enter" && !e.repeat) {
      mods.add = e.ctrlKey || e.metaKey || e.shiftKey;
      const press = enterPress = { used: false };
      setTimeout(() => {
        if (enterPress === press) enterPress = null;
        if (!press.used && !simulate && tool === "select" && selection.length === 1) openTokenProperties(selection[0]);
      }, 0);
      return;
    }
    const d = ARROWS[e.key];
    if (!d || simulate || tool !== "select" || !editableSelection().length || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopPropagation();
    nudge(d[0], d[1]);
  }
  const onDoubleClick = (e) => {
    if (tool !== "select" || simulate || selection.length !== 1) return;
    const c = board.camera.cellAt(e.clientX, e.clientY), t = draft.prepared[selection[0]];
    if (c && t && c.x === t.x && c.y === t.y) openTokenProperties(selection[0]);
  };
  // Arrastar do painel Personagens para o mapa (tipo próprio; o resto é ignorado).
  const onDragStart = (e) => {
    const li = e.target.closest?.("[data-se-char]");
    if (!li || !e.dataTransfer) return;
    e.dataTransfer.setData(DND, li.dataset.seChar);
    e.dataTransfer.setData("text/plain", li.querySelector("span")?.firstChild?.textContent || "");
    e.dataTransfer.effectAllowed = "copy";
  };
  const accepts = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(DND) && !!meta && mapKind() && !simulate && !composing();
  const onDragOver = (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    shell.stage.classList.add("se-dragover");
    onHover(board.camera.cellAt(e.clientX, e.clientY));
  };
  const onDragLeave = (e) => { if (!shell.stage.contains(e.relatedTarget)) shell.stage.classList.remove("se-dragover"); };
  const onDrop2 = (e) => {
    shell.stage.classList.remove("se-dragover");
    if (!accepts(e)) return;
    e.preventDefault();
    const ref = e.dataTransfer.getData(DND);
    const c = freeOn() ? board.camera.pointAt(e.clientX, e.clientY) : board.camera.cellAt(e.clientX, e.clientY);
    if (!ref) return;
    if (!c) return say("Solte o personagem dentro do mapa.");
    placeRef(ref, c);
  };
  // Enter termina o traço de parede (o tabuleiro não consome Enter no modo vetorial).
  const onWallKey = (e) => { if (e.key === "Enter" && tool === "vwall" && wallPts.length && !isTypingTarget(e.target)) { e.preventDefault(); finishWall(); } };
  root.addEventListener("keydown", onWallKey);
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("dragstart", onDragStart);
  shell.stage.addEventListener("pointerdown", onStagePointer, true);
  shell.stage.addEventListener("click", onStageClick, true);
  shell.stage.addEventListener("keydown", onStageKey, true);
  shell.stage.addEventListener("dragover", onDragOver);
  shell.stage.addEventListener("dragleave", onDragLeave);
  shell.stage.addEventListener("drop", onDrop2);
  boardHost.addEventListener("dblclick", onDoubleClick);
  // Botão direito fora do canvas (imagem sem grade, palco vazio): mesmo menu do editor, nunca o do navegador.
  const onStageMenu = (e) => {
    if (e.target.closest("canvas, input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    onContext({ cell: null, token: null, x: e.clientX, y: e.clientY });
  };
  shell.stage.addEventListener("contextmenu", onStageMenu);
  // Imagens: soltar no palco inteiro (também na cena vazia), colar com Ctrl+V e arrastar do Acervo (ADR-090).
  const disposeDrop = mapOnly ? () => {} : mountImageDrop(shell.stage, {
    enabled: () => !simulate && !busy && !uploading && draft.kind !== "text",
    onFiles: (files, p) => handleFiles(files, p),
    onAsset: (item, p) => addFromAsset(item, p),
  });
  const pasting = listenPaste((files) => handleFiles(files, null), {
    enabled: () => !closed && !mapOnly && !simulate,
    fallback: () => { if (composing()) { if (!composer?.paste(composer.lastPointer())) say("Nada para colar. Copie uma imagem ou um elemento antes."); else afterCompose(); } else paste(); },
  });
  function startAction(id) {
    if (id === "upload") return pickImages();
    if (id === "map" || id === "model") { openPanel("scenery"); return say(id === "model" ? "Os cenários prontos ficam no grupo “Cenários prontos”." : "Escolha um mapa da campanha."); }
    if (id === "blank") { startChoice = { blank: true }; renderSide(); showProps(); }
  }

  function cleanup() {
    disposeDrop(); pasting.dispose(); composer?.destroy(); clearTimeout(previewTimer2);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    imageCache.clear();
    shell.stage.removeEventListener("contextmenu", onStageMenu);
    closed = true;
    root.removeEventListener("click", onClick); root.removeEventListener("keydown", onWallKey); clearTimeout(previewTimer); root.removeEventListener("input", onInput); root.removeEventListener("change", onChange);
    root.removeEventListener("submit", onSubmit); root.removeEventListener("focusout", onFocusOut); root.removeEventListener("dragstart", onDragStart);
    shell.stage.removeEventListener("pointerdown", onStagePointer, true); shell.stage.removeEventListener("click", onStageClick, true);
    shell.stage.removeEventListener("keydown", onStageKey, true); shell.stage.removeEventListener("dragover", onDragOver);
    shell.stage.removeEventListener("dragleave", onDragLeave); shell.stage.removeEventListener("drop", onDrop2);
    boardHost.removeEventListener("dblclick", onDoubleClick);
    disposePicker(); disposeGrid?.dispose();
    board.destroy();
    onClose?.({ id: saved.id });
  }

  /**
   * Rascunho local (cena e preparação do mapa da edição) e versões da cena (ADR-083). Restaurar mantém as revisões de
   * origem: se a cena ou a preparação mudaram depois, salvar mostra o conflito em vez de sobrescrever.
   */
  function attachSceneDrafts() {
    const revisionOf = () => ({ scene: saved.revision, layer: meta?.prepVersion ?? meta?.revision ?? null });
    async function put(nextDraft, nextLayer, reset, label) {
      commitTyping();
      const mapChanged = nextDraft.mapKey !== draft.mapKey || nextDraft.kind !== draft.kind;
      // Outro cenário: a preparação do mapa é recarregada e o desfazer recomeça (instantâneos de outro mapa não valem).
      if (!mapChanged) history.record(label);
      draft = clone(nextDraft);
      if (nameInput) nameInput.value = draft.name;
      if (mapChanged) { await loadLayer(); resetHistory(`${label}: outro cenário, o histórico de desfazer recomeça.`); }
      const applied = !!(nextLayer && layer && nextLayer.cells?.length === layer.cells?.length);
      if (applied) layer = clone(nextLayer);
      resetExploration = !!reset && !!layer;
      selection = []; pick = null;
      if (!draft.layers.some((l) => l.id === activeLayer)) activeLayer = "elements";
      recomputeDirty(); renderAll();
      return applied;
    }
    return attachDrafts(shell, {
      campaignId: campaign.id, kind: mapOnly ? "maplayer" : "scene", versionKind: mapOnly ? null : "scene",
      docId: () => (mapOnly ? draft.mapKey : saved.id), label: () => (mapOnly ? meta?.name || "" : draft.name),
      revision: revisionOf, capture, isDirty: () => sceneDirty || layerDirty,
      restore: async (snap, rev) => {
        const applied = await put(snap.draft, snap.layer, snap.reset, "Restaurar rascunho");
        if (Number.isInteger(rev?.scene) && !mapOnly) saved.revision = rev.scene;
        if (applied && meta && rev?.layer != null) { if (typeof rev.layer === "string") meta.prepVersion = rev.layer; else meta.revision = rev.layer; }
      },
      loadVersion: (payload) => put(toDraft({ ...payload, layers: payload.layers }), null, false, "Carregar versão").catch((e) => say(e.message)),
    });
  }

  (async () => {
    try { await loadLayer(); } catch (e) { error = e.message; }
    if (closed) return;
    drafts = attachSceneDrafts();
    // Cena sem fundo: o palco mostra "Como deseja começar?" e aceita imagens soltas em qualquer ponto (ADR-090).
    if (shell.context === "compose" && composable()) onWorkContext("compose");
    recomputeDirty();
    renderAll();
    schedulePreview();
    if (!mapOnly) loadNpcs();
    if (!mapOnly && !saved.id) nameInput?.focus(); else board.focus();
  })();
  return shell.whenClosed.then(async () => {
    // "Abrir o mapa original": edita o recurso compartilhado e volta a esta cena (já salva) ao fechar o editor do mapa.
    if (!reopen || !saved.id) return { id: saved.id };
    const m = mapOf(draft.mapKey) || { id: reopen.mapId };
    try {
      if (reopen.tiles) await (await import("./tile-map-editor.js")).openTileMapEditor(campaign, { item: m });
      else await (await import("./image-map-editor.js")).openImageMapEditor(campaign, { item: m });
    } catch { /* o editor do mapa mostra o próprio erro */ }
    return openSceneEditor({ campaign, sceneId: saved.id, onClose });
  });
}
