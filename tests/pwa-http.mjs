/** Inspect the actual PWA responses of an already running local preview. */
import assert from "node:assert/strict";
const origin = process.env.ETERNNUS_PREVIEW_URL || "http://localhost:5180";
let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
const manifestResponse = await fetch(origin + "/manifest.webmanifest");
check(manifestResponse.status, 200);
assert.match(manifestResponse.headers.get("content-type"), /json|manifest/);
assertions++;
const manifest = await manifestResponse.json();
assert.ok(manifest.name && manifest.short_name);
assertions++;
check(manifest.display, "standalone");
const start = new URL(manifest.start_url, origin);
check(start.origin, new URL(origin).origin);
check(
  start.search,
  "",
  "The installed app must not launch with an e-mail or OAuth token.",
);
assert.ok(start.pathname.startsWith(new URL(manifest.scope, origin).pathname));
assertions++;
assert.ok(
  manifest.icons.some((icon) => icon.sizes.split(/\s+/).includes("192x192")),
);
assert.ok(
  manifest.icons.some((icon) => icon.sizes.split(/\s+/).includes("512x512")),
);
assert.ok(
  manifest.icons.some((icon) =>
    icon.purpose?.split(/\s+/).includes("maskable"),
  ),
);
assertions += 3;
for (const icon of manifest.icons) {
  const url = new URL(icon.src, origin);
  check(url.origin, new URL(origin).origin);
  const response = await fetch(url);
  check(response.status, 200, icon.src);
  assert.match(response.headers.get("content-type"), /image\/png/);
  assertions++;
  const bytes = Buffer.from(await response.arrayBuffer());
  check(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const [width, height] = icon.sizes.split("x").map(Number);
  check(bytes.readUInt32BE(16), width);
  check(bytes.readUInt32BE(20), height);
}
const worker = await fetch(origin + "/service-worker.js");
check(worker.status, 200);
assert.match(worker.headers.get("content-type"), /javascript/);
assertions++;
assert.match(worker.headers.get("cache-control"), /no-cache|no-store/);
assertions++;
const account = await fetch(origin + "/api/auth/me");
check(account.status, 401);
assert.match(account.headers.get("cache-control"), /no-store/);
assertions++;
for (const path of ["/?flow=confirm&userId=invalid&code=invalid", "/index.html?flow=reset"]) {
  const response = await fetch(origin + path);
  check(response.status, 200);
  check(response.headers.get("cache-control"), "no-store", "Sensitive-link pages must not be stored by the HTTP cache.");
}
console.log(
  `PASS: ${assertions} PWA HTTP checks. Manifest, local launch, PNG icon sizes, maskable icon, worker delivery and private-response cache directives verified.`,
);
