// Public files only. Account responses, tokens, query strings and foreign origins never enter CacheStorage.
export const STATIC_PATHS = Object.freeze([
  "/index.html",
  "/offline.html",
  "/styles.css",
  "/game.css",
  "/sessions.css",
  "/platform.css",
  "/admin.css",
  "/library.css",
  "/sheets.css",
  "/guild.css",
  "/progress.css",
  "/manifest.webmanifest",
  ...[
    "app",
    "api",
    "auth",
    "campaigns",
    "game",
    "layout",
    "loading",
    "policy",
    "profile",
    "state",
    "ui",
    "pwa",
    "pwa-policy",
    "music",
    "music-policy",
    "session-policy",
    "sheet",
    "character-sheet",
    "character-policy",
    "filled-pdf",
    "campaign-page",
    "session-history",
    "table",
    "table-map",
    "temporary-images",
    "session-presence",
    "campaign-assets",
    "admin",
    "support",
    "library",
    "sheet-templates",
    "pdf-sheet",
    "formula",
    "guild",
    "progress",
    "support-policy",
    "sheet-editor-policy",
    "guild-policy",
    "progress-policy",
  ].map((name) => `/js/${name}.js`),
  "/assets/valley.webp",
  "/assets/eternnus-logo.webp",
  "/assets/avatar.svg",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/maskable-512.png",
  "/assets/icons/apple-touch-icon.png",
]);
export function cacheablePath(value, origin, method = "GET") {
  if (method !== "GET") return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin &&
      !url.search &&
      !url.username &&
      !url.password &&
      STATIC_PATHS.includes(url.pathname)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}
