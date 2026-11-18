// Loja do Aventureiro (#store, ADR-104): catálogo de produtos afiliados com busca, filtros, ordenação e paginação no
// servidor. A compra sempre acontece na loja de origem (nova aba). Regras puras em store-policy.js; HTTP em store-api.js.
import { shell } from "./layout.js";
import { $, esc, button, modal, toast, formError, submitForm } from "./ui.js";
import { helpButton } from "./help.js";
import { storeProducts, storeProduct, storeSuggestions, storeFilters, storePreferences, saveStorePreferences, clearStoreInterests, recordStoreClick } from "./store-api.js";
import { invalidateShowcase } from "./store-recommendations.js";
import {
  SORTS, AVAILABILITY, emptyFilters, catalogQuery, hasExplicitFilters, parseReais, safeOfferUrl, safeImageUrl,
  priceLabel, offerBadge, discountPercent, formatPrice, truncate, marketplaceName, atMarketplace, buyLabel, PRICE_UNKNOWN,
} from "./store-policy.js";

const META_MS = 5 * 60 * 1000;
// Filtros ficam em memória do módulo: voltar à loja mantém a busca anterior.
let filters = emptyFilters();
// Sessão de catálogo (ADR-108): fixa a ordem dos empates enquanto o usuário pagina; nova a cada abertura da loja.
let catalogSeed = 1;
let meta = null;
let metaAt = 0;

const DISCLOSURE = "Links de afiliado: o Eternnus pode receber uma comissão pelas compras feitas a partir destes links, sem custo extra para você. Preços e disponibilidade podem variar e são confirmados na loja.";
const when = (iso) => {
  const date = iso ? new Date(/(Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + "Z") : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};

function offerLink(card, surface, classes = "button primary store-offer") {
  const href = safeOfferUrl(card.url);
  if (!href) return '<span class="form-help">Oferta indisponível no momento.</span>';
  const store = atMarketplace(card.marketplace);
  return `<a class="${classes}" href="${esc(href)}" target="_blank" rel="sponsored noopener noreferrer" data-store-product="${esc(card.id)}" data-surface="${surface}" aria-label="Comprar ${esc(card.title)} ${esc(store)} (abre em nova aba; link de afiliado)">${esc(buyLabel(card.marketplace))} <span aria-hidden="true">↗</span></a>`;
}
function priceHtml(card) {
  const sale = offerBadge(card);
  return `<p class="store-card-price"><strong>${esc(priceLabel(card))}</strong>${sale ? ` <s aria-label="Preço anterior">${esc(formatPrice(card.previousPriceCents, card.currency))}</s>` : ""}</p>`;
}
/** Selo de desconto: no canto da imagem do cartão e como pílula no detalhe. Sem desconto válido, só "Oferta" (ou nada). */
function discountTag(card, cls) {
  const pct = discountPercent(card);
  return pct ? `<span class="${cls}" aria-label="${pct}% de desconto">−${pct}%</span>` : "";
}
const systemsText = (card) => (card.generic ? "Qualquer sistema" : (card.systems || []).map((s) => s.name).join(" · "));

function cardHtml(card) {
  const image = safeImageUrl(card.imageUrl);
  return `<article class="store-card metal"><div class="store-card-media">${discountTag(card, "store-discount")}${image ? `<img src="${esc(image)}" alt="" width="240" height="240" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="store-card-placeholder" aria-hidden="true">✦</span>'}</div><div class="store-card-body"><div class="store-card-tags"><span class="store-badge" data-store="${esc(card.marketplace)}">${esc(marketplaceName(card.marketplace))}</span>${offerBadge(card) && !discountPercent(card) ? '<span class="store-sale">Oferta</span>' : ""}</div><h3><button type="button" class="store-card-title" data-action="store-detail" data-id="${esc(card.id)}"${String(card.title).length > 110 ? ` data-tip-full="${esc(String(card.title).slice(0, 1000))}"` : ""}>${esc(truncate(card.title, 110))}</button></h3><p class="store-card-systems">${esc(systemsText(card))}${card.category ? ` · ${esc(card.category.name)}` : ""}</p>${priceHtml(card)}${offerLink(card, "store")}</div></article>`;
}

function check(name, value, label, checked, count) {
  const id = `store-f-${name}-${String(value).replace(/[^a-z0-9-]/gi, "")}`;
  return `<label class="store-check" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""}><span>${esc(label)}</span>${count === undefined ? "" : `<small>${Number(count) || 0}</small>`}</label>`;
}
function filtersHtml() {
  const m = meta || { categories: [], systems: [], marketplaces: [], genericCount: 0 };
  const systems = m.systems.filter((s) => s.count > 0 || filters.systems.includes(s.id));
  const categories = m.categories.filter((c) => c.count > 0 || filters.categories.includes(c.id));
  return `<fieldset><legend>Sistemas de RPG</legend>${systems.map((s) => check("system", s.id, s.name, filters.systems.includes(s.id), s.count)).join("")}${check("system", "generic", "Genéricos (qualquer sistema)", filters.systems.includes("generic"), m.genericCount)}</fieldset>
<fieldset><legend>Categorias</legend>${categories.length ? categories.map((c) => check("category", c.id, c.name, filters.categories.includes(c.id), c.count)).join("") : '<p class="form-help">Nenhuma categoria com produtos ainda.</p>'}</fieldset>
<fieldset><legend>Loja de origem</legend>${m.marketplaces.map((s) => check("marketplace", s.key, s.name, filters.marketplaces.includes(s.key), s.count)).join("")}</fieldset>
<fieldset><legend>Faixa de preço</legend><div class="store-price-range"><div class="field"><label for="store-min">Mínimo (R$)</label><input id="store-min" name="minPrice" inputmode="decimal" maxlength="12" autocomplete="off" value="${esc(filters.minPrice)}" aria-describedby="store-price-hint"></div><div class="field"><label for="store-max">Máximo (R$)</label><input id="store-max" name="maxPrice" inputmode="decimal" maxlength="12" autocomplete="off" value="${esc(filters.maxPrice)}" aria-describedby="store-price-hint"></div></div><small class="form-help" id="store-price-hint">Considera só preços conferidos recentemente.</small></fieldset>
<fieldset><legend>Disponibilidade e ofertas</legend>${check("available", "true", "Somente disponíveis (quando informado)", filters.available)}${check("onSale", "true", "Em oferta", filters.onSale)}</fieldset>
<div class="form-actions"><button type="submit" class="subtle">Aplicar preço</button>${button("Limpar filtros", "store-clear", "", "subtle")}</div>`;
}

function readFilters(form) {
  const data = new FormData(form);
  filters.systems = data.getAll("system").map(String);
  filters.categories = data.getAll("category").map(String);
  filters.marketplaces = data.getAll("marketplace").map(String);
  filters.minPrice = String(data.get("minPrice") || "").trim();
  filters.maxPrice = String(data.get("maxPrice") || "").trim();
  filters.available = data.get("available") === "true";
  filters.onSale = data.get("onSale") === "true";
}

/** Abre a página. Devolve ao roteador a função de descarte (cancela consultas e temporizadores). */
export async function renderStore() {
  catalogSeed = 1 + Math.floor(Math.random() * 2147483646);
  shell("store");
  const controllers = new Set();
  let suggestTimer = 0;
  let seq = 0;
  let alive = true;
  let listing = null; // consulta de produtos em andamento (só ela é trocada a cada nova busca)
  const signal = () => {
    const c = new AbortController();
    controllers.add(c);
    return c;
  };
  const wide = window.matchMedia("(min-width: 761px)").matches;
  $("#main").innerHTML = `<div class="page-heading store-heading"><div><span class="eyebrow">MERCADORES DE ETERNNUS</span><h1>Loja do Aventureiro</h1><p>Livros, dados, miniaturas e acessórios para as suas mesas, nas lojas parceiras.</p></div>${button("⚙ Personalização", "store-prefs", "", "subtle")}</div>
<p class="store-disclosure form-help">${esc(DISCLOSURE)}${helpButton("loja.pagina.afiliados", "Links de afiliado")}</p>
<form id="store-search" class="store-search" role="search"><div class="field"><label for="store-q">Buscar na loja</label><input id="store-q" name="q" type="search" list="store-suggest" maxlength="100" autocomplete="off" spellcheck="false" value="${esc(filters.q)}" placeholder="Livro, sistema, dado, miniatura…"><datalist id="store-suggest"></datalist></div><div class="field"><label for="store-sort">Ordenar por</label><select id="store-sort" name="sort"></select></div><button type="submit" class="primary">Buscar</button></form>
<div class="store-summary"><p id="store-count" class="store-count" aria-live="polite"></p><p id="store-context" class="form-help"></p></div>
<div class="store-layout"><details class="store-filters metal" id="store-filters-panel" ${wide ? "open" : ""}><summary>Filtros</summary><form id="store-filters" novalidate>${filtersHtml()}</form></details><section id="store-results" class="store-results" aria-label="Produtos"></section></div>`;
  const results = $("#store-results");
  const sortSelect = $("#store-sort");
  const paintSorts = () => {
    sortSelect.innerHTML = SORTS.filter(([key]) => key !== "popular" || meta?.popularity || filters.sort === "popular")
      .map(([key, label]) => `<option value="${key}" ${filters.sort === key ? "selected" : ""}>${label}</option>`).join("");
  };
  paintSorts();

  async function loadMeta() {
    if (meta && Date.now() - metaAt < META_MS) return;
    const c = signal();
    try {
      meta = await storeFilters({ signal: c.signal });
      metaAt = Date.now();
      if (!alive) return;
      $("#store-filters").innerHTML = filtersHtml();
      paintSorts();
    } catch {
      // Sem os filtros a lista continua utilizável; a busca e a ordenação seguem disponíveis.
    } finally {
      controllers.delete(c);
    }
  }

  async function load() {
    const request = ++seq;
    listing?.abort();
    results.setAttribute("aria-busy", "true");
    if (!results.querySelector(".store-grid")) results.innerHTML = '<p class="loading-line" role="status">Consultando os mercadores…</p>';
    const c = (listing = signal());
    try {
      const data = await storeProducts(catalogQuery(filters, "", catalogSeed), { signal: c.signal });
      if (!alive || request !== seq) return;
      paint(data);
    } catch (error) {
      if (!alive || request !== seq || c.signal.aborted) return;
      results.innerHTML = `<div class="empty" role="alert"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>Não foi possível abrir a loja.</h3><p>${esc(error.message || "Tente novamente em instantes.")}</p>${button("Tentar novamente", "store-retry", "", "primary")}</div>`;
      $("#store-count").textContent = "";
    } finally {
      controllers.delete(c);
      results.removeAttribute("aria-busy");
    }
  }

  function paint(data) {
    const total = Number(data.total) || 0;
    $("#store-count").textContent = total === 1 ? "1 produto encontrado" : `${total.toLocaleString("pt-BR")} produtos encontrados`;
    $("#store-context").textContent = data.personalized
      ? data.context?.systemName ? `Ordenado para sua aventura: ${data.context.systemName}.` : "Ordenado por relevância geral."
      : "";
    if (!total) {
      const filtered = hasExplicitFilters(filters);
      results.innerHTML = filtered
        ? `<div class="empty"><span class="empty-sigil" aria-hidden="true">⚖</span><h3>Nenhum produto com estes filtros</h3><p>Tente outra busca ou remova alguns filtros.</p>${button("Limpar filtros", "store-clear", "", "primary")}</div>`
        : '<div class="empty"><span class="empty-sigil" aria-hidden="true">⚖</span><h3>A loja ainda está sendo abastecida</h3><p>Os mercadores de Eternnus estão preparando a vitrine. Volte em breve.</p></div>';
      return;
    }
    const pages = Math.max(1, Math.ceil(total / (data.pageSize || 24)));
    filters.page = data.page || 1;
    results.innerHTML = `<div class="store-grid">${data.items.map(cardHtml).join("")}</div>${pages > 1 ? `<nav class="pagination" aria-label="Páginas da loja">${button("← Anterior", "store-page", filters.page - 1, "subtle small", filters.page <= 1 ? "disabled" : "")}<span>Página ${filters.page} de ${pages}</span>${button("Próxima →", "store-page", filters.page + 1, "subtle small", filters.page >= pages ? "disabled" : "")}</nav>` : ""}`;
  }

  function apply({ resetPage = true } = {}) {
    if (resetPage) filters.page = 1;
    load();
  }

  const main = $("#main");
  const onClick = async (event) => {
    const offer = event.target.closest("a[data-store-product]");
    if (offer) {
      recordStoreClick(offer.dataset.storeProduct, offer.dataset.surface === "detail" ? "detail" : "store");
      return;
    }
    const b = event.target.closest("[data-action^='store-']");
    if (!b || b.getAttribute("aria-disabled") === "true" || b.disabled) return;
    const action = b.dataset.action;
    if (action === "store-retry") load();
    if (action === "store-page") {
      filters.page = Math.max(1, Number(b.dataset.id) || 1);
      apply({ resetPage: false });
      results.scrollIntoView({ block: "start" });
    }
    if (action === "store-clear") {
      const keep = { q: "", sort: filters.sort };
      filters = { ...emptyFilters(), ...keep };
      $("#store-q").value = "";
      $("#store-filters").innerHTML = filtersHtml();
      apply();
    }
    if (action === "store-detail") openDetail(b.dataset.id);
    if (action === "store-prefs") openPreferences();
  };
  main.addEventListener("click", onClick);
  // Os modais (detalhe) ficam fora de #main: o clique na oferta do detalhe também é registrado.
  const modalBody = $("#modal-body");
  const onModalClick = (event) => {
    const offer = event.target.closest("a[data-store-product][data-surface='detail']");
    if (offer) recordStoreClick(offer.dataset.storeProduct, "detail");
  };
  modalBody.addEventListener("click", onModalClick);

  $("#store-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const q = $("#store-q").value.trim();
    if (q.length === 1) {
      toast("Digite ao menos 2 caracteres para buscar.");
      return;
    }
    filters.q = q;
    filters.sort = sortSelect.value;
    apply();
  });
  sortSelect.addEventListener("change", () => {
    filters.sort = sortSelect.value;
    apply();
  });
  $("#store-q").addEventListener("input", (event) => {
    clearTimeout(suggestTimer);
    const q = event.target.value.trim();
    if (q.length < 2) return;
    suggestTimer = setTimeout(async () => {
      const c = signal();
      try {
        const data = await storeSuggestions(q, { signal: c.signal });
        if (!alive) return;
        $("#store-suggest").innerHTML = (data.items || []).map((s) => `<option value="${esc(s.title)}"></option>`).join("");
      } catch {
        // Sugestões são opcionais.
      } finally {
        controllers.delete(c);
      }
    }, 300);
  });
  const filterForm = $("#store-filters");
  filterForm.addEventListener("change", (event) => {
    if (event.target.type !== "checkbox") return;
    readFilters(filterForm);
    apply();
  });
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    readFilters(filterForm);
    for (const [key, label] of [["minPrice", "mínimo"], ["maxPrice", "máximo"]])
      if (filters[key] && parseReais(filters[key]) === null) {
        toast(`Preço ${label} inválido. Use um valor como 49,90.`);
        return;
      }
    apply();
  });

  loadMeta();
  load();
  return () => {
    alive = false;
    clearTimeout(suggestTimer);
    for (const c of controllers) c.abort();
    controllers.clear();
    main.removeEventListener("click", onClick);
    modalBody.removeEventListener("click", onModalClick);
  };
}

async function openDetail(id) {
  let card;
  try {
    card = await storeProduct(id);
  } catch (error) {
    toast(error.message);
    return;
  }
  const image = safeImageUrl(card.imageUrl);
  const checked = card.priceStatus === "current" && card.priceCheckedAt ? `Preço conferido em ${when(card.priceCheckedAt)}.` : "";
  const availability = card.availability && card.availability !== "unknown" ? `<p><strong>Disponibilidade:</strong> ${esc(AVAILABILITY[card.availability] || "")} (na última conferência)</p>` : "";
  modal(card.title, `<div class="store-detail">${image ? `<img class="store-detail-image" src="${esc(image)}" alt="Imagem do produto" width="280" height="280" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}<div class="store-detail-body"><div class="store-card-tags"><span class="store-badge" data-store="${esc(card.marketplace)}">${esc(marketplaceName(card.marketplace))}</span>${offerBadge(card) ? discountTag(card, "store-sale") || '<span class="store-sale">Oferta</span>' : ""}</div>${card.brand ? `<p class="form-help">${esc(card.brand)}</p>` : ""}${priceHtml(card)}<p class="form-help">${esc(checked || (card.priceStatus === "stale" ? "O preço conhecido está desatualizado: confira na loja." : PRICE_UNKNOWN + "."))} Preços e disponibilidade podem variar.</p>${availability}<p><strong>Sistemas:</strong> ${esc(systemsText(card))}</p>${card.category ? `<p><strong>Categoria:</strong> ${esc(card.category.name)}</p>` : ""}${card.description ? `<p class="store-detail-description">${esc(card.description)}</p>` : ""}${card.tags?.length ? `<ul class="store-tags" aria-label="Palavras-chave">${card.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}<p class="form-help">${esc(DISCLOSURE)}</p><div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}${offerLink(card, "detail")}</div></div></div>`);
  $("#modal").classList.add("wide");
}

async function openPreferences() {
  let prefs;
  try {
    [prefs] = await Promise.all([storePreferences(), meta ? null : storeFilters().then((m) => { meta = m; metaAt = Date.now(); })]);
  } catch (error) {
    toast(error.message);
    return;
  }
  const systems = (meta?.systems || []).map((s) => `<option value="${esc(s.id)}" ${prefs.interestSystemId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const terms = prefs.interests?.terms?.length
    ? `<ul class="store-tags" aria-label="Interesses inferidos">${prefs.interests.terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
    : '<p class="form-help">Nenhum interesse inferido.</p>';
  modal("Personalização e privacidade", `<form id="store-prefs-form"><p class="modal-lead">Você escolhe o que a loja usa para sugerir produtos. Nada do que você escreve é enviado às lojas parceiras.${helpButton("loja.pagina.personalizacao", "Personalização da loja")}</p>
<label class="store-check" for="sp-show"><input type="checkbox" id="sp-show" name="showShowcase" ${prefs.showShowcase ? "checked" : ""} aria-describedby="sp-show-hint"><span>Mostrar recomendações no topo das páginas</span></label><small class="form-help" id="sp-show-hint">Nunca aparecem na mesa, nos editores de mapas e cenas nem nas fichas abertas.</small>
<label class="store-check" for="sp-campaigns"><input type="checkbox" id="sp-campaigns" name="useCampaignSystems" ${prefs.useCampaignSystems ? "checked" : ""} aria-describedby="sp-campaigns-hint"><span>Usar os sistemas das minhas campanhas</span></label><small class="form-help" id="sp-campaigns-hint">Só o sistema de RPG de cada campanha em que você joga ou mestra é usado. Desligado, a loja mostra produtos gerais ou o sistema escolhido abaixo.</small>
<label class="store-check" for="sp-messages"><input type="checkbox" id="sp-messages" name="analyzeMessages" ${prefs.analyzeMessages ? "checked" : ""} aria-describedby="sp-messages-hint"><span>Analisar minhas mensagens para sugerir produtos</span></label><small class="form-help" id="sp-messages-hint">Opcional. Considera só o que você escreveu nos últimos 180 dias: seus tópicos e respostas da Guilda e suas mensagens abertas à mesa. Nunca usa mensagens privadas, de outras pessoas, rolagens, fichas ou notas do mestre, e só guarda palavras do catálogo da loja (como “miniatura” ou “dados metálicos”). Desligar apaga o que foi inferido.${prefs.messagesConsentAt ? ` Consentimento dado em ${esc(when(prefs.messagesConsentAt))}.` : ""}</small>
<div class="field"><label for="sp-system">Sistema de interesse</label><select id="sp-system" name="interestSystemId" aria-describedby="sp-system-hint"><option value="">Automático (pelas campanhas)</option>${systems}</select><small class="form-help" id="sp-system-hint">Nas páginas gerais, este sistema passa à frente. Dentro de uma campanha, vale o sistema dela.</small></div>
<label class="store-check" for="sp-learn"><input type="checkbox" id="sp-learn" name="learnFromClicks" ${prefs.learnFromClicks !== false ? "checked" : ""} aria-describedby="sp-learn-hint"><span>Aprender com os produtos que eu abro</span></label><small class="form-help" id="sp-learn-hint">Sistemas e categorias dos produtos em que você clica passam a aparecer mais, aos poucos: um clique isolado pesa pouco e cliques antigos perdem força. O sistema da campanha continua à frente e outras sugestões seguem aparecendo.${prefs.learnedSystems?.length ? ` Aprendido até agora: ${esc(prefs.learnedSystems.join(", "))}.` : ""}</small>
<fieldset><legend>Interesses inferidos</legend>${terms}${button("Apagar interesses inferidos", "sp-clear", "", "subtle small", prefs.interests?.count ? "" : 'aria-disabled="true" data-tip="Não há interesses guardados."')}</fieldset>
${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar preferências</button></div></form>`);
  const form = $("#store-prefs-form");
  form.querySelector('[data-action="sp-clear"]').addEventListener("click", (event) => {
    if (event.currentTarget.getAttribute("aria-disabled") === "true") return;
    modal("Apagar interesses inferidos?", `<p>Os termos guardados são apagados agora. Mensagens anteriores a este momento não voltam a ser analisadas, mesmo com a análise ligada.</p><form id="store-clear-interests">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger">Apagar interesses</button></div></form>`);
    const confirmForm = $("#store-clear-interests");
    confirmForm.onsubmit = (e) => {
      e.preventDefault();
      submitForm(confirmForm, async () => {
        await clearStoreInterests();
        invalidateShowcase();
        $("#modal").close();
        toast("Interesses apagados.");
      });
    };
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(form, async () => {
      await saveStorePreferences({
        showShowcase: form.showShowcase.checked,
        useCampaignSystems: form.useCampaignSystems.checked,
        analyzeMessages: form.analyzeMessages.checked,
        interestSystemId: form.interestSystemId.value || null,
        learnFromClicks: form.learnFromClicks.checked,
      });
      invalidateShowcase();
      $("#modal").close();
      toast("Preferências da loja salvas.");
    });
  };
}
