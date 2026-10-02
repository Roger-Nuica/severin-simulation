import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION as V, validateInput, validateSnapshot, validateEvent, validateControl, parseFrame, isValidCode } from '../src/app/tornado/engine/net/protocol.js';

const input = (o = {}) => ({ type: 'input', v: V, seq: 1, mx: 0, mz: 1, yaw: 0.5, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false, ...o });

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
  assert.equal(validateSnapshot(snap({ v: 2 })).error, 'version');
});

test('event validation', () => {
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'score', data: { n: 5 } }).ok, true);
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'debris', data: {} }).error, 'kind');
  assert.equal(validateEvent({ type: 'event', v: V, id: 1, kind: 'score', data: { s: 'x'.repeat(2000) } }).error, 'size');
});
