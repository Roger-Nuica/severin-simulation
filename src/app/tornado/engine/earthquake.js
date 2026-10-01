import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION F.1 — Earthquake
 * ===========================================================================
 * (It was switched off for a while -- EARTHQUAKE.enabled -- and is back on,
 * on request.)
 *
 * A manually-triggered event (btn-earthquake), independent of the tornado
 * itself: the ground trembles under the whole town for a few seconds, dust
 * kicks up off the streets, and a procedural rumble/crack soundtrack
 * (sound/earthquake.js) plays underneath — the same "self-contained
 * addition" shape as lightning.js and firenado.js, reading Sim/Vortex state
 * without ever writing to the params the sliders own.
 *
 * Three pieces:
 *  - a strength envelope (quick ramp in, a sustained rough tremor, a slower
 *    fade out) driving everything below;
 *  - camera shake, applied directly to the camera each frame the same way
 *    lightning.js's Lightning.shake is (after Sim.three.controls.update()
 *    has already run this frame, so OrbitControls simply overwrites it again
 *    next frame rather than the offset ever accumulating) — but earthquake
 *    shake is sustained and self-owned rather than a single decaying pulse,
 *    since a tremor doesn't read as one punctuation mark the way a lightning
 *    strike or an explosion does;
 *  - dust puffs erupting from random points across the town for as long as
 *    the tremor is strong enough to be kicking anything up, using the same
 *    pooled-particle shader as the Firenado's flames/embers.
 * A banner announces the start and the settle, reusing the Firenado banner's
 * DOM/CSS shape under its own class.
 *
 * A strong enough tremor also tears the ground open and erupts lava
 * (engine/fissure.js), armed here with a severity from the magnitude.
 *
 * The shaking itself is cosmetic + score: it doesn't touch damageState or
 * interact with the vortex/physics/capture machinery at all. Only a fissure
 * opening under a building does, through damage.js's shockBuilding.
 */

const EARTHQUAKE = {
  // Back on, on request (it was switched off for a while because the
  // shaking ground left Roger unplayable in Hero Mode). Set to false to
  // switch it off again -- the button and Doomsday's opening beat both go
  // through triggerEarthquake. (There is no automatic one any more: starting
  // the tornado sets off no other disaster.)
  enabled: true,
  duration: 10,       // seconds of shaking once triggered
  rampIn: 0.5,        // seconds to reach full strength
  rampOut: 2.4,        // seconds to fade back to still
  shakeMagnitude: 1.7, // world units of camera jitter at full strength
  // The ground splits open (engine/chasm.js) this far into the shaking, once
  // the tremor has had a moment to build.
  chasmDelay: 1.2,
  // The red lava seams (engine/fissure.js) are kept for the strongest quakes
  // only: on their own they read as scratches, and the chasm is the event.
  eruptionMagnitude: 7.9,
  bannerSeconds: 2.8,
  // A quake above this magnitude also takes the ground away somewhere
  // (engine/sinkhole.js). The scale runs 6.0 to 8.8, so this is roughly the
  // upper half of them.
  sinkholeMagnitude: 7.1,
  // Seconds into the shaking before it opens, so it reads as a consequence of
  // the quake rather than as part of the same instant.
  sinkholeDelay: [1.8, 4.2],
  townRadius: [8, 95]  // dust spawns anywhere in this ring around the origin
};

const DUST = {
  max: 320,
  rate: 55,             // particles/sec at full strength
  life: [1.1, 2.3],
  gravity: -1.1,         // negative: buoyant, drifts up like kicked-up dust
  drag: 0.5,
  size: 2.4,
  colour: new THREE.Color(0.5, 0.44, 0.35)
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initEarthquake: () => void,
 *   updateEarthquake: (dt: number) => void,
 *   triggerEarthquake: () => void,
 *   resetEarthquake: () => void,
 *   disposeEarthquake: () => void,
 *   earthquakeStrength: () => number
 * }}
 */
export function createEarthquakeSystem(ctx) {
  const { Sim, container } = ctx;

  const state = {
    /** @type {'idle'|'shaking'|'done'} */
    phase: 'idle',
    age: 0,
    strength: 0,
    time: 0,
    bannerTimer: 0,
    // Counts down to a sinkhole opening; 0 means none is pending.
    sinkholeTimer: 0,
    // Counts down to the chasm opening; 0 means none is pending.
    chasmTimer: 0
  };
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let dust = null;
  let dustAccumulator = 0;
  let dustAlive = 0;
  /** @type {HTMLDivElement|null} */
  let banner = null;

  /** @returns {void} */
  function initEarthquake() {
    dust = createParticlePool(
      Sim.three.scene, DUST.max, createSoftDotTexture(), THREE.NormalBlending, 'earthquake_dust'
    );

    banner = document.createElement('div');
    banner.className = 'earthquake-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);

    const quakeButton = document.getElementById('btn-earthquake');
    if (quakeButton) {
      quakeButton.addEventListener('click', () => triggerEarthquake(), { signal: ctx.signal });
      if (!EARTHQUAKE.enabled) {
        quakeButton.disabled = true;
        quakeButton.title = 'Earthquake is switched off for now';
      }
    }
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    state.bannerTimer = EARTHQUAKE.bannerSeconds;
  }

  /**
   * Starts (or restarts) the tremor. Works whenever the run is not already
   * mid-quake, sandbox or Chase Mode alike, the same way Ignite works
   * whenever the tornado isn't already burning.
   * @returns {void}
   */
  function triggerEarthquake() {
    if (!EARTHQUAKE.enabled || state.phase === 'shaking') return;
    state.phase = 'shaking';
    state.age = 0;
    const magnitude = 6.5 + Math.random() * 2.3;
    showBanner('EARTHQUAKE!', `Magnitude ${magnitude.toFixed(1)} · the ground is splitting`);
    // public/sounds/earthquake.wav, over the procedural rumble.
    ctx.systems.cues.playEarthquake();
    state.chasmTimer = EARTHQUAKE.chasmDelay;
    if (magnitude >= EARTHQUAKE.eruptionMagnitude) {
      ctx.systems.fissures.armEruption((magnitude - 6) / 2.8);
    }
    // A lump of damage for the tremor itself, independent of anything the
    // tornado does -- roughly on par with a building losing a wall (damage.js).
    Sim.stats.damageScore += Math.round(60 + magnitude * 12);
    // A big one takes the ground away somewhere as well as tearing it open
    // (engine/sinkhole.js). Held back a few seconds so it opens *during* the
    // shaking rather than as part of the same instant, and only on the harder
    // quakes -- a sinkhole is permanent and three of them is the ceiling.
    if (magnitude > EARTHQUAKE.sinkholeMagnitude) {
      state.sinkholeTimer = EARTHQUAKE.sinkholeDelay[0]
        + Math.random() * (EARTHQUAKE.sinkholeDelay[1] - EARTHQUAKE.sinkholeDelay[0]);
    }
  }

  /**
   * Seeds one small burst of dust particles at a ground point.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function spawnDustPuff(x, z, scale = 1) {
    const p = dust;
    const count = Math.round((5 + Math.floor(Math.random() * 6)) * scale);
    for (let n = 0; n < count; n++) {
      const i = p.next;
      p.next = (p.next + 1) % DUST.max;
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 2) * scale;
      p.positions[i * 3] = x + (Math.random() - 0.5) * 1.6 * scale;
      p.positions[i * 3 + 1] = 0.05;
      p.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 1.6 * scale;
      p.velocities[i * 3] = Math.cos(angle) * speed;
      p.velocities[i * 3 + 1] = (0.8 + Math.random() * 1.8) * Math.min(2, scale);
      p.velocities[i * 3 + 2] = Math.sin(angle) * speed;
      p.life[i] = p.maxLife[i] = DUST.life[0] + Math.random() * (DUST.life[1] - DUST.life[0]);
      p.seed[i] = Math.random();
    }
    // Claims the particles as live straight away. updateDust() only runs when
    // the quake is shaking or something is already alight, so dust kicked up
    // with no earthquake running would otherwise sit frozen where it spawned
    // until the next quake came along to integrate it.
    dustAlive += count;
  }

  /**
   * Kicks up a cloud of dust at a ground point, with no earthquake involved.
   * Anything heavy landing wants this -- a viaduct span coming down is the
   * first caller -- and the alternative was a second dust pool that looked
   * subtly different from this one for no reason.
   * @param {number} x
   * @param {number} z
   * @param {number} [puffs] how many separate puffs to seed
   * @param {number} [scale] how violent each puff is
   * @returns {void}
   */
  function kickDust(x, z, puffs = 3, scale = 1.6) {
    if (!dust) return;
    for (let i = 0; i < puffs; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 3.5 * scale;
      spawnDustPuff(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, scale);
    }
  }

  /**
   * Integrates and fades every live dust particle.
   * @param {number} dt
   * @returns {void}
   */
  function updateDust(dt) {
    const p = dust;
    const damping = Math.exp(-DUST.drag * dt);
    dustAlive = 0;
    for (let i = 0; i < DUST.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      dustAlive++;
      p.velocities[i * 3 + 1] -= DUST.gravity * dt;
      p.velocities[i * 3] *= damping;
      p.velocities[i * 3 + 1] *= damping;
      p.velocities[i * 3 + 2] *= damping;
      p.positions[i * 3] += p.velocities[i * 3] * dt;
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt;
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      p.colours[i * 4] = DUST.colour.r;
      p.colours[i * 4 + 1] = DUST.colour.g;
      p.colours[i * 4 + 2] = DUST.colour.b;
      p.colours[i * 4 + 3] = 0.55 * (1 - u) * Math.min(1, p.life[i] / 0.25);
      p.sizes[i] = DUST.size * (0.6 + 0.8 * p.seed[i]) * (0.6 + 0.8 * u);
    }
    markPoolDirty(p);
    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    p.points.material.uniforms.uScale.value = scale;
  }

  /**
   * Nudges the camera for one frame of tremor. Called after
   * Sim.three.controls.update() has already run this frame (see animate()),
   * exactly like Lightning.shake's application -- OrbitControls recomputes
   * position from its own internal state next frame regardless, so this
   * offset never accumulates.
   * @returns {void}
   */
  function applyCameraShake() {
    const mag = EARTHQUAKE.shakeMagnitude * state.strength;
    if (mag <= 0.0005) return;
    const t = state.time;
    // Two incommensurate low-frequency sines give a rolling tremor rather
    // than pure noise, with per-frame jitter layered on top for the harsh
    // high-frequency "crack" a real quake has alongside the rolling motion.
    const roll = Math.sin(t * 31.7) * 0.6 + Math.sin(t * 53.1 + 1.9) * 0.4;
    const rollZ = Math.sin(t * 37.3 + 0.7) * 0.6 + Math.sin(t * 47.9 + 2.6) * 0.4;
    Sim.three.camera.position.x += (roll * 0.6 + (Math.random() - 0.5)) * mag;
    Sim.three.camera.position.y += (Math.random() - 0.5) * mag * 0.4;
    Sim.three.camera.position.z += (rollZ * 0.6 + (Math.random() - 0.5)) * mag;
  }

  /**
   * Per frame (not while paused, matching updateFirenado's call site): the
   * event's envelope and everything it drives.
   * @param {number} dt
   * @returns {void}
   */
  function updateEarthquake(dt) {
    if (!dust) return;
    state.time += dt;
    if (state.sinkholeTimer > 0) {
      state.sinkholeTimer -= dt;
      if (state.sinkholeTimer <= 0) ctx.systems.sinkhole.openSinkhole();
    }
    if (state.chasmTimer > 0) {
      state.chasmTimer -= dt;
      if (state.chasmTimer <= 0 && ctx.systems.chasm) ctx.systems.chasm.openChasm();
    }
    if (state.phase === 'shaking') {
      state.age += dt;
      if (state.age >= EARTHQUAKE.duration) {
        state.phase = 'done';
        showBanner('Aftershocks fading', 'The ground has settled');
      }
    }
    const a = state.age;
    state.strength = state.phase === 'shaking'
      ? THREE.MathUtils.smoothstep(a, 0, EARTHQUAKE.rampIn)
        * (1 - THREE.MathUtils.smoothstep(a, EARTHQUAKE.duration - EARTHQUAKE.rampOut, EARTHQUAKE.duration))
      : 0;

    if (state.strength > 0) {
      applyCameraShake();
      const [minR, maxR] = EARTHQUAKE.townRadius;
      dustAccumulator += DUST.rate * state.strength * dt;
      while (dustAccumulator >= 1) {
        dustAccumulator -= 1;
        const angle = Math.random() * Math.PI * 2;
        const radius = minR + Math.random() * (maxR - minR);
        spawnDustPuff(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
    }

    if (state.strength > 0 || dustAlive > 0) updateDust(dt);

    ctx.systems.earthquakeSound.updateEarthquakeSound(state.strength, dt);

    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
  }

  /**
   * Stops any tremor in progress and re-arms the event for the next run.
   * @returns {void}
   */
  function resetEarthquake() {
    state.phase = 'idle';
    state.age = 0;
    state.strength = 0;
    state.bannerTimer = 0;
    state.sinkholeTimer = 0;
    state.chasmTimer = 0;
    dustAccumulator = 0;
    dustAlive = 0;
    if (dust) {
      dust.life.fill(0);
      dust.colours.fill(0);
      dust.sizes.fill(0);
      dust.accumulator = 0;
      markPoolDirty(dust);
    }
    if (banner) banner.classList.remove('visible');
    ctx.systems.earthquakeSound.fadeOutEarthquakeSound();
  }

  /**
   * @returns {number} the current 0..1 strength envelope, for fissure.js
   */
  function earthquakeStrength() {
    return state.strength;
  }

  /** @returns {void} */
  function disposeEarthquake() {
    if (dust) disposeParticlePool(Sim.three.scene, dust);
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    ctx.systems.earthquakeSound.disposeEarthquakeSound();
    dust = null;
    banner = null;
  }

  return {
    initEarthquake, updateEarthquake, triggerEarthquake, resetEarthquake, disposeEarthquake,
    earthquakeStrength, kickDust
  };
}
