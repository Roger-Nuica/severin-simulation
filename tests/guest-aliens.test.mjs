import test from 'node:test';
import assert from 'node:assert/strict';
import { poseAlienWalk, spinSaucer, ALIEN_SWING, SAUCER_SPIN } from '../src/app/tornado/engine/net/alienPose.js';

const limb = () => ({ rotation: { x: 0 } });
const limbs = () => ({ legL: limb(), legR: limb(), armL: limb() });

test('standing is the rest pose', () => {
  const l = limbs();
  poseAlienWalk(l, 1.2, 0);
  for (const k of Object.keys(l)) assert.equal(l[k].rotation.x + 0, 0);
});

test('a full stride matches the host walk: legs opposed, arm against the near leg', () => {
  const l = limbs();
  poseAlienWalk(l, Math.PI / 2, 1);
  assert.ok(Math.abs(l.legL.rotation.x - ALIEN_SWING) < 1e-9);
  assert.ok(Math.abs(l.legR.rotation.x + ALIEN_SWING) < 1e-9);
  assert.ok(Math.abs(l.armL.rotation.x + ALIEN_SWING * 0.6) < 1e-9);
});

test('half speed swings half as far', () => {
  const l = limbs();
  poseAlienWalk(l, Math.PI / 2, 0.5);
  assert.ok(Math.abs(l.legL.rotation.x - ALIEN_SWING / 2) < 1e-9);
});

test('the saucer turns steadily and wraps within one turn', () => {
  assert.ok(Math.abs(spinSaucer(0, 1) - SAUCER_SPIN) < 1e-9);
  const y = spinSaucer(Math.PI * 2 - 0.1, 1);
  assert.ok(y >= 0 && y < Math.PI * 2);
  assert.equal(spinSaucer(1, -5), 1);
});
