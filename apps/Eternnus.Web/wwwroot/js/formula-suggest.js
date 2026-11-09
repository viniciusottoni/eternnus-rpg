// Autocompletar de @atributos em campos de fórmula (combobox acessível). Mesmas regras puras do editor de modelos
// (referenceSuggestions/applySuggestion). Sem HTTP: quem chama informa os atributos da ficha que a fórmula aceita.
import { esc } from "./ui.js";
import { referenceSuggestions, applySuggestion } from "./sheet-editor-policy.js";

let sequence = 0;
const VALID = /^[a-z][a-z0-9_]{0,39}$/;

/** Normaliza [{ name, label }] (aceita PascalCase do servidor) e descarta nomes inválidos ou repetidos. */
export function formulaFieldList(fields = []) {
  const seen = new Set();
  return (fields || [])
    .map((f) => ({ name: String(f?.name ?? f?.Name ?? ""), label: String(f?.label ?? f?.Label ?? "") }))
    .filter((f) => VALID.test(f.name) && !seen.has(f.name) && seen.add(f.name));
}

/**
 * Liga o autocompletar a um input de fórmula. Ao digitar "@", lista os atributos; setas escolhem, Enter/Tab inserem,
 * Esc fecha. `fields` é uma lista ou uma função que devolve a lista atual. Devolve a função de descarte.
 */
export function attachFormulaSuggest(input, fields) {
  if (!input || input.dataset.formulaSuggest) return () => {};
  input.dataset.formulaSuggest = "on";
  if (!input.id) input.id = `formula-${++sequence}`;
  // Sem mover o input (moveria o foco): a lista fica logo depois dele e o pai vira a referência de posição.
  const host = input.parentElement;
  host?.classList.add("formula-host");
  const list = document.createElement("ul");
  list.className = "tpl-suggest";
  list.id = `${input.id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Atributos da ficha");
  list.hidden = true;
  input.after(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("autocomplete", "off");
  input.spellcheck = false;
  let state = null;
  const current = () => formulaFieldList(typeof fields === "function" ? fields() : fields);

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    state = null;
  };
  const mark = () => {
    list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === state.active)));
    input.setAttribute("aria-activedescendant", `${list.id}-${state.active}`);
    list.children[state.active]?.scrollIntoView?.({ block: "nearest" });
  };
  const open = () => {
    const all = current();
    const s = referenceSuggestions(input.value, input.selectionStart ?? input.value.length, all.map((f) => f.name));
    if (s.start < 0 || !s.items.length) return close();
    state = { start: s.start, items: s.items, active: 0 };
    list.innerHTML = s.items
      .map((name, i) => `<li role="option" id="${esc(list.id)}-${i}" data-name="${esc(name)}" aria-selected="${i === 0}">@${esc(name)}<small>${esc(all.find((f) => f.name === name)?.label || "")}</small></li>`)
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    mark();
  };
  const pick = (name) => {
    if (!state) return;
    const result = applySuggestion(input.value, state.start, input.selectionStart ?? input.value.length, name);
    input.value = result.text;
    input.setSelectionRange(result.caret, result.caret);
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const onInput = (e) => { if (e.isTrusted !== false) open(); };
  const onKey = (e) => {
    if (!state) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      state.active = (state.active + (e.key === "ArrowDown" ? 1 : -1) + state.items.length) % state.items.length;
      mark();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(state.items[state.active]);
    } else if (e.key === "Escape") {
      // Fecha só a lista, sem fechar o modal.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const onDown = (e) => {
    const li = e.target.closest("li[data-name]");
    if (!li) return;
    e.preventDefault();
    pick(li.dataset.name);
  };
  const onBlur = () => close();
  input.addEventListener("input", onInput);
  input.addEventListener("click", open);
  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", onBlur);
  list.addEventListener("mousedown", onDown);
  return () => {
    input.removeEventListener("input", onInput);
    input.removeEventListener("click", open);
    input.removeEventListener("keydown", onKey);
    input.removeEventListener("blur", onBlur);
    list.removeEventListener("mousedown", onDown);
    list.remove();
    delete input.dataset.formulaSuggest;
  };
}

/**
 * Liga o autocompletar por delegação: cada input que casar com `selector` dentro de `root` é preparado no primeiro foco
 * (serve para linhas adicionadas depois). Devolve o descarte de tudo.
 */
export function formulaSuggestOn(root, selector, fields) {
  const disposers = new Map();
  const onFocus = (e) => {
    const input = e.target.closest?.(selector);
    if (!input || disposers.has(input)) return;
    disposers.set(input, attachFormulaSuggest(input, fields));
  };
  root.addEventListener("focusin", onFocus);
  return () => {
    root.removeEventListener("focusin", onFocus);
    for (const dispose of disposers.values()) dispose();
    disposers.clear();
  };
}
