// Fichas de NPCs e criaturas (só o mestre), escolha de imagem e visualizador de imagem para a mesa. Carregado sob demanda.
// Escritas por api.js; o servidor valida modelo, valores, imagem e visibilidade.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";

import { safeImageUrl } from "./play-policy.js";
import { initials } from "./session-policy.js";
export { safeImageUrl };

/** Imagens do acervo da campanha (mapas sem ou com grade) que podem servir de retrato. */
export async function imageChoices(campaignId) {
  const maps = await api(`/campaigns/${campaignId}/maps`);
  return (maps.items || []).filter((m) => String(m.key || "").startsWith("asset:")).map((m) => ({ value: m.key, label: m.name }));
}

/** Campos de imagem: do acervo (recomendado) ou link https. `current` é asset:{id}, https://… ou vazio. */
export function imageFields(prefix, current = "", assets = []) {
  const isAsset = String(current || "").startsWith("asset:");
  return `<fieldset class="npc-image"><legend>Imagem (opcional)${helpButton("mesa.npcs.imagem", "Imagem de NPC ou criatura")}</legend>
    <div class="field"><label for="${prefix}-asset">Do acervo da campanha</label><select id="${prefix}-asset" name="imageAsset"><option value="">Nenhuma</option>${assets.map((a) => `<option value="${esc(a.value)}" ${isAsset && a.value === current ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div>
    <div class="field"><label for="${prefix}-link">Ou link https</label><input id="${prefix}-link" name="imageLink" type="url" inputmode="url" maxlength="500" placeholder="https://…" value="${isAsset ? "" : esc(current || "")}" aria-describedby="${prefix}-link-hint"><small class="form-help" id="${prefix}-link-hint">O site do link vê o endereço IP de quem abre a imagem e pode trocar o conteúdo depois. Prefira o acervo.</small></div>
  </fieldset>`;
}

/** Valor enviado ao servidor: acervo tem prioridade; link precisa ser https. */
export function imageFromForm(data) {
  if (data.imageAsset) return data.imageAsset;
  const link = String(data.imageLink || "").trim();
  if (link && !/^https:\/\//i.test(link)) throw new Error("Use um link que comece com https://.");
  return link || null;
}

/** Mostra a imagem maior na tela (jogadores e mestre). */
export function showImage(url, title) {
  const src = safeImageUrl(url);
  if (!src) return;
  modal(title || "Imagem", `<figure class="npc-portrait"><img alt="" referrerpolicy="no-referrer"><figcaption></figcaption></figure><div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}</div>`);
  const img = $("#modal-body .npc-portrait img");
  img.alt = title ? `Imagem de ${title}` : "Imagem";
  img.src = src;
  img.onerror = () => { $("#modal-body .npc-portrait figcaption").textContent = "Não foi possível carregar a imagem."; };
  $("#modal").classList.add("wide");
}

function control(f, value) {
  const id = `npc-f-${f.name}`;
  const attrs = `id="${esc(id)}" name="${esc(f.name)}"`;
  if (f.type === "computed") return `<input ${attrs} value="${esc(value)}" readonly aria-readonly="true">`;
  if (f.type === "select") return `<select ${attrs}><option value="">—</option>${(f.options || []).map((o) => `<option value="${esc(o)}" ${value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  if (f.type === "textarea") return `<textarea ${attrs} rows="3" maxlength="${Number(f.maxLength) || 2000}">${esc(value)}</textarea>`;
  if (f.type === "checkbox") return `<input ${attrs} type="checkbox" value="true" ${value === "true" ? "checked" : ""}>`;
  if (f.type === "number") return `<input ${attrs} inputmode="decimal" value="${esc(value)}" ${f.min != null ? `data-min="${Number(f.min)}"` : ""} ${f.max != null ? `data-max="${Number(f.max)}"` : ""}>`;
  return `<input ${attrs} maxlength="${Number(f.maxLength) || 200}" value="${esc(value)}">`;
}

function fieldsHtml(sheet) {
  const sections = new Map();
  for (const f of sheet.fields) {
    const key = f.section || "Ficha";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(f);
  }
  return [...sections].map(([title, fields]) => `<fieldset class="npc-sheet-section"><legend>${esc(title)}</legend><div class="form-grid two">${fields.map((f) => {
    const value = String(sheet.values?.[f.name] ?? "");
    const label = `${esc(f.label || f.name)}${f.type === "computed" ? " (calculado)" : ""}`;
    return f.type === "checkbox"
      ? `<label class="check" for="npc-f-${esc(f.name)}">${control(f, value)} ${label}</label>`
      : `<div class="field"><label for="npc-f-${esc(f.name)}">${label}</label>${control(f, value)}</div>`;
  }).join("")}</div></fieldset>`).join("");
}

/** Retrato do NPC/criatura no topo da ficha: prévia, troca (acervo ou link https) e remoção. Vira o retrato do marcador no mapa. */
function imageEditor(sheet, assets) {
  const preview = safeImageUrl(sheet.imagePreview);
  return `<form id="npc-image-form" class="npc-image-editor" novalidate><div class="npc-image-preview">${preview
    ? `<a class="npc-avatar" target="_blank" rel="noopener noreferrer" aria-label="Abrir a imagem de ${esc(sheet.name)} em nova aba"><img alt=""></a><small class="form-help">Clique para abrir em tamanho real.</small>`
    : `<span class="npc-avatar empty" aria-hidden="true">${esc(initials(sheet.name))}</span><small class="form-help">Sem imagem: o mapa mostra as iniciais.</small>`}</div><div class="npc-image-fields">${imageFields("npc-img", sheet.imageUrl || "", assets)}<p class="form-help">A imagem vira o retrato do marcador no mapa — para você e para os jogadores que enxergam o marcador.</p>${formError()}<div class="form-actions">${sheet.imageUrl ? '<button type="button" class="subtle" data-npc-image="remove">Remover imagem</button>' : ""}<button type="submit" class="subtle">${sheet.imageUrl ? "Trocar imagem" : "Salvar imagem"}</button></div></div></form>`;
}

/** Ficha de um NPC/criatura: imagem, modelo e valores. `onSaved(sheet)` é opcional. */
export async function openNpcSheet({ campaignId, npcId, onSaved }) {
  const [templates, first, assets] = await Promise.all([api(`/campaigns/${campaignId}/npc-templates`), api(`/campaigns/${campaignId}/npcs/${npcId}/sheet`), imageChoices(campaignId).catch(() => [])]);
  let sheet = first;
  const saveImage = async (imageUrl) => {
    sheet = await api(`/campaigns/${campaignId}/npcs/${npcId}/image`, "PUT", { imageUrl, revision: sheet.revision });
    onSaved?.(sheet);
    toast(imageUrl ? `Imagem de ${sheet.name} atualizada.` : `Imagem de ${sheet.name} removida.`);
    mountImage();
  };
  // Só a área da imagem é refeita ao salvar: valores da ficha em edição continuam no formulário.
  const mountImage = () => {
    const host = $("#npc-image-host");
    if (!host) return;
    host.innerHTML = imageEditor(sheet, assets);
    const form = $("#npc-image-form");
    const img = form.querySelector(".npc-avatar img");
    if (img) {
      img.closest("a").href = safeImageUrl(sheet.imagePreview);
      img.referrerPolicy = "no-referrer";
      img.src = safeImageUrl(sheet.imagePreview);
      img.alt = `Imagem de ${sheet.name}`;
      img.onerror = () => { img.closest(".npc-image-preview").querySelector(".form-help").textContent = "Não foi possível carregar a imagem."; };
    }
    form.onclick = async (e) => {
      const action = e.target.closest("[data-npc-image]")?.dataset.npcImage;
      if (action === "remove") {
        e.target.disabled = true;
        try { await saveImage(null); } catch (error) { toast(error.message); if (e.target.isConnected) e.target.disabled = false; }
      }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      submitForm(form, async (data) => {
        const imageUrl = imageFromForm(data);
        if (!imageUrl) throw new Error("Escolha uma imagem do acervo ou informe um link https.");
        await saveImage(imageUrl);
      });
    };
  };
  const render = () => {
    const current = sheet.template?.id || "";
    modal(
      `▣ Ficha de ${sheet.name}`,
      `<div id="npc-image-host"></div><form id="npc-sheet-form"><div class="field"><div class="field-label"><label for="npc-template">Modelo de ficha</label>${helpButton("mesa.npcs.ficha", "Ficha de NPC ou criatura")}</div><select id="npc-template" name="templateId"><option value="">Sem ficha (só recursos simples)</option>${templates.items.map((t) => `<option value="${esc(t.id)}" ${t.id === current ? "selected" : ""}>${esc(t.name)}${t.playerDefault ? " — modelo dos jogadores" : t.campaign ? " — desta campanha" : ""}</option>`).join("")}</select><small class="form-help">Pode ser o mesmo modelo dos jogadores ou outro. Trocar o modelo recomeça os valores.</small></div>${sheet.template ? fieldsHtml(sheet) : '<p class="muted">Escolha um modelo para acompanhar vida, atributos e o estado deste personagem.</p>'}${formError()}<div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}${sheet.template ? '<button type="submit" class="primary">Salvar ficha</button>' : ""}</div></form>`,
    );
    $("#modal").classList.add("wide");
    mountImage();
    const form = $("#npc-sheet-form");
    form.elements.templateId.onchange = async (e) => {
      const templateId = e.target.value || null;
      try {
        sheet = await api(`/campaigns/${campaignId}/npcs/${npcId}/sheet`, "PUT", { templateId, values: null, revision: sheet.revision });
        onSaved?.(sheet);
        render();
        $("#npc-template")?.focus();
      } catch (error) { toast(error.message); e.target.value = current; }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      submitForm(form, async () => {
        const values = {};
        for (const f of sheet.fields) {
          if (f.type === "computed") continue;
          const el = form.elements[f.name];
          if (!el) continue;
          values[f.name] = f.type === "checkbox" ? (el.checked ? "true" : "false") : el.value;
        }
        sheet = await api(`/campaigns/${campaignId}/npcs/${npcId}/sheet`, "PUT", { templateId: sheet.template.id, values, revision: sheet.revision });
        onSaved?.(sheet);
        toast(`Ficha de ${sheet.name} salva.`);
        render();
      });
    };
  };
  render();
}
