// Editor único de cenas (preparação privada) sobre o núcleo gráfico comum (ADR-081): menus, ferramentas, palco,
// painéis Propriedades/Camadas/Estrutura/Personagens/Histórico e barra de estado.
// Usado na Preparação da campanha, na preparação compartilhada de um mapa (`kind: "layer"`) e sobre a mesa ao vivo,
// sem substituí-la. Escritas por api.js; o servidor valida grade, permissões e conflitos de revisão.
// Nada aqui apresenta a cena aos jogadores: "Aplicar à cena atual" e "Reiniciar cena" são ações explícitas.
import { helpButton, dismissHelp } from "./help.js";
import { api } from "./api.js";
import { esc, button, iconButton } from "./ui.js";
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
  nearestFreeCell, slotToken, slotIndex, nextSlotName, MAX_SLOTS, SIZE_PRESETS, sizePresetPatch, sizePresetOf, QUICK_CATEGORIES, quickAssetItems,
} from "./scene-policy.js";
import { createSlotStore, slotImageSrc, slotPreviewHtml, archetypeSvg } from "./party-slots.js";
import {
  PROFILE_PRESETS, profileLabel, sandboxFrom, rehearsalToken, rehearsalDiff, diffLines, applyRehearsal, sandboxChanged, observerOptions,
  defaultObserver, viewerFields, previewProfiles,
} from "./rehearsal-policy.js";
import { normalizeUserPrefs, userPrefsKey, touchRecent } from "./prep-explorer-policy.js";
import { state as appState } from "./state.js";
import { mountImageDrop, listenPaste, splitImageFiles, baseName, readImageSize, assetListHtml, bindAssetList } from "./image-drop.js";
import { MAP_ELEMENT, blankSceneComposition, loadSceneComposition, sceneSourceResolver, flattenPreview, flattenOverlay, createImageCache, createSceneComposer } from "./scene-composition.js";
import * as CP from "./composition-policy.js";
import { sceneWeight } from "./scene-weight-policy.js";
import { LIGHT_PRESETS, CUSTOM, presetText, lightPresetOf, presetById } from "./light-presets-policy.js";
import { LOOK_IMAGE, LOOK_ROUND, MIN_SIZE, MAX_SIZE, SIZE_STEP, DEFAULT_SIZE, clampSize, hasSpan, tokenSpan, ARCHETYPES, archetypeOf } from "./token-look.js";

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
  let characters = scene?.characters || sceneList?.characters || [];
  // Personagens reservados da campanha (ADR-110): vêm com a cena quando o servidor já os inclui; senão, sob demanda.
  const slotStore = createSlotStore(campaign.id, scene?.slots || sceneList?.slots || null);
  let renaming = null, slotBusy = false, binding = null, imagePick = null;
  // Ensaio (ADR-111): caixa de areia da preparação enquanto `simulate` está ligado; nada dele vai ao rascunho sem "Aplicar".
  let rehearsal = null;
  // Acervo rápido: categoria e busca (por contexto de trabalho).
  let quickCat = "", quickQuery = "";
  let savedLayerMode = draft.layerMode;
  /** Trocar o alcance só passa a valer depois de salvar: até lá, a camada do mapa não é editada. */
  const layerLocked = () => draft.layerMode !== savedLayerMode;
  let npcs = null, npcLoading = null;
  /** Forma escolhida para os próximos personagens do mestre colocados no mapa (ADR-079): redondo ou a própria imagem. */
  let placeLook = LOOK_ROUND;
  let layer = null, meta = null;
  // Estado salvo (para recalcular "alterações não salvas" depois de desfazer/refazer).
  let savedScene = clone(draft), savedLayer = null;
  let sceneDirty = false, layerDirty = false, resetExploration = false;
  let tool = "select", selection = [], pick = null, panel = "overview", simulate = false, grid = true, conflict = null, applying = false, busy = false;
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
    // ADR-113: também na Busca de ações; abre a lista de mapas com grade da campanha (inserção no centro da vista).
    T("mapInstance", "layers", "", "scene", false, { hidden: () => mapOnly || draft.kind === "text", action: () => openMapInstanceMenu() }),
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
      { id: "elements", label: mapOnly ? "Elementos" : "Personagens", groups: ["elements"], tools: ["add", "entry"], panels: ["props", "layers", "structure", "characters", ...(mapOnly ? [] : ["assets"])], defaultTool: "select" },
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
      ...(mapOnly ? [] : [{ id: "assets", title: "Acervo rápido", help: ["campanhas.cenas.acervo-rapido", "Acervo rápido"] }]),
      { id: "history", title: "Histórico", basic: false },
    ],
    onContext: (id) => onWorkContext(id),
    actions: `${nameField}${button(`${icon("eye")}<span>Ensaiar cena</span>`, "se-preview", "", "subtle", 'aria-pressed="false" data-tip="Ensaiar cena" data-tip-detail="Veja como jogador e teste posições, luz e visão sem alterar a mesa."')}${button("Salvar preparação", "se-save", "", "primary")}<span id="se-apply-slot"></span>`,
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
    onResize: (t, patch) => resizeToken(Number(String(t.id).slice(1)), patch),
    // Durante o arraste: casa recusada em vermelho e o motivo na dica, sem gravar nada (Esc desiste).
    dropProblem: (t, c) => dropProblemOf(Number(String(t.id).slice(1)), c),
    onDragHint: (text) => liveHint(text, true),
    onResizing: (t, text) => liveHint(text ? `${t.label}: ${text}` : "", false),
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
  function undo() { commitTyping(); if (simulate) return rehearsalUndo(); const label = history.undo(); say(label ? `Desfeito: ${label}.` : "Nada para desfazer."); }
  function redo() { commitTyping(); if (simulate) return say("No ensaio, Ctrl+Z desfaz o último passo; refazer não está disponível."); const label = history.redo(); say(label ? `Refeito: ${label}.` : "Nada para refazer."); }

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
  /**
   * Imagem de prévia do marcador no editor: a própria (acervo da campanha ou link https) ou a do personagem do mestre.
   * Sem imagem, o marcador só pode ser redondo. Personagens dos jogadores não têm imagem na preparação.
   */
  function tokenImage(t) {
    // Personagens dos jogadores não têm imagem na preparação; o reservado vinculado pode manter a dele (ADR-110).
    if (!t || (t.characterId && !t.slotId)) return null;
    const own = typeof t.imageUrl === "string" ? t.imageUrl : "";
    if (own.startsWith("asset:")) return /^asset:[0-9a-f-]{32,36}$/i.test(own) ? `/api/campaigns/${encodeURIComponent(campaign.id)}/assets/maps/${own.slice(6)}/image` : null;
    if (own.startsWith("https://")) return own;
    // Reservado: a imagem é a do próprio reservado (referência; nada é copiado para a cena).
    if (t.slotId) return slotImageSrc(campaign.id, slotStore.byId(t.slotId)?.imageUrl);
    if (!t.masterCharacterId) return null;
    const preview = (npcs || []).find((n) => n.id === t.masterCharacterId)?.imagePreview;
    return typeof preview === "string" && (preview.startsWith("/api/") || preview.startsWith("https://")) ? preview : null;
  }
  const lookOf = (t) => (t?.appearance === LOOK_IMAGE ? LOOK_IMAGE : LOOK_ROUND);
  /** Voltar à imagem com área própria (ADR-092) faz o marcador ocupar a área de novo: ela precisa caber e estar livre. */
  function lookProblem(i, look) {
    const t = draft.prepared[i], area = tokenSpan({ ...t, appearance: look === LOOK_IMAGE ? LOOK_IMAGE : null });
    return area.w * area.h > 1 ? placementProblem(layer?.cells, width(), height(), draft.prepared, t.x, t.y, i, freeOn(), area) : "";
  }
  const LOOK_OPTIONS = [[LOOK_ROUND, "Marcador redondo"], [LOOK_IMAGE, "Imagem livre do personagem"]];
  /** Troca a forma de um marcador (redondo ou imagem). A imagem exige uma imagem do personagem ou do marcador. */
  function setTokenLook(i, look) {
    const t = draft.prepared[i];
    if (!t || simulate || !editable(i) || lookOf(t) === look) return;
    if (look === LOOK_IMAGE && !tokenImage(t)) return say("Este personagem não tem imagem. Escolha uma na ficha dele, na Preparação.");
    const problem = lookProblem(i, look);
    if (problem) return say(problem);
    change(look === LOOK_IMAGE ? "Mostrar como imagem" : "Mostrar como marcador redondo", () => { draft.prepared[i] = { ...t, appearance: look === LOOK_IMAGE ? LOOK_IMAGE : null }; });
    refresh();
  }

  function boardState() {
    const m = mapOf(draft.mapKey);
    // Com composição, o tabuleiro mostra o mapa já com as imagens da cena (prévia achatada no navegador).
    const shown = previewUrl && compElements() ? previewUrl : null;
    if (draft.kind === "image" && m) return { map: { kind: "cartographic", key: m.key, name: m.name, imageUrl: shown || m.imageUrl || "/assets/valley.webp", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    if (!meta) return { map: { kind: "cartographic", key: "none", name: "", imageUrl: "", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    // No ensaio, o tabuleiro desenha a caixa de areia (ids "p{índice}" nela); fora dele, a preparação.
    const source = simulate && rehearsal ? rehearsal.sandbox : draft.prepared;
    let tokens = source.map((t, i) => {
      // Camadas da cena: olho e opacidade só mudam o desenho no editor; a simulação mostra o que os jogadores veem.
      const alpha = simulate ? 1 : layerAlpha(layerOfToken(t));
      const image = tokenImage(t);
      // Reservado sem vínculo: contorno tracejado e selo "R"; token de ensaio: pontilhado e selo "E" (só no editor).
      const cue = t.rehearsal ? "rehearsal" : t.slotId && !t.characterId ? "reserved" : null;
      const glyph = t.slotId && !image ? slotStore.byId(t.slotId)?.archetype || null : null;
      return { id: "p" + i, characterId: t.characterId || null, label: t.label, side: t.side || "ally", x: t.x, y: t.y, fx: t.fx ?? null, fy: t.fy ?? null, hidden: !!t.hidden, light: t.light ?? null, appearance: t.appearance ?? null, size: t.size ?? null, width: t.width ?? null, height: t.height ?? null, image, alpha: alpha < 1 ? alpha : null, cue, glyph };
    });
    // Imagens de personagens do mestre chegam com a lista deles; sem ela, o desenho cai no marcador redondo até carregar.
    if (npcs == null && !mapOnly && source.some((t) => t.masterCharacterId)) loadNpcs();
    let fog;
    if (simulate && serverView) {
      // Resultado do servidor: idêntico ao que o jogador receberia (paredes, luz, visão, sentidos, percepção e exploração).
      fog = serverView.active ? { active: true, visible: serverView.visible, explored: serverView.explored, cells: serverView.cells, lights: serverView.lights, marks: serverView.marks, walls: serverView.walls } : { active: false };
      const shown = new Set(serverView.shown), perceived = new Set(serverView.perceived || []);
      // Percebido não revela nome, imagem, forma nem porte (como na mesa).
      tokens = tokens.filter((_, i) => shown.has(i)).map((t) => (perceived.has(Number(t.id.slice(1))) ? { ...t, label: "?", perceived: true, image: null, appearance: null, size: null, width: null, height: null, cue: null, glyph: null } : t));
    } else if (simulate) {
      requestServerView();
      const observer = rehearsal?.observer || "";
      const sim = simulateView({ visionMode: draft.visionMode, layer, width: width(), height: height(), tokens, characters, settings: meta.settings || {}, scale: meta.scaleMeters || 1.5, viewer: observer.startsWith("c:") ? observer.slice(2) : null });
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
      selected: simulate ? (sandboxSelected() >= 0 ? "p" + sandboxSelected() : null) : selection.length === 1 ? "p" + selection[0] : null, selectedIds: simulate ? [] : selection.map((i) => "p" + i),
      // Ensaio: os tokens da caixa de areia também são arrastados e redimensionados (nada vai ao rascunho).
      draggable: tool === "select" ? "*" : null, viewAs: simulate,
      // Alças do marcador selecionado: tamanho do redondo; largura e altura da imagem livre (ADR-092).
      resizable: tool === "select" && (simulate ? sandboxSelected() >= 0 : selection.length === 1 && editable(selection[0])),
    };
  }
  const redraw = () => board.update(boardState(), boardView());

  // ---------- Ensaiar cena (ADR-111): caixa de areia sobre a preparação ----------
  const sandboxSelected = () => (rehearsal?.selected ? rehearsal.sandbox.findIndex((t) => t.key === rehearsal.selected) : -1);
  /** Uma mudança no ensaio: guarda o estado anterior (Ctrl+Z do ensaio) e pede nova prévia ao servidor. */
  function sandboxChange(label, fn) {
    if (!rehearsal) return;
    rehearsal.past.push(clone(rehearsal.sandbox));
    if (rehearsal.past.length > 50) rehearsal.past.shift();
    fn();
    serverView = null; serverViewError = "";
    redraw(); renderSimBanner(); renderSide();
    if (label) say(`${label}.`);
  }
  function sandboxMove(k, cell) {
    const t = rehearsal?.sandbox[k];
    if (!t) return false;
    const problem = placementProblem(layer?.cells, width(), height(), rehearsal.sandbox, cell.x, cell.y, k, freeOn(), tokenSpan(t));
    if (problem) { say(problem); return false; }
    sandboxChange(`Ensaio: ${t.label} na coluna ${cell.x + 1}, linha ${cell.y + 1}`, () => { rehearsal.sandbox[k] = { ...t, ...fineOf(cell) }; rehearsal.selected = t.key; });
    return true;
  }
  function sandboxResize(k, patch) {
    const cur = rehearsal?.sandbox[k];
    if (!cur) return false;
    const next = { ...cur, ...patch };
    if (!freeOn()) { next.fx = null; next.fy = null; }
    const problem = placementProblem(layer?.cells, width(), height(), rehearsal.sandbox, next.x, next.y, k, freeOn(), tokenSpan(next));
    if (problem) { say(problem); return false; }
    sandboxChange(`Ensaio: novo tamanho de ${cur.label}`, () => { rehearsal.sandbox[k] = next; });
    return true;
  }
  function sandboxRemove(k) {
    const t = rehearsal?.sandbox[k];
    if (!t) return;
    sandboxChange(`Ensaio: ${t.label} retirado`, () => {
      rehearsal.sandbox.splice(k, 1);
      if (rehearsal.selected === t.key) rehearsal.selected = null;
      if (rehearsal.observer === `t:${t.key}`) rehearsal.observer = defaultObserver(rehearsal.sandbox);
    });
  }
  /** Personagem, reservado ou NPC colocado durante o ensaio: entra só na caixa de areia (ou move o que já está nela). */
  function sandboxPlace(token, cell, label) {
    const list = rehearsal.sandbox;
    const existing = token.characterId ? list.findIndex((t) => t.characterId === token.characterId) : token.slotId ? slotIndex(list, token.slotId) : -1;
    if (existing >= 0) return sandboxMove(existing, cell);
    if (list.length >= 60) { say("Use até 60 tokens no ensaio."); return false; }
    const problem = placementProblem(layer?.cells, width(), height(), list, cell.x, cell.y, -1, freeOn(), tokenSpan(token));
    if (problem) { say(problem); return false; }
    const key = `n${++rehearsal.counter}`;
    sandboxChange(`Ensaio: ${label}`, () => { list.push({ ...token, ...fineOf(cell), hidden: !!token.hidden, layer: activeTokenLayer(), ref: null, key }); rehearsal.selected = key; });
    return true;
  }
  /**
   * Token de ensaio (local, nunca salvo) perto do cursor. Começa "Carregando uma fonte de luz": sem perfil, a mesa padrão
   * não dá visão nem luz a um token sem ficha, e a prévia ficaria escura.
   */
  function addRehearsalToken() {
    if (!rehearsal) return;
    if (rehearsal.sandbox.length >= 60) return say("Use até 60 tokens no ensaio.");
    const at = hover || lastCell || { x: Math.floor(width() / 2), y: Math.floor(height() / 2) };
    const spot = nearestFreeCell(layer?.cells, width(), height(), rehearsal.sandbox, at.x, at.y, freeOn());
    if (!spot) return say("Não há casa livre para o token de ensaio.");
    const key = `r${++rehearsal.counter}`;
    sandboxChange("Token de ensaio colocado (com uma fonte de luz; troque o perfil no painel)", () => {
      rehearsal.sandbox.push(rehearsalToken(rehearsal.sandbox, spot, key));
      rehearsal.profiles.set(key, { id: "torch" });
      rehearsal.selected = key;
      if (!rehearsal.observer) rehearsal.observer = `t:${key}`;
    });
  }
  function rehearsalUndo() {
    const prev = rehearsal?.past.pop();
    if (!prev) return say("Nada para desfazer no ensaio.");
    rehearsal.sandbox = prev;
    if (sandboxSelected() < 0) rehearsal.selected = null;
    serverView = null; serverViewError = "";
    redraw(); renderSimBanner(); renderSide();
    say("Desfeito no ensaio.");
  }
  /** Sai do ensaio descartando a caixa de areia. Pergunta antes só quando algo mudou. False = a pessoa preferiu ficar. */
  function leaveRehearsal(ask = true) {
    if (!simulate) return true;
    if (ask && rehearsal && sandboxChanged(rehearsal.start, rehearsal.sandbox) && !confirm("Sair do ensaio descarta o que você mudou nele. A preparação continua como estava. Sair?")) return false;
    simulate = false; rehearsal = null; serverView = null; serverViewError = ""; imagePick = imagePick?.target.kind === "sandbox" ? null : imagePick;
    liveHint("");
    return true;
  }
  /** Leva o resultado do ensaio ao rascunho numa única entrada do histórico (Ctrl+Z desfaz). Tokens de ensaio não entram. */
  function applyRehearsalChanges() {
    if (!rehearsal) return;
    const diff = rehearsalDiff(draft.prepared, rehearsal.sandbox);
    if (!diff.changed) return say(diff.rehearsalOnly.length ? "Nada a aplicar: tokens de ensaio não são salvos. Use “Converter em personagem reservado” para guardar um deles." : "Nada mudou no ensaio.");
    if (!confirm(`Aplicar as alterações do ensaio à preparação?\n\n${diffLines(diff).map((l) => `• ${l}`).join("\n")}\n\nDá para desfazer com Ctrl+Z. Os jogadores só veem ao apresentar ou aplicar a cena.`)) return;
    const next = applyRehearsal(draft.prepared, rehearsal.sandbox).map((t) => ({ ...t, layer: tokenLayerOf(t.layer, draft.layers) }));
    leaveRehearsal(false);
    change("Aplicar ensaio à preparação", () => { draft.prepared = next; });
    selection = []; if (panel === "token") panel = "overview";
    renderAll();
    say("Alterações do ensaio aplicadas à preparação. Salve para guardar.");
  }
  /** Token de ensaio vira personagem reservado da campanha; ao aplicar, entra na preparação com o vínculo ao reservado. */
  async function convertToSlot(key) {
    const k = rehearsal?.sandbox.findIndex((t) => t.key === key) ?? -1;
    const t = rehearsal?.sandbox[k];
    if (!t?.rehearsal) return;
    if (slotStore.items.length >= MAX_SLOTS) return say(`Use até ${MAX_SLOTS} personagens reservados por campanha.`);
    try {
      const name = nextSlotName(slotStore.items.map((s) => s.name), String(t.label || "Personagem").slice(0, 34));
      const slot = await slotStore.create({ name, imageUrl: t.imageUrl ?? null, appearance: t.appearance ?? null, size: t.size ?? null, width: t.width ?? null, height: t.height ?? null });
      if (!rehearsal) return;
      const i = rehearsal.sandbox.findIndex((x) => x.key === key);
      if (i < 0) return;
      sandboxChange(`“${slot.name}” agora é um personagem reservado; aplique o ensaio para guardar a posição`, () => {
        const { rehearsal: _r, ...rest } = rehearsal.sandbox[i];
        rehearsal.sandbox[i] = { ...rest, slotId: slot.id, label: slot.name, side: "ally", converted: true };
      });
      renderCharacterList(); renderAssets(true);
    } catch (e) { say(e.message); }
  }
  /** Casa de destino recusada durante o arraste (mesmas regras de soltar). */
  function dropProblemOf(i, c) {
    if (simulate) {
      const t = rehearsal?.sandbox[i];
      return t ? placementProblem(layer?.cells, width(), height(), rehearsal.sandbox, c.x, c.y, i, freeOn(), tokenSpan(t)) : "";
    }
    const t = draft.prepared[i];
    if (!t) return "";
    if (!editable(i)) return "Esse marcador está numa camada oculta ou bloqueada.";
    if (selection.length > 1 && selection.includes(i) && !freeOn()) return moveTokensBy(layer?.cells, width(), height(), draft.prepared, editableSelection(), c.x - t.x, c.y - t.y, false).error || "";
    return placementProblem(layer?.cells, width(), height(), draft.prepared, c.x, c.y, i, freeOn(), tokenSpan(t));
  }
  /** Dica temporária sobre o palco (casa recusada no arraste; tamanho durante a alça). Vazia volta à dica da ferramenta. */
  let hintOverride = "";
  function liveHint(text, problem = false) {
    const el = q("#se-hint");
    if (!el) return;
    hintOverride = text || "";
    el.classList.toggle("se-hint-error", !!hintOverride && problem);
    if (hintOverride) { el.textContent = hintOverride; el.hidden = false; return; }
    const normal = stageHint();
    el.textContent = normal; el.hidden = !normal;
  }

  // ---------- Edição no tabuleiro ----------
  function moveToken(i, cell) {
    if (simulate || i == null || !draft.prepared[i]) return false;
    if (!editable(i)) { say("Esse marcador está numa camada oculta ou bloqueada."); return false; }
    const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, cell.x, cell.y, i, freeOn(), tokenSpan(draft.prepared[i]));
    if (problem) { say(problem); return false; }
    change("Mover marcador", () => { draft.prepared[i] = { ...draft.prepared[i], ...fineOf(cell) }; });
    refresh();
    return true;
  }
  /**
   * Alça do tabuleiro: tamanho do redondo ou área da imagem livre (largura, altura e canto; ADR-092).
   * No tático a área inteira precisa caber e estar livre, como no servidor. True quando aplicado.
   */
  function resizeToken(i, patch) {
    if (simulate) return sandboxResize(i, patch);
    const cur = draft.prepared[i];
    if (!cur || !editable(i)) return false;
    const next = { ...cur, ...patch };
    if (!freeOn()) { delete next.fx; delete next.fy; }
    const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, next.x, next.y, i, freeOn(), tokenSpan(next));
    if (problem) { say(problem); return false; }
    change(patch.width != null ? "Redimensionar imagem" : "Mudar tamanho do marcador", () => { draft.prepared[i] = { ...next, fx: freeOn() ? next.fx ?? null : null, fy: freeOn() ? next.fy ?? null : null }; });
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
    const i = Number(t.id.slice(1));
    if (simulate) return sandboxMove(i, c);
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
    lastCell = { x: t.x, y: t.y };
    if (simulate) {
      const s = rehearsal?.sandbox[Number(t.id.slice(1))];
      if (!s) return;
      rehearsal.selected = rehearsal.selected === s.key ? null : s.key;
      board.setView(boardView()); renderSide();
      return say(rehearsal.selected ? `${s.label} selecionado no ensaio: arraste, use as alças ou o menu (botão direito).` : "Seleção desfeita.");
    }
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
    if (!meta) return;
    if (simulate) { lastCell = c; const k = sandboxSelected(); if (k >= 0 && tool === "select") sandboxMove(k, c); return; }
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
      <div class="form-actions se-icon-row" role="group" aria-label="Ações da parede">${one ? iconButton("split", "Dividir no meio", "se-wall", "split") : ""}${one ? iconButton("vertex", "Remover vértice final", "se-wall", "vertex") : ""}${sel.length > 1 ? iconButton("join", "Unir paredes", "se-wall", "join") : ""}${iconButton("copy", "Duplicar", "se-wall", "duplicate")}${iconButton("trash", "Excluir", "se-wall", "delete", "subtle danger-text")}</div>${common}</div>`;
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
      // Ensaio: a caixa de areia inteira (com tokens de ensaio e reservados), os perfis de teste e o observador escolhido.
      const sandbox = rehearsal?.sandbox || [];
      const body = {
        mapKey: draft.mapKey, sceneId: saved.id || null, visionMode: mapKind() ? draft.visionMode || null : null,
        tokens: sandbox.map((t) => ({ ...tokenInput(t), label: t.label, rehearsal: !!t.rehearsal })),
        profiles: previewProfiles(sandbox, rehearsal?.profiles || new Map()),
        ...viewerFields(rehearsal?.observer || "", sandbox),
        layer: { fog: layer.fog, cells: layer.cells, revealed: layer.revealed, revision: meta.revision,
          lights: layer.lights.map((l) => ({ x: l.x, y: l.y, radius: l.radius, dim: l.dim ?? null, color: l.color ?? null, intensity: l.intensity ?? null, animation: l.animation ?? null })),
          marks: layer.marks.map((m) => ({ id: m.id || null, x: m.x, y: m.y, kind: m.kind, label: m.label, dc: m.dc ?? null, sense: m.sense || null, maxDistance: m.maxDistance ?? null })),
          walls: walls().map((w) => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind, open: !!w.open, hidden: !!w.hidden })) },
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
    if (mapOnly || !mapKind() || !meta) { say("Personagens e marcadores entram em cenas de mapa tático."); return false; }
    if (simulate) return sandboxPlace(token, cell, label);
    const target = draft.layers.find((l) => l.id === activeTokenLayer());
    if (target?.locked) { say(`A camada “${target.name}” está bloqueada. Escolha outra em Camadas.`); return false; }
    // Personagem ou reservado já posicionado: arrastar de novo move o marcador existente (nunca cria duplicata).
    const existing = token.characterId ? draft.prepared.findIndex((t) => t.characterId === token.characterId) : token.slotId ? slotIndex(draft.prepared, token.slotId) : -1;
    if (existing >= 0) { selection = [existing]; panel = "token"; return moveToken(existing, cell); }
    const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, cell.x, cell.y, -1, freeOn(), tokenSpan(token));
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
    if (type === "slot") {
      const s = slotStore.byId(id);
      if (!s) { say("Esse personagem reservado não existe mais."); return false; }
      // Reservado vinculado: o marcador já é o personagem (mesma regra do servidor); senão, o token provisório.
      const token = { ...slotToken(s, activeTokenLayer()), ...(s.characterId ? { characterId: s.characterId, label: s.characterName || s.name } : {}) };
      const ok = placeToken(token, cell, "Colocar personagem reservado");
      if (ok) renderCharacterList();
      return ok;
    }
    const n = (npcs || []).find((x) => x.id === id);
    if (n) touchQuick(`character:${n.id}`);
    // Forma escolhida no painel; sem imagem do personagem, entra redondo.
    const appearance = placeLook === LOOK_IMAGE && tokenImage({ masterCharacterId: n.id }) ? LOOK_IMAGE : null;
    return n ? placeToken({ masterCharacterId: n.id, label: n.name.slice(0, 40), side: n.side || "enemy", hidden: false, appearance }, cell, "Colocar personagem do mestre") : false;
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
    if (simulate) { const k = sandboxSelected(); return k >= 0 ? sandboxRemove(k) : say("Selecione um token do ensaio para retirar."); }
    if (wallSel.length) return removeWalls();
    const ids = editableSelection();
    if (!ids.length) return say("Selecione um marcador para excluir.");
    removeIndices(ids, ids.length > 1 ? `Excluir ${ids.length} marcadores` : "Excluir marcador");
  }
  function copy() {
    const ids = editableSelection();
    if (!ids.length) return say("Selecione um marcador para copiar.");
    const own = ids.filter((i) => !draft.prepared[i].characterId && !draft.prepared[i].slotId);
    if (!own.length) return say("Personagens dos jogadores e reservados aparecem uma vez por cena; use Recortar para movê-los.");
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
    const own = editableSelection().filter((i) => !draft.prepared[i].characterId && !draft.prepared[i].slotId);
    if (!own.length) return say("Personagens dos jogadores e reservados aparecem uma vez por cena e não são duplicados.");
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
  /** Campos de largura e altura da imagem livre: casas no mapa tático, porcentagem da casa no modo livre. Vazios = encaixada no quadrado. */
  function spanFields(t) {
    const free = freeOn(), on = hasSpan({ ...t, appearance: LOOK_IMAGE });
    const value = (p) => (on ? (free ? p : Math.max(1, Math.round(p / 100))) : "");
    const common = free ? { unit: "% da casa", min: MIN_SIZE, max: MAX_SIZE, step: SIZE_STEP } : { unit: "casas", min: 1, max: MAX_SIZE / 100, step: 1 };
    return [
      { name: "spanW", label: "Largura da imagem", type: "number", ...common, value: value(t.width) },
      { name: "spanH", label: "Altura da imagem", type: "number", ...common, value: value(t.height), help: free ? "Vazio: a imagem cabe no quadrado do tamanho acima. Com largura e altura, ela estica para preencher. Também dá para arrastar as alças no mapa." : "Casas ocupadas pela criatura. Vazio: uma casa. A imagem estica para preencher. Também dá para arrastar as alças no mapa." },
    ];
  }
  /** Forma escolhida no diálogo; imagem só com imagem disponível. */
  const lookFromDialog = (v, cur) => {
    if (v.appearance === undefined) return cur.appearance ?? null;
    return v.appearance === LOOK_IMAGE && tokenImage(cur) ? LOOK_IMAGE : null;
  };
  /** Largura/altura (%) a partir do diálogo; sem os campos, mantém o que havia. */
  function spanFromDialog(v, cur) {
    if (v.spanW === undefined && v.spanH === undefined) return { width: cur.width ?? null, height: cur.height ?? null };
    if (v.spanW == null && v.spanH == null) return { width: null, height: null };
    if (v.spanW == null || v.spanH == null) throw new Error("Informe a largura e a altura da imagem (ou deixe as duas vazias).");
    const free = freeOn();
    const pct = (n) => (free ? clampSize(Math.round(n / SIZE_STEP) * SIZE_STEP) : Math.min(MAX_SIZE / 100, Math.max(1, Math.round(n))) * 100);
    return { width: pct(v.spanW), height: pct(v.spanH) };
  }
  function openTokenProperties(i) {
    const t = draft.prepared[i];
    if (!t || simulate) return;
    if (!editable(i)) return say("Esse marcador está numa camada oculta ou bloqueada.");
    const pc = !!t.characterId;
    // Reservado: nome e lado vêm do reservado (renomeie no painel Personagens); forma, tamanho e posição são da cena.
    const reserved = !!t.slotId && !pc;
    const fields = [
      pc || reserved ? { name: "label", label: "Nome", type: "static", value: t.label } : { name: "label", label: "Nome", type: "text", value: t.label, maxlength: 40, required: true },
      ...(pc ? [{ name: "kind", label: "Tipo", type: "static", value: "Personagem dos jogadores" }] : reserved ? [
        { name: "kind", label: "Tipo", type: "static", value: "Personagem reservado (aliado)" },
        { name: "hidden", label: "Oculto: só você vê até revelar", type: "checkbox", value: !!t.hidden },
      ] : [
        { name: "side", label: "Lado", type: "select", value: t.side || "enemy", options: SIDES },
        { name: "hidden", label: "Oculto: só você vê até revelar", type: "checkbox", value: !!t.hidden },
      ]),
      ...(mode === "complete" && !pc ? [{ name: "light", label: "Luz que carrega", unit: "casas", type: "number", min: 0, max: 30, step: 1, value: t.light ?? "", help: "Vazio usa o padrão da mesa." }] : []),
      ...(pc ? [] : [
        { name: "look", label: "Aparência", type: "heading" },
        tokenImage(t)
          ? { name: "appearance", label: "Forma no mapa", type: "select", value: lookOf(t), options: LOOK_OPTIONS }
          : { name: "appearance", label: "Forma no mapa", type: "static", value: "Marcador redondo (sem imagem)" },
        { name: "size", label: "Tamanho", unit: "% da casa", type: "number", min: MIN_SIZE, max: MAX_SIZE, step: SIZE_STEP, value: clampSize(t.size ?? DEFAULT_SIZE), required: true, help: "100% ocupa uma casa." },
        // Imagem livre (ADR-092): largura e altura próprias, esticando a imagem. Tático: casas inteiras ocupadas; livre: % da casa.
        ...(tokenImage(t) ? spanFields(t) : []),
      ]),
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
        const label = pc || reserved ? cur.label : String(v.label || "").trim().slice(0, 40);
        if (!label) throw new Error("Dê um nome ao marcador.");
        const x = Math.round(Number(v.x)) - 1, y = Math.round(Number(v.y)) - 1;
        const appearance = pc ? cur.appearance ?? null : lookFromDialog(v, cur);
        const span = pc ? { width: cur.width ?? null, height: cur.height ?? null } : spanFromDialog(v, cur);
        const area = tokenSpan({ ...cur, appearance, ...span }), before = tokenSpan(cur);
        if (x !== cur.x || y !== cur.y || area.w !== before.w || area.h !== before.h) {
          const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, x, y, i, freeOn(), area);
          if (problem) throw new Error(problem);
        }
        const fine = (n, old) => (freeOn() ? (n == null ? old ?? null : Math.max(0, Math.min(999, Math.round(n)))) : null);
        const target = tokenLayerOf(v.layer, draft.layers);
        if (target !== tokenLayerOf(cur.layer, draft.layers) && draft.layers.find((l) => l.id === target)?.locked) throw new Error("A camada escolhida está bloqueada.");
        change("Propriedades do marcador", () => {
          draft.prepared[i] = {
            ...cur, label, x, y, fx: fine(v.fx, cur.fx), fy: fine(v.fy, cur.fy), layer: target,
            ...(pc ? {} : {
              side: reserved ? cur.side || "ally" : v.side, hidden: !!v.hidden, appearance, ...span,
              size: clampSize(v.size) === DEFAULT_SIZE && cur.size == null ? null : clampSize(v.size),
            }),
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
    configureInstances();
    if (!id) {
      return openContextMenu(at, [
        { label: "Adicionar imagem…", run: () => pickImages() },
        { label: "Importar imagem por link…", run: () => importImageUrl(point) },
        instanceMenuItem(point),
        { label: "Selecionar próximo mapa inserido", disabled: !(draft.composition?.elements || []).some(MI_isInstance), disabledReason: "Nenhum mapa inserido nesta cena.", run: () => composeAction("nextMap") },
        { label: "Colar aqui", shortcut: "mod+v", disabled: !composer.hasClipboard, disabledReason: "Copie um elemento antes.", run: () => { composer.paste(point); afterCompose(); } },
        { label: "Selecionar tudo", shortcut: "mod+a", run: () => composer.select((draft.composition?.elements || []).filter((x) => CP.isSelectable(draft.composition, x)).map((x) => x.id), false) },
      ], { label: "Composição" });
    }
    const els = composer.selected(), one = els[0];
    const layers = compDoc().layers;
    const act = (fn) => () => { fn(); afterCompose(); };
    const inst = els.some(MI_isInstance);
    openContextMenu(at, [
      { label: "Propriedades…", shortcut: "enter", run: () => showProps() },
      ...(inst ? [
        { separator: true },
        { label: "Encaixar na grade da cena", run: () => composeAction("snapMap") },
        { label: "Trazer paredes, portas e luzes deste mapa", disabled: els.length !== 1 || !MI_isInstance(one), disabledReason: "Selecione um único mapa inserido.", run: () => importInstanceRules(one) },
        { label: "Encaixar mapas inseridos na grade", checked: snapMaps, run: () => { snapMaps = !snapMaps; say(snapMaps ? "Mapas inseridos encaixam na grade da cena: giro de 90° em 90° e movimento de casa em casa." : "Encaixe desligado: mapas inseridos movem e giram livremente (as regras só podem ser trazidas com o mapa encaixado)."); } },
        { label: "Mapa inserido anterior", run: () => composeAction("prevMap") },
        { label: "Próximo mapa inserido", run: () => composeAction("nextMap") },
        { separator: true },
      ] : []),
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
        ...(one && MI_isInstance(one) ? [
          { id: "snapMap", label: "Encaixar na grade da cena", icon: "grid" },
          { id: "importRules", label: "Trazer paredes, portas e luzes deste mapa", icon: "wall" },
          { id: "nextMap", label: "Próximo mapa inserido", icon: "next" },
        ] : []),
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
      snapMap: () => { configureInstances(); composer.snapInstances(); },
      nextMap: () => composer.selectInstance(1), prevMap: () => composer.selectInstance(-1),
      importRules: () => importInstanceRules(composer.selected()[0]),
    })[id]?.();
    afterCompose(); syncComposeBar();
  }
  // ---------- Mapas da campanha inseridos na cena (ADR-113) ----------
  // A cena tem uma grade global (a do mapa de fundo); cada mapa inserido é um elemento da composição com `mapKey` e encaixa
  // nessa grade. O original não é copiado nem alterado; regras só entram pela importação explícita abaixo.
  let snapMaps = true, MI = null;
  import("./map-instance-policy.js").then((m) => { MI = m; }).catch(() => {});
  function MI_isInstance(el) { return !!MI?.isMapInstance(el); }
  /** Grade da cena para as instâncias: a do mapa tático de fundo (null em cenas sem grade). */
  function instanceGrid() { return MI && mapKind() && meta ? MI.sceneGrid(meta) : null; }
  function configureInstances() { composer?.setInstances({ mapOf, grid: instanceGrid, snap: () => snapMaps }); }
  /** Mapas da campanha que podem ser inseridos (com grade, de imagem, outros que não o fundo). */
  function instanceChoices() { return MI ? maps.items.filter((m) => MI.canInstance(m) && m.key !== draft.mapKey) : []; }
  function instanceMenuItem(point) {
    const g = instanceGrid(), list = instanceChoices();
    const reason = !g ? "A cena precisa de um mapa tático (com grade) como fundo." : "Nenhum outro mapa com grade na campanha.";
    return { label: "Inserir mapa da campanha", disabled: !g || !list.length, disabledReason: reason, items: list.slice(0, 50).map((m) => ({ label: m.name, run: () => insertMapInstance(m, point) })) };
  }
  /** Ferramenta "Inserir mapa da campanha" (barra da Completa e Busca de ações): mesmo submenu do menu de contexto. */
  function openMapInstanceMenu() {
    const item = instanceMenuItem(null);
    if (item.disabled) return say(item.disabledReason);
    const r = shell.stage.getBoundingClientRect();
    openContextMenu({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 80) }, item.items, { label: item.label });
  }
  function insertMapInstance(m, point) {
    const g = instanceGrid();
    if (!g || !MI?.canInstance(m)) return say("Para inserir um mapa, a cena precisa de grade e o mapa também.");
    if (shell.context !== "compose") shell.setContext("compose");
    mountComposer();
    configureInstances();
    const el = composer.addMapInstance(m, g, point);
    if (!el) return;
    afterCompose(); syncComposeBar();
    say(`Mapa “${m.name}” inserido na grade da cena (casa de ${g.size} px). O original continua igual; paredes e luzes dele só entram com “Trazer paredes, portas e luzes deste mapa”.`);
  }
  /** Converte a preparação compartilhada do mapa original para casas da cena e junta à camada própria da cena (um passo de desfazer). */
  async function importInstanceRules(el) {
    if (!MI || !MI_isInstance(el)) return say("Selecione um mapa inserido.");
    if (draft.layerMode !== "scene") {
      say("As regras trazidas entram só na preparação própria desta cena. Em Configurações da cena, escolha “Própria desta cena” e salve; depois traga as paredes e luzes.");
      return openPanel("sceneSettings");
    }
    if (layerLocked()) return say("Salve o alcance da preparação antes de trazer regras.");
    const m = mapOf(el.mapKey), g = instanceGrid();
    if (!m || !g || !layer) return say("A cena precisa de grade e o mapa original precisa estar disponível.");
    const a = MI.alignment(el, m, g);
    if (!a.aligned) return say(a.problem);
    try {
      say(`Lendo a preparação de “${m.name}”…`);
      const src = await api(`${base}/assets/layers?key=${encodeURIComponent(m.key)}`, "GET", undefined, { background: true });
      if (closed) return;
      const t = MI.transformPrep({ cells: src.cells, lights: src.lights, walls: src.walls }, el, m, g);
      if (t.error) return say(t.error);
      let result = null;
      change(`Trazer regras de “${m.name}”`, () => { result = MI.mergePrep(layer, t, width(), el.id); layer = result.layer; });
      refresh();
      say(MI.importSummary(m.name, result.added, t.dropped, result.skipped) + " Ctrl+Z desfaz.");
    } catch (e) { say(e?.message || "Não foi possível ler a preparação do mapa original."); }
  }
  /** Imagem por link https: o servidor baixa uma cópia como imagem desta cena (mesmos limites do envio). */
  async function importImageUrl(point) {
    const text = prompt("Endereço https da imagem (PNG ou JPEG)");
    if (text == null) return;
    const { httpsImageUrl } = await import("./image-drop.js");
    let url;
    try { url = httpsImageUrl(text); } catch (e) { return say(e.message); }
    if (busy || uploading) return say("Aguarde a operação em andamento terminar.");
    if (!(await ensureSceneSaved("imagem do link"))) return;
    const name = (url.split("?")[0].split("/").pop() || "Imagem").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 120) || "Imagem";
    uploading = true; shell.refreshTools();
    say(`Importando “${name}”…`);
    try {
      const source = await api(`${base}/scenes/${saved.id}/sources/import`, "POST", { url, name }, { background: true });
      if (closed) return;
      if (shell.context !== "compose") shell.setContext("compose");
      const el = mountComposer().addImage(source, point || null, { label: "Imagem por link" });
      if (el) { composer.select([el.id], false); say(`Imagem “${name}” adicionada só a esta cena.`); }
    } catch (e) { say(`${e?.message || "A importação falhou."} Nada do que já estava na cena foi perdido.`); }
    finally { uploading = false; shell.refreshTools(); afterCompose(); syncComposeBar(); }
  }
  let uploadTray = null;
  /** Bloco do mapa inserido (ADR-113): original, encaixe na grade da cena e regras explícitas. */
  function instancePanelHtml(el) {
    const m = mapOf(el.mapKey), g = instanceGrid();
    const a = m && g ? MI.alignment(el, m, g) : { aligned: false, problem: !m ? "O mapa original não está na lista de mapas da campanha." : "A cena precisa de grade." };
    const rules = draft.layerMode === "scene" ? "As paredes, portas e luzes do original entram na preparação própria desta cena só quando você pedir; o original não muda."
      : "Para trazer paredes, portas e luzes do original, a cena precisa da preparação própria (Configurações da cena).";
    return `<section class="se-instance" aria-label="Mapa inserido"><h4>Mapa inserido${helpButton("campanhas.cenas.mapa-inserido", "Mapas inseridos na cena")}</h4>
      <p class="form-help">Original: <strong>${esc(m?.name || "indisponível")}</strong>. Excluir este elemento tira só o mapa da cena.</p>
      <p class="form-help" role="status">${a.aligned ? `Encaixado na grade da cena (casa de ${g.size} px, giro ${Math.round(el.rotation)}°).` : esc(a.problem)}</p>
      <div class="se-comp-actions" role="group" aria-label="Mapa inserido">${button("Encaixar na grade da cena", "se-comp", "snapMap", "subtle small")}${button("Trazer paredes, portas e luzes", "se-comp", "importRules", "subtle small")}${iconButton("next", "Próximo mapa inserido", "se-comp", "nextMap", "subtle small")}</div>
      <p class="form-help">${rules}</p></section>`;
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
      return `<div class="se-panel"><h3>Composição da cena${helpButton("campanhas.cenas.composicao", "Composição da cena")}</h3>${scope}<p class="form-help">${n ? `${n} elemento(s) nesta cena. Clique numa imagem para mover, redimensionar (alças mantêm a proporção; Shift também trava; Alt a partir do centro) e girar (alça de cima).` : "Arraste imagens do computador ou do painel Acervo, cole com Ctrl+V ou use Adicionar imagem. Cada imagem é um elemento independente."}</p>
        <div class="form-actions">${button("Adicionar imagem…", "se-tool", "addImage", "primary")}${button("Abrir o mapa original…", "se-open-map", "", "subtle")}${n ? button("Criar mapa a partir da composição", "se-map-from-comp", "", "subtle") : ""}</div>
        <p class="form-help">“Ocultar” e “Bloquear” nas camadas valem só no editor. Para esconder dos jogadores, marque <strong>Só o mestre vê</strong>.</p></div>`;
    }
    const one = els.length === 1 ? els[0] : null;
    const status = one ? CP.artboardStatus(one, compDoc().artboard) : "";
    return `<div class="se-panel"><h3>${one ? esc(one.name || "Imagem") : `${els.length} elementos`}</h3>${scope}
      ${one ? `<div class="field"><label for="se-c-name">Nome</label><input id="se-c-name" data-comp-name maxlength="80" value="${esc(one.name || "")}"></div><p class="form-help">${Math.round(one.width)} × ${Math.round(one.height)} px · giro ${Math.round(one.rotation)}°${status === "outside" ? " · fora da área visível (não aparece na mesa)" : status === "partial" ? " · parcialmente fora da área visível (a parte de fora não aparece)" : ""}.</p>` : ""}
      ${one && MI_isInstance(one) ? instancePanelHtml(one) : ""}
      <label class="check"><input type="checkbox" data-comp-flag="secret" ${els.every((x) => x.secret) ? "checked" : ""}> Só o mestre vê (não vai para os jogadores)</label>
      <label class="check"><input type="checkbox" data-comp-flag="visible" ${els.every((x) => x.visible) ? "" : "checked"}> Ocultar só no editor</label>
      <label class="check"><input type="checkbox" data-comp-flag="locked" ${els.every((x) => x.locked) ? "checked" : ""}> Bloquear</label>
      <div class="se-comp-actions" role="group" aria-label="Tamanho e posição">${button("Ajustar à área", "se-comp", "fit", "subtle small")}${button("Preencher a área", "se-comp", "fill", "subtle small")}${button("Tamanho original", "se-comp", "original", "subtle small")}${button("Centralizar", "se-comp", "center", "subtle small")}</div>
      <p class="form-help"><strong>Ajustar</strong> mostra a imagem inteira dentro do mapa; <strong>Preencher</strong> cobre o mapa todo e pode recortar; <strong>Tamanho original</strong> usa os pixels da imagem.</p>
      <div class="se-comp-actions" role="group" aria-label="Transformar">${iconButton("flipX", "Espelhar na horizontal", "se-comp", "flipX", "subtle small")}${iconButton("flipY", "Espelhar na vertical", "se-comp", "flipY", "subtle small")}${iconButton("rotate", "Girar 90°", "se-comp", "rotR", "subtle small")}${iconButton("copy", "Duplicar", "se-comp", "duplicate", "subtle small")}${iconButton("front", "Trazer para frente", "se-comp", "front", "subtle small")}${iconButton("back", "Enviar para trás", "se-comp", "back", "subtle small")}</div>
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
  /**
   * Acervo rápido (P1.1): categorias em chips, busca e miniaturas. Personagens, reservados e NPCs vão ao mapa como
   * marcadores (mesmo arrastar do painel Personagens); mapas e imagens entram pela composição (mesmo arrastar do Acervo,
   * tratado em addFromAsset). Sempre por referência: nenhum arquivo é duplicado.
   */
  let assetsKey = "";
  const TOKEN_KINDS = new Set(["pc", "slot", "npc"]);
  /** Favoritos e recentes da Preparação (mesmo armazenamento local por conta e campanha; só chaves `tipo:id`). */
  function quickPrefs() {
    try { return normalizeUserPrefs(JSON.parse(localStorage.getItem(userPrefsKey(appState.user?.id, campaign.id)) || "{}")); }
    catch { return normalizeUserPrefs({}); }
  }
  function touchQuick(key) {
    try {
      const k = userPrefsKey(appState.user?.id, campaign.id);
      const raw = JSON.parse(localStorage.getItem(k) || "{}");
      const next = touchRecent(normalizeUserPrefs(raw), key);
      localStorage.setItem(k, JSON.stringify({ ...raw, recents: next.recents }));
    } catch { /* armazenamento indisponível: recentes valem só nesta visita */ }
  }
  function quickCategories() {
    // Na composição só entram imagens e mapas; nos demais contextos, também personagens e criaturas.
    return composing() ? QUICK_CATEGORIES.filter(([id]) => ["recent", "favorites", "maps", "images"].includes(id)) : QUICK_CATEGORIES;
  }
  function quickThumb(item) {
    if (item.kind === "slot") return slotPreviewHtml(campaign.id, slotStore.byId(item.ref.slice(5)));
    const src = item.kind === "map" || item.kind === "image" ? slotImageSrc(campaign.id, item.ref)
      : typeof item.imageUrl === "string" && (item.imageUrl.startsWith("/api/") || item.imageUrl.startsWith("https://")) ? item.imageUrl : null;
    return `<span class="se-quick-thumb${item.kind === "map" || item.kind === "image" ? " wide" : ""}" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : icon(item.kind === "pc" ? "character" : "object")}</span>`;
  }
  function renderAssets(force = false) {
    const host = shell.panel("assets");
    if (!host) return;
    const cats = quickCategories();
    if (!cats.some(([id]) => id === quickCat)) quickCat = composing() ? "images" : "party";
    if (!host.querySelector("[data-asset-q]")) {
      host.innerHTML = `<div class="se-quick"><div class="se-quick-cats" role="group" aria-label="Categorias do acervo" data-quick-cats></div><div class="field"><label for="se-asset-q">Buscar no acervo</label><input id="se-asset-q" type="search" data-asset-q maxlength="80" autocomplete="off" placeholder="Nome"></div><div data-asset-list></div><p class="form-help" data-quick-help></p></div>`;
      bindAssetList(host, { onAdd: (item) => { const m = mapOf(item.src); if (m?.id) touchQuick(`map:${m.id}`); addFromAsset(item, null); } });
    }
    quickQuery = host.querySelector("[data-asset-q]").value;
    const placed = draft.prepared.length + (rehearsal?.sandbox.length || 0);
    const key = [quickCat, quickQuery, shell.context, draft.mapKey, maps.items.length, npcs?.length ?? "-", slotStore.items.map((s) => `${s.id}:${s.revision}`).join(","), slotStore.error, characters.length, placed].join("|");
    if (!force && key === assetsKey) return;
    assetsKey = key;
    host.querySelector("[data-quick-cats]").innerHTML = cats.map(([id, label]) => `<button type="button" class="se-chip" data-action="se-quick-cat" data-id="${id}" aria-pressed="${id === quickCat}">${esc(label)}</button>`).join("");
    const items = quickAssetItems({ characters, slots: slotStore.items, npcs: npcs || [], maps: maps.items.filter((m) => m.key !== draft.mapKey), prefs: quickPrefs() }, quickCat, quickQuery)
      .filter((x) => !composing() || !TOKEN_KINDS.has(x.kind));
    const loading = (quickCat === "npcs" && npcs == null) || ((quickCat === "reserved" || quickCat === "party") && slotStore.loading && !slotStore.items.length);
    const failed = (quickCat === "reserved" || quickCat === "party") && slotStore.error && !slotStore.items.length;
    const empty = { recent: "Nada recente ainda: o que você abrir na Preparação ou inserir daqui aparece aqui.", favorites: "Nenhum favorito: marque com a estrela na Preparação.", party: "Nenhum personagem de jogador nem reservado ainda. Crie reservados no painel Personagens.", reserved: "Nenhum personagem reservado. Crie no painel Personagens.", npcs: "Crie personagens do mestre na Preparação (pasta Personagens).", maps: "Nenhum mapa com grade enviado à campanha.", images: "Nenhuma imagem no acervo da campanha ainda. Envie pela Preparação › Mapas ou solte arquivos no palco." }[quickCat];
    const tokenRow = (x) => `<li class="se-quick-item se-char" draggable="true" data-se-char="${esc(x.ref)}">${quickThumb(x)}<span>${esc(x.name)}<small>${esc(x.sub)}</small></span>${button(`Colocar<span class="sr-only"> ${esc(x.name)} no cursor</span>`, "se-place-cursor", x.ref, "subtle small", mapKind() && meta ? "" : 'aria-disabled="true" data-tip="Personagens entram em cenas com mapa tático."')}</li>`;
    const assetRow = (x) => `<li class="se-quick-item ed-asset" draggable="true" data-ed-asset="${esc(JSON.stringify(x.asset))}">${quickThumb(x)}<span>${esc(x.name)}<small>${esc(x.sub)}</small></span><button type="button" class="subtle small" data-ed-asset-add>Inserir<span class="sr-only"> ${esc(x.name)}</span></button></li>`;
    host.querySelector("[data-asset-list]").innerHTML = loading ? '<p class="loading-line" role="status">Carregando…</p>'
      : failed ? `<p class="form-error" role="alert">${esc(slotStore.error)}</p>${button("Tentar de novo", "se-slot-retry", "", "subtle small")}`
      : items.length ? `<ul class="se-quick-list" role="list">${items.map((x) => (TOKEN_KINDS.has(x.kind) ? tokenRow(x) : assetRow(x))).join("")}</ul>`
      : `<p class="muted small">${esc(quickQuery ? "Nenhum resultado." : empty)}</p>`;
    host.querySelector("[data-quick-help]").textContent = composing()
      ? "Arraste para o palco ou use Inserir: a cena usa o mesmo arquivo, sem duplicar. Numa cena vazia, a imagem vira o fundo."
      : "Arraste para o mapa ou use Colocar (vai para a casa sob o cursor). Imagens e mapas entram pela composição desta cena.";
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
    if (!draft.mapKey) { startChoice = { files }; error = ""; renderSide(); return renderStage(); }
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
    try {
      // Fluxo comum com o editor de mapas (image-drop.js): miniatura e andamento por arquivo, colocação no ponto da soltura,
      // seleção ao terminar; uma falha não interrompe os demais nem descarta o rascunho da cena.
      const { mountUploadTray, uploadEach } = await import("./image-drop.js");
      if (closed) return;
      if (!uploadTray?.isConnected) { uploadTray = mountUploadTray(shell.stage); uploadTray.isConnected = true; }
      const { added } = await uploadEach(files, {
        tray: uploadTray,
        upload: (file) => { const fd = new FormData(); fd.append("file", file); fd.append("name", baseName(file.name)); return api(`${base}/scenes/${saved.id}/sources`, "POST", fd, { background: true }); },
        place: (source, i) => composer.addImage(source, at ? { x: at.x + i * 24, y: at.y + i * 24 } : null)?.id || null,
        alive: () => !closed,
        say,
      });
      if (added.length && !closed) { composer.select(added, false); composer.surface.canvas.focus({ preventScroll: true }); }
    } finally {
      uploading = false;
      if (!closed) { shell.refreshTools(); afterCompose(); syncComposeBar(); }
    }
  }
  /** Imagem do acervo: numa cena vazia vira o fundo; senão entra na composição como referência (sem copiar bytes). */
  async function addFromAsset(item, p) {
    if (simulate || mapOnly || draft.kind === "text") return;
    const m = mapOf(item.src);
    if (!draft.mapKey && m) return chooseMap(m);
    if (!composable()) return say("A composição usa uma imagem da campanha como fundo. Escolha o fundo antes.");
    const at = dropPoint(p);
    // Mapa da campanha com grade numa cena com grade: entra como mapa inserido, encaixado (ADR-113); demais imagens, como imagem.
    if (m && MI?.canInstance(m) && instanceGrid()) return insertMapInstance(m, at);
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
    // Área em branco por casas (P1.3): cenas com vários mapas inseridos precisam de uma superfície maior que um mapa só.
    const presets = (MI?.BLANK_PRESETS || [[30, 20], [40, 30], [60, 40]]).map(([w, h]) => [`${w}x${h}`, `${w} × ${h} casas`]);
    const size = c.blank ? `<div class="field"><label for="se-blank-size">Tamanho da área</label><select id="se-blank-size" name="cells" aria-describedby="se-blank-help">${opt([...presets, ...(mode === "complete" ? [["custom", "Outro tamanho…"]] : [])], "40x30")}</select><small class="form-help" id="se-blank-help">Casas de até 70 px; 8 a 100 casas por lado, até 4.096 casas. Mapas da campanha inseridos depois encaixam nessa grade.</small></div>${mode === "complete" ? `<div class="se-blank-custom" data-blank-custom><div class="field"><label for="se-blank-cols">Colunas</label><input id="se-blank-cols" name="cols" type="number" min="8" max="100" step="1" value="50"></div><div class="field"><label for="se-blank-rows">Linhas</label><input id="se-blank-rows" name="rows" type="number" min="8" max="100" step="1" value="40"></div></div>` : ""}` : "";
    const replaceNote = c.replace ? '<p class="notice-box">Trocar o fundo remove as posições preparadas e a composição desta cena (o mapa anterior continua em Mapas).</p>' : "";
    const sharedNote = c.playable ? `<p class="form-help">O mapa “${esc(imageMap()?.name || "")}” ganha uma grade técnica e passa a aceitar personagens. Outras cenas que o usam como imagem continuam iguais.</p>` : "";
    return `<form class="se-panel se-start-form" data-start-form><h3>${head}${c.blank ? helpButton("campanhas.cenas.area-branco", "Área em branco") : helpButton("campanhas.cenas.composicao", "Composição da cena")}</h3>${replaceNote}${use}${size}
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
    uploading = true; error = ""; renderSide(); renderStatus(); renderStage();
    try {
      if (c.playable) { uploading = false; return await makePlayable(modeV); }
      if (c.blank) {
        const [cols, rows] = data.cells === "custom" ? [Number(data.cols), Number(data.rows)] : String(data.cells || "40x30").split("x").map(Number);
        const surface = MI ? MI.blankSurface(cols, rows) : { width: 2800, height: 2100, gridPixels: 70 };
        if (surface.error) throw new Error(surface.error);
        await createBackground(await blankImage(surface.width, surface.height), modeV, `Área em branco ${cols} × ${rows}`, surface.gridPixels);
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
  async function createBackground(file, modeV, name, cellPx = 0) {
    const s = await readImageSize(file);
    const playable = modeV !== "image";
    const gridPx = cellPx || defaultGrid(s.width, s.height);
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
    if (simulate) {
      if (cell) lastCell = cell;
      const k = token ? Number(token.id.slice(1)) : -1;
      if (rehearsal?.sandbox[k]) return sandboxMenu(k, at);
      return openContextMenu(at, [
        { label: "Token de ensaio aqui", disabled: !cell, disabledReason: "Escolha uma casa do mapa.", run: () => { lastCell = cell; hover = cell; addRehearsalToken(); } },
        { separator: true },
        { label: "Aplicar alterações à preparação…", run: applyRehearsalChanges },
        { label: "Sair do ensaio", hint: "Esc", run: () => toggleSimulate(false) },
      ], { label: "Ensaio" });
    }
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
    const allPc = ids.every((k) => draft.prepared[k].characterId || draft.prepared[k].slotId);
    const own = ids.filter((k) => !draft.prepared[k].characterId);
    const PC_ONCE = "Personagens dos jogadores e reservados aparecem uma vez por cena.";
    const one = ids.length === 1;
    const slot = one && tok.slotId ? slotStore.byId(tok.slotId) : null;
    const bindReason = sceneDirty ? "Salve a cena antes: o vínculo reescreve as cenas salvas." : !saved.id ? "Salve a cena antes de vincular." : "";
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
      ...(ids.length === 1 && !tok.characterId ? [{
        label: "Forma no mapa",
        items: LOOK_OPTIONS.map(([v, label]) => ({ label, checked: lookOf(tok) === v, disabled: v === LOOK_IMAGE && !tokenImage(tok), disabledReason: "Este personagem não tem imagem. Escolha uma na ficha dele, na Preparação.", run: () => setTokenLook(i, v) })),
      }] : []),
      // Manipulação rápida (P0.3): trocar imagem mantendo posição e tamanho; tamanhos predefinidos validados como ao soltar.
      ...(one && (!tok.characterId || tok.slotId) ? [{ label: "Trocar imagem…", run: () => openImagePick(tok.slotId && !tok.imageUrl ? { kind: "slot", id: tok.slotId } : { kind: "token", i }) }] : []),
      ...(one ? [{ label: "Ajustar tamanho", items: [
        ...SIZE_PRESETS.map((p) => ({ label: p.label, hint: p.hint, checked: sizePresetOf(tok) === p.id, run: () => applySizePreset(i, p.id) })),
        { separator: true }, { label: "Personalizado…", run: () => openTokenProperties(i) },
      ] }] : []),
      ...(slot ? [slot.characterId
        ? { label: "Desvincular", hint: slot.characterName || "", disabled: !!bindReason, disabledReason: bindReason, run: () => unbindSlot(slot) }
        : { label: "Vincular a personagem…", disabled: !!bindReason, disabledReason: bindReason, run: () => openBind(slot) }] : []),
      { label: "Selecionar camada", hint: l?.name || "", run: () => selectLayer(l?.id || "elements") },
      ...(one ? [{ separator: true }, { label: "Mais propriedades…", run: () => openTokenProperties(i) }] : []),
    ], { label: tok.label || "Marcador" });
  }
  /** Ajustar tamanho por predefinição: com imagem, a criatura ocupa a área inteira; sem imagem, o redondo só fica maior. */
  function applySizePreset(i, id) {
    const list = simulate ? rehearsal?.sandbox : draft.prepared;
    const t = list?.[i];
    if (!t) return;
    const patch = sizePresetPatch(id, { image: !!tokenImage(t), appearance: t.appearance });
    const next = { ...t, ...patch };
    const problem = placementProblem(layer?.cells, width(), height(), list, next.x, next.y, i, freeOn(), tokenSpan(next));
    if (problem) return say(problem);
    const p = SIZE_PRESETS.find((x) => x.id === id);
    const note = p.cells > 1 && !tokenImage(t) ? " Sem imagem, o marcador redondo fica maior e continua ocupando uma casa." : "";
    if (simulate) return sandboxChange(`Ensaio: ${t.label} ${p.label.toLowerCase()}`, () => { rehearsal.sandbox[i] = next; });
    if (!editable(i)) return say("Esse marcador está numa camada oculta ou bloqueada.");
    change(`Tamanho: ${p.label}`, () => { draft.prepared[i] = next; });
    refresh();
    say(`${t.label}: ${p.label} (${p.hint}).${note}`);
  }
  /** Menu do token no ensaio: perfil de teste, observador, tamanho, imagem, converter e retirar. */
  function sandboxMenu(k, at) {
    const t = rehearsal.sandbox[k];
    rehearsal.selected = t.key; board.setView(boardView()); renderSide();
    const choice = rehearsal.profiles.get(t.key) || { id: "default" };
    openContextMenu(at, [
      { label: "Ver por este token", checked: rehearsal.observer === (t.characterId ? `c:${t.characterId}` : `t:${t.key}`), run: () => setObserver(t.characterId ? `c:${t.characterId}` : `t:${t.key}`) },
      { label: "Perfil de teste", items: PROFILE_PRESETS.map((p) => ({ label: p.label, hint: p.hint, checked: choice.id === p.id, run: () => setProfile(t.key, p.id) })) },
      { label: "Ajustar tamanho", items: SIZE_PRESETS.map((p) => ({ label: p.label, hint: p.hint, checked: sizePresetOf(t) === p.id, run: () => applySizePreset(k, p.id) })) },
      { label: "Trocar imagem…", disabled: !!t.characterId && !t.slotId, disabledReason: "Personagens dos jogadores usam a imagem da ficha.", run: () => openImagePick({ kind: "sandbox", key: t.key }) },
      ...(t.rehearsal ? [{ label: "Converter em personagem reservado", run: () => convertToSlot(t.key) }] : []),
      { separator: true },
      { label: "Retirar do ensaio", shortcut: "delete", danger: true, run: () => sandboxRemove(rehearsal.sandbox.findIndex((x) => x.key === t.key)) },
    ], { label: t.label || "Token" });
  }
  function setObserver(value) {
    if (!rehearsal) return;
    rehearsal.observer = value; serverView = null; serverViewError = "";
    renderSimBanner(); redraw(); renderSide();
  }
  function setProfile(key, id, custom = null) {
    if (!rehearsal) return;
    const prev = rehearsal.profiles.get(key);
    rehearsal.profiles.set(key, { id, custom: custom || prev?.custom || {} });
    serverView = null; serverViewError = "";
    renderSimBanner(); redraw(); renderSide();
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
          { label: "Ensaiar cena", hint: "Ver como jogador", checked: simulate, disabled: !mapKind() || !meta, disabledReason: "O ensaio vale para mapas táticos.", run: () => toggleSimulate() },
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
        { label: "Importar imagem por link…", disabled: !composable(), disabledReason: "A composição usa uma imagem da campanha como fundo.", run: () => importImageUrl(null) },
        instanceMenuItem(null),
        { label: "Selecionar próximo mapa inserido", disabled: !MI || !(draft.composition?.elements || []).some(MI_isInstance), disabledReason: "Nenhum mapa inserido nesta cena.", run: () => { if (shell.context !== "compose") shell.setContext("compose"); mountComposer(); configureInstances(); composeAction("nextMap"); } },
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
    if (simulate && !leaveRehearsal()) return;
    panel = id; pick = null; selection = []; applying = false; binding = null; imagePick = null;
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
    list.innerHTML = `${slotsSection(match)}<h4 class="se-char-head">Personagens dos jogadores</h4>${pcs.length ? `<ul class="se-pick-list">${pcs.map((c) => item(`pc:${c.id}`, c.name, pos.has(c.id) ? where(pos.get(c.id)) : unplaced, pos.has(c.id) ? pos.get(c.id) : -1)).join("")}</ul>` : `<p class="muted small">${query ? "Nenhum resultado." : "Nenhum personagem vinculado à campanha ainda."}</p>`}
      <h4 class="se-char-head">Personagens do mestre</h4>${npcs == null ? '<p class="loading-line" role="status">Carregando…</p>' : masters.length ? `${placeLookField("list")}<ul class="se-pick-list">${masters.map((n) => item(`npc:${n.id}`, n.name, n.summary || "")).join("")}</ul><p class="form-help">Marque “Oculto” no marcador para preparar NPCs e emboscadas que só você vê.</p>` : `<p class="muted small">${query ? "Nenhum resultado." : "Crie personagens do mestre na Preparação (pasta Personagens)."}</p>`}
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
  // ---------- Personagens reservados (ADR-110) ----------
  /** Seção do painel Personagens: criar (genérico ou por arquétipo), listar, colocar, renomear e ações do reservado. */
  function slotsSection(match) {
    if (!slotStore.loaded && !slotStore.loading && !slotStore.error) slotStore.load().then(() => { if (!closed) { renderCharacterList(); renderAssets(); redraw(); } });
    const list = (simulate && rehearsal ? rehearsal.sandbox : draft.prepared);
    const full = slotStore.items.length >= MAX_SLOTS;
    const limit = full ? `aria-disabled="true" data-tip="Use até ${MAX_SLOTS} personagens reservados por campanha."` : slotBusy ? 'aria-disabled="true" data-tip="Aguarde: criando o personagem reservado."' : "";
    const create = `<div class="se-slot-create">${button(`${icon("plus")}<span>Personagem reservado</span>`, "se-slot-new", "", "subtle small se-slot-add", limit)}<div class="se-slot-chips" role="group" aria-label="Criar personagem reservado por arquétipo">${ARCHETYPES.map((a) => button(`${archetypeSvg(a.id)}<span>${esc(a.label)}</span>`, "se-slot-new", a.id, "subtle small se-chip", limit)).join("")}</div></div>`;
    const items = slotStore.items.filter((s) => match(s.name));
    const row = (s) => {
      const at = slotIndex(list, s.id), bound = s.characterId ? list.findIndex((t) => t.characterId === s.characterId) : -1;
      const placedAt = at >= 0 ? at : bound;
      const t = list[placedAt];
      const scenes = Array.isArray(s.scenes) ? s.scenes.length : Number(s.scenes) || 0;
      const state = s.characterId ? `Vinculado a ${s.characterName || "um personagem"}` : "Reservado";
      const where = t ? `coluna ${t.x + 1}, linha ${t.y + 1}` : "fora desta cena";
      const name = renaming === s.id
        ? `<input class="se-slot-name" data-slot-rename="${esc(s.id)}" maxlength="40" value="${esc(s.name)}" aria-label="Nome do personagem reservado" autocomplete="off">`
        : esc(s.name);
      const actions = placedAt >= 0
        ? button(`Mostrar<span class="sr-only"> ${esc(s.name)}</span>`, simulate ? "se-rh-show" : "se-char-show", simulate ? list[placedAt].key : String(placedAt), "subtle small")
        : button(`Colocar <span class="sr-only">${esc(s.name)} </span>no cursor`, "se-place-cursor", `slot:${s.id}`, "subtle small");
      return `<li class="se-char se-slot${placedAt >= 0 ? " placed" : ""}" draggable="${renaming === s.id ? "false" : "true"}" data-se-char="slot:${esc(s.id)}">${slotPreviewHtml(campaign.id, s)}<span class="se-slot-text">${name}<small>${esc(state)} · ${esc(where)}${scenes ? ` · em ${scenes} cena(s)` : ""}</small></span><span class="se-char-actions">${actions}${iconButton("dots", `Ações de ${s.name}`, "se-slot-menu", s.id, "subtle small")}</span></li>`;
    };
    const body = slotStore.loading && !slotStore.items.length ? '<p class="loading-line" role="status">Carregando…</p>'
      : slotStore.error && !slotStore.items.length ? `<p class="form-error" role="alert">${esc(slotStore.error)}</p>${button("Tentar de novo", "se-slot-retry", "", "subtle small")}`
      : items.length ? `<ul class="se-pick-list se-slot-list">${items.map(row).join("")}</ul>`
      : `<p class="muted small">${slotStore.items.length ? "Nenhum resultado." : "Prepare a cena sem esperar os jogadores: crie personagens provisórios e vincule às fichas depois."}</p>`;
    return `<section class="se-slots" aria-labelledby="se-slots-h"><h4 class="se-char-head" id="se-slots-h">Personagens reservados${helpButton("campanhas.cenas.reservados", "Personagens reservados")}</h4>${create}${body}</section>`;
  }
  async function createSlot(archetype) {
    if (slotBusy) return;
    if (slotStore.items.length >= MAX_SLOTS) return say(`Use até ${MAX_SLOTS} personagens reservados por campanha.`);
    const a = archetypeOf(archetype);
    slotBusy = true; renderCharacterList();
    try {
      const name = nextSlotName(slotStore.items.map((s) => s.name), a ? a.label : "Personagem", !a);
      const s = await slotStore.create({ name, archetype: a?.id || null });
      if (closed) return;
      say(a ? `“${s.name}” criado. Arraste para o mapa ou use Colocar no cursor.` : `“${s.name}” criado. Digite um nome e Enter (ou só arraste para o mapa).`);
      if (!a) renaming = s.id;
    } catch (e) { say(e.status === 409 ? `Use até ${MAX_SLOTS} personagens reservados por campanha.` : e.message); }
    finally {
      slotBusy = false;
      if (!closed) { renderCharacterList(); renderAssets(); focusRename(); }
    }
  }
  function focusRename() {
    if (!renaming) return;
    const input = shell.panel("characters")?.querySelector(`[data-slot-rename="${CSS.escape(renaming)}"]`);
    if (input) { input.focus(); input.select(); }
  }
  function startRename(id) { renaming = id; renderCharacterList(); focusRename(); }
  /** Renomear em linha: Enter ou sair do campo grava; Esc desiste. O rótulo dos tokens dele acompanha o novo nome. */
  async function commitRename(input) {
    const id = input.dataset.slotRename, slot = slotStore.byId(id);
    if (renaming !== id) return;
    renaming = null;
    const name = String(input.value || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!slot || !name || name === slot.name) { renderCharacterList(); return; }
    try {
      await slotStore.update(slot, { name });
      // O servidor grava o nome do reservado nos tokens sem vínculo; aqui o rascunho e o salvo acompanham (sem "não salvo").
      const rename = (list) => (list || []).map((t) => (t.slotId === id && !t.characterId ? { ...t, label: name } : t));
      draft.prepared = rename(draft.prepared); savedScene.prepared = rename(savedScene.prepared);
      if (rehearsal) { rehearsal.sandbox = rename(rehearsal.sandbox); rehearsal.start = rename(rehearsal.start); }
      say(`Renomeado para “${name}”.`);
    } catch (e) { say(e.message); }
    if (!closed) { recomputeDirty(); redraw(); renderCharacterList(); renderStructure(); renderAssets(); }
  }
  async function slotAction(slot, fn, done) {
    try { await fn(); if (done) say(done); }
    catch (e) { say(e.message); }
    if (!closed) { renderCharacterList(); renderAssets(); redraw(); }
  }
  function slotMenu(id, at) {
    const s = slotStore.byId(id);
    if (!s) return;
    const bindReason = sceneDirty ? "Salve a cena antes: o vínculo reescreve as cenas salvas." : "";
    openContextMenu(at, [
      { label: "Colocar no cursor", disabled: !meta || !mapKind(), disabledReason: "Personagens entram em cenas com mapa tático.", run: () => placeAtCursor(`slot:${id}`) },
      { label: "Renomear", hint: "F2", run: () => startRename(id) },
      { label: "Arquétipo", items: [
        ...ARCHETYPES.map((a) => ({ label: a.label, checked: s.archetype === a.id, run: () => slotAction(s, () => slotStore.update(s, { archetype: a.id }), `Arquétipo: ${a.label}.`) })),
        { label: "Sem arquétipo", checked: !s.archetype, run: () => slotAction(s, () => slotStore.update(s, { archetype: null }), "Arquétipo retirado.") },
      ] },
      { label: "Trocar imagem…", run: () => openImagePick({ kind: "slot", id }) },
      { label: "Duplicar", disabled: slotStore.items.length >= MAX_SLOTS, disabledReason: `Use até ${MAX_SLOTS} personagens reservados.`, run: () => slotAction(s, () => slotStore.duplicate(s), "Personagem reservado duplicado.") },
      { separator: true },
      s.characterId
        ? { label: "Desvincular", hint: s.characterName || "", disabled: !!bindReason, disabledReason: bindReason, run: () => unbindSlot(s) }
        : { label: "Vincular a personagem…", disabled: !!bindReason, disabledReason: bindReason, run: () => openBind(s) },
      { separator: true },
      { label: "Excluir…", danger: true, run: () => deleteSlot(s) },
    ], { label: s.name });
  }
  async function deleteSlot(s) {
    const scenes = Array.isArray(s.scenes) ? s.scenes.length : Number(s.scenes) || 0;
    const here = slotIndex(draft.prepared, s.id) >= 0;
    const lose = s.characterId ? "As cenas continuam com o personagem vinculado." : scenes ? `O token sai de ${scenes} cena(s) salva(s).` : "Nenhuma cena salva usa este reservado.";
    if (!confirm(`Excluir “${s.name}”? ${lose}${here ? " Ele também sai desta cena." : ""} Não dá para desfazer.`)) return;
    try {
      await slotStore.remove(s);
      if (closed) return;
      // O servidor já tirou os tokens sem vínculo das cenas salvas: o rascunho e o salvo acompanham, sem histórico antigo.
      const drop = (list) => (list || []).filter((t) => !(t.slotId === s.id && !t.characterId));
      const had = draft.prepared.length !== drop(draft.prepared).length;
      draft.prepared = drop(draft.prepared); savedScene.prepared = drop(savedScene.prepared); selection = [];
      if (rehearsal) { rehearsal.sandbox = drop(rehearsal.sandbox); rehearsal.start = drop(rehearsal.start); rehearsal.selected = null; }
      if (had) resetHistory("Personagem reservado excluído. O histórico de desfazer recomeça.");
      else say(`“${s.name}” excluído.`);
      recomputeDirty(); refresh();
    } catch (e) { say(e.message); }
  }

  // ---------- Vincular reservado a um personagem existente ----------
  async function openBind(s) {
    if (sceneDirty) return say("Salve a cena antes de vincular: o vínculo reescreve as cenas salvas.");
    binding = { slotId: s.id, characterId: "", preview: null, loading: !slotStore.loaded, error: "", keepImage: true, resolve: null };
    imagePick = null; renderSide(); showProps();
    if (!slotStore.loaded) await slotStore.load(true);
    if (binding?.slotId !== s.id) return;
    binding.loading = false;
    renderSide();
    setTimeout(() => shell.panel("props")?.querySelector("#se-bind-char")?.focus(), 0);
  }
  async function loadBindPreview() {
    const b = binding, s = b && slotStore.byId(b.slotId);
    if (!s || !b.characterId) { if (b) { b.preview = null; renderSide(); } return; }
    b.loading = true; b.error = ""; b.preview = null; renderSide();
    try { const p = await slotStore.bindPreview(s, b.characterId); if (binding === b) b.preview = p; }
    catch (e) { if (binding === b) b.error = e.message; }
    if (binding === b) { b.loading = false; b.resolve = null; renderSide(); }
  }
  function bindPanel() {
    const b = binding, s = slotStore.byId(b.slotId);
    if (!s) return `<div class="se-panel"><p class="form-error" role="alert">Esse personagem reservado não existe mais.</p>${button("Fechar", "se-bind-cancel", "", "subtle")}</div>`;
    const chars = slotStore.characters;
    const p = b.preview, conflicts = p?.conflicts || [];
    const options = [["", chars.length ? "Escolha um personagem" : "Nenhum personagem na campanha"], ...chars.map((c) => [c.id, c.slotId && c.slotId !== s.id ? `${c.name} (já ligado a outro reservado)` : c.name])];
    const scenesN = Array.isArray(p?.scenes) ? p.scenes.length : Number(p?.scenes) || 0;
    const info = b.loading ? '<p class="loading-line" role="status">Conferindo as cenas…</p>'
      : b.error ? `<p class="form-error" role="alert">${esc(b.error)}</p>`
      : p ? `<div class="se-diff" role="note"><ul><li>${scenesN ? `${scenesN} cena(s) passam a mostrar ${esc(p.characterName || "o personagem")} na posição do reservado.` : "Nenhuma cena salva usa este reservado ainda."}</li>${p.boundElsewhere ? `<li>Este personagem já está ligado a “${esc(p.boundElsewhere.name)}”: desvincule-o lá antes.</li>` : ""}${conflicts.length ? `<li>O personagem já tem posição em: ${conflicts.map((c) => esc(c.sceneName)).join(", ")}. Escolha qual posição fica.</li>` : ""}${p.activeSession ? "<li>Há uma sessão ativa: a mesa só muda ao apresentar, reiniciar ou aplicar a cena.</li>" : ""}</ul></div>` : "";
    const resolve = conflicts.length ? `<fieldset><legend>Nas cenas em que os dois já estão</legend><label class="check se-option"><input type="radio" name="se-bind-resolve" value="slot" ${b.resolve === "slot" ? "checked" : ""}><span><strong>Ficar na posição do reservado</strong><small>O token do personagem sai de onde estava.</small></span></label><label class="check se-option"><input type="radio" name="se-bind-resolve" value="character" ${b.resolve === "character" ? "checked" : ""}><span><strong>Ficar na posição do personagem</strong><small>O token reservado sai dessas cenas.</small></span></label></fieldset>` : "";
    const blocked = !b.characterId ? "Escolha um personagem." : b.loading ? "Aguarde a conferência das cenas." : sceneDirty ? "Salve a cena antes de vincular." : p?.boundElsewhere ? "Desvincule o personagem do outro reservado antes." : conflicts.length && !b.resolve ? "Escolha qual posição fica nas cenas em conflito." : b.error ? "Corrija o problema indicado acima." : "";
    return `<form class="se-panel" data-bind-form role="region" aria-labelledby="se-bind-h"><h3 id="se-bind-h">Vincular “${esc(s.name)}”${helpButton("campanhas.cenas.reservados", "Personagens reservados")}</h3><p class="form-help">O reservado vira o personagem escolhido em todas as cenas salvas, nas mesmas posições.</p>${sceneDirty ? '<p class="notice-box">Salve a cena antes de vincular: o vínculo reescreve as cenas salvas.</p>' : ""}
      <div class="field"><label for="se-bind-char">Personagem</label><select id="se-bind-char" data-bind-char ${chars.length ? "" : "disabled"}>${opt(options, b.characterId)}</select></div>${info}${resolve}
      <label class="check"><input type="checkbox" data-bind-keep ${b.keepImage ? "checked" : ""}> Manter a imagem do token</label>
      <div class="form-actions">${button("Cancelar", "se-bind-cancel", "", "subtle")}${button("Vincular", "se-bind-go", "", "primary", blocked ? `aria-disabled="true" data-tip="${esc(blocked)}"` : "")}</div></form>`;
  }
  /** Depois de vincular/desvincular: o servidor reescreveu as cenas salvas; recarrega esta se não há alterações locais. */
  async function afterSlotRewrite(message) {
    if (!saved.id) { say(message); return refresh(); }
    if (sceneDirty || layerDirty) { say(`${message} Salve e reabra a cena para ver as posições atualizadas.`); return refresh(); }
    try {
      const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true });
      if (closed) return;
      draft = toDraft(fresh); savedScene = clone(draft); saved.revision = fresh.revision; live = fresh.live;
      if (fresh.characters) characters = fresh.characters;
      selection = []; if (panel === "token") panel = "overview";
      resetHistory(message);
    } catch (e) { say(`${message} Não foi possível recarregar a cena: ${e.message}`); }
    recomputeDirty(); refresh();
  }
  async function confirmBind() {
    const b = binding, s = b && slotStore.byId(b.slotId);
    if (!s || !b.characterId) return;
    try {
      const r = await slotStore.bind(s, { characterId: b.characterId, keepImage: b.keepImage, resolve: (b.preview?.conflicts || []).length ? b.resolve : null });
      binding = null;
      await slotStore.load(true);
      await afterSlotRewrite(`“${s.name}” vinculado a ${r.characterName || b.preview?.characterName || "o personagem"}.${r.activeSession ? " A mesa ativa só muda ao apresentar ou aplicar a cena." : ""}`);
    } catch (e) {
      if (binding === b) { b.error = e.message; renderSide(); } else say(e.message);
    }
  }
  async function unbindSlot(s) {
    if (sceneDirty) return say("Salve a cena antes de desvincular.");
    if (!confirm(`Desvincular “${s.name}” de ${s.characterName || "seu personagem"}? Nas cenas, o token volta a ser o reservado; o personagem continua na campanha.`)) return;
    try {
      await slotStore.unbind(s);
      await slotStore.load(true);
      await afterSlotRewrite(`“${s.name}” desvinculado.`);
    } catch (e) { say(e.message); }
  }

  // ---------- Escolher imagem (reservado, marcador ou token do ensaio) ----------
  function openImagePick(target) {
    imagePick = { target, query: "", busy: false };
    binding = null; renderSide(); showProps();
    setTimeout(() => shell.panel("props")?.querySelector("#se-ip-q")?.focus(), 0);
  }
  function imageTargetName() {
    const t = imagePick?.target;
    if (t?.kind === "slot") return slotStore.byId(t.id)?.name || "Reservado";
    if (t?.kind === "token") return draft.prepared[t.i]?.label || "Marcador";
    return rehearsal?.sandbox.find((x) => x.key === t?.key)?.label || "Token";
  }
  function imageItems(query) {
    const q2 = plain(query);
    return maps.items.filter((m) => slotImageSrc(campaign.id, m.key) && (!q2 || plain(m.name).includes(q2))).slice(0, 60);
  }
  function imagePickRows() {
    if (imagePick.busy) return '<p class="loading-line" role="status">Enviando a imagem…</p>';
    const list = imageItems(imagePick.query);
    return list.length ? `<ul class="se-image-pick" role="list">${list.map((m) => `<li><button type="button" class="se-ip-item" data-action="se-ip-use" data-id="${esc(m.key)}"><img src="${esc(slotImageSrc(campaign.id, m.key))}" alt="" loading="lazy" decoding="async"><span>${esc(m.name || "Imagem")}</span></button></li>`).join("")}</ul>`
      : `<p class="muted small">${imagePick.query ? "Nenhum resultado." : "Nenhuma imagem na campanha ainda. Envie uma do computador."}</p>`;
  }
  function imagePickPanel() {
    return `<div class="se-panel" role="region" aria-labelledby="se-ip-h"><h3 id="se-ip-h">Imagem de “${esc(imageTargetName())}”</h3><p class="form-help">Posição e tamanho continuam. A imagem fica no acervo da campanha e é usada por referência.</p>
      <div class="field"><label for="se-ip-q">Buscar nas imagens da campanha</label><input id="se-ip-q" type="search" data-ip-q maxlength="80" autocomplete="off" value="${esc(imagePick.query)}"></div>
      <div data-ip-list>${imagePickRows()}</div>
      <input type="file" id="se-ip-file" accept="image/png,image/jpeg" hidden>
      <div class="form-actions">${button("Enviar do computador…", "se-ip-upload", "", "subtle", imagePick.busy ? 'aria-disabled="true" data-tip="Aguarde o envio em andamento."' : "")}${button("Sem imagem própria", "se-ip-use", "", "text-button")}${button("Cancelar", "se-ip-cancel", "", "subtle")}</div></div>`;
  }
  /** Aplica a imagem escolhida (`asset:{id}` ou "" para voltar à imagem padrão) mantendo a geometria. */
  async function useImage(key) {
    const target = imagePick?.target;
    if (!target) return;
    const value = key || null;
    imagePick = null;
    if (target.kind === "slot") {
      const s = slotStore.byId(target.id);
      if (s) await slotAction(s, () => slotStore.update(s, { imageUrl: value }), value ? "Imagem do reservado trocada (vale em todas as cenas)." : "Imagem do reservado retirada.");
      return renderSide();
    }
    if (target.kind === "sandbox") {
      const k = rehearsal?.sandbox.findIndex((x) => x.key === target.key) ?? -1;
      if (k >= 0) sandboxChange("Ensaio: imagem trocada", () => { rehearsal.sandbox[k] = { ...rehearsal.sandbox[k], imageUrl: value }; });
      return renderSide();
    }
    const t = draft.prepared[target.i];
    if (!t || !editable(target.i)) { say("O marcador não está mais disponível para edição."); return renderSide(); }
    // Sem imagem, a forma livre volta ao redondo (a área só existe com imagem).
    change(value ? "Trocar imagem" : "Imagem padrão", () => { draft.prepared[target.i] = { ...t, imageUrl: value, ...(!value && !tokenImage({ ...t, imageUrl: null }) ? { appearance: null, width: null, height: null } : {}) }; });
    refresh();
  }
  async function uploadPickImage(file) {
    if (!imagePick || !file) return;
    imagePick.busy = true; renderSide();
    try {
      const { imageFromUpload } = await import("./npc-sheet.js");
      const key = await imageFromUpload({ imageFile: file }, campaign.id, imageTargetName());
      maps.items = (await api(`${base}/maps`, "GET", undefined, { background: true })).items;
      if (closed || !imagePick) return;
      await useImage(key);
      renderAssets(true);
    } catch (e) { if (imagePick) { imagePick.busy = false; renderSide(); } say(e.message); }
  }

  function renderHistory() {
    const host = shell.panel("history");
    if (host) renderHistoryPanel(host, history);
  }
  const renderPanels = () => { renderLayers(); renderStructure(); renderCharacters(); renderHistory(); if (!mapOnly) renderAssets(); };

  // ---------- Renderização ----------
  /** Aviso de peso (ADR-100): perto dos limites do servidor para paredes, luzes, marcas e marcadores. */
  function weightChip() {
    if (!layer || !mapKind()) return "";
    const w = sceneWeight({ walls: layer.walls?.length, lights: layer.lights?.length, marks: layer.marks?.length, tokens: draft.prepared?.length });
    return w.heavy ? `<span class="ed-chip pending" role="note">${esc(w.text)}</span>` : "";
  }
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
        simulate ? '<span class="ed-chip private">Ensaio: nada vai para a mesa</span>' : "",
        mapOnly && meta ? '<span class="ed-chip pending">Preparação do mapa: vale para as cenas que o compartilham</span>' : "",
        weightChip(),
      ].join(""),
    });
    q("#se-apply-slot").innerHTML = presenting && saved.id && (pendingLive || mapKind()) ? button(pendingLive ? "Aplicar à cena atual…" : "Aplicar preparação à cena atual…", "se-apply", "", "subtle", dirty ? 'aria-disabled="true" data-tip="Salve a preparação antes de aplicar."' : "") : "";
    const previewBtn = q("[data-action=se-preview]");
    previewBtn.setAttribute("aria-pressed", String(simulate));
    previewBtn.innerHTML = simulate ? "← Sair do ensaio" : `${icon("eye")}<span>Ensaiar cena</span>`;
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
    // Cena sem fundo: a escolha da primeira imagem, o envio e os erros aparecem no próprio cartão central (onde o mestre está olhando).
    if (showStart) {
      const state = uploading ? "busy" : startChoice && !startChoice.pick ? "choice" : error ? `error:${error}` : "options";
      if (start.dataset.state !== state) {
        start.dataset.state = state;
        start.innerHTML = state === "busy" ? '<div class="se-start-card" role="status" aria-live="polite"><h3>Preparando o fundo da cena…</h3><p class="loading-line">Enviando a imagem. O editor abre a cena assim que terminar.</p></div>'
          : state === "choice" ? `<div class="se-start-card se-start-choice" role="region" aria-label="Primeira imagem da cena">${startPanel()}</div>`
          : startOptionsHtml();
        if (state === "choice") setTimeout(() => start.querySelector('[data-start-form] button[type="submit"]')?.focus(), 0);
      }
    } else start.dataset.state = "";
    if (showComp) { mountComposer(); composer.invalidate(); }
    renderSimBanner();
    if (!hintOverride) liveHint("");
    if (!showComp) redraw();
  }
  /** Dica da ferramenta sobre o palco (vazia na apresentação textual, no início, na composição e no ensaio). */
  function stageHint() {
    const showText = draft.kind === "text", showStart = !showText && !draft.mapKey && !mapOnly;
    if (showText || showStart || simulate || (composing() && !simulate)) return "";
    return PAINT.has(tool) || tool === "entry" ? `${helpOf(tool) || labelOf(tool)} Teclado: setas e Enter.` : helpOf(tool);
  }
  function startOptionsHtml() {
    return `<div class="se-start-card" role="region" aria-labelledby="se-start-h"><h3 id="se-start-h">Como deseja começar?${helpButton("campanhas.cenas.conceitos", "Mapa, cena e sessão")}</h3>${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}<p>Arraste uma imagem para qualquer ponto desta área ou escolha uma opção.</p><div class="se-start-grid">
      <button type="button" class="se-start-option primary" data-action="se-start" data-id="upload">${icon("image")}<strong>Enviar imagem do computador</strong><small>PNG ou JPEG; várias de uma vez</small></button>
      <button type="button" class="se-start-option" data-action="se-start" data-id="map">${icon("scenery")}<strong>Escolher um mapa existente</strong><small>Mapas e imagens da campanha</small></button>
      <button type="button" class="se-start-option" data-action="se-start" data-id="model">${icon("layers")}<strong>Usar um modelo</strong><small>Cenários prontos do Eternnus</small></button>
      <button type="button" class="se-start-option" data-action="se-start" data-id="blank">${icon("rect")}<strong>Começar com uma área em branco</strong><small>Fundo liso para compor com imagens</small></button>
    </div><p class="form-help">Também dá para colar uma imagem (Ctrl+V) ou arrastar do painel Acervo. Nada é mostrado aos jogadores até você apresentar a cena.</p></div>`;
  }
  /**
   * Faixa do ensaio: aviso fixo, observador (grupo, personagens, reservados e tokens de ensaio), estado da prévia do
   * servidor e as ações principais. Funciona sem jogadores e sem fichas (tokens de ensaio).
   */
  function renderSimBanner() {
    const banner = q("#se-sim");
    banner.hidden = !simulate;
    if (!simulate || !rehearsal) { banner.innerHTML = ""; return; }
    const options = observerOptions(rehearsal.sandbox);
    if (!options.some((o) => o.value === rehearsal.observer)) rehearsal.observer = "";
    const status = serverViewError ? `<span class="se-sim-status" role="alert">Prévia do servidor indisponível: ${esc(serverViewError)} Mostrando a simulação local (sem sentidos, percepção e exploração).</span>`
      : serverView ? '<span class="se-sim-status">Prévia real: mesmas regras da mesa (paredes, luz, visão, sentidos, percepção e áreas já exploradas).</span>'
      : '<span class="se-sim-status" role="status">Calculando a prévia real…</span>';
    const changed = sandboxChanged(rehearsal.start, rehearsal.sandbox);
    banner.innerHTML = `<p><strong>Ensaio — nada aqui vai para a mesa nem para os jogadores.</strong>${helpButton("campanhas.cenas.ensaio", "Ensaiar cena")}</p>
      <div class="se-sim-row"><label class="se-sim-viewer"><span>Visão de</span><select id="se-viewer" name="se-viewer">${options.map((o) => `<option value="${esc(o.value)}" ${o.value === rehearsal.observer ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
      <div class="se-sim-actions">${button(`${icon("plus")}<span>Token de ensaio</span>`, "se-rh-add", "", "subtle small")}${button("Aplicar alterações à preparação…", "se-rh-apply", "", "subtle small", changed ? "" : 'aria-disabled="true" data-tip="Nada mudou no ensaio ainda."')}${button("Sair do ensaio", "se-rh-exit", "", "subtle small")}</div></div><p class="small">${status}</p>`;
  }
  /** Painel do ensaio: token selecionado (perfil de teste, observador, imagem, converter) ou o resumo das mudanças. */
  function rehearsalPanel() {
    const k = sandboxSelected(), t = rehearsal.sandbox[k];
    if (!t) {
      const diff = rehearsalDiff(draft.prepared, rehearsal.sandbox), lines = diffLines(diff);
      return `<div class="se-panel"><h3>Ensaiar cena${helpButton("campanhas.cenas.ensaio", "Ensaiar cena")}</h3><p class="form-help">Arraste, redimensione ou retire tokens, acrescente tokens de ensaio e escolha de quem é a visão. Clique num token para trocar o perfil de teste (visão, luz e percepção).</p><p class="form-help">Sem perfil, um token sem ficha usa a visão e a luz padrão da mesa (muitas vezes nenhuma): use “Carregando uma fonte de luz” ou “Visão no escuro” para testar.</p><h4>Mudanças em relação à preparação</h4>${lines.length ? `<ul class="se-moves">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : '<p class="small">Nenhuma mudança ainda.</p>'}<p class="form-help">Ctrl+Z desfaz no ensaio. Esc sai (pergunta antes se algo mudou).</p></div>`;
    }
    const choice = rehearsal.profiles.get(t.key) || { id: "default", custom: {} };
    const observing = rehearsal.observer === (t.characterId ? `c:${t.characterId}` : `t:${t.key}`);
    const custom = choice.id === "custom" ? `<div class="se-rh-custom">${[["visionMeters", "Visão (m)", 300], ["lightMeters", "Luz que carrega (m)", 300], ["perception", "Percepção", 1000]].map(([f, l, max]) => `<div class="field"><label for="se-rh-${f}">${l}</label><input id="se-rh-${f}" type="number" min="0" max="${max}" step="1" data-rh-custom="${f}" value="${esc(choice.custom?.[f] ?? "")}" placeholder="Padrão"></div>`).join("")}</div>` : "";
    const kind = t.rehearsal ? "Token de ensaio (não é salvo)" : t.characterId ? "Personagem dos jogadores" : t.slotId ? "Personagem reservado" : t.masterCharacterId ? "Personagem do mestre" : "Marcador";
    return `<div class="se-panel"><h3>${esc(t.label || "Token")}</h3><p class="form-help">${esc(kind)} · coluna ${t.x + 1}, linha ${t.y + 1}.</p>
      <div class="field"><label for="se-rh-profile">Perfil de teste</label><select id="se-rh-profile" data-rh-profile="${esc(t.key)}">${PROFILE_PRESETS.map((p) => `<option value="${p.id}" ${p.id === choice.id ? "selected" : ""}>${esc(p.label)} — ${esc(p.hint)}</option>`).join("")}</select></div>${custom}
      <p class="form-help">${esc(profileLabel(choice) || "Visão padrão: o que a ficha e a mesa definem.")} Vale só para o ensaio.</p>
      <div class="form-actions">${button(observing ? "Vendo por este token" : "Ver por este token", "se-rh-observe", t.key, "subtle small", observing ? 'aria-pressed="true"' : 'aria-pressed="false"')}${t.characterId && !t.slotId ? "" : button("Trocar imagem…", "se-rh-image", t.key, "subtle small")}${t.rehearsal ? button("Converter em personagem reservado", "se-rh-convert", t.key, "subtle small") : ""}${button("Retirar do ensaio", "se-rh-remove", t.key, "text-button small")}</div></div>`;
  }

  function sidePanel() {
    if (error) return `<div class="se-panel"><p class="form-error" role="alert">${esc(error)}</p>${button("Entendi", "se-dismiss", "", "subtle")}</div>`;
    if (conflict) return `<div class="se-panel se-conflict" role="alert"><h3>Outra tela salvou antes</h3><p>${esc(conflict)}</p><p class="form-help">Suas alterações continuam aqui. Recarregar guarda este rascunho no navegador (Arquivo › Rascunho local…); "Salvar como nova cena" grava a cena numa cópia, sem tocar na outra.</p><div class="form-actions">${button("Continuar editando", "se-dismiss", "", "subtle")}${!mapOnly && saved.id ? button("Salvar como nova cena", "se-save-copy", "", "subtle") : ""}${button("Recarregar a versão salva", "se-reload", "", "danger")}</div></div>`;
    if (startChoice && !startChoice.pick && draft.mapKey) return startPanel();
    if (imagePick) return imagePickPanel();
    if (binding) return bindPanel();
    if (simulate && rehearsal) return rehearsalPanel();
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
  /** Campo "Forma no mapa" do marcador: redondo ou a imagem; sem imagem, explica onde escolher uma. */
  function lookField(t) {
    if (t.characterId) return "";
    if (!tokenImage(t)) return `<p class="form-help">Forma no mapa: marcador redondo.${t.masterCharacterId && npcs != null ? " Para usar a imagem, escolha uma na ficha do personagem, na Preparação." : ""}</p>`;
    return `<div class="field"><label for="se-t-look">Forma no mapa${helpButton("mesa.marcadores.forma", "Forma e tamanho do marcador")}</label><select id="se-t-look" data-token="appearance">${opt(LOOK_OPTIONS, lookOf(t))}</select></div>`;
  }
  /** Opções de forma para os próximos personagens do mestre colocados no mapa. */
  const placeLookField = (id) => `<fieldset class="se-place-look"><legend>Colocar personagens do mestre como${helpButton("mesa.marcadores.forma", "Forma e tamanho do marcador")}</legend>${LOOK_OPTIONS.map(([v, l]) => `<label class="check"><input type="radio" name="se-place-look-${id}" data-se-place-look value="${v}" ${placeLook === v ? "checked" : ""}> ${esc(l)}</label>`).join("")}<p class="form-help">Sem imagem na ficha, entra como marcador redondo. Dá para trocar depois no marcador.</p></fieldset>`;
  function tokenPanel(t) {
    const isCharacter = !!t.characterId;
    const layerSelect = `${lookField(t)}<div class="field"><label for="se-t-layer">Camada</label><select id="se-t-layer" data-token="layer">${opt(tokenLayers().map((l) => [l.id, l.name]), tokenLayerOf(t.layer, draft.layers))}</select></div>`;
    // Reservado (ADR-110): nome e lado vêm do reservado; aqui ficam o vínculo, a imagem e a posição desta cena.
    const slot = t.slotId ? slotStore.byId(t.slotId) : null;
    const bindReason = sceneDirty ? "Salve a cena antes de vincular." : !saved.id ? "Salve a cena antes de vincular." : "";
    const slotBox = slot ? `<div class="se-slot-note">${slotPreviewHtml(campaign.id, slot)}<p class="small">${slot.characterId ? `Personagem reservado vinculado a ${esc(slot.characterName || "um personagem")}.` : "Personagem reservado: renomeie no painel Personagens. Vincule a uma ficha quando o jogador chegar."}</p></div><div class="form-actions">${slot.characterId ? button("Desvincular", "se-slot-unbind", slot.id, "subtle small", bindReason ? `aria-disabled="true" data-tip="${esc(bindReason)}"` : "") : button("Vincular a personagem…", "se-slot-bind", slot.id, "subtle small", bindReason ? `aria-disabled="true" data-tip="${esc(bindReason)}"` : "")}${button("Trocar imagem…", "se-token-image", "", "subtle small")}</div>` : "";
    if (slot && !isCharacter) return `<form class="se-panel" data-token-form><h3>${esc(t.label || "Reservado")}${helpButton("campanhas.cenas.reservados", "Personagens reservados")}</h3><p class="form-help">Coluna ${t.x + 1}, linha ${t.y + 1}. Arraste, use as setas ou o menu (botão direito) para mover e ajustar o tamanho.</p>${slotBox}<label class="check"><input type="checkbox" data-token="hidden" ${t.hidden ? "checked" : ""}> Oculto: só você vê até revelar</label>${layerSelect}<div class="form-actions se-danger-zone">${button("Mais propriedades…", "se-token-props", "", "subtle")}${button("Remover da cena", "se-token-remove", "", "text-button")}</div></form>`;
    return `<form class="se-panel" data-token-form><h3>${esc(t.label || "Marcador")}</h3><p class="form-help">Coluna ${t.x + 1}, linha ${t.y + 1}. Para mover, clique numa casa livre, arraste ou use as setas com o mapa em foco.</p>${isCharacter ? `<p class="small">Personagem dos jogadores: entra nesta casa quando a cena for apresentada, se a pessoa estiver na mesa.</p>${slotBox}` : `<div class="field"><label for="se-t-label">Nome</label><input id="se-t-label" data-token="label" maxlength="40" required value="${esc(t.label)}"></div><div class="field"><label for="se-t-side">Lado</label><select id="se-t-side" data-token="side">${opt(SIDES, t.side || "enemy")}</select></div><label class="check"><input type="checkbox" data-token="hidden" ${t.hidden ? "checked" : ""}> Oculto: só você vê até revelar</label>${mode === "complete" ? `<div class="field"><label for="se-t-light">Luz que carrega (casas)</label><input id="se-t-light" data-token="light" type="number" min="0" max="30" value="${t.light ?? ""}" placeholder="Padrão da mesa"></div>` : ""}`}${layerSelect}<div class="form-actions se-danger-zone">${button("Mais propriedades…", "se-token-props", "", "subtle")}${button("Remover da cena", "se-token-remove", "", "text-button")}</div></form>`;
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
      <section class="se-subform"><h4>Personagem do mestre</h4>${npcs == null ? '<p class="loading-line" role="status">Carregando…</p>' : npcList.length ? `${placeLookField("add")}<ul class="se-pick-list">${npcList.map((n) => `<li><span>${esc(n.name)}<small>${esc(n.summary || "")}</small></span>${button("Colocar aqui", "se-add-npc", n.id, "subtle small")}</li>`).join("")}</ul><p class="form-help">Na mesa, “Cópia para o encontro” ajusta recursos sem alterar o original.</p>` : '<p class="muted small">Crie personagens do mestre na Preparação (pasta Personagens).</p>'}</section></div>`;
  }
  /** Preenche raio e penumbra pela predefinição; "Personalizado" abre o campo do raio (Básica). */
  function applyLightPreset(select) {
    const form = select.form, p = presetById(LIGHT_PRESETS, select.value);
    const hidden = form.querySelector("[data-light-dim]"), custom = form.querySelector("[data-light-custom]");
    if (!p) { if (hidden) hidden.disabled = true; if (custom) { custom.open = true; form.querySelector("#se-radius")?.focus(); } return; }
    form.querySelector("#se-radius").value = p.radius;
    const dim = form.querySelector("#se-dim");
    if (dim) dim.value = p.dim;
    if (hidden) { hidden.value = p.dim; hidden.disabled = false; }
  }
  /** Editar o raio à mão vira "Personalizado" (a penumbra da predefinição deixa de ser enviada na Básica). */
  function markLightCustom(form) {
    const select = form.querySelector("[data-light-preset]"), hidden = form.querySelector("[data-light-dim]");
    const radius = Number(form.querySelector("#se-radius").value);
    const dim = form.querySelector("#se-dim")?.value ?? hidden?.value;
    const match = lightPresetOf(radius, dim);
    if (select) select.value = match;
    if (hidden && match === CUSTOM) hidden.disabled = true;
  }
  function lightPanel() {
    const light = layer.lights.find((l) => l.x === pick.x && l.y === pick.y);
    const advanced = mode === "complete" ? `<div class="field"><label for="se-dim">Penumbra até (casas)</label><input id="se-dim" name="dim" type="number" min="1" max="30" value="${light?.dim ?? ""}" placeholder="Sem penumbra"><p class="form-help">A luz cai aos poucos entre o raio e a penumbra. A penumbra também ilumina para as regras.</p></div><div class="field"><label for="se-color">Cor</label><input id="se-color" name="color" type="color" value="${esc(light?.color || "#ffbe64")}"></div><div class="field"><label for="se-intensity">Intensidade (10 a 100)</label><input id="se-intensity" name="intensity" type="number" min="10" max="100" value="${light?.intensity ?? 100}"></div><div class="field"><label for="se-anim">Animação</label><select id="se-anim" name="animation">${opt([["", "Fixa"], ["flicker", "Tremeluzir (tocha)"], ["pulse", "Pulsar (magia)"]], light?.animation || "")}</select><p class="form-help">Só visual. Quem pede menos movimento vê a luz fixa.</p></div>` : "";
    // Predefinições (ADR-100): a escolha preenche os números; "Personalizado" mostra o raio na Básica.
    const presetId = light ? lightPresetOf(light.radius, light.dim) : "torch";
    const initial = presetById(LIGHT_PRESETS, presetId);
    const presets = `<div class="field"><div class="field-label"><label for="se-light-preset">Tipo de luz</label>${helpButton("mesa.luz.predefinicoes", "Tipos de luz")}</div><select id="se-light-preset" data-light-preset>${LIGHT_PRESETS.map((p) => `<option value="${p.id}" ${p.id === presetId ? "selected" : ""}>${esc(presetText(p))}</option>`).join("")}<option value="${CUSTOM}" ${presetId === CUSTOM ? "selected" : ""}>Personalizado</option></select></div>`;
    const radiusField = `<div class="field"><label for="se-radius">Raio de luz plena (casas)</label><input id="se-radius" name="radius" type="number" min="1" max="30" required value="${light?.radius ?? 4}"></div>`;
    const radius = mode === "complete"
      ? radiusField
      : `<details class="light-custom" data-light-custom ${presetId === CUSTOM ? "open" : ""}><summary>Personalizar</summary>${radiusField}</details><input type="hidden" name="dim" data-light-dim value="${initial?.dim ?? ""}" ${initial ? "" : "disabled"}>`;
    return `<form class="se-panel" data-light-form><h3>Foco de luz · coluna ${pick.x + 1}, linha ${pick.y + 1}</h3><p class="form-help">${esc(HELP.light)}</p>${presets}${radius}${advanced}<div class="form-actions">${light ? button("Apagar foco", "se-light-remove", "", "text-button") : ""}<button type="submit" class="primary">${light ? "Atualizar" : "Adicionar"}</button></div></form>`;
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
    // Mão, zoom e seleção continuam no ensaio; as demais ferramentas editam a preparação e encerram o ensaio.
    if (simulate && !["select", "hand", "zoom"].includes(id) && !leaveRehearsal()) { tool = "select"; shell.setTool("select"); board.camera.setPan(false); return renderAll(); }
    tool = id; pick = null;
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
  /**
   * Ensaiar cena (ADR-111): liga a caixa de areia, sempre refeita a partir da preparação atual (nunca altera o rascunho).
   * Desligar descarta o ensaio (pergunta antes se algo mudou).
   */
  function toggleSimulate(on = !simulate) {
    if (on === simulate) return;
    if (!on) { if (leaveRehearsal()) { renderAll(); say("Ensaio encerrado. A preparação continua como estava."); } return; }
    if (!mapKind() || !meta) return say("O ensaio vale para cenas com mapa tático ou movimentação livre.");
    commitTyping();
    const sandbox = sandboxFrom(draft.prepared);
    rehearsal = { start: clone(sandbox), sandbox, observer: defaultObserver(sandbox), profiles: new Map(), past: [], counter: 0, selected: null };
    simulate = true; selection = []; pick = null; serverView = null; serverViewError = ""; binding = null; imagePick = null;
    if (["token", "add", "light", "mark"].includes(panel)) panel = "overview";
    renderAll(); showProps();
    say(sandbox.length ? "Ensaio aberto: mova, teste a luz e a visão à vontade. Nada vai para a mesa." : "Ensaio aberto: acrescente um token de ensaio para testar a visão.");
  }
  function onEscape(e) {
    if (dismissHelp()) return;
    // Renomear reservado: Esc desiste sem gravar.
    if (e.target?.matches?.("[data-slot-rename]")) { renaming = null; renderCharacterList(); return; }
    if (isTypingTarget(e.target)) { commitTyping(); e.target.blur(); return; }
    // Primeiro desiste do arraste ou da alça em andamento (o marcador volta); só depois fecha painéis e o ensaio.
    if (board.cancelInteraction()) return say("Movimento cancelado.");
    if (imagePick) { imagePick = null; return renderSide(); }
    if (binding) { binding = null; return renderSide(); }
    if (simulate) return toggleSimulate(false);
    if (startChoice) { startChoice = null; renderSide(); return renderStage(); }
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
    // Tokens de ensaio nunca são salvos (o servidor recusa `rehearsal: true`).
    prepared: mapKind() ? draft.prepared.filter((t) => !t.rehearsal).map(tokenInput) : [],
  });
  /**
   * Marcador no formato do contrato (SceneTokenInput). `slotId` só segue quando o reservado ainda existe na lista
   * carregada: versões restauradas podem trazer reservados excluídos, e o servidor recusaria a cena inteira.
   */
  function tokenInput(t) {
    const slotId = t.slotId && (!slotStore.listed || slotStore.byId(t.slotId)) ? t.slotId : null;
    return { characterId: t.characterId || null, masterCharacterId: t.masterCharacterId || null, slotId, label: t.label, side: t.side, x: t.x, y: t.y, fx: freeOn() ? t.fx ?? null : null, fy: freeOn() ? t.fy ?? null : null, hidden: !!t.hidden, light: t.light ?? null, appearance: t.appearance ?? null, size: t.size ?? null, imageUrl: t.imageUrl ?? null, width: t.width ?? null, height: t.height ?? null, layer: tokenLayerOf(t.layer, draft.layers) };
  }
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
      // Reservados citados no arranjo: confere a lista antes (reservados excluídos saem do vínculo, não da posição).
      if (!mapOnly && draft.prepared.some((t) => t.slotId) && !slotStore.listed) await slotStore.load(true);
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
    // Prévia do impacto (P1.2): se a nova grade tira algo das preparações, o mestre confirma antes de aplicar.
    const loss = disposeGrid?.lossWarning?.();
    if (loss && !confirm(loss)) return say("Grade não aplicada. Nada mudou.");
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
      case "se-dismiss": conflict = null; error = ""; applying = false; renderSide(); return renderStage();
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
      case "se-start-cancel": startChoice = null; renderSide(); return renderStage();
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
      // Personagens reservados (ADR-110)
      case "se-slot-new": return createSlot(id);
      case "se-slot-menu": return slotMenu(id, b);
      case "se-slot-retry": await slotStore.load(true); renderCharacterList(); return renderAssets(true);
      case "se-slot-bind": { const s = slotStore.byId(id); return s && openBind(s); }
      case "se-slot-unbind": { const s = slotStore.byId(id); return s && unbindSlot(s); }
      case "se-bind-go": return confirmBind();
      case "se-bind-cancel": binding = null; return renderSide();
      case "se-token-image": return selection.length === 1 && openImagePick(draft.prepared[selection[0]]?.slotId && !draft.prepared[selection[0]]?.imageUrl ? { kind: "slot", id: draft.prepared[selection[0]].slotId } : { kind: "token", i: selection[0] });
      case "se-ip-use": return useImage(id || "");
      case "se-ip-upload": return q("#se-ip-file")?.click();
      case "se-ip-cancel": imagePick = null; return renderSide();
      // Acervo rápido
      case "se-quick-cat": quickCat = id; return renderAssets(true);
      // Ensaio (ADR-111)
      case "se-rh-add": return addRehearsalToken();
      case "se-rh-apply": return applyRehearsalChanges();
      case "se-rh-exit": return toggleSimulate(false);
      case "se-rh-observe": { const t = rehearsal?.sandbox.find((x) => x.key === id); return t && setObserver(t.characterId ? `c:${t.characterId}` : `t:${t.key}`); }
      case "se-rh-image": return openImagePick({ kind: "sandbox", key: id });
      case "se-rh-convert": return convertToSlot(id);
      case "se-rh-remove": return sandboxRemove(rehearsal?.sandbox.findIndex((x) => x.key === id) ?? -1);
      case "se-rh-show": if (rehearsal) { rehearsal.selected = id; board.setView(boardView()); renderSide(); } return;
    }
  }
  function loadNpcs() {
    if (npcs || npcLoading || mapOnly) return npcLoading;
    npcLoading = api(`${base}/npcs`, "GET", undefined, { background: true }).then((r) => { npcs = r.items || []; }).catch(() => { npcs = []; }).finally(() => {
      npcLoading = null;
      if (closed) return;
      if (panel === "add" || panel === "token") renderSide();
      renderCharacters();
      redraw();
    });
    return npcLoading;
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches("[data-se-char-search]")) return renderCharacterList();
    if (t.matches("[data-se-place-look]")) {
      placeLook = t.value === LOOK_IMAGE ? LOOK_IMAGE : LOOK_ROUND;
      root.querySelectorAll("[data-se-place-look]").forEach((r) => { r.checked = r.value === placeLook; });
      return;
    }
    if (t.matches("[data-asset-q]")) return renderAssets();
    if (t.matches("[data-ip-q]") && imagePick) {
      imagePick.query = t.value;
      const host = shell.panel("props")?.querySelector("[data-ip-list]");
      if (host) host.innerHTML = imagePickRows();
      return;
    }
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
      else if (key === "appearance") {
        const problem = lookProblem(i, t.value);
        if (problem) { t.value = lookOf(tok); commitTyping(); return say(problem); }
        next.appearance = t.value === LOOK_IMAGE && tokenImage(tok) ? LOOK_IMAGE : null;
      }
      else next[key] = t.value;
      draft.prepared[i] = next;
      if (t.type === "checkbox" || t.tagName === "SELECT") commitTyping();
      recomputeDirty(); redraw(); renderStructure();
      if (key === "layer") { selection = selection.filter(editable); renderLayers(); }
    }
  }
  async function onChange(e) {
    const t = e.target;
    if (t.matches?.("[data-light-preset]")) return applyLightPreset(t);
    if ((t.id === "se-radius" || t.id === "se-dim") && t.form?.matches("[data-light-form]")) return markLightCustom(t.form);
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
    if (t.name === "se-viewer") return setObserver(t.value);
    if (t.dataset.rhProfile) return setProfile(t.dataset.rhProfile, t.value);
    if (t.dataset.rhCustom && rehearsal?.selected) {
      const key = rehearsal.selected, prev = rehearsal.profiles.get(key) || { id: "custom", custom: {} };
      return setProfile(key, "custom", { ...(prev.custom || {}), [t.dataset.rhCustom]: t.value });
    }
    if (t.matches("[data-bind-char]") && binding) { binding.characterId = t.value; return loadBindPreview(); }
    if (t.matches("[data-bind-keep]") && binding) { binding.keepImage = t.checked; return; }
    if (t.name === "se-bind-resolve" && binding) { binding.resolve = t.value; return renderSide(); }
    if (t.id === "se-ip-file") { const f = t.files?.[0]; t.value = ""; return uploadPickImage(f); }
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
      const visual = data.radius != null && "color" in data ? { dim: dim === radius ? null : dim, color: data.color && data.color.toLowerCase() !== "#ffbe64" ? data.color.toLowerCase() : null, intensity: intensity === 100 ? null : intensity, animation: data.animation || null }
        // Básica com predefinição: só a penumbra da predefinição; cor, intensidade e animação ficam como estavam.
        : data.dim !== undefined ? { dim: dim === radius ? null : dim } : {};
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
  const onFocusOut = (e) => {
    if (e.target.matches?.("[data-slot-rename]")) return commitRename(e.target);
    if (e.target.matches?.("input, textarea, select")) commitTyping();
  };
  // Renomear reservado: Enter grava (antes dos atalhos do editor). F2 no item da lista começa a renomear.
  const onRenameKey = (e) => {
    if (e.key === "Enter" && e.target.matches?.("[data-slot-rename]")) { e.preventDefault(); e.stopPropagation(); e.target.blur(); return; }
    if (e.key === "F2" && !isTypingTarget(e.target)) { const li = e.target.closest?.("[data-se-char^='slot:']"); if (li) { e.preventDefault(); startRename(li.dataset.seChar.slice(5)); } }
  };
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
  // No ensaio, soltar personagens também vale (entram só na caixa de areia).
  const accepts = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(DND) && !!meta && mapKind() && (simulate || !composing());
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
  root.addEventListener("keydown", onRenameKey, true);
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
    if (id === "blank") { startChoice = { blank: true }; error = ""; renderSide(); renderStage(); }
  }

  function cleanup() {
    disposeDrop(); pasting.dispose(); composer?.destroy(); clearTimeout(previewTimer2);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    imageCache.clear();
    shell.stage.removeEventListener("contextmenu", onStageMenu);
    closed = true;
    root.removeEventListener("click", onClick); root.removeEventListener("keydown", onWallKey); root.removeEventListener("keydown", onRenameKey, true); clearTimeout(previewTimer); root.removeEventListener("input", onInput); root.removeEventListener("change", onChange);
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
