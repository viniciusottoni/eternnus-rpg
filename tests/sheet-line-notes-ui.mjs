/**
 * Descrição por linha nas listas da ficha (ADR-122), no navegador com PostgreSQL real: uma lista de texto longo
 * mostra um botão por item (não um só no canto do campo), a linha descrita fica marcada, o botão abre só aquele
 * item e aplicar a descrição marca a linha. Capturas em artifacts/qa-sheet-notes.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5398 });
const { check, ok, sql } = env;
const shots = join(process.cwd(), "artifacts", "qa-sheet-notes");
await mkdir(shots, { recursive: true });
let browser;
const errors = [];
try {
  const admin = await env.verifiedClient("admin.linhas@example.test", "Ana Admin");
  sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='admin.linhas@example.test'`);
  await env.authenticateMfa(admin, "admin.linhas@example.test");
  const master = await env.verifiedClient("mestre.linhas@example.test", "Mestre");

  // Modelo com uma lista de várias linhas (nome com termo de lista: "poderes").
  const system = await admin("/api/admin/rpg-systems", "POST", { name: "Arton Linhas", description: "" });
  const created = await admin("/api/sheet-templates", "POST", { systemId: system.id, name: "Ficha Linhas", description: "" });
  const tid = created.id;
  const page = [{ index: 0, width: 595.28, height: 841.89 }];
  const fields = [
    { name: "nome", label: "Nome", type: "text", role: "name", maxLength: 100, page: 0, x: 0.1, y: 0.05, w: 0.4, h: 0.03, fontSize: 12, align: "left", options: [] },
    { name: "habilidades_poderes", label: "Habilidades e poderes", type: "textarea", maxLength: 2000, page: 0, x: 0.1, y: 0.12, w: 0.5, h: 0.2, fontSize: 12, align: "left", options: [] },
  ];
  let draft = await admin(`/api/sheet-templates/${tid}/versions/${created.draftId}`, "PUT", { pages: page, fields, actions: [], notes: "", revision: 1 });
  const pdf = await readFile(join(import.meta.dirname, "fixtures/library/manual.pdf"));
  const upload = new FormData();
  upload.append("pdf", new Blob([pdf], { type: "application/pdf" }), "modelo.pdf");
  upload.append("pages", JSON.stringify(page)); upload.append("revision", String(draft.revision));
  draft = await admin(`/api/sheet-templates/${tid}/versions/${created.draftId}/pdf`, "PUT", upload);
  await admin(`/api/sheet-templates/${tid}/versions/${created.draftId}/publish`, "POST", { revision: draft.revision });
  const tpl = await admin(`/api/sheet-templates/${tid}`);
  await admin(`/api/sheet-templates/${tid}`, "PUT", { name: "Ficha Linhas", description: "", isDefault: true, archived: false, revision: tpl.revision });

  const campaign = await master("/api/campaigns", "POST", { name: "Linhas", description: "", rpgSystemId: system.id });
  const hero = await master("/api/characters", "POST", { campaignId: campaign.id, values: { nome: "Vecthor" } });
  let sheet = await master(`/api/characters/${hero.id}/sheet`);
  sheet = await master(`/api/characters/${hero.id}/sheet`, "PUT", {
    values: { habilidades_poderes: "(HC) Abençoado\n(HC) Golpe Divino" }, revision: sheet.revision,
    notes: { "(hc) abençoado": "Soma o Carisma nos testes de resistência." },
  });

  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
  const page1 = await context.newPage();
  page1.on("pageerror", (e) => errors.push(e.message));
  await page1.goto(`${env.origin}/#character/${hero.id}`);
  const list = page1.locator(".ps-field.ps-has-line-notes");
  await list.waitFor({ timeout: 30000 });
  const notes = list.locator(".ps-line-note");
  check(await notes.count(), 2, "um botão de descrição por item da lista");
  check(await list.locator(".ps-note").count(), 0, "sem botão único no canto do campo");
  ok(await notes.nth(0).evaluate((b) => b.classList.contains("has-note")), "item descrito marcado na própria linha");
  ok(!(await notes.nth(1).evaluate((b) => b.classList.contains("has-note"))), "item sem descrição sem marca");
  check(await notes.nth(1).getAttribute("aria-label"), "Adicionar descrição a (HC) Golpe Divino (Habilidades e poderes)", "nome acessível com o item");
  // O botão de cada linha fica alinhado à linha dele.
  const tops = await notes.evaluateAll((all) => all.map((b) => Math.round(b.getBoundingClientRect().top)));
  ok(tops[1] > tops[0], `botões em linhas diferentes: ${tops}`);

  await list.hover();
  await notes.nth(1).click();
  await page1.locator(".notes-dialog[open]").waitFor();
  check(await page1.locator("#notes-dialog-title").textContent(), "Descrição: (HC) Golpe Divino", "popup abre só o item da linha");
  check(await page1.locator(".notes-dialog textarea").count(), 1, "um campo de descrição, do item clicado");
  await page1.locator(".notes-dialog textarea").fill("2 PM: soma o Carisma no dano.");
  await page1.getByRole("button", { name: "Aplicar descrições" }).click();
  await page1.locator(".notes-dialog[open]").waitFor({ state: "detached" }).catch(() => {});
  await page1.waitForFunction(() => document.querySelectorAll(".ps-has-line-notes .ps-line-note.has-note").length === 2);
  ok(true, "aplicar marca a linha descrita");
  await page1.screenshot({ path: join(shots, "01-linhas-1440.png") });

  // Salvar grava as duas descrições.
  await page1.getByRole("button", { name: "Salvar ficha" }).click();
  await page1.waitForFunction(async (id) => {
    const r = await fetch(`/api/characters/${id}/sheet`, { credentials: "include" });
    const s = await r.json();
    return Object.keys(s.notes || {}).length === 2;
  }, hero.id, { timeout: 15000 });
  ok(true, "descrições por linha salvas");
  check(errors, [], "sem erros de página");
  console.log("sheet-line-notes-ui: verificações passaram.");
} finally {
  await browser?.close();
  await env.stop();
}
