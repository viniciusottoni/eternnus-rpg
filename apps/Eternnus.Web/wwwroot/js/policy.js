export const OPENING_DURATION = 3000;
export function canAccess(user, route) {
  return (
    !!user &&
    (["overview", "settings"].includes(String(route).split("/")[0]) ||
      !!user.verified)
  );
}
export function campaignActions(c) {
  return {
    edit: !!c.isMaster,
    delete: !!c.isMaster && !!c.canDelete,
    leave: !c.isMaster,
  };
}
// The application transitions at its fixed deadline; network requests never extend this clock.
// Background-tab timer throttling and a stalled browser can delay rendering beyond the deadline.
export function openingDeadline(start, now) {
  return Math.max(0, OPENING_DURATION - (now - start));
}

/** Rotas da plataforma: #rota/segmentos → [módulo, função]. A função recebe o array de segmentos e pode devolver uma função de descarte. */
export const PLATFORM_ROUTES = Object.freeze({
  admin: ["./admin.js", "renderAdmin"],
  support: ["./support.js", "renderSupport"],
  library: ["./library.js", "renderLibrary"],
  templates: ["./sheet-templates.js", "renderTemplates"],
  guild: ["./guild.js", "renderGuild"],
  progress: ["./progress.js", "renderProgress"],
  "one-shot": ["./one-shots.js", "renderOneShots"],
});
export const isSafeSegment = (value) => /^[A-Za-z0-9_-]{1,64}$/.test(String(value));
// Somente destinos internos sem query, token, URL ou segmento livre de usuário.
export function safeReturnRoute(value) {
  if (typeof value !== "string" || value.length > 256) return "overview";
  const parts = value.split("/");
  const roots = ["overview", "settings", "campaigns", "characters", "character", "history", "campaign", "table", "session", "dice", "invite", ...Object.keys(PLATFORM_ROUTES)];
  return roots.includes(parts[0]) && parts.every(isSafeSegment) ? value : "overview";
}
/** Código de convite: 32 caracteres hexadecimais minúsculos (mesmo formato aceito pelo servidor). */
export const isInviteCode = (value) => /^[0-9a-f]{32}$/.test(String(value || ""));
export const isStaff = (user) => !!user && (user.role === "admin" || user.role === "ambassador");
export const isAdmin = (user) => !!user && user.role === "admin";
/** Somente UX: o servidor reaplica papel e verificação em cada endpoint. */
export function canOpenPlatform(user, route) {
  if (!canAccess(user, route)) return false;
  if (route === "admin") return isAdmin(user);
  if (route === "templates") return isStaff(user);
  return true;
}

// Árvore de pastas de mapas: o servidor devolve a lista plana (até 100 pastas, 8 níveis).
// Pastas órfãs sobem para a raiz e ciclos são interrompidos para não travar a interface.
export function folderTree(folders) {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map();
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(folder);
  }
  for (const list of children.values())
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  return children;
}
export function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = [], seen = new Set();
  for (let at = byId.get(id); at && !seen.has(at.id); at = byId.get(at.parentId)) {
    seen.add(at.id);
    path.unshift(at);
  }
  return path;
}
export function flattenFolders(children, parent = "", depth = 0, out = []) {
  for (const folder of children.get(parent) || []) {
    if (out.some((f) => f.id === folder.id)) continue;
    out.push({ ...folder, depth });
    if (depth < 8) flattenFolders(children, folder.id, depth + 1, out);
  }
  return out;
}
