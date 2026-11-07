/**
 * Ambiente compartilhado dos testes de integração com PostgreSQL real.
 * Cria um banco exclusivo `eternnus_test_<uuid>`, inicia o assembly Debug em uma porta própria,
 * grava e-mails em pasta temporária e remove somente os recursos que ele mesmo criou.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import assert from "node:assert/strict";

export const password = "Local-test!42";
const root = resolve(import.meta.dirname, "../..");
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replaceAll("=", "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

export async function startEnvironment({ port = 5191, initialAdminPassword = "" } = {}) {
  const temp = await mkdtemp(join(tmpdir(), "eternnus-integration-"));
  const database = "eternnus_test_" + randomUUID().replaceAll("-", ""),
    container = process.env.ETERNNUS_TEST_CONTAINER || "eternnus-postgres-dev",
    origin = `http://127.0.0.1:${port}`;
  let server,
    logs = "",
    assertions = 0,
    created = false;
  const check = (a, b, m) => {
    assert.deepEqual(a, b, m);
    assertions++;
  };
  const ok = (value, message) => {
    assert.ok(value, message);
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
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
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
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
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
    call.cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
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
  async function verifiedClient(email, name) {
    const c = client();
    await confirm(c, await register(c, email, name));
    return c;
  }
  async function authenticateMfa(c, email) {
    await c.renew();
    const result = await c("/api/auth/login", "POST", { email, password });
    check(result.requiresTwoFactor, true, "admin exige desafio de autenticador");
    const setup = await c("/api/auth/two-factor/setup");
    const secret = setup.sharedKey || sql(`SELECT "Value" FROM "AspNetUserTokens" WHERE "Name"='AuthenticatorKey' AND "UserId"=(SELECT "Id" FROM "AspNetUsers" WHERE "Email"='${email}')`);
    await c("/api/auth/two-factor/verify", "POST", { code: totp(secret) });
    await c.renew();
    return secret;
  }
  async function stop() {
    if (server) {
      server.kill();
      await new Promise((r) =>
        server.exitCode !== null ? r() : server.once("exit", r),
      );
    }
    if (created && /^eternnus_test_[a-f0-9]{32}$/.test(database))
      docker("dropdb", "-U", "eternnus", "--force", database);
    await rm(temp, { recursive: true, force: true });
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
          Uploads__AllowUnscanned: "true",
          Platform__InitialAdmin__Password: initialAdminPassword,
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
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    origin,
    client,
    register,
    confirm,
    verifiedClient,
    authenticateMfa,
    mailLink,
    sql,
    check,
    ok,
    stop,
    logs: () => logs,
    count: () => assertions,
    bump: () => assertions++,
  };
}
