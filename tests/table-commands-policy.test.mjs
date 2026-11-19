import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tableCommands } from '../apps/Eternnus.Web/wwwroot/js/table-commands-policy.js';
import { rankCommands } from '../apps/Eternnus.Web/wwwroot/js/command-palette-policy.js';

const base = { isMaster: true, tiles: true, fogOn: true, complete: false, selected: null, undoId: null, ended: false };

test('toda ação aponta para um comando real do despacho da mesa', async () => {
  const source = await readFile(new URL('../apps/Eternnus.Web/wwwroot/js/table.js', import.meta.url), 'utf8');
  for (const c of [...tableCommands(base), ...tableCommands({ ...base, isMaster: false })])
    assert.ok(source.includes(`action === "${c.action}"`), `${c.id}: ${c.action}`);
});

test('ids únicos e formato completo', () => {
  const list = tableCommands(base);
  assert.equal(new Set(list.map((c) => c.id)).size, list.length);
  for (const c of list) assert.ok(typeof c.label === 'string' && c.group && typeof c.basic === 'boolean' && typeof c.masterOnly === 'boolean', c.id);
});

test('motivos de indisponibilidade: sem grade, sem seleção, sem desfazer, sessão encerrada', () => {
  const noGrid = tableCommands({ ...base, tiles: false });
  assert.match(noGrid.find((c) => c.id === 'gather').disabled, /grade/);
  assert.match(tableCommands(base).find((c) => c.id === 'tokenEdit').disabled, /Selecione/);
  assert.equal(tableCommands({ ...base, selected: { id: 't', characterId: null } }).find((c) => c.id === 'tokenEdit').disabled, null);
  assert.match(tableCommands(base).find((c) => c.id === 'undo').disabled, /Nada/);
  assert.deepEqual(tableCommands({ ...base, undoId: 42 }).find((c) => c.id === 'undo'), { ...tableCommands({ ...base, undoId: 42 }).find((c) => c.id === 'undo'), arg: '42', disabled: null });
  assert.ok(tableCommands({ ...base, ended: true }).filter((c) => c.id !== 'focusBoard').every((c) => c.disabled));
  assert.match(tableCommands({ ...base, fogOn: false }).find((c) => c.id === 'reveal').disabled, /névoa/);
});

test('jogador não vê ações do mestre; Básica marca ferramentas da Completa', () => {
  const player = rankCommands(tableCommands({ ...base, isMaster: false }), '', { role: 'player', mode: 'basic' });
  assert.ok(player.some((c) => c.id === 'mySheet'));
  assert.ok(!player.some((c) => c.id === 'gather' || c.id === 'walls'));
  const walls = rankCommands(tableCommands(base), 'parede', { role: 'master', mode: 'basic' });
  assert.equal(walls[0].id, 'walls');
  assert.equal(walls[0].needsComplete, true);
  assert.equal(rankCommands(tableCommands(base), 'reunir', { role: 'master', mode: 'basic' })[0].id, 'gather');
});

test('câmera compartilhada, exibição externa e convidados (ADR-114/115)', async () => {
  const { TOOL_INVENTORY } = await import('../apps/Eternnus.Web/wwwroot/js/scene-policy.js');
  const master = tableCommands(base);
  for (const id of ['showRegion', 'externalDisplay', 'guests']) {
    const c = master.find((x) => x.id === id);
    assert.ok(c && c.masterOnly && c.basic === false, id);
    assert.equal(TOOL_INVENTORY.find((t) => t.id === id)?.basic, false, `${id} no inventário como Completa`);
  }
  assert.match(tableCommands({ ...base, tiles: false }).find((c) => c.id === 'showRegion').disabled, /grade/);
  assert.equal(rankCommands(master, 'projetor', { role: 'master', mode: 'basic' })[0].id, 'externalDisplay');
  const player = tableCommands({ ...base, isMaster: false });
  assert.equal(player.find((c) => c.id === 'follow').label, 'Seguir o mestre');
  assert.equal(tableCommands({ ...base, isMaster: false, following: true }).find((c) => c.id === 'follow').label, 'Parar de seguir o mestre');
  assert.ok(player.some((c) => c.id === 'fitView'));
  assert.ok(!rankCommands(player, '', { role: 'player', mode: 'basic' }).some((c) => ['guests', 'showRegion', 'externalDisplay'].includes(c.id)));
});
