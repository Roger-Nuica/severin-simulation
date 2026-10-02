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

// ---------------------------------------------------------------------------
// Roger versus Roger (R-053): the weapon matrix and the pure geometry.
// ---------------------------------------------------------------------------
import { rayBodyDistance, inSector, BODY } from '../src/app/tornado/engine/health/friendlyFire.js';

test('every Roger weapon has a damageToPlayer value (no weapon without effect, R-053)', () => {
  // The column each weapon hurts the other Roger with, as the call sites use them.
  const matrix = { rifle: 'plasma', megaBeam: 'mega', minigun: 'bullet', railgun: 'bolt', fireGun: 'fire', katana: 'blade', blackHole: 'blackHole' };
  for (const [weapon, key] of Object.entries(matrix)) {
    assert.ok(HEALTH.damageToPlayer[key] > 0, `${weapon} -> ${key}`);
  }
  // The protected values are unchanged.
  assert.deepEqual(
    [HEALTH.damageToPlayer.plasma, HEALTH.damageToPlayer.mega, HEALTH.damageToPlayer.blade, HEALTH.damageToPlayer.blackHole],
    [15, 40, 10, 100]
  );
});

test('a ray crosses a player body once, past the muzzle guard and within range', () => {
  // Shooter at the origin, eye 1.4, firing along +z; target 10 m ahead.
  assert.ok(Math.abs(rayBodyDistance(0, 1.4, 0, 0, 0, 1, 50, 0, 10) - 10) < 1e-9);
  assert.equal(rayBodyDistance(0, 1.4, 0, 0, 0, 1, 50, 0, 1), -1, 'inside the muzzle guard');
  assert.equal(rayBodyDistance(0, 1.4, 0, 0, 0, 1, 5, 0, 10), -1, 'beyond maxT (the enemy was nearer)');
  assert.equal(rayBodyDistance(0, 1.4, 0, 0, 0, 1, 50, 0.6, 10), -1, 'wide of the body');
  assert.ok(rayBodyDistance(0, 1.4, 0, 0, 0, 1, 50, 0.4, 10) > 0, 'inside the body radius');
  assert.equal(rayBodyDistance(0, 1.4, 0, 0, 0, 1, 50, 0, -10), -1, 'behind the shooter');
  // Aimed high: over the head at the target's distance.
  const d = Math.hypot(1, 0.2);
  assert.equal(rayBodyDistance(0, 1.4, 0, 0, 0.2 / d, 1 / d, 50, 0, 20), -1);
  assert.equal(BODY.top, 1.9);
});

test('a sector holds the targets in reach and arc, and anything very close', () => {
  const cos = Math.cos(0.9);
  assert.equal(inSector(0, 0, 0, 1, 0, 3, 3.6, cos), true);
  assert.equal(inSector(0, 0, 0, 1, 0, 4, 3.6, cos), false, 'out of reach');
  assert.equal(inSector(0, 0, 0, 1, 3, 0, 3.6, cos), false, 'beside, outside the arc');
  assert.equal(inSector(0, 0, 0, 1, 0, -3, 3.6, cos), false, 'behind');
  assert.equal(inSector(0, 0, 0, 1, 0.01, 0.01, 3.6, cos), true, 'on top of the attacker');
  // The Fire Gun: a narrow cone, with everything within 3 m caught.
  const fire = Math.cos(0.26);
  assert.equal(inSector(0, 0, 0, 1, 0.5, 2, 42, fire, 3), true);
  assert.equal(inSector(0, 0, 0, 1, 0, 40, 42, fire, 3), true);
  assert.equal(inSector(0, 0, 0, 1, 10, 10, 42, fire, 3), false);
});
