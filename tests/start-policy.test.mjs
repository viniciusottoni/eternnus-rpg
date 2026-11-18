import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessChecklist, startDefaults, startableScenes, startSceneKind, startPayload } from '../apps/Eternnus.Web/wwwroot/js/start-policy.js';

test('checklist sem jogadores: convite e fichas pendentes, cena opcional não bloqueia', () => {
  const { items, ready } = readinessChecklist({ members: [], characters: [], sceneCount: 0 });
  assert.deepEqual(items.map((i) => [i.key, i.done, i.optional]), [['invite', false, false], ['sheets', false, false], ['scene', false, true]]);
  assert.equal(ready, false);
});

test('checklist conta jogadores com ficha e fica pronto sem cena', () => {
  const d = { members: [{ id: 'a' }, { id: 'b' }], characters: [{ ownerId: 'a' }], sceneCount: 0 };
  let r = readinessChecklist(d);
  assert.equal(r.items[1].done, false);
  assert.match(r.items[1].detail, /1 de 2/);
  r = readinessChecklist({ ...d, characters: [{ ownerId: 'a' }, { ownerId: 'b' }, { ownerId: 'b' }], sceneCount: 2 });
  assert.equal(r.ready, true);
  assert.match(r.items[2].detail, /2 cenas prontas/);
  assert.equal(readinessChecklist({ members: [{ id: 'a' }], characters: [{ ownerId: 'a' }] }).ready, true);
});

test('checklist tolera detalhe incompleto (jogador ou erro de rede)', () => {
  assert.equal(readinessChecklist(null).items.length, 3);
  assert.equal(readinessChecklist({ members: 'x' }).ready, false);
});

test('padrão do modal: primeira cena; sem cena, primeiro tileset', () => {
  const maps = [{ key: 'valley', kind: 'cartographic' }, { key: 'crypt', kind: 'tileset' }];
  assert.deepEqual(startDefaults({ maps, scenes: [] }), { mode: 'map', sceneId: '', mapKey: 'crypt' });
  assert.deepEqual(startDefaults({ maps, scenes: [{ id: 's1' }, { id: 's2' }] }), { mode: 'scene', sceneId: 's1', mapKey: 'crypt' });
  assert.deepEqual(startDefaults({ maps: [{ key: 'valley', kind: 'cartographic' }] }), { mode: 'map', sceneId: '', mapKey: 'valley' });
  assert.deepEqual(startDefaults({}), { mode: 'map', sceneId: '', mapKey: '' });
  assert.deepEqual(startableScenes([null, { id: '' }, { id: 'ok' }]).map((s) => s.id), ['ok']);
});

test('rótulos de cena e corpo do POST', () => {
  assert.equal(startSceneKind('text'), 'Apresentação textual');
  assert.equal(startSceneKind('x'), 'Cena');
  assert.deepEqual(startPayload({ map: 'tileset|crypt', start: 'map', title: '  ', objective: '' }, null),
    { title: '', objective: '', mapKind: 'tileset', mapKey: 'crypt', sceneId: null, chapterId: null });
  assert.deepEqual(startPayload({ map: 'cartographic|asset:abc|x', start: 'scene-id', title: 'A Cripta' }, 'ch'),
    { title: 'A Cripta', objective: '', mapKind: 'cartographic', mapKey: 'asset:abc|x', sceneId: 'scene-id', chapterId: 'ch' });
  assert.equal(startPayload({}, undefined).mapKind, null);
});
