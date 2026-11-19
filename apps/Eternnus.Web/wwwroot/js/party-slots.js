// Personagens reservados (ADR-110): tokens provisórios da campanha para preparar cenas sem jogadores nem fichas.
// Aqui ficam as chamadas HTTP (api.js; o servidor valida mestre, limites e revisões) e o HTML estático das prévias.
// O editor de cenas decide onde cada reservado entra; nada aqui altera cenas diretamente.
import { api } from "./api.js";
import { esc } from "./ui.js";
import { archetypeOf } from "./token-look.js";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET = /^asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Endereço exibível da imagem de um reservado: `asset:{guid}` da campanha ou link https. Outros valores: null. */
export function slotImageSrc(campaignId, imageUrl) {
  const v = typeof imageUrl === "string" ? imageUrl : "";
  const m = ASSET.exec(v);
  if (m && GUID.test(String(campaignId))) return `/api/campaigns/${campaignId}/assets/maps/${m[1]}/image`;
  return /^https:\/\/[^\s"'<>\\]+$/.test(v) ? v : null;
}

/** Desenho do arquétipo em SVG estático (sem dados do usuário), ou o ícone de personagem genérico. */
export function archetypeSvg(archetype) {
  const a = archetypeOf(archetype);
  const d = a ? a.path : "M12 4a4 4 0 110 8 4 4 0 010-8zM4 21c1-4.5 4-7 8-7s7 2.5 8 7";
  return `<svg class="se-slot-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

/** Miniatura redonda do reservado: imagem (quando segura) ou desenho do arquétipo, com o contorno tracejado de "reservado". */
export function slotPreviewHtml(campaignId, slot) {
  const src = slotImageSrc(campaignId, slot?.imageUrl);
  return `<span class="se-slot-preview${slot?.characterId ? " bound" : ""}" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : archetypeSvg(slot?.archetype)}</span>`;
}

/**
 * Lista de reservados da campanha com carga preguiçosa. `initial` aproveita `slots` vindos da cena (quando o servidor
 * já os inclui). Todas as escritas usam api.js (antiforgery comum) e devolvem o reservado atualizado.
 */
export function createSlotStore(campaignId, initial = null) {
  const base = `/campaigns/${campaignId}/party-slots`;
  let items = Array.isArray(initial) ? initial.map((s) => ({ ...s })) : null;
  let characters = null, loading = null, error = "";
  // Escritas feitas enquanto um GET está em andamento: a resposta (mais antiga) não pode apagá-las.
  let touched = new Map(), removed = new Set();
  const sort = () => { items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name), "pt-BR")); };
  const put = (slot) => {
    if (!slot?.id) return slot;
    if (!items) items = [];
    const i = items.findIndex((s) => s.id === slot.id);
    if (i >= 0) items[i] = { ...items[i], ...slot }; else items.push(slot);
    if (loading) touched.set(slot.id, items.find((s) => s.id === slot.id));
    sort();
    return items.find((s) => s.id === slot.id);
  };
  const store = {
    get items() { return items || []; },
    get loaded() { return items != null && characters != null; },
    /** A lista de reservados já é conhecida (veio com a cena ou foi carregada sem erro)? */
    get listed() { return items != null && !error; },
    get loading() { return !!loading; },
    get error() { return error; },
    get characters() { return characters || []; },
    byId: (id) => (items || []).find((s) => s.id === id) || null,
    /** Carrega (ou recarrega) reservados e personagens vinculáveis. Erros ficam em `error` (a lista anterior continua). */
    load(force = false) {
      if (loading) return loading;
      if (!force && items != null && characters != null) return Promise.resolve(store);
      touched = new Map(); removed = new Set();
      loading = api(base, "GET", undefined, { background: true })
        .then((r) => {
          const fresh = (r.items || []).filter((s) => !removed.has(s.id)).map((s) => touched.get(s.id) || { ...s });
          for (const [id, s] of touched) if (!fresh.some((x) => x.id === id)) fresh.push(s);
          items = fresh; characters = r.characters || []; error = ""; sort();
        })
        .catch((e) => { error = e?.message || "Não foi possível carregar os personagens reservados."; if (items == null) items = []; })
        .finally(() => { loading = null; });
      return loading.then(() => store);
    },
    async create(data = {}) { return put(await api(base, "POST", data, { background: true })); },
    async update(slot, patch) {
      const cur = store.byId(slot.id) || slot;
      const body = { name: cur.name, archetype: cur.archetype ?? null, imageUrl: cur.imageUrl ?? null, appearance: cur.appearance ?? null, size: cur.size ?? null, width: cur.width ?? null, height: cur.height ?? null, ...patch, revision: cur.revision };
      return put(await api(`${base}/${cur.id}`, "PUT", body, { background: true }));
    },
    async duplicate(slot) { return put(await api(`${base}/${slot.id}/duplicate`, "POST", {}, { background: true })); },
    async remove(slot) {
      await api(`${base}/${slot.id}`, "DELETE", undefined, { background: true });
      items = (items || []).filter((s) => s.id !== slot.id);
      if (loading) { removed.add(slot.id); touched.delete(slot.id); }
    },
    bindPreview: (slot, characterId) => api(`${base}/${slot.id}/bind-preview`, "POST", { characterId }, { background: true }),
    async bind(slot, { characterId, keepImage = true, resolve = null }) {
      const cur = store.byId(slot.id) || slot;
      const r = await api(`${base}/${cur.id}/bind`, "POST", { characterId, revision: cur.revision, keepImage: !!keepImage, resolve }, { background: true });
      put(r); characters = null;
      return r;
    },
    async unbind(slot) {
      const cur = store.byId(slot.id) || slot;
      const r = await api(`${base}/${cur.id}/unbind`, "POST", { revision: cur.revision }, { background: true });
      put(r); characters = null;
      return r;
    },
  };
  if (items) sort();
  return store;
}
