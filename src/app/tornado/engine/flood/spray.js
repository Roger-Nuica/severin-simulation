// @ts-check
import * as THREE from 'three';
import { pointScaleFor, markPoolDirty } from '../particlePool.js';
import { FLOOD } from './config.js';

/**
 * ===========================================================================
 * SECTION FL.2 — Foam, spray and mud
 * ===========================================================================
 * The particles on the flood, three pools on the shared particle budget
 * (caps.particleRoom before every emission):
 *  - **foam** (also the jets through the cracking gate, flood/dam.js): white
 *    water thrown off the wave's face and lip, and churned up round every
 *    building standing in the water;
 *  - **mist**: big soft spray clouds blown up and forward off the top of the
 *    wave, drifting and spreading as they fall back;
 *  - **mud**: dark clots of silt and splinters riding the surface of the
 *    flood behind the wave, at the water's own speed.
 */

/**
 * @param {Object} ctx
 * @param {any} S the shared state (see flood.js)
 * @param {any} api every module's functions, by name
 * @returns {Object}
 */
export function createFloodSpray(ctx, S, api) {
  const { Sim } = ctx;
  const foamColour = new THREE.Color(FLOOD.foamColour);
  const mudColour = new THREE.Color(FLOOD.mudColour);

  /**
   * @param {[number, number]|number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * A slot in a pool, or -1 with the particle budget spent.
   * @param {any} pool
   * @param {number} max
   * @returns {number}
   */
  function slot(pool, max) {
    if (ctx.systems.caps && ctx.systems.caps.particleRoom() <= 0) return -1;
    const i = pool.next;
    pool.next = (pool.next + 1) % max;
    return i;
  }

  /**
   * White water off the wave's face and lip.
   * @returns {void}
   */
  function spawnFoam() {
    const p = S.foam;
    const i = slot(p, FLOOD.foamMax);
    if (i < 0) return;
    const spread = api.spreadAt(S.state.frontX);
    const z = (Math.random() * 2 - 1) * spread * 0.92;
    const H = api.crestHeight();
    const up = Math.random();
    p.positions[i * 3] = api.toeAt(z) - Math.random() * H * 0.3;
    p.positions[i * 3 + 1] = H * (0.3 + up * 0.75) * (1 - Math.pow(Math.abs(z) / spread, 4));
    p.positions[i * 3 + 2] = z;
    p.velocities[i * 3] = FLOOD.speed * (0.6 + Math.random() * 0.6);
    p.velocities[i * 3 + 1] = 2 + Math.random() * 9;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 8;
    p.life[i] = p.maxLife[i] = between(FLOOD.foamLife);
    p.seed[i] = Math.random();
  }

  /**
   * Froth round a building standing in the water: on its upstream face and
   * peeling off its sides.
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @returns {void}
   */
  function spawnEddy(x, z, r) {
    const p = S.foam;
    const i = slot(p, FLOOD.foamMax);
    if (i < 0) return;
    const a = Math.PI * (0.5 + Math.random());
    const surface = api.surfaceAt(x - r, z);
    p.positions[i * 3] = x + Math.cos(a) * r;
    p.positions[i * 3 + 1] = surface + Math.random() * 1.5;
    p.positions[i * 3 + 2] = z + Math.sin(a) * r;
    p.velocities[i * 3] = FLOOD.flowBody * (0.3 + Math.random() * 0.6);
    p.velocities[i * 3 + 1] = 3 + Math.random() * 6;
    p.velocities[i * 3 + 2] = Math.sin(a) * (3 + Math.random() * 4);
    p.life[i] = p.maxLife[i] = between(FLOOD.foamLife) * 0.8;
    p.seed[i] = Math.random();
  }

  /**
   * A cloud of spray blown up off the top of the wave.
   * @returns {void}
   */
  function spawnMist() {
    const p = S.mist;
    const i = slot(p, FLOOD.mistMax);
    if (i < 0) return;
    const spread = api.spreadAt(S.state.frontX);
    const z = (Math.random() * 2 - 1) * spread * 0.85;
    const H = api.crestHeight();
    p.positions[i * 3] = api.toeAt(z) - Math.random() * H * 0.25;
    p.positions[i * 3 + 1] = H * (0.85 + Math.random() * 0.3);
    p.positions[i * 3 + 2] = z;
    p.velocities[i * 3] = FLOOD.speed * (0.7 + Math.random() * 0.5);
    p.velocities[i * 3 + 1] = 3 + Math.random() * 6;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 6;
    p.life[i] = p.maxLife[i] = between(FLOOD.mistLife);
    p.seed[i] = Math.random();
  }

  /**
   * A clot of mud or a splinter on the flood behind the wave.
   * @returns {void}
   */
  function spawnMud() {
    const p = S.mud;
    const i = slot(p, FLOOD.mudMax);
    if (i < 0) return;
    const back = FLOOD.damX + 4 + Math.random() * Math.max(1, S.state.frontX - FLOOD.damX - 10);
    const z = (Math.random() * 2 - 1) * api.spreadAt(back) * 0.8;
    if (!api.inWater(back, z)) return;
    p.positions[i * 3] = back;
    p.positions[i * 3 + 1] = api.surfaceAt(back, z) + 0.15;
    p.positions[i * 3 + 2] = z;
    p.velocities[i * 3] = api.atCrest(back, z) ? FLOOD.flowCrest : FLOOD.flowBody * (0.7 + Math.random() * 0.6);
    p.velocities[i * 3 + 1] = 0;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    p.life[i] = p.maxLife[i] = between(FLOOD.mudLife);
    p.seed[i] = Math.random();
  }

  /**
   * Everything the flood is throwing up this frame.
   * @param {number} dt
   * @returns {void}
   */
  function emitSpray(dt) {
    const surge = S.state.phase === 'surge';
    const owe = (/** @type {any} */ pool, /** @type {number} */ rate, /** @type {() => void} */ spawn) => {
      pool.accumulator += rate * dt;
      while (pool.accumulator >= 1) {
        pool.accumulator -= 1;
        spawn();
      }
    };
    if (surge) {
      owe(S.foam, FLOOD.foamRate, spawnFoam);
      owe(S.mist, FLOOD.mistRate, spawnMist);
    }
    owe(S.mud, FLOOD.mudRate * S.state.fade, spawnMud);
    // Froth round the buildings in the water: the obstacles the shader
    // already has, nearest the front first.
    const list = S.obstacles;
    for (let k = 0; k < S.state.obstacleCount; k++) {
      if (Math.random() < dt * 9 * S.state.fade) spawnEddy(list[k].x, list[k].y, list[k].z);
    }
  }

  /**
   * @param {any} p
   * @param {number} max
   * @param {number} dt
   * @param {(i: number, u: number) => void} paint
   * @param {number} gravity
   * @param {number} drag
   * @returns {void}
   */
  function stepPool(p, max, dt, paint, gravity, drag) {
    let alive = 0;
    const keep = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      p.velocities[i * 3 + 1] -= gravity * dt;
      p.velocities[i * 3] *= keep;
      p.velocities[i * 3 + 2] *= keep;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      paint(i, 1 - p.life[i] / p.maxLife[i]);
    }
    if (alive || p.wasAlive) {
      markPoolDirty(p);
      p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
    p.wasAlive = alive > 0;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateFoam(dt) {
    stepPool(S.foam, FLOOD.foamMax, dt, (i, u) => {
      const p = S.foam;
      p.colours[i * 4] = foamColour.r;
      p.colours[i * 4 + 1] = foamColour.g;
      p.colours[i * 4 + 2] = foamColour.b;
      p.colours[i * 4 + 3] = (1 - u) * 0.55;
      p.sizes[i] = FLOOD.foamSize * (0.5 + p.seed[i]) * (0.6 + u * 0.8);
    }, 11, 0.2);
    stepPool(S.mist, FLOOD.mistMax, dt, (i, u) => {
      const p = S.mist;
      const light = 0.85 + 0.15 * p.seed[i];
      p.colours[i * 4] = 0.62 * light;
      p.colours[i * 4 + 1] = 0.64 * light;
      p.colours[i * 4 + 2] = 0.63 * light;
      p.colours[i * 4 + 3] = Math.min(1, u * 6) * (1 - u) * 0.16;
      p.sizes[i] = (FLOOD.mistSize[0] + (FLOOD.mistSize[1] - FLOOD.mistSize[0]) * p.seed[i]) * (0.7 + u * 1.4);
    }, 2.5, 0.6);
    stepPool(S.mud, FLOOD.mudMax, dt, (i, u) => {
      const p = S.mud;
      // Rides the surface where the water still is.
      const x = p.positions[i * 3];
      const z = p.positions[i * 3 + 2];
      p.positions[i * 3 + 1] = api.surfaceAt(x, z) + 0.12;
      if (p.positions[i * 3 + 1] <= 0.15) p.life[i] = Math.min(p.life[i], 0.2);
      const shade = 0.7 + 0.6 * p.seed[i];
      p.colours[i * 4] = mudColour.r * shade;
      p.colours[i * 4 + 1] = mudColour.g * shade;
      p.colours[i * 4 + 2] = mudColour.b * shade;
      p.colours[i * 4 + 3] = Math.min(1, u * 8) * (1 - u) * 0.95;
      p.sizes[i] = FLOOD.mudSize[0] + (FLOOD.mudSize[1] - FLOOD.mudSize[0]) * p.seed[i];
    }, 0, 0);
  }

  /** @returns {void} every particle out */
  function clearSpray() {
    for (const p of [S.foam, S.mist, S.mud]) {
      if (!p) continue;
      p.life.fill(0);
      p.colours.fill(0);
      p.sizes.fill(0);
      p.accumulator = 0;
      markPoolDirty(p);
    }
  }

  return { spawnFoam, emitSpray, updateFoam, clearSpray };
}
