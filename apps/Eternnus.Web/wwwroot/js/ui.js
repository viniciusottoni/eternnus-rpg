import { beginLoading } from "./loading.js";
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
  return `<button type="button" class="${classes}" data-action="${action}" data-id="${esc(id)}" ${extra}>${text}</button>`;
}
export function field(name, label, value = "", type = "text", attrs = "") {
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
}
export function passwordField(name, label, autocomplete) {
  return `<div class="field"><label for="f-${name}">${label}</label><div class="password-wrap"><input id="f-${name}" type="password" name="${name}" required maxlength="128" autocomplete="${autocomplete}">${button("◉", "password-toggle", name, "eye", 'aria-label="Mostrar ' + label.toLowerCase() + '" aria-pressed="false"')}</div></div>`;
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
    }
  });
}
