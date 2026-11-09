import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleTemplateFormulaFields, referenceSuggestions } from '../apps/Eternnus.Web/wwwroot/js/sheet-editor-policy.js';

test('simple template attributes use the same names the server generates', () => {
  const fields = simpleTemplateFormulaFields([
    { title: 'Recursos', fields: [{ label: 'Vida', type: 'number' }, { label: 'Força Física', type: 'number' }, { label: 'Conceito', type: 'text' }] },
    { title: 'Mais', fields: [{ label: 'Vida', type: 'number' }, { label: '9 Vidas', type: 'number' }, { label: 'Nome', type: 'number' }] },
  ]);
  // "Nome" é reservado ao campo de nome criado pelo servidor quando falta um texto "Nome".
  assert.deepEqual(fields.map((f) => f.name), ['vida', 'forca_fisica', 'vida_2', 'campo_9_vidas', 'nome_2']);
  assert.equal(fields[1].label, 'Força Física');
});

test('suggestions appear right after @ and filter by prefix', () => {
  const names = ['forca', 'forca_mod', 'destreza'];
  assert.deepEqual(referenceSuggestions('1d20 + @', 8, names).items, names);
  assert.deepEqual(referenceSuggestions('1d20 + @for', 11, names).items, ['forca', 'forca_mod']);
  assert.equal(referenceSuggestions('1d20 + 3', 8, names).start, -1);
});
