import test from 'node:test';
import assert from 'node:assert/strict';
import { strengthForSize, explosionParams, createSoundGate, BLAST_Y, SOUND_PER_SECOND } from '../src/app/tornado/engine/net/explosionFx.js';

test('the energy size maps to the host call sites burst strength', () => {
  assert.equal(strengthForSize(0.06), 0.85);
  assert.equal(strengthForSize(1), 41);
  assert.equal(strengthForSize(0.01), 0.85);
  assert.equal(strengthForSize(99), 46);
  let last = 0;
  for (let s = 0.06; s <= 3; s += 0.05) { const v = strengthForSize(s); assert.ok(v >= last); last = v; }
});

test('explosion data becomes params, bad data is refused', () => {
  assert.deepEqual(explosionParams({ x: 10, z: -4, size: 1 }), { x: 10, y: BLAST_Y, z: -4, strength: 41 });
  assert.equal(explosionParams(null), null);
  assert.equal(explosionParams({ x: 'a', z: 1, size: 1 }), null);
  assert.equal(explosionParams({ x: 1, z: 1 }), null);
  assert.equal(explosionParams({ x: 1, z: Infinity, size: 1 }), null);
});

test('the sound gate allows the cap per second, then again after the window', () => {
  const g = createSoundGate();
  for (let i = 0; i < SOUND_PER_SECOND; i++) assert.equal(g.allow(100 + i), true);
  assert.equal(g.allow(500), false);
  assert.equal(g.allow(1099), false);
  assert.equal(g.allow(1100), true);
});
