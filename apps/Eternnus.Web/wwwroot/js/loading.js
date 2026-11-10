// One visual and one lifetime controller for the opening and all foreground work.
// Modos (data-mode no #splash):
// - "opening": abertura e manutenção — superfície opaca com o cenário, imediata.
// - "route": troca de tela — camada translúcida por cima da tela atual, com a animação e os textos, sem o cenário de fundo.
// - "action": clique/envio — a tela escurece levemente e trava; o botão acionado mostra um círculo girando.
let opening = true;
let maintenance = false;
let normalHeading, normalMessage;
const pending = new Map();
let splash, previousFocus;
const locked = new Map();
const busyTriggers = new Set();
let lastPress = null;

// Operações rápidas não piscam a tela: a interface trava na hora, mas a camada só aparece se a espera passar
// deste limite. Não atrasa a ação; abertura e manutenção continuam imediatas.
export const OPERATION_REVEAL_MS = 200;
// Chamadas encadeadas (uma termina e a próxima começa em seguida) mantêm a mesma camada, sem apagar e reacender.
// A trava sai na hora; só a camada visível espera este intervalo antes de sumir.
export const SETTLE_MS = 40;
// Um clique só associa o botão à espera iniciada logo em seguida.
const PRESS_WINDOW_MS = 1000;
let revealTimer = null;
let settleTimer = null;
let shownMode = null;

const TRIGGERS = "button, a.button, [role='button'], input[type='submit']";

function lock() {
  if (!locked.size) previousFocus = document.activeElement;
  for (const node of document.querySelectorAll("body > :not(#splash)")) {
    if (!locked.has(node)) locked.set(node, node.inert);
    node.inert = true;
  }
  document.querySelector("#app")?.setAttribute("aria-busy", "true");
}

function unlock() {
  for (const [node, inert] of locked) node.inert = inert;
  locked.clear();
  document.querySelector("#app")?.removeAttribute("aria-busy");
  if (previousFocus?.isConnected && !previousFocus.closest("[inert]"))
    previousFocus.focus({ preventScroll: true });
  previousFocus = null;
}

function markBusy(trigger) {
  if (!trigger?.isConnected || busyTriggers.has(trigger)) return;
  busyTriggers.add(trigger);
  trigger.classList?.add("is-busy");
  trigger.setAttribute?.("aria-busy", "true");
}

function clearBusy() {
  for (const trigger of busyTriggers) {
    trigger.classList?.remove("is-busy");
    trigger.removeAttribute?.("aria-busy");
  }
  busyTriggers.clear();
}

function currentMode() {
  if (opening || maintenance) return "opening";
  for (const { kind } of pending.values()) if (kind === "route") return "route";
  return "action";
}

function hide() {
  clearTimeout(revealTimer);
  revealTimer = null;
  clearTimeout(settleTimer);
  settleTimer = null;
  if (splash.matches(":popover-open")) splash.hidePopover();
  clearBusy();
}

function render() {
  if (!splash) return;
  const visible = opening || maintenance || pending.size > 0;
  const mode = currentMode();
  splash.dataset.mode = mode;
  splash.dataset.trigger = busyTriggers.size ? "button" : "none";
  splash.setAttribute("aria-label", maintenance ? "Atualização do Eternnus RPG" : opening ? "Abertura do Eternnus RPG" : "Carregando sua mesa");
  const heading = splash.querySelector?.(".splash-content h1");
  const message = splash.querySelector?.(".splash-content > p");
  if (heading) heading.textContent = maintenance ? "Atualizando sua mesa…" : normalHeading;
  if (message) message.textContent = maintenance ? "Sua jornada continua após a atualização." : normalMessage;
  if (visible) {
    clearTimeout(settleTimer);
    settleTimer = null;
    shownMode = mode;
    lock();
    if (splash.matches(":popover-open")) return;
    if (mode === "opening") {
      clearTimeout(revealTimer);
      revealTimer = null;
      splash.showPopover();
    } else if (!revealTimer) {
      // Trava já; a camada só aparece se a operação ainda estiver pendente depois do limite.
      revealTimer = setTimeout(() => {
        revealTimer = null;
        if (pending.size && !splash.matches(":popover-open")) splash.showPopover();
      }, OPERATION_REVEAL_MS);
    }
    return;
  }
  unlock();
  clearTimeout(revealTimer);
  revealTimer = null;
  // Nada visível ainda: encerra na hora. Camada visível: espera um instante para emendar chamadas encadeadas.
  if (!splash.matches(":popover-open") || shownMode === "opening") return hide();
  if (!settleTimer) settleTimer = setTimeout(() => { settleTimer = null; if (!pending.size && !opening && !maintenance) hide(); }, SETTLE_MS);
}

export function installLoading() {
  splash = document.querySelector("#splash");
  normalHeading = splash.querySelector?.(".splash-content h1")?.textContent ?? "Carregando sua mesa…";
  normalMessage = splash.querySelector?.(".splash-content > p")?.textContent ?? "O próximo capítulo está prestes a começar.";
  splash.setAttribute("popover", "manual");
  document.querySelector("#modal")?.addEventListener("cancel", (event) => {
    if (opening || pending.size) event.preventDefault();
  });
  // Captura: registra o botão antes de o manipulador da ação iniciar a espera.
  document.addEventListener?.("click", (event) => {
    const trigger = event.target?.closest?.(TRIGGERS);
    lastPress = trigger ? { trigger, at: performance.now() } : null;
  }, true);
  render();
}
export function endOpening() {
  opening = false;
  render();
}

/**
 * Inicia uma espera em primeiro plano. `kind: "route"` para troca de tela; padrão "action".
 * `trigger` é o botão que iniciou a ação (envio de formulário); sem ele, usa o último botão clicado.
 */
export function beginLoading({ kind = "action", trigger = null } = {}) {
  const token = Symbol();
  const routing = [...pending.values()].some((p) => p.kind === "route");
  if (kind === "route") lastPress = null;
  else if (!routing) {
    const recent = lastPress && performance.now() - lastPress.at < PRESS_WINDOW_MS ? lastPress.trigger : null;
    markBusy(trigger || recent);
    lastPress = null;
  }
  pending.set(token, { kind });
  render();
  return () => {
    if (!pending.delete(token)) return;
    render();
  };
}
export async function withLoading(task, options) {
  const finish = beginLoading(options);
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
