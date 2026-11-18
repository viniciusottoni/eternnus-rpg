import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_PRESETS, TOKEN_LIGHT_PRESETS, VISION_PRESETS, CUSTOM, DEFAULT, presetText, lightPresetOf, tokenPresetOf, presetById } from '../apps/Eternnus.Web/wwwroot/js/light-presets-policy.js';

test('predefinições respeitam os limites que o servidor valida', () => {
  for (const p of LIGHT_PRESETS) { assert.ok(p.radius >= 1 && p.radius <= 30, p.id); assert.ok(p.dim >= p.radius && p.dim <= 30, p.id); }
  for (const p of TOKEN_LIGHT_PRESETS) assert.ok(p.light >= 0 && p.light <= 30, p.id);
  for (const p of VISION_PRESETS) assert.ok(p.vision >= 0 && p.vision <= 30, p.id);
  assert.equal(new Set(LIGHT_PRESETS.map((p) => p.id)).size, LIGHT_PRESETS.length);
  assert.ok(Object.isFrozen(LIGHT_PRESETS) && Object.isFrozen(LIGHT_PRESETS[0]));
});

test('reconhece a predefinição atual do foco de luz', () => {
  assert.equal(lightPresetOf(4, 8), 'torch');
  assert.equal(lightPresetOf('6', '12'), 'lantern');
  assert.equal(lightPresetOf(4, null), CUSTOM);
  assert.equal(lightPresetOf(7, 9), CUSTOM);
});

test('campos opcionais do marcador: vazio = padrão, valor conhecido = predefinição', () => {
  assert.equal(tokenPresetOf(TOKEN_LIGHT_PRESETS, 'light', ''), DEFAULT);
  assert.equal(tokenPresetOf(TOKEN_LIGHT_PRESETS, 'light', null), DEFAULT);
  assert.equal(tokenPresetOf(TOKEN_LIGHT_PRESETS, 'light', 0), 'off');
  assert.equal(tokenPresetOf(TOKEN_LIGHT_PRESETS, 'light', 4), 'torch');
  assert.equal(tokenPresetOf(VISION_PRESETS, 'vision', '12'), 'long');
  assert.equal(tokenPresetOf(VISION_PRESETS, 'vision', 3), CUSTOM);
  assert.equal(tokenPresetOf(VISION_PRESETS, 'vision', 'abc'), DEFAULT);
});

test('texto e busca por id', () => {
  assert.equal(presetText(LIGHT_PRESETS[0]), 'Vela — 1 casa, penumbra até 2');
  assert.equal(presetText(presetById(TOKEN_LIGHT_PRESETS, 'off')), 'Sem luz');
  assert.equal(presetText(presetById(VISION_PRESETS, 'short')), 'Visão no escuro curta — 6 casas');
  assert.equal(presetById(VISION_PRESETS, CUSTOM), null);
});
