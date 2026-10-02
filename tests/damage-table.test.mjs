import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENEMY_HEALTH, WEAPON_VS_ENEMY, WEAPONS, KATANA_EXCLUSIONS, CHIP_FRACTION
} from '../src/app/tornado/engine/health/damageTable.js';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';

const kinds = Object.keys(ENEMY_HEALTH);

test('the table is frozen and exposed through HEALTH', () => {
  assert.ok(Object.isFrozen(ENEMY_HEALTH));
  assert.ok(Object.isFrozen(WEAPON_VS_ENEMY));
  kinds.forEach((k) => assert.ok(Object.isFrozen(WEAPON_VS_ENEMY[k])));
  assert.equal(HEALTH.weaponVsEnemy, WEAPON_VS_ENEMY);
  assert.equal(HEALTH.enemyHealth, ENEMY_HEALTH);
});

test('every enemy x weapon cell is a finite number', () => {
  assert.deepEqual(Object.keys(WEAPON_VS_ENEMY).sort(), [...kinds].sort());
  kinds.forEach((k) => WEAPONS.forEach((w) => {
    assert.ok(Number.isFinite(WEAPON_VS_ENEMY[k][w]), `${k}.${w}`);
    assert.ok(Number.isFinite(ENEMY_HEALTH[k]) && ENEMY_HEALTH[k] > 0, k);
  }));
});

test('zero only for the three katana exclusions', () => {
  kinds.forEach((k) => WEAPONS.forEach((w) => {
    const zero = WEAPON_VS_ENEMY[k][w] === 0;
    assert.equal(zero, w === 'blade' && KATANA_EXCLUSIONS.includes(k), `${k}.${w}`);
  }));
  assert.deepEqual([...KATANA_EXCLUSIONS], ['nuclearPlant', 'mothership', 'tornado']);
});

test('chips follow the single fraction', () => {
  assert.equal(WEAPON_VS_ENEMY.terminator.fire, ENEMY_HEALTH.terminator * CHIP_FRACTION);
});

test('three katana blows destroy a Terminator or pursuer, two do not (R-051)', () => {
  ['terminator', 'pursuer'].forEach((k) => {
    const blade = WEAPON_VS_ENEMY[k].blade;
    assert.ok(ENEMY_HEALTH[k] - blade * 2 > 0, `${k}: two blows leave it standing`);
    assert.ok(ENEMY_HEALTH[k] - blade * 3 <= 0, `${k}: three blows bring it down`);
  });
});

test('runtime baselines are kept', () => {
  const t = WEAPON_VS_ENEMY;
  assert.equal(ENEMY_HEALTH.terminator / t.terminator.bullet, 30);
  assert.equal(ENEMY_HEALTH.yeti, 30);
  assert.equal(t.yeti.fire, 1.2);
  assert.equal(ENEMY_HEALTH.trex, 40);
  assert.deepEqual([t.trex.plasma, t.trex.bullet, t.trex.bolt, t.trex.emp], [3, 0.3, 8, 6]);
  assert.equal(ENEMY_HEALTH.patientZero, 12);
  assert.deepEqual([t.patientZero.plasma, t.patientZero.bullet, t.patientZero.bolt, t.patientZero.emp], [3, 0.5, 6, 4]);
  assert.deepEqual([ENEMY_HEALTH.ufo, ENEMY_HEALTH.hunterShip, ENEMY_HEALTH.mothership], [6, 4, 15]);
  assert.deepEqual([t.hunterShip.plasma, t.hunterShip.mega, t.hunterShip.bullet, t.hunterShip.bolt, t.hunterShip.fire], [1, 5, 0.25, 2, 0.5]);
  assert.equal(ENEMY_HEALTH.nuclearPlant, 5);
  assert.equal(t.mothership.rocket, 8);
});
