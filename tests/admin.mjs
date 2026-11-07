/**
 * Integração do painel admin (WP1) com PostgreSQL real: políticas Admin/Staff, papéis, suspensão derrubando sessão,
 * sistemas de RPG (CRUD com revisão), campanhas com rpgSystemId, visão admin de campanhas e trilha de auditoria.
 */
import { startEnvironment, password } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5201 });
const { check, ok, sql } = env;
const role = (email, value) =>
  sql(`UPDATE "AspNetUsers" SET "Role"='${value}' WHERE "Email"='${email}'`);
try {
  const admin = await env.verifiedClient("admin.wp1@example.test", "Rainha Admin");
  const ambassador = await env.verifiedClient("embaixador.wp1@example.test", "Embaixador");
  const common = await env.verifiedClient("comum.wp1@example.test", "Comum");
  const victim = await env.verifiedClient("alvo.wp1@example.test", "Alvo");
  role("admin.wp1@example.test", "admin");
  await env.authenticateMfa(admin, "admin.wp1@example.test");
  role("embaixador.wp1@example.test", "ambassador");
  const me = await admin("/api/auth/me");
  check(me.role, "admin", "papel lido do banco");
  const ids = Object.fromEntries(
    sql(`SELECT "Email" || '=' || "Id" FROM "AspNetUsers"`)
      .split("\n")
      .map((line) => line.split("=")),
  );
  const idOf = (prefix) => ids[`${prefix}.wp1@example.test`];

  // ---------- Políticas ----------
  const anonymous = env.client();
  await anonymous("/api/admin/overview", "GET", undefined, 401);
  for (const c of [common, ambassador]) {
    for (const path of [
      "/api/admin/overview",
      "/api/admin/users",
      "/api/admin/users/" + idOf("alvo"),
      "/api/admin/campaigns",
      "/api/admin/audit",
      "/api/admin/rpg-systems",
    ])
      await c(path, "GET", undefined, 403);
    await c("/api/admin/rpg-systems", "POST", { name: "Invasor" }, 403);
    await c("/api/admin/users/" + idOf("alvo") + "/role", "PUT", { role: "admin", reason: "golpe" }, 403);
    await c("/api/admin/users/" + idOf("alvo") + "/suspend", "POST", { reason: "golpe" }, 403);
  }
  const publicSystems = await common("/api/rpg-systems");
  check(publicSystems[0].name, "Sistema livre", "Sistema livre primeiro");
  ok(!("active" in publicSystems[0]) && !("revision" in publicSystems[0]), "contrato público enxuto");

  // ---------- Usuários e papéis ----------
  const list = await admin("/api/admin/users?q=alvo");
  check(list.total, 1, "busca por nome/e-mail");
  check(list.items[0].email, "alvo.wp1@example.test", "admin vê e-mail na gestão");
  check((await admin("/api/admin/users?role=ambassador")).items.map((u) => u.name), ["Embaixador"], "filtro de papel");
  check((await admin("/api/admin/users?status=suspended")).total, 0, "nenhum suspenso");
  await admin("/api/admin/users?role=owner", "GET", undefined, 400);
  await admin("/api/admin/users/inexistente", "GET", undefined, 404);
  await admin("/api/admin/users/" + idOf("comum") + "/role", "PUT", { role: "ambassador", reason: "Ajuda na biblioteca" }, 204);
  await admin("/api/admin/users/" + idOf("comum") + "/role", "PUT", { role: "dono", reason: "Inválido" }, 400);
  await admin("/api/admin/users/" + idOf("comum") + "/role", "PUT", { role: "admin", reason: "" }, 400);
  await admin("/api/admin/users/" + me.id + "/role", "PUT", { role: "common", reason: "Cansei" }, 409);
  const detail = await admin("/api/admin/users/" + idOf("comum"));
  check(detail.role, "ambassador", "papel alterado");
  check(detail.audit.length, 1, "auditoria do alvo");
  check(detail.audit[0].actorName, "Rainha Admin", "nome do ator");
  ok(JSON.parse(detail.audit[0].data).before.role === "common", "auditoria guarda antes/depois");
  check(detail.stats, { campaignsAsMaster: 0, campaignsAsMember: 0, characters: 0 }, "contagens do usuário");
  // Embaixador agora acessa Staff mas não Admin.
  await common("/api/admin/overview", "GET", undefined, 403);
  await admin("/api/admin/users/" + idOf("comum") + "/role", "PUT", { role: "common", reason: "Fim do mandato" }, 204);

  // ---------- Suspensão ----------
  await victim("/api/auth/me");
  await admin("/api/admin/users/" + me.id + "/suspend", "POST", { reason: "auto" }, 409);
  role("embaixador.wp1@example.test", "admin");
  await admin("/api/admin/users/" + idOf("embaixador") + "/suspend", "POST", { reason: "admin" }, 409);
  role("embaixador.wp1@example.test", "ambassador");
  await admin("/api/admin/users/" + idOf("alvo") + "/suspend", "POST", { until: "2001-01-01T00:00:00Z", reason: "passado" }, 400);
  await admin("/api/admin/users/" + idOf("alvo") + "/suspend", "POST", { reason: "Spam repetido na Guilda" }, 204);
  await victim("/api/campaigns", "GET", undefined, 401);
  await victim("/api/auth/me", "GET", undefined, 401);
  const relogin = env.client();
  await relogin.renew();
  await relogin("/api/auth/login", "POST", { email: "alvo.wp1@example.test", password }, 401);
  const suspended = await admin("/api/admin/users?status=suspended");
  check(suspended.total, 1, "filtro de suspensos");
  ok(suspended.items[0].suspendedUntil.startsWith("9999"), "suspensão por tempo indeterminado");
  await admin("/api/admin/users/" + idOf("alvo") + "/unsuspend", "POST", { reason: "Recurso aceito" }, 204);
  await admin("/api/admin/users/" + idOf("alvo") + "/unsuspend", "POST", undefined, 409);
  await relogin("/api/auth/login", "POST", { email: "alvo.wp1@example.test", password }, 200);
  await relogin.renew();
  await relogin("/api/campaigns");
  const victimAudit = (await admin("/api/admin/users/" + idOf("alvo"))).audit.map((a) => a.action);
  check(victimAudit, ["user.unsuspend", "user.suspend"], "suspensão auditada");

  // ---------- Sistemas de RPG ----------
  const t20 = await admin("/api/admin/rpg-systems", "POST", { name: "Tormenta 20 Edição", description: "Fantasia" });
  check(t20.slug, "tormenta-20-edicao", "slug gerado");
  await admin("/api/admin/rpg-systems", "POST", { name: "tormenta 20 edição" }, 409);
  await admin("/api/admin/rpg-systems", "POST", { name: "Outro", slug: "tormenta-20-edicao" }, 409);
  await admin("/api/admin/rpg-systems", "POST", { name: "Ruim", slug: "Com Espaço" }, 400);
  const renamed = await admin("/api/admin/rpg-systems/" + t20.id, "PUT", { name: "Tormenta20", slug: "tormenta20", description: "Arton", active: true, revision: t20.revision });
  check(renamed.revision, t20.revision + 1, "revisão incrementada");
  await admin("/api/admin/rpg-systems/" + t20.id, "PUT", { name: "Velho", slug: "velho", description: "", active: true, revision: t20.revision }, 409);
  const free = (await admin("/api/admin/rpg-systems")).find((s) => s.protected);
  check(free.name, "Sistema livre", "sistema protegido listado");
  await admin("/api/admin/rpg-systems/" + free.id, "PUT", { name: free.name, slug: free.slug, description: free.description, active: false, revision: free.revision }, 409);
  await admin("/api/admin/rpg-systems/" + free.id, "DELETE", undefined, 409);

  // ---------- Campanhas usam sistema ----------
  const byId = await common("/api/campaigns", "POST", { name: "Arton Sombria", description: "", rpgSystemId: t20.id });
  const byName = await common("/api/campaigns", "POST", { name: "Por nome", description: "", system: "TORMENTA20" });
  await common("/api/campaigns", "POST", { name: "Caseira inválida", description: "", system: "Meu sistema" }, 400);
  const fallback = await common("/api/campaigns", "POST", { name: "Caseira", description: "", rpgSystemId: free.id });
  await common("/api/campaigns", "POST", { name: "Fantasma", description: "", rpgSystemId: "00000000-0000-4000-8000-0000000000ff" }, 400);
  let mine = await common("/api/campaigns?sort=name");
  const find = (id) => mine.items.find((c) => c.id === id);
  check([find(byId.id).rpgSystemId, find(byId.id).system], [t20.id, "Tormenta20"], "campanha criada com rpgSystemId");
  check(find(byName.id).rpgSystemId, t20.id, "texto casado pelo nome");
  check([find(fallback.id).rpgSystemId, find(fallback.id).system], [free.id, "Sistema livre"], "fallback para Sistema livre");
  await admin("/api/admin/rpg-systems/" + t20.id, "PUT", { name: "Tormenta 20", slug: "tormenta20", description: "Arton", active: false, revision: renamed.revision });
  mine = await common("/api/campaigns?sort=name");
  check(find(byId.id).system, "Tormenta 20", "renomear atualiza o texto das campanhas");
  ok(!(await common("/api/rpg-systems")).some((s) => s.id === t20.id), "inativo some da lista pública");
  await common("/api/campaigns", "POST", { name: "Nova", description: "", rpgSystemId: t20.id }, 400);
  await common("/api/campaigns/" + byId.id, "PUT", { name: "Arton Sombria II", description: "", rpgSystemId: t20.id, revision: find(byId.id).revision }, 204);
  await admin("/api/admin/rpg-systems/" + t20.id, "DELETE", undefined, 409);
  const counts = (await admin("/api/admin/rpg-systems")).find((s) => s.id === t20.id);
  check([counts.campaigns, counts.active], [2, false], "contagem de uso");
  const spare = await admin("/api/admin/rpg-systems", "POST", { name: "GURPS" });
  await admin("/api/admin/rpg-systems/" + spare.id, "DELETE", undefined, 204);

  // ---------- Campanhas (visão admin) ----------
  const code = (await common("/api/campaigns/" + byId.id)).inviteCode;
  await victim("/api/campaigns/join", "POST", { code }, null);
  await relogin("/api/campaigns/join", "POST", { code });
  const all = await admin("/api/admin/campaigns?q=arton");
  check(all.total, 1, "busca admin por nome");
  check([all.items[0].masterName, all.items[0].memberCount, all.items[0].online, all.items[0].system], ["Comum", 1, false, "Tormenta 20"], "linha da campanha");
  check((await admin("/api/admin/campaigns?systemId=" + t20.id)).total, 2, "filtro por sistema");
  const session = await common("/api/campaigns/" + byId.id + "/sessions", "POST", { title: "Abertura", objective: "", mapKind: "tileset", mapKey: "crypt" });
  check((await admin("/api/admin/campaigns?online=true")).items.map((c) => c.id), [byId.id], "filtro online");
  const overview = await admin("/api/admin/overview");
  check([overview.users.total, overview.campaigns.total, overview.campaigns.online, overview.campaigns.sessions7d], [4, 3, 1, 1], "totais do painel");
  check([overview.recentAudit.length, overview.recentUsers.length], [Math.min(10, Number(sql(`SELECT count(*) FROM "Audit"`))), 4], "listas do painel");
  check(overview.recentAudit[0].action, "system.delete", "auditoria mais recente primeiro");
  check(overview.users.new7d, 4, "novos usuários");
  const campaignDetail = await admin("/api/admin/campaigns/" + byId.id);
  check([campaignDetail.master.name, campaignDetail.members.map((m) => m.name), campaignDetail.sessions[0].title, campaignDetail.online], ["Comum", ["Alvo"], "Abertura", true], "detalhe da campanha");
  ok(!JSON.stringify(campaignDetail).includes("@example.test") && !("inviteCode" in campaignDetail), "detalhe sem e-mail ou convite");
  await admin("/api/admin/campaigns/" + byId.id, "DELETE", { reason: "Conteúdo abusivo" }, 409);
  await common("/api/sessions/" + session.id + "/end", "POST", undefined, 204);
  await admin("/api/admin/campaigns/" + byId.id, "DELETE", { reason: "" }, 400);
  await ambassador("/api/admin/campaigns/" + byId.id, "DELETE", { reason: "Conteúdo abusivo" }, 403);
  await admin("/api/admin/campaigns/" + byId.id, "DELETE", { reason: "Conteúdo abusivo" }, 204);
  await common("/api/campaigns/" + byId.id, "GET", undefined, 404);
  await admin("/api/admin/campaigns/" + byId.id, "GET", undefined, 404);

  // ---------- Auditoria ----------
  const audit = await admin("/api/admin/audit?targetType=system");
  check(audit.items.map((a) => a.action), ["system.delete", "system.create", "system.update", "system.update", "system.create"], "auditoria de sistemas em ordem");
  ok(audit.items.every((a) => a.actorName === "Rainha Admin"), "nome do ator na auditoria");
  check((await admin("/api/admin/audit?action=campaign.")).items[0].targetId, byId.id, "exclusão de campanha auditada");
  check((await admin("/api/admin/audit?action=user.role&actor=rainha")).total, 2, "filtro por ator (nome)");
  check((await admin("/api/admin/audit?targetType=user&targetId=" + idOf("alvo"))).total, 2, "filtro por alvo");
  const today = new Date().toISOString().slice(0, 10);
  ok((await admin(`/api/admin/audit?from=${today}&to=${today}`)).total >= 10, "filtro de datas inclui o dia");
  check((await admin("/api/admin/audit?to=2001-01-01")).total, 0, "filtro de datas passado");
  check(Number(sql(`SELECT count(*) FROM "Audit" WHERE "ActorId" <> '${me.id}'`)), 0, "somente o admin gerou auditoria");

  console.log(
    `PASS: ${env.count()} admin assertions with real PostgreSQL. Policies (401/403), roles, suspension dropping sessions, RPG systems with revisions, campaign systems, admin campaigns and audit verified.`,
  );
} catch (error) {
  console.error(env.logs().slice(-6000));
  throw error;
} finally {
  await env.stop();
}
