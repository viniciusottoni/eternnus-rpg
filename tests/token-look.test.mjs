import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LOOK_IMAGE, LOOK_ROUND, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE, clampSize, tokenScale, isImageLook, tokenHalf, imageBox, sizeFromHandle, tokenUnder, drawOrder,
} from "../apps/Eternnus.Web/wwwroot/js/token-look.js";
import { STATIC_PATHS } from "../apps/Eternnus.Web/wwwroot/js/pwa-policy.js";

const center = (t) => ({ x: t.x + 0.5, y: t.y + 0.5 });

test("size stays within the same limits as Domain/Sessions.cs TokenLooks", async () => {
  assert.equal(clampSize(undefined), DEFAULT_SIZE);
  assert.equal(clampSize(null), DEFAULT_SIZE);
  assert.equal(clampSize("abc"), DEFAULT_SIZE);
  assert.equal(clampSize(10), MIN_SIZE);
  assert.equal(clampSize(9999), MAX_SIZE);
  assert.equal(clampSize(249.6), 250);
  const domain = await readFile(new URL("../apps/Eternnus.Web/Domain/Sessions.cs", import.meta.url), "utf8");
  assert.match(domain, new RegExp(`MinSize = ${MIN_SIZE}, MaxSize = ${MAX_SIZE}, DefaultSize = ${DEFAULT_SIZE}`));
  assert.match(domain, new RegExp(`Round = "${LOOK_ROUND}", Image = "${LOOK_IMAGE}"`));
});

test("free image needs an image to draw; otherwise the token stays round", () => {
  assert.equal(isImageLook({ appearance: LOOK_IMAGE, image: "/x.png" }), true);
  assert.equal(isImageLook({ appearance: LOOK_IMAGE }), false);
  assert.equal(isImageLook({ appearance: LOOK_ROUND, image: "/x.png" }), false);
  assert.equal(tokenScale({ size: 200 }), 2);
  assert.equal(tokenHalf({ size: 100 }), 0.4);
  assert.equal(tokenHalf({ appearance: LOOK_IMAGE, image: "/x.png", size: 300 }), 1.5);
});

test("free image keeps its proportion inside the token square", () => {
  assert.deepEqual(imageBox(50, 50, 80, 200, 100), { x: 10, y: 30, w: 80, h: 40 });
  assert.deepEqual(imageBox(0, 0, 10, 0, 0), { x: -5, y: -5, w: 10, h: 10 });
});

test("dragging the handle maps distance to size in 5% steps", () => {
  const round = { size: 100 };
  assert.equal(sizeFromHandle({ x: 2.5, y: 2.5 }, { x: 2.9, y: 2.9 }, round), 100);
  assert.equal(sizeFromHandle({ x: 2.5, y: 2.5 }, { x: 3.3, y: 2.5 }, round), 200);
  assert.equal(sizeFromHandle({ x: 2.5, y: 2.5 }, { x: 2.5, y: 2.5 }, round), MIN_SIZE);
  assert.equal(sizeFromHandle({ x: 0, y: 0 }, { x: 40, y: 0 }, round), MAX_SIZE);
  const image = { appearance: LOOK_IMAGE, image: "/x.png" };
  assert.equal(sizeFromHandle({ x: 0, y: 0 }, { x: 1, y: 1 }, image), 200);
});

test("hit test finds big tokens beyond their cell and keeps small ones on top", () => {
  const dragon = { id: "d", x: 4, y: 4, appearance: LOOK_IMAGE, image: "/d.png", size: 400 };
  const wolf = { id: "w", x: 5, y: 4 };
  const tokens = [dragon, wolf];
  // Ponto dentro do dragão, duas casas longe do centro dele.
  assert.equal(tokenUnder(tokens, 3, 3, center, false)?.id, "d");
  // O lobo, menor, fica por cima do dragão.
  assert.equal(tokenUnder(tokens, 5.5, 4.5, center, false)?.id, "w");
  // Com grade, um marcador comum ainda responde na casa inteira (como antes).
  assert.equal(tokenUnder([wolf], 5.05, 4.05, center, false)?.id, "w");
  // Movimentação livre: o redondo responde só no círculo.
  assert.equal(tokenUnder([wolf], 5.05, 4.05, center, true), null);
  assert.equal(tokenUnder(tokens, 20, 20, center, false), null);
});

test("bigger tokens are drawn first, stable for equal sizes", () => {
  const a = { id: "a" }, b = { id: "b", size: 300 }, c = { id: "c" };
  assert.deepEqual(drawOrder([a, b, c]).map((t) => t.id), ["b", "a", "c"]);
  assert.deepEqual(drawOrder(null), []);
});

test("the token look module is public shell, listed for the service worker", async () => {
  assert.ok(STATIC_PATHS.includes("/js/token-look.js"));
  const source = await readFile(new URL("../apps/Eternnus.Web/wwwroot/js/token-look.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|localStorage|document\./);
});
