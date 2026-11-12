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
/** Barra de ações com muitos botões: ferramentas à esquerda, ações principais à direita (primária por último).
 *  Recebe HTML já montado por `button()`. Dentro de modal fica fixa no rodapé da rolagem. */
export function actionBar(tools = "", main = "") {
  const group = (html, cls) => (html ? `<div class="action-group${cls}">${html}</div>` : "");
  return `<div class="form-actions action-bar">${group(tools, " action-tools")}${group(main, " action-main")}</div>`;
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
// Classes de layout (wide, editor de cena) saem só ao abrir o próximo modal: assim o modal que fecha mantém o tamanho
// durante o fade de saída. Quem precisa delas as adiciona depois de chamar modal().
const MODAL_LAYOUTS = ["wide", "scene-editor-modal"];
export function modal(title, content) {
  const dialog = $("#modal");
  if (!dialog.open) dialog.classList.remove(...MODAL_LAYOUTS);
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = content;
  if (!dialog.open) dialog.showModal();
}
export async function submitForm(form, task) {
  if (form.getAttribute("aria-busy") === "true") return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  form.setAttribute("aria-busy", "true");
  const error = form.querySelector("[data-form-error]");
  if (error) error.textContent = "";
  const finish = beginLoading({ trigger: button });
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
/** Selo de estado da mesa: aberta, pausada (vazia ou pelo mestre) ou fechada. Rótulos são constantes do código. */
export function liveBadge(online, paused, offline = "Offline", label = "ONLINE") {
  if (!online) return `<span class="offline-badge" data-tip="Nenhuma sessão está aberta nesta campanha.">${offline}</span>`;
  if (paused)
    return '<span class="status-chip" data-tip="Sessão aberta e pausada: mesa vazia ou pausa do mestre. O mestre retoma.">⏸ Pausada</span>';
  return `<span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>${label}</span>`;
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
// Contagem de caracteres: todo campo de texto com maxlength dentro de um .field mostra "usados/limite".
// Textos longos (textarea) mostram sempre; campos de uma linha, ao focar ou perto do limite. A contagem fica no canto
// da linha do rótulo (sem mudar a altura do campo) e entra na descrição acessível.
const COUNTED = 'textarea[maxlength], input[maxlength]:is([type="text"], [type="search"], [type="url"], [type="email"], :not([type]))';
let counterSequence = 0;
function updateCounter(control) {
  const counter = control.dataset.counter && document.getElementById(control.dataset.counter);
  if (!counter) return;
  const max = Number(control.maxLength) || 0;
  const used = control.value.length;
  counter.textContent = `${used.toLocaleString("pt-BR")}/${max.toLocaleString("pt-BR")}`;
  counter.setAttribute("aria-label", `${used} de ${max} caracteres`);
  counter.classList.toggle("near", used >= max * 0.9);
  counter.classList.toggle("full", used >= max);
}
function attachCounter(control) {
  if (control.dataset.counter || control.dataset.noCount !== undefined || !(control.maxLength > 0)) return;
  const field = control.closest(".field");
  if (!field || field.querySelector(".char-count")) return;
  const counter = document.createElement("small");
  counter.className = `char-count${control.tagName === "TEXTAREA" ? "" : " single"}`;
  counter.id = `char-count-${++counterSequence}`;
  control.dataset.counter = counter.id;
  control.setAttribute("aria-describedby", [control.getAttribute("aria-describedby"), counter.id].filter(Boolean).join(" "));
  field.classList.add("has-count");
  field.append(counter);
  updateCounter(control);
}
export function installCharCounters(root = document.body) {
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches(COUNTED)) attachCounter(node);
    node.querySelectorAll(COUNTED).forEach(attachCounter);
  };
  scan(root);
  new MutationObserver((changes) => { for (const change of changes) change.addedNodes.forEach(scan); }).observe(root, { childList: true, subtree: true });
  const refresh = (event) => { if (event.target.dataset?.counter) updateCounter(event.target); };
  document.addEventListener("input", refresh);
  document.addEventListener("focusin", refresh);
}
export function installUi() {
  installCharCounters();
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
