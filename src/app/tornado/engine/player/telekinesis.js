// @ts-check
import * as THREE from 'three';
import { blowUpCar } from '../effects/carBlast.js';

/**
 * ===========================================================================
 * SECTION PK — Telekinesis
 * ===========================================================================
 * Roger's C ability (engine/player/abilities.js), added 2026-10-02 on
 * request (TODO.md, feature backlog). C lifts the car he is looking at (the one nearest
 * his aim within TK.range and TK.cone) and holds it floating in front of
 * him, a violet beam from his hand to it: on foot it hangs over his
 * shoulder, and with the weapon raised (first person) it hangs just above
 * the crosshair and follows the mouse, and is thrown at what the
 * crosshair is on. C again, or the left button in first
 * person, throws it the way he aims; after TK.holdSeconds his grip gives
 * and it goes anyway. A daze, a car, a freeze or death drops it.
 *
 * A thrown car flies as an ordinary physics object (physics.js) and is
 * tested here, segment by segment, against what it can hit: the first
 * registered enemy, building, tree or the ground it meets stops it, and it
 * blows up there (effects/carBlast.js). The thing it struck takes the hit:
 *  - an enemy, a 'throw' hit through the register (enemies.js hit, the
 *    damage table's `throw` column), and every other enemy within
 *    TK.splash of the blast one more;
 *  - a building or a tree, damage.js damageFromImpact with the car's own
 *    energy, the same path a car thrown by the funnel takes;
 *  - people in its way are killed and do not stop it.
 * Ships in the air, the nuclear plants and the samurai (Landing Support,
 * on Roger's side) are not targets.
 *
 * Holding runs on the player's clock (the ability's update); the flight on
 * the world's, so Time Slow slows a thrown car too.
 */

export const TK = {
  keys: ['KeyC'],
  cost: 2,                 // segments (20%)
  holdSeconds: 8,
  cooldown: 1.5,
  range: 35,               // metres from Roger to the car
  cone: 0.45,              // radians either side of his aim
  // Where it is held: third person, ahead and above him; first person,
  // this far down the crosshair.
  holdAhead: 5,
  holdUp: 5,
  holdAim: 14,
  holdAimUp: 2.5,          // first person: this far above the crosshair, so it does not hide it
  aimAt: 60,               // first person: thrown at the point this far down the crosshair
  holdMinY: 2.5,
  follow: 7,               // how hard it is pulled to the hold point (1/s)
  followMax: 40,           // m/s
  throwSpeed: 52,
  throwLift: 0.12,         // the upward share of a third-person throw
  flightSeconds: 4,
  carRadius: 2.2,          // the car's reach in the hit tests
  personRadius: 1.3,
  treeRadius: 1.6,
  blast: 1.6,
  splash: 4,
  colour: 0xb07bff
};

// Not targets for a thrown car (see the header).
const UNTHROWABLE = new Set(['ufo', 'hunterShip', 'mothership', 'samuraiShip', 'nuclearPlant', 'samurai']);

/**
 * @param {Object} ctx
 * @returns {{
 *   initTelekinesis: () => void,
 *   updateTelekinesis: (rawDt: number) => void,
 *   holding: () => boolean,
 *   throwHeld: () => boolean,
 *   resetTelekinesis: () => void,
 *   disposeTelekinesis: () => void
 * }}
 */
export function createTelekinesisSystem(ctx) {
  const { Sim } = ctx;

  /** @type {any} the car picked by canStart, lifted by start */
  let picked = null;
  /** @type {any} the car held now */
  let held = null;
  /**
   * Cars in flight.
   * @type {{car: any, t: number, from: THREE.Vector3}[]}
   */
  const flights = [];

  /** @type {THREE.Mesh|null} the beam from his hand to the car */
  let beam = null;
  const hand = new THREE.Vector3();
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const to = new THREE.Vector3();
  const hitAt = new THREE.Vector3();

  /**
   * @param {string} text
   * @returns {void}
   */
  function say(text) {
    ctx.events.emit('notice', { text });
  }

  /** @returns {any} */
  function hero() {
    return ctx.systems.heroMode;
  }

  /**
   * @param {any} car
   * @returns {boolean} still a car in the town, not his and not in a funnel
   */
  function usable(car) {
    return !!(car && car.mesh && car.mesh.parent && !car.mesh.userData.heroDriving
      && car.captureState !== 'orbiting' && car.captureState !== 'rising');
  }

  /** @returns {boolean} whether Roger can hold something now */
  function rogerFree() {
    const h = hero();
    if (!h || !h.rogerFacing()) return false;
    const phase = h.rogerPhase();
    return (phase === 'running' || phase === 'aiming') && !h.rogerFrozen();
  }

  /**
   * The car nearest his aim, into `picked`.
   * @returns {string} why there is none; '' when one was found
   */
  function pick() {
    if (held) return 'already holding one';
    if (!rogerFree()) return 'not now';
    const h = hero();
    const f = h.rogerFacing();
    const aim = h.rogerAim();
    const heading = aim ? Math.atan2(aim.x, aim.z) : f.heading;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const env = ctx.Environment;
    picked = null;
    let best = Infinity;
    for (const car of env ? env.cars : []) {
      if (!usable(car) || flights.some(fl => fl.car === car)) continue;
      const p = car.mesh.position;
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      const d = Math.hypot(dx, dz);
      if (d > TK.range || d < 1) continue;
      const angle = Math.acos(THREE.MathUtils.clamp((dx * fx + dz * fz) / d, -1, 1));
      if (angle > TK.cone) continue;
      const score = d + angle * 30;
      if (score < best) {
        best = score;
        picked = car;
      }
    }
    return picked ? '' : `no car within ${TK.range} m where you look`;
  }

  /** @returns {void} */
  function start() {
    held = picked;
    picked = null;
    if (!held) return;
    held.rooted = false;
    held.mesh.userData.parked = false;
    // Out of the wind's tipping states (damage/trees.js updateCarDamage).
    held.damageState = 'airborne';
    held.captureState = 'falling';
    held.angularVelocity.set(0.3, 0.7, 0.2);
    if (ctx.systems.katanaSound) ctx.systems.katanaSound.playParry();
    say('TELEKINESIS · C again (or click, weapon raised) to throw');
  }

  /**
   * Where the held car is pulled to this frame, into `target`.
   * @returns {boolean} false when Roger is not there to hold it
   */
  function holdPoint() {
    const h = hero();
    const f = h.rogerFacing();
    if (!f) return false;
    hand.set(f.x, 1.4, f.z);
    const aim = h.rogerAim();
    if (aim) {
      const cam = Sim.three.camera;
      target.copy(cam.position).addScaledVector(aim, TK.holdAim);
      target.y = Math.max(TK.holdMinY, target.y + TK.holdAimUp);
    } else {
      target.set(f.x + Math.sin(f.heading) * TK.holdAhead, TK.holdUp, f.z + Math.cos(f.heading) * TK.holdAhead);
    }
    return true;
  }

  /**
   * Pulls the held car to its hold point (the ability's update, player time).
   * @param {number} dt
   * @returns {void}
   */
  function hold(dt) {
    if (!held) return;
    if (!usable(held) || !rogerFree() || !holdPoint()) {
      drop();
      return;
    }
    const p = held.mesh.position;
    dir.subVectors(target, p).multiplyScalar(TK.follow);
    if (dir.length() > TK.followMax) dir.setLength(TK.followMax);
    // Plus the gravity physics.js takes off it this frame.
    held.velocity.copy(dir);
    held.velocity.y += 9.8 * ctx.systems.physics.gravity.scale * dt;
  }

  /**
   * Lets go without a throw: it just falls.
   * @returns {void}
   */
  function drop() {
    if (held) held.velocity.multiplyScalar(0.2);
    held = null;
  }

  /**
   * Throws the held car the way he aims.
   * @returns {boolean} whether one was thrown
   */
  function throwHeld() {
    if (!held || !usable(held) || !holdPoint()) {
      drop();
      return false;
    }
    const h = hero();
    const aim = h.rogerAim();
    if (aim) {
      // At what the crosshair is on, from where the car hangs above it.
      dir.copy(Sim.three.camera.position).addScaledVector(aim, TK.aimAt).sub(held.mesh.position).normalize();
    } else {
      const f = h.rogerFacing();
      dir.set(Math.sin(f.heading), TK.throwLift, Math.cos(f.heading)).normalize();
    }
    held.velocity.copy(dir).multiplyScalar(TK.throwSpeed);
    held.angularVelocity.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4);
    flights.push({ car: held, t: 0, from: held.mesh.position.clone() });
    held = null;
    if (ctx.systems.katanaSound) ctx.systems.katanaSound.playSwing();
    return true;
  }

  /**
   * How far along the segment from -> to is closest to (x, z), 0..1.
   * @param {THREE.Vector3} from
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function along(from, x, z) {
    const sx = to.x - from.x;
    const sz = to.z - from.z;
    const len = sx * sx + sz * sz;
    if (len < 1e-6) return 0;
    return THREE.MathUtils.clamp(((x - from.x) * sx + (z - from.z) * sz) / len, 0, 1);
  }

  /**
   * Whether the segment passes within `reach` of (x, z) below `top`; the
   * point in hitAt.
   * @param {THREE.Vector3} from
   * @param {number} x
   * @param {number} z
   * @param {number} reach
   * @param {number} top
   * @returns {boolean}
   */
  function passes(from, x, z, reach, top) {
    const t = along(from, x, z);
    hitAt.lerpVectors(from, to, t);
    if (hitAt.y > top) return false;
    return Math.hypot(hitAt.x - x, hitAt.z - z) < reach;
  }

  /**
   * One car in flight: what it ran into this frame, if anything.
   * @param {{car: any, t: number, from: THREE.Vector3}} fl
   * @returns {boolean} whether it hit something and blew up
   */
  function fly(fl) {
    const car = fl.car;
    to.copy(car.mesh.position);
    const env = ctx.Environment;
    const enemies = ctx.systems.enemies;
    const energy = 0.5 * (car.mass || 1200) * car.velocity.lengthSq();

    /** @type {any[]} */
    const struck = [];
    for (const person of env.people) {
      if (!person.mesh.parent || person.abducted) continue;
      const p = person.mesh.position;
      if (passes(fl.from, p.x, p.z, TK.personRadius + TK.carRadius * 0.6, p.y + 2.5)) struck.push(person);
    }
    for (const person of struck) if (person.mesh.parent) ctx.systems.people.explodePerson(person);

    let stopped = false;
    for (const kind of enemies.kinds()) {
      if (UNTHROWABLE.has(kind.kind)) continue;
      for (const e of kind.list()) {
        const box = kind.hitbox ? kind.hitbox(e) : null;
        const p = box || kind.position(e);
        const radius = box ? box.radius : 1.2;
        const top = box ? box.top : 3;
        if (!passes(fl.from, p.x, p.z, radius + TK.carRadius, top + 1.5)) continue;
        if (enemies.hit(e, kind, { type: 'throw', at: { x: hitAt.x, y: hitAt.y, z: hitAt.z } })) ctx.events.emit('rogerKill');
        stopped = true;
        break;
      }
      if (stopped) break;
    }
    if (!stopped) {
      for (const b of env.buildings) {
        if (b.damageState === 'collapsed') continue;
        const fp = b.mesh.userData.footprint;
        if (!fp) continue;
        const bp = b.mesh.position;
        const pad = TK.carRadius * 0.6;
        if (Math.abs(to.x - bp.x) > fp.width / 2 + pad || Math.abs(to.z - bp.z) > fp.depth / 2 + pad) continue;
        if (to.y > (b.mesh.userData.wallHeight || 4) + 1) continue;
        hitAt.copy(to);
        ctx.systems.damage.damageFromImpact(b, hitAt, energy);
        stopped = true;
        break;
      }
    }
    if (!stopped) {
      for (const tree of env.trees) {
        if (!tree.mesh.parent || tree.damageState === 'uprooted') continue;
        const p = tree.mesh.position;
        if (!passes(fl.from, p.x, p.z, TK.treeRadius + TK.carRadius * 0.5, 8)) continue;
        ctx.systems.damage.damageFromImpact(tree, hitAt, energy);
        stopped = true;
        break;
      }
    }
    if (!stopped && fl.t > 0.2 && to.y <= (car.groundFloor || 0) + 0.5) stopped = true;
    fl.from.copy(to);
    if (!stopped) return false;

    blowUpCar(ctx, car, TK.blast);
    // The blast catches the enemies round it too.
    const p = car.mesh.position;
    for (const kind of enemies.kinds()) {
      if (UNTHROWABLE.has(kind.kind)) continue;
      for (const e of kind.list().slice()) {
        const q = kind.position(e);
        if (Math.hypot(q.x - p.x, q.z - p.z) > TK.splash) continue;
        if (enemies.hit(e, kind, { type: 'throw', at: { x: p.x, y: 1, z: p.z } })) ctx.events.emit('rogerKill');
      }
    }
    return true;
  }

  /**
   * The beam from his hand to the held car.
   * @returns {void}
   */
  function drawBeam() {
    if (!beam) return;
    beam.visible = !!held && holdPoint();
    if (!beam.visible) return;
    dir.subVectors(held.mesh.position, hand);
    const len = dir.length();
    if (len < 0.01) {
      beam.visible = false;
      return;
    }
    beam.position.copy(hand);
    beam.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
    beam.scale.set(1, len, 1);
    /** @type {THREE.MeshBasicMaterial} */ (beam.material).opacity = 0.45 + 0.25 * Math.sin(performance.now() * 0.02);
  }

  /**
   * The cars in flight, on the world's time, and the beam.
   * @param {number} rawDt
   * @returns {void}
   */
  function updateTelekinesis(rawDt) {
    const dt = Sim.state.paused ? 0 : rawDt * ctx.systems.time.scale('world');
    for (let i = flights.length - 1; i >= 0; i--) {
      const fl = flights[i];
      fl.t += dt;
      if (!usable(fl.car) || fl.t > TK.flightSeconds || (dt > 0 && fly(fl))) flights.splice(i, 1);
    }
    drawBeam();
  }

  /** @returns {void} */
  function initTelekinesis() {
    const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: TK.colour, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    beam.name = 'telekinesis_beam';
    beam.visible = false;
    beam.frustumCulled = false;
    Sim.three.scene.add(beam);
    ctx.systems.abilities.register({
      id: 'telekinesis', name: 'TELEKINESIS', keys: TK.keys, cost: TK.cost,
      seconds: TK.holdSeconds, cooldown: TK.cooldown,
      // C again ends it early, which throws.
      again: true,
      canStart: () => {
        const why = pick();
        if (!why) return true;
        say(`TELEKINESIS · ${why}`);
        return false;
      },
      start,
      update: hold,
      stop: (cancelled) => {
        if (cancelled) drop();
        else throwHeld();
      }
    });
  }

  /** @returns {void} */
  function resetTelekinesis() {
    held = null;
    picked = null;
    flights.length = 0;
    if (beam) beam.visible = false;
  }

  /** @returns {void} */
  function disposeTelekinesis() {
    resetTelekinesis();
    if (!beam) return;
    Sim.three.scene.remove(beam);
    beam.geometry.dispose();
    /** @type {THREE.Material} */ (beam.material).dispose();
    beam = null;
  }

  return {
    initTelekinesis, updateTelekinesis,
    holding: () => !!held,
    // The left button in first person: through the ability, so its clock
    // and cooldown are the same as C's (abilities.js press, `again`).
    throwHeld: () => !!held && ctx.systems.abilities.press(TK.keys[0]),
    resetTelekinesis, disposeTelekinesis
  };
}
