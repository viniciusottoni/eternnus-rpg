// Ficha de personagem: formulário com ações criadas pelo jogador e visualização reutilizada pela mesa.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast, navigate } from "./ui.js";
import {
  ACTION_KINDS,
  modifier,
  signed,
  movementSquares,
  hpState,
} from "./session-policy.js";

export const EMPTY_SHEET = Object.freeze({
  name: "",
  archetype: "",
  level: 1,
  hp: 10,
  maxHp: 10,
  strength: 10,
  agility: 10,
  constitution: 10,
  intellect: 10,
  armor: 10,
  movement: 9,
  notes: "",
  actions: [],
  revision: 0,
});
const NUMBERS = [
  ["level", "Nível", 1, 1000],
  ["maxHp", "Vida máxima", 1, 100000],
  ["hp", "Vida atual", 0, 100000],
  ["strength", "Força", 0, 1000],
  ["agility", "Destreza", 0, 1000],
  ["constitution", "Constituição", 0, 1000],
  ["intellect", "Intelecto", 0, 1000],
  ["armor", "Armadura", 0, 1000],
  ["movement", "Movimento (m)", 0, 300],
];
const KIND_NAMES = {
  ataque: "Ataque",
  habilidade: "Habilidade",
  magia: "Magia",
  item: "Item",
};
const kindLabel = (kind) => KIND_NAMES[kind] || kind;

function actionRow(a = {}, index = 0) {
  const id = "a" + index + "-" + Math.random().toString(36).slice(2, 7);
  return `<fieldset class="action-row" data-action-id="${esc(a.id || "")}"><legend class="sr-only">Ação</legend><div class="field"><label for="${id}-n">Nome</label><input id="${id}-n" data-k="name" maxlength="60" required value="${esc(a.name || "")}" placeholder="Golpe brutal"></div><div class="field"><label for="${id}-k">Tipo</label><select id="${id}-k" data-k="kind">${ACTION_KINDS.map(([k]) => `<option value="${k}" ${a.kind === k ? "selected" : ""}>${kindLabel(k)}</option>`).join("")}</select></div><div class="field"><label for="${id}-f">Dados</label><input id="${id}-f" data-k="formula" maxlength="300" value="${esc(a.formula || "")}" placeholder="1d20+3" pattern="\\s*\\d{1,3}\\s*[dD]\\s*\\d{1,4}\\s*((\\+|-)\\s*\\d{1,4})?\\s*" title="Ex.: 1d20+3. Deixe vazio para ação narrativa."></div><div class="field wide"><label for="${id}-d">Efeito</label><input id="${id}-d" data-k="description" maxlength="300" value="${esc(a.description || "")}" placeholder="O que acontece quando a ação é usada"></div>${button("✕", "sheet-action-remove", "", "icon-button", 'aria-label="Remover ação"')}</fieldset>`;
}

export function sheetFormHtml(c = EMPTY_SHEET) {
  return `<form id="sheet-form" class="sheet-form"><div class="form-grid two">${field("name", "Nome do personagem", c.name, 'required maxlength="100"')}${field("archetype", "Classe / arquétipo", c.archetype, 'maxlength="80"')}</div><div class="form-grid stats">${NUMBERS.map(([k, l, min, max]) => field(k, l, c[k] ?? EMPTY_SHEET[k], `type="number" required min="${min}" max="${max}" inputmode="numeric"`)).join("")}</div><div class="sheet-actions-head"><h3>Ações da ficha</h3>${button("+ Adicionar ação", "sheet-action-add", "", "subtle small")}</div><p class="form-help">Ataques, habilidades, magias e itens ficam disponíveis no seu turno. O servidor rola os dados informados.</p><div id="sheet-actions">${(c.actions || []).map(actionRow).join("")}</div><div class="field"><label for="f-notes">História, inventário e anotações</label><textarea id="f-notes" name="notes" maxlength="10000" rows="4">${esc(c.notes || "")}</textarea></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar ficha</button></div></form>`;
}
function field(name, label, value, attrs) {
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${esc(value)}" ${attrs.includes("type=") ? "" : 'type="text"'} ${attrs}></div>`;
}

export function readSheetForm(form, revision = 0) {
  const data = Object.fromEntries(new FormData(form));
  for (const [k] of NUMBERS) data[k] = Number(data[k]);
  data.revision = revision;
  data.actions = [...form.querySelectorAll(".action-row")].map((row) => {
    const value = (k) => row.querySelector(`[data-k="${k}"]`).value.trim();
    return {
      id: row.dataset.actionId || null,
      name: value("name"),
      kind: value("kind"),
      formula: value("formula").replace(/\s+/g, ""),
      description: value("description"),
    };
  });
  return data;
}

/** Abre o editor de ficha. Novas fichas usam POST; existentes enviam a revisão atual. */
export function openSheetEditor(character, onSaved) {
  const table = location.hash.match(/^#table\/([0-9a-f-]{36})$/i);
  navigate("character/" + (character?.id || "new") + (character?.id && table ? "/" + table[1] : ""));
}
// Kept as a compatibility form for older embeds; the application opens the versioned sheet page.
export function openClassicSheetEditor(character, onSaved) {
  const c = character || EMPTY_SHEET;
  modal(
    character ? "Sua ficha de personagem" : "Uma lenda em formação",
    sheetFormHtml(c),
  );
  const form = $("#sheet-form");
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (b?.dataset.action === "sheet-action-add") {
      if (form.querySelectorAll(".action-row").length >= 16)
        return toast("Cada ficha pode ter até 16 ações.");
      $("#sheet-actions").insertAdjacentHTML(
        "beforeend",
        actionRow({}, Date.now()),
      );
      $("#sheet-actions .action-row:last-child input").focus();
    }
    if (b?.dataset.action === "sheet-action-remove")
      b.closest(".action-row").remove();
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async () => {
      const saved = await api(
        "/characters" + (character ? "/" + character.id : ""),
        character ? "PUT" : "POST",
        readSheetForm(form, c.revision),
      );
      $("#modal").close();
      toast("Ficha salva no grimório.");
      await onSaved?.(saved);
    });
  };
}

export function hpBar(hp, maxHp, label = "Vida") {
  const { percent, tone } = hpState(hp, maxHp);
  return `<div class="hp-bar ${tone}" data-hp="${percent}" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${esc(maxHp)}" aria-valuenow="${esc(hp)}"><span></span></div>`;
}
/** Aplica a largura das barras após renderizar (CSP não permite estilos inline no HTML). */
export function paintBars(root = document) {
  root
    .querySelectorAll(".hp-bar[data-hp]")
    .forEach((bar) => bar.style.setProperty("--hp", bar.dataset.hp + "%"));
}

export function sheetViewHtml(c, { full = false } = {}) {
  // Custom systems need their own field names; classic attribute defaults are not their actual sheet values.
  if (c.sheet || (c.templateId && c.templateId !== "00000000-0000-4000-8000-000000000101")) {
    const actions = c.sheet?.actions || c.actions || [];
    return `<div class="sheet-view"><header><h3>${esc(c.name)}</h3><p>${esc(c.sheet?.template.name || c.templateName || "Ficha por modelo")} · Nível ${esc(c.level)}</p></header><p>Vida: ${esc(c.hp)} / ${esc(c.maxHp)}</p>${hpBar(c.hp, c.maxHp)}<h4>Ações</h4>${actions.length ? `<ul class="sheet-action-list">${actions.map(a => `<li><div><strong>${esc(a.name)}</strong>${a.formula ? ` <code>${esc(a.formula)}</code>` : ""}<p>${esc(a.description || "")}</p></div></li>`).join("")}</ul>` : "<p>Nenhuma ação definida.</p>"}${c.sheet ? "" : "<p>Abra a ficha completa para consultar todos os campos do modelo.</p>"}</div>`;
  }
  const stat = (label, value, mod) =>
    `<div class="sheet-stat"><span>${label}</span><strong>${esc(value)}${mod === undefined ? "" : ` <small>(${signed(mod)})</small>`}</strong></div>`;
  const actions = (c.actions || []).length
    ? `<ul class="sheet-action-list">${c.actions.map((a) => `<li><span class="kind-chip ${esc(a.kind)}">${esc(kindLabel(a.kind))}</span><div><strong>${esc(a.name)}</strong>${a.formula ? ` <code>${esc(a.formula)}</code>` : ""}${a.description ? `<p>${esc(a.description)}</p>` : ""}</div></li>`).join("")}</ul>`
    : '<p class="muted small">Nenhuma ação criada. O ataque básico usa Força.</p>';
  return `<div class="sheet-view"><header><h3>${esc(c.name)}</h3><p>${esc(c.archetype || "Aventureiro")} · Nível ${esc(c.level)}</p></header>${stat("Pontos de vida", `${c.hp} / ${c.maxHp}`)}${hpBar(c.hp, c.maxHp)}${stat("Força", c.strength, modifier(c.strength))}${stat("Destreza", c.agility, modifier(c.agility))}${stat("Constituição", c.constitution ?? 10, modifier(c.constitution ?? 10))}${stat("Intelecto", c.intellect, modifier(c.intellect))}${stat("Armadura", c.armor ?? 10)}${stat("Movimento", `${c.movement ?? 9} m · ${movementSquares(c.movement ?? 9)} quadros`)}<h4>Ações</h4>${actions}${full && c.notes ? `<h4>Anotações</h4><p class="sheet-notes">${esc(c.notes)}</p>` : ""}</div>`;
}

/**
 * Avatares enviados são servidos somente ao próprio dono (ver perfil/avatar).
 * Para outros participantes, a imagem cai no avatar padrão em vez de aparecer quebrada.
 */
export function guardAvatars(root = document) {
  root.querySelectorAll("img.avatar:not([data-guarded])").forEach((img) => {
    img.dataset.guarded = "1";
    img.addEventListener(
      "error",
      () => {
        if (!img.src.endsWith("/assets/avatar.svg"))
          img.src = "/assets/avatar.svg";
      },
      { once: true },
    );
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src"))
      img.src = "/assets/avatar.svg";
  });
}
