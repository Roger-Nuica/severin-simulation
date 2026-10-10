import test from 'node:test';
import assert from 'node:assert/strict';
import { newFxQueue, pushFx, dueFx, tornadoTarget, holeAt, INTERP_DELAY } from '../src/app/tornado/engine/net/fxQueue.js';
import { LIMITS } from '../src/app/tornado/engine/net/protocol.js';
import { INTERP_DELAY as BASE_DELAY } from '../src/app/tornado/engine/net/interp.js';

const row = (id, shooter = 0) => [id, 0, shooter, 0, 1, 0, 0, 0, 0, 0];
const ids = (rows) => rows.map((r) => r[0]);

test('it reuses the interpolation delay, not a second clock', () => {
  assert.equal(INTERP_DELAY, BASE_DELAY);
});

test('rows wait for their host time and then play oldest first', () => {
  let q = pushFx(newFxQueue(), [row(2)], 10.2, 1);
  q = pushFx(q, [row(1)], 10.0, 1);
  let r = dueFx(q, 9.9);
  assert.deepEqual(r.due, []);
  r = dueFx(r.queue, 10.1);
  assert.deepEqual(ids(r.due), [1]);
  r = dueFx(r.queue, 10.5);
  assert.deepEqual(ids(r.due), [2]);
  assert.equal(r.queue.items.length, 0);
});

test('duplicate ids are dropped, also after they played', () => {
  let q = pushFx(newFxQueue(), [row(1), row(1)], 5, 1);
  assert.equal(q.items.length, 1);
  q = pushFx(q, [row(1)], 5.1, 1);
  assert.equal(q.items.length, 1);
  q = dueFx(q, 6).queue;
  q = pushFx(q, [row(1)], 6.1, 1);
  assert.equal(q.items.length, 0);
});

test('the guest\'s own shots are dropped, the host\'s kept', () => {
  const q = pushFx(newFxQueue(), [row(1, 1), row(2, 0)], 5, 1);
  assert.deepEqual(ids(q.items.map((i) => i.row)), [2]);
});

test('the cap drops the oldest and never grows past LIMITS.maxFx', () => {
  let q = newFxQueue();
  for (let s = 0; s < 3; s++) q = pushFx(q, Array.from({ length: LIMITS.maxFx }, (_, i) => row(s * 100 + i)), s, 1);
  assert.equal(q.items.length, LIMITS.maxFx);
  assert.ok(q.items.every((i) => i.at === 2));
});

test('reset empties it and ids may repeat after a Restart', () => {
  let q = pushFx(newFxQueue(), [row(1)], 5, 1);
  q = newFxQueue();
  assert.equal(q.items.length, 0);
  assert.equal(pushFx(q, [row(1)], 1, 1).items.length, 1);
});

test('inputs are never changed and empty or bad rows are ignored', () => {
  const q = newFxQueue();
  assert.equal(pushFx(q, undefined, 1, 1), q);
  assert.equal(pushFx(q, [], 1, 1), q);
  assert.equal(pushFx(q, [[1]], 1, 1).items.length, 0);
  assert.equal(q.items.length, 0);
});

test('a row stamped far ahead of render time (clock jumped back) is not held for ever', () => {
  const q = pushFx(newFxQueue(), [row(1)], 100, 1);
  assert.equal(dueFx(q, 10).due.length, 1);
});

test('tornadoTarget blends size, fade and lean, takes the newer birth, clamps k', () => {
  const a = [0, 3, 1, 0, 0, 0];
  const b = [0, 4, 3, 1, 10, -10];
  assert.deepEqual(tornadoTarget(a, b, 0.5), [0, 4, 2, 0.5, 5, -5]);
  assert.deepEqual(tornadoTarget(a, b, 5), b);
  assert.deepEqual(tornadoTarget(a, b, -1), [0, 4, 1, 0, 0, 0]);
});

test('holeAt opens smoothly, holds, swells then collapses to nothing', () => {
  assert.equal(holeAt(0, -1), 0);
  assert.ok(holeAt(0.75, -1) > 0.4 && holeAt(0.75, -1) < 0.6);
  assert.equal(holeAt(10, -1), 1);
  assert.equal(holeAt(10, 0), 1);
  assert.equal(holeAt(10, 1.8), 0);
  assert.ok(holeAt(10, 1.2) < 1);
});
