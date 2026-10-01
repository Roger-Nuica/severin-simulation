// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { FUEL_STATION_VARIANT } from './environment/fuelStation.js';
import { setOffExplosivesAt } from './explosives.js';
import { BLAST_SIZE } from './player/energy.js';
import { FUEL } from './fuelFire/config.js';
import { createCarChain } from './fuelFire/chain.js';
import { createFuelEffects } from './fuelFire/effects.js';
import { createFuelLeakSound } from './fuelFire/sound.js';

/**
 * ===========================================================================
 * SECTION FF — Fuel stations going up
 * ===========================================================================
 * The town's fuel stations (environment/fuelStation.js) as a disaster of
 * their own, in three acts:
 *
 *  1. Leak. A funnel reaching the forecourt (a direct hit: inside its
 *     capture edge x FUEL.hitReach), or the wind tearing any piece off it,
 *     ruptures the pumps. Fuel sprays out of them and spreads over the
 *     forecourt as a dark puddle, the pumps hiss and the pump alarm beeps;
 *     people keep clear (hazards.js). FUEL.leakSeconds.
 *  2. Fire. The spilt fuel catches: flames over the puddle, the kiosk
 *     alight (buildingFire.js), the alarm faster. FUEL.burnSeconds.
 *  3. BOOM. A fireball with satellites, the large explosion sound, a
 *     flash, two rings of flame racing out along the ground and columns of
 *     black smoke that go on for FUEL.smokeSeconds; buildings in
 *     FUEL.blastRadius are shocked, loose things thrown, people in
 *     FUEL.killRadius killed, the neighbourhood set alight, and the station
 *     itself comes down. (It does not light the tornado directly: a funnel
 *     passing through the fires catches them, firenado.js.) Everything explosive in FUEL.setOffRadius goes
 *     too (engine/explosives.js), and the cars round it go up after it, one
 *     after the other (fuelFire/chain.js).
 *
 * A station reached by another explosion (a tanker, the chemical works,
 * another station, a meteor...) or collapsing skips the leak: it is already
 * on fire and goes up after FUEL.blastFuse.
 *
 * Chains are bounded by depth: a blast is depth 0, what it sets off depth 1,
 * and so on up to FUEL.maxDepth; nothing past that is set off. With the
 * breadth limits in the car chain, a station next to a street of cars is a
 * spectacle, never an endless (or frame-rate-killing) cascade.
 *
 * Roger near a blast takes energy from it (engine/player/energy.js absorbs
 * the 'explosion' event emitted here and by the cars).
 *
 * The panel's "⛽ Fuel Station" (Disasters) starts a leak: at the station
 * nearest Roger in Hero Mode, at a random intact one otherwise. It is
 * disabled while one is leaking or burning, and when none is left standing.
 */

/**
 * @typedef {Object} Station
 * @property {SimObject} obj
 * @property {number} x
 * @property {number} z
 * @property {THREE.Vector3[]} pumps world positions of the two pump heads
 * @property {THREE.Vector3} forecourt world position of the puddle's centre
 * @property {'intact'|'leaking'|'burning'|'gone'} phase
 * @property {number} timer seconds left in this phase
 * @property {number} depth in the chain of explosions
 * @property {number} smoke seconds of smoke left once gone
 * @property {THREE.Mesh|null} puddle
 * @property {Object|null} hazard
 * @property {number} owedSpray fractional particles owed
 * @property {number} owedFlame
 * @property {number} owedSmoke
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   leak: (station?: Station) => boolean,
 *   breach: (obj: SimObject) => void,
 *   igniteAt: (x: number, z: number, radius: number) => void,
 *   blowCarsNear: (x: number, z: number, depth: number) => number,
 *   stations: () => Station[],
 *   initFuelFire: () => void,
 *   updateFuelFire: (dt: number, rawDt: number) => void,
 *   resetFuelFire: () => void,
 *   disposeFuelFire: () => void
 * }}
 */
export function createFuelFireSystem(ctx) {
  const { Sim } = ctx;
  const chain = createCarChain(ctx);
  const effects = createFuelEffects(ctx);
  const sound = createFuelLeakSound(ctx);
  /** @type {Station[]} */
  let list = [];
  // The depth of the blast being resolved right now, while it sets things
  // off through explosives.js: what it reaches is one deeper.
  let blastDepth = -1;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  const scratch = new THREE.Vector3();

  /**
   * The stations in the town as it stands (it is rebuilt on Reset).
   * @returns {void}
   */
  function collect() {
    const env = ctx.Environment;
    list = [];
    if (!env) return;
    for (const obj of env.buildings) {
      const root = obj.mesh;
      if (!root || root.userData.variant !== FUEL_STATION_VARIANT) continue;
      root.updateMatrixWorld(true);
      list.push({
        obj, x: root.position.x, z: root.position.z,
        // The pumps and the forecourt, in the station's own frame
        // (environment/fuelStation.js: canopy at z 1.4, pumps at x +-2.2).
        pumps: [-2.2, 2.2].map(px => root.localToWorld(new THREE.Vector3(px, 1.3, 3))),
        forecourt: root.localToWorld(new THREE.Vector3(0, 0, 3)),
        phase: 'intact', timer: 0, depth: 0, smoke: 0,
        puddle: null, hazard: null, owedSpray: 0, owedFlame: 0, owedSmoke: 0
      });
    }
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (banner) {
      /** @type {HTMLElement} */ (banner.querySelector('.title')).textContent = title;
      /** @type {HTMLElement} */ (banner.querySelector('.sub')).textContent = sub;
      banner.classList.add('visible');
      bannerTimer = 3;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /** @returns {void} the panel button follows what can be done */
  function syncButton() {
    if (!button) return;
    const busy = list.some(s => s.phase === 'leaking' || s.phase === 'burning');
    const left = list.some(s => s.phase === 'intact');
    button.disabled = busy || !left;
    button.title = !left ? 'No fuel station left standing: Reset for a new town' : busy ? 'A station is already leaking' : '';
  }

  /**
   * Act one: the pumps rupture.
   * @param {Station} [station] a random intact one if not given
   * @returns {boolean} whether one started leaking
   */
  function leak(station) {
    const s = station || pickStation();
    if (!s || s.phase !== 'intact') return false;
    s.phase = 'leaking';
    s.timer = FUEL.leakSeconds;
    s.depth = 0;
    s.puddle = effects.puddle(s.forecourt.x, s.forecourt.z);
    s.hazard = ctx.systems.hazards.addHazard({ x: s.forecourt.x, z: s.forecourt.z, radius: FUEL.puddleRadius + 6, kind: 'fuelLeak' });
    showBanner('FUEL LEAK!', 'Pump alarm · the forecourt is flooding with fuel');
    syncButton();
    return true;
  }

  /**
   * For the panel: nearest Roger in Hero Mode, random otherwise.
   * @returns {Station|null}
   */
  function pickStation() {
    const intact = list.filter(s => s.phase === 'intact');
    if (!intact.length) return null;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    if (!roger) return intact[Math.floor(Math.random() * intact.length)];
    let best = intact[0];
    let bestD = Infinity;
    for (const s of intact) {
      const d = Math.hypot(s.x - roger.x, s.z - roger.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /**
   * Act two: alight. Straight here (no leak) when something else set it off.
   * @param {Station} s
   * @param {number} [fuse] seconds until the blast
   * @returns {void}
   */
  function burn(s, fuse = FUEL.burnSeconds) {
    if (s.phase === 'gone' || s.phase === 'burning') return;
    if (!s.puddle) s.puddle = effects.puddle(s.forecourt.x, s.forecourt.z);
    if (!s.hazard) s.hazard = ctx.systems.hazards.addHazard({ x: s.forecourt.x, z: s.forecourt.z, radius: FUEL.puddleRadius + 6, kind: 'fuelLeak' });
    s.phase = 'burning';
    s.timer = fuse;
    ctx.systems.buildingFire.igniteBuilding(s.obj, 0.5);
    syncButton();
  }

  /**
   * Set off by a blast at the given depth (or a collapse).
   * @param {Station} s
   * @param {number} depth
   * @returns {void}
   */
  function setOff(s, depth) {
    if (s.phase === 'gone' || s.phase === 'burning' || depth > FUEL.maxDepth) return;
    s.depth = depth;
    const [lo, hi] = FUEL.blastFuse;
    burn(s, lo + Math.random() * (hi - lo));
  }

  /**
   * Act three.
   * @param {Station} s
   * @returns {void}
   */
  function boom(s) {
    s.phase = 'gone';
    s.smoke = FUEL.smokeSeconds;
    if (s.hazard) ctx.systems.hazards.removeHazard(s.hazard);
    s.hazard = null;
    const { x, z } = s.forecourt;
    const at = new THREE.Vector3(x, 3, z);
    const sys = ctx.systems;

    sys.explosions.spawnImpactBurst(at, FUEL.boomStrength);
    for (let i = 0; i < FUEL.satellites; i++) {
      scratch.set(
        x + (Math.random() - 0.5) * FUEL.satelliteSpread,
        2 + Math.random() * 14,
        z + (Math.random() - 0.5) * FUEL.satelliteSpread
      );
      sys.explosions.spawnImpactBurst(scratch, FUEL.boomStrength * (0.25 + Math.random() * 0.25));
    }
    sys.cues.playLargeExplosion({ priority: true, gain: 1.2 });
    sys.lightning.flashScreen(at, 0.8, '#ffc27a');
    sys.gamefeel.event('tanker', at);
    for (let i = 0; i < FUEL.rings; i++) effects.ring(x, z, i * FUEL.ringGap);
    effects.flames(x, z, FUEL.puddleRadius, 90);

    // Loose things thrown, people in the fireball killed (never Roger).
    /** @type {SimObject[]} */
    const people = [];
    sys.area.forEachInRadius({ x, z, radius: FUEL.throwRadius, targets: ['person', 'object'] }, (hit) => {
      const obj = hit.target;
      if (hit.kind === 'person' && hit.d < FUEL.killRadius) { people.push(obj); return; }
      if (obj.rooted || !obj.velocity) return;
      const falloff = 1 - hit.d / FUEL.throwRadius;
      const dir = scratch.set(hit.x - x, 0, hit.z - z);
      if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize().multiplyScalar(FUEL.throwForce * falloff);
      obj.velocity.add(dir);
      obj.velocity.y += FUEL.throwForce * falloff * 0.5;
    });
    for (const person of people) sys.people.explodePerson(person);

    // The buildings round it shaken, the neighbourhood alight, the station
    // itself down.
    for (const building of ctx.Environment.buildings) {
      if (building === s.obj) continue;
      const p = building.mesh.position;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < FUEL.blastRadius) sys.damage.shockBuilding(building, FUEL.buildingShock * (1 - d / FUEL.blastRadius), at);
    }
    sys.buildingFire.igniteNear(x, z, FUEL.fireRadius);
    if (s.obj.damageState !== 'collapsed') sys.damage.collapseBuilding(s.obj, 0, at);

    // What it sets off is one deeper in the chain.
    const previous = blastDepth;
    blastDepth = s.depth;
    setOffExplosivesAt(ctx, x, z, FUEL.setOffRadius);
    for (const other of list) {
      if (other !== s && Math.hypot(other.x - x, other.z - z) < FUEL.stationChainRadius) setOff(other, s.depth + 1);
    }
    blastDepth = previous;
    chain.blowCarsNear(x, z, s.depth + 1);

    sys.damage.addDamageScore(FUEL.score);
    ctx.events.emit('explosion', { x, z, size: BLAST_SIZE.station, source: s.obj });
    showBanner('FUEL STATION EXPLODES!', `The tanks went up · +${FUEL.score} bonus`);
    syncButton();
  }

  /**
   * A station coming down (damage/buildings.js): it goes up.
   * @param {SimObject} obj
   * @returns {void}
   */
  function breach(obj) {
    const s = list.find(st => st.obj === obj);
    if (s) setOff(s, blastDepth >= 0 ? blastDepth + 1 : 0);
  }

  /**
   * Something violent enough happened near (explosives.js).
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {void}
   */
  function igniteAt(x, z, radius) {
    for (const s of list) {
      if (Math.hypot(s.x - x, s.z - z) < radius + 8) setOff(s, blastDepth >= 0 ? blastDepth + 1 : 1);
    }
  }

  /**
   * Cars round a blast going up after it (the tanker's too).
   * @param {number} x
   * @param {number} z
   * @param {number} depth of the cars (the blast's + 1)
   * @returns {number} how many were queued
   */
  function blowCarsNear(x, z, depth) {
    return chain.blowCarsNear(x, z, depth);
  }

  /**
   * A funnel on the forecourt, or the wind already tearing at it.
   * @param {Station} s
   * @returns {boolean}
   */
  function hitByFunnel(s) {
    if (s.obj.damageState !== 'intact') return true;
    if (!Sim.state.running) return false;
    const v = ctx.tornadoes.nearest(s.x, s.z);
    if (!v || !(v.birth > 0.5) || v.neutralized) return false;
    const edge = Sim.params.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor * (v.sizeMul || 1) * FUEL.hitReach;
    return Math.hypot(s.x - v.center.x, s.z - v.center.z) < edge;
  }

  /**
   * @param {number} owed fractional particles carried over
   * @param {number} rate a second
   * @param {number} dt
   * @returns {[number, number]} whole particles now, and what is still owed
   */
  function due(owed, rate, dt) {
    const total = owed + rate * dt;
    const n = Math.floor(total);
    return [n, total - n];
  }

  /** @returns {void} */
  function initFuelFire() {
    effects.init();
    collect();
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-fuel-station'));
    if (button) button.addEventListener('click', () => { leak(); }, { signal: ctx.signal });
    syncButton();
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @param {number} rawDt real seconds, for the sound
   * @returns {void}
   */
  function updateFuelFire(dt, rawDt) {
    if (bannerTimer > 0) {
      bannerTimer -= rawDt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    let hiss = 0;
    let alarm = 0;
    let anyBurning = false;
    const cam = Sim.three.camera.position;
    if (dt > 0) {
      for (const s of list) {
        if (s.phase === 'intact') {
          if (hitByFunnel(s)) leak(s);
          continue;
        }
        if (s.phase === 'gone') {
          if (s.smoke <= 0) continue;
          s.smoke -= dt;
          const fade = Math.max(0, s.smoke / FUEL.smokeSeconds);
          let n;
          [n, s.owedSmoke] = due(s.owedSmoke, FUEL.smokeRate * (0.3 + 0.7 * fade), dt);
          if (n) effects.smoke(s.forecourt.x, s.forecourt.z, n);
          // The spilt fuel burns on for a while after the blast.
          if (s.smoke > FUEL.smokeSeconds * 0.6) {
            [n, s.owedFlame] = due(s.owedFlame, 40, dt);
            if (n) effects.flames(s.forecourt.x, s.forecourt.z, FUEL.puddleRadius * 0.7, n);
          }
          continue;
        }
        s.timer -= dt;
        const near = 1 / (1 + Math.hypot(cam.x - s.x, cam.z - s.z) / 45);
        let n;
        if (s.phase === 'leaking') {
          const spread = 1 - Math.max(0, s.timer) / FUEL.leakSeconds;
          if (s.puddle) s.puddle.scale.setScalar(Math.max(0.01, FUEL.puddleRadius * Math.sqrt(spread)));
          [n, s.owedSpray] = due(s.owedSpray, 70, dt);
          for (let k = 0; k < n; k++) {
            const pump = s.pumps[k % 2];
            effects.spray(pump.x, pump.y, pump.z, 1);
          }
          hiss = Math.max(hiss, near);
          alarm = Math.max(alarm, near);
          if (s.timer <= 0) burn(s);
        } else {
          if (s.puddle && s.puddle.scale.x < FUEL.puddleRadius) s.puddle.scale.setScalar(FUEL.puddleRadius);
          [n, s.owedFlame] = due(s.owedFlame, 110, dt);
          if (n) effects.flames(s.forecourt.x, s.forecourt.z, FUEL.puddleRadius, n);
          [n, s.owedSmoke] = due(s.owedSmoke, FUEL.smokeRate * 0.5, dt);
          if (n) effects.smoke(s.forecourt.x, s.forecourt.z, n);
          hiss = Math.max(hiss, near * 0.5);
          alarm = Math.max(alarm, near);
          anyBurning = true;
          if (s.timer <= 0) boom(s);
        }
      }
      chain.update(dt);
      effects.update(dt);
    }
    sound.updateLeakSound(hiss, alarm, anyBurning, rawDt);
  }

  /** @returns {void} */
  function resetFuelFire() {
    for (const s of list) if (s.hazard) ctx.systems.hazards.removeHazard(s.hazard);
    chain.clear();
    effects.clear();
    sound.silenceLeakSound();
    blastDepth = -1;
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
    collect();
    syncButton();
  }

  /** @returns {void} */
  function disposeFuelFire() {
    effects.release();
    sound.releaseLeakSound();
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
    list = [];
  }

  return {
    leak, breach, igniteAt, blowCarsNear, stations: () => list,
    initFuelFire, updateFuelFire, resetFuelFire, disposeFuelFire
  };
}
