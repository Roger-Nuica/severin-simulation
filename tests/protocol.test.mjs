import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION as V, validateInput, validateSnapshot, validateEvent, validateControl, parseFrame, isValidCode } from '../src/app/tornado/engine/net/protocol.js';

const input = (o = {}) => ({ type: 'input', v: V, seq: 1, mx: 0, mz: 1, yaw: 0.5, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false, hero: false, ...o });

test('valid input is accepted and normalised', () => assert.equal(validateInput(input()).ok, true));

test('input rejects bad fields', () => {
  for (const bad of [{ mx: 2 }, { mz: NaN }, { seq: -1 }, { seq: 1.5 }, { weapon: 9 }, { abil: 8 }, { fire: 1 }, { pitch: 3 }, { v: 99 }, { x: 5 }, { score: 1e9 }, { position: [0, 0] }]) {
    assert.equal(validateInput(input(bad)).ok, false, JSON.stringify(bad));
  }
});

test('peers cannot smuggle authoritative fields', () => {
  assert.equal(validateInput(input({ damage: 100 })).error, 'field:damage');
});

test('frames: oversize and non-object are rejected', () => {
  assert.equal(parseFrame('x'.repeat(100), 50), null);
  assert.equal(parseFrame('[1]'), null);
  assert.equal(parseFrame('nope'), null);
  assert.deepEqual(parseFrame('{"a":1}'), { a: 1 });
});

test('control messages and codes', () => {
  assert.equal(validateControl({ type: 'create', v: V }).ok, true);
  assert.equal(validateControl({ type: 'create', v: 0 }).error, 'version');
  assert.equal(validateControl({ type: 'join', v: V, code: 'abc' }).ok, false);
  assert.equal(isValidCode('ABCDEF'), true);
  assert.equal(isValidCode('ABCDE0'), false);
});

const snap = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [[0, 5, 5, 20]], terminators: [], aliens: [[0, 1, 0, 1, 0]], ships: [], vehicles: [], ...o });

test('snapshot validation', () => {
  assert.equal(validateSnapshot(snap()).ok, true);
  assert.equal(validateSnapshot(snap({ tick: -1 })).ok, false);
  assert.equal(validateSnapshot(snap({ players: [[0, 1, 2]] })).ok, false);
  assert.equal(validateSnapshot(snap({ tornadoes: [[0, 9999, 0, 1]] })).error, 'bound:tornadoes');
  assert.equal(validateSnapshot(snap({ aliens: [[0, 0, 0, 9999, 0]] })).error, 'bound:aliens');
  assert.equal(validateSnapshot(snap({ vehicles: undefined })).ok, false);
  assert.equal(validateSnapshot(snap({ players: new Array(65).fill([0, 0, 0, 0, 0, 0, 0, -1, -1]) })).error, 'count:players');
  assert.equal(validateSnapshot(snap({ v: 99 })).error, 'version');
});

test('event validation', () => {
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'score', data: { n: 5 } }).ok, true);
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'debris', data: {} }).error, 'kind');
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'score', data: { s: 'x'.repeat(2000) } }).error, 'size');
});

test('snapshot hp field is optional and validated (older hosts omit it)', () => {
  assert.equal(validateSnapshot(snap()).ok, true);
  assert.equal(validateSnapshot(snap({ hp: [[0, 100, 0], [1, 42.5, 3.2]] })).ok, true);
  for (const bad of [{ hp: 'x' }, { hp: [[0, 100]] }, { hp: [[0, 100, 0, 9]] }, { hp: [[0, -1, 0]] }, { hp: [[0, 100, -2]] }, { hp: [[0, NaN, 0]] }]) {
    assert.equal(validateSnapshot(snap(bad)).ok, false, JSON.stringify(bad));
  }
  // The players row keeps its nine columns: a longer row fails the strict width check.
  assert.equal(validateSnapshot(snap({ players: [[0, 1, 2, 0, 0, 0, 100, -1, -1, 80]] })).ok, false);
});

test('snapshot ack field is optional and validated (older hosts omit it)', () => {
  assert.equal('ack' in snap(), false);
  assert.equal(validateSnapshot(snap()).ok, true);
  assert.equal(validateSnapshot(snap({ ack: [] })).ok, true);
  assert.equal(validateSnapshot(snap({ ack: [[1, 0], [2, 4096]], hp: [[1, 100, 0]] })).ok, true);
  const bad = [{ ack: 'x' }, { ack: [[1]] }, { ack: [[1, 2, 3]] }, { ack: [[1, -1]] }, { ack: [[1, 1.5]] }, { ack: [[1.5, 1]] }, { ack: [[1, NaN]] }, { ack: [[1, 0x80000000]] }, { ack: new Array(65).fill([1, 1]) }];
  for (const b of bad) assert.equal(validateSnapshot(snap(b)).error, 'ack', JSON.stringify(b));
  assert.equal(validateSnapshot(snap({ players: [[0, 1, 2, 0, 0, 0, 100, -1, -1, 80]], ack: [[1, 1]] })).ok, false);
  assert.equal(V, 2);
});

test('playerDamage is a replicable event', () => {
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'playerDamage', data: { id: 1, source: 'blackHole', amount: 100 } }).ok, true);
});

test('worst-case snapshot (every kind at the per-kind cap) fits the frame limit', async () => {
  const { LIMITS } = await import('../src/app/tornado/engine/net/protocol.js');
  const rows = (n, w) => Array.from({ length: n }, (_, i) => [i, -123.45, 234.56, 3.14, 1, 4, 100, -1, -1].slice(0, w));
  const full = snap({
    players: rows(LIMITS.maxPerKind, 9), tornadoes: rows(LIMITS.maxPerKind, 4), terminators: rows(LIMITS.maxPerKind, 5),
    aliens: rows(LIMITS.maxPerKind, 5), ships: rows(LIMITS.maxPerKind, 5), vehicles: rows(LIMITS.maxPerKind, 5)
  });
  assert.equal(validateSnapshot(full).ok, true);
  const bytes = JSON.stringify(full).length;
  assert.ok(bytes < LIMITS.maxBytes, `${bytes} bytes`);
  // Sustained worst case at the approved 15 Hz.
  console.log(`# worst-case snapshot ${bytes} B -> ${(bytes * LIMITS.snapshotHz / 1024).toFixed(0)} KiB/s`);
});
