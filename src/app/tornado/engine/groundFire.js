// @ts-check
import * as THREE from 'three';
import { createFireTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';

/**
 * ===========================================================================
 * SECTION F.1 — Firenado ground fire
 * ===========================================================================
 * While the Firenado burns (engine/firenado.js), the funnel leaves a
 * scattered trail of small fires on the ground where it touches down. A
 * patch keeps burning while the funnel is over it, then for GROUND_FIRE
 * .linger seconds after the funnel has moved on, and fades out.
 *
 * Patches are placed on a timer (one every GROUND_FIRE.spacing seconds),
 * not every frame, so the trail reads as separate burning spots rather than
 * one continuous strip. At most GROUND_FIRE.maxPatches burn at once; when
 * the cap is hit the oldest is recycled, as the debris pool does.
 *
 * Each patch is:
 *  - a handful of short flames licking up from it, from one shared pool of
 *    point particles (one draw call for every patch);
 *  - a wide, dim ember bed under the flames, one particle per patch slot;
 *  - a small, short-range, flickering point light, while it is one of the
 *    GROUND_FIRE.lights brightest patches.
 * The lights are created at start-up at zero intensity and never removed,
 * like the Firenado's own light: changing the scene's light count makes
 * three.js recompile every lit material's shader on the spot. That also
 * means every light costs every lit pixel on every frame, fire or no fire
 * (measured: 18 lights, one per patch, added ~0.9 ms a frame at 800x600),
 * so there are fewer lights than patches and they follow the brightest.
 */

const GROUND_FIRE = {
  maxPatches: 18,
  lights: 6,
  spacing: [0.2, 0.3],       // seconds between patches while burning
  minStrength: 0.3,          // Firenado strength needed to start patches
  // Seconds a patch burns after the funnel leaves -- or after the Firenado
  // itself has burned out. Raised from 3 on request, so the fire is still
  // visibly going for five seconds after the fire tornado is over.
  linger: 5,
  fadeIn: 0.35,
  fadeOut: 1.2,              // the last part of the linger, fading
  spreadFactor: 2.2,         // of the funnel's ground radius
  jitter: 1.3,               // flame spawn radius around a patch centre
  flameRate: 24,             // flames per second per patch at full burn
  flameLife: [0.45, 0.85],
  flameRise: [2.4, 4.4],
  flameSize: 2.3,
  flameMax: 360,
  bedSize: 6.5,
  lightColour: 0xff7a2a,
  lightPeak: 70,
  lightDistance: 16,
  lightDecay: 2,
  lightHeight: 1.4,
  hot: new THREE.Color(1.0, 0.82, 0.38),
  ember: new THREE.Color(0.7, 0.16, 0.04),
  bed: new THREE.Color(0.85, 0.28, 0.06)
};

/**
 * @typedef {Object} GroundFirePatch
 * @property {boolean} active
 * @property {number} x
 * @property {number} z
 * @property {number} age seconds since the patch was lit
 * @property {number} linger seconds left once the funnel has moved off it
 * @property {number} level 0..1 current burn
 * @property {number} seed per-patch random, for its flicker
 * @property {number} accumulator flames owed to its emitter
 * @property {number} flicker current light flicker, 0..1-ish
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initGroundFire: () => void,
 *   updateGroundFire: (dt: number, strength: number) => void,
 *   isBurning: () => boolean,
 *   contactAt: (x: number, z: number) => boolean,
 *   resetGroundFire: () => void,
 *   disposeGroundFire: () => void
 * }}
 */
export function createGroundFireSystem(ctx) {
  const { Sim, Vortex } = ctx;

  /** @type {GroundFirePatch[]} */
  const patches = [];
  /** @type {THREE.Object3D[]} */
  const lights = [];
  /** @type {GroundFirePatch[]} */
  const ranked = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let flames = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let beds = null;
  let spawnTimer = 0;
  let time = 0;
  let alive = 0;
  const scratch = new THREE.Color();

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initGroundFire() {
    const scene = Sim.three.scene;
    flames = createParticlePool(scene, GROUND_FIRE.flameMax, createFireTexture(), THREE.AdditiveBlending, 'groundFire_flames');
    beds = createParticlePool(scene, GROUND_FIRE.maxPatches, createFireTexture(), THREE.AdditiveBlending, 'groundFire_beds');
    for (let i = 0; i < GROUND_FIRE.maxPatches; i++) {
      patches.push({ active: false, x: 0, z: 0, age: 0, linger: 0, level: 0, seed: 0, accumulator: 0, flicker: 0 });
    }
    for (let i = 0; i < GROUND_FIRE.lights; i++) {
      const light = ctx.systems.lightPool.createLight(GROUND_FIRE.lightColour, 0, GROUND_FIRE.lightDistance, GROUND_FIRE.lightDecay);
      light.name = `groundFire_light_${i}`;
      scene.add(light);
      lights.push(light);
    }
  }

  /**
   * @returns {number} the funnel's ground-contact radius in world units
   */
  function groundRadius() {
    return ctx.systems.vortex.funnelRadiusAt(0) * Vortex.group.scale.x * GROUND_FIRE.spreadFactor;
  }

  /**
   * Lights a patch at a random spot under the funnel, in a free slot or,
   * when every slot burns, in the oldest one.
   * @param {number} radius
   * @returns {void}
   */
  function lightPatch(radius) {
    let slot = patches.find(p => !p.active);
    if (!slot) slot = patches.reduce((oldest, p) => (p.age > oldest.age ? p : oldest));
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    slot.active = true;
    slot.x = Vortex.center.x + Math.cos(angle) * r;
    slot.z = Vortex.center.z + Math.sin(angle) * r;
    slot.age = 0;
    slot.linger = GROUND_FIRE.linger;
    slot.level = 0;
    slot.seed = Math.random();
    slot.accumulator = 0;
  }

  /**
   * One flame licking up from a patch.
   * @param {GroundFirePatch} patch
   * @returns {void}
   */
  function spawnFlame(patch) {
    const p = flames;
    const i = p.next;
    p.next = (p.next + 1) % GROUND_FIRE.flameMax;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * GROUND_FIRE.jitter;
    p.positions[i * 3] = patch.x + Math.cos(angle) * r;
    p.positions[i * 3 + 1] = 0.2;
    p.positions[i * 3 + 2] = patch.z + Math.sin(angle) * r;
    p.velocities[i * 3] = (Math.random() - 0.5) * 0.8;
    p.velocities[i * 3 + 1] = between(GROUND_FIRE.flameRise);
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    p.life[i] = p.maxLife[i] = between(GROUND_FIRE.flameLife);
    p.seed[i] = patch.level;
  }

  /**
   * Ages every patch: full burn while the funnel is over it, then the
   * linger countdown once it has moved off (or the Firenado has ended),
   * fading over the last GROUND_FIRE.fadeOut seconds.
   * @param {number} dt
   * @param {number} strength Firenado strength, 0..1
   * @param {number} radius
   * @returns {void}
   */
  function updatePatches(dt, strength, radius) {
    alive = 0;
    const bed = beds;
    for (let s = 0; s < patches.length; s++) {
      const patch = patches[s];
      if (!patch.active) {
        bed.colours[s * 4 + 3] = 0;
        bed.sizes[s] = 0;
        continue;
      }
      patch.age += dt;
      const dx = patch.x - Vortex.center.x;
      const dz = patch.z - Vortex.center.z;
      const underFunnel = strength > 0 && dx * dx + dz * dz < radius * radius;
      patch.linger = underFunnel ? GROUND_FIRE.linger : patch.linger - dt;
      if (patch.linger <= 0) {
        patch.active = false;
        bed.colours[s * 4 + 3] = 0;
        bed.sizes[s] = 0;
        continue;
      }
      alive++;
      patch.level = Math.min(1, patch.age / GROUND_FIRE.fadeIn) * Math.min(1, patch.linger / GROUND_FIRE.fadeOut);

      const seedPhase = patch.seed * 40;
      const flicker = 0.72 + 0.14 * Math.sin(time * 19 + seedPhase) + 0.08 * Math.sin(time * 31 + seedPhase * 1.7)
        + 0.06 * Math.random();
      patch.flicker = flicker;

      bed.positions[s * 3] = patch.x;
      bed.positions[s * 3 + 1] = 0.25;
      bed.positions[s * 3 + 2] = patch.z;
      bed.colours[s * 4] = GROUND_FIRE.bed.r;
      bed.colours[s * 4 + 1] = GROUND_FIRE.bed.g;
      bed.colours[s * 4 + 2] = GROUND_FIRE.bed.b;
      bed.colours[s * 4 + 3] = 0.42 * patch.level * flicker;
      bed.sizes[s] = GROUND_FIRE.bedSize * (0.85 + 0.3 * patch.seed);

      patch.accumulator += GROUND_FIRE.flameRate * patch.level * dt;
      while (patch.accumulator >= 1) {
        patch.accumulator -= 1;
        spawnFlame(patch);
      }
    }
  }

  /**
   * Hands the light pool to the brightest patches.
   * @returns {void}
   */
  function updateLights() {
    ranked.length = 0;
    for (const patch of patches) if (patch.active) ranked.push(patch);
    ranked.sort((a, b) => b.level - a.level);
    for (let i = 0; i < lights.length; i++) {
      const patch = ranked[i];
      if (!patch) {
        lights[i].intensity = 0;
        continue;
      }
      lights[i].intensity = GROUND_FIRE.lightPeak * patch.level * patch.flicker;
      lights[i].position.set(patch.x, GROUND_FIRE.lightHeight, patch.z);
    }
  }

  /**
   * Rises, shrinks and cools the patch flames.
   * @param {number} dt
   * @returns {void}
   */
  function updateFlames(dt) {
    const p = flames;
    for (let i = 0; i < GROUND_FIRE.flameMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      const c = scratch.copy(GROUND_FIRE.hot).lerp(GROUND_FIRE.ember, u);
      p.colours[i * 4] = c.r;
      p.colours[i * 4 + 1] = c.g;
      p.colours[i * 4 + 2] = c.b;
      // seed holds the patch's burn level when the flame left it, so a
      // fading patch sends up fainter flames.
      p.colours[i * 4 + 3] = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6) * 0.9 * p.seed[i];
      p.sizes[i] = GROUND_FIRE.flameSize * (1 - 0.65 * u);
    }
  }

  /**
   * Per frame (not while paused).
   * @param {number} dt
   * @param {number} strength Firenado strength, 0..1
   * @returns {void}
   */
  function updateGroundFire(dt, strength) {
    if (!flames) return;
    time += dt;
    const radius = groundRadius();
    if (strength >= GROUND_FIRE.minStrength) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        lightPatch(radius);
        spawnTimer = between(GROUND_FIRE.spacing);
      }
    }
    updatePatches(dt, strength, radius);
    updateLights();
    updateFlames(dt);
    markPoolDirty(flames);
    markPoolDirty(beds);
    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    flames.points.material.uniforms.uScale.value = scale;
    beds.points.material.uniforms.uScale.value = scale;
  }

  /**
   * @returns {boolean} whether any patch or flame is still showing
   */
  function isBurning() {
    return alive > 0 || (flames !== null && flames.life.some(l => l > 0));
  }

  /**
   * Whether a point stands in a burning patch: within the flame spawn radius
   * (`jitter`) of a patch that has grown past a quarter burn. Allocation-free.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function contactAt(x, z) {
    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i];
      if (!patch.active || patch.level < 0.25) continue;
      const dx = x - patch.x;
      const dz = z - patch.z;
      if (dx * dx + dz * dz <= GROUND_FIRE.jitter * GROUND_FIRE.jitter) return true;
    }
    return false;
  }

  /** @returns {void} */
  function resetGroundFire() {
    for (const patch of patches) patch.active = false;
    for (const light of lights) light.intensity = 0;
    for (const p of [flames, beds]) {
      if (!p) continue;
      p.life.fill(0);
      p.colours.fill(0);
      p.sizes.fill(0);
      markPoolDirty(p);
    }
    spawnTimer = 0;
    alive = 0;
  }

  /** @returns {void} */
  function disposeGroundFire() {
    const scene = Sim.three.scene;
    if (flames) disposeParticlePool(scene, flames);
    if (beds) disposeParticlePool(scene, beds);
    for (const light of lights) scene.remove(light);
    lights.length = 0;
    patches.length = 0;
    flames = null;
    beds = null;
  }

  return { initGroundFire, updateGroundFire, isBurning, contactAt, resetGroundFire, disposeGroundFire };
}
