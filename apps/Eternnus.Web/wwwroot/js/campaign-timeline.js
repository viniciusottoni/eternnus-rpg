// Mundo e acervo › Linha do tempo (ADR-072). Carregado sob demanda. A linha serpenteia pela tela: linhas alternam de
// direção e curvas ligam uma fileira à outra; no celular vira uma linha vertical. O mestre escreve; o grupo lê o que foi publicado.
import { api } from "./api.js";
import { $, esc, modal, button, formError, submitForm, toast, empty, actionBar } from "./ui.js";
import { helpButton } from "./help.js";

const base = (d) => `/campaigns/${d.id}/workspace/timeline`;
const MARKER = { start: { icon: "✦", label: "Início" }, end: { icon: "⚑", label: "Fim" } };
const SVG = "http://www.w3.org/2000/svg";
let release = () => {};

/** Colunas por largura: 1 no celular (linha vertical), de 2 a 5 no restante. Regra pura, testável. */
export function timelineColumns(width) {
  if (width < 640) return 1;
  return Math.max(2, Math.min(5, Math.floor(width / 230)));
}
/** Posição na grade do i-ésimo ponto: fileiras pares vão da esquerda para a direita, ímpares voltam (serpente). */
export function serpentCell(i, cols) {
  const row = Math.floor(i / cols), at = i % cols;
  return { row: row + 1, col: row % 2 === 0 ? at + 1 : cols - at };
}

/** Descrição do ponto para leitores de tela e para o título do modal. */
const spotName = (s, n) => (s.kind === "event" ? `${n}. ${s.title}` : `${MARKER[s.kind].label}: ${s.title}`);

function spotHtml(s, n, canEdit) {
  const marker = MARKER[s.kind];
  const classes = ["tl-node", `tl-${s.kind}`, s.published ? "" : "tl-draft"].filter(Boolean).join(" ");
  const badge = canEdit && !s.published ? '<span class="tl-badge">Rascunho</span>' : "";
  return `<li class="${classes}" data-news-key="${esc(s.id)}"><button type="button" class="tl-spot" data-action="tl-open" data-id="${esc(s.id)}" aria-haspopup="dialog"><span class="tl-dot" aria-hidden="true">${marker ? marker.icon : n}</span><span class="tl-card">${marker ? `<span class="tl-kind">${marker.label}</span>` : ""}${s.when ? `<span class="tl-when">${esc(s.when)}</span>` : ""}<strong class="tl-title">${esc(s.title)}</strong>${s.summary ? `<span class="tl-summary">${esc(s.summary)}</span>` : ""}${badge}${s.hasDetails ? '<span class="tl-more">Ler relato completo</span>' : ""}</span></button></li>`;
}

export async function renderTimeline(d, target) {
  release();
  release = () => {};
  target.innerHTML = '<p role="status">Abrindo a linha do tempo…</p>';
  let data;
  try {
    data = await api(base(d));
  } catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<p role="alert">${esc(error.message)}</p>${button("Tentar novamente", "tl-retry", "", "subtle")}`;
    target.onclick = (e) => { if (e.target.closest('[data-action="tl-retry"]')) renderTimeline(d, target); };
    return;
  }
  if (!target.isConnected) return;
  const { items, canEdit, limit } = data;
  const start = items.find((s) => s.kind === "start"), end = items.find((s) => s.kind === "end");
  const events = items.filter((s) => s.kind === "event");
  const full = events.length >= limit;
  const tools = canEdit
    ? `${start ? "" : button("✦ Definir início", "tl-new", "start", "subtle small")}${end ? "" : button("⚑ Definir fim", "tl-new", "end", "subtle small")}${button("+ Acontecimento", "tl-new", "event", "primary small", full ? `aria-disabled="true" data-tip="Limite de ${limit} acontecimentos atingido."` : "")}`
    : "";
  const lead = canEdit
    ? "Conte a história da campanha em ordem. A descrição curta aparece na linha; o relato completo, só ao abrir o ponto. Pontos em rascunho ficam visíveis apenas para você."
    : "A história da campanha até aqui. Abra um ponto para ler o relato completo.";
  // Sequência exibida: início, acontecimentos, “novo acontecimento” (mestre) e fim.
  const spots = [start, ...events].filter(Boolean);
  let n = 0;
  const nodes = spots.map((s) => spotHtml(s, s.kind === "event" ? ++n : 0, canEdit));
  if (canEdit && !full) nodes.push(`<li class="tl-node tl-add"><button type="button" class="tl-spot" data-action="tl-new" data-id="event"><span class="tl-dot" aria-hidden="true">+</span><span class="tl-card"><strong class="tl-title">Novo acontecimento</strong><span class="tl-summary">Acrescentar no fim da história</span></span></button></li>`);
  if (end) nodes.push(spotHtml(end, 0, canEdit));
  const body = items.length || canEdit
    ? `<div class="tl-wrap"><svg class="tl-path" aria-hidden="true" focusable="false"></svg><ol class="tl-serpent" aria-label="Linha do tempo da campanha, em ordem">${nodes.join("")}</ol></div>`
    : empty("A história ainda não foi contada aqui.", "Quando o mestre publicar acontecimentos, eles aparecem nesta linha do tempo.");
  target.innerHTML = `<div class="section-title"><h2>Linha do tempo${helpButton("campanhas.acervo.linha-do-tempo", "Linha do tempo")}</h2>${tools ? `<div class="tl-tools">${tools}</div>` : ""}</div><p class="muted small section-lead">${lead}</p>${body}`;

  const reload = () => renderTimeline(d, target);
  target.onclick = async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    try {
      if (b.dataset.action === "tl-open") await readSpot(d, data, b.dataset.id, reload);
      if (b.dataset.action === "tl-new") await editor(d, data, { kind: b.dataset.id }, reload);
    } catch (error) { toast(error.message); }
  };
  const wrap = target.querySelector(".tl-wrap");
  if (wrap) release = mountSerpent(wrap);
  return () => release();
}

/** Distribui os pontos na grade em serpente e desenha o caminho. Redesenha ao mudar a largura. Devolve o descarte. */
function mountSerpent(wrap) {
  const list = wrap.querySelector(".tl-serpent"), svg = wrap.querySelector(".tl-path");
  const nodes = [...list.children];
  const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cols = 0, frame = 0, first = true;
  const draw = () => {
    frame = 0;
    if (!wrap.isConnected) return stop();
    const next = timelineColumns(wrap.clientWidth);
    if (next !== cols) {
      cols = next;
      list.style.setProperty("--tl-cols", String(cols));
      list.classList.toggle("tl-single", cols === 1);
      nodes.forEach((li, i) => { const { row, col } = serpentCell(i, cols); li.style.gridRow = String(row); li.style.gridColumn = String(col); });
    }
    const box = wrap.getBoundingClientRect();
    const points = nodes.map((li) => { const r = li.querySelector(".tl-dot").getBoundingClientRect(); return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }; });
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    svg.setAttribute("width", String(box.width));
    svg.setAttribute("height", String(box.height));
    svg.replaceChildren();
    if (!points.length) return;
    let path = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (cols === 1 || Math.abs(a.y - b.y) < 4) { path += ` L${b.x},${b.y}`; continue; }
      // Troca de fileira: curva para fora, do lado em que a fileira anterior terminou.
      const right = Math.floor((i - 1) / cols) % 2 === 0;
      const room = right ? box.width - Math.max(a.x, b.x) - 6 : Math.min(a.x, b.x) - 6;
      const reach = Math.max(18, Math.min((b.y - a.y) * 0.62, room / 0.75));
      const dx = right ? reach : -reach;
      path += ` C${a.x + dx},${a.y} ${b.x + dx},${b.y} ${b.x},${b.y}`;
    }
    const line = (d, cls) => { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); svg.append(p); return p; };
    line(path, "tl-track");
    const gold = line(path, "tl-line");
    // Sem marco definido, a ponta fica aberta (tracejada): a história continua antes ou depois.
    const head = points[0], tail = points.at(-1);
    const lastRight = cols === 1 || Math.floor((points.length - 1) / cols) % 2 === 0;
    if (!nodes[0].classList.contains("tl-start")) line(cols === 1 ? `M${head.x},${Math.max(0, head.y - 40)} L${head.x},${head.y}` : `M${Math.max(2, head.x - 60)},${head.y} L${head.x},${head.y}`, "tl-open");
    if (!nodes.at(-1).classList.contains("tl-end")) line(cols === 1 ? `M${tail.x},${tail.y} L${tail.x},${tail.y + 40}` : `M${tail.x},${tail.y} L${lastRight ? Math.min(box.width - 2, tail.x + 60) : Math.max(2, tail.x - 60)},${tail.y}`, "tl-open");
    if (first && animate) {
      const length = Math.ceil(gold.getTotalLength());
      gold.style.setProperty("--tl-length", String(length));
      gold.classList.add("tl-draw");
    }
    first = false;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const observer = new ResizeObserver(schedule);
  observer.observe(wrap);
  draw();
  function stop() { observer.disconnect(); if (frame) cancelAnimationFrame(frame); frame = 0; }
  return stop;
}

async function readSpot(d, data, id, reload) {
  const s = await api(`${base(d)}/${id}`);
  const order = data.items.filter((x) => x.kind === "event");
  const sequence = [...data.items.filter((x) => x.kind === "start"), ...order, ...data.items.filter((x) => x.kind === "end")];
  const at = sequence.findIndex((x) => x.id === s.id);
  const number = order.findIndex((x) => x.id === s.id) + 1;
  const prev = sequence[at - 1], next = sequence[at + 1];
  const meta = [s.when, data.canEdit && !s.published ? "Rascunho — só você vê" : ""].filter(Boolean);
  const nav = `${button("‹ Anterior", "tl-step", prev?.id || "", "subtle", prev ? `aria-label="Ponto anterior: ${esc(prev.title)}"` : "disabled")}${button("Próximo ›", "tl-step", next?.id || "", "subtle", next ? `aria-label="Próximo ponto: ${esc(next.title)}"` : "disabled")}`;
  const edit = data.canEdit
    ? `${button("Excluir", "tl-delete", "", "subtle")}${s.kind === "event" ? button("+ Inserir depois", "tl-after", "", "subtle") : ""}${button("Editar", "tl-edit", "", "primary")}`
    : "";
  modal(s.kind === "event" ? `${number}. ${s.title}` : `${MARKER[s.kind].label}: ${s.title}`, `${meta.length ? `<p class="muted small">${meta.map(esc).join(" · ")}</p>` : ""}${s.summary ? `<p class="tl-lead">${esc(s.summary)}</p>` : ""}${s.details ? `<article class="workspace-prose">${esc(s.details)}</article>` : '<p class="muted small">Sem relato completo para este ponto.</p>'}${actionBar(nav, edit)}`);
  $("#modal-body").onclick = async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    try {
      if (b.dataset.action === "tl-step") await readSpot(d, data, b.dataset.id, reload);
      if (b.dataset.action === "tl-edit") await editor(d, data, s, reload);
      if (b.dataset.action === "tl-after") await editor(d, data, { kind: "event", after: s.id }, reload);
      if (b.dataset.action === "tl-delete") confirmDelete(d, s, reload);
    } catch (error) { toast(error.message); }
  };
}

/** Criar ou editar. A posição (acontecimentos) é escolhida numa lista: "No início" ou "Depois de …". */
async function editor(d, data, s, reload) {
  const events = data.items.filter((x) => x.kind === "event");
  const isEvent = s.kind === "event";
  const others = events.filter((x) => x.id !== s.id);
  // Posição atual na edição: depois do anterior a ele; na criação: depois do escolhido ou no fim.
  const index = events.findIndex((x) => x.id === s.id);
  const current = s.id ? (index > 0 ? events[index - 1].id : "first") : s.after || (others.at(-1)?.id ?? "first");
  const positions = `<option value="first" ${current === "first" ? "selected" : ""}>No início da história</option>${others.map((x, i) => `<option value="${esc(x.id)}" ${x.id === current ? "selected" : ""}>Depois de ${i + 1}. ${esc(x.title)}</option>`).join("")}`;
  const title = s.id ? "Editar ponto" : isEvent ? "Novo acontecimento" : s.kind === "start" ? "Definir início" : "Definir fim";
  modal(title, `<form id="tl-form"><div class="field"><label for="tl-title">Título</label><input id="tl-title" name="title" maxlength="120" required value="${esc(s.title || "")}" placeholder="${isEvent ? "A queda da Torre Rubra" : s.kind === "start" ? "O Despertar" : "A última batalha"}"></div><div class="field"><label for="tl-when">Quando (opcional)</label><input id="tl-when" name="when" maxlength="60" value="${esc(s.when || "")}" placeholder="Ano 1203, fim do inverno" aria-describedby="tl-when-hint"><small id="tl-when-hint" class="form-help">Texto livre: data do mundo, era ou sessão.</small></div><div class="field"><label for="tl-summary">Descrição curta</label><textarea id="tl-summary" name="summary" rows="2" maxlength="280" aria-describedby="tl-summary-hint">${esc(s.summary || "")}</textarea><small id="tl-summary-hint" class="form-help">Aparece na própria linha do tempo.</small></div><div class="field"><label for="tl-details">Relato completo (opcional)</label><textarea id="tl-details" name="details" rows="8" maxlength="10000" aria-describedby="tl-details-hint">${esc(s.details || "")}</textarea><small id="tl-details-hint" class="form-help">Aparece só para quem abrir o ponto.</small></div>${isEvent && events.length && (s.id ? others.length : true) ? `<div class="field"><label for="tl-position">Posição na história</label><select id="tl-position" name="position">${positions}</select></div>` : ""}<label class="check"><input type="checkbox" name="published" aria-describedby="tl-published-hint" ${s.published ? "checked" : ""}> Mostrar ao grupo</label><small id="tl-published-hint" class="form-help">Sem marcar, o ponto fica em rascunho e só você o vê.</small>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar ponto</button></div></form>`);
  $("#tl-title").focus();
  $("#tl-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (form) => {
      const position = form.position || (s.id ? current : "end");
      const body = { title: form.title, when: form.when, summary: form.summary, details: form.details, kind: s.kind, published: form.published === "on", revision: s.revision || 0 };
      if (!s.id) {
        await api(base(d), "POST", { ...body, first: position === "first", after: position !== "first" && position !== "end" ? position : null });
      } else {
        const saved = await api(`${base(d)}/${s.id}`, "PUT", body);
        if (isEvent && position !== current) {
          const to = position === "first" ? 0 : others.findIndex((x) => x.id === position) + 1;
          await api(`${base(d)}/${s.id}/move`, "POST", { to, revision: saved.revision });
        }
      }
      $("#modal").close();
      toast("Linha do tempo atualizada.");
      await reload();
    });
  };
}

function confirmDelete(d, s, reload) {
  modal("Excluir este ponto?", `<p>O ponto <strong>${esc(s.title)}</strong> sai da linha do tempo, com a descrição curta e o relato completo.</p><p class="muted small">Esta ação não pode ser desfeita.</p><form id="tl-delete-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir ponto</button></div></form>`);
  $("#tl-delete-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      await api(`${base(d)}/${s.id}?revision=${encodeURIComponent(s.revision)}`, "DELETE");
      $("#modal").close();
      toast("Ponto excluído.");
      await reload();
    });
  };
}
