import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DRAFT_TTL_MS, MAX_DRAFTS, MAX_DRAFT_CHARS, buildDraft, clock, draftDecision, draftKey, pruneDrafts, readDraft, saveStatusText,
} from '../apps/Eternnus.Web/wwwroot/js/draft-policy.js';

const root = new URL('../apps/Eternnus.Web/wwwroot/js/', import.meta.url);
const NOW = Date.UTC(2026, 10, 16, 15, 4);

test('chave do rascunho: usuário, campanha, tipo e documento; recusa partes inválidas', () => {
  assert.equal(draftKey('u1', 'c-1', 'tilemap', 'm1'), 'u1|c-1|tilemap|m1');
  assert.equal(draftKey('u1', 'c-1', 'scene', null), 'u1|c-1|scene|new');
  assert.equal(draftKey('u1', 'c-1', 'maplayer', 'asset:abc@def'), 'u1|c-1|maplayer|asset:abc@def');
  assert.equal(draftKey('u1', 'c-1', 'sheet', 'x'), null);
  assert.equal(draftKey('', 'c', 'scene', 'x'), null);
  assert.equal(draftKey('u|2', 'c', 'scene', 'x'), null);
  assert.equal(draftKey('u', 'c', 'scene', '<script>'), null);
});

test('registro guarda só o documento, a revisão de origem e datas; recusa acima de 8 MiB', () => {
  const key = draftKey('u', 'c', 'tilemap', 'm');
  const { record } = buildDraft({ key, user: 'u', campaign: 'c', kind: 'tilemap', doc: 'm', label: 'Bosque', revision: 4, snapshot: { name: 'Bosque', layers: [] }, now: NOW });
  assert.deepEqual(Object.keys(record).sort(), ['campaign', 'data', 'doc', 'key', 'kind', 'label', 'revision', 'savedAt', 'size', 'user']);
  assert.equal(record.revision, 4); assert.equal(record.savedAt, NOW); assert.equal(record.size, record.data.length);
  assert.ok(buildDraft({ key, snapshot: 'x'.repeat(MAX_DRAFT_CHARS) }).error);
  assert.ok(buildDraft({ key: null, snapshot: {} }).error);
  const cyclic = {}; cyclic.self = cyclic;
  assert.ok(buildDraft({ key, snapshot: cyclic }).error);
});

test('leitura descarta registros corrompidos, expirados ou de outra chave', () => {
  const key = draftKey('u', 'c', 'scene', 's');
  const { record } = buildDraft({ key, user: 'u', campaign: 'c', kind: 'scene', doc: 's', revision: { scene: 2, layer: 'h' }, snapshot: { draft: { name: 'A' } }, now: NOW });
  assert.deepEqual(readDraft(record, { key, now: NOW + 1000 }).snapshot, { draft: { name: 'A' } });
  assert.equal(readDraft(record, { key: 'outra', now: NOW }), null);
  assert.equal(readDraft(record, { key, now: NOW + DRAFT_TTL_MS + 1 }), null);
  assert.equal(readDraft({ ...record, data: '{quebrado' }, { key, now: NOW }), null);
  assert.equal(readDraft(null, { key }), null);
});

test('decisão ao abrir: oferece rascunho diferente e sinaliza conflito quando a revisão mudou', () => {
  const draft = { revision: { scene: 2, layer: 'h' }, snapshot: { name: 'Rascunho' } };
  assert.deepEqual(draftDecision(draft, { revision: { scene: 2, layer: 'h' }, snapshot: { name: 'Salvo' } }), { offer: true, conflict: false });
  assert.deepEqual(draftDecision(draft, { revision: { scene: 3, layer: 'h' }, snapshot: { name: 'Salvo' } }), { offer: true, conflict: true });
  assert.deepEqual(draftDecision(draft, { revision: { scene: 9 }, snapshot: { name: 'Rascunho' } }), { offer: false, conflict: false });
  assert.deepEqual(draftDecision(null, {}), { offer: false, conflict: false });
});

test('limpeza: expirados e excedentes do mesmo usuário, mais antigos primeiro', () => {
  const records = Array.from({ length: MAX_DRAFTS + 3 }, (_, i) => ({ key: `k${i}`, user: 'u', savedAt: NOW - i * 1000 }));
  records.push({ key: 'velho', user: 'u', savedAt: NOW - DRAFT_TTL_MS - 1 }, { key: 'outro', user: 'v', savedAt: 0 });
  const removed = pruneDrafts(records, { user: 'u', now: NOW });
  assert.deepEqual(removed.sort(), ['k30', 'k31', 'k32', 'velho'].sort());
});

test('barra de estado: salvo, rascunho e pausa', () => {
  assert.equal(clock(new Date(2026, 0, 1, 9, 5).getTime()), '09:05');
  const at = new Date(2026, 0, 1, 14, 30).getTime();
  assert.equal(saveStatusText({ savedAt: at }), 'Salvo às 14:30');
  assert.equal(saveStatusText({ savedAt: at, draftAt: at, dirty: true }), 'Rascunho local 14:30');
  assert.equal(saveStatusText({ draftAt: at, dirty: false }), '');
  assert.match(saveStatusText({ paused: true }), /pausado/);
});

test('editores ligam rascunho e versões pelo núcleo; conflito preserva o rascunho', async () => {
  const [core, drafts, tiles, image, scene, auth] = await Promise.all(['editor-core.js', 'editor-drafts.js', 'tile-map-editor.js', 'image-map-editor.js', 'scene-editor.js', 'auth.js'].map((f) => readFile(new URL(f, root), 'utf8')));
  assert.match(core, /data-ed-draft/); assert.match(core, /setDraftStatus/); assert.match(core, /root\.dataset\.discard = "1"/);
  for (const [name, src] of [['tiles', tiles], ['image', image], ['scene', scene]]) {
    assert.match(src, /attachDrafts\(shell,/, name);
    assert.match(src, /menuItems\(\)/, name);
    assert.match(src, /preserve\(\)/, name);
  }
  assert.match(drafts, /indexedDB\.open/); assert.doesNotMatch(drafts, /localStorage/);
  assert.match(drafts, /BroadcastChannel/);
  assert.match(drafts, /\/campaigns\/\$\{opts\.campaignId\}\/versions/);
  assert.match(auth, /clearUserDrafts/);
  assert.match(scene, /se-save-copy/);
});
