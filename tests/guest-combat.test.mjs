import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShooter, aimShooter, tell, credit, pointAlong, withinRange, tooClose, KILL_CREDIT
} from '../src/app/tornado/engine/hero/shooter.js';
import { GUEST_WEAPONS, RAY_FX } from '../src/app/tornado/engine/net/guestWeapons.js';

const v = (x, y, z) => ({ x, y, z });

test('the host shooter keeps the camera vectors by reference and never credits or notifies (single player unchanged)', () => {
  const host = createShooter('0', true);
  const eye = v(1, 2, 3), dir = v(0, 0, 1), feet = { x: 1, z: 3 };
  aimShooter(host, eye, dir, feet);
  assert.equal(host.eye, eye);
  assert.equal(host.dir, dir);
  assert.equal(host.feet, feet);
  assert.equal(host.isHost, true);
  assert.equal(host.score, null);
  assert.equal(host.notify, null);
  credit(host, 20, false); // a no-op: the host's score is the shared path's alone
});

test('presentation goes to the host screen for the host and to the notice for a guest', () => {
  const seen = [];
  const host = createShooter('0', true);
  const guest = createShooter('1', false);
  guest.notify = (t) => seen.push(`guest:${t}`);
  tell(host, 'A', (t) => seen.push(`host:${t}`));
  tell(guest, 'B', (t) => seen.push(`host:${t}`));
  assert.deepEqual(seen, ['host:A', 'guest:B']);
  // A guest with no notice port stays silent and never reaches the host's screen.
  const quiet = createShooter('2', false);
  tell(quiet, 'C', (t) => seen.push(`host:${t}`));
  assert.equal(seen.length, 2);
});

test('a guest is credited once per call: counted points are only echoed, others are added then echoed', () => {
  const log = [];
  const guest = createShooter('1', false);
  guest.score = (points, counted) => log.push([points, counted]);
  credit(guest, 20, false);
  credit(guest, 40, true);
  assert.deepEqual(log, [[KILL_CREDIT, false], [40, true]]);
  assert.equal(KILL_CREDIT, 20);
});

test('pointAlong walks the aim from the eye (the guest, with its jetpack height)', () => {
  const guest = createShooter('1', false);
  aimShooter(guest, v(10, 30, -4), v(0, -0.6, 0.8), { x: 10, z: -4 }, 28.6);
  const out = v(0, 0, 0);
  assert.equal(pointAlong(guest, 10, out), out);
  assert.deepEqual(out, { x: 10, y: 24, z: 4 });
});

test('a shot beyond the weapon reach is no hit; within it, the trace stands', () => {
  const far = { t: 300, kind: 'building', obj: {} };
  const near = { t: 50, kind: 'person', obj: {} };
  assert.deepEqual(withinRange(far, GUEST_WEAPONS.rifle.range), { t: GUEST_WEAPONS.rifle.range, kind: 'sky', obj: null });
  assert.equal(withinRange(near, GUEST_WEAPONS.rifle.range), near);
});

test('the railgun refuses a point inside its minimum range of the shooter feet, either player', () => {
  const guest = createShooter('1', false);
  aimShooter(guest, v(0, 1.4, 0), v(0, 0, 1), { x: 0, z: 0 });
  assert.equal(tooClose(guest, { x: 0, z: 8.9 }, 9), true);
  assert.equal(tooClose(guest, { x: 0, z: 9 }, 9), false);
});

test('the three hitscan weapons each have an fx kind and a table row (gating only)', () => {
  assert.deepEqual(RAY_FX, { rifle: 'plasma', minigun: 'bullet', railgun: 'rail' });
  for (const name of Object.keys(RAY_FX)) assert.equal(GUEST_WEAPONS[name].mode, 'ray');
});
