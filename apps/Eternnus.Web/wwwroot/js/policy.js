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
});
export const isSafeSegment = (value) => /^[A-Za-z0-9_-]{1,64}$/.test(String(value));
export const isStaff = (user) => !!user && (user.role === "admin" || user.role === "ambassador");
export const isAdmin = (user) => !!user && user.role === "admin";
/** Somente UX: o servidor reaplica papel e verificação em cada endpoint. */
export function canOpenPlatform(user, route) {
  if (!canAccess(user, route)) return false;
  if (route === "admin") return isAdmin(user);
  if (route === "templates") return isStaff(user);
  return true;
}
