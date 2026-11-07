import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const origin = "https://rpg.eternnus.com";
const policySource = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/pwa-policy.js", import.meta.url),
  "utf8",
);
const policyModule =
  "data:text/javascript;base64," + Buffer.from(policySource).toString("base64");
const workerSource = (
  await readFile(
    new URL("../apps/Eternnus.Web/wwwroot/service-worker.js", import.meta.url),
    "utf8",
  )
).replace(/(['"])\.\/js\/pwa-policy\.js\1/g, JSON.stringify(policyModule));
let fixtureNumber = 0;

// Execute the production worker with browser platform boundaries replaced by isolated fakes.
// No application source is duplicated and no real browser or network is controlled by this test.
async function fixture({ offline = false } = {}) {
  const originals = {
    self: globalThis.self,
    caches: globalThis.caches,
    fetch: globalThis.fetch,
    Request: globalThis.Request,
  };
  const listeners = new Map(),
    network = [],
    stored = [],
    matches = [];
  const cache = {
    async match(path) {
      matches.push(path);
      return new Response(
        path === "/offline.html"
          ? "public-offline-notice"
          : "public-static-shell",
      );
    },
    async put(path, response) {
      stored.push({ path, body: await response.text() });
    },
  };
  globalThis.self = {
    location: { origin },
    addEventListener: (type, callback) => listeners.set(type, callback),
    clients: { claim: async () => {} },
  };
  globalThis.caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  };
  globalThis.Request = class extends originals.Request {
    constructor(value, options) {
      super(new URL(value, origin), options);
    }
  };
  globalThis.fetch = async (request) => {
    network.push(request);
    if (offline) throw new TypeError("Test network offline");
    return new Response("public-static-shell", { status: 200 });
  };
  try {
    await import(
      "data:text/javascript;base64," +
        Buffer.from(workerSource).toString("base64") +
        "#fixture-" +
        fixtureNumber++
    );
    return {
      listeners,
      network,
      stored,
      matches,
      cleanup() {
        globalThis.self = originals.self;
        globalThis.caches = originals.caches;
        globalThis.fetch = originals.fetch;
        globalThis.Request = originals.Request;
      },
    };
  } catch (error) {
    globalThis.self = originals.self;
    globalThis.caches = originals.caches;
    globalThis.fetch = originals.fetch;
    globalThis.Request = originals.Request;
    throw error;
  }
}
function fetchEvent(url, method = "GET", mode = "cors") {
  let response;
  return {
    request: { url: new URL(url, origin).href, method, mode },
    respondWith(promise) {
      response = Promise.resolve(promise);
    },
    get response() {
      return response;
    },
  };
}

test("the actual worker never intercepts private APIs, OAuth callbacks or writes", async () => {
  const f = await fixture();
  try {
    for (const [path, method] of [
      ["/api/auth/me", "GET"],
      ["/api/auth/csrf", "GET"],
      ["/api/campaigns", "GET"],
      ["/api/messages", "POST"],
      ["/signin-google?code=secret", "GET"],
      ["/signin-discord?code=secret", "GET"],
      ["/styles.css", "POST"],
      ["https://foreign.example/styles.css", "GET"],
    ]) {
      const event = fetchEvent(path, method);
      f.listeners.get("fetch")(event);
      assert.equal(event.response, undefined, path);
    }
    assert.deepEqual(f.stored, []);
    assert.deepEqual(f.matches, []);
  } finally {
    f.cleanup();
  }
});

test("offline token navigations show only the public connection notice without storing the URL", async () => {
  const f = await fixture({ offline: true });
  try {
    const event = fetchEvent(
      "/?flow=reset&userId=someone&code=secret",
      "GET",
      "navigate",
    );
    f.listeners.get("fetch")(event);
    assert.equal(await (await event.response).text(), "public-offline-notice");
    assert.deepEqual(f.matches, ["/offline.html"]);
    assert.deepEqual(f.stored, []);
  } finally {
    f.cleanup();
  }
});

test("runtime static reads can use the public cache but never populate it from arbitrary responses", async () => {
  const f = await fixture();
  try {
    const event = fetchEvent("/styles.css");
    f.listeners.get("fetch")(event);
    assert.equal(await (await event.response).text(), "public-static-shell");
    const secret = fetchEvent("/styles.css?code=secret");
    f.listeners.get("fetch")(secret);
    assert.equal(secret.response, undefined);
    assert.deepEqual(f.stored, []);
    assert.deepEqual(f.matches, ["/styles.css"]);
  } finally {
    f.cleanup();
  }
});

test("installation fetches the explicit public shell without account credentials", async () => {
  const f = await fixture();
  try {
    let installing;
    f.listeners.get("install")({
      waitUntil(promise) {
        installing = promise;
      },
    });
    await installing;
    assert.ok(f.network.length > 0);
    for (const request of f.network) {
      assert.equal(request.credentials, "omit");
      assert.equal(new URL(request.url).origin, origin);
      assert.equal(new URL(request.url).search, "");
      assert.ok(!new URL(request.url).pathname.startsWith("/api/"));
    }
    assert.equal(f.stored.length, f.network.length);
  } finally {
    f.cleanup();
  }
});
