import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MUSIC_LIMITS,
  SYNC,
  addClockSample,
  clockOffset,
  correction,
  expectedPosition,
  formatBytes,
  formatTime,
  isNewerMusic,
  readAudioPreference,
  sessionAudioActive,
  statusOf,
  titleFromFile,
  validateAudioFile,
} from "../apps/Eternnus.Web/wwwroot/js/soundtrack-policy.js";
import { STATIC_PATHS } from "../apps/Eternnus.Web/wwwroot/js/pwa-policy.js";

const reference = "2026-11-08T20:00:00.000Z";
const at = (seconds) => Date.parse(reference) + seconds * 1000;
const track = (extra = {}) => ({ trackId: "t1", version: 3, playing: true, positionMs: 5000, referenceAt: reference, loop: false, durationMs: 60000, ...extra });

test("expected position advances with the server clock only while playing", () => {
  assert.deepEqual(expectedPosition(track(), at(10)), { positionMs: 15000, ended: false });
  assert.deepEqual(expectedPosition(track({ playing: false }), at(10)), { positionMs: 5000, ended: false });
  assert.deepEqual(expectedPosition(null, at(10)), { positionMs: 0, ended: false });
  // Relógio anterior à referência não volta a posição.
  assert.deepEqual(expectedPosition(track(), at(-30)), { positionMs: 5000, ended: false });
});

test("late join, track end, loop and unknown duration", () => {
  assert.deepEqual(expectedPosition(track(), at(100)), { positionMs: 60000, ended: true });
  assert.deepEqual(expectedPosition(track({ loop: true }), at(100)), { positionMs: 45000, ended: false });
  assert.deepEqual(expectedPosition(track({ durationMs: null }), at(100)), { positionMs: 105000, ended: false });
  // Duração lida pelo navegador completa a do servidor quando ela não é conhecida.
  assert.deepEqual(expectedPosition(track({ durationMs: null }), at(100), 90000), { positionMs: 90000, ended: true });
});

test("clock offset keeps the least delayed recent sample", () => {
  let samples = [];
  // Respostas lentas chegam mais tarde e subestimam a diferença; a maior amostra é a mais próxima da real.
  for (const [server, local] of [[1000, 900], [2000, 1890], [3000, 3400], [4000, 3905], [5000, 4890]])
    samples = addClockSample(samples, new Date(server).toISOString(), local);
  assert.equal(clockOffset(samples), 110);
  assert.equal(clockOffset([]), 0);
  assert.deepEqual(addClockSample([1], "não é data", 5), [1]);
  for (let i = 0; i < 20; i++) samples = addClockSample(samples, new Date(10000 + i).toISOString(), 10000);
  assert.equal(samples.length, SYNC.samples);
});

test("drift correction: ignore small, nudge medium, seek large or after a new command", () => {
  assert.equal(correction(10100, 10000).kind, "none");
  const ahead = correction(10800, 10000);
  assert.equal(ahead.kind, "rate");
  assert.ok(ahead.rate < 1 && ahead.rate >= 1 - SYNC.maxRate);
  const behind = correction(9200, 10000);
  assert.ok(behind.rate > 1 && behind.rate <= 1 + SYNC.maxRate);
  assert.deepEqual(correction(14000, 10000, { now: 50000 }).kind, "seek");
  // Sem saltos em sequência: dentro do intervalo mínimo, corrige pela velocidade.
  assert.equal(correction(14000, 10000, { now: 50000, lastSeekAt: 49000 }).kind, "rate");
  assert.equal(correction(10200, 10000, { forced: true }).kind, "seek");
  assert.equal(correction(10050, 10000, { forced: true }).kind, "none");
  // Histerese: durante a correção, continua até chegar perto da posição esperada.
  assert.equal(correction(10200, 10000, { correcting: true }).kind, "rate");
  // Na repetição, o caminho mais curto atravessa o fim da faixa.
  assert.equal(correction(59900, 100, { loop: true, durationMs: 60000 }).kind, "none");
});

test("older states never replace newer ones", () => {
  assert.equal(isNewerMusic(null, track()), true);
  assert.equal(isNewerMusic(track({ version: 4 }), track({ version: 3 })), false);
  assert.equal(isNewerMusic(track({ version: 4 }), track({ version: 4 })), true);
  assert.equal(isNewerMusic(track(), null), false);
  assert.equal(sessionAudioActive(track()), true);
  assert.equal(sessionAudioActive({ trackId: null }), false);
});

test("status text covers idle, paused, blocked, loading, ended and error without promising perfect sync", () => {
  assert.equal(statusOf(null).key, "idle");
  assert.equal(statusOf(track({ playing: false })).label, "Pausada");
  assert.equal(statusOf(track(), { blocked: true }).key, "blocked");
  assert.equal(statusOf(track(), { loading: true }).key, "loading");
  assert.equal(statusOf(track(), {}, true).key, "ended");
  assert.equal(statusOf(track(), { error: true }).key, "error");
  assert.match(statusOf(track(), { muted: true }).label, /silenciada para você/);
  for (const status of [statusOf(track()), statusOf(track(), { blocked: true })]) assert.doesNotMatch(status.label, /sincroniza|garant/i);
});

test("upload validation mirrors the server limits for feedback only", () => {
  assert.equal(validateAudioFile({ name: "a.mp3", size: 1000 }), "");
  assert.match(validateAudioFile({ name: "capa.png", size: 1000 }), /Formato/);
  assert.match(validateAudioFile({ name: "a.ogg", size: MUSIC_LIMITS.maxFileBytes + 1 }), /20 MB/);
  assert.match(validateAudioFile({ name: "a.m4a", size: 0 }), /vazio/);
  assert.match(validateAudioFile({ name: "a.mp3", size: 10 }, { tracks: 200, bytes: 0 }), /200 faixas/);
  assert.match(validateAudioFile({ name: "a.mp3", size: 10 }, { tracks: 1, bytes: MUSIC_LIMITS.maxCatalogBytes }), /2 GB/);
  assert.match(validateAudioFile(null), /Escolha/);
});

test("formatting and personal preference parsing", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(83500), "1:23");
  assert.equal(formatTime(3723000), "1:02:03");
  assert.equal(formatTime(Number.NaN), "--:--");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), "2 GB");
  assert.equal(titleFromFile("batalha_final\u0007.mp3"), "batalha final");
  assert.deepEqual(readAudioPreference(null), { volume: 0.8, muted: false });
  assert.deepEqual(readAudioPreference('{"volume":0.333,"muted":true}'), { volume: 0.33, muted: true });
  for (const raw of ["", "{", "[]", '"x"', '{"volume":"alto","muted":"sim"}']) assert.deepEqual(readAudioPreference(raw), { volume: 0.8, muted: false }, raw);
});

test("new public modules are in the explicit shell list and no audio or API path is cached", async () => {
  for (const name of ["soundtrack-policy", "soundtrack-api", "session-audio", "table-soundtrack", "admin-music"])
    assert.ok(STATIC_PATHS.includes(`/js/${name}.js`), name);
  assert.ok(STATIC_PATHS.every((path) => !path.startsWith("/api/") && !/\.(mp3|m4a|ogg|opus)$/.test(path)));
  const worker = await readFile(new URL("../apps/Eternnus.Web/wwwroot/service-worker.js", import.meta.url), "utf8");
  // A versão só cresce; os módulos da trilha entraram até a v31.
  const version = Number(worker.match(/eternnus-public-shell-v(\d+)/)?.[1]);
  assert.ok(version >= 31, `cache v${version}`);
  assert.doesNotMatch(worker, /skipWaiting/);
});
