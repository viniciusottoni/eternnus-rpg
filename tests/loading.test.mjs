import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../apps/Eternnus.Web/wwwroot/js/loading.js', import.meta.url), 'utf8');
let sequence = 0;
async function fixture() {
  const app = { inert: false, setAttribute() {}, removeAttribute() {} };
  const modal = { inert: false, addEventListener(type, fn) { this[type] = fn; } };
  const protectedNode = { inert: true };
  const focus = { isConnected: true, restored: 0, closest() { return null; }, focus() { this.restored++; } };
  const splash = { dataset: {}, visible: false, setAttribute() {}, matches() { return this.visible; }, showPopover() { this.visible = true; }, hidePopover() { this.visible = false; } };
  globalThis.document = {
    activeElement: focus,
    querySelector(selector) { return ({ '#app': app, '#modal': modal, '#splash': splash })[selector]; },
    querySelectorAll() { return [app, modal, protectedNode]; },
  };
  const loading = await import('data:text/javascript;base64,' + Buffer.from(source + '\n// fixture ' + sequence++).toString('base64'));
  loading.installLoading();
  return { ...loading, app, modal, splash, focus, protectedNode };
}

test('opening ends independently; overlapping foreground work keeps controls locked until the final completion', async () => {
  const f = await fixture();
  assert.equal(f.splash.visible, true);
  const first = f.beginLoading(), second = f.beginLoading();
  f.endOpening();
  assert.equal(f.splash.dataset.mode, 'operation');
  first(); first();
  assert.equal(f.splash.visible, true);
  assert.equal(f.app.inert, true);
  let prevented = false;
  f.modal.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  second();
  assert.equal(f.splash.visible, false);
  assert.equal(f.app.inert, false);
  assert.equal(f.modal.inert, false);
  assert.equal(f.protectedNode.inert, true);
  assert.equal(f.focus.restored, 1);
});

test('failures dismiss loading and restore the form; a later operation can start normally', async () => {
  const f = await fixture();
  f.endOpening();
  await assert.rejects(f.withLoading(async () => {
    assert.equal(f.splash.visible, true);
    throw new Error('network unavailable');
  }), /network unavailable/);
  assert.equal(f.splash.visible, false);
  assert.equal(f.app.inert, false);
  assert.equal(await f.withLoading(async () => 42), 42);
  assert.equal(f.splash.visible, false);
});

test('maintenance keeps the canonical opening overlay without reloading or discarding DOM state', async () => {
  const f = await fixture();
  f.endOpening();
  assert.equal(f.splash.visible, false);
  f.setMaintenance(true);
  assert.equal(f.splash.dataset.mode, 'opening');
  assert.equal(f.splash.visible, true);
  assert.equal(f.app.inert, true);
  f.setMaintenance(false);
  assert.equal(f.splash.visible, false);
  assert.equal(f.app.inert, false);
  assert.equal(f.protectedNode.inert, true);
});
