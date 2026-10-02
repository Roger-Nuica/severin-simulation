import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';
import { WEAPONS } from '../src/app/tornado/engine/health/damageTable.js';
import {
  SELF_HIT_WEAPONS, insideMuzzleGuard, mayHurtPlayer, splashAmount
} from '../src/app/tornado/engine/health/friendlyFire.js';

test('damageToPlayer covers every weapon column plus the kill sources', () => {
  const d = HEALTH.damageToPlayer;
  SELF_HIT_WEAPONS.forEach((w) => assert.ok(Number.isFinite(d[w]) && d[w] >= 0, w));
  // table columns that are not blast kinds map to a key here
  WEAPONS.filter((w) => w !== 'lightning').forEach((w) => assert.ok(w in d, w));
  assert.ok(Object.isFrozen(d));
});

test('chip weapons never kill; the explosive ones do', () => {
  const d = HEALTH.damageToPlayer;
  ['plasma', 'mega', 'bullet', 'bolt', 'fire', 'blade'].forEach((w) => assert.ok(d[w] < HEALTH.max, w));
  ['blackHole', 'rocket', 'explosion'].forEach((w) => assert.ok(d[w] >= HEALTH.max, w));
  assert.equal(d.emp, 0);
});

test('self-hit guard at the muzzle', () => {
  assert.equal(insideMuzzleGuard(0), true);
  assert.equal(insideMuzzleGuard(NaN), true);
  assert.equal(insideMuzzleGuard(HEALTH.friendlyFire.muzzleGuard), false);
  assert.equal(insideMuzzleGuard(30), false);
});

test('single player never reaches a partner; own splash always counts', () => {
  assert.equal(mayHurtPlayer('0', '0', { coop: false, friendlyFire: true }), true);
  assert.equal(mayHurtPlayer('0', '1', { coop: false, friendlyFire: true }), false);
  assert.equal(mayHurtPlayer('0', '1', { coop: true, friendlyFire: false }), false);
  assert.equal(mayHurtPlayer('0', '1', { coop: true, friendlyFire: true }), true);
});

test('splash falls off linearly and is zero outside the radius', () => {
  assert.equal(splashAmount('plasma', 0, 7), 15);
  assert.equal(splashAmount('plasma', 3.5, 7), 7.5);
  assert.equal(splashAmount('plasma', 7, 7), 0);
  assert.equal(splashAmount('mega', 0, 18), 40);
  assert.equal(splashAmount('nope', 0, 7), 0);
  assert.equal(splashAmount('emp', 0, 36), 0);
  assert.equal(splashAmount('plasma', -1, 7), 0);
});
