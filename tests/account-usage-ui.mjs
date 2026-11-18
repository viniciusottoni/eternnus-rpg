// QA visual dos medidores de "Minha conta" (ADR-096): conta comum (barras) e embaixador (∞), desktop e celular.
import { chromium } from '../artifacts/qa-runtime/node_modules/playwright/index.mjs';
import { startEnvironment } from './support/harness.mjs';
import { mkdir } from 'node:fs/promises';
const dir = 'artifacts/qa/conta';
await mkdir(dir, { recursive: true });
const env = await startEnvironment({ port: 5268 });
const free = '00000000-0000-4000-8000-000000000001';
const errors = [];
let browser, failed = 0;
try {
  const common = await env.verifiedClient('usage.common@example.test', 'Aurora do Vale');
  const staff = await env.verifiedClient('usage.staff@example.test', 'Embaixadora');
  env.sql(`UPDATE "AspNetUsers" SET "Role"='ambassador' WHERE "Email"='usage.staff@example.test'`);
  await common('/api/campaigns', 'POST', { name: 'Crônicas', description: 'Teste.', rpgSystemId: free });
  await common('/api/campaigns', 'POST', { name: 'Vale', description: 'Teste.', rpgSystemId: free });
  for (let i = 0; i < 4; i++) await staff('/api/campaigns', 'POST', { name: `Mesa ${i}`, description: 'Teste.', rpgSystemId: free });
  const limits = await common('/api/auth/limits');
  if (limits.storage?.campaigns !== 2 || limits.storage.capacity !== 2 * 250 * 1024 * 1024) { failed++; console.log('✗ storage', JSON.stringify(limits.storage)); }
  const staffLimits = await staff('/api/auth/limits');
  if (staffLimits.campaignLimit !== null || staffLimits.activeCampaigns !== 4) { failed++; console.log('✗ staff', JSON.stringify(staffLimits)); }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [who, client] of [['comum', common], ['embaixador', staff]]) for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
    await context.addCookies(client.cookieHeader().split('; ').filter(Boolean).map((s) => { const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1), url: env.origin }; }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${env.origin}/#settings`);
    await page.waitForSelector('.usage-list', { timeout: 20000 });
    const info = await page.evaluate(() => ({
      meters: [...document.querySelectorAll('.usage [role=meter]')].map((m) => m.getAttribute('aria-valuetext')),
      values: [...document.querySelectorAll('.usage-row strong')].map((s) => s.textContent),
      widths: [...document.querySelectorAll('.usage-bar > span')].map((s) => s.style.width),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    const name = `${who}-${mobile ? 'mobile' : 'desktop'}`;
    const ok = !info.overflow && info.widths.every((w) => w.endsWith('%')) && (who === 'comum' ? info.values[0] === '2 / 3' : info.values[0] === '4 / ∞');
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name} ${JSON.stringify(info)}`);
    await page.locator('.usage').scrollIntoViewIfNeeded();
    await page.locator('.account-panel').screenshot({ path: `${dir}/${name}.png` });
    await context.close();
  }
  if (errors.length) { failed++; console.log('erros:', errors); }
} finally {
  await browser?.close();
  await env.stop?.();
}
process.exitCode = failed ? 1 : 0;
