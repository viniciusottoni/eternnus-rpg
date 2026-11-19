import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../apps/Eternnus.Web/wwwroot/js/grid-align-policy.js', import.meta.url), 'utf8');
const P = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

/** Imagem RGBA sintética: fundo com ruído leve e linhas escuras a cada `side` px a partir de (ox, oy). */
function gridImage(width, height, side, ox, oy, { noise = 6, line = 40 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const onLine = (x - ox) % side === 0 && x >= ox || (y - oy) % side === 0 && y >= oy;
    const v = onLine ? line : 170 + Math.round((rand() - .5) * noise * 2);
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return data;
}

test('dois cantos de uma casa dão lado e deslocamento, em qualquer ordem', () => {
  const r = P.fromCell({ x: 142, y: 90 }, { x: 110, y: 58 });
  assert.equal(r.gridPixels, 32);
  assert.equal(r.gridOffsetX, 110 % 32);
  assert.equal(r.gridOffsetY, 58 % 32);
  assert.deepEqual(r.warnings, []);
});

test('casa não quadrada avisa e pontos próximos são recusados', () => {
  const r = P.fromCell({ x: 0, y: 0 }, { x: 40, y: 30 });
  assert.equal(r.gridPixels, 35);
  assert.equal(r.warnings.length, 1);
  assert.match(P.fromCell({ x: 0, y: 0 }, { x: 2, y: 2 }).error, /próximos/);
  assert.match(P.fromCell(null, { x: 2, y: 2 }).error, /cantos/);
});

test('lado fora de 8–1024 px é recusado com orientação', () => {
  assert.match(P.fromCell({ x: 0, y: 0 }, { x: 5, y: 5 }).error, /8 a 1\.024/);
});

test('N casas entre dois cruzamentos: lado, deslocamento e desvio acumulado', () => {
  const r = P.fromSpan({ x: 37, y: 21 }, { x: 37 + 5 * 50, y: 21 }, 5);
  assert.equal(r.gridPixels, 50);
  assert.equal(r.gridOffsetX, 37);
  assert.equal(r.gridOffsetY, 21);
  assert.equal(r.drift, 0);
  const odd = P.fromSpan({ x: 0, y: 0 }, { x: 0, y: 505 }, 10);
  assert.equal(odd.gridPixels, 51);
  assert.equal(odd.drift, 5);
  assert.equal(odd.warnings.length, 0, 'desvio de 5 px em casas de 51 px fica abaixo de 1/4 da casa');
  const long = P.fromSpan({ x: 0, y: 0 }, { x: 5050, y: 0 }, 100);
  assert.equal(long.drift, 50);
  assert.ok(long.warnings.some((w) => /desvia 50 px/.test(w)));
});

test('trecho com pontos desalinhados ou contagem inválida', () => {
  const r = P.fromSpan({ x: 0, y: 0 }, { x: 300, y: 80 }, 6);
  assert.ok(r.warnings.some((w) => /mesma linha/.test(w)));
  assert.match(P.fromSpan({ x: 0, y: 0 }, { x: 300, y: 0 }, 0).error, /1 a 100/);
  assert.match(P.fromSpan({ x: 0, y: 0 }, { x: 300, y: 0 }, 101).error, /1 a 100/);
});

test('deslocamento negativo ou além do lado volta ao intervalo 0..lado-1', () => {
  const r = P.fromSpan({ x: 130, y: 95 }, { x: 130, y: 95 + 120 }, 3);
  assert.equal(r.gridPixels, 40);
  assert.equal(r.gridOffsetX, 10);
  assert.equal(r.gridOffsetY, 15);
});

test('período e fase de picos regulares', () => {
  const profile = new Float64Array(400);
  for (let i = 12; i < 400; i += 25) profile[i] = 100;
  const d = P.detectPeriod(profile, 8, 200);
  assert.equal(d.period, 25);
  assert.ok([11, 12].includes(d.phase));
  assert.ok(d.confidence > .5);
  assert.equal(P.detectPeriod(new Float64Array(400), 8, 200), null, 'perfil plano não tem grade');
});

test('detecção automática numa imagem sintética com grade', () => {
  const w = 320, h = 240;
  const r = P.detectGrid(gridImage(w, h, 32, 10, 6), w, h);
  assert.ok(!r.error, r.error);
  assert.equal(r.gridPixels, 32);
  assert.ok(Math.abs(r.gridOffsetX - 10) <= 1, `x ${r.gridOffsetX}`);
  assert.ok(Math.abs(r.gridOffsetY - 6) <= 1, `y ${r.gridOffsetY}`);
});

test('detecção converte o resultado de uma análise reduzida para a imagem original', () => {
  // Imagem analisada pela metade: lado 24 px equivale a 48 px no original.
  const w = 300, h = 220;
  const r = P.detectGrid(gridImage(w, h, 24, 4, 8), w, h, { scale: .5 });
  assert.equal(r.gridPixels, 48);
  assert.ok(Math.abs(r.gridOffsetX - 8) <= 2);
});

test('imagem sem grade não inventa alinhamento', () => {
  const w = 200, h = 160, data = new Uint8ClampedArray(w * h * 4).fill(128);
  assert.match(P.detectGrid(data, w, h).error, /Não foi possível/);
});

test('descrição curta do resultado', () => {
  assert.equal(P.describeAlignment({ gridPixels: 64, gridOffsetX: 3, gridOffsetY: 0 }), 'Quadrado de 64 px, deslocamento 3 × 0 px.');
  assert.equal(P.describeAlignment({ error: 'x' }), 'x');
});

test("ajuste fino, predefinições, pontos e prévia do impacto", async () => {
  const { nudgeGrid, sameGrid, pickPoint, impactLines, GRID_PRESETS } = await import("../apps/Eternnus.Web/wwwroot/js/grid-align-policy.js");
  const v = { gridPixels: 70, gridOffsetX: 0, gridOffsetY: 69 };
  assert.deepEqual(nudgeGrid(v, "gridOffsetX", -1), { ...v, gridOffsetX: 69 });
  assert.deepEqual(nudgeGrid(v, "gridOffsetY", 1), { ...v, gridOffsetY: 0 });
  assert.deepEqual(nudgeGrid(v, "gridPixels", -10), { gridPixels: 60, gridOffsetX: 0, gridOffsetY: 59 });
  assert.equal(nudgeGrid({ gridPixels: 9 }, "gridPixels", -10).gridPixels, 8);
  assert.equal(nudgeGrid(v, "gridPixels", 500, 256).gridPixels, 256);
  assert.ok(sameGrid(v, { ...v })); assert.ok(!sameGrid(v, { ...v, gridPixels: 71 }));
  assert.ok(GRID_PRESETS.some(([px]) => px === 70) && GRID_PRESETS.some(([px]) => px === 100));
  assert.equal(pickPoint([{ x: 0, y: 0 }, { x: 10, y: 10 }], 9, 9, 5), 1);
  assert.equal(pickPoint([{ x: 0, y: 0 }], 50, 50, 5), -1);
  const none = impactLines({ width: 8, height: 8, oldWidth: 8, oldHeight: 8, scenes: 0 });
  assert.equal(none.loss, false); assert.match(none.lines.join(" "), /Nada preparado/);
  const loss = impactLines({ width: 4, height: 4, oldWidth: 8, oldHeight: 8, scenes: 2, tokensOutside: 3, lightsOutside: 1, entriesOutside: 1, instances: 1, inSession: true });
  assert.equal(loss.loss, true);
  const text = loss.lines.join(" ");
  for (const part of [/8 × 8 para 4 × 4/, /2 cena/, /3 marcador/, /1 luz/, /1 ponto/, /Encaixar na grade/, /na mesa agora/]) assert.match(text, part);
});
