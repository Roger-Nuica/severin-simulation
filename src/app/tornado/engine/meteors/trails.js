// @ts-check
import * as THREE from 'three';
import { pointScaleFor, markPoolDirty } from '../particlePool.js';
import { METEOR, TRAIL_HOT, TRAIL_COOL } from './config.js';
/** @typedef {import('./config.js').Meteor} Meteor */

/**
 * ===========================================================================
 * SECTION MT.3 — Trails
 * ===========================================================================
 * The fire and smoke each rock drags down the sky.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see meteors.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createMeteorTrails(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * One puff of the dark column a rock leaves behind it.
   * @param {THREE.Vector3} at
   * @param {number} spread
   * @returns {void}
   */
  function spawnSmoke(at, spread) {
    const p = S.smoke;
    const i = p.next;
    p.next = (p.next + 1) % METEOR.smokeMax;
    p.positions[i * 3] = at.x + (Math.random() - 0.5) * spread;
    p.positions[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread;
    p.positions[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread;
    p.velocities[i * 3] = (Math.random() - 0.5) * 5;
    p.velocities[i * 3 + 1] = 1 + Math.random() * 4;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 5;
    p.life[i] = p.maxLife[i] = api.between(METEOR.smokeLife);
    p.seed[i] = Math.random();
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSmoke(dt) {
    const p = S.smoke;
    let alive = 0;
    for (let i = 0; i < METEOR.smokeMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      // Buoyant and slowing: it billows rather than falling.
      p.velocities[i * 3 + 1] += 1.4 * dt;
      for (let k = 0; k < 3; k++) {
        p.velocities[i * 3 + k] *= 1 - Math.min(1, 0.7 * dt);
        p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      }
      const u = 1 - p.life[i] / p.maxLife[i];
      p.colours[i * 4] = METEOR.smokeColour.r;
      p.colours[i * 4 + 1] = METEOR.smokeColour.g;
      p.colours[i * 4 + 2] = METEOR.smokeColour.b;
      // Fades in quickly, out slowly.
      p.colours[i * 4 + 3] = Math.min(1, u * 6) * (1 - u) * 0.62;
      p.sizes[i] = METEOR.smokeSize * (0.5 + p.seed[i]) * (0.5 + u * 1.3);
    }
    if (alive) {
      markPoolDirty(p);
      p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
  }

  /**
   * One trail particle shed by a falling meteor.
   * @param {THREE.Vector3} at
   * @param {number} [spread]
   * @param {THREE.Vector3} [drift] extra velocity, e.g. back up the fall line
   * @returns {void}
   */
  function spawnTrail(at, spread = 3, drift = null) {
    const p = S.trail;
    const i = p.next;
    p.next = (p.next + 1) % METEOR.maxParticles;
    p.positions[i * 3] = at.x + (Math.random() - 0.5) * spread;
    p.positions[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread;
    p.positions[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread;
    p.velocities[i * 3] = (Math.random() - 0.5) * 4 + (drift ? drift.x : 0);
    p.velocities[i * 3 + 1] = 2 + Math.random() * 5 + (drift ? drift.y : 0);
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 4 + (drift ? drift.z : 0);
    p.life[i] = p.maxLife[i] = api.between(METEOR.trailLife);
    p.seed[i] = Math.random();
  }

  /**
   * @param {Meteor} meteor
   * @param {number} dt
   * @returns {void}
   */
  function spawnTrailFor(meteor, dt) {
    // Laid down along the whole stretch the rock covered this frame rather
    // than dropped where it happens to be now: at this speed a rock covers
    // several of its own widths a frame, and puffs dropped only at its
    // current position left a dotted line of separate blobs.
    if (!meteor.last) meteor.last = meteor.mesh.position.clone();
    S.trail.accumulator += METEOR.trailRate * dt;
    const count = Math.floor(S.trail.accumulator);
    S.trail.accumulator -= count;
    // Pushed back up the fall line by the air it is ploughing through.
    S.trailDrift.copy(S.fallDir).multiplyScalar(-9);
    for (let n = 0; n < count; n++) {
      S.trailPoint.lerpVectors(meteor.last, meteor.mesh.position, (n + Math.random()) / count);
      // Tighter than the rock: the tail streams from behind it, it does not
      // envelop it.
      spawnTrail(S.trailPoint, meteor.radius * 0.6, S.trailDrift);
    }
    meteor.last.copy(meteor.mesh.position);
    S.smoke.accumulator += METEOR.smokeRate * dt;
    while (S.smoke.accumulator >= 1) {
      S.smoke.accumulator -= 1;
      spawnSmoke(meteor.mesh.position, meteor.radius * 1.8);
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateTrail(dt) {
    const p = S.trail;
    let alive = 0;
    for (let i = 0; i < METEOR.maxParticles; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      // Ejecta (seed 1) arcs under gravity; trail smoke simply rises.
      if (p.seed[i] >= 1) p.velocities[i * 3 + 1] -= 16 * dt;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      const c = S.scratch.copy(TRAIL_HOT).lerp(TRAIL_COOL, u);
      p.colours[i * 4] = c.r;
      p.colours[i * 4 + 1] = c.g;
      p.colours[i * 4 + 2] = c.b;
      // The tail tapers: fresh fire right behind the rock is as wide as it,
      // and it thins and dims as it falls away behind.
      const ejecta = p.seed[i] >= 1;
      p.colours[i * 4 + 3] = ejecta ? (1 - u) * 0.9 : Math.pow(1 - u, 1.5) * 0.85;
      p.sizes[i] = ejecta ? METEOR.ejectaSize * (1 - 0.4 * u) : METEOR.trailSize * (1 - 0.75 * u);
    }
    if (alive) {
      markPoolDirty(p);
      p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
  }

  return { spawnSmoke, updateSmoke, spawnTrail, spawnTrailFor, updateTrail };
}
