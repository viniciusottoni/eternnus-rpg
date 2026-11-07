import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/policy.js", import.meta.url),
  "utf8",
);
const { OPENING_DURATION, openingDeadline, canAccess, campaignActions } =
  await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );

test("the opening clock has a fixed 3000 ms deadline and never becomes negative", () => {
  assert.equal(OPENING_DURATION, 3000);
  assert.equal(openingDeadline(100, 100), 3000);
  assert.equal(openingDeadline(100, 1099), 2001);
  assert.equal(openingDeadline(100, 3100), 0);
  assert.equal(openingDeadline(100, 9000), 0);
});
test("anonymous users cannot access application routes", () => {
  for (const route of [
    "overview",
    "campaigns",
    "characters",
    "dice",
    "settings",
  ])
    assert.equal(canAccess(null, route), false);
});
test("pending local accounts can view the welcome dashboard and edit their profile", () => {
  const user = { verified: false };
  assert.equal(canAccess(user, "overview"), true);
  assert.equal(canAccess(user, "settings"), true);
  for (const route of ["campaigns", "characters", "dice"])
    assert.equal(canAccess(user, route), false);
});
test("confirmed local and verified SSO accounts share the same route policy", () => {
  for (const user of [
    { verified: true },
    { verified: true, provider: "Google" },
    { verified: true, provider: "Discord" },
  ])
    for (const route of [
      "overview",
      "campaigns",
      "characters",
      "dice",
      "settings",
    ])
      assert.equal(canAccess(user, route), true);
});
test("only a creator without participants sees an enabled deletion action", () => {
  assert.deepEqual(campaignActions({ isMaster: true, canDelete: true }), {
    edit: true,
    delete: true,
    leave: false,
  });
  assert.deepEqual(campaignActions({ isMaster: true, canDelete: false }), {
    edit: true,
    delete: false,
    leave: false,
  });
  assert.deepEqual(campaignActions({ isMaster: false, canDelete: true }), {
    edit: false,
    delete: false,
    leave: true,
  });
});
