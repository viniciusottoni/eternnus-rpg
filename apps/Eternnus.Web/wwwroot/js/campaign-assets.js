import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast, empty } from "./ui.js";

const base = d => `/campaigns/${d.id}/assets`;
export async function renderCampaignLibrary(d, target, page = 1) {
  target.innerHTML = '<p role="status">Consultando a biblioteca…</p>';
  const result = await api(`${base(d)}/library?page=${page}`);
  if (!target.isConnected) return;
  target.innerHTML = `<div class="section-title"><h2>Bibliotecas</h2>${d.isMaster ? button("+ Texto da campanha", "ca-text", "", "primary") : ""}</div><div class="resource-grid"><a class="resource-card metal" href="#library/general"><h3>Biblioteca geral</h3><p>Materiais para qualquer mesa, disponíveis a qualquer momento.</p></a><a class="resource-card metal" href="#library/system/${esc(d.rpgSystemId)}"><h3>${esc(d.system)}</h3><p>Biblioteca padrão do sistema e modelos de ficha.</p></a></div><h3>Acervo da campanha</h3><p class="muted small">Textos preparados pelo mestre. ${d.isMaster ? "Rascunhos ficam visíveis apenas para você; publique quando desejar." : "O mestre escolhe quando revelar cada texto."}</p>${result.items.length ? `<div class="resource-grid">${result.items.map(x => `<article class="resource-card metal"><span class="badge">${x.published ? "Publicado" : "Rascunho"}</span><h3>${esc(x.title)}</h3><p class="resource-body">${esc(x.text)}</p>${d.isMaster ? button("Editar / publicar", "ca-text", x.id, "subtle small") + button("Excluir", "ca-delete", x.id, "subtle small") : ""}</article>`).join("")}</div>` : empty("Nenhum texto disponível.", "O acervo da campanha aparecerá aqui.")}${pager(result)}`;
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
export async function renderCampaignMaps(d, target, folderId = "", page = 1) {
  target.innerHTML = '<p role="status">Abrindo mapas…</p>';
  const result = await api(`${base(d)}/maps?${new URLSearchParams({ ...(folderId ? { folderId } : {}), page })}`);
  if (!target.isConnected) return;
  const current = result.folders.find(f => f.id === folderId);
  const path = []; let at = current;
  while (at && path.length < 8) { path.unshift(at.name); at = result.folders.find(f => f.id === at.parentId); }
  target.innerHTML = `<div class="section-title"><h2>Mapas da campanha</h2>${button("+ Enviar mapa", "ca-upload", "", "primary")}${button("+ Pasta", "ca-folder", "", "subtle")}</div><p class="muted small">PNG/JPEG até 10 MB; 64–4.096 pixels por lado, até 8 milhões de pixels. Grade e escala definidas pelo mestre.</p><nav aria-label="Pastas de mapas">${button("Raiz", "ca-open", "", "subtle small")} <span>${esc(path.join(" / "))}</span>${current ? button("↑ Pasta anterior", "ca-open", current.parentId || "", "subtle small") + button("Excluir pasta vazia", "ca-folder-delete", current.id, "subtle small") : ""}</nav><div class="resource-grid">${result.folders.filter(f => (f.parentId || "") === folderId).map(f => button("▣ " + f.name, "ca-open", f.id, "subtle")).join("")}${result.items.map(m => `<article class="resource-card metal"><img class="map-image" src="${esc(m.imageUrl)}" alt="${esc(m.name)}" loading="lazy"><h3>${esc(m.name)}</h3><p class="small">${m.gridPixels} px por quadrado · ${m.scaleMeters} m por quadrado</p>${button("Editar / mover", "ca-map-edit", m.id, "subtle small")}${d.activeSession ? button("Mostrar na mesa", "ca-show", m.key, "primary small") : ""}${button("Excluir", "ca-map-delete", m.id, "subtle small")}</article>`).join("")}</div>${!result.items.length ? '<p class="muted">Nenhum mapa nesta pasta.</p>' : ""}${pager(result)}${d.activeSession ? button("Ocultar mapa na mesa", "ca-hide", "", "subtle") : '<p class="muted small">Abra uma sessão para mostrar seus mapas na mesa.</p>'}`;
  const reload = () => renderCampaignMaps(d, target, folderId, page);
  target.onclick = async event => {
    const b = event.target.closest("[data-action]"); if (!b) return;
    try {
      const action = b.dataset.action, id = b.dataset.id;
      if (action === "ca-open") await renderCampaignMaps(d, target, id);
      if (action === "ca-page") await renderCampaignMaps(d, target, folderId, Number(id));
      if (action === "ca-folder") folderModal(d, folderId, reload);
      if (action === "ca-upload") mapModal(d, null, result.folders, folderId, reload);
      if (action === "ca-map-edit") mapModal(d, result.items.find(m => m.id === id), result.folders, folderId, reload);
      if (action === "ca-map-delete" || action === "ca-folder-delete") confirmDelete("Excluir recurso?", async () => { await api(`${base(d)}/${action === "ca-map-delete" ? "maps" : "folders"}/${id}`, "DELETE"); await renderCampaignMaps(d, target, action === "ca-folder-delete" ? current?.parentId || "" : folderId); });
      if (action === "ca-show" || action === "ca-hide") { await api(`/sessions/${d.activeSession.id}/map`, "POST", { mapKind: action === "ca-hide" ? "cartographic" : "tileset", mapKey: action === "ca-hide" ? "valley" : id }); toast(action === "ca-hide" ? "Mapa da campanha ocultado. A mesa exibe o cenário oficial." : "Mapa mostrado para a mesa."); }
    } catch (error) { toast(error.message); }
  };
}
function folderModal(d, parentId, reload) {
  modal("Criar pasta", `<form id="ca-form"><div class="field"><label for="ca-name">Nome da pasta</label><input id="ca-name" name="name" required maxlength="100"></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Criar pasta</button></div></form>`);
  $("#ca-name").focus(); $("#ca-form").onsubmit = e => { e.preventDefault(); submitForm(e.currentTarget, async data => { await api(`${base(d)}/folders`, "POST", { name: data.name, parentId: parentId || null }); $("#modal").close(); await reload(); }); };
}
function mapModal(d, item, folders, folderId, reload) {
  modal(item ? "Configurar mapa" : "Enviar mapa", `<form id="ca-form"><div class="field"><label for="ca-name">Nome do mapa</label><input id="ca-name" name="name" required maxlength="120" value="${esc(item?.name || "")}"></div>${item ? "" : '<div class="field"><label for="ca-image">Imagem PNG ou JPEG (até 10 MB)</label><input id="ca-image" type="file" name="file" accept="image/png,image/jpeg" required></div>'}<div class="field"><label for="ca-grid">Lado do quadrado em pixels</label><input id="ca-grid" name="gridPixels" type="number" min="8" max="1024" required value="${item?.gridPixels || 64}"></div><div class="field"><label for="ca-scale">Metros por quadrado</label><input id="ca-scale" name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" required value="${item?.scaleMeters || 1.5}"></div><div class="field"><label for="ca-location">Pasta</label><select id="ca-location" name="folderId"><option value="">Raiz</option>${folders.map(f => `<option value="${esc(f.id)}" ${f.id === (item?.folderId || folderId) ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar mapa</button></div></form>`);
  $("#ca-name").focus(); $("#ca-form").onsubmit = e => { e.preventDefault(); const form = e.currentTarget; submitForm(form, async data => {
    if (item) await api(`${base(d)}/maps/${item.id}`, "PUT", { name: data.name, folderId: data.folderId || null, gridPixels: Number(data.gridPixels), scaleMeters: Number(data.scaleMeters), revision: item.revision });
    else { const upload = new FormData(form); const file = upload.get("file"); if (!file?.size || file.size > 10 * 1024 * 1024) throw new Error("Selecione uma imagem de até 10 MB."); await api(`${base(d)}/maps`, "POST", upload); }
    $("#modal").close(); toast("Mapa salvo."); await reload();
  }); };
}
