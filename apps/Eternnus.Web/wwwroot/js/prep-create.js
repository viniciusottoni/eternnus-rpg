// Fluxos de criação da Preparação (ADR-081): Novo mapa (do zero ou a partir de modelo), Nova cena (do zero ou a
// partir de mapa) e Novo personagem. Carregado sob demanda pelo gerenciador (prep-explorer.js).
// `ctx` = { d, folderId, folders, maps, official, sceneCount, onCreated({ type, id, open }) }.
// Modelos oficiais nunca são alterados: viram mapas próprios (tiles copiados ou imagem enviada) com `sourceKey`.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { mapThumbnail } from "./table-map.js";
import { blankTiles } from "./tile-map-policy.js";
import { gridFor } from "./scene-policy.js";
import * as P from "./prep-explorer-policy.js";
import { state } from "./state.js";
import { uploadLimit, formatBytes } from "./account-usage-policy.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 8_000_000;
const assets = () => import("./campaign-assets.js");

// ---------- Peças comuns ----------
function flatten(children, parent = "", depth = 0, out = []) {
  for (const f of children.get(parent) || []) {
    if (out.some((x) => x.id === f.id)) continue;
    out.push({ ...f, depth });
    if (depth < P.MAX_DEPTH) flatten(children, f.id, depth + 1, out);
  }
  return out;
}
/** Seletor de pasta da categoria; uma pasta de outra categoria nunca fica pré-selecionada. */
function folderField(id, ctx, category) {
  const list = flatten(P.buildTree(ctx.folders || [], category));
  return `<div class="field"><label for="${id}">Pasta</label><select id="${id}" name="folderId"><option value="">${esc(P.ROOTS[category])}</option>${list.map((f) => `<option value="${esc(f.id)}" ${f.id === ctx.folderId ? "selected" : ""}>${"   ".repeat(f.depth + 1)}${esc(f.name)}</option>`).join("")}</select></div>`;
}
const choice = (id, title, text, extra = "") => `<button type="button" class="pc-choice" data-pc="${id}" ${extra}><strong>${esc(title)}</strong><small>${esc(text)}</small></button>`;
const back = (id) => `<button type="button" class="subtle" data-pc="${id}">← Voltar</button>`;
function bindChoices(handlers) {
  const body = $("#modal-body");
  fresh();
  body.onclick = (e) => {
    const b = e.target.closest("[data-pc]");
    if (!b || !handlers[b.dataset.pc]) return;
    Promise.resolve(handlers[b.dataset.pc]()).catch((error) => toast(error.message));
  };
  setTimeout(() => body.querySelector("[data-pc]")?.focus(), 0);
}
const idOf = (saved) => saved?.id || saved?.map?.id || saved?.item?.id || null;
const closeModal = () => { if ($("#modal").open) $("#modal").close(); };
/** Campo do formulário pelo nome (sem colidir com propriedades do próprio <form>, como `name`). */
const F = (form, name) => form.elements.namedItem(name);
/** Cada etapa troca o conteúdo do diálogo: descarta o clique delegado da etapa anterior. */
const fresh = () => { $("#modal-body").onclick = null; };

/** Lista de cartões selecionáveis (listbox) com miniatura real, nome, tipo, dimensões e descrição. */
function cardsHtml(items, selectedKey, label) {
  if (!items.length) return `<p class="muted small pc-none">Nenhum mapa neste grupo${label ? "" : " com este filtro"}.</p>`;
  return `<ul class="pc-cards" role="listbox" aria-label="${esc(label || "Mapas")}">${items.map((m) => {
    const on = m.key === selectedKey;
    return `<li role="option" class="pc-card${on ? " selected" : ""}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-map="${esc(m.key)}"><div class="pc-thumb" data-pc-thumb="${esc(m.key)}" aria-hidden="true"></div><div class="pc-card-info"><strong>${esc(m.name)}</strong><small>${esc([P.mapKindLabel(m), P.mapDimensions(m)].filter(Boolean).join(" · "))}</small>${m.summary || m.description ? `<span class="pc-card-desc">${esc(m.summary || m.description)}</span>` : ""}</div></li>`;
  }).join("")}</ul>`;
}
function drawCardThumbs(host, all) {
  host.querySelectorAll("[data-pc-thumb]").forEach((el) => mapThumbnail(el, all.find((m) => m.key === el.dataset.pcThumb)));
}
/** Teclado dos cartões: setas percorrem, Enter/Espaço escolhem. */
function cardKeys(host, onPick) {
  host.addEventListener("keydown", (e) => {
    const card = e.target.closest("[data-map]");
    if (!card) return;
    const all = [...host.querySelectorAll("[data-map]")], i = all.indexOf(card);
    const n = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (n) { e.preventDefault(); const t = all[Math.max(0, Math.min(all.length - 1, i + n))]; all.forEach((c) => (c.tabIndex = -1)); t.tabIndex = 0; t.focus(); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(card.dataset.map, true); }
  });
  host.addEventListener("click", (e) => { const card = e.target.closest("[data-map]"); if (card) onPick(card.dataset.map, false); });
  host.addEventListener("dblclick", (e) => { const card = e.target.closest("[data-map]"); if (card) onPick(card.dataset.map, true); });
}

/** Imagem pública do próprio site (modelo oficial) em PNG dentro dos limites do acervo (JPEG se o PNG passar de 10 MB). */
async function rasterize(url) {
  if (!/^\/assets\/[\w./-]+\.(webp|png|jpe?g)$/i.test(String(url || ""))) throw new Error("Imagem do modelo indisponível.");
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode().catch(() => { throw new Error("Não foi possível carregar a imagem do modelo."); });
  const k = Math.min(1, 4096 / img.naturalWidth, 4096 / img.naturalHeight, Math.sqrt(MAX_PIXELS / (img.naturalWidth * img.naturalHeight)));
  const w = Math.max(64, Math.floor(img.naturalWidth * k)), h = Math.max(64, Math.floor(img.naturalHeight * k));
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (png && png.size <= MAX_BYTES) return { blob: png, fileName: "modelo.png" };
  const jpeg = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (jpeg && jpeg.size <= MAX_BYTES) return { blob: jpeg, fileName: "modelo.jpg" };
  throw new Error("A imagem do modelo passa de 10 MB.");
}

// ---------- Novo mapa ----------
/** Escolha inicial: "Criar do zero" ou "A partir de modelo". */
export function openNewMap(ctx) {
  modal("Novo mapa", `<div class="pc-flow"><p class="pc-lead">Como você quer começar?${helpButton("campanhas.mapas.novo", "Novo mapa")}</p><div class="pc-choices two">${choice("scratch", "Criar do zero", "Envie ou importe uma imagem, traga um arquivo VTT, desenhe com tiles ou comece numa área em branco.")}${choice("template", "A partir de modelo", "Copie um cenário oficial e adapte à sua história. O modelo original nunca muda.")}</div><div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}</div></div>`);
  bindChoices({ scratch: () => scratchStep(ctx), template: () => templateStep(ctx) });
}

function scratchStep(ctx) {
  modal("Novo mapa › Criar do zero", `<div class="pc-flow"><p class="pc-lead">Escolha a origem do mapa.${helpButton("campanhas.mapas.novo", "Novo mapa")}</p><div class="pc-choices">${choice("file", "Enviar imagem do dispositivo", `PNG ou JPEG até ${formatBytes(uploadLimit(state.user))}. Apenas imagem, com grade ou com movimentação livre.`)}${choice("link", "Importar por URL", "O Eternnus baixa uma cópia de um link https; os jogadores não acessam o site de origem.")}${choice("vtt", "Arquivo VTT", "Universal VTT (.dd2vtt, .uvtt, .df2vtt): imagem, grade, paredes, portas e luzes.")}${choice("tiles", "Mapa vazio com tiles", "Grade de 8 a 64 casas por lado pintada com o catálogo de tiles.")}${choice("blank", "Área em branco", "Imagem lisa do tamanho escolhido para compor no editor de mapas.")}</div><div class="form-actions">${back("back")}${button("Cancelar", "modal-close", "", "subtle")}</div></div>`);
  bindChoices({ back: () => openNewMap(ctx), file: () => uploadImage(ctx, "file"), link: () => uploadImage(ctx, "link"), vtt: () => importUvtt(ctx), tiles: () => tilesStep(ctx), blank: () => blankStep(ctx) });
}

/** Envio do aparelho ("file") ou importação por link ("link"), com todos os parâmetros do formulário de mapas. */
export async function uploadImage(ctx, source = "file") {
  fresh();
  (await assets()).openMapUpload(ctx.d, { folderId: ctx.folderId || "", folders: ctx.folders, source, onSaved: (map) => ctx.onCreated({ type: "map", id: idOf(map), open: true }) });
}

/** Importação UVTT: o mapa novo vai para a pasta aberta e o editor abre em seguida. */
export async function importUvtt(ctx) {
  const before = new Set((ctx.maps || []).map((m) => m.id));
  const { openUvttImport } = await import("./map-import.js");
  fresh();
  openUvttImport({
    campaignId: ctx.d.id,
    onDone: async () => {
      let created = null;
      try {
        const data = await api(`/campaigns/${ctx.d.id}/prep/explorer`);
        created = (data.maps || []).filter((m) => !before.has(m.id) && !P.isOfficialKey(m.key)).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
        if (created && ctx.folderId) await api(`/campaigns/${ctx.d.id}/prep/move`, "POST", { category: "maps", folderId: ctx.folderId, items: [{ type: "map", id: created.id }] });
      } catch (error) { toast(error.message); }
      await ctx.onCreated(created ? { type: "map", id: created.id, open: true } : {});
    },
  });
}

/** Mapa vazio com tiles: tamanho, terreno inicial e escala, com prévia ao vivo. */
async function tilesStep(ctx) {
  const catalog = await api(`/campaigns/${ctx.d.id}/assets/tile-catalog`);
  const min = catalog.minSide || 8, max = catalog.maxSide || 64;
  const walk = (catalog.items || []).filter((t) => t.walkable);
  const terrains = walk.filter((t) => t.group === "Terrenos").length ? walk.filter((t) => t.group === "Terrenos") : walk;
  if (!terrains.length) throw new Error("O catálogo de tiles está indisponível.");
  const ground = terrains.find((t) => t.code === ",")?.code || terrains[0].code;
  modal("Novo mapa › Mapa vazio com tiles", `<form id="pc-tiles" class="pc-form"><div class="pc-form-grid"><div><div class="field"><label for="pc-t-name">Nome do mapa</label><input id="pc-t-name" name="name" required maxlength="120"></div><div class="field"><label for="pc-t-sum">Descrição</label><textarea id="pc-t-sum" name="summary" maxlength="500" rows="2"></textarea></div>${folderField("pc-t-folder", ctx, "maps")}<div class="form-grid two"><div class="field"><label for="pc-t-w">Colunas</label><input id="pc-t-w" name="width" type="number" min="${min}" max="${max}" step="1" value="28" required></div><div class="field"><label for="pc-t-h">Linhas</label><input id="pc-t-h" name="height" type="number" min="${min}" max="${max}" step="1" value="20" required></div></div><div class="form-grid two"><div class="field"><label for="pc-t-ground">Terreno inicial</label><select id="pc-t-ground" name="ground">${terrains.map((t) => `<option value="${esc(t.code)}" ${t.code === ground ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div><div class="field"><label for="pc-t-scale">Metros por casa</label><input id="pc-t-scale" name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" value="1.5" required></div></div><p class="form-help">De ${min} a ${max} casas por lado. Seis entradas do grupo já vêm marcadas; ajuste tudo no editor.</p></div><figure class="pc-preview-box"><div class="pc-preview" data-pc-preview aria-hidden="true"></div><figcaption class="muted small" data-pc-caption></figcaption></figure></div>${formError()}<div class="form-actions">${back("back")}<button type="submit" class="primary">Criar e abrir o editor</button></div></form>`);
  $("#modal").classList.add("wide");
  fresh();
  const form = $("#pc-tiles"), preview = form.querySelector("[data-pc-preview]"), caption = form.querySelector("[data-pc-caption]");
  const size = () => ({ w: Math.trunc(Number(F(form, "width").value)), h: Math.trunc(Number(F(form, "height").value)) });
  const valid = ({ w, h }) => w >= min && w <= max && h >= min && h <= max;
  let frame = 0;
  const draw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const s = size();
      if (!valid(s)) { caption.textContent = `Use de ${min} a ${max} casas por lado.`; return; }
      mapThumbnail(preview, { kind: "tileset", rows: blankTiles(s.w, s.h, F(form, "ground").value) });
      caption.textContent = `${s.w} × ${s.h} casas`;
    });
  };
  form.addEventListener("input", draw);
  draw();
  $("#pc-t-name").focus();
  form.querySelector('[data-pc="back"]').onclick = () => scratchStep(ctx);
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const s = size();
      if (!valid(s)) throw new Error(`Use de ${min} a ${max} casas por lado.`);
      const saved = await api(`/campaigns/${ctx.d.id}/assets/tile-maps`, "POST", { name: String(data.name).trim(), summary: String(data.summary || "").trim(), folderId: data.folderId || null, scaleMeters: Number(data.scaleMeters), rows: blankTiles(s.w, s.h, data.ground), revision: 0 });
      closeModal();
      await ctx.onCreated({ type: "map", id: idOf(saved), open: true });
    });
  };
}

/** Área em branco: imagem lisa (PNG gerado no navegador) enviada pelo mesmo caminho do envio de imagens. */
function blankStep(ctx) {
  modal("Novo mapa › Área em branco", `<form id="pc-blank" class="pc-form"><div class="pc-form-grid"><div><div class="field"><label for="pc-b-name">Nome do mapa</label><input id="pc-b-name" name="name" required maxlength="120"></div><div class="field"><label for="pc-b-sum">Descrição</label><textarea id="pc-b-sum" name="summary" maxlength="500" rows="2"></textarea></div>${folderField("pc-b-folder", ctx, "maps")}<div class="form-grid two"><div class="field"><label for="pc-b-w">Largura (px)</label><input id="pc-b-w" name="width" type="number" min="64" max="4096" step="1" value="1536" required></div><div class="field"><label for="pc-b-h">Altura (px)</label><input id="pc-b-h" name="height" type="number" min="64" max="4096" step="1" value="1024" required></div></div><div class="field"><label for="pc-b-color">Cor de fundo</label><input id="pc-b-color" name="background" type="color" value="#1b1a17"></div><fieldset class="grid-choice"><legend>Como usar o mapa</legend><label class="check se-option"><input type="radio" name="useGrid" value="no"><span><strong>Apenas imagem</strong><small>Sem casas, marcadores ou névoa.</small></span></label><label class="check se-option"><input type="radio" name="useGrid" value="yes" checked><span><strong>Usar grade</strong><small>Personagens andam por casas.</small></span></label><label class="check se-option"><input type="radio" name="useGrid" value="free"><span><strong>Movimentação livre</strong><small>Marcadores em qualquer ponto; a grade vira referência.</small></span></label></fieldset><div class="form-grid two" data-pc-grid><div class="field"><label for="pc-b-grid">Pixels por casa</label><input id="pc-b-grid" name="gridPixels" type="number" min="8" max="1024" step="1" value="64"></div><div class="field"><label for="pc-b-scale">Metros por casa</label><input id="pc-b-scale" name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" value="1.5"></div></div></div><figure class="pc-preview-box"><canvas class="pc-preview pc-swatch" width="320" height="200" data-pc-swatch aria-hidden="true"></canvas><figcaption class="muted small" data-pc-caption role="status"></figcaption></figure></div>${formError()}<div class="form-actions">${back("back")}<button type="submit" class="primary">Criar e abrir o editor</button></div></form>`);
  $("#modal").classList.add("wide");
  fresh();
  const form = $("#pc-blank"), swatch = form.querySelector("[data-pc-swatch]"), caption = form.querySelector("[data-pc-caption]");
  const read = () => {
    const w = Math.trunc(Number(F(form, "width").value)), h = Math.trunc(Number(F(form, "height").value));
    const use = form.querySelector("[name=useGrid]:checked")?.value || "yes";
    const px = Math.trunc(Number(F(form, "gridPixels").value));
    let error = "";
    if (!(w >= 64 && w <= 4096 && h >= 64 && h <= 4096)) error = "Use de 64 a 4.096 pixels por lado.";
    else if (w * h > MAX_PIXELS) error = "A área passa de 8 milhões de pixels.";
    const grid = use !== "no" && !error ? gridFor(w, h, px, 0, 0) : null;
    if (grid && !grid.valid) error = grid.message;
    return { w, h, use, px, grid, error };
  };
  const draw = () => {
    const v = read();
    form.querySelector("[data-pc-grid]").hidden = v.use === "no";
    caption.textContent = v.error || `${v.w} × ${v.h} px${v.grid ? ` · ${v.grid.message}` : ""}`;
    if (v.error) return;
    const k = Math.min(320 / v.w, 200 / v.h);
    swatch.width = Math.max(1, Math.round(v.w * k)); swatch.height = Math.max(1, Math.round(v.h * k));
    const g = swatch.getContext("2d");
    g.fillStyle = F(form, "background").value; g.fillRect(0, 0, swatch.width, swatch.height);
    if (v.grid) {
      g.strokeStyle = "rgba(241,215,156,.35)"; g.lineWidth = 1; g.beginPath();
      for (let x = 0; x <= v.grid.width; x++) { const sx = Math.round(x * v.px * k) + 0.5; g.moveTo(sx, 0); g.lineTo(sx, v.grid.height * v.px * k); }
      for (let y = 0; y <= v.grid.height; y++) { const sy = Math.round(y * v.px * k) + 0.5; g.moveTo(0, sy); g.lineTo(v.grid.width * v.px * k, sy); }
      g.stroke();
    }
  };
  form.addEventListener("input", draw);
  form.addEventListener("change", draw);
  draw();
  $("#pc-b-name").focus();
  form.querySelector('[data-pc="back"]').onclick = () => scratchStep(ctx);
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const v = read();
      if (v.error) throw new Error(v.error);
      const canvas = Object.assign(document.createElement("canvas"), { width: v.w, height: v.h });
      const g = canvas.getContext("2d");
      g.fillStyle = data.background || "#1b1a17"; g.fillRect(0, 0, v.w, v.h);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("O navegador não conseguiu gerar a imagem.");
      const saved = await (await assets()).uploadMapImage(ctx.d, {
        blob, fileName: "area.png", name: String(data.name).trim(), summary: String(data.summary || "").trim(), folderId: data.folderId || null,
        gridPixels: v.use === "no" ? 64 : v.px, scaleMeters: Number(data.scaleMeters) || 1.5, hasGrid: v.use !== "no", freeMovement: v.use === "free",
      });
      closeModal();
      await ctx.onCreated({ type: "map", id: idOf(saved), open: true });
    });
  };
}

/** Catálogo dos modelos oficiais: miniaturas reais, busca, filtro por tipo, prévia ampliada, nome e pasta. */
function templateStep(ctx) {
  const all = P.officialTemplates(ctx.official);
  let query = "", type = "", selected = all[0]?.key || "";
  modal("Novo mapa › A partir de modelo", `<div class="pc-catalog"><div class="pc-filters"><div class="field"><label for="pc-m-q">Buscar modelo</label><input id="pc-m-q" type="search" maxlength="60" autocomplete="off" data-no-count></div><div class="field"><label for="pc-m-type">Tipo</label><select id="pc-m-type"><option value="">Todos</option><option value="tiles">Modelos de tiles</option><option value="image">Cartografia</option></select></div><p class="muted small pc-atlas-note">Cenários prontos do Eternnus, sem trama obrigatória.${helpButton("progresso.atlas.cenarios", "Atlas do Eternnus")}</p></div><div class="pc-catalog-body"><div class="pc-list" data-pc-list></div><form id="pc-template" class="pc-side"><div class="pc-big" data-pc-big aria-hidden="true"></div><p class="small" data-pc-about role="status"></p><div class="field"><label for="pc-m-name">Nome do mapa</label><input id="pc-m-name" name="name" required maxlength="120"></div><div class="field"><label for="pc-m-sum">Descrição</label><textarea id="pc-m-sum" name="summary" maxlength="500" rows="2"></textarea></div>${folderField("pc-m-folder", ctx, "maps")}<p class="form-help">Um modelo de tiles vira um mapa de tiles editável; a cartografia vira um mapa de imagem. O original não muda.</p>${formError()}<div class="form-actions">${back("back")}<button type="submit" class="primary">Criar e abrir o editor</button></div></form></div></div>`);
  $("#modal").classList.add("wide");
  fresh();
  const list = $("#modal-body [data-pc-list]"), form = $("#pc-template");
  const current = () => all.find((m) => m.key === selected);
  const paintSide = (fillName) => {
    const m = current();
    form.querySelector("[data-pc-about]").textContent = m ? `${m.name} — ${[P.mapKindLabel(m), P.mapDimensions(m)].filter(Boolean).join(" · ")}. ${m.description || ""}` : "Escolha um modelo.";
    if (m) mapThumbnail(form.querySelector("[data-pc-big]"), m); else form.querySelector("[data-pc-big]").replaceChildren();
    if (m && fillName) { F(form, "name").value = m.name; F(form, "summary").value = m.description || ""; }
  };
  const paintList = () => {
    const items = P.mapPickerGroups([], all, { query, type })[2].items;
    list.innerHTML = cardsHtml(items, selected, "Modelos oficiais");
    if (items.length && !items.some((m) => m.key === selected)) list.querySelector("[data-map]").tabIndex = 0;
    drawCardThumbs(list, all);
  };
  cardKeys(list, (key, confirm) => {
    selected = key;
    list.querySelectorAll("[data-map]").forEach((c) => { const on = c.dataset.map === key; c.classList.toggle("selected", on); c.setAttribute("aria-selected", String(on)); c.tabIndex = on ? 0 : -1; });
    paintSide(true);
    if (confirm) F(form, "name").focus();
  });
  $("#pc-m-q").addEventListener("input", (e) => { query = e.target.value; paintList(); });
  $("#pc-m-type").addEventListener("change", (e) => { type = e.target.value; paintList(); });
  form.querySelector('[data-pc="back"]').onclick = () => openNewMap(ctx);
  paintList(); paintSide(true);
  $("#pc-m-q").focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const m = current();
      if (!m) throw new Error("Escolha um modelo.");
      const common = { name: String(data.name).trim(), summary: String(data.summary || "").trim().slice(0, 500), folderId: data.folderId || null };
      let saved;
      if (m.kind === "tileset" && Array.isArray(m.rows) && m.rows.length) {
        saved = await api(`/campaigns/${ctx.d.id}/assets/tile-maps`, "POST", { ...common, scaleMeters: 1.5, rows: [...m.rows], revision: 0, sourceKey: m.key });
      } else {
        const image = await rasterize(m.imageUrl || "/assets/valley.webp");
        saved = await (await assets()).uploadMapImage(ctx.d, { ...image, ...common, gridPixels: 64, scaleMeters: 1.5, hasGrid: false, sourceKey: m.key });
      }
      closeModal();
      toast("Mapa criado a partir do modelo.");
      await ctx.onCreated({ type: "map", id: idOf(saved), open: true });
    });
  };
}

// ---------- Nova cena ----------
/** Escolha inicial: "Do zero" (editor de cena sem mapa) ou "A partir de mapa". */
export function openNewScene(ctx) {
  modal("Nova cena", `<div class="pc-flow"><p class="pc-lead">Como você quer começar?${helpButton("campanhas.cenas.nova", "Nova cena")}</p><div class="pc-choices two">${choice("scratch", "Do zero", "Abre o editor de cena; escolha depois se ela é textual ou visual e qual mapa usar.")}${choice("map", "A partir de mapa", "Escolha um mapa da campanha ou um modelo oficial. A cena usa o mapa sem copiar a imagem.")}</div><div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}</div></div>`);
  bindChoices({
    scratch: async () => {
      closeModal();
      const result = await (await import("./scene-editor.js")).openSceneEditor({ campaign: ctx.d, sceneId: null, folderId: ctx.folderId || null, kind: "map" });
      await ctx.onCreated(result?.id ? { type: "scene", id: result.id } : {});
    },
    map: () => sceneFromMapFlow(ctx),
  });
}

/**
 * Seletor visual em três grupos (nesta ordem): mapas da campanha criados do zero/importados, mapas criados de
 * modelos e modelos oficiais. Com `preset`, o mapa já vem escolhido (ação "Criar cena a partir deste mapa").
 */
export function sceneFromMapFlow(ctx, preset = null) {
  const campaign = (ctx.maps || []).filter((m) => !P.isOfficialKey(m.key));
  const official = P.officialTemplates(ctx.official);
  const all = [...campaign, ...official];
  let query = "", type = "", selected = preset?.key || "";
  modal("Nova cena › A partir de mapa", `<div class="pc-catalog"><div class="pc-filters"><div class="field"><label for="pc-s-q">Buscar mapa</label><input id="pc-s-q" type="search" maxlength="60" autocomplete="off" data-no-count></div><div class="field"><label for="pc-s-type">Tipo</label><select id="pc-s-type"><option value="">Todos</option><option value="grid">Com grade</option><option value="image">Sem grade</option><option value="tiles">Tiles</option></select></div><p class="muted small">A cena referencia o mapa: editar o mapa depois muda todas as cenas que o usam.${helpButton("campanhas.cenas.nova", "Nova cena")}</p></div><div class="pc-catalog-body"><div class="pc-list" data-pc-list></div><form id="pc-scene" class="pc-side"><div class="pc-big" data-pc-big aria-hidden="true"></div><p class="small" data-pc-about role="status"></p><div class="field"><label for="pc-s-name">Nome da cena</label><input id="pc-s-name" name="name" required maxlength="${P.NAME_LIMITS.scene}"></div>${folderField("pc-s-folder", ctx, "scenes")}${formError()}<div class="form-actions">${preset ? button("Cancelar", "modal-close", "", "subtle") : back("back")}<button type="submit" class="primary">Criar e abrir a cena</button></div></form></div></div>`);
  $("#modal").classList.add("wide");
  fresh();
  const list = $("#modal-body [data-pc-list]"), form = $("#pc-scene");
  const current = () => all.find((m) => m.key === selected);
  const paintSide = (fillName) => {
    const m = current();
    form.querySelector("[data-pc-about]").textContent = m ? `${m.name} — ${[P.mapKindLabel(m), P.mapDimensions(m)].filter(Boolean).join(" · ")}. Cena ${P.mapHasGrid(m) ? "tática (com grade)" : "de imagem (sem grade)"}.` : "Escolha um mapa.";
    if (m) mapThumbnail(form.querySelector("[data-pc-big]"), m); else form.querySelector("[data-pc-big]").replaceChildren();
    if (m && fillName && (!F(form, "name").value || F(form, "name").dataset.auto === "1")) { F(form, "name").value = m.name.slice(0, P.NAME_LIMITS.scene); F(form, "name").dataset.auto = "1"; }
  };
  const paintList = () => {
    const groups = P.mapPickerGroups(campaign, official, { query, type });
    list.innerHTML = groups.map((g) => `<section class="pc-group" aria-label="${esc(g.label)}"><h3 class="pc-group-title">${esc(g.label)} <small>${g.items.length}</small></h3>${cardsHtml(g.items, selected, g.label)}</section>`).join("");
    if (!list.querySelector('[data-map][tabindex="0"]')) { const first = list.querySelector("[data-map]"); if (first) first.tabIndex = 0; }
    drawCardThumbs(list, all);
  };
  cardKeys(list, (key, confirm) => {
    selected = key;
    list.querySelectorAll("[data-map]").forEach((c) => { const on = c.dataset.map === key; c.classList.toggle("selected", on); c.setAttribute("aria-selected", String(on)); c.tabIndex = on ? 0 : -1; });
    paintSide(true);
    if (confirm) F(form, "name").focus();
  });
  F(form, "name").addEventListener("input", () => { F(form, "name").dataset.auto = "0"; });
  $("#pc-s-q").addEventListener("input", (e) => { query = e.target.value; paintList(); });
  $("#pc-s-type").addEventListener("change", (e) => { type = e.target.value; paintList(); });
  form.querySelector('[data-pc="back"]')?.addEventListener("click", () => openNewScene(ctx));
  paintList(); paintSide(true);
  (preset ? F(form, "name") : $("#pc-s-q")).focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const m = current();
      if (!m) throw new Error("Escolha um mapa para a cena.");
      const scene = await api(`/campaigns/${ctx.d.id}/scenes`, "POST", P.sceneFromMapBody(m, { name: data.name, folderId: data.folderId || null, order: ctx.sceneCount || 0 }));
      closeModal();
      await ctx.onCreated({ type: "scene", id: idOf(scene), open: true });
    });
  };
}

// ---------- Novo personagem ----------
export async function openNewCharacter(ctx) {
  const { npcModal } = await import("./campaign-prep.js");
  fresh();
  await npcModal(ctx.d, null, (saved) => ctx.onCreated(saved?.id ? { type: "character", id: saved.id } : {}), ctx.folderId || null);
}
