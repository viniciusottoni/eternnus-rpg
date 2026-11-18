// Ficha na mesa (ADR-099), carregada sob demanda pelo modal da ficha: Resumo com testes que rolam e itens que se usam,
// ficha completa com o mesmo botão de rolar, condições com duração e a visão do grupo do mestre.
// Toda escrita vai ao servidor (SessionService confere papel, dono e recurso); aqui só a apresentação.
import { api } from "./api.js";
import { esc, button, toast, formError, submitForm, modal, formatDate } from "./ui.js";
import { renderSheet } from "./pdf-sheet.js";
import { renderCompactSheet } from "./sheet-compact.js";
import { rollFormulas, rollLabel } from "./sheet-roll-policy.js";
import { summaryOf, suggestUse } from "./sheet-compact-policy.js";
import { isListField, lineFieldNames, describedCount } from "./item-notes-policy.js";
import { openItemNotes, closeItemNotes, stackedDialog, closeStacked } from "./item-notes.js";
import { helpButton } from "./help.js";
import { computeSheet } from "./formula.js";

const EFFECT_MAX = 12;

/** Texto curto das condições com duração: "Abalado · 2, Caído". */
export function effectsText(effects) {
  return (effects || []).map((e) => `${e.name}${e.rounds ? ` · ${e.rounds}` : ""}`).join(", ");
}

/**
 * Monta Resumo + ficha completa no contêiner do modal. `c` = GET /sessions/{id}/characters/{id}.
 * `canAct`: mestre ou dono jogando com a ficha (o servidor confere de novo). Devolve a função de descarte.
 */
export function mountTableSheet(host, { c, base, master, canAct }) {
  const sheet = c.sheet;
  const fields = sheet.version.fields;
  // Mesmos calculados da ficha completa (o servidor também os envia; recalcular mantém o Resumo coerente).
  const values = computeSheet(fields, { ...sheet.values, ...sheet.computed });
  const notes = sheet.notes || {};
  const formulas = rollFormulas(fields);
  host.innerHTML = `<div class="ts-tabs" role="group" aria-label="Apresentação da ficha">${button("Resumo", "ts-view", "compact", "subtle small", 'aria-pressed="true"')}${button("Ficha completa", "ts-view", "full", "subtle small", 'aria-pressed="false"')}${helpButton("mesa.ficha.resumo", "Resumo da ficha na mesa")}</div><div class="ts-compact"></div><div class="ts-full" hidden></div>`;
  const compactHost = host.querySelector(".ts-compact"), fullHost = host.querySelector(".ts-full");

  async function roll(field, formula) {
    try {
      const body = { formula, label: rollLabel(field), characterId: c.id };
      if (master) body.visibility = "table";
      const r = await api(`${base}/rolls`, "POST", body, { background: true });
      toast(r?.hidden ? "Rolagem enviada ao mestre." : `${rollLabel(field)}: ${r?.total ?? "?"}`);
    } catch (error) { toast(error.message); }
  }
  const use = canAct ? (item) => useItemDialog({ c, base, item, resources: summaryOf(fields, values).resources.filter((r) => fields.find((f) => f.name === r.field)?.type === "number") }) : null;
  // Recurso marcado ou reserva com par "_max": o servidor aceita qualquer campo numérico editável da ficha.
  const compact = renderCompactSheet(compactHost, {
    fields, values, notes, canRoll: canAct, canUse: canAct,
    onRoll: (r) => roll({ label: r.label, name: r.field }, r.formula),
    onUse: use,
  });
  let full = null;
  function showFull() {
    if (full) return;
    full = renderSheet(fullHost, {
      pdfUrl: sheet.version.pdfUrl, pages: sheet.version.pages, fields, mode: "view", values,
      isList: isListField,
      isLines: ((names) => (f) => names.has(f.name))(lineFieldNames(fields, sheet.version.pages)),
      notes: { count: (f, value) => describedCount(value, notes), text: (key) => notes[key] || "", open: (f, value) => openItemNotes({ label: f.label || f.name, value, notes, onUse: use }) },
      roll: canAct ? { formula: (f) => formulas.get(f.name) || null, run: (f, formula) => roll(f, formula) } : null,
    });
  }
  const onClick = (event) => {
    const b = event.target.closest('[data-action="ts-view"]');
    if (!b) return;
    const compactOn = b.dataset.id === "compact";
    compactHost.hidden = !compactOn; fullHost.hidden = compactOn;
    for (const x of host.querySelectorAll('[data-action="ts-view"]')) x.setAttribute("aria-pressed", String(x === b));
    if (!compactOn) showFull();
  };
  host.addEventListener("click", onClick);
  return () => { host.removeEventListener("click", onClick); compact.destroy(); full?.destroy(); closeItemNotes(); closeStacked(); };
}

/** "Usar" um item: sugestão tirada da descrição (dados e custo), conferida e ajustada pelo jogador antes de enviar. */
export function useItemDialog({ c, base, item, resources }) {
  const hint = suggestUse(item.note, resources);
  const options = `<option value="">Sem custo</option>${resources.map((r) => `<option value="${esc(r.field)}" ${r.field === hint.field ? "selected" : ""}>${esc(r.label)} (${esc(String(r.value))}${r.max != null ? ` / ${esc(String(r.max))}` : ""})</option>`).join("")}`;
  const body = stackedDialog(`Usar: ${item.text}`, `<form class="use-item-form">${item.note ? `<p class="use-note">${esc(item.note)}</p>` : ""}<div class="field"><label for="use-formula">Rolagem (opcional)</label><input id="use-formula" name="formula" maxlength="300" value="${esc(hint.formula)}" placeholder="Ex.: 6d6 ou 1d20 + @luta" autocomplete="off"></div><div class="hp-row"><div class="field"><label for="use-field">Recurso gasto</label><select id="use-field" name="field">${options}</select></div><div class="field"><label for="use-cost">Custo</label><input id="use-cost" name="cost" type="number" min="1" max="1000" inputmode="numeric" value="${hint.cost ?? ""}"></div></div><p class="form-help">${helpButton("mesa.ficha.usar", "Usar item da ficha")} Sugestão tirada da descrição: confira antes de usar. O custo e a rolagem entram num registro só; sem saldo, nada é gasto.</p>${formError()}<div class="form-actions">${button("Cancelar", "use-cancel", "", "subtle", "data-notes-close")}<button type="submit" class="primary">Usar</button></div></form>`);
  const form = body.querySelector("form");
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async (data) => {
      const field = data.field || null;
      const cost = field ? Number(data.cost) : null;
      if (field && !(cost >= 1 && cost <= 1000)) throw new Error("Informe um custo de 1 a 1.000 ou escolha “Sem custo”.");
      const r = await api(`${base}/characters/${c.id}/use-item`, "POST", { item: item.text, formula: data.formula.trim() || null, field, cost }, { background: true });
      closeStacked();
      toast(r?.hidden ? `${item.text}: rolagem enviada ao mestre.` : r?.total != null ? `${item.text}: ${r.total}` : `${item.text} usado.`);
    });
  };
}

/** Condições com duração (rodadas descontadas no turno do personagem). Mestre ou dono. */
export function effectsDialog({ base, characterId, name, effects, onSaved = () => {} }) {
  const row = (e = {}, i = 0) => `<li class="effect-row"><div class="field"><label for="ef-name-${i}">Condição</label><input id="ef-name-${i}" data-ef="name" maxlength="40" value="${esc(e.name || "")}" placeholder="Ex.: Abalado"></div><div class="field"><label for="ef-rounds-${i}">Rodadas</label><input id="ef-rounds-${i}" data-ef="rounds" type="number" min="1" max="99" inputmode="numeric" value="${e.rounds ?? ""}" placeholder="sem prazo"></div>${button("Remover", "ef-remove", "", "subtle small", `aria-label="Remover condição ${esc(e.name || "")}"`)}</li>`;
  const body = stackedDialog(`Condições de ${name}`, `<form class="effects-form"><p class="form-help">${helpButton("mesa.condicoes.duracao", "Condições com duração")} Cada condição perde uma rodada quando o turno chega ao personagem e sai ao chegar a zero. Sem rodadas, fica até alguém remover. Até ${EFFECT_MAX}.</p><ol class="effect-list">${(effects || []).map(row).join("")}</ol>${button("+ Adicionar condição", "ef-add", "", "subtle small")}${formError()}<div class="form-actions">${button("Cancelar", "ef-cancel", "", "subtle", "data-notes-close")}<button type="submit" class="primary">Salvar condições</button></div></form>`);
  const form = body.querySelector("form"), list = body.querySelector(".effect-list");
  let next = (effects || []).length;
  body.onclick = (event) => {
    const b = event.target.closest("[data-action]");
    if (b?.dataset.action === "ef-remove") b.closest(".effect-row").remove();
    if (b?.dataset.action === "ef-add") {
      if (list.children.length >= EFFECT_MAX) return toast(`Até ${EFFECT_MAX} condições por ficha.`);
      list.insertAdjacentHTML("beforeend", row({}, next++));
      list.lastElementChild.querySelector("input")?.focus();
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async () => {
      const items = [...list.querySelectorAll(".effect-row")].map((r) => {
        const rounds = r.querySelector('[data-ef="rounds"]').value.trim();
        return { name: r.querySelector('[data-ef="name"]').value.trim(), rounds: rounds ? Number(rounds) : null };
      }).filter((e) => e.name);
      await api(`${base}/characters/${characterId}/effects`, "POST", { effects: items }, { background: true });
      closeStacked();
      toast("Condições atualizadas.");
      onSaved(items);
    });
  };
}

/** Visão do grupo (mestre): todas as fichas vinculadas à campanha numa tabela, sem abrir uma por uma. */
export async function partyModal({ campaignId }) {
  const data = await api(`/campaigns/${campaignId}/party`);
  const resourceText = (list) => (list || []).map((r) => `${esc(r.label)}: <b>${esc(String(r.value))}${r.max != null ? ` / ${esc(String(r.max))}` : ""}</b>`).join("<br>");
  const statText = (list) => (list || []).map((s) => `${esc(s.label)}: <b>${esc(s.value)}</b>`).join("<br>");
  const rows = data.items.map((p) => `<tr><th scope="row">${esc(p.name)}<small>${esc(p.player)}${p.private ? " · ficha privada" : ""}</small></th><td>${resourceText(p.resources) || "—"}</td><td>${statText(p.stats) || "—"}</td><td>${p.armor ? `${esc(p.armor.label)}: <b>${esc(p.armor.value)}</b>` : "—"}</td><td>${p.perception ?? "—"}</td><td>${[p.conditions ? esc(p.conditions) : "", p.effects?.length ? esc(effectsText(p.effects)) : ""].filter(Boolean).join("<br>") || "—"}</td><td><small>${formatDate(p.updatedAt)}</small></td></tr>`).join("");
  modal("Visão do grupo", data.items.length
    ? `<p class="modal-lead">${helpButton("mesa.grupo.visao", "Visão do grupo")} Fichas vinculadas à campanha, como estão agora. Só o mestre vê esta tabela.</p><div class="party-table-wrap"><table class="party-table"><caption class="sr-only">Recursos, destaques e condições de cada personagem</caption><thead><tr><th scope="col">Personagem</th><th scope="col">Recursos</th><th scope="col">Destaques</th><th scope="col">Armadura</th><th scope="col">Percepção</th><th scope="col">Condições</th><th scope="col">Atualizada</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="muted">Nenhuma ficha vinculada a esta campanha ainda.</p>`);
}
