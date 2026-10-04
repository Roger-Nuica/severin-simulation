import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUNNER, caught, turnToward, lead, nextPhase } from '../src/app/tornado/engine/gunner/config.js';
import { ENEMY_HEALTH, WEAPON_VS_ENEMY } from '../src/app/tornado/engine/health/damageTable.js';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';

test('rounds stop only in Time Slow, and only near Roger', () => {
  assert.equal(caught(2, true), true);
  assert.equal(caught(GUNNER.catchRadius, true), true);
  assert.equal(caught(GUNNER.catchRadius + 0.1, true), false);
  assert.equal(caught(1, false), false);
});

test('the gun swings round no faster than its traverse', () => {
  assert.equal(turnToward(0, 0.1, 0.5), 0.1);
  assert.equal(turnToward(0, 1, 0.5), 0.5);
  assert.equal(turnToward(0, -1, 0.5), -0.5);
  // The short way round across ±π.
  assert.ok(turnToward(3, -3, 0.1) > 3);
});

test('the lead points ahead of a moving target', () => {
  const p = lead({ x: 0, z: 0 }, { x: 70, z: 0 }, { x: 0, z: 5 }, 70);
  assert.equal(p.x, 70);
  assert.equal(p.z, 5);
});

test('the cycle: walk until in range, spin up, fire, cool down', () => {
  assert.equal(nextPhase('walking', false), 'walking');
  assert.equal(nextPhase('walking', true), 'spinning');
  assert.equal(nextPhase('spinning', true), 'firing');
  assert.equal(nextPhase('firing', true), 'cooling');
  assert.equal(nextPhase('cooling', true), 'spinning');
  assert.equal(nextPhase('cooling', false), 'walking');
});

test('a full caught burst sent back brings him down', () => {
  const caughtBurst = GUNNER.rate * GUNNER.burst * 0.6;
  assert.ok(caughtBurst * WEAPON_VS_ENEMY.gunner.bullet >= ENEMY_HEALTH.gunner);
  assert.equal(ENEMY_HEALTH.gunner, GUNNER.health);
});

test('a round hurts Roger by the configured amount', () => {
  assert.equal(HEALTH.damage.gunnerRound.amount, GUNNER.damage);
});
