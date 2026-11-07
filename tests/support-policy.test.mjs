import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const P = await import("../apps/Eternnus.Web/wwwroot/js/support-policy.js");

test("status, priority and category labels are pt-BR and cover every server value", () => {
  assert.deepEqual(P.STATUSES, ["open", "in_progress", "waiting_user", "resolved", "closed"]);
  assert.deepEqual(
    P.STATUSES.map((s) => P.statusLabel(s)),
    ["Aberto", "Em andamento", "Aguardando você", "Resolvido", "Fechado"],
  );
  assert.equal(P.statusLabel("waiting_user", true), "Aguardando usuário");
  assert.equal(P.statusLabel("open", true), "Aberto");
  assert.equal(P.statusLabel("constructor"), "Desconhecido");
  assert.deepEqual(P.PRIORITIES.map(P.priorityLabel), ["Urgente", "Alta", "Normal", "Baixa"]);
  assert.deepEqual(P.CATEGORIES.map(P.categoryLabel), [
    "Conta",
    "Erro na plataforma",
    "Campanha",
    "Ficha",
    "Denúncia/abuso",
    "Sugestão",
    "Outro",
  ]);
  assert.equal(P.categoryLabel("__proto__"), "Outro");
});

test("the policy mirrors the C# constants", async () => {
  const platform = await readFile(new URL("../apps/Eternnus.Web/Domain/Platform.cs", import.meta.url), "utf8");
  for (const value of [...P.STATUSES, ...P.PRIORITIES, ...P.CATEGORIES]) assert.match(platform, new RegExp(`"${value}"`));
  const service = await readFile(new URL("../apps/Eternnus.Web/Application/SupportService.cs", import.meta.url), "utf8");
  assert.match(service, new RegExp(`MaxOpenPerUser = ${P.MAX_OPEN}\\b`));
  assert.match(service, new RegExp(`ReopenDays = ${P.REOPEN_DAYS}\\b`));
  assert.match(service, new RegExp(`PageSize = ${P.PAGE_SIZE}\\b`));
});

test("chip tones come from a fixed vocabulary", () => {
  const allowed = new Set(["", "good", "warn", "bad", "quiet"]);
  for (const s of [...P.STATUSES, "evil\" onclick=\"x", undefined]) assert.ok(allowed.has(P.statusTone(s)));
  for (const p of [...P.PRIORITIES, "<script>", null]) assert.ok(allowed.has(P.priorityTone(p)));
  assert.equal(P.priorityTone("urgent"), "bad");
  assert.equal(P.statusTone("resolved"), "good");
});

test("replies move the status like the server does", () => {
  assert.equal(P.afterUserReply("waiting_user"), "open");
  assert.equal(P.afterUserReply("resolved"), "open");
  assert.equal(P.afterUserReply("in_progress"), "in_progress");
  assert.equal(P.afterStaffReply("open"), "waiting_user");
  assert.equal(P.afterStaffReply("in_progress"), "waiting_user");
  assert.equal(P.afterStaffReply("resolved"), "resolved");
  assert.equal(P.canUserReply("closed"), false);
  assert.equal(P.canUserReply("resolved"), true);
  assert.equal(P.canUserClose("closed"), false);
  assert.equal(P.canUserClose("waiting_user"), true);
  assert.equal(P.canUserReply("bogus"), false);
});

test("reopening is limited to concluded tickets within 30 days", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  assert.equal(P.canUserReopen("closed", "2026-10-08T12:00:01Z", now), true);
  assert.equal(P.canUserReopen("resolved", "2026-10-08T12:00:00", now), false);
  assert.equal(P.canUserReopen("closed", null, now), false);
  assert.equal(P.canUserReopen("open", "2026-11-07T11:00:00Z", now), false);
  assert.match(P.statusHint("closed", false), /abra um novo chamado/);
  assert.match(P.statusHint("resolved", true), /responda para reabrir/);
});

test("ticket and reply validation matches the server limits", () => {
  const ok = { subject: "Não consigo entrar", category: "account", body: "Descrição suficiente" };
  assert.equal(P.validateTicket(ok), "");
  assert.match(P.validateTicket({ ...ok, subject: "  ab  " }), /assunto/);
  assert.match(P.validateTicket({ ...ok, subject: "x".repeat(121) }), /assunto/);
  assert.match(P.validateTicket({ ...ok, subject: "tab\there" }), /assunto/);
  assert.match(P.validateTicket({ ...ok, category: "hack" }), /categoria/);
  assert.match(P.validateTicket({ ...ok, body: "curta" }), /descrição/);
  assert.equal(P.validateTicket({ ...ok, body: "linha 1\r\nlinha 2\tok" }), "");
  assert.match(P.validateTicket({ ...ok, body: "x".repeat(5001) }), /descrição/);
  assert.equal(P.validateReply("ok"), "");
  assert.match(P.validateReply("   "), /mensagem/);
  assert.match(P.validateReply("bell\u0007"), /mensagem/);
});

test("query strings only carry recognised filters", () => {
  assert.equal(P.queueQuery(), "status=active&page=1");
  assert.equal(
    P.queueQuery({ status: "", priority: "urgent", category: "bug", assigned: "me", q: "  #12  ", page: 3 }),
    "priority=urgent&category=bug&assigned=me&q=%2312&page=3",
  );
  assert.equal(P.queueQuery({ status: "x", priority: "max", category: "?", assigned: "all", page: -4 }), "page=1");
  assert.equal(new URLSearchParams(P.queueQuery({ q: "a".repeat(300) })).get("q").length, 100);
  assert.equal(P.myQuery({ status: "active", page: 2 }), "status=active&page=2");
  assert.equal(P.myQuery({ status: "deleted" }), "page=1");
  assert.equal(P.pageCount(0), 1);
  assert.equal(P.pageCount(41), 3);
});

test("routes accept only GUIDs and avatars only safe URLs", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(P.ticketFromSegments([id]), id);
  assert.equal(P.ticketFromSegments([id.toUpperCase()]), id);
  assert.equal(P.ticketFromSegments(["new"]), null);
  assert.equal(P.ticketFromSegments([]), null);
  assert.equal(P.safeAvatar("/assets/avatar.svg"), "/assets/avatar.svg");
  assert.equal(P.safeAvatar("/api/auth/avatar/" + id), "/api/auth/avatar/" + id);
  assert.equal(P.safeAvatar("https://cdn.discordapp.com/a.png"), "https://cdn.discordapp.com/a.png");
  for (const bad of ["javascript:alert(1)", "//evil.test/x.png", "http://x/y.png", '/a" onerror="x', null])
    assert.equal(P.safeAvatar(bad), "/assets/avatar.svg");
});

test("the open limit and the change preview mirror the staff update", () => {
  assert.equal(P.canOpenTicket(4), true);
  assert.equal(P.canOpenTicket(5), false);
  const before = { status: "open", priority: "normal", assignedToId: null };
  assert.deepEqual(P.changeSummary(before, before), []);
  assert.deepEqual(
    P.changeSummary(before, { status: "waiting_user", priority: "urgent", assignedToId: "u1" }, { u1: "Clara" }),
    ["Status: Aberto → Aguardando usuário", "Prioridade: Normal → Urgente", "Atribuição: ninguém → Clara"],
  );
  assert.deepEqual(P.changeSummary({ ...before, assignedToId: "u1" }, before, { u1: "Clara" }), [
    "Atribuição: Clara → ninguém",
  ]);
});
