import { helpButton } from "./help.js";
import { formulaSuggestOn } from "./formula-suggest.js";
import { simpleTemplateFormulaFields } from "./sheet-editor-policy.js";
// Preparação e continuidade da campanha (carregado sob demanda): cenas, personagens do mestre, diário e modelos simples.
import { api } from "./api.js";
import { $, esc, button, modal, formError, submitForm, toast, empty } from "./ui.js";
import { VISION_MODES, localDateTime, toLocalInput, browserZone } from "./play-policy.js";

import { sceneKindLabel } from "./scene-policy.js";
import { mapThumbnail } from "./table-map.js";
const SIDES = [["enemy", "Inimigo"], ["neutral", "Neutro"], ["ally", "Aliado"]];
const options = (list, current) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`).join("");

// ---------- Cenas e personagens do mestre ----------
/** Cena como ponto de entrada da preparação: cartões com miniatura; o editor único abre a preparação privada. */
export async function renderPrep(d, target) {
  target.innerHTML = '<p class="loading-line" role="status">Reunindo cenas…</p>';
  const [scenes, npcs, maps] = await Promise.all([api(`/campaigns/${d.id}/scenes`), api(`/campaigns/${d.id}/npcs`), api(`/campaigns/${d.id}/maps`).catch(() => ({ items: [] }))]);
  if (!target.isConnected) return;
  const mapOf = (key) => maps.items.find((m) => m.key === key);
  const visionLabel = (v) => (VISION_MODES.find((x) => x[0] === v) || [])[1];
  const card = (s) => {
    const m = mapOf(s.mapKey);
    const status = s.current ? "Em apresentação" : s.hasSaved ? "Já visitada" : "Preparada";
    return `<li class="scene-card metal ${s.current ? "current" : ""}"><div class="scene-thumb" ${s.kind !== "text" && m ? `data-scene-map="${esc(m.key)}"` : ""} aria-hidden="true">${s.kind === "text" ? '<span class="scene-text-thumb">¶</span>' : ""}</div><div class="scene-card-body"><span class="scene-state ${s.current ? "live" : ""}">${esc(status)}</span><h3>${esc(s.name)}</h3><small>${esc(sceneKindLabel(s.kind))}${m ? " · " + esc(m.name) : ""}${s.visionMode ? " · " + esc(visionLabel(s.visionMode) || "") : ""}${s.prepared ? ` · ${s.prepared} marcadores` : ""}${s.layerMode === "scene" ? " · mapa próprio" : ""}</small>${s.sharedText ? `<p class="small">${esc(s.sharedText)}</p>` : ""}</div><div class="scene-actions">${button("Editar preparação", "pp-scene", s.id, "primary small", d.archived ? "disabled" : "")}<details class="more-options"><summary>Mais opções</summary>${button("Duplicar", "pp-scene-copy", s.id, "subtle small", d.archived ? "disabled" : "")}${button("Excluir cena", "pp-scene-delete", s.id, "text-button small", d.archived || s.current ? `aria-disabled="true" data-tip="${s.current ? "Apresente outra cena antes de excluir esta." : ""}"` : "")}</details></div></li>`;
  };
  target.innerHTML = `<div class="section-title"><h2>Cenas${helpButton("campanhas.preparo.cenas", "Cenas preparadas")}</h2>${button("+ Nova cena", "pp-scene", "", "primary small", d.archived ? "disabled" : "")}</div>
  <p class="muted small">Prepare em particular: escolha o cenário, posicione personagens e escreva o texto. Nada aparece aos jogadores até você apresentar a cena na mesa.</p>
  ${scenes.items.length ? `<ul class="scene-cards">${scenes.items.map(card).join("")}</ul>` : empty("Nenhuma cena ainda.", "Uma cena pode ser um mapa com grade, uma imagem ou só um texto para ler à mesa.", d.archived ? "" : "pp-scene", "+ Nova cena")}
  <div class="section-title"><h2>Personagens do mestre${helpButton("campanhas.preparo.personagens", "Personagens do Mestre")}</h2>${button("+ Novo personagem", "pp-npc", "", "primary small", d.archived ? "disabled" : "")}</div>
  <p class="muted small">Reutilize aliados e inimigos. Na mesa, use “Cópia para o encontro” para mexer nos recursos sem alterar o original.</p>
  ${npcs.items.length ? `<ul class="npc-list">${npcs.items.map((n) => `<li class="metal"><div><strong>${esc(n.name)}</strong> <span class="chip">${n.kind === "creature" ? "criatura" : "personagem"}</span>${n.copy ? ' <span class="chip">cópia</span>' : ""}${n.templateName ? ` <span class="chip">ficha: ${esc(n.templateName)}</span>` : ""}<small>${esc(n.summary || "")}</small><small>${n.resources.map((r) => `${esc(r.label)} ${r.value}${r.max != null ? "/" + r.max : ""}`).join(" · ")}</small></div><div class="scene-actions">${button("Editar", "pp-npc", n.id, "subtle small")}${button("Ficha", "pp-npc-sheet", n.id, "subtle small")}${button("Copiar", "pp-npc-copy", n.id, "subtle small")}${button("Excluir", "pp-npc-delete", n.id, "text-button small")}</div></li>`).join("")}</ul>` : empty("Nenhum personagem do mestre.", "Crie um com nome, resumo e recursos como vida, moral ou munição.")}`;
  target.querySelectorAll("[data-scene-map]").forEach((el) => mapThumbnail(el, mapOf(el.dataset.sceneMap)));
  target.onclick = async (e) => {
    const b = e.target.closest("[data-action^='pp-']");
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.action === "pp-scene") {
        const { openSceneEditor } = await import("./scene-editor.js");
        await openSceneEditor({ campaign: d, sceneId: id || null });
        if (target.isConnected) await renderPrep(d, target);
      }
      if (b.dataset.action === "pp-scene-copy") { await api(`/campaigns/${d.id}/scenes/${id}/duplicate`, "POST"); await renderPrep(d, target); }
      if (b.dataset.action === "pp-scene-delete" && confirm("Excluir esta cena? Mapas e personagens continuam na campanha. Uma preparação de mapa própria desta cena também é excluída.")) { await api(`/campaigns/${d.id}/scenes/${id}`, "DELETE"); await renderPrep(d, target); }
      if (b.dataset.action === "pp-npc") await npcModal(d, npcs.items.find((n) => n.id === id), () => renderPrep(d, target));
      if (b.dataset.action === "pp-npc-sheet") await (await import("./npc-sheet.js")).openNpcSheet({ campaignId: d.id, npcId: id, onSaved: () => target.isConnected && renderPrep(d, target) });
      if (b.dataset.action === "pp-npc-copy") { await api(`/campaigns/${d.id}/npcs/${id}/copy`, "POST"); await renderPrep(d, target); }
      if (b.dataset.action === "pp-npc-delete" && confirm("Excluir este personagem do mestre?")) { await api(`/campaigns/${d.id}/npcs/${id}`, "DELETE"); await renderPrep(d, target); }
    } catch (error) { toast(error.message); }
  };
}
async function npcModal(d, npc, done) {
  const sheets = await import("./npc-sheet.js");
  const images = await sheets.imageChoices(d.id);
  const rows = (npc?.resources?.length ? npc.resources : [{ label: "Vida", value: 10, max: 10 }]).concat([{ label: "", value: 0, max: null }]);
  modal(
    npc ? "Editar personagem do mestre" : "Novo personagem do mestre",
    `<form id="npc-form"><div class="field"><label for="np-name">Nome</label><input id="np-name" name="name" maxlength="40" required value="${esc(npc?.name || "")}"></div><div class="form-grid two"><div class="field"><label for="np-kind">Tipo</label><select id="np-kind" name="kind">${options([["npc", "Personagem"], ["creature", "Criatura"]], npc?.kind || "npc")}</select></div><div class="field"><label for="np-side">Lado</label><select id="np-side" name="side">${options(SIDES, npc?.side || "enemy")}</select></div></div><div class="field"><label for="np-sum">Resumo curto</label><input id="np-sum" name="summary" maxlength="500" value="${esc(npc?.summary || "")}"></div><fieldset><legend>Recursos (deixe o nome vazio para não usar)</legend>${rows.map((r, i) => `<div class="form-grid three"><div class="field"><label for="np-l${i}">Nome</label><input id="np-l${i}" name="l${i}" maxlength="40" value="${esc(r.label)}" placeholder="Moral"></div><div class="field"><label for="np-v${i}">Valor</label><input id="np-v${i}" name="v${i}" type="number" min="0" max="100000" value="${r.value ?? 0}"></div><div class="field"><label for="np-m${i}">Máximo</label><input id="np-m${i}" name="m${i}" type="number" min="0" max="100000" value="${r.max ?? ""}"></div></div>`).join("")}</fieldset>${sheets.imageFields("np-img", npc?.imageUrl || "", images)}<div class="field"><label for="np-notes">Notas privadas</label><textarea id="np-notes" name="notes" maxlength="4000" rows="3">${esc(npc?.notes || "")}</textarea></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar</button></div></form>`,
  );
  $("#npc-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const resources = rows.map((_, i) => ({ label: (data["l" + i] || "").trim(), value: Number(data["v" + i]) || 0, max: data["m" + i] === "" ? null : Number(data["m" + i]) })).filter((r) => r.label);
      await api(`/campaigns/${d.id}/npcs${npc ? "/" + npc.id : ""}`, npc ? "PUT" : "POST", { name: data.name, summary: data.summary, notes: data.notes, side: data.side, resources, revision: npc?.revision || 0, kind: data.kind, imageUrl: sheets.imageFromForm(data) });
      $("#modal").close();
      await done();
    });
  };
}

// ---------- Diário ----------
export async function renderJournal(d, target) {
  target.innerHTML = '<p class="loading-line" role="status">Abrindo o diário…</p>';
  const j = await api(`/campaigns/${d.id}/journal`);
  if (!target.isConnected) return;
  const master = j.campaign.isMaster;
  const objectives = j.entries.filter((e) => e.kind === "objective");
  const clues = j.entries.filter((e) => e.kind === "clue");
  const entry = (e) => `<li class="metal"><strong>${esc(e.title)}</strong>${master && !e.published ? ' <span class="chip">rascunho</span>' : ""}<p class="small">${esc(e.text)}</p>${master ? button("Editar", "jr-entry", e.id, "text-button small") : ""}</li>`;
  const status = { yes: "Vou", maybe: "Talvez", no: "Não vou" };
  target.innerHTML = `<div class="section-title"><h2>Próxima partida</h2>${master ? button("Marcar data", "jr-schedule", "", "subtle small", d.archived ? "disabled" : "") : ""}</div>
  <article class="metal next-session">${j.nextSession ? `<p class="next-date"><strong>${esc(localDateTime(j.nextSession.at))}</strong> <small>(seu horário${browserZone() ? ": " + esc(browserZone()) : ""})</small></p>${j.nextSession.note ? `<p class="small">${esc(j.nextSession.note)}</p>` : ""}${master ? `<p class="small">Confirmações: ${j.attendance.map((a) => `${esc(a.name)} — ${esc(status[a.status] || a.status)}`).join(" · ") || "nenhuma ainda"}${j.pending ? ` · ${j.pending} sem resposta` : ""}</p>` : `<div class="attendance" role="group" aria-label="Confirmar presença">${Object.entries(status).map(([v, l]) => `<button type="button" class="${j.myAttendance === v ? "primary" : "subtle"} small" data-action="jr-attend" data-id="${v}" aria-pressed="${j.myAttendance === v}">${l}</button>`).join("")}</div>${j.attendance.length ? `<p class="small muted">${j.attendance.map((a) => `${esc(a.name)}: ${esc(status[a.status] || a.status)}`).join(" · ")}</p>` : ""}`}` : `<p class="muted small">${master ? "Marque a próxima partida para os jogadores confirmarem presença." : "O mestre ainda não marcou a próxima partida."}</p>`}</article>
  <div class="section-title"><h2>Objetivos</h2>${master ? button("+ Objetivo", "jr-new", "objective", "subtle small", d.archived ? "disabled" : "") : ""}</div>${objectives.length ? `<ul class="journal-list">${objectives.map(entry).join("")}</ul>` : '<p class="muted small">Nenhum objetivo conhecido ainda.</p>'}
  <div class="section-title"><h2>Pistas</h2>${master ? button("+ Pista", "jr-new", "clue", "subtle small", d.archived ? "disabled" : "") : ""}</div>${clues.length ? `<ul class="journal-list">${clues.map(entry).join("")}</ul>` : '<p class="muted small">Nenhuma pista registrada.</p>'}
  <div class="section-title"><h2>Resumos das sessões</h2></div>${j.recaps.length ? `<ul class="journal-list">${j.recaps.map((r) => `<li class="metal"><strong>Sessão ${String(r.number).padStart(2, "0")} — ${esc(r.title)}</strong>${master && !r.published ? ' <span class="chip">não publicado</span>' : ""}<p class="small recap">${esc(r.recap)}</p>${master ? button("Editar resumo", "jr-recap", r.id, "text-button small") : ""}</li>`).join("")}</ul>` : `<p class="muted small">${master ? "Escreva o resumo pela lista de sessões ou ao encerrar uma partida." : "Os resumos publicados pelo mestre aparecem aqui."}</p>`}`;
  target.onclick = async (e) => {
    const b = e.target.closest("[data-action^='jr-']");
    if (!b || b.disabled) return;
    try {
      if (b.dataset.action === "jr-attend") { await api(`/campaigns/${d.id}/attendance`, "POST", { status: b.dataset.id }); await renderJournal(d, target); }
      if (b.dataset.action === "jr-schedule") scheduleModal(d, j.nextSession, () => renderJournal(d, target));
      if (b.dataset.action === "jr-new") entryModal(d, { kind: b.dataset.id }, () => renderJournal(d, target));
      if (b.dataset.action === "jr-entry") entryModal(d, j.entries.find((x) => x.id === b.dataset.id), () => renderJournal(d, target));
      if (b.dataset.action === "jr-recap") recapModal(j.recaps.find((x) => x.id === b.dataset.id), () => renderJournal(d, target));
    } catch (error) { toast(error.message); }
  };
}

function scheduleModal(d, current, done) {
  modal("Próxima partida", `<form id="schedule-form"><div class="field"><label for="sch-at">Data e hora (${esc(browserZone() || "horário local")})</label><input id="sch-at" name="at" type="datetime-local" value="${esc(toLocalInput(current?.at))}"></div><div class="field"><label for="sch-note">Observação</label><input id="sch-note" name="note" maxlength="200" value="${esc(current?.note || "")}" placeholder="Online, na casa da Ana…"></div><p class="form-help">Os jogadores veem no próprio fuso horário. Mudar a data pede nova confirmação.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}${current ? '<button type="submit" class="subtle" name="clear" value="1">Desmarcar</button>' : ""}<button type="submit" class="primary">Salvar</button></div></form>`);
  $("#schedule-form").onsubmit = (e) => {
    e.preventDefault();
    const clear = e.submitter?.name === "clear";
    submitForm(e.currentTarget, async (data) => {
      if (!clear && !data.at) throw new Error("Escolha a data e a hora.");
      await api(`/campaigns/${d.id}/schedule`, "PUT", { at: clear ? null : new Date(data.at).toISOString(), note: clear ? "" : data.note });
      $("#modal").close();
      await done();
    });
  };
}

function entryModal(d, item, done) {
  const label = item.kind === "clue" ? "pista" : "objetivo";
  modal(item.id ? `Editar ${label}` : item.kind === "clue" ? "Nova pista" : "Novo objetivo", `<form id="entry-form"><div class="field"><label for="en-title">Título</label><input id="en-title" name="title" maxlength="120" required value="${esc(item.title || "")}"></div><div class="field"><label for="en-text">Texto</label><textarea id="en-text" name="text" maxlength="10000" rows="4" required>${esc(item.text || "")}</textarea></div><label class="check"><input type="checkbox" name="published" ${item.published ? "checked" : ""}> Os jogadores já sabem disto</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar</button></div></form>`);
  $("#entry-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(`/campaigns/${d.id}/assets/library${item.id ? "/" + item.id : ""}`, item.id ? "PUT" : "POST", { title: data.title, text: data.text, published: data.published === "on", revision: item.revision || 0, kind: item.kind });
      $("#modal").close();
      await done();
    });
  };
}

export function recapModal(session, done) {
  modal(`Resumo — sessão ${String(session.number).padStart(2, "0")}`, `<form id="recap-form"><div class="field"><label for="rc-text">O que aconteceu</label><textarea id="rc-text" name="text" maxlength="5000" rows="8">${esc(session.recap || "")}</textarea></div><label class="check"><input type="checkbox" name="publish" ${session.published || session.recapPublished ? "checked" : ""}> Publicar para os jogadores</label><p class="form-help">Notas privadas e objetivos secretos não aparecem no resumo; escreva só o que o grupo pode saber.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar resumo</button></div></form>`);
  $("#recap-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(`/sessions/${session.id}/recap`, "POST", { text: data.text, publish: data.publish === "on" });
      $("#modal").close();
      toast(data.publish === "on" ? "Resumo publicado no diário." : "Resumo salvo como rascunho.");
      await done?.();
    });
  };
}

// ---------- Modelos privados simples ----------
const FIELD_TYPES = [["text", "Texto"], ["number", "Número"], ["select", "Seleção"], ["checkbox", "Marcação"], ["textarea", "Texto longo"]];

function fieldsFromVersion(v) {
  const sections = new Map();
  for (const f of v?.fields || []) {
    if (f.role === "name") continue;
    const key = f.section || "Geral";
    if (!sections.has(key)) sections.set(key, []);
    const maxFrom = f.maxField ? v.fields.find((o) => o.name === f.maxField)?.label : "";
    sections.get(key).push({ label: f.label, type: f.type, options: (f.options || []).join(", "), resource: f.track === "resource", summary: f.track === "summary", max: f.max ?? "", maxFrom: maxFrom || "" });
  }
  return [...sections.entries()].map(([title, fields]) => ({ title, fields }));
}

export function privateTemplateModal(d, template, done) {
  let sections = template ? fieldsFromVersion(template.version) : [{ title: "Recursos", fields: [{ label: "Vida", type: "number", resource: true, max: "", maxFrom: "", summary: false, options: "" }] }, { title: "Características", fields: [{ label: "Conceito", type: "text", summary: true, resource: false, options: "" }] }];
  let actions = (template?.version?.actions || []).map((a) => ({ name: a.name, formula: a.formula, group: a.group || "" }));
  const check = (s, i, key, on, text) => `<label class="check"><input type="checkbox" data-s="${s}" data-i="${i}" data-k="${key}" ${on ? "checked" : ""}><span>${text}</span></label>`;
  // Cada campo é um cartão: nome e tipo na mesma linha; opções, marcações e máximo do recurso abaixo.
  const fieldRow = (s, i, f) => `<li class="pt-field"><div class="pt-row pt-row-main"><div class="field"><label for="f-${s}-${i}">Campo</label><input id="f-${s}-${i}" data-s="${s}" data-i="${i}" data-k="label" maxlength="80" value="${esc(f.label)}" required></div><div class="field"><label for="t-${s}-${i}">Tipo</label><select id="t-${s}-${i}" data-s="${s}" data-i="${i}" data-k="type">${options(FIELD_TYPES, f.type)}</select></div><button type="button" class="text-button small pt-remove" data-remove-field="${s}|${i}" aria-label="Remover campo ${esc(f.label)}">Remover</button></div>${f.type === "select" ? `<div class="field"><label for="o-${s}-${i}">Opções (separe por vírgula)</label><input id="o-${s}-${i}" data-s="${s}" data-i="${i}" data-k="options" value="${esc(f.options || "")}"></div>` : ""}<div class="pt-checks">${f.type === "number" ? check(s, i, "resource", f.resource, "Recurso (contador na mesa)") : ""}${check(s, i, "summary", f.summary, "Destacar na ficha resumida")}</div>${f.type === "number" && f.resource ? `<div class="pt-row"><div class="field"><label for="m-${s}-${i}">Máximo fixo</label><input id="m-${s}-${i}" type="number" data-s="${s}" data-i="${i}" data-k="max" value="${esc(f.max ?? "")}"></div><div class="field"><label for="mf-${s}-${i}">Ou máximo vindo do campo</label><input id="mf-${s}-${i}" data-s="${s}" data-i="${i}" data-k="maxFrom" value="${esc(f.maxFrom || "")}" placeholder="Vida máxima"></div></div>` : ""}</li>`;
  const render = () => `<form id="tpl-form" class="pt-form"><div class="field"><div class="field-label"><label for="tpl-name">Nome do modelo</label>${helpButton("campanhas.preparo.modelos-privados", "Modelos privados")}</div><input id="tpl-name" name="name" maxlength="100" required value="${esc(template?.name || "")}"></div><p class="form-help">Sem PDF. O nome do personagem entra automaticamente. Fórmulas são opcionais.</p>${sections.map((sec, s) => `<section class="pt-section" aria-label="Seção ${esc(sec.title || String(s + 1))}"><div class="field pt-section-name"><label for="sec-${s}">Nome da seção</label><input id="sec-${s}" data-sec="${s}" maxlength="60" value="${esc(sec.title)}"></div><ul class="pt-fields">${sec.fields.map((f, i) => fieldRow(s, i, f)).join("")}</ul><button type="button" class="subtle small" data-add-field="${s}">+ Campo</button></section>`).join("")}<button type="button" class="subtle small pt-add-section" data-add-section>+ Seção</button><section class="pt-section" aria-labelledby="pt-actions-title"><h3 id="pt-actions-title" class="pt-section-title">Ações <small>(opcional)</small></h3>${actions.map((a, i) => `<div class="pt-row pt-row-three"><div class="field"><label for="an-${i}">Ação</label><input id="an-${i}" data-a="${i}" data-k="name" maxlength="60" value="${esc(a.name)}"></div><div class="field"><label for="af-${i}">Dados ou fórmula</label><input id="af-${i}" data-a="${i}" data-k="formula" maxlength="300" value="${esc(a.formula || "")}" placeholder="2d6"></div><div class="field"><label for="ag-${i}">Grupo</label><input id="ag-${i}" data-a="${i}" data-k="group" maxlength="30" value="${esc(a.group || "")}" placeholder="Perícias"></div></div>`).join("")}<button type="button" class="subtle small" data-add-action>+ Ação</button></section><label class="check"><input type="checkbox" name="use" ${template?.inUse || !template ? "checked" : ""}><span>Usar este modelo nas novas fichas da campanha</span></label><p class="form-help">Salvar publica uma nova versão. Fichas existentes continuam na versão delas; o jogador vê a prévia antes de atualizar.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar modelo</button></div></form>`;
  modal(template ? "Editar modelo da campanha" : "Novo modelo simples", render());
  const body = $("#modal-body");
  const rerender = () => { body.innerHTML = render(); };
  // @atributos nas rolagens do modelo: campos numéricos com os nomes que o servidor vai gerar.
  const releaseSuggest = formulaSuggestOn(body, 'input[data-k="formula"]', () => simpleTemplateFormulaFields(sections));
  $("#modal").addEventListener("close", releaseSuggest, { once: true });
  body.oninput = body.onchange = (e) => {
    const t = e.target;
    if (t.dataset.sec) sections[Number(t.dataset.sec)].title = t.value;
    if (t.dataset.a) actions[Number(t.dataset.a)][t.dataset.k] = t.value;
    if (t.dataset.s) {
      const f = sections[Number(t.dataset.s)].fields[Number(t.dataset.i)];
      f[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value;
      if (e.type === "change" && (t.dataset.k === "type" || t.dataset.k === "resource")) { const focus = t.id; rerender(); $("#" + focus)?.focus(); }
    }
  };
  body.onclick = (e) => {
    const add = e.target.closest("[data-add-field]");
    if (add) { sections[Number(add.dataset.addField)].fields.push({ label: "", type: "text", options: "" }); rerender(); }
    if (e.target.closest("[data-add-section]")) { sections.push({ title: "Nova seção", fields: [{ label: "", type: "text", options: "" }] }); rerender(); }
    if (e.target.closest("[data-add-action]")) { actions.push({ name: "", formula: "", group: "" }); rerender(); }
    const rm = e.target.closest("[data-remove-field]");
    if (rm) { const [s, i] = rm.dataset.removeField.split("|").map(Number); sections[s].fields.splice(i, 1); rerender(); }
  };
  body.onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.target, async (data) => {
      const payload = {
        name: data.name, description: "", useForCampaign: data.use === "on",
        sections: sections.map((s) => ({ title: s.title, fields: s.fields.filter((f) => (f.label || "").trim()).map((f) => ({ label: f.label.trim(), type: f.type, options: f.type === "select" ? String(f.options || "").split(",").map((o) => o.trim()).filter(Boolean) : null, resource: !!f.resource && f.type === "number", max: f.resource && f.max !== "" && f.max != null ? Number(f.max) : null, maxFrom: f.resource ? f.maxFrom || null : null, summary: !!f.summary, min: f.type === "number" ? 0 : null, default: null })) })).filter((s) => s.fields.length),
        actions: actions.filter((a) => (a.name || "").trim()).map((a) => ({ name: a.name.trim(), formula: a.formula || "", description: "", group: a.group || null, kind: null })),
      };
      await api(`/campaigns/${d.id}/private-templates${template ? "/" + template.id : ""}`, template ? "PUT" : "POST", payload);
      $("#modal").close();
      toast("Modelo salvo e publicado para a campanha.");
      await done?.();
    });
  };
}
