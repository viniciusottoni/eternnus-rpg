import test from 'node:test';
import assert from 'node:assert/strict';
import { validHelpKey, validTip, validHelpEntry, canReadHelp, catalogModule, safeHelpRoute } from '../apps/Eternnus.Web/wwwroot/js/help-policy.js';

test('chaves têm área conhecida e três segmentos estritos', () => {
  assert.equal(validHelpKey('mesa.rolagem.visibilidade'), true);
  for (const key of ['mesa.rolagem', 'outra.tela.item', 'Mesa.tela.item', 'mesa.tela.x/y', 'mesa..item', 'mesa.tela.-item', '__proto__.x.y']) assert.equal(validHelpKey(key), false, key);
  assert.equal(catalogModule('mesa.rolagem.visibilidade'), './help/mesa.js');
  assert.equal(catalogModule('mesa/../../x'), null);
});
test('texto curto não aceita marcação e mantém os limites', () => {
  assert.equal(validTip('á'.repeat(80)), true);
  for (const tip of ['', 'a'.repeat(81), '<img>', 'a\nb', null]) assert.equal(validTip(tip), false);
  const entry = { title: 'Tema', summary: 'Uma frase.', body: ['Parágrafo.', { list: ['Um', 'Dois'] }] };
  assert.equal(validHelpEntry(entry), true);
  for (const over of [{ title: '' }, { title: 'x'.repeat(81) }, { summary: 'x'.repeat(161) }, { body: ['<b>'] }, { body: [{ list: ['<img>'] }] }, { body: [{ html: 'x' }] }, { body: [] }, { audience: 'root' }, { route: 'https://example.com' }, { related: ['mesa.x'] }, { url: 'https://example.com' }]) assert.equal(validHelpEntry({ ...entry, ...over }), false, JSON.stringify(over));
});
test('audiência depende do papel global ou contexto explícito de recurso', () => {
  const player = { role: 'common' }, ambassador = { role: 'ambassador' }, admin = { role: 'admin' };
  assert.equal(canReadHelp('all', null), true);
  assert.equal(canReadHelp('player', player, { isPlayer: true }), true);
  assert.equal(canReadHelp('master', admin), false);
  assert.equal(canReadHelp('master', player, { isMaster: true }), true);
  assert.equal(canReadHelp('ambassador', player), false);
  assert.equal(canReadHelp('ambassador', ambassador), true);
  assert.equal(canReadHelp('ambassador', admin), true);
  assert.equal(canReadHelp('admin', ambassador), false);
  assert.equal(canReadHelp('admin', admin), true);
  assert.equal(canReadHelp('unknown', admin), false);
});
test('saiba mais aceita só rota interna segmentada', () => {
  assert.equal(safeHelpRoute('#campaign/a-b/settings'), true);
  for (const value of ['https://x', '#', '#x?token=x', '#x//y', '#x/<b>', '#x/%2e%2e', '#x/../y', '##x', null]) assert.equal(safeHelpRoute(value), false);
});
