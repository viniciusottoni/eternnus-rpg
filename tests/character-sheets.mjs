/**
 * Integração da ficha do jogador baseada em ficha-modelo com PostgreSQL real: nascimento pelo modelo da campanha,
 * fallback livre, conversão da ficha antiga, validação por tipo, calculados, espelho na mesa, histórico por campo,
 * 409, migração com prévia, ações da mesa com @campos, ajuste de vida do mestre, autorização e PDF de versão antiga.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5304 });
const { check, ok, sql } = env;
const FREE_TEMPLATE = "00000000-0000-4000-8000-000000000101";
const FREE_V1 = "00000000-0000-4000-8000-000000000102";
const noEmail = (data, where) =>
  ok(!JSON.stringify(data).includes("@example.test"), `sem e-mail em ${where}`);
try {
  const admin = await env.verifiedClient("admin.ficha@example.test", "Ana Admin");
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='admin.ficha@example.test'`);
  await env.authenticateMfa(admin, "admin.ficha@example.test");
  const master = await env.verifiedClient("mestre.ficha@example.test", "Vinícius");
  const player = await env.verifiedClient("jogador.ficha@example.test", "Lia");
  const second = await env.verifiedClient("segundo.ficha@example.test", "Bruno");
  const outsider = await env.verifiedClient("fora.ficha@example.test", "Forasteiro");

  // ---------- Modelo do sistema (equipe) ----------
  const system = await admin("/api/admin/rpg-systems", "POST", { name: "Arton Teste", description: "" });
  const created = await admin("/api/sheet-templates", "POST", { systemId: system.id, name: "Ficha Arton", description: "" });
  const tid = created.id;
  const page = [{ index: 0, width: 595.28, height: 841.89 }];
  const f = (name, type, extra = {}, i = 0) => ({
    name, label: "Campo " + name, type, page: 0, x: 0.1, y: 0.05 + i * 0.07, w: 0.3, h: 0.04, fontSize: 10, align: "left", options: [], ...extra,
  });
  const v1Fields = [
    f("nome", "text", { role: "name", maxLength: 100 }, 0),
    f("nivel", "number", { role: "level", min: 1, max: 20, default: "1" }, 1),
    f("pv", "number", { role: "hp", min: 0, default: "10" }, 2),
    f("pv_max", "number", { role: "maxHp", min: 1, default: "10" }, 3),
    f("forca", "number", { min: 0, max: 30, default: "14" }, 4),
    f("forca_mod", "computed", { formula: "floor((@forca - 10) / 2)" }, 5),
    f("classe", "select", { options: ["Guerreiro", "Mago"] }, 6),
    f("vivo", "checkbox", { default: "true" }, 7),
    f("historia", "textarea", { maxLength: 50 }, 8),
    f("apelido", "text", { maxLength: 10 }, 9),
  ];
  const actionsV1 = [{ key: "espada", name: "Espada longa", kind: "ataque", formula: "1d20 + @forca_mod", description: "" }];
  let draft = await admin(`/api/sheet-templates/${tid}/versions/${created.draftId}`, "PUT", { pages: page, fields: v1Fields, actions: actionsV1, notes: "", revision: 1 });
  // Exercise the actual PDF upload, including all multipart fields (the recovered WP5 fix).
  const pdf = await readFile(join(import.meta.dirname, "fixtures/library/manual.pdf"));
  const upload = new FormData();
  upload.append("pdf", new Blob([pdf], { type: "application/pdf" }), "modelo.pdf");
  upload.append("pages", JSON.stringify(page)); upload.append("revision", String(draft.revision));
  draft = await admin(`/api/sheet-templates/${tid}/versions/${created.draftId}/pdf`, "PUT", upload);
  await admin(`/api/sheet-templates/${tid}/versions/${created.draftId}/publish`, "POST", { revision: draft.revision });
  const v1 = created.draftId;
  const tpl = await admin(`/api/sheet-templates/${tid}`);
  await admin(`/api/sheet-templates/${tid}`, "PUT", { name: "Ficha Arton", description: "", isDefault: true, archived: false, revision: tpl.revision });

  // ---------- Campanha e modelo da campanha ----------
  const campaign = await master("/api/campaigns", "POST", { name: "Reinado", description: "", rpgSystemId: system.id });
  const cpath = "/api/campaigns/" + campaign.id;
  const { inviteCode } = await master(cpath);
  await player("/api/campaigns/join", "POST", { code: inviteCode });
  await second("/api/campaigns/join", "POST", { code: inviteCode });
  const campaignTemplate = await player(cpath + "/sheet-template");
  check([campaignTemplate.source, campaignTemplate.template.id, campaignTemplate.version.id, campaignTemplate.version.hasPdf, campaignTemplate.template.isDefault], ["default", tid, v1, true, true]);
  await outsider(cpath + "/sheet-template", "GET", undefined, 404);
  noEmail(campaignTemplate, "modelo da campanha");

  // Campaign template choice: owner, CSRF, system, publication and revision are server rules.
  const campaignRevision = (await master(cpath)).revision;
  await player(cpath + "/sheet-template", "PUT", { templateId: tid, revision: campaignRevision }, 404);
  await master(cpath + "/sheet-template", "PUT", { templateId: tid, revision: campaignRevision }, 400, { csrf: false });
  await master(cpath + "/sheet-template", "PUT", { templateId: FREE_TEMPLATE, revision: campaignRevision }, 400);
  const chosen = await master(cpath + "/sheet-template", "PUT", { templateId: tid, revision: campaignRevision });
  check(chosen.sheetTemplateId, tid);
  check((await player(cpath + "/sheet-template")).source, "campaign");
  await master(cpath + "/sheet-template", "PUT", { templateId: null, revision: campaignRevision }, 409);

  // ---------- Criação pelo modelo e fallback livre ----------
  const lysara = await player("/api/characters", "POST", { campaignId: campaign.id, values: { nome: "Lysara", classe: "Mago" } });
  check(lysara.templateVersionId, v1, "ficha nasce na versão atual do modelo da campanha");
  await player("/api/characters", "POST", { campaignId: campaign.id, values: { classe: "Bardo", nome: "X" } }, 400);
  await player("/api/characters", "POST", { campaignId: campaign.id, values: {} }, 400);
  await outsider("/api/characters", "POST", { campaignId: campaign.id, values: { nome: "Intruso" } }, 404);
  let sheet = await player(`/api/characters/${lysara.id}/sheet`);
  check([sheet.template.id, sheet.version.number, sheet.version.hasPdf, sheet.version.pdfUrl, sheet.template.isDefault], [tid, 1, true, `/api/sheet-templates/${tid}/versions/${v1}/pdf`, true]);
  check([sheet.values.nome, sheet.values.forca, sheet.values.classe, sheet.computed.forca_mod, sheet.newerVersion], ["Lysara", "14", "Mago", "2", null]);
  check(sheet.actions.map((a) => [a.id, a.source]), [["t:espada", "template"]]);
  ok(
    (await master(cpath)).characters.some((c) => c.id === lysara.id && c.hp === 10 && c.maxHp === 10),
    "ficha nascida pela campanha já vinculada, com colunas espelhadas",
  );
  const classic = await player("/api/characters", "POST", {
    name: "Tharion", archetype: "Guerreiro", level: 3, hp: 20, maxHp: 25, strength: 16, agility: 12, intellect: 10, constitution: 14, armor: 12, movement: 9, notes: "Antigo", revision: 0,
  });
  check(classic.templateVersionId, FREE_V1, "cliente antigo cai no modelo livre");
  const classicSheet = await player(`/api/characters/${classic.id}/sheet`);
  check([classicSheet.template.id, classicSheet.values.nome, classicSheet.values.vida_max, classicSheet.computed.forca_mod, classicSheet.legacy], [FREE_TEMPLATE, "Tharion", "25", "3", false]);

  // ---------- Ficha antiga: leitura sem persistir, conversão na primeira escrita ----------
  sql(`UPDATE "Characters" SET "TemplateVersionId"=NULL, "Values"='{}' WHERE "Id"='${classic.id}'`);
  const legacy = await player(`/api/characters/${classic.id}/sheet`);
  check([legacy.legacy, legacy.values.arquetipo, legacy.values.notas, legacy.version.id], [true, "Guerreiro", "Antigo", FREE_V1]);
  check(sql(`SELECT coalesce("TemplateVersionId"::text,'null') || '|' || "Values" FROM "Characters" WHERE "Id"='${classic.id}'`), "null|{}", "leitura não persiste");
  const converted = await player(`/api/characters/${classic.id}/sheet`, "PUT", { values: { forca: "18" }, revision: classic.revision });
  check([converted.legacy, converted.values.forca, converted.computed.forca_mod], [false, "18", "4"]);
  check(sql(`SELECT "TemplateVersionId"::text || '|' || "Strength" FROM "Characters" WHERE "Id"='${classic.id}'`), `${FREE_V1}|18`);
  check(sql(`SELECT count(*) FROM "FieldChanges" WHERE "CharacterId"='${classic.id}'`), "1", "conversão não gera histórico falso");

  // ---------- Validação por tipo, calculados ignorados, 409 ----------
  let rev = sheet.revision;
  for (const values of [{ nivel: "21" }, { nivel: "2.5" }, { forca: "abc" }, { apelido: "longo demais aqui" }, { historia: "x".repeat(51) }, { vivo: "talvez" }, { classe: "Bardo" }, { nome: " " }, { forca: { a: 1 } }])
    await player(`/api/characters/${lysara.id}/sheet`, "PUT", { values, revision: rev }, 400);
  sheet = await player(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { forca_mod: "99", fantasma: "x", forca: 20, vivo: false, apelido: "Lys" }, revision: rev });
  check([sheet.computed.forca_mod, sheet.values.forca, sheet.values.vivo, "forca_mod" in sheet.values, "fantasma" in sheet.values], ["5", "20", "false", false, false]);
  await player(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { forca: "12" }, revision: rev }, 409);
  rev = sheet.revision;
  sheet = await player(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { nome: "Lysara Vento", nivel: "7", pv: "30", pv_max: "18" }, revision: rev });
  check([sheet.values.pv, sheet.values.pv_max], ["18", "18"], "vida limitada à vida máxima");
  const listed = (await player("/api/characters")).find((c) => c.id === lysara.id);
  check([listed.name, listed.level, listed.hp, listed.maxHp], ["Lysara Vento", 7, 18, 18], "papéis espelhados nas colunas clássicas");
  // PUT antigo continua funcionando e mantém os valores coerentes.
  const viaClassic = await player(`/api/characters/${lysara.id}`, "PUT", {
    name: "Lysara", archetype: "", level: 8, hp: 15, maxHp: 18, strength: 10, agility: 10, intellect: 10, constitution: 10, armor: 10, movement: 9, notes: "", revision: sheet.revision,
  });
  sheet = await player(`/api/characters/${lysara.id}/sheet`);
  check([sheet.values.nome, sheet.values.nivel, sheet.values.pv, sheet.values.forca, viaClassic.revision], ["Lysara", "8", "15", "20", sheet.revision]);

  // ---------- Histórico por campo ----------
  const history = await player(`/api/characters/${lysara.id}/field-history`);
  ok(history.total >= 8 && history.items.length <= 15 && history.pageSize === 15, "histórico paginado");
  const forcaHistory = await player(`/api/characters/${lysara.id}/field-history?field=forca`);
  check(forcaHistory.items.map((h) => [h.oldValue, h.newValue, h.source, h.label, h.changedBy]), [["14", "20", "edit", "Campo forca", "Lia"]]);
  await player(`/api/characters/${lysara.id}/field-history?field=Robert'); DROP`, "GET", undefined, 400);
  noEmail(history, "histórico por campo");

  // ---------- Mesa: ações com @campos e fórmula antiga; mestre ----------
  sheet = await player(`/api/characters/${lysara.id}/sheet`, "PUT", {
    actions: [
      { id: "velho", name: "Adaga", kind: "ataque", formula: "1d3 + 2", description: "" },
      { id: "raio", name: "Raio", kind: "magia", formula: "if @nivel>5 then 2d6+@forca_mod else 1d6", description: "" },
    ],
    revision: sheet.revision,
  });
  check(sheet.actions.map((a) => a.id), ["t:espada", "velho", "raio"]);
  await player(`/api/characters/${lysara.id}/sheet`, "PUT", { actions: [{ name: "Erro", kind: "magia", formula: "1d6 + @nada" }], revision: sheet.revision }, 400);
  const session = await master(cpath + "/sessions", "POST", { title: "Sessão 1", objective: "Segredo", mapKind: "tileset", mapKey: "crypt" });
  const s = "/api/sessions/" + session.id;
  await player(s + "/join", "POST", { characterId: lysara.id }, 204);
  await master(s + "/join", "POST", {}, 204);
  const playerLive = await player(s + "/live");
  check(playerLive.me.character.templateId, tid);
  ok(playerLive.me.character.actions.some(a => a.id === "t:espada"), "live character exposes template actions to the owning player");
  await master(s + "/turn/next", "POST", undefined, 204);
  const espada = await player(s + "/actions", "POST", { kind: "ataque", actionId: "t:espada", target: "Goblin" });
  check([espada.roll.total - espada.roll.values[0], espada.roll.modifier, espada.roll.formula], [5, 5, "1d20 + @forca_mod"], "ação do modelo usa @forca_mod da ficha");
  const adaga = await player(s + "/actions", "POST", { kind: "ataque", actionId: "velho" });
  ok(adaga.roll.formula === "1d3+2" && adaga.roll.total >= 3 && adaga.roll.total <= 5, "fórmula antiga rolada como antes");
  const raio = await player(s + "/actions", "POST", { kind: "magia", actionId: "raio" });
  check([raio.roll.values.length, raio.roll.total - raio.roll.values[0] - raio.roll.values[1]], [2, 5], "if/then/else com @nivel");
  ok(raio.message.includes("Lysara usou Raio"), "mensagem da ação");
  await player(s + "/actions", "POST", { kind: "magia", actionId: "t:espada" }, 404);

  const masterView = await master(s + "/characters/" + lysara.id);
  check([masterView.hp, masterView.sheet.computed.forca_mod, masterView.sheet.values.classe, masterView.sheet.template.id], [15, "5", "Mago", tid]);
  noEmail(masterView, "ficha vista pelo mestre");
  check((await second(s + "/characters/" + lysara.id)).canEdit, false);
  await outsider(s + "/characters/" + lysara.id, "GET", undefined, 404);
  await master(s + "/characters/" + lysara.id + "/hp", "POST", { delta: -6, reason: "Flecha" });
  sheet = await player(`/api/characters/${lysara.id}/sheet`);
  check(sheet.values.pv, "9", "ajuste do mestre reflete no campo de vida");
  const hpHistory = await player(`/api/characters/${lysara.id}/field-history?field=pv`);
  check([hpHistory.items[0].source, hpHistory.items[0].sessionId, hpHistory.items[0].changedBy, hpHistory.items[0].newValue], ["master", session.id, "Vinícius", "9"]);
  const state = await master(s + "/live");
  check(state.participants.find((p) => p.characterId === lysara.id).hp, 9, "mesa ao vivo lê a coluna espelhada");
  sheet = await player(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { apelido: "Vento" }, revision: sheet.revision });
  const timeline = await master(s + "/history?kind=sheet");
  ok(timeline.events.some((e) => e.content.includes("Campo apelido Lys → Vento")), "linha do tempo usa o rótulo do campo");
  check((await player(`/api/characters/${lysara.id}/field-history?field=apelido`)).items[0].sessionId, session.id);
  await second(`/api/characters/${lysara.id}/field-history`, "GET", undefined, 404);
  await second(`/api/characters/${lysara.id}/history`, "GET", undefined, 404);
  await second(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { apelido: "Intruso" }, revision: sheet.revision }, 404);
  await master(`/api/characters/${lysara.id}/sheet`, "PUT", { private: true, revision: sheet.revision }, 403);
  sheet = await master(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { apelido: "Mestre" }, revision: sheet.revision });
  const actor = await master("/api/auth/me");
  const masterChange = (await player(`/api/characters/${lysara.id}/field-history?field=apelido`)).items[0];
  check([masterChange.changedById, masterChange.sessionId, masterChange.newValue], [actor.id, session.id, "Mestre"]);
  ok((await master(`/api/characters/${lysara.id}/history`)).some(v => v.changedById === actor.id && v.sessionId === session.id), "snapshot identifica ator e sessao");
  sheet = await player(`/api/characters/${lysara.id}/sheet`, "PUT", { private: true, revision: sheet.revision });
  await second(s + "/characters/" + lysara.id, "GET", undefined, 404);
  await second(`/api/characters/${lysara.id}/sheet`, "GET", undefined, 404);
  check((await second(s + "/live")).participants.find(p => p.characterId === lysara.id).hp, null);
  ok(!(await second(s + "/live")).events.some(e => e.kind === "sheet"), "historico de ficha privado mesmo quando compartilhada");
  sheet = await player(`/api/characters/${lysara.id}/sheet`, "PUT", { private: false, values: { apelido: "Vento" }, revision: sheet.revision });

  // ---------- Migração de versão ----------
  await player(`/api/characters/${lysara.id}/migration`, "GET", undefined, 409);
  const next = await admin(`/api/sheet-templates/${tid}/versions`, "POST", {});
  const v2Fields = v1Fields
    .filter((x) => !["apelido", "historia"].includes(x.name))
    .map((x) => (x.name === "classe" ? { ...x, type: "text", options: [] } : x.name === "vivo" ? { ...x, type: "number", default: "1" } : x));
  v2Fields.push(f("mana", "number", { default: "5" }, 10), f("alcunha", "text", {}, 11));
  const d2 = await admin(`/api/sheet-templates/${tid}/versions/${next.id}`, "PUT", { pages: page, fields: v2Fields, actions: actionsV1, notes: "v2", revision: next.revision });
  await admin(`/api/sheet-templates/${tid}/versions/${next.id}/publish`, "POST", { revision: d2.revision });
  sheet = await player(`/api/characters/${lysara.id}/sheet`);
  check([sheet.version.id, sheet.newerVersion.id, sheet.newerVersion.number], [v1, next.id, 2], "ficha fica presa na versão e avisa a nova");
  const preview = await player(`/api/characters/${lysara.id}/migration`);
  const names = (list) => list.map((x) => x.name).sort();
  check([names(preview.added), names(preview.removed), names(preview.changed)], [["alcunha", "mana"], ["apelido", "historia"], ["classe", "vivo"]]);
  check(preview.changed.map((x) => [x.name, x.fromType, x.toType, x.newValue, x.reason]).sort(), [["classe", "select", "text", "Mago", "type"], ["vivo", "checkbox", "number", "1", "reset"]]);
  ok(names(preview.kept).includes("forca") && preview.values.mana === "5", "prévia traz mantidos e valores finais");
  check(sql(`SELECT "TemplateVersionId"::text FROM "Characters" WHERE "Id"='${lysara.id}'`), v1, "prévia não altera a ficha");
  await player(`/api/characters/${lysara.id}/migration`, "POST", { targetVersionId: next.id, revision: sheet.revision - 1 }, 409);
  await player(`/api/characters/${lysara.id}/migration`, "POST", { targetVersionId: v1, revision: sheet.revision }, 409);
  await outsider(`/api/characters/${lysara.id}/migration`, "POST", { targetVersionId: next.id, revision: sheet.revision }, 404);
  const migrated = await player(`/api/characters/${lysara.id}/migration`, "POST", { targetVersionId: next.id, revision: sheet.revision });
  check([migrated.sheet.version.id, migrated.sheet.values.mana, migrated.sheet.values.classe, "apelido" in migrated.sheet.values, migrated.sheet.newerVersion], [next.id, "5", "Mago", false, null]);
  const removedHistory = await player(`/api/characters/${lysara.id}/field-history?field=apelido`);
  check([removedHistory.items[0].source, removedHistory.items[0].oldValue, removedHistory.items[0].newValue, removedHistory.items[0].templateVersionId], ["migration", "Vento", "", next.id]);
  check(removedHistory.total, 5, "histórico do campo removido preservado, incluindo edição do mestre e restauração");
  await player(`/api/characters/${lysara.id}/migration`, "GET", undefined, 409);
  ok((await master(s + "/history?kind=sheet")).events.some((e) => e.content.includes("Versão do modelo v1 → v2")), "migração na linha do tempo");

  // ---------- PDF e versão antiga continuam legíveis para quem tem a ficha ----------
  const oldVersion = await player(`/api/sheet-templates/${tid}/versions/${v1}`);
  check([oldVersion.number, oldVersion.hasPdf, oldVersion.fields.length], [1, true, 10]);
  const oldPdf = await player(`/api/sheet-templates/${tid}/versions/${v1}/pdf`, "GET", undefined, 200, { raw: true });
  ok(String(oldPdf.data).startsWith("%PDF"), "PDF de fundo da versão antiga");
  const draft3 = await admin(`/api/sheet-templates/${tid}/versions`, "POST", {});
  await player(`/api/sheet-templates/${tid}/versions/${draft3.id}`, "GET", undefined, 404);
  await master(`/api/sheet-templates/${tid}/versions/${v1}`, "GET", undefined, 200);

  // GET /me cannot mutate activity. Only the explicit CSRF-protected POST may update it.
  sql(`UPDATE "AspNetUsers" SET "LastSeenAt"=NULL WHERE "Id"='${lysara.ownerId}'`);
  await player("/api/auth/me");
  check(sql(`SELECT count(*) FROM "AspNetUsers" WHERE "Id"='${lysara.ownerId}' AND "LastSeenAt" IS NULL`), "1");
  await player("/api/auth/activity", "POST", {}, 400, { csrf: false });
  await player("/api/auth/activity", "POST", {}, 204);
  check(sql(`SELECT count(*) FROM "AspNetUsers" WHERE "Id"='${lysara.ownerId}' AND "LastSeenAt" IS NOT NULL`), "1");

  // ---------- Autorização ----------
  await outsider(`/api/characters/${lysara.id}/sheet`, "GET", undefined, 404);
  check((await second(`/api/characters/${lysara.id}/sheet`)).canEdit, false);
  await outsider(`/api/characters/${lysara.id}/sheet`, "PUT", { values: { nome: "Hack" }, revision: 1 }, 404);
  await outsider(`/api/characters/${lysara.id}/field-history`, "GET", undefined, 404);
  await outsider(`/api/characters/${lysara.id}/migration`, "GET", undefined, 404);
  await player(`/api/characters/${lysara.id}/sheet`, "PUT", { values: {}, revision: 1 }, 400, { csrf: false });
  const anonymous = env.client();
  await anonymous(`/api/characters/${lysara.id}/sheet`, "GET", undefined, 401);
  noEmail(await player(`/api/characters/${lysara.id}/sheet`), "ficha");

  console.log(
    `PASS: ${env.count()} character sheet assertions with real PostgreSQL. Template-born sheets, free fallback, legacy conversion, typed validation, computed fields, role mirroring, field history, 409, migration preview/apply, table actions with @fields, master HP, authorization and old-version PDF verified.`,
  );
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await env.stop();
}
