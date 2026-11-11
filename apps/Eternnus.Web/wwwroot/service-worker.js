import { STATIC_PATHS, cacheablePath } from "./js/pwa-policy.js";
// Increment this version whenever the public shell/assets change. Never force an update mid-session.
const CACHE = "eternnus-public-shell-v42";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        STATIC_PATHS.map(async (path) => {
          const response = await fetch(
            new Request(path, { cache: "reload", credentials: "omit" }),
          );
          if (!response.ok || response.redirected)
            throw new Error("Public shell unavailable");
          await cache.put(path, response);
        }),
      );
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter(
            (name) =>
              name.startsWith("eternnus-public-shell-") && name !== CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const { request } = event,
    url = new URL(request.url);
  // Authentication, API data and non-GET actions always go straight to the network, including offline.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/signin-")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(url.search ? "/offline.html" : "/index.html")) ||
          Response.error()
        );
      }),
    );
    return;
  }
  const path = cacheablePath(request.url, self.location.origin, request.method);
  if (!path) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        cached = await cache.match(path);
      if (cached) return cached;
      // The install owns the cache contents. Do not store arbitrary runtime responses.
      return fetch(request);
    })(),
  );
});
