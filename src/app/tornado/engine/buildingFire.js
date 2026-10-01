// @ts-check
import * as THREE from 'three';
import { createFireTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';

/**
 * ===========================================================================
 * SECTION F.3 — Structure fires and their spread
 * ===========================================================================
 * Fire that lives on a building rather than on the ground. groundFire.js
 * already burns patches of turf under a Firenado, but those are tied to the
 * funnel: they only light where it touches down and go out a few seconds
 * after it moves on. This is the other kind -- a building alight, burning on
 * its own schedule long after the tornado has gone past, spreading to what it
 * stands next to, and eventually bringing itself down.
 *
 * The spread is deliberately the same shape as damage.js's chain collapse: a
 * burning building periodically rolls against each neighbour within reach,
 * with the chance falling off over distance. The two mechanics then feed each
 * other -- a fire collapses a building, the collapse shocks its neighbours
 * into collapsing, and the rubble of those is still standing close enough to
 * catch. One fuel station going up can walk a blaze down a street.
 *
 * Cost is bounded the same way the rest of the effects are: one shared
 * particle pool (one draw call) for every flame in town however many
 * buildings are alight, a fixed handful of point lights that follow the
 * fiercest fires, and a spread roll that runs a few times a second per fire
 * rather than per frame. Lights are created once at start-up and never added
 * or removed, because changing the scene's light count makes three.js
 * recompile every lit material on the spot.
 */

const FIRE = {
  // Seconds for a fresh fire to reach full burn.
  rampTime: 4,
  // Seconds at full burn before the structure gives up and collapses. Long
  // enough to watch it spread first.
  collapseTime: 22,
  // Seconds a fire keeps burning on the rubble after the collapse, before
  // fading out. Rubble still burning is what lets a fire cross a street that
  // the original building was too far from.
  rubbleBurn: 18,
  fadeOut: 5,
  // Spread. Reach is measured centre to centre like the collapse shock, and
  // sized against the same town grid: next door is 18-26 units away, the far
  // side of the street 32+.
  reach: 26,
  // Seconds between spread rolls for one fire.
  rollInterval: 1.4,
  // A fire has to have been burning this long before it can pass itself on.
  // This is the main thing stopping a blaze going off like a chain reaction:
  // a building that has only just caught cannot immediately light the next
  // one, so the front advances at a visible pace instead of doubling.
  // Shortened from 6: the pacing fix that introduced this was right in
  // shape but left the town too dry, and more fire was explicitly wanted.
  spreadDelay: 4,
  // Probability per roll of lighting the one neighbour it rolls against.
  //
  // The shape here matters more than the number, and it was wrong first time
  // round. Rolling against *every* eligible neighbour each interval makes
  // spread exponential no matter how small the chance -- each fire lit two or
  // three more, and a measured run went 1 -> 32 of 36 buildings in about
  // seven seconds at the default preset, with lowering the chance only
  // delaying the same explosion. One roll against the nearest unburned
  // neighbour instead makes the front advance one building at a time, which
  // is both what fire does and the thing actually worth watching.
  spreadChance: 0.45,
  // Wind carries fire. The tornado's own wind speed scales the roll, so an
  // EF5 spreads a blaze appreciably faster than a calm day.
  windBoost: 0.6,
  // Flames.
  maxFlames: 420,
  flameRate: 26,          // per second per fire at full burn
  flameLife: [0.5, 1.1],
  flameRise: [3.0, 6.0],
  flameSize: 3.4,
  // Flames spawn across the footprint and up the walls, so a tall block burns
  // up its height rather than only at its feet.
  spawnHeightFraction: 0.85,
  // Smoke.
  maxSmoke: 260,
  smokeRate: 9,
  smokeLife: [2.2, 4.0],
  smokeRise: [2.2, 4.0],
  smokeSize: 7,
  lights: 4,
  lightColour: 0xff8a34,
  lightPeak: 90,
  lightDistance: 26,
  lightDecay: 2,
  hot: new THREE.Color(1.0, 0.85, 0.42),
  ember: new THREE.Color(0.72, 0.18, 0.05),
  smoke: new THREE.Color(0.12, 0.11, 0.10),
  // Score for setting a building alight, and for one the fire finishes off.
  igniteScore: 35,
  burnedDownScore: 80
};

/**
 * @typedef {Object} Fire
 * @property {SimObject} building
 * @property {number} age seconds since ignition
 * @property {number} level 0..1 current burn
 * @property {number} rollTimer seconds until the next spread roll
 * @property {number} rubbleTimer seconds of burning left once collapsed
 * @property {boolean} collapsed whether the fire has already brought it down
 * @property {number} seed per-fire random, for its flicker
 * @property {number} accumulator flames owed to its emitter
 * @property {number} smokeAccumulator
 * @property {number} flicker
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initBuildingFire: () => void,
 *   updateBuildingFire: (dt: number) => void,
 *   igniteBuilding: (building: SimObject, level?: number) => boolean,
 *   igniteNear: (x: number, z: number, radius: number) => number,
 *   douse: (x: number, z: number, radius: number) => number,
 *   isBurning: (building: SimObject) => boolean,
 *   burningCount: () => number,
 *   burning: () => SimObject[],
 *   resetBuildingFire: () => void,
 *   disposeBuildingFire: () => void
 * }}
 */
export function createBuildingFireSystem(ctx) {
  const { Sim } = ctx;

  /** @type {Fire[]} */
  let fires = [];
  /** @type {SimObject[]} the list burning() hands out, reused every call */
  const burningList = [];
  /** @type {THREE.Object3D[]} */
  const lights = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let flames = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let smoke = null;
  let time = 0;
  const scratch = new THREE.Color();

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initBuildingFire() {
    const scene = Sim.three.scene;
    flames = createParticlePool(scene, FIRE.maxFlames, createFireTexture(), THREE.AdditiveBlending, 'buildingFire_flames');
    // Normal blending, unlike the flames: smoke darkens the sky behind it
    // rather than adding to it, which is what separates the two visually.
    smoke = createParticlePool(scene, FIRE.maxSmoke, createFireTexture(), THREE.NormalBlending, 'buildingFire_smoke');
    for (let i = 0; i < FIRE.lights; i++) {
      const light = ctx.systems.lightPool.createLight(FIRE.lightColour, 0, FIRE.lightDistance, FIRE.lightDecay);
      light.name = `buildingFire_light_${i}`;
      scene.add(light);
      lights.push(light);
    }
  }

  /**
   * @param {SimObject} building
   * @returns {boolean}
   */
  function isBurning(building) {
    return fires.some(f => f.building === building);
  }

  /** @returns {number} */
  function burningCount() {
    return fires.length;
  }

  /**
   * The buildings currently alight. Read by the fire brigade
   * (engine/emergency/index.js), which needs to know *which* ones rather than
   * how many so it can send an engine to the nearest.
   *
   * Rebuilt in place rather than returned fresh: it is scanned once per idle
   * unit per frame, and a new array each time would be five a frame for
   * nothing.
   * @returns {SimObject[]}
   */
  function burning() {
    burningList.length = 0;
    for (const fire of fires) {
      // A fire in the rubble of something already collapsed is not a call:
      // there is no building left to save.
      if (!fire.collapsed) burningList.push(fire.building);
    }
    return burningList;
  }

  /**
   * Sets a building alight. Storm shelters do not burn (they are the one
   * thing in town built to survive the storm, and people are inside them);
   * neither does anything already alight or already burned out.
   * @param {SimObject} building
   * @param {number} [level] initial burn, 0..1 -- an explosion starts hotter
   *   than a spark landing on a roof
   * @returns {boolean} whether it caught
   */
  function igniteBuilding(building, level = 0) {
    if (!building || building.shelter || building.burnedOut) return false;
    if (!building.mesh || !building.mesh.parent) return false;
    if (isBurning(building)) return false;
    fires.push({
      building,
      age: level * FIRE.rampTime,
      level,
      rollTimer: Math.random() * FIRE.rollInterval,
      rubbleTimer: FIRE.rubbleBurn,
      collapsed: building.damageState === 'collapsed',
      seed: Math.random(),
      accumulator: 0,
      smokeAccumulator: 0,
      flicker: 1
    });
    ctx.systems.gamefeel.event('fire', building.mesh.position);
    ctx.systems.damage.addDamageScore(FIRE.igniteScore);
    return true;
  }

  /**
   * Sets alight every building whose centre falls within `radius` of a point.
   * The entry point for everything that starts a fire from outside this
   * module: a fuel station detonating, a power line arcing down (see
   * environment/powerLines.js), the Firenado dragging itself over a street.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {number} how many caught
   */
  function igniteNear(x, z, radius) {
    let lit = 0;
    for (const building of ctx.Environment.buildings) {
      const p = building.mesh.position;
      if (Math.hypot(p.x - x, p.z - z) > radius) continue;
      if (igniteBuilding(building)) lit++;
    }
    return lit;
  }

  /**
   * Puts out every fire inside a radius. The one route in the whole
   * simulation that *undoes* damage, and the only caller is the flood front
   * passing over a burning building (engine/collisions.js).
   *
   * A building that has been doused is not marked `burnedOut`: it is wet, not
   * finished, and it can be set alight again once the water has gone past.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {number} how many were put out
   */
  function douse(x, z, radius) {
    let out = 0;
    for (let i = fires.length - 1; i >= 0; i--) {
      const fire = fires[i];
      const p = fire.building.mesh.position;
      if (Math.hypot(p.x - x, p.z - z) > radius) continue;
      fires.splice(i, 1);
      out++;
    }
    return out;
  }

  /**
   * One spread roll for a fire: a single chance to light the *nearest*
   * unburned building within reach, scaled by how fiercely this one is
   * burning, how far away that neighbour is, and how hard the wind blows.
   *
   * Deliberately one candidate rather than all of them -- see the note on
   * FIRE.spreadChance. Taking the nearest also means the front follows the
   * street it is on, because that is where the closest unburned building is.
   * @param {Fire} fire
   * @returns {void}
   */
  function rollSpread(fire) {
    if (fire.age < FIRE.spreadDelay) return;
    const origin = fire.building.mesh.position;

    /** @type {SimObject|null} */
    let nearest = null;
    let nearestDist = FIRE.reach;
    for (const other of ctx.Environment.buildings) {
      if (other === fire.building || other.shelter || other.burnedOut) continue;
      if (isBurning(other)) continue;
      const p = other.mesh.position;
      const d = Math.hypot(p.x - origin.x, p.z - origin.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = other;
      }
    }
    if (!nearest) return;

    const wind = THREE.MathUtils.clamp(Sim.params.windSpeed / 320, 0, 1);
    const falloff = 1 - (nearestDist / FIRE.reach) * (nearestDist / FIRE.reach);
    const chance = FIRE.spreadChance * fire.level * (1 + wind * FIRE.windBoost) * falloff;
    if (Math.random() < chance) igniteBuilding(nearest);
  }

  /**
   * One flame licking up a burning building. Spawn points are spread across
   * the footprint and up the walls, so the shape of the fire is the shape of
   * the building.
   * @param {Fire} fire
   * @param {import('./particlePool.js').ParticlePool} pool
   * @param {boolean} isSmoke
   * @returns {void}
   */
  function spawnParticle(fire, pool, isSmoke) {
    const max = isSmoke ? FIRE.maxSmoke : FIRE.maxFlames;
    const i = pool.next;
    pool.next = (pool.next + 1) % max;
    const root = fire.building.mesh;
    const fp = root.userData.footprint;
    const height = (root.userData.wallHeight || 4) * FIRE.spawnHeightFraction;
    // Rubble burns low and flat; a standing building burns up its full height.
    const top = fire.collapsed ? 1.2 : height;
    pool.positions[i * 3] = root.position.x + (Math.random() - 0.5) * fp.width;
    pool.positions[i * 3 + 1] = 0.4 + Math.random() * top;
    pool.positions[i * 3 + 2] = root.position.z + (Math.random() - 0.5) * fp.depth;
    pool.velocities[i * 3] = (Math.random() - 0.5) * 1.4;
    pool.velocities[i * 3 + 1] = between(isSmoke ? FIRE.smokeRise : FIRE.flameRise);
    pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    pool.life[i] = pool.maxLife[i] = between(isSmoke ? FIRE.smokeLife : FIRE.flameLife);
    pool.seed[i] = fire.level;
  }

  /**
   * Ages every fire: ramps it up, spreads it, collapses the building once it
   * has burned long enough, then burns down on the rubble and goes out.
   * @param {number} dt
   * @returns {void}
   */
  function updateFires(dt) {
    for (let i = fires.length - 1; i >= 0; i--) {
      const fire = fires[i];
      const building = fire.building;

      // The town can be regenerated out from under a fire (resetEnvironment).
      if (!building.mesh || !building.mesh.parent) {
        fires.splice(i, 1);
        continue;
      }

      fire.age += dt;
      const ramp = Math.min(1, fire.age / FIRE.rampTime);

      if (fire.collapsed) {
        fire.rubbleTimer -= dt;
        if (fire.rubbleTimer <= 0) {
          building.burnedOut = true;
          fires.splice(i, 1);
          continue;
        }
        fire.level = ramp * Math.min(1, fire.rubbleTimer / FIRE.fadeOut);
      } else {
        fire.level = ramp;
        // Burned through: the structure gives up. Depth 0 -- the fire did
        // this, so it seeds a fresh collapse chain rather than continuing one.
        if (fire.age >= FIRE.collapseTime) {
          fire.collapsed = true;
          fire.rubbleTimer = FIRE.rubbleBurn;
          // Before collapseBuilding, which fires its own 'collapse' event:
          // burning out is the heavier moment of the two and should be the
          // one that sets the shake's size.
          ctx.systems.gamefeel.event('burnDown', building.mesh.position);
          ctx.systems.damage.collapseBuilding(building, 0);
          ctx.systems.damage.addDamageScore(FIRE.burnedDownScore);
          Sim.stats.buildingsBurned++;
        } else if (building.damageState === 'collapsed') {
          // Something else brought it down first (the wind, a domino, flying
          // debris) -- the fire carries on in the rubble either way.
          fire.collapsed = true;
          fire.rubbleTimer = FIRE.rubbleBurn;
        }
      }

      fire.rollTimer -= dt;
      if (fire.rollTimer <= 0) {
        fire.rollTimer = FIRE.rollInterval;
        rollSpread(fire);
      }

      const phase = fire.seed * 40;
      fire.flicker = 0.74 + 0.13 * Math.sin(time * 17 + phase) + 0.08 * Math.sin(time * 29 + phase * 1.7)
        + 0.05 * Math.random();

      fire.accumulator += FIRE.flameRate * fire.level * dt;
      while (fire.accumulator >= 1) {
        fire.accumulator -= 1;
        spawnParticle(fire, flames, false);
      }
      fire.smokeAccumulator += FIRE.smokeRate * fire.level * dt;
      while (fire.smokeAccumulator >= 1) {
        fire.smokeAccumulator -= 1;
        spawnParticle(fire, smoke, true);
      }
    }
  }

  /**
   * Hands the light pool to the fiercest fires nearest the camera -- a fire
   * across town lighting its own street is not worth a light the player
   * cannot see the effect of.
   * @returns {void}
   */
  function updateLights() {
    const camPos = Sim.three.camera.position;
    const ranked = fires.slice().sort((a, b) => {
      const da = camPos.distanceToSquared(a.building.mesh.position);
      const db = camPos.distanceToSquared(b.building.mesh.position);
      return (b.level / (1 + db * 0.002)) - (a.level / (1 + da * 0.002));
    });
    for (let i = 0; i < lights.length; i++) {
      const fire = ranked[i];
      if (!fire) {
        lights[i].intensity = 0;
        continue;
      }
      const p = fire.building.mesh.position;
      lights[i].intensity = FIRE.lightPeak * fire.level * fire.flicker;
      lights[i].position.set(p.x, 3 + (fire.collapsed ? 0 : 2), p.z);
    }
  }

  /**
   * Rises, shrinks and cools the flame particles; smoke rises, swells and
   * thins instead.
   * @param {number} dt
   * @param {import('./particlePool.js').ParticlePool} pool
   * @param {number} max
   * @param {boolean} isSmoke
   * @returns {number} how many are still alive
   */
  function updateParticles(dt, pool, max, isSmoke) {
    let alive = 0;
    for (let i = 0; i < max; i++) {
      if (pool.life[i] <= 0) continue;
      pool.life[i] -= dt;
      if (pool.life[i] <= 0) {
        pool.colours[i * 4 + 3] = 0;
        pool.sizes[i] = 0;
        continue;
      }
      alive++;
      for (let k = 0; k < 3; k++) pool.positions[i * 3 + k] += pool.velocities[i * 3 + k] * dt;
      const u = 1 - pool.life[i] / pool.maxLife[i];
      if (isSmoke) {
        pool.colours[i * 4] = FIRE.smoke.r;
        pool.colours[i * 4 + 1] = FIRE.smoke.g;
        pool.colours[i * 4 + 2] = FIRE.smoke.b;
        pool.colours[i * 4 + 3] = Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.5 * pool.seed[i];
        pool.sizes[i] = FIRE.smokeSize * (0.5 + u * 1.3);
      } else {
        const c = scratch.copy(FIRE.hot).lerp(FIRE.ember, u);
        pool.colours[i * 4] = c.r;
        pool.colours[i * 4 + 1] = c.g;
        pool.colours[i * 4 + 2] = c.b;
        pool.colours[i * 4 + 3] = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6) * 0.92 * pool.seed[i];
        pool.sizes[i] = FIRE.flameSize * (1 - 0.6 * u);
      }
    }
    return alive;
  }

  /**
   * Per frame (not while paused).
   * @param {number} dt
   * @returns {void}
   */
  function updateBuildingFire(dt) {
    if (!flames) return;
    time += dt;
    updateFires(dt);
    updateLights();
    const flamesAlive = updateParticles(dt, flames, FIRE.maxFlames, false);
    const smokeAlive = updateParticles(dt, smoke, FIRE.maxSmoke, true);
    if (fires.length || flamesAlive || smokeAlive) {
      markPoolDirty(flames);
      markPoolDirty(smoke);
      const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
      flames.points.material.uniforms.uScale.value = scale;
      smoke.points.material.uniforms.uScale.value = scale;
    }
  }

  /** @returns {void} */
  function resetBuildingFire() {
    for (const fire of fires) fire.building.burnedOut = false;
    fires = [];
    for (const light of lights) light.intensity = 0;
    for (const pool of [flames, smoke]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      markPoolDirty(pool);
    }
    time = 0;
  }

  /** @returns {void} */
  function disposeBuildingFire() {
    const scene = Sim.three.scene;
    if (flames) disposeParticlePool(scene, flames);
    if (smoke) disposeParticlePool(scene, smoke);
    for (const light of lights) scene.remove(light);
    lights.length = 0;
    fires = [];
    flames = null;
    smoke = null;
  }

  return {
    initBuildingFire, updateBuildingFire, igniteBuilding, igniteNear, douse,
    isBurning, burningCount, burning, resetBuildingFire, disposeBuildingFire
  };
}
