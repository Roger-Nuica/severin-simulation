import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFxRing, RING_CAPACITY, HIT_CODES, hitCode, packExtra, unpackExtra, clampNum, aimRow, holeRow, twRow, envRow, EXTRA_MAX
} from '../src/app/tornado/engine/net/fxOut.js';
import { FX_KINDS, LIMITS, PROTOCOL_VERSION, validateSnapshot, sanitizeFx } from '../src/app/tornado/engine/net/protocol.js';

/** @param {Record<string, any>} extra */
const snapshot = (extra) => ({
  type: 'snapshot', v: PROTOCOL_VERSION, room: 'ABCDEF', tick: 1, t: 1, score: 0,
  players: [], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...extra
});

test('hit codes round-trip through the extra column, and unknown kinds are other', () => {
  for (const k of HIT_CODES) assert.equal(HIT_CODES[hitCode(k)], k);
  assert.equal(hitCode(''), 0);
  assert.equal(HIT_CODES[hitCode('samurai')], 'other');
  const p = packExtra(hitCode('person'), 37);
  assert.deepEqual(unpackExtra(p), { hit: hitCode('person'), extra: 37 });
  assert.deepEqual(unpackExtra(packExtra(2, 1e9)), { hit: 2, extra: EXTRA_MAX });
  assert.deepEqual(unpackExtra(packExtra(2, NaN)), { hit: 2, extra: 0 });
  assert.ok(packExtra(15, EXTRA_MAX) <= 1e4, 'stays inside the validator range');
});

test('a ring row has the fx column order, a monotonic id and clamped numbers', () => {
  const ring = createFxRing(4);
  assert.equal(ring.push('bullet', 0, 1.26, 1.4, -3.04, 10, 0, 20, hitCode('ground'), 0), true);
  assert.equal(ring.push('rail', 1, 500, -500, NaN, 1e6, -1e6, Infinity, 0, 5), true);
  const rows = ring.drain(10);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].slice(0, 9), [1, FX_KINDS.indexOf('bullet'), 0, 1.3, 1.4, -3, 10, 0, 20]);
  assert.equal(rows[0][9], hitCode('ground'));
  assert.deepEqual(rows[1].slice(0, 9), [2, FX_KINDS.indexOf('rail'), 1, 400, -400, 0, 1e4, -1e4, 0]);
  assert.deepEqual(unpackExtra(rows[1][9]), { hit: 0, extra: 5 });
  assert.ok(rows.every((r) => r.length === 10 && r.every(Number.isFinite)));
});

test('an unknown kind is refused and a bad shooter becomes -1', () => {
  const ring = createFxRing(4);
  assert.equal(ring.push('nope', 0, 0, 0, 0, 0, 0, 0, 0, 0), false);
  assert.equal(ring.pending(), 0);
  ring.push('cut', 1.5, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(ring.drain(5)[0][2], -1);
});

test('the ring overwrites its oldest row and counts it dropped', () => {
  const ring = createFxRing(3);
  for (let i = 0; i < 5; i++) ring.push('bullet', 0, i, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(ring.emitted(), 5);
  assert.equal(ring.dropped(), 2);
  const rows = ring.drain(10);
  assert.deepEqual(rows.map((r) => r[0]), [3, 4, 5]);
  assert.deepEqual(rows.map((r) => r[3]), [2, 3, 4]);
  assert.equal(ring.sent(), 3);
  assert.equal(ring.pending(), 0);
});

test('drain honours the cap, leaves the rest queued and keeps ids ordered across snapshots', () => {
  const ring = createFxRing(RING_CAPACITY);
  for (let i = 0; i < 30; i++) ring.push('bullet', 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const a = ring.drain(LIMITS.maxFx);
  const b = ring.drain(LIMITS.maxFx);
  assert.equal(a.length, LIMITS.maxFx);
  assert.equal(b.length, 6);
  assert.equal(ring.drain(LIMITS.maxFx).length, 0);
  const ids = [...a, ...b].map((r) => r[0]);
  assert.deepEqual(ids, ids.map((_, i) => i + 1));
  assert.equal(ring.emitted(), ring.sent() + ring.dropped());
});

test('clear empties the ring and zeroes the counters but never repeats an id', () => {
  const ring = createFxRing(4);
  ring.push('bullet', 0, 0, 0, 0, 0, 0, 0, 0, 0);
  ring.drain(5);
  ring.clear();
  assert.deepEqual([ring.emitted(), ring.sent(), ring.dropped(), ring.pending()], [0, 0, 0, 0]);
  ring.push('bullet', 0, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(ring.drain(5)[0][0], 2);
});

test('every kind the weapons announce is a known fx kind', () => {
  for (const k of ['bullet', 'rail', 'plasma', 'mega', 'holeShot', 'cut', 'bolt', 'emp']) assert.ok(FX_KINDS.includes(k), k);
});

test('state row builders clamp into the validator ranges and never emit NaN', () => {
  assert.equal(clampNum(NaN, 0, 1), 0);
  assert.equal(clampNum(Infinity, -5, 5), 0);
  assert.equal(clampNum(NaN, 2, 5), 2);
  assert.equal(clampNum(5, 0, 1), 1);
  const wild = [NaN, Infinity, -Infinity, 1e9, -1e9];
  for (const v of wild) {
    const snap = snapshot({
      fx: (() => { const r = createFxRing(2); r.push('bullet', 0, v, v, v, v, v, v, 0, v); return r.drain(1); })(),
      aim: [aimRow(v, v, v, v)],
      hole: [holeRow(v, v, v, true)],
      tw: [twRow(v, v, v, v, v, v)],
      env: [envRow(true, v, v, v, v, v, v)]
    });
    assert.deepEqual(validateSnapshot(snap), { ok: true }, `value ${v}`);
  }
});

test('typical live rows validate and keep their meaning', () => {
  const aim = aimRow(1, 7, 0.5, 3);
  assert.ok(aim[1] > -Math.PI - 0.01 && aim[1] <= Math.PI + 0.01, 'yaw wrapped');
  assert.deepEqual(holeRow(12.345, -6.789, 3.21, false), [12.35, -6.79, 3.21, 0]);
  assert.deepEqual(holeRow(0, 0, 20, true), [0, 0, 20, 1]);
  assert.deepEqual(twRow(0, 0.5, 2.5, 1, 0.01, -0.02), [0, 0.5, 2.5, 1, 0.01, -0.02]);
  assert.deepEqual(envRow(true, 1, 0.75, 220, 30, 0, 1), [1, 1, 0.75, 220, 30, 0, 1]);
  assert.deepEqual(envRow(false, 0, 1, 320, 50, 1, 0.2), [0, 0, 1, 320, 50, 1, 0.2]);
  const snap = snapshot({ aim: [aim], hole: [holeRow(1, 2, 3, false)], tw: [twRow(0, 1, 2.4, 1, 0, 0)], env: [envRow(true, 1, 1, 320, 50, 1, 1)] });
  assert.deepEqual(validateSnapshot(snap), { ok: true });
});

test('drained rows survive sanitizeFx unchanged', () => {
  const ring = createFxRing(8);
  for (const k of ['plasma', 'mega', 'cut']) ring.push(k, 0, 1, 2, 3, 4, 5, 6, 1, 10);
  const rows = ring.drain(LIMITS.maxFx);
  assert.deepEqual(sanitizeFx(rows), rows);
});
