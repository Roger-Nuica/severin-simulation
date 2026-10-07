import test from 'node:test';
import assert from 'node:assert/strict';
import { playedKind, cueDue, CUE_GAP, shotEnd, takeRows, PLAYED } from '../src/app/tornado/engine/net/mirrorRules.js';
import { FX_KINDS } from '../src/app/tornado/engine/net/protocol.js';
import { HIT_CODES, packExtra } from '../src/app/tornado/engine/net/fxOut.js';
import { newFxQueue, dueFx } from '../src/app/tornado/engine/net/fxQueue.js';
import { MIRROR_KEYS, TRACER_KEYS } from '../src/app/tornado/engine/net/shotFeedback.js';

const row = (id, kind, shooter) => [id, FX_KINDS.indexOf(kind), shooter, 0, 1.4, 0, 10, 0, 10, packExtra(0, 0)];
const out = () => ({ x: 0, y: 0, z: 0, kind: '' });
const code = (n) => HIT_CODES.indexOf(n);

test('only the minigun round and the rail bolt are played in this build', () => {
  assert.deepEqual([...PLAYED], ['bullet', 'rail']);
  for (const k of FX_KINDS) assert.equal(playedKind(FX_KINDS.indexOf(k)), PLAYED.includes(k) ? k : null);
  assert.equal(playedKind(99), null);
});

test('own shots draw through the mirror for the minigun and rail, a tracer for the rest', () => {
  assert.deepEqual([...MIRROR_KEYS].sort(), ['minigun', 'railgun']);
  assert.deepEqual([...TRACER_KEYS].sort(), ['blackhole', 'rifle']);
  for (const k of MIRROR_KEYS) assert.ok(!TRACER_KEYS.has(k));
});

test('the guest\'s own shooter is dropped (drawn once), the host\'s and unknown kinds are kept or dropped', () => {
  let q = takeRows(newFxQueue(), [row(1, 'bullet', 1), row(2, 'bullet', 0), [3, 99, 0, 0, 0, 0, 0, 0, 0, 0]], 5, 1);
  const { due } = dueFx(q, 10);
  assert.deepEqual(due.map((r) => r[0]), [2]);
  // a repeat of the same snapshot adds nothing
  q = takeRows(q, [row(2, 'bullet', 0)], 5, 1);
  assert.equal(q.items.length, 1);
  // before welcome the id is -1: the host's shots (shooter 0) are not mistaken for its own
  assert.equal(takeRows(newFxQueue(), [row(4, 'rail', 0)], 1, -1).items.length, 1);
});

test('the cue rate cap', () => {
  assert.ok(cueDue(-Infinity, 0, CUE_GAP.bullet));
  assert.ok(!cueDue(1, 1.03, CUE_GAP.bullet));
  assert.ok(cueDue(1, 1.07, CUE_GAP.bullet));
  assert.ok(CUE_GAP.rail >= CUE_GAP.bullet);
});

test('a ray with no hit that ends under the ground is cut at the ground; above it is sky', () => {
  const e = shotEnd({ x: 0, y: 2, z: 0 }, { x: 10, y: -2, z: 0 }, code('none'), out());
  assert.equal(e.kind, 'ground');
  assert.equal(e.y, 0);
  assert.ok(Math.abs(e.x - 5) < 1e-9);
  assert.equal(shotEnd({ x: 0, y: 2, z: 0 }, { x: 100, y: 30, z: 0 }, code('none'), out()).kind, 'sky');
  assert.equal(shotEnd({ x: 0, y: 2, z: 0 }, { x: 5, y: 0, z: 0 }, code('ground'), out()).kind, 'ground');
});

test('a recorded hit keeps its kind and place (a person takes no sparks, a wall does)', () => {
  const e = shotEnd({ x: 0, y: 2, z: 0 }, { x: 5, y: 3, z: 1 }, code('building'), out());
  assert.deepEqual([e.x, e.y, e.z, e.kind], [5, 3, 1, 'building']);
  assert.equal(shotEnd({ x: 0, y: 2, z: 0 }, { x: 5, y: 1, z: 1 }, code('person'), out()).kind, 'person');
});
