// Ficha compacta (ADR-099): recursos, destaques, testes que rolam e listas com descrições, sem abrir o PDF.
// Usada na página da ficha (alternativa "Resumo") e na mesa. Valores do usuário entram só escapados (esc) ou por textContent;
// larguras das barras por CSSOM (CSP sem estilos inline).
import { esc } from "./ui.js";
import { compactModel } from "./sheet-compact-policy.js";
import { signed } from "./sheet-roll-policy.js";

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/**
 * renderCompactSheet(host, { fields, values, notes, canRoll, onRoll(roll), canUse, onUse(item) })
 * roll = { field, label, value, formula }; item = { field, list, key, text, note }.
 * Devolve { update({ values, notes }), destroy() }.
 */
export function renderCompactSheet(host, options) {
  let opts = { ...options };
  let model = null;
  function draw() {
    model = compactModel(opts.fields, opts.values, opts.notes || {});
    const resources = model.resources.map((r) => {
      const text = r.max != null ? `${fmt(r.value)} / ${fmt(r.max)}` : fmt(r.value);
      const share = r.max > 0 ? Math.max(0, Math.min(1, r.value / r.max)) : null;
      return `<li class="sc-resource"><span class="sc-name">${esc(r.label)}</span><strong>${esc(text)}</strong>${share != null ? `<span class="sc-bar" role="meter" aria-label="${esc(r.label)}" aria-valuemin="0" aria-valuemax="${esc(fmt(r.max))}" aria-valuenow="${esc(fmt(r.value))}"><span data-share="${share}"></span></span>` : ""}</li>`;
    }).join("");
    const stats = model.stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join("");
    const rolls = model.rolls.map((r) => opts.canRoll
      ? `<li><button type="button" class="sc-roll" data-sc-roll="${esc(r.field)}" aria-label="Rolar ${esc(r.label)} (${esc(r.formula)})" data-tip="${esc(r.formula)}"><span>${esc(r.label)}</span><b>${esc(signed(r.value))}</b></button></li>`
      : `<li class="sc-roll-static"><span>${esc(r.label)}</span><b>${esc(signed(r.value))}</b></li>`).join("");
    const lists = model.lists.map((l) => `<section class="sc-list"><h4>${esc(l.label)}</h4><ul>${l.items.map((item) => {
      const use = opts.canUse ? `<button type="button" class="subtle small sc-use" data-sc-use="${esc(l.field)}" data-key="${esc(item.key)}" aria-label="Usar ${esc(item.text)}">Usar</button>` : "";
      return item.note
        ? `<li class="has-note"><details><summary>${esc(item.text)}</summary><p>${esc(item.note)}</p></details>${use}</li>`
        : `<li><span class="sc-item">${esc(item.text)}</span>${use}</li>`;
    }).join("")}</ul></section>`).join("");
    const empty = !resources && !stats && !rolls && !lists;
    host.innerHTML = empty
      ? `<p class="sc-empty">Esta ficha ainda não tem recursos, testes ou listas preenchidos. Use a ficha completa.</p>`
      : `${resources ? `<ul class="sc-resources">${resources}</ul>` : ""}${stats ? `<dl class="sc-stats">${stats}</dl>` : ""}${rolls ? `<section class="sc-block"><h4>Testes${opts.canRoll ? " · clique para rolar" : ""}</h4><ul class="sc-rolls">${rolls}</ul></section>` : ""}${lists}`;
    for (const bar of host.querySelectorAll("[data-share]")) bar.style.width = `${Math.round(Number(bar.dataset.share) * 100)}%`;
  }
  const onClick = (event) => {
    const roll = event.target.closest("[data-sc-roll]");
    if (roll && host.contains(roll)) {
      const r = model.rolls.find((x) => x.field === roll.dataset.scRoll);
      if (r) opts.onRoll?.(r);
      return;
    }
    const use = event.target.closest("[data-sc-use]");
    if (use && host.contains(use)) {
      const list = model.lists.find((l) => l.field === use.dataset.scUse);
      const item = list?.items.find((i) => i.key === use.dataset.key);
      if (item) opts.onUse?.({ field: list.field, list: list.label, key: item.key, text: item.text, note: item.note });
    }
  };
  host.classList.add("sheet-compact");
  host.addEventListener("click", onClick);
  draw();
  return {
    update(next = {}) { opts = { ...opts, ...next }; draw(); },
    destroy() { host.removeEventListener("click", onClick); host.replaceChildren(); host.classList.remove("sheet-compact"); },
  };
}
