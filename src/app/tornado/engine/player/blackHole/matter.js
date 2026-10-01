// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../../particlePool.js';
import { LOOK } from './look.js';

/**
 * ===========================================================================
 * SECTION PB.2 — Matter falling in
 * ===========================================================================
 * The particles round the black hole, all on the spiral the swirl's shader
 * draws (look.js), so they read as the arms themselves carrying things in:
 *
 *  - Dust and grit are torn up off the ground all the way out to the edge
 *    of the pull (100 m) and blown in, greyish brown, turning violet as they
 *    cross the no-escape line.
 *  - Ambient matter streams in all the time from the no-escape line (40 m)
 *    along the arms: rising off the ground out there, sweeping round and in,
 *    faster and faster, white-hot at the end, and gone at the horizon. It is
 *    what shows, from anywhere, how far the pull reaches and where it goes.
 *  - Whatever the hole is tearing apart sheds bits from where it is, and
 *    they join the same flow.
 *
 * Each particle keeps its radius and angle round the hole (in the pool's
 * velocity slots) rather than a velocity: it turns with the swirl's own
 * differential rotation and moves along the logarithmic arm as it falls,
 * so it stays on an arm instead of cutting across them. Positions follow
 * the hole as it drifts.
 *
 * One additive pool on the shared particle budget (caps.particleRoom before
 * every emission, trackPool at start-up).
 */

export const MATTER = {
  max: 2400,
  ambientRate: 420,        // particles a second while the hole is open
  infall: [4, 34],         // m/s inward: at the line, and at the horizon
  life: 14,                // seconds, a backstop only: they end at the horizon
  size: [0.5, 1.5]
};

/**
 * @param {Object} ctx
 * @param {{escape: number, horizon: number, influence: number}} hole the hole's radii
 * @returns {{
 *   ambient: (dt: number, at: {x: number, y: number, z: number}, t: number) => void,
 *   shed: (from: THREE.Vector3, at: {x: number, y: number, z: number}, n: number) => void,
 *   step: (dt: number, at: {x: number, y: number, z: number}|null, t: number) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createHoleMatter(ctx, hole) {
  const { Sim } = ctx;
  const texture = createSoftDotTexture();
  const pool = createParticlePool(Sim.three.scene, MATTER.max, texture, THREE.AdditiveBlending, 'black_hole_matter');
  ctx.systems.caps.trackPool(pool);
  let alive = false;
  let owed = 0;
  const inner = LOOK.coreRadius * 0.95;

  /**
   * The swirl's spin at a radius (look.js's differential rotation), in
   * radians a second -- the world sees it the other way round.
   * @param {number} r
   * @returns {number}
   */
  function spinAt(r) {
    const u = Math.min(1, Math.max(0, (r - inner) / (LOOK.swirlRadius - inner)));
    return LOOK.spinInner + (LOOK.spinOuter - LOOK.spinInner) * Math.sqrt(u);
  }

  /**
   * Where an arm crosses radius r now, as a world angle (x = cos, z = sin):
   * the shader's arm phase solved for the angle, turned into the world
   * through the group's precession.
   * @param {number} r
   * @param {number} t
   * @param {number} k which arm
   * @returns {number}
   */
  function armAngle(r, t, k) {
    const local = (Math.PI * 2 * k) / LOOK.arms - LOOK.twist * Math.log(Math.max(r, 0.01) / inner) + spinAt(r) * t;
    return -local - t * LOOK.precession;
  }

  /**
   * The height of the flow at radius r: up off the ground at the line, onto
   * the swirl's funnel inside it.
   * @param {number} r
   * @param {number} y the hole's centre height
   * @returns {number}
   */
  function heightAt(r, y) {
    if (r >= LOOK.swirlRadius) {
      const u = Math.min(1, (r - LOOK.swirlRadius) / Math.max(1, hole.escape - LOOK.swirlRadius));
      return y + (0.4 - y) * u;
    }
    return y - LOOK.funnelDepth * Math.pow(1 - r / LOOK.swirlRadius, 2.4);
  }

  /**
   * @param {number} r
   * @param {number} angle
   * @param {number} y
   * @param {{x: number, y: number, z: number}} at
   * @returns {void}
   */
  function spawn(r, angle, y, at) {
    const i = pool.next;
    pool.next = (pool.next + 1) % MATTER.max;
    pool.life[i] = MATTER.life;
    pool.maxLife[i] = MATTER.life;
    pool.seed[i] = Math.random();
    pool.velocities[i * 3] = r;
    pool.velocities[i * 3 + 1] = angle;
    pool.velocities[i * 3 + 2] = y;
    pool.positions[i * 3] = at.x + Math.cos(angle) * r;
    pool.positions[i * 3 + 1] = y;
    pool.positions[i * 3 + 2] = at.z + Math.sin(angle) * r;
    alive = true;
  }

  /**
   * The ambient stream along the arms, from the line in.
   * @param {number} dt
   * @param {{x: number, y: number, z: number}} at the hole's centre
   * @param {number} t seconds since it opened
   * @returns {void}
   */
  function ambient(dt, at, t) {
    owed += MATTER.ambientRate * dt;
    const n = Math.min(Math.floor(owed), ctx.systems.caps.particleRoom());
    owed -= Math.floor(owed);
    for (let k = 0; k < n; k++) {
      // Dust from all the way out, most from out at the line, some from
      // inside the swirl already.
      const pick = Math.random();
      const r = pick < 0.35
        ? hole.escape + Math.random() * (hole.influence - hole.escape)
        : pick < 0.8
          ? hole.escape * (0.85 + Math.random() * 0.2)
          : LOOK.swirlRadius * (0.4 + Math.random() * 0.6);
      const arm = Math.floor(Math.random() * LOOK.arms);
      const angle = armAngle(r, t, arm) + (Math.random() - 0.5) * 0.35;
      spawn(r, angle, heightAt(r, at.y) + (Math.random() - 0.5) * 0.8, at);
    }
  }

  /**
   * Bits torn off something being drawn in, joining the flow where it is.
   * @param {THREE.Vector3} from
   * @param {{x: number, y: number, z: number}} at
   * @param {number} n
   * @returns {void}
   */
  function shed(from, at, n) {
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const dx = from.x - at.x + (Math.random() - 0.5) * 1.5;
      const dz = from.z - at.z + (Math.random() - 0.5) * 1.5;
      spawn(Math.max(hole.horizon, Math.hypot(dx, dz)), Math.atan2(dz, dx), Math.max(0.3, from.y) + Math.random() * 1.5, at);
    }
  }

  /**
   * Every particle a step further round and in.
   * @param {number} dt
   * @param {{x: number, y: number, z: number}|null} at the hole, or null once it has closed
   * @param {number} t
   * @returns {void}
   */
  function step(dt, at, t) {
    void t;
    if (!alive) return;
    pool.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    const [v0, v1] = MATTER.infall;
    const [s0, s1] = MATTER.size;
    for (let i = 0; i < MATTER.max; i++) {
      if (pool.life[i] <= 0) {
        if (pool.sizes[i] !== 0) { pool.colours[i * 4 + 3] = 0; pool.sizes[i] = 0; }
        continue;
      }
      // The hole gone: what is still in flight fades out where it is.
      if (!at) {
        pool.life[i] = Math.min(pool.life[i], 0.4) - dt;
        pool.colours[i * 4 + 3] *= 0.85;
        any = true;
        continue;
      }
      pool.life[i] -= dt;
      const v = i * 3;
      let r = pool.velocities[v];
      let angle = pool.velocities[v + 1];
      const closeness = 1 - Math.min(1, (r - hole.horizon) / (hole.escape - hole.horizon));
      const outside = r > hole.escape;
      // Faster the nearer it is: blown in from out there, a gentle drift at
      // the line, a plunge at the end.
      const dr = (outside ? v0 * Math.pow(hole.escape / r, 1.3) * 2.2 : v0 + (v1 - v0) * closeness * closeness) * dt;
      const r1 = Math.max(0, r - dr);
      // Round with the swirl, and along the arm as it falls (the arm's angle
      // changes with radius by the twist), so it stays on it.
      angle -= spinAt(r) * dt + LOOK.twist * (dr / Math.max(r, 0.5));
      r = r1;
      pool.velocities[v] = r;
      pool.velocities[v + 1] = angle;
      // Its height eases onto the flow's.
      const y = pool.velocities[v + 2];
      const yy = y + (heightAt(r, at.y) - y) * Math.min(1, dt * 2.5);
      pool.velocities[v + 2] = yy;
      pool.positions[v] = at.x + Math.cos(angle) * r;
      pool.positions[v + 1] = yy;
      pool.positions[v + 2] = at.z + Math.sin(angle) * r;
      // Dust out beyond the line; deep purple at it, violet, then white-hot
      // going in.
      const c = closeness;
      const hot = c * c;
      if (outside) {
        const far = (r - hole.escape) / (hole.influence - hole.escape);
        pool.colours[i * 4] = 0.42;
        pool.colours[i * 4 + 1] = 0.36;
        pool.colours[i * 4 + 2] = 0.34 + 0.3 * (1 - far);
        pool.colours[i * 4 + 3] = 0.3 * (1 - far);
      } else {
        pool.colours[i * 4] = 0.55 + 0.9 * c + 0.6 * hot;
        pool.colours[i * 4 + 1] = 0.18 + 0.25 * c + 1.1 * hot;
        pool.colours[i * 4 + 2] = 1.2 + 0.8 * c;
        pool.colours[i * 4 + 3] = Math.min(1, (1 - c) * 6) * (0.35 + 0.65 * c);
      }
      pool.sizes[i] = s0 + (s1 - s0) * pool.seed[i] * (1 - 0.5 * c);
      if (r <= hole.horizon) pool.life[i] = 0;
      any = true;
    }
    markPoolDirty(pool);
    alive = any;
  }

  /** @returns {void} */
  function clear() {
    pool.life.fill(0);
    pool.colours.fill(0);
    pool.sizes.fill(0);
    markPoolDirty(pool);
    alive = false;
    owed = 0;
  }

  /** @returns {void} */
  function dispose() {
    disposeParticlePool(Sim.three.scene, pool);
    texture.dispose();
  }

  return { ambient, shed, step, clear, dispose };
}
