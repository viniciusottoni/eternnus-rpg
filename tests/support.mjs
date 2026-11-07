/**
 * Integração do suporte com PostgreSQL real: abertura, conversa usuário↔equipe, notas internas,
 * transições, revisão, atribuição, auditoria, limite de abertos, numeração concorrente e política Admin.
 */
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5202 });
const { check, ok, sql } = env;
try {
  const author = await env.verifiedClient("autora.suporte@example.test", "Ana");
  const other = await env.verifiedClient("outro.suporte@example.test", "Bruno");
  const admin = await env.verifiedClient("admin.suporte@example.test", "Clara");
  const ambassador = await env.verifiedClient("embaixador.suporte@example.test", "Davi");
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='admin.suporte@example.test'`);
  await env.authenticateMfa(admin, "admin.suporte@example.test");
  sql(`UPDATE "AspNetUsers" SET "Role"='ambassador' WHERE "Email"='embaixador.suporte@example.test'`);
  const id = (email) => sql(`SELECT "Id" FROM "AspNetUsers" WHERE "Email"='${email}'`);
  const authorId = id("autora.suporte@example.test"),
    otherId = id("outro.suporte@example.test"),
    adminId = id("admin.suporte@example.test"),
    ambassadorId = id("embaixador.suporte@example.test");

  // Conta pendente não usa suporte (política Verified).
  const pending = env.client();
  await env.register(pending, "pendente.suporte@example.test", "Pendente");
  await pending("/api/support/tickets", "GET", undefined, 403);
  await pending("/api/support/tickets", "POST", { subject: "Ajuda", category: "account", body: "Não recebi o e-mail." }, 403);
  // Escrita sem CSRF é recusada.
  await author("/api/support/tickets", "POST", { subject: "Sem token", category: "bug", body: "Descrição suficiente" }, 400, { csrf: false });

  // ---------- Abertura e validação ----------
  await author("/api/support/tickets", "POST", { subject: "ab", category: "bug", body: "Descrição suficiente" }, 400);
  await author("/api/support/tickets", "POST", { subject: "Assunto", category: "admin", body: "Descrição suficiente" }, 400);
  await author("/api/support/tickets", "POST", { subject: "Assunto", category: "bug", body: "curta" }, 400);
  const created = await author("/api/support/tickets", "POST", {
    subject: "Não consigo abrir minha ficha",
    category: "sheet",
    body: "Ao abrir a ficha aparece um erro.\nJá recarreguei a página.",
  });
  check(created.number, 1);
  ok(/^[0-9a-f-]{36}$/.test(created.id), "ticket id");
  const second = await other("/api/support/tickets", "POST", { subject: "Sugestão de mapa", category: "suggestion", body: "Um mapa de deserto seria ótimo." });
  check(second.number, 2);
  const base = "/api/support/tickets/" + created.id;

  let mine = await author("/api/support/tickets");
  check([mine.total, mine.openCount, mine.maxOpen, mine.items[0].status, mine.items[0].messageCount], [1, 1, 5, "open", 1]);
  let detail = await author(base);
  check(detail.messages[0].body, "Ao abrir a ficha aparece um erro.\nJá recarreguei a página.");
  check([detail.messages[0].mine, detail.messages[0].fromStaff, detail.canReply, detail.canClose, detail.canReopen], [true, false, true, true, false]);
  ok(!JSON.stringify(detail).includes("@example.test"), "author view has no e-mail");

  // ---------- Isolamento entre usuários ----------
  await other(base, "GET", undefined, 404);
  await other(base + "/messages", "POST", { body: "Intromissão" }, 404);
  await other(base + "/close", "POST", undefined, 404);
  await other(base + "/reopen", "POST", undefined, 404);
  check((await other("/api/support/tickets")).total, 1);
  await admin(base, "GET", undefined, 404);

  // ---------- Política da equipe ----------
  for (const c of [author, other, ambassador]) {
    await c("/api/admin/tickets", "GET", undefined, 403);
    await c("/api/admin/tickets/" + created.id, "GET", undefined, 403);
    await c("/api/admin/tickets/assignees", "GET", undefined, 403);
    await c("/api/admin/tickets/" + created.id + "/messages", "POST", { body: "x", internal: false }, 403);
    await c("/api/admin/tickets/" + created.id, "PUT", { status: "closed", priority: "low", assignedToId: null, revision: 1 }, 403);
  }
  const queue = await admin("/api/admin/tickets");
  check([queue.total, queue.counts.open, queue.mine], [2, 2, 0]);
  ok(!JSON.stringify(queue).includes("@"), "queue has no e-mail");
  check(queue.items.map((t) => t.number).sort(), [1, 2]);
  await admin("/api/admin/tickets?assigned=everyone", "GET", undefined, 400);
  check((await admin("/api/admin/tickets?q=%231")).items.map((t) => t.number), [1]);
  check((await admin("/api/admin/tickets?category=suggestion")).items.map((t) => t.number), [2]);

  let staff = await admin("/api/admin/tickets/" + created.id);
  check([staff.author.email, staff.author.name, staff.status, staff.priority, staff.assignee], ["autora.suporte@example.test", "Ana", "open", "normal", null]);
  const assignees = await admin("/api/admin/tickets/assignees");
  check(assignees.map((a) => a.name), ["Clara", "Davi"]);
  ok(!JSON.stringify(assignees).includes("@"), "assignees have no e-mail");

  // ---------- Atribuição e revisão ----------
  const put = (body, expected = 200) => admin("/api/admin/tickets/" + created.id, "PUT", body, expected);
  await put({ status: "in_progress", priority: "high", assignedToId: otherId, revision: staff.revision }, 400);
  await put({ status: "in_progress", priority: "max", assignedToId: null, revision: staff.revision }, 400);
  const first = staff.revision;
  staff = await put({ status: "in_progress", priority: "high", assignedToId: ambassadorId, revision: first });
  check([staff.status, staff.priority, staff.assignee.name, staff.revision], ["in_progress", "high", "Davi", first + 1]);
  await put({ status: "resolved", priority: "high", assignedToId: ambassadorId, revision: first }, 409);
  const autoNotes = staff.messages.filter((m) => m.internal).map((m) => m.body);
  check(autoNotes, ["Status: Aberto → Em andamento", "Prioridade: Normal → Alta", "Atribuição: ninguém → Davi"]);
  staff = await put({ status: "in_progress", priority: "high", assignedToId: adminId, revision: staff.revision });
  check(staff.assignee.name, "Clara");
  check((await admin("/api/admin/tickets?assigned=me")).items.map((t) => t.number), [1]);
  check((await admin("/api/admin/tickets?assigned=none")).items.map((t) => t.number), [2]);
  check((await admin("/api/admin/tickets")).items.map((t) => t.number), [1, 2]); // alta antes de normal

  // ---------- Conversa ----------
  await admin("/api/admin/tickets/" + created.id + "/messages", "POST", { body: "Suspeita: cache do PWA.", internal: true }, 204);
  check((await admin("/api/admin/tickets/" + created.id)).status, "in_progress");
  await admin("/api/admin/tickets/" + created.id + "/messages", "POST", { body: "Olá, Ana!\nPode limpar o cache e tentar de novo?", internal: false }, 204);
  detail = await author(base);
  check(detail.status, "waiting_user");
  check(detail.messages.map((m) => [m.fromStaff, m.author.name]), [[false, "Ana"], [true, "Clara"]]);
  check(detail.messages[1].body, "Olá, Ana!\nPode limpar o cache e tentar de novo?");
  const authorView = JSON.stringify(detail);
  ok(!authorView.includes("Suspeita") && !authorView.includes("Status:") && !authorView.includes("Atribuição"), "internal notes hidden");
  ok(!authorView.includes("@example.test"), "no staff e-mail");
  mine = await author("/api/support/tickets");
  check([mine.items[0].status, mine.items[0].lastFromStaff, mine.items[0].messageCount], ["waiting_user", true, 2]);

  await author(base + "/messages", "POST", { body: "   " }, 400);
  await author(base + "/messages", "POST", { body: "Limpei e continua." }, 204);
  check((await author(base)).status, "open");

  staff = await admin("/api/admin/tickets/" + created.id);
  staff = await put({ status: "resolved", priority: "high", assignedToId: adminId, revision: staff.revision });
  ok(staff.closedAt, "resolved sets closedAt");
  detail = await author(base);
  check([detail.status, detail.canReply, detail.canReopen], ["resolved", true, true]);
  await author(base + "/messages", "POST", { body: "Voltou a acontecer hoje." }, 204);
  detail = await author(base);
  check([detail.status, detail.closedAt], ["open", null]);

  await author(base + "/close", "POST", undefined, 204);
  await author(base + "/close", "POST", undefined, 409);
  const closedReply = await author(base + "/messages", "POST", { body: "Ainda aqui?" }, 409);
  ok(/Reabra/.test(closedReply.message), "closed ticket asks to reopen");
  detail = await author(base);
  check([detail.status, detail.canReply, detail.canClose, detail.canReopen], ["closed", false, false, true]);
  await author(base + "/reopen", "POST", undefined, 204);
  await author(base + "/reopen", "POST", undefined, 409);
  check((await author(base)).status, "open");
  // Reabertura fora do prazo de 30 dias.
  await author(base + "/close", "POST", undefined, 204);
  sql(`UPDATE "Tickets" SET "ClosedAt" = now() - interval '31 days' WHERE "Id"='${created.id}'`);
  check((await author(base)).canReopen, false);
  await author(base + "/reopen", "POST", undefined, 409);

  // ---------- Auditoria ----------
  const audit = sql(`SELECT "Action" || ':' || count(*) FROM "Audit" WHERE "TargetType"='ticket' AND "TargetId"='${created.id}' AND "ActorId"='${adminId}' GROUP BY "Action" ORDER BY "Action"`);
  check(audit.split("\n"), ["ticket.note:1", "ticket.reply:1", "ticket.update:3"]);
  check(sql(`SELECT count(*) FROM "Audit" WHERE "Data" LIKE '%@%' OR "Summary" LIKE '%@%'`), "0");
  ok(sql(`SELECT "Summary" FROM "Audit" WHERE "Action"='ticket.update' ORDER BY "Id" LIMIT 1`).includes("Atribuição: ninguém → Davi"), "audit summary");
  check(sql(`SELECT count(*) FROM "Audit" WHERE "ActorId"='${authorId}'`), "0");
  check(sql(`SELECT count(*) FROM "XpEntries"`), "0");

  // ---------- Limite de abertos ----------
  const limited = await env.verifiedClient("limite.suporte@example.test", "Lia");
  for (let i = 0; i < 5; i++)
    await limited("/api/support/tickets", "POST", { subject: "Chamado " + i, category: "other", body: "Descrição suficiente " + i });
  const limit = await limited("/api/support/tickets", "POST", { subject: "Sexto", category: "other", body: "Descrição suficiente" }, 400);
  ok(/5 chamados em aberto/.test(limit.message), "open limit message");
  check((await limited("/api/support/tickets?status=active")).total, 5);

  // ---------- Numeração concorrente ----------
  const before = Number(sql(`SELECT max("Number") FROM "Tickets"`));
  const burst = await Promise.all(
    [other, admin, ambassador, other, admin, ambassador, other, admin].map((c, i) =>
      c("/api/support/tickets", "POST", { subject: "Rajada " + i, category: "bug", body: "Abertura simultânea " + i }),
    ),
  );
  const numbers = burst.map((b) => b.number).sort((a, b) => a - b);
  check(numbers, Array.from({ length: 8 }, (_, i) => before + 1 + i));
  check(sql(`SELECT count(DISTINCT "Number") = count(*) FROM "Tickets"`), "t");
  check(sql(`SELECT count(*) FROM "Tickets" t WHERE NOT EXISTS (SELECT 1 FROM "TicketMessages" m WHERE m."TicketId" = t."Id")`), "0");

  console.log(`Support integration passed: ${env.count()} assertions.`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await env.stop();
}
