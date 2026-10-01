// @ts-check
import * as THREE from 'three';
import { createFireTexture, createSoftDotTexture } from '../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { FUEL } from './config.js';

/**
 * ===========================================================================
 * SECTION FF.2 — Fuel stations: what it looks like
 * ===========================================================================
 * Three particle pools (the fuel spraying from the pumps, the flames on the
 * spilt fuel, the smoke columns over the wreck), the puddle spreading on the
 * forecourt, and the rings of flame racing out along the ground from a
 * blast. The pools are made at init and tracked by the particle budget
 * (engine/perf/caps.js): every emitter asks it for room first.
 */

const SPRAY_COLOUR = new THREE.Color(0xd9d2a8);
const FLAME_HOT = new THREE.Color(1.6, 1.25, 0.55);
const FLAME_COOL = new THREE.Color(0.9, 0.25, 0.05);
const SMOKE_COLOUR = new THREE.Color(0x2a2623);
const PUDDLE_COLOUR = 0x1c1a17;
const RING_COLOUR = 0xff7a1f;
// Ground layer (CLAUDE.md "Ground layers"): just above the craters.
const PUDDLE_Y = 0.028;

/**
 * @param {Object} ctx
 * @returns {{
 *   init: () => void,
 *   spray: (x: number, y: number, z: number, n: number) => void,
 *   flames: (x: number, z: number, radius: number, n: number) => void,
 *   smoke: (x: number, z: number, n: number) => void,
 *   ring: (x: number, z: number, delay: number) => void,
 *   puddle: (x: number, z: number) => THREE.Mesh,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   release: () => void
 * }}
 */
export function createFuelEffects(ctx) {
  const { Sim } = ctx;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let sprayPool = null;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let flamePool = null;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let smokePool = null;
  /** @type {{mesh: THREE.Mesh, x: number, z: number, t: number, delay: number, live: boolean}[]} */
  const rings = [];
  /** @type {THREE.Mesh[]} */
  const puddles = [];
  /** @type {THREE.Texture|null} */
  let puddleTexture = null;
  /** @type {THREE.MeshBasicMaterial|null} */
  let puddleMaterial = null;
  /** @type {THREE.RingGeometry|null} */
  let ringGeometry = null;
  let dirty = false;

  /** @returns {void} */
  function init() {
    const { scene } = Sim.three;
    sprayPool = createParticlePool(scene, FUEL.sprayMax, createSoftDotTexture(), THREE.NormalBlending, 'fuel_spray');
    flamePool = createParticlePool(scene, FUEL.flameMax, createFireTexture(), THREE.AdditiveBlending, 'fuel_flames');
    smokePool = createParticlePool(scene, FUEL.smokeMax, createSoftDotTexture(), THREE.NormalBlending, 'fuel_smoke');
    for (const pool of [sprayPool, flamePool, smokePool]) ctx.systems.caps.trackPool(pool);

    puddleTexture = createSoftDotTexture();
    puddleMaterial = new THREE.MeshBasicMaterial({
      color: PUDDLE_COLOUR, map: puddleTexture, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });

    ringGeometry = new THREE.RingGeometry(0.82, 1, 48, 1);
    for (let i = 0; i < FUEL.maxRings; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: RING_COLOUR, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.name = `fuel_ring_${i}`;
      scene.add(mesh);
      rings.push({ mesh, x: 0, z: 0, t: 0, delay: 0, live: false });
    }
  }

  /**
   * @param {number} n wanted
   * @returns {number} what the particle budget allows
   */
  function room(n) {
    return Math.min(n, ctx.systems.caps.particleRoom());
  }

  /**
   * One particle out of a pool's ring buffer.
   * @param {import('../particlePool.js').ParticlePool} pool
   * @param {number} life seconds
   * @returns {number} its index
   */
  function take(pool, life) {
    const i = pool.next;
    pool.next = (pool.next + 1) % pool.life.length;
    pool.life[i] = life;
    pool.maxLife[i] = life;
    pool.seed[i] = Math.random();
    dirty = true;
    return i;
  }

  /**
   * Fuel spraying out of a torn pump, in every direction and falling.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} n
   * @returns {void}
   */
  function spray(x, y, z, n) {
    if (!sprayPool) return;
    for (let k = room(n); k > 0; k--) {
      const i = take(sprayPool, 0.7 + Math.random() * 0.5);
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      sprayPool.positions.set([x, y, z], i * 3);
      sprayPool.velocities.set([Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s], i * 3);
    }
  }

  /**
   * Flames licking up off the spilt fuel.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {number} n
   * @returns {void}
   */
  function flames(x, z, radius, n) {
    if (!flamePool) return;
    for (let k = room(n); k > 0; k--) {
      const i = take(flamePool, 0.6 + Math.random() * 0.6);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      flamePool.positions.set([x + Math.cos(a) * r, 0.3, z + Math.sin(a) * r], i * 3);
      flamePool.velocities.set([(Math.random() - 0.5) * 1.5, 3 + Math.random() * 4, (Math.random() - 0.5) * 1.5], i * 3);
    }
  }

  /**
   * Thick black smoke rising in columns off the wreck.
   * @param {number} x
   * @param {number} z
   * @param {number} n
   * @returns {void}
   */
  function smoke(x, z, n) {
    if (!smokePool) return;
    for (let k = room(n); k > 0; k--) {
      const i = take(smokePool, 5 + Math.random() * 3);
      const column = Math.floor(Math.random() * FUEL.smokeColumns);
      const a = column * 2.1 + 0.6;
      smokePool.positions.set([x + Math.cos(a) * 3 + (Math.random() - 0.5) * 2, 2, z + Math.sin(a) * 3 + (Math.random() - 0.5) * 2], i * 3);
      smokePool.velocities.set([(Math.random() - 0.5) * 0.8, 5 + Math.random() * 3, (Math.random() - 0.5) * 0.8], i * 3);
    }
  }

  /**
   * A ring of flame racing out along the ground from a blast.
   * @param {number} x
   * @param {number} z
   * @param {number} delay seconds before it starts
   * @returns {void}
   */
  function ring(x, z, delay) {
    const free = rings.find(r => !r.live);
    if (!free) return;
    Object.assign(free, { x, z, t: 0, delay, live: true });
  }

  /**
   * A puddle of fuel on the forecourt, grown by its owner (scale).
   * @param {number} x
   * @param {number} z
   * @returns {THREE.Mesh}
   */
  function puddle(x, z) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), puddleMaterial || undefined);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, PUDDLE_Y, z);
    mesh.scale.setScalar(0.01);
    mesh.name = 'fuel_puddle';
    Sim.three.scene.add(mesh);
    puddles.push(mesh);
    return mesh;
  }

  /**
   * @param {import('../particlePool.js').ParticlePool} pool
   * @param {number} dt
   * @param {'spray'|'flame'|'smoke'} kind
   * @returns {void}
   */
  function step(pool, dt, kind) {
    const count = pool.life.length;
    for (let i = 0; i < count; i++) {
      if (pool.life[i] <= 0) {
        if (pool.sizes[i] !== 0) { pool.colours[i * 4 + 3] = 0; pool.sizes[i] = 0; }
        continue;
      }
      pool.life[i] -= dt;
      const t = 1 - Math.max(pool.life[i], 0) / pool.maxLife[i];
      const v = i * 3;
      const c = i * 4;
      if (kind === 'spray') pool.velocities[v + 1] -= 9.8 * dt;
      else pool.velocities[v + 1] += (kind === 'flame' ? 1.5 : 0.4) * dt;
      pool.positions[v] += pool.velocities[v] * dt;
      pool.positions[v + 1] = Math.max(0.05, pool.positions[v + 1] + pool.velocities[v + 1] * dt);
      pool.positions[v + 2] += pool.velocities[v + 2] * dt;
      if (kind === 'spray') {
        pool.colours.set([SPRAY_COLOUR.r, SPRAY_COLOUR.g, SPRAY_COLOUR.b, 0.55 * (1 - t)], c);
        pool.sizes[i] = 0.5 + t * 0.9;
      } else if (kind === 'flame') {
        pool.colours[c] = THREE.MathUtils.lerp(FLAME_HOT.r, FLAME_COOL.r, t);
        pool.colours[c + 1] = THREE.MathUtils.lerp(FLAME_HOT.g, FLAME_COOL.g, t);
        pool.colours[c + 2] = THREE.MathUtils.lerp(FLAME_HOT.b, FLAME_COOL.b, t);
        pool.colours[c + 3] = (1 - t) * (1 - t);
        pool.sizes[i] = (2.6 - t * 1.4) * (0.7 + pool.seed[i] * 0.6);
      } else {
        pool.colours.set([SMOKE_COLOUR.r, SMOKE_COLOUR.g, SMOKE_COLOUR.b, 0.6 * Math.min(1, t * 5) * (1 - t)], c);
        pool.sizes[i] = (3 + Math.sqrt(t) * 9) * (0.75 + pool.seed[i] * 0.5);
      }
    }
    markPoolDirty(pool);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    if (!sprayPool || !flamePool || !smokePool) return;
    for (const r of rings) {
      if (!r.live) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t += dt / FUEL.ringSeconds;
      if (r.t >= 1) {
        r.live = false;
        r.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - r.t) * (1 - r.t);
      r.mesh.visible = true;
      r.mesh.position.set(r.x, 0.4 + r.t * 0.6, r.z);
      r.mesh.scale.setScalar(Math.max(0.1, eased * FUEL.ringRadius));
      /** @type {THREE.MeshBasicMaterial} */ (r.mesh.material).opacity = 0.95 * (1 - r.t);
    }
    // Nothing alive and nothing to clear: no uploads.
    if (!dirty) return;
    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let alive = 0;
    for (const [pool, kind] of /** @type {const} */ ([[sprayPool, 'spray'], [flamePool, 'flame'], [smokePool, 'smoke']])) {
      pool.points.material.uniforms.uScale.value = scale;
      step(pool, dt, kind);
      for (let i = 0; i < pool.life.length; i++) if (pool.life[i] > 0) { alive++; break; }
    }
    // One more pass after the last particle died, to write its zeros.
    dirty = alive > 0;
  }

  /**
   * Everything gone (a Reset).
   * @returns {void}
   */
  function clear() {
    for (const pool of [sprayPool, flamePool, smokePool]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      pool.accumulator = 0;
      markPoolDirty(pool);
    }
    dirty = false;
    for (const r of rings) {
      r.live = false;
      r.mesh.visible = false;
    }
    for (const mesh of puddles) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    puddles.length = 0;
  }

  /**
   * GPU resources freed (on dispose).
   * @returns {void}
   */
  function release() {
    clear();
    const { scene } = Sim.three;
    for (const pool of [sprayPool, flamePool, smokePool]) if (pool) disposeParticlePool(scene, pool);
    sprayPool = flamePool = smokePool = null;
    for (const r of rings) {
      scene.remove(r.mesh);
      /** @type {THREE.Material} */ (r.mesh.material).dispose();
    }
    rings.length = 0;
    if (ringGeometry) ringGeometry.dispose();
    if (puddleMaterial) puddleMaterial.dispose();
    if (puddleTexture) puddleTexture.dispose();
    ringGeometry = null;
    puddleMaterial = null;
    puddleTexture = null;
  }

  return { init, spray, flames, smoke, ring, puddle, update, clear, release };
}
