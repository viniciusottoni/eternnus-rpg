// One visual and one lifetime controller for the opening and all foreground work.
let opening = true;
let maintenance = false;
let normalHeading, normalMessage;
const pending = new Set();
let splash, previousFocus;
const locked = new Map();

// Operações rápidas não piscam a tela: a interface trava na hora, mas a superfície só aparece se a espera passar
// deste limite. Não atrasa a ação; abertura e manutenção continuam imediatas.
export const OPERATION_REVEAL_MS = 300;
let revealTimer = null;

function lock() {
  if (!locked.size) previousFocus = document.activeElement;
  for (const node of document.querySelectorAll("body > :not(#splash)")) {
    if (!locked.has(node)) locked.set(node, node.inert);
    node.inert = true;
  }
  document.querySelector("#app")?.setAttribute("aria-busy", "true");
}

function render() {
  if (!splash) return;
  const visible = opening || maintenance || pending.size > 0;
  const immediate = opening || maintenance;
  splash.dataset.mode = immediate ? "opening" : "operation";
  splash.setAttribute("aria-label", maintenance ? "Atualização do Eternnus RPG" : opening ? "Abertura do Eternnus RPG" : "Carregando sua mesa");
  const heading = splash.querySelector?.(".splash-content h1");
  const message = splash.querySelector?.(".splash-content > p");
  if (heading) heading.textContent = maintenance ? "Atualizando sua mesa…" : normalHeading;
  if (message) message.textContent = maintenance ? "Sua jornada continua após a atualização." : normalMessage;
  if (visible) {
    lock();
    if (splash.matches(":popover-open")) return;
    if (immediate) {
      clearTimeout(revealTimer);
      revealTimer = null;
      splash.showPopover();
    } else if (!revealTimer) {
      // Trava já; a superfície só aparece se a operação ainda estiver pendente depois do limite.
      revealTimer = setTimeout(() => {
        revealTimer = null;
        if (pending.size && !splash.matches(":popover-open")) splash.showPopover();
      }, OPERATION_REVEAL_MS);
    }
  } else {
    clearTimeout(revealTimer);
    revealTimer = null;
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
  normalHeading = splash.querySelector?.(".splash-content h1")?.textContent ?? "Carregando sua mesa…";
  normalMessage = splash.querySelector?.(".splash-content > p")?.textContent ?? "O próximo capítulo está prestes a começar.";
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
