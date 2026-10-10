import test from 'node:test';
import assert from 'node:assert/strict';
import { BLD_BIT, MAX_BUILDINGS, FULL_EVERY, pieceBit, bearingDeg, dirOfDeg, createBldTracker, newBits } from '../src/app/tornado/engine/net/bldFx.js';
import { PROTOCOL_VERSION as V, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });

test('piece names map to mask bits', () => {
  assert.equal(pieceBit('roof'), BLD_BIT.roof);
  assert.equal(pieceBit('wall-W'), BLD_BIT.W);
  assert.equal(pieceBit('wall-x'), 0);
  assert.equal(pieceBit(undefined), 0);
});

test('bearing round-trips to a unit direction', () => {
  for (const deg of [0, 45, 90, 180, 270, 359]) {
    const d = dirOfDeg(deg);
    assert.equal(bearingDeg(d.x, d.z), deg);
    assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9);
  }
});

test('the tracker sends changes, a full table every 2 s, never an intact building', () => {
  const masks = new Array(MAX_BUILDINGS).fill(0);
  const dirs = new Array(MAX_BUILDINGS).fill(-1);
  const tr = createBldTracker();
  const rows = (now) => tr.rows(MAX_BUILDINGS, (i) => masks[i], (i) => dirs[i], now);
  assert.deepEqual(rows(0), []);
  masks[3] = BLD_BIT.roof;
  assert.deepEqual(rows(0.1), [[3, 1, -1]]);
  assert.deepEqual(rows(0.2), []);
  masks[3] |= BLD_BIT.collapsed; dirs[3] = 90;
  assert.deepEqual(rows(0.3), [[3, 33, 90]]);
  masks[7] = BLD_BIT.N;
  assert.deepEqual(rows(0.4), [[7, 2, -1]]);
  assert.deepEqual(rows(0.5), []);
  assert.deepEqual(rows(0 + FULL_EVERY + 0.01), [[3, 33, 90], [7, 2, -1]]);
  tr.forceFull();
  assert.equal(rows(2.1).length, 2);
  masks[3] = 0; masks[7] = 0;
  assert.deepEqual(rows(2.2), []);
});

test('a direction counts only once collapsed', () => {
  const tr = createBldTracker();
  const r = tr.rows(2, (i) => (i === 1 ? BLD_BIT.roof : 0), () => 200, 0);
  assert.deepEqual(r, [[1, 1, -1]]);
});

test('the guest applies only bits it has not applied', () => {
  assert.equal(newBits(0, 33), 33);
  assert.equal(newBits(1, 33), 32);
  assert.equal(newBits(33, 33), 0);
  assert.equal(newBits(33, 1), 0);
});

test('bld is an additive optional kind with its own validation', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ bld: [[0, 1, -1], [35, 127, 359]] })).ok, true);
  assert.equal(validateSnapshot(base({ bld: [[36, 1, -1]] })).ok, false);
  assert.equal(validateSnapshot(base({ bld: [[0, 0, -1]] })).ok, false);
  assert.equal(validateSnapshot(base({ bld: [[0, 128, -1]] })).ok, false);
  assert.equal(validateSnapshot(base({ bld: [[0, 1, 360]] })).ok, false);
  assert.equal(validateSnapshot(base({ bld: [[0, 1.5, -1]] })).ok, false);
  assert.equal(validateSnapshot(base({ bld: [[0, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ bld: Array.from({ length: 37 }, (_, i) => [i % 36, 1, -1]) })).ok, false);
});

test('the buffer hands bld rows to the guest by index, discrete', () => {
  const buf = createSnapshotBuffer();
  buf.push(base({ tick: 1, t: 1, bld: [[4, 2, -1]] }), 1);
  buf.push(base({ tick: 2, t: 1.1, bld: [[4, 34, 90]] }), 1.1);
  const s = buf.sample(1.4);
  assert.ok(s.kinds.bld instanceof Map);
  const row = s.kinds.bld.get(4);
  assert.ok(row && Number.isInteger(row[1]) && Number.isInteger(row[2]));
});
