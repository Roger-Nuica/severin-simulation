import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { FISSURE, SPATTER, ASH, lerpRange } from './fissure/config.js';
import { createFissureGeometry } from './fissure/geometry.js';
import { createFissureEruption } from './fissure/eruption.js';
import { createFissureParticles } from './fissure/particles.js';

/**
 * ===========================================================================
 * SECTION F.2 — Earthquake fissures and lava
 * ===========================================================================
 * Once an earthquake (engine/earthquake.js) is shaking hard enough, the
 * ground tears open at an epicentre and lava wells up through the cracks.
 * Driven entirely by the quake's own strength envelope, plus a 0..1
 * severity taken from its magnitude when it is triggered: there is no
 * intensity tier on the button, so every quake erupts, but a weak one opens
 * a few short, narrow cracks with dim lava and a strong one tears the town
 * apart.
 *
 * The pieces:
 *  - fissures: 3-6 flat strips radiating from the epicentre along a jittered
 *    random walk, wide at the epicentre and tapering to a point. Built once
 *    per eruption and never remeshed: they tear open by a reveal uniform the
 *    shader discards against, so only uniforms change per frame;
 *  - lava: the same shader heats each fissure's seam from black through deep
 *    red to orange-yellow once it has fully opened, with scrolling
 *    world-space value noise faking the flow. The colours run well above
 *    the post pipeline's bloom threshold (post.js), so the glow blooms
 *    without a pass of its own;
 *  - vents: low crusted domes at the epicentre and at 1-2 points along each
 *    fissure, pushing up as the tear reaches them;
 *  - particles: lava spatter arcing under real gravity and cooling from
 *    yellow to black, and sparse buoyant ash, from two pooled particle
 *    systems (engine/particlePool.js) capped at 150 particles between them;
 *  - light: each glowing vent asks the shared effect-light budget
 *    (lightPool.js) for a light every frame; the biggest and brightest win.
 *
 * Heat follows the quake's strength up but falls no faster than
 * FISSURE.coolSeconds allows, so the lava keeps glowing for a couple of
 * seconds after the shaking has stopped and cools rather than switching
 * off. Cold scars then linger and fade, and only then is the geometry
 * disposed. A quake triggered while an eruption is still showing extends it
 * (reheating the same fissures) rather than stacking a second set.
 *
 * Unlike the rest of the earthquake, a fissure that opens under a building
 * shocks it through the chain-reaction collapse path in damage.js, so it can
 * topple, or lose a wall or roof, by the same rules as a domino. A fissure
 * or vent opening under a utility pole faults the line
 * (environment/powerLines.js).
 */

/*
 * Split by job across engine/fissure/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js     every tunable
 *   geometry.js   the lava material, calderas, vents and the cracks
 *   eruption.js   eruptions, and what the opening ground breaks on the way
 *   particles.js  vents, their light, spatter and ash
 * and this file: set-up, the frame, reset and dispose, with the shared
 * state S and the modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initFissures: () => void,
 *   armEruption: (severity: number) => void,
 *   updateFissures: (dt: number, strength: number) => void,
 *   hotSpots: () => HotSpot[],
 *   quench: (spot: HotSpot) => void,
 *   resetFissures: () => void,
 *   disposeFissures: () => void
 * }}
 */
export function createFissureSystem(ctx) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {Fissure[]} */
    fissures: [],
    /** @type {Caldera[]} */
    calderas: [],
    // The molten ground published to the tornado picking a load up and to the
    // flood front looking for something to flash (see hotSpots). Rebuilt in
    // place every frame from a fixed set of per-vent and per-caldera entries,
    // so reading it costs no allocation.
    /** @type {HotSpot[]} */
    hotSpotList: [],

    burstAccumulator: 0,
    /** @type {Vent[]} */
    vents: [],
    // Shared by every fissure and vent material: one write lights them all.
    shared: { uTime: { value: 0 }, uGlow: { value: 0 }, uOpacity: { value: 1 } },
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {THREE.BufferGeometry|null} */
    ventGeometry: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    spatter: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    ash: null,

    eruption: { severity: 0, heat: 0, scarTimer: 0 },
    /** @type {number|null} severity waiting for the quake to get strong enough */
    armed: null,

    time: 0,

    spatterAccumulator: 0,

    ashAccumulator: 0,

    fountainAccumulator: 0,

    particlesAlive: 0,

    scratch: new THREE.Color()
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createFissureGeometry(ctx, S, api),
    createFissureEruption(ctx, S, api),
    createFissureParticles(ctx, S, api),
    {  }
  );

  /** @returns {void} */
  function initFissures() {
    const scene = Sim.three.scene;
    S.group = new THREE.Group();
    S.group.name = 'earthquake_fissures';
    scene.add(S.group);
    S.ventGeometry = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    S.spatter = createParticlePool(scene, SPATTER.max, createSoftDotTexture(), THREE.NormalBlending, 'earthquake_lavaSpatter');
    S.ash = createParticlePool(scene, ASH.max, createSoftDotTexture(), THREE.NormalBlending, 'earthquake_ash');
  }

  /**
   * Per frame (not while paused, matching updateEarthquake's call site).
   * @param {number} dt
   * @param {number} strength the earthquake's current 0..1 strength
   * @returns {void}
   */
  function updateFissures(dt, strength) {
    if (!S.spatter) return;
    S.time += dt;
    S.shared.uTime.value = S.time;
    if (S.armed !== null && strength > FISSURE.triggerStrength) {
      if (S.fissures.length) api.extendEruption(S.armed);
      else api.erupt(S.armed);
      S.armed = null;
    }

    let level = 0;
    if (S.fissures.length) {
      S.eruption.heat = Math.max(strength, S.eruption.heat - dt / FISSURE.coolSeconds, 0);
      const glow = S.eruption.heat * lerpRange(FISSURE.glow, S.eruption.severity);
      S.shared.uGlow.value = glow;
      api.updateGrowth(dt);
      api.updateVents(dt, glow);
      api.updateCalderas(dt, glow);
      level = glow * S.fissures.reduce((sum, f) => sum + f.lava.value, 0) / S.fissures.length;
      api.emit(dt, level);

      if (S.eruption.heat <= 0) {
        S.eruption.scarTimer += dt;
        S.shared.uOpacity.value = 1 - THREE.MathUtils.smoothstep(
          S.eruption.scarTimer, FISSURE.scarHold, FISSURE.scarHold + FISSURE.scarFade
        );
        if (S.eruption.scarTimer >= FISSURE.scarHold + FISSURE.scarFade && S.particlesAlive === 0) api.clearEruption();
      }
    }

    if (!S.fissures.length && S.calderas.length) api.updateCalderas(dt, 0);
    api.requestVentLights();
    api.requestCalderaLight();
    if (level > 0 || S.particlesAlive > 0) api.updateParticles(dt);
    ctx.systems.earthquakeSound.updateLavaSound(level, dt);
  }

  /** @returns {void} */
  function resetFissures() {
    if (S.group) {
      api.clearEruption();
      for (const caldera of S.calderas) api.disposeCaldera(caldera);
      S.calderas.length = 0;
    }
    S.burstAccumulator = 0;
    S.armed = null;
    S.spatterAccumulator = 0;
    S.ashAccumulator = 0;
    S.fountainAccumulator = 0;
    S.particlesAlive = 0;
    for (const p of [S.spatter, S.ash]) {
      if (!p) continue;
      p.life.fill(0);
      p.colours.fill(0);
      p.sizes.fill(0);
      markPoolDirty(p);
    }
  }

  /** @returns {void} */
  function disposeFissures() {
    const scene = Sim.three.scene;
    if (S.group) {
      api.clearEruption();
      for (const caldera of S.calderas) api.disposeCaldera(caldera);
      S.calderas.length = 0;
      scene.remove(S.group);
    }
    if (S.ventGeometry) S.ventGeometry.dispose();
    if (S.spatter) disposeParticlePool(scene, S.spatter);
    if (S.ash) disposeParticlePool(scene, S.ash);
    S.group = null;
    S.ventGeometry = null;
    S.spatter = null;
    S.ash = null;
  }

  /**
   * Whether a point stands on molten ground: inside the radius of a glowing
   * vent or caldera lake (the same spots the Lavanado reads), no allocation.
   * @param {number} x
   * @param {number} z
   * @param {number} minLevel How molten a spot must be to burn, 0..1.
   * @returns {boolean}
   */
  function lavaContactAt(x, z, minLevel) {
    const spots = api.hotSpots();
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];
      if (spot.level <= minLevel) continue;
      const dx = x - spot.x;
      const dz = z - spot.z;
      if (dx * dx + dz * dz <= spot.radius * spot.radius) return true;
    }
    return false;
  }

  return {
    initFissures, lavaContactAt, armEruption: api.armEruption, updateFissures, resetFissures, disposeFissures,
    // Read by the tornado picking up a load of lava (engine/lavanado.js) and
    // by the flood front finding one (engine/collisions.js).
    hotSpots: api.hotSpots, quench: api.quench
  };
}
