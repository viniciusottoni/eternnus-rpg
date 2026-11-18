// Vitrine discreta da Loja do Aventureiro (ADR-104/107): faixa entre a barra superior e o título das páginas elegíveis.
// Componente único, montado no slot #store-strip criado por layout.shell(). Nunca bloqueia a página: consulta em segundo
// plano, cancela ao trocar de rota, some em silêncio em falhas e reserva a altura só quando espera ter produtos.
// Round Robin inteligente (ADR-108): cada navegação real pede uma seleção nova ao servidor (fonte de verdade da rotação);
// renderizações da mesma rota reaproveitam a exibição atual. Um cartão só conta como visto com ≥ 50% visível por ~1 s; a
// confirmação vai por POST com o token da exibição e a próxima consulta espera por ela (para o ciclo já ter avançado).
import { esc, toast } from "./ui.js";
import { storeRecommendations, storePreferences, saveStorePreferences, recordStoreClick, recordStoreImpressions } from "./store-api.js";
import {
  showcasePage, showcaseCampaign, showcaseLayout, safeOfferUrl, safeImageUrl, priceLabel, truncate, marketplaceName, atMarketplace,
  EXPOSURE_MS, EXPOSURE_RATIO, isNewNavigation, exposureVisible, createExposureLedger,
} from "./store-policy.js";

const OFF_MS = 10 * 60 * 1000;
const OFF_KEY = "eternnus.store.stripOff";
/** Espera máxima pela confirmação anterior antes de pedir a próxima seleção. */
const FLUSH_WAIT_MS = 1500;
let installed = false;
let lastRoute = null; // rota da última sincronização (navegação real = rota diferente)
let navigation = 0;
let current = null; // { key, nav, data } — exibição da navegação atual
let pending = null; // { key, nav, controller }
const ledger = createExposureLedger();
let observer = null;
const timers = new Map(); // produto → temporizador de ~1 s
let queued = new Map(); // token → Set(produtos) aguardando envio
let flushTimer = 0;
let flushing = Promise.resolve();

/** Só um booleano com prazo vai ao sessionStorage: "a faixa está desligada/vazia" (nunca produtos ou perfil). */
function knownOff() {
  try {
    const at = Number(sessionStorage.getItem(OFF_KEY));
    return at > 0 && Date.now() - at < OFF_MS;
  } catch {
    return false;
  }
}
function rememberOff(off) {
  try {
    if (off) sessionStorage.setItem(OFF_KEY, String(Date.now()));
    else sessionStorage.removeItem(OFF_KEY);
  } catch {}
}

/** Esquece a exibição atual e o estado "desligada" (ex.: depois de salvar preferências na loja). */
export function invalidateShowcase() {
  current = null;
  lastRoute = null;
  rememberOff(false);
  pending?.controller.abort();
  pending = null;
  stopObserving();
}

function hide(slot) {
  stopObserving();
  if (!slot) return;
  slot.hidden = true;
  slot.removeAttribute("data-state");
  slot.replaceChildren();
}

// ---------- Exibição confirmada ----------
function flushNow() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  if (!queued.size) return flushing;
  const batch = queued;
  queued = new Map();
  for (const [view, ids] of batch) flushing = flushing.then(() => recordStoreImpressions(view, [...ids]));
  return flushing;
}
function markSeen(view, id) {
  if (!ledger.add(view, id)) return;
  if (!queued.has(view)) queued.set(view, new Set());
  queued.get(view).add(id);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNow, 50); // cartões que completam o segundo juntos vão no mesmo POST
}
function clearTimers() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
function stopObserving() {
  clearTimers();
  observer?.disconnect();
  observer = null;
}
function observe(slot, data) {
  stopObserving();
  const view = data?.view?.token;
  if (!view || typeof IntersectionObserver !== "function") return;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.storeItem;
      if (!id || ledger.has(view, id)) continue;
      if (exposureVisible(entry, document.visibilityState === "visible")) {
        if (!timers.has(id)) timers.set(id, setTimeout(() => { timers.delete(id); markSeen(view, id); }, EXPOSURE_MS));
      } else {
        clearTimeout(timers.get(id));
        timers.delete(id);
      }
    }
  }, { threshold: [0, EXPOSURE_RATIO, 1] });
  // Cartões escondidos pela largura (display: none) nunca cruzam o limiar: no celular só o primeiro conta.
  slot.querySelectorAll("[data-store-item]").forEach((item) => observer.observe(item));
}

function itemHtml(card) {
  const href = safeOfferUrl(card.url);
  if (!href) return "";
  const image = safeImageUrl(card.imageUrl);
  const store = marketplaceName(card.marketplace);
  const title = String(card.title || "");
  return `<li class="store-strip-item" data-store-item="${esc(card.id)}">${image ? `<img src="${esc(image)}" alt="" width="52" height="52" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="store-strip-thumb" aria-hidden="true">✦</span>`}<div class="store-strip-info"><span class="store-strip-name"${title.length > 90 ? ` data-tip-full="${esc(title.slice(0, 1000))}"` : ""}>${esc(truncate(title, 90))}</span><span class="store-strip-meta"><span class="store-strip-price">${esc(priceLabel(card))}</span><span class="store-badge" data-store="${esc(card.marketplace)}">${esc(store)}</span></span></div><a class="store-strip-offer" href="${esc(href)}" target="_blank" rel="sponsored noopener noreferrer" data-store-product="${esc(card.id)}" aria-label="Comprar ${esc(title)} ${esc(atMarketplace(card.marketplace))} (abre em nova aba; link de afiliado)">Comprar <span aria-hidden="true">↗</span></a></li>`;
}

function render(slot, data) {
  const items = (data.items || []).map(itemHtml).filter(Boolean);
  if (!data.show || !items.length) {
    hide(slot);
    if (data.reason === "disabled" || data.reason === "hidden" || data.reason === "empty") rememberOff(true);
    return;
  }
  const layout = showcaseLayout(data.layout);
  slot.hidden = false;
  slot.dataset.state = "ready";
  slot.dataset.view = String(data.view?.cycle ?? "");
  slot.innerHTML = `<div class="store-strip-head"><span class="store-strip-title"><span aria-hidden="true">✦</span> Selecionados para sua aventura</span><span class="store-strip-note">Links de afiliado · preços podem variar</span><a class="store-strip-more" href="#store">Ver mais na loja <span aria-hidden="true">→</span></a><button type="button" class="icon-button store-strip-hide" data-action="store-strip-hide" aria-label="Ocultar recomendações">×</button></div><ul class="store-strip-items" data-wide="${layout.wide}" data-medium="${layout.medium}" data-narrow="${layout.narrow}">${items.join("")}</ul>`;
  observe(slot, data);
}

function bind(slot) {
  if (slot.dataset.bound) return;
  slot.dataset.bound = "1";
  slot.addEventListener("click", async (event) => {
    const offer = event.target.closest("a[data-store-product]");
    if (offer) {
      // Um clique prova que o cartão foi visto: a exibição é confirmada antes do clique, para a atribuição (CTR).
      const id = offer.dataset.storeProduct;
      const view = current?.data?.view?.token;
      if (view) markSeen(view, id);
      flushNow().then(() => recordStoreClick(id, "showcase"));
      return;
    }
    if (!event.target.closest('[data-action="store-strip-hide"]')) return;
    hide(slot);
    rememberOff(true);
    current = null;
    try {
      const prefs = await storePreferences({ background: true });
      await saveStorePreferences({ ...prefs, showShowcase: false }, { background: true });
      toast("Recomendações ocultadas. Para mostrar de novo, abra Loja › Personalização.");
    } catch (error) {
      rememberOff(false);
      toast(error.message || "Não foi possível ocultar agora. Tente novamente.");
    }
  });
}

const routeKey = (hash) => {
  const page = showcasePage(hash);
  return page ? `${page}:${page === "campaign" ? showcaseCampaign(hash) : ""}` : "";
};
const settle = (promise) => Promise.race([promise.catch(() => {}), new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS))]);

/**
 * Sincroniza a faixa com a rota atual. Chamada por layout.shell() a cada tela; `verified` evita consultar
 * para contas sem e-mail confirmado. Rotas não elegíveis escondem a faixa e cancelam a consulta pendente.
 * Nova rota = nova navegação = nova seleção; a mesma rota renderizada de novo mantém a exibição atual.
 */
export function syncShowcase({ verified = false } = {}) {
  install();
  const slot = document.getElementById("store-strip");
  const hash = location.hash;
  const page = verified ? showcasePage(hash) : null;
  if (!slot || !page) {
    pending?.controller.abort();
    pending = null;
    lastRoute = null;
    hide(slot);
    return;
  }
  bind(slot);
  if (isNewNavigation(lastRoute, hash)) {
    lastRoute = hash;
    navigation++;
  }
  if (knownOff()) {
    hide(slot);
    return;
  }
  const campaignId = page === "campaign" ? showcaseCampaign(hash) : "";
  const key = `${page}:${campaignId}`;
  const nav = navigation;
  if (current && current.key === key && current.nav === nav) {
    // Renderização repetida da mesma navegação: mesma exibição, sem nova consulta nem avanço do ciclo.
    if (slot.dataset.state !== "ready") render(slot, current.data);
    return;
  }
  if (pending?.key === key && pending.nav === nav) return;
  pending?.controller.abort();
  stopObserving();
  // Altura reservada (sem animação) enquanto a consulta corre: o título da página não salta quando os produtos chegam.
  slot.hidden = false;
  slot.dataset.state = "loading";
  slot.innerHTML = '<span class="sr-only" role="status">Carregando recomendações…</span>';
  const controller = new AbortController();
  pending = { key, nav, controller };
  settle(flushNow())
    .then(() => (controller.signal.aborted ? null : storeRecommendations(page, campaignId, { signal: controller.signal })))
    .then((data) => {
      if (!data || pending?.controller !== controller) return;
      pending = null;
      current = { key, nav, data };
      if (slot.isConnected && routeKey(location.hash) === key && navigation === nav) render(slot, data);
    })
    .catch(() => {
      if (pending?.controller === controller) pending = null;
      if (!controller.signal.aborted) hide(slot);
    });
}

function install() {
  if (installed) return;
  installed = true;
  // Rotas sem moldura (mesa, convite, login) não chamam shell(): a troca de endereço também cancela a consulta, descarta
  // cartões que não completaram o segundo e marca que a volta a uma página elegível é uma nova navegação.
  window.addEventListener("hashchange", () => {
    if (!showcasePage(location.hash)) {
      pending?.controller.abort();
      pending = null;
      lastRoute = null;
      stopObserving();
      flushNow();
    }
  });
  // Aba oculta não conta tempo de exibição; ao voltar, o observador reavalia os cartões visíveis.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      clearTimers();
      flushNow();
      return;
    }
    const slot = document.getElementById("store-strip");
    if (slot?.dataset.state === "ready" && current) observe(slot, current.data);
  });
  window.addEventListener("session-expired", () => {
    invalidateShowcase();
    queued.clear();
    ledger.clear();
  });
}
