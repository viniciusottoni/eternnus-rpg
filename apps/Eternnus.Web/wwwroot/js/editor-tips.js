// Dicas do editor (ADR-124): apresentação na barra de propriedades enquanto nada está selecionado. Escolhe a dica pelo
// editor, pelo contexto de trabalho, pela interface e pelo nível de intimidade do mestre (editor-tips-policy.js), troca a
// cada TIP_INTERVAL_MS com a barra ociosa e oferece anterior/próxima e Experimentar (ativa a ferramenta citada).
// Os sinais de uso ficam só neste navegador (localStorage por conta); nada é enviado ao servidor.
import { esc } from "./ui.js";
import { icon } from "./icons.js";
import { helpButton } from "./help.js";
import { TIP_EDITORS, TIP_INTERVAL_MS, normalizeTipState, recordTipSignal, pickTip, tipsStoreKey } from "./editor-tips-policy.js";

/** Catálogos por editor, carregados sob demanda na primeira abertura (uma vez por página). */
const CATALOGS = {
  scene: () => import("./editor-tips/cena.js"),
  "map-prep": () => import("./editor-tips/cena.js"),
  image: () => import("./editor-tips/imagem.js"),
};
const cache = new Map();
function loadCatalog(editor) {
  if (!cache.has(editor)) {
    const p = Promise.all([import("./editor-tips/comum.js"), CATALOGS[editor]()]).then(([a, b]) => Object.freeze([...a.TIPS, ...b.TIPS]));
    p.catch(() => cache.delete(editor));
    cache.set(editor, p);
  }
  return cache.get(editor);
}

const readState = (key) => { try { return normalizeTipState(JSON.parse(localStorage.getItem(key) || "null")); } catch { return normalizeTipState(null); } };
const writeState = (key, s) => { try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* armazenamento indisponível: as dicas seguem sem memória */ } };

/**
 * Liga as dicas a uma barra de propriedades. `hint` é o texto fixo mostrado enquanto o catálogo carrega ou quando
 * nenhuma dica vale. `getContext`/`getMode` leem o estado do editor; `toolReady(id)` diz se a ferramenta pode ser
 * usada agora; `toolLabel(id)` dá o nome; `runTool(id)` a ativa. Devolve { show, hide, refresh, record, next, dispose }.
 */
export function createEditorTips(host, { editor, userId, hint, getContext, getMode, toolReady, toolLabel, runTool }) {
  const enabled = !!host && TIP_EDITORS.includes(editor);
  const key = tipsStoreKey(userId);
  let state = readState(key);
  let catalog = null, current = null, visible = false, paused = false, timer = 0, disposed = false;
  const trail = []; let at = -1; // dicas mostradas nesta edição, para "anterior"

  const save = () => writeState(key, state);
  const record = (kind, id) => { if (!enabled) return; state = recordTipSignal(state, kind, id); save(); };

  function markup(tip) {
    const ready = tip?.tool && tip.act !== false && toolReady(tip.tool);
    const label = ready ? toolLabel(tip.tool) : "";
    const nav = catalog ? `<span class="ed-tip-nav" role="group" aria-label="Navegar pelas dicas"><button type="button" class="ed-icon-button ed-tip-prev" data-ed-tip="prev" aria-label="Dica anterior" data-tip="Dica anterior" ${at > 0 ? "" : "disabled"}>${icon("chevron")}</button><button type="button" class="ed-icon-button" data-ed-tip="next" aria-label="Próxima dica" data-tip="Próxima dica">${icon("chevron")}</button></span>` : "";
    const run = ready ? `<button type="button" class="subtle small ed-tip-try" data-ed-tip="try" aria-label="${esc(`Experimentar: ${label}`)}">Experimentar</button>` : "";
    return `<div class="ed-tip" data-ed-tips data-ed-tip-id="${esc(tip?.id || "")}"><span class="ed-tip-label">${icon("light")}<span>Dica</span>${helpButton("campanhas.editor.dicas", "Dicas do editor")}</span><p class="ed-cb-hint ed-tip-text" data-ed-tip-text>${esc(tip?.text || hint)}</p>${run}${nav}</div>`;
  }
  function paint() {
    if (!enabled || !visible) return;
    host.innerHTML = markup(current);
  }
  function display(tip, { push = true } = {}) {
    current = tip;
    if (tip) {
      record("seen", tip.id);
      if (push) { trail.splice(at + 1); trail.push(tip.id); if (trail.length > 30) trail.shift(); at = trail.length - 1; }
    }
    paint();
  }
  const choose = () => (catalog ? pickTip(catalog, { editor, context: getContext() || "*", mode: getMode(), state, toolReady, currentId: current?.id }) : null);
  function next() {
    if (!enabled || !visible) return false;
    if (at < trail.length - 1) { at++; const tip = catalog?.find((t) => t.id === trail[at]); if (tip) { display(tip, { push: false }); schedule(); return true; } }
    const tip = choose();
    if (tip) display(tip);
    schedule();
    return !!tip;
  }
  function prev() {
    if (at <= 0) return;
    at--;
    const tip = catalog?.find((t) => t.id === trail[at]);
    if (tip) display(tip, { push: false });
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!enabled || !visible || disposed || !catalog) return;
    timer = setTimeout(() => { if (paused || document.hidden || !host.getClientRects().length) schedule(); else next(); }, TIP_INTERVAL_MS);
  }

  /** A barra ficou sem seleção: mostra a dica atual (ou a primeira) e retoma a troca periódica. */
  function show() {
    if (!enabled || disposed) return;
    visible = true;
    paint();
    if (catalog) { if (!current) display(choose()); schedule(); }
  }
  /** A barra passou a mostrar campos do selecionado: para a troca (o DOM da barra já foi substituído). */
  function hide() { visible = false; paused = false; clearTimeout(timer); }
  /** Contexto ou interface mudaram: a dica atual pode não valer mais; mostra uma do novo contexto. */
  function refresh() {
    if (!enabled || !catalog) return;
    if (current && !pickable(current)) current = null;
    if (visible) { display(choose()); schedule(); }
  }
  const pickable = (tip) => (tip.ctx === "*" || tip.ctx === getContext()) && (!tip.ui || tip.ui === getMode()) && (!tip.tool || toolReady(tip.tool));

  const onClick = (e) => {
    const b = e.target.closest?.("[data-ed-tip]");
    if (!b || !host.contains(b) || b.disabled) return;
    const action = b.dataset.edTip;
    if (action === "next") next();
    else if (action === "prev") prev();
    else if (action === "try" && current?.tool) runTool(current.tool);
    // O botão clicado foi recriado: devolve o foco ao equivalente para quem navega pelo teclado.
    if (action !== "try") (host.querySelector(`[data-ed-tip="${action}"]:not([disabled])`) || host.querySelector('[data-ed-tip="next"]'))?.focus({ preventScroll: true });
  };
  const pause = () => { paused = true; };
  const resume = (e) => { if (e?.relatedTarget && host.contains(e.relatedTarget)) return; paused = host.matches(":hover") || host.contains(document.activeElement); };
  if (enabled) {
    host.addEventListener("click", onClick);
    host.addEventListener("pointerenter", pause);
    host.addEventListener("pointerleave", resume);
    host.addEventListener("focusin", pause);
    host.addEventListener("focusout", resume);
    record("open", editor);
    loadCatalog(editor).then((list) => {
      if (disposed) return;
      catalog = list;
      if (visible) { display(choose()); schedule(); }
    }).catch(() => { /* sem catálogo: a barra continua com o texto fixo */ });
  }

  return {
    show, hide, refresh, next,
    /** Sinal de uso: "tool" (ferramenta usada) ou "context" (contexto visitado). */
    record,
    get available() { return enabled && !!catalog; },
    dispose() {
      disposed = true; clearTimeout(timer);
      if (!enabled) return;
      host.removeEventListener("click", onClick);
      host.removeEventListener("pointerenter", pause);
      host.removeEventListener("pointerleave", resume);
      host.removeEventListener("focusin", pause);
      host.removeEventListener("focusout", resume);
    },
  };
}
