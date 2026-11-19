import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guestRoute, displayRoute, isGuestSecret, normalizeGuestName, inviteRequest, inviteStatus, inviteLink, guestAbilities,
  controllableToken, participantSeats, seatControlling, redeemMessage, GUEST_DURATIONS, GUEST_USES, DEFAULT_GUEST_NAME,
} from '../apps/Eternnus.Web/wwwroot/js/guest-policy.js';

const secret = 'aB3_dEf-GhIjKlMnOpQrStUvWxYz0123456789abcde';

test('rotas do convidado e da exibição externa, com e sem barra inicial', () => {
  assert.deepEqual(guestRoute(`#/convidado/${secret}`), { secret });
  assert.deepEqual(guestRoute(`convidado/${secret}`), { secret });
  assert.deepEqual(guestRoute('#/convidado'), { secret: '' });
  assert.equal(guestRoute('#/convidado/<script>'), null);
  assert.equal(guestRoute('#/convidado/abc/def'), null);
  assert.equal(guestRoute('#campaigns'), null);
  assert.equal(isGuestSecret('curto'), false);
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(displayRoute(`#/mesa/${id}/exibicao`), id);
  assert.equal(displayRoute(`mesa/${id}/exibicao`), id);
  assert.equal(displayRoute('mesa/x/exibicao'), null);
  assert.equal(displayRoute(`mesa/${id}`), null);
});

test('nome do convidado: espaços, controles e limite de 40', () => {
  assert.equal(normalizeGuestName('  Ana   Lu  '), 'Ana Lu');
  assert.equal(normalizeGuestName(''), DEFAULT_GUEST_NAME);
  assert.equal(normalizeGuestName('a\u0000b'), 'a b');
  assert.equal(normalizeGuestName('x'.repeat(80)).length, 40);
});

test('convite usa predefinições e limites aceitos pelo servidor', () => {
  assert.deepEqual(GUEST_DURATIONS.map((d) => d.hours), [2, 4, 12, 24]);
  assert.deepEqual([...GUEST_USES], [1, 5, 10]);
  assert.deepEqual(inviteRequest({ mode: 'participant', hours: '12', maxUses: '5', label: ' Primo ' }), { mode: 'participant', hours: 12, maxUses: 5, label: 'Primo' });
  assert.deepEqual(inviteRequest({ mode: 'admin', hours: 999, maxUses: 50 }), { mode: 'observer', hours: 4, maxUses: 1 });
  for (const d of GUEST_DURATIONS) assert.ok(d.hours >= 1 && d.hours <= 72);
  for (const u of GUEST_USES) assert.ok(u >= 1 && u <= 20);
});

test('situação do convite e link completo só no formato do convidado', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const base = { expiresAt: '2026-11-19T14:00:00Z', uses: 0, maxUses: 1, revokedAt: null, active: true };
  assert.equal(inviteStatus(base, now).id, 'active');
  assert.equal(inviteStatus({ ...base, revokedAt: '2026-11-19T11:00:00Z' }, now).id, 'revoked');
  assert.equal(inviteStatus({ ...base, expiresAt: '2026-11-19T11:00:00Z' }, now).id, 'expired');
  assert.equal(inviteStatus({ ...base, uses: 1 }, now).id, 'used');
  assert.equal(inviteLink(`/#/convidado/${secret}`, 'https://rpg.eternnus.com'), `https://rpg.eternnus.com/#/convidado/${secret}`);
  assert.equal(inviteLink('javascript:alert(1)', 'https://rpg.eternnus.com'), null);
  assert.equal(inviteLink(`/#/convidado/${secret}`, 'javascript:'), null);
});

test('observador não move, não rola nem conversa; participante só move o marcador entregue', () => {
  const state = { map: { kind: 'tileset' }, tokens: [{ id: 't1', label: 'Lobo' }], session: {} };
  const observer = guestAbilities({ mode: 'observer', tokenId: 't1' }, state);
  assert.deepEqual([observer.roll, observer.chat, observer.move], [false, false, false]);
  const participant = guestAbilities({ mode: 'participant', tokenId: null }, state);
  assert.deepEqual([participant.roll, participant.chat, participant.move], [true, true, false]);
  const control = guestAbilities({ mode: 'participant', tokenId: 't1' }, state);
  assert.equal(control.move, true); assert.equal(control.token.label, 'Lobo');
  assert.equal(guestAbilities({ mode: 'participant', tokenId: 't1' }, { ...state, session: { endedAt: 'x' } }).move, false);
  assert.equal(guestAbilities({ mode: 'participant', tokenId: 'sumiu' }, state).move, false);
});

test('controle de marcador: só sem ficha de jogador e só assentos de participante', () => {
  assert.equal(controllableToken({ id: 'a', characterId: null }), true);
  assert.equal(controllableToken({ id: 'b', characterId: 'c' }), false);
  const guests = [
    { seatId: 's1', name: 'Ana', mode: 'participant', tokenId: 't9' },
    { seatId: 's2', name: 'Bia', mode: 'observer', tokenId: null },
    { seatId: 's3', name: 'Caio', mode: 'participant', revokedAt: 'x' },
  ];
  assert.deepEqual(participantSeats(guests).map((g) => g.seatId), ['s1']);
  assert.equal(seatControlling(guests, 't9').name, 'Ana');
  assert.equal(seatControlling(null, 't9'), null);
});

test('mensagens do resgate por código de resposta', () => {
  assert.match(redeemMessage(404), /não vale mais/);
  assert.match(redeemMessage(409), /ainda não começou/);
  assert.match(redeemMessage(429), /Aguarde/);
  assert.equal(redeemMessage(400, 'O nome aceita até 40 caracteres.'), 'O nome aceita até 40 caracteres.');
});
