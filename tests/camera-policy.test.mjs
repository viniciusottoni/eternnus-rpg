import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW, followReducer, normalizeFrame, frameDecision, visibleRegion, fitRegion, frameDuration, easeInOut, mixView,
  followKey, readFollow, writeFollow, followLabels, FRAME_MS,
} from '../apps/Eternnus.Web/wwwroot/js/camera-policy.js';

test('máquina de seguimento: livre, seguindo e pausado pelo gesto manual', () => {
  assert.equal(followReducer(FOLLOW.FREE, 'enable'), FOLLOW.FOLLOWING);
  assert.equal(followReducer(FOLLOW.FOLLOWING, 'user'), FOLLOW.PAUSED);
  assert.equal(followReducer(FOLLOW.PAUSED, 'resume'), FOLLOW.FOLLOWING);
  assert.equal(followReducer(FOLLOW.PAUSED, 'disable'), FOLLOW.FREE);
  // Câmera livre nunca liga sozinha: gesto e "voltar a seguir" não mudam nada.
  assert.equal(followReducer(FOLLOW.FREE, 'user'), FOLLOW.FREE);
  assert.equal(followReducer(FOLLOW.FREE, 'resume'), FOLLOW.FREE);
  assert.equal(followReducer('lixo', 'nada'), FOLLOW.FREE);
});

test('enquadramento só é aplicado quando a sequência aumenta e a pessoa segue', () => {
  const frame = { x: 2, y: 3, w: 10, h: 6, seq: 4 };
  let d = frameDecision({ mode: FOLLOW.FOLLOWING, frame });
  assert.equal(d.apply, true); assert.equal(d.lastSeq, 4);
  // A mesma resposta em cada consulta não faz a tela pular.
  d = frameDecision({ mode: FOLLOW.FOLLOWING, lastSeq: d.lastSeq, frame });
  assert.equal(d.apply, false);
  // Quem não segue nunca tem a câmera movida, mas a sequência avança.
  for (const mode of [FOLLOW.FREE, FOLLOW.PAUSED]) {
    const free = frameDecision({ mode, lastSeq: 4, frame: { ...frame, seq: 5 } });
    assert.equal(free.apply, false); assert.equal(free.lastSeq, 5);
  }
  // Voltar a seguir força o enquadramento atual.
  assert.equal(frameDecision({ mode: FOLLOW.FOLLOWING, lastSeq: 5, frame: { ...frame, seq: 5 }, force: true }).apply, true);
  assert.equal(frameDecision({ mode: FOLLOW.FOLLOWING, frame: null }).apply, false);
  assert.equal(normalizeFrame({ x: 0, y: 0, w: 0, h: 2, seq: 1 }), null);
  assert.equal(normalizeFrame({ x: NaN, y: 0, w: 1, h: 2, seq: 1 }), null);
});

test('região visível recortada ao mapa, com mínimo de 1 casa e 2 casas decimais', () => {
  // Casa de 40 px, origem deslocada 200 px para a esquerda/cima: vê de 5 a 5+20 colunas.
  assert.deepEqual(visibleRegion({ originX: -200, originY: -80, viewW: 800, viewH: 400, cell: 40, cols: 30, rows: 20 }), { x: 5, y: 2, w: 20, h: 10 });
  // Mapa menor que a janela: o mapa inteiro.
  assert.deepEqual(visibleRegion({ originX: 100, originY: 50, viewW: 1000, viewH: 600, cell: 20, cols: 10, rows: 8 }), { x: 0, y: 0, w: 10, h: 8 });
  assert.deepEqual(visibleRegion({ originX: -333, originY: 0, viewW: 100, viewH: 100, cell: 30, cols: 30, rows: 20 }), { x: 11.1, y: 0, w: 3.33, h: 3.33 });
  const tiny = visibleRegion({ originX: -10, originY: -10, viewW: 20, viewH: 20, cell: 100, cols: 5, rows: 5 });
  assert.ok(tiny.w >= 1 && tiny.h >= 1);
  assert.equal(visibleRegion({ originX: 0, originY: 0, viewW: 10, viewH: 10, cell: 0, cols: 5, rows: 5 }), null);
});

test('encaixe preserva proporção e respeita os limites de zoom do tabuleiro', () => {
  // Janela 1000x500, 20 px por casa no zoom 1: região 10x10 é limitada pela altura (500 / 200 = 2.5).
  const fit = fitRegion({ region: { x: 0, y: 0, w: 10, h: 10 }, viewW: 1000, viewH: 500, fitCell: 20, minZoom: 1, maxZoom: 3, cols: 40, rows: 30 });
  assert.equal(fit.zoom, 2.5); assert.equal(fit.cx, 5); assert.equal(fit.cy, 5);
  assert.equal(fitRegion({ region: { x: 0, y: 0, w: 1, h: 1 }, viewW: 1000, viewH: 500, fitCell: 20, maxZoom: 3 }).zoom, 3);
  assert.equal(fitRegion({ region: { x: 0, y: 0, w: 400, h: 400 }, viewW: 1000, viewH: 500, fitCell: 20, minZoom: 1 }).zoom, 1);
  // O centro fica dentro do mapa mesmo quando a região passa da borda.
  const edge = fitRegion({ region: { x: 38, y: -4, w: 10, h: 4 }, viewW: 800, viewH: 600, fitCell: 20, cols: 40, rows: 30 });
  assert.equal(edge.cx, 40); assert.equal(edge.cy, 0);
  assert.equal(fitRegion({ region: { x: 0, y: 0, w: 1, h: 1 }, viewW: 0, viewH: 0, fitCell: 20 }), null);
});

test('movimento reduzido e aba oculta tornam a troca instantânea; interpolação suave', () => {
  assert.equal(frameDuration(), FRAME_MS);
  assert.equal(frameDuration({ reducedMotion: true }), 0);
  assert.equal(frameDuration({ hidden: true }), 0);
  assert.equal(easeInOut(0), 0); assert.equal(easeInOut(1), 1); assert.equal(easeInOut(0.5), 0.5);
  const a = { zoom: 1, cx: 0, cy: 0 }, b = { zoom: 4, cx: 10, cy: 20 };
  assert.deepEqual(mixView(a, b, 0), a);
  const end = mixView(a, b, 1);
  assert.ok(Math.abs(end.zoom - 4) < 1e-9 && end.cx === 10 && end.cy === 20);
  assert.ok(Math.abs(mixView(a, b, 0.5).zoom - 2) < 1e-9, 'zoom geométrico');
});

test('escolha lembrada por sessão (sessionStorage) com padrão da tela', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const key = followKey(id);
  assert.equal(key, `eternnus.follow.${id}`);
  assert.equal(followKey('../x'), null);
  assert.equal(readFollow(storage, key, false), false);
  assert.equal(readFollow(storage, key, true), true);
  writeFollow(storage, key, true);
  assert.equal(readFollow(storage, key, false), true);
  writeFollow(storage, key, false);
  assert.equal(readFollow(storage, key, true), false);
  const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
  assert.equal(readFollow(broken, key, true), true);
  assert.doesNotThrow(() => writeFollow(broken, key, true));
  assert.equal(followLabels(FOLLOW.FREE).toggle, 'Seguir o mestre');
  assert.match(followLabels(FOLLOW.PAUSED).status, /pausado/);
});
