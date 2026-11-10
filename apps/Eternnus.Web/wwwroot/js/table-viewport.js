import { esc, toast } from "./ui.js";
import { helpButton } from "./help.js";

// O mesmo limite governa os painéis no CSS, inclusive celulares deitados > 900 px.
export const COMPACT_TABLE = "(max-width: 900px), (max-width: 1200px) and (pointer: coarse)";

export function mountTableViewport(root, campaignId) {
  const shell = root.querySelector(".table-shell");
  const phone = matchMedia("(pointer: coarse) and (max-width: 1200px)");
  const portrait = matchMedia("(orientation: portrait)");
  const compact = matchMedia(COMPACT_TABLE);
  const gate = document.createElement("section");
  gate.className = "table-rotate";
  gate.hidden = true;
  gate.setAttribute("aria-labelledby", "rotate-title");
  gate.innerHTML = `<div class="metal"><span class="rotate-phone" aria-hidden="true">▯ ↻ ▭</span><h1 id="rotate-title" tabindex="-1">Vire o celular para jogar${helpButton("mesa.tela.horizontal", "Mesa na horizontal")}</h1><p>A mesa é usada com o celular deitado para manter o mapa e os comandos visíveis.</p><p id="rotate-status" role="status">Ative a rotação automática do aparelho e vire a tela. Se disponível, use tela cheia para fixar a orientação.</p><button type="button" class="primary" id="rotate-enter" aria-describedby="rotate-status">Entrar em tela cheia</button><a class="button subtle" href="#campaign/${esc(campaignId)}">Voltar à campanha</a></div>`;
  root.append(gate);
  const full = root.querySelector("#t-fullscreen");
  const enter = gate.querySelector("button#rotate-enter");
  const status = gate.querySelector("#rotate-status");
  let disposed = false, locked = false, ownedFullscreen = false, busy = false;
  let previousFocus;
  const canFullscreen = !!document.documentElement.requestFullscreen && document.fullscreenEnabled;
  enter.hidden = !canFullscreen;
  const palette = shell.querySelector("#t-fog");
  const paletteSize = new ResizeObserver(() => {
    if (!palette.hidden) shell.querySelector("#main").style.setProperty("--fog-h", `${palette.offsetTop + palette.offsetHeight + 6}px`);
  });
  paletteSize.observe(palette);

  function feedback(message) {
    status.textContent = message;
    if (gate.hidden) toast(message);
  }

  function sync() {
    if (disposed) return;
    const blocked = phone.matches && portrait.matches;
    const changed = gate.hidden === blocked;
    shell.inert = blocked;
    gate.hidden = !blocked;
    root.classList.toggle("table-needs-rotation", blocked);
    full.hidden = !compact.matches || !canFullscreen;
    full.textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
    full.setAttribute("aria-pressed", String(!!document.fullscreenElement));
    shell.querySelector("#t-tools").setAttribute("aria-orientation", compact.matches ? "horizontal" : "vertical");
    if (changed && blocked) {
      previousFocus = document.activeElement;
      gate.querySelector("h1").focus({ preventScroll: true });
    } else if (changed && !blocked) {
      (previousFocus?.isConnected && shell.contains(previousFocus) ? previousFocus : shell.querySelector("#main")).focus({ preventScroll: true });
    }
  }

  async function lock() {
    if (!phone.matches || !screen.orientation?.lock) return false;
    try {
      await screen.orientation.lock("landscape");
      if (disposed) { screen.orientation.unlock(); return false; }
      locked = true;
      return true;
    } catch { return false; }
  }

  async function fullscreen() {
    if (busy || disposed) return;
    busy = true;
    enter.disabled = full.disabled = true;
    enter.setAttribute("aria-busy", "true");
    try {
      if (document.fullscreenElement) {
        if (locked) { screen.orientation.unlock(); locked = false; }
        await document.exitFullscreen();
        ownedFullscreen = false;
      } else {
        await document.documentElement.requestFullscreen();
        ownedFullscreen = true;
        if (disposed) { await document.exitFullscreen(); return; }
        if (!await lock() && phone.matches && portrait.matches) feedback("Vire o celular manualmente e ative a rotação automática do aparelho. Este navegador não fixou a orientação.");
      }
    } catch {
      feedback("A tela cheia não está disponível. Ative a rotação automática do aparelho e vire o celular para continuar.");
    } finally {
      busy = false;
      enter.disabled = full.disabled = false;
      enter.removeAttribute("aria-busy");
      sync();
    }
  }

  full.addEventListener("click", fullscreen);
  enter.addEventListener("click", fullscreen);
  for (const query of [phone, portrait, compact]) query.addEventListener("change", sync);
  document.addEventListener("fullscreenchange", sync);
  sync();
  // Standalone pode permitir sem gesto; a recusa normal mantém a orientação manual.
  void lock();
  return () => {
    if (disposed) return;
    disposed = true;
    for (const query of [phone, portrait, compact]) query.removeEventListener("change", sync);
    document.removeEventListener("fullscreenchange", sync);
    paletteSize.disconnect();
    full.removeEventListener("click", fullscreen);
    enter.removeEventListener("click", fullscreen);
    if (locked) { try { screen.orientation.unlock(); } catch {} }
    if (ownedFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    shell.inert = false;
    root.classList.remove("table-needs-rotation");
    gate.remove();
  };
}
