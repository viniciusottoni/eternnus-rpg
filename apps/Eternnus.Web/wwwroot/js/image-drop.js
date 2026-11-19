// Entrada de imagens nos editores (ADR-090): arrastar do computador para o palco, colar da área de transferência (Ctrl+V),
// escolher vários arquivos e arrastar imagens do acervo da campanha. Aqui só há leitura local, validação e realce visual;
// cada editor envia pelos próprios endpoints (api.js) e decide onde o elemento entra. Carregado sob demanda pelos editores.
import { esc } from "./ui.js";
import { isTypingTarget } from "./editor-policy.js";
import { state } from "./state.js";
import { uploadLimit, formatBytes } from "./account-usage-policy.js";

export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg"]);
/** Maior imagem que a conta envia (plano, ADR-102); sem conta carregada, o do Basic. */
export const maxImageBytes = () => uploadLimit(state.user);
/** Arquivos aceitos de uma vez (os demais são recusados com aviso). */
export const MAX_FILES = 12;
/** Tipo próprio do arrastar do painel Acervo (JSON `{ src, name, width, height }`; nunca aceita texto solto de fora). */
export const ASSET_DND = "application/x-eternnus-asset";
const G = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SAFE_IMAGE = new RegExp(`^/api/campaigns/${G}/assets/maps/${G}/image$`);
const ASSET = new RegExp(`^asset:${G}$`);
const EXT = /\.(png|jpe?g)$/i;

/** Recusa em texto ou "" — os mesmos limites do servidor: PNG ou JPEG até o limite do plano. */
export function imageFileProblem(file) {
  const name = String(file?.name || "imagem").slice(0, 80);
  if (!file) return "Nenhum arquivo recebido.";
  const type = String(file.type || "").toLowerCase();
  if (!IMAGE_TYPES.includes(type) && !(type === "" && EXT.test(name))) return `“${name}” não é PNG nem JPEG.`;
  if (!(file.size > 0)) return `“${name}” está vazio.`;
  if (file.size > maxImageBytes()) return `“${name}” passa de ${formatBytes(maxImageBytes())}, o limite do seu plano.`;
  return "";
}

/** Separa arquivos válidos e recusas (no máximo `MAX_FILES` válidos). → { files, problems } */
export function splitImageFiles(list) {
  const files = [], problems = [];
  for (const f of list || []) {
    const problem = imageFileProblem(f);
    if (problem) problems.push(problem);
    else if (files.length >= MAX_FILES) problems.push(`Envie até ${MAX_FILES} imagens por vez; “${String(f.name || "imagem").slice(0, 80)}” ficou de fora.`);
    else files.push(f);
  }
  return { files, problems };
}

/** Arquivos de um DataTransfer (soltar ou colar). Imagens coladas do sistema chegam como itens do tipo "file". */
export function filesOf(dt) {
  if (!dt) return [];
  const files = [...(dt.files || [])];
  if (files.length) return files;
  return [...(dt.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
}
export const carriesFiles = (dt) => Array.from(dt?.types || []).includes("Files");
export const carriesAsset = (dt) => Array.from(dt?.types || []).includes(ASSET_DND);
/** Quantos arquivos estão sendo arrastados (o conteúdo só fica legível ao soltar). */
const draggedCount = (dt) => [...(dt?.items || [])].filter((i) => i.kind === "file").length;

/** Nome do arquivo sem extensão, até 80 caracteres. */
export const baseName = (name) => String(name || "Imagem").replace(/\.[a-z0-9]{2,5}$/i, "").trim().slice(0, 80) || "Imagem";

/** Dimensões naturais de uma imagem local, antes do envio. */
export function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Não foi possível ler “${baseName(file.name)}”. O arquivo pode estar corrompido.`)); };
    img.src = url;
  });
}

/** Item do acervo carregado no arraste; só aceita `asset:{guid}` e a rota de imagem da própria campanha. */
export function parseAssetDrag(text) {
  try {
    const v = JSON.parse(text);
    if (!v || !ASSET.test(String(v.src))) return null;
    return { src: v.src, name: String(v.name || "Imagem").slice(0, 80), width: Number(v.width) || 0, height: Number(v.height) || 0 };
  } catch { return null; }
}

/**
 * Zona de soltura sobre o palco inteiro (`host`): realça a área, mostra a indicação de onde a imagem entra e entrega os
 * arquivos (ou o item do acervo) com o ponto da janela onde foram soltos. `enabled()` decide se aceita agora.
 * `onFiles(files, { clientX, clientY })`, `onAsset(item, point)`. Devolve a função de descarte.
 */
export function mountImageDrop(host, { enabled = () => true, onFiles, onAsset, hint = "" } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "ed-drop";
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ed-drop-ghost" aria-hidden="true"><span>+</span></div><p class="ed-drop-label" role="status" aria-live="polite"></p>';
  host.append(overlay);
  const ghost = overlay.querySelector(".ed-drop-ghost"), label = overlay.querySelector(".ed-drop-label");
  const accepts = (e) => enabled() && (carriesFiles(e.dataTransfer) || (!!onAsset && carriesAsset(e.dataTransfer)));
  function show(e) {
    const r = host.getBoundingClientRect();
    overlay.hidden = false;
    ghost.style.transform = `translate(${Math.round(e.clientX - r.left)}px, ${Math.round(e.clientY - r.top)}px)`;
    const n = draggedCount(e.dataTransfer);
    const limit = ` (PNG ou JPEG, até ${formatBytes(maxImageBytes())} cada)`;
    const text = carriesAsset(e.dataTransfer) ? "Solte para usar a imagem do acervo aqui" : n > 1 ? `Solte para adicionar ${n} imagens aqui${limit}` : `Solte para adicionar a imagem aqui${limit}`;
    if (label.textContent !== text + hint) label.textContent = text + hint;
  }
  const hide = () => { overlay.hidden = true; };
  const onOver = (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    show(e);
  };
  const onLeave = (e) => { if (!host.contains(e.relatedTarget)) hide(); };
  const onDrop = (e) => {
    hide();
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const point = { clientX: e.clientX, clientY: e.clientY };
    if (onAsset && carriesAsset(e.dataTransfer)) {
      const item = parseAssetDrag(e.dataTransfer.getData(ASSET_DND));
      if (item) onAsset(item, point);
      return;
    }
    const files = filesOf(e.dataTransfer);
    if (files.length) onFiles?.(files, point);
  };
  host.addEventListener("dragover", onOver);
  host.addEventListener("dragleave", onLeave);
  host.addEventListener("drop", onDrop);
  // Soltar fora da zona não deve abrir a imagem no navegador (perderia o editor).
  const guard = (e) => { if (carriesFiles(e.dataTransfer)) e.preventDefault(); };
  window.addEventListener("dragover", guard);
  window.addEventListener("drop", guard);
  return () => {
    host.removeEventListener("dragover", onOver); host.removeEventListener("dragleave", onLeave); host.removeEventListener("drop", onDrop);
    window.removeEventListener("dragover", guard); window.removeEventListener("drop", guard);
    overlay.remove();
  };
}

/**
 * Colar imagens do sistema (Ctrl+V). Nunca age dentro de campos de texto (a colagem de texto continua normal).
 * `handler(files)` recebe só arquivos de imagem; sem imagem, `fallback()` (colar interno do editor) roda.
 * Devolve `{ dispose, request }`: `request()` é chamado pelo atalho Ctrl+V do editor (o núcleo não bloqueia a colagem nativa).
 */
export function listenPaste(handler, { enabled = () => true, fallback = () => {} } = {}) {
  let timer = 0;
  const on = (e) => {
    if (!enabled() || isTypingTarget(e.target)) return;
    // Qualquer imagem entra aqui; o editor valida (PNG/JPEG até o limite do plano) e explica a recusa.
    const files = filesOf(e.clipboardData).filter((f) => String(f.type).startsWith("image/") || EXT.test(String(f.name || "")));
    if (!files.length) return;
    clearTimeout(timer); timer = 0;
    e.preventDefault();
    handler(files);
  };
  document.addEventListener("paste", on);
  return {
    // O evento "paste" chega logo depois do atalho; sem imagem nele, vale o colar interno.
    request() { clearTimeout(timer); timer = setTimeout(() => { timer = 0; fallback(); }, 80); },
    dispose() { clearTimeout(timer); document.removeEventListener("paste", on); },
  };
}

/** Lista do painel Acervo: imagens da campanha arrastáveis (só a rota de imagem da própria campanha entra no `src`). */
export function assetListHtml(items, { query = "", empty = "Nenhuma imagem no acervo da campanha ainda." } = {}) {
  const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = plain(query).trim();
  const list = (items || []).filter((m) => SAFE_IMAGE.test(String(m.imageUrl || "")) && ASSET.test(String(m.key || "")) && (!q || plain(m.name).includes(q)));
  if (!list.length) return `<p class="muted small">${esc(q ? "Nenhum resultado." : empty)}</p>`;
  return `<ul class="ed-assets" role="list">${list.slice(0, 60).map((m) => {
    const data = esc(JSON.stringify({ src: m.key, name: String(m.name || "Imagem").slice(0, 80), width: m.pixelWidth || 0, height: m.pixelHeight || 0 }));
    return `<li class="ed-asset" draggable="true" data-ed-asset="${data}"><img src="${esc(m.imageUrl)}" alt="" loading="lazy" decoding="async" width="56" height="42"><span>${esc(m.name || "Imagem")}${m.pixelWidth ? `<small>${Number(m.pixelWidth)} × ${Number(m.pixelHeight)} px</small>` : ""}</span><button type="button" class="subtle small" data-ed-asset-add>Adicionar<span class="sr-only"> ${esc(m.name || "imagem")}</span></button></li>`;
  }).join("")}</ul>`;
}

/** Liga o arrastar e o botão "Adicionar" do painel Acervo. `onAdd(item)` = clique (entra no centro da vista). */
export function bindAssetList(host, { onAdd }) {
  const start = (e) => {
    const li = e.target.closest?.("[data-ed-asset]");
    if (!li || !e.dataTransfer) return;
    e.dataTransfer.setData(ASSET_DND, li.dataset.edAsset);
    e.dataTransfer.effectAllowed = "copy";
  };
  const click = (e) => {
    const b = e.target.closest("[data-ed-asset-add]");
    if (!b) return;
    const item = parseAssetDrag(b.closest("[data-ed-asset]")?.dataset.edAsset || "");
    if (item) onAdd(item);
  };
  host.addEventListener("dragstart", start);
  host.addEventListener("click", click);
  return () => { host.removeEventListener("dragstart", start); host.removeEventListener("click", click); };
}

/** Endereço https de imagem para importar por link (o servidor baixa uma cópia; os jogadores nunca acessam a origem). → URL ou lança Error. */
export function httpsImageUrl(text) {
  const url = String(text || "").trim();
  let parsed = null;
  try { parsed = new URL(url); } catch { /* inválido */ }
  if (!parsed || parsed.protocol !== "https:" || url.length > 2000) throw new Error("Informe um endereço https:// válido (até 2.000 caracteres) que abra a própria imagem PNG ou JPEG.");
  return url;
}

/**
 * Bandeja de envio no palco (P1.4): uma linha por arquivo com miniatura local (PNG mantém a transparência), andamento e
 * resultado. O envio usa fetch, que não mede bytes: o andamento é indeterminado e o texto conta "k de n". Erros ficam até
 * serem dispensados; os concluídos saem quando um novo envio começa. Devolve { start(files) → linhas, dispose() }.
 */
export function mountUploadTray(host) {
  const list = document.createElement("ul");
  list.className = "ed-uploads";
  list.hidden = true;
  list.setAttribute("aria-label", "Envio de imagens");
  list.setAttribute("aria-live", "polite");
  host.append(list);
  const urls = new Set();
  function remove(li) { const u = li.dataset.url; if (u) { URL.revokeObjectURL(u); urls.delete(u); } li.remove(); list.hidden = !list.children.length; }
  list.addEventListener("click", (e) => { const b = e.target.closest("[data-upload-dismiss]"); if (b) remove(b.closest(".ed-upload")); });
  function row(file) {
    const li = document.createElement("li");
    li.className = "ed-upload";
    const img = document.createElement("img");
    img.alt = ""; img.decoding = "async";
    try { const u = URL.createObjectURL(file); urls.add(u); li.dataset.url = u; img.src = u; } catch { /* sem miniatura */ }
    const text = document.createElement("span"); text.className = "ed-upload-text";
    const name = document.createElement("span"); name.className = "ed-upload-name"; name.textContent = baseName(file.name);
    const status = document.createElement("span"); status.className = "ed-upload-status"; status.textContent = "Na fila";
    const bar = document.createElement("progress"); bar.setAttribute("aria-label", `Andamento de ${baseName(file.name)}`); bar.hidden = true;
    text.append(name, status, bar);
    const close = document.createElement("button");
    close.type = "button"; close.className = "subtle small"; close.dataset.uploadDismiss = ""; close.hidden = true;
    close.setAttribute("aria-label", `Dispensar aviso de ${baseName(file.name)}`); close.textContent = "×";
    li.append(img, text, close);
    list.append(li);
    const finish = (cls, message) => { li.classList.add(cls); status.textContent = message; bar.hidden = true; close.hidden = false; };
    return {
      progress(message) { status.textContent = message; bar.hidden = false; bar.removeAttribute("value"); },
      done(message = "Adicionada") { finish("done", message); },
      fail(message) { finish("error", message); },
    };
  }
  return {
    start(files) {
      for (const li of [...list.querySelectorAll(".ed-upload.done")]) remove(li);
      list.hidden = false;
      return files.map(row);
    },
    dispose() { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); list.remove(); },
  };
}

/**
 * Envia os arquivos um a um e coloca cada imagem assim que o servidor responde (mesmo fluxo nos editores de mapa e de cena).
 * `upload(file)` → Promise da imagem-fonte; `place(fonte, i)` → id do elemento criado ou null. Uma falha não interrompe os
 * demais arquivos nem mexe no que já está no editor (o rascunho continua sem salvar). → { added: ids, failed: número }.
 */
export async function uploadEach(files, { tray = null, upload, place, alive = () => true, say = () => {} }) {
  const rows = tray ? tray.start(files) : [];
  const added = [], errors = [];
  for (const [i, file] of files.entries()) {
    const label = files.length > 1 ? `Enviando ${i + 1} de ${files.length}…` : "Enviando…";
    rows[i]?.progress(label);
    say(files.length > 1 ? `Enviando imagem ${i + 1} de ${files.length}…` : `Enviando “${baseName(file.name)}”…`);
    try {
      const source = await upload(file);
      if (!alive()) return { added, failed: errors.length };
      const id = place(source, i);
      if (id) { added.push(id); rows[i]?.done(); }
      else rows[i]?.fail("Enviada, mas não coube no editor (limite de elementos ou camada bloqueada).");
    } catch (e) {
      const why = e?.message || "O envio falhou.";
      errors.push(`“${baseName(file.name)}”: ${why}`);
      rows[i]?.fail(why);
    }
  }
  const ok = added.length ? (added.length > 1 ? `${added.length} imagens adicionadas e selecionadas.` : "Imagem adicionada e selecionada: arraste para mover; as alças redimensionam e giram.") : "";
  say(`${ok}${errors.length ? ` ${errors.length} não ${errors.length > 1 ? "foram enviadas" : "foi enviada"}: ${errors.join(" ")} Nada do que já estava no editor foi perdido.` : ""}`.trim());
  return { added, failed: errors.length };
}
