import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rogerStyle, newRunCycle, stepRunCycle, swingLimbs, kneeBend, newCameraPose, followCamera, wheelHtml, WHEEL_NAMES
} from '../src/app/tornado/engine/net/rogerView.js';
import { createPlayerRegistry } from '../src/app/tornado/engine/net/players.js';
import { isHittable } from '../src/app/tornado/engine/health/state.js';
import { WEAPONS } from '../src/app/tornado/engine/net/protocol.js';

test('the two Rogers are told apart: original look for the host, teal for a guest', () => {
  const host = rogerStyle('0');
  const guest = rogerStyle('1');
  assert.equal(host.label, 'ROGER');
  assert.equal(host.tee, null, 'the host keeps his own white tee');
  assert.equal(guest.label, 'ROGER 2');
  assert.notEqual(guest.accent, host.accent);
  assert.equal(typeof guest.tee, 'number');
  assert.equal(rogerStyle(1).label, 'ROGER 2', 'a numeric id works too');
  assert.equal(rogerStyle('garbage').label, 'ROGER');
});

test('the run cycle follows the distance moved, not a flag', () => {
  const st = newRunCycle();
  assert.equal(stepRunCycle(st, 0, 0, 0.016, 1, 9), 0, 'first call only records the position');
  assert.equal(st.phase, 0);
  for (let i = 1; i <= 30; i++) stepRunCycle(st, 0, 9 * 0.016 * i, 0.016, 1, 9);
  assert.ok(st.amount > 0.9, 'full run');
  assert.ok(st.phase > 0);
  const phase = st.phase;
  // A teleport (a jump of 25 m in one frame) is not a stride.
  stepRunCycle(st, 0, 500, 0.016, 1, 9);
  assert.equal(st.phase, phase);
  for (let i = 0; i < 60; i++) stepRunCycle(st, 0, 500, 0.016, 1, 9);
  assert.equal(st.amount, 0, 'standing still settles to rest');
  assert.equal(stepRunCycle(st, 1, 1, 0, 1, 9), 0, 'no time passing changes nothing');
});

test('limbs swing in opposition and rest at zero amount', () => {
  const limb = () => ({ rotation: { x: 0 } });
  const limbs = { legL: limb(), legR: limb(), armL: limb(), armR: limb() };
  swingLimbs(limbs, Math.PI / 2, 1);
  assert.ok(limbs.legL.rotation.x > 0 && limbs.legR.rotation.x < 0);
  assert.ok(limbs.armL.rotation.x < 0 && limbs.armR.rotation.x > 0);
  swingLimbs(limbs, Math.PI / 2, 0);
  assert.ok([limbs.legL, limbs.legR, limbs.armL, limbs.armR].every((l) => l.rotation.x === 0 || Object.is(l.rotation.x, -0)));
});

test('knees bend while the leg swings forward, and are straight at rest', () => {
  // The left leg swings forward while cos(phase) < 0, the right while > 0.
  assert.ok(kneeBend(Math.PI, 1, true) > kneeBend(0, 1, true));
  assert.ok(kneeBend(0, 1, false) > kneeBend(Math.PI, 1, false));
  for (const phase of [0, 1, 2, 3, 4, 5, 6]) {
    assert.ok(kneeBend(phase, 1, true) >= 0 && kneeBend(phase, 1, false) >= 0, 'a knee never bends forward');
    assert.equal(kneeBend(phase, 0, true), 0);
  }
  const limb = () => ({ rotation: { x: 0 } });
  const limbs = { legL: limb(), legR: limb(), armL: limb(), armR: limb(), kneeL: limb(), kneeR: limb() };
  swingLimbs(limbs, Math.PI, 1);
  assert.ok(limbs.kneeL.rotation.x > limbs.kneeR.rotation.x);
});

test('the follow camera sits behind Roger, and at his eyes when aiming', () => {
  const cfg = { back: 6, height: 3, lookAhead: 2.5, lookHeight: 1, eye: 1.4 };
  const pose = newCameraPose();
  // Facing +z (yaw 0): the camera is at -z of him.
  assert.equal(followCamera(pose, 10, 20, 0, 0, false, cfg), pose, 'writes into the scratch object');
  assert.ok(Math.abs(pose.px - 10) < 1e-9 && Math.abs(pose.pz - 14) < 1e-9);
  assert.equal(pose.py, 3);
  assert.ok(pose.lz > 20 && !pose.firstPerson);
  // Facing +x (yaw pi/2): behind is -x.
  followCamera(pose, 10, 20, Math.PI / 2, 0, false, cfg);
  assert.ok(Math.abs(pose.px - 4) < 1e-9);
  // Aiming: first person at the eye, looking the way he faces.
  followCamera(pose, 10, 20, 0, 0, true, cfg);
  assert.equal(pose.firstPerson, true);
  assert.equal(pose.py, 1.4);
  assert.ok(pose.lz > pose.pz && Math.abs(pose.ly - pose.py) < 1e-9);
  // Looking up raises the look point; never below the ground.
  followCamera(pose, 10, 20, 0, 1, true, cfg);
  assert.ok(pose.ly > pose.py);
  followCamera(pose, 0, 0, 0, -1, false, { ...cfg, height: 1 });
  assert.ok(pose.py >= 0.6);
});

test('the weapon wheel lists every weapon in the protocol order and lights the held one', () => {
  assert.equal(WHEEL_NAMES.length, WEAPONS.length);
  const html = wheelHtml(5);
  assert.equal((html.match(/class="on"/g) || []).length, 1);
  assert.ok(html.indexOf('class="on"') > html.indexOf('FIRE'));
  assert.ok(html.includes('KATANA'));
});

test('a new run gives every guest the spawn shield and leaves Roger to his own', () => {
  const reg = createPlayerRegistry();
  reg.add('0');
  reg.add('1');
  reg.get('1').shield = 0;
  reg.resetRun(3);
  assert.equal(reg.get('1').shield, 3);
  assert.equal(reg.get('0').shield, 0, 'Roger has his own spawn shield in the hero state');
  assert.equal(isHittable(reg.get('1')), false, 'shielded: no damage lands (the health API checks this)');
  reg.update(3.1);
  assert.equal(reg.get('1').shield, 0);
  assert.equal(isHittable(reg.get('1')), true);
  reg.resetRun();
  assert.equal(reg.get('1').shield, 0, 'no argument keeps the old behaviour');
});
