// @ts-check
import * as THREE from 'three';
import { createFireTexture, createSoftDotTexture } from '../../utils/textures.js';
import { CAR_WHEEL_X, CAR_WHEEL_Z } from '../environment/cars.js';
import { CHASE_TUNE } from './car.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';

/**
 * ===========================================================================
 * SECTION C.5 — Chase mode: burning tyres
 * ===========================================================================
 * Fire and smoke pouring off the Chase car's rear wheels as "tyres burning
 * under stress". Not always on: the effect is driven by one stress value,
 * the strongest of three terms --
 *  - hard acceleration (a burnout from a standstill reads instantly),
 *  - sustained high speed (only near the top of the speed range),
 *  - the vortex working on the car (wind force at the car, or the car
 *    being in the capture state machine at all) -- the dominant term by
 *    design, so being dragged towards the funnel is when it goes wildest.
 * Smoke starts at low stress; fire only once stress is well up.
 *
 * Two pooled particle systems (see particlePool.js): fire, additive with
 * the explosion fire texture and pushed past 1.0 so post.js blooms it; and
 * smoke, normal blending with a soft dot, growing as it rises. One draw
 * call each, and nothing is allocated per frame.
 */

const FIRE_COUNT = 180;
const SMOKE_COUNT = 150;
// Particles per second at stress 1.
const FIRE_RATE = 190;
const SMOKE_RATE = 80;
// Stress below which each layer emits nothing.
const SMOKE_STRESS_MIN = 0.12;
const FIRE_STRESS_MIN = 0.35;

// Stress terms.
const ACCEL_FOR_FULL_STRESS = 14;   // world units/s^2 of forward acceleration
const SPEED_STRESS_START = 0.65;    // fraction of max speed where speed starts to count
const WIND_FOR_FULL_STRESS = 3.5;   // windForceMagnitudeAt value treated as "full"
const STRESS_ATTACK = 8;            // how fast stress rises (1/s)...
const STRESS_RELEASE = 1.6;         // ...and dies away, so flames trail off rather than snapping out

// Emission point: just behind and above each rear tyre's contact patch.
const EMIT_HEIGHT = 0.28;
const EMIT_BEHIND = 0.15;

const FIRE_LIFE = [0.28, 0.6];
const SMOKE_LIFE = [1.1, 2.3];
const FIRE_SIZE = [0.3, 0.8];
const SMOKE_SIZE = [0.9, 3.8];      // at birth / at death
// Fire colour over life (linear, HDR): white-hot -> orange -> dull red.
const FIRE_HOT = new THREE.Color(2.4, 1.7, 0.85);
const FIRE_MID = new THREE.Color(1.8, 0.55, 0.12);
const FIRE_COOL = new THREE.Color(0.6, 0.12, 0.03);
const SMOKE_COLOUR = new THREE.Color(0x57524c);
const SMOKE_ALPHA = 0.65;

/** @typedef {import('../particlePool.js').ParticlePool} ParticlePool */

/**
 * @param {Object} ctx
 * @returns {{
 *   TireFire: Object,
 *   initTireFire: () => void,
 *   updateTireFire: (dt: number) => void,
 *   resetTireFire: () => void,
 *   disposeTireFire: () => void
 * }}
 */
export function createTireFireSystem(ctx) {
  const { Sim, Chase } = ctx;

  const TireFire = {
    fire: /** @type {ParticlePool|null} */ (null),
    smoke: /** @type {ParticlePool|null} */ (null),
    stress: 0,
    prevSpeed: 0
  };

  const emitScratch = new THREE.Vector3();
  const windScratch = new THREE.Vector3();

  /** @returns {void} */
  function initTireFire() {
    const scene = Sim.three.scene;
    TireFire.fire = createParticlePool(scene, FIRE_COUNT, createFireTexture(), THREE.AdditiveBlending, 'chaseCar_tireFire');
    TireFire.smoke = createParticlePool(scene, SMOKE_COUNT, createSoftDotTexture(), THREE.NormalBlending, 'chaseCar_tireSmoke');
  }

  /**
   * Current tyre stress, 0..1, before smoothing.
   * @param {number} dt
   * @returns {number}
   */
  function measureStress(dt) {
    const car = Chase.car;
    const accel = (Chase.speed - TireFire.prevSpeed) / Math.max(dt, 1e-4);
    TireFire.prevSpeed = Chase.speed;
    // Only acceleration in the direction of travel strains the tyres this way.
    const drive = Math.sign(Chase.speed || 1) * accel;
    const accelStress = THREE.MathUtils.clamp(drive / ACCEL_FOR_FULL_STRESS, 0, 1);

    const speedFrac = Math.abs(Chase.speed) / CHASE_TUNE.maxSpeed;
    const speedStress = THREE.MathUtils.clamp((speedFrac - SPEED_STRESS_START) / (1 - SPEED_STRESS_START), 0, 1) * 0.8;

    const pos = car.mesh.position;
    windScratch.set(pos.x, 1, pos.z);
    let vortexStress = THREE.MathUtils.clamp(ctx.windForceMagnitudeAt(windScratch) / WIND_FOR_FULL_STRESS, 0, 1);
    if (car.captureState && car.captureState !== 'grounded') vortexStress = 1;

    return Math.max(accelStress, speedStress, vortexStress);
  }

  /**
   * Emits `n` particles into a pool from the two rear-wheel points.
   * @param {ParticlePool} pool
   * @param {number} n
   * @param {boolean} isFire
   * @returns {void}
   */
  function emit(pool, n, isFire) {
    const mesh = Chase.car.mesh;
    const heading = Chase.heading;
    const backX = -Math.sin(heading);
    const backZ = -Math.cos(heading);
    const count = pool.life.length;
    for (let k = 0; k < n; k++) {
      const i = pool.next;
      pool.next = (pool.next + 1) % count;
      const side = (k & 1) ? 1 : -1;
      emitScratch.set(side * CAR_WHEEL_X, EMIT_HEIGHT, -CAR_WHEEL_Z - EMIT_BEHIND);
      mesh.localToWorld(emitScratch);
      pool.positions[i * 3] = emitScratch.x + (Math.random() - 0.5) * 0.25;
      pool.positions[i * 3 + 1] = emitScratch.y + Math.random() * 0.1;
      pool.positions[i * 3 + 2] = emitScratch.z + (Math.random() - 0.5) * 0.25;
      // Thrown hard back even when the car is barely moving (a burnout), so
      // flames stream off the tyre instead of piling up into one glowing ball.
      const back = isFire ? 4 + Math.random() * 4 : 1.5 + Math.random() * 2.5;
      const up = isFire ? 1.5 + Math.random() * 2.5 : 0.8 + Math.random() * 1.2;
      pool.velocities[i * 3] = backX * back + (Math.random() - 0.5) * 1.2;
      pool.velocities[i * 3 + 1] = up;
      pool.velocities[i * 3 + 2] = backZ * back + (Math.random() - 0.5) * 1.2;
      const range = isFire ? FIRE_LIFE : SMOKE_LIFE;
      const life = range[0] + Math.random() * (range[1] - range[0]);
      pool.life[i] = life;
      pool.maxLife[i] = life;
      pool.seed[i] = Math.random();
    }
  }

  /**
   * Ages every live particle in a pool and writes its buffers.
   * @param {ParticlePool} pool
   * @param {number} dt
   * @param {boolean} isFire
   * @returns {void}
   */
  function step(pool, dt, isFire) {
    const count = pool.life.length;
    const drag = Math.max(0, 1 - (isFire ? 2.2 : 0.9) * dt);
    for (let i = 0; i < count; i++) {
      if (pool.life[i] <= 0) {
        pool.colours[i * 4 + 3] = 0;
        pool.sizes[i] = 0;
        continue;
      }
      pool.life[i] -= dt;
      const t = 1 - Math.max(pool.life[i], 0) / pool.maxLife[i]; // 0 at birth -> 1 at death
      const v = i * 3;
      pool.velocities[v] *= drag;
      pool.velocities[v + 2] *= drag;
      // Buoyancy: both keep rising, smoke gently.
      pool.velocities[v + 1] += (isFire ? 1.5 : 0.6) * dt;
      pool.positions[v] += pool.velocities[v] * dt;
      pool.positions[v + 1] += pool.velocities[v + 1] * dt;
      pool.positions[v + 2] += pool.velocities[v + 2] * dt;

      const c = i * 4;
      if (isFire) {
        const col = t < 0.4
          ? emitScratch.set(0, 0, 0).lerpVectors(colourVec(FIRE_HOT), colourVec(FIRE_MID), t / 0.4)
          : emitScratch.set(0, 0, 0).lerpVectors(colourVec(FIRE_MID), colourVec(FIRE_COOL), (t - 0.4) / 0.6);
        pool.colours[c] = col.x;
        pool.colours[c + 1] = col.y;
        pool.colours[c + 2] = col.z;
        pool.colours[c + 3] = (1 - t) * (1 - t);
        pool.sizes[i] = THREE.MathUtils.lerp(FIRE_SIZE[1], FIRE_SIZE[0], t) * (0.7 + pool.seed[i] * 0.6);
      } else {
        pool.colours[c] = SMOKE_COLOUR.r;
        pool.colours[c + 1] = SMOKE_COLOUR.g;
        pool.colours[c + 2] = SMOKE_COLOUR.b;
        // Quick fade in, long fade out, so it billows rather than pops.
        pool.colours[c + 3] = SMOKE_ALPHA * Math.min(1, t * 6) * (1 - t);
        pool.sizes[i] = THREE.MathUtils.lerp(SMOKE_SIZE[0], SMOKE_SIZE[1], Math.sqrt(t)) * (0.75 + pool.seed[i] * 0.5);
      }
    }
    markPoolDirty(pool);
  }

  const colourVecs = new Map();
  /**
   * A Vector3 view of a colour, cached, so the per-particle lerp above can
   * use Vector3.lerpVectors without allocating.
   * @param {THREE.Color} c
   * @returns {THREE.Vector3}
   */
  function colourVec(c) {
    let v = colourVecs.get(c);
    if (!v) { v = new THREE.Vector3(c.r, c.g, c.b); colourVecs.set(c, v); }
    return v;
  }

  /**
   * Per-frame driver: measures stress, emits, ages. Particles keep ageing
   * after chase mode ends, so a burst finishes naturally instead of freezing.
   * @param {number} dt
   * @returns {void}
   */
  function updateTireFire(dt) {
    if (!TireFire.fire) return;
    const active = Chase.active && Chase.car && !Chase.gameOver;
    const target = active ? measureStress(dt) : 0;
    const rate = target > TireFire.stress ? STRESS_ATTACK : STRESS_RELEASE;
    TireFire.stress += (target - TireFire.stress) * Math.min(1, rate * dt);

    if (active) {
      const s = TireFire.stress;
      const smokeLevel = THREE.MathUtils.clamp((s - SMOKE_STRESS_MIN) / (1 - SMOKE_STRESS_MIN), 0, 1);
      const fireLevel = THREE.MathUtils.clamp((s - FIRE_STRESS_MIN) / (1 - FIRE_STRESS_MIN), 0, 1);
      for (const [pool, level, rateMax, isFire] of [
        [TireFire.smoke, smokeLevel, SMOKE_RATE, false],
        [TireFire.fire, fireLevel, FIRE_RATE, true]
      ]) {
        pool.accumulator += level * rateMax * dt;
        const n = Math.floor(pool.accumulator);
        pool.accumulator -= n;
        if (n > 0) emit(pool, n, isFire);
      }
    }

    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    TireFire.fire.points.material.uniforms.uScale.value = scale;
    TireFire.smoke.points.material.uniforms.uScale.value = scale;

    step(TireFire.fire, dt, true);
    step(TireFire.smoke, dt, false);
  }

  /**
   * Clears every particle and the stress level. Called whenever the chase
   * car's cosmetic state is reset (entry, restart, exit).
   * @returns {void}
   */
  function resetTireFire() {
    TireFire.stress = 0;
    TireFire.prevSpeed = 0;
    for (const pool of [TireFire.fire, TireFire.smoke]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.accumulator = 0;
    }
  }

  /** @returns {void} */
  function disposeTireFire() {
    for (const pool of [TireFire.fire, TireFire.smoke]) {
      if (pool) disposeParticlePool(Sim.three.scene, pool);
    }
  }

  return { TireFire, initTireFire, updateTireFire, resetTireFire, disposeTireFire };
}
