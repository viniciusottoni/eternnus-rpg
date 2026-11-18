/**
 * Busca de ações (Ctrl+K ou "/"): diálogo próprio com combobox + listbox (item N4 de docs/AUDITORIA_SIMPLICIDADE.md).
 * Regras de busca, papel e interface ficam em js/command-palette-policy.js.
 *
 * mountCommandPalette(root, { getCommands, onRun, getContext }) -> dispose()
 *   root         elemento da tela; atalhos só valem enquanto ele estiver no documento.
 *   getCommands  () => Command[]  (formato em command-palette-policy.js); lido a cada abertura.
 *   onRun        async (command) => void; recebe a cópia ranqueada (com needsComplete). Com needsComplete,
 *                quem chama troca para a interface Completa e depois executa. Erros lançados viram toast.
 *   getContext   () => ({ role: "master" | "player", mode: "basic" | "complete" }); lido a cada busca.
 *   dispose      remove o atalho e o <dialog>. Devolver ao roteador junto com o descarte da tela.
 *
 * openCommandPalette() -> boolean
 *   Abre a busca montada mais recente que ainda está no documento (botão visível para toque/celular).
 *   Devolve false se nenhuma estiver montada.
 *
 * O atalho é ignorado enquanto outro <dialog> modal estiver aberto. Executar fecha a busca, devolve o foco ao
 * elemento anterior e só então chama onRun (assim um modal aberto pela ação mantém o foco).
 */
import { esc, toast } from "./ui.js";
import { rankCommands, shouldOpenPalette } from "./command-palette-policy.js";

const mounted = [];
let sequence = 0;

export function openCommandPalette() {
  const instance = [...mounted].reverse().find((item) => item.root.isConnected);
  if (!instance) return false;
  instance.open();
  return true;
}

export function mountCommandPalette(root, { getCommands, onRun, getContext = () => ({}) } = {}) {
  const uid = `command-palette-${++sequence}`;
  const dialog = document.createElement("dialog");
  dialog.className = "command-palette";
  dialog.setAttribute("aria-labelledby", `${uid}-title`);
  dialog.innerHTML = `<div class="modal-head"><h2 id="${uid}-title">Busca de ações</h2><button type="button" class="icon-button command-palette-close" aria-label="Fechar">×</button></div>
<div class="field command-palette-search"><label for="${uid}-input">O que você quer fazer?</label><input id="${uid}-input" type="text" role="combobox" aria-expanded="true" aria-controls="${uid}-list" aria-autocomplete="list" aria-describedby="${uid}-hint" autocomplete="off" spellcheck="false" maxlength="80"><small id="${uid}-hint" class="form-help">↑ ↓ escolhem, Enter executa, Esc fecha.</small></div>
<div id="${uid}-list" class="command-palette-list" role="listbox" aria-label="Ações encontradas"></div>
<p class="command-palette-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input");
  const list = dialog.querySelector('[role="listbox"]');
  const status = dialog.querySelector('[role="status"]');
  let commands = [];
  let results = [];
  let active = -1;
  let previous = null;

  const optionId = (index) => `${uid}-o${index}`;

  function render() {
    const ranked = rankCommands(commands, input.value, getContext() || {});
    // Agrupa pela primeira aparição do grupo, preservando a ordem do ranking dentro de cada grupo.
    const groups = new Map();
    for (const command of ranked) {
      const name = String(command.group || "Ações");
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(command);
    }
    results = [...groups.values()].flat();
    let index = 0;
    list.innerHTML = [...groups].map(([name, items], g) => `<div role="group" aria-labelledby="${uid}-g${g}"><div id="${uid}-g${g}" class="command-palette-group" role="presentation">${esc(name)}</div>${items.map((command) => {
      const i = index++;
      const reason = command.disabled ? `<small class="command-palette-reason">${esc(command.disabled)}</small>` : "";
      const badge = command.needsComplete ? `<span class="command-palette-badge">Completa</span>` : "";
      return `<div id="${optionId(i)}" class="command-palette-option" role="option" data-index="${i}" aria-selected="false"${command.disabled ? ' aria-disabled="true"' : ""}><span class="command-palette-label">${esc(command.label)}${badge}</span>${reason}</div>`;
    }).join("")}</div>`).join("");
    list.hidden = !results.length;
    status.classList.toggle("sr-only", results.length > 0);
    status.textContent = results.length ? `${results.length} ${results.length === 1 ? "ação encontrada" : "ações encontradas"}.` : "Nenhuma ação encontrada.";
    setActive(results.length ? 0 : -1);
  }

  function setActive(index) {
    list.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
    active = index;
    if (index < 0) { input.removeAttribute("aria-activedescendant"); return; }
    const option = document.getElementById(optionId(index));
    option?.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", optionId(index));
    option?.scrollIntoView({ block: "nearest" });
  }

  function open() {
    if (!root.isConnected) return;
    if (!dialog.open) {
      previous = document.activeElement;
      commands = (typeof getCommands === "function" && getCommands()) || [];
      input.value = "";
      render();
      dialog.showModal();
    }
    input.focus();
    input.select();
  }

  function close() {
    if (!dialog.open) return;
    dialog.close();
    if (previous?.isConnected && typeof previous.focus === "function") previous.focus();
    previous = null;
  }

  async function run(index) {
    const command = results[index];
    if (!command) return;
    if (command.disabled) { status.classList.remove("sr-only"); status.textContent = `Indisponível: ${command.disabled}`; return; }
    close();
    try {
      await onRun?.(command);
    } catch (error) {
      toast(error?.message || "Não foi possível executar a ação.");
    }
  }

  function onInputKey(event) {
    const last = results.length - 1;
    const moves = { ArrowDown: active < last ? active + 1 : 0, ArrowUp: active > 0 ? active - 1 : last, Home: 0, End: last };
    if (event.key in moves) {
      event.preventDefault();
      if (results.length) setActive(moves[event.key]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) run(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  function onDocumentKey(event) {
    if (!root.isConnected || !shouldOpenPalette(event)) return;
    // Outro diálogo aberto bloqueia o atalho, exceto o que contém esta tela (ex.: editores dentro de #modal).
    if (!dialog.open && [...document.querySelectorAll("dialog[open]")].some((other) => other !== dialog && !other.contains(root))) return;
    event.preventDefault();
    open();
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", onInputKey);
  list.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) run(Number(option.dataset.index));
  });
  dialog.querySelector(".command-palette-close").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  // Mantém o foco no campo ao clicar em uma opção (inclusive indisponível).
  list.addEventListener("mousedown", (event) => event.preventDefault());
  // Clique no fundo (fora da caixa) fecha; o preenchimento interno do diálogo não conta como fundo.
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  });
  document.addEventListener("keydown", onDocumentKey);

  const instance = { root, open };
  mounted.push(instance);
  return function dispose() {
    document.removeEventListener("keydown", onDocumentKey);
    const at = mounted.indexOf(instance);
    if (at >= 0) mounted.splice(at, 1);
    if (dialog.open) dialog.close();
    dialog.remove();
  };
}
