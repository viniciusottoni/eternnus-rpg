import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isD20Sheet, rollFormulas, rollLabel, signed } from '../apps/Eternnus.Web/wwwroot/js/sheet-roll-policy.js';
import { summaryOf, compactModel, suggestUse, searchSheet, restorable } from '../apps/Eternnus.Web/wwwroot/js/sheet-compact-policy.js';
import { noteKey } from '../apps/Eternnus.Web/wwwroot/js/item-notes-policy.js';

const template = async (path) => JSON.parse(await readFile(new URL(`../docs/fichas/${path}`, import.meta.url), 'utf8')).fields;

test('rolar pela ficha: inferência só em fichas d20 e só em testes (modelos reais)', async () => {
  const t20 = rollFormulas(await template('tormenta20/tormenta20-ficha-v1.json'));
  for (const name of ['acrobacia', 'luta', 'pontaria', 'fortitude', 'reflexos', 'vontade', 'iniciativa', 'percepcao', 'forca_mod', 'carisma_mod']) assert.equal(t20.get(name), `1d20 + @${name}`, name);
  for (const name of ['defesa', 'pv_max', 'pm_atual', 'nivel', 'acrobacia_outros', 'acrobacia_atributo', 'forca', 'deslocamento']) assert.equal(t20.has(name), false, name);
  const dnd = rollFormulas(await template('dnd5e/dnd5e-ficha-v1.json'));
  for (const name of ['acrobacia', 'furtividade', 'resistencia_sabedoria', 'iniciativa', 'destreza_mod']) assert.ok(dnd.has(name), name);
  for (const name of ['proficiencia', 'classe_armadura', 'sabedoria_passiva', 'cd_magia', 'pv_atual']) assert.equal(dnd.has(name), false, name);
  const pf2 = rollFormulas(await template('pathfinder-2e/pathfinder-2e-ficha-v1.json'));
  assert.ok(pf2.has('atletismo') && pf2.has('percepcao'));
  assert.equal(pf2.has('ca') || pf2.has('cd_classe') || pf2.has('magia_cd'), false);
  // Sistemas sem atributos com modificador não inferem: o modelo define `roll`.
  for (const path of ['chamado-de-cthulhu/chamado-de-cthulhu-ficha-v1.json', 'ordem-paranormal/ordem-paranormal-ficha-v1.json', 'gurps-4e/gurps-4e-ficha-v1.json', 'vampiro-a-mascara-v5/vampiro-v5-ficha-v1.json']) {
    const fields = await template(path);
    assert.equal(isD20Sheet(fields), false, path);
    assert.equal(rollFormulas(fields).size, 0, path);
  }
});

test('rolar pela ficha: roll do modelo vale sobre a inferência; "" desliga; só números', () => {
  const fields = [
    { name: 'forca_mod', type: 'computed' }, { name: 'destreza_mod', type: 'computed' }, { name: 'constituicao_mod', type: 'computed' }, { name: 'sabedoria_mod', type: 'computed' },
    { name: 'luta', type: 'number', roll: '2d20kh1 + @luta' }, { name: 'iniciativa', type: 'number', roll: '' },
    { name: 'sanidade', type: 'number', roll: '1d100 <= @sanidade' }, { name: 'nome', type: 'text', roll: '1d20' },
  ];
  const map = rollFormulas(fields);
  assert.equal(map.get('luta'), '2d20kh1 + @luta');
  assert.equal(map.has('iniciativa'), false);
  assert.equal(map.get('sanidade'), '1d100 <= @sanidade');
  assert.equal(map.has('nome'), false);
  assert.equal(map.get('forca_mod'), '1d20 + @forca_mod');
  assert.equal(rollLabel({ label: '  Acrobacia  ' }), 'Acrobacia');
  assert.equal(rollLabel({ label: 'x'.repeat(80) }).length, 60);
  assert.deepEqual([signed(7), signed('-2'), signed(0), signed('abc')], ['+7', '−2', '0', 'abc']);
});

test('ficha compacta: recursos como o servidor, testes com valor e listas com descrições', () => {
  const fields = [
    { name: 'pv', label: 'PV', type: 'number', role: 'hp' }, { name: 'pv_max', type: 'number', role: 'maxHp' },
    { name: 'pm', label: 'PM', type: 'number', track: 'resource', maxField: 'pm_max' }, { name: 'pm_max', type: 'number' },
    { name: 'nivel', label: 'Nível', type: 'number', role: 'level' },
    { name: 'luta', label: 'Luta', type: 'number', roll: '1d20 + @luta' }, { name: 'furtividade', label: 'Furtividade', type: 'number', roll: '1d20 + @furtividade' },
    { name: 'magias', label: 'Magias', type: 'textarea' },
  ];
  const values = { pv: '7', pv_max: '12', pm: '3', pm_max: '10', nivel: '4', luta: '5', furtividade: '', magias: 'Bola de Fogo\n\nCurar Ferimentos' };
  const { resources, stats } = summaryOf(fields, values);
  assert.deepEqual(resources.map((r) => [r.field, r.value, r.max]), [['pv', 7, 12], ['pm', 3, 10]]);
  assert.deepEqual(stats, [{ field: 'nivel', label: 'Nível', value: '4' }]);
  const model = compactModel(fields, values, { [noteKey('Bola de Fogo')]: 'Custo: 3 PM. Dano 6d6.' });
  assert.deepEqual(model.rolls.map((r) => r.field), ['luta']);
  assert.deepEqual(model.lists[0].items.map((i) => [i.text, i.note]), [['Bola de Fogo', 'Custo: 3 PM. Dano 6d6.'], ['Curar Ferimentos', '']]);
  assert.deepEqual(compactModel([], {}), { resources: [], stats: [], rolls: [], lists: [] });
  // Reserva sem marcação: número com par "_max" (Tormenta20: pm_atual ↔ pm_max).
  const t20 = summaryOf([{ name: 'pv_atual', type: 'number', role: 'hp' }, { name: 'pv_max', type: 'number', role: 'maxHp' }, { name: 'pm_atual', label: 'PM atuais', type: 'number' }, { name: 'pm_max', type: 'number' }, { name: 'forca', type: 'number' }],
    { pv_atual: '5', pv_max: '9', pm_atual: '3', pm_max: '8', forca: '2' });
  assert.deepEqual(t20.resources.map((r) => [r.field, r.value, r.max]), [['pv_atual', 5, 9], ['pm_atual', 3, 8]]);
  assert.deepEqual(suggestUse('Custo: 2 PM', t20.resources), { formula: '', field: 'pm_atual', cost: 2 });
});

test('usar item: sugestão de rolagem e custo tirada da descrição', () => {
  const resources = [{ field: 'pv', label: 'Pontos de vida' }, { field: 'pm', label: 'Pontos de Mana' }];
  assert.deepEqual(suggestUse('Custo: 3 PM. Causa 6d6 de dano de fogo.', resources), { formula: '6d6', field: 'pm', cost: 3 });
  assert.deepEqual(suggestUse('Ataque 1d8 + 2, gasta 1 PV', resources), { formula: '1d8 + 2', field: 'pv', cost: 1 });
  assert.deepEqual(suggestUse('Role 2d20kh1 + @luta', resources), { formula: '2d20kh1 + @luta', field: '', cost: null });
  assert.deepEqual(suggestUse('Bônus de +2 por 3 rodadas', resources), { formula: '', field: '', cost: null });
  assert.deepEqual(suggestUse('', []), { formula: '', field: '', cost: null });
});

test('busca na ficha: rótulo, valor, linha da lista e descrição, sem acentos', () => {
  const fields = [{ name: 'nome', label: 'Nome', type: 'text' }, { name: 'magias', label: 'Magias', type: 'textarea' }, { name: 'pericias', label: 'Perícias', type: 'textarea' }];
  const values = { nome: 'Élan', magias: 'Luz\nBola de Fogo', pericias: '' };
  const notes = { [noteKey('Luz')]: 'Ilumina 9 metros' };
  assert.deepEqual(searchSheet(fields, values, notes, 'bola'), [{ field: 'magias', label: 'Magias', line: 1, text: 'Bola de Fogo', kind: 'value' }]);
  assert.equal(searchSheet(fields, values, notes, 'elan')[0].field, 'nome');
  assert.equal(searchSheet(fields, values, notes, 'PERICIA')[0].kind, 'label');
  assert.deepEqual(searchSheet(fields, values, notes, 'metros'), [{ field: 'magias', label: 'Magias', line: 0, text: 'Luz', kind: 'note' }]);
  assert.deepEqual(searchSheet(fields, values, notes, 'a'), []);
});

test('restaurar: só campos existentes, não calculados, sem descrições e sem valor cortado', () => {
  const fields = [{ name: 'pv', type: 'number' }, { name: 'total', type: 'computed' }];
  assert.equal(restorable({ field: 'pv', oldValue: '3' }, fields), true);
  assert.equal(restorable({ field: 'total', oldValue: '3' }, fields), false);
  assert.equal(restorable({ field: '@descricao', oldValue: 'x' }, fields), false);
  assert.equal(restorable({ field: 'sumiu', oldValue: 'x' }, fields), false);
  assert.equal(restorable({ field: 'pv', oldValue: 'x'.repeat(2000) }, fields), false);
});
