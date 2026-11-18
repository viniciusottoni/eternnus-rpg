// Regras puras dos medidores de "Minha conta" (ADR-096): contadores com ou sem limite e armazenamento por tipo.

/** Tipos de armazenamento, na ordem da barra. `tone` vira classe CSS fixa (nunca vem do servidor). */
export const STORAGE_PARTS = Object.freeze([
  Object.freeze({ key: "images", label: "Imagens e mapas", tone: "images" }),
  Object.freeze({ key: "attachments", label: "Anexos e atlas", tone: "attachments" }),
  Object.freeze({ key: "versions", label: "Versões salvas", tone: "versions" }),
  Object.freeze({ key: "texts", label: "Textos", tone: "texts" }),
  Object.freeze({ key: "portraits", label: "Retratos de personagens", tone: "portraits" }),
]);

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const ratio = (used, total) => (total > 0 ? Math.min(1, used / total) : 0);

/** Nível de alerta pelo uso: "ok", "near" (≥ 80%) ou "full" (≥ 100%). */
export function level(used, total) {
  if (!(total > 0)) return "ok";
  if (used >= total) return "full";
  return used / total >= 0.8 ? "near" : "ok";
}

export function formatBytes(bytes) {
  const n = count(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024).toLocaleString("pt-BR")} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${(n / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
}

/** Contador de quota. `limit` nulo = sem limite: mostra ∞ e continua contando, sem barra. */
export function countMeter(label, used, limit) {
  const value = count(used);
  const unlimited = limit == null;
  const max = unlimited ? null : count(limit);
  return {
    label,
    used: value,
    limit: max,
    unlimited,
    ratio: unlimited ? 0 : ratio(value, max),
    level: unlimited ? "ok" : level(value, max),
    display: `${value} / ${unlimited ? "∞" : max}`,
    spoken: unlimited ? `${label}: ${value}, sem limite` : `${label}: ${value} de ${max}`,
  };
}

/** Armazenamento das campanhas mestradas, segmentado por tipo. Capacidade = soma das cotas de imagens por campanha. */
export function storageMeter(storage = {}) {
  const parts = STORAGE_PARTS.map((part) => ({ ...part, bytes: count(storage[part.key]) }));
  const used = parts.reduce((sum, part) => sum + part.bytes, 0);
  const capacity = count(storage.capacity);
  const scale = Math.max(capacity, used);
  return {
    used,
    capacity,
    campaigns: count(storage.campaigns),
    perCampaign: count(storage.perCampaign),
    ratio: ratio(used, capacity),
    level: level(used, capacity),
    display: capacity ? `${formatBytes(used)} / ${formatBytes(capacity)}` : formatBytes(used),
    spoken: capacity
      ? `Armazenamento: ${formatBytes(used)} de ${formatBytes(capacity)}`
      : `Armazenamento: ${formatBytes(used)}, nenhuma campanha mestrada`,
    parts: parts.map((part) => ({ ...part, share: scale ? part.bytes / scale : 0, text: formatBytes(part.bytes) })),
  };
}
