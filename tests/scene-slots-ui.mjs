/**
 * Editor de cenas no navegador (PostgreSQL real), mestre sozinho: cria um personagem reservado, arrasta para o mapa,
 * redimensiona pelo menu "Ajustar tamanho", desfaz com Ctrl+Z, abre "Ensaiar cena", escolhe o reservado como observador
 * (prévia do servidor com viewerToken) e sai. Em 1366×768 e 390×844. Capturas em artifacts/qa-slots.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5294 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const systemId = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-slots");
await mkdir(shots, { recursive: true });
const browsers = [];

try {
  const master = await env.verifiedClient("ui.reservados@example.test", "Aurora");
  const campaign = await master("/api/campaigns", "POST", { name: "Ensaio solo", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;

  for (const [label, viewport, mobile] of [["desktop", { width: 1366, height: 768 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
    const scene = await master(`${path}/scenes`, "POST", { name: `Cripta ${label}`, kind: "map", mapKey: "crypt", sharedText: "", privateNotes: "", visionMode: "character", order: 0, revision: 0, prepared: [] });
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    browsers.push(browser);
    const context = await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce" });
    await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    // Pelo Gerenciador da Preparação, como o mestre faz: duplo clique na cena abre o editor.
    await page.goto(`${env.origin}/#campaign/${campaign.id}/prep/scenes`);
    await page.locator(`.px-item[data-key="scene:${scene.id}"]`).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector("#app").inert && !document.querySelector("#app").hasAttribute("aria-busy"), null, { timeout: 20000 });
    await page.locator(`.px-item[data-key="scene:${scene.id}"]`).dblclick();
    await page.locator(".scene-editor").waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector("#se-board canvas")?.width > 0, null, { timeout: 20000 });
    const editor = page.locator(".scene-editor");

    // Contexto Personagens e painel aberto.
    // O topo se compacta (ícones/segunda linha) enquanto mede; o clique vai direto ao botão do contexto.
    await page.evaluate(() => document.querySelector('.scene-editor [data-ed-context="elements"]')?.click());
    await page.waitForFunction(() => document.querySelector(".scene-editor")?.dataset.context === "elements", null, { timeout: 5000 });
    const openPanel = (id) => page.evaluate((id) => {
      const root = document.querySelector(".scene-editor");
      if (root.dataset.panels !== "open") root.querySelector('[data-ed="panels"]')?.click();
      const t = root.querySelector(`[data-ed-panel-toggle="${id}"]`);
      if (t && t.getAttribute("aria-expanded") !== "true") t.click();
    }, id);
    await openPanel("characters");
    const panel = editor.locator('[data-panel="characters"]');
    // 1 clique: cria o reservado (genérico, com renomear em linha).
    const add = panel.locator('[data-action="se-slot-new"]').first();
    await add.waitFor({ timeout: 20000 });
    const box = await add.boundingBox();
    if (mobile) ok(box.height >= 44, `alvo de toque do + reservado: ${box.height}px`);
    await add.click();
    const rename = panel.locator("[data-slot-rename]");
    await rename.waitFor();
    await rename.fill(`Batedor ${label}`);
    await rename.press("Enter");
    const item = panel.locator(`[data-se-char^="slot:"]`).first();
    await item.waitFor();
    await page.waitForFunction((name) => [...document.querySelectorAll('[data-panel="characters"] .se-slot')].some((li) => li.textContent.includes(name)), `Batedor ${label}`, { timeout: 10000 });
    ok(true, "reservado renomeado em linha");

    // Colocar no mapa: arrastar (desktop) ou "Colocar no cursor" após escolher uma casa pelo teclado (celular).
    const canvas = page.locator("#se-board canvas");
    const cb = await canvas.boundingBox();
    if (!mobile) {
      await item.dragTo(canvas, { targetPosition: { x: cb.width / 2, y: cb.height / 2 } });
    } else {
      await canvas.focus();
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await page.evaluate(() => document.querySelector("#se-board canvas").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: innerWidth / 2, clientY: 200 })));
      await item.locator('[data-action="se-place-cursor"]').click();
    }
    await page.waitForFunction(() => /coluna \d+/.test(document.querySelector('[data-panel="characters"] .se-slot')?.textContent || ""), null, { timeout: 10000 });
    await page.screenshot({ path: join(shots, `${label}-placed.png`) });

    // Ajustar tamanho pelo menu do token (botão direito no painel Estrutura evita depender da posição no canvas).
    await openPanel("structure");
    const structureItem = editor.locator('[data-panel="structure"] [data-item^="t"]').first();
    await structureItem.click({ button: "right" });
    // O submenu abre ao passar o ponteiro (e por cima do item pai).
    if (!(await page.locator('.ed-menu[aria-label="Ajustar tamanho"]').count())) await page.locator(".ed-menu-item", { hasText: "Ajustar tamanho" }).evaluate((b) => b.click());
    await page.locator('.ed-menu[aria-label="Ajustar tamanho"]').waitFor();
    await page.locator('.ed-menu[aria-label="Ajustar tamanho"] .ed-menu-item', { hasText: "Pequeno" }).click();
    ok(/Pequeno/.test(await page.locator(".ed-status, [role=status]").allTextContents().then((x) => x.join(" "))), "tamanho Pequeno aplicado");
    // Ctrl+Z desfaz o tamanho.
    await canvas.focus();
    await page.keyboard.press("Control+z");
    ok(/Desfeito/.test(await page.locator(".ed-status, [role=status]").allTextContents().then((x) => x.join(" "))), "Ctrl+Z desfez");

    // Ensaiar cena: banner, observador = reservado, prévia do servidor, sair.
    await editor.locator('[data-action="se-preview"]').click();
    const banner = page.locator("#se-sim");
    await banner.waitFor();
    ok((await banner.textContent()).includes("Ensaio — nada aqui vai para a mesa"), "aviso do ensaio");
    const select = banner.locator("#se-viewer");
    const options = await select.locator("option").allTextContents();
    ok(options.some((o) => o.includes(`Batedor ${label}`)), "reservado aparece como observador");
    const value = await select.locator("option", { hasText: `Batedor ${label}` }).getAttribute("value");
    const response = page.waitForResponse((r) => r.url().includes("/prep/preview-view") && r.request().method() === "POST", { timeout: 15000 });
    await select.selectOption(value);
    const res = await response;
    check(res.status(), 200);
    const sent = JSON.parse(res.request().postData());
    check(sent.viewerToken, 0);
    await page.waitForFunction(() => /Prévia real/.test(document.querySelector("#se-sim")?.textContent || ""), null, { timeout: 15000 });
    // Token de ensaio (funciona sem jogadores) e saída descartando.
    await banner.locator('[data-action="se-rh-add"]').click();
    ok((await select.locator("option").allTextContents()).some((o) => o.includes("Ensaio 1")), "token de ensaio como observador");
    await page.screenshot({ path: join(shots, `${label}-rehearsal.png`) });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#se-sim")?.hidden, null, { timeout: 5000 });
    // O token de ensaio não foi para o rascunho.
    ok(!(await editor.locator('[data-panel="structure"]').textContent()).includes("Ensaio 1"), "token de ensaio descartado");
    check(errors, []);
    await browser.close();
  }
  console.log(`scene-slots-ui: ${env.count()} verificações no navegador`);
} catch (error) {
  console.error(env.logs().slice(-3000));
  throw error;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await env.stop();
}
