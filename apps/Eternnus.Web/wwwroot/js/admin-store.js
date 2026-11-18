// Painel admin › Loja (ADR-104): produtos afiliados, categorias, configurações da vitrine e métricas agregadas.
// Somente UX: o servidor reaplica a política Admin, valida links/preços e audita. HTTP em store-api.js.
import { $, esc, button, rowAction, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import {
  adminStoreProducts, adminStoreProduct, adminCreateStoreProduct, adminUpdateStoreProduct, adminStoreProductStatus, adminDeleteStoreProduct,
  adminPreviewLink, adminStoreCategories, adminSaveStoreCategory, adminDeleteStoreCategory, adminStoreSettings, adminSaveStoreSettings,
  adminStoreMetrics, activeRpgSystems,
} from "./store-api.js";
import { MARKETPLACES, STATUSES, AVAILABILITY, formatPrice, safeImageUrl, centsToInput, toCents, parseReais, parseTags, marketplaceName } from "./store-policy.js";

export const STORE_ADMIN_SECTIONS = Object.freeze([
  ["products", "Produtos"],
  ["categories", "Categorias e tags"],
  ["settings", "Vitrine"],
  ["metrics", "Indicadores"],
]);
const STATUS_TONE = { active: "good", draft: "quiet", paused: "warn", archived: "quiet" };
const number = (n) => Number(n || 0).toLocaleString("pt-BR");
const percent = (v) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
/** Filas do Round Robin inteligente (ADR-108) como aparecem no painel. */
const STRATEGIES = Object.freeze({ popular: "Populares do perfil", new: "Novidades do perfil", related: "Descoberta relacionada", explore: "Exploração fora do perfil", ranked: "Ranking clássico" });
const SHARES = [["sharePopular", "Populares"], ["shareNew", "Novidades"], ["shareRelated", "Descoberta relacionada"], ["shareExplore", "Exploração fora do perfil"]];
const when = (iso) => {
  const date = iso ? new Date(/(Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + "Z") : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
};
const loading = (text = "Consultando os mercadores…") => `<p class="loading-line" role="status">${esc(text)}</p>`;
const failure = (error) => `<div class="empty admin-state" role="alert"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>Não foi possível carregar.</h3><p>${esc(error?.message || "Tente novamente em instantes.")}</p>${button("Tentar novamente", "sa-retry", "", "primary")}</div>`;
const options = (pairs, selected, all = "") => `${all ? `<option value="">${esc(all)}</option>` : ""}${pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}`;
const statusChip = (status) => `<span class="status-chip ${STATUS_TONE[status] || "quiet"}">${esc(STATUSES[status] || status)}</span>`;

/** Monta a aba no painel. Devolve a função de descarte (ignora respostas atrasadas). */
export function renderStoreAdmin(view, segments = []) {
  const section = STORE_ADMIN_SECTIONS.some(([key]) => key === segments[0]) ? segments[0] : "products";
  let alive = true;
  let seq = 0;
  const filters = { q: "", status: "", marketplace: "", category: "", system: "", page: 1 };
  let lookups = null;
  view.innerHTML = `<nav class="page-tabs store-admin-tabs" aria-label="Seções da loja">${STORE_ADMIN_SECTIONS.map(([key, label]) => `<a href="#admin/store${key === "products" ? "" : "/" + key}" ${key === section ? 'aria-current="page" class="active"' : ""}>${label}</a>`).join("")}</nav><div id="sa-body" aria-live="polite"></div>`;
  const body = view.querySelector("#sa-body");
  const current = () => alive && body.isConnected;

  async function ensureLookups() {
    if (lookups) return lookups;
    const [categories, systems] = await Promise.all([adminStoreCategories(), activeRpgSystems()]);
    lookups = { categories, systems };
    return lookups;
  }

  // ---------- Produtos ----------
  async function products() {
    const request = ++seq;
    body.innerHTML = loading();
    let data;
    try {
      await ensureLookups();
      data = await adminStoreProducts(filters);
    } catch (error) {
      if (current() && request === seq) body.innerHTML = failure(error);
      return;
    }
    if (!current() || request !== seq) return;
    const counts = data.counts || {};
    const rows = data.items.map((p) => {
      const image = safeImageUrl(p.imageUrl);
      const toggle = p.status === "active" ? rowAction("pause", "Pausar", p.title, "sa-status", p.id, "subtle small", 'data-status="paused"')
        : rowAction("play", "Ativar", p.title, "sa-status", p.id, "subtle small", 'data-status="active"');
      return `<tr><td>${image ? `<img class="sa-thumb" src="${esc(image)}" alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer">` : '<span class="sa-thumb" aria-hidden="true">✦</span>'}</td><th scope="row">${button(esc(p.title), "sa-edit", p.id, "text-button", `aria-label="Editar: ${esc(p.title)}"`)}</th><td>${esc(p.marketplaceName)}</td><td>${p.systems.length ? esc(p.systems.map((s) => s.name).join(", ")) : '<span class="muted">Genérico</span>'}</td><td>${esc(p.category?.name || "—")}</td><td>${Number.isInteger(p.priceCents) ? `${esc(formatPrice(p.priceCents, p.currency))}<br><small class="muted">conferido ${esc(when(p.priceCheckedAt))}</small>` : '<span class="muted">—</span>'}</td><td>${statusChip(p.status)}</td><td><small>${esc(when(p.updatedAt))}</small></td><td>${number(p.clicks)}</td><td class="sa-actions">${toggle}${p.status !== "archived" ? rowAction("archive", "Arquivar", p.title, "sa-status", p.id, "subtle small", 'data-status="archived"') : ""}${rowAction("trash", "Excluir", p.title, "sa-delete", p.id, "danger small", `data-title="${esc(p.title)}"`)}</td></tr>`;
    });
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const anyFilter = Object.entries(filters).some(([k, v]) => k !== "page" && v);
    body.innerHTML = `<div class="section-title"><h2>Produtos afiliados${helpButton("admin.loja.link", "Cadastro por link de afiliado")}</h2>${button("+ Cadastrar produto", "sa-new", "", "primary")}</div>
<p class="sa-counts">${Object.keys(STATUSES).map((k) => `${statusChip(k)} ${number(counts[k])}`).join(" ")}</p>
<form id="sa-filter" class="admin-filters" role="search"><div class="field"><label for="sa-q">Nome ou marca</label><input id="sa-q" name="q" type="search" maxlength="100" value="${esc(filters.q)}"></div><div class="field"><label for="sa-status">Status</label><select id="sa-status" name="status">${options(Object.entries(STATUSES), filters.status, "Todos")}</select></div><div class="field"><label for="sa-market">Loja</label><select id="sa-market" name="marketplace">${options(Object.entries(MARKETPLACES), filters.marketplace, "Todas")}</select></div><div class="field"><label for="sa-category">Categoria</label><select id="sa-category" name="category">${options(lookups.categories.map((c) => [c.id, c.name]), filters.category, "Todas")}</select></div><div class="field"><label for="sa-system">Sistema</label><select id="sa-system" name="system">${options(lookups.systems.map((s) => [s.id, s.name]), filters.system, "Todos")}</select></div><button type="submit" class="subtle">Buscar</button></form>
${data.total ? `<div class="data-table-wrap" tabindex="0" role="region" aria-label="Produtos da loja"><table class="data-table sa-table"><caption class="sr-only">Produtos da loja</caption><thead><tr><th scope="col"><span class="sr-only">Imagem</span></th><th scope="col">Nome</th><th scope="col">Loja</th><th scope="col">Sistemas</th><th scope="col">Categoria</th><th scope="col">Preço</th><th scope="col">Status</th><th scope="col">Atualizado</th><th scope="col">Cliques</th><th scope="col">Ações</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>${pages > 1 ? `<nav class="pagination" aria-label="Páginas de produtos">${button("← Anterior", "sa-page", data.page - 1, "subtle small", data.page <= 1 ? "disabled" : "")}<span>Página ${data.page} de ${pages} · ${number(data.total)} produtos</span>${button("Próxima →", "sa-page", data.page + 1, "subtle small", data.page >= pages ? "disabled" : "")}</nav>` : ""}`
      : anyFilter ? '<p class="feed-empty">Nenhum produto com estes filtros.</p>'
      : `<div class="empty admin-state"><span class="empty-sigil" aria-hidden="true">⚖</span><h3>Nenhum produto cadastrado</h3><p>Cole um link de afiliado da Amazon, Shopee ou Mercado Livre para começar. Nada é publicado antes da sua revisão.</p>${button("+ Cadastrar o primeiro produto", "sa-new", "", "primary")}</div>`}`;
    body.querySelector("#sa-filter").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      for (const key of ["q", "status", "marketplace", "category", "system"]) filters[key] = String(form.get(key) || "").trim();
      filters.page = 1;
      products();
    });
  }

  function productForm(product) {
    const p = product || { currency: "BRL", availability: "unknown", status: "draft", priority: 0, systemIds: [], tags: [] };
    const systems = lookups.systems.map((s) => `<label class="store-check" for="sa-sys-${esc(s.id)}"><input type="checkbox" id="sa-sys-${esc(s.id)}" name="systemIds" value="${esc(s.id)}" ${p.systemIds.includes(s.id) ? "checked" : ""}><span>${esc(s.name)}</span></label>`).join("");
    const categories = lookups.categories.filter((c) => !c.archived || c.id === p.categoryId).map((c) => [c.id, c.name]);
    modal(product ? "Editar produto" : "Cadastrar produto", `<form id="sa-product" novalidate>
<div class="field"><div class="field-label"><label for="sa-url">URL de afiliado</label>${helpButton("admin.loja.link", "URL de afiliado")}</div><div class="sa-url-row"><input id="sa-url" name="affiliateUrl" type="url" required maxlength="2000" autocomplete="off" spellcheck="false" value="${esc(p.affiliateUrl || "")}" aria-describedby="sa-url-hint">${button("Buscar dados", "sa-preview", "", "subtle")}</div><small class="form-help" id="sa-url-hint">Amazon, Shopee ou Mercado Livre, https. O link é preservado com os parâmetros de afiliado e é o destino aberto pelos usuários.</small></div>
<div id="sa-preview-result" aria-live="polite">${product ? `<p class="form-help">Loja: <strong>${esc(product.marketplaceName)}</strong>${product.externalId ? ` · identificador ${esc(product.externalId)}` : ""}</p>` : ""}</div>
<div class="field"><label for="sa-title">Título</label><input id="sa-title" name="title" required maxlength="200" value="${esc(p.title || "")}"></div>
<div class="field"><label for="sa-description">Descrição</label><textarea id="sa-description" name="description" rows="4" maxlength="4000">${esc(p.description || "")}</textarea></div>
<div class="sa-grid"><div class="field"><label for="sa-image">URL da imagem</label><input id="sa-image" name="imageUrl" type="url" maxlength="1000" value="${esc(p.imageUrl || "")}" aria-describedby="sa-image-hint"><small class="form-help" id="sa-image-hint">Imagem https do próprio site da loja.</small></div><div class="sa-image-preview" id="sa-image-preview" aria-hidden="true"></div></div>
<div class="sa-grid"><div class="field"><label for="sa-brand">Marca ou editora</label><input id="sa-brand" name="brand" maxlength="120" value="${esc(p.brand || "")}"></div><div class="field"><label for="sa-category-f">Categoria</label><select id="sa-category-f" name="categoryId">${options(categories, p.categoryId, "Sem categoria")}</select></div></div>
<fieldset class="sa-systems"><legend>Sistemas de RPG</legend><p class="form-help">Nenhum marcado = produto genérico (serve a qualquer sistema).</p>${systems || '<p class="form-help">Nenhum sistema ativo.</p>'}</fieldset>
<div class="field"><label for="sa-tags">Tags e palavras-chave</label><input id="sa-tags" name="tags" maxlength="900" value="${esc((p.tags || []).join(", "))}" aria-describedby="sa-tags-hint"><small class="form-help" id="sa-tags-hint">Separadas por vírgula, até 20 (ex.: dragão, miniatura, d20). Ajudam a busca e as recomendações.</small></div>
<fieldset><legend>Oferta</legend><div class="sa-grid"><div class="field"><label for="sa-price">Preço atual (R$)</label><input id="sa-price" name="price" inputmode="decimal" maxlength="12" value="${esc(centsToInput(p.priceCents))}" data-offer></div><div class="field"><label for="sa-previous">Preço anterior (R$)</label><input id="sa-previous" name="previous" inputmode="decimal" maxlength="12" value="${esc(centsToInput(p.previousPriceCents))}" data-offer aria-describedby="sa-previous-hint"><small class="form-help" id="sa-previous-hint">Só quando verificável na loja e maior que o atual.</small></div><div class="field"><label for="sa-currency">Moeda</label><select id="sa-currency" name="currency" data-offer>${options([["BRL", "Real (BRL)"], ["USD", "Dólar (USD)"]], p.currency)}</select></div><div class="field"><label for="sa-availability">Disponibilidade</label><select id="sa-availability" name="availability" data-offer>${options(Object.entries(AVAILABILITY), p.availability)}</select></div></div>
<label class="store-check" for="sa-confirm"><input type="checkbox" id="sa-confirm" name="confirmPrice" aria-describedby="sa-confirm-hint"><span>Conferi este preço e a disponibilidade agora na loja</span></label><small class="form-help" id="sa-confirm-hint">${p.priceCheckedAt ? `Última conferência: ${esc(when(p.priceCheckedAt))}. ` : ""}Sem conferência recente, o público vê “Consultar preço na loja”.</small></fieldset>
<div class="sa-grid"><div class="field"><label for="sa-status-f">Status</label><select id="sa-status-f" name="status">${options(Object.entries(STATUSES), p.status)}</select></div><div class="field"><label for="sa-priority">Prioridade (0–100)</label><input id="sa-priority" name="priority" type="number" min="0" max="100" step="1" value="${Number(p.priority) || 0}" aria-describedby="sa-priority-hint"><small class="form-help" id="sa-priority-hint">Só desempata produtos igualmente relevantes; nunca passa à frente do sistema da campanha.</small></div></div>
<input type="hidden" name="externalId" value="${esc(p.externalId || "")}"><input type="hidden" name="canonicalUrl" value="${esc(p.canonicalUrl || "")}">
${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">${product ? "Salvar alterações" : "Cadastrar produto"}</button></div></form>`);
    $("#modal").classList.add("wide");
    const form = $("#sa-product");
    const imagePreview = () => {
      const src = safeImageUrl(form.imageUrl.value.trim());
      const box = form.querySelector("#sa-image-preview");
      box.innerHTML = src ? `<img src="${esc(src)}" alt="" width="96" height="96" referrerpolicy="no-referrer">` : "";
    };
    imagePreview();
    form.imageUrl.addEventListener("change", imagePreview);
    form.querySelectorAll("[data-offer]").forEach((input) => input.addEventListener("input", () => (form.confirmPrice.checked = true)));
    form.querySelectorAll("select[data-offer]").forEach((input) => input.addEventListener("change", () => (form.confirmPrice.checked = true)));
    form.querySelector('[data-action="sa-preview"]').addEventListener("click", async (event) => {
      const trigger = event.currentTarget;
      const out = form.querySelector("#sa-preview-result");
      if (!form.affiliateUrl.value.trim()) {
        out.innerHTML = '<p class="form-error" role="alert">Cole a URL de afiliado primeiro.</p>';
        return;
      }
      trigger.disabled = true;
      out.innerHTML = loading("Lendo os dados públicos do produto…");
      try {
        const r = await adminPreviewLink(form.affiliateUrl.value.trim());
        // namedItem: "title" e "name" colidem com propriedades nativas do <form>.
        const set = (name, value) => { if (value !== null && value !== undefined && value !== "") form.elements.namedItem(name).value = value; };
        set("title", r.title); set("description", r.description); set("imageUrl", r.imageUrl); set("brand", r.brand);
        set("externalId", r.externalId); set("canonicalUrl", r.canonicalUrl);
        if (Number.isInteger(r.priceCents)) { form.price.value = centsToInput(r.priceCents); form.confirmPrice.checked = false; }
        if (r.currency) form.currency.value = r.currency;
        if (r.availability) form.availability.value = r.availability;
        imagePreview();
        out.innerHTML = `<div class="notice-box"><p>Loja detectada: <strong>${esc(r.marketplaceName)}</strong>${r.externalId ? ` · identificador ${esc(r.externalId)}` : ""}${r.fetched ? " · dados públicos lidos" : ""}.</p>${r.duplicateOf ? `<p class="form-error">Já cadastrado: “${esc(r.duplicateOf.name)}”. Edite o existente para não duplicar.</p>` : ""}${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}<p class="form-help">Revise todos os campos antes de publicar. Marque a conferência do preço somente depois de abrir a página da loja.</p></div>`;
      } catch (error) {
        out.innerHTML = `<p class="form-error" role="alert">${esc(error.message)}</p>`;
      } finally {
        trigger.disabled = false;
      }
    });
    form.onsubmit = (event) => {
      event.preventDefault();
      submitForm(form, async (data) => {
        for (const [field, label] of [["price", "atual"], ["previous", "anterior"]])
          if (String(data[field] || "").trim() && parseReais(data[field]) === null) throw new Error(`Preço ${label} inválido. Use um valor como 49,90.`);
        const input = {
          affiliateUrl: String(data.affiliateUrl || "").trim(),
          title: String(data.title || "").trim(),
          description: String(data.description || "").trim(),
          imageUrl: String(data.imageUrl || "").trim() || null,
          brand: String(data.brand || "").trim(),
          categoryId: data.categoryId || null,
          systemIds: [...form.querySelectorAll('input[name="systemIds"]:checked')].map((i) => i.value),
          tags: parseTags(data.tags),
          priceCents: toCents(data.price),
          previousPriceCents: toCents(data.previous),
          currency: data.currency,
          confirmPrice: form.confirmPrice.checked,
          availability: data.availability,
          status: data.status,
          priority: Math.max(0, Math.min(100, Number(data.priority) || 0)),
          externalId: String(data.externalId || "").trim() || null,
          canonicalUrl: String(data.canonicalUrl || "").trim() || null,
          revision: product?.revision || 0,
        };
        if (product) await adminUpdateStoreProduct(product.id, input);
        else await adminCreateStoreProduct(input);
        $("#modal").close();
        toast(product ? "Produto atualizado." : "Produto cadastrado.");
        await products();
      });
    };
    form.affiliateUrl.focus();
  }

  async function editProduct(id) {
    try {
      const [product] = await Promise.all([adminStoreProduct(id), ensureLookups()]);
      productForm(product);
    } catch (error) {
      toast(error.message);
    }
  }
  async function changeStatus(id, status) {
    try {
      const product = await adminStoreProduct(id);
      await adminStoreProductStatus(id, status, product.revision);
      toast(`Produto ${STATUSES[status].toLowerCase()}.`);
      await products();
    } catch (error) {
      toast(error.message);
    }
  }
  function deleteProduct(id, title) {
    modal("Excluir produto?", `<p>“${esc(title)}” sai da loja, da vitrine e desta lista. Os cliques já registrados continuam nos indicadores até a retenção de 365 dias. A ação fica na auditoria.</p><form id="sa-delete">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir</button></div></form>`);
    $("#sa-delete").onsubmit = (event) => {
      event.preventDefault();
      submitForm(event.currentTarget, async () => {
        await adminDeleteStoreProduct(id);
        $("#modal").close();
        toast("Produto excluído.");
        await products();
      });
    };
  }

  // ---------- Categorias ----------
  async function categories() {
    const request = ++seq;
    body.innerHTML = loading();
    let list;
    try {
      list = await adminStoreCategories();
    } catch (error) {
      if (current() && request === seq) body.innerHTML = failure(error);
      return;
    }
    if (!current() || request !== seq) return;
    lookups = lookups ? { ...lookups, categories: list } : null;
    body.innerHTML = `<div class="section-title"><h2>Categorias e palavras-chave</h2>${button("+ Nova categoria", "sa-cat-new", "", "primary")}</div><p class="form-help">Palavras-chave ajudam a busca e formam o vocabulário dos interesses (só termos do catálogo são considerados). Sinônimos ficam em Vitrine. Sistemas de RPG vêm do cadastro de Sistemas.</p>
<div class="data-table-wrap" tabindex="0" role="region" aria-label="Categorias da loja"><table class="data-table"><caption class="sr-only">Categorias da loja</caption><thead><tr><th scope="col">Ordem</th><th scope="col">Nome</th><th scope="col">Palavras-chave</th><th scope="col">Produtos</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead><tbody>${list.map((c) => `<tr><td>${Number(c.order)}</td><th scope="row">${esc(c.name)}</th><td>${esc(c.keywords || "—")}</td><td>${number(c.products)}</td><td>${c.archived ? '<span class="status-chip quiet">Arquivada</span>' : '<span class="status-chip good">Ativa</span>'}</td><td class="sa-actions">${rowAction("edit", "Editar", c.name, "sa-cat-edit", c.id)}${c.products ? "" : rowAction("trash", "Excluir", c.name, "sa-cat-delete", c.id, "danger small")}</td></tr>`).join("")}</tbody></table></div>`;
    body._categories = list;
  }
  function categoryForm(category) {
    const c = category || { name: "", keywords: "", order: 50, archived: false };
    modal(category ? "Editar categoria" : "Nova categoria", `<form id="sa-cat"><div class="field"><label for="sa-cat-name">Nome</label><input id="sa-cat-name" name="name" required maxlength="60" value="${esc(c.name)}"></div><div class="field"><label for="sa-cat-keywords">Palavras-chave</label><input id="sa-cat-keywords" name="keywords" maxlength="500" value="${esc(c.keywords)}" aria-describedby="sa-cat-keywords-hint"><small class="form-help" id="sa-cat-keywords-hint">Separadas por vírgula.</small></div><div class="field"><label for="sa-cat-order">Ordem</label><input id="sa-cat-order" name="order" type="number" min="0" max="999" value="${Number(c.order) || 0}"></div>${category ? `<label class="store-check" for="sa-cat-archived"><input type="checkbox" id="sa-cat-archived" name="archived" ${c.archived ? "checked" : ""}><span>Arquivada (some dos filtros e do cadastro)</span></label>` : ""}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar</button></div></form>`);
    const form = $("#sa-cat");
    form.elements.namedItem("name").focus();
    form.onsubmit = (event) => {
      event.preventDefault();
      submitForm(form, async (data) => {
        await adminSaveStoreCategory(category?.id, { name: data.name.trim(), keywords: data.keywords.trim(), order: Number(data.order) || 0, archived: !!form.archived?.checked });
        $("#modal").close();
        toast("Categoria salva.");
        lookups = null;
        await categories();
      });
    };
  }

  // ---------- Configurações ----------
  async function settings() {
    const request = ++seq;
    body.innerHTML = loading();
    let s;
    try {
      s = await adminStoreSettings();
    } catch (error) {
      if (current() && request === seq) body.innerHTML = failure(error);
      return;
    }
    if (!current() || request !== seq) return;
    const readers = s.pageReader.length ? s.pageReader.map(marketplaceName).join(" e ") : "nenhuma loja";
    body.innerHTML = `<form id="sa-settings" class="sa-settings"><div class="section-title"><h2>Vitrine e recomendações${helpButton("admin.loja.recomendacao", "Como a recomendação ordena")}</h2></div>
<p class="notice-box">A vitrine nunca aparece na mesa ao vivo, nos editores de mapas e cenas, nas fichas abertas, no login nem no painel. A ordem dos grupos (sistema da campanha → outras campanhas → genéricos → interesses → demais) é fixa e não pode ser invertida por prioridade comercial.</p>
<label class="store-check" for="ss-enabled"><input type="checkbox" id="ss-enabled" name="enabled" ${s.enabled ? "checked" : ""}><span>Loja e vitrine habilitadas</span></label>
<fieldset><legend>Produtos por largura disponível</legend><div class="sa-grid"><div class="field"><label for="ss-wide">Telas largas</label><select id="ss-wide" name="showcaseWide">${options([[1, "1"], [2, "2"], [3, "3"]], s.showcaseWide)}</select></div><div class="field"><label for="ss-medium">Telas médias</label><select id="ss-medium" name="showcaseMedium">${options([[1, "1"], [2, "2"]], s.showcaseMedium)}</select></div><div class="field"><label for="ss-narrow">Celular</label><select id="ss-narrow" name="showcaseNarrow">${options([[1, "1"]], s.showcaseNarrow)}</select></div></div></fieldset>
<fieldset><legend>Páginas com vitrine</legend>${s.pageOptions.map((o) => `<label class="store-check" for="ss-page-${esc(o.key)}"><input type="checkbox" id="ss-page-${esc(o.key)}" name="pages" value="${esc(o.key)}" ${s.pages.includes(o.key) ? "checked" : ""}><span>${esc(o.label)}</span></label>`).join("")}</fieldset>
<fieldset><legend>Diversidade e repetição</legend><div class="sa-grid"><div class="field"><label for="ss-market">Máximo por loja na vitrine</label><input id="ss-market" name="maxPerMarketplace" type="number" min="1" max="3" value="${s.maxPerMarketplace}"></div><div class="field"><label for="ss-rotation">Janela de rotação (horas)</label><input id="ss-rotation" name="rotationHours" type="number" min="1" max="168" value="${s.rotationHours}" aria-describedby="ss-rotation-hint"><small class="form-help" id="ss-rotation-hint">Na página da loja e no ranking clássico, produtos com pontuação parecida alternam a cada janela.</small></div></div><label class="store-check" for="ss-diversity"><input type="checkbox" id="ss-diversity" name="categoryDiversity" ${s.categoryDiversity ? "checked" : ""}><span>Evitar repetir categoria quando houver alternativa próxima</span></label></fieldset>
<fieldset class="sa-rotation"><legend>Rotação inteligente da vitrine${helpButton("admin.loja.rotacao", "Rotação inteligente da vitrine")}</legend>
<label class="store-check" for="ss-smart"><input type="checkbox" id="ss-smart" name="smartRotation" ${s.smartRotation ? "checked" : ""}><span>Round Robin inteligente: populares, novidades, descoberta e exploração</span></label>
<label class="store-check" for="ss-nav"><input type="checkbox" id="ss-nav" name="rotateOnNavigation" ${s.rotateOnNavigation ? "checked" : ""} aria-describedby="ss-nav-hint"><span>Renovar a seleção a cada mudança de tela</span></label><small class="form-help" id="ss-nav-hint">Desligado, a seleção muda uma vez por janela de rotação.</small>
<div class="sa-grid"><div class="field"><label for="ss-repeat">Histórico antirrepetição (navegações)</label><input id="ss-repeat" name="repeatWindow" type="number" min="1" max="50" value="${s.repeatWindow}" aria-describedby="ss-repeat-hint"><small class="form-help" id="ss-repeat-hint">Um produto visto não volta nas próximas navegações, se houver alternativa. Catálogos pequenos repetem antes.</small></div><div class="field"><label for="ss-fatigue">Exibições sem clique antes de resfriar</label><input id="ss-fatigue" name="fatigueImpressions" type="number" min="0" max="50" value="${s.fatigueImpressions}" aria-describedby="ss-fatigue-hint"><small class="form-help" id="ss-fatigue-hint">A partir daí o produto volta com metade da frequência para aquela pessoa (0 desliga).</small></div></div>
<div class="sa-grid" role="group" aria-label="Proporção de cada fila" aria-describedby="ss-shares-hint">${SHARES.map(([key, label]) => `<div class="field"><label for="ss-${key}">${esc(label)} (%)</label><input id="ss-${key}" name="${key}" type="number" min="${key === "shareExplore" ? 5 : 0}" max="${key === "shareExplore" ? 50 : 100}" value="${Number(s[key]) || 0}" data-share></div>`).join("")}</div><small class="form-help" id="ss-shares-hint">Metas acumuladas do que cada pessoa vê; somam 100%. A exploração nunca é zero (mínimo 5%). Soma atual: <output id="ss-share-sum">${SHARES.reduce((sum, [key]) => sum + (Number(s[key]) || 0), 0)}%</output>.</small>
<label class="store-check" for="ss-learn"><input type="checkbox" id="ss-learn" name="learnFromClicks" ${s.learnFromClicks ? "checked" : ""}><span>Aprender com os cliques (cada pessoa também pode desligar em Personalização)</span></label>
<label class="store-check" for="ss-coverage"><input type="checkbox" id="ss-coverage" name="catalogCoverage" ${s.catalogCoverage ? "checked" : ""}><span>Cobertura progressiva: todo produto ativo recebe exibição ao longo das navegações</span></label></fieldset>
<fieldset><legend>Ofertas e metadados</legend><div class="sa-grid"><div class="field"><label for="ss-stale">Validade do preço conferido (horas)</label><input id="ss-stale" name="priceStaleHours" type="number" min="1" max="720" value="${s.priceStaleHours}" aria-describedby="ss-stale-hint"><small class="form-help" id="ss-stale-hint">Depois disso o público vê “Consultar preço na loja”.</small></div><div class="field"><label for="ss-refresh">Atualização de metadados (horas)</label><input id="ss-refresh" name="metadataRefreshHours" type="number" min="6" max="720" value="${s.metadataRefreshHours}" aria-describedby="ss-refresh-hint"><small class="form-help" id="ss-refresh-hint">Usado quando houver integração oficial. Leitura de dados públicos ativa para: ${esc(readers)}. Nenhuma API oficial está integrada.</small></div></div><label class="store-check" for="ss-image"><input type="checkbox" id="ss-image" name="requireImage" ${s.requireImage ? "checked" : ""}><span>Vitrine só com produtos que têm imagem</span></label></fieldset>
<div class="field"><label for="ss-synonyms">Sinônimos</label><textarea id="ss-synonyms" name="synonyms" rows="5" maxlength="8000" aria-describedby="ss-synonyms-hint">${esc(s.synonyms)}</textarea><small class="form-help" id="ss-synonyms-hint">Um grupo por linha, termos separados por vírgula (ex.: dado, dados, d20). Usado na busca e nos interesses.</small></div>
${formError()}<div class="form-actions"><button type="submit" class="primary">Salvar configurações</button></div></form>`;
    const form = body.querySelector("#sa-settings");
    const shareSum = () => SHARES.reduce((sum, [key]) => sum + (Number(form[key].value) || 0), 0);
    form.addEventListener("input", (event) => {
      if (event.target.matches("[data-share]")) form.querySelector("#ss-share-sum").textContent = `${shareSum()}%`;
    });
    form.onsubmit = (event) => {
      event.preventDefault();
      submitForm(form, async (data) => {
        if (shareSum() !== 100) throw new Error("As proporções das filas precisam somar 100%.");
        const saved = await adminSaveStoreSettings({
          enabled: form.enabled.checked,
          showcaseWide: Number(data.showcaseWide), showcaseMedium: Number(data.showcaseMedium), showcaseNarrow: Number(data.showcaseNarrow),
          pages: [...form.querySelectorAll('input[name="pages"]:checked')].map((i) => i.value),
          maxPerMarketplace: Number(data.maxPerMarketplace), categoryDiversity: form.categoryDiversity.checked,
          rotationHours: Number(data.rotationHours), priceStaleHours: Number(data.priceStaleHours), metadataRefreshHours: Number(data.metadataRefreshHours),
          requireImage: form.requireImage.checked, synonyms: data.synonyms, revision: s.revision,
          smartRotation: form.smartRotation.checked, rotateOnNavigation: form.rotateOnNavigation.checked,
          repeatWindow: Number(data.repeatWindow), fatigueImpressions: Number(data.fatigueImpressions),
          sharePopular: Number(data.sharePopular), shareNew: Number(data.shareNew), shareRelated: Number(data.shareRelated), shareExplore: Number(data.shareExplore),
          learnFromClicks: form.learnFromClicks.checked, catalogCoverage: form.catalogCoverage.checked,
        });
        s = saved;
        toast("Configurações da loja salvas.");
      });
    };
  }

  // ---------- Indicadores ----------
  let days = 30;
  async function metrics() {
    const request = ++seq;
    body.innerHTML = loading();
    let m;
    try {
      m = await adminStoreMetrics(days);
    } catch (error) {
      if (current() && request === seq) body.innerHTML = failure(error);
      return;
    }
    if (!current() || request !== seq) return;
    const list = (title, items) => `<section class="metal admin-panel"><div class="admin-panel-head"><h3>${esc(title)}</h3></div>${items.length && items.some((i) => i.clicks) ? `<ol class="sa-ranking">${items.filter((i) => i.clicks).map((i) => `<li><span>${esc(i.name)}</span><strong>${number(i.clicks)}</strong></li>`).join("")}</ol>` : '<p class="muted small">Sem cliques no período.</p>'}</section>`;
    const tile = (value, label, text) => `<div class="stat-tile"><strong>${esc(text ?? number(value))}</strong><span>${esc(label)}</span></div>`;
    // Lista agregada genérica: nome + valor já formatado (nunca dados de um usuário).
    const rows = (title, items, value, empty) => `<section class="metal admin-panel"><div class="admin-panel-head"><h3>${esc(title)}</h3></div>${items.length ? `<ol class="sa-ranking">${items.map((i) => `<li><span>${esc(i.name)}</span><strong>${esc(value(i))}</strong></li>`).join("")}</ol>` : `<p class="muted small">${esc(empty)}</p>`}</section>`;
    const rateText = (r) => `${number(r.impressions)} exib. · CTR ${percent(r.ctr)}${r.impressions && !r.reliable ? " (amostra pequena)" : ""}`;
    const strategies = (m.byStrategy || []).map((s) => ({ name: STRATEGIES[s.key] || s.key, ...s.rate }));
    body.innerHTML = `<div class="section-title"><h2>Indicadores${helpButton("admin.loja.metricas", "Indicadores da loja")}</h2><div class="field sa-days"><label for="sa-days">Período</label><select id="sa-days">${options([[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]], days)}</select></div></div>
<p class="form-help">Exibição conta só cartão da vitrine visto de fato (metade visível por cerca de 1 s). CTR = cliques atribuídos à exibição ÷ exibições; abaixo de ${number(m.impressions.minSample)} exibições a amostra é pequena e o CTR suavizado puxa para a média. Cliques não são vendas: receita, comissão e conversões não são conhecidas sem integração oficial com as lojas. Os números são agregados; históricos, termos e mensagens de usuários nunca chegam aqui.</p>
<div class="stat-grid">${tile(m.products.total, "produtos cadastrados")}${tile(m.products.active, "produtos ativos")}${tile(m.clicks.total, `cliques em ${m.days} dias`)}${tile(m.clicks.showcase, "cliques na vitrine")}${tile(m.clicks.store, "cliques na página da loja")}${tile(m.clicks.detail, "cliques no detalhe")}${tile(m.impressions.total, "exibições na vitrine")}${tile(0, "CTR da vitrine", percent(m.impressions.ctr))}${tile(0, "cobertura do catálogo ativo", percent(m.coverage.percent))}${tile(m.coverage.neverShown, "produtos ativos nunca exibidos")}</div>
<div class="admin-columns">${rows("Desempenho por fila", strategies, (s) => `${rateText(s)} · suavizado ${percent(s.smoothedCtr)}`, "Sem exibições no período.")}${rows("Produtos mais exibidos", (m.mostShown || []).map((p) => ({ name: p.name, ...p.rate })), rateText, "Sem exibições no período.")}${rows("Produtos menos exibidos", m.leastShown || [], (p) => `${number(p.impressions)} exib.`, "Nenhum produto ativo.")}${list("Produtos mais clicados", m.byProduct)}${rows("Lojas: exibições e cliques", m.byMarketplace || [], (i) => `${number(i.impressions)} exib. · ${number(i.clicks)} ${i.clicks === 1 ? "clique" : "cliques"}`, "Sem dados.")}${rows("Exibições por sistema", m.impressionsBySystem || [], (i) => `${number(i.impressions)} exib.`, "Sem exibições no período.")}${rows("Exibições por categoria", m.impressionsByCategory || [], (i) => `${number(i.impressions)} exib.`, "Sem exibições no período.")}${list("Categorias mais acessadas", m.byCategory)}${list("Sistemas com mais engajamento", m.bySystem)}</div>`;
    body.querySelector("#sa-days").addEventListener("change", (event) => {
      days = Number(event.target.value) || 30;
      metrics();
    });
  }

  const render = { products, categories, settings, metrics }[section];
  const onClick = async (event) => {
    const b = event.target.closest("[data-action^='sa-']");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    const { action, id } = b.dataset;
    if (action === "sa-retry") render();
    if (action === "sa-new") { try { await ensureLookups(); productForm(null); } catch (error) { toast(error.message); } }
    if (action === "sa-edit") editProduct(id);
    if (action === "sa-status") changeStatus(id, b.dataset.status);
    if (action === "sa-delete") deleteProduct(id, b.dataset.title || "");
    if (action === "sa-page") { filters.page = Math.max(1, Number(id) || 1); products(); }
    if (action === "sa-cat-new") categoryForm(null);
    if (action === "sa-cat-edit") categoryForm((body._categories || []).find((c) => c.id === id));
    if (action === "sa-cat-delete") {
      const category = (body._categories || []).find((c) => c.id === id);
      if (!category) return;
      modal("Excluir categoria?", `<p>“${esc(category.name)}” será removida. Categorias com produtos não podem ser excluídas: arquive-as.</p><form id="sa-cat-delete">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir</button></div></form>`);
      $("#sa-cat-delete").onsubmit = (e) => {
        e.preventDefault();
        submitForm(e.currentTarget, async () => {
          await adminDeleteStoreCategory(id);
          $("#modal").close();
          toast("Categoria excluída.");
          lookups = null;
          await categories();
        });
      };
    }
  };
  view.addEventListener("click", onClick);
  render();
  return () => {
    alive = false;
    seq++;
    view.removeEventListener("click", onClick);
  };
}
