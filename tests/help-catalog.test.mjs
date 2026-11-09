import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { HELP_AREAS, HELP_KEYS, validHelpKey, validHelpEntry, validTip, safeHelpRoute } from '../apps/Eternnus.Web/wwwroot/js/help-policy.js';
import { STATIC_PATHS } from '../apps/Eternnus.Web/wwwroot/js/pwa-policy.js';
const root = new URL('../apps/Eternnus.Web/wwwroot/', import.meta.url);
const catalog = {};
for (const area of HELP_AREAS) Object.assign(catalog, (await import(new URL(`js/help/${area}.js`, root))).default);
const files = (await readdir(new URL('js/', root))).filter((file) => file.endsWith('.js'));
const sources = await Promise.all(files.map(async (file) => [file, await readFile(new URL(`js/${file}`, root), 'utf8')]));

test('todas as referências literais e chaves de opções existem no catálogo', () => {
  const used = new Set();
  for (const [file, source] of sources) {
    if (file === 'help-policy.js') continue;
    for (const match of source.matchAll(/(?:helpButton\(\s*|\bhelp:\s*)["']([a-z][a-z0-9.-]+)["']/g)) {
      assert.ok(Object.hasOwn(catalog, match[1]), `${file}: ${match[1]}`); used.add(match[1]);
    }
  }
  for (const key of Object.keys(catalog)) assert.ok(used.has(key), `Ajuda sem ponto de acesso: ${key}`);
  assert.ok(used.size >= 65);
});
test('entradas, listas, exemplos, audiências e índice mantêm o contrato de texto puro', () => {
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(HELP_KEYS).sort());
  for (const [key, entry] of Object.entries(catalog)) {
    assert.ok(validHelpKey(key), key); assert.ok(validHelpEntry(entry), key);
    assert.equal(HELP_KEYS[key], entry.audience || 'all', key);
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.body), key);
    assert.ok(!JSON.stringify(entry).includes('<'), key);
    if (entry.route) assert.ok(entry.route.startsWith('#') && safeHelpRoute(entry.route), key);
    for (const related of entry.related || []) assert.ok(Object.hasOwn(catalog, related), related);
  }
});
test('não há title nativo de interface; exceções permitidas: nenhuma', async () => {
  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /(?<![\w.-])title=["']/, `${file}: atributo title`);
    assert.doesNotMatch(source, /(?:control|toggle|volumeButton|element|el)\.title\s*=/, `${file}: propriedade title de DOM`);
    assert.doesNotMatch(source, /setAttribute\(\s*["']title["']/, file);
  }
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.doesNotMatch(html, /\btitle\s*=/);
});
test('tooltips literais respeitam os 80 caracteres e não escondem requisitos', () => {
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/\btip\(\s*(["'])(.*?)\1\s*\)/g)) assert.ok(validTip(match[2]), `${file}: ${match[2]}`);
    for (const match of source.matchAll(/\bdata-tip="([^"$]*)"/g)) assert.ok(validTip(match[1]), `${file}: ${match[1]}`);
  }
});
test('shell e catálogos públicos são enumerados; nenhum caminho de API é adicionado', async () => {
  for (const name of ['help', 'help-policy', ...HELP_AREAS.map((area) => `help/${area}`)]) assert.ok(STATIC_PATHS.includes(`/js/${name}.js`), name);
  assert.ok(STATIC_PATHS.every((path) => !path.startsWith('/api/')));
  for (const path of STATIC_PATHS) await readFile(new URL(path.slice(1), root));
});
