import { helpButton } from "./help.js";
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast, empty } from "./ui.js";
import { folderTree, folderPath, flattenFolders } from "./policy.js";
import { mapThumbnail } from "./table-map.js";

const base = d => `/campaigns/${d.id}/assets`;
export async function renderCampaignLibrary(d, target, page = 1) {
  target.innerHTML = '<p role="status">Consultando a biblioteca…</p>';
  const result = await api(`${base(d)}/library?page=${page}`);
  if (!target.isConnected) return;
  target.innerHTML = `<div class="section-title"><h2>Bibliotecas</h2>${helpButton("campanhas.acervo.publicacao", "Acervo da campanha")}${d.isMaster ? button("+ Texto da campanha", "ca-text", "", "primary") : ""}</div><div class="resource-grid"><a class="resource-card metal" href="#library/general"><h3>Biblioteca geral</h3><p>Materiais para qualquer mesa, disponíveis a qualquer momento.</p></a><a class="resource-card metal" href="#library/system/${esc(d.rpgSystemId)}"><h3>${esc(d.system)}</h3><p>Biblioteca padrão do sistema e modelos de ficha.</p></a></div><h3>Acervo da campanha</h3><p class="muted small">Textos preparados pelo mestre. ${d.isMaster ? "Rascunhos ficam visíveis apenas para você; publique quando desejar." : "O mestre escolhe quando revelar cada texto."}</p>${result.items.length ? `<div class="resource-grid">${result.items.map(x => `<article class="resource-card metal"><span class="badge">${x.published ? "Publicado" : "Rascunho"}</span><h3>${esc(x.title)}</h3><p class="resource-body">${esc(x.text)}</p>${d.isMaster ? button("Editar / publicar", "ca-text", x.id, "subtle small") + button("Excluir", "ca-delete", x.id, "subtle small") : ""}</article>`).join("")}</div>` : empty("Nenhum texto disponível.", "O acervo da campanha aparecerá aqui.")}${pager(result)}`;
  target.onclick = async event => {
    const b = event.target.closest("[data-action]"); if (!b) return;
    try {
      if (b.dataset.action === "ca-page") return renderCampaignLibrary(d, target, Number(b.dataset.id));
      if (b.dataset.action === "ca-text") textModal(d, result.items.find(x => x.id === b.dataset.id), () => renderCampaignLibrary(d, target, page));
      if (b.dataset.action === "ca-delete") confirmDelete("Excluir texto?", async () => { await api(`${base(d)}/library/${b.dataset.id}`, "DELETE"); await renderCampaignLibrary(d, target, page); });
    } catch (error) { toast(error.message); }
  };
}
function pager(r) {
  return r.total > r.pageSize ? `<div class="pagination">${button("← Anterior", "ca-page", r.page - 1, "subtle", r.page <= 1 ? "disabled" : "")}<span>Página ${r.page} de ${Math.ceil(r.total / r.pageSize)}</span>${button("Próxima →", "ca-page", r.page + 1, "subtle", r.page * r.pageSize >= r.total ? "disabled" : "")}</div>` : "";
}
function textModal(d, item, reload) {
  modal(item ? "Editar texto da campanha" : "Novo texto da campanha", `<form id="ca-form"><div class="field"><label for="ca-title">Nome</label><input id="ca-title" name="title" maxlength="120" required value="${esc(item?.title || "")}"></div><div class="field"><label for="ca-text">Texto de apoio</label><textarea id="ca-text" name="text" rows="8" maxlength="10000" required>${esc(item?.text || "")}</textarea></div><label class="check"><input type="checkbox" name="published" ${item?.published ? "checked" : ""}> Visível aos jogadores</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar texto</button></div></form>`);
  $("#ca-title").focus();
  $("#ca-form").onsubmit = event => { event.preventDefault(); submitForm(event.currentTarget, async data => { await api(`${base(d)}/library${item ? "/" + item.id : ""}`, item ? "PUT" : "POST", { title: data.title, text: data.text, published: data.published === "on", revision: item?.revision || 0 }); $("#modal").close(); toast("Texto salvo."); await reload(); }); };
}
function confirmDelete(title, action) {
  modal(title, `<p>Esta ação remove o recurso da campanha.</p><form id="ca-delete-form">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="danger" type="submit">Excluir</button></div></form>`);
  $("#ca-delete-form").onsubmit = e => { e.preventDefault(); submitForm(e.currentTarget, async () => { await action(); $("#modal").close(); }); };
}
const ICON = {
  root: '<svg class="fx-icon fx-root-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="fx-map" d="M3 6.2 8.6 4l6.8 2.4L21 4.2v13.6L15.4 20l-6.8-2.4L3 19.8z"/><path class="fx-fold" d="M8.6 4v13.6M15.4 6.4V20"/></svg>',
  folder: '<svg class="fx-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="fx-back" d="M2.5 6A1.5 1.5 0 0 1 4 4.5h5l2 2h9A1.5 1.5 0 0 1 21.5 8v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18z"/><path class="fx-front" d="M2.5 9.5h19V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18z"/></svg>',
  open: '<svg class="fx-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="fx-back" d="M2.5 6A1.5 1.5 0 0 1 4 4.5h5l2 2h9A1.5 1.5 0 0 1 21.5 8v2H6.4a1.6 1.6 0 0 0-1.5 1.1L2.5 18z"/><path class="fx-front" d="M6.4 10.5h15.5a.9.9 0 0 1 .9 1.2l-2.3 6.7a1.6 1.6 0 0 1-1.5 1.1H3.4a.9.9 0 0 1-.9-1.2l2.4-6.7a1.6 1.6 0 0 1 1.5-1.1z"/></svg>',
  chevron: '<svg class="fx-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>',
};
const ROOT_NAME = "Mapas e cenários";
const openFolders = new Map(); // campanha -> pastas expandidas na árvore (somente estado visual)
const runs = new WeakMap();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const decimal = n => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function treeNode(folder, children, open, currentId, depth) {
  const kids = children.get(folder.id) || [], expanded = open.has(folder.id) && kids.length > 0, current = folder.id === currentId;
  const twisty = kids.length
    ? `<button type="button" class="fx-twisty" data-action="ca-toggle" data-id="${esc(folder.id)}" aria-expanded="${expanded}" aria-label="${expanded ? "Recolher" : "Expandir"} ${esc(folder.name)}">${ICON.chevron}</button>`
    : '<span class="fx-twisty" aria-hidden="true"></span>';
  return `<li><div class="fx-row${current ? " current" : ""}">${twisty}<button type="button" class="fx-node" data-action="ca-open" data-id="${esc(folder.id)}"${current ? ' aria-current="true"' : ""}>${current || expanded ? ICON.open : ICON.folder}<span>${esc(folder.name)}</span></button></div>${expanded && depth < 8 ? `<ul class="fx-group">${kids.map(k => treeNode(k, children, open, currentId, depth + 1)).join("")}</ul>` : ""}</li>`;
}
function treeHtml(children, open, currentId) {
  const top = children.get("") || [];
  return `<ul class="fx-tree"><li><div class="fx-row fx-root${currentId ? "" : " current"}"><button type="button" class="fx-node" data-action="ca-open" data-id=""${currentId ? "" : ' aria-current="true"'}>${ICON.root}<span>${ROOT_NAME}</span></button></div>${top.length ? `<ul class="fx-group">${top.map(f => treeNode(f, children, open, currentId, 1)).join("")}</ul>` : ""}</li></ul>`;
}

export async function renderCampaignMaps(d, target, folderId = "", page = 1) {
  const run = (runs.get(target) || 0) + 1; runs.set(target, run);
  const pane = target.querySelector(".fx-pane");
  if (pane) pane.setAttribute("aria-busy", "true");
  else target.innerHTML = '<p role="status">Abrindo mapas e cenários…</p>';
  let result, catalog;
  try { [result, catalog] = await Promise.all([
    api(`${base(d)}/maps?${new URLSearchParams({ ...(folderId ? { folderId } : {}), page })}`),
    api(`/campaigns/${d.id}/maps`),
  ]); }
  finally { if (target.isConnected && runs.get(target) === run) target.querySelector(".fx-pane")?.removeAttribute("aria-busy"); }
  if (!target.isConnected || runs.get(target) !== run) return;
  const children = folderTree(result.folders), path = folderPath(result.folders, folderId), current = path.at(-1);
  const official = catalog.items.filter(m => !m.key.startsWith("resource:"));
  if (!openFolders.has(d.id)) openFolders.set(d.id, new Set());
  const open = openFolders.get(d.id);
  for (const f of path) open.add(f.id);
  const subfolders = children.get(folderId) || [];
  const crumbs = [current
    ? `<li><button type="button" class="fx-crumb" data-action="ca-open" data-id="">${ICON.root}<span>${ROOT_NAME}</span></button></li>`
    : `<li><span class="fx-crumb" aria-current="location">${ICON.root}<span>${ROOT_NAME}</span></span></li>`]
    .concat(path.map((f, i) => i === path.length - 1
      ? `<li><span class="fx-crumb" aria-current="location">${ICON.open}<span>${esc(f.name)}</span></span></li>`
      : `<li><button type="button" class="fx-crumb" data-action="ca-open" data-id="${esc(f.id)}">${ICON.folder}<span>${esc(f.name)}</span></button></li>`));
  const canDelete = current && !subfolders.length && !result.total;
  const folderTiles = subfolders.map(f => { const n = (children.get(f.id) || []).length; return `<li><button type="button" class="fx-tile fx-folder-tile" data-action="ca-open" data-id="${esc(f.id)}">${ICON.folder}<strong>${esc(f.name)}</strong><small>${n ? plural(n, "subpasta", "subpastas") : "Pasta"}</small></button></li>`; }).join("");
  const mapTiles = result.items.map(m => `<li><article class="fx-tile fx-map-tile"><div class="fx-thumb"><img src="${esc(m.imageUrl)}" alt="" loading="lazy"></div><div class="fx-meta"><strong>${esc(m.name)}</strong><small>${m.pixelWidth}×${m.pixelHeight} px · ${m.hasGrid === false ? "apenas imagem (sem grade)" : `${m.gridPixels} px/quadro${m.gridOffsetX || m.gridOffsetY ? ` · deslocada ${m.gridOffsetX}/${m.gridOffsetY} px` : ""} · ${decimal(m.scaleMeters)} m`}</small></div><div class="fx-tile-actions">${d.activeSession ? button("Mostrar na mesa", "ca-show", m.key, "primary small") : ""}${m.hasGrid === false ? "" : button("☼ Névoa e luz", "ca-fog", m.key, "subtle small", `aria-label="Preparar névoa e luz de ${esc(m.name)}"`)}${button("Editar / mover", "ca-map-edit", m.id, "subtle small")}${button("Excluir", "ca-map-delete", m.id, "subtle small", `aria-label="Excluir ${esc(m.name)}"`)}</div></article></li>`).join("");
  target.innerHTML = `<div class="section-title fx-title"><h2>${ROOT_NAME}</h2>${helpButton("campanhas.acervo.mapas", "Mapas e escala")}<div class="fx-actions">${button("+ Nova pasta", "ca-folder", "", "subtle")}${button("+ Enviar mapa", "ca-upload", "", "primary")}</div></div><p class="muted small">PNG/JPEG até 10 MB; 64–4.096 pixels por lado, até 8 milhões de pixels. Use como imagem sem grade ou ajuste a grade sobre a prévia. A mesma imagem pode servir a várias cenas, sem duplicar o arquivo.</p>
<div class="fx-explorer metal"><nav class="fx-sidebar" aria-label="Pastas de mapas e cenários">${treeHtml(children, open, folderId)}</nav>
<section class="fx-pane" aria-label="Conteúdo da pasta"><div class="fx-toolbar">${button("↑", "ca-open", current?.parentId || "", "fx-up", `aria-label="Subir para a pasta anterior"${current ? "" : " disabled"}`)}<nav class="fx-path" aria-label="Caminho da pasta"><ol>${crumbs.join("")}</ol></nav><span class="fx-count">${plural(subfolders.length, "pasta", "pastas")} · ${plural(result.total, "mapa", "mapas")}</span>${current ? button("Excluir pasta", "ca-folder-delete", current.id, "subtle small", canDelete ? "" : 'aria-disabled="true" data-tip="Esvazie a pasta antes de excluir."') : ""}</div>
${subfolders.length || result.items.length ? `<ul class="fx-grid" aria-label="Pastas e mapas">${folderTiles}${mapTiles}</ul>` : `<div class="fx-empty">${ICON.open}<p><strong>Esta pasta está vazia.</strong><span>Envie um mapa ou crie uma subpasta para organizar seus cenários.</span></p></div>`}${pager(result)}</section></div>
<div class="fx-footer">${d.activeSession ? button("Ocultar mapa na mesa", "ca-hide", "", "subtle") : '<p class="muted small">Abra uma sessão para mostrar seus mapas na mesa.</p>'}</div>`;
  const atlas = document.createElement("details");
  atlas.className = "official-atlas metal";
  atlas.open = !folderId;
  atlas.innerHTML = `<summary><span>Atlas do Eternnus</span><small>${official.length} cenários prontos · incluídos para toda mesa</small></summary>${helpButton("progresso.atlas.cenarios", "Atlas do Eternnus")}<p class="muted small">Locais sem trama ou sistema obrigatório. Adapte nomes, habitantes e objetivos à sua história.</p><div class="atlas-grid">${official.map(m => `<article class="atlas-card"><div class="map-preview" data-official-map="${esc(m.key)}"></div><div><span class="eyebrow">${m.kind === "tileset" ? `${m.rows[0].length} × ${m.rows.length} CASAS` : "CARTOGRAFIA"}</span><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><div class="atlas-actions">${m.kind === "tileset" ? button("☼ Névoa e luz", "ca-fog", m.key, "subtle", `aria-label="Preparar névoa e luz de ${esc(m.name)}"`) : ""}${d.activeSession ? button("Mostrar na mesa", "ca-show", m.key, "subtle") : '<small>Disponível ao abrir uma sessão</small>'}</div></div></article>`).join("")}</div>`;
  target.querySelector(".fx-explorer").before(atlas);
  atlas.querySelectorAll("[data-official-map]").forEach(el => mapThumbnail(el, official.find(m => m.key === el.dataset.officialMap)));
  const trail = target.querySelector(".fx-path ol");
  trail.scrollLeft = trail.scrollWidth; // no celular o caminho rola em uma linha; mostra a pasta atual
  const reload = () => renderCampaignMaps(d, target, folderId, page);
  target.onclick = async event => {
    const b = event.target.closest("[data-action]"); if (!b || b.disabled) return;
    try {
      const action = b.dataset.action, id = b.dataset.id;
      if (action === "ca-toggle") {
        open.has(id) ? open.delete(id) : open.add(id);
        target.querySelector(".fx-sidebar").innerHTML = treeHtml(children, open, folderId);
        target.querySelector(`.fx-twisty[data-id="${CSS.escape(id)}"]`)?.focus();
      }
      if (action === "ca-open") await renderCampaignMaps(d, target, id);
      if (action === "ca-fog") await (await import("./fog-editor.js")).openLayerEditor(d, id);
      if (action === "ca-page") await renderCampaignMaps(d, target, folderId, Number(id));
      if (action === "ca-folder") folderModal(d, folderId, current, reload);
      if (action === "ca-upload") mapModal(d, null, result.folders, folderId, reload);
      if (action === "ca-map-edit") mapModal(d, result.items.find(m => m.id === id), result.folders, folderId, reload);
      if (action === "ca-map-delete" || action === "ca-folder-delete") confirmDelete(action === "ca-map-delete" ? "Excluir mapa?" : "Excluir pasta?", async () => { await api(`${base(d)}/${action === "ca-map-delete" ? "maps" : "folders"}/${id}`, "DELETE"); await renderCampaignMaps(d, target, action === "ca-folder-delete" ? current?.parentId || "" : folderId); });
      if (action === "ca-show" || action === "ca-hide") { await api(`/sessions/${d.activeSession.id}/map`, "POST", { mapKind: action === "ca-hide" ? "cartographic" : official.find(m => m.key === id)?.kind || "tileset", mapKey: action === "ca-hide" ? "valley" : id }); toast(action === "ca-hide" ? "Mapa da campanha ocultado. A mesa exibe o cenário oficial." : "Mapa mostrado para a mesa."); }
    } catch (error) { toast(error.message); }
  };
}
function folderModal(d, parentId, parent, reload) {
  modal("Nova pasta", `<p class="muted small">Dentro de: ${esc(parent?.name || ROOT_NAME)}</p><form id="ca-form"><div class="field"><label for="ca-name">Nome da pasta</label><input id="ca-name" name="name" required maxlength="100"></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Criar pasta</button></div></form>`);
  $("#ca-name").focus(); $("#ca-form").onsubmit = e => { e.preventDefault(); submitForm(e.currentTarget, async data => { await api(`${base(d)}/folders`, "POST", { name: data.name, parentId: parentId || null }); $("#modal").close(); await reload(); }); };
}
function mapModal(d, item, folders, folderId, reload) {
  const hasGrid = item ? item.hasGrid !== false : true;
  modal(item ? "Configurar mapa" : "Enviar mapa", `<form id="ca-form" class="map-upload"><div class="field"><label for="ca-name">Nome do mapa</label><input id="ca-name" name="name" required maxlength="120" value="${esc(item?.name || "")}"></div>${item ? "" : '<div class="field"><label for="ca-image">Imagem PNG ou JPEG (até 10 MB)</label><input id="ca-image" type="file" name="file" accept="image/png,image/jpeg" required><small class="form-help">A imagem só sai do seu aparelho ao salvar.</small></div>'}<fieldset class="grid-choice"><legend>Como usar a imagem</legend><label class="check se-option"><input type="radio" name="useGrid" value="no" ${hasGrid ? "" : "checked"}><span><strong>Apenas imagem</strong><small>Para mostrar ao grupo, sem casas, marcadores ou névoa.</small></span></label><label class="check se-option"><input type="radio" name="useGrid" value="yes" ${hasGrid ? "checked" : ""}><span><strong>Usar grade</strong><small>Personagens andam por casas; dá para usar paredes, luz e névoa.</small></span></label></fieldset><div data-grid-host ${hasGrid ? "" : "hidden"}><p class="form-help" data-grid-wait>${item ? "" : "Escolha a imagem para ver a prévia da grade."}</p></div><div class="field"><label for="ca-location">Pasta</label><select id="ca-location" name="folderId"><option value="">${ROOT_NAME}</option>${flattenFolders(folderTree(folders)).map(f => `<option value="${esc(f.id)}" ${f.id === (item?.folderId || folderId) ? "selected" : ""}>${"   ".repeat(f.depth + 1)}${esc(f.name)}</option>`).join("")}</select></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar mapa</button></div></form>`);
  $("#modal").classList.add("wide");
  const form = $("#ca-form");
  const host = form.querySelector("[data-grid-host]");
  let adjust = null, objectUrl = "", valid = true;
  const mount = async (src) => {
    const { gridAdjustHtml, mountGridAdjust } = await import("./grid-adjust.js");
    const { interfaceMode } = await import("./interface-mode.js");
    adjust?.dispose();
    host.innerHTML = gridAdjustHtml("ca-g", item || {}, { complete: interfaceMode() === "complete" });
    adjust = mountGridAdjust(host, src, { onChange: (v) => { valid = v.valid; } });
  };
  if (item) mount(item.imageUrl);
  form.addEventListener("change", e => {
    if (e.target.name === "useGrid") host.hidden = e.target.value !== "yes";
    if (e.target.name === "file" && e.target.files?.[0]) { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(e.target.files[0]); mount(objectUrl); }
  });
  $("#modal").addEventListener("close", () => { adjust?.dispose(); if (objectUrl) URL.revokeObjectURL(objectUrl); $("#modal").classList.remove("wide"); }, { once: true });
  $("#ca-name").focus();
  form.onsubmit = e => { e.preventDefault(); submitForm(form, async data => {
    const grid = data.useGrid === "yes";
    const v = adjust?.values() || { gridPixels: item?.gridPixels || 64, gridOffsetX: 0, gridOffsetY: 0 };
    if (grid && adjust && !valid) throw new Error("Ajuste a grade: " + (host.querySelector("[data-grid-summary]")?.textContent || "valores inválidos."));
    const scale = Number(form.querySelector("[name=scaleMeters]")?.value || item?.scaleMeters || 1.5);
    if (item) await api(`${base(d)}/maps/${item.id}`, "PUT", { name: data.name, folderId: data.folderId || null, gridPixels: v.gridPixels, scaleMeters: scale, revision: item.revision, hasGrid: grid, gridOffsetX: grid ? v.gridOffsetX : 0, gridOffsetY: grid ? v.gridOffsetY : 0 });
    else {
      const file = form.querySelector("[name=file]").files?.[0];
      if (!file?.size || file.size > 10 * 1024 * 1024) throw new Error("Selecione uma imagem de até 10 MB.");
      const upload = new FormData();
      upload.append("name", data.name); upload.append("folderId", data.folderId || ""); upload.append("file", file);
      upload.append("gridPixels", String(v.gridPixels)); upload.append("scaleMeters", String(scale));
      upload.append("hasGrid", grid ? "true" : "false"); upload.append("gridOffsetX", String(grid ? v.gridOffsetX : 0)); upload.append("gridOffsetY", String(grid ? v.gridOffsetY : 0));
      await api(`${base(d)}/maps`, "POST", upload);
    }
    $("#modal").close(); toast("Mapa salvo."); await reload();
  }); };
}
