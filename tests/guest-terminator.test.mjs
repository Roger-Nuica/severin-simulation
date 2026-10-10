import test from 'node:test';
import assert from 'node:assert/strict';
import { poseWalk, lieAngle, mapJoints } from '../src/app/tornado/engine/net/terminatorPose.js';

const joint = () => ({ rotation: { x: 0 }, position: { y: 0 } });
const joints = () => ({ hipL: joint(), hipR: joint(), kneeL: joint(), kneeR: joint(), shoulderL: joint(), shoulderR: joint(), body: joint() });

test('standing (amount 0) is the rest pose', () => {
  const j = joints();
  poseWalk(j, 1.3, 0);
  for (const k of Object.keys(j)) assert.equal(j[k].rotation.x + 0, 0);
  assert.equal(j.body.position.y, 0);
});

test('a full stride matches the host walk: legs and arms in opposition', () => {
  const j = joints();
  poseWalk(j, Math.PI / 2, 1);
  assert.ok(Math.abs(j.hipL.rotation.x - 0.55) < 1e-9);
  assert.ok(Math.abs(j.hipR.rotation.x + 0.55) < 1e-9);
  assert.ok(Math.abs(j.kneeR.rotation.x - 0.7) < 1e-9);
  assert.equal(j.kneeL.rotation.x, 0);
  assert.ok(Math.abs(j.shoulderL.rotation.x + 0.4) < 1e-9);
  assert.ok(Math.abs(j.shoulderR.rotation.x - 0.4) < 1e-9);
});

test('a half-speed stride swings less', () => {
  const a = joints(), b = joints();
  poseWalk(a, 1, 1);
  poseWalk(b, 1, 0.5);
  assert.ok(Math.abs(b.hipL.rotation.x) < Math.abs(a.hipL.rotation.x));
});

test('lieAngle: upright while hunting, face down otherwise', () => {
  assert.equal(lieAngle(0), 0);
  assert.ok(lieAngle(1) < -1.4);
});

test('mapJoints points each name at the same place in the clone', () => {
  const mk = () => { const leaf = { children: [] }; const mid = { children: [leaf, { children: [] }] }; return { root: { children: [mid, { children: [] }] }, mid, leaf }; };
  const t = mk(), c = mk();
  const out = mapJoints(t.root, c.root, { a: t.mid, b: t.leaf });
  assert.equal(out.a, c.mid);
  assert.equal(out.b, c.leaf);
});
