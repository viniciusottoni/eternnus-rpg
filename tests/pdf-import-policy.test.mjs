import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchPdfValues, coerceValue, canImportPdf, importFileProblem, normalizeName} from '../apps/Eternnus.Web/wwwroot/js/pdf-import-policy.js';

const fields = [
  {name:'nome', label:'Personagem', type:'text', page:0, x:.1, y:.1, w:.4, h:.04},
  {name:'forca', label:'Força', type:'number', page:0, x:.1, y:.2, w:.1, h:.04, min:0, max:30},
  {name:'notas', label:'Equipamento', type:'textarea', page:1, x:.1, y:.1, w:.8, h:.3},
  {name:'treinado', label:'Treinado', type:'checkbox', page:0, x:.6, y:.2, w:.03, h:.02},
  {name:'classe', label:'Classe', type:'select', page:0, x:.6, y:.1, w:.3, h:.04, options:['Guerreiro','Arcanista']},
  {name:'defesa', label:'Defesa', type:'computed', page:0, x:.3, y:.2, w:.1, h:.04, formula:'10'},
];
const w = (page, x, y, ww, h, value, name='') => ({page, rect:{x, y, w:ww, h}, value, name});

test('widgets casam pela posição na mesma página e respeitam o tipo do campo', () => {
  const result = matchPdfValues(fields, [
    w(0, .11, .105, .38, .03, '  Aria  '),
    w(0, .11, .205, .08, .03, '14'),
    w(0, .605, .202, .02, .016, true),
    w(0, .61, .105, .28, .03, 'guerreiro'),
    w(0, .31, .205, .08, .03, '99'),
  ]);
  assert.deepEqual({...result.values}, {nome:'Aria', forca:'14', treinado:'true', classe:'Guerreiro'});
  assert.equal(result.imported, 4); assert.deepEqual(result.rejected, []);
  assert.equal(Object.getPrototypeOf(result.values), null);
});

test('vários widgets dentro de um texto longo são unidos em ordem de leitura; página errada não casa', () => {
  const result = matchPdfValues(fields, [
    w(1, .12, .2, .7, .03, 'Escudo'),
    w(1, .12, .12, .7, .03, 'Espada'),
    w(0, .12, .12, .7, .03, 'outra página'),
  ]);
  assert.equal(result.values.notas, 'Espada\nEscudo');
  assert.equal(result.values.nome, undefined);
});

test('sem posição correspondente, casa pelo nome normalizado do campo ou do rótulo', () => {
  const result = matchPdfValues(fields, [w(3, .9, .9, .01, .01, 'Lin', 'PERSONAGEM'), w(0, .9, .9, .01, .01, '12', 'Força ')]);
  assert.deepEqual({...result.values}, {nome:'Lin', forca:'12'});
  assert.equal(normalizeName('Pontos de Vida (PV)'), 'pontosdevidapv');
});

test('valores inválidos, vazios, desmarcados e calculados não são importados', () => {
  const result = matchPdfValues(fields, [
    w(0, .11, .205, .08, .03, 'muito forte'),
    w(0, .61, .105, .28, .03, 'Bardo'),
    w(0, .11, .105, .38, .03, '   '),
    w(0, .605, .202, .02, .016, false),
  ]);
  assert.deepEqual({...result.values}, {});
  assert.deepEqual(result.rejected, ['Força', 'Classe']);
  assert.equal(coerceValue(fields[1], '31'), null);
  assert.equal(coerceValue(fields[1], '2,5'), '2,5');
  assert.equal(coerceValue({type:'text', maxLength:3}, 'abcdef'), 'abc');
  assert.equal(coerceValue({type:'text'}, 'a\nb'), 'a b');
});

test('importação só no modelo padrão com PDF e edição; arquivo precisa ser PDF até 25 MB', () => {
  const sheet = {template:{isDefault:true}, version:{pdfUrl:'/api/x'}};
  assert.equal(canImportPdf(sheet, true), true);
  assert.equal(canImportPdf(sheet, false), false);
  assert.equal(canImportPdf({...sheet, template:{isDefault:false}}, true), false);
  assert.equal(canImportPdf({...sheet, version:{pdfUrl:null}}, true), false);
  assert.equal(importFileProblem({size:10, type:'application/pdf'}), '');
  assert.match(importFileProblem({size:10, type:'image/png'}), /PDF/);
  assert.match(importFileProblem({size:26 * 1024 * 1024, type:'application/pdf'}), /25 MB/);
  assert.match(importFileProblem(null), /PDF/);
});
