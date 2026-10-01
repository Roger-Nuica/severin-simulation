// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture, createShockRingTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION AA — Disaster collisions
 * ===========================================================================
 * What happens where two disasters meet.
 *
 * Every disaster in this scene was built to run on its own: the flood does
 * not care where the funnel is, the earthquake does not care about the fire,
 * the electric storm does not care that half the town is under water. That
 * independence is what makes them composable, and it is also what made them
 * inert next to each other -- eight buttons whose only interaction was that
 * damage added up.
 *
 * This module is the one place that knows about more than one of them at a
 * time. It watches for the pairs below and fires the reaction; each reaction
 * then goes out through the routes the individual systems already publish, so
 * no disaster has to learn what another one is.
 *
 *  - **Lava under water -> steam explosion.** The dam break's front reaches a
 *    vent the earthquake opened, and the biggest single blast in the scene
 *    goes off -- bigger than either disaster does alone, because it is not
 *    either of them. The vent is put out for good: the water won.
 *  - **Arcs into standing water -> the whole corridor is live.** While the
 *    electric funnel is throwing bolts, one that lands in the flood does not
 *    hurt what it hit, it hurts everything standing in the water, out to a
 *    radius the strike itself could never reach.
 *  - **Water over fire -> the fire goes out.** The front passing a burning
 *    building puts it out. This is the one interaction that *costs* the
 *    player something, and it is the only reason the order the buttons are
 *    pressed in has ever mattered.
 *
 * (A meteor no longer breaks the dam: the flood starts only from its own
 * button, or Doomsday.)
 *
 * The Lavanado (engine/lavanado.js) is the fourth of these and lives in its
 * own module, because unlike the three above it is not a moment, it is a state
 * the tornado is in for as long as it keeps finding lava.
 */

const STEAM = {
  // Vents the water can flash. A vent field can have a dozen of them inside
  // the flood corridor, and a dozen of these would be one continuous white
  // screen: after this many the rest simply go out quietly.
  maxPerFlood: 4,
  minLava: 0.15,           // a vent this cool just hisses and dies
  // The blast. Deliberately above anything else in the scene: a meteor is 8
  // and the chemical works is 8, and this should read as worse than both.
  blastRadius: 104,
  throwForce: 86,
  lift: 0.95,              // of throwForce, straight up -- steam goes up
  buildingShock: 8.5,
  fireballs: 9,
  flash: 1,
  // The screen flash is the white of scalding steam rather than lightning's
  // warm white, so it does not read as a bolt landing.
  flashTint: '#eef7fb',
  score: 7200,
  // Steam. Long-lived, huge and white: the plume is the whole effect and it
  // should still be hanging over the crater when the water has gone past.
  max: 940,
  burst: 320,              // particles thrown at once by one blast
  rate: 90,                // per second afterwards, while the vent steams off
  steamSeconds: 5,
  life: [2.6, 6.5],
  rise: [16, 46],
  spread: [6, 30],
  size: 13,
  drag: 0.55,
  colour: new THREE.Color(1.0, 1.0, 1.0),
  cool: new THREE.Color(0.62, 0.68, 0.72),
  // The pressure ring on the ground.
  ringMax: 5,
  ringSeconds: 1.5,
  ringRadius: 108,
  ringColour: 0xdfeef5,
  bannerSeconds: 3.6
};

const LIVE_WATER = {
  // How far the charge carries through the water from where the bolt landed.
  // Much further than the strike's own effect radius: that is the point.
  reach: 78,
  cooldown: 0.55,          // seconds before another bolt can light it up again
  arcs: 7,                 // surface arcs skittering away from the entry point
  arcReach: [18, 62],
  personScore: 90,
  carScore: 40,
  ringColour: 0x9fd8ff,
  ringSeconds: 0.9,
  flash: 0.45,
  flashTint: '#cfeaff',
  bannerSeconds: 3
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initCollisions: () => void,
 *   updateCollisions: (dt: number) => void,
 *   groundDischarge: (at: THREE.Vector3, power?: number) => boolean,
 *   resetCollisions: () => void,
 *   disposeCollisions: () => void
 * }}
 */
export function createCollisionsSystem(ctx) {
  const { Sim } = ctx;

  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let steam = null;
  /** @type {Array<{mesh: THREE.Mesh, age: number, life: number, radius: number}>} */
  const rings = [];
  let nextRing = 0;
  /** @type {THREE.Texture|null} */
  let ringTexture = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;

  const state = {
    // Hot spots the water has already reached, so one never goes twice. A
    // WeakSet rather than a Set because the fissure system throws its whole
    // vent list away and builds a new one whenever the ground re-tears, and
    // this should not be the thing keeping the old ones alive.
    /** @type {WeakSet<Object>} */
    flashed: new WeakSet(),
    blasts: 0,
    /** seconds of residual steam still boiling off the quenched vents */
    steamTimer: 0,
    /** @type {THREE.Vector3|null} where that steam is coming from */
    steamAt: null,
    liveWaterCooldown: 0
  };
  let steamAlive = 0;
  const scratch = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  const scratchColour = new THREE.Color();

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initCollisions() {
    group = new THREE.Group();
    group.name = 'collisions';
    Sim.three.scene.add(group);

    steam = createParticlePool(
      Sim.three.scene, STEAM.max, createSoftDotTexture(), THREE.NormalBlending, 'collision_steam'
    );

    // Ground rings, one per recent blast. Each keeps its own material so a
    // steam ring can be white and an electrified-water ring blue.
    ringTexture = createShockRingTexture();
    const geometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < STEAM.ringMax; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: ringTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.4;
      mesh.visible = false;
      mesh.name = 'collision_ring';
      group.add(mesh);
      rings.push({ mesh, age: 0, life: 0, radius: 0 });
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'steam-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {number} seconds
   * @returns {void}
   */
  function showBanner(title, sub, seconds) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    bannerTimer = seconds;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {number} seconds
   * @param {number} colour
   * @returns {void}
   */
  function spawnRing(x, z, radius, seconds, colour) {
    const ring = rings[nextRing];
    nextRing = (nextRing + 1) % rings.length;
    ring.age = 0;
    ring.life = seconds;
    ring.radius = radius;
    ring.mesh.position.set(x, 0.4, z);
    ring.mesh.visible = true;
    ring.mesh.material.color.set(colour);
    ring.mesh.material.opacity = 0.9;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateRings(dt) {
    for (const ring of rings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      const u = ring.age / ring.life;
      if (u >= 1) {
        ring.mesh.visible = false;
        ring.mesh.material.opacity = 0;
        continue;
      }
      // Out fast then easing, fading as it goes: a pressure front, not an
      // expanding disc.
      const spread = 1 - Math.pow(1 - u, 2.2);
      const size = ring.radius * 2 * spread;
      ring.mesh.scale.set(size, size, 1);
      ring.mesh.material.opacity = 0.9 * (1 - u) * (1 - u);
    }
  }

  // ---------------------------------------------------------------------
  // Lava under water
  // ---------------------------------------------------------------------

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} force how hard this one is thrown, 0..1
   * @returns {void}
   */
  function spawnSteam(x, y, z, force) {
    const p = steam;
    const i = p.next;
    p.next = (p.next + 1) % STEAM.max;
    const angle = Math.random() * Math.PI * 2;
    const out = between(STEAM.spread) * force;
    p.positions[i * 3] = x + Math.cos(angle) * Math.random() * 6;
    p.positions[i * 3 + 1] = y + Math.random() * 4;
    p.positions[i * 3 + 2] = z + Math.sin(angle) * Math.random() * 6;
    p.velocities[i * 3] = Math.cos(angle) * out;
    p.velocities[i * 3 + 1] = between(STEAM.rise) * (0.4 + force * 0.8);
    p.velocities[i * 3 + 2] = Math.sin(angle) * out;
    p.life[i] = p.maxLife[i] = between(STEAM.life);
    p.seed[i] = Math.random();
  }

  /**
   * The set piece: the flood front reaches molten ground -- a vent along one
   * of the earthquake's fissures, or the lava lake in its caldera.
   *
   * Everything here is deliberately bigger than either disaster on its own.
   * The flood knocks buildings over with a shock of 2.4 and a meteor with 7;
   * this is 8.5 over a radius half again as wide as the meteor's, and it is
   * the only thing in the scene that throws what it catches straight up.
   * @param {Object} vent a hot spot from engine/fissure.js
   * @returns {void}
   */
  function steamBlast(vent) {
    const at = new THREE.Vector3(vent.x, 2, vent.z);
    state.blasts++;

    // Fireballs are wrong for steam on their own, but a rock-and-mud column
    // does go up with it, so a few offset bursts sit inside the white.
    ctx.systems.explosions.spawnImpactBurst(at, 5.5);
    for (let i = 0; i < STEAM.fireballs; i++) {
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + (Math.random() - 0.5) * 52,
        at.y + Math.random() * 30,
        at.z + (Math.random() - 0.5) * 52
      ), 2 + Math.random() * 2.5);
    }
    for (let i = 0; i < STEAM.burst; i++) spawnSteam(vent.x, 1, vent.z, 0.5 + Math.random() * 0.5);
    state.steamTimer = STEAM.steamSeconds;
    state.steamAt = at.clone();

    ctx.systems.lightning.flashScreen(at, STEAM.flash, STEAM.flashTint);
    spawnRing(vent.x, vent.z, STEAM.ringRadius, STEAM.ringSeconds, STEAM.ringColour);
    ctx.systems.gamefeel.event('steam', at);

    // Straight up and out. A steam explosion is a volume of water becoming a
    // volume of gas underneath whatever is standing on it.
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.rooted) continue;
      if (obj.captureState && obj.captureState !== 'grounded') continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - vent.x, pos.z - vent.z);
      if (d > STEAM.blastRadius) continue;
      const falloff = 1 - d / STEAM.blastRadius;
      scratch.set(pos.x - vent.x, 0, pos.z - vent.z);
      if (scratch.lengthSq() < 1e-6) scratch.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      scratch.normalize().multiplyScalar(STEAM.throwForce * falloff * 0.6);
      obj.velocity.add(scratch);
      obj.velocity.y += STEAM.throwForce * STEAM.lift * falloff;
      obj.angularVelocity.set(
        (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14
      );
      if (obj.type === 'person' && obj.motion && obj.motion.active) {
        obj.motion.active = false;
        obj.motion.dropped = true;
      }
    }

    const { shockBuilding, addDamageScore } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        const p = building.mesh.position;
        const d = Math.hypot(p.x - vent.x, p.z - vent.z);
        if (d > STEAM.blastRadius) continue;
        shockBuilding(building, STEAM.buildingShock * (1 - d / STEAM.blastRadius), at);
      }
    }
    ctx.systems.powerLines.faultAt(vent.x, vent.z, STEAM.blastRadius * 0.5);
    ctx.systems.viaduct.fissureUnder(vent.x, vent.z, STEAM.blastRadius * 0.35);
    // Blowing the street apart over a main is exactly what opens one.
    if (ctx.systems.gasMains) {
      ctx.systems.gasMains.ruptureAt(vent.x, vent.z, STEAM.blastRadius * 0.45, { ignite: false });
    }
    addDamageScore(STEAM.score);
    showBanner('STEAM EXPLOSION!', 'The flood has found the lava', STEAM.bannerSeconds);
  }

  /**
   * Looks for molten ground the water has just reached. Cheap: a handful of
   * hot spots against one number, and only while a surge is actually running.
   *
   * The caldera's lake is one of these, and it is the one worth waiting for:
   * it is by far the widest and hottest molten ground on the map, so a front
   * that crosses the epicentre gets the biggest of these blasts.
   * @returns {void}
   */
  function checkLavaUnderWater() {
    const flood = ctx.systems.flood;
    const fissures = ctx.systems.fissures;
    if (!flood.isSurging || !flood.isSurging()) return;
    if (!fissures.hotSpots) return;
    for (const spot of fissures.hotSpots()) {
      if (state.flashed.has(spot)) continue;
      if (!flood.inWater(spot.x, spot.z)) continue;
      state.flashed.add(spot);
      // Either way that ground is finished -- the difference is whether it
      // goes out with a bang or a hiss.
      if (spot.level > STEAM.minLava && state.blasts < STEAM.maxPerFlood) steamBlast(spot);
      fissures.quench(spot);
    }
  }

  // ---------------------------------------------------------------------
  // Water over fire
  // ---------------------------------------------------------------------

  /**
   * The front puts out what it passes. Note that it does *not* put out a
   * burning gas main (engine/gasMains.js): the gas is still coming up out of
   * the ground under the water and keeps burning on the surface, which is
   * both true and the better-looking of the two options.
   * @returns {void}
   */
  function douseBehindFront() {
    const flood = ctx.systems.flood;
    if (!flood.isSurging || !flood.isSurging()) return;
    const x = flood.frontX();
    ctx.systems.buildingFire.douse(x, 0, flood.spreadAt(x));
  }

  // ---------------------------------------------------------------------
  // Arcs into standing water
  // ---------------------------------------------------------------------

  /**
   * Called by engine/electricStorm.js every time it puts current into the
   * ground. If that ground happens to be under water, the flooded corridor
   * becomes the conductor and everyone standing in it is in the circuit.
   * @param {THREE.Vector3} at
   * @param {number} [power]
   * @returns {boolean} whether the water was live
   */
  function groundDischarge(at, power = 1) {
    const flood = ctx.systems.flood;
    if (!flood.inWater || !flood.inWater(at.x, at.z)) return false;
    if (state.liveWaterCooldown > 0) return false;
    state.liveWaterCooldown = LIVE_WATER.cooldown;

    const reach = LIVE_WATER.reach * power;
    let people = 0;
    let cars = 0;
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.rooted) continue;
      if (obj.captureState && obj.captureState !== 'grounded') continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      // In the water, not merely near the strike: the charge goes where the
      // water goes, so a person on dry ground ten units away is untouched and
      // one sixty units away in the flood is not.
      if (!flood.inWater(pos.x, pos.z)) continue;
      if (Math.hypot(pos.x - at.x, pos.z - at.z) > reach) continue;
      obj.velocity.y += 4 + Math.random() * 5;
      obj.angularVelocity.x += (Math.random() - 0.5) * 9;
      obj.angularVelocity.z += (Math.random() - 0.5) * 9;
      if (obj.type === 'person') {
        people++;
        if (obj.motion && obj.motion.active) {
          obj.motion.active = false;
          obj.motion.dropped = true;
          ctx.systems.speechBubbles.exclaim(obj);
        }
      } else if (obj.type === 'car') {
        cars++;
        if (obj.damageState === 'intact') obj.mesh.userData.parked = false;
      }
    }

    // Arcs skittering away across the surface. They run flat and they stay on
    // the water, which is what tells the player the water is the conductor.
    const electric = ctx.systems.electricStorm;
    if (electric.surfaceArc) {
      for (let i = 0; i < LIVE_WATER.arcs; i++) {
        const angle = Math.random() * Math.PI * 2;
        const run = between(LIVE_WATER.arcReach) * power;
        scratch.set(at.x, 0.8, at.z);
        scratchB.set(at.x + Math.cos(angle) * run, 0.8, at.z + Math.sin(angle) * run);
        if (!flood.inWater(scratchB.x, scratchB.z)) continue;
        electric.surfaceArc(scratch, scratchB);
      }
    }
    spawnRing(at.x, at.z, reach, LIVE_WATER.ringSeconds, LIVE_WATER.ringColour);
    ctx.systems.lightning.flashScreen(at, LIVE_WATER.flash, LIVE_WATER.flashTint);
    ctx.systems.gamefeel.event('arc', at);
    ctx.systems.damage.addDamageScore(
      people * LIVE_WATER.personScore + cars * LIVE_WATER.carScore
    );
    if (people > 0) {
      showBanner('THE WATER IS LIVE!', `${people} caught in the current`, LIVE_WATER.bannerSeconds);
    }
    return true;
  }

  // ---------------------------------------------------------------------

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSteam(dt) {
    const p = steam;
    let alive = 0;
    for (let i = 0; i < STEAM.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      // Steam slows as it expands and keeps drifting up: drag on all three
      // axes and buoyancy on one.
      const drag = Math.max(0, 1 - STEAM.drag * dt);
      p.velocities[i * 3] *= drag;
      p.velocities[i * 3 + 2] *= drag;
      p.velocities[i * 3 + 1] = p.velocities[i * 3 + 1] * drag + 5 * dt;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      const c = scratchColour.copy(STEAM.colour).lerp(STEAM.cool, u * 0.8);
      p.colours[i * 4] = c.r;
      p.colours[i * 4 + 1] = c.g;
      p.colours[i * 4 + 2] = c.b;
      // Opaque early, thinning out as it expands -- the plume has to hide the
      // town behind it at first or it does not read as steam at all.
      p.colours[i * 4 + 3] = Math.min(1, (1 - u) * 1.4) * 0.72;
      // It only ever grows.
      p.sizes[i] = STEAM.size * (0.5 + p.seed[i] * 0.8) * (0.45 + u * 2.1);
    }
    steamAlive = alive;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateCollisions(dt) {
    if (!group) return;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (state.liveWaterCooldown > 0) state.liveWaterCooldown -= dt;

    checkLavaUnderWater();
    douseBehindFront();

    // The quenched vent keeps boiling off for a few seconds after the blast.
    if (state.steamTimer > 0 && state.steamAt) {
      state.steamTimer -= dt;
      steam.accumulator += STEAM.rate * Math.max(0, state.steamTimer / STEAM.steamSeconds) * dt;
      while (steam.accumulator >= 1) {
        steam.accumulator -= 1;
        spawnSteam(state.steamAt.x, 0.5, state.steamAt.z, 0.25);
      }
    }

    updateRings(dt);
    if (steamAlive > 0 || state.steamTimer > 0) {
      updateSteam(dt);
      markPoolDirty(steam);
      steam.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
  }

  /** @returns {void} */
  function resetCollisions() {
    state.flashed = new WeakSet();
    state.blasts = 0;
    state.steamTimer = 0;
    state.steamAt = null;
    state.liveWaterCooldown = 0;
    if (steam) {
      steam.life.fill(0);
      steam.colours.fill(0);
      steam.sizes.fill(0);
      markPoolDirty(steam);
    }
    steamAlive = 0;
    for (const ring of rings) {
      ring.mesh.visible = false;
      ring.mesh.material.opacity = 0;
    }
    if (banner) banner.classList.remove('visible');
    bannerTimer = 0;
  }

  /** @returns {void} */
  function disposeCollisions() {
    if (!group) return;
    if (rings.length) rings[0].mesh.geometry.dispose();
    for (const ring of rings) ring.mesh.material.dispose();
    if (ringTexture) ringTexture.dispose();
    if (steam) disposeParticlePool(Sim.three.scene, steam);
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    Sim.three.scene.remove(group);
    group = null;
    steam = null;
    ringTexture = null;
    banner = null;
    rings.length = 0;
  }

  return {
    initCollisions, updateCollisions, groundDischarge,
    resetCollisions, disposeCollisions
  };
}
