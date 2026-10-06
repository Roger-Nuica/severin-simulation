import test from 'node:test';
import assert from 'node:assert/strict';
import { newFeedback, stepFeedback, flashOpacity, SHOT_LOOK, SPIN, SWING, swingAmount } from '../src/app/tornado/engine/net/shotFeedback.js';
import { GUEST_WEAPONS } from '../src/app/tornado/engine/net/guestWeapons.js';

const held = (weapon, extra = {}) => ({ fire: true, aim: true, up: true, weapon, ...extra });

test('a fire press with the weapon raised shoots at once with a flash and a kick', () => {
  const r = stepFeedback(newFeedback(), held(2), 0.016);
  assert.equal(r.shot, 'railgun');
  assert.equal(r.fb.flash, SHOT_LOOK.railgun.life);
  assert.equal(r.fb.recoil, 1);
  assert.equal(r.fb.cd, GUEST_WEAPONS.railgun.cooldown);
});

test('the host cooldown table gates repeats: the minigun fires every 0.09 s, not every frame', () => {
  let fb = newFeedback();
  let shots = 0;
  for (let i = 0; i < 100; i++) { const r = stepFeedback(fb, held(1), 0.01); fb = r.fb; if (r.shot) shots++; }
  assert.ok(shots >= 10 && shots <= 12, `shots ${shots}`);
});

test('an unraised weapon, a downed Roger or no press makes no shot and no cue', () => {
  assert.equal(stepFeedback(newFeedback(), held(0, { aim: false }), 0.016).shot, null);
  assert.equal(stepFeedback(newFeedback(), held(0, { up: false }), 0.016).shot, null);
  assert.equal(stepFeedback(newFeedback(), held(0, { fire: false }), 0.016).shot, null);
});

test('the Katana shoots unraised but has no flash or kick; the Fire Gun is the flame, not a shot', () => {
  const k = stepFeedback(newFeedback(), held(5, { aim: false }), 0.016);
  assert.equal(k.shot, 'katana');
  assert.equal(k.fb.flash, 0);
  assert.equal(k.fb.recoil, 0);
  const f = stepFeedback(newFeedback(), held(3), 0.016);
  assert.equal(f.shot, null);
  assert.equal(f.fb.recoil, 0);
});

test('minigun barrels spin up while held, never past the cap, and wind down after', () => {
  let fb = newFeedback();
  for (let i = 0; i < 200; i++) fb = stepFeedback(fb, held(1), 0.016).fb;
  assert.equal(fb.spin, SPIN.max);
  const down = stepFeedback(fb, held(1, { fire: false }), 0.1).fb;
  assert.ok(down.spin < SPIN.max && down.spin > 0);
  let rifle = newFeedback();
  for (let i = 0; i < 20; i++) rifle = stepFeedback(rifle, held(0), 0.016).fb;
  assert.equal(rifle.spin, 0);
});

test('recoil is capped at 1 and settles; the flash fades and its opacity follows the host rule', () => {
  let fb = newFeedback();
  for (let i = 0; i < 30; i++) fb = stepFeedback(fb, held(1), 0.01).fb;
  assert.ok(fb.recoil <= 1 && fb.recoil > 0);
  fb = stepFeedback(fb, held(1, { fire: false }), 0.5).fb;
  assert.equal(fb.recoil, 0);
  assert.equal(fb.flash, 0);
  assert.equal(fb.flashKey, null);
  assert.equal(flashOpacity(0.04), 0.8);
  assert.equal(flashOpacity(-1), 0);
});

test('an index off the wheel does nothing', () => {
  assert.equal(stepFeedback(newFeedback(), held(9), 0.016).shot, null);
});

test('the Katana starts a swing that goes out and back; the Fire Gun breathes only while held and raised', () => {
  const cut = stepFeedback(newFeedback(), held(5, { aim: false }), 0.016);
  assert.equal(cut.fb.swing, SWING.life);
  assert.equal(swingAmount(0), 0);
  assert.ok(swingAmount(SWING.life / 2) > 0.99);
  assert.ok(swingAmount(SWING.life * 0.99) < 0.1);
  assert.equal(stepFeedback(cut.fb, held(5, { fire: false, aim: false }), SWING.life + 0.1).fb.swing, 0);
  assert.equal(stepFeedback(newFeedback(), held(3), 0.016).flame, true);
  assert.equal(stepFeedback(newFeedback(), held(3, { aim: false }), 0.016).flame, false);
  assert.equal(stepFeedback(newFeedback(), held(3, { fire: false }), 0.016).flame, false);
  assert.equal(stepFeedback(newFeedback(), held(0), 0.016).flame, false);
});
