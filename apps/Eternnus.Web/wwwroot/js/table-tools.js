import { helpButton } from "./help.js";
// Ferramentas da mesa carregadas sob demanda: construtor de rolagens, pedidos de teste, ordem de turnos e
// personagens do mestre (as cenas ficam em table-scenes.js). Escritas por api.js; o servidor confere papel, vez e visibilidade.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { DICE, VISIBILITY, diceNotation, specFromForm } from "./play-policy.js";

const radios = (name, options, current) =>
  options.map(([v, l]) => `<label class="check"><input type="radio" name="${name}" value="${esc(v)}" ${v === current ? "checked" : ""}> ${esc(l)}</label>`).join("");

function builderFields(prefix, { visibility = true, label = true } = {}) {
  return `<fieldset class="dice-picker"><legend>Dado</legend><div class="dice-buttons" role="radiogroup" aria-label="Tipo de dado">${DICE.map((d, i) => `<label class="die-choice"><input type="radio" name="sides" value="${d}" ${d === 20 ? "checked" : ""}><span>d${d}</span></label>`).join("")}</div></fieldset>
  <div class="form-grid two"><div class="field"><label for="${prefix}-count">Quantidade</label><input id="${prefix}-count" name="count" type="number" min="1" max="100" value="1" inputmode="numeric" required></div><div class="field"><label for="${prefix}-mod">Modificador</label><input id="${prefix}-mod" name="modifier" type="number" min="-1000" max="1000" value="0" inputmode="numeric"></div></div>
  <details class="roll-more"><summary>Mais opções (manter, explosão, sucessos, percentual)</summary>
  <fieldset class="roll-mechanic"><legend>Como ler o resultado</legend>${helpButton("mesa.rolagem.mecanicas", "Como ler os dados")}${radios("mechanic", [["sum", "Somar os dados"], ["keep", "Manter ou descartar"], ["explode", "Dados explosivos (máximo rola de novo)"], ["success", "Contar sucessos"], ["percent", "Teste percentual (d100)"]], "sum")}</fieldset>
  <div class="form-grid two" data-mech="keep"><div class="field"><label for="${prefix}-keep">Regra</label><select id="${prefix}-keep" name="keep"><option value="kh">Manter os maiores</option><option value="kl">Manter os menores</option><option value="dh">Descartar os maiores</option><option value="dl">Descartar os menores</option></select></div><div class="field"><label for="${prefix}-kc">Quantos dados</label><input id="${prefix}-kc" name="keepCount" type="number" min="1" max="100" value="1"></div></div>
  <div class="form-grid two" data-mech="success"><div class="field"><label for="${prefix}-sa">Sucesso a partir de</label><input id="${prefix}-sa" name="successAt" type="number" min="1" max="1000" value="5"></div><label class="check"><input type="checkbox" name="explodeSuccess"> Explodir no valor máximo</label></div>
  <div class="form-grid two" data-mech="percent"><div class="field"><label for="${prefix}-pt">Alvo (1 a 100)</label><input id="${prefix}-pt" name="percentTarget" type="number" min="1" max="100" value="50"></div><div class="field"><label for="${prefix}-pr">Sucesso quando</label><select id="${prefix}-pr" name="percentRule"><option value="lte">Igual ou menor que o alvo</option><option value="gte">Igual ou maior que o alvo</option></select></div></div>
  <p class="form-help">Explosões têm limite de 100 dados extras por rolagem. Outras mecânicas: o mestre interpreta o resultado.</p></details>
  <details class="roll-more"><summary>Fórmula avançada</summary><div class="field"><div class="field-label"><label for="${prefix}-formula">Fórmula (substitui os dados acima)</label>${helpButton("mesa.rolagem.formula", "Fórmula de rolagem")}</div><input id="${prefix}-formula" name="formula" maxlength="300" placeholder="2d6 + @forca_mod" autocomplete="off"><small class="form-help">Aceita os campos da sua ficha com @nome.</small></div></details>
  ${label ? `<div class="field"><label for="${prefix}-label">Descrição (opcional)</label><input id="${prefix}-label" name="label" maxlength="60" placeholder="Percepção"></div>` : ""}
  ${visibility ? `<fieldset><legend>Quem vê o resultado</legend>${helpButton("mesa.rolagem.visibilidade", "Quem vê a rolagem")}${radios("visibility", VISIBILITY, "table")}</fieldset>` : ""}
  <p class="roll-preview" aria-live="polite"></p>`;
}

function wireBuilder(form) {
  const sync = () => {
    const data = Object.fromEntries(new FormData(form));
    form.querySelectorAll("[data-mech]").forEach((el) => (el.hidden = el.dataset.mech !== (data.mechanic || "sum")));
    let text = "";
    try { text = data.formula?.trim() ? data.formula.trim() : diceNotation(specFromForm(data)); } catch (e) { text = e.message; }
    form.querySelector(".roll-preview").textContent = text ? `Rolagem: ${text}` : "";
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
}

function rollBody(data) {
  if (data.formula?.trim()) return { formula: data.formula.trim(), spec: null };
  return { spec: specFromForm(data), formula: null };
}

/** Construtor visual de rolagens com favoritos. `character` pode ser nulo (mestre). */
export function openRollBuilder({ base, character, onDone, preset }) {
  const favorites = character?.shortcuts?.rolls || [];
  modal(
    "⬡ Rolar dados",
    `<form id="roll-builder">${favorites.length ? `<fieldset class="roll-favorites"><legend>Favoritas</legend>${favorites.map((f, i) => `<button type="button" class="subtle" data-fav="${i}">${esc(f.label)} <small>${esc(f.spec ? diceNotation(f.spec) : f.formula)}</small></button>`).join("")}</fieldset>` : ""}${builderFields("rb")}${character ? `<label class="check"><input type="checkbox" name="favorite"> Guardar nas favoritas (use a descrição como nome)</label>` : ""}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">⬡ Rolar</button></div></form>`,
  );
  const form = $("#roll-builder");
  wireBuilder(form);
  if (preset) for (const [k, v] of Object.entries(preset)) { const el = form.elements[k]; if (el) el.value = v; }
  form.addEventListener("click", async (e) => {
    const fav = e.target.closest("[data-fav]");
    if (!fav) return;
    const f = favorites[Number(fav.dataset.fav)];
    const visibility = new FormData(form).get("visibility") || "table";
    try {
      const result = await api(`${base}/rolls`, "POST", { spec: f.spec || null, formula: f.formula || null, label: f.label, visibility }, { background: true });
      $("#modal").close();
      onDone?.(result);
    } catch (error) { toast(error.message); }
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const body = rollBody(data);
      const result = await api(`${base}/rolls`, "POST", { ...body, label: data.label, visibility: data.visibility || "table" }, { background: true });
      if (data.favorite === "on" && character) {
        const label = (data.label || "").trim() || (body.formula || diceNotation(body.spec));
        const rolls = [...favorites.filter((r) => r.label !== label), { label: label.slice(0, 40), spec: body.spec, formula: body.formula }].slice(-8);
        await api(`/characters/${character.id}/shortcuts`, "PUT", { actions: character.shortcuts?.actions || [], rolls }, { background: true });
      }
      $("#modal").close();
      onDone?.(result);
    });
  };
}

/** Pedido de teste do mestre a personagens selecionados. Sem critério, ninguém declara sucesso ou falha. */
export function openRequestModal({ base, live }) {
  const players = live.participants.filter((p) => !p.isMaster && p.characterId && p.online);
  if (!players.length) return toast("Nenhum personagem conectado para receber o pedido.");
  modal(
    "✦ Pedir um teste",
    `<form id="request-form"><div class="field"><label for="rq-name">Nome do teste</label><input id="rq-name" name="name" maxlength="80" required placeholder="Reflexos"></div><fieldset class="character-checks"><legend>Para quem</legend>${players.map((p) => `<label class="check"><input type="checkbox" name="who" value="${esc(p.characterId)}" checked> ${esc(p.characterName)}</label>`).join("")}</fieldset>${builderFields("rq", { label: false })}<fieldset><legend>Critério (opcional)</legend>${helpButton("mesa.testes.pedidos", "Pedidos de teste")}<div class="form-grid two"><div class="field"><label for="rq-target">Alvo</label><input id="rq-target" name="target" type="number" min="-100000" max="100000" inputmode="numeric" placeholder="Sem critério"></div><div class="field"><label for="rq-rule">Sucesso quando o total for</label><select id="rq-rule" name="rule"><option value="gte">Igual ou maior</option><option value="lte">Igual ou menor</option></select></div></div><small class="form-help">Sem alvo, você interpreta cada resultado.</small></fieldset>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Enviar pedido</button></div></form>`,
  );
  const form = $("#request-form");
  wireBuilder(form);
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const ids = [...form.querySelectorAll("input[name=who]:checked")].map((i) => i.value);
      if (!ids.length) throw new Error("Escolha ao menos um personagem.");
      const body = rollBody(data);
      const target = data.target === "" ? null : Number(data.target);
      await api(`${base}/roll-requests`, "POST", { label: data.name, ...body, visibility: data.visibility || "table", target, rule: target == null ? null : data.rule, characterIds: ids });
      $("#modal").close();
      toast("Pedido enviado. Acompanhe as respostas na aba Rolagens.");
    });
  };
}

/** Ordem de turnos: manual, por iniciativa informada e com grupos. Inclui criaturas do mestre no mapa. */
export function openTurnOrder({ base, live }) {
  const current = live.play?.turnOrder || [];
  const players = live.participants.filter((p) => !p.isMaster && p.characterId);
  const npcs = (live.tokens || []).filter((t) => !t.characterId);
  const entries = [
    ...players.map((p) => ({ key: "c:" + p.characterId, label: p.characterName })),
    ...npcs.map((t) => ({ key: "t:" + t.id, label: t.label })),
  ];
  const rank = (key) => { const i = current.findIndex((e) => e.key === key); return i < 0 ? 999 : i; };
  entries.sort((a, b) => rank(a.key) - rank(b.key));
  const init = (key) => current.find((e) => e.key === key)?.initiative ?? "";
  const included = (key) => !current.length || current.some((e) => e.key === key);
  modal(
    "◉ Ordem de turnos",
    `<form id="order-form"><p class="form-help">Marque quem participa, informe a iniciativa se quiser e use as setas para ajustar. Rolar iniciativa é opcional.</p><ol class="order-list">${helpButton("mesa.turnos.ordem", "Ordem de turnos")}${entries.map((e) => `<li data-key="${esc(e.key)}"><label class="check"><input type="checkbox" name="in" value="${esc(e.key)}" ${included(e.key) ? "checked" : ""}> ${esc(e.label)}</label><label class="sr-only" for="ini-${esc(e.key)}">Iniciativa de ${esc(e.label)}</label><input id="ini-${esc(e.key)}" class="ini" type="number" min="-1000" max="1000" inputmode="numeric" value="${esc(init(e.key))}" placeholder="Inic."><span class="order-moves"><button type="button" class="subtle small" data-move="-1" aria-label="Subir ${esc(e.label)}">↑</button><button type="button" class="subtle small" data-move="1" aria-label="Descer ${esc(e.label)}">↓</button></span></li>`).join("")}</ol><label class="check"><input type="checkbox" name="group"> Jogadores agem juntos como um grupo</label><label class="check"><input type="checkbox" name="sort"> Ordenar pela iniciativa informada</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${current.length ? '<button type="button" class="subtle" data-clear>Voltar à ordem de entrada</button>' : ""}<button type="submit" class="primary">Salvar ordem</button></div></form>`,
  );
  const form = $("#order-form");
  form.addEventListener("click", async (e) => {
    const move = e.target.closest("[data-move]");
    if (move) {
      const li = move.closest("li");
      const sibling = Number(move.dataset.move) < 0 ? li.previousElementSibling : li.nextElementSibling;
      if (sibling) Number(move.dataset.move) < 0 ? sibling.before(li) : sibling.after(li);
      move.focus();
    }
    if (e.target.closest("[data-clear]")) {
      try { await api(`${base}/turn-order`, "PUT", { entries: [], sortByInitiative: false }); $("#modal").close(); } catch (error) { toast(error.message); }
    }
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const rows = [...form.querySelectorAll(".order-list li")].filter((li) => li.querySelector("input[name=in]").checked);
      const ini = (li) => { const v = li.querySelector(".ini").value; return v === "" ? null : Number(v); };
      let list = rows.map((li) => ({ key: li.dataset.key, initiative: ini(li), label: "", members: [] }));
      if (data.group === "on") {
        const members = list.filter((x) => x.key.startsWith("c:"));
        if (members.length) {
          const first = list.indexOf(members[0]);
          const best = Math.max(...members.map((m) => m.initiative ?? -1000));
          list = list.filter((x) => !x.key.startsWith("c:"));
          list.splice(first, 0, { key: "g:1", label: "Grupo dos jogadores", initiative: members.some((m) => m.initiative != null) ? best : null, members: members.map((m) => m.key.slice(2)) });
        }
      }
      await api(`${base}/turn-order`, "PUT", { entries: list, sortByInitiative: data.sort === "on" });
      $("#modal").close();
      toast("Ordem de turnos salva.");
    });
  };
}

/** Personagens do mestre na mesa: colocar no mapa (original ou cópia de encontro) e ajustar recursos. */
export async function openNpcs({ base, live, campaignId, cell }) {
  const data = await api(`/campaigns/${campaignId}/npcs`);
  const onMap = live.play?.npcs || [];
  modal(
    "♞ Personagens do mestre",
    `${onMap.length ? `<h3>No mapa</h3><ul class="npc-live">${onMap.map((n) => `<li class="metal"><strong>${esc(n.name)}</strong>${n.resources.map((r, i) => `<span class="npc-res">${esc(r.label)}: <b>${r.value}${r.max != null ? "/" + r.max : ""}</b> <button type="button" class="subtle small" data-npc="${esc(n.id)}" data-i="${i}" data-d="-1" aria-label="Diminuir ${esc(r.label)} de ${esc(n.name)}">−</button><button type="button" class="subtle small" data-npc="${esc(n.id)}" data-i="${i}" data-d="1" aria-label="Aumentar ${esc(r.label)} de ${esc(n.name)}">+</button></span>`).join("")}</li>`).join("")}</ul>` : ""}
    ${cell ? `<h3>Colocar na casa ${cell.x + 1}, ${cell.y + 1}</h3>${data.items.filter((n) => !n.copy).length ? `<ul class="npc-pick">${data.items.filter((n) => !n.copy).map((n) => `<li><span>${esc(n.name)}<small>${esc(n.summary || "")}</small></span><button type="button" class="subtle small" data-place="${esc(n.id)}" data-copy="1">Cópia para o encontro</button><button type="button" class="subtle small" data-place="${esc(n.id)}">Original</button></li>`).join("")}</ul>` : `<p class="muted">Crie personagens do mestre na página da campanha, aba Cenas.</p>`}` : `<p class="form-help">Para colocar um personagem, use “Adicionar ao mapa” e escolha a casa.</p>`}`,
  );
  $("#modal-body").onclick = async (e) => {
    const b = e.target.closest("[data-npc],[data-place]");
    if (!b) return;
    try {
      if (b.dataset.place) {
        await api(`${base}/npc-tokens`, "POST", { masterCharacterId: b.dataset.place, x: cell.x, y: cell.y, copy: b.dataset.copy === "1" });
        $("#modal").close();
      } else await api(`${base}/npcs/${b.dataset.npc}/resource`, "POST", { index: Number(b.dataset.i), delta: Number(b.dataset.d) }, { background: true });
    } catch (error) { toast(error.message); }
  };
}
