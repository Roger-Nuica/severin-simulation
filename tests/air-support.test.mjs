import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIR, mayStartStrike, mayKill, nextWeapon, pickTarget } from '../src/app/tornado/engine/airSupport/plan.js';

test('three jets, thirty seconds in, one alien per five seconds', () => {
  assert.equal(AIR.jets, 3);
  assert.equal(AIR.callsigns.length, 3);
  assert.equal(AIR.arriveAfter, 30);
  assert.equal(AIR.killEvery, 5);
});

test('a run waits while another is on its way in', () => {
  assert.equal(mayStartStrike({ busy: true, now: 100, lastKill: -Infinity, lead: 4 }), false);
  assert.equal(mayStartStrike({ busy: false, now: 100, lastKill: -Infinity, lead: 4 }), true);
});

test('a run starts only if its hit lands five seconds after the last kill', () => {
  assert.equal(mayStartStrike({ busy: false, now: 10, lastKill: 9, lead: 3 }), false);
  assert.equal(mayStartStrike({ busy: false, now: 10, lastKill: 9, lead: 4 }), true);
});

test('the hard limit: no two kills less than five seconds apart', () => {
  assert.equal(mayKill(14.9, 10), false);
  assert.equal(mayKill(15, 10), true);
  assert.equal(mayKill(0, -Infinity), true);
});

test('the weapons take turns, mostly', () => {
  assert.equal(nextWeapon('gun', 0.1), 'rockets');
  assert.equal(nextWeapon('rockets', 0.1), 'gun');
  assert.equal(nextWeapon('gun', 0.9), 'gun');
  assert.ok(['gun', 'rockets'].includes(nextWeapon(null, 0.3)));
});

test('the nearest alien, but not one beside Roger', () => {
  const aliens = [{ x: 10, z: 0 }, { x: 40, z: 0 }];
  assert.equal(pickTarget(aliens, { x: 0, z: 0 }, null), 0);
  assert.equal(pickTarget(aliens, { x: 0, z: 0 }, { x: 12, z: 0 }), 1);
  assert.equal(pickTarget([{ x: 10, z: 0 }], { x: 0, z: 0 }, { x: 10, z: 0 }), 0);
  assert.equal(pickTarget([], { x: 0, z: 0 }, null), -1);
});

test('too close to dive on is skipped', () => {
  const aliens = [{ x: 50, z: 0 }, { x: 300, z: 0 }];
  assert.equal(pickTarget(aliens, { x: 0, z: 0 }, null, { minDist: 200 }), 1);
  assert.equal(pickTarget([{ x: 50, z: 0 }], { x: 0, z: 0 }, null, { minDist: 200 }), -1);
});
