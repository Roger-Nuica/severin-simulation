// @ts-check
import * as THREE from 'three';
import { onRailway } from './train.js';

/**
 * ===========================================================================
 * SECTION D.8 — Environment: the new arrivals
 * ===========================================================================
 * More people on top of the 165 generateEnvironment() places at the start of
 * a run (engine/environment/index.js): a wave of WAVE_SIZE every
 * WAVE_EVERY seconds of game time, for as long as the run goes on. (It used
 * to be a single wave of 150 a minute in; on request, it is now twenty every
 * thirty seconds, so the town keeps filling up while the storm and the
 * aliens thin it out.)
 *
 * Each one arrives on their own, at a random clear spot somewhere in the
 * town, and a wave trickles in over ARRIVE_SECONDS rather than all on one
 * frame. They used to come out in groups of thirty, and a group standing in
 * one place was a single easy pick-up for the funnel. Spots inside a
 * building, on the railway, or near a funnel are skipped. Past LIVE_CAP
 * people alive at once a wave is cut short, so an hour-long run does not
 * grind the frame rate down.
 *
 * Reuses the existing crowd wholesale: the moment a fresh person is created
 * and handed a motion state (peopleMotion.js's getMotion), the ordinary
 * wander AI takes it from a standing start to strolling somewhere.
 *
 * The clock is the game's own, not the storm's (on request): the waves come
 * every WAVE_EVERY seconds from the moment the town is there, Start or no
 * Start -- the aliens do not wait for the storm either, and once a nuclear
 * plant had turned everyone into aliens (engine/nuclear.js) the town used
 * to stay empty until the Tornado button was pressed.
 *
 * Everyone who arrives from ARMED_AFTER seconds on (two minutes) is armed:
 * a pistol in the right hand, and they fight back -- any alien within
 * ARMED.range gets shot at every ARMED.every seconds (a yellow tracer), and
 * a hit kills it (aliens.js plasmaKill, the way Roger's rifle does). They
 * hold their fire while Smooth Criminal plays (engine/smoothCriminal.js).
 */

const WAVE_EVERY = 30;       // seconds of game time between two waves
const WAVE_SIZE = 20;
const ARRIVE_SECONDS = 3;    // one wave spread over this long
const LIVE_CAP = 420;        // no new arrivals while this many are about
// Where they may appear: inside the playable town (peopleMotion.js's
// WORLD_BOUND is 128), clear of any building footprint by this much, and
// clear of every funnel by this much.
const SPAWN_BOUND = 115;
const BUILDING_CLEARANCE = 2.5;
const FUNNEL_CLEARANCE = 55;
// Arrivals from this many seconds on come armed (see the header).
const ARMED_AFTER = 120;
const ARMED = {
  range: 38,               // an alien this near gets shot at
  every: [0.9, 1.8],       // seconds between two shots
  hitChance: 0.6,
  aimSeconds: 0.45,        // the gun arm stays up this long after a shot
  tracers: 12,
  tracerSeconds: 0.09
};

/**
 * @param {Object} ctx
 * @returns {{
 *   updateReinforcements: (dt?: number) => void,
 *   resetReinforcements: () => void,
 *   disposeReinforcements: () => void,
 *   armedNow: () => boolean,
 *   spawnedCount: () => number
 * }}
 */
export function createReinforcementsSystem(ctx) {
  const { Sim } = ctx;

  const state = { count: 0, owed: 0, nextWave: WAVE_EVERY, left: 0, clock: 0 };
  /** @type {Object[]} the armed ones still about */
  let armed = [];
  /** @type {{gun: THREE.BufferGeometry, gunMat: THREE.Material, tracerGeo: THREE.BufferGeometry, tracers: {mesh: THREE.Mesh, life: number}[]}|null} made on the first armed arrival */
  let kit = null;
  const UP = new THREE.Vector3(0, 1, 0);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether a person can appear here
   */
  function clearSpot(x, z) {
    if (onRailway(x, z)) return false;
    for (const tornado of ctx.tornadoes.active) {
      const c = tornado.Vortex.center;
      if (Math.hypot(x - c.x, z - c.z) < FUNNEL_CLEARANCE) return false;
    }
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const p = building.mesh.position;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      if (Math.abs(x - p.x) < fp.width / 2 + BUILDING_CLEARANCE
        && Math.abs(z - p.z) < fp.depth / 2 + BUILDING_CLEARANCE) return false;
    }
    if (ctx.systems.chasm && ctx.systems.chasm.gapAt(x, z) > -4) return false;
    return true;
  }

  /**
   * One person, somewhere random and clear.
   * @returns {void}
   */
  function spawnOne() {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      x = (Math.random() * 2 - 1) * SPAWN_BOUND;
      z = (Math.random() * 2 - 1) * SPAWN_BOUND;
      if (clearSpot(x, z)) break;
    }
    const { createPerson } = ctx.systems.people;
    const { getMotion } = ctx.systems.peopleMotion;
    const people = ctx.Environment.people;
    const index = people.length;
    const person = createPerson(x, z, index);
    people.push(person);
    ctx.Environment.groups.add(person.mesh);
    Sim.objects.push(person);
    state.count++;
    // Not routed through assignPairs: these simply have no chat partner,
    // which is already the normal state for most of the crowd
    // (peopleMotion.js's PAIR_FRACTION pairs off only a portion of it).
    getMotion(person, index);
    if (state.clock >= ARMED_AFTER) arm(person);
  }

  /** @returns {void} */
  function buildKit() {
    const tracerGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 5, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    const tracers = [];
    for (let i = 0; i < ARMED.tracers; i++) {
      const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(4, 3, 0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      Sim.three.scene.add(mesh);
      tracers.push({ mesh, life: 0 });
    }
    kit = {
      gun: new THREE.BoxGeometry(0.06, 0.08, 0.26),
      gunMat: new THREE.MeshStandardMaterial({ color: 0x1e1f22, metalness: 0.7, roughness: 0.35 }),
      tracerGeo,
      tracers
    };
  }

  /**
   * A pistol in their right hand, and a place on the armed list.
   * @param {Object} person
   * @returns {void}
   */
  function arm(person) {
    if (!kit) buildKit();
    const armR = person.mesh.children.find(c => c.name.endsWith('_armR'));
    if (!armR) return;
    // Its own geometry and material: whatever kills them (explodePerson,
    // mutation) disposes everything they are made of.
    const gun = new THREE.Mesh(kit.gun.clone(), kit.gunMat.clone());
    gun.name = 'civilian_gun';
    // At the hand, pointing forward along the arm when it is raised.
    gun.position.set(0, -0.5, 0.08);
    gun.rotation.x = -Math.PI / 2;
    armR.add(gun);
    person.armed = true;
    person.armR = armR;
    person.shotTimer = ARMED.every[0] + Math.random() * (ARMED.every[1] - ARMED.every[0]);
    person.aimTimer = 0;
    armed.push(person);
  }

  /**
   * The armed ones fighting back.
   * @param {number} dt
   * @returns {void}
   */
  function updateArmed(dt) {
    if (kit) {
      for (const tr of kit.tracers) {
        if (tr.life <= 0) continue;
        tr.life -= dt;
        tr.mesh.material.opacity = Math.max(0, tr.life / ARMED.tracerSeconds);
        if (tr.life <= 0) tr.mesh.visible = false;
      }
    }
    armed = armed.filter(p => p.mesh.parent && !p.abducted && !p.electrocuted);
    if (!armed.length) return;
    const aliens = ctx.systems.aliens;
    const peace = ctx.systems.smoothCriminal && ctx.systems.smoothCriminal.peace();
    const targets = aliens && !peace ? aliens.targets() : [];
    for (const person of armed) {
      if (person.aimTimer > 0) {
        person.aimTimer -= dt;
        person.armR.rotation.set(-1.5, 0, 0.1);
      }
      person.shotTimer -= dt;
      if (person.shotTimer > 0 || !targets.length || person.captureState !== 'grounded' || person.dancing) continue;
      const p = person.mesh.position;
      let best = null;
      let bestD = ARMED.range;
      for (const alien of targets) {
        const q = alien.root.position;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = alien;
        }
      }
      if (!best) continue;
      person.shotTimer = ARMED.every[0] + Math.random() * (ARMED.every[1] - ARMED.every[0]);
      const q = best.root.position;
      person.mesh.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      person.armR.rotation.set(-1.5, 0, 0.1);
      person.aimTimer = ARMED.aimSeconds;
      const hit = Math.random() < ARMED.hitChance;
      from.set(p.x, 3.6, p.z);
      to.set(q.x + (hit ? 0 : (Math.random() - 0.5) * 4), hit ? 3 : 1 + Math.random() * 4, q.z + (hit ? 0 : (Math.random() - 0.5) * 4));
      tracer(from, to);
      if (ctx.systems.powerArcSound && Math.random() < 0.3) ctx.systems.powerArcSound.playZap(0.15);
      if (hit) aliens.plasmaKill(best, to);
    }
  }

  /**
   * @param {THREE.Vector3} a
   * @param {THREE.Vector3} b
   * @returns {void}
   */
  function tracer(a, b) {
    const tr = kit.tracers.find(t => t.life <= 0) || kit.tracers[0];
    const dir = b.clone().sub(a);
    const length = dir.length();
    if (length < 0.01) return;
    tr.mesh.position.copy(a);
    tr.mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
    tr.mesh.scale.set(1, length, 1);
    tr.mesh.visible = true;
    tr.mesh.material.opacity = 1;
    tr.life = ARMED.tracerSeconds;
  }

  /**
   * Per frame, storm or no storm: every WAVE_EVERY seconds of the game's own
   * clock, a wave of WAVE_SIZE let in at a steady rate over ARRIVE_SECONDS;
   * and the armed ones fighting.
   * @param {number} [dt]
   * @returns {void}
   */
  function updateReinforcements(dt = 1 / 60) {
    state.clock += dt;
    updateArmed(dt);
    if (state.clock >= state.nextWave) {
      state.nextWave += WAVE_EVERY;
      state.left += WAVE_SIZE;
    }
    if (state.left <= 0) return;
    state.owed += (WAVE_SIZE / ARRIVE_SECONDS) * dt;
    while (state.owed >= 1 && state.left > 0) {
      state.owed -= 1;
      state.left--;
      if (ctx.Environment.people.length < LIVE_CAP) spawnOne();
    }
  }

  /** @returns {void} */
  function resetReinforcements() {
    state.count = 0;
    state.owed = 0;
    state.left = 0;
    state.nextWave = WAVE_EVERY;
    state.clock = 0;
    armed = [];
    if (kit) {
      for (const tr of kit.tracers) {
        tr.life = 0;
        tr.mesh.visible = false;
      }
    }
  }

  /** @returns {void} */
  function disposeReinforcements() {
    resetReinforcements();
    if (!kit) return;
    for (const tr of kit.tracers) {
      Sim.three.scene.remove(tr.mesh);
      tr.mesh.material.dispose();
    }
    kit.tracerGeo.dispose();
    kit.gun.dispose();
    kit.gunMat.dispose();
    kit = null;
  }

  /** @returns {boolean} whether new arrivals come armed now */
  function armedNow() {
    return state.clock >= ARMED_AFTER;
  }

  /** @returns {number} how many have been let out so far this run */
  function spawnedCount() {
    return state.count;
  }

  return { updateReinforcements, resetReinforcements, disposeReinforcements, spawnedCount, armedNow };
}
