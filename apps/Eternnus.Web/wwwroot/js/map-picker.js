// Seletor compartilhado de cenários: miniaturas reais, nome, tipo em linguagem simples, busca, recentes, cenários prontos
// e mapas da campanha. Na interface Completa, filtros por tipo e pasta. Escolher só muda a seleção e a prévia.
import { esc } from "./ui.js";
import { clearHighlight, highlightIn } from "./data-table.js";
import { mapThumbnail } from "./table-map.js";
import { acceptsMap, filterMaps, groupMaps, mapTypeLabel } from "./scene-policy.js";

const size = (m) => (m.kind === "tileset" && m.rows?.length ? ` · ${Number(m.rows[0].length)} × ${Number(m.rows.length)} casas` : "");

function card(m, selected, name, recent = false) {
  const value = `${m.kind}|${m.key}`;
  return `<label class="map-choice" data-map-choice data-key="${esc(m.key)}"${recent ? " data-recent" : ""}><input type="radio" name="${esc(recent ? name + "-recent" : name)}" value="${esc(value)}" ${m.key === selected ? "checked" : ""}><span class="map-preview" data-map-key="${esc(m.key)}"></span><span class="map-choice-text"><span class="eyebrow">${esc(mapTypeLabel(m))}${esc(size(m))}</span><strong>${esc(m.name)}</strong><small>${esc(m.description || "")}</small><span class="map-choice-state" aria-hidden="true">✓ Selecionado</span></span></label>`;
}

/**
 * HTML do seletor. `opts.sceneKind` restringe aos cenários aceitos pelo tipo de cena; `opts.complete` mostra filtros;
 * `opts.folders` (pastas da campanha) e `opts.recentKeys` quando houver dados.
 */
export function mapChoices(maps, selected, legend, opts = {}) {
  const name = opts.name || "map";
  const list = opts.sceneKind ? maps.filter((m) => acceptsMap(opts.sceneKind, m)) : maps;
  const groups = groupMaps(list, opts.recentKeys || []);
  const folders = opts.folders || [];
  const filters = opts.complete
    ? `<label class="field">Tipo<select data-map-type><option value="">Todos</option><option value="grid">Com grade</option><option value="image">Sem grade</option></select></label>${folders.length ? `<label class="field">Pasta<select data-map-folder><option value="">Todas as pastas</option>${folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select></label>` : ""}`
    : "";
  return `<fieldset class="map-choices" data-map-picker><legend>${esc(legend)}</legend>
    <div class="map-picker-tools"><label class="field">Buscar cenário<input type="search" data-map-filter placeholder="Ponte, floresta, salão…" maxlength="100"></label>${filters}<p class="form-help" data-map-count role="status">${list.length} cenários disponíveis</p></div>
    ${groups.map(([key, label, items]) => `<section class="map-group" data-map-group="${key}" aria-label="${esc(label)}"><h3 class="map-group-title">${esc(label)}</h3><div class="map-group-list">${items.map((m) => card(m, selected, name, key === "recent")).join("")}</div></section>`).join("")}
    <p class="map-picker-empty muted" hidden>Nenhum cenário encontrado. Tente outro nome ou limpe os filtros.</p>
  </fieldset>`;
}

/** Liga busca, filtros, miniaturas e seleção. `opts.onChange(map)` recebe o cenário escolhido. Devolve o descarte. */
export function mountMapChoices(root, maps, opts = {}) {
  const name = opts.name || "map";
  const picker = root.querySelector("[data-map-picker]") || root;
  const cards = [...picker.querySelectorAll("[data-map-choice]")];
  const byKey = new Map(maps.map((m) => [m.key, m]));
  // Miniaturas sob demanda: só quando o cartão aparece.
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { mapThumbnail(e.target, byKey.get(e.target.dataset.mapKey)); io.unobserve(e.target); }
  }, { rootMargin: "120px" }) : null;
  picker.querySelectorAll("[data-map-key]").forEach((el) => (io ? io.observe(el) : mapThumbnail(el, byKey.get(el.dataset.mapKey))));
  const selectedKey = () => picker.querySelector(`input[name="${CSS.escape(name)}"]:checked`)?.value.split("|").slice(1).join("|") || "";
  const sync = () => {
    const key = selectedKey();
    for (const c of cards) {
      c.classList.toggle("selected", c.dataset.key === key);
      if (c.hasAttribute("data-recent")) c.querySelector("input").checked = c.dataset.key === key;
    }
  };
  const apply = () => {
    const query = picker.querySelector("[data-map-filter]")?.value || "";
    const type = picker.querySelector("[data-map-type]")?.value || "";
    const folderId = picker.querySelector("[data-map-folder]")?.value || "";
    const keep = new Set(filterMaps(maps, { query, type, folderId, selected: selectedKey() }).map((m) => m.key));
    let visible = 0;
    for (const c of cards) { c.hidden = !keep.has(c.dataset.key); if (!c.hidden && !c.hasAttribute("data-recent")) visible++; }
    for (const title of picker.querySelectorAll(".map-choice-text strong")) { clearHighlight(title); highlightIn(title, query); }
    picker.querySelectorAll("[data-map-group]").forEach((g) => (g.hidden = ![...g.querySelectorAll("[data-map-choice]")].some((c) => !c.hidden)));
    const filtered = query || type || folderId;
    picker.querySelector("[data-map-count]").textContent = filtered ? `${visible} cenário(s) encontrados · a seleção atual permanece visível` : `${visible} cenários disponíveis`;
    picker.querySelector(".map-picker-empty").hidden = visible > 0;
  };
  const onInput = (e) => { if (e.target.matches("[data-map-filter],[data-map-type],[data-map-folder]")) apply(); };
  const onChange = (e) => {
    const input = e.target.closest("[data-map-choice] input");
    if (!input) return;
    if (input.name !== name) {
      const main = picker.querySelector(`input[name="${CSS.escape(name)}"][value="${CSS.escape(input.value)}"]`);
      if (main) main.checked = true;
    }
    sync();
    opts.onChange?.(byKey.get(selectedKey()));
  };
  picker.addEventListener("input", onInput);
  picker.addEventListener("change", onChange);
  sync();
  apply();
  return () => { io?.disconnect(); picker.removeEventListener("input", onInput); picker.removeEventListener("change", onChange); };
}
