// One visual and one lifetime controller for the opening and all foreground work.
let opening = true;
let maintenance = false;
let normalHeading, normalMessage;
const pending = new Set();
let splash, previousFocus;
const locked = new Map();

function render() {
  if (!splash) return;
  const visible = opening || maintenance || pending.size > 0;
  splash.dataset.mode = opening || maintenance ? "opening" : "operation";
  splash.setAttribute("aria-label", maintenance ? "Atualização do Eternnus RPG" : opening ? "Abertura do Eternnus RPG" : "Carregando sua mesa");
  splash.querySelector(".splash-content h1").textContent = maintenance ? "Atualizando sua mesa…" : normalHeading;
  splash.querySelector(".splash-content > p").textContent = maintenance ? "Sua jornada continua após a atualização." : normalMessage;
  if (visible) {
    if (!splash.matches(":popover-open")) {
      previousFocus = document.activeElement;
      splash.showPopover();
    }
    for (const node of document.querySelectorAll("body > :not(#splash)")) {
      if (!locked.has(node)) locked.set(node, node.inert);
      node.inert = true;
    }
    document.querySelector("#app")?.setAttribute("aria-busy", "true");
  } else {
    if (splash.matches(":popover-open")) splash.hidePopover();
    for (const [node, inert] of locked) node.inert = inert;
    locked.clear();
    document.querySelector("#app")?.removeAttribute("aria-busy");
    if (previousFocus?.isConnected && !previousFocus.closest("[inert]"))
      previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
}
export function installLoading() {
  splash = document.querySelector("#splash");
  normalHeading = splash.querySelector(".splash-content h1").textContent;
  normalMessage = splash.querySelector(".splash-content > p").textContent;
  splash.setAttribute("popover", "manual");
  document.querySelector("#modal")?.addEventListener("cancel", (event) => {
    if (opening || pending.size) event.preventDefault();
  });
  render();
}
export function endOpening() {
  opening = false;
  render();
}
export function beginLoading() {
  const token = Symbol();
  pending.add(token);
  render();
  return () => {
    pending.delete(token);
    render();
  };
}
export async function withLoading(task) {
  const finish = beginLoading();
  try {
    return await task();
  } finally {
    finish();
  }
}

// The maintenance overlay does not navigate or reload the current SPA.
// DOM edits remain in the same tab; only server-committed data survives a browser reload.
export function setMaintenance(active) {
  maintenance = Boolean(active);
  render();
}
