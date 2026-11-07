/** Real PostgreSQL checks. Only the uniquely named test database is disposable. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
  temp = await mkdtemp(join(tmpdir(), "eternnus-integration-"));
const database = "eternnus_test_" + randomUUID().replaceAll("-", ""),
  container = process.env.ETERNNUS_TEST_CONTAINER || "eternnus-postgres-dev",
  origin = "http://127.0.0.1:5191";
let server,
  logs = "",
  assertions = 0,
  created = false;
const check = (a, b, m) => {
  assert.deepEqual(a, b, m);
  assertions++;
};
const docker = (...args) =>
  execFileSync("docker", ["exec", container, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
const sql = (command) =>
  docker(
    "psql",
    "-U",
    "eternnus",
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    command,
  ).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  const jar = new Map();
  let token = "";
  const call = async (
    path,
    method = "GET",
    body,
    expected = 200,
    options = {},
  ) => {
    const headers = {
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.appHeader === false ? {} : { "X-Eternnus": "1" }),
    };
    if (jar.size && !options.noCookies)
      headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (method !== "GET" && options.csrf !== false)
      headers["X-CSRF-TOKEN"] = options.token ?? token;
    const response = await fetch(origin + path, {
      method,
      headers,
      redirect: options.redirect || "follow",
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0],
        sep = first.indexOf("="),
        key = first.slice(0, sep),
        value = first.slice(sep + 1);
      if (value) jar.set(key, value);
      else jar.delete(key);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (expected !== null)
      check(response.status, expected, `${method} ${path}: ${text}`);
    return options.raw
      ? { status: response.status, headers: response.headers, data }
      : data;
  };
  call.renew = async () => {
    token = (await call("/api/auth/csrf")).token;
    return token;
  };
  return call;
}
async function mailLink(flow, userId) {
  for (let i = 0; i < 80; i++) {
    const files = await readdir(join(temp, "mail")).catch(() => []);
    for (const file of files) {
      const text = execFileSync(
        "python",
        [
          "-c",
          "from email import policy; from email.parser import BytesParser; import sys; m=BytesParser(policy=policy.default).parsebytes(open(sys.argv[1],'rb').read()); print(m.get_content())",
          join(temp, "mail", file),
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        },
      );
      const link = text.match(/https?:\/\/[^\s<>]+/g)?.find((l) => {
        const p = new URL(l).searchParams;
        return p.get("flow") === flow && p.get("userId") === userId;
      });
      if (link) return new URL(link);
    }
    await wait(150);
  }
  throw new Error(
    `Missing ${flow} email. files=${JSON.stringify(await readdir(join(temp, "mail")).catch(() => []))}; outbox=${sql('SELECT "SentAt", "Attempts" FROM "MailDeliveries"')}; uid=${userId}\n${logs.slice(-6000)}`,
  );
}
const password = "Local-test!42";
async function register(c, email, name) {
  await c.renew();
  const u = await c("/api/auth/register", "POST", {
    email,
    name,
    password,
    confirmPassword: password,
  });
  await c.renew();
  return u;
}
async function confirm(c, u) {
  const input = Object.fromEntries(
    (await mailLink("confirm", u.id)).searchParams,
  );
  await c("/api/auth/confirm", "POST", input);
  await c.renew();
  return input;
}
try {
  assert.match(database, /^eternnus_test_[a-f0-9]{32}$/);
  docker("createdb", "-U", "eternnus", database);
  created = true;
  server = spawn(
    "dotnet",
    [
      join(root, "apps/Eternnus.Web/bin/Debug/net10.0/Eternnus.Web.dll"),
      "--urls",
      origin,
    ],
    {
      cwd: join(root, "apps/Eternnus.Web"),
      windowsHide: true,
      env: {
        ...process.env,
        DOTNET_ENVIRONMENT: "Development",
        ASPNETCORE_ENVIRONMENT: "Development",
        ConnectionStrings__Eternnus: `Host=localhost;Port=54329;Database=${database};Username=eternnus;Password=local-development-only`,
        Database__Provider: "Postgres",
        Database__Migrate: "true",
        PublicUrl: origin,
        Mail__Mode: "Pickup",
        Mail__PickupDirectory: join(temp, "mail"),
        DataProtection__Directory: join(temp, "keys"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (x) => (logs += x));
  server.stderr.on("data", (x) => (logs += x));
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      ready = (await fetch(origin + "/health")).ok;
    } catch {}
    if (ready || server.exitCode !== null) break;
    await wait(200);
  }
  assert.ok(ready, "Server failed:\n" + logs);
  const anonymous = client(),
    owner = client(),
    player = client(),
    outsider = client();
  await anonymous("/api/campaigns", "GET", undefined, 401);
  await anonymous("/api/auth/register", "POST", {}, 400, { csrf: false });
  const stolen = await anonymous.renew();
  await anonymous("/api/auth/register", "POST", {}, 400, {
    token: stolen,
    noCookies: true,
  });
  await anonymous("/api/auth/register", "POST", {}, 400, { appHeader: false });
  const headers = await anonymous(
    "/api/auth/providers",
    "GET",
    undefined,
    200,
    { raw: true },
  );
  check(headers.headers.get("cache-control"), "no-store");
  check(headers.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    headers.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assertions++;
  check(headers.data, { google: false, discord: false });
  await anonymous(
    "/api/auth/register",
    "POST",
    {
      name: "Invalid",
      email: "bad-address",
      password,
      confirmPassword: password,
    },
    400,
  );
  await anonymous(
    "/api/auth/register",
    "POST",
    {
      name: "Mismatch",
      email: "mismatch@example.test",
      password,
      confirmPassword: "another",
    },
    400,
  );
  const u = await register(
    owner,
    "master@example.test",
    "Mestre <script>alert(1)</script>",
  );
  check(u.verified, false);
  check(u.avatarUrl, "/assets/avatar.svg");
  await anonymous("/api/auth/profile", "PUT", { name: "Not allowed" }, 401);
  await owner("/api/auth/profile", "PUT", { name: " " }, 400);
  await owner("/api/auth/profile", "PUT", { name: "No CSRF" }, 400, { csrf: false });
  const renamed = await owner("/api/auth/profile", "PUT", { name: "Mestre atualizado", ownerId: "untrusted", verified: true });
  check(renamed.name, "Mestre atualizado");
  check(renamed.verified, false);
  check(renamed.id, u.id);
  const imageUpload = () => {
    const form = new FormData(); form.append("avatar", new Blob([imageBytes], { type: "image/png" }), "avatar.png"); return form;
  };
  const imageBytes = await readFile(join(root, "tests/fixtures/avatar.png"));
  await owner("/api/auth/avatar", "POST", imageUpload(), 403);
  check((await owner("/api/auth/avatar-policy")).available, false);
  await owner("/api/campaigns", "GET", undefined, 403);
  await owner("/api/characters", "GET", undefined, 403);
  await owner("/api/rolls", "POST", { formula: "1d20" }, 403);
  await owner(
    "/api/campaigns",
    "POST",
    { name: "Bloqueada", system: "Livre", description: "" },
    403,
  );
  await owner("/api/auth/logout", "POST", undefined, 204);
  await owner.renew();
  await owner("/api/auth/login", "POST", { email: u.email, password });
  await owner.renew();
  await owner("/api/campaigns", "GET", undefined, 403);
  const confirmation = await confirm(owner, u);
  check((await owner("/api/auth/me")).verified, true);
  await owner("/api/auth/avatar", "POST", imageUpload(), 400, { csrf: false });
  await owner("/api/auth/avatar", "POST", imageUpload(), 503);
  check((await owner("/api/auth/me")).avatarUrl, "/assets/avatar.svg");
  check(sql('SELECT count(*) FROM "Avatars"'), "0");
  await owner("/api/auth/avatar/00000000-0000-0000-0000-000000000001", "GET", undefined, 404);
  await owner("/api/auth/confirm", "POST", confirmation, 400);
  await owner(
    "/api/campaigns",
    "POST",
    { name: "NoCSRF", system: "Livre", description: "" },
    400,
    { token: stolen },
  );
  check(sql('SELECT count(*) FROM "Campaigns"'), "0");
  const sheet = {
    name: "Kael",
    archetype: "Guardião",
    level: 1,
    hp: 12,
    maxHp: 12,
    strength: 14,
    agility: 10,
    intellect: 9,
    notes: "Uma história",
    revision: 0,
  };
  const character = await owner("/api/characters", "POST", sheet);
  check(
    (
      await owner("/api/characters/" + character.id, "PUT", {
        ...sheet,
        level: 2,
        revision: 1,
      })
    ).revision,
    2,
  );
  await owner(
    "/api/characters/" + character.id,
    "PUT",
    { ...sheet, revision: 1 },
    409,
  );
  const history = await owner("/api/characters/" + character.id + "/history");
  check(history.length, 2);
  check(JSON.parse(history[1].snapshot).Level, 1);
  await owner("/api/characters", "POST", { ...sheet, hp: 100 }, 400);
  await owner(
    "/api/campaigns",
    "POST",
    { name: "", system: "Livre", description: "" },
    400,
  );
  await owner(
    "/api/campaigns",
    "POST",
    { name: "Oversized", system: "Livre", description: "x".repeat(70000) },
    413,
  );
  const campaign = await owner("/api/campaigns", "POST", {
      name: "As cinzas de Eldrath",
      system: "Sistema livre",
      description: "Uma campanha de teste",
    }),
    path = "/api/campaigns/" + campaign.id,
    detail = await owner(path);
  assert.ok(detail.inviteCode);
  assertions++;
  let listing = await owner("/api/campaigns");
  check(listing.total, 1);
  check(listing.items[0].canDelete, true);
  check(listing.items[0].playerCount, 0);
  const first = listing.items[0];
  await owner(
    path,
    "PUT",
    {
      name: "As cinzas de Eldrath — II",
      system: "Sistema livre",
      description: "Atualizada",
      revision: first.revision,
    },
    204,
  );
  await owner(
    path,
    "PUT",
    {
      name: "Conflito",
      system: "Sistema livre",
      description: "",
      revision: first.revision,
    },
    409,
  );
  await owner(path + "/leave", "POST", undefined, 409);
  await owner(path + "/characters/" + character.id, "POST");
  await owner(path + "/resources", "POST", {
    name: "Traidor",
    kind: "npc",
    content: "Segredo",
    shared: false,
  });
  await owner(path + "/resources", "POST", {
    name: "Taverna",
    kind: "nota",
    content: "Ponto de encontro",
    shared: true,
  });
  await owner(
    path + "/resources",
    "POST",
    {
      name: "Inseguro",
      kind: "mapa",
      content: "javascript:alert(1)",
      shared: true,
    },
    400,
  );
  const p = await register(player, "player@example.test", "Jogador");
  await confirm(player, p);
  const o = await register(outsider, "outsider@example.test", "Viajante");
  await confirm(outsider, o);
  check((await player("/api/characters")).length, 0);
  await player(
    "/api/characters/" + character.id,
    "PUT",
    { ...sheet, revision: 2 },
    404,
  );
  await player(
    "/api/characters/" + character.id + "/history",
    "GET",
    undefined,
    404,
  );
  await player(path, "GET", undefined, 404);
  await player(path, "DELETE", undefined, 404);
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  await player("/api/campaigns/join", "POST", { code: detail.inviteCode });
  const visible = await player(path);
  check(visible.inviteCode, null);
  check(visible.resources.length, 1);
  check(visible.characters.length, 1);
  check(visible.members.length, 1);
  const playerCampaign = (await player("/api/campaigns")).items[0];
  check(playerCampaign.isMaster, false);
  check(playerCampaign.canDelete, false);
  listing = await owner("/api/campaigns");
  check(listing.items[0].canDelete, false);
  check(listing.items[0].playerCount, 1);
  await owner(path, "DELETE", undefined, 409);
  await player(
    path,
    "PUT",
    {
      name: "Takeover",
      system: "Sistema livre",
      description: "",
      revision: listing.items[0].revision,
    },
    404,
  );
  await player(
    path + "/resources",
    "POST",
    { name: "No", kind: "npc", content: "", shared: false },
    404,
  );
  await player(path + "/characters/" + character.id, "POST", undefined, 404);
  await player(
    path + "/sessions",
    "POST",
    { title: "No", objective: "", mapKind: "tileset", mapKey: "crypt" },
    403,
  );
  await outsider(path + "/leave", "POST", undefined, 404);
  const live = await owner(path + "/sessions", "POST", {
    title: "O primeiro encontro",
    objective: "Tragam dados.",
    mapKind: "tileset",
    mapKey: "crypt",
  });
  check(live.number, 1);
  check((await player(path)).activeSession.id, live.id);
  check((await player(path)).sessionCount, null);
  const roll = await player("/api/rolls", "POST", {
    formula: "4d6+3",
    campaignId: campaign.id,
  });
  check(
    roll.total,
    roll.values.reduce((a, b) => a + b, 3),
  );
  assert.ok(roll.values.every((n) => n >= 1 && n <= 6));
  assertions++;
  await player(
    "/api/rolls",
    "POST",
    { formula: "1d1", campaignId: campaign.id },
    400,
  );
  await player(
    "/api/rolls",
    "POST",
    { formula: "101d6", campaignId: campaign.id },
    400,
  );
  await player(
    "/api/rolls",
    "POST",
    { formula: "eval(1)", campaignId: campaign.id },
    400,
  );
  await player("/api/messages", "POST", {
    campaignId: campaign.id,
    content: "Cheguei à taverna.",
  });
  check((await owner("/api/events?campaignId=" + campaign.id)).length, 2);
  check((await owner("/api/events")).length, 0);
  await outsider(
    "/api/events?campaignId=" + campaign.id,
    "GET",
    undefined,
    404,
  );
  await player(path + "/leave", "POST", undefined, 204);
  await player("/api/events?campaignId=" + campaign.id, "GET", undefined, 404);
  await player(
    "/api/messages",
    "POST",
    { campaignId: campaign.id, content: "Sem acesso" },
    404,
  );
  check((await owner("/api/campaigns")).items[0].canDelete, true);
  await owner(path, "DELETE", undefined, 204);
  await owner(path, "GET", undefined, 404);
  check(
    sql('SELECT count(*) FROM "Events" WHERE "CampaignId" IS NOT NULL'),
    "0",
  );
  check((await owner("/api/characters")).length, 1);
  for (let i = 0; i < 3; i++) {
    const race = await owner("/api/campaigns", "POST", {
        name: "Concorrência " + i,
        system: "Sistema livre",
        description: "",
      }),
      d = await owner("/api/campaigns/" + race.id);
    const [deletion, joining] = await Promise.all([
      owner("/api/campaigns/" + race.id, "DELETE", undefined, null, {
        raw: true,
      }),
      player("/api/campaigns/join", "POST", { code: d.inviteCode }, null, {
        raw: true,
      }),
    ]);
    assert.ok(
      (deletion.status === 204 && joining.status === 404) ||
        (deletion.status === 409 && joining.status === 200),
      `Unsafe delete/join: ${deletion.status}/${joining.status}`,
    );
    assertions++;
    check(
      sql(
        'SELECT count(*) FROM "Members" m LEFT JOIN "Campaigns" c ON c."Id"=m."CampaignId" WHERE c."Id" IS NULL',
      ),
      "0",
    );
    if (joining.status === 200) {
      await player(
        "/api/campaigns/" + race.id + "/leave",
        "POST",
        undefined,
        204,
      );
      await owner("/api/campaigns/" + race.id, "DELETE", undefined, 204);
    }
  }
  // Paginação usa embaixador: níveis não ampliam a quota comum de três campanhas.
  sql(`UPDATE "AspNetUsers" SET "Role" = 'ambassador' WHERE "Id" = '${u.id}'`);
  for (let i = 0; i < 21; i++)
    await owner("/api/campaigns", "POST", {
      name: "Página " + String(i).padStart(2, "0"),
      system: "Sistema livre",
      description: "",
    });
  const pageOne = await owner("/api/campaigns?sort=name&page=1"),
    pageTwo = await owner("/api/campaigns?sort=name&page=2");
  check(pageOne.total, 21);
  check(pageOne.items.length, 20);
  check(pageTwo.items.length, 1);
  check(pageTwo.items[0].name, "Página 20");
  check(
    (await owner("/api/campaigns?search=" + encodeURIComponent("Página 05")))
      .total,
    1,
  );
  check((await player("/api/campaigns")).total, 0);
  sql(`UPDATE "AspNetUsers" SET "LastEmailAt"=NULL WHERE "Id"='${p.id}'`);
  const known = await anonymous("/api/auth/forgot-password", "POST", {
      email: p.email,
    }),
    unknown = await anonymous("/api/auth/forgot-password", "POST", {
      email: "unknown@example.test",
    });
  check(known, unknown);
  const reset = Object.fromEntries(
    (await mailLink("reset", p.id)).searchParams,
  );
  await player("/api/auth/logout", "POST", undefined, 204);
  await player.renew();
  await player("/api/auth/login", "POST", { email: p.email, password });
  await player.renew();
  const newPassword = "A-new-password!52";
  await anonymous(
    "/api/auth/reset-password",
    "POST",
    { ...reset, password: newPassword, confirmPassword: "different" },
    400,
  );
  await anonymous(
    "/api/auth/reset-password",
    "POST",
    {
      ...reset,
      code: "not-a-valid-token",
      password: newPassword,
      confirmPassword: newPassword,
    },
    400,
  );
  await anonymous("/api/auth/reset-password", "POST", {
    ...reset,
    password: newPassword,
    confirmPassword: newPassword,
  });
  await player("/api/auth/me", "GET", undefined, 401);
  await anonymous(
    "/api/auth/reset-password",
    "POST",
    { ...reset, password: newPassword, confirmPassword: newPassword },
    400,
  );
  await player.renew();
  await player("/api/auth/login", "POST", { email: p.email, password }, 401);
  await player("/api/auth/login", "POST", {
    email: p.email,
    password: newPassword,
  });
  await player.renew();
  check((await player("/api/auth/me")).verified, true);
  await player("/api/auth/logout", "POST", undefined, 204);
  await player.renew();
  await player("/api/campaigns", "GET", undefined, 401);
  await outsider("/api/auth/logout", "POST", undefined, 204);
  await outsider.renew();
  for (let i = 0; i < 5; i++)
    await outsider(
      "/api/auth/login",
      "POST",
      { email: o.email, password: "Definitely-wrong!52" },
      401,
    );
  await outsider("/api/auth/login", "POST", { email: o.email, password }, 401); // Correct password cannot bypass temporary lockout.
  let throttled = false;
  for (let i = 0; i < 35; i++) {
    const r = await anonymous(
      "/api/auth/login",
      "POST",
      { email: "nonexistent@example.test", password },
      null,
      { raw: true },
    );
    if (r.status === 429) {
      throttled = true;
      break;
    }
    check(r.status, 401);
  }
  check(
    throttled,
    true,
    "The authentication endpoint must eventually throttle repeated attempts.",
  );
  console.log(
    `PASS: ${assertions} real PostgreSQL integration assertions. Auth/CSRF, confirmation, recovery, permissions, campaigns, concurrent deletion, pagination, sheets and table verified.`,
  );
} catch (error) {
  console.error(logs.slice(-6000));
  throw error;
} finally {
  if (server) {
    server.kill();
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
  }
  if (created && /^eternnus_test_[a-f0-9]{32}$/.test(database))
    docker("dropdb", "-U", "eternnus", "--force", database);
  await rm(temp, { recursive: true, force: true });
}
