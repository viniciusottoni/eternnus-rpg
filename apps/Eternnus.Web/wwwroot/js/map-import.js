// Mapas trazidos pelo mestre: imagem solta na mesa, arquivo Universal VTT (.dd2vtt/.uvtt/.df2vtt) e ajuste da grade
// com o mapa já na mesa. Carregado sob demanda. Tudo passa pelo acervo da campanha (POST /assets/maps) e pelas
// escritas comuns (PUT /assets/layers, POST /sessions/{id}/map e /map/grid): o servidor valida imagem, grade e papel.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { IMAGE_LIMITS, MAX_UVTT_BYTES, fitScale, guessGridPixels, imageKind, isImageType, isUvttName, mapNameFrom, parseUvtt, scaledGrid, uvttLayer } from "./vtt-import-policy.js";

/** Arquivo que a mesa aceita ao soltar: imagem PNG/JPEG/WebP ou UVTT. */
export const acceptsDrop = (file) => !!file && (isImageType(file.type) || isUvttName(file.name));

async function decode(blob) {
  try { return await createImageBitmap(blob); }
  catch { throw new Error("Não foi possível abrir a imagem. Use PNG, JPEG ou WebP sem animação."); }
}

/**
 * Prepara a imagem para o servidor: PNG/JPEG dentro dos limites seguem como estão; WebP ou imagens maiores
 * são redesenhadas (JPEG) no tamanho pedido. Nada sai do aparelho aqui.
 */
async function prepareImage(blob, target = null) {
  const bitmap = await decode(blob);
  try {
    const { width, height } = bitmap;
    if (Math.min(width, height) < IMAGE_LIMITS.minSide) throw new Error("A imagem precisa ter ao menos 64 pixels por lado.");
    const scale = target ? null : fitScale(width, height);
    const w = target?.width ?? Math.floor(width * scale), h = target?.height ?? Math.floor(height * scale);
    const keep = (blob.type === "image/png" || blob.type === "image/jpeg") && w === width && h === height && blob.size <= IMAGE_LIMITS.maxBytes;
    if (keep) return { blob, width, height, resized: false };
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, w, h);
    for (const quality of [0.9, 0.8, 0.7]) {
      const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (out && out.size <= IMAGE_LIMITS.maxBytes) return { blob: out, width: w, height: h, resized: w !== width || h !== height };
    }
    throw new Error("A imagem continua acima de 10 MB depois de reduzida.");
  } finally { bitmap.close?.(); }
}

async function uploadMap(campaignId, { blob, name, gridPixels }) {
  const form = new FormData();
  form.append("name", name); form.append("folderId", "");
  form.append("file", new File([blob], blob.type === "image/png" ? "mapa.png" : "mapa.jpg", { type: blob.type }));
  form.append("gridPixels", String(gridPixels)); form.append("scaleMeters", "1.5");
  form.append("hasGrid", "true"); form.append("gridOffsetX", "0"); form.append("gridOffsetY", "0");
  return api(`/campaigns/${campaignId}/assets/maps`, "POST", form);
}

/** Grava paredes, portas e luzes do UVTT na preparação do mapa recém-enviado (antes de ir à mesa). */
async function saveUvttLayer(campaignId, mapKey, parsed) {
  const path = `/campaigns/${campaignId}/assets/layers?key=${encodeURIComponent(mapKey)}`;
  const layer = await api(path);
  const converted = uvttLayer(parsed, layer.width, layer.height, layer.cells);
  await api(path, "PUT", {
    fog: layer.fog, cells: converted.cells, revealed: layer.revealed,
    lights: [...(layer.lights || []).map((l) => ({ x: l.x, y: l.y, radius: l.radius })), ...converted.lights].slice(0, 100),
    marks: (layer.marks || []).map((m) => ({ id: m.id || null, x: m.x, y: m.y, kind: m.kind, label: m.label, dc: m.dc ?? null, sense: m.sense || null, maxDistance: m.maxDistance ?? null })),
    revision: layer.revision, prepVersion: layer.prepVersion,
  });
  return converted.counts;
}

async function readUvtt(file) {
  if (file.size > MAX_UVTT_BYTES) throw new Error("O arquivo UVTT passa de 60 MB. Exporte com menos pixels por quadrado.");
  let json;
  try { json = JSON.parse(await file.text()); } catch { throw new Error("O arquivo não é um UVTT válido (JSON)."); }
  const parsed = parseUvtt(json);
  let bytes;
  try { bytes = Uint8Array.from(atob(parsed.image), (c) => c.charCodeAt(0)); } catch { throw new Error("A imagem dentro do arquivo está danificada."); }
  const type = imageKind(bytes);
  if (!type) throw new Error("A imagem dentro do arquivo não é PNG, JPEG nem WebP.");
  const grid = scaledGrid(parsed.pixelsPerGrid, parsed.cellsX, parsed.cellsY);
  const image = await prepareImage(new Blob([bytes], { type }), { width: grid.width, height: grid.height });
  return { parsed, grid, image };
}

/** Lê, envia ao acervo e prepara um mapa a partir do arquivo. Devolve o mapa salvo e o resumo para o aviso. */
async function importFile(campaignId, file, name) {
  if (isUvttName(file.name)) {
    const { parsed, grid, image } = await readUvtt(file);
    const map = await uploadMap(campaignId, { blob: image.blob, name, gridPixels: grid.gridPixels });
    const counts = await saveUvttLayer(campaignId, map.key, parsed);
    return { map, counts, scaled: grid.scaled };
  }
  const image = await prepareImage(file);
  const map = await uploadMap(campaignId, { blob: image.blob, name, gridPixels: guessGridPixels(image.width, image.height) });
  return { map, counts: null, scaled: image.resized };
}

function importSummary(result) {
  const m = result.map;
  const parts = [`${m.width} × ${m.height} casas`];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (result.counts) parts.push(n(result.counts.walls, "casa de parede", "casas de parede"), n(result.counts.doors, "casa de porta", "casas de porta"), n(result.counts.lights, "foco de luz", "focos de luz"));
  if (result.counts?.skippedLights) parts.push(`${result.counts.skippedLights} luzes além do limite de 100 ficaram de fora`);
  if (result.scaled) parts.push("imagem reduzida para caber nos limites");
  return parts.join(" · ");
}

/**
 * Mestre soltou um arquivo na mesa: confirma nome e destino. "Usar na mesa agora" troca o mapa (as criaturas do
 * cenário atual saem, como em qualquer troca de cenário) e, para imagem solta, abre o ajuste da grade em seguida.
 */
export function openDroppedMap({ file, campaignId, base, live, onGrid }) {
  const uvtt = isUvttName(file.name);
  modal(uvtt ? "Importar mapa UVTT" : "Usar imagem como mapa", `<form id="md-form"><p class="form-help">${uvtt ? "Arquivo do Dungeondraft ou de outro editor no formato Universal VTT. Imagem, grade, paredes, portas e luzes vêm do arquivo." : "A imagem vai para o acervo da campanha (Mapas e cenários) com uma grade sugerida. Você confere a grade logo depois."}${helpButton("mesa.mapa.soltar", "Soltar mapa na mesa")}</p><div class="field"><label for="md-name">Nome do mapa</label><input id="md-name" name="name" maxlength="120" required value="${esc(mapNameFrom(file.name))}"></div><p class="form-help">${live.play?.scene || live.tokens?.some((t) => !t.characterId) ? "Usar agora troca o cenário: criaturas do mapa atual saem e os aventureiros voltam aos pontos de entrada. A cena atual guarda o estado para retomar." : "Usar agora troca o cenário da mesa; os aventureiros vão para os pontos de entrada."}</p>${uvtt ? '<p class="form-help">Paredes do arquivo são linhas; a mesa usa casas. Confira paredes e portas em “Paredes e portas” (interface Completa).</p>' : ""}<p class="md-status" role="status" aria-live="polite"></p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="subtle" name="go" value="keep">Só guardar no acervo</button><button type="submit" class="primary" name="go" value="present">▶ Usar na mesa agora</button></div></form>`);
  const form = $("#md-form");
  $("#md-name").select();
  form.onsubmit = (e) => {
    e.preventDefault();
    const go = e.submitter?.value || "present";
    for (const b of form.querySelectorAll("button[type=submit]")) b.disabled = true;
    submitForm(form, async (data) => {
      const status = form.querySelector(".md-status");
      status.textContent = uvtt ? "Lendo o arquivo e preparando a imagem…" : "Preparando a imagem…";
      try {
        const result = await importFile(campaignId, file, String(data.name || "").trim() || mapNameFrom(file.name));
        if (go === "present") {
          status.textContent = "Mostrando na mesa…";
          await api(`${base}/map`, "POST", { mapKind: "tileset", mapKey: result.map.key });
        }
        $("#modal").close();
        toast(`${go === "present" ? "Mapa na mesa" : "Mapa guardado em Mapas e cenários"}: ${importSummary(result)}.`);
        if (go === "present" && !uvtt) onGrid?.(result.map);
      } finally {
        for (const b of form.querySelectorAll("button[type=submit]")) b.disabled = false;
      }
    });
  };
}

/** Acervo da campanha: importar um arquivo UVTT sem estar na mesa. */
export function openUvttImport({ campaignId, onDone }) {
  modal("Importar mapa UVTT", `<form id="mu-form"><p class="form-help">Formato Universal VTT (.dd2vtt do Dungeondraft, .uvtt, .df2vtt). A imagem e a grade vêm do arquivo; paredes, portas e luzes viram a preparação do mapa.${helpButton("mesa.mapa.soltar", "Mapas UVTT")}</p><div class="field"><label for="mu-file">Arquivo</label><input id="mu-file" name="file" type="file" required accept=".dd2vtt,.uvtt,.df2vtt"><small class="form-help">Até 60 MB. O arquivo é lido no seu aparelho; só a imagem preparada e as marcas são enviadas.</small></div><div class="field"><label for="mu-name">Nome do mapa</label><input id="mu-name" name="name" maxlength="120" placeholder="Usa o nome do arquivo"></div><p class="md-status" role="status" aria-live="polite"></p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Importar</button></div></form>`);
  const form = $("#mu-form");
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const file = form.querySelector("[name=file]").files?.[0];
      if (!file || !isUvttName(file.name)) throw new Error("Escolha um arquivo .dd2vtt, .uvtt ou .df2vtt.");
      form.querySelector(".md-status").textContent = "Lendo o arquivo e preparando a imagem…";
      const result = await importFile(campaignId, file, String(data.name || "").trim() || mapNameFrom(file.name));
      $("#modal").close();
      toast(`Mapa importado: ${importSummary(result)}.`);
      await onDone?.();
    });
  };
}

/** Mestre: ajusta a grade do mapa enviado que está na mesa. A prévia usa a imagem completa do acervo. */
export async function openGridModal({ base, live }) {
  const map = live.map;
  if (!map?.gridPixels || !String(map.key || "").startsWith("asset:")) return toast("Só mapas enviados pela campanha têm a grade ajustável na mesa.");
  const { gridAdjustHtml, mountGridAdjust } = await import("./grid-adjust.js");
  const { interfaceMode } = await import("./interface-mode.js");
  modal("▦ Ajustar grade do mapa", `<form id="mg-form"><p class="form-help">Mude o tamanho do quadrado até a grade dourada cobrir os quadrados do desenho. Paredes, névoa e luzes pintadas continuam nas mesmas casas; marcadores fora da nova grade vão para a casa livre mais próxima.</p>${gridAdjustHtml("mg", { gridPixels: map.gridPixels, gridOffsetX: map.gridOffsetX || 0, gridOffsetY: map.gridOffsetY || 0, scaleMeters: map.scaleMeters || 1.5 }, { complete: interfaceMode() === "complete" })}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Aplicar grade</button></div></form>`);
  $("#modal").classList.add("wide");
  let valid = true;
  // Mestre recebe a imagem inteira (sem névoa) pela rota protegida do acervo.
  const src = String(map.imageUrl || "").split("?")[0];
  const adjust = mountGridAdjust($("#mg-form"), src, { onChange: (v) => { valid = v.valid; } });
  $("#modal").addEventListener("close", () => adjust.dispose(), { once: true });
  $("#mg-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      if (!valid) throw new Error("Ajuste a grade: " + ($("#mg-form [data-grid-summary]")?.textContent || "valores inválidos."));
      const v = adjust.values();
      const scale = Number($("#mg-form [name=scaleMeters]").value || 1.5);
      const result = await api(`${base}/map/grid`, "POST", { gridPixels: v.gridPixels, gridOffsetX: v.gridOffsetX, gridOffsetY: v.gridOffsetY, scaleMeters: scale, revision: map.revision });
      $("#modal").close();
      toast(result.moved ? `Grade aplicada. ${result.moved} marcador(es) foram para dentro da nova grade.` : "Grade aplicada.");
    });
  };
}
