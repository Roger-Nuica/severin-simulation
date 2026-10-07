import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/app/tornado/engine/net/protocol.js';
import {
  GUEST_WEAPONS, KATANA_HALF_ANGLE, weaponAt, pickTrigger, notePending, resolveTrigger, coolDown
} from '../src/app/tornado/engine/net/guestWeapons.js';

const idx = (name) => WEAPONS.indexOf(name);
const pull = (name, aim = true) => ({ weapon: idx(name), aim });
const msg = (name, o = {}) => ({ fire: true, aim: true, weapon: idx(name), ...o });

test('the table matches the wheel one for one, in wheel order (R-049)', () => {
  assert.deepEqual(WEAPONS, ['rifle', 'minigun', 'railgun', 'fire', 'blackhole', 'katana']);
  assert.deepEqual(Object.keys(GUEST_WEAPONS), WEAPONS);
  WEAPONS.forEach((name, i) => assert.equal(weaponAt(i), GUEST_WEAPONS[name], name));
  assert.equal(weaponAt(-1), null);
  assert.equal(weaponAt(WEAPONS.length), null);
});

test('table values are the ones the host used before the extraction', () => {
  assert.deepEqual(GUEST_WEAPONS.rifle, { mode: 'ray', cooldown: 0.45, range: 140, needsAim: true, type: 'plasma' });
  assert.deepEqual(GUEST_WEAPONS.minigun, { mode: 'ray', cooldown: 0.09, range: 100, needsAim: true, type: 'bullet' });
  assert.deepEqual(GUEST_WEAPONS.railgun, { mode: 'ray', cooldown: 0.2, range: 220, needsAim: true, type: 'bolt' });
  assert.equal(GUEST_WEAPONS.fire.mode, 'flame');
  assert.equal(GUEST_WEAPONS.fire.cooldown, 0);
  assert.equal(GUEST_WEAPONS.blackhole.cooldown, 0.6);
  assert.equal(GUEST_WEAPONS.katana.cooldown, 0.5);
  assert.equal(GUEST_WEAPONS.katana.range, 3.6);
  assert.equal(KATANA_HALF_ANGLE, 0.9);
});

for (const name of ['rifle', 'minigun', 'railgun', 'fire', 'blackhole']) {
  test(`${name}: needs the weapon raised, then fires`, () => {
    assert.equal(resolveTrigger(pull(name, false), 0).verdict, 'unraised');
    assert.equal(resolveTrigger(pull(name, false), 5).verdict, 'unraised');
    const ok = resolveTrigger(pull(name, true), 0).verdict;
    assert.equal(ok, name === 'fire' ? 'flame' : 'shoot');
  });
}

test('katana works without raising it (R-051)', () => {
  assert.equal(resolveTrigger(pull('katana', false), 0).verdict, 'shoot');
  assert.equal(resolveTrigger(pull('katana', true), 0).verdict, 'shoot');
  assert.equal(resolveTrigger(pull('katana', false), 0.2).verdict, 'cooldown');
});

test('cooldown: ray weapons, the katana and the black hole wait it out; the flame never does', () => {
  for (const name of ['rifle', 'minigun', 'railgun', 'blackhole', 'katana']) {
    assert.equal(resolveTrigger(pull(name), 0.01).verdict, 'cooldown', name);
    assert.equal(resolveTrigger(pull(name), 0).verdict, 'shoot', name);
  }
  assert.equal(resolveTrigger(pull('fire'), 3).verdict, 'flame');
});

test('no trigger, or a weapon off the wheel, does nothing', () => {
  assert.equal(resolveTrigger(null, 0).verdict, 'none');
  assert.equal(resolveTrigger({ weapon: 99, aim: true }, 0).verdict, 'none');
});

test('range per weapon: rays reach their range, the katana its reach', () => {
  assert.deepEqual(['rifle', 'minigun', 'railgun', 'katana'].map((n) => GUEST_WEAPONS[n].range), [140, 100, 220, 3.6]);
});

test('cooldown depends on host time only, not on how many messages arrived', () => {
  // One second of host time in 60 frames, with 0, 1 or 5 input messages per frame: same cooldown.
  const run = (messagesPerFrame) => {
    let cd = GUEST_WEAPONS.railgun.cooldown;
    let shots = 0;
    for (let f = 0; f < 120; f++) {
      cd = coolDown(cd, 1 / 60);
      for (let m = 0; m < messagesPerFrame; m++) { /* messages never touch the cooldown */ }
      if (resolveTrigger(pull('railgun'), cd).verdict === 'shoot') { shots++; cd = GUEST_WEAPONS.railgun.cooldown; }
    }
    return shots;
  };
  assert.equal(run(0), run(1));
  assert.equal(run(1), run(5));
  assert.ok(run(1) >= 8 && run(1) <= 10, `${run(1)} shots`); // 2 s at the host's 0.2 s cooldown, first shot ready after 0.2 s
  assert.equal(coolDown(0.05, 1), 0);
});

test('a fire message overwritten in the same frame is not lost, and shoots once', () => {
  let pending = null;
  pending = notePending(pending, msg('rifle'));              // click arrives
  const latest = msg('rifle', { fire: false });               // newer message: released
  pending = notePending(pending, latest);                     // does not clear it
  const trigger = pickTrigger(latest, pending);
  assert.deepEqual(trigger, pull('rifle'));
  assert.equal(resolveTrigger(trigger, 0).verdict, 'shoot');
  // The host looked at it: nothing pending, no duplicate shot next frame.
  pending = null;
  assert.equal(pickTrigger(latest, pending), null);
});

test('a held fire is read from the latest message; a duplicate click is held off by the cooldown', () => {
  const held = msg('minigun');
  assert.deepEqual(pickTrigger(held, null), pull('minigun'));
  let cd = 0;
  let shots = 0;
  for (let f = 0; f < 6; f++) { // two messages for one click across frames, 16 ms apart
    cd = coolDown(cd, 0.016);
    const t = pickTrigger(f < 2 ? held : msg('minigun', { fire: false }), null);
    if (resolveTrigger(t, cd).verdict === 'shoot') { shots++; cd = GUEST_WEAPONS.minigun.cooldown; }
  }
  assert.equal(shots, 1);
});

test('the pending pull keeps the weapon and raised state it was made with', () => {
  const pending = notePending(null, msg('rifle', { aim: false }));
  const latest = msg('railgun', { fire: false, aim: true });
  const t = pickTrigger(latest, pending);
  assert.deepEqual(t, { weapon: idx('rifle'), aim: false });
  assert.equal(resolveTrigger(t, 0).verdict, 'unraised');
});
