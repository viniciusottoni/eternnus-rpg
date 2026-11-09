/** Authenticator, bootstrap privado, quotas e corridas com PostgreSQL real. */
import { startEnvironment, password, totp, wait } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5310, initialAdminPassword: password });
const { check, ok, sql } = env;
const free = "00000000-0000-4000-8000-000000000001";
const campaign = (name) => ({ name, description: "", rpgSystemId: free });
try {
  const admin = env.client();
  await admin.renew();
  const challenge = await admin("/api/auth/login", "POST", { email: "admin@eternnus.com", password });
  check(challenge, { requiresTwoFactor: true, setupRequired: true }, "primeiro admin exige cadastro do autenticador");
  await admin("/api/auth/me", "GET", undefined, 401);
  await admin("/api/admin/overview", "GET", undefined, 401);
  const setup = await admin("/api/auth/two-factor/setup");
  ok(setup.sharedKey?.length >= 16, "chave TOTP privada após senha correta");
  const input = { code: totp(setup.sharedKey) };
  await admin("/api/auth/two-factor/verify", "POST", input, 400, { csrf: false });
  await admin("/api/auth/two-factor/verify", "POST", { code: "invalid" }, 401);
  const activated = await admin("/api/auth/two-factor/verify", "POST", input);
  check(activated.recoveryCodes.length, 10, "códigos de recuperação uma vez");
  await admin.renew();
  check((await admin("/api/auth/me")).twoFactorEnabled, true, "TOTP habilitado no Identity");
  await admin("/api/admin/overview");
  await admin("/api/admin/overview");
  await admin("/api/auth/two-factor/setup", "GET", undefined, 401);
  // amr=mfa deve sobreviver ao refresh de security stamp a cada requisição.
  await admin("/api/auth/logout", "POST", undefined, 204);
  await admin.renew();
  check((await admin("/api/auth/login", "POST", { email: "admin@eternnus.com", password })).setupRequired, false);
  const reusedSetup = await admin("/api/auth/two-factor/setup");
  ok(!("sharedKey" in reusedSetup), "segredo nunca reaparece após habilitar 2FA");
  await admin("/api/auth/two-factor/verify", "POST", { recoveryCode: activated.recoveryCodes[0] });
  await admin.renew();
  await admin("/api/admin/overview");
  const replay = env.client();
  await replay.renew();
  await replay("/api/auth/login", "POST", { email: "admin@eternnus.com", password });
  await replay("/api/auth/two-factor/verify", "POST", { recoveryCode: activated.recoveryCodes[0] }, 401);

  const common = await env.verifiedClient("common.limits@example.test", "Comum");
  const player = await env.verifiedClient("player.limits@example.test", "Jogador");
  const commonId = (await common("/api/auth/me")).id;
  const playerId = (await player("/api/auth/me")).id;
  // Promoção em sessão já aberta elimina acesso sem MFA e pede novo desafio por senha.
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Id"='${playerId}'`);
  await player("/api/auth/me", "GET", undefined, 401);
  await env.authenticateMfa(player, "player.limits@example.test");
  await player("/api/admin/overview");
  await admin(`/api/admin/users/${playerId}/role`, "PUT", { role: "common", reason: "Teste concluído" }, 204);
  await player.renew();

  await common("/api/campaigns", "POST", campaign("Primeira"));
  await common("/api/campaigns", "POST", campaign("Segunda"));
  const invited = await admin("/api/campaigns", "POST", campaign("Convite"));
  const code = (await admin(`/api/campaigns/${invited.id}`)).inviteCode;
  const race = await Promise.all([
    common("/api/campaigns", "POST", campaign("Concorrente"), null, { raw: true }),
    common("/api/campaigns/join", "POST", { code }, null, { raw: true }),
  ]);
  check(race.map((r) => r.status).sort(), [200, 409], "criar e entrar concorrentes respeitam três campanhas");
  check((await common("/api/auth/limits")).activeCampaigns, 3);
  sql(`UPDATE "AspNetUsers" SET "Level"=100,"OneShotParticipations"=9 WHERE "Id"='${commonId}'`);
  await common("/api/campaigns", "POST", { ...campaign("Pela lista"), isOneShot: true }, 400);
  const shots = await Promise.all([
    common("/api/one-shots", "POST", campaign("Livre A"), null, { raw: true }),
    common("/api/one-shots", "POST", campaign("Livre B"), null, { raw: true }),
  ]);
  check(shots.map((r) => r.status).sort(), [200, 409], "duas one-shots concorrentes não excedem quota10");
  const shotId = shots.find((r) => r.status === 200).data.campaignId;
  check(sql(`SELECT count(*) FROM "Sessions" WHERE "CampaignId"='${shotId}' AND "EndedAt" IS NULL`), "1", "one-shot nasce com a sessão única aberta");
  check((await common("/api/campaigns?oneShot=true")).items.map((c) => c.id), [shotId], "lista filtra one-shots");
  check((await common("/api/campaigns?oneShot=false")).items.some((c) => c.isOneShot), false, "lista de campanhas não mostra one-shots");
  await common(`/api/campaigns/${shotId}/sessions`, "POST", { title: "Outra", objective: "", mapKind: "tileset", mapKey: "crypt" }, 409);
  check((await common("/api/auth/limits")).oneShotParticipations, 10);
  await common("/api/campaigns", "POST", campaign("Acima do nível100"), 409);

  const sharedShot = await admin("/api/one-shots", "POST", campaign("Reconexão"));
  const shotCode = (await admin(`/api/campaigns/${sharedShot.campaignId}`)).inviteCode;
  sql(`UPDATE "AspNetUsers" SET "OneShotParticipations"=9 WHERE "Id"='${playerId}'`);
  await player("/api/campaigns/join", "POST", { code: shotCode });
  await player(`/api/campaigns/${sharedShot.campaignId}/leave`, "POST", undefined, 204);
  await player("/api/campaigns/join", "POST", { code: shotCode });
  check((await player("/api/auth/limits")).oneShotParticipations, 10, "reentrada na mesma mesa é idempotente");
  sql(`UPDATE "Campaigns" SET "ExpiresAt"=CURRENT_TIMESTAMP - interval '1 second' WHERE "Id"='${shotId}'`);
  for (let i = 0; i < 60 && sql(`SELECT count(*) FROM "Campaigns" WHERE "Id"='${shotId}'`) !== "0"; i++) await wait(250);
  check(sql(`SELECT count(*) FROM "Campaigns" WHERE "Id"='${shotId}'`), "0", "worker remove conteúdo vencido");
  check((await common("/api/auth/limits")).oneShotParticipations, 10, "exclusão não restitui quota vitalícia");
  console.log(`Account limits + MFA PostgreSQL: ${env.count()} assertions passed.`);
} finally { await env.stop(); }
