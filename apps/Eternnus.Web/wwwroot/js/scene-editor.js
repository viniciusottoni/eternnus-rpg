// Editor único de cenas (preparação privada) sobre o núcleo gráfico comum (ADR-081): menus, ferramentas, palco,
// painéis Propriedades/Camadas/Estrutura/Personagens/Histórico e barra de estado.
// Usado na Preparação da campanha, na preparação compartilhada de um mapa (`kind: "layer"`) e sobre a mesa ao vivo,
// sem substituí-la. Escritas por api.js; o servidor valida grade, permissões e conflitos de revisão.
// Nada aqui apresenta a cena aos jogadores: "Aplicar à cena atual" e "Reiniciar cena" são ações explícitas.
import { helpButton, dismissHelp } from "./help.js";
import { api } from "./api.js";
import { esc, button } from "./ui.js";
import { createBoard } from "./table-map.js";
import { FOG_TOOLS, MARK_KINDS, paintLocal, toggleDoorLocal, sharedPreview } from "./fog-policy.js";
import { interfaceMode, setInterfaceMode } from "./interface-mode.js";
import { createEditorShell, openContextMenu, openPropertiesDialog, renderLayersPanel, renderStructurePanel, renderHistoryPanel, icon } from "./editor-core.js";
import { addLayer, removeLayer, moveLayer, patchLayer, createHistory, isRequiredLayer, isTypingTarget, MAX_HISTORY } from "./editor-policy.js";
import {
  HELP, SCENE_KINDS, VISIBILITY_OPTIONS, APPLY_PRESERVES, APPLY_TOKENS, TOOL_GROUPS, toolLabel, acceptsMap, hiddenCustomizations,
  placementProblem, simulateView, recentMapKeys, mapTypeLabel, sceneKindLabel, SCENE_SIDES, sceneLayers, tokenLayerOf, layerAlpha,
  clipboardFrom, pastePlacement, moveTokensBy, structureGroups, sameSnapshot,
} from "./scene-policy.js";

const SIDES = SCENE_SIDES;
const opt = (list, current) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`).join("");
const PAINT = new Set(FOG_TOOLS.map((t) => t.id));
/** Ferramentas que editam a preparação do mapa (paredes, luz, névoa e exploração). */
const LAYER_TOOLS = new Set(["reveal", "conceal", "wall", "blockMove", "blockLight", "door", "toggleDoor", "erase", "light", "mark", "fogState", "resetExploration"]);
/** Painéis que existem também na Básica (os demais voltam ao resumo ao trocar para a Básica). */
const BASIC_PANELS = new Set(["overview", "token", "add", "light", "mark", "hidden", "scenery", "visibility", "text", "notes"]);
const LOCAL_TOOLS = {
  hand: ["Mão (mover a vista)", "Mão: arraste para percorrer o mapa. Espaço ou o botão do meio também movem a vista."],
  zoom: ["Zoom", "Zoom: clique para aproximar; com Alt ou Shift, afasta. A roda do mouse aproxima no cursor."],
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
  };
}

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
  let mode = interfaceMode();
  let activeLayer = "elements", clipboard = [], hover = null, lastCell = null, enterPress = null;
  const mods = { add: false };
  let disposePicker = () => {}, disposeGrid = null;
  const recents = recentMapKeys(sceneList?.items || [], "");
  const mapOf = (key) => maps.items.find((m) => m.key === key);
  const mapKind = () => draft.kind === "map";
  const manual = () => draft.visionMode === "manual" || (!draft.visionMode && !!layer?.manual);
  const say = (text) => shell.message(text);

  // ---------- Ferramentas (Básica primeiro; grupos da Completa depois) ----------
  function toolProblem(id) {
    if ((id === "add" || id === "npc") && !meta) return NEED_MAP;
    if (LAYER_TOOLS.has(id) && !meta) return NEED_MAP;
    if (LAYER_TOOLS.has(id) && layerLocked()) return "Salve o alcance da preparação antes de editar o mapa.";
    if (id === "gridAdjust" && !draft.mapKey?.startsWith("asset:")) return "A grade de cenários prontos já está definida.";
    return null;
  }
  // Dica da ferramenta: o texto de ajuda dela sem o nome repetido no início ("Nome: o que fazer").
  const tipOf = (id) => { const h = helpOf(id), i = h.indexOf(": "), t = i > 0 && i < 60 ? h.slice(i + 2) : h; return t.charAt(0).toUpperCase() + t.slice(1); };
  const T = (id, iconName, key, group, basic, extra = {}) => ({ id, label: labelOf(id), tip: tipOf(id), icon: iconName, key, group, basic, disabled: () => toolProblem(id), ...extra });
  const panelTool = (id) => ({ action: () => openPanel(id), pressed: () => panel === id });
  const notMap = () => !mapKind();
  const tools = [
    T("select", "select", "v", "basic", true),
    T("add", "plus", "a", "basic", true, { hidden: () => mapOnly || notMap() }),
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
    T("light", "light", "l", "light", false, { hidden: notMap }),
    T("fogState", "fog", "f", "light", false, { hidden: notMap, ...panelTool("fogState") }),
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
    panels: [
      { id: "props", title: "Propriedades" },
      ...(mapOnly ? [] : [{ id: "layers", title: "Camadas" }]),
      { id: "structure", title: "Estrutura" },
      ...(mapOnly ? [] : [{ id: "characters", title: "Personagens" }]),
      { id: "history", title: "Histórico", basic: false },
    ],
    actions: `${nameField}${button(`${icon("eye")}<span>Ver como jogador</span>`, "se-preview", "", "subtle", 'aria-pressed="false"')}${button("Salvar preparação", "se-save", "", "primary")}<span id="se-apply-slot"></span>`,
    keys: {
      "mod+s": () => save(),
      "mod+z": () => undo(), "mod+shift+z": () => redo(), "mod+y": () => redo(),
      "mod+c": () => copy(), "mod+x": () => cut(), "mod+v": () => paste(),
      "mod+a": () => selectAll(), "mod+d": () => deselect(),
      delete: () => removeSelection(), backspace: () => removeSelection(),
      escape: (e) => onEscape(e),
    },
    isDirty: () => sceneDirty || layerDirty,
    onTool: (id) => onTool(id),
    onModeChange: (next) => onModeChange(next),
    onClose: () => cleanup(),
  });
  const root = shell.root;
  root.classList.add("scene-editor");
  root.dataset.tool = tool;
  const q = (sel) => root.querySelector(sel);
  shell.stage.innerHTML = `<div class="ed-stage-banner se-sim-banner" id="se-sim" role="note" hidden></div><div class="board se-board" id="se-board"></div><div class="se-text-preview" id="se-text" hidden></div><p class="se-hint" id="se-hint" role="status" hidden></p>`;
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
      return r.size > 0 ? { x: r.x, y: r.y, cellPx: r.size, cellUnits: Number(meta.scaleMeters) || 1.5, unit: "m" } : null;
    },
  });

  // ---------- Histórico (instantâneos do rascunho e da preparação do mapa) ----------
  function capture() { return { draft: clone(draft), layer: clone(layer), reset: resetExploration }; }
  function restore(snap) {
    draft = clone(snap.draft); layer = clone(snap.layer); resetExploration = !!snap.reset;
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
  function recomputeDirty() {
    sceneDirty = !mapOnly && !sameSnapshot(draft, savedScene);
    layerDirty = !!layer && (!sameSnapshot(layer, savedLayer) || resetExploration);
    renderStatus();
  }
  /** Contexto trocado (cenário, tipo, alcance, grade): instantâneos antigos não valem para o novo mapa. */
  function resetHistory(reason) { history.clear(); if (reason) say(reason); }
  function undo() { commitTyping(); const label = history.undo(); say(label ? `Desfeito: ${label}.` : "Nada para desfazer."); }
  function redo() { commitTyping(); const label = history.redo(); say(label ? `Refeito: ${label}.` : "Nada para refazer."); }

  // ---------- Dados do mapa ----------
  async function loadLayer() {
    layer = null; meta = null; savedLayer = null; resetExploration = false;
    const m = mapOf(draft.mapKey);
    if (draft.kind !== "map" || !m || m.kind !== "tileset") return;
    const data = await api(`${base}/assets/layers?key=${encodeURIComponent(draft.mapKey)}${saved.id ? `&scene=${encodeURIComponent(saved.id)}` : ""}`);
    meta = data;
    layer = { fog: data.fog, manual: data.manual, cells: data.cells, lights: data.lights.map((l) => ({ ...l })), revealed: data.revealed, marks: data.marks.map((x) => ({ ...x })) };
    savedLayer = clone(layer);
  }
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
    if (draft.kind === "image" && m) return { map: { kind: "cartographic", key: m.key, name: m.name, imageUrl: m.imageUrl || "/assets/valley.webp", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    if (!meta) return { map: { kind: "cartographic", key: "none", name: "", imageUrl: "", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    let tokens = draft.prepared.map((t, i) => {
      // Camadas da cena: olho e opacidade só mudam o desenho no editor; a simulação mostra o que os jogadores veem.
      const alpha = simulate ? 1 : layerAlpha(layerOfToken(t));
      return { id: "p" + i, characterId: t.characterId || null, label: t.label, side: t.side || "ally", x: t.x, y: t.y, fx: t.fx ?? null, fy: t.fy ?? null, hidden: !!t.hidden, light: t.light ?? null, appearance: t.appearance ?? null, size: t.size ?? null, alpha: alpha < 1 ? alpha : null };
    });
    let fog;
    if (simulate) {
      const sim = simulateView({ visionMode: draft.visionMode, layer, width: width(), height: height(), tokens, characters, settings: meta.settings || {}, scale: meta.scaleMeters || 1.5, viewer: viewer || null });
      fog = sim.fog.active ? sim.fog : { active: false };
      tokens = sim.tokens;
    } else fog = { active: fogOn(), cells: layer.cells, lights: layer.lights, marks: layer.marks, shared: shared() };
    return {
      map: { kind: "tileset", key: meta.layerKey, name: meta.name, rows: meta.rows, imageUrl: meta.imageUrl, gridPixels: meta.gridPixels, gridOffsetX: meta.gridOffsetX, gridOffsetY: meta.gridOffsetY, scaleMeters: meta.scaleMeters, freeMovement: freeOn() },
      tokens, participants: tokens.filter((t) => t.characterId).map((t) => ({ characterId: t.characterId, online: true })), session: {}, me: { isMaster: !simulate, characterId: null }, fog,
    };
  }
  function boardView() {
    const paint = !simulate && PAINT.has(tool) && !!meta && !layerLocked();
    return {
      mode: paint ? "paint" : "none", fogTools: !simulate && (mode === "complete" || paint), grid, reach: [], attack: [],
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
  function onPaint(cells) { if (PAINT.has(tool)) paintCells(tool, cells); }
  function onHover(p) {
    hover = p;
    if (p) lastCell = { x: p.x, y: p.y, fx: p.fx, fy: p.fy };
    shell.setStatus({ coords: p ? `Coluna ${p.x + 1}, linha ${p.y + 1}` : "" });
  }

  // ---------- Seleção, área de transferência e camadas ----------
  function placeToken(token, cell, label) {
    if (simulate || mapOnly || !mapKind() || !meta) { say("Personagens e marcadores entram em cenas de mapa tático."); return false; }
    const target = draft.layers.find((l) => l.id === activeTokenLayer());
    if (target?.locked) { say(`A camada “${target.name}” está bloqueada. Escolha outra em Camadas.`); return false; }
    if (token.characterId && draft.prepared.some((t) => t.characterId === token.characterId)) { say("Esse personagem já está na cena."); return false; }
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

  // ---------- Menus de contexto ----------
  function onContext({ cell, token, x, y }) {
    const at = { x, y };
    if (simulate) return openContextMenu(at, [{ label: "Voltar à edição", run: () => toggleSimulate(false) }], { label: "Simulação" });
    if (cell) lastCell = cell;
    if (token) {
      const i = Number(token.id.slice(1)), tok = draft.prepared[i];
      if (tok && layerOfToken(tok)?.visible !== false) return tokenMenu(i, at);
    }
    cellMenu(cell, at);
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
  function cellMenu(cell, at) {
    const items = [];
    const tactical = !!meta && mapKind();
    if (cell && tactical && !mapOnly) {
      const placed = new Set(draft.prepared.map((t) => t.characterId).filter(Boolean));
      if (npcs == null) loadNpcs();
      const people = [
        ...characters.filter((c) => !placed.has(c.id)).map((c) => ({ label: c.name, hint: "Personagem dos jogadores", run: () => placeRef(`pc:${c.id}`, cell) })),
        ...(npcs || []).filter((n) => !n.copy).map((n) => ({ label: n.name, hint: "Personagem do mestre", run: () => placeRef(`npc:${n.id}`, cell) })),
      ];
      items.push(
        { label: "Adicionar marcador aqui", run: () => { pick = cell; selection = []; panel = "add"; renderSide(); showProps(); focusFirst(); } },
        { label: "Colocar personagem aqui", items: people, disabled: !people.length, disabledReason: npcs == null ? "Carregando personagens…" : "Nenhum personagem disponível para colocar." },
        { label: "Colar aqui", shortcut: "mod+v", disabled: !clipboard.length, disabledReason: "Copie ou recorte um marcador antes.", run: () => paste(cell) },
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
            { label: "Reiniciar cena…", danger: true, disabled: dirty, disabledReason: "Salve a preparação antes de reiniciar a cena.", run: () => { applying = "restart"; renderSide(); showProps(); } }] : []),
          { separator: true },
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
        { label: "Cenário…", run: () => openPanel("scenery") },
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
    if (!mapKind() || !meta) { host.innerHTML = '<p class="muted small se-empty-note">Personagens entram em cenas com mapa tático. Escolha um cenário com grade.</p>'; return; }
    if (!host.querySelector("[data-se-char-search]")) {
      host.innerHTML = `<div class="field se-char-search"><label for="se-char-q">Buscar personagem</label><input id="se-char-q" type="search" data-se-char-search maxlength="60" autocomplete="off" placeholder="Nome"></div><div data-se-char-list></div><p class="form-help">Arraste para o mapa ou use “Colocar no cursor” (a última casa apontada ou escolhida). A validação é a mesma de “Colocar aqui”.</p>`;
    }
    renderCharacterList();
  }
  function renderCharacterList() {
    const host = shell.panel("characters");
    const list = host?.querySelector("[data-se-char-list]");
    if (!list) return;
    const query = plain(host.querySelector("[data-se-char-search]")?.value);
    const match = (s) => !query || plain(s).includes(query);
    const placed = new Set(draft.prepared.map((t) => t.characterId).filter(Boolean));
    const pcs = characters.filter((c) => !placed.has(c.id) && match(c.name));
    const masters = (npcs || []).filter((n) => !n.copy && match(`${n.name} ${n.summary || ""}`));
    const item = (ref, name, sub) => `<li class="se-char" draggable="true" data-se-char="${esc(ref)}"><span>${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${button(`Colocar <span class="sr-only">${esc(name)} </span>no cursor`, "se-place-cursor", ref, "subtle small")}</li>`;
    list.innerHTML = `<h4 class="se-char-head">Personagens dos jogadores</h4>${pcs.length ? `<ul class="se-pick-list">${pcs.map((c) => item(`pc:${c.id}`, c.name, "Fora da cena")).join("")}</ul>` : `<p class="muted small">${query ? "Nenhum resultado." : characters.length ? "Todos os personagens da campanha já estão na cena." : "Nenhum personagem vinculado à campanha ainda."}</p>`}
      <h4 class="se-char-head">Personagens do mestre</h4>${npcs == null ? '<p class="loading-line" role="status">Carregando…</p>' : masters.length ? `<ul class="se-pick-list">${masters.map((n) => item(`npc:${n.id}`, n.name, n.summary || "")).join("")}</ul>` : `<p class="muted small">${query ? "Nenhum resultado." : "Crie personagens do mestre na Preparação (pasta Personagens)."}</p>`}`;
  }
  function renderHistory() {
    const host = shell.panel("history");
    if (host) renderHistoryPanel(host, history);
  }
  const renderPanels = () => { renderLayers(); renderStructure(); renderCharacters(); renderHistory(); };

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
    const text = q("#se-text");
    const showText = draft.kind === "text" || !draft.mapKey;
    text.hidden = !showText;
    boardHost.hidden = showText;
    if (showText) text.innerHTML = draft.kind === "text" ? `<article class="se-text-card"><span class="eyebrow">Apresentação textual</span><h3>${esc(draft.name || "Cena sem nome")}</h3><p>${esc(draft.sharedText || "Escreva o texto compartilhável em Cena › Texto compartilhável.")}</p></article>` : `<div class="empty ed-stage-empty"><h3>Escolha um cenário</h3><p>Use “Escolher cenário” para ver miniaturas de mapas prontos e imagens da campanha.</p>${button("Escolher cenário", "se-tool", "scenery", "primary")}</div>`;
    renderSimBanner();
    const hint = simulate ? "" : PAINT.has(tool) ? `${helpOf(tool) || labelOf(tool)} Teclado: setas e Enter.` : helpOf(tool);
    const hintEl = q("#se-hint");
    hintEl.textContent = showText ? "" : hint;
    hintEl.hidden = showText || !hint;
    redraw();
  }
  /** Simulação: escolher de quem é a visão (personagens posicionados). Sem personagem, só luz comum e revelações. */
  function renderSimBanner() {
    const banner = q("#se-sim");
    banner.hidden = !simulate;
    if (!simulate) { banner.innerHTML = ""; return; }
    const placed = draft.prepared.filter((t) => t.characterId);
    if (viewer && !placed.some((t) => t.characterId === viewer)) viewer = "";
    const options = [`<option value="">Grupo — só luz comum e áreas reveladas</option>`, ...placed.map((t) => `<option value="${esc(t.characterId)}"${t.characterId === viewer ? " selected" : ""}>${esc(t.label || "Personagem")}</option>`)].join("");
    banner.innerHTML = `<p>${esc(HELP.preview)}${helpButton("campanhas.cenas.simulacao", "Simulação de visão")}</p>${placed.length && mapKind() ? `<label class="se-sim-viewer"><span>Visão de</span><select id="se-viewer" name="se-viewer">${options}</select></label>` : ""}`;
  }

  function sidePanel() {
    if (error) return `<div class="se-panel"><p class="form-error" role="alert">${esc(error)}</p>${button("Entendi", "se-dismiss", "", "subtle")}</div>`;
    if (conflict) return `<div class="se-panel se-conflict" role="alert"><h3>Outra tela salvou antes</h3><p>${esc(conflict)}</p><p class="form-help">Suas alterações continuam aqui. Você pode copiar o que precisar antes de recarregar.</p><div class="form-actions">${button("Continuar editando", "se-dismiss", "", "subtle")}${button("Recarregar a versão salva", "se-reload", "", "danger")}</div></div>`;
    if (applying) return applyPanel();
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
    return `<form class="se-panel" data-light-form><h3>Foco de luz · coluna ${pick.x + 1}, linha ${pick.y + 1}</h3><p class="form-help">${esc(HELP.light)}</p><div class="field"><label for="se-radius">Raio (casas)</label><input id="se-radius" name="radius" type="number" min="1" max="30" required value="${light?.radius ?? 4}"></div><div class="form-actions">${light ? button("Apagar foco", "se-light-remove", "", "text-button") : ""}<button type="submit" class="primary">${light ? "Atualizar" : "Adicionar"}</button></div></form>`;
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
    const parts = [live.textPending && ["text", "Nome e texto para os jogadores"], !live.mapPending && ["vision", "Visibilidade da cena"], meta?.pending && !live.mapPending && ["layer", "Paredes, portas, luzes e marcas do mapa"]].filter(Boolean);
    const tokens = mapKind() && !live.mapPending;
    return `<form class="se-panel" data-apply-form><h3>Aplicar à cena atual${helpButton("campanhas.cenas.aplicar", "Aplicar à cena atual")}</h3><p>Escolha o que da preparação salva passa a valer na mesa agora. Os jogadores veem o resultado.</p><fieldset><legend>Aplicar</legend>${parts.map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${k !== "vision" ? "checked" : ""}> ${esc(l)}</label>`).join("")}${tokens ? `<label class="check"><input type="checkbox" name="tokens"> ${esc(APPLY_TOKENS.label)}</label><p class="form-help">${esc(APPLY_TOKENS.help)}</p>` : ""}</fieldset><p class="form-help">${esc(APPLY_PRESERVES)}</p>${live.mapPending ? `<div class="notice-box"><p>O cenário mudou na preparação. Trocar de cenário recomeça a exploração, então usa “Reiniciar cena”.</p>${button("Reiniciar cena com o novo cenário…", "se-restart-ask", "", "subtle")}</div>` : ""}<div class="form-actions">${button("Cancelar", "se-dismiss", "", "subtle")}<button type="submit" class="primary" ${parts.length || tokens ? "" : "disabled"}>Aplicar à mesa</button></div></form>`;
  }

  function renderSide() {
    disposePicker(); disposePicker = () => {};
    disposeGrid?.dispose(); disposeGrid = null;
    const hidden = mode === "basic" ? hiddenCustomizations({ layer: meta ? layer : null, scene: { layerMode: draft.layerMode, description: draft.description }, tokens: draft.prepared }) : [];
    const chip = hidden.length && panel !== "hidden" ? `<button type="button" class="se-hidden-chip" data-action="se-panel" data-id="hidden">Ajustes avançados ativos (${hidden.length}) · ver detalhes</button>` : "";
    shell.panel("props").innerHTML = chip + sidePanel();
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
    if (layerDirty && !confirm("As mudanças de paredes, luzes e névoa ainda não salvas deste mapa serão descartadas. Continuar?")) return renderSide();
    commitTyping();
    draft.mapKey = m.key; draft.prepared = []; selection = [];
    try { await loadLayer(); } catch (e) { say(e.message); }
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
    simulate = on; selection = [];
    if (simulate && !viewer) viewer = draft.prepared.find((t) => t.characterId)?.characterId || "";
    renderAll();
  }
  function onEscape(e) {
    if (dismissHelp()) return;
    if (isTypingTarget(e.target)) { commitTyping(); e.target.blur(); return; }
    if (simulate) return toggleSimulate(false);
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
    prepared: mapKind() ? draft.prepared.map((t) => ({ characterId: t.characterId || null, masterCharacterId: t.masterCharacterId || null, label: t.label, side: t.side, x: t.x, y: t.y, fx: freeOn() ? t.fx ?? null : null, fy: freeOn() ? t.fy ?? null : null, hidden: !!t.hidden, light: t.light ?? null, appearance: t.appearance ?? null, size: t.size ?? null, imageUrl: t.imageUrl ?? null, layer: tokenLayerOf(t.layer, draft.layers) })) : [],
  });
  async function saveLayer() {
    const sent = clone(layer);
    const result = await api(`${base}/assets/layers?key=${encodeURIComponent(draft.mapKey)}${saved.id ? `&scene=${encodeURIComponent(saved.id)}` : ""}`, "PUT", {
      fog: sent.fog, cells: sent.cells, revealed: sent.revealed,
      lights: sent.lights.map((l) => ({ x: l.x, y: l.y, radius: l.radius })),
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
        saved = { id: created.id, revision: created.revision }; savedScene = sent;
        if (layerDirty) await saveLayer();
      } else {
        if (layerDirty) await saveLayer();
        if (sceneDirty) { const sent = clone(draft); const r = await api(`${base}/scenes/${saved.id}`, "PUT", sceneBody(), { background: true }); saved.revision = r.revision; savedScene = sent; }
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
  async function apply(form) {
    const data = Object.fromEntries(new FormData(form));
    if (!data.text && !data.vision && !data.layer && !data.tokens) return say("Escolha o que aplicar.");
    try {
      const result = await api(`/sessions/${live.sessionId}/scene/apply`, "POST", { sceneId: saved.id, text: !!data.text, vision: !!data.vision, layer: !!data.layer, tokens: !!data.tokens, sceneRevision: saved.revision, prepVersion: meta?.prepVersion || null });
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
      case "se-save": return save();
      case "se-apply": applying = true; renderSide(); return showProps();
      case "se-restart-ask": applying = "restart"; return renderSide();
      case "se-restart": return restart();
      case "se-dismiss": conflict = null; error = ""; applying = false; return renderSide();
      case "se-reload": if (confirm("Recarregar descarta as alterações desta tela que ainda não foram salvas. Continuar?")) await reload().catch((x) => say(x.message)); return;
      case "se-go-complete": setInterfaceMode("complete"); return;
      case "se-token-remove": return removeSelection();
      case "se-token-props": return selection.length === 1 && openTokenProperties(selection[0]);
      case "se-sel-hide": return toggleHidden();
      case "se-sel-dup": return duplicate();
      case "se-place-cursor": return placeAtCursor(id);
      case "se-add-character": return pick && placeRef(`pc:${id}`, pick);
      case "se-add-npc": return pick && placeRef(`npc:${id}`, pick);
      case "se-light-remove": change("Apagar foco de luz", () => { layer = { ...layer, lights: layer.lights.filter((l) => l.x !== pick.x || l.y !== pick.y) }; }); pick = null; panel = "overview"; return refresh();
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
    if (t.name === "se-kind") {
      if (draft.prepared.length && t.value !== "map" && !confirm("Sem grade, os marcadores preparados saem da cena. Continuar?")) { t.checked = false; return renderSide(); }
      commitTyping();
      draft.kind = t.value; if (t.value !== "map") { draft.prepared = []; selection = []; }
      const m = mapOf(draft.mapKey);
      if (draft.kind === "text" || (m && !acceptsMap(draft.kind, m))) { draft.mapKey = ""; layer = null; meta = null; savedLayer = null; }
      else await loadLayer().catch((x) => say(x.message));
      if (simulate && !mapKind()) simulate = false;
      resetHistory("Tipo de cena trocado. O histórico de desfazer recomeça a partir daqui.");
      recomputeDirty(); return renderAll();
    }
    if (t.name === "se-viewer") { viewer = t.value; return redraw(); }
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
      lights.push({ ...(old || {}), x: pick.x, y: pick.y, radius });
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
  const accepts = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(DND) && !!meta && mapKind() && !simulate;
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

  function cleanup() {
    closed = true;
    root.removeEventListener("click", onClick); root.removeEventListener("input", onInput); root.removeEventListener("change", onChange);
    root.removeEventListener("submit", onSubmit); root.removeEventListener("focusout", onFocusOut); root.removeEventListener("dragstart", onDragStart);
    shell.stage.removeEventListener("pointerdown", onStagePointer, true); shell.stage.removeEventListener("click", onStageClick, true);
    shell.stage.removeEventListener("keydown", onStageKey, true); shell.stage.removeEventListener("dragover", onDragOver);
    shell.stage.removeEventListener("dragleave", onDragLeave); shell.stage.removeEventListener("drop", onDrop2);
    boardHost.removeEventListener("dblclick", onDoubleClick);
    disposePicker(); disposeGrid?.dispose();
    board.destroy();
    onClose?.({ id: saved.id });
  }

  (async () => {
    try { await loadLayer(); } catch (e) { error = e.message; }
    if (closed) return;
    if (!saved.id && !mapOnly && !draft.mapKey && draft.kind !== "text") panel = "scenery";
    recomputeDirty();
    renderAll();
    if (panel === "scenery") showProps();
    if (!mapOnly) loadNpcs();
    if (!mapOnly && !saved.id) nameInput?.focus(); else board.focus();
  })();
  return shell.whenClosed.then(() => ({ id: saved.id }));
}
