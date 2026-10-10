import test from 'node:test';
import assert from 'node:assert/strict';
import { firenadoRow, easeStrength, fireStarted, OUT_BELOW } from '../src/app/tornado/engine/net/firenadoFx.js';
import { PROTOCOL_VERSION as V, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });

test('the row is idle-free and carries the envelope', () => {
  assert.equal(firenadoRow(null), null);
  assert.equal(firenadoRow(0), null);
  assert.deepEqual(firenadoRow(0.456), [0, 0.46]);
  assert.deepEqual(firenadoRow(3), [0, 1]);
});

test('the guest eases to the host and goes out cleanly', () => {
  assert.ok(easeStrength(0, 1, 0.1) > 0);
  assert.ok(easeStrength(0, 1, 0.1) < 1);
  assert.equal(easeStrength(OUT_BELOW / 2, 0, 0.1), 0);
  assert.ok(easeStrength(1, 0, 0.05) > 0.5);
  assert.equal(fireStarted(0, 0.2), true);
  assert.equal(fireStarted(0.2, 0.4), false);
});

test('firenado is an additive optional snapshot kind with its own validation', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  assert.equal(validateSnapshot(base({ firenado: [[0, 0.5]] })).ok, true);
  assert.equal(validateSnapshot(base({ firenado: [[0, 1.5]] })).ok, false);
  assert.equal(validateSnapshot(base({ firenado: [[1, 0.5]] })).ok, false);
  assert.equal(validateSnapshot(base({ firenado: [[0, 0.5], [0, 0.5]] })).ok, false);
  assert.equal(validateSnapshot(base({ firenado: [[0, 0.5, 1]] })).ok, false);
});
