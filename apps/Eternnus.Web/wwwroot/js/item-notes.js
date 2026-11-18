// Descrições por item da ficha (ADR-098): popup padrão (mesmo cabeçalho e corpo do modal do sistema), em diálogo próprio
// para poder abrir por cima do modal da ficha na mesa. Edição só altera o rascunho local; grava ao salvar a ficha.
import { esc, button } from "./ui.js";
import { fieldItems, NOTE_MAX } from "./item-notes-policy.js";

let dialog = null;
function ensureDialog() {
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "notes-dialog";
  dialog.setAttribute("aria-labelledby", "notes-dialog-title");
  dialog.innerHTML = `<div class="modal-head"><h2 id="notes-dialog-title"></h2><button type="button" class="icon-button" data-notes-close aria-label="Fechar">×</button></div><div class="notes-dialog-body"></div>`;
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-notes-close]")) dialog.close();
  });
  return dialog;
}

/**
 * Abre as descrições dos itens de um campo. `notes`: { chave: texto }. Com `editable`, `onApply(edits)` recebe
 * { chave: texto } (vazio = remover) ao confirmar. Sem itens no campo, mostra o estado vazio.
 */
export function openItemNotes({ label, value, notes = {}, editable = false, onApply = () => {}, onUse = null }) {
  const el = ensureDialog();
  const items = fieldItems(value);
  el.querySelector("#notes-dialog-title").textContent = `Descrições: ${label}`;
  const body = el.querySelector(".notes-dialog-body");
  if (!items.length) {
    body.innerHTML = `<p class="muted">Este campo ainda não tem itens. Escreva um item por linha na ficha para descrevê-lo.</p><div class="form-actions">${button("Fechar", "notes-close", "", "subtle", "data-notes-close")}</div>`;
  } else if (editable) {
    body.innerHTML = `<form class="notes-form" novalidate><p class="form-help">Uma descrição por item, até ${NOTE_MAX} caracteres. Fica guardada ao salvar a ficha; se o item for renomeado ou apagado, a descrição dele sai junto.</p><ol class="notes-list">${items.map((item, i) => `<li class="field"><label for="note-${i}">${esc(item.label)}</label><textarea id="note-${i}" data-key="${esc(item.key)}" maxlength="${NOTE_MAX}" rows="3">${esc(notes[item.key] || "")}</textarea></li>`).join("")}</ol><div class="form-actions">${button("Cancelar", "notes-cancel", "", "subtle", "data-notes-close")}<button type="submit" class="primary">Aplicar descrições</button></div></form>`;
    body.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const edits = {};
      for (const area of body.querySelectorAll("textarea[data-key]")) edits[area.dataset.key] = area.value;
      onApply(edits);
      el.close();
    };
  } else {
    const described = items.filter((item) => notes[item.key]);
    // Na mesa, quem pode agir com a ficha também "usa" o item daqui (ADR-099): custo e rolagem num registro só.
    const use = (item) => (onUse ? button("Usar", "notes-use", item.key, "subtle small", `data-notes-use="${esc(item.key)}" aria-label="Usar ${esc(item.label)}"`) : "");
    const shown = onUse ? items : described;
    body.innerHTML = `${shown.length ? `<dl class="notes-read">${shown.map((item) => `<div><dt>${esc(item.label)}${use(item)}</dt><dd>${notes[item.key] ? esc(notes[item.key]) : '<span class="muted">Sem descrição.</span>'}</dd></div>`).join("")}</dl>` : `<p class="muted">Nenhum item deste campo tem descrição.</p>`}<div class="form-actions">${button("Fechar", "notes-close", "", "subtle", "data-notes-close")}</div>`;
    body.onclick = (event) => {
      const key = event.target.closest("[data-notes-use]")?.dataset.notesUse;
      const item = key && items.find((i) => i.key === key);
      if (item) { el.close(); onUse({ key: item.key, text: item.label, note: notes[item.key] || "" }); }
    };
  }
  if (!el.open) el.showModal();
  (body.querySelector("textarea") || body.querySelector("[data-notes-close]"))?.focus();
}

/** Fecha o popup (ex.: ao sair da página). */
export function closeItemNotes() {
  if (dialog?.open) dialog.close();
  if (stacked?.open) stacked.close();
}

// Diálogo empilhável genérico (mesmo visual): ações sobre a ficha aberta na mesa sem fechar o modal dela (ADR-099).
let stacked = null;
/** Abre um diálogo por cima de tudo com título (texto) e corpo (HTML já escapado). Devolve o elemento do corpo. */
export function stackedDialog(title, html) {
  if (!stacked?.isConnected) {
    stacked = document.createElement("dialog");
    stacked.className = "notes-dialog stacked-dialog";
    stacked.setAttribute("aria-labelledby", "stacked-dialog-title");
    stacked.innerHTML = `<div class="modal-head"><h2 id="stacked-dialog-title"></h2><button type="button" class="icon-button" data-notes-close aria-label="Fechar">×</button></div><div class="notes-dialog-body"></div>`;
    document.body.append(stacked);
    stacked.addEventListener("click", (event) => {
      if (event.target === stacked || event.target.closest("[data-notes-close]")) stacked.close();
    });
  }
  stacked.querySelector("#stacked-dialog-title").textContent = title;
  const body = stacked.querySelector(".notes-dialog-body");
  body.onclick = null;
  body.innerHTML = html;
  if (!stacked.open) stacked.showModal();
  (body.querySelector("input, select, textarea") || body.querySelector("[data-notes-close]"))?.focus();
  return body;
}
export function closeStacked() { if (stacked?.open) stacked.close(); }
