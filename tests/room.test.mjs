import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomRegistry } from '../src/app/tornado/engine/net/room.js';

function setup(extra = {}) {
  const out = [];
  let t = 0;
  let n = 0;
  const reg = createRoomRegistry({ send: (c, m) => out.push([c, m]), now: () => t, random: () => n++ % 31, ...extra });
  const last = (c) => [...out].reverse().find(([cc]) => cc === c)?.[1];
  return { reg, out, last, advance: (ms) => { t += ms; } };
}

test('host creates a room, peer joins by code, capacity 2 enforced', () => {
  const { reg, last } = setup();
  reg.create('h');
  const code = last('h').code;
  reg.join('p', code);
  assert.equal(last('p').type, 'joined');
  assert.equal(last('h').type, 'peerJoined');
  reg.join('p2', code);
  assert.equal(last('p2').code, 'full');
});

test('duplicate join / create and unknown codes are rejected', () => {
  const { reg, last } = setup();
  reg.create('h');
  reg.create('h');
  assert.equal(last('h').code, 'already-in-room');
  reg.join('p', 'ZZZZZZ');
  assert.equal(last('p').code, 'no-room');
  const code = [...[]].length; void code;
  reg.join('h', 'ABCDEF');
  assert.equal(last('h').code, 'already-in-room');
});

test('peer drop: grace then rejoin by token keeps identity', () => {
  const { reg, last, advance } = setup();
  reg.create('h');
  const code = last('h').code;
  reg.join('p', code);
  const { token, id } = last('p');
  reg.drop('p');
  assert.equal(last('h').reason, 'dropped');
  advance(10000);
  reg.tick();
  reg.rejoin('p2', code, token);
  assert.equal(last('p2').id, id);
  assert.equal(last('p2').rejoined, true);
});

test('grace expiry removes the peer and frees the seat', () => {
  const { reg, last, advance } = setup();
  reg.create('h');
  const code = last('h').code;
  reg.join('p', code);
  const { token } = last('p');
  reg.drop('p');
  advance(30001);
  reg.tick();
  assert.equal(last('h').reason, 'expired');
  reg.rejoin('p2', code, token);
  assert.equal(last('p2').code, 'no-room');
  reg.join('p3', code);
  assert.equal(last('p3').type, 'joined');
});

test('host loss closes the room (no migration)', () => {
  const { reg, last } = setup();
  reg.create('h');
  const code = last('h').code;
  reg.join('p', code);
  reg.drop('h');
  assert.equal(last('p').type, 'hostLeft');
  assert.equal(reg.has(code), false);
  reg.join('p2', code);
  assert.equal(last('p2').code, 'no-room');
});

test('relay enforces roles', () => {
  const { reg, last } = setup();
  reg.create('h');
  const code = last('h').code;
  reg.join('p', code);
  assert.equal(reg.relay('p', { type: 'snapshot' }), false);
  assert.equal(reg.relay('p', { type: 'event' }), false);
  assert.equal(reg.relay('p', { type: 'input', seq: 1 }), true);
  assert.equal(last('h').from, '1');
  assert.equal(reg.relay('h', { type: 'input' }), false);
  assert.equal(reg.relay('h', { type: 'snapshot', tick: 1 }), true);
  assert.equal(last('p').tick, 1);
  assert.equal(reg.relay('stranger', { type: 'input' }), false);
});

test('idle rooms expire', () => {
  const { reg, advance } = setup({ idleMs: 1000 });
  reg.create('h');
  advance(1500);
  reg.tick();
  assert.equal(reg.roomCount(), 0);
});

test('graceful leave frees the seat immediately', () => {
  const { reg, last } = setup();
  reg.create('h');
  const code = last('h').code;
  reg.join('p', code);
  reg.drop('p', true);
  assert.equal(last('h').reason, 'left');
  reg.join('p2', code);
  assert.equal(last('p2').type, 'joined');
});
