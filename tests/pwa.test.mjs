import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/pwa-policy.js", import.meta.url),
  "utf8",
);
const { cacheablePath } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const origin = "https://rpg.eternnus.com";

test("offline caching accepts only known static assets on the app origin", () => {
  for (const path of [
    "/index.html",
    "/styles.css",
    "/game.css",
    "/js/app.js",
    "/js/api.js",
    "/js/auth.js",
    "/js/campaigns.js",
    "/js/layout.js",
    "/js/pwa.js",
    "/js/pwa-policy.js",
    "/js/music.js",
    "/js/music-policy.js",
    "/assets/avatar.svg",
    "/manifest.webmanifest",
  ]) {
    assert.equal(cacheablePath(origin + path, origin), path, path);
  }
});

test("authenticated APIs and health responses are never eligible for offline storage", () => {
  for (const path of [
    "/api/auth/me",
    "/api/auth/csrf",
    "/api/auth/providers",
    "/api/campaigns",
    "/api/campaigns/123",
    "/api/characters",
    "/api/events",
    "/api/rolls",
    "/api/messages",
    "/health",
  ]) {
    assert.equal(cacheablePath(origin + path, origin), null, path);
  }
});

test("OAuth and e-mail tokens are never cached, including tokens on the static shell", () => {
  for (const path of [
    "/signin-google",
    "/signin-discord?code=temporary-secret&state=nonce",
    "/api/auth/external/google",
    "/api/auth/external-callback?code=temporary-secret",
    "/?flow=confirm&userId=someone&code=temporary-secret",
    "/?flow=reset&userId=someone&code=temporary-secret",
    "/index.html?flow=reset&code=temporary-secret",
    "/styles.css?code=temporary-secret",
  ]) {
    assert.equal(cacheablePath(origin + path, origin), null, path);
  }
});

test("mutating requests are never cached, even when their path names a static asset", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    assert.equal(cacheablePath(origin + "/styles.css", origin, method), null);
  }
});

test("cross-origin URLs, URL credentials and unrecognized paths stay outside the cache", () => {
  for (const url of [
    "https://attacker.example/styles.css",
    "http://rpg.eternnus.com/styles.css",
    "https://rpg.eternnus.com.attacker.example/styles.css",
    "https://user:password@rpg.eternnus.com/styles.css",
    origin + "/App_Data/keys/key.xml",
    origin + "/private.json",
    origin + "/new-unreviewed-feature.js",
    origin + "/assets/private-player-export.json",
    "not a valid absolute URL",
  ]) {
    assert.equal(cacheablePath(url, origin), null, url);
  }
});

test("the streamed soundtrack stays outside the precache and uses the HTTP cache instead", () => {
  assert.equal(
    cacheablePath(origin + "/assets/audio/the-blade-and-the-serpent.v1.mp3", origin),
    null,
  );
});
