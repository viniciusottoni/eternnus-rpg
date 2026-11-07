/**
 * Integração das fichas-modelo com PostgreSQL real: políticas (comum 403/404, embaixador e admin), criação, rascunho,
 * salvamento com revisão (409), validação estrutural (400 com lista), upload/remoção/serviço do PDF de fundo, publicação
 * (validação de fórmulas, diff, imutabilidade), nova versão, republicação pelo admin, modelo do Sistema livre e auditoria.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5301 });
const { check, ok, sql } = env;
const FREE_SYSTEM = "00000000-0000-4000-8000-000000000001";
const FREE_TEMPLATE = "00000000-0000-4000-8000-000000000101";
const FREE_V1 = "00000000-0000-4000-8000-000000000102";
const A4 = { width: 595.28, height: 841.89 };
const pdf = await readFile(join(import.meta.dirname, "fixtures/library/manual.pdf"));
const fake = await readFile(join(import.meta.dirname, "fixtures/library/falso.pdf"));

function pdfForm(bytes, { pages = [{ width: 595, height: 842 }, { width: 595, height: 842 }], revision, name = "ficha.pdf", type = "application/pdf", field = "pdf" } = {}) {
  const form = new FormData();
  if (pages !== null) form.append("pages", typeof pages === "string" ? pages : JSON.stringify(pages));
  if (revision !== undefined) form.append("revision", String(revision));
  form.append(field, new Blob([bytes], { type }), name);
  return form;
}
const field = (name, type, extra = {}) => ({ name, label: name.toUpperCase(), type, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.04, ...extra });

try {
  const common = await env.verifiedClient("comum.fichas@example.test", "Caio");
  const ambassador = await env.verifiedClient("embaixador.fichas@example.test", "Bento");
  const admin = await env.verifiedClient("admin.fichas@example.test", "Ada");
  sql(`UPDATE "AspNetUsers" SET "Role"='ambassador' WHERE "Email"='embaixador.fichas@example.test'`);
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='admin.fichas@example.test'`);
  await env.authenticateMfa(admin, "admin.fichas@example.test");

  // Modelo embutido do Sistema livre: publicado, sem PDF, com os campos-contrato da ficha clássica.
  const published = await common("/api/sheet-templates");
  check(published[0].id, FREE_TEMPLATE);
  check([published[0].isDefault, published[0].currentVersion.id], [true, FREE_V1]);
  const freeV1 = await common(`/api/sheet-templates/${FREE_TEMPLATE}/versions/${FREE_V1}`);
  check([freeV1.hasPdf, freeV1.isDraft, freeV1.pages.length], [false, false, 1]);
  ok(["nome", "nivel", "vida", "vida_max", "deslocamento", "armadura", "forca_mod", "notas"].every((n) => freeV1.fields.some((f) => f.name === n)), "free template keeps contract names");
  check(freeV1.fields.find((f) => f.name === "vida").role, "hp");
  await common(`/api/sheet-templates/${FREE_TEMPLATE}/versions/${FREE_V1}/pdf`, "GET", undefined, 404);
  const freeDetail = await common("/api/sheet-templates/" + FREE_TEMPLATE);
  check(freeDetail.versions, undefined);

  // Usuário comum: nada de gestão.
  await common("/api/sheet-templates/manage", "GET", undefined, 403);
  await common("/api/sheet-templates", "POST", { systemId: FREE_SYSTEM, name: "Pirata", description: "" }, 403);
  await common(`/api/sheet-templates/${FREE_TEMPLATE}/versions`, "POST", {}, 403);

  // Criação pelo embaixador: validação, nome único por sistema.
  await ambassador("/api/sheet-templates", "POST", { systemId: FREE_SYSTEM, name: " ", description: "" }, 400);
  await ambassador("/api/sheet-templates", "POST", { systemId: crypto.randomUUID(), name: "X", description: "" }, 400);
  await ambassador("/api/sheet-templates", "POST", { systemId: FREE_SYSTEM, name: "x".repeat(101), description: "" }, 400);
  const created = await ambassador("/api/sheet-templates", "POST", { systemId: FREE_SYSTEM, name: "Ficha do Explorador", description: "Para campanhas de exploração." });
  ok(created.id && created.draftId, "create returns template and draft ids");
  await ambassador("/api/sheet-templates", "POST", { systemId: FREE_SYSTEM, name: "Ficha do Explorador", description: "" }, 409);
  const T = created.id;
  const D = created.draftId;
  const draftUrl = `/api/sheet-templates/${T}/versions/${D}`;

  // Rascunho é invisível para o comum (404), visível na gestão.
  await common("/api/sheet-templates/" + T, "GET", undefined, 404);
  await common(draftUrl, "GET", undefined, 404);
  ok(!(await common("/api/sheet-templates")).some((t) => t.id === T), "draft-only template is not listed to common users");
  const manage = await ambassador(`/api/sheet-templates/manage?systemId=${FREE_SYSTEM}`);
  const row = manage.items.find((t) => t.id === T);
  check([row.draft.id, row.currentVersion, row.versionCount], [D, null, 1]);
  check(manage.pageSize, 20);
  let draft = await ambassador(draftUrl);
  check([draft.isDraft, draft.hasPdf, draft.pages.length, draft.fields.length], [true, false, 1, 0]);
  check(draft.pages[0].width, A4.width);

  // Segundo rascunho no mesmo modelo é recusado.
  await ambassador(`/api/sheet-templates/${T}/versions`, "POST", {}, 409);

  // Salvar campos: estrutura inválida → 400 com lista de problemas apontando os campos.
  const bad = await ambassador(
    draftUrl,
    "PUT",
    { pages: [A4], fields: [field("Força", "number"), field("vida", "number", { x: 0.95 }), field("vida", "text")], actions: [], notes: "", revision: draft.revision },
    400,
  );
  ok(Array.isArray(bad.errors) && bad.errors.length >= 3, "structure errors are listed");
  ok(bad.errors.some((e) => e.field === "vida" && /fora da página/.test(e.message)), "error points to the field");
  ok(bad.errors.some((e) => /repetido/.test(e.message)), "duplicate name reported");

  const fields = [
    field("nome", "text", { role: "name", maxLength: 80 }),
    field("forca", "number", { y: 0.2, default: "12", min: 1, max: 30 }),
    field("forca_mod", "computed", { y: 0.3, formula: "floor((@forca - 10) / 2)" }),
    field("vida", "number", { y: 0.4, role: "hp", default: "8" }),
    field("vida_max", "number", { y: 0.5, role: "maxHp", default: "8" }),
    field("classe", "select", { y: 0.6, options: ["Guerreiro", "Ladino"], default: "Ladino" }),
    field("inspirado", "checkbox", { y: 0.7, default: "false" }),
  ];
  const actions = [{ key: "espada", name: "Espada", kind: "ataque", formula: "1d20 + @forca_mod", description: "Corte simples." }];
  const saved = await ambassador(draftUrl, "PUT", { pages: [A4], fields, actions, notes: "Primeira versão.", revision: draft.revision });
  check(saved.revision, draft.revision + 1);
  // Revisão desatualizada → 409, sem alterar nada.
  const stale = await ambassador(draftUrl, "PUT", { pages: [A4], fields: [], actions: [], notes: "", revision: draft.revision }, 409);
  ok(/outra sessão/.test(stale.message), "409 explains the conflict");
  draft = await ambassador(draftUrl);
  check(draft.fields.length, 7);
  check(draft.revision, saved.revision);
  check(draft.fields.find((f) => f.name === "forca_mod").formula, "floor((@forca - 10) / 2)");
  // Normalização do servidor: fórmula some de campo não calculado, rótulo vazio vira o nome.
  const normalized = await admin(draftUrl, "PUT", { pages: [A4], fields: [...fields, field("extra", "text", { label: "", formula: "1+1" })], actions, notes: "Primeira versão.", revision: draft.revision });
  draft = await ambassador(draftUrl);
  const extra = draft.fields.find((f) => f.name === "extra");
  check([extra.label, extra.formula], ["extra", null]);
  check(draft.revision, normalized.revision);

  // PDF de fundo: comum não envia; formulário errado, tipo falso, páginas inválidas e revisão velha são recusados.
  const pdfUrl = draftUrl + "/pdf";
  await common(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision }), 403);
  await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision, field: "file" }), 400);
  await ambassador(pdfUrl, "PUT", pdfForm(pdf, {}), 400);
  await ambassador(pdfUrl, "PUT", pdfForm(fake, { revision: draft.revision }), 415);
  await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision, pages: "[]" }), 400);
  await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision, pages: [{ width: 10, height: 10 }] }), 400);
  await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision - 1 }), 409);
  await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision }), 400, { csrf: false });
  const uploaded = await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: draft.revision }));
  check([uploaded.hasPdf, uploaded.revision, uploaded.pages.length, uploaded.pages[1].height], [true, draft.revision + 1, 2, 842]);
  draft = await ambassador(draftUrl);
  check([draft.hasPdf, draft.fields.length], [true, 8]);
  // Servir o PDF: inline, sandbox, nosniff; rascunho só para a equipe.
  const served = await ambassador(pdfUrl, "GET", undefined, 200, { raw: true });
  check(served.headers.get("content-type"), "application/pdf");
  check(served.headers.get("content-disposition"), null);
  ok(/sandbox/.test(served.headers.get("content-security-policy") || ""), "pdf has CSP sandbox");
  check(served.headers.get("x-content-type-options"), "nosniff");
  ok(String(served.data).startsWith("%PDF-1.4"), "pdf bytes are served");
  await common(pdfUrl, "GET", undefined, 404);
  // Remover e reenviar (arquivo órfão é apagado).
  const filesBefore = Number(sql(`SELECT count(*) FROM "Files"`));
  const removed = await ambassador(pdfUrl, "DELETE");
  check([removed.hasPdf, removed.pages.length], [false, 2]);
  check(Number(sql(`SELECT count(*) FROM "Files"`)), filesBefore - 1);
  await ambassador(pdfUrl, "DELETE", undefined, 404);
  await ambassador(pdfUrl, "GET", undefined, 404);
  const again = await ambassador(pdfUrl, "PUT", pdfForm(pdf, { revision: removed.revision }));
  check(again.hasPdf, true);
  draft = await ambassador(draftUrl);

  // Publicar: fórmula inválida bloqueia (400 com o campo); revisão velha → 409; comum → 403.
  const broken = fields.map((f) => (f.name === "forca_mod" ? { ...f, formula: "floor(@forca - " } : f));
  const brokenSave = await ambassador(draftUrl, "PUT", { pages: draft.pages, fields: broken, actions: [...actions, { key: "x", name: "X", kind: "magia", formula: "1d7 + @desconhecido" }], notes: "", revision: draft.revision });
  const refused = await ambassador(draftUrl + "/publish", "POST", { revision: brokenSave.revision }, 400);
  ok(refused.errors.some((e) => e.field === "forca_mod"), "publish error points to the computed field");
  ok(refused.errors.some((e) => e.action === "x"), "publish error points to the action");
  const fixed = await ambassador(draftUrl, "PUT", { pages: draft.pages, fields, actions, notes: "Primeira versão.", revision: brokenSave.revision });
  await common(draftUrl + "/publish", "POST", { revision: fixed.revision }, 403);
  await ambassador(draftUrl + "/publish", "POST", { revision: fixed.revision - 1 }, 409);
  const pub1 = await ambassador(draftUrl + "/publish", "POST", { revision: fixed.revision });
  check([pub1.number, pub1.diff.fromNumber, pub1.diff.added.length], [1, null, 7]);

  // Publicada: imutável e visível para o comum (com PDF).
  await ambassador(draftUrl, "PUT", { pages: draft.pages, fields, actions, notes: "", revision: fixed.revision + 1 }, 409);
  await ambassador(pdfUrl, "DELETE", undefined, 409);
  await ambassador(draftUrl, "DELETE", undefined, 409);
  const commonView = await common(draftUrl);
  check([commonView.isDraft, commonView.hasPdf, commonView.fields.length], [false, true, 7]);
  await common(pdfUrl, "GET", undefined, 200, { raw: true });
  const listed = await common(`/api/sheet-templates?systemId=${FREE_SYSTEM}`);
  ok(listed.some((t) => t.id === T && t.currentVersion.number === 1), "published template is listed to common users");
  const detail = await common("/api/sheet-templates/" + T);
  check([detail.currentVersion.id, detail.versions], [D, undefined]);

  // Nova versão a partir da publicada: clona campos, ações e PDF; diff ao publicar.
  const v2 = await ambassador(`/api/sheet-templates/${T}/versions`, "POST", {});
  check([v2.isDraft, v2.hasPdf, v2.fields.length, v2.actions.length, v2.pages.length], [true, true, 7, 1, 2]);
  const v2Url = `/api/sheet-templates/${T}/versions/${v2.id}`;
  const v2Fields = fields.filter((f) => f.name !== "inspirado").map((f) => (f.name === "forca" ? { ...f, label: "Força bruta", x: 0.15 } : f.name === "classe" ? { ...f, y: 0.65 } : f));
  v2Fields.push(field("deslocamento", "number", { y: 0.8, role: "movement", default: "9" }));
  const v2Saved = await ambassador(v2Url, "PUT", { pages: v2.pages, fields: v2Fields, actions, notes: "Deslocamento.", revision: v2.revision });
  const manageDetail = await admin("/api/sheet-templates/" + T);
  check([manageDetail.draftId, manageDetail.versions.length, manageDetail.versions[0].isDraft], [v2.id, 2, true]);
  const pub2 = await admin(v2Url + "/publish", "POST", { revision: v2Saved.revision });
  check(pub2.number, 2);
  check([pub2.diff.fromNumber, pub2.diff.added, pub2.diff.removed, pub2.diff.moved], [1, ["deslocamento"], ["inspirado"], ["classe"]]);
  check(pub2.diff.changed, [{ name: "forca", changes: ["label"] }]);
  check(pub2.diff.pdfChanged, false);

  // Metadados com revisão; padrão do sistema; arquivar exige trocar o padrão antes.
  let meta = await ambassador("/api/sheet-templates/" + T);
  const metaSaved = await ambassador("/api/sheet-templates/" + T, "PUT", { name: "Ficha do Explorador", description: "Revisada.", isDefault: true, archived: false, revision: meta.revision });
  check(metaSaved.isDefault, true);
  await ambassador("/api/sheet-templates/" + T, "PUT", { name: "Ficha do Explorador", description: "", isDefault: true, archived: false, revision: meta.revision }, 409);
  await ambassador("/api/sheet-templates/" + T, "PUT", { name: "Ficha do Explorador", description: "", isDefault: true, archived: true, revision: metaSaved.revision }, 400);
  ok(!(await common("/api/sheet-templates")).find((t) => t.id === FREE_TEMPLATE).isDefault, "default moved away from the free template");
  const free = await admin("/api/sheet-templates/" + FREE_TEMPLATE);
  await admin("/api/sheet-templates/" + FREE_TEMPLATE, "PUT", { name: free.name, description: free.description, isDefault: false, archived: true, revision: free.revision }, 409);

  // Republicar versão antiga: somente admin.
  await ambassador(`/api/sheet-templates/${T}/versions/${D}/republish`, "POST", undefined, 403);
  const rep = await admin(`/api/sheet-templates/${T}/versions/${D}/republish`, "POST");
  check([rep.number, rep.diff.fromNumber, rep.diff.added], [3, 2, ["inspirado"]]);
  check((await common("/api/sheet-templates/" + T)).currentVersion.number, 3);

  // Rascunho descartável.
  const v4 = await ambassador(`/api/sheet-templates/${T}/versions`, "POST", { fromVersionId: v2.id });
  check(v4.fields.some((f) => f.name === "deslocamento"), true);
  await common(`/api/sheet-templates/${T}/versions/${v4.id}`, "DELETE", undefined, 403);
  await ambassador(`/api/sheet-templates/${T}/versions/${v4.id}`, "DELETE", undefined, 204);
  await ambassador(`/api/sheet-templates/${T}/versions/${v4.id}`, "GET", undefined, 404);

  // Auditoria: cada escrita da equipe registrada, sem e-mail, com os papéis certos.
  const audit = sql(`SELECT "Action" FROM "Audit" WHERE "TargetType"='sheet-template' AND "TargetId"='${T}' ORDER BY "Id"`).split("\n");
  for (const action of ["template.create", "template.version.update", "template.pdf.upload", "template.pdf.delete", "template.publish", "template.version.create", "template.update", "template.republish", "template.version.delete"])
    ok(audit.includes(action), "audit has " + action);
  check(audit.filter((a) => a === "template.publish").length, 2);
  check(Number(sql(`SELECT count(*) FROM "Audit" WHERE "TargetType"='sheet-template' AND "Data" LIKE '%@example%'`)), 0);
  const actors = sql(`SELECT DISTINCT u."Role" FROM "Audit" a JOIN "AspNetUsers" u ON u."Id" = a."ActorId" WHERE a."TargetType"='sheet-template' ORDER BY 1`).split("\n");
  check(actors, ["admin", "ambassador"]);
  const publishData = JSON.parse(sql(`SELECT "Data" FROM "Audit" WHERE "Action"='template.publish' AND "TargetId"='${T}' ORDER BY "Id" DESC LIMIT 1`));
  check(publishData.diff.added, ["deslocamento"]);
  // Rejeições (400/403/409) não deixam rastro de escrita.
  check(Number(sql(`SELECT count(*) FROM "Audit" WHERE "TargetType"='sheet-template' AND "Action"='template.version.update' AND "TargetId"='${T}'`)), 5);

  console.log(`PASS: ${env.count()} sheet template assertions with real PostgreSQL. Policies, drafts, 409, PDF upload/serve/remove, publish validation, diff, new version, republish, free template and audit verified.`);
} catch (error) {
  console.error(env.logs().slice(-6000));
  throw error;
} finally {
  await env.stop();
}
