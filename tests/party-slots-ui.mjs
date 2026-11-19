/**
 * Navegador (PostgreSQL real): mestre sozinho cria três personagens reservados pelo painel Personagens, coloca no mapa,
 * salva, reabre e ensaia a cena vendo por um reservado (ADR-110/111). Capturas em artifacts/qa-party-slots.
 */
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5391 });
const { check, ok } = env;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const systemId = "00000000-0000-4000-8000-000000000001";
const shots = join(process.cwd(), "artifacts", "qa-party-slots");
await mkdir(shots, { recursive: true });
let browser;
const errors = [];
try {
  const master = await env.verifiedClient("mestre.reservados@example.test", "Mestre");
  const campaign = await master("/api/campaigns", "POST", { name: "Sem jogadores", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  const scene = await master(`${path}/scenes`, "POST", { name: "Cripta", kind: "map", mapKey: "crypt", sharedText: "", privateNotes: "", order: 0 });
  check((await master(`${path}/party-slots`)).items.length, 0);

  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const mobile = viewport.width < 600;
    const context = await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: mobile });
    await context.addCookies(master.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(env.origin + "/");
    await page.waitForFunction(() => !!document.querySelector("#app, main"));
    // A abertura (3.000 ms) e esperas em primeiro plano deixam a página inerte: espera terminar.
    const idle = () => page.waitForFunction(() => !document.querySelector("#app")?.hasAttribute("aria-busy"), null, { timeout: 15000 });
    await idle();
    const open = async () => {
      await page.evaluate(({ cid, sid }) => { import("/js/scene-editor.js").then(({ openSceneEditor }) => { void openSceneEditor({ campaign: { id: cid, name: "Sem jogadores" }, sceneId: sid }); }); }, { cid: campaign.id, sid: scene.id });
      await page.locator(".scene-editor").waitFor();
      // Contexto Personagens: painel com a seção de reservados.
      await page.evaluate(() => document.querySelector('[data-ed-context="elements"]')?.click());
      await page.waitForFunction(() => !!document.querySelector('[data-action="se-slot-new"]'), null, { timeout: 15000 });
    };
    await open();
    const placed = () => page.evaluate(() => document.querySelectorAll(".se-slot.placed").length);

    if (!mobile) {
      // Três reservados: genérico, Mago e Arqueiro — uma ação cada, sem formulário.
      for (const id of ["", "mage", "archer"]) {
        // Espera o envio anterior terminar (botões voltam a ficar habilitados).
        await page.waitForFunction(() => [...document.querySelectorAll('[data-action="se-slot-new"]')].every((b) => b.getAttribute("aria-disabled") !== "true"));
        const before = await page.evaluate(() => document.querySelectorAll(".se-slot").length);
        await page.evaluate((a) => [...document.querySelectorAll('[data-action="se-slot-new"]')].find((b) => (b.dataset.id || "") === a).click(), id);
        await page.waitForFunction((n) => document.querySelectorAll(".se-slot").length > n, before, { timeout: 10000 }).catch(async (e) => {
          console.error("estado:", before, await page.evaluate(() => [document.querySelector(".scene-editor [role=status], .ed-status, .ed-message")?.textContent, document.querySelector(".se-slots")?.textContent?.slice(0, 300), [...document.querySelectorAll('[data-action="se-slot-new"]')].length]), errors);
          throw e;
        });
        await page.keyboard.press("Escape"); // sai da renomeação em linha
      }
      check(await page.evaluate(() => document.querySelectorAll(".se-slot").length), 3);
      // Colocar cada um: clica numa casa do mapa e usa "Colocar no cursor"; casas bloqueadas são recusadas e tenta outra.
      const board = await page.locator("#se-board canvas").first().boundingBox();
      let attempt = 0;
      while ((await placed()) < 3 && attempt < 60) {
        const fx = 0.25 + (attempt % 6) * 0.1, fy = 0.3 + Math.floor(attempt / 6) * 0.05;
        attempt++;
        await idle();
        await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("Control+d"); // desmarca: clique com seleção moveria o token
        await page.mouse.click(board.x + board.width * fx, board.y + board.height * fy);
        await page.evaluate(() => document.querySelector('.se-slot:not(.placed) [data-action="se-place-cursor"]')?.click());
        await page.waitForTimeout(80);
      }
      check(await placed(), 3);
      await page.screenshot({ path: join(shots, "01-tres-reservados.png") });
      // Desfazer e refazer a última colocação.
      await page.keyboard.press("Control+z");
      check(await placed(), 2);
      await page.keyboard.press("Control+y");
      check(await placed(), 3);
      await page.evaluate(() => document.querySelector('[data-action="se-save"]').click());
      await page.waitForFunction(() => /Preparação salva/.test(document.querySelector(".scene-editor")?.textContent || "") && !/Salvando…/.test(document.querySelector(".scene-editor")?.textContent || ""), null, { timeout: 15000 });
      await idle();
      const saved = await master(`${path}/scenes/${scene.id}`);
      check(saved.prepared.length, 3, JSON.stringify(saved.prepared));
      check(saved.prepared.filter((t) => t.slotId).length, 3);
      check(saved.slots.length, 3);
      ok(saved.prepared.every((t) => !t.characterId), "reservados salvos sem personagem real");
      await page.evaluate(() => document.querySelector(".scene-editor [data-ed-close], .scene-editor [data-action='ed-close']")?.click());
      await page.evaluate(() => document.querySelector(".scene-editor")?.remove());
      await open();
      await page.waitForFunction(() => document.querySelectorAll(".se-slot.placed").length === 3, null, { timeout: 15000 });
      ok(true, "reabrir mantém os três reservados posicionados");

      // Ensaiar: uma ação liga o ensaio; outra escolhe o reservado como observador.
      await page.evaluate(() => document.querySelector('[data-action="se-preview"]').click());
      await page.waitForFunction(() => !!document.querySelector("#se-viewer"), null, { timeout: 15000 });
      const option = await page.evaluate(() => [...document.querySelector("#se-viewer").options].find((o) => /Aventureiro|Mago|Arqueiro|reservado/i.test(o.textContent))?.value);
      ok(option != null, "reservado aparece como observador");
      await page.selectOption("#se-viewer", option);
      await page.waitForFunction(() => /Prévia real|mesmas regras/i.test(document.querySelector("#se-sim")?.textContent || ""), null, { timeout: 15000 });
      ok(/nada aqui vai para a mesa/i.test(await page.textContent("#se-sim")), "aviso de isolamento do ensaio");
      await page.screenshot({ path: join(shots, "02-ensaio-observador.png") });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => /Ensaiar cena/.test(document.querySelector('[data-action="se-preview"]')?.textContent || ""), null, { timeout: 10000 });
      const after = await master(`${path}/scenes/${scene.id}`);
      check(after.revision, saved.revision);
    } else {
      await page.waitForFunction(() => document.querySelectorAll(".se-slot").length === 3, null, { timeout: 15000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflow <= 1, `sem rolagem horizontal no celular (${overflow}px)`);
      const small = await page.evaluate(() => [...document.querySelectorAll('[data-action="se-slot-new"]')].filter((b) => b.checkVisibility() && b.getBoundingClientRect().height < 44).length);
      check(small, 0);
      await page.screenshot({ path: join(shots, "03-celular.png") });
    }
    await context.close();
  }
  check(errors.length, 0, errors.join(" | "));
  console.log(`party-slots-ui: ${env.count()} verificações (Chrome + PostgreSQL)`);
} finally {
  await browser?.close();
  await env.stop();
}
