/**
 * Indicadores de novidade (ADR-069) com PostgreSQL real (porta 5341): público de cada aviso de campanha (jogadores, nunca o
 * autor, nunca quem está fora), Guilda por tópico, GET sem escrita, "visto" via POST com CSRF, e a interface: selo vermelho
 * no menu/cartão/abas/salão, item destacado e selo que some depois de ver a tela e sair dela (desktop e celular).
 */
import { startEnvironment } from "./support/harness.mjs";
import { chromium } from "../artifacts/qa-runtime/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const env = await startEnvironment({ port: 5341 });
const { check, ok } = env;
const TAVERNA = "00000000-0000-4000-8000-000000000202";
let browser;
try {
  const master = await env.verifiedClient("news.master@example.test", "Aurora");
  const player = await env.verifiedClient("news.player@example.test", "Lira");
  const outsider = await env.verifiedClient("news.outsider@example.test", "Outro");

  const c = await master("/api/campaigns", "POST", { name: "Crônicas das Novidades", description: "Teste", rpgSystemId: "00000000-0000-4000-8000-000000000001" });
  const path = `/api/campaigns/${c.id}`, base = path + "/workspace";
  await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
  check((await master(`/api/notices/campaigns/${c.id}`)).areas.players, 1, "mestre vê o novo integrante");
  check((await player(`/api/notices/campaigns/${c.id}`)).areas.players ?? 0, 0, "quem entrou não recebe aviso da própria entrada");

  await master(base + "/past-sessions", "POST", { number: 1, title: "Prólogo", summary: "O início.", published: true });
  await master(path + "/sessions", "POST", { title: "Abertura", objective: "", mapKind: "tileset", mapKey: "crypt" });
  const page = await master(base + "/pages", "POST", { title: "Porto do Luar", content: "Um porto seguro.", kind: "place", visibility: "table" });
  await master(base + "/pages", "POST", { title: "Segredo do mestre", content: "x", kind: "place" });

  const news = await player(`/api/notices/campaigns/${c.id}`);
  check([news.areas.table, news.areas.pages, news.areas.journal], [1, 1, 1], "mesa, página compartilhada e sessão publicada");
  ok(news.items.some((i) => i.key === page.id), "item da página");
  check((await master(`/api/notices/campaigns/${c.id}`)).areas.pages ?? 0, 0, "autor não recebe aviso");
  await outsider(`/api/notices/campaigns/${c.id}`, "GET", undefined, 404);
  const summary = await player("/api/notices");
  check([summary.home, summary.campaigns, summary.byCampaign[c.id]], [1, 3, 3]);
  check((await player("/api/notices")).campaigns, 3, "GET não consome novidades");

  // Guilda: tópico de outra pessoa é novidade; a própria resposta não acende nada para quem respondeu.
  const topic = await outsider("/api/guild/topics", "POST", { categoryId: TAVERNA, title: "Procuro mesa", body: "Alguém joga terror?" });
  const guildNews = await player("/api/notices");
  check([guildNews.guild, guildNews.guildCategories.taverna], [1, 1]);
  check((await outsider("/api/notices")).guild, 0);
  await player("/api/notices/seen", "POST", { scope: "everything" }, 400);
  await player("/api/notices/seen", "POST", { scope: "moderation" }, 403);

  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [];
  await mkdir("artifacts/qa/notices", { recursive: true });
  async function ui(client, mobile = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
    await context.addCookies(client.cookieHeader().split("; ").filter(Boolean).map((s) => { const i = s.indexOf("="); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  }
  async function go(p, route, text) {
    await p.goto(env.origin + "/#" + route);
    await p.getByText(text, { exact: true }).first().waitFor();
    await p.waitForFunction(() => !document.querySelector("#app").inert);
  }
  const navBadge = (p, label) => p.locator(`.sidebar nav a.nav-item:has-text("${label}") .news-badge`);

  const desk = await ui(player);
  await go(desk, "guild", "Salões da Guilda");
  await navBadge(desk, "Guilda").waitFor();
  check(await navBadge(desk, "Campanhas").locator("[aria-hidden=true]").innerText(), "3");
  await desk.locator(".guild-hall:has-text('Taverna') .news-badge").waitFor();
  await desk.locator(".guild-topic-list .guild-topic-row.is-new").waitFor();
  await desk.screenshot({ path: "artifacts/qa/notices/guild-desktop.png", fullPage: true, animations: "disabled" });

  await desk.locator(".guild-topic-list a", { hasText: "Procuro mesa" }).click();
  await desk.locator(".guild-post.is-new .new-pill").waitFor();
  await navBadge(desk, "Guilda").waitFor(); // continua enquanto a pessoa está na tela
  await go(desk, "campaigns", "Crônicas das Novidades");
  await desk.waitForFunction(() => !document.querySelector('.sidebar nav a.nav-item[href="#guild"] .news-badge'));
  check((await player("/api/notices")).guild, 0, "tópico lido ao abrir");
  check(await desk.locator(".campaign-row .news-badge [aria-hidden=true]").innerText(), "3");
  await desk.screenshot({ path: "artifacts/qa/notices/campaigns-desktop.png", fullPage: true, animations: "disabled" });

  await go(desk, `campaign/${c.id}/world`, "Porto do Luar");
  await desk.locator(".page-tabs a:has-text('Mundo e acervo') .news-badge").waitFor();
  await desk.locator(".page-tabs a:has-text('Diário') .news-badge").waitFor();
  await desk.locator("tr.is-new", { hasText: "Porto do Luar" }).waitFor();
  check(await desk.locator("tr.is-new", { hasText: "Segredo do mestre" }).count(), 0);
  await desk.screenshot({ path: "artifacts/qa/notices/campaign-world.png", fullPage: true, animations: "disabled" });
  await go(desk, `campaign/${c.id}/journal`, "Prólogo");
  await desk.locator("tr.is-new", { hasText: "Prólogo" }).waitFor();
  check(await desk.locator(".page-tabs a:has-text('Mundo e acervo') .news-badge").count(), 0, "aba vista perde o selo ao sair");
  const after = await player(`/api/notices/campaigns/${c.id}`);
  check([after.areas.pages ?? 0, after.areas.journal ?? 0, after.areas.table], [0, 0, 1]);

  await go(desk, "overview", "Próxima partida");
  await desk.locator(".resume-card.is-new").waitFor();
  await desk.screenshot({ path: "artifacts/qa/notices/home-desktop.png", fullPage: true, animations: "disabled" });

  // Celular: novo tópico; selo sobre o ícone da barra inferior, sem sobrepor conteúdo nem gerar rolagem lateral.
  await outsider("/api/guild/topics", "POST", { categoryId: TAVERNA, title: "Outra conversa", body: "Mais uma mensagem." });
  const mobile = await ui(player, true);
  await go(mobile, "campaigns", "Crônicas das Novidades");
  await navBadge(mobile, "Guilda").waitFor();
  const box = await navBadge(mobile, "Guilda").boundingBox();
  const item = await mobile.locator('.sidebar nav a.nav-item[href="#guild"]').boundingBox();
  ok(box && item && box.x >= item.x && box.x + box.width <= item.x + item.width + 1, "selo dentro do alvo de toque");
  ok(item.height >= 44, "alvo de 44 px preservado");
  ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "sem rolagem lateral");
  await mobile.screenshot({ path: "artifacts/qa/notices/mobile-nav.png", animations: "disabled" });

  check(errors, []);
  await writeFile("artifacts/qa/notices/result.json", JSON.stringify({ errors, topic: topic.id, passed: true }, null, 2));
  console.log(`notices: ${env.count()} verificações`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await browser?.close();
  await env.stop();
}
