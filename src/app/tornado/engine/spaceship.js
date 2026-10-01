// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { createCraterTexture } from './meteors.js';
import { bannerHost } from '../utils/banners.js';
import { SHIP, THRUST, SUPPORT } from './spaceship/config.js';
/** @typedef {import('./spaceship/config.js').Ship} Ship */
import { createSpaceshipDescent } from './spaceship/descent.js';
import { createSpaceshipEffects } from './spaceship/effects.js';
import { createSupportTargeting } from './spaceship/targeting.js';
import { createSamuraiSquad } from './spaceship/samurai.js';
import { createRocketStrike } from './spaceship/rocket.js';
export { buildSaucer } from './spaceship/config.js';

/**
 * ===========================================================================
 * SECTION AH — Landing Support
 * ===========================================================================
 * What the Landing disaster has become (btn-landing, or T): support called
 * in on a point of the town, two ways.
 *
 *  - **Targeting** (spaceship/targeting.js): T or the tile puts a marker on
 *    the ground under the pointer, with the samurai's coverage (ring A,
 *    blue) and the rocket's blast (ring B, red -- warning red with Roger in
 *    it) round it. R calls the samurai, T again the rocket, Esc or a
 *    right-click cancels.
 *  - **Samurai Support** (spaceship/descent.js, samurai.js): a ship comes
 *    down on the marker and ten samurai walk down its ramp, as the aliens
 *    come off theirs, and clear every alien and the T-Rex out of 100 m
 *    round it for two minutes. Nothing but Roger can kill them.
 *  - **Rocket Strike** (spaceship/rocket.js): a rocket falls on the marker
 *    from the nose camera, steered a little with W A S D, and goes off --
 *    the tanker's explosion at twice the reach and a ring of fire sweeping
 *    out, destroying everything inside it.
 * Each has its own SUPPORT.cooldown; one squad at a time. Enter does nothing
 * here any more (the old ride-it-down landing, its hover and its Space/Enter
 * drop, is gone; so is double-clicking the ground for a spot).
 *
 * Split by job across engine/spaceship/:
 *   config.js       tunables and the saucer model
 *   targeting.js    T: the marker, the rings, the keys, the HUD
 *   descent.js      the samurai ship: down, the ramp, the stay, away
 *   samuraiModel.js the samurai's tunables and model
 *   samurai.js      the squad: down the ramp, guarding, hunting, the cuts
 *   rocket.js       the Rocket Strike: the fall, the blast, the camera
 *   effects.js      thrust, shock rings, craters
 * and this file: set-up, the frame, reset and dispose, with the shared state
 * S and the modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initSpaceship: () => void,
 *   updateSpaceship: (rawDt: number) => void,
 *   updateSupportWorld: (dt: number) => void,
 *   placeCamera: () => void,
 *   isLanding: () => boolean,
 *   callSamurai: (x: number, z: number) => boolean,
 *   fireRocket: (x: number, z: number) => boolean,
 *   targeting: () => boolean,
 *   samuraiTargets: () => {x: number, z: number, radius: number, top: number, unit: Object}[],
 *   hitSamurai: (unit: Object, type: string) => boolean,
 *   hitSamuraiArea: (x: number, z: number, radius: number, type: string) => number,
 *   samuraiPositions: () => THREE.Vector3[],
 *   landedSpots: () => {x: number, z: number, radius: number}[],
 *   resetSpaceship: () => void,
 *   disposeSpaceship: () => void
 * }}
 */
export function createSpaceshipSystem(ctx) {
  const { Sim, container } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
    state: {
      /** @type {'idle'|'descending'|'deploying'|'unloading'|'guarding'|'boarding'|'retracting'|'leaving'} the samurai ship */
      phase: 'idle',
      t: 0,
      timer: 0,
      startY: 0,
      brakeY: 0,
      spawned: 0,
      exitTimer: 0,
      // Seconds of the squad's stay left.
      stay: 0,
      bannerTimer: 0,
      time: 0
    },
    // Seconds before each option can be used again.
    cooldown: { samurai: 0, rocket: 0 },
    /** @type {THREE.Vector3} where the samurai ship came down */
    drop: new THREE.Vector3(),
    /** @type {THREE.Vector3} the same, for the thrust's wash across the ground */
    landing: new THREE.Vector3(),
    /** @type {THREE.Vector3} the way its ramp runs out */
    dir: new THREE.Vector3(0, 0, 1),
    /** @type {THREE.Vector3} the way it came in */
    heading: new THREE.Vector3(0, 0, -1),
    rampTop: new THREE.Vector3(),
    rampFoot: new THREE.Vector3(),
    /** @type {Ship|null} */
    ship: null,
    /** @type {THREE.Group|null} */
    ramp: null,
    /** @type {THREE.Mesh[]} */
    craters: [],
    /** @type {{mesh: THREE.Mesh, age: number, life: number, from: number, reach: number}[]} */
    rings: [],
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    thrust: null,
    thrustAlive: 0,
    /** @type {THREE.Object3D|null} */
    light: null,
    /** @type {THREE.Texture|null} */
    craterTexture: null,
    /** @type {HTMLDivElement|null} the rocket's nose camera frame */
    cockpit: null,
    /** @type {HTMLDivElement|null} */
    fader: null,
    /** @type {HTMLDivElement|null} */
    banner: null,
    /** @type {HTMLButtonElement|null} */
    button: null
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createSpaceshipDescent(ctx, S, api),
    createSpaceshipEffects(ctx, S, api),
    createSupportTargeting(ctx, S, api),
    createSamuraiSquad(ctx, S, api),
    createRocketStrike(ctx, S, api),
    { between, disposeShip, showBanner }
  );

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * @param {Ship} s
   * @returns {void}
   */
  function disposeShip(s) {
    if (s.group.parent) s.group.parent.remove(s.group);
    const geometries = new Set();
    const materials = new Set();
    s.group.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) materials.add(child.material);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  }

  // ---------------------------------------------------------------------
  // Set-up
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function initSpaceship() {
    S.group = new THREE.Group();
    S.group.name = 'landing_support';
    Sim.three.scene.add(S.group);

    S.craterTexture = createCraterTexture();
    S.thrust = createParticlePool(
      Sim.three.scene, THRUST.max, createSoftDotTexture(), THREE.AdditiveBlending, 'spaceship_thrusters'
    );
    // Added now at zero rather than on the first call: a light joining the
    // scene mid-run makes every lit material recompile on the next frame.
    S.light = ctx.systems.lightPool.createLight(SHIP.glow, 0, SHIP.lightDistance, 2);
    S.light.name = 'spaceship_light';
    Sim.three.scene.add(S.light);

    // The rocket's nose camera: the old cockpit's frame round a round window.
    S.cockpit = document.createElement('div');
    S.cockpit.className = 'ship-cockpit rocket';
    S.cockpit.innerHTML =
      '<div class="ship-window"></div>'
      + '<div class="rocket-reticle"></div>'
      + '<div class="ship-hud"><span class="ship-hud-alt"></span><span class="ship-hud-dist"></span><span class="ship-hud-state"></span></div>';
    container.appendChild(S.cockpit);
    S.fader = document.createElement('div');
    S.fader.className = 'ship-fade';
    container.appendChild(S.fader);

    S.banner = document.createElement('div');
    S.banner.className = 'spaceship-banner';
    S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(S.banner);

    S.button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-landing'));
    if (S.button) S.button.addEventListener('click', () => api.toggle(), { signal: ctx.signal });

    api.initTargeting();
    api.initSquad();
    api.initRocket();
    // The samurai ship, for the black hole (engine/effects/consumables.js):
    // dissolved, and the squad still aboard with it.
    ctx.systems.consumables.register({
      kind: 'samuraiShip',
      list: () => (S.ship && S.state.phase !== 'descending' ? [S.ship] : []),
      position: (s) => s.group.position,
      object: (s) => s.group,
      big: true,
      consume: () => {
        api.recall();
        api.clearSquad();
        api.removeShip();
        S.state.phase = 'idle';
        S.cooldown.samurai = SUPPORT.cooldown;
        ctx.systems.spaceshipSound.fadeOutSpaceshipSound();
      }
    });
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
    S.state.bannerTimer = SHIP.bannerSeconds;
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * Per frame, on real time (held while paused): targeting, the rocket, the
   * thrust and the rings, the cooldowns.
   * @param {number} rawDt
   * @returns {void}
   */
  function updateSpaceship(rawDt) {
    if (!S.group) return;
    const dt = Sim.state.paused ? 0 : rawDt;
    api.updateTargeting(rawDt);
    api.updateRocket(dt);
    if (dt > 0) {
      S.cooldown.samurai = Math.max(0, S.cooldown.samurai - dt);
      S.cooldown.rocket = Math.max(0, S.cooldown.rocket - dt);
    }
    if (dt > 0 && (S.thrustAlive > 0 || (S.ship && (S.state.phase === 'descending' || S.state.phase === 'leaving')))) api.updateThrust(dt);
    if (dt > 0 && S.rings.length) api.updateRings(dt);
    if (S.state.bannerTimer > 0) {
      S.state.bannerTimer -= rawDt;
      if (S.state.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }
  }

  /**
   * Per frame, on the world's time (the samurai slow with it): the ship and
   * the squad.
   * @param {number} dt
   * @returns {void}
   */
  function updateSupportWorld(dt) {
    if (!S.group || dt <= 0) return;
    api.updateShip(dt);
    api.updateSquad(dt);
  }

  /**
   * After every other camera writer but the glide and the shake: the
   * rocket's nose camera, and its turn round the crater.
   * @returns {void}
   */
  function placeCamera() {
    if (api.rocketActive()) api.placeRocketCamera();
  }

  /** @returns {boolean} whether the rocket has the camera (and W A S D) */
  function isLanding() {
    return api.rocketActive();
  }

  /**
   * Stops everything in progress, clears the ship, the squad and the
   * craters, and re-arms both options.
   * @returns {void}
   */
  function resetSpaceship() {
    api.resetTargeting();
    api.resetRocket();
    api.clearSquad();
    api.removeShip();
    S.state.phase = 'idle';
    S.state.t = 0;
    S.state.timer = 0;
    S.state.bannerTimer = 0;
    S.cooldown.samurai = 0;
    S.cooldown.rocket = 0;
    for (const crater of S.craters) {
      S.group.remove(crater);
      crater.geometry.dispose();
      crater.material.dispose();
    }
    S.craters = [];
    for (const ring of S.rings) {
      S.group.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
    }
    S.rings = [];
    if (S.thrust) {
      S.thrust.life.fill(0);
      S.thrust.colours.fill(0);
      S.thrust.sizes.fill(0);
      S.thrust.accumulator = 0;
      markPoolDirty(S.thrust);
    }
    S.thrustAlive = 0;
    if (S.light) S.light.intensity = 0;
    if (S.cockpit) S.cockpit.classList.remove('visible', 'braking');
    document.body.classList.remove('ship-cutscene');
    if (S.fader) S.fader.style.opacity = '0';
    if (S.banner) S.banner.classList.remove('visible');
    ctx.systems.spaceshipSound.fadeOutSpaceshipSound();
  }

  /** @returns {void} */
  function disposeSpaceship() {
    if (!S.group) return;
    resetSpaceship();
    api.disposeTargeting();
    api.disposeSquad();
    api.disposeRocket();
    Sim.three.scene.remove(S.group);
    if (S.thrust) disposeParticlePool(Sim.three.scene, S.thrust);
    if (S.light) Sim.three.scene.remove(S.light);
    if (S.craterTexture) S.craterTexture.dispose();
    for (const el of [S.cockpit, S.fader, S.banner]) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    ctx.systems.spaceshipSound.disposeSpaceshipSound();
    S.group = null;
    S.thrust = null;
    S.light = null;
    S.craterTexture = null;
    S.cockpit = null;
    S.fader = null;
    S.banner = null;
    S.button = null;
  }

  /**
   * Where something stands that the vehicles have to stop in front of
   * (environment/blockers.js). The samurai ship hangs over the street, as
   * the aliens' does, so nothing.
   * @returns {{x: number, z: number, radius: number}[]}
   */
  function landedSpots() {
    return [];
  }

  return {
    initSpaceship, updateSpaceship, updateSupportWorld, placeCamera, isLanding,
    callSamurai: api.callSamurai, fireRocket: api.fireRocket, targeting: api.targeting,
    samuraiTargets: api.aimTargets, hitSamurai: api.hitSamurai, hitSamuraiArea: api.hitSamuraiArea,
    samuraiPositions: api.squadPositions,
    landedSpots, resetSpaceship, disposeSpaceship
  };
}
