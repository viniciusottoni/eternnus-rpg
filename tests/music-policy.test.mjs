import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../apps/Eternnus.Web/wwwroot/js/music-policy.js", import.meta.url),
  "utf8",
);
const {
  MUSIC_SRC,
  DEFAULT_VOLUME,
  clampVolume,
  readPreference,
  shouldAutoplay,
  volumeLevel,
} = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);

test("the soundtrack is the unmodified official file under a versioned public name", async () => {
  assert.match(MUSIC_SRC, /^\/assets\/audio\/[a-z0-9-]+\.v\d+\.mp3$/);
  const [served, original] = await Promise.all([
    readFile(new URL("../apps/Eternnus.Web/wwwroot" + MUSIC_SRC, import.meta.url)),
    readFile(new URL("../assets/Eternnus RPG - The Blade and the Serpent.mp3", import.meta.url)),
  ]);
  assert.ok(served.equals(original), "served soundtrack must be byte-identical to the source");
});

test("a first visit plays at the default volume", () => {
  assert.deepEqual(readPreference(null), { paused: false, volume: DEFAULT_VOLUME });
  assert.equal(shouldAutoplay(readPreference(null)), true);
});

test("saved choices are restored and an explicit pause disables autoplay", () => {
  const saved = readPreference(JSON.stringify({ paused: true, volume: 0.25 }));
  assert.deepEqual(saved, { paused: true, volume: 0.25 });
  assert.equal(shouldAutoplay(saved), false);
  assert.equal(shouldAutoplay(readPreference('{"volume":0}')), true);
});

test("data saver mode never starts the soundtrack automatically", () => {
  assert.equal(shouldAutoplay(readPreference(null), true), false);
});

test("corrupted or foreign preferences fall back to safe defaults", () => {
  for (const raw of ["", "{", "null", "[]", '"x"', "42", '{"paused":"yes","volume":"loud"}'])
    assert.deepEqual(readPreference(raw), { paused: false, volume: DEFAULT_VOLUME }, raw);
});

test("volume is clamped to the media range", () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(7), 1);
  assert.equal(clampVolume(0.333), 0.33);
  assert.equal(clampVolume(Number.NaN), DEFAULT_VOLUME);
  assert.equal(clampVolume(null), DEFAULT_VOLUME);
  assert.equal(clampVolume(0), 0);
});

test("the volume icon reflects silence, low and high levels", () => {
  assert.equal(volumeLevel(0), "muted");
  assert.equal(volumeLevel(0.2), "low");
  assert.equal(volumeLevel(0.5), "high");
  assert.equal(volumeLevel(1), "high");
});
