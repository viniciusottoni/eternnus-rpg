// Zoom do visualizador de imagem da Biblioteca (ADR-095): regras puras.
import test from "node:test";
import assert from "node:assert/strict";
import { fitScale, scaleLimits, clampView, zoomAt, fitView, ZOOM_MAX } from "../apps/Eternnus.Web/wwwroot/js/image-zoom.js";

const size = { iw: 4000, ih: 2000, vw: 1000, vh: 600 };

test("encaixa sem ampliar imagem pequena", () => {
  assert.equal(fitScale(4000, 2000, 1000, 600), 0.25);
  assert.equal(fitScale(200, 100, 1000, 600), 1);
  assert.deepEqual(scaleLimits(4000, 2000, 1000, 600), { min: 0.25, max: ZOOM_MAX });
});

test("vista encaixada fica centralizada", () => {
  assert.deepEqual(fitView(size), { scale: 0.25, x: 0, y: 50 });
});

test("zoom mantém fixo o ponto sob o cursor e respeita os limites", () => {
  const v = zoomAt(fitView(size), 2, 500, 300, size);
  assert.equal(v.scale, 0.5);
  // O ponto (500, 300) do palco continua sobre o mesmo pixel da imagem.
  const before = { x: (500 - 0) / 0.25, y: (300 - 50) / 0.25 };
  assert.deepEqual({ x: (500 - v.x) / v.scale, y: (300 - v.y) / v.scale }, before);
  assert.equal(zoomAt(v, 1000, 0, 0, size).scale, ZOOM_MAX);
  assert.equal(zoomAt(v, 0.001, 0, 0, size).scale, 0.25);
});

test("arraste não deixa vão nas bordas", () => {
  assert.deepEqual(clampView({ scale: 1, x: 300, y: 200 }, 4000, 2000, 1000, 600), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(clampView({ scale: 1, x: -9999, y: -9999 }, 4000, 2000, 1000, 600), { scale: 1, x: -3000, y: -1400 });
});
