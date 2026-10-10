// @ts-check
import * as THREE from 'three';
import { createFireTexture, createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';
import { METEOR, createCraterTexture, UP } from './meteors/config.js';
/** @typedef {import('./meteors/config.js').Meteor} Meteor */
import { createMeteorRocks } from './meteors/rocks.js';
import { createMeteorImpact } from './meteors/impact.js';
import { createMeteorTrails } from './meteors/trails.js';
import { createWeaponFx } from './hero/weaponFx.js';
import { meteorExtra } from './net/meteorFx.js';
import { LIMITS } from './net/protocol.js';
import { createRng } from './rng.js';
export { createCraterTexture } from './meteors/config.js';

/**
 * ===========================================================================
 * SECTION U — Meteor strikes
 * ===========================================================================
 * Ten of them, falling a good way into a run, each landing hard enough to
 * leave a permanent crater of scorched earth. Unlike the tanker, which is a
 * single scripted beat on a fuse, this is a bombardment: they come in on
 * staggered fuses from different bearings about a second and a half apart, so
 * five are burning on the ground while the rest are still in the air, and at
 * this blast radius their craters overlap into one continuous scar.
 *
 * A meteor is three things in sequence:
 *  - **the fall**: a glowing rock on a straight line from high up outside the
 *    map to its impact point, trailing fire and smoke. It is not simulated --
 *    the entry point, the impact point and the time between them are all
 *    decided up front, so it cannot miss and cannot be deflected;
 *  - **the impact**: a fireball well past a building collapse's, everything
 *    loose within the blast radius thrown outward, every building inside it
 *    shocked hard enough to come down, and the ground set alight;
 *  - **the scar**: a scorched crater decal left on the ground for the rest of
 *    the run, darkest at the centre and fading to a ring of burnt earth. Like
 *    the tornado's path scars (engine/groundFx.js) it is geometry, not an
 *    effect -- once written it is never moved, faded or retired.
 *
 * Deliberately independent of the tornado: the meteors fall whether or not a
 * storm is running and wherever it happens to be, which is what makes them a
 * second disaster rather than another thing the funnel does.
 */

/*
 * Split by job across engine/meteors/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js  tunables and the crater texture
 *   rocks.js   the rocks and a volley of them
 *   impact.js  impacts, the airburst, craters
 *   trails.js  smoke and fire trails
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initMeteors: () => void,
 *   updateMeteors: (dt: number) => void,
 *   callVolley: (count: number) => void,
 *   mirrorRock: (r: {seed: number, from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, radius: number, airburst: boolean}, sound: boolean) => void,
 *   clearMirror: () => void,
 *   resetMeteors: () => void,
 *   disposeMeteors: () => void
 * }}
 */
export function createMeteorSystem(ctx) {
  const { Sim } = ctx;
  /** Announces each rock's launch to the co-op guest (hero/weaponFx.js); nothing happens outside a room with a guest. */
  const weaponFx = createWeaponFx(ctx);
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {Meteor[]} */
    meteors: [],
    /** @type {THREE.Mesh[]} craters on the ground, oldest first */
    craters: [],
    /** @type {Array<{x: number, y: number, z: number, radius: number, hit: WeakSet<Object>}>} */
    bursts: [],

    /** Co-op guest: a host's rock has been drawn here, so leaving must clear the scars. */
    mirrored: false,
    bannerTimer: 0,
    /** @type {HTMLDivElement|null} */
    banner: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    trail: null,
    /** @type {THREE.Object3D|null} */
    light: null,
    /** @type {THREE.Texture|null} */
    craterTexture: null,
    // The soft round glow the incandescent envelope round each rock is drawn
    // with (see createMeteor). Shared: ten rocks falling at once need one.
    /** @type {THREE.Texture|null} */
    glowTexture: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    smoke: null,

    scratch: new THREE.Color(),
    // Reused every frame rather than allocated: ten meteors falling at once is
    // ten of each of these per frame otherwise.
    fallDir: new THREE.Vector3(),

    leadScratch: new THREE.Vector3(),

    spin: new THREE.Quaternion(),

    trailPoint: new THREE.Vector3(),

    trailDrift: new THREE.Vector3()
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createMeteorRocks(ctx, S, api),
    createMeteorImpact(ctx, S, api),
    createMeteorTrails(ctx, S, api),
    { between, showBanner }
  );

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!S.banner) return;
    S.banner.querySelector('.title').textContent = title;
    S.banner.querySelector('.sub').textContent = sub;
    S.banner.classList.add('visible');
    S.bannerTimer = METEOR.bannerSeconds;
  }

  /** @returns {void} */
  function initMeteors() {
    S.group = new THREE.Group();
    S.group.name = 'meteors';
    Sim.three.scene.add(S.group);

    S.craterTexture = createCraterTexture();
    S.glowTexture = createSoftDotTexture();
    S.trail = createParticlePool(
      Sim.three.scene, METEOR.maxParticles, createFireTexture(), THREE.AdditiveBlending, 'meteor_trail'
    );
    S.smoke = createParticlePool(
      Sim.three.scene, METEOR.smokeMax, createSoftDotTexture(), THREE.NormalBlending, 'meteor_smoke'
    );
    // One light between all three: they land seconds apart, so it simply
    // follows whichever is currently the brightest thing in the sky.
    S.light = ctx.systems.lightPool.createLight(METEOR.hotColour, 0, METEOR.lightDistance, 2);
    S.light.name = 'meteor_light';
    Sim.three.scene.add(S.light);

    if (!S.banner) {
      S.banner = document.createElement('div');
      S.banner.className = 'meteor-banner';
      S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(S.banner);
    }
    const button = document.getElementById('btn-meteors');
    // The only way they come: the button (and Doomsday, which calls
    // callVolley itself). Nothing is scheduled on the run clock any more --
    // starting the tornado brings no meteors with it.
    if (button) button.addEventListener('click', () => api.callVolley(METEOR.volley), { signal: ctx.signal });
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateMeteors(dt) {
    if (!S.group) return;

    if (S.bannerTimer > 0) {
      S.bannerTimer -= dt;
      if (S.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }

    let brightest = 0;
    // Backwards: a rock that lands is taken out of the list here.
    for (let i = S.meteors.length - 1; i >= 0; i--) {
      const meteor = S.meteors[i];
      if (meteor.state === 'waiting') {
        meteor.delay -= dt;
        if (meteor.delay > 0) continue;
        meteor.state = 'falling';
        meteor.mesh.visible = true;
        meteor.mesh.position.copy(meteor.from);
        // One row is the whole flight: the entry, the landing and the size (net/meteorFx.js).
        if (!meteor.shown) weaponFx.announce('meteor', meteor.from, meteor.to, '', meteorExtra(meteor.radius, meteor.airburst));
      }
      if (meteor.state !== 'falling') continue;
      meteor.t += dt / METEOR.fallTime;
      if (meteor.t >= meteor.burstAt) {
        if (meteor.shown) api.finishShown(meteor, true); else api.detonateAirburst(meteor);
        api.disposeMeteor(meteor);
        S.meteors.splice(i, 1);
        continue;
      }
      if (meteor.t >= 1) {
        if (meteor.shown) api.finishShown(meteor, false); else api.impact(meteor);
        // Everything it owns is its own and it will never be seen again;
        // volleys are unlimited, so leaving the generated rock, its glow
        // and fragments in the scene would be an unbounded leak.
        api.disposeMeteor(meteor);
        S.meteors.splice(i, 1);
        continue;
      }
      meteor.mesh.position.lerpVectors(meteor.from, meteor.to, meteor.t);
      // The group is aimed down the fall line (the fragments' drift is laid
      // out in its local space); the rock tumbles inside it.
      S.fallDir.subVectors(meteor.to, meteor.from).normalize();
      meteor.mesh.quaternion.setFromUnitVectors(UP, S.fallDir);
      meteor.body.rotation.x += dt * 2.4;
      meteor.body.rotation.z += dt * 1.8;

      // Heat ramps as it comes down through thicker air. uLead is the
      // direction of travel in the *rock's* own space -- it tumbles inside
      // the group, so which face is into the airflow keeps changing, and
      // that is the whole point of shading it this way.
      const heat = 0.35 + 0.65 * meteor.t;
      meteor.body.getWorldQuaternion(S.spin).invert();
      S.leadScratch.copy(S.fallDir).applyQuaternion(S.spin);
      meteor.body.material.uniforms.uLead.value.copy(S.leadScratch);
      meteor.body.material.uniforms.uHeat.value = heat;
      // The envelope brightens as it comes down, with a fast ragged flicker.
      const flicker = 0.85 + 0.15 * Math.sin(meteor.t * 90 + i) * Math.sin(meteor.t * 53 + i * 2);
      for (const glow of meteor.shock.children) {
        glow.material.opacity = glow.userData.base * heat * flicker;
      }

      // Pieces break off partway down and fan out from there.
      if (meteor.t > METEOR.fragmentStart) {
        const spread = (meteor.t - METEOR.fragmentStart) / (1 - METEOR.fragmentStart);
        for (const frag of meteor.fragments) {
          frag.mesh.visible = true;
          // Lateral only: they share the parent's fall, so the group's own
          // aim keeps them on the same line.
          frag.mesh.position.set(frag.driftX * spread, -spread * 4, frag.driftZ * spread);
          frag.mesh.rotation.x += frag.spin.x * dt;
          frag.mesh.rotation.y += frag.spin.y * dt;
          frag.mesh.rotation.z += frag.spin.z * dt;
          frag.mesh.getWorldQuaternion(S.spin).invert();
          frag.mesh.material.uniforms.uLead.value.copy(S.fallDir).applyQuaternion(S.spin);
          frag.mesh.material.uniforms.uHeat.value = heat;
        }
      }

      api.spawnTrailFor(meteor, dt);
      // The light follows whichever is lowest, i.e. closest to landing.
      const closeness = meteor.t;
      if (closeness > brightest) {
        brightest = closeness;
        S.light.position.copy(meteor.mesh.position);
      }
    }
    S.light.intensity = METEOR.lightPeak * brightest * brightest;

    api.updateTrail(dt);
    api.updateSmoke(dt);
    if (S.bursts.length) api.updateBursts(dt);
  }

  /**
   * Co-op guest: one of the host's rocks (an `fx` row of kind `meteor`), flown
   * from its entry to where it comes down with the same mesh and trail, and
   * burst cosmetically at the end. Starts nothing that hurts (R-053); no shake
   * (R-055). Held to the fx queue's size, so no new cap (R-048).
   * @param {{seed: number, from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, radius: number, airburst: boolean}} r
   * @param {boolean} sound the landing may sound
   * @returns {void}
   */
  function mirrorRock(r, sound) {
    if (!S.group || S.meteors.length >= LIMITS.maxFx) return;
    const rand = createRng(r.seed);
    const meteor = api.createMeteor(0, 1, { ...r, rand });
    meteor.shown = true;
    meteor.sound = sound;
    meteor.rand = rand;
    S.meteors.push(meteor);
    S.mirrored = true;
    showBanner('METEOR STRIKE!', 'Meteors inbound');
  }

  /**
   * Leaving the host's view: the host's rocks, scars and trails gone, this town's own back.
   * @returns {void}
   */
  function clearMirror() {
    if (!S.mirrored) return;
    S.mirrored = false;
    resetMeteors();
  }

  /**
   * Clears the rocks and craters for a fresh run.
   * @returns {void}
   */
  function resetMeteors() {
    for (const meteor of S.meteors) {
      api.disposeMeteor(meteor);
    }
    S.meteors = [];
    for (const crater of S.craters) {
      S.group.remove(crater);
      crater.geometry.dispose();
      crater.material.dispose();
    }
    S.craters = [];
    S.bursts.length = 0;
    S.mirrored = false;
    for (const pool of [S.trail, S.smoke]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      markPoolDirty(pool);
    }
    if (S.light) S.light.intensity = 0;
  }

  /** @returns {void} */
  function disposeMeteors() {
    if (!S.group) return;
    S.group.traverse((/** @type {any} */ child) => {
      if (child.geometry && !child.isSprite) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    if (S.trail) disposeParticlePool(Sim.three.scene, S.trail);
    if (S.smoke) disposeParticlePool(Sim.three.scene, S.smoke);
    if (S.light) Sim.three.scene.remove(S.light);
    if (S.craterTexture) S.craterTexture.dispose();
    if (S.glowTexture) S.glowTexture.dispose();
    S.glowTexture = null;
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    Sim.three.scene.remove(S.group);
    S.group = null;
    S.trail = null;
    S.smoke = null;
    S.light = null;
    S.craterTexture = null;
    S.banner = null;
    S.meteors = [];
    S.craters = [];
  }

  return {
    initMeteors, updateMeteors, resetMeteors, disposeMeteors, callVolley: api.callVolley, mirrorRock, clearMirror
  };
}
