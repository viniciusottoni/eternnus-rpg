/**
 * Integração da Guilda com PostgreSQL real (porta 5302): leitura por verificados (401/403 para os demais), categorias
 * semeadas, categoria só da equipe, nível mínimo para abrir tópico (403 com mensagem e liberação após subir o nível),
 * tópicos e respostas, edição pelo autor com revisão (409), "útil" (nunca no próprio post, idempotente), denúncias sem
 * duplicar, fila e ações de moderação só para a equipe (ocultar/restaurar post, trancar/fixar/remover/restaurar tópico)
 * com auditoria, XP concedido uma única vez, paginação, limite "social", nenhum e-mail nas respostas e XSS armazenado
 * devolvido como texto puro.
 */
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5302 });
const { check, ok, sql } = env;
const q = (value) => String(value).replaceAll("'", "''");
const CATEGORY = {
  avisos: "00000000-0000-4000-8000-000000000201",
  taverna: "00000000-0000-4000-8000-000000000202",
  grupo: "00000000-0000-4000-8000-000000000203",
  regras: "00000000-0000-4000-8000-000000000204",
  mestres: "00000000-0000-4000-8000-000000000205",
  fichas: "00000000-0000-4000-8000-000000000206",
};

// Todas as respostas da Guilda e da progressão passam por aqui para a verificação final de e-mails.
const responses = [];
function watch(call) {
  const wrapped = async (path, ...rest) => {
    const result = await call(path, ...rest);
    if (/^\/api\/(guild|progress)\//.test(path)) responses.push(JSON.stringify(result ?? null));
    return result;
  };
  wrapped.renew = call.renew;
  return wrapped;
}
const audit = (actorId) => sql(`SELECT string_agg("Action", ',' ORDER BY "Id") FROM "Audit" WHERE "ActorId"='${q(actorId)}'`);
const xp = (sourceKey) => sql(`SELECT count(*) || ':' || coalesce(sum("Amount"), 0) FROM "XpEntries" WHERE "SourceKey"='${q(sourceKey)}'`);

try {
  const ana = watch(await env.verifiedClient("ana.guild@example.test", "Ana"));
  const bruno = watch(await env.verifiedClient("bruno.guild@example.test", "Bruno"));
  const carla = watch(await env.verifiedClient("carla.guild@example.test", "Carla"));
  const dave = watch(await env.verifiedClient("dave.guild@example.test", "Dave"));
  const mod = watch(await env.verifiedClient("embaixadora.guild@example.test", "Embaixadora"));
  const chief = watch(await env.verifiedClient("chefe.guild@example.test", "Chefe"));
  sql(`UPDATE "AspNetUsers" SET "Role"='ambassador' WHERE "Email"='embaixadora.guild@example.test'`);
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='chefe.guild@example.test'`);
  await env.authenticateMfa(chief, "chefe.guild@example.test");
  const id = async (c) => (await c("/api/auth/me")).id;
  const [anaId, brunoId, carlaId, modId, chiefId] = [await id(ana), await id(bruno), await id(carla), await id(mod), await id(chief)];

  // ---------- Acesso: anônimo 401, e-mail não confirmado 403 ----------
  const anonymous = env.client();
  await anonymous("/api/guild/categories", "GET", undefined, 401);
  await anonymous(`/api/guild/topics?category=taverna`, "GET", undefined, 401);
  const pending = env.client();
  await env.register(pending, "pendente.guild@example.test", "Pendente");
  await pending("/api/guild/categories", "GET", undefined, 403);
  await pending("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: "Olá a todos", body: "Oi" }, 403);
  await pending("/api/guild/moderation/reports", "GET", undefined, 403);

  // ---------- Categorias semeadas ----------
  const categories = await ana("/api/guild/categories");
  check(
    categories.items.map((c) => [c.slug, c.staffOnly, c.minLevelToPost]),
    [
      ["avisos", true, 1],
      ["taverna", false, 1],
      ["procura-se-grupo", false, 1],
      ["regras-e-sistemas", false, 2],
      ["mestres-e-campanhas", false, 2],
      ["fichas-e-biblioteca", false, 1],
    ],
    "seeded categories in order",
  );
  check([categories.viewer.level, categories.viewer.staff, categories.viewer.topicBlockedReason], [1, false, null], "viewer summary");
  check((await mod("/api/guild/categories")).viewer.staff, true, "ambassador is staff");
  check((await ana("/api/guild/topics?category=taverna")).total, 0, "empty tavern");
  await ana("/api/guild/topics?category=nao-existe", "GET", undefined, 404);

  // ---------- Só equipe e nível mínimo ----------
  let error = await ana("/api/guild/topics", "POST", { categoryId: CATEGORY.avisos, title: "Aviso falso", body: "Não sou equipe" }, 403);
  check(error.message, "Somente a equipe da Guilda abre tópicos em Avisos da Guilda.", "staff-only category");
  error = await ana("/api/guild/topics", "POST", { categoryId: CATEGORY.regras, title: "Dúvida de regra", body: "Como funciona?" }, 403);
  check(error.message, "Abrir tópicos em Regras e sistemas exige nível 2. Seu nível atual é 1.", "level gate message");
  let regrasList = await ana("/api/guild/topics?category=regras-e-sistemas");
  check([regrasList.category.canCreateTopic, regrasList.category.requiredLevel], [false, 2], "category reports the gate");
  ok(/nível 2/.test(regrasList.category.blockedReason), "gate reason shown to the client");
  const announcement = await chief("/api/guild/topics", "POST", { categoryId: CATEGORY.avisos, title: "Bem-vindos à Guilda", body: "Regras de convivência." });
  const rulesTopic = await chief("/api/guild/topics", "POST", { categoryId: CATEGORY.regras, title: "Iniciativa em grupo", body: "Como vocês rolam iniciativa?" });
  // Ler e responder nunca são bloqueados por nível.
  check((await carla(`/api/guild/topics/${rulesTopic.id}`)).topic.title, "Iniciativa em grupo", "level 1 reads gated category");
  await carla(`/api/guild/topics/${rulesTopic.id}/posts`, "POST", { body: "Cada um rola 1d20 + destreza." });
  check((await carla(`/api/guild/topics/${rulesTopic.id}`)).total, 2, "level 1 replies in gated category");

  sql(`UPDATE "AspNetUsers" SET "Level"=2, "Xp"=100 WHERE "Id"='${q(anaId)}'`);
  regrasList = await ana("/api/guild/topics?category=regras-e-sistemas");
  check([regrasList.category.canCreateTopic, regrasList.category.blockedReason], [true, null], "gate lifted at level 2");
  const anaRules = await ana("/api/guild/topics", "POST", { categoryId: CATEGORY.regras, title: "Testes de perícia", body: "Vantagem soma ou multiplica?" });
  check(xp(`guild_topic:${anaRules.id}`), "1:8", "topic XP");

  // ---------- Validação de entrada ----------
  await dave("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: "Oi", body: "Corpo" }, 400);
  await dave("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: "Título válido", body: "x".repeat(10001) }, 400);
  await dave("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: "Título válido", body: " " }, 400);
  await dave("/api/guild/topics", "POST", { categoryId: "00000000-0000-4000-8000-0000000002ff", title: "Título válido", body: "Corpo" }, 404);
  await dave("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: "Título válido", body: "Corpo", systemId: "00000000-0000-4000-8000-0000000000ff" }, 400);
  await dave("/api/guild/topics?q=" + "a".repeat(101), "GET", undefined, 400);
  check(sql(`SELECT count(*) FROM "GuildTopics" WHERE "AuthorId"=(SELECT "Id" FROM "AspNetUsers" WHERE "Email"='dave.guild@example.test')`), "0", "invalid input creates nothing");

  // ---------- XSS armazenado volta como texto ----------
  const xssTitle = `<img src=x onerror=alert(1)> Taverna`;
  const xssBody = `<script>alert("x")</script>\n<b>negrito</b> & "aspas" 'simples'\njavascript:alert(2)`;
  const tavern = await ana("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: xssTitle, body: xssBody });
  check(xp(`guild_topic:${tavern.id}`), "1:8", "second topic XP");
  const raw = await ana(`/api/guild/topics/${tavern.id}`, "GET", undefined, 200, { raw: true });
  ok(raw.headers.get("content-type").startsWith("application/json"), "JSON content type");
  check([raw.data.topic.title, raw.data.posts[0].body], [xssTitle, xssBody], "stored markup returned verbatim as text");
  check((await bruno("/api/guild/topics?category=taverna")).items[0].title, xssTitle, "list returns raw title");
  check((await bruno("/api/guild/recent?limit=3")).some((t) => t.title === xssTitle), true, "recent returns raw title");
  const opening = raw.data.posts[0].id;

  // ---------- Respostas e edição com revisão ----------
  const reply = await bruno(`/api/guild/topics/${tavern.id}/posts`, "POST", { body: "Bem-vindos, viajantes!" });
  check(reply.page, 1, "reply page");
  check(xp(`guild_post:${reply.id}`), "1:4", "reply XP");
  let topic = await ana(`/api/guild/topics/${tavern.id}`);
  check([topic.total, topic.topic.postCount, topic.posts[0].revision, topic.posts[0].canEdit, topic.posts[1].canEdit], [2, 2, 0, true, false], "topic with reply");
  check([topic.posts[0].isFirst, topic.posts[1].canMarkUseful, topic.posts[0].canMarkUseful], [true, true, false], "post capabilities");
  const edited = await ana(`/api/guild/posts/${opening}`, "PUT", { body: xssBody + "\n(editado)", revision: 0 });
  ok(edited.revision > 0 && edited.editedAt, "edit returns new revision");
  error = await ana(`/api/guild/posts/${opening}`, "PUT", { body: "Edição atrasada", revision: 0 }, 409);
  ok(/alterada desde que você a abriu/.test(error.message), "stale revision → 409");
  await ana(`/api/guild/posts/${opening}`, "PUT", { body: xssBody + "\n(editado 2x)", revision: edited.revision });
  await bruno(`/api/guild/posts/${opening}`, "PUT", { body: "Invasão", revision: 0 }, 404);
  topic = await bruno(`/api/guild/topics/${tavern.id}`);
  check([topic.posts[0].body.endsWith("(editado 2x)"), topic.posts[0].revision !== edited.revision, !!topic.posts[0].editedAt], [true, true, true], "second edit persisted");

  // ---------- Útil ----------
  error = await ana(`/api/guild/posts/${opening}/useful`, "POST", undefined, 403);
  check(error.message, "Você não pode marcar a própria mensagem como útil.", "no self useful");
  check(await bruno(`/api/guild/posts/${opening}/useful`, "POST"), { usefulCount: 1, markedUseful: true }, "marked useful");
  check(await bruno(`/api/guild/posts/${opening}/useful`, "POST"), { usefulCount: 1, markedUseful: true }, "marking twice is idempotent");
  check(await bruno(`/api/guild/posts/${opening}/useful`, "DELETE"), { usefulCount: 0, markedUseful: false }, "unmarked");
  check(await bruno(`/api/guild/posts/${opening}/useful`, "POST"), { usefulCount: 1, markedUseful: true }, "marked again");
  check(xp(`guild_useful:${opening}:${brunoId}`), "1:6", "useful XP granted once despite toggling");
  check((await ana("/api/progress/me")).xp, 100 + 8 + 8 + 6, "author XP total");

  // ---------- Denúncias ----------
  error = await ana(`/api/guild/posts/${opening}/report`, "POST", { reason: "Denunciando a mim mesma" }, 403);
  check(error.message, "Você não pode denunciar a própria mensagem.", "no self report");
  await bruno(`/api/guild/posts/${opening}/report`, "POST", { reason: "Código estranho na mensagem" });
  error = await bruno(`/api/guild/posts/${opening}/report`, "POST", { reason: "De novo, por garantia" }, 409);
  check(error.message, "Você já denunciou esta mensagem. A moderação vai analisar.", "no duplicate report");
  await carla(`/api/guild/posts/${reply.id}/report`, "POST", { reason: "ok" }, 400);
  await carla(`/api/guild/posts/${reply.id}/report`, "POST", { reason: "Parece propaganda" });
  topic = await bruno(`/api/guild/topics/${tavern.id}`);
  check([topic.posts[0].reported, topic.posts[0].canReport, topic.posts[0].openReports], [true, false, null], "reporter sees own report, not counts");

  // ---------- Fila de moderação só para a equipe ----------
  await bruno("/api/guild/moderation/reports", "GET", undefined, 403);
  await bruno(`/api/guild/moderation/posts/${opening}/delete`, "POST", { reason: "Tentativa" }, 403);
  await bruno(`/api/guild/moderation/topics/${tavern.id}`, "POST", { locked: true, reason: "Tentativa", revision: 1 }, 403);
  await bruno("/api/guild/topics?deleted=true", "GET", undefined, 403);
  await mod("/api/guild/admin/categories", "GET", undefined, 403);
  check((await chief("/api/guild/admin/categories")).length, 6, "admin manages categories");
  let reports = await mod("/api/guild/moderation/reports?status=open");
  check([reports.total, reports.items[0].post.id, reports.items[0].reporter.name, reports.items[0].post.author.name], [2, opening, "Bruno", "Ana"], "open queue oldest first");
  check((await mod(`/api/guild/topics/${tavern.id}`)).posts[0].openReports, 1, "staff sees open report count");

  // ---------- Ocultar e restaurar post (auditado) ----------
  await mod(`/api/guild/moderation/posts/${opening}/delete`, "POST", { reason: "x" }, 400);
  await mod(`/api/guild/moderation/posts/${opening}/delete`, "POST", { reason: "Conteúdo impróprio" }, 204);
  await mod(`/api/guild/moderation/posts/${opening}/delete`, "POST", { reason: "Conteúdo impróprio" }, 409);
  topic = await bruno(`/api/guild/topics/${tavern.id}`);
  check([topic.posts[0].removed, topic.posts[0].body, topic.posts[0].canMarkUseful], ["moderation", null, false], "hidden for members");
  topic = await mod(`/api/guild/topics/${tavern.id}`);
  check([topic.posts[0].removed, topic.posts[0].body.startsWith("<script>")], ["moderation", true], "staff still reads hidden text");
  check((await mod("/api/guild/moderation/reports?status=open")).total, 1, "hiding resolves the post's reports");
  await mod(`/api/guild/moderation/posts/${opening}/restore`, "POST", { reason: "Revisado: é só um exemplo de código" }, 204);
  topic = await bruno(`/api/guild/topics/${tavern.id}`);
  check([topic.posts[0].removed, topic.posts[0].body.endsWith("(editado 2x)")], [null, true], "restored for everyone");

  reports = await mod("/api/guild/moderation/reports?status=open");
  await mod(`/api/guild/moderation/reports/${reports.items[0].id}/resolve`, "POST", { resolution: "banned", note: "Teste" }, 400);
  check(await mod(`/api/guild/moderation/reports/${reports.items[0].id}/resolve`, "POST", { resolution: "dismissed", note: "Não é propaganda" }), { resolution: "dismissed", alsoResolved: 0 }, "report dismissed");
  await chief(`/api/guild/moderation/reports/${reports.items[0].id}/resolve`, "POST", { resolution: "removed", note: "Atrasado" }, 409);
  const resolved = await mod("/api/guild/moderation/reports?status=resolved");
  check([resolved.total, resolved.items.map((r) => r.resolution).sort()], [2, ["dismissed", "removed"]], "resolved history");
  check(resolved.items.every((r) => r.resolvedBy === "Embaixadora"), true, "resolver name, never e-mail");

  // ---------- Trancar, fixar, remover e restaurar tópico (revisão + auditoria) ----------
  let revision = (await mod(`/api/guild/topics/${tavern.id}`)).topic.revision;
  await mod(`/api/guild/moderation/topics/${tavern.id}`, "POST", { locked: true, revision }, 400);
  let result = await mod(`/api/guild/moderation/topics/${tavern.id}`, "POST", { locked: true, reason: "Discussão encerrada", revision });
  check(result, { revision: revision + 1, changed: true }, "locked");
  await mod(`/api/guild/moderation/topics/${tavern.id}`, "POST", { pinned: true, reason: "Fixar", revision }, 409);
  error = await ana(`/api/guild/topics/${tavern.id}/posts`, "POST", { body: "Mais uma coisa" }, 409);
  check(error.message, "Este tópico foi trancado pela moderação e não recebe respostas.", "locked topic rejects replies");
  check((await ana(`/api/guild/topics/${tavern.id}`)).canReply, false, "members cannot reply");
  await mod(`/api/guild/topics/${tavern.id}/posts`, "POST", { body: "Tópico trancado pela moderação." });
  revision = result.revision;
  result = await mod(`/api/guild/moderation/topics/${tavern.id}`, "POST", { pinned: true, reason: "Leitura recomendada", revision });
  revision = result.revision;
  await dave("/api/guild/topics", "POST", { categoryId: CATEGORY.taverna, title: "Outro assunto na taverna", body: "Mais novo, mas sem fixar." });
  const tavernList = await carla("/api/guild/topics?category=taverna");
  check([tavernList.items[0].id, tavernList.items[0].pinned, tavernList.items[0].locked], [tavern.id, true, true], "pinned topic first");
  result = await chief(`/api/guild/moderation/topics/${tavern.id}`, "POST", { deleted: true, reason: "Fora das regras", revision });
  revision = result.revision;
  await ana(`/api/guild/topics/${tavern.id}`, "GET", undefined, 404);
  ok(!(await ana("/api/guild/topics?category=taverna")).items.some((t) => t.id === tavern.id), "removed topic hidden from lists");
  ok((await mod("/api/guild/topics?deleted=true")).items.some((t) => t.id === tavern.id && t.deleted), "staff lists removed topics");
  await chief(`/api/guild/moderation/topics/${tavern.id}`, "POST", { deleted: false, reason: "Revisto", revision });
  check((await ana(`/api/guild/topics/${tavern.id}`)).topic.deleted, false, "restored topic");
  check(audit(modId), "guild.post.delete,guild.post.restore,guild.report.dismiss,guild.topic.update,guild.topic.update", "ambassador audit trail");
  check(audit(chiefId), "guild.topic.delete,guild.topic.restore", "admin audit trail");
  check(audit(anaId) + audit(brunoId) + audit(carlaId), "", "members generate no audit");
  const lockAudit = JSON.parse(sql(`SELECT "Data" FROM "Audit" WHERE "ActorId"='${q(modId)}' AND "Action"='guild.topic.update' ORDER BY "Id" LIMIT 1`));
  check([lockAudit.before.locked, lockAudit.after.locked, lockAudit.reason], [false, true, "Discussão encerrada"], "audit keeps before/after and reason");
  ok(!sql(`SELECT string_agg("Data" || "Summary", '') FROM "Audit"`).includes("@example.test"), "audit has no e-mail");

  // ---------- Exclusão pelo autor ----------
  const rulesOpening = (await ana(`/api/guild/topics/${anaRules.id}`)).posts[0].id;
  check(await ana(`/api/guild/posts/${rulesOpening}`, "DELETE"), { topicDeleted: true }, "sole post deletes the topic");
  await bruno(`/api/guild/topics/${anaRules.id}`, "GET", undefined, 404);
  error = await mod(`/api/guild/moderation/posts/${rulesOpening}/restore`, "POST", { reason: "Tentar restaurar" }, 409);
  check(error.message, "Mensagens removidas pelo próprio autor não podem ser restauradas.", "author deletion is final");
  check(xp(`guild_topic:${anaRules.id}`), "1:8", "XP stays after deletion (no farming by re-creating)");

  // ---------- Paginação ----------
  sql(`INSERT INTO "GuildPosts" ("TopicId","AuthorId","Body","CreatedAt","UsefulCount") SELECT '${announcement.id}', '${q(chiefId)}', 'Mensagem ' || g, now() + g * interval '1 second', 0 FROM generate_series(1, 25) g`);
  sql(`UPDATE "GuildTopics" SET "PostCount" = "PostCount" + 25 WHERE "Id"='${announcement.id}'`);
  let page = await carla(`/api/guild/topics/${announcement.id}?page=2`);
  check([page.total, page.pageCount, page.page, page.posts.length, page.posts[0].body], [26, 2, 2, 6, "Mensagem 20"], "topic page 2");
  check((await carla(`/api/guild/topics/${announcement.id}?page=99`)).page, 2, "page clamps to last");
  const late = await carla(`/api/guild/topics/${announcement.id}/posts`, "POST", { body: "Cheguei atrasada." });
  check(late.page, 2, "reply reports its page");
  sql(`INSERT INTO "GuildTopics" ("Id","CategoryId","AuthorId","Title","CreatedAt","LastPostAt","PostCount","Pinned","Locked","Revision") SELECT gen_random_uuid(), '${CATEGORY.fichas}', '${q(chiefId)}', 'Modelo ' || lpad(g::text, 2, '0'), now() - g * interval '1 minute', now() - g * interval '1 minute', 0, false, false, 1 FROM generate_series(1, 21) g`);
  let list = await carla("/api/guild/topics?category=fichas-e-biblioteca");
  check([list.total, list.items.length, list.pageSize, list.items[0].title], [21, 20, 20, "Modelo 01"], "topic list page 1, newest activity first");
  list = await carla("/api/guild/topics?category=fichas-e-biblioteca&page=2");
  check([list.items.length, list.items[0].title], [1, "Modelo 21"], "topic list page 2");
  list = await carla("/api/guild/topics?category=fichas-e-biblioteca&q=MODELO%2007");
  check(list.items.map((t) => t.title), ["Modelo 07"], "case-insensitive title search");

  // ---------- Cartão do autor (sem e-mail) ----------
  const card = await carla(`/api/progress/users/${anaId}`);
  check(Object.keys(card).sort(), ["achievements", "avatarUrl", "id", "level", "name", "role", "xp"], "public card fields");
  check([card.name, card.xp], ["Ana", 122], "public card values");

  // ---------- Limite "social" (12 por minuto por usuário) ----------
  const eve = await env.verifiedClient("eve.guild@example.test", "Eve");
  const statuses = [];
  for (let i = 0; i < 13; i++) {
    const response = await eve(`/api/guild/topics/${announcement.id}/posts`, "POST", { body: `Mensagem rápida ${i}` }, null, { raw: true });
    statuses.push(response.status);
  }
  check(statuses, [...Array(12).fill(200), 429], "social rate limit");
  check(sql(`SELECT count(*) FROM "XpEntries" WHERE "Reason"='guild_post' AND "UserId"=(SELECT "Id" FROM "AspNetUsers" WHERE "Email"='eve.guild@example.test')`), "10", "reply XP respects the daily limit");
  await eve(`/api/guild/topics/${announcement.id}`, "GET"); // leitura não entra no limite social

  // ---------- Nenhum e-mail nas respostas ----------
  ok(responses.length > 60, "responses captured");
  ok(responses.every((text) => !text.includes("@example.test")), "no e-mail in any guild/progress response");

  console.log(`PASS: ${env.count()} guild assertions (categories, gates, posts, revision, useful, reports, moderation, audit, XP, pagination, rate limit, privacy, XSS)`);
} catch (failure) {
  console.error(env.logs().slice(-4000));
  throw failure;
} finally {
  await env.stop();
}
