/**
 * Integração da biblioteca geral com PostgreSQL real: leitura por usuário comum, publicação por embaixador
 * (PDF/PNG/JPEG), validação de tipo real (415) e tamanho (413), cabeçalhos de download, edição com revisão (409),
 * substituição de arquivo, exclusão lógica, histórico, reversão/restauração pelo admin e trilha de auditoria.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { startEnvironment, password } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5204 });
const { check, ok, sql } = env;
const fixtures = join(import.meta.dirname, "fixtures/library");
const FREE_SYSTEM = "00000000-0000-4000-8000-000000000001";
const fixture = (name) => readFile(join(fixtures, name));
const text = (bytes) => new TextDecoder().decode(bytes);

function upload(bytes, name, type, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([bytes], { type }), name);
  return form;
}
/**
 * Envio bruto por node:http: o Kestrel responde 413 e fecha a conexão antes de ler um corpo acima do limite,
 * e o fetch do Node descarta essa resposta (EPIPE). Aqui a resposta é lida assim que chega.
 */
async function rawSession(email) {
  const jar = new Map();
  const keep = (response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrf = async () => {
    const response = await fetch(env.origin + "/api/auth/csrf", { headers: { Cookie: cookie() } });
    keep(response);
    return (await response.json()).token;
  };
  const login = await fetch(env.origin + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Eternnus": "1", "X-CSRF-TOKEN": await csrf(), Cookie: cookie() },
    body: JSON.stringify({ email, password }),
  });
  keep(login);
  if (!login.ok) throw new Error("raw login failed " + login.status);
  const token = await csrf();
  return async (path, form) => {
    const serialized = new Request(env.origin, { method: "POST", body: form });
    const body = Buffer.from(await serialized.arrayBuffer());
    return new Promise((resolve, reject) => {
      let settled = false;
      const req = httpRequest(env.origin + path, {
        method: "POST",
        headers: {
          "Content-Type": serialized.headers.get("content-type"),
          "Content-Length": body.length,
          "X-Eternnus": "1",
          "X-CSRF-TOKEN": token,
          Cookie: cookie(),
        },
      });
      req.on("response", (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          settled = true;
          resolve({ status: response.statusCode, data: data ? JSON.parse(data) : null });
        });
      });
      req.on("error", (error) => {
        if (!settled && !["EPIPE", "ECONNRESET"].includes(error.code)) reject(error);
      });
      req.end(body);
    });
  };
}
const meta = (extra = {}) => ({
  title: "Manual do Aventureiro",
  description: "Regras básicas para começar.",
  category: "rules",
  systemId: FREE_SYSTEM,
  ...extra,
});

try {
  const common = await env.verifiedClient("comum.biblioteca@example.test", "Caio");
  const ambassador = await env.verifiedClient("embaixador.biblioteca@example.test", "Bento");
  const admin = await env.verifiedClient("admin.biblioteca@example.test", "Ada");
  sql(`UPDATE "AspNetUsers" SET "Role"='ambassador' WHERE "Email"='embaixador.biblioteca@example.test'`);
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='admin.biblioteca@example.test'`);
  await env.authenticateMfa(admin, "admin.biblioteca@example.test");

  const pdf = await fixture("manual.pdf");
  const pdf2 = await fixture("manual-v2.pdf");
  const png = await fixture("mapa.png");
  const jpg = await fixture("retrato.jpg");
  const fake = await fixture("falso.pdf");

  // Usuário comum: lista vazia, não envia.
  check((await common("/api/library")).total, 0);
  await common("/api/library", "POST", upload(pdf, "manual.pdf", "application/pdf", meta()), 403);

  // Validação de metadados e do formulário antes de qualquer arquivo ser aceito.
  // (feito pelo admin para não gastar o limite de envios do embaixador: 10 a cada 5 minutos por usuário)
  await admin("/api/library", "POST", upload(pdf, "manual.pdf", "application/pdf", meta({ title: " " })), 400);
  await admin("/api/library", "POST", upload(pdf, "manual.pdf", "application/pdf", meta({ category: "spells" })), 400);
  await admin("/api/library", "POST", upload(pdf, "manual.pdf", "application/pdf", meta({ systemId: crypto.randomUUID() })), 400);

  // Embaixador publica PDF e PNG direto.
  const manual = await ambassador("/api/library", "POST", upload(pdf, "../segredos/Manual <v1>.pdf", "application/pdf", meta()));
  check(
    [manual.title, manual.fileName, manual.contentType, manual.size, manual.system, manual.createdBy, manual.category, manual.downloads],
    ["Manual do Aventureiro", "Manual v1.pdf", "application/pdf", pdf.length, "Sistema livre", "Bento", "rules", 0],
  );
  ok(!JSON.stringify(manual).includes("@"), "item has no e-mail");
  const map = await ambassador(
    "/api/library",
    "POST",
    upload(png, "mapa.exe", "application/octet-stream", meta({ title: "Mapa da Cripta", category: "map", systemId: "", description: "" })),
  );
  check([map.fileName, map.contentType, map.systemId, map.system], ["mapa.png", "image/png", null, null]);
  const portrait = await ambassador("/api/library", "POST", upload(jpg, "retrato.jpeg", "image/jpeg", meta({ title: "Retrato", category: "art" })));
  check(portrait.contentType, "image/jpeg");

  // Tipo real decide: HTML com extensão .pdf é recusado; tamanho acima de 25 MB também.
  const fakeResponse = await ambassador("/api/library", "POST", upload(fake, "manual.pdf", "application/pdf", meta()), 415);
  ok(/PDF, PNG, JPEG ou WebP/.test(fakeResponse.message), "415 explains accepted formats");
  const big = new Uint8Array(26 * 1024 * 1024);
  big.set(new TextEncoder().encode("%PDF-1.4\n"));
  const rawAmbassador = await rawSession("embaixador.biblioteca@example.test");
  const bigResponse = await rawAmbassador("/api/library", upload(big, "enorme.pdf", "application/pdf", meta()));
  check(bigResponse.status, 413);
  ok(/25 MB/.test(bigResponse.data.message), "413 explains the limit");
  // Pouco acima de 25 MB, mas dentro da margem multipart: barrado pela leitura do formulário.
  const edge = big.subarray(0, 25 * 1024 * 1024 + 4096);
  await ambassador("/api/library", "POST", upload(edge, "limite.pdf", "application/pdf", meta()), 413);
  check(Number(sql(`SELECT count(*) FROM "Library"`)), 3);

  // Leitura e filtros para o usuário comum.
  const listed = await common("/api/library");
  check(listed.total, 3);
  check(listed.pageSize, 20);
  check(listed.items[0].id, portrait.id);
  check((await common("/api/library?type=pdf")).items.map((x) => x.id), [manual.id]);
  check((await common("/api/library?type=image")).total, 2);
  check((await common("/api/library?q=CRIPTA")).items.map((x) => x.id), [map.id]);
  check((await common("/api/library?category=art")).items.map((x) => x.id), [portrait.id]);
  check((await common(`/api/library?systemId=${FREE_SYSTEM}`)).total, 2);
  check((await common("/api/library?systemId=none")).items.map((x) => x.id), [map.id]);
  check((await common("/api/library?page=2&pageSize=2")).items.length, 1);
  await common("/api/library?category=spells", "GET", undefined, 400);
  await common("/api/library?deleted=1", "GET", undefined, 403);
  check((await common("/api/library/" + manual.id)).fileName, "Manual v1.pdf");
  await common("/api/library/" + crypto.randomUUID(), "GET", undefined, 404);

  // Download: anexo com nome saneado, sandbox, nosniff, sem cache. GET não altera estado.
  const download = await common(`/api/library/${manual.id}/file`, "GET", undefined, 200, { raw: true });
  ok(/^attachment;/.test(download.headers.get("content-disposition")), "download is an attachment");
  ok(download.headers.get("content-disposition").includes("Manual v1.pdf"), "download keeps sanitized name");
  ok(/sandbox/.test(download.headers.get("content-security-policy")), "file has CSP sandbox");
  check(download.headers.get("x-content-type-options"), "nosniff");
  check(download.headers.get("content-type"), "application/pdf");
  ok(/no-store/.test(download.headers.get("cache-control")), "file is not cached");
  check(download.data, text(pdf));
  const inlineImage = await common(`/api/library/${map.id}/file?inline=1`, "GET", undefined, 200, { raw: true });
  check(inlineImage.headers.get("content-disposition"), null);
  ok(/sandbox/.test(inlineImage.headers.get("content-security-policy")), "inline image also sandboxed");
  const viewer = await common(`/api/library/${manual.id}/file?inline=1`, "GET", undefined, 200, { raw: true });
  check(viewer.headers.get("content-disposition"), null);
  check((await common("/api/library/" + manual.id)).downloads, 0);
  await common(`/api/library/${manual.id}/downloaded`, "POST", undefined, 204);
  check((await common("/api/library/" + manual.id)).downloads, 1);

  // Usuário comum não altera nada.
  await common("/api/library/" + manual.id, "PUT", { ...meta(), revision: manual.revision }, 403);
  await common(`/api/library/${manual.id}/file`, "PUT", upload(pdf2, "v2.pdf", "application/pdf"), 403);
  await common("/api/library/" + manual.id, "DELETE", { reason: "x" }, 403);
  await common(`/api/library/${manual.id}/history`, "GET", undefined, 403);
  await common(`/api/library/${manual.id}/restore`, "POST", undefined, 403);

  // Edição com revisão; revisão velha → 409. Download não altera a revisão.
  const edited = await ambassador("/api/library/" + manual.id, "PUT", {
    title: "Manual do Aventureiro (revisado)",
    description: "Agora com errata.",
    category: "rules",
    systemId: FREE_SYSTEM,
    revision: manual.revision,
  });
  check(edited.revision, manual.revision + 1);
  await ambassador("/api/library/" + manual.id, "PUT", { ...meta({ title: "Conflito" }), revision: manual.revision }, 409);
  await ambassador("/api/library/" + manual.id, "PUT", { ...meta({ title: "x".repeat(121) }), revision: edited.revision }, 400);

  // Substituir arquivo mantém o anterior para histórico/reversão.
  await ambassador(`/api/library/${manual.id}/file`, "PUT", upload(pdf2, "v2.pdf", "application/pdf", { revision: String(manual.revision) }), 409);
  const replaced = await ambassador(`/api/library/${manual.id}/file`, "PUT", upload(pdf2, "Manual v2.pdf", "application/pdf", { revision: String(edited.revision) }));
  check([replaced.fileName, replaced.size, replaced.revision], ["Manual v2.pdf", pdf2.length, edited.revision + 1]);
  check((await common(`/api/library/${manual.id}/file`, "GET", undefined, 200, { raw: true })).data, text(pdf2));
  check(Number(sql(`SELECT count(*) FROM "Files"`)), 4);
  const replaceAudit = JSON.parse(sql(`SELECT "Data" FROM "Audit" WHERE "Action"='library.file.replace' AND "TargetId"='${manual.id}'`));
  check(replaceAudit.previousFileName, "Manual v1.pdf");
  check(replaceAudit.newFileName, "Manual v2.pdf");
  ok(replaceAudit.previousFileId && replaceAudit.newFileId && replaceAudit.previousFileId !== replaceAudit.newFileId, "replace audit has both file ids");

  // Histórico (equipe) e reversão (somente admin, somente entradas do próprio item).
  const history = await ambassador(`/api/library/${manual.id}/history`);
  check(history.items.map((x) => x.action), ["library.file.replace", "library.update", "library.upload"]);
  check(history.items.map((x) => x.actor), ["Bento", "Bento", "Bento"]);
  const replaceEntry = history.items[0];
  check(replaceEntry.revertible, true);
  await ambassador(`/api/library/${manual.id}/revert`, "POST", { auditId: replaceEntry.id }, 403);
  await admin(`/api/library/${map.id}/revert`, "POST", { auditId: replaceEntry.id }, 404);
  await admin(`/api/library/${manual.id}/revert`, "POST", { auditId: history.items[2].id }, 400);
  const reverted = await admin(`/api/library/${manual.id}/revert`, "POST", { auditId: replaceEntry.id });
  check([reverted.fileName, reverted.size], ["Manual v1.pdf", pdf.length]);
  check((await common(`/api/library/${manual.id}/file`, "GET", undefined, 200, { raw: true })).data, text(pdf));
  const metadataRevert = await admin(`/api/library/${manual.id}/revert`, "POST", { auditId: history.items[1].id });
  check(metadataRevert.title, "Manual do Aventureiro");

  // Deduplicação: mesmo conteúdo reaproveita o arquivo armazenado.
  const copy = await admin("/api/library", "POST", upload(pdf, "copia.pdf", "application/pdf", meta({ title: "Cópia" })));
  check(Number(sql(`SELECT count(*) FROM "Files"`)), 4);
  ok(sql(`SELECT "Data" FROM "Audit" WHERE "Action"='library.upload' AND "TargetId"='${copy.id}'`).includes('"deduplicated":true'), "dedupe audited");

  // Exclusão lógica pelo embaixador, restauração pelo admin.
  await ambassador("/api/library/" + map.id, "DELETE", { reason: "Mapa duplicado", revision: map.revision }, 204);
  await ambassador("/api/library/" + map.id, "DELETE", {}, 409);
  await common("/api/library/" + map.id, "GET", undefined, 404);
  await common(`/api/library/${map.id}/file`, "GET", undefined, 404);
  await common(`/api/library/${map.id}/downloaded`, "POST", undefined, 404);
  ok(!(await common("/api/library")).items.some((x) => x.id === map.id), "deleted item hidden");
  const trash = await ambassador("/api/library?deleted=1");
  check(trash.items.map((x) => x.id), [map.id]);
  ok(trash.items[0].deletedAt, "trash shows deletedAt");
  await ambassador(`/api/library/${map.id}/restore`, "POST", undefined, 403);
  const restored = await admin(`/api/library/${map.id}/restore`, "POST");
  check(restored.deletedAt, null);
  check((await common("/api/library/" + map.id)).title, "Mapa da Cripta");
  await admin(`/api/library/${map.id}/restore`, "POST", undefined, 409);

  // Trilha de auditoria completa, com autor e alvo; nada de e-mail.
  const actions = sql(`SELECT "Action" || ':' || "TargetId" FROM "Audit" WHERE "TargetType"='library' ORDER BY "Id"`).split("\n");
  check(actions, [
    `library.upload:${manual.id}`,
    `library.upload:${map.id}`,
    `library.upload:${portrait.id}`,
    `library.update:${manual.id}`,
    `library.file.replace:${manual.id}`,
    `library.revert:${manual.id}`,
    `library.revert:${manual.id}`,
    `library.upload:${copy.id}`,
    `library.delete:${map.id}`,
    `library.restore:${map.id}`,
  ]);
  check(Number(sql(`SELECT count(*) FROM "Audit" WHERE "Data" LIKE '%@%'`)), 0);
  const actors = sql(`SELECT DISTINCT u."Role" FROM "Audit" a JOIN "AspNetUsers" u ON u."Id" = a."ActorId" ORDER BY 1`).split("\n");
  check(actors, ["admin", "ambassador"]);

  // CSRF continua obrigatório no multipart.
  await admin("/api/library", "POST", upload(png, "x.png", "image/png", meta()), 400, { csrf: false });

  console.log(`PASS: ${env.count()} library assertions with real PostgreSQL. Read/download, staff publish, 413/415, headers, 409, replace, revert, restore and audit verified.`);
} catch (error) {
  console.error(env.logs().slice(-6000));
  throw error;
} finally {
  await env.stop();
}
