// Painel de cenas da mesa do mestre (aba "Cenas"): o cenário atual continua visível. Clicar num cartão só abre a prévia
// privada; apresentar, retomar, reiniciar, aplicar e improvisar são ações explícitas. Escritas por api.js (SessionService).
import { api } from "./api.js";
import { helpButton } from "./help.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { mapThumbnail } from "./table-map.js";
import { interfaceMode } from "./interface-mode.js";
import { HELP, APPLY_PRESERVES, APPLY_TOKENS, pendingParts, sceneStatus, sceneKindLabel, mapTypeLabel, recentMapKeys } from "./scene-policy.js";

export function createScenePanel({ base, campaign, getLive }) {
  let host = null, data = null, maps = null, selectedId = null, signature = "", loading = null, failure = "";
  const live = () => getLive();
  const mapOf = (key) => maps?.items.find((m) => m.key === key);

  async function load() {
    failure = "";
    try { [data, maps] = await Promise.all([api(`/campaigns/${campaign.id}/scenes`, "GET", undefined, { background: true }), maps || api(`/campaigns/${campaign.id}/maps`, "GET", undefined, { background: true })]); }
    catch (e) { failure = e.message; }
  }
  const sig = (l) => JSON.stringify([l.play?.scene?.id, l.play?.scene?.pending, l.play?.scene?.name, l.map?.key, l.map?.kind, interfaceMode()]);

  function cardHtml(s, currentId) {
    const st = sceneStatus(s, currentId);
    const m = mapOf(s.mapKey);
    const picked = s.id === selectedId;
    return `<li class="ts-card ${st.key} ${picked ? "selected" : ""}"><button type="button" class="ts-card-main" data-ts="select" data-id="${esc(s.id)}" aria-pressed="${picked}" aria-describedby="ts-st-${esc(s.id)}"><span class="ts-thumb" ${s.kind !== "text" && m ? `data-ts-map="${esc(m.key)}"` : ""} aria-hidden="true">${s.kind === "text" || !m ? "¶" : ""}</span><span class="ts-text"><strong>${esc(s.name)}</strong><small id="ts-st-${esc(s.id)}" class="ts-state">${esc(st.label)}</small></span></button><div class="ts-card-actions">${st.action === "edit" ? button("Editar preparação", "ts-edit", s.id, "subtle small") : button(esc(st.actionLabel), st.action === "resume" ? "ts-resume" : "ts-present", s.id, "primary small")}</div></li>`;
  }
  function previewHtml(s, currentId) {
    if (!s) return `<p class="form-help ts-preview-empty">Clique numa cena para ver a prévia privada. Nada muda para os jogadores.</p>`;
    const st = sceneStatus(s, currentId);
    const m = mapOf(s.mapKey);
    return `<section class="ts-preview metal" aria-label="Prévia privada de ${esc(s.name)}"><p class="ts-private">Prévia privada — somente você vê.</p><div class="ts-preview-map" ${s.kind !== "text" && m ? `data-ts-map="${esc(m.key)}"` : ""}>${s.kind === "text" ? `<p class="se-text-card">${esc(s.sharedText || "Sem texto compartilhável.")}</p>` : ""}</div><h3>${esc(s.name)}</h3><p class="small">${esc(sceneKindLabel(s.kind))}${m ? ` · ${esc(m.name)} (${esc(mapTypeLabel(m))})` : ""}${s.prepared ? ` · ${s.prepared} marcadores preparados` : ""}</p>${s.sharedText && s.kind !== "text" ? `<p class="small"><strong>Texto para o grupo:</strong> ${esc(s.sharedText)}</p>` : ""}${s.privateNotes ? `<p class="small ts-notes"><strong>Notas privadas:</strong> ${esc(s.privateNotes)}</p>` : ""}<div class="form-actions">${st.action === "edit" ? "" : button(esc(st.actionLabel), st.action === "resume" ? "ts-resume" : "ts-present", s.id, "primary")}${button("Editar preparação", "ts-edit", s.id, "subtle")}<details class="more-options"><summary>Mais opções</summary><p class="form-help">${esc(HELP.restart)}</p>${button("Reiniciar cena…", "ts-restart", s.id, "text-button")}${st.action === "edit" && interfaceMode() === "complete" ? button("Guardar posições atuais como arranjo inicial", "ts-capture", s.id, "text-button") : ""}</details></div><p class="form-help">${esc(st.action === "resume" ? HELP.resume : st.action === "present" ? "Apresentar mostra esta cena aos jogadores." : "Ações no mapa da mesa acontecem ao vivo.")}</p></section>`;
  }
  function render() {
    if (!host) return;
    const l = live();
    if (failure) { host.innerHTML = `<p class="form-error" role="alert">${esc(failure)}</p>${button("Tentar de novo", "ts-reload", "", "subtle")}`; return; }
    if (!data) { host.innerHTML = '<p class="loading-line" role="status">Reunindo cenas…</p>'; return; }
    const current = l.play?.scene || null;
    const parts = pendingParts(current?.pending);
    const selected = data.items.find((s) => s.id === selectedId);
    host.innerHTML = `<div class="ts-panel"><div class="ts-head"><h3>Cenas</h3>${helpButton("campanhas.cenas.preparacao", "Preparar e apresentar cenas")}${button("Usar outro cenário agora", "ts-improvise", "", "subtle small")}${current ? "" : button("Salvar como cena", "ts-save-as", "", "subtle small")}</div>
      ${current ? `<div class="ts-current" role="status"><p><strong>● Em apresentação — os jogadores estão vendo esta cena.</strong> ${esc(current.name)}</p>${parts.length ? `<p class="ts-pending">Alterações não aplicadas à mesa: ${parts.map(([, t]) => esc(t)).join(", ")}.</p>${button("Aplicar à cena atual…", "ts-apply", current.id, "primary small")}` : l.map?.kind === "tileset" ? button("Aplicar preparação à cena atual…", "ts-apply", current.id, "subtle small") : ""}</div>` : `<p class="form-help">Cenário improvisado: ${esc(l.map?.name || "")}. Salve como cena para retomar depois.</p>`}
      ${data.items.length ? `<ul class="ts-list" aria-label="Cenas da campanha">${data.items.map((s) => cardHtml(s, current?.id)).join("")}</ul>` : `<div class="empty"><h3>Nenhuma cena preparada</h3><p>Crie cenas sem sair da mesa; a preparação fica privada.</p></div>`}
      ${button("+ Nova cena (preparação privada)", "ts-new", "", "subtle small")}
      ${previewHtml(selected, current?.id)}</div>`;
    host.querySelectorAll("[data-ts-map]").forEach((el) => mapThumbnail(el, mapOf(el.dataset.tsMap)));
  }

  async function refresh() { await load(); render(); }
  async function present(id, restart) {
    await api(`${base}/scene`, "POST", { sceneId: id, restart }, { background: true });
    toast(restart ? "Cena reiniciada." : "Cena em apresentação.");
    await refresh();
  }
  async function edit(id) {
    const { openSceneEditor } = await import("./scene-editor.js");
    await openSceneEditor({ campaign, sceneId: id || null });
    await refresh();
  }
  function restartModal(s) {
    modal("Reiniciar cena?", `<p>Reiniciar <strong>${esc(s.name)}</strong> muda o que os jogadores veem agora:</p><ul><li>marcadores voltam ao arranjo preparado (criaturas fora dele saem; personagens sem posição entram pelos pontos de entrada);</li><li>paredes, portas, luzes, marcas e névoa voltam à preparação salva;</li><li>a exploração recomeça: revelações, áreas vistas e marcas percebidas.</li></ul><p class="form-help">Fichas, conversa, rolagens e o histórico da sessão continuam. Para continuar de onde parou, use “Retomar cena”.</p><form id="ts-restart-form">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger">Reiniciar cena</button></div></form>`);
    $("#ts-restart-form").onsubmit = (e) => { e.preventDefault(); submitForm(e.currentTarget, async () => { await present(s.id, true); $("#modal").close(); }); };
  }
  async function applyModal() {
    const current = live().play?.scene;
    if (!current) return;
    const parts = pendingParts(current.pending).filter(([k]) => k !== "map");
    const tactical = live().map?.kind === "tileset" && !current.pending?.map;
    let prepVersion = null;
    if (current.pending?.layer && live().map?.key) {
      const layer = await api(`/campaigns/${campaign.id}/assets/layers?key=${encodeURIComponent(live().map.key)}&scene=${encodeURIComponent(current.id)}`, "GET", undefined, { background: true });
      prepVersion = layer.prepVersion;
    }
    modal("Aplicar à cena atual", `<form id="ts-apply-form"><p>Escolha o que da preparação salva de <strong>${esc(current.name)}</strong> passa a valer na mesa agora. Os jogadores veem o resultado.</p><fieldset><legend>Aplicar</legend>${parts.map(([k, t]) => `<label class="check"><input type="checkbox" name="${k}" checked> ${esc(t)}</label>`).join("") || '<p class="form-help">Nada pendente no texto, na visibilidade ou no mapa.</p>'}${tactical ? `<label class="check"><input type="checkbox" name="tokens"> ${esc(APPLY_TOKENS.label)}</label><p class="form-help">${esc(APPLY_TOKENS.help)}</p>` : ""}</fieldset><p class="form-help">${esc(APPLY_PRESERVES)}</p>${current.pending?.map ? `<div class="notice-box"><p>O cenário mudou na preparação. Trocar de cenário recomeça a exploração, então usa “Reiniciar cena”.</p>${button("Reiniciar cena com o novo cenário…", "ts-apply-restart", current.id, "subtle")}</div>` : ""}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary" ${parts.length || tactical ? "" : "disabled"}>Aplicar à mesa</button></div></form>`);
    const restartBtn = $("#ts-apply-form [data-action=ts-apply-restart]");
    if (restartBtn) restartBtn.onclick = () => restartModal(current);
    $("#ts-apply-form").onsubmit = (e) => {
      e.preventDefault();
      submitForm(e.currentTarget, async (f) => {
        if (!f.text && !f.vision && !f.layer && !f.tokens) throw new Error("Escolha o que aplicar.");
        const r = await api(`${base}/scene/apply`, "POST", { sceneId: current.id, text: !!f.text, vision: !!f.vision, layer: !!f.layer, tokens: !!f.tokens, sceneRevision: current.revision, prepVersion });
        $("#modal").close();
        toast(r.applied?.length ? `Aplicado à mesa: ${r.applied.join(", ")}.` : "Nada a aplicar: a mesa já estava assim.");
      });
    };
  }
  async function improviseModal() {
    const { mapChoices, mountMapChoices } = await import("./map-picker.js");
    const l = live();
    const complete = interfaceMode() === "complete";
    const folders = complete ? (await api(`/campaigns/${campaign.id}/assets/maps`, "GET", undefined, { background: true }).catch(() => ({ folders: [] }))).folders || [] : [];
    maps = maps || await api(`/campaigns/${campaign.id}/maps`);
    modal("Usar outro cenário agora", `<form id="ts-improvise"><p class="form-help">Escolher só muda a prévia. A troca acontece ao clicar em “Apresentar agora”. ${l.play?.scene ? "A cena atual guarda o estado para você retomar depois." : ""}</p><fieldset class="ts-improvise-kind"><legend>Mostrar como</legend><label class="check"><input type="radio" name="as" value="tileset" checked> Mapa com grade</label><label class="check"><input type="radio" name="as" value="cartographic"> Imagem sem grade</label></fieldset>${mapChoices(maps.items, l.map?.key, "Cenário", { recentKeys: recentMapKeys(data?.items || [], l.map?.key), complete, folders })}<p class="ts-improvise-pick" role="status"></p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Apresentar agora</button></div></form>`);
    $("#modal").classList.add("wide");
    $("#modal").addEventListener("close", () => $("#modal").classList.remove("wide"), { once: true });
    const form = $("#ts-improvise");
    const status = form.querySelector(".ts-improvise-pick");
    const dispose = mountMapChoices(form, maps.items, { onChange: (m) => { status.textContent = m ? `Selecionado: ${m.name} (${mapTypeLabel(m)}). Ainda não apresentado.` : ""; if (m && m.kind !== "tileset") form.querySelector('input[name=as][value="cartographic"]').checked = true; } });
    $("#modal").addEventListener("close", dispose, { once: true });
    form.onsubmit = (e) => {
      e.preventDefault();
      submitForm(form, async (f) => {
        if (!f.map) throw new Error("Escolha um cenário.");
        const [kind, ...rest] = f.map.split("|");
        const key = rest.join("|");
        const as = kind === "tileset" ? f.as : "cartographic";
        if (as === "cartographic" && kind === "tileset" && !key.startsWith("asset:")) throw new Error("Mapas prontos com grade são mostrados com a grade.");
        await api(`${base}/map`, "POST", { mapKind: as, mapKey: key });
        $("#modal").close();
        toast("Cenário apresentado. Use “Salvar como cena” para guardá-lo.");
        await refresh();
      });
    };
  }
  function saveAsModal() {
    modal("Salvar como cena", `<form id="ts-save-as"><div class="field"><label for="ts-name">Nome da cena</label><input id="ts-name" name="name" maxlength="80" required></div><div class="field"><label for="ts-text">Texto para os jogadores (opcional)</label><textarea id="ts-text" name="sharedText" maxlength="2000" rows="3"></textarea></div><p class="form-help">Guarda o cenário e as posições atuais como uma cena preparada. Nada muda para os jogadores além do nome da cena.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar cena</button></div></form>`);
    $("#ts-name").focus();
    $("#ts-save-as").onsubmit = (e) => { e.preventDefault(); submitForm(e.currentTarget, async (f) => { await api(`${base}/scene/save-as`, "POST", { name: f.name, sharedText: f.sharedText }); $("#modal").close(); toast("Cena salva."); await refresh(); }); };
  }

  async function onClick(e) {
    const b = e.target.closest("[data-ts],[data-action^='ts-']");
    if (!b || b.disabled || !host?.contains(b)) return;
    const action = b.dataset.ts || b.dataset.action, id = b.dataset.id;
    const scene = data?.items.find((s) => s.id === id);
    try {
      if (action === "select") { selectedId = selectedId === id ? null : id; render(); host.querySelector(`[data-ts="select"][data-id="${CSS.escape(id)}"]`)?.focus(); }
      if (action === "ts-present" || action === "ts-resume") await present(id, false);
      if (action === "ts-restart" && scene) restartModal(scene);
      if (action === "ts-edit") await edit(id);
      if (action === "ts-new") await edit(null);
      if (action === "ts-apply") await applyModal();
      if (action === "ts-improvise") await improviseModal();
      if (action === "ts-save-as") saveAsModal();
      if (action === "ts-capture") { await api(`${base}/scene/capture`, "POST", { sceneId: id }); toast("Posições atuais guardadas como arranjo inicial da cena."); await refresh(); }
      if (action === "ts-reload") await refresh();
    } catch (error) { toast(error.message); }
  }

  return {
    async mount(el) {
      host = el; host.addEventListener("click", onClick);
      signature = sig(live());
      render();
      loading = loading || load();
      await loading; loading = null;
      render();
    },
    update(l) {
      if (!host) return;
      const next = sig(l);
      if (next === signature) return;
      signature = next;
      refresh();
    },
    unmount() { host?.removeEventListener("click", onClick); host = null; },
    /** Recarrega a lista (cenas criadas em outra tela ou na campanha) sem perder a cena selecionada. */
    async reload() { if (!host || loading) return; loading = load(); await loading; loading = null; render(); },
    applyModal, improviseModal,
  };
}
