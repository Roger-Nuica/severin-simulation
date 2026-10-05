import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock } from '../src/app/tornado/engine/ui/sessionClock.js';
import { GUNNER } from '../src/app/tornado/engine/gunner/config.js';

test('the clock reads m:ss, then h:mm:ss', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(59.9), '0:59');
  assert.equal(formatClock(61), '1:01');
  assert.equal(formatClock(3725), '1:02:05');
});

test('a pair of HAVOC comes a minute in', () => {
  assert.equal(GUNNER.autoAt, 60);
  assert.equal(GUNNER.autoCount, 2);
  assert.ok(GUNNER.autoCount <= GUNNER.max);
});
