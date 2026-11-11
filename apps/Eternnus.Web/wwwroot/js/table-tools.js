import { helpButton } from "./help.js";
import { attachFormulaSuggest } from "./formula-suggest.js";
// Ferramentas da mesa carregadas sob demanda: construtor de rolagens, pedidos de teste, ordem de turnos e
// personagens do mestre (as cenas ficam em table-scenes.js). Escritas por api.js; o servidor confere papel, vez e visibilidade.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { DICE, MASTER_VISIBILITY, VISIBILITY, diceNotation, specFromForm, visibilityLabel } from "./play-policy.js";

const radios = (name, options, current) =>
  options.map(([v, l]) => `<label class="check"><input type="radio" name="${name}" value="${esc(v)}" ${v === current ? "checked" : ""}> ${esc(l)}</label>`).join("");

/**
 * Quem vê o resultado. `request`: pedido de teste (mesa, quem rolou e mestre, só mestre). `master`: rolagem do mestre
 * (mesa, só ele, ele e jogadores escolhidos). `player`: só informa a regra definida pelo mestre — o jogador não escolhe.
 */
function visibilityFields(mode, { players = [], playerVisibility = "table" } = {}) {
  const help = helpButton("mesa.rolagem.visibilidade", "Quem vê a rolagem");
  if (mode === "player") return `<p class="form-help roll-visibility-note">Quem vê: <strong>${esc(visibilityLabel(playerVisibility))}</strong> (definido pelo mestre).${help}</p>`;
  if (mode === "master")
    return `<fieldset><legend>Quem vê o resultado${help}</legend>${radios("visibility", MASTER_VISIBILITY, "table")}<fieldset class="character-checks roll-recipients" data-recipients hidden><legend>Jogadores que veem</legend>${players.length ? players.map((p) => `<label class="check"><input type="checkbox" name="recipient" value="${esc(p.characterId)}"> ${esc(p.characterName || p.name)}</label>`).join("") : '<p class="form-help">Nenhum jogador com personagem nesta sessão.</p>'}</fieldset></fieldset>`;
  return `<fieldset><legend>Quem vê o resultado${help}</legend>${radios("visibility", VISIBILITY, "table")}</fieldset>`;
}

function builderFields(prefix, { visibility = "request", label = true, players = [], playerVisibility, formulaHint = "Digite @ para ver os atributos da sua ficha." } = {}) {
  return `<fieldset class="dice-picker"><legend>Dado</legend><div class="dice-buttons" role="radiogroup" aria-label="Tipo de dado">${DICE.map((d, i) => `<label class="die-choice"><input type="radio" name="sides" value="${d}" ${d === 20 ? "checked" : ""}><span>d${d}</span></label>`).join("")}</div></fieldset>
  <div class="form-grid two"><div class="field"><label for="${prefix}-count">Quantidade</label><input id="${prefix}-count" name="count" type="number" min="1" max="100" value="1" inputmode="numeric" required></div><div class="field"><label for="${prefix}-mod">Modificador</label><input id="${prefix}-mod" name="modifier" type="number" min="-1000" max="1000" value="0" inputmode="numeric"></div></div>
  <details class="roll-more"><summary>Mais opções (manter, explosão, sucessos, percentual)</summary>
  <fieldset class="roll-mechanic"><legend>Como ler o resultado${helpButton("mesa.rolagem.mecanicas", "Como ler os dados")}</legend>${radios("mechanic", [["sum", "Somar os dados"], ["keep", "Manter ou descartar"], ["explode", "Dados explosivos (máximo rola de novo)"], ["success", "Contar sucessos"], ["percent", "Teste percentual (d100)"]], "sum")}</fieldset>
  <div class="form-grid two" data-mech="keep"><div class="field"><label for="${prefix}-keep">Regra</label><select id="${prefix}-keep" name="keep"><option value="kh">Manter os maiores</option><option value="kl">Manter os menores</option><option value="dh">Descartar os maiores</option><option value="dl">Descartar os menores</option></select></div><div class="field"><label for="${prefix}-kc">Quantos dados</label><input id="${prefix}-kc" name="keepCount" type="number" min="1" max="100" value="1"></div></div>
  <div class="form-grid two" data-mech="success"><div class="field"><label for="${prefix}-sa">Sucesso a partir de</label><input id="${prefix}-sa" name="successAt" type="number" min="1" max="1000" value="5"></div><label class="check"><input type="checkbox" name="explodeSuccess"> Explodir no valor máximo</label></div>
  <div class="form-grid two" data-mech="percent"><div class="field"><label for="${prefix}-pt">Alvo (1 a 100)</label><input id="${prefix}-pt" name="percentTarget" type="number" min="1" max="100" value="50"></div><div class="field"><label for="${prefix}-pr">Sucesso quando</label><select id="${prefix}-pr" name="percentRule"><option value="lte">Igual ou menor que o alvo</option><option value="gte">Igual ou maior que o alvo</option></select></div></div>
  <p class="form-help">Explosões têm limite de 100 dados extras por rolagem. Outras mecânicas: o mestre interpreta o resultado.</p></details>
  <details class="roll-more"><summary>Fórmula avançada</summary><div class="field"><div class="field-label"><label for="${prefix}-formula">Fórmula (substitui os dados acima)</label>${helpButton("mesa.rolagem.formula", "Fórmula de rolagem")}</div><input id="${prefix}-formula" name="formula" maxlength="300" placeholder="2d6 + @forca_mod" autocomplete="off"><small class="form-help">${esc(formulaHint)}</small></div></details>
  ${label ? `<div class="field"><label for="${prefix}-label">Descrição (opcional)</label><input id="${prefix}-label" name="label" maxlength="60" placeholder="Percepção"></div>` : ""}
  ${visibility ? visibilityFields(visibility, { players, playerVisibility }) : ""}
  <p class="roll-preview" aria-live="polite"></p>`;
}

function wireBuilder(form) {
  const sync = () => {
    const data = Object.fromEntries(new FormData(form));
    form.querySelectorAll("[data-mech]").forEach((el) => (el.hidden = el.dataset.mech !== (data.mechanic || "sum")));
    const recipients = form.querySelector("[data-recipients]");
    if (recipients) recipients.hidden = data.visibility !== "group";
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

/** Visibilidade enviada ao servidor: o mestre escolhe; o jogador não envia nada (o servidor aplica a configuração da mesa). */
function visibilityBody(form, master) {
  if (!master) return {};
  const visibility = new FormData(form).get("visibility") || "table";
  if (visibility !== "group") return { visibility };
  const recipients = [...form.querySelectorAll("input[name=recipient]:checked")].map((i) => i.value);
  if (!recipients.length) throw new Error("Escolha ao menos um jogador para ver a rolagem.");
  return { visibility, recipients };
}

/** Construtor visual de rolagens com favoritos. `character` pode ser nulo (mestre). `live` informa papel, jogadores e a regra das rolagens. */
export function openRollBuilder({ base, character, onDone, preset, live }) {
  const favorites = character?.shortcuts?.rolls || [];
  const master = Boolean(live?.me?.isMaster);
  const players = master ? (live.participants || []).filter((p) => !p.isMaster && p.characterId) : [];
  const fieldsOptions = master
    ? { visibility: "master", players, formulaHint: "Rolagem do mestre: use dados e números (não há ficha para @atributos)." }
    : { visibility: "player", playerVisibility: live?.play?.playerRollVisibility };
  modal(
    "⬡ Rolar dados",
    `<form id="roll-builder">${favorites.length ? `<fieldset class="roll-favorites"><legend>Favoritas</legend>${favorites.map((f, i) => `<button type="button" class="subtle" data-fav="${i}">${esc(f.label)} <small>${esc(f.spec ? diceNotation(f.spec) : f.formula)}</small></button>`).join("")}</fieldset>` : ""}${builderFields("rb", fieldsOptions)}${character ? `<label class="check"><input type="checkbox" name="favorite"> Guardar nas favoritas (use a descrição como nome)</label>` : ""}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">⬡ Rolar</button></div></form>`,
  );
  const form = $("#roll-builder");
  wireBuilder(form);
  if (!master) attachFormulaSuggest(form.elements.formula, live?.me?.character?.formulaFields || []);
  if (preset) for (const [k, v] of Object.entries(preset)) { const el = form.elements[k]; if (el) el.value = v; }
  form.addEventListener("click", async (e) => {
    const fav = e.target.closest("[data-fav]");
    if (!fav) return;
    const f = favorites[Number(fav.dataset.fav)];
    try {
      const result = await api(`${base}/rolls`, "POST", { spec: f.spec || null, formula: f.formula || null, label: f.label, ...visibilityBody(form, master) }, { background: true });
      $("#modal").close();
      onDone?.(result);
    } catch (error) { toast(error.message); }
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    submitForm(form, async (data) => {
      const body = rollBody(data);
      const result = await api(`${base}/rolls`, "POST", { ...body, label: data.label, ...visibilityBody(form, master) }, { background: true });
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
    `<form id="request-form"><div class="field"><label for="rq-name">Nome do teste</label><input id="rq-name" name="name" maxlength="80" required placeholder="Reflexos"></div><fieldset class="character-checks"><legend>Para quem</legend>${players.map((p) => `<label class="check"><input type="checkbox" name="who" value="${esc(p.characterId)}" checked> ${esc(p.characterName)}</label>`).join("")}</fieldset>${builderFields("rq", { label: false, formulaHint: "Digite @ para ver os atributos das fichas; cada personagem rola com a própria ficha." })}<fieldset><legend>Critério (opcional)${helpButton("mesa.testes.pedidos", "Pedidos de teste")}</legend><div class="form-grid two"><div class="field"><label for="rq-target">Alvo</label><input id="rq-target" name="target" type="number" min="-100000" max="100000" inputmode="numeric" placeholder="Sem critério"></div><div class="field"><label for="rq-rule">Sucesso quando o total for</label><select id="rq-rule" name="rule"><option value="gte">Igual ou maior</option><option value="lte">Igual ou menor</option></select></div></div><small class="form-help">Sem alvo, você interpreta cada resultado.</small></fieldset>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Enviar pedido</button></div></form>`,
  );
  const form = $("#request-form");
  wireBuilder(form);
  attachFormulaSuggest(form.elements.formula, live?.me?.formulaFields || []);
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
    `<form id="order-form"><p class="form-help">Marque quem participa, informe a iniciativa se quiser e use as setas para ajustar. Rolar iniciativa é opcional.${helpButton("mesa.turnos.ordem", "Ordem de turnos")}</p><ol class="order-list">${entries.map((e) => `<li data-key="${esc(e.key)}"><label class="check"><input type="checkbox" name="in" value="${esc(e.key)}" ${included(e.key) ? "checked" : ""}> ${esc(e.label)}</label><label class="sr-only" for="ini-${esc(e.key)}">Iniciativa de ${esc(e.label)}</label><input id="ini-${esc(e.key)}" class="ini" type="number" min="-1000" max="1000" inputmode="numeric" value="${esc(init(e.key))}" placeholder="Inic."><span class="order-moves"><button type="button" class="subtle small" data-move="-1" aria-label="Subir ${esc(e.label)}">↑</button><button type="button" class="subtle small" data-move="1" aria-label="Descer ${esc(e.label)}">↓</button></span></li>`).join("")}</ol><label class="check"><input type="checkbox" name="group"> Jogadores agem juntos como um grupo</label><label class="check"><input type="checkbox" name="sort"> Ordenar pela iniciativa informada</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${current.length ? '<button type="button" class="subtle" data-clear>Voltar à ordem de entrada</button>' : ""}<button type="submit" class="primary">Salvar ordem</button></div></form>`,
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

/** Resumo da ficha do NPC/criatura (recursos e destaques do modelo) para acompanhar o estado na mesa. */
function npcSummary(n) {
  if (!n.sheet) return "";
  const res = (n.sheet.resources || []).map((r) => `<span class="npc-res">${esc(r.label)}: <b>${esc(r.value)}${r.max != null ? "/" + esc(r.max) : ""}</b></span>`).join("");
  const stats = (n.sheet.stats || []).slice(0, 4).map((s) => `<span class="npc-res">${esc(s.label)}: <b>${esc(s.value)}</b></span>`).join("");
  return res || stats ? `<span class="npc-sheet-summary">${res}${stats}</span>` : "";
}

/** Personagens do mestre na mesa: colocar no mapa (original ou cópia de encontro), abrir a ficha e ajustar recursos. */
export async function openNpcs({ base, live, campaignId, cell }) {
  const data = await api(`/campaigns/${campaignId}/npcs`);
  const onMap = live.play?.npcs || [];
  modal(
    "♞ Personagens do mestre",
    `${onMap.length ? `<h3>No mapa</h3><ul class="npc-live">${onMap.map((n) => `<li class="metal"><strong>${esc(n.name)} <small class="npc-kind">${n.kind === "creature" ? "Criatura" : "Personagem"}</small></strong>${npcSummary(n)}<span class="npc-buttons">${button("▣ Ficha", "", "", "subtle small", `data-sheet="${esc(n.id)}"`)}${n.image ? button("◩ Imagem", "", "", "subtle small", `data-image="${esc(n.tokenId)}"`) : ""}</span>${(n.hasSheet ? [] : n.resources).map((r, i) => `<span class="npc-res">${esc(r.label)}: <b>${r.value}${r.max != null ? "/" + r.max : ""}</b> <button type="button" class="subtle small" data-npc="${esc(n.id)}" data-i="${i}" data-d="-1" aria-label="Diminuir ${esc(r.label)} de ${esc(n.name)}">−</button><button type="button" class="subtle small" data-npc="${esc(n.id)}" data-i="${i}" data-d="1" aria-label="Aumentar ${esc(r.label)} de ${esc(n.name)}">+</button></span>`).join("")}</li>`).join("")}</ul>` : ""}
    ${cell ? `<h3>Colocar na casa ${cell.x + 1}, ${cell.y + 1}</h3>${data.items.filter((n) => !n.copy).length ? `<ul class="npc-pick">${data.items.filter((n) => !n.copy).map((n) => `<li><span>${esc(n.name)}<small>${esc(n.summary || "")}</small></span><button type="button" class="subtle small" data-place="${esc(n.id)}" data-copy="1">Cópia para o encontro</button><button type="button" class="subtle small" data-place="${esc(n.id)}">Original</button></li>`).join("")}</ul>` : `<p class="muted">Crie personagens do mestre na página da campanha, aba Cenas.</p>`}` : `<p class="form-help">Para colocar um personagem, use “Adicionar ao mapa” e escolha a casa.</p>`}`,
  );
  $("#modal-body").onclick = async (e) => {
    const b = e.target.closest("[data-npc],[data-place],[data-sheet],[data-image]");
    if (!b) return;
    try {
      if (b.dataset.sheet) return await (await import("./npc-sheet.js")).openNpcSheet({ campaignId, npcId: b.dataset.sheet });
      if (b.dataset.image) { const n = onMap.find((x) => x.tokenId === b.dataset.image); return (await import("./npc-sheet.js")).showImage(n?.image, n?.name); }
      if (b.dataset.place) {
        await api(`${base}/npc-tokens`, "POST", { masterCharacterId: b.dataset.place, x: cell.x, y: cell.y, copy: b.dataset.copy === "1" });
        $("#modal").close();
      } else await api(`${base}/npcs/${b.dataset.npc}/resource`, "POST", { index: Number(b.dataset.i), delta: Number(b.dataset.d) }, { background: true });
    } catch (error) { toast(error.message); }
  };
}
