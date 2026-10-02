// @ts-check
import * as THREE from 'three';
import { createFireTexture, createGroundScarTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION Z — Lavanado
 * ===========================================================================
 * The funnel walks over molten ground and starts throwing it.
 *
 * Structurally this is the Firenado's trick (engine/firenado.js) sourced from
 * below instead of from a fuel station: a load of material is picked up, it
 * rides up the funnel as a swirling column, the shell glows through the same
 * `Vortex.fire` channel the Firenado uses, and the tornado hands out a kind
 * of damage it could not do on its own. The differences are the ones that
 * matter:
 *
 *  - it is **fed**, not triggered. Standing over lava loads the funnel; the
 *    load drains as it throws. Leave the molten ground and it runs itself out
 *    and stops, walk back on and it picks up again. There is no duration and
 *    no once-per-run: the eruption lasts exactly as long as the tornado keeps
 *    finding lava.
 *  - what goes up **comes down somewhere else**. The Firenado's flames die at
 *    the top of the funnel; these are flung off it on a ballistic arc and land
 *    across the town, which is the whole point -- the funnel becomes a
 *    delivery mechanism for the earthquake. Where a gob lands it sets fire to
 *    what is there and can open a gas main (engine/gasMains.js), so a
 *    lavanado crossing a street starts a fire that then runs down it.
 *
 * The lava it feeds on is the earthquake's (engine/fissure.js): the vents
 * along its fissures, and above all the lake of lava in the caldera at the
 * epicentre, which is much the widest and hottest molten ground on the map.
 * A funnel that clips a vent picks up a little and throws it for a few
 * seconds; one that walks across the caldera fills right up.
 */

const LAVA = {
  // Seconds of throwing that a full load buys. The funnel carries a load,
  // not a timer: this is its capacity.
  fuelMax: 11,
  // Seconds of load gained per second spent over fully molten ground. Above
  // 1 so crossing a vent field is a net gain and a long pass over the
  // epicentre fills the funnel, while clipping the edge of one barely does.
  loadRate: 2.6,
  // How much load it takes to be throwing at full rate. Below fuelMax, so a
  // topped-up funnel throws flat out rather than ramping the whole way down.
  rampFuel: 4.5,
  ramp: 2.2,                 // how fast strength chases the load, per second
  minLava: 0.12,             // vent glow below this is not hot enough to lift
  reach: 1.35,               // of the funnel's ground radius, for the pickup test
  damageScore: 30,           // per gob that lands
  // The column riding the funnel. Far fewer and far bigger than the
  // Firenado's flames: this is rock, and it should read as lumps going up,
  // not as a sheet of fire.
  columnMax: 460,
  columnRate: 165,
  columnLife: [1.4, 2.4],
  columnRise: [11, 19],
  columnSwirl: [2.0, 3.6],
  columnFraction: [0.1, 0.85],
  columnBias: 1.3,
  columnSize: 4.6,
  // The fallout. Thrown off the top of the funnel, out and down.
  falloutMax: 260,
  falloutRate: 9,            // per second at full strength
  falloutHeight: [0.55, 0.95], // of the funnel height, where it leaves
  falloutOut: [16, 46],      // outward speed on release
  falloutUp: [4, 16],
  gravity: 26,
  falloutSize: 5.2,
  falloutTrailEvery: 0.09,   // seconds between trail blobs shed in flight
  igniteRadius: 8,
  rupturePipes: 5.5,         // radius in which a landing gob opens a main
  burstChance: 0.22,         // gobs that land with a visible fireball
  scarEvery: 5,              // one landing in this many leaves a burn on the ground
  scarMax: 40,
  scarSize: [7, 13],
  scarY: 0.03,
  // Molten rock, not flame: a narrow ramp from white-hot through orange into
  // a dull red crust, and the crust is where most of a gob's life is spent.
  white: new THREE.Color(3.4, 1.9, 0.6),
  orange: new THREE.Color(1.5, 0.45, 0.08),
  crust: new THREE.Color(0.22, 0.05, 0.02),
  lightColour: 0xff5a1e,
  lightPeak: 460,
  lightDistance: 100,
  lightDecay: 1.7,
  lightHeight: 6,
  bannerSeconds: 3.2
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initLavanado: () => void,
 *   updateLavanado: (dt: number) => void,
 *   erupting: () => boolean,
 *   contactAt: (x: number, z: number) => boolean,
 *   resetLavanado: () => void,
 *   disposeLavanado: () => void
 * }}
 */
export function createLavanadoSystem(ctx) {
  const { Sim, Vortex } = ctx;

  const state = {
    fuel: 0,
    strength: 0,
    time: 0,
    announced: false,
    bannerTimer: 0,
    falloutAccumulator: 0,
    landings: 0
  };
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let column = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let fallout = null;
  /** @type {THREE.Object3D|null} */
  let light = null;
  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {THREE.Mesh[]} */
  const scars = [];
  let nextScar = 0;
  /** @type {THREE.Texture|null} */
  let scarTexture = null;
  /** @type {THREE.Material|null} */
  let scarMaterial = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const scratch = new THREE.Color();
  let columnAlive = 0;
  let falloutAlive = 0;

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initLavanado() {
    const scene = Sim.three.scene;
    group = new THREE.Group();
    group.name = 'lavanado';
    scene.add(group);

    column = createParticlePool(
      scene, LAVA.columnMax, createFireTexture(), THREE.AdditiveBlending, 'lavanado_column'
    );
    fallout = createParticlePool(
      scene, LAVA.falloutMax, createFireTexture(), THREE.AdditiveBlending, 'lavanado_fallout'
    );

    // Created once at zero intensity and never removed: adding or removing a
    // light changes the scene's light count, which makes three.js recompile
    // every lit material on the spot (the same reason firenado.js does this).
    light = ctx.systems.lightPool.createLight(LAVA.lightColour, 0, LAVA.lightDistance, LAVA.lightDecay);
    light.name = 'lavanado_light';
    scene.add(light);

    // Burn marks where the gobs land. One geometry and one material between
    // all of them, recycled oldest-first, so the record of where the fallout
    // fell costs a fixed amount however long the eruption runs.
    scarTexture = createGroundScarTexture();
    scarMaterial = new THREE.MeshBasicMaterial({
      map: scarTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.8
    });
    const scarGeometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < LAVA.scarMax; i++) {
      const mesh = new THREE.Mesh(scarGeometry, scarMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LAVA.scarY;
      mesh.visible = false;
      mesh.name = 'lavanado_scar';
      group.add(mesh);
      scars.push(mesh);
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'lava-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
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
    state.bannerTimer = LAVA.bannerSeconds;
  }

  /** @returns {boolean} */
  function erupting() {
    return state.strength > 0.05;
  }

  /**
   * Whether a point stands in the erupting funnel's footprint, the same
   * reach the funnel uses to pick lava up (health: lava contact, Subtask 11).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function contactAt(x, z) {
    if (!erupting()) return false;
    const ground = ctx.systems.vortex.funnelRadiusAt(0) * Vortex.group.scale.x * LAVA.reach;
    const dx = x - Vortex.center.x;
    const dz = z - Vortex.center.z;
    return dx * dx + dz * dz <= ground * ground;
  }

  /**
   * How molten the ground under the funnel is, 0..1. The earthquake's vents
   * and calderas are the only molten ground there is, so this is a scan of
   * them against the funnel's own footprint.
   * @returns {number}
   */
  function lavaUnderFunnel() {
    const fissures = ctx.systems.fissures;
    if (!fissures || !fissures.hotSpots) return 0;
    const spots = fissures.hotSpots();
    if (!spots.length) return 0;
    const ground = ctx.systems.vortex.funnelRadiusAt(0) * Vortex.group.scale.x * LAVA.reach;
    let hottest = 0;
    for (const spot of spots) {
      if (spot.level <= LAVA.minLava) continue;
      const d = Math.hypot(spot.x - Vortex.center.x, spot.z - Vortex.center.z);
      if (d > ground + spot.radius) continue;
      // Ground the funnel is centred on counts for all of its glow; ground it
      // is only clipping counts for less, so the load ramps as it walks on.
      const overlap = 1 - THREE.MathUtils.clamp(
        (d - spot.radius) / Math.max(1, ground), 0, 1
      );
      hottest = Math.max(hottest, spot.level * overlap);
    }
    return Math.min(1, hottest);
  }

  /**
   * One lump of molten rock started low in the funnel. The funnel-relative
   * state (angle, radial fraction, rise speed) lives in `velocities` and the
   * height in `positions.y`, exactly as the Firenado's flames do.
   * @param {number} i pool slot
   * @returns {void}
   */
  function spawnColumn(i) {
    const p = column;
    p.life[i] = p.maxLife[i] = between(LAVA.columnLife);
    p.seed[i] = Math.random();
    p.velocities[i * 3] = Math.random() * Math.PI * 2;
    p.velocities[i * 3 + 1] = LAVA.columnFraction[0]
      + Math.pow(Math.random(), LAVA.columnBias) * (LAVA.columnFraction[1] - LAVA.columnFraction[0]);
    p.velocities[i * 3 + 2] = between(LAVA.columnRise);
    p.positions[i * 3 + 1] = Math.random() * 4;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateColumn(dt) {
    const p = column;
    if (state.strength > 0) {
      p.accumulator += LAVA.columnRate * state.strength * dt;
      while (p.accumulator >= 1) {
        p.accumulator -= 1;
        spawnColumn(p.next);
        p.next = (p.next + 1) % LAVA.columnMax;
      }
    }
    const scaleX = Vortex.group.scale.x;
    const cx = Vortex.center.x;
    const cz = Vortex.center.z;
    const radiusAt = ctx.systems.vortex.funnelRadiusAt;
    const topOut = Vortex.height * 0.97;
    columnAlive = 0;
    for (let i = 0; i < LAVA.columnMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      const h = p.positions[i * 3 + 1] + p.velocities[i * 3 + 2] * dt;
      if (p.life[i] <= 0 || h > topOut) {
        p.life[i] = 0;
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      columnAlive++;
      const seed = p.seed[i];
      const angle = p.velocities[i * 3]
        + (LAVA.columnSwirl[0] + seed * (LAVA.columnSwirl[1] - LAVA.columnSwirl[0])) * dt;
      p.velocities[i * 3] = angle;
      const r = p.velocities[i * 3 + 1] * radiusAt(h) * scaleX;
      p.positions[i * 3] = cx + Math.cos(angle) * r;
      p.positions[i * 3 + 1] = h;
      p.positions[i * 3 + 2] = cz + Math.sin(angle) * r;

      // White-hot for the first moment out of the ground, then orange, then
      // a crust that keeps most of its life -- the reverse weighting of a
      // flame, which is brightest in the middle of its life.
      const u = 1 - p.life[i] / p.maxLife[i];
      const c = u < 0.22
        ? scratch.copy(LAVA.white).lerp(LAVA.orange, u / 0.22)
        : scratch.copy(LAVA.orange).lerp(LAVA.crust, (u - 0.22) / 0.78);
      p.colours[i * 4] = c.r;
      p.colours[i * 4 + 1] = c.g;
      p.colours[i * 4 + 2] = c.b;
      p.colours[i * 4 + 3] = (0.35 + 0.65 * (1 - u)) * (0.4 + 0.6 * state.strength);
      p.sizes[i] = LAVA.columnSize * (0.6 + 0.8 * seed) * (1 - 0.35 * u);
    }
  }

  /**
   * One gob flung off the funnel. Unlike the column these are in world space
   * under gravity, and `velocities` really is a velocity.
   * @returns {void}
   */
  function spawnFallout() {
    const p = fallout;
    const i = p.next;
    p.next = (p.next + 1) % LAVA.falloutMax;
    const h = Vortex.height * between(LAVA.falloutHeight);
    const angle = Math.random() * Math.PI * 2;
    const r = ctx.systems.vortex.funnelRadiusAt(h) * Vortex.group.scale.x;
    p.positions[i * 3] = Vortex.center.x + Math.cos(angle) * r;
    p.positions[i * 3 + 1] = h;
    p.positions[i * 3 + 2] = Vortex.center.z + Math.sin(angle) * r;
    const out = between(LAVA.falloutOut);
    p.velocities[i * 3] = Math.cos(angle) * out;
    p.velocities[i * 3 + 1] = between(LAVA.falloutUp);
    p.velocities[i * 3 + 2] = Math.sin(angle) * out;
    p.life[i] = p.maxLife[i] = 20;   // it lives until it lands
    p.seed[i] = Math.random();
  }

  /**
   * Where a gob comes down. Goes out through the routes the rest of the
   * simulation already has, so the fallout is a real hazard rather than a
   * decal: it lights what it lands on, and a street it lands in can take the
   * main under it with it.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function land(x, z) {
    state.landings++;
    ctx.systems.buildingFire.igniteNear(x, z, LAVA.igniteRadius);
    if (ctx.systems.gasMains) {
      ctx.systems.gasMains.ruptureAt(x, z, LAVA.rupturePipes, { ignite: true });
    }
    ctx.systems.damage.addDamageScore(LAVA.damageScore);
    if (Math.random() < LAVA.burstChance) {
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(x, 1, z), 0.7);
    }
    if (state.landings % LAVA.scarEvery === 0) {
      const mesh = scars[nextScar];
      nextScar = (nextScar + 1) % LAVA.scarMax;
      const size = between(LAVA.scarSize);
      mesh.position.set(x, LAVA.scarY, z);
      mesh.scale.set(size, size, 1);
      mesh.rotation.z = Math.random() * Math.PI * 2;
      mesh.visible = true;
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateFallout(dt) {
    const p = fallout;
    if (state.strength > 0) {
      state.falloutAccumulator += LAVA.falloutRate * state.strength * dt;
      while (state.falloutAccumulator >= 1) {
        state.falloutAccumulator -= 1;
        spawnFallout();
      }
    }
    falloutAlive = 0;
    for (let i = 0; i < LAVA.falloutMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      p.velocities[i * 3 + 1] -= LAVA.gravity * dt;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      if (p.positions[i * 3 + 1] <= 0.4 || p.life[i] <= 0) {
        if (p.positions[i * 3 + 1] <= 0.4) land(p.positions[i * 3], p.positions[i * 3 + 2]);
        p.life[i] = 0;
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      falloutAlive++;
      // A gob crusts over as it flies, so what lands is dark with a hot core
      // rather than a bright dot -- and it is visibly cooling on the way,
      // which is what makes the arc readable against the sky.
      const flightAge = THREE.MathUtils.clamp((20 - p.life[i]) / 1.6, 0, 1);
      const c = scratch.copy(LAVA.white).lerp(LAVA.orange, Math.min(1, flightAge * 2.2));
      p.colours[i * 4] = c.r;
      p.colours[i * 4 + 1] = c.g;
      p.colours[i * 4 + 2] = c.b;
      p.colours[i * 4 + 3] = 1;
      p.sizes[i] = LAVA.falloutSize * (0.65 + 0.7 * p.seed[i]);
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateLavanado(dt) {
    if (!column) return;
    state.time += dt;
    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }

    // Load and drain. Only a running storm can pick anything up -- the funnel
    // has to be turning to lift rock -- but a load already carried keeps
    // being thrown until it is gone.
    if (Sim.state.running) {
      const molten = lavaUnderFunnel();
      if (molten > 0) state.fuel = Math.min(LAVA.fuelMax, state.fuel + LAVA.loadRate * molten * dt);
    }
    state.fuel = Math.max(0, state.fuel - dt);

    const target = Math.min(1, state.fuel / LAVA.rampFuel);
    state.strength += THREE.MathUtils.clamp(
      target - state.strength, -LAVA.ramp * dt, LAVA.ramp * dt
    );
    if (state.strength < 0.001) state.strength = 0;

    if (!state.announced && state.strength > 0.25) {
      state.announced = true;
      showBanner('LAVANADO!', 'The funnel is throwing molten rock');
    } else if (state.announced && state.strength === 0) {
      state.announced = false;
      showBanner('Lavanado spent', 'The funnel has run out of lava');
    }

    // Layered on top of whatever the Firenado is doing rather than replacing
    // it: both tint the funnel through the same channel, and a tornado that
    // is on fire *and* full of lava should be as hot as the hotter of the
    // two, not whichever system happened to write last.
    if (state.strength > 0) {
      const flicker = 0.8 + 0.12 * Math.sin(state.time * 19) + 0.08 * Math.sin(state.time * 31 + 0.7);
      Vortex.fire = Math.max(Vortex.fire, state.strength * flicker);
      light.intensity = LAVA.lightPeak * state.strength * flicker;
      light.position.set(Vortex.center.x, LAVA.lightHeight, Vortex.center.z);
    } else if (light.intensity !== 0) {
      light.intensity = 0;
    }

    if (state.strength > 0 || columnAlive > 0) {
      updateColumn(dt);
      markPoolDirty(column);
    }
    if (state.strength > 0 || falloutAlive > 0) {
      updateFallout(dt);
      markPoolDirty(fallout);
    }
    if (state.strength > 0 || columnAlive > 0 || falloutAlive > 0) {
      const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
      column.points.material.uniforms.uScale.value = scale;
      fallout.points.material.uniforms.uScale.value = scale;
    }
  }

  /** @returns {void} */
  function resetLavanado() {
    state.fuel = 0;
    state.strength = 0;
    state.announced = false;
    state.bannerTimer = 0;
    state.falloutAccumulator = 0;
    state.landings = 0;
    for (const pool of [column, fallout]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      markPoolDirty(pool);
    }
    columnAlive = 0;
    falloutAlive = 0;
    for (const mesh of scars) mesh.visible = false;
    nextScar = 0;
    if (light) light.intensity = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeLavanado() {
    if (!group) return;
    if (scars.length) scars[0].geometry.dispose();
    if (scarMaterial) scarMaterial.dispose();
    if (scarTexture) scarTexture.dispose();
    if (column) disposeParticlePool(Sim.three.scene, column);
    if (fallout) disposeParticlePool(Sim.three.scene, fallout);
    if (light) Sim.three.scene.remove(light);
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    Sim.three.scene.remove(group);
    group = null;
    column = null;
    fallout = null;
    light = null;
    banner = null;
    scarMaterial = null;
    scarTexture = null;
    scars.length = 0;
  }

  return { initLavanado, updateLavanado, erupting, contactAt, resetLavanado, disposeLavanado };
}
