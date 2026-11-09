import { helpButton } from "./help.js";
// Preferência Básica/Completa do mestre: mesmo controle no editor de cenas e na mesa. Troca imediata, sem recarregar;
// grava em segundo plano na conta. Não altera regras, visibilidade nem a mesa dos jogadores.
import { api } from "./api.js";
import { state } from "./state.js";
import { esc, toast } from "./ui.js";
import { INTERFACE_MODES, normalizeInterface } from "./scene-policy.js";

const listeners = new Set();

export const interfaceMode = () => normalizeInterface(state.user?.interfaceMode);

/** Controle "Interface: [ Básica | Completa ]" (grupo de opções com rótulos visíveis). */
export function interfaceToggle(id) {
  const current = interfaceMode();
  return `<fieldset class="interface-toggle" data-interface-toggle><legend>Interface${helpButton("mesa.interface.apresentacao", "Interface Básica e Completa")}</legend>${INTERFACE_MODES.map(([value, label, help]) => `<label class="interface-option"><input type="radio" name="${esc(id)}" value="${value}" ${value === current ? "checked" : ""} aria-describedby="${esc(id)}-${value}"><span>${label}</span><small class="form-help" id="${esc(id)}-${value}">${esc(help)}</small></label>`).join("")}</fieldset>`;
}

/** Liga os controles dentro de `root`. Devolve a função de descarte. */
export function mountInterfaceToggle(root) {
  const onChange = (e) => {
    const input = e.target.closest("[data-interface-toggle] input");
    if (input?.checked) setInterfaceMode(input.value);
  };
  root.addEventListener("change", onChange);
  const sync = (mode) => root.querySelectorAll("[data-interface-toggle] input").forEach((i) => (i.checked = i.value === mode));
  listeners.add(sync);
  return () => { root.removeEventListener("change", onChange); listeners.delete(sync); };
}

/** Assina mudanças (editor e mesa ficam sincronizados). Devolve a função de descarte. */
export function onInterfaceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let saving = Promise.resolve();
export function setInterfaceMode(value) {
  const mode = normalizeInterface(value);
  if (state.user) state.user.interfaceMode = mode;
  for (const fn of [...listeners]) fn(mode);
  // Gravação em segundo plano: a troca visual já aconteceu e não depende da rede.
  saving = saving.then(() => api("/auth/preferences", "PUT", { interfaceMode: mode }, { background: true })).catch(() => toast("A interface mudou nesta tela, mas não foi possível lembrar a escolha na sua conta."));
  return mode;
}
