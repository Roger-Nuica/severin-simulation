import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputGate } from '../src/app/tornado/engine/net/inputGate.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';
import { createEventEmitter, createEventDeduper } from '../src/app/tornado/engine/net/events.js';
import { createPlayerRegistry, REVIVE } from '../src/app/tornado/engine/net/players.js';

const input = (o = {}) => ({ type: 'input', v: 3, seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false, hero: false, ...o });

// ---- input gate ----
test('gate exposes the latest accepted seq per known peer as ack rows', () => {
  const g = createInputGate({ now: () => 0 });
  const known = (id) => id === '1' || id === '2';
  assert.deepEqual(g.acks(known), []);
  g.accept({ ...input({ seq: 3 }), from: '1' }, known);
  g.accept({ ...input({ seq: 7 }), from: '2' }, known);
  g.accept({ ...input({ seq: 2 }), from: '1' }, known); // stale: ack stays at 3
  g.accept({ ...input({ seq: 9, mx: 5 }), from: '2' }, known); // invalid: ack stays at 7
  assert.deepEqual(g.acks(known), [[1, 3], [2, 7]]);
  assert.deepEqual(g.acks((id) => id === '2'), [[2, 7]]);
  g.forget('1');
  assert.deepEqual(g.acks(known), [[2, 7]]);
  g.clear();
  assert.deepEqual(g.acks(known), []);
});

test('gate binds to the relay-stamped id and drops unknown peers', () => {
  const g = createInputGate({ now: () => 0 });
  assert.equal(g.accept({ ...input(), from: '9' }, (id) => id === '1').error, 'unknown-peer');
  assert.equal(g.accept(input(), () => true).error, 'unknown-peer');
  const r = g.accept({ ...input(), from: '1' }, (id) => id === '1');
  assert.equal(r.ok, true);
  assert.equal(r.id, '1');
});

test('gate rejects stale/duplicate seq, bad schema, oversize and over-rate', () => {
  let t = 0;
  const g = createInputGate({ now: () => t, rate: 5 });
  const known = () => true;
  assert.equal(g.accept({ ...input({ seq: 5 }), from: '1' }, known).ok, true);
  assert.equal(g.accept({ ...input({ seq: 5 }), from: '1' }, known).error, 'stale');
  assert.equal(g.accept({ ...input({ seq: 4 }), from: '1' }, known).error, 'stale');
  assert.equal(g.accept({ ...input({ mx: 9, seq: 6 }), from: '1' }, known).error, 'move');
  assert.equal(g.accept({ ...input({ seq: 7 }), from: '1', pad: 'x'.repeat(600) }, known).error, 'size');
  let accepted = 0;
  for (let i = 0; i < 20; i++) if (g.accept({ ...input({ seq: 100 + i }), from: '2' }, known).ok) accepted++;
  assert.equal(accepted, 5, 'burst limited to the bucket');
  t = 1000;
  assert.equal(g.accept({ ...input({ seq: 200 }), from: '2' }, known).ok, true, 'refills over time');
});

test('peer cannot forge authoritative fields', () => {
  const g = createInputGate({ now: () => 0 });
  for (const extra of [{ x: 1 }, { score: 9 }, { damage: 5 }, { kill: true }, { event: {} }]) {
    assert.equal(g.accept({ ...input(), ...extra, from: '1' }, () => true).ok, false);
  }
});

// ---- snapshot buffer ----
const snap = (tick, t, x, o = {}) => ({ type: 'snapshot', v: 3, room: 'ABCDEF', tick, t, score: tick, players: [[0, x, 0, 0, 0, 0, 100, -1, -1]], tornadoes: [[0, x, 0, 20]], terminators: [], aliens: [], ships: [], vehicles: [], ...o });

test('buffer drops stale, duplicate, other-room and bad-version snapshots', () => {
  const b = createSnapshotBuffer();
  assert.equal(b.push(snap(2, 0.1, 0), 0).ok, true);
  assert.equal(b.push(snap(2, 0.1, 0), 0).error, 'stale');
  assert.equal(b.push(snap(1, 0.0, 0), 0).error, 'stale');
  assert.equal(b.push(snap(3, 0.2, 0, { room: 'ZZZZZZ' }), 0).error, 'room');
  assert.equal(b.push(snap(3, 0.2, 0, { v: 99 }), 0).error, 'version');
  assert.equal(b.size(), 1);
});

test('interpolates between bracketing snapshots, with wrapped angles', () => {
  const b = createSnapshotBuffer();
  const s1 = snap(1, 0, 0);
  s1.players[0][3] = Math.PI - 0.1;
  const s2 = snap(2, 0.2, 10);
  s2.players[0][3] = -Math.PI + 0.1;
  b.push(s1, 0); b.push(s2, 0.2);
  // render time = now - offset(0) - 0.14 -> now 0.24 renders t=0.10, halfway.
  const out = b.sample(0.24);
  const row = out.kinds.players.get(0);
  assert.ok(Math.abs(row[1] - 5) < 1e-6, `x=${row[1]}`);
  // Short way round the wrap, through +-PI, not through 0.
  assert.ok(Math.abs(Math.abs(row[3]) - Math.PI) < 1e-6, `h=${row[3]}`);
});

test('extrapolation is clamped when the host stalls', () => {
  const b = createSnapshotBuffer();
  b.push(snap(1, 0, 0), 0); b.push(snap(2, 0.1, 10), 0.1);
  const out = b.sample(100);
  assert.ok(out.t <= 0.1 + 0.25 + 1e-9);
  assert.ok(out.kinds.players.get(0)[1] <= 10 + 1e-6, 'no extrapolation past the newest state');
});

test('an entity missing from the older snapshot appears without blending; discrete fields snap', () => {
  const b = createSnapshotBuffer();
  b.push(snap(1, 0, 0), 0);
  b.push(snap(2, 0.2, 10, { terminators: [[7, 5, 5, 0, 1]] }), 0.2);
  const out = b.sample(0.24);
  assert.deepEqual(out.kinds.terminators.get(7), [7, 5, 5, 0, 1]);
  assert.equal(b.sample(0.24).score, 2);
});

test('empty buffer samples to null', () => assert.equal(createSnapshotBuffer().sample(1), null));

// ---- events ----
test('events: ids are sequential, the deduper applies each once, in any order', () => {
  const em = createEventEmitter({ now: () => 0 });
  const a = em.make('score', { n: 1 });
  const b = em.make('notice', { text: 'x' });
  assert.deepEqual([a.id, b.id], [1, 2]);
  const d = createEventDeduper();
  assert.equal(d.first(b), true);
  assert.equal(d.first(a), true);
  assert.equal(d.first(a), false);
  assert.equal(d.first(b), false);
  assert.equal(d.first({ ...a, kind: 'debris', id: 9 }), false, 'cosmetic kinds are not events');
});

test('event emitter caps the rate', () => {
  const em = createEventEmitter({ now: () => 0 });
  let n = 0;
  for (let i = 0; i < 100; i++) if (em.make('notice', {})) n++;
  assert.equal(n, 30);
});

test('deduper window is bounded', () => {
  const d = createEventDeduper(3);
  const ev = (id) => ({ type: 'event', v: 3, id, kind: 'notice', data: {} });
  for (let i = 1; i <= 5; i++) d.first(ev(i));
  assert.equal(d.first(ev(5)), false);
  assert.equal(d.first(ev(1)), true, 'aged out of the window');
});

// ---- players ----
test('player state is isolated per id', () => {
  const r = createPlayerRegistry();
  const a = r.add('0', 0, 0), b = r.add('1', 5, 5);
  a.weapon = 3; a.energy = 20;
  assert.equal(b.weapon, 0);
  assert.equal(b.energy, 100);
  assert.equal(r.add('0'), a, 'adding twice does not reset');
});

test('terminator target: nearest player who is up', () => {
  const r = createPlayerRegistry();
  r.add('0', 0, 0); r.add('1', 20, 0);
  assert.equal(r.nearestEligible(15, 0).id, '1');
  assert.equal(r.nearestEligible(5, 0).id, '0');
  r.down('0');
  assert.equal(r.nearestEligible(5, 0).id, '1', 'a downed player is not eligible');
  r.down('1');
  assert.equal(r.nearestEligible(5, 0), null);
  assert.equal(r.nearestEligible(5, 0, 1), null);
});

test('revive: needs range + hold, interrupted by leaving range, release or being downed', () => {
  const r = createPlayerRegistry();
  const a = r.add('0', 0, 0), b = r.add('1', 1, 0);
  r.down('1');
  a.wantsRevive = true;
  r.update(REVIVE.hold - 0.5);
  assert.equal(b.state, 'down');
  a.x = 50; // out of range: interrupted, progress lost
  r.update(1);
  assert.equal(b.reviveProgress, 0);
  a.x = 0;
  r.update(REVIVE.hold - 0.5);
  a.wantsRevive = false;
  r.update(1);
  assert.equal(b.reviveProgress, 0, 'releasing interrupts');
  a.wantsRevive = true;
  const res = r.update(REVIVE.hold + 0.1);
  assert.deepEqual(res.revived, ['1']);
  assert.equal(b.state, 'up');
  assert.ok(b.shield > 0);
  assert.equal(r.down('1'), false, 'revive shield protects briefly');
});

test('a downed reviver interrupts the revive; bleed-out kills', () => {
  const r = createPlayerRegistry();
  const a = r.add('0', 0, 0), b = r.add('1', 1, 0);
  r.down('1');
  a.wantsRevive = true;
  r.update(2);
  assert.ok(b.reviveProgress > 0);
  r.down('0');
  r.update(0.1);
  assert.equal(b.reviveProgress, 0);
  const out = r.update(REVIVE.bleedOut);
  assert.ok(out.died.includes('1'));
  assert.equal(b.state, 'dead');
});

test('co-op game over only when every player is down or dead', () => {
  const r = createPlayerRegistry();
  assert.equal(r.gameOver(), false, 'no players is not game over');
  r.add('0'); r.add('1');
  r.down('0');
  assert.equal(r.gameOver(), false);
  r.down('1');
  assert.equal(r.gameOver(), true);
});

test('single-player compatibility: one player down is game over, none registered is not', () => {
  const r = createPlayerRegistry();
  r.add('0');
  r.down('0');
  assert.equal(r.gameOver(), true);
});

test('friendly fire is on (decision D4): partners can hurt each other, never self through this policy', () => {
  const r = createPlayerRegistry();
  assert.equal(r.canDamagePlayer('0', '1'), true);
  assert.equal(r.canDamagePlayer('1', '0'), true);
  assert.equal(r.canDamagePlayer('0', '0'), false);
});

test('seats: one occupant per seat, handoff, occupied, downing and disconnect', () => {
  const r = createPlayerRegistry();
  r.add('0'); r.add('1'); r.add('2');
  assert.deepEqual(r.enterSeat('0', 7), { ok: true, seat: 0 });
  assert.deepEqual(r.enterSeat('1', 7), { ok: true, seat: 1 });
  assert.equal(r.enterSeat('2', 7).error, 'occupied');
  assert.equal(r.enterSeat('0', 8).error, 'already-seated');
  assert.deepEqual(r.controls('0'), { move: false, aim: false, steer: true });
  assert.deepEqual(r.controls('1'), { move: false, aim: true, steer: false });
  r.down('0'); // driver downed: passenger takes the wheel
  assert.equal(r.get('1').seat.seat, 0);
  assert.deepEqual(r.occupants(7), ['1', null]);
  r.remove('1'); // disconnect frees the vehicle
  assert.deepEqual(r.occupants(7), [null, null]);
  assert.deepEqual(r.controls('0'), { move: false, aim: false, steer: false }, 'downed: no controls');
});

test('rescued townspeople are not seats (separate accounting)', () => {
  const r = createPlayerRegistry();
  r.add('0');
  r.enterSeat('0', 1, 1);
  assert.equal(r.get('0').seat.seat, 1);
  assert.equal(r.occupants(1)[0], null);
});
