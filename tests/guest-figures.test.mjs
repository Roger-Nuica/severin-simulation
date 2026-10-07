import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIGURE, HANK_STATE, HAVOC_STATE, SAMURAI_STATE, HAVOC_SPIN_MAX, hankRow, havocRow, samuraiRow,
  newHankPose, hankWant, hankGlow, applyHank, poseHavoc, cutAngle, poseSamurai
} from '../src/app/tornado/engine/net/figurePose.js';
import { PROTOCOL_VERSION as V, LIMITS, EXTRA_ROW_WIDTH, validateSnapshot } from '../src/app/tornado/engine/net/protocol.js';
import { createSnapshotBuffer } from '../src/app/tornado/engine/net/interp.js';
import { GUNNER } from '../src/app/tornado/engine/gunner/config.js';
import { HANK } from '../src/app/tornado/engine/hank/moves.js';

const base = (o = {}) => ({ type: 'snapshot', v: V, room: 'ABCDEF', tick: 1, t: 1, score: 0, players: [[0, 1, 2, 0, 0, 0, 100, -1, -1]], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [], ...o });
const id = (v) => v;
const C = { windup: 0.26, swing: 0.13, recover: 0.3, runSpeed: 8.5, deathSeconds: 0.8 };

test('Hank row: id 0, type, nine columns, rounded and clamped, arm as 0 or 1', () => {
  const row = hankRow({ x: 999.123, y: -1.234, z: 5, heading: 1.5, state: HANK_STATE.wind, a: 1.7, b: 0.9 }, (v) => Math.min(400, v));
  assert.deepEqual(row, [0, FIGURE.hank, 400, -1.23, 5, 1.5, HANK_STATE.wind, 1, 1]);
  assert.equal(row.length, EXTRA_ROW_WIDTH.figures);
});

test('HAVOC row: phase to state, spin and heat; stunned and going down override', () => {
  const s = { x: 1, y: 0, z: 2, yaw: 0.5, phase: 'firing', stunned: false, spin: HAVOC_SPIN_MAX, heat: 0.456, dying: false, dead: 0 };
  assert.deepEqual(havocRow(7, s, id), [7, FIGURE.havoc, 1, 0, 2, 0.5, HAVOC_STATE.firing, 1, 0.46]);
  assert.equal(havocRow(7, { ...s, phase: 'spinning', spin: 20 }, id)[6], HAVOC_STATE.spinning);
  assert.equal(havocRow(7, { ...s, phase: 'spinning', spin: 20 }, id)[7], 0.5);
  assert.equal(havocRow(7, { ...s, phase: 'cooling' }, id)[6], HAVOC_STATE.cooling);
  assert.equal(havocRow(7, { ...s, phase: 'walking' }, id)[6], HAVOC_STATE.walking);
  assert.equal(havocRow(7, { ...s, stunned: true }, id)[6], HAVOC_STATE.stunned);
  const down = havocRow(7, { ...s, dying: true, dead: 0.45 }, id);
  assert.equal(down[6], HAVOC_STATE.down);
  assert.equal(down[8], 0.5);
  assert.equal(havocRow(7, { ...s, dying: true, dead: 9 }, id)[8], 1);
});

test('samurai row: walking, cutting (seconds into the cut), dying (seconds into the fall), colour', () => {
  const s = { x: 3, y: 0.2, z: 4, heading: 2, phase: 'hunt', swing: -1, timer: 0, variant: 5 };
  assert.deepEqual(samuraiRow(9, s, id), [9, FIGURE.samurai, 3, 0.2, 4, 2, SAMURAI_STATE.walking, 0, 3]);
  const cut = samuraiRow(9, { ...s, swing: 0.3 }, id);
  assert.equal(cut[6], SAMURAI_STATE.cutting);
  assert.equal(cut[7], 0.3);
  const dead = samuraiRow(9, { ...s, phase: 'dying', timer: 1.234, swing: -1 }, id);
  assert.equal(dead[6], SAMURAI_STATE.dying);
  assert.equal(dead[7], 1.23);
  assert.equal(samuraiRow(9, { ...s, phase: 'exiting', variant: 2 }, id)[6], SAMURAI_STATE.walking);
});

test('Hank: rest breathes, walking swings legs and arms, a wind-up cocks the chosen arm and twists the body', () => {
  const w = newHankPose();
  hankWant(HANK_STATE.standing, 0, 0, 0, 0, 0, w);
  assert.ok(Math.abs(w.s0x + 0.1) < 1e-9 && w.e0x === -0.35 && w.legs === 0 && w.tx === 0.05);
  hankWant(HANK_STATE.standing, 0, 0, Math.PI / 2, 1, 0, w);
  assert.ok(Math.abs(w.legs - 0.5) < 1e-9 && Math.abs(w.s0x + 0.4) < 1e-9 && Math.abs(w.s1x - 0.4) < 1e-9);
  hankWant(HANK_STATE.wind, 1, 0, 0, 0, 0, w);
  assert.ok(w.s0x === 0.55 && w.e0x === -1.85 && w.ty > 0.7 && w.drop < 0);
  hankWant(HANK_STATE.wind, 1, 1, 0, 0, 0, w);
  assert.ok(w.s1x === 0.55 && w.ty < -0.7);
  hankWant(HANK_STATE.after, 0, 0, 0, 0, 0, w);
  assert.ok(w.s0x === -1.55 && w.ty < 0);
  hankWant(HANK_STATE.throw, 0, 0, 0, 0, 0, w);
  assert.ok(w.s1x === -2.6);
  hankWant(HANK_STATE.stagger, 0, 0, 0, 0, 0, w);
  assert.ok(w.tx === 0.35 && w.drop === -0.2);
});

test('Hank glows more winding up and just after a blow, less crumbling', () => {
  assert.equal(hankGlow(HANK_STATE.standing, 0), 1.2);
  assert.ok(hankGlow(HANK_STATE.wind, 1) > hankGlow(HANK_STATE.wind, 0.2));
  assert.equal(hankGlow(HANK_STATE.after, 0), 4);
  assert.equal(hankGlow(HANK_STATE.crumble, 1), 0.2);
  assert.ok(Math.abs(hankGlow(HANK_STATE.crumble, 0) - 1.2) < 1e-9);
});

const joint = () => ({ rotation: { x: 0, y: 0 }, position: { y: 0 } });

test('Hank eases the held pose towards the wanted one and writes the joints', () => {
  const j = { torso: joint(), hip0: joint(), hip1: joint(), sh0: joint(), sh1: joint(), el0: joint(), el1: joint() };
  const has = newHankPose();
  const want = hankWant(HANK_STATE.stagger, 0, 0, 0, 0, 0, newHankPose());
  applyHank(j, has, want, 1 / 60);
  assert.ok(j.torso.rotation.x > 0.05 && j.torso.rotation.x < 0.35);
  for (let i = 0; i < 120; i++) applyHank(j, has, want, 1 / 60);
  assert.ok(Math.abs(j.torso.rotation.x - 0.35) < 1e-3);
  assert.ok(Math.abs(j.torso.position.y - 1.25) < 1e-3);
  assert.equal(j.hip1.rotation.x, -j.hip0.rotation.x);
});

const part = () => ({ rotation: { x: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, visible: true, scale: { setScalar() {} } });
const havocParts = () => ({
  body: part(), legs: [part(), part()],
  guns: [{ gun: part(), barrels: part(), flash: part() }, { gun: part(), barrels: part(), flash: part() }],
  heat: { emissive: { r: 0, setRGB(r) { this.r = r; } } }, visor: { color: { setRGB() {} } }, marker: part()
});

test('HAVOC: the barrels turn with the spin, flash while firing, glow with the heat; a fall topples the body', () => {
  const p = havocParts();
  poseHavoc(p, HAVOC_STATE.firing, 1, 1, Math.PI / 2, 1, 0, 0.1, () => 0.1);
  assert.ok(Math.abs(p.guns[0].barrels.rotation.z - HAVOC_SPIN_MAX * 0.1) < 1e-9);
  assert.ok(Math.abs(p.guns[1].barrels.rotation.z + HAVOC_SPIN_MAX * 0.1) < 1e-9);
  assert.equal(p.guns[0].flash.visible, true);
  assert.ok(Math.abs(p.legs[0].rotation.x - 0.45) < 1e-9);
  assert.ok(Math.abs(p.heat.emissive.r - 2.2) < 1e-9);
  poseHavoc(p, HAVOC_STATE.cooling, 0.2, 0.5, 0, 0, 0, 0.1, () => 0.1);
  assert.equal(p.guns[0].flash.visible, false);
  poseHavoc(p, HAVOC_STATE.down, 0, 1, 0, 0, 0, 0.1);
  assert.ok(Math.abs(p.body.rotation.x + 1.45) < 1e-9 && Math.abs(p.body.position.z + 0.4) < 1e-9);
  assert.equal(p.marker.visible, false);
});

const samuraiParts = () => ({
  pelvis: { rotation: { x: 0, set() {} }, position: { y: 0 } },
  legL: { rotation: { x: 0, set() {} }, position: { y: 0 } }, legR: { rotation: { x: 0, set() {} }, position: { y: 0 } },
  armL: { rotation: { x: 0, v: null, set(...v) { this.v = v; } }, position: { y: 0 } },
  armR: { rotation: { x: 0, v: null, set(...v) { this.v = v; } }, position: { y: 0 } },
  trail: { visible: false }, trailMat: { opacity: 0 }
});

test('samurai: the cut goes up, comes down and rests, as the host swings it', () => {
  assert.ok(Math.abs(cutAngle(0, C) + 0.9) < 1e-9);
  assert.ok(Math.abs(cutAngle(C.windup, C) + 3.25) < 1e-9);
  assert.ok(Math.abs(cutAngle(C.windup + C.swing, C) + 0.25) < 1e-9);
  assert.ok(Math.abs(cutAngle(10, C) + 0.9) < 1e-9);
});

test('samurai: guards standing, runs fast, shows the trail mid-cut, falls over when dying', () => {
  const r = samuraiParts();
  let t = poseSamurai(r, C, SAMURAI_STATE.walking, 0, 0, 0);
  assert.equal(t.tilt, 0);
  assert.ok(Math.abs(r.armR.rotation.v[0] + 0.95) < 1e-9 && r.trail.visible === false);
  poseSamurai(r, C, SAMURAI_STATE.walking, 0, Math.PI / 2, 1);
  assert.ok(r.legL.rotation.x > 0.5 && r.pelvis.rotation.x === 0.22 && r.armR.rotation.v[0] === 0.55);
  poseSamurai(r, C, SAMURAI_STATE.cutting, C.windup + C.swing + 0.1, 0, 0);
  assert.equal(r.trail.visible, true);
  assert.ok(r.trailMat.opacity > 0);
  t = poseSamurai(r, C, SAMURAI_STATE.dying, C.deathSeconds * 2, 0, 1);
  assert.ok(Math.abs(t.tilt + (Math.PI / 2 - 0.08)) < 1e-9);
  assert.equal(r.legL.rotation.x, 0);
  assert.equal(poseSamurai(r, C, SAMURAI_STATE.dying, C.deathSeconds / 2, 0, 0).tilt, -0.25 * (Math.PI / 2 - 0.08));
});

test('the caps match the actors: Hank 1, HAVOC at most GUNNER.max, ten samurai', () => {
  assert.equal(LIMITS.maxFigures, 1 + GUNNER.max + 10);
  assert.ok(HANK.height > 0);
});

test('a snapshot with figures is valid, and is optional', () => {
  assert.equal(validateSnapshot(base()).ok, true);
  const rows = [[0, 0, 5, -1.2, 6, 1, 1, 0.5, 1], [3, 1, -5, 0, 6, 1, 2, 1, 0.4], [4, 2, 1, 12, 2, -1, 1, 0.3, 3]];
  assert.equal(validateSnapshot(base({ figures: rows })).ok, true);
  assert.equal(validateSnapshot(base({ figures: [] })).ok, true);
});

test('bad figures are refused: width, cap, type, state, bounds, non-numbers', () => {
  const ok = [0, 0, 5, 0, 6, 1, 1, 0.5, 1];
  assert.equal(validateSnapshot(base({ figures: [ok.slice(0, 8)] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: Array.from({ length: LIMITS.maxFigures + 1 }, (_, i) => [i, 2, 0, 0, 0, 0, 0, 0, 0]) })).ok, false);
  assert.equal(validateSnapshot(base({ figures: Array.from({ length: LIMITS.maxFigures }, (_, i) => [i, 2, 0, 0, 0, 0, 0, 0, 0]) })).ok, true);
  assert.equal(validateSnapshot(base({ figures: [[0, 3, 5, 0, 6, 1, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5, 0, 6, 1, 6, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5000, 0, 6, 1, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5, 5000, 6, 1, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5, 0, 6, 1, 1, 11, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5, 0, 6, 1, 1, 0.5, 4]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5, 0, 6, 1, 1.5, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[-1, 0, 5, 0, 6, 1, 1, 0.5, 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: [[0, 0, 5, 0, 6, 1, 1, 'x', 1]] })).ok, false);
  assert.equal(validateSnapshot(base({ figures: 'no' })).ok, false);
});

test('figures interpolate: position and heading blend, type and state take the nearer snapshot', () => {
  const buf = createSnapshotBuffer();
  const snap = (t, figures) => base({ tick: Math.round(t * 15) + 1, t, figures });
  buf.push(snap(1, [[5, 2, 0, 0, 0, 0, 0, 0, 2]]), 1000);
  buf.push(snap(1.2, [[5, 2, 10, 0, 20, 1, 1, 0.2, 2]]), 1200);
  const mid = buf.sample(1100 + 100);
  assert.ok(mid);
  const row = mid.kinds.figures.get(5);
  assert.ok(row);
  assert.ok(row[2] >= 0 && row[2] <= 10 && row[5] >= 0 && row[5] <= 1);
  assert.ok(row[6] === 0 || row[6] === 1);
  assert.equal(row[1], 2);
});

test('an older host sends no figures: the kind is simply empty', () => {
  const buf = createSnapshotBuffer();
  buf.push(base({ t: 1 }), 1000);
  buf.push(base({ t: 1.1, tick: 2 }), 1100);
  const s = buf.sample(1300);
  assert.ok(s);
  assert.equal(s.kinds.figures.size, 0);
});
