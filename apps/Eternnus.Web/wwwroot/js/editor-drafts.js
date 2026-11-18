// Rascunhos locais e versões persistentes dos editores (ADR-083).
// - Rascunho: o documento em edição é guardado no IndexedDB deste navegador (por usuário, campanha, tipo e documento)
//   ~2 s depois da última mudança e ao esconder/fechar a página. Ao reabrir, o editor oferece Restaurar/Descartar/Decidir depois.
//   Falhas de armazenamento nunca interrompem o editor. Sair da conta apaga os rascunhos daquele usuário.
// - Versões: Arquivo › Versões… lista, nomeia, exclui e carrega versões salvas no servidor (só o mestre).
//   Carregar uma versão a coloca como rascunho; ela só vale depois de "Salvar" (mesmas validações e revisão).
import { api } from "./api.js";
import { esc, toast } from "./ui.js";
import { state } from "./state.js";
import { helpButton } from "./help.js";
import { buildDraft, draftDecision, draftKey, pruneDrafts, readDraft, saveStatusText, when, DRAFT_DEBOUNCE_MS } from "./draft-policy.js";

// ---------- IndexedDB (nunca lança: sem armazenamento, o editor segue sem rascunho) ----------
const DB = "eternnus-editor", STORE = "drafts";
let opening = null;
function open() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const s = req.result.createObjectStore(STORE, { keyPath: "key" }); s.createIndex("user", "user"); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }).then((db) => { if (!db) opening = null; return db; });
  return opening;
}
async function run(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
      const req = fn(store);
      tx.oncomplete = () => resolve(req?.result ?? null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
const getDraft = (key) => run("readonly", (s) => s.get(key));
const putDraft = (record) => run("readwrite", (s) => s.put(record));
const deleteDraft = (key) => run("readwrite", (s) => s.delete(key));
const userDrafts = (user) => run("readonly", (s) => s.index("user").getAll(String(user))).then((r) => r || []);

/**
 * Armazenamento cru para telas fora do editor (ficha do jogador, ADR-099): mesmo banco, limites e limpeza ao sair.
 * Nunca lança; sem IndexedDB devolve nulo.
 */
export const localDrafts = Object.freeze({
  get: getDraft,
  put: async (record) => {
    const done = await putDraft(record);
    if (done != null && record?.user) for (const k of pruneDrafts(await userDrafts(record.user), { user: record.user }).filter((k) => k !== record.key)) await deleteDraft(k);
    return done;
  },
  remove: deleteDraft,
});

/** Apaga todos os rascunhos locais de um usuário (sair da conta). */
export async function clearUserDrafts(user) {
  if (!user) return;
  for (const r of await userDrafts(user)) await deleteDraft(r.key);
}

// ---------- Aviso entre abas ----------
const TAB = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("eternnus-editor-docs") : null;

/**
 * Liga rascunho local, aviso entre abas e versões a um editor aberto.
 * opts: { campaignId, kind: tilemap|imagemap|scene|maplayer, docId(): id|null, label(), revision(), capture(), isDirty(),
 *   restore(snapshot, revision): aplica o rascunho mantendo a revisão de origem (para o servidor detectar conflito),
 *   versionKind?: tilemap|imagemap|scene, loadVersion?(payload): coloca a versão no editor como alteração desfazível }.
 * Devolve { menuItems(), flush(), dispose() }.
 */
export function attachDrafts(shell, opts) {
  const user = state.user?.id;
  let key = user ? draftKey(user, opts.campaignId, opts.kind, opts.docId()) : null;
  let pending = null;            // rascunho anterior aguardando decisão
  let paused = false;            // "Decidir depois": não sobrescrever o rascunho anterior nesta sessão
  let lastSig = null, changedAt = 0, writtenSig = null, draftAt = null, savedAt = null;
  let lastRevision = JSON.stringify(opts.revision() ?? null), banner = null, disposed = false, restoring = false;
  const say = (text) => shell.message(text);
  const status = () => shell.setDraftStatus?.(saveStatusText({ savedAt, draftAt, dirty: safeDirty(), paused }));
  function safeDirty() { try { return !!opts.isDirty(); } catch { return false; } }

  async function write(sig) {
    if (!key || paused || pending) return;
    const id = opts.docId();
    const built = buildDraft({ key, user, campaign: opts.campaignId, kind: opts.kind, doc: id, label: opts.label(), revision: opts.revision(), snapshot: JSON.parse(sig) });
    if (built.error) { if (writtenSig !== "too-big") say(built.error); writtenSig = "too-big"; return; }
    if (await putDraft(built.record) == null) return; // armazenamento indisponível ou cheio: tenta de novo na próxima mudança
    writtenSig = sig; draftAt = built.record.savedAt; status();
    const extra = pruneDrafts(await userDrafts(user), { user }).filter((k) => k !== key);
    for (const k of extra) await deleteDraft(k);
  }
  function tick(force = false) {
    if (disposed || !key || restoring) return;
    // Documento novo recebeu id ao salvar: a chave muda e o rascunho "novo" deixa de valer.
    const nextKey = draftKey(user, opts.campaignId, opts.kind, opts.docId());
    if (nextKey && nextKey !== key) { if (!paused && !pending) deleteDraft(key); key = nextKey; writtenSig = null; }
    const revision = JSON.stringify(opts.revision() ?? null);
    const dirty = safeDirty();
    if (revision !== lastRevision && !dirty) { savedAt = Date.now(); channel?.postMessage({ t: "saved", key, tab: TAB }); }
    lastRevision = revision;
    if (!dirty) {
      if (writtenSig && !paused && !pending) { deleteDraft(key); writtenSig = null; draftAt = null; }
      lastSig = null; status(); return;
    }
    let sig;
    try { sig = JSON.stringify(opts.capture()); } catch { return; }
    if (sig !== lastSig) { lastSig = sig; changedAt = Date.now(); }
    if (sig !== writtenSig && (force || Date.now() - changedAt >= DRAFT_DEBOUNCE_MS)) write(sig);
  }
  const flush = () => tick(true);
  const timer = setInterval(() => tick(false), 1000);
  const onHide = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);

  const onMessage = (e) => {
    const m = e.data || {};
    if (!key || m.tab === TAB || m.key !== key) return;
    if (m.t === "open") { channel.postMessage({ t: "here", key, tab: TAB }); say("Este documento também foi aberto em outra aba. Salvar nas duas pode gerar conflito."); }
    if (m.t === "here") say("Este documento também está aberto em outra aba. Salvar nas duas pode gerar conflito.");
    if (m.t === "saved") say("Este documento foi salvo em outra aba. Ao salvar aqui, você poderá recarregar a versão salva ou guardar uma cópia.");
  };
  channel?.addEventListener("message", onMessage);
  if (key) channel?.postMessage({ t: "open", key, tab: TAB });

  // ---------- Oferta do rascunho anterior ----------
  function showBanner() {
    banner?.remove();
    if (!pending) return;
    const { conflict } = draftDecision(pending, { revision: opts.revision() });
    banner = document.createElement("div");
    banner.className = "ed-stage-banner ed-draft-banner";
    banner.setAttribute("role", "alertdialog");
    banner.setAttribute("aria-labelledby", "ed-draft-text");
    banner.innerHTML = `<p id="ed-draft-text"><strong>Rascunho local não salvo</strong> ${helpButton("campanhas.editor.rascunhos", "Rascunho local e versões")} de ${esc(when(pending.savedAt))}${pending.label ? ` (${esc(pending.label)})` : ""}.${conflict ? " O documento foi salvo depois deste rascunho: ao salvar o rascunho, você poderá recarregar a versão salva ou guardar uma cópia." : ""}</p><div class="ed-draft-actions"><button type="button" class="primary small" data-draft="restore">Restaurar rascunho</button><button type="button" class="subtle small" data-draft="discard">Descartar</button><button type="button" class="subtle small" data-draft="later">Decidir depois</button></div>`;
    shell.stage.append(banner);
    banner.querySelector("[data-draft=restore]").focus({ preventScroll: true });
    banner.addEventListener("click", (e) => {
      const action = e.target.closest("[data-draft]")?.dataset.draft;
      if (action) decide(action);
    });
  }
  function decide(action) {
    const draft = pending;
    banner?.remove(); banner = null;
    if (!draft) return;
    if (action === "later") { paused = true; status(); say("Rascunho anterior guardado. Arquivo › Rascunho local… para decidir. O rascunho automático fica pausado nesta edição."); shell.refreshMenus?.(); return; }
    pending = null; paused = false;
    if (action === "discard") { deleteDraft(key); say("Rascunho local descartado."); }
    if (action === "restore") {
      writtenSig = draft.data; draftAt = draft.savedAt; restoring = true;
      Promise.resolve().then(() => opts.restore(draft.snapshot, draft.revision))
        .then(() => say("Rascunho restaurado. Salve para gravá-lo."))
        .catch((err) => { pending = draft; writtenSig = null; say(err?.message || "Não foi possível restaurar o rascunho."); status(); shell.refreshMenus?.(); })
        .finally(() => { restoring = false; });
    }
    status(); shell.refreshMenus?.();
  }
  (async () => {
    if (!key) return;
    const record = readDraft(await getDraft(key), { key });
    if (disposed) return;
    if (!record) { const raw = await getDraft(key); if (raw) deleteDraft(key); return; }
    let current; try { current = opts.capture(); } catch { current = undefined; }
    if (!draftDecision(record, { revision: opts.revision(), snapshot: current }).offer) { deleteDraft(key); return; }
    pending = record; status(); showBanner();
  })();

  // ---------- Versões ----------
  async function versionsDialog() {
    const id = opts.docId();
    if (!opts.versionKind || !opts.loadVersion) return;
    if (!id) return say("Salve o documento para criar e ver versões.");
    document.querySelector(".ed-versions")?.remove();
    const base = `/campaigns/${opts.campaignId}/versions`;
    const box = document.createElement("section");
    box.className = "ed-props ed-versions";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "false");
    box.setAttribute("aria-labelledby", "ed-versions-title");
    box.innerHTML = `<header class="ed-props-head"><h3 id="ed-versions-title">Versões salvas</h3>${helpButton("campanhas.editor.rascunhos", "Rascunho local e versões")}<button type="button" class="ed-icon-button" data-v="close" aria-label="Fechar versões">✕</button></header>
      <div class="ed-props-form"><p class="form-help">Cada salvamento guarda uma versão automática (as 20 mais recentes). Dê nome às importantes para mantê-las. Carregar uma versão a abre como rascunho: nada muda até você salvar.</p>
      <form class="ed-versions-new" data-v-form><div class="field"><label for="ed-v-label">Nome para a versão salva atual</label><input id="ed-v-label" name="label" maxlength="80" required placeholder="Ex.: Antes da batalha"></div><button type="submit" class="subtle small">Guardar versão</button></form>
      <div class="ed-versions-list" data-v-list aria-live="polite"><p class="muted small">Carregando versões…</p></div><p class="form-error" role="alert" data-v-error></p></div>`;
    (document.querySelector("dialog[open]") || document.body).append(box);
    const list = box.querySelector("[data-v-list]"), error = box.querySelector("[data-v-error]");
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape" && box.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    let items = [];
    async function load() {
      error.textContent = "";
      try { items = (await api(`${base}?kind=${encodeURIComponent(opts.versionKind)}&document=${encodeURIComponent(id)}`, "GET", undefined, { background: true })).items || []; }
      catch (e) { list.innerHTML = ""; error.textContent = e?.message || "Não foi possível carregar as versões."; return; }
      list.innerHTML = items.length ? `<ol class="ed-versions-items">${items.map((v) => `<li data-v-id="${esc(v.id)}"><div><strong>${v.auto ? "Automática" : esc(v.label)}</strong><small>${esc(when(Date.parse(v.createdAt)))} · revisão ${Number(v.revision) || 0}</small></div><div class="ed-versions-actions"><button type="button" class="subtle small" data-v="load">Carregar</button><button type="button" class="subtle small" data-v="rename">${v.auto ? "Nomear" : "Renomear"}</button><button type="button" class="subtle small danger" data-v="delete" aria-label="Excluir versão de ${esc(when(Date.parse(v.createdAt)))}">Excluir</button></div></li>`).join("")}</ol>` : '<p class="muted small">Nenhuma versão ainda. Salve o documento para criar a primeira.</p>';
    }
    box.querySelector("[data-v-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.currentTarget.elements.label;
      if (!input.value.trim()) return input.reportValidity();
      if (safeDirty() && !confirm("Há alterações não salvas. A versão guardará o documento salvo, sem elas. Continuar?")) return;
      try { await api(base, "POST", { kind: opts.versionKind, documentId: id, label: input.value.trim() }); input.value = ""; await load(); say("Versão guardada."); }
      catch (err) { error.textContent = err?.message || "Não foi possível guardar a versão."; }
    });
    box.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-v]")?.dataset.v;
      if (action === "close") return close();
      const vid = e.target.closest("[data-v-id]")?.dataset.vId;
      if (!action || !vid) return;
      const v = items.find((x) => x.id === vid);
      error.textContent = "";
      try {
        if (action === "load") {
          if (safeDirty() && !confirm("Substituir as alterações não salvas pela versão escolhida? Você pode desfazer depois.")) return;
          const full = await api(`${base}/${encodeURIComponent(vid)}`);
          opts.loadVersion(full.payload);
          close();
          say(`Versão de ${when(Date.parse(full.createdAt))} carregada. Salve para torná-la a versão atual, ou desfaça.`);
        }
        if (action === "rename") {
          const label = prompt("Nome da versão (até 80 caracteres)", v?.label || "");
          if (label == null || !label.trim()) return;
          await api(`${base}/${encodeURIComponent(vid)}`, "PUT", { label: label.trim().slice(0, 80) }); await load();
        }
        if (action === "delete") {
          if (!confirm("Excluir esta versão? Ela não poderá ser recuperada.")) return;
          await api(`${base}/${encodeURIComponent(vid)}`, "DELETE"); await load();
        }
      } catch (err) { error.textContent = err?.message || "Não foi possível concluir."; }
    });
    load();
    setTimeout(() => box.querySelector("#ed-v-label")?.focus(), 0);
  }

  /**
   * Antes de recarregar a versão salva (conflito): grava o rascunho atual e o mantém recuperável nesta edição
   * (Arquivo › Rascunho local…). O rascunho automático fica pausado até o mestre decidir.
   */
  async function preserve() {
    if (!key || disposed) return;
    try { const sig = JSON.stringify(opts.capture()); if (safeDirty() && sig !== writtenSig) await write(sig); } catch { /* segue sem rascunho */ }
    const record = readDraft(await getDraft(key), { key });
    writtenSig = null;
    if (record) { pending = record; paused = true; status(); shell.refreshMenus?.(); say("Seu rascunho continua guardado: Arquivo › Rascunho local… para restaurá-lo."); }
  }

  function dispose() {
    if (disposed) return;
    // Fechou sem salvar por escolha do mestre: o rascunho sai. Qualquer outro fechamento (sessão expirada, navegação) guarda.
    if (shell.root?.dataset.discard === "1") { if (!paused && !pending && key) deleteDraft(key); }
    else flush();
    disposed = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
    channel?.removeEventListener("message", onMessage);
    banner?.remove();
    document.querySelector(".ed-versions")?.remove();
  }
  shell.dialog?.addEventListener("close", dispose, { once: true });

  return {
    flush, dispose, preserve,
    /** Itens do menu Arquivo: Versões… e, quando adiado, Rascunho local…. */
    menuItems: () => [
      opts.versionKind && opts.loadVersion ? { label: "Versões…", hint: "Versões salvas deste documento", disabled: !opts.docId(), disabledReason: "Salve o documento para criar versões.", run: () => versionsDialog().catch((e) => toast(e?.message || String(e))) } : null,
      pending ? { label: "Rascunho local…", hint: "Restaurar ou descartar o rascunho anterior", run: () => showBanner() } : null,
    ].filter(Boolean),
  };
}
