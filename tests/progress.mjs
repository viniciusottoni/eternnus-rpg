/**
 * Integração da progressão com PostgreSQL real (porta 5208): XP de ficha uma única vez e com limite diário,
 * XP de sessão encerrada (duração mínima), endpoints públicos sem e-mail, ranking geral/semanal,
 * bônus e recálculo somente para admin e auditados.
 */
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5208 });
const { check, ok, sql } = env;
const q = (value) => String(value).replaceAll("'", "''");
try {
  const ana = await env.verifiedClient("ana.progress@example.test", "Ana");
  const bruno = await env.verifiedClient("bruno.progress@example.test", "Bruno");
  const chief = await env.verifiedClient("chefe.progress@example.test", "Chefe");
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='chefe.progress@example.test'`);
  await env.authenticateMfa(chief, "chefe.progress@example.test");
  const anaId = (await ana("/api/auth/me")).id;
  const brunoId = (await bruno("/api/auth/me")).id;
  const anonymous = env.client();
  await anonymous("/api/progress/me", "GET", undefined, 401);

  // ---------- Estado inicial ----------
  let me = await ana("/api/progress/me");
  check([me.xp, me.level, me.levelXp, me.nextLevelXp, me.percent], [0, 1, 0, 100, 0], "initial progress");
  ok(me.achievements.length >= 12 && me.achievements.every((a) => !a.unlocked && a.title && a.icon && a.description), "achievement catalog, all locked");
  check(me.history, [], "no history yet");
  const characterRule = me.rules.find((r) => r.reason === "character_created");
  check([characterRule.amount, characterRule.dailyLimit, characterRule.today], [10, 3, 0], "character rule");
  check(me.rules.find((r) => r.reason === "staff_bonus").amount, null, "staff bonus is variable");
  const rulesUnlock = me.unlocks.find((u) => u.key === "guild_category:regras-e-sistemas");
  check([rulesUnlock?.level, rulesUnlock?.unlocked], [2, false], "guild category unlock read from the database");
  ok(!me.unlocks.some((u) => u.key === "extra_campaigns"), "limites de campanha dependem do papel, nunca do nível");

  // ---------- Personagem criado: XP uma vez por ficha, limite de 3 por dia ----------
  const sheet = (name) => ({ name, archetype: "Guerreira", level: 1, hp: 10, maxHp: 10, strength: 12, agility: 12, intellect: 10, notes: "", revision: 0 });
  const first = await ana("/api/characters", "POST", sheet("Lyra"));
  check(sql(`SELECT count(*) FROM "XpEntries" WHERE "SourceKey"='character_created:${first.id}'`), "1", "one entry for the character");
  await ana("/api/characters/" + first.id, "PUT", { ...sheet("Lyra, a Forte"), revision: first.revision });
  me = await ana("/api/progress/me");
  check([me.xp, me.history.length, me.history[0].label, me.history[0].amount], [10, 1, "Personagem criado", 10], "editing does not award again");
  ok(me.achievements.find((a) => a.key === "first_character").unlocked && me.achievements.find((a) => a.key === "first_character").unlockedAt, "first character achievement");
  for (const name of ["Brann", "Cael", "Dara"]) await ana("/api/characters", "POST", sheet(name));
  me = await ana("/api/progress/me");
  check(me.xp, 30, "daily limit stops the fourth character");
  check(me.rules.find((r) => r.reason === "character_created").today, 3, "today usage");
  check(sql(`SELECT count(*) FROM "Characters" WHERE "OwnerId"='${q(anaId)}'`), "4", "the character itself is still created");
  check(sql(`SELECT count(*) FROM "Achievements" WHERE "UserId"='${q(anaId)}' AND "Key"='first_character'`), "1", "achievement unlocked once");
  check((await ana("/api/auth/me")).xp, 30, "profile reflects xp");

  // ---------- Sessão: XP somente com duração mínima ----------
  const campaign = await chief("/api/campaigns", "POST", { name: "Valdaran", system: "Sistema livre", description: "" });
  const { inviteCode } = await chief("/api/campaigns/" + campaign.id);
  await ana("/api/campaigns/join", "POST", { code: inviteCode });
  await ana(`/api/campaigns/${campaign.id}/characters/${first.id}`, "POST");
  const short = await chief(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Curta", objective: "", mapKind: "tileset", mapKey: "crypt" });
  await chief(`/api/sessions/${short.id}/join`, "POST", {}, 204);
  await ana(`/api/sessions/${short.id}/join`, "POST", { characterId: first.id }, 204);
  await chief(`/api/sessions/${short.id}/end`, "POST", undefined, 204);
  check(sql(`SELECT count(*) FROM "XpEntries" WHERE "SourceKey" LIKE 'session_%:${short.id}%'`), "0", "short session grants nothing");
  const long = await chief(`/api/campaigns/${campaign.id}/sessions`, "POST", { title: "Longa", objective: "", mapKind: "tileset", mapKey: "crypt" });
  await chief(`/api/sessions/${long.id}/join`, "POST", {}, 204);
  await ana(`/api/sessions/${long.id}/join`, "POST", { characterId: first.id }, 204);
  sql(`UPDATE "Sessions" SET "StartedAt" = now() - interval '45 minutes' WHERE "Id"='${long.id}'`);
  await chief(`/api/sessions/${long.id}/end`, "POST", undefined, 204);
  check(sql(`SELECT "Amount" FROM "XpEntries" WHERE "SourceKey"='session_played:${long.id}:${q(anaId)}'`), "30", "player xp");
  check(sql(`SELECT "Amount" FROM "XpEntries" WHERE "SourceKey"='session_mastered:${long.id}'`), "50", "master xp");
  me = await ana("/api/progress/me");
  check([me.xp, me.history[0].label], [75, "Sessão jogada"], "session xp in history");
  ok(me.achievements.find((a) => a.key === "first_session").unlocked, "first session achievement");

  // ---------- Perfil público: sem e-mail, sem contas não verificadas ----------
  const card = await bruno("/api/progress/users/" + encodeURIComponent(anaId));
  check(Object.keys(card).sort(), ["achievements", "avatarUrl", "id", "level", "name", "role", "xp"], "public contract");
  check([card.name, card.xp, card.level, card.role], ["Ana", 75, 1, "common"], "public card values");
  check(Object.keys(card.achievements[0]).sort(), ["icon", "key", "title"], "public achievement fields");
  ok(!JSON.stringify(card).includes("@"), "no e-mail in public profile");
  await bruno("/api/progress/users/nao-existe", "GET", undefined, 404);
  const pending = env.client();
  const pendingUser = await env.register(pending, "pendente.progress@example.test", "Pendente");
  sql(`UPDATE "AspNetUsers" SET "Xp"=99999, "Level"=44 WHERE "Id"='${q(pendingUser.id)}'`);
  sql(`INSERT INTO "XpEntries" ("UserId","Reason","Amount","SourceKey","CreatedAt") VALUES ('${q(pendingUser.id)}','staff_bonus',99999,'staff_bonus:pending',now())`);
  await bruno("/api/progress/users/" + encodeURIComponent(pendingUser.id), "GET", undefined, 404);
  await pending("/api/progress/me", "GET", undefined, 403);

  // ---------- Ranking ----------
  await bruno("/api/characters", "POST", sheet("Rurik"));
  sql(`INSERT INTO "XpEntries" ("UserId","Reason","Amount","SourceKey","CreatedAt") VALUES ('${q(brunoId)}','staff_bonus',500,'staff_bonus:old',now() - interval '10 days')`);
  sql(`UPDATE "AspNetUsers" SET "Xp"="Xp"+500, "Level"=3 WHERE "Id"='${q(brunoId)}'`);
  const all = await ana("/api/progress/leaderboard");
  check(all.period, "all", "default period");
  check(all.items.map((r) => r.name), ["Bruno", "Ana", "Chefe"], "all-time order, unverified excluded");
  check(all.items.map((r) => r.xp), [510, 75, 70], "all-time xp");
  check([all.items[1].rank, all.items[1].isMe, all.items[0].isMe], [2, true, false], "rank and me flag");
  ok(!JSON.stringify(all).includes("@"), "no e-mail in leaderboard");
  const week = await ana("/api/progress/leaderboard?period=week");
  check(week.items.map((r) => [r.name, r.xp]), [["Ana", 75], ["Chefe", 70], ["Bruno", 10]], "weekly sums the last 7 days");
  check((await ana("/api/progress/leaderboard?period=<x>")).period, "all", "unknown period falls back");

  // ---------- Admin: bônus e recálculo ----------
  const bonus = `/api/progress/admin/${encodeURIComponent(anaId)}/bonus`;
  await bruno(bonus, "POST", { amount: 100, reason: "Tentativa indevida" }, 403);
  await ana(bonus, "POST", { amount: 100, reason: "Tentativa indevida" }, 403);
  await chief(bonus, "POST", { amount: 0, reason: "Motivo válido" }, 400);
  await chief(bonus, "POST", { amount: 501, reason: "Motivo válido" }, 400);
  await chief(bonus, "POST", { amount: -501, reason: "Motivo válido" }, 400);
  await chief(bonus, "POST", { amount: 50, reason: "curt" }, 400);
  await chief(bonus, "POST", { amount: 50, reason: "x".repeat(201) }, 400);
  await chief("/api/progress/admin/nao-existe/bonus", "POST", { amount: 50, reason: "Usuário inexistente" }, 404);
  await chief(bonus, "POST", { amount: 50, reason: "Sem CSRF" }, 400, { csrf: false });
  const granted = await chief(bonus, "POST", { amount: 250, reason: "Organizou o evento de inverno" });
  check([granted.applied, granted.xp, granted.level], [250, 325, 3], "bonus applied");
  me = await ana("/api/progress/me");
  check([me.history[0].label, me.history[0].amount], ["Bônus da equipe", 250], "bonus in history");
  ok(me.unlocks.find((u) => u.key === "guild_category:regras-e-sistemas").unlocked, "unlocks follow the level");
  const removed = await chief(bonus, "POST", { amount: -500, reason: "Correção de lançamento duplicado" });
  check([removed.applied, removed.xp, removed.level], [-325, 0, 1], "xp never below zero");
  await chief(bonus, "POST", { amount: -10, reason: "Nada para remover" }, 409);
  check(sql(`SELECT count(*) FROM "Audit" WHERE "Action"='progress.bonus' AND "TargetId"='${q(anaId)}'`), "2", "bonus audited");
  check(sql(`SELECT sum("Amount") FROM "XpEntries" WHERE "UserId"='${q(anaId)}'`), "0", "entries sum matches");

  const recalc = `/api/progress/admin/${encodeURIComponent(brunoId)}/recalculate`;
  sql(`UPDATE "AspNetUsers" SET "Xp"=7, "Level"=1 WHERE "Id"='${q(brunoId)}'`);
  await bruno(recalc, "POST", undefined, 403);
  const fixed = await chief(recalc, "POST");
  check([fixed.before, fixed.xp, fixed.level], [7, 510, 3], "recalculate from entries");
  check(sql(`SELECT "Xp" FROM "AspNetUsers" WHERE "Id"='${q(brunoId)}'`), "510", "recalculated xp saved");
  check(sql(`SELECT count(*) FROM "Audit" WHERE "Action"='progress.recalculate' AND "TargetId"='${q(brunoId)}'`), "1", "recalculate audited");
  ok(!sql(`SELECT "Data" FROM "Audit" WHERE "Action" LIKE 'progress.%'`).includes("@"), "audit without e-mail");

  // Categoria da Guilda alterada no banco reflete nos desbloqueios.
  sql(`UPDATE "GuildCategories" SET "MinLevelToPost"=4 WHERE "Slug"='regras-e-sistemas'`);
  check((await ana("/api/progress/me")).unlocks.find((u) => u.key === "guild_category:regras-e-sistemas").level, 4, "category level from database");

  console.log(`PASS: ${env.count()} progression assertions with real PostgreSQL. Character/session XP, daily limit, achievements, public profile, leaderboard and audited admin adjustments verified.`);
} catch (error) {
  console.error(env.logs().slice(-6000));
  throw error;
} finally {
  await env.stop();
}
