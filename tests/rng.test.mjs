import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/app/tornado/engine/rng.js';

const take = (r, n) => Array.from({ length: n }, r);

test('same seed gives the same sequence', () => {
  assert.deepEqual(take(createRng(1234), 50), take(createRng(1234), 50));
});

test('different seeds diverge', () => {
  assert.notDeepEqual(take(createRng(1), 10), take(createRng(2), 10));
});

test('values are in [0, 1) and generators are independent', () => {
  const a = createRng(7);
  const b = createRng(7);
  a(); a();
  assert.equal(b(), take(createRng(7), 1)[0]);
  for (const v of take(createRng(99), 1000)) assert.ok(v >= 0 && v < 1);
});
