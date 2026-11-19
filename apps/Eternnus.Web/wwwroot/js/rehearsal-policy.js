/**
 * Ensaiar cena (ADR-111): regras puras do ensaio no editor. O ensaio trabalha numa cópia (caixa de areia) da preparação:
 * mover, redimensionar, remover e acrescentar tokens de ensaio não mudam o rascunho até "Aplicar alterações à preparação".
 * Perfis de teste são genéricos (visão, luz, percepção e sentidos em texto), sem regras de um RPG específico.
 * Sem DOM nem HTTP; a prévia da visão continua calculada pelo servidor (POST …/prep/preview-view).
 */

/** Campos de posição e forma que o ensaio compara com a preparação. */
const GEOMETRY = ["x", "y", "fx", "fy", "appearance", "size", "width", "height"];
const MAX_METERS = 300, MAX_PERCEPTION = 1000;

/**
 * Perfis de teste por token. `profile` vai ao servidor como { visionMeters, lightMeters, perception, senses };
 * campo ausente = o que a ficha ou a mesa já definem. "Visão no escuro" usa o formato de sentidos da mesa ("nome: metros").
 */
export const PROFILE_PRESETS = Object.freeze([
  Object.freeze({ id: "default", label: "Visão padrão", hint: "Como a ficha e a mesa definem", profile: Object.freeze({}) }),
  Object.freeze({ id: "wide", label: "Visão ampliada", hint: "Enxerga até 36 m com luz", profile: Object.freeze({ visionMeters: 36 }) }),
  Object.freeze({ id: "dark", label: "Visão no escuro", hint: "Enxerga 18 m sem luz", profile: Object.freeze({ visionMeters: 18, senses: "visão no escuro: 18" }) }),
  Object.freeze({ id: "nolight", label: "Sem fonte de luz", hint: "Não carrega luz", profile: Object.freeze({ lightMeters: 0 }) }),
  Object.freeze({ id: "torch", label: "Carregando uma fonte de luz", hint: "Ilumina 12 m ao redor", profile: Object.freeze({ lightMeters: 12 }) }),
  Object.freeze({ id: "custom", label: "Personalizado", hint: "Visão, luz e percepção à mão", profile: Object.freeze({}) }),
]);

const int = (v, max) => {
  if (v === "" || v == null) return undefined;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : undefined;
};

/**
 * Perfil a enviar para uma escolha. `custom` só vale com o id "custom": { visionMeters?, lightMeters?, perception? }.
 * Ex.: profileFor("torch") → { lightMeters: 12 }; profileFor("custom", { visionMeters: "24" }) → { visionMeters: 24 }.
 */
export function profileFor(id, custom = {}) {
  const preset = PROFILE_PRESETS.find((p) => p.id === id);
  if (!preset || id === "default") return {};
  if (id !== "custom") return { ...preset.profile };
  const out = {};
  const vision = int(custom.visionMeters, MAX_METERS), light = int(custom.lightMeters, MAX_METERS), perception = int(custom.perception, MAX_PERCEPTION);
  if (vision !== undefined) out.visionMeters = vision;
  if (light !== undefined) out.lightMeters = light;
  if (perception !== undefined) out.perception = perception;
  return out;
}

/** Texto curto do perfil de um token ("" quando é o padrão). */
export function profileLabel(choice) {
  if (!choice || choice.id === "default") return "";
  const preset = PROFILE_PRESETS.find((p) => p.id === choice.id);
  if (choice.id !== "custom") return preset?.label || "";
  const p = profileFor("custom", choice.custom);
  const parts = [p.visionMeters != null && `visão ${p.visionMeters} m`, p.lightMeters != null && `luz ${p.lightMeters} m`, p.perception != null && `percepção ${p.perception}`].filter(Boolean);
  return parts.length ? `Personalizado: ${parts.join(", ")}` : "Personalizado";
}

/**
 * Caixa de areia a partir da preparação atual: cópia profunda, cada token com `ref` (índice na preparação) e `key`
 * estável (para perfis e observador). Nunca altera `prepared`.
 */
export function sandboxFrom(prepared = []) {
  return prepared.map((t, i) => ({ ...JSON.parse(JSON.stringify(t)), ref: i, key: `p${i}` }));
}

/** Rótulo do próximo token de ensaio: "Ensaio 1", "Ensaio 2"… (pula nomes já usados). */
export function nextRehearsalLabel(sandbox = []) {
  const used = new Set(sandbox.map((t) => t.label));
  for (let n = 1; n < 1000; n++) if (!used.has(`Ensaio ${n}`)) return `Ensaio ${n}`;
  return "Ensaio";
}

/** Token local do ensaio (aliado, sem personagem). Nunca é salvo: o servidor recusa `rehearsal: true` ao gravar a cena. */
export function rehearsalToken(sandbox, cell, key) {
  return { label: nextRehearsalLabel(sandbox), side: "ally", hidden: false, x: cell.x, y: cell.y, fx: cell.fx ?? null, fy: cell.fy ?? null,
    appearance: null, size: null, width: null, height: null, imageUrl: null, rehearsal: true, ref: null, key };
}

const same = (a, b, field) => (a?.[field] ?? null) === (b?.[field] ?? null);
const moved = (a, b) => !same(a, b, "x") || !same(a, b, "y") || !same(a, b, "fx") || !same(a, b, "fy");
const resized = (a, b) => !same(a, b, "appearance") || !same(a, b, "size") || !same(a, b, "width") || !same(a, b, "height");

/**
 * Diferença entre a preparação e o ensaio: listas de rótulos movidos, redimensionados, com imagem trocada, removidos,
 * convertidos em personagem reservado, acrescentados (personagens colocados durante o ensaio) e só do ensaio (não salvos).
 */
export function rehearsalDiff(prepared = [], sandbox = []) {
  const out = { moved: [], resized: [], image: [], removed: [], converted: [], added: [], rehearsalOnly: [] };
  const kept = new Set();
  for (const t of sandbox) {
    if (t.rehearsal) { out.rehearsalOnly.push(t.label); continue; }
    if (t.ref == null || !prepared[t.ref]) { (t.converted ? out.converted : out.added).push(t.label); continue; }
    kept.add(t.ref);
    const before = prepared[t.ref];
    if (moved(before, t)) out.moved.push(t.label);
    if (resized(before, t)) out.resized.push(t.label);
    if (!same(before, t, "imageUrl")) out.image.push(t.label);
  }
  prepared.forEach((t, i) => { if (!kept.has(i)) out.removed.push(t.label); });
  out.changed = out.moved.length + out.resized.length + out.image.length + out.removed.length + out.converted.length + out.added.length;
  return out;
}

/** Resumo em frases para a confirmação. Ex.: ["2 movido(s)", "1 removido(s)", "Não serão salvos: Ensaio 1"]. */
export function diffLines(diff) {
  const lines = [];
  const add = (list, text) => { if (list.length) lines.push(`${text}: ${list.join(", ")}`); };
  add(diff.moved, `${diff.moved.length} movido(s)`);
  add(diff.resized, `${diff.resized.length} com novo tamanho`);
  add(diff.image, `${diff.image.length} com outra imagem`);
  add(diff.removed, `${diff.removed.length} removido(s)`);
  add(diff.converted, `${diff.converted.length} convertido(s) em personagem reservado`);
  add(diff.added, `${diff.added.length} acrescentado(s)`);
  add(diff.rehearsalOnly, "Não serão salvos (tokens de ensaio)");
  return lines;
}

/**
 * Nova preparação com o resultado do ensaio: tokens existentes recebem posição, forma e imagem do ensaio; removidos
 * saem; convertidos e acrescentados entram no fim; tokens de ensaio ficam de fora. Campos internos (ref, key) somem.
 */
export function applyRehearsal(prepared = [], sandbox = []) {
  const strip = ({ ref, key, rehearsal, converted, ...rest }) => rest;
  const byRef = new Map(sandbox.filter((t) => !t.rehearsal && t.ref != null && prepared[t.ref]).map((t) => [t.ref, t]));
  const next = [];
  prepared.forEach((t, i) => {
    const s = byRef.get(i);
    if (!s) return;
    const patch = {};
    for (const f of [...GEOMETRY, "imageUrl"]) patch[f] = s[f] ?? null;
    next.push({ ...t, ...patch });
  });
  for (const t of sandbox) if (!t.rehearsal && (t.ref == null || !prepared[t.ref])) next.push(strip(t));
  return next;
}

/** O ensaio mudou algo em relação ao começo (posição, forma, imagem, tokens acrescentados ou removidos)? */
export const sandboxChanged = (start = [], sandbox = []) => JSON.stringify(start) !== JSON.stringify(sandbox);

/**
 * Opções de observador: grupo, personagens dos jogadores posicionados, reservados posicionados e tokens de ensaio.
 * Valores: "" (só luz comum), "party", "c:{characterId}" ou "t:{key}". Ex.: { value: "t:r1", label: "Ensaio 1 (ensaio)" }.
 */
export function observerOptions(sandbox = []) {
  const list = [{ value: "", label: "Só luz comum e áreas reveladas" }];
  if (sandbox.some((t) => t.characterId)) list.push({ value: "party", label: "Grupo (todos os jogadores juntos)" });
  for (const t of sandbox) {
    if (t.characterId) list.push({ value: `c:${t.characterId}`, label: t.label || "Personagem" });
    else if (t.slotId) list.push({ value: `t:${t.key}`, label: `${t.label || "Reservado"} (reservado)` });
    else if (t.rehearsal) list.push({ value: `t:${t.key}`, label: `${t.label} (ensaio)` });
  }
  return list;
}

/** Observador padrão ao entrar: primeiro personagem, senão primeiro reservado, senão primeiro token de ensaio. */
export function defaultObserver(sandbox = []) {
  const c = sandbox.find((t) => t.characterId);
  if (c) return `c:${c.characterId}`;
  const s = sandbox.find((t) => t.slotId || t.rehearsal);
  return s ? `t:${s.key}` : "";
}

/**
 * Campos de observador do pedido de prévia a partir da escolha e da caixa de areia:
 * { viewerCharacterId, viewerToken, party }. Escolha que não existe mais vira "só luz comum".
 */
export function viewerFields(observer, sandbox = []) {
  if (observer === "party") return { viewerCharacterId: null, viewerToken: null, party: true };
  if (observer?.startsWith("c:")) {
    const id = observer.slice(2);
    return sandbox.some((t) => t.characterId === id) ? { viewerCharacterId: id, viewerToken: null, party: false } : { viewerCharacterId: null, viewerToken: null, party: false };
  }
  if (observer?.startsWith("t:")) {
    const i = sandbox.findIndex((t) => t.key === observer.slice(2));
    return { viewerCharacterId: null, viewerToken: i >= 0 ? i : null, party: false };
  }
  return { viewerCharacterId: null, viewerToken: null, party: false };
}

/** Perfis enviados ao servidor: [{ token: índice, visionMeters?, lightMeters?, perception?, senses? }] só dos tokens com perfil. */
export function previewProfiles(sandbox = [], choices = new Map()) {
  const out = [];
  sandbox.forEach((t, i) => {
    const c = choices.get(t.key);
    const p = c ? profileFor(c.id, c.custom) : {};
    if (Object.keys(p).length) out.push({ token: i, ...p });
  });
  return out;
}
