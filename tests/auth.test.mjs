import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeReturnRoute } from "../apps/Eternnus.Web/wwwroot/js/policy.js";

const source = (await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/api.js", import.meta.url), "utf8"))
  .replace('import { withLoading } from "./loading.js";', 'const withLoading = (task) => task();');
let version = 0;
async function fixture(respond) {
  const calls = [], window = new EventTarget();
  let expired = 0;
  window.addEventListener("session-expired", () => expired++);
  globalThis.window = window;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    const [status, data] = respond(url, options);
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  };
  const module = await import("data:text/javascript;base64," + Buffer.from(source + "\n//" + version++).toString("base64"));
  return { ...module, calls, expired: () => expired };
}

test("return route accepts internal destinations and discards URLs, tokens and untrusted segments", () => {
  for (const route of ["settings", "campaigns", "table/123e4567-e89b-12d3-a456-426614174000", "guild/topic/id", "character/new"])
    assert.equal(safeReturnRoute(route), route);
  for (const route of [null, "login", "//evil.test", "https://evil.test", "javascript:alert(1)", "settings?token=secret", "guild/../settings", "guild/%22", "guild/", "a".repeat(300)])
    assert.equal(safeReturnRoute(route), "overview");
});

test("password and MFA failures keep the challenge, while a protected 401 expires the session", async () => {
  const f = await fixture((url) => url.endsWith("/csrf") ? [200, { token: "csrf" }] : [401, { message: "Acesso recusado." }]);
  for (const path of ["/auth/login", "/auth/two-factor/verify", "/auth/two-factor/setup"])
    await assert.rejects(f.api(path, "POST", {}), { status: 401 });
  assert.equal(f.expired(), 0);
  await assert.rejects(f.api("/campaigns"), { status: 401 });
  assert.equal(f.expired(), 1);
});

test("expired CSRF probes identity and never replays the interrupted write", async () => {
  const f = await fixture((url) => url.endsWith("/csrf") ? [200, { token: "csrf" }]
    : url.endsWith("/me") ? [401, {}] : [400, { code: "csrf_expired" }]);
  await assert.rejects(f.api("/campaigns", "POST", { name: "Mesa" }), { status: 401 });
  assert.equal(f.expired(), 1);
  assert.deepEqual(f.calls.map(c => c.url), ["/api/auth/csrf", "/api/campaigns", "/api/auth/me"]);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  await assert.rejects(f.api("/campaigns", "POST", {}));
  assert.equal(f.calls.filter(c => c.url === "/api/auth/csrf").length, 2, "CSRF antigo foi descartado");
});

test("stale form token with a valid login remains a form error without replay or logout", async () => {
  const f = await fixture((url) => url.endsWith("/csrf") ? [200, { token: "csrf" }]
    : url.endsWith("/me") ? [200, { id: "hero" }] : [400, { code: "csrf_expired", message: "Recarregue." }]);
  await assert.rejects(f.api("/campaigns", "POST", {}), { status: 400, message: "Recarregue." });
  assert.equal(f.expired(), 0);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});
