/** Login persistente e saída global com PostgreSQL real, em banco exclusivo do harness. */
import { startEnvironment, password, totp } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5322, initialAdminPassword: password });
const { check, ok } = env;
const sessionCookie = (response) => response.headers.getSetCookie().find(c => c.startsWith("Eternnus.Session="));
try {
  const first = await env.verifiedClient("login-session@example.test", "Aventureira");
  const unrelated = await env.verifiedClient("other-session@example.test", "Outro jogador");
  await first("/api/auth/logout", "POST", undefined, 204);
  await first.renew();
  const login = await first("/api/auth/login", "POST", { email: "login-session@example.test", password, rememberMe: true }, 200, { raw: true });
  const cookie = sessionCookie(login);
  ok(/httponly/i.test(cookie) && /samesite=lax/i.test(cookie), "cookie persistente preserva proteções");
  const expiration = Date.parse(cookie.match(/expires=([^;]+)/i)[1]);
  ok(Math.abs(expiration - Date.now() - 14 * 86400000) < 10000, "expiração de 14 dias no cookie");
  await first.renew();

  const second = env.client(); await second.renew();
  const ordinary = await second("/api/auth/login", "POST", { email: "login-session@example.test", password }, 200, { raw: true });
  ok(!/expires=/i.test(sessionCookie(ordinary)), "login comum não solicita persistência");
  await second.renew();
  const user = await second("/api/auth/me");
  check(user.email, "login-session@example.test", "outro dispositivo usa a mesma identidade");
  const reopened = await fetch(env.origin + "/api/auth/me", { headers: { Cookie: first.cookieHeader() } });
  check(reopened.status, 200, "cookie persistente é aceito em novo cliente HTTP");
  check((await reopened.json()).id, user.id, "identidade preservada");

  await first("/api/auth/logout-all", "POST", undefined, 400, { csrf: false });
  await second("/api/auth/me");
  await first("/api/auth/logout-all", "POST", undefined, 204);
  await first("/api/auth/me", "GET", undefined, 401);
  await second("/api/auth/me", "GET", undefined, 401);
  await unrelated("/api/auth/me");

  const admin = env.client(); await admin.renew();
  const challenge = await admin("/api/auth/login", "POST", { email: "admin@eternnus.com", password, rememberMe: true });
  check(challenge.requiresTwoFactor, true, "persistência não contorna MFA de administrador");
  await admin("/api/auth/me", "GET", undefined, 401);
  const setup = await admin("/api/auth/two-factor/setup");
  const verified = await admin("/api/auth/two-factor/verify", "POST", { code: totp(setup.sharedKey), rememberMe: true }, 200, { raw: true });
  ok(!/expires=/i.test(sessionCookie(verified)), "administrador nunca recebe persistência longa");
  await admin.renew();
  check((await admin("/api/auth/me")).twoFactorEnabled, true, "MFA habilitado no banco");
  await admin("/api/auth/logout-all", "POST", undefined, 204);
  await admin("/api/auth/me", "GET", undefined, 401);
  console.log(`${env.count()} verificações de login persistente passaram com PostgreSQL real.`);
} finally {
  await env.stop();
}
