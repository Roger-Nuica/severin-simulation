// @ts-check
import * as THREE from 'three';
import { createFireTexture } from '../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { TREX } from './config.js';

/**
 * ===========================================================================
 * SECTION TX.2 — The cyber T-Rex: the flame breath (what it looks like)
 * ===========================================================================
 * One additive particle pool (TREX.flameMax), tracked by the particle
 * budget (engine/perf/caps.js): each emission asks it for room first. A
 * particle leaves the mouth along the breath's direction, spreading inside
 * the cone, slowing and rising as it goes, white-yellow to deep orange.
 * What the flames set alight is decided in trex.js, not here. A breath can
 * be cut short (emit's `reach`): where it meets the Yeti's frost
 * (giants/clash.js) no particle goes further.
 */

const HOT = new THREE.Color(2.4, 2, 1.1);
const COOL = new THREE.Color(1.3, 0.3, 0.05);
// The breath slows as it goes: this much of its speed lost a second.
const DRAG = 1.2;

/**
 * @param {Object} ctx
 * @param {{size?: number, alpha?: number, name?: string}} [opts] the same fire
 *   at another scale: Roger's Fire Gun (hero/fireGun.js) breathes it at a
 *   man's size, in front of the camera
 * @returns {{
 *   init: () => void,
 *   emit: (from: THREE.Vector3, dir: THREE.Vector3, n: number, reach?: number) => void,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   release: () => void
 * }}
 */
export function createTrexFlames(ctx, opts = {}) {
  const sizeK = opts.size || 1;
  const alphaK = opts.alpha || 1;
  const { Sim } = ctx;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let pool = null;
  let alive = false;

  /** @returns {void} */
  function init() {
    pool = createParticlePool(Sim.three.scene, TREX.flameMax, createFireTexture(), THREE.AdditiveBlending, opts.name || 'trex_flames');
    ctx.systems.caps.trackPool(pool);
  }

  /**
   * @param {THREE.Vector3} from the mouth, in the world
   * @param {THREE.Vector3} dir unit, the way it breathes
   * @param {number} n wanted
   * @param {number} [reach] metres it may go, if less than the flame's own
   * @returns {void}
   */
  function emit(from, dir, n, reach) {
    if (!pool) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    const spread = Math.tan(TREX.flameHalfAngle);
    for (let k = 0; k < count; k++) {
      const i = pool.next;
      pool.next = (pool.next + 1) % pool.life.length;
      const v = TREX.flameSpeed * (0.85 + Math.random() * 0.3);
      let life = (TREX.flameRange / TREX.flameSpeed) * (0.75 + Math.random() * 0.4);
      if (reach !== undefined) {
        // With the drag below, a particle has gone v/DRAG (1 - e^(-DRAG t))
        // by t: it is stopped where that reaches `reach`.
        const u = (DRAG * reach) / v;
        if (u < 1) life = Math.min(life, -Math.log(1 - u) / DRAG);
      }
      pool.life[i] = life;
      pool.maxLife[i] = life;
      pool.seed[i] = Math.random();
      pool.positions.set([from.x, from.y, from.z], i * 3);
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * spread;
      // Sideways within the cone: across the breath's direction on the ground.
      const vx = dir.x + sx * dir.z;
      const vz = dir.z - sx * dir.x;
      pool.velocities.set([vx * v, (dir.y + sy) * v, vz * v], i * 3);
    }
    if (count > 0) alive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    if (!pool || !alive) return;
    pool.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < pool.life.length; i++) {
      if (pool.life[i] <= 0) {
        if (pool.sizes[i] !== 0) { pool.colours[i * 4 + 3] = 0; pool.sizes[i] = 0; }
        continue;
      }
      any = true;
      pool.life[i] -= dt;
      const t = 1 - Math.max(pool.life[i], 0) / pool.maxLife[i];
      const v = i * 3;
      const drag = Math.max(0, 1 - DRAG * dt);
      pool.velocities[v] *= drag;
      pool.velocities[v + 2] *= drag;
      pool.velocities[v + 1] = pool.velocities[v + 1] * drag + 4 * dt;
      pool.positions[v] += pool.velocities[v] * dt;
      pool.positions[v + 1] = Math.max(0.3, pool.positions[v + 1] + pool.velocities[v + 1] * dt);
      pool.positions[v + 2] += pool.velocities[v + 2] * dt;
      const c = i * 4;
      pool.colours[c] = THREE.MathUtils.lerp(HOT.r, COOL.r, t);
      pool.colours[c + 1] = THREE.MathUtils.lerp(HOT.g, COOL.g, t);
      pool.colours[c + 2] = THREE.MathUtils.lerp(HOT.b, COOL.b, t);
      pool.colours[c + 3] = (1 - t) * (1 - t * 0.5) * 0.7 * alphaK;
      pool.sizes[i] = (1.2 + t * 5.5) * (0.7 + pool.seed[i] * 0.6) * TREX.flameSize * sizeK;
    }
    markPoolDirty(pool);
    alive = any;
  }

  /** @returns {void} */
  function clear() {
    if (!pool) return;
    pool.life.fill(0);
    pool.colours.fill(0);
    pool.sizes.fill(0);
    markPoolDirty(pool);
    alive = false;
  }

  /** @returns {void} */
  function release() {
    if (pool) disposeParticlePool(Sim.three.scene, pool);
    pool = null;
  }

  return { init, emit, update, clear, release };
}
