// Vitrine discreta da Loja do Aventureiro (ADR-104): faixa entre a barra superior e o título das páginas elegíveis.
// Componente único, montado no slot #store-strip criado por layout.shell(). Nunca bloqueia a página: consulta em segundo
// plano, cancela ao trocar de rota, some em silêncio em falhas e reserva a altura só quando espera ter produtos.
import { esc, toast } from "./ui.js";
import { storeRecommendations, storePreferences, saveStorePreferences, recordStoreClick } from "./store-api.js";
import { showcasePage, showcaseCampaign, showcaseLayout, safeOfferUrl, safeImageUrl, priceLabel, truncate, marketplaceName, atMarketplace } from "./store-policy.js";

const CACHE_MS = 5 * 60 * 1000;
const OFF_MS = 10 * 60 * 1000;
const OFF_KEY = "eternnus.store.stripOff";
const cache = new Map();
let pending = null; // { key, controller, promise }
let installed = false;

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

/** Esquece respostas e o estado "desligada" (ex.: depois de salvar preferências na loja). */
export function invalidateShowcase() {
  cache.clear();
  rememberOff(false);
  pending?.controller.abort();
  pending = null;
}

function hide(slot) {
  if (!slot) return;
  slot.hidden = true;
  slot.removeAttribute("data-state");
  slot.replaceChildren();
}

function itemHtml(card) {
  const href = safeOfferUrl(card.url);
  if (!href) return "";
  const image = safeImageUrl(card.imageUrl);
  const store = marketplaceName(card.marketplace);
  const title = String(card.title || "");
  return `<li class="store-strip-item">${image ? `<img src="${esc(image)}" alt="" width="52" height="52" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="store-strip-thumb" aria-hidden="true">✦</span>`}<div class="store-strip-info"><span class="store-strip-name"${title.length > 90 ? ` data-tip-full="${esc(title.slice(0, 1000))}"` : ""}>${esc(truncate(title, 90))}</span><span class="store-strip-meta"><span class="store-strip-price">${esc(priceLabel(card))}</span><span class="store-badge" data-store="${esc(card.marketplace)}">${esc(store)}</span></span></div><a class="store-strip-offer" href="${esc(href)}" target="_blank" rel="sponsored noopener noreferrer" data-store-product="${esc(card.id)}" aria-label="Ver oferta de ${esc(title)} ${esc(atMarketplace(card.marketplace))} (abre em nova aba; link de afiliado)">Ver oferta <span aria-hidden="true">↗</span></a></li>`;
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
  slot.innerHTML = `<div class="store-strip-head"><span class="store-strip-title"><span aria-hidden="true">✦</span> Selecionados para sua aventura</span><span class="store-strip-note">Links de afiliado · preços podem variar</span><a class="store-strip-more" href="#store">Ver mais na loja <span aria-hidden="true">→</span></a><button type="button" class="icon-button store-strip-hide" data-action="store-strip-hide" aria-label="Ocultar recomendações">×</button></div><ul class="store-strip-items" data-wide="${layout.wide}" data-medium="${layout.medium}" data-narrow="${layout.narrow}">${items.join("")}</ul>`;
}

function bind(slot) {
  if (slot.dataset.bound) return;
  slot.dataset.bound = "1";
  slot.addEventListener("click", async (event) => {
    const offer = event.target.closest("a[data-store-product]");
    if (offer) {
      recordStoreClick(offer.dataset.storeProduct, "showcase");
      return;
    }
    if (!event.target.closest('[data-action="store-strip-hide"]')) return;
    hide(slot);
    rememberOff(true);
    cache.clear();
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

/**
 * Sincroniza a faixa com a rota atual. Chamada por layout.shell() a cada tela; `verified` evita consultar
 * para contas sem e-mail confirmado. Rotas não elegíveis escondem a faixa e cancelam a consulta pendente.
 */
export function syncShowcase({ verified = false } = {}) {
  install();
  const slot = document.getElementById("store-strip");
  const hash = location.hash;
  const page = verified ? showcasePage(hash) : null;
  if (!slot || !page) {
    pending?.controller.abort();
    pending = null;
    hide(slot);
    return;
  }
  bind(slot);
  if (knownOff()) {
    hide(slot);
    return;
  }
  const campaignId = page === "campaign" ? showcaseCampaign(hash) : "";
  const key = `${page}:${campaignId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    render(slot, hit.data);
    return;
  }
  if (pending?.key === key) return;
  pending?.controller.abort();
  // Altura reservada (sem animação) enquanto a consulta corre: o título da página não salta quando os produtos chegam.
  slot.hidden = false;
  slot.dataset.state = "loading";
  slot.innerHTML = '<span class="sr-only" role="status">Carregando recomendações…</span>';
  const controller = new AbortController();
  pending = { key, controller };
  storeRecommendations(page, campaignId, { signal: controller.signal })
    .then((data) => {
      if (pending?.controller !== controller) return;
      pending = null;
      cache.set(key, { at: Date.now(), data });
      if (slot.isConnected && `${showcasePage(location.hash)}:${page === "campaign" ? showcaseCampaign(location.hash) : ""}` === key) render(slot, data);
    })
    .catch(() => {
      if (pending?.controller === controller) pending = null;
      if (!controller.signal.aborted) hide(slot);
    });
}

function install() {
  if (installed) return;
  installed = true;
  // Rotas sem moldura (mesa, convite, login) não chamam shell(): a troca de endereço também cancela a consulta.
  window.addEventListener("hashchange", () => {
    if (!showcasePage(location.hash)) {
      pending?.controller.abort();
      pending = null;
    }
  });
  window.addEventListener("session-expired", invalidateShowcase);
}
