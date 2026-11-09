import test from 'node:test';
import assert from 'node:assert/strict';
import { field, passwordField, button } from '../apps/Eternnus.Web/wwwroot/js/ui.js';
import { tip, helpButton } from '../apps/Eternnus.Web/wwwroot/js/help.js';

test('campos preservam chamadas antigas e associam requisitos sem perder descrições existentes', () => {
  const legacy = field('name', 'Nome', 'Ana & Lira', 'text', 'required maxlength="100"');
  assert.match(legacy, /id="f-name"/); assert.match(legacy, /value="Ana &amp; Lira"/); assert.match(legacy, /required maxlength="100"/);
  const withHelp = field('name', 'Nome', '', 'text', 'aria-describedby="status"', { hint: 'Até 100 <caracteres>.', help: 'campanhas.lista.papeis' });
  assert.match(withHelp, /aria-describedby="status f-name-hint"/);
  assert.match(withHelp, /id="f-name-hint">Até 100 &lt;caracteres&gt;\./);
  assert.match(withHelp, /<\/label><button[^>]+data-help="campanhas.lista.papeis"/);
  assert.doesNotMatch(withHelp, /<label[^>]*>[\s\S]*?<button[\s\S]*?<\/label>/);
});
test('senha mantém toggle e autocomplete com hint opcional descrito', () => {
  const html = passwordField('password', 'Senha', 'new-password', { hint: 'Use de 10 a 128 caracteres.' });
  assert.match(html, /type="password"/); assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /aria-describedby="f-password-hint"/); assert.match(html, /data-action="password-toggle"/);
  assert.match(html, /aria-label="Mostrar senha"/);
});
test('helpers escapam atributos e tooltip não aceita texto longo ou HTML', () => {
  assert.equal(tip('x'.repeat(81)), ''); assert.equal(tip('<img>'), '');
  assert.equal(tip('"Ajuda" & detalhes'), 'data-tip="&quot;Ajuda&quot; &amp; detalhes"');
  const html = helpButton('conta.acesso.social', '"><img src=x>');
  assert.match(html, /aria-label="Ajuda: &quot;&gt;&lt;img src=x&gt;"/);
  assert.doesNotMatch(html, /<img/);
});
test('indisponibilidade de paginação fica focável sem corromper aria-disabled já existente', () => {
  const native = button('← Anterior', 'campaign-page', 0, 'subtle', 'disabled');
  assert.match(native, /aria-disabled="true"/); assert.match(native, /data-tip="Você está no início da lista\."/);
  const described = button('← Anterior', 'campaign-page', 0, 'subtle', 'aria-disabled="true" data-tip="Início da lista"');
  assert.match(described, /aria-disabled="true"/); assert.doesNotMatch(described, /aria-aria/);
});
