import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/policy.js", import.meta.url),
  "utf8",
);
const { OPENING_DURATION, openingDeadline, canAccess, campaignActions, folderTree, folderPath, flattenFolders } =
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
    "one-shot",
    "settings",
  ])
    assert.equal(canAccess(null, route), false);
});
test("pending local accounts can view the welcome dashboard and edit their profile", () => {
  const user = { verified: false };
  assert.equal(canAccess(user, "overview"), true);
  assert.equal(canAccess(user, "settings"), true);
  for (const route of ["campaigns", "characters", "one-shot"])
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
      "one-shot",
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
test("every module that calls guardAvatars imports or defines it", async () => {
  const { readdir } = await import("node:fs/promises");
  const dir = new URL("../apps/Eternnus.Web/wwwroot/js/", import.meta.url);
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".js"))) {
    const code = await readFile(new URL(name, dir), "utf8");
    if (!/\bguardAvatars\s*\(/.test(code)) continue;
    const available =
      /import\s*\{[^}]*\bguardAvatars\b[^}]*\}\s*from/.test(code) ||
      /function\s+guardAvatars\s*\(/.test(code);
    assert.ok(available, `${name} chama guardAvatars sem importá-lo`);
  }
});
test("map folders form a sorted tree, with orphans at the root and cycles cut", () => {
  const folders = [
    { id: "b", name: "Cidade", parentId: "a" },
    { id: "a", name: "Mundo", parentId: null },
    { id: "c", name: "Arena", parentId: "a" },
    { id: "o", name: "Órfã", parentId: "missing" },
    { id: "x", name: "X", parentId: "y" },
    { id: "y", name: "Y", parentId: "x" },
  ];
  const tree = folderTree(folders);
  assert.deepEqual(tree.get("").map((f) => f.id), ["a", "o"]);
  assert.deepEqual(tree.get("a").map((f) => f.name), ["Arena", "Cidade"]);
  assert.deepEqual(folderPath(folders, "b").map((f) => f.name), ["Mundo", "Cidade"]);
  assert.deepEqual(folderPath(folders, ""), []);
  assert.equal(folderPath(folders, "x").length, 2);
  assert.deepEqual(
    flattenFolders(tree).map((f) => [f.name, f.depth]),
    [["Mundo", 0], ["Arena", 1], ["Cidade", 1], ["Órfã", 0]],
  );
});
