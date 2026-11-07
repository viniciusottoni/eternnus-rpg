import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/guild-policy.js", import.meta.url),
  "utf8",
);
const g = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("rotas da Guilda validam slug, GUID e página", () => {
  assert.deepEqual(g.parseGuildRoute([]), { view: "hall" });
  assert.deepEqual(g.parseGuildRoute(["c", "taverna"]), { view: "category", slug: "taverna" });
  assert.deepEqual(g.parseGuildRoute(["c", "Taverna"]), { view: "hall" });
  assert.deepEqual(g.parseGuildRoute(["c", "a--b"]), { view: "hall" });
  const id = "6f1c2a8e-0d5b-4c1e-9a3f-1b2c3d4e5f60";
  assert.deepEqual(g.parseGuildRoute(["t", id]), { view: "topic", id, page: 1 });
  assert.deepEqual(g.parseGuildRoute(["t", id.toUpperCase(), "3"]), { view: "topic", id, page: 3 });
  assert.deepEqual(g.parseGuildRoute(["t", id, "0"]).page, 1);
  assert.deepEqual(g.parseGuildRoute(["t", id, "x"]).page, 1);
  assert.deepEqual(g.parseGuildRoute(["t", "nao-e-guid"]), { view: "hall" });
  assert.deepEqual(g.parseGuildRoute(["moderation"]), { view: "moderation", tab: "open" });
  assert.deepEqual(g.parseGuildRoute(["moderation", "categories"]), { view: "moderation", tab: "categories" });
  assert.deepEqual(g.parseGuildRoute(["moderation", "hack"]), { view: "moderation", tab: "open" });
});

test("datas relativas em português", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  assert.equal(g.relativeTime("2026-11-07T11:59:40Z", now), "agora mesmo");
  assert.equal(g.relativeTime("2026-11-07T11:55:00Z", now), "há 5 min");
  assert.equal(g.relativeTime("2026-11-07T09:00:00", now), "há 3 h"); // sem fuso = UTC
  assert.equal(g.relativeTime("2026-11-06T10:00:00Z", now), "ontem");
  assert.equal(g.relativeTime("2026-11-03T12:00:00Z", now), "há 4 dias");
  assert.match(g.relativeTime("2026-10-01T12:00:00Z", now), /^01\/10\/2026$/);
  assert.equal(g.relativeTime("lixo", now), "");
  assert.equal(g.parseDate("2026-11-07T12:00:00+00:00").toISOString(), "2026-11-07T12:00:00.000Z");
});

test("links: somente http(s) válidos viram link; pontuação final fica no texto", () => {
  assert.deepEqual(g.linkSegments("Veja https://eternnus.com/regras."), [
    { type: "text", value: "Veja " },
    { type: "link", value: "https://eternnus.com/regras", href: "https://eternnus.com/regras" },
    { type: "text", value: "." },
  ]);
  const wiki = g.linkSegments("(ver http://x.com/a_(b)).");
  assert.equal(wiki.find((p) => p.type === "link").value, "http://x.com/a_(b)");
  assert.equal(wiki.map((p) => p.value).join(""), "(ver http://x.com/a_(b)).");
  for (const evil of ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "<img src=x onerror=alert(1)>", "ftp://x.com"])
    assert.deepEqual(g.linkSegments(evil), [{ type: "text", value: evil }], evil);
  // Aspas e sinais de menor encerram o link: não há como escapar do atributo.
  const quoted = g.linkSegments('https://a.com/"onmouseover="x');
  assert.equal(quoted[0].href, "https://a.com/");
  assert.equal(g.safeHttpUrl("https://user:pw@evil.com"), null);
  assert.equal(g.safeHttpUrl("https://"), null);
  assert.deepEqual(g.linkSegments(""), []);
  assert.deepEqual(g.linkSegments("linha 1\nhttps://a.com\nlinha 3").map((p) => p.type), ["text", "link", "text"]);
});

test("avatar seguro e selos de papel", () => {
  assert.equal(g.safeAvatar("/assets/avatar.svg"), "/assets/avatar.svg");
  assert.equal(g.safeAvatar("/api/auth/avatar/6f1c2a8e-0d5b-4c1e-9a3f-1b2c3d4e5f60"), "/api/auth/avatar/6f1c2a8e-0d5b-4c1e-9a3f-1b2c3d4e5f60");
  assert.equal(g.safeAvatar("https://cdn.discordapp.com/a.png"), "https://cdn.discordapp.com/a.png");
  for (const bad of ["//evil.com/x.png", "http://insecure.com/a.png", "javascript:alert(1)", '/a" onerror="x', null])
    assert.equal(g.safeAvatar(bad), g.DEFAULT_AVATAR, String(bad));
  assert.deepEqual(g.roleBadge("admin"), { label: "Admin", kind: "admin" });
  assert.deepEqual(g.roleBadge("ambassador"), { label: "Embaixador", kind: "ambassador" });
  assert.equal(g.roleBadge("common"), null);
  assert.equal(g.roleBadge("<script>"), null);
  assert.equal(g.removedLabel("moderation"), "Mensagem removida pela moderação");
  assert.equal(g.removedLabel("author"), "Mensagem removida pelo autor");
  assert.equal(g.removedLabel(null), "");
});

test("botões do post seguem as capacidades do servidor", () => {
  const base = { canEdit: false, canDelete: false, canMarkUseful: true, canReport: true, markedUseful: true, usefulCount: 3, removed: null };
  const other = g.postButtons(base, { staff: false, canReply: true });
  assert.deepEqual(other.useful, { show: true, disabled: false, pressed: true, count: 3 });
  assert.equal(other.reply, true);
  assert.equal(other.report, true);
  assert.equal(other.edit, false);
  assert.equal(other.moderateRemove, false);
  const mine = g.postButtons({ ...base, canEdit: true, canDelete: true, canMarkUseful: false, canReport: false }, { canReply: false });
  assert.equal(mine.useful.disabled, true);
  assert.equal(mine.edit, true);
  assert.equal(mine.reply, false);
  const removed = g.postButtons({ ...base, removed: "moderation", canMarkUseful: false, canReport: false }, { staff: true, canReply: true });
  assert.equal(removed.useful.show, false);
  assert.equal(removed.reply, false);
  assert.equal(removed.moderateRemove, false);
  assert.equal(removed.moderateRestore, true);
  assert.equal(g.postButtons({ ...base, removed: "author" }, { staff: true }).moderateRestore, false);
  assert.equal(g.postButtons({ ...base, reported: true, canReport: false }).reported, true);
});

test("ferramentas de moderação do tópico", () => {
  assert.deepEqual(g.topicTools({ pinned: false, locked: false }, false), []);
  const tools = g.topicTools({ pinned: true, locked: false, deleted: false }, true);
  assert.deepEqual(tools.map((t) => t.label), ["Desafixar", "Trancar", "Mover", "Remover tópico"]);
  assert.deepEqual(tools[0].change, { pinned: false });
  assert.deepEqual(tools[1].change, { locked: true });
  assert.equal(g.topicTools({ deleted: true }, true)[3].label, "Restaurar tópico");
});

test("bloqueio para abrir tópico: servidor primeiro, depois regras visíveis", () => {
  assert.deepEqual(g.topicGate({ canCreateTopic: false, blockedReason: "Exige nível 2.", requiredLevel: 2 }), {
    canCreate: false,
    reason: "Exige nível 2.",
    requiredLevel: 2,
  });
  const regras = { name: "Regras", minLevelToPost: 2, staffOnly: false };
  assert.deepEqual(g.topicGate(regras, { level: 1 }), {
    canCreate: false,
    reason: "Abrir tópicos em Regras exige nível 2. Seu nível atual é 1.",
    requiredLevel: 2,
  });
  assert.equal(g.topicGate(regras, { level: 2 }).canCreate, true);
  assert.equal(g.topicGate(regras, { level: 1, staff: true }).canCreate, true);
  assert.equal(g.topicGate({ name: "Avisos", staffOnly: true }, { level: 50 }).canCreate, false);
  assert.equal(g.topicGate({ name: "Avisos", staffOnly: true }, { staff: true }).canCreate, true);
  assert.equal(g.topicGate({ name: "Taverna" }, { level: 1, topicBlockedReason: "Suba de nível." }).reason, "Suba de nível.");
  assert.equal(g.topicGate({ name: "Velha", archived: true }, { staff: true }).canCreate, false);
  assert.equal(g.topicGate(null).canCreate, false);
});

test("contador de caracteres, páginas e respostas", () => {
  assert.deepEqual(g.charCounter(0, 10000, 2), { text: "0 / 10.000", state: "short", valid: false });
  assert.equal(g.charCounter(50, 10000, 2).state, "ok");
  assert.equal(g.charCounter(9990, 10000, 2).state, "warn");
  assert.deepEqual(g.charCounter(10001, 10000, 2).valid, false);
  assert.equal(g.charCounter(10001, 10000, 2).state, "over");
  assert.equal(g.pageOf(20), 1);
  assert.equal(g.pageOf(21), 2);
  assert.equal(g.pageCount(0), 1);
  assert.equal(g.pageCount(41), 3);
  assert.equal(g.repliesLabel(0), "Sem respostas");
  assert.equal(g.repliesLabel(1), "1 resposta");
  assert.equal(g.repliesLabel(1200), "1.200 respostas");
});
