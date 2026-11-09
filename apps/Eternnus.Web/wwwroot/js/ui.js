import { beginLoading } from "./loading.js";
import { helpButton } from "./help.js";
export const $ = (s) => document.querySelector(s);
export function navigate(route) {
  if (location.hash === "#" + route)
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = route;
}
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let toastTimer;
export function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5000);
}
export function button(text, action, id = "", classes = "", extra = "") {
  if (/(?:^|\s)disabled(?=\s|$)/.test(extra) && !extra.includes('aria-describedby=')) {
    let reason = '';
    if (/page|history/.test(action) && /Anterior|Próxima|Recentes|Antigos/.test(text)) reason = /Anterior|Recentes/.test(text) ? 'Você está no início da lista.' : 'Você está no fim da lista.';
    if (['pp-scene', 'pp-npc', 'jr-schedule', 'jr-new'].includes(action)) reason = 'Restaure a campanha arquivada para editar a preparação.';
    if (['ed-page-add', 'ed-page-remove'].includes(action)) reason = 'O modelo precisa ter entre 1 e 50 páginas.';
    if (action === 't-give-turn') reason = 'O Jogador precisa estar conectado em uma sessão ativa.';
    if (reason) extra = extra.replace(/(^|\s)disabled(?=\s|$)/, '$1aria-disabled="true"') + ` data-tip="${esc(reason)}"`;
  }
  // Nome acessível continua disponível em toque; tooltip só reforça os controles de ícone.
  if (!extra.includes('data-tip=')) {
    const label = /aria-label="([^"]+)"/.exec(extra)?.[1];
    if (label) extra += ` data-tip="${label}"`;
  }
  return `<button type="button" class="${classes}" data-action="${action}" data-id="${esc(id)}" ${extra}>${text}</button>`;
}
export function fieldHint(id, hint) {
  return hint ? `<small class="form-help" id="${esc(id)}-hint">${esc(hint)}</small>` : '';
}
function describedAttrs(attrs, id, hint) {
  if (!hint) return attrs;
  const current = /aria-describedby="([^"]*)"/.exec(attrs);
  if (current) return attrs.replace(current[0], `aria-describedby="${current[1]} ${esc(id)}-hint"`);
  return `${attrs} aria-describedby="${esc(id)}-hint"`;
}
export function field(name, label, value = "", type = "text", attrs = "", options = {}) {
  if (typeof attrs === 'object') { options = attrs; attrs = ''; }
  const id = options.id || `f-${name}`;
  return `<div class="field"><div class="field-label"><label for="${esc(id)}">${label}</label>${options.help ? helpButton(options.help, label) : ''}</div><input id="${esc(id)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${describedAttrs(attrs, id, options.hint)}>${fieldHint(id, options.hint)}</div>`;
}
export function passwordField(name, label, autocomplete, options = {}) {
  const id = `f-${name}`;
  return `<div class="field"><div class="field-label"><label for="${id}">${label}</label>${options.help ? helpButton(options.help, label) : ''}</div><div class="password-wrap"><input id="${id}" type="password" name="${name}" required maxlength="128" autocomplete="${autocomplete}" ${describedAttrs('', id, options.hint)}>${button("◉", "password-toggle", name, "eye", 'aria-label="Mostrar ' + label.toLowerCase() + '" aria-pressed="false"')}</div>${fieldHint(id, options.hint)}</div>`;
}
export function formError() {
  return '<p class="form-error" data-form-error role="alert"></p>';
}
export function modal(title, content) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = content;
  if (!$("#modal").open) $("#modal").showModal();
}
export async function submitForm(form, task) {
  if (form.getAttribute("aria-busy") === "true") return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  form.setAttribute("aria-busy", "true");
  const error = form.querySelector("[data-form-error]");
  if (error) error.textContent = "";
  const finish = beginLoading();
  try {
    await task(Object.fromEntries(new FormData(form)));
  } catch (e) {
    if (error) error.textContent = e.message;
    else toast(e.message);
  } finally {
    button.disabled = false;
    form.removeAttribute("aria-busy");
    finish();
  }
}
export function formatDate(date) {
  return new Date(date.endsWith("Z") ? date : date + "Z").toLocaleString(
    "pt-BR",
    { dateStyle: "short", timeStyle: "short" },
  );
}
export function empty(title, text, action = "", label = "") {
  return `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚑</span><h3>${title}</h3><p>${text}</p>${action ? button(label, action, "", "primary") : ""}</div>`;
}
export function installUi() {
  const visibility = () => { document.documentElement.classList.toggle("is-background", document.hidden); };
  document.addEventListener("visibilitychange", visibility);
  visibility();
  document.querySelector(".skip-link")?.addEventListener("click", event => {
    event.preventDefault();
    (document.getElementById("main") || document.getElementById("app"))?.focus();
  });
  $("#close-modal").onclick = () => $("#modal").close();
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    if (b.dataset.action === "modal-close") $("#modal").close();
    if (b.dataset.action === "password-toggle") {
      const input = document.getElementById("f-" + b.dataset.id);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      b.setAttribute("aria-pressed", String(show));
      b.setAttribute("aria-label", (show ? "Ocultar" : "Mostrar") + " senha");
      b.dataset.tip = (show ? "Ocultar" : "Mostrar") + " senha";
    }
  });
}
