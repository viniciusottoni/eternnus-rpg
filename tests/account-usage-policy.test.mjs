// Medidores de "Minha conta" (ADR-096): regras puras.
import test from "node:test";
import assert from "node:assert/strict";
import { countMeter, storageMeter, formatBytes, level, STORAGE_PARTS } from "../apps/Eternnus.Web/wwwroot/js/account-usage-policy.js";

const MB = 1024 * 1024;

test("quota limitada vira barra com proporção e alerta", () => {
  const m = countMeter("Campanhas ativas", 2, 3);
  assert.equal(m.display, "2 / 3");
  assert.equal(m.unlimited, false);
  assert.equal(m.level, "ok");
  assert.ok(Math.abs(m.ratio - 2 / 3) < 1e-9);
  assert.equal(countMeter("x", 8, 10).level, "near");
  assert.equal(countMeter("x", 10, 10).level, "full");
  assert.equal(countMeter("x", 12, 10).ratio, 1);
});

test("sem limite mostra ∞ e continua contando", () => {
  const m = countMeter("Campanhas ativas", 7, null);
  assert.equal(m.display, "7 / ∞");
  assert.equal(m.unlimited, true);
  assert.equal(m.used, 7);
  assert.equal(m.ratio, 0);
  assert.match(m.spoken, /sem limite/);
});

test("valores inválidos viram zero", () => {
  assert.equal(countMeter("x", undefined, 3).used, 0);
  assert.equal(countMeter("x", -4, 3).display, "0 / 3");
});

test("armazenamento soma tipos e segmenta na ordem fixa", () => {
  const s = storageMeter({ campaigns: 2, capacity: 500 * MB, perCampaign: 250 * MB, images: 100 * MB, attachments: 20 * MB, versions: 5 * MB, texts: 1024 });
  assert.equal(s.used, 125 * MB + 1024);
  assert.deepEqual(s.parts.map((p) => p.key), STORAGE_PARTS.map((p) => p.key));
  assert.ok(Math.abs(s.parts[0].share - 0.2) < 1e-9);
  assert.equal(s.display, "125 MB / 500 MB");
  assert.equal(s.level, "ok");
});

test("segmentos nunca passam de 100% mesmo acima da capacidade", () => {
  const s = storageMeter({ capacity: 10 * MB, images: 9 * MB, texts: 3 * MB });
  assert.equal(s.ratio, 1);
  assert.equal(s.level, "full");
  assert.ok(s.parts.reduce((sum, p) => sum + p.share, 0) <= 1 + 1e-9);
});

test("sem campanhas mestradas: só o total, sem capacidade", () => {
  const s = storageMeter({ campaigns: 0, capacity: 0 });
  assert.equal(s.capacity, 0);
  assert.equal(s.display, "0 B");
  assert.equal(level(0, 0), "ok");
  assert.match(storageMeter().spoken, /nenhuma campanha/);
});

test("formata bytes em pt-BR", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1.5 * MB), "1,5 MB");
  assert.equal(formatBytes(2 * 1024 * MB), "2 GB");
});
