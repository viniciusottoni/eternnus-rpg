// Mundo e acervo › Linha do tempo (ADR-072, ADR-093). Carregado sob demanda. A linha serpenteia pela tela: linhas alternam de
// direção e curvas ligam uma fileira à outra; no celular vira uma linha vertical. O mestre escreve; o grupo lê o que foi publicado.
// Histórias longas são divididas em trechos recolhíveis, com um navegador no topo; o mestre insere pontos pelo "+" na própria linha.
import { api } from "./api.js";
import { $, esc, modal, button, formError, submitForm, toast, empty, actionBar } from "./ui.js";
import { helpButton } from "./help.js";

const base = (d) => `/campaigns/${d.id}/workspace/timeline`;
const MARKER = { start: { icon: "✦", label: "Início" }, end: { icon: "⚑", label: "Fim" } };
const SVG = "http://www.w3.org/2000/svg";
/** Acontecimentos por trecho. */
export const CHUNK = 10;
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
/** Trechos de `size` acontecimentos: `[{ index, from, to }]` com `to` exclusivo. Sempre ao menos um trecho. */
export function timelineChunks(count, size = CHUNK) {
  const n = Math.max(1, Math.ceil(Math.max(0, count) / size));
  return Array.from({ length: n }, (_, index) => ({ index, from: index * size, to: Math.min(count, (index + 1) * size) }));
}
/**
 * Trechos abertos: os salvos (válidos) ou, sem preferência, só o último (a parte mais recente da história).
 * `focus` (índice de trecho) sempre fica aberto, para o ponto recém-criado aparecer.
 */
export function openChunks(total, saved, focus = -1) {
  const open = new Set(Array.isArray(saved) ? saved.filter((i) => Number.isInteger(i) && i >= 0 && i < total) : [total - 1]);
  if (focus >= 0 && focus < total) open.add(focus);
  return open;
}

/** Descrição do ponto para leitores de tela e para o título do modal. */
const spotName = (s, n) => (s.kind === "event" ? `${n}. ${s.title}` : `${MARKER[s.kind].label}: ${s.title}`);

/** Botão "+" sobre a linha: insere um acontecimento depois de `after` (id) ou no início (`first`). Posicionado pelo desenho. */
function insertHtml(after, label, extra = "") {
  return `<button type="button" class="tl-ins${extra}" data-action="tl-insert" data-after="${esc(after)}" aria-label="${esc(label)}" data-tip="${esc(label)}"><span aria-hidden="true">+</span></button>`;
}

function spotHtml(s, n, canEdit, inserts = "") {
  const marker = MARKER[s.kind];
  const classes = ["tl-node", `tl-${s.kind}`, s.published ? "" : "tl-draft"].filter(Boolean).join(" ");
  const badge = canEdit && !s.published ? '<span class="tl-badge">Rascunho</span>' : "";
  return `<li class="${classes}" data-news-key="${esc(s.id)}"><button type="button" class="tl-spot" data-action="tl-open" data-id="${esc(s.id)}" aria-haspopup="dialog"><span class="tl-dot" aria-hidden="true">${marker ? marker.icon : n}</span><span class="tl-card">${marker ? `<span class="tl-kind">${marker.label}</span>` : ""}${s.when ? `<span class="tl-when">${esc(s.when)}</span>` : ""}<strong class="tl-title">${esc(s.title)}</strong>${s.summary ? `<span class="tl-summary">${esc(s.summary)}</span>` : ""}${badge}${s.hasDetails ? '<span class="tl-more">Ler relato completo</span>' : ""}</span></button>${inserts}</li>`;
}

const storeKey = (d) => `eternnus.timeline.open.${d.id}`;
function loadOpen(d) {
  try { const v = JSON.parse(localStorage.getItem(storeKey(d)) || "null"); return Array.isArray(v) ? v : null; } catch { return null; }
}
function saveOpen(d, open) {
  try { localStorage.setItem(storeKey(d), JSON.stringify([...open].sort((a, b) => a - b))); } catch { /* armazenamento indisponível: só não lembra */ }
}

export async function renderTimeline(d, target, focusId = "") {
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
  const insertable = canEdit && !full;
  const chunks = timelineChunks(events.length);
  const many = chunks.length > 1;
  const focusAt = events.findIndex((x) => x.id === focusId);
  const open = many ? openChunks(chunks.length, loadOpen(d), focusAt >= 0 ? Math.floor(focusAt / CHUNK) : -1) : new Set([0]);
  const tools = canEdit
    ? `${start ? "" : button("✦ Definir início", "tl-new", "start", "subtle small")}${end ? "" : button("⚑ Definir fim", "tl-new", "end", "subtle small")}${button("+ Acontecimento", "tl-new", "event", "primary small", full ? `aria-disabled="true" data-tip="Limite de ${limit} acontecimentos atingido."` : "")}`
    : "";
  const lead = canEdit
    ? "Conte a história da campanha em ordem. Use o + sobre a linha para inserir um acontecimento naquele ponto. A descrição curta aparece na linha; o relato completo, só ao abrir o ponto. Pontos em rascunho ficam visíveis apenas para você."
    : "A história da campanha até aqui. Abra um ponto para ler o relato completo.";

  /** Pontos do trecho `k`: início no primeiro; "novo acontecimento" (mestre) e fim no último. */
  function segmentNodes(k) {
    const { from, to } = chunks[k], last = k === chunks.length - 1;
    const html = [];
    if (k === 0 && start) html.push(spotHtml(start, 0, canEdit, insertable && events.length ? insertHtml("first", "Inserir acontecimento no início da história") : ""));
    for (let i = from; i < to; i++) {
      const s = events[i];
      // Antes do primeiro, sem marco de início: o + fica na ponta aberta da linha.
      const before = insertable && i === 0 && !start ? insertHtml("first", "Inserir acontecimento no início da história", " tl-ins-before") : "";
      // Depois do último acontecimento, o cartão "Novo acontecimento" já cumpre o papel.
      const after = insertable && i < events.length - 1 ? insertHtml(s.id, `Inserir acontecimento depois de ${i + 1}. ${s.title}`) : "";
      html.push(spotHtml(s, i + 1, canEdit, before + after));
    }
    if (last && insertable) html.push(`<li class="tl-node tl-add"><button type="button" class="tl-spot" data-action="tl-new" data-id="event"><span class="tl-dot" aria-hidden="true">+</span><span class="tl-card"><strong class="tl-title">Novo acontecimento</strong><span class="tl-summary">Acrescentar no fim da história</span></span></button></li>`);
    if (last && end) html.push(spotHtml(end, 0, canEdit));
    return html.join("");
  }
  const serpentHtml = (k) => `<div class="tl-wrap"><svg class="tl-path" aria-hidden="true" focusable="false"></svg><ol class="tl-serpent" aria-label="${many ? `Acontecimentos ${chunks[k].from + 1} a ${chunks[k].to}` : "Linha do tempo da campanha, em ordem"}">${segmentNodes(k)}</ol></div>`;
  /** Trecho recolhido: só a sequência de números, cada um abre o ponto direto. */
  function miniHtml(k) {
    const { from, to } = chunks[k];
    return `<ol class="tl-mini" aria-label="Pontos do trecho">${events.slice(from, to).map((s, j) => `<li><button type="button" class="tl-mini-dot${s.published ? "" : " tl-draft"}" data-action="tl-open" data-id="${esc(s.id)}" data-news-key="${esc(s.id)}" aria-label="${esc(spotName(s, from + j + 1))}" data-tip="${esc(s.title)}">${from + j + 1}</button></li>`).join("")}</ol>`;
  }
  function segmentHtml(k) {
    const { from, to } = chunks[k], list = events.slice(from, to), isOpen = open.has(k);
    const drafts = canEdit ? list.filter((s) => !s.published).length : 0;
    const whens = list.map((s) => s.when).filter(Boolean);
    const span = list.length ? `${list[0].title}${list.length > 1 ? ` → ${list.at(-1).title}` : ""}` : "";
    const when = whens.length ? (whens[0] === whens.at(-1) ? whens[0] : `${whens[0]} – ${whens.at(-1)}`) : "";
    const count = `${list.length} acontecimento${list.length === 1 ? "" : "s"}${drafts ? ` · ${drafts} rascunho${drafts === 1 ? "" : "s"}` : ""}`;
    return `<section class="tl-seg${isOpen ? " is-open" : ""}" id="tl-seg-${k}" data-seg="${k}"><h3 class="tl-seg-head"><button type="button" class="tl-seg-toggle" data-action="tl-toggle" data-seg="${k}" aria-expanded="${isOpen}" aria-controls="tl-seg-body-${k}"><span class="tl-seg-chevron" aria-hidden="true"></span><span class="tl-seg-range">${list.length ? `${from + 1}–${to}` : "Início"}</span><span class="tl-seg-text"><span class="tl-seg-span">${esc(span)}</span><span class="tl-seg-meta">${when ? `<em>${esc(when)}</em> · ` : ""}${count}</span></span></button></h3><div class="tl-seg-body" id="tl-seg-body-${k}">${isOpen ? serpentHtml(k) : miniHtml(k)}</div></section>`;
  }
  const nav = many
    ? `<nav class="tl-nav" aria-label="Trechos da linha do tempo"><div class="tl-nav-chips">${chunks.map((c) => `<button type="button" class="tl-chip${open.has(c.index) ? " is-open" : ""}" data-action="tl-jump" data-seg="${c.index}" aria-label="Ir para os acontecimentos ${c.from + 1} a ${c.to}: ${esc(events[c.from]?.title || "")}">${c.from + 1}–${c.to}</button>`).join("")}</div><div class="tl-nav-all">${button("Expandir tudo", "tl-all", "open", "subtle small")}${button("Recolher tudo", "tl-all", "close", "subtle small")}</div></nav>`
    : "";
  const body = items.length || canEdit
    ? many ? `${nav}<div class="tl-segs">${chunks.map((c) => segmentHtml(c.index)).join("")}</div>` : serpentHtml(0)
    : empty("A história ainda não foi contada aqui.", "Quando o mestre publicar acontecimentos, eles aparecem nesta linha do tempo.");
  target.innerHTML = `<div class="section-title"><h2>Linha do tempo${helpButton("campanhas.acervo.linha-do-tempo", "Linha do tempo")}</h2>${tools ? `<div class="tl-tools">${tools}</div>` : ""}</div><p class="muted small section-lead">${lead}</p>${body}`;

  // Cada trecho aberto tem a própria serpente (e o próprio observador de largura).
  const mounted = new Map();
  const mount = (k) => { const wrap = target.querySelector(`#tl-seg-body-${k} .tl-wrap`) || (!many && target.querySelector(".tl-wrap")); if (wrap) mounted.set(k, mountSerpent(wrap)); };
  const unmount = (k) => { mounted.get(k)?.(); mounted.delete(k); };
  const releaseAll = () => { for (const k of [...mounted.keys()]) unmount(k); };
  function setOpen(k, value) {
    const section = target.querySelector(`#tl-seg-${k}`);
    if (!section || open.has(k) === value) return;
    if (value) open.add(k); else open.delete(k);
    unmount(k);
    section.classList.toggle("is-open", value);
    section.querySelector(".tl-seg-toggle").setAttribute("aria-expanded", String(value));
    section.querySelector(".tl-seg-body").innerHTML = value ? serpentHtml(k) : miniHtml(k);
    target.querySelector(`.tl-chip[data-seg="${k}"]`)?.classList.toggle("is-open", value);
    if (value) mount(k);
    saveOpen(d, open);
  }
  const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

  const reload = (id = "") => renderTimeline(d, target, id);
  target.onclick = async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    try {
      const action = b.dataset.action;
      if (action === "tl-open") await readSpot(d, data, b.dataset.id, reload);
      if (action === "tl-new") await editor(d, data, { kind: b.dataset.id }, reload);
      if (action === "tl-insert") await editor(d, data, { kind: "event", after: b.dataset.after }, reload);
      if (action === "tl-toggle") setOpen(Number(b.dataset.seg), !open.has(Number(b.dataset.seg)));
      if (action === "tl-all") chunks.forEach((c) => setOpen(c.index, b.dataset.id === "open"));
      if (action === "tl-jump") {
        const k = Number(b.dataset.seg);
        setOpen(k, true);
        const section = target.querySelector(`#tl-seg-${k}`);
        section?.scrollIntoView({ block: "start", behavior: smooth() });
        section?.querySelector(".tl-seg-toggle")?.focus({ preventScroll: true });
      }
    } catch (error) { toast(error.message); }
  };
  if (items.length || canEdit) for (const k of open) mount(k);
  release = releaseAll;
  // Ponto recém-criado: rola até ele e devolve o foco.
  if (focusId) {
    const spot = target.querySelector(`.tl-spot[data-id="${CSS.escape(focusId)}"]`);
    if (spot) { spot.scrollIntoView({ block: "center", behavior: smooth() }); spot.focus({ preventScroll: true }); }
  }
  return () => release();
}

/**
 * Ligação a → b com a mesma curva do traço e o ponto do "+": no meio das retas; nas curvas de troca de fileira,
 * em t = 0,75 da Bézier, que cai no vão entre as fileiras e não sobre os cartões.
 */
function joint(a, b, i, cols, box) {
  if (cols === 1 || Math.abs(a.y - b.y) < 4) return { straight: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Troca de fileira: curva para fora, do lado em que a fileira anterior terminou.
  const right = Math.floor(i / cols) % 2 === 0;
  const room = right ? box.width - Math.max(a.x, b.x) - 6 : Math.min(a.x, b.x) - 6;
  const reach = Math.max(18, Math.min((b.y - a.y) * 0.62, room / 0.75));
  const dx = right ? reach : -reach;
  const t = 0.75, u = 1 - t;
  const at = (p0, p1, p2, p3) => u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  return { dx, x: at(a.x, a.x + dx, b.x + dx, b.x), y: at(a.y, a.y, b.y, b.y) };
}

/** Distribui os pontos na grade em serpente, desenha o caminho e posiciona os "+". Redesenha ao mudar a largura. Devolve o descarte. */
function mountSerpent(wrap) {
  const list = wrap.querySelector(".tl-serpent"), svg = wrap.querySelector(".tl-path");
  const nodes = [...list.children];
  const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cols = 0, frame = 0, first = true;
  const place = (btn, p, box) => {
    const li = btn.parentElement.getBoundingClientRect();
    btn.style.left = `${p.x + box.left - li.left}px`;
    btn.style.top = `${p.y + box.top - li.top}px`;
  };
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
    const mids = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], m = joint(a, b, i - 1, cols, box);
      mids.push(m);
      path += m.straight ? ` L${b.x},${b.y}` : ` C${a.x + m.dx},${a.y} ${b.x + m.dx},${b.y} ${b.x},${b.y}`;
    }
    const line = (d, cls) => { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); svg.append(p); return p; };
    line(path, "tl-track");
    const gold = line(path, "tl-line");
    // Sem marco nas pontas, a linha fica aberta (tracejada): a história continua antes ou depois (ou no trecho vizinho).
    const head = points[0], tail = points.at(-1);
    const lastRight = cols === 1 || Math.floor((points.length - 1) / cols) % 2 === 0;
    const headEnd = cols === 1 ? { x: head.x, y: Math.max(0, head.y - 40) } : { x: Math.max(2, head.x - 60), y: head.y };
    const tailEnd = cols === 1 ? { x: tail.x, y: tail.y + 40 } : { x: lastRight ? Math.min(box.width - 2, tail.x + 60) : Math.max(2, tail.x - 60), y: tail.y };
    if (!nodes[0].classList.contains("tl-start")) line(`M${headEnd.x},${headEnd.y} L${head.x},${head.y}`, "tl-open");
    if (!nodes.at(-1).classList.contains("tl-end")) line(`M${tail.x},${tail.y} L${tailEnd.x},${tailEnd.y}`, "tl-open");
    // "+" entre um ponto e o seguinte; o do último ponto do trecho fica no fim da ponta aberta, o de "antes" no começo dela.
    nodes.forEach((li, i) => {
      const after = li.querySelector(":scope > .tl-ins:not(.tl-ins-before)");
      if (after) place(after, i < mids.length ? mids[i] : tailEnd, box);
      const before = li.querySelector(":scope > .tl-ins-before");
      if (before) place(before, headEnd, box);
    });
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
  modal(spotName(s, number), `${meta.length ? `<p class="muted small">${meta.map(esc).join(" · ")}</p>` : ""}${s.summary ? `<p class="tl-lead">${esc(s.summary)}</p>` : ""}${s.details ? `<article class="workspace-prose">${esc(s.details)}</article>` : '<p class="muted small">Sem relato completo para este ponto.</p>'}${actionBar(nav, edit)}`);
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

/**
 * Criar ou editar. Na criação, o lugar já vem de onde o mestre clicou (+ na linha, "Inserir depois" ou o fim da história);
 * só a edição oferece a lista "No início" / "Depois de …" para mover o acontecimento.
 */
async function editor(d, data, s, reload) {
  const events = data.items.filter((x) => x.kind === "event");
  const isEvent = s.kind === "event";
  const others = events.filter((x) => x.id !== s.id);
  // Posição atual na edição: depois do anterior a ele.
  const index = events.findIndex((x) => x.id === s.id);
  const current = index > 0 ? events[index - 1].id : "first";
  const positions = `<option value="first" ${current === "first" ? "selected" : ""}>No início da história</option>${others.map((x, i) => `<option value="${esc(x.id)}" ${x.id === current ? "selected" : ""}>Depois de ${i + 1}. ${esc(x.title)}</option>`).join("")}`;
  // Criação: "first", o id do anterior ou o fim.
  const afterAt = events.findIndex((x) => x.id === s.after);
  const place = s.after === "first" ? "first" : afterAt >= 0 && afterAt < events.length - 1 ? s.after : "end";
  const where = place === "first" ? (events.length ? "Entra no início da história." : "") : place === "end" ? (events.length ? `Entra no fim da história, depois de ${events.length}. ${events.at(-1).title}.` : "") : `Entra depois de ${afterAt + 1}. ${events[afterAt].title}, antes de ${afterAt + 2}. ${events[afterAt + 1].title}.`;
  const positionField = s.id
    ? (isEvent && others.length ? `<div class="field"><label for="tl-position">Posição na história</label><select id="tl-position" name="position">${positions}</select></div>` : "")
    : (isEvent && where ? `<p class="tl-where small">${esc(where)}</p>` : "");
  const title = s.id ? "Editar ponto" : isEvent ? "Novo acontecimento" : s.kind === "start" ? "Definir início" : "Definir fim";
  modal(title, `<form id="tl-form">${s.id ? "" : positionField}<div class="field"><label for="tl-title">Título</label><input id="tl-title" name="title" maxlength="120" required value="${esc(s.title || "")}" placeholder="${isEvent ? "A queda da Torre Rubra" : s.kind === "start" ? "O Despertar" : "A última batalha"}"></div><div class="field"><label for="tl-when">Quando (opcional)</label><input id="tl-when" name="when" maxlength="60" value="${esc(s.when || "")}" placeholder="Ano 1203, fim do inverno" aria-describedby="tl-when-hint"><small id="tl-when-hint" class="form-help">Texto livre: data do mundo, era ou sessão.</small></div><div class="field"><label for="tl-summary">Descrição curta</label><textarea id="tl-summary" name="summary" rows="2" maxlength="280" aria-describedby="tl-summary-hint">${esc(s.summary || "")}</textarea><small id="tl-summary-hint" class="form-help">Aparece na própria linha do tempo.</small></div><div class="field"><label for="tl-details">Relato completo (opcional)</label><textarea id="tl-details" name="details" rows="8" maxlength="10000" aria-describedby="tl-details-hint">${esc(s.details || "")}</textarea><small id="tl-details-hint" class="form-help">Aparece só para quem abrir o ponto.</small></div>${s.id ? positionField : ""}<label class="check"><input type="checkbox" name="published" aria-describedby="tl-published-hint" ${s.published ? "checked" : ""}> Mostrar ao grupo</label><small id="tl-published-hint" class="form-help">Sem marcar, o ponto fica em rascunho e só você o vê.</small>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button class="primary" type="submit">Salvar ponto</button></div></form>`);
  $("#tl-title").focus();
  $("#tl-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (form) => {
      const body = { title: form.title, when: form.when, summary: form.summary, details: form.details, kind: s.kind, published: form.published === "on", revision: s.revision || 0 };
      let focus = s.id || "";
      if (!s.id) {
        const created = await api(base(d), "POST", { ...body, first: place === "first", after: place !== "first" && place !== "end" ? place : null });
        focus = created?.id || "";
      } else {
        const saved = await api(`${base(d)}/${s.id}`, "PUT", body);
        const position = form.position || current;
        if (isEvent && position !== current) {
          const to = position === "first" ? 0 : others.findIndex((x) => x.id === position) + 1;
          await api(`${base(d)}/${s.id}/move`, "POST", { to, revision: saved.revision });
        }
      }
      $("#modal").close();
      toast("Linha do tempo atualizada.");
      await reload(focus);
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
