// One visual and one lifetime controller for the opening and all foreground work.
let opening = true;
const pending = new Set();
let splash, previousFocus;
const locked = new Map();

function render() {
  if (!splash) return;
  const visible = opening || pending.size > 0;
  splash.dataset.mode = opening ? "opening" : "operation";
  splash.setAttribute("aria-label", opening ? "Abertura do Eternnus RPG" : "Carregando sua mesa");
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
