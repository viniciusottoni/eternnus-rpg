import { helpButton } from "./help.js";
// Editor único de cenas (preparação privada): prévia central, lateral contextual e ferramentas Básica/Completa.
// Usado na página da campanha, em "Mapas e cenários" (só a preparação do mapa) e sobre a mesa ao vivo, sem substituí-la.
// Escritas por api.js; o servidor valida grade, permissões e conflitos de revisão. Nada aqui apresenta a cena aos jogadores.
import { api } from "./api.js";
import { $, esc, button, modal, toast } from "./ui.js";
import { createBoard } from "./table-map.js";
import { FOG_TOOLS, MARK_KINDS, paintLocal, toggleDoorLocal, sharedPreview } from "./fog-policy.js";
import { interfaceToggle, interfaceMode, mountInterfaceToggle, onInterfaceChange } from "./interface-mode.js";
import {
  HELP, SCENE_KINDS, VISIBILITY_OPTIONS, APPLY_PRESERVES, APPLY_TOKENS, TOOL_GROUPS, toolLabel, acceptsMap, hiddenCustomizations,
  placementProblem, simulateView, recentMapKeys, mapTypeLabel, sceneKindLabel,
} from "./scene-policy.js";

const SIDES = [["enemy", "Inimigo"], ["neutral", "Neutro"], ["ally", "Aliado"]];
const opt = (list, current) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`).join("");
const PAINT = new Set(FOG_TOOLS.map((t) => t.id));
/** Ferramentas da Básica, sempre na mesma posição (a Completa acrescenta grupos depois delas). */
const BASIC = ["select", "add", "scenery", "visibility", "reveal", "conceal", "text", "notes"];
const COMPLETE_GROUPS = {
  elements: ["npc"],
  walls: ["wall", "blockMove", "blockLight", "door", "toggleDoor", "erase"],
  light: ["light", "fogState"],
  explore: ["reveal", "conceal", "mark", "resetExploration"],
  grid: ["gridToggle", "gridAdjust"],
  scene: ["sceneSettings"],
};

/**
 * Abre o editor. `sceneId` nulo cria uma cena; `mapKey` sem cena edita só a preparação compartilhada do mapa.
 * `live` (opcional, vindo da mesa) recebe `onApplied`. Devolve quando o editor fecha.
 */
export async function openSceneEditor({ campaign, sceneId = null, mapKey = null, kind = "map", onClose } = {}) {
  const mapOnly = !sceneId && !!mapKey && kind === "layer";
  const base = `/campaigns/${campaign.id}`;
  const [maps, scene, sceneList] = await Promise.all([
    api(`${base}/maps`),
    sceneId ? api(`${base}/scenes/${sceneId}`) : null,
    mapOnly ? null : api(`${base}/scenes`).catch(() => ({ items: [] })),
  ]);
  let draft = scene
    ? { name: scene.name, kind: scene.kind, mapKey: scene.mapKey, sharedText: scene.sharedText, privateNotes: scene.privateNotes, visionMode: scene.visionMode || "", layerMode: scene.layerMode || "map", description: scene.description || "", order: scene.order || 0, prepared: (scene.prepared || []).map((t) => ({ ...t })) }
    : { name: "", kind: kind === "layer" ? "map" : kind, mapKey: mapKey || "", sharedText: "", privateNotes: "", visionMode: "", layerMode: "map", description: "", order: (sceneList?.items?.length || 0), prepared: [] };
  let saved = { id: scene?.id || null, revision: scene?.revision || 0 };
  let live = scene?.live || null;
  const characters = scene?.characters || sceneList?.characters || [];
  let savedLayerMode = draft.layerMode;
  /** Trocar o alcance só passa a valer depois de salvar: até lá, a camada do mapa não é editada. */
  const layerLocked = () => draft.layerMode !== savedLayerMode;
  let npcs = null;
  let layer = null, meta = null;
  let sceneDirty = false, layerDirty = false, resetExploration = false;
  let tool = "select", selected = null, pick = null, panel = "overview", simulate = false, viewer = "", grid = true, conflict = null, applying = false, busy = false;
  let error = "";
  let mode = interfaceMode();
  let disposeToggle = () => {}, disposePicker = () => {}, disposeGrid = null;
  const recents = recentMapKeys(sceneList?.items || [], "");
  const mapOf = (key) => maps.items.find((m) => m.key === key);

  modal(mapOnly ? "Preparação do mapa" : saved.id ? "Editar preparação da cena" : "Nova cena", `<div class="scene-editor" data-interface="${mode}">
    <header class="se-top">
      <div class="field se-name">${mapOnly ? `<p class="se-map-title"><strong id="se-map-name"></strong><small>Preparação compartilhada do mapa</small></p>` : `<div class="field-label"><label for="se-name">Nome da cena</label>${helpButton("campanhas.cenas.preparacao", "Preparar e apresentar")}</div><input id="se-name" maxlength="80" required autocomplete="off" placeholder="Ex.: Ponte da travessia">`}</div>
      <div class="se-status" id="se-status" role="status" aria-live="polite"></div>
      <div class="se-controls"><button type="button" class="subtle se-properties-toggle" data-action="se-properties" aria-expanded="false">Propriedades</button>${interfaceToggle("se-interface")}
        <div class="se-actions">${button("👁 Ver como jogador", "se-preview", "", "subtle", 'aria-pressed="false"')}${button("Salvar preparação", "se-save", "", "primary")}<span id="se-apply-slot"></span></div></div>
    </header>
    <div class="se-body">
      <nav class="se-tools" id="se-tools" aria-label="Ferramentas da preparação"></nav>
      <section class="se-stage" aria-label="Prévia da cena"><div class="se-sim-banner" id="se-sim" role="note" hidden></div><div class="board se-board" id="se-board"></div><div class="se-text-preview" id="se-text" hidden></div><p class="stage-hint" id="se-hint" role="status"></p></section>
      <aside class="se-side" id="se-side" aria-label="Propriedades"></aside>
    </div>
  </div>`);
  const dialog = $("#modal");
  dialog.classList.add("wide", "scene-editor-modal");
  const root = dialog.querySelector(".scene-editor");
  root.dataset.side = "closed";
  if (!mapOnly) $("#se-name").value = draft.name;
  const board = createBoard($("#se-board"), {
    camera: $(".se-controls"),
    onToken: (t) => onToken(t),
    onCell: (c) => onCell(c),
    onPaint: (cells) => onPaint(cells),
    onDrop: (t, c) => moveToken(Number(t.id.slice(1)), c),
    onCancel: () => { selected = null; pick = null; renderAll(); },
  });

  // ---------- Dados do mapa ----------
  async function loadLayer() {
    layer = null; meta = null;
    const m = mapOf(draft.mapKey);
    if (draft.kind !== "map" || !m || m.kind !== "tileset") return;
    const data = await api(`${base}/assets/layers?key=${encodeURIComponent(draft.mapKey)}${saved.id ? `&scene=${encodeURIComponent(saved.id)}` : ""}`);
    meta = data;
    layer = { fog: data.fog, manual: data.manual, cells: data.cells, lights: data.lights.map((l) => ({ ...l })), revealed: data.revealed, marks: data.marks.map((x) => ({ ...x })) };
  }
  const width = () => meta?.width || 0, height = () => meta?.height || 0;
  const fogOn = () => draft.visionMode === "all" ? false : draft.visionMode ? true : (layer?.fog ?? meta?.settings?.fogEnabled ?? true);
  const shared = () => (draft.visionMode === "manual" || (!draft.visionMode && layer?.manual) ? layer?.revealed || "" : sharedPreview(layer, width(), height()));

  function boardState() {
    const m = mapOf(draft.mapKey);
    if (draft.kind === "image" && m) return { map: { kind: "cartographic", key: m.key, name: m.name, imageUrl: m.imageUrl || "/assets/valley.webp", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    if (!meta) return { map: { kind: "cartographic", key: "none", name: "", imageUrl: "", rows: [] }, tokens: [], participants: [], session: {}, me: { isMaster: true } };
    let tokens = draft.prepared.map((t, i) => ({ id: "p" + i, characterId: t.characterId || null, label: t.label, side: t.side || "ally", x: t.x, y: t.y, hidden: !!t.hidden, light: t.light ?? null }));
    let fog;
    if (simulate) {
      const sim = simulateView({ visionMode: draft.visionMode, layer, width: width(), height: height(), tokens, characters, settings: meta.settings || {}, scale: meta.scaleMeters || 1.5, viewer: viewer || null });
      fog = sim.fog.active ? sim.fog : { active: false };
      tokens = sim.tokens;
    } else fog = { active: fogOn(), cells: layer.cells, lights: layer.lights, marks: layer.marks, shared: shared() };
    return {
      map: { kind: "tileset", key: meta.layerKey, name: meta.name, rows: meta.rows, imageUrl: meta.imageUrl, gridPixels: meta.gridPixels, gridOffsetX: meta.gridOffsetX, gridOffsetY: meta.gridOffsetY, scaleMeters: meta.scaleMeters },
      tokens, participants: tokens.filter((t) => t.characterId).map((t) => ({ characterId: t.characterId, online: true })), session: {}, me: { isMaster: !simulate, characterId: null }, fog,
    };
  }
  function boardView() {
    const paint = !simulate && PAINT.has(tool) && !!meta;
    return { mode: paint ? "paint" : "none", fogTools: !simulate && (mode === "complete" || paint), grid, reach: [], attack: [], selected: selected != null ? "p" + selected : null, draggable: !simulate && tool === "select" ? "*" : null, viewAs: simulate };
  }
  const redraw = () => board.update(boardState(), boardView());

  // ---------- Edição ----------
  const markScene = () => { sceneDirty = true; renderStatus(); };
  const markLayer = () => { layerDirty = true; renderStatus(); };
  function moveToken(i, cell) {
    if (simulate || i == null || !draft.prepared[i]) return;
    const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, cell.x, cell.y, i);
    if (problem) return toast(problem);
    draft.prepared[i] = { ...draft.prepared[i], x: cell.x, y: cell.y };
    markScene(); redraw(); renderSide();
  }
  function onToken(t) {
    if (simulate) return;
    if (tool === "light" || tool === "mark" || tool === "toggleDoor") return onCell({ x: t.x, y: t.y });
    selected = Number(t.id.slice(1)); pick = null; panel = "token";
    renderSide(); board.setView(boardView());
  }
  function onCell(c) {
    if (simulate || !meta) return;
    if (tool === "select") {
      if (selected != null) return moveToken(selected, c);
      return;
    }
    if (tool === "add" || tool === "npc") { pick = c; selected = null; panel = "add"; return renderSide(); }
    if (tool === "toggleDoor") { const next = toggleDoorLocal(layer, c.x, c.y); if (!next) return toast("Não há porta nessa casa."); layer = next; markLayer(); return redraw(); }
    if (tool === "light" || tool === "mark") { pick = c; panel = tool; return renderSide(); }
  }
  function onPaint(cells) {
    if (simulate || !PAINT.has(tool) || !layer) return;
    if (tool === "conceal" && meta?.explored) toast("Cobrir área retira só a revelação manual. Casas iluminadas ou vistas por personagens continuam visíveis na mesa.");
    layer = paintLocal(layer, width(), tool, cells);
    markLayer(); redraw();
  }

  // ---------- Renderização ----------
  function toolButton(id) {
    const layerTool = ["reveal", "conceal", ...COMPLETE_GROUPS.walls, "light", "mark", "fogState", "resetExploration"].includes(id);
    const disabled = (["add", "npc"].includes(id) && !meta) || (layerTool && (!meta || layerLocked())) || (id === "gridAdjust" && !draft.mapKey?.startsWith("asset:"));
    const pressed = tool === id || panel === id || (id === "gridToggle" && grid);
    return `<button type="button" class="se-tool ${pressed ? "active" : ""}" data-action="se-tool" data-id="${id}" aria-pressed="${pressed}" ${disabled ? `aria-disabled="true" data-tip="${layerLocked() ? "Salve o alcance da preparação antes de editar o mapa." : id === "gridAdjust" ? "A grade de cenários prontos já está definida." : "Escolha um mapa com grade para usar esta ferramenta."}"` : ""}>${esc(toolLabel(id))}</button>`;
  }
  function renderTools() {
    const manual = draft.visionMode === "manual" || (!draft.visionMode && layer?.manual);
    const basic = BASIC.filter((id) => !(mapOnly && ["scenery", "text", "notes", "add", "visibility"].includes(id))).filter((id) => (id === "reveal" || id === "conceal") ? manual && draft.kind === "map" : true)
      .filter((id) => draft.kind === "map" || !["add", "reveal", "conceal", "visibility"].includes(id));
    const groups = mode === "complete" && draft.kind === "map"
      ? TOOL_GROUPS.map(([key, label]) => [key, label, (COMPLETE_GROUPS[key] || []).filter((id) => !(mapOnly && ["npc", "sceneSettings"].includes(id)))]).filter(([, , ids]) => ids.length)
      : mode === "complete" && !mapOnly ? [["scene", "Configuração da cena", ["sceneSettings"]]] : [];
    const hidden = mode === "basic" ? hiddenCustomizations({ layer: meta ? layer : null, scene: { layerMode: draft.layerMode, description: draft.description }, tokens: draft.prepared }) : [];
    $("#se-tools").innerHTML = `<div class="se-tool-group se-basic" role="group" aria-label="Ferramentas principais">${basic.map(toolButton).join("")}</div>${groups.length ? `<div class="se-more"><label class="se-category"><span>Categoria</span><select data-se-category>${groups.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>${groups.map(([key, label, ids]) => `<div class="se-tool-group" role="group" aria-label="${esc(label)}" data-group="${key}"><h3>${esc(label)}</h3>${ids.map(toolButton).join("")}</div>`).join("")}</div>` : ""}${hidden.length ? `<button type="button" class="se-hidden-chip" data-action="se-panel" data-id="hidden">Ajustes avançados ativos (${hidden.length}) · ver detalhes</button>` : ""}`;
    const category = $("#se-tools").querySelector("[data-se-category]");
    if (category) {
      const groupOf = Object.entries(COMPLETE_GROUPS).find(([, ids]) => ids.includes(tool) || ids.includes(panel))?.[0];
      if (groupOf && category.querySelector(`option[value="${groupOf}"]`)) category.value = groupOf;
      const show = () => $("#se-tools").querySelectorAll("[data-group]").forEach((g) => g.classList.toggle("current", g.dataset.group === category.value));
      category.onchange = show; show();
    }
  }
  function renderStatus() {
    const presenting = live?.current;
    const pendingLive = presenting && (live.textPending || live.mapPending || meta?.pending);
    const dirty = sceneDirty || layerDirty;
    $("#se-status").innerHTML = [
      presenting ? '<span class="se-chip live">● Em apresentação — os jogadores estão vendo esta cena.</span>' : '<span class="se-chip private">Prévia privada — somente você vê.</span>',
      dirty ? '<span class="se-chip dirty">Alterações não salvas</span>' : saved.id || mapOnly ? '<span class="se-chip ok">Preparação salva</span>' : "",
      pendingLive && !dirty ? '<span class="se-chip pending">Alterações não aplicadas à mesa.</span>' : "",
      !presenting && meta?.inUse ? '<span class="se-chip pending">Este mapa está na mesa: salvar guarda a preparação sem mudar a partida.</span>' : "",
    ].join("");
    $("#se-apply-slot").innerHTML = presenting && (pendingLive || draft.kind === "map") ? button(pendingLive ? "Aplicar à cena atual…" : "Aplicar preparação à cena atual…", "se-apply", "", "subtle", dirty ? 'aria-disabled="true" data-tip="Salve a preparação antes de aplicar."' : "") : "";
    const previewBtn = root.querySelector("[data-action=se-preview]");
    previewBtn.setAttribute("aria-pressed", String(simulate));
    previewBtn.textContent = simulate ? "← Voltar à edição" : "👁 Ver como jogador";
    previewBtn.disabled = draft.kind !== "map" || !meta;
    root.querySelector("[data-action=se-save]").disabled = busy || (!dirty && !!(saved.id || mapOnly));
  }
  function renderStage() {
    const text = $("#se-text");
    const showText = draft.kind === "text" || (draft.kind !== "text" && !draft.mapKey);
    text.hidden = !showText;
    $("#se-board").hidden = showText;
    if (showText) text.innerHTML = draft.kind === "text" ? `<article class="se-text-card"><span class="eyebrow">Apresentação textual</span><h3>${esc(draft.name || "Cena sem nome")}</h3><p>${esc(draft.sharedText || "Escreva o texto compartilhável na lateral.")}</p></article>` : `<div class="empty"><h3>Escolha um cenário</h3><p>Use “Escolher cenário” para ver miniaturas de mapas prontos e imagens da campanha.</p>${button("Escolher cenário", "se-tool", "scenery", "primary")}</div>`;
    renderSimBanner();
    const hint = simulate ? "" : PAINT.has(tool) ? (HELP[tool] || toolLabel(tool)) + " Teclado: setas e Enter." : HELP[tool] || "";
    $("#se-hint").textContent = hint; $("#se-hint").hidden = !hint;
    redraw();
  }

  /** Simulação: escolher de quem é a visão (personagens posicionados). Sem personagem, só luz comum e revelações. */
  function renderSimBanner() {
    const banner = $("#se-sim");
    banner.hidden = !simulate;
    if (!simulate) { banner.innerHTML = ""; return; }
    const placed = draft.prepared.filter((t) => t.characterId);
    if (viewer && !placed.some((t) => t.characterId === viewer)) viewer = "";
    const options = [`<option value="">Grupo — só luz comum e áreas reveladas</option>`, ...placed.map((t) => `<option value="${esc(t.characterId)}"${t.characterId === viewer ? " selected" : ""}>${esc(t.label || "Personagem")}</option>`)].join("");
    banner.innerHTML = `<p>${esc(HELP.preview)}</p>${placed.length && draft.kind === "map" ? `<label class="se-sim-viewer"><span>Visão de</span><select id="se-viewer" name="se-viewer">${options}</select></label>` : ""}`;
  }

  function sidePanel() {
    if (error) return `<div class="se-panel"><p class="form-error" role="alert">${esc(error)}</p>${button("Entendi", "se-dismiss", "", "subtle")}</div>`;
    if (conflict) return `<div class="se-panel se-conflict" role="alert"><h3>Outra tela salvou antes</h3><p>${esc(conflict)}</p><p class="form-help">Suas alterações continuam aqui. Você pode copiar o que precisar antes de recarregar.</p><div class="form-actions">${button("Continuar editando", "se-dismiss", "", "subtle")}${button("Recarregar a versão salva", "se-reload", "", "danger")}</div></div>`;
    if (applying) return applyPanel();
    if (panel === "token" && selected != null && draft.prepared[selected]) return tokenPanel(draft.prepared[selected]);
    if (panel === "add" && pick) return addPanel();
    if (panel === "light" && pick) return lightPanel();
    if (panel === "mark" && pick) return markPanel();
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
    return `<div class="se-panel"><h3>${esc(toolLabel(tool))}${helpButton("mesa.nevoa.ferramentas", "Ferramentas de névoa")}</h3><p class="form-help">${esc(HELP[tool] || "Escolha uma ferramenta à esquerda.")}</p><dl class="se-summary"><div><dt>Tipo</dt><dd>${esc(sceneKindLabel(draft.kind))}</dd></div>${draft.kind !== "text" ? `<div><dt>Cenário</dt><dd>${m ? `${esc(m.name)} <small>${esc(mapTypeLabel(m))}</small>` : "Nenhum escolhido"}</dd></div>` : ""}${draft.kind === "map" ? `<div><dt>Marcadores preparados</dt><dd>${draft.prepared.length}</dd></div><div><dt>Visibilidade</dt><dd>${esc((VISIBILITY_OPTIONS.find((v) => v[0] === (draft.visionMode || "")) || VISIBILITY_OPTIONS[0])[1])}</dd></div>` : ""}${meta && meta.mode === "map" && meta.sharedWith?.length ? `<div><dt>Preparação do mapa</dt><dd>Compartilhada com: ${meta.sharedWith.map((s) => esc(s.name)).join(", ")}</dd></div>` : meta?.mode === "scene" ? `<div><dt>Preparação do mapa</dt><dd>Própria desta cena</dd></div>` : ""}</dl></div>`;
  }
  function tokenPanel(t) {
    const isCharacter = !!t.characterId;
    return `<form class="se-panel" data-token-form><h3>${esc(t.label || "Marcador")}</h3><p class="form-help">Coluna ${t.x + 1}, linha ${t.y + 1}. Para mover, clique numa casa livre ou arraste.</p>${isCharacter ? '<p class="small">Personagem dos jogadores: entra nesta casa quando a cena for apresentada, se a pessoa estiver na mesa.</p>' : `<div class="field"><label for="se-t-label">Nome</label><input id="se-t-label" data-token="label" maxlength="40" required value="${esc(t.label)}"></div><div class="field"><label for="se-t-side">Lado</label><select id="se-t-side" data-token="side">${opt(SIDES, t.side || "enemy")}</select></div><label class="check"><input type="checkbox" data-token="hidden" ${t.hidden ? "checked" : ""}> Oculto: só você vê até revelar</label>${mode === "complete" ? `<div class="field"><label for="se-t-light">Luz que carrega (casas)</label><input id="se-t-light" data-token="light" type="number" min="0" max="30" value="${t.light ?? ""}" placeholder="Padrão da mesa"></div>` : ""}`}<div class="form-actions se-danger-zone">${button("Remover da cena", "se-token-remove", "", "text-button")}</div></form>`;
  }
  function addPanel() {
    const placed = new Set(draft.prepared.map((t) => t.characterId).filter(Boolean));
    const free = characters.filter((c) => !placed.has(c.id));
    const npcList = (npcs || []).filter((n) => !n.copy);
    return `<div class="se-panel"><h3>Adicionar na casa ${pick.x + 1}, ${pick.y + 1}</h3><form data-add-marker class="se-subform"><h4>Marcador</h4><div class="field"><label for="se-a-label">Nome</label><input id="se-a-label" name="label" maxlength="40" required placeholder="Guarda da ponte"></div><div class="field"><label for="se-a-side">Lado</label><select id="se-a-side" name="side">${opt(SIDES, "enemy")}</select></div><label class="check"><input type="checkbox" name="hidden"> Oculto: só você vê até revelar</label><button type="submit" class="primary">Adicionar marcador</button></form>
      <section class="se-subform"><h4>Personagem dos jogadores</h4>${free.length ? `<ul class="se-pick-list">${free.map((c) => `<li><span>${esc(c.name)}</span>${button("Colocar aqui", "se-add-character", c.id, "subtle small")}</li>`).join("")}</ul>` : `<p class="muted small">${characters.length ? "Todos os personagens da campanha já estão na cena." : "Nenhum personagem vinculado à campanha ainda."}</p>`}</section>
      <section class="se-subform"><h4>Personagem do mestre</h4>${npcs == null ? '<p class="loading-line" role="status">Carregando…</p>' : npcList.length ? `<ul class="se-pick-list">${npcList.map((n) => `<li><span>${esc(n.name)}<small>${esc(n.summary || "")}</small></span>${button("Colocar aqui", "se-add-npc", n.id, "subtle small")}</li>`).join("")}</ul><p class="form-help">Na mesa, “Cópia para o encontro” ajusta recursos sem alterar o original.</p>` : '<p class="muted small">Crie personagens do mestre na aba Cenas da campanha.</p>'}</section></div>`;
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
    return `<div class="se-panel"><h3>Configuração da cena${helpButton("campanhas.cenas.alcance", "Alcance da preparação")}</h3>${mapOnly ? "" : `<div class="field"><label for="se-desc">Descrição de preparo (só você)</label><textarea id="se-desc" data-draft="description" maxlength="1000" rows="3">${esc(draft.description)}</textarea></div><div class="field"><label for="se-order">Ordem na lista</label><input id="se-order" data-draft="order" type="number" min="0" max="10000" value="${Number(draft.order) || 0}"></div>`}${draft.kind === "map" && !mapOnly ? `<fieldset><legend>Preparação do mapa (paredes, luzes, marcas e exploração)</legend><label class="check se-option"><input type="radio" name="se-layer" value="map" ${draft.layerMode === "map" ? "checked" : ""} ${live?.current ? "disabled" : ""}><span><strong>Compartilhada com o mapa</strong><small>Vale para todas as cenas com este mapa no modo compartilhado e para a aba Mapas e cenários. A exploração também é compartilhada.</small></span></label><label class="check se-option"><input type="radio" name="se-layer" value="scene" ${draft.layerMode === "scene" ? "checked" : ""} ${live?.current ? "disabled" : ""}><span><strong>Própria desta cena</strong><small>Começa como a do mapa e depois segue separada. A imagem não é duplicada.</small></span></label>${live?.current ? '<p class="form-help">Com a cena em apresentação, o alcance não muda.</p>' : '<p class="form-help">Trocar o alcance carrega a preparação correspondente. Salve antes as mudanças do mapa.</p>'}</fieldset>` : ""}</div>`;
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
    const tokens = draft.kind === "map" && !live.mapPending;
    return `<form class="se-panel" data-apply-form><h3>Aplicar à cena atual${helpButton("campanhas.cenas.aplicar", "Aplicar à cena atual")}</h3><p>Escolha o que da preparação salva passa a valer na mesa agora. Os jogadores veem o resultado.</p><fieldset><legend>Aplicar</legend>${parts.map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${k !== "vision" ? "checked" : ""}> ${esc(l)}</label>`).join("")}${tokens ? `<label class="check"><input type="checkbox" name="tokens"> ${esc(APPLY_TOKENS.label)}</label><p class="form-help">${esc(APPLY_TOKENS.help)}</p>` : ""}</fieldset><p class="form-help">${esc(APPLY_PRESERVES)}</p>${live.mapPending ? `<div class="notice-box"><p>O cenário mudou na preparação. Trocar de cenário recomeça a exploração, então usa “Reiniciar cena”.</p>${button("Reiniciar cena com o novo cenário…", "se-restart-ask", "", "subtle")}</div>` : ""}<div class="form-actions">${button("Cancelar", "se-dismiss", "", "subtle")}<button type="submit" class="primary" ${parts.length || tokens ? "" : "disabled"}>Aplicar à mesa</button></div></form>`;
  }

  function setSide(open) {
    root.dataset.side = open ? "open" : "closed";
    root.querySelector('[data-action="se-properties"]').setAttribute("aria-expanded", String(open));
  }
  function renderSide() {
    if (panel !== "overview" || applying || conflict || error || tool === "add" || tool === "npc") setSide(true);
    disposePicker(); disposePicker = () => {};
    disposeGrid?.dispose(); disposeGrid = null;
    const side = $("#se-side");
    side.innerHTML = sidePanel();
    if (panel === "scenery" && $("#se-picker")) mountPicker();
    if (panel === "gridAdjust" && $("#se-grid")) mountGrid();
  }
  async function mountPicker() {
    const { mapChoices, mountMapChoices } = await import("./map-picker.js");
    const host = $("#se-picker");
    if (!host) return;
    let folders = [];
    if (mode === "complete") folders = (await api(`${base}/assets/maps`).catch(() => ({ folders: [] }))).folders || [];
    host.innerHTML = mapChoices(maps.items, draft.mapKey, draft.kind === "map" ? "Mapas com grade" : "Imagens", { sceneKind: draft.kind, recentKeys: recents, complete: mode === "complete", folders, name: "se-map" });
    disposePicker = mountMapChoices(host, maps.items, { name: "se-map", onChange: (m) => chooseMap(m) });
  }
  async function mountGrid() {
    const m = mapOf(draft.mapKey);
    const { gridAdjustHtml, mountGridAdjust } = await import("./grid-adjust.js");
    const host = $("#se-grid");
    if (!host) return;
    host.innerHTML = gridAdjustHtml("se-g", m, { complete: mode === "complete" });
    disposeGrid = mountGridAdjust(host, m.imageUrl);
  }
  async function chooseMap(m) {
    if (!m || m.key === draft.mapKey) return;
    if (draft.prepared.length && !confirm("Trocar o cenário remove os marcadores preparados, porque as posições pertencem à grade anterior. Continuar?")) return renderSide();
    if (layerDirty && !confirm("As mudanças de paredes, luzes e névoa ainda não salvas deste mapa serão descartadas. Continuar?")) return renderSide();
    draft.mapKey = m.key; draft.prepared = []; selected = null; layerDirty = false; markScene();
    try { await loadLayer(); } catch (e) { toast(e.message); }
    renderAll(false);
  }
  function renderAll(side = true) {
    root.dataset.interface = mode;
    renderTools(); renderStatus(); renderStage(); if (side) renderSide();
    if (mapOnly && meta) $("#se-map-name").textContent = meta.name;
  }

  // ---------- Salvar e aplicar ----------
  const sceneBody = () => ({
    name: mapOnly ? "" : $("#se-name").value.trim(), description: draft.description, kind: draft.kind, mapKind: null, mapKey: draft.kind === "text" ? null : draft.mapKey,
    sharedText: draft.sharedText, privateNotes: draft.privateNotes, visionMode: draft.kind === "map" ? draft.visionMode || null : null, order: Number(draft.order) || 0,
    revision: saved.revision, layerMode: draft.layerMode,
    prepared: draft.kind === "map" ? draft.prepared.map((t) => ({ characterId: t.characterId || null, masterCharacterId: t.masterCharacterId || null, label: t.label, side: t.side, x: t.x, y: t.y, hidden: !!t.hidden, light: t.light ?? null })) : [],
  });
  async function saveLayer() {
    const result = await api(`${base}/assets/layers?key=${encodeURIComponent(draft.mapKey)}${saved.id ? `&scene=${encodeURIComponent(saved.id)}` : ""}`, "PUT", {
      fog: layer.fog, cells: layer.cells, revealed: layer.revealed,
      lights: layer.lights.map((l) => ({ x: l.x, y: l.y, radius: l.radius })),
      marks: layer.marks.map((m) => ({ id: m.id || null, x: m.x, y: m.y, kind: m.kind, label: m.label, dc: m.dc ?? null, sense: m.sense || null, maxDistance: m.maxDistance ?? null })),
      revision: meta.revision, resetExploration, prepVersion: meta.prepVersion,
    }, { background: true });
    meta.revision = result.revision; meta.prepVersion = result.prepVersion; meta.pending = result.pendingLive; meta.inUse = result.inUse;
    layerDirty = false; resetExploration = false;
  }
  async function save() {
    if (busy) return;
    if (!mapOnly && !$("#se-name").value.trim()) { $("#se-name").focus(); return toast("Dê um nome à cena antes de salvar."); }
    if (!mapOnly && draft.kind !== "text" && !draft.mapKey) { panel = "scenery"; renderAll(); return toast("Escolha o cenário da cena."); }
    busy = true; renderStatus();
    $("#se-status").insertAdjacentHTML("beforeend", '<span class="se-chip">Salvando…</span>');
    try {
      if (mapOnly) { if (layerDirty) await saveLayer(); }
      else if (!saved.id) {
        const created = await api(`${base}/scenes`, "POST", sceneBody(), { background: true });
        saved = { id: created.id, revision: created.revision }; sceneDirty = false;
        if (layerDirty) await saveLayer();
      } else {
        if (layerDirty) await saveLayer();
        if (sceneDirty) { const r = await api(`${base}/scenes/${saved.id}`, "PUT", sceneBody(), { background: true }); saved.revision = r.revision; sceneDirty = false; }
      }
      if (layerLocked()) { savedLayerMode = draft.layerMode; await loadLayer(); redraw(); }
      if (saved.id) { const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true }); live = fresh.live; saved.revision = fresh.revision; }
      toast(live?.current ? "Preparação salva. A mesa só muda quando você aplicar." : "Preparação salva.");
      $("#modal-title").textContent = mapOnly ? "Preparação do mapa" : "Editar preparação da cena";
    } catch (e) {
      if (e.status === 409) conflict = e.message; else error = e.message;
      renderSide();
    } finally { busy = false; renderStatus(); renderTools(); }
  }
  async function apply(form) {
    const data = Object.fromEntries(new FormData(form));
    if (!data.text && !data.vision && !data.layer && !data.tokens) return toast("Escolha o que aplicar.");
    try {
      const result = await api(`/sessions/${live.sessionId}/scene/apply`, "POST", { sceneId: saved.id, text: !!data.text, vision: !!data.vision, layer: !!data.layer, tokens: !!data.tokens, sceneRevision: saved.revision, prepVersion: meta?.prepVersion || null });
      applying = false;
      const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true }); live = fresh.live; saved.revision = fresh.revision;
      if (meta) await loadLayer();
      toast(result.applied?.length ? `Aplicado à mesa: ${result.applied.join(", ")}.` : "Nada a aplicar: a mesa já estava assim.");
      renderAll();
    } catch (e) { if (e.status === 409) { applying = false; conflict = e.message; renderSide(); } else toast(e.message); }
  }
  /** Reiniciar a partir do editor: mesmo comando da mesa (apresentar com restart), só depois da confirmação no painel. */
  async function restart() {
    if (busy || sceneDirty || layerDirty) return toast("Salve a preparação antes de reiniciar a cena.");
    busy = true;
    try {
      await api(`/sessions/${live.sessionId}/scene`, "POST", { sceneId: saved.id, restart: true });
      applying = false;
      const fresh = await api(`${base}/scenes/${saved.id}`, "GET", undefined, { background: true }); live = fresh.live; saved.revision = fresh.revision;
      if (meta) await loadLayer();
      toast("Cena reiniciada com o cenário preparado.");
    } catch (e) { toast(e.message); }
    finally { busy = false; renderAll(); }
  }
  async function reload() {
    conflict = null; error = "";
    if (saved.id) {
      const fresh = await api(`${base}/scenes/${saved.id}`);
      draft = { name: fresh.name, kind: fresh.kind, mapKey: fresh.mapKey, sharedText: fresh.sharedText, privateNotes: fresh.privateNotes, visionMode: fresh.visionMode || "", layerMode: fresh.layerMode, description: fresh.description || "", order: fresh.order, prepared: fresh.prepared.map((t) => ({ ...t })) };
      saved.revision = fresh.revision; live = fresh.live;
      if (!mapOnly) $("#se-name").value = draft.name;
    }
    await loadLayer();
    sceneDirty = false; layerDirty = false; selected = null; pick = null;
    renderAll();
  }

  // ---------- Eventos ----------
  async function onClick(e) {
    const b = e.target.closest("[data-action^='se-']");
    if (!b || b.disabled || !root.contains(b)) return;
    const id = b.dataset.id;
    switch (b.dataset.action) {
      case "se-properties": return setSide(root.dataset.side !== "open");
      case "se-tool": {
        board.interact();
        if (id === "gridToggle") { grid = !grid; renderTools(); return redraw(); }
        const panels = ["scenery", "visibility", "text", "notes", "sceneSettings", "fogState", "resetExploration", "gridAdjust"];
        if (panels.includes(id)) { panel = id; pick = null; selected = null; }
        else { tool = id; pick = null; if (id !== "select") selected = null; panel = id === "select" && selected != null ? "token" : "overview"; if ((id === "add" || id === "npc") && npcs == null) loadNpcs(); }
        simulate = false;
        return renderAll();
      }
      case "se-panel": panel = id; return renderSide();
      case "se-preview": simulate = !simulate; selected = null; if (simulate && !viewer) viewer = draft.prepared.find((t) => t.characterId)?.characterId || ""; return renderAll();
      case "se-save": return save();
      case "se-apply": applying = true; return renderSide();
      case "se-restart-ask": applying = "restart"; return renderSide();
      case "se-restart": return restart();
      case "se-dismiss": conflict = null; error = ""; applying = false; return renderSide();
      case "se-reload": if (confirm("Recarregar descarta as alterações desta tela que ainda não foram salvas. Continuar?")) await reload().catch((x) => toast(x.message)); return;
      case "se-close": return close();
      case "se-go-complete": (await import("./interface-mode.js")).setInterfaceMode("complete"); return;
      case "se-token-remove": draft.prepared.splice(selected, 1); selected = null; panel = "overview"; markScene(); redraw(); return renderSide();
      case "se-add-character": {
        const c = characters.find((x) => x.id === id);
        const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, pick.x, pick.y);
        if (problem) return toast(problem);
        draft.prepared.push({ characterId: c.id, label: c.name, side: "ally", x: pick.x, y: pick.y, hidden: false });
        selected = draft.prepared.length - 1; panel = "token"; pick = null; markScene(); redraw(); return renderSide();
      }
      case "se-add-npc": {
        const n = npcs.find((x) => x.id === id);
        const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, pick.x, pick.y);
        if (problem) return toast(problem);
        draft.prepared.push({ masterCharacterId: n.id, label: n.name.slice(0, 40), side: n.side || "enemy", x: pick.x, y: pick.y, hidden: false });
        selected = draft.prepared.length - 1; panel = "token"; pick = null; markScene(); redraw(); return renderSide();
      }
      case "se-light-remove": layer = { ...layer, lights: layer.lights.filter((l) => l.x !== pick.x || l.y !== pick.y) }; pick = null; panel = "overview"; markLayer(); redraw(); return renderSide();
      case "se-mark-remove": layer = { ...layer, marks: layer.marks.filter((m) => m.x !== pick.x || m.y !== pick.y) }; pick = null; panel = "overview"; markLayer(); redraw(); return renderSide();
    }
  }
  async function loadNpcs() {
    try { npcs = (await api(`${base}/npcs`, "GET", undefined, { background: true })).items; } catch { npcs = []; }
    if (panel === "add") renderSide();
  }
  function onInput(e) {
    const t = e.target;
    if (t.id === "se-name") { draft.name = t.value; markScene(); if (draft.kind === "text") renderStage(); return; }
    if (t.dataset.draft) { draft[t.dataset.draft] = t.dataset.draft === "order" ? Number(t.value) : t.value; markScene(); if (t.dataset.draft === "sharedText" && draft.kind === "text") renderStage(); return; }
    if (t.dataset.token && selected != null) {
      const tok = draft.prepared[selected];
      if (t.dataset.token === "hidden") tok.hidden = t.checked;
      else if (t.dataset.token === "light") tok.light = t.value === "" ? null : Math.max(0, Math.min(30, Math.round(Number(t.value))));
      else tok[t.dataset.token] = t.value;
      markScene(); redraw();
    }
  }
  async function onChange(e) {
    const t = e.target;
    if (t.name === "se-kind") {
      if (draft.prepared.length && t.value !== "map" && !confirm("Sem grade, os marcadores preparados saem da cena. Continuar?")) { t.checked = false; return renderSide(); }
      draft.kind = t.value; if (t.value !== "map") draft.prepared = [];
      const m = mapOf(draft.mapKey);
      if (draft.kind === "text" || (m && !acceptsMap(draft.kind, m))) { draft.mapKey = draft.kind === "text" ? "" : ""; layer = null; meta = null; }
      else await loadLayer().catch((x) => toast(x.message));
      markScene(); return renderAll();
    }
    if (t.name === "se-viewer") { viewer = t.value; return redraw(); }
    if (t.name === "se-vision") { draft.visionMode = t.value; markScene(); renderTools(); renderStage(); return renderSide(); }
    if (t.name === "se-layer") {
      if (layerDirty && !confirm("As mudanças do mapa ainda não salvas serão descartadas ao trocar o alcance. Continuar?")) return renderSide();
      if (layerDirty) layerDirty = false;
      draft.layerMode = t.value; markScene();
      // A camada a editar depende do alcance salvo: até salvar, paredes, luzes e névoa ficam bloqueadas.
      if (layerLocked()) toast("Salve para passar a editar a preparação " + (t.value === "scene" ? "própria desta cena." : "compartilhada do mapa."));
      if (PAINT.has(tool) || ["light", "mark", "toggleDoor"].includes(tool)) tool = "select";
      return renderAll(false);
    }
    if (t.dataset.fog !== undefined) { layer = { ...layer, fog: t.value === "inherit" ? null : t.value === "on" }; markLayer(); return redraw(); }
    if (t.dataset.reset !== undefined) { resetExploration = t.checked; markLayer(); }
  }
  function onSubmit(e) {
    const f = e.target;
    if (!root.contains(f)) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (f.matches("[data-add-marker]")) {
      const label = String(data.label || "").trim();
      if (!label) return toast("Dê um nome ao marcador.");
      const problem = placementProblem(layer?.cells, width(), height(), draft.prepared, pick.x, pick.y);
      if (problem) return toast(problem);
      draft.prepared.push({ label: label.slice(0, 40), side: data.side, x: pick.x, y: pick.y, hidden: data.hidden === "on" });
      selected = draft.prepared.length - 1; panel = "token"; pick = null; markScene(); redraw(); return renderSide();
    }
    if (f.matches("[data-light-form]")) {
      const radius = Math.round(Number(data.radius));
      if (!(radius >= 1 && radius <= 30)) return toast("O raio vai de 1 a 30 casas.");
      const old = layer.lights.find((l) => l.x === pick.x && l.y === pick.y);
      const lights = layer.lights.filter((l) => l !== old);
      if (!old && lights.length >= 100) return toast("Limite de 100 focos de luz por mapa.");
      lights.push({ ...(old || {}), x: pick.x, y: pick.y, radius });
      layer = { ...layer, lights }; markLayer(); redraw(); return renderSide();
    }
    if (f.matches("[data-mark-form]")) {
      const label = String(data.label || "").trim();
      if (!label) return toast("Dê um nome de até 40 caracteres à marca.");
      const num = (v) => (v === "" || v == null ? null : Math.round(Number(v)));
      const old = layer.marks.find((m) => m.x === pick.x && m.y === pick.y);
      const marks = layer.marks.filter((m) => m !== old);
      if (!old && marks.length >= 100) return toast("Limite de 100 marcas ocultas por mapa.");
      marks.push({ ...(old || {}), x: pick.x, y: pick.y, kind: data.kind, label: label.slice(0, 40), dc: num(data.dc), maxDistance: num(data.maxDistance), sense: data.sense || null });
      layer = { ...layer, marks }; markLayer(); redraw(); return renderSide();
    }
    if (f.matches("[data-apply-form]")) return apply(f);
    if (f.matches("[data-grid-form]")) return saveGrid();
  }
  async function saveGrid() {
    const m = mapOf(draft.mapKey);
    const v = disposeGrid?.values();
    const scale = Number($("#se-g-scale")?.value);
    if (!v || !m) return;
    try {
      const updated = await api(`${base}/assets/maps/${m.id}`, "PUT", { name: m.name, folderId: m.folderId || null, gridPixels: v.gridPixels, scaleMeters: scale, revision: m.revision, hasGrid: true, gridOffsetX: v.gridOffsetX, gridOffsetY: v.gridOffsetY });
      Object.assign(m, updated, { kind: "tileset" });
      const fresh = await api(`${base}/maps`); maps.items = fresh.items;
      const outside = draft.prepared.filter((t) => t.x >= updated.width || t.y >= updated.height).length;
      await loadLayer();
      if (outside) { draft.prepared = draft.prepared.filter((t) => t.x < updated.width && t.y < updated.height); markScene(); toast(`${outside} marcador(es) ficaram fora da nova grade e saíram da preparação.`); }
      else toast("Grade salva. A mesa e o servidor usam a mesma grade.");
      renderAll();
    } catch (e) { toast(e.message); }
  }
  function close() {
    if ((sceneDirty || layerDirty) && !confirm("Fechar sem salvar? As alterações desta preparação serão perdidas.")) return;
    dialog.close();
  }
  const onCancel = (e) => { if (sceneDirty || layerDirty) { e.preventDefault(); close(); } };
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  dialog.addEventListener("cancel", onCancel);
  disposeToggle = mountInterfaceToggle(root);
  const stopMode = onInterfaceChange((next) => {
    mode = next;
    // Troca só a apresentação: seleção, rascunho, posição do mapa e alterações não salvas continuam.
    const visible = new Set([...BASIC, ...(next === "complete" ? Object.values(COMPLETE_GROUPS).flat() : [])]);
    if (!visible.has(tool)) tool = "select";
    if (!visible.has(panel) && !["overview", "token", "add", "light", "mark", "hidden"].includes(panel)) panel = "overview";
    if (next === "complete" && panel === "hidden") panel = "overview";
    renderAll();
  });
  // O botão de fechar comum do diálogo também respeita as alterações não salvas.
  const closeButton = $("#close-modal");
  const guardedClose = (e) => { if (sceneDirty || layerDirty) { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  closeButton.addEventListener("click", guardedClose, true);

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      root.removeEventListener("click", onClick); root.removeEventListener("input", onInput); root.removeEventListener("change", onChange); root.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("cancel", onCancel); closeButton.removeEventListener("click", guardedClose, true);
      disposeToggle(); stopMode(); disposePicker(); disposeGrid?.dispose();
      board.destroy();
      onClose?.({ id: saved.id });
      resolve({ id: saved.id });
    }, { once: true });
    (async () => {
      try { await loadLayer(); } catch (e) { error = e.message; }
      if (!saved.id && !mapOnly && !draft.mapKey && draft.kind !== "text") panel = "scenery";
      renderAll();
      if (!mapOnly && !saved.id) $("#se-name").focus(); else board.focus();
    })();
  });
}
