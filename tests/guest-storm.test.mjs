import test from 'node:test';
import assert from 'node:assert/strict';
import { stormRow, ringRadius, ringOpacity, ringStarted, RING_MAX, RING_SNAP } from '../src/app/tornado/engine/net/stormFx.js';
import { PROTOCOL_VERSION as V, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const id = (v) => v;

test('the row is idle-free and carries the charge and the ring', () => {
  assert.equal(stormRow(null, id), null);
  assert.deepEqual(stormRow({ charge: 0.456, ring: null }, id), [0, 0.46, 0, 0, 0]);
  assert.deepEqual(stormRow({ charge: 2, ring: { x: 10.04, z: -3, radius: 999 } }, id), [0, 1, 10, -3, RING_MAX]);
});

test('the ring runs on locally and snaps to the host when far apart', () => {
  assert.equal(ringRadius(0, 0, 0.1), 0);
  assert.equal(ringRadius(0, 12, 0.1), 12);
  assert.ok(ringRadius(100, 100, 0.05) >= 100);
  assert.equal(ringRadius(300, 20, 0.1), 20);
  assert.ok(RING_SNAP > 0);
  assert.ok(ringOpacity(0) > ringOpacity(RING_MAX / 2));
  assert.equal(ringOpacity(RING_MAX), 0);
  assert.equal(ringStarted(0, 5), true);
  assert.equal(ringStarted(5, 9), false);
});

test('storm is an additive optional snapshot kind with its own validation', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ storm: [[0, 0.5, 10, -10, 120]] })).ok, true);
  assert.equal(validateSnapshot(base({ storm: [[0, 1.5, 0, 0, 0]] })).ok, false);
  assert.equal(validateSnapshot(base({ storm: [[0, 0.5, 0, 0, 999]] })).ok, false);
  assert.equal(validateSnapshot(base({ storm: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] })).ok, false);
});
