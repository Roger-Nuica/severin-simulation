// @ts-check
import * as THREE from 'three';
import { FUEL } from './config.js';
import { BLAST_SIZE } from '../player/energy.js';

/**
 * ===========================================================================
 * SECTION FF.1 — Secondary explosions
 * ===========================================================================
 * A big blast (a fuel station, a tanker) sets off the cars parked round it:
 * each goes up a moment after the blast reaches it, one after the other,
 * and each can set off the cars right next to it in turn. The chain is
 * bounded three ways, so that a street full of cars is a spectacle and not
 * a frame-rate collapse:
 *  - depth: a car set off by a car set off by ... stops at FUEL.maxDepth;
 *  - breadth: FUEL.carsPerBlast from one blast, FUEL.carsPerCar from a car;
 *  - FUEL.maxPending waiting at once, all chains together.
 * A car goes up once: burnt out (paint charred), thrown, and not again.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   blowCarsNear: (x: number, z: number, depth: number, radius?: number, most?: number) => number,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   pending: () => number
 * }}
 */
export function createCarChain(ctx) {
  /** @type {{car: SimObject, delay: number, depth: number}[]} */
  const queue = [];
  /** @type {WeakSet<SimObject>} cars already gone up (or queued) this run */
  const burnt = new WeakSet();
  const scratch = new THREE.Vector3();

  /**
   * Queues the nearest intact cars round a blast.
   * @param {number} x
   * @param {number} z
   * @param {number} depth the blast's own depth in the chain (a station or a
   *   tanker is 0, so its cars are 1)
   * @param {number} [radius]
   * @param {number} [most]
   * @returns {number} how many were queued
   */
  function blowCarsNear(x, z, depth, radius = FUEL.carRadius, most = FUEL.carsPerBlast) {
    if (depth > FUEL.maxDepth) return 0;
    const env = ctx.Environment;
    if (!env) return 0;
    /** @type {{car: SimObject, d: number}[]} */
    const near = [];
    for (const car of env.cars) {
      // The car Roger is driving is his, not the chain's.
      if (burnt.has(car) || !car.mesh || !car.mesh.parent || car.mesh.userData.heroDriving) continue;
      const p = car.mesh.position;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) near.push({ car, d });
    }
    near.sort((a, b) => a.d - b.d);
    let queued = 0;
    for (const { car, d } of near) {
      if (queued >= most || queue.length >= FUEL.maxPending) break;
      burnt.add(car);
      const [lo, hi] = FUEL.carDelay;
      // Nearer first, so the chain visibly walks outward.
      queue.push({ car, depth, delay: lo + (hi - lo) * (d / radius) + Math.random() * 0.15 });
      queued++;
    }
    return queued;
  }

  /**
   * One car going up.
   * @param {SimObject} car
   * @param {number} depth
   * @returns {void}
   */
  function explode(car, depth) {
    const p = car.mesh.position;
    scratch.set(p.x, p.y + 1.2, p.z);
    ctx.systems.explosions.spawnImpactBurst(scratch, FUEL.carStrength);
    ctx.systems.gamefeel.event('gas', scratch);
    // Thrown up and over by its own blast, and burnt out.
    car.rooted = false;
    car.velocity.y += 9 + Math.random() * 5;
    car.velocity.x += (Math.random() - 0.5) * 6;
    car.velocity.z += (Math.random() - 0.5) * 6;
    car.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
    if (car.damageState === 'intact') car.damageState = 'tipped';
    car.mesh.traverse((/** @type {any} */ o) => {
      if (o.userData && o.userData.carPart === 'body' && o.material && o.material.color) {
        o.material.color.multiplyScalar(0.12);
      }
    });
    // Anyone standing right beside it (never Roger: engine/effects/area.js).
    /** @type {SimObject[]} */
    const caught = [];
    ctx.systems.area.forEachInRadius({ x: p.x, z: p.z, radius: 3.5, targets: ['person'] }, (hit) => caught.push(hit.target));
    for (const person of caught) ctx.systems.people.explodePerson(person);
    ctx.systems.damage.addDamageScore(60);
    ctx.events.emit('explosion', { x: p.x, z: p.z, size: BLAST_SIZE.car, source: car });
    blowCarsNear(p.x, p.z, depth + 1, FUEL.carChainRadius, FUEL.carsPerCar);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i];
      entry.delay -= dt;
      if (entry.delay > 0) continue;
      queue.splice(i, 1);
      explode(entry.car, entry.depth);
    }
  }

  /** @returns {void} */
  function clear() {
    queue.length = 0;
  }

  return { blowCarsNear, update, clear, pending: () => queue.length };
}
