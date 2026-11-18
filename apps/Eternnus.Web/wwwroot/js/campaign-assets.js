import { helpButton } from "./help.js";
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { folderTree, flattenFolders } from "./policy.js";
import { safeImageUrl } from "./play-policy.js";
import { state } from "./state.js";
import { uploadLimit, formatBytes } from "./account-usage-policy.js";

const base = d => `/campaigns/${d.id}/assets`;
/** Bibliotecas: atalhos para a biblioteca geral e a do sistema. O acervo próprio da campanha vive em Páginas (ADR-063);
 *  textos antigos aparecem só enquanto existirem, para o mestre convertê-los em página. */
export async function renderCampaignLibrary(d, target, page = 1) {
  target.innerHTML = '<p role="status">Consultando a biblioteca…</p>';
  const result = await api(`${base(d)}/library?page=${page}`);
  if (!target.isConnected) return;
  const legacy = result.total
    ? `<section class="legacy-texts" aria-labelledby="ca-legacy-title"><h3 id="ca-legacy-title">Textos antigos da campanha${helpButton("campanhas.acervo.publicacao", "Textos antigos")}</h3><p class="muted small">${d.isMaster ? "Criados antes das Páginas. Converta cada um para ganhar tipo, segredos, relações, versões e anexos; publicados viram “Toda a mesa” e rascunhos, “Só eu”." : "Textos publicados pelo mestre antes das Páginas."}</p><div class="resource-grid">${result.items.map(x => `<article class="resource-card metal">${d.isMaster ? `<span class="badge">${x.published ? "Publicado" : "Rascunho"}</span>` : ""}<h3>${esc(x.title)}</h3><p class="resource-body">${esc(x.text)}</p>${d.isMaster ? button("Converter em página", "ca-convert", x.id, "primary small", d.archived ? "disabled" : "") + button("Excluir", "ca-delete", x.id, "subtle small", d.archived ? "disabled" : "") : ""}</article>`).join("")}</div>${pager(result)}</section>`
    : "";
  target.innerHTML = `<div class="section-title"><h2>Bibliotecas</h2></div><div class="resource-grid"><a class="resource-card metal" href="#library/general"><h3>Biblioteca geral</h3><p>Materiais para qualquer mesa, disponíveis a qualquer momento.</p></a><a class="resource-card metal" href="#library/system/${esc(d.rpgSystemId)}"><h3>${esc(d.system)}</h3><p>Biblioteca padrão do sistema e modelos de ficha.</p></a></div><p class="muted small">Lore, lugares, livros, objetivos e pistas desta campanha ficam em <a href="#campaign/${esc(d.id)}/world">Mundo e acervo › Páginas</a>.</p>${legacy}`;
  target.onclick = async event => {
    const b = event.target.closest("[data-action]"); if (!b || b.disabled) return;
    try {
      if (b.dataset.action === "ca-page") return renderCampaignLibrary(d, target, Number(b.dataset.id));
      if (b.dataset.action === "ca-convert") {
        const item = result.items.find(x => x.id === b.dataset.id);
        b.disabled = true;
        try { await api(`${base(d)}/library/${item.id}/convert`, "POST", { revision: item.revision }); }
        finally { b.disabled = false; }
        toast("Texto convertido. Ele agora está em Páginas.");
        await renderCampaignLibrary(d, target, result.items.length > 1 ? page : Math.max(1, page - 1));
      }
      if (b.dataset.action === "ca-delete") confirmDelete("Excluir texto antigo?", async () => { await api(`${base(d)}/library/${b.dataset.id}`, "DELETE"); await renderCampaignLibrary(d, target, page); });
    } catch (error) { toast(error.message); }
  };
}
function pager(r) {
  return r.total > r.pageSize ? `<div class="pagination">${button("← Anterior", "ca-page", r.page - 1, "subtle", r.page <= 1 ? "disabled" : "")}<span>Página ${r.page} de ${Math.ceil(r.total / r.pageSize)}</span>${button("Próxima →", "ca-page", r.page + 1, "subtle", r.page * r.pageSize >= r.total ? "disabled" : "")}</div>` : "";
}
function confirmDelete(title, action) {
  modal(title, `<p>Esta ação remove o recurso da campanha.</p><form id="ca-delete-form">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="danger" type="submit">Excluir</button></div></form>`);
  $("#ca-delete-form").onsubmit = e => { e.preventDefault(); submitForm(e.currentTarget, async () => { await action(); $("#modal").close(); }); };
}
// ---------- Mapas da campanha (ADR-081) ----------
// A antiga subpágina "Mapas e cenários" deu lugar ao gerenciador da Preparação (js/prep-explorer.js).
// Aqui ficam só o formulário de envio/importação/configuração de mapas de imagem e o envio multipart comum.
const ROOT_NAME = "Mapas";
/** Limite do plano da conta (ADR-102). */
const maxBytes = () => uploadLimit(state.user);
const limitText = () => formatBytes(maxBytes());

/**
 * Envia uma imagem como mapa novo (mesmo multipart do envio manual). Usado pelo formulário e pelos fluxos de criação
 * (área em branco, cartografia oficial como modelo). Devolve o mapa salvo.
 */
export async function uploadMapImage(d, { blob, fileName = "", name, summary = "", folderId = null, gridPixels = 64, scaleMeters = 1.5, hasGrid = true, gridOffsetX = 0, gridOffsetY = 0, freeMovement = false, sourceKey = "" }) {
  if (!blob?.size || blob.size > maxBytes()) throw new Error(`Selecione uma imagem de até ${limitText()} (limite do seu plano).`);
  const upload = new FormData();
  upload.append("name", name); upload.append("folderId", folderId || "");
  upload.append("file", blob instanceof File ? blob : new File([blob], fileName || (blob.type === "image/png" ? "mapa.png" : "mapa.jpg"), { type: blob.type || "image/png" }));
  upload.append("gridPixels", String(gridPixels)); upload.append("scaleMeters", String(scaleMeters));
  upload.append("hasGrid", hasGrid ? "true" : "false"); upload.append("gridOffsetX", String(hasGrid ? gridOffsetX : 0)); upload.append("gridOffsetY", String(hasGrid ? gridOffsetY : 0)); upload.append("freeMovement", hasGrid && freeMovement ? "true" : "false");
  if (summary) upload.append("summary", summary);
  if (sourceKey) upload.append("sourceKey", sourceKey);
  return api(`${base(d)}/maps`, "POST", upload);
}

/** Pastas de Mapas para o seletor (pastas antigas sem categoria contam como Mapas). */
const mapFolders = (folders = []) => (folders || []).filter(f => !f.category || f.category === "maps");

/**
 * Envio (aparelho ou link), ou configuração de um mapa de imagem existente (`item`): nome, descrição, pasta,
 * apenas imagem / grade / movimentação livre, grade ajustada sobre a prévia, escala e deslocamento.
 * `source` pré-seleciona "file" ou "link"; `sourceKey` marca o modelo oficial de origem; `onSaved(map)` recebe o mapa salvo.
 */
export function openMapUpload(d, { item = null, folderId = "", folders = [], sourceKey = "", source = "file", onSaved } = {}) {
  const hasGrid = item ? item.hasGrid !== false : true;
  const use = !hasGrid ? "no" : item?.freeMovement ? "free" : "yes";
  const fromLink = source === "link";
  const list = flattenFolders(folderTree(mapFolders(folders)));
  const where = item ? item.folderId || "" : folderId || "";
  modal(item ? "Configurar mapa" : fromLink ? "Importar mapa por link" : "Enviar mapa", `<form id="ca-form" class="map-upload"><div class="field"><label for="ca-name">Nome do mapa</label><input id="ca-name" name="name" required maxlength="120" value="${esc(item?.name || "")}"></div><div class="field"><label for="ca-summary">Descrição</label><textarea id="ca-summary" name="summary" maxlength="500" rows="2">${esc(item?.summary || "")}</textarea></div>${item ? "" : `<fieldset class="grid-choice"><legend>De onde vem a imagem</legend><label class="check se-option"><input type="radio" name="source" value="file" ${fromLink ? "" : "checked"}><span><strong>Do aparelho</strong><small>PNG ou JPEG até ${limitText()}.</small></span></label><label class="check se-option"><input type="radio" name="source" value="link" ${fromLink ? "checked" : ""}><span><strong>De um link</strong><small>O Eternnus baixa uma cópia; os jogadores não acessam o site de origem.</small></span></label></fieldset><div class="field" data-source="file" ${fromLink ? "hidden" : ""}><label for="ca-image">Imagem PNG ou JPEG (até ${limitText()})</label><input id="ca-image" type="file" name="file" accept="image/png,image/jpeg" ${fromLink ? "disabled" : "required"}><small class="form-help">A imagem só sai do seu aparelho ao salvar.</small></div><div class="field" data-source="link" ${fromLink ? "" : "hidden"}><label for="ca-url">Link https da imagem</label><input id="ca-url" name="url" type="url" inputmode="url" maxlength="2000" placeholder="https://…/mapa.jpg" ${fromLink ? "required" : "disabled"} aria-describedby="ca-url-hint"><small class="form-help" id="ca-url-hint">Use o endereço que abre a própria imagem (PNG ou JPEG, até ${limitText()}). A prévia abaixo é carregada do site do link.</small></div>`}<fieldset class="grid-choice"><legend>Como usar a imagem${helpButton("campanhas.acervo.movimentacao", "Movimentação livre")}</legend><label class="check se-option"><input type="radio" name="useGrid" value="no" ${use === "no" ? "checked" : ""}><span><strong>Apenas imagem</strong><small>Para mostrar ao grupo, sem casas, marcadores ou névoa.</small></span></label><label class="check se-option"><input type="radio" name="useGrid" value="yes" ${use === "yes" ? "checked" : ""}><span><strong>Usar grade</strong><small>Personagens andam por casas; dá para usar paredes, luz e névoa.</small></span></label><label class="check se-option"><input type="radio" name="useGrid" value="free" ${use === "free" ? "checked" : ""}><span><strong>Movimentação livre</strong><small>Personagens e criaturas ficam em qualquer ponto da imagem. A grade abaixo vira só referência de escala, paredes e névoa (oculta na mesa).</small></span></label></fieldset><div data-grid-host ${use === "no" ? "hidden" : ""}><p class="form-help" data-grid-wait>${item ? "" : "Escolha a imagem para ver a prévia da grade."}</p></div><div class="field"><label for="ca-location">Pasta</label><select id="ca-location" name="folderId"><option value="">${ROOT_NAME}</option>${list.map(f => `<option value="${esc(f.id)}" ${f.id === where ? "selected" : ""}>${"   ".repeat(f.depth + 1)}${esc(f.name)}</option>`).join("")}</select></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar mapa</button></div></form>`);
  $("#modal").classList.add("wide");
  const form = $("#ca-form");
  const host = form.querySelector("[data-grid-host]");
  let adjust = null, objectUrl = "", valid = true;
  const mount = async (src) => {
    const { gridAdjustHtml, mountGridAdjust } = await import("./grid-adjust.js");
    const { interfaceMode } = await import("./interface-mode.js");
    if (!form.isConnected) return;
    adjust?.dispose();
    host.innerHTML = gridAdjustHtml("ca-g", item || {}, { complete: interfaceMode() === "complete" });
    adjust = mountGridAdjust(host, src, { onChange: (v) => { valid = v.valid; } });
  };
  if (item) mount(item.imageUrl);
  const linkPreview = value => /^https:/i.test(value) ? safeImageUrl(value) || "" : "";
  form.addEventListener("change", e => {
    if (e.target.name === "useGrid") host.hidden = e.target.value === "no";
    if (e.target.name === "file" && e.target.files?.[0]) { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(e.target.files[0]); mount(objectUrl); }
    if (e.target.name === "url" && linkPreview(e.target.value.trim())) mount(linkPreview(e.target.value.trim()));
    if (e.target.name === "source") for (const box of form.querySelectorAll("[data-source]")) {
      const on = box.dataset.source === e.target.value;
      box.hidden = !on;
      const input = box.querySelector("input"); input.disabled = !on; input.required = on;
    }
  });
  $("#modal").addEventListener("close", () => { adjust?.dispose(); if (objectUrl) URL.revokeObjectURL(objectUrl); }, { once: true });
  (fromLink ? $("#ca-url") : $("#ca-name"))?.focus();
  form.onsubmit = e => { e.preventDefault(); submitForm(form, async data => {
    const grid = data.useGrid !== "no", freeMovement = data.useGrid === "free";
    const v = adjust?.values() || { gridPixels: item?.gridPixels || 64, gridOffsetX: 0, gridOffsetY: 0 };
    if (grid && adjust && !valid) throw new Error("Ajuste a grade: " + (host.querySelector("[data-grid-summary]")?.textContent || "valores inválidos."));
    const scale = Number(form.querySelector("[name=scaleMeters]")?.value || item?.scaleMeters || 1.5);
    const summary = String(data.summary || "").trim().slice(0, 500);
    const common = { name: data.name, summary, folderId: data.folderId || null, gridPixels: v.gridPixels, scaleMeters: scale, hasGrid: grid, gridOffsetX: grid ? v.gridOffsetX : 0, gridOffsetY: grid ? v.gridOffsetY : 0, freeMovement };
    let saved;
    if (item) saved = await api(`${base(d)}/maps/${item.id}`, "PUT", { ...common, revision: item.revision });
    else if (data.source === "link") saved = await api(`${base(d)}/maps/import`, "POST", { ...common, url: String(data.url || "").trim(), ...(sourceKey ? { sourceKey } : {}) });
    else saved = await uploadMapImage(d, { ...common, blob: form.querySelector("[name=file]").files?.[0], sourceKey });
    $("#modal").close(); toast(item ? "Mapa atualizado." : "Mapa salvo."); await onSaved?.(saved);
  }); };
}
