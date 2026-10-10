import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnv, easeValue, unsmooth, slowLook, createSky, MUFFLE_KEY } from '../src/app/tornado/engine/net/skyMirror.js';
import { envRow } from '../src/app/tornado/engine/net/fxOut.js';

const smooth = (x) => x * x * (3 - 2 * x);

function fakeCtx() {
  const muffles = [];
  return {
    muffles,
    Sim: { state: { running: false, stormRamp: 0 }, params: { intensity: 2, windSpeed: 90, radius: 14 } },
    DayNight: { day: true, daylight: 1, follow: null },
    systems: { post: { Post: { bulletTime: 0 } }, sound: { setMuffle: (a, k) => muffles.push([a, k]) } }
  };
}

test('readEnv maps the row, clamps, drops running, and rejects short or non-finite rows', () => {
  const t = readEnv(envRow(true, 0.5, 7, 220, 30, 1, 0.4));
  assert.deepEqual(t, { ramp: 0.5, intensity: 7, wind: 220, radius: 30, daylight: 1, timeScale: 0.4 });
  assert.equal(readEnv([1, 0.5]), null);
  assert.equal(readEnv(null), null);
  assert.equal(readEnv([1, 0, NaN, 0, 0, 0, 1]), null);
  assert.equal(readEnv([1, 9, 99, 5000, 5000, 9, 99]).ramp, 1);
});

test('easeValue moves towards the target, never overshoots, settles exactly, is rate independent', () => {
  assert.equal(easeValue(0, 10, 0, 0.5), 0);
  assert.equal(easeValue(0, 10, 1, 0), 10);
  let a = 0; for (let i = 0; i < 600; i++) a = easeValue(a, 10, 1 / 60, 0.5);
  assert.equal(a, 10);
  const one = easeValue(0, 1, 0.1, 0.5);
  let two = easeValue(0, 1, 0.05, 0.5); two = easeValue(two, 1, 0.05, 0.5);
  assert.ok(Math.abs(one - two) < 1e-9);
});

test('unsmooth inverts the smoothstep dayNight.js shows', () => {
  for (const k of [0, 0.1, 0.5, 0.9, 1]) assert.ok(Math.abs(smooth(unsmooth(k)) - k) < 1e-9);
  assert.ok(Math.abs(unsmooth(-1)) < 1e-9);
  assert.ok(Math.abs(unsmooth(2) - 1) < 1e-9);
});

test('slowLook is on only for a clearly slowed host', () => {
  assert.equal(slowLook(1), false);
  assert.equal(slowLook(0.95), false);
  assert.equal(slowLook(0.3), true);
});

test('apply mirrors the host, keeps running false, and release restores the guest panel values', () => {
  const c = fakeCtx();
  const sky = createSky(c);
  sky.apply(0.016);
  assert.equal(sky.active(), false, 'no row yet: nothing touched');
  sky.feed(envRow(true, 1, 8, 250, 40, 0, 1));
  for (let i = 0; i < 600; i++) sky.apply(1 / 60);
  assert.equal(sky.active(), true);
  assert.equal(c.Sim.state.running, false);
  assert.deepEqual([c.Sim.state.stormRamp, c.Sim.params.intensity, c.Sim.params.windSpeed, c.Sim.params.radius], [1, 8, 250, 40]);
  assert.equal(c.DayNight.follow, 0);
  sky.release();
  assert.deepEqual([c.Sim.params.intensity, c.Sim.params.windSpeed, c.Sim.params.radius], [2, 90, 14]);
  assert.equal(c.DayNight.follow, null);
  assert.equal(c.DayNight.day, true);
  assert.equal(sky.active(), false);
  sky.release();
});

test('the first frame eases from the guest values rather than popping', () => {
  const c = fakeCtx();
  const sky = createSky(c);
  sky.feed(envRow(true, 1, 10, 300, 50, 0, 1));
  sky.apply(0.016);
  assert.ok(c.Sim.params.intensity > 2 && c.Sim.params.intensity < 3);
  assert.ok(c.Sim.state.stormRamp > 0 && c.Sim.state.stormRamp < 0.2);
});

test('Time Slow look: tint and muffle only on a slowed host, once per change, cleared on release', () => {
  const c = fakeCtx();
  const sky = createSky(c);
  sky.feed(envRow(true, 1, 5, 100, 20, 0, 0.3));
  sky.apply(0.016); sky.apply(0.016);
  assert.equal(c.systems.post.Post.bulletTime, 1);
  assert.deepEqual(c.muffles, [[1, MUFFLE_KEY]]);
  sky.feed(envRow(true, 1, 5, 100, 20, 0, 1));
  sky.apply(0.016);
  assert.equal(c.systems.post.Post.bulletTime, 0);
  sky.feed(envRow(true, 1, 5, 100, 20, 0, 0.3));
  sky.apply(0.016);
  sky.release();
  assert.equal(c.systems.post.Post.bulletTime, 0);
  assert.deepEqual(c.muffles.at(-1), [0, MUFFLE_KEY]);
});
