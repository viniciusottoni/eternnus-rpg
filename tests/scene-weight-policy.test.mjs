import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_LIMITS, WARN_SHARE, sceneWeight } from '../apps/Eternnus.Web/wwwroot/js/scene-weight-policy.js';

const read = (path) => readFile(new URL(`../apps/Eternnus.Web/${path}`, import.meta.url), 'utf8');

test('limites são os mesmos que o servidor impõe', async () => {
  const fog = await read('Domain/TableFog.cs');
  const prep = await read('Domain/ScenePreparation.cs');
  assert.equal(SCENE_LIMITS.walls, Number(fog.match(/MaxWalls = (\d+)/)[1]));
  assert.equal(SCENE_LIMITS.lights, Number(fog.match(/MaxLights = (\d+)/)[1]));
  assert.equal(SCENE_LIMITS.marks, Number(fog.match(/MaxMarks = (\d+)/)[1]));
  assert.equal(SCENE_LIMITS.tokens, Number(prep.match(/MaxTokens = (\d+)/)[1]));
});

test('avisa a partir de 80% do limite, o mais próximo primeiro', () => {
  assert.equal(sceneWeight({}).heavy, false);
  assert.equal(sceneWeight({ lights: 79 }).heavy, false);
  const w = sceneWeight({ lights: 80, tokens: 60, walls: 10 });
  assert.equal(w.heavy, true);
  assert.match(w.text, /^Cena pesada: 60 de 60 marcadores, 80 de 100 focos de luz\./);
  assert.equal(WARN_SHARE, 0.8);
});

test('valores inválidos contam zero', () => {
  assert.equal(sceneWeight({ walls: 'abc', lights: -5, tokens: null }).heavy, false);
  assert.equal(sceneWeight({ walls: 1999.9 }).items.find((i) => i.key === 'walls').count, 1999);
});
